import test from "node:test";
import assert from "node:assert/strict";
import { newFx, cleanFx, cleanTrackMix, defaultMixer, cleanMixer, ensureMix, trackGain, impulse, distCurve, level, chainKey, MAX_FX } from "../../web/daw/mixer.js";
import { songToText, textToSong } from "../../web/daw/midi.js";

const seeded = () => { let s = 7; return () => ((s = (s * 16807) % 2147483647) / 2147483647); };

test("new effects have their defaults", () => {
  const f = newFx("delay");
  assert.deepEqual([f.type, f.on, f.time, f.feedback, f.mix], ["delay", true, 0.375, 0.35, 0.3]);
  assert.throws(() => newFx("nope"));
});

test("cleanFx drops unknown types, clamps, and caps the chain", () => {
  const out = cleanFx([{ type: "eq", low: 99 }, { type: "zap" }, null, { type: "comp", on: false, ratio: -3 }]);
  assert.equal(out.length, 2);
  assert.equal(out[0].low, 12);
  assert.equal(out[1].on, false);
  assert.equal(out[1].ratio, 1);
  assert.equal(cleanFx(Array.from({ length: 20 }, () => ({ type: "eq" }))).length, MAX_FX);
  assert.deepEqual(cleanFx("x"), []);
});

test("track mix and mixer fill in defaults", () => {
  assert.deepEqual(cleanTrackMix({}), { pan: 0, sends: [0, 0], fx: [] });
  assert.equal(cleanTrackMix({ pan: 5, sends: [2, -1] }).pan, 1);
  const m = cleanMixer(null);
  assert.equal(m.buses.length, 2);
  assert.equal(m.buses[0].fx[0].type, "reverb");
  assert.equal(m.buses[1].fx[0].mix, 1);
  assert.equal(cleanMixer({ buses: [{ name: "X", volume: 0.1, fx: [] }] }).buses.length, 2);
});

test("ensureMix fills an old song", () => {
  const s = ensureMix({ tracks: [{ name: "a" }, { name: "b" }] });
  assert.equal(s.tracks[1].pan, 0);
  assert.deepEqual(s.tracks[0].sends, [0, 0]);
  assert.ok(s.mixer.master);
});

test("trackGain: mute and solo", () => {
  assert.equal(trackGain({ volume: 0.5 }, false), 0.5);
  assert.equal(trackGain({ volume: 0.5, mute: true }, false), 0);
  assert.equal(trackGain({ volume: 0.5 }, true), 0);
  assert.equal(trackGain({ volume: 0.5, solo: true }, true), 0.5);
});

test("impulse has the right length and dies away", () => {
  const [l, r] = impulse(1, 1000, seeded());
  assert.equal(l.length, 1000);
  assert.equal(r.length, 1000);
  const e = (a, from, to) => { let s = 0; for (let i = from; i < to; i++) s += a[i] * a[i]; return s; };
  assert.ok(e(l, 0, 100) > e(l, 900, 1000) * 50);
});

test("distCurve is odd, bounded and rising", () => {
  const c = distCurve(0.7, 257);
  for (let i = 0; i < c.length; i++) {
    assert.ok(Math.abs(c[i]) <= 1.0000001);
    assert.ok(Math.abs(c[i] + c[c.length - 1 - i]) < 1e-5);
    if (i) assert.ok(c[i] >= c[i - 1]);
  }
  assert.ok(Math.abs(c[c.length - 1] - 1) < 1e-5);
});

test("level: silence is -60, a half-scale peak is about -6 dB", () => {
  assert.equal(level(new Float32Array(64)), -60);
  const s = new Float32Array(64).map((_, i) => 0.5 * Math.sin(i / 3));
  s[10] = 0.5;
  assert.ok(Math.abs(level(s) + 6.02) < 0.1);
});

test("chainKey changes with order and bypass", () => {
  const a = chainKey([{ type: "eq", on: true }, { type: "comp", on: true }]);
  assert.notEqual(a, chainKey([{ type: "comp", on: true }, { type: "eq", on: true }]));
  assert.notEqual(a, chainKey([{ type: "eq", on: false }, { type: "comp", on: true }]));
});

test("the text format keeps the mixer; a version 4 file opens with defaults", () => {
  const song = textToSong(songToText({ bpm: 120, bars: 4, tracks: [{ name: "T", instrument: "piano", notes: [], volume: 0.8, pan: -0.5, sends: [0.2, 0.7], fx: [newFx("eq"), { ...newFx("dist"), drive: 0.9 }] }] }));
  song.mixer.master.volume = 0.3; song.mixer.buses[1].name = "Echo";
  const back = textToSong(songToText(song));
  assert.equal(back.tracks[0].pan, -0.5);
  assert.deepEqual(back.tracks[0].sends, [0.2, 0.7]);
  assert.deepEqual(back.tracks[0].fx.map((f) => f.type), ["eq", "dist"]);
  assert.equal(back.tracks[0].fx[1].drive, 0.9);
  assert.equal(back.mixer.master.volume, 0.3);
  assert.equal(back.mixer.buses[1].name, "Echo");
  const old = textToSong(JSON.stringify({ format: "jriter-daw", version: 4, bpm: 100, bars: 2, tracks: [{ name: "x", instrument: "bass", notes: [] }] }));
  assert.equal(old.tracks[0].pan, 0);
  assert.deepEqual(old.tracks[0].fx, []);
  assert.deepEqual(old.mixer, defaultMixer());
});
