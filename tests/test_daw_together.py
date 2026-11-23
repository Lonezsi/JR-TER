"""Two people in one song's DAW: the project is stored, stale saves are turned back, a friend
edits through the share and the owner can see them there."""
import json

from test_two_people_over_http import library, _owner_and_friend   # noqa: F401


def _project(bpm=120):
    return json.dumps({"format": "jriter-daw", "version": 7, "bpm": bpm, "tracks": []})


def _setup(library, with_share=False):
    owner, friend = _owner_and_friend(library)
    song = owner.call("POST", "/api/songs", {"title": "s"})[1]["song"]["id"]
    share = owner.call("POST", "/api/shares", {"song": song, "handle": "jozsef"})[1]["share"]
    if with_share:
        return owner, friend, song, share
    return owner, friend, song, "/api/shared/%d/on/songs/%d/daw" % (share, song)


def test_the_project_is_stored_and_a_stale_save_is_turned_back(library):
    owner, _, song, _ = _setup(library)
    url = "/api/songs/%d/daw" % song
    assert owner.call("GET", url)[1]["rev"] == 0
    assert owner.call("PUT", url, {"text": _project(100), "base": 0})[1]["rev"] == 1
    assert owner.call("PUT", url, {"text": _project(110), "base": 1})[1]["rev"] == 2
    status, said = owner.call("PUT", url, {"text": _project(90), "base": 1})
    assert said["conflict"] and said["rev"] == 2 and json.loads(said["text"])["bpm"] == 110
    assert json.loads(owner.call("GET", url)[1]["text"])["bpm"] == 110
    assert owner.call("PUT", url, {"text": "nope", "base": 2})[0] == 400


def test_a_friend_edits_through_the_share_and_both_see_each_other(library):
    owner, friend, song, on = _setup(library)
    url = "/api/songs/%d/daw" % song
    owner.call("PUT", url, {"text": _project(100), "base": 0})
    status, mine = friend.call("GET", on)
    assert status == 200 and mine["rev"] == 1
    assert friend.call("PUT", on, {"text": _project(130), "base": 1})[1]["rev"] == 2
    assert json.loads(owner.call("GET", url)[1]["text"])["bpm"] == 130
    owner.call("POST", url + "/here", {"cursor": {"tab": "mixer"}})
    friend.call("POST", on + "/here", {"cursor": {"tab": "roll", "bar": 3}})
    seen = owner.call("POST", url + "/here", {"cursor": {"tab": "mixer"}})[1]
    assert [p["name"] for p in seen["people"]] == ["Jozsef"]
    assert seen["people"][0]["cursor"]["bar"] == 3
    seen = friend.call("POST", on + "/here", {"cursor": {}})[1]
    assert len(seen["people"]) == 1 and seen["people"][0]["cursor"]["tab"] == "mixer"


def test_somebody_without_a_share_cannot_reach_it(library):
    owner, friend, song, _ = _setup(library)
    assert friend.call("GET", "/api/shared/9999/on/songs/%d/daw" % song)[0] == 404


def test_a_friend_hears_the_owners_one_shots_in_the_project_only(library):
    from test_samples import _send
    owner, friend, song, share = _setup(library, with_share=True)
    a = _send(library, owner, "a.wav")[1]["sample"]["id"]
    b = _send(library, owner, "b.wav")[1]["sample"]["id"]
    project = {"format": "jriter-daw", "version": 9, "bpm": 120,
               "tracks": [{"name": "k", "sample": {"name": "a", "src": "/api/samples/%d/audio" % a}}]}
    owner.call("PUT", "/api/songs/%d/daw" % song, {"text": json.dumps(project), "base": 0})
    door = "/api/shared/%d/on/samples/%%d/audio" % share
    assert friend.call("GET", door % a)[0] == 200
    assert friend.call("GET", door % b)[0] == 404
