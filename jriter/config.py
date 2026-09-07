"""Where things live, and which features are switched on.

Everything JR!TER can do is a module, and this file is the list. Comment a name out and
that feature is gone: its tables stop being created, its routes stop existing, and the
web UI stops drawing it, because the UI asks the server what is enabled rather than
assuming. That is the whole swappability story and it is deliberately this boring.
"""
import os
import sqlite3
import json

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WEB = os.path.join(BASE, "web")

# Everything the user owns lives under one directory, so a backup is one copy.
#
# The JONG_ names are still read. A library moved somewhere else lives entirely behind
# that one variable, and dropping it would not raise anything: the server would quietly
# build a fresh empty library in the checkout and every song would look deleted. The
# host script is the other reason: it sets the HOST variable, it is updated by a git
# pull, and a new server meeting an older copy of that script must still bind 0.0.0.0
# or the funnel forwards to nothing.
DATA = (os.environ.get("JRITER_DATA") or os.environ.get("JONG_DATA")
        or os.path.join(BASE, "data"))

# ── one directory per person ─────────────────────────────────────────────────
#
# JR!TER used to be one library with one password, so there was one database file and one
# blob directory and nothing ever had to ask whose they were. It now has an account per
# person, and the way those are kept apart is that each one gets its own files:
#
#     data/
#       accounts.db              who exists, and what has been shared with whom
#       auth.json                the server's own signing secret
#       accounts/
#         1/  jriter.db  blobs/  settings.json  appearance/  youtube.json
#         2/  jriter.db  blobs/  settings.json  ...
#
# The alternative was an account_id column on all nineteen tables and a WHERE clause at
# each of the hundred and ninety two places this code talks to SQLite. One missed clause
# there does not crash and does not show up as a wrong number on a page: it is one person
# quietly reading another person's library, for as long as nobody notices. Separate files
# cannot fail that way, because a query written with no thought for accounts at all still
# cannot reach rows that are not in the file it opened.
#
# These are functions and not constants, and the constants they replace are deliberately
# gone rather than kept as aliases. Anything still reaching for config.BLOBS now raises
# AttributeError instead of quietly reading whichever library happened to be first.


def home(account=None):
    """The directory holding one account's library."""
    from . import who
    return os.path.join(DATA, "accounts", str(account if account is not None else who.must()))


def db_path(account=None):
    return os.path.join(home(account), "jriter.db")


def blobs_dir(account=None):
    return os.path.join(home(account), "blobs")


def settings_path(account=None):
    return os.path.join(home(account), "settings.json")


def accounts_db():
    """The one database that is not anybody's library: who exists, and who shared what."""
    return os.path.join(DATA, "accounts.db")


def ensure_home(account=None):
    """Make an account's directory and its blob store."""
    where = home(account)
    os.makedirs(os.path.join(where, "blobs"), exist_ok=True)
    return where

HOST = os.environ.get("JRITER_HOST") or os.environ.get("JONG_HOST") or "127.0.0.1"
PORT = int(os.environ.get("JRITER_PORT") or os.environ.get("JONG_PORT") or "7900")


def adopt_old_database():
    """Move a pre-rename jong.db across, once.

    sqlite3.connect creates a file rather than complaining, so without this the rename
    would have opened an empty library next to a full one: no error, no missing file,
    just every song gone and every blob still sitting on disk. Only ever when there is
    nothing at the new name, so this can never overwrite a real library.

    The log is folded in first, so there is exactly one file to move. synchronous is
    NORMAL, which means most of a busy library can be sitting in the -wal rather than in
    the database: on the library this was written against it was four kilobytes of
    database and three and a third megabytes of log. Moving the two separately leaves a
    window where one arrived and the other did not, and a -wal stranded under the old
    name holds the newest thing anybody did.

    Nothing here is caught. A move that fails has to stop the server starting, because
    the alternative is what actually happened the first time this was written: the error
    was swallowed, the function said it had moved the library, sqlite made a fresh empty
    one under the new name, and the guard on the first line then made sure it would never
    try again. An empty library that says it is fine is worse than a server that will not
    start.
    """
    old = os.path.join(DATA, "jong.db")
    # Both of these are the old flat layout, on purpose. This runs before accounts exist
    # and its whole job is to leave one file called jriter.db where accounts.py will find
    # it a moment later and move it into accounts/1/.
    new_name = os.path.join(DATA, "jriter.db")
    if os.path.exists(new_name) or not os.path.exists(old):
        return False
    con = sqlite3.connect(old)
    try:
        con.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    finally:
        con.close()
    os.replace(old, new_name)
    # Both are scratch: the log has just been folded in, and -shm is rebuilt on the next
    # open. Left behind they are only clutter, so they go, but not at the cost of the move.
    for leftover in (old + "-wal", old + "-shm"):
        try:
            os.remove(leftover)
        except OSError:
            pass
    return True

# Order matters only where one module's tables reference another's.
MODULES = [
    "core",
    # Take this out and the library has no door at all, which is what you want when it
    # only ever listens on localhost.
    "auth",
    "appearance",
    "songs",
    "versions",
    "artwork",
    "lyrics",
    "albums",
    "sound",
    "arrange",
    # On, because "which render is the one that is actually online" turned out to be a
    # real question. JR!TER still does not push the file to YouTube: it opens the upload
    # page with the render ready to hand and keeps the link against the version.
    "youtube",
    "renders",
    "playlists",
    # The one box that finds everything. Off is a library with no search box at all
    # rather than one that half works: the box is drawn from /api/state like every other
    # feature. /api/songs?q= is unaffected, so the desktop client still matches
    # filenames against titles.
    "search",
    "sync",
    # A copy of the library as text, and getting rid of it. Off is a library with no way
    # to take one out, which the privacy notice would then be wrong about.
    "export",
    "updater",
    # What changed, and the note that appears once after an update. Off is a library that
    # still says which version it is and simply never mentions the rest.
    "devlog",
    # Letting a friend work on one of your songs. Off is a server where everybody still
    # has their own library and nobody can show anybody anything.
    "sharing",
]

# The repository JR!TER updates itself from. JR-TER, not JR!TER: GitHub allows only
# letters, digits, dots, hyphens and underscores in a repository name.
REPO = os.environ.get("JRITER_REPO", "Lonezsi/JR-TER")
BRANCH = os.environ.get("JRITER_BRANCH", "main")

AUDIO_EXT = (".mp3", ".wav", ".flac", ".m4a", ".aac", ".ogg", ".opus")
IMAGE_EXT = (".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif")

_DEFAULTS = {
    "library_name": "JR!TER",
    "accent": "#54B37A",
    "auto_update": True,
    "sync_interval_minutes": 5,
    # Two dials, nought to a hundred, for the two things on this page that are taste
    # rather than function. Nought is off in both cases and is a real answer: a machine
    # that struggles with either has one place to turn it off, and reduced motion and
    # reduced transparency still override both whatever these say.
    # A hundred is what the dial used to top out at, and it is the default now. Both of
    # these reach two hundred.
    "dust": 100,
    # Shown as "Chromatic aberration". The key keeps its old name because it is what
    # every settings.json already on disk calls it, and a rename buys a migration for a
    # word only this file ever reads.
    #
    # A hundred is what the dial used to top out at, and it is the default now: the dial
    # goes to two hundred so there is somewhere to go past it.
    "glass_edge": 100,
    # Per pixel noise over everything, to break up the steps a 22px blur leaves in a
    # smooth gradient. Nought is off. Sixty rather than something modest, because a
    # blurred photograph behind glass bands far worse than a synthetic ramp does and the
    # amount that fixes it is the amount that fixes it.
    "dither": 60,
    # Empty unless the machine hides it somewhere jriter/video.py does not look. A path
    # rather than a switch, because ffmpeg is not a dependency: it is a program you
    # install, and the only thing JR!TER needs from you is where it went.
    "ffmpeg_path": "",
}


def _read():
    try:
        with open(settings_path(), "r", encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def settings():
    """User settings, with defaults filled in for anything never set."""
    out = dict(_DEFAULTS)
    out.update(_read())
    return out


def adopt_old_name():
    """An existing settings.json holds the old default, and the rail reads that, not the
    dictionary above.

    Without this the rename lands everywhere except the two places anyone actually
    looks: the browser tab and the top of the rail. Only the untouched default is
    rewritten, so a library somebody has deliberately named keeps its name.
    """
    if _read().get("library_name") == "J-ong":
        save_settings({"library_name": "JR!TER"})


def save_settings(patch):
    current = _read()
    current.update(patch)
    ensure_home()
    path = settings_path()
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(current, f, indent=2)
    os.replace(tmp, path)
    return settings()


def ensure_dirs():
    """The global directory only.

    Called once on the way up, before anybody has signed in and therefore before there is
    an account whose directory could be made. Per account directories are ensure_home.
    """
    os.makedirs(os.path.join(DATA, "accounts"), exist_ok=True)
