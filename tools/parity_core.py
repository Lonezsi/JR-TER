"""Does the Spring server agree with the Python one on the core routes? (slice 9f)

Starts server/target/jriter.jar on a throwaway data directory and drives /api/state,
/api/settings, /api/settings/defaults and /api/health/errors over HTTP, asking
jriter/modules/core.py what it would answer, in-process, from the same data.

    python tools/parity_core.py          (build first: mvn -f server package)

Standard library only. Exits 1 on any failed check.
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TMP = tempfile.mkdtemp(prefix="jriter-parity-core-")
PORT = 7919
JAVA = os.environ.get("JRITER_JAVA") or r"C:\Java\jdk-21\bin\java.exe"
GLASS = os.environ.get("JRITER_GLASS") or os.path.abspath(
    os.path.join(os.path.dirname(ROOT), "foyer", "shared", "glass.css"))

os.environ.update(JRITER_DATA=os.path.join(TMP, "data"), JRITER_GLASS=GLASS, JRITER_FOYER="")
sys.path.insert(0, ROOT)
from jriter import accounts, db, registry, who, wire  # noqa: E402
from jriter.modules import auth as pyauth, core as pycore  # noqa: E402

registry.load()
failures = []


def check(name, ok, detail=""):
    print(("ok   " if ok else "FAIL ") + name + ("" if ok else "  " + str(detail)[:900]))
    if not ok:
        failures.append(name)


def call(method, path, body=None, cookie=None):
    h = {}
    if cookie:
        h["Cookie"] = cookie
    data = None
    if body is not None:
        data = json.dumps(body).encode()
        h["Content-Type"] = "application/json"
    req = urllib.request.Request("http://127.0.0.1:%d%s" % (PORT, path), data=data, method=method, headers=h)
    try:
        res = urllib.request.urlopen(req, timeout=60)
    except urllib.error.HTTPError as e:
        res = e
    content = res.read()
    try:
        parsed = json.loads(content.decode())
    except ValueError:
        parsed = None
    return res.status, parsed


def same(a, b):
    return json.loads(json.dumps(a)) == json.loads(json.dumps(b))


def fake(body=None, params=None):
    r = wire.Request("GET", "/", {}, {}, None, params or {})
    r._parsed = body if body is not None else {}
    return r


def py(fn, req):
    with who.acting_as(1):
        return fn(req)


def py_error(fn, req):
    try:
        py(fn, req)
    except wire.Error as e:
        return e.message
    return None


proc = None
log = open(os.path.join(TMP, "jar.log"), "wb")
try:
    accounts.create("owner", "pw", account_id=accounts.OWNER)
    owner = "jriter_session=" + pyauth.issue(1)
    env = dict(os.environ, JRITER_PORT=str(PORT), JRITER_HOME=ROOT, JRITER_HOST="127.0.0.1")
    env.pop("JRITER_WATCHDOG", None)
    proc = subprocess.Popen([JAVA, "-jar", os.path.join(ROOT, "server", "target", "jriter.jar")],
                            env=env, stdout=log, stderr=subprocess.STDOUT, cwd=TMP)
    for _ in range(120):
        try:
            if call("GET", "/api/health")[0] == 200:
                break
        except OSError:
            time.sleep(0.5)
    else:
        raise SystemExit("the jar never answered; see " + log.name)

    # -- the door -------------------------------------------------------------------------
    for method, path in [("GET", "/api/state"), ("GET", "/api/settings"), ("GET", "/api/settings/defaults"),
                         ("PUT", "/api/settings"), ("GET", "/api/health/errors"),
                         ("DELETE", "/api/health/errors")]:
        st, b = call(method, path, {} if method == "PUT" else None)
        check("signed out: %s %s" % (method, path), st == 401, (st, b))

    # -- defaults and settings ------------------------------------------------------------
    st, b = call("GET", "/api/settings/defaults", cookie=owner)
    check("defaults equal Python's", st == 200 and same(b, py(pycore.get_defaults, fake())), (st, b))
    st, b = call("GET", "/api/settings", cookie=owner)
    check("settings equal Python's", st == 200 and same(b, py(pycore.get_settings, fake())), (st, b))

    good = {"accent": "#112233", "adaptive": False, "dust": 40,
            "pinned": [{"kind": "song", "id": 3, "extra": 1}, {"kind": "album", "id": 2}],
            "lyrics_view": {"marks": False},
            "effect_presets": {
                "eq": [{"name": " Warm ", "values": {"bands": [
                    {"type": "peak", "freq": 100, "gain": 2.5, "q": 1, "ignored": 1},
                    {"type": "lowshelf", "on": False, "freq": 80, "gain": -1, "q": 0.7}]}}],
                "comp": [{"name": "Vocal", "values": {"ratio": 4, "threshold": -18.5}}]}}
    st, b = call("PUT", "/api/settings", good, cookie=owner)
    check("a good save answers 200", st == 200, (st, b))
    expected = py(pycore.put_settings, fake(json.loads(json.dumps(good))))
    check("the saved settings equal what Python makes of the same patch", same(b, expected), (b, expected))
    st, b2 = call("GET", "/api/settings", cookie=owner)
    check("GET after PUT equals Python's", same(b2, py(pycore.get_settings, fake())), (b2,))

    bad = [
        {"nonsense": 1, "alsonot": 2},
        {"pinned": "x"},
        {"pinned": [{"kind": "song", "id": True}]},
        {"pinned": [{"kind": "tune", "id": 1}]},
        {"pinned": [{"kind": "song", "id": 1}] * 101},
        {"lyrics_view": {"marks": 1}},
        {"lyrics_view": {"nope": True}},
        {"lyrics_view": []},
        {"effect_presets": []},
        {"effect_presets": {"fuzz": []}},
        {"effect_presets": {"comp": [{"name": "", "values": {}}]}},
        {"effect_presets": {"comp": [{"name": "x", "values": {"a": "b"}}]}},
        {"effect_presets": {"eq": [{"name": "x", "values": {"bands": [{"type": "peak", "freq": "a", "gain": 1, "q": 1}]}}]}},
        {"effect_presets": {"eq": [{"name": "x", "values": {"bands": [{"type": 1}]}}]}},
    ]
    for patch in bad:
        st, b = call("PUT", "/api/settings", patch, cookie=owner)
        want = py_error(pycore.put_settings, fake(json.loads(json.dumps(patch))))
        check("refused the same way: %s" % json.dumps(patch)[:60],
              st == 400 and want is not None and b.get("error") == want, (st, b, want))

    # -- state ----------------------------------------------------------------------------
    st, s = call("GET", "/api/state", cookie=owner)
    p = py(pycore.state, fake())
    check("state answers", st == 200, (st, s))
    check("state has Python's keys", set(s) == set(p), (sorted(s), sorted(p)))
    for key in ("name", "version", "settings", "audio", "storage", "failed"):
        check("state." + key, same(s.get(key), p.get(key)), (s.get(key), p.get(key)))
    check("state.modules is Python's minus youtube", s["modules"] == [m for m in p["modules"] if m != "youtube"],
          (s["modules"], p["modules"]))
    ps = {k: v for k, v in p["summary"].items() if k != "youtube"}
    check("summary has the same modules", set(s["summary"]) == set(ps), (sorted(s["summary"]), sorted(ps)))
    for k in sorted(ps):
        check("summary." + k, same(s["summary"].get(k), ps[k]), (s["summary"].get(k), ps[k]))
    check("started and uptime are numbers", isinstance(s["started"], float) and isinstance(s["uptime"], (int, float)), s)

    # -- the error list -------------------------------------------------------------------
    st, e = call("GET", "/api/health/errors", cookie=owner)
    check("errors list starts empty", st == 200 and e == {"errors": [], "kept": 0, "dropped": 0}, (st, e))
    st, b = call("GET", "/api/songs/not-a-number", cookie=owner)
    st, e = call("GET", "/api/health/errors?limit=5", cookie=owner)
    check("errors answers with the right shape", st == 200 and set(e) == {"errors", "kept", "dropped"}, (st, e))
    if e["kept"]:
        one = e["errors"][0]
        check("an error entry has Python's keys",
              set(one) == {"ref", "at", "where", "method", "kind", "message", "traceback"}, one)
        st, h = call("GET", "/api/health")
        check("health reports the kept problems", h.get("problems") == e["kept"], h)
    st, b = call("DELETE", "/api/health/errors", cookie=owner)
    check("clearing answers cleared", st == 200 and b == {"cleared": True}, (st, b))
    st, e = call("GET", "/api/health/errors", cookie=owner)
    check("and the list is empty again", e == {"errors": [], "kept": 0, "dropped": 0}, e)
finally:
    if proc:
        proc.terminate()
        try:
            proc.wait(timeout=15)
        except subprocess.TimeoutExpired:
            proc.kill()
    log.close()
    try:
        db.shut_down()
    except Exception:
        pass
    shutil.rmtree(TMP, ignore_errors=True)

print("\n%d failed" % len(failures) if failures else "\nall passed")
sys.exit(1 if failures else 0)
