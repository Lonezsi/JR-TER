"""What the HTTP layer promises about every reply, whatever is being served.

Each of these is a way a static file server quietly goes wrong: reading a neighbouring
directory, letting a browser guess that an upload is a page, compressing something a
player is seeking in, or caching a file whose name does not say what is in it.
"""
import gzip
import json
import http.client
import os

import pytest

from jriter import config, http as jhttp


def conn(server):
    host, port = server.base.replace("http://", "").split(":")
    return http.client.HTTPConnection(host, int(port), timeout=20)


def fetch(server, path, headers=None, method="GET", body=None):
    c = conn(server)
    try:
        c.request(method, path, body=body, headers=headers or {})
        response = c.getresponse()
        return response, response.read()
    finally:
        c.close()


@pytest.fixture
def site(tmp_path, monkeypatch):
    """A built interface in a directory whose name begins a sibling's, which is the shape
    that used to leak: web beside web-next."""
    web = tmp_path / "web"
    (web / "assets").mkdir(parents=True)
    (web / "index.html").write_text("<!doctype html><title>app</title>" + "x" * 2000, encoding="utf-8")
    (web / "assets" / "index-abc123.js").write_text("console.log(1);" + "/* pad */" * 400, encoding="utf-8")
    (web / "small.txt").write_text("tiny", encoding="utf-8")
    beside = tmp_path / "web-next"
    beside.mkdir()
    (beside / "secret.txt").write_text("not yours", encoding="utf-8")
    monkeypatch.setattr(config, "WEB", str(web))
    return web


def test_inside_is_about_ancestry_not_spelling(tmp_path):
    root = str(tmp_path / "web")
    assert jhttp.inside(root, os.path.join(root, "a", "b.js"))
    assert jhttp.inside(root, root)
    assert not jhttp.inside(root, str(tmp_path / "web-next" / "b.js"))
    assert not jhttp.inside(root, str(tmp_path))


@pytest.mark.parametrize("path", [
    "/../web-next/secret.txt",
    "/..%2fweb-next/secret.txt",
    "/%2e%2e/web-next/secret.txt",
    "/..\\web-next\\secret.txt",
    "/assets/../../web-next/secret.txt",
])
def test_a_sibling_directory_cannot_be_read(server, site, path):
    response, body = fetch(server, path)
    assert b"not yours" not in body, "%s read a file outside the served directory" % path


def test_every_reply_refuses_to_be_sniffed(server, site):
    for path in ("/", "/api/songs", "/api/nothing-here", "/assets/index-abc123.js"):
        response, _ = fetch(server, path)
        assert response.getheader("X-Content-Type-Options") == "nosniff", path
        assert response.getheader("Referrer-Policy") == "same-origin", path


def test_text_is_compressed_only_for_a_caller_that_asked(server, site):
    plain, body = fetch(server, "/assets/index-abc123.js")
    assert plain.getheader("Content-Encoding") is None
    assert body.startswith(b"console.log")

    packed, squeezed = fetch(server, "/assets/index-abc123.js", {"Accept-Encoding": "gzip"})
    assert packed.getheader("Content-Encoding") == "gzip"
    assert "Accept-Encoding" in (packed.getheader("Vary") or "")
    assert gzip.decompress(squeezed) == body
    assert len(squeezed) < len(body)


def test_a_small_file_is_sent_as_it_is(server, site):
    response, body = fetch(server, "/small.txt", {"Accept-Encoding": "gzip"})
    assert response.getheader("Content-Encoding") is None
    assert body == b"tiny"


def test_json_is_compressed_when_it_is_worth_it(server):
    for n in range(40):
        server.post("/api/songs", {"title": "A song with a reasonably long name %d" % n})
    response, body = fetch(server, "/api/songs", {"Accept-Encoding": "gzip"})
    assert response.getheader("Content-Encoding") == "gzip"
    assert len(json.loads(gzip.decompress(body))["songs"]) == 40

    response, body = fetch(server, "/api/health", {"Accept-Encoding": "gzip"})
    assert response.getheader("Content-Encoding") is None, "a tiny reply was compressed"
    assert json.loads(body)["ok"] is True


def test_audio_is_never_compressed_and_stays_seekable(server, wav):
    _, made = server.post("/api/songs", {"title": "Seek Me"})
    _, up = server.upload("/api/songs/%d/versions" % made["song"]["id"], wav(seconds=1.0))
    path = "/api/versions/%d/audio" % up["version"]["id"]

    whole, body = fetch(server, path, {"Accept-Encoding": "gzip"})
    assert whole.getheader("Content-Encoding") is None
    assert whole.getheader("Accept-Ranges") == "bytes"

    part, piece = fetch(server, path, {"Accept-Encoding": "gzip", "Range": "bytes=10-19"})
    assert part.status == 206
    assert piece == body[10:20]


def test_a_range_of_a_text_file_is_the_bytes_on_disk(server, site):
    """A range is an offset into the file, so a ranged reply must never be the gzip."""
    response, piece = fetch(server, "/assets/index-abc123.js",
                            {"Accept-Encoding": "gzip", "Range": "bytes=0-10"})
    assert response.status == 206
    assert response.getheader("Content-Encoding") is None
    assert piece == b"console.log"


def test_only_content_named_files_are_kept_without_asking(server, site):
    asset, _ = fetch(server, "/assets/index-abc123.js")
    assert "immutable" in asset.getheader("Cache-Control")
    page, _ = fetch(server, "/")
    assert "immutable" not in page.getheader("Cache-Control")
    assert "no-cache" in page.getheader("Cache-Control")


def test_a_missing_asset_is_missing_rather_than_the_app(server, site):
    """A tab holding yesterday's index.html asks for yesterday's script. Answering that
    with a page gives a MIME type error that hides what is wrong; a 404 says it."""
    response, body = fetch(server, "/assets/index-gone.js")
    assert response.status == 404
    assert b"<!doctype" not in body.lower()
    # Any other unknown path is still a route for the app to draw.
    response, body = fetch(server, "/somewhere/else")
    assert response.status == 200 and b"<title>app</title>" in body


def test_an_enormous_json_body_is_refused_before_it_is_read(server):
    c = conn(server)
    try:
        c.putrequest("POST", "/api/songs")
        c.putheader("Content-Type", "application/json")
        c.putheader("Content-Length", str(64 * 1024 * 1024))
        c.endheaders()
        response = c.getresponse()
        assert response.status == 413
        assert "too large" in json.loads(response.read())["error"]
    finally:
        c.close()
