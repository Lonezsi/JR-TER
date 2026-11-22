// automation.js: knobs that move over time. Pure functions, no DOM, no Web Audio (tests/daw).
//
// song.automation = [ { target, points: [ { beat, value } ] } ]
//   target  which knob, as text:
//             t2.volume  t2.pan  t2.send0  t2.send1       track 2 (counting from 0)
//             t2.fx0.mix                                  the first insert effect of track 2, its "mix"
//             master.volume  master.fx0.PARAM             the master
//             bus0.volume  bus1.fx0.PARAM                 the Reverb (0) and Delay (1) buses
//   points  sorted by beat. beat is absolute on Play's timeline (4 beats a bar); value is in the
//           knob's own units (volume 0..1, pan -1..1, an effect setting in its own range, see FX in mixer.js).
// Between two points the value slides in a straight line; before the first and after the last it holds.
// A lane whose target no longer exists (the effect was removed) is dropped when the song is saved.
import { FX, cleanTrackMix, cleanMixer } from "./mixer.js";

export const MAX_LANES = 32;
export const MAX_POINTS = 256;

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const num = (v, d) => (Number.isFinite(v) ? v : d);

// Parse "t2.fx0.mix" into steps. Returns null when it is not shaped like a target.
function parse(id) {
  if (typeof id !== "string") return null;
  const p = id.split(".");
  let m = /^t(\d+)$/.exec(p[0]);
  let who;
  if (m) who = { kind: "t", i: +m[1] };
  else if (p[0] === "master") who = { kind: "master" };
  else if ((m = /^bus([01])$/.exec(p[0]))) who = { kind: "bus", i: +m[1] };
  else return null;
  if (p.length === 2 && p[1] === "volume") return { who, knob: "volume" };
  if (who.kind === "t" && p.length === 2 && (p[1] === "pan" || p[1] === "send0" || p[1] === "send1")) return { who, knob: p[1] };
  if (p.length === 3 && (m = /^fx(\d+)$/.exec(p[1]))) return { who, knob: "fx", k: +m[1], param: p[2] };
  return null;
}

const fxListOf = (song, who) => {
  if (who.kind === "t") return song.tracks[who.i] ? cleanTrackMix(song.tracks[who.i]).fx : null;
  const mx = cleanMixer(song.mixer);
  return who.kind === "master" ? mx.master.fx : mx.buses[who.i].fx;
};
const whoName = (song, who) => (who.kind === "t" ? (song.tracks[who.i] || {}).name || "Track " + (who.i + 1) : who.kind === "master" ? "Master" : cleanMixer(song.mixer).buses[who.i].name);

// { min, max, label } for a target, or null if it doesn't exist in this song.
export function targetSpec(song, id) {
  const t = parse(id);
  if (!t) return null;
  if (t.who.kind === "t" && !song.tracks[t.who.i]) return null;
  const name = whoName(song, t.who);
  if (t.knob === "volume") return { min: 0, max: 1, label: name + ": Volume" };
  if (t.knob === "pan") return { min: -1, max: 1, label: name + ": Pan" };
  if (t.knob === "send0" || t.knob === "send1") return { min: 0, max: 1, label: name + ": Send to " + cleanMixer(song.mixer).buses[+t.knob[4]].name };
  const fx = (fxListOf(song, t.who) || [])[t.k];
  const spec = fx && FX[fx.type].params[t.param];
  if (!spec) return null;
  return { min: spec[0], max: spec[1], label: name + ": " + FX[fx.type].label + " " + t.param };
}

// Every knob that can be automated in this song.
export function targets(song) {
  const out = [];
  const add = (id) => { const s = targetSpec(song, id); if (s) out.push({ id, ...s }); };
  const fxOf = (prefix, list) => list.forEach((f, k) => { for (const p of Object.keys(FX[f.type].params)) add(prefix + ".fx" + k + "." + p); });
  song.tracks.forEach((t, i) => {
    for (const k of ["volume", "pan", "send0", "send1"]) add("t" + i + "." + k);
    fxOf("t" + i, cleanTrackMix(t).fx);
  });
  add("master.volume"); fxOf("master", fxListOf(song, { kind: "master" }));
  for (const b of [0, 1]) { add("bus" + b + ".volume"); fxOf("bus" + b, fxListOf(song, { kind: "bus", i: b })); }
  return out;
}

export function valueAt(points, beat) {
  if (!points || !points.length) return null;
  if (beat <= points[0].beat) return points[0].value;
  const last = points[points.length - 1];
  if (beat >= last.beat) return last.value;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    if (beat <= b.beat) return b.beat === a.beat ? b.value : a.value + ((b.value - a.value) * (beat - a.beat)) / (b.beat - a.beat);
  }
  return last.value;
}

export function cleanAutomation(list, song) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const lane of list) {
    if (!lane || out.length >= MAX_LANES) continue;
    const spec = targetSpec(song, lane.target);
    if (!spec || out.some((l) => l.target === lane.target)) continue;
    const points = (Array.isArray(lane.points) ? lane.points : [])
      .filter((p) => p && Number.isFinite(p.beat) && Number.isFinite(p.value))
      .map((p) => ({ beat: Math.max(0, p.beat), value: clamp(p.value, spec.min, spec.max) }))
      .sort((a, b) => a.beat - b.beat)
      .slice(0, MAX_POINTS);
    out.push({ target: lane.target, points });
  }
  return out;
}

// A copy of the song's tracks and mixer with every lane's value at `beat` applied. Never touches `song`.
export function automated(song, beat) {
  const tracks = song.tracks.map((t) => ({ ...t, ...cleanTrackMix(t) }));
  const mixer = JSON.parse(JSON.stringify(cleanMixer(song.mixer)));
  for (const lane of song.automation || []) {
    const v = valueAt(lane.points, beat), t = parse(lane.target);
    if (v === null || !t || !targetSpec(song, lane.target)) continue;
    const holder = t.who.kind === "t" ? tracks[t.who.i] : t.who.kind === "master" ? mixer.master : mixer.buses[t.who.i];
    if (t.knob === "volume" || t.knob === "pan") holder[t.knob] = v;
    else if (t.knob === "send0" || t.knob === "send1") holder.sends[+t.knob[4]] = v;
    else if (holder.fx[t.k]) holder.fx[t.k][t.param] = v;
  }
  return { tracks, mixer };
}

// Edits. They keep the points sorted and return the point's new index.
export function addPoint(lane, beat, value) {
  let i = lane.points.findIndex((p) => p.beat > beat);
  if (i < 0) i = lane.points.length;
  lane.points.splice(i, 0, { beat: Math.max(0, beat), value });
  return i;
}
export function movePoint(lane, i, beat, value) {
  const p = lane.points[i];
  if (!p) return i;
  lane.points.splice(i, 1);
  return addPoint(lane, beat, value);
}
export function removePoint(lane, i) { if (lane.points[i]) lane.points.splice(i, 1); }

// Track i was deleted: its lanes go, later tracks' lanes move down one.
export function fixAutomationAfterTrackRemove(song, i) {
  if (!song.automation) return;
  song.automation = song.automation.filter((l) => !l.target.startsWith("t" + i + "."));
  for (const l of song.automation) {
    const m = /^t(\d+)\.(.*)$/.exec(l.target);
    if (m && +m[1] > i) l.target = "t" + (+m[1] - 1) + "." + m[2];
  }
}
