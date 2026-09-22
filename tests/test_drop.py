"""Dropping bounces on the app, checked by running the real handler.

WHAT THESE ARE ABOUT. Not "does it upload", which is one line and would pass on the day it
uploads the same file four times. They are about the things a drop target gets wrong in
ways nobody notices until a folder of takes is involved: a flicker as the drag crosses the
page, files sent all at once so nothing finishes, a picture quietly uploaded as audio, and
a browser navigating away from the app because it decided to open the file itself.

The handler runs under node, through tests/drop_harness.js, with a document stubbed down
to the five things it actually uses.
"""
import io
import json
import os
import shutil
import subprocess
import sys

import pytest

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, ROOT)

HARNESS = os.path.join(HERE, "drop_harness.js")
SRC = os.path.join(ROOT, "web", "js", "26-drop.js")

from jriter import config   # noqa: E402


def dropped(steps, answers=None, hash_="#/library"):
    node = shutil.which("node")
    if not node:
        pytest.fail("node is not on PATH, so the drop handler is not being run at all")
    script = json.dumps({"steps": steps, "answers": answers or {}, "hash": hash_})
    out = subprocess.run([node, HARNESS, script], capture_output=True, cwd=ROOT)
    assert out.returncode == 0, out.stderr.decode("utf-8", "replace")
    return json.loads(out.stdout.decode("utf-8"))


TWO = ["One.wav", "Two.mp3"]


def test_every_dropped_file_is_uploaded():
    got = dropped([{"event": "drop", "files": TWO}])
    assert [u["name"] for u in got["uploaded"]] == TWO, got["uploaded"]
    for sent in got["uploaded"]:
        assert sent["where"] == "/api/renders", (
            "a dropped file went to %s. A drop always means the same thing, whatever"
            " screen is up behind it." % sent["where"])


def test_they_go_up_one_at_a_time():
    """A handful of bounces is a couple of hundred megabytes.

    A browser given ten of those at once spends the whole time swapping between them: the
    last finishes no sooner and the first finishes much later, so there is nothing to
    listen to until the entire batch is done.

    Asked of the source, because "did these overlap" is not a question the list of calls
    can answer: the harness's upload resolves immediately either way.
    """
    source = io.open(SRC, encoding="utf-8").read()
    take = source[source.index("async function take(files) {"):]
    take = take[:take.index("\n  }")]
    assert "await J.upload" in take, "nothing waits for an upload to finish"
    assert "Promise.all" not in take and "map(" not in take.split("audio.length")[0], (
        "the batch is sent all at once: %s" % take.strip()[:200])


def test_what_is_not_audio_is_not_uploaded():
    """And is counted rather than passed over in silence. Somebody who dragged a folder in
    wants to know that the artwork in it did not become a render."""
    got = dropped([{"event": "drop", "files": ["One.wav", "cover.jpg", "notes.txt"]}])
    assert [u["name"] for u in got["uploaded"]] == ["One.wav"], got["uploaded"]
    assert any("2" in said and "nem hangf" in said for said in got["toasts"]), (
        "nothing said that two of the files were left out: %s" % got["toasts"])


def test_a_drop_of_nothing_but_pictures_says_so_and_sends_nothing():
    got = dropped([{"event": "drop", "files": ["cover.jpg"]}])
    assert not got["uploaded"]
    assert got["toasts"], "a drop that did nothing at all said nothing at all"


def test_what_counts_as_audio_is_the_servers_answer():
    """A second list of extensions in the page is a list that disagrees with the real one
    the week somebody adds a format, and the disagreement shows up as a file that vanishes
    when it is dropped."""
    source = io.open(SRC, encoding="utf-8").read()
    assert "J.state && J.state.audio" in source, (
        "the page decides what audio is on its own, so it can disagree with the server")

    # And the server actually sends it, which is the other half of the same sentence.
    from jriter.modules import core
    sent = core.state(None)
    assert set(sent["audio"]) == set(config.AUDIO_EXT), (
        "the state the page reads does not carry the server's own list: %s" % sent.get("audio"))


def test_the_same_bounce_twice_is_not_a_failure():
    """A render is its audio, so dropping the same file again is one render, not two and
    not an error. Somebody who has just dropped a folder for the second time wants to be
    told that rather than left wondering what went wrong."""
    got = dropped([{"event": "drop", "files": TWO}],
                  answers={"One.wav": "already", "Two.mp3": "already"})
    said = " ".join(got["toasts"])
    assert "már megvolt" in said, said
    assert "[bad]" not in said, "the same file twice was reported as a failure: %s" % said


def test_one_upload_failing_does_not_stop_the_rest():
    """The one in the middle of a folder that is half written, most likely. The others are
    fine and there is no reason for them to be left behind it."""
    got = dropped([{"event": "drop", "files": ["One.wav", "Bad.wav", "Three.flac"]}],
                  answers={"Bad.wav": "fail"})
    assert [u["name"] for u in got["uploaded"]] == ["One.wav", "Bad.wav", "Three.flac"]
    said = " ".join(got["toasts"])
    assert "Bad.wav" in said and "[bad]" in said, said
    assert "2 render" in said, "the two that worked were not reported: %s" % said


def test_the_browser_is_stopped_from_opening_the_file_itself():
    """Which navigates away from the app, losing whatever was on the screen.

    Both events, not just the drop: a browser that was never told during dragover has
    already decided by the time the drop arrives.
    """
    got = dropped([{"event": "dragover", "files": TWO},
                   {"event": "drop", "files": TWO}])
    assert got["dragoverPrevented"], "the drag was not claimed, so the drop opens the file"
    assert got["dropPrevented"]


def test_a_drag_that_is_not_carrying_files_is_left_alone():
    """Dragging a lyric line, a render row or a bit of selected text fires all of these
    too. An overlay thrown over the page every time somebody moves a card would make the
    app unusable while doing nothing."""
    got = dropped([{"event": "dragenter", "plain": True, "then": "look"},
                   {"event": "dragover", "plain": True},
                   {"event": "drop", "plain": True}])
    assert got["overlays"] == 0, "a drag of plain text put the drop sheet up"
    assert not got["uploaded"]
    assert not got["dragoverPrevented"], (
        "a drag that is not ours is being claimed anyway, which stops the page's own"
        " drag and drop from working")


def test_the_sheet_comes_up_while_a_file_is_over_the_window():
    got = dropped([{"event": "dragenter", "files": TWO, "then": "look"}])
    assert got["overlays"] == 1, "nothing said where the file was about to land"
    assert "Renders" in got["said"], got["said"]


def test_crossing_the_page_does_not_flicker_it():
    """dragenter and dragleave both fire at every element boundary on the way in.

    A flag set on one and cleared on the other blinks the whole way across the page, and
    the sheet is the largest thing on the screen. So the depth is counted, and this is
    what tells the two apart: three steps in and two steps out is still inside.
    """
    got = dropped([{"event": "dragenter", "files": TWO},
                   {"event": "dragenter", "files": TWO},
                   {"event": "dragenter", "files": TWO},
                   {"event": "dragleave", "files": TWO},
                   {"event": "dragleave", "files": TWO, "then": "look"}])
    assert got["overlays"] == 1, (
        "the sheet went away while the file was still over the window")

    out = dropped([{"event": "dragenter", "files": TWO},
                   {"event": "dragleave", "files": TWO, "then": "look"}])
    assert out["overlays"] == 0, "the sheet stayed up after the file left the window"


def test_the_sheet_always_goes_away_again():
    """Including after a drop, and including after one that failed. A full screen sheet
    that outlives its drag is an app you cannot click."""
    got = dropped([{"event": "dragenter", "files": TWO},
                   {"event": "drop", "files": TWO}],
                  answers={"One.wav": "fail", "Two.mp3": "fail"})
    assert got["overlaysAtEnd"] == 0, "the drop sheet is still up"


def test_the_renders_screen_is_told_when_one_lands():
    """It is the screen that shows them, and the only one that has to know."""
    got = dropped([{"event": "drop", "files": TWO}])
    assert "renders:changed" in got["emitted"], got["emitted"]

    on_renders = dropped([{"event": "drop", "files": TWO}], hash_="#/renders")
    assert on_renders["reloaded"] == 1, (
        "renders were dropped onto the renders screen and it did not redraw")


def test_nothing_is_announced_when_nothing_landed():
    got = dropped([{"event": "drop", "files": TWO}],
                  answers={"One.wav": "fail", "Two.mp3": "fail"})
    assert "renders:changed" not in got["emitted"], (
        "every screen was told to redraw over two failed uploads")
