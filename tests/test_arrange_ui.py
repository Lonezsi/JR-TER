"""The arrangement strip, and the four things that were wrong with handling it.

None of these are about what an arrangement is. They are about what happens under a finger,
and every one of them was a real complaint:

  pressing a block rebuilt the whole strip
  dragging a block scrolled the strip instead of moving the block
  there was no way to remove or repeat one without a right click or a keyboard
  the only way along a long arrangement was to drag the background, which is now the drag

The bugs all lived in the same two places, the panel and its stylesheet, and each of them
was one line. That is exactly the kind of thing that gets undone by accident, so it is
written down here rather than only in the commit that fixed it.
"""
import os
import re

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PANEL = os.path.join(HERE, "web", "js", "38-compositor.js")
SHEET = os.path.join(HERE, "web", "css", "76-compositor.css")


def panel():
    return open(PANEL, encoding="utf-8").read()


def sheet():
    return open(SHEET, encoding="utf-8").read()


def block(source, selector):
    """The declarations of one rule, by its exact selector."""
    at = source.index(selector + " {")
    return source[at:source.index("}", at)]


def code(source):
    """The same source with its comments taken out.

    Every one of these files explains itself at length, and the explanations name the very
    things being checked for absence: the note about why the release path no longer calls
    draw() contains the words "draw()". Searching the comments as well as the code is how
    a test passes because of a sentence and fails because of a rewording.
    """
    source = re.sub(r"/\*.*?\*/", "", source, flags=re.S)
    return re.sub(r"^\s*//.*$", "", source, flags=re.M)


# ── pressing one ─────────────────────────────────────────────────────────────

def test_a_press_that_moved_nothing_does_not_rebuild_the_strip():
    """draw() rewrites the panel's innerHTML, canvases and all.

    Every block draws the stretch of the render it uses onto its own canvas, so a rebuild
    throws away as many canvases as there are sections and paints that many again. On a
    press, which changes nothing but which block is chosen, all of that work produces the
    picture that was already on the screen, and the flicker of it happening is what a
    press felt like. The choice is a class, so it is applied as a class.
    """
    body = code(panel())
    at = body.index("const done = () => {")
    done = body[at:body.index("window.addEventListener(\"pointermove\", onMove);", at)]
    assert "if (tapped) { select(clipId); return; }" in done, \
        "a press should choose the block and stop, not fall through to a redraw"
    # And the redraw that remains is reached only by the two gestures that change the
    # numbers along the foot.
    assert "if (wasTrim || reordered) redrawSizes();" in done
    assert "draw()" not in done, \
        "nothing in the release path should rebuild the panel"


def test_the_choice_survives_a_rebuild():
    """It is state, so it outlives the node that was drawing it.

    A rebuild used to lose the outline and the two buttons, because both are drawn from a
    class on a node that has just been replaced.
    """
    body = panel()
    assert "markSelected();" in body
    at = body.index("function draw() {")
    end = body.index("let scrollLeft = 0;", at)
    assert "markSelected();" in body[at:end], "a rebuild has to put the choice back"
    assert "if (selected && !A.state.clips.some((c) => c.id === selected)) selected = null;" \
        in body[at:end], "and forget one that has been removed"


# ── dragging one ─────────────────────────────────────────────────────────────

def test_a_block_owns_the_sideways_drag():
    """touch-action, on the thing a finger actually lands on.

    Left at auto the browser owns the horizontal pan: a finger on a block scrolled the
    strip, and a moment in, the drag was taken away with pointercancel. pan-y rather than
    none, so the page still scrolls up and down through the panel.
    """
    rule = block(sheet(), ".comp-clip")
    assert "touch-action: pan-y;" in rule, \
        "without this a drag on a block scrolls the strip instead of moving the block"


def test_a_held_block_follows_the_finger():
    rule = block(sheet(), ".comp-clip")
    assert "transform: translate3d(var(--drag, 0px), 0, 0);" in rule
    assert "transition" in rule and "transform" not in rule.split("transition")[1], \
        "easing the drag would put the block a frame behind the hand"
    body = panel()
    assert "--drag" in body and "node.offsetLeft" in body, \
        "the offset is against where the node sits now, because a reorder moves its slot"


def test_a_reorder_moves_the_nodes_rather_than_building_new_ones():
    """The node being held has to survive the reorder.

    draw() mid gesture destroys it, which takes the pointer capture with it and throws
    away every canvas in the track on the frame the block crosses a boundary.
    """
    body = code(panel())
    assert "function reorderNodes()" in body
    at = body.index("const current = A.state.clips.findIndex((c) => c.id === clipId);")
    move = body[at:at + 200]
    assert "reorderNodes();" in move
    assert "draw();" not in move, "a live reorder must not rebuild the panel"


def test_the_entry_animation_is_held_off_while_something_is_being_moved():
    """Re-inserting a node starts its CSS animations again.

    An animation's transform beats the element's own, so for a third of a second after
    every boundary crossed, --drag was being set correctly and ignored: the block let go
    of the finger and sat in its new slot. This was found by measuring the drag, not by
    reading the code, which is why it is worth a test.
    """
    assert ".comp-clips.moving .comp-clip { animation: none; }" in sheet()
    body = panel()
    assert 'holder.classList.add("moving")' in body
    assert 'stillHolder.classList.remove("moving")' in body, \
        "left on, no block would ever animate in again"


# ── the two buttons ──────────────────────────────────────────────────────────

def test_the_chosen_block_carries_duplicate_and_remove():
    body = panel()
    assert 'data-act="dup-sel"' in body
    assert 'data-act="del-sel"' in body
    assert 'if (what === "dup-sel" && selected)' in body
    assert 'if (what === "del-sel" && selected)' in body
    # Both were a right click or a keyboard away, and neither is discoverable, and one of
    # them does not exist at all on a phone.
    assert "aria-label=\"Duplicate this section\"" in body
    assert "aria-label=\"Take this section out\"" in body


def test_the_buttons_are_not_a_drag_handle():
    body = panel()
    at = body.index('root.addEventListener("pointerdown"')
    assert 'if (e.target.closest(".comp-tools")) return;' in body[at:at + 300], \
        "a press on the buttons would otherwise start a drag of the block under them"


def test_the_buttons_are_not_inside_the_block_they_act_on():
    """A block clips its own overflow and is fourteen pixels wide at its smallest.

    Inside, the group would be hidden on exactly the blocks that are hardest to hit. It
    is a sibling of the row of blocks, positioned onto the chosen one.
    """
    body = panel()
    clips = body.index('<div class="comp-clips">')
    tools = body.index('<div class="comp-tools"')
    assert tools > clips, "the tools come after the blocks, outside them"
    assert '<div class="comp-tools"' not in body[body.index("function clipHtml"):
                                                 body.index("function drawBars")], \
        "not part of a block's own markup"
    assert "function placeTools()" in body
    assert "tools.style.left" in body and "tools.style.top" in body


def test_there_is_room_above_the_blocks_for_the_group_to_sit_on_the_edge():
    """.comp-scroll hides its vertical overflow, so the headroom is not optional.

    Measured before this: the top thirteen pixels of the group were cut off by the edge of
    the scroll box. The track grew by the same amount the row was padded, so the blocks
    are the height they always were.
    """
    css = sheet()
    clips = block(css, ".comp-clips")
    pad = re.search(r"padding:\s*(\d+)px", clips)
    assert pad, "the row needs an explicit top padding"
    top = int(pad.group(1))
    tool = block(css, ".comp-tool")
    height = int(re.search(r"height:\s*(\d+)px", tool).group(1))
    assert top >= height / 2, \
        "less than half the group's height and it is clipped by the scroll box"
    assert "height: 114px;" in block(css, ".comp-track"), \
        "the track has to grow with the padding or the blocks get shorter"


def test_the_buttons_are_kept_on_screen():
    """A section can be wider than the strip is.

    A chorus at four bars a screen has its right hand corner a thousand pixels off to the
    right, and the buttons went out there with it: you chose a block and nothing appeared.
    So the corner is where they want to be and the visible window is where they are
    allowed to be, and they slide along the top of a block that is only partly in view.
    """
    body = code(panel())
    at = body.index("function placeTools()")
    place = body[at:body.index("function select(", at)]
    assert "scroll.scrollLeft" in place and "scroll.clientWidth" in place,         "the window has to come into it, or a wide block hides its own buttons"
    assert "J.clamp" in place
    assert "tools.offsetWidth" in place,         "measured, not assumed: the buttons are wider on a phone"


def test_they_never_leave_the_block_they_belong_to():
    """Which is why there are two clamps and the block's one is applied last.

    Parked at the edge of the window, the group would sit on top of whichever block
    happened to be there and read as belonging to it.
    """
    body = code(panel())
    at = body.index("function placeTools()")
    place = body[at:body.index("function select(", at)]
    last = place[place.index("tools.style.left"):]
    assert "Math.min(left + width, right), right" in last,         "the final clamp is the block's own edges"


def test_scrolling_moves_them():
    body = code(panel())
    at = body.index('classList.contains("comp-scroll")')
    assert "placeTools();" in body[at:at + 260],         "they are clamped to the window, so where the window is has to reach them"


def test_a_trim_moves_them_too():
    """Trimming the chosen block changes the corner they sit on, and redrawSizes is the one
    function that changes a width."""
    body = code(panel())
    at = body.index("function redrawSizes()")
    assert "placeTools();" in body[at:body.index("let selected", at)]


# ── getting about ────────────────────────────────────────────────────────────

def test_the_scrollbar_is_thick_enough_to_be_a_control():
    """It is the way along a long arrangement now that a drag moves the block.

    Dragging the background used to be how you got about. That gesture belongs to the
    block, so the bar has to answer for it, and a hairline you hunt for with a thumb does
    not.
    """
    css = sheet()
    bar = re.search(r"\.comp-scroll::-webkit-scrollbar \{([^}]*)\}", css)
    assert bar, "the bar is styled at all"
    height = int(re.search(r"height:\s*(\d+)px", bar.group(1)).group(1))
    assert height >= 14, "a thumb needs something to aim at"
    assert "scrollbar-width: auto;" in block(css, ".comp-scroll"), \
        "Firefox does not read the webkit pseudo elements"
    assert "::-webkit-scrollbar-thumb" in css, "a track with no thumb is a groove"
    # Bigger again where the only pointer is a thumb.
    phone = css[css.index("@media (max-width: 900px)"):]
    assert "::-webkit-scrollbar { height: 16px; }" in phone


def test_the_hint_at_the_foot_says_what_the_gestures_actually_do():
    """It said double click to duplicate, which is not a thing a phone can do.

    There are two buttons on the chosen block for that now, and the hint should point at
    the gesture that reaches them.
    """
    body = panel()
    assert "double click to duplicate" not in body, \
        "still true with a mouse, but it is not the way anybody is told about any more"
    assert "tap to choose" in body
