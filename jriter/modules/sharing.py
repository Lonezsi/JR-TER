"""Letting a friend work on one song.

What a share is: one song, in your library, that one other account may open. They can listen
to it, read the words, and work on the equaliser and the limiter. That is the whole of it.
They cannot see your other songs, your samples, your renders list, your albums, your
account, or anything that posts to YouTube.

What a share is not: shared editing. Their changes land in *their* library, as their own
copy, and yours is untouched. If they were given a name when the share was made, the copy
says so: an equaliser preset they edit becomes "Wide master, edited by Jozsef", and the
same for a sheet of words. Anything they make from scratch is simply theirs.

How it is enforced, and this is the part worth being careful about. It would be easy to say
"a shared request runs as the sharer" and let the ordinary routes do the work. That would be
wrong: it hands somebody else's whole library to a request and relies on every handler in
the project to be careful, for ever. Instead the routes here are the only way in, there are
seven of them, each one takes the share id and looks up what it is allowed to touch, and
crossing into the other library happens inside who.acting_as for the length of one read.

So the reach of a share is bounded by this file rather than by a permission check that every
future handler has to remember.
"""
import json
import time

from .. import db, who, accounts, registry
from ..wire import Error, need, as_int, Response

NAME = "sharing"

#: A share itself is a row in accounts.db, because it names two accounts and a song in one
#: of their libraries. What lives here, in the owner's own library, is the record of what the
#: people a song is shared with changed on it, and how to put each change back.
SCHEMA = [
    """
    CREATE TABLE IF NOT EXISTS guest_edits (
      id         INTEGER PRIMARY KEY,
      song_id    INTEGER NOT NULL,
      account    INTEGER NOT NULL,
      share_id   INTEGER NOT NULL,
      what       TEXT NOT NULL,
      route      TEXT NOT NULL,
      -- The song as it was before this change: every row of it in every table a guest can
      -- touch, as JSON. Putting the change back is writing these back.
      before     TEXT NOT NULL,
      created_at REAL NOT NULL,
      updated_at REAL NOT NULL,
      undone_at  REAL NOT NULL DEFAULT 0
    )
    """,
    "CREATE INDEX IF NOT EXISTS guest_edits_song ON guest_edits(song_id, id DESC)",
]


def _me():
    return who.must()


class _AsRequest:
    """Enough of a Request for a handler that only wants params and headers.

    Used once, to hand the versions module a version id that came from a share rather than
    from the caller. A dict would not do: audio() reads req.params and req.headers, and the
    Range header has to travel or seeking in a shared song would refetch the whole file.
    """

    def __init__(self, params, headers):
        self.params = params
        self.headers = headers
        self.query = {}

    def q(self, name, fallback=None):
        return fallback

    def json(self):
        return {}


# ── what a share is allowed to reach ─────────────────────────────────────────
def _share(share_id, for_account=None):
    """One live share, or an explanation.

    Every route here starts with this. It is the only place that turns a number from a URL
    into permission to look at somebody else's library, so it is the only place that has to
    be right about it.
    """
    row = accounts.share(share_id)
    if not row or row["revoked_at"]:
        # The same answer for "no such share" and "not yours": a share id is a small
        # number, and telling somebody which ones exist is telling them what to guess.
        raise Error("That share is not open to you.", 404)
    want = for_account if for_account is not None else _me()
    if row["to_account"] != want and row["from_account"] != want:
        raise Error("That share is not open to you.", 404)
    return row


def _theirs(share):
    """The account whose library the shared song lives in."""
    return share["from_account"]


def _preset_out(row):
    """One sound preset, as the recipient sees it.

    The settings live in a single JSON column called data, holding the equaliser bands and
    the limiter together, which is why nothing here filters by kind: there is no kind.
    """
    row = dict(row)
    try:
        row["data"] = json.loads(row["data"])
    except (ValueError, TypeError):
        row["data"] = {}
    return row


def _sheet_out(row):
    """One sheet of words, with its latest text.

    A sheet is a name and its text is the newest row in lyric_revisions, so reading one is
    two queries. Only the latest: the sharer's revision history is theirs.
    """
    row = dict(row)
    latest = db.one("SELECT text FROM lyric_revisions WHERE sheet_id = ? "
                    "ORDER BY id DESC LIMIT 1", (row["id"],))
    row["text"] = latest["text"] if latest else ""
    return row


def _song_in(share):
    """The shared song, read out of the sharer's library.

    Inside acting_as, so config and db resolve to their files for exactly this call and
    hand the thread straight back afterwards.
    """
    with who.acting_as(_theirs(share)):
        row = db.one("SELECT id, title, current_version_id, created_at FROM songs "
                     "WHERE id = ?", (share["song_id"],))
    if not row:
        # The song was deleted after the share was made. Not an error on the recipient's
        # part, and not something to leave them guessing about.
        raise Error("The song behind this share is gone.", 410)
    # AND IT IS THE SAME SONG. A share names its song by id, and SQLite gives the next
    # song the highest id plus one, so deleting the newest song and making another hands
    # the new one the old number. Reproduced: share song 2, delete it, make a private
    # song, and the guest's share opened "A brand new private song".
    #
    # A song's created_at is set once and never moved, and a share can only be made of a
    # song that already exists. So a song made after its share is a different song
    # wearing the shared one's number. Nothing new is stored for this, which is why it
    # also protects every share that was already open before the check existed.
    # Deleting a song now takes its shares with it too; this is what still holds if a
    # song ever leaves by some other path.
    if row["created_at"] > share["created_at"]:
        raise Error("The song behind this share is gone.", 410)
    return row


# ── the recipient's view ─────────────────────────────────────────────────────
def shared_with_me(req):
    """The separate list. Not mixed in with your own songs, because they are not yours."""
    out = []
    for row in accounts.shares_to(_me()):
        try:
            song = _song_in(row)
        except Error:
            continue                    # deleted behind the share; simply not listed
        from_who = accounts.public(accounts.by_id(row["from_account"]))
        out.append({
            "share": row["id"],
            "title": song["title"],
            "from": from_who["name"] if from_who else "somebody",
            "from_handle": from_who["handle"] if from_who else "",
            "as_name": row["as_name"],
            "created_at": row["created_at"],
            "can_play": bool(song["current_version_id"]),
            # The cover, so the row looks like the song rather than like a letter in a box.
            # The id is the sharer's, and is only ever usable through the share route below.
            "art": (_artwork_in(row) or [{}])[0].get("id"),
        })
    return {"shared": out}


def open_share(req):
    """Everything the recipient is allowed to see about one shared song.

    One call rather than five, because every one of them is a crossing into somebody else's
    library and the fewer of those there are the easier this file is to be sure about.
    """
    share = _share(req.params["id"])
    song = _song_in(share)

    presets, sheets, version = [], [], None
    with who.acting_as(_theirs(share)):
        if registry.has("versions") and song["current_version_id"]:
            version = db.one(
                "SELECT id, n, duration, filename FROM versions WHERE id = ?",
                (song["current_version_id"],))
        # The equaliser and the limiter, which are one preset: sound_presets holds both
        # in its data blob, which is why there is no kind to filter on. Song scoped only,
        # so the sharer's library wide setup is not part of this.
        if registry.has("sound") and db.table_exists("sound_presets"):
            presets = [_preset_out(r) for r in db.query(
                "SELECT id, name, is_current, data, created_at FROM sound_presets "
                "WHERE song_id = ? ORDER BY id", (share["song_id"],))]
        if registry.has("lyrics") and db.table_exists("lyric_sheets"):
            sheets = [_sheet_out(r) for r in db.query(
                "SELECT id, name, position, is_current, created_at FROM lyric_sheets "
                "WHERE song_id = ? ORDER BY position, id", (share["song_id"],))]

    from_who = accounts.public(accounts.by_id(share["from_account"]))
    return {
        "share": share["id"],
        "song": {"title": song["title"], "id": song["id"]},
        # Everything hanging on the song. Shown because it was shared on purpose: a share
        # is one song handed to one person, and holding back the artwork made it look like
        # a title and a waveform.
        "artwork": _artwork_in(share),
        "from": from_who["name"] if from_who else "somebody",
        "as_name": share["as_name"],
        "version": version,
        # Theirs, and read only. Anything the recipient saves becomes a copy in their own
        # library, which is what mine below returns.
        "presets": presets,
        "sheets": sheets,
        "mine": _my_copies(share),
    }


def _artwork_in(share):
    """The shared song's pictures, read out of the sharer's library.

    Returns the rows the recipient is allowed to name, which is the ones hanging on the song
    that was shared and nothing else in that library.
    """
    if not registry.has("artwork"):
        return []
    # Through the same check as everything else. This was the one read that went straight
    # to the song's id, so a share whose song had been replaced served the new song's
    # pictures even once every other route refused it.
    _song_in(share)
    with who.acting_as(_theirs(share)):
        if not db.table_exists("artwork"):
            return []
        return [dict(r) for r in db.query(
            "SELECT id, caption, position FROM artwork WHERE song_id = ? "
            "ORDER BY position, id", (share["song_id"],))]


def shared_artwork(req):
    """One picture from a shared song.

    Guests could not see the artwork at all. Every route that serves an image is scoped to
    the caller's own library, which is right, and it left a share as a title and a waveform
    when the person it was sent to had been shown the cover deliberately.

    THE IMAGE ID IS CHECKED AGAINST THE SHARE, not merely used. The id arrives from the
    caller, and an id used as given here would be a way to read any picture in any library
    on the server from any share. So the share names the song, the song names its pictures,
    and an id that is not one of those is refused before anything is opened. Same shape as
    shared_audio, which resolves the version through the share for the same reason.
    """
    share = _share(req.params["id"])
    want = as_int(req.params["image"], "image")
    allowed = {row["id"] for row in _artwork_in(share)}
    if want not in allowed:
        # The same answer as for a picture that does not exist. Telling somebody which ids
        # are real in a library they cannot see is telling them what to ask for next.
        raise Error("That picture is not part of this share.", 404)

    from . import artwork
    with who.acting_as(_theirs(share)):
        return artwork.image(_AsRequest({"id": want}, req.headers))


def shared_audio(req):
    """The bytes of the shared song's current version.

    The one route here that hands over a file, and the only reason a share can be listened
    to at all. It resolves the version through the share rather than taking a version id
    from the caller: given an id, this would be a way to read any file in any library.
    """
    share = _share(req.params["id"])
    song = _song_in(share)
    if not song["current_version_id"]:
        raise Error("There is no render on this song yet.", 404)
    from . import versions
    with who.acting_as(_theirs(share)):
        # The ordinary route reads the id out of the URL, so it is handed one it would
        # have found there. What makes this safe is that the id came from the share and
        # not from the caller: given a free choice of version id, this would be a way to
        # read any file in any library on the server.
        return versions.audio(_AsRequest({"id": song["current_version_id"]},
                                         req.headers))


# ── what the recipient makes ─────────────────────────────────────────────────
#
# All of this is written to the recipient's own library, so none of it is inside acting_as.
# Their copies live on a song of their own, made once, so that everything they do about this
# share sits together and behaves like every other song on their screen.

def _my_song(share):
    """The recipient's own copy of the shared song, made the first time they save.

    Not a copy of the audio: it is a place to hang their words and their presets. The title
    says whose it was, because a row appearing in your library that you did not make is
    otherwise a mystery.
    """
    from_who = accounts.public(accounts.by_id(share["from_account"]))
    marker = "share:%d" % share["id"]
    row = db.one("SELECT id FROM songs WHERE shared_from = ?", (marker,))
    if row:
        return row["id"]
    song = _song_in(share)
    now = time.time()
    song_id = db.insert("songs", {
        "title": "%s (%s)" % (song["title"], from_who["name"] if from_who else "shared"),
        "created_at": now, "updated_at": now, "shared_from": marker})
    return song_id


def _my_copies(share):
    """What the recipient has already made against this share."""
    marker = "share:%d" % share["id"]
    row = db.one("SELECT id FROM songs WHERE shared_from = ?", (marker,))
    if not row:
        return {"song": None, "presets": [], "sheets": []}
    presets, sheets = [], []
    if registry.has("sound") and db.table_exists("sound_presets"):
        presets = [_preset_out(r) for r in db.query(
            "SELECT id, name, is_current, data, created_at FROM sound_presets "
            "WHERE song_id = ? ORDER BY id", (row["id"],))]
    if registry.has("lyrics") and db.table_exists("lyric_sheets"):
        sheets = [_sheet_out(r) for r in db.query(
            "SELECT id, name, position, is_current, created_at FROM lyric_sheets "
            "WHERE song_id = ? ORDER BY position, id", (row["id"],))]
    return {"song": row["id"], "presets": presets, "sheets": sheets}


# -- what everybody on a song has made ---------------------------------------
#
# A guest's work lives in their own library, on a copy of the song made the first time they
# saved: their words, their sound, and anything they did to that copy on its own song page,
# pictures and uploaded mixes included. Nothing used to read it back out, so the owner saw
# none of it and neither did anybody else the song was shared with, which is the opposite
# of why a song gets shared. These read it, for exactly the people who share the song and
# nobody else, one crossing at a time, the same as everything else in this file.

def _people_on(owner, song_id):
    """Every live, claimed share of one song. A link nobody has opened yet is nobody."""
    return [r for r in accounts.shares_from(owner, song_id) if r["to_account"]]


def _may_see(share, me):
    """Whether `me` may look at what the person behind `share` made.

    The owner of the song, or anybody who holds a live share of the same song from the same
    owner. Their own work included: seeing yourself in the list is not a leak.
    """
    if me == share["from_account"]:
        return True
    return any(r["to_account"] == me
               for r in _people_on(share["from_account"], share["song_id"]))


def _their_copy(share):
    """The song in the guest's library that holds their work on this share, or None.

    Read inside the guest's library. Only the one row that names this share, so a guest's
    other songs, and everything else of theirs, stay out of reach.
    """
    with who.acting_as(share["to_account"]):
        return db.one("SELECT id, title, updated_at FROM songs WHERE shared_from = ?",
                      ("share:%d" % share["id"],))


def _work_of(share):
    """Everything the person behind one share has made on it, for showing."""
    copy = _their_copy(share)
    person = accounts.public(accounts.by_id(share["to_account"])) or {}
    out = {"share": share["id"], "name": person.get("name") or share["as_name"] or "",
           "handle": person.get("handle", ""), "since": share["created_at"],
           "updated_at": None, "sheets": [], "presets": [], "artwork": [], "versions": [],
           "made_anything": False}
    if not copy:
        return out
    out["updated_at"] = copy["updated_at"]
    with who.acting_as(share["to_account"]):
        if registry.has("lyrics") and db.table_exists("lyric_sheets"):
            out["sheets"] = [_sheet_out(r) for r in db.query(
                "SELECT id, name, position, is_current, created_at FROM lyric_sheets "
                "WHERE song_id = ? ORDER BY position, id", (copy["id"],))]
            out["sheets"] = [x for x in out["sheets"] if x["text"].strip()]
        if registry.has("sound") and db.table_exists("sound_presets"):
            out["presets"] = [_preset_out(r) for r in db.query(
                "SELECT id, name, is_current, data, created_at FROM sound_presets "
                "WHERE song_id = ? ORDER BY id", (copy["id"],))]
        if registry.has("artwork") and db.table_exists("artwork"):
            out["artwork"] = [dict(r) for r in db.query(
                "SELECT id, caption, position FROM artwork WHERE song_id = ? "
                "ORDER BY position, id", (copy["id"],))]
        if registry.has("versions") and db.table_exists("versions"):
            out["versions"] = [dict(r) for r in db.query(
                "SELECT id, n, filename, duration, created_at FROM versions "
                "WHERE song_id = ? ORDER BY n DESC", (copy["id"],))]
    out["made_anything"] = bool(out["sheets"] or out["presets"] or out["artwork"]
                                or out["versions"])
    return out


def song_guests(req):
    """For the owner's song page: everybody the song is shared with, and what they made."""
    me = _me()
    song = as_int(req.params["id"], "id")
    if not db.one("SELECT id FROM songs WHERE id = ?", (song,)):
        raise Error("No such song.", 404)
    people = [_work_of(r) for r in _people_on(me, song)]
    for person in people:
        row = db.one("SELECT COUNT(*) AS n FROM guest_edits WHERE share_id = ? "
                     "AND song_id = ? AND undone_at = 0", (person["share"], song))
        person["changes"] = row["n"] if row else 0
        person["made_anything"] = person["made_anything"] or bool(person["changes"])
    return {"people": people}


def shared_guests(req):
    """For somebody a song is shared with: what everybody else on it made."""
    share = _share(req.params["id"])
    _song_in(share)
    me = _me()
    others = [r for r in _people_on(share["from_account"], share["song_id"])
              if r["to_account"] != me]
    return {"people": [_work_of(r) for r in others]}


def _guest_share(req):
    """The share named in a guest-work URL, checked against whoever is asking."""
    share = accounts.share(as_int(req.params["share"], "share"))
    if not share or share["revoked_at"] or not share["to_account"] \
            or not _may_see(share, _me()):
        raise Error("That is not open to you.", 404)
    return share


def guest_artwork(req):
    """One picture off a guest's copy. The id is checked against that copy, not trusted."""
    share = _guest_share(req)
    copy = _their_copy(share)
    want = as_int(req.params["image"], "image")
    from . import artwork
    with who.acting_as(share["to_account"]):
        if not copy or not db.one("SELECT id FROM artwork WHERE id = ? AND song_id = ?",
                                  (want, copy["id"])):
            raise Error("That picture is not part of this share.", 404)
        return artwork.image(_AsRequest({"id": want}, req.headers))


def guest_audio(req):
    """One of a guest's own mixes, the same way."""
    share = _guest_share(req)
    copy = _their_copy(share)
    want = as_int(req.params["version"], "version")
    from . import versions
    with who.acting_as(share["to_account"]):
        if not copy or not db.one("SELECT id FROM versions WHERE id = ? AND song_id = ?",
                                  (want, copy["id"])):
            raise Error("That mix is not part of this share.", 404)
        return versions.audio(_AsRequest({"id": want}, req.headers))


# -- working on the owner's song itself ----------------------------------------
#
# A guest can do on a shared song what the owner can, through the owner's own routes, with
# three limits that are the whole of the design:
#
#   1. Only the routes below, and each one only on this song. Every id in the path is
#      checked to belong to the shared song before anything runs.
#   2. Nothing that deletes. Not a picture, not a set of words, not a mix. A guest can add
#      a picture and make it the cover; the old one is still there.
#   3. Every change is recorded with the song as it was before it, so the owner can put it
#      back. Words and titles kept their history already; sound and arrangement did not,
#      and this is what gives them one.

#: (method, route) -> what the ids in it are, and what the change is called.
GUEST_MAY = {
    ("GET", "/api/songs/<id>"): ("song", None),
    ("GET", "/api/songs/<id>/titles"): ("song", None),
    ("PATCH", "/api/songs/<id>"): ("song", "renamed the song"),
    ("GET", "/api/songs/<id>/artwork"): ("song", None),
    ("POST", "/api/songs/<id>/artwork"): ("song", "added a picture"),
    ("POST", "/api/songs/<id>/artwork/order"): ("song", "changed the cover"),
    ("GET", "/api/artwork/<id>/image"): ("artwork", None),
    ("GET", "/api/songs/<id>/lyrics"): ("song", None),
    ("POST", "/api/songs/<id>/lyrics"): ("song", "added words"),
    ("PUT", "/api/lyrics/<id>/text"): ("sheet", "edited the words"),
    ("PATCH", "/api/lyrics/<id>"): ("sheet", "renamed the words"),
    ("POST", "/api/lyrics/<id>/current"): ("sheet", "chose which words"),
    ("GET", "/api/lyrics/<id>/history"): ("sheet", None),
    ("POST", "/api/lyrics/<id>/restore"): ("sheet", "brought back older words"),
    ("GET", "/api/lyric-revisions/<id>"): ("revision", None),
    ("GET", "/api/songs/<id>/sound"): ("song", None),
    ("POST", "/api/songs/<id>/sound"): ("song", "added a sound"),
    ("PUT", "/api/sound/<id>"): ("preset", "changed the sound"),
    ("PATCH", "/api/sound/<id>"): ("preset", "renamed a sound"),
    ("POST", "/api/sound/<id>/current"): ("preset", "chose which sound"),
    ("GET", "/api/songs/<id>/versions"): ("song", None),
    ("POST", "/api/songs/<id>/versions"): ("song", "uploaded a mix"),
    ("PATCH", "/api/versions/<id>"): ("version", "renamed a mix"),
    ("POST", "/api/versions/<id>/current"): ("version", "chose which mix"),
    ("GET", "/api/versions/<id>/audio"): ("version", None),
    ("GET", "/api/versions/<id>/download"): ("version", None),
    ("GET", "/api/songs/<id>/arrangement"): ("song", None),
    ("PUT", "/api/songs/<id>/arrangement"): ("song", "changed the arrangement"),
    ("POST", "/api/songs/<id>/arrangement/enabled"): ("song", "switched the arrangement"),
    ("GET", "/api/arrangements/shapes"): (None, None),
    # Voices. Not in the history below: a take is added whole and a guest can only change
    # or delete their own, which the vocals module decides, so there is nothing of the
    # owner's for a guest's take to overwrite.
    ("GET", "/api/songs/<id>/vocals"): ("song", None),
    ("POST", "/api/songs/<id>/vocals"): ("song", None),
    ("PATCH", "/api/vocals/<id>"): ("vocal", None),
    ("DELETE", "/api/vocals/<id>"): ("vocal", None),
    ("GET", "/api/vocals/<id>/audio"): ("vocal", None),
}

#: Who the guest is, while their request runs in the owner's library. who.must() answers
#: the owner in there, which is what makes the owner's routes work at all; anything that
#: needs to credit or limit the guest asks this instead.
import contextvars                                            # noqa: E402
_GUEST = contextvars.ContextVar("jriter_guest", default=0)


def guest_now():
    """The account a shared request is for, or 0 when it is nobody's but the caller's."""
    return _GUEST.get()

#: What a song is, for putting a change back: table, and how its rows belong to the song.
_SONG_TABLES = (
    ("songs", "id = ?"),
    ("lyric_sheets", "song_id = ?"),
    ("sound_presets", "song_id = ?"),
    ("artwork", "song_id = ?"),
    ("versions", "song_id = ?"),
    ("arrangements", "song_id = ?"),
)

#: Saves in a row from one person, closer together than this, are one change. The equaliser
#: saves every 600ms while a band is dragged; a history of every one of those is noise.
SITTING = 120


def _snapshot(song_id):
    out = {}
    for table, where in _SONG_TABLES:
        if db.table_exists(table):
            out[table] = [dict(r) for r in db.query(
                "SELECT * FROM %s WHERE %s" % (table, where), (song_id,))]
    if db.table_exists("lyric_revisions"):
        top = db.one("SELECT MAX(r.id) AS m FROM lyric_revisions r JOIN lyric_sheets s "
                     "ON s.id = r.sheet_id WHERE s.song_id = ?", (song_id,))
        out["lyric_revisions_max"] = (top and top["m"]) or 0
    return out


def _belongs(kind, ident, song_id):
    """Whether the id in a guest's path is part of the shared song."""
    if kind == "song":
        return ident == song_id
    one = lambda sql: db.one(sql, (ident,))       # noqa: E731
    if kind == "artwork":
        row = one("SELECT song_id FROM artwork WHERE id = ?")
    elif kind == "sheet":
        row = one("SELECT song_id FROM lyric_sheets WHERE id = ?")
    elif kind == "preset":
        row = one("SELECT song_id FROM sound_presets WHERE id = ?")
    elif kind == "version":
        row = one("SELECT song_id FROM versions WHERE id = ?")
    elif kind == "vocal":
        row = one("SELECT song_id FROM vocal_takes WHERE id = ?") \
            if db.table_exists("vocal_takes") else None
    elif kind == "revision":
        row = one("SELECT s.song_id FROM lyric_revisions r JOIN lyric_sheets s "
                  "ON s.id = r.sheet_id WHERE r.id = ?")
    else:
        return False
    return bool(row) and row["song_id"] == song_id


def _find_guest_route(method, path):
    from .. import http
    for (m, pattern), meaning in GUEST_MAY.items():
        if m != method:
            continue
        params = http._match(pattern, path)
        if params is not None:
            return pattern, params, meaning
    return None, None, None


def proxy(req, share_id, rest):
    """A guest's request, run on the owner's song through the owner's own routes."""
    from .. import http
    from ..wire import Request
    me = _me()
    share = accounts.share(as_int(share_id, "share"))
    if not share or share["revoked_at"] or share["to_account"] != me:
        raise Error("That share is not open to you.", 404)
    _song_in(share)
    pattern, params, meaning = _find_guest_route(req.method, rest)
    if not pattern:
        raise Error("That is not something a guest can do on a shared song.", 403)
    kind, what = meaning
    handler, _ = http.resolve(req.method, rest)
    if not handler:
        raise Error("no such endpoint", 404)
    song_id = share["song_id"]
    with who.acting_as(_theirs(share)):
        if kind and not _belongs(kind, as_int(params.get("id"), "id"), song_id):
            raise Error("That is not part of this share.", 404)
        inner = Request(req.method, rest, req.query, req.headers, req.rfile, params)
        inner.client = getattr(req, "client", "local")
        marker = _GUEST.set(me)
        try:
            return _run_as_guest(handler, inner, what, pattern, song_id, me, share, req)
        finally:
            _GUEST.reset(marker)


def _run_as_guest(handler, inner, what, pattern, song_id, me, share, req):
    """The guest's request itself, and its record in the history."""
    if not what:
        return handler(inner)
    # A rename is a title and nothing else: the song's notes are the owner's own.
    if pattern == "/api/songs/<id>":
        body = inner.json() or {}
        if set(body) - {"title"}:
            raise Error("A guest can change the title and nothing else there.", 403)
    before = _snapshot(song_id)
    result = handler(inner)
    touched = _difference(before, _snapshot(song_id))
    if not (touched["rows"] or touched["made"] or touched["revisions"]):
        return result                   # a save that changed nothing is not a change
    now = time.time()
    last = db.one("SELECT * FROM guest_edits WHERE song_id = ? ORDER BY id DESC LIMIT 1",
                  (song_id,))
    if (last and last["account"] == me and last["route"] == req.method + " " + pattern
            and not last["undone_at"] and now - last["updated_at"] < SITTING):
        merged = _merge(json.loads(last["before"]), touched)
        db.run("UPDATE guest_edits SET updated_at = ?, before = ? WHERE id = ?",
               (now, json.dumps(merged), last["id"]))
    else:
        db.insert("guest_edits", {
            "song_id": song_id, "account": me, "share_id": share["id"], "what": what,
            "route": req.method + " " + pattern, "before": json.dumps(touched),
            "created_at": now, "updated_at": now})
    return result


def _key(table):
    return "song_id" if table == "arrangements" else "id"


def _difference(before, after):
    """Exactly what one change touched, and what each touched row was before it.

    Only that. Undoing a change puts back the rows it changed, takes away the rows it made
    and the words it wrote, and leaves everything else alone: undoing a rename does not
    take the words written after it with it.
    """
    out = {"rows": {}, "made": {}, "revisions": []}
    for table, _ in _SONG_TABLES:
        if table not in after:
            continue
        key = _key(table)
        was = {r[key]: r for r in before.get(table, [])}
        for row in after[table]:
            old = was.get(row[key])
            if old is None:
                out["made"].setdefault(table, []).append(row[key])
            elif old != row:
                out["rows"].setdefault(table, []).append(old)
    lo, hi = before.get("lyric_revisions_max", 0), after.get("lyric_revisions_max", 0)
    if hi > lo:
        out["revisions"] = [lo, hi]
    return out


def _merge(first, then):
    """One sitting's worth of saves as one change: the earliest before, everything made."""
    for table, rows in then["rows"].items():
        have = {r[_key(table)] for r in first["rows"].get(table, [])}
        made = set(first["made"].get(table, []))
        for row in rows:
            if row[_key(table)] not in have and row[_key(table)] not in made:
                first["rows"].setdefault(table, []).append(row)
    for table, keys in then["made"].items():
        first["made"].setdefault(table, [])
        first["made"][table] += [k for k in keys if k not in first["made"][table]]
    if then["revisions"]:
        if first["revisions"]:
            first["revisions"] = [first["revisions"][0], then["revisions"][1]]
        else:
            first["revisions"] = then["revisions"]
    return first


def _put_back(song_id, change):
    """Undo one change: its rows back as they were, its new rows and words taken away."""
    for table, rows in change.get("rows", {}).items():
        if not db.table_exists(table):
            continue
        key = _key(table)
        for row in rows:
            cols = [c for c in row if c != key]
            if cols and db.one("SELECT 1 FROM %s WHERE %s = ?" % (table, key), (row[key],)):
                db.run("UPDATE %s SET %s WHERE %s = ?" % (
                    table, ", ".join("%s = ?" % c for c in cols), key),
                    [row[c] for c in cols] + [row[key]])
    for table, keys in change.get("made", {}).items():
        if db.table_exists(table):
            for k in keys:
                db.run("DELETE FROM %s WHERE %s = ?" % (table, _key(table)), (k,))
    span = change.get("revisions") or []
    if span and db.table_exists("lyric_revisions"):
        db.run("DELETE FROM lyric_revisions WHERE id > ? AND id <= ? AND sheet_id IN "
               "(SELECT id FROM lyric_sheets WHERE song_id = ?)", (span[0], span[1], song_id))


def song_edits(req):
    """For the owner: what the people the song is shared with changed, newest first."""
    song = as_int(req.params["id"], "id")
    rows = db.query("SELECT id, account, what, created_at, updated_at, undone_at "
                    "FROM guest_edits WHERE song_id = ? ORDER BY id DESC LIMIT 200", (song,))
    out = []
    for r in rows:
        person = accounts.public(accounts.by_id(r["account"])) or {}
        out.append(dict(r, name=person.get("name") or "", handle=person.get("handle", "")))
    return {"edits": out}


def undo_edit(req):
    """Put a song back to how it was before one change. The owner's own library only."""
    edit = db.one("SELECT * FROM guest_edits WHERE id = ?", (as_int(req.params["id"], "id"),))
    if not edit:
        raise Error("No such change.", 404)
    _put_back(edit["song_id"], json.loads(edit["before"]))
    db.run("UPDATE guest_edits SET undone_at = ? WHERE id = ?", (time.time(), edit["id"]))
    return {"undone": edit["id"]}


def _named(share, original):
    """What to call a copy of something the sharer made.

    With a name on the share: "Wide master, edited by Jozsef". Without: just the original
    name, because "edited by" with nobody to name is worse than saying nothing.
    """
    if not share["as_name"]:
        return original
    return "%s, edited by %s" % (original, share["as_name"])


def save_preset(req):
    """Their version of an equaliser or limiter setting.

    Editing one of the sharer's presets makes a copy here rather than changing theirs. That
    is the rule the whole feature is built on: a share is somewhere to work, not permission
    to overwrite.
    """
    share = _share(req.params["id"])
    if share["to_account"] != _me():
        raise Error("Only the person a song was shared with can save into it.", 403)
    # The song has to still be the one that was shared before anything is read from it:
    # the preset named in `from` below is looked up by the share's song id.
    _song_in(share)
    if not registry.has("sound"):
        raise Error("This library has no equaliser.", 404)

    from . import sound
    data = req.json()
    # Through the sound module's own normalise, so a share cannot write a shape into a
    # preset table that the equaliser would then choke on. It is the same gate the
    # ordinary preset routes use.
    payload = sound.normalise(need(data, "data"))
    from_id = data.get("from")
    name = (data.get("name") or "").strip()[:80]

    if from_id and not name:
        # Editing one of theirs, so the copy is named after it.
        with who.acting_as(_theirs(share)):
            original = db.one("SELECT name FROM sound_presets WHERE id = ? AND song_id = ?",
                              (from_id, share["song_id"]))
        if not original:
            raise Error("That preset is not part of this share.", 404)
        name = _named(share, original["name"])
    if not name:
        name = _named(share, "Current") if share["as_name"] else "Mine"

    song_id = _my_song(share)
    now = time.time()
    held = db.one("SELECT id FROM sound_presets WHERE song_id = ? AND name = ?",
                  (song_id, name))
    if held:
        db.update("sound_presets", held["id"],
                  {"data": json.dumps(payload), "updated_at": now})
        made = held["id"]
    else:
        made = db.insert("sound_presets", {
            "song_id": song_id, "name": name, "is_current": 1,
            "data": json.dumps(payload), "created_at": now, "updated_at": now})
    return {"preset": _preset_out(db.one(
        "SELECT id, name, is_current, data, created_at FROM sound_presets WHERE id = ?",
        (made,))), "song": song_id}


def save_sheet(req):
    """Their version of the words. Same rule as a preset."""
    share = _share(req.params["id"])
    if share["to_account"] != _me():
        raise Error("Only the person a song was shared with can save into it.", 403)
    _song_in(share)                     # same reason as save_preset
    if not registry.has("lyrics"):
        raise Error("This library has no lyrics.", 404)

    data = req.json()
    text = data.get("text") or ""
    from_id = data.get("from")
    name = (data.get("name") or "").strip()[:80]

    if from_id and not name:
        with who.acting_as(_theirs(share)):
            original = db.one("SELECT name FROM lyric_sheets WHERE id = ? AND song_id = ?",
                              (from_id, share["song_id"]))
        if not original:
            raise Error("Those words are not part of this share.", 404)
        name = _named(share, original["name"] or "Lyrics")
    if not name:
        name = _named(share, "Lyrics") if share["as_name"] else "Mine"

    song_id = _my_song(share)
    now = time.time()
    held = db.one("SELECT id FROM lyric_sheets WHERE song_id = ? AND name = ?",
                  (song_id, name))
    if held:
        sheet_id = held["id"]
    else:
        row = db.one("SELECT MAX(position) AS p FROM lyric_sheets WHERE song_id = ?",
                     (song_id,))
        sheet_id = db.insert("lyric_sheets", {
            "song_id": song_id, "name": name,
            "position": ((row["p"] if row and row["p"] is not None else -1) + 1),
            "is_current": 0 if held else 1, "created_at": now})

    # A revision rather than an overwrite, the same as the ordinary lyrics route: the
    # recipient's own history is theirs to keep. Unchanged text is not a revision.
    latest = db.one("SELECT text FROM lyric_revisions WHERE sheet_id = ? "
                    "ORDER BY id DESC LIMIT 1", (sheet_id,))
    if not latest or latest["text"] != text:
        db.insert("lyric_revisions",
                  {"sheet_id": sheet_id, "text": text, "created_at": now})
    return {"sheet": _sheet_out(db.one(
        "SELECT id, name, position, is_current, created_at FROM lyric_sheets WHERE id = ?",
        (sheet_id,))), "song": song_id}


# ── the sharer's side ────────────────────────────────────────────────────────
def list_shares(req):
    """What you have shared, and with whom."""
    song_id = req.q("song")
    rows = accounts.shares_from(_me(), int(song_id) if song_id else None)
    out = []
    for row in rows:
        to_who = accounts.public(accounts.by_id(row["to_account"]))
        out.append(dict(row, to_handle=to_who["handle"] if to_who else "",
                        to_name=to_who["name"] if to_who else "somebody"))
    return {"shares": out, "people": [accounts.public(a) for a in accounts.everybody()
                                      if a["id"] != _me()]}


def make_share(req):
    """Share one of your songs: with a handle you know, or as a link.

    The link exists because the other way round the wrong way. Sharing needed the
    recipient's handle up front, so the sharer had to know an account already existed and
    what it was called, and somebody with no account could not be sent a song at all
    without first being sent an invite and told to sign up. Two messages and a spare
    concept to explain, before anybody has heard anything.

    With a link there is one thing to send. Whoever opens it either signs in, or picks a
    handle and a password there and then, and the song is theirs on the next screen.
    """
    data = req.json()
    song_id = int(need(data, "song"))
    song = db.one("SELECT id, title FROM songs WHERE id = ?", (song_id,))
    if not song:
        raise Error("no song with id %s" % song_id, 404)

    as_name = (data.get("as_name") or "").strip()[:60]

    if not (data.get("handle") or "").strip():
        # A link, for somebody who has not been named. The code is shown once and only its
        # digest is kept, the same as an invite.
        share_id, token = accounts.make_share_link(_me(), song_id, as_name)
        return {"share": share_id, "token": token, "path": "/#/join/" + token,
                "note": "This is the only time the link is shown."}

    handle = (data.get("handle") or "").strip()
    them = accounts.by_handle(handle)
    if not them:
        raise Error("Nobody on this library has the handle %s." % handle, 404)
    if them["id"] == _me():
        raise Error("That song is already yours.", 400)

    held = accounts.share_between(_me(), song_id, them["id"])
    if held and not held["revoked_at"]:
        raise Error("%s already has this song." % (them["name"] or handle), 409)

    made = accounts.add_share(_me(), song_id, them["id"], as_name)
    return {"share": made, "to": accounts.public(them)}


# ── a link, and whoever opens it ─────────────────────────────────────────────
#
# Both of these answer without a session, because the whole point is that they are what
# somebody meets before they have one. What makes that safe is that the token is the secret:
# it is not guessable, it is kept only as a digest, and it is spent the first time it works.


def _by_token(req):
    """The share a link opens, or the same refusal for every way it can fail.

    One answer for expired, claimed, revoked and never existed. A link is a secret, and a
    reply that tells them apart tells somebody feeding in guesses which ones were close.
    """
    token = (req.params.get("token") or "").strip()
    share = accounts.share_by_token(token) if token else None
    if not share:
        raise Error("That link is not open. It may have been used already, or taken back.",
                    404)
    return share


def invitation(req):
    """What the link is for, so the page can say who shared what before asking for anything.

    Deliberately thin: a song title and a name. Somebody holding the link is going to be
    given the song anyway, and everything else about the library stays behind the door.
    """
    share = _by_token(req)
    song = _song_in(share)
    from_who = accounts.public(accounts.by_id(share["from_account"]))
    return {
        "song": {"title": song["title"]},
        "from": from_who["name"] if from_who else "somebody",
        "as_name": share["as_name"],
        # Whether there is anybody signed in on this browser already, so the page can offer
        # the short way round rather than always asking for a handle and a password.
        "signed_in": who.now() is not None,
    }


def accept(req):
    """Take the share, as whoever is signed in, or as a new account made here.

    THE TOKEN IS THE INVITE. Somebody who has never been here has no account and no way to
    make one: signing up needs a code from the owner, which is a second thing to send and
    the reason sharing with a stranger took two messages and an explanation. A link the
    owner deliberately sent is exactly as much permission as an invite is, so it counts as
    one, and it is spent the same way.

    Claiming is one UPDATE with the token in its WHERE clause, so a link that was forwarded
    to five people opens for the first of them and is simply not open for the rest.
    """
    share = _by_token(req)
    data = req.json()

    me = who.now()
    if me is None:
        from . import auth
        handle = (data.get("handle") or "").strip()
        if not handle:
            raise Error("Pick a handle so the song has somebody to belong to.", 400)
        made = auth.sign_up_for_share(req, handle, data.get("password") or "",
                                      (data.get("name") or "").strip())
        me = made["account"]["id"]
        session = made["cookie"]
    else:
        session = None

    if share["from_account"] == me:
        raise Error("That song is already yours.", 400)

    if not accounts.claim_share(share["id"], me):
        raise Error("That link is not open. It may have been used already, or taken back.",
                    404)

    body = json.dumps({"share": share["id"]}).encode("utf-8")
    if session:
        return Response(status=200, body=body, content_type="application/json",
                        headers={"Set-Cookie": session})
    return {"share": share["id"]}


def revoke_share(req):
    """Take it back.

    What they made stays theirs. Their copies are rows in their own library and deleting
    them from here would be reaching into it, which is the thing this whole design refuses
    to do. What stops is the reading of yours.
    """
    share = _share(req.params["id"])
    if share["from_account"] != _me():
        raise Error("Only the person who shared a song can take it back.", 403)
    accounts.revoke_share(share["id"])
    return {"revoked": share["id"], "note": "Their own copies stay theirs."}


def MIGRATE():
    """Somewhere to mark a song as being the recipient's copy of a share."""
    db.add_column_if_missing("songs", "shared_from", "TEXT NOT NULL DEFAULT ''")


def SUMMARY():
    return {"shared_with_me": len(accounts.shares_to(_me()))}


def ROUTES():
    return {
        ("GET", "/api/shared"): shared_with_me,
        ("GET", "/api/shared/<id>"): open_share,
        ("GET", "/api/shared/<id>/audio"): shared_audio,
        ("GET", "/api/shared/<id>/artwork/<image>"): shared_artwork,
        ("POST", "/api/shared/<id>/preset"): save_preset,
        ("POST", "/api/shared/<id>/sheet"): save_sheet,
        ("GET", "/api/shared/<id>/guests"): shared_guests,
        ("GET", "/api/songs/<id>/guests"): song_guests,
        ("GET", "/api/guestwork/<share>/artwork/<image>"): guest_artwork,
        ("GET", "/api/guestwork/<share>/audio/<version>"): guest_audio,
        ("GET", "/api/songs/<id>/edits"): song_edits,
        ("POST", "/api/guest-edits/<id>/undo"): undo_edit,
        ("GET", "/api/shares"): list_shares,
        ("POST", "/api/shares"): make_share,
        ("GET", "/api/shares/invitation/<token>"): invitation,
        ("POST", "/api/shares/invitation/<token>"): accept,
        ("DELETE", "/api/shares/<id>"): revoke_share,
    }
