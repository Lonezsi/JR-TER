"""Prepend a patch release to jriter/devlog.py."""
import datetime
import re
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PATH = ROOT / "jriter" / "devlog.py"


def main():
    if len(sys.argv) != 2 or not sys.argv[1].strip():
        raise SystemExit('usage: python tools/release.py "release message"')

    message = sys.argv[1].strip()
    source = PATH.read_text(encoding="utf-8")
    match = re.search(r'"version": "(\d+)\.(\d+)\.(\d+)"', source)
    if not match:
        raise SystemExit("could not find the current version in jriter/devlog.py")

    major, minor, patch = (int(part) for part in match.groups())
    version = "%d.%d.%d" % (major, minor, patch + 1)
    today = datetime.date.today().isoformat()
    entry = '''    {
        "version": "%s",
        "date": "%s",
        "name": JRITER,
        "title": %r,
        "notes": [
            %r,
        ],
    },
''' % (version, today, message, message)
    marker = "ENTRIES = [\n"
    if marker not in source:
        raise SystemExit("could not find the release list in jriter/devlog.py")
    PATH.write_text(source.replace(marker, marker + entry, 1), encoding="utf-8")
    print("prepared JR!TER %s" % version)


if __name__ == "__main__":
    main()
