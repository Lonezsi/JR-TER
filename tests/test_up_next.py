"""What plays when the queue runs out.

The player used to stop dead at the end of a list. It now asks the library, and this is
about the answer being reasonable rather than about it being any particular song: the
choice is deliberately random, so what is testable is the shape of the distribution and the
rules it must never break.

Three of those rules matter enough to pin down:

  it never offers the song that just finished, which would be repeat by accident
  it never offers a song with nothing to play, which would be autoplay turning into silence
  it never returns nothing while there is still something playable it has not just played
"""
import time

from jriter import db
from jriter.modules import songs, albums


class Ask:
    """The bit of a request these handlers read."""

    def __init__(self, **query):
        self._q = {k: str(v) for k, v in query.items()}
        self.params = {}

    def q(self, name, fallback=None):
        return self._q.get(name, fallback)


def _song(title, opened=0, playable=True, updated=None):
    now = time.time()
    song_id = db.insert("songs", {
        "title": title, "created_at": now, "updated_at": updated or now})
    if playable:
        # A version row is what makes a song playable, and current_version_id is what
        # up_next actually filters on.
        version = db.insert("versions", {
            "song_id": song_id, "n": 1, "digest": "d" + str(song_id),
            "filename": title + ".wav", "size": 1, "duration": 1.0, "created_at": now})
        db.run("UPDATE songs SET current_version_id = ? WHERE id = ?", (version, song_id))
    if opened:
        db.run("UPDATE songs SET opened = ? WHERE id = ?", (opened, song_id))
    return song_id


def test_it_never_offers_the_song_that_just_played():
    here = _song("Kettle")
    _song("Dikdik")
    for _ in range(30):
        got = songs.up_next(Ask(after=here))
        assert got["song"]["id"] != here


def test_it_never_offers_a_song_with_nothing_to_play():
    """Autoplay that lands on a song with no renders is autoplay that stops."""
    here = _song("Kettle")
    silent = _song("No renders here", playable=False)
    _song("Dikdik")
    for _ in range(30):
        assert songs.up_next(Ask(after=here))["song"]["id"] != silent


def test_it_spreads_across_the_library():
    """A deterministic answer is a rut. Every playable song has to be reachable."""
    here = _song("Kettle")
    others = {_song("One"), _song("Two"), _song("Three")}
    seen = set()
    for _ in range(200):
        seen.add(songs.up_next(Ask(after=here))["song"]["id"])
    assert seen == others, "some song was never once offered"


def test_a_song_on_the_same_album_is_favoured():
    """The strongest of the four signals, and the one worth checking is wired at all.

    Not "always wins": it is a weight, and chance is also a weight on purpose. Over two
    hundred draws with everything else equal it should be well clear, and a mate that comes
    up around a third of the time is a signal that is not connected.
    """
    here = _song("Kettle")
    mate = _song("Same record")
    strangers = [_song("Elsewhere %d" % i) for i in range(2)]

    album = db.insert("albums", {"title": "The record", "created_at": time.time(),
                                 "updated_at": time.time()})
    for position, song_id in enumerate((here, mate)):
        db.insert("album_songs", {"album_id": album, "song_id": song_id,
                                  "position": position})

    counts = {}
    for _ in range(200):
        got = songs.up_next(Ask(after=here))
        counts[got["song"]["id"]] = counts.get(got["song"]["id"], 0) + 1

    share = counts.get(mate, 0) / 200.0
    # Three candidates, so chance alone is a third. The album weight has to beat that
    # clearly or it is doing nothing.
    assert share > 0.55, ("the album signal is not working: mate %.0f%%, strangers %s"
                          % (share * 100, [counts.get(s, 0) for s in strangers]))
    assert counts.get(mate) and all(counts.get(s) for s in strangers), \
        "favoured must not mean only"


def test_the_one_that_gets_opened_is_favoured():
    """A threshold rather than "more than the other one".

    The first version of this asserted only that the favoured song came up more often,
    which between two candidates is a coin toss: it passed just as happily with the weight
    set to zero, which is to say it tested nothing. Measured with the weight on, the
    favoured song takes about 89 per cent of four hundred draws, so two thirds is clear of
    the noise and nowhere near the 50 per cent that no signal at all would give.
    """
    here = _song("Kettle")
    loved = _song("Played to death", opened=50)
    ignored = _song("Never opened", opened=0)
    counts = {}
    for _ in range(400):
        got = songs.up_next(Ask(after=here))
        counts[got["song"]["id"]] = counts.get(got["song"]["id"], 0) + 1

    share = counts.get(loved, 0) / 400.0
    assert share > 0.66, "opened is not being weighted: %.0f%%" % (share * 100)
    # Favoured, not exclusive: the one you never open is still allowed to come up.
    assert counts.get(ignored, 0) > 0


def test_a_library_of_one_still_answers():
    """The smallest library there is. Repeating beats silence, so it comes round again."""
    only = _song("The only one")
    got = songs.up_next(Ask(after=only))
    # Nothing else exists, so the honest answer is either this song again or nothing; what
    # it must not do is raise.
    assert got["song"] is None or got["song"]["id"] == only


def test_an_empty_library_says_so_rather_than_failing():
    got = songs.up_next(Ask(after=0))
    assert got["song"] is None
    assert "played" in got["why"]


def test_recently_heard_songs_are_skipped():
    """What stops a library of four feeling like a loop of two."""
    here = _song("Kettle")
    recent = [_song("A"), _song("B")]
    fresh = _song("C")
    for _ in range(30):
        got = songs.up_next(Ask(after=here, **{"not": ",".join(str(i) for i in recent)}))
        assert got["song"]["id"] == fresh


def test_rubbish_in_the_not_list_is_ignored_rather_than_fatal():
    """That parameter is built by joining ids in the browser, so it can arrive empty or odd."""
    here = _song("Kettle")
    other = _song("Dikdik")
    for junk in ("", ",,", "not-a-number", "3,,x,"):
        got = songs.up_next(Ask(after=here, **{"not": junk}))
        assert got["song"]["id"] == other
