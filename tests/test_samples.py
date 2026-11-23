"""Your own one-shots: uploaded once, listed by folder, served back, hidden by delete and
brought back by restore, and nobody else's."""
import json
import urllib.error
import urllib.request

from test_two_people_over_http import library, _owner_and_friend   # noqa: F401

KICK = b"RIFF" + b"\x00" * 60            # the bytes do not have to decode to be kept


def _send(client, who, name="kick.wav", folder="Kicks", body=KICK):
    head = {"Cookie": who.cookie, "Content-Type": "application/octet-stream",
            "X-Filename": name, "X-Duration": "0.4"}
    if folder is not None:
        head["X-Folder"] = folder
    request = urllib.request.Request(client.base + "/api/samples", data=body, method="POST", headers=head)
    try:
        with urllib.request.urlopen(request, timeout=20) as answer:
            return answer.status, json.loads(answer.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"{}")


def test_a_one_shot_is_kept_listed_and_played_back(library):
    owner, friend = _owner_and_friend(library)
    status, made = _send(library, owner)
    assert status == 200 and made["sample"]["name"] == "kick" and made["sample"]["folder"] == "Kicks"
    sid = made["sample"]["id"]
    status, listed = owner.call("GET", "/api/samples")
    assert [s["name"] for s in listed["samples"]] == ["kick"]
    status, bytes_ = owner.call("GET", "/api/samples/%d/audio" % sid)
    assert status == 200 and bytes_ == KICK
    assert _send(library, owner)[1]["duplicate"] is True      # the same file again is not a second copy
    assert len(owner.call("GET", "/api/samples")[1]["samples"]) == 1
    assert _send(library, owner, "kick.wav", "Other")[1]["duplicate"] is False


def test_only_sounds_are_kept(library):
    owner, _ = _owner_and_friend(library)
    assert _send(library, owner, "virus.exe")[0] == 400
    assert _send(library, owner, "kick.wav", body=b"")[0] == 400


def test_delete_hides_it_and_restore_brings_it_back(library):
    owner, _ = _owner_and_friend(library)
    sid = _send(library, owner)[1]["sample"]["id"]
    assert owner.call("DELETE", "/api/samples/%d" % sid)[0] == 200
    assert owner.call("GET", "/api/samples")[1]["samples"] == []
    assert owner.call("GET", "/api/samples/%d/audio" % sid)[0] == 200    # an open project keeps playing
    assert owner.call("POST", "/api/samples/%d/restore" % sid)[0] == 200
    assert len(owner.call("GET", "/api/samples")[1]["samples"]) == 1
    status, said = owner.call("PATCH", "/api/samples/%d" % sid, {"name": "boom", "folder": "Hits"})
    assert said["sample"]["name"] == "boom" and said["sample"]["folder"] == "Hits"


def test_somebody_elses_library_has_none_of_it(library):
    owner, friend = _owner_and_friend(library)
    sid = _send(library, owner)[1]["sample"]["id"]
    assert friend.call("GET", "/api/samples")[1]["samples"] == []
    assert friend.call("GET", "/api/samples/%d/audio" % sid)[0] == 404


def test_a_midi_file_is_kept_with_its_whole_folder_path(library):
    """A pack's MIDI melodies live next to its hits, deep in folders: both are kept."""
    owner, _ = _owner_and_friend(library)
    deep = "Cymatics - Phoenix Rebirth / 1 Melody Loop Collection / Loop Stems & MIDI / Aphrodite - 136 BPM D# Min"
    assert len(deep) > 80
    status, made = _send(library, owner, "Aphrodite.mid", deep, body=b"MThd" + b"\x00" * 20)
    assert status == 200, made
    assert made["sample"]["ext"] == ".mid" and made["sample"]["folder"] == deep, made
    sid = made["sample"]["id"]
    status, moved = owner.call("PATCH", "/api/samples/%d" % sid, {"folder": deep + " / Moved"})
    assert status == 200 and moved["sample"]["folder"] == deep + " / Moved"
