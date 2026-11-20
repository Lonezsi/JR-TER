"""Who gets to decide the accent, in order, and why it is decided where it is.

    the accent chosen in Settings                              always the base
    with adaptive colours on:
      a song page open      that song's colour, whatever is playing
      otherwise             the song or render on the player
      nothing at all        back to the chosen accent

These are text tests over the front end (ui/src/lib/look.svelte.ts), which is a weak kind, and they are here for one
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
SRC = os.path.join(HERE, "ui", "src")


def src(*parts):
    return io.open(os.path.join(SRC, *parts), encoding="utf-8").read()


def _code(source):
    """Source with comments out.

    Every one of these files explains the bug it was written for, and those explanations
    name the very things being searched for. Without this a test passes because the
    history mentions the thing rather than because the code does it.
    """
    source = re.sub(r"/\*.*?\*/", "", source, flags=re.S)
    return re.sub(r"^\s*//.*$", "", source, flags=re.M)


def _function(code, header):
    start = code.index(header)
    return code[start:code.index("\n}\n", start)]


def test_the_accent_is_not_decided_by_the_page_ground():
    """It was, and that is what made it step three times into one song.

    The ground (the picture behind the app) and the accent (the colour of the app) are
    separate concerns, so setting the ground must not touch the accent.
    """
    body = _function(_code(src("lib", "look.svelte.ts")), "export function setGround")
    assert "applyAccent" not in body and "accent." not in body, (
        "setGround decides the accent again. It runs on every navigation to a song, so"
        " anything decided there is decided several times per screen change.")


def test_the_driver_prefers_an_open_song_page_to_the_player():
    """The level that was added last, and the order it sits in."""
    look = _code(src("lib", "look.svelte.ts"))
    decide = _function(look, "function decide()")
    # The open page has to be consulted before the player, or the player wins and the
    # level does nothing.
    assert decide.index("if (open)") < decide.index("playing"), (
        "the player is consulted before the open song page, so opening a song while"
        " something else plays would keep the playing song's colour")


def test_leaving_a_page_does_not_clear_the_open_song_before_the_next_one_claims_it():
    """Clearing on the way out and claiming on the way in is two steps, one too many.

    A screen that claims the ground (song, album, playlist, share) is entered without
    anything being cleared; only a screen that claims nothing clears the open song.
    """
    look = _code(src("lib", "look.svelte.ts"))
    arriving = _function(look, "export function arriving")
    assert "if (CLAIMS.has(view)) return;" in arriving, (
        "arriving() clears the open song even for a screen that is about to claim one, so"
        " the accent lands on the player's colour in between")
    assert re.search(r'CLAIMS\s*=\s*new Set\(\[[^\]]*"song"', look), (
        "the song screen is not one that claims the ground")
    assert "applyAccent" not in arriving, "arriving() sets a colour; only decide() may"


def test_the_song_view_hands_over_the_cover_it_already_has():
    """So the accent samples the picture on screen rather than looking one up."""
    view = _code(src("views", "Song.svelte"))
    assert re.search(r"accent\.viewing\(\s*song\.song\s*,\s*cover\s*\)", view), (
        "the song view does not tell the accent driver which song is open, or does not"
        " hand over the cover it has already resolved")


def test_a_render_takes_the_colour_it_is_already_drawn_in():
    """Not a new colour invented for the accent: the hue is derived from the name."""
    look = _code(src("lib", "look.svelte.ts"))
    decide = _function(look, "function decide()")
    assert "isRender" in decide and "hueOf(name)" in decide, (
        "the render's hue is not derived from its name the way its waveform's is")
    assert 'import { clamp, hue as hueOf } from "./util"' in look, (
        "the driver's hue function is no longer the shared one the waveform uses")


def test_the_chosen_accent_is_the_floor_under_all_of_it():
    """Adaptive off, or nothing to follow, is always the colour that was chosen."""
    decide = _function(_code(src("lib", "look.svelte.ts")), "function decide()")
    assert decide.count("applyAccent(chosen)") >= 2, (
        "the chosen accent is reached from fewer than two places; it is the answer both"
        " when adaptive is off and when there is nothing to follow")
    assert "app.settings.adaptive" in decide, "the setting is not consulted at all"
    assert decide.index("app.settings.adaptive") < decide.index("if (open)"), (
        "the open song page is consulted before the adaptive setting, so turning the"
        " setting off would not turn it off on a song page")
