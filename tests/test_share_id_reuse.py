"""A share must never reach a song it was not made for.

THE HOLE THIS CLOSES. A share names its song by id, and a song id is a SQLite rowid. SQLite
hands out the highest rowid plus one, so deleting the newest song and then making another
gives the new song the old number, and erasing a library starts every number again from 1.
A share left open across either was a share of whatever song came to hold that number next.
Found by reproducing it: share song 2, delete it, make a private song, and the guest opened
the private one, with its words, its sound and its pictures.

Two defences, and both are tested, because each covers what the other cannot:

  1. Deleting a song, or erasing a library, takes its shares with it.
  2. Every route that crosses into the sharer's library checks the song is the one that was
     shared: a song made after its share is a different song wearing the shared one's
     number. That holds for shares opened before the fix existed, and for any song that
     leaves by a path nobody thought of.

Each test is written as the attack, and asserts the answer is no.
"""
import time

import pytest

from jriter import db, who, accounts
from jriter.wire import Error
from jriter.modules import sharing, songs, export

from test_sharing import Ask, _song, _share, _artwork, pair   # noqa: F401  (fixture)


def _replace_the_shared_song(owner, song_id):
    """Delete the shared song and make a private one that lands on the same id.

    Returns the new song's id, and asserts it really is the old number: if SQLite ever
    stopped reusing it, these tests would pass for the wrong reason and say nothing.
    """
    with who.acting_as(owner["id"]):
        db.run("DELETE FROM songs WHERE id = ?", (song_id,))
        # Strictly later than the share, as it is in life: the share came first.
        time.sleep(0.01)
        private = _song("A brand new private song", text="nobody was shown this",
                        preset="My private sound")
        _artwork(private, caption="private cover")
    assert private == song_id, (
        "SQLite did not reuse the id (%s, then %s), so this test is not testing the hole"
        % (song_id, private))
    return private


# ── defence 2: the song has to be the one that was shared ───────────────────

def test_a_share_does_not_open_a_song_that_took_the_shared_ones_id(pair):
    """The reproduction, exactly. The row was deleted directly, not through the route,
    so this is the check in _song_in on its own, with nothing revoking the share."""
    owner, friend = pair
    with who.acting_as(owner["id"]):
        shared = _song("Kettle", text="first verse")
    share_id = _share(owner, friend, shared)
    _replace_the_shared_song(owner, shared)

    with who.acting_as(friend["id"]):
        with pytest.raises(Error) as refused:
            sharing.open_share(Ask(params={"id": share_id}))
    assert refused.value.status == 410, refused.value
    assert "private" not in str(refused.value).lower()


def test_the_list_of_shares_does_not_name_the_new_song(pair):
    owner, friend = pair
    with who.acting_as(owner["id"]):
        shared = _song("Kettle")
    _share(owner, friend, shared)
    _replace_the_shared_song(owner, shared)

    with who.acting_as(friend["id"]):
        shown = sharing.shared_with_me(Ask())["shared"]
    assert not [s for s in shown if "private" in s["title"].lower()], (
        "the guest's list of shared songs names somebody's private song: %s" % shown)


def test_the_new_songs_pictures_are_not_served_through_the_old_share(pair):
    """The route that skipped the check. It went straight to the song id for its list of
    allowed pictures, so it served the new song's cover even once everything else said
    no."""
    owner, friend = pair
    with who.acting_as(owner["id"]):
        shared = _song("Kettle")
    share_id = _share(owner, friend, shared)
    _replace_the_shared_song(owner, shared)
    with who.acting_as(owner["id"]):
        private_art = db.one("SELECT id FROM artwork WHERE caption = 'private cover'")["id"]

    with who.acting_as(friend["id"]):
        with pytest.raises(Error) as refused:
            sharing.shared_artwork(Ask(params={"id": share_id, "image": private_art}))
    assert refused.value.status in (404, 410), refused.value


def test_nothing_can_be_copied_out_of_the_new_song(pair):
    """Saving names the sharer's preset or sheet it started from, looked up by the share's
    song id. With the id reused, that lookup found the private song's rows.

    THE GUEST HAS SAVED BEFORE, deliberately. The copy song on their side is made on the
    first save, and making it was the one place the shared song used to be checked. Once
    it existed, every later save went straight past: the private preset's name was read
    and written into the guest's own library as "My private sound, edited by Jozsef". A
    guest who had never saved was protected by accident, which is how the first version of
    this test passed with the save routes' own checks taken out.
    """
    owner, friend = pair
    with who.acting_as(owner["id"]):
        shared = _song("Kettle", text="first verse", preset="Wide master")
    share_id = _share(owner, friend, shared)
    with who.acting_as(friend["id"]):
        sharing.save_preset(Ask(params={"id": share_id}, body={"data": {"bands": []}}))
        sharing.save_sheet(Ask(params={"id": share_id}, body={"text": "my verse"}))

    _replace_the_shared_song(owner, shared)
    with who.acting_as(owner["id"]):
        preset = db.one("SELECT id FROM sound_presets WHERE name = 'My private sound'")["id"]
        sheet = db.one("SELECT id FROM lyric_sheets WHERE song_id = ?", (shared,))["id"]

    with who.acting_as(friend["id"]):
        with pytest.raises(Error) as a:
            sharing.save_preset(Ask(params={"id": share_id},
                                    body={"data": {"bands": []}, "from": preset}))
        with pytest.raises(Error) as b:
            sharing.save_sheet(Ask(params={"id": share_id},
                                   body={"text": "mine", "from": sheet}))
        names = [r["name"] for r in db.query("SELECT name FROM sound_presets")]
        names += [r["name"] for r in db.query("SELECT name FROM lyric_sheets")]
    assert a.value.status == 410 and b.value.status == 410
    assert not [n for n in names if "private" in n.lower()], (
        "a private preset's name was copied into the guest's library: %s" % names)


def test_the_audio_of_the_new_song_is_not_served(pair):
    owner, friend = pair
    with who.acting_as(owner["id"]):
        shared = _song("Kettle")
    share_id = _share(owner, friend, shared)
    _replace_the_shared_song(owner, shared)

    with who.acting_as(friend["id"]):
        with pytest.raises(Error) as refused:
            sharing.shared_audio(Ask(params={"id": share_id}))
    assert refused.value.status == 410


def test_a_song_that_is_still_the_shared_one_opens_as_before(pair):
    """The check must not refuse the ordinary case. A song edited after it was shared has
    a later updated_at, never a later created_at."""
    owner, friend = pair
    with who.acting_as(owner["id"]):
        shared = _song("Kettle", text="first verse")
    share_id = _share(owner, friend, shared)
    with who.acting_as(owner["id"]):
        time.sleep(0.01)
        db.run("UPDATE songs SET title = 'Kettle, renamed', updated_at = ? WHERE id = ?",
               (time.time(), shared))

    with who.acting_as(friend["id"]):
        opened = sharing.open_share(Ask(params={"id": share_id}))
    assert opened["song"]["title"] == "Kettle, renamed"


# ── defence 1: the song going takes its shares with it ──────────────────────

def test_deleting_a_song_takes_back_its_shares(pair):
    owner, friend = pair
    with who.acting_as(owner["id"]):
        shared = _song("Kettle")
        kept = _song("Another one")
    gone_share = _share(owner, friend, shared)
    kept_share = _share(owner, friend, kept)

    with who.acting_as(owner["id"]):
        said = songs.delete_song(Ask(params={"id": shared}))
    assert said["shares_taken_back"] == 1
    assert accounts.share(gone_share)["revoked_at"], "the deleted song's share is still open"
    assert not accounts.share(kept_share)["revoked_at"], (
        "deleting one song took back the share of a different one")


def test_erasing_a_library_takes_back_every_share_it_made(pair):
    owner, friend = pair
    with who.acting_as(owner["id"]):
        first = _song("Kettle")
        second = _song("Another one")
    a = _share(owner, friend, first)
    b = _share(owner, friend, second)

    # And one the friend made, which the owner's erase has no business touching.
    with who.acting_as(friend["id"]):
        theirs = _song("Friend's own song")
    with who.acting_as(friend["id"]):
        made = sharing.make_share(Ask(body={"song": theirs, "handle": owner["handle"]}))

    from jriter import config
    with who.acting_as(owner["id"]):
        name = config.settings().get("library_name", "JR!TER")
        export.erase(Ask(body={"confirm": name}))

    assert accounts.share(a)["revoked_at"] and accounts.share(b)["revoked_at"], (
        "an erased library left its shares open, and its songs are numbered from 1 again")
    assert not accounts.share(made["share"])["revoked_at"], (
        "erasing one library took back a share somebody else had made")
