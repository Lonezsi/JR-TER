import test from "node:test";
import assert from "node:assert/strict";
import { parseChord, voice, voiceLead, progressionToNotes, progressionFromText, progressionToText } from "../../web/daw/chords.js";

const iv = (s) => parseChord(s).intervals;

test("triads and sevenths", () => {
  assert.deepEqual(iv("C"), [0, 4, 7]);
  assert.deepEqual(iv("Cm"), [0, 3, 7]);
  assert.deepEqual(iv("C7"), [0, 4, 7, 10]);
  assert.deepEqual(iv("Cmaj7"), [0, 4, 7, 11]);
  assert.deepEqual(iv("Cm7b5"), [0, 3, 6, 10]);
  assert.deepEqual(iv("Cø"), [0, 3, 6, 10]);
  assert.deepEqual(iv("Cdim7"), [0, 3, 6, 9]);
  assert.deepEqual(iv("Caug"), [0, 4, 8]);
  assert.deepEqual(iv("Csus4"), [0, 5, 7]);
  assert.deepEqual(iv("C7sus4"), [0, 5, 7, 10]);
  assert.deepEqual(iv("Cm(maj7)"), [0, 3, 7, 11]);
  assert.deepEqual(iv("C5"), [0, 7]);
});

test("extensions and alterations, in any order", () => {
  assert.deepEqual(iv("C6/9"), [0, 4, 7, 9, 14]);
  assert.deepEqual(iv("Cmaj9"), [0, 4, 7, 11, 14]);
  assert.deepEqual(iv("Cm11"), [0, 3, 7, 10, 14, 17]);
  assert.deepEqual(iv("C13"), [0, 4, 7, 10, 14, 21]);
  assert.deepEqual(iv("C11"), [0, 7, 10, 14, 17], "a plain dominant 11 leaves out the third");
  assert.deepEqual(iv("C7#9b13"), [0, 4, 7, 10, 15, 20]);
  assert.deepEqual(iv("C7(b9,#11)"), [0, 4, 7, 10, 13, 18]);
  assert.deepEqual(iv("Cadd9"), [0, 4, 7, 14]);
  assert.deepEqual(iv("Cmaj7#11"), [0, 4, 7, 11, 18]);
  assert.deepEqual(iv("C7no5"), [0, 4, 10]);
});

test("roots, flats, sharps and slash basses", () => {
  assert.equal(parseChord("F#m7b5").root, 6);
  assert.deepEqual(iv("F#m7b5"), [0, 3, 6, 10]);
  assert.equal(parseChord("Bbmaj7#11").root, 10);
  const g = parseChord("G13/B");
  assert.equal(g.root, 7);
  assert.equal(g.bass, 11);
  assert.equal(parseChord("C6/9").bass, null, "6/9 is not a slash chord");
});

test("what it cannot read says so", () => {
  assert.throws(() => parseChord("H7"), /Can't read chord/);
  assert.throws(() => parseChord("Cxyz"), /Can't read chord/);
});

test("voicing: octave, inversion, drop, spread, bass", () => {
  const c = parseChord("C");
  assert.deepEqual(voice(c), [60, 64, 67]);
  assert.deepEqual(voice(c, { inversion: 1 }), [64, 67, 72]);
  assert.deepEqual(voice(c, { inversion: 2 }), [67, 72, 76]);
  assert.deepEqual(voice(c, { inversion: -1 }), [55, 60, 64]);
  assert.deepEqual(voice(c, { octave: 3 }), [48, 52, 55]);
  assert.deepEqual(voice(c, { spread: true }), [60, 67, 76]);
  assert.deepEqual(voice(c, { bass: true }), [48, 60, 64, 67]);
  const m7 = parseChord("Cmaj7");
  assert.deepEqual(voice(m7, { drop: 2 }), [55, 60, 64, 71]);
  assert.deepEqual(voice(m7, { drop: 3 }), [52, 60, 67, 71]);
  assert.deepEqual(voice(parseChord("C/G")), [55, 60, 64, 67]);
});

test("voice leading keeps the chords close", () => {
  const first = voice(parseChord("C"));
  const next = parseChord("F");
  const lead = voiceLead(first, next);
  const led = voice(next, lead);
  const plain = voice(next);
  const spread = (a) => Math.abs(a.reduce((x, y) => x + y, 0) / a.length - first.reduce((x, y) => x + y, 0) / first.length);
  assert.ok(spread(led) <= spread(plain));
  assert.equal(led.length, 3);
});

test("a progression becomes notes, one way", () => {
  const notes = progressionToNotes({ chords: [{ symbol: "C", beats: 2 }, { symbol: "G", beats: 2 }] }, { bpm: 120 });
  assert.equal(notes.length, 6);
  assert.deepEqual(notes.slice(0, 3).map((n) => n.start), [0, 0, 0]);
  assert.deepEqual(notes.slice(3).map((n) => n.start), [2, 2, 2]);
  assert.ok(notes.every((n) => n.length === 2 && n.velocity === 90));
});

test("strum offsets the notes low to high", () => {
  const notes = progressionToNotes({ chords: [{ symbol: "C", beats: 4 }], strumMs: 500 }, { bpm: 120 });
  assert.deepEqual(notes.map((n) => n.start), [0, 1, 2]);
});

test("the text form round trips", () => {
  const chords = progressionFromText("Cmaj9 Am7/G Dm9:2 | G13");
  assert.deepEqual(chords.map((c) => c.beats), [4, 4, 2, 4]);
  assert.equal(progressionToText(chords), "Cmaj9 Am7/G Dm9:2 G13");
  assert.throws(() => progressionFromText("C Zq"), /Can't read chord/);
  assert.throws(() => progressionFromText("C:x"), /length/);
});
