"""Does the Spring server agree with the Python one on sound presets and sharing (slice 9d2)?

Makes a throwaway data directory, starts server/target/jriter.jar on it, drives the sound
routes, shares, share links, the guest proxy, guest edits and undo over HTTP, then reads the
same rows back through the Python modules (and lets Python undo a change Spring recorded).

    python tools/parity_sharing.py          (build first: mvn -f server package)

Standard library only. Exits 1 on any failed check.
"""
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
TMP = tempfile.mkdtemp(prefix="jriter-parity-sharing-")
PORT = 7916
JAVA = os.environ.get("JRITER_JAVA") or r"C:\Java\jdk-21\bin\java.exe"
GLASS = os.environ.get("JRITER_GLASS") or os.path.abspath(
    os.path.join(os.path.dirname(ROOT), "foyer", "shared", "glass.css"))

os.environ.update(JRITER_DATA=TMP, JRITER_GLASS=GLASS, JRITER_FOYER="")
sys.path.insert(0, ROOT)
from jriter import accounts, db, who  # noqa: E402
from jriter.modules import auth as pyauth, sharing, sound  # noqa: E402

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


def err(status, body, want_status, want_text=None):
    return status == want_status and body and (want_text is None or body.get("error") == want_text)


def make_wav(path, seconds=0.3, rate=8000):
    w = wave.open(path, "wb")
    w.setnchannels(1)
    w.setsampwidth(2)
    w.setframerate(rate)
    w.writeframes(b"".join(struct.pack("<h", (i * 53 % 24000) - 12000) for i in range(int(rate * seconds))))
    w.close()
    return open(path, "rb").read()


PNG = bytes.fromhex("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489"
                    "0000000d49444154789c6360f8ffff3f0005fe02fea7d6a3270000000049454e44ae426082")

proc = None
log = open(os.path.join(TMP, "jar.log"), "wb")
try:
    accounts.create("owner", "pw", account_id=accounts.OWNER)
    accounts.create("friend", "pw", account_id=2)
    accounts.create("other", "pw", account_id=3)
    owner = "jriter_session=" + pyauth.issue(1)
    friend = "jriter_session=" + pyauth.issue(2)
    other = "jriter_session=" + pyauth.issue(3)

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

    song = call("POST", "/api/songs", {"title": "Wide"}, cookie=owner)[1]["song"]["id"]

    # -- sound presets -----------------------------------------------------------------
    st, b, _, _ = call("GET", "/api/songs/%d/sound" % song, cookie=owner)
    cur = b["presets"][0] if b else {}
    check("first look makes Current", st == 200 and len(b["presets"]) == 1 and cur["name"] == "Current"
          and cur["is_current"] == 1 and cur["data"]["bands"] == [] and cur["data"]["gain"] == 0, b)
    wild = {"gain": 99, "bypass": 1, "bands": [{"freq": 0, "gain": 50, "q": 0, "type": "nope"}] + [{}] * 30,
            "limiter": {"on": True, "threshold": -99, "attack": 500}}
    st, b, _, _ = call("PUT", "/api/sound/%d" % cur["id"], {"data": wild}, cookie=owner)
    d = b["preset"]["data"] if b else {}
    check("save clamps what a client sends", st == 200 and d["gain"] == 24 and d["bypass"] is True
          and len(d["bands"]) == 24 and d["bands"][0]["freq"] == 10 and d["bands"][0]["gain"] == 30
          and d["bands"][0]["q"] == 0.05 and d["bands"][0]["type"] == "peaking"
          and d["bands"][1]["id"] == "b2" and d["limiter"]["threshold"] == -60 and d["limiter"]["attack"] == 100
          and d["limiter"]["on"] is True, b)
    stored = py_rows(1, "SELECT data FROM sound_presets WHERE id = ?", (cur["id"],))[0]["data"]
    check("Python normalises Spring's data to the same thing", sound.normalise(json.loads(stored)) == d, stored)
    st, b, _, _ = call("POST", "/api/songs/%d/sound" % song, {"name": "Copy", "copy_from": cur["id"]}, cookie=owner)
    copy = b["preset"] if b else {}
    check("copy_from copies the data", st == 200 and copy["data"] == d and copy["is_current"] == 0, b)
    st, b, _, _ = call("POST", "/api/songs/%d/sound" % song, {}, cookie=owner)
    check("a preset needs a name", err(st, b, 400, "name is required"), b)
    st, b, _, _ = call("PATCH", "/api/sound/%d" % copy["id"], {"name": "Wide master"}, cookie=owner)
    check("rename a preset", st == 200 and b["preset"]["name"] == "Wide master", b)
    st, b, _, _ = call("POST", "/api/sound/%d/current" % copy["id"], cookie=owner)
    rows = py_rows(1, "SELECT id, is_current FROM sound_presets WHERE song_id = ? ORDER BY id", (song,))
    check("make current moves the flag", st == 200 and [r["is_current"] for r in rows] == [0, 1], rows)
    st, b, _, _ = call("DELETE", "/api/sound/%d" % copy["id"], cookie=owner)
    rows = py_rows(1, "SELECT id, is_current FROM sound_presets WHERE song_id = ?", (song,))
    check("deleting the current one hands over", st == 200 and len(rows) == 1 and rows[0]["is_current"] == 1, (b, rows))
    st, b, _, _ = call("DELETE", "/api/sound/%d" % cur["id"], cookie=owner)
    check("a song keeps at least one preset", err(st, b, 400, "a song keeps at least one preset"), b)
    st, b, _, _ = call("GET", "/api/sound/9999", cookie=owner)
    st, b, _, _ = call("PUT", "/api/sound/9999", {"data": {}}, cookie=owner)
    check("no such preset", err(st, b, 404, "no preset with id 9999"), b)
    call("PUT", "/api/sound/%d" % cur["id"], {"data": {"gain": 3, "bands": [{"freq": 200, "gain": 4}]}}, cookie=owner)

    # content to share: lyrics, a picture, a mix
    sheet = call("POST", "/api/songs/%d/lyrics" % song, {"text": "# Verse\nla la"}, cookie=owner)[1]["sheet"]
    call("POST", "/api/songs/%d/artwork" % song, raw=PNG, headers={"X-Filename": "c.png"}, cookie=owner)
    wav = make_wav(os.path.join(TMP, "t.wav"))
    st, b, _, _ = call("POST", "/api/songs/%d/versions" % song, raw=wav,
                       headers={"X-Filename": "take.wav", "Content-Type": "application/octet-stream"}, cookie=owner)
    version = b["version"]["id"]

    # -- sharing by handle -------------------------------------------------------------
    st, b, _, _ = call("POST", "/api/shares", {"song": song, "handle": "nobody"}, cookie=owner)
    check("share with an unknown handle", err(st, b, 404, "Nobody on this library has the handle nobody."), b)
    st, b, _, _ = call("POST", "/api/shares", {"song": song, "handle": "owner"}, cookie=owner)
    check("share with yourself", err(st, b, 400, "That song is already yours."), b)
    st, b, _, _ = call("POST", "/api/shares", {"song": 999, "handle": "friend"}, cookie=owner)
    check("share a song that is not there", err(st, b, 404, "no song with id 999"), b)
    st, b, _, _ = call("POST", "/api/shares", {"song": song, "handle": "friend", "as_name": "Jozsef"}, cookie=owner)
    share = b["share"] if b else 0
    check("share with a handle", st == 200 and b["to"]["handle"] == "friend", b)
    st, b, _, _ = call("POST", "/api/shares", {"song": song, "handle": "friend"}, cookie=owner)
    check("already has it", err(st, b, 409, "friend already has this song."), b)
    st, b, _, _ = call("GET", "/api/shares?song=%d" % song, cookie=owner)
    check("list shares", st == 200 and len(b["shares"]) == 1 and b["shares"][0]["to_handle"] == "friend"
          and {p["handle"] for p in b["people"]} == {"friend", "other"}, b)
    st, b, _, _ = call("GET", "/api/shared", cookie=friend)
    check("the guest sees it listed", st == 200 and len(b["shared"]) == 1 and b["shared"][0]["title"] == "Wide"
          and b["shared"][0]["can_play"] is True and b["shared"][0]["as_name"] == "Jozsef"
          and b["shared"][0]["art"] is not None, b)
    st, b, _, _ = call("GET", "/api/shared/%d" % share, cookie=friend)
    check("open a share", st == 200 and b["song"]["title"] == "Wide" and b["version"]["id"] == version
          and len(b["presets"]) == 1 and b["presets"][0]["data"]["gain"] == 3
          and b["sheets"][0]["text"] == "# Verse\nla la" and len(b["artwork"]) == 1
          and b["mine"]["song"] is None, b)
    art = b["artwork"][0]["id"] if b else 0
    st, b, _, _ = call("GET", "/api/shared/%d" % share, cookie=other)
    check("a stranger gets the same refusal as no share", err(st, b, 404, "That share is not open to you."), b)
    st, _, content, _ = call("GET", "/api/shared/%d/audio" % share, cookie=friend)
    check("the guest hears the mix", st == 200 and content == wav)
    st, _, content, _ = call("GET", "/api/shared/%d/audio" % share, cookie=friend, headers={"Range": "bytes=0-9"})
    check("and can seek in it", st == 206 and content == wav[:10], st)
    st, _, content, _ = call("GET", "/api/shared/%d/artwork/%d" % (share, art), cookie=friend)
    check("the cover through the share", st == 200 and content == PNG)
    st, b, _, _ = call("GET", "/api/shared/%d/artwork/%d" % (share, art + 50), cookie=friend)
    check("a picture that is not the song's", err(st, b, 404, "That picture is not part of this share."), b)

    # -- what the guest makes ---------------------------------------------------------
    st, b, _, _ = call("POST", "/api/shared/%d/preset" % share,
                       {"data": {"gain": -2}, "from": b and 0 or 1}, cookie=friend)
    original = py_rows(1, "SELECT id FROM sound_presets WHERE song_id = ?", (song,))[0]["id"]
    st, b, _, _ = call("POST", "/api/shared/%d/preset" % share, {"data": {"gain": -2}, "from": original}, cookie=friend)
    check("editing a preset makes a named copy", st == 200 and b["preset"]["name"] == "Current, edited by Jozsef"
          and b["preset"]["data"]["gain"] == -2, b)
    mine = py_rows(2, "SELECT title, shared_from FROM songs")
    check("the copy hangs on the guest's own song", len(mine) == 1 and mine[0]["title"] == "Wide (owner)"
          and mine[0]["shared_from"] == "share:%d" % share, mine)
    st, b, _, _ = call("POST", "/api/shared/%d/preset" % share, {"data": {"gain": 5}, "name": "Current, edited by Jozsef"},
                       cookie=friend)
    check("same name is overwritten, not doubled",
          len(py_rows(2, "SELECT id FROM sound_presets")) == 1 and b["preset"]["data"]["gain"] == 5, b)
    st, b, _, _ = call("POST", "/api/shared/%d/preset" % share, {"data": {}, "from": 9999}, cookie=friend)
    check("a preset that is not part of the share", err(st, b, 404, "That preset is not part of this share."), b)
    st, b, _, _ = call("POST", "/api/shared/%d/sheet" % share, {"text": "my words", "from": sheet["id"]}, cookie=friend)
    check("editing words makes a named copy", st == 200 and b["sheet"]["name"] == "Verse, edited by Jozsef"
          and b["sheet"]["text"] == "my words", b)
    st, b, _, _ = call("POST", "/api/shared/%d/preset" % share, {"data": {}}, cookie=owner)
    check("only the guest saves into a share", err(st, b, 403, "Only the person a song was shared with can save into it."), b)
    st, b, _, _ = call("GET", "/api/songs/%d/guests" % song, cookie=owner)
    p = b["people"][0] if b else {}
    check("the owner sees what the guest made", st == 200 and p["handle"] == "friend" and p["made_anything"] is True
          and len(p["presets"]) == 1 and p["sheets"][0]["text"] == "my words", b)
    st, b, _, _ = call("GET", "/api/shared/%d/guests" % share, cookie=friend)
    check("a guest sees nobody else", st == 200 and b["people"] == [], b)

    # -- the guest proxy -----------------------------------------------------------------
    on = "/api/shared/%d/on" % share
    st, b, _, _ = call("PATCH", on + "/songs/%d" % song, {"title": "Wider"}, cookie=friend)
    check("a guest renames the song", st == 200 and b["song"]["title"] == "Wider", b)
    st, b, _, _ = call("PATCH", on + "/songs/%d" % song, {"title": "X", "notes": "mine"}, cookie=friend)
    check("title and nothing else", err(st, b, 403, "A guest can change the title and nothing else there."), b)
    st, b, _, _ = call("DELETE", on + "/songs/%d" % song, cookie=friend)
    check("not on the list", err(st, b, 403, "That is not something a guest can do on a shared song."), b)
    st, b, _, _ = call("PUT", on + "/sound/%d" % original, {"data": {"gain": 6}}, cookie=friend)
    check("a guest changes the sound", st == 200 and b["preset"]["data"]["gain"] == 6, b)
    st, b, _, _ = call("PUT", on + "/sound/%d" % original, {"data": {"gain": 7}}, cookie=friend)
    check("two saves in a sitting", st == 200)
    other_song = call("POST", "/api/songs", {"title": "Private"}, cookie=owner)[1]["song"]["id"]
    st, b, _, _ = call("GET", on + "/songs/%d/sound" % other_song, cookie=friend)
    check("another song is not part of the share", err(st, b, 404, "That is not part of this share."), b)
    st, b, _, _ = call("GET", on + "/songs/%d/sound" % song, cookie=other)
    check("someone else's share", err(st, b, 404, "That share is not open to you."), b)
    st, b, _, _ = call("GET", on + "/versions/%d/audio" % version, cookie=friend)
    check("audio through the proxy", st == 200, st)
    st, b, _, _ = call("PUT", on + "/lyrics/%d/text" % sheet["id"], {"text": "# Verse\nla la\nguest line"}, cookie=friend)
    check("a guest edits the words", st == 200 and b["saved"] is True, b)
    st, b, _, _ = call("POST", on + "/songs/%d/vocals" % song, raw=b"voice", cookie=friend,
                       headers={"X-Filename": "take.webm", "Content-Type": "application/octet-stream"})
    take = b["take"] if b else {}
    check("a guest's take is credited to them", st == 200 and take["author"] == 2 and take["yours"] is True, b)
    st, b, _, _ = call("GET", "/api/songs/%d/vocals" % song, cookie=owner)
    check("the owner sees it as not theirs", st == 200 and b["takes"][0]["yours"] is False
          and b["takes"][0]["by_handle"] == "friend", b)
    owners_take = call("POST", "/api/songs/%d/vocals" % song, raw=b"mine", cookie=owner,
                       headers={"X-Filename": "own.webm", "Content-Type": "application/octet-stream"})[1]["take"]
    st, b, _, _ = call("DELETE", on + "/vocals/%d" % owners_take["id"], cookie=friend)
    check("a guest cannot delete the owner's take",
          err(st, b, 403, "Only whoever recorded this can change or delete it."), b)

    st, b, _, _ = call("GET", "/api/songs/%d/edits" % song, cookie=owner)
    edits = b["edits"] if b else []
    whats = [e["what"] for e in edits]
    check("the history: one entry per change, sound saves merged",
          st == 200 and sorted(whats) == ["changed the sound", "edited the words", "renamed the song"]
          and all(e["handle"] == "friend" for e in edits), b)
    by = {e["what"]: e for e in edits}
    st, b, _, _ = call("GET", "/api/songs/%d/guests" % song, cookie=owner)
    check("changes counted", st == 200 and b["people"][0]["changes"] == 3, b)

    # Spring undoes its own record
    st, b, _, _ = call("POST", "/api/guest-edits/%d/undo" % by["renamed the song"]["id"], cookie=owner)
    check("undo a rename", st == 200 and py_rows(1, "SELECT title FROM songs WHERE id = ?", (song,))[0]["title"] == "Wide", b)
    st, b, _, _ = call("POST", "/api/guest-edits/%d/undo" % by["edited the words"]["id"], cookie=owner)
    sheets = py_rows(1, "SELECT text FROM lyric_revisions WHERE sheet_id = ?", (sheet["id"],))
    check("undo the words takes the revision away", st == 200 and [r["text"] for r in sheets] == ["# Verse\nla la"], sheets)
    # Python undoes the record Spring wrote
    with who.acting_as(1):
        rec = db.one("SELECT * FROM guest_edits WHERE id = ?", (by["changed the sound"]["id"],))
        sharing._put_back(song, json.loads(rec["before"]))
    got = json.loads(py_rows(1, "SELECT data FROM sound_presets WHERE id = ?", (original,))[0]["data"])
    check("Python can undo what Spring recorded", got["gain"] == 3, got)
    st, b, _, _ = call("POST", "/api/guest-edits/9999/undo", cookie=owner)
    check("undo of no change", err(st, b, 404, "No such change."), b)
    st, b, _, _ = call("GET", "/api/songs/%d/edits" % song, cookie=friend)
    check("a guest's own library has no edits of the owner's", st == 200 and b["edits"] == [], b)

    # -- a link -----------------------------------------------------------------------------
    st, b, _, _ = call("POST", "/api/shares", {"song": song, "as_name": "Kati"}, cookie=owner)
    token = b["token"] if b else ""
    lshare = b["share"] if b else 0
    check("a link share", st == 200 and b["path"] == "/#/join/" + token and "only time" in b["note"], b)
    st, b, _, _ = call("GET", "/api/shares/invitation/" + token)
    check("the invitation opens with no session", st == 200 and b["song"]["title"] == "Wider"
          and b["from"] == "owner" and b["as_name"] == "Kati" and b["signed_in"] is False, b)
    digest_row = py_rows(1, "SELECT 1") and accounts.share(lshare)
    check("only a digest is kept", digest_row["token_digest"] != token and digest_row["to_account"] == 0, digest_row)
    st, b, _, _ = call("POST", "/api/shares/invitation/" + token, {})
    check("a handle is needed", err(st, b, 400, "Pick a handle so the song has somebody to belong to."), b)
    st, b, _, hdrs = call("POST", "/api/shares/invitation/" + token, {"handle": "kati", "password": "pw", "name": "Kati"})
    cookie = (hdrs.get("Set-Cookie") or "").split(";")[0]
    check("accept makes an account and a session", st == 200 and b["share"] == lshare and cookie.startswith("jriter_session="), (b, cookie))
    st, b, _, _ = call("POST", "/api/shares/invitation/" + token, {"handle": "kati2", "password": "pw"})
    check("the link works once", err(st, b, 404, "That link is not open. It may have been used already, or taken back."), b)
    st, b, _, _ = call("GET", "/api/shared/%d" % lshare, cookie=cookie)
    check("the new account opens its song", st == 200 and b["song"]["title"] == "Wider", b)
    st, b, _, _ = call("POST", "/api/shares", {"song": song, "as_name": "Z"}, cookie=owner)
    st2, b2, _, _ = call("POST", "/api/shares/invitation/" + b["token"], {}, cookie=friend)
    check("a signed-in guest accepts without a handle", st2 == 200 and b2["share"] == b["share"], b2)

    # -- taking it back -----------------------------------------------------------------------
    st, b, _, _ = call("DELETE", "/api/shares/%d" % share, cookie=friend)
    check("only the sharer takes it back", err(st, b, 403, "Only the person who shared a song can take it back."), b)
    st, b, _, _ = call("DELETE", "/api/shares/%d" % share, cookie=owner)
    check("revoke", st == 200 and b["revoked"] == share and b["note"] == "Their own copies stay theirs.", b)
    st, b, _, _ = call("GET", "/api/shared/%d" % share, cookie=friend)
    check("a revoked share is closed", err(st, b, 404, "That share is not open to you."), b)
    st, b, _, _ = call("GET", on + "/songs/%d/sound" % song, cookie=friend)
    check("and so is its proxy", err(st, b, 404, "That share is not open to you."), b)
    check("the guest's copies stay theirs", len(py_rows(2, "SELECT id FROM sound_presets")) == 1)

    # -- a song id that is reused is not the same song ------------------------------------------
    last = call("POST", "/api/songs", {"title": "Newest"}, cookie=owner)[1]["song"]["id"]
    sh = call("POST", "/api/shares", {"song": last, "handle": "friend"}, cookie=owner)[1]["share"]
    call("DELETE", "/api/songs/%d" % last, cookie=owner)
    new = call("POST", "/api/songs", {"title": "A brand new private song"}, cookie=owner)[1]["song"]["id"]
    st, b, _, _ = call("GET", "/api/shared/%d" % sh, cookie=friend)
    check("a share is not handed to the next song with the same id", st in (404, 410) and new == last or st in (404, 410), (st, b, new, last))
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
