"""The rhyme tools on the Words tab (ui/src/lib/lyrics): run for real, in Node, against the
word lists the app ships.

They are the kind of code that quietly gets worse: a scoring tweak that makes one pair
rhyme can make a hundred others rhyme that should not. So the pairs here are the ones that
were wrong once (madár was taken for a rhyme of lány; a one-syllable word outranked
two-syllable matches), next to ones that must keep working in both languages and across
them. Skipped where there is no Node new enough to run TypeScript.
"""
import json
import os
import shutil
import subprocess
import tempfile

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LYRICS = os.path.join(ROOT, "ui", "src", "lib", "lyrics")
LEXICON = os.path.join(ROOT, "ui", "public", "lexicon")

SCRIPT = r"""
import fs from "node:fs";
const dir = process.argv[2];
const read = (n) => fs.readFileSync(dir + "/" + n + ".txt", "utf8").split("\n").filter(Boolean);
const lists = { "hu-nouns": read("hu-nouns"), hu: read("hu"), en: read("en") };
globalThis.fetch = async (u) => ({ ok: true, text: async () =>
  lists[u.includes("hu-nouns") ? "hu-nouns" : u.includes("/hu.") ? "hu" : "en"].join("\n") });
const m = await import("./rhyme.ts");
await m.loadLexicon();
const end = (w) => m.analyse(w).lines[0];
const pair = (a, b) => m.kindOf(m.score(end(a).tail, end(b).tail));
const out = {
  pairs: Object.fromEntries(JSON.parse(process.argv[3]).map(([a, b]) => [a + "/" + b, pair(a, b)])),
  schemes: m.analyse(process.argv[4]).stanzas.map((s) => ({ scheme: s.scheme, pattern: s.pattern?.template ?? null,
    breaks: s.findings.filter((f) => f.severity === "break").map((f) => f.line) })),
  endings: Object.fromEntries(["házban", "fényről"].map((w) => [w, {
    end: m.endingOf(w)?.end ?? null,
    made: m.findRhymes(end(w).tail, { langs: ["hu"], exclude: w, word: w }).filter((c) => c.suffix).map((c) => c.word) }])),
  aside: (() => { const l = m.analyse("I walk into the night (oh yeah) <x2>").lines[0];
    return { end: l.end?.text ?? null, syllables: l.syllables, asides: m.asides(l.text).map((a) => a.kind) }; })(),
  says: m.analyse(process.argv[4]).stanzas[0].findings.filter((f) => f.severity === "break").map((f) => f.says),
  quiet: (() => { const t = process.argv[4].split("\n"); t[3] += " //"; const a = m.analyse(t.join("\n"));
    return { findings: a.stanzas[0].findings.length, end: a.lines[3].end?.text ?? null, asides: m.asides(t[3]).map((x) => x.kind) }; })(),
  targets: (() => { const a = m.analyse(process.argv[4]);
    return { verseLast: m.rhymeTarget(a, 3), chorusLast: m.rhymeTarget(a, 8), chorusThird: m.rhymeTarget(a, 7), second: m.rhymeTarget(a, 6) }; })(),
  rhymes: Object.fromEntries(["lány", "szerelem", "night"].map((w) =>
    [w, m.findRhymes(end(w).tail, { langs: [end(w).words[0].lang], exclude: w, limit: 12 }).map((c) => c.word)])),
};
console.log(JSON.stringify(out));
"""

PAIRS = [
    ("lány", "hány", "perfect"), ("szerelem", "kegyelem", "perfect"), ("night", "light", "perfect"),
    ("nation", "station", "perfect"), ("fire", "desire", "perfect"), ("szív", "believe", "perfect"),
    ("eye", "háj", "perfect"), ("time", "mine", "near"),
    ("lány", "madár", "vowels"), ("cat", "bet", None), ("night", "nap", None),
]
TEXT = """Kék az ég és szép a lány
Fújja a szél a fák alatt
Csillag ragyog az ég alján
Nem marad más, csak a madár

I walk alone into the night
The city sleeps beneath the rain
I hold on to the fading light
And never feel the same again"""


def node_ok():
    node = shutil.which("node")
    if not node:
        return None
    out = subprocess.run([node, "--version"], capture_output=True, text=True).stdout.strip().lstrip("v")
    major, minor = (int(x) for x in out.split(".")[:2])
    return node if (major, minor) >= (22, 6) else None


@pytest.fixture(scope="module")
def result():
    node = node_ok()
    if not node:
        pytest.skip("needs Node 22.6+ to run the TypeScript")
    with tempfile.TemporaryDirectory() as tmp:
        shutil.copy(os.path.join(LYRICS, "phon.ts"), os.path.join(tmp, "phon.ts"))
        with open(os.path.join(LYRICS, "rhyme.ts"), encoding="utf-8") as f:
            src = f.read().replace('from "./phon";', 'from "./phon.ts";')
        with open(os.path.join(tmp, "rhyme.ts"), "w", encoding="utf-8") as f:
            f.write(src)
        with open(os.path.join(tmp, "run.mjs"), "w", encoding="utf-8") as f:
            f.write(SCRIPT)
        run = subprocess.run(
            [node, "--experimental-strip-types", "--no-warnings", "run.mjs", LEXICON,
             json.dumps([[a, b] for a, b, _ in PAIRS]), TEXT],
            cwd=tmp, capture_output=True, text=True, encoding="utf-8", timeout=120)
        assert run.returncode == 0, run.stderr
        return json.loads(run.stdout)


@pytest.mark.parametrize("a,b,kind", PAIRS)
def test_pairs_rhyme_the_way_they_sound(result, a, b, kind):
    assert result["pairs"][a + "/" + b] == kind


def test_stanza_shapes_and_the_line_that_breaks_one(result):
    verse, chorus = result["schemes"]
    assert verse["pattern"] == "ABAB" and verse["breaks"] == [3], verse      # madár should rhyme with alatt
    assert chorus["scheme"] == "ABAB" and not chorus["breaks"], chorus


def test_rhyme_lists_put_the_fullest_matches_first(result):
    assert {"arány", "irány", "magány"} <= set(result["rhymes"]["lány"])
    assert result["rhymes"]["szerelem"][0] == "elem"
    assert {"fight", "kite", "site"} <= set(result["rhymes"]["night"])


def test_hungarian_endings_rhyme_on_real_nouns_in_harmony(result):
    """házban is back-vowelled, so it rhymes with stems that take -ban (bálban, bárban),
    never -ben; fényről with front stems taking -ről. Made only from nouns and adjectives,
    and never from two-letter stems, which were mostly not words (hában, mában)."""
    ban, rol = result["endings"]["házban"], result["endings"]["fényről"]
    assert ban["end"] == "ban" and rol["end"] == "ről"
    assert {"bálban", "bárban"} <= set(ban["made"]), ban["made"][:20]
    assert {"célről", "délről"} <= set(rol["made"]), rol["made"][:20]
    assert not any(w.endswith("ben") for w in ban["made"])
    assert not {"hában", "mában", "pában"} & set(ban["made"])


def test_bracketed_asides_are_not_the_line(result):
    """(background vocals) and <notes> are drawn dimmer and left out of the line's rhyme and
    its syllables: "the night (oh yeah)" rhymes on night."""
    aside = result["aside"]
    assert aside["end"] == "night"
    assert aside["syllables"] == 6
    assert aside["asides"] == ["paren", "angle"]


def test_a_broken_verse_is_described_as_it_is(result):
    """"This verse goes ABAB" was a lie about an ABAC verse. It says what the verse is, then
    what it would be, and which word would get it there."""
    (says,) = result["says"]
    assert says.startswith("This verse is ABA"), says
    assert "It'd be ABAB if this line landed on “alatt”" in says, says
    assert "goes ABAB" not in says


def test_two_slashes_at_the_end_quiet_a_line(result):
    """"//" at the end of a line turns its warnings off. It's drawn as its own, dimmest
    aside and isn't a word of the line, so the line still rhymes on what's before it."""
    quiet = result["quiet"]
    assert quiet["findings"] == 0
    assert quiet["end"] == "madár"
    assert quiet["asides"] == ["quiet"]


def test_the_rhyme_button_knows_what_a_line_rhymes_with(result):
    """The rhyme button rhymes with the line this one should land on, read off the verse:
    the line a warning names, the line with this one's letter in the verse's shape."""
    t = result["targets"]
    assert t["verseLast"] == 1          # madár breaks ABAB: it should land on alatt
    assert t["chorusLast"] == 6         # again: rain
    assert t["chorusThird"] == 5        # light: night
    assert t["second"] == 8             # rain, the first B: its partner further down, again
