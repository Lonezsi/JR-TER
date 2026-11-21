"""Does the Spring server agree with the Python one on the grave, search and the timetable
(slice 9d, first half)?

Makes a throwaway data directory, starts server/target/jriter.jar on it, drives those three
over HTTP, then reads the same rows back through the Python modules (and asks the Python
modules what they would have answered, in-process). The grave is the part that matters most:
what Spring buries Python must be able to bring back, and the other way round.

    python tools/parity_grave_search.py          (build first: mvn -f server package)

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
import urllib.parse
import urllib.request
import wave

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TMP = tempfile.mkdtemp(prefix="jriter-parity-grave-")
PORT = 7916
JAVA = os.environ.get("JRITER_JAVA") or r"C:\Java\jdk-21\bin\java.exe"
GLASS = os.environ.get("JRITER_GLASS") or os.path.abspath(
    os.path.join(os.path.dirname(ROOT), "foyer", "shared", "glass.css"))

os.environ.update(JRITER_DATA=TMP, JRITER_GLASS=GLASS, JRITER_FOYER="")
sys.path.insert(0, ROOT)
from jriter import accounts, blobs, config, db, registry, who, wire  # noqa: E402
from jriter.modules import auth as pyauth, grave, orarend, search  # noqa: E402

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
        res = urllib.request.urlopen(req, timeout=30)
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


def blob(digest):
    with who.acting_as(1):
        return blobs.path_for(digest)


def same(a, b):
    return json.loads(json.dumps(a)) == json.loads(json.dumps(b))


def fake(query=None, params=None, body=None):
    r = wire.Request("GET", "/", query or {}, {}, None, params or {})
    r._parsed = body if body is not None else {}
    return r


def py_search(q):
    with who.acting_as(1):
        return search.search(fake({"q": q}))


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

    # -- a small library ---------------------------------------------------------------
    def song(title):
        return call("POST", "/api/songs", {"title": title}, cookie=owner)[1]["song"]["id"]

    s_arviz = song("Árvíztűrő")
    s_half = song("Halfway Under")
    s_pct = song("100% Done")
    s_winter = song("Winter Light")
    call("PATCH", "/api/songs/%d" % s_winter, {"title": "Winter Light (final)"}, cookie=owner)
    call("POST", "/api/songs/%d/lyrics" % s_arviz, {"text": "# Verse\nthe winter in my head\nla la"}, cookie=owner)
    call("POST", "/api/songs/%d/lyrics" % s_half, {"text": "# Hook\nhalf way under water"}, cookie=owner)
    wav = make_wav()
    st, b, _, _ = call("POST", "/api/songs/%d/versions" % s_half, raw=wav, cookie=owner,
                       headers={"X-Filename": "take.wav", "X-Label": "loud one",
                                "Content-Type": "application/octet-stream"})
    check("upload a version", st == 200, b)
    vid = b["version"]["id"]
    wav_digest = hashlib.sha256(wav).hexdigest()
    st, b, _, _ = call("POST", "/api/songs/%d/artwork" % s_half, raw=PNG, cookie=owner,
                       headers={"X-Filename": "front.png", "X-Caption": "the winter cover"})
    check("add artwork", st == 200, b)
    img = b["image"]["id"]
    png_digest = hashlib.sha256(PNG).hexdigest()
    st, b, _, _ = call("POST", "/api/albums", {"title": "First Light"}, cookie=owner)
    album = b["album"]["id"]
    call("POST", "/api/albums/%d/songs" % album, {"song_id": s_half}, cookie=owner)
    st, b, _, _ = call("POST", "/api/playlists", {"title": "Road trip"}, cookie=owner)
    playlist = b["playlist"]["id"]
    call("POST", "/api/playlists/%d/items" % playlist, {"song_id": s_half}, cookie=owner)

    # -- search --------------------------------------------------------------------------
    for q in ["half", "winter", "árvíz", "ÁRVÍZ", "1", "100%", "\"half way\"", "winter -light",
              "is:song", "is:song renders:>0", "is:song renders:0", "has:words", "has:art", "has:renders",
              "album:\"first\"", "-album:first is:song", "length:>0:00", "touched:<7d", "made:>2020-01",
              "made:<2020", "loud", "cover", "road", "is:album", "is:lyric winter", "is:playlist", "x:y",
              "word:half", "", "  "]:
        st, b, _, _ = call("GET", "/api/search?q=" + urllib.request.quote(q), cookie=owner)
        py = py_search(q)
        check("search %r equals Python's" % q, st == 200 and same(b, py), (b, py))
    st, b, _, _ = call("GET", "/api/search?q=a&limit=2", cookie=owner)
    check("search limit", st == 200 and all(len(g["hits"]) <= 2 for g in b["groups"]), b)
    st, b, _, _ = call("GET", "/api/search?q=winter", cookie=friend)
    check("another account finds none of it", st == 200 and b["groups"] == [], b)
    st, b, _, _ = call("GET", "/api/search?q=winter&limit=x", cookie=owner)
    check("limit must be a number", st == 400, b)

    # -- the grave: Spring buries, Spring restores ------------------------------------------
    before = {t: py_rows(1, "SELECT * FROM %s ORDER BY rowid" % t) for t in
              ("songs", "versions", "lyric_sheets", "lyric_revisions", "artwork", "album_songs", "playlist_items")}
    st, b, _, _ = call("DELETE", "/api/songs/%d" % s_half, cookie=owner)
    check("delete a song", st == 200, b)
    st, b, _, _ = call("GET", "/api/grave", cookie=owner)
    items = b["items"] if b else []
    check("it is in the grave", st == 200 and len(items) == 1 and items[0]["kind"] == "song"
          and items[0]["title"] == "Halfway Under" and items[0]["kind_said"] == "Song"
          and b["keep_days"] == 30 and abs(items[0]["goes_at"] - items[0]["deleted_at"] - 30 * 86400) < 1, b)
    gid = items[0]["id"]
    with who.acting_as(1):
        py_list = grave.listing(fake())
    check("grave list equals Python's", same(b, py_list), (b, py_list))
    check("the song's rows are gone", not py_rows(1, "SELECT * FROM songs WHERE id = ?", (s_half,))
          and not py_rows(1, "SELECT * FROM versions"))
    check("its files are kept", os.path.isfile(blob(wav_digest)) and os.path.isfile(blob(png_digest)))
    row = py_rows(1, "SELECT * FROM grave")[0]
    tables = json.loads(row["tables"])
    check("grave row shape: tables, digests",
          set(tables) >= {"songs", "versions", "lyric_sheets", "lyric_revisions", "artwork", "album_songs", "playlist_items"}
          and row["digests"].split() == sorted([wav_digest, png_digest]), row)
    st, b, _, _ = call("POST", "/api/grave/%d/restore" % gid, cookie=owner)
    check("restore through Spring", st == 200 and b["restored"] == "song" and b["title"] == "Halfway Under"
          and b["rows"] > 5, b)
    after = {t: py_rows(1, "SELECT * FROM %s ORDER BY rowid" % t) for t in before}
    check("everything is back with the ids it had", same(before, after),
          {t: (before[t], after[t]) for t in before if not same(before[t], after[t])})
    check("grave is empty again", not py_rows(1, "SELECT * FROM grave"))
    st, b, _, _ = call("POST", "/api/grave/%d/restore" % gid, cookie=owner)
    check("restoring twice is a 404", st == 404 and b["error"] == "That's not in the grave any more.", b)

    # -- the grave: Spring buries, Python restores -------------------------------------------
    call("DELETE", "/api/songs/%d" % s_half, cookie=owner)
    gid = py_rows(1, "SELECT id FROM grave")[0]["id"]
    with who.acting_as(1):
        got = grave.bring_back(fake(params={"id": str(gid)}))
    after = {t: py_rows(1, "SELECT * FROM %s ORDER BY rowid" % t) for t in before}
    check("Python restores what Spring buried", got["restored"] == "song" and same(before, after), got)

    # -- the grave: Python buries, Spring restores -------------------------------------------
    with who.acting_as(1):
        grave.bury_song(s_half)
        db.run("DELETE FROM songs WHERE id = ?", (s_half,))
    gid = py_rows(1, "SELECT id FROM grave")[0]["id"]
    st, b, _, _ = call("POST", "/api/grave/%d/restore" % gid, cookie=owner)
    after = {t: py_rows(1, "SELECT * FROM %s ORDER BY rowid" % t) for t in before}
    check("Spring restores what Python buried", st == 200 and same(before, after), b)

    # -- a taken id gets a new one, and links follow ---------------------------------------
    call("DELETE", "/api/songs/%d" % s_half, cookie=owner)
    taken = song("Taker")        # reuses the freed rowid? only when it was the highest
    st, b, _, _ = call("POST", "/api/grave/%d/restore" % py_rows(1, "SELECT id FROM grave")[0]["id"], cookie=owner)
    back = py_rows(1, "SELECT id FROM songs WHERE title = 'Halfway Under'")
    check("restored when its id was taken or free", st == 200 and len(back) == 1, b)
    new_id = back[0]["id"]
    check("its renders follow it", [r["song_id"] for r in py_rows(1, "SELECT song_id FROM versions")] == [new_id]
          and py_rows(1, "SELECT current_version_id FROM songs WHERE id = ?", (new_id,))[0]["current_version_id"]
          == py_rows(1, "SELECT id FROM versions")[0]["id"])
    s_half = new_id

    # -- the other things that bury ----------------------------------------------------------
    kinds = []
    st, b, _, _ = call("DELETE", "/api/versions/%d" % py_rows(1, "SELECT id FROM versions")[0]["id"], cookie=owner)
    check("delete a version", st == 200, b)
    st, b, _, _ = call("DELETE", "/api/artwork/%d" % py_rows(1, "SELECT id FROM artwork")[0]["id"], cookie=owner)
    check("delete an image", st == 200, b)
    sheet = py_rows(1, "SELECT id FROM lyric_sheets WHERE song_id = ?", (s_half,))[0]["id"]
    st, b, _, _ = call("DELETE", "/api/lyrics/%d" % sheet, cookie=owner)
    check("delete words", st == 200, b)
    st, b, _, _ = call("DELETE", "/api/playlists/%d" % playlist, cookie=owner)
    check("delete a playlist", st == 200, b)
    st, b, _, _ = call("DELETE", "/api/albums/%d" % album, cookie=owner)
    check("delete an album", st == 200, b)
    st, b, _, _ = call("GET", "/api/grave", cookie=owner)
    kinds = sorted(i["kind"] for i in b["items"])
    check("each went to the grave", kinds == ["album", "image", "playlist", "sheet", "version"], kinds)
    check("the take's and picture's files are kept while buried",
          os.path.isfile(blob(wav_digest)) and os.path.isfile(blob(png_digest)))
    ver = [i for i in b["items"] if i["kind"] == "version"][0]
    check("a version is titled by number and song", ver["title"].startswith("v1 of "), ver)
    st, b2, _, _ = call("POST", "/api/grave/%d/restore" % ver["id"], cookie=owner)
    check("restore a version", st == 200 and b2["rows"] == 1 and len(py_rows(1, "SELECT * FROM versions")) == 1, b2)
    st, b2, _, _ = call("POST", "/api/grave/%d/restore" % [i for i in b["items"] if i["kind"] == "album"][0]["id"], cookie=owner)
    check("restore an album", st == 200 and len(py_rows(1, "SELECT * FROM albums")) == 1, b2)

    # -- letting go ----------------------------------------------------------------------
    st, b, _, _ = call("DELETE", "/api/grave/999", cookie=owner)
    check("forget what is not there", st == 404, b)
    st, b, _, _ = call("DELETE", "/api/grave/x", cookie=owner)
    check("forget a bad id", st == 404, b)
    st, b, _, _ = call("GET", "/api/grave", cookie=friend)
    check("another account's grave is its own", st == 200 and b["items"] == [], b)
    st, b, _, _ = call("DELETE", "/api/grave", cookie=owner)
    check("empty the grave", st == 200 and b["forgotten"] == 3, b)
    check("grave is empty", not py_rows(1, "SELECT * FROM grave"))
    check("the picture, kept by nothing now, is gone; the take is back in use",
          not os.path.exists(blob(png_digest)) and os.path.isfile(blob(wav_digest)))

    # -- a render in the grave keeps its file even when a delete asks for it ------------------
    st, b, _, _ = call("DELETE", "/api/versions/%d" % py_rows(1, "SELECT id FROM versions")[0]["id"], cookie=owner)
    check("deleting the last use of a file while it is buried keeps the file",
          st == 200 and os.path.isfile(blob(wav_digest)))
    st, b, _, _ = call("DELETE", "/api/grave", cookie=owner)
    check("emptying then lets the file go", not os.path.exists(blob(wav_digest)))

    # -- old things leave on their own --------------------------------------------------------
    s_old = song("Ancient")
    call("DELETE", "/api/songs/%d" % s_old, cookie=owner)
    with who.acting_as(1):
        db.run("UPDATE grave SET deleted_at = ?", (time.time() - 31 * 86400,))
    st, b, _, _ = call("GET", "/api/grave", cookie=owner)
    check("after thirty days it is gone", st == 200 and b["items"] == [], b)

    # -- the timetable -------------------------------------------------------------------------
    home = config.home(1)
    week_path = os.path.join(home, "orarend.json")
    st, b, _, _ = call("GET", "/api/orarend", cookie=owner)
    with who.acting_as(1):
        py = orarend.week(fake())
    check("no week yet: same answer as Python", st == 200 and b["missing"] is True and same(b, py), (b, py))
    with open(week_path, "w", encoding="utf-8") as f:
        json.dump({"classes": [{"day": 0, "at": "08:00", "to": "09:30", "name": "Webprogramozás", "kind": "ea"},
                               {"day": 2, "at": "10:00", "to": "11:30", "name": "Analízis", "id": 77}]}, f)
    for who_name, cookie, acc in (("owner", owner, 1), ("a friend", friend, 2)):
        st, b, _, _ = call("GET", "/api/orarend", cookie=cookie)
        with who.acting_as(acc):
            py = orarend.week(fake())
        check("week for %s equals Python's" % who_name, st == 200 and same(b, py), (b, py))
    st, b, _, _ = call("GET", "/api/orarend", cookie=friend)
    check("a friend reads the owner's week, read-only", b["readonly"] is True and len(b["classes"]) == 2, b)
    st, b, _, _ = call("POST", "/api/orarend/classes", {"name": "X", "at": "08:00", "to": "09:00"}, cookie=friend)
    check("only the owner edits (Hungarian refusal)", st == 403 and b["error"].startswith("Ezt az órarendet csak "), b)
    for bad, text in [({"at": "08:00", "to": "09:00"}, "name is required"),
                      ({"name": "X", "to": "09:00"}, "at is required"),
                      ({"name": "X", "at": "9am", "to": "10:00"}, "at should be a time like 09:30, not '9am'"),
                      ({"name": "X", "at": "25:00", "to": "26:00"}, "at is not a time of day: '25:00'"),
                      ({"name": "X", "at": "10:00", "to": "09:00"}, "a class cannot finish before it starts"),
                      ({"name": "X", "at": "09:00", "to": "10:00", "day": 5}, "the week has five days, so day is 0 to 4"),
                      ({"name": "X", "at": "09:00", "to": "10:00", "day": "x"}, "day must be a whole number"),
                      ({"name": "X", "at": "09:00", "to": "10:00", "kind": "zz"}, "kind is one of ea, gy, both, konz, band")]:
        st, b, _, _ = call("POST", "/api/orarend/classes", dict({"day": 1}, **bad), cookie=owner)
        check("class refused: %s" % text, st == 400 and b["error"] == text, b)
    st, b, _, _ = call("POST", "/api/orarend/classes",
                       {"name": " Fizika ", "at": "12:00", "to": "13:30", "day": 3, "where": "Déli 3.12",
                        "skip": 1, "extra": "ignored"}, cookie=owner)
    check("add a class", st == 200 and len(b["classes"]) == 3 and b["classes"][2]["name"] == "Fizika"
          and b["classes"][2]["skip"] is True and b["classes"][2]["kind"] == "gy"
          and b["classes"][2]["whose"] == "me" and "extra" not in b["classes"][2], b)
    new_key = b["classes"][2]["key"]
    on_disk = json.load(open(week_path, encoding="utf-8"))
    check("the file keeps the hand-typed classes untouched",
          on_disk["classes"][0] == {"day": 0, "at": "08:00", "to": "09:30", "name": "Webprogramozás", "kind": "ea"}
          and on_disk["classes"][1]["id"] == 77, on_disk)
    check("the file is written as Python writes it (indent 2, UTF-8, no trailing newline)",
          open(week_path, "rb").read() == json.dumps(on_disk, ensure_ascii=False, indent=2).encode("utf-8"))
    st, b, _, _ = call("PUT", "/api/orarend/classes/" + new_key, {"name": "Fizika 2", "at": "12:15"}, cookie=owner)
    check("edit a class", st == 200 and b["classes"][2]["name"] == "Fizika 2" and b["classes"][2]["at"] == "12:15"
          and b["classes"][2]["where"] == "Déli 3.12", b)
    st, b, _, _ = call("PUT", "/api/orarend/classes/i:0", {"at": "08:30"}, cookie=owner)
    check("a hand-typed class gets an id on its first edit", st == 200 and b["classes"][0]["at"] == "08:30"
          and b["classes"][0]["key"] != "i:0", b)
    st, b, _, _ = call("PUT", "/api/orarend/classes/i:0", {"at": "08:45"}, cookie=owner)
    check("its old position no longer names it", st == 409, b)
    st, b, _, _ = call("PUT", "/api/orarend/classes/i:9", {"at": "08:45"}, cookie=owner)
    check("no class at a position", st == 404 and b["error"] == "there is no class at i:9 any more", b)
    st, b, _, _ = call("PUT", "/api/orarend/classes/12345", {"at": "08:45"}, cookie=owner)
    check("no class with an id", st == 404 and b["error"] == "no class with id 12345", b)
    st, b, _, _ = call("DELETE", "/api/orarend/classes/77", cookie=friend)
    check("a friend cannot drop one", st == 403, b)
    st, b, _, _ = call("DELETE", "/api/orarend/classes/77", cookie=owner)
    check("drop a class", st == 200 and len(b["classes"]) == 2 and all(c.get("id") != 77 for c in b["classes"]), b)
    with who.acting_as(1):
        py = orarend.week(fake())
    st, b, _, _ = call("GET", "/api/orarend", cookie=owner)
    check("after the edits Spring and Python still read the same week", same(b, py), (b, py))
    with open(week_path, "w", encoding="utf-8") as f:
        f.write("{ not json")
    st, b, _, _ = call("GET", "/api/orarend", cookie=owner)
    check("a broken week is reported, not fatal", st == 200 and b["classes"] == [] and b.get("broken"), b)
    st, b, _, _ = call("POST", "/api/orarend/classes", {"name": "X", "at": "08:00", "to": "09:00"}, cookie=owner)
    check("a broken week is not written over", st == 409 and "not being written over" in b["error"], b)
    check("and the file is as it was", open(week_path, encoding="utf-8").read() == "{ not json")

    # notes, pages, absences: each account's own
    st, b, _, _ = call("GET", "/api/orarend/notes", cookie=owner)
    check("subject is required", st == 400 and b["error"] == "which subject?", b)
    st, b, _, _ = call("GET", "/api/orarend/notes?subject=Analízis", cookie=owner)
    check("reading notes makes nothing", st == 200 and b == {"subject": "Analízis", "absences": 0, "allowed": 3, "pages": []}
          and not py_rows(1, "SELECT * FROM orarend_notes"), b)
    st, b, _, _ = call("PUT", "/api/orarend/notes?subject=Analízis", {"absences": 9}, cookie=owner)
    check("absences are clamped to three", st == 200 and b["absences"] == 3, b)
    st, b, _, _ = call("PUT", "/api/orarend/notes?subject=Analízis", {"absences": -1}, cookie=owner)
    check("negative absences are refused", st == 400 and b["error"] == "absences must be at least 0", b)
    st, b, _, _ = call("PUT", "/api/orarend/notes", {"subject": "Analízis", "absences": 1}, cookie=owner)
    check("the subject can come in the body", st == 200 and b["absences"] == 1, b)
    st, b, _, _ = call("POST", "/api/orarend/notes/pages?subject=Analízis", {"text": "first"}, cookie=owner)
    st, b, _, _ = call("POST", "/api/orarend/notes/pages?subject=Analízis", {"text": "second"}, cookie=owner)
    check("pages are kept in order", st == 200 and [p["text"] for p in b["pages"]] == ["first", "second"]
          and [p["position"] for p in b["pages"]] == [0, 1], b)
    page = b["pages"][0]["id"]
    st, b, _, _ = call("PUT", "/api/orarend/notes/pages/%d" % page, {"text": "# changed"}, cookie=owner)
    check("save a page", st == 200 and b["pages"][0]["text"] == "# changed" and b["subject"] == "Analízis", b)
    with who.acting_as(1):
        py = orarend.notes(fake({"subject": "Analízis"}))
    st, b2, _, _ = call("GET", "/api/orarend/notes?subject=Analízis", cookie=owner)
    check("notes equal Python's", same(b2, py), (b2, py))
    st, b, _, _ = call("GET", "/api/orarend/notes?subject=Analízis", cookie=friend)
    check("a friend's notes are their own", b["pages"] == [] and b["absences"] == 0, b)
    st, b, _, _ = call("PUT", "/api/orarend/notes/pages/%d" % page, {"text": "hijack"}, cookie=friend)
    check("a friend cannot reach the owner's page", st == 404, b)
    st, b, _, _ = call("DELETE", "/api/orarend/notes/pages/%d" % page, cookie=owner)
    check("drop a page", st == 200 and [p["text"] for p in b["pages"]] == ["second"], b)
    st, b, _, _ = call("DELETE", "/api/orarend/notes/pages/9999", cookie=owner)
    check("no such page", st == 404 and b["error"] == "no page with id 9999", b)
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
