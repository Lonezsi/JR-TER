"""Who gets to decide the accent, in order, and why it is decided where it is.

    the accent chosen in Settings                              always the base
    with adaptive colours on:
      a song page open      that song's colour, whatever is playing
      otherwise             the song or render on the player
      nothing at all        back to the chosen accent

These are text tests over the front end, which is a weak kind, and they are here for one
specific thing that text can see: where the decision is made. The hierarchy itself was
verified in a browser, four states and every transition between them. What text catches is
the structural mistake that has now been made twice in this file's history, and would be
invisible to a passing browser check because it looks like a working app with an extra
flicker.

That mistake is deciding the colour during navigation. The accent hung off pageWash once,
which runs when a screen changes, and opening one song set it three times. Tracking an
open song page invites the same error by a different route: clear it when a view is left,
set it when a song view arrives, and because those are separated by the network you get
the previous colour on the way out and the new one on the way in. One step too many, on
every single navigation into a song.

The shape that avoids it is claim and settle: nothing is cleared when a navigation starts,
the arriving view claims what it wants, and only what nobody claimed is cleared once the
view has rendered. These tests hold that shape in place.
"""
import io
import os
import re

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
JS = os.path.join(HERE, "web", "js")


def js(name):
    return io.open(os.path.join(JS, name), encoding="utf-8").read()


def _code(source):
    """Source with comments and docstrings out.

    Every one of these files explains the bug it was written for, and those explanations
    name the very things being searched for. Without this a test passes because the
    history mentions the thing rather than because the code does it.
    """
    source = re.sub(r"/\*(?:.|\n)*?\*/", "", source)
    return re.sub(r"^\s*//.*$", "", source, flags=re.M)


def test_the_accent_is_not_decided_by_the_page_ground():
    """It was, and that is what made it step three times into one song.

    pageWash runs on navigation and was called three times to open a song, so the accent
    was set three times. The two are separate concerns now: one is the picture behind the
    app, the other is the colour of the app.
    """
    wash = _code(js("00-util.js"))
    start = wash.index("J.pageWash = ")
    body = wash[start:wash.index("\n}());", start)]
    assert "applyAccent" not in body and "J.accent" not in body, (
        "pageWash decides the accent again. It runs on navigation, so anything decided"
        " there is decided several times per screen change.")


def test_the_driver_prefers_an_open_song_page_to_the_player():
    """The level that was added last, and the order it sits in."""
    driver = _code(js("42-accent.js"))
    assert "viewing:" in driver, "there is no way for a view to say a song is open"

    # The open page has to be consulted before the player, or the player wins and the
    # level does nothing.
    at_open = driver.index("if (open)")
    at_player = driver.index("J.player")
    assert at_open < at_player, (
        "the player is consulted before the open song page, so opening a song while"
        " something else plays would keep the playing song's colour")


def test_an_open_song_page_is_claimed_and_settled_rather_than_cleared():
    """The shape that keeps one navigation to one colour change.

    Clearing the open song when a view is left is the obvious way to track it and the
    wrong one: the clear and the next claim are separated by the arriving view's fetches,
    so the accent lands on the player's colour in between. expect() changes nothing,
    settle() runs after the render, and only an unclaimed navigation clears anything.
    """
    driver = _code(js("42-accent.js"))
    assert "expect:" in driver and "settle:" in driver, \
        "the driver has no claim and settle, so tracking an open page will step"

    expect = driver[driver.index("expect:"):]
    expect = expect[:expect.index("\n")]
    assert "claimed = false" in expect and "open" not in expect, (
        "expect() touches the open song. It must change nothing at all: it runs when a"
        " navigation starts, which is before the arriving view has had a chance to claim.")

    router = _code(js("80-router.js"))
    assert "J.accent.expect()" in router, "the router never says a claim may be coming"
    assert "J.accent.settle()" in router, "nothing ever asks whether one arrived"

    # And settle has to be in settle(), which runs after the render, not beside expect.
    at_expect = router.index("J.accent.expect()")
    at_settle = router.index("J.accent.settle()")
    assert at_settle > at_expect, "settle runs before expect, which cannot be right"


def test_the_song_view_hands_over_the_cover_it_already_has():
    """So the accent samples the picture on screen rather than looking one up.

    The song page resolves the real artwork url out of the artwork list before it draws.
    Passing it means the colour comes from that exact image; without it the driver falls
    back to the row's artwork_id, which is the same picture today and one more thing to
    stay true tomorrow.
    """
    view = _code(js("60-view-song.js"))
    assert re.search(r"J\.accent\.viewing\(\s*song\s*,\s*cover\s*\)", view), (
        "the song view does not tell the accent driver which song is open, or does not"
        " hand over the cover it has already resolved")


def test_a_render_takes_the_colour_it_is_already_drawn_in():
    """Not a new colour invented for the accent.

    The renders list derives a hue from the render's name for its waveform. The driver
    asks the same function the same question, so the app while a render plays is the
    colour that render already is everywhere else in the app.
    """
    driver = _code(js("42-accent.js"))
    assert "J.hue(" in driver, "the render's hue is not derived the way the waveform's is"
    renders = _code(js("76-view-renders.js"))
    assert "--wave-hue:${J.hue(" in renders, (
        "the renders list no longer derives its waveform hue from J.hue, so the driver is"
        " agreeing with something that has moved")


def test_the_chosen_accent_is_the_floor_under_all_of_it():
    """Adaptive off, or nothing to follow, is always the colour that was chosen."""
    driver = _code(js("42-accent.js"))
    assert driver.count("J.chosenAccent()") >= 2, (
        "the chosen accent is reached from fewer than two places; it is the answer both"
        " when adaptive is off and when there is nothing to follow")
    assert "if (!adaptive())" in driver, "the setting is not consulted at all"
    at_setting = driver.index("if (!adaptive())")
    at_open = driver.index("if (open)")
    assert at_setting < at_open, (
        "the open song page is consulted before the adaptive setting, so turning the"
        " setting off would not turn it off on a song page")
