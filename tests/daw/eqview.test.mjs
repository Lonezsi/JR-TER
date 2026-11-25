import test from "node:test";
import assert from "node:assert/strict";
import { rangeFor, readout, keyEdit } from "../../web/daw/eqview.js";
import { F_MAX } from "../../web/daw/rack.js";

const band = (o = {}) => ({ id: "b1", type: "peaking", freq: 1000, gain: 0, q: 1, on: true, ...o });

test("rangeFor: flat is 18, a big boost widens it, gainless bands are ignored", () => {
  assert.equal(rangeFor([]), 18);
  assert.equal(rangeFor([band({ gain: 20 })]), 24);
  assert.equal(rangeFor([band({ type: "lowpass", gain: 29 })]), 18);
});

test("readout words", () => {
  assert.match(readout(band({ gain: 3 }), 1), /1\.00k Hz, \+3\.0 dB, Q 1\.00/);
  assert.doesNotMatch(readout(band({ type: "highpass" }), 1), /dB/);
  assert.equal(readout(null, 3), "3 bands");
  assert.match(readout(null, 0), /Flat/);
});

test("keyEdit: arrows move by a semitone, Shift by four, clamp, gainless ignore up/down", () => {
  const b = band();
  assert.ok(keyEdit(b, "ArrowRight", false, 18));
  assert.ok(Math.abs(b.freq - 1059.5) < 0.1);
  const c = band();
  keyEdit(c, "ArrowRight", true, 18);
  assert.ok(Math.abs(c.freq - 1259.9) < 0.1);
  const top = band({ freq: F_MAX });
  keyEdit(top, "ArrowRight", false, 18);
  assert.equal(top.freq, F_MAX);
  const g = band({ gain: 17.8 });
  keyEdit(g, "ArrowUp", false, 18);
  assert.equal(g.gain, 18);
  const lp = band({ type: "lowpass" });
  assert.equal(keyEdit(lp, "ArrowUp", false, 18), false);
  const q = band();
  keyEdit(q, "-", false, 18);
  assert.ok(q.q < 1);
  assert.equal(keyEdit(q, "x", false, 18), false);
});
