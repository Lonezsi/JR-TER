// songview.js: the song playlist. Lanes along a bar timeline; pattern clips on them.
//
//   mountSong(el, api) -> { render, playhead(beat) }
//   api: song(), change(fn) (undoable edit), snap(), pushUndo(before), save(), toast(text, action),
//        setMode(m), editPattern(k), undo()
// Tap an empty cell to place the pattern you paint with. Drag a clip to move it, drag its end to
// repeat it, hold it to delete it. Model and maths: playlist.js.
import { addClip, moveClip, resizeClip, splitClip, removeClip, songBars, MAX_LANES, MAX_BARS } from "./playlist.js";

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const BAR_PX = 36;

export function mountSong(el, api) {
  let brush = 0, selected = -1, drag = null, hold = 0;

  function render() {
    const song = api.song();
    const pats = song.patterns || [];
    const clips = song.clips || [];
    brush = clamp(brush, 0, Math.max(0, pats.length - 1));
    if (selected >= clips.length) selected = -1;
    const lanes = clamp(Math.max(4, ...clips.map((c) => c.lane + 2)), 4, MAX_LANES);
    const bars = clamp(songBars(song) + 8, 16, MAX_BARS);
    const sel = clips[selected];
    let ruler = "", lanesHtml = "";
    for (let b = 0; b < bars; b++) ruler += `<span class="sl-n">${b % 4 === 0 ? b + 1 : ""}</span>`;
    for (let l = 0; l < lanes; l++) {
      let cells = "";
      for (let b = 0; b < bars; b++) cells += `<button class="sl-cell${b % 4 === 0 ? " beat" : ""}" data-lane="${l}" data-bar="${b}" aria-label="Lane ${l + 1}, bar ${b + 1}" tabindex="-1"></button>`;
      lanesHtml += `<div class="sl-lane" data-lane="${l}">${cells}` +
        clips.map((c, i) => c.lane !== l ? "" :
          `<button class="sl-clip${i === selected ? " sel" : ""}" data-c="${i}" style="left:${c.start * BAR_PX}px;width:${c.length * BAR_PX}px;--h:${(c.pattern * 67) % 360}" aria-label="${esc((pats[c.pattern] || {}).name)}, bar ${c.start + 1}, ${c.length} bars">` +
          `<span class="sl-lbl">${c.pattern + 1}. ${esc((pats[c.pattern] || {}).name)}</span><span class="sl-end" data-end="${i}"></span></button>`).join("") +
        `</div>`;
    }
    el.innerHTML =
      `<div class="cv-title">Song</div>` +
      `<div class="cv-line" role="group" aria-label="What Play plays">` +
        `<button data-mode="pattern" aria-pressed="${song.mode !== "song"}" data-tip="Play loops the pattern you are editing">Pattern</button>` +
        `<button data-mode="song" aria-pressed="${song.mode === "song"}" data-tip="Play runs the clips below">Song</button>` +
        `<span class="sl-sep"></span>` +
        `<span class="sl-paint">Paint with</span>` +
        pats.map((p, i) => `<button data-brush="${i}" aria-pressed="${i === brush}" data-tip="${esc(p.name)}" aria-label="Paint ${esc(p.name)}">${i + 1}</button>`).join("") +
      `</div>` +
      `<div class="cv-line sl-tools">` +
        `<button data-act="edit" aria-label="Edit this pattern in the rack" data-tip="Edit this pattern in the rack"${sel ? "" : " disabled"}>Edit</button>` +
        `<button data-act="split" aria-label="Cut the clip in half" data-tip="Cut the clip in half"${sel && sel.length > 1 ? "" : " disabled"}>Split</button>` +
        `<button data-act="del" aria-label="Delete the clip" data-tip="Delete the clip"${sel ? "" : " disabled"}>Delete</button></div>` +
      `<div class="sl-scroll"><div class="sl-grid" style="--bar:${BAR_PX}px;width:${bars * BAR_PX}px">` +
        `<div class="sl-ruler">${ruler}</div>${lanesHtml}<div class="sl-head" hidden></div></div></div>` +
      `<div class="sv-doc">Tap a lane to place the pattern. Drag a clip to move it, drag its end to repeat it. Hold a clip to delete it.</div>`;
  }

  const barAt = (e, grid) => Math.floor((e.clientX - grid.getBoundingClientRect().left) / BAR_PX);
  const laneAt = (e, grid) => {
    const rows = [...grid.querySelectorAll(".sl-lane")];
    for (const r of rows) { const b = r.getBoundingClientRect(); if (e.clientY >= b.top && e.clientY < b.bottom) return +r.dataset.lane; }
    return e.clientY < rows[0].getBoundingClientRect().top ? 0 : rows.length - 1;
  };

  function removeSel(i) {
    api.change(() => { removeClip(api.song(), i); selected = -1; });
    api.toast("Clip deleted.", { label: "Undo", run: api.undo });
  }

  el.addEventListener("pointerdown", (e) => {
    const clip = e.target.closest(".sl-clip");
    if (!clip) return;
    const i = +clip.dataset.c, c = api.song().clips[i], grid = el.querySelector(".sl-grid");
    const atEnd = !!e.target.closest(".sl-end");
    selected = i; brush = c.pattern;
    drag = { i, end: atEnd, id: e.pointerId, x0: e.clientX, y0: e.clientY, bar0: barAt(e, grid), start0: c.start, len0: c.length, moved: false, before: api.snap(), grid };
    try { clip.setPointerCapture(e.pointerId); } catch { /* moves still arrive */ }
    clearTimeout(hold);
    if (!atEnd) hold = setTimeout(() => { if (drag && !drag.moved) { const d = drag; drag = null; navigator.vibrate?.(12); removeSel(d.i); } }, 460);
    el.querySelectorAll(".sl-clip.sel").forEach((x) => x.classList.remove("sel"));
    clip.classList.add("sel");
  });
  el.addEventListener("pointermove", (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    if (!drag.moved && Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < 6) return;
    drag.moved = true; clearTimeout(hold);
    const song = api.song(), db = barAt(e, drag.grid) - drag.bar0;
    if (drag.end) resizeClip(song, drag.i, drag.len0 + db);
    else moveClip(song, drag.i, laneAt(e, drag.grid), drag.start0 + db);
    const c = song.clips[drag.i], node = el.querySelector(`.sl-clip[data-c="${drag.i}"]`);
    if (node) {
      node.style.left = c.start * BAR_PX + "px"; node.style.width = c.length * BAR_PX + "px";
      const lane = el.querySelector(`.sl-lane[data-lane="${c.lane}"]`);
      if (lane && node.parentElement !== lane) lane.append(node);
    }
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

  el.addEventListener("click", (e) => {
    const cell = e.target.closest(".sl-cell");
    if (cell) {
      const song = api.song(), bar = +cell.dataset.bar, lane = +cell.dataset.lane;
      api.change(() => { selected = addClip(song, brush, lane, bar); });
      return;
    }
    if (e.target.closest(".sl-clip")) return;
    const mode = e.target.closest("[data-mode]");
    if (mode) return api.setMode(mode.dataset.mode);
    const br = e.target.closest("[data-brush]");
    if (br) { brush = +br.dataset.brush; return render(); }
    const act = e.target.closest("[data-act]");
    if (!act || act.disabled) return;
    const song = api.song(), c = song.clips[selected];
    if (!c) return;
    if (act.dataset.act === "edit") api.editPattern(c.pattern);
    else if (act.dataset.act === "split") api.change(() => { splitClip(song, selected, c.start + Math.floor(c.length / 2)); });
    else if (act.dataset.act === "del") removeSel(selected);
  });

  el.addEventListener("keydown", (e) => {
    const clip = e.target.closest && e.target.closest(".sl-clip");
    if (!clip) return;
    const i = +clip.dataset.c, song = api.song(), c = song.clips[i];
    if (!c) return;
    const k = e.key;
    if (k === "Delete" || k === "Backspace") { e.preventDefault(); return removeSel(i); }
    if (k === "Enter") { e.preventDefault(); return api.editPattern(c.pattern); }
    const d = k === "ArrowRight" || k === "ArrowDown" ? 1 : -1;
    if (k === "ArrowLeft" || k === "ArrowRight") api.change(() => { if (e.shiftKey) resizeClip(song, i, c.length + d); else moveClip(song, i, c.lane, c.start + d); });
    else if (k === "ArrowUp" || k === "ArrowDown") api.change(() => moveClip(song, i, c.lane + d, c.start));
    else return;
    e.preventDefault(); selected = i; render();
    el.querySelector(`.sl-clip[data-c="${i}"]`)?.focus();
  });

  function playhead(beat) {
    const head = el.querySelector(".sl-head");
    if (!head) return;
    if (beat < 0) { head.hidden = true; return; }
    head.hidden = false;
    head.style.transform = `translateX(${(beat / 4) * BAR_PX}px)`;
  }
  return { render, playhead };
}
