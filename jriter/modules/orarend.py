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
        "classes": [_keyed(e, at) for at, e in enumerate(found.get("classes") or [])],
        "from": found.get("from", FROM),
        "to": found.get("to", TO),
        "hour": found.get("hour", HOUR),
    }


def _keyed(entry, at):
    """A class with something to call it by.

    Every class this app has written has an id and keeps it. A class typed into the file
    by hand has none, and is named by where it sits until something writes it, at which
    point it gets one. Two shapes rather than one so that reading the week never writes
    it: a file that is only ever looked at is left exactly as its author left it.
    """
    said = dict(entry)
    said["key"] = str(entry["id"]) if entry.get("id") else "i:%d" % at
    return said


# ── writing the week ─────────────────────────────────────────────────────────

#: What a class may say. Anything else in the file is left alone and written back
#: untouched: it is somebody's file, and a key this app has never heard of is more likely
#: to be a note to themselves than a mistake.
FIELDS = ("day", "at", "to", "kind", "whose", "name", "where", "skip",
          "code", "group", "teacher")

#: The kinds a class can be. "band" is not a kind of teaching: it is an hour that is
#: spoken for without being a class, like a shift at work, and it draws behind the day.
KINDS = ("ea", "gy", "both", "konz", "band")


def _id():
    """A number no class in this file is using.

    The week is a file somebody edits by hand, and this app now edits it too. An index
    into the list cannot be the name of a row when both of those are true: delete the
    second class and every class after it answers to a different number, so an edit sent a
    moment later lands on a neighbour. So a class gets an id the first time it is written
    and keeps it.
    """
    return int(time.time() * 1000)


def _clock(said, what):
    """"09:30" as minutes past midnight, or a refusal naming the field."""
    parts = str(said or "").split(":")
    try:
        if len(parts) != 2:
            raise ValueError
        hour, minute = int(parts[0]), int(parts[1])
    except (TypeError, ValueError):
        raise Error("%s should be a time like 09:30, not %r" % (what, said), 400)
    if not (0 <= hour <= 23 and 0 <= minute <= 59):
        raise Error("%s is not a time of day: %r" % (what, said), 400)
    return hour * 60 + minute


def _entry(sent, onto=None):
    """One class, checked, as it will be written.

    Checked here rather than in the page. The page is one way in and the file is another,
    and a form that refuses a finish before its start says nothing about what is already
    on disk. What this refuses cannot be written by this app at all.
    """
    made = dict(onto or {})
    for field in FIELDS:
        if field in sent:
            made[field] = sent[field]

    made["day"] = as_int(made.get("day"), "day", minimum=0)
    if made["day"] > 4:
        raise Error("the week has five days, so day is 0 to 4", 400)

    starts = _clock(made.get("at"), "at")
    ends = _clock(made.get("to"), "to")
    if ends <= starts:
        raise Error("a class cannot finish before it starts", 400)

    made["kind"] = (made.get("kind") or "gy").strip()
    if made["kind"] not in KINDS:
        raise Error("kind is one of %s" % ", ".join(KINDS), 400)

    made["name"] = (made.get("name") or "").strip()[:200]
    if not made["name"]:
        raise Error("a class needs a name", 400)

    made["whose"] = (made.get("whose") or "me").strip()[:100] or "me"
    for field in ("where", "code", "group", "teacher"):
        made[field] = str(made.get(field) or "").strip()[:200]
    made["skip"] = bool(made.get("skip"))
    return made


def _save(found):
    """The week back to disk, whole, and never half written.

    Written beside itself and moved into place. This file is typed in by hand over a
    semester and is not anywhere else; a process that dies halfway through writing it
    would leave somebody with a broken file and nothing to put back.
    """
    where = path()
    beside = where + ".writing"
    with io.open(beside, "w", encoding="utf-8", newline="\n") as f:
        json.dump(found, f, ensure_ascii=False, indent=2)
    os.replace(beside, where)


def _week_now():
    """The file, as something that can be written back, or a refusal.

    A file that will not parse is not overwritten. Somebody is midway through editing it
    and the honest answer is to say so, not to replace their afternoon's typing with
    whatever this app happens to hold.
    """
    found = read()
    if found is None:
        found = {"classes": []}
    if found.get("broken"):
        raise Error("orarend.json cannot be read, so it is not being written over: %s"
                    % found["broken"], 409)
    found.setdefault("classes", [])
    return found


def _find(found, said):
    """Which class a call is about, and where it sits in the list.

    Either an id, for a class this app has written before, or i:3 for one typed into the
    file by hand, which has no id yet and is named by its position. The second is checked
    against the week the caller was actually looking at: the position is only a name for
    as long as nothing above it has moved.
    """
    said = str(said)
    if said.startswith("i:"):
        at = as_int(said[2:], "id", minimum=0)
        if at >= len(found["classes"]):
            raise Error("there is no class at %s any more" % said, 404)
        entry = found["classes"][at]
        if entry.get("id"):
            raise Error("the week has moved under this edit; open it again", 409)
        return at, entry
    wanted = as_int(said, "id")
    for at, entry in enumerate(found["classes"]):
        if entry.get("id") == wanted:
            return at, entry
    raise Error("no class with id %s" % wanted, 404)


def add_class(req):
    """A class the page has just made up."""
    sent = req.json() or {}
    need(sent, "name", "at", "to")       # complained about by name rather than in general
    found = _week_now()
    made = _entry(sent)
    taken = {e.get("id") for e in found["classes"]}
    made["id"] = _id()
    while made["id"] in taken:
        made["id"] += 1
    found["classes"].append(made)
    _save(found)
    return week(req)


def save_class(req):
    """A class as it now is. Only what was sent changes."""
    found = _week_now()
    at, entry = _find(found, req.params["id"])
    made = _entry(req.json() or {}, onto=entry)
    # A class typed in by hand gets its id here, on the first thing written to it.
    made["id"] = entry.get("id") or _id()
    found["classes"][at] = made
    _save(found)
    return week(req)


def drop_class(req):
    found = _week_now()
    at, _ = _find(found, req.params["id"])
    found["classes"].pop(at)
    _save(found)
    return week(req)


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
        ("POST", "/api/orarend/classes"): add_class,
        ("PUT", "/api/orarend/classes/<id>"): save_class,
        ("DELETE", "/api/orarend/classes/<id>"): drop_class,
        ("GET", "/api/orarend/notes"): notes,
        ("PUT", "/api/orarend/notes"): set_absences,
        ("POST", "/api/orarend/notes/pages"): add_page,
        ("PUT", "/api/orarend/notes/pages/<id>"): save_page,
        ("DELETE", "/api/orarend/notes/pages/<id>"): drop_page,
    }
