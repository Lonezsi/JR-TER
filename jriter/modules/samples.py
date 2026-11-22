"""Your own one-shots: kicks, snares, hits and effects you bring from your computer.

They belong to the library, not to a song, so any song's DAW can use them as a sampler
instrument or as hits in a pattern, and they come out in a copy of the library. The audio
sits in the blob store like every other sound; this table is the list with names and folders.

Deleting one only hides it (deleted_at), so a project that still points at it keeps playing
and Undo brings it back.
"""
import os
import time

from .. import blobs, db
from ..wire import Error, Response, as_int

NAME = "samples"

SCHEMA = [
    """
    CREATE TABLE IF NOT EXISTS samples (
      id         INTEGER PRIMARY KEY,
      name       TEXT NOT NULL,
      folder     TEXT NOT NULL DEFAULT '',
      digest     TEXT NOT NULL,
      ext        TEXT NOT NULL,
      size       INTEGER NOT NULL DEFAULT 0,
      duration   REAL NOT NULL DEFAULT 0,
      created_at REAL NOT NULL,
      deleted_at REAL NOT NULL DEFAULT 0
    )
    """,
    "CREATE INDEX IF NOT EXISTS samples_folder ON samples(folder, name)",
]

EXT = (".wav", ".mp3", ".ogg", ".opus", ".flac", ".m4a", ".aiff", ".aif")
TYPES = {".wav": "audio/wav", ".mp3": "audio/mpeg", ".ogg": "audio/ogg", ".opus": "audio/ogg",
         ".flac": "audio/flac", ".m4a": "audio/mp4", ".aiff": "audio/aiff", ".aif": "audio/aiff"}

#: A one-shot is a hit, not a song. Fifty megabytes is minutes of WAV.
MOST = 50 * 1024 * 1024


def _row(sample_id):
    row = db.one("SELECT * FROM samples WHERE id = ?", (as_int(sample_id, "id"),))
    if not row:
        raise Error("No such sound.", 404)
    return row


def _out(row):
    return {k: row[k] for k in ("id", "name", "folder", "ext", "size", "duration", "created_at")}


def _clean(text, most):
    text = " ".join(str(text or "").split())
    return text[:most]


def _header(req, name):
    from urllib.parse import unquote
    value = req.headers.get(name) or ""
    try:
        return unquote(value)
    except Exception:
        return value


def list_samples(req):
    rows = db.query("SELECT * FROM samples WHERE deleted_at = 0 "
                    "ORDER BY folder COLLATE NOCASE, name COLLATE NOCASE, id")
    return {"samples": [_out(r) for r in rows]}


def add_sample(req):
    """One sound, raw body. X-Filename (url-encoded), X-Folder and X-Duration are optional."""
    length = as_int(req.headers.get("Content-Length") or 0, "Content-Length")
    if length <= 0:
        raise Error("no sound in that upload")
    if length > MOST:
        raise Error("That sound is too long to keep here.", 413)
    filename = _header(req, "X-Filename").strip() or "sound.wav"
    ext = os.path.splitext(filename)[1].lower()
    if ext not in EXT:
        raise Error("%s is not a sound JR!TER can keep" % (ext or filename))
    try:
        duration = max(0.0, float(req.headers.get("X-Duration") or 0))
    except ValueError:
        raise Error("X-Duration is seconds")
    folder = _clean(_header(req, "X-Folder"), 80)
    name = _clean(os.path.splitext(os.path.basename(filename))[0], 80) or "Sound"
    digest, size, _ = blobs.put_stream(req.rfile, length)
    same = db.one("SELECT * FROM samples WHERE digest = ? AND name = ? AND folder = ?",
                  (digest, name, folder))
    if same:
        if same["deleted_at"]:      # brought in again after a delete: it is back
            db.update("samples", same["id"], {"deleted_at": 0})
            same = _row(same["id"])
        return {"sample": _out(same), "duplicate": True}
    made = db.insert("samples", {
        "name": name, "folder": folder, "digest": digest, "ext": ext, "size": size,
        "duration": duration, "created_at": time.time()})
    return {"sample": _out(_row(made)), "duplicate": False}


def change_sample(req):
    row = _row(req.params["id"])
    body = req.json() or {}
    fields = {}
    if "name" in body:
        fields["name"] = _clean(body["name"], 80) or row["name"]
    if "folder" in body:
        fields["folder"] = _clean(body["folder"], 80)
    if fields:
        db.update("samples", row["id"], fields)
    return {"sample": _out(_row(row["id"]))}


def drop_sample(req):
    row = _row(req.params["id"])
    db.update("samples", row["id"], {"deleted_at": time.time()})
    return {"deleted": row["id"]}


def restore_sample(req):
    row = _row(req.params["id"])
    db.update("samples", row["id"], {"deleted_at": 0})
    return {"sample": _out(_row(row["id"]))}


def audio(req):
    row = _row(req.params["id"])
    path = blobs.path_for(row["digest"])
    if not os.path.isfile(path):
        raise Error("the sound is missing from storage", 410)
    return Response(path=path, content_type=TYPES.get(row["ext"], "audio/wav"))


def SUMMARY():
    row = db.one("SELECT COUNT(*) AS n FROM samples WHERE deleted_at = 0")
    return {"samples": row["n"] if row else 0}


def ROUTES():
    return {
        ("GET", "/api/samples"): list_samples,
        ("POST", "/api/samples"): add_sample,
        ("PATCH", "/api/samples/<id>"): change_sample,
        ("DELETE", "/api/samples/<id>"): drop_sample,
        ("POST", "/api/samples/<id>/restore"): restore_sample,
        ("GET", "/api/samples/<id>/audio"): audio,
    }
