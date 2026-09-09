"""Folders this library watches, and there are two kinds of them.

A RENDER COLLECTOR is a folder bounces land in. A scan hashes what it finds and compares
that against the versions already stored, so a file you have already imported is
recognised no matter what it has been renamed to, and a file that was only touched is
skipped without being read again. Nothing is imported without being asked: a scan reports
candidates and what it thinks each one is a new render of, and importing is a second,
explicit call.

A SIMPLE SYNC folder is a sample library, and it is the reason this file needed a second
kind at all. This module only had the first, so pointing it at a folder of samples did the
one thing you would never want: it offered five thousand one-shots as new renders of your
songs. A sync folder is deliberately never a render candidate. What it is for is knowing
what a library contains, so the same folder can be recognised on another machine.

WHAT SYNC DOES TODAY, said plainly because a section called Simple sync that quietly does
nothing would be worse than no section. It takes an inventory: every file, its size and
its digest, so the server knows what the library holds and two machines can be compared.
It does not move a byte between them yet. The transfer is the next piece of work and it is
not in here.
"""
import os
import time
import urllib.parse

from .. import db, blobs, config, audio_meta, registry
from ..wire import Error, need
from . import songs

NAME = "sync"

#: The two things a watched folder can be.
COLLECTOR = "collector"
SYNC = "sync"
KINDS = (COLLECTOR, SYNC)

SCHEMA = [
    """
    CREATE TABLE IF NOT EXISTS sync_folders (
      id         INTEGER PRIMARY KEY,
      path       TEXT NOT NULL UNIQUE,
      enabled    INTEGER NOT NULL DEFAULT 1,
      last_scan  REAL NOT NULL DEFAULT 0,
      created_at REAL NOT NULL,
      kind       TEXT NOT NULL DEFAULT 'collector'
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS sync_seen (
      path       TEXT PRIMARY KEY,
      digest     TEXT NOT NULL,
      size       INTEGER NOT NULL,
      mtime      REAL NOT NULL,
      checked_at REAL NOT NULL
    )
    """,
]


def MIGRATE():
    """A kind on every folder, defaulting to what they all were.

    Collector, not sync: every folder anybody has already added was added to a version of
    this module that only collected renders, so that is what they are, whatever they were
    meant to be. Guessing otherwise from the path would silently stop a folder being
    scanned that somebody is relying on.
    """
    db.add_column_if_missing("sync_folders", "kind",
                             "TEXT NOT NULL DEFAULT '%s'" % COLLECTOR)


def list_folders(req):
    return {"folders": db.query("SELECT * FROM sync_folders ORDER BY path")}


def add_folder(req):
    data = req.json()
    path = need(data, "path")
    path = os.path.abspath(os.path.expanduser(path))
    if not os.path.isdir(path):
        raise Error("there is no folder at %s" % path)
    kind = (data.get("kind") or COLLECTOR).strip()
    if kind not in KINDS:
        raise Error("a folder is either a %s or a %s" % KINDS)
    existing = db.one("SELECT * FROM sync_folders WHERE path = ?", (path,))
    if existing:
        return {"folder": existing, "added": False}
    folder_id = db.insert("sync_folders",
                          {"path": path, "enabled": 1, "kind": kind,
                           "created_at": time.time()})
    return {"folder": db.one("SELECT * FROM sync_folders WHERE id = ?", (folder_id,)),
            "added": True}


def update_folder(req):
    folder = db.one("SELECT * FROM sync_folders WHERE id = ?", (req.params["id"],))
    if not folder:
        raise Error("no folder with id %s" % req.params["id"], 404)
    data = req.json()
    if "enabled" in data:
        db.update("sync_folders", folder["id"], {"enabled": 1 if data["enabled"] else 0})
    return {"folder": db.one("SELECT * FROM sync_folders WHERE id = ?", (folder["id"],))}


def remove_folder(req):
    db.run("DELETE FROM sync_folders WHERE id = ?", (req.params["id"],))
    return {"removed": req.params["id"]}


def _digest_for(path, stat):
    """Hash a file, reusing the last answer when size and mtime are unchanged.

    Hashing every render on every scan would make a folder of a few hundred mixes take
    minutes. Size and mtime together are enough to know nothing has been rewritten.
    """
    cached = db.one("SELECT * FROM sync_seen WHERE path = ?", (path,))
    if cached and cached["size"] == stat.st_size and abs(cached["mtime"] - stat.st_mtime) < 1:
        return cached["digest"]
    digest = blobs.hash_file(path)
    db.run("INSERT INTO sync_seen (path, digest, size, mtime, checked_at) "
           "VALUES (?, ?, ?, ?, ?) ON CONFLICT(path) DO UPDATE SET "
           "digest = excluded.digest, size = excluded.size, mtime = excluded.mtime, "
           "checked_at = excluded.checked_at",
           (path, digest, stat.st_size, stat.st_mtime, time.time()))
    return digest


def _under(path, roots):
    """Is path inside any of roots. normcase, because this runs on Windows: the same
    folder can be spelled with either case and a plain comparison would miss it."""
    here = os.path.normcase(os.path.abspath(path))
    for root in roots:
        top = os.path.normcase(os.path.abspath(root))
        if here == top or here.startswith(top + os.sep):
            return True
    return False


def _walk(root, skip=()):
    """Every audio file under root, never descending into a folder in skip.

    skip is what makes the two kinds of folder actually separate. Marking a sample library
    as sync keeps it out of the list of folders that get scanned, which is not the same as
    keeping its files out of a scan: a library living inside a collector, which is the
    ordinary case if you keep both under one music folder, was walked anyway and every
    one shot in it came back as a new render. Measured on a library of seven: seven
    candidates.

    Pruned rather than filtered, so a library of forty thousand samples is not read at all
    rather than read and discarded.
    """
    for base, dirs, files in os.walk(root):
        dirs[:] = [d for d in dirs
                   if not d.startswith(".") and not _under(os.path.join(base, d), skip)]
        if _under(base, skip):
            continue
        for name in files:
            if os.path.splitext(name)[1].lower() in config.AUDIO_EXT:
                yield os.path.join(base, name)


def scan(req):
    """Look at every watched folder and report what is not in the library yet."""
    if not registry.has("versions"):
        raise Error("the versions module is switched off, so nothing can be imported", 409)
    # Collectors only. This is the whole point of the kind: a sample library is not a
    # pile of new renders, and offering it as one is what this module used to do.
    folders = db.query("SELECT * FROM sync_folders WHERE enabled = 1 AND kind = ?",
                       (COLLECTOR,))
    # Every sample library, whether or not it is switched on: a library that is paused is
    # still a library, and its contents are still not renders.
    libraries = [row["path"] for row in
                 db.query("SELECT path FROM sync_folders WHERE kind = ?", (SYNC,))]
    candidates, known, errors = [], 0, []
    for folder in folders:
        if not os.path.isdir(folder["path"]):
            errors.append({"path": folder["path"], "why": "the folder is not there any more"})
            continue
        for path in _walk(folder["path"], libraries):
            try:
                stat = os.stat(path)
                digest = _digest_for(path, stat)
            except OSError as e:
                errors.append({"path": path, "why": str(e)})
                continue
            have = db.one("SELECT v.id, v.n, v.song_id, s.title FROM versions v "
                          "JOIN songs s ON s.id = v.song_id WHERE v.digest = ? LIMIT 1",
                          (digest,))
            if have:
                known += 1
                continue
            meta = audio_meta.probe(path)
            candidates.append({
                "path": path, "name": os.path.basename(path), "digest": digest,
                "size": stat.st_size, "modified": stat.st_mtime,
                "duration": meta["duration"], "bitrate": meta["bitrate"],
                "suggest": _suggest(os.path.basename(path)),
            })
        db.update("sync_folders", folder["id"], {"last_scan": time.time()})
    candidates.sort(key=lambda c: c["modified"], reverse=True)
    return {"candidates": candidates, "already_have": known, "errors": errors,
            "folders": len(folders)}


def take_stock(req):
    """What the sync folders hold. An inventory, not a transfer.

    Every file, not only the audio ones: a sample library has its own folder structure and
    a .txt of notes beside a kit is part of the library. Size and mtime only, because
    hashing tens of thousands of samples to answer "how big is this" would take minutes
    and answer a question nobody asked.
    """
    folders = db.query("SELECT * FROM sync_folders WHERE enabled = 1 AND kind = ?",
                       (SYNC,))
    out, errors = [], []
    for folder in folders:
        if not os.path.isdir(folder["path"]):
            errors.append({"path": folder["path"], "why": "the folder is not there any more"})
            continue
        files, total, newest = 0, 0, 0.0
        for base, dirs, names in os.walk(folder["path"]):
            dirs[:] = [d for d in dirs if not d.startswith(".")]
            for name in names:
                if name.startswith("."):
                    continue
                try:
                    stat = os.stat(os.path.join(base, name))
                except OSError:
                    continue
                files += 1
                total += stat.st_size
                newest = max(newest, stat.st_mtime)
        db.update("sync_folders", folder["id"], {"last_scan": time.time()})
        out.append({"id": folder["id"], "path": folder["path"],
                    "files": files, "bytes": total, "newest": newest})
    return {"libraries": out, "errors": errors}


def _suggest(name):
    import difflib
    stem = os.path.splitext(name)[0].replace("_", " ").replace("-", " ").strip().lower()
    best, score = None, 0.0
    for row in db.query("SELECT id, title FROM songs"):
        ratio = difflib.SequenceMatcher(None, stem, row["title"].lower()).ratio()
        if row["title"].lower() in stem:
            ratio = max(ratio, 0.9)
        if ratio > score:
            best, score = row, ratio
    if best and score >= 0.62:
        return {"song_id": best["id"], "title": best["title"], "score": round(score, 3)}
    return None


def import_file(req):
    """Take one scanned file into the library, as a new version or a brand new song."""
    if not registry.has("versions"):
        raise Error("the versions module is switched off, so nothing can be imported", 409)
    data = req.json()
    path = need(data, "path")
    if not os.path.isfile(path):
        raise Error("there is no file at %s" % path)
    if os.path.splitext(path)[1].lower() not in config.AUDIO_EXT:
        raise Error("that is not an audio file JR!TER handles")

    watched = db.query("SELECT path FROM sync_folders WHERE enabled = 1")
    real = os.path.abspath(path)
    # Only files inside a folder the user chose. Without this the endpoint would copy
    # anything on the machine into the library on request.
    if not any(real.startswith(os.path.abspath(f["path"]) + os.sep) or
               real == os.path.abspath(f["path"]) for f in watched):
        raise Error("that file is not inside any watched folder", 403)

    song_id = data.get("song_id")
    if song_id:
        song = songs.get(song_id)
    else:
        title = (data.get("title") or "").strip() or os.path.splitext(os.path.basename(path))[0]
        now = time.time()
        song = songs.get(db.insert("songs", {
            "title": title, "notes": "", "created_at": now, "updated_at": now}))

    digest, size, _ = blobs.put_path(path)
    same = db.one("SELECT * FROM versions WHERE song_id = ? AND digest = ?",
                  (song["id"], digest))
    if same:
        return {"song": song, "version": same, "duplicate": True}

    meta = audio_meta.probe(path)
    row = db.one("SELECT MAX(n) AS n FROM versions WHERE song_id = ?", (song["id"],))
    version_id = db.insert("versions", {
        "song_id": song["id"], "n": (row["n"] or 0) + 1 if row else 1,
        "digest": digest, "ext": os.path.splitext(path)[1].lower(), "size": size,
        "duration": meta["duration"], "bitrate": meta["bitrate"], "label": "",
        "filename": os.path.basename(path), "source_path": real,
        "created_at": time.time()})
    db.update("songs", song["id"], {"current_version_id": version_id,
                                    "updated_at": time.time()})
    return {"song": songs.get(song["id"]),
            "version": db.one("SELECT * FROM versions WHERE id = ?", (version_id,)),
            "duplicate": False}


def SUMMARY():
    folders = db.one("SELECT COUNT(*) AS n FROM sync_folders WHERE enabled = 1")
    return {"folders": folders["n"] if folders else 0}


#: A sample is a one shot, not an album. Big enough for a long loop, small enough that a
#: mistake cannot fill the disk before anybody notices.
UPLOAD_MOST = 64 * 1024 * 1024


def _free_name(folder, name):
    """A name inside folder that is not taken, by adding a number if it has to.

    Overwriting is not offered. A sample library is a collection somebody else assembled
    and this endpoint exists to add to it, so a clash gets "kick 2.wav" rather than
    replacing the kick that was already there.
    """
    stem, ext = os.path.splitext(name)
    tryout = name
    n = 2
    while os.path.exists(os.path.join(folder, tryout)):
        tryout = "%s %d%s" % (stem, n, ext)
        n += 1
    return tryout


def upload_into(req):
    """Put one sound file into a sample library.

    The one place anything writes into a watched folder, which is why this is the longest
    handler in the file for the least work. Everything else here reads.
    """
    folder = db.one("SELECT * FROM sync_folders WHERE id = ?", (req.params["id"],))
    if not folder:
        raise Error("no watched folder with that id", 404)
    if (folder["kind"] or COLLECTOR) != SYNC:
        raise Error("that folder is a render collector, not a sample library. Anything "
                    "landing in a collector is offered as a new render, which is not "
                    "what a one shot is for.", 400)
    if not os.path.isdir(folder["path"]):
        raise Error("the folder %s is not there any more" % folder["path"], 409)

    length = int(req.headers.get("Content-Length") or 0)
    if length <= 0:
        raise Error("no file in that upload")
    if length > UPLOAD_MOST:
        raise Error("a sample over %d MB is not a sample" % (UPLOAD_MOST // 1048576))

    # Decoded first, then taken apart, and the order is the whole point.
    #
    # The browser sends the name percent encoded. The other upload handlers here use it
    # as it arrives, which is fine when all they want is the extension, and not fine when
    # the name becomes a file on a disk: "my kick #1.wav" would land as "my kick %231.wav".
    #
    # Decoding it means %2F arrives as a separator, so the sanitising has to happen after
    # the decoding rather than before it, or it is sanitising the wrong string. basename on
    # both separators, so neither ../ nor ..\ survives being read on a machine that only
    # treats one of them as one.
    raw = urllib.parse.unquote((req.headers.get("X-Filename") or "").strip())
    name = os.path.basename(raw.replace("\\", "/"))
    if not name or name in (".", ".."):
        raise Error("that upload did not say what it was called")
    ext = os.path.splitext(name)[1].lower()
    if ext not in config.AUDIO_EXT:
        raise Error("JR!TER takes %s, not %s"
                    % (", ".join(config.AUDIO_EXT), ext or name))

    into = os.path.abspath(folder["path"])
    name = _free_name(into, name)
    dest = os.path.abspath(os.path.join(into, name))
    # Belt and braces. basename should have made this impossible; a path that still ends
    # up outside the folder means an assumption above is wrong, and the answer to that is
    # to stop rather than to write.
    if os.path.dirname(dest) != into:
        raise Error("that name does not stay inside the folder", 400)

    body = req.rfile.read(length)
    if len(body) != length:
        raise Error("the upload stopped early", 400)

    tmp = dest + ".part"
    with open(tmp, "wb") as f:
        f.write(body)
    os.replace(tmp, dest)

    return {"added": name, "folder": folder["id"], "bytes": len(body),
             "path": dest}


def ROUTES():
    return {
        ("GET", "/api/sync/folders"): list_folders,
        ("POST", "/api/sync/folders"): add_folder,
        ("PATCH", "/api/sync/folders/<id>"): update_folder,
        ("DELETE", "/api/sync/folders/<id>"): remove_folder,
        ("POST", "/api/sync/scan"): scan,
        ("POST", "/api/sync/stock"): take_stock,
        ("POST", "/api/sync/import"): import_file,
        ("POST", "/api/sync/folders/<id>/upload"): upload_into,
    }
