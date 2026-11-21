"""Albums: a cover, a title, and an ordered list of songs.

A song can sit in several albums, so membership is its own table rather than a column on
the song. Order belongs to the album, because the same song can be third on one record
and first on another.
"""
import os
import time

from .. import blobs, config, db, finding, registry
from ..wire import Error, Response, need, as_int
from . import songs

NAME = "albums"

SCHEMA = [
    """
    CREATE TABLE IF NOT EXISTS albums (
      id           INTEGER PRIMARY KEY,
      title        TEXT NOT NULL,
      year         INTEGER,
      notes        TEXT NOT NULL DEFAULT '',
      cover_digest TEXT NOT NULL DEFAULT '',
      cover_ext    TEXT NOT NULL DEFAULT '',
      created_at   REAL NOT NULL,
      updated_at   REAL NOT NULL
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS album_songs (
      album_id INTEGER NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
      song_id  INTEGER NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
      position INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (album_id, song_id)
    )
    """,
    "CREATE INDEX IF NOT EXISTS album_songs_order ON album_songs(album_id, position)",
]


def get(album_id):
    row = db.one("SELECT * FROM albums WHERE id = ?", (album_id,))
    if not row:
        raise Error("no album with id %s" % album_id, 404)
    return row


def _counts(album_id):
    row = db.one(
        "SELECT COUNT(*) AS n FROM album_songs WHERE album_id = ?", (album_id,))
    total = 0
    if registry.has("versions"):
        total = db.one(
            "SELECT COALESCE(SUM(v.duration), 0) AS d FROM album_songs a "
            "JOIN songs s ON s.id = a.song_id "
            "LEFT JOIN versions v ON v.id = s.current_version_id "
            "WHERE a.album_id = ?", (album_id,))["d"]
    return {"song_count": row["n"] if row else 0, "duration": round(total or 0, 2)}


def list_albums(req):
    rows = db.query("SELECT * FROM albums ORDER BY COALESCE(year, 0) DESC, title COLLATE NOCASE")
    for row in rows:
        row.update(_counts(row["id"]))
        row["has_cover"] = bool(row["cover_digest"])
    return {"albums": rows}


def MIGRATE():
    """How often each album has been opened. Zero for everything already here: see the
    same note in the songs module for why a seeded guess is worse than nothing."""
    db.add_column_if_missing("albums", "opened", "INTEGER NOT NULL DEFAULT 0")
    # The stickers on its case, as JSON (ui/src/lib/stickers.ts); empty is "the album's own
    # random ones", worked out from its id the same way everywhere.
    db.add_column_if_missing("albums", "stickers", "TEXT NOT NULL DEFAULT ''")


def most_opened(req):
    """The albums this library gets opened the most. Exact route, so it is found before
    /api/albums/<id> can claim it."""
    rows = db.query(
        "SELECT * FROM albums WHERE opened > 0 ORDER BY opened DESC, updated_at DESC "
        "LIMIT ?", (as_int(req.q("limit"), 6),))
    out = []
    for album in rows:
        album = dict(album)
        album.update(_counts(album["id"]))
        album["has_cover"] = bool(album["cover_digest"])
        out.append(album)
    return {"albums": out}


def get_album(req):
    album = get(req.params["id"])
    # Counted on the read, for the reason set out in songs.get_song: this is the only
    # place that knows an album was opened.
    db.run("UPDATE albums SET opened = opened + 1 WHERE id = ?", (album["id"],))
    # Albums that existed before playlists did get theirs the first time they are
    # opened, which is cheaper and safer than a migration that rewrites every row.
    pl = _playlists()
    if pl:
        pl.for_album(album["id"], album["title"])
    album.update(_counts(album["id"]))
    album["has_cover"] = bool(album["cover_digest"])
    rows = db.query(
        "SELECT s.*, a.position FROM album_songs a JOIN songs s ON s.id = a.song_id "
        "WHERE a.album_id = ? ORDER BY a.position, s.title COLLATE NOCASE", (album["id"],))
    return {"album": album, "songs": songs.decorate(rows)}


def _playlists():
    """The playlists module, if it is switched on.

    Asked for rather than imported at the top, because an album has to keep working in a
    library where playlists are turned off. Everything below is a no op in that case.
    """
    from .. import registry
    if not registry.has("playlists"):
        return None
    from . import playlists
    return playlists


def create_album(req):
    data = req.json()
    title = need(data, "title")
    now = time.time()
    year = data.get("year")
    album_id = db.insert("albums", {
        "title": title,
        "year": as_int(year, "year") if year not in (None, "") else None,
        "notes": data.get("notes", ""), "created_at": now, "updated_at": now})
    # Every album is also a running order, made with it rather than asked for later.
    pl = _playlists()
    if pl:
        pl.for_album(album_id, title)
    return {"album": get(album_id)}


def update_album(req):
    album = get(req.params["id"])
    data = req.json()
    patch = {}
    if "title" in data:
        patch["title"] = need(data, "title")
    if "year" in data:
        patch["year"] = as_int(data["year"], "year") if data["year"] not in (None, "") else None
    if "notes" in data:
        patch["notes"] = data["notes"] or ""
    if "stickers" in data:
        patch["stickers"] = _stickers(data["stickers"])
    patch["updated_at"] = time.time()
    db.update("albums", album["id"], patch)
    return {"album": get(album["id"])}


STICKER_KINDS = {"warning", "price", "barcode", "sale", "ticket", "tape", "year", "discount"}
# Where the old six fixed spots were, as x/y on the case (percent), for a sticker that
# still says "at" instead of where it is.
STICKER_AT = {"tl": (28, 14), "t": (50, 11), "tr": (76, 13), "bl": (30, 86), "b": (50, 89), "br": (74, 86)}
STICKER_MAX = 8


def _num(value, low, high, default):
    try:
        return max(low, min(high, round(float(value), 1)))
    except (TypeError, ValueError):
        return default


def _stickers(value):
    """A case's stickers, checked: up to eight, of the kinds the page draws, short texts.
    Each one is where its middle is on the case (x, y: percent), its size (s, 1 = normal)
    and its tilt in degrees. None (or an empty list after "back to random") stores empty:
    the random ones again."""
    if value in (None, ""):
        return ""
    if not isinstance(value, list) or len(value) > STICKER_MAX:
        raise Error("Up to %d stickers on a case." % STICKER_MAX)
    out = []
    for s in value:
        if not isinstance(s, dict) or s.get("kind") not in STICKER_KINDS:
            raise Error("That's not a sticker JR!TER knows.")
        x, y = STICKER_AT.get(s.get("at"), (50, 50))
        one = {"kind": s["kind"], "x": _num(s.get("x", x), 0, 100, x), "y": _num(s.get("y", y), 0, 100, y),
               "s": _num(s.get("s", 1), 0.4, 3, 1), "rot": _num(s.get("rot", 0), -180, 180, 0)}
        if s.get("text"):
            one["text"] = str(s["text"])[:48]  # the warning label holds three lines
        out.append(one)
    import json
    return json.dumps(out)


def delete_album(req):
    album = get(req.params["id"])
    _to_grave("bury_album", album["id"])
    db.run("DELETE FROM album_songs WHERE album_id = ?", (album["id"],))
    db.run("DELETE FROM albums WHERE id = ?", (album["id"],))
    return {"deleted": album["id"]}


def add_song(req):
    album = get(req.params["id"])
    song = songs.get(need(req.json(), "song_id"))
    existing = db.one("SELECT * FROM album_songs WHERE album_id = ? AND song_id = ?",
                      (album["id"], song["id"]))
    if existing:
        return {"album_id": album["id"], "song_id": song["id"], "added": False}
    row = db.one("SELECT MAX(position) AS p FROM album_songs WHERE album_id = ?", (album["id"],))
    db.run("INSERT INTO album_songs (album_id, song_id, position) VALUES (?, ?, ?)",
           (album["id"], song["id"], (row["p"] if row and row["p"] is not None else -1) + 1))
    db.update("albums", album["id"], {"updated_at": time.time()})
    pl = _playlists()
    if pl:
        pl.album_gained_song(album["id"], song["id"])
    return {"album_id": album["id"], "song_id": song["id"], "added": True}


def remove_song(req):
    album = get(req.params["id"])
    db.run("DELETE FROM album_songs WHERE album_id = ? AND song_id = ?",
           (album["id"], req.params["song_id"]))
    pl = _playlists()
    if pl:
        pl.album_lost_song(album["id"], req.params["song_id"])
    # add_song bumps this and remove_song did not, so taking a track off a record left it
    # looking as though nothing had happened to it.
    db.update("albums", album["id"], {"updated_at": time.time()})
    return {"removed": req.params["song_id"]}


def reorder(req):
    album = get(req.params["id"])
    order = req.json().get("order")
    if not isinstance(order, list) or not order:
        raise Error("order must be a list of song ids")
    owned = {r["song_id"] for r in
             db.query("SELECT song_id FROM album_songs WHERE album_id = ?", (album["id"],))}
    unknown = [i for i in order if i not in owned]
    if unknown:
        raise Error("those songs are not on this album: %s" % unknown)
    for position, song_id in enumerate(order):
        db.run("UPDATE album_songs SET position = ? WHERE album_id = ? AND song_id = ?",
               (position, album["id"], song_id))
    db.update("albums", album["id"], {"updated_at": time.time()})
    return get_album(req)


def upload_cover(req):
    album = get(req.params["id"])
    length = as_int(req.headers.get("Content-Length") or 0, "Content-Length")
    if length <= 0:
        raise Error("no image in that upload")
    filename = (req.headers.get("X-Filename") or "cover.jpg").strip()
    ext = os.path.splitext(filename)[1].lower()
    if ext not in config.IMAGE_EXT:
        raise Error("%s is not an image JR!TER handles" % (ext or filename))
    digest, _, _ = blobs.put_stream(req.rfile, length)
    db.update("albums", album["id"],
              {"cover_digest": digest, "cover_ext": ext, "updated_at": time.time()})
    return {"album": get(album["id"])}


def cover(req):
    album = get(req.params["id"])
    if not album["cover_digest"]:
        raise Error("this album has no cover yet", 404)
    path = blobs.path_for(album["cover_digest"])
    if not os.path.isfile(path):
        raise Error("that cover is missing from storage", 410)
    from ..http import CONTENT_TYPES
    return Response(path=path, content_type=CONTENT_TYPES.get(
        album["cover_ext"], "application/octet-stream"))


def for_song(req):
    song = songs.get(req.params["id"])
    return {"albums": db.query(
        "SELECT al.* FROM album_songs a JOIN albums al ON al.id = a.album_id "
        "WHERE a.song_id = ? ORDER BY al.title COLLATE NOCASE", (song["id"],))}


def SUMMARY():
    row = db.one("SELECT COUNT(*) AS n FROM albums")
    return {"count": row["n"] if row else 0}


def SEARCH(term, limit):
    """Albums by name, and by whatever was written on the back of them.

    The note is searched because that is where the record is described in the words the
    person would go looking with. It scores nothing, so a title match is always first.
    """
    like = finding.pattern(term)
    rows = db.query(
        "SELECT * FROM albums WHERE fold(title) LIKE ? ESCAPE '\\' "
        "OR fold(notes) LIKE ? ESCAPE '\\'", (like, like))
    for row in rows:
        row["score"] = finding.rank(term, row["title"])
    rows.sort(key=lambda r: (-r["score"], -(r["year"] or 0), r["title"].casefold()))
    hits = rows[:limit]
    for row in hits:
        # Counted only for the handful being shown. Counting every album that matched
        # would be two queries per row for rows nobody is going to see.
        row.update(_counts(row["id"]))
        row["has_cover"] = bool(row["cover_digest"])
        row["href"] = "#/album/%d" % row["id"]
    return {"label": "Albums", "kind": "album", "order": 20,
            "total": len(rows), "hits": hits}


def ROUTES():
    return {
        ("GET", "/api/albums"): list_albums,
        ("GET", "/api/albums/most-opened"): most_opened,
        ("POST", "/api/albums"): create_album,
        ("GET", "/api/albums/<id>"): get_album,
        ("PATCH", "/api/albums/<id>"): update_album,
        ("DELETE", "/api/albums/<id>"): delete_album,
        ("POST", "/api/albums/<id>/songs"): add_song,
        ("DELETE", "/api/albums/<id>/songs/<song_id>"): remove_song,
        ("POST", "/api/albums/<id>/order"): reorder,
        ("POST", "/api/albums/<id>/cover"): upload_cover,
        ("GET", "/api/albums/<id>/cover"): cover,
        ("GET", "/api/songs/<id>/albums"): for_song,
    }


def _to_grave(what, row_id):
    """Copy it into the grave first (modules/grave.py), when the grave is switched on."""
    from .. import registry
    if registry.has("grave"):
        from . import grave
        getattr(grave, what)(row_id)
