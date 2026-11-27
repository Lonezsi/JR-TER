<!-- The grave: everything deleted lately, waiting to be brought back or let go.

     Undo covers the seconds after a delete; this covers the month. Each thing comes back
     whole (a song with its renders, words and places on albums), with one press. Emptying
     is the one thing here that can't be taken back, so that one asks. -->
<script lang="ts">
  import Icon from "$ui/Icon.svelte";
  import { get, post, del, attempt } from "$lib/api";
  import { resource } from "$lib/resource.svelte";
  import { confirm } from "$lib/dialog.svelte";
  import { emit } from "$lib/bus";
  import { toast } from "$lib/toast.svelte";
  import { href } from "$lib/router.svelte";
  import { when, plural } from "$lib/util";

  let _: { params?: Record<string, string> } = $props();
  interface Item { id: number; kind: string; kind_said: string; title: string; deleted_at: number; goes_at: number }
  const grave = resource<{ items: Item[]; keep_days: number }>(() => get("/api/grave"));
  const items = $derived(grave.data?.items ?? []);
  const ICON: Record<string, string> = { song: "songs", album: "album", playlist: "playlist", version: "wave",
    sheet: "words", image: "image", render: "inbox", take: "mic" };
  const days = (t: number) => Math.max(0, Math.ceil((t - Date.now() / 1000) / 86400));

  function changed() {
    emit("songs:changed"); emit("versions:changed"); emit("albums:changed"); emit("playlists:changed");
    emit("renders:changed"); emit("lyrics:changed"); emit("artwork:changed"); emit("vocals:changed");
  }
  async function back(item: Item) {
    if (!(await attempt(() => post(`/api/grave/${item.id}/restore`)))) return;
    toast(`${item.title || item.kind_said} is back`);
    changed();
    await grave.reload();
  }
  async function forget(item: Item) {
    if (!(await confirm(`Gone for good: ${item.title || item.kind_said}?`, "It leaves the grave and can't come back.", "Let it go"))) return;
    if (await attempt(() => del(`/api/grave/${item.id}`))) await grave.reload();
  }
  async function empty() {
    if (!(await confirm(`Empty the grave?`, `${plural(items.length, "thing")} go for good. This can't be undone.`, "Empty it"))) return;
    if (await attempt(() => del("/api/grave"))) await grave.reload();
  }
</script>

<div class="page grave">
  <a class="btn ghost sm uplink" href={href.library()} data-up><Icon name="chev-left" size={16} /> Library</a>
  <div class="page-head">
    <h1>Grave</h1>
    {#if items.length}<button class="btn sm ghost danger-ghost" onclick={empty}><Icon name="trash" size={14} /> Empty it</button>{/if}
  </div>
  <p class="lede">What you delete waits here for {grave.data?.keep_days ?? 30} days. Bring it back whole, or let it go.</p>

  {#if grave.loading && !grave.data}
    <div class="card"><div class="sk" style="height:120px"></div></div>
  {:else if !items.length}
    <div class="empty">
      <Icon name="trash" size={28} />
      <h3>Nothing here</h3>
      <p>Deleted songs, renders, albums, playlists and words show up here for a while.</p>
    </div>
  {:else}
    <div class="card list ruled" data-rows>
      {#each items as item (item.id)}
        <div class="item">
          <span class="kind"><Icon name={ICON[item.kind] ?? "trash"} size={16} /></span>
          <span class="grow words">
            <span class="t truncate">{item.title || item.kind_said}</span>
            <span class="s">{item.kind_said} · deleted {when(item.deleted_at)} · goes in {plural(days(item.goes_at), "day")}</span>
          </span>
          <button class="btn sm" onclick={() => back(item)}><Icon name="undo" size={14} /> Bring back</button>
          <button class="icon-btn sm" title="Let it go for good" aria-label="Let {item.title || item.kind_said} go for good" onclick={() => forget(item)}><Icon name="trash" size={15} /></button>
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  /* The page keeps the shared width (so its heading lines up with the library's); only its rows stay a calm column. */
  .grave > :global(*) { max-width: 900px; }
  .uplink { align-self: flex-start; margin: calc(var(--s2) * -1) 0 calc(var(--s1) * -1) calc(var(--s2) * -1); color: var(--text-2); }
  .lede { margin: 0; color: var(--text-2); }
  .item { display: flex; align-items: center; gap: var(--s3); padding: var(--s3) var(--s4); }
  .kind { width: 32px; height: 32px; flex: none; display: grid; place-items: center; border-radius: var(--r-sm); background: var(--hover); color: var(--text-2); }
  .words { display: flex; flex-direction: column; min-width: 0; }
  .t { font-weight: 600; }
  .s { font-size: var(--t-sm); color: var(--text-3); }
  .danger-ghost:hover { color: var(--bad); }
  .empty { display: flex; flex-direction: column; align-items: center; gap: var(--s2); padding: var(--s7) var(--s4); color: var(--text-2); text-align: center; }
  .empty h3 { margin: 0; color: var(--text); }
  .empty p { margin: 0; max-width: 40ch; }
  @media (max-width: 640px) { .item { flex-wrap: wrap; } .item .words { flex-basis: calc(100% - 44px); } }
</style>
