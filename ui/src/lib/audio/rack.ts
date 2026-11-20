/* The rack: the effects a preset runs, in order.
 *
 *   deck ─ unit ─ unit ─ … ─ out
 *
 * A unit is { id, kind, on, ...its numbers }. Everything is a unit, the equaliser and the
 * limiter included. The equaliser's bands stay where they always were (data.bands). A
 * preset from before the rack, which has no `rack`, or from the first rack, which kept the
 * limiter outside it, reads as what it was: its equaliser, then its limiter (from
 * data.limiter), then its output gain if it had one (rackOf). The engine's own fixed
 * limiter stage is left neutral from then on.
 *
 * Each kind knows its own numbers (UNITS, which the panel draws knobs from) and how to build
 * itself in any audio context, live or offline: the bouncer builds the same rack, so a file
 * written from a preset is what was heard through it. A built unit can take new numbers
 * without being rebuilt, so a knob being dragged never stops the sound; only adding,
 * removing, reordering or switching units rewires the chain.
 *
 * PUBLIC API
 *   UNITS                    the kinds, their names and their knobs
 *   ADDABLE                  the kinds + Add effect offers, in menu order
 *   rackOf(data)             the preset's rack, an old preset's read as [eq]
 *   newUnit(kind)            a unit with its defaults
 *   summary(unit, data)      one line for the folded row
 *   shapeOf(data)            what, if it changed, means rewiring
 *   buildUnit(ctx, unit, data)  -> { input, output, set(unit, data), nodes }
 */
import { clamp } from "../util";
import type { Band, RackUnit, SoundData, UnitKind } from "../types";

export interface Knob { key: string; label: string; min: number; max: number; step: number; unit: string; value: number }

export const UNITS: Record<UnitKind, { name: string; blurb: string; knobs: Knob[] }> = {
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
export const ADDABLE: UnitKind[] = ["eq", "comp", "drive", "delay", "reverb", "width", "gain", "limiter"];
export const MAX_UNITS = 16;

let counter = 0;
const newUnitId = () => `u${Date.now().toString(36)}${counter++}`;

export function newUnit(kind: UnitKind): RackUnit {
  const unit: RackUnit = { id: kind === "eq" ? "eq" : newUnitId(), kind, on: true };
  for (const k of UNITS[kind].knobs) unit[k.key] = k.value;
  return unit;
}

/** The rack. A preset written before the limiter became an effect gets its limiter (and
 *  its output gain, if it had any) appended from the old fields, as it sounded. */
export function rackOf(data: SoundData | null | undefined): RackUnit[] {
  const base: RackUnit[] = data?.rack ? data.rack : [{ id: "eq", kind: "eq", on: true }];
  if (!data || (data.rack_v ?? 0) >= 2) return base;
  const lim = data.limiter || { on: false };
  const out = [...base, {
    id: "limiter", kind: "limiter" as const, on: !!lim.on,
    threshold: lim.threshold ?? -6, ceiling: lim.ceiling ?? -0.3, attack: lim.attack ?? 5, release: lim.release ?? 120,
  }];
  if (data.gain) out.push({ id: "gain", kind: "gain", on: true, db: data.gain });
  return out;
}

export const valueOf = (unit: RackUnit, key: string): number => {
  const v = unit[key];
  if (typeof v === "number" && Number.isFinite(v)) return v;
  return UNITS[unit.kind]?.knobs.find((k) => k.key === key)?.value ?? 0;
};

const fmt = (n: number, unit: string) =>
  `${Math.abs(n) >= 100 || Number.isInteger(n) ? Math.round(n) : n.toFixed(1)}${unit === ":1" ? ":1" : unit === "%" ? "%" : " " + unit}`;

export function summary(unit: RackUnit, data: SoundData): string {
  const v = (k: string) => valueOf(unit, k);
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

/** What has to be rewired for: which units, in what order, which are on, and the
 *  equaliser's own band list. Anything else is numbers, set on the running nodes. */
export function shapeOf(data: SoundData): string {
  const units = data.bypass ? [] : rackOf(data).filter((u) => u.on);
  return JSON.stringify([units.map((u) => [u.id, u.kind]),
    (data.bands || []).map((b: Band) => [b.id, b.type, b.on])]);
}

// ── building ────────────────────────────────────────────────────────────────

export interface BuiltUnit {
  input: AudioNode;
  output: AudioNode;
  /** Every node made, to disconnect when the chain is rebuilt. */
  nodes: AudioNode[];
  set(unit: RackUnit, data: SoundData): void;
  /** How hard it is pulling down right now, in dB (compressors and limiters). */
  reduction?: () => number;
}

const dbToGain = (db: number) => Math.pow(10, db / 20);

/** A wet/dry pair around some processing: input splits, the two come back together. */
function blend(ctx: BaseAudioContext) {
  const input = ctx.createGain(), output = ctx.createGain(), dry = ctx.createGain(), wet = ctx.createGain();
  input.connect(dry); dry.connect(output); wet.connect(output);
  return {
    input, output, dry, wet, nodes: [input, output, dry, wet] as AudioNode[],
    mix(pct: number) { const m = clamp(pct, 0, 100) / 100; dry.gain.value = Math.cos(m * Math.PI / 2); wet.gain.value = Math.sin(m * Math.PI / 2); },
  };
}

/* The same tail every time for the same decay: a fixed seed, so an offline bounce and the
 * live deck convolve with an identical impulse. */
function impulse(ctx: BaseAudioContext, seconds: number): AudioBuffer {
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

function driveCurve(amount: number): Float32Array<ArrayBuffer> {
  const k = 1 + clamp(amount, 0, 100) * 0.4;
  const n = 2048, curve = new Float32Array(n);
  const norm = Math.tanh(k);
  for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; curve[i] = Math.tanh(k * x) / norm; }
  return curve;
}

export function buildUnit(ctx: BaseAudioContext, unit: RackUnit, data: SoundData): BuiltUnit {
  switch (unit.kind) {
    case "eq": {
      const input = ctx.createGain();
      const filters: (BiquadFilterNode & { _id?: Band["id"] })[] = [];
      for (const band of data.bands || []) {
        if (!band.on) continue;
        const f: BiquadFilterNode & { _id?: Band["id"] } = ctx.createBiquadFilter();
        f.type = band.type; f._id = band.id;
        filters.push(f);
      }
      let node: AudioNode = input;
      for (const f of filters) { node.connect(f); node = f; }
      const set = (_u: RackUnit, d: SoundData) => {
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
      const set = (u: RackUnit) => {
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
      // Hard knee, steep ratio; the makeup brings what it holds at the threshold back up
      // to the ceiling, so the ceiling line is where the loudest part ends up.
      const comp = ctx.createDynamicsCompressor(), makeup = ctx.createGain();
      comp.connect(makeup);
      const set = (u: RackUnit) => {
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
      const set = (u: RackUnit) => {
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
      const set = (u: RackUnit) => {
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
      const set = (u: RackUnit) => {
        const s = Math.round(valueOf(u, "size") * 10) / 10;
        if (s !== size) { conv.buffer = impulse(ctx, s); size = s; }
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
      const set = (u: RackUnit) => {
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
      const set = (u: RackUnit) => { g.gain.value = dbToGain(clamp(valueOf(u, "db"), -48, 24)); };
      set(unit);
      return { input: g, output: g, nodes: [g], set };
    }
  }
}
