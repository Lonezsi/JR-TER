// mixerview.js: the Mixer tab. A strip per track, the two send buses and the master; below,
// the effects of the strip you picked.
//
//   mountMixer(el, api) -> { render, meters(levels | null) }
//   api: song(), change(fn) (undoable edit), snap(), pushUndo(before), save(), sync(), toast(text, action),
//        undo(), selected(), select(i)
// Model and maths: mixer.js. The audio graph: mixgraph.js.
import { FX, FX_TYPES, newFx, ensureMix, MAX_FX } from "./mixer.js";

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const fmt = (v) => (Math.abs(v) >= 10 ? v.toFixed(0) : Math.abs(v) >= 1 ? v.toFixed(1) : v.toFixed(2));

export function mountMixer(el, api) {
  let pick = "t0"; // "t<i>", "b0", "b1" or "m"

  // The thing a pick points at: { fx list, label }
  function target(song) {
    ensureMix(song);
    if (pick === "m") return { fx: song.mixer.master.fx, label: "Master" };
    if (pick[0] === "b" && song.mixer.buses[+pick[1]]) return { fx: song.mixer.buses[+pick[1]].fx, label: song.mixer.buses[+pick[1]].name };
    const i = +pick.slice(1);
    if (pick[0] === "t" && song.tracks[i]) return { fx: song.tracks[i].fx, label: song.tracks[i].name };
    pick = song.tracks.length ? "t" + Math.min(api.selected(), song.tracks.length - 1) : "m";
    return target(song);
  }

  const slider = (cls, label, min, max, step, value, extra) =>
    `<input type="range" class="${cls}" ${extra} min="${min}" max="${max}" step="${step}" value="${value}" aria-label="${esc(label)}">`;

  function strip(id, name, o) {
    return `<div class="mx-strip${pick === id ? " sel" : ""}" data-id="${id}">` +
      `<button class="mx-name" data-pick="${id}" aria-pressed="${pick === id}" data-tip="${esc(name)}">${esc(name)}</button>` +
      `<div class="mx-mid"><div class="mx-meter" aria-hidden="true"><i></i></div>` +
        slider("mx-fader", name + " volume", 0, 1, 0.01, o.volume, `data-k="volume" data-id="${id}"`) + `</div>` +
      (o.pan === undefined ? "" : slider("mx-pan", name + " pan", -1, 1, 0.01, o.pan, `data-k="pan" data-id="${id}"`)) +
      (o.sends ? o.sends.map((v, k) => slider("mx-send", name + (k ? " delay send" : " reverb send"), 0, 1, 0.01, v, `data-k="send${k}" data-id="${id}" data-tip="${k ? "Delay" : "Reverb"} send"`)).join("") : "") +
      (o.ms ? `<div class="mx-ms"><button data-ms="mute" data-id="${id}" aria-pressed="${!!o.ms.mute}" aria-label="Mute" data-tip="Mute">M</button>` +
        `<button data-ms="solo" data-id="${id}" aria-pressed="${!!o.ms.solo}" aria-label="Solo" data-tip="Solo">S</button></div>` : "") +
      `</div>`;
  }

  function fxCard(f, i, n) {
    const spec = FX[f.type];
    return `<div class="mx-fx${f.on ? "" : " off"}" data-i="${i}">` +
      `<div class="mx-fxh"><button role="switch" aria-checked="${f.on}" data-fx="toggle" data-i="${i}" aria-label="${spec.label} on or off" data-tip="On or off">${f.on ? "On" : "Off"}</button>` +
      `<b>${spec.label}</b><span class="mx-gap"></span>` +
      `<button data-fx="up" data-i="${i}" aria-label="Move earlier" data-tip="Move earlier"${i ? "" : " disabled"}>↑</button>` +
      `<button data-fx="down" data-i="${i}" aria-label="Move later" data-tip="Move later"${i < n - 1 ? "" : " disabled"}>↓</button>` +
      `<button data-fx="del" data-i="${i}" aria-label="Remove" data-tip="Remove">✕</button></div>` +
      Object.entries(spec.params).map(([k, [lo, hi, , unit]]) =>
        `<label class="mx-p"><span>${k}</span>${slider("mx-param", spec.label + " " + k, lo, hi, (hi - lo) / 200, f[k], `data-i="${i}" data-p="${k}"`)}<output>${fmt(f[k])}${unit}</output></label>`).join("") +
      `</div>`;
  }

  function render() {
    const song = api.song(), t = target(song), m = song.mixer;
    el.innerHTML =
      `<div class="cv-title">Mixer</div>` +
      `<div class="mx-strips">` +
        song.tracks.map((tr, i) => strip("t" + i, tr.name, { volume: tr.volume, pan: tr.pan, sends: tr.sends, ms: tr })).join("") +
        m.buses.map((b, i) => strip("b" + i, b.name, { volume: b.volume })).join("") +
        strip("m", "Master", { volume: m.master.volume }) +
      `</div>` +
      `<div class="cv-line"><b class="mx-who">${esc(t.label)}</b><span class="sl-sep"></span>` +
        FX_TYPES.map((k) => `<button data-add="${k}" data-tip="Add ${FX[k].label}" aria-label="Add ${FX[k].label}"${t.fx.length >= MAX_FX ? " disabled" : ""}>+ ${FX[k].label}</button>`).join("") + `</div>` +
      `<div class="mx-chain">${t.fx.length ? t.fx.map((f, i) => fxCard(f, i, t.fx.length)).join("") : `<div class="sv-doc">No effects here. Add one above. They run in order, top left first.</div>`}</div>` +
      `<div class="sv-doc">The master ends in a limiter, so the sum never clips. Send knobs feed the Reverb and Delay strips.</div>`;
  }

  // What a slider changes. `before` is taken on the first input of a drag, pushed on change.
  function apply(input) {
    const song = api.song(), id = input.dataset.id, v = +input.value;
    if (input.dataset.p !== undefined) { target(song).fx[+input.dataset.i][input.dataset.p] = v; input.parentElement.querySelector("output").textContent = fmt(v) + (FX[target(song).fx[+input.dataset.i].type].params[input.dataset.p][3] || ""); return; }
    const k = input.dataset.k;
    if (id === "m") song.mixer.master.volume = v;
    else if (id[0] === "b") song.mixer.buses[+id[1]].volume = v;
    else {
      const tr = song.tracks[+id.slice(1)];
      if (k === "volume") tr.volume = v; else if (k === "pan") tr.pan = v; else tr.sends[+k.slice(4)] = v;
    }
  }
  let before = null;
  el.addEventListener("input", (e) => {
    if (!e.target.matches("input[type=range]")) return;
    if (before === null) before = api.snap();
    apply(e.target); api.sync(); api.save();
  });
  el.addEventListener("change", (e) => {
    if (!e.target.matches("input[type=range]")) return;
    if (before !== null) { if (api.snap() !== before) api.pushUndo(before); before = null; }
  });

  el.addEventListener("click", (e) => {
    const song = api.song();
    const p = e.target.closest("[data-pick]");
    if (p) { pick = p.dataset.pick; if (pick[0] === "t") api.select(+pick.slice(1)); return render(); }
    const ms = e.target.closest("[data-ms]");
    if (ms) { const tr = song.tracks[+ms.dataset.id.slice(1)]; return api.change(() => { tr[ms.dataset.ms] = !tr[ms.dataset.ms]; }); }
    const add = e.target.closest("[data-add]");
    if (add && !add.disabled) return api.change(() => { target(song).fx.push(newFx(add.dataset.add)); });
    const b = e.target.closest("[data-fx]");
    if (!b || b.disabled) return;
    const list = target(song).fx, i = +b.dataset.i, a = b.dataset.fx;
    if (a === "toggle") api.change(() => { list[i].on = !list[i].on; });
    else if (a === "up") api.change(() => { [list[i - 1], list[i]] = [list[i], list[i - 1]]; });
    else if (a === "down") api.change(() => { [list[i + 1], list[i]] = [list[i], list[i + 1]]; });
    else if (a === "del") { api.change(() => { list.splice(i, 1); }); api.toast("Effect removed.", { label: "Undo", run: api.undo }); }
  });

  function meters(levels) {
    const bar = (id, db) => { const i = el.querySelector(`.mx-strip[data-id="${id}"] .mx-meter i`); if (i) i.style.height = Math.round(Math.max(0, (db + 60) / 60) * 100) + "%"; };
    const n = api.song().tracks.length;
    for (let i = 0; i < n; i++) bar("t" + i, levels ? levels.tracks[i] ?? -60 : -60);
    bar("m", levels ? levels.master : -60);
    bar("b0", -60); bar("b1", -60);
  }
  return { render, meters };
}
