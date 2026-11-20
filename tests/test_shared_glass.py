"""The design is not in this repo, and this is the line that says so.

The glass, the accent, the spacing, the radii and the three engine tiers live in
foyer/shared/glass.css, and both this app and Foyer read that one file off the disk. It was
moved there because a design that exists twice stops being one design, which had already
cost two bugs:

  the desktop app kept its own palette, and stayed green after the accent went pink
  login.html kept its own copy of the filter fragment, two of three filters, for weeks

Neither raised anything. Both looked like small unrelated glitches. So the tests here are
not about how it looks; they are about the boundary holding: the material is somewhere else,
this repo does not answer any question it already answers, and what is served is the two of
them in the right order.
"""
import io
import os
import re
import sys

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, HERE)

from jriter import config, http as jhttp   # noqa: E402

CSS = os.path.join(HERE, "web", "css")   # old front end, still bundled by jhttp.bundle
JS = os.path.join(HERE, "web", "js")
WEB = os.path.join(HERE, "web")
UISRC = os.path.join(HERE, "ui", "src")


def read(path):
    return io.open(path, encoding="utf-8").read()


def material():
    return read(config.SHARED_GLASS)


def declared(source):
    """Every custom property a stylesheet defines. A `var(--x)` is a use, not a definition."""
    return set(re.findall(r"(?:^|[{;]|\*/)\s*(--[a-z0-9-]+)\s*:", source, flags=re.M))


def our_css():
    return {n: read(os.path.join(CSS, n))
            for n in sorted(os.listdir(CSS)) if n.endswith(".css")}


def ui_sources():
    """Every stylesheet and component of the Svelte interface: {relative path: text}."""
    found = {}
    for here, _dirs, names in os.walk(UISRC):
        for n in sorted(names):
            if n.endswith((".css", ".svelte", ".ts")):
                p = os.path.join(here, n)
                found[os.path.relpath(p, UISRC).replace(os.sep, "/")] = read(p)
    return found


def pages():
    return {n: read(os.path.join(WEB, n))
            for n in sorted(os.listdir(WEB)) if n.endswith(".html")}


# ── where the material is ────────────────────────────────────────────────────

def test_the_material_is_outside_this_repo():
    """A copy inside this tree would satisfy every other test in this file.

    Which is the whole failure mode: somebody hits a missing file, copies glass.css in
    beside the rest, and everything goes green while there are two of them again.
    """
    assert os.path.isfile(config.SHARED_GLASS), (
        "the shared material is not at %s. Check out foyer beside this repo, or point"
        " JRITER_GLASS at it." % config.SHARED_GLASS)
    here = os.path.abspath(HERE)
    there = os.path.abspath(config.SHARED_GLASS)
    assert not there.startswith(here + os.sep), (
        "the material is inside this repo, at %s. It is shared with Foyer, and a copy here"
        " is the second copy this arrangement exists to prevent." % there)
    assert os.path.isfile(config.SHARED_DEFS), \
        "the filter fragment is not at %s" % config.SHARED_DEFS


def test_the_material_is_the_one_foyer_serves():
    """Both sites, one file, and the way to know is that it is the same path.

    Skipped rather than failed when Foyer is not checked out: this app runs without it,
    with the banner, and a machine that only wants the library should not have to have both.
    """
    sibling = os.path.join(os.path.dirname(HERE), "foyer", "shared", "glass.css")
    if not os.path.isfile(sibling):
        import pytest
        pytest.skip("foyer is not checked out beside this repo")
    assert os.path.samefile(sibling, config.SHARED_GLASS), (
        "this app reads %s and Foyer serves %s, so the two sites are looking at different"
        " files and the design exists twice again" % (config.SHARED_GLASS, sibling))


def test_the_app_agrees_with_foyer_about_where_foyer_is():
    """One hostname, two sites, and both of them have to mean the same thing by /foyer.

    The rail's link and the pull past the stop go to a path on this origin now. It used to
    be a host and a port, which is reachable only from the tailnet: following it from a
    phone that is not on the tailnet, which is how anybody actually arrives, reached
    nothing. The tunnel puts the library at / and Foyer at /foyer, so the way out is a path.

    Foyer's end of the same string is the prefix it strips off requests, since the tunnel
    takes it off before proxying. If these two disagree, the way out of the library lands on
    a page whose stylesheet does not load, which reads as a broken site rather than a
    misrouted one.
    """
    sibling = os.path.join(os.path.dirname(HERE), "foyer", "server.py")
    if not os.path.isfile(sibling):
        import pytest
        pytest.skip("foyer is not checked out beside this repo")

    ours = re.search(r'export const FOYER\s*=\s*"([^"]+)"',
                     read(os.path.join(UISRC, "lib", "app.svelte.ts")))
    assert ours, "ui/src/lib/app.svelte.ts no longer says where Foyer is"
    theirs = re.search(r'^MOUNT\s*=\s*"([^"]+)"', read(sibling), flags=re.M)
    assert theirs, "foyer/server.py no longer says what it is mounted at"
    assert ours.group(1) == theirs.group(1), (
        "this app sends people to %s and Foyer answers to %s, so backing out of the library"
        " lands on a page that cannot load its own stylesheet"
        % (ours.group(1), theirs.group(1)))


def test_the_way_out_does_not_name_a_host_or_a_port():
    """Which is what made the old one unreachable from a phone.

    A path on this origin works wherever the library itself worked: through the tunnel, over
    the tailnet, on localhost. A hostname written down here works in exactly one of those.
    """
    line = [l for l in read(os.path.join(UISRC, "lib", "app.svelte.ts")).splitlines()
            if "export const FOYER" in l]
    assert line, "ui/src/lib/app.svelte.ts no longer says where Foyer is"
    where = line[0]
    assert "://" not in where and "hostname" not in where and ":7000" not in where, (
        "the way out names a host or a port again: %s" % where.strip())


# ── the boundary ─────────────────────────────────────────────────────────────

def test_this_repo_defines_none_of_the_material():
    """One definition each, so link order never decides anything.

    The material is served first precisely so this repo can override it, which makes an
    accidental override indistinguishable from a deliberate one. So there are no deliberate
    ones: anything this app wants to say differently belongs in the material, where Foyer
    gets it too.
    """
    shared = declared(material())
    assert shared, "the material defines no tokens, so it is not the material"
    for name, source in our_css().items():
        clash = sorted(declared(source) & shared)
        assert not clash, (
            "web/css/%s redefines %s. The material is bundled in front of it, so this wins"
            " silently and the two drift; and Foyer, reading the same material, does not"
            " get whatever this is." % (name, ", ".join(clash)))


def test_this_repo_still_has_furniture_of_its_own():
    """The other half, so the test above cannot pass by this app having no tokens at all.

    The split was material versus furniture: the glass and the palette are shared, and the
    things only a music library has an opinion about are not.
    """
    ours = set()
    for source in our_css().values():
        ours |= declared(source)
    assert ours, "this app defines no tokens at all, which makes the test above vacuous"
    assert "--rail-w" in ours or "--player-h" in ours, (
        "the app's own furniture is gone from web/css. The rail width and the player height"
        " are this app's and belong here: %s" % ", ".join(sorted(ours)))


def test_the_material_is_load_bearing_here():
    """This app cannot be served without it, which is why the missing file says so loudly.

    If it turned out that nothing here referenced the material, the boundary would be tidy
    and pointless.
    """
    shared = declared(material())
    used = set()
    for source in our_css().values():
        used |= set(re.findall(r"var\((--[a-z0-9-]+)", source))
    leaning = used & shared
    assert len(leaning) > 20, (
        "only %d of this app's var() references reach the material (%s). Either the split"
        " has been undone, or this repo has grown its own copy of the palette."
        % (len(leaning), ", ".join(sorted(leaning))))


def test_every_token_this_app_uses_is_defined_by_one_of_the_two():
    """A var() naming nothing is a dropped declaration, not an error.

    Which reads as a colour that is absent rather than wrong. The two files together are
    what a browser gets, so both count.
    """
    sources = ui_sources()
    known = declared(material())
    for source in sources.values():
        known |= declared(source)
        known |= set(re.findall(r"(--[a-z0-9-]+)\s*:", source))      # inline style="--x: ..."
        known |= set(re.findall(r"\bstyle:(--[a-z0-9-]+)\s*=", source))  # svelte style:--x={..}
        known |= set(re.findall(r"style:(--[a-z0-9-]+)\s*=", source))  # svelte style:--x={..}
        known |= set(re.findall(r"""setProperty\(\s*["'](--[a-z0-9-]+)""", source))
    for name, source in sources.items():
        if not name.endswith((".css", ".svelte")):
            continue
        source = re.sub(r"/\*.*?\*/", "", source, flags=re.S)
        for used in sorted(set(re.findall(r"var\((--[a-z0-9-]+)", source))):
            assert used in known, (
                "ui/src/%s uses %s and neither the shared glass.css nor ui/src defines it, so"
                " that declaration is dropped" % (name, used))


# ── what is served ───────────────────────────────────────────────────────────

def test_the_bundle_puts_the_material_in_front():
    """Order is the cascade. The material first, so this repo's own rules can win.

    Also the only thing that makes the boundary test above meaningful: it says nothing here
    redefines a material token, and that only matters because a redefinition here WOULD
    win.
    """
    out = jhttp.bundle(CSS, ".css").decode("utf-8")
    first = read(os.path.join(config.SHARED_GLASS))
    assert out.index("--accent") < out.index("00-tokens.css"), \
        "the material is not in front of this app's own stylesheets"
    body = first.strip()
    assert body[-60:] in out, "the material is announced in the bundle but not included"


def test_the_scripts_do_not_get_the_material():
    """A stylesheet in a script bundle is a syntax error at the top of every script.

    bundle() takes an extension and prepends the glass for one of them, which is the kind
    of conditional that is easy to widen by accident.
    """
    out = jhttp.bundle(JS, ".js")
    assert b"@property --accent" not in out, \
        "the shared stylesheet is being prepended to /jriter.js"


def test_a_missing_material_says_so_rather_than_serving_nothing(monkeypatch):
    """Every colour, radius and space is in that file.

    Without it the app is unstyled text, which does not look like one missing file. It
    looks like every screen is broken in its own way, which is a bad afternoon. So the
    stylesheet that comes back is a stylesheet that puts the reason on the page.
    """
    monkeypatch.setattr(config, "SHARED_GLASS",
                        os.path.join(HERE, "no-such-glass.css"))
    out = jhttp.shared_glass().decode("utf-8")
    assert "body::before" in out and "missing" in out.lower(), (
        "a missing material comes back as %r, which renders as an unstyled app with no"
        " indication why" % out[:120])
    # And it is still a stylesheet, so the rest of the bundle is unaffected.
    assert out.count("{") == out.count("}"), \
        "the banner stylesheet is unbalanced, so it eats the rules after it"
    assert "no-such-glass.css" in out, \
        "it does not say where it looked, which is the one thing worth knowing"


# ── the filter fragment, which is the login page bug ─────────────────────────

def test_no_page_carries_its_own_copy_of_the_filter():
    """login.html did, and it had two of the three filters, and had for weeks.

    Nothing broke: a chain naming url(#glass-ca) where nothing defines it silently does
    nothing. One fragment, injected, and no page allowed its own.
    """
    for name, source in pages().items():
        assert "<filter" not in source, (
            "web/%s defines a filter of its own. There is one fragment now and it is"
            " injected at %s; a copy here is exactly how the login page ended up an effect"
            " short." % (name, jhttp.Handler.DEFS_MARK.decode()))


# Deleted with the old front end: glass_classes(), the "draws something with a SVG filter at
# all" test (false by design now: the material is blur only, no SVG filters), and the "every
# page that can show glass carries the filter marker" test (the marker is kept below, but
# nothing in the new CSS needs the filter fragment).

def test_the_marker_is_only_on_pages_that_wear_the_stylesheet():
    """A filter injected into a page with no material is definitions nothing uses.

    The Svelte shell (ui/index.html) links the shared sheet at /glass.css; login.html and
    legal.html are not rebuilt and still link /jriter.css.
    """
    mark = jhttp.Handler.DEFS_MARK.decode()
    index = read(os.path.join(HERE, "ui", "index.html"))
    assert mark in index, "ui/index.html lost the %s marker the server injects at" % mark
    assert 'href="/glass.css"' in index, "ui/index.html does not link the shared stylesheet"
    for name, source in pages().items():
        if mark not in source:
            continue
        assert "/jriter.css" in source or 'href="/glass.css"' in source or "/assets/" in source, (
            "web/%s asks for the glass filter and links no stylesheet at all" % name)


def test_the_fragment_defines_every_filter_the_material_asks_for():
    """The other end of the same bug, and the end that is shared with Foyer."""
    wanted = sorted(set(re.findall(r"url\(#([a-z-]+)\)", material())))
    assert wanted, "the material references no filter any more"
    have = set(re.findall(r'<filter id="([a-z-]+)"', read(config.SHARED_DEFS)))
    missing = [w for w in wanted if w not in have]
    assert not missing, (
        "the material asks for %s and the fragment does not define it. A reference to a"
        " filter that is not there is not an error; the effect just does nothing."
        % ", ".join("#" + m for m in missing))


def test_the_tag_on_a_page_changes_when_the_fragment_does():
    """A page's ETag is its own mtime and size, and the filter is not in the page.

    So editing the fragment would change nothing any browser could notice, and every cached
    page would keep the old one. Both mtimes go into the tag, and this is the test for that,
    since the failure is invisible until somebody edits the fragment and nothing happens.
    """
    page = os.path.join(WEB, "index.html")
    stat = os.stat(page)

    handler = jhttp.Handler.__new__(jhttp.Handler)
    before = handler._page_with_glass(page, stat)
    assert before is not None, "index.html no longer takes the injecting path"
    body, tag = before

    real = config.SHARED_DEFS
    try:
        # A different fragment, with a different mtime: what editing it looks like.
        other = os.path.join(HERE, "tests", "_glass_defs_for_tag_test.html")
        io.open(other, "w", encoding="utf-8").write('<svg><filter id="x"></filter></svg>')
        os.utime(other, (stat.st_mtime + 5000, stat.st_mtime + 5000))
        config.SHARED_DEFS = other
        after_body, after_tag = handler._page_with_glass(page, stat)
    finally:
        config.SHARED_DEFS = real
        if os.path.isfile(other):
            os.remove(other)

    assert after_body != body, "the injected fragment did not change with the file"
    assert after_tag != tag, (
        "the page's ETag is %s either way, so editing the shared fragment leaves every"
        " browser holding a page with the old filter in it and no way to find out" % tag)
