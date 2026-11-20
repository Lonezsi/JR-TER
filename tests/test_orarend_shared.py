"""Everybody signed in reads the owner's week, and only the owner changes it.

It was per account, so a friend sent to look at the timetable signed in and found their
own empty one. Over real HTTP with two real accounts, because the question is entirely
about who is asking.
"""
from test_two_people_over_http import library, _owner_and_friend   # noqa: F401

CLASS = {"name": "Algoritmusok", "day": 1, "at": "10:00", "to": "11:30", "kind": "ea"}


def test_a_friend_reads_the_owners_week(library):
    owner, friend = _owner_and_friend(library)
    status, made = owner.call("POST", "/api/orarend/classes", CLASS)
    assert status == 200, made
    status, seen = friend.call("GET", "/api/orarend")
    assert status == 200 and [c["name"] for c in seen["classes"]] == ["Algoritmusok"], seen
    assert seen["readonly"] is True and seen["owner"], seen
    status, own = owner.call("GET", "/api/orarend")
    assert own["readonly"] is False


def test_a_friend_cannot_change_it(library):
    owner, friend = _owner_and_friend(library)
    status, made = owner.call("POST", "/api/orarend/classes", CLASS)
    key = made["classes"][0]["key"]
    assert friend.call("POST", "/api/orarend/classes", CLASS)[0] == 403
    assert friend.call("PUT", "/api/orarend/classes/%s" % key, {"name": "x"})[0] == 403
    assert friend.call("DELETE", "/api/orarend/classes/%s" % key)[0] == 403
    status, seen = owner.call("GET", "/api/orarend")
    assert [c["name"] for c in seen["classes"]] == ["Algoritmusok"]


def test_notes_and_absences_stay_each_persons_own(library):
    owner, friend = _owner_and_friend(library)
    owner.call("POST", "/api/orarend/classes", CLASS)
    assert friend.call("PUT", "/api/orarend/notes",
                       {"subject": "Algoritmusok", "absences": 2})[0] == 200
    status, mine = owner.call("GET", "/api/orarend/notes?subject=Algoritmusok")
    assert mine["absences"] == 0, "the friend's absences landed on the owner"


def test_the_page_offers_no_editing_to_a_reader():
    import io
    import os
    view = io.open(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                                "ui", "src", "views", "Orarend.svelte"), encoding="utf-8").read()
    assert "const readonly = $derived(!!week?.readonly);" in view
    # Every way in to a write is behind it: the button, the keys, the context menu and the
    # functions themselves, so a reader who reaches one some other way still changes nothing.
    assert "{#if week && !readonly}" in view, "the New button"
    assert "...(readonly ? [] : [" in view, "the edit, copy and delete menu items"
    for header in ("async function drop(entry: Entry) {", "async function create(day?: number) {",
                   "async function edit(entry: Entry) {"):
        at = view.index(header)
        assert "if (readonly" in view[at:at + len(header) + 40],             "%s can be reached by a reader" % header.split("(")[0]
    assert view.count("&& !readonly") >= 3, "the keyboard shortcuts"
