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
import subprocess

from . import config


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
