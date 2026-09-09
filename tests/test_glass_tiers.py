"""Can you read a dialog on every engine that can reach one.

There are three glass tiers now, because there are three answers an engine can give:

  Blink            an SVG filter inside a backdrop-filter renders, so the glass bends light
  WebKit, Gecko    backdrop-filter works but url() inside it does not
  anything older   no backdrop-filter at all

The middle one is new. It used to be folded in with the third and handed a flat dark panel,
which is honest and is not what this app looks like, and it meant the person who found half
the bugs in here had never seen the real thing.

The reason to be careful about it is measurable rather than aesthetic. Blink's tint is an
eight and a half per cent white film, and all of its legibility comes from the blur behind
it. Where that blur does not arrive, the film over white content lands at 1.11:1 against
the text, which is not "looks wrong", it is "cannot be read", and it is exactly what was
reported from two Apple devices.

So the rule this file enforces: every tier an engine can land on without a working url()
filter has to carry text on its own. The tint is checked over pure white, with no help from
the blur, because the whole failure was the blur not being there.
"""
import io
import os
import re

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TOKENS = os.path.join(HERE, "web", "css", "00-tokens.css")

#: 4.5:1 is the AA threshold for body text. Nothing here should come near it; the point of
#: the number is that a future edit which does gets stopped.
AA = 4.5


def _css():
    return io.open(TOKENS, encoding="utf-8").read()


def _strip_comments(source):
    return re.sub(r"/\*.*?\*/", "", source, flags=re.S)


def _hex(value):
    value = value.strip().lstrip("#")
    return tuple(int(value[i:i + 2], 16) for i in (0, 2, 4))


def _rgba(value):
    nums = [float(n) for n in re.findall(r"[\d.]+", value)]
    return nums[0], nums[1], nums[2], (nums[3] if len(nums) > 3 else 1.0)


def _luminance(colour):
    out = []
    for channel in colour:
        c = channel / 255.0
        out.append(c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4)
    return 0.2126 * out[0] + 0.7152 * out[1] + 0.0722 * out[2]


def _contrast(a, b):
    la, lb = _luminance(a), _luminance(b)
    return (max(la, lb) + 0.05) / (min(la, lb) + 0.05)


def _over(tint, backdrop):
    """The tint composited on a backdrop, which is what you get with no blur at all."""
    r, g, b, a = tint
    return tuple(a * c + (1 - a) * d for c, d in zip((r, g, b), backdrop))


def _text_colour():
    found = re.search(r"--text:\s*(#[0-9A-Fa-f]{6})", _css())
    assert found, "--text is not in the tokens file any more"
    return _hex(found.group(1))


def _blocks():
    """Each @supports condition in the file with the body of text under it.

    Crude on purpose: it wants to know which conditions guard which --glass-2, and the
    file has one nesting level and a handful of blocks. A real CSS parser to answer that
    is a real CSS parser to maintain.
    """
    source = _strip_comments(_css())
    out = []
    for found in re.finditer(r"@supports([^{]+)\{", source):
        start = found.end()
        depth = 1
        i = start
        while i < len(source) and depth:
            if source[i] == "{":
                depth += 1
            elif source[i] == "}":
                depth -= 1
            i += 1
        out.append((found.group(1).strip(), source[start:i]))
    return out


def test_the_transparent_tint_is_only_asked_for_where_the_bend_renders():
    """The 1.11:1 film has to stay behind the engine gate, and nowhere else.

    It is legible only because Blink puts a displacement map and a 22px blur behind it.
    Anywhere it can be reached without those, it is a sheet of clear glass with the page's
    own text sharp underneath it.
    """
    gated = [body for condition, body in _blocks()
             if "paint(x)" in condition and "not" not in condition]
    assert gated, "the Blink gate is gone from the tokens file"

    inside = "".join(gated)
    text = _text_colour()

    # Every low alpha tint in the file has to be inside that gate.
    for found in re.finditer(r"--glass(?:-2)?:\s*(rgba\([^)]*\))", _strip_comments(_css())):
        tint = _rgba(found.group(1))
        worst = _contrast(text, _over(tint, (255, 255, 255)))
        if worst >= AA:
            continue
        assert found.group(1) in inside, (
            "%s reaches %.2f:1 over white with no blur, which is unreadable, and it is not"
            " inside the engine gate. Only Blink renders the filter that makes a tint this"
            " thin legible." % (found.group(1), worst))


def test_every_tier_without_the_bend_carries_its_own_text():
    """The tiers an Apple device can land on, checked with no help from the blur.

    Over pure white, which is the worst thing that can be behind a dialog, and with the
    filter contributing nothing, because a filter contributing nothing is the entire
    reason this file exists.
    """
    text = _text_colour()
    source = _strip_comments(_css())

    tiers = []
    # The base :root, which is the floor for an engine with no backdrop-filter at all.
    base = re.search(r"^:root\s*\{(.*?)^\}", source, flags=re.S | re.M)
    assert base, "the base :root block is not where it was"
    tiers.append(("the base tier", base.group(1)))

    # And any @supports block that is not the Blink gate.
    for condition, body in _blocks():
        if "paint(x)" in condition and "not" not in condition:
            continue
        if "--glass-2" in body:
            tiers.append(("@supports" + condition, body))

    checked = 0
    for label, body in tiers:
        found = re.search(r"--glass-2:\s*(rgba\([^)]*\))", body)
        if not found:
            continue
        checked += 1
        worst = _contrast(text, _over(_rgba(found.group(1)), (255, 255, 255)))
        assert worst >= AA, (
            "%s carries dialog text at %.2f:1 over white with no blur working, under the"
            " %.1f:1 a body of text needs. An engine that lands here and cannot blur"
            " shows a clear pane with the page's text sharp underneath, which is how this"
            " was reported from two devices." % (label, worst, AA))

    assert checked >= 2, (
        "only %d tier was checked; the WebKit tier and the base floor should both define"
        " --glass-2" % checked)
