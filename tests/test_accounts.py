"""Several people on one server, and the wall between them.

This is the file that matters most in the project. Everything else here is about a feature
being right; these are about one person not being able to read another person's music.

The wall is structural rather than checked: an account's library is its own SQLite file, so
a query written with no thought for accounts at all still cannot reach rows that are not in
the file it opened. What these tests hold down is the small number of places that decide
*which file*, because that is the only way the wall can fail.
"""
import os
import time

import pytest

from jriter import config, db, who, accounts
from jriter.modules import auth


@pytest.fixture
def two_people():
    """An owner and a friend, each with a library of their own."""
    owner = accounts.create("owner", "the owner's password", account_id=accounts.OWNER)
    friend = accounts.create("jozsef", "the friend's password", name="Jozsef")
    return owner, friend


def _song(title):
    now = time.time()
    return db.insert("songs", {"title": title, "created_at": now, "updated_at": now})


# ── the wall ─────────────────────────────────────────────────────────────────
def test_two_accounts_do_not_share_a_library(two_people):
    owner, friend = two_people

    with who.acting_as(owner["id"]):
        _song("The owner's demo")
        mine = [r["title"] for r in db.query("SELECT title FROM songs")]

    with who.acting_as(friend["id"]):
        theirs = [r["title"] for r in db.query("SELECT title FROM songs")]
        _song("A friend's track")

    with who.acting_as(owner["id"]):
        still = [r["title"] for r in db.query("SELECT title FROM songs")]

    assert mine == ["The owner's demo"]
    assert theirs == [], "a new account opened with somebody else's songs in it"
    assert still == ["The owner's demo"], "the friend's song landed in the owner's library"


def test_the_libraries_are_separate_files(two_people):
    owner, friend = two_people
    assert config.db_path(owner["id"]) != config.db_path(friend["id"])
    assert config.blobs_dir(owner["id"]) != config.blobs_dir(friend["id"])
    # And neither is inside the other, which a naive join could manage.
    assert not config.home(friend["id"]).startswith(config.home(owner["id"]) + os.sep)


def test_a_new_account_gets_the_whole_schema(two_people):
    """An account made on Tuesday needs the same tables as one made a year ago.

    The schema used to be applied once, at startup, against the single library. It is now
    applied the first time each library is opened, and forgetting that would mean every
    friend's first request failing on a missing table.
    """
    _, friend = two_people
    with who.acting_as(friend["id"]):
        # A query, so the file is actually opened and prepared.
        db.query("SELECT 1")
        tables = {r["name"] for r in db.query(
            "SELECT name FROM sqlite_master WHERE type = 'table'")}
    for wanted in ("songs", "versions", "albums", "lyric_sheets", "sound_presets"):
        assert wanted in tables, "%s is missing from a new account's library" % wanted


def test_an_unbound_thread_refuses_rather_than_guessing(two_people):
    """The single most important line in the design.

    If an unbound thread quietly fell back to the owner, then any path where the binding
    failed to happen would serve the owner's library to whoever asked. It raises instead, so
    that mistake is a 500 rather than a disclosure.
    """
    was = who.now()
    who.unbind()
    try:
        with pytest.raises(who.Unbound):
            db.query("SELECT 1")
        with pytest.raises(who.Unbound):
            config.db_path()
    finally:
        who.bind(was)


def test_acting_as_puts_back_whoever_was_there(two_people):
    """Reading a shared song happens inside acting_as, in the middle of a request that
    belongs to somebody else. Coming out of it has to hand the request back."""
    owner, friend = two_people
    who.bind(owner["id"])
    with who.acting_as(friend["id"]):
        assert who.now() == friend["id"]
    assert who.now() == owner["id"], "acting_as left the thread pointed at the wrong person"


def test_acting_as_puts_it_back_even_when_the_body_raises(two_people):
    owner, friend = two_people
    who.bind(owner["id"])
    with pytest.raises(ValueError):
        with who.acting_as(friend["id"]):
            raise ValueError("something went wrong mid share")
    assert who.now() == owner["id"]


def test_one_thread_serving_two_people_in_turn_does_not_leak(two_people):
    """The reason the connection cache is keyed by account.

    A server thread finishes one request and picks up the next, which belongs to somebody
    else as often as not. A single cached connection per thread would hand the second
    request the first person's library, and no query anywhere would notice.
    """
    owner, friend = two_people
    with who.acting_as(owner["id"]):
        _song("Owner only")
    # Same thread, no close in between: exactly what a request boundary looks like.
    with who.acting_as(friend["id"]):
        assert db.query("SELECT title FROM songs") == []
    with who.acting_as(owner["id"]):
        assert len(db.query("SELECT title FROM songs")) == 1


# ── passwords and handles ────────────────────────────────────────────────────
def test_a_password_is_never_stored(two_people):
    owner, _ = two_people
    row = accounts.by_id(owner["id"])
    assert "the owner's password" not in str(dict(row))
    assert accounts.check(row, "the owner's password")
    assert not accounts.check(row, "the friend's password")


def test_public_never_carries_the_secret_or_the_hash(two_people):
    owner, _ = two_people
    shown = accounts.public(accounts.by_id(owner["id"]))
    for leak in ("hash", "salt", "secret"):
        assert leak not in shown, "public() hands out %s" % leak


def test_handles_are_tidied_and_checked():
    assert accounts.tidy_handle("  Jozsef  ") == "jozsef"
    for bad in ("", "   ", "has a space", "slash/es", "x" * 40, "at@sign"):
        with pytest.raises(Exception):
            accounts.tidy_handle(bad)


def test_two_accounts_cannot_share_a_handle(two_people):
    with pytest.raises(Exception):
        accounts.create("jozsef", "another password")


# ── sessions ─────────────────────────────────────────────────────────────────
def test_a_cookie_says_whose_it_is(two_people):
    owner, friend = two_people
    assert auth.whose(auth.issue(owner["id"])) == owner["id"]
    assert auth.whose(auth.issue(friend["id"])) == friend["id"]


def test_a_cookie_cannot_be_edited_to_name_somebody_else(two_people):
    """The obvious attack: take your own cookie and change the number in it."""
    owner, friend = two_people
    mine = auth.issue(friend["id"])
    issued, said, nonce, signature = mine.split(".")
    forged = "%s.%d.%s.%s" % (issued, owner["id"], nonce, signature)
    assert auth.whose(forged) is None


def test_changing_one_password_does_not_sign_out_everybody(two_people):
    """It used to. There was one secret, so rotating it ended every session on the server,
    and with one user nobody could tell that was wrong."""
    owner, friend = two_people
    mine = auth.issue(owner["id"])
    theirs = auth.issue(friend["id"])

    accounts.set_password(friend["id"], "a new one")
    accounts.sign_out_everywhere(friend["id"])

    assert auth.whose(theirs) is None, "their own session survived their password change"
    assert auth.whose(mine) == owner["id"], "somebody else's password change signed me out"


def test_a_cookie_for_a_deleted_account_is_not_a_session(two_people):
    _, friend = two_people
    token = auth.issue(friend["id"])
    accounts._run("DELETE FROM accounts WHERE id = ?", (friend["id"],))
    assert auth.whose(token) is None


def test_a_session_from_before_accounts_still_signs_the_owner_in(two_people):
    """A rename that signs everybody out on the morning it lands looks like a bug.

    The old cookie was issued.nonce.signature with no account in it, signed with the server
    secret alone. The library it was for is exactly the one that becomes account 1.
    """
    import hmac
    import hashlib
    owner, _ = two_people
    issued = str(int(time.time()))
    nonce = "abcdef0123456789"
    body = "%s.%s" % (issued, nonce)
    signature = hmac.new(auth._secret(), body.encode(), hashlib.sha256).hexdigest()[:32]
    assert auth.whose("%s.%s" % (body, signature)) == accounts.OWNER


def test_an_old_cookie_still_has_to_be_signed(two_people):
    assert auth.whose("1700000000.abcdef0123456789.notasignatureatall") is None


# ── invites ──────────────────────────────────────────────────────────────────
def test_an_invite_works_once(two_people):
    owner, _ = two_people
    code = accounts.make_invite(owner["id"], note="for a friend")
    invite = accounts.invite_for(code)
    assert invite is not None
    accounts.spend_invite(invite["id"], 99)
    assert accounts.invite_for(code) is None, "an invite was accepted twice"


def test_an_invite_that_was_never_given_out_is_not_accepted(two_people):
    assert accounts.invite_for("0000-1111-2222") is None
    assert accounts.invite_for("") is None


def test_an_expired_invite_is_not_accepted(two_people):
    owner, _ = two_people
    code = accounts.make_invite(owner["id"], days=1)
    invite = accounts.invite_for(code)
    accounts._run("UPDATE invites SET expires_at = ? WHERE id = ?",
                  (time.time() - 60, invite["id"]))
    assert accounts.invite_for(code) is None


def test_the_code_itself_is_not_kept(two_people):
    """Only a digest, the same as a password and a machine token."""
    owner, _ = two_people
    code = accounts.make_invite(owner["id"])
    rows = accounts._query("SELECT * FROM invites")
    assert code not in str(rows)


def test_listing_invites_never_shows_the_digest(two_people):
    owner, _ = two_people
    accounts.make_invite(owner["id"])
    for row in accounts.invites_by(owner["id"]):
        assert "digest" not in row


# ── machine tokens ───────────────────────────────────────────────────────────
def test_a_token_reaches_only_its_own_library(two_people):
    owner, friend = two_people
    with who.acting_as(owner["id"]):
        raw = auth.make_token("the owner's laptop", account_id=owner["id"])

    headers = {"X-Jriter-Token": raw}
    assert auth.token_account(headers, "GET", "/api/state") == owner["id"]
    assert auth.token_account(headers, "GET", "/api/state") != friend["id"]


def test_a_token_still_cannot_reach_past_its_scope(two_people):
    owner, _ = two_people
    raw = auth.make_token("an agent", account_id=owner["id"])
    assert auth.token_account({"X-Jriter-Token": raw}, "GET", "/api/state") == owner["id"]
    # Not in the upload scope's list, so it is nobody's.
    assert auth.token_account({"X-Jriter-Token": raw}, "DELETE", "/api/songs/1") is None


def test_an_unknown_token_is_nobody(two_people):
    assert auth.token_account({"X-Jriter-Token": "jt_nothing"}, "GET", "/api/state") is None
    assert auth.token_account({}, "GET", "/api/state") is None


def test_revoking_is_scoped_to_the_account(two_people):
    """An id guessed off another library must revoke nothing."""
    owner, friend = two_people
    raw = auth.make_token("the owner's laptop", account_id=owner["id"])
    held = accounts.tokens_of(owner["id"])[0]

    accounts.drop_token(held["id"], friend["id"])
    assert accounts.tokens_of(owner["id"]), "somebody else revoked my machine's credential"

    accounts.drop_token(held["id"], owner["id"])
    assert not accounts.tokens_of(owner["id"])
    assert auth.token_account({"X-Jriter-Token": raw}, "GET", "/api/state") is None
