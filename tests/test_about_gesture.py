"""The way to the about page on a phone.

Hold the rail out past its stop, an arrow appears on the left edge, press it. It takes
itself away after two seconds if nobody does.

It used to be a different gesture: the arrow appeared and *letting go* opened the page. Two
things were wrong with that, and the second is the one that made it look broken.

The arrow could not be pressed. Pressing needs a finger, and the finger is the one holding
the gesture open; by the time it is free the moment has already been spent. So an arrow
saying About sat there doing nothing when tapped, which is a control that does not work.

And it only ever fired on a clean release. Making the offer means holding a thumb still,
near the left edge, for a second, which is exactly the shape a browser decides was an edge
swipe or a scroll after all: it takes the pointer back with pointercancel, the old code
threw the offer away on the spot, and the whole thing came undone with the thumb still on
the glass.

These are source level checks. What they are guarding is not the arithmetic of the gesture
but the handful of decisions that made it unusable, each of which is one edit away from
coming back.
"""
import os
import re

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BOOT = open(os.path.join(HERE, "web", "js", "90-boot.js"), encoding="utf-8").read()
CSS = open(os.path.join(HERE, "web", "css", "48-about.css"), encoding="utf-8").read()
INDEX = open(os.path.join(HERE, "web", "index.html"), encoding="utf-8").read()


def test_the_arrow_is_something_you_can_press():
    """A div with pointer-events: none is not a control, whatever it looks like."""
    assert re.search(r'<button[^>]*id="edgeBubble"', INDEX), \
        "the arrow is not a button, so nothing about it says it can be pressed"
    assert ".edge-bubble.on" in CSS
    on = CSS[CSS.index(".edge-bubble.on"):]
    on = on[:on.index("}")]
    assert "pointer-events: auto" in on, \
        "the arrow is still inert while it is being offered"


def test_it_is_inert_while_it_is_not_being_offered():
    """It sits over the left edge of every screen, which on a phone is where the browser's
    own back gesture starts. A hit target there that is invisible is a dead strip."""
    base = CSS[CSS.index(".edge-bubble {"):]
    base = base[:base.index("}")]
    assert "pointer-events: none" in base


def test_pressing_it_is_what_opens_the_page():
    assert "goToAbout" in BOOT
    assert 'bubble.addEventListener("click"' in BOOT, \
        "nothing listens for a press on the arrow"


def test_letting_go_no_longer_navigates_on_its_own():
    """Because you cannot press a thing while you are still holding the screen down.

    The release hands the offer over instead: the arrow stays, and the press is separate.
    """
    release = BOOT[BOOT.index("if (armed) {"):]
    release = release[:release.index("return;")]
    assert "location.hash" not in release, \
        "letting go still navigates, so the arrow can never be reached to be pressed"
    assert "letAboutFade" in release, \
        "letting go does not start the clock on the offer"


def test_a_cancelled_gesture_keeps_the_offer():
    """The likeliest reason this did nothing on a real phone.

    A thumb held still near the left edge is what a browser cancels. The offer has already
    been made by then and survives it; only the rail is put back.
    """
    cancel = BOOT[BOOT.index('addEventListener("pointercancel"'):]
    cancel = cancel[:cancel.index("}, { passive: true });")]
    assert "letAboutFade()" in cancel, "a cancelled gesture still throws the offer away"
    assert "withdrawAbout()" not in cancel


def test_it_takes_itself_away_after_a_couple_of_seconds():
    found = re.search(r"const OFFERED = (\d+);", BOOT)
    assert found, "there is no timeout on the offer"
    assert int(found.group(1)) == 2000
    assert "setTimeout(withdrawAbout, OFFERED)" in BOOT


def test_the_clock_starts_when_the_thumb_comes_off():
    """Not when the arrow appears. An offer you are still holding the screen down on has
    not been made yet, and a timer started then would run out under the finger."""
    fade = BOOT[BOOT.index("function letAboutFade()"):]
    fade = fade[:fade.index("\n  }")]
    assert "if (!armed) return;" in fade
    # And the thing that appears does not start it.
    offer = BOOT[BOOT.index("function offerAbout()"):]
    offer = offer[:offer.index("\n  }")]
    assert "fadeTimer" not in offer, \
        "the countdown starts while the finger is still down"


def test_the_press_is_not_eaten_by_the_click_suppressor():
    """A drag is followed by a click nobody asked for, and there is a document level
    listener in the capture phase that swallows one. It runs before the arrow's own
    handler, and crossing the screen back to the left edge takes longer than its window
    most of the time, which is worse than never working: it would work, and then now and
    again not."""
    suppressor = BOOT[BOOT.index("if (e.timeStamp - dragEndedAt > AFTER_DRAG) return;"):]
    suppressor = suppressor[:suppressor.index("}, true);")]
    assert "bubble.contains(e.target)" in suppressor, \
        "a quick press on the arrow is still swallowed by the after-drag suppressor"


def test_it_is_out_of_the_way_of_a_screen_reader_until_it_is_there():
    """Present in the layout the whole time, because it slides and you cannot transition
    out of display: none. That is not a reason to have it read out or tabbed to."""
    assert re.search(r'id="edgeBubble"[^>]*aria-hidden="true"', INDEX)
    assert re.search(r'id="edgeBubble"[^>]*tabindex="-1"', INDEX)
    offer = BOOT[BOOT.index("function offerAbout()"):]
    offer = offer[:offer.index("\n  }")]
    assert 'removeAttribute("aria-hidden")' in offer and "tabIndex = 0" in offer
    withdraw = BOOT[BOOT.index("function withdrawAbout()"):]
    withdraw = withdraw[:withdraw.index("\n  }")]
    assert 'setAttribute("aria-hidden", "true")' in withdraw and "tabIndex = -1" in withdraw
