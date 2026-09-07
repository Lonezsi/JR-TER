"""Which version of a song went up, where it lives, and getting it there.

Two halves. The first is a record: which version you published, so that six renders later
you can still tell what is actually online, which is not recoverable from anywhere else.

The second is the upload itself, and it is worth being exact about what it can and cannot
do. Uploading acts as you, so it needs an OAuth client that belongs to you: there is no
way to ship one inside an app, and a client secret in a public repository is a secret in
name only. You make a Google Cloud project, switch on the YouTube Data API, and paste the
two values in. They are stored on your own server.

There are two ways to sign in and both are here.

The first is the one the rest of the web uses: press a button, pick an account in
Google's own chooser, come back signed in. It needs a redirect address registered on the
client in advance, and this library answers at a different address depending on whether
you are at the machine, on the tailnet, or on a phone through the funnel. That is why it
was not here at first. It works now because the address is derived from the request that
started the sign in rather than written down, so whichever of the three you are on is the
one Google is told, and the page shows you all of them to register.

The second is the device flow, the one a television uses: a short code you type into
google.com on any device. It is kept, and not only as a fallback. It is the right answer
whenever the browser is not on the same machine as the server, which on a headless host
is every time, and it needs no redirect address registered at all.

One limit that is Google's and not ours, and which cannot be worked around: until they
have audited your project, everything it uploads is forced to private whatever you ask
for. Uploads still work; they are just not public until the audit.
"""
import os
import json
import time
import shutil
import secrets
import threading
import urllib.error
import urllib.parse
import urllib.request

from .. import db, config, blobs, registry, video, audio_meta, problems
from ..wire import Error, Response, need, as_int
from . import songs

#: Google's endpoints. The browser flow and the device flow, then the token, then the
#: upload.
AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
DEVICE_URL = "https://oauth2.googleapis.com/device/code"
TOKEN_URL = "https://oauth2.googleapis.com/token"
UPLOAD_URL = ("https://www.googleapis.com/upload/youtube/v3/videos"
              "?uploadType=resumable&part=snippet,status")
CHANNEL_URL = "https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true"

#: The narrowest scope that can upload. Not youtube.force-ssl, which can also delete.
SCOPE = "https://www.googleapis.com/auth/youtube.upload"

#: Where the account lives. Beside the library rather than in it, because it is a
#: credential: a database that gets copied about for a backup should not carry one.
def _account_path():
    return os.path.join(config.DATA, "youtube.json")

NAME = "youtube"

SCHEMA = [
    """
    CREATE TABLE IF NOT EXISTS youtube_posts (
      id         INTEGER PRIMARY KEY,
      song_id    INTEGER NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
      version_id INTEGER,
      url        TEXT NOT NULL DEFAULT '',
      title      TEXT NOT NULL DEFAULT '',
      status     TEXT NOT NULL DEFAULT 'published',
      note       TEXT NOT NULL DEFAULT '',
      created_at REAL NOT NULL,
      updated_at REAL NOT NULL
    )
    """,
    "CREATE INDEX IF NOT EXISTS youtube_song ON youtube_posts(song_id)",
]

STATUSES = ("draft", "scheduled", "published", "unlisted", "private", "removed")


def _add_upload_columns():
    """What JR!TER knows when it sent the file itself.

    A link says which video. These say which bytes: mix_digest is the sha of the wav that
    was auditioned and uploaded, so "is this the render that is online" stops being a
    question about version numbers and becomes one you can answer exactly. video_id is
    kept apart from the url because the url is a field a person may have typed by hand.
    """
    db.add_column_if_missing("youtube_posts", "video_id", "TEXT NOT NULL DEFAULT ''")
    db.add_column_if_missing("youtube_posts", "mix_digest", "TEXT NOT NULL DEFAULT ''")


#: Named steps, each run once ever and recorded by name. See jriter/registry.py.
MIGRATE = [
    ("what_jriter_uploaded", _add_upload_columns),
]


def get(post_id):
    row = db.one("SELECT * FROM youtube_posts WHERE id = ?", (post_id,))
    if not row:
        raise Error("no YouTube entry with id %s" % post_id, 404)
    return row


def _decorate(rows):
    from .. import registry
    if not registry.has("versions"):
        return rows
    for row in rows:
        if not row["version_id"]:
            row["version_n"] = None
            continue
        version = db.one("SELECT n FROM versions WHERE id = ?", (row["version_id"],))
        # A version can be deleted after it was published, and the entry should say so
        # rather than quietly showing nothing.
        row["version_n"] = version["n"] if version else None
        row["version_missing"] = version is None
    return rows


def list_posts(req):
    song = songs.get(req.params["id"])
    rows = db.query("SELECT * FROM youtube_posts WHERE song_id = ? ORDER BY id DESC",
                    (song["id"],))
    return {"posts": _decorate(rows)}


def _add_post(song_id, **fields):
    """Write one row. Pulled out of create_post because the upload worker has no Request
    and calling a route handler from a thread by faking one is how you end up with two
    ways to write the same row that disagree about defaults."""
    status = fields.get("status", "published")
    if status not in STATUSES:
        raise Error("status must be one of: " + ", ".join(STATUSES))
    now = time.time()
    post_id = db.insert("youtube_posts", {
        "song_id": song_id, "version_id": fields.get("version_id"),
        "url": (fields.get("url") or "").strip(),
        "title": (fields.get("title") or "").strip(),
        "status": status, "note": fields.get("note", ""),
        "video_id": fields.get("video_id", ""),
        "mix_digest": fields.get("mix_digest", ""),
        "created_at": now, "updated_at": now})
    songs.touch(song_id)
    return get(post_id)


def create_post(req):
    song = songs.get(req.params["id"])
    data = req.json()
    return {"post": _decorate([_add_post(song["id"], **data)])[0]}


def update_post(req):
    post = get(req.params["id"])
    data = req.json()
    patch = {}
    for field in ("url", "title", "note"):
        if field in data:
            patch[field] = (data[field] or "").strip()
    if "version_id" in data:
        patch["version_id"] = data["version_id"]
    if "status" in data:
        if data["status"] not in STATUSES:
            raise Error("status must be one of: " + ", ".join(STATUSES))
        patch["status"] = data["status"]
    patch["updated_at"] = time.time()
    db.update("youtube_posts", post["id"], patch)
    return {"post": _decorate([get(post["id"])])[0]}


def delete_post(req):
    post = get(req.params["id"])
    db.run("DELETE FROM youtube_posts WHERE id = ?", (post["id"],))
    return {"deleted": post["id"]}


# ── the account ──────────────────────────────────────────────────────────────

def _account(default=None):
    try:
        with open(_account_path(), "r", encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return dict(default or {})


def _save_account(data):
    path = _account_path()
    config.ensure_dirs()
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
    os.replace(tmp, path)
    try:
        os.chmod(path, 0o600)
    except OSError:
        pass


def _post_form(url, fields):
    body = urllib.parse.urlencode(fields).encode("utf-8")
    request = urllib.request.Request(url, data=body, method="POST", headers={
        "Content-Type": "application/x-www-form-urlencoded"})
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", "ignore")
        try:
            said = json.loads(detail)
        except ValueError:
            said = {"error": detail[:200]}
        # Google's "still waiting" is an HTTP error, not an answer, so it is handed back
        # rather than raised: the caller is polling and this is the normal case.
        said["_status"] = e.code
        return said
    except urllib.error.URLError as e:
        raise Error("Google could not be reached: %s" % e.reason, 502)


def _all():
    """Every account, and which one is chosen.

    Kept as a map rather than one record because a person has more than one channel:
    their own, the band's, an alias. Choosing between them at upload time is the whole
    point, and a single slot meant disconnecting one to use another.

    An older file holding a single account is folded in on read, so nothing has to be
    reconnected.
    """
    held = _account()
    if "accounts" not in held and held.get("refresh_token"):
        # The shape before there could be more than one.
        moved = dict(held)
        moved["name"] = moved.get("channel") or "your channel"
        held = {"accounts": {"first": moved}, "chosen": "first"}
        _save_account(held)
    held.setdefault("accounts", {})
    return held


def _chosen():
    held = _all()
    at = held.get("chosen")
    if at and at in held["accounts"]:
        return at, held["accounts"][at]
    # One account and nothing chosen is not an ambiguity worth an error.
    if len(held["accounts"]) == 1:
        only = next(iter(held["accounts"]))
        return only, held["accounts"][only]
    return None, None


def _public(entry):
    """What the browser is allowed to know. Never the secret, never the tokens."""
    return {"name": entry.get("name") or entry.get("channel") or "a channel",
            "channel": entry.get("channel"),
            # Whether there is a picture, never where it is.
            "has_avatar": bool(entry.get("avatar_url")),
            "connected_at": entry.get("connected_at")}


def account_state(req):
    held = _all()
    at, _ = _chosen()
    return {
        "accounts": [dict(_public(v), id=k) for k, v in sorted(held["accounts"].items())],
        "chosen": at,
        "connected": bool(held["accounts"]),
        # Said here as well as on the page, because it changes what "public" means.
        "unaudited": True,
    }


#: How long a cached channel picture is trusted before it is fetched again.
#:
#: A day. The picture almost never changes and re-fetching it on every page load would be
#: a request to Google every time somebody opens the library, which is exactly what serving
#: it from here is meant to avoid.
AVATAR_MAX_AGE = 86400


#: Where Google actually serves channel pictures from.
#:
#: Checked before the server fetches anything, because this is the one place in JR!TER that
#: opens a URL read out of a file. The account key is derived from a channel title, and a
#: channel title is whatever somebody typed into YouTube, so neither the address nor the
#: filename below is trusted just because it came from our own data directory.
AVATAR_HOSTS = ("ggpht.com", "googleusercontent.com")


def _avatar_cache(key):
    # The key comes from a channel name, so it is scrubbed to letters and digits before it
    # is any part of a path. A channel called "../../auth" is a perfectly legal channel.
    safe = "".join(c if c.isalnum() or c in "-_" else "_" for c in str(key))[:60] or "one"
    return os.path.join(config.DATA, "youtube", "avatar-%s" % safe)


def _may_fetch(url):
    """Is this an address a channel picture is actually served from."""
    try:
        bits = urllib.parse.urlsplit(url or "")
    except ValueError:
        return False
    if bits.scheme != "https" or not bits.hostname:
        return False
    host = bits.hostname.lower()
    return any(host == good or host.endswith("." + good) for good in AVATAR_HOSTS)


def avatar(req):
    """The chosen channel's picture, fetched by JR!TER and served from JR!TER.

    The obvious way to do this is to put Google's own URL in the page and let the browser
    fetch it. That would mean every load of the library is a request to a Google host from
    the person's own browser, carrying their address and the fact that they are using this
    app, for a 32 pixel circle. So the server fetches it, keeps it next to the account it
    belongs to, and the browser only ever talks to this library.

    A missing picture is a 404 and not an error: the rail draws a letter instead, which is
    what it does for an account that never had one.
    """
    key, entry = _chosen()
    if not entry or not entry.get("avatar_url"):
        raise Error("no picture for this account", 404)
    if not _may_fetch(entry["avatar_url"]):
        # Not an error worth showing anybody: the rail falls back to a letter. But it is
        # emphatically not a URL this server is going to open.
        raise Error("no picture for this account", 404)

    cached = _avatar_cache(key)
    fresh = (os.path.isfile(cached)
             and time.time() - os.path.getmtime(cached) < AVATAR_MAX_AGE)
    if not fresh:
        try:
            config.ensure_dirs()
            os.makedirs(os.path.dirname(cached), exist_ok=True)
            request = urllib.request.Request(
                entry["avatar_url"], headers={"User-Agent": "JR!TER"})
            with urllib.request.urlopen(request, timeout=15) as response:
                blob = response.read(2 * 1024 * 1024)
            tmp = cached + ".tmp"
            with open(tmp, "wb") as f:
                f.write(blob)
            os.replace(tmp, cached)
        except Exception:
            # A stale picture beats no picture, and no picture beats a 500.
            if not os.path.isfile(cached):
                raise Error("the picture could not be fetched", 404)

    # Sniffed from the bytes rather than taken from the URL, which carries a size and no
    # extension. The three letters rather than the whole four byte signature: the first of
    # those bytes is 0x89, and a non ASCII escape written through a shell heredoc arrives
    # as the character U+0089, which is not a byte and will not compile.
    with open(cached, "rb") as f:
        head = f.read(4)
    kind = "image/png" if head[1:4] == b"PNG" else "image/jpeg"
    return Response(path=cached, content_type=kind,
                    headers={"Cache-Control": "private, max-age=3600"})


def choose_account(req):
    held = _all()
    want = need(req.json(), "id")
    if want not in held["accounts"]:
        raise Error("no account with id %s" % want, 404)
    held["chosen"] = want
    _save_account(held)
    return account_state(req)


#: The path Google is told to come back to. One path, whatever address you reached this
#: library at; the address itself is worked out per request below.
RETURN_PATH = "/api/youtube/auth/return"


def _return_to(req):
    """The address the browser making this request would come back to.

    Built from the Host header rather than written down, because this library answers on
    three addresses and which one you are on decides which one Google has to be told:
    127.0.0.1 at the machine, the tailnet name from another of your own devices, and the
    funnel name from a phone. A redirect address is registered in advance and matched
    exactly, so one hard coded value would work from one of those and fail from the other
    two. That is the reason the device flow was the only flow here for a while.

    The Host header is somebody else's to set, and it is safe here for one reason worth
    stating plainly: this value is only ever handed to Google, who compares it against
    the list on your own OAuth client and refuses anything not on it. It is never used to
    build a URL this server sends a browser to.
    """
    host = (req.headers.get("Host") or "").strip()
    if not host or "/" in host or "\\" in host:
        raise Error("This request carried no usable address to come back to.")
    # A proxy that has already terminated TLS says so. Otherwise the loopback is plain
    # and anything else is not.
    said = (req.headers.get("X-Forwarded-Proto") or "").lower()
    if said in ("http", "https"):
        scheme = said
    else:
        bare = host.split(":")[0].lower()
        scheme = "http" if bare in ("127.0.0.1", "localhost", "[::1]") else "https"
    return "%s://%s%s" % (scheme, host, RETURN_PATH)


def auth_addresses(req):
    """The addresses to put on the OAuth client, and the one this request would use.

    Handed to the page so it can show them rather than describe them. Getting one
    character wrong here is the likeliest way for this to fail, and the message Google
    gives names the address it expected, which is the one thing it cannot know.
    """
    here = _return_to(req)
    port = config.PORT
    register = [here]
    for guess in ("http://127.0.0.1:%d%s" % (port, RETURN_PATH),
                  "http://localhost:%d%s" % (port, RETURN_PATH)):
        if guess not in register:
            register.append(guess)
    return {"here": here, "register": register, "path": RETURN_PATH}


def auth_start(req):
    """Begin the browser sign in. Returns the Google URL to send the person to.

    The flow the rest of the web uses: one press, Google's own account chooser, and back
    here signed in. The device flow underneath is still there and is still the right
    answer when the browser is not on the same machine as the server, which on a headless
    host is every time.
    """
    data = req.json()
    client_id = need(data, "client_id").strip()
    client_secret = need(data, "client_secret").strip()
    back = _return_to(req)

    held = _all()
    # Single use, and checked on the way back in. Without it, anybody who can get your
    # browser to load this server's return path carrying a code of their own has attached
    # their account to your library.
    state = secrets.token_urlsafe(24)
    held["pending"] = {"kind": "redirect", "state": state,
                       "client_id": client_id, "client_secret": client_secret,
                       "redirect_uri": back, "started_at": time.time(),
                       "name": (data.get("name") or "").strip()}
    _save_account(held)

    where = AUTH_URL + "?" + urllib.parse.urlencode({
        "client_id": client_id,
        "redirect_uri": back,
        "response_type": "code",
        "scope": SCOPE,
        "state": state,
        # Without these two, Google hands back an access token and no refresh token on
        # every sign in after the first, and this library has to be able to upload next
        # week without asking again.
        "access_type": "offline",
        "prompt": "consent",
        "include_granted_scopes": "true",
    })
    return {"url": where, "redirect_uri": back}


def auth_return(req):
    """Where Google sends the browser back to. A person lands here, not a script.

    Behind the door like everything else, which works because the session cookie is
    SameSite=Lax and this is a top level GET navigation, the one cross site case Lax
    still sends a cookie for. It has to be behind the door: completing this attaches an
    account that can post to a channel.
    """
    held = _all()
    waiting = held.get("pending") or {}

    def back_to_page(message):
        # The path is written here rather than built from anything in the request.
        return Response(status=302, headers={
            # The library, not the upload page. That one is a screen of one song and
            # this return knows nothing about a song; boot reads the message off the
            # query wherever it lands and clears it.
            "Location": "/#/?connect=" + urllib.parse.quote(message)})

    if waiting.get("kind") != "redirect":
        return back_to_page("Nothing was waiting to be connected. Start again.")

    said = req.q("state") or ""
    code = req.q("code") or ""
    refused = req.q("error") or ""
    # Spent either way: a state that has been answered once cannot be answered again.
    held.pop("pending", None)
    _save_account(held)

    ok = bool(waiting.get("state")) and secrets.compare_digest(said, waiting["state"])
    if not ok:
        return back_to_page("That sign in did not match the one this library started.")
    if refused:
        return back_to_page("Google refused: " + refused)
    if not code:
        return back_to_page("Google came back without a code.")

    got = _post_form(TOKEN_URL, {
        "client_id": waiting["client_id"], "client_secret": waiting["client_secret"],
        "code": code, "grant_type": "authorization_code",
        "redirect_uri": waiting["redirect_uri"]})
    if "refresh_token" not in got:
        # Never the response itself: when it carries anything it carries a token.
        return back_to_page(got.get("error_description")
                            or got.get("error") or "that did not complete")

    _land_account(held, waiting, got)
    return back_to_page("connected")


def _land_account(held, waiting, said):
    """Store a completed sign in.

    Shared by both flows, because past the token exchange there is no difference between
    them: the same three values arrive and the same entry is written.
    """
    channel, picture = _channel(said.get("access_token"))
    entry = {
        "client_id": waiting["client_id"], "client_secret": waiting["client_secret"],
        "refresh_token": said["refresh_token"],
        "access_token": said.get("access_token"),
        "expires_at": time.time() + said.get("expires_in", 3600) - 60,
        "connected_at": time.time(),
        "channel": channel,
        "name": waiting.get("name") or channel or "a channel",
        # Where the picture lives, kept server side and never handed to the browser. The
        # page asks JR!TER for the image and JR!TER is the only thing that talks to Google
        # about it, so opening the library does not tell Google you opened it.
        "avatar_url": picture,
    }
    # Keyed by the channel where there is one, so signing the same channel in twice
    # replaces it rather than leaving two entries that look identical.
    key = (channel or ("account-%d" % int(time.time()))).lower().replace(" ", "-")[:60]
    held["accounts"][key] = entry
    held["chosen"] = key
    held.pop("pending", None)
    _save_account(held)
    return key, channel


def connect(req):
    """Start signing in with a code instead.

    The fallback, and still the only one that works when the browser is not on the same
    machine as the server, which on a headless host is every time."""
    data = req.json()
    client_id = need(data, "client_id").strip()
    client_secret = need(data, "client_secret").strip()

    said = _post_form(DEVICE_URL, {"client_id": client_id, "scope": SCOPE})
    if "device_code" not in said:
        raise Error("Google refused those credentials: %s"
                    % (said.get("error_description") or said.get("error", "no reason given")))

    held = _all()
    # Held apart from the accounts until it completes, so a sign in that is abandoned
    # halfway leaves the ones that already work alone.
    held["pending"] = {"client_id": client_id, "client_secret": client_secret,
                       "device_code": said["device_code"], "started_at": time.time(),
                       "name": (data.get("name") or "").strip()}
    _save_account(held)
    return {"user_code": said.get("user_code"),
            "verification_url": said.get("verification_url")
                                or said.get("verification_uri"),
            "expires_in": said.get("expires_in", 900)}


def finish(req):
    """Exchange the device code for a refresh token, once the code has been entered."""
    held = _all()
    waiting = held.get("pending")
    if not waiting:
        raise Error("Nothing is waiting to be connected. Start again.")
    # A browser sign in leaves a pending entry too, and it has no device code in it.
    # Without this the next poll of this endpoint is a KeyError rather than a sentence.
    if waiting.get("kind") == "redirect":
        raise Error("That sign in is happening in the browser. Finish it there.", 409)

    said = _post_form(TOKEN_URL, {
        "client_id": waiting["client_id"], "client_secret": waiting["client_secret"],
        "device_code": waiting["device_code"],
        "grant_type": "urn:ietf:params:oauth:grant-type:device_code"})

    if said.get("error") == "authorization_pending":
        raise Error("Google has not seen the code yet. Enter it, then try again.", 409)
    if "refresh_token" not in said:
        raise Error("That did not complete: %s"
                    % (said.get("error_description") or said.get("error", "no reason")))

    key, channel = _land_account(held, waiting, said)
    return {"connected": True, "channel": channel, "id": key}


def _channel(access_token):
    """The channel's name and the address of its picture, or (None, None).

    One call for both, because the request already asks for part=snippet and the picture
    was sitting in the answer being thrown away.
    """
    if not access_token:
        return None, None
    request = urllib.request.Request(CHANNEL_URL, headers={
        "Authorization": "Bearer " + access_token})
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            items = json.loads(response.read().decode("utf-8")).get("items") or []
        if not items:
            return None, None
        snippet = items[0].get("snippet") or {}
        thumbs = snippet.get("thumbnails") or {}
        picture = ((thumbs.get("default") or {}).get("url")
                   or (thumbs.get("medium") or {}).get("url"))
        return snippet.get("title"), picture
    except Exception:
        return None, None    # a name is a nicety; not having it is not a failure


def _channel_name(access_token):
    return _channel(access_token)[0]


def _forget_access_token():
    """Drop the token being held, so the next ask is a real refresh.

    _access_token hands back what it holds while its own clock says it is good, which is
    right everywhere except here. A 401 mid upload means Google stopped taking that token
    before its expiry, and asking again without saying so returned the same dead string
    six times and called it "the upload kept breaking".
    """
    held = _all()
    at, entry = _chosen()
    if not entry:
        return
    entry.pop("access_token", None)
    entry["expires_at"] = 0
    held["accounts"][at] = entry
    _save_account(held)


def _access_token():
    """A live token for the chosen account, refreshed if the one held has expired."""
    held = _all()
    at, entry = _chosen()
    if not entry:
        raise Error("No YouTube account is chosen.", 409)
    if entry.get("access_token") and entry.get("expires_at", 0) > time.time():
        return entry["access_token"]

    said = _post_form(TOKEN_URL, {
        "client_id": entry["client_id"], "client_secret": entry["client_secret"],
        "refresh_token": entry["refresh_token"], "grant_type": "refresh_token"})
    if "access_token" not in said:
        raise Error("That account needs connecting again: %s"
                    % (said.get("error_description") or said.get("error", "no reason")), 401)
    entry["access_token"] = said["access_token"]
    entry["expires_at"] = time.time() + said.get("expires_in", 3600) - 60
    held["accounts"][at] = entry
    _save_account(held)
    return entry["access_token"]


def disconnect(req):
    """Forget one account. Nothing already uploaded is touched."""
    held = _all()
    want = req.params.get("id")
    if want:
        held["accounts"].pop(want, None)
        if held.get("chosen") == want:
            held["chosen"] = next(iter(held["accounts"]), None)
        _save_account(held)
    else:
        try:
            os.remove(_account_path())
        except OSError:
            pass
    return account_state(req)



#: Where the working files live while a job runs. Beside the library rather than in it,
#: like data/youtube.json and data/appearance: these are scratch, not content, and a
#: backup of the library should not carry a half made video.
def _work_dir():
    return os.path.join(config.DATA, "youtube", "work")


#: One job at a time, in memory, behind a lock. The shape is problems.py's, and so is the
#: reasoning: a small amount of state one thread writes and the page reads, kept off the
#: database because there is nothing here worth a row and nothing to prune.
#:
#: The cost is the one problems.py names out loud, and here it is larger. A restart takes
#: the job with it, and a restart is exactly what the host watchdog does when two health
#: probes miss. So the part that cannot be recreated, the session URI and how much of the
#: file YouTube already holds, is also written to work/<id>.json as it changes. That does
#: not resume anything by itself. It means a restarted server can say an upload was in
#: flight and go and ask what became of it, rather than pretending nothing happened.
_lock = threading.Lock()
_job = None

STEPS = {"fetching": "getting ffmpeg",
         "encoding": "making the video",
         "uploading": "sending it to YouTube"}

#: The states a job is still in the middle of. Named once, because it was three literal
#: tuples in three places before there was a third state, and the one that gets forgotten
#: is always the poll's, which then stops watching a job that is still running.
RUNNING = ("fetching", "encoding", "uploading")

#: How the one bar is divided when there is an ffmpeg to fetch first.
#:
#: The fetch only ever happens on a machine that has never made a video, so the encode
#: and the upload cannot keep fixed places on the bar: they share what is left of it, in
#: the proportion they always had. The alternative is a second bar, or a bar that fills
#: and starts again, and both tell a person the job finished when it has not.
FETCH_SHARE = 0.30


def _new_job(song, version_id, digest):
    global _job
    with _lock:
        if _job and _job["state"] in RUNNING:
            raise Error("JR!TER is already uploading %s. One at a time."
                        % _job["song_title"], 409)
        _job = {
            "id": "%x" % int(time.time() * 1000),
            "song_id": song["id"], "song_title": song["title"],
            "version_id": version_id, "mix_digest": digest,
            "state": "encoding", "step": STEPS["encoding"], "at": 0.0,
            "sent": 0, "total": 0,
            "video_id": "", "url": "", "privacy_asked": "", "privacy_got": "",
            "error": "", "fix": "", "log": [],
            "session": "", "started_at": time.time(), "finished_at": 0.0,
            "cancel": False,
        }
        return dict(_job)


def _note(**patch):
    """Update the job. Returns whether it has been asked to stop, so every long loop can
    check the same thing in the same place."""
    with _lock:
        if not _job:
            return True
        _job.update(patch)
        return _job["cancel"]


#: What the page is allowed to see, by name.
#:
#: A list of what to hide was the other way round and got it wrong as soon as a field was
#: added: the session URI was only off the page because somebody remembered to name it,
#: and it is a bearer URL, so anything holding it can PUT a video onto the channel.
SHOWN = ("id", "song_id", "song_title", "version_id", "mix_digest", "state", "step",
         "at", "sent", "total", "video_id", "url", "privacy_asked", "privacy_got",
         "error", "fix", "log", "started_at", "finished_at")


def _public_job():
    with _lock:
        if not _job:
            return None
        out = {k: _job[k] for k in SHOWN if k in _job}
        out["log"] = out.get("log", [])[-20:]
        return out


def job_state(req):
    return {"job": _public_job()}


def cancel_job(req):
    """Stop. Honest about what stopping means once the bytes are moving."""
    with _lock:
        if not _job or _job["state"] not in RUNNING:
            raise Error("Nothing is running.", 409)
        _job["cancel"] = True
    return {"job": _public_job()}

def _stopped(room):
    """Asked to stop. Nothing was published, and the working files go."""
    shutil.rmtree(room, ignore_errors=True)
    _note(state="stopped", step="stopped", error="", fix="", finished_at=time.time())
    return None


def _failed(message, fix, tail, room, keep=False):
    """One way out for everything that goes wrong, so no path can fail quietly.

    The working files are kept on a real failure, because the video that ffmpeg did or
    did not write is the evidence, and deleting it is how you get a bug report that says
    only "it did not work". _prune_old_work takes them later.
    """
    if not keep:
        shutil.rmtree(room, ignore_errors=True)
    with _lock:
        log = (_job or {}).get("log", [])
    _note(state="failed", step="stopped", error=message, fix=fix,
          log=(log + tail)[-40:], finished_at=time.time())
    return None


def _remember_on_disk(job_id):
    """The one part of the job that cannot be worked out again after a restart.

    The host kills this process whenever two health probes miss, so a restart during an
    upload is ordinary rather than exceptional. This does not resume anything by itself.
    It means a restarted server can say an upload was in flight and where to go and ask
    what became of it, instead of pretending nothing happened.
    """
    with _lock:
        if not _job:
            return
        note = {"id": _job["id"], "song_id": _job["song_id"],
                "song_title": _job["song_title"], "session": _job["session"],
                "sent": _job["sent"], "total": _job["total"],
                "mix_digest": _job["mix_digest"], "at": time.time()}
    try:
        os.makedirs(_work_dir(), exist_ok=True)
        path = os.path.join(_work_dir(), note["id"] + ".json")
        with open(path, "w", encoding="utf-8") as f:
            json.dump(note, f, indent=2)
    except OSError:
        pass          # a note that cannot be written is not a reason to stop an upload


#: A week. Long enough that a failure is still there to look at on Monday, short enough
#: that a library does not quietly accumulate half made videos for ever.
KEEP_WORK = 7 * 24 * 3600


def _prune_old_work():
    """Take away what earlier jobs left, before starting another.

    Here rather than on a timer, because this is the one moment the answer matters and a
    timer is another thing that runs for ever on a machine nobody is sitting at.
    """
    room = _work_dir()
    if not os.path.isdir(room):
        return
    cutoff = time.time() - KEEP_WORK
    for name in os.listdir(room):
        path = os.path.join(room, name)
        try:
            if os.path.getmtime(path) > cutoff:
                continue
            if os.path.isdir(path):
                shutil.rmtree(path, ignore_errors=True)
            else:
                os.remove(path)
        except OSError:
            pass


#: Google's own backoff for this endpoint. Five tries covers a tunnel that drops for a
#: minute and does not sit there for an hour when the network is simply gone.
BACKOFF = (1, 2, 4, 8, 16)

#: What a video costs against the default 10000 unit daily quota, so the message about
#: running out can say what it means rather than "quota exceeded".
UPLOAD_COST = 1600


def _google_said(e):
    """Google's own words out of an HTTPError body, because they are nearly always more
    use than anything written about them here. Same trick as _post_form."""
    raw = e.read().decode("utf-8", "ignore")
    try:
        said = json.loads(raw).get("error", {})
    except ValueError:
        return "YouTube answered %d: %s" % (e.code, raw[:200])
    reasons = [d.get("reason", "") for d in said.get("errors", [])]
    if "quotaExceeded" in reasons or "uploadLimitExceeded" in reasons:
        return ("This Google project has used its upload quota for the day. A video costs "
                "%d of the 10000 units a project gets, so it is six a day, and it resets "
                "at midnight Pacific." % UPLOAD_COST)
    if "youtubeSignupRequired" in reasons:
        return "That Google account has no YouTube channel on it yet."
    return "YouTube refused it: %s" % (said.get("message") or raw[:200])


class Stopped(Exception):
    """Asked to stop while the bytes were moving.

    Its own type rather than anything else, because caught as an ordinary Exception it
    becomes a recorded problem and a job the page paints red, which is a lie about
    something the person did on purpose.
    """


class _Counting:
    """The file, wrapped so the job can say how far the upload has got.

    urllib streams a body straight off any object with a read(), which is the only way to
    send a video without holding it in memory, and there is no progress callback anywhere
    in urllib, so counting has to happen where the bytes are actually handed over.

    http.client asks for 8192 at a time, so this runs about fourteen hundred times for an
    eleven megabyte video. Each call is a dict update under a lock, so it is microseconds,
    but it is why the page polls once a second instead of the job pushing anything.
    """

    def __init__(self, handle, seen):
        self._handle = handle
        self._seen = seen

    def read(self, size=-1):
        chunk = self._handle.read(65536 if size is None or size < 0 else size)
        if chunk and self._seen(len(chunk)):
            # _seen returns whether the job has been asked to stop, the same as every
            # other _note caller. Raising is the only place it can be noticed: http.client
            # is inside a loop over this read() and there is nothing of ours on the stack
            # again until the PUT is over. Before this, stop did not stop an upload, it
            # let it finish and then wrote the row, so the stop button published the song.
            raise Stopped()
        return chunk


def _begin(token, size, snippet, status):
    """Ask for an upload session. Returns the URI to PUT the bytes at."""
    body = json.dumps({"snippet": snippet, "status": status}).encode("utf-8")
    request = urllib.request.Request(UPLOAD_URL, data=body, method="POST", headers={
        "Authorization": "Bearer " + token,
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Length": str(size),
        "X-Upload-Content-Type": "video/mp4"})
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            where = response.headers.get("Location")
    except urllib.error.HTTPError as e:
        raise Error(_google_said(e), 502)
    if not where:
        # Not something to carry on from. Guessing a URI would mean PUTting a video at an
        # address nobody agreed to.
        raise Error("YouTube agreed to the upload and did not say where to send it. "
                    "Nothing has been uploaded. Try again.", 502)
    return where


def _readable(raw):
    """A finished video resource, or a refusal to guess.

    _put has this guard and _how_far did not, so a session that said it was done with a
    body this cannot read arrived at _land as resource["id"] and a KeyError, and the
    person was handed an error reference instead of being told to go and look.
    """
    try:
        video = json.loads((raw or b"").decode("utf-8", "ignore"))
    except ValueError:
        video = None
    if not video or not video.get("id"):
        raise Error("YouTube says this upload finished and then sent a reply JR!TER "
                    "could not read. Check your channel before uploading it again.", 502)
    return video


def _how_far(uri, total):
    """Ask the session how much it already has, after something went wrong.

    The answer that matters most is 200 or 201. That means the connection broke after the
    last byte and before the reply, so the video is already on the channel: starting again
    here is exactly how the same song ends up on a channel twice.

    A 308 with no Range header is not an error either. It means YouTube has nothing yet,
    so the answer is zero, and reading a missing header as a failure would turn a fresh
    start into a dead end.
    """
    request = urllib.request.Request(uri, data=b"", method="PUT", headers={
        "Content-Length": "0", "Content-Range": "bytes */%d" % total})
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            return {"done": True, "video": _readable(response.read())}
    except urllib.error.HTTPError as e:
        if e.code in (200, 201):
            return {"done": True, "video": _readable(e.read())}
        if e.code == 308:
            # urllib's redirect handler covers 301, 302, 303 and 307 and not 308, which is
            # why this arrives here as an error rather than being followed into nowhere.
            got = e.headers.get("Range")           # "bytes=0-524287", or not there at all
            if not got:
                return {"done": False, "sent": 0}
            return {"done": False, "sent": int(got.rsplit("-", 1)[-1]) + 1}
        if e.code == 404:
            raise Error("YouTube has forgotten this upload, which sessions do after about "
                        "a week. Nothing was published. Start it again.", 410)
        raise Error(_google_said(e), 502)


def _put(uri, path, sent, total, token, seen):
    """Send from `sent` to the end. Returns the video resource YouTube answers with."""
    headers = {"Content-Type": "video/mp4", "Content-Length": str(total - sent),
               "Authorization": "Bearer " + token}
    if sent:
        headers["Content-Range"] = "bytes %d-%d/%d" % (sent, total - 1, total)
    with open(path, "rb") as handle:
        handle.seek(sent)
        request = urllib.request.Request(uri, data=_Counting(handle, seen),
                                         method="PUT", headers=headers)
        with urllib.request.urlopen(request, timeout=900) as response:
            raw = response.read().decode("utf-8", "ignore")
    try:
        video = json.loads(raw)
    except ValueError:
        video = None
    if not video or not video.get("id"):
        # Not a success, and not something to dress up as one. YouTube took the bytes and
        # said something this cannot read, so there may or may not be a video, and the
        # only honest thing is to send the person to look before they upload it again.
        raise Error("YouTube accepted the file and then sent a reply JR!TER could not "
                    "read. Check your channel before uploading this again.", 502)
    return video


def _still_for(song_id, into):
    """The cover, copied out of the blob store with an extension on it.

    Blobs are named by their hash and have none, and while ffmpeg does probe rather than
    trust an extension, a readable command line is worth one copy of a few hundred
    kilobytes when something has gone wrong and the argv is what you are staring at.
    """
    if not registry.has("artwork"):
        return None
    row = db.one("SELECT * FROM artwork WHERE song_id = ? ORDER BY position, id LIMIT 1",
                 (song_id,))
    if not row:
        return None
    source = blobs.path_for(row["digest"])
    if not os.path.isfile(source):
        return None
    landing = os.path.join(into, "cover" + (row["ext"] or ".jpg"))
    shutil.copyfile(source, landing)
    return landing


def _work(job, song, want):
    """Make the video and send it. Runs on its own thread; nothing here touches a Request."""
    room = os.path.join(_work_dir(), job["id"])
    os.makedirs(room, exist_ok=True)
    floor, span = 0.0, 1.0
    try:
        found = video.find()
        if not found["found"]:
            # Here rather than in start_upload, for the reason the encode is here: this
            # takes minutes, and a request handler that takes minutes is a browser that
            # gives up and a person who has been told nothing. Same job, same lock, same
            # poll and same bar as everything after it, so there is one thing to watch.
            _note(state="fetching", step=STEPS["fetching"], at=0.0,
                  sent=0, total=video.BUILD["size"])
            got = video.fetch(lambda seen, total: _note(
                sent=seen, total=total,
                at=FETCH_SHARE * (seen / float(total or 1))))
            if not got:
                return _stopped(room)
            found = video.find(again=True)
            if not found["found"]:
                # Cannot happen without a bug, and saying so beats encoding with a path
                # that was never checked.
                return _failed("JR!TER fetched ffmpeg to %s and then could not find it."
                               % got, "", [], room, keep=True)
            floor, span = FETCH_SHARE, 1.0 - FETCH_SHARE
            _note(log=job["log"] + ["fetched " + found["version"]], sent=0, total=0)

        tool = found["path"]
        wav = blobs.path_for(job["mix_digest"])
        mp4 = os.path.join(room, "video.mp4")
        seconds = audio_meta.probe(wav, ".wav")["duration"]
        still = None
        cover = _still_for(song["id"], room)
        if cover:
            flat = os.path.join(room, "still.png")
            ok, tail = video.run(video.still_argv(tool, cover, flat), 0, lambda f: None)
            if ok and os.path.isfile(flat):
                still = flat
            else:
                # Not fatal. A cover ffmpeg cannot decode is a reason to fall back to the
                # plain colour, and the job says which it used rather than leaving somebody
                # to wonder why their artwork is not on it.
                _note(log=job["log"] + ["the artwork could not be read, so the video is a "
                                        "plain colour"] + tail[-4:])

        if _note(state="encoding", step=STEPS["encoding"], at=floor):
            return _stopped(room)
        ok, tail = video.run(video.video_argv(tool, still, wav, seconds, mp4), seconds,
                             lambda f: _note(at=floor + span * f * 0.25))
        if not ok:
            fix = video.why_it_failed(tail)
            return _failed("ffmpeg could not make the video.", fix, tail, room, keep=True)

        total = os.path.getsize(mp4)
        _note(state="uploading", step=STEPS["uploading"], at=floor + span * 0.25,
              total=total, sent=0)

        token = _access_token()
        uri = _begin(token, total, want["snippet"], want["status"])
        _note(session=uri)
        _remember_on_disk(job["id"])

        video_resource = _upload_with_retries(uri, mp4, total, job, floor, span)
        _land(job, song, video_resource, room)
    except Stopped:
        return _stopped(room)
    except Error as e:
        _failed(e.message, "", [], room, keep=True)
    except Exception as e:
        # Never swallowed. The traceback goes where every other one goes, and the person
        # gets the reference that lines the two up, the same as an ordinary 500.
        ref = problems.record("/api/youtube/upload", e, "POST")
        _failed("%s: %s" % (type(e).__name__, e),
                "The full error is in Settings under errors, reference %s." % ref,
                [], room, keep=True)


def _upload_with_retries(uri, mp4, total, job, floor=0.0, span=1.0):
    sent = 0
    for attempt, wait in enumerate([0] + list(BACKOFF)):
        if wait:
            time.sleep(wait)
        try:
            token = _access_token()
            def seen(n, _box=[sent]):
                _box[0] += n
                return _note(
                    sent=_box[0],
                    at=floor + span * (0.25 + 0.75 * (_box[0] / float(total))))
            return _put(uri, mp4, sent, total, token, seen)
        except urllib.error.HTTPError as e:
            if e.code == 401:
                # The token ran out mid upload. The session URI is not tied to it, so this
                # is meant to be invisible: throw away the one being held, because
                # _access_token trusts its own clock and Google has just said otherwise.
                #
                # No continue any more. A 401 can arrive after the session has already
                # banked part of the file, and re-sending from a `sent` nothing has
                # checked is a range YouTube rejects. Falling through asks the session,
                # the same as every other way this loop can break.
                _forget_access_token()
            elif e.code not in (500, 502, 503, 504):
                raise Error(_google_said(e), 502)
        except (urllib.error.URLError, OSError) as e:
            _note(step="the connection dropped, picking it up again")
        # Something broke. What was sent so far is the one thing a restarted server
        # cannot work out for itself, and this is the moment it is known and about to be
        # at risk, so it goes to disk before anything else is attempted. It used to be
        # written once, right after the session was opened, so the note always said
        # nought however far the upload had got.
        _remember_on_disk(job["id"])
        # Then ask what YouTube actually has, before sending anything again.
        where = _how_far(uri, total)
        if where["done"]:
            return where["video"]
        sent = where["sent"]
        _note(sent=sent,
              at=floor + span * (0.25 + 0.75 * (sent / float(total))),
              step="picking up at %s of %s" % (sent, total))
        # Written here as well as after _begin, because this is the only moment the number
        # changes in a way a restarted server could not work out for itself. It was called
        # once, so the note always said nought however far the upload had got, while the
        # comment above _lock claimed it was written as it changed.
        _remember_on_disk(job["id"])
    raise Error("The upload kept breaking and JR!TER has stopped trying. Nothing was "
                "published. Check the connection and start it again.", 502)


def _land(job, song, resource, room):
    """It is up. Write the row from what YouTube said, not from what was asked for."""
    got = (resource.get("status") or {}).get("privacyStatus") or "private"
    video_id = resource["id"]
    url = "https://www.youtube.com/watch?v=" + video_id
    _add_post(song["id"],
              version_id=job["version_id"],
              url=url,
              # YouTube trims and normalises a title, so this is its copy and not ours.
              title=(resource.get("snippet") or {}).get("title") or song["title"],
              status="published" if got == "public" else got,
              video_id=video_id,
              mix_digest=job["mix_digest"])
    _note(state="done", at=1.0, step="done", video_id=video_id, url=url,
          privacy_got=got, finished_at=time.time())
    _tidy(room, job["mix_digest"])


def _tidy(room, digest):
    """The working files go, and so does the wav, unless something in the library still
    points at those bytes. That check is versions.delete_version's, including the
    table_exists guard: the renders module can be switched off with its rows still there,
    and taking bytes a render entry needs is exactly the data that being off preserves."""
    shutil.rmtree(room, ignore_errors=True)
    still = db.one("SELECT id FROM versions WHERE digest = ? LIMIT 1", (digest,))
    if not still and db.table_exists("renders"):
        still = db.one("SELECT id FROM renders WHERE digest = ? LIMIT 1", (digest,))
    if not still:
        blobs.delete(digest)


def receive_mix(req):
    """The rendered wav, raw body, same call shape as a render upload.

    It is stored rather than held, because forty two megabytes in memory on a machine
    also running ffmpeg is not a thing to do, and because a content addressed store gives
    back the one thing worth keeping afterwards: the digest of the exact bytes that were
    auditioned.
    """
    songs.get(req.params["id"])
    length = as_int(req.headers.get("Content-Length") or 0, "Content-Length")
    if length <= 0:
        raise Error("no file in that upload")
    digest, size, _ = blobs.put_stream(req.rfile, length)
    meta = audio_meta.probe(blobs.path_for(digest), ".wav")
    if not meta["duration"]:
        raise Error("That did not arrive as a readable wav. Render it again.", 400)
    return {"digest": digest, "size": size, "seconds": meta["duration"]}


def start_upload(req):
    song = songs.get(req.params["id"])
    data = req.json()
    digest = need(data, "digest")
    if not blobs.exists(digest):
        raise Error("That mix is not on the server. Render it and send it again.", 409)

    tool = video.find()
    if not tool["found"]:
        # Not a refusal any more if one can be fetched. The job's first step gets it, and
        # the page watches that on the same bar as the encode and the upload.
        can, why = video.can_install()
        if not can:
            raise Error(why or tool["why"], 409)
    at, _ = _chosen()
    if not at:
        raise Error("No YouTube account is chosen, so there is nowhere to send it.", 409)

    title = (data.get("title") or song["title"]).strip()
    # Checked here rather than left to Google, because a 400 arriving after a forty two
    # megabyte upload and a video encode is a bad way to learn about a bracket.
    if not title:
        raise Error("A title is needed.")
    if len(title) > 100:
        raise Error("YouTube allows 100 characters in a title. That one is %d." % len(title))
    if "<" in title or ">" in title:
        raise Error("YouTube will not take < or > in a title.")
    description = (data.get("description") or "")[:5000]
    privacy = data.get("privacy", "private")
    if privacy not in ("private", "unlisted", "public"):
        raise Error("privacy must be private, unlisted or public")

    want = {
        "snippet": {"title": title, "description": description,
                    # 10 is Music. Left unset, YouTube picks one, and a music library
                    # knowing the answer and not saying it is a small daily annoyance.
                    "categoryId": "10"},
        "status": {"privacyStatus": privacy,
                   # Sent rather than left out. An upload with no answer to this is left
                   # needing attention in Studio. False is right for a music channel; a
                   # channel where it is not can change it there.
                   "selfDeclaredMadeForKids": False},
    }
    _prune_old_work()
    job = _new_job(song, data.get("version_id"), digest)
    _note(privacy_asked=privacy)
    threading.Thread(target=_work, args=(job, song, want),
                     name="youtube-upload", daemon=True).start()
    return {"job": _public_job()}


def tool_state(req):
    """Is there an ffmpeg, where, and if not whether one can be fetched.

    Read on every load of the upload page, which is why video.find caches. can_install is
    cheap and does not touch the network: it answers from the platform and the pin.
    """
    found = video.find()
    can, why = video.can_install()
    return dict(found, unaudited=True,
                can_install=can and not found["found"],
                install_why=why,
                install_size=video.BUILD["size"],
                install_version=video.BUILD["version"])


def SUMMARY():
    row = db.one("SELECT COUNT(*) AS n FROM youtube_posts WHERE status = 'published'")
    return {"published": row["n"] if row else 0}


def ROUTES():
    return {
        ("GET", "/api/songs/<id>/youtube"): list_posts,
        ("POST", "/api/songs/<id>/youtube"): create_post,
        ("PATCH", "/api/youtube/<id>"): update_post,
        ("DELETE", "/api/youtube/<id>"): delete_post,
        # Sending one out: the mix arrives, then the job that makes the video and posts
        # it, then the two the page polls while it runs.
        ("POST", "/api/songs/<id>/youtube/mix"): receive_mix,
        ("POST", "/api/songs/<id>/youtube/upload"): start_upload,
        ("GET", "/api/youtube/job"): job_state,
        ("POST", "/api/youtube/job/cancel"): cancel_job,
        ("GET", "/api/youtube/tool"): tool_state,
        ("GET", "/api/youtube/account"): account_state,
        ("GET", "/api/youtube/avatar"): avatar,
        # The browser sign in, and the two the device flow already had.
        ("GET", "/api/youtube/auth/addresses"): auth_addresses,
        ("POST", "/api/youtube/auth/start"): auth_start,
        ("GET", RETURN_PATH): auth_return,
        ("POST", "/api/youtube/connect"): connect,
        ("POST", "/api/youtube/finish"): finish,
        ("DELETE", "/api/youtube/account"): disconnect,
        ("DELETE", "/api/youtube/account/<id>"): disconnect,
        ("POST", "/api/youtube/account/choose"): choose_account,
    }
