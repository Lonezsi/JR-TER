"""The terms and the privacy notice.

A notice is a claim about what the code does, and a claim nothing checks is a claim that
goes quietly false. These are the checks. The important one is the last: it reads every
outbound address out of the source and fails until the notice names it, so a feature that
starts talking to somewhere new cannot ship with a notice that still says it does not.
"""
import os
import re

import pytest

from jriter import config, registry

WEB = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "web")
ROOT = os.path.dirname(WEB)


def _read(name):
    with open(os.path.join(WEB, name), encoding="utf-8") as f:
        return f.read()


@pytest.fixture
def secured(server):
    """The same live server with the door loaded, so a request without a session is
    actually turned away."""
    from jriter.modules import auth
    registry.load(config.MODULES)
    auth._attempts.clear()
    yield server
    registry.load([m for m in config.MODULES if m != "auth"])


def test_the_notice_is_readable_without_signing_in(secured):
    """The person it is most for is the one deciding whether to hand anything over, and
    they do not have a password yet."""
    status, body = secured.get("/api/songs")
    assert status == 401, "the door was not actually shut, so this proved nothing"

    status, page = secured.get("/legal")
    assert status == 200
    text = page if isinstance(page, str) else page.decode("utf-8")
    assert "Terms and privacy" in text


def test_the_notice_says_nothing_about_the_library_it_belongs_to(secured):
    """Open to anyone who finds the address, so it must not answer any question about
    what is inside: not a title, not a count, not the library's name."""
    secured.post("/api/songs", {"title": "Kept back"})
    status, page = secured.get("/legal")
    text = (page if isinstance(page, str) else page.decode("utf-8"))
    assert "Kept back" not in text


def test_neither_page_in_front_of_the_door_calls_a_third_party():
    """Both are readable by anyone who reaches the address, including people who will
    never be let in, so a request to a third party from either one would carry their
    address somewhere before JR!TER had decided anything about them.

    The privacy notice states this about the door in as many words, which is the other
    reason it is checked: that sentence has to stay true.
    """
    for name in ("login.html", "legal.html"):
        page = _read(name)
        outside = [u for u in re.findall(r'(?:href|src)="(https?://[^"]+)"', page)]
        assert not outside, "%s reaches outside for %s" % (name, outside)


def test_the_notice_names_every_place_the_code_can_reach(request):
    """The one that keeps it honest.

    Every https host in the server and in the browser code has to appear in the notice.
    Add a feature that talks somewhere new and this fails until somebody has written the
    sentence saying so, which is the only way a list like that stays true past the day it
    was written.
    """
    notice = _read("legal.html")
    found = {}
    for here, dirs, names in os.walk(ROOT):
        dirs[:] = [d for d in dirs
                   if d not in (".git", "__pycache__", "tests", "hostsetup", "node_modules")]
        for name in names:
            if os.path.splitext(name)[1] not in (".py", ".js", ".html", ".css"):
                continue
            if name == "legal.html":
                continue                      # the notice naming a host is not a call to it
            path = os.path.join(here, name)
            with open(path, encoding="utf-8", errors="ignore") as f:
                body = f.read()
            for host in re.findall(r"https://([a-zA-Z0-9.-]+)", body):
                found.setdefault(host, set()).add(os.path.relpath(path, ROOT))

    # Hosts that appear in the source without this program ever contacting them, each with
    # the reason. A reason rather than a bare name, on the same grounds as export.SKIPPED:
    # a list of exceptions nobody had to justify is a list that grows until it means
    # nothing, and this one is the only thing standing between the notice and a quiet lie.
    NOT_A_CALL = {
        "www.youtube.com": "the watch URL of a published song, stored in the row and "
                           "shown as a link. Clicking it is the browser going there.",
        "youtu.be": "the same link, short form, in a placeholder",
        "console.cloud.google.com": "a link in the setup instructions",
        "www.w3.org": "the SVG namespace, which is an identifier and not an address",
        "example.invalid": "a test double's address, reserved and unroutable",
    }

    missing = {host: sorted(where) for host, where in found.items()
               if host not in NOT_A_CALL and host not in notice}
    assert not missing, (
        "these hosts are reached by the code and are not named in web/legal.html, so the "
        "privacy notice is now untrue: %s" % missing)


def test_the_notice_does_not_borrow_a_class_the_app_already_uses():
    """It wears the whole application stylesheet, so a bare class name here is a name
    shared with the app.

    The first version called its container .sheet, which is the app's modal dialog. It
    inherited max-height 84dvh and overflow-y auto, became an 806 pixel scroll box inside
    a page that did not scroll, and most of the notice could not be reached at all. This
    is the check that stops the next name doing the same thing.
    """
    page = _read("legal.html")
    css = ""
    folder = os.path.join(WEB, "css")
    for name in sorted(os.listdir(folder)):
        with open(os.path.join(folder, name), encoding="utf-8") as f:
            css += f.read()
    app = set(re.findall(r"\.([a-zA-Z][\w-]*)", css))

    # Only the classes the page puts on elements, not the ones inside its own <style>.
    markup = page[page.index("</style>"):]
    mine = set()
    for group in re.findall(r'class="([^"]+)"', markup):
        mine.update(group.split())

    # Deliberately shared: these are the app's own tokens, borrowed on purpose.
    BORROWED = {"rest"}
    clash = (mine & app) - BORROWED
    assert not clash, (
        "web/legal.html uses class names the app's stylesheet already styles, so the page "
        "silently inherits whatever those rules do: %s" % sorted(clash))
