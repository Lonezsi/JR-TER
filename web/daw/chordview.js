// chordview.js: the chord editor. Opens first. Build a progression, voice it, hear it, then
// "To MIDI" turns it into notes. One way: nothing here reads notes back into chords.
//
//   mountChords(el, api)
//   api: song(), change(fn) (an undoable edit), undo(), sound(pitches), hear(notes) -> stop(),
//        toMidi(notes, target), toast(text, action)
import { parseChord, voiceProgression, progressionToNotes, progressionFromText, progressionToText, ROOT_NAMES } from "./chords.js";

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const QUALITY = [["maj", ""], ["m", "m"], ["7", "7"], ["maj7", "maj7"], ["m7", "m7"], ["9", "9"], ["maj9", "maj9"], ["m9", "m9"],
  ["11", "11"], ["13", "13"], ["6", "6"], ["m6", "m6"], ["6/9", "6/9"], ["dim", "dim"], ["dim7", "dim7"], ["ø", "ø"], ["aug", "aug"],
  ["sus2", "sus2"], ["sus4", "sus4"], ["5", "5"]];
const ALTER = ["b9", "#9", "#11", "b13", "b5", "#5", "add9", "add11", "add13", "no3", "no5"];
const ALT_TOKENS = ["add13", "add11", "add9", "add4", "add2", "no3", "no5", "b13", "#11", "#9", "b9", "#5", "b5"];
const DROPS = [[0, "none"], [2, "drop 2"], [3, "drop 3"], [24, "2+4"]];

// A symbol as parts, and back. The symbol stays the truth; the chips only rewrite it.
export function splitSymbol(sym) {
  const m = /^([A-Ga-g][#b]?)(.*)$/.exec(sym) || ["", "C", ""];
  let rest = m[2], bass = "";
  const sl = /\/([A-Ga-g][#b]?)$/.exec(rest);
  if (sl) { bass = sl[1]; rest = rest.slice(0, sl.index); }
  rest = rest.replace(/[(), ]/g, "");
  const alts = [];
  let base = "";
  for (let i = 0; i < rest.length;) {
    const a = ALT_TOKENS.find((t) => rest.startsWith(t, i));
    if (a) { alts.push(a); i += a.length; } else { base += rest[i]; i++; }
  }
  return { root: m[1], base, alts, bass };
}
export const joinSymbol = ({ root, base, alts, bass }) => root + base + alts.join("") + (bass ? "/" + bass : "");
const flat = (name) => ({ "C#": "Db", "D#": "Eb", "F#": "Gb", "G#": "Ab", "A#": "Bb" }[name] || name);

export function mountChords(el, api) {
  let si = 0, stopHear = null;
  const prog = () => api.song().chords;
  const cur = () => prog().chords[Math.min(si, prog().chords.length - 1)];
  const run = (fn) => api.change(fn);

  function setSymbol(next) {
    try { parseChord(next); } catch (e) { return err(e.message); }
    run(() => { cur().symbol = next; });
    sounds();
  }
  const err = (m) => { const e = el.querySelector(".cv-err"); if (e) e.textContent = m || ""; };
  const sounds = () => { const v = voiceProgression(prog())[si]; if (v) api.sound(v.pitches); };

  function render() {
    const p = prog();
    if (si >= p.chords.length) si = p.chords.length - 1;
    const c = cur(), parts = splitSymbol(c.symbol), voiced = voiceProgression(p)[si];
    const auto = p.voiceLead && c.inversion === undefined && c.octave === undefined;
    const bassOpts = ["", ...ROOT_NAMES.map(flat)];
    el.innerHTML =
      `<div class="cv-title">Progression</div>` +
      `<div class="cv-strip" id="cv-strip" role="list">` +
        p.chords.map((x, i) => `<button class="cc" role="listitem" data-act="pick" data-i="${i}" aria-pressed="${i === si}"><b>${esc(x.symbol)}</b><small>${x.beats ?? 4} beats</small></button>`).join("") +
        `<button class="cc" data-act="add" aria-label="Add a chord"><b>+</b><small>add</small></button>` +
      `</div>` +
      `<div class="cv-line"><input id="cv-text" type="text" spellcheck="false" aria-label="Progression as text" value="${esc(progressionToText(p.chords))}">` +
        `<button data-act="left" aria-label="Move chord earlier">◀</button><button data-act="right" aria-label="Move chord later">▶</button></div>` +
      `<div class="cv-err" role="alert"></div>` +
      `<div class="cv-edit">` +
        `<div class="cv-line"><label>Chord <input id="cv-sym" class="cv-sym" type="text" spellcheck="false" value="${esc(c.symbol)}"></label>` +
          `<label>Bass <select id="cv-bass">${bassOpts.map((b) => `<option value="${b}"${b === parts.bass ? " selected" : ""}>${b || "none"}</option>`).join("")}</select></label></div>` +
        `<div class="cv-title">Root</div><div class="cv-chips">${ROOT_NAMES.map((r) => `<button data-act="root" data-v="${flat(r)}" aria-pressed="${flat(r) === parts.root || r === parts.root}">${flat(r)}</button>`).join("")}</div>` +
        `<div class="cv-title">Type</div><div class="cv-chips">${QUALITY.map(([label, v]) => `<button data-act="quality" data-v="${esc(v)}" aria-pressed="${v === parts.base}">${esc(label)}</button>`).join("")}</div>` +
        `<div class="cv-title">Extensions and alterations</div><div class="cv-chips">${ALTER.map((a) => `<button data-act="alt" data-v="${a}" aria-pressed="${parts.alts.includes(a)}">${a}</button>`).join("")}</div>` +
        `<div class="cv-title">Voicing</div>` +
        `<div class="cv-line">` +
          step("Inversion", "inv", c.inversion ?? (voiced && auto ? "auto" : 0)) + step("Octave", "oct", c.octave ?? 4) + step("Beats", "beats", c.beats ?? 4) +
          `<button data-act="auto" aria-pressed="${auto}" ${p.voiceLead ? "" : "disabled"}>Auto</button></div>` +
        `<div class="cv-line cv-chips">${DROPS.map(([v, label]) => `<button data-act="drop" data-v="${v}" aria-pressed="${(c.drop ?? 0) === v}">${label}</button>`).join("")}` +
          `<button data-act="spread" aria-pressed="${!!c.spread}">Spread</button><button data-act="bass" aria-pressed="${!!c.bass}">Bass note</button></div>` +
        `<canvas class="cv-keys" id="cv-keys" aria-label="The notes of this chord"></canvas>` +
      `</div>` +
      `<div class="cv-line"><button data-act="lead" aria-pressed="${!!p.voiceLead}">Voice leading</button>` +
        `<label>Strum <input id="cv-strum" type="number" min="0" max="80" step="5" value="${p.strumMs ?? 0}"> ms</label>` +
        `<label>Velocity <input id="cv-vel" type="number" min="1" max="127" value="${p.velocity ?? 90}"></label></div>` +
      `<div class="cv-line"><button data-act="hear" aria-pressed="${!!stopHear}">${stopHear ? "■ Stop" : "▶ Hear it"}</button>` +
        `<select id="cv-target" aria-label="Where the notes go"><option value="new">New track “Chords”</option><option value="selected">The selected track</option></select>` +
        `<button data-act="midi" id="cv-midi"><b>To MIDI</b></button></div>` +
      `<div class="sv-doc">To MIDI writes the notes into the song and switches to the roll. It is one way: the notes are plain notes afterwards, and this progression stays here for next time.</div>`;
    drawKeys(voiced ? voiced.pitches : []);
  }
  function step(label, act, value) {
    return `<span class="cv-step">${label} <button data-act="${act}-" aria-label="${label} down">−</button><output>${esc(value)}</output><button data-act="${act}+" aria-label="${label} up">+</button></span>`;
  }

  // ---- the little keyboard --------------------------------------------------------------
  let keyRange = [48, 72];
  function drawKeys(pitches) {
    const cv = el.querySelector("#cv-keys");
    if (!cv) return;
    const lo = pitches.length ? Math.floor(Math.min(...pitches) / 12) * 12 : 48;
    const hi = Math.max(lo + 24, Math.ceil((Math.max(...pitches, lo) + 1) / 12) * 12);
    keyRange = [lo, hi];
    const r = cv.getBoundingClientRect(), d = devicePixelRatio || 1, W = Math.max(r.width, 200), H = 72;
    cv.width = W * d; cv.height = H * d;
    const g = cv.getContext("2d"); g.setTransform(d, 0, 0, d, 0, 0);
    const css = getComputedStyle(document.documentElement);
    const acc = css.getPropertyValue("--d-acc").trim() || "#FAA8B8", fg = css.getPropertyValue("--d-fg").trim() || "#fff", line = css.getPropertyValue("--d-line").trim() || "#555";
    const white = []; for (let p = lo; p < hi; p++) if (![1, 3, 6, 8, 10].includes(p % 12)) white.push(p);
    const w = W / white.length;
    white.forEach((p, i) => { g.fillStyle = pitches.includes(p) ? acc : fg; g.globalAlpha = pitches.includes(p) ? 1 : 0.16; g.fillRect(i * w + 1, 0, w - 2, H); });
    g.globalAlpha = 1;
    for (let p = lo; p < hi; p++) {
      if (![1, 3, 6, 8, 10].includes(p % 12)) continue;
      const i = white.indexOf(p - 1);
      g.fillStyle = pitches.includes(p) ? acc : "#0b0b0e"; g.fillRect((i + 1) * w - w * 0.3, 0, w * 0.6, H * 0.6);
      g.strokeStyle = line; g.strokeRect((i + 1) * w - w * 0.3, 0, w * 0.6, H * 0.6);
    }
    cv._geom = { lo, hi, white, w, H };
  }
  function keyAt(cv, e) {
    const g = cv._geom; if (!g) return null;
    const r = cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    const wi = Math.min(g.white.length - 1, Math.max(0, Math.floor(x / g.w)));
    if (y < g.H * 0.6) {
      for (const off of [-1, 1]) {
        const p = g.white[wi] + (off > 0 ? 1 : -1);
        if ([1, 3, 6, 8, 10].includes(p % 12)) { const i = g.white.indexOf(p - 1), cx = (i + 1) * g.w; if (Math.abs(x - cx) < g.w * 0.3) return p; }
      }
    }
    return g.white[wi];
  }

  // ---- events ---------------------------------------------------------------------------
  let holdTimer = 0, held = false;
  el.addEventListener("pointerdown", (e) => {
    const b = e.target.closest('[data-act="pick"]');
    held = false; clearTimeout(holdTimer);
    if (!b) return;
    holdTimer = setTimeout(() => { // hold a chord to delete it
      held = true;
      if (prog().chords.length < 2) return api.toast("A progression needs at least one chord.");
      const i = +b.dataset.i;
      navigator.vibrate?.(12);
      run(() => { prog().chords.splice(i, 1); si = Math.max(0, Math.min(si, prog().chords.length - 1)); });
      api.toast("Chord deleted.", { label: "Undo", run: api.undo });
    }, 520);
  });
  for (const t of ["pointerup", "pointercancel", "pointermove"]) el.addEventListener(t, (e) => { if (t !== "pointermove" || Math.abs(e.movementX) + Math.abs(e.movementY) > 6) clearTimeout(holdTimer); });
  el.addEventListener("click", (e) => {
    const keys = e.target.closest("#cv-keys");
    if (keys) { const p = keyAt(keys, e); if (p !== null) api.sound([p]); return; }
    const b = e.target.closest("[data-act]");
    if (!b || b.disabled) return;
    if (held) { held = false; return; }
    const p = prog(), c = cur(), act = b.dataset.act, v = b.dataset.v;
    const parts = splitSymbol(c.symbol);
    if (act === "pick") { si = +b.dataset.i; render(); sounds(); }
    else if (act === "add") { run(() => { p.chords.splice(si + 1, 0, { ...JSON.parse(JSON.stringify(c)) }); si++; }); sounds(); }
    else if (act === "left" || act === "right") {
      const j = si + (act === "left" ? -1 : 1);
      if (j >= 0 && j < p.chords.length) run(() => { [p.chords[si], p.chords[j]] = [p.chords[j], p.chords[si]]; si = j; });
    }
    else if (act === "root") setSymbol(joinSymbol({ ...parts, root: v }));
    else if (act === "quality") setSymbol(joinSymbol({ ...parts, base: v }));
    else if (act === "alt") setSymbol(joinSymbol({ ...parts, alts: parts.alts.includes(v) ? parts.alts.filter((a) => a !== v) : [...parts.alts, v] }));
    else if (act === "inv-" || act === "inv+") { run(() => { c.inversion = clampInt((c.inversion ?? 0) + (act === "inv+" ? 1 : -1), -4, 4); }); sounds(); }
    else if (act === "oct-" || act === "oct+") { run(() => { c.octave = clampInt((c.octave ?? 4) + (act === "oct+" ? 1 : -1), 1, 7); }); sounds(); }
    else if (act === "beats-" || act === "beats+") run(() => { c.beats = Math.max(0.5, Math.min(32, (c.beats ?? 4) + (act === "beats+" ? 0.5 : -0.5))); });
    else if (act === "auto") { run(() => { delete c.inversion; delete c.octave; }); sounds(); }
    else if (act === "drop") { run(() => { c.drop = +v; }); sounds(); }
    else if (act === "spread") { run(() => { c.spread = !c.spread; }); sounds(); }
    else if (act === "bass") { run(() => { c.bass = !c.bass; }); sounds(); }
    else if (act === "lead") run(() => { p.voiceLead = !p.voiceLead; });
    else if (act === "hear") {
      if (stopHear) { stopHear(); stopHear = null; render(); return; }
      stopHear = api.hear(progressionToNotes(p, { bpm: api.song().bpm }), () => { stopHear = null; render(); });
      render();
    }
    else if (act === "midi") {
      const notes = progressionToNotes(p, { bpm: api.song().bpm });
      api.toMidi(notes, el.querySelector("#cv-target").value);
    }
  });
  el.addEventListener("change", (e) => {
    const id = e.target.id;
    if (id === "cv-text") {
      try { const chords = progressionFromText(e.target.value); if (!chords.length) throw new Error("Write at least one chord."); run(() => { prog().chords = chords.map((c, i) => ({ ...(prog().chords[i] || {}), ...c })); si = Math.min(si, chords.length - 1); }); }
      catch (x) { err(x.message); }
    } else if (id === "cv-sym") setSymbol(e.target.value.trim());
    else if (id === "cv-bass") setSymbol(joinSymbol({ ...splitSymbol(cur().symbol), bass: e.target.value }));
    else if (id === "cv-strum") run(() => { prog().strumMs = clampInt(+e.target.value || 0, 0, 80); });
    else if (id === "cv-vel") run(() => { prog().velocity = clampInt(+e.target.value || 90, 1, 127); });
  });
  addEventListener("resize", () => { if (el.offsetParent) drawKeys(voiceProgression(prog())[si]?.pitches || []); });
  const clampInt = (v, a, b) => Math.max(a, Math.min(b, Math.round(v)));

  return { render, select: (i) => { si = i; render(); } };
}
