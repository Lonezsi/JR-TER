// mixerview.js: the Mixer tab, laid out the way a desktop DAW's mixer is.
//
//   Master first, then an insert per track (1, 2, 3...), then the buses (more inserts, as many as you add).
//   Each strip: its number and name, a meter beside its fader, a pan knob, mute (and solo for a track),
//   and at its foot the routing arrow. Pick a strip and every strip it can feed shows its arrow:
//     click the arrow     send there (a track to a bus), the send's amount is the knob under the arrow;
//                         from a bus, click makes it the bus's output (a bus feeds one place)
//     double-click        make it the main output instead of the master
//   A route that would go round in a loop is never offered. Beside the strips: the picked strip's output,
//   its effects (each setting a knob; drag an effect's grip, or press the arrows on it, to reorder), + Insert (a new bus) and taking a bus out.
//
//   mountMixer(el, api) -> { render, meters(levels | null) }
//   A Plugin effect is a Web Audio Module (wamhost.js): type its address, press Allow once for its site,
//   Open shows its own window (its settings are kept in the song when you close it).
//   api: plugins() (the graph's plugin statuses, [] before the first sound), pluginsReady() (a promise), song(), change(fn) (undoable edit), snap(), pushUndo(before), save(), sync(), toast(text, action),
//        undo(), selected(), select(i)
// Model and maths: mixer.js. The audio graph: mixgraph.js.
import { icon } from "./icons.js";
import { knob as knobHtml, wireKnobs } from "./knob.js";
import { FX, FX_TYPES, newFx, moveFx, ensureMix, MAX_FX, MAX_BUSES, addBus, removeBus, loops, wamUrl, pluginOrigin, WAM_STATE_MAX } from "./mixer.js";
import { allowed, allow } from "./wamhost.js";

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const fmt = (v) => (Math.abs(v) >= 10 ? v.toFixed(0) : Math.abs(v) >= 1 ? v.toFixed(1) : v.toFixed(2));
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const db = (v) => (v <= 0.0005 ? "-∞" : (20 * Math.log10(v) >= 0 ? "+" : "") + (20 * Math.log10(v)).toFixed(1));
const panWords = (p) => (Math.abs(p) < 0.01 ? "C" : Math.round(Math.abs(p) * 100) + (p < 0 ? "L" : "R"));

export function mountMixer(el, api) {
  let pluginTries = 0;
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
    ` data-tip="${esc(label)}: ${esc(words)}" style="--turn:${((value - lo) / (hi - lo)) * 270 - 135}deg"><i></i></div>`;

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
        : `<div class="mx-ms"><span class="mx-lim" data-tip="A limiter ends the master, so the sum never clips">Limiter</span></div>`) +
      `<span class="mx-out" aria-hidden="true">${feeds ? "→ " + esc(feeds.label) : ""}</span>` +
      routeFoot(song, id, from) +
      `</div>`;
  }

  const stateWords = { loading: "Loading…", on: "Loaded", blocked: "Not allowed here yet", failed: "Would not load" };
  const entry = (f) => { const l = api.plugins(); return l.find((p) => p.fx === f) || l.find((p) => p.fx.url === f.url); };
  const statusOf = (f) => { const x = entry(f); return x || { status: !f.url ? "empty" : allowed(f.url) ? "loading" : "blocked", error: "" }; };
  function wamBody(f, i) {
    const st = statusOf(f), blocked = f.url && !allowed(f.url), host = pluginOrigin(f.url).replace("https://", "");
    return `<div class="mx-wam">` +
      `<input type="text" class="mx-wurl" data-wurl="${i}" value="${esc(f.url)}" placeholder="https://… plugin address" spellcheck="false" aria-label="Plugin address, slot ${i + 1}">` +
      `<div class="mx-wrow"><span class="mx-wst" data-st="${st.status}">${esc(f.name && st.status === "on" ? f.name : st.status === "empty" ? "No address yet" : stateWords[st.status] || "")}${st.error ? ": " + esc(st.error) : ""}</span><span class="mx-gap"></span>` +
      (blocked ? `<button data-fx="allow" data-i="${i}" data-tip="Let this browser load plugins from ${esc(host)}" aria-label="Allow plugins from ${esc(host)}">Allow ${esc(host)}</button>` : "") +
      (st.status === "on" ? `<button data-fx="open" data-i="${i}" data-tip="Open the plugin" aria-label="Open the plugin">Open</button>` : "") +
      `</div></div>`;
  }
  function fxCard(f, i, n) {
    const spec = FX[f.type];
    return `<div class="mx-fx${f.on ? "" : " off"}" data-i="${i}">` +
      `<div class="mx-fxh"><button class="mx-grip" data-grip="${i}" aria-label="Move ${spec.label}, slot ${i + 1} of ${n}. Drag, or use the up and down arrows" data-tip="Drag to reorder">${icon("drag", 14)}</button>` +
      `<button role="switch" class="mx-led" aria-checked="${f.on}" data-fx="toggle" data-i="${i}" aria-label="${spec.label} on or off" data-tip="On or off"></button>` +
      `<span class="mx-slot">${i + 1}</span><b>${spec.label}</b><span class="mx-gap"></span>` +
      `<button data-fx="del" data-i="${i}" aria-label="Remove" data-tip="Remove">${icon("close", 14)}</button></div>` +
      (f.type === "wam" ? wamBody(f, i) : "") +
      `<div class="mx-params">` + Object.entries(spec.params).map(([k, [lo, hi, home, unit]]) =>
        `<div class="mx-p">${knobHtml({ key: "fx." + i + "." + k, label: spec.label + " " + k, value: f[k], lo, hi, home, words: fmt(f[k]) + unit })}<span>${k}</span><output>${fmt(f[k])}${unit}</output></div>`).join("") + `</div>` +
      `</div>`;
  }

  function render() {
    const song = api.song(), w = picked(song), m = song.mixer;
    const from = { id: pick, ...w };
    const nt = song.tracks.length;
    const outs = `<option value="m">Master</option>` + m.buses.map((b, i) => (canFeed(song, pick, "b" + i) ? `<option value="b${i}">${esc(b.name)}</option>` : "")).join("");
    el.innerHTML =
      `<div class="mx-head"><span class="cv-title">Mixer</span><span class="mx-gap"></span>` +
        `<button data-act="bus" data-tip="Add an insert (a bus) to group tracks or send to"${m.buses.length >= MAX_BUSES ? " disabled" : ""}>${icon("plus")}Insert</button></div>` +
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
        `<div class="cv-line mx-adds">` + FX_TYPES.map((k) => `<button data-add="${k}" data-tip="Add ${FX[k].label}" aria-label="Add ${FX[k].label}"${w.fx.length >= MAX_FX ? " disabled" : ""}>${icon("plus", 14)}${FX[k].label}</button>`).join("") + `</div>` +
        `<div class="mx-chain">${w.fx.length ? w.fx.map((f, i) => fxCard(f, i, w.fx.length)).join("") : `<div class="sv-doc">No effects on ${esc(w.label)} yet. They run top to bottom.</div>`}</div>` +
      `</div>`;
    // A plugin that may still be loading (its status is not known yet, or is "loading"): look again soon, and draw it
    // when it has loaded or failed. A few tries at most, so a plugin that never settles cannot make this loop.
    const wait = w.fx.some((f) => f.type === "wam" && f.url && allowed(f.url) && (entry(f) || { status: "loading" }).status === "loading");
    if (!wait) pluginTries = 0;
    else if (pluginTries < 40) {
      pluginTries++;
      Promise.race([api.pluginsReady(), new Promise((r) => setTimeout(r, 250))]).then(() => {
        if (el.isConnected && !win && !document.activeElement?.classList?.contains("mx-wurl")) render();
      });
    }
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
    setValue(song, t.dataset.k, t.dataset.id, +t.value);
    const d = t.closest(".mx-strip")?.querySelector(".mx-db"); if (d) d.textContent = db(+t.value);
    api.sync(); api.save();
  });
  el.addEventListener("change", (e) => {
    const t = e.target, song = api.song();
    if (t.matches("input[type=range]")) return end();
    if (t.id === "mx-out") return api.change(() => { picked(song).obj.out = t.value; ensureMix(song); });
    if (t.dataset.wurl !== undefined) {
      const i = +t.dataset.wurl, u = t.value.trim(), ok = wamUrl(u);
      if (u && !ok) { api.toast("A plugin address starts with https:// (or is a path on this server)."); return render(); }
      t.blur(); // the docked mixer is not redrawn under a hand that is typing in it
      return api.change(() => { const f = picked(song).fx[i]; if (f) { f.url = ok; f.name = ""; f.state = null; } });
    }
    if (t.id === "mx-bname") { const n = t.value.trim(); if (n) api.change(() => { picked(song).obj.name = n.slice(0, 40); }); }
  });

  // Every knob (strip pan, sends, effect settings) is knob.js: drag, wheel, arrows, double-click for home.
  wireKnobs(el, {
    begin, end,
    turn: (key, v, node) => {
      const song = api.song();
      let words;
      if (key.startsWith("fx.")) {
        const [, i, p] = key.split(".");
        const f = picked(song).fx[+i]; if (!f) return;
        f[p] = v; words = fmt(v) + (FX[f.type].params[p][3] || "");
        const out = node.parentElement.querySelector("output"); if (out) out.textContent = words;
      } else {
        setValue(song, key, node.dataset.id, v);
        words = key === "pan" ? panWords(v) : db(v) + " dB";
      }
      api.sync(); api.save();
      return words;
    },
  });

  // ---- clicks ------------------------------------------------------------------------------------
  let routeTimer = 0;
  el.addEventListener("dblclick", (e) => {
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
    else if (a === "allow") { allow(list[i].url); api.sync(); render(); }
    else if (a === "open") openPlugin(list[i]);
    else if (a === "del") { api.change(() => { list.splice(i, 1); }); api.toast("Effect removed.", { label: "Undo", run: api.undo }); }
  });

  // ---- reorder effects: drag the grip (mouse or touch), or press the arrow keys on it -------------
  let drag = null, justDragged = false;
  const cards = () => [...el.querySelectorAll(".mx-fx")];
  const clearDrop = () => cards().forEach((c) => c.classList.remove("drag", "drop-before", "drop-after"));
  function dragTarget(y) {
    let best = drag.i, bd = Infinity;
    cards().forEach((c, j) => {
      const r = c.getBoundingClientRect(), d = Math.abs(y - (j === drag.i ? drag.cy : r.top + r.height / 2));
      if (d < bd) { bd = d; best = j; }
    });
    return best;
  }
  el.addEventListener("pointerdown", (e) => {
    const g = e.target.closest("[data-grip]");
    if (!g || (e.button !== undefined && e.button > 0)) return;
    const card = g.closest(".mx-fx"), r = card.getBoundingClientRect();
    drag = { i: +g.dataset.grip, card, g, x0: e.clientX, y0: e.clientY, cy: r.top + r.height / 2, id: e.pointerId, moved: false, to: +g.dataset.grip };
    try { g.setPointerCapture(e.pointerId); } catch { /* moves still arrive */ }
    e.preventDefault();
  });
  el.addEventListener("pointermove", (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x0, dy = e.clientY - drag.y0;
    if (!drag.moved && Math.hypot(dx, dy) < 4) return;
    drag.moved = true;
    drag.card.classList.add("drag");
    drag.card.style.transform = `translate(${dx}px, ${dy}px)`;
    drag.to = dragTarget(drag.cy + dy);
    cards().forEach((c, j) => {
      c.classList.toggle("drop-before", j === drag.to && drag.to < drag.i);
      c.classList.toggle("drop-after", j === drag.to && drag.to > drag.i);
    });
  });
  const endDrag = (e, cancel) => {
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag; drag = null;
    clearDrop(); d.card.style.transform = "";
    if (!d.moved) return;
    justDragged = true; setTimeout(() => { justDragged = false; }, 0);
    if (cancel || !d.card.isConnected || d.to === d.i) return;
    api.change(() => { moveFx(picked(api.song()).fx, d.i, d.to); });
  };
  el.addEventListener("pointerup", (e) => endDrag(e, false));
  el.addEventListener("pointercancel", (e) => endDrag(e, true));
  el.addEventListener("click", (e) => { if (justDragged && e.target.closest("[data-grip]")) e.stopPropagation(); }, true);
  el.addEventListener("keydown", (e) => {
    const g = e.target.closest?.("[data-grip]");
    if (!g) return;
    const dir = e.key === "ArrowUp" || e.key === "k" ? -1 : e.key === "ArrowDown" || e.key === "j" ? 1 : 0;
    if (!dir) return;
    e.preventDefault();
    const i = +g.dataset.grip, list = picked(api.song()).fx, to = i + dir;
    if (to < 0 || to >= list.length) return;
    api.change(() => { moveFx(list, i, to); });
    el.querySelector(`[data-grip="${to}"]`)?.focus();
  });

  // ---- a plugin's own window: the same kind of dialog as the sampler; Escape or a press outside closes it ----
  let win = null; // { fx, inst, scrim }
  async function openPlugin(f) {
    const st = entry(f);
    if (!st || !st.inst || win) return;
    const scrim = document.createElement("div");
    scrim.className = "ins-scrim";
    scrim.innerHTML = `<section class="ins-modal" role="dialog" aria-modal="true" aria-label="Plugin: ${esc(st.inst.name)}" tabindex="-1">` +
      `<header class="ins-head"><span class="ins-kind">Plugin</span><b>${esc(st.inst.name)}</b><span class="mx-gap"></span>` +
      `<button data-act="close" data-tip="Close (Escape)" aria-label="Close">${icon("close")}</button></header><div class="mx-wgui"></div></section>`;
    document.body.append(scrim);
    win = { fx: f, inst: st.inst, scrim };
    scrim.addEventListener("pointerdown", (e) => { if (e.target === scrim) closePlugin(); });
    scrim.querySelector('[data-act="close"]').addEventListener("click", closePlugin);
    const host = scrim.querySelector(".mx-wgui");
    try {
      const gui = await st.inst.gui();
      if (gui) host.append(gui); else host.textContent = "This plugin has no window of its own.";
    } catch (e) { host.textContent = "The plugin's window would not open: " + ((e && e.message) || "unknown error"); }
    scrim.querySelector('[data-act="close"]').focus();
  }
  async function closePlugin() {
    if (!win) return;
    const { fx, inst, scrim } = win; win = null;
    scrim.remove();
    let state = null;
    try { state = await inst.getState(); } catch { /* keeps the old settings */ }
    if (state == null) return render();
    if (JSON.stringify(state).length > WAM_STATE_MAX) { api.toast("This plugin's settings are too big to keep in the song."); return render(); }
    api.change(() => { fx.state = JSON.parse(JSON.stringify(state)); });
  }
  addEventListener("keydown", (e) => { if (e.key === "Escape" && win && !e.defaultPrevented) { e.preventDefault(); closePlugin(); } });

  function meters(levels) {
    const bar = (id, d) => { const i = el.querySelector(`.mx-strip[data-id="${id}"] .mx-meter i`); if (i) i.style.height = Math.round(Math.max(0, (d + 60) / 60) * 100) + "%"; };
    const song = api.song();
    song.tracks.forEach((_, i) => bar("t" + i, levels ? levels.tracks[i] ?? -60 : -60));
    (song.mixer.buses || []).forEach((_, i) => bar("b" + i, levels && levels.buses ? levels.buses[i] ?? -60 : -60));
    bar("m", levels ? levels.master : -60);
  }
  return { render, meters };
}
