"""Carrying a library across from the old name.

This project used to be called J-ong. Everything in here is a place where that name has
data behind it, and where renaming without a way across loses the data silently rather
than loudly. Silently is the whole problem: sqlite makes a missing database rather than
complaining, an agent shut out of the library swallows its own 401, and a browser signed
out just looks like a browser that was signed out.
"""
import os
import sqlite3

import pytest

from jriter import config
from jriter.modules import auth


#: Writes a WAL library and then waits to be killed, so the log is left behind.
#
# Closing a connection checkpoints it, which empties the log and would make these tests
# pass against a version that does not checkpoint at all. The only honest way to leave a
# real -wal is to stop the writer without letting it close, which is also exactly how it
# happens on the host: the watchdog kills a server that has missed two health probes.
_WRITER = """
import sqlite3, sys, time
con = sqlite3.connect(sys.argv[1])
con.execute("PRAGMA journal_mode=WAL")
con.execute("PRAGMA synchronous=NORMAL")
con.execute("CREATE TABLE IF NOT EXISTS songs (id INTEGER PRIMARY KEY, title TEXT)")
con.commit()
for n in range(int(sys.argv[2])):
    con.execute("INSERT INTO songs (title) VALUES (?)", ("Song %d" % n,))
con.commit()
print("written", flush=True)
time.sleep(60)
"""


def _old_library(where, songs=3):
    """A pre-rename library: a jong.db whose rows are still only in the log.

    That last part is the point. db.py runs with synchronous NORMAL, so on a busy library
    the database file stays small and nearly everything lives in the -wal until something
    checkpoints. The library this was written against was four kilobytes of database and
    three and a third megabytes of log.
    """
    import subprocess
    import sys

    path = os.path.join(where, "jong.db")
    writer = subprocess.Popen([sys.executable, "-c", _WRITER, path, str(songs)],
                              stdout=subprocess.PIPE, text=True)
    try:
        assert writer.stdout.readline().strip() == "written", "the writer never got going"
        assert os.path.exists(path + "-wal"), "no log was left to carry"
    finally:
        writer.kill()
        writer.wait(timeout=10)
    assert os.path.exists(path + "-wal"), "the log went when the writer did"
    return path


def test_the_old_library_is_carried_across_whole(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "DATA", str(tmp_path))
    monkeypatch.setattr(config, "DB_PATH", os.path.join(str(tmp_path), "jriter.db"))
    _old_library(str(tmp_path), songs=3)

    assert config.adopt_old_database() is True

    con = sqlite3.connect(config.DB_PATH)
    assert con.execute("SELECT COUNT(*) FROM songs").fetchone()[0] == 3, \
        "the rows that were only in the write ahead log did not come across"
    con.close()
    left = [n for n in os.listdir(str(tmp_path)) if n.startswith("jong.db")]
    assert left == [], "the old files were left lying beside the new one: %s" % left


def test_it_does_not_run_twice(tmp_path, monkeypatch):
    """The second call must decline, or a later jong.db from a backup would overwrite a
    library that has been in use for weeks."""
    monkeypatch.setattr(config, "DATA", str(tmp_path))
    monkeypatch.setattr(config, "DB_PATH", os.path.join(str(tmp_path), "jriter.db"))
    _old_library(str(tmp_path))

    assert config.adopt_old_database() is True
    assert config.adopt_old_database() is False


def test_it_never_overwrites_a_library_that_is_already_here(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "DATA", str(tmp_path))
    monkeypatch.setattr(config, "DB_PATH", os.path.join(str(tmp_path), "jriter.db"))
    _old_library(str(tmp_path))
    with open(config.DB_PATH, "w", encoding="utf-8") as f:
        f.write("a real library, in use")

    assert config.adopt_old_database() is False
    with open(config.DB_PATH, encoding="utf-8") as f:
        assert f.read() == "a real library, in use"


def test_a_move_that_fails_says_so_instead_of_claiming_success(tmp_path, monkeypatch):
    """The bug this whole file exists for.

    The first version of this swallowed the error and returned True. The server then
    carried on, sqlite made a fresh empty database under the new name, and the guard on
    the first line made sure it would never try again: every song gone, every blob still
    on disk, nothing said. An exception here stops the server starting, which is the
    right outcome, so what is checked is that it is raised rather than eaten.
    """
    monkeypatch.setattr(config, "DATA", str(tmp_path))
    monkeypatch.setattr(config, "DB_PATH", os.path.join(str(tmp_path), "jriter.db"))
    _old_library(str(tmp_path))

    def refuse(*args, **kwargs):
        raise OSError(13, "the file is open somewhere else")

    monkeypatch.setattr(os, "replace", refuse)
    with pytest.raises(OSError):
        config.adopt_old_database()
    assert not os.path.exists(config.DB_PATH), \
        "an empty library was left behind by a move that did not happen"


def test_a_library_still_called_by_the_old_name_is_renamed(tmp_path, monkeypatch):
    """The rail and the browser tab read the saved name, not the default, so without
    this the rename lands everywhere except the two places anybody looks."""
    monkeypatch.setattr(config, "DATA", str(tmp_path))
    monkeypatch.setattr(config, "SETTINGS_PATH", os.path.join(str(tmp_path), "settings.json"))
    config.save_settings({"library_name": "J-ong", "accent": "#54B37A"})

    config.adopt_old_name()
    assert config.settings()["library_name"] == "JR!TER"
    assert config.settings()["accent"] == "#54B37A", "it rewrote more than the name"


def test_a_library_somebody_named_keeps_its_name(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "DATA", str(tmp_path))
    monkeypatch.setattr(config, "SETTINGS_PATH", os.path.join(str(tmp_path), "settings.json"))
    config.save_settings({"library_name": "Hedda's tapes"})

    config.adopt_old_name()
    assert config.settings()["library_name"] == "Hedda's tapes"


def test_the_token_salt_still_says_the_old_name():
    """Not a tidy-up.

    The prefix is mixed into the stored digest of every token ever minted. Renaming it
    invalidates all of them at once, and the agent that stops being allowed in never
    says so: the watch loop swallows the 401 and goes on pushing nothing, for ever.
    """
    import hashlib
    expected = hashlib.sha256(b"jong-token:abc123").hexdigest()
    assert auth._token_digest("abc123") == expected


def test_a_cookie_issued_under_the_old_name_still_signs_you_in():
    """Renaming the cookie signs every browser out on the morning the rename lands,
    which looks like a bug rather than like a rename."""
    assert auth.LEGACY_COOKIE == "jong_session"
    assert auth.COOKIE != auth.LEGACY_COOKIE


def test_the_old_upload_header_is_still_accepted():
    """A laptop's agent updates itself from a daily task, so a new server meeting an
    older client is the ordinary state of things for a day and longer if it was off."""
    import inspect
    source = inspect.getsource(auth.token_allows)
    assert "X-Jriter-Token" in source and "X-Jong-Token" in source


@pytest.mark.parametrize("old, new", [("JONG_DATA", "JRITER_DATA"),
                                      ("JONG_HOST", "JRITER_HOST"),
                                      ("JONG_PORT", "JRITER_PORT")])
def test_the_old_environment_variables_are_still_read(old, new):
    """JONG_HOST is the one that bites the host machine: the start script sets it, the
    script is updated by a git pull, and a new server meeting an older copy of it has to
    still bind every interface or the funnel forwards to nothing."""
    import inspect
    source = inspect.getsource(config)
    assert old in source and new in source
