"""The accent: one colour, written in three files, and a band that has to stay readable.

Two separate worries.

The first is drift. The default is written in the stylesheet, which is what a page shows
before any setting has loaded, in the server's defaults table, which is what a library
without a chosen accent is given, and in the icon, whose own comment says its ground is
--accent. Three copies of one colour is three chances to change two of them.

The second is the band. On a song the accent takes the hue of whatever is behind the app,
which means the app hands this colour to artwork it has never seen. Only the hue travels;
saturation and lightness stay where baby pink has them. That is what keeps it safe, and it
is worth a test because the failure it prevents is a primary button nobody can read.
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


def test_the_accent_band_is_readable_at_every_hue():
    """The app hands this colour to artwork it has never seen.

    On a song the hue comes from the sleeve, so the band has to hold at all 360 of them:
    as text on the page, and as the ground under the dark ink a primary button puts on it.
    A sleeve that is nearly black must not be able to produce an accent nobody can read,
    which is the whole reason only the hue travels and the lightness does not.
    """
    util = _read(UTIL)
    sat = int(re.search(r"J\.ACCENT_SAT\s*=\s*(\d+)", util).group(1))
    light = int(re.search(r"J\.ACCENT_LIGHT\s*=\s*(\d+)", util).group(1))

    page = (0, 0, 0)
    ink = _hex(re.search(r"--text-on-accent:\s*(#[0-9A-Fa-f]{6})", _read(TOKENS)).group(1))

    worst_text, worst_ink, at_text, at_ink = 99.0, 99.0, None, None
    for hue in range(0, 360):
        colour = _hsl_to_rgb(hue, sat, light)
        on_page = _contrast(colour, page)
        under_ink = _contrast(colour, ink)
        if on_page < worst_text:
            worst_text, at_text = on_page, hue
        if under_ink < worst_ink:
            worst_ink, at_ink = under_ink, hue

    assert worst_text >= AA, (
        "at hue %d the accent reads at %.2f:1 as text on the page, under the %.1f:1 body"
        " text needs. Lightness is what holds this up, so a change to J.ACCENT_LIGHT is"
        " the likely cause." % (at_text, worst_text, AA))
    assert worst_ink >= AA, (
        "at hue %d the dark ink on an accent button reads at %.2f:1, under %.1f:1."
        % (at_ink, worst_ink, AA))


def test_baby_pink_is_the_band_at_hue_nought():
    """The default is not a colour beside the band, it is the band's first entry.

    If it were picked separately then every song would shift the accent to a different
    weight as well as a different hue, and leaving a song would shift it back, which reads
    as the app changing its mind rather than following the artwork.
    """
    util = _read(UTIL)
    sat = int(re.search(r"J\.ACCENT_SAT\s*=\s*(\d+)", util).group(1))
    light = int(re.search(r"J\.ACCENT_LIGHT\s*=\s*(\d+)", util).group(1))

    at_zero = _hsl_to_rgb(0, sat, light)
    default = _hex(_accent_in_css())
    off_by = max(abs(a - b) for a, b in zip(at_zero, default))
    assert off_by <= 2, (
        "the default accent is rgb%s and the band at hue 0 is rgb%s. They should be the"
        " same colour, or the accent changes weight as well as hue when you open a song."
        % (default, at_zero))
