"""Renders that have arrived but do not belong to a song yet.

Where a render came from and which song it is a new version of are two different
questions, and the moment FL finishes writing a file is the wrong time to ask the second
one. So a render lands here first. It is stored, it is playable, it keeps the name of the
project it came out of, and deciding what it is a version of happens later, from this
list or from the song itself.

The bytes are stored once, when the render arrives. Attaching it to a song afterwards
writes a row and copies nothing, because the blob store is content addressed and the
version simply points at the same digest.
"""
import os
import time

from .. import audio_meta, blobs, config, db, finding
from ..wire import Error, Response, as_int, need
from . import songs, versions

NAME = "renders"

SCHEMA = [
    """
    CREATE TABLE IF NOT EXISTS renders (
      id          INTEGER PRIMARY KEY,
      digest      TEXT NOT NULL UNIQUE,
      ext         TEXT NOT NULL DEFAULT '.wav',
      size        INTEGER NOT NULL DEFAULT 0,
      duration    REAL NOT NULL DEFAULT 0,
      bitrate     INTEGER NOT NULL DEFAULT 0,
      filename    TEXT NOT NULL DEFAULT '',
      source_path TEXT NOT NULL DEFAULT '',
      origin      TEXT NOT NULL DEFAULT 'upload',
      created_at  REAL NOT NULL,
      used_at     REAL NOT NULL DEFAULT 0,
      project_at  REAL NOT NULL DEFAULT 0,
      rendered_at REAL NOT NULL DEFAULT 0,
      peaks       TEXT NOT NULL DEFAULT '',
      peak_db     REAL,
      trouble     TEXT NOT NULL DEFAULT '',
      song_id     INTEGER,
      version_id  INTEGER
    )
    """,
    "CREATE INDEX IF NOT EXISTS renders_waiting ON renders(used_at, created_at DESC)",
]


def _add_shape_columns():
    """The drawn shape of a render, and whether it is worth playing.

    peaks is 120 numbers as a compact string, peak_db is the loudest sample in dBFS, and
    trouble is empty for a good file or names what is wrong with it. Kept on the row
    rather than worked out when a list is drawn, because a hundred renders would be a
    hundred files opened every time the screen was painted.
    """
    db.add_column_if_missing("renders", "peaks", "TEXT NOT NULL DEFAULT ''")
    db.add_column_if_missing("renders", "peak_db", "REAL")
    db.add_column_if_missing("renders", "trouble", "TEXT NOT NULL DEFAULT ''")


def MIGRATE():
    """Two dates a library made before them will not have.

    created_at is when JR!TER first saw the bytes, which is a fact about this library
    rather than about the music: re-import an old bounce today and it is dated today.
    These two are about the work. project_at is the age of the .flp it came out of, so a
    night's worth of takes group together however many times they were re-rendered
    since, and rendered_at is when the audio itself was made.

    Both default to 0 rather than to a time, because SQLite cannot put a computed
    default on an added column and because a made up date is worse than a missing one.
    Zero already means "not known" everywhere else here: used_at uses it for waiting,
    and J.when draws nothing for it.
    """
    db.add_column_if_missing("renders", "project_at", "REAL NOT NULL DEFAULT 0")
    db.add_column_if_missing("renders", "rendered_at", "REAL NOT NULL DEFAULT 0")
    _add_shape_columns()


def get(render_id):
    row = db.one("SELECT * FROM renders WHERE id = ?", (render_id,))
    if not row:
        raise Error("no render with id %s" % render_id, 404)
    return row


def _decorate(rows):
    """Each row carries the song it went to, so the list can say so without a second call."""
    titles = {r["id"]: r["title"] for r in db.query("SELECT id, title FROM songs")}
    for row in rows:
        row["song_title"] = titles.get(row["song_id"])
        row["name"] = os.path.splitext(row["filename"])[0] or "render"
        row["waiting"] = not row["used_at"]
        raw = row.pop("peaks", "") or ""
        row["shape"] = [int(n) for n in raw.split(",") if n.isdigit()]
    return rows


def list_renders(req):
    """Waiting ones by default, everything with ?all=1, so what was used stays readable."""
    if req.q("all"):
        rows = db.query("SELECT * FROM renders ORDER BY created_at DESC")
    else:
        rows = db.query("SELECT * FROM renders WHERE used_at = 0 ORDER BY created_at DESC")
    waiting = db.one("SELECT COUNT(*) AS n FROM renders WHERE used_at = 0")
    return {"renders": _decorate(rows), "waiting": waiting["n"] if waiting else 0}


def _shape_of(digest, ext):
    """Look at the audio once, when it arrives, and write down what is there.

    Done here rather than when a list is drawn: two hundred renders on screen would be
    two hundred files opened every repaint. Done at all because "this one is silent" is
    the single most useful thing to know about a batch of bounces, and finding out by
    pressing play on each of them in turn is how an afternoon goes.
    """
    try:
        found = audio_meta.peaks(blobs.path_for(digest), ext)
    except Exception:
        return {"peaks": "", "peak_db": None, "trouble": "unreadable"}
    trouble = ""
    if found["unreadable"]:
        trouble = "unreadable"
    elif found["silent"]:
        trouble = "silent"
    return {
        # Comma separated rather than JSON: it is a list of small integers and this is
        # half the bytes over the wire for two hundred rows.
        "peaks": ",".join(str(n) for n in found["peaks"]),
        "peak_db": found["peak_db"],
        "trouble": trouble,
    }


def _remember(digest, ext, size, filename, source_path, origin, duration=0.0, bitrate=0,
              project_at=0.0, rendered_at=0.0):
    """Write the row, or hand back the one that already holds these bytes.

    The same render arriving twice, from a re-scan or a second machine, is one entry. It
    keeps the first name it was given rather than flickering between two.

    A second arrival may still know a date the first did not: a file taken in from a
    folder has no project behind it, and the same bytes sent later by the FL client do.
    So dates are filled in when they are missing and never overwritten, which keeps the
    row growing more accurate without letting a re-import move a date that was right.
    """
    existing = db.one("SELECT * FROM renders WHERE digest = ?", (digest,))
    if existing:
        learned = {}
        if project_at and not existing.get("project_at"):
            learned["project_at"] = project_at
        if rendered_at and not existing.get("rendered_at"):
            learned["rendered_at"] = rendered_at
        if learned:
            db.update("renders", existing["id"], learned)
            return get(existing["id"]), False
        return existing, False
    shape = _shape_of(digest, ext)
    render_id = db.insert("renders", {
        "digest": digest, "ext": ext, "size": size, "duration": duration,
        "bitrate": bitrate, "filename": filename, "source_path": source_path,
        "origin": origin, "created_at": time.time(),
        "project_at": project_at or 0.0, "rendered_at": rendered_at or 0.0,
        "peaks": shape["peaks"], "peak_db": shape["peak_db"],
        "trouble": shape["trouble"]})
    return get(render_id), True


def _stamp(req, name):
    """A date sent as a header, in epoch seconds, or zero.

    Anything that is not a number, or is far enough out to be a clock rather than a
    date, is dropped rather than stored: a wrong date shown confidently is worse than
    no date at all.
    """
    raw = (req.headers.get(name) or "").strip()
    if not raw:
        return 0.0
    try:
        value = float(raw)
    except ValueError:
        return 0.0
    # Anything before 1990 or more than a day ahead is a clock that cannot be trusted.
    return value if 631152000 < value < time.time() + 86400 else 0.0


def upload(req):
    """A render straight off a machine, body raw, name in a header."""
    length = as_int(req.headers.get("Content-Length") or 0, "Content-Length")
    if length <= 0:
        raise Error("no file in that upload")
    filename = (req.headers.get("X-Filename") or "render.wav").strip()
    ext = os.path.splitext(filename)[1].lower()
    if ext not in config.AUDIO_EXT:
        raise Error("%s is not an audio file JR!TER handles" % (ext or filename))

    digest, size, _ = blobs.put_stream(req.rfile, length)
    meta = audio_meta.probe(blobs.path_for(digest), ext)
    row, added = _remember(digest, ext, size, filename,
                           (req.headers.get("X-Source-Path") or "").strip(),
                           (req.headers.get("X-Origin") or "upload").strip(),
                           meta["duration"], meta["bitrate"],
                           _stamp(req, "X-Project-At"), _stamp(req, "X-Rendered-At"))
    return {"render": _decorate([row])[0], "added": added}


def _mtime(path):
    """When the file was last written, which for a bounce is when it was rendered."""
    try:
        return os.path.getmtime(path)
    except OSError:
        return 0.0


def _project_beside(path):
    """The age of the .flp this audio came out of, if it is lying next to it.

    FL renders into the project's own folder unless told otherwise, so a bounce is
    usually a sibling of the project with the same stem. That is a guess, but a cheap and
    safe one: the worst case is no date rather than a wrong one, because the name has to
    match exactly.

    getctime is a creation time on Windows, which is where FL runs. Elsewhere it is the
    inode change time, which a rename would bump, so the earlier of the two is taken:
    a project cannot have been written before it was made.
    """
    stem = os.path.splitext(path)[0]
    for ext in (".flp", ".FLP"):
        project = stem + ext
        if os.path.isfile(project):
            try:
                return min(os.path.getctime(project), os.path.getmtime(project))
            except OSError:
                return 0.0
    return 0.0


def ingest(req):
    """Take in a file, or every audio file in a folder, already sitting on this machine.

    This is the other end of a batch render: FL writes a folder full of wavs, and this
    reads them where they lie rather than posting several gigabytes to a server running
    on the same disk.
    """
    data = req.json()
    path = os.path.abspath(os.path.expanduser(need(data, "path")))
    if os.path.isfile(path):
        found = [path]
    elif os.path.isdir(path):
        found = []
        for base, dirs, files in os.walk(path):
            dirs[:] = [d for d in dirs if not d.startswith(".")]
            for name in sorted(files):
                if os.path.splitext(name)[1].lower() in config.AUDIO_EXT:
                    found.append(os.path.join(base, name))
    else:
        raise Error("there is nothing at %s" % path)

    added, already = [], 0
    for item in found:
        ext = os.path.splitext(item)[1].lower()
        digest, size, _ = blobs.put_path(item)
        meta = audio_meta.probe(blobs.path_for(digest), ext)
        row, is_new = _remember(digest, ext, size, os.path.basename(item), item,
                                (data.get("origin") or "import").strip(),
                                meta["duration"], meta["bitrate"],
                                _project_beside(item), _mtime(item))
        if is_new:
            added.append(row)
        else:
            already += 1
    return {"added": _decorate(added), "count": len(added), "already_here": already,
            "looked_at": len(found)}


def attach(req):
    """Give a render a home: an existing song, or a new one named in the same call."""
    render = get(req.params["id"])
    data = req.json()
    song_id = data.get("song_id")
    if song_id:
        song = songs.get(song_id)
    else:
        title = (data.get("title") or "").strip() or \
            os.path.splitext(render["filename"])[0] or "Untitled"
        made = db.insert("songs", {"title": title, "created_at": time.time(),
                                   "updated_at": time.time()})
        song = songs.get(made)

    version, already = versions.add_stored(
        song["id"], render["digest"], render["ext"], render["size"],
        render["duration"], render["bitrate"],
        filename=render["filename"], source_path=render["source_path"],
        # Carried through rather than dropped: these say when the work happened, and the
        # song's own updated_at is bumped by saving a lyric.
        project_at=render.get("project_at") or 0.0,
        rendered_at=render.get("rendered_at") or 0.0)
    db.update("renders", render["id"], {"used_at": time.time(), "song_id": song["id"],
                                        "version_id": version["id"]})
    return {"render": _decorate([get(render["id"])])[0], "song": songs.get(song["id"]),
            "version": version, "already_there": already}


def unattach(req):
    """Put it back in the waiting list. The version it made is left alone."""
    render = get(req.params["id"])
    db.update("renders", render["id"], {"used_at": 0, "song_id": None, "version_id": None})
    return {"render": _decorate([get(render["id"])])[0]}


def rename(req):
    render = get(req.params["id"])
    name = need(req.json(), "name")
    ext = render["ext"] or os.path.splitext(render["filename"])[1]
    db.update("renders", render["id"], {"filename": name + ext})
    return {"render": _decorate([get(render["id"])])[0]}


def dismiss(req):
    """Throw one away. The bytes go too, unless a version is still made of them."""
    render = get(req.params["id"])
    db.run("DELETE FROM renders WHERE id = ?", (render["id"],))
    still = db.one("SELECT id FROM versions WHERE digest = ? LIMIT 1", (render["digest"],))
    if not still:
        blobs.delete(render["digest"])
    return {"dismissed": render["id"]}


def clear(req):
    """Everything that was used, out of the way in one go. Waiting ones are untouched."""
    rows = db.query("SELECT id FROM renders WHERE used_at > 0")
    for row in rows:
        db.run("DELETE FROM renders WHERE id = ?", (row["id"],))
    return {"cleared": len(rows)}


def audio(req):
    """Play it before deciding anything about it."""
    render = get(req.params["id"])
    path = blobs.path_for(render["digest"])
    if not os.path.isfile(path):
        raise Error("the file for that render is missing from storage", 410)
    from ..http import CONTENT_TYPES
    return Response(path=path,
                    content_type=CONTENT_TYPES.get(render["ext"],
                                                   "application/octet-stream"))


def examine(req):
    """Look again at renders whose shape is not known yet.

    Every render that arrived before this existed has no shape and no verdict, and there
    is no moment in normal use when they would get one. Bounded per call so a library of
    seven hundred does not hold a request open for a minute: the screen asks again until
    there is nothing left.
    """
    limit = as_int(req.q("limit") or 60, "limit")
    rows = db.query("SELECT id, digest, ext FROM renders "
                    "WHERE peaks = '' AND trouble = '' LIMIT ?", (max(1, min(200, limit)),))
    looked, found = 0, 0
    for row in rows:
        shape = _shape_of(row["digest"], row["ext"])
        # An unreadable file gets its verdict; a format the server cannot decode gets a
        # marker so it is not examined again on every pass forever.
        if not shape["peaks"] and not shape["trouble"]:
            shape["trouble"] = "not looked at"
        db.update("renders", row["id"], shape)
        looked += 1
        if shape["trouble"] in ("silent", "unreadable"):
            found += 1
    left = db.one("SELECT COUNT(*) AS n FROM renders WHERE peaks = '' AND trouble = ''")
    return {"looked_at": looked, "trouble": found, "left": left["n"] if left else 0}


def SUMMARY():
    waiting = db.one("SELECT COUNT(*) AS n FROM renders WHERE used_at = 0")
    total = db.one("SELECT COUNT(*) AS n FROM renders")
    return {"waiting": waiting["n"] if waiting else 0,
            "count": total["n"] if total else 0}


def SEARCH(term, limit):
    """Renders by their filename, and by the folder they came out of.

    Not through _decorate: that reads every song title in the library to attach one per
    row, and it turns peaks into a hundred and twenty numbers for a waveform that
    search results do not draw. Both are the wrong price for at most eight rows.
    """
    like = finding.pattern(term)
    rows = db.query(
        "SELECT r.id, r.filename, r.source_path, r.duration, r.size, r.used_at, "
        "       r.trouble, r.song_id, s.title AS song_title, r.created_at "
        "FROM renders r LEFT JOIN songs s ON s.id = r.song_id "
        "WHERE fold(r.filename) LIKE ? ESCAPE '\\' "
        "   OR fold(r.source_path) LIKE ? ESCAPE '\\'", (like, like))
    for row in rows:
        row["name"] = os.path.splitext(row["filename"])[0] or "render"
        row["title"] = row["name"]
        row["waiting"] = not row["used_at"]
        row["score"] = finding.rank(term, row["name"])
        row["sub"] = ("went to %s" % row["song_title"]) if row["song_title"] \
            else "waiting for a song"
        # There is no screen for one render, so it opens the list it is sitting in.
        row["href"] = "#/renders"
    rows.sort(key=lambda r: (-r["score"], -(r["created_at"] or 0)))
    return {"label": "Renders", "kind": "render", "order": 60,
            "total": len(rows), "hits": rows[:limit]}


def ROUTES():
    return {
        ("GET", "/api/renders"): list_renders,
        ("POST", "/api/renders"): upload,
        ("POST", "/api/renders/ingest"): ingest,
        ("POST", "/api/renders/examine"): examine,
        ("POST", "/api/renders/clear"): clear,
        ("GET", "/api/renders/<id>/audio"): audio,
        ("POST", "/api/renders/<id>/attach"): attach,
        ("POST", "/api/renders/<id>/unattach"): unattach,
        ("PATCH", "/api/renders/<id>"): rename,
        ("DELETE", "/api/renders/<id>"): dismiss,
    }
