// The song page's DAW tab reads, plays and saves through web/daw/preview.js.
import test from "node:test";
import assert from "node:assert/strict";
import { previewOf, due, midiOf, songFromMidi, textToSong, songToText, notesPerTrack } from "../../web/daw/preview.js";
import { parseMidi } from "../../web/daw/midi.js";

const base = () => {
  const s = songFromMidi(midiOf(textToSong(JSON.stringify({
    format: "jriter-daw", version: 11, bpm: 120, bars: 2,
    tracks: [{ name: "Lead", instrument: "piano" }, { name: "Bass", instrument: "bass" }],
    patterns: [{ name: "P", tracks: [
      { notes: [{ pitch: 60, start: 0, length: 1, velocity: 100 }, { pitch: 64, start: 4, length: 2, velocity: 90 }] },
      { notes: [{ pitch: 36, start: 2, length: 1, velocity: 100 }] },
    ] }],
  }))));
  return s;
};

test("times follow the tempo and notes are sorted", () => {
  const p = previewOf(base());
  assert.equal(p.bpm, 120);
  assert.equal(p.beats, 8);
  assert.equal(p.seconds, 4);
  assert.deepEqual(p.notes.map((n) => n.time), [0, 1, 2]);
  assert.equal(p.notes[2].dur, 1);
  assert.ok(p.low <= 34 && p.high >= 66);
});

test("step notes count too", () => {
  const s = base();
  s.tracks[0].steps = s.tracks[0].steps.map((x, i) => (i === 0 ? { pitch: 72, velocity: 100 } : x));
  const per = notesPerTrack(s);
  assert.ok(per[0].some((n) => n.pitch === 72));
});

test("mute, solo and sampler tracks are silent", () => {
  const s = base();
  s.tracks[1].mute = true;
  assert.deepEqual(previewOf(s).tracks.map((t) => t.silent), [false, true]);
  s.tracks[1].mute = false; s.tracks[0].solo = true;
  assert.deepEqual(previewOf(s).tracks.map((t) => t.muted), [false, true]);
  s.tracks[0].solo = false; s.tracks[0].sample = { src: "/api/samples/1/audio", name: "x" };
  const t = previewOf(s).tracks[0];
  assert.equal(t.sampled, true);
  assert.equal(t.silent, true);
});

test("due gives the half-open window and skips silent notes", () => {
  const s = base();
  s.tracks[1].mute = true;
  const p = previewOf(s);
  assert.deepEqual(due(p.notes, 0, 1).map((n) => n.pitch), [60]);
  assert.deepEqual(due(p.notes, 1, 2).map((n) => n.pitch), []);
  assert.deepEqual(due(p.notes, 1, 4).map((n) => n.pitch), [64]);
  assert.equal(due(p.notes, 0, 4).some((n) => n.track === 1), false);
  assert.equal(due(p.notes, 2, 4).length, 1);
});

test("song mode plays through the clips", () => {
  const s = base();
  s.mode = "song";
  s.clips = [{ pattern: 0, lane: 0, start: 0, length: 2, offset: 0 }, { pattern: 0, lane: 0, start: 2, length: 2, offset: 0 }];
  const p = previewOf(s);
  assert.equal(p.beats, 16);
  assert.ok(p.notes.length > 3);
});

test("a .mid round trip keeps the notes", () => {
  const s = base();
  const back = parseMidi(midiOf(s));
  assert.equal(back.tracks.reduce((n, t) => n + t.notes.length, 0), 3);
  assert.equal(textToSong(songToText(s)).tracks.length, 2);
});

test("a MIDI file with no notes is refused", () => {
  const empty = midiOf({ bpm: 120, bars: 1, tracks: [{ name: "x", notes: [] }] });
  assert.throws(() => songFromMidi(empty), /no notes/);
});
