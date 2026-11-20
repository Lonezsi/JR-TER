<!-- An album: a CD in its jewel case, the same at every size (the sidebar's 30px, rows,
     tiles, the album page). One piece, so an album always looks like itself.

     The lid is the cover, with the case's spine and sheen and the album's stickers on it.
     Under it is the tray with the disc, which peeks out on the right. Hover (the tile, its
     link, or the case) and the lid swings open on its hinge in 3D, showing the rainbow CD
     inside, which slides out a little further. Reduced motion: it stays shut. -->
<script lang="ts">
  import Cover from "./Cover.svelte";
  import Sticker from "./Sticker.svelte";
  import { stickersOf } from "$lib/stickers";

  let { album = null, url = null, title, size = 44, small = false, bare = false, class: extra = "" }: {
    album?: { id?: number | string; year?: number | null; stickers?: unknown } | null;
    url?: string | null;
    title: string;
    size?: number | string;
    /** Rows and the sidebar: the case and disc, no stickers (too small to read). */
    small?: boolean;
    /** No stickers: the sticker editor draws its own, live, on top. */
    bare?: boolean;
    class?: string;
  } = $props();

  const box = $derived(typeof size === "number" ? `${size}px` : size);
  // Room on the right for the peeking disc, in the case's own scale.
  const room = $derived(typeof size === "number" ? `${Math.round(size * 0.16)}px` : `calc(${size} * 0.16)`);
  const stickers = $derived(small || bare ? [] : stickersOf(album));
</script>

<span class="albumart {extra}" class:small style:width={box} style:height={box} style:margin-right={room}>
  <span class="tray" aria-hidden="true"><span class="disc"><span class="cd"></span></span></span>
  <span class="lid">
    <span class="face"><Cover {url} {title} size="100%" radius="var(--case-r)" /></span>
    <span class="sheen" aria-hidden="true"></span>
    {#each stickers as s, i (i)}<Sticker {s} />{/each}
  </span>
</span>

<style>
  .albumart { --peek: 15%; position: relative; display: inline-block; flex: none; vertical-align: middle; perspective: 900px; isolation: isolate; }

  /* The tray: dark plastic, and the disc in it, peeking out on the right. */
  .tray { position: absolute; inset: 0; border-radius: var(--case-r); background: linear-gradient(135deg, #1b1b20, #0c0c0f); }
  /* The disc, drawn the way a real one is laid out (radii as a share of the disc's own):
     the hole (12.5%), the clear plastic hub with its stacking ring (to 27.5%), the plain
     mirror band (to 38%), then the data area: brushed silver with the two opposite rainbow
     fans you see when light hits a CD, fine grooves, and a thin clear rim. Opening the case
     tilts the light (--cd-a), so the rainbow drifts instead of the disc spinning. */
  .disc {
    position: absolute; top: 4%; bottom: 4%; left: 6%; aspect-ratio: 1; border-radius: 50%;
    transform: translateX(var(--peek)); --cd-a: 0deg;
    transition: transform 520ms var(--spring), --cd-a 900ms ease;
    filter: drop-shadow(0 3px 6px rgb(0 0 0 / 0.45));
  }
  .cd {
    position: absolute; inset: 0; border-radius: 50%;
    -webkit-mask: radial-gradient(circle closest-side, transparent 0 12.5%, #000 13%);
    mask: radial-gradient(circle closest-side, transparent 0 12.5%, #000 13%);
    background:
      radial-gradient(circle closest-side, transparent 0 13%, rgb(255 255 255 / 0.4) 13.5% 14.5%, rgb(210 218 228 / 0.22) 15% 21%,
        rgb(255 255 255 / 0.45) 21.5% 22.5%, rgb(210 218 228 / 0.22) 23% 27%, transparent 27.5% 97%, rgb(230 236 245 / 0.5) 97.5% 100%);
  }
  .cd::before {
    content: ""; position: absolute; inset: 0; border-radius: 50%;
    -webkit-mask: radial-gradient(circle closest-side, transparent 0 27.5%, #000 28% 97%, transparent 97.5%);
    mask: radial-gradient(circle closest-side, transparent 0 27.5%, #000 28% 97%, transparent 97.5%);
    background:
      linear-gradient(135deg, rgb(255 255 255 / 0.35), transparent 38% 62%, rgb(255 255 255 / 0.12)),
      radial-gradient(circle closest-side, #d3d8df 0 37.5%, rgb(0 0 0 / 0.22) 38%, transparent 39%),
      repeating-radial-gradient(circle, rgb(255 255 255 / 0.06) 0 1px, transparent 1px 2px),
      conic-gradient(from var(--cd-a),
        transparent 0 16deg, rgb(255 70 160 / 0.7) 26deg, rgb(255 160 60 / 0.7) 35deg, rgb(250 238 90 / 0.65) 43deg,
        rgb(90 232 150 / 0.65) 51deg, rgb(70 180 255 / 0.75) 59deg, rgb(140 100 255 / 0.7) 67deg, transparent 80deg 196deg,
        rgb(255 70 160 / 0.7) 206deg, rgb(255 160 60 / 0.7) 215deg, rgb(250 238 90 / 0.65) 223deg,
        rgb(90 232 150 / 0.65) 231deg, rgb(70 180 255 / 0.75) 239deg, rgb(140 100 255 / 0.7) 247deg, transparent 260deg 360deg),
      conic-gradient(from calc(var(--cd-a) * 0.5 + 10deg), #e9ecf0, #aeb3bb 50deg, #f4f5f7 95deg, #9da2aa 150deg,
        #e3e6ea 185deg, #a9aeb6 235deg, #f1f2f5 280deg, #a3a8b0 330deg, #e9ecf0);
  }

  /* The lid: the cover, swinging on the left edge. */
  .lid { position: absolute; inset: 0; z-index: 1; transform-origin: 0% 50%; transform-style: preserve-3d;
         transition: transform 560ms var(--spring); container-type: inline-size; border-radius: var(--case-r); }
  .face { position: absolute; inset: 0; display: block; border-radius: var(--case-r); box-shadow: 0 2px 10px rgba(0, 0, 0, 0.4); }
  .face :global(.cover) { width: 100% !important; height: 100% !important; }
  .sheen {
    position: absolute; inset: 0; border-radius: var(--case-r); pointer-events: none;
    background:
      linear-gradient(115deg, rgb(255 255 255 / 0.2) 0%, rgb(255 255 255 / 0.05) 28%, transparent 42%, transparent 70%, rgb(255 255 255 / 0.07) 100%),
      repeating-linear-gradient(to bottom, rgb(255 255 255 / 0.10) 0 1px, transparent 1px 4px) left / 7% 100% no-repeat,
      linear-gradient(to right, rgb(0 0 0 / 0.55), rgb(0 0 0 / 0.25) 85%, rgb(255 255 255 / 0.2) 86%, transparent 92%) left / 8% 100% no-repeat;
    box-shadow: inset 0 0 0 1px rgb(255 255 255 / 0.12);
  }

  /* Open: the lid swings back on its hinge, the disc slides out further. */
  :global(a:hover) > .albumart .lid, :global(a:hover) .albumart:not(.small) .lid, .albumart:hover .lid,
  :global(.case-open) .albumart .lid { transform: rotateY(-32deg); }
  :global(a:hover) .albumart .disc, .albumart:hover .disc, :global(.case-open) .albumart .disc { transform: translateX(calc(var(--peek) * 1.6)); --cd-a: 38deg; }
  .small:hover .lid, :global(a:hover) .small .lid { transform: rotateY(-22deg); }
  @media (prefers-reduced-motion: reduce) {
    .lid, .disc { transition: none; }
    :global(a:hover) .albumart .lid, .albumart:hover .lid { transform: none; }
  }
</style>
