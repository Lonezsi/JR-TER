/* The maths behind the equaliser and limiter displays: no DOM, no drawing.
 *
 * PUBLIC API
 *  Equaliser
 *   F_MIN F_MAX GRID_F LABEL_F RANGES DEFAULT_RANGE TYPE_LABEL BAND_TYPES GAINLESS
 *   isGainless(type)            low/high cut, notch, band: the node sits on the 0 dB line
 *   freqToX(f,width) xToFreq(x,width)       log frequency axis
 *   gainToY(g,height,range) yToGain(y,height,range)    centre line is 0 dB, 12px padding
 *   bandAt(bands, x, y, size, range, radius?)          hit test, nearest within 14px
 *   newId()                     collision-free band ids
 *   newBand(type?)             defaults for a band added from a button
 *   bandAtPoint(x,y,size,range) a bell placed where the pointer went down
 *   addBand(bands, band)        push + sort by frequency (returns the same array)
 *   dragBand(band, x, y, size, range)       move a band the way a drag does
 *   qFromWheel(q, deltaY)       Q after one wheel notch
 *   qReach(q), reachSpan(freq,q) half width in octaves / [low, high] Hz of the Q shading
 *   spectrumY(byte,height)      analyser byte (0..255) to y
 *   spectrumPoints(bins,sampleRate,width,height)  x,y pairs for the analyser fill
 *   curveY(db, height, range)   a response value to y, clamped to 1.4 x range
 *   gridSteps(range)            dB gridline step for a range
 *   fmtHz(f)
 *  Limiter
 *   DB_MIN DB_MAX DEFAULT_LIMITER LIMITER_KNOBS GAIN_TRIM REDUCTION_MAX_DB HISTORY
 *   dbToX(db,width) xToDb(x,width)
 *   limiterLineAt(limiter, x, width, radius?)   "threshold" | "ceiling" | null
 *   setLimiterLine(limiter, which, db)          clamped write
 *   limiterValues(limiter)      threshold/ceiling with the defaults filled in
 *   ReductionHistory            ring buffer for the scrolling gain reduction trace
 *
 * Sizes are CSS pixels (the canvas draws at devicePixelRatio and scales its context).
 */
import { clamp } from "../util";
import type { Band, LimiterSettings } from "../types";

// ── equaliser ───────────────────────────────────────────────────────────────

export const F_MIN = 20, F_MAX = 22000;
const DECADES = Math.log10(F_MAX / F_MIN);
export const GRID_F = [30, 50, 100, 200, 300, 500, 1000, 2000, 3000, 5000, 10000, 20000];
export const LABEL_F: Record<number, string> = { 100: "100", 1000: "1k", 10000: "10k" };

/** dB shown above and below the centre line, as the range pills offer them. */
export const RANGES = [12, 18, 24, 30];
export const DEFAULT_RANGE = 18;

export const TYPE_LABEL: Record<BiquadFilterType, string> = {
  peaking: "Bell", lowshelf: "Low shelf", highshelf: "High shelf",
  // A high pass filter removes the lows, so it is the Low cut. The old interface had the
  // pair swapped, so its Low cut button made a band named High cut.
  lowpass: "High cut", highpass: "Low cut", notch: "Notch", bandpass: "Band",
  allpass: "All pass",
};
/** The types a band can be, in menu order. */
export const BAND_TYPES: BiquadFilterType[] =
  ["peaking", "lowshelf", "highshelf", "lowpass", "highpass", "notch", "bandpass"];

/** These have no gain, so their node sits on the centre line and dragging moves only
 *  frequency. */
export const GAINLESS = new Set<BiquadFilterType>(["lowpass", "highpass", "notch", "bandpass"]);
export const isGainless = (type: BiquadFilterType) => GAINLESS.has(type);

// The gain axis keeps this much of the height clear at top and bottom.
const PAD = 12;

export const freqToX = (f: number, width: number) =>
  (Math.log10(clamp(f, F_MIN, F_MAX) / F_MIN) / DECADES) * width;
export const xToFreq = (x: number, width: number) =>
  F_MIN * Math.pow(10, (clamp(x, 0, width) / width) * DECADES);
export const gainToY = (g: number, height: number, range: number) =>
  height / 2 - (g / range) * (height / 2 - PAD);
export const yToGain = (y: number, height: number, range: number) =>
  ((height / 2 - y) / (height / 2 - PAD)) * range;

export interface Size { width: number; height: number }

/** The band whose node is nearest the point, within `radius` pixels. */
export function bandAt(bands: Band[], x: number, y: number, size: Size, range: number, radius = 14): Band | null {
  let best: Band | null = null, bestDist = radius;
  for (const band of bands) {
    const dx = freqToX(band.freq, size.width) - x;
    const dy = gainToY(isGainless(band.type) ? 0 : band.gain, size.height, range) - y;
    const dist = Math.hypot(dx, dy);
    if (dist < bestDist) { best = band; bestDist = dist; }
  }
  return best;
}

let counter = 1;
/** An id no other band has, within this tab or across sessions. */
export const newId = () => `b${Date.now().toString(36)}${counter++}`;

const tenth = (n: number) => Math.round(n * 10) / 10;

/** A band as the Add buttons make it: a sensible starting frequency for its type. */
export function newBand(type: BiquadFilterType = "peaking"): Band {
  return {
    id: newId(), type,
    freq: type === "highpass" ? 80 : type === "lowpass" ? 12000 : 1000,
    gain: 0, q: type === "peaking" ? 1.2 : 0.7, on: true,
  };
}

/** A bell placed where the pointer went down, so one gesture places it exactly where it
 *  was asked for and the same motion can drag it. */
export function bandAtPoint(x: number, y: number, size: Size, range: number): Band {
  return {
    id: newId(), type: "peaking",
    freq: tenth(clamp(xToFreq(x, size.width), F_MIN, F_MAX)),
    gain: tenth(clamp(yToGain(y, size.height, range), -range, range)),
    q: 1.2, on: true,
  };
}

/** Add and keep the list in frequency order. */
export function addBand(bands: Band[], band: Band): Band[] {
  bands.push(band);
  bands.sort((a, b) => a.freq - b.freq);
  return bands;
}

/** Move a band to where a drag has got to. Gainless types keep their gain. */
export function dragBand(band: Band, x: number, y: number, size: Size, range: number) {
  band.freq = tenth(clamp(xToFreq(x, size.width), F_MIN, F_MAX));
  if (!isGainless(band.type)) band.gain = tenth(clamp(yToGain(y, size.height, range), -range, range));
}

/** Q after one wheel notch: tighter on scroll up, wider on scroll down. */
export const qFromWheel = (q: number, deltaY: number) =>
  Math.round(clamp(q * Math.exp(-deltaY * 0.0016), 0.05, 30) * 100) / 100;

/** Half width of a band's reach, in octaves, for the shading behind the selected node. */
export const qReach = (q: number) => Math.max(0.08, 1 / Math.max(q, 0.1));
export const reachSpan = (freq: number, q: number): [number, number] => {
  const half = qReach(q);
  return [freq / Math.pow(2, half), freq * Math.pow(2, half)];
};

/** An analyser byte is already a dB scale between the analyser's min and max, so it only
 *  needs mapping into the panel rather than a second log. */
export const spectrumY = (byte: number, height: number) => height - (byte / 255) * height * 0.92;

/** The analyser bins as x,y pairs inside F_MIN..F_MAX, ready for lineTo. */
export function spectrumPoints(bins: Uint8Array, sampleRate: number, width: number, height: number): [number, number][] {
  const out: [number, number][] = [];
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
export const curveY = (db: number, height: number, range: number) =>
  gainToY(clamp(db, -range * 1.4, range * 1.4), height, range);

/** Spacing of the dB gridlines. */
export const gridSteps = (range: number) => (range >= 24 ? 12 : 6);

export function fmtHz(f: number): string {
  if (f >= 10000) return `${(f / 1000).toFixed(1)}k`;
  if (f >= 1000) return `${(f / 1000).toFixed(2)}k`;
  return `${Math.round(f)}`;
}

// ── limiter ─────────────────────────────────────────────────────────────────

export const DB_MIN = -36, DB_MAX = 0;
/** How many frames of gain reduction the trace holds. */
export const HISTORY = 240;
/** The gain reduction trace's full scale, in dB. */
export const REDUCTION_MAX_DB = 12;

/** What a new preset's limiter holds. Matches the server's default. */
export const DEFAULT_LIMITER: Required<LimiterSettings> =
  { on: false, threshold: -6, ceiling: -0.3, release: 120, attack: 5 };

/** The two numbers that are not drawn as lines: [key, label, min, max, step, unit]. */
export const LIMITER_KNOBS = [
  ["attack", "Attack", 0, 100, 1, "ms"],
  ["release", "Release", 1, 1000, 1, "ms"],
] as const;

/** The preset's output trim, in dB. */
export const GAIN_TRIM = { min: -12, max: 12, step: 0.1 };

export const dbToX = (db: number, width: number) =>
  ((clamp(db, DB_MIN, DB_MAX) - DB_MIN) / (DB_MAX - DB_MIN)) * width;
export const xToDb = (x: number, width: number) =>
  DB_MIN + (clamp(x, 0, width) / width) * (DB_MAX - DB_MIN);

/** Threshold and ceiling with the defaults filled in where the preset has none. */
export const limiterValues = (limiter: LimiterSettings | null | undefined) => ({
  threshold: limiter?.threshold === undefined ? DEFAULT_LIMITER.threshold : limiter.threshold,
  ceiling: limiter?.ceiling === undefined ? DEFAULT_LIMITER.ceiling : limiter.ceiling,
});

/** Which of the two lines a press at x landed on, within `radius` pixels. Only a press
 *  that lands on one is a drag. */
export function limiterLineAt(limiter: LimiterSettings | null | undefined, x: number, width: number, radius = 16): "threshold" | "ceiling" | null {
  const v = limiterValues(limiter);
  let best: "threshold" | "ceiling" | null = null, bestDist = radius;
  for (const name of ["threshold", "ceiling"] as const) {
    const distance = Math.abs(dbToX(v[name], width) - x);
    if (distance < bestDist) { best = name; bestDist = distance; }
  }
  return best;
}

/** Write a dragged line's value, rounded to a tenth and held inside the ranges the
 *  engine accepts (threshold -60..0, ceiling -30..0). */
export function setLimiterLine(limiter: LimiterSettings, which: "threshold" | "ceiling", db: number) {
  const value = tenth(db);
  if (which === "threshold") limiter.threshold = clamp(value, -60, 0);
  else limiter.ceiling = clamp(value, -30, 0);
}

/** A scrolling record of how hard the limiter has been working. Push one value a frame;
 *  read oldest to newest with at(i). */
export class ReductionHistory {
  private values = new Float32Array(HISTORY);
  private head = 0;
  push(db: number) { this.values[this.head] = db; this.head = (this.head + 1) % HISTORY; }
  /** i = 0 is the oldest of HISTORY frames. */
  at(i: number) { return this.values[(this.head + i) % HISTORY]; }
  get length() { return HISTORY; }
}
