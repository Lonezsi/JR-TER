"""Watched folders belong to the machine's owner, and to nobody else on it.

THE HOLE THIS CLOSES. A watched folder is a path on the host, read and written with the
server's own permissions, which on the host are the whole machine's. Nothing limited the
sync module to the owner, so once friends could have accounts, any of them could add the
whole C: drive as a render collector, scan it, import the audio it found, take stock of any folder, and upload
files into any directory the server can write to: another account's library, or the
server's own code.

These are written the way somebody trying it would write them: a friend's real session over
HTTP, asking for the folder that holds the owner's library, and checking every answer is no
and that nothing happened on disk.
"""
import os
import struct

from jriter import accounts, config

from test_two_people_over_http import library, _owner_and_friend   # noqa: F401 (fixture)


def _wav(path):
    body = b"\x01\x00" * 80
    path.write_bytes(b"RIFF" + struct.pack("<I", 36 + len(body)) + b"WAVEfmt "
                     + struct.pack("<IHHIIHH", 16, 1, 1, 8000, 16000, 2, 16)
                     + b"data" + struct.pack("<I", len(body)) + body)
    return path


def test_a_friend_cannot_watch_a_folder_on_the_host(library, tmp_path):
    owner, friend = _owner_and_friend(library)
    # The owner's own library directory: the most valuable thing a friend could point at.
    target = config.home(accounts.OWNER)
    status, said = friend.call("POST", "/api/sync/folders", {"path": target, "kind": "collector"})
    assert status == 403, (status, said)
    assert "owner" in str(said).lower(), "the refusal does not say why: %s" % said


def test_a_friend_can_do_nothing_else_with_folders_either(library, tmp_path):
    """Every route, not only the one that adds a folder. A folder the owner added is a
    folder id a friend could name, so each of these is asked with a real id."""
    owner, friend = _owner_and_friend(library)
    folder = tmp_path / "owners samples"
    folder.mkdir()
    _wav(folder / "kick.wav")
    status, made = owner.call("POST", "/api/sync/folders", {"path": str(folder), "kind": "sync"})
    assert status == 200, made
    folder_id = (made.get("folder") or made)["id"]

    asks = [
        ("GET", "/api/sync/folders", None),
        ("PATCH", "/api/sync/folders/%d" % folder_id, {"enabled": False}),
        ("DELETE", "/api/sync/folders/%d" % folder_id, None),
        ("POST", "/api/sync/scan", {}),
        ("POST", "/api/sync/stock", {}),
        ("POST", "/api/sync/import", {"path": str(folder / "kick.wav"), "new_title": "Stolen"}),
    ]
    for method, path, body in asks:
        status, said = friend.call(method, path, body)
        assert status == 403, "%s %s answered %s to a friend: %s" % (method, path, status, said)

    # Nothing the friend asked for happened.
    status, still = owner.call("GET", "/api/sync/folders")
    assert status == 200 and [f["id"] for f in still["folders"]] == [folder_id]
    assert still["folders"][0]["enabled"], "a friend switched the owner's folder off"


def test_a_friend_cannot_write_a_file_into_a_folder_on_the_host(library, tmp_path):
    """The upload route, which is the one that puts bytes on the disk."""
    owner, friend = _owner_and_friend(library)
    folder = tmp_path / "owners samples"
    folder.mkdir()
    status, made = owner.call("POST", "/api/sync/folders", {"path": str(folder), "kind": "sync"})
    folder_id = (made.get("folder") or made)["id"]

    body = _wav(tmp_path / "payload.wav").read_bytes()
    # Raw bytes with the name in a header, as the page sends them. The test client only
    # speaks JSON, so this one goes through urllib with the friend's cookie.
    import urllib.request
    import urllib.error
    request = urllib.request.Request(
        library.base + "/api/sync/folders/%d/upload" % folder_id, data=body, method="POST",
        headers={"Cookie": friend.cookie, "Content-Type": "application/octet-stream",
                 "X-Filename": "planted.wav"})
    try:
        with urllib.request.urlopen(request, timeout=20) as answer:
            code = answer.status
    except urllib.error.HTTPError as e:
        code = e.code
    assert code == 403, "a friend's upload into a host folder answered %s" % code
    assert not os.path.exists(str(folder / "planted.wav")), "the file was written anyway"


def test_the_owner_still_has_all_of_it(library, tmp_path):
    """The guard must not take the feature away from the one person it is for."""
    owner, friend = _owner_and_friend(library)
    folder = tmp_path / "renders"
    folder.mkdir()
    status, made = owner.call("POST", "/api/sync/folders", {"path": str(folder), "kind": "collector"})
    assert status == 200, made
    status, listed = owner.call("GET", "/api/sync/folders")
    assert status == 200 and len(listed["folders"]) == 1
    status, scanned = owner.call("POST", "/api/sync/scan", {})
    assert status == 200, scanned


def test_a_friend_is_told_nothing_about_folders_in_the_summary(library):
    """The summary is read by every account on every load. A friend gets nothing rather
    than an error, and nothing rather than a count of the owner's folders."""
    owner, friend = _owner_and_friend(library)
    status, state = friend.call("GET", "/api/state")
    assert status == 200, state
    assert not (state.get("summary") or {}).get("sync"), (
        "a friend's state carries the host's folder summary: %s" % state["summary"].get("sync"))


def test_the_page_agrees_with_the_server_about_who_owns_the_machine():
    """A friend is not shown a Folders screen whose every press is refused.

    The rail leaves the item out, and the screen, reached by its address, explains instead
    of drawing controls. Both ask one question, J.ownsTheMachine, so they cannot disagree
    with each other; and with the door switched off there is one person, who owns it all.
    """
    import io
    here = os.path.dirname(os.path.abspath(__file__))
    web = os.path.join(os.path.dirname(here), "web", "js")
    boot = io.open(os.path.join(web, "90-boot.js"), encoding="utf-8").read()
    view = io.open(os.path.join(web, "74-view-sync.js"), encoding="utf-8").read()

    rail = boot[boot.index("async function buildRail("):]
    rail = rail[:rail.index("\n}")]
    line = [l for l in rail.splitlines() if '"Folders"' in l or "'Folders'" in l]
    assert line, "the rail has no Folders item at all"
    guarded = rail[max(0, rail.index(line[0]) - 200):rail.index(line[0])]
    assert "J.ownsTheMachine(state)" in guarded, (
        "the rail offers Folders to every account, and the server refuses all but one")

    render = view[view.index("J.views.sync = {"):]
    render = render[:render.index("async function loadFolders")]
    assert "J.ownsTheMachine(J.state)" in render, (
        "the Folders screen draws its controls before asking whose machine it is")

    owns = boot[boot.index("J.ownsTheMachine = (state) => {"):]
    owns = owns[:owns.index("\n};")]
    assert "!auth ||" in owns, (
        "with the door off there is no auth summary, and the only person is the owner")
