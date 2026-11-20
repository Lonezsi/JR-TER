/* The vocal edit's heavy maths, off the page's thread. Loaded by vocals.svelte.ts as a
 * module worker; nothing here may touch the DOM or import app code.
 *
 * Ops (arguments and results are arrays of per-channel Float32Arrays, transferred):
 *   rms(chs, sr, rate)               level in dB, `rate` points a second, channels mixed
 *   mix(bands, curves, hop, start)   bands back into one signal, each turned down by its curve
 *   autotune(chs, sr, params)        pitch correction
 */
type Chs = Float32Array[];
interface AutotuneParams { key?: number; scale?: string; speed?: number; amount?: number }

const ops = {
  /* Level in dB, RATE points a second, of the channels mixed down. */
  rms(chs: Chs, sr: number, rate: number): Chs {
    const n = chs[0].length;
    const hop = sr / rate;
    const out = new Float32Array(Math.ceil(n / hop));
    for (let j = 0; j < out.length; j++) {
      const a = Math.floor(j * hop);
      const b = Math.min(n, Math.floor((j + 1) * hop));
      let sum = 0;
      for (let c = 0; c < chs.length; c++) {
        const d = chs[c];
        for (let i = a; i < b; i++) sum += d[i] * d[i];
      }
      out[j] = 10 * Math.log10(sum / Math.max(1, (b - a) * chs.length) + 1e-12);
    }
    return [out];
  },

  /* Three bands back into one signal, each band turned down by its curve. `start` is
   * where in the curves this signal's first sample falls. */
  mix(bands: Chs[], curves: (Float32Array | null)[], hop: number, start: number): Chs {
    const n = bands[0][0].length;
    const out = bands[0].map(() => new Float32Array(n));
    for (let b = 0; b < bands.length; b++) {
      const curve = curves[b];
      for (let c = 0; c < out.length; c++) {
        const src = bands[b][c];
        const dst = out[c];
        for (let i = 0; i < n; i++) {
          let g = 1;
          if (curve) {
            const at = start + i / hop;
            const k = Math.floor(at);
            if (k >= 0 && k + 1 < curve.length) g = curve[k] + (curve[k + 1] - curve[k]) * (at - k);
            else if (k >= 0 && k < curve.length) g = curve[k];
          }
          dst[i] += src[i] * g;
        }
      }
    }
    return out;
  },

  /* Pitch correction.
   *
   * Find the pitch every 10 ms (YIN, on a copy brought down to about 8 kHz, which is
   * plenty for a voice and a sixth of the work), decide how far each moment is from the
   * nearest note the scale allows, ease towards that at the retune speed, and move the
   * pitch by that much without moving the timing: grains a period or two long, taken at
   * the voice's own pitch marks and laid down closer together or further apart (PSOLA).
   * Where there is no pitch, a breath or an "s", nothing moves. */
  autotune(chs: Chs, sr: number, p: AutotuneParams): Chs {
    const n = chs[0].length;
    const mono = new Float32Array(n);
    for (const d of chs) for (let i = 0; i < n; i++) mono[i] += d[i] / chs.length;

    const D = Math.max(1, Math.round(sr / 8000));
    const dsr = sr / D;
    const m = Math.floor(n / D);
    const x = new Float32Array(m);
    for (let i = 0; i < m; i++) {
      let s = 0;
      for (let k = 0; k < D; k++) s += mono[i * D + k];
      x[i] = s / D;
    }
    const hop = Math.max(1, Math.round(dsr * 0.01));
    const maxLag = Math.ceil(dsr / 70);
    const minLag = Math.max(2, Math.floor(dsr / 1000));
    const win = maxLag * 2;
    const frames = Math.max(1, Math.ceil(m / hop));
    const raw = new Float32Array(frames);
    const d = new Float32Array(maxLag + 2);
    for (let f = 0; f < frames; f++) {
      const s0 = f * hop - (win >> 1);
      if (s0 < 0 || s0 + win + maxLag >= m) continue;
      let energy = 0;
      for (let i = 0; i < win; i++) energy += x[s0 + i] * x[s0 + i];
      if (energy / win < 1e-5) continue;                  // quieter than -50 dB
      let run = 0;
      d[0] = 1;
      for (let tau = 1; tau <= maxLag; tau++) {
        let sum = 0;
        for (let i = 0; i < win; i++) { const v = x[s0 + i] - x[s0 + i + tau]; sum += v * v; }
        run += sum;
        d[tau] = run > 0 ? (sum * tau) / run : 1;
      }
      let tau = -1;
      for (let t = minLag; t < maxLag; t++) {
        if (d[t] < 0.2) {
          while (t + 1 < maxLag && d[t + 1] < d[t]) t++;
          tau = t;
          break;
        }
      }
      if (tau < 1) continue;
      const a = d[tau - 1], b = d[tau], c = d[tau + 1];
      const den = a - 2 * b + c;
      const shift = den ? Math.max(-1, Math.min(1, (0.5 * (a - c)) / den)) : 0;
      raw[f] = dsr / (tau + shift);
    }
    // A median of three, so one frame an octave out does not become a jump.
    const f0 = new Float32Array(frames);
    for (let f = 0; f < frames; f++) {
      if (!raw[f]) continue;
      const near = [raw[f - 1], raw[f], raw[f + 1]].filter((v) => v > 0).sort((u, v) => u - v);
      f0[f] = near[near.length >> 1];
    }

    const SCALES: Record<string, number[]> = {
      chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
      major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10],
    };
    const scale = SCALES[p.scale || "chromatic"] || SCALES.chromatic;
    const key = (((p.key || 0) | 0) % 12 + 12) % 12;
    const amount = Math.max(0, Math.min(1, (p.amount == null ? 100 : p.amount) / 100));
    const speed = p.speed || 0;
    const alpha = !(speed > 0) ? 1 : 1 - Math.exp(-(hop / dsr) * 1000 / speed);
    const semis = new Float32Array(frames);
    let cur = 0;
    let was = false;
    for (let f = 0; f < frames; f++) {
      if (!f0[f]) { was = false; continue; }
      const midi = 69 + 12 * Math.log2(f0[f] / 440);
      let best = Math.round(midi);
      let gap = Infinity;
      for (let k = Math.floor(midi) - 2; k <= Math.ceil(midi) + 2; k++) {
        if (scale.indexOf(((k - key) % 12 + 12) % 12) === -1) continue;
        if (Math.abs(k - midi) < gap) { gap = Math.abs(k - midi); best = k; }
      }
      const want = (best - midi) * amount;
      cur = was ? cur + alpha * (want - cur) : want;      // a new note starts in tune
      semis[f] = cur;
      was = true;
    }

    const frameOf = (i: number) => Math.min(frames - 1, Math.max(0, Math.round(i / (hop * D))));
    const periodAt = (f: number) => (f0[f] ? sr / f0[f] : sr * 0.005);
    const marks: number[] = [];
    for (let t = 0; t < n;) {
      marks.push(t);
      const f = frameOf(t);
      const T = periodAt(f);
      let next = t + T;
      if (f0[f]) {
        // On to the next peak of the wave, so every grain starts at the same point in it.
        let at = Math.round(next);
        let top = -Infinity;
        for (let i = Math.max(t + 1, Math.floor(next - T * 0.2)); i <= Math.min(n - 1, Math.ceil(next + T * 0.2)); i++) {
          if (mono[i] > top) { top = mono[i]; at = i; }
        }
        next = at;
      }
      t = Math.max(t + 1, Math.round(next));
    }

    const out = chs.map(() => new Float32Array(n));
    const weight = new Float32Array(n);
    let k = 0;
    for (let ts = 0; ts < n;) {
      while (k + 1 < marks.length && Math.abs(marks[k + 1] - ts) <= Math.abs(marks[k] - ts)) k++;
      const ta = marks[k];
      const f = frameOf(ta);
      const T = periodAt(f);
      const r = f0[f] ? Math.max(0.5, Math.min(2, Math.pow(2, semis[f] / 12))) : 1;
      const L = Math.max(2, Math.round(T));
      const at = Math.round(ts);
      for (let j = -L; j <= L; j++) {
        const src = ta + j;
        const dst = at + j;
        if (src < 0 || src >= n || dst < 0 || dst >= n) continue;
        const h = 0.5 + 0.5 * Math.cos((Math.PI * j) / L);
        for (let c = 0; c < chs.length; c++) out[c][dst] += chs[c][src] * h;
        weight[dst] += h;
      }
      ts += T / r;
    }
    for (let i = 0; i < n; i++) {
      const w = weight[i];
      for (let c = 0; c < out.length; c++) out[c][i] = w > 1e-3 ? out[c][i] / w : 0;
    }
    return out;
  },
};

type Op = keyof typeof ops;

const buffersIn = (value: unknown, list: ArrayBuffer[]): ArrayBuffer[] => {
  if (value instanceof Float32Array) list.push(value.buffer as ArrayBuffer);
  else if (Array.isArray(value)) value.forEach((v) => buffersIn(v, list));
  return list;
};

const scope = self as unknown as {
  onmessage: ((e: MessageEvent<{ id: number; op: Op; args: unknown[] }>) => void) | null;
  postMessage(message: unknown, transfer: ArrayBuffer[]): void;
};

scope.onmessage = (e) => {
  const { id, op, args } = e.data;
  try {
    const out = (ops[op] as (...a: unknown[]) => unknown)(...args);
    scope.postMessage({ id, out }, buffersIn(out, []));
  } catch (err) {
    scope.postMessage({ id, error: String((err as Error)?.message || err) }, []);
  }
};
