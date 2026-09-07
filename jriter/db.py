"""SQLite, with one connection per thread per account, and dictionary rows.

Each module owns its own tables and hands its CREATE statements to the registry, so the
schema is assembled from whatever is switched on rather than written out in one place
that has to be kept in step with the module list.

Every function here works on *the library of the account this thread is serving*. Which
account that is comes from who.py, and there is no default: an unbound thread raises rather
than opening somebody's library on a guess. See the note at the top of config.py for why
accounts are separate files instead of a column.

The cache being keyed by account is the load bearing detail. This server hands a thread
back to the pool when a request finishes, so the next request on that thread is very
probably a different person. A single _local.conn would hand them the previous person's
library, and nothing in any query would notice.
"""
import os
import sqlite3
import threading

from . import config, who

_local = threading.local()

#: Which database files have had their schema applied in this process.
#:
#: Per file rather than per connection: the schema is a property of what is on disk, and
#: eight threads opening the same account should not run nineteen CREATE TABLE statements
#: eight times over. Guarded, because two requests for a brand new account can arrive at
#: the same moment.
_prepared = set()
_prepare_lock = threading.Lock()


def _fold(value):
    """Lower case in a way that is not only about English.

    SQLite's LIKE folds case for ASCII and stops there, so "Osz" and "osz" match and the
    same pair with an accent does not. On a Hungarian library that is not an edge case,
    it is most of the titles. Python knows the whole table, so the folding is done here
    and the comparing stays in SQL.

    No deterministic=True: that is only needed for indexed expressions, none of this uses
    one, and passing it raises on older SQLite for no gain.
    """
    return value.casefold() if isinstance(value, str) else value


def _open(path):
    """A connection to one database file, with this project's pragmas on it."""
    conn = sqlite3.connect(path, timeout=30)
    conn.row_factory = sqlite3.Row
    # WAL lets a long upload read while the UI writes, which is the whole reason a
    # personal tool with one user still needs it: the browser polls while you drag a file in.
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    conn.execute("PRAGMA synchronous=NORMAL")
    # Registered on every connection, because it is used from whichever modules happen to
    # be switched on and there is no other moment that is true of.
    conn.create_function("fold", 1, _fold)
    return conn


def connect():
    """This thread's connection to the library of the account it is serving.

    Keyed by account, and that is not a nicety. A ThreadingHTTPServer thread serves one
    request and then another, and the second one belongs to somebody else as often as not.
    """
    account = who.must()
    cache = getattr(_local, "conns", None)
    if cache is None:
        cache = _local.conns = {}
    conn = cache.get(account)
    if conn is not None:
        return conn

    config.ensure_home(account)
    path = config.db_path(account)
    conn = _open(path)
    # Into the cache before the schema runs, because applying the schema calls back into
    # connect() through apply_schema, and a second open there would be a second connection
    # to a database the first one is in the middle of creating.
    cache[account] = conn

    with _prepare_lock:
        first = path not in _prepared
        if first:
            _prepared.add(path)
    if first:
        try:
            from . import registry
            registry.prepare()
        except Exception:
            # A schema that did not go in must not be remembered as done, or every later
            # request against this library quietly runs on missing tables.
            with _prepare_lock:
                _prepared.discard(path)
            cache.pop(account, None)
            conn.close()
            raise
    return conn


def checkpoint():
    """Fold the write-ahead log back into the database.

    With synchronous=NORMAL a commit is not fsynced; durability arrives when the WAL is
    checkpointed, and nothing was ever checkpointing. Meanwhile the host's routine
    recovery is Stop-Process -Force whenever two health probes miss, so the ordinary way
    this server dies is a hard kill against a file that has never been flushed.

    Called on a timer and once on the way out, which keeps writes fast and bounds what a
    kill can cost to whatever happened since the last tick.

    Every library on disk, through a connection opened here, and both halves of that matter.

    Every library, because there are several now and the one nobody has touched this minute
    is exactly the one whose work is sitting unflushed.

    Opened here, because this is called from the checkpoint thread, and a connection belongs
    to the thread that made it: sqlite3 refuses to let another one use it. The old version
    walked this thread's own connections, and the checkpoint thread has none and never will,
    because it does not serve requests. So for as long as that timer has existed it has
    woken every thirty seconds, found nothing, and gone back to sleep. Nothing failed and
    nothing was logged; the log simply grew until something else happened to flush it.

    A checkpoint is a property of the file rather than of a connection, so a fresh one is
    just as good, and PASSIVE never blocks whoever else is holding it open.
    """
    done = False
    for path in libraries():
        try:
            conn = _open(path)
        except sqlite3.Error:
            continue
        try:
            conn.execute("PRAGMA wal_checkpoint(PASSIVE)")
            done = True
        except sqlite3.Error:
            # PASSIVE never blocks a reader, so a failure here means busy, not broken.
            pass
        finally:
            conn.close()
    return done


def libraries():
    """Every account library file on disk.

    Read off the directory rather than out of the accounts table, because this is called
    from a timer that must not care whether the accounts database is readable, and because
    a library whose account row has gone still holds bytes worth flushing.
    """
    root = os.path.join(config.DATA, "accounts")
    found = []
    try:
        names = os.listdir(root)
    except OSError:
        return found
    for name in sorted(names):
        path = os.path.join(root, name, "jriter.db")
        if os.path.isfile(path):
            found.append(path)
    return found


def close():
    """Let go of this thread's connections, emptying each log on the way.

    This thread's, because a connection may only be closed by the thread that opened it.
    The one call that has to reach every library is the one at shutdown, and shut_down
    below is that one.
    """
    for conn in list(getattr(_local, "conns", {}).values()):
        try:
            conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
        except sqlite3.Error:
            pass
        conn.close()
    _local.conns = {}


def shut_down():
    """On the way out: every library emptied, not merely folded back in.

    TRUNCATE rather than PASSIVE, because this is the one moment nothing else is running
    and a log left on disk is work that has to be recovered on the next start.
    """
    close()
    for path in libraries():
        try:
            conn = _open(path)
        except sqlite3.Error:
            continue
        try:
            conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
        except sqlite3.Error:
            pass
        finally:
            conn.close()


def query(sql, args=()):
    return [dict(r) for r in connect().execute(sql, args).fetchall()]


def table_exists(name):
    """Is a table there.

    Every feature is a module that may be switched off, and a module that is off never
    creates its tables. So anything reaching across to another module's data has to ask
    rather than assume: a playlist can hold renders, and a library with the renders
    module turned off simply has none to hold.
    """
    row = one("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?", (name,))
    return bool(row)


def one(sql, args=()):
    rows = query(sql, args)
    return rows[0] if rows else None


def run(sql, args=()):
    conn = connect()
    cur = conn.execute(sql, args)
    conn.commit()
    return cur


def insert(table, values):
    """Insert a row and return its id. Column names come from our own code, never input."""
    cols = list(values)
    sql = "INSERT INTO %s (%s) VALUES (%s)" % (
        table, ", ".join(cols), ", ".join("?" for _ in cols))
    return run(sql, tuple(values[c] for c in cols)).lastrowid


def update(table, row_id, values):
    if not values:
        return
    cols = list(values)
    sql = "UPDATE %s SET %s WHERE id = ?" % (table, ", ".join(c + " = ?" for c in cols))
    run(sql, tuple(values[c] for c in cols) + (row_id,))


def apply_schema(statements):
    conn = connect()
    for sql in statements:
        conn.execute(sql)
    conn.commit()


def columns(table):
    return [r["name"] for r in query("PRAGMA table_info(%s)" % table)]


def add_column_if_missing(table, name, decl):
    """The only migration this project needs so far. Rebuilding a table would mean
    moving blobs around, and nothing here has needed that yet."""
    if name not in columns(table):
        run("ALTER TABLE %s ADD COLUMN %s %s" % (table, name, decl))


def reset_for_tests():
    close()
    _prepared.clear()
    path = config.db_path()
    if os.path.exists(path):
        os.remove(path)
