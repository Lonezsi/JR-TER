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
from ..wire import Error, need

NAME = "sharing"

#: No tables here. A share is a row in accounts.db, because it names two accounts and a song
#: in one of their libraries, and no single library is the right place for that.
SCHEMA = []


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
        row = db.one("SELECT id, title, current_version_id FROM songs WHERE id = ?",
                     (share["song_id"],))
    if not row:
        # The song was deleted after the share was made. Not an error on the recipient's
        # part, and not something to leave them guessing about.
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
        "song": {"title": song["title"]},
        "from": from_who["name"] if from_who else "somebody",
        "as_name": share["as_name"],
        "version": version,
        # Theirs, and read only. Anything the recipient saves becomes a copy in their own
        # library, which is what mine below returns.
        "presets": presets,
        "sheets": sheets,
        "mine": _my_copies(share),
    }


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
    """Share one of your songs with one other account."""
    data = req.json()
    song_id = int(need(data, "song"))
    song = db.one("SELECT id, title FROM songs WHERE id = ?", (song_id,))
    if not song:
        raise Error("no song with id %s" % song_id, 404)

    handle = (data.get("handle") or "").strip()
    them = accounts.by_handle(handle)
    if not them:
        raise Error("Nobody on this library has the handle %s." % handle, 404)
    if them["id"] == _me():
        raise Error("That song is already yours.", 400)

    # Optional, and the whole reason their copies can be named after them.
    as_name = (data.get("as_name") or "").strip()[:60]

    held = accounts.share_between(_me(), song_id, them["id"])
    if held and not held["revoked_at"]:
        raise Error("%s already has this song." % (them["name"] or handle), 409)

    made = accounts.add_share(_me(), song_id, them["id"], as_name)
    return {"share": made, "to": accounts.public(them)}


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
        ("POST", "/api/shared/<id>/preset"): save_preset,
        ("POST", "/api/shared/<id>/sheet"): save_sheet,
        ("GET", "/api/shares"): list_shares,
        ("POST", "/api/shares"): make_share,
        ("DELETE", "/api/shares/<id>"): revoke_share,
    }
