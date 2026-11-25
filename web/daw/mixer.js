// mixer.js: the mixer's model and maths. Pure functions, no DOM, no Web Audio (tests/daw).
//
// Routing works the way a desktop DAW's mixer does: every track is an insert, the buses are more
// inserts, and any insert can feed any bus as well as its main output.
//
// Each track has (all optional in files, defaults fill in):  pan -1..1,  sends [..] 0..1, one per bus
// (how much of it goes to that bus),  out: where its fader goes, "m" (the master, the default) or
// "b<i>" (bus i),  fx: the track's insert effects, in order. volume, mute and solo stay on the track.
// The song has
//   mixer = { master: { volume, fx }, buses: [ {name, volume, pan, mute, out, fx, sends}, ... ] }
// with 2..MAX_BUSES buses (the first two start as Reverb and Delay). A bus's sends feed later buses
// only through `out`; a route that would make a loop (bus 1 into 2 into 1) goes to the master instead.
// The master ends in a fixed limiter that is not saved: rack.js's limiter at MASTER_LIMITER.
// The "limiter" type is rack.js's limiter too: { threshold, ceiling in dB, attack, release in ms }.
// An effect is { type, on, ...settings }. Types and their settings are in FX below:
// [min, max, default, unit].  Unknown types are dropped, numbers are clamped.
// The "eq" type is rack.js's parametric EQ: { bands: [ {id, type, freq, gain, q, on} ] }, up to 24, as a song's Sound tab.
// An old 3-band EQ (low, mid, high) opens as a low shelf 200 Hz, a bell 1 kHz Q 0.8 and a high shelf 5 kHz.
// The "wam" type is a plugin: { url, name, state } (state is the plugin's own saved settings, at most 64 KB of JSON).
// Old song files (v1-v4) have none of this and open with defaults.

import { cleanBands, UNITS } from "./rack.js";

export const MAX_FX = 8;
export const MAX_BUSES = 16;

export const FX = {
  // The EQ is rack.js's parametric EQ: no knobs here, its bands are in fx.bands.
  eq:     { label: "EQ",     params: {} },
  comp:   { label: "Comp",   params: { threshold: [-60, 0, -18, "dB"], ratio: [1, 20, 4, ":1"], attack: [0.001, 0.3, 0.01, "s"], release: [0.02, 1, 0.2, "s"] } },
  dist:   { label: "Drive",  params: { drive: [0, 1, 0.4, ""], mix: [0, 1, 1, ""] } },
  delay:  { label: "Delay",  params: { time: [0.05, 1.5, 0.375, "s"], feedback: [0, 0.9, 0.35, ""], mix: [0, 1, 0.3, ""] } },
  reverb: { label: "Reverb", params: { size: [0.3, 6, 2, "s"], mix: [0, 1, 0.3, ""] } },
  // rack.js's limiter; its knobs (ranges, defaults) are read off rack.js, so there is one set of numbers.
  limiter: { label: "Limiter", params: Object.fromEntries(UNITS.limiter.knobs.map((k) => [k.key, [k.min, k.max, k.value, k.unit]])) },
  // A Web Audio Module (WAM 2) plugin loaded from an address: { url, name, state }. No knobs here; the plugin has its own window.
  wam:    { label: "Plugin", params: {} },
};
export const FX_TYPES = ["eq", "comp", "dist", "delay", "reverb", "limiter", "wam"];
// The master's fixed limiter (not saved), built by rack.js like any Limiter effect.
export const MASTER_LIMITER = { id: "master", kind: "limiter", on: true, threshold: -1, ceiling: -1, attack: 3, release: 100 };
export const WAM_STATE_MAX = 65536;
// A plugin address: https, or a path on this server. Anything else is dropped.
export const wamUrl = (u) => (typeof u === "string" && u.length <= 500 && /^(https:\/\/[^\s]+|\/(?!\/)[^\s]*)$/.test(u) ? u : "");

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const num = (v, d) => (Number.isFinite(v) ? v : d);

export function newFx(type) {
  const spec = FX[type];
  if (!spec) throw new Error("Unknown effect " + type);
  const fx = { type, on: true };
  for (const [k, [, , d]] of Object.entries(spec.params)) fx[k] = d;
  if (type === "wam") Object.assign(fx, { url: "", name: "", state: null });
  if (type === "eq") fx.bands = [];
  return fx;
}

// An old 3-band EQ (low, mid, high in dB, -12..12) as the bands that sound the same.
export function oldEqBands(x) {
  const g = (v) => clamp(num(v, 0), -12, 12);
  return [
    { id: "b1", type: "lowshelf", freq: 200, gain: g(x && x.low), q: 0.7, on: true },
    { id: "b2", type: "peaking", freq: 1000, gain: g(x && x.mid), q: 0.8, on: true },
    { id: "b3", type: "highshelf", freq: 5000, gain: g(x && x.high), q: 0.7, on: true },
  ];
}

// Move the effect at `from` to `to` in place (`to` is clamped); returns the list.
export function moveFx(list, from, to) {
  to = Math.max(0, Math.min(list.length - 1, to));
  if (from === to || from < 0 || from >= list.length) return list;
  list.splice(to, 0, list.splice(from, 1)[0]);
  return list;
}

export function cleanFx(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const x of list) {
    if (!x || !FX[x.type] || out.length >= MAX_FX) continue;
    const fx = { type: x.type, on: x.on !== false };
    for (const [k, [lo, hi, d]] of Object.entries(FX[x.type].params)) fx[k] = clamp(num(x[k], d), lo, hi);
    if (x.type === "eq") fx.bands = Array.isArray(x.bands) ? cleanBands(x.bands) : oldEqBands(x);
    if (x.type === "wam") {
      fx.url = wamUrl(x.url);
      fx.name = typeof x.name === "string" ? x.name.slice(0, 80) : "";
      let st = null;
      try { st = x.state != null && JSON.stringify(x.state).length <= WAM_STATE_MAX ? JSON.parse(JSON.stringify(x.state)) : null; } catch { st = null; }
      fx.state = st;
    }
    out.push(fx);
  }
  return out;
}

// Where an insert's fader goes: "m", or "b<i>" for a bus that exists.
const cleanOut = (o, buses) => (typeof o === "string" && /^b\d+$/.test(o) && +o.slice(1) < buses ? o : "m");

// `buses` is how many buses the song has (sends are one per bus). Left out, it is what the track carries.
export function cleanTrackMix(t, buses) {
  const s = t && Array.isArray(t.sends) ? t.sends : [];
  const n = clamp(Math.round(num(buses, Math.max(2, s.length))), 2, MAX_BUSES);
  return {
    pan: clamp(num(t && t.pan, 0), -1, 1),
    sends: Array.from({ length: n }, (_, i) => clamp(num(s[i], 0), 0, 1)),
    out: cleanOut(t && t.out, n),
    fx: cleanFx(t && t.fx),
  };
}

export function newBus(name, fx = []) {
  return { name, volume: 0.8, pan: 0, mute: false, out: "m", fx };
}

export function defaultMixer() {
  return {
    master: { volume: 0.8, fx: [] },
    buses: [
      newBus("Reverb", [newFx("reverb")].map((f) => ({ ...f, mix: 1 }))),
      newBus("Delay", [newFx("delay")].map((f) => ({ ...f, mix: 1 }))),
    ],
  };
}

// Would sending bus `from` into bus `to` make a loop? Follows `to`'s outputs to the end.
export function loops(buses, from, to) {
  let at = to, steps = 0;
  while (steps++ <= buses.length) {
    if (at === from) return true;
    const o = buses[at] && buses[at].out;
    if (!o || o === "m") return false;
    at = +o.slice(1);
  }
  return true;
}

export function cleanMixer(m) {
  const d = defaultMixer();
  if (!m || typeof m !== "object") return d;
  const mb = (Array.isArray(m.buses) ? m.buses : []).slice(0, MAX_BUSES);
  const n = Math.max(2, mb.length);
  const bus = (b, i) => {
    const def = d.buses[i] || newBus("Insert " + (i + 1));
    return {
      name: String((b && b.name) || def.name).slice(0, 40),
      volume: clamp(num(b && b.volume, def.volume), 0, 1),
      pan: clamp(num(b && b.pan, 0), -1, 1),
      mute: !!(b && b.mute),
      out: cleanOut(b && b.out, n),
      fx: b && Array.isArray(b.fx) ? cleanFx(b.fx) : def.fx,
    };
  };
  const buses = Array.from({ length: n }, (_, i) => bus(mb[i], i));
  // No loops: a bus whose output leads back to itself goes to the master.
  buses.forEach((b, i) => { if (b.out !== "m" && (+b.out.slice(1) === i || loops(buses, i, +b.out.slice(1)))) b.out = "m"; });
  return {
    master: { volume: clamp(num(m.master && m.master.volume, 0.8), 0, 1), fx: cleanFx(m.master && m.master.fx) },
    buses,
  };
}

// Fill in whatever a song is missing, in place.
export function ensureMix(song) {
  song.mixer = cleanMixer(song.mixer);
  for (const t of song.tracks) Object.assign(t, cleanTrackMix(t, song.mixer.buses.length));
  return song;
}

// A bus added at the end: it starts empty, at the master, and every track gets a send to it at 0.
export function addBus(song, name) {
  ensureMix(song);
  if (song.mixer.buses.length >= MAX_BUSES) return null;
  song.mixer.buses.push(newBus(name || "Insert " + (song.mixer.buses.length + 1)));
  ensureMix(song);
  return song.mixer.buses.length - 1;
}

// Take bus i out: what went into it goes to the master, later buses move down one.
export function removeBus(song, i) {
  ensureMix(song);
  const buses = song.mixer.buses;
  if (buses.length <= 2 || !buses[i]) return false;
  const shift = (o) => (o === "m" ? "m" : +o.slice(1) === i ? "m" : +o.slice(1) > i ? "b" + (+o.slice(1) - 1) : o);
  for (const t of song.tracks) { t.sends.splice(i, 1); t.out = shift(t.out); }
  buses.splice(i, 1);
  for (const b of buses) b.out = shift(b.out);
  ensureMix(song);
  return true;
}

export const trackGain = (t, anySolo) => ((t.mute || (anySolo && !t.solo)) ? 0 : num(t.volume, 0.8));

// Reverb tail: noise that dies away. Two channels. `rand` can be seeded for tests.
export function impulse(seconds, sampleRate, rand = Math.random) {
  const len = Math.max(1, Math.round(seconds * sampleRate));
  return [0, 1].map(() => {
    const a = new Float32Array(len);
    for (let i = 0; i < len; i++) a[i] = (rand() * 2 - 1) * Math.pow(1 - i / len, 3);
    return a;
  });
}

// Waveshaper curve: soft clipping, odd, bounded, rising.
export function distCurve(drive, n = 1024) {
  const k = clamp(drive, 0, 1) * 100, c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    c[i] = ((1 + k) * x) / (1 + k * Math.abs(x));
  }
  return c;
}

// Peak of a block of samples in dB, never below -60.
export function level(samples) {
  let p = 0;
  for (let i = 0; i < samples.length; i++) p = Math.max(p, Math.abs(samples[i]));
  return p <= 0.001 ? -60 : Math.max(-60, 20 * Math.log10(p));
}

export const chainKey = (fx) => fx.map((f) => f.type + (f.on ? "1" : "0") + (f.type === "wam" ? "@" + f.url : "") +
  (f.type === "eq" ? "#" + (f.bands || []).map((b) => b.id + b.type + (b.on ? 1 : 0)).join("|") : "")).join(",");
// Where a plugin address comes from: "" for this server, else its origin (what the person allows).
export const pluginOrigin = (u) => (/^https:\/\//.test(u || "") ? new URL(u).origin : "");
