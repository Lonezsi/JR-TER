import test from "node:test";
import assert from "node:assert/strict";
import { songNotes, songBars, addClip, moveClip, resizeClip, splitClip, removeClip, cleanClips } from "../../web/daw/playlist.js";
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
  assert.deepEqual(out, [{ pattern: 0, lane: 15, start: 0, length: 1, offset: 0 }]);
});
