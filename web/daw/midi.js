// midi.js: read and write Standard MIDI Files, and the DAW's own text format.
// Pure functions, no DOM, so it runs in the browser and in Node (tests/daw).
// Times are in beats (a quarter note = 1). A song looks like:
//   { bpm, bars, tracks: [{ name, instrument, channel, program, volume, mute, solo,
//                           notes: [{ pitch 0-127, start, length, velocity 1-127 }] }] }

export const TEXT_FORMAT = "jriter-daw";
export const TEXT_VERSION = 3; // 2 added chords and scripts, 3 patterns, steps and swing; older files still open

import { DEFAULT_PROGRESSION } from "./chords.js";
import { defaultScripts } from "./script.js";
import { withPatterns, cleanSteps, emptySteps, defaultKey } from "./pattern.js";

export function parseMidi(buf) {
  const d = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let p = 0;
  const u32 = () => ((d[p++] << 24) | (d[p++] << 16) | (d[p++] << 8) | d[p++]) >>> 0;
  const u16 = () => (d[p++] << 8) | d[p++];
  const tag = () => String.fromCharCode(d[p++], d[p++], d[p++], d[p++]);
  if (tag() !== "MThd") throw new Error("That is not a MIDI file.");
  const hlen = u32();
  const format = u16(), ntracks = u16(), division = u16();
  p = 8 + hlen;
  if (division & 0x8000) throw new Error("SMPTE time MIDI files are not supported.");
  const ppq = division;
  let tempo = null;
  const tracks = [];
  for (let t = 0; t < ntracks && p < d.length; t++) {
    const id = tag(), len = u32(), end = Math.min(p + len, d.length);
    if (id !== "MTrk") { p = end; continue; }
    const track = { name: "", channel: 0, program: 0, notes: [] };
    const open = new Map();
    let tick = 0, status = 0, sawChannel = false;
    const vlq = () => { let v = 0, b; do { b = d[p++]; v = (v << 7) | (b & 0x7f); } while (b & 0x80 && p < end); return v; };
    const close = (key, at) => {
      const o = open.get(key);
      if (!o) return;
      open.delete(key);
      track.notes.push({ pitch: o.pitch, start: o.tick / ppq, length: Math.max(1 / 64, (at - o.tick) / ppq), velocity: o.vel });
    };
    while (p < end) {
      tick += vlq();
      const b = d[p];
      if (b === 0xff) {
        p++;
        const type = d[p++], n = vlq();
        if (type === 0x03 && !track.name) track.name = String.fromCharCode(...d.slice(p, p + n));
        if (type === 0x51 && tempo === null && n === 3) tempo = 60000000 / ((d[p] << 16) | (d[p + 1] << 8) | d[p + 2]);
        p += n;
        if (type === 0x2f) break;
        continue;
      }
      if (b === 0xf0 || b === 0xf7) { p++; p += vlq(); continue; }
      if (b & 0x80) { status = b; p++; }
      const hi = status & 0xf0, ch = status & 0x0f;
      const two = hi === 0xc0 || hi === 0xd0;
      const a = d[p++], v = two ? 0 : d[p++];
      if (hi === 0x90 && v > 0) {
        if (!sawChannel) { track.channel = ch; sawChannel = true; }
        close(ch * 128 + a, tick); // a retriggered note ends the earlier one
        open.set(ch * 128 + a, { pitch: a, tick, vel: v });
      } else if (hi === 0x80 || hi === 0x90) close(ch * 128 + a, tick);
      else if (hi === 0xc0) track.program = a;
    }
    for (const key of [...open.keys()]) close(key, tick);
    track.notes.sort((x, y) => x.start - y.start || x.pitch - y.pitch);
    if (track.notes.length) tracks.push(track);
    p = end;
  }
  const bpm = Math.round((tempo || 120) * 100) / 100;
  let last = 0;
  for (const t of tracks) for (const n of t.notes) last = Math.max(last, n.start + n.length);
  return { format, ppq, bpm, bars: Math.max(1, Math.ceil(last / 4)), tracks };
}

export function writeMidi(song) {
  const PPQ = 480, out = [];
  const b = (...x) => out.push(...x);
  const u32 = (v) => b((v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255);
  const u16 = (v) => b((v >> 8) & 255, v & 255);
  const chunk = (events) => { b(0x4d, 0x54, 0x72, 0x6b); u32(events.length); for (const e of events) out.push(e); };
  const vlq = (v) => { const r = [v & 0x7f]; while ((v >>= 7)) r.unshift((v & 0x7f) | 0x80); return r; };
  b(0x4d, 0x54, 0x68, 0x64); u32(6); u16(1); u16(song.tracks.length + 1); u16(PPQ);
  const us = Math.round(60000000 / song.bpm);
  chunk([0, 0xff, 0x51, 3, (us >> 16) & 255, (us >> 8) & 255, us & 255, 0, 0xff, 0x2f, 0]);
  song.tracks.forEach((t, i) => {
    const ev = [], ch = t.channel ?? (i % 15 >= 9 ? (i % 15) + 1 : i % 15);
    const name = [...new TextEncoder().encode(t.name || "")];
    ev.push(0, 0xff, 0x03, ...vlq(name.length), ...name);
    ev.push(0, 0xc0 | ch, (t.program ?? 0) & 127);
    const list = [];
    for (const n of t.notes) {
      const s = Math.round(n.start * PPQ), e = s + Math.max(1, Math.round(n.length * PPQ));
      list.push({ at: s, on: 1, n }, { at: e, on: 0, n });
    }
    list.sort((x, y) => x.at - y.at || x.on - y.on);
    let at = 0;
    for (const x of list) {
      ev.push(...vlq(x.at - at), (x.on ? 0x90 : 0x80) | ch, x.n.pitch, x.on ? x.n.velocity : 0);
      at = x.at;
    }
    ev.push(0, 0xff, 0x2f, 0);
    chunk(ev);
  });
  return new Uint8Array(out);
}

export function songToText(song) {
  return JSON.stringify({
    format: TEXT_FORMAT,
    version: TEXT_VERSION,
    about: "A JR!TER DAW song. bpm = tempo; bars = loop length (4 beats each); swing 0-1 delays every " +
      "second sixteenth step. tracks are the channels: instrument (piano, pad, bass, pluck, drums), " +
      "key = the pitch a new step plays, volume 0-1. patterns hold the music: each pattern has, per " +
      "track in the same order, notes (pitch is a MIDI number, 60 = middle C; start and length are in " +
      "beats; velocity 1-127) and steps (16 entries, one bar of sixteenths: null = off, or " +
      "{velocity, pitch}; the bar repeats over the loop). pattern = the index of the pattern open in " +
      "the editor. Edit it by hand and open it again on /daw.html. chords is the chord editor's " +
      "progression (symbols like Cmaj9 or G13/B, beats each, how to voice them); it is only a way to " +
      "write notes, so the notes are the music. scripts are note scripts (see web/daw/script.js for " +
      "the language): name, code, and the values of the sliders its params make.",
    bpm: song.bpm,
    bars: song.bars,
    swing: song.swing || 0,
    pattern: song.pattern || 0,
    chords: song.chords ?? JSON.parse(JSON.stringify(DEFAULT_PROGRESSION)),
    scripts: (song.scripts ?? defaultScripts()).map((x) => ({ name: x.name, code: x.code, values: { ...x.values } })),
    tracks: song.tracks.map((t) => ({
      name: t.name, instrument: t.instrument, key: t.key ?? defaultKey(t.instrument), volume: t.volume ?? 0.8,
      mute: !!t.mute, solo: !!t.solo,
    })),
    patterns: withPatterns(song),
  }, null, 1);
}

export function textToSong(text) {
  let j;
  try { j = JSON.parse(text); } catch { throw new Error("That is not a song file (not valid JSON)."); }
  if (!j || j.format !== TEXT_FORMAT) throw new Error("That is not a JR!TER DAW song.");
  if (j.version > TEXT_VERSION) throw new Error("That song is from a newer version of the DAW.");
  const num = (v, d) => (Number.isFinite(v) ? v : d);
  const readNotes = (list) => (Array.isArray(list) ? list : []).map((n) => ({
    pitch: Math.min(127, Math.max(0, Math.round(num(n.pitch, 60)))),
    start: Math.max(0, num(n.start, 0)),
    length: Math.max(1 / 64, num(n.length, 0.25)),
    velocity: Math.min(127, Math.max(1, Math.round(num(n.velocity, 90)))),
  }));
  const rawTracks = Array.isArray(j.tracks) ? j.tracks : [];
  const song = {
    bpm: Math.min(300, Math.max(20, num(j.bpm, 120))),
    bars: Math.min(64, Math.max(1, Math.round(num(j.bars, 4)))),
    swing: Math.min(1, Math.max(0, num(j.swing, 0))),
    chords: readChords(j.chords),
    scripts: readScripts(j.scripts),
    tracks: rawTracks.map((t, i) => {
      const instrument = String(t.instrument ?? "piano");
      return {
        name: String(t.name ?? "Track " + (i + 1)),
        instrument,
        key: Math.min(127, Math.max(0, Math.round(num(t.key, defaultKey(instrument))))),
        volume: Math.min(1, Math.max(0, num(t.volume, 0.8))),
        mute: !!t.mute, solo: !!t.solo,
        notes: [], steps: emptySteps(),
      };
    }),
  };
  if (Array.isArray(j.patterns) && j.patterns.length) {
    song.patterns = j.patterns.map((p, k) => ({
      name: String((p && p.name) ?? "Pattern " + (k + 1)),
      tracks: (p && Array.isArray(p.tracks) ? p.tracks : []).map((t) => ({ notes: readNotes(t && t.notes), steps: cleanSteps(t && t.steps) })),
    }));
    song.pattern = Math.min(song.patterns.length - 1, Math.max(0, Math.round(num(j.pattern, 0))));
  } else { // version 1 or 2: the notes sit in the tracks, and that is one pattern
    song.patterns = [{ name: "Pattern 1", tracks: [] }];
    song.pattern = 0;
    song.patterns[0].tracks = rawTracks.map((t) => ({ notes: readNotes(t && t.notes), steps: emptySteps() }));
  }
  const cur = song.patterns[song.pattern];
  song.tracks.forEach((t, i) => {
    const src = cur.tracks[i];
    if (src) { t.notes = src.notes.map((n) => ({ ...n })); t.steps = src.steps.map((x) => (x ? { ...x } : null)); }
  });
  return song;
}

function readChords(c) {
  const d = JSON.parse(JSON.stringify(DEFAULT_PROGRESSION));
  if (!c || !Array.isArray(c.chords)) return d;
  const chords = c.chords.filter((x) => x && typeof x.symbol === "string").map((x) => ({ ...x, beats: x.beats > 0 ? Number(x.beats) : 4 }));
  return { ...d, ...c, chords: chords.length ? chords : d.chords };
}
function readScripts(list) {
  if (!Array.isArray(list)) return defaultScripts();
  return list.filter((x) => x && typeof x.code === "string").map((x, i) => ({
    name: String(x.name ?? "Script " + (i + 1)), code: x.code, values: x.values && typeof x.values === "object" ? { ...x.values } : {},
  }));
}

// Turn a parsed MIDI file into a DAW song (instrument chosen from program / channel).
export function midiToSong(m, instrumentFor) {
  return {
    bpm: m.bpm, bars: Math.min(64, m.bars), swing: 0, pattern: 0, patterns: [{ name: "Pattern 1", tracks: [] }],
    chords: JSON.parse(JSON.stringify(DEFAULT_PROGRESSION)), scripts: defaultScripts(),
    tracks: m.tracks.map((t, i) => ({
      name: t.name || "Track " + (i + 1),
      instrument: instrumentFor(t.program, t.channel),
      channel: t.channel, program: t.program, volume: 0.8, mute: false, solo: false,
      key: defaultKey(instrumentFor(t.program, t.channel)), steps: emptySteps(),
      notes: t.notes,
    })),
  };
}
