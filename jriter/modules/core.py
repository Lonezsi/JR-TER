"""What is switched on, and the handful of settings the whole app shares.

The web UI asks this first and hides any feature the server did not report, which is what
makes removing a module from config actually remove it from the interface rather than
leaving a button that returns 404.
"""
import time

from .. import config, registry, blobs, db, problems
from ..wire import Error

NAME = "core"
SCHEMA = []
_STARTED = time.time()


def state(req):
    return {
        "name": config.settings()["library_name"],
        # Not behind the devlog module. An app that cannot say which version it is is not
        # something worth making optional, and the rail reads this on every load.
        "version": __import__("jriter").__version__,
        "modules": registry.enabled(),
        "failed": registry.failures(),
        "summary": registry.summaries(),
        "settings": config.settings(),
        "storage": blobs.usage(),
        "started": _STARTED,
        "uptime": round(time.time() - _STARTED, 1),
    }


def get_settings(req):
    return config.settings()


def get_defaults(req):
    """What Settings puts back when asked to.

    Served rather than written into the page, so there is one table of defaults and it is
    the one the server actually falls back to.
    """
    return {"defaults": config.defaults()}


def put_settings(req):
    patch = req.json()
    allowed = {"library_name", "accent", "auto_update", "sync_interval_minutes",
               "ffmpeg_path", "dust", "glass_edge", "dither"}
    unknown = set(patch) - allowed
    if unknown:
        raise Error("not a setting: " + ", ".join(sorted(unknown)))
    saved = config.save_settings(patch)
    if "ffmpeg_path" in patch:
        # The lookup is cached for the same reason updater._COMMIT is, and somebody who
        # has just typed a path in should not have to restart the server to be believed.
        from .. import video
        video.forget()
    return saved


def _probe():
    """One query against a real library, from an endpoint nobody has signed in to.

    /api/health is open on purpose: the host watchdog force-kills this process when two
    probes miss, so it has to be answerable without a credential. Which means there is no
    account bound, and since libraries became one file each, "the database" is a question
    that needs a whose.

    The owner's, which is the library that has been there longest and the one whose absence
    means something is actually wrong. A server with no accounts at all has nothing to probe
    and is not broken for it: that is a fresh install waiting for somebody to set it up.
    """
    from .. import who, accounts
    if who.now() is not None:
        db.one("SELECT 1 AS one")
        return
    if not accounts.count():
        return
    with who.acting_as(accounts.OWNER):
        db.one("SELECT 1 AS one")


def health(req):
    """Is this process alive, and separately, is the library it is serving whole.

    `ok` stays pure liveness plus one query, because the host watchdog force-kills on it
    and a module that failed to load is not something restarting will fix: reporting that
    as unhealthy would put an unattended machine into a kill loop over a bad migration.
    `degraded` says what is wrong so it can be seen without SSH, and the watchdog is
    expected to log it and leave the server alone.
    """
    out = {"ok": True, "uptime": round(time.time() - _STARTED, 1)}
    try:
        _probe()
    except Exception as e:
        # The port answering while the database does not is exactly the wedged state the
        # watchdog exists for, and it was invisible to it.
        out["ok"] = False
        out["degraded"] = ["the database did not answer: %s" % e]
        return out

    kept = problems.count()
    if kept["kept"]:
        out["problems"] = kept["kept"]

    failed = registry.failures()
    door = None
    if registry.has("auth"):
        from . import auth
        door = auth.damaged()
    trouble = ["%s did not load" % name for name in sorted(failed)]
    if door:
        trouble.append(door)
    if trouble:
        out["degraded"] = trouble
    return out


def errors(req):
    """The tracebacks this server has produced since it started.

    Behind the door, unlike /api/health, because a traceback names paths on the machine
    and the shape of the code. Not on disk: see jriter/problems.py for why, and for what
    that costs.
    """
    return {"errors": problems.recent(int(req.q("limit") or 50)), **problems.count()}


def forget_errors(req):
    problems.clear()
    return {"cleared": True}


def ROUTES():
    return {
        ("GET", "/api/state"): state,
        ("GET", "/api/health"): health,
        ("GET", "/api/health/errors"): errors,
        ("DELETE", "/api/health/errors"): forget_errors,
        ("GET", "/api/settings"): get_settings,
        ("GET", "/api/settings/defaults"): get_defaults,
        ("PUT", "/api/settings"): put_settings,
    }
