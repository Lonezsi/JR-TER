"""Previous, and what a phone says a song is called.

Two things reported against the player, and neither can be answered by reading it.

PREVIOUS DID NOTHING. Not always: only after autoplay had chosen something, which on an
evening of listening is almost immediately and from then on for ever. What plays next when a
list runs out is chosen by the server and handed over as a queue of one, so the index is 0
with nothing behind it. step(-1) worked out -1, found it out of range, and returned. A
button that does nothing and a button that is disabled look the same from the sofa.

A queue cannot fix this, because the whole point of what comes next is that it was never in
a list. So there is a history of where you have actually been, and the queue that was being
played at the time goes on it too: coming back into the middle of an album should leave Next
meaning the rest of that album.

THE PHONE SAID THE WRONG NAME. There was no Media Session code at all, and a browser with
nothing to go on falls back to the page title, which here is the library's name. So every
song on a lock screen, in a car, on a watch, was announced as "Lonezsi". The name is not
wrong, it is just not the title: it is the artist, and that is where it goes now.

HOW THESE RUN. tests/player_harness.js loads web/js/40-player.js unmodified and hands it a
page, a pair of decks and a network. Nothing is exported for the test's benefit. The decks
are stubs so that the queue, the history and the metadata can run for real.
"""
import json
import os
import shutil
import subprocess

import pytest

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
HARNESS = os.path.join(HERE, "player_harness.js")


@pytest.fixture(scope="module")
def played():
    node = shutil.which("node")
    assert node, (
        "node is not on PATH, so the player is not being run at all. These read what it"
        " did rather than what it says, which is the only way to answer either of the"
        " things they are about.")
    out = subprocess.run([node, HARNESS], capture_output=True, cwd=ROOT)
    assert out.returncode == 0, out.stderr.decode("utf-8", "replace")
    return json.loads(out.stdout.decode("utf-8"))


# ── going back ───────────────────────────────────────────────────────────────

def test_the_queue_still_answers_previous_inside_a_list(played):
    got = played["backInsideTheQueue"]
    assert got["song"] == "First Light" and got["index"] == 0, (
        "stepping back inside an album did not land on the track before: %s" % got)
    assert got["usedTheQueue"], \
        "the album's queue was replaced on the way back, so Next now means something else"


def test_previous_works_after_autoplay_has_chosen_something(played):
    """The reported bug, in the state it actually happens in.

    Autoplay leaves a queue of one and an index of zero, which is the arrangement that used
    to make Previous a dead control for the rest of the evening.
    """
    before = played["afterAutoplay"]
    assert before["queueLength"] == 1 and before["index"] == 0, (
        "autoplay no longer leaves a queue of one, so this test is no longer about the"
        " situation the bug happened in: %s" % before)
    assert before["history"] > 0, "nothing was remembered, so there is nowhere to go back to"

    got = played["backOutOfAutoplay"]
    assert got["song"] == "Second Wind", (
        "Previous after an autoplayed song went to %r. It used to go nowhere at all."
        % got["song"])


def test_coming_back_brings_the_list_back_with_it(played):
    """The song is not enough. Arriving back in the middle of an album with a queue of one
    still on the player leaves Next meaning nothing, which is half a fix."""
    got = played["backOutOfAutoplay"]
    assert got["queueLength"] == 2 and got["index"] == 1, (
        "came back to the right song with the wrong list: %s. Next would not continue the"
        " album." % got)


def test_it_keeps_going_back(played):
    """Once is a special case; twice is a history."""
    assert played["backTwice"]["song"] == "First Light", \
        "the second Previous did not move: %s" % played["backTwice"]


def test_walking_back_past_the_beginning_stops_rather_than_breaking(played):
    """Ten Previouses on a four song evening. The tenth should be a quiet no-op."""
    assert played["walkedBackTo"], "the player lost its song walking backwards"
    assert played["historyAtTheStart"] == 0, (
        "there is still history left after walking back further than there was anywhere to"
        " go, so something is putting entries back on as it goes")


def test_going_back_spends_the_history_rather_than_adding_to_it(played):
    """Otherwise Previous walks A, B, A, B instead of walking backwards.

    This was real, and it was introduced by the first version of the fix above. The queue
    answers Previous while there is something behind you in it, and that path was still
    remembering the song it left, so the next press popped that same song straight back off.
    Two songs, for ever, which is a worse Previous than one that did nothing.

    Said as depth rather than as a sequence of titles: the same song can legitimately be at
    two points in an evening, so a repeat is not proof of anything, and a stack that grows
    while you are going backwards is.
    """
    depths = played["historyDepths"]
    assert played["historyOnlyShrank"], (
        "the history grew while going back: %s. Something on the way back is remembering"
        " where it came from, which is what makes Previous oscillate." % depths)
    assert depths[0] > 0,         "there was no history to spend, so this test had nothing to watch: %s" % depths


# ── what the phone says ──────────────────────────────────────────────────────

def test_the_lock_screen_is_told_the_song_and_not_the_library(played):
    titles = played["system"]["titles"]
    assert titles, (
        "nothing was ever handed to the Media Session, so a phone falls back to the page"
        " title, which is the library's name. That is the bug this is about.")
    assert "Lonezsi" not in titles, (
        "the library's name is being sent as a song title again: %s" % titles)
    assert set(titles) <= {"First Light", "Second Wind", "Third Rail", "Fourth Wall"}, \
        "something other than a song title reached the lock screen: %s" % titles


def test_the_library_name_is_the_artist_rather_than_nothing(played):
    """It is not wrong, it is just not the title. The line it belongs on is the artist."""
    assert played["system"]["artists"] == ["Lonezsi"], (
        "the artist line says %s. The library's name is the closest thing this app has to"
        " an artist and it is what the phone showed before, so throwing it away entirely"
        " would be a different kind of wrong." % played["system"]["artists"])


def test_the_buttons_that_are_not_on_the_page_are_wired(played):
    """A lock screen, a headset, a car. Registering none of them is the state this was in."""
    got = set(played["system"]["handlers"])
    for want in ("play", "pause", "previoustrack", "nexttrack"):
        assert want in got, (
            "%s is not handled, so that button on a lock screen does nothing: %s"
            % (want, sorted(got)))


def test_the_lock_screens_previous_is_the_same_previous(played):
    """Two implementations of going back is two things to keep in step, and the one nobody
    can see from a desk is the one that would drift."""
    got = played.get("lockScreenPrevious")
    assert got, "the previoustrack handler was never registered, so it was not exercised"
    assert got["to"] == got["wentBackTo"], (
        "the lock screen's Previous went to %r and the player's own went to %r"
        % (got["to"], got["wentBackTo"]))


def test_the_scrubber_is_never_handed_something_impossible(played):
    """setPositionState throws on a position past the duration, or on no duration at all,
    and a throw here would take the rest of the redraw with it."""
    assert played["system"]["positionsLookSane"], \
        "a position outside its own duration was sent to the system"
