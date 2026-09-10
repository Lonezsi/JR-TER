"""The desktop app opens the library rather than drawing its own version of it.

It used to draw its own: a tkinter window with its own background, panel, line and accent
colours. That is a second design system, and it was not kept in step with the first one.
Changing the accent in Settings changed the library and left the desktop app the old
green, because nothing in it read the stylesheet and nothing in it could.

So the thing worth testing is not how it looks, it is that it has no opinion about how it
looks: no palette of its own, and a window that is the real page.

There were no tests for this file at all before, which is part of how it drifted.
"""
import io
import os
import re
import sys

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(HERE, "client"))

import jriter_app   # noqa: E402

APP = os.path.join(HERE, "client", "jriter_app.py")
#: Where the accent is defined, which is the shared material rather than this repo.
TOKENS = os.path.join(os.path.dirname(HERE), "foyer", "shared", "glass.css")


def _source():
    return io.open(APP, encoding="utf-8").read()


def _code():
    """The source with its docstrings and comments out.

    The history of why this changed is written in the docstrings, and it names the colours
    it used to hardcode. A test searching for hex codes has to read the code only, or the
    explanation of the bug trips the test for the bug.
    """
    source = re.sub(r'"""(?:.|\n)*?"""', '""', _source())
    return re.sub(r"^\s*#.*$", "", source, flags=re.M)


def test_the_desktop_app_holds_no_colours_of_its_own():
    """No palette, because a second palette is a second thing to keep in step.

    Any hex colour in this file is one that cannot follow the accent, since this process
    never reads the stylesheet. The library's own tokens are the only place a colour
    belongs.
    """
    found = re.findall(r"#[0-9A-Fa-f]{6}\b", _code())
    assert not found, (
        "client/jriter_app.py names %d colour(s) of its own: %s. Nothing here can read"
        " the stylesheet, so a colour written here stays whatever it was on the day it"
        " was typed, which is how this app was still green after the accent became pink."
        % (len(found), ", ".join(sorted(set(found)))))


def test_it_does_not_build_a_second_interface():
    """tkinter is the tell. A window it draws is a window it has to style."""
    code = _code()
    for banned in ("import tkinter", "tk.Tk(", "tk.Label", "tk.Button", "ttk."):
        assert banned not in code, (
            "client/jriter_app.py still uses %r, which means it is drawing an interface"
            " rather than opening the one that exists." % banned)


def test_the_window_is_the_real_page():
    """--app is what makes a browser window a window rather than a tab.

    Without it this is "we open your browser", which is not a desktop app. With it there
    is no tab strip and no address bar, and the window wears the page's own favicon and
    theme colour, so the app looks like the app by construction.
    """
    command = jriter_app.window_command("http://libr.ary:7900", "C:/edge.exe", "C:/prof")
    assert command[0] == "C:/edge.exe"
    joined = " ".join(command)
    assert "--app=http://libr.ary:7900" in joined, (
        "the window is not opened with --app, so it is a browser tab: %s" % joined)
    assert "--user-data-dir=C:/prof" in joined, (
        "no profile of its own, so the window depends on which browser session happens to"
        " be open and can inherit an extension that rewrites the page: %s" % joined)


def test_a_machine_with_no_chromium_browser_still_gets_the_library(monkeypatch):
    """A tab is the fallback and not a failure.

    Falling back matters more than the window does: a machine with neither Edge nor Chrome
    nor Brave should still be a machine that can open its own library.
    """
    opened = []
    monkeypatch.setattr(jriter_app, "find_browser", lambda: None)
    monkeypatch.setattr(jriter_app.webbrowser, "open", lambda url: opened.append(url))
    got = jriter_app.open_window("http://libr.ary:7900")
    assert got is None, "it claimed to have opened a window with no browser to open one"
    assert opened == ["http://libr.ary:7900"], \
        "no browser was found and nothing was opened at all: %r" % opened


def test_the_watcher_still_says_what_it_did_somewhere_that_survives():
    """The window existed because a silent watcher cannot be trusted, and it is gone.

    Logon starts this under pythonw.exe so that no console appears, and pythonw discards
    stdout. So a watcher that only printed would have thrown away every message it has,
    which is exactly the failure the window was built to prevent, reintroduced by the
    change that removed the window. There has to be a file.
    """
    code = _code()
    assert "LOG" in code and "open(LOG" in code, (
        "the watcher does not write anywhere. Under pythonw its output goes nowhere, so"
        " 'watching and nothing landed' and 'stopped in March' become the same thing"
        " again.")
    assert jriter_app.LOG.endswith("watch.log"), jriter_app.LOG
    # Beside the client's own config, so one search finds both.
    import jriter_client
    assert os.path.dirname(jriter_app.LOG) == os.path.dirname(jriter_client.CONFIG_PATH)


def test_the_accent_lives_in_exactly_one_place_now():
    """The stylesheet, and nowhere else that draws.

    The point of the rewrite: the library's tokens are the single definition, and the
    desktop app has no copy to fall out of step with.
    """
    tokens = io.open(TOKENS, encoding="utf-8").read()
    assert re.search(r"--accent:\s*#[0-9A-Fa-f]{6}", tokens), \
        "the stylesheet no longer defines an accent, so nothing does"
    assert not re.findall(r"#[0-9A-Fa-f]{6}\b", _code()), \
        "the desktop app has a colour again"
