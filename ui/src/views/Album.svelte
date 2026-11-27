<!-- An album: a cover, an ordered list, and a way to play the whole thing.

     The album's order IS the album: the sequence somebody sat down and chose, with track
     numbers drawn from it. So the running order is the default and the only order that
     numbers its rows or can be dragged; the others are for finding a song on a long
     record, not for replacing the record's shape. -->
<script lang="ts">
  import Icon from "$ui/Icon.svelte";
  import StickerSheet from "./library/StickerSheet.svelte";
  import AlbumArt from "$ui/AlbumArt.svelte";
  import { hidden } from "$lib/later.svelte";
  import Cover from "$ui/Cover.svelte";
  import SortPick from "$ui/SortPick.svelte";
  import SongRow from "$ui/SongRow.svelte";
  import { get, post, patch, del, upload, attempt } from "$lib/api";
  import { emit } from "$lib/bus";
  import { sheet } from "$lib/dialog.svelte";
  import { showMenu } from "$lib/menu.svelte";
  import { playSong } from "$lib/player.svelte";
  import { resource } from "$lib/resource.svelte";
  import { go, href } from "$lib/router.svelte";
  import { sorted, sortOf, type SortKey } from "$lib/sort.svelte";
  import { toast } from "$lib/toast.svelte";
  import { accent, setGround } from "$lib/look.svelte";
  import { useCommands } from "$lib/commands";
  import { hue, plural, time } from "$lib/util";
  import type { Song } from "$lib/types";
  import Picker from "./library/Picker.svelte";
  import { albumCover, moved, shuffled, songCover, type AlbumRow, type Candidate } from "./library/kinds";
  import { deleteAlbum } from "./library/shelf";
  import { reorder } from "./library/reorder";
  import { songMenu } from "./library/songMenu";

  let { params }: { params: Record<string, string> } = $props();
  const id = $derived(params.id);

  const SORTS: SortKey<Song>[] = [
    { key: "order", label: "Album order" },
    { key: "title", label: "Title", dir: "up", by: (s) => s.title },
    { key: "length", label: "Length", dir: "down", numeric: true, by: (s) => s.duration },
    { key: "touched", label: "Recently touched", dir: "down", numeric: true, by: (s) => s.updated_at },
  ];

  const res = resource(() => get<{ album: AlbumRow; songs: Song[] }>(`/api/albums/${id}`),
    { on: ["albums:changed", "songs:changed"] });
  const album = $derived(res.data?.album);
  const songs = $derived((res.data?.songs ?? []).filter((s) => !hidden(`song:${s.id}`)));
  const listKey = $derived(`album:${id}`);
  const shown = $derived(sorted(songs, listKey, SORTS));
  const inOrder = $derived(sortOf(listKey, SORTS).key === "order");

  let uploading = $state(false);
  let preview = $state<string | null>(null);
  let dropping = $state(false);
  let picker = $state<HTMLInputElement>();
  let titleBox = $state<HTMLInputElement>();
  const coverUrl = $derived(preview ?? albumCover(album));

  // The ground is the cover, enormous and out of focus, or a hue when there is none.
  $effect(() => {
    if (!album) return;
    setGround(coverUrl, hue(album.title));
    accent.viewing(null);
  });

  // ── playing
  const play = () => { if (shown.length) playSong(shown[0], shown); };
  const shuffle = () => { if (songs.length) { const order = shuffled(songs); playSong(order[0], order); } };

  // ── edits. Each one shows at once and is sent after; a refusal puts the page back.
  function keep(patchOf: Partial<AlbumRow>) {
    if (res.data) res.set({ ...res.data, album: { ...res.data.album, ...patchOf } });
  }
  async function save(fields: Record<string, unknown>, shownAs: Partial<AlbumRow>) {
    keep(shownAs);
    const ok = await attempt(() => patch(`/api/albums/${id}`, fields));
    if (ok) emit("albums:changed"); else res.reload();
  }
  function commitTitle(e: Event) {
    const box = e.currentTarget as HTMLInputElement;
    const value = box.value.trim();
    if (!value) { box.value = album?.title || ""; return; }
    if (value !== album?.title) save({ title: value }, { title: value });
  }
  function commitYear(e: Event) {
    const value = (e.currentTarget as HTMLInputElement).value.trim();
    if (value === String(album?.year ?? "")) return;
    save({ year: value || null }, { year: value ? Number(value) : null });
  }
  /** The stickers on the case: the editor sheet, then saved with the album. */
  async function editStickers() {
    if (!album) return;
    const out = await sheet<any>({ title: "Stickers", sub: "What's on the case.", confirm: "", cancel: "", wide: true,
                                   body: StickerSheet, props: { album, url: coverUrl } });
    if (out === null || out === undefined) return;
    const stickers = out === "random" ? null : out;
    save({ stickers }, { stickers: stickers ? JSON.stringify(stickers) : "" });
  }
  function commitNotes(e: Event) {
    const value = (e.currentTarget as HTMLTextAreaElement).value;
    if (value !== (album?.notes || "")) save({ notes: value }, { notes: value });
  }

  async function setCover(file: File | undefined | null) {
    if (!file) return;
    if (!file.type.startsWith("image/")) { toast("That is not an image.", "bad"); return; }
    const local = URL.createObjectURL(file);
    preview = local;
    uploading = true;
    const ok = await attempt(() => upload(`/api/albums/${id}/cover`, file), "Cover set");
    uploading = false;
    if (ok) { emit("albums:changed"); await res.reload(); }
    preview = null;
    URL.revokeObjectURL(local);
  }
  const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types || []).includes("Files");
  function dragover(e: DragEvent) { if (hasFiles(e)) { e.preventDefault(); dropping = true; } }
  function drop(e: DragEvent) {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dropping = false;
    setCover(e.dataTransfer?.files?.[0]);
  }

  async function move(from: number, to: number) {
    if (!res.data) return;
    const next = moved(songs, from, to);
    res.set({ ...res.data, songs: next });
    const ok = await attempt(() => post(`/api/albums/${id}/order`, { order: next.map((s) => s.id) }));
    if (ok) emit("albums:changed"); else res.reload();
  }

  async function addSongs() {
    const all = await attempt(() => get<{ songs: Song[] }>("/api/songs"));
    if (!all) return;
    const on = new Set(songs.map((s) => s.id));
    const options = (all.songs || []).filter((s) => !on.has(s.id));
    if (!options.length) { toast("Every song is already on this album."); return; }
    const candidates: Candidate[] = options.map((s) => ({
      key: String(s.id), id: s.id, kind: "song", title: s.title, art: songCover(s),
      sub: s.version_count ? plural(s.version_count, "render") : "no renders yet",
    }));
    const keys = await sheet<string[]>({
      title: "Add songs", sub: "Drag them into the order you want afterwards.", wide: true,
      confirm: "", cancel: "Not now", body: Picker, props: { candidates },
    });
    if (!keys?.length) return;
    const chosen = keys.map((k) => options.find((s) => String(s.id) === k)!).filter(Boolean);
    if (res.data) res.set({ ...res.data, songs: [...songs, ...chosen] });
    const ok = await attempt(async () => {
      for (const s of chosen) await post(`/api/albums/${id}/songs`, { song_id: s.id });
      return true;
    }, `Added ${plural(chosen.length, "song")}.`);
    if (ok) emit("albums:changed"); else res.reload();
  }

  async function takeOff(song: Song) {
    if (!res.data) return;
    const was = songs.map((s) => s.id);
    res.set({ ...res.data, songs: songs.filter((s) => s.id !== song.id) });
    const ok = await attempt(() => del(`/api/albums/${id}/songs/${song.id}`));
    if (!ok) { res.reload(); return; }
    emit("albums:changed");
    toast(`Took ${song.title} off the album.`, "", {
      label: "Undo",
      run: async () => {
        await attempt(async () => {
          await post(`/api/albums/${id}/songs`, { song_id: song.id });
          await post(`/api/albums/${id}/order`, { order: was });
        });
        emit("albums:changed");
      },
    });
  }

  const remove = () => album && deleteAlbum(album, () => go(href.library("albums")));
  const rename = () => { titleBox?.focus(); titleBox?.select(); };

  function more(e: MouseEvent) {
    showMenu([
      { label: "Rename", icon: "edit", run: rename },
      { label: "Replace the cover", icon: "image", run: () => picker?.click() },
      { label: "Add songs…", icon: "plus", run: addSongs },
      { label: "Shuffle", icon: "shuffle", disabled: !songs.length, run: shuffle },
      { divider: true },
      { label: "Delete the album…", icon: "trash", danger: true, run: remove },
    ], { anchor: e.currentTarget as Element });
  }

  useCommands(() => album ? [
    { id: "album.play", group: "This album", title: `Play ${album.title}`, icon: "play", run: play },
    { id: "album.shuffle", group: "This album", title: "Shuffle this album", icon: "shuffle", run: shuffle },
    { id: "album.add", group: "This album", title: "Add songs to this album", icon: "plus", run: addSongs },
    { id: "album.cover", group: "This album", title: "Replace the cover", icon: "image", run: () => picker?.click() },
    { id: "album.rename", group: "This album", title: "Rename this album", icon: "edit", run: rename },
    { id: "album.delete", group: "This album", title: "Delete this album", icon: "trash", run: remove },
  ] : []);
</script>

<div class="page">
  {#if res.loading && !res.data}
    <div class="hero" aria-hidden="true">
      <span class="sk" style="width:var(--art);height:var(--art);border-radius:var(--r-xl)"></span>
      <div class="col grow" style="gap:12px;align-self:center">
        <span class="sk" style="height:12px;width:60px"></span>
        <span class="sk" style="height:38px;width:60%"></span>
        <span class="sk" style="height:12px;width:30%"></span>
      </div>
    </div>
    <div class="list" aria-hidden="true">
      {#each Array(5) as _, i (i)}
        <div class="item"><span class="sk" style="width:44px;height:44px;border-radius:var(--r-sm)"></span>
          <span class="sk" style="height:13px;width:{35 + i * 6}%"></span></div>
      {/each}
    </div>
  {:else if res.error && !res.data}
    <div class="notice bad row">
      <Icon name="warning" size={18} /><span class="grow">{res.error}</span>
      <a class="btn sm" href={href.library("albums")}>All albums</a>
      <button class="btn sm" onclick={res.reload}>Try again</button>
    </div>
  {:else if album}
    <a class="btn ghost sm uplink" href={href.library("albums")} data-up><Icon name="chev-left" size={16} /> Albums</a>
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="hero" class:dropping ondragover={dragover} ondragleave={() => (dropping = false)} ondrop={drop}>
      <!-- The same case it is in the library and the sidebar, bigger. Click the cover to
           replace it; the pen beside it opens the stickers. -->
      <span class="heroshape">
        <button class="art" onclick={() => picker?.click()} aria-label="Replace the cover" title="Replace the cover, or drop an image here">
          <AlbumArt {album} url={coverUrl} title={album.title} size="var(--art)" class="hero-cover" />
          <span class="hint">{#if uploading}<span class="spinner"></span>{:else}<Icon name="image" size={18} /> Replace{/if}</span>
        </button>
        <button class="icon-btn sm stickers-btn" onclick={editStickers} title="Stickers on the case" aria-label="Edit the stickers on the case"><Icon name="edit" size={15} /></button>
      </span>
      <div class="meta">
        <span class="eyebrow">Album</span>
        <input class="title-in" bind:this={titleBox} value={album.title} maxlength="200" aria-label="Album title"
               onblur={commitTitle}
               onkeydown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); else if (e.key === "Escape") { e.currentTarget.value = album.title; e.currentTarget.blur(); } }} />
        <div class="row wrap stats">
          <input class="year" inputmode="numeric" placeholder="Year" aria-label="Year" value={album.year ?? ""}
                 maxlength="4" onblur={commitYear} onkeydown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }} />
          <span class="muted num">{plural(songs.length, "song")}</span>
          {#if album.duration}<span class="muted num">{time(album.duration)}</span>{/if}
        </div>
        <textarea class="notes" rows="1" placeholder="Notes about this record" aria-label="Notes" value={album.notes || ""}
                  onblur={commitNotes}></textarea>
        <div class="row wrap acts">
          <button class="play-btn lg accent" aria-label="Play the album" disabled={!songs.length} onclick={play}><Icon name="play" size={24} /></button>
          <button class="btn" disabled={!songs.length} onclick={shuffle}><Icon name="shuffle" size={16} /> Shuffle</button>
          <button class="btn ghost" onclick={addSongs}><Icon name="plus" size={16} /> Add songs</button>
          <button class="icon-btn" aria-label="More" title="More" onclick={more}><Icon name="more" size={20} /></button>
        </div>
      </div>
    </div>
    <input type="file" accept="image/*" hidden bind:this={picker}
           onchange={(e) => { setCover(e.currentTarget.files?.[0]); e.currentTarget.value = ""; }} />

    {#if res.error}
      <div class="notice bad row"><span class="grow">{res.error}</span><button class="btn sm" onclick={res.reload}>Try again</button></div>
    {/if}

    {#if songs.length}
      <section class="col" style="gap:var(--s2)">
        <div class="section-head">
          <SortPick list={listKey} keys={SORTS} />
        </div>
        <div class="list" data-rows use:reorder={{ move, enabled: inOrder }}>
          {#each shown as s, i (s.id)}
            <div class="slot" data-reorder-item>
              <SongRow song={s} queue={shown} number={inOrder ? i + 1 : undefined} handle={inOrder && shown.length > 1}
                       menu={() => [...songMenu(s, shown), { divider: true },
                         { label: "Take off this album", icon: "minus", run: () => takeOff(s) }]} />
            </div>
          {/each}
        </div>
      </section>
    {:else}
      <div class="empty">
        <Icon name="album" size={30} />
        <h3>Nothing on this album yet</h3>
        <p>Add songs and drag them into the order you want.</p>
        <button class="btn primary" onclick={addSongs}><Icon name="plus" size={16} /> Add songs</button>
      </div>
    {/if}
  {/if}
</div>

<style>
  /* Lists read as one calm column on a wide screen, not 1100px rows with nothing in the middle. */
  .page { --art: clamp(140px, 24vw, 220px); }
  .page > :global(*) { max-width: 900px; }
  .hero { display: flex; gap: var(--s6); align-items: flex-end; padding: var(--s4); margin: calc(var(--s4) * -1); border-radius: var(--r-xl); }
  .art { position: relative; display: block; flex: none; width: var(--art); height: var(--art); border-radius: var(--case-r); }
  .art :global(.cover) { width: 100% !important; height: 100% !important; }
  /* A small chip on the corner, not a veil over the case (which opens on hover). */
  .hint {
    position: absolute; right: 8px; bottom: 8px; display: flex; align-items: center; gap: var(--s1); padding: 4px 10px;
    border-radius: var(--r-pill); background: rgba(0, 0, 0, 0.6); color: #fff; font-weight: 600; font-size: var(--t-xs); z-index: 3;
    opacity: 0; transition: opacity var(--fast);
  }
  .art:hover .hint, .art:focus-visible .hint { opacity: 1; }
  .meta { display: flex; flex-direction: column; gap: var(--s2); min-width: 0; flex: 1 1 auto; }
  .title-in {
    width: 100%; font: 800 var(--t-3xl)/1.12 var(--display); letter-spacing: 0.01em; color: var(--text);
    background: transparent; border: 0; border-bottom: 1px solid transparent; padding: 2px 0; border-radius: 0;
    text-overflow: ellipsis; transition: border-color var(--fast);
  }
  .title-in:hover { border-bottom-color: var(--line-2); }
  .title-in:focus { outline: none; border-bottom-color: var(--accent); }
  /* The year edits in place like the title: no box, an underline when you're on it. */
  .year {
    width: 4ch; font: 600 var(--t-sm)/1.4 var(--font); font-variant-numeric: tabular-nums; color: var(--text-2); background: transparent;
    border: 0; border-bottom: 1px solid transparent; padding: 0; border-radius: 0; transition: border-color var(--fast);
  }
  .year:hover { border-bottom-color: var(--line-2); }
  .year:focus { outline: none; border-bottom-color: var(--accent); color: var(--text); }
  .year::placeholder { color: var(--text-3); }
  .stats { gap: 0 var(--s2); align-items: baseline; }
  .stats > * + *::before { content: "·"; margin-right: var(--s2); color: var(--text-3); }
  .notes {
    width: 100%; resize: none; field-sizing: content; min-height: 24px; max-height: 120px;
    background: transparent; border: 0; border-radius: var(--r-sm); padding: var(--s1) 0; color: var(--text-2); font: inherit; font-size: var(--t-sm);
  }
  .notes:hover { background: var(--hover); padding-inline: var(--s2); margin-inline: -8px; width: calc(100% + 16px); }
  .notes:focus { outline: none; background: var(--hover); padding-inline: var(--s2); margin-inline: -8px; width: calc(100% + 16px); color: var(--text); }
  .notes::placeholder { color: var(--text-3); }
  .acts { margin-top: var(--s2); }
  /* A phone: play, shuffle, add and more all fit one row; don't drop the ⋯ onto its own. */
  :global(html[data-narrow]) .acts { flex-wrap: nowrap; gap: var(--s2); }
  :global(html[data-narrow]) .acts > :global(*) { flex-shrink: 0; }
  .slot { position: relative; border-radius: var(--r-md); }
  .slot :global(.item) { width: 100%; }
  .slot:global(.lifted) { background: var(--glass-2); box-shadow: var(--shadow-3); }
  @media (max-width: 640px) {
    .hero { flex-direction: column; align-items: stretch; gap: var(--s4); padding: 0; margin: 0; }
    .art { align-self: center; --art: var(--hero-art); }
  }

  /* Up one level: where this lives. Back always means up (H does the same). */
  .uplink { align-self: flex-start; margin: calc(var(--s2) * -1) 0 calc(var(--s1) * -1) calc(var(--s2) * -1); color: var(--text-2); }
  /* The disc peeks out to the right, so the words keep its room. */
  .heroshape { position: relative; flex: none; margin-right: calc(var(--art) * 0.16); }
  .heroshape .art :global(.albumart) { margin-right: 0 !important; }
  /* The stickers' pen: on the case's corner, out of the cover's click. */
  .stickers-btn { position: absolute; left: -10px; bottom: -10px; z-index: 5; background: var(--glass-2); box-shadow: var(--shadow-1); }
</style>
