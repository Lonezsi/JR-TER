"""Making the video, and sending it.

None of this needs ffmpeg on the machine and none of it needs a YouTube account, which is
the point: the two pieces most likely to be wrong are the ffmpeg argv and the resumable
protocol's odd answers, and both can be checked without either.

What is NOT covered here, said plainly so nobody reads a green suite as more than it is:
no real encode has been run, and no request has ever reached Google. The first real upload
is the first time the whole path runs end to end.
"""
import io
import urllib.error
import urllib.request

import pytest

from jriter import video
from jriter.modules import youtube


def test_the_page_is_told_when_ffmpeg_is_missing(server, monkeypatch):
    monkeypatch.setattr(video, "_candidates", lambda: iter(()))
    video.forget()
    status, said = server.get("/api/youtube/tool")
    assert status == 200 and said["found"] is False
    # Both fixes named, because one of them is the only one that works on the host, where
    # the server runs as SYSTEM and a user's PATH is not its PATH.
    assert "Install ffmpeg" in said["why"] and "Settings" in said["why"]
    video.forget()


def test_a_path_that_exists_is_not_a_program_that_runs(tmp_path, monkeypatch):
    """Find-Python's lesson, kept. A file at the right path that exits non zero is not
    ffmpeg, and treating it as one means every upload fails much later and less clearly."""
    stub = tmp_path / "ffmpeg"
    stub.write_text("", encoding="utf-8")
    monkeypatch.setattr(video, "_candidates", lambda: iter([str(stub)]))
    video.forget()
    assert video.find()["found"] is False
    video.forget()


def test_a_path_typed_into_settings_beats_every_guess(monkeypatch):
    """The host is the reason this setting exists at all, so the order matters more than
    it looks: a guess that happens to find something must not win over an answer."""
    from jriter import config
    monkeypatch.setattr(config, "settings", lambda: {"ffmpeg_path": "  C:/told/ffmpeg.exe "})
    monkeypatch.setattr(video.shutil, "which", lambda name: "C:/guessed/ffmpeg.exe")
    assert next(video._candidates()) == "C:/told/ffmpeg.exe"


def test_the_command_loops_the_still_and_knows_when_to_stop():
    argv = video.video_argv("ffmpeg", "still.png", "mix.wav", 241.5, "out.mp4")
    # -framerate is an input option too: setting only the output rate makes ffmpeg loop
    # the still at 25 and throw frames away.
    assert argv[argv.index("-loop") + 2] == "-framerate"
    # Before the input, or it applies to nothing and the video is one frame long, which
    # YouTube accepts and shows as a black screen for the rest of the song.
    assert argv.index("-loop") < argv.index("still.png")
    # Both, because a -shortest that does not fire leaves ffmpeg encoding forever on a
    # machine nobody is sitting at.
    assert "-shortest" in argv and argv[argv.index("-t") + 1] == "241.500"
    # A PNG decodes to RGB and libx264 will write yuv444p given the chance, which YouTube
    # rejects and no phone plays.
    assert argv[argv.index("-pix_fmt") + 1] == "yuv420p"
    assert argv[-1].endswith(".mp4")
    # No resample. The mix is whatever rate the render was, and changing it on the way out
    # is a change to the sound made behind the person's back.
    assert "-ar" not in argv
    # The index at the front, so it plays while it downloads.
    assert argv[argv.index("-movflags") + 1] == "+faststart"


def test_no_artwork_is_a_colour_and_not_a_missing_file():
    argv = video.video_argv("ffmpeg", None, "mix.wav", 10.0, "out.mp4")
    assert "lavfi" in argv and "color=c=" in " ".join(argv)
    assert "-loop" not in argv


def test_the_still_is_padded_to_an_even_canvas():
    """libx264 refuses an odd width or height, and a cover is whatever shape it is."""
    argv = video.still_argv("ffmpeg", "cover.jpg", "still.png")
    filters = argv[argv.index("-vf") + 1]
    assert "force_original_aspect_ratio=decrease" in filters
    assert "pad=1280:720" in filters
    assert video.CANVAS == (1280, 720)
    assert video.CANVAS[0] % 2 == 0 and video.CANVAS[1] % 2 == 0


def test_a_build_without_libx264_says_what_to_do():
    said = video.why_it_failed(["[libx264 @ 0x1] whatever",
                                "Unknown encoder 'libx264'"])
    assert "libx264" in said and "Settings" in said
    # Everything else is handed over verbatim, because ffmpeg's own error is nearly always
    # more use than anything written about it here.
    assert video.why_it_failed(["Invalid data found when processing input"]) == ""


def test_a_finished_upload_is_not_sent_a_second_time(monkeypatch):
    """The connection broke after the last byte and before the reply. Asking the session
    what it has is the only way to tell that from a failure, and getting it wrong puts the
    same song on the channel twice."""
    def opener(request, timeout=0):
        raise urllib.error.HTTPError(request.full_url, 200, "OK", {},
                                     io.BytesIO(b'{"id": "abc123"}'))
    monkeypatch.setattr(urllib.request, "urlopen", opener)
    where = youtube._how_far("https://example.invalid/session", 1000)
    assert where == {"done": True, "video": {"id": "abc123"}}


def test_a_308_with_no_range_starts_at_zero(monkeypatch):
    """YouTube has nothing yet. Reading the missing header as a failure would turn a fresh
    start into a dead end."""
    def opener(request, timeout=0):
        raise urllib.error.HTTPError(request.full_url, 308, "Resume Incomplete", {},
                                     io.BytesIO(b""))
    monkeypatch.setattr(urllib.request, "urlopen", opener)
    assert youtube._how_far("https://example.invalid/session", 1000) == {
        "done": False, "sent": 0}


def test_a_308_with_a_range_picks_up_where_it_stopped(monkeypatch):
    """The header is inclusive, so the next byte is one past what it names. An off by one
    here sends a duplicate byte and YouTube rejects the whole range."""
    def opener(request, timeout=0):
        raise urllib.error.HTTPError(request.full_url, 308, "Resume Incomplete",
                                     {"Range": "bytes=0-524287"}, io.BytesIO(b""))
    monkeypatch.setattr(urllib.request, "urlopen", opener)
    assert youtube._how_far("https://example.invalid/s", 1000) == {
        "done": False, "sent": 524288}


def test_a_session_youtube_has_forgotten_says_so(monkeypatch):
    def opener(request, timeout=0):
        raise urllib.error.HTTPError(request.full_url, 404, "Not Found", {},
                                     io.BytesIO(b"{}"))
    monkeypatch.setattr(urllib.request, "urlopen", opener)
    with pytest.raises(Exception) as caught:
        youtube._how_far("https://example.invalid/s", 1000)
    assert "Nothing was published" in str(getattr(caught.value, "message", caught.value))


def test_running_out_of_quota_says_what_that_means(monkeypatch):
    """"quotaExceeded" on its own tells somebody nothing they can act on."""
    body = b'{"error": {"errors": [{"reason": "quotaExceeded"}], "message": "no"}}'
    said = youtube._google_said(
        urllib.error.HTTPError("https://x", 403, "Forbidden", {}, io.BytesIO(body)))
    assert "six a day" in said and "midnight Pacific" in said


def test_a_mix_that_was_never_sent_cannot_be_uploaded(server):
    status, song = server.post("/api/songs", {"title": "Nothing"})
    status, said = server.post("/api/songs/%d/youtube/upload" % song["song"]["id"],
                               {"digest": "0" * 64, "title": "Nothing"})
    assert status == 409 and "not on the server" in said["error"]


def test_the_row_records_what_youtube_said_not_what_was_asked(server):
    """Asking for public and being made private is the ordinary case until the Google
    project is audited, and the record has to hold the truth or it is not worth keeping."""
    status, made = server.post("/api/songs", {"title": "Landed"})
    song = made["song"]

    job = {"version_id": None, "mix_digest": "f" * 64, "log": [],
           "privacy_asked": "public"}
    youtube._job = dict(job, id="test", song_id=song["id"], song_title=song["title"],
                        state="uploading", step="", at=0.0, sent=0, total=0,
                        video_id="", url="", privacy_got="", error="", fix="",
                        session="", started_at=0.0, finished_at=0.0, cancel=False)
    resource = {"id": "vid123",
                "snippet": {"title": "Landed"},
                "status": {"privacyStatus": "private"}}
    youtube._land(youtube._job, song, resource, "")

    status, posts = server.get("/api/songs/%d/youtube" % song["id"])
    assert status == 200
    row = posts["posts"][0]
    assert row["url"].endswith("vid123")
    assert row["status"] == "private", "it recorded what the form asked for"
    youtube._job = None


def test_one_upload_at_a_time(server):
    """Two ffmpegs and two uploads on a machine that is also serving the library is not a
    thing to allow by accident."""
    youtube._job = {"state": "encoding", "song_title": "First"}
    try:
        with pytest.raises(Exception) as caught:
            youtube._new_job({"id": 1, "title": "Second"}, None, "d" * 64)
        assert "already uploading" in str(getattr(caught.value, "message", caught.value))
    finally:
        youtube._job = None


def test_the_session_uri_never_reaches_the_page():
    """It is a bearer URL: anything holding it can PUT a video onto the channel."""
    youtube._job = {"state": "uploading", "session": "https://secret.invalid/xyz",
                    "cancel": False, "log": []}
    try:
        shown = youtube._public_job()
        assert "session" not in shown and "cancel" not in shown
    finally:
        youtube._job = None
