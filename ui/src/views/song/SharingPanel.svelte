<!-- Who this song is shared with, and the way to share it with somebody else or take it
     back. What they made stays theirs; the Words/Sound they changed on yours is listed in
     "Changes by others" below, each with an Undo. -->
<script lang="ts">
  import Icon from "$ui/Icon.svelte";
  import { get, del, attempt } from "$lib/api";
  import { emit } from "$lib/bus";
  import { resource } from "$lib/resource.svelte";
  import { contextMenu, showMenu, type MenuItem } from "$lib/menu.svelte";
  import { confirm } from "$lib/dialog.svelte";
  import { when } from "$lib/util";
  import { useSong } from "./song.svelte";
  import { shareSong } from "./share";

  interface Share { id: number; to_name: string; to_handle?: string; created_at?: number }
  const song = useSong();
  const shares = resource<{ shares: Share[] }>(() => get(`/api/shares?song=${song.id}`), { on: ["shares:changed"] });
  const list = $derived(shares.data?.shares || []);

  async function revoke(s: Share) {
    const sure = await confirm(`Take it back from ${s.to_name}?`, "Their own copies stay theirs.", "Take it back");
    if (!sure) return;
    if (await attempt(() => del(`/api/shares/${s.id}`), "Taken back. What they made stays theirs.")) {
      await shares.reload(); emit("shares:changed");
    }
  }
  const items = (s: Share): MenuItem[] => [{ label: "Take it back", icon: "close", danger: true, run: () => revoke(s) }];
</script>

<section class="col">
  <div class="section-head">
    <h2>Sharing</h2>{#if list.length}<span class="tag">{list.length}</span>{/if}
  </div>
  {#if shares.loading && !shares.data}
    <div class="card"><div class="sk" style="height:56px"></div></div>
  {:else if !list.length}
    <div class="card pad faint">Not shared. Share gives someone their own copy to play and edit.</div>
  {:else}
    <div class="card list ruled">
      {#each list as s (s.id)}
        <div class="item" use:contextMenu={() => items(s)}>
          <span class="grow truncate"><span class="t">{s.to_name}</span>{#if s.to_handle}<span class="faint"> @{s.to_handle}</span>{/if}</span>
          {#if s.created_at}<span class="faint">{when(s.created_at)}</span>{/if}
          <button class="btn sm ghost" onclick={() => revoke(s)}>Take it back</button>
          <button class="icon-btn sm" aria-label="More" onclick={(e) => showMenu(items(s), { anchor: e.currentTarget })}><Icon name="more" size={18} /></button>
        </div>
      {/each}
    </div>
  {/if}
</section>

<style>
  .pad { padding: var(--s4); font-size: var(--t-sm); }
  .card.list { padding: var(--s2); }
</style>
