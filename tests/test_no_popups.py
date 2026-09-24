"""Nothing the desktop client does on its own puts a window on the screen.

"pythonw pops up at random times" was three things, all found on the user's own PC:

  1. The daily update task ran the console python.exe, and it catches up on a missed run,
     so a laptop asleep at five in the morning got a console window whenever it woke.
  2. Every git, schtasks and powershell the client started from a windowless process got a
     console of its own, which is why moving the task to pythonw alone would have made it
     worse: five windows per update instead of one.
  3. The Start menu shortcut ran py.exe, a console launcher, so the app came with a
     console window that killed it when closed; and each click started one more watcher.

Each test below is one of those, asked of the code that does it.
"""
import io
import os
import subprocess
import sys
import types

import pytest

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, os.path.join(ROOT, "client"))

import jriter_client as agent   # noqa: E402
import jriter_app as app        # noqa: E402


def test_every_console_program_is_started_without_a_window(monkeypatch):
    """Everything update runs goes through quiet(), and quiet() asks for no window."""
    seen = []

    def fake_run(args, **kw):
        seen.append((list(args), kw))
        return types.SimpleNamespace(returncode=0, stdout="", stderr="")

    monkeypatch.setattr(subprocess, "run", fake_run)
    monkeypatch.setattr(agent, "log", lambda line: None)
    agent.cmd_update({}, None, None)

    assert seen, "update ran no git at all, so this watched nothing"
    for args, kw in seen:
        assert kw.get("creationflags") == agent.NO_WINDOW, (
            "%s was started without CREATE_NO_WINDOW, so a windowless parent gives it a"
            " console of its own" % args[:2])
        assert kw.get("stdin") == subprocess.DEVNULL, (
            "%s can wait on a question nobody is there to answer" % args[:2])
        assert kw["env"].get("GIT_TERMINAL_PROMPT") == "0"


def test_no_subprocess_call_in_the_client_goes_round_quiet():
    """A new subprocess.run added later would bring the windows back one call at a time.
    The two Popen calls that remain start GUI programs (a browser, FL Studio), which get
    no console whatever starts them."""
    for name in ("jriter_client.py", "jriter_app.py", "jriter_shell.py"):
        source = io.open(os.path.join(ROOT, "client", name), encoding="utf-8").read()
        body = source.replace("return subprocess.run(args, stdin=", "")
        assert "subprocess.run(" not in body, (
            "%s calls subprocess.run directly; route it through quiet()" % name)


def test_the_update_task_runs_windowless(monkeypatch, tmp_path):
    """The one that actually popped up. Its command is read off what install registers."""
    registered = {}

    def fake_quiet(args, **kw):
        if args[:2] == ["schtasks", "/Create"]:
            registered[args[args.index("/TN") + 1]] = args[args.index("/TR") + 1]
        return types.SimpleNamespace(returncode=0, stdout="", stderr="")

    monkeypatch.setattr(agent, "quiet", fake_quiet)
    monkeypatch.setattr(agent, "_run_at_logon", lambda command: True)
    monkeypatch.setattr(agent, "catch_up", lambda name: True)
    monkeypatch.setattr(agent.os, "name", "nt")
    fake_shell = types.ModuleType("jriter_shell")
    fake_shell.install = lambda: []
    fake_shell.installed = lambda: []
    monkeypatch.setitem(sys.modules, "jriter_shell", fake_shell)
    monkeypatch.setattr(agent, "windowless_python", lambda: r"C:\Py\pythonw.exe")
    monkeypatch.setattr(agent, "save_config", lambda cfg: None)

    args = types.SimpleNamespace(server=None, folder=None)
    agent.cmd_install({"server": "http://x", "folders": ["x"]}, None, args)

    command = registered.get("JRITER update")
    assert command, "install registered no update task: %s" % registered
    assert command.startswith('"C:\\Py\\pythonw.exe"'), (
        "the update task runs %s, which is a console program" % command.split('" ')[0])


def test_an_update_says_what_happened_somewhere_that_is_kept(monkeypatch):
    """pythonw throws stdout away. The task had been failing for days and nothing said so."""
    lines = []
    monkeypatch.setattr(agent, "log", lines.append)
    monkeypatch.setattr(agent, "quiet", lambda args, **kw: types.SimpleNamespace(
        returncode=0, stdout=" M something.py" if "status" in args else "", stderr=""))
    assert agent.cmd_update({}, None, None) == 1
    assert lines and "uncommitted" in lines[0], lines


def test_only_one_watcher_runs(monkeypatch):
    """A second launch opens the window and leaves; it does not start a second watcher."""
    started = []
    opened = []
    monkeypatch.setattr(app, "first_instance", lambda: False)
    monkeypatch.setattr(app, "Watcher", lambda *a: started.append(a))
    monkeypatch.setattr(app, "open_window", lambda url, exe=None: opened.append(url))
    monkeypatch.setattr(app.agent, "load_config", lambda: {"server": "http://lib"})
    assert app.main([]) == 0
    assert not started, "a second copy started its own watcher"
    assert opened == ["http://lib"], "a second launch did not open the window"

    opened.clear()
    assert app.main(["--minimised"]) == 0
    assert not opened, "a second logon launch opened a window nobody asked for"


@pytest.mark.skipif(os.name != "nt", reason="the mutex is a Windows thing")
def test_the_mutex_really_refuses_a_second_copy():
    # Its own name: the real app is usually running on the machine the tests run on, and
    # it holds the real one.
    code = ("import sys; sys.path.insert(0, %r); import jriter_app as a;"
            "a._MUTEX_NAME += '-test-%d';"
            "print(a.first_instance(), a.first_instance())"
            % (os.path.join(ROOT, "client"), os.getpid()))
    out = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True)
    assert out.stdout.split() == ["True", "False"], out.stdout + out.stderr


def test_the_window_skips_the_browsers_welcome_pages():
    command = app.window_command("http://lib", "msedge.exe", "profile")
    assert "--no-first-run" in command and "--no-default-browser-check" in command


def test_the_shortcut_is_made_from_the_real_interpreter():
    """py.exe lives in C:\\Windows beside pyw.exe, not pythonw.exe, so looking beside it
    found nothing and fell back to py.exe, a console."""
    script = io.open(os.path.join(ROOT, "install.ps1"), encoding="utf-8").read()
    assert "import sys;print(sys.executable)" in script, (
        "the installer looks for pythonw beside the launcher rather than the interpreter")
    assert "Split-Path $real -Parent" in script
