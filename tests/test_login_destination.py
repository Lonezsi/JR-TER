"""Signing in should leave you where you were trying to go.

The server sends an unauthenticated caller to /login and keeps the fragment, so a link to
https://<host>/#/orarend arrives as /login#/orarend with the destination intact. The login
page then finished with location.href = "/" and threw it away: you signed in and landed on
the library wondering what you had clicked.

It is not about one screen. Every deep link into this app lost its destination at the door,
and the one kind of link that is always opened by somebody not yet signed in is a share.

WHY THIS IS A SECURITY TEST AS WELL. "Send them where they were going" is the usual shape of
an open redirect: take a target out of the address bar, and somebody can put their own
address in it and borrow this domain's good name for a phishing page. Only the fragment is
carried, which cannot leave the origin, and only when it looks like one of this app's own
routes.

The function is run rather than read. A regex that looks right and matches the wrong thing
is exactly the failure this is guarding against.
"""
import io
import json
import os
import re
import shutil
import subprocess
import sys

import pytest

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
LOGIN = os.path.join(ROOT, "web", "login.html")


def onwards(hash_value):
    """What the real function returns for a given location.hash."""
    node = shutil.which("node")
    if not node:
        pytest.fail("node is not on PATH, so this checks the function by not running it")

    source = io.open(LOGIN, encoding="utf-8").read()
    found = re.search(r"function onwards\(\) \{.*?\n  \}", source, flags=re.S)
    assert found, "login.html no longer has an onwards()"

    # The real declaration, with a location in front of it and a call after it. Lifted out
    # of the page rather than copied into this file, so what runs here is what ships.
    script = ("const location = { hash: %s };\n" % json.dumps(hash_value)
              + found.group(0) + "\nprocess.stdout.write(onwards());")
    out = subprocess.run([node, "-e", script], capture_output=True)
    assert out.returncode == 0, out.stderr.decode("utf-8", "replace")
    return out.stdout.decode("utf-8")


def test_a_route_is_carried_through_the_door():
    """The whole point: the link from Foyer lands on the timetable, not the library."""
    assert onwards("#/orarend") == "/#/orarend"
    assert onwards("#/song/42") == "/#/song/42"
    assert onwards("#/shared/abc123") == "/#/shared/abc123"
    assert onwards("#/?q=caramel") == "/#/?q=caramel"


def test_no_destination_is_still_the_library():
    assert onwards("") == "/"
    assert onwards("#") == "/"


@pytest.mark.parametrize("nasty", [
    "#//evil.example.com",
    "#/\\evil.example.com",
    "#https://evil.example.com",
    "#javascript:alert(1)",
    "#/</script><script>alert(1)</script>",
    "#/ onmouseover=alert(1)",
    "#/\"",
])
def test_nothing_but_one_of_this_apps_routes_gets_through(nasty):
    """The shape "send them where they were going" is how open redirects are built.

    A fragment cannot leave this origin whatever it says, so the worst case here is landing
    on a route that does not exist. The pattern is kept tight anyway: the reason this is
    safe should be two things and not one, because the day somebody changes this to read a
    query parameter instead, the fragment's own harmlessness is gone and only the pattern
    is left.
    """
    got = onwards(nasty)
    assert got in ("/", "/" + nasty), "onwards() invented a destination: %r" % got
    if got != "/":
        # It was allowed through, so it must be a route this app could actually serve and
        # nothing else: no scheme, no host, no markup.
        assert not re.search(r"[<>\"'\\\s]", got), \
            "a destination with markup or whitespace in it got through: %r" % got
        assert "//" not in got[1:], \
            "a protocol relative address got through: %r" % got
        assert ":" not in got, "a scheme got through: %r" % got


def test_the_page_does_not_send_you_to_the_library_any_other_way():
    """One way out, so a second one cannot quietly not carry the destination.

    There were two redirects in this file, one for arriving already signed in and one for
    signing in, and both said location.href = "/". A third would be added the same way.
    """
    source = io.open(LOGIN, encoding="utf-8").read()
    # Comments first. The paragraph above onwards() quotes the line it replaced in order to
    # say why, and a test that searches for the shape of a bug finds the explanation of the
    # bug. This file has caught that twice elsewhere.
    code = re.sub(r"/\*.*?\*/", "", source, flags=re.S)
    code = re.sub(r"<!--.*?-->", "", code, flags=re.S)
    code = re.sub(r"^\s*//.*$", "", code, flags=re.M)
    stray = re.findall(r'location\.href\s*=\s*"[^"]*"', code)
    assert not stray, (
        "login.html sets location.href to a literal in %d place(s): %s. Every way out of"
        " this page has to carry the destination, or the one that does not is the one"
        " somebody arrives through." % (len(stray), stray))
    assert source.count("location.href = onwards()") == 2, (
        "the two ways out of the login page are no longer both going through onwards()")
