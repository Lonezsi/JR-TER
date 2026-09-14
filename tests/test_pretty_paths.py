"""Screens with an address of their own.

The tunnel puts this app at / and Foyer at /foyer on one hostname, so the timetable has to
be something you can type, send, or keep on a home screen. Inside, the app routes on the
fragment, so a pretty path is one redirect rather than a second router that could disagree
with the first about what /orarend means.

WHERE THE REDIRECT HAPPENS IS THE WHOLE POINT. It is answered above the door. An
unauthenticated caller is sent to /login, and a path does not survive that: the server never
learns it again and the login page has nothing to go back to. A fragment does survive,
because a browser never sends one to a server at all and carries it across every redirect on
the way. So the path becomes a fragment first, and /orarend signed out arrives at
/login#/orarend, which the login page already knows how to finish.

That last part is not hypothetical. The release before this one exists because signing in
threw away where you were going, and it was found by following exactly this kind of link
from a signed out phone.
"""
import io
import os
import re

import pytest

from jriter import config, registry, http


HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


@pytest.fixture
def secured(server):
    """The same live server, with the door loaded."""
    registry.load(config.MODULES)
    yield server
    registry.load([m for m in config.MODULES if m != "auth"])


def _raw(client, path):
    """One GET that does not follow redirects, so the hop itself can be read."""
    import urllib.request
    import urllib.error

    class Keep(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *args, **kwargs):
            return None

    opener = urllib.request.build_opener(Keep)
    try:
        with opener.open(client.base + path, timeout=10) as response:
            return response.status, dict(response.headers)
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers)


def test_there_is_at_least_one_pretty_path():
    """Otherwise everything below passes by having nothing to check."""
    assert http.PRETTY, "no screen has an address of its own any more"
    assert "/orarend" in http.PRETTY, \
        "the timetable has no address of its own: %s" % sorted(http.PRETTY)


def test_a_pretty_path_sends_you_to_the_screen(server):
    """Signed in, or on a library with no door at all."""
    for path, target in sorted(http.PRETTY.items()):
        status, headers = _raw(server, path)
        assert status in (301, 302, 303, 307, 308), (
            "%s answered %d rather than redirecting, so it is being served as a file or as"
            " the app's shell with no idea which screen was wanted" % (path, status))
        assert headers.get("Location") == target, (
            "%s points at %r and should point at %r"
            % (path, headers.get("Location"), target))


def test_every_pretty_path_points_at_a_fragment():
    """A path would be lost at the door, which is the entire reason this is a fragment.

    Written as a test rather than a comment because the redirect works perfectly well with
    a path in it right up until somebody opens the link signed out, which is the one case
    it exists for and the least likely to be tried.
    """
    for path, target in sorted(http.PRETTY.items()):
        assert target.startswith("/#/"), (
            "%s redirects to %r. A path does not survive the trip to /login and a fragment"
            " does, so signing in would land on the library instead." % (path, target))


def test_a_pretty_path_survives_being_signed_out(secured):
    """The case it is for, and the one that is easy to get wrong.

    Answered above the door, so a signed out caller still gets the redirect rather than
    being sent straight to /login with nothing to say where they meant to go. What happens
    next is the browser's: it carries the fragment onto /login by itself.
    """
    for path, target in sorted(http.PRETTY.items()):
        status, headers = _raw(secured, path)
        assert status in (301, 302, 303, 307, 308), (
            "signed out, %s answered %d. If that is the redirect to /login then the"
            " destination has already been thrown away." % (path, status))
        assert headers.get("Location") == target, (
            "signed out, %s points at %r rather than %r, so signing in lands somewhere"
            " else" % (path, headers.get("Location"), target))


def test_the_route_each_one_opens_is_a_screen_that_exists():
    """A redirect to a route nothing draws is a link that opens the missing screen.

    Read off the view files rather than a list here, so adding a pretty path for a screen
    that was never built fails instead of shipping.
    """
    views = set()
    js = os.path.join(HERE, "web", "js")
    for name in sorted(os.listdir(js)):
        if not name.endswith(".js"):
            continue
        source = io.open(os.path.join(js, name), encoding="utf-8").read()
        views |= set(re.findall(r"J\.views\.(\w+)\s*=", source))
        views |= set(re.findall(r"J\.views\[[\"'](\w+)[\"']\]\s*=", source))
    assert views, "no views were found at all, so this test cannot say anything"

    for path, target in sorted(http.PRETTY.items()):
        view = target.split("#/")[-1].split("/")[0].split("?")[0]
        assert view in views, (
            "%s opens #/%s and no file registers a view called that, so the link lands on"
            " the missing screen. Views found: %s"
            % (path, view, ", ".join(sorted(views))))


def test_a_pretty_path_is_not_also_a_file(secured):
    """web/ is served for unknown paths, so a file of the same name would win quietly.

    Nothing is called orarend today. This is here because the failure would be a page that
    works for one person and not another depending on what is on disk.
    """
    for path in http.PRETTY:
        on_disk = os.path.join(config.WEB, path.lstrip("/"))
        assert not os.path.exists(on_disk), (
            "%s exists in web/, so it is served instead of redirecting" % on_disk)
