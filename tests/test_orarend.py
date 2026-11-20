"""The week, checked by running the sums that lay it out.

Every test that is about the layout runs the view's own arithmetic (ui/src/views/orarend/
week.ts) under node, through tests/orarend_plan.mjs, and reads the placements it produced.
The grid itself is a Svelte component now, which node cannot draw, so what is about markup
reads ui/src/views/Orarend.svelte and orarend/Day.svelte as text and says so. The layout
is not text: the source text is not what was wrong with the sketch this replaced, which
positioned each class with a hand written top and height in pixels, and the numbers were
right until anything moved.

WHY THE ASSERTIONS ARE INVARIANTS AND NOT COUNTS. This is somebody's timetable and it
changes every semester, and the real one is not in this repository at all. A test that says
"Thursday has six classes" fails on the day a class is dropped, which is not a bug, and
says nothing about the day a class is added at 07:00 and draws above the top of the grid,
which is. So these ask what stays true of any week: everything is inside the window it is
drawn in, nothing is hidden underneath anything else, and everything can be reached and
read.

THE WEEK USED HERE IS MADE UP. A fixture, written in this file, which is the point: the
real one names a second person and her hours and this repository is public. The fixture is
shaped to exercise the things that are easy to get wrong rather than to resemble anybody's
actual week: a clash, a skipped lecture with a class beside it, and a class that ends on a
half hour.
"""
import io
import json
import os
import re
import shutil
import subprocess
import sys

import pytest

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, ROOT)

PLAN = os.path.join(HERE, "orarend_plan.mjs")

from jriter.modules import orarend   # noqa: E402

FROM, TO, HOUR = orarend.FROM, orarend.TO, orarend.HOUR

#: A week with something wrong-able in every corner of it.
#:
#: The other person is called Vendég here rather than anybody. This repository is public,
#: the real week lives only on the host and is not committed, and there is no reason for a
#: fixture about lane packing to carry somebody's name to GitHub. Everything below is
#: invented: the courses, the rooms and the times.
#:
#:   Monday     a plain two hour lecture, and one of theirs at the same time
#:   Tuesday    three of theirs at once, which is what lanes exist for
#:   Wednesday  a lecture that is not attended, with a class of mine beside it
#:   Thursday   a class ending on a half hour, so the height is not a whole number of rows
#:   Friday     nothing, because an empty day is a real day
WEEK = {"classes": [
    # A second person, so "whose stripe is that" is a question the week can ask. One colour
    # answered it while there was one of them and stopped answering it at two.
    #
    # FIRST IN THIS LIST AND LAST IN THE ALPHABET, both deliberately. The numbering is by
    # name, so that a person keeps their colour when a class is added or dropped; with the
    # two orders agreeing, taking the sort out changed nothing and the test for it passed
    # against either rule.
    #
    # Wednesday, not Tuesday: Tuesday is the three-at-once fixture and a fourth stripe in
    # that hour makes it four, which is a different test.
    {"day": 2, "at": "16:00", "to": "17:00", "kind": "gy", "whose": "Zed",
     "name": "A másik vendég órája", "where": "H terem"},

    {"day": 0, "at": "08:00", "to": "10:00", "kind": "ea", "whose": "me",
     "name": "Első tárgy Ea", "where": "A terem"},
    {"day": 0, "at": "08:00", "to": "09:00", "kind": "gy", "whose": "Vendég",
     "name": "A vendég órája", "where": "B terem"},

    {"day": 1, "at": "10:00", "to": "12:00", "kind": "ea", "whose": "Vendég",
     "name": "Egyszerre egy", "where": "C terem"},
    {"day": 1, "at": "10:00", "to": "11:00", "kind": "gy", "whose": "Vendég",
     "name": "Egyszerre kettő", "where": "D terem"},
    {"day": 1, "at": "10:30", "to": "11:30", "kind": "both", "whose": "Vendég",
     "name": "Egyszerre három", "where": "E terem"},
    # Later the same day, clashing with none of them. This is what tells "the first free
    # lane" apart from "the next lane": both rules put the three above in 0, 1 and 2, and
    # only the wrong one puts this in 3, leaving two stripes' width of nothing beside it.
    # Without this entry the packing test passes on either rule.
    {"day": 1, "at": "14:00", "to": "15:00", "kind": "gy", "whose": "Vendég",
     "name": "Később, egyedül ő is", "where": "F terem"},

    {"day": 2, "at": "12:00", "to": "14:00", "kind": "ea", "whose": "me", "skip": True,
     "name": "Amire nem járok", "where": "F terem"},
    {"day": 2, "at": "12:00", "to": "14:00", "kind": "gy", "whose": "me",
     "name": "Amire igen", "where": "G terem"},
    {"day": 2, "at": "16:00", "to": "18:00", "kind": "gy", "whose": "me",
     "name": "Később, egyedül", "where": "H terem"},

    {"day": 3, "at": "17:45", "to": "19:15", "kind": "both", "whose": "me",
     "name": "Fél órán végződik", "where": "I terem"},
]}


def planned(week=None, who=None):
    """Run the view's own layout sums over a week and return what they decided.

    `who` is whose week to draw, as the page's switch says it: "all", "me", or a name.
    The sums are ui/src/views/orarend/week.ts, which node loads as it is (it is pure
    functions with erasable types only), so nothing is exported for the test's benefit.
    """
    node = shutil.which("node")
    if not node:
        pytest.fail(
            "node is not on PATH, so the timetable's arithmetic is not being checked at"
            " all. These tests run the real sums rather than reading them, which is the only"
            " way to know where a stripe landed.")
    import tempfile
    data = dict(week if week is not None else WEEK)
    data.setdefault("from", FROM)
    data.setdefault("to", TO)
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False,
                                     encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False)
        path = f.name
    try:
        out = subprocess.run([node, "--experimental-strip-types", "--no-warnings", PLAN,
                              path, who or "all"], capture_output=True, cwd=ROOT)
        assert out.returncode == 0, out.stderr.decode("utf-8", "replace")
        return json.loads(out.stdout.decode("utf-8"))
    finally:
        os.remove(path)


DAY_NAMES = ["Hétfő", "Kedd", "Szerda", "Csütörtök", "Péntek"]


def boxes(made, day=None):
    """Everything drawn, as (kind of box, placement) pairs. Hours, as the view writes them."""
    out = []
    for plan in made["days"]:
        if day is not None and plan["day"] != day:
            continue
        for what in ("bands", "cards", "stripes"):
            out += [(what, dict(b, day=plan["day"])) for b in plan[what]]
    return out


def clash(a, b):
    return a["at"] < b["at"] + b["runs"] and b["at"] < a["at"] + a["runs"]


def view_source(*parts):
    return io.open(os.path.join(ROOT, "ui", "src", "views", *parts), encoding="utf-8").read()


# ── the window ───────────────────────────────────────────────────────────────

def test_the_window_is_the_one_the_server_sends_when_nothing_is_outside_it():
    """"21:00" is the row from 21:00 to 22:00, so the grid has TO - FROM rows and the last
    label is one short of the end: a label for 22:00 is an hour of grid after the day has
    ended, and an empty band under the last class."""
    made = planned()
    assert made["window"] == {"from": FROM, "to": TO}, made["window"]
    source = view_source("Orarend.svelte")
    assert "const rows = $derived(win.to - win.from);" in source
    assert "Array.from({ length: rows }, (_, i) => win.from + i)" in source, (
        "the hour labels are not one per row from the top of the window, so they can run"
        " past the end of it")


def test_nothing_is_drawn_outside_the_grid():
    """A class at 07:00 draws above the top of the grid and cannot be clicked.

    Positions are worked out from times, correctly, and a time outside the window is worked
    out into a position outside the grid. Adding an early class is a normal thing to do, so
    the window has to open to hold it.
    """
    for week in (WEEK, {"classes": WEEK["classes"] + [
            {"day": 4, "at": "07:00", "to": "09:00", "kind": "ea", "whose": "me",
             "name": "Hajnali", "where": "Sehol"},
            {"day": 4, "at": "21:00", "to": "23:00", "kind": "gy", "whose": "me",
             "name": "Késői", "where": "Sehol"}]}):
        made = planned(week)
        rows = made["window"]["to"] - made["window"]["from"]
        for what, box in boxes(made):
            assert box["at"] >= 0, (
                "%s: something is drawn %.2f hours above the top of the grid, so it is off"
                " the page: %s" % (DAY_NAMES[box["day"]], -box["at"], box["name"]))
            assert box["at"] + box["runs"] <= rows, (
                "%s: something reaches past the bottom of the %d hour grid: %s"
                % (DAY_NAMES[box["day"]], rows, box["name"]))


def test_an_early_class_moves_the_window_rather_than_the_class():
    """The test above, shown to fail on the thing it is for.

    Without this, "nothing is outside the grid" passes on any week that happens not to have
    an early class, which is every week until the one that does.
    """
    early = {"classes": WEEK["classes"] + [
        {"day": 4, "at": "07:00", "to": "09:00", "kind": "ea", "whose": "me",
         "name": "Hajnali", "where": "Sehol"}]}
    made = planned(early)
    assert made["window"]["from"] == 7, made["window"]
    assert made["window"]["from"] < FROM


def test_every_box_has_a_height_to_it():
    """A zero or negative height is a class whose end is before its start. It renders as an
    invisible sliver rather than an error, and the class is simply not on the timetable."""
    made = planned()
    drawn_boxes = boxes(made)
    assert drawn_boxes
    for what, box in drawn_boxes:
        assert box["runs"] > 0, (
            "%s: %s is %.2f hours tall, so its finish is not after its start. It is on the"
            " page and cannot be seen or clicked." % (DAY_NAMES[box["day"]], box["name"],
                                                       box["runs"]))


def test_a_class_ending_on_a_half_hour_is_half_a_row_tall():
    """The arithmetic, at the one place rounding would show.

    17:45 to 19:15 is an hour and a half, so 1.5 rows, and 9.75 hours after 08:00. A view
    that rounded to whole rows would put it on the hour and it would still look plausible.
    """
    made = planned()
    found = [b for _, b in boxes(made) if b["runs"] == 1.5]
    assert found, "nothing in the fixture is an hour and a half tall any more"
    assert found[0]["at"] == 9.75 and found[0]["runs"] == 1.5, (
        "a class at 17:45 is drawn %.2f rows down rather than 9.75" % found[0]["at"])


# ── the clash, which the sketch handled by hand ──────────────────────────────

def test_two_classes_at_once_never_share_a_lane():
    """The sketch put a hand written class on the two overlaps it knew about, which is
    fine until a third appears and sits underneath the second with nothing to say so."""
    made = planned()
    for plan in made["days"]:
        stripes = plan["stripes"]
        for i, a in enumerate(stripes):
            for b in stripes[i + 1:]:
                if clash(a, b):
                    assert a["lane"] != b["lane"], (
                        "%s: two stripes overlap in time and are both in lane %s, so one is"
                        " underneath the other: %s and %s"
                        % (DAY_NAMES[plan["day"]], a["lane"], a["name"], b["name"]))


def test_the_lanes_are_packed_from_the_left():
    """First free lane, not next lane.

    Counting up per stripe also gives every clash its own lane, and leaves a stripe's width
    of nothing wherever an earlier clash had ended.
    """
    made = planned()
    for plan in made["days"]:
        for box in plan["stripes"]:
            beside = [o["lane"] for o in plan["stripes"] if o is not box and clash(box, o)]
            for lane in range(box["lane"]):
                assert lane in beside, (
                    "%s: a stripe sits in lane %s while lane %d is free at that hour: %s"
                    % (DAY_NAMES[plan["day"]], box["lane"], lane, box["name"]))


def test_three_at_once_get_three_lanes():
    """The case the fixture exists for, and the one a pair of hand written classes missed."""
    made = planned()
    tuesday = [b for what, b in boxes(made, 1) if what == "stripes" and b["at"] < 4]
    assert len(tuesday) == 3, "the fixture's three clashing classes are not all drawn"
    assert sorted(b["lane"] for b in tuesday) == [0, 1, 2], (
        "three classes at the same hour landed in lanes %s" % sorted(b["lane"] for b in tuesday))


# ── whose stripe is that ─────────────────────────────────────────────────────

def test_each_person_gets_their_own_colour():
    """The view hands out one colour per person, and the same one wherever they appear.

    One person is one colour, or the week is unreadable; two people with the same colour
    cannot be told apart.
    """
    made = planned()
    assert made["people"] == ["Vendég", "Zed"], made["people"]
    assert len(set(made["colours"])) == len(made["people"]), (
        "two people were given the same colour: %s" % dict(zip(made["people"], made["colours"])))
    stripes = [b for what, b in boxes(made) if what == "stripes"]
    assert {b["whose"] for b in stripes} == set(made["people"]), \
        "somebody on the timetable has no stripe, so nothing here is being tested"


def test_the_numbering_is_by_name_rather_than_by_appearance():
    """So a person keeps their colour when a class is added, moved or dropped.

    In the order they first appear, somebody's Monday being cancelled would repaint the
    whole week. Sorted, nothing moves but the thing that changed. The fixture lists the last
    name in the alphabet first, so the two orders disagree.
    """
    first_to_appear = [c["whose"] for c in WEEK["classes"] if c["whose"] != "me"][0]
    assert first_to_appear == "Zed", "the fixture no longer lists Zed first"
    made = planned()
    assert made["people"] == sorted(made["people"])

    without = {"classes": [c for c in WEEK["classes"] if c["whose"] != "Vendég"
                           or c["day"] != 0]}
    again = planned(without)
    colour = dict(zip(made["people"], made["colours"]))
    assert dict(zip(again["people"], again["colours"])) == colour, (
        "dropping one of somebody's classes changed what colour anybody is")


def test_there_is_a_colour_for_every_person_the_view_can_hand_out():
    """A person with no colour of their own falls back to the first one, silently.

    Which is the bug this whole thing is about, reappearing at whatever number the palette
    runs out at. The palette is three; a fourth person takes the first again, and this
    fails if the fixture ever has more people than the palette has colours.
    """
    made = planned()
    assert len(made["people"]) <= made["palette"], (
        "%d people on the timetable and %d colours: somebody shares" %
        (len(made["people"]), made["palette"]))


# ── the lecture that is not attended ─────────────────────────────────────────

def test_the_skipped_lecture_is_a_strip_with_nothing_in_it():
    """It is there so the hour does not read as free, and no more than that. Words in it
    would say "you have this", which is the opposite of what it means."""
    made = planned()
    assert [b for _, b in boxes(made) if b["skip"]], \
        "nothing on the grid is marked as not attended"
    day = view_source("orarend", "Day.svelte")
    strip = day[day.index("{#if p.entry.skip}"):day.index("{:else}", day.index("{#if p.entry.skip}"))]
    code = re.sub(r"<!--.*?-->", "", strip, flags=re.S)
    inside = code[code.index("></button>") - 1:code.index("</button>") + 9]
    assert "></button>" in inside, (
        "the strip for a lecture that is not attended has something in it, which reads"
        " as a class you have")
    assert "nem látogatott" in strip, "the strip's label does not say it is not attended"


def test_a_class_sharing_an_hour_with_the_strip_is_moved_over():
    """Otherwise the strip is behind it and the hour looks free.

    Worked out from the geometry rather than from a list of which classes clash, which is
    how the sketch did it and how it went out of date.
    """
    made = planned()
    checked = 0
    for plan in made["days"]:
        strips = [b for b in plan["cards"] if b["skip"]]
        for box in plan["cards"]:
            if box["skip"]:
                continue
            overlaps = any(clash(box, s) for s in strips)
            checked += 1 if overlaps else 0
            assert box["inset"] == overlaps, (
                "%s: a class %s an hour with a strip is %s over"
                % (DAY_NAMES[plan["day"]], "sharing" if overlaps else "not sharing",
                   "not moved" if overlaps else "moved"))
    assert checked, "no class in the fixture shares an hour with a skipped lecture"


# ── reachable and readable ───────────────────────────────────────────────────

def test_everything_pressable_can_be_told_apart():
    """The key is how a press finds its class. Two boxes with the same one means one of
    them opens the other's details."""
    made = planned()
    keys = [k for plan in made["days"] for k in plan["order"]]
    assert len(keys) == len(set(keys)), "two boxes share a key: %s" % keys
    assert len(keys) == len(WEEK["classes"]), "something on the timetable is not on a day"


def test_the_kind_written_on_a_class_is_a_kind_the_server_knows():
    """The tag a card shows comes from one table, and every kind the server accepts either
    has a tag or is deliberately one that has none (a band is not a kind of teaching)."""
    made = planned()
    assert set(made["kindTag"]) <= set(orarend.KINDS)
    assert set(orarend.KINDS) - set(made["kindTag"]) == {"band"}, (
        "a kind the server accepts has no tag and is not the band: %s"
        % sorted(set(orarend.KINDS) - set(made["kindTag"])))
    assert made["kindTag"]["ea"] == "Ea" and made["kindTag"]["gy"] == "Gy"
    assert made["kindTag"]["both"] == "Ea+Gy"


def test_the_room_name_is_always_drawn():
    """It used to be dropped on a narrow column, and it is the part you are looking for.

    When the question is "where am I going", the room is the answer, and a phone is exactly
    where that question gets asked.
    """
    day = view_source("orarend", "Day.svelte")
    assert "{#if where(p.entry)}<span class=\"wh\">{where(p.entry)}</span>{/if}" in day
    assert "[e.where, e.teacher" in day, "the room is not what the line is made of"
    sheet = re.sub(r"/\*.*?\*/", "", day[day.index("<style>"):], flags=re.S)
    assert ".wh {" in sheet and "display: none" not in sheet[sheet.index(".wh {"):
                                                           sheet.index("}", sheet.index(".wh {"))]


def test_a_day_keeps_room_for_exactly_its_own_stripes():
    """Not for the most any day might have.

    The card reserved a flat twenty pixels down its right for them, which is a third of a
    phone's day column, and every day gave it up whether anybody else had a class that day
    or not. Only the layout knows how many lanes a day came to, so it says.
    """
    made = planned()
    seen = 0
    for plan in made["days"]:
        used = len({b["lane"] for b in plan["stripes"]})
        assert plan["lanes"] == used, (
            "%s says it uses %s lanes and draws %d. Too few and a stripe is under a card;"
            " too many and the card gives up room for nothing."
            % (DAY_NAMES[plan["day"]], plan["lanes"], used))
        seen += used
    assert seen, "no day uses any lane, so this test watched nothing"
    day = view_source("orarend", "Day.svelte")
    assert "--lanes:{plan.lanes}" in day
    assert "right: calc(var(--s1) + var(--lanes, 0) * var(--lane-step))" in day


# ── the hours that are spoken for without being a class ──────────────────────

BAND = {"day": 0, "at": "08:30", "to": "16:30", "kind": "band", "whose": "me",
        "name": "Munka", "where": ""}


def test_work_is_drawn_behind_the_day_rather_than_on_it():
    """Eight hours of Monday as a card is a card lying on top of every lecture that
    morning, and a card is opaque, so exactly one of the two can be read.

    It is not competing with the classes for the column: it is the reason the column is
    not free. So it is a band the width of the day, underneath them.
    """
    made = planned({"classes": WEEK["classes"] + [BAND]})
    bands = [b for what, b in boxes(made) if what == "bands"]
    assert [b["name"] for b in bands] == ["Munka"], (
        "the long stretch of the day was not drawn as a band: %s" % bands)
    assert not [b for what, b in boxes(made) if what == "cards" and b["name"] == "Munka"], \
        "the band is also a card, so it is drawn over what it overlaps"
    monday = [b for what, b in boxes(made, 0) if what != "bands"]
    assert [b for b in monday if clash(b, bands[0])], \
        "nothing on Monday runs during the band, so this watched nothing"

    day = view_source("orarend", "Day.svelte")
    css = re.sub(r"/\*.*?\*/", "", day[day.index("<style>"):], flags=re.S)
    layer = lambda selector: int(re.search(r"%s\s*\{[^}]*?z-index:\s*(-?\d+)" % re.escape(selector), css).group(1))
    assert layer(".band") < layer(".card"), (
        "the classes are not above the band, so a morning at work hides the lecture in it")


def test_everything_drawn_on_a_day_is_placed_by_the_hours_it_says():
    """The view writes --at and --for on every box it draws, and one rule turns those into
    a top and a height. A box whose class is not in that rule is drawn nought pixels tall.

    Which is exactly what happened to the band once: it was in the markup with the right
    hours on it, and it was invisible, because the rule named cards and stripes and nothing
    else.
    """
    day = view_source("orarend", "Day.svelte")
    css = re.sub(r"/\*.*?\*/", "", day[day.index("<style>"):], flags=re.S)
    top = re.search(r"([^{}]+)\{\s*top:\s*calc\(var\(--at", css)
    height = re.search(r"([^{}]+)\{\s*height:\s*calc\(var\(--for", css)
    assert top and height, "nothing turns the hours a box says into a place on the grid"
    placed = {part.strip() for part in top.group(1).split(",")} & \
             {part.strip() for part in height.group(1).split(",")}
    markup = day[:day.index("<style>")]
    drawn = set(re.findall(r'<button class="(band|card|stripe)', markup))
    assert drawn == {"band", "card", "stripe"}, drawn
    for what in drawn:
        assert "." + what in placed, (
            "the view draws a %s and the stylesheet does not give it a top and a height, so"
            " it is on the grid and nought pixels tall. Placed: %s" % (what, sorted(placed)))
    assert "style={style(p)}" in markup


def test_a_band_is_not_one_of_the_kinds_of_class():
    """It has no tag and it is not one of the kinds beside Ea and Gy, because it is not one.

    The tag says which kind of teaching an hour is. A shift at work is not a kind of
    teaching, and a card that wore "Munka" as though it were would be the sketch's old
    mistake in a new place: a category invented by the drawing rather than by the thing.
    """
    made = planned({"classes": WEEK["classes"] + [dict(BAND, day=4)]})
    assert "band" not in made["kindTag"]
    day = view_source("orarend", "Day.svelte")
    band = day[day.index("{#each plan.bands"):day.index("{/each}", day.index("{#each plan.bands"))]
    assert "KIND_TAG" not in band and 'class="tag"' not in band
    assert "onclick={() => onopen(p.entry)}" in band, \
        "the band cannot be opened, so it cannot say what it is"


# ── whose week ───────────────────────────────────────────────────────────────

def test_the_week_can_be_somebody_else_s():
    """Two questions, two shapes.

    The whole week answers "when are we both free": my classes as cards, everybody else's
    as a stripe down the side. It cannot answer "when is my friend free on Wednesday",
    because her hours there are a five pixel stripe with nothing written on them.

    So picking a person draws their week the way mine is drawn. Cards, with the room and
    the teacher on them, and nobody else's classes in the way.
    """
    made = planned(who="Vendég")
    cards = [b for what, b in boxes(made) if what == "cards" and not b["skip"]]
    assert cards, "picking somebody drew no classes at all"
    for box in cards:
        assert box["whose"] == "Vendég", (
            "somebody else's class is drawn as a card on this person's week: %r" % box["name"])
    assert not [b for what, b in boxes(made) if what == "stripes"], (
        "one person's week still has stripes on it. There is nobody to tell apart from"
        " anybody, so a stripe is a lane of nothing down every day.")
    assert all(plan["lanes"] == 0 for plan in made["days"])


def test_my_own_week_is_the_one_with_everybody_on_it():
    """The default, and the reason the page exists. Picking nobody is not picking me."""
    whole = planned()
    assert [b for what, b in boxes(whole) if what == "stripes"], (
        "the default week has nobody else on it, so the one question it was built to"
        " answer cannot be asked")
    mine = planned(who="me")
    assert not [b for what, b in boxes(mine) if what == "stripes"], (
        "picking my own week still draws everybody else's stripes")
    assert {b["whose"] for what, b in boxes(whole) if what == "cards"} == {"me"}


def test_everybody_on_the_week_can_be_picked():
    """Including me, and including all of us. A person with classes on this timetable and
    no way to ask for their week is a person you can see and cannot read."""
    made = planned()
    source = view_source("Orarend.svelte")
    assert '...["all", "me", ...people]' in source, \
        "the switch does not offer all, me and everybody else on the week"
    assert "const people = $derived(peopleOf(classes));" in source
    assert set(made["people"]) == {c["whose"] for c in WEEK["classes"] if c["whose"] != "me"}


# ── making and changing one ──────────────────────────────────────────────────

def test_a_class_is_found_by_its_name_and_not_by_where_it_sits():
    """The bug this whole key exists to stop.

    The server calls a class by an id, and that was once read as a position in the array:
    a card carrying a very large number asked for that entry and got nothing back, so every
    card stopped opening in a way nothing threw an error about. Boxes carry the server's
    key, and are drawn and looked up by it.
    """
    made = planned({"classes": [dict(WEEK["classes"][1], id=1790000000001),
                                dict(WEEK["classes"][2])]})
    keys = [k for plan in made["days"] for k in plan["order"]]
    assert "1790000000001" in keys, "a class with an id is drawn under some other name"
    assert any(k.startswith("i:") for k in keys), \
        "a class with no id is not drawn under a name of its own"
    day = view_source("orarend", "Day.svelte")
    assert "(p.entry.key)" in day and "data-key={p.entry.key}" in day


def test_there_is_a_way_to_add_a_class_on_the_screen_and_on_the_empty_one():
    """Including, and especially, the screen for somebody who has no week at all.

    That screen used to say: put your classes in orarend.json and reload. Which is fine at
    a desk and useless on a bus, and the bus is where a timetable is actually read.
    """
    source = view_source("Orarend.svelte")
    assert "{#if week && !readonly}" in source and "Új óra" in source, "the week cannot be added to"
    # The empty screen is inside the same page, with the button above it, and says where
    # the file is, because it is still a file.
    assert "week.where || \"orarend.json\"" in source


def test_a_class_can_be_changed_and_dropped_from_the_one_it_opens():
    """Both on the sheet that opens when a class is tapped, which is where somebody
    already is when they notice the room has changed."""
    source = view_source("Orarend.svelte")
    assert 'then === "edit"' in source and 'then === "delete"' in source
    detail = view_source("orarend", "Detail.svelte")
    assert 'close("edit")' in detail and 'close("delete")' in detail, (
        "the sheet a class opens has no button to change it or to drop it")


def test_the_form_offers_every_kind_the_server_will_accept():
    """A form that offers four of five kinds is a fifth kind you can only get by editing
    the file, which is the thing this page is for not having to do."""
    made = planned()
    assert set(made["kindSaid"]) == set(orarend.KINDS), (
        "the page offers %s and the server accepts %s"
        % (sorted(made["kindSaid"]), sorted(orarend.KINDS)))
    form = view_source("orarend", "ClassForm.svelte")
    assert "Object.keys(KIND_SAID).map(" in form, "the form does not offer them all"


def test_what_a_class_says_is_what_the_server_keeps():
    """Every field on the form is one the module will write, and the other way round.

    A form field the server drops is typing that disappears on save with nothing said
    about it, which is the worst of the two directions.
    """
    made = planned()
    assert made["fields"] == list(orarend.FIELDS), (
        "the page sends %s and the server keeps %s" % (made["fields"], list(orarend.FIELDS)))
    form = view_source("orarend", "ClassForm.svelte")
    asked = set(re.findall(r"bind:value=\{v\.(\w+)\}", form)) | \
        set(re.findall(r"bind:checked=\{v\.(\w+)\}", form))
    assert asked <= set(orarend.FIELDS), (
        "the form asks for %s, which the server does not keep"
        % sorted(asked - set(orarend.FIELDS)))
    # day, at and to are the ones without which a class cannot be drawn at all.
    for must in ("name", "day", "at", "to", "kind", "whose", "where"):
        assert must in asked, "the form has no way to say %s" % must


def test_the_timetable_is_not_in_the_sidebar():
    """It is reached from Foyer, which is the room that holds everything on this machine.

    A nav item for somebody's university week, in a music library, between the inbox and
    Settings, was the shortest way to it while it was being built. The sidebar is for the
    library.
    """
    sidebar = io.open(os.path.join(ROOT, "ui", "src", "shell", "Sidebar.svelte"),
                      encoding="utf-8").read()
    assert "orarend" not in sidebar.lower() and "órarend" not in sidebar.lower(), (
        "the sidebar still has an Órarend item. It is reached from Foyer now.")
    # The screen itself is still there and still reachable by its route.
    assert os.path.isfile(os.path.join(ROOT, "ui", "src", "views", "Orarend.svelte")), \
        "the view is gone, so removing it from the sidebar removed the whole screen"


def test_the_rail_gets_out_of_the_way_of_the_week():
    """Five days wide, and a column of album links beside it is width the week does not
    get. The screen asks for the whole width and the shell tucks the rail for it."""
    shell = io.open(os.path.join(ROOT, "ui", "src", "shell", "Shell.svelte"),
                    encoding="utf-8").read()
    roomy = re.search(r"const ROOMY: View\[\] = \[([^\]]*)\]", shell)
    assert roomy and '"orarend"' in roomy.group(1), (
        "no screen asks for the whole width, so the timetable is drawn beside the rail")


def test_the_page_is_left_zoomable_by_the_browser():
    """The week had a zoom of its own: pinch, drag, double tap, a scale on top of the fit.
    It worked, and it was the wrong thing to have built. A phone already knows how to zoom a
    page, and a second zoom inside the first is two sets of rules for one gesture.

    So nothing here may take a pinch away from the browser: a maximum-scale or
    user-scalable=no in the viewport turns the zoom off for the whole document.
    """
    page = io.open(os.path.join(ROOT, "ui", "index.html"), encoding="utf-8").read() \
        if os.path.isfile(os.path.join(ROOT, "ui", "index.html")) else \
        io.open(os.path.join(ROOT, "web", "index.html"), encoding="utf-8").read()
    viewport = re.search(r'name="viewport" content="([^"]*)"', page)
    assert viewport, "the page does not say how it wants to be laid out"
    for banned in ("user-scalable=no", "user-scalable=0", "maximum-scale"):
        assert banned not in viewport.group(1).replace(" ", ""), (
            "the viewport says %s, which turns the browser's zoom off: %s"
            % (banned, viewport.group(1)))


# ── the two nothings ─────────────────────────────────────────────────────────

def test_a_week_that_is_not_there_says_how_to_make_one():
    """Most accounts have never written one, so this is the ordinary case, not an error."""
    source = view_source("Orarend.svelte")
    assert "week.broken ? \"Ez az órarend nem olvasható\" : \"Nincs még órarend\"" in source
    assert "<code>{week.where || \"orarend.json\"}</code>" in source, \
        "the empty screen does not say which file to write"
    assert "const empty = $derived(!!week && (week.missing || !!week.broken || !classes.length));" \
        in source
    assert "{:else if empty && week}" in source, "an empty week still draws a grid"


def test_a_week_that_will_not_parse_says_so_differently():
    """A file that is there and broken is somebody mid-edit, and the answer is which
    character stopped it. Telling it apart from a missing file costs a line and saves the
    second person looking for a file that is right in front of them."""
    source = view_source("Orarend.svelte")
    assert "{#if week.broken}A fájl ott van, de nem értelmezhető: {week.broken}" in source, \
        "the broken screen does not say what is wrong with the file"
    assert "nem olvasható" in source


# ── the module behind it ─────────────────────────────────────────────────────

def test_the_week_is_read_from_the_account_and_not_from_one_place(tmp_path,
                                                                  monkeypatch):
    """Per account, like the databases, so a second person gets their own empty week.

    home() resolves through who.must(), which raises rather than picking a library. A
    timetable kept in one place for the whole server would be one person's hours shown to
    everybody who signed in.
    """
    seen = {}

    def home(account=None):
        seen["asked"] = True
        return str(tmp_path)

    monkeypatch.setattr(orarend.config, "home", home)
    assert orarend.read() is None, "a directory with no file in it is not an empty week"
    assert seen.get("asked"), (
        "the module did not ask config.home where to look, so it is reading from somewhere"
        " that is not the account's own directory")

    io.open(os.path.join(str(tmp_path), "orarend.json"), "w", encoding="utf-8").write(
        json.dumps(WEEK, ensure_ascii=False))
    assert len(orarend.read()["classes"]) == len(WEEK["classes"])


def test_a_bare_list_is_a_week_too(tmp_path, monkeypatch):
    """The shape that is easiest to write by hand, which is the point of a file."""
    monkeypatch.setattr(orarend.config, "home", lambda account=None: str(tmp_path))
    io.open(os.path.join(str(tmp_path), "orarend.json"), "w", encoding="utf-8").write(
        json.dumps(WEEK["classes"], ensure_ascii=False))
    assert len(orarend.read()["classes"]) == len(WEEK["classes"])


def test_a_broken_file_is_told_apart_from_a_missing_one(tmp_path, monkeypatch):
    monkeypatch.setattr(orarend.config, "home", lambda account=None: str(tmp_path))
    io.open(os.path.join(str(tmp_path), "orarend.json"), "w", encoding="utf-8").write(
        '{"classes": [ ')
    found = orarend.read()
    assert found and found.get("broken"), \
        "a half written file reads as no file at all, so the screen says to write one"


def test_the_week_never_leaves_this_repository(tmp_path, monkeypatch):
    """The reason the data is a file and not a constant.

    This repository is public. The real week names a second person, her rooms and her
    hours. Nothing in the tree may contain it, and the fixture above is made up precisely
    so that this test can be true.
    """
    monkeypatch.setattr(orarend.config, "home", lambda account=None: str(tmp_path))
    assert orarend.path().startswith(str(tmp_path)), \
        "the week is kept somewhere other than the account's directory: %s" % orarend.path()

    ignore = io.open(os.path.join(ROOT, ".gitignore"), encoding="utf-8").read()
    assert re.search(r"^data/\s*$", ignore, flags=re.M), (
        "data/ is not ignored, so the first person to run this and commit would put their"
        " own week, and somebody else's hours, into a public repository")

    out = subprocess.run(["git", "ls-files"], capture_output=True, cwd=ROOT)
    tracked = out.stdout.decode("utf-8", "replace").split("\n")
    assert not [f for f in tracked if f.endswith("orarend.json")], (
        "a week is committed to this repository: %s"
        % [f for f in tracked if f.endswith("orarend.json")])
