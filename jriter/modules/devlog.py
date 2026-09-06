"""What changed, as far as the page is concerned.

The entries live in jriter/devlog.py, beside the version they name, because
jriter/__init__.py reads that file to know its own version and the registry's rule is
that nothing imports a module directly. This is only the door onto them.

Take this out of MODULES and the popup and the list in Settings go with it. The version
in the rail does not: that rides on /api/state, and an app that cannot say which version
it is is not something worth making optional.
"""
from ..devlog import ENTRIES, since

NAME = "devlog"
SCHEMA = []


def entries(req):
    """Every release, or only the ones newer than the last one the caller saw.

    The comparison is done here rather than in the browser so there is one implementation
    of "is this newer" instead of two that can disagree about whether 0.10.0 beats 0.9.0.
    """
    mark = req.q("since")
    listing = since(mark) if mark else list(ENTRIES)
    return {"entries": listing, "releases": len(ENTRIES)}


def ROUTES():
    return {
        ("GET", "/api/devlog"): entries,
    }
