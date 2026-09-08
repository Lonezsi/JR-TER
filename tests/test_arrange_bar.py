"""The arrangement's scrollbar, which is not a scrollbar.

Asked for: thicker, and a bit further out, so it can be grabbed on a phone.

Making the native one thicker does nothing there, and this file exists mostly to write that
down. Measured at 375 with 927 pixels of content in 291: the strip scrolls and the bar
reserves no space and is not drawn. Mobile Chromium uses an overlay scrollbar and ignores
::-webkit-scrollbar sizing, iOS Safari does the same, and on iOS the indicator cannot be
dragged at all. Every number in the rules that used to be there was desktop only, which is
the one place getting along the strip was never the problem.

So it is an element, dragged with pointer events like everything else in this app.
"""
import io
import os
import re

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def panel():
    return io.open(os.path.join(HERE, "web", "js", "38-compositor.js"),
                   encoding="utf-8").read()


def sheet():
    return io.open(os.path.join(HERE, "web", "css", "76-compositor.css"),
                   encoding="utf-8").read()


def rule(source, selector):
    at = source.index(selector + " {")
    return source[at:source.index("}", at)]


def code(source):
    """The same source with its comments taken out.

    These files explain themselves at length, and the explanations name the very things
    being checked for absence: the note beside the thumb's transition says the word
    "transform" in order to say why there is no transition on it.
    """
    return re.sub(r"/\*.*?\*/", "", source, flags=re.S)


def px(source, selector, prop):
    found = re.search(r"%s:\s*(\d+)px" % re.escape(prop), rule(source, selector))
    assert found, "no %s on %s" % (prop, selector)
    return int(found.group(1))


# ── the native one is gone, because it was never the control ─────────────────

def test_the_strip_asks_for_no_native_scrollbar():
    """It was fourteen pixels, and sixteen on a phone, and on a phone it was not drawn."""
    css = sheet()
    assert "scrollbar-width: none;" in rule(css, ".comp-scroll")
    assert ".comp-scroll::-webkit-scrollbar { display: none; height: 0; }" in css
    assert "::-webkit-scrollbar-thumb" not in css, \
        "the strip's own thumb rules are the bar's job now"
    assert "::-webkit-scrollbar { height: 16px; }" not in css, \
        "and the phone override with them"


def test_hiding_it_does_not_stop_the_strip_scrolling():
    """A hidden scrollbar is still a scrolling box: the wheel, the trackpad and the
    keyboard all still work, and the custom thumb follows them because it is drawn from the
    scroller rather than from anything it owns itself."""
    css = sheet()
    assert "overflow-x: auto;" in rule(css, ".comp-scroll")
    body = panel()
    at = body.index("function syncBar()")
    sync = body[at:body.index("/* Dragging it", at)]
    assert "scroll.scrollWidth - scroll.clientWidth" in sync
    assert "scroll.clientWidth / scroll.scrollWidth" in sync
    assert "scroll.scrollLeft" in sync, "read off the scroller, not kept in step by hand"


# ── the thing you grab ───────────────────────────────────────────────────────

def test_the_bar_is_thick_enough_to_hit():
    """The old one was 14. The whole height of this is the target; the groove drawn inside
    it is narrower, because a control the size of its own target looks like a slab."""
    css = sheet()
    assert px(css, ".comp-bar", "height") >= 24
    phone = css[css.index("@media (max-width: 900px)"):]
    assert re.search(r"\.comp-bar \{ height: (3\d|[4-9]\d)px", phone), \
        "fatter again where the only pointer is a thumb"


def test_the_bar_sits_out_from_the_blocks():
    """It was eight pixels under them, which on a phone is close enough that a grab for the
    bar lands on the strip and moves a section instead."""
    css = sheet()
    assert "margin-top: var(--s3);" in rule(css, ".comp-bar")
    phone = css[css.index("@media (max-width: 900px)"):]
    assert "margin-top: var(--s4);" in phone, "further out again on a phone"


def test_a_drag_on_the_bar_belongs_to_the_bar():
    """Both directions. The strip's own sideways drag belongs to the blocks and the page's
    up and down belongs to the page; a drag here is neither, and without saying so the
    browser claims it partway through and sends pointercancel."""
    assert "touch-action: none;" in rule(sheet(), ".comp-bar")


def test_the_thumb_has_a_floor_so_it_can_be_caught():
    """Its width is the share of the strip on screen, and on a long arrangement at full
    zoom that share is a few per cent: honest, and too small to hit."""
    body = panel()
    assert "const THUMB_LEAST = 44;" in body
    assert "Math.max(THUMB_LEAST, Math.round(width * share))" in body


def test_the_thumb_is_not_eased():
    """It is following a finger. Easing it would put it a frame behind the hand for the
    whole drag, which is the same reason a block being dragged has no transition."""
    thumb = rule(code(sheet()), ".comp-bar-thumb")
    assert "transition: background var(--fast);" in thumb
    assert "transform" not in thumb.split("transition:")[1], \
        "no transition on the transform"


# ── how it behaves ───────────────────────────────────────────────────────────

def test_dragging_keeps_the_point_you_grabbed_and_tapping_centres():
    """Two gestures on one control. Grabbing the thumb has to keep the offset you grabbed
    it by, or it jumps under your finger; tapping the track has to put the middle of the
    thumb where you tapped, which is what makes a tap read as "go here"."""
    body = panel()
    assert 'const onThumb = e.target.closest(".comp-bar-thumb");' in body
    assert "const held = onThumb ? e.clientX - thumb.getBoundingClientRect().left : wide / 2;" \
        in body


def test_it_is_not_there_when_there_is_nothing_to_pan():
    """A full width thumb that cannot move is a control lying about being one."""
    body = panel()
    assert "bar.hidden = over <= 1;" in body


def test_the_bar_is_redrawn_everywhere_the_picture_can_go_stale():
    """Four ways for it to go stale, and two of them are easy to miss.

    A rebuild and a scroll are obvious. A trim is not: it changes how wide the strip is and
    therefore how much of it is on screen, so the thumb should get narrower without
    anything having scrolled. And a window resize goes through none of the three: the
    track shrinks while the thumb keeps the width and offset it was given for the old one.
    """
    body = code(panel())
    at = body.index("function redrawSizes()")
    assert "syncBar();" in body[at:body.index("let selected", at)], "after a trim"
    at = body.index('if (!e.target.classList.contains("comp-scroll")) return;')
    assert "syncBar();" in body[at:at + 300], "on a scroll"
    at = body.index("function draw()")
    assert "syncBar();" in body[at:body.index("let scrollLeft", at)], "on a rebuild"
    assert 'window.addEventListener("resize", onResize);' in body, "and on a resize"
    assert 'window.removeEventListener("resize", onResize)' in body, \
        "taken off when the panel goes, or every arrangement ever opened keeps listening"


def test_the_handler_is_on_the_panel_rather_than_the_bar():
    """draw() replaces the bar and its thumb, so anything bound to them goes in the bin
    with the old nodes. Every other handler in this panel is delegated for the same
    reason."""
    body = panel()
    at = body.index('const bar = e.target.closest(".comp-bar");')
    before = body[:at]
    assert before.rstrip().endswith('root.addEventListener("pointerdown", (e) => {'), \
        "bound to the panel, not to the bar"


def test_a_cancelled_drag_lets_go():
    """A pointercancel with no handler leaves the bar holding for ever, and it is the event
    a phone actually sends when the gesture is taken away."""
    body = panel()
    at = body.index('const bar = e.target.closest(".comp-bar");')
    drag = body[at:body.index("/* Put the clip nodes", at)]
    assert 'window.addEventListener("pointercancel", done);' in drag
    assert 'window.removeEventListener("pointercancel", done);' in drag
