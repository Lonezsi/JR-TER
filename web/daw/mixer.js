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
// comp, drive, delay, reverb are rack.js's too (its units: ms, %, dB, Hz). Song files older than version 11 had
// their own (seconds, 0..1, "dist"); upgradeOldFx converts them when a file opens.
// Old song files (v1-v4) have none of this and open with defaults.

import { cleanBands, UNITS } from "./rack.js";

export const MAX_FX = 8;
export const MAX_BUSES = 16;

// An effect's knobs as [min, max, default, unit], read off rack.js so there is one set of numbers.
const fromRack = (kind) => Object.fromEntries(UNITS[kind].knobs.map((k) => [k.key, [k.min, k.max, k.value, k.unit]]));

export const FX = {
  // The EQ is rack.js's parametric EQ: no knobs here, its bands are in fx.bands.
  eq:     { label: "EQ",     params: {} },
  comp:   { label: "Comp",   params: fromRack("comp") },
  drive:  { label: "Drive",  params: fromRack("drive") },
  delay:  { label: "Delay",  params: fromRack("delay") },
  reverb: { label: "Reverb", params: fromRack("reverb") },
  // rack.js's limiter; its knobs (ranges, defaults) are read off rack.js, so there is one set of numbers.
  limiter: { label: "Limiter", params: fromRack("limiter") },
  // A Web Audio Module (WAM 2) plugin loaded from an address: { url, name, state }. No knobs here; the plugin has its own window.
  wam:    { label: "Plugin", params: {} },
};
export const FX_TYPES = ["eq", "comp", "drive", "delay", "reverb", "limiter", "wam"];
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
      newBus("Reverb", [newFx("reverb")].map((f) => ({ ...f, mix: 100 }))),
      newBus("Delay", [newFx("delay")].map((f) => ({ ...f, mix: 100 }))),
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

// ── old effects (song files before version 11) ──────────────────────────────────────────────
const r1 = (n) => Math.round(n * 10) / 10;
// An old mix (0..1: dry 1 - m/2, wet m) as rack.js's % (equal power) with the same wet:dry balance.
export const oldMix = (m) => { m = clamp(num(m, 0.3), 0, 1); return r1(Math.atan2(m, 1 - m / 2) / (Math.PI / 2) * 100); };
// The level the old mix had over the new one, in dB (Drive puts it on its Output knob).
export const oldMixDb = (m) => { m = clamp(num(m, 0.3), 0, 1); return r1(20 * Math.log10(Math.hypot(1 - m / 2, m))); };
// Old drive (0..1; curve (1+k)x/(1+k|x|), k = 100d) as rack.js's amount %, matching the curve's slope at 0
// (rack: tanh(kx)/tanh(k) with k = 1 + 0.4 * amount, slope k/tanh(k)).
export function oldDrive(d) {
  const target = 1 + 100 * clamp(num(d, 0.4), 0, 1);
  if (target <= 1 / Math.tanh(1)) return 0;
  let lo = 1, hi = 41;
  for (let i = 0; i < 60; i++) { const k = (lo + hi) / 2; if (k / Math.tanh(k) < target) lo = k; else hi = k; }
  return clamp(r1(((lo + hi) / 2 - 1) / 0.4), 0, 100);
}

// One old effect as rack.js's, or the same object if it is not one of the old kinds.
function oldEffect(x) {
  const on = x.on !== false, n = (v, d) => num(v, d);
  switch (x.type) {
    case "comp": return { type: "comp", on, threshold: n(x.threshold, -18), ratio: n(x.ratio, 4),
      attack: r1(n(x.attack, 0.01) * 1000), release: r1(n(x.release, 0.2) * 1000), knee: 6, makeup: 0 };
    case "dist": return { type: "drive", on, amount: oldDrive(x.drive), mix: oldMix(n(x.mix, 1)), output: oldMixDb(n(x.mix, 1)) };
    case "delay": return { type: "delay", on, time: r1(n(x.time, 0.375) * 1000), feedback: r1(n(x.feedback, 0.35) * 100), tone: 16000, mix: oldMix(n(x.mix, 0.3)) };
    case "reverb": return { type: "reverb", on, size: n(x.size, 2), predelay: 0, tone: 18000, mix: oldMix(n(x.mix, 0.3)) };
    default: return x;
  }
}

// An automation lane's value on an old effect's knob, in rack.js's units; null param = keep.
function oldLane(fx, param) {
  if (!fx) return null;
  const f = { comp: { attack: [null, (v) => r1(v * 1000)], release: [null, (v) => r1(v * 1000)] },
    dist: { drive: ["amount", oldDrive], mix: [null, oldMix] },
    delay: { time: [null, (v) => r1(v * 1000)], feedback: [null, (v) => r1(v * 100)], mix: [null, oldMix] },
    reverb: { mix: [null, oldMix] } }[fx.type];
  return f && f[param] ? f[param] : null;
}

// Convert a parsed song (version < 11) in place: every effect list and the automation lanes on them.
export function upgradeOldFx(j) {
  const lists = { master: j.mixer && j.mixer.master };
  (Array.isArray(j.tracks) ? j.tracks : []).forEach((t, i) => { lists["t" + i] = t; });
  (j.mixer && Array.isArray(j.mixer.buses) ? j.mixer.buses : []).forEach((b, i) => { lists["bus" + i] = b; });
  const fxAt = (who, k) => { const o = lists[who]; return o && Array.isArray(o.fx) ? o.fx[k] : null; };
  if (Array.isArray(j.automation)) {
    for (const lane of j.automation) {
      const m = lane && typeof lane.target === "string" && /^(t\d+|master|bus\d+)\.fx(\d+)\.(\w+)$/.exec(lane.target);
      if (!m) continue;
      const map = oldLane(fxAt(m[1], +m[2]), m[3]);
      if (!map) continue;
      if (map[0]) lane.target = `${m[1]}.fx${m[2]}.${map[0]}`;
      for (const p of Array.isArray(lane.points) ? lane.points : []) if (p && Number.isFinite(p.value)) p.value = map[1](p.value);
    }
  }
  for (const o of Object.values(lists)) if (o && Array.isArray(o.fx)) o.fx = o.fx.map((x) => (x && typeof x === "object" ? oldEffect(x) : x));
  return j;
}
