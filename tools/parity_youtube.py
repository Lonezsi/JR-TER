"""Does the Spring server agree with the Python one on YouTube? (slice 9e3)

Makes a throwaway data directory, starts server/target/jriter.jar on it, drives /api/youtube/*
and a song's YouTube entries over HTTP, and asks jriter/modules/youtube.py what it would answer,
in-process, from the same data.

THIS NEVER REACHES GOOGLE and never starts an upload. Every upload request in here is
invalid on purpose, and the check ends by asserting that no job exists. The device sign-in
(/connect, and /finish with a device code) and the code exchange are not driven, because they
call Google. JRITER_TOOLS points at an empty folder so ffmpeg can never be fetched.

    python tools/parity_youtube.py          (build first: mvn -f server package)

Standard library only. Exits 1 on any failed check.
"""
import http.client
import json
import os
import shutil
import struct
import subprocess
import sys
import tempfile
import time
import urllib.parse
import wave
import io

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TMP = tempfile.mkdtemp(prefix="jriter-parity-youtube-")
PORT = 7920
JAVA = os.environ.get("JRITER_JAVA") or r"C:\Java\jdk-21\bin\java.exe"
GLASS = os.environ.get("JRITER_GLASS") or os.path.abspath(
    os.path.join(os.path.dirname(ROOT), "foyer", "shared", "glass.css"))

os.environ.update(JRITER_DATA=os.path.join(TMP, "data"), JRITER_GLASS=GLASS, JRITER_FOYER="",
                  JRITER_TOOLS=os.path.join(TMP, "tools"), JRITER_PORT=str(PORT))
os.environ.pop("JRITER_WATCHDOG", None)
sys.path.insert(0, ROOT)
from jriter import accounts, config, db, registry, who, wire  # noqa: E402
from jriter.modules import auth as pyauth, core as pycore, youtube as py  # noqa: E402

registry.load()
failures = []


def check(name, ok, detail=""):
    print(("ok   " if ok else "FAIL ") + name + ("" if ok else "  " + str(detail)[:900]))
    if not ok:
        failures.append(name)


def call(method, path, body=None, cookie=None, headers=None, raw=None):
    h = dict(headers or {})
    if cookie:
        h["Cookie"] = cookie
    data = raw
    if body is not None:
        data = json.dumps(body).encode()
        h["Content-Type"] = "application/json"
    conn = http.client.HTTPConnection("127.0.0.1", PORT, timeout=60)
    conn.request(method, path, body=data if data is not None else None, headers=h)
    res = conn.getresponse()
    content = res.read()
    out = (res.status, None, dict(res.getheaders()))
    try:
        out = (res.status, json.loads(content.decode()), dict(res.getheaders()))
    except ValueError:
        pass
    conn.close()
    return out


def same(a, b):
    return json.loads(json.dumps(a)) == json.loads(json.dumps(b))


def fake(body=None, params=None, query=None, headers=None, raw=None):
    r = wire.Request("GET", "/", query or {}, headers or {}, None, params or {})
    r._parsed = body if body is not None else {}
    if raw is not None:
        r.headers = dict(headers or {}, **{"Content-Length": str(len(raw))})
        r.rfile = io.BytesIO(raw)
    return r


def pyc(fn, req):
    """What Python answers, as (status, body-or-message)."""
    with who.acting_as(1):
        try:
            return 200, fn(req)
        except wire.Error as e:
            return e.status, e.message


def agrees(name, fn, req, method, path, body=None, raw=None, headers=None, status=None):
    st, b, _ = call(method, path, body, cookie=owner, raw=raw, headers=headers)
    pst, pb = pyc(fn, req)
    if pst == 200:
        check(name, st == 200 and same(b, pb), (st, b, pb))
    else:
        check(name, st == pst and b and b.get("error") == pb, (st, b, pst, pb))
    return st, b


def account_file():
    return os.path.join(config.home(1), "youtube.json")


def write_account(data):
    os.makedirs(config.home(1), exist_ok=True)
    with open(account_file(), "w", encoding="utf-8") as f:
        json.dump(data, f)


def drop_account():
    try:
        os.remove(account_file())
    except OSError:
        pass


def make_wav(seconds=0.4, rate=8000, seed=7):
    buf = io.BytesIO()
    w = wave.open(buf, "wb")
    w.setnchannels(1)
    w.setsampwidth(2)
    w.setframerate(rate)
    w.writeframes(b"".join(struct.pack("<h", (i * seed % 24000) - 12000) for i in range(int(rate * seconds))))
    w.close()
    return buf.getvalue()


def entry(name, **more):
    e = {"client_id": "CID", "client_secret": "SECRETX", "refresh_token": "REFRESHX", "access_token": "ACCESSX",
         "expires_at": time.time() + 3000, "connected_at": 1700000000.5, "channel": name, "name": name,
         "avatar_url": None}
    e.update(more)
    return e


proc = None
log = open(os.path.join(TMP, "jar.log"), "wb")
try:
    accounts.create("owner", "pw", account_id=accounts.OWNER)
    owner = "jriter_session=" + pyauth.issue(1)
    env = dict(os.environ, JRITER_HOME=ROOT, JRITER_HOST="127.0.0.1")
    proc = subprocess.Popen([JAVA, "-jar", os.path.join(ROOT, "server", "target", "jriter.jar")],
                            env=env, stdout=log, stderr=subprocess.STDOUT, cwd=TMP)
    for _ in range(120):
        try:
            if call("GET", "/api/health")[0] == 200:
                break
        except OSError:
            time.sleep(0.5)
    else:
        raise SystemExit("the jar never answered; see " + log.name)

    # -- a song, and the record of posts -------------------------------------------------
    song = call("POST", "/api/songs", {"title": "Árvíztűrő"}, cookie=owner)[1]["song"]["id"]
    sp = {"id": str(song)}
    agrees("no posts yet", py.list_posts, fake(params=sp), "GET", "/api/songs/%d/youtube" % song)
    agrees("posts of a missing song", py.list_posts, fake(params={"id": "999"}), "GET", "/api/songs/999/youtube")
    with who.acting_as(1):
        v1 = db.insert("versions", {"song_id": song, "n": 1, "digest": "a" * 64, "ext": ".wav", "created_at": time.time()})
    st, b, _ = call("POST", "/api/songs/%d/youtube" % song, {"url": "  https://youtu.be/x  ", "title": " Demo ",
                                                          "version_id": v1, "note": "first"}, cookie=owner)
    check("create a post", st == 200 and b["post"]["url"] == "https://youtu.be/x" and b["post"]["title"] == "Demo"
          and b["post"]["status"] == "published" and b["post"]["version_n"] == 1 and b["post"]["video_id"] == ""
          and b["post"]["mix_digest"] == "", b)
    pid = b["post"]["id"]
    st, b, _ = call("POST", "/api/songs/%d/youtube" % song, {"title": "Second", "status": "draft"}, cookie=owner)
    pid2 = b["post"]["id"]
    check("a post without a version", st == 200 and b["post"]["version_n"] is None and "version_missing" not in b["post"], b)
    agrees("the list equals Python's", py.list_posts, fake(params=sp), "GET", "/api/songs/%d/youtube" % song)
    st, b, _ = call("POST", "/api/songs/%d/youtube" % song, {"status": "nonsense"}, cookie=owner)
    pst, pb = pyc(py.create_post, fake(params=sp, body={"status": "nonsense"}))
    check("a bad status is refused alike", st == pst == 400 and b["error"] == pb, (st, b, pst, pb))
    st, b, _ = call("PATCH", "/api/youtube/%d" % pid, {"title": " Renamed ", "status": "unlisted", "note": None}, cookie=owner)
    check("patch a post", st == 200 and b["post"]["title"] == "Renamed" and b["post"]["status"] == "unlisted"
          and b["post"]["note"] == "", b)
    st, b, _ = call("PATCH", "/api/youtube/%d" % pid, {"status": "x"}, cookie=owner)
    pst, pb = pyc(py.update_post, fake(params={"id": str(pid)}, body={"status": "x"}))
    check("patch with a bad status", st == pst == 400 and b["error"] == pb, (st, b, pb))
    st, b, _ = call("PATCH", "/api/youtube/999", {}, cookie=owner)
    pst, pb = pyc(py.update_post, fake(params={"id": "999"}, body={}))
    check("patch a missing post", st == pst == 404 and b["error"] == pb, (st, b, pb))
    with who.acting_as(1):
        db.run("DELETE FROM versions WHERE id = ?", (v1,))
    st, b, _ = call("GET", "/api/songs/%d/youtube" % song, cookie=owner)
    gone = [p for p in b["posts"] if p["id"] == pid][0]
    check("a deleted version is said so", gone["version_n"] is None and gone["version_missing"] is True, gone)
    agrees("and Python says the same", py.list_posts, fake(params=sp), "GET", "/api/songs/%d/youtube" % song)
    st, b, _ = call("DELETE", "/api/youtube/%d" % pid2, cookie=owner)
    check("delete a post", st == 200 and b == {"deleted": pid2}, b)
    st, b, _ = call("DELETE", "/api/youtube/%d" % pid2, cookie=owner)
    pst, pb = pyc(py.delete_post, fake(params={"id": str(pid2)}))
    check("delete it again", st == pst == 404 and b["error"] == pb, (st, b, pb))
    st, b, _ = call("GET", "/api/songs/%d/youtube" % song)
    check("posts need a sign-in", st == 401, st)

    # -- the account file ----------------------------------------------------------------
    agrees("no account", py.account_state, fake(), "GET", "/api/youtube/account")
    old = entry("Old Channel")
    write_account(old)
    st, spring_old, _ = call("GET", "/api/youtube/account", cookie=owner)
    folded = json.load(open(account_file(), encoding="utf-8"))
    check("an old single account is folded in", st == 200 and folded.get("chosen") == "first"
          and folded["accounts"]["first"]["name"] == "Old Channel", folded)
    write_account(old)
    pst, pb = pyc(py.account_state, fake())
    check("and folds as Python folds it", same(spring_old, pb), (spring_old, pb))
    two = {"accounts": {"band": entry("Band", avatar_url="https://yt3.ggpht.com/a"), "me": entry("Me")}, "chosen": "me"}
    write_account(two)
    st, b, _ = call("GET", "/api/youtube/account", cookie=owner)
    pst, pb = pyc(py.account_state, fake())
    check("two accounts equal Python's", st == 200 and same(b, pb) and b["chosen"] == "me" and len(b["accounts"]) == 2, (b, pb))
    check("no secret or token leaves the server", all(w not in json.dumps(b) for w in ("SECRETX", "REFRESHX", "ACCESSX", "CID")), b)
    write_account({"accounts": {"band": entry("Band"), "me": entry("Me")}})
    st, b, _ = call("GET", "/api/youtube/account", cookie=owner)
    pst, pb = pyc(py.account_state, fake())
    check("two and none chosen: nothing is guessed", same(b, pb) and b["chosen"] is None, (b, pb))
    write_account(two)
    st, b, _ = call("POST", "/api/youtube/account/choose", {"id": "band"}, cookie=owner)
    check("choose one", st == 200 and b["chosen"] == "band", b)
    write_account(two)
    pst, pb = pyc(py.choose_account, fake(body={"id": "band"}))
    check("choose equals Python's", same(b, pb), (b, pb))
    write_account(two)
    st, b, _ = call("POST", "/api/youtube/account/choose", {"id": "nobody"}, cookie=owner)
    pst, pb = pyc(py.choose_account, fake(body={"id": "nobody"}))
    check("choose a missing one", st == pst == 404 and b["error"] == pb, (st, b, pb))
    st, b, _ = call("POST", "/api/youtube/account/choose", {}, cookie=owner)
    pst, pb = pyc(py.choose_account, fake(body={}))
    check("choose with no id", st == pst == 400 and b["error"] == pb, (st, b, pb))
    write_account(two)
    st, b, _ = call("DELETE", "/api/youtube/account/me", cookie=owner)
    write_account(two)
    pst, pb = pyc(py.disconnect, fake(params={"id": "me"}))
    check("disconnect the chosen one: the other is chosen", st == 200 and b["chosen"] == "band" and same(b, pb), (b, pb))
    st, b, _ = call("DELETE", "/api/youtube/account", cookie=owner)
    check("disconnect everything", st == 200 and b["accounts"] == [] and b["connected"] is False
          and not os.path.exists(account_file()), b)
    pst, pb = pyc(py.disconnect, fake())
    check("and Python says the same", same(b, pb), (b, pb))

    # -- the browser sign in -------------------------------------------------------------
    for host, proto in [("127.0.0.1:%d" % PORT, None), ("localhost:%d" % PORT, None),
                        ("jriter.dikdik-kettle.ts.net", "https"), ("box.example", None), ("100.1.2.3:7900", "http")]:
        hdr = {"Host": host}
        if proto:
            hdr["X-Forwarded-Proto"] = proto
        st, b, _ = call("GET", "/api/youtube/auth/addresses", cookie=owner, headers=hdr)
        pst, pb = pyc(py.auth_addresses, fake(headers=hdr))
        check("addresses for %s %s" % (host, proto or ""), st == 200 and same(b, pb), (b, pb))
    st, b, _ = call("GET", "/api/youtube/auth/addresses", cookie=owner, headers={"Host": "a/b"})
    pst, pb = pyc(py.auth_addresses, fake(headers={"Host": "a/b"}))
    # Tomcat itself may refuse a Host like that before the controller sees it; either way it is a 400\n    check("a Host with a slash is refused", st == pst == 400 and (b is None or b["error"] == pb), (st, b, pb))

    hdr = {"Host": "127.0.0.1:%d" % PORT}
    st, b, _ = call("POST", "/api/youtube/auth/start", {"client_id": " cid ", "client_secret": "sec", "name": " Mine "},
                    cookie=owner, headers=hdr)
    sent = json.load(open(account_file(), encoding="utf-8"))["pending"]
    spring_q = urllib.parse.parse_qs(urllib.parse.urlsplit(b["url"]).query)
    drop_account()
    pst, pb = pyc(py.auth_start, fake(body={"client_id": " cid ", "client_secret": "sec", "name": " Mine "}, headers=hdr))
    py_pending = json.load(open(account_file(), encoding="utf-8"))["pending"]
    py_q = urllib.parse.parse_qs(urllib.parse.urlsplit(pb["url"]).query)
    spring_q.pop("state"), py_q.pop("state")
    check("sign in start: the Google URL has the same parameters", st == 200 and spring_q == py_q
          and b["url"].startswith(py.AUTH_URL + "?") and b["redirect_uri"] == pb["redirect_uri"], (spring_q, py_q))
    check("and keeps the same pending entry", set(sent) == set(py_pending) and sent["kind"] == "redirect"
          and sent["client_id"] == "cid" and sent["name"] == "Mine" and len(sent["state"]) == 32
          and sent["redirect_uri"] == py_pending["redirect_uri"], (sent, py_pending))
    st, b, _ = call("POST", "/api/youtube/auth/start", {"client_secret": "x"}, cookie=owner, headers=hdr)
    pst, pb = pyc(py.auth_start, fake(body={"client_secret": "x"}, headers=hdr))
    check("start without a client id", st == pst == 400 and b["error"] == pb, (st, b, pb))

    def pending(state="S1"):
        write_account({"accounts": {}, "pending": {"kind": "redirect", "state": state, "client_id": "c",
                                                    "client_secret": "s", "redirect_uri": "http://x/", "started_at": 1,
                                                    "name": ""}})

    def landing(name, query, ready=True):
        if ready:
            pending()
        else:
            drop_account()
        st, _, h = call("GET", "/api/youtube/auth/return?" + urllib.parse.urlencode(query), cookie=owner)
        spent = json.load(open(account_file(), encoding="utf-8")).get("pending") if os.path.exists(account_file()) else None
        if ready:
            pending()
        else:
            drop_account()
        pr = None
        with who.acting_as(1):
            pr = py.auth_return(fake(query=query))
        check(name, st == 302 == pr.status and h.get("Location") == pr.headers["Location"] and spent is None,
              (st, h.get("Location"), pr.headers["Location"], spent))

    landing("return with nothing waiting", {"state": "S1", "code": "c"}, ready=False)
    landing("return with the wrong state", {"state": "nope", "code": "c"})
    landing("return with no state", {"code": "c"})
    landing("return refused by Google", {"state": "S1", "error": "access_denied"})
    landing("return without a code", {"state": "S1"})
    landing("return with an odd message in it", {"state": "S1", "error": "a b/c&d é"})
    pending()
    st, b, _ = call("POST", "/api/youtube/finish", {}, cookie=owner)
    pst, pb = pyc(py.finish, fake())
    check("finish while the browser sign in is open", st == pst == 409 and b["error"] == pb, (st, b, pb))
    drop_account()
    st, b, _ = call("POST", "/api/youtube/finish", {}, cookie=owner)
    pst, pb = pyc(py.finish, fake())
    check("finish with nothing waiting", st == pst == 400 and b["error"] == pb, (st, b, pb))
    st, b, _ = call("POST", "/api/youtube/connect", {"client_secret": "x"}, cookie=owner)
    pst, pb = pyc(py.connect, fake(body={"client_secret": "x"}))
    check("connect without a client id", st == pst == 400 and b["error"] == pb, (st, b, pb))

    # -- the avatar ----------------------------------------------------------------------
    drop_account()
    agrees("no picture without an account", py.avatar, fake(), "GET", "/api/youtube/avatar")
    write_account({"accounts": {"me": entry("Me")}, "chosen": "me"})
    agrees("no picture for an account without one", py.avatar, fake(), "GET", "/api/youtube/avatar")
    write_account({"accounts": {"me": entry("Me", avatar_url="http://169.254.169.254/latest")}, "chosen": "me"})
    agrees("a picture that is not Google's is never fetched", py.avatar, fake(), "GET", "/api/youtube/avatar")
    write_account({"accounts": {"me": entry("Me", avatar_url="file:///C:/Windows/win.ini")}, "chosen": "me"})
    agrees("a file address is never opened", py.avatar, fake(), "GET", "/api/youtube/avatar")

    # -- the mix -------------------------------------------------------------------------
    wav = make_wav()
    st, b, _ = call("POST", "/api/songs/%d/youtube/mix" % song, raw=wav, cookie=owner)
    pst, pb = pyc(py.receive_mix, fake(params=sp, raw=wav))
    check("a mix arrives as Python's does", st == 200 and pst == 200 and b["digest"] == pb["digest"] and b["size"] == pb["size"]
          and abs(b["seconds"] - pb["seconds"]) < 1e-9, (b, pb))
    mix = b["digest"]
    st, b, _ = call("POST", "/api/songs/%d/youtube/mix" % song, raw=b"not a wav at all, just bytes", cookie=owner)
    pst, pb = pyc(py.receive_mix, fake(params=sp, raw=b"not a wav at all, just bytes"))
    check("bytes that are not a wav", st == pst == 400 and b["error"] == pb, (st, b, pst, pb))
    st, b, _ = call("POST", "/api/songs/%d/youtube/mix" % song, raw=b"", cookie=owner)
    pst, pb = pyc(py.receive_mix, fake(params=sp, raw=b""))
    check("an empty mix", st == pst == 400 and b["error"] == pb, (st, b, pst, pb))
    st, b, _ = call("POST", "/api/songs/999/youtube/mix", raw=wav, cookie=owner)
    check("a mix for a missing song", st == 404 and b["error"] == "no song with id 999", (st, b))

    # -- uploads: refusals only ----------------------------------------------------------
    def up(name, body):
        st, b, _ = call("POST", "/api/songs/%d/youtube/upload" % song, body, cookie=owner)
        pst, pb = pyc(py.start_upload, fake(params=sp, body=body))
        check(name, st == pst and st != 200 and b["error"] == pb, (st, b, pst, pb))

    drop_account()
    up("upload: no digest", {})
    up("upload: a mix that is not there", {"digest": "f" * 64})
    up("upload: a digest that is not a digest", {"digest": "zz"})
    up("upload: no account chosen", {"digest": mix})
    write_account({"accounts": {"me": entry("Me")}, "chosen": "me"})
    up("upload: a title over 100", {"digest": mix, "title": "x" * 101})
    up("upload: a bracket in the title", {"digest": mix, "title": "a <b> c"})
    up("upload: privacy that is not one", {"digest": mix, "title": "ok", "privacy": "world"})
    up("upload: privacy null", {"digest": mix, "title": "ok", "privacy": None})
    st, b, _ = call("GET", "/api/youtube/job", cookie=owner)
    pst, pb = pyc(py.job_state, fake())
    check("no job exists, so nothing was started", st == 200 and b == {"job": None} and same(b, pb), (b, pb))
    st, b, _ = call("POST", "/api/youtube/job/cancel", cookie=owner)
    pst, pb = pyc(py.cancel_job, fake())
    check("cancel with nothing running", st == pst == 409 and b["error"] == pb, (st, b, pb))
    st, b, _ = call("GET", "/api/youtube/tool", cookie=owner)
    pst, pb = pyc(py.tool_state, fake())
    keys = ("found", "why", "unaudited", "can_install", "install_why", "install_size", "install_version")
    check("the ffmpeg answer equals Python's", st == 200 and all(b[k] == pb[k] for k in keys) and set(b) == set(pb), (b, pb))

    # -- the state ------------------------------------------------------------------------
    drop_account()
    st, s, _ = call("GET", "/api/state", cookie=owner)
    pst, ps = pyc(pycore.state, fake())
    check("state lists youtube as a module", st == 200 and s["modules"] == ps["modules"] and "youtube" in s["modules"],
          (s["modules"], ps["modules"]))
    check("and counts what was published", s["summary"]["youtube"] == ps["summary"]["youtube"], (s["summary"], ps["summary"]))
finally:
    if proc:
        proc.terminate()
        try:
            proc.wait(timeout=15)
        except subprocess.TimeoutExpired:
            proc.kill()
    log.close()
    try:
        db.shut_down()
    except Exception:
        pass
    shutil.rmtree(TMP, ignore_errors=True)

print("\n%d failed" % len(failures) if failures else "\nall passed")
sys.exit(1 if failures else 0)
