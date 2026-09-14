"""A song sent to somebody who is not here yet.

Sharing needed the other person's handle first, which meant knowing an account already
existed and what it was called. Somebody with no account could not be sent a song at all
without first being sent an invite and told to go and sign up, so the short version of
"here, listen to this" was two messages and an explanation.

A link is one thing to send. Whoever opens it signs in, or picks a handle and a password
there and then, and the song is theirs on the next screen.

WHAT MAKES THAT SAFE, since this server answers on the public internet. The token is the
permission: not guessable, kept only as a digest, and spent the first time it works. It is
also the invite, because a link the owner deliberately sent is exactly as much permission as
an invite is, and pretending otherwise would only mean sending two secrets instead of one.

Most of what is below is about the spending. A link that opens twice is a link that was
forwarded, and the second person was never meant to have it.
"""
import time

import pytest

from jriter import db, who, accounts, registry, http
from jriter.wire import Error
from jriter.modules import sharing


@pytest.fixture
def owner_with_a_song():
    owner = accounts.create("owner", "one password", account_id=accounts.OWNER)
    with who.acting_as(owner["id"]):
        now = time.time()
        song = db.insert("songs", {"title": "Kettle", "created_at": now,
                                   "updated_at": now})
    return owner, song


class Ask:
    def __init__(self, params=None, body=None, headers=None):
        self.params = params or {}
        self._body = body or {}
        self.headers = headers or {}
        self.query = {}

    def json(self):
        return self._body

    def q(self, name, fallback=None):
        return fallback


class nobody:
    """Nobody signed in, for the length of a block.

    conftest binds the owner for every test, which is right for the rest of the suite and
    exactly wrong here: the whole point of a share link is the person who arrives with no
    session at all, and with the owner bound they would take the short way round and the
    interesting half of this file would never run.
    """

    def __enter__(self):
        self.was = who.now()
        who.unbind()
        return self

    def __exit__(self, *exc):
        if self.was is not None:
            who.bind(self.was)
        return False


def _link(owner, song, as_name=""):
    with who.acting_as(owner["id"]):
        made = sharing.make_share(Ask(body={"song": song, "as_name": as_name}))
    return made


# ── making one ───────────────────────────────────────────────────────────────

def test_sharing_without_a_handle_makes_a_link(owner_with_a_song):
    owner, song = owner_with_a_song
    made = _link(owner, song)
    assert made.get("token"), "no link came back: %s" % made
    assert made["path"] == "/#/join/" + made["token"], (
        "the link is not the route that opens it: %s" % made.get("path"))


def test_the_link_is_a_fragment_so_signing_in_keeps_it(owner_with_a_song):
    """The one kind of link that is always opened by somebody not signed in yet.

    A path is lost on the way to /login and a fragment is not, which is the whole reason
    the release before this one exists. Getting it wrong here would mean every guest signs
    in and lands on an empty library wondering what they clicked.
    """
    owner, song = owner_with_a_song
    assert _link(owner, song)["path"].startswith("/#/"), \
        "a share link that is not a fragment loses its destination at the door"


def test_only_the_digest_is_kept(owner_with_a_song):
    """The same rule invites follow. A row that holds a working link is a credential at
    rest in the one file every backup copies."""
    owner, song = owner_with_a_song
    made = _link(owner, song)
    row = accounts.share(made["share"])
    assert row is not None, "the share was not written down at all"
    assert row["token_digest"], "no digest was kept, so the link can never be matched"
    assert made["token"] not in row["token_digest"],         "the raw link is in accounts.db, which is the file every backup copies"
    # And it is the digest of that link rather than of something else.
    assert accounts.share_by_token(made["token"])["id"] == made["share"]


def test_an_unclaimed_link_share_is_in_nobodys_list(owner_with_a_song):
    """It belongs to nobody until somebody opens it, and it must not show up as a share
    with a mysterious empty recipient in the meantime."""
    owner, song = owner_with_a_song
    _link(owner, song)
    friend = accounts.create("jozsef", "another password", name="Jozsef")
    with who.acting_as(friend["id"]):
        assert sharing.shared_with_me(Ask())["shared"] == []


# ── opening one ──────────────────────────────────────────────────────────────

def test_the_invitation_says_who_sent_what(owner_with_a_song):
    owner, song = owner_with_a_song
    token = _link(owner, song)["token"]
    with nobody():
        seen = sharing.invitation(Ask(params={"token": token}))
    assert seen["song"]["title"] == "Kettle"
    assert seen["from"] in ("owner", "", "somebody") or seen["from"]
    assert seen["signed_in"] is False, \
        "nobody is signed in here, and the page needs to know to offer the long way round"


def test_somebody_with_an_account_takes_it(owner_with_a_song):
    owner, song = owner_with_a_song
    token = _link(owner, song)["token"]
    friend = accounts.create("jozsef", "another password", name="Jozsef")

    with who.acting_as(friend["id"]):
        got = sharing.accept(Ask(params={"token": token}))
        shown = sharing.shared_with_me(Ask())["shared"]

    assert got["share"], "accepting gave nothing back to open"
    assert [s["title"] for s in shown] == ["Kettle"], \
        "the song did not arrive in their list: %s" % shown


def test_somebody_with_no_account_makes_one_and_takes_it(owner_with_a_song):
    """The case the whole thing is for. No invite, no second message."""
    owner, song = owner_with_a_song
    token = _link(owner, song)["token"]

    with nobody():
        got = sharing.accept(Ask(params={"token": token},
                                 body={"handle": "vendeg", "password": "a password",
                                       "name": "Vendeg"}))
    assert getattr(got, "status", 200) == 200
    made = accounts.by_handle("vendeg")
    assert made, "no account was made, so the link cannot have been taken by anybody"

    with who.acting_as(made["id"]):
        shown = sharing.shared_with_me(Ask())["shared"]
    assert [s["title"] for s in shown] == ["Kettle"]


def test_making_an_account_this_way_hands_back_a_session(owner_with_a_song):
    """Otherwise they have just typed a password and are still signed out, looking at a
    song they own and cannot open."""
    owner, song = owner_with_a_song
    token = _link(owner, song)["token"]
    with nobody():
        got = sharing.accept(Ask(params={"token": token},
                                 body={"handle": "vendeg", "password": "a password"}))
    cookie = (getattr(got, "headers", {}) or {}).get("Set-Cookie", "")
    assert cookie, "no session came back, so the new account is signed out immediately"


def test_a_handle_is_required_rather_than_invented(owner_with_a_song):
    owner, song = owner_with_a_song
    token = _link(owner, song)["token"]
    with nobody():
        with pytest.raises(Error):
            sharing.accept(Ask(params={"token": token}, body={"password": "a password"}))


# ── spending it ──────────────────────────────────────────────────────────────

def test_a_link_opens_once(owner_with_a_song):
    """The one that matters. A link in a message gets forwarded."""
    owner, song = owner_with_a_song
    token = _link(owner, song)["token"]
    first = accounts.create("jozsef", "another password")
    second = accounts.create("someone", "a third password")

    with who.acting_as(first["id"]):
        sharing.accept(Ask(params={"token": token}))

    with who.acting_as(second["id"]):
        with pytest.raises(Error) as raised:
            sharing.accept(Ask(params={"token": token}))
    assert raised.value.status == 404

    with who.acting_as(second["id"]):
        assert sharing.shared_with_me(Ask())["shared"] == [], \
            "the second person to open a forwarded link got the song as well"


def test_two_people_opening_it_at_once_cannot_both_have_it(owner_with_a_song):
    """The guard underneath the one above, at the layer it lives in.

    Going through accept() cannot reach it: share_by_token refuses a share that already has
    an owner, so the second caller never gets as far as claiming. That is the right answer
    for a forwarded link and it hides the case where two people are a millisecond apart and
    both get past the lookup. Then the only thing between them is that exactly one UPDATE
    can match, so it is called here directly, twice.
    """
    owner, song = owner_with_a_song
    made = _link(owner, song)
    first = accounts.create("jozsef", "another password")
    second = accounts.create("someone", "a third password")

    assert accounts.claim_share(made["share"], first["id"]) is True, \
        "the first claim did not take"
    assert accounts.claim_share(made["share"], second["id"]) is False, (
        "a second claim on the same share succeeded. Two people opening one link at the"
        " same moment would both be given the song.")
    assert accounts.share(made["share"])["to_account"] == first["id"], \
        "the second claim overwrote the first"


def test_a_spent_link_cannot_even_be_read(owner_with_a_song):
    owner, song = owner_with_a_song
    token = _link(owner, song)["token"]
    friend = accounts.create("jozsef", "another password")
    with who.acting_as(friend["id"]):
        sharing.accept(Ask(params={"token": token}))
    with pytest.raises(Error):
        sharing.invitation(Ask(params={"token": token}))


def test_a_token_nobody_gave_out_is_refused(owner_with_a_song):
    with pytest.raises(Error) as raised:
        sharing.invitation(Ask(params={"token": "not-a-real-token"}))
    assert raised.value.status == 404


def test_every_way_a_link_can_be_closed_gives_the_same_answer(owner_with_a_song):
    """Used, taken back, and never real. A reply that tells them apart tells somebody
    feeding in guesses which ones were close."""
    owner, song = owner_with_a_song
    spent = _link(owner, song)["token"]
    friend = accounts.create("jozsef", "another password")
    with who.acting_as(friend["id"]):
        sharing.accept(Ask(params={"token": spent}))

    revoked = _link(owner, song)
    with who.acting_as(owner["id"]):
        sharing.revoke_share(Ask(params={"id": revoked["share"]}))

    answers = set()
    for token in (spent, revoked["token"], "never-existed", ""):
        with pytest.raises(Error) as raised:
            sharing.invitation(Ask(params={"token": token}))
        answers.add((raised.value.status, str(raised.value)))
    assert len(answers) == 1, \
        "a closed link is explained four different ways: %s" % sorted(answers)


def test_the_sharer_cannot_take_their_own_link(owner_with_a_song):
    owner, song = owner_with_a_song
    token = _link(owner, song)["token"]
    with who.acting_as(owner["id"]):
        with pytest.raises(Error):
            sharing.accept(Ask(params={"token": token}))


def test_taking_a_link_back_closes_it(owner_with_a_song):
    owner, song = owner_with_a_song
    made = _link(owner, song)
    with who.acting_as(owner["id"]):
        sharing.revoke_share(Ask(params={"id": made["share"]}))
    friend = accounts.create("jozsef", "another password")
    with who.acting_as(friend["id"]):
        with pytest.raises(Error):
            sharing.accept(Ask(params={"token": made["token"]}))


# ── the door ─────────────────────────────────────────────────────────────────

def test_the_invitation_answers_before_the_door():
    """It has to: somebody following a share link has no account yet by definition.

    Narrow on purpose. What stands in for the door is the token, so the opening is one
    prefix and not the whole of /api/shares.
    """
    assert any(u == "/api/shares/invitation/" for u in http.OPEN_API_UNDER), (
        "the invitation route is behind the door, so a guest is sent to /login and the"
        " link never says what it was for: %s" % (http.OPEN_API_UNDER,))


def test_the_rest_of_sharing_is_still_behind_the_door():
    """The prefix is an opening, and an opening that is wider than it looks is the way this
    goes wrong. /api/shares itself must not be reachable without a session."""
    for path in ("/api/shares", "/api/shared", "/api/shares/invitation"):
        assert not any(path.startswith(u) and len(path) > len(u)
                       for u in http.OPEN_API_UNDER), \
            "%s is open, which is more than the link needs" % path


def test_the_route_is_registered():
    routes = sharing.ROUTES()
    assert ("GET", "/api/shares/invitation/<token>") in routes
    assert ("POST", "/api/shares/invitation/<token>") in routes
