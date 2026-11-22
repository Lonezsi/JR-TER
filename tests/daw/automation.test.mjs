import test from "node:test";
import assert from "node:assert/strict";
import { targets, targetSpec, valueAt, cleanAutomation, automated, addPoint, movePoint, removePoint, fixAutomationAfterTrackRemove } from "../../web/daw/automation.js";
import { newFx } from "../../web/daw/mixer.js";
import { songToText, textToSong } from "../../web/daw/midi.js";
import { removeTrackEverywhere } from "../../web/daw/pattern.js";

const mk = () => ({
  bpm: 120, bars: 4, swing: 0, pattern: 0, mode: "pattern", clips: [], patterns: [{ name: "Pattern 1", tracks: [] }],
  tracks: [
    { name: "Kick", instrument: "drums", key: 36, volume: 0.8, mute: false, solo: false, notes: [], steps: [], fx: [newFx("delay")] },
    { name: "Bass", instrument: "piano", key: 60, volume: 0.8, mute: false, solo: false, notes: [], steps: [] },
  ],
  automation: [],
});

test("valueAt slides between points and holds outside them", () => {
  const p = [{ beat: 4, value: 0 }, { beat: 8, value: 1 }];
  assert.equal(valueAt(p, 0), 0);
  assert.equal(valueAt(p, 6), 0.5);
  assert.equal(valueAt(p, 100), 1);
  assert.equal(valueAt([], 3), null);
});

test("targets list the knobs, including a track's effects", () => {
  const ids = targets(mk()).map((t) => t.id);
  assert.ok(ids.includes("t0.volume") && ids.includes("t1.pan") && ids.includes("master.volume") && ids.includes("bus1.volume"));
  assert.ok(ids.includes("t0.fx0.feedback"));
  assert.ok(!ids.includes("t1.fx0.mix"));
  assert.equal(targetSpec(mk(), "t0.fx0.time").max, 1.5);
  assert.equal(targetSpec(mk(), "t9.volume"), null);
  assert.equal(targetSpec(mk(), "nonsense"), null);
});

test("cleanAutomation drops bad lanes, clamps values and sorts points", () => {
  const s = mk();
  const out = cleanAutomation([
    { target: "t0.volume", points: [{ beat: 8, value: 5 }, { beat: 2, value: -1 }, { beat: "x", value: 1 }] },
    { target: "t0.volume", points: [] },
    { target: "t7.pan", points: [] },
    null,
  ], s);
  assert.equal(out.length, 1);
  assert.deepEqual(out[0].points, [{ beat: 2, value: 0 }, { beat: 8, value: 1 }]);
});

test("automated applies the value at a beat and leaves the song alone", () => {
  const s = mk();
  s.automation = cleanAutomation([
    { target: "t1.volume", points: [{ beat: 0, value: 0 }, { beat: 4, value: 1 }] },
    { target: "t0.fx0.mix", points: [{ beat: 0, value: 0.2 }] },
    { target: "master.volume", points: [{ beat: 0, value: 0.5 }] },
    { target: "t1.send1", points: [{ beat: 0, value: 0.7 }] },
  ], s);
  const a = automated(s, 2);
  assert.equal(a.tracks[1].volume, 0.5);
  assert.equal(a.tracks[0].fx[0].mix, 0.2);
  assert.equal(a.mixer.master.volume, 0.5);
  assert.equal(a.tracks[1].sends[1], 0.7);
  assert.equal(s.tracks[1].volume, 0.8);
  assert.equal(s.tracks[0].fx[0].mix, 0.3);
});

test("points stay sorted when added and moved", () => {
  const lane = { target: "t0.volume", points: [] };
  addPoint(lane, 4, 0.5); addPoint(lane, 1, 0.1); addPoint(lane, 8, 0.9);
  assert.deepEqual(lane.points.map((p) => p.beat), [1, 4, 8]);
  const i = movePoint(lane, 0, 6, 0.3);
  assert.equal(i, 1);
  assert.deepEqual(lane.points.map((p) => p.beat), [4, 6, 8]);
  removePoint(lane, 0);
  assert.equal(lane.points.length, 2);
});

test("deleting a track removes its lanes and renumbers the rest", () => {
  const s = mk();
  s.automation = [{ target: "t0.volume", points: [] }, { target: "t1.pan", points: [] }, { target: "master.volume", points: [] }];
  fixAutomationAfterTrackRemove(s, 0);
  assert.deepEqual(s.automation.map((l) => l.target), ["t0.pan", "master.volume"]);
  const s2 = mk();
  s2.automation = [{ target: "t1.pan", points: [] }];
  removeTrackEverywhere(s2, 0);
  assert.equal(s2.automation[0].target, "t0.pan");
});

test("automation is saved with the song and old files open without it", () => {
  const s = mk();
  s.automation = [{ target: "t1.pan", points: [{ beat: 0, value: -1 }, { beat: 8, value: 1 }] }];
  const back = textToSong(songToText(s));
  assert.deepEqual(back.automation, s.automation);
  const old = JSON.parse(songToText(s)); delete old.automation; old.version = 6;
  assert.deepEqual(textToSong(JSON.stringify(old)).automation, []);
});
