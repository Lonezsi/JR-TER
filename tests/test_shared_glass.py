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

CSS = os.path.join(HERE, "web", "css")
JS = os.path.join(HERE, "web", "js")
WEB = os.path.join(HERE, "web")


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
    """The rail's link and the pull past the stop both go to a port written in the boot
    script, and Foyer's default is written in its own server. Two numbers, one door."""
    sibling = os.path.join(os.path.dirname(HERE), "foyer", "server.py")
    if not os.path.isfile(sibling):
        import pytest
        pytest.skip("foyer is not checked out beside this repo")

    boot = read(os.path.join(JS, "90-boot.js"))
    ours = re.search(r"J\.FOYER_PORT\s*=\s*(\d+);", boot)
    assert ours, "90-boot.js no longer says which port Foyer is on"
    theirs = re.search(r'"--port",\s*type=int,\s*default=(\d+)', read(sibling))
    assert theirs, "foyer/server.py no longer says which port it defaults to"
    assert ours.group(1) == theirs.group(1), (
        "this app sends people to port %s and Foyer listens on %s by default, so backing"
        " out of the library lands on nothing" % (ours.group(1), theirs.group(1)))


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
    known = declared(material())
    for source in our_css().values():
        known |= declared(source)
    for name in sorted(os.listdir(JS)):
        if name.endswith(".js"):
            source = read(os.path.join(JS, name))
            known |= set(re.findall(r"(--[a-z0-9-]+)\s*:", source))
            known |= set(re.findall(r'setProperty\(\s*"(--[a-z0-9-]+)"', source))

    for name, source in our_css().items():
        for used in sorted(set(re.findall(r"var\((--[a-z0-9-]+)", source))):
            assert used in known, (
                "web/css/%s uses %s and neither the material nor this repo defines it, so"
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


def glass_classes():
    """Every class this app draws with an SVG filter, read off the stylesheets.

    Listed nowhere, because a list is a thing to keep in step. A rule that sets
    var(--glass-filter...) is a rule whose selector needs the filter to exist, so the
    selectors answer the question.
    """
    found = set()
    for source in our_css().values():
        source = re.sub(r"/\*.*?\*/", "", source, flags=re.S)
        for rule in re.finditer(r"([^{}]+)\{([^{}]*)\}", source):
            if "var(--glass-filter" in rule.group(2):
                found |= set(re.findall(r"\.([a-zA-Z][\w-]*)", rule.group(1)))
    return found


def test_the_stylesheets_draw_something_with_a_filter_at_all():
    """The premise of the two tests below, which are vacuous without it."""
    assert len(glass_classes()) > 5, (
        "only %s are drawn with a glass filter, so either the refraction is gone or the"
        " rules that use it have moved somewhere this cannot see"
        % sorted(glass_classes()))


def test_every_page_that_can_show_glass_says_where_the_filter_goes():
    """A page that draws glass with no filter in it looks flat and reports as nothing.

    Flat is a supported way for this app to look, on an engine that cannot bend light, so
    there is no error and nothing about the page says it was a mistake. That is the whole
    reason it needs a test.

    Two ways a page can show glass: its own markup uses one of the classes, or it loads the
    app, which draws panes, sheets and menus into it afterwards.
    """
    mark = jhttp.Handler.DEFS_MARK.decode()
    glassy = glass_classes()
    for name, source in pages().items():
        classes = set()
        for attr in re.findall(r'class="([^"]*)"', source):
            classes |= set(attr.split())
        mine = sorted(classes & glassy)
        runs_the_app = "/jriter.js" in source
        if not mine and not runs_the_app:
            continue
        assert mark in source, (
            "web/%s does not carry %s and it can show glass (%s), so it is served with no"
            " filter and every refraction on it silently does nothing."
            % (name, mark, "it loads the app" if runs_the_app
               else "it uses " + ", ".join("." + c for c in mine)))


def test_the_marker_is_only_on_pages_that_wear_the_stylesheet():
    """A filter injected into a page with no material is three definitions nothing uses.

    Not a fault, and it is the residue of one: a page that has the marker and not the
    stylesheet is a page somebody detached from the app's design without finishing.
    """
    mark = jhttp.Handler.DEFS_MARK.decode()
    for name, source in pages().items():
        if mark not in source:
            continue
        assert "/jriter.css" in source, (
            "web/%s asks for the glass filter and does not link the stylesheet that"
            " references it, so nothing on the page can use what is injected" % name)


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
