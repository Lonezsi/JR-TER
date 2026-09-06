"""The upload, run against a stand in YouTube on a real socket.

See tests/fake_youtube.py for the other half of the conversation, and the note at the
bottom of this file for what a green run here does not mean.
"""
import os
import json
import time
import hashlib
import threading
import urllib.parse

import pytest

import fake_youtube
from jriter import video
from jriter.modules import youtube


@pytest.fixture
def youtube_stand(monkeypatch):
    """A stand in YouTube, with the module pointed at it and an account to send as.

    How the pointing is done, and why it is not an environment variable or a setting: the
    two constants are moved with monkeypatch, in this process, for one test. Both carry a
    bearer token to whatever host they name, and that token is the whole channel. An
    environment variable is read by the real server, which the host starts as SYSTEM out
    of hostsetup/Start-Jriter.ps1, so anything that can put a variable in front of it
    could send a live token somewhere else and nothing would look wrong. A setting is
    worse: config.save_settings is reachable over HTTP.

    config.REPO is an environment variable and this is not, and the difference is worth
    saying rather than assuming: pointing the updater at another repository gets you a bad
    update you can read afterwards. Pointing the uploader at another host gets you a
    credential, once, quietly.

    The address itself is what a stand in cannot prove, so it is pinned separately by
    test_the_addresses_are_the_real_ones and test_the_addresses_are_not_configurable.
    """
    assert youtube.UPLOAD_URL.startswith("https://www.googleapis.com/"), (
        "something has already moved UPLOAD_URL; a run must start from the real one")

    stand, base, stop = fake_youtube.start()
    # The query comes off the production constant rather than being written out again, so
    # what the stand in checks is the real uploadType and the real part list.
    query = urllib.parse.urlsplit(youtube.UPLOAD_URL).query
    monkeypatch.setattr(youtube, "UPLOAD_URL", "%s/upload?%s" % (base, query))
    monkeypatch.setattr(youtube, "TOKEN_URL", base + "/token")
    # Zero, so a suite does not sit through Google's backoff. The real waits are pinned by
    # test_the_backoff_is_still_googles.
    monkeypatch.setattr(youtube, "BACKOFF", (0, 0, 0, 0, 0))

    youtube._save_account({
        "accounts": {"stand": {"client_id": "a-client", "client_secret": "a-secret",
                               "refresh_token": "a-refresh", "name": "Stand in",
                               "channel": "Stand in"}},
        "chosen": "stand"})

    youtube._job = None
    try:
        yield stand
    finally:
        stop()
        _join_the_worker()
        youtube._job = None


@pytest.fixture
def encoder(monkeypatch):
    """ffmpeg, replaced by three megabytes of noise. Returns the bytes it will write.

    The encode has its own tests in test_youtube_video.py and is not what these are about.
    Three megabytes rather than three kilobytes because the payload has to be bigger than
    the socket buffers at both ends: a small body reaches the kernel in one go, so a cut
    halfway through would land after the last write and test the reply path instead of the
    resume path.
    """
    payload = os.urandom(3 << 20)
    monkeypatch.setattr(video, "find", lambda again=False: {
        "found": True, "path": "a-stand-in", "version": "stand in", "why": ""})

    def encode(argv, seconds, say):
        say(0.5)
        with open(argv[-1], "wb") as f:      # video_argv puts the out path last
            f.write(payload)
        return True, []

    monkeypatch.setattr(video, "run", encode)
    return payload


def _join_the_worker(timeout=30):
    """Wait for the upload thread.

    Not tidiness. It opens a SQLite connection of its own, and on Windows a live handle in
    a thread that outlives the test stops pytest taking the temporary library away. It is
    also what makes these deterministic without sprinkling sleeps about.
    """
    for thread in threading.enumerate():
        if thread.name == "youtube-upload":
            thread.join(timeout)
            assert not thread.is_alive(), "the upload thread is still running"


def _wait_until(said, timeout=20):
    """Poll the way the page polls, and fail by saying so rather than hanging."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        if said():
            return
        time.sleep(0.02)
    raise AssertionError("waited %ds and it never happened" % timeout)


def _send_a_mix(server, wav, title="A song"):
    """A song and a real rendered wav in the blob store, as the page would leave them."""
    status, made = server.post("/api/songs", {"title": title})
    assert status == 200, made
    song = made["song"]
    status, mix = server.upload("/api/songs/%d/youtube/mix" % song["id"], wav())
    assert status == 200, mix
    return song, mix["digest"]


def _run_one(server, wav, privacy="private", title="A song"):
    """Start an upload and wait for it to end. Returns (song, the job as the page sees it)."""
    song, digest = _send_a_mix(server, wav, title)
    status, started = server.post("/api/songs/%d/youtube/upload" % song["id"],
                                  {"digest": digest, "title": title,
                                   "privacy": privacy})
    assert status == 200, started
    _join_the_worker()
    status, now = server.get("/api/youtube/job")
    return song, now["job"]


def test_a_whole_upload_from_the_mix_to_the_row(server, wav, youtube_stand, encoder):
    """The one nobody has ever run. Every step between a rendered wav and a row saying
    where it went, over a socket, in order.

    Catches an initiating POST missing a header YouTube fails on, a Location read from the
    wrong place, a PUT that sends the wrong number of bytes, and a _land that writes the
    row from what was asked for rather than from what came back.
    """
    song, job = _run_one(server, wav, privacy="public")
    assert job["state"] == "done", job["error"]
    assert youtube_stand.refused == [], youtube_stand.refused

    begin = youtube_stand.begins[0]
    assert begin["headers"]["Authorization"] == "Bearer tok-1"
    assert begin["declared"] == len(encoder)
    # 10 is Music, and False is right for a music channel. Both are sent rather than left
    # out, and an upload with no answer to the second is left needing attention in Studio.
    assert begin["body"]["snippet"]["categoryId"] == "10"
    assert begin["body"]["status"]["selfDeclaredMadeForKids"] is False

    assert youtube_stand.puts == ["fresh"], youtube_stand.puts
    assert len(youtube_stand.banked) == len(encoder)
    assert youtube_stand.sha() == hashlib.sha256(encoder).hexdigest()

    status, posts = server.get("/api/songs/%d/youtube" % song["id"])
    assert len(posts["posts"]) == 1
    row = posts["posts"][0]
    assert row["video_id"] == "vidStandIn"
    assert row["url"] == "https://www.youtube.com/watch?v=vidStandIn"
    assert row["mix_digest"], "which bytes went up is the thing worth keeping"
    # Asked for public, told private, and the row holds what it was told. Until the Google
    # project is audited that is every upload, so a record holding the request would be
    # wrong every single time.
    assert job["privacy_asked"] == "public" and row["status"] == "private"


def test_a_connection_cut_halfway_is_picked_up_and_not_started_again(
        server, wav, youtube_stand, encoder):
    """A tunnel that drops mid upload. What arrived has to be kept and the rest sent from
    exactly where it stopped.

    Catches the off by one in _how_far, which today is only ever checked against a hand
    built HTTPError: a Range header's end is inclusive, so picking up at that number
    rather than one past it repeats a byte and YouTube rejects the whole range. Catches a
    resume that starts from zero, which uploads the song twice. Catches a Content-Length
    still claiming the whole file on the second try.
    """
    half = len(encoder) // 2
    youtube_stand.cut_after = half
    song, job = _run_one(server, wav)
    assert job["state"] == "done", job["error"]
    assert youtube_stand.refused == [], youtube_stand.refused

    assert youtube_stand.puts == [
        "fresh",
        "query bytes */%d" % len(encoder),
        "bytes %d-%d/%d" % (half, len(encoder) - 1, len(encoder)),
    ], youtube_stand.puts

    assert len(youtube_stand.banked) == len(encoder)
    # The count on its own is not enough. A resume off by one in either direction still
    # adds up to the right number and writes a file nothing will play.
    assert youtube_stand.sha() == hashlib.sha256(encoder).hexdigest()

    # The job's own count runs ahead of the truth, because the kernel takes bytes the
    # session never banks, so it has to be corrected from what the session says.
    assert job["sent"] == job["total"] == len(encoder)

    status, posts = server.get("/api/songs/%d/youtube" % song["id"])
    assert len(posts["posts"]) == 1, "one dropped connection, two videos"


def test_a_reply_that_never_arrived_does_not_upload_the_song_twice(
        server, wav, youtube_stand, encoder):
    """Every byte arrived, the video exists, and the connection broke before the reply.

    This is the one that puts a song on somebody's channel twice, and the only thing
    between here and there is _how_far reading a 200 to the query as done rather than as
    one more failure to retry.
    """
    youtube_stand.cut_at_end = True
    song, job = _run_one(server, wav)
    assert job["state"] == "done", job["error"]

    assert youtube_stand.puts == ["fresh", "query bytes */%d" % len(encoder)]
    assert youtube_stand.carried == ["tok-1"], "the body was sent more than once"
    assert len(youtube_stand.banked) == len(encoder), "the file arrived twice"

    status, posts = server.get("/api/songs/%d/youtube" % song["id"])
    assert len(posts["posts"]) == 1
    assert posts["posts"][0]["video_id"] == "vidStandIn"
    assert job["video_id"] == "vidStandIn"


def test_a_token_that_dies_mid_upload_is_replaced_and_the_upload_goes_on(
        server, wav, youtube_stand, encoder):
    """An access token lasts an hour and an upload can take longer, so this is ordinary
    rather than exceptional, and it is the one thing in the retry loop meant to be
    invisible.

    Fails on the module as it stands, and the stand in is what makes it visible:
    _access_token hands back the token it holds while its own clock says it is good, so
    the retry after a 401 presents the same dead string. Six attempts, six 401s, and an
    upload that ends in "the upload kept breaking" with nothing wrong but a token.
    """
    youtube_stand.kill_one_token = True
    song, job = _run_one(server, wav)
    assert job["state"] == "done", job["error"]

    assert youtube_stand.carried[0] == "tok-1"
    assert youtube_stand.carried[-1] != "tok-1", (
        "the same dead token was presented again: %s" % youtube_stand.carried)
    assert len(youtube_stand.refreshes) >= 2, "no second refresh was ever asked for"
    assert youtube_stand.refreshes[-1]["grant_type"] == "refresh_token"

    assert len(youtube_stand.banked) == len(encoder)
    assert youtube_stand.sha() == hashlib.sha256(encoder).hexdigest()
    status, posts = server.get("/api/songs/%d/youtube" % song["id"])
    assert len(posts["posts"]) == 1


def test_cancel_while_the_bytes_are_moving_actually_stops_them(
        server, wav, youtube_stand, encoder):
    """Fails on the module as it stands, and it fails in the worst direction: the upload
    does not merely carry on, it finishes and _land writes the row, so pressing stop is
    what publishes the song.

    _note returns whether the job has been asked to stop, and every long loop is supposed
    to check the same thing in the same place. The one loop where the bytes are is the one
    that does not: the seen() closure in _upload_with_retries throws the answer away, and
    _Counting.read never asks.
    """
    youtube_stand.trickle = 0.01        # a slow reader, so stop lands mid body
    song, digest = _send_a_mix(server, wav, "Stopped")
    status, started = server.post("/api/songs/%d/youtube/upload" % song["id"],
                                  {"digest": digest, "title": "Stopped"})
    assert status == 200, started

    _wait_until(lambda: server.get("/api/youtube/job")[1]["job"]["sent"] > 0)
    status, said = server.post("/api/youtube/job/cancel")
    assert status == 200, said

    _join_the_worker()
    status, now = server.get("/api/youtube/job")
    assert now["job"]["state"] == "stopped", now["job"]
    # Waited for rather than read straight away. The client raising is what ends the
    # upload, and the stand in notices the reset on its own thread a moment later, so
    # reading this immediately is a race the test loses on a fast machine.
    _wait_until(lambda: youtube_stand.abandoned == 1)
    assert youtube_stand.abandoned == 1, "the PUT was carried to the end"
    assert len(youtube_stand.banked) < len(encoder), (
        "every byte arrived after stop was pressed")

    status, posts = server.get("/api/songs/%d/youtube" % song["id"])
    assert posts["posts"] == [], "pressing stop published the song"

    # And the next one can start. A job left sitting at "uploading" because nobody noticed
    # the cancel blocks every upload after it for the life of the process.
    youtube._new_job({"id": song["id"], "title": "Next"}, None, digest)


def test_nothing_the_page_can_see_carries_the_token_or_the_session(
        server, wav, youtube_stand, encoder):
    """The session URI is a bearer URL: anything holding it can PUT a video onto the
    channel. The access token is the channel itself.

    Stronger than checking _public_job against a job dict the test wrote, because these
    are the real values the stand in minted and every poll while the job ran is checked,
    not one snapshot at the end.

    The 401 is the reason for the second half. _google_said puts the first two hundred
    characters of a body it cannot parse into the message the page shows, and the stand in
    echoes the token into that body on purpose, which is what a captive portal or a
    tunnel's own error page does.
    """
    youtube_stand.trickle = 0.005
    youtube_stand.kill_one_token = True
    song, digest = _send_a_mix(server, wav, "Quiet")
    server.post("/api/songs/%d/youtube/upload" % song["id"],
                {"digest": digest, "title": "Quiet"})

    seen = []
    for _ in range(2000):
        status, now = server.get("/api/youtube/job")
        seen.append(json.dumps(now["job"]))
        if now["job"]["state"] in ("done", "failed", "stopped"):
            break
        time.sleep(0.01)
    _join_the_worker()
    seen.append(json.dumps(server.get("/api/youtube/job")[1]))

    everything = " ".join(seen)
    assert youtube_stand.minted >= 2, "no token was ever minted, so this proved nothing"
    for token in youtube_stand.live | youtube_stand.dead:
        assert token not in everything, "the page was shown %s" % token
    assert "/session/" not in everything


def test_the_job_the_page_sees_is_a_list_of_what_to_show(server):
    """A list of what to hide gets it wrong the moment a field is added.

    The session URI is only off the page because somebody named it, and the next secret
    put in the job would be public until somebody remembered to name that too.
    """
    youtube._job = {"state": "uploading", "session": "https://secret.invalid/xyz",
                    "cancel": False, "log": [], "access_token": "tok-secret"}
    try:
        shown = youtube._public_job()
        assert "session" not in shown and "cancel" not in shown
        assert "access_token" not in shown
    finally:
        youtube._job = None


def test_the_addresses_are_the_real_ones():
    """The stand in proves the conversation. It cannot prove the address, because the
    fixture moves it, so the address is pinned here instead."""
    assert youtube.UPLOAD_URL == ("https://www.googleapis.com/upload/youtube/v3/videos"
                                  "?uploadType=resumable&part=snippet,status")
    assert youtube.TOKEN_URL == "https://oauth2.googleapis.com/token"
    assert youtube.DEVICE_URL == "https://oauth2.googleapis.com/device/code"
    assert youtube.CHANNEL_URL == ("https://www.googleapis.com/youtube/v3/channels"
                                   "?part=snippet&mine=true")
    # The narrowest scope that can upload. force-ssl can also delete, and nothing here
    # needs to be able to delete anything.
    assert youtube.SCOPE == "https://www.googleapis.com/auth/youtube.upload"


def test_the_addresses_are_not_configurable():
    """Each of these carries a bearer token to whatever host it names, and that token is
    the whole channel.

    So they are constants, not settings. A test moves them with monkeypatch, inside one
    process, for one test. Nothing outside may, and this is the test that says so: an
    environment variable is read by the real server, which the host runs as SYSTEM, and a
    setting is worse because config.save_settings is reachable over HTTP.
    """
    import ast
    with open(youtube.__file__, encoding="utf-8") as f:
        tree = ast.parse(f.read())
    named = set()
    for node in ast.walk(tree):
        if not isinstance(node, ast.Assign):
            continue
        for target in node.targets:
            if getattr(target, "id", "") in ("UPLOAD_URL", "TOKEN_URL", "DEVICE_URL",
                                             "CHANNEL_URL", "SCOPE"):
                named.add(target.id)
                # Raises for anything that is not a literal, which is the point: an
                # os.environ.get or a config.settings() here fails this test rather than
                # passing as a convenience.
                ast.literal_eval(node.value)
    assert named == {"UPLOAD_URL", "TOKEN_URL", "DEVICE_URL", "CHANNEL_URL", "SCOPE"}


def test_the_backoff_is_still_googles():
    """The fixture flattens these to nothing so a suite is not five minutes of waiting,
    so the real ones are pinned where nothing has flattened them."""
    assert youtube.BACKOFF == (1, 2, 4, 8, 16)
    assert sum(youtube.BACKOFF) < 60, "a dropped tunnel is not an hour of retrying"


def test_a_500_is_waited_out_rather_than_given_up_on(server, wav, youtube_stand, encoder):
    """Google's own advice for this endpoint. A 500 from the front of the upload path is
    the case where the session never saw the bytes, so the module has to ask before it
    re-sends rather than assuming either way.

    Catches a retry loop that reads a 500 as final, and one that re-sends from a `sent` it
    never corrected, which YouTube answers with a rejected range.
    """
    youtube_stand.fail_once = True
    song, job = _run_one(server, wav)
    assert job["state"] == "done", job["error"]
    assert youtube_stand.puts == ["fresh", "query bytes */%d" % len(encoder), "fresh"]
    assert youtube_stand.sha() == hashlib.sha256(encoder).hexdigest()
    status, posts = server.get("/api/songs/%d/youtube" % song["id"])
    assert len(posts["posts"]) == 1


def test_an_upload_agreed_to_with_nowhere_to_send_it_stops(server, wav, youtube_stand,
                                                           encoder):
    """Guessing a session URI would mean PUTting a video at an address nobody agreed to,
    so there is nothing to carry on from and the job has to say so."""
    youtube_stand.no_location = True
    song, job = _run_one(server, wav)
    assert job["state"] == "failed"
    assert "Nothing has been uploaded" in job["error"]
    assert youtube_stand.puts == [], "a video was sent somewhere"
    status, posts = server.get("/api/songs/%d/youtube" % song["id"])
    assert posts["posts"] == []


def test_a_session_youtube_has_forgotten_is_not_retried_five_times(
        server, wav, youtube_stand, encoder):
    """Sessions go after about a week. A 404 is final, and treating it as retryable burns
    every backoff on a session that is not there."""
    youtube_stand.cut_after = len(encoder) // 2
    youtube_stand.forgotten = True
    song, job = _run_one(server, wav)
    assert job["state"] == "failed"
    assert "Nothing was published" in job["error"]
    assert len([p for p in youtube_stand.puts if p.startswith("query")]) == 1
    status, posts = server.get("/api/songs/%d/youtube" % song["id"])
    assert posts["posts"] == []


def test_a_finished_session_with_no_video_id_sends_you_to_look(
        server, wav, youtube_stand, encoder):
    """_put guards against a reply it cannot read and _how_far does not, so this arrives
    at _land as resource["id"] and a KeyError, and the person is handed a reference number
    instead of being told to check their channel before uploading it again."""
    youtube_stand.cut_at_end = True
    youtube_stand.video_id = ""
    song, job = _run_one(server, wav)
    assert job["state"] == "failed"
    assert "Check your channel" in job["error"]
    status, posts = server.get("/api/songs/%d/youtube" % song["id"])
    assert posts["posts"] == []


def test_the_note_on_disk_says_how_far_it_actually_got(server, wav, youtube_stand,
                                                       encoder):
    """The host kills this process whenever two health probes miss, so a restart mid
    upload is ordinary rather than exceptional, and work/<id>.json is the only thing a
    restarted server has to go on.

    Today _remember_on_disk is called once, straight after _begin, so the note always says
    sent 0 however far the upload got, while the comment above _lock says it is written
    "as it changes". One of the two is wrong.
    """
    youtube_stand.cut_after = len(encoder) // 2
    youtube_stand.forgotten = True          # so the job stops with the note still there
    song, job = _run_one(server, wav)
    assert job["state"] == "failed"

    room = os.path.join(youtube._work_dir())
    notes = [n for n in os.listdir(room) if n.endswith(".json")]
    assert notes, "nothing was written down at all"
    with open(os.path.join(room, notes[0]), encoding="utf-8") as f:
        note = json.load(f)
    assert note["session"], "the one thing that cannot be worked out again"
    assert note["total"] == len(encoder)
    # Not an exact number, and it should not be. The note holds what the client handed
    # over, which runs up to one read buffer ahead of what the far end has banked, and
    # the exact figure is _how_far's job on the next attempt. What matters is that it is
    # the real position rather than nought: nought is what it always said before, and a
    # restarted server reading that would ask from the beginning.
    cut = len(encoder) // 2
    assert cut <= note["sent"] <= cut + 65536, (
        "the note says %s and the upload was cut at %s" % (note["sent"], cut))


# What this cannot prove, said plainly, because a green suite here is not an integration.
#
# Real Google behaviour. The stand in does what the documentation says and what this code
# expects, which is not the same as what Google does. It does not rewrite a title, has no
# processing stage that can fail an hour after the upload succeeded, never answers 403 for
# a suspended channel, never rate limits, and never takes forty minutes over a PUT.
#
# Quota. UPLOAD_COST and the message about six a day are a reading of Google's published
# numbers. Nothing here checks that arithmetic against a real project, and the number is
# Google's to change.
#
# The audit rule. Until a Google project is audited, everything it uploads is forced
# private whatever privacyStatus asks for. The stand in can be told to answer private and
# the row test uses that, but all it proves is that the module records what it is told. It
# does not prove Google does the forcing, and it will not notice on the day the audit
# lands and public starts meaning public.
#
# The shape of a real video resource. Stand.resource carries id, snippet.title and
# status.privacyStatus, because those three are all this module reads. A real one carries
# etag, channelId, publishedAt, thumbnails and a processing block. If YouTube moves or
# renames one of the three, this suite stays green.
#
# The first real upload. Nothing here has ever held a Google account, so the first time a
# client id, a token and somebody's channel are all involved is still the first time.
