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
        # What counts as audio, so the page and the server agree about it. The page
        # refuses a dropped file before uploading it, and a second list written into the
        # browser is a list that disagrees with this one the week an extension is added.
        "audio": list(config.AUDIO_EXT),
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
    # The keys of the defaults table, rather than a list written out again here.
    #
    # It was written out, and the two matched exactly, which is the state a hand kept copy
    # is in right up until it is not: adding "adaptive" to the defaults left this rejecting
    # it as "not a setting", so the switch saved on every machine except the one it was
    # tested on. A setting that exists is a setting that can be set.
    allowed = set(config.defaults())
    unknown = set(patch) - allowed
    if unknown:
        raise Error("not a setting: " + ", ".join(sorted(unknown)))
    if "effect_presets" in patch:
        patch["effect_presets"] = _effect_presets(patch["effect_presets"])
    if "pinned" in patch:
        pinned = patch["pinned"]
        if (not isinstance(pinned, list) or len(pinned) > 100 or not all(
                isinstance(p, dict) and p.get("kind") in ("song", "album", "playlist", "render")
                and isinstance(p.get("id"), int) and not isinstance(p.get("id"), bool) for p in pinned)):
            raise Error("pinned takes up to 100 {kind, id} entries")
        patch["pinned"] = [{"kind": p["kind"], "id": p["id"]} for p in pinned]
    if "lyrics_view" in patch:
        view = patch["lyrics_view"]
        keys = set(config.defaults()["lyrics_view"])
        if not isinstance(view, dict) or set(view) - keys or not all(isinstance(v, bool) for v in view.values()):
            raise Error("lyrics_view takes " + ", ".join(sorted(keys)) + ", each true or false")
        patch["lyrics_view"] = {**config.defaults()["lyrics_view"], **view}
    saved = config.save_settings(patch)
    if "ffmpeg_path" in patch:
        # The lookup is cached for the same reason updater._COMMIT is, and somebody who
        # has just typed a path in should not have to restart the server to be believed.
        from .. import video
        video.forget()
    return saved


EFFECT_KINDS = ("eq", "comp", "drive", "delay", "reverb", "width", "gain", "limiter")


def _effect_presets(value):
    """Effect presets as the Sound tab saves them, checked: a known effect kind, at most
    fifty presets each, a name of at most eighty characters, values that are numbers (or,
    for an equaliser, a list of at most twenty-four bands of numbers and a filter type).
    Anything else is refused rather than stored, since this file is read back into the
    page on every load."""
    if not isinstance(value, dict):
        raise Error("effect presets must be an object")
    out = {}
    for kind, presets in value.items():
        if kind not in EFFECT_KINDS or not isinstance(presets, list) or len(presets) > 50:
            raise Error("effect presets: bad entry for %r" % kind)
        clean = []
        for p in presets:
            name = p.get("name") if isinstance(p, dict) else None
            values = p.get("values") if isinstance(p, dict) else None
            if not isinstance(name, str) or not name.strip() or len(name) > 80 or not isinstance(values, dict):
                raise Error("effect presets: each needs a name and values")
            if kind == "eq":
                bands = values.get("bands", [])
                if not isinstance(bands, list) or len(bands) > 24:
                    raise Error("effect presets: an equaliser holds up to 24 bands")
                kept = []
                for b in bands:
                    if not isinstance(b, dict) or not isinstance(b.get("type"), str) or len(b["type"]) > 12:
                        raise Error("effect presets: bad band")
                    nums = {k: b.get(k) for k in ("freq", "gain", "q")}
                    if not all(isinstance(v, (int, float)) and not isinstance(v, bool) for v in nums.values()):
                        raise Error("effect presets: bad band")
                    kept.append({"type": b["type"], "on": bool(b.get("on", True)), **nums})
                clean.append({"name": name.strip(), "values": {"bands": kept}})
            else:
                if len(values) > 16 or not all(isinstance(k, str) and isinstance(v, (int, float)) and not isinstance(v, bool)
                                               for k, v in values.items()):
                    raise Error("effect presets: values must be numbers")
                clean.append({"name": name.strip(), "values": values})
        out[kind] = clean
    return out


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
