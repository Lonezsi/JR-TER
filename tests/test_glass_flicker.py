"""Regression guards for the hover flicker, written against the Svelte sources in ui/src.

THE STORY. Hovering anything made the persistent panes (sidebar, player bar, tab bar) flicker.
A backdrop-filter re-reads the pixels under its element on every repaint, and a hover
repaints; with saturate() or brightness() in the chain the result compounds a little each
time, so the pane visibly pulsed. SVG-filter references (url(#...)) and WebGL were the
earlier suspects and flickered too. The fix was one CSS material where the persistent panes
(.glass) have no backdrop-filter at all. These tests read source text, so they fail on the
commit that reintroduces any of it, not after somebody notices on a phone.
"""
import io
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(os.path.dirname(HERE), "ui", "src")
BASE = os.path.join(SRC, "styles", "base.css")


def read(path):
    return io.open(path, encoding="utf-8").read()


def sources(*exts):
    for here, _dirs, names in os.walk(SRC):
        for n in sorted(names):
            if n.endswith(exts):
                p = os.path.join(here, n)
                yield os.path.relpath(p, SRC).replace(os.sep, "/"), read(p)


def strip_comments(text):
    """CSS and HTML comments, and whole-line // comments. Comments explain the bug, so they
    legitimately name the things these tests forbid."""
    text = re.sub(r"/\*.*?\*/", "", text, flags=re.S)
    text = re.sub(r"<!--.*?-->", "", text, flags=re.S)
    return re.sub(r"^\s*//.*$", "", text, flags=re.M)


def declarations(text, prop):
    """Every value assigned to `prop` (or its -webkit- twin), as written."""
    return re.findall(r"(?<![\w-])(?:-webkit-)?%s\s*:\s*([^;}\"'`]*)" % re.escape(prop), text)


def rules(text):
    """(selector, body) for each flat rule. Good enough for these stylesheets, which do not
    nest, and for the <style> blocks in components."""
    return [(m.group(1).strip(), m.group(2)) for m in re.finditer(r"([^{}]+)\{([^{}]*)\}", text)]


OPT_IN = re.compile(r"(^|\})\s*html\[data-blur=[^{}]*\{[^{}]*\}")


def default_only(text):
    """The stylesheet without the deliberate per-browser opt-ins (html[data-blur="soft"|"full"]
    rules). The default, with no data-blur or "off", is what these guards protect."""
    return re.sub(r"(?m)^\s*html\[data-blur=[^{}]*\{[^{}]*\}", "", text)


def test_no_svg_filter_reference_in_a_filter():
    """SVG filters (url(#x)) inside filter or backdrop-filter flickered on hover.

    Chromium re-rasterises the referenced filter graph on every repaint under the pane, which
    is the same re-read that made the glass pulse. The material is blur only now.
    """
    bad = []
    for name, text in sources(".css", ".svelte", ".ts"):
        text = strip_comments(text)
        for prop in ("filter", "backdrop-filter"):
            bad += ["%s: %s: %s" % (name, prop, v.strip())
                    for v in declarations(text, prop) if "url(" in v]
    assert not bad, "an SVG filter is referenced from a filter again: %s" % bad


def test_no_saturate_or_brightness_in_a_backdrop_filter():
    """saturate()/brightness() in a backdrop-filter compound on every repaint.

    A hover repaints the pane, the backdrop is re-read already filtered once, and the
    saturation stacks until pink is a flat 255 in one channel: that was the visible flicker.
    Blur alone is idempotent enough that nobody can see it.
    """
    bad = []
    for name, text in sources(".css", ".svelte", ".ts"):
        text = default_only(strip_comments(text))
        bad += ["%s: %s" % (name, v.strip()) for v in declarations(text, "backdrop-filter")
                if re.search(r"\b(saturate|brightness)\(", v)]
    base = default_only(strip_comments(read(BASE)))
    tokens = re.findall(r"(--glass-filter[\w-]*)\s*:\s*([^;]*);", base)
    assert tokens, "base.css no longer defines the --glass-filter tokens this guards"
    bad += ["base.css %s: %s" % (k, v.strip()) for k, v in tokens
            if re.search(r"\b(saturate|brightness)\(", v)]
    assert not bad, "saturate()/brightness() is back in a backdrop filter: %s" % bad


def test_the_glass_pane_has_no_backdrop_filter():
    """`.glass` is the persistent pane (sidebar, player, tab bar) and must not blur behind it.

    A backdrop-filter on an element that is always on screen is re-evaluated on every hover
    repaint anywhere near it. That is the whole cause of the hover flicker, so the pane is a
    flat film. Only .glass-2 (things that open over the app) may blur.
    """
    base = default_only(strip_comments(read(BASE)))
    found = [(sel, body) for sel, body in rules(base)
             if any(s.strip() in (".glass", ".card") for s in sel.split(","))]
    assert found, "base.css has no .glass rule any more; the guard has nothing to read"
    for sel, body in found:
        assert "backdrop-filter" not in body, (
            "`%s` in base.css declares backdrop-filter. The persistent panes must not: it is"
            " what made hover flicker." % sel)


def test_no_shell_component_declares_its_own_pane_blur():
    """A pane's blur is decided in exactly one place (base.css), not by each component.

    The sidebar, player bar, tab bar and top bar buttons get their blur from the material
    under the Glass setting; a component that adds its own backdrop-filter to a pane would
    escape the setting and the reasoning in base.css. Allowed in ui/src/shell: the search's
    backing layer (`.backing`, blur only) and transient overlays named scrim / backdrop /
    veil / overlay / glass-2, the dim behind the search (a 3px blur of the app, fading itself),
    and the sidebar list's gradual edge (`.haze`: blur only, over the list inside the rail).
    """
    bad = []
    for name, text in sources(".svelte", ".css"):
        if not name.startswith("shell/"):
            continue
        for sel, body in rules(default_only(strip_comments(text))):
            filters = declarations(body, "backdrop-filter")
            if not filters:
                continue
            if re.search(r"glass-2|scrim|backdrop|veil|overlay|\.dim\b|\.haze\b", sel):
                continue
            if sel.strip() == ".backing" and not any(re.search(r"saturate|brightness|url\(", f) for f in filters):
                continue
            bad.append("%s: %s" % (name, sel))
    assert not bad, "a shell component blurs a pane on its own: %s" % bad


def test_the_pane_blur_lives_behind_one_selector():
    """Panes are blurred by html[data-blur="native"] .glass and nothing else.

    "native" (Glass) is the default: the browser's backdrop-filter, the way Apple's sites do
    it. It flickered here once because of what was under the glass (an SVG filter, a 2D
    particle canvas, a full screen CSS blur layer), all gone now; see base.css. Keeping the
    pane blur behind this one selector means "Shader only" and "Off" really have none.
    """
    base = strip_comments(read(BASE))
    optins = {sel for sel, _ in rules(base) if sel.startswith("html[data-blur=")}
    assert optins == {'html[data-blur="native"] .glass:not(.screen .glass)', 'html[data-blur="native"] .backing'}, optins
    for sel, body in rules(base):
        if sel in (".glass", ".glass::before", ".glass-2", ".card"):
            assert "backdrop-filter" not in body or sel == ".glass-2", "`%s` blurs outside the setting: %s" % (sel, body)


def test_no_filter_on_the_ancestor_of_the_panes():
    """#shell holds the sidebar and the top bar. A filter (or opacity) on it cuts off what
    their backdrop blur can see until it is gone, so closing the search showed the sidebar
    unblurred for the length of the transition. The overlays blur the app with their own
    dim layer instead."""
    shell = strip_comments(read(os.path.join(SRC, "shell", "Shell.svelte")))
    for sel, body in rules(shell):
        if sel.startswith("#shell"):
            assert "filter" not in body and "opacity" not in body, "%s { %s }" % (sel, body)


def test_nothing_animated_or_filtered_sits_under_the_glass():
    """The three things that made the blur flicker must not come back under the panes: an SVG
    filter in a filter chain (covered above), the 2D particle canvas running alongside the
    shader, and a CSS-filtered full screen ground while the shader draws it."""
    glass = read(os.path.join(SRC, "lib", "glass", "glass.svelte.ts"))
    assert "dust2d.stop()" in glass, "the shader no longer stops the 2D particles when it starts"
    ground = read(os.path.join(SRC, "shell", "Ground.svelte"))
    assert 'html[data-glass="gl"]) .art' in ground and "display: none" in ground,         "the CSS ground is no longer switched off under the shader"


def test_webgl_lives_only_in_the_glass_module():
    """WebGL is used for one thing: the glass shader in ui/src/lib/glass, which blurs the
    picture behind each pane and splits its colours at the rim, from the picture itself and
    never from the screen. That is what makes it immune to the hover flicker, so a second
    WebGL canvas anywhere else (reading the screen, or composited under translucent panes in
    some new way) is not allowed to appear unannounced."""
    found = [name for name, text in sources(".svelte", ".ts", ".js")
             if re.search(r"getContext\(\s*[\"'`]\s*(experimental-)?webgl", strip_comments(text))]
    outside = [name for name in found if "lib/glass/" not in name.replace("\\", "/")]
    assert not outside, "WebGL outside lib/glass: %s" % outside


def test_the_shader_never_reads_the_screen():
    """The flicker came from re-reading the screen under a pane. The shader must only ever
    sample its own textures: no readPixels, no copyTexImage2D, no blitFramebuffer from the
    default framebuffer."""
    text = strip_comments(io.open(os.path.join(SRC, "lib", "glass", "gl.ts"), encoding="utf-8").read())
    for call in ("readPixels", "copyTexImage2D", "copyTexSubImage2D", "blitFramebuffer"):
        assert call not in text, "the glass shader calls %s, which reads the screen" % call


def test_no_component_unpositions_a_pane():
    """Every pane's 1.5px edge is an absolutely positioned ::after on a `position: relative`
    pane. Settings once set its nav to `position: static` at narrow widths, and the edge then
    sized itself to the whole scroll area: a big edged frame with no gap around the page."""
    bad = [name for name, text in sources(".svelte", ".css")
           if re.search(r"position:\s*static", strip_comments(text))]
    assert not bad, "position: static unpositions a pane's edge: %s" % bad


def test_global_decorations_do_not_borrow_a_component_class():
    """base.css draws pseudo-element decorations on a few class names app-wide (the record
    behind an album, the sheets behind a playlist). One of them was once called `.stack`,
    which the toasts and some settings rows already used for themselves, and every toast
    grew two blue sheets behind it. A class base.css decorates must not also be a class a
    component declares in its own styles."""
    base = strip_comments(read(BASE))
    # The materials (.glass, .glass-2, .card) are meant to be built on by components; the
    # decorations are not.
    # Albums and playlists are components now (AlbumArt, PlaylistArt), so base.css may decorate
    # nothing at all; whatever it does decorate still must not clash.
    decorated = set(re.findall(r"\.([a-z][a-z0-9-]*)::(?:before|after)", base)) - {"glass", "glass-2", "card", "sm"}
    clashes = []
    for name, text in sources(".svelte"):
        style = text.split("<style>", 1)[1] if "<style>" in text else ""
        for cls in decorated:
            if re.search(r"(^|[\s,{}])\." + re.escape(cls) + r"\s*[{,]", style):
                clashes.append("%s: .%s" % (name, cls))
    assert not clashes, "a component styles a class base.css decorates: %s" % clashes
