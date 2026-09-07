"""The browser side, checked against the server it talks to.

None of this runs the JavaScript. It checks the contracts that break silently: an
endpoint renamed on one side, a listener that outlives its view, a stylesheet the page
never links.
"""
import os
import re
import pathlib
import urllib.error

import pytest

from jriter import config, registry
from jriter.http import resolve

WEB = config.WEB
JS_DIR = os.path.join(WEB, "js")
CSS_DIR = os.path.join(WEB, "css")


def _all_js():
    parts = []
    for name in sorted(os.listdir(JS_DIR)):
        if name.endswith(".js"):
            with open(os.path.join(JS_DIR, name), encoding="utf-8") as f:
                parts.append((name, f.read()))
    return parts


def _js():
    return "\n".join(text for _, text in _all_js())


def test_every_endpoint_the_page_calls_exists():
    """A renamed route shows up as a section of the page that is silently empty on a
    machine in another room. Only a test notices."""
    # The whole app, including the door, since the page calls that too.
    registry.load(config.MODULES)
    text = _js()
    called = set()
    # The path has to be captured through the ${id} in a template literal, not stopped
    # at it, or every route with an id in the middle reads as one that does not exist.
    for pattern in (r'J\.(?:get|post|put|patch|del|upload)\(\s*[`"\']([^`"\']+)',
                    r'J\.api\(\s*[`"\']([^`"\']+)',
                    r'fetch\(\s*[`"\']([^`"\']+)'):
        called.update(re.findall(pattern, text))

    # Template literals carry an id in the middle; the shape is what matters.
    def normalise(path):
        path = re.sub(r"\$\{[^{}]*\}", "1", path)
        # A nested template (a ${...} containing its own backticks) cannot be matched by
        # a regex. Everything before it is still a real route prefix, so cut there.
        if "${" in path:
            path = path.split("${")[0]
        return path.split("?")[0].rstrip("/")

    missing = []
    for raw in sorted(called):
        path = normalise(raw)
        if not path.startswith("/api/"):
            continue
        found = any(resolve(method, path)[0] for method in
                    ("GET", "POST", "PUT", "PATCH", "DELETE"))
        if not found:
            missing.append(path)
    assert not missing, "the page calls endpoints the server does not have: %s" % missing


def test_the_endpoints_each_feature_needs_are_still_called():
    """Named one by one, so deleting a chunk of a view fails here rather than quietly
    reducing what the app can do."""
    text = _js()
    for path in ("/api/state", "/api/songs", "/api/songs/${", "/api/versions/${",
                 "/api/albums", "/api/sync/scan", "/api/sync/import",
                 "/api/update/check", "/api/update/apply", "/api/settings"):
        assert path in text, "nothing calls %s any more" % path


def test_the_router_replaces_the_view_rather_than_emptying_it():
    """Views attach delegated click handlers to the view node. Emptying it left every
    previous view's handler attached: after six navigations one click on Play started
    playback six times over and the concurrent starts fought each other.

    Matched on what the router does rather than on the signature it happens to have, so
    adding an argument to go() does not read as the bug coming back.
    """
    with open(os.path.join(JS_DIR, "80-router.js"), encoding="utf-8") as f:
        router = f.read()
    assert "replaceWith" in router, "the router reuses the view node, so listeners pile up"
    body = re.split(r"async function go\(", router, maxsplit=1)[1]
    assert 'createElement("div")' in body, "the router no longer builds a fresh view node"
    # Even the in place refresh has to make a new node; carrying the old one over is
    # exactly how the handlers used to pile up.
    assert body.count('createElement("div")') == 1


def test_listeners_on_the_bus_let_go_when_their_panel_is_gone():
    """A subscription outlives the DOM it draws, so it has to unhook itself.

    Every view that redraws on a player change has to do this, or each visit to a song
    leaves another listener redrawing an element that is no longer on the page.
    """
    for name in ("60-view-song.js",):
        with open(os.path.join(JS_DIR, name), encoding="utf-8") as f:
            text = f.read()
        if 'J.on("player:change"' not in text:
            continue
        assert "removeEventListener" in text, "%s subscribes to the bus forever" % name


def test_the_eq_reads_the_response_without_touching_playback():
    """The sound panel is reachable for a song that is not playing. Computing its curve
    from the live chain would have made the display wrong, or worse, changed the sound of
    whatever else was playing."""
    with open(os.path.join(JS_DIR, "30-eq.js"), encoding="utf-8") as f:
        eq = f.read()
    assert "responseOf(data.bands" in eq, "the curve is read off the live chain"

    with open(os.path.join(JS_DIR, "66-panel-sound.js"), encoding="utf-8") as f:
        panel = f.read()
    # An edit goes through the player, which hands it only to the decks actually holding
    # this preset. Applying it to the audio graph directly would change whatever else was
    # playing, including another song.
    assert "presetEdited" in panel, "the sound panel writes to the audio graph directly"
    assert "J.audio.applyTo" not in panel, "the panel reaches past the player into a deck"

    with open(os.path.join(JS_DIR, "40-player.js"), encoding="utf-8") as f:
        player = f.read()
    body = player.split("presetEdited(presetId, data) {", 1)[1].split("\n    },", 1)[0]
    assert "preset.id === presetId" in body, "an edit is applied to slots that do not hold it"


def test_adding_a_band_does_not_rebuild_the_canvas():
    """An earlier version redrew the whole panel when a band was added, which replaced
    the canvas under the pointer: you could add a node but never add one and drag it."""
    with open(os.path.join(JS_DIR, "66-panel-sound.js"), encoding="utf-8") as f:
        panel = f.read()
    handler = panel.split('if (what === "add")', 1)[1].split("\n", 1)[0]
    assert "renderBands()" in handler and "draw()" not in handler


def test_the_page_asks_the_server_what_exists_before_drawing_it():
    """Switching a module off in config has to remove it from the interface too, or the
    UI shows a button that returns 404."""
    with open(os.path.join(JS_DIR, "60-view-song.js"), encoding="utf-8") as f:
        song = f.read()
    assert "J.state.modules.includes" in song, "the song page assumes every module is on"


# ── the shell ────────────────────────────────────────────────────────────────
def test_the_page_links_what_the_server_bundles():
    with open(os.path.join(WEB, "index.html"), encoding="utf-8") as f:
        page = f.read()
    assert '"/jriter.css"' in page and '"/jriter.js"' in page
    # The stylesheet link itself, not merely a mention. This assertion used to pass on a
    # comment describing a typeface the page had stopped loading, which is a test that
    # cannot fail: deleting the link entirely would not have moved it.
    # The css2 request specifically. A preconnect hint to the same host is not a request
    # for a typeface, and matching it made this pass while loading nothing.
    link = re.search(r'<link[^>]+fonts\.googleapis\.com/css2\?[^>]*>', page)
    assert link, "the typefaces are never fetched"
    for family in ("Orbitron", "Manrope"):
        assert "family=" + family in link.group(0), "%s is not requested" % family


def test_the_bundles_are_not_empty():
    from jriter.http import bundle
    css = bundle(CSS_DIR, ".css")
    js = bundle(JS_DIR, ".js")
    assert len(css) > 4000, "the stylesheet bundle is suspiciously small"
    assert len(js) > 20000, "the script bundle is suspiciously small"
    assert b"J.views.library" in js


def test_every_view_file_registers_a_view():
    """A file in js/ that defines nothing is a file that should have been deleted."""
    for name, text in _all_js():
        if "-view-" in name:
            assert re.search(r"J\.views\.\w+\s*=", text), "%s registers no view" % name


def test_the_css_only_spends_tokens_on_colour():
    """One accent, set in one place. A literal colour in a component is how a design
    system stops being one."""
    allowed = {"transparent", "currentColor", "inherit", "none", "cover"}
    offenders = []
    for name in sorted(os.listdir(CSS_DIR)):
        if not name.endswith(".css") or name.startswith("00-"):
            continue
        with open(os.path.join(CSS_DIR, name), encoding="utf-8") as f:
            for number, line in enumerate(f, 1):
                if line.strip().startswith("/*") or line.strip().startswith("*"):
                    continue
                for literal in re.findall(r"#[0-9a-fA-F]{3,8}\b", line):
                    offenders.append("%s:%d %s" % (name, number, literal))
    # A handful of one-off shades are tolerable; a drift into hardcoded colour is not.
    assert len(offenders) <= 4, "colours are being written by hand: %s" % offenders


def test_the_modules_the_ui_expects_are_the_modules_that_exist():
    registry.load()
    text = _js()
    named = set(re.findall(r'modules\.includes\("(\w+)"\)', text))
    unknown = named - set(config.MODULES)
    assert not unknown, "the UI checks for modules that do not exist: %s" % unknown


def test_the_hidden_attribute_beats_the_layout():
    """A browser's own [hidden] { display: none } is a user agent rule, and any author
    rule beats it. Without a rule of our own, .sheet-backdrop { display: grid } left the
    modal backdrop over the whole app at 60% black with nothing in it: the page looked
    dimmed and every click landed on the overlay instead of the interface.

    Anything that carries the hidden attribute and also gets a display from its class
    depends on this one line.
    """
    from jriter.http import bundle
    css = bundle(CSS_DIR, ".css").decode("utf-8")
    # A bare [hidden], not anything-[hidden]. A rule scoped to one class satisfied this
    # and hid the fact that the global guard had been deleted: .grain[hidden] was written
    # for a layer that needed no rule of its own, and its only effect was to make this
    # test unable to fail.
    assert re.search(r"(?:\A|\n)\s*\[hidden\]\s*\{[^}]*display:\s*none\s*!important", css), \
        "nothing makes the hidden attribute win, so hidden elements with a display show"

    with open(os.path.join(WEB, "login.html"), encoding="utf-8") as f:
        login = f.read()
    assert re.search(r"\[hidden\]\s*\{[^}]*display:\s*none\s*!important", login), \
        "the login page has its own stylesheet and the same hazard"


def test_everything_that_starts_hidden_can_actually_hide():
    """Every element in the shell that starts hidden, found rather than listed.

    This used to name the three of them, which meant it failed the day one of them was
    replaced and reported that the shell was broken when what had happened is that a
    status dot became a labelled link. Reading them out of the markup checks the property
    rather than the inventory: an author rule setting `display` on a class beats the
    browser's own [hidden] rule, so anything given both needs the guard, and a new one is
    covered the moment somebody writes it.
    """
    with open(os.path.join(WEB, "index.html"), encoding="utf-8") as f:
        page = f.read()
    css = "\n".join(open(os.path.join(CSS_DIR, n), encoding="utf-8").read()
                    for n in sorted(os.listdir(CSS_DIR)) if n.endswith(".css"))

    starts_hidden = re.findall(r"<\w+([^>]*\bhidden\b[^>]*)>", page)
    assert len(starts_hidden) >= 3, (
        "found almost nothing in the shell that starts hidden, so this is looking in the "
        "wrong place: %s" % starts_hidden)

    named = []
    for attrs in starts_hidden:
        found = re.search(r'class="([^"]+)"', attrs)
        if found:
            named.extend(found.group(1).split())
    assert named, "nothing that starts hidden is styled through a class"
    for element_class in named:
        assert "." + element_class in css, (
            "%s starts hidden and nothing styles it, so either the class is a typo or the "
            "rule it needs is gone" % element_class)

    # The guard itself, without which every one of those that is given a display ignores
    # the attribute completely. A bare [hidden], for the reason spelled out in
    # test_the_hidden_attribute_beats_the_layout above.
    assert re.search(r"(?:\A|\n)\s*\[hidden\]\s*\{[^}]*display:\s*none\s*!important", css)


# ── the silent CSS failures ──────────────────────────────────────────────────
def _class_lists(text):
    """The literal class names of each element, kept per element.

    Two classes only fight over display when they are on the same element, so these stay
    grouped rather than flattened. Flattening them compared every class in a file against
    every other and reported four hundred imaginary clashes.

    Class attributes here are template literals, so most of them carry a ${...} in the
    middle. An earlier version of this matched class="([^"$]*)" and therefore skipped
    every attribute containing one, which is nearly all of them: .sheet-tab went
    undefined for a whole release and rendered as white default buttons. The expressions
    are stripped and the literal names either side are kept.
    """
    elements = []
    for raw in re.findall(r'class="([^"]*)"', text):
        cleaned, depth, out = raw, 0, []
        i = 0
        while i < len(cleaned):
            if cleaned.startswith("${", i):
                depth += 1
                i += 2
                continue
            if depth:
                if cleaned[i] == "{":
                    depth += 1
                elif cleaned[i] == "}":
                    depth -= 1
                i += 1
                continue
            out.append(cleaned[i])
            i += 1
        names = [n for n in "".join(out).split() if n]
        if names:
            elements.append(names)
    return elements


def _class_names(text):
    """Every literal class name in a file, flattened."""
    return {name for element in _class_lists(text) for name in element}


def _markup_sources():
    web = pathlib.Path(WEB)
    return list((web / "js").glob("*.js")) + [web / "index.html", web / "login.html"]


def _styled_classes():
    """Every class any stylesheet defines, including the login page's own block."""
    css = "\n".join(open(os.path.join(CSS_DIR, n), encoding="utf-8").read()
                    for n in sorted(os.listdir(CSS_DIR)) if n.endswith(".css"))
    login = open(os.path.join(WEB, "login.html"), encoding="utf-8").read()
    inline = re.search(r"<style>(.*?)</style>", login, re.S)
    if inline:
        css += "\n" + inline.group(1)
    return set(re.findall(r"\.([a-zA-Z][\w-]*)", css))


def test_no_class_in_the_markup_goes_unstyled():
    """An element given a class nothing defines is drawn by the browser's own rules.

    The rail's New song button carried .chip, which existed in no stylesheet, so it
    rendered as a default button: a white box on a dark panel, unreadable.
    """
    styled = _styled_classes()
    # Hooks the scripts query or toggle but never paint.
    hooks = {"now", "total", "sheet-body", "on", "off", "chosen", "playing", "current",
             "settled", "hot", "dragging", "scrubbing", "paused", "is-cover", "bad",
             "slide-left", "slide-right", "rail-shut", "grow", "wrap", "sm", "lg",
             "primary", "ghost", "danger", "quiet", "accent", "warn", "right", "spec"}
    unstyled = {}
    for path in _markup_sources():
        text = path.read_text(encoding="utf-8")
        for name in _class_names(text):
            if name and name not in styled and name not in hooks:
                unstyled.setdefault(name, set()).add(path.name)
    assert not unstyled, "classes used but never styled: " + str(
        {k: sorted(v) for k, v in unstyled.items()})


def test_no_element_has_two_classes_fighting_over_display():
    """Two single class rules setting display tie on specificity, so whichever file the
    bundler reaches last wins.

    .rail-close is `icon-btn rail-close`. .icon-btn sets display: grid in 30-controls.css
    and .rail-close set display: none in 20-shell.css, so the button was permanently
    visible on desktop, where nothing was wired to it. The fix is a two class selector,
    which does not care about file order.
    """
    files = sorted(n for n in os.listdir(CSS_DIR) if n.endswith(".css"))
    declares = {}
    for order, name in enumerate(files):
        text = open(os.path.join(CSS_DIR, name), encoding="utf-8").read()
        for m in re.finditer(r"([^{}]+)\{([^{}]*)\}", text):
            body = m.group(2)
            value = re.search(r"display:\s*([\w-]+)", body)
            if not value:
                continue
            for part in m.group(1).strip().split("\n")[-1].split(","):
                part = part.strip()
                if re.fullmatch(r"\.[\w-]+", part):
                    declares.setdefault(part[1:], []).append((order, name, value.group(1)))

    clashes = []
    for path in _markup_sources():
        for element in _class_lists(path.read_text(encoding="utf-8")):
            names = [n for n in element if n in declares]
            for i, a in enumerate(names):
                for b in names[i + 1:]:
                    va, vb = declares[a][0], declares[b][0]
                    if va[2] != vb[2]:
                        clashes.append("%s(%s in %s) vs %s(%s in %s)"
                                       % (a, va[2], va[1], b, vb[2], vb[1]))
    assert not clashes, "file order decides whether these show: " + "; ".join(sorted(set(clashes)))


def test_a_page_revalidates_instead_of_being_held_for_a_day(server):
    """index.html went out with max-age=86400, so a fix landed on disk and the browser
    kept serving yesterday's markup for a day. That is how a corrected button stayed
    broken on screen long after it was fixed."""
    import urllib.request
    for path in ("/login", "/jriter.css"):
        with urllib.request.urlopen(server.base + path, timeout=10) as response:
            cache = response.headers.get("Cache-Control", "")
            etag = response.headers.get("ETag")
        assert "max-age" not in cache, "%s is cached for a fixed time: %s" % (path, cache)
        assert etag, "%s has no ETag, so no-cache means a full refetch every time" % path

        request = urllib.request.Request(server.base + path,
                                         headers={"If-None-Match": etag})
        try:
            with urllib.request.urlopen(request, timeout=10) as again:
                assert False, "%s did not answer 304 to a matching tag" % path
        except urllib.error.HTTPError as e:
            assert e.code == 304, "%s answered %d to a matching tag" % (path, e.code)


def test_editing_an_arrangement_does_not_reschedule_the_audio_on_every_move():
    """Trimming a clip while it plays used to tear down every scheduled source and build
    ten new ones on each pointermove: about seven hundred buffer sources over one drag,
    a three quarter second stall, and audio that restarted continuously while you were
    trying to listen to the edit.

    Every edit therefore goes through resync(), which coalesces, rather than calling
    seek() straight through to the scheduler.
    """
    with open(os.path.join(JS_DIR, "22-arrange.js"), encoding="utf-8") as f:
        arrange = f.read()

    assert "resync()" in arrange, "the coalescing reschedule is gone"
    # The editing methods are the ones that must not reschedule immediately.
    for name in ("move", "duplicate", "remove", "resize", "setTempo", "setOffset"):
        body = re.split(r"\n    %s\(" % name, arrange, maxsplit=1)
        assert len(body) == 2, "%s is no longer an editing method here" % name
        # Up to the next method at the same indentation.
        chunk = re.split(r"\n    \w+\(", body[1], maxsplit=1)[0]
        assert "api.seek(" not in chunk, (
            "%s reschedules straight away; a drag calls it once per frame" % name)


def test_every_control_marked_with_an_action_has_one():
    """A button wired to nothing is the worst kind of broken, because it looks fine.

    The rail's close button and the hamburger both did this once: present, styled,
    pressable, and connected to no code at all. data-act is how a control says what it
    does, so every value that appears in markup has to be matched somewhere.
    """
    used, handled = {}, set()
    for name, text in _all_js():
        for act in re.findall(r'data-act="([a-z-]+)"', text):
            used.setdefault(act, set()).add(name)
        # The three shapes the handlers are written in.
        handled.update(re.findall(r'dataset\.act === "([a-z-]+)"', text))
        handled.update(re.findall(r'\bact === "([a-z-]+)"', text))
        handled.update(re.findall(r'\bwhat === "([a-z-]+)"', text))
        # Nothing here may match the markup itself: an earlier version did, so
        # every action counted as handled simply by existing.
        handled.update(re.findall(r'closest\([\'"]\[data-act=[\'"]([a-z-]+)', text))

    dead = {act: sorted(files) for act, files in used.items() if act not in handled}
    assert not dead, "controls that say they do something and do not: %s" % dead


def test_every_control_a_menu_reaches_for_actually_exists():
    """A menu item that presses a button by selector is only as good as the selector.

    The preset menu reached for [data-act="clone"] when the button is called
    clone-preset, so Duplicate was a menu entry that quietly did nothing. That is the
    same failure as a dead button, arrived at from the other direction: the handler
    exists, the markup exists, and the two do not meet.
    """
    declared, reached = set(), {}
    for name, text in _all_js():
        declared.update(re.findall(r'data-act="([a-z-]+)"(?!\s*\])', text))
        # Selector forms: J.$('[data-act="x"]') and node.querySelector('[data-act="x"]')
        for act in re.findall(r"""querySelector\(\s*['"]\[data-act=['"]([a-z-]+)""", text):
            reached.setdefault(act, set()).add(name)
        for act in re.findall(r"""J\.\$\(\s*['"]\[data-act=['"]([a-z-]+)""", text):
            reached.setdefault(act, set()).add(name)

    missing = {act: sorted(files) for act, files in reached.items() if act not in declared}
    assert not missing, "menus reaching for controls that do not exist: %s" % missing


def test_no_stylesheet_has_an_unbalanced_brace():
    """One stray brace takes every rule after it with it.

    An edit left a single orphan } at the end of 10-base.css. The browser stopped
    parsing there, so every stylesheet concatenated after it was discarded: the shell
    lost its grid and the whole app fell into one stacked column. Nothing looked like a
    CSS syntax error, it looked like the layout had been rewritten.

    Counted rather than parsed, because the failure is always a count.
    """
    broken = {}
    for name in sorted(os.listdir(CSS_DIR)):
        if not name.endswith(".css"):
            continue
        with open(os.path.join(CSS_DIR, name), encoding="utf-8") as f:
            text = f.read()
        # Braces inside comments and strings would confuse this; there are none, and a
        # test that quietly stops counting is worse than one that is slightly strict.
        opened, closed = text.count("{"), text.count("}")
        if opened != closed:
            broken[name] = "%d open, %d closed" % (opened, closed)
    assert not broken, "stylesheets that will stop the parser: %s" % broken


def _members_of_literal(text, at):
    """The names a `return { ... }` literal puts on the object, at its own level only.

    Walked rather than matched line by line, because these modules are written both ways:
    one name per line with a comment above it, and `return { create };` all on one.
    """
    depth, i, names = 0, at, set()
    while i < len(text):
        ch = text[i]
        # Comments and strings are stepped over whole. Every one of these modules
        # documents its members in prose above them, and the last word of a comment line
        # sits exactly where a shorthand member sits: taking those as members would have
        # let this test find "apply" in a paragraph about applying and pass regardless.
        if text.startswith("//", i):
            i = text.find("\n", i)
            if i < 0:
                break
            continue
        if text.startswith("/*", i):
            end = text.find("*/", i + 2)
            i = len(text) if end < 0 else end + 2
            continue
        if ch in "\"'`":
            i += 1
            while i < len(text) and text[i] != ch:
                i += 2 if text[i] == "\\" else 1
            i += 1
            continue
        if ch in "{[(":
            depth += 1
        elif ch in "}])":
            depth -= 1
            if depth == 0:
                break
        elif depth == 1 and (ch.isalpha() or ch == "_"):
            word = re.match(r"[A-Za-z_]\w*", text[i:]).group(0)
            after = text[i + len(word):]
            if word in ("get", "set", "async") and re.match(r"\s+[A-Za-z_]", after):
                i += len(word)
                continue
            # A member is followed by its parentheses, its colon, the next comma, the end
            # of the line, or the closing brace when it is the last of `return { one };`.
            follows = after.lstrip(" \t")[:1]
            if follows in ("(", ":", ",", "}", "\r", "\n", ""):
                names.add(word)
            i += len(word)
            continue
        i += 1
    return names


def test_no_module_is_called_for_something_it_does_not_have():
    """A call into a module that lost the name it is called by.

    J.audio.apply went away when A and B became two filter chains, because a sound now
    has to be applied to a deck rather than to the output. The EQ editor kept calling it,
    and the throw landed first thing in commit(), so every drag of a curve died before
    onChange ever ran: the editor drew a new shape and nothing else in the app heard
    about it. Nothing failed loudly. The EQ simply stopped working.

    These are single object modules built by an IIFE that ends in one object literal, so
    what a module has can be read off that literal, and what is asked of it can be read
    off every J.<module>.<name>( in the source.
    """
    surface, wanted = {}, {}
    for name, text in _all_js():
        made = re.search(r"^J\.(\w+)\s*=\s*\(function", text, re.M)
        if made:
            # The literal the IIFE itself returns, which is the one at the outer indent.
            # Not the last "return {" in the file: several of these modules return object
            # literals from inside their own functions, further down.
            opens = re.search(r"^  return \{", text, re.M)
            if opens:
                surface[made.group(1)] = _members_of_literal(text, opens.end() - 1)
        for module, member in re.findall(r"\bJ\.(\w+)\.(\w+)\s*\(", text):
            wanted.setdefault(module, {}).setdefault(member, set()).add(name)

    # A parser that quietly read nothing would make this pass forever, so say out loud
    # how much of the app it managed to read.
    read = sorted(m for m, names in surface.items() if names)
    assert len(read) >= 8, "only read the surface of %s, so this proves little" % read
    assert "audio" in read, "the module this was written for was not read"

    missing = {}
    for module, members in wanted.items():
        if module not in surface or not surface[module]:
            continue                        # not one of these modules, or not readable
        for member, files in members.items():
            if member not in surface[module]:
                missing["J.%s.%s" % (module, member)] = sorted(files)
    assert not missing, "called but not there: %s" % missing


def test_the_lyrics_deck_holds_its_gestures_on_something_that_survives_a_redraw():
    """Swiping the lyrics card worked exactly once, then never again.

    The deck's drag was bound to #deckWindow. Changing card calls go(), which schedules
    draw(), and draw() rewrites block.innerHTML: #deckWindow is a different element
    afterwards and the listeners went in the bin with the old one. The arrows, the dots
    and the keyboard all kept working, because those are delegated on block, which is
    never replaced. Only the drag was bound to the thing that gets thrown away, so the
    failure looked like "swiping breaks the card" rather than like a redraw.

    The rule this encodes: in a panel that redraws itself, listeners belong on the root
    that survives, and the element inside is resolved when the gesture happens.
    """
    text = pathlib.Path(JS_DIR, "62-panel-lyrics.js").read_text(encoding="utf-8")

    body = re.search(r"function wireDrag\(\)\s*\{(.*?)\n  \}", text, re.S)
    assert body, "wireDrag is not shaped the way this test reads it"

    bound = set(re.findall(r"(\w+)\.addEventListener\(", body.group(1)))
    assert bound, "wireDrag binds nothing at all"
    assert bound == {"block"}, (
        "the deck's drag is bound to %s; draw() replaces everything inside block, so a "
        "listener held there survives one redraw at most" % sorted(bound - {"block"}))

    # And the ids inside the redrawn markup must not be captured once and kept.
    kept = re.findall(r"(?:const|let)\s+\w+\s*=\s*J\.\$\(\s*[\"']#deck(?:Window|Track)",
                      body.group(1))
    assert not kept, "the deck elements are resolved once and held across redraws"


def test_no_view_block_reaches_for_a_variable_it_was_never_given():
    """A block is handed its own element and a context, never the view root.

    blockArtwork reached for `root`, which exists in the view's render function and not
    in the block's. The ReferenceError landed inside an async click handler, so it did
    not reach window.onerror and nothing was logged: choosing a cover saved on the
    server and then silently stopped, leaving the header showing the old picture. The
    only symptom was a page that looked like it had ignored you.
    """
    text = pathlib.Path(JS_DIR, "60-view-song.js").read_text(encoding="utf-8")

    blocks = re.findall(r"^J\.(block\w+)\s*=\s*(?:async\s+)?function\s*\(([^)]*)\)",
                        text, re.M)
    assert blocks, "no view blocks found; this test is reading the wrong shape"

    trouble = {}
    for name, params in blocks:
        given = {p.strip() for p in params.split(",") if p.strip()}
        start = text.index("J.%s = " % name)
        nxt = [text.index("J.%s = " % other) for other, _ in blocks
               if other != name and text.index("J.%s = " % other) > start]
        body = text[start:min(nxt) if nxt else len(text)]
        # `root` is the view's, and a block is never handed it.
        if "root" not in given and re.search(r"[^.\w]root\b", body):
            trouble[name] = "reaches for root"
    assert not trouble, "blocks using a name they were not given: %s" % trouble


def test_a_corrected_duration_is_only_written_for_the_file_that_was_decoded():
    """One take's length landed on another take's row.

    loadVersion points the slot at the new version before it sets the element's source,
    so for a moment the element still holds the previous file. A loadedmetadata event
    already in flight arrives with the old file's duration and the new version in the
    slot, and the correction is written against the wrong version.

    Found in a real library: a version stored as 41 seconds whose file is 256, while the
    render row it came from had the right number all along. Nothing failed, and the wrong
    number then drove the scrubber, the length sort and this page's own estimates.
    """
    text = pathlib.Path(JS_DIR, "40-player.js").read_text(encoding="utf-8")

    at = text.index('audio.addEventListener("loadedmetadata"', text.index("tells it once"))
    body = text[at:text.index("});", at)]

    assert "currentSrc" in body, (
        "the correction does not check which file the element actually decoded, so it "
        "can write one version's duration onto another")
    assert body.index("currentSrc") < body.index("J.patch"), \
        "the check has to come before the write, or it is not a guard"


def test_a_key_pressed_on_a_nested_control_does_that_controls_job():
    """Rows that are themselves buttons and also contain buttons.

    A delegated keydown using closest() matches the row even when focus is on something
    inside it, so Enter on the Play button of a render row opened the "where does this
    go" sheet, Enter on an artwork tile's remove button made that picture the cover, and
    Enter on a song's title link played the song instead of opening its page. Every one
    of them did the opposite of what the focused control said it did, and only from the
    keyboard, which is why none was noticed.
    """
    rows = [
        ("76-view-renders.js", "render-row"),
        ("60-view-song.js", "data-image"),
        ("50-view-library.js", "track"),
    ]
    for name, marker in rows:
        text = pathlib.Path(JS_DIR, name).read_text(encoding="utf-8")
        for match in re.finditer(r'addEventListener\("keydown"', text):
            body = text[match.start():match.start() + 900]
            if marker not in body or "Enter" not in body:
                continue
            guarded = ("e.target !== " in body) or ('e.target.closest("a, button")' in body)
            assert guarded, (
                "%s has a delegated Enter handler on %s with nothing stopping it firing "
                "when focus is on a control inside the row" % (name, marker))


def test_every_script_actually_parses():
    """One bad character takes the whole app down.

    The JS files are concatenated into a single /jriter.js, so a syntax error anywhere in
    any of them means no J at all: every screen renders empty and nothing in the console
    points at which file. It has happened twice, both times from an escape mangled while
    editing rather than from the code being wrong.

    Skipped rather than failed where node is missing, because this checks the tooling
    that happens to be here, not the library.
    """
    import shutil
    import subprocess

    node = shutil.which("node")
    if not node:
        pytest.skip("node is not on this machine, so nothing can parse the scripts")

    broken = {}
    for name in sorted(os.listdir(JS_DIR)):
        if not name.endswith(".js"):
            continue
        done = subprocess.run([node, "--check", os.path.join(JS_DIR, name)],
                              capture_output=True, text=True)
        if done.returncode != 0:
            first = [line for line in done.stderr.splitlines() if "Error" in line]
            broken[name] = first[0] if first else done.stderr.strip()[:120]
    assert not broken, "these do not parse, so the whole app is blank: %s" % broken


HARNESS = """
const fs = require("fs");
const path = require("path");
const dir = process.argv[2];
const NL = String.fromCharCode(10);

global.J = {
  esc: (s) => String(s == null ? "" : s)
    .split("&").join("&amp;").split("<").join("&lt;")
    .split(">").join("&gt;").split('"').join("&quot;"),
};
eval(fs.readFileSync(path.join(dir, "10-markdown.js"), "utf8"));

const fail = [];

// Where the body starts has to agree with what the body is, or the cursor lands in
// the wrong place by exactly the length of the title.
const texts = [
  "title" + NL + "body one" + NL + "body two",
  NL + NL + "title after blanks" + NL + "words",
  "only a title",
  "",
];
for (const text of texts) {
  const start = J.mdBodyStart(text);
  if (text.slice(start) !== J.mdBody(text)) {
    fail.push("mdBodyStart disagrees with mdBody for " + JSON.stringify(text) +
              ": slice gave " + JSON.stringify(text.slice(start)) +
              " and mdBody gave " + JSON.stringify(J.mdBody(text)));
  }
}

// Every kind of block carries the line it was written on, in order, none missing.
const source = ["a plain line", "", "# a heading", "- a bullet", "1. numbered",
                "> a quote", "**bold**", "---", "last"].join(NL);
const html = J.md(source);
const seen = [];
const finder = /data-l="([0-9]+)"/g;
let hit = null;
while ((hit = finder.exec(html))) seen.push(Number(hit[1]));

const want = source.split(NL).map((_, i) => i);
if (JSON.stringify(seen) !== JSON.stringify(want)) {
  fail.push("blocks are numbered " + JSON.stringify(seen) + " but the source has lines " +
            JSON.stringify(want));
}

if (fail.length) { console.error(fail.join(NL)); process.exit(1); }
console.log("ok");
"""


def test_every_drawn_block_says_which_line_it_came_from(tmp_path):
    """Clicking into the words puts the cursor where the click was, and that only works
    because the renderer numbers each block by its source line.

    Counting characters across the drawing instead was wrong for anything marked up: a
    bullet is two characters shorter on screen than in the text, a heading two or more,
    a blank line has no text in it at all. So the numbering is the contract, and it has
    to cover every kind of block the renderer can produce, in order, with none skipped.
    """
    import shutil
    import subprocess

    node = shutil.which("node")
    if not node:
        pytest.skip("node is not on this machine, so nothing can run the scripts")

    harness = tmp_path / "check-markdown.js"
    harness.write_text(HARNESS, encoding="utf-8")
    done = subprocess.run([node, str(harness), JS_DIR], capture_output=True, text=True)
    assert done.returncode == 0, done.stderr.strip() or done.stdout.strip()


def test_the_dust_stops_completely():
    """Every listener the field adds has to come off again.

    This is the failure this project keeps repeating: an interval nobody cleared, a
    listener that outlived its panel, a watcher inventing songs on a timer. The field
    runs behind backdrop filtered glass, so one that carries on after a song's artwork
    opens is not a stray callback, it is the compositor re running a displacement map and
    a 22px blur over the rail and the player for ever.
    """
    text = pathlib.Path(JS_DIR, "18-dust.js").read_text(encoding="utf-8")
    # halt() is the teardown. stop() is the page saying it no longer wants any, and the
    # dial going to nought is the other caller: both end here, and this is the one place
    # that has to give everything back.
    halt = text[text.index("function halt()"):text.index("function stop()")]
    for gone in ("cancelAnimationFrame",
                 'removeEventListener("visibilitychange"',
                 'removeEventListener("change"',
                 "canvas.remove()"):
        assert gone in halt, "18-dust.js halt() does not do %s" % gone
    stop = text[text.index("function stop()"):text.index("function begin(")]
    assert "halt()" in stop, "stop() no longer tears anything down"
    assert "if (motion.matches) return" in text, \
        "18-dust.js starts the loop without checking prefers-reduced-motion"


def test_the_dust_is_only_there_when_no_artwork_is():
    """The whole point is that it fills the room a song's picture would have filled.
    Left running under artwork it is a full screen canvas repainting under the glass for
    something nobody can see."""
    text = pathlib.Path(JS_DIR, "00-util.js").read_text(encoding="utf-8")
    wash = text[text.index("J.pageWash = function"):]
    wash = wash[:wash.index("\n};")]
    assert "if (url) J.dust.stop(); else J.dust.start(hue);" in wash, \
        "pageWash no longer turns the dust off when a song has artwork"


def test_the_dust_only_draws_where_there_is_glass():
    """It is not something on the page, it is something the glass finds behind it.

    Drawn across the whole viewport it also showed through the main panel, which is solid
    on the library screens and translucent on a song page, so the same effect was subtle
    in one place and a field of specks over the words in another.
    """
    text = pathlib.Path(JS_DIR, "18-dust.js").read_text(encoding="utf-8")
    assert 'const GLASS = ".rail, .topbar, .player"' in text
    draw = text[text.index("function draw(dt)"):]
    draw = draw[:draw.index("\n  }")]
    assert "clipToGlass()" in draw and "ctx2d.clip()" in draw, \
        "draw() no longer clips the specks to the glass"
    # And nothing is drawn when there is none, rather than everything being drawn.
    assert "if (!clipToGlass()) { ctx2d.restore(); return; }" in draw


def test_the_dust_is_white():
    """It was the accent, and through glass that already carries the accent everywhere
    that read as a green cast on the rail rather than as specks."""
    text = pathlib.Path(JS_DIR, "18-dust.js").read_text(encoding="utf-8")
    tint = text[text.index("function tint()"):]
    tint = tint[:tint.index("\n  }")]
    assert "rgba(255, 255, 255" in tint
    assert "--accent" not in tint and "hsla(" not in tint, \
        "the dust is taking a colour from somewhere again"


def test_every_dial_in_settings_is_a_setting_the_server_will_take(server):
    """put_settings has an allowlist, and a key missing from it is rejected outright.

    Which sounds safe, and is the opposite: the Settings screen sends one patch with every
    field in it, so one unlisted key fails the whole save. Add a dial, forget the
    allowlist, and Save stops working for the accent colour too. Nearly shipped exactly
    that with the dither dial.

    The keys are read out of the view rather than listed here, so a new dial is covered
    the moment it exists.
    """
    import re

    view = os.path.join(config.WEB, "js", "74-view-sync.js")
    with open(view, encoding="utf-8") as f:
        source = f.read()

    # The one object the Save button sends. Read from the source so this cannot drift.
    block = source[source.index("const patch = {"):]
    block = block[:block.index("};")]
    keys = set(re.findall(r"^\s*(\w+):", block, re.M))
    # ffmpeg_path is added conditionally below that object, and is a setting too.
    keys.add("ffmpeg_path")
    assert "glass_edge" in keys and "dust" in keys, "the dials moved; this test is stale"

    status, before = server.get("/api/settings")
    assert status == 200
    # Sent as one patch, exactly as the Save button sends it, so an unlisted key fails
    # here the same way it would fail there.
    patch = {k: before.get(k) for k in keys if before.get(k) is not None}
    assert len(patch) >= 4, "read almost nothing out of the view: %s" % sorted(keys)
    status, said = server.put("/api/settings", patch)
    assert status == 200, said


def test_the_rail_gesture_asks_the_element_not_a_list_of_class_names():
    """What the rail is allowed to slide over, and why it is not a list any more.

    The first version listed classes that could claim a horizontal drag, which is not the
    same question as whether one is claimed right now. A lyric deck holding one sheet has
    nowhere to swipe to and an arrangement strip that fits has nothing to scroll, and both
    refused the gesture regardless, so on a phone the rail could only be pulled from
    whatever blank background was left over. On a song page there is hardly any.

    Two things must stay true. The gesture is refused where a sideways drag already means
    something, and that set is decided by measuring the element. And it is NOT refused
    merely because the thing under the finger is pressable, which is what used to gate it:
    eight pixels of travel and a swallowed trailing click are what separate a swipe from a
    press, and both are measurements rather than guesses about markup.
    """
    with open(os.path.join(JS_DIR, "90-boot.js"), encoding="utf-8") as f:
        boot = f.read()

    body = boot[boot.index("function claimsSideways"):]
    body = body[:body.index("\n  }")]
    # Direct manipulation and modal surfaces, which are the two that always mean
    # something. Losing any of these hands the equaliser's drag to the rail.
    for guarded in ("canvas", ".range", ".bar", ".q-knob",
                    ".sheet", ".slot-menu", ".pick-list", "textarea"):
        assert guarded in body, (
            "%s no longer keeps its sideways drag, so the rail will slide instead of it"
            % guarded)
    # And the two conditional ones are measured rather than assumed.
    assert "children.length > 1" in body, "a one card deck is treated as a carousel again"
    assert "scrollWidth" in body, "a strip that fits is treated as scrollable again"

    # The old blanket gate is gone and must not come back.
    assert "hasAPressOfItsOwn" not in boot, (
        "the rail refuses the gesture on anything pressable again, which on a song page "
        "is nearly everything")


def test_the_dither_is_a_dither_and_not_a_grain_overlay():
    """Four properties, and the first version of this layer got three of them wrong.

    It was an feTurbulence tile drawn at half its size and blended with overlay, and it
    did nothing to the banding. Measured against a near black ramp it left seven of
    fourteen band edges standing, while two levels of additive noise left none.

    ADDITIVE. overlay multiplies: on a base darker than half it comes out as the base
    times one plus or minus the texel, so the amount of dither is proportional to how
    bright the pixel already is. This app is almost black, so that is almost nothing
    exactly where the banding is worst, and it is why the banding came and went with the
    artwork rather than looking like a constant fault.

    PER PIXEL. Neighbouring pixels have to get independent values or there is nothing to
    break a level boundary with. That means the texture is generated one texel per device
    pixel and drawn at its own size.

    NEVER RESAMPLED. A browser scales a background image with a bilinear filter, which is
    a low pass filter, which averages each texel with its neighbours and destroys the
    per pixel variation. image-rendering: pixelated is the whole mechanism, not a style.

    TRIANGULAR. The same distribution used to dither audio, and for the same reason: it
    makes the rounding error independent of the value, where uniform noise leaves a faint
    correlated pattern along a slow ramp.
    """
    with open(os.path.join(JS_DIR, "19-dither.js"), encoding="utf-8") as f:
        dither = f.read()
    css = "\n".join(open(os.path.join(CSS_DIR, n), encoding="utf-8").read()
                    for n in sorted(os.listdir(CSS_DIR)) if n.endswith(".css"))
    grain = re.search(r"\.grain\s*\{[^}]*\}", css)
    assert grain, "the dither layer has no rule"
    grain = grain.group(0)

    # Additive, with the multiplicative one only as a fallback the module chooses.
    assert "plus-lighter" in dither, (
        "the dither no longer blends additively, so it will do nothing in the darks, "
        "which is where the banding is")
    assert "mix-blend-mode: var(--dither-blend" in grain, (
        "the blend mode is fixed in CSS again, so the module cannot pick the additive "
        "one where it is available")

    # Never smoothed on the way to the screen.
    assert "image-rendering: pixelated" in grain, (
        "the tile will be bilinearly resampled, which averages away the per pixel "
        "variation that does the dithering")

    # One texel per device pixel: the size comes from the module, divided by the ratio.
    assert "devicePixelRatio" in dither and "TILE / dpr" in dither, (
        "the tile is no longer sized to device pixels, so one texel no longer lands on "
        "one physical pixel")
    assert "--dither-size" in grain and "--dither-size" in dither

    # Triangular, not uniform. Two uniforms summed is the whole of it.
    assert "Math.random() + Math.random()" in dither, (
        "the noise is no longer triangular, so the rounding error is correlated with the "
        "value again")

    # And the thing that did not work is gone.
    assert "feTurbulence" not in grain, (
        "the grain layer is back to an SVG turbulence tile, which is not a dither")


def test_a_media_query_is_not_undone_by_a_rule_written_after_it():
    """The cascade bug that broke the renders list on a phone.

    A media query carries no specificity of its own. `@media (max-width: 640px) { .r-wave
    { display: none } }` and a plain `.r-wave { display: block }` are the same weight, so
    whichever comes last in the file wins, and the plain rule was two hundred lines
    further down. The column that was meant to disappear on a phone never did: the row
    overflowed its panel by ninety six pixels and the buttons hung off the right edge
    where nothing could reach them.

    Nothing in a browser reports this. The rule is there, it is valid, the media query
    matches, and it loses anyway.

    Only rules OUTSIDE every media block count as overriding, which is the correction the
    first version of this test needed: it searched all the text after a block and so
    reported a wide screen rule being followed by a narrow screen rule for the same
    selector, which is two conditions that are never both true and is how this file is
    supposed to be written.
    """
    trouble = {}
    for name in sorted(os.listdir(CSS_DIR)):
        if not name.endswith(".css"):
            continue
        with open(os.path.join(CSS_DIR, name), encoding="utf-8") as f:
            text = f.read()
        # Comments out, so a selector quoted in prose is not read as a rule.
        text = re.sub(r"/\*.*?\*/", "", text, flags=re.S)

        # The media blocks, found by counting braces rather than by matching a closing
        # one: a nested rule ends with the same character the block does, and a regex
        # cannot tell those apart.
        blocks = []
        for opener in re.finditer(r"@media[^{]*\{", text):
            depth, at = 1, opener.end()
            while at < len(text) and depth:
                if text[at] == "{":
                    depth += 1
                elif text[at] == "}":
                    depth -= 1
                at += 1
            blocks.append((opener.start(), at, text[opener.end():at - 1]))

        def inside_a_block(where):
            return any(lo <= where < hi for lo, hi, _ in blocks)

        # Every rule outside every media block that sets display, and where it sits.
        plain = []
        for rule in re.finditer(r"([^{}@]+)\{([^{}]*)\}", text):
            if inside_a_block(rule.start()):
                continue
            if "display" in rule.group(2):
                plain.append((rule.start(), rule.group(1).strip()))

        for _, ends, inner in blocks:
            for rule in re.finditer(r"([^{}]+)\{([^{}]*)\}", inner):
                if "display" not in rule.group(2):
                    continue
                selector = rule.group(1).strip()
                for at, other in plain:
                    # >= and not >: a rule sitting immediately after the block starts
                    # at the block's own end index, because the selector match swallows
                    # the newline between them. With > this test could not see the very
                    # bug it was written for.
                    if other == selector and at >= ends:
                        trouble.setdefault(name, []).append(selector)
    assert not trouble, (
        "these media queries set display on a selector that a later rule outside every "
        "media block sets display on again, so the media query silently loses on source "
        "order: %s" % trouble)
