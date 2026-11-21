"""Does the desktop app (jriter-cli.exe) work against the Spring server?

Starts server/target/jriter.jar on a scratch data directory, then drives the built
desktop/target/dist/JRITER/jriter-cli.exe the way a PC would: point at the server, sign in,
watch a folder, send renders, push a file. Reads the result back through the HTTP API.
Never touches the real data or the real %APPDATA%\\jriter (the config is a temp file).

    mvn -f server package; powershell -File desktop/build.ps1; python tools/check_desktop.py

Standard library plus the repo's jriter modules (to make the scratch owner account).
"""
import json
import os
import shutil
import struct
import subprocess
import sys
import tempfile
import time
import urllib.request
import wave

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TMP = tempfile.mkdtemp(prefix="jriter-check-desktop-")
PORT = 7913
JAVA = os.environ.get("JRITER_JAVA") or r"C:\Java\jdk-21\bin\java.exe"
CLI = os.path.join(ROOT, "desktop", "target", "dist", "JRITER", "jriter-cli.exe")
GLASS = os.path.abspath(os.path.join(os.path.dirname(ROOT), "foyer", "shared", "glass.css"))

os.environ.update(JRITER_DATA=TMP, JRITER_GLASS=GLASS, JRITER_FOYER="")
sys.path.insert(0, ROOT)
from jriter import accounts  # noqa: E402

failures = []


def check(name, ok, detail=""):
    print(("ok   " if ok else "FAIL ") + name + ("" if ok else "  " + str(detail)))
    if not ok:
        failures.append(name)


def wav(path, n):
    w = wave.open(path, "wb")
    w.setnchannels(1)
    w.setsampwidth(2)
    w.setframerate(8000)
    w.writeframes(b"".join(struct.pack("<h", (i * (53 + n)) % 20000 - 10000) for i in range(4000)))
    w.close()


def cli(*args, stdin=""):
    env = dict(os.environ, JRITER_CLIENT_CONFIG=os.path.join(TMP, "client.json"))
    p = subprocess.run([CLI, *args], env=env, input=stdin, capture_output=True, text=True,
                       encoding="utf-8", errors="replace", timeout=120)
    return p.returncode, p.stdout + p.stderr


def owner_cookie():
    """Reading back needs a signed-in session: the machine token is upload-only by design."""
    req = urllib.request.Request("http://127.0.0.1:%d/api/auth/login" % PORT,
                                 data=json.dumps({"handle": "", "password": "pw"}).encode(),
                                 headers={"Content-Type": "application/json"})
    return urllib.request.urlopen(req, timeout=30).headers["Set-Cookie"].split(";")[0]


def api(path, cookie):
    req = urllib.request.Request("http://127.0.0.1:%d%s" % (PORT, path), headers={"Cookie": cookie})
    return json.loads(urllib.request.urlopen(req, timeout=30).read().decode())


proc = None
try:
    accounts.create("owner", "pw", account_id=accounts.OWNER)
    log = open(os.path.join(TMP, "jar.log"), "wb")
    env = dict(os.environ, JRITER_PORT=str(PORT), JRITER_HOME=ROOT, JRITER_HOST="127.0.0.1")
    proc = subprocess.Popen([JAVA, "-jar", os.path.join(ROOT, "server", "target", "jriter.jar")],
                            env=env, stdout=log, stderr=subprocess.STDOUT, cwd=TMP)
    for _ in range(120):
        try:
            urllib.request.urlopen("http://127.0.0.1:%d/api/health" % PORT, timeout=2)
            break
        except OSError:
            time.sleep(0.5)
    else:
        raise SystemExit("the jar never answered; see " + log.name)

    code, out = cli("server", "http://127.0.0.1:%d" % PORT)
    check("server sets", code == 0 and str(PORT) in out, out)
    code, out = cli("login", "--password", "no", "--name", "check")
    check("wrong password refused", code == 1 and "said no" in out, out)
    code, out = cli("login", "--password", "pw", "--name", "check")
    check("login", code == 0 and "can now reach" in out, out)
    check("token kept out of client.json", "token" not in json.load(open(os.path.join(TMP, "client.json"))))
    token = owner_cookie()

    folder = os.path.join(TMP, "bounces")
    os.makedirs(folder)
    wav(os.path.join(folder, "one.wav"), 1)
    wav(os.path.join(folder, "J\u00f3zsi dal.wav"), 2)
    code, out = cli("add", folder)
    check("add folder", code == 0, out)
    code, out = cli("scan")
    check("scan sees 2 new", code == 0 and "2 new file(s)" in out, out)
    code, out = cli("watch", "--once")
    check("watch --once sends", code == 0 and "2 render(s) waiting" in out, out)
    renders = api("/api/renders", token)
    items = renders.get("renders") or renders.get("items") or []
    names = sorted(r.get("filename") or r.get("name") or "" for r in items)
    check("both renders listed", len(items) == 2, renders)
    check("non-ASCII name arrived intact", any("J\u00f3zsi dal" in n for n in names), names)
    code, out = cli("watch", "--once")
    check("second pass still lists 2 renders", code == 0 and len(api("/api/renders", token).get("renders") or items) == 2, out)

    single = os.path.join(TMP, "single.wav")
    wav(single, 7)
    code, out = cli("push-file", single, "--yes")
    check("push-file stores a version", code == 0 and "stored as v1" in out, out)
    songs = api("/api/songs", token)["songs"]
    check("a song was made", [s["title"] for s in songs] == ["single"], songs)
    code, out = cli("push-file", single, "--yes")
    check("same file again is already here", code == 0 and "already here" in out, out)
    code, out = cli("render", os.path.join(TMP, "nothing.flp"))
    check("render of nothing fails politely", code == 1, out)
    code, out = cli("help")
    check("help", code == 0 and "jriter-cli" in out)
finally:
    subprocess.run(["cmdkey", "/delete:JRITER:" + os.path.abspath(os.path.join(TMP, "client.json"))], capture_output=True)
    if proc:
        proc.kill()
    time.sleep(1)
    shutil.rmtree(TMP, ignore_errors=True)

print("\n%d failed" % len(failures) if failures else "\nall passed")
sys.exit(1 if failures else 0)

