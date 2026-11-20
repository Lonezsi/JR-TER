/* Drawing what a render looks like.
 *
 * PUBLIC API
 *   peaksOf(buffer, columns?)        peak per column, 0..1 (default 1400 columns)
 *   remember(versionId, peaks) / known(versionId) / forget(versionId)   the cache
 *   draw(canvas, peaks, { from, to, color, scale })   paint a slice into a canvas
 *   wave                             the same as one object
 *
 * Two uses, one set of numbers: the compositor needs a waveform you can aim at, and
 * lists want a small picture of the same thing. Both come from a peak summary: for each
 * column of pixels, the loudest sample in it. Peaks rather than an average, because an
 * average of a loud passage and a quiet one is a flat grey line that tells you nothing
 * about where the song changes.
 *
 * The summary is cached per version, because computing it means decoding the file and a
 * five minute wav takes long enough that doing it twice is noticeable.
 */
import { clamp } from "../util";

export type Peaks = Float32Array;
export type VersionKey = number | string;

export interface DrawOptions {
  /** Fractions of the whole file, so a clip draws exactly the part of the render it uses. */
  from?: number;
  to?: number;
  /** A canvas fillStyle. Read it from a CSS variable at the call site. */
  color?: string;
  /** How much of the half height the loudest peak fills. Default 0.92. */
  scale?: number;
}

const cache = new Map<VersionKey, Peaks>();
const COLUMNS = 1400;             // enough for a wide screen, cheap enough to keep

/** Peak per column, 0..1. */
export function peaksOf(buffer: AudioBuffer, columns?: number): Peaks {
  const count = columns || COLUMNS;
  const out = new Float32Array(count);
  const channels = Math.min(2, buffer.numberOfChannels);
  const step = buffer.length / count;
  for (let c = 0; c < channels; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < count; i++) {
      const from = Math.floor(i * step);
      const to = Math.min(data.length, Math.floor((i + 1) * step));
      let peak = 0;
      // Every sample of a five minute file is millions of reads; stepping through a
      // column in strides is indistinguishable by eye and far quicker.
      const stride = Math.max(1, Math.floor((to - from) / 400));
      for (let s = from; s < to; s += stride) {
        const value = data[s] < 0 ? -data[s] : data[s];
        if (value > peak) peak = value;
      }
      if (peak > out[i]) out[i] = peak;
    }
  }
  return out;
}

export function remember(versionId: VersionKey, peaks: Peaks) { cache.set(versionId, peaks); }
export function known(versionId: VersionKey | null | undefined): Peaks | null {
  return versionId == null ? null : cache.get(versionId) || null;
}
export function forget(versionId: VersionKey) { cache.delete(versionId); }

/** Draw a slice of the peaks into a canvas, at devicePixelRatio, sized from its CSS box. */
export function draw(canvas: HTMLCanvasElement, peaks: Peaks | null | undefined, options: DrawOptions = {}) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const ratio = window.devicePixelRatio || 1;
  const width = canvas.clientWidth || 1;
  const height = canvas.clientHeight || 1;
  if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
  }
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, width, height);
  if (!peaks || !peaks.length) return;

  const from = clamp(options.from === undefined ? 0 : options.from, 0, 1);
  const to = clamp(options.to === undefined ? 1 : options.to, 0, 1);
  const span = Math.max(1e-6, to - from);
  const middle = height / 2;
  const scale = (options.scale || 0.92) * middle;

  ctx.fillStyle = options.color || "rgba(255,255,255,0.5)";
  const columns = Math.max(1, Math.floor(width));
  for (let x = 0; x < columns; x++) {
    const at = from + (x / columns) * span;
    const index = clamp(Math.floor(at * peaks.length), 0, peaks.length - 1);
    // A floor of one pixel: silence should read as a line, not as a gap that looks
    // like the drawing failed.
    const tall = Math.max(1, peaks[index] * scale);
    ctx.fillRect(x, middle - tall, 1, tall * 2);
  }
}

export const wave = { peaksOf, remember, known, forget, draw };
