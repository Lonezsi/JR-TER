"""Getting an update from GitHub onto the machine and into the running process.

Written after "the server seems to not update": the banner said an update was ready, the
banner was a link to Settings, and Settings opened on "Not checked yet" with no button on
it. Every step of that worked; the path through them went nowhere.

Two things are covered here. The screen has to arrive already knowing, which is the reason
the dead end existed. And the restart has to be reachable from the page, because a pull
lands new files on disk while Python goes on running the modules it imported at startup, so
until something restarts it an update that entirely succeeded looks exactly like one that
did nothing at all.
"""
import os
import re
import time

import pytest

from jriter import db, who, accounts
from jriter.wire import Error
from jriter.modules import updater

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
UI = os.path.join(HERE, "ui", "src")
SETTINGS = os.path.join(UI, "views", "settings", "Updates.svelte")


class Ask:
    def __init__(self, headers=None):
        self.params = {}
        self.headers = headers or {}

    def q(self, name, fallback=None):
        return fallback

    def json(self):
        return {}


# ── the dead end ─────────────────────────────────────────────────────────────
def test_settings_asks_about_updates_on_the_way_in():
    """The bug itself.

    The top bar's "Update ready" starts the update and Settings shows the details, so if
    this screen does not check on arrival, it opens on "not checked yet" with nothing to
    press until somebody knows to press Check first.
    """
    source = open(SETTINGS, encoding="utf-8").read()

    asks = [i for i in range(len(source)) if source.startswith("/api/update/check", i)]
    assert asks, "Settings never checks for updates at all"

    # The arrival check is the resource made when the screen is built. The button only
    # reloads it, so it must not be the only thing that ever asks.
    arrival = re.search(r"const check = control \? resource\(\(\) => get<[^>]*>\(\"/api/update/check\"\)\)", source)
    assert arrival, (
        "Settings only checks for updates when the button is pressed, so arriving from "
        "the banner shows a screen with nothing on it to press")
    assert "onclick={recheck}" in source, "and the button asks again"


def test_the_banner_still_points_somewhere_that_can_act():
    """The banner and the screen have to agree about what happens. The banner now applies
    the update itself, and Settings offers the same button, so neither is a dead end."""
    shell = open(os.path.join(UI, "shell", "Shell.svelte"), encoding="utf-8").read()
    banner = re.search(r"\{#if shell\.updateReady\}\s*<button[^>]*onclick=\{update\}", shell)
    assert banner, "the update banner is gone, or no longer does anything when pressed"

    source = open(SETTINGS, encoding="utf-8").read()
    assert "Update now" in source and "onclick={update}" in source,         "the screen cannot apply one"


def test_restarting_is_offered_rather_than_described():
    """It used to say "stop the server and start it again", which is no help at all on a
    machine in another room with nobody logged into it."""
    source = open(SETTINGS, encoding="utf-8").read()
    assert "onclick={restart}" in source
    assert "/api/update/restart" in source


def test_a_reason_for_no_button_is_shown_next_to_the_release():
    """The other half of "it does not update".

    check() answers can_update = behind and not dirty, and puts the reason in `why`. The
    row rendered `message || why`, and message is the remote commit's subject, which is
    always there. So a checkout with uncommitted changes said "update ready", named the
    release it was ready for, offered nothing to press, and gave no reason at all.
    """
    source = open(SETTINGS, encoding="utf-8").read()
    assert "c.why && c.message" in source, (
        "the reason an update cannot be applied is still only shown when there is no "
        "release message to show instead, which is never")


def test_a_backup_folder_lying_about_does_not_block_updates(tmp_path, monkeypatch):
    """The reason the live server stopped updating months ago, found by looking at it.

    Its checkout held one untracked directory, data-backup-20260903, made by hand before
    something risky. `git status --porcelain` lists untracked files, the updater read any
    output at all as "somebody has edited JR!TER", and every update from that day on was
    refused. The page said one was ready and offered nothing to press.

    An untracked file is not work a fast forward pull can throw away. Where one genuinely
    collides, git refuses the pull itself and names the file.
    """
    seen = {}

    def fake_git(*args):
        seen["args"] = args
        # What a repository with only an untracked backup folder in it answers.
        if "--untracked-files=no" in args:
            return "", None
        return "?? data-backup-20260903/", None

    monkeypatch.setattr(updater, "_git", fake_git)
    assert updater._tracked_changes() == "", \
        "an untracked folder still counts as an edit to JR!TER"
    assert "--untracked-files=no" in seen["args"]


def test_a_real_edit_still_blocks_an_update(monkeypatch):
    """The caution the flag above must not undo: a pull that would discard somebody's own
    work still refuses, and still says so."""
    monkeypatch.setattr(updater, "_git",
                        lambda *a: (" M jriter/config.py", None))
    assert updater._tracked_changes()


# ── the restart ──────────────────────────────────────────────────────────────
@pytest.fixture
def stopped(monkeypatch):
    """Catch the stop instead of taking the test runner down with it."""
    calls = []
    monkeypatch.setattr(updater, "_STOP", lambda code: calls.append(code))
    monkeypatch.setattr(updater, "STOP_AFTER", 0.01)
    return calls


def test_restart_stops_the_process(stopped):
    answer = updater.restart(Ask())
    assert answer["restarting"] is True
    for _ in range(100):
        if stopped:
            break
        time.sleep(0.02)
    assert stopped == [0], "restart answered but never stopped anything"


def test_restart_folds_the_logs_back_in_first(stopped):
    """os._exit runs no cleanup, so whatever has to happen has to happen before it.

    With synchronous=NORMAL a commit is not fsynced; what makes it durable is the
    checkpoint. Stopping without one is throwing away however much work is sitting in the
    write ahead log.
    """
    for n in range(60):
        db.insert("songs", {"title": "Row %d" % n,
                            "created_at": time.time(), "updated_at": time.time()})
    log = db.config.db_path() + "-wal"
    assert os.path.exists(log) and os.path.getsize(log) > 0, \
        "nothing was in the log, so this test would pass either way"

    updater.restart(Ask())
    for _ in range(100):
        if stopped:
            break
        time.sleep(0.02)

    assert os.path.getsize(log) == 0, \
        "the process stopped with %d bytes still in the log" % os.path.getsize(log)
    # And the rows are actually in the database rather than only in a log that was removed.
    assert len(db.query("SELECT id FROM songs")) == 60


def test_only_the_owner_can_restart(stopped):
    """Everybody's session lives in this one process, so this is not a button to hand out."""
    accounts.create("owner", "one", account_id=accounts.OWNER)
    friend = accounts.create("jozsef", "two")

    with who.acting_as(friend["id"]):
        with pytest.raises(Error) as refused:
            updater.restart(Ask())
    assert refused.value.status == 403
    time.sleep(0.05)
    assert stopped == [], "it stopped the server for somebody who was refused"

    with who.acting_as(accounts.OWNER):
        updater.restart(Ask())
    for _ in range(100):
        if stopped:
            break
        time.sleep(0.02)
    assert stopped == [0]


# ── one press, and on its own ────────────────────────────────────────────────
def _pulled(py=True):
    return {"updated": True, "before": "a" * 40, "after": "b" * 40,
            "files": ["jriter/x.py" if py else "web/x.js"],
            "restart_required": py, "message": "Updated."}


def _wait(stopped):
    for _ in range(100):
        if stopped:
            break
        time.sleep(0.02)


def test_update_now_pulls_and_restarts_onto_new_python(stopped, monkeypatch):
    """The top bar button. It was a link to Settings, which had a second button to pull
    and a third to restart, and until all three were pressed nothing looked different."""
    monkeypatch.setattr(updater, "_pull", lambda: _pulled(py=True))
    answer = updater.update_now(Ask())
    assert answer["updated"] and answer["restarting"]
    _wait(stopped)
    assert stopped == [0], "Python changed and the server never restarted onto it"


def test_update_now_does_not_restart_for_a_page_only_change(stopped, monkeypatch):
    """The page is read from disk on every request, so a reload is enough."""
    monkeypatch.setattr(updater, "_pull", lambda: _pulled(py=False))
    answer = updater.update_now(Ask())
    assert answer["updated"] and not answer["restarting"]
    time.sleep(0.05)
    assert stopped == []


def test_only_the_owner_can_update(stopped, monkeypatch):
    """apply() used to have no check at all, so any account could make the server pull."""
    pulls = []
    monkeypatch.setattr(updater, "_pull", lambda: pulls.append(1) or _pulled())
    accounts.create("owner", "one", account_id=accounts.OWNER)
    friend = accounts.create("jozsef", "two")
    with who.acting_as(friend["id"]):
        for route in (updater.update_now, updater.apply):
            with pytest.raises(Error) as refused:
                route(Ask())
            assert refused.value.status == 403
    assert pulls == [], "a friend made the server pull"


def test_the_page_button_updates_rather_than_navigating():
    actions = open(os.path.join(UI, "lib", "actions.ts"), encoding="utf-8").read()
    body = actions[actions.index("export async function updateNow"):]
    body = body[:body.index("\n}\n")]
    assert '"/api/update/now"' in body
    assert "backAgain()" in body and "location.reload()" in body, (
        "it does not wait for the restart and reload onto the new version")
    shell = open(os.path.join(UI, "shell", "Shell.svelte"), encoding="utf-8").read()
    assert "await updateNow()" in shell, "the banner's button does not run the update"


class _Auto:
    """What _auto_once can see: a checkout, a branch, a remote that is ahead."""

    def __init__(self, monkeypatch, branch="main", ahead=True, clean=True):
        self.pulls = []
        monkeypatch.setattr(updater, "_is_repo", lambda: True)
        monkeypatch.setattr(updater, "_git", lambda *a: (branch, "")
                            if a[:2] == ("rev-parse", "--abbrev-ref") else ("", ""))
        monkeypatch.setattr(updater, "check", lambda req: {
            "checked": True, "update_available": ahead, "can_update": ahead and clean,
            "why": "" if clean else "There are uncommitted changes here."})
        monkeypatch.setattr(updater, "_pull",
                            lambda: self.pulls.append(1) or _pulled(py=True))
        monkeypatch.setattr(updater.config, "BRANCH", "main")


def test_the_server_updates_itself(stopped, monkeypatch):
    auto = _Auto(monkeypatch)
    monkeypatch.setenv("JRITER_WATCHDOG", "1")
    said = updater._auto_once()
    assert auto.pulls == [1], "an update was waiting and was not taken: %s" % said
    _wait(stopped)
    assert stopped == [0], "it pulled new Python and kept running the old"


def test_it_only_restarts_where_something_starts_it_again(stopped, monkeypatch):
    """A developer running the server by hand would find it simply gone."""
    auto = _Auto(monkeypatch)
    monkeypatch.delenv("JRITER_WATCHDOG", raising=False)
    updater._auto_once()
    assert auto.pulls == [1]
    time.sleep(0.05)
    assert stopped == [], "it stopped a server nothing was going to start again"


def test_it_leaves_alone_what_it_should(stopped, monkeypatch):
    for kwargs, why in (({"branch": "feature"}, "on a branch"),
                        ({"clean": False}, "with changes in the tree"),
                        ({"ahead": False}, "when there is nothing new")):
        auto = _Auto(monkeypatch, **kwargs)
        updater._auto_once()
        assert auto.pulls == [], "it pulled %s" % why


def test_switching_auto_update_off_is_honoured(stopped, monkeypatch):
    auto = _Auto(monkeypatch)
    monkeypatch.setattr(updater.config, "settings", lambda: {"auto_update": False})
    assert updater._auto_once() == "switched off"
    assert auto.pulls == []


def test_importing_the_updater_starts_nothing():
    """Only server.py starts the loop, so no test ever pulls from GitHub."""
    import threading
    assert not [t for t in threading.enumerate() if t.name == "auto-update"]
    server = open(os.path.join(HERE, "server.py"), encoding="utf-8").read()
    assert "updater.start_auto()" in server
