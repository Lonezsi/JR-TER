// songview.js: the song playlist. Lanes along a bar timeline; pattern clips on them.
//
//   mountSong(el, api) -> { render, playhead(beat), paintWith(brush) }
//   api: song(), change(fn) (undoable edit), snap(), pushUndo(before), save(), toast(text, action),
//        setMode(m), editPattern(k), editSample(track), undo()
// The brush is a pattern number, or "t3": an audio clip of track 3's sample (sampler.js).
// Tap an empty cell to place the pattern you paint with. Drag a clip to move it, drag its end to
// repeat it, hold it to delete it. Drag along the bar ruler to loop a range (drag its edges or
// middle, arrows nudge, double-click or Delete clears). Model and maths: playlist.js.
import { icon } from "./icons.js";
import { addClip, addAudioClip, moveClip, resizeClip, trimClipStart, splitClip, removeClip, songBars, setLoop, moveLoop, cleanLoop, MAX_LANES, MAX_BARS } from "./playlist.js";

import { clipBars } from "./sampler.js";
import { SONG_STEPS, stepFor, snapFloor, snapRound, snapOptions, loadSnap, saveSnap } from "./snap.js";
import { mountLanes } from "./autolanes.js";

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const BAR_PX = 36;     // one bar at zoom 1
const MIN_PX = 16;     // auto snap: the finest step that is still this wide on screen
const ZOOMS = [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4, 6, 8];
const QB = 16;         // clips sit on sixteenths of a bar

export function mountSong(el, api) {
  let ldrag = null, brush = 0, selected = -1, drag = null, hold = 0, zoomS = 1, others = [];
  const snapSet = loadSnap(localStorage);
  const barPx = () => BAR_PX * zoomS;
  // How far clips snap, in beats (0 = to the sixteenth of a bar, the grid clips live on).
  const step = () => stepFor(snapSet.song, barPx() / 4, MIN_PX, SONG_STEPS);
  const stepBars = () => Math.max(1 / QB, (step() || 0.25) / 4);
  const autoLanes = mountLanes(el, api, { barPx, step, render: () => render() });

  function render() {
    const song = api.song();
    const pats = song.patterns || [];
    const clips = song.clips || [];
    const samplers = song.tracks.map((t, i) => (t.sample ? i : -1)).filter((i) => i >= 0);
    if (typeof brush === "string" && !samplers.includes(+brush.slice(1))) brush = 0;
    if (typeof brush === "number") brush = clamp(brush, 0, Math.max(0, pats.length - 1));
    if (selected >= clips.length) selected = -1;
    const lanes = clamp(Math.max(4, ...clips.map((c) => c.lane + 2)), 4, MAX_LANES);
    const bars = clamp(Math.ceil(songBars(song)) + 8, 16, MAX_BARS);
    const sel = clips[selected];
    const L = cleanLoop(song.loop);
    const BP = barPx(), every = BP >= 60 ? 1 : BP >= 24 ? 4 : 16;
    let ruler = "", lanesHtml = "";
    for (let b = 0; b < bars; b++) ruler += `<span class="sl-n">${b % every === 0 ? b + 1 : ""}</span>`;
    for (let l = 0; l < lanes; l++) {
      let cells = "";
      for (let b = 0; b < bars; b++) cells += `<button class="sl-cell${b % 4 === 0 ? " beat" : ""}" data-lane="${l}" data-bar="${b}" aria-label="Lane ${l + 1}, bar ${b + 1}" tabindex="-1"></button>`;
      lanesHtml += `<div class="sl-lane" data-lane="${l}">${cells}` +
        clips.map((c, i) => c.lane !== l ? "" :
          (c.track != null
            ? `<button class="sl-clip audio${i === selected ? " sel" : ""}" data-c="${i}" style="left:${c.start * BP}px;width:${c.length * BP}px;--h:${(c.track * 67 + 200) % 360}" aria-label="${esc((song.tracks[c.track] || {}).name)}, audio, bar ${c.start + 1}, ${c.length} bars">` +
              `<span class="sl-start" data-start="${i}"></span><span class="sl-lbl">${icon("wave", 12)}${esc((song.tracks[c.track] || {}).name)}</span><span class="sl-end" data-end="${i}"></span></button>`
            : `<button class="sl-clip${i === selected ? " sel" : ""}" data-c="${i}" style="left:${c.start * BP}px;width:${c.length * BP}px;--h:${(c.pattern * 67) % 360}" aria-label="${esc((pats[c.pattern] || {}).name)}, bar ${c.start + 1}, ${c.length} bars">` +
              `<span class="sl-start" data-start="${i}"></span><span class="sl-lbl">${c.pattern + 1}. ${esc((pats[c.pattern] || {}).name)}</span><span class="sl-end" data-end="${i}"></span></button>`)).join("") +
        `</div>`;
    }
    const { loopHtml, bandHtml } = loopMarkup(L, BP);
    el.innerHTML =
            `<div class="cv-line" role="group" aria-label="What Play plays">` +
        `<button data-mode="pattern" aria-pressed="${song.mode !== "song"}" data-tip="Play loops the pattern you are editing">Pattern</button>` +
        `<button data-mode="song" aria-pressed="${song.mode === "song"}" data-tip="Play runs the clips below">Song</button>` +
        `<span class="sl-sep"></span>` +
        `<span class="sl-paint">Paint with</span>` +
        pats.map((p, i) => `<button data-brush="${i}" aria-pressed="${i === brush}" data-tip="${esc(p.name)}" aria-label="Paint ${esc(p.name)}">${i + 1}</button>`).join("") +
        samplers.map((i) => `<button data-brush="t${i}" aria-pressed="${brush === "t" + i}" data-tip="Audio: ${esc(song.tracks[i].name)}" aria-label="Paint audio ${esc(song.tracks[i].name)}">${icon("wave")}${esc(song.tracks[i].name)}</button>`).join("") +
      `</div>` +
      `<div class="cv-line sl-tools">` +
        `<button data-act="edit" aria-label="Edit this pattern in the Drumroll" data-tip="Edit this pattern in the Drumroll"${sel ? "" : " disabled"}>Edit</button>` +
        `<button data-act="split" aria-label="Cut the clip in half" data-tip="Cut the clip in half"${sel && sel.length >= 2 / QB ? "" : " disabled"}>Split</button>` +
        `<button data-act="del" aria-label="Delete the clip" data-tip="Delete the clip"${sel ? "" : " disabled"}>Delete</button>` +
        `<span class="sl-sep"></span>${autoLanes.button()}` +
        `<span class="sl-sep"></span><button data-act="zoomout" aria-label="Zoom out" data-tip="Zoom out (Ctrl+wheel, or pinch)">${icon("zoom-out")}</button><button data-act="zoomin" aria-label="Zoom in" data-tip="Zoom in (Ctrl+wheel, or pinch)">${icon("zoom-in")}</button>` +
        `<label>Snap <select data-snap aria-label="Snap">${snapOptions(SONG_STEPS, snapSet.song, step())}</select></label></div>` + autoLanes.menu(song) +
      `<div class="sl-scroll"><div class="sl-grid" style="--bar:${BP}px;width:${bars * BP}px">` +
        `<div class="sl-ruler" data-tip="Drag to loop a range">${ruler}${loopHtml}</div>${bandHtml}${lanesHtml}${autoLanes.html(song, bars)}<div class="sl-head" hidden></div></div></div>`;
    drawPeople();
  }

  // Friends working in the same song: a coloured line where their pointer is on this tab.
  function drawPeople() {
    el.querySelectorAll(".sl-who").forEach((n) => n.remove());
    const grid = el.querySelector(".sl-grid");
    if (!grid) return;
    for (const p of others) {
      const c = p.cursor || {};
      if (c.tab !== "song" || typeof c.beat !== "number") continue;
      const n = document.createElement("div");
      n.className = "sl-who"; n.setAttribute("aria-hidden", "true");
      n.style.setProperty("--hue", String(p.hue)); n.style.transform = `translateX(${(c.beat / 4) * barPx()}px)`;
      const name = document.createElement("span"); name.textContent = p.name; n.append(name);
      grid.append(n);
    }
  }

  // Where the pointer is on the timeline, in bars (fractional).
  const barAt = (e, grid) => (e.clientX - grid.getBoundingClientRect().left) / barPx();
  const laneAt = (e, grid) => {
    const rows = [...grid.querySelectorAll(".sl-lane")];
    for (const r of rows) { const b = r.getBoundingClientRect(); if (e.clientY >= b.top && e.clientY < b.bottom) return +r.dataset.lane; }
    return e.clientY < rows[0].getBoundingClientRect().top ? 0 : rows.length - 1;
  };

  function clearLoop() {
    api.change(() => { delete api.song().loop; });
    api.toast("Loop cleared.", { label: "Undo", run: api.undo });
  }
  function loopMarkup(L, BP) {
    if (!L) return { loopHtml: "", bandHtml: "" };
    const pos = `style="left:${L.from * BP}px;width:${(L.to - L.from) * BP}px"`;
    return {
      loopHtml: `<div class="sl-loop" data-loop="move" tabindex="0" ${pos} aria-label="Loop, bar ${L.from + 1} to ${L.to + 1}. Arrows move it, Delete clears it" data-tip="Loop: drag to move, double-click to clear">` +
        `<span class="sl-loop-e a" data-loop="from" role="slider" tabindex="0" aria-label="Loop start" aria-valuenow="${L.from + 1}"></span><span class="sl-loop-e b" data-loop="to" role="slider" tabindex="0" aria-label="Loop end" aria-valuenow="${L.to + 1}"></span></div>`,
      bandHtml: `<div class="sl-loopband" ${pos}></div>`,
    };
  }
  function placeLoop() {
    const l = cleanLoop(api.song().loop), BP = barPx();
    const a = el.querySelector(".sl-loop"), b = el.querySelector(".sl-loopband");
    if (!l) { a?.remove(); b?.remove(); return; }
    if (!a || !b) { // the first bit of a drag: add the range without redrawing, so the pointer keeps its element
      a?.remove(); b?.remove();
      const m = loopMarkup(l, BP);
      el.querySelector(".sl-ruler").insertAdjacentHTML("beforeend", m.loopHtml);
      el.querySelector(".sl-ruler").insertAdjacentHTML("afterend", m.bandHtml);
      return;
    }
    for (const n of [a, b]) { n.style.left = l.from * BP + "px"; n.style.width = (l.to - l.from) * BP + "px"; }
  }
  el.addEventListener("pointerdown", (e) => {
    const ruler = e.target.closest(".sl-ruler");
    if (!ruler) return;
    const grid = el.querySelector(".sl-grid"), l = cleanLoop(api.song().loop), bar0 = barAt(e, grid);
    const kind = e.target.closest("[data-loop]")?.dataset.loop || "draw";
    ldrag = { kind, id: e.pointerId, x0: e.clientX, bar0, from0: l ? l.from : bar0, to0: l ? l.to : bar0, before: api.snap(), grid, moved: false };
    try { ruler.setPointerCapture(e.pointerId); } catch { /* moves still arrive */ }
  });
  el.addEventListener("pointermove", (e) => {
    if (!ldrag || e.pointerId !== ldrag.id) return;
    if (!ldrag.moved && Math.abs(e.clientX - ldrag.x0) < 4) return;
    ldrag.moved = true;
    const song = api.song(), d = ldrag, db = barAt(e, d.grid) - d.bar0, sb = step() / 4, sm = stepBars();
    const snapped = (x) => (sb > 0 ? snapRound(x, sb) : Math.round(x * QB) / QB);
    if (d.kind === "draw") setLoop(song, snapped(d.bar0), snapped(d.bar0 + db));
    else if (d.kind === "from") setLoop(song, Math.min(snapped(d.from0 + db), d.to0 - sm), d.to0);
    else if (d.kind === "to") setLoop(song, d.from0, Math.max(snapped(d.to0 + db), d.from0 + sm));
    else { song.loop = { from: d.from0, to: d.to0 }; moveLoop(song, snapped(d.from0 + db) - d.from0); }
    placeLoop();
  });
  const endLoop = (e) => {
    if (!ldrag || e.pointerId !== ldrag.id) return;
    const d = ldrag; ldrag = null;
    if (!d.moved) return;
    if (api.snap() !== d.before) { api.pushUndo(d.before); api.save(); }
    render();
  };
  el.addEventListener("pointerup", endLoop);
  el.addEventListener("pointercancel", endLoop);
  el.addEventListener("dblclick", (e) => {
    if (e.target.closest(".sl-ruler") && cleanLoop(api.song().loop)) clearLoop();
  });

  function removeSel(i) {
    api.change(() => { removeClip(api.song(), i); selected = -1; });
    api.toast("Clip deleted.", { label: "Undo", run: api.undo });
  }

  el.addEventListener("pointerdown", (e) => {
    const clip = e.target.closest(".sl-clip");
    if (!clip) return;
    const i = +clip.dataset.c, c = api.song().clips[i], grid = el.querySelector(".sl-grid");
    const atEnd = !!e.target.closest(".sl-end"), atStart = !!e.target.closest(".sl-start");
    selected = i; if (c.pattern != null) brush = c.pattern;
    drag = { i, end: atEnd, start: atStart, off0: c.offset || 0, id: e.pointerId, x0: e.clientX, y0: e.clientY, bar0: barAt(e, grid), start0: c.start, len0: c.length, moved: false, before: api.snap(), grid };
    try { clip.setPointerCapture(e.pointerId); } catch { /* moves still arrive */ }
    clearTimeout(hold);
    if (!atEnd && !atStart) hold = setTimeout(() => { if (drag && !drag.moved) { const d = drag; drag = null; navigator.vibrate?.(12); removeSel(d.i); } }, 460);
    el.querySelectorAll(".sl-clip.sel").forEach((x) => x.classList.remove("sel"));
    clip.classList.add("sel");
  });
  el.addEventListener("pointermove", (e) => {
    const g = e.target.closest && e.target.closest(".sl-grid");
    if (g && api.cursor) api.cursor(Math.max(0, Math.round(barAt(e, g) * 16) / 4));
    if (!drag || e.pointerId !== drag.id) return;
    if (!drag.moved && Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < 6) return;
    drag.moved = true; clearTimeout(hold);
    const song = api.song(), db = barAt(e, drag.grid) - drag.bar0, sb = step() / 4;
    // Snap the result, not the movement: a clip that started off the grid lands on it.
    const snapped = (bars) => (sb > 0 ? snapRound(bars, sb) : bars);
    if (drag.start) {
      const c0 = song.clips[drag.i]; c0.start = drag.start0; c0.length = drag.len0; c0.offset = drag.off0;
      trimClipStart(song, drag.i, Math.min(snapped(drag.start0 + db) - drag.start0, drag.len0 - stepBars()));
    } else if (drag.end) resizeClip(song, drag.i, Math.max(stepBars(), snapped(drag.len0 + db)));
    else moveClip(song, drag.i, laneAt(e, drag.grid), snapped(drag.start0 + db));
    const c = song.clips[drag.i], node = el.querySelector(`.sl-clip[data-c="${drag.i}"]`);
    if (node) {
      node.style.left = c.start * barPx() + "px"; node.style.width = c.length * barPx() + "px";
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

  // Where a pointer is on the grid: its lane, and the bar it snaps down to.
  function spotAt(e) {
    const grid = el.querySelector(".sl-grid");
    if (!grid) return null;
    const at = barAt(e, grid), sb = step() / 4;
    return { lane: laneAt(e, grid), bar: Math.max(0, sb > 0 ? snapFloor(at, sb) : Math.floor(at * QB) / QB) };
  }

  el.addEventListener("click", (e) => {
    const cell = e.target.closest(".sl-cell");
    if (cell) {
      // The cell is a whole bar; the tap lands somewhere in it, and snaps to the grid.
      const song = api.song(), lane = +cell.dataset.lane, bar = spotAt(e).bar;
      api.change(() => {
        if (typeof brush === "string") { const t = +brush.slice(1); selected = addAudioClip(song, t, lane, bar, clipBars(song.tracks[t].sample, song.bpm)); }
        else selected = addClip(song, brush, lane, bar);
      });
      return;
    }
    if (e.target.closest(".sl-clip")) return;
    const mode = e.target.closest("[data-mode]");
    if (mode) return api.setMode(mode.dataset.mode);
    const br = e.target.closest("[data-brush]");
    if (br) { brush = br.dataset.brush[0] === "t" ? br.dataset.brush : +br.dataset.brush; return render(); }
    const act = e.target.closest("[data-act]");
    if (!act || act.disabled) return;
    if (act.dataset.act === "zoomin") return zoomBy(1);
    if (act.dataset.act === "zoomout") return zoomBy(-1);
    const song = api.song(), c = song.clips[selected];
    if (!c) return;
    if (act.dataset.act === "edit") { if (c.track != null) api.editSample(c.track); else api.editPattern(c.pattern); }
    else if (act.dataset.act === "split") api.change(() => { splitClip(song, selected, c.start + Math.max(1 / QB, Math.round((c.length / 2) * QB) / QB)); });
    else if (act.dataset.act === "del") removeSel(selected);
  });

  el.addEventListener("keydown", (e) => {
    const lp = e.target.closest && e.target.closest("[data-loop]");
    if (lp) {
      const song = api.song(), l = cleanLoop(song.loop), kind = lp.dataset.loop, k = e.key, sm = stepBars();
      if (!l) return;
      if (k === "Delete" || k === "Backspace") { e.preventDefault(); return clearLoop(); }
      if (k !== "ArrowLeft" && k !== "ArrowRight") return;
      const d = k === "ArrowRight" ? sm : -sm;
      api.change(() => {
        if (kind === "from") setLoop(song, Math.min(l.from + d, l.to - sm), l.to);
        else if (kind === "to") setLoop(song, l.from, Math.max(l.to + d, l.from + sm));
        else moveLoop(song, d);
      });
      e.preventDefault(); render();
      el.querySelector(`[data-loop="${kind}"]`)?.focus();
      return;
    }
    const clip = e.target.closest && e.target.closest(".sl-clip");
    if (!clip) return;
    const i = +clip.dataset.c, song = api.song(), c = song.clips[i];
    if (!c) return;
    const k = e.key;
    if (k === "Delete" || k === "Backspace") { e.preventDefault(); return removeSel(i); }
    if (k === "Enter") { e.preventDefault(); return c.track != null ? api.editSample(c.track) : api.editPattern(c.pattern); }
    const d = k === "ArrowRight" || k === "ArrowDown" ? 1 : -1;
    if (k === "ArrowLeft" || k === "ArrowRight") api.change(() => { if (e.altKey) trimClipStart(song, i, d > 0 ? Math.min(stepBars(), c.length - stepBars()) : -stepBars()); else if (e.shiftKey) resizeClip(song, i, c.length + d * stepBars()); else moveClip(song, i, c.lane, c.start + d * stepBars()); });
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
    head.style.transform = `translateX(${(beat / 4) * barPx()}px)`;
  }
  // ---- zoom: buttons, Ctrl+wheel, pinch. Keeps the bar under the middle (or the pointer) where it was.
  function setZoomS(z, anchorX) {
    const sc = el.querySelector(".sl-scroll"), old = barPx();
    z = clamp(z, ZOOMS[0], ZOOMS[ZOOMS.length - 1]);
    if (z === zoomS) return;
    const r = sc ? sc.getBoundingClientRect() : null, ax = anchorX == null && r ? r.width / 2 : (anchorX ?? 0) - (r ? r.left : 0);
    const bar = sc ? (sc.scrollLeft + ax) / old : 0;
    zoomS = z; render();
    const again = el.querySelector(".sl-scroll");
    if (again) again.scrollLeft = Math.max(0, bar * barPx() - ax);
  }
  function zoomBy(dir) {
    const i = ZOOMS.findIndex((z) => z >= zoomS - 1e-9);
    setZoomS(ZOOMS[clamp((i < 0 ? ZOOMS.length - 1 : i) + dir, 0, ZOOMS.length - 1)]);
  }
  el.addEventListener("wheel", (e) => {
    if (!e.ctrlKey || !e.target.closest(".sl-scroll")) return;
    e.preventDefault();
    setZoomS(zoomS * (e.deltaY < 0 ? 1.2 : 1 / 1.2), e.clientX);
  }, { passive: false });
  const fingers = new Map();
  let pinch = null;
  el.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse" || !e.target.closest(".sl-scroll")) return;
    fingers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (fingers.size === 2) {
      const [a, b] = [...fingers.values()];
      pinch = { d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, z0: zoomS };
      clearTimeout(hold); drag = null; ldrag = null; // two fingers is a zoom, not a clip being dragged
    }
  }, true);
  el.addEventListener("pointermove", (e) => {
    if (!fingers.has(e.pointerId)) return;
    fingers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && fingers.size === 2) {
      const [a, b] = [...fingers.values()];
      setZoomS(pinch.z0 * ((Math.hypot(a.x - b.x, a.y - b.y) || 1) / pinch.d0), (a.x + b.x) / 2);
    }
  });
  const lift = (e) => { fingers.delete(e.pointerId); if (fingers.size < 2) pinch = null; };
  el.addEventListener("pointerup", lift);
  el.addEventListener("pointercancel", lift);

  el.addEventListener("change", (e) => {
    const sel = e.target.closest && e.target.closest("[data-snap]");
    if (!sel) return;
    snapSet.song = sel.value; saveSnap(localStorage, { song: snapSet.song });
    render();
  });
  return { render, playhead, spotAt, people: (list) => { others = list || []; drawPeople(); }, paintWith: (b) => { brush = b; render(); }, zoom: () => zoomS, setZoom: (z) => setZoomS(z), snap: () => ({ setting: snapSet.song, beats: step() }), setSnap: (v) => { snapSet.song = v; saveSnap(localStorage, { song: v }); render(); } };
}
