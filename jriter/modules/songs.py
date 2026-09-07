"""Songs, and the library view of them.

A song is the object the whole product is built around. It owns nothing directly: the
renders, lyrics, artwork and settings all point at it, so a song row stays small and
every other feature can be switched off without leaving a hole in this table.
"""
import time
import random
import difflib

from .. import db, finding, registry
from ..wire import Error, need, as_int

NAME = "songs"

SCHEMA = [
    """
    CREATE TABLE IF NOT EXISTS songs (
      id                 INTEGER PRIMARY KEY,
      title              TEXT NOT NULL,
      notes              TEXT NOT NULL DEFAULT '',
      current_version_id INTEGER,
      created_at         REAL NOT NULL,
      updated_at         REAL NOT NULL
    )
    """,
    "CREATE INDEX IF NOT EXISTS songs_title ON songs(title)",
    """
    CREATE TABLE IF NOT EXISTS song_titles (
      id         INTEGER PRIMARY KEY,
      song_id    INTEGER NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
      title      TEXT NOT NULL,
      changed_at REAL NOT NULL
    )
    """,
    "CREATE INDEX IF NOT EXISTS song_titles_song ON song_titles(song_id, id DESC)",
]


def touch(song_id):
    db.run("UPDATE songs SET updated_at = ? WHERE id = ?", (time.time(), song_id))


def get(song_id):
    song = db.one("SELECT * FROM songs WHERE id = ?", (song_id,))
    if not song:
        raise Error("no song with id %s" % song_id, 404)
    return song


def decorate(songs):
    """Attach whatever the switched on modules can say about each song.

    Asking the registry rather than importing means the library still renders with
    versions or albums turned off, just with less on each row.
    """
    if not songs:
        return songs
    ids = [s["id"] for s in songs]
    marks = ",".join("?" * len(ids))
    latest = {}
    if registry.has("versions"):
        for row in db.query(
                "SELECT song_id, MAX(n) AS n, COUNT(*) AS versions FROM versions "
                "WHERE song_id IN (%s) GROUP BY song_id" % marks, ids):
            latest[row["song_id"]] = row
        for row in db.query(
                "SELECT song_id, id, n, duration FROM versions WHERE song_id IN (%s)" % marks, ids):
            entry = latest.setdefault(row["song_id"], {})
            if row["n"] == entry.get("n"):
                entry["duration"] = row["duration"]
                entry["version_id"] = row["id"]
    covers = {}
    if registry.has("artwork"):
        for row in db.query(
                "SELECT song_id, MIN(position) AS p, id FROM artwork "
                "WHERE song_id IN (%s) GROUP BY song_id" % marks, ids):
            covers[row["song_id"]] = row["id"]

    for song in songs:
        info = latest.get(song["id"], {})
        song["version_count"] = info.get("versions", 0)
        song["latest_version"] = info.get("n", 0)
        song["latest_version_id"] = info.get("version_id")
        song["duration"] = info.get("duration", 0)
        song["artwork_id"] = covers.get(song["id"])
    return songs


def list_songs(req):
    term = (req.q("q") or "").strip()
    order = req.q("sort", "updated")
    by = {"updated": "updated_at DESC", "title": "title COLLATE NOCASE ASC",
          "created": "created_at DESC"}.get(order, "updated_at DESC")
    if term:
        rows = db.query(
            "SELECT * FROM songs WHERE title LIKE ? ORDER BY " + by,
            ("%" + term + "%",))
    else:
        rows = db.query("SELECT * FROM songs ORDER BY " + by)
    return {"songs": decorate(rows)}


def MIGRATE():
    """How often each song has been opened.

    Zero for everything already here rather than a guess from updated_at: a song touched
    once by an import is not a song anybody keeps going back to, and seeding the number
    with something that looks like data is worse than starting from nothing.
    """
    db.add_column_if_missing("songs", "opened", "INTEGER NOT NULL DEFAULT 0")


def up_next(req):
    """What to play when the queue has run out.

    The player used to simply stop at the end of a list. This picks something, and what it
    picks is meant to feel like the library rather than like a shuffle: the point of a
    personal library is that most of it is yours and you half remember it.

    Four signals, all of them things this library already knows, and none of them a
    listening history it does not keep:

      the album      a song on the same record as the one that just finished is the most
                     likely thing you wanted next, so it counts for the most
      opened         how often you go back to it, which is the closest thing here to
                     "you like this one"
      freshness      something touched in the last month over something untouched for a
                     year, because a library is mostly old and the recent end is where
                     the work is
      chance         a real weight, not a tiebreak. A deterministic answer means the same
                     song after the same song for ever, which stops being a suggestion and
                     starts being a rut

    Weighted random over the best handful rather than strictly the top one, for the same
    reason. Nothing here is clever and it does not need to be: it needs to not be annoying.
    """
    after = as_int(req.q("after"), 0)
    # What the player has heard lately, so a short library does not loop three songs.
    skip = set()
    for part in (req.q("not") or "").split(","):
        try:
            skip.add(int(part))
        except ValueError:
            pass
    if after:
        skip.add(after)

    rows = db.query(
        "SELECT id, title, opened, current_version_id, created_at, updated_at FROM songs "
        # Unplayable songs are not suggestions. A song with no current version has nothing
        # to play, and offering one is how autoplay turns into silence.
        "WHERE current_version_id IS NOT NULL")
    pool = [r for r in rows if r["id"] not in skip]
    if not pool:
        # Everything is either unplayable or just heard. Rather than stop, let the oldest
        # of the skipped ones round again: at that point the library is smaller than the
        # memory, and repeating beats silence.
        pool = [r for r in rows if r["id"] != after]
    if not pool:
        return {"song": None, "why": "nothing else in this library can be played"}

    mates = set()
    if after and registry.has("albums") and db.table_exists("album_songs"):
        mates = {r["song_id"] for r in db.query(
            "SELECT song_id FROM album_songs WHERE album_id IN "
            "(SELECT album_id FROM album_songs WHERE song_id = ?)", (after,))}

    now = time.time()
    most = max((r["opened"] or 0) for r in pool) or 1
    scored = []
    for row in pool:
        score = 1.0
        if row["id"] in mates:
            score += 3.0
        score += 2.0 * ((row["opened"] or 0) / most)
        # A month, softened: one over one plus age in months, so today is 1, a month ago
        # is a half, a year ago is a twelfth. No cliff anywhere for a song to fall off.
        months = max(0.0, (now - (row["updated_at"] or now)) / (30 * 86400))
        score += 1.5 / (1.0 + months)
        score *= 0.5 + random.random()
        scored.append((score, row))

    scored.sort(key=lambda pair: pair[0], reverse=True)
    best = scored[0][1]
    return {"song": decorate([dict(best)])[0],
            "why": "from the same album" if best["id"] in mates else "from your library"}


def get_song(req):
    song = get(req.params["id"])
    # Counted here, on the read, because this is the only place that knows a song was
    # opened. A GET that writes is not ordinarily a good idea, and the alternative is
    # worse: a second call from the page whose only job is to say "I loaded", which the
    # page can forget to make, make twice, or make without anybody having looked at
    # anything. The number is a rough popularity signal for one person's own library, so
    # a lost increment costs nothing and a missing one costs the feature.
    db.run("UPDATE songs SET opened = opened + 1 WHERE id = ?", (song["id"],))
    return {"song": decorate([song])[0]}


def most_opened(req):
    """The songs this library gets opened the most.

    Exact route, so it is found before /api/songs/<id> can claim it: resolve() checks the
    table for a literal match before it tries any pattern.
    """
    rows = db.query(
        "SELECT id, title, opened, current_version_id, created_at, updated_at "
        "FROM songs WHERE opened > 0 ORDER BY opened DESC, updated_at DESC LIMIT ?",
        (as_int(req.q("limit"), 6),))
    return {"songs": decorate(rows)}


def create_song(req):
    data = req.json()
    title = need(data, "title")
    now = time.time()
    song_id = db.insert("songs", {
        "title": title, "notes": data.get("notes", ""),
        "created_at": now, "updated_at": now})
    return {"song": decorate([get(song_id)])[0]}


def titles(req):
    """Every name this song has been called, newest first."""
    song = get(req.params["id"])
    rows = db.query("SELECT title, changed_at FROM song_titles WHERE song_id = ? "
                    "ORDER BY id DESC", (song["id"],))
    return {"current": song["title"], "previous": rows}


def update_song(req):
    song = get(req.params["id"])
    data = req.json()
    patch = {}
    if "title" in data:
        patch["title"] = need(data, "title")
        if patch["title"] != song["title"]:
            # The name it is leaving behind, kept so you can see what it used to be.
            db.insert("song_titles", {"song_id": song["id"], "title": song["title"],
                                      "changed_at": time.time()})
    if "notes" in data:
        patch["notes"] = data["notes"] or ""
    if "current_version_id" in data:
        patch["current_version_id"] = data["current_version_id"]
    patch["updated_at"] = time.time()
    db.update("songs", song["id"], patch)
    return {"song": decorate([get(song["id"])])[0]}


def delete_song(req):
    song = get(req.params["id"])
    # Blobs are left alone: another song may point at the same bytes, and a personal
    # library would rather keep an orphaned file than lose one that was still in use.
    db.run("DELETE FROM songs WHERE id = ?", (song["id"],))
    return {"deleted": song["id"]}


def match(req):
    """Which existing song is this filename probably another render of.

    The desktop client asks before uploading, so it can offer "Is this a new render of
    Halfway Under?" rather than making a second song every time you export.
    """
    name = (req.q("name") or "").strip()
    if not name:
        raise Error("name is required")
    stem = name.rsplit(".", 1)[0]
    # Renders are usually called "Song v18" or "Song_final_3", so the trailing junk is
    # noise for matching purposes.
    cleaned = stem.replace("_", " ").replace("-", " ").strip().lower()
    rows = db.query("SELECT id, title FROM songs")
    scored = []
    for row in rows:
        ratio = difflib.SequenceMatcher(None, cleaned, row["title"].lower()).ratio()
        if row["title"].lower() in cleaned:
            ratio = max(ratio, 0.9)
        scored.append((ratio, row))
    scored.sort(key=lambda pair: pair[0], reverse=True)
    # song_id rather than id, matching what sync.scan puts in its own suggestions. The
    # two endpoints answer the same question and a caller should not have to remember
    # which one it asked.
    best = [{"song_id": r["id"], "title": r["title"], "score": round(score, 3)}
            for score, r in scored[:5] if score >= 0.45]
    return {"query": stem, "matches": best,
            "suggest": best[0] if best and best[0]["score"] >= 0.62 else None}


def SUMMARY():
    row = db.one("SELECT COUNT(*) AS n FROM songs")
    return {"count": row["n"] if row else 0}


def SEARCH(term, limit):
    """Songs by name, including names they no longer have.

    Keeping old titles is the whole point of song_titles, and it is worth nothing if the
    search cannot see them: the name you go looking for is usually the one you changed.
    Found that way it ranks below every current title, and the row says which name it
    was, or it looks like a hit that does not contain the word.
    """
    like = finding.pattern(term)
    rows = db.query(
        "SELECT s.*, (SELECT t.title FROM song_titles t WHERE t.song_id = s.id "
        "   AND fold(t.title) LIKE ? ESCAPE '\\' ORDER BY t.id DESC LIMIT 1) AS was "
        "FROM songs s WHERE fold(s.title) LIKE ? ESCAPE '\\' "
        "   OR EXISTS (SELECT 1 FROM song_titles t WHERE t.song_id = s.id "
        "              AND fold(t.title) LIKE ? ESCAPE '\\')",
        (like, like, like))
    for row in rows:
        row["score"] = finding.rank(term, row["title"])
    # Recently touched breaks a tie, which is what the library sorts by by default: the
    # song you had open yesterday is the one you are looking for today.
    rows.sort(key=lambda r: (-r["score"], -(r["updated_at"] or 0)))
    hits = decorate(rows[:limit])
    for row in hits:
        row["href"] = "#/song/%d" % row["id"]
        if not row["score"] and row.get("was"):
            row["sub"] = "was called %s" % row["was"]
    return {"label": "Songs", "kind": "song", "order": 10,
            "total": len(rows), "hits": hits}


def ROUTES():
    return {
        ("GET", "/api/songs"): list_songs,
        ("POST", "/api/songs"): create_song,
        ("GET", "/api/songs/match"): match,
        ("GET", "/api/songs/most-opened"): most_opened,
        ("GET", "/api/songs/up-next"): up_next,
        ("GET", "/api/songs/<id>"): get_song,
        ("GET", "/api/songs/<id>/titles"): titles,
        ("PATCH", "/api/songs/<id>"): update_song,
        ("DELETE", "/api/songs/<id>"): delete_song,
    }
