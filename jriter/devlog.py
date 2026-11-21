"""What changed, release by release.

The list is the release. The newest entry's version is what jriter.__version__ reports,
what the banner prints and what the rail shows, so shipping is one edit here rather than a
number bumped in one file and notes written in another. Those two drift, and the one that
gets forgotten is always the notes.

This imports nothing from the rest of JR!TER on purpose, for the same reason wire.py does
not: jriter/__init__.py reads this file to know its own version, so anything imported here
would be imported before the package has finished loading.

Every entry carries the name the project had at the time. It was called J-ong for the
first four days and the whole of the 1.x line, and a release history that quietly renames
its own past is a history you cannot use to work out what you were running.

The entries themselves are in devlog.json beside this file, so the Spring server reads
the very same list; this file loads them and holds the version helpers.

Newest first. Keep the notes to a few plain lines. They are read in a small dialog by one
person who was in the middle of doing something else.
"""

JONG = "project JONG"
JRITER = "JR!TER"

import json
import os

ENTRIES_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "devlog.json")

with open(ENTRIES_FILE, encoding="utf-8") as _f:
    ENTRIES = json.load(_f)


def parse(version):
    """A version as numbers, so two of them can be compared. None when it is not one.

    Comparing them as text is the trap: "0.10.0" sorts before "0.9.0", so the tenth
    release would quietly stop being newer than the ninth and the popup would stop
    appearing, with nothing to show for it.
    """
    parts = str(version or "").split(".")
    if not parts or len(parts) > 4:
        return None
    try:
        return tuple(int(part) for part in parts)
    except ValueError:
        return None


def latest():
    return ENTRIES[0]


def since(version):
    """Every entry newer than a version, newest first.

    A version this cannot read answers with nothing rather than with everything. Whoever
    asked is holding a value we do not understand, and handing them every release note
    there has ever been is the one outcome worth avoiding.
    """
    mark = parse(version)
    if mark is None:
        return []
    return [entry for entry in ENTRIES if (parse(entry["version"]) or ()) > mark]
