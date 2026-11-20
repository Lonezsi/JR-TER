"""The grave: a deleted thing waits there for a while and comes back whole.

The manifesto's point 10: undo covers the moment after a delete, the grave covers the
month. Bringing something back has to be the same thing back, with its links (an album
that held the song) pointing at it again, and its audio still there.
"""
import os

from jriter import blobs


def _song(server, wav, title="Into the grave"):
    status, made = server.post("/api/songs", {"title": title})
    assert status == 200, made
    sid = made["song"]["id"] if "song" in made else made["id"]
    status, up = server.upload("/api/songs/%d/versions" % sid, wav(seconds=1.0, level=0.37))
    assert status == 200, up
    _, sheet = server.post("/api/songs/%d/lyrics" % sid, {"name": "Main"})
    sheet_id = (sheet.get("sheet") or sheet)["id"]
    server.put("/api/lyrics/%d/text" % sheet_id, {"text": "the words that come back"})
    return sid


def test_a_deleted_song_comes_back_whole(server, wav):
    sid = _song(server, wav)
    status, album = server.post("/api/albums", {"title": "Holding it"})
    aid = (album.get("album") or album)["id"]
    server.post("/api/albums/%d/songs" % aid, {"song_id": sid})

    status, _ = server.delete("/api/songs/%d" % sid)
    assert status == 200
    status, _ = server.get("/api/songs/%d" % sid)
    assert status == 404

    _, grave = server.get("/api/grave")
    item = next(i for i in grave["items"] if i["kind"] == "song")
    assert item["title"] == "Into the grave" and grave["keep_days"] >= 7

    status, back = server.post("/api/grave/%d/restore" % item["id"])
    assert status == 200, back
    status, song = server.get("/api/songs/%d" % sid)
    assert status == 200, "it comes back with the id it had"
    _, versions = server.get("/api/songs/%d/versions" % sid)
    assert versions.get("versions", versions), "with its renders"
    _, sheets = server.get("/api/songs/%d/lyrics" % sid)
    assert "the words that come back" in str(sheets)
    _, held = server.get("/api/albums/%d" % aid)
    assert sid in [s["id"] for s in held.get("songs", [])], "and back on the album that held it"
    _, grave = server.get("/api/grave")
    assert not grave["items"], "brought back means out of the grave"


def test_audio_waits_in_the_grave(server, wav):
    sid = _song(server, wav, "Quiet one")
    _, versions = server.get("/api/songs/%d/versions" % sid)
    v = versions.get("versions", versions)[0]
    server.delete("/api/versions/%d" % v["id"])
    assert os.path.isfile(blobs.path_for(v["digest"])), "the file stays while it's in the grave"
    _, grave = server.get("/api/grave")
    item = next(i for i in grave["items"] if i["kind"] == "version")
    server.post("/api/grave/%d/restore" % item["id"])
    _, versions = server.get("/api/songs/%d/versions" % sid)
    assert [x["id"] for x in versions.get("versions", versions)] == [v["id"]]


def test_emptying_is_for_good(server, wav):
    sid = _song(server, wav, "Gone for good")
    server.delete("/api/songs/%d" % sid)
    _, grave = server.get("/api/grave")
    assert grave["items"]
    status, said = server.delete("/api/grave")
    assert status == 200 and said["forgotten"] >= 1
    _, grave = server.get("/api/grave")
    assert not grave["items"]
