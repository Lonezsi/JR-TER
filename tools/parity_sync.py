"""Does the Spring server agree with the Python one on watched folders (sync) and the
updater's routes? (slice 9e2)

Makes a throwaway data directory, starts server/target/jriter.jar on it, drives /api/sync/*
over HTTP, and asks jriter/modules/sync.py what it would answer, in-process, from the same
data. The updater is only checked where it is safe: the check route answers, and a friend is
refused by apply, now and restart. The owner is never sent to apply/now/restart, because that
would pull this checkout or stop the server.

    python tools/parity_sync.py          (build first: mvn -f server package)

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
import urllib.error
import urllib.parse
import urllib.request
import wave

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TMP = tempfile.mkdtemp(prefix="jriter-parity-sync-")
PORT = 7918
JAVA = os.environ.get("JRITER_JAVA") or r"C:\Java\jdk-21\bin\java.exe"
GLASS = os.environ.get("JRITER_GLASS") or os.path.abspath(
    os.path.join(os.path.dirname(ROOT), "foyer", "shared", "glass.css"))

os.environ.update(JRITER_DATA=os.path.join(TMP, "data"), JRITER_GLASS=GLASS, JRITER_FOYER="")
sys.path.insert(0, ROOT)
from jriter import accounts, db, registry, who, wire  # noqa: E402
from jriter.modules import auth as pyauth, sync as pysync  # noqa: E402

registry.load()
failures = []


def check(name, ok, detail=""):
    print(("ok   " if ok else "FAIL ") + name + ("" if ok else "  " + str(detail)[:600]))
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
    req = urllib.request.Request("http://127.0.0.1:%d%s" % (PORT, path), data=data, method=method, headers=h)
    try:
        res = urllib.request.urlopen(req, timeout=60)
    except urllib.error.HTTPError as e:
        res = e
    content = res.read()
    try:
        parsed = json.loads(content.decode())
    except ValueError:
        parsed = None
    return res.status, parsed


def same(a, b):
    return json.loads(json.dumps(a)) == json.loads(json.dumps(b))


def fake(body=None, params=None):
    r = wire.Request("POST", "/", {}, {}, None, params or {})
    r._parsed = body if body is not None else {}
    return r


def py(fn, req):
    with who.acting_as(1):
        return fn(req)


def make_wav(path, seconds=0.4, rate=8000, seed=7):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    w = wave.open(path, "wb")
    w.setnchannels(1)
    w.setsampwidth(2)
    w.setframerate(rate)
    w.writeframes(b"".join(struct.pack("<h", (i * seed % 24000) - 12000) for i in range(int(rate * seconds))))
    w.close()


def rows(sql, args=()):
    with who.acting_as(1):
        return db.query(sql, args)


proc = None
log = open(os.path.join(TMP, "jar.log"), "wb")
try:
    accounts.create("owner", "pw", account_id=accounts.OWNER)
    accounts.create("friend", "pw", account_id=2)
    owner = "jriter_session=" + pyauth.issue(1)
    friend = "jriter_session=" + pyauth.issue(2)
    env = dict(os.environ, JRITER_PORT=str(PORT), JRITER_HOME=ROOT, JRITER_HOST="127.0.0.1")
    env.pop("JRITER_WATCHDOG", None)             # a test must never pull this checkout
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

    music = os.path.join(TMP, "music")
    samples = os.path.join(music, "samples")
    make_wav(os.path.join(music, "Arvizi dal v2.wav"), seed=11)
    make_wav(os.path.join(music, "sub", "other idea.wav"), seed=13)
    make_wav(os.path.join(music, ".hidden", "secret.wav"), seed=17)
    make_wav(os.path.join(samples, "kick.wav"), seed=19)
    with open(os.path.join(samples, "notes.txt"), "w") as f:
        f.write("kit notes")
    with open(os.path.join(music, "readme.txt"), "w") as f:
        f.write("not audio")

    # -- a friend gets nothing ------------------------------------------------------------
    for method, path, body in [("GET", "/api/sync/folders", None), ("POST", "/api/sync/folders", {"path": music}),
                               ("PATCH", "/api/sync/folders/1", {"enabled": False}),
                               ("DELETE", "/api/sync/folders/1", None), ("POST", "/api/sync/scan", None),
                               ("POST", "/api/sync/stock", None), ("POST", "/api/sync/import", {"path": music}),
                               ("POST", "/api/sync/folders/1/upload", None)]:
        st, b = call(method, path, body, cookie=friend)
        check("friend refused: %s %s" % (method, path), st == 403 and "only its owner" in b["error"], (st, b))
    for path in ["/api/update/apply", "/api/update/now", "/api/update/restart"]:
        st, b = call("POST", path, {}, cookie=friend)
        check("friend refused: " + path, st == 403 and b["error"].startswith("Only the owner"), (st, b))
    st, b = call("POST", "/api/sync/folders", {"path": music})
    check("a stranger is signed out", st == 401, (st, b))

    # -- the updater answers --------------------------------------------------------------
    st, b = call("GET", "/api/update/check", cookie=owner)
    check("update check answers with its keys", st == 200 and "can_update" in b
          and ("checked" in b or "why" in b), (st, b))

    # -- adding folders -------------------------------------------------------------------
    st, b = call("GET", "/api/sync/folders", cookie=owner)
    check("none yet", st == 200 and b == {"folders": []}, b)
    st, b = call("POST", "/api/sync/folders", {"path": os.path.join(TMP, "nope")}, cookie=owner)
    check("a missing folder is refused", st == 400 and b["error"].startswith("there is no folder at "), b)
    st, b = call("POST", "/api/sync/folders", {"path": music, "kind": "junk"}, cookie=owner)
    check("a bad kind is refused", st == 400 and b["error"] == "a folder is either a collector or a sync", b)
    st, b = call("POST", "/api/sync/folders", {}, cookie=owner)
    check("a path is needed", st == 400 and b["error"] == "path is required", b)
    st, b = call("POST", "/api/sync/folders", {"path": music}, cookie=owner)
    f_music = b["folder"]["id"]
    check("add a collector", st == 200 and b["added"] and b["folder"]["kind"] == "collector"
          and b["folder"]["enabled"] == 1 and b["folder"]["path"] == os.path.abspath(music), b)
    st, b = call("POST", "/api/sync/folders", {"path": music}, cookie=owner)
    check("adding it again changes nothing", st == 200 and b["added"] is False and b["folder"]["id"] == f_music, b)
    st, b = call("POST", "/api/sync/folders", {"path": samples, "kind": "sync"}, cookie=owner)
    f_samples = b["folder"]["id"]
    check("add a sample library", st == 200 and b["added"] and b["folder"]["kind"] == "sync", b)
    spring_list = call("GET", "/api/sync/folders", cookie=owner)[1]
    py_list = py(pysync.list_folders, fake())
    check("list equals Python's", same(spring_list, py_list), (spring_list, py_list))

    # -- scan -----------------------------------------------------------------------------
    song = call("POST", "/api/songs", {"title": "Arvizi dal"}, cookie=owner)[1]["song"]["id"]
    st, scan = call("POST", "/api/sync/scan", cookie=owner)
    names = sorted(c["name"] for c in scan["candidates"])
    check("scan finds the two renders, not samples or hidden or text",
          st == 200 and names == ["Arvizi dal v2.wav", "other idea.wav"] and scan["already_have"] == 0
          and scan["folders"] == 1 and scan["errors"] == [], scan)
    py_scan = py(pysync.scan, fake())
    a = sorted(scan["candidates"], key=lambda c: c["path"])
    b = sorted(py_scan["candidates"], key=lambda c: c["path"])
    ok = len(a) == len(b) and all(
        {k: v for k, v in x.items() if k != "modified"} == {k: v for k, v in y.items() if k != "modified"}
        and abs(x["modified"] - y["modified"]) < 0.01 for x, y in zip(a, b))
    check("scan candidates equal Python's", ok, (a, b))
    sug = [c for c in scan["candidates"] if c["name"] == "Arvizi dal v2.wav"][0]["suggest"]
    check("the render is suggested for the song", sug and sug["song_id"] == song and sug["title"] == "Arvizi dal", sug)

    # -- import ---------------------------------------------------------------------------
    st, b = call("POST", "/api/sync/import", {"path": os.path.join(TMP, "nothing.wav")}, cookie=owner)
    check("import: no such file", st == 400 and b["error"].startswith("there is no file at "), b)
    st, b = call("POST", "/api/sync/import", {"path": os.path.join(music, "readme.txt")}, cookie=owner)
    check("import: not audio", st == 400 and b["error"] == "that is not an audio file JR!TER handles", b)
    outside = os.path.join(TMP, "outside", "x.wav")
    make_wav(outside, seed=23)
    st, b = call("POST", "/api/sync/import", {"path": outside}, cookie=owner)
    check("import: outside a watched folder", st == 403 and b["error"] == "that file is not inside any watched folder", b)
    st, b = call("POST", "/api/sync/import", {"path": os.path.join(music, "Arvizi dal v2.wav"), "song_id": song}, cookie=owner)
    check("import onto a song", st == 200 and b["duplicate"] is False and b["version"]["n"] == 1
          and b["song"]["id"] == song and b["song"]["current_version_id"] == b["version"]["id"]
          and b["version"]["filename"] == "Arvizi dal v2.wav" and b["version"]["ext"] == ".wav", b)
    first_digest = b["version"]["digest"]
    st, b = call("POST", "/api/sync/import", {"path": os.path.join(music, "Arvizi dal v2.wav"), "song_id": song}, cookie=owner)
    check("importing the same file again is a duplicate", st == 200 and b["duplicate"] is True
          and b["version"]["digest"] == first_digest, b)
    st, b = call("POST", "/api/sync/import", {"path": os.path.join(music, "sub", "other idea.wav"), "title": "Fresh"}, cookie=owner)
    check("import as a new song", st == 200 and b["duplicate"] is False and b["song"]["title"] == "Fresh"
          and b["version"]["n"] == 1, b)
    st, b = call("POST", "/api/sync/import", {"path": os.path.join(music, "sub", "other idea.wav"), "song_id": 999}, cookie=owner)
    check("import onto a missing song", st == 404 and b["error"] == "no song with id 999", b)
    st, scan2 = call("POST", "/api/sync/scan", cookie=owner)
    check("after importing everything is known", scan2["candidates"] == [] and scan2["already_have"] == 2, scan2)
    py_scan2 = py(pysync.scan, fake())
    check("and Python agrees", py_scan2["candidates"] == [] and py_scan2["already_have"] == 2, py_scan2)

    # -- stock ----------------------------------------------------------------------------
    st, stock = call("POST", "/api/sync/stock", cookie=owner)
    py_stock = py(pysync.take_stock, fake())
    check("stock counts the library (notes included)", st == 200 and stock["libraries"][0]["files"] == 2, stock)
    ok = same({k: v for k, v in stock["libraries"][0].items() if k != "newest"},
              {k: v for k, v in py_stock["libraries"][0].items() if k != "newest"}) \
        and abs(stock["libraries"][0]["newest"] - py_stock["libraries"][0]["newest"]) < 0.01
    check("stock equals Python's", ok, (stock, py_stock))

    # -- upload ---------------------------------------------------------------------------
    wavbytes = open(os.path.join(samples, "kick.wav"), "rb").read()
    st, b = call("POST", "/api/sync/folders/%d/upload" % f_music, raw=wavbytes, headers={"X-Filename": "a.wav"}, cookie=owner)
    check("upload into a collector is refused", st == 400 and "render collector" in b["error"], b)
    st, b = call("POST", "/api/sync/folders/999/upload", raw=wavbytes, headers={"X-Filename": "a.wav"}, cookie=owner)
    check("upload into a missing folder", st == 404 and b["error"] == "no watched folder with that id", b)
    st, b = call("POST", "/api/sync/folders/%d/upload" % f_samples, raw=wavbytes, headers={"X-Filename": "snare.wav"}, cookie=owner)
    check("upload a sample", st == 200 and b["added"] == "snare.wav" and b["bytes"] == len(wavbytes)
          and open(os.path.join(samples, "snare.wav"), "rb").read() == wavbytes, b)
    st, b = call("POST", "/api/sync/folders/%d/upload" % f_samples, raw=b"other", headers={"X-Filename": "kick.wav"}, cookie=owner)
    check("a clash gets a number, the old one stays", st == 200 and b["added"] == "kick 2.wav"
          and open(os.path.join(samples, "kick.wav"), "rb").read() == wavbytes, b)
    st, b = call("POST", "/api/sync/folders/%d/upload" % f_samples, raw=b"x", headers={"X-Filename": "my%20kick%20%231.wav"}, cookie=owner)
    check("the name is percent-decoded", st == 200 and b["added"] == "my kick #1.wav", b)
    for evil in ["..%2F..%2Fevil.wav", "..%5C..%5Cevil2.wav", "../evil3.wav"]:
        st, b = call("POST", "/api/sync/folders/%d/upload" % f_samples, raw=b"x", headers={"X-Filename": evil}, cookie=owner)
        stayed = st == 200 and os.path.dirname(b["path"]) == os.path.abspath(samples)
        check("a path in the name stays inside: " + evil, stayed, b)
    check("nothing escaped", not any(n.startswith("evil") for n in os.listdir(TMP))
          and not any(n.startswith("evil") for n in os.listdir(music)), os.listdir(music))
    st, b = call("POST", "/api/sync/folders/%d/upload" % f_samples, raw=b"x", headers={"X-Filename": "virus.exe"}, cookie=owner)
    check("a wrong extension is refused", st == 400 and b["error"].startswith("JR!TER takes .mp3, .wav,") and b["error"].endswith("not .exe"), b)
    st, b = call("POST", "/api/sync/folders/%d/upload" % f_samples, raw=b"x", headers={"X-Filename": ".."}, cookie=owner)
    check("a name of dots is refused", st == 400 and b["error"] == "that upload did not say what it was called", b)
    st, b = call("POST", "/api/sync/folders/%d/upload" % f_samples, raw=b"", headers={"X-Filename": "e.wav"}, cookie=owner)
    check("an empty upload is refused", st == 400 and b["error"] == "no file in that upload", b)
    conn = http.client.HTTPConnection("127.0.0.1", PORT, timeout=30)
    conn.putrequest("POST", "/api/sync/folders/%d/upload" % f_samples)
    conn.putheader("Cookie", owner)
    conn.putheader("X-Filename", "huge.wav")
    conn.putheader("Content-Length", str(64 * 1024 * 1024 + 1))
    conn.endheaders()
    res = conn.getresponse()
    body = json.loads(res.read().decode())
    conn.close()
    check("over 64 MB is refused", res.status == 400 and body["error"] == "a sample over 64 MB is not a sample", (res.status, body))
    check("no .part files left", not [n for n in os.listdir(samples) if n.endswith(".part")], os.listdir(samples))
    st, scan3 = call("POST", "/api/sync/scan", cookie=owner)
    check("uploaded samples are never render candidates", scan3["candidates"] == [], scan3)

    # -- pause and remove -----------------------------------------------------------------
    st, b = call("PATCH", "/api/sync/folders/%d" % f_music, {"enabled": False}, cookie=owner)
    check("pause a folder", st == 200 and b["folder"]["enabled"] == 0, b)
    st, scan4 = call("POST", "/api/sync/scan", cookie=owner)
    check("a paused collector is not scanned", scan4["folders"] == 0, scan4)
    st, b = call("PATCH", "/api/sync/folders/999", {"enabled": True}, cookie=owner)
    check("patch a missing folder", st == 404 and b["error"] == "no folder with id 999", b)
    st, b = call("DELETE", "/api/sync/folders/%d" % f_samples, cookie=owner)
    check("remove a folder", st == 200 and b == {"removed": str(f_samples)}, b)
    st, b = call("GET", "/api/sync/folders", cookie=owner)
    check("one folder left", len(b["folders"]) == 1 and b["folders"][0]["id"] == f_music, b)

    # -- the data the two servers share ---------------------------------------------------
    check("Python reads the tables Spring made", len(rows("SELECT * FROM sync_folders")) == 1
          and len(rows("SELECT * FROM sync_seen")) >= 2, rows("SELECT * FROM sync_folders"))
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
