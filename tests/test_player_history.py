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

HOW THESE RUN. They used to run the real player under node, with stub decks. The player is
a rune-based TypeScript module now (ui/src/lib/player.svelte.ts), which node cannot load
without the build, so these read its source instead. That is a weaker kind of test, and
what it pins down is each decision that was once got wrong, not the arithmetic.
"""
import os
import re

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def player():
    with open(os.path.join(HERE, "ui", "src", "lib", "player.svelte.ts"), encoding="utf-8") as f:
        return f.read()


def code(source):
    source = re.sub(r"/\*.*?\*/", "", source, flags=re.S)
    return re.sub(r"^\s*//.*$", "", source, flags=re.M)


def function(name):
    """The body of one top level function, comments out."""
    source = code(player())
    start = re.search(r"^(?:export )?(?:async )?function %s\(" % name, source, flags=re.M)
    assert start, "no function %s in the player" % name
    return source[start.start():source.index("\n}\n", start.start())]


# ── going back ───────────────────────────────────────────────────────────────

def test_the_queue_still_answers_previous_inside_a_list():
    body = function("step")
    # Inside the list, the queue is handed back to the player unchanged, so Next still
    # means the rest of the album.
    assert "await playSong(item as Song, player.queue)" in body
    assert "await playRender(item as Render, player.queue)" in body


def test_previous_works_after_autoplay_has_chosen_something():
    """The reported bug, in the state it actually happens in.

    Autoplay leaves a queue of one and an index of zero, which is the arrangement that used
    to make Previous a dead control for the rest of the evening. Off the front of the queue
    is the history's question, so that has to be the first thing step() asks.
    """
    body = function("step")
    assert "if (delta < 0 && player.index + delta < 0) return back();" in body
    assert body.index("return back();") < body.index("if (!player.queue.length) return;"), \
        "the queue is asked before the history, and an empty queue ends the question"
    assert "playSong(" in function("keepGoing"), \
        "autoplay no longer goes through the player, so what it leaves behind has changed"


def test_coming_back_brings_the_list_back_with_it():
    """The song is not enough. Arriving back in the middle of an album with a queue of one
    still on the player leaves Next meaning nothing, which is half a fix."""
    assert "history.push({ entry, kind: player.queueKind, queue: player.queue.slice() });" \
        in function("remember")
    back = function("back")
    assert "playSong(was.entry as Song, was.queue)" in back
    assert "playRender(was.entry as Render, was.queue)" in back


def test_it_keeps_going_back():
    """Once is a special case; twice is a history: back() pops one entry and nothing else."""
    back = function("back")
    assert "history.pop()" in back and "history.shift" not in back


def test_walking_back_past_the_beginning_stops_rather_than_breaking():
    """Ten Previouses on a four song evening. The tenth should be a quiet no-op."""
    assert "if (!was) return;" in function("back"), \
        "an empty history does something other than nothing"


def test_going_back_spends_the_history_rather_than_adding_to_it():
    """Otherwise Previous walks A, B, A, B instead of walking backwards.

    This was real, and it was introduced by the first version of the fix above. The queue
    answers Previous while there is something behind you in it, and that path was still
    remembering the song it left, so the next press popped that same song straight back off.
    Both routes back (the queue's and the history's) have to say so before they play.
    """
    assert "if (goingBack || !entry) return;" in function("remember")
    step = function("step")
    assert "if (delta < 0) goingBack = true;" in step
    assert "goingBack = was;" in step, "and the flag is put back afterwards"
    back = function("back")
    assert "goingBack = true;" in back and "goingBack = false;" in back


def test_the_history_is_bounded():
    assert "while (history.length > HISTORY) history.shift();" in function("remember")
    assert int(re.search(r"const HISTORY = (\d+);", player()).group(1)) >= 10


# ── what the phone says ──────────────────────────────────────────────────────

def test_the_lock_screen_is_told_the_song_and_not_the_library():
    body = function("tellTheSystem")
    assert 'title: player.song.title || ""' in body, (
        "the song's title is not handed to the Media Session, so a phone falls back to the"
        " page title, which is the library's name. That is the bug this is about.")
    assert "title: app.name" not in body


def test_the_library_name_is_the_artist_rather_than_nothing():
    """It is not wrong, it is just not the title. The line it belongs on is the artist."""
    assert 'artist: app.name || "JR!TER"' in function("tellTheSystem")


def test_the_lock_screen_is_cleared_when_nothing_is_playing():
    body = function("tellTheSystem")
    assert "if (!player.song) {" in body and "session.metadata = null;" in body


def test_the_buttons_that_are_not_on_the_page_are_wired():
    """A lock screen, a headset, a car. Registering none of them is the state this was in."""
    source = code(player())
    for want in ("play", "pause", "previoustrack", "nexttrack", "seekbackward",
                 "seekforward", "seekto"):
        assert re.search(r"^\s*%s: " % want, source, flags=re.M), (
            "%s is not handled, so that button on a lock screen does nothing" % want)
    assert "setActionHandler(name as MediaSessionAction, run)" in source
    assert "catch { /* not known here */ }" in player(), (
        "an engine that does not know one action throws, and that must not stop the others")


def test_the_lock_screens_previous_is_the_same_previous():
    """Two implementations of going back is two things to keep in step, and the one nobody
    can see from a desk is the one that would drift. Both end in step(-1)."""
    assert "previoustrack: () => step(-1)," in code(player())
    assert "else step(-1);" in function("previous")


def test_the_scrubber_is_never_handed_something_impossible():
    """setPositionState throws on a position past the duration, or on no duration at all,
    and a throw here would take the rest of the redraw with it."""
    body = function("tellTheSystem")
    assert "Number.isFinite(player.duration) && player.duration > 0" in body
    assert "position: clamp(now(), 0, player.duration)" in body
    assert re.search(r"try \{\s*session\.setPositionState", body)


# ── the lock screen's own controls ───────────────────────────────────────────

def test_the_lock_screen_scrubber_lands_where_it_was_dragged():
    """It speaks seconds, and the player's seek takes a fraction of the song.

    They were handed straight across, so dragging the lock screen scrubber to 0:30 asked
    for thirty times the length of the song, which clamps to the end: the track finished
    and autoplay moved on to the next one. So it goes through seekTo, which takes seconds.
    """
    source = code(player())
    assert 'seekto: (d) => { if (typeof d?.seekTime === "number") seekTo(d.seekTime); },' in source
    assert re.search(r"export (?:async )?function seekTo\(", source), "there is no seek in seconds"


def test_the_ten_second_buttons_move_ten_seconds():
    source = code(player())
    assert "seekTo(Math.max(0, now() - (d?.seekOffset || 10)))" in source
    assert "seekTo(Math.min(player.duration, now() + (d?.seekOffset || 10)))" in source


def test_play_and_pause_each_mean_one_thing():
    """Both toggled. A play arriving while already playing, from a headset, a car or a
    second device, paused the song, and a second pause started it again."""
    source = code(player())
    assert "play: () => { if (!player.playing) toggle(); }," in source
    assert "pause: () => { if (player.playing) toggle(); }," in source
