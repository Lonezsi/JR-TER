<!-- The limiter display, in the shape a mastering limiter usually shows it: how hard it is
     working over time (top, scrolling) and where the two lines that decide that sit
     (bottom, drawn on the output level). Both lines are draggable. Threshold is where it
     starts holding the signal down and ceiling is where the output may reach; attack and
     release are the only numbers left over, and they are sliders beside this. -->
<script lang="ts">
  /* Lines and labels are light ink on the dark display, dark ink on the light one. */
  const ink = (a: number) => document.documentElement.getAttribute("data-theme") === "light"
    ? `rgba(30,24,36,${Math.min(1, a * 1.7).toFixed(3)})` : `rgba(255,255,255,${a})`;
  import { onMount, untrack } from "svelte";
  import { engine, type Slot } from "$lib/audio/engine";
  import {
    ReductionHistory, REDUCTION_MAX_DB, dbToX, limiterLineAt, limiterValues, setLimiterLine, xToDb,
  } from "$lib/audio/eq";
  import { clamp } from "$lib/util";
  import type { LimiterSettings } from "$lib/types";
  import { colours, makeView, type View } from "./draw";
  import type { Edit } from "./editor.svelte";

  let { limiter, slot, live, onedit }: {
    limiter: LimiterSettings; slot: Slot; live: boolean; onedit: Edit;
  } = $props();

  let canvas = $state<HTMLCanvasElement>();
  let view: View | null = null;
  let dragging = $state<"threshold" | "ceiling" | null>(null);
  let hover = $state<"threshold" | "ceiling" | null>(null);
  let coarse = false;
  const history = new ReductionHistory();

  function paint(v: View) {
    const { ctx, w, h } = v;
    const c = colours(canvas!);
    const lim = limiterValues(limiter);
    const split = Math.round(h * 0.56);

    // gain reduction over the last few seconds
    if (live) history.push(engine.reductionOf(slot));
    ctx.lineWidth = 1;
    ctx.strokeStyle = ink(0.05);
    for (let db = 3; db < REDUCTION_MAX_DB; db += 3) {
      const y = Math.round((db / REDUCTION_MAX_DB) * split) + 0.5;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    }
    const n = history.length;
    const trace = () => {
      for (let i = 0; i < n; i++) {
        const y = (clamp(history.at(i), 0, REDUCTION_MAX_DB) / REDUCTION_MAX_DB) * split;
        const x = (i / (n - 1)) * w;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
    };
    ctx.beginPath(); ctx.moveTo(0, 0); trace(); ctx.lineTo(w, 0); ctx.closePath();
    ctx.fillStyle = "rgba(255,200,97,0.22)";
    ctx.fill();
    ctx.beginPath(); trace();
    ctx.strokeStyle = c.warn;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = ink(0.34);
    ctx.font = "10px Manrope, sans-serif";
    ctx.textAlign = "left";
    ctx.fillText("gain reduction", 6, 13);
    ctx.strokeStyle = ink(0.1);
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, split + 0.5); ctx.lineTo(w, split + 0.5); ctx.stroke();

    // the output level and the two lines
    const barTop = split + 26;
    const barHeight = Math.max(14, h - barTop - 22);
    ctx.textAlign = "center";
    for (const db of [-30, -24, -18, -12, -6, 0]) {
      const x = dbToX(db, w);
      ctx.strokeStyle = ink(0.06);
      ctx.beginPath();
      ctx.moveTo(Math.round(x) + 0.5, barTop - 4);
      ctx.lineTo(Math.round(x) + 0.5, barTop + barHeight + 4);
      ctx.stroke();
      ctx.fillStyle = ink(0.32);
      ctx.fillText(String(db), clamp(x, 10, w - 10), h - 6);
    }
    ctx.fillStyle = ink(0.06);
    ctx.fillRect(0, barTop, w, barHeight);

    const level = live ? engine.peakDb(slot) : -60;
    const gradient = ctx.createLinearGradient(0, 0, w, 0);
    gradient.addColorStop(0, `rgba(${c.accentRgb}, 0.55)`);
    gradient.addColorStop(0.75, c.accent);
    gradient.addColorStop(1, c.warn);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, barTop, dbToX(level, w), barHeight);

    // Anything above the ceiling is territory the output is not allowed into.
    const ceilingX = dbToX(lim.ceiling, w);
    ctx.fillStyle = "rgba(255,107,107,0.14)";
    ctx.fillRect(ceilingX, barTop, w - ceilingX, barHeight);

    line(ctx, w, dbToX(lim.threshold, w), barTop, barHeight, c.warn, "threshold", hover === "threshold" || dragging === "threshold");
    line(ctx, w, ceilingX, barTop, barHeight, c.bad, "ceiling", hover === "ceiling" || dragging === "ceiling");
  }

  function line(ctx: CanvasRenderingContext2D, w: number, x: number, top: number, tall: number,
                colour: string, label: string, hot: boolean) {
    ctx.strokeStyle = colour;
    ctx.lineWidth = hot ? 3 : 2;
    ctx.beginPath();
    ctx.moveTo(Math.round(x) + 0.5, top - 6);
    ctx.lineTo(Math.round(x) + 0.5, top + tall + 6);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x, top - 8, hot ? 6 : 4.5, 0, Math.PI * 2);
    ctx.fillStyle = colour;
    ctx.fill();
    if (hot) {
      ctx.font = "600 10px Manrope, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(label, clamp(x, 28, w - 28), top - 16);
    }
  }

  onMount(() => {
    coarse = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
    view = makeView(canvas!, paint, () => live || dragging !== null);
    return () => { view?.destroy(); view = null; };
  });
  $effect(() => {
    void limiter.threshold; void limiter.ceiling; void limiter.on; void live; void slot; void hover; void dragging;
    untrack(() => view?.schedule());
  });

  const xOf = (e: PointerEvent) => e.clientX - canvas!.getBoundingClientRect().left;
  const near = (e: PointerEvent) => limiterLineAt(limiter, xOf(e), view?.w || 1, coarse ? 26 : 16);

  /* Only a press that landed on one of the two lines is a drag. */
  function down(e: PointerEvent) {
    coarse = e.pointerType !== "mouse";
    if (e.button !== 0) return;
    const which = near(e);
    if (!which) return;
    dragging = which;
    try { canvas!.setPointerCapture(e.pointerId); } catch { /* the drag still works */ }
  }
  function move(e: PointerEvent) {
    if (dragging) {
      const which = dragging;
      const db = xToDb(xOf(e), view?.w || 1);
      onedit((d) => setLimiterLine(d.limiter, which, db), { wake: "limiter" });
      return;
    }
    if (e.pointerType === "touch") return;
    const found = near(e);
    if (found !== hover) hover = found;
  }
  function up(e: PointerEvent) {
    if (!dragging) return;
    dragging = null;
    try { canvas!.releasePointerCapture(e.pointerId); } catch { /* already */ }
  }
</script>

<div class="wrap">
  <!-- The sliders beside this do everything the two lines do, from the keyboard. -->
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions, a11y_no_static_element_interactions -->
  <canvas bind:this={canvas} class:hot={hover !== null} class:dragging={dragging !== null}
          aria-label="Limiter: gain reduction over time, and the output level with the threshold and ceiling lines"
          onpointerdown={down} onpointermove={move} onpointerup={up} onpointercancel={up}
          onlostpointercapture={up} onpointerleave={() => { if (!dragging) hover = null; }}></canvas>
  <div class="hint">drag the two lines</div>
</div>

<style>
  .wrap {
    position: relative; border-radius: var(--r-lg); overflow: hidden;
    background: rgba(0, 0, 0, 0.38); border: 1px solid var(--line);
    user-select: none; touch-action: none;
  }
  canvas { width: 100%; height: 190px; touch-action: none; }
  canvas.hot, canvas.dragging { cursor: ew-resize; }
  .hint {
    position: absolute; right: var(--s4); bottom: var(--s3);
    font-size: var(--t-xs); color: var(--text-3); pointer-events: none;
  }
  @media (max-width: 720px) { canvas { height: 160px; } .hint { display: none; } }
  /* Light: the display is pressed into the page, its lines in dark ink (ink()). */
  :global(html[data-theme="light"]) .wrap { background: var(--bg); border-color: transparent; box-shadow: var(--neu-in); }
</style>
