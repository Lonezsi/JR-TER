// samplerview.js: the Sampler tab. Pick a sound from the library, trim it, chop it.
//
//   mountSampler(el, api) -> { render }
//   api: song(), selected(), change(fn) (undoable edit), snap(), pushUndo(before), save(), toast(text),
//        addSampler(sound), buffer(src) -> Promise<AudioBuffer>, hear(src) (play 4 s), audition(track, from, to),
//        placeOnSong(track)
// The sounds are a browser of folders, the way a desktop DAW lists them: two roots, One-shots (your own
// sounds, library.js mySamples, in the folders they came in) and Samples (waiting renders, and each song's
// takes and vocals). A folder opens with a click, its contents are fetched the first time, and the filter
// searches everything that has been fetched. One-shots: add files or a folder, drop them on the tab, hear,
// add as an instrument or a rack channel, delete (Undo brings it back).
// Sounds come from library.js. Model and maths: sampler.js.
import { chop, addSlice, removeSliceNear, sampleEnd, peaks, guessBpm, clipRate, ENV } from "./sampler.js";
import { knob, wireKnobs } from "./knob.js";
import { librarySongs, soundsOf, waitingRenders, mySamples, uploadSamples, removeSample, restoreSample, changeSample, each, isSound, MIDI_TYPE, SOUND_TYPE } from "./library.js";

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const NOTE = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const noteName = (m) => NOTE[m % 12] + (Math.floor(m / 12) - 1);
const mmss = (s) => (s > 0 ? Math.floor(s / 60) + ":" + String(Math.floor(s % 60)).padStart(2, "0") : "");
const ICON = { take: "♪", vocal: "🎙", render: "▣", oneshot: "◆", midi: "♫" };
const OPEN = "jriter-daw-open";
function opened() { try { return new Set(JSON.parse(localStorage.getItem(OPEN) || "[\"oneshots\"]")); } catch { return new Set(["oneshots"]); } }

export function mountSampler(el, api) {
  /* The instrument editor is a dialog over everything (it is about the selected instrument, not about
   * browsing), so it lives at the top of the page: a pane that blurs what is behind it would trap a
   * fixed child inside itself. The same handlers listen on the browser and on the dialog. */
  const modal = document.createElement("div");
  modal.className = "ins-scrim"; modal.hidden = true;
  document.body.append(modal);
  let editingInstrument = false;
  const on = (type, fn, opts) => { el.addEventListener(type, fn, opts); modal.addEventListener(type, fn, opts); };
  const guest = api.guest || null; // a friend in the owner's song: only that song's takes and vocals
  let songs = guest ? [{ id: guest.songId, title: "This song" }] : null, problem = "", query = "", busy = "";
  let shots = null;                 // My one-shots, once fetched
  const kids = new Map();           // "renders" | song id -> its sounds, once fetched
  const asking = new Set();         // what is being fetched right now
  const open = opened();            // which folders are open, kept between visits
  let items = [];                   // the rows drawn last, so a button's number finds its sound
  let editing = false;              // the One-shots folders are being arranged: rename, move, delete
  let renaming = null;              // "shot:Path/" of the folder whose name is a field, or "sound:ID"
  let moving = null;                // what is being dragged in edit mode: { kind: "dir", path } | { kind: "sound", id }
  let drag = null, hold = 0;
  const wave = new Map(); // src -> peaks

  const track = () => { const t = api.song().tracks[api.selected()]; return t && t.sample ? t : null; };
  const keep = () => { try { localStorage.setItem(OPEN, JSON.stringify([...open])); } catch { /* fine */ } };
  const said = (e) => (e.message === "signin" ? "Sign in to JR!TER to use your library's sounds." : "Could not reach your library. " + (e.message || ""));

  // Fetch what an open folder needs, once. Each answer redraws only the list.
  async function fetchFor(key) {
    if (asking.has(key)) return;
    asking.add(key); problem = "";
    try {
      if (key === "oneshots") shots = await mySamples();
      else if (key === "samples") { if (!songs) songs = await librarySongs(); }
      else if (key === "renders") kids.set("renders", await waitingRenders());
      else if (key.startsWith("song:")) { const id = key.slice(5); kids.set(id, guest ? await soundsOf(guest.songId, guest.prefix) : await soundsOf(id)); }
    } catch (e) { problem = said(e); }
    asking.delete(key); list();
  }
  const fetched = (key) => key === "oneshots" ? shots !== null : key === "samples" ? songs !== null : key === "renders" ? kids.has("renders") : key.startsWith("song:") ? kids.has(key.slice(5)) : true;
  function want() { for (const k of open) if (!fetched(k)) fetchFor(k); }
  function load(which) { // older callers: open that folder and show it
    if (which === "oneshots") { open.add("oneshots"); shots = null; }
    else if (which === "renders") { open.add("samples"); open.add("renders"); kids.delete("renders"); }
    keep(); want(); list();
  }

  function render() {
    const t = track(), s = t && t.sample;
    el.innerHTML =
      `<div class="sp-head"><span class="cv-title">Browser</span>` +
        (guest ? "" : `<button class="sp-tool" data-act="files" data-tip="Add sound files to your one-shots" aria-label="Add sound files">＋</button>` +
          `<button class="sp-tool" data-act="folder" data-tip="Add a whole folder to your one-shots" aria-label="Add a folder of sounds">⊞</button>` +
          `<button class="sp-tool" data-act="edit" aria-pressed="${editing}" data-tip="${editing ? "Done arranging" : "Arrange your one-shots: rename, move and delete folders and sounds"}" aria-label="Arrange one-shots">✎</button>`) + `</div>` +
      (editing ? `<div class="sv-doc sp-edit-doc">Drag a sound or a folder onto a folder to move it, or onto One-shots to take it out to the top. ✎ renames: a name with " / " in it nests.</div>` : "") +
      `<input id="sp-q" class="sp-q" type="search" placeholder="Search sounds" aria-label="Search sounds by name or folder" value="${esc(query)}">` +
      `<input id="sp-files" type="file" multiple accept="audio/*,.wav,.aif,.aiff,.flac,.mp3,.ogg,.opus,.m4a" hidden>` +
      `<input id="sp-dir" type="file" webkitdirectory multiple hidden>` +
      (busy ? `<div class="sv-doc" role="status">${esc(busy)}</div>` : "") + `<div id="sp-listbox" class="sp-tree" role="tree" aria-label="Sounds">${tree()}</div>` +
      (guest ? `<div class="sv-doc">You are in a friend's song: use its takes and vocals here. One-shots already in the song play for you too.</div>` : "") +
      (s ? `<button class="sp-open" data-act="instrument" data-tip="Open ${esc(t.name)}'s sampler">〰 ${esc(t.name)}: ${esc(s.name)}</button>`
        : `<div class="sv-doc">Inst puts a sound on a sampler track, or drag it onto the Drumroll, a track or the Layout; its sampler opens over everything.</div>`);
    renderModal();
  }

  // ---- the instrument: a dialog with the sound, its trim and cuts, and how it plays --------------------
  const ENV_WORDS = { a: "Attack", d: "Decay", s: "Sustain", r: "Release" };
  const sec = (v) => (v < 1 ? Math.round(v * 1000) + " ms" : v.toFixed(2) + " s");
  function renderModal() {
    const t = track(), s = t && t.sample;
    if (!editingInstrument || !s) { modal.hidden = true; modal.innerHTML = ""; return; }
    const keepFocus = modal.contains(document.activeElement) && document.activeElement.dataset.knob;
    modal.hidden = false;
    modal.innerHTML = `<section class="ins-modal" role="dialog" aria-modal="true" aria-label="Sampler: ${esc(t.name)}">` +
      `<header class="ins-head"><span class="ins-kind">Sampler</span><b>${esc(t.name)}</b><span class="faint">${esc(s.name)}</span><span class="mx-gap"></span>` +
        `<button data-act="hear" data-tip="Hear the whole sound" aria-label="Hear the sound">▶</button>` +
        `<button data-act="close" data-tip="Close (Escape)" aria-label="Close">✕</button></header>` +
      `<canvas class="sp-wave" id="sp-wave" tabindex="0" aria-label="Waveform of ${esc(s.name)}. Comma and period move the start, with Shift the end."></canvas>` +
      `<div class="cv-line" role="group" aria-label="Cuts and keys">` +
        [4, 8, 16].map((n) => `<button data-chop="${n}" data-tip="Cut into ${n} equal pieces">Chop ${n}</button>`).join("") +
        `<button data-act="clear" data-tip="Remove every cut"${s.slices.length ? "" : " disabled"}>Clear cuts</button>` +
        `<label>Root <input id="sp-root" type="number" min="0" max="127" step="1" value="${s.root}" aria-label="Root key"><output>${noteName(s.root)}</output></label>` +
        `<label>Tempo <input id="sp-bpm" type="number" min="0" max="400" step="0.01" value="${s.bpm || ""}" placeholder="off" aria-label="Tempo of the sound in BPM"></label>` +
        `<button data-act="guess" data-tip="Guess the tempo from the trim, as whole bars" aria-label="Guess the tempo">Guess</button>` +
        `<button data-act="keep" aria-pressed="${s.warp !== "pitch"}"${s.bpm ? "" : " disabled"} data-tip="Keep the pitch when audio clips stretch to the song tempo. Off: like tape" aria-label="Keep pitch">Keep pitch</button></div>` +
      `<div class="ins-grid">` +
        `<div class="ins-group"><span class="cv-title">Playing</span><div class="ins-switches">` +
          `<button data-act="oneshot" aria-pressed="${!!s.oneshot}" data-tip="Every note plays the whole sound, however short" aria-label="One-shot">One-shot</button>` +
          `<button data-act="loop" aria-pressed="${!!s.loop}"${s.oneshot ? " disabled" : ""} data-tip="A held note loops the sound until you let go" aria-label="Loop">Loop</button>` +
          `<button data-act="cut" aria-pressed="${!!s.cut}" data-tip="A new note stops the one still sounding" aria-label="Cut itself">Cut itself</button></div></div>` +
        `<div class="ins-group"><span class="cv-title">Pitch and time</span><div class="ins-knobs">` +
          `<label class="ins-k">${knob({ key: "pitch", label: "Pitch", value: s.pitch, lo: -24, hi: 24, home: 0, step: 1, words: (s.pitch > 0 ? "+" : "") + s.pitch + " st" })}<span>Pitch</span><output>${(s.pitch > 0 ? "+" : "") + s.pitch} st</output></label>` +
          `<label class="ins-k">${knob({ key: "stretch", label: "Stretch", value: s.stretch, lo: 0.25, hi: 4, home: 1, step: 0.05, words: s.stretch.toFixed(2) + "x" })}<span>Stretch</span><output>${s.stretch.toFixed(2)}x</output></label>` +
          `<button data-act="resample" data-tip="Render the sound as you have set it into a new one-shot, and play that" aria-label="Resample">Resample</button></div></div>` +
        `<div class="ins-group ins-env"><span class="cv-title">Envelope</span><div class="ins-knobs">` +
          Object.keys(ENV).map((k) => `<label class="ins-k">${knob({ key: "env." + k, label: ENV_WORDS[k], value: s.env[k], lo: ENV[k][0], hi: ENV[k][1], home: ENV[k][2], words: k === "s" ? Math.round(s.env[k] * 100) + "%" : sec(s.env[k]) })}<span>${ENV_WORDS[k]}</span><output>${k === "s" ? Math.round(s.env[k] * 100) + "%" : sec(s.env[k])}</output></label>`).join("") +
          `<canvas class="ins-adsr" id="ins-adsr" data-tip="Drag the points to shape the envelope" aria-hidden="true"></canvas></div></div>` +
      `</div>` +
      `<div class="sv-doc">${s.oneshot ? "One-shot: every hit plays the whole sound. " : ""}${s.slices.length ? `Chopped in ${s.slices.length + 1}: ${noteName(s.root)} plays piece 1, ${noteName(s.root + 1)} piece 2, and so on. ` : `Every key plays it, ${noteName(s.root)} at its own speed. `}` +
        `${s.bpm ? `Audio clips play it at the song's ${api.song().bpm} BPM (x${clipRate(s, api.song().bpm).toFixed(2)}, ${s.warp === "pitch" ? "like tape" : "keeping pitch"}). ` : ""}Drag the ends to trim. Hold to add or remove a cut.</div>` +
      `<footer class="ins-foot"><button data-act="place" data-tip="Put it on the Layout tab as an audio clip" aria-label="Place on the layout">☰ Place on the Layout</button><span class="mx-gap"></span><button data-act="close" class="ins-done">Done</button></footer>` +
      `</section>`;
    paint(); adsr();
    if (keepFocus) modal.querySelector(`[data-knob="${keepFocus}"]`)?.focus();
  }
  let envDrag = null; // { id, k, total, before }: a point on the drawn curve is being dragged
  function envGeom(cv) {
    const e = track().sample.env, r = cv.getBoundingClientRect(), pad = 6, hold = 0.5, W = r.width, H = r.height;
    const own = e.a + e.d + hold + e.r, total = envDrag ? envDrag.total : own || 1;
    const X = (sec) => pad + (sec / total) * (W - pad * 2), Y = (lv) => H - pad - lv * (H - pad * 2);
    return { e, r, W, H, pad, hold, total, X, Y,
      pts: { a: [X(e.a), Y(1)], d: [X(e.a + e.d), Y(e.s)], s: [X(e.a + e.d + hold), Y(e.s)], r: [X(own), Y(0)] } };
  }
  function adsr() {
    const t = track(), cv = modal.querySelector("#ins-adsr");
    if (!t || !cv) return;
    if (cv.getBoundingClientRect().width < 2) return requestAnimationFrame(adsr);
    const { e, r, W, H, X, Y, pts, hold } = envGeom(cv), dpr = devicePixelRatio || 1;
    cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr);
    const g = cv.getContext("2d"); g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const acc = getComputedStyle(document.documentElement).getPropertyValue("--d-acc").trim() || "#FAA8B8";
    g.clearRect(0, 0, W, H);
    g.beginPath(); g.moveTo(X(0), Y(0));
    for (const k of ["a", "d", "s", "r"]) g.lineTo(pts[k][0], pts[k][1]);
    g.strokeStyle = acc; g.lineWidth = 2; g.lineJoin = "round"; g.stroke();
    g.lineTo(X(0), Y(0)); g.globalAlpha = 0.15; g.fillStyle = acc; g.fill(); g.globalAlpha = 1;
    g.fillStyle = acc;
    for (const k of ["a", "d", "s", "r"]) { g.beginPath(); g.arc(pts[k][0], pts[k][1], envDrag && envDrag.k === k ? 4.5 : 3, 0, Math.PI * 2); g.fill(); }
  }
  // Drag a point on the curve: the knobs stay as the keyboard way, this is the same four numbers.
  const envWords = (k, v) => (k === "s" ? Math.round(v * 100) + "%" : sec(v));
  function envMove(e) {
    const cv = modal.querySelector("#ins-adsr"), t = track(); if (!cv || !t || !envDrag) return;
    const { e: env, r, W, H, pad, hold, total } = envGeom(cv);
    const s = (e.clientX - r.left - pad) / (W - pad * 2) * total, lv = clamp((H - pad - (e.clientY - r.top)) / (H - pad * 2), 0, 1);
    const set = (k, v) => { env[k] = Math.round(clamp(v, ENV[k][0], ENV[k][1]) * 1000) / 1000; };
    const k = envDrag.k;
    if (k === "a") set("a", s);
    else if (k === "d") { set("d", s - env.a); set("s", lv); }
    else if (k === "s") set("s", lv);
    else set("r", s - (env.a + env.d + hold));
    for (const n of "adsr") { const o = modal.querySelector(`[data-knob="env.${n}"]`)?.closest(".ins-k")?.querySelector("output"); if (o) o.textContent = envWords(n, env[n]); }
    adsr(); api.save();
  }
  modal.addEventListener("pointerdown", (e) => {
    if (e.target.id !== "ins-adsr" || !track() || e.button > 0) return;
    const cv = e.target, g = envGeom(cv), x = e.clientX - g.r.left, y = e.clientY - g.r.top;
    let k = "a", best = Infinity;
    for (const n of ["a", "d", "s", "r"]) { const d = Math.hypot(g.pts[n][0] - x, g.pts[n][1] - y); if (d < best) { best = d; k = n; } }
    e.preventDefault();
    envDrag = { id: e.pointerId, k, total: g.total, before: api.snap() };
    try { cv.setPointerCapture(e.pointerId); } catch { /* moves still arrive */ }
    envMove(e);
  });
  modal.addEventListener("pointermove", (e) => { if (envDrag && e.pointerId === envDrag.id) envMove(e); });
  const envEnd = (e) => {
    if (!envDrag || e.pointerId !== envDrag.id) return;
    const d = envDrag; envDrag = null;
    if (api.snap() !== d.before) { api.pushUndo(d.before); api.save(); }
    renderModal();
  };
  modal.addEventListener("pointerup", envEnd);
  modal.addEventListener("pointercancel", envEnd);
  function openInstrument() { if (!track()) return; editingInstrument = true; renderModal(); modal.querySelector(".ins-modal")?.focus?.(); requestAnimationFrame(() => modal.querySelector('[data-act="close"]')?.focus()); }
  function closeInstrument() { if (!editingInstrument) return; editingInstrument = false; renderModal(); el.querySelector('[data-act="instrument"]')?.focus(); }
  // It never clings: Escape, or a press outside it, closes it.
  modal.addEventListener("pointerdown", (e) => { if (e.target === modal) closeInstrument(); });
  addEventListener("keydown", (e) => { if (e.key === "Escape" && editingInstrument && !e.defaultPrevented) { e.preventDefault(); closeInstrument(); } });

  // Turning a knob changes the instrument as it plays; one undo step per turn.
  let before = null;
  wireKnobs(modal, {
    begin: () => { if (before === null) before = api.snap(); },
    end: () => {
      if (before === null) return;
      const t = track();
      if (api.snap() !== before) { api.pushUndo(before); api.save(); }
      before = null;
      if (t && (t.sample.stretch || 1) !== 1) api.prepare(t);   // make the stretched copy now, not at Play
    },
    turn: (key, v, node) => {
      const t = track(); if (!t) return;
      const s = t.sample;
      let words;
      if (key === "pitch") { s.pitch = v; words = (v > 0 ? "+" : "") + v + " st"; }
      else if (key === "stretch") { s.stretch = v; words = v.toFixed(2) + "x"; }
      else if (key.startsWith("env.")) { const k = key.slice(4); s.env[k] = v; words = k === "s" ? Math.round(v * 100) + "%" : sec(v); adsr(); }
      const out = node.closest(".ins-k")?.querySelector("output"); if (out && words) out.textContent = words;
      api.save();
      return words;
    },
  });



  // ---- the tree ----------------------------------------------------------------------------
  const q = () => query.trim().toLowerCase();
  const hit = (x, where) => !q() || (x.name + " " + (x.folder || "") + " " + (where || "")).toLowerCase().includes(q());

  function folderRow(key, name, depth, count, extra = "") {
    const on = open.has(key) || (!!q() && key !== "samples" && key !== "oneshots" ? true : open.has(key));
    const shot = key.startsWith("shot:"), arrange = editing && (shot || key === "oneshots");
    if (renaming === key) {
      return `<div class="sp-dir sp-renaming" style="--depth:${depth}"><span class="sp-car" aria-hidden="true"></span>` +
        `<input class="sp-rename" data-rename="${esc(key)}" value="${esc(key.slice(5, -1).split("/").join(" / "))}" aria-label="Folder name; a / nests it"></div>`;
    }
    return `<div class="sp-dirrow${arrange ? " arrange" : ""}" style="--depth:${depth}"${arrange ? ` data-drop="${esc(key)}"` : ""}${arrange && shot ? ` draggable="true" data-movedir="${esc(key)}"` : ""}>` +
      `<button class="sp-dir" role="treeitem" aria-expanded="${on}" data-dir="${esc(key)}">` +
      `<span class="sp-car" aria-hidden="true"></span><span class="sp-dname">${esc(name)}</span>` +
      (count != null ? `<span class="sp-count">${count}</span>` : "") + (asking.has(key) ? `<span class="sp-spin" aria-label="Loading"></span>` : "") + `</button>` +
      (arrange && shot ? `<span class="sp-acts on"><button data-renamedir="${esc(key)}" data-tip="Rename or move: a / nests it" aria-label="Rename the folder ${esc(name)}">✎</button>` +
        `<button data-deldir="${esc(key)}" data-tip="Delete the folder and its sounds (Undo brings them back)" aria-label="Delete the folder ${esc(name)}">×</button></span>` : "") +
      `</div>` + extra;
  }
  function soundRow(x, depth, mine) {
    const i = items.push(x) - 1;
    if (mine && renaming === "sound:" + x.id) {
      return `<div class="sp-row sp-renaming" style="--depth:${depth}"><span class="sp-ic" aria-hidden="true">${ICON.oneshot}</span>` +
        `<input class="sp-rename" data-renamesound="${i}" value="${esc(x.name)}" aria-label="Name of the sound"></div>`;
    }
    const arrange = mine && editing, midi = x.kind === "midi";
    const drag = arrange ? ` draggable="true" data-movesound="${i}"` : midi ? ` draggable="true" data-midi="${i}"` : ` draggable="true" data-sound="${i}"`;
    return `<div class="sp-row${midi ? " midi" : ""}" role="treeitem" style="--depth:${depth}"${drag}><span class="sp-ic" aria-hidden="true">${arrange ? "⠿" : ICON[x.kind] || "♪"}</span>` +
      `<button class="sp-name" data-hear="${i}" data-tip="${midi ? "Hear it. Drag it onto the roll or a pattern number" : arrange ? "Hear it" : "Hear it. Drag it onto the Drumroll, a track or the Layout"}" aria-label="Hear ${esc(x.name)}">${esc(x.name)}</button><span class="sp-len">${midi ? "MIDI" : mmss(x.seconds)}</span>` +
      (arrange ? `<span class="sp-acts on"><button data-rename="${i}" data-tip="Rename" aria-label="Rename ${esc(x.name)}">✎</button>` +
          `<button data-del="${i}" data-tip="Delete (Undo brings it back)" aria-label="Delete ${esc(x.name)}">×</button></span>`
        : midi ? `<span class="sp-acts"><button data-topat="${i}" data-tip="A new pattern with these notes, on the selected track" aria-label="Make a pattern from ${esc(x.name)}">Pattern</button></span>`
        : `<span class="sp-acts">` +
          `<button data-add="${i}" data-tip="Add as a sampler instrument" aria-label="Add ${esc(x.name)} as an instrument">Inst</button>` +
          (mine ? `<button data-rack="${i}" data-tip="Add to the Drumroll as a channel" aria-label="Add ${esc(x.name)} to the Drumroll">Drum</button>` : "") +
          `</span>`) + `</div>`;
  }

  // ---- arranging the one-shots ------------------------------------------------------------------
  const pathOf = (key) => key.slice(5, -1).split("/").join(" / ");          // "shot:A/B/" -> "A / B"
  const inside = (folder, path) => folder === path || folder.startsWith(path + " / ");
  const tidy = (t) => String(t || "").split("/").map((p) => p.trim()).filter(Boolean).join(" / ");
  // Everything under `from` moves to `to` (a folder path, "" for the top), keeping what is below it.
  async function moveFolder(from, to, says) {
    const list = shots.filter((x) => inside(x.folder, from));
    if (!list.length) return;
    busy = says + "…"; render();
    const ok = await each(list, (x) => changeSample(x.id, { folder: (to + x.folder.slice(from.length)).replace(/^ \/ /, "") }),
      (n, of) => { const b = el.querySelector("[role=status]"); if (b) b.textContent = says + ": " + n + " of " + of; });
    busy = "";
    api.toast(ok === list.length ? says + "." : says + ", but " + (list.length - ok) + " would not move.");
    shots = null; fetchFor("oneshots"); render();
  }
  async function deleteFolder(path) {
    const list = shots.filter((x) => inside(x.folder, path));
    busy = "Deleting " + path + "…"; render();
    await each(list, (x) => removeSample(x.id));
    busy = "";
    api.toast("Deleted " + path + " (" + list.length + (list.length === 1 ? " sound" : " sounds") + ").", { label: "Undo", run: async () => { await each(list, (x) => restoreSample(x.id)); shots = null; fetchFor("oneshots"); } });
    shots = null; fetchFor("oneshots"); render();
  }
  async function renameDone(input, keepIt) {
    const was = renaming; renaming = null;
    if (!keepIt || !was) return list();
    if (was.startsWith("shot:")) {
      const from = pathOf(was), to = tidy(input.value);
      if (!to || to === from) return list();
      if (inside(to, from)) { api.toast("A folder can't go inside itself."); return list(); }
      return moveFolder(from, to, "Moved " + from + " to " + to);
    }
    const x = items[+input.dataset.renamesound], name = input.value.trim();
    if (!x || !name || name === x.name) return list();
    if (await changeSample(x.id, { name })) { x.name = name; api.toast("Renamed to " + name + "."); }
    list();
  }
  // One-shots nest by their folder path, "Drums / Kicks" being two levels.
  function shotTree() {
    if (shots === null) return "";
    const rows = shots.filter((x) => hit(x));
    if (!shots.length) return `<div class="sv-doc sp-note" style="--depth:1">No one-shots yet. Add files or a folder, or drop them here.</div>`;
    if (!rows.length) return `<div class="sv-doc sp-note" style="--depth:1">Nothing matches.</div>`;
    const root = { dirs: new Map(), sounds: [], n: 0 };
    for (const x of rows) {
      let at = root; at.n++;
      for (const part of (x.folder || "").split(" / ").filter(Boolean)) {
        if (!at.dirs.has(part)) at.dirs.set(part, { dirs: new Map(), sounds: [], n: 0 });
        at = at.dirs.get(part); at.n++;
      }
      at.sounds.push(x);
    }
    const walk = (node, path, depth) => {
      let html = "";
      for (const [name, sub] of [...node.dirs].sort((a, b) => a[0].localeCompare(b[0], undefined, { sensitivity: "base", numeric: true }))) {
        const key = "shot:" + path + name + "/";  // ends in / so a path is never a prefix of its neighbour's
        const on = !!q() || open.has(key);
        html += folderRow(key, name, depth, sub.n);
        if (on) html += walk(sub, path + name + "/", depth + 1);
      }
      for (const x of node.sounds) html += soundRow(x, depth, true);
      return html;
    };
    return walk(root, "", 1);
  }
  function sampleTree() {
    if (songs === null) return "";
    const branch = (key, name, list) => {
      const on = open.has(key) || (!!q() && !!list);
      let html = folderRow(key, name, 1, list ? list.filter((x) => hit(x, name)).length : null);
      if (on && list) {
        const rows = list.filter((x) => hit(x, name));
        html += rows.length ? rows.map((x) => soundRow(x, 2, false)).join("") : `<div class="sv-doc sp-note" style="--depth:2">${q() ? "Nothing matches." : "Nothing here yet."}</div>`;
      }
      return html;
    };
    return (guest ? "" : branch("renders", "Renders waiting", kids.get("renders"))) +
      songs.map((x) => branch("song:" + x.id, x.title, kids.get(String(x.id)))).join("");
  }
  function tree() {
    items = [];
    const sh = open.has("oneshots") || !!q(), sa = open.has("samples") || (!!q() && songs !== null);
    return (problem ? `<div class="cv-err">${esc(problem)}</div>` : "") +
      (guest ? "" : folderRow("oneshots", "One-shots", 0, shots ? shots.length : null) + (sh ? shotTree() : "")) +
      folderRow("samples", "Samples", 0, songs ? songs.length + (guest ? 0 : 1) : null) + (sa ? sampleTree() : "");
  }
  function list() {
    const box = el.querySelector("#sp-listbox");
    if (box) box.innerHTML = tree(); else render();
  }

  async function bring(files) {
    const list = [...files];
    if (!list.length) return;
    try {
      const r = await uploadSamples(list, (n, of, name) => { busy = "Adding " + n + " of " + of + ": " + name; const b = el.querySelector("[role=status]"); if (b) b.textContent = busy; else render(); });
      busy = "";
      const said = [r.added ? r.added + (r.added === 1 ? " sound added" : " sounds added") : "", r.skipped ? r.skipped + " not sounds, skipped" : "", r.failed ? r.failed + " failed" : ""].filter(Boolean).join(", ");
      api.toast(said || "Nothing to add.");
    } catch (e) {
      busy = ""; api.toast(e.message === "signin" ? "Sign in to JR!TER to keep your sounds." : "Could not add them. " + (e.message || ""));
    }
    load("oneshots");
  }

  async function paint() {
    const t = track(), cv = modal.querySelector("#sp-wave");
    if (!t || !cv) return;
    const s = t.sample, r = cv.getBoundingClientRect(), d = devicePixelRatio || 1;
    if (r.width < 2) return requestAnimationFrame(paint);
    cv.width = Math.round(r.width * d); cv.height = Math.round(r.height * d);
    const g = cv.getContext("2d"); g.setTransform(d, 0, 0, d, 0, 0);
    const W = r.width, H = r.height, css = getComputedStyle(document.documentElement);
    const fg = css.getPropertyValue("--d-fg").trim() || "#ddd", acc = css.getPropertyValue("--d-acc").trim() || "#7af", mute = css.getPropertyValue("--d-mute").trim() || "#888";
    const bars = Math.max(8, Math.floor(W / 3));
    let p = wave.get(s.src);
    g.clearRect(0, 0, W, H);
    if (!p) { // a skeleton until the sound has decoded
      g.fillStyle = mute; g.globalAlpha = 0.25;
      for (let i = 0; i < bars; i++) { const h = H * (0.2 + 0.3 * Math.abs(Math.sin(i * 0.7))); g.fillRect(i * 3, (H - h) / 2, 2, h); }
      g.globalAlpha = 1;
      try {
        const buf = await api.buffer(s.src);
        wave.set(s.src, peaks(buf.getChannelData(0), 600));
        if (!s.seconds) { s.seconds = buf.duration; api.save(); }
      } catch { return; }
      return render();
    }
    const total = s.seconds || 1, x = (sec) => (sec / total) * W;
    g.fillStyle = fg;
    for (let i = 0; i < bars; i++) {
      const v = p[Math.min(p.length - 1, Math.floor((i / bars) * p.length))], h = Math.max(1, v * H * 0.9);
      g.globalAlpha = (i * 3 / W) * total >= s.start && (i * 3 / W) * total <= sampleEnd(s) ? 1 : 0.25;
      g.fillRect(i * 3, (H - h) / 2, 2, h);
    }
    g.globalAlpha = 1; g.strokeStyle = acc; g.fillStyle = acc; g.lineWidth = 2; g.font = "11px sans-serif";
    for (const [k, c] of [s.start, ...s.slices, sampleEnd(s)].entries()) {
      g.beginPath(); g.moveTo(x(c), 0); g.lineTo(x(c), H); g.stroke();
      if (s.slices.length && k <= s.slices.length) g.fillText(String(k + 1), x(c) + 4, 12);
    }
  }

  const secAt = (e, cv) => { const r = cv.getBoundingClientRect(); return clamp((e.clientX - r.left) / r.width, 0, 1) * (track()?.sample.seconds || 0); };

  on("pointerdown", (e) => {
    const cv = e.target.closest("#sp-wave"), t = track();
    if (!cv || !t || !t.sample.seconds) return;
    const s = t.sample, sec = secAt(e, cv), tol = (14 / cv.getBoundingClientRect().width) * s.seconds;
    const edge = Math.abs(sec - s.start) <= tol ? "start" : Math.abs(sec - sampleEnd(s)) <= tol ? "end" : "";
    drag = { id: e.pointerId, x0: e.clientX, edge, moved: false, before: api.snap(), cv, sec, tol };
    try { cv.setPointerCapture(e.pointerId); } catch { /* moves still arrive */ }
    clearTimeout(hold);
    if (!edge) hold = setTimeout(() => {
      if (!drag || drag.moved) return;
      const d = drag; drag = null; navigator.vibrate?.(12);
      api.change(() => { if (!removeSliceNear(s, d.sec, d.tol)) addSlice(s, d.sec); });
    }, 460);
  });
  on("pointermove", (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    if (!drag.moved && Math.abs(e.clientX - drag.x0) < 6) return;
    drag.moved = true; clearTimeout(hold);
    const t = track(); if (!t || !drag.edge) return;
    const s = t.sample, sec = secAt(e, drag.cv);
    if (drag.edge === "start") s.start = clamp(sec, 0, sampleEnd(s) - 0.01);
    else s.end = clamp(sec, s.start + 0.01, s.seconds);
    s.slices = s.slices.filter((c) => c > s.start && c < sampleEnd(s));
    paint();
  });
  const finish = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    clearTimeout(hold);
    const d = drag, t = track(); drag = null;
    if (d.moved && api.snap() !== d.before) { api.pushUndo(d.before); api.save(); render(); }
    else if (!d.moved && t) api.audition(t, d.sec, sampleEnd(t.sample)); // a tap plays from that point
  };
  on("pointerup", finish);
  on("pointercancel", finish);

  on("keydown", (e) => {
    const t = track();
    if (!t || !e.target.closest("#sp-wave") || (e.key !== "," && e.key !== ".")) return;
    e.preventDefault();
    const s = t.sample, d = (e.key === "." ? 1 : -1) * 0.01 * (e.altKey ? 10 : 1);
    api.change(() => {
      if (e.shiftKey) s.end = clamp(sampleEnd(s) + d, s.start + 0.01, s.seconds || 1e6);
      else s.start = clamp(s.start + d, 0, sampleEnd(s) - 0.01);
      s.slices = s.slices.filter((c) => c > s.start && c < sampleEnd(s));
    });
    modal.querySelector("#sp-wave")?.focus();
  });

  on("change", (e) => {
    if (e.target.id === "sp-files" || e.target.id === "sp-dir") { const f = [...e.target.files]; e.target.value = ""; return bring(f); }
    if (e.target.id === "sp-bpm") { const t = track(); if (t) { const v = +e.target.value; api.change(() => { t.sample.bpm = v >= 20 && v <= 400 ? Math.round(v * 100) / 100 : 0; }); } }
    if (e.target.id === "sp-root") { const t = track(); if (t) api.change(() => { t.sample.root = clamp(Math.round(+e.target.value) || 60, 0, 127); }); }
  });
  on("click", (e) => {
    const b = e.target.closest("button");
    if (!b || b.disabled) return;
    const t = track();
    if (b.dataset.act === "edit") { editing = !editing; renaming = null; if (editing) { open.add("oneshots"); keep(); want(); } return render(); }
    if (b.dataset.renamedir != null || b.dataset.rename != null) {
      renaming = b.dataset.renamedir != null ? b.dataset.renamedir : "sound:" + items[+b.dataset.rename].id;
      list();
      const f = el.querySelector(".sp-rename"); if (f) { f.focus(); f.select(); }
      return;
    }
    if (b.dataset.deldir != null) return deleteFolder(pathOf(b.dataset.deldir));
    if (b.dataset.dir != null) {
      const k = b.dataset.dir;
      if (open.has(k)) open.delete(k); else open.add(k);
      keep(); want(); list();
      el.querySelector(`[data-dir="${CSS.escape(k)}"]`)?.focus();
      return;
    }
    if (b.dataset.hear != null) { const x = items[+b.dataset.hear]; return x.kind === "midi" ? api.hearMidi(x) : api.hear(x.src); }
    if (b.dataset.topat != null) return api.midiToPattern(items[+b.dataset.topat], { fresh: true });
    if (b.dataset.add != null) return api.addSampler(items[+b.dataset.add]);
    if (b.dataset.rack != null) return api.addSampler(items[+b.dataset.rack], { rack: true });
    if (b.dataset.del != null) {
      const x = items[+b.dataset.del];
      return removeSample(x.id).then(() => {
        api.toast("Deleted " + x.name + ".", { label: "Undo", run: () => restoreSample(x.id).then(() => load("oneshots")) });
        load("oneshots");
      });
    }
    if (b.dataset.act === "files") return el.querySelector("#sp-files").click();
    if (b.dataset.act === "folder") return el.querySelector("#sp-dir").click();
    if (b.dataset.act === "oneshot") { const t = track(); if (t) api.change(() => { t.sample.oneshot = !t.sample.oneshot; if (t.sample.oneshot) t.sample.loop = false; }); return; }
    if (b.dataset.act === "loop") { const t = track(); if (t) api.change(() => { t.sample.loop = !t.sample.loop; }); return; }
    if (b.dataset.act === "cut") { const t = track(); if (t) api.change(() => { t.sample.cut = !t.sample.cut; }); return; }
    if (b.dataset.act === "instrument") return openInstrument();
    if (b.dataset.act === "close") return closeInstrument();
    if (b.dataset.act === "resample") { const t = track(); if (!t) return; b.disabled = true; b.textContent = "Resampling…"; return api.resample(api.selected()).finally(() => { shots = null; want(); render(); }); }
    if (b.dataset.act === "guess") { const t = track(); if (!t) return; const g = guessBpm(t.sample); if (!g) return api.toast("Trim it to whole bars first."); return api.change(() => { t.sample.bpm = g; }); }
    if (b.dataset.act === "keep") { const t = track(); if (t) api.change(() => { t.sample.warp = t.sample.warp === "pitch" ? "time" : "pitch"; }); return; }
    if (!t) return;
    if (b.dataset.chop) api.change(() => chop(t.sample, +b.dataset.chop));
    else if (b.dataset.act === "clear") api.change(() => chop(t.sample, 1));
    else if (b.dataset.act === "hear") api.audition(t, t.sample.start, sampleEnd(t.sample));
    else if (b.dataset.act === "place") { editingInstrument = false; renderModal(); api.placeOnSong(api.selected()); }
  });

  // The filter changes only the list, so the box keeps focus while you type.
  on("input", (e) => {
    if (e.target.id !== "sp-q") return;
    query = e.target.value;
    // Searching looks in everything: fetch the roots it needs, then draw.
    if (q()) { if (!guest && shots === null) fetchFor("oneshots"); if (songs === null) fetchFor("samples"); }
    list();
  });
  // Renaming in place: Enter keeps it, Escape or leaving the field without a change puts it back.
  on("keydown", (e) => {
    if (!e.target.classList?.contains("sp-rename")) return;
    if (e.key === "Enter") { e.preventDefault(); renameDone(e.target, true); }
    else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); renameDone(e.target, false); }
  });
  on("focusout", (e) => { if (e.target.classList?.contains("sp-rename") && renaming) renameDone(e.target, true); });

  // Arranging: a sound or a folder dragged onto a folder (or onto One-shots, the top) moves there.
  // A MIDI file is dragged out to the roll or a pattern; daw.js takes the drop.
  on("dragstart", (e) => {
    const m = !editing && e.target.closest?.("[data-midi]"), s = !editing && e.target.closest?.("[data-sound]");
    if (!m && !s) return;
    const x = items[+(m || s).dataset[m ? "midi" : "sound"]];
    if (m) e.dataTransfer.setData(MIDI_TYPE, JSON.stringify({ name: x.name, src: x.src }));
    else e.dataTransfer.setData(SOUND_TYPE, JSON.stringify({ name: x.name, src: x.src, seconds: x.seconds || 0, kind: x.kind }));
    e.dataTransfer.setData("text/plain", x.name);
    e.dataTransfer.effectAllowed = "copy";
  });
  on("dragstart", (e) => {
    const s = e.target.closest?.("[data-movesound]"), d = e.target.closest?.("[data-movedir]");
    if (!editing || (!s && !d)) return;
    moving = s ? { kind: "sound", x: items[+s.dataset.movesound] } : { kind: "dir", path: pathOf(d.dataset.movedir) };
    e.dataTransfer.setData("text/plain", s ? moving.x.name : moving.path);
    e.dataTransfer.effectAllowed = "move";
    (s || d).classList.add("sp-moving");
  });
  on("dragend", () => { moving = null; el.querySelectorAll(".sp-moving, .sp-over").forEach((n) => n.classList.remove("sp-moving", "sp-over")); });
  on("dragover", (e) => {
    const t = moving && e.target.closest?.("[data-drop]");
    el.querySelectorAll(".sp-over").forEach((n) => n !== t && n.classList.remove("sp-over"));
    if (!t) return;
    e.preventDefault(); e.dataTransfer.dropEffect = "move"; t.classList.add("sp-over");
  });
  on("drop", (e) => {
    const t = moving && e.target.closest?.("[data-drop]");
    if (!t) return;
    e.preventDefault(); e.stopImmediatePropagation();
    const m = moving; moving = null; t.classList.remove("sp-over");
    const to = t.dataset.drop === "oneshots" ? "" : pathOf(t.dataset.drop);
    if (m.kind === "sound") {
      if (m.x.folder === to) return;
      return changeSample(m.x.id, { folder: to }).then((ok) => { if (ok) { m.x.folder = to; api.toast("Moved " + m.x.name + (to ? " to " + to : " to the top") + "."); } list(); });
    }
    const leaf = m.path.split(" / ").pop(), dest = to ? to + " / " + leaf : leaf;
    if (dest === m.path) return;
    if (inside(to, m.path)) return api.toast("A folder can't go inside itself.");
    moveFolder(m.path, dest, "Moved " + leaf + (to ? " into " + to : " to the top"));
  }, true);

  // Drop sound files (or a folder) on the tab.
  on("dragover", (e) => { if ([...(e.dataTransfer?.types || [])].includes("Files")) e.preventDefault(); });
  on("drop", async (e) => {
    const items = [...(e.dataTransfer?.items || [])];
    if (!items.length && !(e.dataTransfer?.files || []).length) return;
    e.preventDefault();
    const files = [];
    const walk = async (entry, path) => {
      if (entry.isFile) await new Promise((ok) => entry.file((f) => { f._path = path + f.name; files.push(f); ok(); }, ok));
      else if (entry.isDirectory) {
        const rd = entry.createReader();
        for (let batch = await new Promise((ok) => rd.readEntries(ok, () => ok([]))); batch.length; batch = await new Promise((ok) => rd.readEntries(ok, () => ok([])))) {
          for (const c of batch) await walk(c, path + entry.name + "/");
        }
      }
    };
    const entries = items.map((i) => (i.webkitGetAsEntry ? i.webkitGetAsEntry() : null)).filter(Boolean);
    if (entries.length) for (const en of entries) await walk(en, ""); else files.push(...e.dataTransfer.files);
    bring(files.filter(isSound));
  });

  return {
    render: () => { render(); want(); },
    show: (which) => load(which),
    edit: () => openInstrument(),
    refresh: () => renderModal(),
    close: () => closeInstrument(),
  };
}
