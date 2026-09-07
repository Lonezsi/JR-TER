"""The wall, through the door, over a real socket.

tests/test_accounts.py checks the isolation at the level of who.py and db.py, which is where
it is actually enforced. This checks it at the level a stranger would attack it: through
HTTP, with a cookie, against a running server.

Both are worth having. The first says the design is right; this one says the design is
reached. A binding that never happens, an endpoint left out of the door's list, a handler
that reads an id straight out of a URL — none of those are visible from inside a function
call, and every one of them is a way for the wall to be perfect and irrelevant.
"""
import json
import time

import pytest

from jriter import config, registry, accounts


@pytest.fixture
def library(server):
    """The same live server with the door loaded, and the guess counter empty."""
    registry.load(config.MODULES)
    from jriter.modules import auth
    auth._attempts.clear()
    yield server
    registry.load([m for m in config.MODULES if m != "auth"])


class Browser:
    """One person's session: a cookie, and the calls a page makes."""

    def __init__(self, client):
        self.client = client
        self.cookie = None

    def call(self, method, path, payload=None, headers=None):
        head = dict(headers or {})
        if self.cookie:
            head["Cookie"] = self.cookie
        status, body = self.client.request(method, path, payload, headers=head)
        return status, body

    def sign_up(self, code, handle, password):
        status, _ = self.client.request(
            "POST", "/api/auth/signup",
            {"code": code, "handle": handle, "password": password})
        if status == 200:
            self.cookie = _cookie_from(self.client, "/api/auth/signup",
                                       {"code": code, "handle": handle,
                                        "password": password})
        return status


def _cookie_from(client, path, payload):
    """The Set-Cookie a call hands back.

    The test client throws headers away, so this repeats the call through urllib to read
    one. Only used where a session is actually needed.
    """
    import urllib.request
    import urllib.error
    request = urllib.request.Request(
        client.base + path, data=json.dumps(payload).encode(), method="POST",
        headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(request, timeout=20) as answer:
            for key, value in answer.getheaders():
                if key.lower() == "set-cookie":
                    return value.split(";")[0]
    except urllib.error.HTTPError:
        return None
    return None


def _owner_and_friend(library):
    """Set the library up, then invite somebody into it."""
    from jriter.modules import auth
    owner = Browser(library)
    owner.cookie = _cookie_from(library, "/api/auth/setup",
                                {"code": auth.setup_code(), "password": "owner-secret"})
    assert owner.cookie, "the owner could not be signed in"

    status, invite = owner.call("POST", "/api/auth/invites", {"note": "a friend"})
    assert status == 200, invite

    friend = Browser(library)
    friend.cookie = _cookie_from(library, "/api/auth/signup",
                                 {"code": invite["code"], "handle": "jozsef",
                                  "password": "friend-secret", "name": "Jozsef"})
    assert friend.cookie, "the friend could not sign up"
    return owner, friend


def test_a_friend_cannot_read_the_owners_library(library):
    owner, friend = _owner_and_friend(library)

    status, made = owner.call("POST", "/api/songs", {"title": "The owner's demo"})
    assert status == 200
    song = made["song"]["id"]

    status, mine = friend.call("GET", "/api/songs")
    assert status == 200
    assert mine["songs"] == [], "a friend's library opened with somebody else's songs"

    # By id, which is the obvious thing to try: song ids are small integers.
    status, _ = friend.call("GET", "/api/songs/%d" % song)
    assert status == 404, "a friend read the owner's song by guessing its id"


def test_a_friends_song_does_not_appear_in_the_owners_library(library):
    owner, friend = _owner_and_friend(library)
    friend.call("POST", "/api/songs", {"title": "A friend's track"})

    status, theirs = owner.call("GET", "/api/songs")
    assert [s["title"] for s in theirs["songs"]] == []


def test_search_does_not_cross_between_accounts(library):
    """The one endpoint whose whole job is to look everywhere."""
    owner, friend = _owner_and_friend(library)
    owner.call("POST", "/api/songs", {"title": "Findable"})

    status, found = friend.call("GET", "/api/search?q=Findable")
    assert status == 200
    # The hits, not the whole answer: it echoes the query back, so the word appears in it
    # either way and the first version of this test was checking for its own input.
    hits = [hit for group in found.get("groups", []) for hit in group.get("hits", [])]
    assert hits == [], "search reached into another library: %s" % json.dumps(hits)[:200]
    # And it says it looked, so this is "nothing there" rather than "search is off".
    assert found.get("looked_in"), "search did not run at all, so this proves nothing"


def test_only_the_owner_can_invite(library):
    owner, friend = _owner_and_friend(library)
    status, _ = friend.call("POST", "/api/auth/invites", {"note": "for me"})
    assert status == 403
    status, _ = friend.call("GET", "/api/auth/invites")
    assert status == 403


def test_signing_up_needs_an_invite(library):
    _owner_and_friend(library)
    status, answer = library.request(
        "POST", "/api/auth/signup",
        {"code": "0000-1111-2222", "handle": "stranger", "password": "x"})
    assert status == 403
    assert "invite" in answer["error"].lower()


def test_a_shared_song_is_reachable_and_nothing_else_is(library):
    owner, friend = _owner_and_friend(library)
    status, made = owner.call("POST", "/api/songs", {"title": "Shared"})
    shared = made["song"]["id"]
    status, hidden = owner.call("POST", "/api/songs", {"title": "Not shared"})
    private = hidden["song"]["id"]

    status, share = owner.call("POST", "/api/shares",
                               {"song": shared, "handle": "jozsef", "as_name": "Jozsef"})
    assert status == 200, share

    status, opened = friend.call("GET", "/api/shared/%d" % share["share"])
    assert status == 200
    assert opened["song"]["title"] == "Shared"

    # The song behind the share is reachable; the one beside it is not, by any route.
    status, _ = friend.call("GET", "/api/songs/%d" % private)
    assert status == 404
    status, _ = friend.call("GET", "/api/songs/%d" % shared)
    assert status == 404, "a share made the whole song reachable by its ordinary route"


def test_a_share_id_somebody_else_holds_is_not_yours(library):
    owner, friend = _owner_and_friend(library)
    third = Browser(library)
    status, invite = owner.call("POST", "/api/auth/invites", {"note": "another"})
    third.cookie = _cookie_from(library, "/api/auth/signup",
                                {"code": invite["code"], "handle": "nosy",
                                 "password": "x"})
    assert third.cookie

    status, made = owner.call("POST", "/api/songs", {"title": "Shared"})
    status, share = owner.call("POST", "/api/shares",
                               {"song": made["song"]["id"], "handle": "jozsef"})

    status, _ = third.call("GET", "/api/shared/%d" % share["share"])
    assert status == 404
    status, _ = third.call("GET", "/api/shared/%d/audio" % share["share"])
    assert status == 404


def test_everybody_can_see_who_else_is_here(library):
    """The account page's list, and deliberately not owner only.

    Sharing a song means naming a person, so you have to be able to see who is here. On a
    server where everybody was invited by the same person, which is every one of them, that
    is not news to anybody either.
    """
    owner, friend = _owner_and_friend(library)
    status, said = friend.call("GET", "/api/auth/people")
    assert status == 200
    handles = sorted(p["handle"] for p in said["people"])
    assert handles == ["jozsef", "owner"]
    assert said["me"] == [p for p in said["people"] if p["handle"] == "jozsef"][0]["id"]


def test_the_list_of_people_carries_nothing_private(library):
    """A handle, a name, when they joined. Never a credential, and nothing whatever about
    what is in anybody's library."""
    owner, friend = _owner_and_friend(library)
    status, said = friend.call("GET", "/api/auth/people")
    body = json.dumps(said)
    for leak in ("hash", "salt", "secret", "password"):
        assert leak not in body, "the people list carries %s" % leak
    for person in said["people"]:
        assert set(person) <= {"id", "handle", "name", "is_owner", "created_at"}, person


def test_a_stranger_cannot_ask_who_is_here(library):
    _owner_and_friend(library)
    nobody = Browser(library)
    status, _ = nobody.call("GET", "/api/auth/people")
    assert status == 401


def test_signed_out_is_still_nothing(library):
    """The door itself, unchanged by any of this."""
    _owner_and_friend(library)
    nobody = Browser(library)
    for path in ("/api/songs", "/api/shared", "/api/shares", "/api/auth/invites"):
        status, _ = nobody.call("GET", path)
        assert status == 401, "%s answered a request with no session" % path


def test_the_open_endpoints_are_still_the_only_open_ones(library):
    """A new endpoint reachable without a session is the way this gets undone quietly."""
    from jriter.http import OPEN_API
    nobody = Browser(library)
    for path in sorted(OPEN_API):
        status, body = nobody.call("GET", path)
        # Not turned away by the door...
        assert status != 401, "%s is listed as open but is not" % path
        # ...and not falling over either, which is the failure this actually catches.
        #
        # An open endpoint runs with no account bound, because there is no session to bind
        # from. Anything in it that reaches a library raises rather than guessing whose,
        # which comes back as a 500. Three of these needed saying whose before they worked:
        # the door's typeface, the state the login page reads, and the health check the
        # watchdog force-kills on.
        assert status < 500, "%s fails when nobody is signed in: %s" % (path, body)
        # And not quietly reporting the failure in a 200 either, which is what health does
        # with anything its one query raises: it catches, says degraded, and answers 200.
        # This is the actual signature to look for, whatever status carries it.
        assert "no account is bound" not in json.dumps(body),             "%s reached a library with nobody signed in: %s" % (path, body)
    assert OPEN_API == {
        "/api/auth/state", "/api/auth/login", "/api/auth/setup", "/api/auth/signup",
        "/api/health", "/api/appearance/font",
    }, ("the list of endpoints reachable without signing in has changed; each one is a "
        "thing a stranger on the internet can call, so it is worth a second look")
