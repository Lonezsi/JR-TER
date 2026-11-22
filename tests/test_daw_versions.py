"""A bounced version keeps the DAW project it was made from, and it opens again from there."""
import json

from test_two_people_over_http import library, _owner_and_friend   # noqa: F401


def _project(bpm=120):
    return json.dumps({"format": "jriter-daw", "version": 8, "bpm": bpm, "tracks": []})


def test_a_version_keeps_its_project(library, wav):
    owner, friend = _owner_and_friend(library)
    song = owner.call("POST", "/api/songs", {"title": "s"})[1]["song"]["id"]
    status, said = owner.client.upload("/api/songs/%d/versions" % song, wav(),
                                       headers={"Cookie": owner.cookie})
    assert status == 200
    vid = said["version"]["id"]
    url = "/api/versions/%d/daw" % vid

    assert owner.call("GET", url)[0] == 404
    assert owner.call("PUT", url, {"text": "nope"})[0] == 400
    assert owner.call("PUT", url, {"text": _project(97)})[1]["ok"] is True

    got = owner.call("GET", url)[1]
    assert got["n"] == 1 and json.loads(got["text"])["bpm"] == 97

    listed = owner.call("GET", "/api/songs/%d/versions" % song)[1]["versions"]
    assert listed[0]["has_daw"] is True and "daw" not in listed[0]

    # somebody else's library cannot see it
    assert friend.call("GET", url)[0] in (403, 404)
