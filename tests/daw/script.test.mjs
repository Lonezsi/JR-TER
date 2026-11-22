import test from "node:test";
import assert from "node:assert/strict";
import { run, parseScript, defaultScripts, ScriptError } from "../../web/daw/script.js";

const triad = [60, 64, 67].map((pitch) => ({ pitch, start: 0, length: 1, velocity: 90 }));
const seeded = (seed = 7) => () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
const script = (name) => defaultScripts().find((s) => s.name.startsWith(name)).code;
const key = (n) => n.map((x) => [x.pitch, x.start, x.length, x.velocity]);

test("every default script parses, and nothing is stored twice", () => {
  const all = defaultScripts();
  assert.equal(all.length, 9);
  for (const s of all) assert.doesNotThrow(() => parseScript(s.code), s.name);
  assert.equal(new Set(all.map((s) => s.name)).size, 9);
});

test("humanize with amount 0 changes nothing", () => {
  const notes = [{ pitch: 60, start: 1, length: 0.5, velocity: 80 }, { pitch: 64, start: 2, length: 1, velocity: 70 }];
  assert.deepEqual(key(run(script("Humanize"), notes, { values: { amount: 0 }, rng: seeded() })), key(notes));
});

test("humanize at 100 stays inside its bounds, and does something", () => {
  const notes = Array.from({ length: 40 }, (_, i) => ({ pitch: 60, start: 1 + i, length: 1, velocity: 80 }));
  const out = run(script("Humanize"), notes, { values: { amount: 100 }, rng: seeded() });
  assert.equal(out.length, 40);
  out.forEach((n, i) => {
    assert.ok(Math.abs(n.start - (1 + i)) <= 0.05 + 1e-9, "start moved " + (n.start - (1 + i)));
    assert.ok(Math.abs(n.velocity - 80) <= 25, "velocity moved " + (n.velocity - 80));
    assert.ok(n.length > 0.89 && n.length < 1.11);
  });
  assert.notDeepEqual(key(out), key(notes));
});

test("arp up in sixteenths", () => {
  const out = run(script("Arp: up"), triad, { rng: seeded() });
  assert.deepEqual(out.map((n) => n.pitch), [60, 64, 67, 60]);
  assert.deepEqual(out.map((n) => n.start), [0, 0.25, 0.5, 0.75]);
  assert.ok(out.every((n) => Math.abs(n.length - 0.225) < 1e-9 && n.velocity === 90));
});

test("arp octaves stacks copies higher", () => {
  const out = run(script("Arp: up"), triad, { values: { octaves: 2 }, rng: seeded() });
  assert.deepEqual(out.map((n) => n.pitch), [60, 64, 67, 72]);
});

test("arp down, up-down, inward and your own order", () => {
  const code = (pattern, extra = "") => "each chord:\n  arp " + pattern + " step 1/4n" + extra;
  const long = triad.map((n) => ({ ...n, length: 6 }));
  assert.deepEqual(run(code("down"), long).map((n) => n.pitch), [67, 64, 60, 67, 64, 60]);
  assert.deepEqual(run(code("updown"), long).map((n) => n.pitch), [60, 64, 67, 64, 60, 64]);
  assert.deepEqual(run(code("inward"), long).map((n) => n.pitch), [60, 67, 64, 60, 67, 64]);
  const four = [60, 64, 67, 71].map((pitch) => ({ pitch, start: 0, length: 4, velocity: 90 }));
  assert.deepEqual(run(script("Arp: 1-3-2-4"), four).map((n) => n.pitch).slice(0, 4), [60, 67, 64, 71]);
});

test("strum offsets a chord's notes low to high", () => {
  const out = run(script("Strum"), triad, { values: { ms: 250 } });
  assert.deepEqual(out.map((n) => n.start), [0, 0.5, 1]);
});

test("if, delete, locals and the fields", () => {
  const notes = [{ pitch: 40, start: 0, length: 1, velocity: 100 }, { pitch: 80, start: 1, length: 1, velocity: 100 }];
  const out = run("each note:\n  if pitch < 50: delete\n  lift = 12\n  pitch += lift\n  velocity = 64", notes);
  assert.deepEqual(key(out), [[92, 1, 1, 64]]);
});

test("values are clamped into MIDI's range", () => {
  const out = run("each note:\n  pitch += 500\n  velocity = -5\n  start -= 9\n  length = 0", [{ pitch: 60, start: 1, length: 1, velocity: 90 }]);
  assert.deepEqual(key(out), [[127, 0, 1 / 64, 1]]);
});

test("a chord block can read size and bar", () => {
  const out = run("each chord:\n  velocity = size * 10 + bar", triad);
  assert.ok(out.every((n) => n.velocity === 30));
});

test("mistakes say which line", () => {
  assert.throws(() => run("each note:\n  pitch += 1\n  pitch ++ 2", triad), (e) => e instanceof ScriptError && e.line === 3);
  assert.throws(() => run("pitch = 1", triad), (e) => e.line === 1 && /under 'each/.test(e.detail));
  assert.throws(() => run("each note:\n  pitch = nope + 1", triad), (e) => e.line === 2 && /nope/.test(e.detail));
  assert.throws(() => run("each note:\n  arp up step 1/4n", triad), (e) => e.line === 2 && /only works inside/.test(e.detail));
  assert.throws(() => run("each chord:\n  arp sideways step 1/4n", triad), (e) => e.line === 2);
});

test("params can be read from the script", () => {
  const p = parseScript("param amount = 25 [0..100]\nparam k = 3\neach note:\n  pitch += 0").params;
  assert.deepEqual(p.map((x) => [x.name, x.value, x.min, x.max]), [["amount", 25, 0, 100], ["k", 3, 0, 6]]);
});

test("a script cannot reach anything but the notes", () => {
  assert.throws(() => run("each note:\n  pitch = constructor", triad), ScriptError);
  assert.throws(() => run("each note:\n  pitch = globalThis", triad), ScriptError);
  assert.throws(() => run("each note:\n  pitch = fetch(1)", triad), ScriptError);
});

import { euclid } from "../../web/daw/script.js";
const bits = (a) => a.map((x) => (x ? "x" : ".")).join("");

test("euclid spreads hits evenly, and rotate shifts them", () => {
  assert.equal(bits(euclid(3, 8)), "x..x..x.");
  assert.equal(bits(euclid(5, 8)), "x.x.xx.x");
  assert.equal(bits(euclid(3, 8, 1)), "..x..x.x");
  assert.equal(euclid(3, 8, 1).filter(Boolean).length, 3);
  assert.equal(euclid(0, 4).some(Boolean), false);
  assert.equal(euclid(9, 4).every(Boolean), true);
});

test("the euclid statement places the chord at the hits", () => {
  const two = [60, 64].map((pitch) => ({ pitch, start: 0, length: 2, velocity: 90 }));
  const out = run("each chord:\n  euclid 3 of 8 step 1/16n", two);
  assert.deepEqual([...new Set(out.map((n) => n.start))], [0, 0.75, 1.5]);
  assert.equal(out.length, 6);
});

test("scales snap, shift and name degrees", () => {
  const n = (pitch) => [{ pitch, start: 0, length: 1, velocity: 90 }];
  assert.equal(run("scale minor D\neach note:\n  pitch = snap(pitch)", n(63))[0].pitch, 62); // a tie goes down
  assert.equal(run("scale minor D\neach note:\n  pitch = snap(pitch)", n(64))[0].pitch, 64);
  assert.equal(run("scale major C\neach note:\n  pitch = shift(pitch, 2)", n(60))[0].pitch, 64);
  assert.equal(run("scale major C\neach note:\n  pitch = shift(pitch, -1)", n(60))[0].pitch, 59);
  assert.equal(run("scale major C\neach note:\n  pitch = degree(pitch) + 50", n(67))[0].pitch, 55);
  assert.equal(run("scale blues F#\neach note:\n  pitch = snap(pitch)", n(66))[0].pitch, 66);
  assert.throws(() => run("scale nope\neach note:\n  pitch = 1", n(60)), /there is no scale nope/);
});

test("a script can read another track", () => {
  const kick = { Kick: [{ pitch: 36, start: 0, length: 0.25, velocity: 100 }] };
  const notes = [0, 1].map((start) => ({ pitch: 60, start, length: 0.5, velocity: 100 }));
  const code = 'use "kick" as k\neach note:\n  if starts(k): velocity = 50';
  const out = run(code, notes, { tracks: kick });
  assert.deepEqual(out.map((x) => x.velocity), [50, 100]);
  assert.throws(() => run('use "Bass" as b\neach note:\n  pitch += 0', notes, { tracks: kick }), /there is no track called "Bass"/);
  assert.equal(run('use "Kick" as k\neach note:\n  pitch = lowest(k) + 24 * playing(k)', notes, { tracks: kick })[0].pitch, 60);
});
