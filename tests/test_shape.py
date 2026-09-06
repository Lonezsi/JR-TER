"""What a render looks like, and whether it is worth playing.

Every take gets a coarse shape and a verdict when it arrives, so the lists can draw it
behind a row and say "silent" before anybody presses play. These tests cover the two
things that go wrong: a file the reader walks off the end of, and a take that arrived
before shapes existed and has to be looked at later.
"""
import math
import os
import struct
import wave

import pytest

from jriter import audio_meta


def _write(path, frames, amp=12000, rate=44100, channels=1, width=2):
    with wave.open(str(path), "wb") as w:
        w.setnchannels(channels)
        w.setsampwidth(width)
        w.setframerate(rate)
        body = bytearray()
        for i in range(frames):
            sample = amp if i % 2 else -amp
            for _ in range(channels):
                body += struct.pack("<h", sample)
        w.writeframes(bytes(body))
    return str(path)


@pytest.mark.parametrize("frames", [1, 7, 60, 119, 120, 121, 5000])
def test_a_short_file_does_not_walk_off_the_end(tmp_path, frames):
    """One column per slice, and a file with fewer frames than columns still answers.

    The reader used to ask wave for a negative number of frames once it passed the end,
    which that module answers by handing back everything left in the chunk. A file of
    seven frames came back looking like a file that repeats its last frame a hundred
    times.
    """
    found = audio_meta.peaks(_write(tmp_path / "short.wav", frames))

    assert len(found["peaks"]) == audio_meta.PEAK_COLUMNS
    assert not found["unreadable"]
    assert not found["silent"]
    # Nothing past the end of the file, and nothing missing before it.
    assert sum(1 for v in found["peaks"] if v) == min(frames, audio_meta.PEAK_COLUMNS)


def test_a_quiet_file_is_called_silent(tmp_path):
    """Not digital zero. A bounce of a muted master carries dither and a noise floor."""
    loud = audio_meta.peaks(_write(tmp_path / "loud.wav", 4000, amp=12000))
    hush = audio_meta.peaks(_write(tmp_path / "hush.wav", 4000, amp=1))

    assert not loud["silent"] and loud["peak_db"] > audio_meta.SILENT_DB
    assert hush["silent"] and hush["peak_db"] < audio_meta.SILENT_DB


def test_a_file_that_is_not_really_a_wav_is_unreadable(tmp_path):
    """A verdict on the row, not an exception that fails somebody's upload."""
    path = tmp_path / "lying.wav"
    path.write_bytes(b"RIFF____WAVEfmt junk that no decoder will take" * 40)

    found = audio_meta.peaks(str(path))
    assert found["unreadable"] and not found["peaks"]


def test_a_format_the_server_cannot_read_is_not_called_silent(tmp_path):
    """An mp3 is not silent, it is undecodable here. Saying "silent" would be a lie the
    browser then contradicts by playing it."""
    path = tmp_path / "song.mp3"
    path.write_bytes(b"\xff\xfb" + b"\x00" * 2000)

    found = audio_meta.peaks(str(path))
    assert not found["silent"] and not found["unreadable"] and not found["peaks"]


def test_the_shape_follows_the_audio(tmp_path):
    """Loud at the start, nothing at the end: the drawing has to show that, because
    where the loud part is is the only thing it is for."""
    path = tmp_path / "half.wav"
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(44100)
        loud = b"".join(struct.pack("<h", 20000 if i % 2 else -20000) for i in range(22050))
        w.writeframes(loud + b"\x00\x00" * 22050)

    shape = audio_meta.peaks(str(path))["peaks"]
    front = shape[:50]
    back = shape[70:]
    # 20000 of a possible 32768, drawn on a scale of 255.
    expected = int((20000 / 32768.0) * 255)
    assert min(front) == expected == max(front), front[:5]
    assert max(back) == 0, max(back)


def _make_song_with_take(server, path, title="Shapely"):
    status, made = server.post("/api/songs", {"title": title})
    assert status == 200, made
    song_id = made["song"]["id"]
    status, up = server.upload("/api/songs/%d/versions" % song_id, path)
    assert status == 200, up
    return song_id


def test_a_take_gets_its_shape_on_arrival(server, wav):
    song_id = _make_song_with_take(server, wav())

    status, listing = server.get("/api/songs/%d/versions" % song_id)
    assert status == 200
    take = listing["versions"][0]
    assert len(take["shape"]) == audio_meta.PEAK_COLUMNS
    assert take["trouble"] == ""
    assert take["peak_db"] < 0


def test_examine_fills_in_takes_that_have_no_shape(server, wav):
    """Everything already in a library arrived before this existed. Nothing in ordinary
    use would give those a shape, so the song screen asks for a batch when it opens."""
    from jriter import db

    song_id = _make_song_with_take(server, wav())
    # Exactly the state an older library is in: rows with no shape and no verdict.
    db.run("UPDATE versions SET peaks = '', peak_db = NULL, trouble = ''")

    _, before = server.get("/api/songs/%d/versions" % song_id)
    assert before["versions"][0]["shape"] == []

    status, done = server.post("/api/versions/examine?limit=60")
    assert status == 200, done
    assert done["looked_at"] == 1 and done["left"] == 0

    _, after = server.get("/api/songs/%d/versions" % song_id)
    assert len(after["versions"][0]["shape"]) == audio_meta.PEAK_COLUMNS


def test_examine_says_which_takes_are_silent(server, wav):
    from jriter import db

    song_id = _make_song_with_take(server, wav("quiet.wav", seconds=1.0, level=0.00002))
    db.run("UPDATE versions SET peaks = '', peak_db = NULL, trouble = ''")

    status, done = server.post("/api/versions/examine?limit=60")
    assert status == 200
    assert done["trouble"] == 1, done

    _, after = server.get("/api/songs/%d/versions" % song_id)
    assert after["versions"][0]["trouble"] == "silent"


def test_examine_is_bounded_and_stops(server, wav):
    """Seven hundred files must not hold one request open for a minute, and the screen
    must be able to tell when there is nothing left to ask about."""
    from jriter import db

    for n in range(4):
        _make_song_with_take(server, wav("take%d.wav" % n, seconds=0.4),
                             title="Bounded %d" % n)
    db.run("UPDATE versions SET peaks = '', peak_db = NULL, trouble = ''")

    status, first = server.post("/api/versions/examine?limit=2")
    assert status == 200
    assert first["looked_at"] == 2 and first["left"] == 2

    _, second = server.post("/api/versions/examine?limit=60")
    assert second["looked_at"] == 2 and second["left"] == 0

    _, third = server.post("/api/versions/examine?limit=60")
    assert third["looked_at"] == 0 and third["left"] == 0


def test_examine_does_not_ask_about_the_same_file_forever(server, wav, tmp_path):
    """A file the server cannot decode has to be marked, or every pass looks at it again
    and the screen never stops asking."""
    from jriter import db

    status, made = server.post("/api/songs", {"title": "Elsewhere"})
    song_id = made["song"]["id"]
    mp3 = tmp_path / "elsewhere.mp3"
    mp3.write_bytes(b"\xff\xfb" + b"\x00" * 4000)
    status, up = server.upload("/api/songs/%d/versions" % song_id, str(mp3))
    assert status == 200, up
    db.run("UPDATE versions SET peaks = '', peak_db = NULL, trouble = ''")

    _, first = server.post("/api/versions/examine?limit=60")
    assert first["looked_at"] == 1 and first["trouble"] == 0

    _, second = server.post("/api/versions/examine?limit=60")
    assert second["looked_at"] == 0, "it asked about the same undecodable file again"


# The renders list asks the same question of the other table, and a fix applied to one
# copy and not the other is exactly the kind of thing that goes unnoticed for months.

def test_a_render_gets_its_shape_on_arrival(server, wav):
    status, result = server.upload("/api/renders", wav(seconds=1.0), filename="shapely.wav")
    assert status == 200, result
    assert len(result["render"]["shape"]) == audio_meta.PEAK_COLUMNS
    assert result["render"]["trouble"] == ""


def test_examine_flags_a_silent_render(server, wav):
    from jriter import db

    server.upload("/api/renders", wav("hush.wav", seconds=1.0, level=0.00002),
                  filename="hush.wav")
    db.run("UPDATE renders SET peaks = '', peak_db = NULL, trouble = ''")

    status, done = server.post("/api/renders/examine?limit=60")
    assert status == 200, done
    assert done["looked_at"] == 1 and done["trouble"] == 1 and done["left"] == 0

    _, listing = server.get("/api/renders")
    assert listing["renders"][0]["trouble"] == "silent"


def test_render_examine_does_not_ask_about_the_same_file_forever(server, tmp_path):
    from jriter import db

    mp3 = tmp_path / "elsewhere.mp3"
    mp3.write_bytes(b"\xff\xfb" + b"\x00" * 4000)
    status, up = server.upload("/api/renders", str(mp3), filename="elsewhere.mp3")
    assert status == 200, up
    db.run("UPDATE renders SET peaks = '', peak_db = NULL, trouble = ''")

    _, first = server.post("/api/renders/examine?limit=60")
    assert first["looked_at"] == 1 and first["trouble"] == 0

    _, second = server.post("/api/renders/examine?limit=60")
    assert second["looked_at"] == 0, "it asked about the same undecodable file again"
