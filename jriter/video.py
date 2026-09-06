"""Turning a mix and a picture into a video, when the machine has ffmpeg on it.

Not a module. It sits beside audio_meta.py for the same reason: "how long is this file"
and "make an MP4 out of these two" are both capabilities rather than features, nothing
routes to them, and youtube.py imports this the way renders.py imports audio_meta.

ffmpeg is not a dependency. It is a program you install. JR!TER looks for it, and when it
is not there the upload page says so and offers nothing it cannot do. Everything else on
that page keeps working, because the mix is rendered in the browser and always was.
"""
import os
import glob
import shutil
import hashlib
import zipfile
import subprocess
import urllib.error
import urllib.request

from . import config
from .wire import Error


def _candidates():
    """Where to look, most likely to be right first.

    This is Find-Python in hostsetup/Start-Jriter.ps1, and for the same reason: the host
    runs the server as SYSTEM, which has no profile of its own, so a program installed by
    a user is not on this process's PATH and never will be. PATH is still asked first,
    because when there is a profile it is the right answer.
    """
    told = (config.settings().get("ffmpeg_path") or "").strip()
    if told:
        yield told                      # a path typed into Settings beats every guess
    found = shutil.which("ffmpeg")
    if found:
        yield found
    # The copy JR!TER fetched, if it ever did. Third on purpose: a typed path is an answer
    # and beats every guess, and one on PATH is one this machine's owner put there. This
    # only comes before the guesses below because it is the single entry in this function
    # that is a fact rather than a place worth looking.
    yield managed_path()
    if os.name == "nt":
        for pattern in (
                r"C:\Users\*\AppData\Local\Microsoft\WinGet\Packages\*FFmpeg*\**\ffmpeg.exe",
                r"C:\Users\*\scoop\apps\ffmpeg\current\bin\ffmpeg.exe",
                r"C:\Users\*\AppData\Local\Programs\*ffmpeg*\bin\ffmpeg.exe"):
            for hit in sorted(glob.glob(pattern, recursive=True)):
                yield hit
        for fixed in (r"C:\ffmpeg\bin\ffmpeg.exe",
                      r"C:\Program Files\ffmpeg\bin\ffmpeg.exe",
                      r"C:\ProgramData\chocolatey\bin\ffmpeg.exe"):
            yield fixed
    else:
        for fixed in ("/usr/bin/ffmpeg", "/usr/local/bin/ffmpeg",
                      "/opt/homebrew/bin/ffmpeg"):
            yield fixed


def _runs(path):
    """A path that exists is not a program that runs. Returns the version line, or None.

    Find-Python learned this against the WindowsApps alias, which exists, is executable,
    and opens the Store instead of Python. There is no such alias for ffmpeg, but a
    half finished download, a wrapper script and a build for the wrong architecture all
    fail in the same shape, so the test is the same one: run it and read what it says.
    """
    if not path or not os.path.isfile(path):
        return None
    try:
        done = subprocess.run([path, "-hide_banner", "-version"],
                              capture_output=True, text=True, timeout=15,
                              stdin=subprocess.DEVNULL)
    except (OSError, subprocess.SubprocessError):
        return None
    first = (done.stdout or "").splitlines()[:1]
    if done.returncode != 0 or not first or not first[0].startswith("ffmpeg version"):
        return None
    return first[0].strip()


#: Worked out once, for the reason updater._COMMIT is worked out once: the upload page
#: asks on every load, and starting a process to answer a question whose answer cannot
#: change while the server runs is eighty milliseconds of nothing, several times a minute.
_FOUND = None

MISSING = ("JR!TER cannot find ffmpeg on this machine, so it cannot turn the mix into a "
           "video. Install ffmpeg and restart JR!TER, or put the full path to ffmpeg.exe "
           "in Settings.")


import os
import glob
import shutil
import hashlib
import zipfile
import subprocess
import urllib.error
import urllib.request

from . import config
from .wire import Error

# ...

# ── getting one, when there is not one ──────────────────────────────────
#
# Everything above this line is still true: ffmpeg is a program you install, and the
# looking comes first. What changed is that on the host there is nobody to install it.
#
# The operating system's own package manager was the obvious answer and it does not work
# here. winget.exe on this host is at C:\Users\mayer\AppData\Local\Microsoft\WindowsApps\
# winget.exe, and that is not a program: it is an app execution alias, a reparse point the
# loader resolves through the calling user's MSIX package registrations. SYSTEM has no
# registrations, so it resolves to nothing and running it fails as though the file were
# absent. Find-Python learned the same lesson against the Python alias in the same folder.
# The package itself, under C:\Program Files\WindowsApps, is ACL'd away even from
# administrators, and Microsoft says plainly that winget is not supported as SYSTEM. Even
# if it ran, a default install lands in the caller's profile, which for SYSTEM is
# C:\Windows\System32\config\systemprofile, a directory _candidates does not look in.
#
# So there is one path, and it is the same path for the service and for a person running
# server.py from their own account: fetch one pinned build and check its SHA-256 against a
# constant in this file before anything is executed.

#: The build, pinned. Deliberately not "latest", and deliberately not gyan.dev's rolling
#: ffmpeg-release-essentials.zip: with either of those the bytes behind the URL change
#: while this file does not, and the only checksum left to compare against is one fetched
#: from the same host over the same connection, which proves the download was not
#: corrupted in flight and nothing else. A version and a digest written here are read in a
#: diff by a person, which is the only review this repository has.
#:
#: essentials rather than full: it carries libx264, which is what video_argv needs and
#: what why_it_failed already has a sentence about, and nothing here wants the rest.
BUILD = {
    "version": "7.1",
    "url": ("https://github.com/GyanD/codexffmpeg/releases/download/"
            "7.1/ffmpeg-7.1-essentials_build.zip"),
    #: What this digest is, exactly, because it is worth being precise about.
    #:
    #: That release publishes no .sha256 companion, which was checked rather than assumed:
    #: the six assets on the 7.1 tag are three archives in two formats and nothing else.
    #: So this is not a publisher's attestation. It is the digest of the bytes that were
    #: fetched over TLS from that URL, unpacked, and run: ffmpeg 7.1-essentials_build,
    #: gcc 14.2.0, configured --enable-libx264, which is the one thing video_argv cannot
    #: do without. Its size also matches what GitHub's own API reports for the asset.
    #:
    #: What it buys is therefore change detection rather than provenance: every machine
    #: that fetches this gets byte for byte what was verified when the pin was written,
    #: and a substituted archive or a taken over URL is refused. Bumping the version
    #: means fetching the new one, checking it the same way, and pasting the new digest
    #: in the same commit.
    "sha256": "fa7d4d7e795db0e2503f49f105f46ed5852386f0cfdd819899be3b65ebde24fc",
    #: The real size, so the page has a total to draw against before the first byte
    #: lands and a missing Content-Length is not a reason to show no bar. Not a gate:
    #: the digest is the gate. The first draft of this said 27MB, which is the .7z; the
    #: zip is this.
    "size": 92100272,
    #: The one file wanted out of the archive. ffprobe is not in this list because it is
    #: not used anywhere: audio_meta.py parses wav and mp3 headers itself.
    "member": "bin/ffmpeg.exe",
}

#: Nothing is fetched at all until this passes, so a half finished pin cannot become a
#: program that runs. The placeholder above fails it, on purpose.
def _pinned_digest():
    want = BUILD["sha256"].strip().lower()
    if len(want) != 64 or want.strip("0123456789abcdef"):
        raise Error("BUILD['sha256'] in jriter/video.py is not a SHA-256, so JR!TER will "
                    "not download anything. Put the digest from the publisher's .sha256 "
                    "file there first.", 500)
    return want

#: A ceiling on both the download and the unpacked file. The pinned build is nowhere near
#: this. It is here so that a URL that one day answers with something else cannot fill the
#: host's system drive before the digest gets a chance to refuse it.
MOST = 400 * 1024 * 1024

#: A megabyte at a time, blobs.CHUNK's number for blobs.CHUNK's reason: big enough that
#: the loop is not the cost, small enough that the archive never sits in the memory of a
#: process that is about to run ffmpeg.
CHUNK = 1024 * 1024


def tools_dir():
    """Where a fetched ffmpeg lives. Not the library, not the checkout, not a profile.

    Not config.DATA, because config.py's first comment is that everything the user owns
    lives under one directory so a backup is one copy, and that stops being true the
    moment a hundred and fifty megabytes of somebody else's binary is inside it.

    Not config.BASE. .gitignore covers data/ and nothing else, so an untracked tree in
    the checkout makes `git status --porcelain` non empty, and updater.apply refuses to
    pull when it is: one download would end self updating for ever, with a message about
    uncommitted changes that names nothing anybody edited.

    Not a user profile, for the whole reason _candidates exists. ProgramData is machine
    wide, is on every Windows, SYSTEM can write it and every user can read it, so the
    copy the service fetched is the copy a person running server.py by hand also finds.
    """
    told = (os.environ.get("JRITER_TOOLS") or "").strip()
    if told:
        return told
    if os.name == "nt":
        return os.path.join(os.environ.get("ProgramData") or r"C:\ProgramData",
                            "JRITER", "tools")
    return os.path.join(os.path.expanduser("~"), ".local", "share", "jriter", "tools")


def managed_path():
    """The copy JR!TER fetched, named after the version it pinned.

    The version is in the directory name so that editing BUILD is enough. Under a fixed
    name, an older copy that still runs would keep passing _runs and winning for ever,
    and bumping the pin would change nothing at all: a change that silently does nothing
    is worse than one that fails.
    """
    exe = "ffmpeg.exe" if os.name == "nt" else "ffmpeg"
    return os.path.join(tools_dir(), "ffmpeg-" + BUILD["version"], exe)


def find(again=False):
    global _FOUND
    if _FOUND is not None and not again:
        return _FOUND
    for path in _candidates():
        version = _runs(path)
        if version:
            _FOUND = {"found": True, "path": path, "version": version, "why": ""}
            return _FOUND
    _FOUND = {"found": False, "path": "", "version": "", "why": MISSING}
    return _FOUND


def forget():
    """Called when ffmpeg_path is saved, so the next look is a real one."""
    global _FOUND
    _FOUND = None


def _download(into, say):
    """Fetch the archive, hashing as it lands. Returns (size, digest), or None if stopped.

    Hashed on the way past rather than read again afterwards, which is put_stream's
    reasoning: the bytes are already going through this loop, and a second pass over the
    file costs seconds for nothing.

    The name it lands under says what it is. Nothing in here opens it under a name that
    promises otherwise, and a server the host watchdog kills mid download leaves exactly
    this file, which the next attempt truncates.

    The User-Agent is updater._remote_head's, and so is the trust: this is the second
    thing in JR!TER that talks to GitHub over TLS, and it verifies certificates the same
    way, which is to say the way urllib does by default.
    """
    request = urllib.request.Request(BUILD["url"], headers={"User-Agent": "JR!TER"})
    h = hashlib.sha256()
    got = 0
    # urlopen follows 301, 302, 303 and 307, which is what a GitHub release asset answers
    # with. It does not follow 308, the thing youtube._how_far leans on from the other
    # side, so a change there would arrive as an HTTPError rather than as a short file.
    with urllib.request.urlopen(request, timeout=60) as response:
        total = int(response.headers.get("Content-Length") or BUILD["size"])
        with open(into, "wb") as f:
            while True:
                chunk = response.read(CHUNK)
                if not chunk:
                    break
                got += len(chunk)
                if got > MOST:
                    raise Error("That download is past %d bytes and the pinned build is "
                                "not that big. Nothing has been run." % MOST, 502)
                h.update(chunk)
                f.write(chunk)
                if say(got, total):
                    return None
            f.flush()
            os.fsync(f.fileno())
    return got, h.hexdigest()


def _extract(archive, into):
    """Take exactly one file out of the zip, and write it to a name this file chose.

    This is the whole defence against an entry that writes outside the target, and it is
    a shape rather than a check: zipfile.extractall writes wherever the archive says, and
    `..\\..\\Windows\\System32\\something` is a perfectly valid entry name. So no name
    from the archive is ever joined to a path here. The loop looks for the one member
    whose name ends in bin/ffmpeg.exe and writes it to `into`, which the caller decided.
    An entry pointing anywhere else is simply not the member being looked for.

    A symlink entry gets no further either: zipfile does not create links, so opening one
    hands back its target as bytes and _runs rejects the result. The digest above makes
    both of these moot on any ordinary day, which is exactly when a defence that depends
    on the layer above having worked stops being a defence.

    One file, because one file is all that is used. ffprobe stays in the archive:
    audio_meta.py reads wav and mp3 headers itself, which is why this project has no
    third party packages and why there is nothing else here to unpack.
    """
    tail = "/" + BUILD["member"]
    with zipfile.ZipFile(archive) as z:
        member = None
        for info in z.infolist():
            # gyan's archive puts everything under ffmpeg-<version>-essentials_build/, so
            # the match is on the tail. The name is only ever compared, never used.
            if not info.is_dir() and info.filename.replace("\\", "/").endswith(tail):
                member = info
                break
        if member is None:
            raise Error("That archive has no %s in it, so JR!TER has not run anything "
                        "out of it." % BUILD["member"], 502)
        if member.file_size > MOST:
            raise Error("%s says it unpacks to %d bytes, which the pinned build does "
                        "not." % (BUILD["member"], member.file_size), 502)
        os.makedirs(os.path.dirname(into), exist_ok=True)
        with z.open(member) as src, open(into, "wb") as dst:
            shutil.copyfileobj(src, dst, CHUNK)
    if os.name != "nt":
        os.chmod(into, 0o755)


def fetch(say):
    """Get an ffmpeg onto this machine. Returns its path, or "" if asked to stop.

    Four steps, in this order and no other: download under a name that says the bytes are
    unchecked, compare the SHA-256 against the constant in this file, unpack one member
    under a name that says the same, and only then run it. It gets the name _candidates
    yields on the last line, after passing the same _runs every other candidate has to,
    because a build for the wrong architecture and a half unpacked file both arrive here
    looking exactly like success. That final rename is blobs.py's: on disk before it is
    given the name that promises what is in it.

    No retries and no resume, unlike the upload, and the difference is the point.
    _upload_with_retries exists because a session URI is expensive to recreate and a
    duplicate video cannot be taken back. A zip is neither: the failed card already has a
    Try again button, and starting over costs the download and nothing else.
    """
    want = _pinned_digest()
    room = os.path.dirname(managed_path())
    os.makedirs(room, exist_ok=True)
    archive = os.path.join(room, "ffmpeg-%s.zip.unchecked" % BUILD["version"])
    landing = managed_path()
    incoming = landing + ".unchecked"

    try:
        got = _download(archive, say)
        if got is None:
            return ""                      # asked to stop; nothing was unpacked
        size, digest = got
        if digest != want:
            raise Error(
                "The file that arrived is not the ffmpeg JR!TER expected. The pinned "
                "build hashes to %s and %d bytes arrived hashing to %s. Nothing has been "
                "unpacked, nothing has been run, and the download has been deleted."
                % (want[:16], size, digest[:16]), 502)
        _extract(archive, incoming)
    finally:
        # Twenty five megabytes with nothing left to prove, on every way out of here.
        try:
            os.remove(archive)
        except OSError:
            pass

    version = _runs(incoming)
    if not version:
        # Left where it is, under the name _candidates does not yield, so it cannot be
        # picked up by accident and is still there to look at. What gets here is a build
        # for another architecture or a machine missing a runtime, and neither is
        # guessable from a sentence.
        raise Error("The ffmpeg JR!TER fetched matched its checksum and then would not "
                    "run on this machine. It has been left at %s." % incoming, 502)
    os.replace(incoming, landing)
    _sweep(keep=room)
    forget()
    return landing


def _sweep(keep=None):
    """Every fetched copy but the one named. Returns how many went.

    Called after a successful fetch rather than on a timer, which is _prune_old_work's
    reasoning: this is the one moment the answer is knowable, and a hundred and fifty
    megabytes per version bump on a machine nobody is sitting at adds up quietly.
    """
    gone = 0
    try:
        names = os.listdir(tools_dir())
    except OSError:
        return 0
    for name in names:
        if not name.startswith("ffmpeg-"):
            continue
        path = os.path.join(tools_dir(), name)
        if keep and os.path.normcase(path) == os.path.normcase(keep):
            continue
        shutil.rmtree(path, ignore_errors=True)
        gone += 1
    return gone


MISSING = ("JR!TER cannot find ffmpeg on this machine, so it cannot turn the mix into a "
           "video. Install ffmpeg and restart JR!TER, or put the full path to ffmpeg.exe "
           "in Settings.")

# ...

def can_install():
    """Whether fetch() has anything to try, and a sentence when it does not.

    Windows only, and that is a decision rather than an omission. The host runs Windows
    and is the only machine where nobody can install anything by hand; everywhere else
    has a package manager that already does this better, with signatures. A second
    downloader for a platform nobody here runs is a branch that is never right.
    """
    if os.name != "nt":
        return False, ("On this machine JR!TER does not fetch ffmpeg for itself. Install "
                       "it with the system's package manager and restart JR!TER.")
    try:
        _pinned_digest()
    except Error as e:
        return False, e.message
    return True, ""


def remove():
    """Take the fetched copy away. Returns whether there was one.

    This is the whole of uninstalling, and it is one directory, which is why the settings
    page prints the path next to the version. Removing the JR!TER checkout does not run
    this, so anyone who deletes the folder and wonders what is left has one honest answer
    to be given rather than a search to do.
    """
    there = os.path.isdir(os.path.dirname(managed_path()))
    _sweep()
    forget()
    return there


#: 1280x720. Even in both directions by construction, which is what libx264 needs, and a
#: size YouTube treats as an ordinary video rather than something to think about.
CANVAS = (1280, 720)

#: The ground behind a cover that is not 16:9, and the whole picture when there is none.
#: A colour rather than a shipped placeholder image: nothing to lose, nothing to license.
GROUND = "0x101014"

#: Two frames a second. The picture never moves, so this is entirely about size: at 25 fps
#: a four minute song is six thousand identical frames. Not lower than two, because some
#: players will not open a video below one frame per second.
FPS = 2

#: A keyframe every ten seconds. Each one is the whole still encoded again, so the default
#: of one every two seconds costs several megabytes for a picture that does not change.
GOP = FPS * 10


def still_argv(tool, source, out):
    """One frame of the artwork, on an even sized canvas.

    A separate pass rather than a filter on the encode, because it flattens every case
    into one PNG: an animated gif becomes its first frame instead of a moving video, a
    webp or an avif is decoded here where failing costs nothing, and a cover with an
    alpha channel loses it before libx264 has to decide what yuv420p means for
    transparency. If this pass fails the encode still runs, on the plain colour, and the
    job says which it used.
    """
    w, h = CANVAS
    return [tool, "-hide_banner", "-nostdin", "-y", "-i", source, "-frames:v", "1",
            "-vf", ("scale=%d:%d:force_original_aspect_ratio=decrease,"
                    "pad=%d:%d:(ow-iw)/2:(oh-ih)/2:color=%s" % (w, h, w, h, GROUND)),
            out]


def video_argv(tool, still, wav, seconds, out):
    """One still and one audio track into an MP4 that YouTube takes.

    The order of these is not decoration. -loop 1 goes before the image input or it
    applies to nothing and the video is one frame long, which YouTube accepts and shows
    as a black screen for the rest of the song. -framerate is an input option too:
    setting only the output rate makes ffmpeg loop the still at 25 and throw frames away.

    -t and -shortest are both here. -shortest ends the file when the shortest input ends,
    which is the audio, since a looped still never ends. -t is the belt, taken from the
    wav's own header, so a -shortest that does not fire cannot leave ffmpeg encoding
    forever on a machine nobody is sitting at.

    yuv420p because a PNG decodes to RGB and libx264 will write yuv444p given the chance,
    which YouTube rejects and no phone plays.

    +faststart moves the index to the front. One rewrite of the file at the end, and it is
    what lets the thing play while it downloads.
    """
    w, h = CANVAS
    source = (["-loop", "1", "-framerate", str(FPS), "-i", still] if still else
              ["-f", "lavfi", "-i",
               "color=c=%s:s=%dx%d:r=%d" % (GROUND, w, h, FPS)])
    return [tool, "-hide_banner", "-nostdin", "-y"] + source + [
        "-i", wav,
        "-t", "%.3f" % seconds, "-shortest",
        "-c:v", "libx264", "-preset", "veryslow", "-tune", "stillimage",
        "-crf", "20", "-pix_fmt", "yuv420p", "-r", str(FPS), "-g", str(GOP),
        # No -ar and no -ac. The mix is whatever rate the render was, and resampling it on
        # the way out is a change to the sound made behind the person's back, which is the
        # same reason J.bounce refuses to dither a delivery copy.
        "-c:a", "aac", "-b:a", "320k",
        "-movflags", "+faststart",
        # The only stable way to get a percentage out of ffmpeg. This writes out_time_ms
        # on stdout in a fixed key=value shape; the pretty line on stderr changes between
        # builds and is not worth parsing.
        "-progress", "pipe:1", "-nostats",
        out]


#: How much of ffmpeg's own output to keep. Enough to hold the error and the two lines
#: before it, which is what makes a failure readable, and not so much that a job record
#: grows without limit.
TAIL = 40


def run(argv, seconds, say):
    """Run one ffmpeg, reporting progress. Returns (ok, tail_lines).

    stderr is folded into stdout on purpose. Two pipes need two reader threads or a
    select, and select does not work on pipes on Windows, which is where this runs. With
    -nostats the stream is quiet apart from the progress blocks and anything that went
    wrong, so one pipe is enough and there is no way to deadlock on a full buffer.

    say(fraction) is called about twice a second, because that is how often ffmpeg writes
    a progress block. Nothing in here runs per frame.
    """
    proc = subprocess.Popen(argv, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                            stdin=subprocess.DEVNULL, text=True, bufsize=1)
    tail = []
    try:
        for line in proc.stdout:
            line = line.rstrip("\n")
            if line.startswith("out_time_ms=") and seconds > 0:
                try:
                    done = int(line.split("=", 1)[1]) / 1000000.0
                except ValueError:
                    continue            # ffmpeg writes N/A before the first frame lands
                say(max(0.0, min(1.0, done / seconds)))
            elif "=" not in line or line.startswith("["):
                tail.append(line)
                del tail[:-TAIL]
    finally:
        proc.stdout.close()
        proc.wait()
    return proc.returncode == 0, tail


def why_it_failed(tail):
    """ffmpeg's own words, plus a fix where there is one it can name.

    Only two cases are worth recognising by name. Everything else is handed over verbatim,
    because ffmpeg's error is nearly always more use than anything written about it here.
    """
    said = "\n".join(tail)
    if "Unknown encoder" in said and "libx264" in said:
        return ("The ffmpeg on this machine was built without libx264, so it cannot write "
                "an MP4. Install a full build and point Settings at it.")
    if "not divisible by 2" in said:
        return ("libx264 refused the picture size. That should not happen, because the "
                "still is padded to 1280x720 first: the still pass probably failed and "
                "was skipped.")
    return ""
