// sampler.js: sounds from the library as instruments and clips. Pure functions (tests/daw),
// plus playSlice, the one place that touches Web Audio.
//
// A sampler is a track with instrument "sampler" and track.sample:
//   { name, src, seconds, start, end, root, slices }
//   src      where the audio comes from (/api/versions/ID/audio, /api/vocals/ID/audio, ...)
//   seconds  how long the whole sound is (0 until it has been decoded once)
//   start    where playing begins, in seconds; end = where it stops (0 = the end of the sound)
//   root     the MIDI pitch that plays it as it is (60 = middle C)
//   slices   cut points in seconds, sorted, strictly between start and end
//   bpm      the tempo the sound was played at (20..400), 0 = not set: audio clips then play it as it is
//   warp     "time" (default): audio clips keep the pitch while stretching to the song tempo; "pitch": speed and pitch move together, like tape
//   oneshot  true: every note plays the whole sound (start..end), however short the note; a hit, not a held key
// No slices: any note plays start..end, sped up or slowed down by its distance from root.
// With slices: root plays the first piece, root+1 the second, and so on, at normal speed.
//
// An audio clip is a playlist clip with a track instead of a pattern (see playlist.js):
//   { track, lane, start, length, offset }, in bars. It plays that track's sample, from
//   offset bars past the sample's start, for length bars. With sample.bpm set it plays at the song's
//   tempo (see clipPlay); notes are not affected by the tempo.

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const num = (v, d) => (Number.isFinite(v) ? v : d);

export function sampleEnd(s) { return s.end > 0 ? s.end : s.seconds; }

// How long a note holds the sound, in seconds: 0 means play it to its end (chopped pieces, one-shots).
export function gateFor(s, len) { return s.slices.length || s.oneshot ? 0 : len; }

export function cleanSample(x) {
  if (!x || typeof x !== "object" || typeof x.src !== "string" || !x.src) return null;
  const seconds = Math.max(0, num(x.seconds, 0));
  const start = clamp(num(x.start, 0), 0, seconds || 1e6);
  let end = Math.max(0, num(x.end, 0));
  if (end && end <= start) end = 0;
  const s = {
    name: String(x.name ?? "Sample").slice(0, 80), src: x.src, seconds, start, end,
    root: clamp(Math.round(num(x.root, 60)), 0, 127), slices: [], oneshot: x.oneshot === true,
    bpm: Number.isFinite(x.bpm) && x.bpm >= 20 && x.bpm <= 400 ? Math.round(x.bpm * 100) / 100 : 0,
    warp: x.warp === "pitch" ? "pitch" : "time",
  };
  const hi = sampleEnd(s) || 1e6;
  const cuts = (Array.isArray(x.slices) ? x.slices : []).map(Number).filter((t) => Number.isFinite(t) && t > start && t < hi);
  s.slices = [...new Set(cuts.map((t) => Math.round(t * 1000) / 1000))].sort((a, b) => a - b);
  return s;
}

// n equal pieces of start..end. 1 (or less) clears the cuts.
export function chop(s, n) {
  s.slices = [];
  const end = sampleEnd(s);
  if (n < 2 || end <= s.start) return s;
  for (let i = 1; i < n; i++) s.slices.push(Math.round((s.start + ((end - s.start) * i) / n) * 1000) / 1000);
  return s;
}

export function addSlice(s, t) {
  const end = sampleEnd(s);
  if (!(t > s.start && t < end)) return false;
  t = Math.round(t * 1000) / 1000;
  if (s.slices.includes(t)) return false;
  s.slices.push(t); s.slices.sort((a, b) => a - b);
  return true;
}

// Remove the cut nearest to t, if one is within tol seconds.
export function removeSliceNear(s, t, tol) {
  let best = -1, d = tol;
  s.slices.forEach((c, i) => { if (Math.abs(c - t) <= d) { d = Math.abs(c - t); best = i; } });
  if (best < 0) return false;
  s.slices.splice(best, 1);
  return true;
}

// What a note of this pitch plays: { from, to, rate } in seconds, or null for silence.
export function sliceFor(s, pitch) {
  const end = sampleEnd(s);
  if (!(end > s.start)) return null;
  if (!s.slices.length) return { from: s.start, to: end, rate: Math.pow(2, (pitch - s.root) / 12) };
  const bounds = [s.start, ...s.slices, end], k = pitch - s.root;
  if (k < 0 || k >= bounds.length - 1) return null;
  return { from: bounds[k], to: bounds[k + 1], rate: 1 };
}

// How much faster than its own speed an audio clip plays at this song tempo.
export function clipRate(s, songBpm) { return s.bpm > 0 && songBpm > 0 ? songBpm / s.bpm : 1; }

// Guess the sound's tempo from its trim: whole bars, 70..180 BPM, nearest 120. 0 if nothing fits.
export function guessBpm(s) {
  const secs = sampleEnd(s) - s.start;
  if (!(secs > 0)) return 0;
  let best = 0;
  for (let n = 1; n <= 64; n++) {
    const b = (n * 240) / secs;
    if (b >= 70 && b <= 180 && (!best || Math.abs(b - 120) < Math.abs(best - 120))) best = b;
  }
  return best ? Math.round(best * 100) / 100 : 0;
}

// How an audio clip event plays: { from, to, rate, ratio } in seconds. ratio != 1 means "use the
// stretched buffer" (stretch.js): from/to are then positions in that buffer and rate is 1.
export function clipPlay(s, ev, songBpm) {
  const spb = 60 / songBpm, r = clipRate(s, songBpm), to = sampleEnd(s);
  const from = s.start + ev.offset * spb * r;
  if (s.bpm > 0 && s.warp !== "pitch" && Math.abs(r - 1) > 0.001) return { from: from / r, to: to / r, rate: 1, ratio: r };
  return { from, to, rate: r, ratio: 1 };
}

// How many bars a fresh audio clip of this sample should fill.
export function clipBars(s, bpm) {
  const secs = Math.max(0, sampleEnd(s) - s.start) / clipRate(s, bpm);
  return Math.max(1, Math.ceil((secs * bpm) / 240));
}

// Every audio clip as events in beats: { track, start, length, offset }.
export function songAudio(song) {
  const out = [];
  for (const c of song.clips || []) {
    if (c.track == null) continue;
    const t = song.tracks[c.track];
    if (!t || !t.sample) continue;
    out.push({ track: c.track, start: c.start * 4, length: c.length * 4, offset: c.offset * 4 });
  }
  return out.sort((a, b) => a.start - b.start);
}

// n bars of 0..1 (the loudest sample in each stretch), for drawing the waveform.
export function peaks(data, n) {
  const out = new Array(n).fill(0), size = Math.max(1, Math.floor(data.length / n));
  for (let i = 0; i < n; i++) {
    let m = 0;
    for (let j = i * size, e = Math.min(data.length, j + size); j < e; j++) m = Math.max(m, Math.abs(data[j]));
    out[i] = Math.min(1, m);
  }
  return out;
}

// Play from..to of a decoded buffer at `time`, for at most gate seconds (0 = the whole piece).
// Returns the source node, or null when there is nothing to play.
export function playSlice(ctx, buffer, { from, to, rate }, time, gate, velocity, dest) {
  const dur = buffer.duration;
  from = clamp(from, 0, dur); to = clamp(to, from, dur);
  const avail = (to - from) / rate, len = gate > 0 ? Math.min(avail, gate) : avail;
  if (!(len > 0.002)) return null;
  const vol = clamp((velocity || 100) / 127, 0.02, 1), fade = Math.min(0.01, len / 2);
  const src = ctx.createBufferSource();
  src.buffer = buffer; src.playbackRate.value = rate;
  const g = ctx.createGain();
  g.gain.setValueAtTime(vol, time);
  g.gain.setValueAtTime(vol, time + len - fade);
  g.gain.linearRampToValueAtTime(0.0001, time + len);
  src.connect(g); g.connect(dest);
  src.start(time, from, len * rate);
  return src;
}
