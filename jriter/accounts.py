"""Who exists on this server.

Not a module in the config.MODULES sense, and deliberately so. Everything in jriter/modules
is a feature that can be switched off; this cannot be, because it is what decides whose
library a request is about, and there is no coherent JR!TER with several people on it and
this switched off.

It owns the one database that is nobody's library: data/accounts.db, holding the accounts
themselves, the invite codes, and who has shared what with whom. Every other table in the
project lives inside an account's own file. See config.py for why.

What is stored, and what is not. A password is put through scrypt and only the result is
kept, the same as it always was. There are no rules about what a password may be: length
limits and character classes mostly push people towards one bad password reused everywhere,
and what actually stops guessing is the rate limit in auth.py, which costs the person who
knows it nothing.
"""
import os
import time
import hmac
import base64
import sqlite3
import hashlib
import secrets
import threading

from . import config
from .wire import Error

#: The owner. The person whose library was here before there were accounts, and whose
#: existing library becomes account 1 when this lands. Nothing about being the owner grants
#: any reach into anybody else's library: they make the invites, and that is all.
OWNER = 1

#: scrypt at these settings takes roughly a tenth of a second, which is nothing once a day
#: and a wall to anyone working through a list. Same numbers auth.py has always used, so a
#: password carried across from the single account era still verifies.
SCRYPT = {"n": 2 ** 14, "r": 8, "p": 1, "dklen": 32}

#: A handle is what somebody types to sign in. Kept boring on purpose: it ends up in a
#: share, in a preset name, and in a URL.
HANDLE_OK = "abcdefghijklmnopqrstuvwxyz0123456789-_."
HANDLE_MAX = 32

SCHEMA = [
    """
    CREATE TABLE IF NOT EXISTS accounts (
      id         INTEGER PRIMARY KEY,
      handle     TEXT NOT NULL UNIQUE,
      name       TEXT NOT NULL DEFAULT '',
      salt       TEXT NOT NULL,
      hash       TEXT NOT NULL,
      created_at REAL NOT NULL,
      last_seen  REAL NOT NULL DEFAULT 0,
      -- Rotating this signs that one person out everywhere without touching anybody else.
      -- The server secret used to be the only such lever and it logged out the world.
      secret     TEXT NOT NULL DEFAULT ''
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS invites (
      id         INTEGER PRIMARY KEY,
      digest     TEXT NOT NULL UNIQUE,
      made_by    INTEGER NOT NULL,
      note       TEXT NOT NULL DEFAULT '',
      created_at REAL NOT NULL,
      expires_at REAL NOT NULL DEFAULT 0,
      used_at    REAL NOT NULL DEFAULT 0,
      used_by    INTEGER NOT NULL DEFAULT 0
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS shares (
      id           INTEGER PRIMARY KEY,
      -- Whose library the song lives in, and which song. A song id only means anything
      -- inside one account's database, so the pair is the address.
      from_account INTEGER NOT NULL,
      song_id      INTEGER NOT NULL,
      to_account   INTEGER NOT NULL,
      -- What the recipient is called on this share. Optional: given one, their edits are
      -- named after them.
      as_name      TEXT NOT NULL DEFAULT '',
      created_at   REAL NOT NULL,
      revoked_at   REAL NOT NULL DEFAULT 0
    )
    """,
    "CREATE INDEX IF NOT EXISTS shares_to ON shares(to_account, revoked_at)",
    "CREATE INDEX IF NOT EXISTS shares_from ON shares(from_account, song_id)",
    # Machine credentials, for the desktop agent. Here rather than in a library, because
    # checking one means working out which library it belongs to, and you cannot look
    # inside a library to find out whether it is the right library.
    """
    CREATE TABLE IF NOT EXISTS tokens (
      id         INTEGER PRIMARY KEY,
      account_id INTEGER NOT NULL,
      name       TEXT NOT NULL,
      digest     TEXT NOT NULL UNIQUE,
      scope      TEXT NOT NULL DEFAULT 'upload',
      created_at REAL NOT NULL,
      last_used  REAL NOT NULL DEFAULT 0
    )
    """,
    "CREATE INDEX IF NOT EXISTS tokens_account ON tokens(account_id)",
]

_local = threading.local()
_lock = threading.Lock()
_ready = False


# ── the store ────────────────────────────────────────────────────────────────
def _conn():
    """This thread's connection to accounts.db, made on first use."""
    conn = getattr(_local, "conn", None)
    if conn is not None:
        return conn
    config.ensure_dirs()
    conn = sqlite3.connect(config.accounts_db(), timeout=30)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    _local.conn = conn

    global _ready
    with _lock:
        if not _ready:
            for statement in SCHEMA:
                conn.execute(statement)
            conn.commit()
            _ready = True
    return conn


def close():
    conn = getattr(_local, "conn", None)
    if conn is not None:
        try:
            conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
        except sqlite3.Error:
            pass
        conn.close()
        _local.conn = None


def reset_for_tests():
    """Forget the schema flag as well as the connection, so a fresh directory is fresh."""
    global _ready
    close()
    with _lock:
        _ready = False


def _query(sql, args=()):
    return [dict(r) for r in _conn().execute(sql, args).fetchall()]


def _one(sql, args=()):
    rows = _query(sql, args)
    return rows[0] if rows else None


def _run(sql, args=()):
    conn = _conn()
    cur = conn.execute(sql, args)
    conn.commit()
    return cur


# ── passwords ────────────────────────────────────────────────────────────────
def _hash(password, salt):
    return base64.b64encode(hashlib.scrypt(
        password.encode("utf-8"), salt=salt, **SCRYPT)).decode()


def check(account, password):
    """Is this the password on that account."""
    if not account:
        return False
    salt = base64.b64decode(account["salt"])
    return hmac.compare_digest(_hash(password or "", salt), account["hash"])


def set_password(account_id, password):
    if not isinstance(password, str) or not password:
        raise Error("Type a password. Anything you like, but not nothing.")
    salt = secrets.token_bytes(16)
    _run("UPDATE accounts SET salt = ?, hash = ? WHERE id = ?",
         (base64.b64encode(salt).decode(), _hash(password, salt), account_id))
    return True


def sign_out_everywhere(account_id):
    """Rotate one person's secret, which invalidates every cookie ever issued to them.

    Theirs alone. The server wide secret is still there and still ends every session on the
    machine, but "I changed my password" should not sign out the four other people using
    this server, and before accounts there was no way to say that.
    """
    _run("UPDATE accounts SET secret = ? WHERE id = ?",
         (secrets.token_hex(32), account_id))


def secret_of(account_id):
    """The per account half of a session signature, made on first use."""
    row = _one("SELECT secret FROM accounts WHERE id = ?", (account_id,))
    if not row:
        return None
    if not row["secret"]:
        fresh = secrets.token_hex(32)
        _run("UPDATE accounts SET secret = ? WHERE id = ?", (fresh, account_id))
        return fresh
    return row["secret"]


# ── handles ──────────────────────────────────────────────────────────────────
def tidy_handle(raw):
    """What somebody typed, as a handle, or an explanation of why it is not one."""
    handle = (raw or "").strip().lower()
    if not handle:
        raise Error("Choose a handle. It is what you type to sign in.")
    if len(handle) > HANDLE_MAX:
        raise Error("That handle is too long: %d characters at most." % HANDLE_MAX)
    bad = sorted({c for c in handle if c not in HANDLE_OK})
    if bad:
        raise Error("A handle can hold letters, digits, and - _ . only. Not: "
                    + " ".join(bad))
    return handle


def by_handle(handle):
    return _one("SELECT * FROM accounts WHERE handle = ?", ((handle or "").strip().lower(),))


def by_id(account_id):
    return _one("SELECT * FROM accounts WHERE id = ?", (account_id,))


def owner():
    """The account with the lowest id, which is the one that was here first."""
    return _one("SELECT * FROM accounts ORDER BY id LIMIT 1")


def count():
    row = _one("SELECT COUNT(*) AS n FROM accounts")
    return row["n"] if row else 0


def public(account):
    """What anybody signed in is allowed to know about an account.

    Never the hash, never the salt, never the secret. The handle and the name, because a
    share has to be addressed to somebody and shown as from somebody.
    """
    if not account:
        return None
    return {"id": account["id"], "handle": account["handle"],
            "name": account["name"] or account["handle"],
            "is_owner": account["id"] == OWNER,
            "created_at": account["created_at"]}


def create(handle, password, name="", account_id=None):
    """Make an account and the directory its library will live in."""
    handle = tidy_handle(handle)
    if by_handle(handle):
        raise Error("Somebody already has the handle %s." % handle, 409)
    if not isinstance(password, str) or not password:
        raise Error("Type a password. Anything you like, but not nothing.")

    salt = secrets.token_bytes(16)
    row = {"handle": handle, "name": (name or "").strip()[:80],
           "salt": base64.b64encode(salt).decode(), "hash": _hash(password, salt),
           "created_at": time.time(), "secret": secrets.token_hex(32)}
    columns = list(row)
    if account_id is not None:
        columns.append("id")
        row["id"] = account_id
    cur = _run("INSERT INTO accounts (%s) VALUES (%s)"
               % (", ".join(columns), ", ".join("?" for _ in columns)),
               tuple(row[c] for c in columns))
    made = account_id if account_id is not None else cur.lastrowid
    # The directory before anything can be written into it. An account whose library
    # cannot be made is an account that fails on its first request instead of at signup.
    config.ensure_home(made)
    return by_id(made)


def seen(account_id):
    _run("UPDATE accounts SET last_seen = ? WHERE id = ?", (time.time(), account_id))


def rename(account_id, name):
    _run("UPDATE accounts SET name = ? WHERE id = ?", ((name or "").strip()[:80], account_id))
    return by_id(account_id)


def everybody():
    return _query("SELECT * FROM accounts ORDER BY id")


# ── invites ──────────────────────────────────────────────────────────────────
#
# Signing up needs one. This server answers on a public address, so an open signup form is
# an offer to every crawler that finds it to make an account and start storing files on
# somebody's home machine.

def _invite_digest(raw):
    return hashlib.sha256(("jriter-invite:" + (raw or "")).encode("utf-8")).hexdigest()


def make_invite(made_by, note="", days=14):
    """Mint one. The code comes back once and only its digest is kept."""
    raw = "-".join(secrets.token_hex(2) for _ in range(3))
    _run("INSERT INTO invites (digest, made_by, note, created_at, expires_at) "
         "VALUES (?, ?, ?, ?, ?)",
         (_invite_digest(raw), made_by, (note or "").strip()[:80], time.time(),
          time.time() + days * 86400 if days else 0))
    return raw


def invite_for(raw):
    """The unspent, unexpired invite matching this code, or None."""
    row = _one("SELECT * FROM invites WHERE digest = ?", (_invite_digest(raw),))
    if not row or row["used_at"]:
        return None
    if row["expires_at"] and row["expires_at"] < time.time():
        return None
    return row


def spend_invite(invite_id, by):
    _run("UPDATE invites SET used_at = ?, used_by = ? WHERE id = ?",
         (time.time(), by, invite_id))


def invites_by(account_id):
    rows = _query("SELECT * FROM invites WHERE made_by = ? ORDER BY created_at DESC",
                  (account_id,))
    for row in rows:
        # Never the digest. It is not the code, but it is the only thing standing between
        # a leaked list and a working one.
        row.pop("digest", None)
        row["used"] = bool(row["used_at"])
        row["expired"] = bool(row["expires_at"] and row["expires_at"] < time.time()
                              and not row["used_at"])
        if row["used_by"]:
            row["used_by_handle"] = (by_id(row["used_by"]) or {}).get("handle", "")
    return rows


def drop_invite(invite_id, made_by):
    _run("DELETE FROM invites WHERE id = ? AND made_by = ?", (invite_id, made_by))


# ── shares ───────────────────────────────────────────────────────────────────
#
# A row here is the only thing that lets one account read anything of another's, so this is
# the whole of the permission model. jriter/modules/sharing.py is the only caller, and it is
# the only place that turns one of these into an actual crossing.

def add_share(from_account, song_id, to_account, as_name=""):
    cur = _run("INSERT INTO shares (from_account, song_id, to_account, as_name, created_at) "
               "VALUES (?, ?, ?, ?, ?)",
               (from_account, song_id, to_account, as_name, time.time()))
    return cur.lastrowid


def share(share_id):
    return _one("SELECT * FROM shares WHERE id = ?", (share_id,))


def share_between(from_account, song_id, to_account):
    return _one("SELECT * FROM shares WHERE from_account = ? AND song_id = ? "
                "AND to_account = ?", (from_account, song_id, to_account))


def shares_to(account_id):
    """Live shares somebody has given this account."""
    return _query("SELECT * FROM shares WHERE to_account = ? AND revoked_at = 0 "
                  "ORDER BY created_at DESC", (account_id,))


def shares_from(account_id, song_id=None):
    if song_id is None:
        return _query("SELECT * FROM shares WHERE from_account = ? AND revoked_at = 0 "
                      "ORDER BY created_at DESC", (account_id,))
    return _query("SELECT * FROM shares WHERE from_account = ? AND song_id = ? "
                  "AND revoked_at = 0 ORDER BY created_at DESC", (account_id, song_id))


def revoke_share(share_id):
    """Marked rather than deleted.

    The row is what says a copy in somebody's library came from a share, and their copies
    stay theirs. Deleting the row would leave those orphaned and unexplainable.
    """
    _run("UPDATE shares SET revoked_at = ? WHERE id = ?", (time.time(), share_id))


# ── machine credentials ──────────────────────────────────────────────────────
def add_token(account_id, name, digest, scope):
    _run("INSERT INTO tokens (account_id, name, digest, scope, created_at) "
         "VALUES (?, ?, ?, ?, ?)", (account_id, name, digest, scope, time.time()))


def token_for(digest):
    return _one("SELECT * FROM tokens WHERE digest = ?", (digest,))


def token_used(token_id):
    _run("UPDATE tokens SET last_used = ? WHERE id = ?", (time.time(), token_id))


def tokens_of(account_id):
    # Never the digest: it is not the credential, but it is the only thing between a
    # leaked list and a working one.
    return _query("SELECT id, name, scope, created_at, last_used FROM tokens "
                  "WHERE account_id = ? ORDER BY created_at DESC", (account_id,))


def drop_token(token_id, account_id):
    """Scoped to the account, so an id guessed off another library revokes nothing."""
    _run("DELETE FROM tokens WHERE id = ? AND account_id = ?", (token_id, account_id))


def adopt_old_tokens(rows, account_id):
    """Carry the tokens out of a pre accounts library across, keeping them working.

    The agent on somebody's laptop holds a token it cannot re-mint on its own: it would go
    on 401ing silently, which is exactly the failure this project has already had once. The
    digest is what is stored, so moving the row moves the credential intact.
    """
    moved = 0
    for row in rows:
        if _one("SELECT id FROM tokens WHERE digest = ?", (row["digest"],)):
            continue
        _run("INSERT INTO tokens (account_id, name, digest, scope, created_at, last_used) "
             "VALUES (?, ?, ?, ?, ?, ?)",
             (account_id, row["name"], row["digest"], row["scope"],
              row["created_at"], row["last_used"]))
        moved += 1
    return moved


# ── the first account ────────────────────────────────────────────────────────
def adopt_single_library(auth_data):
    """Turn the library that was here before accounts into account 1.

    Called once, on the way up, and only when there is no accounts.db yet and the old
    single library exists. Two things move:

      the files      data/jriter.db, data/blobs, data/settings.json and the rest go to
                     data/accounts/1/, which is where everything now looks for them
      the password   the scrypt salt and hash out of auth.json become account 1's, so the
                     password that worked yesterday works today

    The handle is "owner" and the sign in page treats an empty handle as meaning the owner,
    so somebody who has only ever typed a password carries on typing only a password.

    Returns what it did, or None when there was nothing to do. Nothing here is caught: a
    half moved library is worse than a server that refuses to start and says why.
    """
    old_db = os.path.join(config.DATA, "jriter.db")
    if not os.path.exists(old_db):
        return None
    if count():
        return None                     # accounts already exist; this has happened

    if not (auth_data or {}).get("hash"):
        # A library with no password cannot become an account with a password, and
        # inventing one would be choosing somebody's credential for them.
        return None

    # The directory, and deliberately not ensure_home, which also makes blobs/.
    #
    # The move below skips anything already present at the target, so that it can never
    # overwrite something newer. ensure_home would have created an empty blobs/ a moment
    # earlier, the skip would have fired on it, and the audio would have stayed behind in
    # the old place while the database moved: every song in the library pointing at a file
    # that is no longer where it looks. Found by the test next door, not by reasoning.
    home = os.path.join(config.DATA, "accounts", str(OWNER))
    os.makedirs(home, exist_ok=True)

    # The machine tokens come out before the file moves, because they are moving somewhere
    # else: into accounts.db, beside the accounts. The agent on a laptop holds a token it
    # cannot re-mint by itself, and this project has already had one silent-401 outage from
    # a credential that stopped being recognised. Read first, written after the account row
    # exists, so a failure here leaves the library where it was.
    con = sqlite3.connect(old_db)
    con.row_factory = sqlite3.Row
    old_tokens = []
    try:
        held = con.execute(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'auth_tokens'"
        ).fetchone()
        if held:
            old_tokens = [dict(r) for r in con.execute(
                "SELECT name, digest, scope, created_at, last_used FROM auth_tokens")]
        # The log, so the move is one file rather than two with a window between them.
        # With synchronous=NORMAL most of a busy library can be sitting in the -wal.
        con.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    finally:
        con.close()

    moved = []
    for name in ("jriter.db", "settings.json", "youtube.json", "blobs", "appearance",
                 "youtube"):
        source = os.path.join(config.DATA, name)
        if not os.path.exists(source):
            continue
        target = os.path.join(home, name)
        if os.path.exists(target):
            continue                    # already there, so leave whatever is newer alone
        os.replace(source, target)
        moved.append(name)
    for leftover in (old_db + "-wal", old_db + "-shm"):
        try:
            os.remove(leftover)
        except OSError:
            pass

    # The account itself, carrying the existing salt and hash rather than a new password.
    _run("INSERT INTO accounts (id, handle, name, salt, hash, created_at, secret) "
         "VALUES (?, ?, ?, ?, ?, ?, ?)",
         (OWNER, "owner", "", auth_data["salt"], auth_data["hash"],
          auth_data.get("set_at") or time.time(), secrets.token_hex(32)))
    carried = adopt_old_tokens(old_tokens, OWNER)
    # Now that nothing is being moved on top of, make anything that did not exist to move.
    config.ensure_home(OWNER)
    return {"account": OWNER, "moved": moved, "tokens": carried}
