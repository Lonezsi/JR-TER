#!/usr/bin/env python3
"""JR!TER on the desktop: the library in a window of its own, and the watcher behind it.

    python jriter_app.py                opens the library
    python jriter_app.py --minimised    watches without opening anything, which is how
                                        logon starts it

Why this exists. The folder watcher used to run as a headless scheduled task, and a
headless task is a thing you have to take on faith: no window, no icon, no way to tell
"it is watching and nothing new has landed" from "it stopped in March". Both of the bugs
the tests next door pin down lived in that loop for exactly that reason.

What changed is where the face is. This drew its own: a tkinter window with its own
background, panel, line and accent colours, which is a second design system kept in step
with the real one by hand. It was not kept in step. Changing the accent in Settings
changed the library and left this green, because nothing here read the stylesheet and
nothing here could.

So it opens the library instead. Edge, Chrome and Brave all take --app=URL, which is a
window with no tabs and no address bar, wearing the page's own icon and its own CSS. The
watcher's state is answered by the app: the sync screen lists every watched folder with
when it was last looked at, which is the glance the panel existed to provide.

No dependency was added. A real webview on Windows means a package or a great deal of
ctypes, and a browser in app mode is the same window without either.
"""
import os
import sys
import time
import queue
import threading
import shutil
import subprocess
import webbrowser

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import jriter_client as agent                                      # noqa: E402


ICON = os.path.join(os.path.dirname(HERE), "web", "favicon.ico")

class Watcher(threading.Thread):
    """The scan and send loop, on its own thread, saying what it does through a queue.

    Every message is a (kind, text) pair and nothing else crosses: no shared mutable
    state beyond the two events. That was written when a window on another thread was
    reading them and it is still the right shape now they go to stdout, because the rule
    it encodes is that this thread owns nothing anybody else touches.
    """

    daemon = True

    def __init__(self, say, stop):
        super().__init__(name="jriter-watcher")
        self.say = say
        self.stop = stop
        #: Set to ask for a scan right now rather than at the next tick.
        self.wake = threading.Event()

    def run(self):
        while not self.stop.is_set():
            cfg = agent.load_config()
            minutes = max(1, int(cfg.get("interval_minutes", 5)))
            try:
                self._once(cfg)
            except SystemExit as e:
                # agent.Server raises this for an unreachable or refusing library, which is
                # the ordinary state of things when the host is asleep. Not fatal, and not
                # a stack trace either.
                self.say("bad", str(e).splitlines()[0])
            except Exception as e:
                self.say("bad", "%s: %s" % (type(e).__name__, e))
            # Woken early by Check now, or by the window closing. Waiting on the event
            # rather than sleeping means Quit does not hang for five minutes.
            self.wake.wait(minutes * 60)
            self.wake.clear()

    def _once(self, cfg):
        if not cfg.get("folders"):
            self.say("idle", "No folders watched yet.")
            return
        server = agent.Server(cfg["server"], cfg.get("token"))
        known, fresh = agent.survey(cfg, server)
        if not fresh:
            self.say("ok", "Nothing new. %d file(s) already in the library." % len(known))
            return
        self.say("work", "%d new file(s)." % len(fresh))
        sent = 0
        # (path, digest) pairs. Unpacked, because binding the pair to one name is precisely
        # the bug that kept this loop from ever sending anything.
        for path, _ in fresh:
            if self.stop.is_set():
                return
            try:
                if agent.send_render(cfg, server, path):
                    sent += 1
                    self.say("sent", os.path.basename(path))
            except Exception as e:
                self.say("bad", "%s: %s" % (os.path.basename(path), e))
        self.say("ok", "%d render(s) waiting in the library." % sent)


#: Browsers that take --app, and where they install themselves.
#:
#: which() first, because somebody who has put one on PATH means that one. The paths
#: after it are the defaults: a browser is usually not on PATH on Windows, so a which()
#: only answer would fall back to a tab on most machines.
BROWSERS = ("msedge", "chrome", "brave")
BROWSER_PLACES = (
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files\BraveSoftware\Brave-Browser\Application\brave.exe",
    r"C:\Program Files (x86)\BraveSoftware\Brave-Browser\Application\brave.exe",
)


#: Where the watcher writes what it did, and how much of it is kept.
#:
#: Beside the client's own config, because they belong to the same agent and somebody
#: looking for one will look for the other in the same place.
LOG = os.path.join(os.path.dirname(agent.CONFIG_PATH), "watch.log")
LOG_MOST = 256 * 1024


def find_browser():
    """One that can open a window without tabs, or None.

    Returned rather than acted on, so a test can ask what would be used without starting
    anything and so that finding none is the caller's to report.
    """
    for name in BROWSERS:
        found = shutil.which(name)
        if found:
            return found
    for path in BROWSER_PLACES:
        if os.path.isfile(path):
            return path
    return None


def window_command(url, exe, profile):
    """The command line that opens the library as a window.

    Its own line rather than inline, so the flags can be tested without launching a
    browser. --app is the one that matters: no tabs, no address bar, no back button, and
    the page's own favicon and theme colour on the window itself.

    A profile of its own, under the app's data directory, so the window does not depend on
    which browser window happened to be open, does not inherit an extension that rewrites
    pages, and remembers its own size.
    """
    return [exe, "--app=" + url,
            "--user-data-dir=" + profile,
            "--window-size=1180,860"]


def open_window(url, exe=None):
    """The library, in a window of its own. Returns what opened it, or None for a tab.

    A tab is the fallback and not a failure: it is still the library, and a machine with
    no Chromium browser on it should not be a machine with no interface.
    """
    exe = exe or find_browser()
    if not exe:
        webbrowser.open(url)
        return None
    profile = os.path.join(os.environ.get("LOCALAPPDATA") or HERE, "JRITER", "window")
    try:
        os.makedirs(profile, exist_ok=True)
        subprocess.Popen(window_command(url, exe, profile))
        return exe
    except OSError:
        webbrowser.open(url)
        return None


def main(argv=None):
    """Start the watcher, and unless told not to, open the library.

    The watcher is the reason this process exists and it outlives the window. Closing the
    library should no more stop it collecting bounces than closing a mail client stops
    mail arriving, so --minimised, which is how logon starts it, means watch and put
    nothing on screen.
    """
    argv = sys.argv[1:] if argv is None else argv
    url = (agent.load_config().get("server") or "").strip()

    def say(kind, text):
        """Where the log panel used to be.

        A file as well as stdout, and the file is the part that matters: logon starts this
        under pythonw.exe precisely so no console appears, and pythonw discards stdout. So
        printing alone would have quietly thrown away every message the watcher has ever
        had to give, which is the failure the window was built to prevent, reintroduced by
        the change that removed the window.

        Trimmed when it gets long rather than rotated. This is a few lines a day about
        whether files arrived; a rotation scheme for that is more machinery than the thing
        it manages.
        """
        line = "%s %s %s" % (time.strftime("%Y-%m-%d %H:%M:%S"),
                             "!" if kind == "bad" else "-", text)
        print(line, flush=True)
        try:
            with open(LOG, "a", encoding="utf-8") as f:
                f.write(line + "\n")
            if os.path.getsize(LOG) > LOG_MOST:
                with open(LOG, "r", encoding="utf-8", errors="replace") as f:
                    kept = f.readlines()[-400:]
                with open(LOG, "w", encoding="utf-8") as f:
                    f.writelines(kept)
        except OSError:
            pass                    # a log that cannot be written is not worth stopping for

    stop = threading.Event()
    watcher = Watcher(say, stop)
    watcher.start()

    if "--minimised" not in argv:
        if not url:
            print("No library address set yet. Run: python jriter_client.py server <url>")
        else:
            opened = open_window(url)
            say("ok", "opened %s%s" % (url, "" if opened else " in a browser tab"))

    # Joining in a loop rather than one blocking join, so a Ctrl+C is actually delivered:
    # on Windows an interrupt does not interrupt a join with no timeout.
    try:
        while watcher.is_alive():
            watcher.join(timeout=1.0)
    except KeyboardInterrupt:
        say("ok", "stopping")
        stop.set()
        watcher.wake.set()          # break the wait rather than sit out the interval
        watcher.join(timeout=5.0)
    return 0


if __name__ == "__main__":
    sys.exit(main())
