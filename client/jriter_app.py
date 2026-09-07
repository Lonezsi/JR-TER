#!/usr/bin/env python3
"""JR!TER on the desktop: a window, an icon on the taskbar, and the watcher inside it.

    python jriter_app.py                opens the window
    python jriter_app.py --minimised    starts it minimised, which is how logon starts it

Why this exists at all. The folder watcher used to run as a headless scheduled task, and a
headless task is a thing you have to take on faith: no window, no icon, no way to tell "it
is watching and nothing new has landed" from "it stopped in March". Both of the bugs the
tests next door pin down lived in that loop for exactly that reason. A window that says what
it last did is not a nicety here, it is the only way anybody would ever have noticed.

So this is the same watcher with a face on it. It is also where the two folder verbs live,
so they can be reached without a right click and without a console.

tkinter, because it is in the standard library and this project does not take dependencies.
That rules out a system tray icon, which on Windows needs Shell_NotifyIcon through ctypes or
a package; a normal window that minimises to the taskbar is what was asked for anyway.

Threading rule, and it is the one that matters: tkinter may only be touched from the thread
that made it. The watcher runs on its own thread and says everything through a queue that
the window drains on a timer. No worker here ever touches a widget.
"""
import os
import sys
import time
import queue
import threading
import webbrowser

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import jriter_client as agent                                      # noqa: E402

try:
    import tkinter as tk
    from tkinter import ttk, filedialog, messagebox
except ImportError:                                                # pragma: no cover
    tk = None

ICON = os.path.join(os.path.dirname(HERE), "web", "favicon.ico")

#: The app's own colours, close enough to the library's that the two look related.
INK = {
    "bg": "#0B0B0C", "panel": "#121214", "line": "#2A2A2E",
    "text": "#F2F3F4", "faint": "#9EA1A6", "dim": "#6B6E74",
    "accent": "#54B37A", "bad": "#D4685E",
}


def _own_the_taskbar_button():
    """Tell Windows this is its own application, not an instance of Python.

    Without this the taskbar groups the window under python.exe and shows the Python icon
    however carefully the window's own icon is set, because the icon on the taskbar button
    comes from the application model id and not from the window. Harmless anywhere else.
    """
    if os.name != "nt":
        return
    try:
        import ctypes
        ctypes.windll.shell32.SetCurrentProcessExplicitAppUserModelID("Lonezsi.JRITER.Agent")
    except Exception:
        pass                        # an icon is a nicety; not having it is not a failure


class Watcher(threading.Thread):
    """The scan and send loop, on its own thread, saying what it does through a queue.

    Every message is a (kind, text) pair and nothing else crosses: no widgets, no tkinter
    objects, no shared mutable state beyond the queue and two events.
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


class App:
    def __init__(self, root, minimised=False):
        self.root = root
        self.news = queue.Queue()
        self.stop = threading.Event()

        root.title("JR!TER")
        root.configure(bg=INK["bg"])
        root.geometry("560x460")
        root.minsize(460, 380)
        if os.path.isfile(ICON):
            try:
                root.iconbitmap(ICON)
            except tk.TclError:
                pass

        self._build()
        self._read_config()

        self.watcher = Watcher(self._post, self.stop)
        self.watcher.start()

        root.protocol("WM_DELETE_WINDOW", self.quit)
        root.after(120, self._drain)
        if minimised:
            root.iconify()

    # ── the window ───────────────────────────────────────────────────────────
    def _build(self):
        pad = {"padx": 14, "pady": 8}

        head = tk.Frame(self.root, bg=INK["bg"])
        head.pack(fill="x", **pad)
        tk.Label(head, text="JR!TER", bg=INK["bg"], fg=INK["text"],
                 font=("Segoe UI", 17, "bold")).pack(side="left")
        self.dot = tk.Label(head, text="●", bg=INK["bg"], fg=INK["dim"],
                            font=("Segoe UI", 11))
        self.dot.pack(side="right")
        self.state = tk.Label(head, text="starting", bg=INK["bg"], fg=INK["faint"],
                              font=("Segoe UI", 9))
        self.state.pack(side="right", padx=(0, 6))

        self.where = tk.Label(self.root, text="", bg=INK["bg"], fg=INK["faint"],
                              font=("Segoe UI", 9), anchor="w")
        self.where.pack(fill="x", padx=14)

        self.folders = tk.Label(self.root, text="", bg=INK["bg"], fg=INK["dim"],
                                font=("Segoe UI", 9), anchor="w", justify="left")
        self.folders.pack(fill="x", padx=14, pady=(2, 8))

        # Two rows, because five buttons on one line is a window nobody can make narrow.
        top = tk.Frame(self.root, bg=INK["bg"])
        top.pack(fill="x", padx=14, pady=2)
        bottom = tk.Frame(self.root, bg=INK["bg"])
        bottom.pack(fill="x", padx=14, pady=2)

        self._button(top, "Open library", self.open_library, main=True)
        self._button(top, "Check now", self.check_now)
        self._button(top, "Watch a folder", self.watch_folder)
        self._button(bottom, "Upload a folder", self.upload_folder)
        self._button(bottom, "Render a folder", self.render_folder)

        tk.Frame(self.root, bg=INK["line"], height=1).pack(fill="x", padx=14, pady=(10, 0))

        wrap = tk.Frame(self.root, bg=INK["bg"])
        wrap.pack(fill="both", expand=True, padx=14, pady=10)
        bar = ttk.Scrollbar(wrap)
        bar.pack(side="right", fill="y")
        self.log = tk.Text(wrap, bg=INK["panel"], fg=INK["faint"], bd=0,
                           font=("Consolas", 9), wrap="word", state="disabled",
                           yscrollcommand=bar.set, padx=10, pady=8,
                           highlightthickness=1, highlightbackground=INK["line"])
        self.log.pack(fill="both", expand=True)
        bar.config(command=self.log.yview)
        for kind, colour in (("sent", INK["accent"]), ("bad", INK["bad"]),
                             ("ok", INK["faint"]), ("idle", INK["dim"]),
                             ("work", INK["text"])):
            self.log.tag_configure(kind, foreground=colour)

    def _button(self, parent, label, command, main=False):
        button = tk.Button(
            parent, text=label, command=command, relief="flat", bd=0, cursor="hand2",
            bg=INK["accent"] if main else INK["panel"],
            fg="#05130B" if main else INK["text"],
            activebackground="#74D398" if main else "#1A1A1D",
            activeforeground="#05130B" if main else INK["text"],
            font=("Segoe UI", 9, "bold" if main else "normal"), padx=12, pady=6)
        button.pack(side="left", padx=(0, 6))
        return button

    # ── state ────────────────────────────────────────────────────────────────
    def _read_config(self):
        cfg = agent.load_config()
        self.where.config(text=cfg.get("server", ""))
        folders = cfg.get("folders") or []
        if folders:
            shown = "\n".join("   " + f for f in folders[:4])
            if len(folders) > 4:
                shown += "\n   and %d more" % (len(folders) - 4)
            self.folders.config(text="Watching %d folder(s):\n%s" % (len(folders), shown))
        else:
            self.folders.config(
                text="No folders watched. Use the Watch a folder button to add one.")
        return cfg

    def _post(self, kind, text):
        """Called from the watcher thread. Only ever puts on the queue."""
        self.news.put((kind, text))

    def _drain(self):
        """Called on the tkinter thread by a timer. The only place widgets are written."""
        try:
            while True:
                kind, text = self.news.get_nowait()
                self._write(kind, text)
                if kind == "bad":
                    self._light(INK["bad"], "not connected")
                elif kind in ("ok", "sent", "work"):
                    self._light(INK["accent"], "watching")
                elif kind == "idle":
                    self._light(INK["dim"], "idle")
        except queue.Empty:
            pass
        self.root.after(300, self._drain)

    def _light(self, colour, words):
        self.dot.config(fg=colour)
        self.state.config(text=words)

    def _write(self, kind, text):
        self.log.config(state="normal")
        self.log.insert("end", "%s  %s\n" % (time.strftime("%H:%M"), text), kind)
        # Bounded, or a machine left on for a month holds a month of log in memory.
        if int(self.log.index("end-1c").split(".")[0]) > 500:
            self.log.delete("1.0", "200.0")
        self.log.see("end")
        self.log.config(state="disabled")

    # ── the buttons ──────────────────────────────────────────────────────────
    def open_library(self):
        webbrowser.open(agent.load_config().get("server", ""))

    def check_now(self):
        self._write("work", "Checking now…")
        self.watcher.wake.set()

    def watch_folder(self):
        folder = filedialog.askdirectory(title="Watch which folder?")
        if not folder:
            return
        cfg = agent.load_config()
        folder = os.path.abspath(folder)
        if folder in cfg["folders"]:
            self._write("idle", "Already watching %s" % folder)
            return
        cfg["folders"].append(folder)
        agent.save_config(cfg)
        self._read_config()
        self._write("ok", "Watching %s" % folder)
        self.watcher.wake.set()

    def upload_folder(self):
        folder = filedialog.askdirectory(title="Upload every sound file in which folder?")
        if not folder:
            return
        paths = sorted(agent.walk([folder]))
        if not paths:
            messagebox.showinfo("JR!TER", "No sound files in there.")
            return
        if not messagebox.askyesno(
                "JR!TER", "Send %d sound file(s) from\n%s?" % (len(paths), folder)):
            return
        self._in_background("Uploading %d file(s)" % len(paths), self._upload, folder)

    def render_folder(self):
        folder = filedialog.askdirectory(title="Render every FL project in which folder?")
        if not folder:
            return
        self._in_background("Rendering", self._render, folder)

    def _in_background(self, what, work, *args):
        """Run something slow off the tkinter thread, saying so at both ends.

        A button that renders a folder of projects on the thread drawing the window is a
        window that stops repainting for twenty minutes, which every operating system
        eventually offers to close for you.
        """
        self._write("work", what + "…")

        def go():
            try:
                work(*args)
            except SystemExit as e:
                self._post("bad", str(e).splitlines()[0])
            except Exception as e:
                self._post("bad", "%s: %s" % (type(e).__name__, e))

        threading.Thread(target=go, daemon=True, name="jriter-job").start()

    def _upload(self, folder):
        cfg = agent.load_config()
        server = agent.Server(cfg["server"], cfg.get("token"))
        sent = failed = 0
        for path in sorted(agent.walk([folder])):
            try:
                if agent.send_one(cfg, server, path, yes=True):
                    sent += 1
                    self._post("sent", os.path.basename(path))
            except Exception as e:
                failed += 1
                self._post("bad", "%s: %s" % (os.path.basename(path), e))
        self._post("ok", "%d sent, %d could not be sent." % (sent, failed))

    def _render(self, folder):
        cfg = agent.load_config()
        fl = agent.flrender.find_fl(cfg.get("fl_path"))
        if not fl:
            self._post("bad", "FL Studio was not found. Set it with `flpath`.")
            return
        out = os.path.join(folder, "renders")
        done, failed = agent.flrender.render_folder(
            folder, out, "wav", fl, on_step=lambda text: self._post("work", text))
        self._post("ok", "%d rendered, %d failed. They are in %s"
                   % (len(done), len(failed), out))

    def quit(self):
        self.stop.set()
        # So the watcher's wait returns at once rather than the window hanging around for
        # the rest of the interval.
        self.watcher.wake.set()
        self.root.destroy()


def main(argv=None):
    argv = sys.argv[1:] if argv is None else argv
    if tk is None:
        print("This build of Python has no tkinter, so there is no window to open.")
        print("The watcher still works: python jriter_client.py watch")
        return 1
    _own_the_taskbar_button()
    root = tk.Tk()
    App(root, minimised="--minimised" in argv)
    root.mainloop()
    return 0


if __name__ == "__main__":
    sys.exit(main())
