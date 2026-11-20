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

They live in ui/src/views/song/timeline/Editor.svelte now: script, markup and style in one
file, so each test slices out the part it is about.
"""
import os
import re

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EDITOR = os.path.join(HERE, "ui", "src", "views", "song", "timeline", "Editor.svelte")


def code(source):
    """The same source with its comments taken out.

    Every one of these files explains itself at length, and the explanations name the very
    things being checked for absence. Searching the comments as well as the code is how a
    test passes because of a sentence and fails because of a rewording.
    """
    source = re.sub(r"/\*.*?\*/", "", source, flags=re.S)
    source = re.sub(r"<!--.*?-->", "", source, flags=re.S)
    return re.sub(r"^\s*//.*$", "", source, flags=re.M)


def _whole():
    return open(EDITOR, encoding="utf-8").read()


def script():
    source = _whole()
    return code(source[:source.index("</script>")])


def markup():
    source = _whole()
    return code(source[source.index("</script>"):source.index("<style>")])


def sheet():
    source = _whole()
    return code(source[source.index("<style>"):])


def block(source, selector):
    """The declarations of one rule, by its exact selector."""
    at = source.index(selector + " {")
    return source[at:source.index("}", at)]


# ── pressing one ─────────────────────────────────────────────────────────────

def test_a_press_that_moved_nothing_changes_nothing_in_the_arrangement():
    """A press chooses the block and stops. Only a gesture that moved something, and landed
    it somewhere new, is allowed to touch the order, and a cancelled one never is."""
    body = script()
    at = body.index("function grab(")
    assert "arrange.select(clip.id);" in body[at:at + 700], "a press chooses the block"
    at = body.index("function release(")
    release = body[at:at + 1500]
    assert "g.moved && !g.edge" in release and "g.drop !== g.i0" in release, \
        "the order changes only for a drag that crossed a boundary"
    assert 'e.type !== "pointercancel"' in release


# ── dragging one ─────────────────────────────────────────────────────────────

def test_a_block_owns_the_sideways_drag():
    """touch-action, on the thing a finger actually lands on.

    Left at auto the browser owns the horizontal pan: a finger on a block scrolled the
    strip, and a moment in, the drag was taken away with pointercancel. pan-y rather than
    none, so the page still scrolls up and down through the panel.
    """
    rule = block(sheet(), ".clip")
    assert "touch-action: pan-y;" in rule, \
        "without this a drag on a block scrolls the strip instead of moving the block"


def test_a_held_block_follows_the_finger():
    css = sheet()
    held = block(css, ".clip.holding")
    assert "transition: none;" in held, "easing the drag would put the block a frame behind the hand"
    assert "translate3d({mine ? held!.dx : (shifts[clip.id] ?? 0)}px,0,0)" in markup()


def test_the_neighbours_ease_aside_only_while_a_drag_is_in_progress():
    """Off at the drop, so the order changing and the transforms clearing in one frame do
    not animate back."""
    css = sheet()
    assert ".clips.moving .clip:not(.holding) { transition: transform var(--med)" in css
    body = script()
    assert "moving = true;" in body and "moving = false;" in body, \
        "left on, nothing would ever stop animating"


# ── the two buttons ──────────────────────────────────────────────────────────

def test_the_chosen_block_carries_duplicate_and_remove():
    """Both were a right click or a keyboard away, and neither is discoverable, and one of
    them does not exist at all on a phone."""
    body = markup()
    assert 'aria-label="Duplicate this section"' in body
    assert 'aria-label="Take this section out"' in body
    assert "duplicateClip(A.selected!)" in body and "removeClip(A.selected!)" in body
    assert "{#if A.selected && !held}" in body, "and they step aside while a block is in hand"


def test_the_buttons_are_not_inside_the_block_they_act_on():
    """A block clips its own overflow and is fourteen pixels wide at its smallest.

    Inside, the group would be hidden on exactly the blocks that are hardest to hit. It is
    a sibling of the row of blocks, positioned onto the chosen one, which also means a
    press on a button cannot start a drag of the block under it.
    """
    body = markup()
    clips = body.index('<div class="clips"')
    tools = body.index('<div class="tools"')
    assert tools > clips, "the tools come after the blocks"
    assert body.index("{/each}") < tools, "outside the loop that draws a block"
    assert "style:left=" in body[tools:tools + 300], "positioned onto the chosen block"


def test_there_is_room_above_the_blocks_for_the_group_to_sit_on_the_edge():
    """.scroll hides its vertical overflow, so the headroom is not optional.

    The group is centred on the top edge of a block, so the row has to be padded by at
    least half of its height or the top of it is cut off by the scroll box.
    """
    css = sheet()
    pad = re.search(r"padding:\s*(\d+)px", block(css, ".clips"))
    assert pad, "the row needs an explicit top padding"
    height = int(re.search(r"height:\s*(\d+)px", block(css, ".tool")).group(1))
    assert int(pad.group(1)) >= height / 2, \
        "less than half the group's height and it is clipped by the scroll box"
    assert "overflow-y: hidden;" in block(css, ".scroll")
    assert "translate(-100%, -50%)" in block(css, ".tools")


def test_the_buttons_are_kept_on_screen():
    """A section can be wider than the strip is.

    A chorus at four bars a screen has its right hand corner a thousand pixels off to the
    right, and the buttons went out there with it: you chose a block and nothing appeared.
    So the corner is where they want to be and the visible window is where they are
    allowed to be, and they slide along the top of a block that is only partly in view.
    """
    body = markup()
    assert "scrollLeft + toolsW + EDGE" in body and "scrollLeft + avail - EDGE" in body, \
        "the window has to come into it, or a wide block hides its own buttons"
    assert "bind:offsetWidth={toolsW}" in body, \
        "measured, not assumed: the buttons are wider on a phone"


def test_they_never_leave_the_block_they_belong_to():
    """Which is why there are two clamps and the block's one is applied last.

    Parked at the edge of the window, the group would sit on top of whichever block
    happened to be there and read as belonging to it.
    """
    body = markup()
    assert "clamp(at, Math.min(box.left + toolsW, right), right)" in body
    assert body.index("{@const at = clamp(right, lo, hi)}") < body.index("clamp(at, Math.min")


def test_scrolling_moves_them():
    """They are clamped to the window, so where the window is has to reach them."""
    body = markup()
    assert "onscroll={(e) => (scrollLeft = e.currentTarget.scrollLeft)}" in body
    assert "scrollLeft + avail - EDGE" in body, "and the position is derived from it"
