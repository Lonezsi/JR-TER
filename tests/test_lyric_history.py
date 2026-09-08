"""The history list opening and closing, and the two things beside it.

Three requests in one go: the chosen A or B chip should behave as the dropdown it looks
like, the section tag belongs on the floor of the lyric card rather than wherever the words
happen to end, and the history should unroll and roll back up rather than appear.

The animation is the part worth writing down. It is not one transition: it is a height, a
stagger in one direction, a stagger in the other, and a script that has to wait for the
second stagger before it is allowed to redraw. Four numbers are shared between the
stylesheet and the panel, and if they drift the list is either cut off mid animation or
sits there finished for a moment before it goes.
"""
import io
import os
import re

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def read(*parts):
    return io.open(os.path.join(HERE, *parts), encoding="utf-8").read()


def panel():
    return read("web", "js", "62-panel-lyrics.js")


def song_css():
    return read("web", "css", "50-song.css")


def rule(source, selector):
    at = source.index(selector + " {")
    return source[at:source.index("}", at)]


def const(name):
    """One of the panel's own numbers."""
    found = re.search(r"^\s*const %s = (\d+);" % name, panel(), flags=re.M)
    assert found, "no %s in the panel" % name
    return int(found.group(1))


# ── the chip that looks like a dropdown ──────────────────────────────────────

def test_the_chosen_chip_is_a_dropdown_across_its_whole_width():
    """Asked for: "if on the compare part the already selected dropdown is clicked anywhere
    its used as a dropdown".

    An unselected chip has something to select, so pressing it selects. The one already
    selected has nothing left to select, and a control that looks like a dropdown and does
    nothing when pressed is worse than one that does the obvious thing.
    """
    view = read("web", "js", "60-view-song.js")
    assert 'if (!e.target.closest(".caret") && !chip.classList.contains("sel")) {' in view, \
        "the selected chip has to fall through to the menu"
    # And the class it reads is the one the painter writes, or it is reading nothing.
    assert 'chip.classList.toggle("sel", J.deckSelected(ctx) === slot);' in view


def test_the_caret_and_a_right_click_still_open_either_chip():
    """The unselected chip is still reachable as a menu, or filling B would need it to be
    selected first, which is the wrong way round."""
    view = read("web", "js", "60-view-song.js")
    assert 'bar.addEventListener("contextmenu"' in view
    at = view.index('bar.addEventListener("contextmenu"')
    assert "openSlotMenu(chip, chip.dataset.slot" in view[at:at + 400]


# ── the section tag ──────────────────────────────────────────────────────────

def test_the_section_tag_sits_on_the_floor_of_the_card():
    """Asked for: "move the section tag to the bottom of the lyrics box".

    It was in the flow straight after the words, so on a two line card it landed a third
    of the way down with two hundred pixels of nothing under it, and it moved every time
    the words got longer.
    """
    tools = rule(read("web", "css", "76-compositor.css"), ".card-foot-tools")
    assert "position: absolute;" in tools, \
        "the card's height is a floor, not a height, so a margin cannot push it down"
    assert "bottom:" in tools and "left:" in tools
    assert "margin-top" not in tools, "that is what put it under the text"
    # The card it is positioned against has to be the containing block.
    assert "position: relative;" in rule(song_css(), ".lyric-card")


def test_the_tag_clears_the_button_group_on_a_narrow_card():
    """The group hangs half its height below the card's bottom edge, so on a phone the two
    share a horizontal band. Measured at 375: the tag's floor and the group's ceiling were
    both at 822, which is touching and one pixel from wrong."""
    comp = read("web", "css", "76-compositor.css")
    at = comp.index(".card-foot-tools {")
    phone = comp[at:]
    phone = phone[phone.index("@media (max-width: 760px)"):]
    assert "bottom: calc(17px + var(--s2));" in phone[:phone.index("}") + 200], \
        "17 is half the group's height, the same number the dots are spaced by"


# ── the history list ─────────────────────────────────────────────────────────

def test_the_list_opens_by_growing_a_grid_row():
    """max-height needs a number nobody has: a guess is either a list that gets cut off or
    an animation that spends half its time crossing empty space."""
    css = song_css()
    wrap = rule(css, ".history-wrap")
    assert "grid-template-rows: 0fr;" in wrap
    assert "transition: grid-template-rows" in wrap
    assert ".history-wrap.on { grid-template-rows: 1fr; }" in css
    # A grid row can only shorten a child that will let itself be shortened.
    assert "min-height: 0;" in rule(css, ".history-rail")


def test_the_gap_above_the_list_is_inside_the_box_that_collapses():
    """Neither a margin nor padding on the rail can be part of this animation.

    A margin sits outside the box the row shortens, and padding cannot shrink below itself:
    with padding-top on the rail the collapse measured 160, 93, 33, 20, and then stopped at
    20 and was cut off there when the element was removed. On the first row the gap is
    inside the box that clips, so the whole thing reaches nought.
    """
    css = song_css()
    rail = rule(css, ".history-rail")
    assert "margin: 0 auto;" in rail, "no top margin on the rail"
    assert "padding-top" not in rail, "and no padding either: it cannot shrink"
    assert ".history-entry:first-child { margin-top: var(--s5); }" in css


def test_the_list_needs_a_frame_at_nought_before_it_is_told_to_be_tall():
    """A grid row written straight out as 1fr has no start state, so it arrives at full
    height with no transition at all."""
    body = panel()
    assert 'if (wrap) requestAnimationFrame(() => wrap.classList.add("on"));' in body


def test_the_rows_arrive_one_at_a_time():
    body = panel()
    assert "--i:${Math.min(i, STAGGER_CAP)}" in body, \
        "each row carries its own index, so the stylesheet counts nothing"
    entry = rule(song_css(), ".history-entry")
    assert "animation: entry-in" in entry
    assert "animation-delay: calc(var(--i, 0) * 42ms);" in entry


def test_the_rows_leave_in_the_other_order():
    """"the opposite out": the last row goes first, so the list folds up from the end it
    unrolled to."""
    body = panel()
    assert "--out:${Math.min(history.length - 1 - i, STAGGER_CAP)}" in body, \
        "the index counted from the bottom"
    css = song_css()
    out = rule(css, ".history-wrap.closing .history-entry")
    assert "animation: entry-out" in out
    assert "animation-delay: calc(var(--out, 0) * 26ms);" in out


def test_the_close_runs_before_the_redraw_rather_than_after():
    """draw() rewrites the whole block, so calling it first leaves nothing on the page to
    animate. This is the only reason closing needs a script at all."""
    body = panel()
    assert "async function closeHistory()" in body
    assert 'if (history) { await closeHistory(); return; }' in body, \
        "the toggle has to go through it"
    at = body.index("async function closeHistory()")
    close = body[at:body.index("block.addEventListener", at)]
    # Rows out, then the height, then the redraw. In that order.
    order = [close.index('wrap.classList.add("closing")'),
             close.index('wrap.classList.remove("on")'),
             close.index("done();", close.index('wrap.classList.remove("on")'))]
    assert order == sorted(order), "the sequence is rows, then height, then redraw"
    assert close.count("await J.wait(") == 2, "one wait for each of the two stages"
    assert "if (!block.isConnected) return;" in close, \
        "navigating away mid close must not redraw a panel that has gone"


def test_the_shared_numbers_agree():
    """Four numbers live in both files. The panel uses them to know when the rows have
    finished leaving, so a stylesheet edit that leaves them behind means the height starts
    closing over rows that are still on their way out."""
    css = song_css()
    assert "calc(var(--out, 0) * %dms)" % const("OUT_STEP") in css
    out = rule(css, ".history-wrap.closing .history-entry")
    assert "entry-out %dms" % const("OUT_MS") in out
    shut = rule(css, ".history-wrap.closing")
    assert "grid-template-rows %dms" % const("SHUT_MS") in shut,         "the panel waits SHUT_MS after removing .on, so the collapse has to take that long"
    # The cap is only in the panel, and it is what bounds the wait.
    assert const("STAGGER_CAP") >= 1


def test_nothing_animates_for_somebody_who_asked_for_that():
    """And the close still finishes: the script waits on a clock, not on these, so it does
    not matter to it whether they ran. An animationend based version would hang."""
    css = song_css()
    at = css.index("@media (prefers-reduced-motion: reduce)",
                   css.index(".history-wrap {"))
    block = css[at:css.index("}\n", css.index("{", at)) + 200]
    assert ".history-wrap { transition: none; }" in block
    assert "animation: none" in block
    assert "J.wait" in panel(), "the waits are timers for exactly this reason"
