"""Prepend a patch release to jriter/devlog.json (read by the Python and Spring servers)."""
import datetime
import json
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PATH = ROOT / "jriter" / "devlog.json"


def main():
    if len(sys.argv) != 2 or not sys.argv[1].strip():
        raise SystemExit('usage: python tools/release.py "release message"')

    message = sys.argv[1].strip()
    entries = json.loads(PATH.read_text(encoding="utf-8"))
    major, minor, patch = (int(part) for part in entries[0]["version"].split("."))
    version = "%d.%d.%d" % (major, minor, patch + 1)
    entries.insert(0, {
        "version": version,
        "date": datetime.date.today().isoformat(),
        "name": "JR!TER",
        "title": message,
        "notes": [message],
    })
    PATH.write_text(json.dumps(entries, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    print("prepared JR!TER %s" % version)


if __name__ == "__main__":
    main()
