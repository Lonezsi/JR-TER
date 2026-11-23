// stretch.js: change how long a sound lasts without changing its pitch (WSOLA).
// Pure maths on Float32Arrays (tests/daw), plus stretchBuffer for Web Audio.
//
// ratio is how much faster it plays: 2 = twice as fast, half as long. The sound is cut into short
// overlapping windows; each is taken from near where it "should" be and nudged a little so its
// wave lines up with what is already written, then the windows are faded and added together.
// The nudges are found once on a mono mix, so both channels of a stereo sound move together.
// shortcut: runs on the main thread, not in a worker; a long sound pauses the page for a moment.

const FRAME = 2048, HOP = 512, SEEK = 256, STEP = 4;
const WIN = new Float32Array(FRAME);
for (let i = 0; i < FRAME; i++) WIN[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / FRAME);

export function stretchLength(n, ratio) { return Math.max(1, Math.round(n / ratio)); }

// Where each window is read from: one input position per output hop.
export function wsolaOffsets(mono, ratio) {
  const frames = Math.max(1, Math.ceil(stretchLength(mono.length, ratio) / HOP));
  const pos = new Int32Array(frames);
  let prev = 0; // where the last window began in the input
  for (let k = 0; k < frames; k++) {
    const ideal = Math.round(k * HOP * ratio);
    if (k === 0) { pos[0] = 0; continue; }
    // the natural continuation of the last window is `prev + HOP`; look for what lines up with it
    const want = prev + HOP;
    let best = ideal, bestScore = -Infinity;
    for (let d = -SEEK; d <= SEEK; d += STEP) {
      const c = ideal + d;
      if (c < 0 || c + FRAME > mono.length) continue;
      let sum = 0;
      for (let i = 0; i < FRAME - HOP; i += STEP) {
        if (want + i >= mono.length) break;
        sum += mono[want + i] * mono[c + i];
      }
      if (sum > bestScore) { bestScore = sum; best = c; }
    }
    pos[k] = Math.max(0, Math.min(best, Math.max(0, mono.length - FRAME)));
    prev = pos[k];
  }
  return pos;
}

export function stretchChannel(data, ratio, offsets) {
  const n = stretchLength(data.length, ratio);
  if (Math.abs(ratio - 1) < 1e-6) return Float32Array.from(data);
  const pos = offsets || wsolaOffsets(data, ratio);
  const out = new Float32Array(n + FRAME), norm = new Float32Array(n + FRAME);
  for (let k = 0; k < pos.length; k++) {
    const o = k * HOP, p = pos[k];
    for (let i = 0; i < FRAME; i++) {
      const v = p + i < data.length ? data[p + i] : 0;
      out[o + i] += v * WIN[i]; norm[o + i] += WIN[i];
    }
  }
  const res = new Float32Array(n);
  for (let i = 0; i < n; i++) res[i] = norm[i] > 1e-4 ? out[i] / norm[i] : 0;
  return res;
}

// A new AudioBuffer ratio times as fast (and 1/ratio as long) with the same pitch.
export function stretchBuffer(ctx, buffer, ratio) {
  const ch = buffer.numberOfChannels, len = buffer.length;
  const mono = new Float32Array(len);
  for (let c = 0; c < ch; c++) { const d = buffer.getChannelData(c); for (let i = 0; i < len; i++) mono[i] += d[i] / ch; }
  const offsets = wsolaOffsets(mono, ratio);
  const out = ctx.createBuffer(ch, stretchLength(len, ratio), buffer.sampleRate);
  for (let c = 0; c < ch; c++) out.copyToChannel(stretchChannel(buffer.getChannelData(c), ratio, offsets), c);
  return out;
}
