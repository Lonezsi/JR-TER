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
        "www.instagram.com": "the author's profile, linked from the about page. Following "
                             "it is the browser going there, and it is the only thing on "
                             "that page that leaves.",
        "www.w3.org": "the SVG namespace, which is an identifier and not an address",
        "example.invalid": "a test double's address, reserved and unroutable",
        "svelte.dev": "inside the framework's own error messages in the built interface, "
                      "as text a developer reads in a console when something throws. The "
                      "page never requests it.",
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


def _ui(*parts):
    with open(os.path.join(ROOT, "ui", "src", *parts), encoding="utf-8") as f:
        return f.read()


def test_there_are_ways_to_the_notice_and_none_of_them_is_hidden():
    """A notice nobody can find is the same as no notice.

    Three, because each answers a different moment: the door, for somebody deciding
    whether to hand anything over; the sidebar, which is on every screen; and Settings,
    for whoever went looking for it there. Removing any of them is silent in a browser,
    so it is checked here instead.
    """
    door = _read("login.html")
    assert 'href="/legal"' in door, "the door no longer offers the terms"

    sidebar = _ui("shell", "Sidebar.svelte")
    assert re.search(r'<a href="/legal"[^>]*>Terms</a>', sidebar), \
        "the sidebar no longer links to the terms"
    assert 'title="Terms and privacy"' in sidebar

    assert 'href="/legal"' in _ui("views", "settings", "About.svelte"), \
        "Settings, About no longer links to the terms"


def test_a_link_to_the_notice_leaves_the_app_in_a_new_tab():
    """/legal is a page of its own, not a route: it has to be a real navigation, and in a
    new tab so that it never costs somebody the song or the unsaved words they were on.

    That is also why the old lyric editor's history.back() trick, which cancelled a link
    that left the document, has no counterpart: nothing here pushes a history entry.
    """
    for where in (("shell", "Sidebar.svelte"), ("views", "settings", "About.svelte"),
                  ("views", "settings", "Library.svelte")):
        for link in re.findall(r'<a [^>]*href="/legal"[^>]*>', _ui(*where)):
            assert 'target="_blank"' in link and "noopener" in link, (
                "%s opens the notice in the app's own tab, or without noopener: %s"
                % ("/".join(where), link))


def test_no_stylesheet_reaches_for_a_token_that_does_not_exist():
    """A var() naming nothing is the quietest possible failure.

    The rule does not error, does not warn, and does not apply: the property keeps
    whatever it inherited, so the page looks almost right and nobody looks twice. This
    happened. --text-1 was invented by pattern from --text-2 and --text-3, which do
    exist, and shipped in four rules across two files.

    The TypeScript and the components count as definitions. Several properties are only
    ever set as an inline style (style:--hue, setProperty) on the element that needs them,
    which is the right way to hand a number from a layout to a stylesheet, and a check
    that only read the CSS would call every one of those a fault.
    """
    def collect(folder, exts):
        out = ""
        for here, dirs, names in os.walk(folder):
            dirs[:] = [d for d in dirs if d != "node_modules"]
            for name in sorted(names):
                if os.path.splitext(name)[1] in exts:
                    with open(os.path.join(here, name), encoding="utf-8") as f:
                        out += f.read()
        return out

    everything = collect(os.path.join(ROOT, "ui", "src"), (".css", ".svelte", ".ts"))
    everything += collect(os.path.join(WEB, "css"), (".css",))
    everything += "".join(_read(n) for n in ("legal.html", "login.html", "index.html"))
    # The material first: it defines most of the tokens now and a var() naming one of
    # them is not a fault. Without this the check would report the whole shared palette
    # as undefined.
    material = os.path.join(os.path.dirname(ROOT), "foyer", "shared", "glass.css")
    if os.path.isfile(material):
        with open(material, encoding="utf-8") as f:
            everything += f.read()

    defined = set(re.findall(r"(--[\w-]+)\s*:", everything))
    defined |= set(re.findall(r"""setProperty\(\s*["'](--[\w-]+)""", everything))
    # style:--name={...} and style="--name: ..." in markup.
    defined |= set(re.findall(r"style:(--[\w-]+)", everything))
    used = set(re.findall(r"var\(\s*(--[\w-]+)", everything))
    # A var() carrying its own fallback is not relying on the name being there.
    with_fallback = set(re.findall(r"var\(\s*(--[\w-]+)\s*,", everything))

    missing = sorted((used - defined) - with_fallback)
    assert not missing, (
        "these custom properties are used but never defined, so every rule that reaches "
        "for one silently keeps whatever it inherited: %s" % missing)
