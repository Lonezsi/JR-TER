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
#:   Monday     a plain two hour lecture, and one of hers at the same time
#:   Tuesday    three of hers at once, which is what lanes exist for
#:   Wednesday  a lecture that is not attended, with a class of mine beside it
#:   Thursday   a class ending on a half hour, so the height is not a whole number of rows
#:   Friday     nothing, because an empty day is a real day
WEEK = {"classes": [
    {"day": 0, "at": "08:00", "to": "10:00", "kind": "ea", "whose": "me",
     "name": "Első tárgy Ea", "where": "A terem"},
    {"day": 0, "at": "08:00", "to": "09:00", "kind": "gy", "whose": "Hédi",
     "name": "Az ő órája", "where": "B terem"},

    {"day": 1, "at": "10:00", "to": "12:00", "kind": "ea", "whose": "Hédi",
     "name": "Egyszerre egy", "where": "C terem"},
    {"day": 1, "at": "10:00", "to": "11:00", "kind": "gy", "whose": "Hédi",
     "name": "Egyszerre kettő", "where": "D terem"},
    {"day": 1, "at": "10:30", "to": "11:30", "kind": "both", "whose": "Hédi",
     "name": "Egyszerre három", "where": "E terem"},
    # Later the same day, clashing with none of them. This is what tells "the first free
    # lane" apart from "the next lane": both rules put the three above in 0, 1 and 2, and
    # only the wrong one puts this in 3, leaving two stripes' width of nothing beside it.
    # Without this entry the packing test passes on either rule.
    {"day": 1, "at": "14:00", "to": "15:00", "kind": "gy", "whose": "Hédi",
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


def drawn(week=None):
    """Run the real view over a week and return what it made."""
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
        out = subprocess.run([node, RENDER, path], capture_output=True, cwd=ROOT)
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
        self.legend = []
        self.scrolls = 0
        self._day = None
        self._box = None
        self._hour = False
        self._tag = False

    def handle_starttag(self, tag, attrs):
        at = dict(attrs)
        classes = at.get("class", "").split()
        if "tt-scroll" in classes:
            self.scrolls += 1
        if "tt-day" in classes:
            self._day = (at.get("aria-label", ""), [])
            self.days.append(self._day)
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
                "label": at.get("aria-label", ""),
                "text": "",
                "tag": "",
                "top": px(style, "top"),
                "height": px(style, "height"),
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


def grid(week=None):
    made = drawn(week)
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


def test_the_grid_scrolls_rather_than_the_page():
    """Five days keep a minimum width on a phone, and something has to absorb it.

    Without a container of its own that width makes the whole document slide sideways, rail
    and player included, which is the thing a phone browser does worst. Foyer's copy of
    this stylesheet had the rule on a class no element carried, so it never worked there.
    """
    got, _ = grid()
    assert got.scrolls == 1, (
        "the grid is inside %d scroll containers. The stylesheet gives it a minimum width"
        " on a narrow screen, so with none the page itself scrolls sideways." % got.scrolls)

    sheet = io.open(os.path.join(ROOT, "web", "css", "44-orarend.css"),
                    encoding="utf-8").read()
    rule = re.search(r"\.tt-scroll\s*\{([^}]*)\}", sheet)
    assert rule and "overflow-x" in rule.group(1), \
        "the scroll container has no overflow of its own, so it absorbs nothing"


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
