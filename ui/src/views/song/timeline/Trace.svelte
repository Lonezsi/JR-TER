<!-- The render's waveform across the full width, with the playhead on it.
     Click or drag to seek; hover for the time. The picture is the render as recorded, or,
     when the song plays as arranged, the arrangement: the same slices of the render, laid
     in the order they are heard. Alt+drag (or the loop picker, on a touch screen) marks a
     stretch to go round. -->
<script lang="ts">
  import { onMount } from "svelte";
  import { player, now, seekTo } from "$lib/player.svelte";
  import { clamp, time } from "$lib/util";
  import { useSong } from "../song.svelte";
  import { paint, type Source, type Run } from "./sample";
  import { seekAt } from "./edits.svelte";

  interface Slice { at: number; seconds: number; from: number; to: number }

  let { duration, slices, source, bounds = [], loop = null, picking = false, onpick, label = "Position in the song" }: {
    /** Length of the axis being shown, seconds. */
    duration: number;
    slices: Slice[];
    source: Source;
    /** Section starts, seconds on the axis, drawn as faint lines. */
    bounds?: number[];
    loop?: { from: number; to: number } | null;
    picking?: boolean;
    onpick?: (from: number, to: number) => void;
    label?: string;
  } = $props();

  const song = useSong();

  let el: HTMLDivElement;
  let base: HTMLCanvasElement;
  let lit: HTMLCanvasElement;
  let head: HTMLDivElement;
  let restInk: HTMLSpanElement;
  let hotInk: HTMLSpanElement;

  let width = $state(0);
  let height = $state(0);
  let visible = $state(true);
  let tint = $state(0);                 // bumps when the accent changes, so the picture is redrawn in it
  let hover = $state<number | null>(null);
  let scrub = $state<number | null>(null);
  let range = $state<{ from: number; to: number } | null>(null);

  const seconds = (clientX: number) => {
    const box = el.getBoundingClientRect();
    return clamp((clientX - box.left) / Math.max(1, box.width), 0, 1) * duration;
  };

  /* Where the playhead is. Read off the audio rather than off `player.position`, which the
   * paint loop keeps and which stops when a tab is not being drawn. */
  const where = () => (scrub ?? (song.here ? now() : 0));

  function place() {
    if (!head || !duration || !width) return;
    const p = clamp(where() / duration, 0, 1);
    head.style.transform = `translate3d(${p * width}px,0,0)`;
    lit.style.clipPath = `inset(0 ${(1 - p) * 100}% 0 0)`;
  }

  // At rest the position changes only when something seeks; playing, a frame loop takes over.
  $effect(() => { void player.position; void song.here; void duration; void width; void scrub; place(); });

  let wrapped = 0;
  $effect(() => {
    if (!visible || !song.playing) return;
    let id = 0;
    const frame = () => {
      id = requestAnimationFrame(frame);
      place();
      // A loop is enforced from here and not from an ended event: the music does not end.
      if (loop && song.here && player.playing) {
        const at = now();
        const t = performance.now();
        if (at >= loop.to - 0.015 && t - wrapped > 250) { wrapped = t; seekTo(loop.from); }
      }
    };
    id = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(id);
  });

  // The picture. Redrawn when its numbers, its size or the accent change, and never per frame.
  $effect(() => {
    void tint;
    if (!width || !height || !duration) return;
    const runs: Run[] = slices.map((s) => ({
      x: (s.at / duration) * width, w: (s.seconds / duration) * width, from: s.from, to: s.to,
    }));
    waiting = paint(base, source, runs, getComputedStyle(restInk).color);
    paint(lit, source, runs, getComputedStyle(hotInk).color);
    place();
  });

  onMount(() => {
    const size = new ResizeObserver(([entry]) => {
      width = entry.contentRect.width;
      height = entry.contentRect.height;
    });
    size.observe(el);
    const seen = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; });
    seen.observe(el);
    // The accent follows the music, and is written on the root as the song changes.
    const accent = new MutationObserver(() => { tint++; });
    accent.observe(document.documentElement, { attributes: true, attributeFilter: ["style", "class"] });
    return () => { size.disconnect(); seen.disconnect(); accent.disconnect(); };
  });

  // ── pointer ────────────────────────────────────────────────────────────────

  let drag = $state<{ mode: "seek" | "loop"; from: number; sent: number } | null>(null);

  function down(e: PointerEvent) {
    if (e.button !== 0 || !duration) return;
    el.setPointerCapture(e.pointerId);
    const from = seconds(e.clientX);
    drag = { mode: picking || e.altKey ? "loop" : "seek", from, sent: 0 };
    if (drag.mode === "seek") {
      scrub = from;
      if (song.here) player.seeking = true;
    } else {
      range = { from, to: from };
    }
  }

  function move(e: PointerEvent) {
    if (e.pointerType === "mouse") hover = e.clientX - el.getBoundingClientRect().left;
    if (!drag) return;
    const at = seconds(e.clientX);
    if (drag.mode === "loop") {
      range = { from: Math.min(drag.from, at), to: Math.max(drag.from, at) };
      return;
    }
    scrub = at;
    const t = performance.now();
    // While holding, the music follows the hand a few times a second, not on every pixel.
    if (song.here && player.duration && t - drag.sent > 90) { drag.sent = t; seekTo(at); }
  }

  function up(e: PointerEvent) {
    if (!drag) return;
    const mode = drag.mode;
    drag = null;
    player.seeking = false;
    if (mode === "loop") {
      const picked = range;
      range = null;
      if (picked && picked.to - picked.from > 0.25) onpick?.(picked.from, picked.to);
      return;
    }
    const at = scrub ?? seconds(e.clientX);
    scrub = null;
    void seekAt(song, at);
  }

  function cancel() {
    drag = null; scrub = null; range = null;
    player.seeking = false;
  }

  function keys(e: KeyboardEvent) {
    if (e.altKey || e.ctrlKey || e.metaKey || !duration) return;
    const step = e.shiftKey ? 15 : 5;
    let to: number | null = null;
    if (e.key === "ArrowLeft" || e.key === "ArrowDown") to = where() - step;
    else if (e.key === "ArrowRight" || e.key === "ArrowUp") to = where() + step;
    else if (e.key === "PageDown") to = where() - 30;
    else if (e.key === "PageUp") to = where() + 30;
    else if (e.key === "Home") to = 0;
    else if (e.key === "End") to = duration - 0.5;
    if (to === null) return;
    e.preventDefault();
    void seekAt(song, clamp(to, 0, duration));
  }

  const shown = $derived(range ?? loop);
  // True while the picture is still the skeleton (sample.ts paint).
  let waiting = $state(false);
</script>

<div class="trace" class:picking bind:this={el} role="slider" tabindex="0"
     aria-label={label} aria-valuemin={0} aria-valuemax={Math.round(duration)}
     aria-valuenow={Math.round(scrub ?? (song.here ? player.position : 0))}
     aria-valuetext={time(scrub ?? (song.here ? player.position : 0)) + " of " + time(duration)}
     onpointerdown={down} onpointermove={move} onpointerup={up} onpointercancel={cancel}
     onpointerleave={() => (hover = null)} onkeydown={keys}>
  <span class="ink rest" bind:this={restInk}></span>
  <span class="ink hot" bind:this={hotInk}></span>
  <canvas bind:this={base} class="base" class:waiting></canvas>
  <canvas bind:this={lit} class="lit" class:waiting></canvas>

  {#each bounds as at}
    <i class="bound" style:left="{(at / duration) * 100}%"></i>
  {/each}
  {#if shown && duration}
    <div class="loop" class:pick={!!range} style:left="{(shown.from / duration) * 100}%"
         style:width="{((shown.to - shown.from) / duration) * 100}%"></div>
  {/if}

  <div class="head" bind:this={head}></div>
  {#if hover !== null && !drag && duration}
    <i class="hair" style:left="{hover}px"></i>
    <span class="tip num" style:left="{clamp(hover, 24, Math.max(24, width - 24))}px">{time(clamp(hover / Math.max(1, width), 0, 1) * duration)}</span>
  {/if}
</div>

<style>
  .trace {
    position: relative; height: 84px; border-radius: var(--r-md); overflow: hidden;
    background: rgba(0, 0, 0, 0.26); border: 1px solid var(--line);
    box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.4);
    cursor: pointer; user-select: none; touch-action: pan-y;
    transition: border-color var(--fast), box-shadow var(--fast);
  }
  .trace.picking { cursor: crosshair; border-color: var(--accent-line); }
  .trace:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: var(--r-md); }
  .ink { position: absolute; width: 0; height: 0; overflow: hidden; pointer-events: none; }
  .ink.rest { color: color-mix(in srgb, var(--text) 34%, transparent); }
  .ink.hot { color: var(--accent-text); }
  canvas { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
  canvas.waiting { animation: wave-wait 1.2s ease-in-out infinite alternate; }
  @keyframes wave-wait { from { opacity: 0.4; } to { opacity: 0.9; } }
  @media (prefers-reduced-motion: reduce) { canvas.waiting { animation: none; } }
  .bound { position: absolute; top: 0; bottom: 0; width: 1px; background: var(--line-2); pointer-events: none; }
  .loop {
    position: absolute; top: 0; bottom: 0; pointer-events: none;
    background: var(--accent-soft); border-inline: 2px solid var(--accent-line);
  }
  .loop.pick { background: color-mix(in srgb, var(--accent) 26%, transparent); }
  .head {
    position: absolute; top: 0; bottom: 0; left: 0; width: 2px; margin-left: -1px;
    background: var(--accent-hi); box-shadow: 0 0 8px var(--accent); pointer-events: none; will-change: transform;
  }
  .hair { position: absolute; top: 0; bottom: 0; width: 1px; background: var(--text-3); pointer-events: none; }
  .tip {
    position: absolute; top: 4px; transform: translateX(-50%); pointer-events: none;
    padding: 2px 7px; border-radius: var(--r-pill); font-size: var(--t-xs); font-weight: 600;
    background: var(--glass-2); border: 1px solid var(--glass-line); color: var(--text);
  }
  @media (max-width: 640px) { .trace { height: 72px; } }
</style>
