import test from "node:test";
import assert from "node:assert/strict";
import {
  UNITS, ADDABLE, newUnit, rackOf, valueOf, summary, shapeOf, buildUnit, rackImpulse, responseOf,
  freqToX, xToFreq, gainToY, yToGain, bandAt, addBand, dragBand, qFromWheel,
  limiterLineAt, setLimiterLine, ReductionHistory, HISTORY, dbToGain,
} from "../../web/daw/rack.js";

// A fake audio context: nodes are plain objects, params are { value }.
function fakeCtx(sampleRate = 48000) {
  const param = (v = 0) => ({ value: v });
  const node = (extra = {}) => ({ connect() {}, disconnect() {}, ...extra });
  return {
    sampleRate,
    createGain: () => node({ gain: param(1) }),
    createBiquadFilter: () => node({
      type: "", frequency: param(), Q: param(), gain: param(),
      getFrequencyResponse(freqs, mag, phase) { mag.fill(2); phase.fill(0); },
    }),
    createDynamicsCompressor: () => node({ threshold: param(), ratio: param(), attack: param(), release: param(), knee: param(), reduction: -3 }),
    createWaveShaper: () => node({ curve: null }),
    createDelay: () => node({ delayTime: param() }),
    createConvolver: () => node({ buffer: null }),
    createChannelSplitter: () => node(),
    createChannelMerger: () => node(),
    createBuffer: (ch, length) => { const d = Array.from({ length: ch }, () => new Float32Array(length)); return { getChannelData: (i) => d[i] }; },
  };
}

test("new units have their defaults", () => {
  for (const kind of ADDABLE) {
    const u = newUnit(kind);
    assert.equal(u.kind, kind); assert.equal(u.on, true);
    for (const k of UNITS[kind].knobs) assert.equal(u[k.key], k.value);
  }
  assert.equal(newUnit("eq").id, "eq");
  assert.notEqual(newUnit("comp").id, newUnit("comp").id);
});

test("rackOf reads an old preset as eq, limiter and gain", () => {
  assert.deepEqual(rackOf(null).map((u) => u.kind), ["eq"]);
  const old = rackOf({ bands: [], limiter: { on: true, ceiling: -1 }, gain: 2 });
  assert.deepEqual(old.map((u) => u.kind), ["eq", "limiter", "gain"]);
  assert.equal(old[1].on, true); assert.equal(old[1].ceiling, -1); assert.equal(old[1].threshold, -6);
  assert.equal(old[2].db, 2);
  const rack = [{ id: "eq", kind: "eq", on: true }];
  assert.equal(rackOf({ rack, rack_v: 2 }), rack);
});

test("valueOf falls back to the default; summary reads well", () => {
  assert.equal(valueOf({ kind: "comp" }, "ratio"), 3);
  assert.equal(valueOf({ kind: "comp", ratio: 8 }, "ratio"), 8);
  assert.equal(summary({ kind: "eq" }, { bands: [] }), "flat");
  assert.equal(summary({ kind: "eq" }, { bands: [{}, {}] }), "2 bands");
  assert.equal(summary({ kind: "comp" }, {}), "-18 dB · 3:1");
  assert.equal(summary({ kind: "gain", db: 6 }, {}), "+6 dB");
});

test("shapeOf changes for rewiring, not for knobs", () => {
  const data = { rack: [{ id: "eq", kind: "eq", on: true }, { id: "c", kind: "comp", on: true, ratio: 3 }], rack_v: 2, bands: [{ id: 1, type: "peaking", on: true, gain: 0 }] };
  const a = shapeOf(data);
  const knob = structuredClone(data); knob.rack[1].ratio = 9; knob.bands[0].gain = 5;
  assert.equal(shapeOf(knob), a);
  const off = structuredClone(data); off.rack[1].on = false;
  assert.notEqual(shapeOf(off), a);
  const more = structuredClone(data); more.bands.push({ id: 2, type: "lowshelf", on: true });
  assert.notEqual(shapeOf(more), a);
  assert.notEqual(shapeOf({ ...data, bypass: true }), a);
});

test("eq maths round-trips and hit-tests", () => {
  assert.ok(Math.abs(xToFreq(freqToX(1000, 800), 800) - 1000) < 1e-6);
  assert.ok(Math.abs(yToGain(gainToY(7, 200, 18), 200, 18) - 7) < 1e-9);
  const size = { width: 800, height: 200 };
  const bands = [{ id: 1, type: "peaking", freq: 1000, gain: 6, q: 1, on: true }];
  const x = freqToX(1000, 800), y = gainToY(6, 200, 18);
  assert.equal(bandAt(bands, x + 3, y, size, 18), bands[0]);
  assert.equal(bandAt(bands, x + 100, y, size, 18), null);
  const hp = { id: 2, type: "highpass", freq: 80, gain: 0, q: 0.7, on: true };
  dragBand(hp, 400, 20, size, 18);
  assert.equal(hp.gain, 0); assert.ok(hp.freq > 80);
  const list = addBand([{ freq: 500 }, { freq: 2000 }], { freq: 1000 });
  assert.deepEqual(list.map((b) => b.freq), [500, 1000, 2000]);
  assert.ok(qFromWheel(30, -10000) <= 30 && qFromWheel(0.05, 10000) >= 0.05);
});

test("limiter lines clamp and the history is ordered", () => {
  assert.equal(limiterLineAt({ threshold: -6, ceiling: -0.3 }, 600, 720), "threshold");
  assert.equal(limiterLineAt({ threshold: -6, ceiling: -0.3 }, 300, 720), null);
  const lim = {};
  setLimiterLine(lim, "ceiling", -50); setLimiterLine(lim, "threshold", 4);
  assert.equal(lim.ceiling, -30); assert.equal(lim.threshold, 0);
  const h = new ReductionHistory();
  for (let i = 1; i <= HISTORY + 2; i++) h.push(i);
  assert.equal(h.at(HISTORY - 1), HISTORY + 2); assert.equal(h.at(0), 3);
});

test("every kind builds, and set moves the numbers", () => {
  const ctx = fakeCtx();
  const data = { bands: [{ id: 1, type: "peaking", freq: 1000, gain: 3, q: 1, on: true }] };
  for (const kind of ADDABLE) {
    const b = buildUnit(ctx, newUnit(kind), data);
    assert.ok(b.input && b.output && b.nodes.length && typeof b.set === "function", kind);
  }
  const g = buildUnit(ctx, { ...newUnit("gain"), db: 0 }, data);
  g.set({ kind: "gain", db: 6 }, data);
  assert.ok(Math.abs(g.output.gain.value - dbToGain(6)) < 1e-9);
  assert.ok(Math.abs(g.output.gain.value - 1.995) < 0.001);
  const w = buildUnit(ctx, { ...newUnit("width"), width: 0 }, data);
  assert.equal(w.nodes[3].gain.value, 0.5);
  assert.equal(buildUnit(ctx, newUnit("limiter"), data).reduction(), 3);
});

test("the reverb tail is the same every time", () => {
  const a = rackImpulse(fakeCtx(8000), 0.5), b = rackImpulse(fakeCtx(8000), 0.5);
  assert.deepEqual(a.getChannelData(0), b.getChannelData(0));
  assert.deepEqual(a.getChannelData(1), b.getChannelData(1));
  assert.notDeepEqual(a.getChannelData(0), a.getChannelData(1));
});

test("responseOf multiplies the bands, skips off bands, flat on bypass", () => {
  const ctx = fakeCtx(), f = new Float32Array([100, 1000]);
  const band = { type: "peaking", freq: 1000, gain: 3, q: 1, on: true };
  const two = responseOf(ctx, [band, band], f);
  assert.ok(Math.abs(two[0] - 12.04) < 0.01);
  assert.ok(Math.abs(responseOf(ctx, [band, { ...band, on: false }], f)[0] - 6.02) < 0.01);
  assert.deepEqual([...responseOf(ctx, [band], f, true)], [0, 0]);
  assert.deepEqual([...responseOf(null, [band], f)], [0, 0]);
});
