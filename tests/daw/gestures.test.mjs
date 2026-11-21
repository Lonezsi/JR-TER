import test from "node:test";
import assert from "node:assert/strict";
import { classify } from "../../web/daw/gestures.js";

const s = (id, x, y, t, type) => ({ id, x, y, t, type });

test("a quick touch that stays put is a tap", () => {
  const r = classify([s(1, 50, 50, 0, "down"), s(1, 52, 51, 90, "up")]);
  assert.equal(r.kind, "tap");
});

test("holding still is a long press, once it has been long enough", () => {
  const held = [s(1, 50, 50, 0, "down"), s(1, 51, 50, 200, "move")];
  assert.equal(classify(held, 300).kind, "none");
  assert.equal(classify(held, 500).kind, "long");
});

test("a slow release without moving is nothing", () => {
  assert.equal(classify([s(1, 5, 5, 0, "down"), s(1, 5, 5, 900, "up")]).kind, "none");
});

test("moving more than the slop is a drag", () => {
  const r = classify([s(1, 10, 10, 0, "down"), s(1, 40, 25, 80, "move")]);
  assert.equal(r.kind, "drag");
  assert.equal(r.dx, 30);
  assert.equal(r.dy, 15);
});

test("two fingers apart is a pinch with its scale", () => {
  const r = classify([
    s(1, 100, 100, 0, "down"), s(2, 200, 100, 5, "down"),
    s(1, 50, 100, 60, "move"), s(2, 250, 100, 60, "move"),
  ]);
  assert.equal(r.kind, "pinch");
  assert.equal(r.scale, 2);
  assert.equal(r.dx, 0);
});

test("no samples is nothing", () => {
  assert.equal(classify([]).kind, "none");
});
