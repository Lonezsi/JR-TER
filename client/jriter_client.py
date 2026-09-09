#!/usr/bin/env python3
"""The JR!TER desktop agent.

Watches the folders your renders land in and puts new ones into the library. It reads
those folders and never writes to them.

    python jriter_client.py add "C:\\Users\\you\\Music\\Renders"
    python jriter_client.py scan            what is new, without sending anything
    python jriter_client.py push            send what is new
    python jriter_client.py watch           keep doing that
    python jriter_client.py update          pull a newer JR!TER from GitHub
    python jriter_client.py install         run at logon from now on

On sending only what changed: every file is hashed locally and the server is asked which
of those hashes it already holds. Anything it has is skipped without a byte leaving the
machine. That is as far as "only the changes" honestly goes for audio, because a fresh
render of the same song shares essentially no bytes with the one before it.

Standard library only.
"""
import os
import sys
import json
import time
import hashlib
import shutil
import argparse
import subprocess
import urllib.error
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
_APP = os.environ.get("APPDATA") or os.path.expanduser("~/.config")
CONFIG_PATH = (os.environ.get("JRITER_CLIENT_CONFIG")
               or os.environ.get("JONG_CLIENT_CONFIG")
               or os.path.join(_APP, "jriter", "client.json"))
#: Where it lived before the rename.
OLD_CONFIG_PATH = os.path.join(_APP, "jong", "client.json")

# flrender sits next to this file and is standard library only, so importing it costs
# nothing on a machine that has never seen FL Studio.
#
# Here rather than inside a function, which is where it used to be. It was imported inside
# cmd_render, which binds it as a local of cmd_render, and send_render then used the bare
# name from its own scope and raised NameError on every single file. Between that and the
# tuple it was being handed, the unattended watcher had two separate reasons to send
# nothing, and the broad except in the watch loop hid both.
#
# sys.path rather than a plain import: the directory of a script is on sys.path when it is
# run as a script and not when something imports it, and this file is now imported by the
# desktop app.
if HERE not in sys.path:
    sys.path.insert(0, HERE)
import flrender                                                    # noqa: E402

AUDIO_EXT = (".mp3", ".wav", ".flac", ".m4a", ".aac", ".ogg", ".opus")
CHUNK = 1024 * 1024
DEFAULTS = {"server": "http://127.0.0.1:7900", "folders": [], "interval_minutes": 5,
            "auto_new_songs": False}


# ── config ───────────────────────────────────────────────────────────────────
def load_config():
    out = dict(DEFAULTS)
    # The address, the watched folders and the token all live in that one file. Losing
    # it does not fail, it falls back to localhost with nothing watched and no way in,
    # which from the outside is an agent that runs every day and never sends anything
    # again. Copied rather than moved, so an older client on the same machine keeps
    # working until it is updated too.
    if not os.path.exists(CONFIG_PATH) and os.path.exists(OLD_CONFIG_PATH):
        try:
            os.makedirs(os.path.dirname(CONFIG_PATH), exist_ok=True)
            shutil.copyfile(OLD_CONFIG_PATH, CONFIG_PATH)
        except OSError:
            pass          # it will fall through to the defaults, which is what it did before
    try:
        with open(CONFIG_PATH, "r", encoding="utf-8") as f:
            out.update(json.load(f))
    except (OSError, ValueError):
        pass
    return out


def save_config(cfg):
    os.makedirs(os.path.dirname(CONFIG_PATH), exist_ok=True)
    tmp = CONFIG_PATH + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(cfg, f, indent=2)
    os.replace(tmp, CONFIG_PATH)


# ── server ───────────────────────────────────────────────────────────────────
class Server:
    """Talks to a library, carrying whatever credential this machine has been given.

    It used to carry nothing at all while the server 401s every path, so an agent
    installed against an authenticated host had been failing on its first request since
    the day it was set up, silently, because the watch loop swallowed the error.
    """

    def __init__(self, base, token=None):
        self.base = base.rstrip("/")
        self.token = token or ""

    def _headers(self, extra=None):
        head = dict(extra or {})
        if self.token:
            head["X-Jriter-Token"] = self.token
        return head

    def _open(self, request, timeout=120):
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                body = response.read().decode("utf-8")
            return json.loads(body) if body else {}
        except urllib.error.HTTPError as e:
            detail = e.read().decode("utf-8", "ignore")
            try:
                message = json.loads(detail).get("error", detail)
            except ValueError:
                message = detail
            raise SystemExit("JR!TER said no (%d): %s" % (e.code, message[:300]))
        except urllib.error.URLError as e:
            raise SystemExit("Cannot reach JR!TER at %s: %s\n"
                             "Start it with `python server.py`, or set the address with "
                             "`jriter_client.py server <url>`." % (self.base, e.reason))

    def get(self, path):
        return self._open(urllib.request.Request(
            self.base + path, headers=self._headers({"Accept": "application/json"})))

    def post(self, path, payload):
        data = json.dumps(payload).encode("utf-8")
        return self._open(urllib.request.Request(
            self.base + path, data=data, method="POST",
            headers=self._headers({"Content-Type": "application/json"})))

    def upload(self, path, file_path, headers=None):
        size = os.path.getsize(file_path)
        with open(file_path, "rb") as f:
            request = urllib.request.Request(
                self.base + path, data=f, method="POST",
                headers=self._headers(dict({"Content-Type": "application/octet-stream",
                                            "Content-Length": str(size)},
                                           **(headers or {}))))
            return self._open(request, timeout=900)


def digest_of(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(CHUNK), b""):
            h.update(chunk)
    return h.hexdigest()


def walk(folders):
    for folder in folders:
        if not os.path.isdir(folder):
            print("  (missing) %s" % folder)
            continue
        for base, dirs, files in os.walk(folder):
            dirs[:] = [d for d in dirs if not d.startswith(".")]
            for name in sorted(files):
                if os.path.splitext(name)[1].lower() in AUDIO_EXT:
                    yield os.path.join(base, name)


def survey(cfg, server):
    """Everything in the watched folders, split into what the library has and what it does not."""
    paths = list(walk(cfg["folders"]))
    if not paths:
        return [], []
    digests = {}
    for path in paths:
        try:
            digests[path] = digest_of(path)
        except OSError as e:
            print("  (unreadable) %s: %s" % (path, e))

    known, fresh = [], []
    items = list(digests.items())
    # Asked in batches so a folder of a few thousand renders is still one or two calls.
    for start in range(0, len(items), 400):
        batch = items[start:start + 400]
        answer = server.get("/api/versions/have?digest=" +
                            urllib.parse.quote(",".join(d for _, d in batch)))
        have = answer.get("have", {})
        for path, digest in batch:
            match = have.get(digest)
            if match:
                known.append((path, match))
            else:
                fresh.append((path, digest))
    return known, fresh


# ── commands ─────────────────────────────────────────────────────────────────
def cmd_scan(cfg, server, args):
    known, fresh = survey(cfg, server)
    print("%d file(s) already in the library" % len(known))
    if not fresh:
        print("Nothing new.")
        return 0
    print("\n%d new file(s):" % len(fresh))
    for path, _ in fresh:
        guess = server.get("/api/songs/match?name=" +
                           urllib.parse.quote(os.path.basename(path)))
        suggest = guess.get("suggest")
        print("  %s" % os.path.basename(path))
        print("      %s" % (("looks like a new render of %s" % suggest["title"])
                            if suggest else "no obvious match, would be a new song"))
    print("\nRun `push` to send them.")
    return 0


def cmd_push(cfg, server, args):
    known, fresh = survey(cfg, server)
    if not fresh:
        print("Nothing new. %d file(s) already in the library." % len(known))
        return 0

    sent = skipped = 0
    for path, _ in fresh:
        name = os.path.basename(path)
        guess = server.get("/api/songs/match?name=" + urllib.parse.quote(name))
        suggest = guess.get("suggest")

        song_id = None
        if suggest:
            if args.yes or ask("Is %s a new render of %s?" % (name, suggest["title"])):
                song_id = suggest["song_id"]
        if song_id is None:
            title = os.path.splitext(name)[0]
            if not (args.yes or cfg.get("auto_new_songs")):
                if not ask("Add %s as a new song called %s?" % (name, title)):
                    print("  skipped %s" % name)
                    skipped += 1
                    continue
            made = server.post("/api/songs", {"title": title})
            song_id = made["song"]["id"]

        print("  sending %s" % name)
        result = server.upload("/api/songs/%d/versions" % song_id, path,
                               {"X-Filename": name, "X-Source-Path": path})
        version = result.get("version", {})
        if result.get("duplicate"):
            print("      already there as v%s" % version.get("n"))
        else:
            print("      stored as v%s" % version.get("n"))
            sent += 1

    print("\n%d sent, %d skipped, %d already held." % (sent, skipped, len(known)))
    return 0


def ask(question):
    try:
        answer = input("  %s [Y/n] " % question).strip().lower()
    except EOFError:
        return False
    return answer in ("", "y", "yes")


def cmd_watch(cfg, server, args):
    minutes = max(1, int(cfg.get("interval_minutes", 5)))
    print("Watching %d folder(s), every %d minute(s). Ctrl-C to stop."
          % (len(cfg["folders"]), minutes))
    while True:
        try:
            _, fresh = survey(cfg, server)
            if fresh:
                print("[%s] %d new" % (time.strftime("%H:%M"), len(fresh)))
                # Into the renders list, and no further.
                #
                # This used to force args.yes and call push, which accepts any 0.62
                # fuzzy title match without asking and makes a new song when nothing
                # matches. It is the one genuinely unattended path in the whole app and
                # it was the only one that wrote on a guess, on a timer, for the life of
                # the logon session, with nothing to tell you it had happened. Which
                # song a render belongs to is a question worth asking while looking at
                # the library. The interactive push command is unchanged.
                # survey hands back (path, digest) pairs, and this loop used to bind
                # the whole pair to `path`. send_render then called os.path.basename on a
                # tuple, raised TypeError, and the broad except below caught it, printed
                # one line into a log nobody reads and slept for five minutes. Which is
                # to say: the unattended watcher, the one feature whose entire job is to
                # work while nobody is looking, had never sent a single render.
                for path, _ in fresh:
                    send_render(cfg, server, path)
        except SystemExit as e:
            # A watcher that dies because the server was restarted is not a watcher.
            print("[%s] %s" % (time.strftime("%H:%M"), e))
        except Exception as e:
            print("[%s] %s: %s" % (time.strftime("%H:%M"), type(e).__name__, e))
        time.sleep(minutes * 60)


def send_one(cfg, server, path, yes=False):
    """Put one file into the library, asking what it is a new render of."""
    name = os.path.basename(path)
    digest = digest_of(path)
    answer = server.get("/api/versions/have?digest=" + digest)
    held = (answer.get("have") or {}).get(digest)
    if held:
        print("  already here as v%s of %s" % (held["n"], held["title"]))
        return True

    guess = server.get("/api/songs/match?name=" + urllib.parse.quote(name))
    suggest = guess.get("suggest")
    song_id = None
    if suggest:
        if yes or ask("Is %s a new render of %s?" % (name, suggest["title"])):
            song_id = suggest["song_id"]
    if song_id is None:
        title = os.path.splitext(name)[0]
        if not (yes or cfg.get("auto_new_songs")):
            if not ask("Add %s as a new song called %s?" % (name, title)):
                print("  skipped")
                return False
        song_id = server.post("/api/songs", {"title": title})["song"]["id"]

    print("  sending %s" % name)
    result = server.upload("/api/songs/%d/versions" % song_id, path,
                           {"X-Filename": name, "X-Source-Path": path})
    version = result.get("version", {})
    print("      %s as v%s" % ("already there" if result.get("duplicate") else "stored",
                               version.get("n")))
    return True


def cmd_push_file(cfg, server, args):
    """One file, straight from the right click menu."""
    path = os.path.abspath(args.path)
    if not os.path.isfile(path):
        print("There is no file at %s" % path)
        return 1
    if os.path.splitext(path)[1].lower() not in AUDIO_EXT:
        print("%s is not audio JR!TER handles." % os.path.basename(path))
        return 1
    print("JR!TER at %s" % cfg["server"])
    return 0 if send_one(cfg, server, path, args.yes) else 1


def cmd_push_folder(cfg, server, args):
    """Every sound file in one folder, sent now.

    Different from "watch this folder", which is the standing arrangement: it adds the
    folder to a list and a task picks things up from then on. This is the one off. You
    have a folder of bounces and you want them in the library before you leave, and you
    do not want that folder watched for the rest of time.

    Different from push as well, which surveys every watched folder. This one is told
    where to look and looks nowhere else.
    """
    folder = os.path.abspath(os.path.expanduser(args.path))
    if not os.path.isdir(folder):
        print("There is no folder at %s" % folder)
        return 1
    print("JR!TER at %s" % cfg["server"])
    print("Looking in %s" % folder)

    paths = sorted(walk([folder]))
    if not paths:
        print("  no sound files in there.")
        return 0

    # Asked once for the whole folder rather than once per file. Twenty bounces is twenty
    # questions, and the answer is the same twenty times.
    print("  %d sound file(s)." % len(paths))
    if not (args.yes or ask("Send all of them?")):
        return 0

    sent = held = failed = 0
    for path in paths:
        try:
            # yes=True from here on: the folder was the question and it has been answered.
            # Anything it cannot match becomes a new song named after the file, which is
            # what "upload this folder" means.
            before = send_one(cfg, server, path, yes=True)
            if before:
                sent += 1
        except Exception as e:
            # One unreadable file must not end the run. The whole point of this command is
            # that it is left alone to finish.
            print("  could not send %s: %s" % (os.path.basename(path), e))
            failed += 1

    print("")
    print("%d sent, %d could not be sent." % (sent, failed))
    return 1 if failed and not sent else 0


def cmd_render(cfg, server, args):
    """Render an FL project, or every project in a folder, then send the audio in.

    FL Studio's command line render is not headless. Its window opens, and on some
    versions the export dialog waits to be started by hand. That is said out loud here
    rather than discovered after a silent failure.
    """
    path = os.path.abspath(args.path)
    fl = flrender.find_fl(cfg.get("fl_path"))
    if not fl:
        print("FL Studio was not found. Set it once with:")
        print(r'    jriter_client.py flpath "C:\Program Files\Image-Line\FL Studio 2024\FL64.exe"')
        return 1
    print("Using %s" % fl)
    print("FL will open while it renders. It is not a silent process, and on some")
    print("versions the export dialog waits for Start to be pressed.")
    print("")

    say = lambda text: print("  " + text, flush=True)
    fmt = cfg.get("render_format", "wav")
    out = cfg.get("render_out") or None

    if os.path.isdir(path):
        done, failed = flrender.render_folder(path, out, fmt, fl, on_step=say)
    elif os.path.isfile(path):
        try:
            done, failed = [flrender.render(path, out, fmt, fl, on_step=say)], []
        except RuntimeError as e:
            print("  %s" % e)
            return 1
    else:
        print("There is nothing at %s" % path)
        return 1

    print("\n%d rendered." % len(done))
    for audio in done:
        send_render(cfg, server, audio)
    if failed:
        print("\n%d did not render:" % len(failed))
        for project, why in failed:
            print("  %s" % os.path.basename(project))
            print("      %s" % why)
    return 0


def send_render(cfg, server, path):
    """Put a fresh render in the library's renders list.

    Not straight onto a song. Which song a render belongs to is a question worth asking
    while looking at the library rather than at a console that is about to close, and a
    batch of forty renders is forty questions nobody wants in a row. They go into a list
    and wait there until they are told.
    """
    name = os.path.basename(path)
    # The server has no file to look at on this path: the bytes come off the request
    # body and the project is on this machine. If these two dates do not ride along as
    # headers, they do not exist for an FL render at all.
    made, bounced = flrender.dates_for(path)
    headers = {"X-Filename": name, "X-Source-Path": path, "X-Origin": "fl"}
    if made:
        headers["X-Project-At"] = repr(made)
    if bounced:
        headers["X-Rendered-At"] = repr(bounced)
    try:
        result = server.upload("/api/renders", path, headers)
    except Exception as e:
        print("  could not send %s: %s" % (name, e))
        return False
    print("  %s %s" % (name, "is waiting in Renders" if result.get("added")
                              else "was already there"))
    return True


def cmd_flpath(cfg, server, args):
    cfg["fl_path"] = args.path
    save_config(cfg)
    print("FL Studio set to %s" % args.path)
    return 0


def cmd_shell(cfg, server, args):
    """The right click menu."""
    import jriter_shell
    if os.name != "nt":
        print("The right click menu is a Windows thing.")
        return 0
    if args.action == "remove":
        jriter_shell.remove()
        print("Removed.")
        return 0
    written = jriter_shell.install()
    print("Added %d entries under HKEY_CURRENT_USER." % len(written))
    for parent, label, _ in jriter_shell.installed():
        print("  %-46s %s" % (parent, label))
    return 0


def cmd_add(cfg, server, args):
    path = os.path.abspath(os.path.expanduser(args.path))
    if not os.path.isdir(path):
        print("There is no folder at %s" % path)
        return 1
    if path in cfg["folders"]:
        print("Already watching %s" % path)
        return 0
    cfg["folders"].append(path)
    save_config(cfg)
    print("Watching %s" % path)
    return 0


def cmd_folders(cfg, server, args):
    if not cfg["folders"]:
        print("No folders yet. Add one with `add <path>`.")
    for path in cfg["folders"]:
        print("  %s%s" % (path, "" if os.path.isdir(path) else "   (missing)"))
    print("\nServer: %s" % cfg["server"])
    print("Config: %s" % CONFIG_PATH)
    return 0


def cmd_server(cfg, server, args):
    cfg["server"] = args.url.rstrip("/")
    save_config(cfg)
    print("Server set to %s" % cfg["server"])
    return 0


def cmd_login(cfg, server, args):
    """Trade your password for a token this machine can keep.

    The password is used once, here, and never written down. What is stored is a token
    scoped to uploading, so this file being read does not hand anybody the ability to
    delete a song. Revoke it from Settings on the library itself.

    The token belongs to one account, so a machine watching folders for one person cannot
    push into anybody else's library even if the file is copied. Leave --handle off if the
    library is yours: an empty handle means the owner, which is what it always meant.
    """
    import getpass

    if not cfg.get("server"):
        print("Set the address first: jriter_client.py server <url>")
        return 1

    password = args.password or getpass.getpass("Password for %s: " % cfg["server"])
    if not password:
        print("Nothing entered.")
        return 1

    # Signed in as a person for exactly one call, to ask for the machine's own credential.
    data = json.dumps({"password": password,
                       "handle": (args.handle or "").strip()}).encode("utf-8")
    request = urllib.request.Request(cfg["server"].rstrip("/") + "/api/auth/login",
                                     data=data, method="POST",
                                     headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            cookie = response.headers.get("Set-Cookie", "").split(";")[0]
    except urllib.error.HTTPError as e:
        print("JR!TER said no (%d). Wrong handle or password?" % e.code)
        return 1
    except urllib.error.URLError as e:
        print("Cannot reach %s: %s" % (cfg["server"], e.reason))
        return 1

    # Not "%s" % os.environ.get(...): % binds tighter than or, so a missing
    # COMPUTERNAME produced the string "None", which is truthy, and every machine
    # without one was called None.
    name = args.name or os.environ.get("COMPUTERNAME") or "a machine"
    made = json.dumps({"name": name, "scope": "upload"}).encode("utf-8")
    ask = urllib.request.Request(cfg["server"].rstrip("/") + "/api/auth/tokens",
                                 data=made, method="POST",
                                 headers={"Content-Type": "application/json",
                                          "Cookie": cookie})
    with urllib.request.urlopen(ask, timeout=30) as response:
        cfg["token"] = json.loads(response.read().decode("utf-8"))["token"]
    save_config(cfg)
    print("This machine can now reach %s as \"%s\"." % (cfg["server"], name))
    print("It can upload renders and read the library. It cannot delete anything.")
    return 0


def cmd_update(cfg, server, args):
    """Pull a newer JR!TER. Fast forward only, and never over local edits."""
    def git(*parts):
        done = subprocess.run(("git",) + parts, cwd=ROOT, capture_output=True, text=True)
        return done.returncode, (done.stdout + done.stderr).strip()

    code, _ = git("rev-parse", "--is-inside-work-tree")
    if code != 0:
        print("This copy is not a git checkout, so it cannot update itself.")
        return 1
    code, dirty = git("status", "--porcelain")
    if dirty:
        print("There are uncommitted changes here. Commit or discard them first:")
        print(dirty)
        return 1
    before = git("rev-parse", "HEAD")[1]
    code, out = git("pull", "--ff-only")
    if code != 0:
        print("The pull did not succeed:\n%s" % out)
        return 1
    after = git("rev-parse", "HEAD")[1]
    if before == after:
        print("Already up to date.")
    else:
        print("Updated %s to %s.\nRestart JR!TER and this client to run the new code."
              % (before[:7], after[:7]))
    return 0


def catch_up(name):
    """Let the task run on battery, and run late if it missed its moment.

    schtasks /Create takes Windows' defaults for both of these, and the defaults are
    wrong for this task: DisallowStartIfOnBatteries with StartWhenAvailable off means
    a run missed on battery is dropped rather than delayed. A laptop unplugged
    overnight never updates, and nothing says so, because a task that skipped and a
    task that succeeded look the same from outside. Measured here: the run on one day
    exited 0x800710E0, which is what that condition returns, and the next exited 0
    because the machine happened to be plugged in.

    A git pull is a few seconds of a slow disk. It does not need to wait for mains.

    Neither setting is reachable from schtasks, so this asks PowerShell, which is on
    every Windows that has schtasks. Still no Python package.

    Best effort on purpose. A task that runs on the old conditions is the behaviour
    this has always had, so failing here is worth a line and not a stopped install.
    """
    script = (
        "$ErrorActionPreference='Stop';"
        "$t = Get-ScheduledTask -TaskName '%s';"
        "$t.Settings.DisallowStartIfOnBatteries = $false;"
        "$t.Settings.StopIfGoingOnBatteries = $false;"
        "$t.Settings.StartWhenAvailable = $true;"
        "Set-ScheduledTask -TaskName '%s' -Settings $t.Settings | Out-Null"
    ) % (name.replace("'", "''"), name.replace("'", "''"))
    done = subprocess.run(["powershell", "-NoProfile", "-NonInteractive",
                           "-Command", script],
                          capture_output=True, text=True)
    if done.returncode != 0:
        print("      (left on the default power conditions: a run missed on battery "
              "will not be caught up)")
        return False
    return True


def cmd_install(cfg, server, args):
    """Make JR!TER part of the machine.

    Three things, none of which needs an administrator:
      the desktop app starts at logon, minimised, and watches your folders
      the right click menu appears on audio, on .flp files and on folders
      a daily task pulls a newer JR!TER from GitHub

    Everything lands under the current user: a per user scheduled task and HKCU registry
    keys. Nothing is written to the machine wide hive, so removing it is complete.

    --server and --folder can be passed to set up in one line:
      python jriter_client.py install --server http://127.0.0.1:7900 --folder "~/Renders"
    """
    # Apply any setup flags before installing.
    if args.server:
        cfg["server"] = args.server.rstrip("/")
        save_config(cfg)
        print("Server: %s" % cfg["server"])
    if args.folder:
        added = False
        for raw in args.folder:
            path = os.path.abspath(os.path.expanduser(raw))
            if not os.path.isdir(path):
                print("  (missing) %s" % path)
                continue
            if path not in cfg["folders"]:
                cfg["folders"].append(path)
                added = True
            print("  watching %s" % path)
        if added:
            save_config(cfg)

    # Not a reason to stop any more.
    #
    # It used to refuse outright, which made a fresh machine a chicken and egg: you could
    # not install without a folder, and the pleasant way to choose a folder is the app that
    # installing puts there. The tasks and the menu go in either way and the app asks.
    if not cfg["folders"]:
        print("No folders watched yet. Add one in the app, or with: --folder <path>")

    server = Server(cfg["server"], cfg.get("token"))

    script = os.path.abspath(__file__)
    quoted = '"%s" "%s"' % (sys.executable, script)

    # The window, not the headless loop.
    #
    # pythonw where there is one, so logon does not flash a console up and leave it in the
    # taskbar next to the window it started. The app is the thing that should be there.
    app = os.path.join(HERE, "jriter_app.py")
    windowless = os.path.join(os.path.dirname(sys.executable), "pythonw.exe")
    runner = windowless if os.path.isfile(windowless) else sys.executable
    watcher = '"%s" "%s" --minimised' % (runner, app)

    if os.name != "nt":
        print("On this system, add the following to your startup:")
        print("  %s" % watcher)
        return 0

    def task(name, command, schedule):
        done = subprocess.run(
            ["schtasks", "/Create", "/TN", name, "/TR", command,
             "/RL", "LIMITED", "/F"] + schedule,
            capture_output=True, text=True)
        if done.returncode != 0:
            print("  could not create %s:" % name)
            print("      " + (done.stderr or done.stdout).strip().splitlines()[-1][:160])
            return False
        print("  %s" % name)
        catch_up(name)
        return True

    # The tasks the old name registered, taken away before the new ones go in.
    # schtasks /Create /F only replaces a task of the SAME name, so a rename leaves the
    # previous pair in place: one more watcher at every logon and one more updater at
    # five in the morning, both running a client script that is not there any more.
    for old in ("J-ong watch", "J-ong update"):
        subprocess.run(["schtasks", "/Delete", "/TN", old, "/F"],
                       capture_output=True, text=True)

    print("Starts at logon:")
    # The Run key, not a scheduled task.
    #
    # schtasks /SC ONLOGON wants elevation: measured on this machine, an ONLOGON task is
    # refused with "Access is denied" from an ordinary shell while the DAILY one beside it
    # goes in without a murmur. Asking somebody to run an installer as administrator so a
    # music app can open its own window at logon is the wrong trade.
    #
    # The Run key is also simply the right place for this. It is where a windowed app that
    # belongs to one person goes, it needs no administrator, Task Manager lists it under
    # Startup where anybody would look for it, and turning it off there is a click.
    if not _run_at_logon(watcher):
        print("  could not write the Run key; start it by hand from the app shortcut")

    print("Scheduled tasks:")
    # Daily rather than at every start: an update that needs a restart should land at a
    # predictable moment, not in the middle of a session. A task rather than the Run key
    # because this one wants to happen whether or not anybody logs on today.
    # JRITER, not JR!TER: a task name is an identifier, and cmd treats ! as its own.
    task("JRITER update", "%s update" % quoted, ["/SC", "DAILY", "/ST", "05:00"])

    print("Right click menu:")
    try:
        import jriter_shell
        written = jriter_shell.install()
        for parent, label, _ in jriter_shell.installed():
            print("  %-44s %s" % (parent, label))
        if not written:
            print("  nothing added")
    except Exception as e:
        print("  could not add it: %s" % e)

    print("")
    print("Remove all of it with:")
    print("  %s uninstall" % quoted)
    return 0


RUN_KEY = r"Software\Microsoft\Windows\CurrentVersion\Run"
RUN_NAME = "JRITER"


def _run_at_logon(command):
    """Ask Windows to start something when this person logs on. Per user, no administrator."""
    if os.name != "nt":
        return False
    try:
        import winreg
        with winreg.CreateKey(winreg.HKEY_CURRENT_USER, RUN_KEY) as key:
            winreg.SetValueEx(key, RUN_NAME, 0, winreg.REG_SZ, command)
        print("  %s" % command)
        return True
    except OSError as e:
        print("  %s" % e)
        return False


def _stop_running_at_logon():
    if os.name != "nt":
        return False
    try:
        import winreg
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, RUN_KEY, 0,
                            winreg.KEY_SET_VALUE) as key:
            winreg.DeleteValue(key, RUN_NAME)
        return True
    except OSError:
        return False                # not there is the ordinary case


def cmd_uninstall(cfg, server, args):
    """Take back everything install put on this machine.

    One command, because the alternative was three lines printed at the end of install that
    somebody has to keep. Nothing here touches the library or anything in your folders: this
    is only the wiring.
    """
    print("Startup:")
    print("  removed" if _stop_running_at_logon() else "  was not set")

    print("Scheduled tasks:")
    for name in ("JRITER watch", "JRITER update", "J-ong watch", "J-ong update"):
        done = subprocess.run(["schtasks", "/Delete", "/TN", name, "/F"],
                              capture_output=True, text=True)
        if done.returncode == 0:
            print("  %s removed" % name)

    print("Right click menu:")
    try:
        import jriter_shell
        jriter_shell.remove()
        print("  removed")
    except Exception as e:
        print("  could not remove it: %s" % e)

    print("")
    print("Your library and your folders are untouched.")
    return 0


COMMANDS = {
    "scan": cmd_scan, "push": cmd_push, "watch": cmd_watch, "add": cmd_add,
    "folders": cmd_folders, "server": cmd_server, "update": cmd_update,
    "install": cmd_install, "push-file": cmd_push_file, "render": cmd_render,
    "push-folder": cmd_push_folder, "uninstall": cmd_uninstall,
    "shell": cmd_shell, "flpath": cmd_flpath, "login": cmd_login,
}


def main(argv=None):
    parser = argparse.ArgumentParser(description="The JR!TER desktop agent")
    sub = parser.add_subparsers(dest="command")
    sub.add_parser("scan", help="report what is new without sending it")
    push = sub.add_parser("push", help="send what is new")
    push.add_argument("-y", "--yes", action="store_true", help="do not ask about each file")
    sub.add_parser("watch", help="scan and send on a timer")
    add = sub.add_parser("add", help="watch a folder")
    add.add_argument("path")
    sub.add_parser("folders", help="list watched folders")
    login = sub.add_parser("login", help="give this machine a credential for the library")
    login.add_argument("--password", help="asked for if not given")
    login.add_argument("--handle",
                       help="whose library; leave it off if the library is yours")
    login.add_argument("--name", help="what to call this machine in Settings")
    where = sub.add_parser("server", help="set the JR!TER address")
    where.add_argument("url")
    sub.add_parser("update", help="pull a newer JR!TER from GitHub")
    sub.add_parser("uninstall", help="take the startup entry and right click menu back off")
    install = sub.add_parser("install", help="run watch at logon, and add the right click menu")
    install.add_argument("--server", help="set the JR!TER server address")
    install.add_argument("--folder", action="append", help="watch a folder (repeatable)")
    one = sub.add_parser("push-file", help="send one file, used by the right click menu")
    one.add_argument("path")
    one.add_argument("-y", "--yes", action="store_true")
    many = sub.add_parser("push-folder",
                          help="send every sound file in one folder, now")
    many.add_argument("path")
    many.add_argument("-y", "--yes", action="store_true")
    render = sub.add_parser("render", help="render an FL project, or a folder of them")
    render.add_argument("path")
    render.add_argument("-y", "--yes", action="store_true")
    where_fl = sub.add_parser("flpath", help="tell it where FL Studio is")
    where_fl.add_argument("path")
    shell = sub.add_parser("shell", help="add or remove the right click menu")
    shell.add_argument("action", nargs="?", default="install",
                       choices=["install", "remove"])
    args = parser.parse_args(argv)

    if not args.command:
        parser.print_help()
        return 0
    if not hasattr(args, "yes"):
        args.yes = False

    cfg = load_config()
    server = Server(cfg["server"], cfg.get("token"))
    return COMMANDS[args.command](cfg, server, args)


if __name__ == "__main__":
    sys.exit(main())
