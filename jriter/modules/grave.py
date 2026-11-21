"""The grave: where deleted things go for a while, before they are gone.

Undo covers the moment after a delete. The grave covers the week after it, and the month:
a song, render, album, playlist, set of words, picture, inbox render or vocal take that
is deleted is first copied here, row for row, everything that goes with it (a song's
renders, words, history, artwork, sound and arrangement, its place on albums and in
playlists). From the Grave you bring it back, or empty it for good. Things stay for
KEEP_DAYS, then they go on their own.

Bringing back puts the rows back with the ids they had, so every link to them (an album
that held the song, a playlist that played it) points at them again. An id taken in the
meantime gets a new one, and links follow it. A link to something that is itself gone
(an album deleted since) is left out rather than invented.

While something is in the grave its audio and pictures are never deleted: blobs.delete
asks holds() first. When it leaves the grave for good (let go, emptied, or its time is up)
the files that only it was keeping go too, checked against everything that can point at a
file, so nothing still in use is ever removed.

  bury_song(song_id), bury_album(id), bury_playlist(id), bury_version(id),
  bury_sheet(id), bury_image(id), bury_render(id), bury_take(id)
      called by each module's delete handler, before it deletes
  holds(digest) -> bool
"""
import json
import time

from .. import db
from ..wire import Error

NAME = "grave"
SCHEMA = [
    """
    CREATE TABLE IF NOT EXISTS grave (
      id          INTEGER PRIMARY KEY,
      kind        TEXT NOT NULL,
      title       TEXT NOT NULL DEFAULT '',
      deleted_at  REAL NOT NULL,
      tables      TEXT NOT NULL,
      digests     TEXT NOT NULL DEFAULT ''
    )
    """,
]

KEEP_DAYS = 30

#: The order rows can be put back in: everything a row points at comes before it.
ORDER = ["songs", "song_titles", "albums", "album_songs", "playlists", "versions", "renders",
         "lyric_sheets", "lyric_revisions", "artwork", "sound_presets", "arrangements",
         "playlist_items", "vocal_takes", "youtube_posts"]
#: column -> the table its id is in.
POINTS_AT = {"song_id": "songs", "album_id": "albums", "sheet_id": "lyric_sheets",
             "playlist_id": "playlists", "render_id": "renders", "version_id": "versions",
             "current_version_id": "versions"}
#: Links filled in after everything is back (they point forward in ORDER).
LATE = {("songs", "current_version_id")}
BLOB_COLUMNS = {"versions": ("digest",), "renders": ("digest",), "artwork": ("digest",),
                "vocal_takes": ("digest",), "albums": ("cover_digest",)}
KIND_SAID = {"song": "Song", "album": "Album", "playlist": "Playlist", "version": "Render",
             "sheet": "Words", "image": "Picture", "render": "Inbox render", "take": "Vocal take"}


def _have(table):
    return db.table_exists(table)


def _rows(table, where, args=()):
    if not _have(table):
        return []
    return db.query("SELECT * FROM %s WHERE %s" % (table, where), args)


def _ids(rows):
    return [r["id"] for r in rows if "id" in r]


def _in(col, ids):
    return "%s IN (%s)" % (col, ",".join("?" * len(ids))) if ids else "0"


def _bury(kind, title, tables):
    tables = {t: rows for t, rows in tables.items() if rows}
    digests = sorted({row[c] for t, cols in BLOB_COLUMNS.items() for row in tables.get(t, [])
                      for c in cols if row.get(c)})
    if not _have("grave"):
        return None
    _forget_old()
    return db.insert("grave", {"kind": kind, "title": title or "", "deleted_at": time.time(),
                               "tables": json.dumps(tables, ensure_ascii=False),
                               "digests": " ".join(digests)})


def _song_tables(ids):
    songs = _rows("songs", _in("id", ids), ids)
    sheets = _rows("lyric_sheets", _in("song_id", ids), ids)
    sheet_ids = _ids(sheets)
    return {
        "songs": songs,
        "song_titles": _rows("song_titles", _in("song_id", ids), ids),
        "album_songs": _rows("album_songs", _in("song_id", ids), ids),
        "versions": _rows("versions", _in("song_id", ids), ids),
        "renders": _rows("renders", _in("song_id", ids), ids),
        "lyric_sheets": sheets,
        "lyric_revisions": _rows("lyric_revisions", _in("sheet_id", sheet_ids), sheet_ids),
        "artwork": _rows("artwork", _in("song_id", ids), ids),
        "sound_presets": _rows("sound_presets", _in("song_id", ids), ids),
        "arrangements": _rows("arrangements", _in("song_id", ids), ids),
        "playlist_items": _rows("playlist_items", _in("song_id", ids), ids),
        "vocal_takes": _rows("vocal_takes", _in("song_id", ids), ids),
        "youtube_posts": _rows("youtube_posts", _in("song_id", ids), ids),
    }


def bury_song(song_id):
    tables = _song_tables([song_id])
    title = (tables["songs"] or [{}])[0].get("title", "")
    return _bury("song", title, tables)


def bury_album(album_id):
    albums = _rows("albums", "id = ?", (album_id,))
    lists = _rows("playlists", "album_id = ?", (album_id,))
    list_ids = _ids(lists)
    return _bury("album", (albums or [{}])[0].get("title", ""), {
        "albums": albums,
        "album_songs": _rows("album_songs", "album_id = ?", (album_id,)),
        "playlists": lists,
        "playlist_items": _rows("playlist_items", _in("playlist_id", list_ids), list_ids),
    })


def bury_playlist(playlist_id):
    lists = _rows("playlists", "id = ?", (playlist_id,))
    return _bury("playlist", (lists or [{}])[0].get("title", ""), {
        "playlists": lists,
        "playlist_items": _rows("playlist_items", "playlist_id = ?", (playlist_id,)),
    })


def bury_version(version_id):
    rows = _rows("versions", "id = ?", (version_id,))
    title = ""
    if rows:
        song = _rows("songs", "id = ?", (rows[0]["song_id"],))
        title = "v%s of %s" % (rows[0].get("n"), (song or [{}])[0].get("title", "a song"))
    return _bury("version", title, {"versions": rows})


def bury_sheet(sheet_id):
    sheets = _rows("lyric_sheets", "id = ?", (sheet_id,))
    return _bury("sheet", (sheets or [{}])[0].get("name", ""), {
        "lyric_sheets": sheets,
        "lyric_revisions": _rows("lyric_revisions", "sheet_id = ?", (sheet_id,)),
    })


def bury_image(image_id):
    rows = _rows("artwork", "id = ?", (image_id,))
    return _bury("image", (rows or [{}])[0].get("caption") or "A picture", {"artwork": rows})


def bury_render(render_id):
    rows = _rows("renders", "id = ?", (render_id,))
    r = (rows or [{}])[0]
    return _bury("render", r.get("filename") or "A render", {"renders": rows})


def bury_take(take_id):
    rows = _rows("vocal_takes", "id = ?", (take_id,))
    return _bury("take", (rows or [{}])[0].get("name") or "A take", {"vocal_takes": rows})


def holds(digest):
    """Whether anything in the grave still needs this file."""
    if not digest or not _have("grave"):
        return False
    return bool(db.one("SELECT 1 FROM grave WHERE ' ' || digests || ' ' LIKE ? LIMIT 1",
                       ("% " + digest + " %",)))


#: Every place a file can be pointed at from, to be sure before one is deleted.
POINTERS = [("versions", "digest"), ("renders", "digest"), ("artwork", "digest"),
            ("vocal_takes", "digest"), ("albums", "cover_digest")]


def _release(rows):
    """The files only these grave rows were keeping, deleted once the rows are gone."""
    from .. import blobs
    for row in rows:
        for digest in (row.get("digests") or "").split():
            if holds(digest):
                continue
            if any(_have(t) and db.one("SELECT 1 FROM %s WHERE %s = ? LIMIT 1" % (t, c), (digest,))
                   for t, c in POINTERS):
                continue
            blobs.delete(digest)


def _leave(where, args=()):
    rows = db.query("SELECT id, digests FROM grave WHERE %s" % where, args)
    if rows:
        db.run("DELETE FROM grave WHERE %s" % where, args)
        _release(rows)
    return len(rows)


def _forget_old():
    _leave("deleted_at < ?", (time.time() - KEEP_DAYS * 86400,))


def _restore(tables):
    """Put the rows back, with their own ids where those are still free."""
    new = {t: {} for t in ORDER}
    late = []
    back = 0
    for table in ORDER:
        if table not in tables or not _have(table):
            continue
        have = set(db.columns(table))
        for row in tables[table]:
            values = {c: v for c, v in row.items() if c in have}
            skip = False
            for col, target in POINTS_AT.items():
                if col not in values or values[col] is None or col == "id":
                    continue
                if (table, col) in LATE:
                    late.append((table, row.get("id"), col, values.pop(col)))
                    continue
                values[col] = new.get(target, {}).get(values[col], values[col])
            old_id = values.get("id")
            if old_id is not None and db.one("SELECT 1 FROM %s WHERE id = ?" % table, (old_id,)):
                values.pop("id")
            try:
                made = db.insert(table, values)
            except Exception:
                # A link to something that is itself gone now (an album deleted since):
                # this row has nothing to belong to, so it stays out.
                skip = True
            if skip:
                continue
            back += 1
            if old_id is not None:
                new[table][old_id] = values.get("id", made)
    for table, old_id, col, value in late:
        rid = new[table].get(old_id, old_id)
        db.run("UPDATE %s SET %s = ? WHERE id = ?" % (table, col),
               (new["versions"].get(value, value), rid))
    return back


# ── routes ─────────────────────────────────────────────────────────────────────────────

def _get(row_id):
    row = db.one("SELECT * FROM grave WHERE id = ?", (row_id,))
    if not row:
        raise Error("That's not in the grave any more.", 404)
    return row


def listing(req):
    _forget_old()
    rows = db.query("SELECT id, kind, title, deleted_at FROM grave ORDER BY deleted_at DESC")
    for r in rows:
        r["kind_said"] = KIND_SAID.get(r["kind"], r["kind"])
        r["goes_at"] = r["deleted_at"] + KEEP_DAYS * 86400
    return {"items": rows, "keep_days": KEEP_DAYS}


def bring_back(req):
    row = _get(int(req.params["id"]))
    back = _restore(json.loads(row["tables"]))
    db.run("DELETE FROM grave WHERE id = ?", (row["id"],))
    return {"restored": row["kind"], "title": row["title"], "rows": back}


def forget(req):
    row = _get(int(req.params["id"]))
    _leave("id = ?", (row["id"],))
    return {"forgotten": row["id"]}


def empty(req):
    return {"forgotten": _leave("1")}


def SUMMARY():
    row = db.one("SELECT COUNT(*) AS n FROM grave") if _have("grave") else None
    return {"count": row["n"] if row else 0, "keep_days": KEEP_DAYS}


def ROUTES():
    return {
        ("GET", "/api/grave"): listing,
        ("POST", "/api/grave/<id>/restore"): bring_back,
        ("DELETE", "/api/grave/<id>"): forget,
        ("DELETE", "/api/grave"): empty,
    }
