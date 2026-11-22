import test from "node:test";
import assert from "node:assert/strict";
import { stepsToNotes, allNotes, emptySteps, usePattern, addPattern, removePattern, removeTrackEverywhere, withPatterns } from "../../web/daw/pattern.js";

const on = (i) => ({ velocity: 100, pitch: 36 });
const mk = () => {
  const steps = emptySteps(); steps[0] = on(); steps[1] = on();
  return { bars: 2, swing: 0, pattern: 0, patterns: [{ name: "Pattern 1", tracks: [] }],
    tracks: [{ name: "K", instrument: "drums", key: 36, notes: [{ pitch: 60, start: 0, length: 1, velocity: 90 }], steps }] };
};

test("steps become notes, repeat over bars, swing delays only odd steps", () => {
  const s = emptySteps(); s[0] = on(); s[1] = on();
  const n = stepsToNotes(s, 1, 2);
  assert.equal(n.length, 4);
  assert.deepEqual(n.map((x) => x.start), [0, 0.25 + 0.125, 4, 4.375]);
  assert.equal(stepsToNotes(s, 0, 1)[1].start, 0.25);
});

test("allNotes joins roll notes and steps", () => {
  const song = mk();
  assert.equal(allNotes(song.tracks[0], song).length, 1 + 4);
});

test("each pattern keeps its own notes and steps", () => {
  const song = mk();
  addPattern(song, false);
  assert.equal(song.pattern, 1);
  assert.equal(song.tracks[0].notes.length, 0);
  assert.ok(song.tracks[0].steps.every((x) => x === null));
  song.tracks[0].steps[5] = on();
  usePattern(song, 0);
  assert.equal(song.tracks[0].notes.length, 1);
  assert.ok(song.tracks[0].steps[0] && !song.tracks[0].steps[5]);
  usePattern(song, 1);
  assert.ok(song.tracks[0].steps[5]);
});

test("duplicate copies, delete keeps at least one", () => {
  const song = mk();
  addPattern(song, true);
  assert.equal(song.patterns.length, 2);
  assert.equal(song.tracks[0].notes.length, 1);
  assert.equal(removePattern(song, 1), true);
  assert.equal(song.patterns.length, 1);
  assert.equal(removePattern(song, 0), false);
});

test("a track added later is empty in older patterns; removing a track clears it everywhere", () => {
  const song = mk();
  addPattern(song, false);
  song.tracks.push({ name: "H", instrument: "drums", key: 42, notes: [], steps: emptySteps() });
  song.tracks[1].steps[2] = on();
  usePattern(song, 0);
  assert.ok(song.tracks[1].steps.every((x) => x === null));
  removeTrackEverywhere(song, 0);
  assert.equal(song.tracks.length, 1);
  assert.ok(withPatterns(song).every((p) => p.tracks.length <= 1));
});
