"""Dropping bounces on the app.

WHAT THESE ARE ABOUT. Not "does it upload", which is one line and would pass on the day it
uploads the same file four times. They are about the things a drop target gets wrong in
ways nobody notices until a folder of takes is involved: a flicker as the drag crosses the
page, files sent all at once so nothing finishes, a picture quietly uploaded as audio, and
a browser navigating away from the app because it decided to open the file itself.

The old versions of these ran the real handler under node against a stubbed document. The
handler is a Svelte component and a rune-based module now, which node cannot run without
the build, so these read the source in ui/src instead (views/Inbox.svelte for the drop
target, views/inbox/uploads.svelte.ts for the upload queue). That is a weaker kind of test
and is said so here; what they pin down is each decision that was once got wrong.
"""
import io
import os
import re

import pytest

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SRC = os.path.join(ROOT, "ui", "src")

from jriter import config   # noqa: E402


def read(*parts):
    return io.open(os.path.join(SRC, *parts), encoding="utf-8").read()


def queue():
    return read("views", "inbox", "uploads.svelte.ts")


def target():
    source = read("views", "Inbox.svelte")
    at = source.index("// ── uploads and drops")
    return source[at:source.index("// ── staying current", at)]


def test_every_dropped_file_is_uploaded_to_the_renders_inbox():
    source = queue()
    assert 'uploadWithProgress("/api/renders", job.file, job.file.name' in source, (
        "a dropped file goes somewhere other than the renders inbox. A drop on the inbox"
        " always means the same thing.")
    assert "takeFiles(Array.from(e.dataTransfer?.files || []))" in target()


def test_they_go_up_one_at_a_time():
    """A handful of bounces is a couple of hundred megabytes.

    A browser given ten of those at once spends the whole time swapping between them: the
    last finishes no sooner and the first finishes much later, so there is nothing to
    listen to until the entire batch is done.

    Asked of the source, because "did these overlap" is not a question the list of calls
    can answer.
    """
    source = queue()
    take = source[source.index("export async function takeFiles"):source.index("const queue:")]
    assert "await uploadWithProgress(" in take, "nothing waits for an upload to finish"
    assert "for (let job = queue.shift(); job; job = queue.shift())" in take
    assert "Promise.all" not in take and "audio.map(async" not in take, \
        "the batch is sent all at once"
    assert "if (uploads.busy) return;" in take, \
        "a second drop starts a second queue beside the first instead of joining it"


def test_what_is_not_audio_is_not_uploaded_and_is_counted():
    """Counted rather than passed over in silence. Somebody who dragged a folder in wants
    to know that the artwork in it did not become a render."""
    take = queue()
    assert "const audio = files.filter((f) => kinds.some((ext) => f.name.toLowerCase().endsWith(ext)));" in take
    assert "const rest = files.length - audio.length;" in take
    assert "restNotAudio" in take and "not audio" in take


def test_a_drop_of_nothing_but_pictures_says_so_and_sends_nothing():
    take = queue()
    at = take.index("if (!audio.length) {")
    refusal = take[at:take.index("}", at)]
    assert "toast(" in refusal, "a drop that did nothing at all said nothing at all"
    assert "return;" in refusal, "and it went on to upload"


def test_what_counts_as_audio_is_the_servers_answer():
    """A second list of extensions in the page is a list that disagrees with the real one
    the week somebody adds a format, and the disagreement shows up as a file that vanishes
    when it is dropped."""
    renders = read("views", "inbox", "renders.ts")
    assert 'get("/api/state")' in renders and "state.audio" in renders, (
        "the page decides what audio is on its own, so it can disagree with the server")
    assert "await audioKinds()" in queue()

    # And the server actually sends it, which is the other half of the same sentence.
    from jriter.modules import core
    sent = core.state(None)
    assert set(sent["audio"]) == set(config.AUDIO_EXT), (
        "the state the page reads does not carry the server's own list: %s" % sent.get("audio"))


def test_the_same_bounce_twice_is_not_a_failure():
    """A render is its audio, so dropping the same file again is one render, not two and
    not an error. Somebody who has just dropped a folder for the second time wants to be
    told that rather than left wondering what went wrong."""
    take = queue()
    assert 'job.row.state = "dupe"; already++;' in take
    assert "already here" in take
    assert "if (out.added) emit(" in take, "an unchanged file announced itself as new"
    assert 'toast(said.join(", "), failed.length ? "bad" : "")' in take, \
        "only a real failure is reported as one"


def test_one_upload_failing_does_not_stop_the_rest():
    """The one in the middle of a folder that is half written, most likely. The others are
    fine and there is no reason for them to be left behind it."""
    take = queue()
    loop = take[take.index("for (let job = queue.shift()"):take.index("uploads.busy = false;")]
    assert "try {" in loop and "} catch (e) {" in loop, "a failure ends the whole batch"
    assert 'job.row.state = "failed";' in loop
    assert "failed.push(" in loop and "failed.forEach((why) => toast(why" in take, \
        "the failure is not named"
    assert "break" not in loop and "return" not in loop.split("catch")[1], \
        "the failure stops the loop"


def test_the_browser_is_stopped_from_opening_the_file_itself():
    """Which navigates away from the app, losing whatever was on the screen.

    Both events, not just the drop: a browser that was never told during dragover has
    already decided by the time the drop arrives.
    """
    handlers = target()
    assert re.search(r"const over = \(e: DragEvent\) => \{ if \(files\(e\)\) e\.preventDefault\(\); \}", handlers), \
        "the drag was not claimed, so the drop opens the file"
    drop = handlers[handlers.index("const drop ="):handlers.index('document.addEventListener("dragenter"')]
    assert "e.preventDefault();" in drop


def test_a_drag_that_is_not_carrying_files_is_left_alone():
    """Dragging a lyric line, a render row or a bit of selected text fires all of these
    too. An overlay thrown over the page every time somebody moves a card would make the
    app unusable while doing nothing, and claiming the drag stops the page's own drag and
    drop from working."""
    handlers = target()
    assert 'Array.from(e.dataTransfer.types || []).includes("Files")' in handlers
    for name in ("enter", "over", "leave", "drop"):
        line = handlers[handlers.index("const %s = " % name):]
        line = line[:line.index("\n    const ") if "\n    const " in line else 400]
        assert "files(e)" in line, "the %s handler does not check for files first" % name


def test_the_sheet_comes_up_while_a_file_is_over_the_window():
    source = read("views", "Inbox.svelte")
    assert "{#if dragging}" in source and "Drop to add to the inbox" in source, \
        "nothing says where the file is about to land"
    assert "const enter = (e: DragEvent) => { if (files(e)) { deep++; dragging = true; } };" in target()


def test_crossing_the_page_does_not_flicker_it():
    """dragenter and dragleave both fire at every element boundary on the way in.

    A flag set on one and cleared on the other blinks the whole way across the page, and
    the sheet is the largest thing on the screen. So the depth is counted: three steps in
    and two steps out is still inside.
    """
    handlers = target()
    assert "deep++" in handlers and "--deep <= 0" in handlers, "the depth is not counted"
    assert "let deep = 0;" in handlers


def test_the_sheet_always_goes_away_again():
    """Including after a drop, and including after one that failed. A full screen sheet
    that outlives its drag is an app you cannot click."""
    handlers = target()
    drop = handlers[handlers.index("const drop ="):handlers.index('document.addEventListener("dragenter"')]
    assert "deep = 0; dragging = false;" in drop, "a drop leaves the sheet up"
    assert "takeFiles(" in drop and drop.index("dragging = false") < drop.index("takeFiles("), \
        "the sheet is put away only after the upload has finished"
    cleanup = handlers[handlers.index("return () => {"):]
    assert 'removeEventListener("drop", drop)' in cleanup and "dragging = false;" in cleanup, \
        "leaving the screen mid-drag leaves the sheet up"


def test_the_renders_screen_is_told_when_one_lands():
    """It is the screen that shows them, and the only one that has to know."""
    take = queue()
    assert 'emit("renders:changed")' in take
    assert "if (added) emit(" in take, "nothing is announced only when something landed"


def test_nothing_is_announced_when_nothing_landed():
    take = queue()
    for line in [l for l in take.splitlines() if 'emit("renders:changed")' in l]:
        assert "added" in line or "out.added" in line, (
            "every screen is told to redraw over a drop that added nothing: %s" % line.strip())


def test_a_file_dropped_on_any_screen_does_not_open_in_the_browser():
    """Inbox and Song handle their own drops; App.svelte has a window-level handler that
    refuses whatever nothing claimed."""
    app = read("App.svelte")
    assert 'addEventListener("dragover"' in app and 'addEventListener("drop"' in app
    assert "preventDefault" in app
