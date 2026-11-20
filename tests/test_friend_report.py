"""The things somebody else found, on a Mac and an iPhone.

A friend went through JR!TER on hardware I do not have and wrote down eighteen things. Both
of their machines run WebKit, which is why a third of the list turned out to be one fault:
the glass. Everything here is one of their items, and each one is written down because a
test is the only thing that stops a fix like this quietly coming undone.

Their words are kept, in Hungarian, where the wording is the evidence.
"""
import io
import os
import re

import pytest

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CSS = os.path.join(HERE, "web", "css")
#: The material, which is not in this repo any more.
#:
#: bundle() serves this in front of web/css, so the tokens below are as much a part of
#: what the app sends as anything in it. A sibling checkout, matching how the machine is
#: laid out and what jriter/config.py defaults to.
MATERIAL = os.path.join(os.path.dirname(HERE), "foyer", "shared", "glass.css")



def css(name):
    return io.open(os.path.join(CSS, name), encoding="utf-8").read()


def every_css():
    """Every stylesheet this app serves, the shared material included.

    bundle() puts the material in front of web/css, so a helper that listed only web/css
    was looking at part of what the browser gets and drawing conclusions about all of it.
    """
    out = {n: css(n) for n in sorted(os.listdir(CSS)) if n.endswith(".css")}
    if os.path.isfile(MATERIAL):
        out["glass.css (shared)"] = io.open(MATERIAL, encoding="utf-8").read()
    return out


def material():
    """The shared stylesheet, whole.

    Most callers want one token and should use token(), which asks both files. This is for
    the one test that needs the material as a document: it splits it at the engine gate and
    checks the half on either side, which is a question about the file's shape.
    """
    return io.open(MATERIAL, encoding="utf-8").read()


def token(name):
    """One custom property's value, from whichever served stylesheet defines it.

    It used to read 00-tokens.css, which held every token. Most of them are in the shared
    material now, and which of the two a name lives in is a fact about the split rather
    than about the token, so this asks both in the order the browser sees them.
    """
    for source in (io.open(MATERIAL, encoding="utf-8").read()
                   if os.path.isfile(MATERIAL) else "", css("00-tokens.css")):
        found = re.search(r"^\s*%s:\s*([^;]+);" % re.escape(name), source, flags=re.M)
        if found:
            return found.group(1).strip()
    raise AssertionError("no %s token in the shared material or in this app's own" % name)


# ── the glass, which was three of their reports ──────────────────────────────

BLINK_GATE = "@supports (background: paint(x)) or (-webkit-app-region: no-drag)"


def test_the_refraction_is_only_asked_for_behind_the_engine_gate():
    """"sotet modban kicsit sok a modalok attetszosege", "a legordulo listak is nagyon
    rosszul latszodnak", "a menu nagyon atlatszo, olvashatatlan".

    One cause for all three: the chain led with url(#glass), one unsupported function
    invalidates the whole declaration, and WebKit parses that reference, reports it
    supported, and never renders it. The app lost its blur with no fallback, and no way to
    detect any of it.

    The refraction is what this app looks like, so it is not gone: it is asked for only
    inside a block gated on an engine known to draw it. Written that way round on purpose.
    Refusing it only where it is known to fail would leave every future engine defaulting
    to broken, and broken here is invisible to feature detection.
    """
    # The material, not this app's own tokens. The gate is part of the glass, and the glass
    # is shared with Foyer now, so a copy of this rule living in JR!TER would be a second
    # answer to the same question about the same engine.
    tokens = material()
    assert tokens.count(BLINK_GATE) == 1, "one gate, spelled exactly once"

    base, gated = tokens.split(BLINK_GATE, 1)
    # The half before the gate is the fallback, and it has to survive an engine that
    # cannot render a reference at all.
    for chain in ("--glass-filter", "--glass-filter-thin", "--glass-filter-edge"):
        assert "url(" not in token(chain), \
            "%s asks for a reference outside the gate" % chain
    assert "url(#glass" not in base, "the fallback half must not name an SVG filter"
    # Inside it there is no reference either, any more. Blink drew the SVG filter inside a
    # backdrop-filter in raster tiles, and the tile seams showed as blurred lines that
    # popped in and out wherever something repainted, on every page of both sites. They
    # were never in a screenshot, which re-renders the page in one pass. The bend went and
    # the gate stayed: it still decides who gets the lighter tints below, and the
    # chromatic dial still asks it before writing #glass-ca by hand.
    block = gated.split("\n}\n", 1)[0]
    for chain in ("--glass-filter:", "--glass-filter-thin:", "--glass-filter-edge:"):
        line = next(l for l in block.splitlines() if l.strip().startswith(chain))
        assert "url(" not in line, "%s refracts again: %s" % (chain, line.strip())
    # Along with the light tints, which are what glass actually looks like.
    assert "rgba(255, 255, 255, 0.055)" in gated
    assert "rgba(255, 255, 255, 0.085)" in gated


def test_glass_is_a_surface_without_a_blur():
    """The tint used to be a white film: five per cent for the chrome, eight and a half for
    dialogs. All the legibility came from the filter behind it, so a browser that skipped
    the filter showed a dialog you had to work out. Dark and mostly opaque now."""
    for name in ("--glass", "--glass-2"):
        value = token(name)
        found = re.match(r"rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([0-9.]+)\s*\)",
                         value)
        assert found, "%s should be an rgba so the alpha is readable: %s" % (name, value)
        r, g, b, a = (int(found.group(1)), int(found.group(2)),
                      int(found.group(3)), float(found.group(4)))
        assert r < 60 and g < 60 and b < 60, \
            "%s is a light film again (%s), which is fog on a black ground" % (name, value)
        assert a >= 0.7, "%s at %s is see through with no blur to help" % (name, a)
    # Dialogs and menus carry text you are reading now, so they are the more solid of the two.
    assert float(re.search(r",\s*([0-9.]+)\)", token("--glass-2")).group(1)) >= 0.9


def test_the_fallback_probe_names_something_honest():
    base = css("10-base.css")
    assert "@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px)))" \
        in base, "the probe has to cover the prefixed property too"
    assert "@supports not (backdrop-filter: url(" not in base, \
        "probing the reference is what failed: WebKit says yes and draws nothing"


# ── the accent, which their screenshot gave away ─────────────────────────────

def _favicon():
    """The generator, imported rather than read, so the mark itself can be asked."""
    import importlib.util
    path = os.path.join(HERE, "web", "img", "make-favicon.py")
    spec = importlib.util.spec_from_file_location("make_favicon", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_the_icon_draws_both_marks():
    """The joke the name is built on: a rest is the instruction to play nothing and it is
    standing next to the loudest punctuation there is. An icon that is only the exclamation
    throws that away, which is what it had become.

    Asked of the drawing rather than of the source, because "the constant is still named
    ZIGZAG" is true of an icon that draws neither of them.
    """
    f = _favicon()
    size = 100
    ink = [(x, y) for y in range(size) for x in range(size)
           if f._mark(x + 0.5, y + 0.5, size) is not None]
    assert ink, "the tile has no glyph on it at all"

    left = [p for p in ink if p[0] < f.BANG_MID_X - f.BANG_W]
    right = [p for p in ink if p[0] > f.BANG_MID_X - f.BANG_W]
    assert len(left) > 200, "no rest: %d pixels left of the exclamation" % len(left)
    assert len(right) > 200, "no exclamation: %d pixels right of the rest" % len(right)

    # The rest is a zigzag: going down it, the stroke reverses direction more than once.
    # Wander on its own is not enough to say that, because the hook at the bottom wanders
    # too, and a plain vertical bar with that hook on it passed an earlier version of this.
    middles = []
    for y in range(14, 74, 3):
        row = [x for x, ry in ink if ry == y and x < f.BANG_MID_X - f.BANG_W]
        if row:
            middles.append((min(row) + max(row)) / 2.0)
    assert len(middles) >= 15, "the rest does not run the height of the tile"

    steps = [b - a for a, b in zip(middles, middles[1:]) if abs(b - a) > 0.5]
    turns = sum(1 for a, b in zip(steps, steps[1:]) if (a > 0) != (b > 0))
    assert turns >= 2, \
        "the left mark changes direction %d times; a rest zigzags, a bar does not" % turns

    # The exclamation is a bar with a gap and then a dot under it.
    rows = sorted({y for x, y in right})
    gaps = [b for a, b in zip(rows, rows[1:]) if b - a > 1]
    assert gaps, "the exclamation has no gap, so it is one solid stroke"


def test_the_rest_still_zigzags_at_the_size_it_is_smallest():
    """A tab icon is sixteen pixels and the rest had stopped being a rest at that size.

    Every other icon test asks the 100px drawing, where three legs and a curl have room,
    and all of them passed while the 16 was mud.

    Measured off the rendered mark, not off the constants. The first version of this test
    asserted that REST_SMALL swings wider than its stroke, which is true whether or not
    the 16 is drawn with it, so pointing the 16 back at the fine path left the test green.

    The number that separates them is the ratio of sideways travel to stroke thickness. A
    zigzag is only visible while the centreline moves further across than the line drawing
    it is wide; below that the legs overlap and close into a bar with a bump on it. The
    fine path at 16 gives 1.19 and the small cut gives 1.88.
    """
    f = _favicon()
    size = 16
    fine = 8                      # subpixel samples per pixel, per axis

    rows = []
    for sy in range(size * fine):
        y = (sy + 0.5) / fine
        xs = [(sx + 0.5) / fine for sx in range(size * fine // 2)
              if f._mark((sx + 0.5) / fine, y, size) is not None]
        if xs:
            rows.append((min(xs), max(xs)))
    assert rows, "nothing is drawn where the rest goes at 16"

    mids = [(a + b) / 2.0 for a, b in rows]
    widths = sorted(b - a for a, b in rows)
    swing = max(mids) - min(mids)
    # The thinnest run is the stroke; the turns and the hook are wider than it.
    stroke = widths[len(widths) // 10]

    assert swing / stroke > 1.5, (
        "at 16 the rest travels %.2fpx across against a %.2fpx stroke, a ratio of %.2f."
        " Below about 1.5 the legs overlap and it closes into a bar, which is the half of"
        " the mark that carries the joke. The fine path scores 1.19 here and the two"
        " legged cut scores 1.88." % (swing, stroke, swing / stroke))


def test_the_icon_is_a_real_file_at_the_sizes_that_get_asked_for():
    ico = os.path.join(HERE, "web", "favicon.ico")
    assert os.path.getsize(ico) > 2000
    with open(ico, "rb") as f:
        head = f.read(6)
    assert head[:4] == b"\x00\x00\x01\x00", "an icon directory"
    assert head[4] == len(_favicon().SIZES), "16 for a tab, 32, 48, and 256 for Explorer"


# ── repeat, which was there and said otherwise ───────────────────────────────

def test_the_defaults_are_served_from_the_table_the_server_falls_back_to():
    config = io.open(os.path.join(HERE, "jriter", "config.py"), encoding="utf-8").read()
    assert "def defaults():" in config
    assert "return dict(_DEFAULTS)" in config, "a copy, so a caller cannot edit the table"
    core = io.open(os.path.join(HERE, "jriter", "modules", "core.py"),
                   encoding="utf-8").read()
    assert '("GET", "/api/settings/defaults"): get_defaults,' in core


# ── emptying a set of words ──────────────────────────────────────────────────

def _a_song(server):
    _, made = server.post("/api/songs", {"title": "Ordinary Weather"})
    return made["song"]["id"]


def test_deleting_every_word_takes_the_title_with_it(server):
    """"nem kezeli jol, ha ugy szerkesztem ezt a resz, hogy kitorlok mindent. Egyreszt nem
    torli ki, hanem az elozo szoveget mutatja ugyanugy, illetve a historyban irja hogy 0
    karakter, de felul nem 0 karaktert jelenit meg."

    A sheet is called whatever its first line says, and the name was only rewritten when
    there was a line to read: emptying one left the old first line sitting on the card as
    its heading. So the card read as the previous words with the body missing, under a
    revision the history correctly marked as nought characters.
    """
    song_id = _a_song(server)
    _, made = server.post("/api/songs/%d/lyrics" % song_id, {"text": "a chorus\nand more"})
    sheet_id = made["sheet"]["id"]

    _, listing = server.get("/api/songs/%d/lyrics" % song_id)
    assert listing["lyrics"][0]["name"] == "a chorus"

    _, emptied = server.put("/api/lyrics/%d/text" % sheet_id, {"text": ""})
    assert emptied["saved"] is True
    assert emptied["sheet"]["text"] == ""
    assert emptied["sheet"]["name"] != "a chorus", \
        "the heading is the words that were deleted"
    assert emptied["sheet"]["name"] == "v1", "back to what an unwritten sheet is called"


def test_an_emptied_sheet_is_named_for_where_it_sits(server):
    """The two above only ever empty the first sheet, where v1 is right by accident.

    Written after breaking plain_name to return "v1" for everything and watching all 635
    tests pass. A song's words come as a deck, so the sheet being emptied is usually not
    the first one, and a name that ignores position puts a second v1 on the pile with no
    way to tell it from the real one.
    """
    song_id = _a_song(server)
    ids = []
    for words in ("the first verse", "a chorus", "the middle eight"):
        _, made = server.post("/api/songs/%d/lyrics" % song_id, {"text": words})
        ids.append(made["sheet"]["id"])

    # The third one, so a name that forgets where it sits is visibly wrong rather than
    # accidentally right.
    _, emptied = server.put("/api/lyrics/%d/text" % ids[2], {"text": ""})
    assert emptied["saved"] is True
    assert emptied["sheet"]["name"] == "v3", (
        "the third set of words came back as %r. An emptied sheet is named for its place"
        " in the deck, and ignoring that puts two sheets under one name."
        % emptied["sheet"]["name"])

    # And nothing else was renamed on the way past.
    _, listing = server.get("/api/songs/%d/lyrics" % song_id)
    names = [row["name"] for row in listing["lyrics"]]
    assert len(names) == len(set(names)), \
        "two sets of words on one song share a name: %r" % names
    assert "the first verse" in names and "a chorus" in names, \
        "emptying one sheet renamed the others: %r" % names


def test_restoring_an_empty_revision_takes_the_title_too(server):
    """The same thing by the other route: a sheet put back to a revision that was empty.

    Two places rewrite the name from the text, and a fix applied to one of them is a bug
    you meet again later by a different door.
    """
    song_id = _a_song(server)
    _, made = server.post("/api/songs/%d/lyrics" % song_id, {"text": "a first go"})
    sheet_id = made["sheet"]["id"]

    # Empty it, which is the revision worth going back to, then write something again.
    server.put("/api/lyrics/%d/text" % sheet_id, {"text": ""})
    _, history = server.get("/api/lyrics/%d/history" % sheet_id)
    # The history carries a length rather than the text, which is what the panel shows.
    was_empty = [r for r in history["revisions"] if r["length"] == 0][0]["id"]
    server.put("/api/lyrics/%d/text" % sheet_id, {"text": "a chorus"})

    _, back = server.post("/api/lyrics/%d/restore" % sheet_id, {"revision_id": was_empty})
    assert back["saved"] is True
    assert back["sheet"]["text"] == ""
    assert back["sheet"]["name"] == "v1", \
        "put back to nothing, so it is not called what the words used to say"


def test_writing_words_still_names_the_sheet(server):
    """The fix must not cost the feature: a sheet is still called what its first line says."""
    song_id = _a_song(server)
    _, made = server.post("/api/songs/%d/lyrics" % song_id, {"text": ""})
    sheet_id = made["sheet"]["id"]
    _, written = server.put("/api/lyrics/%d/text" % sheet_id,
                            {"text": "# the first verse\nand a second line"})
    assert written["sheet"]["name"] == "the first verse"


# ── pressing a button twice, on a screen with no Escape key ──────────────────

def test_a_rounded_panel_keeps_its_corners_when_it_scrolls():
    """"the scrollbar for dropdowns can go outside of the border radius".

    The thumb was already held off the sides by a transparent border, so it never stuck out
    sideways. What it did was run the whole height of the track, and on a panel with enough
    content to nearly fill the thumb its ends landed inside the corner curve: a light bar
    crossing the round.

    Measured with two panels side by side, 160 pixels of content in 150 against 700 in 150.
    Only the long thumb touched the corners, which is why the real dropdown showed it and a
    probe with plenty of overflow did not.

    So the track is inset from each end by the panel's own radius and the thumb cannot reach
    a corner however long it gets.
    """
    base = css("10-base.css")
    assert ".slot-menu::-webkit-scrollbar-track," in base
    assert ".yt-log::-webkit-scrollbar-track { margin: var(--r-md) 0; }" in base
    assert ".sheet::-webkit-scrollbar-track { margin: var(--r-xl) 0; }" in base, \
        "the sheet is rounded further, so it needs a deeper inset"


def test_the_scrollbar_treatment_is_not_written_twice():
    """The stylesheet already insets the thumb on `*`, and I duplicated it per surface
    before noticing. Two copies of one rule is one of them going stale."""
    base = css("10-base.css")
    assert base.count("background-clip: content-box;") <= 2, \
        "the thumb inset belongs on * and nowhere else"
    assert ".slot-menu::-webkit-scrollbar-thumb" not in base, \
        "the global thumb rule already covers this"
    assert "*::-webkit-scrollbar-button { display: none; width: 0; height: 0; }" in base, \
        "the steppers land in the corners the moment a bar is styled at all"

# ── the interface's own source ───────────────────────────────────────────────
#
# What follows was written against the old plain-JavaScript interface and is now asked of
# the Svelte one (ui/src). Where an item was fixed there by a mechanism that no longer
# exists, the test says what the item was and checks the invariant in the way the new code
# keeps it.

UI = os.path.join(HERE, "ui", "src")


def ui(*parts):
    return io.open(os.path.join(UI, *parts), encoding="utf-8").read()


def code(source):
    """Comments out: they explain the bug, and so name the very things searched for."""
    source = re.sub(r"/\*.*?\*/", "", source, flags=re.S)
    source = re.sub(r"<!--.*?-->", "", source, flags=re.S)
    return re.sub(r"^\s*//.*$", "", source, flags=re.M)


def function(source, header):
    """From a header to the closing brace at the same indent (a top level function)."""
    start = source.index(header)
    return source[start:source.index("\n}\n", start)]


def every_ui_source():
    for here, dirs, names in os.walk(UI):
        for name in sorted(names):
            if name.endswith((".ts", ".svelte", ".css")):
                yield os.path.join(here, name)


def test_the_drawer_over_the_page_is_not_see_through():
    """"a menu nagyon atlatszo, olvashatatlan", from a phone.

    On a wide screen the sidebar has nothing behind it. At phone width it lies over the
    page, and the page is words: a song title and three lines of lyrics were legible
    straight through it. It is drawn over a dark scrim, and as CSS glass (a blur), because
    it floats over scrolling content.
    """
    # The drawer is its own component now (it follows a thumb: EdgeDrawer.svelte).
    drawer = code(ui("shell", "EdgeDrawer.svelte"))
    scrim = re.search(r"\.scrim \{[^}]*background:\s*rgba\(0, 0, 0, (0?\.\d+)\)", drawer)
    assert scrim and float(scrim.group(1)) >= 0.5, \
        "the drawer's scrim is gone or too thin to read over"
    assert "<EdgeDrawer />" in ui("shell", "Shell.svelte") and "{#if shell.narrow}" in drawer, \
        "the phone drawer is gone"
    assert 'class="rail glass"' in ui("shell", "Sidebar.svelte")


def test_every_accent_tint_follows_the_accent():
    """Their phone showed pink buttons with green haloes.

    The pink was their own accent, chosen in Settings, which is what made the rest of it
    obvious: ten rules and two canvas fills wrote the green out as numbers and stayed green
    whatever was picked.
    """
    # Including the tokens file. Two hid there behind the exemption this test used to
    # grant it: the soft blob on the page's ground and the accent glow, both of which stay
    # green under a pink accent exactly like the ten rules that were fixed.
    for name, source in every_css().items():
        assert not re.search(r"rgba\(\s*84\s*,\s*179\s*,\s*122", source), \
            "%s still has the green written out by hand" % name
    for path in every_ui_source():
        assert not re.search(r"rgba?\(\s*84\s*,\s*179\s*,\s*122", io.open(path, encoding="utf-8").read()), \
            "%s still has the green written out by hand" % os.path.relpath(path, HERE)
    # The token is the accent as three numbers, so it has to be that colour and not a
    # colour it used to be. Read from --accent rather than written down here, or this
    # assertion becomes the very thing it exists to forbid: a copy that goes stale.
    accent = token("--accent").strip().lstrip("#")
    wanted = ", ".join(str(int(accent[i:i + 2], 16)) for i in (0, 2, 4))
    assert token("--accent-rgb") == wanted, (
        "--accent is #%s, which is rgb(%s), and --accent-rgb says %r. Every translucent"
        " tint in the app is built from the second one, so while they disagree the tints"
        " are a different colour from the thing they are tinting."
        % (accent.upper(), wanted, token("--accent-rgb")))

    # And nothing anywhere may write that colour out by hand, whatever it currently is.
    spaced = wanted.replace(", ", r"\s*,\s*")
    sources = dict(every_css())
    for path in every_ui_source():
        sources[os.path.relpath(path, HERE)] = io.open(path, encoding="utf-8").read()
    for name, source in sources.items():
        found = re.findall(r"rgba\(\s*" + spaced, source)
        assert not found, (
            "%s writes the accent out as numbers %d time(s). It will stay that colour"
            " when the accent is changed, which is what --accent-rgb is for."
            % (name, len(found)))

    assert 'setProperty("--accent-rgb"' in ui("lib", "look.svelte.ts"), \
        "the token has to be written when the accent is"


def test_the_canvas_reads_the_accent_rather_than_holding_one():
    draw = ui("views", "song", "sound", "draw.ts")
    assert 'accentRgb: read("--accent-rgb", ' in draw, \
        "a fallback is fine; a fixed colour is not"


# ── the four toasts ──────────────────────────────────────────────────────────

def test_a_queue_says_what_it_holds_rather_than_being_guessed_at():
    """"ha nincs kovetkezo szam, zavaroak ezek a hibauzenetek", with four stacked toasts
    reading "no song with id 28", "no song with id 38", "no song with id 17", "no song with
    id 41". Those numbers are render ids that reached the songs endpoint."""
    player = code(ui("lib", "player.svelte.ts"))
    assert 'queueKind: "song" as "song" | "render",' in player, \
        "the queue has to carry its own kind"
    assert 'player.queueKind = "song";' in player
    assert 'player.queueKind = "render";' in player
    step = function(player, "export async function step(")
    assert 'const renders = player.queueKind === "render" || item?.kind === "render";' in step, \
        "Next reads the queue's kind and the item's own"
    assert "player.song" not in step, (
        "Next is guessing from whatever happens to be playing again, which is what handed"
        " a render id to the songs endpoint")


def test_a_missing_song_is_not_the_servers_sentence():
    player = code(ui("lib", "player.svelte.ts"))
    body = function(player, "export async function playSong(")
    assert "is not in the library any more." in body
    assert "if (queue) return;" in body, \
        "a stale list is worth nothing said at all, not one line per dead row"
    caught = body[body.index("} catch {"):body.index("const versions")]
    assert "(e as Error).message" not in caught, \
        "what came back was for a log, not for somebody listening to music"


def test_the_same_toast_twice_is_one_toast():
    toast = code(ui("lib", "toast.svelte.ts"))
    assert "const MOST = 3;" in toast
    assert "t.message === message" in toast and "already.times += 1;" in toast, \
        "a toast has to know what it already said"
    assert ".slice(-MOST)" in toast


# ── the folders page ─────────────────────────────────────────────────────────

def test_no_dead_buttons_beside_the_folder_headings():
    """"a folders-nel a scan es take stock gombok olyanok, mintha disabled-k lennenek".

    They were disabled, which is honest and useless: the panel below already offers the one
    thing worth doing, in words. So the action is absent until there is something to do.
    """
    view = code(ui("views", "inbox", "Sources.svelte"))
    assert "{#if collectors.length}\n        <button class=\"btn sm primary\" disabled={scanning} onclick={doScan}>" in view
    assert "{#if libraries.length}\n        <button class=\"btn sm ghost\" disabled={stocking} onclick={takeStock}>" in view


def _hover_only_without_a_touch_way():
    """Every class a `:hover .name` rule brings from nought to full opacity, in any
    component, that has no matching rule for a touch screen. As "file:.name"."""
    found, checked = [], 0
    for path in every_ui_source():
        if not path.endswith(".svelte"):
            continue
        source = io.open(path, encoding="utf-8").read()
        if "<style>" not in source:
            continue
        sheet = re.sub(r"/\*.*?\*/", "", source[source.index("<style>"):], flags=re.S)
        for name in sorted(set(re.findall(r":hover \.([\w-]+)\s*(?:,[^{]*)?\{[^}]*opacity:\s*1", sheet))):
            if not re.search(r"\.%s\s*\{[^}]*opacity:\s*0[;\s}]" % re.escape(name), sheet):
                continue
            checked += 1
            touch = re.search(r"@media \((?:pointer: coarse|hover: none)\)[^{]*\{[^}]*\.%s\b[^}]*opacity:\s*1"
                              % re.escape(name), sheet)
            if not touch:
                found.append("%s:.%s" % (os.path.basename(path), name))
    return found, checked


def test_tools_that_only_appear_on_hover_appear_without_one():
    """"telon kicsit talan zavaro hogy hoverelni nem tudok es igy folyamatosan csak
    szovegkent jelenik meg, mintha nem gomb lenne".

    Anything a screen reveals under a pointer has to be there for a thumb too. Read off the
    components rather than listed. One is known to be missing (the sidebar's "All" link,
    below), and it is the only one allowed to be.
    """
    found, checked = _hover_only_without_a_touch_way()
    assert checked >= 5, "found almost nothing that only appears on hover, so this proves nothing"
    # The album cover's "Replace" caption is a label on a button that works by tapping, so
    # it is allowed to be a hover nicety; the sidebar's link is not a label, it is the way
    # to a list.
    assert set(found) <= {"Sidebar.svelte:.all", "Album.svelte:.hint"}, (
        "these only appear on hover, and there is no way to hover with a thumb: %s" % found)


@pytest.mark.xfail(strict=False, reason=(
    "finding: the sidebar's 'All' link beside each heading is opacity 0 until the heading is "
    "hovered, with no touch rule, so in the phone drawer it is there and cannot be seen"))
def test_the_sidebars_all_links_can_be_seen_without_a_pointer():
    found, _ = _hover_only_without_a_touch_way()
    found = [f for f in found if f != "Album.svelte:.hint"]
    assert not found, found


# ── the icon ─────────────────────────────────────────────────────────────────

def test_the_icon_and_the_wordmark_are_the_same_rest():
    """Two drawings of one mark drift. These share their numbers, so they cannot."""
    sidebar = ui("shell", "Sidebar.svelte")
    assert "M8.5 2 L3.5 9.5 L8.5 15 L3.5 21" in sidebar, "the sidebar still draws the rest"
    f = _favicon()
    assert f.ZIGZAG == [(8.5, 2.0), (3.5, 9.5), (8.5, 15.0), (3.5, 21.0)], \
        "the icon's zigzag is the path from the sidebar, in its own viewBox"
    assert f.HOOK[0][0] == (3.5, 21.0), "the hook starts where the zigzag ends"


# ── repeat, which was there and said otherwise ───────────────────────────────

def test_repeat_has_three_states_and_says_which():
    """"a lejatszasnal lehetne olyan ismetles, amikor nem a lejatszasi listat ismetli,
    hanem csak egy szamot".

    Repeating one song is what the button already did. It wore the two arrow cycle that
    means repeat the list everywhere else, so the player read as the opposite of the truth,
    and the honest reading of the report is that the icon was wrong rather than that the
    feature was missing. Now it is both: off, this one, the whole list.
    """
    player = code(ui("lib", "player.svelte.ts"))
    assert 'export const REPEATS: Repeat[] = ["off", "one", "all"];' in player
    assert 'player.repeat === "one"' in player, "one track restarts the element"
    assert 'if (player.repeat === "all" && player.queue.length) {' in player, \
        "the whole list goes back to the top"
    assert "step(-player.index)" in player, "back to the first row, not on to autoplay"
    # The one track state is the only one that draws a 1 in the loop, and the words come
    # from one table so the title and the label cannot disagree.
    for where in ("PlayerBar.svelte", "NowPlaying.svelte"):
        bar = code(ui("shell", where))
        assert 'player.repeat === "one" ? "repeat1" : "repeat"' in bar, where
        assert "REPEAT_SAYS[player.repeat]" in bar, where


def test_an_older_stored_repeat_still_means_what_it_meant():
    """It was a boolean, and true meant this one. Somebody with it on should not find it
    off, or on the list, after an update."""
    player = code(ui("lib", "player.svelte.ts"))
    assert 'typeof kept.repeat === "boolean" ? (kept.repeat ? "one" : "off")' in player
    assert "REPEATS.includes(kept.repeat as Repeat)" in player, \
        "and anything else stored is refused rather than trusted"


# ── the colour picker ────────────────────────────────────────────────────────

def test_the_accent_previews_like_every_other_dial():
    """Dust, chromatic and dither changed the room as you dragged them. The accent waited
    for Save, so the one control whose whole subject is a colour showed nothing."""
    look = code(ui("views", "settings", "Appearance.svelte"))
    at = look.index('if (key === "accent") {')
    body = look[at:at + 300]
    assert "accent.hold();" in body and "accent.preview(String(value));" in body


def test_a_preview_is_taken_back_when_you_walk_away():
    """"ha nem mentem el es atlepek masik menube, ugy maradnak ezek a beallitasok. Amikor
    visszalepek ... akkor az elso interakcional visszaugrik a legutoljara elmentett
    allapotba." The form redrew from what was saved, the app kept wearing what was not, and
    the first touch of a slider handed the form's values to applyLook and snapped the lot.

    It saves what it was showing on the way out, or lets go of it: either way what is on
    screen is what is stored. Letting go hands the colour back to the accent driver rather
    than applying the stored accent itself: with adaptive colours on and something playing,
    what belongs on screen after an abandoned preview is the player's colour, and only the
    driver knows that.
    """
    view = code(ui("views", "settings", "Appearance.svelte"))
    leaving = view[view.index("onDestroy(() => {"):]
    leaving = leaving[:leaving.index("});")]
    assert "flush()" in leaving and "letGo()" in leaving
    assert "accent.release();" in view[view.index("function letGo()"):view.index("async function flush()")], \
        "letting go has to hand the colour back to the accent driver"
    flush = view[view.index("async function flush()"):view.index("const persist")]
    assert "accent.refresh();" in flush, "and the driver decides again after every save"
    assert "(look as Record<string, unknown>)[k] = snap[k];" in flush, \
        "a save that failed has to put back what was saved, not keep a preview nobody stored"


def test_there_is_a_way_back_to_the_defaults():
    """"Lehetne egy gomb a beallitasoknal, ami visszaallitja az eredeti beallitasokat"."""
    view = code(ui("views", "settings", "Appearance.svelte"))
    assert 'get<{ defaults: Settings }>("/api/settings/defaults")' in view, \
        "read from the server, not four numbers written down a second time"
    body = view[view.index("async function backToNormal()"):view.index("const font = $derived")]
    assert "adaptive" in view and "persist.now();" in body
    assert 'label: "Undo"' in body, "putting everything back is itself put-back-able"


# ── pressing a button twice, on a screen with no Escape key ──────────────────

def test_a_menu_hanging_off_a_button_closes_when_you_press_it_again():
    """"sok gomb telon olyan, hogy ranyomok, akkor megjelennek opciok, utana egyertelmu
    lenne nekem, hogy ha megint ranyomok akkor bezarom, de csak ujra nyitja es ha
    felrenyomok akkoor zarja csak be."

    On a phone, pressing the thing again is the whole vocabulary: there is no Escape and no
    right button. A menu is drawn under a full screen layer that closes it on press, and
    that layer is above the button it hangs off, so pressing the button is pressing the
    layer and shuts the menu rather than opening a second one.
    """
    host = code(ui("ui", "MenuHost.svelte"))
    assert 'class="scrim" onpointerdown={() => close(false)}' in host
    assert re.search(r"\.scrim \{ position: fixed; inset: 0; z-index: 8\d\d; \}", host), \
        "the layer has to cover the whole screen, button included"


# ── starting a playlist ──────────────────────────────────────────────────────

def test_a_playlist_can_be_started_without_going_through_a_song():
    """"Lehetne kulon gomb a playlists szekcionál, ahol tudok csinalni ujat, hogy ne csak a
    zenéknel a playlist-hez adasnal jojjon elo ez a gomb, mert nem teljesen egyertelmu."

    Making one was only reachable through a song: add to playlist, then New. And with none
    yet the section was absent from the rail altogether, so there was nothing to press and
    nothing to say the feature existed.
    """
    sidebar = code(ui("shell", "Sidebar.svelte"))
    assert 'aria-label="Start a playlist" onclick={newPlaylist}' in sidebar
    actions = code(ui("lib", "actions.ts"))
    made = function(actions, "export async function newPlaylist(")
    assert 'post("/api/playlists", { title })' in made
    assert 'emit("playlists:changed");' in made, "the sidebar has to hear about it"
    assert "go(href.playlist(made.playlist.id));" in made, \
        "a new empty playlist is a place to go, not a line in a list"


def test_the_playlists_heading_is_there_before_the_first_one_is():
    sidebar = code(ui("shell", "Sidebar.svelte"))
    section = sidebar[sidebar.index('{#if has("playlists")}'):]
    assert "<span>Playlists</span>" in section
    assert "{:else}\n            <p class=\"none\">No playlists yet." in section, \
        "the section has to say what a playlist is for while it is empty"
    assert "{#each playlistsShown as p" in section and "{#if shell.playlists.length" not in section, \
        "the whole section used to vanish when there were none"


# ── two the owner found ──────────────────────────────────────────────────────

def test_scrolling_while_a_screen_loads_is_not_thrown_away():
    """"on phone when i open a page and scroll down immediately it scrolls back up".

    The reset to the top ran after the fetches, and a screen is scrollable long before
    then: the skeleton goes in straight away, so you open a song, start reading down it,
    and a second later the content lands and the router puts you back at the top.

    Now a fresh screen is put at the top once, on arrival, and nothing writes the scroll
    position again unless it is restoring a place somebody came back to, which stops the
    moment they touch the scroller themselves.
    """
    shell = code(ui("shell", "Shell.svelte"))
    arrive = shell[shell.index("const target = back ? places.get(hash) || 0 : 0;"):]
    arrive = arrive[:arrive.index("\n  });")]
    assert "scroller.scrollTop = target;" in arrive
    assert "if (!target) return;" in arrive, \
        "a fresh screen is put at the top once and then left alone"
    assert 'scroller.addEventListener("wheel", stop, { once: true, passive: true });' in arrive
    assert 'scroller.addEventListener("touchstart", stop, { once: true, passive: true });' in arrive, \
        "the restore has to give way to a finger"
    assert "if (!mine" in arrive


def test_a_fresh_screen_still_starts_at_the_top():
    """The reset exists for a reason and the fix must not cost it: arriving somewhere new
    without touching anything starts at the beginning, and coming back keeps your place."""
    shell = code(ui("shell", "Shell.svelte"))
    assert "const target = back ? places.get(hash) || 0 : 0;" in shell
    assert "if (arrivingKey === lastKey) { lastHash = hash; return; }" in shell, \
        "a refinement of the screen you are on (a tab, a filter) must not move you"
    # The position is read before the swap; afterwards it is always nought.
    before = shell[shell.index("$effect.pre(() => {"):]
    assert "places.set(lastHash, scroller.scrollTop)" in before[:300]


# A mark of the move to the new interface: two items the rebuilt interface does not keep.
#
# 1. The I-beam over things that are not editable ("sok szoveg nem kattinthato vagy
#    atirhato, de cursor text type-ra valt"): the old stylesheet set `body { cursor:
#    default; }` and handed the I-beam back to the text worth copying. ui/src/styles has no
#    such rule, so every label offers to be edited again.
# 2. A scroll bar thumb that cannot reach the corner of a rounded scroller ("the scrollbar
#    for dropdowns can go outside of the border radius"): the old stylesheet insets the
#    track by the panel's radius. The global scrollbar rules in ui/src/styles/base.css do
#    not.
#
# Both are differences of the new interface from the old one that look like regressions,
# so they are written down as expected failures rather than quietly dropped. Whoever fixes
# one will see its test start to pass.

def test_the_chrome_is_an_arrow_and_the_words_are_not():
    base = "\n".join(code(io.open(p, encoding="utf-8").read())
                     for p in every_ui_source() if p.endswith(".css"))
    assert re.search(r"\bbody\s*\{[^}]*cursor:\s*default", base)


@pytest.mark.xfail(strict=False, reason=(
    "finding: the new global scrollbar styling insets the thumb sideways but not along the "
    "track, so a long thumb can reach the corner of a rounded menu or sheet"))
def test_a_rounded_scroller_keeps_its_scrollbar_off_its_corners():
    base = code(ui("styles", "base.css"))
    assert re.search(r"::-webkit-scrollbar-track\s*\{[^}]*margin:", base)
