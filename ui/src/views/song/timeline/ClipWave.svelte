<!-- The stretch of the render one section uses, so trimming it shows what you kept rather
     than a picture that never changes. Drawn from the same two sources as the main trace. -->
<script lang="ts">
  import { onMount } from "svelte";
  import { paint, type Source } from "./sample";

  let { source, from, to }: { source: Source; from: number; to: number } = $props();

  let canvas: HTMLCanvasElement;
  let width = $state(0);
  let height = $state(0);
  let waiting = $state(false);

  $effect(() => {
    if (!width || !height) return;
    waiting = paint(canvas, source, [{ x: 0, w: width, from, to }], "rgba(255,255,255,0.46)", 0.86);
  });

  onMount(() => {
    const size = new ResizeObserver(([entry]) => { width = entry.contentRect.width; height = entry.contentRect.height; });
    size.observe(canvas);
    return () => size.disconnect();
  });
</script>

<canvas bind:this={canvas} class:waiting></canvas>

<style>
  canvas { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; opacity: 0.75; transition: opacity 240ms var(--ease); }
  /* The skeleton breathes until the real picture arrives, then the real one simply replaces it. */
  canvas.waiting { animation: wave-wait 1.2s ease-in-out infinite alternate; }
  @keyframes wave-wait { from { opacity: 0.35; } to { opacity: 0.8; } }
  @media (prefers-reduced-motion: reduce) { canvas.waiting { animation: none; } }
</style>
