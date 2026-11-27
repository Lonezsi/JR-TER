import test from "node:test";
import assert from "node:assert/strict";
import { songNotes, songBars, addClip, moveClip, resizeClip, splitClip, removeClip, cleanClips, cleanLoop, setLoop, moveLoop, inSpan } from "../../web/daw/playlist.js";
import { songToText, textToSong, TEXT_VERSION } from "../../web/daw/midi.js";
import { addPattern, removePattern, emptySteps } from "../../web/daw/pattern.js";

const mk = () => ({
  bars: 2, swing: 0, pattern: 0, clips: [], patterns: [{ name: "Pattern 1", tracks: [] }],
  tracks: [{ name: "P", instrument: "piano", key: 60, steps: emptySteps(), notes: [{ pitch: 60, start: 0, length: 1, velocity: 90 }, { pitch: 64, start: 4, length: 1, velocity: 90 }] }],
});

test("a clip places the pattern's notes at its start bar", () => {
  const s = mk(); addClip(s, 0, 0, 3);
  assert.deepEqual(songNotes(s)[0].map((n) => n.start), [12, 16]);
  assert.equal(songBars(s), 5);
});

test("a clip longer than the pattern repeats it, and is trimmed at its end", () => {
  const s = mk(); addClip(s, 0, 0, 0); resizeClip(s, 0, 5);
  assert.deepEqual(songNotes(s)[0].map((n) => n.start), [0, 4, 8, 12, 16]);
  resizeClip(s, 0, 1);
  assert.deepEqual(songNotes(s)[0].map((n) => n.start), [0]);
});

test("a split keeps the second half playing from where the first stopped", () => {
  const s = mk(); addClip(s, 0, 0, 0);
  assert.equal(splitClip(s, 0, 0), false);
  assert.equal(splitClip(s, 0, 1), true);
  assert.deepEqual(s.clips.map((c) => [c.start, c.length, c.offset]), [[0, 1, 0], [1, 1, 1]]);
  assert.deepEqual(songNotes(s)[0].map((n) => n.start), [0, 4]);
});

test("moving and removing clips", () => {
  const s = mk(); addClip(s, 0, 0, 0); moveClip(s, 0, 3, 5);
  assert.deepEqual([s.clips[0].lane, s.clips[0].start], [3, 5]);
  removeClip(s, 0);
  assert.equal(s.clips.length, 0);
});

test("adding and deleting patterns keeps clips pointing at the right pattern", () => {
  const s = mk(); addPattern(s, false); // pattern 2 at index 1
  addClip(s, 1, 0, 0); addClip(s, 0, 1, 0);
  addPattern(s, false); // now edited = 1 -> new at index 2
  assert.deepEqual(s.clips.map((c) => c.pattern), [1, 0]);
  s.patterns = s.patterns; removePattern(s, 1);
  assert.deepEqual(s.clips.map((c) => c.pattern), [0]);
});

test("cleanClips drops bad clips and clamps the rest", () => {
  const out = cleanClips([{ pattern: 0, lane: 99, start: -3, length: 0 }, { pattern: 5 }, null, { pattern: "x" }], 2);
  assert.deepEqual(out, [{ pattern: 0, lane: 15, start: 0, length: 0.0625, offset: 0 }]);
});

test("clips can sit between bars, down to a sixteenth of a bar", () => {
  const s = mk(); addClip(s, 0, 0, 1.5);
  assert.equal(s.clips[0].start, 1.5);
  assert.deepEqual(songNotes(s)[0].map((n) => n.start), [6, 10]);
  moveClip(s, 0, 0, 2.03);
  assert.equal(s.clips[0].start, 2);          // 2.03 snaps to the sixteenth grid: 2
  moveClip(s, 0, 0, 2.07);
  assert.equal(s.clips[0].start, 2.0625);
  resizeClip(s, 0, 0.01);
  assert.equal(s.clips[0].length, 0.0625);    // never shorter than a sixteenth of a bar
  assert.deepEqual(cleanClips([{ pattern: 0, lane: 0, start: 0.5, length: 0.25, offset: 0.125 }], 1), [{ pattern: 0, lane: 0, start: 0.5, length: 0.25, offset: 0.125 }]);
});

test("a clip split between bars keeps both halves in step", () => {
  const s = mk(); addClip(s, 0, 0, 0); resizeClip(s, 0, 2);
  assert.equal(splitClip(s, 0, 0.5), true);
  assert.deepEqual(s.clips.map((c) => [c.start, c.length, c.offset]), [[0, 0.5, 0], [0.5, 1.5, 0.5]]);
});

test("cleanLoop refuses garbage, orders and rounds a range", () => {
  assert.equal(cleanLoop(null), null);
  assert.equal(cleanLoop({ from: "x", to: 3 }), null);
  assert.equal(cleanLoop({ from: 2, to: 2 }), null);
  assert.deepEqual(cleanLoop({ from: 3, to: 1 }), { from: 1, to: 3 });
  assert.deepEqual(cleanLoop({ from: 0.51, to: 2 }), { from: 0.5, to: 2 });
});

test("setLoop with an empty range clears it; moveLoop keeps the length and stays in range", () => {
  const s = mk();
  assert.deepEqual(setLoop(s, 1, 3), { from: 1, to: 3 });
  moveLoop(s, -5);
  assert.deepEqual(s.loop, { from: 0, to: 2 });
  moveLoop(s, 1.5);
  assert.deepEqual(s.loop, { from: 1.5, to: 3.5 });
  setLoop(s, 2, 2);
  assert.equal("loop" in s, false);
});

test("inSpan keeps what sounds in the range, moved so the range starts at 0", () => {
  const notes = [{ start: 0, length: 2 }, { start: 5, length: 4 }, { start: 9, length: 1 }, { start: 20, length: 1 }];
  assert.deepEqual(inSpan(notes, 4, 8), [{ start: 1, length: 3 }]);
  const audio = [{ track: 0, start: 2, length: 8, offset: 1 }];
  assert.deepEqual(inSpan(audio, 4, 8), [{ track: 0, start: 0, length: 4, offset: 3 }]);
  assert.deepEqual(inSpan(audio, 12, 16), []);
});

test("the loop is saved in the text, and the format version stays 11", () => {
  const s = textToSong(songToText({ ...textToSong(JSON.stringify({ format: "jriter-daw", version: 1, bpm: 120, bars: 2, tracks: [{ name: "P", instrument: "piano", notes: [] }] })), loop: { from: 1, to: 3 } }));
  assert.deepEqual(s.loop, { from: 1, to: 3 });
  const j = JSON.parse(songToText(s));
  assert.deepEqual(j.loop, { from: 1, to: 3 });
  delete s.loop;
  assert.equal("loop" in JSON.parse(songToText(s)), false);
  assert.equal(TEXT_VERSION, 11);
});
