"""The door, and which of several people came through it.

There used to be one password and one library. There are now accounts, one library each,
and this module is what turns a request into the answer to "whose". The accounts themselves
live in jriter/accounts.py; this is the door in front of them.

There are still no rules about what a password may be. Length limits, character classes and
"must contain a symbol" mostly push people towards one bad password reused everywhere. What
guards the door instead is a limit on guessing: six wrong answers and that address waits,
for longer each time. That trade is unchanged, and it now costs an attacker more, because
they have to guess a handle as well.

The password is never stored. It is put through scrypt, which is deliberately slow and
memory hungry, and only the result is kept.

The session cookie carries who it belongs to and is signed with two secrets: the server's,
which ends every session on this machine when it rotates, and the account's own, which ends
only that person's. Before there were accounts there was only the first, so changing a
password signed out everybody on the server, which with one user was the same thing and now
is not.

Signing up needs an invite. This server answers on a public address, and an open signup form
is an offer to every crawler that finds it to make an account and store files on somebody's
home machine.
"""
import os
import json
import time
import hmac
import base64
import hashlib
import secrets
import threading

from .. import config, db, who, accounts
from ..wire import Error, Response, need

NAME = "auth"
#: No tables of its own in the library any more.
#:
#: auth_tokens used to live here, and it cannot: checking a machine token means working out
#: which library it belongs to, and you cannot look inside a library to find out whether it
#: is the right library. They moved to accounts.db, beside the accounts they belong to. See
#: accounts.TOKENS. A library that still holds the old table simply stops being asked about
#: it; nothing reads it, and dropping it would be destroying a credential store on an
#: upgrade for the sake of tidiness.
SCHEMA = []

#: What a token is allowed to do.
#:
#: The agent that watches a folder needs to push bytes and to know the library is there.
#: It does not need to delete a song, and a credential sitting in a plain file on a
#: laptop should not be able to. "upload" is every route the client actually calls;
#: "full" exists for a token you deliberately make for something else.
SCOPES = {
    # Every route the client actually calls, checked against client/jriter_client.py rather
    # than assumed: the first version of this list left out /api/versions/have and
    # /api/songs/match, which survey() calls on every pass, so a token carrying agent got
    # a 401 on its first request and the watcher swallowed it.
    "upload": (
        ("GET", "/api/state"),
        ("GET", "/api/health"),
        ("POST", "/api/renders"),
        ("POST", "/api/renders/ingest"),
        ("GET", "/api/songs"),
        ("GET", "/api/songs/match"),
        ("GET", "/api/versions/have"),
        ("GET", "/api/sync/folders"),
        # The two that actually put something in the library, missing until a token was
        # made and asked to use them. Everything above is a read, so a token passed every
        # check until the moment it had something to say, and then said "Sign in to use
        # this library" about a library it was holding a credential for.
        #
        # They are the upload. A scope that can survey a library and not add to it is not
        # the scope this one is named after, and neither of them can delete anything,
        # which is the line this scope exists to draw.
        ("POST", "/api/songs"),
        ("POST", "/api/songs/<id>/versions"),
    ),
    "full": None,          # None means no restriction
}

AUTH_PATH = os.path.join(config.DATA, "auth.json")
SETUP_PATH = os.path.join(config.DATA, "setup-code.txt")
COOKIE = "jriter_session"
#: What the cookie was called before the rename. Read, never written.
#
# A rename that signs everybody out on the morning they pull it is a rename that looks
# like a bug. The value format is untouched: it is an HMAC over issued.nonce with the
# server secret and no name in it, so a cookie issued under the old name verifies
# perfectly well under the new one.
LEGACY_COOKIE = "jong_session"
SESSION_DAYS = 30

# scrypt at these settings takes roughly a tenth of a second, which is nothing once a day
# and a wall to anyone working through a list.
SCRYPT = {"n": 2 ** 14, "r": 8, "p": 1, "dklen": 32}

# Guessing limits. Six wrong answers and that address waits, for longer each time.
FREE_TRIES = 6
LOCKOUTS = (30, 120, 600, 1800, 3600)
WINDOW = 900

_lock = threading.Lock()
_attempts = {}          # ip -> {"fails": int, "since": float, "until": float, "level": int}


# ── the stored secret ────────────────────────────────────────────────────────
def _paths():
    """Read from config at call time, so tests pointing DATA elsewhere are honoured."""
    return (os.path.join(config.DATA, "auth.json"),
            os.path.join(config.DATA, "setup-code.txt"))


#: Why the stored secret cannot be used, or None when it is fine.
#:
#: "There is no password yet" and "the password is unreadable" used to be the same
#: answer, an empty dict, and they are opposite situations. A missing file means a fresh
#: library that should offer to set one up. A damaged file means a library that already
#: had an owner, and treating it as fresh discards their password and their session
#: secret the moment anything writes, which on a machine nobody is sitting at is the end
#: of that library's credentials.
_damaged = None


def damaged():
    """The reason the auth file cannot be used, or None. Re-read each time, so repairing
    the file on disk is enough to bring the library back without a restart."""
    _read()
    return _damaged


def _read():
    global _damaged
    path, _ = _paths()
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
    except FileNotFoundError:
        _damaged = None
        return {}                       # never set up, which is a normal state
    except ValueError as e:
        _damaged = "auth.json is not readable JSON (%s)" % e
        return {}
    except OSError as e:
        _damaged = "auth.json could not be opened (%s)" % e
        return {}
    if not isinstance(data, dict):
        _damaged = "auth.json does not hold an object"
        return {}
    # A file with a hash but no salt cannot check a password and cannot be repaired by
    # guessing, so it is damaged rather than empty.
    if data.get("hash") and not data.get("salt"):
        _damaged = "auth.json has a password hash with no salt"
        return {}
    _damaged = None
    return data


def _write(data):
    # Never over a file that could not be read. Whatever is in there is the only copy of
    # a password and a session secret, and it may be recoverable by hand.
    if damaged():
        raise Error("the stored password is damaged and will not be overwritten: %s"
                    % _damaged, 503)
    path, _ = _paths()
    config.ensure_dirs()
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
    os.replace(tmp, path)
    try:
        # Best effort on Windows: keep it readable only by this account.
        os.chmod(path, 0o600)
    except OSError:
        pass


# ── "the library's password" ─────────────────────────────────────────────────
#
# These three used to be the whole of it: one password in one file. There are accounts now,
# so the phrase means the owner's password, and that is where these read and write. They are
# kept rather than removed because "is this library protected at all" is still a real
# question, asked by the door and by the health check, and because a library that has not yet
# been moved into accounts still answers out of auth.json.

def has_password():
    if accounts.count():
        return True
    return bool(_read().get("hash"))


def _hash(password, salt):
    return base64.b64encode(hashlib.scrypt(
        password.encode("utf-8"), salt=salt, **SCRYPT)).decode()


def set_password(password):
    """Set the owner's password. Any password at all, so long as there is one."""
    if not isinstance(password, str) or not password:
        raise Error("Type a password. Anything you like, but not nothing.")
    here = accounts.owner()
    if here:
        accounts.set_password(here["id"], password)
        _spend_setup_code()
        return True

    # No accounts yet, which is a library on its way up and not yet moved across. Written
    # where adopt_single_library will look for it.
    salt = secrets.token_bytes(16)
    data = _read()
    data.update({
        "salt": base64.b64encode(salt).decode(),
        "hash": _hash(password, salt),
        "secret": data.get("secret") or base64.b64encode(secrets.token_bytes(32)).decode(),
        "set_at": time.time(),
    })
    _write(data)
    _spend_setup_code()
    return True


def _spend_setup_code():
    """The code stops existing the moment there is somebody to sign in as."""
    _, setup_path = _paths()
    try:
        os.remove(setup_path)
    except OSError:
        pass


def check_password(password):
    """Is this the owner's password."""
    here = accounts.owner()
    if here:
        return accounts.check(here, password)
    data = _read()
    if not data.get("hash"):
        return False
    salt = base64.b64decode(data["salt"])
    return hmac.compare_digest(_hash(password or "", salt), data["hash"])


# ── the one time setup code ──────────────────────────────────────────────────
def setup_code():
    """A code that has to be presented to set the first password.

    Without it, the first stranger to find a freshly deployed JR!TER could choose the
    password and lock the owner out. It is written next to the library and printed at
    startup, so it is available to whoever can already reach the machine, and it stops
    existing as soon as a password is set.
    """
    _, path = _paths()
    if accounts.count() or has_password():
        return None
    try:
        with open(path, "r", encoding="utf-8") as f:
            code = f.read().strip()
            if code:
                return code
    except OSError:
        pass
    code = "-".join(secrets.token_hex(2) for _ in range(3))
    config.ensure_dirs()
    with open(path, "w", encoding="utf-8") as f:
        f.write(code)
    return code


# ── sessions ─────────────────────────────────────────────────────────────────
def _secret():
    data = _read()
    if not data.get("secret"):
        data["secret"] = base64.b64encode(secrets.token_bytes(32)).decode()
        _write(data)
    return base64.b64decode(data["secret"])


def _sign(body, account_id):
    """Two secrets, so there are two levers.

    The server's ends every session on this machine. The account's ends one person's, which
    is what changing a password should do: before accounts, rotating the only secret there
    was signed out everybody, and with one user nobody could tell the difference.
    """
    key = _secret() + (accounts.secret_of(account_id) or "").encode()
    return hmac.new(key, body.encode(), hashlib.sha256).hexdigest()[:32]


def issue(account_id):
    """A signed cookie value: when it was made, whose it is, and proof we made it."""
    issued = str(int(time.time()))
    nonce = secrets.token_hex(8)
    body = "%s.%d.%s" % (issued, account_id, nonce)
    return "%s.%s" % (body, _sign(body, account_id))


def whose(token):
    """The account this cookie belongs to, or None.

    Two shapes are accepted. Four parts is the current one. Three is what was issued before
    there were accounts, and it means the owner: a rename that signs everybody out on the
    morning they pull it is a rename that looks like a bug, and the owner's library is
    exactly the library that cookie was for.
    """
    if not token:
        return None
    bits = token.split(".")
    if len(bits) == 4:
        issued, said, nonce, signature = bits
        try:
            account_id = int(said)
        except ValueError:
            return None
        body = "%s.%s.%s" % (issued, said, nonce)
    elif len(bits) == 3:
        issued, nonce, signature = bits
        account_id = accounts.OWNER
        # The old body, signed with the old key: the server secret alone. Verified on its
        # own terms rather than pretending it was signed the new way.
        body = "%s.%s" % (issued, nonce)
        expected = hmac.new(_secret(), body.encode(), hashlib.sha256).hexdigest()[:32]
        if not hmac.compare_digest(signature, expected):
            return None
        return account_id if _fresh(issued) and accounts.by_id(account_id) else None
    else:
        return None

    if not hmac.compare_digest(signature, _sign(body, account_id)):
        return None
    if not _fresh(issued):
        return None
    # A cookie for an account that has been deleted is not a session.
    return account_id if accounts.by_id(account_id) else None


def _fresh(issued):
    try:
        age = time.time() - int(issued)
    except ValueError:
        return False
    return 0 <= age <= SESSION_DAYS * 86400


def valid(token):
    """Kept for the shape of the old question. Prefer whose()."""
    return whose(token) is not None


#: Tokens are stored the way passwords are: only a digest, so the file being read does
#: not hand anybody the credential.
def _token_digest(raw):
    # The prefix still says jong, and it has to. It is mixed into the stored digest of
    # every token ever minted, so changing it invalidates all of them at once, and the
    # agent that stops being allowed in never says so: the watch loop swallows the 401
    # and goes on pushing nothing, for ever. This string is not a name anybody reads,
    # it is salt, and it does its one job just as well saying the old name.
    return hashlib.sha256(("jong-token:" + raw).encode("utf-8")).hexdigest()


def make_token(name, scope="upload", account_id=None):
    """Mint one for an account. The raw value is returned once and never stored."""
    if scope not in SCOPES:
        raise Error("scope must be one of: " + ", ".join(sorted(SCOPES)))
    raw = "jt_" + secrets.token_urlsafe(30)
    accounts.add_token(account_id if account_id is not None else who.must(),
                       (name or "a machine")[:80], _token_digest(raw), scope)
    return raw


def _shape(path):
    """A request path as its route shape: /api/songs/12/versions -> /api/songs/<id>/versions

    The scope list is literal paths, and a literal never equals a path with an id in it,
    so every route that takes one was unreachable by a token whatever the list said. This
    is the smallest thing that fixes that: a segment of digits is an id.

    Deliberately not a route table lookup. The router knows the real patterns, but this
    check runs before anything is routed, on purpose, so that a token is judged on what it
    asked for rather than on what the server was willing to do with it.
    """
    return "/".join("<id>" if part.isdigit() else part for part in path.split("/"))


def token_account(headers, method, path):
    """Which account's library the X-Jriter-Token on this request may reach, or None.

    Checked instead of a session, not as well as one, so a token can never be used to reach
    something the person who made it did not intend. An unknown token is simply not signed
    in, with no way to tell it from a wrong one.

    Returns the account rather than a yes, because being allowed in and knowing whose
    library to open are the same question once there is more than one library.
    """
    # The old header is still accepted. An agent updates itself from a daily task, so
    # an agent that has not run that task yet is the normal state of things for a day
    # and longer if the laptop was off, and a client shut out this way says nothing:
    # the watch loop swallows the 401 and goes on pushing nothing.
    raw = (headers.get("X-Jriter-Token")
           or headers.get("X-Jong-Token") or "").strip()
    if not raw:
        return None
    row = accounts.token_for(_token_digest(raw))
    if not row:
        return None
    allowed = SCOPES.get(row["scope"], ())
    if allowed is not None and (method, path) not in allowed \
            and (method, _shape(path)) not in allowed:
        return None
    # Useful for telling a live agent from one that stopped months ago.
    accounts.token_used(row["id"])
    return row["account_id"]


def token_allows(headers, method, path):
    """The old shape of the question, kept for anything that only wants a yes."""
    return token_account(headers, method, path) is not None


def account_for(headers):
    """Which account this request's cookie belongs to, or None."""
    raw = headers.get("Cookie") or ""
    for part in raw.split(";"):
        name, _, value = part.strip().partition("=")
        if name in (COOKIE, LEGACY_COOKIE):
            found = whose(value)
            if found:
                return found
    return None


def signed_in(headers):
    return account_for(headers) is not None


def sign_out_everywhere():
    """Rotate the server secret: every cookie on this machine, for everybody.

    The blunt one, and it stays for the case it is actually for, which is a server that may
    have been reached. Changing one password uses accounts.sign_out_everywhere instead.
    """
    data = _read()
    data["secret"] = base64.b64encode(secrets.token_bytes(32)).decode()
    _write(data)


# ── guessing limits ──────────────────────────────────────────────────────────
def _who(req):
    # Behind Tailscale Funnel the real caller is in a forwarded header. Falling back to
    # the socket address keeps this working when it is reached directly.
    forwarded = req.headers.get("X-Forwarded-For") or ""
    if forwarded:
        return forwarded.split(",")[0].strip()
    return req.headers.get("X-Real-IP") or getattr(req, "client", "") or "local"


def _wait_for(ip):
    with _lock:
        entry = _attempts.get(ip)
        if not entry:
            return 0
        if entry["until"] > time.time():
            return int(entry["until"] - time.time())
        return 0


def _forget_stale(now):
    """Drop the addresses that have nothing left to say.

    Called under the lock from the one place that adds an entry. Every distinct address
    that ever guessed wrong used to stay in this dict for the life of the process, which
    on an address that is on the internet is both a slow leak and a list of who knocked,
    kept for no reason: an entry outside its window is the same as no entry at all, since
    _note_failure starts a fresh one, and an entry whose lockout has passed and whose
    window has closed cannot change any answer this module gives.
    """
    for ip in [ip for ip, e in _attempts.items()
               if e["until"] < now and now - e["since"] > WINDOW]:
        _attempts.pop(ip, None)


def _note_failure(ip):
    with _lock:
        now = time.time()
        _forget_stale(now)
        entry = _attempts.get(ip)
        if not entry or now - entry["since"] > WINDOW:
            entry = {"fails": 0, "since": now, "until": 0, "level": 0}
        entry["fails"] += 1
        entry["since"] = now
        if entry["fails"] > FREE_TRIES:
            wait = LOCKOUTS[min(entry["level"], len(LOCKOUTS) - 1)]
            entry["until"] = now + wait
            entry["level"] += 1
            entry["fails"] = 0
        _attempts[ip] = entry


def _clear(ip):
    with _lock:
        _attempts.pop(ip, None)


def _cookie_header(req, value, days):
    secure = ""
    proto = (req.headers.get("X-Forwarded-Proto") or "").lower()
    if proto == "https":
        secure = " Secure;"
    age = days * 86400
    return ("%s=%s; Path=/; HttpOnly; SameSite=Lax;%s Max-Age=%d"
            % (COOKIE, value, secure, age))


# ── endpoints ────────────────────────────────────────────────────────────────
def state(req):
    here = account_for(req.headers)
    answer = {
        # "Is this library set up at all", which before accounts was the same question as
        # "is there a password". The login page draws the setup form off this.
        "has_password": accounts.count() > 0 or has_password(),
        "signed_in": here is not None,
        "who": accounts.public(accounts.by_id(here)) if here else None,
        # Whether the sign up form is worth drawing. Never says whether any particular code
        # is good: that answer belongs behind a rate limit.
        "can_sign_up": accounts.count() > 0,
        "locked_for": _wait_for(_who(req)),
        "custom_font": False,
    }
    # The door wears the same face as the library, and this is the only call it is
    # allowed to make before signing in. Asking the font endpoint directly meant a 404
    # in the console every time nobody had uploaded one.
    from .. import registry
    if registry.has("appearance"):
        from . import appearance
        # As the owner, explicitly. This is asked by the login page, where nobody is
        # signed in and there is therefore no library bound; without saying whose, it
        # raises. The owner's is the right answer: the door belongs to the library rather
        # than to whichever of several people is about to come through it.
        with who.acting_as(accounts.OWNER):
            answer["custom_font"] = appearance.state().get("custom_font", False)
    return answer


def setup(req):
    """Make the first account. Needs the setup code, and only works once."""
    if accounts.count():
        raise Error("This library already has an owner.", 409)
    data = req.json()
    code = setup_code()
    given = (data.get("code") or "").strip()
    if not given or not hmac.compare_digest(given, code or ""):
        _note_failure(_who(req))
        raise Error("That setup code is not right.", 403)

    # The owner's handle is fixed rather than asked for. Signing in with an empty handle
    # means the owner, so somebody who has only ever typed a password carries on doing
    # exactly that, and they can put a name on it later.
    made = accounts.create("owner", data.get("password") or "",
                           name=(data.get("name") or "").strip(),
                           account_id=accounts.OWNER)
    _spend_setup_code()
    _clear(_who(req))
    return Response(status=200, body=b'{"ok":true}', content_type="application/json",
                    headers={"Set-Cookie": _cookie_header(req, issue(made["id"]),
                                                          SESSION_DAYS)})


def sign_up(req):
    """Make an account, with an invite.

    The invite is checked under the same rate limit as a password, because without that
    this endpoint is an oracle for guessing codes.
    """
    ip = _who(req)
    wait = _wait_for(ip)
    if wait:
        raise Error("Too many attempts. Try again in %d seconds." % wait, 429)
    if not accounts.count():
        raise Error("This library has no owner yet.", 409)

    data = req.json()
    invite = accounts.invite_for((data.get("code") or "").strip())
    if not invite:
        _note_failure(ip)
        raise Error("That invite is not one this library gave out, or it has been used "
                    "already.", 403)

    made = accounts.create(data.get("handle"), data.get("password") or "",
                           name=(data.get("name") or "").strip())
    accounts.spend_invite(invite["id"], made["id"])
    _clear(ip)
    return Response(status=200, body=b'{"ok":true}', content_type="application/json",
                    headers={"Set-Cookie": _cookie_header(req, issue(made["id"]),
                                                          SESSION_DAYS)})


def login(req):
    ip = _who(req)
    wait = _wait_for(ip)
    if wait:
        raise Error("Too many attempts. Try again in %d seconds." % wait, 429)
    if not accounts.count():
        raise Error("No account has been made on this library yet.", 409)

    data = req.json()
    handle = (data.get("handle") or "").strip()
    # An empty handle means the owner. Before there were accounts the sign in page asked
    # for a password and nothing else, and for the person whose library this is that should
    # not have changed.
    account = accounts.by_handle(handle) if handle else accounts.owner()

    if not accounts.check(account, data.get("password") or ""):
        _note_failure(ip)
        again = _wait_for(ip)
        # One message for a wrong handle and a wrong password, on purpose: telling them
        # apart is telling a stranger which handles exist on this server.
        raise Error("That is not right."
                    + (" Too many attempts, wait %d seconds." % again if again else ""), 401)

    _clear(ip)
    accounts.seen(account["id"])
    return Response(status=200, body=b'{"ok":true}', content_type="application/json",
                    headers={"Set-Cookie": _cookie_header(req, issue(account["id"]),
                                                          SESSION_DAYS)})


def logout(req):
    return Response(status=200, body=b'{"ok":true}', content_type="application/json",
                    headers={"Set-Cookie": "%s=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0"
                                           % COOKIE})


def change(req):
    here = account_for(req.headers)
    if not here:
        raise Error("Sign in first.", 401)
    account = accounts.by_id(here)
    data = req.json()
    if not accounts.check(account, data.get("current") or ""):
        _note_failure(_who(req))
        raise Error("That is not the current password.", 401)
    accounts.set_password(here, data.get("new") or "")
    # Theirs alone. This used to rotate the server secret, which signed out every person
    # on the machine because one of them changed their password.
    accounts.sign_out_everywhere(here)
    return Response(status=200, body=b'{"ok":true,"signed_out":true}',
                    content_type="application/json",
                    headers={"Set-Cookie": _cookie_header(req, issue(here), SESSION_DAYS)})


# ── invites ──────────────────────────────────────────────────────────────────
def list_invites(req):
    here = account_for(req.headers)
    if here != accounts.OWNER:
        raise Error("Only the owner of this library hands out invites.", 403)
    return {"invites": accounts.invites_by(here),
            "accounts": [accounts.public(a) for a in accounts.everybody()]}


def create_invite(req):
    here = account_for(req.headers)
    if here != accounts.OWNER:
        raise Error("Only the owner of this library hands out invites.", 403)
    data = req.json()
    raw = accounts.make_invite(here, note=data.get("note") or "",
                               days=as_days(data.get("days")))
    return {"code": raw,
            "note": "This is the only time it is shown. Send it to whoever it is for."}


def as_days(value):
    try:
        days = int(value)
    except (TypeError, ValueError):
        return 14
    return max(0, min(365, days))


def revoke_invite(req):
    here = account_for(req.headers)
    if here != accounts.OWNER:
        raise Error("Only the owner of this library hands out invites.", 403)
    accounts.drop_invite(req.params["id"], here)
    return {"revoked": req.params["id"]}


def me(req):
    """Who this request is, for the rail and for anything that needs to name the editor."""
    here = account_for(req.headers)
    if not here:
        raise Error("Sign in first.", 401)
    return {"who": accounts.public(accounts.by_id(here))}


def people(req):
    """Everybody with an account on this server.

    Open to anybody signed in, not just the owner, and that is a deliberate difference from
    the invite list next door. Sharing a song means naming a person, so you have to be able
    to see who is here; and on a server where everybody was invited by the same person,
    which is every one of them, that is not news to anybody.

    accounts.public and nothing else: a handle, a display name, when they joined. Never a
    hash, a salt or a secret, and nothing at all about what is in anybody's library.
    """
    here = account_for(req.headers)
    if not here:
        raise Error("Sign in first.", 401)
    return {"people": [accounts.public(a) for a in accounts.everybody()],
            "me": here,
            "owner": accounts.OWNER}


def rename_me(req):
    here = account_for(req.headers)
    if not here:
        raise Error("Sign in first.", 401)
    return {"who": accounts.public(accounts.rename(here, need(req.json(), "name")))}


def SUMMARY():
    here = who.now()
    return {"protected": accounts.count() > 0 or has_password(),
            "accounts": accounts.count(),
            "is_owner": here == accounts.OWNER,
            "who": accounts.public(accounts.by_id(here)) if here else None}


def list_tokens(req):
    """What machines can reach this library, and when each last did."""
    return {"tokens": accounts.tokens_of(who.must())}


def create_token(req):
    """Mint one for a machine. The value comes back once and is never stored."""
    data = req.json()
    raw = make_token(data.get("name"), (data.get("scope") or "upload").strip(),
                     account_id=who.must())
    return {"token": raw, "note": "This is the only time it is shown."}


def revoke_token(req):
    # Scoped to this account, so an id guessed off another library revokes nothing.
    accounts.drop_token(req.params["id"], who.must())
    return {"revoked": req.params["id"]}


def ROUTES():
    return {
        ("GET", "/api/auth/state"): state,
        ("POST", "/api/auth/setup"): setup,
        ("POST", "/api/auth/signup"): sign_up,
        ("GET", "/api/auth/me"): me,
        ("GET", "/api/auth/people"): people,
        ("PATCH", "/api/auth/me"): rename_me,
        ("GET", "/api/auth/invites"): list_invites,
        ("POST", "/api/auth/invites"): create_invite,
        ("DELETE", "/api/auth/invites/<id>"): revoke_invite,
        ("POST", "/api/auth/login"): login,
        ("GET", "/api/auth/tokens"): list_tokens,
        ("POST", "/api/auth/tokens"): create_token,
        ("DELETE", "/api/auth/tokens/<id>"): revoke_token,
        ("POST", "/api/auth/logout"): logout,
        ("POST", "/api/auth/password"): change,
    }
