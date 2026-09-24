"""A guest works on the owner's song itself, and every change can be put back.

The rules, from the owner: they can rename it, add a picture and make it the cover, change
the words, the sound and the arrangement, and add mixes. They cannot delete anything, not
even a picture. And whatever they do has to have a history the owner can undo.

Over real HTTP with two real accounts, because the doorway is in the request handling and a
test that called the functions directly would walk straight past it.
"""
import json

from test_two_people_over_http import library, _owner_and_friend   # noqa: F401


def _setup(library):
    owner, friend = _owner_and_friend(library)
    status, made = owner.call("POST", "/api/songs", {"title": "s"})
    song = made["song"]["id"]
    status, preset = owner.call("POST", "/api/songs/%d/sound" % song, {"name": "Main"})
    preset = preset["preset"]["id"]
    owner.call("PUT", "/api/sound/%d" % preset, {"data": {"bands": [], "gain": 0}})
    status, sheet = owner.call("POST", "/api/songs/%d/lyrics" % song, {"name": "Lyrics"})
    sheet = sheet["sheet"]["id"]
    owner.call("PUT", "/api/lyrics/%d/text" % sheet, {"text": "the owner's verse"})
    status, shared = owner.call("POST", "/api/shares", {"song": song, "handle": "jozsef"})
    assert status == 200, shared
    on = lambda rest: "/api/shared/%d/on/%s" % (shared["share"], rest)   # noqa: E731
    return owner, friend, song, preset, sheet, on


def test_a_guest_can_rename_the_owners_song(library):
    owner, friend, song, _, _, on = _setup(library)
    status, said = friend.call("PATCH", on("songs/%d" % song), {"title": "s, but better"})
    assert status == 200, said
    status, now = owner.call("GET", "/api/songs/%d" % song)
    assert now["song"]["title"] == "s, but better"


def test_the_words_and_the_sound_change_on_the_owners_song(library):
    owner, friend, song, preset, sheet, on = _setup(library)
    assert friend.call("PUT", on("lyrics/%d/text" % sheet), {"text": "his verse"})[0] == 200
    assert friend.call("PUT", on("sound/%d" % preset),
                       {"data": {"bands": [], "gain": -3}})[0] == 200
    status, words = owner.call("GET", "/api/songs/%d/lyrics" % song)
    assert "his verse" in json.dumps(words)
    status, sound = owner.call("GET", "/api/songs/%d/sound" % song)
    assert "-3" in json.dumps(sound)


def test_a_guest_cannot_delete_anything(library):
    owner, friend, song, preset, sheet, on = _setup(library)
    for rest in ("songs/%d" % song, "sound/%d" % preset, "lyrics/%d" % sheet):
        status, said = friend.call("DELETE", on(rest))
        assert status == 403, "a guest deleted %s: %s" % (rest, said)
    assert owner.call("GET", "/api/songs/%d" % song)[0] == 200


def test_a_guest_cannot_reach_another_song(library):
    owner, friend, song, preset, sheet, on = _setup(library)
    status, other = owner.call("POST", "/api/songs", {"title": "private"})
    other = other["song"]["id"]
    for method, rest, body in (("PATCH", "songs/%d" % other, {"title": "x"}),
                               ("GET", "songs/%d/lyrics" % other, None)):
        status, said = friend.call(method, on(rest), body)
        assert status == 404, "%s %s answered %s" % (method, rest, status)
    status, still = owner.call("GET", "/api/songs/%d" % other)
    assert still["song"]["title"] == "private"


def test_a_guest_changes_the_title_and_not_the_owners_notes(library):
    owner, friend, song, _, _, on = _setup(library)
    status, said = friend.call("PATCH", on("songs/%d" % song), {"notes": "mine now"})
    assert status == 403


def test_somebody_else_cannot_use_the_share(library):
    owner, friend, song, _, _, on = _setup(library)
    status, said = owner.call("PATCH", on("songs/%d" % song), {"title": "x"})
    assert status == 404, "the share opened for somebody it was not made for"


def test_the_owner_sees_each_change_and_can_put_it_back(library):
    owner, friend, song, preset, sheet, on = _setup(library)
    friend.call("PATCH", on("songs/%d" % song), {"title": "renamed"})
    friend.call("PUT", on("sound/%d" % preset), {"data": {"bands": [], "gain": -9}})
    friend.call("PUT", on("lyrics/%d/text" % sheet), {"text": "his verse"})

    status, edits = owner.call("GET", "/api/songs/%d/edits" % song)
    said = [e["what"] for e in edits["edits"]]
    assert said == ["edited the words", "changed the sound", "renamed the song"], said
    assert all(e["handle"] == "jozsef" for e in edits["edits"])

    for edit in edits["edits"]:
        assert owner.call("POST", "/api/guest-edits/%d/undo" % edit["id"])[0] == 200
    status, back = owner.call("GET", "/api/songs/%d" % song)
    assert back["song"]["title"] == "s"
    status, sound = owner.call("GET", "/api/songs/%d/sound" % song)
    assert "-9" not in json.dumps(sound)
    status, words = owner.call("GET", "/api/songs/%d/lyrics" % song)
    assert "his verse" not in json.dumps(words) and "the owner's verse" in json.dumps(words)


def test_a_run_of_saves_is_one_change(library):
    """The equaliser saves every 600ms while a band is dragged."""
    owner, friend, song, preset, _, on = _setup(library)
    for gain in range(5):
        friend.call("PUT", on("sound/%d" % preset), {"data": {"bands": [], "gain": -gain}})
    status, edits = owner.call("GET", "/api/songs/%d/edits" % song)
    assert len(edits["edits"]) == 1
    owner.call("POST", "/api/guest-edits/%d/undo" % edits["edits"][0]["id"])
    status, sound = owner.call("GET", "/api/songs/%d/sound" % song)
    assert '"gain": 0' in json.dumps(sound) or "'gain': 0" in str(sound), sound


def test_undoing_one_change_leaves_the_others(library):
    """Undo the rename, keep the words and the picture written after it."""
    owner, friend, song, preset, sheet, on = _setup(library)
    friend.call("PATCH", on("songs/%d" % song), {"title": "renamed"})
    friend.call("PUT", on("lyrics/%d/text" % sheet), {"text": "his verse"})
    status, edits = owner.call("GET", "/api/songs/%d/edits" % song)
    rename = [e for e in edits["edits"] if e["what"] == "renamed the song"][0]
    assert owner.call("POST", "/api/guest-edits/%d/undo" % rename["id"])[0] == 200
    status, back = owner.call("GET", "/api/songs/%d" % song)
    assert back["song"]["title"] == "s"
    status, words = owner.call("GET", "/api/songs/%d/lyrics" % song)
    assert "his verse" in json.dumps(words), "undoing the rename took the later words too"


def test_the_corner_counts_changes_to_the_song_itself(library):
    owner, friend, song, _, _, on = _setup(library)
    friend.call("PATCH", on("songs/%d" % song), {"title": "renamed"})
    status, guests = owner.call("GET", "/api/songs/%d/guests" % song)
    assert status == 200, guests
    person = guests["people"][0]
    assert person["changes"] == 1 and person["made_anything"]
