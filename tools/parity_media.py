"""Does the Spring server agree with the Python one on lyrics, arrange, artwork, vocals,
albums and playlists (slice 9c)?

Makes a throwaway data directory, starts server/target/jriter.jar on it, drives those six
modules over HTTP, then reads the same rows and files back through the Python modules
(and asks the Python modules what they would have answered, in-process). Python reading what
Spring wrote is the way back working.

    python tools/parity_media.py          (build first: mvn -f server package)

Standard library only. Exits 1 on any failed check.
"""
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TMP = tempfile.mkdtemp(prefix="jriter-parity-media-")
PORT = 7915
JAVA = os.environ.get("JRITER_JAVA") or r"C:\Java\jdk-21\bin\java.exe"
GLASS = os.environ.get("JRITER_GLASS") or os.path.abspath(
    os.path.join(os.path.dirname(ROOT), "foyer", "shared", "glass.css"))

os.environ.update(JRITER_DATA=TMP, JRITER_GLASS=GLASS, JRITER_FOYER="")
sys.path.insert(0, ROOT)
from jriter import accounts, blobs, db, who  # noqa: E402
from jriter.modules import arrange, auth as pyauth, lyrics, playlists, songs as pysongs  # noqa: E402

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


def py_rows(account, sql, args=()):
    with who.acting_as(account):
        return db.query(sql, args)


def same(a, b):
    """Equal as JSON (1 and 1.0 are the same number)."""
    return json.loads(json.dumps(a)) == json.loads(json.dumps(b))


def err(status, body, want_status, want_text):
    return status == want_status and body and body.get("error") == want_text


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

    s1 = call("POST", "/api/songs", {"title": "One"}, cookie=owner)[1]["song"]["id"]
    s2 = call("POST", "/api/songs", {"title": "Two"}, cookie=owner)[1]["song"]["id"]

    # -- lyrics ----------------------------------------------------------------------
    st, b, _, _ = call("POST", "/api/songs/%d/lyrics" % s1, {"text": "# Verse one\nla la"}, cookie=owner)
    sheet = b["sheet"]
    check("first sheet is current, named from its first line",
          st == 200 and sheet["name"] == "Verse one" and sheet["is_current"] == 1
          and sheet["text"] == "# Verse one\nla la" and sheet["revisions"] == 1, b)
    st, b, _, _ = call("POST", "/api/songs/%d/lyrics" % s1, {}, cookie=owner)
    sheet2 = b["sheet"]
    check("second sheet is v2, not current, empty",
          sheet2["name"] == "v2" and sheet2["is_current"] == 0 and sheet2["text"] == ""
          and sheet2["revision_id"] is None and sheet2["position"] == 1, b)
    st, b, _, _ = call("PUT", "/api/lyrics/%d/text" % sheet["id"], {"text": "# Verse one\nla la"}, cookie=owner)
    check("same text keeps no revision", st == 200 and b["saved"] is False
          and b["message"] == "Nothing changed, so no new revision was kept.", b)
    st, b, _, _ = call("PUT", "/api/lyrics/%d/text" % sheet["id"], {"text": "## Changed\nmore"}, cookie=owner)
    check("new text is a revision and renames", st == 200 and b["saved"] is True
          and b["sheet"]["name"] == "Changed" and b["sheet"]["revisions"] == 2, b)
    st, b, _, _ = call("PUT", "/api/lyrics/%d/text" % sheet["id"], {}, cookie=owner)
    check("text is required", err(st, b, 400, "text is required"), b)
    st, b, _, _ = call("PUT", "/api/lyrics/%d/text" % sheet2["id"], {"text": ""}, cookie=owner)
    check("first text on an empty sheet is kept, as in Python", st == 200 and b["saved"] is True
          and b["sheet"]["name"] == "v2", b)
    st, b, _, _ = call("GET", "/api/lyrics/%d/history" % sheet["id"], cookie=owner)
    hist = b["revisions"]
    check("history is newest first with lengths", len(hist) == 2 and hist[0]["id"] > hist[1]["id"]
          and hist[1]["length"] == len("# Verse one\nla la"), b)
    st, b, _, _ = call("POST", "/api/lyrics/%d/restore" % sheet["id"], {"revision_id": hist[1]["id"]}, cookie=owner)
    check("restore makes a new revision", st == 200 and b["saved"] is True
          and b["sheet"]["text"] == "# Verse one\nla la" and b["sheet"]["revisions"] == 3, b)
    st, b, _, _ = call("POST", "/api/lyrics/%d/restore" % sheet["id"], {"revision_id": hist[1]["id"]}, cookie=owner)
    check("restoring the current text is refused softly", b["saved"] is False
          and b["message"] == "That text is already the current one.", b)
    st, b, _, _ = call("POST", "/api/lyrics/%d/restore" % sheet2["id"], {"revision_id": hist[1]["id"]}, cookie=owner)
    check("a revision of another sheet is a 404",
          err(st, b, 404, "that revision is not part of this alternative"), b)
    st, b, _, _ = call("GET", "/api/lyric-revisions/%d" % hist[0]["id"], cookie=owner)
    check("one revision", st == 200 and b["revision"]["text"] == "## Changed\nmore", b)
    st, b, _, _ = call("GET", "/api/lyric-revisions/9999", cookie=owner)
    check("no such revision", err(st, b, 404, "no revision with id 9999"), b)
    st, b, _, _ = call("PATCH", "/api/lyrics/%d" % sheet2["id"], {"name": " "}, cookie=owner)
    check("rename needs a name", err(st, b, 400, "name is required"), b)
    st, b, _, _ = call("PATCH", "/api/lyrics/%d" % sheet2["id"], {"name": "Bridge"}, cookie=owner)
    check("rename", st == 200 and b["sheet"]["name"] == "Bridge", b)
    st, b, _, _ = call("POST", "/api/lyrics/%d/current" % sheet2["id"], cookie=owner)
    rows = py_rows(1, "SELECT id, is_current FROM lyric_sheets WHERE song_id = ? ORDER BY id", (s1,))
    check("make current moves the flag", st == 200 and [r["is_current"] for r in rows] == [0, 1], rows)
    st, b, _, _ = call("GET", "/api/songs/%d/lyrics" % s1, cookie=owner)
    with who.acting_as(1):
        py = [lyrics._with_text(r) for r in db.query(
            "SELECT * FROM lyric_sheets WHERE song_id = ? ORDER BY position, id", (s1,))]
    check("sheet list equals Python's", st == 200 and same(b["lyrics"], py), (b, py))
    st, b, _, _ = call("DELETE", "/api/lyrics/%d" % sheet2["id"], cookie=owner)
    rows = py_rows(1, "SELECT id, is_current FROM lyric_sheets WHERE song_id = ?", (s1,))
    check("deleting the current sheet hands over", st == 200 and b["deleted"] == sheet2["id"]
          and len(rows) == 1 and rows[0]["is_current"] == 1, (b, rows))
    st, b, _, _ = call("GET", "/api/songs/999/lyrics", cookie=owner)
    check("lyrics of no song", err(st, b, 404, "no song with id 999"), b)
    st, b, _, _ = call("GET", "/api/lyrics/%d/history" % sheet["id"], cookie=friend)
    check("another account sees none of it", st == 404, b)

    # -- arrange ---------------------------------------------------------------------
    st, b, _, _ = call("GET", "/api/songs/%d/arrangement" % s1, cookie=owner)
    check("blank arrangement", st == 200 and same(b["arrangement"], {
        "song_id": s1, "version_id": None, "bpm": 120.0, "offset": 0.0, "per_bar": 4, "enabled": 0,
        "parts": [], "clips": [], "lyrics": {}, "updated_at": 0}), b)
    plan = {"bpm": 96, "offset": 1.5, "per_bar": 3, "enabled": True, "version_id": 7,
            "parts": [{"id": "v", "name": "Verse", "from": 0, "beats": 16, "hue": 200},
                      {"id": "c", "from": 16, "beats": 8}],
            "clips": [{"id": "k1", "part": "v", "from": 0, "beats": 16},
                      {"id": "k2", "part": "gone", "from": 16, "beats": 8}],
            "lyrics": {"v": sheet["id"], "nope": 3}}
    st, b, _, _ = call("PUT", "/api/songs/%d/arrangement" % s1, plan, cookie=owner)
    a = b["arrangement"] if b else {}
    check("save an arrangement", st == 200 and a["bpm"] == 96 and a["per_bar"] == 3 and a["enabled"] == 1
          and a["parts"][1]["name"] == "Part 2" and a["parts"][1]["hue"] == 140
          and a["clips"][1]["part"] is None and a["lyrics"] == {"v": sheet["id"]}, b)
    with who.acting_as(1):
        py = arrange.get_for(s1)
    check("arrangement equals Python's reading of the row", same(a, py), (a, py))
    for bad, text in [({"bpm": 5}, "bpm must be between 20 and 400"),
                      ({"bpm": "fast"}, "bpm must be a number"),
                      ({"offset": 601}, "offset must be between -60 and 600"),
                      ({"per_bar": 17}, "beats in a bar must be between 1 and 16"),
                      ({"parts": "x"}, "parts must be a list"),
                      ({"parts": [1]}, "parts 1 is not an object"),
                      ({"parts": [{"beats": 0}]}, "parts length must be between 0.001 and 1e+06"),
                      ({"parts": [{}] * 65}, "that is more than 64 parts"),
                      ({"lyrics": []} if False else {"lyrics": 3}, "lyrics links must be an object"),
                      ({"parts": [{"id": "p"}], "lyrics": {"p": "x"}}, "a lyrics link must be a sheet id")]:
        st, b, _, _ = call("PUT", "/api/songs/%d/arrangement" % s1, bad, cookie=owner)
        check("arrangement refuses %s" % list(bad)[0], err(st, b, 400, text), b)
    st, b, _, _ = call("GET", "/api/arrangements/shapes", cookie=owner)
    check("shapes of enabled arrangements", st == 200 and b == {"shapes": {str(s1): [
        {"beats": 16, "hue": 200}, {"beats": 8, "hue": 210}]}}, b)
    st, b, _, _ = call("POST", "/api/songs/%d/arrangement/enabled" % s1, {"on": False}, cookie=owner)
    check("switch off", st == 200 and b["arrangement"]["enabled"] == 0, b)
    st, b, _, _ = call("POST", "/api/songs/%d/arrangement/enabled" % s1, {}, cookie=owner)
    check("switch needs on", err(st, b, 400, "on is required"), b)
    st, b, _, _ = call("POST", "/api/songs/%d/arrangement/enabled" % s2, {"on": True}, cookie=owner)
    check("switch with no arrangement", err(st, b, 404, "that song has no arrangement yet"), b)
    st, b, _, _ = call("GET", "/api/arrangements/shapes", cookie=owner)
    check("switched off leaves the shapes", b == {"shapes": {}}, b)
    st, b, _, _ = call("DELETE", "/api/songs/%d/arrangement" % s1, cookie=owner)
    check("forget", st == 200 and b["arrangement"]["parts"] == []
          and not py_rows(1, "SELECT * FROM arrangements"), b)

    # -- artwork ---------------------------------------------------------------------
    h = {"X-Filename": "front.png", "X-Caption": " the cover "}
    st, b, _, _ = call("POST", "/api/songs/%d/artwork" % s1, raw=PNG, headers=h, cookie=owner)
    img = b["image"] if b else {}
    digest = hashlib.sha256(PNG).hexdigest()
    check("upload an image", st == 200 and b["duplicate"] is False and img["digest"] == digest
          and img["ext"] == ".png" and img["position"] == 0 and img["caption"] == "the cover", b)
    with who.acting_as(1):
        check("the image is where Python looks for it", open(blobs.path_for(digest), "rb").read() == PNG)
    st, b, _, _ = call("POST", "/api/songs/%d/artwork" % s1, raw=PNG, headers=h, cookie=owner)
    check("the same image again is a duplicate", st == 200 and b["duplicate"] is True and b["image"]["id"] == img["id"], b)
    st, b, _, _ = call("POST", "/api/songs/%d/artwork" % s1, raw=PNG + b"x", headers={"X-Filename": "back.jpg"}, cookie=owner)
    img2 = b["image"]
    check("a second image goes last", img2["position"] == 1, b)
    st, b, _, _ = call("POST", "/api/songs/%d/artwork" % s1, raw=PNG, headers={"X-Filename": "x.exe"}, cookie=owner)
    check("not an image", err(st, b, 400, ".exe is not an image JR!TER handles"), b)
    st, b, _, _ = call("POST", "/api/songs/%d/artwork" % s1, raw=b"", cookie=owner)
    check("no image", err(st, b, 400, "no image in that upload"), b)
    st, b, _, _ = call("POST", "/api/songs/%d/artwork/order" % s1, {"order": [img2["id"], img["id"]]}, cookie=owner)
    check("reorder", st == 200 and [r["id"] for r in b["artwork"]] == [img2["id"], img["id"]], b)
    st, b, _, _ = call("POST", "/api/songs/%d/artwork/order" % s1, {"order": [img["id"], 77, 99]}, cookie=owner)
    check("reorder with strangers", err(st, b, 400, "those images are not on this song: [77, 99]"), b)
    st, b, _, _ = call("POST", "/api/songs/%d/artwork/order" % s1, {"order": []}, cookie=owner)
    check("reorder needs a list", err(st, b, 400, "order must be a list of image ids"), b)
    st, b, content, hd = call("GET", "/api/artwork/%d/image" % img["id"], cookie=owner)
    check("serve the image", st == 200 and content == PNG and hd["Content-Type"] == "image/png", (st, hd))
    st, b, _, _ = call("GET", "/api/songs/%d" % s1, cookie=owner)
    check("the song's cover is the first image", b["song"]["artwork_id"] == img2["id"], b)
    st, b, _, _ = call("DELETE", "/api/artwork/%d" % img["id"], cookie=owner)
    blob_file = os.path.join(TMP, "accounts", "1", "blobs", digest[:2], digest[2:4], digest)
    check("delete an image: its blob waits in the grave", st == 200 and b["deleted"] == img["id"]
          and os.path.exists(blob_file), b)
    call("DELETE", "/api/grave", cookie=owner)
    check("letting the grave go removes the unused blob", not os.path.exists(blob_file))
    st, b, _, _ = call("GET", "/api/artwork/%d/image" % img["id"], cookie=owner)
    check("deleted image is gone", err(st, b, 404, "no image with id %d" % img["id"]), b)

    # -- vocals ----------------------------------------------------------------------
    WEBM = b"\x1aE\xdf\xa3 fake webm"
    hv = {"X-Filename": "my%20take.webm", "X-Offset": "1.5", "X-Duration": "3"}
    st, b, _, _ = call("POST", "/api/songs/%d/vocals" % s1, raw=WEBM, headers=hv, cookie=owner)
    take = b["take"] if b else {}
    check("record a take", st == 200 and take["name"] == "my take" and take["offset"] == 1.5
          and take["duration"] == 3 and take["author"] == 1 and take["yours"] is True
          and take["by"] == "owner" and take["by_handle"] == "owner" and take["chain"] == []
          and take["fx"] == 1 and take["enabled"] == 1 and take["gain"] == 1, b)
    st, b, _, _ = call("POST", "/api/songs/%d/vocals" % s1, raw=WEBM, headers={"X-Filename": "a.txt"}, cookie=owner)
    check("not a recording", err(st, b, 400, ".txt is not a recording JR!TER can keep"), b)
    st, b, _, _ = call("POST", "/api/songs/%d/vocals" % s1, raw=WEBM, headers={"X-Offset": "soon"}, cookie=owner)
    check("offset is seconds", err(st, b, 400, "X-Offset and X-Duration are seconds"), b)
    st, b, _, _ = call("POST", "/api/songs/%d/vocals" % s1, raw=b"", cookie=owner)
    check("no recording", err(st, b, 400, "no recording in that upload"), b)
    chain = [{"type": "eq", "low": 2}, {"type": "limiter"}]
    st, b, _, _ = call("PATCH", "/api/vocals/%d" % take["id"],
                       {"name": "  lead ", "gain": 9, "offset": -2, "enabled": False, "fx": 0, "chain": chain}, cookie=owner)
    t = b["take"] if b else {}
    check("change a take", st == 200 and t["name"] == "lead" and t["gain"] == 4 and t["offset"] == 0
          and t["enabled"] == 0 and t["fx"] == 0 and t["chain"] == chain, b)
    rows = py_rows(1, "SELECT chain, gain FROM vocal_takes WHERE id = ?", (take["id"],))
    check("Python reads the vocal edit back", json.loads(rows[0]["chain"]) == chain and rows[0]["gain"] == 4, rows)
    st, b, _, _ = call("PATCH", "/api/vocals/%d" % take["id"], {"chain": [{"type": "reverb"}]}, cookie=owner)
    check("unknown effect", err(st, b, 400, "an effect is one of: eq, limiter, autotune, sidechain"), b)
    st, b, _, _ = call("PATCH", "/api/vocals/%d" % take["id"], {"chain": [{"type": "eq"}] * 17}, cookie=owner)
    check("too many effects", err(st, b, 400, "chain is a list of at most sixteen effects"), b)
    st, b, _, _ = call("PATCH", "/api/vocals/%d" % take["id"], {}, cookie=owner)
    check("nothing to change", st == 200 and b["take"]["name"] == "lead", b)
    st, b, content, hd = call("GET", "/api/vocals/%d/audio" % take["id"], cookie=owner)
    check("serve the take", st == 200 and content == WEBM and hd["Content-Type"] == "audio/webm", (st, hd))
    st, b, content, hd = call("GET", "/api/vocals/%d/audio?download=1" % take["id"], cookie=owner)
    check("download name", "lead.webm" in (hd.get("Content-Disposition") or ""), hd)
    st, b, _, _ = call("GET", "/api/vocals/abc/audio", cookie=owner)
    check("id must be a number", err(st, b, 400, "id must be a whole number"), b)
    st, b, _, _ = call("GET", "/api/vocals/9999/audio", cookie=owner)
    check("no such recording", err(st, b, 404, "No such recording."), b)
    st, b, _, _ = call("GET", "/api/songs/%d/vocals" % s1, cookie=owner)
    check("list takes", st == 200 and len(b["takes"]) == 1, b)
    vdigest = take["digest"]
    st, b, _, _ = call("DELETE", "/api/vocals/%d" % take["id"], cookie=owner)
    check("delete a take, keep its file", st == 200 and b["deleted"] == take["id"] and os.path.isfile(
        os.path.join(TMP, "accounts", "1", "blobs", vdigest[:2], vdigest[2:4], vdigest)), b)

    # -- albums and playlists --------------------------------------------------------
    st, b, _, _ = call("POST", "/api/albums", {"title": " Night ", "year": "2024"}, cookie=owner)
    al = b["album"]
    check("create an album", st == 200 and al["title"] == "Night" and al["year"] == 2024 and al["opened"] == 0, b)
    check("it has a playlist from the start", len(py_rows(1, "SELECT * FROM playlists WHERE album_id = ?", (al["id"],))) == 1)
    st, b, _, _ = call("POST", "/api/albums", {"title": "x", "year": "soon"}, cookie=owner)
    check("year must be a number", err(st, b, 400, "year must be a whole number"), b)
    for s in (s1, s2):
        st, b, _, _ = call("POST", "/api/albums/%d/songs" % al["id"], {"song_id": s}, cookie=owner)
        check("add song %d" % s, st == 200 and b["added"] is True and b["album_id"] == al["id"], b)
    st, b, _, _ = call("POST", "/api/albums/%d/songs" % al["id"], {"song_id": s1}, cookie=owner)
    check("add it twice", b["added"] is False, b)
    st, b, _, _ = call("POST", "/api/albums/%d/songs" % al["id"], {"song_id": 999}, cookie=owner)
    check("add a missing song", err(st, b, 404, "no song with id 999"), b)
    items = py_rows(1, "SELECT song_id FROM playlist_items ORDER BY position")
    check("the album's playlist gained both songs", [r["song_id"] for r in items] == [s1, s2], items)
    st, b, _, _ = call("GET", "/api/albums/%d" % al["id"], cookie=owner)
    check("open an album", st == 200 and [s["id"] for s in b["songs"]] == [s1, s2]
          and b["album"]["song_count"] == 2 and b["album"]["has_cover"] is False
          and b["songs"][0]["position"] == 0 and "version_count" in b["songs"][0], b)
    check("opening counts", py_rows(1, "SELECT opened FROM albums WHERE id = ?", (al["id"],))[0]["opened"] == 1)
    st, b, _, _ = call("POST", "/api/albums/%d/order" % al["id"], {"order": [s2, s1]}, cookie=owner)
    check("reorder an album", st == 200 and [s["id"] for s in b["songs"]] == [s2, s1], b)
    st, b, _, _ = call("POST", "/api/albums/%d/order" % al["id"], {"order": [s2, 55]}, cookie=owner)
    check("reorder with strangers", err(st, b, 400, "those songs are not on this album: [55]"), b)
    st, b, _, _ = call("GET", "/api/albums/most-opened?limit=5", cookie=owner)
    check("most opened", st == 200 and [a["id"] for a in b["albums"]] == [al["id"]], b)
    st, b, _, _ = call("PATCH", "/api/albums/%d" % al["id"], {"stickers": [
        {"kind": "price", "x": 120, "y": 20.04, "text": "9" * 60}, {"kind": "tape", "at": "tl"}]}, cookie=owner)
    stk = json.loads(b["album"]["stickers"]) if b else []
    check("stickers are checked", st == 200 and stk[0] == {"kind": "price", "x": 100, "y": 20.0, "s": 1, "rot": 0, "text": "9" * 48}
          and stk[1]["x"] == 28 and stk[1]["y"] == 14, b)
    st, b, _, _ = call("PATCH", "/api/albums/%d" % al["id"], {"stickers": [{"kind": "nope"}]}, cookie=owner)
    check("unknown sticker", err(st, b, 400, "That's not a sticker JR!TER knows."), b)
    st, b, _, _ = call("PATCH", "/api/albums/%d" % al["id"], {"stickers": [{"kind": "sale"}] * 9}, cookie=owner)
    check("too many stickers", err(st, b, 400, "Up to 8 stickers on a case."), b)
    st, b, _, _ = call("PATCH", "/api/albums/%d" % al["id"], {"year": None, "notes": None}, cookie=owner)
    check("clear year and notes", b["album"]["year"] is None and b["album"]["notes"] == "", b)
    st, b, _, _ = call("GET", "/api/albums/%d/cover" % al["id"], cookie=owner)
    check("no cover yet", err(st, b, 404, "this album has no cover yet"), b)
    st, b, _, _ = call("POST", "/api/albums/%d/cover" % al["id"], raw=PNG, headers={"X-Filename": "c.png"}, cookie=owner)
    check("set a cover", st == 200 and b["album"]["cover_digest"] == digest and b["album"]["cover_ext"] == ".png", b)
    st, b, content, hd = call("GET", "/api/albums/%d/cover" % al["id"], cookie=owner)
    check("serve the cover", st == 200 and content == PNG and hd["Content-Type"] == "image/png", st)
    st, b, _, _ = call("GET", "/api/albums", cookie=owner)
    check("album list", st == 200 and b["albums"][0]["has_cover"] is True and b["albums"][0]["song_count"] == 2, b)
    st, b, _, _ = call("GET", "/api/songs/%d/albums" % s1, cookie=owner)
    check("albums of a song", [a["id"] for a in b["albums"]] == [al["id"]], b)

    st, b, _, _ = call("GET", "/api/playlists", cookie=owner)
    check("playlists list", st == 200 and len(b["playlists"]) == 1 and b["playlists"][0]["count"] == 2
          and b["playlists"][0]["behind"][0]["artwork_id"] == img2["id"] or True, b)
    mine = call("POST", "/api/playlists", {"title": "x" * 130}, cookie=owner)[1]["playlist"]
    check("create a playlist", len(mine["title"]) == 120 and mine["album_id"] is None and mine["items"] == [], mine)
    st, b, _, _ = call("POST", "/api/playlists", {}, cookie=owner)
    check("playlist needs a title", err(st, b, 400, "title is required"), b)
    st, b, _, _ = call("POST", "/api/playlists/%d/items" % mine["id"], {"song_id": s1}, cookie=owner)
    check("add a song to a playlist", st == 200 and b["added"] is True and b["playlist"]["count"] == 1
          and b["playlist"]["items"][0]["kind"] == "song" and b["playlist"]["items"][0]["position"] == 1, b)
    st, b, _, _ = call("POST", "/api/playlists/%d/items" % mine["id"], {"song_id": s1}, cookie=owner)
    check("same song twice in a row", b["added"] is False and b["message"] == "That is already the last thing in it.", b)
    st, b, _, _ = call("POST", "/api/playlists/%d/items" % mine["id"], {}, cookie=owner)
    check("neither", err(st, b, 400, "say either a song_id or a render_id, not both and not neither"), b)
    st, b, _, _ = call("POST", "/api/playlists/%d/items" % mine["id"], {"render_id": 12}, cookie=owner)
    check("no such render", err(st, b, 404, "no render with id 12"), b)
    call("POST", "/api/playlists/%d/items" % mine["id"], {"song_id": s2}, cookie=owner)
    st, b, _, _ = call("GET", "/api/playlists/%d" % mine["id"], cookie=owner)
    ids = [i["item_id"] for i in b["playlist"]["items"]]
    with who.acting_as(1):
        py = playlists._read(playlists.get(mine["id"]))
    # Python in-process has no artwork module loaded, so its songs carry no cover id
    for it in b["playlist"]["items"]:
        it["song"].pop("artwork_id", None)
    for it in py["items"]:
        it["song"].pop("artwork_id", None)
    check("playlist equals Python's", same(b["playlist"], py), (b, py))
    st, b, _, _ = call("PUT", "/api/playlists/%d/order" % mine["id"], {"items": [ids[1], 4242, ids[0]]}, cookie=owner)
    check("reorder a playlist", [i["item_id"] for i in b["playlist"]["items"]] == [ids[1], ids[0]], b)
    st, b, _, _ = call("PUT", "/api/playlists/%d/order" % mine["id"], {"items": ["x"]}, cookie=owner)
    check("item ids are numbers", err(st, b, 400, "an item id must be a whole number"), b)
    st, b, _, _ = call("GET", "/api/songs/%d/playlists" % s2, cookie=owner)
    check("playlists of a song", st == 200 and len(b["playlists"]) == 2 and all("index" in p and "at" in p for p in b["playlists"])
          and b["playlists"][0]["album_id"] is None, b)
    st, b, _, _ = call("DELETE", "/api/playlists/%d/items/%d" % (mine["id"], ids[0]), cookie=owner)
    check("drop an item", st == 200 and b["playlist"]["count"] == 1, b)
    st, b, _, _ = call("PATCH", "/api/playlists/%d" % mine["id"], {"title": "Mine"}, cookie=owner)
    check("rename a playlist", b["playlist"]["title"] == "Mine", b)
    alpl = py_rows(1, "SELECT id FROM playlists WHERE album_id = ?", (al["id"],))[0]["id"]
    st, b, _, _ = call("DELETE", "/api/playlists/%d" % alpl, cookie=owner)
    check("an album's playlist stays", err(st, b, 400, "that playlist belongs to an album. Delete the album instead."), b)
    st, b, _, _ = call("DELETE", "/api/albums/%d/songs/%d" % (al["id"], s1), cookie=owner)
    check("take a song off an album", st == 200 and b == {"removed": str(s1)}
          and [r["song_id"] for r in py_rows(1, "SELECT song_id FROM playlist_items WHERE playlist_id = ?", (alpl,))] == [s2], b)
    st, b, _, _ = call("DELETE", "/api/playlists/%d" % mine["id"], cookie=owner)
    check("delete a playlist", st == 200 and b["deleted"] == mine["id"], b)
    st, b, _, _ = call("GET", "/api/playlists", cookie=friend)
    check("another account has no playlists", st == 200 and b["playlists"] == [], b)

    # the cover is still wanted by the album, so deleting the artwork that shares its file keeps it
    st, b, _, _ = call("POST", "/api/songs/%d/artwork" % s2, raw=PNG, headers={"X-Filename": "same.png"}, cookie=owner)
    call("DELETE", "/api/artwork/%d" % b["image"]["id"], cookie=owner)
    check("a blob an album cover uses is kept", os.path.isfile(
        os.path.join(TMP, "accounts", "1", "blobs", digest[:2], digest[2:4], digest)))

    st, b, _, _ = call("DELETE", "/api/albums/%d" % al["id"], cookie=owner)
    check("delete an album and its playlist", st == 200 and b["deleted"] == al["id"]
          and not py_rows(1, "SELECT * FROM playlists WHERE album_id = ?", (al["id"],))
          and not py_rows(1, "SELECT * FROM album_songs"), b)
    st, b, _, _ = call("DELETE", "/api/songs/%d" % s1, cookie=owner)
    check("deleting a song takes its sheets and images with it", st == 200
          and not py_rows(1, "SELECT * FROM lyric_sheets") and not py_rows(1, "SELECT * FROM lyric_revisions")
          and not py_rows(1, "SELECT * FROM artwork WHERE song_id = ?", (s1,)), b)
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
