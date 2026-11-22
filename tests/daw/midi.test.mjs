import test from "node:test";
import assert from "node:assert/strict";
import { parseMidi, writeMidi, songToText, textToSong } from "../../web/daw/midi.js";

test("parses running status, velocity-0 note-off and tempo", () => {
  const trk = [
    0, 0xff, 0x51, 3, 0x09, 0x27, 0xc0, // 600000 us = 100 bpm
    0, 0x90, 60, 100,
    0x60, 62, 80, // running status, note on at 96 ticks
    0x60, 60, 0, // running status, velocity 0 = off at 192
    0x60, 62, 0, // off at 288
    0, 0xff, 0x2f, 0,
  ];
  const f = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, 0, 96,
    0x4d, 0x54, 0x72, 0x6b, 0, 0, 0, trk.length, ...trk];
  const m = parseMidi(new Uint8Array(f));
  assert.equal(m.bpm, 100);
  assert.equal(m.tracks.length, 1);
  assert.deepEqual(m.tracks[0].notes, [
    { pitch: 60, start: 0, length: 2, velocity: 100 },
    { pitch: 62, start: 1, length: 2, velocity: 80 },
  ]);
});

const song = {
  bpm: 133, bars: 2,
  tracks: [
    { name: "Lead", instrument: "piano", volume: 0.7, notes: [{ pitch: 64, start: 0.5, length: 1.25, velocity: 99 }, { pitch: 67, start: 2, length: 0.5, velocity: 70 }] },
    { name: "Kick", instrument: "drums", channel: 9, notes: [{ pitch: 36, start: 0, length: 0.25, velocity: 120 }] },
  ],
};

test("writeMidi then parseMidi keeps the notes", () => {
  const m = parseMidi(writeMidi(song));
  assert.equal(m.bpm, 133);
  assert.equal(m.tracks.length, 2);
  assert.equal(m.tracks[0].name, "Lead");
  assert.deepEqual(m.tracks[0].notes, song.tracks[0].notes);
  assert.deepEqual(m.tracks[1].notes, song.tracks[1].notes);
  assert.equal(m.tracks[1].channel, 9);
});

test("text format round trips", () => {
  const back = textToSong(songToText(song));
  assert.equal(back.bpm, 133);
  assert.equal(back.bars, 2);
  assert.deepEqual(back.tracks[0].notes, song.tracks[0].notes);
  assert.equal(back.tracks[0].volume, 0.7);
});

test("text format rejects other files and newer versions", () => {
  assert.throws(() => textToSong(JSON.stringify({ format: "jriter-daw", version: 99 })), /newer/);
  assert.throws(() => textToSong("{}"), /not a JR!TER/);
  assert.throws(() => textToSong("nope"), /JSON/);
  assert.throws(() => parseMidi(new Uint8Array([1, 2, 3, 4])), /not a MIDI/);
});

test("chords and scripts are saved with the song (version 4)", () => {
  const text = songToText({ ...song, chords: { chords: [{ symbol: "Dm9", beats: 2 }], voiceLead: false, strumMs: 10, velocity: 80 },
    scripts: [{ name: "Mine", code: "each note:\n  pitch += 1", values: { x: 3 } }] });
  assert.equal(JSON.parse(text).version, 4);
  const back = textToSong(text);
  assert.equal(back.chords.chords[0].symbol, "Dm9");
  assert.equal(back.chords.voiceLead, false);
  assert.deepEqual(back.scripts, [{ name: "Mine", code: "each note:\n  pitch += 1", values: { x: 3 } }]);
});

test("a version 1 file still opens, with the default chords and scripts", () => {
  const old = JSON.stringify({ format: "jriter-daw", version: 1, bpm: 100, bars: 2, tracks: [{ name: "A", instrument: "bass", notes: [] }] });
  const s = textToSong(old);
  assert.equal(s.bpm, 100);
  assert.equal(s.chords.chords[0].symbol, "Cmaj9");
  assert.equal(s.scripts.length, 6);
});

test("patterns, steps, swing and key round trip (version 3)", () => {
  const step = { velocity: 90, pitch: 36 };
  const steps = Array.from({ length: 16 }, (_, i) => (i % 4 === 0 ? step : null));
  const s = { bpm: 120, bars: 2, swing: 0.4, pattern: 1, scripts: [], chords: null,
    patterns: [{ name: "A", tracks: [{ notes: [{ pitch: 60, start: 0, length: 1, velocity: 80 }], steps: Array(16).fill(null) }] }, { name: "B", tracks: [] }],
    tracks: [{ name: "Kick", instrument: "drums", key: 36, volume: 0.8, notes: [], steps }] };
  const back = textToSong(songToText(s));
  assert.equal(back.swing, 0.4);
  assert.equal(back.pattern, 1);
  assert.equal(back.patterns.length, 2);
  assert.equal(back.tracks[0].key, 36);
  assert.deepEqual(back.tracks[0].steps[4], step);
  assert.equal(back.patterns[0].tracks[0].notes.length, 1);
});

test("a version 2 file opens as one pattern with its notes", () => {
  const old = JSON.stringify({ format: "jriter-daw", version: 2, bpm: 100, bars: 2, tracks: [{ name: "A", instrument: "bass", notes: [{ pitch: 40, start: 1, length: 1, velocity: 90 }] }] });
  const s = textToSong(old);
  assert.equal(s.patterns.length, 1);
  assert.equal(s.tracks[0].notes.length, 1);
  assert.equal(s.tracks[0].steps.length, 16);
  assert.equal(s.tracks[0].key, 60);
});

import { songToText as _toText, textToSong as _fromText } from "../../web/daw/midi.js";
test("song format v4 keeps clips and mode; a v3 file opens with none", () => {
  const s = _fromText(_toText({ bpm: 120, bars: 2, swing: 0, pattern: 0, patterns: [{ name: "A", tracks: [] }], tracks: [{ name: "T", instrument: "piano", notes: [], steps: [] }] }));
  s.clips = [{ pattern: 0, lane: 1, start: 2, length: 3, offset: 0 }]; s.mode = "song";
  const back = _fromText(_toText(s));
  assert.deepEqual(back.clips, s.clips);
  assert.equal(back.mode, "song");
  const old = JSON.parse(_toText(s)); old.version = 3; delete old.clips; delete old.mode;
  const o = _fromText(JSON.stringify(old));
  assert.deepEqual(o.clips, []);
  assert.equal(o.mode, "pattern");
});
