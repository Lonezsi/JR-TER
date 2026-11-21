"""Does the Spring server agree with the Python one on the devlog, the display font and the
library file (export, import, erase)? (slice 9e, first part)

Makes a throwaway data directory, starts server/target/jriter.jar on it, drives those over
HTTP, and asks the Python modules what they would have answered, in-process, from the same
data directory.

    python tools/parity_export.py          (build first: mvn -f server package)

Standard library only. Exits 1 on any failed check.
"""
import hashlib
import io
import json
import os
import re
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
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TMP = tempfile.mkdtemp(prefix="jriter-parity-export-")
PORT = 7917
JAVA = os.environ.get("JRITER_JAVA") or r"C:\Java\jdk-21\bin\java.exe"
GLASS = os.environ.get("JRITER_GLASS") or os.path.abspath(
    os.path.join(os.path.dirname(ROOT), "foyer", "shared", "glass.css"))

os.environ.update(JRITER_DATA=TMP, JRITER_GLASS=GLASS, JRITER_FOYER="")
sys.path.insert(0, ROOT)
from jriter import accounts, config, db, registry, who, wire  # noqa: E402
from jriter import devlog  # noqa: E402
from jriter.modules import appearance, auth as pyauth, devlog as devlog_mod, export  # noqa: E402

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
    req = urllib.request.Request("http://127.0.0.1:%d%s" % (PORT, urllib.parse.quote(path, safe="/?&=:%")), data=data,
                                 method=method, headers=h)
    try:
        res = urllib.request.urlopen(req, timeout=60)
    except urllib.error.HTTPError as e:
        res = e
    content = res.read()
    try:
        parsed = json.loads(content.decode())
    except ValueError:
        parsed = None
    return res.status, parsed, content, res.headers


def py_rows(account, sql, args=()):
    with who.acting_as(account):
        return db.query(sql, args)


def same(a, b):
    return json.loads(json.dumps(a)) == json.loads(json.dumps(b))


def fake(query=None, params=None, body=None, raw=None):
    r = wire.Request("GET", "/", query or {}, {}, None, params or {})
    r._parsed = body if body is not None else {}
    if raw is not None:
        r.headers = {"Content-Length": str(len(raw))}
        r.rfile = io.BytesIO(raw)
    return r


def make_wav(seconds=0.5, rate=8000, seed=53):
    path = os.path.join(TMP, "take%d.wav" % seed)
    w = wave.open(path, "wb")
    w.setnchannels(1)
    w.setsampwidth(2)
    w.setframerate(rate)
    w.writeframes(b"".join(struct.pack("<h", (i * seed % 24000) - 12000) for i in range(int(rate * seconds))))
    w.close()
    return open(path, "rb").read()


PNG = bytes.fromhex("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489"
                    "0000000d49444154789c6360f8ffff3f0005fe02fea7d6a3270000000049454e44ae426082")
FONT = b"\x00\x01\x00\x00" + bytes(range(256)) * 4


def tables_of(account):
    out = {}
    for t, cols in export.TAKEN.items():
        with who.acting_as(account):
            if not db.table_exists(t):
                continue
        out[t] = len(py_rows(account, "SELECT 1 FROM %s" % t))
    return out


proc = None
log = open(os.path.join(TMP, "jar.log"), "wb")
try:
    accounts.create("owner", "pw", account_id=accounts.OWNER)
    accounts.create("second", "pw", account_id=2)
    accounts.create("third", "pw", account_id=3)
    owner = "jriter_session=" + pyauth.issue(1)
    second = "jriter_session=" + pyauth.issue(2)
    third = "jriter_session=" + pyauth.issue(3)
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

    # -- the devlog ----------------------------------------------------------------------
    oldest = devlog.ENTRIES[-1]["version"]
    for q in ["", "?since=" + oldest, "?since=4.3.0", "?since=4.2", "?since=0.10.0", "?since=junk",
              "?since=1.2.3.4.5", "?since=99.0.0"]:
        st, b, _, _ = call("GET", "/api/devlog" + q, cookie=owner)
        mark = urllib.parse.parse_qs(q[1:]).get("since", [""])[0]
        py = devlog_mod.entries(fake({"since": mark} if mark else {}))
        check("devlog %r equals Python's" % q, st == 200 and same(b, py), (str(b)[:200], str(py)[:200]))
    st, b, _, _ = call("GET", "/api/devlog")
    check("devlog needs a sign-in", st == 401, b)

    # -- the display font ------------------------------------------------------------------
    st, b, _, _ = call("GET", "/api/appearance/font")
    check("no font yet is a 404", st == 404 and b["error"] == "no display font has been uploaded", b)
    st, b, _, _ = call("POST", "/api/appearance/font", raw=FONT, cookie=owner, headers={"X-Filename": "Orena.ttf"})
    check("upload a font", st == 200 and b["ok"] and b["font"]["font_name"] == "Orena.ttf"
          and b["font"]["font_format"] == "font/ttf" and b["font"]["custom_font"], b)
    with who.acting_as(1):
        py_state = appearance.state()
    check("state equals Python's", st == 200 and abs(b["font"]["uploaded_at"] - py_state["uploaded_at"]) < 1
          and {k: v for k, v in b["font"].items() if k != "uploaded_at"}
          == {k: v for k, v in py_state.items() if k != "uploaded_at"}, (b, py_state))
    st, _, content, h = call("GET", "/api/appearance/font", cookie=owner)
    check("the font comes back", st == 200 and content == FONT and h["Content-Type"] == "font/ttf", st)
    st, _, content, _ = call("GET", "/api/appearance/font")
    check("a stranger gets the owner's font", st == 200 and content == FONT, st)
    st, _, content, _ = call("GET", "/api/appearance/font", cookie=second)
    check("another account has none", st == 404, st)
    st, b, _, _ = call("POST", "/api/appearance/font", raw=b"PK\x03\x04zipzip", cookie=owner,
                       headers={"X-Filename": "f.ttf"})
    check("a zip is refused", st == 400 and "does not look like a font" in b["error"], b)
    st, b, _, _ = call("POST", "/api/appearance/font", raw=FONT, cookie=owner, headers={"X-Filename": "f.exe"})
    check("a wrong extension is refused", st == 400 and b["error"] == "JR!TER takes .ttf, .otf, .woff or .woff2, not .exe", b)
    st, b, _, _ = call("POST", "/api/appearance/font", raw=b"x" * (8 * 1024 * 1024 + 1), cookie=owner,
                       headers={"X-Filename": "f.ttf"})
    check("too big is refused", st == 400 and "8 MB" in b["error"], b)
    st, b, _, _ = call("POST", "/api/appearance/font", raw=b"OTTO" + b"1" * 20, cookie=owner,
                       headers={"X-Filename": "New.otf"})
    check("a new font replaces the old", st == 200 and b["font"]["font_format"] == "font/otf"
          and sorted(os.listdir(os.path.join(config.home(1), "appearance"))) == ["display.otf", "display.otf.name"], b)
    st, b, _, _ = call("DELETE", "/api/appearance/font", cookie=owner)
    check("clear it", st == 200 and b == {"ok": True, "font": {"custom_font": False}}, b)
    st, _, _, _ = call("GET", "/api/appearance/font")
    check("gone again", st == 404, st)

    # -- a small library, through Spring -------------------------------------------------------
    def song(title):
        return call("POST", "/api/songs", {"title": title}, cookie=owner)[1]["song"]["id"]

    s_arviz = song("Árvíztűrő / dal")
    s_half = song("Halfway Under")
    s_empty = song("Quiet one")
    call("POST", "/api/songs/%d/lyrics" % s_arviz, {"text": "# Verse\nthe winter in my head\nla la"}, cookie=owner)
    call("POST", "/api/songs/%d/lyrics" % s_half, {"text": "# Hook\nhalf way under water"}, cookie=owner)
    call("PATCH", "/api/songs/%d" % s_half, {"title": "Halfway Under (final)", "notes": "  keep the bass  "}, cookie=owner)
    wav = make_wav()
    st, b, _, _ = call("POST", "/api/songs/%d/versions" % s_half, raw=wav, cookie=owner,
                       headers={"X-Filename": "take.wav", "X-Label": "loud one", "Content-Type": "application/octet-stream"})
    check("upload a version", st == 200, b)
    vid = b["version"]["id"]
    wav_digest = hashlib.sha256(wav).hexdigest()
    st, b, _, _ = call("POST", "/api/songs/%d/artwork" % s_half, raw=PNG, cookie=owner,
                       headers={"X-Filename": "front.png", "X-Caption": "the winter cover"})
    check("add artwork", st == 200, b)
    st, b, _, _ = call("POST", "/api/albums", {"title": "First Light"}, cookie=owner)
    album = b["album"]["id"]
    call("POST", "/api/albums/%d/songs" % album, {"song_id": s_half}, cookie=owner)
    st, b, _, _ = call("PUT", "/api/albums/%d/cover" % album, raw=PNG, cookie=owner, headers={"X-Filename": "c.png"})
    st, b, _, _ = call("POST", "/api/playlists", {"title": "Road trip"}, cookie=owner)
    playlist = b["playlist"]["id"]
    call("POST", "/api/playlists/%d/items" % playlist, {"song_id": s_half}, cookie=owner)
    now = time.time()
    with who.acting_as(1):
        db.run("INSERT INTO arrangements (song_id, version_id, bpm, offset, per_bar, enabled, data, updated_at) "
               "VALUES (?, ?, 120, 0.25, 4, 1, ?, ?)", (s_half, vid, json.dumps({"clips": [{"from": 1, "beats": 8}]}), now))
        db.run("INSERT INTO sound_presets (song_id, name, is_current, data, created_at, updated_at) "
               "VALUES (?, 'Warm', 1, '{\"gain\": 2}', ?, ?)", (s_half, now, now))
    with who.acting_as(1):
        db.run("INSERT INTO sound_presets (song_id, name, is_current, data, created_at, updated_at) "
               "VALUES (?, 'Plain', 0, '{}', ?, ?)", (s_half, now, now))

    # -- export ----------------------------------------------------------------------------------
    def spring_zip(path):
        st, _, content, h = call("GET", path, cookie=owner)
        return st, zipfile.ZipFile(io.BytesIO(content)), h

    def python_zip(audio):
        with who.acting_as(1):
            r = export.take(fake({"audio": "1"} if audio else {}))
        return zipfile.ZipFile(r.path)

    for audio in (False, True):
        st, sz, h = spring_zip("/api/export" + ("?audio=1" if audio else ""))
        pz = python_zip(audio)
        check("export%s: a zip with a filename" % (" with audio" if audio else ""),
              st == 200 and h["Content-Type"] == "application/zip"
              and re.match(r'attachment; filename="jriter-\d{4}-\d\d-\d\d\.zip"', h["Content-Disposition"]), h)
        sj, pj = json.loads(sz.read("library.json")), json.loads(pz.read("library.json"))
        check("export: same library.json (apart from the time)",
              same({k: v for k, v in sj.items() if k != "taken_at"}, {k: v for k, v in pj.items() if k != "taken_at"}),
              [t for t in pj["tables"] if pj["tables"][t] != sj["tables"].get(t)])
        check("export: same file list", sorted(sz.namelist()) == sorted(pz.namelist()), (sz.namelist(), pz.namelist()))
        diff = [n for n in pz.namelist() if n.endswith((".md", ".txt")) and n != "README.txt"
                and sz.read(n) != pz.read(n)]
        check("export: same words and song.txt", not diff, [(n, sz.read(n)[:300], pz.read(n)[:300]) for n in diff[:1]])
        strip = lambda z: re.sub(r"Taken [^\n]*", "", z.read("README.txt").decode())
        check("export: same README", strip(sz) == strip(pz))
        if audio:
            check("export: audio bytes are the blob", [sz.read(n) for n in sz.namelist() if n.startswith("audio/" + wav_digest)] == [wav])
    check("export: no secrets in the library file", "password" not in sz.read("library.json").decode().lower())
    st, _, _, _ = call("GET", "/api/export")
    check("export needs a sign-in", st == 401)

    # -- import ----------------------------------------------------------------------------------
    with who.acting_as(1):
        pz_path = export.take(fake({"audio": "1"})).path
    zbytes = open(pz_path, "rb").read()
    st, sp, _, _ = call("POST", "/api/import", raw=zbytes, cookie=second)
    with who.acting_as(3):
        py_counts = export.bring_in(fake(raw=zbytes))
    check("import counts equal Python's", st == 200 and sp == py_counts and sp["songs"] == 3, (sp, py_counts))
    a, b2 = tables_of(2), tables_of(3)
    check("import: same row counts per table", a == b2 and a["songs"] == 3 and a["versions"] == 1, (a, b2))
    check("import: audio came along", os.path.isfile(os.path.join(config.home(2), "blobs", wav_digest[:2], wav_digest[2:4], wav_digest)))
    check("import: current render link followed",
          py_rows(2, "SELECT current_version_id FROM songs WHERE title LIKE 'Halfway%'")[0]["current_version_id"]
          == py_rows(2, "SELECT id FROM versions")[0]["id"]
          or py_rows(3, "SELECT current_version_id FROM songs WHERE title LIKE 'Halfway%'")[0]["current_version_id"] is None)
    st, sp2, _, _ = call("POST", "/api/import", raw=zbytes, cookie=second)
    check("importing again adds again", st == 200 and sp2["songs"] == 3 and tables_of(2)["songs"] == 6, sp2)
    st, b, _, _ = call("POST", "/api/import", raw=b"not a zip at all", cookie=second)
    check("not a zip", st == 400 and b["error"] == "That isn't a JR!TER library file (it isn't a zip).", b)
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("other.txt", "x")
    st, b, _, _ = call("POST", "/api/import", raw=buf.getvalue(), cookie=second)
    check("no library.json", st == 400 and "no library.json" in b["error"], b)
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("library.json", json.dumps({"format": "jriter-library", "version": 99, "tables": {}}))
    st, b, _, _ = call("POST", "/api/import", raw=buf.getvalue(), cookie=second)
    check("newer library file", st == 400 and "newer JR!TER" in b["error"], b)
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("library.json", "{oops")
    st, b, _, _ = call("POST", "/api/import", raw=buf.getvalue(), cookie=second)
    check("damaged library.json", st == 400 and "damaged" in b["error"], b)
    # the same file again into the library it came from: its audio is already here
    st, sp3, _, _ = call("POST", "/api/import", raw=zbytes, cookie=owner)
    check("importing a library into itself adds copies", st == 200 and sp3["missing_audio"] == 0
          and sp3["songs"] == 3 and tables_of(1)["songs"] == 6, sp3)
    # -- erase ---------------------------------------------------------------------------------------
    st, b, _, _ = call("GET", "/api/export/erase", cookie=third)
    with who.acting_as(3):
        py_prev = export.what_erase_takes(fake())
    check("erase preview: same names and ways", st == 200 and b["library"] == py_prev["library"]
          and [(g["path"], g["how"]) for g in b["goes"]] == [(g["path"], g["how"]) for g in py_prev["goes"]],
          (b, py_prev))
    st, b, _, _ = call("POST", "/api/export/erase", {"confirm": "nope"}, cookie=third)
    check("erase wants the name", st == 400 and b["error"] == "Type the library's name, JR!TER, to erase it.", b)
    check("nothing went", tables_of(3)["songs"] == 3)
    st, b, _, _ = call("POST", "/api/export/erase", {"confirm": " JR!TER "}, cookie=third)
    check("erase", st == 200 and "every row of songs" in b["gone"] and len(b["left"]) == 3, b)
    t3 = tables_of(3)
    check("no rows left", all(n == 0 for t, n in t3.items() if t != "migrations"), t3)
    left = [f for _, _, fs in os.walk(os.path.join(config.home(3), "blobs")) for f in fs]
    check("no blobs left", not left, left)
    check("the library still works afterwards",
          call("POST", "/api/songs", {"title": "Fresh"}, cookie=third)[0] == 200
          and len(py_rows(3, "SELECT * FROM songs")) == 1)
    check("the other libraries are untouched", tables_of(1)["songs"] == 6 and tables_of(2)["songs"] == 6)
finally:
    if proc:
        proc.terminate()
        try:
            proc.wait(timeout=15)
        except subprocess.TimeoutExpired:
            proc.kill()
    log.close()
    if failures:
        print(open(log.name, "rb").read().decode("utf-8", "replace")[-3000:])
    db.shut_down()
    shutil.rmtree(TMP, ignore_errors=True)

print()
print("%d check(s) failed: %s" % (len(failures), ", ".join(failures)) if failures else "all good")
sys.exit(1 if failures else 0)
