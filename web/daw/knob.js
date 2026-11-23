// knob.js: a knob you turn. One control for every knob in the DAW.
//
//   knob({ key, label, value, lo, hi, home, words, step }) -> HTML
//   wireKnobs(root, { turn(key, value, node), begin(), end() })
//
// Turning: drag up or down (160px end to end, Shift for fine), the wheel, the arrow keys (Page Up and
// Down for big steps), Home or a double-click for its resting value. role="slider" underneath, so a
// screen reader reads it as one. `words` is how the value reads ("+3 st", "1.50x"); it is updated
// by the caller through turn's node (node.dataset.words) or left as the number.
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const angle = (v, lo, hi) => ((v - lo) / (hi - lo)) * 270 - 135;

export function knob({ key, label, value, lo, hi, home = lo, words = String(value), step = 0, cls = "" }) {
  return `<div class="mx-knob ${cls}" role="slider" tabindex="0" data-knob="${esc(key)}" data-lo="${lo}" data-hi="${hi}" data-home="${home}" data-step="${step}"` +
    ` aria-label="${esc(label)}" aria-valuemin="${lo}" aria-valuemax="${hi}" aria-valuenow="${value}" aria-valuetext="${esc(words)}"` +
    ` data-tip="${esc(label)}: ${esc(words)}" style="--turn:${angle(value, lo, hi)}deg"><i></i></div>`;
}

export function wireKnobs(root, { turn, begin = () => {}, end = () => {} }) {
  const set = (node, v) => {
    const lo = +node.dataset.lo, hi = +node.dataset.hi, st = +node.dataset.step;
    v = clamp(st > 0 ? Math.round(v / st) * st : v, lo, hi);
    v = Math.round(v * 1000) / 1000;
    if (v === +node.getAttribute("aria-valuenow")) return;
    node.style.setProperty("--turn", angle(v, lo, hi) + "deg");
    node.setAttribute("aria-valuenow", v);
    const words = turn(node.dataset.knob, v, node);
    if (typeof words === "string") { node.setAttribute("aria-valuetext", words); node.dataset.tip = node.getAttribute("aria-label") + ": " + words; }
  };
  const span = (n) => +n.dataset.hi - +n.dataset.lo;
  root.addEventListener("pointerdown", (e) => {
    const k = e.target.closest?.(".mx-knob[data-knob]");
    if (!k || !root.contains(k) || e.button !== 0) return;
    e.preventDefault(); k.focus();
    try { k.setPointerCapture(e.pointerId); } catch { /* moves still arrive */ }
    const y0 = e.clientY, v0 = +k.getAttribute("aria-valuenow");
    begin();
    const move = (ev) => set(k, v0 + ((y0 - ev.clientY) / 160) * span(k) * (ev.shiftKey ? 0.2 : 1));
    const up = () => { k.removeEventListener("pointermove", move); k.removeEventListener("pointerup", up); k.removeEventListener("pointercancel", up); end(); };
    k.addEventListener("pointermove", move); k.addEventListener("pointerup", up); k.addEventListener("pointercancel", up);
  });
  root.addEventListener("wheel", (e) => {
    const k = e.target.closest?.(".mx-knob[data-knob]");
    if (!k) return;
    e.preventDefault(); begin();
    set(k, +k.getAttribute("aria-valuenow") + (e.deltaY < 0 ? 1 : -1) * (+k.dataset.step || span(k) / 50));
    clearTimeout(k._t); k._t = setTimeout(end, 400);
  }, { passive: false });
  root.addEventListener("keydown", (e) => {
    const k = e.target.closest?.(".mx-knob[data-knob]");
    if (!k) return;
    const small = +k.dataset.step || span(k) / 50;
    const by = { ArrowUp: small, ArrowRight: small, ArrowDown: -small, ArrowLeft: -small, PageUp: span(k) / 8, PageDown: -span(k) / 8 }[e.key];
    if (e.key === "Home") { e.preventDefault(); begin(); set(k, +k.dataset.home); end(); return; }
    if (by === undefined) return;
    e.preventDefault(); e.stopPropagation(); begin(); set(k, +k.getAttribute("aria-valuenow") + by); end();
  });
  root.addEventListener("dblclick", (e) => {
    const k = e.target.closest?.(".mx-knob[data-knob]");
    if (!k) return;
    begin(); set(k, +k.dataset.home); end();
  });
}
