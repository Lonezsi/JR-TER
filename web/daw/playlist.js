// playlist.js: the song timeline. Pure functions, no DOM (tests/daw).
//
// The model. song.clips = [{ pattern, lane, start, length, offset }], everything in BARS:
//   pattern  index into song.patterns
//   lane     a free row, 0..15 (lanes are not tied to channels, like FL's playlist)
//   start    the bar the clip begins on; length = bars it fills
//   offset   bars into the pattern where the clip starts (a cut makes the second half start later)
// A pattern is song.bars long. A clip longer than that plays the pattern again (repeat-drag).
// song.mode is "pattern" (Play loops the pattern being edited) or "song" (Play runs the clips).
import { withPatterns, stepsToNotes } from "./pattern.js";

export const MAX_LANES = 16;
export const MAX_BARS = 256;

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const int = (v, d) => (Number.isFinite(v) ? Math.round(v) : d);

export function cleanClips(list, nPatterns) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const c of list) {
    if (!c || typeof c !== "object") continue;
    const pattern = int(c.pattern, -1);
    if (pattern < 0 || pattern >= nPatterns) continue;
    out.push({
      pattern,
      lane: clamp(int(c.lane, 0), 0, MAX_LANES - 1),
      start: clamp(int(c.start, 0), 0, MAX_BARS - 1),
      length: clamp(int(c.length, 1), 1, MAX_BARS),
      offset: clamp(int(c.offset, 0), 0, MAX_BARS),
    });
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
  song.clips.push({ pattern, lane: clamp(lane, 0, MAX_LANES - 1), start: clamp(start, 0, MAX_BARS - 1), length: clamp(song.bars, 1, MAX_BARS), offset: 0 });
  return song.clips.length - 1;
}
export function moveClip(song, i, lane, start) {
  const c = song.clips[i];
  if (!c) return;
  c.lane = clamp(lane, 0, MAX_LANES - 1);
  c.start = clamp(start, 0, MAX_BARS - c.length);
}
export function resizeClip(song, i, length) {
  const c = song.clips[i];
  if (c) c.length = clamp(length, 1, MAX_BARS - c.start);
}
// Cut at a bar strictly inside the clip. The second half keeps playing from where the first stopped.
export function splitClip(song, i, atBar) {
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
  for (const c of song.clips || []) if (c.pattern >= at) c.pattern++;
}
// Pattern k was deleted: its clips go, later ones move down one.
export function fixClipsAfterRemove(song, k) {
  if (!song.clips) return;
  song.clips = song.clips.filter((c) => c.pattern !== k);
  for (const c of song.clips) if (c.pattern > k) c.pattern--;
}
