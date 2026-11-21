// scriptview.js: pick a note script, set its sliders, run it on the selected track, or edit it.
//
//   mountScripts(el, api)
//   api: song(), change(fn), undo(), runOn(code, values) -> { ok, message }, trackName()
import { parseScript, ScriptError } from "./script.js";

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

export function mountScripts(el, api) {
  let at = 0;
  const list = () => api.song().scripts;
  const cur = () => list()[Math.min(at, list().length - 1)];

  function paramsOf(code) {
    try { return { params: parseScript(code).params, error: "" }; }
    catch (e) { return { params: [], error: e instanceof ScriptError ? e.message : String(e.message || e) }; }
  }

  function render(message = "") {
    const s = cur();
    if (!s) { el.innerHTML = `<div class="cv-line"><button data-act="new">+ New script</button></div>`; return; }
    const { params, error } = paramsOf(s.code);
    el.innerHTML =
      `<div class="cv-title">Script for “${esc(api.trackName())}”</div>` +
      `<div class="cv-line"><select id="sv-pick" aria-label="Script">${list().map((x, i) => `<option value="${i}"${i === at ? " selected" : ""}>${esc(x.name)}</option>`).join("")}</select>` +
        `<button data-act="new" aria-label="New script">+ New</button><button data-act="dup" aria-label="Duplicate this script">Duplicate</button><button data-act="del" aria-label="Delete this script">Delete</button></div>` +
      `<div class="cv-line"><label>Name <input id="sv-name" type="text" value="${esc(s.name)}"></label></div>` +
      params.map((p) => {
        const v = Number.isFinite(s.values[p.name]) ? s.values[p.name] : p.value;
        return `<div class="sv-param"><span>${esc(p.name)}</span><input type="range" data-param="${esc(p.name)}" min="${p.min}" max="${p.max}" step="${p.max - p.min > 20 ? 1 : 0.1}" value="${v}" aria-label="${esc(p.name)}"><output>${v}</output></div>`;
      }).join("") +
      `<div class="cv-line"><button data-act="run" id="sv-run"><b>Run on the track</b></button><span class="sv-doc">One undo takes it back.</span></div>` +
      `<div class="cv-err" role="alert">${esc(message || error)}</div>` +
      `<textarea class="sv-code" id="sv-code" spellcheck="false" autocapitalize="off" autocomplete="off" aria-label="Script code">${esc(s.code)}</textarea>` +
      `<div class="sv-doc">Lines under <code>each note:</code> run once per note; under <code>each chord:</code> once per chord. ` +
      `Fields: pitch, start, length (beats), velocity. <code>1/16n</code> is a sixteenth. Functions: rand, round, floor, ceil, abs, min, max, clamp, choose. ` +
      `Also: <code>if x: …</code>, <code>delete</code>, <code>arp up step 1/16n octaves 2</code>, <code>strum 0.05</code>. The full list is at the top of web/daw/script.js.</div>`;
  }

  el.addEventListener("click", (e) => {
    const b = e.target.closest("[data-act]");
    if (!b) return;
    const act = b.dataset.act, s = cur();
    if (act === "run") {
      const r = api.runOn(s.code, s.values, s.name);
      if (!r.ok) render(r.message);
    }
    else if (act === "new") { api.change(() => { list().push({ name: "Script " + (list().length + 1), values: {}, code: "# What it does\neach note:\n  pitch += 0\n" }); at = list().length - 1; }); }
    else if (act === "dup") { api.change(() => { list().splice(at + 1, 0, { name: s.name + " copy", code: s.code, values: { ...s.values } }); at++; }); }
    else if (act === "del") { api.change(() => { list().splice(at, 1); at = Math.max(0, Math.min(at, list().length - 1)); }); }
  });
  el.addEventListener("change", (e) => {
    const id = e.target.id;
    if (id === "sv-pick") { at = +e.target.value; render(); }
    else if (id === "sv-name") api.change(() => { cur().name = e.target.value || "Script"; });
    else if (id === "sv-code") { api.change(() => { cur().code = e.target.value; }); }
  });
  el.addEventListener("input", (e) => {
    if (e.target.dataset.param) { cur().values[e.target.dataset.param] = Number(e.target.value); e.target.nextElementSibling.textContent = e.target.value; api.save(); }
    else if (e.target.id === "sv-code") { // show a mistake as you type, without rebuilding the box you are typing in
      const { error } = paramsOf(e.target.value);
      const box = el.querySelector(".cv-err"); if (box) box.textContent = error;
    }
  });
  // Tab inserts two spaces instead of leaving the box.
  el.addEventListener("keydown", (e) => {
    if (e.target.id === "sv-code" && e.key === "Tab") {
      e.preventDefault();
      const t = e.target, a = t.selectionStart;
      t.setRangeText("  ", a, t.selectionEnd, "end");
    }
  });
  return { render };
}
