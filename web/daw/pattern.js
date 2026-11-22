// pattern.js: patterns and the step sequencer's maths. Pure functions, no DOM (tests/daw).
//
// The model. A channel is a track. A track has `key` (the pitch a new step plays) and, for the
// pattern being edited, `notes` (piano roll) and `steps` (16 entries, each null = off or
// { velocity 1-127, pitch 0-127 }). A song has `patterns: [{ name, tracks: [{ notes, steps }] }]`
// and `pattern`, the index being edited.
// THE RULE: the pattern being edited lives in song.tracks[i].notes / .steps, so the roll, chords,
// scripts and MIDI export all keep editing track.notes. song.patterns[song.pattern] is stale in
// memory; withPatterns() and usePattern() refresh it. A missing patterns[k].tracks[i] is empty.
// One row of steps is one bar (16 sixteenths) and repeats over song.bars. Swing 0..1 delays the
// odd steps (2nd, 4th, ...) by swing * 1/8 beat.

export const STEPS = 16;
export const STEP_BEATS = 0.25;

export const emptySteps = () => Array.from({ length: STEPS }, () => null);
export const defaultKey = (instrument) => (instrument === "drums" ? 36 : 60);

const copy = (x) => JSON.parse(JSON.stringify(x));
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

export function cleanSteps(list) {
  const out = emptySteps();
  if (!Array.isArray(list)) return out;
  for (let i = 0; i < STEPS; i++) {
    const s = list[i];
    if (s && typeof s === "object") {
      out[i] = {
        velocity: clamp(Math.round(Number.isFinite(s.velocity) ? s.velocity : 100), 1, 127),
        pitch: clamp(Math.round(Number.isFinite(s.pitch) ? s.pitch : 60), 0, 127),
      };
    }
  }
  return out;
}

export function stepsToNotes(steps, swing = 0, bars = 1) {
  const out = [];
  if (!Array.isArray(steps)) return out;
  for (let bar = 0; bar < bars; bar++) {
    steps.forEach((s, i) => {
      if (!s) return;
      const late = i % 2 === 1 ? clamp(swing, 0, 1) * 0.125 : 0;
      out.push({ pitch: s.pitch, start: bar * 4 + i * STEP_BEATS + late, length: STEP_BEATS, velocity: s.velocity });
    });
  }
  return out;
}

// Everything a channel plays: its roll notes plus its step notes.
export function allNotes(track, song) {
  return [...track.notes, ...stepsToNotes(track.steps, song.swing || 0, song.bars)];
}

export function ensureChannel(t) {
  if (!Number.isFinite(t.key)) t.key = defaultKey(t.instrument);
  if (!Array.isArray(t.steps)) t.steps = emptySteps();
  return t;
}

const snapshot = (t) => ({ notes: copy(t.notes), steps: copy(t.steps || emptySteps()) });

// The patterns array with the one being edited refreshed from the tracks.
export function withPatterns(song) {
  const list = copy(song.patterns && song.patterns.length ? song.patterns : [{ name: "Pattern 1", tracks: [] }]);
  const k = clamp(song.pattern || 0, 0, list.length - 1);
  list[k].tracks = song.tracks.map(snapshot);
  return list;
}

function load(song, k) {
  const p = song.patterns[k];
  song.tracks.forEach((t, i) => {
    const src = p.tracks[i];
    t.notes = src ? copy(src.notes) : [];
    t.steps = src ? cleanSteps(src.steps) : emptySteps();
  });
  song.pattern = k;
}

export function usePattern(song, k) {
  song.patterns = withPatterns(song);
  if (k < 0 || k >= song.patterns.length) return;
  load(song, k);
}

export function addPattern(song, dup) {
  song.patterns = withPatterns(song);
  const at = clamp(song.pattern || 0, 0, song.patterns.length - 1);
  const name = "Pattern " + (song.patterns.length + 1);
  const fresh = dup
    ? { name: song.patterns[at].name + " copy", tracks: copy(song.patterns[at].tracks) }
    : { name, tracks: [] };
  song.patterns.splice(at + 1, 0, fresh);
  load(song, at + 1);
}

export function removePattern(song, k) {
  song.patterns = withPatterns(song);
  if (song.patterns.length <= 1) return false;
  song.patterns.splice(k, 1);
  load(song, clamp(k > 0 ? k - 1 : 0, 0, song.patterns.length - 1));
  return true;
}

// Take a track out of the song (the caller splices song.tracks) and out of every pattern.
export function removeTrackEverywhere(song, i) {
  song.patterns = withPatterns(song);
  for (const p of song.patterns) if (i < p.tracks.length) p.tracks.splice(i, 1);
  song.tracks.splice(i, 1);
}
