"""Finding things, across everything that can be found.

The module rule is what most of this is about: search asks every loaded module what it
can find, so switching a feature off has to take its heading away with it rather than
leaving a query against a table that is still there.
"""
import pytest

from jriter import finding, registry


def test_a_wildcard_is_a_character_and_not_a_wildcard():
    """Searching for 100% used to return the whole library, and w_nter used to find
    winter: % and _ are LIKE's own, and the term went in untouched."""
    assert finding.pattern("100%") == r"%100\%%"
    assert finding.pattern("w_nter") == r"%w\_nter%"
    # The backslash goes first, or escaping it afterwards would undo the other two.
    slash = chr(92)
    assert finding.pattern("a" + slash + "b") == "%a" + slash + slash + "b%"


def test_how_good_a_hit_is():
    assert finding.rank("win", "win") == 4          # it is the thing
    assert finding.rank("win", "Winter") == 3       # it starts with it
    assert finding.rank("win", "a winter") == 2     # a word in it starts with it
    assert finding.rank("win", "unwind") == 1       # in there somewhere
    assert finding.rank("win", "summer") == 0       # not in this field


def test_the_matched_line_is_the_whole_line():
    """A lyric hit shows the words, not the file. Half a line reads as damage."""
    words = "first line\nthe one you wanted\nlast line"
    assert finding.line_around(words, "wanted") == "the one you wanted"
    assert finding.line_around(words, "nothing here") == ""


def test_searching_folds_case_past_ascii(server):
    """SQLite's LIKE folds ASCII and stops. On a Hungarian library that is most of the
    titles, not an edge case."""
    status, made = server.post("/api/songs", {"title": "Ősz"})
    assert status == 200, made

    import urllib.parse
    status, found = server.get("/api/search?q=" + urllib.parse.quote("ősz"))
    assert status == 200
    titles = [h["title"] for g in found["groups"] for h in g["hits"]]
    assert "Ősz" in titles, "a lower case search did not find an accented title"


def test_a_wildcard_does_not_return_the_library(server):
    server.post("/api/songs", {"title": "One"})
    server.post("/api/songs", {"title": "Two"})

    status, found = server.get("/api/search?q=%25")     # a literal percent sign
    assert status == 200
    assert found["groups"] == [], "the percent was treated as LIKE's own wildcard"


def test_every_category_is_asked_and_named(server):
    """The empty state says where it looked, and it must not claim to have looked in a
    category whose module is switched off."""
    status, found = server.get("/api/search?q=nothingmatchesthis")
    assert status == 200
    assert found["groups"] == []
    assert "Songs" in found["looked_in"]
    for name in found["looked_in"]:
        assert name in ("Songs", "Albums", "Playlists", "Words", "Takes",
                        "Renders", "Artwork"), name


def test_the_words_are_searched(server, wav):
    """The search that finds a song you can only remember a line of, which on a
    songwriting tool is the most valuable thing here."""
    status, made = server.post("/api/songs", {"title": "Untitled"})
    song_id = made["song"]["id"]
    status, sheet = server.post("/api/songs/%d/lyrics" % song_id,
                                {"text": "A name\n\nthe cold came down the hill"})
    assert status == 200, sheet

    status, found = server.get("/api/search?q=cold+came")
    assert status == 200
    words = [g for g in found["groups"] if g["kind"] == "lyric"]
    assert words, "the words were not searched"
    hit = words[0]["hits"][0]
    assert hit["line"] == "the cold came down the hill"
    assert hit["href"] == "#/song/%d" % song_id
    assert "text" not in hit, "the whole sheet was sent to draw one line"


def test_one_letter_does_not_search_every_lyric(server):
    """One letter is in every sheet in the library. Answering that is slow and says
    nothing, so titles are still searched and the words are not."""
    status, made = server.post("/api/songs", {"title": "Alpha"})
    server.post("/api/songs/%d/lyrics" % made["song"]["id"],
                {"text": "A name\n\naaaa aaaa"})

    status, found = server.get("/api/search?q=a")
    assert status == 200
    kinds = [g["kind"] for g in found["groups"]]
    assert "song" in kinds
    assert "lyric" not in kinds


def test_an_old_name_still_finds_the_song(server):
    """Keeping old titles is the whole point of song_titles, and it is worth nothing if
    the search cannot see them: the name you go looking for is usually the one you
    changed."""
    status, made = server.post("/api/songs", {"title": "Winter Song"})
    song_id = made["song"]["id"]
    status, _ = server.patch("/api/songs/%d" % song_id, {"title": "Frost"})
    assert status == 200

    status, found = server.get("/api/search?q=winter")
    assert status == 200
    songs = [g for g in found["groups"] if g["kind"] == "song"]
    assert songs, "the old name did not find the song"
    hit = songs[0]["hits"][0]
    assert hit["id"] == song_id
    assert "was called Winter Song" in (hit.get("sub") or ""), \
        "it found the song by a name it no longer has and did not say so"


def test_a_module_that_is_off_is_not_searched_and_not_claimed(server, monkeypatch):
    """The whole reason this goes through the registry rather than naming tables."""
    everyone = registry.searchable()
    assert "songs" in everyone and "lyrics" in everyone

    monkeypatch.setitem(registry._loaded, "lyrics", None)
    monkeypatch.delitem(registry._loaded, "lyrics")
    status, found = server.get("/api/search?q=anything")
    assert status == 200
    assert "Words" not in found["looked_in"]


def test_the_search_screen_is_reachable_from_the_hash():
    """#/?q= is the search URL, so every link anybody already has keeps working and the
    box that writes that hash did not have to change."""
    import os
    import pathlib
    from jriter import config
    router = pathlib.Path(config.WEB, "js", "80-router.js").read_text(encoding="utf-8")
    assert 'view: query.q ? "search" : "library"' in router
    assert os.path.exists(os.path.join(config.WEB, "js", "52-view-search.js"))
