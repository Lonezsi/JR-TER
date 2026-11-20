"""The browser side, checked against the server it talks to.

None of this runs the interface. It checks the contracts that break silently: an endpoint
renamed on one side, a module the interface asks for that does not exist, a stylesheet the
page never links. The interface is Svelte and TypeScript in ui/src, built into web/, so
these read ui/src (the source of truth) and the pre-login pages in web/.
"""
import os
import re
import pathlib
import urllib.error

import pytest

from jriter import config, registry
from jriter.http import resolve

WEB = config.WEB
CSS_DIR = os.path.join(WEB, "css")
SRC = os.path.join(os.path.dirname(WEB), "ui", "src")


def _source_files(*exts):
    for here, dirs, names in os.walk(SRC):
        dirs[:] = [d for d in dirs if d != "node_modules"]
        for name in sorted(names):
            if name.endswith(exts):
                yield os.path.join(here, name)


def _read(path):
    with open(path, encoding="utf-8") as f:
        return f.read()


def _code(text):
    """Comments out, because they name the very things being looked for."""
    text = re.sub(r"/\*.*?\*/", "", text, flags=re.S)
    text = re.sub(r"<!--.*?-->", "", text, flags=re.S)
    return re.sub(r"^\s*//.*$", "", text, flags=re.M)


def _all_source():
    return "\n".join(_code(_read(p)) for p in _source_files(".ts", ".svelte"))


def test_every_endpoint_the_page_calls_exists():
    """A renamed route shows up as a section of the page that is silently empty on a
    machine in another room. Only a test notices."""
    # The whole app, including the door, since the page calls that too.
    registry.load(config.MODULES)
    called = set()
    # Every string or template literal that starts with /api/, wherever it is used: through
    # get, post, put, patch, del, upload, api or fetch makes no difference to whether the
    # route exists.
    for path in _source_files(".ts", ".svelte"):
        called.update(re.findall(r"[`\"'](/api/[^`\"'\s]*)", _code(_read(path))))

    # Template literals carry an id in the middle; the shape is what matters.
    def normalise(path):
        path = re.sub(r"\$\{[^{}]*\}", "1", path)
        # A nested template (a ${...} containing its own backticks) cannot be matched by
        # a regex. Everything before it is still a real route prefix, so cut there.
        if "${" in path:
            path = path.split("${")[0]
        return path.split("?")[0].rstrip("/")

    assert len(called) > 100, "found almost no calls, so this proves nothing: %d" % len(called)
    missing = []
    for raw in sorted(called):
        path = normalise(raw)
        # The guest doorway is a prefix api.ts puts in front of an owner's route while
        # guesting (/api/shared/<share>/on/<route>); what follows it is checked as the
        # owner's route above, and the doorway itself in test_sharing.
        if path.startswith("/api/shared/1/on"):
            continue
        found = any(resolve(method, path)[0] for method in
                    ("GET", "POST", "PUT", "PATCH", "DELETE"))
        if not found:
            missing.append(path)
    assert not missing, "the page calls endpoints the server does not have: %s" % missing


def test_the_endpoints_each_feature_needs_are_still_called():
    """Named one by one, so deleting a chunk of a view fails here rather than quietly
    reducing what the app can do."""
    text = _all_source()
    for path in ("/api/state", "/api/songs", "/api/versions/", "/api/albums",
                 "/api/sync/scan", "/api/sync/import", "/api/update/check",
                 "/api/update/now", "/api/settings", "/api/renders", "/api/lyrics",
                 "/api/search"):
        assert path in text, "nothing calls %s any more" % path


def test_the_page_asks_the_server_what_exists_before_drawing_it():
    """Switching a module off in config has to remove it from the interface too, or the
    UI shows a button that returns 404."""
    song = _code(_read(os.path.join(SRC, "views", "Song.svelte")))
    assert 'song.has("lyrics")' in song and 'song.has("sound")' in song, \
        "the song page assumes every module is on"
    app = _read(os.path.join(SRC, "lib", "app.svelte.ts"))
    assert "app.modules" in app and "export const has" in app


def test_the_modules_the_ui_expects_are_the_modules_that_exist():
    registry.load()
    text = _all_source()
    named = set(re.findall(r'\bhas\("(\w+)"\)', text))
    named |= set(re.findall(r'modules\.includes\("(\w+)"\)', text))
    assert len(named) >= 10, "found almost no module checks, so this proves nothing: %s" % named
    unknown = named - set(config.MODULES)
    assert not unknown, "the UI checks for modules that do not exist: %s" % unknown


# ── the shell ────────────────────────────────────────────────────────────────
def test_the_page_loads_the_typefaces_and_the_shared_glass():
    page = _read(os.path.join(WEB, "index.html"))
    assert '"/glass.css"' in page
    # The stylesheet link itself, not merely a mention: the css2 request specifically. A
    # preconnect hint to the same host is not a request for a typeface, and matching it
    # makes this pass while loading nothing.
    link = re.search(r'<link[^>]+fonts\.googleapis\.com/css2\?[^>]*>', page)
    assert link, "the typefaces are never fetched"
    for family in ("Orbitron", "Manrope"):
        assert "family=" + family in link.group(0), "%s is not requested" % family


def test_the_bundles_are_not_empty():
    from jriter.http import bundle
    assets = os.path.join(WEB, "assets")
    js = sum(os.path.getsize(os.path.join(assets, n)) for n in os.listdir(assets)
             if n.endswith(".js"))
    css = sum(os.path.getsize(os.path.join(assets, n)) for n in os.listdir(assets)
              if n.endswith(".css"))
    assert css > 20000, "the interface's stylesheet is suspiciously small"
    assert js > 100000, "the interface's script is suspiciously small"
    # And what the server bundles for the pages in front of the door.
    assert len(bundle(CSS_DIR, ".css")) > 4000, "the pre-login stylesheet is suspiciously small"


def test_every_screen_the_router_can_name_is_drawn_by_the_shell():
    """A route nothing draws is a link that opens the missing screen. And a screen file the
    shell never imports is a file that should have been deleted."""
    router = _code(_read(os.path.join(SRC, "lib", "router.svelte.ts")))
    union = router[router.index("export type View ="):router.index(";", router.index("export type View ="))]
    views = set(re.findall(r'"(\w+)"', union)) - {"missing"}
    shell = _code(_read(os.path.join(SRC, "shell", "Shell.svelte")))
    table = shell[shell.index("const VIEWS"):]
    table = table[:table.index("};")]
    drawn = set(re.findall(r"(\w+):\s*\w+", table))
    assert views <= drawn, "the router names screens the shell does not draw: %s" % sorted(views - drawn)
    for name in os.listdir(os.path.join(SRC, "views")):
        if name.endswith(".svelte"):
            assert "views/%s" % name in shell, "%s is a screen the shell never imports" % name


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

    A NAME HALF MADE OF AN EXPRESSION IS NOT A NAME. class="tt-card tt-${entry.kind}"
    leaves `tt-` behind once the expression is gone, and `tt-` is not a class anybody
    styles: the real ones are tt-ea, tt-gy and tt-both. So the expression leaves a mark
    where it was, and a token still touching that mark is a fragment and is dropped. A
    token with whitespace between it and the mark is a whole name and is kept, which is
    the ordinary class="a ${x} b" case this has always handled.
    """
    # Stands in for a stripped expression. Not a character that can appear in a class
    # attribute, so a token containing it is a token the expression was part of.
    MARK = "\x00"
    # Far longer than any class attribute here, and short enough that a missing closing
    # quote reads the rest of one line rather than the rest of the file.
    LIMIT = 600
    elements = []
    # WALKED, NOT MATCHED. class="([^"]*)" ends at the first double quote, and a quote
    # inside an expression is one:
    #
    #     class="${cond ? "a" : "b"} panel"
    #
    # The regex reads that attribute as far as the quote before `a`, so `panel` is never
    # seen, and a name this cannot see is a name it says nothing about, which is the worst
    # thing a guard can do quietly. A quote at depth zero ends the attribute; a quote
    # inside ${...} does not.
    #
    # Measured: on this tree it changes nothing, 437 classes either way. Nothing here puts
    # a literal name after a quoted expression yet. It is written this way because the
    # difference between the two is invisible when it starts mattering.
    for found in re.finditer(r'class="', text):
        depth, out = 0, []
        i = found.end()
        stop = min(len(text), i + LIMIT)
        while i < stop:
            if text.startswith("${", i):
                if not depth:
                    out.append(MARK)
                depth += 1
                i += 2
                continue
            if depth:
                if text[i] == "{":
                    depth += 1
                elif text[i] == "}":
                    depth -= 1
                i += 1
                continue
            if text[i] == '"':
                break
            out.append(text[i])
            i += 1
        names = [n for n in "".join(out).split() if n and MARK not in n]
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


def test_a_sample_library_is_never_offered_as_a_render():
    """The whole reason a watched folder has a kind.

    Marking a library as sync keeps it out of the list of folders a scan walks, which is
    NOT the same as keeping its files out of a scan. A library living inside a collector
    is the ordinary case if you keep samples and bounces under one music folder, and the
    collector walked straight into it: measured on a library of seven one shots, seven
    new renders.
    """
    import time
    from jriter import db
    from jriter.modules import sync

    top = os.path.join(config.DATA, "music")
    library = os.path.join(top, "samples", "kicks")
    os.makedirs(library, exist_ok=True)
    for n in range(4):
        with open(os.path.join(library, "kick_%d.wav" % n), "wb") as f:
            f.write(b"\x00" * 64)
    with open(os.path.join(top, "a real bounce.wav"), "wb") as f:
        f.write(b"\x00" * 64)

    db.insert("sync_folders", {"path": top, "enabled": 1, "kind": sync.COLLECTOR,
                               "created_at": time.time()})
    db.insert("sync_folders", {"path": os.path.join(top, "samples"), "enabled": 1,
                               "kind": sync.SYNC, "created_at": time.time()})

    libraries = [row["path"] for row in
                 db.query("SELECT path FROM sync_folders WHERE kind = ?", (sync.SYNC,))]
    found = sorted(os.path.basename(p) for p in sync._walk(top, libraries))
    assert found == ["a real bounce.wav"], (
        "the collector reached into the sample library: %s" % found)

    # And without the exclusion it plainly would, so the check above is not vacuous.
    everything = sorted(os.path.basename(p) for p in sync._walk(top))
    assert len(everything) == 5, everything


def test_a_request_body_can_be_read_more_than_once(server):
    """The body is a socket, so reading it twice used to read it once and then read nothing.

    The second call got an empty string and raised "that request body is not JSON", which is
    a true sentence about an empty string and a thoroughly misleading thing to be told about
    a request that was perfectly good. Found by writing a handler that checked one field
    before using the rest, which is an obvious way to write one, so the fix is here rather
    than in that handler.
    """
    from jriter.wire import Request

    class Socket:
        """A body that can only be handed over once, like the real one."""

        def __init__(self, raw):
            self.raw = raw
            self.reads = 0

        def read(self, n):
            self.reads += 1
            out, self.raw = self.raw[:n], self.raw[n:]
            return out

    raw = b'{"subject": "Logika Gy", "absences": 2}'
    body = Socket(raw)
    req = Request("PUT", "/api/orarend/notes", {},
                  {"Content-Length": str(len(raw))}, body)

    first = req.json()
    second = req.json()
    assert first == second == {"subject": "Logika Gy", "absences": 2}
    assert body.reads == 1, (
        "the body was read %d times. Every read after the first gets what is left of a"
        " stream that has already been drained." % body.reads)


def test_editing_an_arrangement_does_not_reschedule_the_audio_on_every_move():
    """Trimming a clip while it plays used to tear down every scheduled source and build
    ten new ones on each pointermove: about seven hundred buffer sources over one drag,
    a three quarter second stall, and audio that restarted continuously while you were
    trying to listen to the edit.

    Every edit therefore goes through resync(), which coalesces, rather than calling
    seek() straight through to the scheduler.
    """
    arrange = _code(_read(os.path.join(SRC, "lib", "audio", "arrange.svelte.ts")))

    assert "resync() {" in arrange and "resyncTimer = setTimeout(" in arrange, \
        "the coalescing reschedule is gone"
    # The editing methods are the ones that must not reschedule immediately.
    for name in ("move", "duplicate", "remove", "resize", "setTempo", "setOffset"):
        body = re.split(r"\n  %s\(" % name, arrange, maxsplit=1)
        assert len(body) == 2, "%s is no longer an editing method here" % name
        # Up to the next method at the same indentation.
        chunk = re.split(r"\n  \w+\(", body[1], maxsplit=1)[0]
        assert "arrange.seek(" not in chunk and "this.seek(" not in chunk, (
            "%s reschedules straight away; a drag calls it once per frame" % name)


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
    text = _code(_read(os.path.join(SRC, "lib", "player.svelte.ts")))

    at = text.index('audio.addEventListener("loadedmetadata", async () => {')
    body = text[at:text.index("\n    });", at)]

    assert "currentSrc" in body, (
        "the correction does not check which file the element actually decoded, so it "
        "can write one version's duration onto another")
    assert body.index("currentSrc") < body.index("patch("), \
        "the check has to come before the write, or it is not a guard"


# ── what is behind the glass ─────────────────────────────────────────────────

def _ambient():
    return _code(_read(os.path.join(SRC, "lib", "ambient.ts")))


def test_the_dust_stops_completely():
    """Every listener the field adds has to come off again.

    This is the failure this project keeps repeating: an interval nobody cleared, a
    listener that outlived its panel, a watcher inventing songs on a timer. The field
    runs behind backdrop filtered glass, so one that carries on after a song's artwork
    opens is not a stray callback, it is the compositor re running a displacement map and
    a 22px blur over the rail and the player for ever.
    """
    text = _ambient()
    # halt() is the teardown. stop() is the page saying it no longer wants any, and the
    # dial going to nought is the other caller: both end here, and this is the one place
    # that has to give everything back.
    halt = text[text.index("function halt()"):text.index("function stop()")]
    for gone in ("cancelAnimationFrame",
                 'removeEventListener("visibilitychange"',
                 'removeEventListener("change"',
                 "canvas.remove()"):
        assert gone in halt, "ambient.ts halt() does not do %s" % gone
    stop = text[text.index("function stop()"):text.index("function begin(")]
    assert "halt()" in stop, "stop() no longer tears anything down"
    assert "if (!power) { halt(); return; }" in text, "the dial at nought does not tear it down"
    assert "if (motion?.matches) return;" in text[text.index("function begin("):], \
        "ambient.ts starts the loop without checking prefers-reduced-motion"


def test_the_dust_is_only_there_when_no_artwork_is():
    """The whole point is that it fills the room a song's picture would have filled.
    Left running under artwork it is a full screen canvas repainting under the glass for
    something nobody can see."""
    text = _code(_read(os.path.join(SRC, "lib", "look.svelte.ts")))
    start = text.index("export function setGround")
    ground = text[start:text.index("\n}\n", start)]
    assert "if (url) dust.stop(); else dust.start(hue);" in ground, \
        "setGround no longer turns the dust off when a song has artwork"


def test_the_dust_only_draws_where_there_is_glass():
    """It is not something on the page, it is something the glass finds behind it.

    Drawn across the whole viewport it also showed through the main panel, which is solid
    on the library screens and translucent on a song page, so the same effect was subtle
    in one place and a field of specks over the words in another.
    """
    text = _ambient()
    assert 'const GLASS = "#shell .glass";' in text
    draw = text[text.index("function draw("):]
    draw = draw[:draw.index("\n  }\n")]
    assert "clipToGlass(g)" in draw and "g.clip()" in draw, \
        "draw() no longer clips the specks to the glass"
    # And nothing is drawn when there is none, rather than everything being drawn.
    assert "if (!clipToGlass(g)) { g.restore(); return; }" in draw


def test_the_dust_is_white():
    """It was the accent, and through glass that already carries the accent everywhere
    that read as a green cast on the rail rather than as specks."""
    text = _ambient()
    tint = text[text.index("function tint()"):]
    tint = tint[:tint.index("\n  }")]
    assert "rgba(255, 255, 255" in tint
    assert "--accent" not in tint and "hsla(" not in tint, \
        "the dust is taking a colour from somewhere again"


def test_the_dither_is_a_dither_and_not_a_grain_overlay():
    """Four properties, and the first version of this layer got three of them wrong.

    It was an feTurbulence tile drawn at half its size and blended with overlay, and it
    did nothing to the banding. Measured against a near black ramp it left seven of
    fourteen band edges standing, while two levels of additive noise left none.

    ADDITIVE. overlay multiplies: on a base darker than half it comes out as the base
    times one plus or minus the texel, so the amount of dither is proportional to how
    bright the pixel already is. This app is almost black, so that is almost nothing
    exactly where the banding is worst.

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
    dither = _ambient()
    dither = dither[dither.index("function makeDither()"):]

    # Additive, with the multiplicative one only as a fallback the module chooses.
    assert 'mixBlendMode = "plus-lighter"' in dither, (
        "the dither no longer blends additively, so it will do nothing in the darks, "
        "which is where the banding is")
    assert 'CSS.supports("mix-blend-mode", "plus-lighter")' in dither

    # Never smoothed on the way to the screen.
    assert "image-rendering:pixelated" in dither, (
        "the tile will be bilinearly resampled, which averages away the per pixel "
        "variation that does the dithering")

    # One texel per device pixel: the size comes from the module, divided by the ratio.
    assert "window.devicePixelRatio" in dither and "TILE / dpr" in dither, (
        "the tile is no longer sized to device pixels, so one texel no longer lands on "
        "one physical pixel")

    # Triangular, not uniform. Two uniforms summed is the whole of it.
    assert "Math.random() + Math.random()" in dither, (
        "the noise is no longer triangular, so the rounding error is correlated with the "
        "value again")

    # And the thing that did not work is gone.
    assert "feTurbulence" not in dither, (
        "the grain layer is back to an SVG turbulence tile, which is not a dither")


# ── what the dials send ──────────────────────────────────────────────────────

def test_every_dial_in_settings_is_a_setting_the_server_will_take(server):
    """put_settings has an allowlist, and a key missing from it is rejected outright.

    Which sounds safe, and is the opposite: a patch with one unlisted key fails the whole
    save. Add a dial, forget the allowlist, and Save stops working for the accent colour
    too. Nearly shipped exactly that with the dither dial.

    The keys are read out of the interface's own idea of what a setting is (the Settings
    type in lib/types.ts, which saveSettings is typed against), so a new dial is covered
    the moment it exists.
    """
    types = _code(_read(os.path.join(SRC, "lib", "types.ts")))
    block = types[types.index("export interface Settings {"):]
    block = block[:block.index("\n}")]
    keys = set(re.findall(r"^\s*(\w+)\??:", block, re.M))
    assert "glass_edge" in keys and "dust" in keys and "dither" in keys, \
        "the dials moved; this test is stale"

    status, before = server.get("/api/settings")
    assert status == 200
    # Sent as one patch and then one key at a time, so an unlisted key fails here the way
    # it would fail there, and the one that does is named.
    patch = {k: before.get(k) for k in keys if before.get(k) is not None}
    assert len(patch) >= 4, "read almost nothing out of the interface: %s" % sorted(keys)
    status, said = server.put("/api/settings", patch)
    assert status == 200, said
    for key, value in sorted(patch.items()):
        status, said = server.put("/api/settings", {key: value})
        assert status == 200, "%s is not a setting the server will take: %s" % (key, said)


def test_no_web_asset_carries_a_stray_control_character():
    """An escape that was eaten before it reached the browser.

    A rule meant to put an arrow before a song name was written with a CSS escape for
    U+2192, and what landed in the file was chr(17) followed by a literal "92". The tool
    that wrote it reads backslash-2-1 as an octal escape, so the mangling happened before
    CSS was ever involved. It shipped, and on the page it read as a stray glyph and two
    digits sitting in front of the song title.

    Nothing else would have caught it. The file parses, the rule is valid, the property
    applies, and the value is simply the wrong characters. A control character in a source
    or built asset is never intentional here, so its presence is the whole test.
    """
    allowed = {"\t", "\n", "\r"}
    trouble = {}
    paths = []
    for folder in (CSS_DIR, os.path.join(WEB, "assets"), WEB):
        for name in sorted(os.listdir(folder)):
            path = os.path.join(folder, name)
            if os.path.isfile(path) and os.path.splitext(name)[1] in (".css", ".js", ".html", ".svg"):
                paths.append(path)
    paths += list(_source_files(".ts", ".svelte", ".css"))
    for path in paths:
        text = _read(path)
        for at, ch in enumerate(text):
            if ord(ch) < 32 and ch not in allowed:
                line = text.count("\n", 0, at) + 1
                trouble.setdefault(os.path.relpath(path, os.path.dirname(WEB)), []).append(
                    "line %d: %r" % (line, ch))
    assert not trouble, (
        "these web assets carry control characters, which is always an escape that was "
        "eaten on the way in rather than anything anybody typed: %s" % trouble)
