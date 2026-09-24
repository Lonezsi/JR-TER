"""Everybody a song is shared with sees what the others made on it, and so does its owner.

Reported on a real song: a friend wrote his own words, changed the picture and mixed it,
and the owner could see none of it. The work was all there, in the friend's library, on the
copy of the song a share makes the first time a guest saves. Nothing read it back out.

These check both halves: that it is shown to the people it should be, and that it is not a
way into anybody's library beyond that one copy.
"""
import io
import time

import pytest

from jriter import db, who, accounts, blobs, config
from jriter.wire import Error
from jriter.modules import sharing

from test_sharing import Ask, _song, _share   # noqa: F401


@pytest.fixture
def three():
    owner = accounts.create("owner", "one password", account_id=accounts.OWNER)
    friend = accounts.create("jozsef", "two", name="Jozsef")
    other = accounts.create("anna", "three", name="Anna")
    return owner, friend, other


def _friend_works(friend, share_id):
    """What the friend did on the real song: words through the share, then a picture and a
    mix on their own copy of it, the way their own song page would put them there."""
    with who.acting_as(friend["id"]):
        sharing.save_sheet(Ask(params={"id": share_id}, body={"text": "my own verse"}))
        sharing.save_preset(Ask(params={"id": share_id},
                                body={"data": {"bands": []}, "name": "My mix"}))
        copy = db.one("SELECT id FROM songs WHERE shared_from = ?", ("share:%d" % share_id,))
        config.ensure_home()
        digest, size, _ = blobs.put_stream(io.BytesIO(b"picture bytes"), 13)
        art = db.insert("artwork", {"song_id": copy["id"], "digest": digest, "ext": ".jpg",
                                    "caption": "his cover", "position": 0,
                                    "created_at": time.time()})
        mix, size, _ = blobs.put_stream(io.BytesIO(b"RIFF....WAVE"), 12)
        ver = db.insert("versions", {"song_id": copy["id"], "n": 1, "digest": mix,
                                     "ext": ".wav", "size": size, "filename": "his mix.wav",
                                     "created_at": time.time()})
    return art, ver


def test_the_owner_sees_everything_a_guest_made(three):
    owner, friend, _ = three
    with who.acting_as(owner["id"]):
        song = _song("s", text="the owner's words")
    share = _share(owner, friend, song)
    _friend_works(friend, share)

    with who.acting_as(owner["id"]):
        people = sharing.song_guests(Ask(params={"id": song}))["people"]
    assert len(people) == 1
    got = people[0]
    assert got["name"] == "Jozsef" and got["made_anything"]
    assert [s["text"] for s in got["sheets"]] == ["my own verse"]
    assert [p["name"] for p in got["presets"]] == ["My mix"]
    assert [a["caption"] for a in got["artwork"]] == ["his cover"]
    assert [v["filename"] for v in got["versions"]] == ["his mix.wav"]


def test_everybody_else_it_is_shared_with_sees_it_too(three):
    owner, friend, other = three
    with who.acting_as(owner["id"]):
        song = _song("s")
    friend_share = _share(owner, friend, song)
    other_share = _share(owner, other, song, as_name="Anna")
    art, ver = _friend_works(friend, friend_share)

    with who.acting_as(other["id"]):
        people = sharing.shared_guests(Ask(params={"id": other_share}))["people"]
        assert [p["name"] for p in people] == ["Jozsef"], "Anna sees herself or nobody"
        picture = sharing.guest_artwork(Ask(params={"share": friend_share, "image": art}))
        assert picture is not None


def test_a_guest_of_a_different_song_sees_nothing(three):
    owner, friend, other = three
    with who.acting_as(owner["id"]):
        song = _song("s")
        elsewhere = _song("another song")
    friend_share = _share(owner, friend, song)
    other_share = _share(owner, other, elsewhere)
    art, ver = _friend_works(friend, friend_share)

    with who.acting_as(other["id"]):
        assert sharing.shared_guests(Ask(params={"id": other_share}))["people"] == []
        for route, params in ((sharing.guest_artwork, {"image": art}),
                              (sharing.guest_audio, {"version": ver})):
            with pytest.raises(Error) as refused:
                route(Ask(params=dict(params, share=friend_share)))
            assert refused.value.status == 404


def test_a_guest_who_was_taken_back_sees_nothing_more(three):
    owner, friend, other = three
    with who.acting_as(owner["id"]):
        song = _song("s")
    friend_share = _share(owner, friend, song)
    other_share = _share(owner, other, song)
    art, _ = _friend_works(friend, friend_share)
    accounts.revoke_share(other_share)

    with who.acting_as(other["id"]):
        with pytest.raises(Error):
            sharing.guest_artwork(Ask(params={"share": friend_share, "image": art}))


def test_only_the_copy_of_this_song_is_reachable(three):
    """A picture id from any other song in the guest's library is refused, even though
    the viewer may look at this guest's work on this one song."""
    owner, friend, _ = three
    with who.acting_as(owner["id"]):
        song = _song("s")
    friend_share = _share(owner, friend, song)
    _friend_works(friend, friend_share)
    with who.acting_as(friend["id"]):
        private = _song("the friend's private song")
        digest, _, _ = blobs.put_stream(io.BytesIO(b"private"), 7)
        secret = db.insert("artwork", {"song_id": private, "digest": digest, "ext": ".jpg",
                                       "caption": "private", "position": 0,
                                       "created_at": time.time()})

    with who.acting_as(owner["id"]):
        with pytest.raises(Error) as refused:
            sharing.guest_artwork(Ask(params={"share": friend_share, "image": secret}))
    assert refused.value.status == 404


def test_the_owners_list_is_only_for_the_owners_songs(three):
    """song_guests reads the caller's own library, so a guest asking about the owner's song
    id finds nothing of theirs by that number and lists nobody."""
    owner, friend, _ = three
    with who.acting_as(owner["id"]):
        song = _song("s")
    share = _share(owner, friend, song)
    _friend_works(friend, share)
    with who.acting_as(friend["id"]):
        try:
            people = sharing.song_guests(Ask(params={"id": song}))["people"]
        except Error:
            people = []
    assert people == []


def test_the_initials_switch_the_song_to_that_persons_version():
    """Pressing someone's initials shows their picture, words and sound on the song, and
    your own chip (or Back to mine) redraws yours. Nothing is written by either."""
    import os
    src = io.open(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                               "web", "js", "63-guest-work.js"), encoding="utf-8").read()
    click = src[src.index('chips.addEventListener("click"'):]
    click = click[:click.index("\n      });")]
    assert "J.guestWork.see(where, person)" in click, "the initials only scroll"
    assert 'data-guest="me"' in src and "J.router.reload()" in click
    see = src[src.index("  see(root, p) {"):src.index("  /* What the people the song")]
    for part in ("#heroArt", "#lyricsBlock", "#soundBlock", "Back to mine"):
        assert part in see, "their version does not show %s" % part
    assert "J.post(" not in see and "J.put(" not in see and "J.del(" not in see, (
        "looking at somebody's version writes something")


def test_anybodys_mix_and_sound_can_go_on_either_deck():
    """The A/B menu offers every person's mixes and sounds beside your own. A mix plays
    through the guest-work route, never by a version id in your library, and a sound goes
    on the deck without being saved anywhere."""
    import os
    web = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "web", "js")
    song = io.open(os.path.join(web, "60-view-song.js"), encoding="utf-8").read()
    menu = song[song.index("function openSlotMenu("):song.index("function place(menu")]
    assert "guestRows(ctx, held, heldPreset)" in menu, "the A/B menu lists only your own"
    pick = song[song.index("function guestPick(row)"):song.index("function place(menu")]
    assert "url: `/api/guestwork/${share}/audio/${v.id}`" in pick
    handler = menu[menu.index("const guestRow = "):menu.index("const row = e.target")]
    assert "J.player.set(slot, { version: g.version })" in handler
    assert "J.deckSetPreset(ctx, slot, g.preset)" in handler
    assert "J.put(" not in handler and "J.post(" not in handler, "trying a sound saved it"
