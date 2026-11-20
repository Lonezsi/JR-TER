"""The arrangement's scrollbar, which is not a scrollbar.

Asked for: thicker, and a bit further out, so it can be grabbed on a phone.

Making the native one thicker does nothing there, and this file exists mostly to write that
down. Measured at 375 with 927 pixels of content in 291: the strip scrolls and the bar
reserves no space and is not drawn. Mobile Chromium uses an overlay scrollbar and ignores
::-webkit-scrollbar sizing, iOS Safari does the same, and on iOS the indicator cannot be
dragged at all.

So it is an element, dragged with pointer events like everything else in this app. It
lives in the timeline editor (ui/src/views/song/timeline/Editor.svelte).
"""
import io
import os
import re

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def editor():
    return io.open(os.path.join(HERE, "ui", "src", "views", "song", "timeline", "Editor.svelte"),
                   encoding="utf-8").read()


def script():
    source = editor()
    return code(source[:source.index("</script>")])


def sheet():
    source = editor()
    return code(source[source.index("<style>"):])


def rule(source, selector):
    at = source.index(selector + " {")
    return source[at:source.index("}", at)]


def code(source):
    """The same source with its comments taken out.

    These files explain themselves at length, and the explanations name the very things
    being checked for absence.
    """
    source = re.sub(r"/\*.*?\*/", "", source, flags=re.S)
    return re.sub(r"^\s*//.*$", "", source, flags=re.M)


def px(source, selector, prop):
    found = re.search(r"%s:\s*(\d+)px" % re.escape(prop), rule(source, selector))
    assert found, "no %s on %s" % (prop, selector)
    return int(found.group(1))


def test_the_strip_asks_for_no_native_scrollbar():
    """On a phone it was not drawn, and on a desktop it was a different control."""
    css = sheet()
    assert "scrollbar-width: none;" in rule(css, ".scroll")
    assert ".scroll::-webkit-scrollbar { display: none; height: 0; }" in css
    assert "::-webkit-scrollbar-thumb" not in css, \
        "the strip's own thumb rules are the bar's job now"


def test_hiding_it_does_not_stop_the_strip_scrolling():
    """A hidden scrollbar is still a scrolling box: the wheel, the trackpad and the keyboard
    all still work, and the custom thumb follows them because it is drawn from the scroller
    rather than from anything it owns itself."""
    assert "overflow-x: auto;" in rule(sheet(), ".scroll")
    body = script()
    assert "scrollLeft / over" in body, "the thumb is placed from the scroller's own offset"
    assert "avail / trackW" in body, "and sized from how much of the strip is on screen"


def test_the_bar_is_thick_enough_to_hit():
    """The whole height of this is the target; the groove drawn inside it is narrower,
    because a control the size of its own target looks like a slab."""
    css = sheet()
    assert px(css, ".bar", "height") >= 24
    assert px(css, ".bar::before", "height") < px(css, ".bar", "height")
    phone = css[css.index("@media (max-width: 900px) { .bar"):]
    assert re.search(r"\.bar \{ height: (3\d|[4-9]\d)px", phone), \
        "fatter again where the only pointer is a thumb"


def test_a_drag_on_the_bar_belongs_to_the_bar():
    """Both directions. The strip's own sideways drag belongs to the blocks and the page's
    up and down belongs to the page; a drag here is neither, and without saying so the
    browser claims it partway through and sends pointercancel."""
    assert "touch-action: none;" in rule(sheet(), ".bar")


def test_the_thumb_has_a_floor_so_it_can_be_caught():
    """Its width is the share of the strip on screen, and on a long arrangement at full zoom
    that share is a few per cent: honest, and too small to hit."""
    body = script()
    assert re.search(r"const THUMB_LEAST = (\d+);", body)
    assert int(re.search(r"const THUMB_LEAST = (\d+);", body).group(1)) >= 40
    assert "Math.max(THUMB_LEAST, Math.round(barW * (avail / trackW)))" in body


def test_the_thumb_is_not_eased():
    """It is following a finger. Easing it would put it a frame behind the hand for the
    whole drag, which is the same reason a block being dragged has no transition."""
    thumb = rule(sheet(), ".thumb")
    assert "transition: background var(--fast);" in thumb
    assert "transform" not in thumb.split("transition:")[1], "no transition on the position"


def test_dragging_keeps_the_point_you_grabbed_and_tapping_centres():
    """Two gestures on one control. Grabbing the thumb has to keep the offset you grabbed it
    by, or it jumps under your finger; tapping the track has to put the middle of the thumb
    where you tapped, which is what makes a tap read as "go here"."""
    body = script()
    assert '.closest(".thumb")' in body
    assert "onThumb ? e.clientX - (box.left + thumbX) : thumbW / 2" in body


def test_it_is_not_there_when_there_is_nothing_to_pan():
    """A full width thumb that cannot move is a control lying about being one."""
    source = editor()
    assert re.search(r"\{#if over > 1\}(?:(?!\{/if\}).)*class=\"bar\"", source, flags=re.S)
    assert "over > 1 && barW" in script(), "and the thumb has no size either"


def test_a_cancelled_drag_lets_go():
    """A pointercancel with no handler leaves the bar holding for ever, and it is the event
    a phone actually sends when the gesture is taken away."""
    body = script()
    at = body.index("function barDown")
    drag = body[at:body.index("// ── dragging a block", at)] if "// ── dragging a block" in body \
        else body[at:at + 1500]
    assert 'window.addEventListener("pointercancel", done);' in drag
    assert 'window.removeEventListener("pointercancel", done);' in drag
