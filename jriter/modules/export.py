"""A copy of the library, and getting rid of it.

Two things that are better as a button than as a sentence in a notice. A paragraph
promising you could have your data is worth less than an endpoint that hands it over, and
it goes stale the moment a module is added. So the privacy notice points here rather than
describing what could in principle be arranged.

WHAT IS TAKEN is named table by table and column by column below, rather than everything
minus a list of things to hide. That is the whole safety property: a list of what to hide
is wrong the day somebody adds a table, and nobody re-reads an export to notice. A table
this file has never heard of is not exported, and a test fails until somebody decides
which of the two lists it belongs in.

WHAT IS NEVER IN IT: the password hash, the salt, the session signing key, the Google
client secret and refresh token, and the digest of any machine token. Those live in
data/auth.json and data/youtube.json, which this file never opens, and in one column of
auth_tokens, which is not in the list below. A copy of your library that also opens the
door is not a copy, it is a second key.

AND NOT THE AUDIO. A real library is gigabytes of blobs and a browser download over a
tunnel that restarts on two missed health probes is the wrong shape for that. Every render
names the digest of its bytes, so the note inside the zip says where to find them. The
note is inside the file and not only on the page, because whoever opens this in six months
will not have the page.
"""
import io
import os
import json
import time
import shutil
import zipfile
import tempfile

from .. import db, config, blobs
from ..wire import Error, Response, need

NAME = "export"
SCHEMA = []

#: Table, then the columns handed over. Named rather than derived, so a column added to a
#: table later is not exported until somebody has looked at it and said so.
TAKEN = {
    "songs": ("id", "title", "notes", "current_version_id", "created_at", "updated_at",
              "opened"),
    "song_titles": ("id", "song_id", "title", "changed_at"),
    "versions": ("id", "song_id", "n", "digest", "ext", "size", "duration", "bitrate",
                 "label", "filename", "source_path", "created_at", "project_at",
                 "rendered_at", "peak_db", "trouble"),
    "renders": ("id", "digest", "ext", "size", "duration", "bitrate", "filename",
                "source_path", "origin", "created_at", "used_at", "project_at",
                "rendered_at", "peak_db", "trouble", "song_id", "version_id"),
    "lyric_sheets": ("id", "song_id", "name", "position", "is_current", "created_at"),
    "lyric_revisions": ("id", "sheet_id", "text", "created_at"),
    "albums": ("id", "title", "year", "notes", "cover_digest", "cover_ext",
               "created_at", "updated_at", "opened"),
    "album_songs": ("album_id", "song_id", "position"),
    "playlists": ("id", "title", "album_id", "created_at", "updated_at"),
    "playlist_items": ("id", "playlist_id", "position", "song_id", "render_id", "added_at"),
    "artwork": ("id", "song_id", "digest", "ext", "position", "caption", "created_at"),
    "sound_presets": ("id", "song_id", "name", "is_current", "data", "created_at",
                      "updated_at"),
    "arrangements": ("song_id", "version_id", "bpm", "offset", "per_bar", "enabled",
                     "data", "updated_at"),
    "youtube_posts": ("id", "song_id", "version_id", "url", "title", "status", "note",
                      "created_at", "updated_at", "video_id", "mix_digest"),
    "sync_folders": ("id", "path", "enabled", "last_scan", "created_at"),
    # The name and the scope of each machine token, so you can see what has been let in.
    # Never `digest`: that column is what the token is checked against.
    "auth_tokens": ("id", "name", "scope", "created_at", "last_used"),
}

#: Left out on purpose, and why. Anything that is in neither list is a table nobody has
#: decided about, which is what test_every_table_is_decided_about fails on.
SKIPPED = {
    "migrations": "bookkeeping: which schema steps have run",
    "sync_seen": "a cache of every file ever scanned, rebuilt by the next scan",
}

#: The peaks columns are deliberately absent from TAKEN. They are a hundred and twenty
#: numbers per row describing a waveform the export draws nothing with, and they would be
#: most of the file.

INSIDE = """This is everything JR!TER holds about your library that is text.

  library.json   every row it keeps, table by table
  settings.json  your settings
  README.txt     this file

WHAT IS NOT IN HERE

The audio and the artwork. Every render and version in library.json names the SHA-256 of
its bytes under "digest". The file itself is in your data directory at

    data/blobs/<first two characters>/<next two>/<the whole digest>

Copy that folder and you have the sound as well.

Your password hash and salt, the session signing key, and any Google client secret or
refresh token. Those are left out on purpose: a copy of your library that also opens the
door is not a copy, it is a second key.

Taken %s from %s.
"""


def _rows():
    out = {}
    for table, columns in sorted(TAKEN.items()):
        if not db.table_exists(table):
            # The module that owns it is switched off. Its rows are not this file's to
            # invent, and an empty list would read as "you have none" rather than "that
            # feature is not on".
            continue
        have = set(db.columns(table))
        # Only the columns that are actually there, so a library which has not run a
        # migration yet exports what it has instead of failing on a name.
        wanted = [c for c in columns if c in have]
        if not wanted:
            continue
        rows = db.query("SELECT %s FROM %s" % (", ".join(wanted), table))
        out[table] = [{c: row[c] for c in wanted} for row in rows]
    return out


def take(req):
    """The whole library as text, in a zip.

    Built on a temporary file rather than in memory: a library with ten years of lyric
    revisions in it is not something to hold twice in a process that also serves audio.
    """
    when = time.strftime("%Y-%m-%d %H:%M")
    body = {
        "taken_at": time.time(),
        "library": config.settings().get("library_name", "JR!TER"),
        "tables": _rows(),
        "left_out": SKIPPED,
    }
    handle, path = tempfile.mkstemp(prefix="jriter-export-", suffix=".zip")
    os.close(handle)
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("library.json", json.dumps(body, indent=1, ensure_ascii=False))
        z.writestr("settings.json", json.dumps(config.settings(), indent=1,
                                               ensure_ascii=False))
        z.writestr("README.txt", INSIDE % (when, body["library"]))
    name = "jriter-%s.zip" % time.strftime("%Y-%m-%d")
    # "download", not a Content-Disposition of our own: the HTTP layer builds that header
    # itself in _file, and a raw one set here is dropped on the floor. It was, and the zip
    # arrived with no filename. temporary=True is what stops a copy of the whole library
    # staying in the temporary directory after it has been handed over.
    return Response(path=path, content_type="application/zip", temporary=True,
                    headers={"download": name})


def what_erase_takes(req):
    """What Erase would remove, before it removes it, with the sizes.

    Read rather than assumed, because the honest part of an erase is the list: it says
    what it can reach, and the two things it cannot are on the page beside it.
    """
    def weigh(path, how):
        # `how` rather than one word for all three, because they do not go the same way
        # and the difference is visible afterwards: jriter.db is still on disk when this
        # has finished, holding nothing. Saying "deleted" beside a file somebody can then
        # see in Explorer is how a page that is telling the truth gets read as lying.
        if os.path.isfile(path):
            return {"path": path, "bytes": os.path.getsize(path), "how": how}
        if os.path.isdir(path):
            total = 0
            for here, _, names in os.walk(path):
                for one in names:
                    try:
                        total += os.path.getsize(os.path.join(here, one))
                    except OSError:
                        pass
            return {"path": path, "bytes": total, "how": how}
        return None
    goes = [weigh(config.DB_PATH, "every row inside it, then the file is compacted to empty"),
            weigh(config.BLOBS, "every file in it"),
            weigh(config.SETTINGS_PATH, "deleted")]
    return {"library": config.settings().get("library_name", "JR!TER"),
            "goes": [g for g in goes if g]}


def erase(req):
    """Everything, after the library's name is typed.

    Typed rather than ticked, because what is being confirmed cannot be undone and a tick
    is the same gesture as every other tick on the page.

    What it does not touch is named in the reply rather than left for somebody to find
    out: the password, so the door still works while you set it up again; a Google token,
    which is removed from this machine here and revoked only at Google; and the desktop
    agent's own file on another machine, which nothing on this server can reach.
    """
    said = (req.json() or {}).get("confirm", "")
    want = config.settings().get("library_name", "JR!TER")
    if said.strip() != want:
        raise Error("Type the library's name, %s, to erase it." % want, 400)

    # The rows go, not the file.
    #
    # Deleting jriter.db was the first version and it silently did nothing on Windows,
    # which is the worst way for this particular button to fail: every other thread that
    # has served a request is holding its own connection to that file, os.remove raises
    # sharing violation, and the handler reported success to a page that then said the
    # library had been erased. Emptying the tables needs no file handle from anybody, and
    # VACUUM afterwards is what actually returns the pages rather than leaving the words
    # readable in a file that merely says it is empty.
    gone = []
    conn = db.connect()
    tables = [row["name"] for row in db.query(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")]
    for table in tables:
        if table == "migrations":
            # Which schema steps have run is true of the database, not of the library.
            # Clearing it would make every named migration run again on the next start.
            continue
        conn.execute("DELETE FROM %s" % table)
        gone.append("every row of " + table)
    conn.commit()
    # Outside a transaction, and it is the step that makes this an erase rather than a
    # hidden row.
    conn.isolation_level = None
    conn.execute("VACUUM")
    conn.isolation_level = ""

    if os.path.isdir(config.BLOBS):
        for here, _, names in os.walk(config.BLOBS):
            for one in names:
                try:
                    os.remove(os.path.join(here, one))
                except OSError:
                    pass
        gone.append("every file under " + config.BLOBS)
    try:
        os.remove(config.SETTINGS_PATH)
        gone.append(config.SETTINGS_PATH)
    except OSError:
        pass
    blobs._forget_usage()
    config.ensure_dirs()
    return {
        "gone": gone,
        "left": [
            "Your password, so the door still works. Change it in Settings.",
            "Any Google account is disconnected from this machine only. Revoking it is "
            "done at Google, on your account's third party access page.",
            "The desktop agent's own file on whichever machine runs it. Revoke its token "
            "in Settings, which is what actually stops it working.",
        ],
    }


def SUMMARY():
    return {"tables": len(TAKEN)}


def ROUTES():
    return {
        ("GET", "/api/export"): take,
        ("GET", "/api/export/erase"): what_erase_takes,
        ("POST", "/api/export/erase"): erase,
    }
