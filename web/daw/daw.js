// daw.js: the DAW page. Tracks on the left, a piano roll on the right, a bar on top.
// The song is plain data (see midi.js); everything here edits that object and redraws.
import { parseMidi, writeMidi, songToText, textToSong, midiToSong } from "./midi.js";
import { createSynth, instrumentFor, INSTRUMENTS } from "./synth.js";

const $ = (id) => document.getElementById(id);
const KEY = "jriter-daw";
const SNAP = 0.25; // a 16th note, in beats
const ROW = 14, GUTTER = 44;
const NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

let song = loadSaved() || defaultSong();
let sel = 0, selNote = null, lastLen = 0.25;
let zoom = 1, scrollX = 0, scrollY = 0;
let undo = [];
let looping = true, playing = false;
let ctx = null, synth = null, master = null, gains = [];
let t0 = 0, scheduled = 0, timer = 0, raf = 0;

function defaultSong() {
  const notes = [];
  [60, 64, 67, 72, 67, 64, 60, 64].forEach((p, i) => notes.push({ pitch: p, start: i * 0.5, length: 0.5, velocity: 90 }));
  [60, 64, 67, 72, 67, 64, 60, 64].forEach((p, i) => notes.push({ pitch: p, start: 4 + i * 0.5, length: 0.5, velocity: 90 }));
  return { bpm: 120, bars: 4, tracks: [{ name: "Piano", instrument: "piano", volume: 0.8, mute: false, solo: false, notes }] };
}
function loadSaved() {
  try { const t = localStorage.getItem(KEY); return t ? textToSong(t) : null; } catch { return null; }
}
function save() { try { localStorage.setItem(KEY, songToText(song)); } catch { /* storage full or off: the file buttons still work */ } }

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
  $("toasts").append(el);
  setTimeout(() => el.remove(), action ? 8000 : 4000);
}

// ---- the top bar ------------------------------------------------------------------------
const ICONS = { play: "▶", stop: "■", loop: "↻", open: "↑", mid: "♪", json: "{ }", add: "+", undo: "↶" };
function btn(id, icon, tip, pressed) {
  return `<button id="${id}" data-tip="${tip}" aria-label="${tip}"${pressed === undefined ? "" : ` aria-pressed="${pressed}"`}>${icon}</button>`;
}
function renderBar() {
  const bar = $("bar");
  if (bar.dataset.built) {
    $("play").textContent = playing ? ICONS.stop : ICONS.play;
    $("play").setAttribute("aria-label", playing ? "Stop" : "Play");
    $("play").dataset.tip = playing ? "Stop (Space)" : "Play (Space)";
    $("loop").setAttribute("aria-pressed", looping);
    $("bpm").value = song.bpm; $("bars").value = song.bars;
    return;
  }
  bar.dataset.built = "1";
  bar.innerHTML = `<span class="name">DAW</span>` +
    btn("play", ICONS.play, "Play (Space)") + btn("loop", ICONS.loop, "Loop (L)", looping) +
    `<span class="sep"></span>` +
    `<label>BPM <input id="bpm" type="number" min="20" max="300" step="1"></label>` +
    `<label>Bars <input id="bars" type="number" min="1" max="64" step="1"></label>` +
    `<span class="sep"></span>` +
    btn("add", ICONS.add, "New track (N)") + btn("undo", ICONS.undo, "Undo (Ctrl+Z)") +
    `<span class="sep"></span>` +
    btn("open", ICONS.open, "Open a .mid or .json song") + btn("savemid", ICONS.mid, "Save as .mid") + btn("savejson", ICONS.json, "Save as .json text");
  $("play").onclick = () => togglePlay();
  $("loop").onclick = () => { looping = !looping; renderBar(); };
  $("bpm").onchange = (e) => { edit(() => { song.bpm = clamp(+e.target.value || 120, 20, 300); }); if (playing) play(curBeat() % loopLen()); };
  $("bars").onchange = (e) => edit(() => { song.bars = clamp(Math.round(+e.target.value) || 4, 1, 64); });
  $("add").onclick = addTrack;
  $("undo").onclick = doUndo;
  $("open").onclick = () => $("file").click();
  $("savemid").onclick = () => download("song.mid", writeMidi(song), "audio/midi");
  $("savejson").onclick = () => download("song.json", songToText(song), "application/json");
  renderBar();
}
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
    song.tracks.push({ name: "Track " + (song.tracks.length + 1), instrument: "piano", volume: 0.8, mute: false, solo: false, notes: [] });
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
      <div class="row"><select aria-label="Instrument">${INSTRUMENTS.map((n) => `<option${n === t.instrument ? " selected" : ""}>${n}</option>`).join("")}</select>
      <button data-a="mute" data-tip="Mute" aria-label="Mute" aria-pressed="${!!t.mute}">M</button>
      <button data-a="solo" data-tip="Solo" aria-label="Solo" aria-pressed="${!!t.solo}">S</button></div>
      <div class="row"><input type="range" min="0" max="1" step="0.01" aria-label="Volume" value="${t.volume}"></div>`;
    const name = el.querySelector("input[type=text]");
    name.value = t.name;
    name.oninput = () => { t.name = name.value; save(); };
    name.onchange = () => { const b = snap(); pushUndo(b); };
    el.querySelector("select").onchange = (e) => edit(() => { t.instrument = e.target.value; });
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
  song.tracks.splice(i, 1);
  sel = Math.max(0, Math.min(sel, song.tracks.length - 1)); selNote = null;
  changed();
  toast("Track deleted.", { label: "Undo", run: () => { song = textToSong(before); sel = Math.min(i, song.tracks.length - 1); changed(); } });
}

// ---- the piano roll ---------------------------------------------------------------------
const cv = $("roll"), g = cv.getContext("2d");
let W = 0, H = 0;
const pxBeat = () => 64 * zoom;
const loopLen = () => song.bars * 4;
function range() {
  let lo = 36, hi = 96;
  for (const t of song.tracks) for (const n of t.notes) { lo = Math.min(lo, n.pitch - 2); hi = Math.max(hi, n.pitch + 2); }
  return [clamp(lo, 0, 127), clamp(hi, 0, 127)];
}
function resize() {
  const r = cv.getBoundingClientRect(), d = devicePixelRatio || 1;
  W = r.width; H = r.height;
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
  for (let b = 0; b <= total; b += SNAP) {
    const xx = x(b);
    if (xx < GUTTER - 1 || xx > W) continue;
    const isBar = b % 4 === 0, isBeat = b % 1 === 0;
    if (!isBeat && pb < 90) continue;
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
cv.addEventListener("pointerdown", (e) => {
  if (e.button !== 0 || !song.tracks[sel]) return;
  cv.focus();
  const r = cv.getBoundingClientRect();
  if (e.clientX - r.left < GUTTER) return;
  const c = cell(e), t = song.tracks[sel], before = snap();
  let n = hit(c), mode = "move";
  if (!n) {
    const start = Math.floor(c.beat / SNAP) * SNAP;
    if (start >= loopLen()) return;
    n = { pitch: c.pitch, start, length: lastLen, velocity: 90 };
    t.notes.push(n);
  } else if (n.start + n.length - c.beat < Math.min(0.3, n.length / 2) + 6 / pxBeat()) mode = "resize";
  selNote = n;
  preview(t, n);
  drag = { n, mode, before, c0: c, start0: n.start, pitch0: n.pitch, len0: n.length };
  cv.setPointerCapture(e.pointerId);
  draw();
});
cv.addEventListener("pointermove", (e) => {
  if (!drag) return;
  const c = cell(e), n = drag.n;
  if (drag.mode === "move") {
    const ns = Math.max(0, drag.start0 + Math.round((c.beat - drag.c0.beat) / SNAP) * SNAP);
    if (n.pitch !== c.pitch) preview(song.tracks[sel], { ...n, pitch: c.pitch });
    n.start = Math.min(ns, loopLen() - SNAP); n.pitch = c.pitch;
  } else {
    n.length = Math.max(SNAP, Math.round((c.beat - n.start) / SNAP) * SNAP);
    lastLen = n.length;
  }
  draw();
});
const endDrag = () => {
  if (!drag) return;
  if (drag.mode === "move") lastLen = drag.n.length;
  if (snap() !== drag.before) { pushUndo(drag.before); save(); renderBar(); }
  drag = null; draw();
};
cv.addEventListener("pointerup", endDrag);
cv.addEventListener("pointercancel", endDrag);
cv.addEventListener("contextmenu", (e) => {
  e.preventDefault();
  const n = hit(cell(e));
  if (n) edit(() => { const t = song.tracks[sel]; t.notes.splice(t.notes.indexOf(n), 1); if (selNote === n) selNote = null; });
});
cv.addEventListener("wheel", (e) => {
  e.preventDefault();
  if (e.ctrlKey) { setZoom(zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15)); return; }
  if (e.shiftKey) scrollX += e.deltaY; else { scrollY += e.deltaY; scrollX += e.deltaX; }
  draw();
}, { passive: false });
function setZoom(z) { zoom = clamp(z, 0.25, 4); draw(); }

// ---- sound ------------------------------------------------------------------------------
function audio() {
  if (ctx) { if (ctx.state === "suspended") ctx.resume(); return; }
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  synth = createSynth(ctx);
  master = ctx.createGain(); master.gain.value = 0.8;
  const comp = ctx.createDynamicsCompressor();
  master.connect(comp); comp.connect(ctx.destination);
}
function syncGains() {
  if (!ctx) return;
  while (gains.length < song.tracks.length) { const gn = ctx.createGain(); gn.connect(master); gains.push(gn); }
  const solo = song.tracks.some((t) => t.solo);
  song.tracks.forEach((t, i) => { gains[i].gain.value = (t.mute || (solo && !t.solo)) ? 0 : t.volume; });
}
function preview(t, n) {
  audio(); syncGains();
  const i = song.tracks.indexOf(t);
  synth.playNote({ instrument: t.instrument, pitch: n.pitch, time: ctx.currentTime, length: 0.3, velocity: n.velocity }, gains[i]);
}
const curBeat = () => (ctx ? ((ctx.currentTime - t0) * song.bpm) / 60 : 0);
function togglePlay() { if (playing) stop(); else play(0); }
function play(from) {
  audio(); stop(true); syncGains();
  playing = true;
  t0 = ctx.currentTime + 0.05 - (from * 60) / song.bpm;
  scheduled = from;
  tick(); timer = setInterval(tick, 25);
  frame(); renderBar();
}
function stop(quiet) {
  clearInterval(timer); cancelAnimationFrame(raf);
  if (!quiet) {
    playing = false; renderBar(); draw();
    // Cut hanging tails by rebuilding the track gains.
    for (const gn of gains) gn.disconnect();
    gains = []; if (ctx) syncGains();
  }
}
function tick() {
  const spb = 60 / song.bpm, len = loopLen();
  const upTo = curBeat() + 0.12 / spb;
  if (!looping && scheduled >= len) { if (curBeat() > len + 1) { playing = false; stop(); } return; }
  const end = looping ? upTo : Math.min(upTo, len);
  for (let k = Math.floor(scheduled / len); k * len < end; k++) {
    song.tracks.forEach((t, i) => {
      for (const n of t.notes) {
        const abs = n.start + k * len;
        if (abs < scheduled || abs >= end || n.start >= len) continue;
        synth.playNote({ instrument: t.instrument, pitch: n.pitch, time: t0 + abs * spb, length: Math.min(n.length, len - n.start) * spb, velocity: n.velocity }, gains[i]);
      }
    });
  }
  scheduled = Math.max(scheduled, end);
}
function frame() { draw(); if (playing) raf = requestAnimationFrame(frame); }

// ---- files ------------------------------------------------------------------------------
async function openBytes(name, bytes) {
  try {
    let s;
    if (/\.(json|txt)$/i.test(name)) s = textToSong(new TextDecoder().decode(bytes));
    else {
      s = midiToSong(parseMidi(bytes), instrumentFor);
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
  if ((e.ctrlKey || e.metaKey) && k.toLowerCase() === "z") { e.preventDefault(); doUndo(); }
  else if (e.ctrlKey || e.metaKey || e.altKey) return;
  else if (k === " ") { e.preventDefault(); togglePlay(); }
  else if (k === "l" || k === "L") { looping = !looping; renderBar(); }
  else if (k === "j" || k === "k") {
    sel = clamp(sel + (k === "j" ? 1 : -1), 0, song.tracks.length - 1); selNote = null; renderTracks(); draw();
  } else if (k === "n" || k === "N") addTrack();
  else if (k === "Delete" || k === "Backspace") {
    if (selNote) edit(() => { const t = song.tracks[sel]; t.notes.splice(t.notes.indexOf(selNote), 1); selNote = null; });
  } else if (k === "+" || k === "=") setZoom(zoom * 1.25);
  else if (k === "-") setZoom(zoom / 1.25);
});

// ---- start ------------------------------------------------------------------------------
new ResizeObserver(resize).observe($("rollbox"));
renderBar(); renderTracks(); resize();
{
  const [lo, hi] = range(), first = song.tracks[0] && song.tracks[0].notes[0];
  if (first) scrollY = Math.max(0, (hi - first.pitch) * ROW - H / 2);
  draw();
}
const src = new URLSearchParams(location.search).get("src");
if (src) {
  fetch(src, { credentials: "include" })
    .then((r) => { if (!r.ok) throw new Error("Could not fetch that MIDI file."); return r.arrayBuffer(); })
    .then((b) => openBytes(/\.json$/i.test(src.split("?")[0]) ? "song.json" : "song.mid", new Uint8Array(b)))
    .catch((err) => toast(err.message));
}
