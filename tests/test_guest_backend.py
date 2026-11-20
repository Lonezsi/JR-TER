"""The guest backend answers in the server's shapes.

A guest's screens are the same screens, calling the same /api/* paths, answered by a
service worker from IndexedDB (ui/src/guest). A field the server sends and the guest
backend does not is a screen that breaks only for guests, which nobody signed in would
ever see. So the same requests go to both, and every key the server answers with has to be
in the guest's answer too.

The guest backend runs in Node (tests/guest_backend.mjs), built by the ui's own Vite.
"""
import json
import os
import shutil
import subprocess

import pytest

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)


def _steps(wav):
    return [
        {"method": "POST", "path": "/api/songs", "json": {"title": "Night Drive"}, "take": "song"},
        {"path": "/api/songs", "take": "songs.0"},
        {"method": "POST", "path": "/api/songs/1/versions", "file": wav,
         "headers": {"X-Filename": "night.wav", "Content-Type": "application/octet-stream"}, "take": "version"},
        {"path": "/api/songs/1/versions", "take": "versions.0"},
        {"path": "/api/songs/1", "take": "song"},
        {"method": "POST", "path": "/api/renders", "file": wav,
         "headers": {"X-Filename": "other.wav", "Content-Type": "application/octet-stream"}, "take": "render"},
        {"path": "/api/renders?all=1", "take": "renders.0"},
        {"method": "POST", "path": "/api/songs/1/lyrics", "json": {"text": "# Neon\nwe drive"}, "take": "sheet"},
        {"path": "/api/songs/1/lyrics", "take": "lyrics.0"},
        {"path": "/api/lyrics/1/history", "take": "revisions.0"},
        {"method": "POST", "path": "/api/albums", "json": {"title": "First Light", "year": 2026}, "take": "album"},
        {"method": "POST", "path": "/api/albums/1/songs", "json": {"song_id": 1}, "take": ""},
        {"path": "/api/albums", "take": "albums.0"},
        {"path": "/api/albums/1", "take": "album"},
        {"path": "/api/albums/1", "take": "songs.0"},
        {"method": "POST", "path": "/api/playlists", "json": {"title": "Drive"}, "take": "playlist"},
        {"path": "/api/playlists", "take": "playlists.0"},
        {"method": "POST", "path": "/api/playlists/2/items", "json": {"song_id": 1}, "take": "playlist.items.0"},
        {"path": "/api/songs/1/playlists", "take": "playlists.0"},
        {"path": "/api/songs/1/sound", "take": "presets.0"},
        {"method": "PUT", "path": "/api/songs/1/arrangement",
         "json": {"bpm": 100, "parts": [{"id": "p1", "name": "Verse"}],
                  "clips": [{"id": "c1", "from": 0, "beats": 8, "part": "p1"}], "enabled": True},
         "take": "arrangement"},
        {"path": "/api/arrangements/shapes", "take": ""},
        {"path": "/api/search?q=night", "take": ""},
        {"path": "/api/search?q=night", "take": "groups.0"},
        {"path": "/api/search?q=night", "take": "groups.0.hits.0"},
        {"path": "/api/settings", "take": ""},
        {"path": "/api/state", "take": ""},
        {"method": "POST", "path": "/api/versions/1/current", "json": {}, "take": ""},
        {"method": "DELETE", "path": "/api/lyrics/1", "take": ""},
    ]


def _take(body, where):
    for part in [p for p in where.split(".") if p]:
        body = body[int(part)] if isinstance(body, list) else body[part]
    return body


def _server_answers(server, steps):
    out = []
    for s in steps:
        if "file" in s:
            with open(s["file"], "rb") as f:
                status, body = server.request(s.get("method", "GET"), s["path"], data=f.read(),
                                              headers=s["headers"])
        else:
            status, body = server.request(s.get("method", "GET"), s["path"], s.get("json"))
        out.append({"status": status, "body": body})
    return out


def _guest_answers(steps, tmp_path):
    node = shutil.which("node")
    if not node:
        pytest.fail("node is not on PATH, so the guest backend cannot be checked")
    if not os.path.isdir(os.path.join(ROOT, "ui", "node_modules", "vite")):
        pytest.skip("ui/node_modules is not installed")
    plan = tmp_path / "steps.json"
    plan.write_text(json.dumps(steps), encoding="utf-8")
    run = subprocess.run([node, os.path.join(HERE, "guest_backend.mjs"), str(plan)],
                         capture_output=True, timeout=180, cwd=ROOT)
    assert run.returncode == 0, run.stderr.decode("utf-8", "replace")[-2000:]
    return json.loads(run.stdout.decode("utf-8"))


#: Keys the server sends that a guest library has no use for, by path. None so far.
NOT_FOR_GUESTS = {}


def test_the_guest_backend_answers_like_the_server(server, wav, tmp_path):
    steps = _steps(wav("night.wav"))
    theirs = _server_answers(server, steps)
    ours = _guest_answers(steps, tmp_path)
    problems = []
    for step, s, g in zip(steps, theirs, ours):
        label = "%s %s [%s]" % (step.get("method", "GET"), step["path"], step["take"])
        if s["status"] != g["status"]:
            problems.append("%s: server %s, guest %s (%s)" % (label, s["status"], g["status"], g["body"]))
            continue
        a, b = _take(s["body"], step["take"]), _take(g["body"], step["take"])
        if isinstance(a, dict):
            missing = set(a) - set(b) - NOT_FOR_GUESTS.get(step["path"], set())
            if missing:
                problems.append("%s: the guest answer has no %s" % (label, sorted(missing)))
    assert not problems, "\n".join(problems)


def test_a_guest_library_is_the_library_file(wav, tmp_path):
    """Take a copy: library.json with format and version, the tables, and the audio, in the
    shape docs/library-format.md describes."""
    import zipfile
    saved = tmp_path / "copy.zip"
    steps = _steps(wav("night.wav"))[:12] + [{"path": "/api/export", "take": "", "save": str(saved)}]
    out = _guest_answers(steps, tmp_path)
    assert out[-1]["status"] == 200 and out[-1]["body"]["type"] == "application/zip"
    with zipfile.ZipFile(saved) as z:
        assert z.testzip() is None
        names = z.namelist()
        body = json.loads(z.read("library.json"))
    assert body["format"] == "jriter-library" and body["version"] == 2
    assert [s["title"] for s in body["tables"]["songs"]] == ["Night Drive"]
    assert len(body["tables"]["versions"]) == 1 and len(body["tables"]["renders"]) == 1
    for row in body["tables"]["versions"] + body["tables"]["renders"]:
        assert "audio/%s%s" % (row["digest"], row["ext"]) in names
        assert "peaks" not in row
    assert "songs/Night Drive/words.md" in names and "songs/Night Drive/song.txt" in names
    assert "README.txt" in names and "settings.json" in names
