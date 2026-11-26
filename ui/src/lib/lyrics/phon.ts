/* How a word sounds, from how it is spelled, in Hungarian or English. No dictionary of
 * pronunciations and nothing over the network: Hungarian spelling is nearly phonemic, so
 * its rules are short and exact; English is not, so its rules are the common patterns plus
 * a list of exceptions, which is right for the ends of words (where rhymes live) far more
 * often than for their middles.
 *
 * A word becomes syllables. Each syllable has a vowel (a phoneme, from one inventory both
 * languages share, so a Hungarian line can rhyme with an English one), the consonants after
 * it up to the next vowel, and where its vowel letters are in the word, so the Words tab
 * can put a mark exactly under them.
 *
 * PUBLIC API
 *   VOWELS                      phoneme -> { family, long }
 *   FAMILIES                    the vowel families, in display order
 *   type Lang = "hu" | "en"
 *   sounds(word, lang)          -> Syl[]
 *   tailOf(syls, lang)          the part of a word a rhyme is made of
 *   guessLang(word, lexicon?)   "hu" | "en" | null (cannot tell)
 *   tokens(line)                the words of a line, with their offsets
 */

export type Lang = "hu" | "en";
export type Family = "a" | "e" | "i" | "o" | "ö" | "u" | "ü" | "ai" | "au" | "oi";
export const FAMILIES: Family[] = ["a", "e", "i", "o", "ö", "u", "ü", "ai", "au", "oi"];

/** Every vowel phoneme either language makes, with the family it is coloured by and
 *  whether it is long. A diphthong counts as long: it takes the time a long vowel does. */
export const VOWELS: Record<string, { family: Family; long: boolean }> = {
  // Hungarian
  "ɒ": { family: "a", long: false }, "aː": { family: "a", long: true },
  "ɛ": { family: "e", long: false }, "eː": { family: "e", long: true },
  "i": { family: "i", long: false }, "iː": { family: "i", long: true },
  "o": { family: "o", long: false }, "oː": { family: "o", long: true },
  "ø": { family: "ö", long: false }, "øː": { family: "ö", long: true },
  "u": { family: "u", long: false }, "uː": { family: "u", long: true },
  "y": { family: "ü", long: false }, "yː": { family: "ü", long: true },
  // English (short ones share Hungarian symbols where the sound is the same)
  "æ": { family: "a", long: false }, "ʌ": { family: "a", long: false }, "ɑː": { family: "a", long: true },
  "ɒ̆": { family: "o", long: false }, "ɔː": { family: "o", long: true }, "oʊ": { family: "o", long: true },
  "ɪ": { family: "i", long: false }, "eɪ": { family: "e", long: true },
  "ʊ": { family: "u", long: false }, "ɜː": { family: "ö", long: true }, "ə": { family: "ö", long: false },
  "aɪ": { family: "ai", long: true }, "aʊ": { family: "au", long: true }, "ɔɪ": { family: "oi", long: true },
};

export interface Syl {
  /** The vowel phoneme (a key of VOWELS). */
  v: string;
  /** Consonant phonemes before the vowel (the onset) and after it, up to the next vowel. */
  onset: string[];
  coda: string[];
  /** Where the vowel's letters are in the word: [start, end). */
  at: [number, number];
  /** Unstressed and reduced (English schwa endings): never where a rhyme starts. */
  weak?: boolean;
}

// ── tokens ──────────────────────────────────────────────────────────────────

const LETTER = /[a-záéíóöőúüűàâäèêëìîïòôùûçñ']/i;
/** The words of a line and where each starts. An apostrophe inside a word is part of it
 *  (don't, it's); one at either end is punctuation. */
export function tokens(line: string): { word: string; at: number }[] {
  const out: { word: string; at: number }[] = [];
  let i = 0;
  while (i < line.length) {
    if (!LETTER.test(line[i]) || line[i] === "'") { i++; continue; }
    let j = i;
    while (j < line.length && LETTER.test(line[j])) j++;
    let w = line.slice(i, j);
    while (w.endsWith("'")) w = w.slice(0, -1);
    if (w) out.push({ word: w, at: i });
    i = j;
  }
  return out;
}

// ── Hungarian ───────────────────────────────────────────────────────────────

const HU_VOWEL: Record<string, string> = {
  a: "ɒ", á: "aː", e: "ɛ", é: "eː", i: "i", í: "iː", o: "o", ó: "oː",
  ö: "ø", ő: "øː", u: "u", ú: "uː", ü: "y", ű: "yː",
};
// Longest first, so dzs wins over dz and cs over c.
const HU_CONS: [string, string][] = [
  ["dzs", "dʒ"], ["cs", "tʃ"], ["dz", "dz"], ["gy", "ɟ"], ["ly", "j"], ["ny", "ɲ"],
  ["sz", "s"], ["ty", "c"], ["zs", "ʒ"], ["s", "ʃ"], ["c", "ts"], ["j", "j"],
  ["b", "b"], ["d", "d"], ["f", "f"], ["g", "g"], ["h", "h"], ["k", "k"], ["l", "l"],
  ["m", "m"], ["n", "n"], ["p", "p"], ["r", "r"], ["t", "t"], ["v", "v"], ["z", "z"],
  ["x", "ks"], ["w", "v"], ["q", "k"], ["y", "i"],
];

function hungarian(word: string): Syl[] {
  const w = word.toLowerCase();
  const syls: Syl[] = [];
  let pending: string[] = [];
  let i = 0;
  while (i < w.length) {
    const ch = w[i];
    if (HU_VOWEL[ch]) {
      syls.push({ v: HU_VOWEL[ch], onset: pending, coda: [], at: [i, i + 1] });
      pending = [];
      i++;
      continue;
    }
    const hit = HU_CONS.find(([g]) => w.startsWith(g, i));
    if (!hit) { i++; continue; }
    let [g, p] = hit;
    // A doubled digraph is written with its first letter doubled: ssz, ccs, ggy, nny.
    if (g.length === 2 && w[i + 2] && w.startsWith(g[0] + g, i)) g = g[0] + g;
    const last = pending[pending.length - 1] ?? syls[syls.length - 1]?.coda.at(-1);
    if (last !== p) {                 // a long consonant sounds as one, for rhyme purposes
      if (syls.length && !pending.length) syls[syls.length - 1].coda.push(p);
      else pending.push(p);
    }
    i += g.length;
  }
  // What came after the last vowel is that syllable's coda; consonants between two
  // vowels belong to both the first's coda and the next's onset, which is what a rhyme
  // reads either way.
  if (syls.length) syls[syls.length - 1].coda.push(...pending);
  for (let k = 0; k < syls.length - 1; k++) {
    if (!syls[k].coda.length) syls[k].coda = [...syls[k + 1].onset];
  }
  return syls;
}

// ── English ─────────────────────────────────────────────────────────────────

/* Whole words whose spelling misleads the rules, at least in their vowel. Only common
 * lyric words; anything else is the rules' best guess. */
const EN_WORDS: Record<string, string[]> = {
  one: ["w", "ʌ", "n"], once: ["w", "ʌ", "n", "s"], two: ["t", "uː"], who: ["h", "uː"], do: ["d", "uː"], to: ["t", "uː"],
  you: ["j", "uː"], your: ["j", "ɔː", "r"], are: ["ɑː", "r"], were: ["w", "ɜː", "r"], where: ["w", "ɛ", "r"], there: ["ð", "ɛ", "r"],
  their: ["ð", "ɛ", "r"], here: ["h", "iː", "r"], have: ["h", "æ", "v"], give: ["g", "ɪ", "v"], live: ["l", "ɪ", "v"],
  love: ["l", "ʌ", "v"], above: ["ə", "b", "ʌ", "v"], move: ["m", "uː", "v"], prove: ["p", "r", "uː", "v"], come: ["k", "ʌ", "m"],
  some: ["s", "ʌ", "m"], done: ["d", "ʌ", "n"], none: ["n", "ʌ", "n"], gone: ["g", "ɒ̆", "n"], heart: ["h", "ɑː", "r", "t"],
  heard: ["h", "ɜː", "r", "d"], word: ["w", "ɜː", "r", "d"], world: ["w", "ɜː", "r", "l", "d"], work: ["w", "ɜː", "r", "k"],
  said: ["s", "ɛ", "d"], says: ["s", "ɛ", "z"], again: ["ə", "g", "ɛ", "n"], been: ["b", "ɪ", "n"], eye: ["aɪ"], eyes: ["aɪ", "z"],
  bye: ["b", "aɪ"], buy: ["b", "aɪ"], guy: ["g", "aɪ"], lie: ["l", "aɪ"], die: ["d", "aɪ"], tie: ["t", "aɪ"], pie: ["p", "aɪ"],
  friend: ["f", "r", "ɛ", "n", "d"], great: ["g", "r", "eɪ", "t"], break: ["b", "r", "eɪ", "k"], steak: ["s", "t", "eɪ", "k"],
  head: ["h", "ɛ", "d"], dead: ["d", "ɛ", "d"], bread: ["b", "r", "ɛ", "d"], read: ["r", "iː", "d"], dread: ["d", "r", "ɛ", "d"],
  breath: ["b", "r", "ɛ", "θ"], death: ["d", "ɛ", "θ"], wear: ["w", "ɛ", "r"], bear: ["b", "ɛ", "r"], pear: ["p", "ɛ", "r"],
  tear: ["t", "ɛ", "r"], swear: ["s", "w", "ɛ", "r"], could: ["k", "ʊ", "d"], would: ["w", "ʊ", "d"], should: ["ʃ", "ʊ", "d"],
  good: ["g", "ʊ", "d"], wood: ["w", "ʊ", "d"], stood: ["s", "t", "ʊ", "d"], blood: ["b", "l", "ʌ", "d"], flood: ["f", "l", "ʌ", "d"],
  put: ["p", "ʊ", "t"], push: ["p", "ʊ", "ʃ"], pull: ["p", "ʊ", "l"], full: ["f", "ʊ", "l"], bull: ["b", "ʊ", "l"], bush: ["b", "ʊ", "ʃ"],
  how: ["h", "aʊ"], now: ["n", "aʊ"], cow: ["k", "aʊ"], wow: ["w", "aʊ"], vow: ["v", "aʊ"], allow: ["ə", "l", "aʊ"], brow: ["b", "r", "aʊ"],
  soul: ["s", "oʊ", "l"], though: ["ð", "oʊ"], through: ["θ", "r", "uː"], thought: ["θ", "ɔː", "t"], taught: ["t", "ɔː", "t"],
  caught: ["k", "ɔː", "t"], bought: ["b", "ɔː", "t"], brought: ["b", "r", "ɔː", "t"], fought: ["f", "ɔː", "t"], laugh: ["l", "ɑː", "f"],
  enough: ["ɪ", "n", "ʌ", "f"], rough: ["r", "ʌ", "f"], tough: ["t", "ʌ", "f"], night: ["n", "aɪ", "t"], light: ["l", "aɪ", "t"],
  the: ["ð", "ə"], a: ["ə"], of: ["ʌ", "v"], was: ["w", "ɒ̆", "z"], what: ["w", "ɒ̆", "t"], want: ["w", "ɒ̆", "n", "t"],
  any: ["ɛ", "n", "i"], many: ["m", "ɛ", "n", "i"], only: ["oʊ", "n", "l", "i"], every: ["ɛ", "v", "r", "i"], i: ["aɪ"], me: ["m", "iː"],
  be: ["b", "iː"], he: ["h", "iː"], she: ["ʃ", "iː"], we: ["w", "iː"], my: ["m", "aɪ"], by: ["b", "aɪ"], sky: ["s", "k", "aɪ"],
  fly: ["f", "l", "aɪ"], cry: ["k", "r", "aɪ"], try: ["t", "r", "aɪ"], why: ["w", "aɪ"], high: ["h", "aɪ"], sigh: ["s", "aɪ"],
  go: ["g", "oʊ"], no: ["n", "oʊ"], so: ["s", "oʊ"], oh: ["oʊ"], ocean: ["oʊ", "ʃ", "ə", "n"], woman: ["w", "ʊ", "m", "ə", "n"],
  women: ["w", "ɪ", "m", "ɪ", "n"], water: ["w", "ɔː", "t", "ə", "r"], fire: ["f", "aɪ", "ə", "r"], desire: ["d", "ɪ", "z", "aɪ", "ə", "r"],
  hour: ["aʊ", "ə", "r"], our: ["aʊ", "ə", "r"], flower: ["f", "l", "aʊ", "ə", "r"], power: ["p", "aʊ", "ə", "r"],
  rain: ["r", "eɪ", "n"], pain: ["p", "eɪ", "n"],
};

/** Vowel spellings, longest first. The rule decides from what surrounds it. */
type Ctx = { w: string; i: number; end: number; syllables: number };
const EN_VOWEL_RULES: [string, (c: Ctx) => string | null][] = [
  ["eigh", () => "eɪ"], ["igh", () => "aɪ"], ["ough", () => "ɔː"],
  ["eau", () => "oʊ"], ["iou", () => "ə"],
  ["air", () => "ɛ"], ["are", (c) => (c.end === c.w.length ? "ɛ" : null)], ["ear", (c) => (/[bcdfghjklmnpqrstvwxz]/.test(c.w[c.end] || "") ? "ɜː" : "iː")],
  ["eer", () => "iː"], ["ire", () => "aɪ"], ["our", () => "aʊ"], ["oor", () => "ɔː"], ["ure", () => "ʊ"],
  ["ee", () => "iː"], ["ea", () => "iː"], ["ie", (c) => (c.end === c.w.length ? "aɪ" : "iː")], ["ei", () => "eɪ"], ["ey", (c) => (c.end === c.w.length ? "i" : "eɪ")],
  ["ay", () => "eɪ"], ["ai", () => "eɪ"], ["oa", () => "oʊ"], ["oe", () => "oʊ"], ["oi", () => "ɔɪ"], ["oy", () => "ɔɪ"],
  ["oo", (c) => (/^(k|d)/.test(c.w.slice(c.end)) && !/^(d$|de)/.test(c.w.slice(c.end + 1)) ? "ʊ" : "uː")],
  ["ou", (c) => (c.w.startsWith("ld", c.end) ? "ʊ" : c.end === c.w.length ? "uː" : "aʊ")],
  ["ow", (c) => (c.end === c.w.length || c.w[c.end] === "s" ? "oʊ" : "aʊ")],
  ["au", () => "ɔː"], ["aw", () => "ɔː"], ["ew", () => "uː"], ["ue", () => "uː"], ["ui", () => "uː"],
  ["ar", (c) => (/[aeiouy]/.test(c.w[c.end] || "") ? null : "ɑː")],
  ["or", (c) => (/[aeiouy]/.test(c.w[c.end] || "") ? null : "ɔː")],
  ["er", (c) => (/[aeiouy]/.test(c.w[c.end] || "") ? null : c.syllables > 0 && c.end === c.w.length ? "ə" : "ɜː")],
  ["ir", (c) => (/[aeiouy]/.test(c.w[c.end] || "") ? null : "ɜː")],
  ["ur", (c) => (/[aeiouy]/.test(c.w[c.end] || "") ? null : "ɜː")],
];
const MAGIC: Record<string, string> = { a: "eɪ", e: "iː", i: "aɪ", o: "oʊ", u: "uː", y: "aɪ" };
const SHORT: Record<string, string> = { a: "æ", e: "ɛ", i: "ɪ", o: "ɒ̆", u: "ʌ", y: "ɪ" };
const EN_CONS: [string, string[]][] = [
  ["tch", ["tʃ"]], ["dge", ["dʒ"]], ["sch", ["s", "k"]], ["ght", ["t"]], ["tion", ["ʃ", "ə", "n"]], ["sion", ["ʒ", "ə", "n"]],
  ["ch", ["tʃ"]], ["sh", ["ʃ"]], ["th", ["θ"]], ["ph", ["f"]], ["wh", ["w"]], ["ck", ["k"]], ["ng", ["ŋ"]], ["qu", ["k", "w"]],
  ["kn", ["n"]], ["wr", ["r"]], ["gh", []], ["mb", ["m"]],
  ["b", ["b"]], ["c", ["k"]], ["d", ["d"]], ["f", ["f"]], ["g", ["g"]], ["h", ["h"]], ["j", ["dʒ"]], ["k", ["k"]], ["l", ["l"]],
  ["m", ["m"]], ["n", ["n"]], ["p", ["p"]], ["r", ["r"]], ["s", ["s"]], ["t", ["t"]], ["v", ["v"]], ["w", ["w"]], ["x", ["k", "s"]],
  ["z", ["z"]],
];
const isV = (ch: string | undefined) => !!ch && "aeiouy".includes(ch);
/* Endings that are never stressed, so a rhyme starts before them: nation, station. */
const WEAK_ENDINGS = /(tion|sion|ing|ed|er|ly|ness|less|ful|est|en|le|y|ous|al|ment|able|ible|es|ish|ism|ist)$/;

function english(word: string): Syl[] {
  const w = word.toLowerCase().replace(/'/g, "");
  // Own entries only: a plain object also answers to constructor, toString and the like.
  const known = Object.prototype.hasOwnProperty.call(EN_WORDS, w) ? EN_WORDS[w] : undefined;
  if (known && known.length) return fromPhonemes(known, w);

  const syls: Syl[] = [];
  let pending: string[] = [];
  let i = 0;
  // A final e after a consonant is silent when there is another vowel before it, and it
  // makes that vowel long (hate, time, hope, cute) if only one consonant sits between.
  const silentE = w.length > 2 && w.endsWith("e") && !isV(w[w.length - 2]) && /[aeiouy]/.test(w.slice(0, -2));
  const lastIndex = silentE ? w.length - 1 : w.length;
  while (i < lastIndex) {
    const ch = w[i];
    if (isV(ch) && !(ch === "y" && i === 0)) {
      const ctx: Ctx = { w, i, end: i, syllables: syls.length };
      let rule: string | null = null, len = 1;
      for (const [spell, decide] of EN_VOWEL_RULES) {
        if (!w.startsWith(spell, i)) continue;
        const r = decide({ ...ctx, end: i + spell.length });
        if (r) { rule = r; len = spell.length; break; }
      }
      // ar/or/er/ir/ur keep the r as a consonant after the vowel.
      const rColoured = len === 2 && w[i + 1] === "r" && rule !== null;
      if (!rule) {
        const next = w.slice(i + 1);
        const magic = silentE && /^[^aeiouy]{1}e$/.test(next);
        const final = i === lastIndex - 1 && syls.length === 0 && ch !== "e";
        rule = magic ? MAGIC[ch] : final ? (ch === "y" ? "aɪ" : MAGIC[ch] ?? SHORT[ch]) : (ch === "y" && i === lastIndex - 1 ? "i" : SHORT[ch]);
      }
      const consumedR = rColoured ? 1 : 0;
      syls.push({ v: rule, onset: pending, coda: rColoured ? ["r"] : [], at: [i, i + len - consumedR] });
      pending = [];
      i += len;
      continue;
    }
    const hit = EN_CONS.find(([g]) => w.startsWith(g, i));
    if (!hit) { i++; continue; }
    const [g, ps] = hit;
    if (g === "tion" || g === "sion") {          // a whole weak syllable
      if (syls.length) syls[syls.length - 1].coda.push(ps[0]);
      syls.push({ v: "ə", onset: [ps[0]], coda: ["n"], at: [i + 1, i + 3], weak: true });
      pending = [];
      i += g.length;
      continue;
    }
    let phon = ps;
    if (g === "c" && /[eiy]/.test(w[i + 1] || "")) phon = ["s"];
    if (g === "g" && /[eiy]/.test(w[i + 1] || "") && i > 0) phon = ["dʒ"];
    if (g === "s" && i === w.length - 1 && i > 0 && !/[ptkf]/.test(w[i - 1])) phon = ["z"];
    const prev = pending[pending.length - 1] ?? syls[syls.length - 1]?.coda.at(-1);
    for (const p of phon) {
      if (p === prev) continue;
      if (syls.length && !pending.length && !isV(w[i + g.length])) syls[syls.length - 1].coda.push(p);
      else pending.push(p);
    }
    i += g.length;
  }
  if (silentE && syls.length === 0) syls.push({ v: "iː", onset: pending, coda: [], at: [w.length - 1, w.length] });
  else if (syls.length) syls[syls.length - 1].coda.push(...pending);
  // A final -le after a consonant is its own weak syllable (table, little).
  if (w.length > 3 && w.endsWith("le") && !isV(w[w.length - 3]) && syls.length) {
    const last = syls[syls.length - 1];
    last.coda = last.coda.filter((p) => p !== "l");
    syls.push({ v: "ə", onset: [], coda: ["l"], at: [w.length - 1, w.length], weak: true });
  }
  for (let k = 0; k < syls.length - 1; k++) if (!syls[k].coda.length) syls[k].coda = [...syls[k + 1].onset];
  markWeak(syls, w);
  return syls;
}

function fromPhonemes(ps: string[], w: string): Syl[] {
  const syls: Syl[] = [];
  let pending: string[] = [];
  // Without letter positions from the rules, spread the vowels over the vowel letters.
  const groups: [number, number][] = [];
  for (let i = 0; i < w.length;) {
    if (isV(w[i])) { let j = i; while (j < w.length && isV(w[j])) j++; groups.push([i, j]); i = j; } else i++;
  }
  for (const p of ps) {
    if (VOWELS[p]) {
      const at = groups[syls.length] ?? groups[groups.length - 1] ?? [0, w.length];
      syls.push({ v: p, onset: pending, coda: [], at });
      pending = [];
    } else if (syls.length && !pending.length) {
      syls[syls.length - 1].coda.push(p);
    } else pending.push(p);
  }
  if (syls.length) syls[syls.length - 1].coda.push(...pending);
  for (let k = 0; k < syls.length - 1; k++) if (!syls[k].coda.length) syls[k].coda = [...syls[k + 1].onset];
  markWeak(syls, w);
  return syls;
}

function markWeak(syls: Syl[], w: string) {
  if (syls.length < 2) return;
  const last = syls[syls.length - 1];
  if (last.v === "ə" || (WEAK_ENDINGS.test(w) && !VOWELS[last.v]?.long)) last.weak = true;
  for (const s of syls) if (s.v === "ə") s.weak = true;
}

// ── both ────────────────────────────────────────────────────────────────────

const cache = new Map<string, Syl[]>();
export function sounds(word: string, lang: Lang): Syl[] {
  const key = lang + ":" + word.toLowerCase();
  let hit = cache.get(key);
  if (!hit) {
    hit = lang === "hu" ? hungarian(word) : english(word);
    if (cache.size > 20000) cache.clear();
    cache.set(key, hit);
  }
  return hit;
}

/** The part of a word a rhyme is made of. In English, from the last syllable that is not a
 *  weak ending (station: -ation). In Hungarian, the last two syllables: a Hungarian rhyme
 *  is heard over both, and agreeing vowels there (asszonánc) already count. */
export function tailOf(syls: Syl[], lang: Lang): Syl[] {
  if (!syls.length) return [];
  if (lang === "hu") return syls.slice(-2);
  let k = syls.length - 1;
  while (k > 0 && syls[k].weak) k--;
  return syls.slice(Math.max(0, k));
}

/* A handful of Hungarian words with no accent and no Hungarian-only letter pair, which a
 * spelling test would otherwise take for English. */
const HU_COMMON = new Set(("a az egy hogy nem van volt lesz meg mert de ha ez azt csak is "
  + "mint most majd mi te ti ok en el fel ki be le ne se sem itt ott igen jo rossz mind "
  + "minden semmi soha mindig talan holnap tegnap ma ma este reggel ejjel szerelem szivem "
  + "szeretlek vagy vagyok leszek lehet kell akar tud nagy kis uj regi hol mikor miert "
  + "ugy igy dal dalom halal elet").split(" "));

/** Which language a word is in, from its letters and the two word lists when they are
 *  loaded. null when nothing tells them apart (a line's other words then decide). */
export function guessLang(word: string, lexicon?: { hu: Set<string>; en: Set<string> } | null): Lang | null {
  const w = word.toLowerCase();
  if (/[áéíóöőúüű]/.test(w)) return "hu";
  if (/(sz|zs|gy|ty|cs|dzs)/.test(w) || /ny[aeiouáéíóöőúüű]/.test(w) || /ly$/.test(w) && w.length < 4) return "hu";
  if (/(th|wh|ck|w|ph|ght|oo|ee|ea|ou)/.test(w) || /q/.test(w)) return "en";
  if (lexicon) {
    const hu = lexicon.hu.has(w), en = lexicon.en.has(w);
    if (hu && !en) return "hu";
    if (en && !hu) return "en";
  }
  if (HU_COMMON.has(w)) return "hu";
  return null;
}
