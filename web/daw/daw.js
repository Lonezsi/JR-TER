// daw.js: the DAW page. Tracks on the left, a piano roll on the right, a bar on top.
// The song is plain data (see midi.js); everything here edits that object and redraws.
import { parseMidi, writeMidi, songToText, textToSong, midiToSong } from "./midi.js";
import { classify } from "./gestures.js";
import { createSynth, instrumentFor, INSTRUMENTS } from "./synth.js";
import { mountChords } from "./chordview.js";
import { mountScripts } from "./scriptview.js";
import { DEFAULT_PROGRESSION } from "./chords.js";
import { run as runScript, defaultScripts } from "./script.js";
import { mountRack } from "./rackview.js";
import { mountSong } from "./songview.js";
import { songNotes, songBars } from "./playlist.js";
import { createMixer } from "./mixgraph.js";
import { mountSampler } from "./samplerview.js";
import { sliceFor, playSlice, songAudio, sampleEnd, chop, gateFor } from "./sampler.js";
import { mountMixer } from "./mixerview.js";
import { automated, addPoint as autoAdd } from "./automation.js";
import { encodeWav, bounceSeconds } from "./bounce.js";
import { startTogether, apiPrefix } from "./together.js";
import { ROLL_STEPS, stepFor, autoStep, snapFloor, snapRound, snapOptions, loadSnap, saveSnap } from "./snap.js";
import { emptySteps, allNotes, usePattern, addPattern, removePattern, removeTrackEverywhere } from "./pattern.js";

const $ = (id) => document.getElementById(id);
const songId = new URLSearchParams(location.search).get("song"); // /daw.html?song=ID: this library song's own project
const shareId = new URLSearchParams(location.search).get("share"); // &share=ID: a friend working on the owner's song through that share
const API = apiPrefix(shareId);
let together = null, people = [], myBeat = null;
const KEY = songId ? "jriter-daw:song:" + songId : "jriter-daw";
const COARSE = matchMedia("(pointer: coarse)").matches;
const snapSet = loadSnap(localStorage); // { roll, song }: "auto" follows the zoom (snap.js)
// How far notes snap, in beats (0 = not at all). Auto: the finest step still wide enough to hit.
const step = () => stepFor(snapSet.roll, pxBeat(), COARSE ? 22 : 14, ROLL_STEPS);
const minLen = () => step() || 1 / 16;
let ROW = 14;
const GUTTER = 44;
const NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

let song = loadSaved() || defaultSong();
let sel = 0, selNote = null;
let lastLen = matchMedia("(pointer: coarse)").matches ? 0.5 : 0.25; // a thumb can grab an eighth
let zoom = 1, scrollX = 0, scrollY = 0;
let undo = [];
let looping = true, playing = false, tool = "draw", wakeLock = null;
const VIEWS = ["chords", "rack", "roll", "script", "song", "mixer", "sampler"];
let view = "chords"; // the DAW always opens on the chord editor
let ctx = null, synth = null, mix = null;
let t0 = 0, scheduled = 0, timer = 0, raf = 0, songCache = null, audioCache = null, lastAudition = null;

function defaultSong() {
  const notes = [];
  [60, 64, 67, 72, 67, 64, 60, 64].forEach((p, i) => notes.push({ pitch: p, start: i * 0.5, length: 0.5, velocity: 90 }));
  [60, 64, 67, 72, 67, 64, 60, 64].forEach((p, i) => notes.push({ pitch: p, start: 4 + i * 0.5, length: 0.5, velocity: 90 }));
  return { bpm: 120, bars: 4, swing: 0, pattern: 0, mode: "pattern", clips: [], automation: [], patterns: [{ name: "Pattern 1", tracks: [] }], chords: JSON.parse(JSON.stringify(DEFAULT_PROGRESSION)), scripts: defaultScripts(),
    tracks: [{ name: "Piano", instrument: "piano", key: 60, steps: emptySteps(), volume: 0.8, mute: false, solo: false, notes }] };
}
function loadSaved() {
  try { const t = localStorage.getItem(KEY); return t ? textToSong(t) : null; } catch { return null; }
}
function save() { try { localStorage.setItem(KEY, songToText(song)); } catch { /* storage full or off: the file buttons still work */ } if (together) together.saved(); }

// ---- undo: snapshots of the song text -------------------------------------------------
const snap = () => songToText(song);
function pushUndo(before) { undo.push(before); if (undo.length > 50) undo.shift(); }
function doUndo() {
  const s = undo.pop();
  if (!s) return;
  song = textToSong(s); sel = Math.min(sel, song.tracks.length - 1); selNote = null;
  changed(true);
}
function edit(fn) { const before = snap(); fn(); pushUndo(before); changed(); }

function changed(rebuildTracks = true) {
  save();
  if (rebuildTracks) renderTracks();
  renderBar();
  syncGains();
  draw();
  refreshView();
}

function toast(text, action) {
  const el = document.createElement("div");
  el.className = "toast";
  el.append(text);
  if (action) {
    const b = document.createElement("button");
    b.textContent = action.label;
    b.onclick = () => { action.run(); el.remove(); };
    el.append(b);
  }
  el.addEventListener("click", (e) => { if (e.target === el) el.remove(); }); // tap a message to dismiss it
  $("toasts").append(el);
  while ($("toasts").children.length > 3) $("toasts").firstChild.remove();
  setTimeout(() => el.remove(), action ? 6000 : 3500);
}

// ---- the top bar ------------------------------------------------------------------------
const ICONS = { play: "▶", stop: "■", loop: "↻", open: "↑", mid: "♪", json: "{ }", add: "+", undo: "↶" };
function btn(id, icon, tip, pressed, label) {
  const inner = label ? `<span class="ic">${icon}</span><span class="lb">${label}</span>` : icon;
  return `<button id="${id}" data-tip="${tip}" aria-label="${tip}"${pressed === undefined ? "" : ` aria-pressed="${pressed}"`}>${inner}</button>`;
}
function renderBar() {
  const bar = $("bar");
  if (bar.dataset.built) {
    $("play").querySelector(".ic").textContent = playing ? ICONS.stop : ICONS.play;
    $("play").querySelector(".lb").textContent = playing ? "Stop" : "Play";
    $("play").setAttribute("aria-label", playing ? "Stop" : "Play");
    $("play").dataset.tip = playing ? "Stop (Space)" : "Play (Space)";
    $("loop").setAttribute("aria-pressed", looping);
    $("mode").setAttribute("aria-pressed", song.mode === "song");
    for (const t of ["draw", "erase", "select"]) $("tool-" + t).setAttribute("aria-pressed", tool === t);
    $("bpm").value = song.bpm; $("bars").value = song.bars;
    $("pat").innerHTML = (song.patterns || []).map((p, i) => `<option value="${i}"${i === song.pattern ? " selected" : ""}>${i + 1}. ${p.name.replace(/[&<>"]/g, "")}</option>`).join("");
    return;
  }
  bar.dataset.built = "1";
  bar.innerHTML = `<div class="transport">` + btn("home", "⌂", "Back to the library", undefined, "Library") +
    btn("play", ICONS.play, "Play (Space)", undefined, "Play") + btn("loop", ICONS.loop, "Loop (L)", looping, "Loop") + btn("mode", "☰", "Play the whole song, or just this pattern (S)", song.mode === "song", "Song") +
    `<span class="sep"></span>` +
    btn("tool-draw", "✎", "Draw notes (P)", true, "Draw") + btn("tool-erase", "⌫", "Erase notes (E)", false, "Erase") +
    btn("tool-select", "⌖", "Select only (V)", false, "Select") +
    btn("help", "?", "How it works (?)", false, "Help") + btn("more", "⋯", "More", false, "More") + `<span class="people" id="people"></span></div><div class="more" id="morebox"><span class="name">DAW</span>` +
    `<label>BPM <input id="bpm" type="number" min="20" max="300" step="1"></label>` +
    `<label>Bars <input id="bars" type="number" min="1" max="64" step="1"></label>` +
    `<label>Pattern <select id="pat" aria-label="Pattern"></select></label>` +
    `<label>Snap <select id="snap" aria-label="Snap"></select></label>` +
    `<span class="sep"></span>` +
    btn("add", ICONS.add, "New track (N)") + btn("undo", ICONS.undo, "Undo (Ctrl+Z)") +
    `<span class="sep"></span>` +
    btn("open", ICONS.open, "Open a .mid or .json song") + btn("savemid", ICONS.mid, "Save as .mid") +
    btn("savejson", ICONS.json, "Save as .json text") +
    btn("bounce", "⤓", "Bounce to audio: a new version of the song (B)") +
    (songId && !shareId ? `<span class="sep"></span><span class="friends" id="friends"></span>` : "") + `</div>`;
  if (songId && !shareId) loadFriends();
  for (const t of ["draw", "erase", "select"]) $("tool-" + t).onclick = () => setTool(t);
  $("more").onclick = () => setMore(!bar.classList.contains("open"));
  $("help").onclick = () => setHelp($("helpbox").hidden);
  $("home").onclick = () => location.assign(songId ? "/#/song/" + songId : "/");
  $("play").onclick = () => togglePlay();
  $("loop").onclick = () => { looping = !looping; renderBar(); };
  $("mode").onclick = () => setMode(song.mode === "song" ? "pattern" : "song");
  $("bpm").onchange = (e) => { edit(() => { song.bpm = clamp(+e.target.value || 120, 20, 300); }); if (playing) play(curBeat() % loopLen()); };
  $("bars").onchange = (e) => edit(() => { song.bars = clamp(Math.round(+e.target.value) || 4, 1, 64); });
  $("pat").onchange = (e) => switchPattern(+e.target.value);
  $("snap").onchange = (e) => { snapSet.roll = e.target.value; saveSnap(localStorage, { roll: snapSet.roll }); draw(); showSnap(); };
  showSnap();
  $("add").onclick = addTrack;
  $("undo").onclick = doUndo;
  $("open").onclick = () => $("file").click();
  $("savemid").onclick = () => { const all = song.mode === "song" && (song.clips || []).length ? songNotes(song) : null; download("song.mid", writeMidi({ ...song, tracks: song.tracks.map((t, i) => ({ ...t, notes: all ? all[i] : allNotes(t, song) })) }), "audio/midi"); };
  $("bounce").onclick = bounce;
  $("savejson").onclick = () => download("song.json", songToText(song), "application/json");
  renderBar();
}
const toldTool = new Set();
const TOOL_TIPS = {
  draw: "Draw: tap a square to add a note.",
  erase: "Erase: tap a note to delete it.",
  select: "Select: tap a note to pick it; nothing gets added.",
};
function setTool(t) {
  tool = t; renderBar();
  if (!toldTool.has(t)) { toldTool.add(t); toast(TOOL_TIPS[t]); }
}
function setMore(open) {
  $("bar").classList.toggle("open", open);
  $("more").setAttribute("aria-pressed", open);
  if (open) setHelp(false);
}

// The Snap box says what Auto is right now, and keeps up with the zoom.
function showSnap() {
  const el = $("snap");
  if (el) el.innerHTML = snapOptions(ROLL_STEPS, snapSet.roll, step());
}

// ---- the help sheet: one list, so the words live in one place ------------------------------
const HELP = [
  ["＋", "Tap an empty square to add a note.", "click"],
  ["↔", "Drag a note to move it. Drag its right end to make it longer.", "drag"],
  ["⌫", "Hold a note to delete it. Undo brings it back.", "right-click, or Delete"],
  ["⋮", "Snap follows the zoom: zoom in and notes snap finer. Pick a fixed one under More, Snap.", "More"],
  ["✥", "Drag empty space to scroll. Pinch with two fingers to zoom.", "wheel; Ctrl+wheel; + and -"],
  ["♪", "Tap a key on the left to hear it.", "click"],
  ["✎", "Draw adds notes, Erase removes them, Select only picks them.", "P, E, V"],
  ["▶", "Play runs the loop. Loop turns repeating on and off.", "Space, L"],
  ["⋯", "More: tempo, bars, new track, open and save .mid or .json.", "N, Ctrl+Z"],
  ["⤓", "Bounce: render the song to audio and save it as a new version of the library song (or a waiting render when opened without one).", "B"],
  ["▤", "Tracks are the cards above the roll: tap one to edit it. M mutes, S solos.", "J, K"],
  ["♫", "Chords: pick a root and a type, or type a progression. Arrows and drops change the voicing. To MIDI makes notes, one way.", "Alt+1"],
  ["▦", "Rack: tap steps to light them, drag one up or down for its velocity or pitch. Patterns 1, 2, 3 at the top; Swing loosens the groove.", "Alt+2, [ and ]"],
  ["☰", "Song: tap a lane to place a pattern, drag to move, drag the end to repeat, hold to delete. Song or Pattern decides what Play plays. Automate draws a knob's moves over time under the clips.", "Alt+5, S"],
  ["◫", "Mixer: a strip per track with pan, sends and effects; the master has a limiter. Meters move while playing.", "Alt+6"],
  ["〰", "Sampler: add a take, vocal or render from your library with +, drag its ends to trim, Chop cuts it into pieces that play up the keys. Place puts it on the Song tab as a clip.", "Alt+7"],
  ["ƒ", "Script: pick one, set its sliders, Run on the track. Humanize and arpeggios come with it; edit or write your own.", "Alt+4"],
];
function renderHelp() {
  const box = $("helpbox");
  box.innerHTML = `<div class="helphead"><strong>How it works<small id="verstamp"></small></strong><button id="helpx" aria-label="Close help">×</button></div>` +
    HELP.map(([ic, text, desk]) => `<div class="helprow"><span class="ic">${ic}</span><span>${text} <span class="desk">(${desk})</span></span></div>`).join("");
  $("helpx").onclick = () => setHelp(false);
}
function setHelp(open) {
  $("helpbox").hidden = !open;
  $("help").setAttribute("aria-pressed", open);
  if (open) setMore(false);
}
addEventListener("pointerdown", (e) => {
  if (!$("helpbox").hidden && !e.target.closest("#helpbox, #help")) setHelp(false);
});
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
function download(name, data, type) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([data], { type }));
  a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ---- the track list ---------------------------------------------------------------------
function addTrack() {
  edit(() => {
    song.tracks.push({ name: "Track " + (song.tracks.length + 1), instrument: "piano", key: 60, steps: emptySteps(), volume: 0.8, mute: false, solo: false, notes: [] });
    sel = song.tracks.length - 1; selNote = null;
  });
}
function renderTracks() {
  const box = $("tracks");
  box.textContent = "";
  song.tracks.forEach((t, i) => {
    const el = document.createElement("div");
    el.className = "track" + (i === sel ? " sel" : "");
    el.innerHTML = `<div class="row"><input type="text" aria-label="Track name"><button data-a="del" data-tip="Delete track" aria-label="Delete track">×</button></div>
      <div class="row"><select aria-label="Instrument">${[...INSTRUMENTS, "sampler"].map((n) => `<option${n === t.instrument ? " selected" : ""}>${n}</option>`).join("")}</select>
      <button data-a="mute" data-tip="Mute" aria-label="Mute" aria-pressed="${!!t.mute}">M</button>
      <button data-a="solo" data-tip="Solo" aria-label="Solo" aria-pressed="${!!t.solo}">S</button></div>
      <div class="row"><input type="range" min="0" max="1" step="0.01" aria-label="Volume" value="${t.volume}"></div>`;
    const name = el.querySelector("input[type=text]");
    name.value = t.name;
    name.oninput = () => { t.name = name.value; save(); };
    name.onchange = () => { const b = snap(); pushUndo(b); };
    el.querySelector("select").onchange = (e) => {
      edit(() => { t.instrument = e.target.value; });
      if (t.instrument === "sampler" && !t.sample) { sel = i; samplerUI.show("oneshots"); setView("sampler"); toast("Pick a sound for this track: + Inst puts it here."); }
    };
    el.querySelector("[data-a=mute]").onclick = () => edit(() => { t.mute = !t.mute; });
    el.querySelector("[data-a=solo]").onclick = () => edit(() => { t.solo = !t.solo; });
    el.querySelector("[data-a=del]").onclick = (e) => { e.stopPropagation(); removeTrack(i); };
    const vol = el.querySelector("input[type=range]");
    vol.oninput = () => { t.volume = +vol.value; syncGains(); save(); };
    el.addEventListener("pointerdown", (e) => { if (sel !== i && !e.target.closest("input,select,button")) { sel = i; selNote = null; renderTracks(); draw(); } });
    box.append(el);
  });
}
function removeTrack(i) {
  const before = snap();
  removeTrackEverywhere(song, i);
  sel = Math.max(0, Math.min(sel, song.tracks.length - 1)); selNote = null;
  changed();
  toast("Track deleted.", { label: "Undo", run: () => { song = textToSong(before); sel = Math.min(i, song.tracks.length - 1); changed(); } });
}

// ---- the piano roll ---------------------------------------------------------------------
const cv = $("roll"), g = cv.getContext("2d");
let W = 0, H = 0;
const pxBeat = () => 64 * zoom;
const loopLen = () => song.bars * 4;
const inSong = () => song.mode === "song" && (song.clips || []).length > 0;
const playLen = () => (inSong() ? songBars(song) * 4 : loopLen());
function range() {
  let lo = 36, hi = 96;
  for (const t of song.tracks) for (const n of t.notes) { lo = Math.min(lo, n.pitch - 2); hi = Math.max(hi, n.pitch + 2); }
  return [clamp(lo, 0, 127), clamp(hi, 0, 127)];
}
function resize() {
  const r = cv.getBoundingClientRect(), d = devicePixelRatio || 1;
  W = r.width; H = r.height;
  ROW = matchMedia("(pointer: coarse)").matches ? 24 : 14; // fingers need taller rows
  cv.width = Math.max(1, Math.round(W * d)); cv.height = Math.max(1, Math.round(H * d));
  g.setTransform(d, 0, 0, d, 0, 0);
  clampScroll(); draw();
}
function clampScroll() {
  const [lo, hi] = range();
  scrollX = clamp(scrollX, 0, Math.max(0, loopLen() * pxBeat() - (W - GUTTER)));
  scrollY = clamp(scrollY, 0, Math.max(0, (hi - lo + 1) * ROW - H));
}
const cssv = (n, d) => getComputedStyle(document.documentElement).getPropertyValue(n).trim() || d;
function draw() {
  if (!W) return;
  clampScroll();
  const [lo, hi] = range(), pb = pxBeat();
  const fg = cssv("--d-fg", "#fff"), acc = cssv("--d-acc", "#FAA8B8"), grid = cssv("--d-grid", "#333"), bar = cssv("--d-bar", "#666");
  const blk = cssv("--d-black", "#0003"), mute = cssv("--d-mute", "#888");
  g.clearRect(0, 0, W, H);
  const y = (p) => (hi - p) * ROW - scrollY, x = (b) => GUTTER + b * pb - scrollX;
  g.font = "10px system-ui, sans-serif"; g.textBaseline = "middle";
  for (let p = hi; p >= lo; p--) {
    const yy = y(p);
    if (yy > H || yy + ROW < 0) continue;
    const black = [1, 3, 6, 8, 10].includes(p % 12);
    if (black) { g.fillStyle = blk; g.fillRect(GUTTER, yy, W - GUTTER, ROW); }
    g.fillStyle = grid; g.fillRect(GUTTER, yy + ROW - 1, W - GUTTER, 1);
  }
  const total = loopLen();
  let ls = step() || autoStep(pb, 14, ROLL_STEPS); // grid lines at the snap, never closer than 6px
  while (ls * pb < 6) ls *= 2;
  for (let i = 0; i * ls <= total + 1e-9; i++) {
    const b = i * ls, xx = x(b);
    if (xx < GUTTER - 1 || xx > W) continue;
    const isBar = Math.abs(b / 4 - Math.round(b / 4)) < 1e-6, isBeat = Math.abs(b - Math.round(b)) < 1e-6;
    g.fillStyle = isBar ? bar : grid;
    g.fillRect(Math.round(xx), 0, 1, H);
    if (isBar && b < total) { g.fillStyle = mute; g.fillText(String(b / 4 + 1), xx + 4, 8); }
  }
  g.fillStyle = "rgba(0,0,0,0.25)"; g.fillRect(x(total), 0, W, H);
  song.tracks.forEach((t, ti) => {
    const here = ti === sel;
    for (const n of t.notes) {
      const xx = x(n.start), ww = Math.max(3, n.length * pb), yy = y(n.pitch);
      if (xx + ww < GUTTER || xx > W || yy + ROW < 0 || yy > H) continue;
      g.globalAlpha = here ? 0.4 + 0.6 * (n.velocity / 127) : 0.18;
      g.fillStyle = here ? acc : fg;
      g.fillRect(Math.max(xx, GUTTER), yy + 1, ww - (Math.max(xx, GUTTER) - xx) - 1, ROW - 2);
      if (here && n === selNote) { g.globalAlpha = 1; g.strokeStyle = fg; g.strokeRect(Math.max(xx, GUTTER) + 0.5, yy + 1.5, ww - 2, ROW - 3); }
    }
  });
  g.globalAlpha = 1;
  if (playing) {
    const px = x(curBeat() % total);
    g.fillStyle = acc; g.fillRect(Math.round(px), 0, 2, H);
  }
  for (const p of people) {
    const c = p.cursor || {};
    if (c.tab !== "roll" || typeof c.beat !== "number") continue;
    const px = Math.round(x(c.beat));
    if (px < GUTTER || px > W) continue;
    g.globalAlpha = 1; g.fillStyle = `hsl(${p.hue} 70% 60%)`; g.fillRect(px, 0, 2, H);
    g.font = "11px system-ui, sans-serif"; g.textAlign = "left"; g.fillText(p.name, px + 4, 12);
  }
  const cur = song.tracks[sel];
  if (cur && !cur.notes.length && !playing) {
    g.globalAlpha = 0.8; g.fillStyle = mute; g.font = "13px system-ui, sans-serif"; g.textAlign = "center";
    g.fillText(matchMedia("(pointer: coarse)").matches ? "Tap a square to add a note" : "Click a square to add a note", GUTTER + (W - GUTTER) / 2, H / 2);
    g.textAlign = "left"; g.globalAlpha = 1; g.font = "10px system-ui, sans-serif";
  }
  g.clearRect(0, 0, GUTTER, H);
  for (let p = hi; p >= lo; p--) {
    const yy = y(p);
    if (yy > H || yy + ROW < 0) continue;
    const black = [1, 3, 6, 8, 10].includes(p % 12);
    g.fillStyle = black ? blk : grid; g.fillRect(0, yy, GUTTER, ROW - 1);
    if (p % 12 === 0 || p % 12 === 7) { g.fillStyle = mute; g.fillText(NAMES[p % 12] + (Math.floor(p / 12) - 1), 6, yy + ROW / 2); }
  }
}

function cell(e) {
  const r = cv.getBoundingClientRect(), [lo, hi] = range();
  const beat = (e.clientX - r.left - GUTTER + scrollX) / pxBeat();
  const pitch = hi - Math.floor((e.clientY - r.top + scrollY) / ROW);
  return { beat, pitch: clamp(pitch, lo, hi) };
}
function hit(c) {
  const t = song.tracks[sel];
  if (!t) return null;
  for (let i = t.notes.length - 1; i >= 0; i--) {
    const n = t.notes[i];
    if (n.pitch === c.pitch && c.beat >= n.start && c.beat <= n.start + n.length) return n;
  }
  return null;
}
let drag = null;
function removeNote(n) {
  edit(() => { const t = song.tracks[sel]; t.notes.splice(t.notes.indexOf(n), 1); if (selNote === n) selNote = null; });
}
function addNoteAt(c) {
  const start = Math.max(0, snapFloor(c.beat, step()));
  if (start >= loopLen()) return null;
  const n = { pitch: c.pitch, start, length: Math.max(lastLen, minLen()), velocity: 90 };
  edit(() => { song.tracks[sel].notes.push(n); });
  return n;
}
// The right end of a note resizes it, the rest moves it. The end is at most the last 40% of the
// note: a sixteenth is only 16px wide, and a fixed 16px "fat finger" end used to be the whole
// note, so dragging a note on a phone could only ever resize it.
const onEdge = (n, c, fat) => (n.start + n.length - c.beat) * pxBeat() < Math.min(fat ? 18 : 6, 0.4 * n.length * pxBeat());
const inGutter = (e) => e.clientX - cv.getBoundingClientRect().left < GUTTER;
function keyPreview(e) {
  const t = song.tracks[sel];
  if (t) preview(t, { pitch: cell(e).pitch, velocity: 90 });
}
function beginDrag(n, mode, c) {
  drag = { n, mode, before: snap(), c0: c, start0: n.start };
  draw();
}

// Mouse: press to add or grab, drag to move or resize, right-click to delete.
function mouseDown(e) {
  if (e.button !== 0 || !song.tracks[sel]) return;
  if (inGutter(e)) return keyPreview(e);
  const c = cell(e), t = song.tracks[sel];
  let n = hit(c);
  if (tool === "erase") { if (n) removeNote(n); return; }
  if (!n) {
    if (tool === "select") { selNote = null; draw(); return; }
    const start = Math.max(0, snapFloor(c.beat, step()));
    if (start >= loopLen()) return;
    const before = snap();
    n = { pitch: c.pitch, start, length: Math.max(lastLen, minLen()), velocity: 90 };
    t.notes.push(n);
    selNote = n; preview(t, n);
    drag = { n, mode: "move", before, c0: c, start0: n.start };
  } else {
    selNote = n; preview(t, n);
    beginDrag(n, onEdge(n, c, false) ? "resize" : "move", c);
  }
  cv.setPointerCapture(e.pointerId);
  draw();
}
function dragTo(e) {
  const c = cell(e), n = drag.n;
  if (drag.mode === "move") {
    const ns = Math.max(0, snapRound(drag.start0 + (c.beat - drag.c0.beat), step()));
    if (n.pitch !== c.pitch) preview(song.tracks[sel], { ...n, pitch: c.pitch });
    n.start = Math.min(ns, loopLen() - minLen()); n.pitch = c.pitch;
  } else {
    n.length = Math.max(minLen(), snapRound(c.beat - n.start, step()));
    lastLen = n.length;
  }
  draw();
}
const endDrag = () => {
  if (!drag) return;
  if (drag.mode === "move") lastLen = drag.n.length;
  if (snap() !== drag.before) { pushUndo(drag.before); save(); renderBar(); }
  drag = null; draw();
};

// Touch: tap, drag, long press and pinch, told apart by gestures.js.
// One finger on a note moves or resizes it; on empty space it pans; a long press deletes;
// two fingers zoom and pan.
const fingers = new Set();
let gs = [], touch = null, pinch = null, longTimer = 0;
const sample = (e, type) => gs.push({ id: e.pointerId, x: e.clientX, y: e.clientY, t: e.timeStamp, type });
function touchEnd() { clearTimeout(longTimer); touch = null; pinch = null; gs = []; }
function touchDown(e) {
  if (!song.tracks[sel]) return;
  if (!fingers.size) gs = [];
  fingers.add(e.pointerId); sample(e, "down");
  cv.setPointerCapture(e.pointerId);
  if (fingers.size >= 2) {
    clearTimeout(longTimer);
    if (drag) return; // already dragging a note: leave it be
    touch = null; pinch = { zoom0: zoom, sx0: scrollX, sy0: scrollY, beat0: null };
    return;
  }
  if (inGutter(e)) { keyPreview(e); touch = null; return; }
  const c = cell(e);
  touch = { c, n: hit(c), x0: scrollX, y0: scrollY, started: false, done: false };
  longTimer = setTimeout(() => {
    if (!touch || touch.started || !touch.n || classify(gs, performance.now()).kind !== "long") return;
    touch.done = true;
    navigator.vibrate?.(12);
    removeNote(touch.n);
    toast("Note deleted.", { label: "Undo", run: doUndo });
  }, 460);
}
function touchMove(e) {
  if (!fingers.has(e.pointerId)) return;
  sample(e, "move");
  if (pinch) {
    const k = classify(gs);
    if (k.kind !== "pinch") return;
    const r = cv.getBoundingClientRect();
    if (pinch.beat0 === null) pinch.beat0 = (k.x - k.dx - r.left - GUTTER + pinch.sx0) / pxBeat();
    zoom = clamp(pinch.zoom0 * k.scale, 0.25, 4);
    scrollX = pinch.beat0 * pxBeat() - (k.x - r.left - GUTTER);
    scrollY = pinch.sy0 - k.dy;
    draw(); showSnap(); return;
  }
  if (!touch || touch.done) return;
  const k = classify(gs);
  if (k.kind !== "drag") return;
  if (!touch.started) {
    touch.started = true; clearTimeout(longTimer);
    if (touch.n && tool !== "erase") {
      selNote = touch.n;
      beginDrag(touch.n, onEdge(touch.n, touch.c, true) ? "resize" : "move", touch.c);
    }
  }
  if (drag) dragTo(e);
  else { scrollX = touch.x0 - k.dx; scrollY = touch.y0 - k.dy; draw(); }
}
function touchUp(e, cancelled) {
  if (!fingers.delete(e.pointerId)) return;
  sample(e, cancelled ? "cancel" : "up");
  if (pinch) { if (!fingers.size) touchEnd(); return; }
  const t = touch;
  endDrag();
  if (t && !t.done && !t.started && classify(gs).kind === "tap") {
    const n = t.n, tr = song.tracks[sel];
    if (tool === "erase") { if (n) removeNote(n); }
    else if (n) { selNote = n; preview(tr, n); draw(); }
    else if (tool === "draw") { const m = addNoteAt(t.c); if (m) { selNote = m; preview(tr, m); draw(); } }
  }
  touchEnd();
}

cv.addEventListener("pointerdown", (e) => { cv.focus(); if (e.pointerType === "mouse") mouseDown(e); else touchDown(e); });
cv.addEventListener("pointermove", (e) => { myBeat = Math.round(cell(e).beat * 4) / 4;
   if (e.pointerType !== "mouse") touchMove(e); else if (drag) dragTo(e); });
cv.addEventListener("pointerup", (e) => { if (e.pointerType === "mouse") endDrag(); else touchUp(e, false); });
cv.addEventListener("pointercancel", (e) => { if (e.pointerType === "mouse") endDrag(); else touchUp(e, true); });
cv.addEventListener("contextmenu", (e) => {
  e.preventDefault();
  if (e.pointerType && e.pointerType !== "mouse") return; // a long press is handled above
  const n = hit(cell(e));
  if (n) removeNote(n);
});
cv.addEventListener("wheel", (e) => {
  e.preventDefault();
  if (e.ctrlKey) { setZoom(zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15)); return; }
  if (e.shiftKey) scrollX += e.deltaY; else { scrollY += e.deltaY; scrollX += e.deltaX; }
  draw();
}, { passive: false });
function setZoom(z) { zoom = clamp(z, 0.25, 4); draw(); showSnap(); }

// ---- sound ------------------------------------------------------------------------------
function audio() {
  if (ctx) { if (ctx.state === "suspended") ctx.resume(); return; }
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  synth = createSynth(ctx);
  mix = createMixer(ctx);
}
function syncGains() {
  if (!ctx) return;
  mix.sync(song);

}
// Sounds from the library, decoded once each. bufferOf waits; bufferNow never does (it starts
// the load and answers null, so a note that arrives early is skipped instead of late).
const buffers = new Map();
let toldBad = false;
function bufferOf(src) {
  audio();
  let b = buffers.get(src);
  if (!b) {
    b = { buf: null, promise: null };
    b.promise = fetch(src, { credentials: "include" })
      .then((r) => { if (!r.ok) throw new Error("The library said " + r.status + "."); return r.arrayBuffer(); })
      .then((a) => ctx.decodeAudioData(a))
      .then((x) => { b.buf = x; return x; })
      .catch((e) => { buffers.delete(src); if (!toldBad) { toldBad = true; toast("Could not load a sound: " + (e.message || "unreadable audio")); setTimeout(() => { toldBad = false; }, 4000); } throw e; });
    buffers.set(src, b);
  }
  return b.promise;
}
function bufferNow(src) {
  const b = buffers.get(src);
  if (b) return b.buf;
  bufferOf(src).catch(() => {});
  return null;
}
// One note on one track: a sampler plays its sound (chopped pieces play to their end, pitched
// ones are gated by the note), every other instrument goes to the synth.
function voice(t, n, time, len, dest) { voiceOn(ctx, synth, bufferNow, t, n, time, len, dest); }
function voiceOn(c, syn, getBuf, t, n, time, len, dest) {
  if (t.instrument === "sampler" && t.sample) {
    const buf = getBuf(t.sample.src), sl = sliceFor(t.sample, n.pitch);
    if (buf && sl) playSlice(c, buf, sl, time, gateFor(t.sample, len), n.velocity, dest);
    return;
  }
  if (t.instrument === "sampler") return; // no sound picked yet: nothing to play
  syn.playNote({ instrument: t.instrument, pitch: n.pitch, time, length: len, velocity: n.velocity }, dest);
}
// ---- bounce: render the song offline to a .wav and keep it ---------------------------------
let bouncing = false;
async function bounce() {
  if (bouncing) return;
  bouncing = true; stop(); setMore(false); toast("Bouncing…");
  try {
    const beats = playLen(), spb = 60 / song.bpm, secs = bounceSeconds(beats, song.bpm);
    const off = new OfflineAudioContext(2, Math.ceil(secs * 44100), 44100);
    const syn = createSynth(off), m = createMixer(off);
    m.sync(song);
    await Promise.all(song.tracks.filter((t) => t.sample).map((t) => bufferOf(t.sample.src).catch(() => null)));
    const getBuf = (src) => (buffers.get(src) || {}).buf || null;
    const all = inSong() ? songNotes(song) : null;
    song.tracks.forEach((t, i) => {
      for (const n of all ? all[i] || [] : allNotes(t, song)) {
        if (n.start >= beats) continue;
        voiceOn(off, syn, getBuf, t, n, n.start * spb, Math.min(n.length, beats - n.start) * spb, m.input(i));
      }
    });
    if (inSong()) for (const ev of songAudio(song)) {
      const t = song.tracks[ev.track], buf = t && t.sample ? getBuf(t.sample.src) : null;
      if (buf && ev.start < beats) playSlice(off, buf, { from: t.sample.start + ev.offset * spb, to: sampleEnd(t.sample), rate: 1 }, ev.start * spb, ev.length * spb, 100, m.input(ev.track));
    }
    if ((song.automation || []).length && typeof off.suspend === "function") {
      try {
        for (let b = 0.25; b < beats; b += 0.25) {
          off.suspend(b * spb).then(() => { m.sync({ ...song, ...automated(song, b) }); off.resume(); });
        }
      } catch { /* renders without automation */ }
    }
    const out = await off.startRendering();
    const bytes = encodeWav([out.getChannelData(0), out.getChannelData(1)], 44100);
    let saved = false;
    try {
      const r = await fetch(songId ? `${API}/songs/${encodeURIComponent(songId)}/versions` : "/api/renders", {
        method: "POST", credentials: "include", body: bytes,
        headers: songId ? { "X-Filename": "daw-bounce.wav", "X-Label": "DAW bounce", "X-Duration": String(secs) } : { "X-Filename": "daw-bounce.wav", "X-Origin": "daw" } });
      if (r.ok) {
        const j = await r.json().catch(() => ({}));
        saved = true;
        if (songId) toast(j.duplicate ? (j.message || "Nothing new to add.") : "Saved as v" + (j.version ? j.version.n : "?") + " of the song.", { label: "Open", run: () => location.assign("/#/song/" + songId + "/takes") });
        else toast("Bounced. It waits in Renders for a song.");
      }
    } catch { /* falls through to the download */ }
    if (!saved) { download("daw-bounce.wav", bytes, "audio/wav"); toast("Could not save it to the library, so it downloaded instead."); }
  } catch (err) { toast(err.message || "Could not bounce."); }
  bouncing = false;
}
function preview(t, n) {
  audio(); syncGains();
  const i = song.tracks.indexOf(t);
  voice(t, n, ctx.currentTime, 0.3, mix.input(i));
}
function hearLibrary(src) {
  audio(); syncGains();
  bufferOf(src).then((buf) => {
    try { lastAudition?.stop(); } catch { /* already over */ }
    lastAudition = playSlice(ctx, buf, { from: 0, to: 4, rate: 1 }, ctx.currentTime + 0.02, 0, 100, mix.master());
  }).catch(() => {});
}
function audition(t, from, to) {
  audio(); syncGains();
  const i = song.tracks.indexOf(t);
  bufferOf(t.sample.src).then((buf) => {
    try { lastAudition?.stop(); } catch { /* already over */ }
    lastAudition = playSlice(ctx, buf, { from, to, rate: 1 }, ctx.currentTime + 0.02, 0, 100, mix.input(i));
  }).catch(() => {});
}
let pendingRack = false; // set by + Sample in the rack: the next sound added becomes a rack channel
function addSampler(sound, opts = {}) {
  const rack = !!opts.rack || pendingRack, one = sound.kind === "oneshot";
  const sample = { name: sound.name, src: sound.src, seconds: sound.seconds || 0, start: 0, end: 0, root: 60, slices: [], oneshot: one };
  const empty = song.tracks[sel] && song.tracks[sel].instrument === "sampler" && !song.tracks[sel].sample;
  pendingRack = false;
  edit(() => {
    if (empty) { const t = song.tracks[sel]; t.sample = sample; t.name = sound.name; selNote = null; return; }
    song.tracks.push({ name: sound.name, instrument: "sampler", key: 60, steps: emptySteps(), volume: 0.8, mute: false, solo: false, notes: [], sample });
    sel = song.tracks.length - 1; selNote = null;
  });
  if (rack) { setView("rack"); toast("Added " + sound.name + " to the rack. Tap steps to play it.", { label: "Undo", run: doUndo }); return loadDuration(sound); }
  loadDuration(sound);
  toast("Added " + sound.name + ". Draw notes for it, or place it on the Song tab.", { label: "Undo", run: doUndo });
}
function loadDuration(sound) {
  bufferOf(sound.src).then((buf) => {
    const t = song.tracks.find((x) => x.sample && x.sample.src === sound.src);
    if (t && !t.sample.seconds) { t.sample.seconds = buf.duration; save(); refreshView(); }
  }).catch(() => {});
}
function placeOnSong(i) {
  songUI.paintWith("t" + i); setView("song");
}
const curBeat = () => (ctx ? ((ctx.currentTime - t0) * song.bpm) / 60 : 0);
function togglePlay() { if (playing) stop(); else play(0); }
function setMode(m) {
  edit(() => { song.mode = m; });
  if (m === "song" && !(song.clips || []).length) toast("Place a pattern on the Song tab first.");
  if (playing) play(0);
}
function play(from) {
  audio(); stop(true); syncGains();
  songCache = inSong() ? songNotes(song) : null;
  audioCache = inSong() ? songAudio(song) : null;
  for (const t of song.tracks) if (t.sample) bufferOf(t.sample.src).catch(() => {}); // ready by the first note
  playing = true;
  t0 = ctx.currentTime + 0.05 - (from * 60) / song.bpm;
  scheduled = from;
  tick(); timer = setInterval(tick, 25);
  frame(); renderBar();
  navigator.wakeLock?.request("screen").then((l) => { wakeLock = l; }).catch(() => {});
}
function stop(quiet) {
  clearInterval(timer); cancelAnimationFrame(raf);
  if (!quiet) {
    playing = false; renderBar(); draw(); rackUI.playhead(-1); songUI.playhead(-1);
    wakeLock?.release().catch(() => {}); wakeLock = null;
    // Cut hanging tails: every strip gets a fresh input.
    if (mix) { mix.cut(); syncGains(); }
    mixUI.meters(null);

  }
}
function tick() {
  const spb = 60 / song.bpm, len = playLen();
  if (mix && (song.automation || []).length) { // knobs that move: the mixer follows the lanes
    const b = curBeat();
    mix.sync({ ...song, ...automated(song, looping ? b % len : b) });
  }
  const upTo = curBeat() + 0.12 / spb;
  if (!looping && scheduled >= len) { if (curBeat() > len + 1) { playing = false; stop(); } return; }
  const end = looping ? upTo : Math.min(upTo, len);
  for (let k = Math.floor(scheduled / len); k * len < end; k++) {
    song.tracks.forEach((t, i) => {
      for (const n of songCache ? songCache[i] || [] : allNotes(t, song)) {
        const abs = n.start + k * len;
        if (abs < scheduled || abs >= end || n.start >= len) continue;
        voice(t, n, t0 + abs * spb, Math.min(n.length, len - n.start) * spb, mix.input(i));
      }
    });
    for (const ev of audioCache || []) {
      const abs = ev.start + k * len, t = song.tracks[ev.track];
      if (abs < scheduled || abs >= end || !t || !t.sample) continue;
      const buf = bufferNow(t.sample.src);
      if (buf) playSlice(ctx, buf, { from: t.sample.start + ev.offset * spb, to: sampleEnd(t.sample), rate: 1 }, t0 + abs * spb, ev.length * spb, 100, mix.input(ev.track));
    }
  }
  scheduled = Math.max(scheduled, end);
}
function frame() {
  draw();
  if (view === "rack") rackUI.playhead(playing ? Math.floor((curBeat() % 4) / 0.25) : -1);
  if (view === "song") songUI.playhead(playing ? curBeat() % playLen() : -1);
  if (view === "mixer") mixUI.meters(playing && mix ? mix.levels() : null);
  if (playing) raf = requestAnimationFrame(frame);
}

// ---- files ------------------------------------------------------------------------------
async function openBytes(name, bytes) {
  try {
    let s;
    if (/\.(json|txt)$/i.test(name)) s = textToSong(new TextDecoder().decode(bytes));
    else {
      s = midiToSong(parseMidi(bytes), instrumentFor);
      s.chords = song.chords; s.scripts = song.scripts; // a MIDI file has none of its own: keep yours
      if (!s.tracks.length) throw new Error("That MIDI file has no notes.");
    }
    const before = snap(); stop();
    song = s; sel = 0; selNote = null; scrollX = 0;
    pushUndo(before); changed();
    const [lo, hi] = range(), first = s.tracks[0].notes[0];
    scrollY = first ? Math.max(0, (hi - first.pitch) * ROW - H / 2) : 0; draw();
    toast("Opened " + name + ".");
  } catch (err) { toast(err.message || "Could not open that file."); }
}
$("file").onchange = async (e) => {
  const f = e.target.files[0]; e.target.value = "";
  if (f) openBytes(f.name, new Uint8Array(await f.arrayBuffer()));
};
addEventListener("dragover", (e) => { e.preventDefault(); document.body.classList.add("drop"); });
addEventListener("dragleave", () => document.body.classList.remove("drop"));
addEventListener("drop", async (e) => {
  e.preventDefault(); document.body.classList.remove("drop");
  const f = e.dataTransfer.files[0];
  if (f) openBytes(f.name, new Uint8Array(await f.arrayBuffer()));
});

// ---- keys -------------------------------------------------------------------------------
addEventListener("keydown", (e) => {
  if (e.target.closest && e.target.closest("input,select,textarea")) return;
  const k = e.key;
  if (e.altKey && !e.ctrlKey && !e.metaKey && /^Digit[1234567]$/.test(e.code)) { e.preventDefault(); setView(VIEWS[+e.code.slice(5) - 1]); }
  else if ((e.ctrlKey || e.metaKey) && k.toLowerCase() === "z") { e.preventDefault(); doUndo(); }
  else if (e.ctrlKey || e.metaKey || e.altKey) return;
  else if (k === " ") { e.preventDefault(); togglePlay(); }
  else if (k === "?") setHelp($("helpbox").hidden);
  else if (k === "Escape") { setHelp(false); setMore(false); }
  else if (k === "[" || k === "]") switchPattern(clamp((song.pattern || 0) + (k === "]" ? 1 : -1), 0, song.patterns.length - 1));
  else if (k === "p" || k === "P") setTool("draw");
  else if (k === "e" || k === "E") setTool("erase");
  else if (k === "v" || k === "V") setTool("select");
  else if (k === "l" || k === "L") { looping = !looping; renderBar(); }
  else if (k === "b" || k === "B") bounce();
  else if (k === "s" || k === "S") setMode(song.mode === "song" ? "pattern" : "song");
  else if (k === "j" || k === "k") {
    sel = clamp(sel + (k === "j" ? 1 : -1), 0, song.tracks.length - 1); selNote = null; renderTracks(); draw();
  } else if (k === "n" || k === "N") addTrack();
  else if (k === "Delete" || k === "Backspace") {
    if (selNote) edit(() => { const t = song.tracks[sel]; t.notes.splice(t.notes.indexOf(selNote), 1); selNote = null; });
  } else if (k === "+" || k === "=") setZoom(zoom * 1.25);
  else if (k === "-") setZoom(zoom / 1.25);
});

// ---- views: Chords, Roll, Script --------------------------------------------------------
const VIEW_LABELS = { chords: ["♫", "Chords"], rack: ["▦", "Rack"], roll: ["▤", "Roll"], script: ["ƒ", "Script"], song: ["☰", "Song"], mixer: ["◫", "Mixer"], sampler: ["〰", "Sampler"] };
function renderViews() {
  $("views").innerHTML = VIEWS.map((v, i) => `<button role="tab" id="view-${v}" data-tip="${VIEW_LABELS[v][1]} (Alt+${i + 1})" aria-selected="${v === view}">${VIEW_LABELS[v][0]} ${VIEW_LABELS[v][1]}</button>`).join("");
  VIEWS.forEach((v) => { $("view-" + v).onclick = () => setView(v); });
}
function setView(v) {
  if (!VIEWS.includes(v)) return;
  view = v;
  if (v !== "sampler") pendingRack = false; // + Sample in the rack only lasts while you are picking the sound
  $("main").dataset.view = v;
  document.body.dataset.view = v;
  for (const b of VIEWS) $("view-" + b)?.setAttribute("aria-selected", b === v);
  refreshView();
  if (v === "roll") { resize(); draw(); }
}
function refreshView() {
  if (view === "chords") chordUI.render();
  else if (view === "script") scriptUI.render();
  else if (view === "rack") rackUI.render();
  else if (view === "song") songUI.render();
  else if (view === "mixer") mixUI.render();
  else if (view === "sampler") samplerUI.render();
}

const instrumentNow = () => (song.tracks[sel] ? song.tracks[sel].instrument : "piano");
function sound(pitches) {
  audio(); syncGains();
  pitches.forEach((pitch, i) => synth.playNote({ instrument: instrumentNow(), pitch, time: ctx.currentTime + i * 0.012, length: 0.7, velocity: 90 }, mix.master()));
}
function hear(notes, onEnd) {
  audio();
  const gn = ctx.createGain(); gn.connect(mix.master());
  const spb = 60 / song.bpm, at = ctx.currentTime + 0.05;
  let end = 0;
  for (const n of notes) {
    synth.playNote({ instrument: instrumentNow(), pitch: n.pitch, time: at + n.start * spb, length: n.length * spb, velocity: n.velocity }, gn);
    end = Math.max(end, n.start + n.length);
  }
  const timer = setTimeout(() => onEnd && onEnd(), (end * spb + 0.6) * 1000);
  return () => { clearTimeout(timer); gn.disconnect(); };
}
// One way: chords become notes in a track, and that is the last the song hears of chords.
function toMidi(notes, target) {
  if (!notes.length) return toast("There is nothing to write yet.");
  edit(() => {
    let t = target === "selected" ? song.tracks[sel] : null;
    if (!t) {
      t = { name: "Chords", instrument: "piano", key: 60, steps: emptySteps(), volume: 0.8, mute: false, solo: false, notes: [] };
      song.tracks.push(t); sel = song.tracks.length - 1;
    }
    t.notes.push(...notes.map((n) => ({ ...n })));
    t.notes.sort((a, b) => a.start - b.start || a.pitch - b.pitch);
    const end = Math.max(...notes.map((n) => n.start + n.length));
    song.bars = clamp(Math.max(song.bars, Math.ceil(end / 4)), 1, 64);
    selNote = null;
  });
  scrollX = 0;
  setView("roll");
  const [lo, hi] = range(), top = Math.max(...notes.map((n) => n.pitch));
  scrollY = Math.max(0, (hi - top) * ROW - 24); draw();
  toast("Chords are notes now. Edit them in the roll.");
}
function runOn(code, values, name) {
  const t = song.tracks[sel];
  if (!t) return { ok: false, message: "There is no track to run it on." };
  try {
    const out = runScript(code, t.notes, { values, tracks: Object.fromEntries(song.tracks.map((x) => [x.name, allNotes(x, song)])) });
    edit(() => { t.notes = out; selNote = null; });
    toast((name || "Script") + " ran on " + t.name + ": " + out.length + " notes.", { label: "Undo", run: doUndo });
    return { ok: true };
  } catch (e) { return { ok: false, message: e.message }; }
}
const chordUI = mountChords($("chordview"), { song: () => song, change: edit, undo: doUndo, sound, hear, toMidi, toast });
const scriptUI = mountScripts($("scriptview"), { song: () => song, change: edit, undo: doUndo, save, trackName: () => (song.tracks[sel] ? song.tracks[sel].name : "no track"),
  runOn: (code, values, name) => runOn(code, values, name) });

function switchPattern(k) {
  if (k === song.pattern || k < 0 || k >= song.patterns.length) return;
  const before = snap();
  usePattern(song, k); selNote = null;
  pushUndo(before); changed();
}
function newPattern(dup) { edit(() => { addPattern(song, dup); selNote = null; }); }
function dropPattern() {
  const before = snap();
  if (!removePattern(song, song.pattern)) return toast("A song needs at least one pattern.");
  selNote = null; changed();
  toast("Pattern deleted.", { label: "Undo", run: () => { song = textToSong(before); changed(true); } });
}
function addDrums() {
  edit(() => {
    const kit = [["Kick", 36, [0, 4, 8, 12]], ["Snare", 38, [4, 12]], ["Hat", 42, [0, 2, 4, 6, 8, 10, 12, 14]]];
    for (const [name, key, on] of kit) {
      const steps = emptySteps();
      for (const i of on) steps[i] = { velocity: name === "Hat" && i % 4 ? 70 : 100, pitch: key };
      song.tracks.push({ name, instrument: "drums", key, steps, volume: 0.8, mute: false, solo: false, notes: [] });
    }
    sel = song.tracks.length - 3;
  });
}
const rackUI = mountRack($("rackview"), {
  song: () => song, change: edit, snap, pushUndo, save, selected: () => sel,
  select: (i) => { sel = i; selNote = null; renderTracks(); draw(); },
  addTrack, addDrums, usePattern: switchPattern, newPattern, removePattern: dropPattern,
  addSample: () => { pendingRack = true; samplerUI.show("oneshots"); setView("sampler"); toast("Pick a sound: + Rack (or + Inst) adds it as a channel."); },
  preview: (i, step) => { const t = song.tracks[i]; if (t) preview(t, { pitch: step.pitch, velocity: step.velocity }); },
});

const mixUI = mountMixer($("mixerview"), {
  song: () => song, change: edit, snap, pushUndo, save, toast, undo: doUndo, sync: syncGains, selected: () => sel,
  select: (i) => { sel = i; selNote = null; renderTracks(); },
});
const samplerUI = mountSampler($("samplerview"), {
  song: () => song, selected: () => sel, change: edit, snap, pushUndo, save, toast, addSampler, placeOnSong,
  buffer: bufferOf, hear: hearLibrary, audition,
});
const songUI = mountSong($("songview"), {
  song: () => song, change: edit, snap, pushUndo, save, toast, undo: doUndo, setMode,
  editPattern: (k) => { switchPattern(k); setView("rack"); },
  editSample: (i) => { sel = i; selNote = null; renderTracks(); setView("sampler"); },
});

// ---- errors are shown, and the page can be scripted ----------------------------------------
// A failure on a phone used to be silence. Now it is a message, and the tests (and anyone
// with a console) can read and drive the page without clicking: anything you can click you
// can also call.
addEventListener("error", (e) => toast("Something went wrong: " + (e.message || "unknown error")));
addEventListener("unhandledrejection", (e) => toast("Something went wrong: " + ((e.reason && e.reason.message) || e.reason)));
window.jriterDaw = {
  song: () => { const j = JSON.parse(songToText(song)); j.tracks.forEach((t, i) => { t.notes = song.tracks[i].notes.map((n) => ({ ...n })); t.steps = JSON.parse(JSON.stringify(song.tracks[i].steps)); }); return j; },
  pattern: () => song.pattern,
  mode: () => song.mode,
  setMode,
  clips: () => JSON.parse(JSON.stringify(song.clips || [])),
  usePattern: switchPattern,
  load: (text) => { song = textToSong(text); sel = 0; selNote = null; changed(true); },
  zoom: () => zoom,
  scroll: () => ({ x: scrollX, y: scrollY }),
  playing: () => playing,
  levels: () => (mix ? mix.levels() : null),
  mixer: () => JSON.parse(JSON.stringify(song.mixer || null)),
  automation: () => JSON.parse(JSON.stringify(song.automation || [])),
  addLane: (target) => edit(() => { song.automation = song.automation || []; song.automation.push({ target, points: [] }); }),
  addPoint: (lane, beat, value) => edit(() => { autoAdd(song.automation[lane], beat, value); }),
  tool: () => tool,
  snap: () => ({ setting: snapSet.roll, beats: step() }),
  setSnap: (v) => { snapSet.roll = v; saveSnap(localStorage, { roll: v }); draw(); showSnap(); },
  setZoom,
  zoomLevel: () => zoom,
  songZoom: () => songUI.zoom(),
  setSongZoom: (z) => songUI.setZoom(z),
  songSnap: () => songUI.snap(),
  setSongSnap: (v) => songUI.setSnap(v),
  selected: () => sel,
  view: () => view,
  setView,
  addSampler,
  sample: () => (song.tracks[sel] && song.tracks[sel].sample ? JSON.parse(JSON.stringify(song.tracks[sel].sample)) : null),
  chop: (n) => edit(() => { const t = song.tracks[sel]; if (t && t.sample) chop(t.sample, n); }),
};

// ---- together: a project kept on the server, friends in it with you --------------------------------
const esc = (t) => String(t).replace(/[&<>"]/g, "");
const TABS = { chords: "the chords", rack: "the rack", roll: "the piano roll", script: "the script", song: "the song", mixer: "the mixer", sampler: "the sampler" };
function showPeople(list) {
  const before = people.map((p) => String(p.id));
  people = list;
  const el = $("people");
  if (el) el.innerHTML = list.map((p) => { const tip = esc(p.name) + " is on " + (TABS[(p.cursor || {}).tab] || "the DAW"); return `<span class="badge" style="--hue:${p.hue}" data-tip="${tip}" title="${tip}">${esc(p.name).slice(0, 1).toUpperCase()}</span>`; }).join("");
  for (const p of list) if (!before.includes(String(p.id))) toast(p.name + " joined.");
  if (view === "roll" && list.length) draw();
}
async function loadFriends() {
  const el = $("friends");
  if (!el) return;
  try {
    const r = await fetch("/api/shares?song=" + encodeURIComponent(songId), { credentials: "include" });
    const j = r.ok ? await r.json() : { shares: [] };
    const mine = (j.shares || []).filter((s) => s.to_account && !s.revoked_at);
    el.innerHTML = mine.length ? "Together: " + mine.map((s) => `<button type="button" class="chip" data-share="${s.id}" title="Copy the link ${esc(s.to_name)} opens to edit with you">${esc(s.to_name)}</button>`).join("") : "";
    el.onclick = (e) => {
      const b = e.target.closest("[data-share]");
      if (!b) return;
      const link = location.origin + location.pathname + "?song=" + songId + "&share=" + b.dataset.share;
      (navigator.clipboard ? navigator.clipboard.writeText(link) : Promise.reject()).then(() => toast("Link copied. " + b.textContent + " opens it signed in."), () => toast(link));
    };
  } catch { /* the list is a convenience */ }
}
if (songId) {
  together = startTogether({
    songId, shareId,
    getText: () => songToText(song),
    applyText: (text) => { const keep = sel; song = textToSong(text); sel = Math.min(keep, song.tracks.length - 1); selNote = null; changed(true); },
    getCursor: () => ({ tab: view, track: sel, beat: myBeat }),
    onPeople: showPeople,
    onStatus: (s) => { document.body.classList.toggle("offline", s === "offline"); },
  });
}

// ---- start ------------------------------------------------------------------------------
new ResizeObserver(resize).observe($("rollbox"));
{ const asked = new URLSearchParams(location.search).get("view"); if (VIEWS.includes(asked)) view = asked; } // /daw.html?view=roll
renderBar(); renderTracks(); renderHelp(); renderViews(); setView(view); resize();
try {
  if (!localStorage.getItem("jriter-daw-help")) { localStorage.setItem("jriter-daw-help", "1"); setHelp(true); }
} catch { /* no storage: the ? button still works */ }
{
  const [lo, hi] = range(), first = song.tracks[0] && song.tracks[0].notes[0];
  if (first) scrollY = Math.max(0, (hi - first.pitch) * ROW - H / 2);
  draw();
}
fetch("/api/state").then((r) => (r.ok ? r.json() : null)).then((j) => { if (j && j.version) $("verstamp").textContent = " · DAW " + j.version; }).catch(() => {});
if (songId) fetch(API + "/songs/" + encodeURIComponent(songId), { credentials: "include" }).then((r) => (r.ok ? r.json() : null)).then((j) => { const n = document.querySelector("#morebox .name"); if (j && j.song && n) n.textContent = "DAW · " + j.song.title; }).catch(() => {});
const src = new URLSearchParams(location.search).get("src");
if (src) {
  fetch(src, { credentials: "include" })
    .then((r) => { if (!r.ok) throw new Error("Could not fetch that MIDI file."); return r.arrayBuffer(); })
    .then((b) => openBytes(/\.json$/i.test(src.split("?")[0]) ? "song.json" : "song.mid", new Uint8Array(b)))
    .catch((err) => toast(err.message));
}
