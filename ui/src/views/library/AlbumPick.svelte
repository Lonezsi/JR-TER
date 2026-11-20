<!-- Sheet body: the albums a song is on, as checkboxes. A song can be on more than one. -->
<script lang="ts">
  import Cover from "$ui/Cover.svelte";
  import AlbumArt from "$ui/AlbumArt.svelte";
  import Icon from "$ui/Icon.svelte";
  import { albumCover, type AlbumRow } from "./kinds";

  let { albums, chosen, close }: { albums: AlbumRow[]; chosen: number[]; close: (ids?: number[] | null) => void } = $props();
  // Only the first value matters: the sheet is rebuilt for each opening.
  // svelte-ignore state_referenced_locally
  let ids = $state<number[]>([...chosen]);
  const toggle = (id: number) => { ids = ids.includes(id) ? ids.filter((i) => i !== id) : [...ids, id]; };
</script>

<div class="col">
  <div class="list">
    {#each albums as a (a.id)}
      {@const on = ids.includes(a.id)}
      <button type="button" class="item" class:on role="checkbox" aria-checked={on} onclick={() => toggle(a.id)}>
        <AlbumArt album={a} url={albumCover(a)} title={a.title} size={36} small />
        <span class="grow truncate">{a.title}{#if a.year}<span class="faint"> · {a.year}</span>{/if}</span>
        <span class="tick" class:on>{#if on}<Icon name="check" size={14} stroke={2.4} />{/if}</span>
      </button>
    {/each}
  </div>
  <button class="btn primary block" onclick={() => close(ids)}>Save</button>
</div>

<style>
  .list { display: flex; flex-direction: column; gap: 2px; max-height: 46vh; overflow-y: auto; }
  .item { width: 100%; text-align: left; font-weight: 600; }
  .tick {
    width: 22px; height: 22px; border-radius: 50%; flex: none; display: grid; place-items: center;
    border: 1.5px solid var(--line-2); color: var(--accent-ink);
  }
  .tick.on { background: var(--accent); border-color: transparent; }
</style>
