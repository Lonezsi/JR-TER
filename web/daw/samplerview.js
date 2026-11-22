// samplerview.js: the Sampler tab. Pick a sound from the library, trim it, chop it.
//
//   mountSampler(el, api) -> { render }
//   api: song(), selected(), change(fn) (undoable edit), snap(), pushUndo(before), save(), toast(text),
//        addSampler(sound), buffer(src) -> Promise<AudioBuffer>, hear(src) (play 4 s), audition(track, from, to),
//        placeOnSong(track)
// Sounds come from library.js. Model and maths: sampler.js.
import { chop, addSlice, removeSliceNear, sampleEnd, peaks } from "./sampler.js";
import { librarySongs, soundsOf, waitingRenders } from "./library.js";

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const NOTE = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const noteName = (m) => NOTE[m % 12] + (Math.floor(m / 12) - 1);
const mmss = (s) => (s > 0 ? Math.floor(s / 60) + ":" + String(Math.floor(s % 60)).padStart(2, "0") : "");
const ICON = { take: "♪", vocal: "🎙", render: "▣" };

export function mountSampler(el, api) {
  let songs = null, listed = "renders", sounds = null, problem = "", loading = false;
  let drag = null, hold = 0;
  const wave = new Map(); // src -> peaks

  const track = () => { const t = api.song().tracks[api.selected()]; return t && t.sample ? t : null; };

  async function load(which) {
    listed = which; sounds = null; problem = ""; loading = true; render();
    try {
      if (!songs) songs = await librarySongs();
      sounds = which === "renders" ? await waitingRenders() : await soundsOf(which);
    } catch (e) {
      problem = e.message === "signin" ? "Sign in to JR!TER to use your library's sounds." : "Could not reach your library. " + (e.message || "");
    }
    loading = false; render();
  }

  function render() {
    const t = track(), s = t && t.sample;
    const opts = `<option value="renders"${listed === "renders" ? " selected" : ""}>Renders waiting</option>` +
      (songs || []).map((x) => `<option value="${x.id}"${String(x.id) === String(listed) ? " selected" : ""}>${esc(x.title)}</option>`).join("");
    const rows = loading ? `<div class="sv-doc">Loading…</div>` : problem ? `<div class="cv-err">${esc(problem)}</div>` :
      sounds === null ? `<div class="sv-doc"><button data-act="open">Show my library</button></div>` :
      !sounds.length ? `<div class="sv-doc">Nothing here yet.</div>` :
      `<div class="sp-list">` + sounds.map((x, i) => `<div class="sp-row"><span class="sp-ic" aria-hidden="true">${ICON[x.kind] || "♪"}</span>` +
        `<button class="sp-name" data-hear="${i}" data-tip="Hear it" aria-label="Hear ${esc(x.name)}">${esc(x.name)}</button><span class="sp-len">${mmss(x.seconds)}</span>` +
        `<button data-add="${i}" data-tip="Add as a sampler track" aria-label="Add ${esc(x.name)} as a sampler track">+</button></div>`).join("") + `</div>`;
    el.innerHTML =
      `<div class="cv-title">Sampler</div>` +
      `<div class="cv-line"><label>From your library <select id="sp-from" aria-label="Library">${opts}</select></label></div>` + rows +
      (s ? `<div class="cv-title">${esc(t.name)}: ${esc(s.name)}</div>` +
        `<canvas class="sp-wave" id="sp-wave" tabindex="0" aria-label="Waveform of ${esc(s.name)}. Comma and period move the start, with Shift the end."></canvas>` +
        `<div class="cv-line" role="group" aria-label="Sampler tools">` +
          [4, 8, 16].map((n) => `<button data-chop="${n}" data-tip="Cut into ${n} equal pieces">Chop ${n}</button>`).join("") +
          `<button data-act="clear" data-tip="Remove every cut"${s.slices.length ? "" : " disabled"}>Clear cuts</button>` +
          `<button data-act="hear" data-tip="Hear the whole sound" aria-label="Hear the sound">▶</button>` +
          `<label>Root <input id="sp-root" type="number" min="0" max="127" step="1" value="${s.root}" aria-label="Root key"><output>${noteName(s.root)}</output></label>` +
          `<button data-act="place" data-tip="Put it on the Song tab" aria-label="Place on the song">☰ Place</button></div>` +
        `<div class="sv-doc">${s.slices.length ? `Chopped in ${s.slices.length + 1}: ${noteName(s.root)} plays piece 1, ${noteName(s.root + 1)} piece 2, and so on. ` : `Every key plays it, ${noteName(s.root)} at its own speed. `}` +
        `Drag the ends to trim. Hold to add or remove a cut.</div>`
        : `<div class="sv-doc">Add a sound with + to get a sampler track. Select a sampler track to edit it here.</div>`);
    if (s) paint();
  }

  async function paint() {
    const t = track(), cv = el.querySelector("#sp-wave");
    if (!t || !cv) return;
    const s = t.sample, r = cv.getBoundingClientRect(), d = devicePixelRatio || 1;
    if (r.width < 2) return requestAnimationFrame(paint);
    cv.width = Math.round(r.width * d); cv.height = Math.round(r.height * d);
    const g = cv.getContext("2d"); g.setTransform(d, 0, 0, d, 0, 0);
    const W = r.width, H = r.height, css = getComputedStyle(el);
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

  el.addEventListener("pointerdown", (e) => {
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
  el.addEventListener("pointermove", (e) => {
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
  el.addEventListener("pointerup", finish);
  el.addEventListener("pointercancel", finish);

  el.addEventListener("keydown", (e) => {
    const t = track();
    if (!t || !e.target.closest("#sp-wave") || (e.key !== "," && e.key !== ".")) return;
    e.preventDefault();
    const s = t.sample, d = (e.key === "." ? 1 : -1) * 0.01 * (e.altKey ? 10 : 1);
    api.change(() => {
      if (e.shiftKey) s.end = clamp(sampleEnd(s) + d, s.start + 0.01, s.seconds || 1e6);
      else s.start = clamp(s.start + d, 0, sampleEnd(s) - 0.01);
      s.slices = s.slices.filter((c) => c > s.start && c < sampleEnd(s));
    });
    el.querySelector("#sp-wave")?.focus();
  });

  el.addEventListener("change", (e) => {
    if (e.target.id === "sp-from") return load(e.target.value === "renders" ? "renders" : +e.target.value);
    if (e.target.id === "sp-root") { const t = track(); if (t) api.change(() => { t.sample.root = clamp(Math.round(+e.target.value) || 60, 0, 127); }); }
  });
  el.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b || b.disabled) return;
    const t = track();
    if (b.dataset.hear != null) return api.hear(sounds[+b.dataset.hear].src);
    if (b.dataset.add != null) return api.addSampler(sounds[+b.dataset.add]);
    if (b.dataset.act === "open") return load(listed);
    if (!t) return;
    if (b.dataset.chop) api.change(() => chop(t.sample, +b.dataset.chop));
    else if (b.dataset.act === "clear") api.change(() => chop(t.sample, 1));
    else if (b.dataset.act === "hear") api.audition(t, t.sample.start, sampleEnd(t.sample));
    else if (b.dataset.act === "place") api.placeOnSong(api.selected());
  });

  return { render: () => { render(); if (sounds === null && !loading && !problem) load(listed); } };
}
