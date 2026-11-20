"""A library file goes out and comes back in with nothing lost (docs/library-format.md).

Text is the source of truth: the copy is JSON and plain text, says what it is (format and
version), and Bring a library in reads it back, adding and never replacing.
"""
import io
import json
import zipfile

from jriter.modules import export


def _make_song(server, wav):
    status, made = server.post("/api/songs", {"title": "Ordinary Weather"})
    assert status == 200, made
    sid = made["song"]["id"] if "song" in made else made["id"]
    status, up = server.upload("/api/songs/%d/versions" % sid, wav(seconds=1.0))
    assert status == 200, up
    status, sheet = server.post("/api/songs/%d/lyrics" % sid, {"name": "Main"})
    assert status == 200, sheet
    sheet_id = (sheet.get("sheet") or sheet)["id"]
    status, saved = server.put("/api/lyrics/%d/text" % sheet_id, {"text": "Ordinary weather\n\nKék az ég"})
    assert status == 200, saved
    return sid


def test_the_copy_says_what_it_is_and_reads_like_text(server, wav):
    _make_song(server, wav)
    status, raw = server.get("/api/export?audio=1")
    assert status == 200
    z = zipfile.ZipFile(io.BytesIO(raw))
    body = json.loads(z.read("library.json"))
    assert body["format"] == "jriter-library" and body["version"] == 2 and body["about"]
    names = z.namelist()
    assert any(n.endswith("/words.md") for n in names), names
    assert any(n.endswith("/song.txt") for n in names)
    assert any(n.startswith("audio/") for n in names), "with audio, the audio is inside"
    words = next(z.read(n).decode() for n in names if n.endswith("/words.md"))
    assert "Kék az ég" in words


def test_bring_it_back_in_adds_everything(server, wav):
    _make_song(server, wav)
    _, raw = server.get("/api/export?audio=1")
    status, said = server.request("POST", "/api/import", data=raw,
                                  headers={"Content-Type": "application/zip"})
    assert status == 200, said
    assert said["songs"] == 1 and said["renders"] >= 1 and said["lyrics"] == 1
    assert said["missing_audio"] == 0
    _, songs = server.get("/api/songs")
    listed = songs.get("songs", songs)
    titles = [s["title"] for s in listed]
    assert titles.count("Ordinary Weather") == 2, "it adds, it never replaces"
    copy = max(listed, key=lambda s: s["id"])
    _, versions = server.get("/api/songs/%d/versions" % copy["id"])
    rows = versions.get("versions", versions)
    assert rows, "the render came across"
    _, sheets = server.get("/api/songs/%d/lyrics" % copy["id"])
    text = json.dumps(sheets, ensure_ascii=False)
    assert "Kék az ég" in text


def test_audio_that_isnt_anywhere_is_counted_not_faked(server):
    body = {"format": "jriter-library", "version": 2, "tables": {
        "songs": [{"id": 7, "title": "Lost", "created_at": 1, "updated_at": 1}],
        "versions": [{"id": 3, "song_id": 7, "n": 1, "digest": "0" * 64, "ext": "wav", "size": 1}]}}
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("library.json", json.dumps(body))
    status, said = server.request("POST", "/api/import", data=buf.getvalue(),
                                  headers={"Content-Type": "application/zip"})
    assert status == 200, said
    assert said["songs"] == 1 and said["missing_audio"] == 1 and said["renders"] == 0


def test_not_a_library_file_says_so(server):
    status, said = server.request("POST", "/api/import", data=b"hello", headers={"Content-Type": "application/zip"})
    assert status == 400 and "zip" in said["error"]
    newer = io.BytesIO()
    with zipfile.ZipFile(newer, "w") as z:
        z.writestr("library.json", json.dumps({"format": "jriter-library", "version": 99, "tables": {}}))
    status, said = server.request("POST", "/api/import", data=newer.getvalue(), headers={"Content-Type": "application/zip"})
    assert status == 400 and "newer" in said["error"]


def test_the_machines_own_rows_never_come_in():
    assert not {"auth_tokens", "guest_edits", "sync_folders", "youtube_posts",
                "orarend_notes", "orarend_pages"} & set(export.IMPORTED)
    assert set(export.IMPORTED) <= set(export.TAKEN)
