<!-- One cover for every screen: real artwork when there is some, a coloured placeholder
     built from the title when there is not, so a song without a picture still looks like
     itself every time. The picture fades in only once it has loaded; a broken one falls
     back to the placeholder rather than showing a torn image. -->
<script lang="ts">
  import { hue, letter } from "$lib/util";

  let { url = null, title = "", size = 44, radius, round = false, class: klass = "" }: {
    url?: string | null; title?: string | null; size?: number | string;
    radius?: number | string; round?: boolean; class?: string;
  } = $props();

  let failed = $state<string | null>(null);
  let loaded = $state<string | null>(null);
  const show = $derived(!!url && failed !== url);
  const px = (v: number | string) => (typeof v === "number" ? `${v}px` : v);
  const r = $derived(round ? "50%" : radius !== undefined ? px(radius)
    : typeof size === "number" ? `${Math.max(6, Math.round(size * 0.22))}px` : "22%");
</script>

<div class="cover {klass}" style:--size={px(size)} style:--r={r} style:--hue={hue(title)}>
  <span class="letter" aria-hidden="true">{letter(title)}</span>
  {#if show}
    <img src={url} alt="" loading="lazy" decoding="async" class:in={loaded === url}
         onload={() => (loaded = url)} onerror={() => (failed = url)} draggable="false" />
  {/if}
</div>

<style>
  .cover {
    position: relative; flex: none; overflow: hidden;
    width: var(--size); height: var(--size); border-radius: var(--r);
    background:
      radial-gradient(120% 120% at 20% 10%, hsl(var(--hue) 80% 62% / 0.9), transparent 60%),
      linear-gradient(145deg, hsl(var(--hue) 70% 34%), hsl(calc(var(--hue) + 40) 65% 16%));
    box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.1), 0 2px 10px rgba(0, 0, 0, 0.4);
    display: grid; place-items: center;
    container-type: size;
  }
  .letter {
    font: 800 46cqw/1 var(--display); color: rgba(255, 255, 255, 0.92);
    text-shadow: 0 1px 6px rgba(0, 0, 0, 0.35); user-select: none;
  }
  img {
    position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover;
    opacity: 0; transition: opacity 260ms var(--ease);
  }
  img.in { opacity: 1; }
</style>
