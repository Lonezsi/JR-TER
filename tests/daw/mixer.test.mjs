import test from "node:test";
import assert from "node:assert/strict";
import { newFx, moveFx, cleanFx, cleanTrackMix, defaultMixer, cleanMixer, ensureMix, trackGain, impulse, distCurve, level, chainKey, MAX_FX, WAM_STATE_MAX, pluginOrigin, addBus, removeBus, loops, MAX_BUSES } from "../../web/daw/mixer.js";
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
  assert.deepEqual(cleanTrackMix({}), { pan: 0, sends: [0, 0], out: "m", fx: [] });
  assert.equal(cleanTrackMix({ pan: 5, sends: [2, -1] }).pan, 1);
  const m = cleanMixer(null);
  assert.equal(m.buses.length, 2);
  assert.equal(m.buses[0].fx[0].type, "reverb");
  assert.equal(m.buses[1].fx[0].mix, 1);
  assert.equal(cleanMixer({ buses: [{ name: "X", volume: 0.1, fx: [] }] }).buses.length, 2);
});

test("routing: any number of buses, a send per bus, outputs, and never a loop", () => {
  const s = ensureMix({ tracks: [{ name: "kick" }, { name: "snare" }] });
  const drums = addBus(s, "Drums");
  assert.equal(drums, 2);
  assert.equal(s.mixer.buses.length, 3);
  assert.deepEqual(s.tracks[0].sends, [0, 0, 0]);
  s.tracks[0].out = "b2"; s.tracks[1].out = "b2";
  s.mixer.buses[2].out = "b0";                       // drums into the reverb bus: fine
  ensureMix(s);
  assert.equal(s.tracks[0].out, "b2");
  assert.equal(s.mixer.buses[2].out, "b0");
  assert.equal(loops(s.mixer.buses, 0, 2), true);    // reverb back into drums would loop
  s.mixer.buses[0].out = "b2"; ensureMix(s);
  assert.equal(s.mixer.buses[0].out, "m", "a loop goes to the master");
  s.mixer.buses[1].out = "b1"; ensureMix(s);
  assert.equal(s.mixer.buses[1].out, "m", "into itself goes to the master");
  // taking a bus out: what went into it goes to the master, later buses move down
  s.tracks[1].sends = [0, 0.5, 0.9];
  assert.equal(removeBus(s, 0), true);
  assert.equal(s.tracks[0].out, "b1");
  assert.deepEqual(s.tracks[1].sends, [0.5, 0.9]);
  assert.equal(s.mixer.buses[1].out, "m");
  assert.equal(removeBus(s, 0), false, "never fewer than two");
  assert.equal(cleanTrackMix({ out: "b9" }, 3).out, "m", "a bus that is not there is the master");
  for (let i = 0; i < 40; i++) addBus(s);
  assert.equal(s.mixer.buses.length, MAX_BUSES);
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
  const song = textToSong(songToText({ bpm: 120, bars: 4, tracks: [{ name: "T", instrument: "piano", notes: [], volume: 0.8, pan: -0.5, sends: [0.2, 0.7], out: "b1", fx: [newFx("eq"), { ...newFx("dist"), drive: 0.9 }] }] }));
  assert.equal(song.tracks[0].out, "b1");
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

test("moveFx reorders in place, clamps, and ignores a bad index", () => {
  assert.deepEqual(moveFx(["a", "b", "c"], 0, 2), ["b", "c", "a"]);
  assert.deepEqual(moveFx(["a", "b", "c"], 2, 0), ["c", "a", "b"]);
  assert.deepEqual(moveFx(["a", "b", "c"], 0, 9), ["b", "c", "a"]);
  assert.deepEqual(moveFx(["a", "b", "c"], 7, 0), ["a", "b", "c"]);
});

test("a plugin effect has an address, a name and a saved state", () => {
  const f = newFx("wam");
  assert.deepEqual([f.type, f.on, f.url, f.name, f.state], ["wam", true, "", "", null]);
});

test("cleanFx keeps https and same-server plugin addresses and drops the rest", () => {
  const out = cleanFx([
    { type: "wam", url: "https://plugins.example/x.js", name: "X", state: { a: 1 } },
    { type: "wam", url: "/daw/vendor/wam/test-gain.js" },
    { type: "wam", url: "http://plugins.example/x.js" },
    { type: "wam", url: "javascript:alert(1)" },
    { type: "wam", url: "//evil.example/x.js" },
    { type: "wam", url: "https://a.example/" + "x".repeat(600) },
  ]);
  assert.deepEqual(out.map((f) => f.url), ["https://plugins.example/x.js", "/daw/vendor/wam/test-gain.js", "", "", "", ""]);
  assert.deepEqual(out[0].state, { a: 1 });
  assert.equal(out[1].state, null);
});

test("a plugin's saved state is dropped when it is too big", () => {
  const [f] = cleanFx([{ type: "wam", url: "/p.js", state: { blob: "x".repeat(WAM_STATE_MAX) } }]);
  assert.equal(f.state, null);
});

test("chainKey changes when a plugin's address does, and pluginOrigin says whose it is", () => {
  const a = [{ type: "wam", on: true, url: "/a.js" }], b = [{ type: "wam", on: true, url: "/b.js" }];
  assert.notEqual(chainKey(a), chainKey(b));
  assert.equal(pluginOrigin("https://plugins.example/x/y.js"), "https://plugins.example");
  assert.equal(pluginOrigin("/a.js"), "");
});

test("plugins survive the song text round trip", () => {
  const song = textToSong(songToText({ ...textToSong(JSON.stringify({ format: "jriter-daw", version: 1, bpm: 120, bars: 1, tracks: [{ name: "T", instrument: "piano", notes: [], fx: [{ type: "wam", url: "https://p.example/x.js", name: "X", state: { k: [1, 2] } }] }] })) }));
  const f = song.tracks[0].fx[0];
  assert.deepEqual([f.type, f.url, f.name, f.state], ["wam", "https://p.example/x.js", "X", { k: [1, 2] }]);
});
