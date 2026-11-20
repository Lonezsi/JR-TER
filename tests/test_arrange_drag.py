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

The drag lives in ui/src/views/song/timeline/Editor.svelte and the order in
ui/src/lib/audio/arrange.svelte.ts.
"""
import io
import os
import re

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def read(*parts):
    return io.open(os.path.join(HERE, *parts), encoding="utf-8").read()


def code(source):
    """Comments out, because they name the things being checked for absence."""
    source = re.sub(r"/\*.*?\*/", "", source, flags=re.S)
    return re.sub(r"^\s*//.*$", "", source, flags=re.M)


def panel():
    source = read("ui", "src", "views", "song", "timeline", "Editor.svelte")
    return code(source[:source.index("</script>")])


def const(name):
    found = re.search(r"\b%s = (\d+)\b" % name, panel())
    assert found, "no %s in the panel" % name
    return int(found.group(1))


def _arrange():
    return code(read("ui", "src", "lib", "audio", "arrange.svelte.ts"))


# ── the flicker ──────────────────────────────────────────────────────────────

def test_the_slot_is_decided_against_the_neighbours_as_they_sat_when_the_drag_began():
    """Never against the layout that includes the block in hand: a committed swap would
    move the very boundary that decided it and the block would flicker back."""
    body = panel()
    assert "others: layout.map((b, j) => ({ j, centre: b.left + b.width / 2 })).filter((o) => o.j !== i)" in body
    at = body.index("function place(")
    place = body[at:body.index("function trim(", at)]
    assert "for (const o of g.others) if (o.centre < centre) k++;" in place
    assert "layout[" not in place, "the live layout is not consulted while deciding the slot"
    assert "A.clips" not in place.split("shifts")[0], "nor the order that is about to change"


def test_nothing_is_moved_in_the_order_until_the_drag_is_released():
    """The blocks are shifted visually while the drag is on and the order changes once, so
    there is no layout moving under the pointer for the decision to react to."""
    body = panel()
    at = body.index("function place(")
    place = body[at:body.index("function trim(", at)]
    assert "arrange.move" not in place and "arrange.touch" not in place
    at = body.index("function release(")
    release = body[at:body.index("// ── keyboard", at) if "// ── keyboard" in body else at + 1200]
    assert "arrange.move(g.id, g.drop);" in release


def test_the_block_is_positioned_on_the_strips_own_ruler():
    """Not as a delta from where the finger started. The strip can scroll under a drag, and
    a delta from a viewport position knows nothing about that."""
    body = panel()
    assert "const onStrip = (clientX: number)" in body
    assert "grabbedBy: onStrip(e.clientX) - box.left" in body
    assert "at - g.grabbedBy" in body


def test_nothing_adds_a_scroll_offset_on_top_of_the_ruler():
    """The track's own rectangle already moves with the scroll, so measuring against it
    gives the same number before and after a pan. Adding scrollLeft would double count.

    Asked of the whole function rather than of one spelling, because a test for a name is
    not a test for the mistake.
    """
    body = panel()
    at = body.index("const onStrip")
    fn = body[at:body.index(";", at)]
    assert "scrollLeft" not in fn
    assert "getBoundingClientRect().left" in fn


# ── the announcements ────────────────────────────────────────────────────────

def test_a_quiet_move_tells_nobody_and_a_loud_one_does():
    """touch() emits arrange:change and the lyric deck rebuilds every card it has on that
    event. A move in the middle of a drag must be able to skip that."""
    arrange = _arrange()
    assert "move(clipId: string, toIndex: number, quiet = false) {" in arrange
    assert "if (quiet) return;" in arrange


def test_a_quiet_move_still_moves():
    """What it skips is telling anybody, not the reorder itself. A quiet move that did
    nothing would leave the drag looking right and the arrangement unchanged."""
    arrange = _arrange()
    at = arrange.index("move(clipId: string, toIndex: number, quiet = false) {")
    body = arrange[at:arrange.index("duplicate(", at)]
    order = [body.index("state.clips.splice(from, 1)"),
             body.index("state.clips.splice(clamp(toIndex"),
             body.index("if (quiet) return;"),
             body.index("arrange.touch();")]
    assert order == sorted(order), "the splices come before the early return and the touch"


def test_a_drag_ends_in_one_announcement():
    """One for however many boundaries the drag crossed: the save, the reschedule and the
    lyric deck's redraw all hang off it, and none should run per pixel. A cancelled gesture
    announces nothing."""
    body = panel()
    at = body.index("function release(")
    release = body[at:at + 1500]
    assert 'e.type !== "pointercancel"' in release
    assert release.count("arrange.move(") == 1


# ── the edge ─────────────────────────────────────────────────────────────────

def test_holding_a_block_at_the_edge_pans_the_strip():
    """Dragging a block owns the sideways gesture, so without this there is no way to carry
    one past the edge of what is on screen: you would drop it, scroll, and pick it up."""
    body = panel()
    at = body.index("function edgePan(")
    pan = body[at:body.index("function stopPan", at)]
    assert "clientX < box.left + BAND" in pan, "both ends"
    assert "clientX > box.right - BAND" in pan
    assert "clamp(into / BAND, -1, 1) * MOST" in pan, \
        "the speed rises across the band, so resting creeps and pressing runs"
    assert "place(panning.x)" in pan, \
        "and it keeps asking where the block goes as the strip moves under it"


def test_the_pan_speed_is_pixels_per_second_rather_than_per_tick():
    """A fixed step per tick is a speed of "as fast as this machine happens to be":
    every tick does layout and sometimes a reorder and the timer never gets its
    interval."""
    body = panel()
    assert "const dt = Math.min(CAP, t - panning.last);" in body
    assert "(panning.speed * dt) / 1000" in body
    assert const("CAP") > 0, "one tick cannot claim unbounded time after a stall"


def test_the_pan_does_not_depend_on_the_page_being_visible():
    """requestAnimationFrame is paused outright while the page is hidden. Nothing here
    needs frame alignment: what it writes is scrollLeft."""
    body = panel()
    pan = body[body.index("function edgePan("):body.index("function stopPan")]
    assert "requestAnimationFrame" not in pan
    assert "setInterval(step, EVERY)" in pan


def test_the_pan_stops_every_way_a_drag_can_end():
    body = panel()
    at = body.index("function edgePan(")
    pan = body[at:body.index("function stopPan", at)]
    assert "if (!into) return stopPan();" in pan, "leaving the band"
    assert "if (!drag || !panning || !scroller) return stopPan();" in pan, "the drag ending"
    at = body.index("function release(")
    assert "stopPan();" in body[at:at + 400], "and the release path, explicitly"
