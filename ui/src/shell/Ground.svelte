<!-- What is behind the glass: the song's artwork, enormous and far out of focus, or a wash
     of its hue when there is no picture, and a little darkness at the edges so text over it
     always has something to sit on. Two layers cross fade, so going from one song to another
     never passes through black. Every pane of glass in the app blurs this (and the dust
     drawn over it), which is the whole of the effect: there is no other renderer. -->
<script lang="ts">
  import { onMount } from "svelte";
  import { ground } from "$lib/look.svelte";
  import { glass, glassGL } from "$lib/glass/glass.svelte";

  let canvas = $state<HTMLCanvasElement>();
  onMount(() => {
    if (!canvas) return;
    glassGL.attach(canvas);
    const m = document.documentElement.getAttribute("data-blur");
    glassGL.mode(m === "gl" || m === "off" ? m : "native");
    glassGL.ground(ground.url, ground.hue);
    return () => glassGL.detach();
  });

  /* While somebody is using the page, the wash below is redrawn on every frame.
     Chromium normally redraws only the rectangle that changed (a hovered label, say). When
     that rectangle is near a pane of glass, the pane's blur gets recomputed inside the
     rectangle only, and that patch visibly jumps: the flicker this app had for months, and
     only sometimes, because on frames where the dust moved the whole screen was redrawn
     anyway. A full screen layer changing every frame makes every frame a full redraw, so
     the blur is always computed whole. It stops a moment after the last input, so an idle
     page costs nothing. */
  let live = $state(false);
  onMount(() => {
    let timer = 0;
    const poke = () => {
      if (!live) live = true;
      clearTimeout(timer);
      timer = window.setTimeout(() => (live = false), 1800);
    };
    const opts = { capture: true, passive: true } as const;
    const kinds = ["pointermove", "pointerdown", "wheel", "keydown", "scroll", "transitionrun", "animationstart"];
    kinds.forEach((k) => window.addEventListener(k, poke, opts));
    return () => { clearTimeout(timer); kinds.forEach((k) => window.removeEventListener(k, poke, opts)); };
  });

  // Two slots, alternating. The incoming picture goes in the idle slot and is faded up only
  // once it has decoded, which is what stops a flash of nothing on a slow link.
  let slots = $state<[string | null, string | null]>([null, null]);
  let front = $state(0);
  let visible = $state(false);
  let token = 0;

  $effect(() => {
    const url = ground.url;
    const mine = ++token;
    if (!url) { visible = false; return; }
    if (slots[front] === url) { visible = true; return; }
    const img = new Image();
    img.onload = img.onerror = () => {
      if (mine !== token) return;
      const back = front === 0 ? 1 : 0;
      slots[back] = url;
      front = back;
      visible = true;
    };
    img.src = url;
  });
</script>

<div class="ground" aria-hidden="true">
  <!-- The shader draws everything below when it runs (lib/glass); the layers after it are
       the same picture in CSS for when it does not. -->
  <canvas bind:this={canvas} class="gl" class:on={glass.active}></canvas>
  <div class="hue" class:on={!ground.url && ground.hue !== null} style:--hue={ground.hue ?? 0}></div>
  {#each slots as url, i}
    <div class="art" class:on={visible && front === i} style:background-image={url ? `url("${url.replace(/"/g, "%22")}")` : "none"}></div>
  {/each}
  <div class="veil"></div>
  <div class="wash" class:live></div>
</div>

<style>
  .ground { position: fixed; inset: 0; z-index: 0; overflow: hidden; background: var(--bg); pointer-events: none; }
  .gl { position: absolute; inset: 0; width: 100%; height: 100%; display: block; z-index: 1; visibility: hidden; }
  .gl.on { visibility: visible; }
  /* Under the shader the CSS picture is not drawn at all, not merely covered. */
  :global(html[data-glass="gl"]) .art, :global(html[data-glass="gl"]) .hue, :global(html[data-glass="gl"]) .veil { display: none; }
  .art, .hue {
    position: absolute; inset: -12%;
    opacity: 0; transition: opacity 700ms var(--ease);
  }
  /* The picture is blurred at a quarter of its size and then scaled up four times, which is
     the same 70px blur on screen for a sixteenth of the pixels. A blur that size on a full
     screen layer is a big filtered surface the compositor has to keep in tiles, and tile
     seams in it are exactly what a pane over it can pick up. Scaling a small, already
     smooth picture up has no seams to show. */
  .art {
    inset: auto; left: 50%; top: 50%;
    width: 31.25vw; height: 31.25vh;
    background-size: cover; background-position: center;
    filter: blur(17px) saturate(150%) brightness(0.5);
    transform: translate(-50%, -50%) scale(4);
  }
  .art.on { opacity: 1; }
  /* The same reach as the shader's picture (lib/glass/gl.ts): the top of the screen, away
     from the sidebar. On the layer that holds both slots, so it does not scale with them. */
  .art, .hue {
    -webkit-mask-image: linear-gradient(to bottom, #000, rgb(0 0 0 / 0.55) 30%, transparent 62%),
                        linear-gradient(to right, transparent 4%, #000 42%);
    -webkit-mask-composite: source-in;
    mask-image: linear-gradient(to bottom, #000, rgb(0 0 0 / 0.55) 30%, transparent 62%),
                linear-gradient(to right, transparent 4%, #000 42%);
    mask-composite: intersect;
  }
  .hue {
    background:
      radial-gradient(70% 60% at 22% 18%, hsl(var(--hue) 85% 42% / 0.55), transparent 70%),
      radial-gradient(60% 55% at 82% 78%, hsl(calc(var(--hue) + 50) 80% 36% / 0.42), transparent 70%);
  }
  .hue.on { opacity: 1; }
  .veil {
    position: absolute; inset: 0;
    background:
      radial-gradient(120% 90% at 50% 0%, transparent 40%, rgba(0, 0, 0, 0.5) 100%),
      /* Eased, not linear: a gradient that starts and ends at a straight line shows a kink
         at each end once anything brightens it, and a kink reads as an edge. */
      linear-gradient(to bottom, transparent 50%, rgba(0, 0, 0, 0.04) 58%, rgba(0, 0, 0, 0.14) 68%,
                      rgba(0, 0, 0, 0.30) 80%, rgba(0, 0, 0, 0.45) 90%, rgba(0, 0, 0, 0.55) 100%);
  }
  /* The one soft light on the black: the accent, very faint, high on the left, and a fainter
     echo low on the right. Above the shader's canvas so it is the same in every glass mode. */
  .wash {
    position: absolute; inset: 0; z-index: 2;
    background:
      radial-gradient(62% 48% at 24% 8%, color-mix(in srgb, var(--accent) 9%, transparent), transparent 72%),
      radial-gradient(55% 45% at 88% 100%, color-mix(in srgb, var(--accent) 5%, transparent), transparent 70%);
    will-change: opacity;
  }
  /* Too small a change to see; enough that the compositor redraws the screen each frame. */
  .wash.live { animation: redraw 1.6s linear infinite alternate; }
  @keyframes redraw { from { opacity: 1; } to { opacity: 0.94; } }
  @media (prefers-reduced-transparency: reduce) { .art { display: none; } }
  /* Light: no shader (it draws on black), the CSS picture instead, bright and soft, and a
     veil that fades to the page rather than to night. */
  :global(html[data-theme="light"]) .gl { display: none; }
  :global(html[data-theme="light"][data-glass="gl"]) .art, :global(html[data-theme="light"][data-glass="gl"]) .hue,
  :global(html[data-theme="light"][data-glass="gl"]) .veil { display: block; }
  :global(html[data-theme="light"]) .art { filter: blur(17px) saturate(130%) brightness(1.15); }
  :global(html[data-theme="light"]) .art.on { opacity: 0.55; }
  :global(html[data-theme="light"]) .hue { opacity: 0; }
  :global(html[data-theme="light"]) .hue.on { opacity: 0.35; }
  :global(html[data-theme="light"]) .veil {
    background: linear-gradient(to bottom, transparent 40%, color-mix(in srgb, var(--bg) 60%, transparent) 70%, var(--bg) 100%);
  }
</style>
