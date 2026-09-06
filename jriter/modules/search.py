"""Finding anything, by asking every module what it can find.

There is no list of tables in this file on purpose. Searching is the second question the
registry asks every loaded module, after SUMMARY: a module that owns something findable
defines SEARCH(term, limit) and gets a heading in the results, and a module taken out of
config.MODULES takes its heading out with it. Adding a searchable feature is one function
in that feature's own file and nothing here.

The categories are ordered by the number each module declares rather than by how good
their best hit is. Score ordering would move a heading up on one keystroke and back on
the next, and a page that reshuffles under the cursor is the thing that makes a search
box feel untrustworthy. Fixed order also means an exact song title is never underneath a
lyric that happens to contain the word.
"""
from .. import registry, finding
from ..wire import as_int

NAME = "search"
SCHEMA = []

#: Per category, before the heading says "8 of 37" instead of listing them all.
SHOW = 8
MOST = 50


def search(req):
    term = (req.q("q") or "").strip()[:finding.MAX_TERM]
    limit = max(1, min(MOST, as_int(req.q("limit") or SHOW, "limit")))
    if not term:
        return {"query": "", "groups": [], "looked_in": []}
    found = registry.searches(term, limit)
    found.sort(key=lambda g: (g["order"], g.get("label", "")))
    return {
        "query": term,
        # Only the ones with something to show, plus any that failed, because a heading
        # with nothing under it is noise on a page whose whole job is a short answer.
        "groups": [g for g in found if g["hits"] or g.get("error")],
        # Every category that was asked, so the empty state can name where it looked
        # without claiming to have looked somewhere that is switched off.
        "looked_in": [g.get("label", g["module"]) for g in found],
    }


def SUMMARY():
    # Counted by asking which modules define SEARCH, not by running a search. This is on
    # /api/state, which every page load asks for, and running seven queries there to
    # report a number nobody reads would be the whole feature's cost paid twice over.
    return {"categories": len(registry.searchable())}


def ROUTES():
    return {("GET", "/api/search"): search}
