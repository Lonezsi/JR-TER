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
from .. import registry, finding, query, db
from ..wire import as_int

NAME = "search"
SCHEMA = []

#: Per category, before the heading says "8 of 37" instead of listing them all.
SHOW = 8
MOST = 50


def _song_facts(ids):
    """What the album: and has: filters need about each song, in three queries."""
    facts = {i: {"albums": [], "has_words": False, "has_art": False} for i in ids}
    if not ids:
        return facts
    marks = ",".join("?" * len(ids))
    if db.table_exists("album_songs"):
        for row in db.query("SELECT s.song_id, a.title FROM album_songs s JOIN albums a ON a.id = s.album_id "
                            "WHERE s.song_id IN (%s)" % marks, ids):
            facts[row["song_id"]]["albums"].append(row["title"] or "")
    if db.table_exists("lyric_sheets"):
        for row in db.query("SELECT DISTINCT song_id FROM lyric_sheets WHERE song_id IN (%s)" % marks, ids):
            facts[row["song_id"]]["has_words"] = True
    if db.table_exists("artwork"):
        for row in db.query("SELECT DISTINCT song_id FROM artwork WHERE song_id IN (%s)" % marks, ids):
            facts[row["song_id"]]["has_art"] = True
    return facts


def search(req):
    """Plain words, or the search language in jriter/query.py (is:song renders:>3 ...)."""
    raw = (req.q("q") or "").strip()[:finding.MAX_TERM * 3]
    limit = max(1, min(MOST, as_int(req.q("limit") or SHOW, "limit")))
    q = query.parse(raw)
    term = q.text[:finding.MAX_TERM]
    if not term and not q.narrowed:
        return {"query": "", "groups": [], "looked_in": []}
    # Narrowed: ask for more, since the filters will throw some away.
    found = registry.searches(term, MOST if q.narrowed else limit)
    if q.narrowed:
        for g in found:
            kind = g.get("kind", g.get("module"))
            hits = g.get("hits") or []
            facts = _song_facts([h["id"] for h in hits if "id" in h])                 if query.KIND_ALIASES.get(kind, kind) == "song" and query.song_facts_needed(q) else {}
            kept = [h for h in hits if q.allows(kind, h, facts.get(h.get("id")))]
            g["total"] = len(kept) if len(hits) < MOST else g.get("total", len(kept))
            g["hits"] = kept[:limit]
    found.sort(key=lambda g: (g["order"], g.get("label", "")))
    return {
        "query": raw,
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
