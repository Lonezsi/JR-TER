// rackview.js: the channel rack. One row of 16 steps per channel, a pattern picker, swing.
//
//   mountRack(el, api) -> { render, playhead(step) }
//   api: song(), change(fn) (undoable edit), snap(), pushUndo(before), save(), selected(), select(i),
//        addTrack(), addDrums(), addSample(), preview(trackIndex, step), usePattern(k), newPattern(dup), removePattern()
// Swing is a knob (knob.js). Tap a step to turn it on or off. Drag a lit step up or down: velocity (or pitch in the Pitch lane).
import { icon } from "./icons.js";
import { STEPS } from "./pattern.js";
import { knob, wireKnobs } from "./knob.js";

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const noteName = (p) => NAMES[p % 12] + (Math.floor(p / 12) - 1);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

export function mountRack(el, api) {
  let lane = "velocity";
  let drag = null;

  function render() {
    lastStep = -1;
    const song = api.song();
    const pats = song.patterns || [];
    const k = song.pattern || 0;
    el.innerHTML =
            `<div class="cv-line rk-pats" role="group" aria-label="Patterns">` +
        pats.map((p, i) => `<button data-pat="${i}" aria-pressed="${i === k}" data-tip="${esc(p.name)}" aria-label="${esc(p.name)}">${i + 1}</button>`).join("") +
        `<button data-act="newpat" aria-label="New pattern" data-tip="New pattern">${icon("plus")}New</button>` +
        `<button data-act="duppat" aria-label="Duplicate this pattern" data-tip="Duplicate this pattern">Duplicate</button>` +
        `<button data-act="delpat" aria-label="Delete this pattern" data-tip="Delete this pattern"${pats.length < 2 ? " disabled" : ""}>Delete</button>` +
      `</div>` +
      `<div class="cv-line"><label>Name <input id="rk-name" type="text" value="${esc((pats[k] && pats[k].name) || "Pattern 1")}"></label>` +
        `<label class="ins-k">${knob({ key: "swing", label: "Swing", value: Math.round((song.swing || 0) * 100), lo: 0, hi: 100, home: 0, step: 1, words: Math.round((song.swing || 0) * 100) + "%" })}<span>Swing</span><output>${Math.round((song.swing || 0) * 100)}%</output></label></div>` +
      `<div class="cv-line rk-lane" role="group" aria-label="What a drag changes">` +
        `<button data-lane="velocity" aria-pressed="${lane === "velocity"}" data-tip="Drag a lit step up or down to set how hard it hits">Velocity</button>` +
        `<button data-lane="pitch" aria-pressed="${lane === "pitch"}" data-tip="Drag a lit step up or down to set its note">Pitch</button>` +
        `<button data-act="chan" aria-label="New channel" data-tip="New channel">${icon("plus")}Channel</button>` +
        `<button data-act="drums" aria-label="Add kick, snare and hat with a beat" data-tip="Add kick, snare and hat with a beat">${icon("plus")}Drums</button>` +
        `<button data-act="sample" aria-label="Add one of your own one-shots as a channel" data-tip="Add one of your own one-shots as a channel">${icon("plus")}Sample</button></div>` +
      `<div class="rk-rows">` +
      song.tracks.map((t, ti) => {
        const steps = (t.steps || []);
        let cells = "";
        for (let i = 0; i < STEPS; i++) {
          const s = steps[i];
          const fill = s ? (lane === "velocity" ? s.velocity / 127 : (clamp(s.pitch, 24, 96) - 24) / 72) : 0;
          cells += `<button class="rk-step${i % 4 === 0 ? " beat" : ""}" data-t="${ti}" data-i="${i}" aria-pressed="${!!s}" aria-label="${esc(t.name)} step ${i + 1}" style="--fill:${fill.toFixed(3)}">` +
            (s && lane === "pitch" ? `<span>${noteName(s.pitch)}</span>` : "") + `</button>`;
        }
        return `<div class="rk-row${ti === api.selected() ? " sel" : ""}"><button class="rk-name" data-pick="${ti}" aria-pressed="${ti === api.selected()}">${esc(t.name)}</button><div class="rk-steps">${cells}</div></div>`;
      }).join("") + `</div>`;
  }

  function toggle(ti, i) {
    const song = api.song(), t = song.tracks[ti];
    api.change(() => { t.steps[i] = t.steps[i] ? null : { velocity: 100, pitch: t.key }; });
    if (t.steps[i]) api.preview(ti, t.steps[i]);
  }
  function nudge(ti, i, dv) {
    const t = api.song().tracks[ti], s = t.steps[i];
    if (!s) return;
    api.change(() => {
      if (lane === "velocity") s.velocity = clamp(s.velocity + dv * 8, 1, 127); else s.pitch = clamp(s.pitch + dv, 0, 127);
    });
    api.preview(ti, s);
    el.querySelector(`.rk-step[data-t="${ti}"][data-i="${i}"]`)?.focus();
  }
  function paint(btn, s) {
    const fill = lane === "velocity" ? s.velocity / 127 : (clamp(s.pitch, 24, 96) - 24) / 72;
    btn.style.setProperty("--fill", fill.toFixed(3));
    if (lane === "pitch") btn.innerHTML = `<span>${noteName(s.pitch)}</span>`;
  }

  // Pointer: a press on a lit step may become a drag; anything else is a tap on release.
  el.addEventListener("pointerdown", (e) => {
    const b = e.target.closest(".rk-step");
    if (!b) return;
    const ti = +b.dataset.t, i = +b.dataset.i, s = api.song().tracks[ti].steps[i];
    drag = { ti, i, b, y0: e.clientY, moved: false, before: api.snap(), v0: s ? (lane === "velocity" ? s.velocity : s.pitch) : 0, lit: !!s, id: e.pointerId };
    try { b.setPointerCapture(e.pointerId); } catch { /* not capturable: moves still arrive */ }
  });
  el.addEventListener("pointermove", (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dy = drag.y0 - e.clientY;
    if (!drag.lit || (!drag.moved && Math.abs(dy) < 6)) return;
    drag.moved = true;
    const s = api.song().tracks[drag.ti].steps[drag.i];
    if (!s) return;
    if (lane === "velocity") s.velocity = clamp(Math.round(drag.v0 + dy * 0.8), 1, 127);
    else { const p = clamp(Math.round(drag.v0 + dy / 8), 0, 127); if (p !== s.pitch) api.preview(drag.ti, { ...s, pitch: p }); s.pitch = p; }
    paint(drag.b, s);
  });
  const end = (e, cancelled) => {
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag; drag = null;
    if (d.moved) {
      if (api.snap() !== d.before) { api.pushUndo(d.before); api.save(); }
      return;
    }
    if (!cancelled) { e.preventDefault(); d.tapped = true; toggle(d.ti, d.i); }
  };
  el.addEventListener("pointerup", (e) => end(e, false));
  el.addEventListener("pointercancel", (e) => end(e, true));
  // Keyboard: Enter/Space fire click on the button; pointer taps are handled above, so ignore
  // clicks that carry a pointer (detail > 0).
  el.addEventListener("click", (e) => {
    const step = e.target.closest(".rk-step");
    if (step) { if (e.detail === 0) toggle(+step.dataset.t, +step.dataset.i); return; }
    const pat = e.target.closest("[data-pat]");
    if (pat) return api.usePattern(+pat.dataset.pat);
    const ln = e.target.closest("[data-lane]");
    if (ln) { lane = ln.dataset.lane; return render(); }
    const pick = e.target.closest("[data-pick]");
    if (pick) { api.select(+pick.dataset.pick); return render(); }
    const act = e.target.closest("[data-act]");
    if (!act) return;
    const a = act.dataset.act;
    if (a === "newpat") api.newPattern(false);
    else if (a === "duppat") api.newPattern(true);
    else if (a === "delpat") api.removePattern();
    else if (a === "chan") api.addTrack();
    else if (a === "drums") api.addDrums();
    else if (a === "sample") api.addSample();
  });
  el.addEventListener("keydown", (e) => {
    const b = e.target.closest && e.target.closest(".rk-step");
    if (!b) return;
    const ti = +b.dataset.t, i = +b.dataset.i;
    if (e.key === "ArrowUp" || e.key === "ArrowDown") { e.preventDefault(); nudge(ti, i, e.key === "ArrowUp" ? 1 : -1); }
    else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      el.querySelector(`.rk-step[data-t="${ti}"][data-i="${clamp(i + (e.key === "ArrowRight" ? 1 : -1), 0, STEPS - 1)}"]`)?.focus();
    }
  });
  el.addEventListener("change", (e) => {
    if (e.target.id === "rk-name") api.change(() => { const s = api.song(); s.patterns[s.pattern].name = e.target.value || "Pattern"; });
  });
  let before = null;
  wireKnobs(el, {
    begin: () => { if (before === null) before = api.snap(); },
    end: () => { if (before !== null && api.snap() !== before) { api.pushUndo(before); api.save(); } before = null; },
    turn: (key, v, node) => {
      api.song().swing = v / 100;
      const out = node.closest(".ins-k")?.querySelector("output"); if (out) out.textContent = v + "%";
      api.save();
      return v + "%";
    },
  });

  let lastStep = -1;
  function playhead(step) {
    if (step === lastStep) return;
    lastStep = step;
    el.querySelectorAll(".rk-step.now").forEach((x) => x.classList.remove("now"));
    if (step >= 0) el.querySelectorAll(`.rk-step[data-i="${step}"]`).forEach((x) => x.classList.add("now"));
  }
  return { render, playhead: (s) => { playhead(s); } , reset: () => { lastStep = -1; } };
}
