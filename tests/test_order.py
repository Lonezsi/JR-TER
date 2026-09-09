"""Does a song added to a playlist or an album land at the end.

Both of these were holes, found by changing MAX(position) to MIN(position) in each module
and watching the whole suite pass. Nothing anywhere asserted where a new item goes.

That matters more than it sounds. A playlist and an album are both a running order: the
whole reason they are not just a set of songs is that the sequence is the thing you chose.
Appending to the front instead of the back is not a crash and not an error message, it is
a running order that is quietly wrong, and the tests would have said nothing about it.

The existing playlist tests check that an order can be rewritten whole, which is a
different question and passes either way.
"""


def _song(server, title):
    _, made = server.post("/api/songs", {"title": title})
    return made["song"]["id"]


def _order(server, playlist):
    """The song ids in a playlist, in the order it hands them back."""
    status, body = server.get("/api/playlists/%d" % playlist)
    assert status == 200, body
    # An item carries the whole song under "song", not a bare song_id.
    return [item["song"]["id"] for item in body["playlist"]["items"]
            if item["kind"] == "song"]


def test_a_song_added_to_a_playlist_goes_after_a_gap_in_the_order(server):
    """A new item goes on the end, including once the positions have a hole in them.

    What this test does NOT guard, stated because I spent a while assuming it did:
    whether the next position is worked out from the highest or the lowest already in use.
    Those two cannot be told apart from outside. Measured rather than reasoned about:

        highest  positions 1, 3, 4    order 1, 3, 4
        lowest   positions 1, 2, 2    order 1, 3, 4

    Counting from the lowest makes every later item tie on the same number, and the query
    breaks ties by id ascending, which reproduces the order things were added in exactly.
    So the wrong arithmetic comes back the right answer, and a mutation testing run that
    reported this as a gap in the tests was reporting a change with no visible effect.

    What it does guard is the thing that is visible: after a hole is left in the numbers,
    a new song still lands after everything rather than inside the hole. That covers a
    genuinely wrong next-position, an ORDER BY that stops honouring position, and a drop
    that renumbers what is left.
    """
    _, made = server.post("/api/playlists", {"title": "Friday"})
    playlist = made["playlist"]["id"]

    ids = []
    for title in ("First In", "Second In", "Third In"):
        song = _song(server, title)
        ids.append(song)
        status, _ = server.post("/api/playlists/%d/items" % playlist, {"song_id": song})
        assert status == 200, "adding %s was refused" % title
    assert _order(server, playlist) == ids, "the three did not go in in order"

    # Take the middle one out, which leaves a hole where its position was.
    _, body = server.get("/api/playlists/%d" % playlist)
    middle = body["playlist"]["items"][1]["item_id"]
    status, _ = server.delete("/api/playlists/%d/items/%d" % (playlist, middle))
    assert status == 200, "could not drop the middle item"

    last = _song(server, "Added After The Hole")
    status, _ = server.post("/api/playlists/%d/items" % playlist, {"song_id": last})
    assert status == 200, "adding after the hole was refused"

    wanted = [ids[0], ids[2], last]
    got = _order(server, playlist)
    assert got == wanted, (
        "after dropping the middle item, a new song came back as %r rather than %r. It"
        " landed inside the hole instead of on the end, so a running order somebody chose"
        " has been rewritten." % (got, wanted))


def test_a_song_added_to_an_album_goes_on_the_end(server):
    """The same question for an album, which had no tests of its own at all."""
    _, made = server.post("/api/albums", {"title": "The Long Way"})
    album = made["album"]["id"]

    wanted = ["Opener", "Middle", "Closer"]
    ids = []
    for title in wanted:
        song = _song(server, title)
        ids.append(song)
        status, _ = server.post("/api/albums/%d/songs" % album, {"song_id": song})
        assert status == 200, "adding %s to the album was refused" % title

    status, body = server.get("/api/albums/%d" % album)
    assert status == 200, body
    # get_album returns the songs beside the album, not inside it.
    got = [row["id"] for row in body["songs"]]
    assert got == ids, (
        "songs added opener, middle, closer came back as %r rather than %r. An album is a"
        " running order and a new song goes after the ones already on it."
        % (got, ids))


def test_adding_the_same_song_to_an_album_twice_does_not_move_it(server):
    """The append path has an early return for a song already on the album.

    Worth its own line because that return is the one branch where no position is worked
    out at all, so a change to the numbering above it cannot be caught here, and a change
    to this branch cannot be caught by the tests above.
    """
    _, made = server.post("/api/albums", {"title": "Twice Over"})
    album = made["album"]["id"]
    first = _song(server, "Only Once")
    second = _song(server, "After It")

    server.post("/api/albums/%d/songs" % album, {"song_id": first})
    server.post("/api/albums/%d/songs" % album, {"song_id": second})
    status, again = server.post("/api/albums/%d/songs" % album, {"song_id": first})
    assert status == 200, again
    assert again["added"] is False, "adding a song already on the album counted as new"

    _, body = server.get("/api/albums/%d" % album)
    got = [row["id"] for row in body["songs"]]
    assert got == [first, second], (
        "adding a song that was already there moved it: %r rather than %r"
        % (got, [first, second]))
