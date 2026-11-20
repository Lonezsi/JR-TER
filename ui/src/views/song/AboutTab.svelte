<!-- The facts about the song and the places it sits: its pictures, albums, playlists, notes,
     dates, and the one thing that cannot be taken back. -->
<script lang="ts">
  import Icon from "$ui/Icon.svelte";
  import { hidden } from "$lib/later.svelte";
  import { get } from "$lib/api";
  import { u } from "$lib/api";
  import { resource } from "$lib/resource.svelte";
  import { contextMenu, type MenuItem } from "$lib/menu.svelte";
  import { date, debounce } from "$lib/util";
  import { href } from "$lib/router.svelte";
  import { useSong } from "./song.svelte";
  import * as act from "./actions";
  import { isImage } from "./helpers";

  const song = useSong();
  const s = $derived(song.song!);
  const mine = $derived(!song.guest);

  const lists = resource<{ playlists: { id: number; title: string; album_id?: number | null; index: number; count: number; times: number }[] }>(
    () => (song.has("playlists") ? get(`/api/songs/${song.id}/playlists`) : Promise.resolve({ playlists: [] })), { on: ["playlists:changed"] });

  // ── artwork ───────────────────────────────────────────────────────────────
  let dragFrom = $state<number | null>(null);
  let dragOver = $state<number | null>(null);
  function drop(to: number) {
    const from = dragFrom; dragFrom = dragOver = null;
    if (from === null || from === to) return;
    const order = song.artwork.map((a) => a.id);
    const [moved] = order.splice(from, 1);
    order.splice(to, 0, moved);
    act.reorderArtwork(song, order);
  }
  function move(i: number, by: number) {
    const j = i + by;
    if (j < 0 || j >= song.artwork.length) return;
    const order = song.artwork.map((a) => a.id);
    [order[i], order[j]] = [order[j], order[i]];
    act.reorderArtwork(song, order);
  }
  const artItems = (id: number, i: number): MenuItem[] => [
    i === 0 ? { label: "This is the cover", icon: "star", disabled: true } : { label: "Make this the cover", icon: "star", run: () => act.makeCover(song, id) },
    { label: "Move earlier", icon: "arrow-left", disabled: i === 0, run: () => move(i, -1) },
    { label: "Move later", icon: "arrow-right", disabled: i === song.artwork.length - 1, run: () => move(i, 1) },
    { label: "Open the picture", icon: "external", run: () => window.open(u(`/api/artwork/${id}/image`), "_blank", "noopener") },
    { divider: true },
    { label: "Remove this artwork", icon: "trash", danger: true, run: () => act.removeArtwork(song, id) },
  ];
  function paste(e: ClipboardEvent) {
    if (!song.has("artwork") || (e.target as HTMLElement).closest("input, textarea")) return;
    const files = Array.from(e.clipboardData?.files || []).filter(isImage);
    if (files.length) { e.preventDefault(); act.addArtwork(song, files); }
  }
  function tilekey(e: KeyboardEvent, id: number, i: number) {
    if (e.target !== e.currentTarget) return;
    if (e.altKey && e.key === "ArrowLeft") { e.preventDefault(); move(i, -1); }
    else if (e.altKey && e.key === "ArrowRight") { e.preventDefault(); move(i, 1); }
    else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); act.makeCover(song, id); }
  }

  // An album's own running order is the album: it shows as the album's play button above,
  // not as a second "First Light" under Playlists.
  const loose = $derived((lists.data?.playlists ?? []).filter((p) => !p.album_id));
</script>

<svelte:window onpaste={paste} />

<div class="col about">
  {#if song.has("artwork")}
    <section class="col">
      <div class="section-head"><h2>Artwork</h2></div>
      <div class="grid">
        {#each song.artwork.filter((x) => !hidden(`artwork:${x.id}`)) as a, i (a.id)}
          <div class="tile" class:cover={i === 0} class:over={dragOver === i} role="button" tabindex="0"
               draggable={mine} ondragstart={(e) => { dragFrom = i; e.dataTransfer?.setData("text/plain", String(a.id)); }}
               ondragover={(e) => { if (dragFrom !== null) { e.preventDefault(); dragOver = i; } }}
               ondragleave={() => (dragOver = null)} ondrop={(e) => { if (dragFrom !== null) { e.preventDefault(); e.stopPropagation(); drop(i); } }}
               ondragend={() => (dragFrom = dragOver = null)}
               onclick={() => act.makeCover(song, a.id)} onkeydown={(e) => tilekey(e, a.id, i)}
               title={i === 0 ? "The cover. Drag to reorder." : "Make this the cover. Drag to reorder."}
               use:contextMenu={() => artItems(a.id, i)}>
            <img src={u(`/api/artwork/${a.id}/image`)} alt="" loading="lazy" draggable="false" />
            {#if i === 0}<span class="badge-cover">Cover</span>{/if}
            {#if mine}<button class="x icon-btn sm" aria-label="Remove this artwork" onclick={(e) => { e.stopPropagation(); act.removeArtwork(song, a.id); }}><Icon name="close" size={14} /></button>{/if}
          </div>
        {/each}
        <button class="tile add" onclick={() => act.pickArtwork(song)} aria-label="Add artwork"><Icon name="plus" size={22} /><span>Add, drop or paste</span></button>
      </div>
      <p class="hint">First one's the cover. Drag to reorder<span class="if-mouse">, or focus one and use Alt + arrows</span>.</p>
    </section>
  {/if}

  {#if song.has("albums")}
    <section class="col">
      <div class="section-head"><h2>Albums</h2><span class="grow"></span>
        <button class="btn sm ghost" onclick={() => act.pickAlbums(song)}>Choose albums…</button></div>
      {#if song.albums.length}
        <div class="card list ruled">
          {#each song.albums as a (a.id)}
            {@const own = lists.data?.playlists.find((p) => p.album_id === a.id)}
            <div class="item" use:contextMenu={() => [{ label: "Open the album", icon: "album", run: () => (location.hash = href.album(a.id)) },
              { label: "Take it off this album", icon: "close", danger: true, run: () => act.removeFromAlbum(song, a) }]}>
              {#if own}<button class="icon-btn sm" aria-label="Play {a.title} from here" onclick={() => act.playFromPlaylist(song, own.id)}><Icon name="play" size={16} /></button>{/if}
              <a class="grow t" href={href.album(a.id)}>{a.title}{#if a.year}<span class="faint year">{a.year}</span>{/if}</a>
              <button class="btn sm ghost" onclick={() => act.removeFromAlbum(song, a)}>Remove</button>
            </div>
          {/each}
        </div>
      {:else}<div class="card pad faint">Not on any album. A song can sit on more than one.</div>{/if}
    </section>
  {/if}

  {#if song.has("playlists")}
    <section class="col">
      <div class="section-head"><h2>Playlists</h2><span class="grow"></span>
        <button class="btn sm ghost" onclick={() => act.addToPlaylist(song)}>Add to a playlist</button></div>
      {#if loose.length}
        <div class="card list ruled">
          {#each loose as p (p.id)}
            <div class="item" use:contextMenu={() => [{ label: "Play from here", icon: "play", run: () => act.playFromPlaylist(song, p.id) },
              { label: "Open the playlist", icon: "playlist", run: () => (location.hash = href.playlist(p.id)) },
              p.album_id ? { label: "Open the album", icon: "album", run: () => (location.hash = href.album(p.album_id!)) } : null]}>
              <button class="icon-btn sm" aria-label="Play {p.title} from here" onclick={() => act.playFromPlaylist(song, p.id)}><Icon name="play" size={16} /></button>
              <span class="grow truncate"><span class="t">{p.title}</span><br /><span class="s">{p.index + 1} of {p.count}{p.times > 1 ? ` · in it ${p.times} times` : ""}</span></span>
              <a class="btn sm ghost" href={href.playlist(p.id)}>Open</a>
            </div>
          {/each}
        </div>
      {:else}<div class="card pad faint">Not in a playlist.</div>{/if}
    </section>
  {/if}

  <!-- The notes are the description now, at the top of the song page. -->

  <section class="col">
    <div class="section-head"><h2>Facts</h2></div>
    <div class="card group">
      <div class="setting"><span class="what">Started</span><span class="ctl num">{date(s.created_at)}</span></div>
      <div class="setting"><span class="what">Last touched</span><span class="ctl num">{date(s.updated_at)}</span></div>
      <div class="setting"><span class="what">Renders</span><span class="ctl num">{song.versions.length}</span></div>
    </div>
  </section>

  {#if mine}
    <section class="col">
      <div class="section-head"><h2>Danger zone</h2></div>
      <div class="card group danger-zone">
        <div class="setting"><span class="what"><span class="s">Deletes every render, lyric and setting. Audio files stay on disk.</span></span>
          <span class="ctl"><button class="btn danger" onclick={() => act.deleteSong(song)}><Icon name="trash" size={16} />Delete song</button></span></div>
      </div>
    </section>
  {/if}
</div>

<style>
  .year { margin-left: var(--s2); font-weight: 500; }
  .about { gap: var(--s6); }
  .pad { padding: var(--s4); font-size: var(--t-sm); }
  .card.list { padding: var(--s2); }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: var(--s3); }
  .tile {
    position: relative; aspect-ratio: 1; border-radius: var(--r-lg); overflow: hidden; cursor: grab;
    border: 1px solid var(--line); background: var(--hover); transition: transform var(--fast), border-color var(--fast);
  }
  .tile img { width: 100%; height: 100%; object-fit: cover; }
  .tile.cover { border-color: var(--accent); box-shadow: 0 0 0 2px var(--accent-soft); }
  .tile.over { transform: scale(0.95); border-color: var(--accent); }
  .badge-cover { position: absolute; left: 8px; top: 8px; padding: 2px var(--s2); border-radius: 99px; font: 600 var(--t-xs)/1.4 var(--font); background: var(--accent); color: var(--accent-ink); }
  .x { position: absolute; right: 6px; top: 6px; background: rgba(0, 0, 0, 0.55); color: #fff; opacity: 0; transition: opacity var(--fast); }
  .tile:hover .x, .tile:focus-within .x { opacity: 1; }
  @media (pointer: coarse) { .x { opacity: 1; } }
  .add { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: var(--s2); color: var(--text-2); border-style: dashed; cursor: pointer; font-size: var(--t-sm); }
  .add:hover { color: var(--text); border-color: var(--accent-line); }
  .danger-zone { border-color: color-mix(in srgb, var(--bad) 30%, transparent); }
</style>
