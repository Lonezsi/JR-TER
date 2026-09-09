"""Putting a sound into a sample library from the browser.

This is the only thing in JR!TER that writes into a watched folder. Everything else about
them reads, which is why the checks are the substance of this endpoint rather than trim,
and why they get more tests than the happy path does.

The name is the dangerous part. It arrives in a header, percent encoded by the browser,
and it becomes a file on somebody's disk, so it is decoded first and then taken apart, in
that order. Sanitising before decoding would sanitise the wrong string, because %2F is a
separator that has not arrived yet.
"""
import struct

#: A counter, so two wavs in one test are two different files.
_made = [0]


def _wav(tmp_path, frames=80):
    """A real, tiny wav on disk. Not bytes with a name on them.

    The test client uploads from a path, so this hands back one. frames changes the
    contents, which is how a test tells one upload from another after the fact.
    """
    body = b"\x01\x00" * frames
    blob = (b"RIFF" + struct.pack("<I", 36 + len(body)) + b"WAVEfmt "
            + struct.pack("<IHHIIHH", 16, 1, 1, 8000, 16000, 2, 16)
            + b"data" + struct.pack("<I", len(body)) + body)
    _made[0] += 1
    path = tmp_path / ("source-%d.wav" % _made[0])
    path.write_bytes(blob)
    return str(path)


def _library(server, tmp_path, name="samples"):
    folder = tmp_path / name
    folder.mkdir()
    status, made = server.post("/api/sync/folders",
                               {"path": str(folder), "kind": "sync"})
    assert status == 200, made
    return (made.get("folder") or made)["id"], folder


def test_a_sound_goes_into_the_library(server, tmp_path):
    """The whole point, and the name survives the round trip intact."""
    folder_id, folder = _library(server, tmp_path)
    status, out = server.upload("/api/sync/folders/%d/upload" % folder_id,
                                _wav(tmp_path), filename="my kick #1.wav")
    assert status == 200, out
    assert out["added"] == "my kick #1.wav", (
        "the name came back as %r. The browser percent encodes it, so a handler that does"
        " not decode writes 'my kick %%231.wav' onto the disk." % out["added"])
    landed = folder / "my kick #1.wav"
    assert landed.is_file(), "nothing was written"
    assert landed.read_bytes()[:4] == b"RIFF", "the bytes changed on the way in"


def test_a_name_that_climbs_out_of_the_folder_does_not(server, tmp_path):
    """Traversal is defanged rather than refused, and the file stays inside.

    Four spellings. Two because a name is read on a machine that treats only one of them
    as a separator, one because it only becomes a separator after decoding, and one
    absolute. What is asserted is not that the request fails: it is that nothing is
    written outside the folder, which is the thing that actually matters.
    """
    folder_id, folder = _library(server, tmp_path)
    outside = tmp_path / "escaped.wav"

    for name in ("../../escaped.wav", "..\\..\\escaped.wav",
                 "..%2F..%2Fescaped.wav", "/etc/escaped.wav"):
        status, out = server.upload("/api/sync/folders/%d/upload" % folder_id,
                                    _wav(tmp_path), filename=name)
        assert status == 200, "%r was refused rather than cleaned: %s" % (name, out)
        assert not outside.exists(), (
            "%r wrote outside the library, to %s" % (name, outside))
        written = folder / out["added"]
        assert written.is_file(), "%r reported %r and wrote nothing" % (name, out["added"])
        assert written.parent == folder, (
            "%r landed in %s rather than the library" % (name, written.parent))

    assert not outside.exists()
    for child in folder.iterdir():
        assert child.parent == folder, "%s is not inside the library" % child


def test_a_collector_will_not_take_one(server, tmp_path):
    """The two kinds of folder exist to keep one shots out of the render list.

    Anything landing in a collector is offered as a new render, so a folder of samples
    dropped into one becomes five thousand candidate bounces, which is the mistake the
    split was made to prevent.
    """
    folder = tmp_path / "bounces"
    folder.mkdir()
    status, made = server.post("/api/sync/folders",
                               {"path": str(folder), "kind": "collector"})
    assert status == 200, made
    collector = (made.get("folder") or made)["id"]

    status, out = server.upload("/api/sync/folders/%d/upload" % collector,
                                _wav(tmp_path), filename="kick.wav")
    assert status == 400, "a collector accepted a sample upload: %s" % out
    assert not list(folder.iterdir()), "it was refused and written anyway"


def test_only_sound_files(server, tmp_path):
    """The extension is checked after the name is cleaned, not before it."""
    folder_id, folder = _library(server, tmp_path)
    for name in ("payload.exe", "notes.txt", "nameless", "cover.png"):
        status, out = server.upload("/api/sync/folders/%d/upload" % folder_id,
                                    _wav(tmp_path), filename=name)
        assert status >= 400, "%r was accepted into a sample library: %s" % (name, out)
    assert not list(folder.iterdir()), "something refused was written anyway"


def test_a_name_already_taken_is_not_overwritten(server, tmp_path):
    """A sample library is a collection somebody else assembled.

    Adding to it is what this endpoint is for. Quietly replacing something in it is not.
    """
    folder_id, folder = _library(server, tmp_path)
    first_path = _wav(tmp_path, 80)
    second_path = _wav(tmp_path, 160)
    first = open(first_path, "rb").read()
    second = open(second_path, "rb").read()

    server.upload("/api/sync/folders/%d/upload" % folder_id, first_path,
                  filename="kick.wav")
    status, out = server.upload("/api/sync/folders/%d/upload" % folder_id, second_path,
                                filename="kick.wav")
    assert status == 200, out
    assert out["added"] != "kick.wav", "the second upload replaced the first"
    assert (folder / "kick.wav").read_bytes() == first, \
        "the file that was already there changed"
    assert (folder / out["added"]).read_bytes() == second


def test_a_folder_that_is_gone_says_so(server, tmp_path):
    """The path is stored, so it can stop being a folder between one visit and the next."""
    folder_id, folder = _library(server, tmp_path)
    for child in folder.iterdir():
        child.unlink()
    folder.rmdir()
    status, out = server.upload("/api/sync/folders/%d/upload" % folder_id,
                                _wav(tmp_path), filename="kick.wav")
    assert status == 409, "expected a plain answer about the missing folder, got %s" % out
