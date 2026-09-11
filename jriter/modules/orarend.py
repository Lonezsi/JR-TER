"""A week, and where the classes fall in it.

WHY THIS IS IN THE LIBRARY AND NOT IN FOYER. It was in Foyer, which is the right place for
it by subject: it has nothing to do with music. It is here because of how each site can be
reached. JR!TER is behind Tailscale Funnel, which means it answers on the public internet
and every unauthenticated caller gets the login page and nothing else. Foyer is on the
tailnet only, so it is reachable from this machine and from nothing else, and a timetable
you cannot open on a phone is a timetable you do not have.

So the page lives where the door is. Foyer's front page links to it here.

WHY THE DATA IS NOT IN THIS REPO. It names a second person, her rooms and her hours, and
this repository is public. So the timetable is a file in the account's own directory,
beside its database, which is in data/ and is not committed. The code is public and the
week is not.

PER ACCOUNT, like everything else here. home() resolves through who.must(), which raises
rather than picking a library, so a second person signing in gets their own empty week and
not a view of somebody else's. That is the same reason the databases are separate files:
a mistake cannot quietly read across.

NO SCHEMA. It is a list somebody edits in a file, not something the app writes, so a table
to hold it would be a table with an import step in front of it. Read at request time, so
editing the file and reloading the page is the whole loop.
"""
import io
import json
import os

from .. import config

NAME = "orarend"
SCHEMA = []

#: The window the grid draws, and how tall an hour is, in pixels.
#:
#: Sent to the browser rather than written down there as well. The view works out every
#: position from these, and the stylesheet draws the hour rows at the same height, so there
#: is one place the scale of the grid is decided and it is this one.
FROM = 8
TO = 22
HOUR = 60


def path(account=None):
    """Where one account's week is kept."""
    return os.path.join(config.home(account), "orarend.json")


def read(account=None):
    """The week as it is on disk, or nothing.

    A missing file is not a fault. It is what every account that has never written one
    looks like, which is most of them, and the screen has something to say about that.
    """
    try:
        with io.open(path(account), encoding="utf-8") as f:
            found = json.load(f)
    except OSError:
        return None
    except ValueError as e:
        # Broken rather than absent, which is a different thing and worth saying so: the
        # file is there and somebody has just edited it.
        return {"broken": str(e)}
    if isinstance(found, list):
        # A bare list of classes, which is the shape that is easiest to write by hand.
        return {"classes": found}
    return found


def week(req):
    """The timetable, with the scale it is meant to be drawn at.

    `missing` and `broken` are told apart because the screens for them are different: one
    says how to make one, the other says which line will not parse.
    """
    found = read()
    if found is None:
        return {"classes": [], "missing": True, "where": "orarend.json",
                "from": FROM, "to": TO, "hour": HOUR}
    if found.get("broken"):
        return {"classes": [], "broken": found["broken"], "where": "orarend.json",
                "from": FROM, "to": TO, "hour": HOUR}
    return {
        "classes": found.get("classes") or [],
        "from": found.get("from", FROM),
        "to": found.get("to", TO),
        "hour": found.get("hour", HOUR),
    }


def SUMMARY():
    """What the home screen is told. Nothing, when there is no week."""
    found = read()
    if not found or found.get("broken"):
        return {}
    return {"classes": len(found.get("classes") or [])}


def ROUTES():
    return {
        ("GET", "/api/orarend"): week,
    }
