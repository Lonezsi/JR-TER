"""Sharing one song with a friend.

Two things are being checked here and the second matters more than the first.

The first is that it works: they can open the song, hear it, read the words, and save their
own version of the equaliser and the lyrics.

The second is the boundary. A share is one song, and everything else in the sharer's library
has to stay out of reach: their other songs, their samples, their renders, their account.
Most of these tests are about that, and several of them are written as an attacker would
write them, by asking for something plausible and checking the answer is no.
"""
import io
import json
import os
import time

import pytest

from jriter import db, who, accounts, registry
from jriter.wire import Error
from jriter.modules import sharing


@pytest.fixture
def pair():
    """An owner with a song, and a friend with an empty library."""
    owner = accounts.create("owner", "one password", account_id=accounts.OWNER)
    friend = accounts.create("jozsef", "another password", name="Jozsef")
    return owner, friend


class Ask:
    """The bit of a request these handlers read."""

    def __init__(self, params=None, body=None, query=None, headers=None):
        self.params = params or {}
        self._body = body or {}
        self._q = query or {}
        self.headers = headers or {}

    def json(self):
        return self._body

    def q(self, name, fallback=None):
        return self._q.get(name, fallback)


def _song(title, text=None, preset=None):
    """A song in whichever library is bound, optionally with words and a preset."""
    now = time.time()
    song_id = db.insert("songs", {"title": title, "created_at": now, "updated_at": now})
    if text is not None:
        sheet = db.insert("lyric_sheets", {"song_id": song_id, "name": "Lyrics",
                                           "position": 0, "is_current": 1,
                                           "created_at": now})
        db.insert("lyric_revisions", {"sheet_id": sheet, "text": text, "created_at": now})
    if preset is not None:
        db.insert("sound_presets", {"song_id": song_id, "name": preset, "is_current": 1,
                                    "data": json.dumps({"bands": []}),
                                    "created_at": now, "updated_at": now})
    return song_id


def _share(owner, friend, song_id, as_name="Jozsef"):
    with who.acting_as(owner["id"]):
        made = sharing.make_share(Ask(body={"song": song_id, "handle": friend["handle"],
                                            "as_name": as_name}))
    return made["share"]


def _artwork(song_id, caption="", bytes_=b"not really a jpeg", ext=".jpg", position=0):
    """One picture on a song in whichever library is bound, with a real file behind it.

    The bytes matter. Without them artwork.image raises "that image is missing from
    storage", which is an Error like any other, and a test asking only whether an Error was
    raised then passes whatever the share said. One of these did exactly that: the revoked
    share test went green with the revocation check taken out, because it was catching a
    missing file rather than a closed door.
    """
    from jriter import blobs, config
    config.ensure_home()
    digest, _, _ = blobs.put_stream(io.BytesIO(bytes_), len(bytes_))
    return db.insert("artwork", {"song_id": song_id, "digest": digest, "ext": ext,
                                 "caption": caption, "position": position,
                                 "created_at": time.time()})


# ── it works ─────────────────────────────────────────────────────────────────
def test_a_shared_song_shows_up_separately(pair):
    owner, friend = pair
    with who.acting_as(owner["id"]):
        song = _song("The one we are working on")
    share_id = _share(owner, friend, song)

    with who.acting_as(friend["id"]):
        # Their own library is still empty: a share is not a song of theirs.
        assert db.query("SELECT id FROM songs") == []
        shown = sharing.shared_with_me(Ask())["shared"]

    assert len(shown) == 1
    assert shown[0]["title"] == "The one we are working on"
    assert shown[0]["share"] == share_id


def test_opening_a_share_gives_the_words_and_the_preset(pair):
    owner, friend = pair
    with who.acting_as(owner["id"]):
        song = _song("Kettle", text="first verse", preset="Wide master")
    share_id = _share(owner, friend, song)

    with who.acting_as(friend["id"]):
        opened = sharing.open_share(Ask(params={"id": share_id}))

    assert opened["song"]["title"] == "Kettle"
    assert [s["text"] for s in opened["sheets"]] == ["first verse"]
    assert [p["name"] for p in opened["presets"]] == ["Wide master"]


def test_editing_a_preset_makes_their_own_copy_named_after_them(pair):
    owner, friend = pair
    with who.acting_as(owner["id"]):
        song = _song("Kettle", preset="Wide master")
        theirs = db.one("SELECT id FROM sound_presets WHERE song_id = ?", (song,))["id"]
    share_id = _share(owner, friend, song)

    with who.acting_as(friend["id"]):
        saved = sharing.save_preset(Ask(params={"id": share_id},
                                        body={"from": theirs, "data": {"bands": []}}))
        mine = db.query("SELECT name FROM sound_presets")

    assert saved["preset"]["name"] == "Wide master, edited by Jozsef"
    assert [r["name"] for r in mine] == ["Wide master, edited by Jozsef"]

    # And the original is exactly as it was.
    with who.acting_as(owner["id"]):
        still = db.query("SELECT name FROM sound_presets WHERE song_id = ?", (song,))
    assert [r["name"] for r in still] == ["Wide master"], \
        "the sharer's own preset was changed"


def test_editing_words_makes_their_own_copy(pair):
    owner, friend = pair
    with who.acting_as(owner["id"]):
        song = _song("Kettle", text="first verse")
        theirs = db.one("SELECT id FROM lyric_sheets WHERE song_id = ?", (song,))["id"]
    share_id = _share(owner, friend, song)

    with who.acting_as(friend["id"]):
        saved = sharing.save_sheet(Ask(params={"id": share_id},
                                       body={"from": theirs, "text": "a better verse"}))
        assert saved["sheet"]["name"] == "Lyrics, edited by Jozsef"
        assert saved["sheet"]["text"] == "a better verse"

    with who.acting_as(owner["id"]):
        latest = db.one("SELECT text FROM lyric_revisions WHERE sheet_id = ? "
                        "ORDER BY id DESC LIMIT 1", (theirs,))
    assert latest["text"] == "first verse", "the sharer's own words were overwritten"


def test_without_a_name_nothing_claims_to_be_edited_by_anybody(pair):
    """"edited by" with nobody to name is worse than saying nothing."""
    owner, friend = pair
    with who.acting_as(owner["id"]):
        song = _song("Kettle", preset="Wide master")
        theirs = db.one("SELECT id FROM sound_presets WHERE song_id = ?", (song,))["id"]
    share_id = _share(owner, friend, song, as_name="")

    with who.acting_as(friend["id"]):
        saved = sharing.save_preset(Ask(params={"id": share_id},
                                        body={"from": theirs, "data": {"bands": []}}))
    assert saved["preset"]["name"] == "Wide master"
    assert "edited by" not in saved["preset"]["name"]


def test_something_they_make_from_scratch_is_simply_theirs(pair):
    owner, friend = pair
    with who.acting_as(owner["id"]):
        song = _song("Kettle")
    share_id = _share(owner, friend, song)

    with who.acting_as(friend["id"]):
        saved = sharing.save_preset(Ask(params={"id": share_id},
                                        body={"name": "My own thing",
                                              "data": {"bands": []}}))
    assert saved["preset"]["name"] == "My own thing"


def test_saving_twice_updates_rather_than_piling_up(pair):
    owner, friend = pair
    with who.acting_as(owner["id"]):
        song = _song("Kettle", preset="Wide master")
        theirs = db.one("SELECT id FROM sound_presets WHERE song_id = ?", (song,))["id"]
    share_id = _share(owner, friend, song)

    with who.acting_as(friend["id"]):
        for _ in range(3):
            sharing.save_preset(Ask(params={"id": share_id},
                                    body={"from": theirs, "data": {"bands": []}}))
        assert len(db.query("SELECT id FROM sound_presets")) == 1


# ── the boundary ─────────────────────────────────────────────────────────────
def test_a_share_does_not_show_the_sharers_other_songs(pair):
    owner, friend = pair
    with who.acting_as(owner["id"]):
        shared = _song("The shared one")
        _song("A secret one")
        _song("Another secret one")
    share_id = _share(owner, friend, shared)

    with who.acting_as(friend["id"]):
        opened = sharing.open_share(Ask(params={"id": share_id}))
        listed = sharing.shared_with_me(Ask())["shared"]

    assert opened["song"]["title"] == "The shared one"
    assert [row["title"] for row in listed] == ["The shared one"]
    text = json.dumps(opened) + json.dumps(listed)
    assert "secret" not in text, "a share leaked the names of songs it does not cover"


def test_a_share_does_not_carry_the_sharers_other_presets(pair):
    """Presets on another song of theirs are not part of this one."""
    owner, friend = pair
    with who.acting_as(owner["id"]):
        shared = _song("The shared one", preset="Shared preset")
        _song("Elsewhere", preset="Private preset")
    share_id = _share(owner, friend, shared)

    with who.acting_as(friend["id"]):
        opened = sharing.open_share(Ask(params={"id": share_id}))
    assert [p["name"] for p in opened["presets"]] == ["Shared preset"]


def test_a_stranger_cannot_open_a_share_that_is_not_theirs(pair):
    owner, friend = pair
    stranger = accounts.create("nosy", "hello")
    with who.acting_as(owner["id"]):
        song = _song("Kettle")
    share_id = _share(owner, friend, song)

    with who.acting_as(stranger["id"]):
        with pytest.raises(Error) as raised:
            sharing.open_share(Ask(params={"id": share_id}))
    assert raised.value.status == 404


def test_a_share_id_that_does_not_exist_answers_the_same_way(pair):
    """The same answer for "no such share" and "not yours".

    Different answers would turn a small integer into a way of finding out which shares
    exist on this server.
    """
    owner, friend = pair
    with who.acting_as(owner["id"]):
        song = _song("Kettle")
    share_id = _share(owner, friend, song)

    stranger = accounts.create("nosy", "hello")
    with who.acting_as(stranger["id"]):
        with pytest.raises(Error) as mine:
            sharing.open_share(Ask(params={"id": share_id}))
        with pytest.raises(Error) as nothing:
            sharing.open_share(Ask(params={"id": 99999}))
    assert mine.value.status == nothing.value.status == 404
    assert str(mine.value.message) == str(nothing.value.message)


def test_a_revoked_share_stops_opening(pair):
    owner, friend = pair
    with who.acting_as(owner["id"]):
        song = _song("Kettle")
    share_id = _share(owner, friend, song)

    with who.acting_as(owner["id"]):
        sharing.revoke_share(Ask(params={"id": share_id}))

    with who.acting_as(friend["id"]):
        with pytest.raises(Error):
            sharing.open_share(Ask(params={"id": share_id}))
        # The audio too, which is the one route here that hands over a file and therefore
        # the one where "still works after it was taken back" would matter most.
        with pytest.raises(Error):
            sharing.shared_audio(Ask(params={"id": share_id}))
        # And saving, so a revoked share cannot go on writing into their copy either.
        with pytest.raises(Error):
            sharing.save_preset(Ask(params={"id": share_id},
                                    body={"name": "after", "data": {"bands": []}}))
        assert sharing.shared_with_me(Ask())["shared"] == []


def test_revoking_leaves_what_they_made(pair):
    """Their copies are rows in their own library. Reaching in to delete them is exactly
    what this design refuses to do."""
    owner, friend = pair
    with who.acting_as(owner["id"]):
        song = _song("Kettle", preset="Wide master")
    share_id = _share(owner, friend, song)
    with who.acting_as(friend["id"]):
        sharing.save_preset(Ask(params={"id": share_id},
                                body={"name": "Mine", "data": {"bands": []}}))
    with who.acting_as(owner["id"]):
        sharing.revoke_share(Ask(params={"id": share_id}))

    with who.acting_as(friend["id"]):
        assert [r["name"] for r in db.query("SELECT name FROM sound_presets")] == ["Mine"]


def test_only_the_sharer_can_revoke(pair):
    owner, friend = pair
    with who.acting_as(owner["id"]):
        song = _song("Kettle")
    share_id = _share(owner, friend, song)

    with who.acting_as(friend["id"]):
        with pytest.raises(Error) as raised:
            sharing.revoke_share(Ask(params={"id": share_id}))
    assert raised.value.status == 403


def test_the_sharer_cannot_save_into_their_own_share(pair):
    """The sharer edits their song on their own song page. This route is the recipient's."""
    owner, friend = pair
    with who.acting_as(owner["id"]):
        song = _song("Kettle")
        share_id = sharing.make_share(Ask(body={"song": song, "handle": "jozsef"}))["share"]
        with pytest.raises(Error) as raised:
            sharing.save_preset(Ask(params={"id": share_id},
                                    body={"name": "x", "data": {"bands": []}}))
    assert raised.value.status == 403


def test_a_preset_id_from_another_song_is_not_part_of_the_share(pair):
    """The obvious probe: name a preset that belongs to a song you were not given."""
    owner, friend = pair
    with who.acting_as(owner["id"]):
        shared = _song("The shared one")
        _song("Elsewhere", preset="Private preset")
        elsewhere = db.one("SELECT id FROM sound_presets WHERE name = ?",
                           ("Private preset",))["id"]
    share_id = _share(owner, friend, shared)

    with who.acting_as(friend["id"]):
        with pytest.raises(Error) as raised:
            sharing.save_preset(Ask(params={"id": share_id},
                                    body={"from": elsewhere, "data": {"bands": []}}))
    assert raised.value.status == 404


def test_sharing_a_song_you_do_not_have_is_refused(pair):
    owner, friend = pair
    with who.acting_as(friend["id"]):
        # The owner's song id, asked for from the friend's library where it does not exist.
        with pytest.raises(Error) as raised:
            sharing.make_share(Ask(body={"song": 1, "handle": "owner"}))
    assert raised.value.status == 404


def test_you_cannot_share_with_yourself(pair):
    owner, _ = pair
    with who.acting_as(owner["id"]):
        song = _song("Kettle")
        with pytest.raises(Error):
            sharing.make_share(Ask(body={"song": song, "handle": "owner"}))


def test_sharing_twice_says_so_rather_than_making_two(pair):
    owner, friend = pair
    with who.acting_as(owner["id"]):
        song = _song("Kettle")
        sharing.make_share(Ask(body={"song": song, "handle": "jozsef"}))
        with pytest.raises(Error) as raised:
            sharing.make_share(Ask(body={"song": song, "handle": "jozsef"}))
    assert raised.value.status == 409


def test_a_handle_nobody_has_is_refused(pair):
    owner, _ = pair
    with who.acting_as(owner["id"]):
        song = _song("Kettle")
        with pytest.raises(Error) as raised:
            sharing.make_share(Ask(body={"song": song, "handle": "nobody-at-all"}))
    assert raised.value.status == 404


def test_the_thread_is_handed_back_after_every_crossing(pair):
    """Every route here reads another library inside acting_as. If one of them left the
    thread pointed at the sharer, the next thing the request did would write there."""
    owner, friend = pair
    with who.acting_as(owner["id"]):
        song = _song("Kettle", text="words", preset="Wide master")
    share_id = _share(owner, friend, song)

    who.bind(friend["id"])
    for call in (lambda: sharing.shared_with_me(Ask()),
                 lambda: sharing.open_share(Ask(params={"id": share_id})),
                 lambda: sharing.save_preset(Ask(params={"id": share_id},
                                                 body={"name": "m", "data": {"bands": []}}))):
        call()
        assert who.now() == friend["id"], "a share left the thread on the wrong library"


# ── the artwork, which they were shown on purpose ────────────────────────────
#
# Guests saw a letter in a box. Every route that serves an image is scoped to the caller's
# own library, which is right, and it left a share looking like a title and a waveform when
# the cover had been handed over deliberately.

def test_the_route_is_registered():
    """A handler nothing routes to is a feature that exists only in this file."""
    routes = sharing.ROUTES()
    assert ("GET", "/api/shared/<id>/artwork/<image>") in routes, (
        "there is no address a guest could fetch a picture from: %s"
        % sorted(p for m, p in routes))
    assert routes[("GET", "/api/shared/<id>/artwork/<image>")] is sharing.shared_artwork


def test_a_guest_is_told_what_pictures_are_on_a_shared_song(pair):
    owner, friend = pair
    with who.acting_as(owner["id"]):
        song = _song("Kettle")
        first = _artwork(song, caption="the cover", position=0)
        second = _artwork(song, caption="the back", bytes_=b"a second picture", position=1)
    share_id = _share(owner, friend, song)

    with who.acting_as(friend["id"]):
        opened = sharing.open_share(Ask(params={"id": share_id}))

    assert [a["id"] for a in opened["artwork"]] == [first, second], (
        "the share does not carry its pictures, so a guest has nothing to draw: %s"
        % opened.get("artwork"))
    assert [a["caption"] for a in opened["artwork"]] == ["the cover", "the back"]


def test_the_list_says_which_picture_is_the_cover(pair):
    """So a row in the list can look like the song rather than like a letter."""
    owner, friend = pair
    with who.acting_as(owner["id"]):
        song = _song("Kettle")
        cover = _artwork(song, position=0)
        _artwork(song, bytes_=b"a second picture", position=1)
    _share(owner, friend, song)

    with who.acting_as(friend["id"]):
        shown = sharing.shared_with_me(Ask())["shared"]
    assert shown[0]["art"] == cover, \
        "the list points at %r rather than the first picture" % shown[0]["art"]


def test_a_song_with_no_pictures_says_so_quietly(pair):
    owner, friend = pair
    with who.acting_as(owner["id"]):
        song = _song("Bare")
    share_id = _share(owner, friend, song)

    with who.acting_as(friend["id"]):
        assert sharing.open_share(Ask(params={"id": share_id}))["artwork"] == []
        assert sharing.shared_with_me(Ask())["shared"][0]["art"] is None


def test_a_guest_can_fetch_a_picture_from_the_share(pair):
    """The whole point. The bytes come back through the share's own address."""
    owner, friend = pair
    with who.acting_as(owner["id"]):
        song = _song("Kettle")
        image = _artwork(song)
    share_id = _share(owner, friend, song)

    with who.acting_as(friend["id"]):
        got = sharing.shared_artwork(Ask(params={"id": share_id, "image": str(image)}))
    assert got.path and os.path.isfile(got.path), \
        "the picture did not come back as a file a guest could be sent"


def test_a_picture_on_another_song_is_not_part_of_the_share(pair):
    """The id arrives from the caller, so it is checked against the share rather than used.

    Written the way the rest of the boundary tests here are. Given a free choice of image
    id, this route would be a way to read every picture in every library on the server, and
    the sharer's other songs are the nearest thing to hand.
    """
    owner, friend = pair
    with who.acting_as(owner["id"]):
        shared_song = _song("The one they were given")
        _artwork(shared_song)
        private_song = _song("The one they were not")
        private_image = _artwork(private_song, bytes_=b"a private picture")
    share_id = _share(owner, friend, shared_song)

    with who.acting_as(friend["id"]):
        with pytest.raises(Error) as raised:
            sharing.shared_artwork(Ask(params={"id": share_id,
                                               "image": str(private_image)}))
    assert raised.value.status == 404, (
        "asking for a picture from another of the sharer's songs answered %d. It has to be"
        " the same answer as a picture that does not exist, or the reply says which ids are"
        " real in a library they cannot see." % raised.value.status)


def test_a_picture_id_that_is_nobodys_answers_the_same_way(pair):
    owner, friend = pair
    with who.acting_as(owner["id"]):
        song = _song("Kettle")
        _artwork(song)
    share_id = _share(owner, friend, song)

    with who.acting_as(friend["id"]):
        with pytest.raises(Error) as raised:
            sharing.shared_artwork(Ask(params={"id": share_id, "image": "99999"}))
    assert raised.value.status == 404


def test_a_revoked_share_stops_handing_over_pictures(pair):
    """Everything else stops at revocation, and this is not an exception to that."""
    owner, friend = pair
    with who.acting_as(owner["id"]):
        song = _song("Kettle")
        image = _artwork(song)
    share_id = _share(owner, friend, song)
    with who.acting_as(owner["id"]):
        sharing.revoke_share(Ask(params={"id": share_id}))

    with who.acting_as(friend["id"]):
        with pytest.raises(Error) as raised:
            sharing.shared_artwork(Ask(params={"id": share_id, "image": str(image)}))
    assert raised.value.status == 404, (
        "a revoked share answered %d. A picture that cannot be reached because the share is"
        " closed and one that cannot be reached because the file is gone are different"
        " things, and only the first is this test's business." % raised.value.status)


def test_a_stranger_cannot_fetch_a_shared_picture(pair):
    """Not the sender, not the recipient, no."""
    owner, friend = pair
    stranger = accounts.create("nosy", "a password", name="Nosy")
    with who.acting_as(owner["id"]):
        song = _song("Kettle")
        image = _artwork(song)
    share_id = _share(owner, friend, song)

    with who.acting_as(stranger["id"]):
        with pytest.raises(Error) as raised:
            sharing.shared_artwork(Ask(params={"id": share_id, "image": str(image)}))
    assert raised.value.status == 404
