<!-- The equaliser display.
     A curve you shape directly: press empty space to put a band exactly there (the same
     motion can then drag it), drag a node for frequency and gain, roll the wheel over a
     node for Q, double click or right click a node to take it away. The curve drawn is
     the real response of the filters, read back from the audio engine rather than
     approximated, and the analyser sits behind it, after the equaliser: the useful
     question while shaping is what is coming out, not what went in.

     Nothing here owns the data. Every change is handed up as a function over a copy of
     it (`onedit`), and what comes back down in `data` is what is drawn. -->
<script lang="ts">
  /* Lines and labels are light ink on the dark display, dark ink on the light one. */
  const ink = (a: number) => document.documentElement.getAttribute("data-theme") === "light"
    ? `rgba(30,24,36,${Math.min(1, a * 1.7).toFixed(3)})` : `rgba(255,255,255,${a})`;
  import { onMount, untrack } from "svelte";
  import { engine, type Slot } from "$lib/audio/engine";
  import {
    F_MAX, F_MIN, GRID_F, LABEL_F, bandAt, addBand, bandAtPoint, dragBand, fmtHz, freqToX,
    gainToY, gridSteps, isGainless, curveY, qFromWheel, reachSpan, spectrumPoints, xToFreq,
  } from "$lib/audio/eq";
  import { clamp } from "$lib/util";
  import { showMenu } from "$lib/menu.svelte";
  import { toast } from "$lib/toast.svelte";
  import type { Band, SoundData } from "$lib/types";
  import { colours, makeView, tint, wheel, type View } from "./draw";
  import { MAX_BANDS, bandOfType, type Edit } from "./editor.svelte";
  import { LABEL } from "./labels";

  let { data, slot, live, range, selected = $bindable(null), onedit }: {
    data: SoundData; slot: Slot; live: boolean; range: number;
    selected?: string | number | null; onedit: Edit;
  } = $props();

  let canvas = $state<HTMLCanvasElement>();
  let view: View | null = null;
  let dragging = $state<string | number | null>(null);
  let hover = $state<string | number | null>(null);
  let coarse = false;

  const bands = $derived(data.bands || []);
  const chosen = $derived(bands.find((b) => b.id === selected) || null);
  const radius = () => (coarse ? 24 : 14);

  // ── drawing ────────────────────────────────────────────────────────────────

  let bins: Uint8Array<ArrayBuffer> | null = null;
  let axis: Float32Array<ArrayBuffer> | null = null;
  let axisX: Float32Array | null = null;
  let curve: Float32Array | null = null;
  let curveKey = "";

  /* The response is only recomputed when the bands, the bypass or the width change.
   * Asking the engine builds a filter per band, which at sixty frames a second while a
   * song plays is a great deal of garbage to draw a line that is not moving. */
  function response(w: number): Float32Array {
    const points = Math.max(160, Math.min(560, Math.round(w)));
    if (!axis || axis.length !== points) {
      axis = new Float32Array(points);
      axisX = new Float32Array(points);
      for (let i = 0; i < points; i++) {
        const x = (i / (points - 1)) * w;
        axis[i] = xToFreq(x, w);
        axisX![i] = x;
      }
      curveKey = "";
    }
    const key = `${w}|${data.bypass}|${bands.map((b) => `${b.type},${b.freq},${b.gain},${b.q},${b.on}`).join(";")}`;
    if (key !== curveKey || !curve) {
      curve = engine.responseOf(bands, axis, !!data.bypass);
      curveKey = key;
    }
    return curve;
  }

  function paint(v: View) {
    const { ctx, w, h } = v;
    const c = colours(canvas!);
    const off = !!data.bypass;

    // grid
    ctx.lineWidth = 1;
    ctx.font = "10px Manrope, sans-serif";
    ctx.textAlign = "center";
    for (const f of GRID_F) {
      const x = Math.round(freqToX(f, w)) + 0.5;
      ctx.strokeStyle = ink(0.055);
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
      if (LABEL_F[f]) { ctx.fillStyle = ink(0.32); ctx.fillText(LABEL_F[f], x, h - 5); }
    }
    const step = gridSteps(range);
    ctx.textAlign = "left";
    for (let g = -range + step; g < range; g += step) {
      if (g === 0) continue;
      const y = Math.round(gainToY(g, h, range)) + 0.5;
      ctx.strokeStyle = ink(0.05);
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
      ctx.fillStyle = ink(0.32);
      ctx.fillText(`${g > 0 ? "+" : ""}${g}`, 4, y - 3);
    }
    const zero = Math.round(gainToY(0, h, range)) + 0.5;
    ctx.strokeStyle = ink(0.16);
    ctx.beginPath(); ctx.moveTo(0, zero); ctx.lineTo(w, zero); ctx.stroke();

    // the analyser, behind the curve
    if (live) {
      const meter = engine.analyserOf(slot);
      const audio = engine.context();
      if (meter && audio) {
        if (!bins || bins.length !== meter.frequencyBinCount) bins = new Uint8Array(meter.frequencyBinCount);
        engine.spectrum(bins, slot);
        const points = spectrumPoints(bins, audio.sampleRate, w, h);
        if (points.length) {
          ctx.beginPath();
          ctx.moveTo(0, h);
          for (const [x, y] of points) ctx.lineTo(x, y);
          ctx.lineTo(w, h);
          ctx.closePath();
          ctx.fillStyle = tint(c, 0.1);
          ctx.fill();
        }
      }
    }

    // the real curve
    const db = response(w);
    ctx.beginPath();
    for (let i = 0; i < db.length; i++) {
      const y = curveY(db[i], h, range);
      if (i === 0) ctx.moveTo(axisX![i], y); else ctx.lineTo(axisX![i], y);
    }
    ctx.strokeStyle = off ? ink(0.24) : c.accentHi;
    ctx.lineWidth = 2;
    ctx.lineJoin = "round";
    ctx.stroke();
    // A soft fill to the centre line, so a boost and a cut read differently at a glance.
    ctx.lineTo(w, gainToY(0, h, range));
    ctx.lineTo(0, gainToY(0, h, range));
    ctx.closePath();
    ctx.fillStyle = off ? ink(0.04) : tint(c, 0.11);
    ctx.fill();

    // the nodes
    for (const band of bands) {
      const x = freqToX(band.freq, w);
      const y = gainToY(isGainless(band.type) ? 0 : band.gain, h, range);
      const live_ = band.on && !off;
      const picked = selected === band.id;
      const hot = hover === band.id || dragging === band.id;
      if (picked) {
        const [lo, hi] = reachSpan(band.freq, band.q);
        const left = freqToX(lo, w);
        ctx.fillStyle = tint(c, 0.08);
        ctx.fillRect(left, 0, Math.max(2, freqToX(hi, w) - left), h);
      }
      ctx.beginPath();
      ctx.arc(x, y, picked || hot ? 8 : 6, 0, Math.PI * 2);
      ctx.fillStyle = live_ ? (picked ? c.accentHi : c.accent) : ink(0.28);
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = "rgba(10,10,12,0.9)";
      ctx.stroke();
      if (picked || hot) {
        ctx.fillStyle = ink(0.88);
        ctx.font = "600 10px Manrope, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(fmtHz(band.freq), clamp(x, 16, w - 16), Math.max(12, y - 13));
      }
    }
  }

  onMount(() => {
    coarse = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
    view = makeView(canvas!, paint, () => (live || dragging !== null));
    return () => { view?.destroy(); view = null; };
  });

  // Anything that changes what is drawn asks for one paint; the loop itself only runs
  // while a song is playing or a node is held.
  $effect(() => {
    void JSON.stringify(data); void range; void selected; void hover; void live; void slot; void dragging;
    untrack(() => view?.schedule());
  });

  // ── editing ────────────────────────────────────────────────────────────────

  const at = (e: { clientX: number; clientY: number }) => {
    const rect = canvas!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };
  const size = () => ({ width: view?.w || 1, height: view?.h || 1 });
  const nodeAt = (p: { x: number; y: number }) => bandAt(bands, p.x, p.y, size(), range, radius());

  function down(e: PointerEvent) {
    coarse = e.pointerType !== "mouse";
    if (e.button !== 0) return;       // a right press is the menu's
    canvas!.focus({ preventScroll: true });
    const p = at(e);
    const found = nodeAt(p);
    if (found) {
      selected = found.id;
      dragging = found.id;
    } else {
      if (bands.length >= MAX_BANDS) { toast(`A preset holds up to ${MAX_BANDS} bands.`); return; }
      const made = bandAtPoint(p.x, p.y, size(), range);
      onedit((d) => addBand(d.bands, made), { wake: "eq" });
      selected = made.id;
      dragging = made.id;
    }
    try { canvas!.setPointerCapture(e.pointerId); } catch { /* the drag still works */ }
  }

  function move(e: PointerEvent) {
    coarse = e.pointerType !== "mouse";
    const p = at(e);
    if (dragging !== null) {
      const id = dragging;
      onedit((d) => { const b = d.bands.find((x) => x.id === id); if (b) dragBand(b, p.x, p.y, size(), range); },
        { wake: "eq" });
      return;
    }
    if (e.pointerType === "touch") return;
    const found = nodeAt(p);
    const id = found ? found.id : null;
    if (id !== hover) hover = id;
  }

  function up(e: PointerEvent) {
    if (dragging === null) return;
    dragging = null;
    try { canvas!.releasePointerCapture(e.pointerId); } catch { /* already */ }
  }

  function roll(e: WheelEvent) {
    const band = nodeAt(at(e)) || chosen;
    if (!band) return;
    e.preventDefault();
    const id = band.id;
    onedit((d) => { const b = d.bands.find((x) => x.id === id); if (b) b.q = qFromWheel(b.q, e.deltaY); }, { wake: "eq" });
  }

  function remove(id: string | number) {
    if (selected === id) selected = null;
    onedit((d) => { d.bands = d.bands.filter((b) => b.id !== id); }, { undo: "Band removed" });
  }

  function dbl(e: MouseEvent) {
    const found = nodeAt(at(e));
    if (found) remove(found.id);
  }

  function addAt(p: { x: number; y: number }) {
    if (bands.length >= MAX_BANDS) { toast(`A preset holds up to ${MAX_BANDS} bands.`); return; }
    const made = bandAtPoint(p.x, p.y, size(), range);
    onedit((d) => addBand(d.bands, made), { wake: "eq" });
    selected = made.id;
  }

  /* Right clicking the curve offers things. It used to delete a band outright, with no
   * menu and nothing said: a destructive action on the gesture that everywhere else
   * means "show me the options". */
  function menuFor(band: Band | null, at_: { x: number; y: number }, point: { x: number; y: number }) {
    if (!band) {
      showMenu([
        { label: `Add a bell at ${fmtHz(xToFreq(point.x, view?.w || 1))} Hz`, icon: "plus", run: () => addAt(point) },
        { divider: true },
        { label: `Flatten all ${bands.length} band${bands.length === 1 ? "" : "s"}`, icon: "trash", danger: true,
          disabled: !bands.length,
          run: () => { selected = null; onedit((d) => { d.bands = []; }, { undo: "Bands cleared" }); } },
      ], at_);
      return;
    }
    const id = band.id;
    const patch = (fn: (b: Band) => void, opts = {}) =>
      onedit((d) => { const b = d.bands.find((x) => x.id === id); if (b) fn(b); }, opts);
    selected = id;
    showMenu([
      { group: `${LABEL[band.type] || band.type} at ${fmtHz(band.freq)} Hz` },
      ...(["peaking", "lowshelf", "highshelf", "highpass", "lowpass", "notch", "bandpass"] as const).map((type) => ({
        label: LABEL[type], checked: type === band.type, run: () => patch((b) => { b.type = type; }),
      })),
      { divider: true },
      { label: band.on ? "Switch it off" : "Switch it back on", run: () => patch((b) => { b.on = !b.on; }) },
      { label: "Flatten this one", disabled: isGainless(band.type) || !band.gain, run: () => patch((b) => { b.gain = 0; }) },
      { divider: true },
      { label: "Remove this band", icon: "trash", danger: true, hint: "Delete", run: () => remove(id) },
    ], at_);
  }

  function context(e: MouseEvent) {
    if (e.shiftKey) return;           // Shift + right click is the browser's own menu
    e.preventDefault();
    const p = at(e);
    menuFor(nodeAt(p), { x: e.clientX, y: e.clientY }, p);
  }

  const sorted = () => [...bands].sort((a, b) => a.freq - b.freq);

  function key(e: KeyboardEvent) {
    if ((e.key === "ContextMenu" || (e.key === "F10" && e.shiftKey)) && chosen) {
      e.preventDefault();
      const rect = canvas!.getBoundingClientRect();
      const x = freqToX(chosen.freq, rect.width);
      const y = gainToY(isGainless(chosen.type) ? 0 : chosen.gain, rect.height, range);
      menuFor(chosen, { x: rect.left + x, y: rect.top + y }, { x, y });
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === "Escape") { selected = null; return; }
    const order = sorted();
    if (e.key === "PageUp" || e.key === "PageDown" || e.key === "[" || e.key === "]") {
      if (!order.length) return;
      e.preventDefault();
      const back = e.key === "PageUp" || e.key === "[";
      const i = order.findIndex((b) => b.id === selected);
      selected = order[i < 0 ? 0 : clamp(i + (back ? -1 : 1), 0, order.length - 1)].id;
      return;
    }
    if (e.key === "Enter" && !chosen) {
      e.preventDefault();
      if (bands.length >= MAX_BANDS) { toast(`A preset holds up to ${MAX_BANDS} bands.`); return; }
      const made = bandOfType("peaking");
      onedit((d) => addBand(d.bands, made), { wake: "eq" });
      selected = made.id;
      return;
    }
    const arrows = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"];
    if (!chosen) {
      if (arrows.includes(e.key) && order.length) { e.preventDefault(); selected = order[0].id; }
      return;
    }
    const id = chosen.id;
    const patch = (fn: (b: Band) => void) =>
      onedit((d) => { const b = d.bands.find((x) => x.id === id); if (b) fn(b); }, { wake: "eq" });
    const fine = e.shiftKey ? 4 : 1;
    if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); remove(id); return; }
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      const octaves = ((e.key === "ArrowRight" ? 1 : -1) * fine) / 12;     // a semitone, four with Shift
      patch((b) => { b.freq = Math.round(clamp(b.freq * Math.pow(2, octaves), F_MIN, F_MAX) * 10) / 10; });
    } else if ((e.key === "ArrowUp" || e.key === "ArrowDown") && !isGainless(chosen.type)) {
      e.preventDefault();
      const dir = e.key === "ArrowUp" ? 1 : -1;
      patch((b) => { b.gain = Math.round(clamp(b.gain + dir * 0.5 * fine, -range, range) * 10) / 10; });
    } else if (e.key === "+" || e.key === "=" || e.key === "-") {
      e.preventDefault();
      patch((b) => { b.q = qFromWheel(b.q, e.key === "-" ? 80 : -80); });
    }
  }

  const readout = $derived(chosen
    ? `${LABEL[chosen.type]}, ${fmtHz(chosen.freq)} Hz${isGainless(chosen.type) ? "" : `, ${chosen.gain > 0 ? "+" : ""}${chosen.gain.toFixed(1)} dB`}, Q ${chosen.q.toFixed(2)}`
    : `${bands.length} band${bands.length === 1 ? "" : "s"}`);
</script>

<div class="wrap">
  <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions, a11y_no_static_element_interactions -->
  <canvas bind:this={canvas} class:dragging={dragging !== null} class:hot={hover !== null}
          tabindex="0"
          aria-label="Equaliser. Enter adds a band, arrow keys move the selected one, plus and minus change its width, Delete removes it."
          aria-describedby="eq-readout"
          onpointerdown={down} onpointermove={move} onpointerup={up} onpointercancel={up}
          onlostpointercapture={up} onpointerleave={() => { if (dragging === null) hover = null; }}
          ondblclick={dbl} oncontextmenu={context} onkeydown={key} use:wheel={roll}></canvas>
  <div class="readout num" id="eq-readout" aria-live="polite">{readout}</div>
  <div class="hint">press to place a band · drag it · double click to remove</div>
</div>

<style>
  .wrap {
    position: relative; border-radius: var(--r-lg); overflow: hidden;
    background: var(--well); border: 1px solid var(--line);
    user-select: none; touch-action: none;
  }
  canvas { width: 100%; height: 300px; cursor: crosshair; touch-action: none; }
  canvas.hot { cursor: grab; }
  canvas.dragging { cursor: grabbing; }
  canvas:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; border-radius: var(--r-lg); }
  .readout {
    position: absolute; top: var(--s3); left: var(--s4); right: var(--s4);
    font-size: var(--t-xs); color: var(--text-2); pointer-events: none;
  }
  .hint {
    position: absolute; right: var(--s4); bottom: var(--s3);
    font-size: var(--t-xs); color: var(--text-3); pointer-events: none;
  }
  @media (max-width: 720px) {
    canvas { height: 230px; }
    .hint { display: none; }
  }
  /* Light: the display is pressed into the page, its lines in dark ink (ink()). */
  :global(html[data-theme="light"]) .wrap { background: var(--bg); border-color: transparent; box-shadow: var(--neu-in); }
</style>
