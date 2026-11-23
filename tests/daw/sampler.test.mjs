import { gateFor } from "../../web/daw/sampler.js";
import test from "node:test";
import assert from "node:assert/strict";
import { cleanSample, chop, addSlice, removeSliceNear, sliceFor, clipBars, songAudio, peaks } from "../../web/daw/sampler.js";
import { addAudioClip, addClip, splitClip, cleanClips, songNotes } from "../../web/daw/playlist.js";
import { removeTrackEverywhere, emptySteps } from "../../web/daw/pattern.js";
import { songToText, textToSong } from "../../web/daw/midi.js";

const smp = (o = {}) => cleanSample({ name: "Loop", src: "/api/versions/1/audio", seconds: 8, ...o });
const mk = () => ({
  bpm: 120, bars: 2, swing: 0, pattern: 0, mode: "song", clips: [], patterns: [{ name: "Pattern 1", tracks: [] }],
  tracks: [
    { name: "P", instrument: "piano", key: 60, steps: emptySteps(), notes: [{ pitch: 60, start: 0, length: 1, velocity: 90 }] },
    { name: "Loop", instrument: "sampler", key: 60, steps: emptySteps(), notes: [], sample: smp() },
  ],
});

test("cleanSample refuses nonsense and tidies cuts", () => {
  assert.equal(cleanSample(null), null);
  assert.equal(cleanSample({ name: "x" }), null);
  const s = smp({ start: 1, end: 5, slices: [4, 2, 2, 0.5, 9, "x", 3] });
  assert.deepEqual(s.slices, [2, 3, 4]);
  assert.equal(smp({ start: 3, end: 2 }).end, 0);
  assert.equal(smp({ root: 500 }).root, 127);
});

test("chop cuts equal pieces; 1 clears", () => {
  const s = smp();
  chop(s, 4);
  assert.deepEqual(s.slices, [2, 4, 6]);
  chop(s, 1);
  assert.deepEqual(s.slices, []);
  const t = smp({ start: 2, end: 6 }); chop(t, 2);
  assert.deepEqual(t.slices, [4]);
});

test("addSlice and removeSliceNear", () => {
  const s = smp();
  assert.ok(addSlice(s, 3)); assert.ok(addSlice(s, 1));
  assert.ok(!addSlice(s, 0) && !addSlice(s, 8) && !addSlice(s, 3));
  assert.deepEqual(s.slices, [1, 3]);
  assert.ok(!removeSliceNear(s, 2, 0.5));
  assert.ok(removeSliceNear(s, 2.8, 0.5));
  assert.deepEqual(s.slices, [1]);
});

test("sliceFor: pitched without cuts, one piece per key with cuts", () => {
  const s = smp({ root: 60 });
  assert.deepEqual(sliceFor(s, 60), { from: 0, to: 8, rate: 1 });
  assert.equal(sliceFor(s, 72).rate, 2);
  chop(s, 4);
  assert.deepEqual(sliceFor(s, 60), { from: 0, to: 2, rate: 1 });
  assert.deepEqual(sliceFor(s, 63), { from: 6, to: 8, rate: 1 });
  assert.equal(sliceFor(s, 64), null);
  assert.equal(sliceFor(s, 59), null);
  assert.equal(sliceFor(smp({ seconds: 0 }), 60), null);
});

test("clipBars rounds up to whole bars at the song's tempo", () => {
  assert.equal(clipBars(smp({ seconds: 8 }), 120), 4); // a bar is 2 s
  assert.equal(clipBars(smp({ seconds: 8.5 }), 120), 5);
  assert.equal(clipBars(smp({ seconds: 0.1 }), 120), 1);
});

test("audio clips: placed, played in beats, skipped when the track has no sample", () => {
  const s = mk();
  addAudioClip(s, 1, 0, 2, 4);
  addAudioClip(s, 0, 1, 0, 1); // track 0 has no sample
  addClip(s, 0, 2, 0);
  assert.deepEqual(songAudio(s), [{ track: 1, start: 8, length: 16, offset: 0 }]);
  assert.equal(songNotes(s)[1].length, 0);
  assert.equal(songNotes(s)[0].length, 1);
});

test("splitting an audio clip keeps its track and moves the offset", () => {
  const s = mk(); addAudioClip(s, 1, 0, 0, 4);
  assert.ok(splitClip(s, 0, 2));
  assert.equal(s.clips[1].track, 1);
  assert.equal(s.clips[1].offset, 2);
  assert.deepEqual(songAudio(s).map((e) => e.offset), [0, 8]);
});

test("deleting a track drops its audio clips and renumbers later ones", () => {
  const s = mk();
  s.tracks.push({ name: "B", instrument: "sampler", key: 60, steps: emptySteps(), notes: [], sample: smp() });
  addAudioClip(s, 1, 0, 0, 1); addAudioClip(s, 2, 1, 0, 1);
  removeTrackEverywhere(s, 1);
  assert.equal(s.clips.length, 1);
  assert.equal(s.clips[0].track, 1);
});

test("cleanClips keeps audio clips for real tracks only", () => {
  const out = cleanClips([{ track: 1, lane: 0, start: 0, length: 2 }, { track: 5 }, { pattern: 0 }, { pattern: 3 }], 1, 2);
  assert.deepEqual(out.map((c) => (c.track != null ? "t" + c.track : "p" + c.pattern)), ["t1", "p0"]);
});

test("format v6 round trip keeps samples and audio clips; a v5 file still opens", () => {
  const s = mk(); s.tracks[1].sample.slices = [2, 4]; addAudioClip(s, 1, 0, 1, 3);
  const back = textToSong(songToText(s));
  assert.deepEqual(back.tracks[1].sample.slices, [2, 4]);
  assert.equal(back.tracks[1].sample.src, "/api/versions/1/audio");
  assert.equal(back.tracks[0].sample, undefined);
  assert.deepEqual(back.clips, [{ track: 1, lane: 0, start: 1, length: 3, offset: 0 }]);
  const old = JSON.parse(songToText(mk())); old.version = 5; delete old.tracks[1].sample;
  assert.equal(textToSong(JSON.stringify(old)).tracks.length, 2);
});

test("peaks gives the loudest sample per stretch", () => {
  assert.deepEqual(peaks(new Float32Array([0, 0.5, -1, 0.25]), 2), [0.5, 1]);
});

test("a one-shot plays the whole sound however short the note, a plain sample follows the note", () => {
  const base = { name: "k", src: "/a", seconds: 1, start: 0, end: 0, root: 60, slices: [] };
  assert.equal(gateFor(base, 0.25), 0.25);
  assert.equal(gateFor({ ...base, oneshot: true }, 0.25), 0);
  assert.equal(gateFor({ ...base, slices: [0.5] }, 0.25), 0);
  assert.equal(cleanSample({ ...base, oneshot: true }).oneshot, true);
  assert.equal(cleanSample({ ...base, oneshot: "yes" }).oneshot, false);
});

import { clipRate, guessBpm, clipPlay } from "../../web/daw/sampler.js";
test("sample tempo: cleaned, rate, guess, play", () => {
  assert.equal(smp().bpm, 0);
  assert.equal(smp().warp, "time");
  assert.equal(smp({ bpm: 90, warp: "pitch" }).warp, "pitch");
  assert.equal(smp({ bpm: 5 }).bpm, 0);
  assert.equal(smp({ bpm: 900 }).bpm, 0);
  assert.equal(clipRate(smp(), 120), 1);
  assert.equal(clipRate(smp({ bpm: 90 }), 120), 120 / 90);
  assert.equal(guessBpm(smp({ seconds: 8 })), 120);
  assert.equal(guessBpm(smp({ seconds: 0 })), 0);
  assert.ok(Math.abs(guessBpm(smp({ seconds: 2.667 })) - 90) < 0.1);
  // 8 s at 90 BPM is 3 bars of 2.667 s; at 120 it is 2.25 bars -> 3 rounded up
  assert.equal(clipBars(smp({ bpm: 90 }), 120), 3);
  assert.equal(clipBars(smp(), 120), 4);
  const ev = { offset: 4, length: 8 };
  assert.deepEqual(clipPlay(smp(), ev, 120), { from: 2, to: 8, rate: 1, ratio: 1 });
  const tape = clipPlay(smp({ bpm: 60, warp: "pitch" }), ev, 120);
  assert.equal(tape.rate, 2); assert.equal(tape.ratio, 1); assert.equal(tape.from, 4);
  const keep = clipPlay(smp({ bpm: 60 }), ev, 120);
  assert.equal(keep.rate, 1); assert.equal(keep.ratio, 2); assert.equal(keep.from, 2); assert.equal(keep.to, 4);
});
test("sample tempo survives save and load", () => {
  const s = mk(); s.tracks[1].sample = smp({ bpm: 96, warp: "pitch" });
  const back = textToSong(songToText(s));
  assert.equal(back.tracks[1].sample.bpm, 96);
  assert.equal(back.tracks[1].sample.warp, "pitch");
});

test("instrument settings: envelope, loop, cut itself, pitch and stretch are kept and clamped", async () => {
  const { cleanSample: clean, sliceFor: slice, ENV } = await import("../../web/daw/sampler.js");
  const s = clean({ src: "/x", seconds: 2, env: { a: 9, d: -1, s: 0.5 }, pitch: 40, stretch: 2, loop: true, cut: true });
  assert.deepEqual(s.env, { a: ENV.a[1], d: 0, s: 0.5, r: ENV.r[2] });
  assert.equal(s.pitch, 24);
  assert.equal(s.stretch, 2);
  assert.equal(s.loop, true);
  assert.equal(s.cut, true);
  assert.equal(clean({ src: "/x", oneshot: true, loop: true }).loop, false, "a one-shot does not loop");
  const old = clean({ src: "/x", seconds: 1 });
  assert.deepEqual([old.pitch, old.stretch, old.loop, old.cut, old.env.s], [0, 1, false, false, 1], "an old sound plays as it did");
  // stretch: positions are in the stretched (twice as long) sound; pitch raises the rate
  const p = slice({ ...s, start: 0.5, end: 1.5 }, 60 + 12);
  assert.deepEqual([p.from, p.to], [1, 3]);
  assert.ok(Math.abs(p.rate - 2 * Math.pow(2, 24 / 12)) < 1e-9);
});
