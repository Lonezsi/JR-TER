"""Dragging a section: where it lands, and what else the gesture must not disturb.

Three things asked for together, and the middle one is a real bug rather than a request.

"if i grab a section and move it to just the right spot it flickers bc it is unsure where it
should go." It was. The slot was chosen by walking every block's width and asking which half
of which one the pointer was in, and those widths are the layout including the block being
dragged, so committing a move changed the boundaries that had just decided it.

Worked through with three blocks of 107, 133 and 120 and the first in hand: at 53.5 the
boundaries say slot 1, the move makes the order c2 c1 c3, and in that layout 53.5 says slot
0 again. Measured: crossing one boundary changed the order five times, and jittering a pixel
either side of the exact point swapped on every event.
"""
import io
import os
import re

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def read(*parts):
    return io.open(os.path.join(HERE, *parts), encoding="utf-8").read()


def panel():
    return read("web", "js", "38-compositor.js")


def code(source):
    """Comments out, because they name the things being checked for absence."""
    source = re.sub(r"/\*.*?\*/", "", source, flags=re.S)
    return re.sub(r"^\s*//.*$", "", source, flags=re.M)


def const(name):
    found = re.search(r"^\s*const %s = (\d+);" % name, panel(), flags=re.M)
    assert found, "no %s in the panel" % name
    return int(found.group(1))


# ── the flicker ──────────────────────────────────────────────────────────────

def test_the_slot_is_decided_against_the_neighbours_not_the_whole_row():
    """One step at a time, and only by whether the block in hand has passed the centre of
    the one beside it. That cannot oscillate: after a swap the neighbour is on the other
    side and further away than the centre that just passed it."""
    body = code(panel())
    assert "function reorderAround(clipId)" in body
    assert "const centre = mine.left + mine.width / 2;" in body
    assert "const after = middleOf(node.nextElementSibling);" in body
    assert "const before = middleOf(node.previousElementSibling);" in body
    assert "if (after !== null && centre > after) step = 1;" in body
    assert "else if (before !== null && centre < before) step = -1;" in body
    assert "A.move(clipId, now + step, true);" in body, "one step, never a jump"


def test_the_old_walk_over_every_width_is_gone():
    """It is the walk itself that was wrong, not a threshold in it. Anything that decides
    the slot from absolute positions in a layout it is about to change will flicker again."""
    body = code(panel())
    assert "let walked = 0" not in body, "the walk over every width"
    assert "if (target !== current)" not in body, "and the comparison it fed"
    # Widths are still computed, for drawing the blocks and for trimming one. What is gone
    # is deciding an order from them.
    at = body.index("const onMove = (event) => {")
    move = body[at:body.index("const done = () => {", at)]
    assert "pxPerBeat()" in move, "a trim is still measured in beats"
    assert "A.state.clips[i]" not in move, "but nothing walks the row any more"


def test_the_block_is_positioned_on_the_strips_own_ruler():
    """Not as a delta from where the finger started. The strip can scroll under a drag now,
    and a delta from a viewport position knows nothing about that."""
    body = code(panel())
    assert "function pointerOnStrip(clientX)" in body
    assert "grabbedBy: pointerOnStrip(startX) - clipNode.offsetLeft" in body
    assert "at - dragging.grabbedBy - node.offsetLeft" in body
    assert "homeLeft" not in body, "the old delta anchor"


def test_nothing_adds_a_scroll_offset_that_is_always_nought():
    """The row's own rectangle already moves with the scroll, so measuring against it gives
    the same number before and after a pan.

    The old line added the scroller's scrollLeft on top of that, which would have been
    double counting. It read the row's parent, which is .comp-track and does not scroll, so
    it added nought and the sum happened to be right for the wrong reason: a latent bug
    that would have woken up the moment anybody moved the scrolling to that element.

    Asked of the whole function rather than of the old spelling, because the variable it
    used to be written with has since been renamed and a test for a name is not a test for
    the mistake.
    """
    body = code(panel())
    at = body.index("function pointerOnStrip(clientX)")
    fn = body[at:body.index("}", body.index("return", at))]
    assert "scrollLeft" not in fn, \
        "the row's rectangle already accounts for the scroll; adding it again double counts"


# ── the announcements ────────────────────────────────────────────────────────

def test_a_reorder_mid_drag_tells_nobody_until_the_drag_ends():
    """touch() emits arrange:change and the lyric deck rebuilds every card it has on that
    event. Announcing each boundary a block crosses meant rebuilding the deck several times
    a second for an order nobody had settled on, and with edge panning the crossings arrive
    as fast as the scroll does."""
    arrange = read("web", "js", "22-arrange.js")
    assert "move(clipId, toIndex, quiet) {" in arrange
    assert "if (quiet) return;" in arrange
    body = code(panel())
    assert "A.move(clipId, now + step, true);" in body
    assert "if (reordered) { A.touch(); A.resync(); }" in body, \
        "and one announcement for however many crossings there were"


def test_a_quiet_move_still_moves():
    """What it skips is telling anybody, not the reorder itself. A quiet move that did
    nothing would leave the drag looking right and the arrangement unchanged."""
    arrange = read("web", "js", "22-arrange.js")
    at = arrange.index("move(clipId, toIndex, quiet) {")
    body = arrange[at:arrange.index("duplicate(clipId)", at)]
    order = [body.index("state.clips.splice(from, 1)"),
             body.index("state.clips.splice(J.clamp(toIndex"),
             body.index("if (quiet) return;")]
    assert order == sorted(order), "the splices come before the early return"


# ── the edge ─────────────────────────────────────────────────────────────────

def test_holding_a_block_at_the_edge_pans_the_strip():
    """Dragging a block owns the sideways gesture, so without this there is no way to carry
    one past the edge of what is on screen: you would drop it, scroll, and pick it up."""
    body = code(panel())
    assert "function edgePan(clientX, clipId)" in body
    assert "clientX < box.left + PAN_BAND" in body, "both ends"
    assert "clientX > box.right - PAN_BAND" in body
    assert "J.clamp(into / PAN_BAND, -1, 1) * PAN_MOST" in body, \
        "the speed rises across the band, so resting creeps and pressing runs"
    assert "reorderAround(panning.clipId);" in body, \
        "and it keeps asking where the block goes as the strip moves under it"


def test_the_pan_speed_is_pixels_per_second_rather_than_per_tick():
    """A fixed step per tick is a speed of "as fast as this machine happens to be": measured
    at about a hundred pixels a second against the four hundred it was asking for, because
    every tick does layout and sometimes a reorder and the timer never gets its interval."""
    body = code(panel())
    assert "const dt = Math.min(PAN_CAP, now - panning.last);" in body
    assert "(panning.speed * dt) / 1000" in body
    assert const("PAN_CAP") > 0, "one tick cannot claim unbounded time after a stall"


def test_the_pan_does_not_depend_on_the_page_being_visible():
    """requestAnimationFrame is the usual tool for something that moves and it is paused
    outright while the page is hidden. Nothing here needs frame alignment: what it writes is
    scrollLeft, and the compositor picks that up on its own schedule."""
    body = code(panel())
    assert "requestAnimationFrame" not in body.split("function edgePan")[1] \
        .split("function stopPan")[0]
    assert "setInterval(step, PAN_EVERY)" in body


def test_the_pan_stops_every_way_a_drag_can_end():
    body = code(panel())
    assert "if (!into) return stopPan();" in body, "leaving the band"
    assert "if (!dragging || !panning) return stopPan();" in body, "the drag ending"
    # The block drag's release, not the bar's: the panel has two of each now, and only
    # this one can have started a pan. onMove exists in the block handler alone.
    at = body.index("const onMove = (event) => {")
    at = body.index("const done = () => {", at)
    assert "stopPan();" in body[at:at + 200], "and the release path, explicitly"


# ── and the sidebar it must not disturb ──────────────────────────────────────

def test_the_bar_is_not_a_sidebar_swipe():
    """Asked for: mark the scrollbar as a no swipe for the side panel.

    The rail opens on a sideways drag from anywhere, on purpose: a list of things too
    pressable to swipe over is what used to keep that gesture in the margins. What is
    excluded is only what already owns a sideways drag, and this bar does.
    """
    boot = read("web", "js", "90-boot.js")
    at = boot.index("function claimsSideways(node)")
    body = boot[at:boot.index("//: How far one direction has to win", at)]
    assert '.comp-bar' in body, "the bar has to claim its own sideways drag"
    assert 'node.closest("canvas, .range, .bar, .comp-bar, .q-knob")' in boot, \
        "with the other controls where every drag sets a value"


def test_the_strip_itself_is_still_excluded_only_when_it_overflows():
    """An arrangement of four bars does not scroll and an arrangement of two hundred does,
    so this one is measured rather than assumed. The bar is not, because it is only on
    screen when there is something to pan."""
    boot = read("web", "js", "90-boot.js")
    assert 'const strip = node.closest(".comp-scroll");' in boot
    assert "strip.scrollWidth > strip.clientWidth + 1" in boot
