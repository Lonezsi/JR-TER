<!-- A running order.

     The one screen where two kinds of thing sit in one list: songs, which have versions
     and words and a page of their own, and loose renders, which have a file and nothing
     else yet. They are drawn the same because in a running order they are the same: things
     to hear, in an order. An album's own playlist is the album in another shape, so it is
     read only here and the place to change it is the album. -->
<script lang="ts">
  import Icon from "$ui/Icon.svelte";
  import PlaylistArt from "$ui/PlaylistArt.svelte";
  import { shell } from "../shell/state.svelte";
  import Cover from "$ui/Cover.svelte";
  import SortPick from "$ui/SortPick.svelte";
  import SongRow from "$ui/SongRow.svelte";
  import { get, post, put, patch, del, attempt } from "$lib/api";
  import { has } from "$lib/app.svelte";
  import { emit } from "$lib/bus";
  import { sheet } from "$lib/dialog.svelte";
  import { showMenu, type MenuItem } from "$lib/menu.svelte";
  import { playEntry } from "$lib/player.svelte";
  import { resource } from "$lib/resource.svelte";
  import { go, href, replace } from "$lib/router.svelte";
  import { sorted, sortOf, type SortKey } from "$lib/sort.svelte";
  import { toast } from "$lib/toast.svelte";
  import { accent, setGround } from "$lib/look.svelte";
  import { useCommands } from "$lib/commands";
  import { hue, plural, time, bytes } from "$lib/util";
  import type { Render, Song } from "$lib/types";
  import Picker from "./library/Picker.svelte";
  import { moved, shuffled, songCover, type Candidate, type PlaylistFull, type PlaylistItem } from "./library/kinds";
  import { asRender, deletePlaylist, playItems } from "./library/shelf";
  import { reorder } from "./library/reorder";
  import { songMenu } from "./library/songMenu";
  import { addToPlaylist } from "./library/addToPlaylist";

  let { params }: { params: Record<string, string> } = $props();
  const id = $derived(params.id);

  // A running order opens as the order somebody chose. The others are for finding
  // something in a long one; back to front is a different thing, not a sort.
  const SORTS: SortKey<PlaylistItem>[] = [
    { key: "order", label: "Playlist order" },
    { key: "title", label: "Title", dir: "up", by: (i) => i.title },
    { key: "kind", label: "Songs and renders apart", dir: "up", by: (i) => i.kind },
    { key: "length", label: "Length", dir: "down", numeric: true, by: (i) => (i.song ? i.song.duration : i.render?.duration) },
  ];

  const res = resource(() => get<{ playlist: PlaylistFull }>(`/api/playlists/${id}`), { on: ["playlists:changed", "songs:changed"] });
  const playlist = $derived(res.data?.playlist);
  const items = $derived(playlist?.items ?? []);
  const readOnly = $derived(!!playlist?.album_id);
  // An album's own running order IS the album: open the album rather than a twin page of
  // the same songs with fewer features.
  $effect(() => { if (playlist?.album_id) replace(href.album(playlist.album_id)); });
  const listKey = $derived(`playlist:${id}`);
  const shown = $derived(sorted(items, listKey, SORTS));
  const inOrder = $derived(sortOf(listKey, SORTS).key === "order");

  // What a row draws and plays, built once per change so a queue holds stable objects.
  const rows = $derived(shown.map((item) => ({ item, entry: (item.kind === "song" ? item.song! : asRender(item)) as Song | Render })));
  const songQueue = $derived(rows.filter((r) => r.item.kind === "song").map((r) => r.entry as Song));
  const renderQueue = $derived(rows.filter((r) => r.item.kind === "render").map((r) => r.entry as Render));
  const queueFor = (kind: string) => (kind === "song" ? songQueue : renderQueue);
  const total = $derived(items.reduce((sum, i) => sum + ((i.song ? i.song.duration : i.render?.duration) || 0), 0));
  const covers = $derived(items.filter((i) => i.song).slice(0, 4).map((i) => ({ url: songCover(i.song!), title: i.title })));

  let titleBox = $state<HTMLInputElement>();

  $effect(() => {
    if (!playlist) return;
    setGround(covers[0]?.url ?? null, hue(playlist.title));
    accent.viewing(null);
  });

  const play = () => playItems(shown);
  const shuffle = () => playItems(shuffled(shown));

  function keep(next: PlaylistItem[]) {
    if (res.data) res.set({ playlist: { ...res.data.playlist, items: next, count: next.length } });
  }

  async function commitTitle(e: Event) {
    const box = e.currentTarget as HTMLInputElement;
    const value = box.value.trim();
    if (!value) { box.value = playlist?.title || ""; return; }
    if (!playlist || value === playlist.title) return;
    res.set({ playlist: { ...playlist, title: value } });
    const ok = await attempt(() => patch(`/api/playlists/${id}`, { title: value }));
    if (ok) emit("playlists:changed"); else res.reload();
  }

  async function move(from: number, to: number) {
    const next = moved(items, from, to);
    keep(next);
    const ok = await attempt(() => put(`/api/playlists/${id}/order`, { items: next.map((i) => i.item_id) }));
    if (ok) emit("playlists:changed"); else res.reload();
  }

  async function takeOut(item: PlaylistItem) {
    const was = items.map((i) => i.item_id);
    keep(items.filter((i) => i.item_id !== item.item_id));
    const ok = await attempt(() => del(`/api/playlists/${id}/items/${item.item_id}`));
    if (!ok) { res.reload(); return; }
    emit("playlists:changed");
    toast(`Took ${item.title} out.`, "", {
      label: "Undo",
      run: async () => {
        await attempt(async () => {
          const body = item.kind === "song" ? { song_id: item.song!.id } : { render_id: item.render!.id };
          const back = await post(`/api/playlists/${id}/items`, body);
          const fresh = (back.playlist.items as PlaylistItem[]).map((i) => i.item_id).filter((n) => !was.includes(n))[0];
          if (fresh !== undefined) await put(`/api/playlists/${id}/order`, { items: was.map((n) => (n === item.item_id ? fresh : n)) });
        });
        emit("playlists:changed");
      },
    });
  }

  async function addThings() {
    const found = await attempt(() => Promise.all([
      get<{ songs: Song[] }>("/api/songs"),
      has("renders") ? get<{ renders: (Render & { waiting?: boolean })[] }>("/api/renders") : Promise.resolve({ renders: [] as (Render & { waiting?: boolean })[] }),
    ]));
    if (!found) return;
    const candidates: Candidate[] = [
      ...(found[0].songs || []).map((s) => ({
        key: `song:${s.id}`, id: s.id, kind: "song" as const, title: s.title, art: songCover(s),
        sub: s.version_count ? plural(s.version_count, "render") : "no renders yet" })),
      ...(found[1].renders || []).filter((r) => r.waiting !== false && !r.song_id).map((r) => ({
        key: `render:${r.id}`, id: r.id, kind: "render" as const, title: r.name || r.filename || "render",
        sub: `${r.duration ? time(r.duration) + " · " : ""}${bytes(r.size)}` })),
    ];
    if (!candidates.length) { toast("There is nothing to add yet."); return; }
    const keys = await sheet<string[]>({
      title: "Add to this playlist", sub: "Songs and loose renders can sit side by side.", wide: true,
      confirm: "", cancel: "Not now", body: Picker, props: { candidates },
    });
    if (!keys?.length) return;
    const ok = await attempt(async () => {
      for (const key of keys) {
        const c = candidates.find((x) => x.key === key)!;
        await post(`/api/playlists/${id}/items`, c.kind === "song" ? { song_id: c.id } : { render_id: c.id });
      }
      return true;
    }, `Added ${plural(keys.length, "item")}.`);
    emit("playlists:changed");
    if (!ok) res.reload();
  }

  const remove = () => playlist && deletePlaylist(playlist, () => go(href.library("playlists")));
  const rename = () => { titleBox?.focus(); titleBox?.select(); };

  function rowMenu(item: PlaylistItem, entry: Song | Render): MenuItem[] {
    const out: MenuItem[] = item.kind === "song"
      ? songMenu(entry as Song, songQueue)
      : [
          { group: item.title },
          { label: "Play", icon: "play", hint: "Enter", run: () => playEntry(entry, renderQueue) },
          { label: "Add to another playlist…", icon: "playlist", run: () => addToPlaylist({ kind: "render", id: item.render!.id, title: item.title }) },
          { label: "Make a song from it", icon: "plus", run: () => go(href.inbox()) },
        ];
    if (!readOnly) out.push({ divider: true }, { label: "Take it out of this playlist", icon: "minus", run: () => takeOut(item) });
    return out;
  }

  function more(e: MouseEvent) {
    showMenu([
      !readOnly && { label: "Rename", icon: "edit", run: rename },
      !readOnly && { label: "Add songs and renders…", icon: "plus", run: addThings },
      { label: "Shuffle", icon: "shuffle", disabled: !items.length, run: shuffle },
      !readOnly && { divider: true },
      !readOnly && { label: "Delete the playlist…", icon: "trash", danger: true, run: remove },
    ], { anchor: e.currentTarget as Element });
  }

  useCommands(() => playlist ? [
    { id: "playlist.play", group: "This playlist", title: `Play ${playlist.title}`, icon: "play", run: play },
    { id: "playlist.shuffle", group: "This playlist", title: "Shuffle this playlist", icon: "shuffle", run: shuffle },
    ...(readOnly ? [] : [
      { id: "playlist.add", group: "This playlist", title: "Add to this playlist", icon: "plus", run: addThings },
      { id: "playlist.rename", group: "This playlist", title: "Rename this playlist", icon: "edit", run: rename },
      { id: "playlist.delete", group: "This playlist", title: "Delete this playlist", icon: "trash", run: remove },
    ]),
  ] : []);
</script>

<div class="page">
  {#if res.loading && !res.data}
    <div class="hero" aria-hidden="true">
      <span class="sk" style="width:var(--art);height:var(--art);border-radius:var(--r-xl)"></span>
      <div class="col grow" style="gap:12px;align-self:center">
        <span class="sk" style="height:12px;width:80px"></span>
        <span class="sk" style="height:38px;width:55%"></span>
      </div>
    </div>
    <div class="list" aria-hidden="true">
      {#each Array(5) as _, i (i)}
        <div class="item"><span class="sk" style="width:44px;height:44px;border-radius:10px"></span>
          <span class="sk" style="height:13px;width:{35 + i * 6}%"></span></div>
      {/each}
    </div>
  {:else if res.error && !res.data}
    <div class="notice bad row">
      <Icon name="warning" size={18} /><span class="grow">{res.error}</span>
      <a class="btn sm" href={href.library("playlists")}>All playlists</a>
      <button class="btn sm" onclick={res.reload}>Try again</button>
    </div>
  {:else if playlist}
    <a class="btn ghost sm uplink" href={href.library("playlists")} data-up><Icon name="chev-left" size={16} /> Playlists</a>
    <div class="hero">
      <!-- A pile, like its tile in the library: the same object, bigger. -->
      <!-- The same cover it has in the library and the sidebar, bigger: its own tile with
           its first songs fanned out behind. -->
      <span class="heroshape"><PlaylistArt title={playlist.title} behind={covers.slice(0, 3)} size="var(--art)" radius="var(--r-xl)" class="hero-cover" /></span>
      <div class="meta">
        <span class="eyebrow">{readOnly ? "Album order" : "Playlist"}</span>
        <input class="title-in" bind:this={titleBox} value={playlist.title} maxlength="120" aria-label="Playlist title" readonly={readOnly}
               onblur={commitTitle}
               onkeydown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); else if (e.key === "Escape") { e.currentTarget.value = playlist.title; e.currentTarget.blur(); } }} />
        <div class="row wrap stats muted">
          <span class="num">{plural(items.length, items.every((x) => x.kind === "song") ? "song" : "item")}</span>
          {#if total}<span class="faint">·</span><span class="num">{time(total)}</span>{/if}
          {#if readOnly && playlist.album_id}<span class="faint">·</span><a class="link" href={href.album(playlist.album_id)}>Open the album</a>{/if}
        </div>
        <div class="row wrap acts">
          <button class="play-btn lg accent" aria-label="Play the playlist" disabled={!items.length} onclick={play}><Icon name="play" size={24} /></button>
          <button class="btn" disabled={!items.length} onclick={shuffle}><Icon name="shuffle" size={16} /> Shuffle</button>
          {#if !readOnly}<button class="btn ghost" onclick={addThings} title="Songs, or loose renders from the inbox"><Icon name="plus" size={16} /> Add songs</button>{/if}
          <button class="icon-btn" aria-label="More" onclick={more}><Icon name="more" size={20} /></button>
        </div>
      </div>
    </div>

    {#if res.error}
      <div class="notice bad row"><span class="grow">{res.error}</span><button class="btn sm" onclick={res.reload}>Try again</button></div>
    {/if}

    {#if items.length}
      <section class="col" style="gap:var(--s2)">
        <div class="section-head">
          <SortPick list={listKey} keys={SORTS} />
        </div>
        <div class="list" data-rows use:reorder={{ move, enabled: inOrder && !readOnly }}>
          {#each rows as r, i (r.item.item_id)}
            <div class="slot" data-reorder-item>
              <SongRow song={r.entry} queue={queueFor(r.item.kind)} number={inOrder ? i + 1 : undefined}
                       handle={inOrder && !readOnly && rows.length > 1} menu={() => rowMenu(r.item, r.entry)} />
            </div>
          {/each}
        </div>
      </section>
    {:else}
      <div class="empty">
        <Icon name="playlist" size={30} />
        <h3>Nothing in it yet</h3>
        <p>{readOnly
          ? "This is the album's own running order. Add songs to the album and they arrive here."
          : shell.narrow ? "Add songs here, or hold a song anywhere and send it. Songs and loose renders can sit in one list."
          : "Add songs here, or right-click a song or a render anywhere and send it. Songs and loose renders can sit in one list."}</p>
        {#if !readOnly}<button class="btn primary" onclick={addThings}><Icon name="plus" size={16} /> Add songs</button>{/if}
      </div>
    {/if}
  {/if}
</div>

<style>
  /* Lists read as one calm column on a wide screen, not 1100px rows with nothing in the middle. */
  .page { --art: clamp(140px, 24vw, 220px); }
  .page > :global(*) { max-width: 900px; }
  .hero { display: flex; gap: var(--s6); align-items: flex-end; }
  .meta { display: flex; flex-direction: column; gap: var(--s2); min-width: 0; flex: 1 1 auto; }
  .title-in {
    width: 100%; font: 800 var(--t-3xl)/1.12 var(--display); letter-spacing: 0.01em; color: var(--text);
    background: transparent; border: 0; border-bottom: 1px solid transparent; padding: 2px 0; border-radius: 0;
    text-overflow: ellipsis; transition: border-color var(--fast);
  }
  .title-in:not([readonly]):hover { border-bottom-color: var(--line-2); }
  .title-in:focus { outline: none; border-bottom-color: var(--accent); }
  .link { color: var(--accent-text); }
  .link:hover { text-decoration: underline; }
  .acts { margin-top: var(--s2); }
  .slot { position: relative; border-radius: var(--r-md); }
  .slot :global(.item) { width: 100%; }
  .slot:global(.lifted) { background: var(--glass-2); box-shadow: var(--shadow-3); }
  @media (max-width: 640px) {
    .hero { flex-direction: column; align-items: stretch; gap: var(--s4); }
    .heroshape { align-self: center; --art: var(--hero-art); }
  }

  /* Up one level: where this lives. Back always means up (H does the same). */
  .uplink { align-self: flex-start; margin: calc(var(--s2) * -1) 0 calc(var(--s1) * -1) calc(var(--s2) * -1); color: var(--text-2); }
  /* The fan spreads past the cover on both sides: room for it, so it never sits on the title. */
  .heroshape { flex: none; display: block; }
</style>
