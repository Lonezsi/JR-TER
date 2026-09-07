"""Taking a copy, and getting rid of it.

The privacy notice points at these rather than describing what could in principle be
arranged, so if they stop working the notice becomes untrue. That is what these are for.
"""
import io
import json
import os
import zipfile

import pytest

from jriter import config, db
from jriter.modules import export


def _zip(server):
    status, raw = server.get("/api/export")
    assert status == 200
    assert isinstance(raw, bytes), raw
    return zipfile.ZipFile(io.BytesIO(raw))


def test_every_table_is_decided_about():
    """The safety property of the whole file.

    A list of what to hide is wrong the day somebody adds a table, and nobody re-reads an
    export to notice. So every table is in exactly one of the two lists, and adding one
    fails here until a person has decided which.
    """
    db.connect()
    here = {row["name"] for row in db.query(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")}
    decided = set(export.TAKEN) | set(export.SKIPPED)
    undecided = here - decided
    assert not undecided, (
        "these tables are in neither export.TAKEN nor export.SKIPPED, so nobody has "
        "decided whether a copy of the library should contain them: %s" % sorted(undecided))


def test_the_copy_never_carries_anything_that_opens_the_door(server, wav):
    """The one thing this must never get wrong.

    Checked against the real stored values rather than against column names, because a
    credential that moved to a differently named column would still be a credential.

    The door is switched on here and nowhere else in this file, and take() is called
    rather than fetched: with auth loaded every request needs a session, and signing one
    in would test the door instead of the copy. What is being proved is about the bytes
    that come out, so the bytes are what this reads.
    """
    from jriter import registry
    from jriter.wire import Response

    status, made = server.post("/api/songs", {"title": "In the copy"})
    assert status == 200

    registry.load(config.MODULES)          # conftest puts it back afterwards
    from jriter.modules import auth
    auth.set_password("a password for the test")
    auth.make_token("a machine", "upload")

    from jriter import accounts
    held = auth._read()
    secrets = [held.get("hash"), held.get("salt"), held.get("secret")]
    # Out of the accounts database rather than the library. Tokens moved there when there
    # started being more than one library, which means a copy of a library cannot carry a
    # credential even by accident: there is no longer one in it to carry.
    secrets += [row["digest"] for row in accounts._query("SELECT digest FROM tokens")]
    owner = accounts.owner()
    if owner:
        secrets += [owner["hash"], owner["salt"], owner["secret"]]
    secrets = [x for x in secrets if x]
    secrets = [s for s in secrets if s]
    assert len(secrets) >= 4, "nothing secret existed, so this test proved nothing"

    answer = export.take(None)
    assert isinstance(answer, Response)
    inside = zipfile.ZipFile(answer.path)
    everything = b"".join(inside.read(name) for name in inside.namelist()).decode(
        "utf-8", "ignore")
    for secret in secrets:
        assert secret not in everything, "a credential is in the copy"

    # And there is no token table in the copy at all now, which is the stronger version
    # of what this test was checking. A library used to hold its own machine credentials
    # and the export had to be careful to leave the digest column behind; they live in the
    # accounts database now, which is never part of a library's copy.
    library = json.loads(inside.read("library.json").decode("utf-8"))
    assert "auth_tokens" not in library["tables"]


def test_the_copy_says_inside_itself_what_is_missing(server, wav):
    """Whoever opens this in six months will not have the page that offered it, so the
    one honest claim it makes about the audio has to travel with the file."""
    server.upload("/api/renders", wav(), filename="something.wav")
    inside = _zip(server)
    assert sorted(inside.namelist()) == ["README.txt", "library.json", "settings.json"]

    note = inside.read("README.txt").decode("utf-8")
    assert "data/blobs" in note and "digest" in note
    assert "not in here" in note.lower()

    library = json.loads(inside.read("library.json").decode("utf-8"))
    renders = library["tables"]["renders"]
    assert renders and renders[0]["digest"], "a render with no digest cannot be followed"
    # The waveform is not in it: a hundred and twenty numbers a row, drawn by nothing here.
    assert "peaks" not in renders[0]


def test_a_module_that_is_off_contributes_nothing(server, monkeypatch):
    """Rather than an empty list, which reads as "you have none" instead of "that feature
    is not switched on"."""
    monkeypatch.setattr(db, "table_exists", lambda name: name != "youtube_posts")
    library = json.loads(_zip(server).read("library.json").decode("utf-8"))
    assert "youtube_posts" not in library["tables"]
    assert "songs" in library["tables"]


def test_erase_says_what_it_will_take_before_it_takes_it(server, wav):
    server.upload("/api/renders", wav(), filename="doomed.wav")
    status, said = server.get("/api/export/erase")
    assert status == 200
    paths = [g["path"] for g in said["goes"]]
    assert any(p.endswith("jriter.db") for p in paths)
    assert any(g["bytes"] > 0 for g in said["goes"]), "it claims to remove nothing"
    # And how each one goes, because the database file is still on disk afterwards
    # holding nothing, and a page that said "deleted" beside it would read as a lie.
    assert all(g["how"] for g in said["goes"])
    db_row = [g for g in said["goes"] if g["path"].endswith("jriter.db")][0]
    assert "row" in db_row["how"]


def test_erase_needs_the_name_typed(server):
    status, said = server.post("/api/export/erase", {"confirm": "yes"})
    assert status == 400
    assert "Type the library's name" in said["error"]


def test_erase_removes_the_library_and_says_what_it_could_not(server, wav):
    server.post("/api/songs", {"title": "Briefly"})
    server.upload("/api/renders", wav(), filename="briefly.wav")
    name = config.settings().get("library_name")

    status, said = server.post("/api/export/erase", {"confirm": name})
    assert status == 200, said
    # The rows, not the file: see the comment in erase about what os.remove does on
    # Windows while other threads hold the database open.
    assert db.query("SELECT * FROM songs") == []
    assert not any(names for _, _, names in os.walk(config.blobs_dir())), "the audio is still there"

    # The three things it cannot reach are named rather than left to be discovered.
    left = " ".join(said["left"]).lower()
    assert "password" in left
    assert "google" in left and "revok" in left
    assert "agent" in left


def test_the_copy_arrives_as_a_named_file_and_leaves_nothing_behind(server, wav):
    """Two things the body of the zip cannot tell you, so nothing was checking either.

    The first version set a Content-Disposition of its own, which the HTTP layer drops
    because it builds that header itself from headers["download"], so the zip arrived with
    no filename. And nothing ever removed the temporary file it is built on, which left a
    complete copy of the library in the temporary directory after every press of a button
    whose whole subject is where your data is.
    """
    import glob
    import tempfile
    import time
    import urllib.request

    server.upload("/api/renders", wav(), filename="named.wav")
    before = set(glob.glob(os.path.join(tempfile.gettempdir(), "jriter-export-*")))

    with urllib.request.urlopen(server.base + "/api/export", timeout=30) as answer:
        assert answer.status == 200
        said = answer.headers.get("Content-Disposition") or ""
        raw = answer.read()
    assert "attachment" in said and said.endswith('.zip"'), said
    # Never held. It was served immutable for a day, so a second Take a copy after adding
    # a song handed back the older zip from the browser's cache without asking the server,
    # and the temporary file that cache entry named had already been removed.
    assert "no-store" in (answer.headers.get("Cache-Control") or "")
    assert zipfile.ZipFile(io.BytesIO(raw)).read("library.json")

    # Given a moment, because the removal is in the handler's finally and therefore runs
    # after the last byte is on the wire. The client can be back here before the server has
    # let go of the file, which is a race this test lost about once in four hundred and not
    # a leak: what matters is that the copy does not survive, not that it is gone before
    # the reader blinks.
    for _ in range(50):
        after = set(glob.glob(os.path.join(tempfile.gettempdir(), "jriter-export-*")))
        if not (after - before):
            break
        time.sleep(0.02)
    assert not (after - before), "a copy of the library was left in %s" % tempfile.gettempdir()
