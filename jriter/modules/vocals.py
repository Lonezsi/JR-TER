"""Voices recorded over a song, any number of them, by anybody the song is shared with.

A take is one recording: the bytes, where in the song it starts, who recorded it, and
whether it is switched on. Takes stack. A song with three people singing on it is three or
thirty takes, each its own layer, and the song plays them all over the render.

Recorded in the browser. MediaRecorder hands back WebM with Opus on Chromium and MP4 with
AAC on Safari, so both are taken as they come: re-encoding on the server would cost
quality and a dependency, and every browser that can record one can play the other.

WHO MAY DO WHAT. The owner of the song may do anything with any take. Somebody the song is
shared with records onto the owner's song through the shared doorway (sharing.proxy), and
may change or delete only the takes they recorded themselves. Their takes are credited to
them, not to the owner whose library the rows live in.

`chain` is the vocal edit: an ordered list of effects, applied in the browser and rendered
in the background. The server only keeps it, and `fx` is the switch beside it: the edit
kept but not heard, to compare against the take as it was sung.
"""
import json
import os
import time

from .. import blobs, db, who
from ..wire import Error, Response, as_int
from . import songs

NAME = "vocals"

SCHEMA = [
    """
    CREATE TABLE IF NOT EXISTS vocal_takes (
      id         INTEGER PRIMARY KEY,
      song_id    INTEGER NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
      author     INTEGER NOT NULL,
      name       TEXT NOT NULL DEFAULT '',
      digest     TEXT NOT NULL,
      ext        TEXT NOT NULL,
      size       INTEGER NOT NULL DEFAULT 0,
      duration   REAL NOT NULL DEFAULT 0,
      -- Where in the song the take starts, in seconds. A take recorded from 0:42 plays from
      -- 0:42, and nudging it is how a late one is lined up.
      offset     REAL NOT NULL DEFAULT 0,
      enabled    INTEGER NOT NULL DEFAULT 1,
      gain       REAL NOT NULL DEFAULT 1,
      chain      TEXT NOT NULL DEFAULT '[]',
      created_at REAL NOT NULL,
      updated_at REAL NOT NULL
    )
    """,
    "CREATE INDEX IF NOT EXISTS vocal_takes_song ON vocal_takes(song_id, id)",
]

#: The effects a vocal edit can hold. See web/js/65-vocal-fx.js for what each one does.
EFFECTS = ("eq", "limiter", "autotune", "sidechain")


def MIGRATE():
    """The vocal edit's own switch, which came a release after the takes."""
    db.add_column_if_missing("vocal_takes", "fx", "INTEGER NOT NULL DEFAULT 1")


#: What a browser records into, and what somebody may bring as an existing recording.
EXT = (".webm", ".ogg", ".opus", ".m4a", ".mp4", ".aac", ".mp3", ".wav", ".flac")
TYPES = {".webm": "audio/webm", ".ogg": "audio/ogg", ".opus": "audio/ogg",
         ".m4a": "audio/mp4", ".mp4": "audio/mp4", ".aac": "audio/aac",
         ".mp3": "audio/mpeg", ".wav": "audio/wav", ".flac": "audio/flac"}

#: A take is a voice, not an album. Half an hour of WAV is under this.
MOST = 400 * 1024 * 1024


def _acting():
    """Who is actually doing this: the guest, when it came through a share."""
    from . import sharing
    guest = sharing.guest_now()
    return guest or who.must(), bool(guest)


def _take(take_id):
    row = db.one("SELECT * FROM vocal_takes WHERE id = ?", (as_int(take_id, "id"),))
    if not row:
        raise Error("No such recording.", 404)
    return row


def _mine_or_refuse(take):
    me, guest = _acting()
    if guest and take["author"] != me:
        raise Error("Only whoever recorded this can change or delete it.", 403)


def _out(row):
    from .. import accounts
    row = dict(row)
    try:
        row["chain"] = json.loads(row["chain"] or "[]")
    except ValueError:
        row["chain"] = []
    person = accounts.public(accounts.by_id(row["author"])) if row["author"] else None
    row["by"] = (person or {}).get("name") or (person or {}).get("handle") or ""
    row["by_handle"] = (person or {}).get("handle", "")
    me, _ = _acting()
    row["yours"] = row["author"] == me
    return row


def list_takes(req):
    song = songs.get(req.params["id"])
    return {"takes": [_out(r) for r in db.query(
        "SELECT * FROM vocal_takes WHERE song_id = ? ORDER BY id", (song["id"],))]}


def add_take(req):
    """One recording, raw body, with where it starts in X-Offset."""
    song = songs.get(req.params["id"])
    length = as_int(req.headers.get("Content-Length") or 0, "Content-Length")
    if length <= 0:
        raise Error("no recording in that upload")
    if length > MOST:
        raise Error("That recording is too long to keep here.", 413)
    name = (req.headers.get("X-Filename") or "take.webm").strip()
    try:
        from urllib.parse import unquote
        name = unquote(name)
    except Exception:
        pass
    ext = os.path.splitext(name)[1].lower()
    if ext not in EXT:
        raise Error("%s is not a recording JR!TER can keep" % (ext or name))
    try:
        offset = max(0.0, float(req.headers.get("X-Offset") or 0))
        duration = max(0.0, float(req.headers.get("X-Duration") or 0))
    except ValueError:
        raise Error("X-Offset and X-Duration are seconds")
    digest, size, _ = blobs.put_stream(req.rfile, length)
    me, _ = _acting()
    now = time.time()
    label = (req.headers.get("X-Label") or "").strip()[:80] or os.path.splitext(name)[0][:80]
    made = db.insert("vocal_takes", {
        "song_id": song["id"], "author": me, "name": label, "digest": digest, "ext": ext,
        "size": size, "duration": duration, "offset": offset, "created_at": now,
        "updated_at": now})
    songs.touch(song["id"])
    return {"take": _out(_take(made))}


def change_take(req):
    """Its name, whether it is on, its level, where it starts, and its vocal edit."""
    take = _take(req.params["id"])
    _mine_or_refuse(take)
    body = req.json() or {}
    fields = {}
    if "name" in body:
        fields["name"] = str(body["name"] or "").strip()[:80]
    if "enabled" in body:
        fields["enabled"] = 1 if body["enabled"] else 0
    if "gain" in body:
        fields["gain"] = min(4.0, max(0.0, float(body["gain"])))
    if "offset" in body:
        fields["offset"] = max(0.0, float(body["offset"]))
    if "fx" in body:
        fields["fx"] = 1 if body["fx"] else 0
    if "chain" in body:
        chain = body["chain"]
        if not isinstance(chain, list) or len(chain) > 16:
            raise Error("chain is a list of at most sixteen effects")
        for effect in chain:
            if not isinstance(effect, dict) or effect.get("type") not in EFFECTS:
                raise Error("an effect is one of: " + ", ".join(EFFECTS))
        fields["chain"] = json.dumps(chain)
    if not fields:
        return {"take": _out(take)}
    fields["updated_at"] = time.time()
    db.update("vocal_takes", take["id"], fields)
    return {"take": _out(_take(take["id"]))}


def drop_take(req):
    take = _take(req.params["id"])
    _mine_or_refuse(take)
    db.run("DELETE FROM vocal_takes WHERE id = ?", (take["id"],))
    return {"deleted": take["id"]}


def audio(req):
    take = _take(req.params["id"])
    path = blobs.path_for(take["digest"])
    if not os.path.isfile(path):
        raise Error("the recording is missing from storage", 410)
    headers = {}
    if req.q("download"):
        # The HTTP layer turns this into Content-Disposition, safely quoted.
        safe = "".join(c for c in (take["name"] or "voice") if c.isalnum() or c in " -_")
        headers["download"] = (safe.strip() or "voice") + take["ext"]
    return Response(path=path, content_type=TYPES.get(take["ext"], "audio/webm"),
                    headers=headers)


def SUMMARY():
    return {}


def ROUTES():
    return {
        ("GET", "/api/songs/<id>/vocals"): list_takes,
        ("POST", "/api/songs/<id>/vocals"): add_take,
        ("PATCH", "/api/vocals/<id>"): change_take,
        ("DELETE", "/api/vocals/<id>"): drop_take,
        ("GET", "/api/vocals/<id>/audio"): audio,
    }
