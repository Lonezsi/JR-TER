// chords.js: chord symbols to notes. Pure functions, no DOM, so it runs in Node (tests/daw).
//
// One way only. A chord symbol becomes MIDI notes and that is the end of it: nothing here
// looks at notes and works out what chord they are. Once the notes are in a track they are
// just notes.
//
//   parseChord("G13/B")  -> { root: 7, intervals: [0,4,7,10,14,21], bass: 11 }
//   voice(chord, { octave: 4, inversion: 1, drop: 2 })   -> MIDI pitches, ascending
//   progressionToNotes(progression, { bpm })             -> notes for a track
//
// Intervals are semitones above the root and may pass 12 (a 9th is 14, a 13th is 21), so a
// chord keeps its extensions above the triad when it is voiced.

const LETTER = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
export const ROOT_NAMES = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];

function pitchClass(text) {
  const m = /^([A-Ga-g])([#b♯♭]?)$/.exec(text);
  if (!m) return null;
  return (LETTER[m[1].toUpperCase()] + (m[2] === "#" || m[2] === "♯" ? 1 : m[2] ? -1 : 0) + 12) % 12;
}

// Every token a symbol can be made of. Read longest first, in any order, so "C7#9b13",
// "Cm7b5", "Cmaj9#11" and "C7sus4" all fall out of the same loop.
// Each one edits a small state; intervals are worked out once, at the end.
const TOKENS = [
  // major sevenths and their extensions
  ["maj13", (s) => { s.third = s.third || "maj"; s.seventh = "maj"; s.ext9 = 0; s.ext13 = 0; s.explicit = true; }],
  ["maj11", (s) => { s.third = s.third || "maj"; s.seventh = "maj"; s.ext9 = 0; s.ext11 = 0; s.explicit = true; }],
  ["maj9", (s) => { s.third = s.third || "maj"; s.seventh = "maj"; s.ext9 = 0; s.explicit = true; }],
  ["maj7", (s) => { s.third = s.third || "maj"; s.seventh = "maj"; s.explicit = true; }],
  ["Δ7", (s) => { s.third = s.third || "maj"; s.seventh = "maj"; s.explicit = true; }],
  ["M7", (s) => { s.third = s.third || "maj"; s.seventh = "maj"; s.explicit = true; }],
  ["Δ", (s) => { s.third = s.third || "maj"; s.seventh = "maj"; s.explicit = true; }],
  ["maj", (s) => { s.third = "maj"; s.explicit = true; }],
  // minor with a major seventh
  ["m(maj7)", (s) => { s.third = "min"; s.seventh = "maj"; s.explicit = true; }],
  ["minMaj7", (s) => { s.third = "min"; s.seventh = "maj"; s.explicit = true; }],
  ["mMaj7", (s) => { s.third = "min"; s.seventh = "maj"; s.explicit = true; }],
  ["mM7", (s) => { s.third = "min"; s.seventh = "maj"; s.explicit = true; }],
  // half diminished, diminished
  ["m7b5", (s) => { s.third = "min"; s.fifth = -1; s.seventh = "min"; s.explicit = true; }],
  ["ø7", (s) => { s.third = "min"; s.fifth = -1; s.seventh = "min"; s.explicit = true; }],
  ["ø", (s) => { s.third = "min"; s.fifth = -1; s.seventh = "min"; s.explicit = true; }],
  ["dim7", (s) => { s.third = "min"; s.fifth = -1; s.seventh = "dim"; s.explicit = true; }],
  ["°7", (s) => { s.third = "min"; s.fifth = -1; s.seventh = "dim"; s.explicit = true; }],
  ["dim", (s) => { s.third = "min"; s.fifth = -1; s.explicit = true; }],
  ["°", (s) => { s.third = "min"; s.fifth = -1; s.explicit = true; }],
  // minor
  ["m13", (s) => { s.third = "min"; s.seventh = s.seventh || "min"; s.ext9 = 0; s.ext13 = 0; s.explicit = true; }],
  ["m11", (s) => { s.third = "min"; s.seventh = s.seventh || "min"; s.ext9 = 0; s.ext11 = 0; s.explicit = true; }],
  ["m9", (s) => { s.third = "min"; s.seventh = s.seventh || "min"; s.ext9 = 0; s.explicit = true; }],
  ["m7", (s) => { s.third = "min"; s.seventh = "min"; s.explicit = true; }],
  ["m6", (s) => { s.third = "min"; s.sixth = true; s.explicit = true; }],
  ["min", (s) => { s.third = "min"; s.explicit = true; }],
  ["mi", (s) => { s.third = "min"; s.explicit = true; }],
  ["m", (s) => { s.third = "min"; s.explicit = true; }],
  ["-", (s) => { s.third = "min"; s.explicit = true; }],
  // augmented, suspended, power
  ["aug", (s) => { s.fifth = 1; s.explicit = true; }],
  ["+", (s) => { s.fifth = 1; s.explicit = true; }],
  ["sus2", (s) => { s.third = "sus2"; s.explicit = true; }],
  ["sus4", (s) => { s.third = "sus4"; s.explicit = true; }],
  ["sus", (s) => { s.third = "sus4"; s.explicit = true; }],
  // numbers
  ["6/9", (s) => { s.sixth = true; s.ext9 = 0; }],
  ["69", (s) => { s.sixth = true; s.ext9 = 0; }],
  ["13", (s) => { s.seventh = s.seventh || "min"; s.ext9 = 0; s.ext13 = 0; }],
  ["11", (s) => { s.seventh = s.seventh || "min"; s.ext9 = 0; s.ext11 = 0; if (!s.explicit) s.no3 = true; }],
  ["9", (s) => { s.seventh = s.seventh || "min"; s.ext9 = 0; }],
  ["7", (s) => { s.seventh = s.seventh || "min"; }],
  ["6", (s) => { s.sixth = true; }],
  ["5", (s) => { s.power = true; }],
  // alterations and additions
  ["b5", (s) => { s.fifth = -1; }],
  ["#5", (s) => { s.fifth = 1; }],
  ["b9", (s) => { s.seventh = s.seventh || "min"; s.ext9 = -1; }],
  ["#9", (s) => { s.seventh = s.seventh || "min"; s.ext9 = 1; }],
  ["#11", (s) => { s.seventh = s.seventh || "min"; s.ext11 = 1; }],
  ["b13", (s) => { s.seventh = s.seventh || "min"; s.ext13 = -1; }],
  ["add2", (s) => { s.adds.push(2); }],
  ["add4", (s) => { s.adds.push(5); }],
  ["add9", (s) => { s.adds.push(14); }],
  ["add11", (s) => { s.adds.push(17); }],
  ["add13", (s) => { s.adds.push(21); }],
  ["no3", (s) => { s.no3 = true; }],
  ["no5", (s) => { s.no5 = true; }],
].sort((a, b) => b[0].length - a[0].length);

export function parseChord(symbol) {
  const text = String(symbol).trim();
  const m = /^([A-Ga-g][#b♯♭]?)(.*)$/.exec(text);
  if (!m) throw new Error("Can't read chord " + JSON.stringify(text));
  const root = pitchClass(m[1]);
  let rest = m[2], bass = null;
  const slash = /\/([A-Ga-g][#b♯♭]?)$/.exec(rest);
  if (slash) { bass = pitchClass(slash[1]); rest = rest.slice(0, slash.index); }

  const s = { third: null, fifth: 0, seventh: null, sixth: false, ext9: null, ext11: null, ext13: null,
    adds: [], no3: false, no5: false, power: false, explicit: false };
  let i = 0;
  while (i < rest.length) {
    if ("(), ".includes(rest[i])) { i++; continue; }
    const hit = TOKENS.find(([t]) => rest.startsWith(t, i));
    if (!hit) throw new Error("Can't read chord " + JSON.stringify(text) + " at " + JSON.stringify(rest.slice(i)));
    hit[1](s);
    i += hit[0].length;
  }

  const iv = new Set([0]);
  if (s.power) iv.add(7);
  else {
    if (!s.no3) iv.add({ min: 3, sus2: 2, sus4: 5 }[s.third] ?? 4);
    if (!s.no5) iv.add(7 + s.fifth);
  }
  if (s.sixth) iv.add(9);
  if (s.seventh) iv.add({ maj: 11, min: 10, dim: 9 }[s.seventh]);
  if (s.ext9 !== null) iv.add(14 + s.ext9);
  if (s.ext11 !== null) iv.add(17 + s.ext11);
  if (s.ext13 !== null) iv.add(21 + s.ext13);
  for (const a of s.adds) iv.add(a);
  return { root, intervals: [...iv].sort((a, b) => a - b), bass };
}

const clampPitch = (p) => { while (p < 0) p += 12; while (p > 127) p -= 12; return p; };

// opts: octave (4 puts C at 60), inversion (+n lifts the lowest note an octave, n times; -n
// drops the highest), drop (0 | 2 | 3 | 24), spread, bass (add the root, or the slash bass,
// below). A slash chord always has its bass.
export function voice(chord, opts = {}) {
  const { octave = 4, inversion = 0, drop = 0, spread = false } = opts;
  const base = (octave + 1) * 12 + chord.root;
  let notes = chord.intervals.map((i) => base + i);
  for (let k = 0; k < Math.abs(inversion); k++) {
    notes.sort((a, b) => a - b);
    if (inversion > 0) notes.push(notes.shift() + 12);
    else notes.unshift(notes.pop() - 12);
  }
  notes.sort((a, b) => a - b);
  const dropFrom = (nth) => { if (notes.length > nth) { const at = notes.length - nth; notes[at] -= 12; notes.sort((a, b) => a - b); } };
  if (drop === 2) dropFrom(2);
  else if (drop === 3) dropFrom(3);
  else if (drop === 24) { dropFrom(2); dropFrom(4); }
  if (spread) notes = notes.map((p, i) => (i % 2 === 1 ? p + 12 : p)).sort((a, b) => a - b);
  if (chord.bass !== null || opts.bass) {
    const pc = chord.bass !== null ? chord.bass : chord.root;
    const low = notes[0] - 1;
    notes.unshift(low - ((((low - pc) % 12) + 12) % 12));
  }
  return [...new Set(notes.map(clampPitch))].sort((a, b) => a - b);
}

// The inversion and octave that move the least from the previous chord's notes.
export function voiceLead(prev, chord, opts = {}) {
  const baseOctave = opts.octave ?? 4;
  let best = null;
  for (let d = -1; d <= 1; d++) {
    for (let inv = -3; inv <= 3; inv++) {
      const cand = voice(chord, { ...opts, octave: baseOctave + d, inversion: inv });
      const near = (x, list) => Math.min(...list.map((y) => Math.abs(x - y)));
      const cost = cand.reduce((t, p) => t + near(p, prev), 0) + prev.reduce((t, p) => t + near(p, cand), 0);
      const key = [cost, Math.abs(inv) + Math.abs(d), Math.abs(d)];
      if (!best || key[0] < best.key[0] || (key[0] === best.key[0] && (key[1] < best.key[1]))) best = { key, octave: baseOctave + d, inversion: inv };
    }
  }
  return { octave: best.octave, inversion: best.inversion };
}

// progression: { chords: [{ symbol, beats, inversion?, octave?, drop?, spread?, bass?, velocity? }],
//                voiceLead?: bool, strumMs?: number, velocity?: number }
// A chord's own inversion or octave wins over voice leading ("auto" is leaving both unset).
// Returns one entry per chord, with the pitches it is voiced to and where it starts in beats.
export function voiceProgression(prog) {
  const out = [];
  let at = 0, prev = null;
  for (const c of prog.chords) {
    const chord = parseChord(c.symbol);
    const o = { octave: c.octave ?? 4, inversion: c.inversion ?? 0, drop: c.drop ?? 0, spread: !!c.spread, bass: !!c.bass };
    if (prog.voiceLead && prev && c.inversion === undefined && c.octave === undefined) Object.assign(o, voiceLead(prev, chord, o));
    const pitches = voice(chord, o);
    const beats = c.beats ?? 4;
    out.push({ chord: c, pitches, start: at, beats });
    prev = pitches;
    at += beats;
  }
  return out;
}

export function progressionToNotes(prog, { bpm = 120 } = {}) {
  const step = ((prog.strumMs || 0) / 1000) * (bpm / 60);
  const out = [];
  for (const v of voiceProgression(prog)) {
    v.pitches.forEach((p, i) => out.push({
      pitch: p, start: v.start + i * step, length: Math.max(1 / 16, v.beats - i * step), velocity: v.chord.velocity ?? prog.velocity ?? 90,
    }));
  }
  return out;
}

export function progressionFromText(text) {
  const chords = [];
  for (const tok of String(text).split(/[\s|]+/).filter(Boolean)) {
    const colon = tok.lastIndexOf(":");
    const symbol = colon > 0 ? tok.slice(0, colon) : tok;
    const beats = colon > 0 ? Number(tok.slice(colon + 1)) : 4;
    if (!(beats > 0)) throw new Error("Can't read the length in " + JSON.stringify(tok));
    parseChord(symbol); // throws a readable error
    chords.push({ symbol, beats });
  }
  return chords;
}
export const progressionToText = (chords) => chords.map((c) => c.symbol + ((c.beats ?? 4) !== 4 ? ":" + c.beats : "")).join(" ");

export const DEFAULT_PROGRESSION = { chords: [
  { symbol: "Cmaj9", beats: 4 }, { symbol: "Am9", beats: 4 }, { symbol: "Dm9", beats: 4 }, { symbol: "G13", beats: 4 },
], voiceLead: true, strumMs: 0, velocity: 90 };
