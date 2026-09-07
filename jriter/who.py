"""Whose library this request is about.

JR!TER used to have one library and one password, so nothing ever had to ask. It now has
an account per person, and every account gets its own database file and its own blob
directory rather than a column saying who owns each row.

That choice is the whole security model, so it is worth saying why. The alternative is an
account_id on all nineteen tables and a WHERE clause at each of the hundred and ninety two
places this code talks to SQLite. One missed clause there is not a bug that shows up as a
crash or a wrong number on a page: it is one person seeing another person's music, silently,
for as long as nobody notices. Separate files cannot fail that way. A query written with no
thought for accounts at all still cannot reach another account's rows, because those rows
are not in the file it is reading.

What that leaves is one question: which file. This module holds the answer for the thread
currently handling a request, and it refuses to guess. There is deliberately no default: an
unbound thread raises rather than quietly serving the owner, because "the binding did not
happen" and "serve the owner's library" must never be the same outcome.
"""
import threading
import contextlib

_local = threading.local()


class Unbound(RuntimeError):
    """Something asked whose library this is outside of anybody's request.

    Always a bug in JR!TER rather than anything the person at the browser did, so it is
    its own type: a 500 that says which of the two mistakes was made, instead of an
    AttributeError from four frames further down.
    """


def now():
    """The account being served on this thread, or None."""
    return getattr(_local, "account", None)


def must():
    """The account being served, or raise.

    Used by everything that resolves a path or opens a database. The failure is loud on
    purpose: see the note at the top of this file.
    """
    account = now()
    if account is None:
        raise Unbound(
            "no account is bound to this thread, so there is no library to open. "
            "A request should have been bound by the HTTP layer; anything else "
            "(a background job, a test, a script) has to say who.acting_as(id).")
    return account


@contextlib.contextmanager
def acting_as(account):
    """Do this next bit as that account.

    Every crossing between two people's libraries goes through here and is therefore
    greppable, which is the point: sharing is meant to be a handful of deliberate places,
    not something any handler can do by accident.

    Restores the previous account rather than clearing it, so a share read nested inside a
    request hands the request back to its own owner on the way out.
    """
    if account is None:
        raise ValueError("acting_as needs an account id")
    was = getattr(_local, "account", None)
    _local.account = int(account)
    try:
        yield int(account)
    finally:
        _local.account = was


def bind(account):
    """Serve this thread's next stretch of work as that account, until unbind().

    For the HTTP layer, which binds at the top of a request and lets go at the end. Every
    other caller wants acting_as, which cannot be left switched on by an early return.
    """
    _local.account = None if account is None else int(account)


def unbind():
    _local.account = None
