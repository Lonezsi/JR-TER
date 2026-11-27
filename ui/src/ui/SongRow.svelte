<!-- The row every list of songs uses: cover (or a track number), title, the facts, a way to
     play, a menu. Pressing the row plays it with `queue` as what comes next, so the
     visible list in visible order is what plays on; the title and the picture open the
     song's page. One tab stop per list (Arrow keys move between rows, see navRow), a
     pointer that settles on a row primes its file so the press has nothing left to wait
     for, and a render that is not on a song yet is drawn the same way. -->
<script lang="ts">
  import type { Snippet } from "svelte";
  import Cover from "./Cover.svelte";
  import Icon from "./Icon.svelte";
  import { player, playEntry, prime } from "$lib/player.svelte";
  import { contextMenu, showMenu, type MenuItem } from "$lib/menu.svelte";
  import { href } from "$lib/router.svelte";
  import { get } from "$lib/api";
  import { time, plural } from "$lib/util";
  import type { Song, Render, Version } from "$lib/types";
  import { songMenu } from "../views/library/songMenu";
  import { navRow } from "../views/library/rows";
  import { isRender, playerIdOf, songCover, titleOf } from "../views/library/kinds";

  let { song, queue, number, sub, menu, handle = false, trailing }: {
    song: Song | Render;
    /** What plays on after this one: the list as it is shown. */
    queue?: (Song | Render)[];
    /** A track number in place of the cover (album and playlist order). */
    number?: number;
    /** Replaces the default line under the title. */
    sub?: string;
    /** Replaces the default menu. */
    menu?: () => MenuItem[];
    /** Show a grip to drag the row; the list's `reorder` action does the rest. */
    handle?: boolean;
    trailing?: Snippet;
  } = $props();

  const render = $derived(isRender(song));
  const title = $derived(titleOf(song));
  const here = $derived(String(player.song?.id) === playerIdOf(song));
  const sounding = $derived(here && player.playing);
  const asSong = $derived(song as Song);
  const line = $derived(sub !== undefined ? sub
    : render ? "a render"
    : asSong.version_count ? plural(asSong.version_count, "render") : "no renders yet");
  const items = (): MenuItem[] => (menu ? menu() : render ? [] : songMenu(asSong, (queue as Song[]) || undefined));

  const play = () => playEntry(song, queue?.length ? queue : [song]);

  function onclick(e: MouseEvent) {
    if ((e.target as HTMLElement).closest("a, button, [data-handle]")) return;
    play();
  }
  function onkeydown(e: KeyboardEvent) {
    if (e.target !== e.currentTarget) return;
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); play(); }
  }

  // A pointer that settles on a row is usually about to press it. Not on the way past,
  // which would fetch a file for every row a mouse crossed, and not on touch.
  let timer: ReturnType<typeof setTimeout> | undefined;
  function onenter(e: PointerEvent) {
    if (e.pointerType === "touch") return;
    clearTimeout(timer);
    timer = setTimeout(async () => {
      if (render) { prime({ id: song.id, kind: "render" } as Version); return; }
      if (!asSong.version_count) return;
      try {
        const data = await get<{ versions?: Version[]; current_version_id?: number }>(`/api/songs/${song.id}/versions`);
        const list = data.versions || [];
        prime(list.find((v) => v.id === data.current_version_id) || list[0]);
      } catch { /* priming is only ever a courtesy */ }
    }, 140);
  }
  const onleave = () => clearTimeout(timer);

  function more(e: MouseEvent) {
    e.stopPropagation();
    showMenu(items(), { anchor: e.currentTarget as Element });
  }
</script>

<div class="item row-song" class:on={here} role="button" tabindex="-1" aria-label={`${title}${sounding ? ", playing" : ""}`}
     use:navRow use:contextMenu={items} {onclick} {onkeydown} onpointerenter={onenter} onpointerleave={onleave}>
  {#if handle}
    <button type="button" class="grip" data-handle aria-label="Drag to reorder, or Alt and the arrow keys" tabindex="-1">
      <Icon name="drag" size={16} />
    </button>
  {/if}
  {#if number !== undefined}
    <span class="lead num-lead">
      {#if here}<span class="bars" class:still={!sounding} aria-hidden="true"><i></i><i></i><i></i></span>
      {:else}<span class="n num faint">{number}</span>{/if}
    </span>
  {:else if render}
    <span class="lead"><Cover title={title} size={44} />{#if here}<span class="over"><span class="bars" class:still={!sounding}><i></i><i></i><i></i></span></span>{/if}</span>
  {:else}
    <a class="lead" href={href.song(song.id)} aria-label={`Open ${title}`} tabindex="-1">
      <Cover url={songCover(asSong)} title={title} size={44} />
      {#if here}<span class="over"><span class="bars" class:still={!sounding}><i></i><i></i><i></i></span></span>{/if}
    </a>
  {/if}
  <span class="grow body">
    {#if render}
      <span class="t truncate">{title}</span>
    {:else}
      <a class="t truncate" href={href.song(song.id)} title={`Open ${title}`}>{title}</a>
    {/if}
    <span class="s truncate">{line}</span>
  </span>
  {#if render}<span class="tag">render</span>
  {:else if asSong.latest_version}<span class="ver num faint">v{asSong.latest_version}</span>{/if}
  <span class="dur num faint">{song.duration ? time(song.duration) : ""}</span>
  {#if trailing}{@render trailing()}{/if}
  <button type="button" class="icon-btn sm more" aria-label={`More for ${title}`} onclick={more}><Icon name="more" size={18} /></button>
</div>

<style>
  .row-song { cursor: default; user-select: none; touch-action: pan-y; }
  .body { display: flex; flex-direction: column; min-width: 0; }
  .t { font-weight: 600; align-self: flex-start; max-width: 100%; }
  a.t:hover { text-decoration: underline; text-decoration-color: var(--text-3); text-underline-offset: 3px; }
  .s { font-size: var(--t-sm); color: var(--text-2); }
  .lead { position: relative; flex: none; display: block; }
  .num-lead { width: 44px; height: 44px; display: grid; place-items: center; }
  .n { font-size: var(--t-md); font-weight: 600; }
  .ver, .dur { font-size: var(--t-sm); flex: none; }
  .dur { min-width: 40px; text-align: right; }
  .more { opacity: 0; transition: opacity var(--fast), background var(--fast); }
  .row-song:hover .more, .row-song:focus-within .more, .more:focus-visible { opacity: 1; }
  @media (pointer: coarse) { .more { opacity: 1; } }
  @media (max-width: 520px) { .ver { display: none; } }
  .grip {
    display: grid; place-items: center; width: 24px; height: 36px; flex: none; margin-left: -6px;
    color: var(--text-3); cursor: grab; touch-action: none; border-radius: var(--r-sm);
  }
  .grip:hover { color: var(--text); background: var(--hover); }
  .grip:active { cursor: grabbing; }
  @media (pointer: coarse) { .grip { height: var(--s7); width: var(--s6); } }
  .over {
    position: absolute; inset: 0; display: grid; place-items: center; border-radius: var(--r-sm);
    background: rgba(0, 0, 0, 0.45); color: var(--accent-text);
  }
  .bars { display: inline-flex; align-items: flex-end; gap: 2px; height: 14px; color: var(--accent-text); }
  .bars i { width: 3px; height: 100%; border-radius: 2px; background: currentColor; transform-origin: bottom; animation: eq 900ms ease-in-out infinite; }
  .bars i:nth-child(2) { animation-delay: -300ms; }
  .bars i:nth-child(3) { animation-delay: -600ms; }
  .bars.still i { animation: none; transform: scaleY(0.4); }
  @keyframes eq { 0%, 100% { transform: scaleY(0.25); } 50% { transform: scaleY(1); } }
  @media (prefers-reduced-motion: reduce) { .bars i { animation: none; transform: scaleY(0.7); } }
</style>
