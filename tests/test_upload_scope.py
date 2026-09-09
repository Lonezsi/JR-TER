"""Can a token with the upload scope actually upload.

The list in auth.py says, in its own words, that "upload" is every route the client
actually calls, and carries a note about having once left out two of them. It was still
missing the two that do the work:

    POST /api/songs                 make the song
    POST /api/songs/<id>/versions   push the bytes

Everything on the list was a read, so a token passed every check right up to the moment it
had something to say. That is the third time this list has been out of step with the
client, so it is not checked by hand any more: the routes are read out of the client and
compared with the scope.

A list kept in step with another file by a person is a list that goes out of step with it.
"""
import io
import os
import re
import sys

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, HERE)

from jriter.modules import auth   # noqa: E402

CLIENT = os.path.join(HERE, "client", "jriter_client.py")

#: `server.get("/api/x")`, `server.post("/api/y", ...)`, `server.upload("/api/z", ...)`.
#: The client reaches the library through that one object and nothing else, which is what
#: makes reading the calls out of it possible at all.
CALL = re.compile(r"""server\.(get|post|upload|delete)\(\s*["']([^"']*/api/[^"'?]*)""")

#: How the client builds a path with an id in it, and what the scope calls that shape.
FORMAT = re.compile(r"%[sd]")


def _source():
    return io.open(CLIENT, encoding="utf-8").read()


def _bare(source):
    source = re.sub(r'"""(?:.|\n)*?"""', '""', source)
    source = re.sub(r"^\s*#.*$", "", source, flags=re.M)
    return source


def _routes():
    """Every (method, path) the client asks the library for, in its route shape."""
    verbs = {"get": "GET", "post": "POST", "upload": "POST", "delete": "DELETE"}
    out = set()
    for found in CALL.finditer(_bare(_source())):
        path = FORMAT.sub("<id>", found.group(2))
        out.add((verbs[found.group(1)], path))
    return out


def test_the_client_only_calls_routes_the_upload_scope_allows():
    """The whole list, checked against the file it claims to describe.

    A token that cannot reach one of these is a client that stops working, and the way it
    stops is the reason this matters: the watch loop swallows a 401 and goes on pushing
    nothing, so the failure is silent and lasts until somebody uploads by hand.
    """
    found = _routes()
    assert found, "no /api calls were found in the client at all; the pattern is stale"

    allowed = set(auth.SCOPES["upload"])
    missing = sorted(r for r in found if r not in allowed)

    assert not missing, (
        "the client calls %d route(s) an upload token is refused:\n    %s\n"
        "Add them to SCOPES[\"upload\"] in jriter/modules/auth.py, or the agent gets a 401"
        " and says nothing about it." % (len(missing),
                                         "\n    ".join("%s %s" % r for r in missing)))


def test_a_route_with_an_id_in_it_can_be_matched_at_all():
    """The other half, and the reason the missing route stayed missing.

    The check compares the request path with the scope entries literally, and no literal
    equals /api/songs/12/versions, so every route taking an id was unreachable by a token
    whatever the list said. Adding the entry without this does nothing.
    """
    assert auth._shape("/api/songs/12/versions") == "/api/songs/<id>/versions"
    assert auth._shape("/api/health") == "/api/health"
    # A segment that merely contains digits is not an id.
    assert auth._shape("/api/v2/songs") == "/api/v2/songs"


def test_the_upload_scope_still_cannot_delete_anything():
    """What the scope is for is the line it draws, and widening it must not cross that.

    A credential sitting in a plain file on a laptop should be able to add to the library
    and not to empty it.
    """
    for method, path in auth.SCOPES["upload"]:
        assert method != "DELETE", (
            "the upload scope now allows DELETE %s. A token in a file on a laptop is not"
            " a thing that should be able to remove anything." % path)
