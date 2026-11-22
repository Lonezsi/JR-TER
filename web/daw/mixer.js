// mixer.js: the mixer's model and maths. Pure functions, no DOM, no Web Audio (tests/daw).
//
// Each track has (all optional in files, defaults fill in):  pan -1..1,  sends [a, b] 0..1
// (how much goes to the Reverb and Delay buses),  fx: the track's insert effects, in order.
// volume, mute and solo stay on the track as before. The song has
//   mixer = { master: { volume, fx }, buses: [ {name, volume, fx}, {name, volume, fx} ] }
// (always exactly two buses). The master ends in a fixed limiter that is not saved.
// An effect is { type, on, ...settings }. Types and their settings are in FX below:
// [min, max, default, unit].  Unknown types are dropped, numbers are clamped.
// Old song files (v1-v4) have none of this and open with defaults.

export const MAX_FX = 8;

export const FX = {
  eq:     { label: "EQ",     params: { low: [-12, 12, 0, "dB"], mid: [-12, 12, 0, "dB"], high: [-12, 12, 0, "dB"] } },
  comp:   { label: "Comp",   params: { threshold: [-60, 0, -18, "dB"], ratio: [1, 20, 4, ":1"], attack: [0.001, 0.3, 0.01, "s"], release: [0.02, 1, 0.2, "s"] } },
  dist:   { label: "Drive",  params: { drive: [0, 1, 0.4, ""], mix: [0, 1, 1, ""] } },
  delay:  { label: "Delay",  params: { time: [0.05, 1.5, 0.375, "s"], feedback: [0, 0.9, 0.35, ""], mix: [0, 1, 0.3, ""] } },
  reverb: { label: "Reverb", params: { size: [0.3, 6, 2, "s"], mix: [0, 1, 0.3, ""] } },
};
export const FX_TYPES = ["eq", "comp", "dist", "delay", "reverb"];

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const num = (v, d) => (Number.isFinite(v) ? v : d);

export function newFx(type) {
  const spec = FX[type];
  if (!spec) throw new Error("Unknown effect " + type);
  const fx = { type, on: true };
  for (const [k, [, , d]] of Object.entries(spec.params)) fx[k] = d;
  return fx;
}

export function cleanFx(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const x of list) {
    if (!x || !FX[x.type] || out.length >= MAX_FX) continue;
    const fx = { type: x.type, on: x.on !== false };
    for (const [k, [lo, hi, d]] of Object.entries(FX[x.type].params)) fx[k] = clamp(num(x[k], d), lo, hi);
    out.push(fx);
  }
  return out;
}

export function cleanTrackMix(t) {
  const s = t && Array.isArray(t.sends) ? t.sends : [];
  return {
    pan: clamp(num(t && t.pan, 0), -1, 1),
    sends: [clamp(num(s[0], 0), 0, 1), clamp(num(s[1], 0), 0, 1)],
    fx: cleanFx(t && t.fx),
  };
}

export function defaultMixer() {
  return {
    master: { volume: 0.8, fx: [] },
    buses: [
      { name: "Reverb", volume: 0.8, fx: [newFx("reverb")].map((f) => ({ ...f, mix: 1 })) },
      { name: "Delay", volume: 0.8, fx: [newFx("delay")].map((f) => ({ ...f, mix: 1 })) },
    ],
  };
}

export function cleanMixer(m) {
  const d = defaultMixer();
  if (!m || typeof m !== "object") return d;
  const bus = (b, def) => ({
    name: String((b && b.name) || def.name),
    volume: clamp(num(b && b.volume, def.volume), 0, 1),
    fx: b && Array.isArray(b.fx) ? cleanFx(b.fx) : def.fx,
  });
  const mb = Array.isArray(m.buses) ? m.buses : [];
  return {
    master: { volume: clamp(num(m.master && m.master.volume, 0.8), 0, 1), fx: cleanFx(m.master && m.master.fx) },
    buses: [bus(mb[0], d.buses[0]), bus(mb[1], d.buses[1])],
  };
}

// Fill in whatever a song is missing, in place.
export function ensureMix(song) {
  for (const t of song.tracks) Object.assign(t, cleanTrackMix(t));
  song.mixer = cleanMixer(song.mixer);
  return song;
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

export const chainKey = (fx) => fx.map((f) => f.type + (f.on ? "1" : "0")).join(",");
