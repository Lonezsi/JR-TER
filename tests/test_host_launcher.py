"""The script that starts this on the host, and the one line in it that can kill a
working server.

There were no tests for this file, which is the same gap the desktop app had: it only ever
runs on a machine nobody is sitting at, so everything it gets wrong is quiet by
construction. The launcher is also the watchdog, so it getting something wrong does not
show up as an error, it shows up as the library being down and coming back and going down
again.

WHAT HAPPENED ON FOYER. Foyer has the same launcher, and its server wrote one line to
stderr per request. PowerShell 5.1 wraps every line a native command writes to redirected
stderr in an ErrorRecord, and the launcher ran under $ErrorActionPreference = 'Stop', which
makes that a terminating error. The site bound its port, answered one request, wrote one
line about it, and both processes vanished, with no traceback and without reaching the
statement that records the exit code. Then the watchdog started it again three minutes
later, for one more request.

This app has never hit that, because its log_message is a pass. Both halves are checked
here anyway: the silence, which is load bearing and was documented as a preference, and the
error handling, which matters for the line silence cannot prevent. ThreadingHTTPServer
prints a request handler's traceback to stderr and carries on serving, and under 'Stop' the
response to one bad request would be to kill a server that was still working.
"""
import io
import os
import sys

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, HERE)

from jriter import http as jhttp   # noqa: E402

LAUNCHER = os.path.join(HERE, "hostsetup", "Start-Jriter.ps1")


def script():
    return io.open(LAUNCHER, encoding="utf-8").read()


def test_the_launcher_is_where_the_task_expects_it():
    assert os.path.isfile(LAUNCHER), (
        "the scheduled task on the host runs hostsetup\\Start-Jriter.ps1 by name, and it is"
        " not there")


def test_the_server_is_not_run_under_stop():
    """One line of the server's stderr would otherwise be fatal to both processes."""
    source = script()
    launch = source.index("& $py ")
    before = source[:launch]
    last = before.rfind("$ErrorActionPreference")
    assert last != -1, "the launcher says nothing about error handling at all"
    setting = before[last:before.index("\n", last)]
    assert "Continue" in setting, (
        "the launcher starts the server under %r. PowerShell turns each line of a native"
        " command's redirected stderr into an ErrorRecord, so under 'Stop' one line from"
        " the server kills this script and the server with it, and the statement that"
        " records the exit code never runs. Foyer died exactly this way on its first"
        " deploy." % setting.strip())


def test_stop_is_put_back_once_the_server_is_gone():
    """The rest of the script should still stop on a real fault."""
    source = script()
    after = source[source.index("& $py "):]
    assert "$ErrorActionPreference = 'Stop'" in after, (
        "error handling is left on Continue after the server exits, so whatever goes wrong"
        " in the rest of the launcher passes quietly")


def test_the_access_log_is_silence_and_that_is_not_only_a_preference():
    """log_message writes nothing, checked by calling it and watching the stream.

    It is documented as taste, an access log being noise for a tool one person uses. It is
    also the only reason this launcher has never been killed by the paragraph above, so it
    is worth a test rather than a comment.
    """
    handler = jhttp.Handler.__new__(jhttp.Handler)
    held = sys.stderr
    caught = io.StringIO()
    sys.stderr = caught
    try:
        handler.log_message("%s %s", "GET", "/api/state")
        handler.log_message("plain")
    finally:
        sys.stderr = held
    assert caught.getvalue() == "", (
        "log_message put %r on stderr. On the host that is one ErrorRecord per request"
        " inside the launcher." % caught.getvalue()[:200])


def test_the_launcher_asks_a_question_this_app_answers():
    """It decides the server is dead from /api/health, and restarts it when that fails.

    A route that moved or was renamed would make the watchdog kill a healthy server on
    every run, which is worse than having no watchdog at all.
    """
    source = script()
    assert "/api/health" in source, "the launcher no longer checks anything"

    from jriter import registry
    registry.load()
    routes = registry.routes()
    assert ("GET", "/api/health") in routes, (
        "the launcher asks for /api/health and nothing serves it, so the watchdog reads"
        " every run as a dead server, kills the process and starts another: %s"
        % sorted(p for m, p in routes if "health" in p))


def test_the_question_the_launcher_asks_is_answerable_without_logging_in():
    """The watchdog has no account, and it should not need one.

    Behind the door, /api/health answers with the login page or a refusal, which is not a
    200, so a perfectly healthy library would be killed and restarted every three minutes
    for ever. It is in OPEN_API on purpose and this is the test for that purpose.
    """
    assert "/api/health" in jhttp.OPEN_API, (
        "/api/health is behind the door now. The host watchdog cannot log in, so it would"
        " read every healthy run as dead and restart the library on a loop.")
