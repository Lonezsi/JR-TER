"""Voices recorded over a song, by the owner and by anybody it is shared with.

The rule that matters: the owner may do anything with any take, and a guest may change or
delete only the takes they recorded. Over real HTTP with real accounts, through the shared
doorway, because that is the only way a guest reaches a take at all.
"""
import urllib.error
import urllib.request

from test_two_people_over_http import library, _owner_and_friend   # noqa: F401

VOICE = b"OggS" + b"\x00" * 200          # the bytes do not have to decode to be kept


def _record(client, who, path, name="take.ogg", offset=12.5):
    request = urllib.request.Request(client.base + path, data=VOICE, method="POST", headers={
        "Cookie": who.cookie, "Content-Type": "application/octet-stream",
        "X-Filename": name, "X-Offset": str(offset), "X-Duration": "3"})
    try:
        with urllib.request.urlopen(request, timeout=20) as answer:
            import json
            return answer.status, json.loads(answer.read())
    except urllib.error.HTTPError as e:
        return e.code, {}


def _setup(library):
    owner, friend = _owner_and_friend(library)
    status, made = owner.call("POST", "/api/songs", {"title": "s"})
    song = made["song"]["id"]
    status, shared = owner.call("POST", "/api/shares", {"song": song, "handle": "jozsef"})
    on = lambda rest: "/api/shared/%d/on/%s" % (shared["share"], rest)   # noqa: E731
    return owner, friend, song, on


def test_the_owner_records_and_the_take_starts_where_it_was_recorded(library):
    owner, friend, song, on = _setup(library)
    status, made = _record(library, owner, "/api/songs/%d/vocals" % song)
    assert status == 200, made
    take = made["take"]
    assert take["offset"] == 12.5 and take["yours"] and take["enabled"] == 1
    status, listed = owner.call("GET", "/api/songs/%d/vocals" % song)
    assert [t["id"] for t in listed["takes"]] == [take["id"]]


def test_a_guest_records_onto_the_owners_song_credited_to_them(library):
    owner, friend, song, on = _setup(library)
    status, made = _record(library, friend, on("songs/%d/vocals" % song))
    assert status == 200, made
    status, listed = owner.call("GET", "/api/songs/%d/vocals" % song)
    take = listed["takes"][0]
    assert take["by_handle"] == "jozsef" and not take["yours"], take


def test_a_guest_cannot_delete_or_change_somebody_elses_take(library):
    owner, friend, song, on = _setup(library)
    status, made = _record(library, owner, "/api/songs/%d/vocals" % song)
    take = made["take"]["id"]
    assert friend.call("DELETE", on("vocals/%d" % take))[0] == 403
    assert friend.call("PATCH", on("vocals/%d" % take), {"enabled": False})[0] == 403
    status, listed = owner.call("GET", "/api/songs/%d/vocals" % song)
    assert listed["takes"][0]["enabled"] == 1


def test_a_guest_can_delete_their_own(library):
    owner, friend, song, on = _setup(library)
    status, made = _record(library, friend, on("songs/%d/vocals" % song))
    take = made["take"]["id"]
    assert friend.call("PATCH", on("vocals/%d" % take), {"name": "mine"})[0] == 200
    assert friend.call("DELETE", on("vocals/%d" % take))[0] == 200
    status, listed = owner.call("GET", "/api/songs/%d/vocals" % song)
    assert listed["takes"] == []


def test_the_owner_can_delete_anybodys(library):
    owner, friend, song, on = _setup(library)
    status, made = _record(library, friend, on("songs/%d/vocals" % song))
    assert owner.call("DELETE", "/api/vocals/%d" % made["take"]["id"])[0] == 200


def test_a_take_downloads_as_itself(library):
    owner, friend, song, on = _setup(library)
    status, made = _record(library, owner, "/api/songs/%d/vocals" % song, name="verse.ogg")
    request = urllib.request.Request(
        library.base + "/api/vocals/%d/audio?download=1" % made["take"]["id"],
        headers={"Cookie": owner.cookie})
    with urllib.request.urlopen(request, timeout=20) as answer:
        assert answer.read() == VOICE
        assert "verse.ogg" in (answer.headers.get("Content-Disposition") or "")


def test_a_guest_cannot_reach_takes_on_another_song(library):
    owner, friend, song, on = _setup(library)
    status, other = owner.call("POST", "/api/songs", {"title": "private"})
    status, made = _record(library, owner, "/api/songs/%d/vocals" % other["song"]["id"])
    assert friend.call("GET", on("vocals/%d/audio" % made["take"]["id"]))[0] == 404
    assert _record(library, friend, on("songs/%d/vocals" % other["song"]["id"]))[0] == 404


# ── the page ─────────────────────────────────────────────────────────────────
import io
import os

WEB = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "web", "js")


def _src(name):
    return io.open(os.path.join(WEB, name), encoding="utf-8").read()


def test_the_layers_follow_the_audio_and_not_the_screen():
    """The player's own position is kept by the paint loop, which stops in a tab that is
    not being drawn: a phone with the screen off. Measured: it sat at 0:00.9 while the song
    looped three times. Everything that follows the music reads the audio's clock."""
    vox = _src("64-panel-vocals.js")
    assert "J.player.state.position" not in vox, "the layers follow the paint loop again"
    assert vox.count("J.player.now()") >= 3
    assert "now() {" in _src("40-player.js")


def test_nothing_runs_while_the_song_is_not_playing():
    """No timer, no decoding, no CPU unless this song is the one playing."""
    vox = _src("64-panel-vocals.js")
    watch = vox[vox.index("function watch() {"):vox.index("J.on(\"player:change\"")]
    assert "if (!here()) { stopAll(); return; }" in watch, "the watcher runs with nothing playing"


def test_each_pass_round_the_loop_is_its_own_take():
    vox = _src("64-panel-vocals.js")
    loop = vox[vox.index("rec.loop = setInterval("):vox.index("draw();\n  }\n\n  function stop()")]
    assert "rec.recorder.stop();" in loop and "rec.recorder = segment();" in loop
    assert 'J.player.state.repeat = "one"' in vox, "the song does not loop while recording"


def test_a_take_is_placed_earlier_by_the_latency_it_was_recorded_through():
    vox = _src("64-panel-vocals.js")
    assert "outputLatency" in vox and "Math.max(0, J.player.now() - lag)" in vox


def test_guests_are_offered_deleting_only_their_own():
    vox = _src("64-panel-vocals.js")
    assert "const mayChange = (t) => t.yours || !J.sharedAs;" in vox
