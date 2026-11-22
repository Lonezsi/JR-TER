// autolanes.js: automation lanes on the Song tab. The model and maths are in automation.js.
//
//   const lanes = mountLanes(el, api, { barPx, step, render })   barPx() and step() (beats, 0 = none) are asked every time: the Song tab zooms
//   lanes.button()      the "+ Automate" button (put it in a button line)
//   lanes.menu(song)    the list of knobs, empty when closed
//   lanes.html(song, bars)   the lanes, to go inside the song grid
// api: song(), change(fn), snap(), pushUndo(before), save(), toast(text, action), undo()
//
// Tap a lane to add a point. Drag a point to move it (it stays between its neighbours). Hold a point
// to delete it. With the keyboard on a point: arrows move it (Shift = a bar sideways), Delete removes it.
import { targets, targetSpec, addPoint, removePoint } from "./automation.js";
import { snapRound } from "./snap.js";

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const H = 64;      // lane height in px
const fmt = (v) => (Math.abs(v) >= 10 ? v.toFixed(1) : v.toFixed(2));

export function mountLanes(el, api, { barPx, step, render }) {
  let open = false, drag = null, hold = 0, quiet = 0; // quiet: the click a long press ends with must not add a point
  const xOf = (beat) => (beat / 4) * barPx();
  const yOf = (spec, v) => (1 - (v - spec.min) / (spec.max - spec.min)) * (H - 12) + 6;
  const beatOf = (x) => Math.max(0, snapRound((x / barPx()) * 4, step()));
  const valueOf = (spec, y) => Math.round((spec.min + (1 - clamp((y - 6) / (H - 12), 0, 1)) * (spec.max - spec.min)) * 10000) / 10000;

  function line(lane, spec, width) {
    const p = lane.points;
    if (!p.length) return "";
    const pts = [[0, yOf(spec, p[0].value)], ...p.map((q) => [xOf(q.beat), yOf(spec, q.value)]), [width, yOf(spec, p[p.length - 1].value)]];
    return pts.map((q) => q[0].toFixed(1) + "," + q[1].toFixed(1)).join(" ");
  }

  function laneHtml(song, lane, li, width) {
    const spec = targetSpec(song, lane.target);
    if (!spec) return "";
    return `<div class="al-head"><span>${esc(spec.label)}</span><button data-al="del" data-l="${li}" aria-label="Remove the lane ${esc(spec.label)}" data-tip="Remove this lane">✕</button></div>` +
      `<div class="al-lane" data-l="${li}" style="width:${width}px">` +
      `<svg width="${width}" height="${H}" aria-hidden="true"><polyline points="${line(lane, spec, width)}" /></svg>` +
      lane.points.map((p, i) => `<button class="al-pt" data-l="${li}" data-i="${i}" style="left:${xOf(p.beat)}px;top:${yOf(spec, p.value)}px" aria-label="${esc(spec.label)}, bar ${(p.beat / 4 + 1).toFixed(2)}, value ${fmt(p.value)}"></button>`).join("") +
      `</div>`;
  }

  const html = (song, bars) => (song.automation || []).map((l, i) => laneHtml(song, l, i, bars * barPx())).join("");
  const button = () => `<button data-al="open" aria-expanded="${open}" aria-label="Automate a knob" data-tip="Automate a knob over time">+ Automate</button>`;
  function menu(song) {
    if (!open) return "";
    const used = new Set((song.automation || []).map((l) => l.target));
    return `<div class="al-menu" role="menu" aria-label="Knobs to automate">` +
      targets(song).map((t) => `<button role="menuitem" data-al="add" data-target="${esc(t.id)}"${used.has(t.id) ? " disabled" : ""}>${esc(t.label)}</button>`).join("") + `</div>`;
  }

  const lane = (i) => (api.song().automation || [])[i];
  function refocus(l, i) { el.querySelector(`.al-pt[data-l="${l}"][data-i="${i}"]`)?.focus(); }
  function dropPoint(l, i) {
    api.change(() => removePoint(lane(l), i));
    api.toast("Point deleted.", { label: "Undo", run: api.undo });
  }
  function closeMenu() {
    if (!open) return;
    open = false;
    el.querySelector(".al-menu")?.remove();
    el.querySelector('[data-al="open"]')?.setAttribute("aria-expanded", "false");
  }

  el.addEventListener("click", (e) => {
    const b = e.target.closest("[data-al]");
    if (b) {
      const song = api.song(), what = b.dataset.al;
      if (what === "open") { open = !open; return render(); }
      if (what === "add" && !b.disabled) {
        open = false;
        api.change(() => { song.automation = song.automation || []; song.automation.push({ target: b.dataset.target, points: [] }); });
        return;
      }
      if (what === "del") {
        api.change(() => { song.automation.splice(+b.dataset.l, 1); });
        api.toast("Lane removed.", { label: "Undo", run: api.undo });
      }
      return;
    }
    if (e.target.closest(".al-pt") || Date.now() < quiet) return;
    const laneEl = e.target.closest(".al-lane");
    if (!laneEl) return;
    const l = +laneEl.dataset.l, song = api.song(), ln = lane(l), spec = ln && targetSpec(song, ln.target);
    if (!spec) return;
    const r = laneEl.getBoundingClientRect();
    api.change(() => { addPoint(ln, beatOf(e.clientX - r.left), valueOf(spec, e.clientY - r.top)); });
  });

  el.addEventListener("pointerdown", (e) => {
    const pt = e.target.closest(".al-pt");
    if (!pt) return;
    const l = +pt.dataset.l, i = +pt.dataset.i;
    drag = { l, i, id: e.pointerId, x0: e.clientX, y0: e.clientY, moved: false, before: api.snap(), laneEl: pt.parentElement, pt };
    try { pt.setPointerCapture(e.pointerId); } catch { /* moves still arrive */ }
    clearTimeout(hold);
    hold = setTimeout(() => { if (drag && !drag.moved) { const d = drag; drag = null; navigator.vibrate?.(12); quiet = Date.now() + 700; dropPoint(d.l, d.i); } }, 460);
  });
  el.addEventListener("pointermove", (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    if (!drag.moved && Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < 6) return;
    drag.moved = true; clearTimeout(hold);
    const song = api.song(), ln = lane(drag.l), spec = ln && targetSpec(song, ln.target);
    if (!spec) return;
    const r = drag.laneEl.getBoundingClientRect(), p = ln.points[drag.i];
    const lo = drag.i > 0 ? ln.points[drag.i - 1].beat : 0, hi = drag.i < ln.points.length - 1 ? ln.points[drag.i + 1].beat : Infinity;
    p.beat = clamp(beatOf(e.clientX - r.left), lo, hi);
    p.value = valueOf(spec, e.clientY - r.top);
    drag.pt.style.left = xOf(p.beat) + "px"; drag.pt.style.top = yOf(spec, p.value) + "px";
    drag.laneEl.querySelector("polyline").setAttribute("points", line(ln, spec, drag.laneEl.getBoundingClientRect().width));
  });
  const finish = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    clearTimeout(hold);
    const d = drag; drag = null;
    if (d.moved && api.snap() !== d.before) { api.pushUndo(d.before); api.save(); }
    render();
  };
  el.addEventListener("pointerup", finish);
  el.addEventListener("pointercancel", finish);

  el.addEventListener("keydown", (e) => {
    const pt = e.target.closest && e.target.closest(".al-pt");
    if (!pt) return;
    const l = +pt.dataset.l, i = +pt.dataset.i, ln = lane(l), spec = ln && targetSpec(api.song(), ln.target), p = ln && ln.points[i];
    if (!spec || !p) return;
    const k = e.key;
    if (k === "Delete" || k === "Backspace") { e.preventDefault(); return dropPoint(l, i); }
    const lo = i > 0 ? ln.points[i - 1].beat : 0, hi = i < ln.points.length - 1 ? ln.points[i + 1].beat : Infinity;
    if (k === "ArrowLeft" || k === "ArrowRight") api.change(() => { p.beat = clamp(p.beat + (k === "ArrowRight" ? 1 : -1) * (e.shiftKey ? 4 : step() || 0.25), lo, hi); });
    else if (k === "ArrowUp" || k === "ArrowDown") api.change(() => { p.value = clamp(p.value + (k === "ArrowUp" ? 1 : -1) * (spec.max - spec.min) / 20, spec.min, spec.max); });
    else return;
    e.preventDefault(); refocus(l, i);
  });

  // The list of knobs is not a popup that clings: any press elsewhere, or Escape, closes it.
  document.addEventListener("pointerdown", (e) => { if (open && !e.target.closest(".al-menu, [data-al='open']")) closeMenu(); });
  document.addEventListener("keydown", (e) => { if (open && e.key === "Escape") closeMenu(); });

  return { html, button, menu };
}
