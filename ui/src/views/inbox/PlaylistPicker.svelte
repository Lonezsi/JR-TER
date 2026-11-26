<!-- Which playlist, for renderToPlaylist. One sheet rather than a submenu: a submenu that
     has to be fetched before it can open is a menu that hangs on the way to itself. -->
<script lang="ts">
  import { plural } from "$lib/util";
  import Icon from "$ui/Icon.svelte";

  let { playlists, close }: {
    playlists: { id: number; title: string; count?: number }[];
    close: (value?: { id: number } | { fresh: true } | null) => void;
  } = $props();
</script>

<div class="col" style="gap: 2px">
  <button type="button" class="item" onclick={() => close({ fresh: true })}>
    <span class="plus"><Icon name="plus" size={18} /></span>
    <span class="grow col" style="gap:2px"><span class="t">A new playlist</span><span class="s">Named after this render to start with</span></span>
  </button>
  {#each playlists as p (p.id)}
    <button type="button" class="item" onclick={() => close({ id: p.id })}>
      <span class="plus"><Icon name="playlist" size={18} /></span>
      <span class="grow col" style="gap:2px"><span class="t truncate">{p.title}</span><span class="s">{plural(p.count || 0, "item")}</span></span>
    </button>
  {/each}
  {#if !playlists.length}<p class="faint" style="padding: var(--s3)">You have no playlists of your own yet.</p>{/if}
</div>

<style>
  .item { width: 100%; text-align: left; }
  .plus { flex: none; width: 36px; height: 36px; border-radius: var(--r-sm); display: grid; place-items: center; background: var(--hover); color: var(--text-2); }
</style>
