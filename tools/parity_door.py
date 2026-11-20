"""Does the Spring door agree with the Python one, on one data folder?

Makes a throwaway data directory, sets it up with the Python modules, starts
server/target/jriter.jar on it, and checks over HTTP that cookies, passwords, invites,
tokens, the guess limit and the CSS bundle mean the same thing to both servers.

    python tools/parity_door.py        (build first: mvn -f server package)

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
TMP = tempfile.mkdtemp(prefix="jriter-parity-")
PORT = 7911
JAVA = os.environ.get("JRITER_JAVA") or r"C:\Java\jdk-21\bin\java.exe"
GLASS = os.environ.get("JRITER_GLASS") or os.path.abspath(
    os.path.join(os.path.dirname(ROOT), "foyer", "shared", "glass.css"))

os.environ.update(JRITER_DATA=TMP, JRITER_GLASS=GLASS, JRITER_FOYER="")
sys.path.insert(0, ROOT)
from jriter import accounts, config, http as pyhttp  # noqa: E402
from jriter.modules import auth as pyauth  # noqa: E402

failures = []


def check(name, ok, detail=""):
    print(("ok   " if ok else "FAIL ") + name + ("" if ok else "  " + str(detail)))
    if not ok:
        failures.append(name)


def call(method, path, body=None, cookie=None, headers=None):
    h = dict(headers or {})
    if cookie:
        h["Cookie"] = cookie
    data = None
    if body is not None:
        data = json.dumps(body).encode()
        h["Content-Type"] = "application/json"
    req = urllib.request.Request("http://127.0.0.1:%d%s" % (PORT, path), data=data,
                                 method=method, headers=h)
    try:
        res = urllib.request.urlopen(req, timeout=20)
    except urllib.error.HTTPError as e:
        res = e
    raw = res.read()
    try:
        parsed = json.loads(raw.decode())
    except ValueError:
        parsed = None
    return res.status, parsed, raw, res.headers


def session_of(headers):
    for value in headers.get_all("Set-Cookie") or []:
        if value.startswith("jriter_session="):
            return value.split(";")[0].split("=", 1)[1]
    return None


class FakeReq:
    headers = {}
    client = "local"
    params = {}


proc = None
log = open(os.path.join(TMP, "jar.log"), "wb")
try:
    # Set up with Python.
    accounts.create("owner", "pw", account_id=accounts.OWNER)
    py_cookie = pyauth.issue(1)
    token = pyauth.make_token("parity", "upload", account_id=1)
    full_token = pyauth.make_token("parity-full", "full", account_id=1)
    py_invite = accounts.make_invite(1, "python")
    accounts.close()

    env = dict(os.environ, JRITER_PORT=str(PORT), JRITER_HOME=ROOT, JRITER_HOST="127.0.0.1")
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

    # 1. health and state
    status, body, _, _ = call("GET", "/api/health")
    check("health answers ok", status == 200 and body.get("ok") is True, body)
    status, state, _, _ = call("GET", "/api/auth/state")
    pyauth.FOYER = ""
    py_state = pyauth.state(FakeReq())
    check("state has the same keys as Python", sorted(state) == sorted(py_state),
          (sorted(state), sorted(py_state)))
    check("state says not signed in", state["signed_in"] is False and state["has_password"] is True)

    # 2. cookies cross over in both directions
    status, _, _, headers = call("POST", "/api/auth/login", {"handle": "", "password": "pw"})
    spring_cookie = session_of(headers)
    check("owner signs in with an empty handle", status == 200 and spring_cookie, status)
    check("Python accepts the Spring cookie", pyauth.whose(spring_cookie) == 1)
    status, me, _, _ = call("GET", "/api/auth/me", cookie="jriter_session=" + py_cookie)
    check("Spring accepts the Python cookie", status == 200 and me["who"]["handle"] == "owner", me)
    status, _, _, _ = call("GET", "/api/auth/me", cookie="jriter_session=" + py_cookie[:-1] + "0")
    check("a forged cookie is refused", status == 401, status)
    status, _, _, _ = call("GET", "/api/auth/me")
    check("no cookie is refused", status == 401)

    # 3. the guess limit counts the last forwarded address
    status, body, _, _ = call("POST", "/api/auth/login", {"handle": "", "password": "no"},
                              headers={"X-Forwarded-For": "198.51.100.1"})
    check("wrong password is 401 'That is not right.'",
          status == 401 and body["error"].startswith("That is not right."), body)
    codes = []
    for i in range(9):
        codes.append(call("POST", "/api/auth/login", {"handle": "", "password": "no"},
                          headers={"X-Forwarded-For": "10.%d.0.1, 203.0.113.5" % i})[0])
    check("spoofing the first address does not escape the limit", codes[-1] == 429, codes)
    status, _, _, _ = call("POST", "/api/auth/login", {"handle": "", "password": "pw"},
                           headers={"X-Forwarded-For": "203.0.113.77"})
    check("another address is not locked", status == 200, status)

    # 4. tokens
    status, body, _, _ = call("GET", "/api/songs", headers={"X-Jriter-Token": token})
    check("an upload token gets past the door", status == 200 and "songs" in body, body)
    status, _, _, _ = call("DELETE", "/api/songs/1", headers={"X-Jriter-Token": token})
    check("an upload token cannot delete", status == 401, status)
    status, _, _, _ = call("GET", "/api/songs", headers={"X-Jriter-Token": "jt_wrong"})
    check("an unknown token is refused", status == 401)
    status, _, _, _ = call("DELETE", "/api/songs/1", headers={"X-Jong-Token": full_token})
    check("a full token via the old header passes the door", status == 404, status)

    # 5. invites, sign up, passwords
    sc = "jriter_session=" + spring_cookie
    status, body, _, _ = call("POST", "/api/auth/invites", {"note": "spring"}, cookie=sc)
    check("Spring makes an invite", status == 200 and "code" in body, body)
    check("Python can spend a Spring invite", accounts.invite_for(body["code"]) is not None)
    status, body, _, headers = call("POST", "/api/auth/signup",
                                    {"code": py_invite, "handle": "Friend", "password": "pw2", "name": "F"})
    check("Spring spends a Python invite", status == 200 and session_of(headers), body)
    friend = accounts.by_handle("friend")
    check("Python sees the new account and its password", friend and accounts.check(friend, "pw2"))
    status, _, _, _ = call("POST", "/api/auth/signup", {"code": py_invite, "handle": "again", "password": "x"})
    check("a spent invite does not work twice", status == 403, status)
    fc = "jriter_session=" + session_of(headers)
    status, body, _, headers = call("POST", "/api/auth/password", {"current": "pw2", "new": "pw3"}, cookie=fc)
    check("password change works", status == 200 and body.get("signed_out") is True, body)
    check("Python checks the new password", accounts.check(accounts.by_handle("friend"), "pw3"))
    status, _, _, _ = call("GET", "/api/auth/me", cookie=fc)
    check("the old session ended", status == 401, status)
    status, _, _, _ = call("GET", "/api/auth/invites", cookie="jriter_session=" + session_of(headers))
    check("a friend cannot list invites", status == 403, status)

    # 6. the CSS bundle is the same bytes
    want = pyhttp.bundle(os.path.join(config.WEB, "css"), ".css")
    status, _, raw, headers = call("GET", "/jriter.css")
    check("jriter.css is byte-identical to Python's", raw == want, (len(raw), len(want)))
    status, _, _, _ = call("GET", "/jriter.css", headers={"If-None-Match": headers["ETag"]})
    check("jriter.css answers 304 to its own ETag", status == 304, status)
    status, _, _, _ = call("GET", "/jriter.js")
    check("jriter.js needs the door", status in (200, 303) or status == 401, status)
finally:
    if proc:
        proc.kill()
        proc.wait()
    log.close()
    if failures:
        print("\n--- jar log ---")
        print(open(os.path.join(TMP, "jar.log"), errors="replace").read()[-3000:])
    try:
        shutil.rmtree(TMP, ignore_errors=True)
    except OSError:
        pass

print("\n%d failed" % len(failures) if failures else "\nall checks passed")
sys.exit(1 if failures else 0)
