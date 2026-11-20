"""The search language (jriter/query.py, and its twin ui/src/lib/query.ts for the guest
library): plain words still work, and keys narrow the results.

Every search box understands it, because every search box asks /api/search.
"""
import json
import os
import shutil
import subprocess
import tempfile
import urllib.parse

import pytest

from jriter import query

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

CASES = [
    ("night", {"words": ["night"], "nots": [], "kinds": [], "filters": []}),
    ('is:song renders:>2 -rain', {"words": [], "nots": ["rain"], "kinds": ["song"],
                                  "filters": [["renders", ">", "2", False]]}),
    ('album:"First Light" has:words', {"words": [], "nots": [], "kinds": [],
                                       "filters": [["album", "=", "First Light", False], ["has", "=", "words", False]]}),
    ('"fading light" -is:x', {"words": ["fading light"], "nots": [], "kinds": [], "filters": []}),
    ("note: this", {"words": ["note:this"] if False else ["note:", "this"], "nots": [], "kinds": [], "filters": []}),
]


def _plain(q):
    return {"words": q.words, "nots": q.nots, "kinds": sorted(q.kinds), "filters": [list(f) for f in q.filters]}


@pytest.mark.parametrize("text,want", CASES[:4])
def test_parse(text, want):
    assert _plain(query.parse(text)) == want


def test_filters_decide_per_hit():
    q = query.parse("is:song renders:>2 -rain")
    assert q.allows("song", {"title": "Glass Hours", "version_count": 4})
    assert not q.allows("song", {"title": "Glass Hours", "version_count": 1})
    assert not q.allows("song", {"title": "Rain again", "version_count": 4})
    assert not q.allows("album", {"title": "Glass Hours"})
    q = query.parse('album:"first" has:words')
    assert q.allows("song", {"title": "x"}, {"albums": ["First Light"], "has_words": True})
    assert not q.allows("song", {"title": "x"}, {"albums": ["Demos"], "has_words": True})


def test_the_server_search_speaks_it(server):
    for title in ("Glass Hours", "Late Bloomer"):
        status, made = server.post("/api/songs", {"title": title})
        assert status == 200, made
    status, found = server.get("/api/search?q=" + urllib.parse.quote("is:song -late"))
    assert status == 200, found
    titles = [h["title"] for g in found["groups"] for h in g["hits"]]
    assert "Glass Hours" in titles and "Late Bloomer" not in titles
    status, found = server.get("/api/search?q=" + urllib.parse.quote("is:album"))
    assert status == 200
    assert not [h for g in found["groups"] for h in g["hits"] if g.get("kind") == "song"]


def test_the_browser_twin_reads_it_the_same():
    """ui/src/lib/query.ts parses exactly as jriter/query.py does."""
    node = shutil.which("node")
    if not node:
        pytest.skip("needs Node 22.6+")
    src = os.path.join(ROOT, "ui", "src", "lib", "query.ts")
    with tempfile.TemporaryDirectory() as tmp:
        shutil.copy(src, os.path.join(tmp, "query.ts"))
        script = ("import { parseQuery } from './query.ts';"
                  "const cases = JSON.parse(process.argv[2]);"
                  "console.log(JSON.stringify(cases.map((t) => { const q = parseQuery(t);"
                  " return { words: q.words, nots: q.nots, kinds: [...q.kinds].sort(), filters: q.filters }; })));")
        with open(os.path.join(tmp, "run.mjs"), "w", encoding="utf-8") as f:
            f.write(script)
        texts = [c[0] for c in CASES[:4]]
        run = subprocess.run([node, "--experimental-strip-types", "--no-warnings", "run.mjs", json.dumps(texts)],
                             cwd=tmp, capture_output=True, text=True, encoding="utf-8", timeout=60)
        if run.returncode and "strip-types" in run.stderr:
            pytest.skip("this Node can't run TypeScript")
        assert run.returncode == 0, run.stderr
        got = json.loads(run.stdout)
    assert got == [c[1] for c in CASES[:4]]
