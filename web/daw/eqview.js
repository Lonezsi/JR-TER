// eqview.js: the mixer EQ's curve, drawn and shaped in place (a port of the song Sound tab's EqCanvas.svelte).
//
//   Press empty space to put a band there (the same motion drags it), drag a node for frequency and gain,
//   roll the wheel over a node for Q, double-click a node to remove it. Keys on the focused curve: Enter adds,
//   PageUp/PageDown or [ ] pick a band, arrows move it (Shift = bigger steps), + and - change its Q, Delete removes.
//   The curve is the real filter response (rack.js responseOf), drawn in the DAW's own colours (--d-*).
//
//   wireEq(el, h): h = { fx(i) -> the effect, key(i) -> a string naming that effect, begin(), live(), commit(i),
//   remove(i, id), toast(text) }. The caller owns the data; this only edits h.fx(i).bands in place.
//   observeEq(el): call after every render so each canvas gets drawn and redrawn when its size changes.
import {
  F_MIN, F_MAX, GRID_F, LABEL_F, RANGES, DEFAULT_RANGE, MAX_BANDS, TYPE_LABEL,
  freqToX, xToFreq, gainToY, curveY, bandAt, bandAtPoint, dragBand, addBand, newBand, qFromWheel,
  reachSpan, responseOf, fmtHz, isGainless, gridSteps,
} from "./rack.js";

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const tenth = (v) => Math.round(v * 10) / 10;

/** The vertical range (dB either way): the smallest one that holds every band's gain, never under the default. */
export function rangeFor(bands) {
  const top = Math.max(0, ...(bands || []).filter((b) => !isGainless(b.type)).map((b) => Math.abs(b.gain)));
  return RANGES.find((r) => r >= top && r >= DEFAULT_RANGE) || RANGES[RANGES.length - 1];
}

/** The words under the curve. */
export function readout(band, count) {
  if (!band) return count ? `${count} band${count === 1 ? "" : "s"}` : "Flat. Press the curve to add a band";
  const gain = isGainless(band.type) ? "" : `, ${band.gain > 0 ? "+" : ""}${band.gain.toFixed(1)} dB`;
  return `${TYPE_LABEL[band.type] || band.type}, ${fmtHz(band.freq)} Hz${gain}, Q ${band.q.toFixed(2)}`;
}

/** Edit a band for one key. Returns true if the key was one of these. */
export function keyEdit(band, key, shift, range) {
  const fine = shift ? 4 : 1;
  if (key === "ArrowLeft" || key === "ArrowRight") {
    const oct = ((key === "ArrowRight" ? 1 : -1) * fine) / 12;
    band.freq = tenth(clamp(band.freq * Math.pow(2, oct), F_MIN, F_MAX));
    return true;
  }
  if (key === "ArrowUp" || key === "ArrowDown") {
    if (isGainless(band.type)) return false;
    band.gain = tenth(clamp(band.gain + (key === "ArrowUp" ? 1 : -1) * 0.5 * fine, -range, range));
    return true;
  }
  if (key === "+" || key === "=" || key === "-") { band.q = qFromWheel(band.q, key === "-" ? 80 : -80); return true; }
  return false;
}

// ---- drawing ------------------------------------------------------------------------------------------
let offline = null;
function audioCtx() {
  if (offline === null) {
    try { offline = new OfflineAudioContext(1, 128, 48000); } catch { offline = false; }
  }
  return offline || null;
}

const css = (name, fallback) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
const mix = (color, a) => `color-mix(in srgb, ${color} ${Math.round(a * 100)}%, transparent)`;

export function paintEq(canvas, f, selId, hoverId) {
  const r = canvas.getBoundingClientRect(), dpr = devicePixelRatio || 1;
  const w = Math.round(r.width), h = Math.round(r.height);
  if (!w || !h) return;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
  }
  const g = canvas.getContext("2d");
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  const bands = f.bands, range = rangeFor(bands), off = !f.on;
  const fg = css("--d-fg", "#f2f3f4"), acc = css("--d-acc", "#FAA8B8");

  g.lineWidth = 1; g.font = "10px sans-serif"; g.textAlign = "center";
  for (const hz of GRID_F) {
    const x = Math.round(freqToX(hz, w)) + 0.5;
    g.strokeStyle = mix(fg, 0.07); g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke();
    if (LABEL_F[hz]) { g.fillStyle = mix(fg, 0.4); g.fillText(LABEL_F[hz], x, h - 4); }
  }
  const step = gridSteps(range);
  g.textAlign = "left";
  for (let d = -range + step; d < range; d += step) {
    if (d === 0) continue;
    const y = Math.round(gainToY(d, h, range)) + 0.5;
    g.strokeStyle = mix(fg, 0.06); g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke();
    g.fillStyle = mix(fg, 0.4); g.fillText((d > 0 ? "+" : "") + d, 3, y - 2);
  }
  const zero = Math.round(gainToY(0, h, range)) + 0.5;
  g.strokeStyle = mix(fg, 0.2); g.beginPath(); g.moveTo(0, zero); g.lineTo(w, zero); g.stroke();

  // the curve (recomputed only when the bands, the bypass or the width change)
  const points = clamp(w, 120, 420);
  const key = `${w}|${off}|${bands.map((b) => `${b.type},${b.freq},${b.gain},${b.q},${b.on}`).join(";")}`;
  let c = canvas._eq;
  if (!c || c.key !== key) {
    const axis = new Float32Array(points), xs = new Float32Array(points);
    for (let i = 0; i < points; i++) { xs[i] = (i / (points - 1)) * w; axis[i] = xToFreq(xs[i], w); }
    c = canvas._eq = { key, xs, db: responseOf(audioCtx(), bands, axis, off) };
  }
  g.beginPath();
  for (let i = 0; i < c.xs.length; i++) {
    const y = curveY(c.db[i], h, range);
    if (i === 0) g.moveTo(c.xs[i], y); else g.lineTo(c.xs[i], y);
  }
  g.strokeStyle = off ? mix(fg, 0.3) : acc; g.lineWidth = 2; g.lineJoin = "round"; g.stroke();
  g.lineTo(w, zero); g.lineTo(0, zero); g.closePath();
  g.fillStyle = off ? mix(fg, 0.05) : mix(acc, 0.14); g.fill();

  for (const b of bands) {
    const x = freqToX(b.freq, w), y = gainToY(isGainless(b.type) ? 0 : b.gain, h, range);
    const picked = b.id === selId, hot = picked || b.id === hoverId;
    if (picked) {
      const [lo, hi] = reachSpan(b.freq, b.q), left = freqToX(lo, w);
      g.fillStyle = mix(acc, 0.1); g.fillRect(left, 0, Math.max(2, freqToX(hi, w) - left), h);
    }
    g.beginPath(); g.arc(x, y, hot ? 7 : 5, 0, Math.PI * 2);
    g.fillStyle = b.on && !off ? acc : mix(fg, 0.35); g.fill();
    g.lineWidth = 2; g.strokeStyle = "rgba(10,10,12,0.85)"; g.stroke();
    if (hot) {
      g.fillStyle = mix(fg, 0.9); g.font = "600 10px sans-serif"; g.textAlign = "center";
      g.fillText(fmtHz(b.freq), clamp(x, 16, w - 16), Math.max(11, y - 11));
    }
  }
}

// ---- editing ------------------------------------------------------------------------------------------
export function observeEq(el) {
  if (!el._eqRo && typeof ResizeObserver === "function") el._eqRo = new ResizeObserver((list) => { for (const e of list) el._eqPaint?.(e.target); });
  // A change of theme repaints the curves (their colours are read when drawn).
  if (!el._eqMo && typeof MutationObserver === "function") {
    el._eqMo = new MutationObserver(() => { for (const cv of el.querySelectorAll("canvas[data-eq]")) el._eqPaint?.(cv); });
    el._eqMo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "class"] });
  }
  el._eqRo?.disconnect();
  for (const cv of el.querySelectorAll("canvas[data-eq]")) { el._eqRo?.observe(cv); el._eqPaint?.(cv); }
}

export function wireEq(el, h) {
  const sel = new Map();   // key -> selected band id
  let hover = null, drag = null, wheelTimer = 0, lastTap = { id: null, t: 0 };
  const idxOf = (cv) => +cv.dataset.eq;
  const canvasOf = (t) => t.closest?.("canvas[data-eq]");
  const paint = (cv) => { const f = h.fx(idxOf(cv)); if (f) paintEq(cv, f, sel.get(h.key(idxOf(cv))), hover); };
  el._eqPaint = paint;
  const words = (cv) => {
    const i = idxOf(cv), f = h.fx(i), out = el.querySelector(`#mx-eqr-${i}`);
    if (f && out) out.textContent = readout(f.bands.find((b) => b.id === sel.get(h.key(i))), f.bands.length);
  };
  const at = (cv, e) => { const r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const size = (cv) => { const r = cv.getBoundingClientRect(); return { width: r.width || 1, height: r.height || 1 }; };
  const ctxOf = (cv) => {
    const f = h.fx(idxOf(cv));
    return f ? { f, k: h.key(idxOf(cv)), range: rangeFor(f.bands), size: size(cv) } : null;
  };
  const select = (cv, id) => { sel.set(h.key(idxOf(cv)), id); };

  el.addEventListener("pointerdown", (e) => {
    const cv = canvasOf(e.target);
    if (!cv || (e.button !== undefined && e.button > 0)) return;
    const c = ctxOf(cv); if (!c) return;
    cv.focus({ preventScroll: true });
    const p = at(cv, e);
    const hit = bandAt(c.f.bands, p.x, p.y, c.size, c.range, e.pointerType === "mouse" ? 14 : 24);
    let id;
    // A second press on the same node within a moment removes it. Done here, not on dblclick: the first press
    // redraws the card, and the browser then sends no dblclick for a canvas that is gone.
    if (hit && hit.id === lastTap.id && performance.now() - lastTap.t < 350) {
      lastTap = { id: null, t: 0 }; sel.delete(c.k); h.remove(idxOf(cv), hit.id); return;
    }
    if (hit) { id = hit.id; h.begin(); }
    else {
      if (c.f.bands.length >= MAX_BANDS) { h.toast(`An EQ holds up to ${MAX_BANDS} bands.`); return; }
      h.begin();
      const made = bandAtPoint(p.x, p.y, c.size, c.range);
      addBand(c.f.bands, made); id = made.id; h.live();
    }
    select(cv, id); drag = { cv, id, pointer: e.pointerId }; lastTap = { id, t: performance.now() };
    cv.classList.add("dragging");
    try { cv.setPointerCapture(e.pointerId); } catch { /* the drag still works */ }
    words(cv); paint(cv);
  });

  el.addEventListener("pointermove", (e) => {
    const cv = canvasOf(e.target);
    if (drag && drag.cv.isConnected) {
      const c = ctxOf(drag.cv), b = c && c.f.bands.find((x) => x.id === drag.id);
      if (!b) return;
      const p = at(drag.cv, e);
      dragBand(b, p.x, p.y, c.size, c.range);
      h.live(); words(drag.cv); paint(drag.cv);
      return;
    }
    if (!cv || e.pointerType === "touch") return;
    const c = ctxOf(cv); if (!c) return;
    const p = at(cv, e), found = bandAt(c.f.bands, p.x, p.y, c.size, c.range, 14);
    const id = found ? found.id : null;
    cv.classList.toggle("hot", !!found);
    if (id !== hover) { hover = id; paint(cv); }
  });

  const finish = () => {
    if (!drag) return;
    const { cv, pointer } = drag; drag = null;
    cv.classList.remove("dragging");
    try { cv.releasePointerCapture(pointer); } catch { /* already */ }
    if (cv.isConnected) h.commit(idxOf(cv));
  };
  el.addEventListener("pointerup", finish);
  el.addEventListener("pointercancel", finish);

  el.addEventListener("pointerleave", (e) => { if (!drag && canvasOf(e.target) && hover !== null) { hover = null; paint(canvasOf(e.target)); } }, true);

  el.addEventListener("wheel", (e) => {
    const cv = canvasOf(e.target); if (!cv) return;
    const c = ctxOf(cv); if (!c) return;
    const p = at(cv, e);
    const b = bandAt(c.f.bands, p.x, p.y, c.size, c.range, 14) || c.f.bands.find((x) => x.id === sel.get(c.k));
    if (!b) return;
    e.preventDefault();
    h.begin(); b.q = qFromWheel(b.q, e.deltaY); select(cv, b.id);
    h.live(); words(cv); paint(cv);
    clearTimeout(wheelTimer);
    const i = idxOf(cv);
    wheelTimer = setTimeout(() => { if (cv.isConnected) h.commit(i); }, 400);
  }, { passive: false });

  el.addEventListener("dblclick", (e) => {
    const cv = canvasOf(e.target); if (!cv) return;
    const c = ctxOf(cv); if (!c) return;
    const p = at(cv, e), b = bandAt(c.f.bands, p.x, p.y, c.size, c.range, 14);
    if (b) { sel.delete(c.k); h.remove(idxOf(cv), b.id); }
  });

  el.addEventListener("keydown", (e) => {
    const cv = canvasOf(e.target); if (!cv || e.target !== cv) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const c = ctxOf(cv); if (!c) return;
    const i = idxOf(cv), bands = c.f.bands, k = e.key;
    const chosen = bands.find((b) => b.id === sel.get(c.k));
    const done = () => { e.preventDefault(); e.stopPropagation(); words(cv); paint(cv); };
    const order = [...bands].sort((a, b) => a.freq - b.freq);
    if (k === "Escape") { if (chosen) { sel.delete(c.k); done(); } return; }
    if (k === "PageUp" || k === "PageDown" || k === "[" || k === "]") {
      if (!order.length) return;
      const back = k === "PageUp" || k === "[", at_ = order.findIndex((b) => b.id === sel.get(c.k));
      select(cv, order[at_ < 0 ? 0 : clamp(at_ + (back ? -1 : 1), 0, order.length - 1)].id);
      h.commit(i); e.preventDefault(); e.stopPropagation(); return;
    }
    if (k === "Enter" && !chosen) {
      if (bands.length >= MAX_BANDS) { h.toast(`An EQ holds up to ${MAX_BANDS} bands.`); done(); return; }
      h.begin(); const made = newBand("peaking"); addBand(bands, made); select(cv, made.id);
      h.live(); h.commit(i); e.preventDefault(); e.stopPropagation(); return;
    }
    const arrows = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"];
    if (!chosen) {
      if (arrows.includes(k) && order.length) { select(cv, order[0].id); done(); }
      return;
    }
    if (k === "Delete" || k === "Backspace") { sel.delete(c.k); e.preventDefault(); e.stopPropagation(); h.remove(i, chosen.id); return; }
    h.begin();
    if (keyEdit(chosen, k, e.shiftKey, c.range)) { h.live(); h.commit(i); e.preventDefault(); e.stopPropagation(); }
  });

  return { selected: (key) => sel.get(key), select: (key, id) => sel.set(key, id) };
}
