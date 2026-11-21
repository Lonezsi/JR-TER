"""Does every real library read the same through Spring as through Python, with nothing lost?

Task 12 of the rework. Copies a data directory (read-only on the original), then:

  1. hashes every audio and picture file the databases point at;
  2. starts the Spring jar on one copy and the Python server on the other;
  3. compares, per account, everything Spring already serves with what Python serves,
     and hashes the audio Spring streams;
  4. calls every Python GET that takes no parameters on both, and lists the ones Spring
     does not answer yet ("not ported yet": a note, not a failure);
  5. takes the plain-text export from Python and checks it against the database.

    python tools/check_libraries.py [DATA]       (DATA defaults to C:\\JR-TER\\data)
    build first:  mvn -f server package -DskipTests

Standard library only. Nothing is ever written under DATA or the repo: the copies and the
export live in a temp directory that is removed at the end. Exits 1 on any failed check.
"""
import hashlib
import io
import json
import os
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SOURCE = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else r"C:\JR-TER\data")
TMP = tempfile.mkdtemp(prefix="jriter-check-lib-")
A = os.path.join(TMP, "spring")
B = os.path.join(TMP, "python")
SPRING_PORT, PY_PORT = 7913, 7914
JAVA = os.environ.get("JRITER_JAVA") or r"C:\Java\jdk-21\bin\java.exe"
GLASS = os.environ.get("JRITER_GLASS") or os.path.abspath(
    os.path.join(os.path.dirname(ROOT), "foyer", "shared", "glass.css"))

# Before jriter is imported: the Python side reads its data directory at import time.
os.environ.update(JRITER_DATA=B, JRITER_GLASS=GLASS, JRITER_FOYER="")
sys.path.insert(0, ROOT)

#: Keys whose value is the moment the answer was made, so two servers asked a second
#: apart can never agree on them. Nothing else is allowed to differ.
VOLATILE = {"now", "taken_at", "checked_at", "uptime"}
#: GETs that reach out of the machine or are about the door, not the library.
SKIP_PREFIXES = ("/api/update", "/api/auth", "/api/youtube")

failures = []
not_ported = []


def check(name, ok, detail=""):
    print(("ok   " if ok else "FAIL ") + name + ("" if ok else "  " + str(detail)[:400]))
    if not ok:
        failures.append(name)


def copy_data():
    """Copy the databases through sqlite's backup (which takes the WAL with it) and every
    other file as it is. The source is only ever opened read-only."""
    for dest in (A, B):
        for dirpath, _, names in os.walk(SOURCE):
            rel = os.path.relpath(dirpath, SOURCE)
            top = rel.split(os.sep)[0]
            if rel != "." and top != "accounts":
                continue
            os.makedirs(os.path.join(dest, rel), exist_ok=True)
            for n in names:
                if n.endswith(("-wal", "-shm", ".log", ".bak")) or ".bak" in n:
                    continue
                if rel == "." and n not in ("accounts.db", "auth.json"):
                    continue
                src, dst = os.path.join(dirpath, n), os.path.join(dest, rel, n)
                if n.endswith(".db"):
                    ro = sqlite3.connect("file:%s?mode=ro" % src.replace("\\", "/"), uri=True)
                    out = sqlite3.connect(dst)
                    ro.backup(out)
                    out.close()
                    ro.close()
                else:
                    shutil.copy2(src, dst)


def blob_path(base, account, digest):
    return os.path.join(base, "accounts", str(account), "blobs", digest[:2], digest[2:4], digest)


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def db_of(base, account):
    c = sqlite3.connect(os.path.join(base, "accounts", str(account), "jriter.db"))
    c.row_factory = sqlite3.Row
    return c


def tables_of(c):
    return [r[0] for r in c.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")]


def columns_of(c, table):
    return [r[1] for r in c.execute("PRAGMA table_info(%s)" % table)]


def call(port, path, cookie, method="GET"):
    req = urllib.request.Request("http://127.0.0.1:%d%s" % (port, path), method=method,
                                 headers={"Cookie": cookie})
    try:
        res = urllib.request.urlopen(req, timeout=120)
    except urllib.error.HTTPError as e:
        res = e
    return res.status, res.read(), res.headers


def as_json(raw):
    try:
        return json.loads(raw.decode("utf-8"))
    except ValueError:
        return None


def first_difference(a, b, where="$"):
    """The path of the first place two parsed JSON values differ, or None."""
    if isinstance(a, dict) and isinstance(b, dict):
        for k in sorted(set(a) | set(b)):
            if k in VOLATILE:
                continue
            if k not in a or k not in b:
                return "%s.%s (only in %s)" % (where, k, "spring" if k in a else "python")
            d = first_difference(a[k], b[k], "%s.%s" % (where, k))
            if d:
                return d
        return None
    if isinstance(a, list) and isinstance(b, list):
        if len(a) != len(b):
            return "%s length %d vs %d" % (where, len(a), len(b))
        for i, (x, y) in enumerate(zip(a, b)):
            d = first_difference(x, y, "%s[%d]" % (where, i))
            if d:
                return d
        return None
    if a != b and not (isinstance(a, (int, float)) and isinstance(b, (int, float)) and a == b):
        return "%s: %r vs %r" % (where, a, b)
    return None


def compare(label, path, cookies_account, spring_cookie, py_cookie):
    s_status, s_raw, _ = call(SPRING_PORT, path, spring_cookie)
    p_status, p_raw, _ = call(PY_PORT, path, py_cookie)
    return s_status, s_raw, p_status, p_raw


proc = None
server = None
log = None
try:
    print("source:", SOURCE)
    copy_data()
    accounts = sorted(int(n) for n in os.listdir(os.path.join(B, "accounts")) if n.isdigit())
    check("found libraries", bool(accounts), accounts)

    # -- 1. every file the databases point at is there and is what it says -------------
    pointers = [("versions", "digest"), ("renders", "digest"), ("artwork", "digest"),
                ("vocal_takes", "digest"), ("albums", "cover_digest")]
    total_blobs = 0
    for acc in accounts:
        c = db_of(B, acc)
        have = set(tables_of(c))
        counts = {t: c.execute("SELECT COUNT(*) FROM %s" % t).fetchone()[0] for t in sorted(have)}
        print("account %d: %s" % (acc, ", ".join("%s=%d" % kv for kv in counts.items() if kv[1])))
        digests = set()
        for table, col in pointers:
            if table in have and col in columns_of(c, table):
                digests |= {r[0] for r in c.execute(
                    "SELECT %s FROM %s WHERE %s IS NOT NULL AND %s != ''" % (col, table, col, col))}
        missing, wrong = [], []
        for d in sorted(digests):
            p = blob_path(B, acc, d)
            if not os.path.isfile(p):
                missing.append(d[:12])
            elif sha256(p) != d:
                wrong.append(d[:12])
        total_blobs += len(digests)
        check("account %d: %d files all present" % (acc, len(digests)), not missing, missing[:5])
        check("account %d: every file matches its SHA-256" % acc, not wrong, wrong[:5])
        c.close()

    # -- 2. both servers, each on its own copy ------------------------------------------
    log = open(os.path.join(TMP, "jar.log"), "wb")
    env = dict(os.environ, JRITER_DATA=A, JRITER_PORT=str(SPRING_PORT), JRITER_HOME=ROOT,
               JRITER_HOST="127.0.0.1", JRITER_FOYER="")
    proc = subprocess.Popen([JAVA, "-jar", os.path.join(ROOT, "server", "target", "jriter.jar")],
                            env=env, stdout=log, stderr=subprocess.STDOUT, cwd=TMP)
    from jriter import config, http, registry  # noqa: E402  (after the env var)
    from jriter.modules import auth as pyauth  # noqa: E402
    config.ensure_dirs()
    server = http.serve("127.0.0.1", PY_PORT)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    for _ in range(120):
        try:
            if call(SPRING_PORT, "/api/health", "")[0] == 200:
                break
        except OSError:
            time.sleep(0.5)
    else:
        raise SystemExit("the jar never answered; see " + log.name)
    check("python server loaded every module", not registry.failures(), registry.failures())

    # -- 3. what Spring serves, account by account --------------------------------------
    compared = 0
    for acc in accounts:
        cookie = "jriter_session=" + pyauth.issue(acc)
        s_status, s_raw, p_status, p_raw = compare("songs", "/api/songs?sort=title", acc, cookie, cookie)
        if p_status != 200:
            check("account %d signs in on Python" % acc, False, (p_status, p_raw[:200]))
            continue
        check("account %d signs in on Spring with the same cookie" % acc, s_status == 200, (s_status, s_raw[:200]))
        paths = ["/api/songs?sort=title", "/api/songs/most-opened?limit=50", "/api/renders"]
        songs = (as_json(p_raw) or {}).get("songs", [])
        for s in songs:
            paths += ["/api/songs/%d" % s["id"], "/api/songs/%d/titles" % s["id"],
                      "/api/songs/%d/versions" % s["id"]]
        for path in paths:
            s_status, s_raw, p_status, p_raw = compare(path, path, acc, cookie, cookie)
            compared += 1
            d = None if s_status == p_status else "status %d vs %d" % (s_status, p_status)
            if d is None and p_status == 200:
                d = first_difference(as_json(s_raw), as_json(p_raw))
            if d:
                check("account %d %s" % (acc, path), False, d)
        # the audio Spring streams hashes to the digest in the row
        c = db_of(B, acc)
        bad = []
        for kind, table in (("versions", "versions"), ("renders", "renders")):
            if table not in tables_of(c):
                continue
            for r in c.execute("SELECT id, digest FROM %s" % table):
                st, raw, _ = call(SPRING_PORT, "/api/%s/%d/audio" % (kind, r["id"]), cookie)
                if st != 200 or hashlib.sha256(raw).hexdigest() != r["digest"]:
                    bad.append("%s %d (status %d)" % (kind, r["id"], st))
        check("account %d: Spring streams every version and render byte for byte" % acc, not bad, bad[:5])
        c.close()
    check("compared %d answers" % compared, compared > 0)

    # -- 4. everything else Python answers, and Spring does not yet ---------------------
    cookie1 = "jriter_session=" + pyauth.issue(accounts[0])
    for method, pattern in sorted(registry.routes()):
        if method != "GET" or "<" in pattern or "{" in pattern or pattern.startswith(SKIP_PREFIXES):
            continue
        p_status, p_raw, _ = call(PY_PORT, pattern, cookie1)
        s_status, s_raw, _ = call(SPRING_PORT, pattern, cookie1)
        if p_status == 400:
            continue            # the route wants parameters; the pairs above cover it
        if s_status == 404 and p_status != 404:
            not_ported.append(pattern)
        elif s_status != p_status:
            check("GET %s same status" % pattern, False, "spring %d, python %d" % (s_status, p_status))
        elif p_status == 200:
            d = first_difference(as_json(s_raw), as_json(p_raw)) if as_json(p_raw) is not None else None
            if d:
                check("GET %s same answer" % pattern, False, d)

    # -- 5. the plain-text export -------------------------------------------------------
    for acc in accounts:
        cookie = "jriter_session=" + pyauth.issue(acc)
        st, raw, _ = call(PY_PORT, "/api/export", cookie)
        if st != 200:
            check("account %d export" % acc, False, (st, raw[:200]))
            continue
        z = zipfile.ZipFile(io.BytesIO(raw))
        lib = json.loads(z.read("library.json").decode("utf-8"))
        check("account %d export is jriter-library v2" % acc,
              lib.get("format") == "jriter-library" and lib.get("version") == 2,
              (lib.get("format"), lib.get("version")))
        c = db_of(B, acc)
        off = [t for t, rows in lib["tables"].items()
               if rows and len(rows) != c.execute("SELECT COUNT(*) FROM %s" % t).fetchone()[0]]
        check("account %d export row counts equal the database's" % acc, not off, off)
        have = {}
        for t in ("versions", "renders", "artwork", "vocal_takes"):
            for row in lib["tables"].get(t, []):
                if row.get("digest"):
                    have[row["digest"]] = True
        lost = [d[:12] for d in have if not os.path.isfile(blob_path(B, acc, d))]
        check("account %d: every digest the export names is a file" % acc, not lost, lost[:5])
        c.close()
finally:
    if proc:
        proc.kill()
        proc.wait()
    if log:
        log.close()
    if server:
        server.shutdown()
    if failures and os.path.exists(os.path.join(TMP, "jar.log")):
        print("\n--- jar log ---")
        print(open(os.path.join(TMP, "jar.log"), errors="replace").read()[-2500:])
    try:
        from jriter import db
        db.shut_down()
    except Exception:
        pass
    shutil.rmtree(TMP, ignore_errors=True)

print("\nnot ported yet (%d):" % len(not_ported))
for p in not_ported:
    print("  " + p)
print("\n%d failed" % len(failures) if failures else "\nall checks passed")
sys.exit(1 if failures else 0)
