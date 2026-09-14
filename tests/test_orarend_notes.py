"""Notes and absences, per subject.

The week is a file somebody edits; these are the other way round. They are made here, a few
characters at a time, by pressing things, so they live in the account's own database and are
as far from anybody else's as their songs are.

KEYED ON THE NAME, because a class has no id. "Webprogramozás Ea+Gy" happens twice in a week
and it is one subject: opening either of them has to reach the same page and the same count.
That is the first test below and it is the whole design in one line.
"""
import pytest

from jriter import db
from jriter.wire import Error
from jriter.modules import orarend


class Ask:
    def __init__(self, params=None, body=None, query=None):
        self.params = params or {}
        self._body = body or {}
        self._q = query or {}
        self.headers = {}

    def json(self):
        return self._body

    def q(self, name, fallback=None):
        return self._q.get(name, fallback)


def _read(subject):
    return orarend.notes(Ask(query={"subject": subject}))


def _absences(subject, n):
    return orarend.set_absences(Ask(body={"subject": subject, "absences": n}))


def _add(subject, text=""):
    return orarend.add_page(Ask(body={"subject": subject, "text": text}))


# ── the key ──────────────────────────────────────────────────────────────────

def test_the_same_subject_twice_in_a_week_is_one_set_of_notes():
    """It is what the key is for.

    Webprogramozás is on a Monday and a Wednesday. Two classes, one subject: whichever one
    is opened has to show the same page and the same count, or notes silently split in two
    and half of them are wherever you were not looking.
    """
    _add("Webprogramozás Ea+Gy", "az első óráról")
    _absences("Webprogramozás Ea+Gy", 2)

    # Opened from the other day. Same name, so the same note.
    again = _read("Webprogramozás Ea+Gy")
    assert again["absences"] == 2
    assert [p["text"] for p in again["pages"]] == ["az első óráról"]


def test_two_different_subjects_do_not_share():
    _add("Logika Gy", "one")
    _add("Python", "two")
    assert [p["text"] for p in _read("Logika Gy")["pages"]] == ["one"]
    assert [p["text"] for p in _read("Python")["pages"]] == ["two"]


def test_a_subject_with_no_name_is_refused():
    """Otherwise every unnamed thing shares one note called nothing."""
    for bad in ("", "   ", None):
        with pytest.raises(Error):
            orarend.notes(Ask(query={"subject": bad}))


# ── reading writes nothing ───────────────────────────────────────────────────

def test_opening_a_subject_does_not_write_a_row():
    """Looking at a class is not making a note about it.

    Without this, every class anybody ever glanced at has a row, and "which subjects have I
    written anything about" stops being a question the data can answer.
    """
    before = db.one("SELECT COUNT(*) AS n FROM orarend_notes")["n"]
    got = _read("Amit csak megnéztem")
    assert got["absences"] == 0 and got["pages"] == []
    after = db.one("SELECT COUNT(*) AS n FROM orarend_notes")["n"]
    assert after == before, "reading a subject made a row for it"


def test_a_subject_never_written_about_still_answers():
    """With the shape the screen expects, so it can draw empty boxes rather than nothing."""
    got = _read("Semmi")
    assert got["subject"] == "Semmi"
    assert got["absences"] == 0
    assert got["pages"] == []
    assert got["allowed"] == orarend.ABSENCES


# ── the three boxes ──────────────────────────────────────────────────────────

def test_absences_are_kept():
    assert _absences("Logika Gy", 2)["absences"] == 2
    assert _read("Logika Gy")["absences"] == 2


def test_absences_can_go_back_down():
    """A box is a box: ticking is not one-way, and a miscount has to be fixable."""
    _absences("Logika Gy", 3)
    assert _absences("Logika Gy", 1)["absences"] == 1


def test_more_than_three_is_capped_rather_than_stored():
    """The screen offers three boxes, so it cannot ask for four.

    Capped in the handler as well, so the number in the database always agrees with the row
    of boxes that draws it. A stored 7 would render as three ticks beside the number 7.
    """
    assert _absences("Logika Gy", 9)["absences"] == orarend.ABSENCES


def test_a_negative_count_is_refused():
    with pytest.raises(Error):
        _absences("Logika Gy", -1)


# ── the pages ────────────────────────────────────────────────────────────────

def test_pages_come_back_in_the_order_they_were_added():
    for text in ("első", "második", "harmadik"):
        _add("Logika Gy", text)
    assert [p["text"] for p in _read("Logika Gy")["pages"]] == \
        ["első", "második", "harmadik"]


def test_a_page_can_be_written_to():
    made = _add("Logika Gy", "")
    page = made["pages"][0]["id"]
    orarend.save_page(Ask(params={"id": str(page)}, body={"text": "# Cím\n\nszöveg"}))
    assert _read("Logika Gy")["pages"][0]["text"] == "# Cím\n\nszöveg"


def test_a_page_can_be_thrown_away():
    _add("Logika Gy", "keep")
    made = _add("Logika Gy", "drop")
    orarend.drop_page(Ask(params={"id": str(made["pages"][1]["id"])}))
    assert [p["text"] for p in _read("Logika Gy")["pages"]] == ["keep"]


def test_throwing_away_the_last_page_leaves_the_subject_there():
    """The absences are not pages, and losing them with the last note would be a surprise."""
    _absences("Logika Gy", 2)
    made = _add("Logika Gy", "only one")
    orarend.drop_page(Ask(params={"id": str(made["pages"][0]["id"])}))
    got = _read("Logika Gy")
    assert got["pages"] == []
    assert got["absences"] == 2, "the absences went with the last page"


def test_a_page_id_from_nowhere_is_refused():
    """The id comes from the caller, so it is looked up before anything is written to it."""
    for call in (orarend.save_page, orarend.drop_page):
        with pytest.raises(Error) as raised:
            call(Ask(params={"id": "99999"}, body={"text": "x"}))
        assert raised.value.status == 404


def test_the_markdown_is_kept_as_it_was_typed():
    """Rendered when it is read, not on the way in.

    Storing rendered markup would mean the stored thing is the output of whichever renderer
    was current the day it was saved, and editing it later would hand back HTML to type
    into.
    """
    source = "# Fejezet\n\n- egy\n- kettő\n\n**vastag**"
    made = _add("Logika Gy", source)
    assert made["pages"][0]["text"] == source
    assert "<" not in _read("Logika Gy")["pages"][0]["text"]


# ── the routes ───────────────────────────────────────────────────────────────

def test_every_handler_is_reachable():
    routes = orarend.ROUTES()
    for want in (("GET", "/api/orarend/notes"),
                 ("PUT", "/api/orarend/notes"),
                 ("POST", "/api/orarend/notes/pages"),
                 ("PUT", "/api/orarend/notes/pages/<id>"),
                 ("DELETE", "/api/orarend/notes/pages/<id>")):
        assert want in routes, "%s %s is not routed" % want
