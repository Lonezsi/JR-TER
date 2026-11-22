"""A song's DAW project, kept on the server so friends can edit it together.

The project is the same `jriter-daw` JSON text the DAW saves in the browser (see
web/daw/midi.js songToText); the server only stores it, with a revision number. A save says
which revision it was made from. If somebody saved in between, nothing is overwritten: the
answer is the current text, and the browser merges the two and saves again.

Who is in the DAW and where their cursor is lives in memory only. It is gone after a
restart and after a few seconds of silence, which is exactly how long it is true.
"""
import json
import threading
import time

from .. import db, who, accounts
from ..wire import Error, need
from . import songs

NAME = "daw"

SCHEMA = [
    """
    CREATE TABLE IF NOT EXISTS daw_projects (
      song_id    INTEGER PRIMARY KEY REFERENCES songs(id) ON DELETE CASCADE,
      text       TEXT NOT NULL DEFAULT '',
      rev        INTEGER NOT NULL DEFAULT 0,
      updated_at REAL NOT NULL DEFAULT 0,
      updated_by INTEGER NOT NULL DEFAULT 0
    )
    """,
]

MAX_TEXT = 2 * 1024 * 1024
GONE_AFTER = 12.0           # seconds without a word from somebody, and they have left

_lock = threading.Lock()
_here = {}                  # (library account, song id) -> {account id: {...}}


def _caller():
    """Whoever is really asking: the guest on a shared song, else the signed-in person."""
    from . import sharing
    return sharing.guest_now() or who.must()


def _project(song_id):
    row = db.one("SELECT text, rev FROM daw_projects WHERE song_id = ?", (song_id,))
    return {"text": row["text"], "rev": row["rev"]} if row else {"text": "", "rev": 0}


def _hue(account_id):
    return (int(account_id) * 137) % 360


def _clean_cursor(raw):
    if not isinstance(raw, dict):
        return {}
    out = {}
    for key, value in raw.items():
        if isinstance(key, str) and len(key) <= 20 and \
                (value is None or isinstance(value, (int, float, str, bool))):
            out[key] = value if not isinstance(value, str) else value[:40]
        if len(out) >= 8:
            break
    return out


def _people(song_id, me, note=None):
    key = (who.must(), song_id)
    now = time.time()
    with _lock:
        room = _here.setdefault(key, {})
        for account in [a for a, p in room.items() if now - p["at"] > GONE_AFTER]:
            del room[account]
        if note is not None:
            person = accounts.public(accounts.by_id(me)) or {}
            room[me] = {"id": me, "name": person.get("name") or "?", "hue": _hue(me),
                        "cursor": note, "at": now}
        return [{k: v for k, v in p.items() if k != "at"}
                for a, p in room.items() if a != me]


def get_project(req):
    song = songs.get(req.params["id"])
    out = _project(song["id"])
    out["people"] = _people(song["id"], _caller())
    return out


def check_text(text):
    """Refuse anything that is not a DAW project of a sane size (versions use it too)."""
    if not isinstance(text, str) or len(text) > MAX_TEXT:
        raise Error("That project is too big.", 413)
    try:
        parsed = json.loads(text)
    except ValueError:
        raise Error("That is not a DAW project.")
    if not isinstance(parsed, dict) or not isinstance(parsed.get("tracks"), list):
        raise Error("That is not a DAW project.")


def put_project(req):
    song = songs.get(req.params["id"])
    body = req.json() or {}
    text = need(body, "text")
    check_text(text)
    try:
        base = int(body.get("base", 0))
    except (TypeError, ValueError):
        base = 0
    me = _caller()
    now = time.time()
    if base == 0:
        # First save of a song: the row may not exist yet. Losing the race is a conflict.
        cur = db.run("INSERT OR IGNORE INTO daw_projects (song_id, text, rev, updated_at, "
                     "updated_by) VALUES (?, ?, 1, ?, ?)", (song["id"], text, now, me))
        won = cur.rowcount == 1
        rev = 1
    else:
        cur = db.run("UPDATE daw_projects SET text = ?, rev = rev + 1, updated_at = ?, "
                     "updated_by = ? WHERE song_id = ? AND rev = ?",
                     (text, now, me, song["id"], base))
        won = cur.rowcount == 1
        rev = base + 1
    if not won:
        out = _project(song["id"])
        out["conflict"] = True
        return out
    songs.touch(song["id"])
    return {"rev": rev, "conflict": False}


def here(req):
    song = songs.get(req.params["id"])
    me = _caller()
    cursor = _clean_cursor((req.json() or {}).get("cursor"))
    people = _people(song["id"], me, cursor)
    return {"rev": _project(song["id"])["rev"], "people": people}


def SUMMARY():
    row = db.one("SELECT COUNT(*) AS n FROM daw_projects")
    return {"projects": row["n"] if row else 0}


def ROUTES():
    return {
        ("GET", "/api/songs/<id>/daw"): get_project,
        ("PUT", "/api/songs/<id>/daw"): put_project,
        ("POST", "/api/songs/<id>/daw/here"): here,
    }
