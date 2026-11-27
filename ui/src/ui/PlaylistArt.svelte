<!-- A playlist's cover: its own tile in front, and up to three of its songs' covers stacked
     out behind it, stacked up and to the right. A playlist looks like the songs in it, at every
     size (the sidebar's 30px, the library's tiles, the playlist page), so it never reads as
     a song. Whatever wraps this keeps a little room above it for the fan. -->
<script lang="ts">
  import Cover from "./Cover.svelte";
  import { hue } from "$lib/util";

  let { title, behind = [], size = 44, radius = "var(--r-lg)", class: extra = "" }: {
    title: string;
    /** The first songs' covers, front to back (url null draws the song's letter tile). */
    behind?: { title: string; url: string | null }[];
    size?: number | string;
    radius?: string;
    class?: string;
  } = $props();

  const box = $derived(typeof size === "number" ? `${size}px` : size);
  // Room above for the fan, in the cover's own scale (a percentage margin would be of the row).
  const room = $derived(typeof size === "number" ? "var(--s1)" : `calc(${size} * 0.12)`);
  const side = $derived(typeof size === "number" ? "var(--s2)" : `calc(${size} * 0.14)`);
  const back = $derived(behind.slice(0, 3));
</script>

<span class="plart {extra}" style:width={box} style:height={box} style:margin-top={room} style:margin-right={side} style:--pl-hue={hue(title)}>
  {#each back as b, i (i)}
    <span class="behind b{i}" aria-hidden="true"><Cover url={b.url} title={b.title} size="100%" {radius} /></span>
  {/each}
  {#if !back.length}
    <!-- Nothing in it yet: two sheets of its own colour, so it still reads as a pile. -->
    <span class="behind b0 sheet" aria-hidden="true"></span><span class="behind b1 sheet" aria-hidden="true"></span>
  {/if}
  <span class="front"><Cover {title} size="100%" {radius} /></span>
</span>

<style>
  .plart { position: relative; display: inline-block; flex: none; isolation: isolate; vertical-align: middle; }
  .front, .behind { position: absolute; inset: 0; display: block; }
  .front { z-index: 3; }
  .front :global(.cover) { box-shadow: 0 3px 10px rgba(0, 0, 0, 0.45); }
  .behind :global(.cover) { box-shadow: 0 2px 6px rgba(0, 0, 0, 0.4); }
  .behind { z-index: 1; transition: transform 360ms var(--spring); transform-origin: 100% 0%; }
  .behind :global(.cover), .front :global(.cover) { width: 100% !important; height: 100% !important; }
  /* Stacked up and to the right, each one a step further back and smaller, like a pile
     of sleeves. Under the pointer they slide out to the right only. */
  .b0 { z-index: 2; transform: translate(8%, -8%) scale(0.92); filter: brightness(0.92); }
  .b1 { transform: translate(15%, -15%) scale(0.84); filter: brightness(0.8); }
  .b2 { z-index: 0; transform: translate(22%, -22%) scale(0.76); filter: brightness(0.68); }
  .sheet { border-radius: var(--r-lg); background: hsl(var(--pl-hue) 40% 34%); }
  .sheet.b1 { background: hsl(var(--pl-hue) 32% 24%); }
  :global(a:hover) .b0, .plart:hover .b0 { transform: translate(16%, -8%) scale(0.92); }
  :global(a:hover) .b1, .plart:hover .b1 { transform: translate(30%, -15%) scale(0.84); }
  :global(a:hover) .b2, .plart:hover .b2 { transform: translate(44%, -22%) scale(0.76); }
  @media (prefers-reduced-motion: reduce) { .behind { transition: none; } }
</style>
