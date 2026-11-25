// rack.js: the effects engine. A unit rack, the equaliser's maths and the limiter's maths.
// No DOM, no drawing.
//
// Copied from ui/src/lib/audio/rack.ts and eq.ts on the rebuild branch (plus responseOf from
// engine.ts), types stripped. This is the one effects engine: once ui/ source is committed,
// ui/ should import this file instead of keeping its own copy. Change effects here.
//
// The rack is the effects a preset runs, in order:  deck - unit - unit - ... - out
// A unit is { id, kind, on, ...its numbers }. Everything is a unit, the equaliser and the limiter
// included. The equaliser's bands stay in data.bands. A preset from before the rack (no `rack`),
// or from the first rack (limiter kept outside it, rack_v < 2), reads as what it was: its
// equaliser, then its limiter (data.limiter), then its output gain if it had one (rackOf).
// Each kind knows its own numbers (UNITS) and builds itself in any audio context, live or
// offline (buildUnit). A built unit takes new numbers with set() without being rebuilt; only
// adding, removing, reordering or switching units rewires the chain (shapeOf says when).
//
// PUBLIC API
//  Rack
//   UNITS ADDABLE MAX_UNITS      the kinds, their knobs, the menu order, the cap
//   rackOf(data)                 the preset's rack; an old preset's read as [eq, limiter, gain]
//   newUnit(kind)                a unit with its defaults
//   valueOf(unit, key)           a knob's number, the default if missing
//   summary(unit, data)          one line for the folded row
//   shapeOf(data)                what, if it changed, means rewiring
//   buildUnit(ctx, unit, data)   -> { input, output, nodes, set(unit, data), reduction? }
//   rackImpulse(ctx, seconds)    the reverb's tail (fixed seed, so bounce = live)
//   driveCurve(amount) dbToGain(db)
//  Equaliser
//   F_MIN F_MAX GRID_F LABEL_F RANGES DEFAULT_RANGE TYPE_LABEL BAND_TYPES GAINLESS isGainless
//   freqToX xToFreq gainToY yToGain      log frequency axis; centre line is 0 dB, 12px padding
//   bandAt(bands, x, y, size, range, radius?)   nearest band within 14px
//   newId() newBand(type?) bandAtPoint(x,y,size,range) addBand(bands, band) dragBand(band,x,y,size,range)
//   qFromWheel(q, deltaY) qReach(q) reachSpan(freq, q)
//   spectrumY spectrumPoints curveY gridSteps fmtHz
//   responseOf(ctx, bands, frequencies, bypass?)   dB of a set of bands; never connects a filter
//  Limiter
//   DB_MIN DB_MAX DEFAULT_LIMITER LIMITER_KNOBS GAIN_TRIM REDUCTION_MAX_DB HISTORY
//   dbToX xToDb limiterLineAt limiterValues setLimiterLine ReductionHistory
//
// Sizes are CSS pixels. A band is { id, type, freq, gain, q, on }.

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

// ── rack ────────────────────────────────────────────────────────────────────

export const UNITS = {
  eq: { name: "Equaliser", blurb: "Shape the frequencies", knobs: [] },
  comp: {
    name: "Compressor", blurb: "Tames peaks, adds punch",
    knobs: [
      { key: "threshold", label: "Threshold", min: -60, max: 0, step: 0.5, unit: "dB", value: -18 },
      { key: "ratio", label: "Ratio", min: 1, max: 20, step: 0.1, unit: ":1", value: 3 },
      { key: "attack", label: "Attack", min: 0, max: 200, step: 1, unit: "ms", value: 10 },
      { key: "release", label: "Release", min: 10, max: 1000, step: 5, unit: "ms", value: 150 },
      { key: "knee", label: "Knee", min: 0, max: 40, step: 1, unit: "dB", value: 6 },
      { key: "makeup", label: "Makeup", min: 0, max: 24, step: 0.1, unit: "dB", value: 3 },
    ],
  },
  drive: {
    name: "Saturation", blurb: "Warmth, or grit if you push it",
    knobs: [
      { key: "amount", label: "Drive", min: 0, max: 100, step: 1, unit: "%", value: 25 },
      { key: "mix", label: "Mix", min: 0, max: 100, step: 1, unit: "%", value: 100 },
      { key: "output", label: "Output", min: -18, max: 6, step: 0.1, unit: "dB", value: 0 },
    ],
  },
  delay: {
    name: "Delay", blurb: "Echoes",
    knobs: [
      { key: "time", label: "Time", min: 10, max: 2000, step: 1, unit: "ms", value: 350 },
      { key: "feedback", label: "Feedback", min: 0, max: 90, step: 1, unit: "%", value: 35 },
      { key: "tone", label: "Tone", min: 500, max: 16000, step: 50, unit: "Hz", value: 5000 },
      { key: "mix", label: "Mix", min: 0, max: 100, step: 1, unit: "%", value: 20 },
    ],
  },
  reverb: {
    name: "Reverb", blurb: "Space",
    knobs: [
      { key: "size", label: "Decay", min: 0.2, max: 8, step: 0.1, unit: "s", value: 1.8 },
      { key: "predelay", label: "Pre-delay", min: 0, max: 200, step: 1, unit: "ms", value: 15 },
      { key: "tone", label: "Tone", min: 1000, max: 18000, step: 100, unit: "Hz", value: 8000 },
      { key: "mix", label: "Mix", min: 0, max: 100, step: 1, unit: "%", value: 18 },
    ],
  },
  width: {
    name: "Stereo width", blurb: "Narrow it or open it up",
    knobs: [{ key: "width", label: "Width", min: 0, max: 200, step: 1, unit: "%", value: 100 }],
  },
  gain: {
    name: "Gain", blurb: "Volume",
    knobs: [{ key: "db", label: "Gain", min: -24, max: 24, step: 0.1, unit: "dB", value: 0 }],
  },
  limiter: {
    name: "Limiter", blurb: "Nothing gets past the ceiling",
    knobs: [
      { key: "threshold", label: "Threshold", min: -60, max: 0, step: 0.1, unit: "dB", value: -6 },
      { key: "ceiling", label: "Ceiling", min: -30, max: 0, step: 0.1, unit: "dB", value: -0.3 },
      { key: "attack", label: "Attack", min: 0, max: 100, step: 1, unit: "ms", value: 5 },
      { key: "release", label: "Release", min: 10, max: 1000, step: 5, unit: "ms", value: 120 },
    ],
  },
};
export const ADDABLE = ["eq", "comp", "drive", "delay", "reverb", "width", "gain", "limiter"];
export const MAX_UNITS = 16;

let unitCounter = 0;
const newUnitId = () => `u${Date.now().toString(36)}${unitCounter++}`;

export function newUnit(kind) {
  const unit = { id: kind === "eq" ? "eq" : newUnitId(), kind, on: true };
  for (const k of UNITS[kind].knobs) unit[k.key] = k.value;
  return unit;
}

/** The rack. A preset written before the limiter became an effect gets its limiter (and its
 *  output gain, if it had any) appended from the old fields, as it sounded. */
export function rackOf(data) {
  const base = data?.rack ? data.rack : [{ id: "eq", kind: "eq", on: true }];
  if (!data || (data.rack_v ?? 0) >= 2) return base;
  const lim = data.limiter || { on: false };
  const out = [...base, {
    id: "limiter", kind: "limiter", on: !!lim.on,
    threshold: lim.threshold ?? -6, ceiling: lim.ceiling ?? -0.3, attack: lim.attack ?? 5, release: lim.release ?? 120,
  }];
  if (data.gain) out.push({ id: "gain", kind: "gain", on: true, db: data.gain });
  return out;
}

export const valueOf = (unit, key) => {
  const v = unit[key];
  if (typeof v === "number" && Number.isFinite(v)) return v;
  return UNITS[unit.kind]?.knobs.find((k) => k.key === key)?.value ?? 0;
};

const fmt = (n, unit) =>
  `${Math.abs(n) >= 100 || Number.isInteger(n) ? Math.round(n) : n.toFixed(1)}${unit === ":1" ? ":1" : unit === "%" ? "%" : " " + unit}`;

export function summary(unit, data) {
  const v = (k) => valueOf(unit, k);
  switch (unit.kind) {
    case "eq": { const n = (data.bands || []).length; return n ? `${n} band${n === 1 ? "" : "s"}` : "flat"; }
    case "comp": return `${fmt(v("threshold"), "dB")} · ${fmt(v("ratio"), ":1")}`;
    case "drive": return `${fmt(v("amount"), "%")} drive`;
    case "delay": return `${fmt(v("time"), "ms")} · ${fmt(v("mix"), "%")} wet`;
    case "reverb": return `${fmt(v("size"), "s")} · ${fmt(v("mix"), "%")} wet`;
    case "width": return fmt(v("width"), "%");
    case "gain": return `${v("db") > 0 ? "+" : ""}${fmt(v("db"), "dB")}`;
    case "limiter": return `${fmt(v("ceiling"), "dB")} ceiling`;
    default: return "";
  }
}

/** What has to be rewired for: which units, in what order, which are on, and the equaliser's
 *  band list. Anything else is numbers, set on the running nodes. */
export function shapeOf(data) {
  const units = data.bypass ? [] : rackOf(data).filter((u) => u.on);
  return JSON.stringify([units.map((u) => [u.id, u.kind]),
    (data.bands || []).map((b) => [b.id, b.type, b.on])]);
}

// ── building ────────────────────────────────────────────────────────────────

export const dbToGain = (db) => Math.pow(10, db / 20);

/** A wet/dry pair around some processing: input splits, the two come back together. */
function blend(ctx) {
  const input = ctx.createGain(), output = ctx.createGain(), dry = ctx.createGain(), wet = ctx.createGain();
  input.connect(dry); dry.connect(output); wet.connect(output);
  return {
    input, output, dry, wet, nodes: [input, output, dry, wet],
    mix(pct) { const m = clamp(pct, 0, 100) / 100; dry.gain.value = Math.cos(m * Math.PI / 2); wet.gain.value = Math.sin(m * Math.PI / 2); },
  };
}

/** The same tail every time for the same decay: a fixed seed, so an offline bounce and the
 *  live deck convolve with an identical impulse. */
export function rackImpulse(ctx, seconds) {
  const rate = ctx.sampleRate;
  const length = Math.max(1, Math.floor(rate * clamp(seconds, 0.1, 10)));
  const buffer = ctx.createBuffer(2, length, rate);
  for (let ch = 0; ch < 2; ch++) {
    const out = buffer.getChannelData(ch);
    let seed = 0x9e3779b9 ^ (ch * 0x85ebca6b);
    for (let i = 0; i < length; i++) {
      seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
      const noise = ((seed >>> 0) / 4294967296) * 2 - 1;
      // An exponential decay to -60 dB at the given time, with a 4 ms fade in.
      const env = Math.exp(-6.9 * i / length) * Math.min(1, i / (rate * 0.004));
      out[i] = noise * env;
    }
  }
  return buffer;
}

export function driveCurve(amount) {
  const k = 1 + clamp(amount, 0, 100) * 0.4;
  const n = 2048, curve = new Float32Array(n);
  const norm = Math.tanh(k);
  for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; curve[i] = Math.tanh(k * x) / norm; }
  return curve;
}

export function buildUnit(ctx, unit, data) {
  switch (unit.kind) {
    case "eq": {
      const input = ctx.createGain();
      const filters = [];
      for (const band of data.bands || []) {
        if (!band.on) continue;
        const f = ctx.createBiquadFilter();
        f.type = band.type; f._id = band.id;
        filters.push(f);
      }
      let node = input;
      for (const f of filters) { node.connect(f); node = f; }
      const set = (_u, d) => {
        for (const band of d.bands || []) {
          const f = filters.find((x) => x._id === band.id);
          if (!f) continue;
          f.frequency.value = clamp(band.freq, 10, ctx.sampleRate / 2 - 100);
          f.Q.value = band.q;
          f.gain.value = band.gain;
        }
      };
      set(unit, data);
      return { input, output: node, nodes: [input, ...filters], set };
    }
    case "comp": {
      const comp = ctx.createDynamicsCompressor(), makeup = ctx.createGain();
      comp.connect(makeup);
      const set = (u) => {
        comp.threshold.value = clamp(valueOf(u, "threshold"), -100, 0);
        comp.ratio.value = clamp(valueOf(u, "ratio"), 1, 20);
        comp.attack.value = clamp(valueOf(u, "attack") / 1000, 0, 1);
        comp.release.value = clamp(valueOf(u, "release") / 1000, 0, 1);
        comp.knee.value = clamp(valueOf(u, "knee"), 0, 40);
        makeup.gain.value = dbToGain(valueOf(u, "makeup"));
      };
      set(unit);
      return { input: comp, output: makeup, nodes: [comp, makeup], set, reduction: () => Math.abs(comp.reduction || 0) };
    }
    case "limiter": {
      // Hard knee, steep ratio; the makeup brings what it holds at the threshold back up to
      // the ceiling, so the ceiling line is where the loudest part ends up.
      const comp = ctx.createDynamicsCompressor(), makeup = ctx.createGain();
      comp.connect(makeup);
      const set = (u) => {
        const threshold = clamp(valueOf(u, "threshold"), -60, 0);
        const ceiling = clamp(valueOf(u, "ceiling"), -30, 0);
        comp.knee.value = 0; comp.ratio.value = 20;
        comp.threshold.value = threshold;
        comp.attack.value = clamp(valueOf(u, "attack") / 1000, 0, 0.1);
        comp.release.value = clamp(valueOf(u, "release") / 1000, 0.001, 1);
        makeup.gain.value = dbToGain(ceiling - threshold);
      };
      set(unit);
      return { input: comp, output: makeup, nodes: [comp, makeup], set, reduction: () => Math.abs(comp.reduction || 0) };
    }
    case "drive": {
      const b = blend(ctx), shaper = ctx.createWaveShaper(), out = ctx.createGain();
      shaper.oversample = "4x";
      b.input.connect(shaper); shaper.connect(b.wet); b.output.connect(out);
      let last = -1;
      const set = (u) => {
        const amount = valueOf(u, "amount");
        if (amount !== last) { shaper.curve = driveCurve(amount); last = amount; }
        b.mix(valueOf(u, "mix"));
        out.gain.value = dbToGain(valueOf(u, "output"));
      };
      set(unit);
      return { input: b.input, output: out, nodes: [...b.nodes, shaper, out], set };
    }
    case "delay": {
      const b = blend(ctx), delay = ctx.createDelay(2.5), feedback = ctx.createGain(), tone = ctx.createBiquadFilter();
      tone.type = "lowpass";
      b.input.connect(delay); delay.connect(tone); tone.connect(feedback); feedback.connect(delay); tone.connect(b.wet);
      const set = (u) => {
        delay.delayTime.value = clamp(valueOf(u, "time") / 1000, 0.001, 2.4);
        feedback.gain.value = clamp(valueOf(u, "feedback"), 0, 90) / 100;
        tone.frequency.value = clamp(valueOf(u, "tone"), 200, ctx.sampleRate / 2 - 100);
        b.mix(valueOf(u, "mix"));
      };
      set(unit);
      return { input: b.input, output: b.output, nodes: [...b.nodes, delay, feedback, tone], set };
    }
    case "reverb": {
      const b = blend(ctx), pre = ctx.createDelay(0.5), conv = ctx.createConvolver(), tone = ctx.createBiquadFilter();
      tone.type = "lowpass";
      b.input.connect(pre); pre.connect(conv); conv.connect(tone); tone.connect(b.wet);
      let size = -1;
      const set = (u) => {
        const s = Math.round(valueOf(u, "size") * 10) / 10;
        if (s !== size) { conv.buffer = rackImpulse(ctx, s); size = s; }
        pre.delayTime.value = clamp(valueOf(u, "predelay") / 1000, 0, 0.45);
        tone.frequency.value = clamp(valueOf(u, "tone"), 200, ctx.sampleRate / 2 - 100);
        b.mix(valueOf(u, "mix"));
      };
      set(unit);
      return { input: b.input, output: b.output, nodes: [...b.nodes, pre, conv, tone], set };
    }
    case "width": {
      // Mid and side: L = M + wS, R = M - wS, with M = (L+R)/2 and S = (L-R)/2.
      const input = ctx.createGain(), split = ctx.createChannelSplitter(2), merge = ctx.createChannelMerger(2);
      const lToL = ctx.createGain(), rToL = ctx.createGain(), lToR = ctx.createGain(), rToR = ctx.createGain();
      input.channelCount = 2; input.channelCountMode = "explicit"; input.channelInterpretation = "speakers";
      input.connect(split);
      split.connect(lToL, 0); split.connect(rToL, 1); split.connect(lToR, 0); split.connect(rToR, 1);
      lToL.connect(merge, 0, 0); rToL.connect(merge, 0, 0); lToR.connect(merge, 0, 1); rToR.connect(merge, 0, 1);
      const set = (u) => {
        const w = clamp(valueOf(u, "width"), 0, 200) / 100;
        lToL.gain.value = (1 + w) / 2; rToL.gain.value = (1 - w) / 2;
        lToR.gain.value = (1 - w) / 2; rToR.gain.value = (1 + w) / 2;
      };
      set(unit);
      return { input, output: merge, nodes: [input, split, merge, lToL, rToL, lToR, rToR], set };
    }
    case "gain":
    default: {
      const g = ctx.createGain();
      const set = (u) => { g.gain.value = dbToGain(clamp(valueOf(u, "db"), -48, 24)); };
      set(unit);
      return { input: g, output: g, nodes: [g], set };
    }
  }
}

// ── equaliser ───────────────────────────────────────────────────────────────

export const F_MIN = 20, F_MAX = 22000;
const DECADES = Math.log10(F_MAX / F_MIN);
export const GRID_F = [30, 50, 100, 200, 300, 500, 1000, 2000, 3000, 5000, 10000, 20000];
export const LABEL_F = { 100: "100", 1000: "1k", 10000: "10k" };

/** dB shown above and below the centre line, as the range pills offer them. */
export const RANGES = [12, 18, 24, 30];
export const DEFAULT_RANGE = 18;

export const TYPE_LABEL = {
  peaking: "Bell", lowshelf: "Low shelf", highshelf: "High shelf",
  // A high pass filter removes the lows, so it is the Low cut.
  lowpass: "High cut", highpass: "Low cut", notch: "Notch", bandpass: "Band",
  allpass: "All pass",
};
/** The types a band can be, in menu order. */
export const BAND_TYPES = ["peaking", "lowshelf", "highshelf", "lowpass", "highpass", "notch", "bandpass"];

/** These have no gain, so their node sits on the centre line and dragging moves only frequency. */
export const GAINLESS = new Set(["lowpass", "highpass", "notch", "bandpass"]);
export const isGainless = (type) => GAINLESS.has(type);

// The gain axis keeps this much of the height clear at top and bottom.
const PAD = 12;

export const freqToX = (f, width) => (Math.log10(clamp(f, F_MIN, F_MAX) / F_MIN) / DECADES) * width;
export const xToFreq = (x, width) => F_MIN * Math.pow(10, (clamp(x, 0, width) / width) * DECADES);
export const gainToY = (g, height, range) => height / 2 - (g / range) * (height / 2 - PAD);
export const yToGain = (y, height, range) => ((height / 2 - y) / (height / 2 - PAD)) * range;

/** The band whose node is nearest the point, within `radius` pixels. */
export function bandAt(bands, x, y, size, range, radius = 14) {
  let best = null, bestDist = radius;
  for (const band of bands) {
    const dx = freqToX(band.freq, size.width) - x;
    const dy = gainToY(isGainless(band.type) ? 0 : band.gain, size.height, range) - y;
    const dist = Math.hypot(dx, dy);
    if (dist < bestDist) { best = band; bestDist = dist; }
  }
  return best;
}

let bandCounter = 1;
/** An id no other band has, within this tab or across sessions. */
export const newId = () => `b${Date.now().toString(36)}${bandCounter++}`;

const tenth = (n) => Math.round(n * 10) / 10;

/** A band as the Add buttons make it: a sensible starting frequency for its type. */
export function newBand(type = "peaking") {
  return {
    id: newId(), type,
    freq: type === "highpass" ? 80 : type === "lowpass" ? 12000 : 1000,
    gain: 0, q: type === "peaking" ? 1.2 : 0.7, on: true,
  };
}

/** A bell placed where the pointer went down, so one gesture places it and the same motion can drag it. */
export function bandAtPoint(x, y, size, range) {
  return {
    id: newId(), type: "peaking",
    freq: tenth(clamp(xToFreq(x, size.width), F_MIN, F_MAX)),
    gain: tenth(clamp(yToGain(y, size.height, range), -range, range)),
    q: 1.2, on: true,
  };
}

/** Add and keep the list in frequency order. */
export function addBand(bands, band) {
  bands.push(band);
  bands.sort((a, b) => a.freq - b.freq);
  return bands;
}

/** Move a band to where a drag has got to. Gainless types keep their gain. */
export function dragBand(band, x, y, size, range) {
  band.freq = tenth(clamp(xToFreq(x, size.width), F_MIN, F_MAX));
  if (!isGainless(band.type)) band.gain = tenth(clamp(yToGain(y, size.height, range), -range, range));
}

/** Q after one wheel notch: tighter on scroll up, wider on scroll down. */
export const qFromWheel = (q, deltaY) => Math.round(clamp(q * Math.exp(-deltaY * 0.0016), 0.05, 30) * 100) / 100;

/** Half width of a band's reach, in octaves, for the shading behind the selected node. */
export const qReach = (q) => Math.max(0.08, 1 / Math.max(q, 0.1));
export const reachSpan = (freq, q) => {
  const half = qReach(q);
  return [freq / Math.pow(2, half), freq * Math.pow(2, half)];
};

/** An analyser byte is already a dB scale, so it only needs mapping into the panel. */
export const spectrumY = (byte, height) => height - (byte / 255) * height * 0.92;

/** The analyser bins as x,y pairs inside F_MIN..F_MAX, ready for lineTo. */
export function spectrumPoints(bins, sampleRate, width, height) {
  const out = [];
  const nyquist = sampleRate / 2;
  for (let i = 1; i < bins.length; i++) {
    const f = (i / bins.length) * nyquist;
    if (f < F_MIN) continue;
    if (f > F_MAX) break;
    out.push([freqToX(f, width), spectrumY(bins[i], height)]);
  }
  return out;
}

/** A response in dB to y, clamped so a wild band cannot draw off the panel. */
export const curveY = (db, height, range) => gainToY(clamp(db, -range * 1.4, range * 1.4), height, range);

/** Spacing of the dB gridlines. */
export const gridSteps = (range) => (range >= 24 ? 12 : 6);

export function fmtHz(f) {
  if (f >= 10000) return `${(f / 1000).toFixed(1)}k`;
  if (f >= 1000) return `${(f / 1000).toFixed(2)}k`;
  return `${Math.round(f)}`;
}

/** Magnitude in dB of a set of bands at the given frequencies (a Float32Array). The filters
 *  made here are never connected, so a curve can be drawn without disturbing playback.
 *  `ctx` is any audio context; with none, or with bypass, the curve is flat. */
export function responseOf(ctx, bands, frequencies, bypass = false) {
  const out = new Float32Array(frequencies.length);
  if (!ctx || bypass) return out;
  const total = new Float32Array(frequencies.length).fill(1);
  const mag = new Float32Array(frequencies.length);
  const phase = new Float32Array(frequencies.length);
  const nyquist = ctx.sampleRate / 2;
  for (const band of bands || []) {
    if (!band.on) continue;
    const filter = ctx.createBiquadFilter();
    filter.type = band.type;
    filter.frequency.value = clamp(band.freq, 10, nyquist - 100);
    filter.Q.value = clamp(band.q, 0.05, 30);
    filter.gain.value = clamp(band.gain, -30, 30);
    filter.getFrequencyResponse(frequencies, mag, phase);
    for (let i = 0; i < total.length; i++) total[i] *= mag[i];
  }
  for (let i = 0; i < total.length; i++) out[i] = 20 * Math.log10(total[i] || 1e-6);
  return out;
}

// ── limiter ─────────────────────────────────────────────────────────────────

export const DB_MIN = -36, DB_MAX = 0;
/** How many frames of gain reduction the trace holds. */
export const HISTORY = 240;
/** The gain reduction trace's full scale, in dB. */
export const REDUCTION_MAX_DB = 12;

/** What a new preset's limiter holds. Matches the server's default. */
export const DEFAULT_LIMITER = { on: false, threshold: -6, ceiling: -0.3, release: 120, attack: 5 };

/** The two numbers that are not drawn as lines: [key, label, min, max, step, unit]. */
export const LIMITER_KNOBS = [
  ["attack", "Attack", 0, 100, 1, "ms"],
  ["release", "Release", 1, 1000, 1, "ms"],
];

/** The preset's output trim, in dB. */
export const GAIN_TRIM = { min: -12, max: 12, step: 0.1 };

export const dbToX = (db, width) => ((clamp(db, DB_MIN, DB_MAX) - DB_MIN) / (DB_MAX - DB_MIN)) * width;
export const xToDb = (x, width) => DB_MIN + (clamp(x, 0, width) / width) * (DB_MAX - DB_MIN);

/** Threshold and ceiling with the defaults filled in where the preset has none. */
export const limiterValues = (limiter) => ({
  threshold: limiter?.threshold === undefined ? DEFAULT_LIMITER.threshold : limiter.threshold,
  ceiling: limiter?.ceiling === undefined ? DEFAULT_LIMITER.ceiling : limiter.ceiling,
});

/** Which of the two lines a press at x landed on, within `radius` pixels, or null. */
export function limiterLineAt(limiter, x, width, radius = 16) {
  const v = limiterValues(limiter);
  let best = null, bestDist = radius;
  for (const name of ["threshold", "ceiling"]) {
    const distance = Math.abs(dbToX(v[name], width) - x);
    if (distance < bestDist) { best = name; bestDist = distance; }
  }
  return best;
}

/** Write a dragged line's value, rounded to a tenth and held inside the engine's ranges
 *  (threshold -60..0, ceiling -30..0). */
export function setLimiterLine(limiter, which, db) {
  const value = tenth(db);
  if (which === "threshold") limiter.threshold = clamp(value, -60, 0);
  else limiter.ceiling = clamp(value, -30, 0);
}

/** A scrolling record of how hard the limiter has been working. Push one value a frame;
 *  read oldest to newest with at(i). */
export class ReductionHistory {
  constructor() { this.values = new Float32Array(HISTORY); this.head = 0; }
  push(db) { this.values[this.head] = db; this.head = (this.head + 1) % HISTORY; }
  /** i = 0 is the oldest of HISTORY frames. */
  at(i) { return this.values[(this.head + i) % HISTORY]; }
  get length() { return HISTORY; }
}
