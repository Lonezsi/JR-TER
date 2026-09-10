"""The accent: one colour, written in three files, and a band that has to stay readable.

Two separate worries.

The first is drift. The default is written in the stylesheet, which is what a page shows
before any setting has loaded, in the server's defaults table, which is what a library
without a chosen accent is given, and in the icon, whose own comment says its ground is
--accent. Three copies of one colour is three chances to change two of them.

The second is the band. While something is on the player the accent takes its hue from
that: a render's own waveform colour, or the average of a song's artwork. So the app hands
this colour to pictures it has never seen, and the band has to hold for all 360 hues.

Only the hue comes from the artwork. The saturation is fixed high and the lightness is
solved per hue, the most vivid that still carries text, which is what makes "neon" and
"readable" the same choice rather than opposing ones. Without that, a nearly black sleeve
would produce a nearly black accent, and the accent is what primary buttons are made of.
"""
import io
import os
import re

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

TOKENS = os.path.join(HERE, "web", "css", "00-tokens.css")
CONFIG = os.path.join(HERE, "jriter", "config.py")
FAVICON = os.path.join(HERE, "web", "img", "make-favicon.py")
UTIL = os.path.join(HERE, "web", "js", "00-util.js")

#: The AA threshold for body text. Nothing here should come near it; the number is here so
#: that an edit which does gets stopped.
AA = 4.5


def _read(path):
    return io.open(path, encoding="utf-8").read()


def _hex(value):
    value = value.strip().lstrip("#")
    return tuple(int(value[i:i + 2], 16) for i in (0, 2, 4))


def _luminance(colour):
    out = []
    for channel in colour:
        c = channel / 255.0
        out.append(c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4)
    return 0.2126 * out[0] + 0.7152 * out[1] + 0.0722 * out[2]


def _contrast(a, b):
    la, lb = _luminance(a), _luminance(b)
    return (max(la, lb) + 0.05) / (min(la, lb) + 0.05)


def _hsl_to_rgb(h, s, l):
    """The same arithmetic J.hslHex does, so this tests that band and not another one."""
    s, l = s / 100.0, l / 100.0
    c = (1 - abs(2 * l - 1)) * s
    x = c * (1 - abs(((h % 360) / 60.0) % 2 - 1))
    m = l - c / 2
    table = [(c, x, 0), (x, c, 0), (0, c, x), (0, x, c), (x, 0, c), (c, 0, x)]
    r, g, b = table[int((h % 360) // 60) % 6]
    return tuple(round((v + m) * 255) for v in (r, g, b))


def _accent_in_css():
    found = re.search(r"--accent:\s*(#[0-9A-Fa-f]{6})", _read(TOKENS))
    assert found, "--accent is not in the tokens file any more"
    return found.group(1).upper()


def test_the_default_accent_is_the_same_colour_in_every_file_that_holds_it():
    """Three copies, and the one that gets forgotten is always the one you do not look at.

    The stylesheet is what a page wears before any setting loads, so a mismatch here is
    not an inconsistency somebody notices in a diff, it is the app flashing one colour and
    settling on another.
    """
    css = _accent_in_css()

    found = re.search(r'"accent":\s*"(#[0-9A-Fa-f]{6})"', _read(CONFIG))
    assert found, "the defaults table has no accent any more"
    assert found.group(1).upper() == css, (
        "the stylesheet says %s and the server's default says %s, so a library with no"
        " chosen accent loads one colour and then changes to another."
        % (css, found.group(1).upper()))

    found = re.search(r"GROUND\s*=\s*\((\d+),\s*(\d+),\s*(\d+)\)", _read(FAVICON))
    assert found, "the icon has no ground colour any more"
    ground = tuple(int(n) for n in found.groups())
    assert ground == _hex(css), (
        "the icon's ground is rgb%s and the accent is %s. The icon's own comment says its"
        " ground is --accent, so these two cannot be different colours." % (ground, css))


def _band():
    """The three numbers the JS solver is built on, read out of it."""
    util = _read(UTIL)
    return (int(re.search(r"J\.NEON_SAT\s*=\s*(\d+)", util).group(1)),
            float(re.search(r"J\.NEON_FLOOR\s*=\s*([\d.]+)", util).group(1)),
            int(re.search(r"J\.NEON_LIGHT_MIN\s*=\s*(\d+)", util).group(1)),
            int(re.search(r"J\.NEON_LIGHT_MAX\s*=\s*(\d+)", util).group(1)))


def _neon(hue):
    """The same bisection J.neon does, so this measures the band the app draws.

    Reimplemented rather than approximated: if this drifted from the JavaScript it would
    be testing a band nobody sees. The verification that they agree is that the six hues
    sampled in the browser came back byte for byte identical to these.
    """
    sat, floor, low, high = _band()

    def on_page(light):
        return _contrast(_hsl_to_rgb(hue, sat, light), (0, 0, 0))

    if on_page(low) >= floor:
        return _hsl_to_rgb(hue, sat, low)
    lo, hi = float(low), float(high)
    for _ in range(20):
        mid = (lo + hi) / 2
        if on_page(mid) >= floor:
            hi = mid
        else:
            lo = mid
    return _hsl_to_rgb(hue, sat, hi)


def test_the_neon_band_carries_text_at_every_hue():
    """The app hands this colour to artwork it has never seen.

    While something is playing the hue comes from a sleeve or a render's name, so all 360
    have to hold: readable as text on the page, and readable under the ink a primary
    button puts on top of it. A song whose cover is nearly black must not be able to
    produce an accent nobody can read, which is why the lightness is solved rather than
    taken from the picture.
    """
    sat, floor, low, high = _band()
    ink = _hex(re.search(r"--accent-ink:\s*(#[0-9A-Fa-f]{6})", _read(TOKENS)).group(1))
    page = (0, 0, 0)

    worst_text, at_text = 99.0, None
    worst_ink, at_ink = 99.0, None
    for hue in range(360):
        colour = _neon(hue)
        on_page = _contrast(colour, page)
        under_ink = _contrast(colour, ink)
        if on_page < worst_text:
            worst_text, at_text = on_page, hue
        if under_ink < worst_ink:
            worst_ink, at_ink = under_ink, hue

    assert worst_text >= floor - 0.01, (
        "at hue %d the band reads at %.2f:1 as text, under the %.1f:1 it solves for. The"
        " solver is not doing what it says." % (at_text, worst_text, floor))
    assert worst_ink >= AA, (
        "at hue %d the ink on an accent button reads at %.2f:1, under %.1f:1. The band is"
        " chosen for contrast against the page; this is the other side of it, and it has"
        " to hold too or a primary button becomes unreadable while a song plays."
        % (at_ink, worst_ink, AA))


def test_the_band_is_never_a_dark_colour():
    """Asked for in those words: more saturated, and not dark.

    The floor is what guarantees it. Without one, the solver would happily return a very
    dark saturated blue for a blue sleeve, which is exactly the outcome the brief ruled
    out, and no contrast check would object because a dark colour on a black page fails
    the text test rather than passing it.
    """
    sat, floor, low, high = _band()
    assert low >= 40, (
        "the lightness floor is %d, which allows a colour dark enough to read as a shade"
        " rather than a neon" % low)

    # And the saturation has to actually be high, or "neon" is just a light colour.
    assert sat >= 85, "the band's saturation is %d%%, which is not neon" % sat

    for hue in range(0, 360, 15):
        r, g, b = _neon(hue)
        biggest, smallest = max(r, g, b), min(r, g, b)
        light = (biggest + smallest) / 2 / 255.0
        assert light >= 0.40, (
            "hue %d comes back at lightness %.2f, which is a dark colour" % (hue, light))
        assert biggest - smallest >= 90, (
            "hue %d comes back with only %d points between its channels, which is nearly"
            " grey rather than saturated" % (hue, biggest - smallest))


def test_neighbouring_hues_do_not_step():
    """Sweeping through the colours of a sleeve must not band.

    The lightness is solved per hue, so in principle it could jump between neighbours and
    a slow crossfade would show it as a stripe. Measured, the largest step across the
    whole circle is two points of lightness.
    """
    lights = []
    for hue in range(360):
        r, g, b = _neon(hue)
        lights.append((max(r, g, b) + min(r, g, b)) / 2 / 255.0 * 100)
    steps = [abs(lights[i] - lights[i - 1]) for i in range(1, 360)]
    worst = max(steps)
    assert worst <= 4.0, (
        "the band jumps %.1f points of lightness between two neighbouring hues, which"
        " shows as a stripe when the accent moves through them" % worst)


def test_the_default_accent_is_readable_but_is_not_on_the_band():
    """The default is chosen, not solved, and that is the hierarchy working.

    An earlier test asserted the default was the band at hue nought. That stopped being
    true deliberately: the accent is the colour set in Settings, and the band is a
    separate thing that only applies while something is on the player. Anybody may pick
    any accent, so the only thing to hold it to is that the app's own default is legible.
    """
    default = _hex(_accent_in_css())
    ink = _hex(re.search(r"--accent-ink:\s*(#[0-9A-Fa-f]{6})", _read(TOKENS)).group(1))
    on_page = _contrast(default, (0, 0, 0))
    under_ink = _contrast(default, ink)
    assert on_page >= AA, "the default accent reads at %.2f:1 as text" % on_page
    assert under_ink >= AA, "the default accent carries its ink at %.2f:1" % under_ink

    # And it is a pink, which is the one thing the brief said about it.
    r, g, b = default
    assert r > g and r > b, "the default accent is not a pink: rgb%s" % (default,)
    assert r - min(g, b) >= 40, (
        "the default accent is only %d points off grey, which is barely a pink"
        % (r - min(g, b)))
