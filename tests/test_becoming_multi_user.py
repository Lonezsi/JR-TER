"""The upgrade: one library with one password becomes account 1.

This is the test that protects the library that already exists. Everything else about
accounts is a new feature and can be got wrong twice; this runs once, on somebody's real
music, and a mistake in it is not recoverable by fixing the code afterwards.

Three things have to survive it:

  the songs        the database file moves rather than being recreated, and the blobs and
                   settings go with it
  the password     the salt and hash are carried across, so the password that worked
                   yesterday works today
  the agent        the machine tokens move to the accounts database, because a laptop's
                   agent holds one it cannot re-mint, and a credential that silently stops
                   being recognised is a failure this project has already had once
"""
import os
import time
import json
import sqlite3

import pytest

from jriter import config, db, who, accounts
from jriter.modules import auth


def _old_library(root, songs=3, tokens=1):
    """A library in the shape this project had before accounts: everything flat in data/."""
    os.makedirs(os.path.join(root, "blobs", "ab"), exist_ok=True)
    path = os.path.join(root, "jriter.db")
    con = sqlite3.connect(path)
    con.execute("CREATE TABLE songs (id INTEGER PRIMARY KEY, title TEXT NOT NULL, "
                "created_at REAL NOT NULL, updated_at REAL NOT NULL)")
    for n in range(songs):
        con.execute("INSERT INTO songs (title, created_at, updated_at) VALUES (?, ?, ?)",
                    ("Song %d" % n, time.time(), time.time()))
    con.execute("CREATE TABLE auth_tokens (id INTEGER PRIMARY KEY, name TEXT NOT NULL, "
                "digest TEXT NOT NULL, scope TEXT NOT NULL, created_at REAL NOT NULL, "
                "last_used REAL NOT NULL DEFAULT 0)")
    for n in range(tokens):
        con.execute("INSERT INTO auth_tokens (name, digest, scope, created_at) "
                    "VALUES (?, ?, ?, ?)",
                    ("a laptop %d" % n, "digest-%d" % n, "upload", time.time()))
    con.commit()
    con.close()

    # A blob, so the move can be seen to have taken the audio with it.
    with open(os.path.join(root, "blobs", "ab", "some-audio"), "wb") as f:
        f.write(b"pretend this is a render")
    with open(os.path.join(root, "settings.json"), "w", encoding="utf-8") as f:
        json.dump({"library_name": "Hedda's tapes", "accent": "#54B37A"}, f)
    return path


@pytest.fixture
def before(tmp_path, monkeypatch):
    """A pre accounts library on disk, and no accounts database yet."""
    root = tmp_path / "old"
    root.mkdir()
    monkeypatch.setattr(config, "DATA", str(root))
    db.close()
    accounts.reset_for_tests()
    _old_library(str(root))
    # The password as auth.py used to keep it.
    who.bind(accounts.OWNER)
    auth.set_password("the password they have always used")
    who.unbind()
    return str(root)


def _move(root):
    who.unbind()
    landed = accounts.adopt_single_library(auth._read())
    who.bind(accounts.OWNER)
    return landed


def test_the_library_becomes_account_one(before):
    landed = _move(before)
    assert landed and landed["account"] == accounts.OWNER

    with who.acting_as(accounts.OWNER):
        titles = [r["title"] for r in db.query("SELECT title FROM songs ORDER BY id")]
    assert titles == ["Song 0", "Song 1", "Song 2"], "the songs did not come across"


def test_the_files_move_rather_than_being_left_behind(before):
    _move(before)
    home = config.home(accounts.OWNER)
    for name in ("jriter.db", "settings.json"):
        assert os.path.exists(os.path.join(home, name)), "%s did not move" % name
        assert not os.path.exists(os.path.join(before, name)), \
            "%s was left lying in the old place as well" % name
    assert os.path.isfile(os.path.join(home, "blobs", "ab", "some-audio")), \
        "the audio did not move"


def test_the_settings_move_with_it(before):
    _move(before)
    with who.acting_as(accounts.OWNER):
        assert config.settings()["library_name"] == "Hedda's tapes"


def test_the_password_still_works(before):
    """The one that matters most. Getting this wrong locks somebody out of their own
    library on the morning they update, with no way back that does not involve editing
    a database by hand."""
    _move(before)
    owner = accounts.owner()
    assert owner is not None
    assert accounts.check(owner, "the password they have always used")
    assert not accounts.check(owner, "something else")


def test_the_agents_credential_still_works(before):
    """A laptop's agent holds a token it cannot re-mint by itself.

    This project has already had one outage from a credential that quietly stopped being
    recognised: the watch loop swallows a 401 and goes on pushing nothing, for ever.
    """
    _move(before)
    carried = accounts.tokens_of(accounts.OWNER)
    assert [t["name"] for t in carried] == ["a laptop 0"]
    assert accounts.token_for("digest-0")["account_id"] == accounts.OWNER


def test_it_does_not_run_twice(before):
    """The second call must find the work done and do nothing, not move an empty library
    over a full one."""
    first = _move(before)
    assert first
    again = accounts.adopt_single_library(auth._read())
    assert again is None, "it moved a second time"

    with who.acting_as(accounts.OWNER):
        assert len(db.query("SELECT id FROM songs")) == 3


def test_a_library_with_no_password_is_left_alone(tmp_path, monkeypatch):
    """A local only install has no door and therefore nothing to make an account from.

    Inventing a password here would be choosing somebody's credential for them, and
    creating an account with no password would be worse.
    """
    root = tmp_path / "nodoor"
    root.mkdir()
    monkeypatch.setattr(config, "DATA", str(root))
    db.close()
    accounts.reset_for_tests()
    _old_library(str(root))

    who.unbind()
    assert accounts.adopt_single_library({}) is None
    assert accounts.count() == 0
    assert os.path.exists(os.path.join(str(root), "jriter.db")), \
        "it moved a library it had decided not to adopt"
    who.bind(accounts.OWNER)


def test_a_fresh_install_has_nothing_to_move(tmp_path, monkeypatch):
    root = tmp_path / "fresh"
    root.mkdir()
    monkeypatch.setattr(config, "DATA", str(root))
    db.close()
    accounts.reset_for_tests()
    who.unbind()
    assert accounts.adopt_single_library({"hash": "x", "salt": "y"}) is None
    who.bind(accounts.OWNER)


def test_a_cookie_from_before_the_move_still_works(before):
    """Signing everybody out on the morning of an update looks like a bug rather than
    like an upgrade."""
    import hmac
    import hashlib
    issued = str(int(time.time()))
    nonce = "0123456789abcdef"
    body = "%s.%s" % (issued, nonce)
    old = "%s.%s" % (body, hmac.new(auth._secret(), body.encode(),
                                    hashlib.sha256).hexdigest()[:32])
    _move(before)
    assert auth.whose(old) == accounts.OWNER
