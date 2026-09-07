"""Signing in to Google with the browser rather than a typed code.

No request reaches Google in here. What is checked is the part that is ours: the address
Google is told to come back to, and the state nonce, which is the only thing standing
between this endpoint and somebody else's account being attached to your library.
"""
import os
import urllib.parse

import pytest

from jriter import config
from jriter.modules import youtube


class Req:
    """Just enough of a request for these two functions."""

    def __init__(self, headers=None, query=None, body=None):
        self.headers = headers or {}
        self.query = query or {}
        self._body = body or {}

    def q(self, name):
        return self.query.get(name)

    def json(self):
        return self._body


def _fresh():
    """No account file, so each of these starts from nothing."""
    try:
        os.remove(youtube._account_path())
    except OSError:
        pass


def test_the_address_google_is_told_follows_the_one_you_arrived_on():
    """The whole reason this flow could not exist before.

    A redirect address is registered in advance and matched exactly, so a single written
    down value works from one of this library's three addresses and fails from the other
    two.
    """
    at_machine = youtube._return_to(Req({"Host": "127.0.0.1:7900"}))
    assert at_machine == "http://127.0.0.1:7900/api/youtube/auth/return"

    # Through the funnel. No X-Forwarded-Proto from that tunnel, and a name that is not
    # the loopback is not plain http.
    public = youtube._return_to(Req({"Host": "jriter.dikdik-kettle.ts.net"}))
    assert public == "https://jriter.dikdik-kettle.ts.net/api/youtube/auth/return"

    # A proxy that has terminated TLS is believed over the guess.
    behind = youtube._return_to(Req({"Host": "example.test",
                                     "X-Forwarded-Proto": "http"}))
    assert behind.startswith("http://")


def test_a_host_that_could_smuggle_a_path_is_refused():
    """It is only ever handed to Google, who would refuse it, but a Host header is
    somebody else's to set and this is the one place it is interpolated."""
    from jriter.wire import Error
    for bad in ("evil.test/../..", "evil.test\\x", ""):
        with pytest.raises(Error):
            youtube._return_to(Req({"Host": bad}))


def test_the_sign_in_url_asks_for_a_refresh_token_and_carries_a_state():
    """Two things Google will not give you unless asked, and one that protects the
    endpoint that receives the answer.

    Without access_type=offline and prompt=consent, every sign in after the first hands
    back an access token and no refresh token, and this library has to be able to upload
    next week without asking again.
    """
    _fresh()
    said = youtube.auth_start(Req({"Host": "127.0.0.1:7900"},
                                  body={"client_id": "cid.apps.googleusercontent.com",
                                        "client_secret": "sec", "name": "my channel"}))
    parts = urllib.parse.parse_qs(urllib.parse.urlparse(said["url"]).query)
    assert said["url"].startswith(youtube.AUTH_URL)
    assert parts["access_type"] == ["offline"]
    assert parts["prompt"] == ["consent"]
    assert parts["response_type"] == ["code"]
    assert parts["scope"] == [youtube.SCOPE]
    assert parts["redirect_uri"] == ["http://127.0.0.1:7900/api/youtube/auth/return"]

    state = parts["state"][0]
    assert len(state) >= 20, "a guessable state is no state at all"
    # And it is the one the server is now waiting for.
    assert youtube._all()["pending"]["state"] == state


def test_a_return_with_the_wrong_state_connects_nothing():
    """The one thing this endpoint must never get wrong.

    It is a GET behind a SameSite=Lax cookie, which means a top level navigation from
    anywhere carries the session. Without the state check, getting the owner's browser to
    load this path with a code attached is enough to bolt somebody else's channel onto
    their library.
    """
    _fresh()
    youtube.auth_start(Req({"Host": "127.0.0.1:7900"},
                           body={"client_id": "cid", "client_secret": "sec"}))
    answer = youtube.auth_return(Req({"Host": "127.0.0.1:7900"},
                                     query={"code": "someone-elses", "state": "guessed"}))
    assert answer.status == 302
    assert answer.headers["Location"].startswith("/#/?connect=")
    assert "did not match" in urllib.parse.unquote(answer.headers["Location"])
    # Nothing was attached, and the attempt is spent rather than left for a second try.
    held = youtube._all()
    assert held["accounts"] == {}
    assert "pending" not in held


def test_a_state_cannot_be_answered_twice():
    """A replay of a real return is a second sign in nobody asked for."""
    _fresh()
    said = youtube.auth_start(Req({"Host": "127.0.0.1:7900"},
                                  body={"client_id": "cid", "client_secret": "sec"}))
    state = urllib.parse.parse_qs(
        urllib.parse.urlparse(said["url"]).query)["state"][0]

    # Google refusing is the cheapest way to reach the end of the handler without a
    # network call: the state matched, so the spending happens either way.
    first = youtube.auth_return(Req({"Host": "127.0.0.1:7900"},
                                    query={"state": state, "error": "access_denied"}))
    assert "refused" in urllib.parse.unquote(first.headers["Location"])

    again = youtube.auth_return(Req({"Host": "127.0.0.1:7900"},
                                    query={"state": state, "code": "x"}))
    assert "Nothing was waiting" in urllib.parse.unquote(again.headers["Location"])


def test_the_code_flow_and_the_browser_flow_do_not_tread_on_each_other():
    """Both park a half finished sign in in the same place, and they are not the same
    shape. Polling the code endpoint during a browser sign in used to be a KeyError."""
    from jriter.wire import Error
    _fresh()
    youtube.auth_start(Req({"Host": "127.0.0.1:7900"},
                           body={"client_id": "cid", "client_secret": "sec"}))
    with pytest.raises(Error) as caught:
        youtube.finish(Req({"Host": "127.0.0.1:7900"}))
    assert "in the browser" in str(getattr(caught.value, "message", caught.value))


def test_the_page_is_told_every_address_to_register():
    """Getting one character wrong here is the likeliest way for this to fail, and the
    message Google gives names the address it expected, which is the one thing it cannot
    know. So the page shows them rather than describing them."""
    said = youtube.auth_addresses(Req({"Host": "jriter.dikdik-kettle.ts.net"}))
    assert said["here"] in said["register"]
    assert any("127.0.0.1" in one for one in said["register"]), (
        "the loopback is missing, and it is the one you use while setting this up")
    assert all(one.endswith(youtube.RETURN_PATH) for one in said["register"])
