"""Adding, changing and dropping a class, over the wire.

WHY THIS IS SEPARATE FROM test_orarend.py. That file is about the drawing: it runs the
real view under node and asks where things landed. This one never draws anything. It is
about the file on disk, which is somebody's timetable, typed in over a semester and kept
nowhere else, and which this app has only ever read until now.

WHAT THE TESTS ARE ABOUT, THEREFORE. Not "can it add a class", which is one line of the
handler and would pass on the day the file is emptied by a bad write. They are about what
must stay true of a file that is also edited by hand: an edit lands on the class it was
aimed at and not on its neighbour, a key nobody here knows about survives a save, and a
file that will not parse is never written over.
"""
import io
import json
import os

import pytest

from jriter import config
from jriter.modules import orarend


def week(*classes):
    """Write a week to the account's own directory, as though somebody had typed it."""
    with io.open(orarend.path(), "w", encoding="utf-8", newline="\n") as f:
        json.dump({"classes": list(classes)}, f, ensure_ascii=False, indent=2)


def held():
    """The file as it is now, read straight rather than through the module."""
    with io.open(orarend.path(), encoding="utf-8") as f:
        return json.load(f)["classes"]


ONE = {"day": 0, "at": "10:00", "to": "11:30", "kind": "gy", "whose": "me",
       "name": "Első", "where": "A terem"}
TWO = {"day": 1, "at": "12:00", "to": "13:30", "kind": "ea", "whose": "me",
       "name": "Második", "where": "B terem"}


def test_a_class_can_be_added_and_comes_back_in_the_week(server):
    status, made = server.post("/api/orarend/classes", {
        "day": 2, "at": "09:00", "to": "10:30", "kind": "ea", "name": "Új tárgy",
        "where": "C terem", "code": "IP-18AB1E", "group": "2", "teacher": "Valaki Dr."})
    assert status == 200, made
    names = [c["name"] for c in made["classes"]]
    assert "Új tárgy" in names, names

    kept = [c for c in held() if c["name"] == "Új tárgy"][0]
    assert kept["code"] == "IP-18AB1E" and kept["group"] == "2"
    assert kept["teacher"] == "Valaki Dr."


def test_a_new_class_is_given_something_to_call_it_by(server):
    server.post("/api/orarend/classes", {"day": 0, "at": "08:00", "to": "09:00",
                                         "name": "Egy"})
    assert held()[0].get("id"), "a class this app wrote has no id, so it cannot be edited"


def test_an_edit_lands_on_the_class_it_was_aimed_at(server):
    """The reason a class has an id at all.

    With a position for a name, deleting anything above a class renames it: the edit sent
    a moment later, from a page drawn before the delete, lands on whatever slid up into
    that slot. Here the second class is dropped and the third is then edited by the name
    the page already had for it.
    """
    week(dict(ONE), dict(TWO), dict(ONE, name="Harmadik", day=2))
    status, first = server.get("/api/orarend")
    third = [c for c in first["classes"] if c["name"] == "Harmadik"][0]

    # Something is written to it, which is what gives it an id of its own.
    status, _ = server.request("PUT", "/api/orarend/classes/" + third["key"],
                               {"where": "Z terem"})
    assert status == 200
    named = [c for c in held() if c["name"] == "Harmadik"][0]

    second = [c for c in server.get("/api/orarend")[1]["classes"]
              if c["name"] == "Második"][0]
    server.request("DELETE", "/api/orarend/classes/" + second["key"])

    status, after = server.request("PUT", "/api/orarend/classes/%s" % named["id"],
                                   {"where": "Y terem"})
    assert status == 200, after
    rooms = {c["name"]: c.get("where") for c in held()}
    assert rooms["Harmadik"] == "Y terem", rooms
    assert rooms["Első"] == "A terem", (
        "the edit landed on a neighbour: %s" % rooms)


def test_a_class_typed_in_by_hand_can_be_edited_where_it_sits(server):
    """Most of the week has no id, because most of it was typed into the file.

    It is named by its position until the first thing is written to it. That is the whole
    reason the key is a string and not a number: "i:3" and "1726000000000" are different
    kinds of name and the difference matters on the way back in.
    """
    week(dict(ONE))
    status, first = server.get("/api/orarend")
    assert first["classes"][0]["key"] == "i:0", first["classes"][0]

    status, _ = server.request("PUT", "/api/orarend/classes/i:0", {"name": "Átnevezve"})
    assert status == 200
    assert held()[0]["name"] == "Átnevezve"
    assert held()[0].get("id"), "editing it did not give it an id, so the next edit is a"\
                                " position again"


def test_a_class_can_be_dropped(server):
    week(dict(ONE), dict(TWO))
    status, _ = server.request("DELETE", "/api/orarend/classes/i:0")
    assert status == 200
    assert [c["name"] for c in held()] == ["Második"]


def test_the_rest_of_the_file_is_left_alone(server):
    """It is somebody's file. A key this app has never heard of is more likely to be a
    note to themselves than a mistake, and a save that dropped it would be this app
    quietly deciding what may be in a timetable."""
    week(dict(ONE, colour="pink", note="ezt ne felejtsd"))
    server.request("PUT", "/api/orarend/classes/i:0", {"where": "Q terem"})
    kept = held()[0]
    assert kept["colour"] == "pink" and kept["note"] == "ezt ne felejtsd", kept
    assert kept["where"] == "Q terem"


def test_a_finish_before_its_start_is_refused(server):
    status, said = server.post("/api/orarend/classes",
                               {"day": 0, "at": "12:00", "to": "10:00", "name": "Hátra"})
    assert status == 400, said
    assert "before it starts" in json.dumps(said, ensure_ascii=False)


@pytest.mark.parametrize("sent,why", [
    ({"day": 9, "at": "10:00", "to": "11:00", "name": "Hatodnap"}, "day"),
    ({"day": 0, "at": "tíz óra", "to": "11:00", "name": "Szavakkal"}, "at"),
    ({"day": 0, "at": "10:00", "to": "11:00", "name": "   "}, "name"),
    ({"day": 0, "at": "10:00", "to": "11:00", "name": "Rossz", "kind": "izé"}, "kind"),
])
def test_what_cannot_be_written_is_refused_by_name(server, sent, why):
    """Refused here rather than in the form.

    The form is one way in and the file is another, and a page that will not let you type
    a finish before a start says nothing about what is already on disk. What this refuses
    cannot be written through this app at all, and it says which field it is about,
    because "invalid" on a five field form is a guessing game.
    """
    status, said = server.post("/api/orarend/classes", sent)
    assert status == 400, said
    assert why in json.dumps(said, ensure_ascii=False).lower(), said


def test_a_file_that_will_not_parse_is_never_written_over(server):
    """Somebody is midway through editing it. Replacing it with whatever this app happens
    to hold would be an afternoon's typing gone, to fix a problem nobody had."""
    half = '{"classes": [ {"day": 0, '
    with io.open(orarend.path(), "w", encoding="utf-8") as f:
        f.write(half)

    status, said = server.post("/api/orarend/classes",
                               {"day": 0, "at": "10:00", "to": "11:00", "name": "Új"})
    assert status == 409, said
    with io.open(orarend.path(), encoding="utf-8") as f:
        assert f.read() == half, "the broken file was overwritten"


def test_a_week_that_is_not_there_yet_can_be_started(server):
    """The ordinary case for a new account: no file at all, and a first class made on the
    page rather than in an editor."""
    if os.path.exists(orarend.path()):
        os.remove(orarend.path())
    status, made = server.post("/api/orarend/classes",
                               {"day": 4, "at": "10:00", "to": "11:00", "name": "Első"})
    assert status == 200, made
    assert [c["name"] for c in held()] == ["Első"]


def test_the_week_is_never_left_half_written(server):
    """Written beside itself and moved into place.

    A process that died halfway through a plain write would leave somebody with a file
    that will not parse and nothing to put back. This asks the question the only way it
    can be asked without killing a process: that the save goes through a temporary file
    and a rename, and that nothing is left lying beside the week afterwards.
    """
    import inspect
    source = inspect.getsource(orarend._save)
    assert "os.replace" in source, (
        "the week is written in place, so a write that stops halfway leaves a broken file")

    week(dict(ONE))
    server.post("/api/orarend/classes", {"day": 3, "at": "10:00", "to": "11:00",
                                         "name": "Új"})
    beside = [f for f in os.listdir(config.home()) if f.startswith("orarend.json.")]
    assert not beside, "a half written file was left behind: %s" % beside


def test_nothing_is_written_when_the_week_is_only_looked_at(server):
    """Reading a week has to leave a hand written file exactly as its author left it.

    The alternative was giving every class an id on the way out, which would have been
    simpler here and would mean that opening the page reformatted somebody's file: their
    indentation, their key order, their comments in the JSON they had been careful about.
    """
    # Typed out rather than dumped, and nothing like the shape a save writes: four spaces,
    # the keys in the order a person thinks of them, one class on a single line. A fixture
    # written by json.dump comes back byte for byte identical from a rewrite, so this test
    # passed with a save added to the read path, which is exactly what it is here to stop.
    hand = (
        '{\n'
        '    "classes": [\n'
        '        {"day": 0, "at": "10:00", "to": "11:30", "name": "Első",\n'
        '         "kind": "gy", "whose": "me", "where": "A terem"},\n'
        '        {"day": 1, "at": "12:00", "to": "13:30", "name": "Második",\n'
        '         "kind": "ea", "whose": "me", "where": "B terem"}\n'
        '    ]\n'
        '}\n')
    with io.open(orarend.path(), "w", encoding="utf-8", newline="\n") as f:
        f.write(hand)

    for _ in range(3):
        assert server.get("/api/orarend")[0] == 200
    assert io.open(orarend.path(), encoding="utf-8").read() == hand, (
        "reading the week rewrote the file, so somebody's own formatting is replaced by"
        " this app's the first time they open the page")
