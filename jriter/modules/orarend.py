"""A week, and where the classes fall in it.

WHY THIS IS IN THE LIBRARY AND NOT IN FOYER. It was in Foyer, which is the right place for
it by subject: it has nothing to do with music. It is here because of how each site can be
reached. JR!TER is behind Tailscale Funnel, which means it answers on the public internet
and every unauthenticated caller gets the login page and nothing else. Foyer is on the
tailnet only, so it is reachable from this machine and from nothing else, and a timetable
you cannot open on a phone is a timetable you do not have.

So the page lives where the door is. Foyer's front page links to it here.

WHY THE DATA IS NOT IN THIS REPO. It names a second person, her rooms and her hours, and
this repository is public. So the timetable is a file in the account's own directory,
beside its database, which is in data/ and is not committed. The code is public and the
week is not.

PER ACCOUNT, like everything else here. home() resolves through who.must(), which raises
rather than picking a library, so a second person signing in gets their own empty week and
not a view of somebody else's. That is the same reason the databases are separate files:
a mistake cannot quietly read across.

NO SCHEMA. It is a list somebody edits in a file, not something the app writes, so a table
to hold it would be a table with an import step in front of it. Read at request time, so
editing the file and reloading the page is the whole loop.
"""
import io
import json
import os

import time

from .. import config, db
from ..wire import Error, need, as_int

NAME = "orarend"

#: What this app writes, as opposed to the week, which it only reads.
#:
#: The timetable itself is a file somebody edits. Notes and absences are the other way
#: round: they are made here, a few characters at a time, by pressing things. That is a
#: database's job, and it is the account's own database, so one person's notes are as far
#: from another's as their songs are.
#:
#: KEYED ON THE SUBJECT'S NAME, not on a class. "Webprogramozás Ea+Gy" happens twice a week
#: and it is one subject with one set of notes and one count of absences; opening either of
#: them has to reach the same page. The name is what a person sees and what the file says,
#: so it is the thing they mean by "this subject". A course renamed in the file starts a new
#: note, which is the honest answer: nothing here can know it is the same course.
SCHEMA = [
    """
    CREATE TABLE IF NOT EXISTS orarend_notes (
      id         INTEGER PRIMARY KEY,
      subject    TEXT NOT NULL UNIQUE,
      -- 0 to 3. Three is the number of checkboxes, and the cap is here rather than only in
      -- the page so that it is true of the data and not just of the screen.
      absences   INTEGER NOT NULL DEFAULT 0,
      created_at REAL NOT NULL,
      updated_at REAL NOT NULL
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS orarend_pages (
      id         INTEGER PRIMARY KEY,
      note_id    INTEGER NOT NULL REFERENCES orarend_notes(id) ON DELETE CASCADE,
      position   INTEGER NOT NULL DEFAULT 0,
      text       TEXT NOT NULL DEFAULT '',
      created_at REAL NOT NULL,
      updated_at REAL NOT NULL
    )
    """,
    "CREATE INDEX IF NOT EXISTS orarend_pages_note ON orarend_pages(note_id, position)",
]

#: How many absences the checkboxes offer, and therefore the most that can be stored.
ABSENCES = 3

#: The window the grid draws, and how tall an hour is, in pixels.
#:
#: Sent to the browser rather than written down there as well. The view works out every
#: position from these, and the stylesheet draws the hour rows at the same height, so there
#: is one place the scale of the grid is decided and it is this one.
FROM = 8
TO = 22
HOUR = 60


def path(account=None):
    """Where one account's week is kept."""
    return os.path.join(config.home(account), "orarend.json")


def read(account=None):
    """The week as it is on disk, or nothing.

    A missing file is not a fault. It is what every account that has never written one
    looks like, which is most of them, and the screen has something to say about that.
    """
    try:
        with io.open(path(account), encoding="utf-8") as f:
            found = json.load(f)
    except OSError:
        return None
    except ValueError as e:
        # Broken rather than absent, which is a different thing and worth saying so: the
        # file is there and somebody has just edited it.
        return {"broken": str(e)}
    if isinstance(found, list):
        # A bare list of classes, which is the shape that is easiest to write by hand.
        return {"classes": found}
    return found


def week(req):
    """The timetable, with the scale it is meant to be drawn at.

    `missing` and `broken` are told apart because the screens for them are different: one
    says how to make one, the other says which line will not parse.
    """
    found = read()
    if found is None:
        return {"classes": [], "missing": True, "where": "orarend.json",
                "from": FROM, "to": TO, "hour": HOUR}
    if found.get("broken"):
        return {"classes": [], "broken": found["broken"], "where": "orarend.json",
                "from": FROM, "to": TO, "hour": HOUR}
    return {
        "classes": found.get("classes") or [],
        "from": found.get("from", FROM),
        "to": found.get("to", TO),
        "hour": found.get("hour", HOUR),
    }


# ── notes, and how many times I was not there ────────────────────────────────


def _subject(req):
    """The subject a call is about, which is a name rather than a number.

    A class has no id: the week is a file somebody edits, and a row in it is identified by
    what it says. So the key is the name, trimmed, and an empty one is refused rather than
    quietly becoming a note called "" that every unnamed thing would share.
    """
    name = (req.q("subject") or (req.json() or {}).get("subject") or "").strip()
    if not name:
        raise Error("which subject?", 400)
    return name[:200]


def _note(subject, make=False):
    """The row for one subject, made on demand or not at all.

    Not made on reading. Opening a class to look at it should not write anything, or every
    class anybody ever glanced at would have a row, and "which subjects have I made notes
    on" would stop being answerable.
    """
    row = db.one("SELECT * FROM orarend_notes WHERE subject = ?", (subject,))
    if row or not make:
        return row
    now = time.time()
    db.insert("orarend_notes", {"subject": subject, "absences": 0,
                                "created_at": now, "updated_at": now})
    return db.one("SELECT * FROM orarend_notes WHERE subject = ?", (subject,))


def _pages(note_id):
    return [dict(r) for r in db.query(
        "SELECT id, position, text, updated_at FROM orarend_pages "
        "WHERE note_id = ? ORDER BY position, id", (note_id,))]


def _out(subject, row):
    if not row:
        return {"subject": subject, "absences": 0, "allowed": ABSENCES, "pages": []}
    return {"subject": subject, "absences": row["absences"], "allowed": ABSENCES,
            "pages": _pages(row["id"])}


def notes(req):
    """Everything kept about one subject. Reading makes nothing."""
    subject = _subject(req)
    return _out(subject, _note(subject))


def set_absences(req):
    """How many times I was not there, 0 to 3.

    Clamped rather than refused. The screen offers three boxes so it cannot ask for four,
    and a stored number outside the range would draw as a row of boxes that disagrees with
    the count beside it.
    """
    subject = _subject(req)
    want = as_int((req.json() or {}).get("absences"), "absences", minimum=0)
    want = min(want, ABSENCES)
    row = _note(subject, make=True)
    db.update("orarend_notes", row["id"], {"absences": want, "updated_at": time.time()})
    return _out(subject, _note(subject))


def add_page(req):
    """A new page at the end."""
    subject = _subject(req)
    row = _note(subject, make=True)
    now = time.time()
    held = _pages(row["id"])
    db.insert("orarend_pages", {
        "note_id": row["id"], "position": (held[-1]["position"] + 1) if held else 0,
        "text": (req.json() or {}).get("text") or "", "created_at": now,
        "updated_at": now})
    db.update("orarend_notes", row["id"], {"updated_at": now})
    return _out(subject, _note(subject))


def _page_in(page_id):
    """One page, and the note it belongs to, or a refusal.

    Both are read here so that a page id from a caller is checked against this library
    before anything is written to it.
    """
    page = db.one("SELECT * FROM orarend_pages WHERE id = ?", (page_id,))
    if not page:
        raise Error("no page with id %s" % page_id, 404)
    note = db.one("SELECT * FROM orarend_notes WHERE id = ?", (page["note_id"],))
    if not note:
        raise Error("no page with id %s" % page_id, 404)
    return page, note


def save_page(req):
    """The text of one page. Markdown, which is rendered when it is read rather than here."""
    page, note = _page_in(as_int(req.params["id"], "id"))
    now = time.time()
    db.update("orarend_pages", page["id"],
              {"text": (req.json() or {}).get("text") or "", "updated_at": now})
    db.update("orarend_notes", note["id"], {"updated_at": now})
    return _out(note["subject"], note)


def drop_page(req):
    page, note = _page_in(as_int(req.params["id"], "id"))
    db.run("DELETE FROM orarend_pages WHERE id = ?", (page["id"],))
    db.update("orarend_notes", note["id"], {"updated_at": time.time()})
    return _out(note["subject"], db.one(
        "SELECT * FROM orarend_notes WHERE id = ?", (note["id"],)))


def SUMMARY():
    """What the home screen is told. Nothing, when there is no week."""
    found = read()
    if not found or found.get("broken"):
        return {}
    return {"classes": len(found.get("classes") or [])}


def ROUTES():
    return {
        ("GET", "/api/orarend"): week,
        ("GET", "/api/orarend/notes"): notes,
        ("PUT", "/api/orarend/notes"): set_absences,
        ("POST", "/api/orarend/notes/pages"): add_page,
        ("PUT", "/api/orarend/notes/pages/<id>"): save_page,
        ("DELETE", "/api/orarend/notes/pages/<id>"): drop_page,
    }
