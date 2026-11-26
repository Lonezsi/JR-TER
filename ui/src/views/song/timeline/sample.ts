/* Drawing a render's picture into a canvas, from whichever numbers there are.
 *
 * Two sources, one picture. The server's `shape` (120 numbers per take) is there the moment
 * the page opens; the decoded render's peaks (1400 columns) arrive once something has read
 * the whole file. Both are asked the same question, "how loud is this stretch", so the
 * timeline draws the coarse picture first and sharpens it in place rather than swapping one
 * drawing for another.
 */
import { clamp } from "$lib/util";

export interface Source {
  peaks: Float32Array | null;
  shape: number[] | null;
}

/** A stretch of the picture: where it goes on the canvas (CSS px) and which slice of the
 *  render it shows (fractions of the whole file). */
export interface Run { x: number; w: number; from: number; to: number }

export const hasPicture = (s: Source) => !!((s.peaks && s.peaks.length) || (s.shape && s.shape.length));

/** 0..1 loudness of a slice of the render. */
function make(source: Source) {
  const { peaks, shape } = source;
  if (peaks && peaks.length) {
    const n = peaks.length;
    return (a: number, b: number) => {
      const i0 = clamp(Math.floor(a * n), 0, n - 1);
      const i1 = clamp(Math.ceil(b * n) - 1, i0, n - 1);
      let top = 0;
      for (let i = i0; i <= i1; i++) if (peaks[i] > top) top = peaks[i];
      return top;
    };
  }
  if (shape && shape.length) {
    // The numbers are not on a fixed scale between servers, so the loudest column is full height.
    let top = 1;
    for (const v of shape) if (v > top) top = v;
    const n = shape.length;
    return (a: number, b: number) => {
      const at = clamp(((a + b) / 2) * (n - 1), 0, n - 1);
      const i = Math.floor(at);
      const j = Math.min(n - 1, i + 1);
      const mix = at - i;
      return ((shape[i] * (1 - mix) + shape[j] * mix) / top);
    };
  }
  return () => 0.04;
}

/** Size a canvas to its CSS box at devicePixelRatio and clear it. */
export function prepare(canvas: HTMLCanvasElement): { ctx: CanvasRenderingContext2D; w: number; h: number } | null {
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const ratio = window.devicePixelRatio || 1;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (!w || !h) return null;
  if (canvas.width !== Math.round(w * ratio) || canvas.height !== Math.round(h * ratio)) {
    canvas.width = Math.round(w * ratio);
    canvas.height = Math.round(h * ratio);
  }
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, w, h);
  return { ctx, w, h };
}

/** A made-up loudness for the skeleton: song-like (quiet start, a body, a tail), the same
 *  every time for the same stretch, so it never jitters while it waits. */
function skeleton(a: number, b: number) {
  const t = (a + b) / 2;
  const body = Math.min(1, t * 6) * Math.min(1, (1 - t) * 5);
  const ripple = 0.55 + 0.25 * Math.sin(t * 61) + 0.2 * Math.sin(t * 173 + 1.3);
  return 0.12 + 0.5 * body * ripple;
}

/** Paint runs of the picture, mirrored about the middle. A floor of one pixel so silence
 *  reads as a line and not as a drawing that failed. With no numbers yet it paints the
 *  skeleton instead, fainter, and says so (true). */
export function paint(canvas: HTMLCanvasElement, source: Source, runs: Run[], color: string, scale = 0.9): boolean {
  const target = prepare(canvas);
  if (!target) return false;
  const { ctx, w, h } = target;
  const waiting = !hasPicture(source);
  const amp = waiting ? skeleton : make(source);
  if (waiting) ctx.globalAlpha = 0.35;
  const middle = h / 2;
  ctx.fillStyle = color;
  for (const run of runs) {
    const x0 = clamp(run.x, 0, w), x1 = clamp(run.x + run.w, 0, w);
    const columns = Math.floor(x1 - x0);
    if (columns < 1) continue;
    const span = run.to - run.from;
    for (let i = 0; i < columns; i++) {
      const a = run.from + (i / columns) * span;
      const b = run.from + ((i + 1) / columns) * span;
      const tall = Math.max(1, amp(Math.min(a, b), Math.max(a, b)) * middle * scale);
      ctx.fillRect(x0 + i, middle - tall, 1, tall * 2);
    }
  }
  ctx.globalAlpha = 1;
  return waiting;
}
