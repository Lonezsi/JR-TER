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
BLOBS = os.path.join(DATA, "blobs")
DB_PATH = os.path.join(DATA, "jriter.db")
SETTINGS_PATH = os.path.join(DATA, "settings.json")

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
    if os.path.exists(DB_PATH) or not os.path.exists(old):
        return False
    con = sqlite3.connect(old)
    try:
        con.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    finally:
        con.close()
    os.replace(old, DB_PATH)
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
    "sync",
    "updater",
    # What changed, and the note that appears once after an update. Off is a library that
    # still says which version it is and simply never mentions the rest.
    "devlog",
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
}


def _read():
    try:
        with open(SETTINGS_PATH, "r", encoding="utf-8") as f:
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
    ensure_dirs()
    tmp = SETTINGS_PATH + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(current, f, indent=2)
    os.replace(tmp, SETTINGS_PATH)
    return settings()


def ensure_dirs():
    for path in (DATA, BLOBS):
        os.makedirs(path, exist_ok=True)
