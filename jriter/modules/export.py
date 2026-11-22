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

from .. import accounts, db, config, blobs, who
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
                 "rendered_at", "peak_db", "trouble", "plugins"),
    "renders": ("id", "digest", "ext", "size", "duration", "bitrate", "filename",
                "source_path", "origin", "created_at", "used_at", "project_at",
                "rendered_at", "peak_db", "trouble", "plugins", "song_id", "version_id"),
    "lyric_sheets": ("id", "song_id", "name", "position", "is_current", "created_at"),
    "lyric_revisions": ("id", "sheet_id", "text", "created_at"),
    "albums": ("id", "title", "year", "notes", "cover_digest", "cover_ext", "stickers",
               "created_at", "updated_at", "opened"),
    "album_songs": ("album_id", "song_id", "position"),
    "playlists": ("id", "title", "album_id", "created_at", "updated_at"),
    "playlist_items": ("id", "playlist_id", "position", "song_id", "render_id", "added_at"),
    "artwork": ("id", "song_id", "digest", "ext", "position", "caption", "created_at"),
    "sound_presets": ("id", "song_id", "name", "is_current", "data", "created_at",
                      "updated_at"),
    "arrangements": ("song_id", "version_id", "bpm", "offset", "per_bar", "enabled",
                     "data", "updated_at"),
    "daw_projects": ("song_id", "text", "rev", "updated_at", "updated_by"),
    "youtube_posts": ("id", "song_id", "version_id", "url", "title", "status", "note",
                      "created_at", "updated_at", "video_id", "mix_digest"),
    "sync_folders": ("id", "path", "enabled", "last_scan", "created_at"),
    # The week itself is a file rather than a table, so it is not here and does not need to
    # be: a copy of the library is a copy of what the library holds, and it holds these.
    # They are somebody's own writing about their own subjects, which is exactly the kind of
    # thing "take a copy" is for.
    "orarend_notes": ("id", "subject", "absences", "created_at", "updated_at"),
    "orarend_pages": ("id", "note_id", "position", "text", "created_at", "updated_at"),
    # The name and the scope of each machine token, so you can see what has been let in.
    # Never `digest`: that column is what the token is checked against.
    "auth_tokens": ("id", "name", "scope", "created_at", "last_used"),
    # Who changed what on your shared songs. Not `before`: that is the song as it was, row
    # for row, and every one of those rows is already in this export in its own table.
    "guest_edits": ("id", "song_id", "account", "share_id", "what", "route", "created_at",
                    "updated_at", "undone_at"),
    # Voices on a song. The recordings themselves are blobs, like renders.
    "vocal_takes": ("id", "song_id", "author", "name", "digest", "ext", "size", "duration",
                    "offset", "enabled", "gain", "chain", "created_at", "updated_at"),
    # Your own one-shots for the DAW. The sounds are blobs; deleted ones are kept (deleted_at).
    "samples": ("id", "name", "folder", "digest", "ext", "size", "duration", "created_at",
                "deleted_at"),
}

#: Left out on purpose, and why. Anything that is in neither list is a table nobody has
#: decided about, which is what test_every_table_is_decided_about fails on.
SKIPPED = {
    "migrations": "bookkeeping: which schema steps have run",
    "sync_seen": "a cache of every file ever scanned, rebuilt by the next scan",
    "grave": "deleted things kept for a while; bring them back first to have them in a copy",
}

#: The peaks columns are deliberately absent from TAKEN. They are a hundred and twenty
#: numbers per row describing a waveform the export draws nothing with, and they would be
#: most of the file.

INSIDE = """This is a JR!TER library: everything it holds about your songs, as text.

  library.json            every row it keeps, table by table (format "jriter-library",
                          version 2). This is the part JR!TER reads back in.
  settings.json           your settings
  songs/<title>/words.md  each song's current words, as you typed them
  songs/<title>/song.txt  the song in plain words: renders, arrangement, sound
  audio/<digest>.<ext>    the audio and pictures, if this copy was taken with audio
  README.txt              this file

To bring it back, into this library or any other: Settings, Library, Bring a library in.
That adds what is in here; it never replaces or deletes anything. The format is written
down in docs/library-format.md in JR!TER's source.

WHAT IS NOT IN HERE

Unless this copy was taken with audio: the audio and the artwork. Every render and version
in library.json names the SHA-256 of its bytes under "digest". The file itself is in your
data directory at

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


FORMAT = "jriter-library"
VERSION = 2
ABOUT = ("Every row this library keeps, table by table. Ids are this library's own; every "
         "*_id column points at a row in another table here. Audio and pictures are named by "
         "the SHA-256 of their bytes (digest) and, when included, sit in audio/<digest>.<ext>. "
         "Import adds these rows to a library with new ids; it never deletes anything.")

#: Which columns name a file in the blob store, per table.
BLOB_COLUMNS = {"versions": ("digest", "ext"), "renders": ("digest", "ext"),
                "artwork": ("digest", "ext"), "vocal_takes": ("digest", "ext"),
                "samples": ("digest", "ext"),
                "albums": ("cover_digest", "cover_ext")}


def _slug(title, n):
    keep = "".join(c if c.isalnum() or c in " -_()'" else " " for c in (title or "untitled"))
    return ("%03d %s" % (n, " ".join(keep.split())))[:80].strip()


def _clock(t):
    return time.strftime("%Y-%m-%d %H:%M", time.localtime(t)) if t else "?"


def _song_files(tables):
    """songs/<title>/words.md and song.txt: the library for people, written from the rows."""
    out = {}
    by = lambda name: tables.get(name) or []
    for n, song in enumerate(sorted(by("songs"), key=lambda r: r.get("id") or 0), 1):
        sid = song.get("id")
        folder = "songs/%s/" % _slug(song.get("title"), n)
        sheets = [s for s in by("lyric_sheets") if s.get("song_id") == sid]
        current = next((s for s in sheets if s.get("is_current")), sheets[0] if sheets else None)
        if current:
            revs = [r for r in by("lyric_revisions") if r.get("sheet_id") == current.get("id")]
            if revs:
                latest = max(revs, key=lambda r: (r.get("created_at") or 0, r.get("id") or 0))
                out[folder + "words.md"] = latest.get("text") or ""
        lines = ["%s" % (song.get("title") or "untitled"), ""]
        if (song.get("notes") or "").strip():
            lines += [song["notes"].strip(), ""]
        lines.append("Started %s, last touched %s." % (_clock(song.get("created_at")), _clock(song.get("updated_at"))))
        versions = sorted([v for v in by("versions") if v.get("song_id") == sid], key=lambda v: v.get("n") or 0)
        if versions:
            lines += ["", "Renders"]
            for v in versions:
                mark = " (current)" if v.get("id") == song.get("current_version_id") else ""
                secs = v.get("duration") or 0
                lines.append("  v%s  %s  %d:%02d  %s.%s%s" % (
                    v.get("n"), v.get("label") or v.get("filename") or "", secs // 60, secs % 60,
                    v.get("digest"), v.get("ext"), mark))
        arr = next((a for a in by("arrangements") if a.get("song_id") == sid), None)
        if arr:
            lines += ["", "Arrangement", "  %s bpm, beat one at %ss, %s beats a bar, %s" % (
                arr.get("bpm"), arr.get("offset"), arr.get("per_bar"), "on" if arr.get("enabled") else "off")]
            try:
                data = json.loads(arr.get("data") or "{}")
                for clip in data.get("clips") or []:
                    lines.append("  %s beats from beat %s" % (clip.get("beats"), clip.get("from")))
            except (ValueError, AttributeError):
                pass
        presets = [p for p in by("sound_presets") if p.get("song_id") == sid]
        if presets:
            lines += ["", "Sound presets"]
            for p in presets:
                lines.append("  %s%s" % (p.get("name"), " (current)" if p.get("is_current") else ""))
                lines.append("    " + (p.get("data") or "{}"))
        out[folder + "song.txt"] = "\n".join(lines) + "\n"
    return out


def _blobs_in(tables):
    seen = {}
    for table, (dcol, ecol) in BLOB_COLUMNS.items():
        for row in tables.get(table) or []:
            if row.get(dcol):
                seen[row[dcol]] = row.get(ecol) or "bin"
    return seen


def take(req):
    """The whole library as text, in a zip.

    Built on a temporary file rather than in memory: a library with ten years of lyric
    revisions in it is not something to hold twice in a process that also serves audio.
    """
    when = time.strftime("%Y-%m-%d %H:%M")
    body = {
        "format": FORMAT,
        "version": VERSION,
        "about": ABOUT,
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
        for name, text in _song_files(body["tables"]).items():
            z.writestr(name, text)
        # With audio when asked: Settings has the two buttons, since a real library is
        # gigabytes and most copies are for the words.
        if req is not None and req.q("audio") in ("1", "true", "yes"):
            for digest, ext in _blobs_in(body["tables"]).items():
                if blobs.exists(digest):
                    z.write(blobs.path_for(digest), "audio/%s.%s" % (digest, ext),
                            compress_type=zipfile.ZIP_STORED)
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
    goes = [weigh(config.db_path(), "every row inside it, then the file is compacted to empty"),
            weigh(config.blobs_dir(), "every file in it"),
            weigh(config.settings_path(), "deleted")]
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
    # Every share this library has handed out, before any row goes. An erased library
    # numbers its songs from 1 again, so each open share would come to mean whatever new
    # song took its old id: private songs, opened by people a different song was sent to.
    taken_back = accounts.revoke_shares_for(who.must())
    if taken_back:
        gone.append("%d open share%s" % (taken_back, "" if taken_back == 1 else "s"))
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

    if os.path.isdir(config.blobs_dir()):
        for here, _, names in os.walk(config.blobs_dir()):
            for one in names:
                try:
                    os.remove(os.path.join(here, one))
                except OSError:
                    pass
        gone.append("every file under " + config.blobs_dir())
    try:
        os.remove(config.settings_path())
        gone.append(config.settings_path())
    except OSError:
        pass
    blobs._forget_usage()
    config.ensure_home()
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


# ── bringing a library in ──────────────────────────────────────────────────────────────

#: What an import reads, in the order rows can be made (everything a row points at first).
#: The rest of TAKEN belongs to the machine or account that made it and never comes in.
IMPORTED = ["songs", "song_titles", "albums", "album_songs", "versions", "renders",
            "lyric_sheets", "lyric_revisions", "artwork", "sound_presets", "arrangements",
            "daw_projects", "playlists", "playlist_items", "vocal_takes", "samples"]
#: column -> the table whose new ids it must be rewritten to.
POINTS_AT = {"song_id": "songs", "album_id": "albums", "sheet_id": "lyric_sheets",
             "playlist_id": "playlists", "render_id": "renders", "version_id": "versions",
             "current_version_id": "versions"}
#: The most a library file may be: a guest library with its audio, or a copy taken with it.
MAX_IMPORT = 4 * 1024 ** 3


def bring_in(req):
    """Add the songs, albums, playlists and everything about them from a library file.

    Adds, never replaces: every row gets a new id, and every reference is rewritten to the
    new ids. A row naming audio that is neither in the file nor already here is skipped and
    counted, rather than leaving a render that cannot play.
    """
    length = int(req.headers.get("Content-Length") or 0)
    if length <= 0:
        raise Error("That upload had no file in it.")
    if length > MAX_IMPORT:
        raise Error("That file is bigger than a library file can be.", 413)
    handle, path = tempfile.mkstemp(prefix="jriter-import-", suffix=".zip")
    try:
        with os.fdopen(handle, "wb") as f:
            left = length
            while left > 0:
                chunk = req.rfile.read(min(1 << 20, left))
                if not chunk:
                    break
                f.write(chunk)
                left -= len(chunk)
        try:
            z = zipfile.ZipFile(path)
        except zipfile.BadZipFile:
            raise Error("That isn't a JR!TER library file (it isn't a zip).")
        with z:
            try:
                body = json.loads(z.read("library.json").decode("utf-8"))
            except KeyError:
                raise Error("That zip has no library.json, so it isn't a JR!TER library file.")
            except ValueError:
                raise Error("The library.json in that file is damaged.")
            if body.get("format", FORMAT) != FORMAT or int(body.get("version", 1)) > VERSION:
                raise Error("That library file is from a newer JR!TER than this one. Update first.")
            names = set(z.namelist())
            return _bring_in_tables(body.get("tables") or {}, z, names)
    finally:
        try:
            os.remove(path)
        except OSError:
            pass


def _bring_in_tables(tables, z, names):
    new_ids = {t: {} for t in IMPORTED}
    counts = {"songs": 0, "albums": 0, "playlists": 0, "renders": 0, "lyrics": 0, "missing_audio": 0}
    later = []          # (table, new id, column, old value): references to rows made after

    def have_blob(digest, ext):
        if not digest:
            return True
        if blobs.exists(digest):
            return True
        inside = "audio/%s.%s" % (digest, ext or "bin")
        if inside not in names:
            return False
        stored, _ = blobs.put_bytes(z.read(inside))
        return stored == digest

    for table in IMPORTED:
        if not db.table_exists(table) or table not in tables:
            continue
        have = set(db.columns(table))
        for row in tables[table]:
            if not isinstance(row, dict):
                continue
            blob = BLOB_COLUMNS.get(table)
            if blob and not have_blob(row.get(blob[0]), row.get(blob[1])):
                if table == "albums":
                    row = dict(row, **{blob[0]: None, blob[1]: None})
                else:
                    counts["missing_audio"] += 1
                    continue
            values = {}
            skip = False
            for col, value in row.items():
                if col == "id" or col not in have:
                    continue
                target = POINTS_AT.get(col)
                if target and value is not None:
                    mapped = new_ids.get(target, {}).get(value)
                    if mapped is None:
                        if target == "versions" and table == "songs":
                            later.append((table, None, col, value))
                            continue
                        if col in ("song_id", "sheet_id", "playlist_id") or (col == "album_id" and table == "album_songs"):
                            skip = True          # its owner didn't come in
                            break
                        value = None             # an optional link to something that didn't
                    else:
                        value = mapped
                values[col] = value
            if skip:
                continue
            new_id = db.insert(table, values)
            if "id" in row:
                new_ids[table][row["id"]] = new_id
            for i, (t, nid, c, v) in enumerate(later):
                if t == table and nid is None:
                    later[i] = (t, new_id, c, v)
            counts_key = {"songs": "songs", "albums": "albums", "playlists": "playlists",
                          "versions": "renders", "renders": "renders", "lyric_sheets": "lyrics"}.get(table)
            if counts_key:
                counts[counts_key] += 1
    # A song's current render points at a render made after the song.
    for table, nid, col, old in later:
        mapped = new_ids["versions"].get(old)
        if nid and mapped:
            db.update(table, nid, {col: mapped})
    return counts


def SUMMARY():
    return {"tables": len(TAKEN)}


def ROUTES():
    return {
        ("GET", "/api/export"): take,
        ("GET", "/api/export/erase"): what_erase_takes,
        ("POST", "/api/export/erase"): erase,
        ("POST", "/api/import"): bring_in,
    }
