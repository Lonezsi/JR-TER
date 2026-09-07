"""Keeping JR!TER up to date from its own GitHub repository.

The check is read only and says plainly when it cannot tell. Applying an update is a
fast forward pull and nothing else: no reset, no force, no stash. If the working tree has
been edited by hand, the update refuses and says so rather than throwing that work away.
"""
import os
import json
import time
import threading
import subprocess
import urllib.error
import urllib.request

from .. import config, db, who, accounts
from ..wire import Error

NAME = "updater"
SCHEMA = []

TIMEOUT = 25

#: How the process is stopped, named so a test can take it away.
#:
#: A test that let the real one through would end the test runner rather than the test, so
#: this is not indirection for its own sake: it is the difference between restart() being
#: coverable and being the one route nobody dares call.
_STOP = os._exit

#: How long to wait before stopping, so this request's own response is on the wire first.
STOP_AFTER = 0.6


def _tracked_changes():
    """Changes to files git is actually tracking, or "".

    --untracked-files=no, and that flag is the whole point. A plain porcelain status also
    lists anything sitting in the directory that git has never heard of, and this refused to
    update on the strength of it. On the machine that holds the library that meant one
    folder called data-backup-20260903, made by hand months earlier, silently blocking every
    update from then on: the page said an update was ready, offered no button, and gave no
    reason.

    Untracked files are not work a fast forward pull can throw away. The one case where they
    matter is an incoming commit adding a file at the same path, and git refuses that pull
    itself with a message naming the file, which is a better answer than declining in
    advance on behalf of a folder nobody was worried about.
    """
    changed, _ = _git("status", "--porcelain", "--untracked-files=no")
    return changed or ""


def _git(*args):
    try:
        done = subprocess.run(
            ("git",) + args, cwd=config.BASE, capture_output=True, text=True, timeout=TIMEOUT)
    except (OSError, subprocess.TimeoutExpired) as e:
        return None, str(e)
    if done.returncode != 0:
        return None, (done.stderr or done.stdout).strip()
    return done.stdout.strip(), None


def _is_repo():
    out, _ = _git("rev-parse", "--is-inside-work-tree")
    return out == "true"


def _remote_head():
    """The newest commit on the tracked branch, straight from the GitHub API."""
    url = "https://api.github.com/repos/%s/commits/%s" % (config.REPO, config.BRANCH)
    request = urllib.request.Request(url, headers={
        "Accept": "application/vnd.github+json", "User-Agent": "JR!TER"})
    with urllib.request.urlopen(request, timeout=TIMEOUT) as response:
        payload = json.loads(response.read().decode("utf-8"))
    return {"sha": payload.get("sha", ""),
            "message": (payload.get("commit", {}).get("message") or "").split("\n")[0],
            "date": payload.get("commit", {}).get("committer", {}).get("date", "")}


def check(req):
    if not _is_repo():
        return {"can_update": False,
                "why": "This copy of JR!TER is not a git checkout, so it cannot update itself."}
    local, error = _git("rev-parse", "HEAD")
    if error:
        return {"can_update": False, "why": "git could not be read: " + error}

    try:
        remote = _remote_head()
    except (urllib.error.URLError, OSError, ValueError) as e:
        # Saying the check failed is the point. Reporting "up to date" when the question
        # was never asked is the failure mode worth avoiding.
        return {"can_update": False, "local": local, "checked": False,
                "why": "GitHub could not be reached: %s" % e}

    dirty = _tracked_changes()
    behind = bool(remote["sha"]) and remote["sha"] != local
    return {
        "checked": True,
        "local": local,
        "remote": remote["sha"],
        "message": remote["message"],
        "date": remote["date"],
        "update_available": behind,
        "can_update": behind and not dirty,
        "dirty": bool(dirty),
        "why": ("There are uncommitted changes here, so the update was not applied."
                if behind and dirty else ""),
        "repo": config.REPO,
        "branch": config.BRANCH,
    }


def apply(req):
    global _COMMIT
    _COMMIT = None      # the pull moves HEAD; read it again next time
    if not _is_repo():
        raise Error("This copy of JR!TER is not a git checkout, so it cannot update itself.", 409)
    dirty = _tracked_changes()
    if dirty:
        raise Error("There are uncommitted changes to JR!TER's own files here. Commit or "
                    "discard them first, then update.", 409)
    before, _ = _git("rev-parse", "HEAD")
    out, error = _git("pull", "--ff-only", "origin", config.BRANCH)
    if error:
        raise Error("The pull did not succeed: " + error, 502)
    after, _ = _git("rev-parse", "HEAD")
    changed = before != after
    names = []
    if changed:
        listing, _ = _git("diff", "--name-only", before, after)
        names = (listing or "").splitlines()
    return {
        "updated": changed,
        "before": before,
        "after": after,
        "files": names,
        # Python has already imported the old modules, so the new ones are on disk and
        # not in memory. Saying this is the difference between an update that worked and
        # an update that looks like it did nothing.
        "restart_required": changed and any(n.endswith(".py") for n in names),
        "message": ("Updated. Restart JR!TER to run the new code."
                    if changed else "Already up to date."),
    }


#: The commit this process is running, worked out once.
#:
#: This is on /api/state, which the page asks for on every load and after every settings
#: change, and it used to shell out to git each time: eighty milliseconds of process
#: start up to answer a question whose answer cannot change while the process runs. An
#: update rewrites it, and a restart follows anyway.
_COMMIT = None


def _commit():
    global _COMMIT
    if _COMMIT is None:
        if not _is_repo():
            _COMMIT = False
        else:
            local, _ = _git("rev-parse", "--short", "HEAD")
            _COMMIT = local or "unknown"
    return _COMMIT


def SUMMARY():
    commit = _commit()
    if commit is False:
        return {"git": False}
    return {"git": True, "commit": commit}


def restart(req):
    """Stop the server so it starts again on the code that is on disk.

    Why this exists. A pull writes new files; Python is already running the modules it
    imported at startup and goes on doing so. So an update applied from the page changes
    nothing anybody can see, the version in the rail does not move, and the honest summary
    of that from the outside is "it does not update". The old answer was a dialog telling
    you to stop the server and start it again, which is a fine thing to read at the machine
    and useless on a host in another room with nobody logged into it.

    What happens next is not this function's doing. On the machine that holds the library
    there is a scheduled task that asks /api/health every three minutes and starts the
    server when nothing answers, so stopping is the whole of restarting. Anywhere else,
    stopping is just stopping, which is why the page says so before asking.

    Only the owner. Everybody else's session lives in this process too, and "somebody I
    gave an account to can stop the server" is not a thing to leave lying around.
    """
    if accounts.count() and who.now() != accounts.OWNER:
        raise Error("Only the owner of this library can restart the server.", 403)

    def bye():
        # A moment, so this request's own response is on the wire before the process goes.
        time.sleep(STOP_AFTER)
        # Every library's log folded back in first. os._exit runs no cleanup at all, which
        # is the point of using it, so anything that has to happen has to happen here.
        try:
            db.shut_down()
        except Exception:
            pass
        # _exit rather than sys.exit: this is not the main thread, so SystemExit would
        # end this thread and leave the server serving. Not a graceful shutdown and not
        # pretending to be one; what makes it safe is the checkpoint above.
        _STOP(0)

    threading.Thread(target=bye, name="restart", daemon=True).start()
    return {"restarting": True,
            "note": "Stopping now. If this machine runs the watchdog task it will be back "
                    "within a few minutes."}


def ROUTES():
    return {
        ("GET", "/api/update/check"): check,
        ("POST", "/api/update/apply"): apply,
        ("POST", "/api/update/restart"): restart,
    }
