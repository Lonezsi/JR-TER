"""The front door with guest mode: the app opens signed out, the library does not.

Signed out, a visit to / gets the app's shell, which starts a guest library kept in the
browser (ui/src/guest). Everything a guest does is answered by a service worker from
IndexedDB and never reaches this server. So what this server opens is the built interface
and nothing else: every /api/* that was shut is still shut, and the shell itself says
nothing about whose library lives here.

These run against a real server with the door loaded, the same way test_auth does.
"""
import io
import os
import re
import urllib.error
import urllib.request

import pytest

from jriter import config, registry, http, accounts, who
from jriter.modules import auth

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)


@pytest.fixture
def door(server):
    """The live server with the door loaded and an owner whose library has a name."""
    registry.load(config.MODULES)
    code = auth.setup_code()
    server.post("/api/auth/setup", {"code": code, "password": "a"})
    with who.acting_as(accounts.OWNER):
        config.save_settings({"library_name": "Zebra Moonlight Sessions"})
    yield server
    registry.load([m for m in config.MODULES if m != "auth"])


def _raw(client, path, method="GET"):
    """One request that does not follow redirects, with no cookie."""
    class Keep(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *args, **kwargs):
            return None

    opener = urllib.request.build_opener(Keep)
    request = urllib.request.Request(client.base + path, method=method,
                                     data=b"" if method != "GET" else None)
    try:
        with opener.open(request, timeout=10) as response:
            return response.status, dict(response.headers), response.read()
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers), e.read()


def _index():
    return io.open(os.path.join(config.WEB, "index.html"), encoding="utf-8").read()


def test_signed_out_the_app_opens(door):
    status, headers, body = _raw(door, "/")
    assert status == 200, "signed out, / answered %d instead of the app" % status
    assert headers.get("Content-Type", "").startswith("text/html")
    assert b'id="app"' in body


def test_the_shell_says_nothing_about_the_library(door):
    """No name, no titles, no counts: the name comes from /api/state, which stays shut."""
    _, _, body = _raw(door, "/")
    assert b"Zebra Moonlight" not in body
    status, _, _ = _raw(door, "/api/state")
    assert status == 401


@pytest.mark.parametrize("path", ["/api/state", "/api/songs", "/api/settings", "/api/export",
                                  "/api/search?q=a", "/api/renders", "/api/albums",
                                  "/api/versions/1/audio", "/api/artwork/1/image"])
def test_the_api_is_exactly_as_shut_as_before(door, path):
    status, _, _ = _raw(door, path)
    assert status == 401, "signed out, %s answered %d" % (path, status)


@pytest.mark.parametrize("path", ["/api/songs", "/api/import", "/api/renders", "/api/settings"])
def test_writes_are_shut_too(door, path):
    status, _, _ = _raw(door, path, "POST")
    assert status == 401, "signed out, POST %s answered %d" % (path, status)


def test_the_service_worker_and_the_built_files_are_served(door):
    sw = os.path.join(config.WEB, "sw.js")
    assert os.path.isfile(sw), "web/sw.js is missing: run npm run ship in ui/"
    status, headers, _ = _raw(door, "/sw.js")
    assert status == 200
    assert "javascript" in headers.get("Content-Type", "")
    # Every script and stylesheet the shell names, signed out.
    for asset in re.findall(r'(?:src|href)="(/assets/[^"]+)"', _index()):
        status, _, _ = _raw(door, asset)
        assert status == 200, "signed out, %s answered %d" % (asset, status)
    status, _, _ = _raw(door, "/lexicon/en.txt")
    assert status == 200


def test_only_the_shell_is_opened(door):
    """Anything that is not the app's own files still goes to the door."""
    for path in ("/settings", "/jriter.js", "/anything/else"):
        status, headers, _ = _raw(door, path)
        assert status == 303 and headers.get("Location") == "/login", (path, status)
    # Not a way out of web/ either.
    for path in ("/assets/../../data/accounts.db", "/css/..%2f..%2fjriter%2fconfig.py",
                 "/assets/%2e%2e/%2e%2e/server.py"):
        status, _, body = _raw(door, path)
        assert status in (303, 404) or b"import" not in body, path
        assert b"sqlite" not in body.lower()[:64]


def test_a_shell_path_is_only_open_to_get(door):
    status, _, _ = _raw(door, "/", "POST")
    assert status != 200


def test_a_missing_worker_is_a_404_not_the_app(door, monkeypatch, tmp_path):
    """Handing back index.html for /sw.js would register a page as a worker."""
    (tmp_path / "index.html").write_text("<div id=app></div>", encoding="utf-8")
    monkeypatch.setattr(config, "WEB", str(tmp_path))
    status, _, _ = _raw(door, "/sw.js")
    assert status == 404


def test_signed_in_nothing_changed(door):
    data = b'{"password": "a"}'
    request = urllib.request.Request(door.base + "/api/auth/login", data=data,
                                     headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(request, timeout=10) as response:
        cookie = response.headers.get("Set-Cookie").split(";")[0]
    status, answer = door.request("GET", "/api/songs", headers={"Cookie": cookie})
    assert status == 200 and "songs" in answer


# ── the page's side of the door ──────────────────────────────────────────────

def _source(*parts):
    return io.open(os.path.join(ROOT, "ui", "src", *parts), encoding="utf-8").read()


def test_members_only_screens_still_reach_the_door():
    """/#/orarend signed out used to go /login#/orarend; with guest mode the server hands
    back the app, and the app has to send it on, with its destination."""
    boot = _source("guest", "boot.ts")
    found = re.search(r"const MEMBERS_ONLY = /(.+)/;", boot)
    assert found, "boot.ts no longer names the screens a guest is sent to the door from"
    pattern = re.compile(found.group(1).replace("\\/", "/"))
    for hash_ in ("#/orarend", "#/join/abc-123", "#/shared/4", "#/shared/4/edit/2", "#/orarend?day=1"):
        assert pattern.search(hash_), "%s would open an empty guest library" % hash_
    for hash_ in ("", "#/", "#/song/3", "#/inbox", "#/settings/account", "#/album/2"):
        assert not pattern.search(hash_), "%s would be sent to the door" % hash_
    assert 'location.replace("/login" + location.hash)' in boot


def test_the_worker_never_answers_for_the_door():
    """Signing in, and the page asking whether it is signed in, always reach the server."""
    sw = _source("sw.ts")
    found = re.search(r"const SERVER = /(.+)/;", sw)
    assert found
    pattern = re.compile(found.group(1).replace("\\/", "/"))
    for path in ("/api/auth/state", "/api/auth/login", "/api/auth/signup", "/api/auth/logout",
                 "/api/health", "/api/shares/invitation/x"):
        assert pattern.search(path), path
    for path in ("/api/songs", "/api/state", "/api/import", "/api/export"):
        assert not pattern.search(path), path
    # Not guest: no respondWith at all, so a member's requests are the browser's own.
    assert 'if (mode === "off") return;' in sw


def test_the_guest_backend_never_answers_401():
    """A 401 sends the page to /login (lib/api.ts). A guest has nothing to sign in to."""
    for name in os.listdir(os.path.join(ROOT, "ui", "src", "guest", "routes")) + ["backend.ts", "http.ts"]:
        path = os.path.join(ROOT, "ui", "src", "guest", "routes", name)
        if not os.path.isfile(path):
            path = os.path.join(ROOT, "ui", "src", "guest", name)
        assert ", 401)" not in io.open(path, encoding="utf-8").read(), name
