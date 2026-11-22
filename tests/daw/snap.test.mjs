import test from "node:test";
import assert from "node:assert/strict";
import { autoStep, stepFor, snapFloor, snapRound, loadSnap, saveSnap, ROLL_STEPS, SONG_STEPS } from "../../web/daw/snap.js";

test("auto snap gets finer as you zoom in", () => {
  assert.equal(autoStep(64, 14), 0.25);       // a mouse at zoom 1: sixteenths
  assert.equal(autoStep(64, 22), 0.5);        // a thumb at zoom 1: eighths
  assert.equal(autoStep(256, 14), 0.125);     // zoomed in 4x
  assert.equal(autoStep(16, 14), 1);          // zoomed out 4x: beats
  assert.equal(autoStep(2, 14), 4);           // far out: bars
});
test("auto never picks a triplet, a chosen one is used as it is", () => {
  for (const px of [4, 8, 16, 32, 64, 128, 256, 512]) assert.ok(![1 / 3, 1 / 6].includes(autoStep(px, 14)));
  assert.equal(stepFor("1/3", 64, 14), 1 / 3);
  assert.equal(stepFor("none", 64, 14), 0);
  assert.equal(stepFor("auto", 64, 14), 0.25);
  assert.equal(stepFor("nonsense", 64, 14), 0.25);
});
test("the song tab at today's 36 px a bar snaps to bars; zoomed in it snaps finer", () => {
  assert.equal(autoStep(36 / 4, 24, SONG_STEPS), 4);
  assert.equal(autoStep((36 * 4) / 4, 24, SONG_STEPS), 1);
  assert.equal(autoStep((36 * 16) / 4, 24, SONG_STEPS), 0.25);
});
test("floor and round, with thirds and no snap", () => {
  assert.equal(snapFloor(1.9, 0.5), 1.5);
  assert.equal(snapRound(1.9, 0.5), 2);
  assert.equal(snapFloor(1.0, 1 / 3), 1);
  assert.equal(snapRound(0.34, 1 / 3), 0.333333);
  assert.equal(snapFloor(1.37, 0), 1.37);
  assert.equal(snapRound(1.37, 0), 1.37);
});
test("the setting is remembered, and junk falls back to auto", () => {
  const mem = new Map();
  const store = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, v) };
  assert.deepEqual(loadSnap(store), { roll: "auto", song: "auto" });
  saveSnap(store, { roll: "1/2", song: "none" });
  assert.deepEqual(loadSnap(store), { roll: "1/2", song: "none" });
  saveSnap(store, { roll: "4bar", song: "1/8" }); // not offered there
  assert.deepEqual(loadSnap(store), { roll: "auto", song: "auto" });
  assert.ok(ROLL_STEPS.length && SONG_STEPS.length);
});
