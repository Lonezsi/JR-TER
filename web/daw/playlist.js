// playlist.js: the song timeline. Pure functions, no DOM (tests/daw).
//
// The model. song.clips = [{ pattern, lane, start, length, offset }], everything in BARS:
//   pattern  index into song.patterns
//   lane     a free row, 0..15 (lanes are not tied to channels, like FL's playlist)
//   start    the bar the clip begins on; length = bars it fills
//   offset   bars into the pattern where the clip starts (a cut makes the second half start later)
// A pattern is song.bars long. A clip longer than that plays the pattern again (repeat-drag).
// song.mode is "pattern" (Play loops the pattern being edited) or "song" (Play runs the clips).
// song.loop (optional) = { from, to } in bars: in song mode Play loops that range.
import { withPatterns, stepsToNotes } from "./pattern.js";

export const MAX_LANES = 16;
export const MAX_BARS = 256;

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const int = (v, d) => (Number.isFinite(v) ? Math.round(v) : d);
// Clips sit on a sixteenth-of-a-bar grid (version 8 of the project text); older files only had whole bars.
export const QB = 16;
const qb = (v, d) => (Number.isFinite(v) ? Math.round(v * QB) / QB : d);
const MIN = 1 / QB;

// A clip is either a pattern clip ({ pattern }) or an audio clip ({ track }: it plays that
// track's sample, see sampler.js). nTracks is how many tracks the song has.
export function cleanClips(list, nPatterns, nTracks = 0) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const c of list) {
    if (!c || typeof c !== "object") continue;
    const track = c.pattern == null ? int(c.track, -1) : -1;
    const pattern = int(c.pattern, -1);
    if (track < 0 && (pattern < 0 || pattern >= nPatterns)) continue;
    if (track >= nTracks) continue;
    out.push({
      ...(track >= 0 ? { track } : { pattern }),
      lane: clamp(int(c.lane, 0), 0, MAX_LANES - 1),
      start: clamp(qb(c.start, 0), 0, MAX_BARS - MIN),
      length: clamp(qb(c.length, 1), MIN, MAX_BARS),
      offset: clamp(qb(c.offset, 0), 0, MAX_BARS),
    });
  }
  return out;
}

// The loop range as { from, to } in bars on the sixteenth grid, or null when it is not a real range.
export function cleanLoop(x) {
  if (!x || typeof x !== "object") return null;
  const a = qb(x.from, NaN), b = qb(x.to, NaN);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  const from = clamp(Math.min(a, b), 0, MAX_BARS), to = clamp(Math.max(a, b), 0, MAX_BARS);
  return to - from < MIN - 1e-9 ? null : { from, to };
}
export function setLoop(song, a, b) {
  const l = cleanLoop({ from: a, to: b });
  if (l) song.loop = l; else delete song.loop;
  return l;
}
export function moveLoop(song, d) {
  const l = cleanLoop(song.loop);
  if (!l) return;
  const len = l.to - l.from, from = clamp(qb(l.from + d, l.from), 0, MAX_BARS - len);
  song.loop = { from, to: qb(from + len, from + len) };
}
// Events (beats: { start, length, offset? }) that sound between f and t, moved so f is 0.
// An audio event that began before f is cut and its offset moves on.
export function inSpan(events, f, t) {
  const out = [];
  for (const e of events) {
    const end = e.start + e.length;
    if (e.start >= f && e.start < t) out.push({ ...e, start: e.start - f, length: Math.min(e.length, t - e.start) });
    else if (e.offset != null && e.start < f && end > f) out.push({ ...e, start: 0, length: Math.min(end, t) - f, offset: e.offset + (f - e.start) });
  }
  return out;
}

export function songBars(song) {
  let end = 1;
  for (const c of song.clips || []) end = Math.max(end, c.start + c.length);
  return end;
}

// Every note the song plays, per track, at absolute beats from the start of the song.
export function songNotes(song) {
  const pats = withPatterns(song);
  const patLen = song.bars * 4;
  const out = song.tracks.map(() => []);
  for (const c of song.clips || []) {
    if (c.track != null) continue; // audio clips are played by sampler.js
    const p = pats[c.pattern];
    if (!p) continue;
    song.tracks.forEach((_, i) => {
      const src = p.tracks[i];
      if (!src) return;
      const base = [...src.notes, ...stepsToNotes(src.steps, song.swing || 0, song.bars)];
      for (let r = 0; r * patLen < (c.offset + c.length) * 4 + patLen; r++) {
        for (const n of base) {
          if (n.start >= patLen) continue;
          const local = n.start + r * patLen - c.offset * 4;
          if (local < 0 || local >= c.length * 4) continue;
          out[i].push({ ...n, start: c.start * 4 + local, length: Math.min(n.length, c.length * 4 - local) });
        }
      }
    });
  }
  for (const list of out) list.sort((a, b) => a.start - b.start || a.pitch - b.pitch);
  return out;
}

export function addClip(song, pattern, lane, start) {
  song.clips = song.clips || [];
  song.clips.push({ pattern, lane: clamp(lane, 0, MAX_LANES - 1), start: clamp(qb(start, 0), 0, MAX_BARS - 1), length: clamp(song.bars, 1, MAX_BARS), offset: 0 });
  return song.clips.length - 1;
}
export function addAudioClip(song, track, lane, start, bars) {
  song.clips = song.clips || [];
  song.clips.push({ track, lane: clamp(lane, 0, MAX_LANES - 1), start: clamp(qb(start, 0), 0, MAX_BARS - 1), length: clamp(bars, 1, MAX_BARS), offset: 0 });
  return song.clips.length - 1;
}
export function moveClip(song, i, lane, start) {
  const c = song.clips[i];
  if (!c) return;
  c.lane = clamp(lane, 0, MAX_LANES - 1);
  c.start = clamp(qb(start, 0), 0, MAX_BARS - c.length);
}
export function resizeClip(song, i, length) {
  const c = song.clips[i];
  if (c) c.length = clamp(qb(length, 1), MIN, MAX_BARS - c.start);
}
// Cut at a bar strictly inside the clip. The second half keeps playing from where the first stopped.
export function splitClip(song, i, atBar) {
  atBar = qb(atBar, 0);
  const c = song.clips[i];
  if (!c || atBar <= c.start || atBar >= c.start + c.length) return false;
  const second = { ...c, start: atBar, length: c.start + c.length - atBar, offset: c.offset + (atBar - c.start) };
  c.length = atBar - c.start;
  song.clips.splice(i + 1, 0, second);
  return true;
}
export function removeClip(song, i) {
  if (song.clips && i >= 0 && i < song.clips.length) song.clips.splice(i, 1);
}
// A pattern was inserted at index `at`: clips pointing at it or after move up one.
export function fixClipsAfterInsert(song, at) {
  for (const c of song.clips || []) if (c.pattern != null && c.pattern >= at) c.pattern++;
}
// Pattern k was deleted: its clips go, later ones move down one.
export function fixClipsAfterRemove(song, k) {
  if (!song.clips) return;
  song.clips = song.clips.filter((c) => c.pattern !== k);
  for (const c of song.clips) if (c.pattern != null && c.pattern > k) c.pattern--;
}
