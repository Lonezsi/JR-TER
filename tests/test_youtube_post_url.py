"""A YouTube post's link is saved only if it is https:// (CONDOM 9): Watch opens it."""


def _song(server):
    status, made = server.post("/api/songs", {"title": "A song"})
    assert status == 200, made
    return made["song"]["id"]


def test_only_https_links_are_saved(server):
    sid = _song(server)
    for bad in ("javascript:alert(1)", "http://youtu.be/abc", "https://", "data:text/html,x"):
        status, said = server.post("/api/songs/%d/youtube" % sid, {"url": bad})
        assert status == 400, (bad, said)
    status, said = server.post("/api/songs/%d/youtube" % sid, {"url": " https://youtu.be/abc123 "})
    assert status == 200, said
    assert said["post"]["url"] == "https://youtu.be/abc123"
    status, said = server.post("/api/songs/%d/youtube" % sid, {"status": "draft"})
    assert status == 200, said


def test_a_patch_cannot_swap_in_a_bad_link(server):
    sid = _song(server)
    status, said = server.post("/api/songs/%d/youtube" % sid, {"url": "https://youtu.be/abc123"})
    pid = said["post"]["id"]
    status, said = server.patch("/api/youtube/%d" % pid, {"url": "javascript:alert(1)"})
    assert status == 400, said
    status, got = server.get("/api/songs/%d/youtube" % sid)
    assert got["posts"][0]["url"] == "https://youtu.be/abc123"
    status, said = server.patch("/api/youtube/%d" % pid, {"url": "https://youtu.be/zzz999"})
    assert status == 200, said
