"""Coming in through Foyer, the machine's front door, which signs people in for every site.

A stand-in Foyer answers /api/account the way the real one does, for three cookies: its
owner, a friend of the owner, and a stranger. Everything else is nobody.
"""
import http.server
import json
import threading

import pytest

from jriter import accounts
from jriter.modules import auth
from jriter.wire import Error

PEOPLE = {
    "own.er.cookie": {"id": "f-owner", "handle": "jozsef", "name": "József", "owner": True, "ownerFriend": True},
    "fri.end.cookie": {"id": "f-anna", "handle": "Anna", "name": "Anna", "owner": False, "ownerFriend": True},
    "stra.nger.cookie": {"id": "f-who", "handle": "who", "name": "", "owner": False, "ownerFriend": False},
}


@pytest.fixture
def foyer(monkeypatch):
    class Foyer(http.server.BaseHTTPRequestHandler):
        def do_GET(self):
            sent = (self.headers.get("Cookie") or "").split("=", 1)[-1]
            body = json.dumps({"account": PEOPLE.get(sent)}).encode()
            self.send_response(200)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *a):
            pass

    srv = http.server.HTTPServer(("127.0.0.1", 0), Foyer)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    monkeypatch.setattr(auth, "FOYER", "http://127.0.0.1:%d" % srv.server_address[1])
    auth._foyer_seen.clear()
    auth._attempts.clear()
    yield
    srv.shutdown()
    srv.server_close()


class Req:
    def __init__(self, cookie=None, payload=None):
        self.headers = {"Cookie": "jriter_other=1; foyer=" + cookie} if cookie else {}
        self.payload = payload or {}
        self.client = "127.0.0.1"

    def json(self):
        return self.payload


def headers(cookie):
    return Req(cookie).headers


def test_nobody_on_foyer_is_nobody_here(foyer):
    accounts.create("owner", "pw", account_id=accounts.OWNER)
    assert auth.account_for({}) is None
    assert auth.account_for(headers("forged.cookie.x")) is None
    # a cookie that isn't Foyer's shape is never even sent on
    assert auth.foyer(headers("a;b")) is None


def test_foyers_owner_opens_the_owners_library(foyer):
    accounts.create("owner", "pw", account_id=accounts.OWNER)
    assert auth.account_for(headers("own.er.cookie")) == accounts.OWNER
    assert accounts.foyer_of(accounts.OWNER) == "f-owner"


def test_a_password_sign_in_ties_the_two_once(foyer):
    accounts.create("owner", "pw", account_id=accounts.OWNER)
    anna = accounts.create("anna", "her password")
    # the stranger is nobody, and isn't offered a library
    assert auth.account_for(headers("stra.nger.cookie")) is None
    assert auth.foyer_state(Req("stra.nger.cookie"))["foyer"]["can_make"] is False
    # a wrong password ties nothing
    with pytest.raises(Error):
        auth.login(Req("stra.nger.cookie", {"handle": "anna", "password": "wrong"}))
    assert auth.account_for(headers("stra.nger.cookie")) is None
    auth.login(Req("stra.nger.cookie", {"handle": "anna", "password": "her password"}))
    assert auth.account_for(headers("stra.nger.cookie")) == anna["id"]
    assert auth.foyer_state(Req("stra.nger.cookie"))["foyer"]["linked"] is True


def test_a_friend_of_the_owner_can_have_a_library_made(foyer):
    accounts.create("owner", "pw", account_id=accounts.OWNER)
    accounts.create("anna", "taken already")
    state = auth.foyer_state(Req("fri.end.cookie"))["foyer"]
    assert state == {"handle": "Anna", "linked": False, "handle_here": None, "can_make": True}
    made = auth.sign_up(Req("fri.end.cookie", {"foyer": True}))
    # the handle they have on Foyer, or the nearest one free
    assert made["handle"] == "anna2"
    here = auth.account_for(headers("fri.end.cookie"))
    assert accounts.by_id(here)["handle"] == "anna2" and accounts.by_id(here)["name"] == "Anna"
    # once is enough
    with pytest.raises(Error) as again:
        auth.sign_up(Req("fri.end.cookie", {"foyer": True}))
    assert again.value.status == 409


def test_a_stranger_on_foyer_gets_no_library(foyer):
    accounts.create("owner", "pw", account_id=accounts.OWNER)
    with pytest.raises(Error) as no:
        auth.sign_up(Req("stra.nger.cookie", {"foyer": True}))
    assert no.value.status == 403
    with pytest.raises(Error) as nobody:
        auth.sign_up(Req(None, {"foyer": True}))
    assert nobody.value.status == 401
    assert accounts.count() == 1


def test_settings_connects_and_disconnects(foyer):
    accounts.create("owner", "pw", account_id=accounts.OWNER)
    anna = accounts.create("anna", "her password")
    cookie = "jriter_session=" + auth.issue(anna["id"])
    req = Req("stra.nger.cookie")
    req.headers["Cookie"] = cookie + "; foyer=stra.nger.cookie"
    assert auth.foyer_connect(req)["foyer"] == "who"
    assert auth.account_for(headers("stra.nger.cookie")) == anna["id"]
    auth.foyer_disconnect(req)
    assert auth.account_for(headers("stra.nger.cookie")) is None
    # signed in here but not on Foyer: nothing to connect to
    alone = Req()
    alone.headers["Cookie"] = cookie
    with pytest.raises(Error) as e:
        auth.foyer_connect(alone)
    assert e.value.status == 409


# ── signing in on the sign in page with a Foyer account ───────────────────────────────

@pytest.fixture
def foyer_login(monkeypatch):
    """A Foyer that also answers /api/account/login: anna's password is "right"."""
    class Foyer(http.server.BaseHTTPRequestHandler):
        def do_GET(self):
            sent = (self.headers.get("Cookie") or "").split("=", 1)[-1]
            body = json.dumps({"account": PEOPLE.get(sent)}).encode()
            self.send_response(200)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_POST(self):
            data = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            by_handle = {p["handle"].lower(): c for c, p in PEOPLE.items()}
            cookie = by_handle.get(data["handle"].lower())
            if not cookie or data["password"] != "right":
                body = json.dumps({"error": "wrong", "message": "That handle and password don't match."}).encode()
                self.send_response(401)
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
                return
            body = b'{"account": {}}'
            self.send_response(200)
            self.send_header("Set-Cookie", "foyer=%s; Path=/; HttpOnly; SameSite=Lax" % cookie)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *a):
            pass

    srv = http.server.HTTPServer(("127.0.0.1", 0), Foyer)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    monkeypatch.setattr(auth, "FOYER", "http://127.0.0.1:%d" % srv.server_address[1])
    auth._foyer_seen.clear()
    yield
    srv.shutdown()
    srv.server_close()


def test_a_foyer_handle_and_password_sign_in_here(foyer_login):
    accounts.create("owner", "pw", account_id=accounts.OWNER)
    answer = auth.foyer_login(Req(payload={"handle": "@Anna", "password": "right"}))
    assert "foyer=fri.end.cookie" in answer.headers["Set-Cookie"], "Foyer's own cookie comes back"
    made = auth.foyer_library(auth.foyer(headers("fri.end.cookie")))
    assert made and made != accounts.OWNER, "a friend of the owner gets a library of their own"
    with pytest.raises(Error) as wrong:
        auth.foyer_login(Req(payload={"handle": "anna", "password": "nope"}))
    assert wrong.value.status == 401 and "match" in wrong.value.message
    with pytest.raises(Error) as stranger:
        auth.foyer_login(Req(payload={"handle": "who", "password": "right"}))
    assert stranger.value.status == 403


def test_the_named_foyer_account_is_the_owner(foyer_login, monkeypatch, tmp_path):
    """foyer-owner.txt beside the data names the owner, whoever Foyer's own owner is."""
    accounts.create("owner", "pw", account_id=accounts.OWNER)
    named = tmp_path / "foyer-owner.txt"
    named.write_text("@Anna\n", encoding="utf-8")
    monkeypatch.setattr(auth, "OWNER_FILE", str(named))
    assert auth.foyer_library(auth.foyer(headers("fri.end.cookie"))) == accounts.OWNER
    assert accounts.foyer_of(accounts.OWNER) == "f-anna"
