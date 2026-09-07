"""The desktop agent, which is the half of JR!TER nobody is watching.

Every test here exists because the thing it checks was broken and said nothing. The watch
loop is the only genuinely unattended path in the project: it runs from a scheduled task at
logon, it has a broad `except Exception` around its body so that a restarted server does not
kill it, and the consequence of that is a bug in the loop looks exactly like a quiet
afternoon with no new renders.

Two of them were live at the same time:

  * survey() returns (path, digest) pairs and the loop bound the whole pair to `path`, so
    send_render called os.path.basename on a tuple
  * flrender was imported inside cmd_render, which makes it a local of cmd_render, so
    send_render's own lookup of the name raised NameError

Either one alone means the watcher has never once sent a render. Nothing failed, nothing
was logged where anybody would look, and the folder simply stayed full.
"""
import os
import sys
import math
import wave
import struct

import pytest

CLIENT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "client")
if CLIENT not in sys.path:
    sys.path.insert(0, CLIENT)

jriter_client = pytest.importorskip("jriter_client")


def _wav(path, seconds=0.1):
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(8000)
        w.writeframes(b"".join(struct.pack("<h", int(math.sin(i / 20.0) * 9000))
                               for i in range(int(8000 * seconds))))
    return str(path)


class Recorder:
    """A library that holds nothing and writes down what it is sent."""

    def __init__(self, suggest=None):
        self.sent = []
        self.made = []
        self.suggest = suggest

    def get(self, path):
        if "versions/have" in path:
            return {"have": {}}
        if "songs/match" in path:
            return {"suggest": self.suggest}
        return {}

    def post(self, path, payload):
        self.made.append(payload.get("title"))
        return {"song": {"id": len(self.made)}}

    def upload(self, path, file_path, headers):
        self.sent.append((path, os.path.basename(file_path)))
        return {"added": True, "version": {"n": 1}}


def test_survey_hands_back_pairs_not_paths(tmp_path):
    """The shape the two loops disagreed about, pinned down.

    If this ever becomes a list of strings, the watch loop's `for path, _ in fresh` starts
    unpacking a filename into characters, so the shape is worth a test of its own rather
    than being implied by the tests below.
    """
    _wav(tmp_path / "take.wav")
    known, fresh = jriter_client.survey({"folders": [str(tmp_path)]}, Recorder())
    assert known == []
    assert len(fresh) == 1
    path, digest = fresh[0]
    assert path.endswith("take.wav")
    assert len(digest) == 64


def test_the_watch_loop_actually_sends_renders(tmp_path):
    """The loop out of cmd_watch, run against a library that answers.

    Written as the loop rather than by calling cmd_watch, because cmd_watch sleeps for five
    minutes and never returns. What is being checked is the two lines inside it.
    """
    _wav(tmp_path / "one.wav")
    _wav(tmp_path / "two.wav")
    cfg = {"folders": [str(tmp_path)]}
    server = Recorder()

    _, fresh = jriter_client.survey(cfg, server)
    for path, _ in fresh:
        jriter_client.send_render(cfg, server, path)

    assert sorted(name for _, name in server.sent) == ["one.wav", "two.wav"]
    assert all(path == "/api/renders" for path, _ in server.sent)


def test_send_render_can_reach_flrender():
    """The NameError, named.

    send_render asks flrender for the dates of a file it has never heard of, which is the
    ordinary case for anything not rendered by this tool. That call has to reach a module
    rather than a missing global.
    """
    assert hasattr(jriter_client, "flrender"), \
        "flrender must be imported at module level, not inside cmd_render"
    assert jriter_client.flrender.dates_for("nothing-was-ever-here.wav") == (0.0, 0.0)


def test_push_folder_sends_every_sound_file(tmp_path):
    """The right click entry: a folder of bounces, sent once, without watching it."""
    _wav(tmp_path / "a.wav")
    _wav(tmp_path / "b.mp3")            # extension is what is filtered on, not content
    (tmp_path / "notes.txt").write_text("not audio")
    server = Recorder()

    class Args:
        path = str(tmp_path)
        yes = True

    code = jriter_client.cmd_push_folder(
        {"server": "http://x", "folders": [], "auto_new_songs": False}, server, Args())

    assert code == 0
    assert sorted(name for _, name in server.sent) == ["a.wav", "b.mp3"]
    # No match offered, so each becomes a song named after the file.
    assert sorted(server.made) == ["a", "b"]


def test_push_folder_carries_on_past_one_bad_file(tmp_path):
    """One unreadable file must not end a run that was left alone to finish."""
    _wav(tmp_path / "good.wav")
    _wav(tmp_path / "bad.wav")
    bad = str(tmp_path / "bad.wav")

    class Awkward(Recorder):
        def upload(self, path, file_path, headers):
            if os.path.basename(file_path) == "bad.wav":
                raise OSError("the disk had other ideas")
            return super().upload(path, file_path, headers)

    server = Awkward()

    class Args:
        path = str(tmp_path)
        yes = True

    code = jriter_client.cmd_push_folder(
        {"server": "http://x", "folders": [], "auto_new_songs": False}, server, Args())

    assert [name for _, name in server.sent] == ["good.wav"]
    # Something got through, so this is not a failed run.
    assert code == 0
    assert os.path.isfile(bad)


def test_push_folder_refuses_a_folder_that_is_not_there(tmp_path):
    class Args:
        path = str(tmp_path / "nowhere")
        yes = True

    assert jriter_client.cmd_push_folder(
        {"server": "http://x", "folders": []}, Recorder(), Args()) == 1


def test_the_menu_offers_both_folder_verbs():
    """Watching a folder and uploading one are different things and both have to be there.

    Only the standing arrangement used to be offered, so the way to send a folder you had
    already filled was to watch it for ever.
    """
    shell = pytest.importorskip("jriter_shell")
    labels = {label for _, _, label, _, _ in shell.ENTRIES}
    assert "Upload every sound file in here" in labels
    assert "Watch this folder with JR!TER" in labels
    assert "Render every FL project in here" in labels

    commands = {name: command for name, _, _, command, _ in shell.ENTRIES}
    assert commands["JriterPushFolder"] == "push-folder"
    # Every command a menu entry names has to be a command the client answers to. This is
    # the join that silently breaks when one of the two files is renamed.
    for command in commands.values():
        assert command in jriter_client.COMMANDS, command


def test_the_menu_wears_the_jriter_icon():
    """It wore python.exe's, which is honest about what runs and wrong about what it is."""
    shell = pytest.importorskip("jriter_shell")
    icon = shell._icon()
    assert icon.lower().endswith("favicon.ico"), icon
    assert os.path.isfile(icon)
