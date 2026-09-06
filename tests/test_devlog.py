"""The version, and the note that goes with it."""
import os
import re

import jriter
from jriter import config, devlog


def test_the_version_is_the_top_of_the_log():
    """If these two can disagree, one of them is wrong and nobody finds out until a
    release ships carrying the previous release's notes."""
    assert jriter.__version__ == devlog.ENTRIES[0]["version"]


def test_the_log_is_newest_first_and_every_version_is_a_version():
    marks = [devlog.parse(e["version"]) for e in devlog.ENTRIES]
    assert all(m is not None for m in marks), [e["version"] for e in devlog.ENTRIES]
    assert marks == sorted(marks, reverse=True), "the devlog is out of order"
    assert len(set(marks)) == len(marks), "two entries claim the same version"


def test_ten_comes_after_nine():
    """As text, "0.10.0" sorts before "0.9.0", which would have stopped the popup ever
    appearing again from the tenth release onwards."""
    assert devlog.parse("0.10.0") > devlog.parse("0.9.0")


def test_every_release_says_which_name_the_project_had():
    """The whole 1.x line shipped as J-ong. A history that renames its own past is one
    you cannot use to work out what you were running."""
    for entry in devlog.ENTRIES:
        assert entry.get("name"), entry["version"]
        assert entry.get("date") and entry.get("title") and entry.get("notes")
    names = {e["name"] for e in devlog.ENTRIES}
    assert names == {"project JONG", "JR!TER"}, names
    # The name changes exactly once on the way down: every JR!TER release is newer than
    # every JONG one. A list that flips back and forth is a list somebody has edited by
    # pasting an entry into the wrong end of it.
    order = [e["name"] for e in devlog.ENTRIES]
    assert order.index("project JONG") == order.count("JR!TER"), order
    assert order[0] == "JR!TER" and order[-1] == "project JONG"


def test_the_devlog_imports_nothing_from_the_package():
    """jriter/__init__.py reads this file to know its own version, so an import here runs
    before the package has finished loading."""
    path = os.path.join(os.path.dirname(devlog.__file__), "devlog.py")
    with open(path, encoding="utf-8") as f:
        source = f.read()
    assert not re.search(r"^\s*(from\s+\.|import\s+jriter)", source, re.M), \
        "jriter/devlog.py imports part of JR!TER, which makes importing jriter a cycle"


def test_the_devlog_is_a_module_that_can_be_switched_off():
    assert "devlog" in config.MODULES


def test_the_state_says_which_version_this_is(server):
    """Not behind the module: the rail reads this on every load."""
    status, state = server.get("/api/state")
    assert status == 200
    assert state["version"] == jriter.__version__


def test_the_log_can_be_read_whole(server):
    status, listing = server.get("/api/devlog")
    assert status == 200
    assert listing["entries"][0]["version"] == jriter.__version__
    assert listing["releases"] == len(devlog.ENTRIES)


def test_since_answers_only_with_what_is_newer(server):
    status, none = server.get("/api/devlog?since=" + jriter.__version__)
    assert status == 200 and none["entries"] == [], \
        "it is inclusive, so the popup would appear once per page load"

    oldest = devlog.ENTRIES[-1]["version"]
    status, some = server.get("/api/devlog?since=" + oldest)
    assert status == 200
    assert len(some["entries"]) == len(devlog.ENTRIES) - 1
    assert oldest not in [e["version"] for e in some["entries"]]


def test_a_version_it_cannot_read_is_answered_with_nothing(server):
    """Not with everything. A stored value we do not understand is not a reason to hand
    somebody every release note there has ever been."""
    status, answer = server.get("/api/devlog?since=not-a-version")
    assert status == 200 and answer["entries"] == []


def test_a_first_visit_is_shown_nothing():
    """The page decides this, so it is checked in the page. Someone opening JR!TER for
    the first time has missed nothing, and a wall of releases is the whole thing this
    feature is meant to avoid being."""
    path = os.path.join(config.WEB, "js", "16-devlog.js")
    with open(path, encoding="utf-8") as f:
        source = f.read()
    assert "if (!last) { remember(now); return; }" in source, \
        "a first visit no longer stores the version silently"
