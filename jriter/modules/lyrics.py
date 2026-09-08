"""Lyrics, their alternatives, and the history of each.

The words are Markdown, and the first line is the name. That is the whole naming scheme:
a sheet called itself by its heading, the way a document does, so there is no separate
name to keep in step and no Rename button to press. A sheet with nothing written yet
falls back to its number.

A song has several lyric sheets and one of them is current. Each sheet keeps every text
it has ever held, so history belongs to the alternative rather than to the song. Saving
the same words twice does not make a second entry, because a history full of identical
snapshots is worse than no history.
"""
import time

from .. import db, finding
from ..wire import Error, need
from . import songs

NAME = "lyrics"

SCHEMA = [
    """
    CREATE TABLE IF NOT EXISTS lyric_sheets (
      id         INTEGER PRIMARY KEY,
      song_id    INTEGER NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
      name       TEXT NOT NULL DEFAULT 'Alternative',
      position   INTEGER NOT NULL DEFAULT 0,
      is_current INTEGER NOT NULL DEFAULT 0,
      created_at REAL NOT NULL
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS lyric_revisions (
      id         INTEGER PRIMARY KEY,
      sheet_id   INTEGER NOT NULL REFERENCES lyric_sheets(id) ON DELETE CASCADE,
      text       TEXT NOT NULL DEFAULT '',
      created_at REAL NOT NULL
    )
    """,
    "CREATE INDEX IF NOT EXISTS sheets_song ON lyric_sheets(song_id, position)",
    "CREATE INDEX IF NOT EXISTS revisions_sheet ON lyric_revisions(sheet_id, id DESC)",
]


def get_sheet(sheet_id):
    row = db.one("SELECT * FROM lyric_sheets WHERE id = ?", (sheet_id,))
    if not row:
        raise Error("no lyric alternative with id %s" % sheet_id, 404)
    return row


def name_from(text, fallback):
    """The first non empty line, minus any Markdown heading marks.

    A document is called whatever its first line says. Doing this here rather than in the
    browser means the name is the same everywhere it is read, including from the API.
    """
    for line in (text or "").splitlines():
        line = line.strip().lstrip("#").strip()
        if line:
            return line[:80]
    return fallback


def plain_name(sheet):
    """What a set of words with nothing in it is called.

    Not the name it had. Deleting every word out of a sheet left the old first line sitting
    on the card as its title, so the card read as the previous words with the body missing:
    "nem torli ki, hanem az elozo szoveget mutatja ugyanugy", with a screenshot of a
    revision marked nought characters under a heading that still said something.

    The same shape a sheet gets when it is made, since that is what it has gone back to
    being: one of several, with nothing written in it yet.
    """
    try:
        return "v%d" % (int(sheet["position"]) + 1)
    except (KeyError, TypeError, ValueError):
        return "v1"


def _latest(sheet_id):
    return db.one("SELECT * FROM lyric_revisions WHERE sheet_id = ? ORDER BY id DESC LIMIT 1",
                  (sheet_id,))


def _with_text(sheet):
    revision = _latest(sheet["id"])
    sheet = dict(sheet)
    sheet["text"] = revision["text"] if revision else ""
    sheet["revision_id"] = revision["id"] if revision else None
    sheet["updated_at"] = revision["created_at"] if revision else sheet["created_at"]
    count = db.one("SELECT COUNT(*) AS n FROM lyric_revisions WHERE sheet_id = ?", (sheet["id"],))
    sheet["revisions"] = count["n"] if count else 0
    return sheet


def list_sheets(req):
    song = songs.get(req.params["id"])
    rows = db.query("SELECT * FROM lyric_sheets WHERE song_id = ? ORDER BY position, id",
                    (song["id"],))
    return {"lyrics": [_with_text(r) for r in rows]}


def create_sheet(req):
    song = songs.get(req.params["id"])
    data = req.json()
    name = (data.get("name") or "").strip()
    existing = db.query("SELECT * FROM lyric_sheets WHERE song_id = ?", (song["id"],))
    if not name:
        # Nobody wants to name a thing before writing it. A number is enough until it
        # earns a name, and with only one sheet the name is never shown at all.
        name = "v%d" % (len(existing) + 1)
    row = db.one("SELECT MAX(position) AS p FROM lyric_sheets WHERE song_id = ?", (song["id"],))
    sheet_id = db.insert("lyric_sheets", {
        "song_id": song["id"], "name": name,
        "position": ((row["p"] if row and row["p"] is not None else -1) + 1),
        "is_current": 0 if existing else 1,
        "created_at": time.time()})
    text = data.get("text")
    if text:
        db.insert("lyric_revisions",
                  {"sheet_id": sheet_id, "text": text, "created_at": time.time()})
        db.update("lyric_sheets", sheet_id, {"name": name_from(text, name)})
    songs.touch(song["id"])
    return {"sheet": _with_text(get_sheet(sheet_id))}


def save_text(req):
    """Write new words. Unchanged text is not a revision."""
    sheet = get_sheet(req.params["id"])
    data = req.json()
    if "text" not in data:
        raise Error("text is required")
    text = data["text"] or ""
    current = _latest(sheet["id"])
    if current and current["text"] == text:
        return {"sheet": _with_text(sheet), "saved": False,
                "message": "Nothing changed, so no new revision was kept."}
    db.insert("lyric_revisions",
              {"sheet_id": sheet["id"], "text": text, "created_at": time.time()})
    # An empty sheet goes back to being called v-something rather than keeping the title
    # of the words that were deleted out of it.
    db.update("lyric_sheets", sheet["id"],
              {"name": name_from(text, plain_name(sheet))})
    songs.touch(sheet["song_id"])
    return {"sheet": _with_text(get_sheet(sheet["id"])), "saved": True}


def rename(req):
    sheet = get_sheet(req.params["id"])
    data = req.json()
    patch = {}
    if "name" in data:
        patch["name"] = need(data, "name")
    if patch:
        db.update("lyric_sheets", sheet["id"], patch)
    return {"sheet": _with_text(get_sheet(sheet["id"]))}


def make_current(req):
    sheet = get_sheet(req.params["id"])
    db.run("UPDATE lyric_sheets SET is_current = 0 WHERE song_id = ?", (sheet["song_id"],))
    db.update("lyric_sheets", sheet["id"], {"is_current": 1})
    songs.touch(sheet["song_id"])
    return {"sheet": _with_text(get_sheet(sheet["id"]))}


def history(req):
    sheet = get_sheet(req.params["id"])
    return {"revisions": db.query(
        "SELECT id, created_at, length(text) AS length FROM lyric_revisions "
        "WHERE sheet_id = ? ORDER BY id DESC", (sheet["id"],))}


def revision(req):
    row = db.one("SELECT * FROM lyric_revisions WHERE id = ?", (req.params["id"],))
    if not row:
        raise Error("no revision with id %s" % req.params["id"], 404)
    return {"revision": row}


def restore(req):
    """Bringing an old text back is a new revision, so nothing in the history is lost."""
    sheet = get_sheet(req.params["id"])
    revision_id = req.json().get("revision_id")
    old = db.one("SELECT * FROM lyric_revisions WHERE id = ? AND sheet_id = ?",
                 (revision_id, sheet["id"]))
    if not old:
        raise Error("that revision is not part of this alternative", 404)
    current = _latest(sheet["id"])
    if current and current["text"] == old["text"]:
        return {"sheet": _with_text(sheet), "saved": False,
                "message": "That text is already the current one."}
    db.insert("lyric_revisions",
              {"sheet_id": sheet["id"], "text": old["text"], "created_at": time.time()})
    db.update("lyric_sheets", sheet["id"],
              {"name": name_from(old["text"], plain_name(sheet))})
    songs.touch(sheet["song_id"])
    return {"sheet": _with_text(get_sheet(sheet["id"])), "saved": True}


def delete_sheet(req):
    sheet = get_sheet(req.params["id"])
    db.run("DELETE FROM lyric_revisions WHERE sheet_id = ?", (sheet["id"],))
    db.run("DELETE FROM lyric_sheets WHERE id = ?", (sheet["id"],))
    if sheet["is_current"]:
        other = db.one("SELECT id FROM lyric_sheets WHERE song_id = ? ORDER BY position LIMIT 1",
                       (sheet["song_id"],))
        if other:
            db.update("lyric_sheets", other["id"], {"is_current": 1})
    return {"deleted": sheet["id"]}


def SUMMARY():
    row = db.one("SELECT COUNT(*) AS n FROM lyric_sheets")
    return {"alternatives": row["n"] if row else 0}


def SEARCH(term, limit):
    """Words, which is the search that finds a song you can only remember a line of.

    The current text of each alternative and nothing older. Every revision would hand
    back the same sheet once per draft, and taking somebody to a sheet because of a line
    they deleted in March is a wrong answer dressed up as a hit. The subquery is one
    seek per sheet on revisions_sheet, which exists already.

    Measured here, three hundred sheets holding 815 KB of current words: 2.0 ms plain,
    4.0 ms through fold(), which is what makes an accented line findable in lower case.
    Ten times the words is 33 ms. It is linear in bytes and it runs once per settled
    burst of typing, not per keystroke, so at this size it is under 2% of one core.
    FTS5 would make it constant and would have to be kept in step with every save; that
    trade is not worth making until this measures in the hundreds of milliseconds.

    The text itself never leaves this function. One matched line per hit is the whole
    point, and shipping whole sheets to draw one line each is how a list gets slow.
    """
    group = {"label": "Words", "kind": "lyric", "order": 40, "total": 0, "hits": []}
    if len(term) < finding.MIN_TEXT:
        # One letter is in every sheet in the library. Answering that is slow and says
        # nothing, so it is not answered.
        return group
    like = finding.pattern(term)
    rows = db.query(
        "SELECT sh.id, sh.song_id, sh.name, sh.is_current, s.title AS song_title, "
        "       s.updated_at, r.text "
        "FROM lyric_sheets sh "
        "JOIN songs s ON s.id = sh.song_id "
        "JOIN lyric_revisions r ON r.id = (SELECT id FROM lyric_revisions "
        "     WHERE sheet_id = sh.id ORDER BY id DESC LIMIT 1) "
        "WHERE fold(r.text) LIKE ? ESCAPE '\\' OR fold(sh.name) LIKE ? ESCAPE '\\'",
        (like, like))
    for row in rows:
        text = row.pop("text", "") or ""
        row["line"] = finding.line_around(text, term)
        # A sheet whose name matched is a stronger hit than a word buried in a verse,
        # and the name is the first line of the words anyway.
        row["score"] = finding.rank(term, row["name"])
    rows.sort(key=lambda r: (-r["score"], -(r["updated_at"] or 0)))
    for row in rows[:limit]:
        row["title"] = row["song_title"]
        row["href"] = "#/song/%d" % row["song_id"]
    group["total"] = len(rows)
    group["hits"] = rows[:limit]
    return group


def ROUTES():
    return {
        ("GET", "/api/songs/<id>/lyrics"): list_sheets,
        ("POST", "/api/songs/<id>/lyrics"): create_sheet,
        ("PUT", "/api/lyrics/<id>/text"): save_text,
        ("PATCH", "/api/lyrics/<id>"): rename,
        ("POST", "/api/lyrics/<id>/current"): make_current,
        ("GET", "/api/lyrics/<id>/history"): history,
        ("POST", "/api/lyrics/<id>/restore"): restore,
        ("DELETE", "/api/lyrics/<id>"): delete_sheet,
        ("GET", "/api/lyric-revisions/<id>"): revision,
    }
