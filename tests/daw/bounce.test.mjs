import test from "node:test";
import assert from "node:assert/strict";
import { encodeWav, bounceSeconds } from "../../web/daw/bounce.js";

test("bounceSeconds adds a tail", () => {
  assert.equal(bounceSeconds(8, 120), 6);
  assert.equal(bounceSeconds(4, 60, 0), 4);
});

test("encodeWav writes a stereo 16-bit header", () => {
  const w = encodeWav([new Float32Array([0, 1, -1]), new Float32Array([0.5, 0, 0])], 44100);
  const v = new DataView(w.buffer);
  const tag = (o) => String.fromCharCode(...w.slice(o, o + 4));
  assert.equal(tag(0), "RIFF"); assert.equal(tag(8), "WAVE"); assert.equal(tag(12), "fmt "); assert.equal(tag(36), "data");
  assert.equal(v.getUint16(22, true), 2);
  assert.equal(v.getUint32(24, true), 44100);
  assert.equal(v.getUint16(34, true), 16);
  assert.equal(v.getUint32(40, true), 3 * 4);
  assert.equal(w.length, 44 + 12);
  assert.equal(v.getUint32(4, true), w.length - 8);
});

test("encodeWav interleaves and clamps", () => {
  const w = encodeWav([new Float32Array([2, -2]), new Float32Array([0.5, 0])], 8000);
  const v = new DataView(w.buffer);
  assert.equal(v.getInt16(44, true), 32767);
  assert.equal(v.getInt16(46, true), Math.trunc(0.5 * 0x7fff));
  assert.equal(v.getInt16(48, true), -32768);
  assert.equal(v.getInt16(50, true), 0);
});
