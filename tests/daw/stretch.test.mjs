import test from "node:test";
import assert from "node:assert/strict";
import { stretchChannel, stretchLength } from "../../web/daw/stretch.js";

const sine = (hz, secs, sr = 44100) => Float32Array.from({ length: Math.round(secs * sr) }, (_, i) => 0.8 * Math.sin((2 * Math.PI * hz * i) / sr));
const crossings = (d) => { let n = 0; for (let i = 1; i < d.length; i++) if (d[i - 1] < 0 && d[i] >= 0) n++; return n; };

test("ratio 1 copies", () => {
  const a = sine(440, 0.2), b = stretchChannel(a, 1);
  assert.deepEqual(b, a); assert.notEqual(b, a);
});
test("length follows the ratio", () => {
  const a = sine(440, 1);
  assert.equal(stretchChannel(a, 2).length, stretchLength(a.length, 2));
  assert.ok(Math.abs(stretchChannel(a, 2).length - a.length / 2) <= 1);
  assert.ok(Math.abs(stretchChannel(a, 0.5).length - a.length * 2) <= 1);
});
test("pitch stays put and nothing blows up", () => {
  const a = sine(440, 1);
  for (const r of [0.5, 0.75, 1.5, 2]) {
    const b = stretchChannel(a, r);
    const hz = crossings(b) / (b.length / 44100);
    assert.ok(Math.abs(hz - 440) / 440 < 0.03, `ratio ${r}: ${hz} Hz`);
    let peak = 0; for (const v of b) { assert.ok(Number.isFinite(v)); peak = Math.max(peak, Math.abs(v)); }
    assert.ok(peak <= 1.05, "peak " + peak);
  }
});
