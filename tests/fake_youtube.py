"""A stand in YouTube, so our own half of a resumable upload can actually run.

Google's endpoint cannot be reached from a test. It needs an OAuth client that belongs to
a person and a channel with somebody's name on it, and both of those are the owner's to
make. But everything that has ever been wrong in jriter/modules/youtube.py is on our side
of the wire, and none of it needed Google to prove: the headers on the initiating POST,
reading the Location out of the answer, the Content-Range on the PUT, the arithmetic that
works out where to pick up, the retry loop, the refresh when a token dies halfway, and the
row written at the end. Today those are checked by handing _how_far a hand built
HTTPError, which exercises the four lines that read it and nothing that leads there.

So this speaks the other half of the conversation, over a real socket. It is faithful to
the protocol and to nothing else. What a green run does not mean is written out at the
bottom of tests/test_youtube_upload.py, and it is worth reading before quoting this.
"""
import json
import time
import socket
import struct
import hashlib
import threading
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


class Stand:
    """What the stand in has seen, and the knobs a test turns.

    Held on the server object rather than as class attributes on the handler, because a
    handler class is one object shared by every server in the process: two tests in one
    session would answer for each other, and that is the sort of failure that only shows
    up when the suite happens to run in a different order.
    """

    def __init__(self):
        self.begins = []            # every initiating POST, with its headers and body
        self.puts = []              # every PUT, named by the Content-Range it carried
        self.carried = []           # the token on each PUT that carried bytes, in order
        self.refreshes = []         # every form posted to the token endpoint
        self.refused = []           # everything answered 400, and why
        self.banked = bytearray()   # the bytes that actually arrived
        self.declared = 0           # what X-Upload-Content-Length said
        self.abandoned = 0          # PUTs where the client stopped sending
        self.sessions = 0
        self.minted = 0
        self.live = set()
        self.dead = set()
        self.complete = False

        # The knobs. Each one is a failure that has to be survivable and is otherwise
        # only ever seen on somebody's machine at the wrong moment.
        self.cut_after = None       # reset the connection this many bytes into the PUT
        self.cut_at_end = False     # take every byte, then reset before the reply
        self.kill_one_token = False # 401 the next token, once, and remember it is dead
        self.fail_once = False      # one 500, then behave
        self.forgotten = False      # 404 the session, as YouTube does after about a week
        self.no_location = False    # agree to the upload and not say where to send it
        self.trickle = 0.0          # seconds to wait per 64k read, to hold a PUT open
        self.video_id = "vidStandIn"
        self.privacy = "private"
        self.title = "a stand in title"

    def resource(self):
        """A video resource, shaped like the parts of Google's that this code reads.

        Not the whole thing, and the gap is the point of the note in the test file: a real
        one carries etag, channelId, publishedAt, thumbnails and a processing block, and
        nothing here would notice if reading one of those broke.
        """
        return {"kind": "youtube#video", "id": self.video_id,
                "snippet": {"title": self.title, "categoryId": "10"},
                "status": {"privacyStatus": self.privacy, "uploadStatus": "uploaded"}}

    def denied(self, token=""):
        """Google's error shape, with the token echoed into it on purpose.

        Nothing Google sends does that. A captive portal, a corporate proxy or a tunnel's
        own error page does, and _google_said puts the first two hundred characters of a
        body it cannot parse into a message the page then shows.
        """
        return {"error": {"code": 401, "message": "Invalid Credentials",
                          "errors": [{"reason": "authError",
                                      "message": "presented %s" % token}]}}

    def sha(self):
        return hashlib.sha256(bytes(self.banked)).hexdigest()


class _Handler(BaseHTTPRequestHandler):
    # HTTP/1.0, so every answer closes its own connection. Keep alive would mean the
    # reset the cut test needs could land on a connection the client had already moved
    # on from, which is a flaky test rather than a dropped upload.
    protocol_version = "HTTP/1.0"

    def log_message(self, *args):
        pass                    # the suite stays quiet; what happened is in stand.puts

    @property
    def stand(self):
        return self.server.stand

    def _say(self, code, phrase, payload=None, extra=()):
        body = b"" if payload is None else json.dumps(payload).encode("utf-8")
        self.send_response(code, phrase)
        for name, value in extra:
            self.send_header(name, value)
        self.send_header("Content-Type", "application/json")
        # Always, including on the empty 308. Without it urllib reads to the close and
        # the resume tests spend their timeout waiting for bytes never coming.
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if body:
            self.wfile.write(body)

    def _refuse(self, why):
        """Answer 400 rather than assert.

        An assertion on this thread fails nothing: the test is on another one and would
        see a hang or an unrelated error instead of the reason. So the reason is kept and
        the client is told, and the test asserts on stand.refused.
        """
        self.stand.refused.append(why)
        self._say(400, "Bad Request", {"error": {"message": why}})

    def _cut(self):
        """Drop the connection the way a tunnel does.

        SO_LINGER with a zero timeout makes this a reset and not a polite FIN. A FIN lets
        the client finish writing the whole body into a socket nobody is reading and only
        notice at the reply, which is not the failure being tested.

        wfile is deliberately left open. handle_one_request calls wfile.flush() straight
        after this returns and catches only TimeoutError, so closing it here turns every
        cut into a ValueError traceback on stderr.
        """
        self.connection.setsockopt(socket.SOL_SOCKET, socket.SO_LINGER,
                                   struct.pack("ii", 1, 0))
        self.close_connection = True
        self.connection.close()

    def _read_body(self, length, stop_at=None):
        """Read a PUT body in chunks, so a cut can land in the middle of one."""
        want = length if stop_at is None else min(length, stop_at)
        got = bytearray()
        while len(got) < want:
            try:
                chunk = self.rfile.read(min(65536, want - len(got)))
            except OSError:
                break           # the client went away; that is the cancel test
            if not chunk:
                break
            got += chunk
            if self.stand.trickle:
                # Read slowly, so the socket buffers fill and the client is genuinely
                # blocked inside _Counting.read while the test presses stop. Without it a
                # three megabyte body reaches the kernel faster than the test can reach
                # the cancel route, and the test passes for the wrong reason.
                time.sleep(self.stand.trickle)
        return got
    def do_POST(self):
        raw = self.rfile.read(int(self.headers.get("Content-Length") or 0))
        if self.path.startswith("/token"):
            return self._token(raw)
        if self.path.startswith("/upload"):
            return self._begin(raw)
        self._say(404, "Not Found", {"error": {"message": "no such path"}})

    def _token(self, raw):
        """The refresh.

        Every ask mints a new string, and that is the whole mechanism of the 401 test: a
        retry that presents the same token is presenting one this already knows is dead.
        expires_in is an hour, as Google's is, because a shorter one would hide the bug by
        making _access_token refresh on its own.
        """
        form = {k: v[0] for k, v in urllib.parse.parse_qs(raw.decode("utf-8")).items()}
        self.stand.refreshes.append(form)
        for field in ("client_id", "client_secret", "refresh_token"):
            if not form.get(field):
                return self._refuse("the refresh form had no %s" % field)
        if form.get("grant_type") != "refresh_token":
            return self._refuse("grant_type was %r" % form.get("grant_type"))
        self.stand.minted += 1
        token = "tok-%d" % self.stand.minted
        self.stand.live.add(token)
        self._say(200, "OK", {"access_token": token, "expires_in": 3600})

    def _begin(self, raw):
        """The initiating POST, checked in full.

        Every one of these is a header YouTube fails the upload over, and not one of them
        has ever been sent by a test.
        """
        head = self.headers
        note = {"path": self.path, "headers": dict(head.items())}
        self.stand.begins.append(note)

        token = (head.get("Authorization") or "")[len("Bearer "):]
        if token not in self.stand.live:
            return self._say(401, "Unauthorized", self.stand.denied(token))
        # The charset matters. Google takes either, but this is what the module sends and
        # a test that does not look would not notice it going.
        if head.get("Content-Type") != "application/json; charset=UTF-8":
            return self._refuse("Content-Type was %r" % head.get("Content-Type"))
        if head.get("X-Upload-Content-Type") != "video/mp4":
            return self._refuse("X-Upload-Content-Type was %r"
                                % head.get("X-Upload-Content-Type"))
        told = head.get("X-Upload-Content-Length") or ""
        if not told.isdigit():
            return self._refuse("X-Upload-Content-Length was %r" % told)
        # The query is not decoration. Without uploadType=resumable this is a different
        # endpoint that wants the whole file in the POST, and part decides which fields of
        # the resource are read at all. The fixture lifts it off the production constant,
        # so what is checked here is the real one.
        query = urllib.parse.parse_qs(urllib.parse.urlsplit(self.path).query)
        if query.get("uploadType") != ["resumable"]:
            return self._refuse("uploadType was %r" % query.get("uploadType"))
        if query.get("part") != ["snippet,status"]:
            return self._refuse("part was %r" % query.get("part"))
        try:
            want = json.loads(raw)
        except ValueError:
            return self._refuse("the body was not JSON")
        if "snippet" not in want or "status" not in want:
            return self._refuse("the body held %s" % sorted(want))
        note["body"] = want
        note["declared"] = int(told)

        self.stand.declared = int(told)
        self.stand.sessions += 1
        where = "http://127.0.0.1:%d/session/%d" % (self.server.server_address[1],
                                                    self.stand.sessions)
        self._say(200, "OK", {},
                  [] if self.stand.no_location else [("Location", where)])
    def do_PUT(self):
        length = int(self.headers.get("Content-Length") or 0)
        got_range = self.headers.get("Content-Range") or ""
        if got_range.startswith("bytes */"):
            return self._how_far(got_range)
        self._take(length, got_range)

    def _how_far(self, got_range):
        """The "what have you got" query, answered the way Google answers it.

        308 with a Range when there is something, 308 with no Range at all when there is
        nothing, and the finished video resource when the last byte already arrived.

        No Location header on the 308, ever. urllib.request gained http_error_308 in 3.11
        and this runs on 3.13, so a Location here would be followed and the query would
        become a PUT at whatever address it named. Google's 308 does not carry one either,
        which is why this arrives as an HTTPError at all.
        """
        self.stand.puts.append("query " + got_range)
        if self.stand.forgotten:
            return self._say(404, "Not Found",
                             {"error": {"message": "session not found"}})
        if self.stand.complete:
            return self._say(200, "OK", self.stand.resource())
        if not self.stand.banked:
            return self._say(308, "Resume Incomplete")
        self._say(308, "Resume Incomplete", None,
                  [("Range", "bytes=0-%d" % (len(self.stand.banked) - 1))])

    def _take(self, length, got_range):
        """The PUT that carries bytes."""
        token = (self.headers.get("Authorization") or "")[len("Bearer "):]
        start = len(self.stand.banked)
        self.stand.puts.append(got_range or "fresh")
        self.stand.carried.append(token)

        if got_range:
            # The off by one is the reason this check exists. A Range header's end is
            # inclusive, so picking up at that number rather than one past it repeats a
            # byte, and YouTube rejects the whole range rather than the byte.
            want = "bytes %d-%d/%d" % (start, self.stand.declared - 1,
                                       self.stand.declared)
            if got_range != want:
                return self._refuse("Content-Range was %r, expected %r"
                                    % (got_range, want))
        elif start:
            return self._refuse("a PUT arrived with no Content-Range and %d bytes are "
                                "already here, so the file is being sent again" % start)
        if length != self.stand.declared - start:
            return self._refuse("Content-Length was %d, expected %d"
                                % (length, self.stand.declared - start))

        if self.stand.kill_one_token and token not in self.stand.dead:
            self.stand.kill_one_token = False
            self.stand.dead.add(token)
            self.stand.live.discard(token)
        if token in self.stand.dead or token not in self.stand.live:
            # Read the body first, so the client gets a clean 401 rather than a reset it
            # would read as a dropped connection and treat as something else entirely.
            self._read_body(length)
            return self._say(401, "Unauthorized", self.stand.denied(token))
        if self.stand.fail_once:
            self.stand.fail_once = False
            self._read_body(length)
            # Nothing is banked. A 500 from the front of Google's upload path is the case
            # where the bytes never reached the session, which is exactly why the module
            # has to ask before it re-sends instead of assuming either way.
            return self._say(500, "Internal Server Error",
                             {"error": {"message": "Backend Error"}})

        body = self._read_body(length, self.stand.cut_after)
        self.stand.banked += body
        if self.stand.cut_after is not None:
            self.stand.cut_after = None
            return self._cut()
        if len(body) < length:
            # The client stopped sending. There is nobody left to answer, and saying so
            # here is what the cancel test asserts on.
            self.stand.abandoned += 1
            self.close_connection = True
            return
        self.stand.complete = True
        if self.stand.cut_at_end:
            # The one that puts a song on a channel twice: every byte arrived, the video
            # exists, and the reply never made it back.
            self.stand.cut_at_end = False
            return self._cut()
        self._say(200, "OK", self.stand.resource())


def start():
    """A stand in on a real socket. Returns (stand, base url, stop)."""
    srv = ThreadingHTTPServer(("127.0.0.1", 0), _Handler)
    srv.stand = Stand()
    threading.Thread(target=srv.serve_forever, daemon=True).start()

    def stop():
        srv.shutdown()
        srv.server_close()

    return srv.stand, "http://127.0.0.1:%d" % srv.server_address[1], stop
