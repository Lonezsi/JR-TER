<!-- A take's shape, drawn from the decoded recording. The same decode the player uses (it
     is cached by id and digest), so this costs nothing extra once the take has played. -->
<script lang="ts" module>
  const BARS = 160;
  const shapes = new Map<string, Float32Array>();

  /** Peak per slice, 0..1 of the loudest slice. */
  function shapeOf(buffer: AudioBuffer): Float32Array {
    const out = new Float32Array(BARS);
    const per = Math.max(1, Math.floor(buffer.length / BARS));
    for (let c = 0; c < buffer.numberOfChannels; c++) {
      const data = buffer.getChannelData(c);
      for (let b = 0; b < BARS; b++) {
        let peak = 0;
        const end = Math.min(data.length, (b + 1) * per);
        for (let i = b * per; i < end; i += 8) { const v = Math.abs(data[i]); if (v > peak) peak = v; }
        if (peak > out[b]) out[b] = peak;
      }
    }
    const top = Math.max(...out, 0.0001);
    return out.map((v) => v / top);
  }
</script>

<script lang="ts">
  import { vocals, type VocalTake } from "$lib/audio/vocals.svelte";

  let { take, on = true }: { take: VocalTake; on?: boolean } = $props();

  let canvas: HTMLCanvasElement | undefined = $state();
  let size = $state({ w: 0, h: 0 });
  let shape = $state<Float32Array | null>(null);

  $effect(() => {
    const key = `${take.id}:${take.digest || ""}`;
    const known = shapes.get(key);
    if (known) { shape = known; return; }
    shape = null;
    let gone = false;
    vocals.decode(take).then((buffer) => {
      if (gone || !buffer) return;
      const made = shapeOf(buffer);
      shapes.set(key, made);
      shape = made;
    });
    return () => { gone = true; };
  });

  $effect(() => {
    if (!canvas) return;
    const watch = new ResizeObserver(([entry]) => {
      size = { w: Math.round(entry.contentRect.width), h: Math.round(entry.contentRect.height) };
    });
    watch.observe(canvas);
    return () => watch.disconnect();
  });

  $effect(() => {
    void on;                                   // colour follows the switch: redraw when it flips
    const el = canvas;
    if (!el || !size.w || !size.h) return;
    const dpr = window.devicePixelRatio || 1;
    el.width = Math.round(size.w * dpr);
    el.height = Math.round(size.h * dpr);
    const g = el.getContext("2d");
    if (!g) return;
    g.scale(dpr, dpr);
    g.fillStyle = getComputedStyle(el).color;
    const mid = size.h / 2;
    if (!shape) { g.fillRect(0, mid - 0.5, size.w, 1); return; }
    const slot = size.w / BARS;
    const bar = Math.max(1, slot - 1);
    for (let b = 0; b < BARS; b++) {
      const h = Math.max(1.5, shape[b] * size.h * 0.92);
      g.fillRect(b * slot, mid - h / 2, bar, h);
    }
  });
</script>

<canvas bind:this={canvas} class:on aria-hidden="true"></canvas>

<style>
  canvas { width: 100%; height: 100%; color: var(--text-3); opacity: 0.7; transition: opacity var(--fast); }
  canvas.on { color: var(--accent-text); opacity: 0.95; }
</style>
