"""The week, checked by looking at the grid it drew.

Every test that is about the layout runs the real view under node, through
tests/orarend_render.js, and reads the markup it produced. Nothing asserts on the source
text, because the source text is not what was wrong with the sketch this replaced: that one
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
import html.parser

import pytest

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, ROOT)

RENDER = os.path.join(HERE, "orarend_render.js")
VIEW = os.path.join(ROOT, "web", "js", "56-view-orarend.js")

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


def drawn(week=None, who=None):
    """Run the real view over a week and return what it made.

    `who` is whose week to draw: the page keeps that choice in localStorage and the
    harness hands it over, so a test can ask for the screen it is about rather than only
    ever seeing the default one.
    """
    node = shutil.which("node")
    if not node:
        pytest.fail(
            "node is not on PATH, so the timetable's arithmetic is not being checked at"
            " all. These tests run the real view rather than reading it, which is the only"
            " way to know where a stripe landed.")
    import tempfile
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False,
                                     encoding="utf-8") as f:
        json.dump(week if week is not None else WEEK, f, ensure_ascii=False)
        path = f.name
    try:
        env = dict(os.environ)
        if who:
            env["ORAREND_WHO"] = who
        out = subprocess.run([node, RENDER, path], capture_output=True, cwd=ROOT, env=env)
        assert out.returncode == 0, out.stderr.decode("utf-8", "replace")
        return json.loads(out.stdout.decode("utf-8"))
    finally:
        os.remove(path)


class Grid(html.parser.HTMLParser):
    """The drawn grid as data: the hour labels, and the boxes in each day.

    A real parser rather than a regex, because "which day is this stripe in" is a question
    about nesting and a regex cannot see nesting.
    """

    def __init__(self):
        html.parser.HTMLParser.__init__(self)
        self.hours = []
        self.days = []
        self.lanes = {}
        self.legend = []
        self.scrolls = 0
        self.frames = 0
        self._day = None
        self._box = None
        self._hour = False
        self._tag = False

    def handle_starttag(self, tag, attrs):
        at = dict(attrs)
        classes = at.get("class", "").split()
        if "tt-scroll" in classes:
            self.scrolls += 1
        if "tt-fit" in classes:
            self.frames += 1
        if "tt-day" in classes:
            self._day = (at.get("aria-label", ""), [])
            self.days.append(self._day)
            # How many stripe lanes the view says this day came to. The cards reserve room
            # down their right from it.
            found = re.search(r"--tt-lanes:\s*(\d+)", at.get("style", ""))
            self.lanes[at.get("aria-label", "")] = found.group(1) if found else None
        if "tt-hour" in classes:
            self._hour = True
        if "tt-tag" in classes:
            # Kept apart from the card's words. Most class names have Ea or Gy in them, so
            # "is Ea in the text" is answered by the title and says nothing about the tag.
            self._tag = True
        if "tt-legend" in classes:
            self.legend.append("")
        if tag == "button":
            style = at.get("style", "")
            self._box = {
                "classes": classes,
                "at": at.get("data-at"),
                "who": at.get("data-who"),
                "label": at.get("aria-label", ""),
                "text": "",
                "tag": "",
                # Hours, turned into the design's pixels. The view says when a class is and
                # how long it runs and the stylesheet multiplies both by --tt-hour, so a box
                # carries --at: 2 rather than top: 120px. Read here in the server's own hour
                # height so every question below is still asked in pixels: an hour is an
                # hour whatever the grid is currently scaled to.
                "top": hours(style, "--at", HOUR),
                "height": hours(style, "--for", HOUR),
                "lane": px(style, "--lane"),
                "inset": "left:" in style,
                "skip": "tt-skip" in classes,
                "stripe": "tt-stripe" in classes,
            }
            if self._day is not None:
                self._day[1].append(self._box)

    def handle_endtag(self, tag):
        if tag == "button":
            self._box = None
        if tag == "i":
            self._tag = False

    def handle_data(self, data):
        if self._hour:
            self.hours.append(data.strip())
            self._hour = False
        elif self._box is not None:
            self._box["text"] += data
            if self._tag:
                self._box["tag"] += data
        elif self.legend and self._day is None:
            self.legend[-1] += data


def px(style, name):
    found = re.search(r"(?:^|;)\s*%s:\s*([-\d.]+)" % re.escape(name), style)
    return float(found.group(1)) if found else None


def hours(style, name, tall):
    found = px(style, name)
    return None if found is None else found * tall


def grid(week=None, who=None):
    made = drawn(week, who)
    parser = Grid()
    parser.feed(made["html"])
    return parser, made


def clash(a, b):
    return a["top"] < b["top"] + b["height"] and b["top"] < a["top"] + a["height"]


# ── the window ───────────────────────────────────────────────────────────────

def test_the_hour_labels_stop_one_short_of_the_end():
    """"21:00" is the row from 21:00 to 22:00, so a label for 22:00 is an hour of grid
    after the day has ended, and an empty band under the last class.

    The loop is `h < TO`, and `h <= TO` looks just as reasonable in the source. This is the
    difference between the two, asked of the grid rather than of the comparison.
    """
    got, _ = grid()
    assert got.hours == ["%02d:00" % h for h in range(FROM, TO)], (
        "the grid's hours are %s, and the window the server sends is %02d:00 to %02d:00"
        % (", ".join(got.hours), FROM, TO))


def test_nothing_is_drawn_outside_the_grid():
    """A class at 07:00 draws above the top of the grid and cannot be clicked.

    This is the failure the design prevents and the one it cannot prevent on its own:
    positions are worked out from times, correctly, and a time outside the window is worked
    out into a position outside the grid. Adding an early class is a normal thing to do, so
    the grid has to say so.
    """
    got, _ = grid()
    floor = (TO - FROM) * HOUR
    for name, boxes in got.days:
        for box in boxes:
            assert box["top"] is not None and box["height"] is not None, \
                "%s: a box was drawn with no position: %r" % (name, box["classes"])
            assert box["top"] >= 0, (
                "%s: something is drawn %.0fpx above the top of the grid, so it is off the"
                " page. A class before %02d:00 needs the window moved."
                % (name, -box["top"], FROM))
            assert box["top"] + box["height"] <= floor, (
                "%s: something reaches %.0fpx past the bottom of the %d hour grid."
                % (name, box["top"] + box["height"] - floor, TO - FROM))


def test_an_early_class_is_caught_rather_than_drawn_off_the_page():
    """The test above, shown to fail on the thing it is for.

    Without this, "nothing is outside the grid" passes on any week that happens not to have
    an early class, which is every week until the one that does.
    """
    early = {"classes": WEEK["classes"] + [
        {"day": 4, "at": "07:00", "to": "09:00", "kind": "ea", "whose": "me",
         "name": "Hajnali", "where": "Sehol"}]}
    got, _ = grid(early)
    outside = [b for name, boxes in got.days for b in boxes if b["top"] < 0]
    assert outside, (
        "a class an hour before the window starts was drawn at %s, which is inside the"
        " grid. Then the check above can never fire."
        % [b["top"] for name, boxes in got.days for b in boxes])


def test_every_box_has_a_height_to_it():
    """A zero or negative height is a class whose end is before its start. It renders as an
    invisible sliver rather than an error, and the class is simply not on the timetable."""
    got, _ = grid()
    for name, boxes in got.days:
        for box in boxes:
            assert box["height"] > 0, (
                "%s: a box is %.0fpx tall, so its finish is not after its start. It is on"
                " the page and cannot be seen or clicked." % (name, box["height"]))


def test_a_class_ending_on_a_half_hour_is_half_a_row_tall():
    """The arithmetic, at the one place rounding would show.

    17:45 to 19:15 is an hour and a half, so 1.5 rows, and 9.75 hours after 08:00. A view
    that rounded to whole rows would put it on the hour and it would still look plausible.
    """
    got, _ = grid()
    boxes = [b for name, boxes in got.days for b in boxes if b["height"] == 1.5 * HOUR]
    assert boxes, "nothing in the fixture is an hour and a half tall any more"
    assert boxes[0]["top"] == 9.75 * HOUR, (
        "a class at 17:45 is drawn %.1f rows down rather than %.2f"
        % (boxes[0]["top"] / HOUR, 9.75))


# ── the clash, which the sketch handled by hand ──────────────────────────────

def test_two_classes_at_once_never_share_a_lane():
    """The sketch put a hand written class on the two overlaps it knew about, which is
    fine until a third appears and sits underneath the second with nothing to say so."""
    got, _ = grid()
    for name, boxes in got.days:
        stripes = [b for b in boxes if b["stripe"]]
        for i, a in enumerate(stripes):
            for b in stripes[i + 1:]:
                if not clash(a, b):
                    continue
                assert a["lane"] != b["lane"], (
                    "%s: two stripes overlap in time and are both in lane %s, so one is"
                    " underneath the other: %s and %s"
                    % (name, a["lane"], a["label"], b["label"]))


def test_the_lanes_are_packed_from_the_left():
    """First free lane, not next lane.

    Counting up per stripe also gives every clash its own lane, and leaves a stripe's width
    of nothing wherever an earlier clash had ended.
    """
    got, _ = grid()
    for name, boxes in got.days:
        stripes = [b for b in boxes if b["stripe"]]
        for box in stripes:
            beside = [o["lane"] for o in stripes if o is not box and clash(box, o)]
            for lane in range(int(box["lane"])):
                assert lane in beside, (
                    "%s: a stripe sits in lane %s while lane %d is free at that hour: %s"
                    % (name, box["lane"], lane, box["label"]))


def test_three_at_once_get_three_lanes():
    """The case the fixture exists for, and the one a pair of hand written classes missed."""
    got, _ = grid()
    tuesday = [b for name, boxes in got.days for b in boxes
               if b["stripe"] and name == "Kedd"]
    clashing = [b for b in tuesday if b["top"] < 4 * HOUR]
    assert len(clashing) == 3, "the fixture's three clashing classes are not all drawn"
    assert sorted(int(b["lane"]) for b in clashing) == [0, 1, 2], (
        "three classes at the same hour landed in lanes %s"
        % sorted(int(b["lane"]) for b in clashing))


# ── whose stripe is that ─────────────────────────────────────────────────────

def test_each_person_gets_their_own_number():
    """The view hands out a number per person; the stylesheet decides what it looks like.

    A colour written by a script is a colour the stylesheet cannot see, and every other hue
    on this page is in the stylesheet. So the script says which person, and nothing else.
    """
    got, _ = grid()
    stripes = [b for _, boxes in got.days for b in boxes if b["stripe"]]
    assert stripes, "there are no stripes at all, so this says nothing"

    by_person = {}
    for _, boxes in got.days:
        for box in boxes:
            if not box["stripe"]:
                continue
            # The label starts with the name, which is how a screen reader hears it.
            who = box["label"].split(":")[0]
            by_person.setdefault(who, set()).add(box["who"])

    assert len(by_person) >= 2, (
        "only one person is on this timetable, so nothing here is being tested: %s"
        % sorted(by_person))
    for name, numbers in by_person.items():
        assert numbers and len(numbers) == 1, (
            "%s's stripes carry %s. One person is one colour, or the week is unreadable."
            % (name, sorted(numbers)))
    handed = [next(iter(v)) for v in by_person.values()]
    assert len(set(handed)) == len(handed), (
        "two people were given the same number, so their stripes are the same colour: %s"
        % {k: next(iter(v)) for k, v in by_person.items()})


def test_the_numbering_is_by_name_rather_than_by_appearance():
    """So a person keeps their colour when a class is added, moved or dropped.

    In the order they first appear, somebody's Monday being cancelled would repaint the
    whole week. Sorted, nothing moves but the thing that changed.
    """
    got, _ = grid()
    seen = {}
    for _, boxes in got.days:
        for box in boxes:
            if box["stripe"]:
                seen.setdefault(box["label"].split(":")[0], box["who"])
    in_order = [name for name, _ in sorted(seen.items(), key=lambda kv: int(kv[1]))]
    assert in_order == sorted(seen), (
        "the numbers do not follow the names in order: %s" % seen)


def test_there_is_a_colour_for_every_number_the_view_can_hand_out():
    """A person with no colour of their own falls back to the first one, silently.

    Which is the bug this whole thing is about, reappearing at whatever number the palette
    runs out at. If a fourth person is ever added, this fails rather than quietly drawing
    them as the first.
    """
    sheet = io.open(os.path.join(ROOT, "web", "css", "44-orarend.css"),
                    encoding="utf-8").read()
    covered = set(re.findall(r'\[data-who="(\d+)"\]', sheet))

    got, _ = grid()
    handed = {b["who"] for _, boxes in got.days for b in boxes if b["stripe"]}
    assert handed, "no stripe carries a number, so there is nothing to colour"

    # Nought is the one the base rule already draws; every other number needs its own.
    #
    # Counted per number rather than as a total on purpose. A total lets a gap hide: drop
    # the rule for 1 while 2 is still there and the count is unchanged, so the first
    # version of this passed with the second person drawn as the first.
    for number in sorted(handed - {"0"}):
        assert number in covered, (
            "somebody is drawn as data-who=%s and the stylesheet has no rule for it, so"
            " they fall back to the first person's colour. Rules present: %s"
            % (number, sorted(covered) or "none"))


# ── the lecture that is not attended ─────────────────────────────────────────

def test_the_skipped_lecture_is_a_strip_with_nothing_in_it():
    """It is there so the hour does not read as free, and no more than that. Words in it
    would say "you have this", which is the opposite of what it means."""
    got, _ = grid()
    skips = [b for name, boxes in got.days for b in boxes if b["skip"]]
    assert skips, "nothing on the grid is marked as not attended"
    for box in skips:
        assert not box["text"].strip(), (
            "the strip for a lecture that is not attended has text in it (%r), which reads"
            " as a class you have" % box["text"].strip())
        assert "nem l" in box["label"], \
            "the strip's label does not say it is not attended: %r" % box["label"]


def test_a_class_sharing_an_hour_with_the_strip_is_moved_over():
    """Otherwise the strip is behind it and the hour looks free.

    Worked out from the geometry of the drawn grid rather than from a list of which classes
    clash, which is how the sketch did it and how it went out of date.
    """
    got, _ = grid()
    checked = 0
    for name, boxes in got.days:
        strips = [b for b in boxes if b["skip"]]
        for box in boxes:
            if box["skip"] or box["stripe"]:
                continue
            overlaps = any(clash(box, s) for s in strips)
            checked += 1 if overlaps else 0
            assert box["inset"] == overlaps, (
                "%s: a class %s an hour with a strip is %s over"
                % (name, "sharing" if overlaps else "not sharing",
                   "not moved" if overlaps else "moved"))
    assert checked, "no class in the fixture shares an hour with a skipped lecture"


# ── reachable and readable ───────────────────────────────────────────────────

def test_everything_clickable_can_be_told_apart_and_named():
    """data-at is how a click finds its class, and it is an index into the array. Two boxes
    with the same one means one of them opens the other's details."""
    got, _ = grid()
    seen = {}
    for name, boxes in got.days:
        for box in boxes:
            key = box["at"]
            assert key is not None, \
                "%s: a button has no data-at, so clicking it does nothing" % name
            assert key not in seen, \
                "two buttons share data-at=%s (%s and %s)" % (key, seen[key], name)
            seen[key] = name
            assert box["text"].strip() or box["label"].strip(), \
                "%s: a button with no text and no label" % name


def test_the_kind_written_on_a_class_matches_the_kind_it_is_styled_as():
    """The sketch's own legend said slate meant lecture, and it drew one lecture in a
    lighter blue and several practicals in slate. Classified here by the Ea and Gy in the
    titles, so the tag a card shows and the class it carries are the same answer."""
    got, _ = grid()
    said = {"tt-ea": "Ea", "tt-gy": "Gy", "tt-both": "Ea+Gy"}
    checked = 0
    for name, boxes in got.days:
        for box in boxes:
            kinds = [c for c in box["classes"] if c in said]
            if not kinds:
                continue
            assert len(kinds) == 1, \
                "%s: a card is styled as two kinds at once: %s" % (name, kinds)
            checked += 1
            assert box["tag"].strip() == said[kinds[0]], (
                "%s: a card styled %s shows the tag %r, and %s means %r"
                % (name, kinds[0], box["tag"].strip(), kinds[0], said[kinds[0]]))
    assert checked, "no card on the grid carries a kind at all"


def test_nothing_scrolls_sideways_to_reach_the_week():
    """The whole week is on the screen, not somewhere to the right of it.

    It scrolled once, and a timetable you have to drag is one you cannot answer "when are
    we both free" from. It is drawn at its full width and then made smaller, the way a
    phone browser used to handle a page that never asked to be laid out for a phone, so
    there is nothing left over to scroll to.
    """
    got, _ = grid()
    assert got.frames == 1, (
        "the grid is in %d frames. One holds it, clips nothing off the week, and is the"
        " thing the view measures to decide how far down to scale." % got.frames)
    assert got.scrolls == 0, \
        "the week is back inside a scroll container, so part of it is off the screen"

    sheet = io.open(os.path.join(ROOT, "web", "css", "44-orarend.css"),
                    encoding="utf-8").read()
    rule = re.search(r"\.tt-fit\s*\{([^}]*)\}", sheet)
    assert rule, "the frame has no rule of its own"
    assert re.search(r"overflow:\s*hidden", rule.group(1)), (
        "the frame does not clip, so the room the grid leaves under itself once it is"
        " scaled becomes empty page rather than nothing at all")
    assert "overflow-x: auto" not in sheet and "overflow-x: scroll" not in sheet, \
        "something on this page still scrolls sideways"


def test_there_is_no_second_layout_for_a_phone():
    """A narrow screen gets the same table, moved, not a rearranged one.

    There was a phone layout: narrower columns, smaller type, and the room names taken
    away. It fitted more of the week on the screen and made every cell a squashed version
    of itself. A timetable on a phone is read one day at a time anyway, so narrow columns
    bought nothing and cost the room name, which is the part you are looking for when you
    are already on your way somewhere.

    So: nothing in a media query may touch the grid's columns, the type, or whether the
    room name is drawn.
    """
    sheet = io.open(os.path.join(ROOT, "web", "css", "44-orarend.css"),
                    encoding="utf-8").read()
    sheet = re.sub(r"/\*.*?\*/", "", sheet, flags=re.S)

    for found in re.finditer(r"@media([^{]*)\{", sheet):
        start = found.end()
        depth, i = 1, start
        while i < len(sheet) and depth:
            if sheet[i] == "{":
                depth += 1
            elif sheet[i] == "}":
                depth -= 1
            i += 1
        body = sheet[start:i]
        condition = found.group(1).strip()
        # Reduced motion is about movement, not about shape, and is allowed to say so.
        if "prefers-reduced-motion" in condition:
            continue
        for banned in ("grid-template-columns", "font-size", ".tt-where"):
            assert banned not in body, (
                "@media %s changes %s, which is a second layout for a narrow screen. The"
                " table is meant to keep its shape and scroll." % (condition, banned))


def test_the_week_is_laid_out_wide_and_then_made_smaller():
    """The one decision this layout rests on, and the third answer to the same question.

    First it kept a fixed day column and scrolled, and Friday was two screens to the right.
    Then the columns were free to shrink and the type shrank with them, and a cell became a
    narrow paragraph: the same table, squashed to a different shape.

    So neither. The grid is laid out at the width it would have on a desktop, and the whole
    thing is then scaled down as one piece. A phone gets the desktop picture, smaller,
    which is the same thing as leaving width=device-width out of the page: every proportion
    is kept and the only thing that changes is how big it all is.
    """
    sheet = io.open(os.path.join(ROOT, "web", "css", "44-orarend.css"),
                    encoding="utf-8").read()
    rule = re.search(r"\.tt-grid\s*\{([^}]*)\}", sheet)
    assert rule, "the grid rule is gone"
    body = re.sub(r"/\*.*?\*/", "", rule.group(1), flags=re.S)

    width = re.search(r"(?:^|;)\s*width:([^;]+);", body)
    assert width and "max(100%" in width.group(1), (
        "the grid takes its width from the room it is in (%s), so on a phone it is laid out"
        " narrow and squashed rather than laid out wide and scaled."
        % (width.group(1).strip() if width else "nothing"))

    scaled = re.search(r"transform:[^;]*scale\([^;]*var\(--tt-fit", body)
    assert scaled, "the grid is never scaled, so on a phone it simply hangs off the edge"
    assert re.search(r"transform-origin:\s*top left", body), (
        "the grid scales about its middle, which moves the week up and to the left of the"
        " frame that is meant to hold it")

    columns = re.search(r"grid-template-columns:([^;]+);", body)
    assert columns, "the grid has no columns"
    assert "1fr" in columns.group(1), (
        "the day columns are %s, so on a wide screen the week stays at its design width and"
        " leaves dead space to the right of Friday." % columns.group(1).strip())


def test_an_hour_is_a_sixth_of_a_day_and_stays_one():
    """So the week is always the same shape, and never answers a narrow screen by growing.

    A fixed hour height with a column that can be any width is a table that gets taller as
    it gets narrower, and a tall week is scaled down further to fit, which makes the type
    smaller than it had to be. Tying the row to the column keeps the picture proportional:
    the same rectangle at every size, and the only thing that changes is the scale.
    """
    view = io.open(VIEW, encoding="utf-8").read()
    ratio = re.search(r"const HOUR_OF_DAY = ([^;]+);", view)
    assert ratio, "the view no longer says what an hour is worth"
    top, bottom = ratio.group(1).split("/")
    assert abs(float(top) / float(bottom) - 1.0 / 6) < 1e-9, (
        "an hour is %s of a day column. It is a sixth: it was a quarter, and before that"
        " sixty pixels against a hundred and sixty, and each time the week was the tall"
        " thing on the screen and had to be shrunk further to fit."
        % ratio.group(1).strip())

    assert re.search(r"day\.offsetWidth \* HOUR_OF_DAY", view), (
        "the hour height is not worked out from the drawn column, so it is a guess about a"
        " width rather than a measurement of one")

    sheet = io.open(os.path.join(ROOT, "web", "css", "44-orarend.css"),
                    encoding="utf-8").read()
    assert "--tt-hour" not in re.sub(r"/\*.*?\*/", "", sheet, flags=re.S).split("{")[0], \
        "the stylesheet defines its own hour height, so there are two answers to the scale"


def test_the_grid_is_never_scaled_up():
    """Down to fit, never up to fill.

    have / wide alone is a number above one on any screen wider than the design, and the
    week would grow to fill a desktop: twenty pixel type and a room name the size of a
    heading. The desktop picture is the picture, and it is already the right size there.
    """
    view = io.open(VIEW, encoding="utf-8").read()
    assert re.search(r"Math\.min\(1,\s*[\w.]*have / [\w.]*wide\)", view), (
        "the fit is not held at one, so a wide screen blows the week up rather than leaving"
        " it alone")


def test_nothing_about_the_week_is_measured_against_the_screen():
    """Because the scaling has already done all of it.

    Type in cqw, a column in vw, a room name dropped by a container query: each of those is
    a second opinion about how big things should be, applied on top of the scale, and two
    of them fighting is how the table got squashed the first time. One rule decides the
    size of the whole picture and nothing underneath it is allowed to have its own.
    """
    sheet = io.open(os.path.join(ROOT, "web", "css", "44-orarend.css"),
                    encoding="utf-8").read()
    sheet = re.sub(r"/\*.*?\*/", "", sheet, flags=re.S)
    for banned in ("cqw", "cqi", "vw", "@container", "container-type", "clamp("):
        assert banned not in sheet, (
            "the stylesheet still sizes something by %s. The grid is scaled as one piece"
            " now, so anything that measures the screen again fights it." % banned)


def test_the_room_name_is_always_drawn():
    """It used to be dropped on a narrow column, and it is the part you are looking for.

    When the question is "where am I going", the room is the answer, and a phone is exactly
    where that question gets asked. Nothing is left out now, because nothing needs to be:
    the cell is the desktop cell, only smaller.
    """
    got, _ = grid()
    rooms = [b for _, boxes in got.days for b in boxes
             if not b["skip"] and "terem" in b["text"]]
    assert rooms, "no card shows a room at all, so the week cannot say where anything is"


def test_a_day_keeps_room_for_exactly_its_own_stripes():
    """Not for the most any day might have.

    The card reserved a flat twenty pixels down its right for them, which is a third of a
    phone's day column, and every day gave it up whether anybody else had a class that day
    or not. Only the view knows how many lanes a day came to, because only the view has run
    lanes(), so it says.
    """
    got, _ = grid()
    seen = 0
    for name, boxes in got.days:
        stripes = [b for b in boxes if b["stripe"]]
        used = len({int(b["lane"]) for b in stripes})
        assert got.lanes.get(name) is not None, (
            "%s does not say how many stripe lanes it uses, so the cards on it cannot"
            " reserve the right amount of room" % name)
        assert int(got.lanes[name]) == used, (
            "%s says it uses %s lanes and draws %d. Too few and a stripe is under a card;"
            " too many and the card gives up room for nothing."
            % (name, got.lanes[name], used))
        seen += used
    assert seen, "no day uses any lane, so this test watched nothing"


# ── the hours that are spoken for without being a class ──────────────────────

def test_work_is_drawn_behind_the_day_rather_than_on_it():
    """Eight hours of Monday as a card is a card lying on top of every lecture that
    morning, and a card is opaque, so exactly one of the two can be read.

    It is not competing with the classes for the column: it is the reason the column is
    not free. So it is a band the width of the day, underneath them.
    """
    week = {"classes": WEEK["classes"] + [
        {"day": 0, "at": "08:30", "to": "16:30", "kind": "band", "whose": "me",
         "name": "Munka", "where": ""}]}
    got, _ = grid(week)

    # A band and not a card. Asking only for the class was not enough: a band that went
    # through the card path comes out as "tt-card tt-band", which reads as a band, is
    # styled as a card, and lies on top of the morning exactly as before.
    bands = [b for _, boxes in got.days for b in boxes
             if "tt-band" in b["classes"] and "tt-card" not in b["classes"]]
    assert len(bands) == 1, (
        "the long stretch of the day was drawn as %s. A card that long covers the morning."
        % ([b["classes"] for _, boxes in got.days for b in boxes
            if b["label"].startswith("Munka")] or "nothing at all"))

    monday = [b for name, boxes in got.days if name == "Hétfő" for b in boxes]
    covered = [b for b in monday if not b["stripe"] and "tt-band" not in b["classes"]
               and clash(b, bands[0])]
    assert covered, "nothing on Monday runs during the band, so this watched nothing"

    sheet = io.open(os.path.join(ROOT, "web", "css", "44-orarend.css"),
                    encoding="utf-8").read()
    # Whichever of the band's rules carries the layer. It is named in more than one: the
    # rule that places every box by the hours it says mentions it too, and has no layer.
    layers = [re.search(r"z-index:\s*(\d+)", found.group(1))
              for found in re.finditer(r"\.tt-band[^{}]*\{([^}]*)\}", sheet)]
    layer = next((found for found in layers if found), None)
    assert layer and int(layer.group(1)) == 0, \
        "the band does not say which layer it is on, so it covers whatever it overlaps"
    above = re.search(r"\.tt-card,\s*\.tt-stripe\s*\{\s*z-index:\s*(\d+)", sheet)
    assert above and int(above.group(1)) > int(layer.group(1)), (
        "the classes are not above the band, so a morning at work hides the lecture in it")


def test_everything_drawn_on_a_day_is_placed_by_the_hours_it_says():
    """The view writes --at and --for on every box it draws, and one rule turns those into
    a top and a height. A box whose class is not in that rule is drawn nought pixels tall.

    Which is exactly what happened to the band: it had a colour, a hatch, an edge and a
    label, it was in the markup with the right hours on it, and it was invisible, because
    the rule that makes hours into pixels named cards and stripes and nothing else.
    """
    sheet = io.open(os.path.join(ROOT, "web", "css", "44-orarend.css"),
                    encoding="utf-8").read()
    bare = re.sub(r"/\*.*?\*/", "", sheet, flags=re.S)
    rule = re.search(r"([^{}]+)\{\s*top:\s*calc\(var\(--at", bare)
    assert rule, "nothing turns the hours a box says into a place on the grid"
    placed = {part.strip() for part in rule.group(1).split(",")}

    view = io.open(VIEW, encoding="utf-8").read()
    drawn = set(re.findall(r'class="(tt-(?:card|stripe|band))', view))
    assert drawn, "the view draws no boxes at all"
    for what in drawn:
        assert "." + what in placed, (
            "the view draws a %s and the stylesheet does not give it a top or a height, so"
            " it is on the grid and nought pixels tall. Placed: %s" % (what, sorted(placed)))


def test_a_band_is_not_one_of_the_kinds_of_class():
    """It has no tag and it is not in the legend beside Ea and Gy, because it is not one.

    The tag says which kind of teaching an hour is. A shift at work is not a kind of
    teaching, and a card that wore "Munka" as though it were would be the sketch's old
    mistake in a new place: a category invented by the drawing rather than by the thing.
    """
    week = {"classes": WEEK["classes"] + [
        {"day": 4, "at": "08:30", "to": "16:30", "kind": "band", "whose": "me",
         "name": "Munka", "where": ""}]}
    got, _ = grid(week)
    bands = [b for _, boxes in got.days for b in boxes if "tt-band" in b["classes"]]
    assert bands, "no band was drawn"
    for box in bands:
        assert not box["tag"].strip(), \
            "the band carries the tag %r, which says it is a kind of class" % box["tag"]
        assert "tt-card" not in box["classes"], \
            "the band is a card, so it is drawn over what it overlaps"
    assert box["at"] is not None, "the band cannot be opened, so it cannot say what it is"


# ── a closer look ────────────────────────────────────────────────────────────

def test_the_page_is_left_zoomable_by_the_browser():
    """The week had a zoom of its own: pinch, drag, double tap, a scale on top of the fit.

    It worked, and it was the wrong thing to have built. A phone already knows how to zoom
    a page and everybody already knows how to ask it to, and a second zoom inside the first
    is two sets of rules for one gesture, each with its own idea of where the page is.

    So nothing here may take a pinch away from the browser. touch-action on the frame is
    how a page does that, and a maximum-scale or user-scalable=no in the viewport is the
    other way, which is worse: it turns the zoom off for the whole document.
    """
    sheet = io.open(os.path.join(ROOT, "web", "css", "44-orarend.css"),
                    encoding="utf-8").read()
    bare = re.sub(r"/\*.*?\*/", "", sheet, flags=re.S)
    rule = re.search(r"\.tt-fit\s*\{([^}]*)\}", bare)
    assert rule, "the frame has no rule of its own"
    assert "touch-action" not in rule.group(1), (
        "the frame claims the gesture again, so two fingers on the week do not zoom the"
        " page: %s" % rule.group(1).strip())

    page = io.open(os.path.join(ROOT, "web", "index.html"), encoding="utf-8").read()
    viewport = re.search(r'name="viewport" content="([^"]*)"', page)
    assert viewport, "the page does not say how it wants to be laid out"
    for banned in ("user-scalable=no", "user-scalable=0", "maximum-scale"):
        assert banned not in viewport.group(1).replace(" ", ""), (
            "the viewport says %s, which turns the browser's zoom off: %s"
            % (banned, viewport.group(1)))

    view = io.open(VIEW, encoding="utf-8").read()
    for gesture in ("pointerdown", "gesturestart", "wheel"):
        assert 'frame.addEventListener("%s"' % gesture not in view, (
            "the week is listening for %s again, which is the zoom that was taken out"
            % gesture)


def test_nothing_over_the_week_claims_the_pinch():
    """The viewport was never the problem. The stylesheet was.

    The scrolling column carries touch-action: pan-y, which is how the rail swipe gets a
    sideways drag to itself. What that also does, and what is easy to miss, is switch
    pinch off: pan-y means "vertical panning, nothing else", and zooming is one of the
    things it refuses. So the page said it could be zoomed, the browser agreed, and two
    fingers on the week did nothing.

    This checks the whole stack of rules that lands on the timetable, not just the ones
    in its own file: an ancestor saying pan-y is exactly what this was.
    """
    here = os.path.join(ROOT, "web", "css")
    sheets = {name: re.sub(r"/\*.*?\*/", "", io.open(os.path.join(here, name),
                                                     encoding="utf-8").read(), flags=re.S)
              for name in sorted(os.listdir(here)) if name.endswith(".css")}

    #: Everything the week is drawn inside. A rule on any of these reaches it.
    over = (".view", ".shell", "body", "html", ":root", ".tt-fit", ".tt-grid")
    claimed = []
    for name, text in sheets.items():
        for found in re.finditer(r"([^{}]+)\{([^}]*)\}", text):
            action = re.search(r"touch-action:\s*([^;]+)", found.group(2))
            if not action or action.group(1).strip() == "auto":
                continue
            for part in found.group(1).split(","):
                part = part.strip()
                # The exception itself, and anything scoped to this screen, is the answer
                # rather than the problem.
                if 'data-view="orarend"' in part:
                    continue
                if part in over or any(part.endswith(" " + o) for o in over):
                    claimed.append("%s: %s { touch-action: %s }"
                                   % (name, part, action.group(1).strip()))

    #: The shell's own rule is expected to still be there: it is what the rail swipe needs
    #: everywhere else, and taking it out would be a different bug. What must exist beside
    #: it is the exception that puts the gesture back on this one screen.
    exception = re.search(
        r'body\[data-view="orarend"\]\s+\.view\s*\{[^}]*touch-action:\s*auto',
        sheets.get("44-orarend.css", ""))
    assert exception, (
        "nothing gives the pinch back on this screen, and these rules take it away: %s"
        % (claimed or "none, so this test is watching nothing"))
    assert claimed, (
        "no rule over the week claims a gesture any more, so the exception in"
        " 44-orarend.css is answering a question nobody is asking. Take it out.")

    # And the thing the exception is keyed on. Without this line the selector matches
    # nothing, the rule above is dead text, and the week quietly stops zooming again.
    router = io.open(os.path.join(ROOT, "web", "js", "80-router.js"),
                     encoding="utf-8").read()
    assert "document.body.dataset.view = view" in router, (
        "nothing writes which screen is up onto the body, so a rule that names one can"
        " never match")


def test_the_rail_gets_out_of_the_way_of_the_week():
    """Five days wide, and a column of album links beside it is width the week does not get.

    Tucked rather than taken away, and not remembered: the hamburger still opens it, and
    the choice somebody made about the rail everywhere else is not overwritten by their
    having opened the timetable once.
    """
    boot = io.open(os.path.join(ROOT, "web", "js", "90-boot.js"), encoding="utf-8").read()
    roomy = re.search(r"const ROOMY = \[([^\]]*)\]", boot)
    assert roomy and "orarend" in roomy.group(1), (
        "no screen asks for the whole width, so the timetable is drawn beside the rail")

    hook = re.search(r"J\.railForView = \(view\) => \{(.+?)\n  \};", boot, flags=re.S)
    assert hook, "nothing tells the rail which screen is coming up"
    assert "setRail(true, true)" in hook.group(1), (
        "the rail is shut in a way that is written down, so visiting the timetable is a"
        " decision about every other screen: %s" % hook.group(1).strip())
    assert "setRail(remembered(), true)" in hook.group(1), (
        "the rail is not put back on the way out")

    router = io.open(os.path.join(ROOT, "web", "js", "80-router.js"),
                     encoding="utf-8").read()
    assert "J.railForView(view)" in router, (
        "the router never says which screen it is showing, so the rail cannot answer")


# ── whose week ───────────────────────────────────────────────────────────────

def test_the_week_can_be_somebody_else_s():
    """Two questions, two shapes.

    The whole week answers "when are we both free": my classes as cards, everybody else's
    as a stripe down the side. It cannot answer "when is Zita free on Wednesday", because
    her hours there are a five pixel stripe with nothing written on them.

    So picking a person draws their week the way mine is drawn. Cards, with the room and
    the teacher on them, and nobody else's classes in the way.
    """
    got, _ = grid(who="Vendég")
    cards = [b for _, boxes in got.days for b in boxes
             if "tt-card" in b["classes"] and not b["skip"]]
    assert cards, "picking somebody drew no classes at all"
    for box in cards:
        assert "vendég" in box["text"].lower() or "egyszerre" in box["text"].lower() \
            or "később, egyedül ő is" in box["text"].lower(), (
            "somebody else's class is drawn as a card on this person's week: %r"
            % box["text"].strip())

    stripes = [b for _, boxes in got.days for b in boxes if b["stripe"]]
    assert not stripes, (
        "one person's week still has stripes on it. There is nobody to tell apart from"
        " anybody, so a stripe is a lane of nothing down every day.")


def test_my_own_week_is_the_one_with_everybody_on_it():
    """The default, and the reason the page exists. Picking nobody is not picking me."""
    whole, _ = grid()
    assert [b for _, boxes in whole.days for b in boxes if b["stripe"]], (
        "the default week has nobody else on it, so the one question it was built to"
        " answer cannot be asked")

    mine, _ = grid(who="me")
    assert not [b for _, boxes in mine.days for b in boxes if b["stripe"]], (
        "picking my own week still draws everybody else's stripes")


def test_everybody_on_the_week_can_be_picked():
    """Including me, and including all of us. A person with classes on this timetable and
    no way to ask for their week is a person you can see and cannot read."""
    got = drawn()
    offered = set(re.findall(r'name="ttWho" value="([^"]*)"', got["html"]))
    people = {c["whose"] for c in WEEK["classes"] if c["whose"] != "me"}
    assert offered == people | {"all", "me"}, (
        "the switch offers %s and the week has %s on it" % (sorted(offered), sorted(people)))


def test_redrawing_forgets_what_was_measured_about_the_week_before():
    """The fit remembers the last hour height, scale and frame height it wrote, so that a
    resize that changes nothing writes nothing. A redraw changes everything: a different
    person's week is a different height, and the cache would answer for the old one."""
    view = io.open(VIEW, encoding="utf-8").read()
    redraw = view[view.index("    function redraw() {"):]
    redraw = redraw[:redraw.index("\n    }")]
    assert "told = { hour: null, fit: null, height: null }" in redraw, (
        "the fit's cache survives a redraw, so the new week is drawn at the old one's"
        " scale until something else resizes: %s" % redraw.strip()[:200])
    assert "fitToRoom()" in redraw, "the redrawn week is never fitted"


# ── making and changing one ──────────────────────────────────────────────────

def test_a_class_is_found_by_its_name_and_not_by_where_it_sits():
    """The bug this whole key exists to stop, and the one it caused on the way in.

    The card carries whatever the server calls the class. That was its position while the
    week was read only, and an index is a fine name for a row in a list nothing writes to.
    It is an id now, so the card said data-at="1790086969781" and the handler, still
    reading it as a position, asked the array for its one billion, seven hundred and
    ninety millionth entry and got nothing back. Every card on the timetable stopped
    opening, in a way nothing threw an error about.
    """
    view = io.open(VIEW, encoding="utf-8").read()
    # On the frame rather than the grid: the grid is replaced whenever the week is redrawn
    # for somebody else, and a listener on a replaced element is a listener on nothing.
    click = view[view.index('frame.addEventListener("click"'):]
    click = click[:click.index("\n    });")]
    assert "CLASSES[Number(" not in click, (
        "a class is looked up by its position again, so nothing opens as soon as one of"
        " them has an id")
    assert re.search(r"CLASSES\.find\(\(\w+\) => \w+\.key === ", click), (
        "the click handler does not find the class by the name the card carries: %s"
        % click.strip()[:200])


def test_every_box_carries_the_name_the_server_gave_it():
    """Rather than one the page made up, which is how the two got out of step."""
    keyed = {"classes": [dict(WEEK["classes"][1], id=1790000000001),
                         dict(WEEK["classes"][2])]}
    got, _ = grid(keyed)
    said = [b["at"] for _, boxes in got.days for b in boxes]
    assert "1790000000001" in said, (
        "a class with an id is drawn under some other name: %s" % said)
    assert any(s.startswith("i:") for s in said), (
        "a class with no id is not drawn under its position: %s" % said)


def test_there_is_a_way_to_add_a_class_on_both_screens():
    """Including, and especially, the screen for somebody who has no week at all.

    That screen used to say: put your classes in orarend.json and reload. Which is fine at
    a desk and useless on a bus, and the bus is where a timetable is actually read.
    """
    got = drawn()
    assert 'id="ttNew"' in got["html"], "the week cannot be added to"

    empty = drawn({"classes": [], "missing": True, "where": "orarend.json"})
    assert 'id="ttNew"' in empty["html"], (
        "an account with no week is still told to go and edit a file, with nothing on the"
        " screen to make one with")
    # And it still says where the week lives, because it is still a file.
    assert "orarend.json" in empty["html"]


def test_a_class_can_be_changed_and_dropped_from_the_one_it_opens():
    """Both on the sheet that opens when a class is tapped, which is where somebody
    already is when they notice the room has changed."""
    view = io.open(VIEW, encoding="utf-8").read()
    detail = view[view.index("function detail(entry) {"):]
    detail = detail[:detail.index("\n    /* ── making and changing one")]
    # The buttons themselves, not the handlers that look for them: asking only for the
    # word "data-edit" was answered by the querySelector that wires it, so the test went
    # on passing with the button taken out of the markup and nothing left to wire.
    for what, said in (("data-edit", "change"), ("data-drop", "drop")):
        assert re.search(r"<button[^>]*\b%s\b" % what, detail), (
            "the sheet a class opens has no button to %s it" % said)
    assert "form(entry)" in detail and "remove(entry)" in detail

    drop = view[view.index("async function remove(entry) {"):]
    drop = drop[:drop.index("\n    }")]
    assert "const sure = await J.confirm(" in drop and "if (!sure) return;" in drop, (
        "a class is deleted without being asked about, or the answer is not waited for."
        " It is one tap on a phone, on a page made of tappable rectangles, and the week is"
        " not anywhere else: %s" % drop.strip()[:200])


def test_the_form_offers_every_kind_the_server_will_accept():
    """A form that offers four of five kinds is a fifth kind you can only get by editing
    the file, which is the thing this page is for not having to do."""
    view = io.open(VIEW, encoding="utf-8").read()
    said = re.search(r"const KIND_SAID = \{(.+?)\};", view, flags=re.S)
    assert said, "the view no longer names the kinds"
    offered = set(re.findall(r"(\w+):", said.group(1)))
    assert offered == set(orarend.KINDS), (
        "the page offers %s and the server accepts %s"
        % (sorted(offered), sorted(orarend.KINDS)))


def test_what_a_class_says_is_what_the_server_keeps():
    """Every field on the form is one the module will write, and the other way round.

    A form field the server drops is typing that disappears on save with nothing said
    about it, which is the worst of the two directions.
    """
    view = io.open(VIEW, encoding="utf-8").read()
    form = view[view.index("    async function form(entry) {"):]
    form = form[:form.index("\n    async function remove")]
    # Both shapes: the ones written out, and the ones the row helper is asked for.
    asked = set(re.findall(r'name="(\w+)"', form)) | set(re.findall(r'line\("(\w+)"', form))
    keeps = set(orarend.FIELDS)
    assert asked <= keeps, (
        "the form asks for %s, which the server does not keep" % sorted(asked - keeps))
    # day, at and to are the ones without which a class cannot be drawn at all.
    for must in ("name", "day", "at", "to", "kind", "whose", "where"):
        assert must in asked, "the form has no way to say %s" % must


def test_the_timetable_is_not_in_the_rail():
    """It is reached from Foyer, which is the room that holds everything on this machine.

    A nav item for somebody's university week, in a music library, between Renders and
    Settings, was the shortest way to it while it was being built. The rail is for the
    library.
    """
    boot = io.open(os.path.join(ROOT, "web", "js", "90-boot.js"), encoding="utf-8").read()
    nav = boot[boot.index("async function buildRail("):]
    nav = nav[:nav.index("\n}")]
    assert "orarend" not in nav, (
        "the rail still builds an Órarend item. It is reached from Foyer now: %s"
        % [line.strip() for line in nav.splitlines() if "orarend" in line])
    # The screen itself is still there and still reachable by its route.
    assert os.path.isfile(os.path.join(ROOT, "web", "js", "56-view-orarend.js")), \
        "the view is gone, so removing it from the rail removed the whole screen"


# ── the two nothings ─────────────────────────────────────────────────────────

def test_a_week_that_is_not_there_says_how_to_make_one():
    """Most accounts have never written one, so this is the ordinary case, not an error."""
    got = drawn({"classes": [], "missing": True, "where": "orarend.json"})
    assert "orarend.json" in got["html"], (
        "the empty screen does not say which file to write: %s" % got["html"][:300])
    assert "tt-grid" not in got["html"], "an empty week still drew a grid"


def test_a_week_that_will_not_parse_says_so_differently():
    """A file that is there and broken is somebody mid-edit, and the answer is which
    character stopped it. Telling it apart from a missing file costs a line and saves the
    second person looking for a file that is right in front of them."""
    got = drawn({"classes": [], "broken": "Expecting ',' delimiter: line 4 column 3"})
    assert "line 4" in got["html"], (
        "the broken screen does not say what is wrong with the file: %s"
        % got["html"][:300])
    assert "nem olvasható" in got["html"]


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
