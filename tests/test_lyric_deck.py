"""The walls on a lyric card, and when they are allowed to be seen.

A card turns in three dimensions when it is thrown off the deck, so it has thickness: two
thin faces down its sides. Thickness is a thing you see when an object turns, and the whole
history of this deck is the same complaint arriving in different words, three times:

  the other lyrics show through the one I am reading
  the edges of the other lyrics get into the frame
  the next lyrics edge flashes in for a second when pulled

The first two were the cards behind and the current card's own walls at rest. The third was
subtler and is the reason for this file: the rule said the walls belong to every card that
is *not* the front one, and the card arriving takes the front the instant you let go, then
fades up from nothing over the same transition. So for the length of that fade it was a
card being revealed with its walls already lit.

Leaving is a state, not the absence of one. That is the whole fix, and it is one selector,
so it is worth writing down.
"""
import os
import re

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHEET = os.path.join(HERE, "web", "css", "50-song.css")
PANEL = os.path.join(HERE, "web", "js", "62-panel-lyrics.js")


def sheet():
    return open(SHEET, encoding="utf-8").read()


def panel():
    return open(PANEL, encoding="utf-8").read()


def rule(source, selector):
    """The declarations that follow one selector, comments and all."""
    at = source.index(selector)
    return source[at:source.index("}", at)]


def lit_by(source):
    """The selector list that turns the walls on."""
    found = re.search(r"((?:^\.lyric-slab[^,{]*,\n)*^\.lyric-slab[^,{]*)\{ opacity: 1; \}",
                      source, flags=re.M)
    assert found, "nothing in the stylesheet lights the walls at all"
    return [part.strip() for part in found.group(1).split(",")]


def test_the_walls_are_off_at_rest():
    """Measured at three pixels a side, because the perspective origin is not dead centre.

    A wall rotated a quarter turn should project to nothing and very nearly does. Three
    pixels of lit grey down each edge of a card reads as another card just behind it,
    which is the thing these lyrics are specifically not supposed to have.
    """
    assert "opacity: 0;" in rule(sheet(), ".slab-edge {"), \
        "the resting state is invisible; the rules below opt in"


def test_only_a_card_that_is_turning_has_thickness():
    lit = lit_by(sheet())
    assert ".lyric-slab.nudging .slab-edge" in lit, "under a thumb, a card is turning"
    assert ".lyric-slab.leaving .slab-edge" in lit, "and on its way out"
    assert ".lyric-slab:not(.on) .slab-edge" not in lit, \
        "this is what flashed the arriving card's walls while it faded in"
    assert len(lit) == 2, \
        "two states turn the walls on, and a third would be a card at rest with edges"


def test_the_card_arriving_is_never_one_of_them():
    """The arriving card is the one that has just taken .on.

    So no rule keyed on having .on, or on lacking it, can be what lights the walls: the
    first would light the card you are reading and the second the one coming towards you.
    """
    for selector in lit_by(sheet()):
        assert ".on" not in selector.replace("nudging", "").replace("leaving", ""), \
            "%s decides by which card is in front, and both cards move" % selector


def test_leaving_is_put_on_the_card_that_is_actually_leaving():
    body = panel()
    at = body.index("function markCurrent()")
    end = body.index("function go(", at)
    marker = body[at:end]
    assert 'const going = J.$(".lyric-slab.on", block);' in marker, \
        "which card is leaving has to be read before the class moves"
    assert 'if (going && !going.classList.contains("on")) {' in marker, \
        "markCurrent also runs on a plain redraw, where nothing is going anywhere"
    assert 'going.classList.add("leaving");' in marker


def test_leaving_is_taken_off_again():
    """A class that outlives its animation leaves the walls lit on a card standing still,
    which is the bug it was added to fix, arriving from the other direction."""
    body = panel()
    assert "const LEAVING_MS = 420;" in body
    assert 'going.classList.remove("leaving")' in body
    assert "clearTimeout(going._leaving);" in body, \
        "two turns in quick succession would otherwise race, and the first timer wins"
    # And it is cleared on the way in as well, so a card cannot arrive still marked.
    at = body.index("function markCurrent()")
    assert 'classList.remove("nudging", "leaving")' in body[at:at + 900]


def test_the_class_lasts_as_long_as_the_journey():
    """420 in the panel because 420 in the stylesheet. Two numbers that have to agree, and
    nothing makes them agree except this."""
    transform = re.search(r"\.lyric-slab \{[^}]*?transition: transform (\d+)ms",
                          sheet(), flags=re.S)
    assert transform, "the slab's transform transition is what is being matched"
    assert int(transform.group(1)) == 420
    assert "const LEAVING_MS = 420;" in panel()


def test_the_constant_is_not_a_global():
    """The bundle is every file in web/js concatenated, in filename order, with no module
    wrapper of any kind. A name declared at the top level of one file belongs to all of
    them, and this one is a detail of the deck."""
    body = panel()
    at = body.index("const LEAVING_MS")
    before = body[:at]
    assert "J.blockLyrics = async function" in before, \
        "declared inside the deck, not beside it"


def test_a_lone_card_has_no_walls_at_all():
    """There is nothing to be thick beside, and a single slab with its sides showing is a
    card with two grey stripes down it."""
    assert ".deck-track:not(:has(.lyric-slab + .lyric-slab)) .slab-edge { display: none; }" \
        in sheet()
