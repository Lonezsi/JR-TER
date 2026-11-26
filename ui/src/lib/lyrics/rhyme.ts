/* Rhyme, over lib/lyrics/phon: how well two word endings rhyme, what a whole set of words
 * rhymes like (stanza by stanza), and which words in the two word lists would rhyme with a
 * given one. All of it in the browser; the word lists are fetched once, when first wanted.
 *
 * PUBLIC API
 *   loadLexicon()               -> Promise<Lexicon>   (once; later calls share it)
 *   lexicon                     the loaded one, or null
 *   score(a, b)                 how well two tails rhyme: 0 (not) .. 10 (identical)
 *   kindOf(score)               "perfect" | "near" | "vowels" | null
 *   analyse(text, opts)         -> Analysis  (lines, words, stanzas, schemes, findings)
 *   findRhymes(tail, opts)      -> Candidate[]
 *   tailText(tail)              a readable spelling of a tail, for labels
 *   warm(lang)                  build a language's search index ahead of time
 */
import { FAMILIES, VOWELS, guessLang, sounds, tailOf, tokens, type Lang, type Syl } from "./phon";

// ── the word lists ──────────────────────────────────────────────────────────

export interface Lexicon { hu: Set<string>; en: Set<string>; words: Record<Lang, string[]>; huNouns: string[] }
export let lexicon: Lexicon | null = null;
let loading: Promise<Lexicon> | null = null;

export function loadLexicon(): Promise<Lexicon> {
  if (lexicon) return Promise.resolve(lexicon);
  loading ||= (async () => {
    const read = async (name: string) => {
      const r = await fetch(`/lexicon/${name}.txt`);
      if (!r.ok) throw new Error(`The ${name.startsWith("hu") ? "Hungarian" : "English"} word list didn't load.`);
      return (await r.text()).split("\n").filter(Boolean);
    };
    const [hu, en, huNouns] = await Promise.all([read("hu"), read("en"), read("hu-nouns").catch(() => [] as string[])]);
    lexicon = { hu: new Set(hu), en: new Set(en), words: { hu, en }, huNouns };
    return lexicon;
  })();
  loading.catch(() => { loading = null; });
  return loading;
}

// ── comparing ───────────────────────────────────────────────────────────────

/* Consonants that sound alike, so a near rhyme can be told from no rhyme at all. */
const CLASS: Record<string, string> = {
  m: "nasal", n: "nasal", ɲ: "nasal", ŋ: "nasal",
  p: "stop", t: "stop", k: "stop", c: "stop", b: "vstop", d: "vstop", g: "vstop", ɟ: "vstop",
  s: "hiss", z: "hiss", ʃ: "hiss", ʒ: "hiss", ts: "hiss", tʃ: "hiss", dʒ: "hiss", dz: "hiss",
  f: "fric", v: "fric", θ: "fric", ð: "fric", h: "fric",
  l: "liquid", r: "liquid", j: "liquid", w: "liquid",
};
const cls = (p: string) => CLASS[p] || p;

function codaScore(a: string[], b: string[]): number {
  if (a.join() === b.join()) return 3;
  if (!a.length || !b.length) return a.length + b.length <= 1 ? 1 : 0;
  const ca = a.map(cls).join(), cb = b.map(cls).join();
  if (ca === cb) return 2;
  if (cls(a[a.length - 1]) === cls(b[b.length - 1])) return 1;
  return 0;
}
function vowelScore(a: string, b: string, weight: number): number {
  if (a === b) return weight;
  const fa = VOWELS[a], fb = VOWELS[b];
  if (!fa || !fb) return 0;
  if (fa.family === fb.family) return weight * (fa.long === fb.long ? 0.75 : 0.55);
  return 0;
}

/* A Hungarian vowel followed by j sounds as an English diphthong does (háj, eye; hej, hey;
 * oly, boy), so before comparing, that pair is read as the diphthong. */
const GLIDE: Record<string, string> = { a: "aɪ", e: "eɪ", o: "ɔɪ" };
function canonical(s: Syl): Syl {
  const fam = VOWELS[s.v]?.family;
  if (s.coda[0] === "j" && fam && GLIDE[fam]) return { ...s, v: GLIDE[fam], coda: s.coda.slice(1) };
  return s;
}

/** 0..10. The last syllable counts most (its vowel, then what ends it), then the one
 *  before (its vowel, then the consonant that starts the last one). */
export function score(a0: Syl[], b0: Syl[]): number {
  if (!a0.length || !b0.length) return 0;
  const a = a0.map(canonical), b = b0.map(canonical);
  const la = a[a.length - 1], lb = b[b.length - 1];
  const v = vowelScore(la.v, lb.v, 4);
  if (!v) return 0;
  const c = codaScore(la.coda, lb.coda);
  let s = v + c;
  if (a.length > 1 && b.length > 1) {
    s += vowelScore(a[a.length - 2].v, b[b.length - 2].v, 2);
    s += la.onset.join() === lb.onset.join() && la.onset.length ? 1 : 0;
  } else if (c >= 2) {
    // A one-syllable ending has nothing more to agree on: two of them match fully; one
    // against a longer word matches its last syllable, which is a rhyme, ranked below
    // one that also agrees a syllable further back (szerelem: elem before nem).
    s += a.length === 1 && b.length === 1 ? 2 : 1.5;
  }
  // Endings that close on unlike consonants (lány, madár) agree in their vowels and no
  // more: that is asszonánc, never a rhyme, however well the rest matches.
  if (c === 0 && (la.coda.length || lb.coda.length)) s = Math.min(s, 5.5);
  return Math.min(10, s);
}

export type Kind = "perfect" | "near" | "vowels";
export function kindOf(s: number): Kind | null {
  if (s >= 8.5) return "perfect";
  if (s >= 6) return "near";
  if (s >= 4) return "vowels";          // the same last vowel and nothing else: asszonánc
  return null;
}
/** The score from which two lines count as rhyming in a scheme. */
export const RHYMES = 6;

/** A tail written back out roughly, for a label: "-ány", "-ight". */
export function tailText(word: string, tail: Syl[]): string {
  if (!tail.length) return word;
  const from = tail[0].at[0];
  return "-" + word.slice(from).toLowerCase();
}

// ── a whole set of words ────────────────────────────────────────────────────

export interface Word {
  text: string;
  at: number;                    // offset in the line
  lang: Lang;
  syls: Syl[];
}
export interface Line {
  index: number;                 // line number in the text
  text: string;
  words: Word[];
  lang: Lang | "mixed" | null;
  /** The rhyming word (the last) and its tail. */
  end: Word | null;
  tail: Syl[];
  syllables: number;
  /** Letter in the stanza's scheme, and the stanza-wide group number for colour. */
  letter: string;
  group: number;
  /** Lines in the same stanza it rhymes with, and how. */
  partners: { line: number; kind: Kind }[];
  /** Ends in "//": no warnings for this line. */
  quiet: boolean;
}
export interface Stanza {
  title: string | null;          // a heading or [Section] label above it
  lines: Line[];                 // the lines that carry words
  scheme: string;                // e.g. "ABAB"
  pattern: { name: string; template: string } | null;
  findings: Finding[];
  syllables: { median: number };
}
export interface Finding {
  line: number;                  // line number in the text
  says: string;
  /** The line it was expected to rhyme with: suggestions rhyme with that one's end. */
  partner?: number;
  severity: "break" | "meter";
}
export interface Analysis { lines: Line[]; stanzas: Stanza[]; byIndex: Map<number, Line> }

export interface AnalyseOptions {
  /** Per-line language chosen by hand, by line text (survives reordering). */
  forced?: Record<string, Lang>;
}

/* Asides inside a line: (background vocals), <a note>, {an instruction}, [a tag]. They are
 * drawn dimmer, and they are not the line's words: they neither rhyme nor count syllables,
 * so "the night (oh yeah)" still rhymes on night. */
export type AsideKind = "paren" | "angle" | "curly" | "square" | "quiet";
/* "//" at the end of a line: leave this line alone. It's drawn dimmest of all and the line
 * gets no warnings (it still counts in the rhyme scheme). Two slashes never come up in a
 * lyric, and it reads like a code comment: a note to yourself, not part of the song. */
export const QUIET = /\/\/\s*$/;
const PAIRS: Record<string, [string, AsideKind]> = { "(": [")", "paren"], "<": [">", "angle"], "{": ["}", "curly"], "[": ["]", "square"] };
export function asides(line: string): { from: number; to: number; kind: AsideKind }[] {
  const out: { from: number; to: number; kind: AsideKind }[] = [];
  for (let i = 0; i < line.length; i++) {
    const pair = PAIRS[line[i]];
    if (!pair) continue;
    const close = line.indexOf(pair[0], i + 1);
    if (close < 0) continue;
    out.push({ from: i, to: close + 1, kind: pair[1] });
    i = close;
  }
  const quiet = QUIET.exec(line);
  if (quiet && !out.some((a) => quiet.index >= a.from && quiet.index < a.to)) out.push({ from: quiet.index, to: line.length, kind: "quiet" });
  return out;
}
const maskAsides = (line: string) => {
  let out = line;
  for (const a of asides(line)) out = out.slice(0, a.from) + " ".repeat(a.to - a.from) + out.slice(a.to);
  return out;
};

const HEADING = /^\s*(#{1,6}\s+.*|\[[^\]]+\]\s*|\([^)]*\)\s*:?)$/;
const PATTERNS: { name: string; template: string }[] = [
  { name: "couplets", template: "AABB" }, { name: "alternating", template: "ABAB" },
  { name: "enclosed", template: "ABBA" }, { name: "ballad", template: "ABCB" },
  { name: "monorhyme", template: "AAAA" }, { name: "rubaiyat", template: "AABA" },
  { name: "couplet", template: "AA" }, { name: "tercet", template: "AAA" }, { name: "terza", template: "ABA" },
  { name: "alternating", template: "ABABCDCD" }, { name: "couplets", template: "AABBCCDD" },
  { name: "sestet", template: "AABCCB" }, { name: "sestet", template: "ABABCC" },
];

function lineLang(words: { word: string }[], forced: Lang | undefined): { each: Lang[]; line: Lang | "mixed" | null } {
  if (forced) return { each: words.map(() => forced), line: forced };
  const guesses = words.map((w) => guessLang(w.word, lexicon));
  const hu = guesses.filter((g) => g === "hu").length, en = guesses.filter((g) => g === "en").length;
  const lean: Lang = hu >= en ? "hu" : "en";
  const each = guesses.map((g) => g ?? lean);
  const line = !hu && !en ? null : hu && en ? (Math.min(hu, en) / Math.max(hu, en) > 0.25 ? "mixed" : lean) : lean;
  return { each, line };
}

export function analyse(text: string, opts: AnalyseOptions = {}): Analysis {
  const raw = text.split("\n");
  const lines: Line[] = [];
  const stanzas: Stanza[] = [];
  let current: Stanza | null = null;
  let pendingTitle: string | null = null;
  raw.forEach((t, index) => {
    if (!t.trim()) { current = null; return; }
    if (HEADING.test(t)) { current = null; pendingTitle = t.replace(/^#+\s*|[[\]():]/g, "").trim(); return; }
    const toks = tokens(maskAsides(t).replace(/[*_`~]/g, " "));
    if (!toks.length) return;
    const { each, line: lang } = lineLang(toks, opts.forced?.[t.trim()]);
    const words: Word[] = toks.map((tk, k) => ({ text: tk.word, at: tk.at, lang: each[k], syls: sounds(tk.word, each[k]) }));
    const end = words[words.length - 1] ?? null;
    const line: Line = {
      index, text: t, words, lang, end,
      tail: end ? tailOf(end.syls, end.lang) : [],
      syllables: words.reduce((n, w) => n + w.syls.length, 0),
      letter: "", group: -1, partners: [], quiet: QUIET.test(t),
    };
    lines.push(line);
    if (!current) {
      current = { title: pendingTitle, lines: [], scheme: "", pattern: null, findings: [], syllables: { median: 0 } };
      pendingTitle = null;
      stanzas.push(current);
    }
    current.lines.push(line);
  });

  let groupBase = 0;
  for (const st of stanzas) {
    // Letters: each line joins the earliest earlier group it rhymes with, or starts one.
    const reps: Line[][] = [];
    for (const ln of st.lines) {
      let best = -1, bestScore = 0;
      reps.forEach((members, g) => {
        const s = Math.max(...members.map((m) => score(ln.tail, m.tail)));
        if (s >= RHYMES && s > bestScore) { best = g; bestScore = s; }
      });
      if (best < 0) { reps.push([ln]); best = reps.length - 1; } else reps[best].push(ln);
      ln.letter = String.fromCharCode(65 + Math.min(best, 25));
      ln.group = groupBase + best;
    }
    for (const ln of st.lines) {
      for (const other of st.lines) {
        if (other === ln) continue;
        const k = kindOf(score(ln.tail, other.tail));
        if (k && k !== "vowels") ln.partners.push({ line: other.index, kind: k });
      }
    }
    groupBase += reps.length;
    st.scheme = st.lines.map((l) => l.letter).join("");
    checkStructure(st);
  }
  return { lines, stanzas, byIndex: new Map(lines.map((l) => [l.index, l])) };
}

/* Which known shape a stanza is closest to, and where it breaks that shape. A shape is
 * only claimed when all but one line fit it: a stanza with two misfits is free verse, not
 * a broken sonnet. A template shorter than the stanza repeats (ABAB over eight lines). */
function checkStructure(st: Stanza) {
  const n = st.lines.length;
  const sorted = st.lines.map((l) => l.syllables).sort((a, b) => a - b);
  st.syllables.median = sorted[Math.floor(sorted.length / 2)] || 0;
  if (n >= 2) {
    let best: { name: string; template: string; misses: number[] } | null = null;
    for (const p of PATTERNS) {
      if (p.template.length > n || n % p.template.length) continue;
      const tpl = repeatTemplate(p.template, n);
      const misses = fitMisses(st.scheme, tpl);
      if (misses.length <= (n >= 4 ? 1 : 0) && (!best || misses.length < best.misses.length)) best = { ...p, template: tpl, misses };
    }
    if (best && new Set(best.template).size < n) {
      st.pattern = { name: best.name, template: best.template };
      for (const m of best.misses) {
        const want = best.template[m];
        const partner = st.lines.findIndex((l, k) => k !== m && best!.template[k] === want);
        const p = st.lines[partner];
        if (st.lines[m].quiet) continue;
        // Say what it IS, then what it could be: "goes ABAB" was a lie about an ABAC verse.
        const fixed = toLetters(best.template);
        st.findings.push({
          line: st.lines[m].index, severity: "break", partner: p?.index,
          says: p ? `This verse is ${st.scheme}. It'd be ${fixed} if this line landed on “${p.end?.text ?? ""}” (${tailText(p.end?.text ?? "", p.tail)}).`
                  : `This verse is ${st.scheme}, one line off ${fixed}.`,
        });
      }
    }
  }
  for (const l of st.lines) {
    if (l.quiet) continue;
    if (n >= 3 && st.syllables.median >= 4 && Math.abs(l.syllables - st.syllables.median) >= Math.max(3, Math.round(st.syllables.median * 0.3))) {
      st.findings.push({
        line: l.index, severity: "meter",
        says: `${l.syllables} syllables, the rest are around ${st.syllables.median}.`,
      });
    }
  }
}
/** A template written with the stanza's own kind of letters: first new one A, then B. */
function toLetters(t: string): string {
  const seen = new Map<string, string>();
  return [...t].map((ch) => { if (!seen.has(ch)) seen.set(ch, String.fromCharCode(65 + seen.size)); return seen.get(ch)!; }).join("");
}
function repeatTemplate(t: string, n: number): string {
  let out = "";
  for (let k = 0; out.length < n; k++) {
    // Each repeat uses new letters: ABAB then CDCD.
    out += [...t].map((ch) => String.fromCharCode(ch.charCodeAt(0) + k * new Set(t).size)).join("");
  }
  return out.slice(0, n);
}
/* Lines whose letter breaks the template, after the best relabelling of the stanza's own
 * letters onto the template's: A in one is whatever letter fits most lines in the other. */
function fitMisses(scheme: string, tpl: string): number[] {
  const map = new Map<string, string>();
  const counts = new Map<string, Map<string, number>>();
  [...scheme].forEach((s, i) => {
    const m = counts.get(tpl[i]) || new Map<string, number>();
    m.set(s, (m.get(s) || 0) + 1);
    counts.set(tpl[i], m);
  });
  const used = new Set<string>();
  for (const [t, m] of [...counts.entries()].sort((a, b) => Math.max(...b[1].values()) - Math.max(...a[1].values()))) {
    const pick = [...m.entries()].sort((a, b) => b[1] - a[1]).find(([s]) => !used.has(s));
    if (pick) { map.set(t, pick[0]); used.add(pick[0]); }
  }
  return [...tpl].map((t, i) => (map.get(t) === scheme[i] ? -1 : i)).filter((i) => i >= 0);
}

// ── finding rhymes ──────────────────────────────────────────────────────────

export interface Candidate {
  word: string; lang: Lang; score: number; kind: Kind; syllables: number;
  /** Made from a stem plus the same ending as the word asked about (-ban, -ság…): a
   *  Hungarian rhyme on the suffix, listed apart from rhymes on the word itself. */
  suffix?: string;
}

// ── Hungarian endings ───────────────────────────────────────────────────────

/* Endings a Hungarian line often rhymes on, each in its vowel-harmony forms: back, front,
 * and (where there is one) front rounded. The word lists hold stems only, so a rhyme for
 * "házban" has to be made: every back-vowel stem plus -ban. */
/* Case endings only: they go on almost any noun. Derivational ones (-ság, -talan, -ás) go
 * on some and not others, so generating them makes words that don't exist. */
const HU_ENDINGS: string[][] = [
  ["ban", "ben"], ["ba", "be"], ["ból", "ből"], ["nak", "nek"], ["nál", "nél"], ["ra", "re"],
  ["ról", "ről"], ["tól", "től"], ["hoz", "hez", "höz"], ["ért"], ["ként"], ["ig"],
];
const BACK = /[aáoóuú]/, FRONT_ROUND = /[öőüű]/, VOWEL = /[aáeéiíoóöőuúüű]/g;

/** Which harmony form a stem takes: 0 back, 1 front, 2 front rounded (or front, if the
 *  ending has no third form). Decided by the stem's last vowel, which is right for most. */
function harmony(stem: string, forms: number): number {
  const vowels = stem.match(VOWEL) || [];
  const last = vowels[vowels.length - 1] || "e";
  if (BACK.test(last)) return 0;
  if (FRONT_ROUND.test(last) && forms > 2) return 2;
  return 1;
}
/** A stem's final a or e lengthens before an ending (fa: fában, kecske: kecskében). */
const join = (stem: string, end: string) =>
  (/a$/.test(stem) ? stem.slice(0, -1) + "á" : /e$/.test(stem) ? stem.slice(0, -1) + "é" : stem) + end;

/** The ending a Hungarian word carries, if any: the form, and which harmony slot it is. */
export function endingOf(word: string): { end: string; slot: number; forms: string[] } | null {
  const w = word.toLowerCase();
  let best: { end: string; slot: number; forms: string[] } | null = null;
  for (const forms of HU_ENDINGS) {
    forms.forEach((end, slot) => {
      if (w.length >= end.length + 2 && w.endsWith(end) && (!best || end.length > best.end.length)) best = { end, slot, forms };
    });
  }
  return best;
}

const madeCache = new Map<string, { word: string; tail: Syl[]; n: number }[]>();
/* Every stem that takes this form of the ending, with the ending on. Built once per
 * ending form and kept: a few tens of thousands of words, made the first time it is
 * asked for. */
function madeWith(end: string, slot: number, forms: string[]) {
  const key = forms.join("/") + ":" + slot;
  let made = madeCache.get(key);
  if (made) return made;
  made = [];
  // Nouns and adjectives only: a verb or an abbreviation with -ban on it isn't a word.
  for (const stem of lexicon?.huNouns ?? []) {
    // Three letters at least: the two-letter "nouns" in the list are mostly not (ha, ma, pa).
    if (stem.length < 3 || harmony(stem, forms.length) !== Math.min(slot, forms.length - 1)) continue;
    if (forms.some((f) => stem.endsWith(f))) continue;        // already carries it
    const word = join(stem, end);
    const syls = sounds(word, "hu");
    made.push({ word, tail: tailOf(syls, "hu"), n: syls.length });
  }
  madeCache.set(key, made);
  return made;
}

const indexes: Partial<Record<Lang, Map<string, { word: string; tail: Syl[]; n: number }[]>>> = {};
/* Words bucketed by their last vowel's family, so a search compares a few thousand
 * endings rather than every word. Built the first time a language is searched. */
function indexOf(lang: Lang) {
  if (indexes[lang]) return indexes[lang]!;
  const map = new Map<string, { word: string; tail: Syl[]; n: number }[]>();
  for (const word of lexicon?.words[lang] ?? []) {
    const syls = sounds(word, lang);
    const tail = tailOf(syls, lang);
    const last = tail[tail.length - 1];
    if (!last) continue;
    const key = VOWELS[last.v]?.family ?? last.v;
    const list = map.get(key) || [];
    list.push({ word, tail, n: syls.length });
    map.set(key, list);
  }
  indexes[lang] = map;
  return map;
}

/** Build a language's index ahead of the first search, when the page is idle. */
export function warm(lang: Lang) { if (lexicon) indexOf(lang); }

export function findRhymes(tail: Syl[], opts: { langs: Lang[]; exclude?: string; syllables?: number; limit?: number; word?: string }): Candidate[] {
  const last = tail[tail.length - 1];
  if (!last || !lexicon) return [];
  const family = VOWELS[last.v]?.family ?? last.v;
  const out: Candidate[] = [];
  const skip = (opts.exclude || "").toLowerCase();
  for (const lang of opts.langs) {
    for (const c of indexOf(lang).get(family) ?? []) {
      if (c.word === skip) continue;
      const s = score(tail, c.tail);
      const kind = kindOf(s);
      if (!kind) continue;
      out.push({ word: c.word, lang, score: s, kind, syllables: c.n });
    }
  }
  // A Hungarian word with an ending rhymes with every stem that takes the same ending.
  const ending = opts.langs.includes("hu") && opts.word ? endingOf(opts.word) : null;
  if (ending) {
    const seen = new Set(out.map((c) => c.word));
    const made: Candidate[] = [];
    for (const c of madeWith(ending.end, ending.slot, ending.forms)) {
      if (c.word === skip || seen.has(c.word)) continue;
      seen.add(c.word);
      const s = score(tail, c.tail);
      const kind = kindOf(s);
      if (kind !== "perfect" && kind !== "near") continue;
      made.push({ word: c.word, lang: "hu", score: s, kind, syllables: c.n, suffix: ending.end });
    }
    // Best match first, then the shortest: short stems are the common words.
    made.sort((a, b) => b.score - a.score || a.word.length - b.word.length);
    const own = sortCandidates(out, opts.syllables ?? 0).slice(0, opts.limit ?? 120);
    return [...own, ...made.slice(0, 80)];
  }
  return sortCandidates(out, opts.syllables ?? 0).slice(0, opts.limit ?? 120);
}

function sortCandidates(list: Candidate[], want: number): Candidate[] {
  return list.sort((a, b) => b.score - a.score
    || (want ? Math.abs(a.syllables - want) - Math.abs(b.syllables - want) : 0)
    || a.word.length - b.word.length);
}

export { FAMILIES };

// ── what a line should rhyme with ───────────────────────────────────────────

/* The rhyme button asks: I'm on this line, what am I rhyming with? Answered from the
 * structure, best evidence first:
 *   1. a warning on this line already names the line it should land on;
 *   2. the verse fits a known shape: the earlier line with this line's letter in it;
 *   3. it already rhymes with something: that;
 *   4. otherwise by position: every other line (ABAB) from the third line on, the line
 *      above for the second, the line below for the first.
 * A blank line right under a verse counts as that verse's next line, the one being
 * written. Returns the partner's line number, or null when there's nothing to go on. */
export function rhymeTarget(a: Analysis, lineNo: number, blank = false): number | null {
  let st: Stanza | undefined, k = -1;
  if (!blank) {
    st = a.stanzas.find((s) => s.lines.some((l) => l.index === lineNo));
    if (!st) return null;
    k = st.lines.findIndex((l) => l.index === lineNo);
    const named = st.findings.find((f) => f.line === lineNo && f.partner != null);
    if (named) return named.partner!;
  } else {
    st = a.stanzas.find((s) => s.lines[s.lines.length - 1]?.index === lineNo - 1);
    if (!st) return null;
    k = st.lines.length;
  }
  const lines = st.lines;
  if (st.pattern) {
    const tpl = repeatTemplate(st.pattern.template, Math.max(k + 1, lines.length));
    const before = lines.findIndex((l, j) => j < k && tpl[j] === tpl[k]);
    if (before >= 0) return lines[before].end ? lines[before].index : null;
  }
  const here = !blank ? lines[k] : null;
  if (here?.partners.length) return here.partners[0].line;
  const at = k >= 2 ? k - 2 : k === 1 ? 0 : lines.length > 1 && !blank ? 1 : -1;
  const p = lines[at];
  return p && p !== here && p.end ? p.index : null;
}
