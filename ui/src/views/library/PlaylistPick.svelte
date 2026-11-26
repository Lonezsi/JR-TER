<!-- Sheet body: which playlist something goes into. One sheet rather than a submenu,
     because a submenu that has to be fetched before it opens hangs on the way to itself. -->
<script lang="ts">
  import Icon from "$ui/Icon.svelte";
  import { plural } from "$lib/util";
  import type { Playlist } from "$lib/types";

  let { playlists, close }: { playlists: Playlist[]; close: (v?: { id?: number; fresh?: boolean } | null) => void } = $props();
</script>

<div class="list">
  <button type="button" class="item" onclick={() => close({ fresh: true })}>
    <span class="plus"><Icon name="plus" size={18} /></span>
    <span class="grow truncate"><span class="t truncate">A new playlist</span><span class="s">Named after this to start with</span></span>
  </button>
  {#each playlists as p (p.id)}
    <button type="button" class="item" onclick={() => close({ id: p.id })}>
      <span class="plus"><Icon name="playlist" size={18} /></span>
      <span class="grow truncate"><span class="t truncate">{p.title}</span><span class="s">{plural(p.count || 0, "item")}</span></span>
      <span class="go">Add</span>
    </button>
  {/each}
  {#if !playlists.length}<p class="muted none">You have no playlists of your own yet.</p>{/if}
</div>

<style>
  .list { display: flex; flex-direction: column; gap: 2px; max-height: 50vh; overflow-y: auto; }
  .item { width: 100%; text-align: left; }
  .t, .s { display: block; }
  .plus { width: 36px; height: 36px; border-radius: var(--r-sm); display: grid; place-items: center; background: var(--hover); color: var(--text-2); flex: none; }
  .go { font-size: var(--t-sm); font-weight: 600; color: var(--accent-text); }
  .none { padding: var(--s3); }
</style>
