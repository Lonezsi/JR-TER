// mixerview.js: the Mixer tab, laid out the way a desktop DAW's mixer is.
//
//   Master first, then an insert per track (1, 2, 3...), then the buses (more inserts, as many as you add).
//   Each strip: its number and name, a meter beside its fader, a pan knob, mute (and solo for a track),
//   and at its foot the routing arrow. Pick a strip and every strip it can feed shows its arrow:
//     click the arrow     send there (a track to a bus), the send's amount is the knob under the arrow;
//                         from a bus, click makes it the bus's output (a bus feeds one place)
//     double-click        make it the main output instead of the master
//   A route that would go round in a loop is never offered. Beside the strips: the picked strip's output,
//   its effects, + Insert (a new bus) and taking a bus out.
//
//   mountMixer(el, api) -> { render, meters(levels | null) }
//   api: song(), change(fn) (undoable edit), snap(), pushUndo(before), save(), sync(), toast(text, action),
//        undo(), selected(), select(i)
// Model and maths: mixer.js. The audio graph: mixgraph.js.
import { FX, FX_TYPES, newFx, ensureMix, MAX_FX, MAX_BUSES, addBus, removeBus, loops } from "./mixer.js";

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const fmt = (v) => (Math.abs(v) >= 10 ? v.toFixed(0) : Math.abs(v) >= 1 ? v.toFixed(1) : v.toFixed(2));
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const db = (v) => (v <= 0.0005 ? "-∞" : (20 * Math.log10(v) >= 0 ? "+" : "") + (20 * Math.log10(v)).toFixed(1));
const panWords = (p) => (Math.abs(p) < 0.01 ? "C" : Math.round(Math.abs(p) * 100) + (p < 0 ? "L" : "R"));

export function mountMixer(el, api) {
  let pick = "t0"; // "t<i>", "b<i>" or "m"

  // What an id points at: { kind, i, obj, label, fx }
  function who(song, id) {
    if (id === "m") return { kind: "m", obj: song.mixer.master, label: "Master", fx: song.mixer.master.fx };
    const i = +id.slice(1);
    if (id[0] === "b" && song.mixer.buses[i]) return { kind: "b", i, obj: song.mixer.buses[i], label: song.mixer.buses[i].name, fx: song.mixer.buses[i].fx };
    if (id[0] === "t" && song.tracks[i]) return { kind: "t", i, obj: song.tracks[i], label: song.tracks[i].name, fx: song.tracks[i].fx };
    return null;
  }
  function picked(song) {
    ensureMix(song);
    let w = who(song, pick);
    if (!w) { pick = song.tracks.length ? "t" + Math.min(api.selected(), song.tracks.length - 1) : "m"; w = who(song, pick); }
    return w;
  }
  // Can the picked strip feed `to`? Never itself, never into a track, never round a loop.
  function canFeed(song, from, to) {
    if (to === from || to[0] === "t" || from === "m") return false;
    if (to === "m") return true;
    if (from[0] === "t") return true;
    return !loops(song.mixer.buses, +from.slice(1), +to.slice(1));
  }

  const knob = (k, id, label, value, lo, hi, home, words) =>
    `<div class="mx-knob" role="slider" tabindex="0" data-knob="${k}" data-id="${id}" data-lo="${lo}" data-hi="${hi}" data-home="${home}"` +
    ` aria-label="${esc(label)}" aria-valuemin="${lo}" aria-valuemax="${hi}" aria-valuenow="${value}" aria-valuetext="${esc(words)}"` +
    ` data-tip="${esc(label)}: ${esc(words)}. Drag up or down, double-click to reset" style="--turn:${((value - lo) / (hi - lo)) * 270 - 135}deg"><i></i></div>`;

  function routeFoot(song, id, from) {
    if (!from || !canFeed(song, from.id, id)) return `<div class="mx-foot"></div>`;
    const f = from.obj;
    const main = (f.out || "m") === id;
    const j = id[0] === "b" ? +id.slice(1) : -1;
    const send = from.kind === "t" && j >= 0 ? f.sends[j] || 0 : 0;
    const on = main || send > 0;
    const tip = main ? "Main output of " + from.label : send > 0 ? "Sending from " + from.label + ". Click to stop, double-click to make it the main output"
      : from.kind === "t" && j >= 0 ? "Click to send " + from.label + " here, double-click to make it the main output" : "Click to make this the output of " + from.label;
    return `<div class="mx-foot"><button class="mx-route${on ? " on" : ""}${main ? " main" : ""}" data-route="${id}" aria-pressed="${on}" data-tip="${esc(tip)}" aria-label="${esc(tip)}">` +
      `<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M12 4l7 9h-4v7H9v-7H5z" fill="currentColor"/></svg></button>` +
      (send > 0 && !main ? knob("send", id, "Send from " + from.label, send, 0, 1, 0.8, db(send) + " dB") : "") + `</div>`;
  }

  function strip(song, id, num, w, from) {
    const o = w.obj, isT = w.kind === "t", isB = w.kind === "b";
    const vol = o.volume ?? 0.8;
    const feeds = id !== "m" && (o.out || "m") !== "m" ? who(song, o.out) : null;
    return `<div class="mx-strip${pick === id ? " sel" : ""}${w.kind === "m" ? " master" : ""}${isB ? " bus" : ""}${from && canFeed(song, from.id, id) ? " dest" : ""}" data-id="${id}">` +
      `<button class="mx-name" data-pick="${id}" aria-pressed="${pick === id}" data-tip="${esc(w.label)}${feeds ? " → " + esc(feeds.label) : ""}">` +
        `<span class="mx-num">${num}</span><span class="mx-label">${esc(w.label)}</span></button>` +
      (id === "m" ? `<div class="mx-knob blank" aria-hidden="true"></div>` : knob("pan", id, w.label + " pan", o.pan ?? 0, -1, 1, 0, panWords(o.pan ?? 0))) +
      `<div class="mx-mid"><div class="mx-meter" aria-hidden="true"><i></i></div>` +
        `<input type="range" class="mx-fader" min="0" max="1" step="0.01" value="${vol}" data-k="volume" data-id="${id}" aria-label="${esc(w.label)} volume" data-tip="${esc(w.label)}: ${db(vol)} dB"></div>` +
      `<span class="mx-db">${db(vol)}</span>` +
      (isT ? `<div class="mx-ms"><button data-ms="mute" data-id="${id}" aria-pressed="${!!o.mute}" aria-label="Mute" data-tip="Mute">M</button>` +
          `<button data-ms="solo" data-id="${id}" aria-pressed="${!!o.solo}" aria-label="Solo" data-tip="Solo">S</button></div>`
        : isB ? `<div class="mx-ms"><button data-ms="mute" data-id="${id}" aria-pressed="${!!o.mute}" aria-label="Mute" data-tip="Mute">M</button></div>`
        : `<div class="mx-ms"><span class="mx-lim" data-tip="A limiter ends the master, so the sum never clips">LIM</span></div>`) +
      (isT || isB ? `<span class="mx-out" aria-hidden="true">${feeds ? "→ " + esc(feeds.label) : "→ Master"}</span>` : `<span class="mx-out" aria-hidden="true">Out</span>`) +
      routeFoot(song, id, from) +
      `</div>`;
  }

  function fxCard(f, i, n) {
    const spec = FX[f.type];
    return `<div class="mx-fx${f.on ? "" : " off"}" data-i="${i}">` +
      `<div class="mx-fxh"><button role="switch" class="mx-led" aria-checked="${f.on}" data-fx="toggle" data-i="${i}" aria-label="${spec.label} on or off" data-tip="On or off"></button>` +
      `<span class="mx-slot">${i + 1}</span><b>${spec.label}</b><span class="mx-gap"></span>` +
      `<button data-fx="up" data-i="${i}" aria-label="Move earlier" data-tip="Move earlier"${i ? "" : " disabled"}>↑</button>` +
      `<button data-fx="down" data-i="${i}" aria-label="Move later" data-tip="Move later"${i < n - 1 ? "" : " disabled"}>↓</button>` +
      `<button data-fx="del" data-i="${i}" aria-label="Remove" data-tip="Remove">✕</button></div>` +
      Object.entries(spec.params).map(([k, [lo, hi, , unit]]) =>
        `<label class="mx-p"><span>${k}</span><input type="range" class="mx-param" min="${lo}" max="${hi}" step="${(hi - lo) / 200}" value="${f[k]}" data-i="${i}" data-p="${k}" aria-label="${esc(spec.label + " " + k)}"><output>${fmt(f[k])}${unit}</output></label>`).join("") +
      `</div>`;
  }

  function render() {
    const song = api.song(), w = picked(song), m = song.mixer;
    const from = { id: pick, ...w };
    const nt = song.tracks.length;
    const outs = `<option value="m">Master</option>` + m.buses.map((b, i) => (canFeed(song, pick, "b" + i) ? `<option value="b${i}">${esc(b.name)}</option>` : "")).join("");
    el.innerHTML =
      `<div class="mx-head"><span class="cv-title">Mixer</span><span class="sv-doc mx-hint">Pick a strip; click an arrow under another to send there, double-click to make it the main output.</span>` +
        `<button data-act="bus" data-tip="Add an insert (a bus) to group or send to"${m.buses.length >= MAX_BUSES ? " disabled" : ""}>+ Insert</button></div>` +
      `<div class="mx-strips">` +
        strip(song, "m", "M", who(song, "m"), from) +
        song.tracks.map((tr, i) => strip(song, "t" + i, i + 1, who(song, "t" + i), from)).join("") +
        m.buses.map((b, i) => strip(song, "b" + i, nt + i + 1, who(song, "b" + i), from)).join("") +
      `</div>` +
      `<div class="mx-side">` +
        `<div class="cv-line mx-who"><b>${esc(w.label)}</b>` +
          (w.kind === "m" ? "" : `<label>Out <select id="mx-out" aria-label="Where ${esc(w.label)} goes">${outs.replace(`value="${w.obj.out || "m"}"`, `value="${w.obj.out || "m"}" selected`)}</select></label>`) +
          (w.kind === "b" ? `<input id="mx-bname" type="text" value="${esc(w.label)}" aria-label="Name of this insert">` +
            `<button data-act="delbus" data-tip="Take this insert out; what went into it goes to the master"${m.buses.length <= 2 ? " disabled" : ""}>Remove</button>` : "") +
        `</div>` +
        `<div class="cv-line mx-adds">` + FX_TYPES.map((k) => `<button data-add="${k}" data-tip="Add ${FX[k].label}" aria-label="Add ${FX[k].label}"${w.fx.length >= MAX_FX ? " disabled" : ""}>+ ${FX[k].label}</button>`).join("") + `</div>` +
        `<div class="mx-chain">${w.fx.length ? w.fx.map((f, i) => fxCard(f, i, w.fx.length)).join("") : `<div class="sv-doc">No effects on ${esc(w.label)}. Add one above; they run top to bottom.</div>`}</div>` +
      `</div>`;
  }

  // ---- sliders and knobs: one undo step per gesture ----------------------------------------------
  let before = null;
  const begin = () => { if (before === null) before = api.snap(); };
  const end = () => { if (before !== null) { if (api.snap() !== before) api.pushUndo(before); before = null; } };

  function setValue(song, k, id, v) {
    const w = who(song, id);
    if (k === "send") { const from = who(song, pick); if (from && from.kind === "t") from.obj.sends[+id.slice(1)] = v; return; }
    if (!w) return;
    if (k === "volume") w.obj.volume = v; else if (k === "pan") w.obj.pan = v;
  }

  el.addEventListener("input", (e) => {
    const t = e.target, song = api.song();
    if (!t.matches("input[type=range]")) return;
    begin();
    if (t.dataset.p !== undefined) {
      const f = picked(song).fx[+t.dataset.i];
      f[t.dataset.p] = +t.value;
      t.parentElement.querySelector("output").textContent = fmt(+t.value) + (FX[f.type].params[t.dataset.p][3] || "");
    } else {
      setValue(song, t.dataset.k, t.dataset.id, +t.value);
      const d = t.closest(".mx-strip")?.querySelector(".mx-db"); if (d) d.textContent = db(+t.value);
    }
    api.sync(); api.save();
  });
  el.addEventListener("change", (e) => {
    const t = e.target, song = api.song();
    if (t.matches("input[type=range]")) return end();
    if (t.id === "mx-out") return api.change(() => { picked(song).obj.out = t.value; ensureMix(song); });
    if (t.id === "mx-bname") { const n = t.value.trim(); if (n) api.change(() => { picked(song).obj.name = n.slice(0, 40); }); }
  });

  // A knob turns with a vertical drag (160px end to end), the wheel, or the arrow keys.
  function turn(node, v) {
    const lo = +node.dataset.lo, hi = +node.dataset.hi;
    v = clamp(v, lo, hi);
    setValue(api.song(), node.dataset.knob, node.dataset.id, v);
    node.style.setProperty("--turn", ((v - lo) / (hi - lo)) * 270 - 135 + "deg");
    node.setAttribute("aria-valuenow", v);
    const words = node.dataset.knob === "pan" ? panWords(v) : db(v) + " dB";
    node.setAttribute("aria-valuetext", words);
    node.dataset.tip = node.getAttribute("aria-label") + ": " + words + ". Drag up or down, double-click to reset";
    api.sync(); api.save();
  }
  el.addEventListener("pointerdown", (e) => {
    const k = e.target.closest(".mx-knob[data-knob]");
    if (!k || e.button !== 0) return;
    e.preventDefault(); k.focus();
    try { k.setPointerCapture(e.pointerId); } catch { /* moves still arrive */ }
    const y0 = e.clientY, v0 = +k.getAttribute("aria-valuenow"), span = +k.dataset.hi - +k.dataset.lo;
    begin();
    const move = (ev) => turn(k, v0 + ((y0 - ev.clientY) / 160) * span * (ev.shiftKey ? 0.2 : 1));
    const up = () => { k.removeEventListener("pointermove", move); k.removeEventListener("pointerup", up); k.removeEventListener("pointercancel", up); end(); };
    k.addEventListener("pointermove", move); k.addEventListener("pointerup", up); k.addEventListener("pointercancel", up);
  });
  el.addEventListener("wheel", (e) => {
    const k = e.target.closest(".mx-knob[data-knob]");
    if (!k) return;
    e.preventDefault(); begin();
    turn(k, +k.getAttribute("aria-valuenow") + (e.deltaY < 0 ? 1 : -1) * (+k.dataset.hi - +k.dataset.lo) / 50);
    clearTimeout(k._t); k._t = setTimeout(end, 400);
  }, { passive: false });
  el.addEventListener("keydown", (e) => {
    const k = e.target.closest(".mx-knob[data-knob]");
    if (!k) return;
    const span = +k.dataset.hi - +k.dataset.lo, v = +k.getAttribute("aria-valuenow");
    const by = { ArrowUp: span / 50, ArrowRight: span / 50, ArrowDown: -span / 50, ArrowLeft: -span / 50, PageUp: span / 8, PageDown: -span / 8 }[e.key];
    if (e.key === "Home") { e.preventDefault(); begin(); turn(k, +k.dataset.home); return end(); }
    if (by === undefined) return;
    e.preventDefault(); begin(); turn(k, v + by); end();
  });

  // ---- clicks ------------------------------------------------------------------------------------
  let routeTimer = 0;
  el.addEventListener("dblclick", (e) => {
    const k = e.target.closest(".mx-knob[data-knob]");
    if (k) { begin(); turn(k, +k.dataset.home); return end(); }
    const r = e.target.closest("[data-route]");
    if (!r) return;
    clearTimeout(routeTimer);
    const song = api.song(), w = picked(song), to = r.dataset.route;
    api.change(() => { w.obj.out = to; if (w.kind === "t" && to[0] === "b") w.obj.sends[+to.slice(1)] = 0; ensureMix(song); });
    api.toast(w.label + " goes to " + who(song, to).label + ".", { label: "Undo", run: api.undo });
  });
  el.addEventListener("click", (e) => {
    const song = api.song();
    const p = e.target.closest("[data-pick]");
    if (p) { pick = p.dataset.pick; if (pick[0] === "t") api.select(+pick.slice(1)); return render(); }
    const r = e.target.closest("[data-route]");
    if (r) {
      // Wait a moment: a second click makes it a double-click, which means "main output".
      clearTimeout(routeTimer);
      routeTimer = setTimeout(() => {
        const w = picked(song), to = r.dataset.route;
        if (w.kind === "t" && to[0] === "b") {
          const j = +to.slice(1);
          if ((w.obj.out || "m") === to) return api.change(() => { w.obj.out = "m"; });
          return api.change(() => { w.obj.sends[j] = w.obj.sends[j] > 0 ? 0 : 0.8; });
        }
        api.change(() => { w.obj.out = (w.obj.out || "m") === to && to !== "m" ? "m" : to; ensureMix(song); });
      }, 220);
      return;
    }
    const act = e.target.closest("[data-act]");
    if (act && !act.disabled) {
      if (act.dataset.act === "bus") { let i = null; api.change(() => { i = addBus(song, "Insert " + (song.tracks.length + song.mixer.buses.length + 1)); }); if (i !== null) { pick = "b" + i; render(); } return; }
      if (act.dataset.act === "delbus") { const i = +pick.slice(1), name = picked(song).label; api.change(() => { removeBus(song, i); }); pick = "m"; render(); api.toast(name + " taken out.", { label: "Undo", run: api.undo }); return; }
    }
    const ms = e.target.closest("[data-ms]");
    if (ms) { const w = who(song, ms.dataset.id); return api.change(() => { w.obj[ms.dataset.ms] = !w.obj[ms.dataset.ms]; }); }
    const add = e.target.closest("[data-add]");
    if (add && !add.disabled) return api.change(() => { picked(song).fx.push(newFx(add.dataset.add)); });
    const b = e.target.closest("[data-fx]");
    if (!b || b.disabled) return;
    const list = picked(song).fx, i = +b.dataset.i, a = b.dataset.fx;
    if (a === "toggle") api.change(() => { list[i].on = !list[i].on; });
    else if (a === "up") api.change(() => { [list[i - 1], list[i]] = [list[i], list[i - 1]]; });
    else if (a === "down") api.change(() => { [list[i + 1], list[i]] = [list[i], list[i + 1]]; });
    else if (a === "del") { api.change(() => { list.splice(i, 1); }); api.toast("Effect removed.", { label: "Undo", run: api.undo }); }
  });

  function meters(levels) {
    const bar = (id, d) => { const i = el.querySelector(`.mx-strip[data-id="${id}"] .mx-meter i`); if (i) i.style.height = Math.round(Math.max(0, (d + 60) / 60) * 100) + "%"; };
    const song = api.song();
    song.tracks.forEach((_, i) => bar("t" + i, levels ? levels.tracks[i] ?? -60 : -60));
    (song.mixer.buses || []).forEach((_, i) => bar("b" + i, levels && levels.buses ? levels.buses[i] ?? -60 : -60));
    bar("m", levels ? levels.master : -60);
  }
  return { render, meters };
}
