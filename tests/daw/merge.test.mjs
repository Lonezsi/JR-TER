import test from "node:test";
import assert from "node:assert/strict";
import { merge3, mergeTexts } from "../../web/daw/merge.js";

const base = { bpm: 120, tracks: [{ name: "a", volume: 1, notes: [1] }, { name: "b", volume: 1, notes: [] }] };
const clone = (x) => JSON.parse(JSON.stringify(x));

test("edits to different tracks are both kept", () => {
  const mine = clone(base); mine.tracks[0].volume = 0.5;
  const theirs = clone(base); theirs.tracks[1].name = "bass";
  const m = merge3(base, mine, theirs);
  assert.equal(m.tracks[0].volume, 0.5);
  assert.equal(m.tracks[1].name, "bass");
});
test("the same field changed by both: mine wins", () => {
  const mine = clone(base); mine.bpm = 100;
  const theirs = clone(base); theirs.bpm = 140;
  assert.equal(merge3(base, mine, theirs).bpm, 100);
});
test("a track added by one side and a knob turned by the other: both", () => {
  const mine = clone(base); mine.tracks.push({ name: "c", volume: 1, notes: [] });
  const theirs = clone(base); theirs.tracks[0].volume = 0.2;
  const m = merge3(base, mine, theirs);
  assert.equal(m.tracks.length, 3);
  assert.equal(m.tracks[0].volume, 0.2);
});
test("a new key from the other side comes in, a removed one stays removed", () => {
  const mine = clone(base); mine.swing = 0.3;
  const theirs = clone(base); delete theirs.bpm;
  const m = merge3(base, mine, theirs);
  assert.equal(m.swing, 0.3);
  assert.equal("bpm" in m, false);
});
test("mergeTexts works with no base", () => {
  const t = mergeTexts("", JSON.stringify({ a: 1 }), JSON.stringify({ a: 1, b: 2 }));
  assert.deepEqual(JSON.parse(t), { a: 1, b: 2 });
});
