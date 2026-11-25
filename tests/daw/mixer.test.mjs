import test from "node:test";
import assert from "node:assert/strict";
import { newFx, moveFx, cleanFx, cleanTrackMix, defaultMixer, cleanMixer, ensureMix, trackGain, level, oldMix, oldMixDb, oldDrive, upgradeOldFx, chainKey, MAX_FX, WAM_STATE_MAX, pluginOrigin, addBus, removeBus, loops, MAX_BUSES, FX_TYPES, MASTER_LIMITER } from "../../web/daw/mixer.js";
import { UNITS } from "../../web/daw/rack.js";
import { readFileSync } from "node:fs";
import { songToText, textToSong } from "../../web/daw/midi.js";

const seeded = () => { let s = 7; return () => ((s = (s * 16807) % 2147483647) / 2147483647); };

test("new effects have their defaults", () => {
  const f = newFx("delay");
  assert.deepEqual([f.type, f.on, f.time, f.feedback, f.mix], ["delay", true, 350, 35, 20]);
  assert.throws(() => newFx("nope"));
});

test("cleanFx drops unknown types, clamps, and caps the chain", () => {
  const out = cleanFx([{ type: "eq", low: 99 }, { type: "zap" }, null, { type: "comp", on: false, ratio: -3 }]);
  assert.equal(out.length, 2);
  assert.equal(out[0].bands[0].gain, 12);
  assert.equal(out[0].low, undefined);
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
  assert.equal(m.buses[1].fx[0].mix, 100);
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
  const song = textToSong(songToText({ bpm: 120, bars: 4, tracks: [{ name: "T", instrument: "piano", notes: [], volume: 0.8, pan: -0.5, sends: [0.2, 0.7], out: "b1", fx: [newFx("eq"), { ...newFx("drive"), amount: 90 }] }] }));
  assert.equal(song.tracks[0].out, "b1");
  song.mixer.master.volume = 0.3; song.mixer.buses[1].name = "Echo";
  const back = textToSong(songToText(song));
  assert.equal(back.tracks[0].pan, -0.5);
  assert.deepEqual(back.tracks[0].sends, [0.2, 0.7]);
  assert.deepEqual(back.tracks[0].fx.map((f) => f.type), ["eq", "drive"]);
  assert.equal(back.tracks[0].fx[1].amount, 90);
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

test("an old 3-band EQ opens as a low shelf, a bell and a high shelf", () => {
  const [f] = cleanFx([{ type: "eq", on: true, low: 6, mid: -4, high: 3 }]);
  assert.deepEqual(f.bands, [
    { id: "b1", type: "lowshelf", freq: 200, gain: 6, q: 0.7, on: true },
    { id: "b2", type: "peaking", freq: 1000, gain: -4, q: 0.8, on: true },
    { id: "b3", type: "highshelf", freq: 5000, gain: 3, q: 0.7, on: true },
  ]);
  assert.equal(f.high, undefined);
});

test("an EQ with bands keeps them (up to 24, clamped); a new EQ has none", () => {
  assert.deepEqual(newFx("eq").bands, []);
  const [f] = cleanFx([{ type: "eq", bands: Array.from({ length: 30 }, () => ({ type: "bogus", gain: 99 })) }]);
  assert.equal(f.bands.length, 24);
  assert.equal(f.bands[0].type, "peaking");
  assert.equal(f.bands[0].gain, 30);
  assert.deepEqual(cleanFx([{ type: "eq", bands: [] }])[0].bands, []);
});

test("chainKey changes when an EQ band is added, retyped or switched off", () => {
  const eq = (bands) => chainKey([{ type: "eq", on: true, bands }]);
  const b = { id: "a", type: "peaking", on: true };
  assert.notEqual(eq([b]), eq([]));
  assert.notEqual(eq([b]), eq([{ ...b, type: "lowshelf" }]));
  assert.notEqual(eq([b]), eq([{ ...b, on: false }]));
  assert.equal(eq([b]), eq([{ ...b, freq: 99, gain: 3 }]));
});

test("EQ bands survive saving and opening a song", () => {
  const eq = { ...newFx("eq"), bands: [{ id: "z", type: "notch", freq: 440, gain: 0, q: 5, on: false }] };
  const song = textToSong(songToText({ bpm: 120, bars: 4, tracks: [{ name: "T", instrument: "piano", notes: [], fx: [eq] }] }));
  assert.deepEqual(song.tracks[0].fx[0].bands, eq.bands);
});

test("a Limiter has rack.js's defaults, is clamped, and survives saving", () => {
  const f = newFx("limiter");
  const want = Object.fromEntries(UNITS.limiter.knobs.map((k) => [k.key, k.value]));
  assert.deepEqual({ threshold: f.threshold, ceiling: f.ceiling, attack: f.attack, release: f.release }, want);
  assert.deepEqual(want, { threshold: -6, ceiling: -0.3, attack: 5, release: 120 });
  const [c] = cleanFx([{ type: "limiter", threshold: 5, ceiling: -99, attack: 500, release: 1 }]);
  assert.deepEqual({ threshold: c.threshold, ceiling: c.ceiling, attack: c.attack, release: c.release }, { threshold: 0, ceiling: -30, attack: 100, release: 10 });
  const song = textToSong(songToText({ bpm: 120, bars: 4, tracks: [{ name: "T", instrument: "piano", notes: [], fx: [{ ...f, ceiling: -3 }] }] }));
  assert.equal(song.tracks[0].fx[0].type, "limiter");
  assert.equal(song.tracks[0].fx[0].ceiling, -3);
  assert.ok(FX_TYPES.includes("limiter"));
});

test("the master limiter is rack.js's, and mixgraph.js has no limiter of its own", () => {
  assert.deepEqual([MASTER_LIMITER.threshold, MASTER_LIMITER.ceiling, MASTER_LIMITER.attack, MASTER_LIMITER.release], [-1, -1, 3, 100]);
  const g = readFileSync(new URL("../../web/daw/mixgraph.js", import.meta.url), "utf8");
  assert.ok(!/limiter\.threshold|ratio\.value = 20/.test(g));
  assert.ok(g.includes("buildUnit(ctx, MASTER_LIMITER"));
});

const oldSong = (fx, version = 10, extra = {}) => JSON.stringify({ format: "jriter-daw", version, bpm: 120, bars: 4, tracks: [{ name: "T", instrument: "piano", notes: [], fx }], ...extra });

test("old comp, dist, delay and reverb (version 10) open in rack.js's units", () => {
  const song = textToSong(oldSong([
    { type: "comp", on: true, threshold: -20, ratio: 5, attack: 0.02, release: 0.3 },
    { type: "dist", on: true, drive: 0.4, mix: 1 },
    { type: "delay", on: false, time: 0.5, feedback: 0.4, mix: 0.3 },
    { type: "reverb", on: true, size: 3, mix: 0.3 },
  ]));
  const [c, d, e, r] = song.tracks[0].fx;
  assert.deepEqual([c.type, c.threshold, c.ratio, c.attack, c.release, c.knee, c.makeup], ["comp", -20, 5, 20, 300, 6, 0]);
  assert.deepEqual([d.type, d.amount, d.mix], ["drive", 100, 70.5]);
  assert.equal(d.output, 1);
  assert.deepEqual([e.type, e.on, e.time, e.feedback, e.tone, e.mix], ["delay", false, 500, 40, 16000, oldMix(0.3)]);
  assert.deepEqual([r.type, r.size, r.predelay, r.tone, r.mix], ["reverb", 3, 0, 18000, oldMix(0.3)]);
});

test("old mix keeps the wet:dry balance; old drive matches the curve's slope", () => {
  assert.equal(oldMix(0), 0);
  assert.ok(Math.abs(oldMix(1) - 70.5) < 0.1);
  for (const m of [0.1, 0.3, 0.7]) {
    const p = oldMix(m) / 100 * Math.PI / 2;
    assert.ok(Math.abs(Math.sin(p) / Math.cos(p) - m / (1 - m / 2)) < 0.01);
  }
  assert.equal(oldMixDb(0), 0);
  assert.equal(oldDrive(0), 0);
  assert.equal(oldDrive(0.4), 100);
  assert.ok(Math.abs(oldDrive(0.1) - 25) < 5);
});

test("a version 11 file is not converted again, and a stray dist is dropped", () => {
  const song = textToSong(oldSong([{ type: "comp", on: true, attack: 10, release: 150 }, { type: "dist", drive: 0.5 }], 11));
  assert.equal(song.tracks[0].fx.length, 1);
  assert.equal(song.tracks[0].fx[0].attack, 10);
});

test("upgradeOldFx reaches the master and the buses", () => {
  const j = upgradeOldFx({ tracks: [], mixer: { master: { fx: [{ type: "dist", drive: 1 }] }, buses: [{ fx: [{ type: "reverb", mix: 1 }] }] } });
  assert.equal(j.mixer.master.fx[0].type, "drive");
  assert.equal(j.mixer.buses[0].fx[0].mix, oldMix(1));
});

test("mixgraph.js builds no effects of its own: only rack.js does", () => {
  const g = readFileSync(new URL("../../web/daw/mixgraph.js", import.meta.url), "utf8");
  assert.ok(!/createDynamicsCompressor|createConvolver|createWaveShaper|createDelay/.test(g));
});
