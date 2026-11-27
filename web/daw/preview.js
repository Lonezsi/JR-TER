// preview.js: what the song page's DAW tab needs from the DAW, with no DOM.
// ui/src/views/song/DawTab.svelte imports this, so the tab reads, plays and writes songs
// with the same midi.js, synth.js, pattern.js and playlist.js as /daw.html: one engine.
// Times: "beats" are quarter notes from the start, "time" and "dur" are seconds.
import { textToSong, songToText, parseMidi, writeMidi, midiToSong } from "./midi.js";
import { createSynth, instrumentFor, INSTRUMENTS } from "./synth.js";
import { songNotes, songBars } from "./playlist.js";
import { allNotes } from "./pattern.js";

export { textToSong, songToText, createSynth };

// Every note per track, as the DAW plays them: clips in song mode, the open pattern otherwise.
export function notesPerTrack(song) {
  return song.mode === "song" && (song.clips || []).length ? songNotes(song) : song.tracks.map((t) => allNotes(t, song));
}

export function previewOf(song) {
  const per = notesPerTrack(song);
  const solo = song.tracks.some((t) => t.solo);
  const tracks = song.tracks.map((t) => {
    const muted = !!t.mute || (solo && !t.solo);
    const sampled = !!t.sample;
    return { name: t.name, instrument: t.instrument, muted, sampled, silent: muted || sampled || !INSTRUMENTS.includes(t.instrument) };
  });
  const sec = 60 / song.bpm;
  let beats = (song.mode === "song" && (song.clips || []).length ? songBars(song) : song.bars) * 4;
  let low = 127, high = 0;
  const notes = [];
  per.forEach((list, i) => {
    for (const n of list) {
      beats = Math.max(beats, n.start + n.length);
      low = Math.min(low, n.pitch); high = Math.max(high, n.pitch);
      notes.push({ track: i, pitch: n.pitch, start: n.start, length: n.length, velocity: n.velocity, time: n.start * sec, dur: n.length * sec, instrument: tracks[i].instrument, silent: tracks[i].silent });
    }
  });
  if (!notes.length) { low = 48; high = 72; }
  notes.sort((a, b) => a.time - b.time || a.pitch - b.pitch);
  return { bpm: song.bpm, beats, seconds: beats * sec, low: Math.max(0, low - 2), high: Math.min(127, high + 2), tracks, notes };
}

// The notes to schedule for the window [from, to) seconds.
export function due(notes, from, to) {
  return notes.filter((n) => !n.silent && n.time >= from && n.time < to);
}

export function midiOf(song) {
  const per = notesPerTrack(song);
  return writeMidi({ ...song, tracks: song.tracks.map((t, i) => ({ ...t, notes: per[i] })) });
}

export function songFromMidi(bytes) {
  const s = midiToSong(parseMidi(bytes), instrumentFor);
  if (!s.tracks.some((t) => t.notes.length)) throw new Error("That MIDI file has no notes.");
  return textToSong(songToText(s));
}
