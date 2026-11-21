"""Does the Spring library (songs, versions, blobs, renders) agree with the Python one?

Makes a throwaway data directory, starts server/target/jriter.jar on it, drives the song,
version and render endpoints over HTTP, then reads the same rows and files back through the
Python modules. Python reading what Spring wrote is the way back working.

    python tools/parity_library.py        (build first: mvn -f server package)

Standard library only. Exits 1 on any failed check.
"""
import hashlib
import json
import os
import shutil
import struct
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
import wave

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TMP = tempfile.mkdtemp(prefix="jriter-parity-lib-")
PORT = 7912
JAVA = os.environ.get("JRITER_JAVA") or r"C:\Java\jdk-21\bin\java.exe"
GLASS = os.environ.get("JRITER_GLASS") or os.path.abspath(
    os.path.join(os.path.dirname(ROOT), "foyer", "shared", "glass.css"))

os.environ.update(JRITER_DATA=TMP, JRITER_GLASS=GLASS, JRITER_FOYER="")
sys.path.insert(0, ROOT)
from jriter import accounts, audio_meta, blobs, db, who  # noqa: E402
from jriter.modules import auth as pyauth  # noqa: E402

failures = []


def check(name, ok, detail=""):
    print(("ok   " if ok else "FAIL ") + name + ("" if ok else "  " + str(detail)))
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
    req = urllib.request.Request("http://127.0.0.1:%d%s" % (PORT, path), data=data,
                                 method=method, headers=h)
    try:
        res = urllib.request.urlopen(req, timeout=30)
    except urllib.error.HTTPError as e:
        res = e
    content = res.read()
    try:
        parsed = json.loads(content.decode())
    except ValueError:
        parsed = None
    return res.status, parsed, content, res.headers


def make_wav(path, seconds=0.5, silent=False, rate=8000):
    w = wave.open(path, "wb")
    w.setnchannels(1)
    w.setsampwidth(2)
    w.setframerate(rate)
    frames = int(rate * seconds)
    w.writeframes(b"".join(struct.pack("<h", 0 if silent else (i * 53 % 24000) - 12000)
                           for i in range(frames)))
    w.close()
    return open(path, "rb").read()


def py_rows(account, sql, args=()):
    with who.acting_as(account):
        return db.query(sql, args)


proc = None
log = open(os.path.join(TMP, "jar.log"), "wb")
try:
    accounts.create("owner", "pw", account_id=accounts.OWNER)
    accounts.create("friend", "pw", account_id=2)
    owner = "jriter_session=" + pyauth.issue(1)
    friend = "jriter_session=" + pyauth.issue(2)

    env = dict(os.environ, JRITER_PORT=str(PORT), JRITER_HOME=ROOT, JRITER_HOST="127.0.0.1")
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

    # -- songs ---------------------------------------------------------------------
    status, body, _, _ = call("POST", "/api/songs", {"title": "Halfway Under", "notes": "n"}, cookie=owner)
    check("create a song", status == 200 and body["song"]["title"] == "Halfway Under"
          and body["song"]["version_count"] == 0 and body["song"]["artwork_id"] is None, body)
    sid = body["song"]["id"]
    status, body, _, _ = call("POST", "/api/songs", {"title": "  "}, cookie=owner)
    check("a blank title is refused", status == 400 and body["error"] == "title is required", body)
    call("POST", "/api/songs", {"title": "Zebra"}, cookie=owner)
    status, body, _, _ = call("GET", "/api/songs?sort=title", cookie=owner)
    check("list sorted by title", [s["title"] for s in body["songs"]] == ["Halfway Under", "Zebra"], body)
    status, body, _, _ = call("GET", "/api/songs?q=zeb", cookie=owner)
    check("list filtered by q", [s["title"] for s in body["songs"]] == ["Zebra"], body)
    check("Python reads the song Spring made",
          py_rows(1, "SELECT title, notes FROM songs WHERE id = ?", (sid,))[0]["title"] == "Halfway Under")
    status, body, _, _ = call("GET", "/api/songs/%d" % sid, cookie=owner)
    check("get a song", status == 200 and body["song"]["id"] == sid, body)
    check("opening counts", py_rows(1, "SELECT opened FROM songs WHERE id = ?", (sid,))[0]["opened"] == 1)
    status, body, _, _ = call("GET", "/api/songs/9999", cookie=owner)
    check("no such song is 404", status == 404 and body["error"] == "no song with id 9999", body)
    status, body, _, _ = call("PATCH", "/api/songs/%d" % sid, {"title": "Halfway Over"}, cookie=owner)
    check("rename", status == 200 and body["song"]["title"] == "Halfway Over", body)
    status, body, _, _ = call("GET", "/api/songs/%d/titles" % sid, cookie=owner)
    check("old title kept", body["current"] == "Halfway Over" and body["previous"][0]["title"] == "Halfway Under", body)
    status, body, _, _ = call("GET", "/api/songs/most-opened?limit=3", cookie=owner)
    check("most opened", status == 200 and body["songs"][0]["id"] == sid, body)
    status, body, _, _ = call("GET", "/api/songs/match?name=Halfway_Over_v2.wav", cookie=owner)
    check("match suggests the song", status == 200 and body["suggest"] and body["suggest"]["song_id"] == sid, body)

    # -- versions ------------------------------------------------------------------
    wav_path = os.path.join(TMP, "take.wav")
    data = make_wav(wav_path)
    digest = hashlib.sha256(data).hexdigest()
    status, body, _, _ = call("POST", "/api/songs/%d/versions" % sid, cookie=owner, raw=data,
                              headers={"X-Filename": "take.wav", "X-Label": " loud ",
                                       "Content-Type": "application/octet-stream"})
    v = body and body.get("version") or {}
    check("upload a version", status == 200 and body["duplicate"] is False and v["n"] == 1
          and v["digest"] == digest and v["label"] == "loud", body)
    path = os.path.join(TMP, "accounts", "1", "blobs", digest[:2], digest[2:4], digest)
    check("blob at the fan-out path with the right bytes", os.path.isfile(path) and open(path, "rb").read() == data)
    meta = audio_meta.probe(path, ".wav")
    pk = audio_meta.peaks(path, ".wav")
    check("duration and bitrate equal Python's", v["duration"] == meta["duration"] and v["bitrate"] == meta["bitrate"],
          (v["duration"], meta))
    check("peaks equal Python's", v["peaks"] == ",".join(str(n) for n in pk["peaks"]) and v["peak_db"] == pk["peak_db"])
    row = py_rows(1, "SELECT * FROM versions WHERE id = ?", (v["id"],))[0]
    check("Python reads the version row", row["digest"] == digest and row["ext"] == ".wav" and row["size"] == len(data))
    check("the song's current version is set",
          py_rows(1, "SELECT current_version_id FROM songs WHERE id = ?", (sid,))[0]["current_version_id"] == v["id"])
    status, body, _, _ = call("POST", "/api/songs/%d/versions" % sid, cookie=owner, raw=data,
                              headers={"X-Filename": "take.wav"})
    check("same bytes again is a duplicate", status == 200 and body["duplicate"] is True
          and "byte for byte v1" in body["message"], body)
    status, body, _, _ = call("POST", "/api/songs/%d/versions" % sid, cookie=owner, raw=b"x",
                              headers={"X-Filename": "notes.txt"})
    check("a non-audio upload is refused", status == 400 and "not an audio file" in body["error"], body)
    data2 = make_wav(os.path.join(TMP, "take2.wav"), 0.25)
    status, body, _, _ = call("POST", "/api/songs/%d/versions" % sid, cookie=owner, raw=data2,
                              headers={"X-Filename": "take2.wav"})
    v2 = body["version"]
    check("second version is n=2 and current", v2["n"] == 2 and
          py_rows(1, "SELECT current_version_id FROM songs WHERE id = ?", (sid,))[0]["current_version_id"] == v2["id"], body)
    status, body, _, _ = call("GET", "/api/songs/%d/versions" % sid, cookie=owner)
    check("list versions newest first with a shape", [x["n"] for x in body["versions"]] == [2, 1]
          and isinstance(body["versions"][0]["shape"], list) and "peaks" not in body["versions"][0]
          and body["current_version_id"] == v2["id"], body)
    status, body, _, _ = call("GET", "/api/versions/have?digest=%s,%s" % (digest, "0" * 64), cookie=owner)
    check("have", body["have"][digest]["n"] == 1 and body["have"]["0" * 64] is None, body)
    status, body, _, _ = call("PATCH", "/api/versions/%d" % v["id"], {"label": "quiet"}, cookie=owner)
    check("patch label", body["version"]["label"] == "quiet", body)
    status, body, _, _ = call("POST", "/api/versions/%d/current" % v["id"], cookie=owner)
    check("make current", status == 200 and body["current_version_id"] == v["id"], body)
    status, _, content, headers = call("GET", "/api/versions/%d/audio" % v["id"], cookie=owner,
                                       headers={"Range": "bytes=0-9"})
    check("audio honours Range", status == 206 and content == data[:10]
          and headers["Content-Range"] == "bytes 0-9/%d" % len(data), (status, headers.get("Content-Range")))
    status, _, content, headers = call("GET", "/api/versions/%d/audio" % v["id"], cookie=owner)
    check("audio whole, audio/wav", status == 200 and content == data and headers["Content-Type"] == "audio/wav", status)
    status, _, content, headers = call("GET", "/api/versions/%d/download" % v["id"], cookie=owner)
    check("download names the file", status == 200 and 'filename="take.wav"' in headers["Content-Disposition"],
          headers.get("Content-Disposition"))
    status, body, _, _ = call("POST", "/api/versions/examine", cookie=owner)
    check("examine has nothing left", status == 200 and body["left"] == 0, body)

    # -- renders -------------------------------------------------------------------
    rdata = make_wav(os.path.join(TMP, "r1.wav"), 0.2)
    rdigest = hashlib.sha256(rdata).hexdigest()
    stamp = str(time.time() - 3600)
    status, body, _, _ = call("POST", "/api/renders", cookie=owner, raw=rdata,
                              headers={"X-Filename": "Bounce 7.wav", "X-Project-At": stamp, "X-Rendered-At": "5"})
    r = body["render"]
    check("render upload", status == 200 and body["added"] is True and r["name"] == "Bounce 7"
          and r["waiting"] is True and r["project_at"] > 0 and r["rendered_at"] == 0, body)
    status, body, _, _ = call("POST", "/api/renders", cookie=owner, raw=rdata, headers={"X-Filename": "Bounce 7.wav"})
    check("same render again is not added", body["added"] is False and body["render"]["id"] == r["id"], body)
    status, body, _, _ = call("GET", "/api/renders", cookie=owner)
    check("waiting list", body["waiting"] == 1 and len(body["renders"]) == 1, body)
    status, body, _, _ = call("PATCH", "/api/renders/%d" % r["id"], {"name": "Bounce 8"}, cookie=owner)
    check("rename render", body["render"]["filename"] == "Bounce 8.wav", body)
    status, body, _, _ = call("POST", "/api/renders/%d/attach" % r["id"], {"title": "Fresh"}, cookie=owner)
    check("attach to a new song", status == 200 and body["song"]["title"] == "Fresh"
          and body["version"]["n"] == 1 and body["render"]["waiting"] is False and body["already_there"] is False, body)
    fresh = body["song"]["id"]
    check("Python sees the attachment", py_rows(1, "SELECT song_id, version_id FROM renders WHERE id = ?", (r["id"],))[0]["song_id"] == fresh)
    status, body, _, _ = call("POST", "/api/renders/%d/unattach" % r["id"], cookie=owner)
    check("unattach", body["render"]["waiting"] is True and body["render"]["song_id"] is None, body)
    status, body, _, _ = call("DELETE", "/api/renders/%d" % r["id"], cookie=owner)
    check("dismiss keeps a blob a version still uses",
          status == 200 and os.path.isfile(os.path.join(TMP, "accounts", "1", "blobs", rdigest[:2], rdigest[2:4], rdigest)), body)
    sdata = make_wav(os.path.join(TMP, "s.wav"), 0.1, silent=True)
    status, body, _, _ = call("POST", "/api/renders", cookie=owner, raw=sdata, headers={"X-Filename": "silent.wav"})
    check("a silent render is flagged", body["render"]["trouble"] == "silent", body)
    sid_r = body["render"]["id"]
    sdigest = hashlib.sha256(sdata).hexdigest()
    status, body, _, _ = call("DELETE", "/api/renders/%d" % sid_r, cookie=owner)
    sblob = os.path.join(TMP, "accounts", "1", "blobs", sdigest[:2], sdigest[2:4], sdigest)
    check("dismiss keeps the blob in the grave", os.path.exists(sblob))
    call("DELETE", "/api/grave", cookie=owner)
    check("dismiss removes an unused blob once the grave lets go", not os.path.exists(sblob))
    status, body, _, _ = call("GET", "/api/renders/%d/audio" % sid_r, cookie=owner)
    check("a dismissed render is 404", status == 404, status)

    # ingest
    folder = os.path.join(TMP, "drop")
    os.makedirs(os.path.join(folder, ".hidden"))
    os.makedirs(os.path.join(folder, "sub"))
    make_wav(os.path.join(folder, "a.wav"), 0.15)
    make_wav(os.path.join(folder, "sub", "b.wav"), 0.12)
    make_wav(os.path.join(folder, ".hidden", "c.wav"), 0.11)
    open(os.path.join(folder, "notes.txt"), "w").write("not audio")
    open(os.path.join(folder, "a.flp"), "wb").write(b"project")
    status, body, _, _ = call("POST", "/api/renders/ingest", {"path": folder}, cookie=owner)
    check("ingest takes audio only, skips dot folders",
          status == 200 and body["count"] == 2 and body["looked_at"] == 2
          and sorted(x["filename"] for x in body["added"]) == ["a.wav", "b.wav"], body)
    a_row = [x for x in body["added"] if x["filename"] == "a.wav"][0]
    check("ingest dates a render from the .flp beside it", a_row["project_at"] > 0 and a_row["rendered_at"] > 0, a_row)
    status, body, _, _ = call("POST", "/api/renders/ingest", {"path": folder}, cookie=owner)
    check("ingest again finds them already here", body["count"] == 0 and body["already_here"] == 2, body)
    status, body, _, _ = call("POST", "/api/renders/ingest", {"path": os.path.join(folder, "notes.txt")}, cookie=owner)
    check("ingest refuses a non-audio file", status == 400 and "only audio" in body["error"], body)
    status, body, _, _ = call("POST", "/api/renders/ingest", {"path": folder}, cookie=friend)
    check("a friend cannot ingest a host path", status == 403, (status, body))
    status, body, _, _ = call("POST", "/api/renders/clear", cookie=owner)
    check("clear takes the used ones only", status == 200 and body["cleared"] == 0, body)

    # -- the friend has a library of their own ---------------------------------------
    status, body, _, _ = call("GET", "/api/songs", cookie=friend)
    check("a friend sees none of the owner's songs", status == 200 and body["songs"] == [], body)

    # -- up-next ---------------------------------------------------------------------
    status, body, _, _ = call("GET", "/api/songs/up-next?after=%d" % sid, cookie=owner)
    check("up-next picks a playable song", status == 200 and body["song"] and body["song"]["id"] == fresh, body)

    # -- deletes ---------------------------------------------------------------------
    status, body, _, _ = call("DELETE", "/api/versions/%d" % v2["id"], cookie=owner)
    d2 = hashlib.sha256(data2).hexdigest()
    b2 = os.path.join(TMP, "accounts", "1", "blobs", d2[:2], d2[2:4], d2)
    check("deleting a version keeps its blob in the grave", status == 200 and os.path.exists(b2), body)
    call("DELETE", "/api/grave", cookie=owner)
    check("deleting a version removes its unused blob once the grave lets go", not os.path.exists(b2))
    check("the song falls back to the newest version",
          py_rows(1, "SELECT current_version_id FROM songs WHERE id = ?", (sid,))[0]["current_version_id"] == v["id"])
    status, body, _, _ = call("DELETE", "/api/songs/%d" % sid, cookie=owner)
    check("delete a song", status == 200 and body["deleted"] == sid and body["shares_taken_back"] == 0, body)
    check("its versions went with it (cascade, seen by Python)",
          py_rows(1, "SELECT id FROM versions WHERE song_id = ?", (sid,)) == [])
    status, body, _, _ = call("GET", "/api/versions/%d/audio" % v["id"], cookie=owner)
    check("its version is gone", status == 404, status)
finally:
    if proc:
        proc.kill()
        proc.wait()
    log.close()
    if failures:
        print("\n--- jar log ---")
        print(open(os.path.join(TMP, "jar.log"), errors="replace").read()[-3000:])
    try:
        db.shut_down()
    except Exception:
        pass
    shutil.rmtree(TMP, ignore_errors=True)

print("\n%d failed" % len(failures) if failures else "\nall checks passed")
sys.exit(1 if failures else 0)
