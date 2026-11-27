<!-- The library: one screen with four scopes, in place of the home page, the library, the
     search results and the shared list, which were four screens for one idea.

     Songs / Albums / Playlists / Shared with me are the scopes. Typing in the filter
     asks the server's search and shows everything it finds, grouped, whichever scope you
     are in; the term lives in the address (#/?q=term) so such links keep working. With
     nothing typed, Songs opens with a strip of what you keep coming back to. -->
<script lang="ts">
  import Icon from "$ui/Icon.svelte";
  import AlbumArt from "$ui/AlbumArt.svelte";
  import PlaylistArt from "$ui/PlaylistArt.svelte";
  import { hidden } from "$lib/later.svelte";
  import Cover from "$ui/Cover.svelte";
  import Segmented from "$ui/Segmented.svelte";
  import SortPick from "$ui/SortPick.svelte";
  import SongRow from "$ui/SongRow.svelte";
  import AlbumCard from "./library/AlbumCard.svelte";
  import { get, u } from "$lib/api";
  import { has } from "$lib/app.svelte";
  import { resource } from "$lib/resource.svelte";
  import { sorted, type SortKey } from "$lib/sort.svelte";
  import { go, replace, href } from "$lib/router.svelte";
  import { contextMenu } from "$lib/menu.svelte";
  import { useCommands } from "$lib/commands";
  import { newSong, newAlbum, newPlaylist } from "$lib/actions";
  import { debounce, plural, store, when, hue } from "$lib/util";
  import type { Playlist, Song } from "$lib/types";
  import { shell } from "../shell/state.svelte";
  import { albumCover, pieces, songCover, type AlbumRow, type Hit, type SearchResult, type SharedRow, behindOf } from "./library/kinds";
  import { albumMenu, playlistMenu } from "./library/shelf";
  import { navRow } from "./library/rows";

  let { params }: { params: Record<string, string> } = $props();

  type Scope = "songs" | "albums" | "playlists" | "shared";
  const SCOPES: Scope[] = ["songs", "albums", "playlists", "shared"];
  const scope = $derived((SCOPES.includes(params.scope as Scope) ? params.scope : "songs") as Scope);

  // ── what can be sorted by. Recently touched first for songs: the library is a
  //    workbench before it is a catalogue, and yesterday's song is today's. Albums open
  //    newest year first, the closest thing an album has to a place in a sequence.
  const SONG_SORTS: SortKey<Song>[] = [
    { key: "touched", label: "Recently touched", dir: "down", numeric: true, by: (s) => s.updated_at },
    { key: "started", label: "When it was started", dir: "down", numeric: true, by: (s) => s.created_at },
    { key: "title", label: "Title", dir: "up", by: (s) => s.title },
    { key: "renders", label: "How many renders", dir: "down", numeric: true, by: (s) => s.version_count },
    { key: "length", label: "Length", dir: "down", numeric: true, by: (s) => s.duration },
  ];
  const ALBUM_SORTS: SortKey<AlbumRow>[] = [
    { key: "year", label: "Year", dir: "down", numeric: true, by: (a) => a.year },
    { key: "title", label: "Title", dir: "up", by: (a) => a.title },
    { key: "songs", label: "How many songs", dir: "down", numeric: true, by: (a) => a.song_count },
    { key: "length", label: "Length", dir: "down", numeric: true, by: (a) => a.duration },
    { key: "made", label: "When it was made", dir: "down", numeric: true, by: (a) => a.created_at },
  ];
  const PLAYLIST_SORTS: SortKey<Playlist>[] = [
    { key: "touched", label: "Recently changed", dir: "down", numeric: true, by: (p) => p.updated_at },
    { key: "title", label: "Name", dir: "up", by: (p) => p.title },
    { key: "items", label: "How many items", dir: "down", numeric: true, by: (p) => p.count },
  ];
  const SHARED_SORTS: SortKey<SharedRow>[] = [
    { key: "when", label: "Most recent", dir: "down", numeric: true, by: (r) => r.created_at },
    { key: "title", label: "Title", dir: "up", by: (r) => r.title },
    { key: "from", label: "Who shared it", dir: "up", by: (r) => r.from },
  ];

  // ── data. None of it fatal on its own: a module that is switched off is an empty list.
  const songs = resource(() => get<{ songs: Song[] }>("/api/songs"),
    { on: ["songs:changed", "versions:changed", "artwork:changed"], keep: "library.songs" });
  const albums = resource(() => has("albums") ? get<{ albums: AlbumRow[] }>("/api/albums") : Promise.resolve({ albums: [] as AlbumRow[] }),
    { on: ["albums:changed", "songs:changed"], keep: "library.albums" });
  const playlists = resource(() => has("playlists") ? get<{ playlists: Playlist[] }>("/api/playlists") : Promise.resolve({ playlists: [] as Playlist[] }),
    { on: ["playlists:changed"], keep: "library.playlists" });
  const shared = resource(() => has("sharing") ? get<{ shared: SharedRow[] }>("/api/shared") : Promise.resolve({ shared: [] as SharedRow[] }),
    { on: ["shares:changed"], keep: "library.shared" });
  const topSongs = resource(() => get<{ songs: Song[] }>("/api/songs/most-opened?limit=6").catch(() => ({ songs: [] as Song[] })),
    { on: ["songs:changed"], keep: "library.top-songs" });
  const topAlbums = resource(() => has("albums")
    ? get<{ albums: AlbumRow[] }>("/api/albums/most-opened?limit=4").catch(() => ({ albums: [] as AlbumRow[] }))
    : Promise.resolve({ albums: [] as AlbumRow[] }), { on: ["albums:changed"], keep: "library.top-albums" });

  // ── the filter
  // The address is read once here; the effect below follows it afterwards.
  // svelte-ignore state_referenced_locally
  const initial = params.q ?? "";
  let query = $state(initial);
  let term = $state(initial.trim());
  let mirrored = initial;

  const found = resource(() => {
    const t = term;                       // read here so a new term reloads
    return t ? get<SearchResult>(`/api/search?q=${encodeURIComponent(t)}`) : Promise.resolve(null);
  }, { on: ["songs:changed", "albums:changed", "playlists:changed"] });

  const pathFor = (s: Scope, q: string) => {
    const base = s === "songs" ? "/" : `/${s}`;
    return q ? `${base}?q=${encodeURIComponent(q)}` : base;
  };

  const apply = debounce((value: string) => {
    mirrored = value.trim();
    term = value.trim();
    // replace, not go: a filter is not a place, so Back should not step through letters.
    replace(pathFor(scope, mirrored));
  }, 220);

  // The address changed from outside (the palette, a link): follow it.
  $effect(() => {
    const q = params.q ?? "";
    if (q.trim() === mirrored) return;
    mirrored = q.trim();
    query = q;
    term = q.trim();
  });

  function clearFilter() {
    query = "";
    apply.now("");
  }

  function pickScope(next: Scope) { go(pathFor(next, term)); }

  // ── looking: list or grid, remembered per scope
  type Mode = "list" | "grid";
  let modes = $state<Record<string, Mode>>({
    albums: store.get<Mode>("jriter.library.view.albums", "grid"),
    playlists: store.get<Mode>("jriter.library.view.playlists", "list"),
  });
  function setMode(which: "albums" | "playlists", mode: Mode) {
    modes[which] = mode;
    store.set(`jriter.library.view.${which}`, mode);
  }

  // ── derived lists
  const songList = $derived((songs.data?.songs ?? []).filter((s) => !hidden(`song:${s.id}`)));
  const albumList = $derived((albums.data?.albums ?? []).filter((a) => !hidden(`album:${a.id}`)));
  // An album's own running order is reached through the album, not listed twice.
  const playlistList = $derived((playlists.data?.playlists ?? []).filter((p) => !p.album_id && !hidden(`playlist:${p.id}`)));
  const sharedList = $derived(shared.data?.shared ?? []);
  const shownSongs = $derived(sorted(songList, "songs", SONG_SORTS));
  const shownAlbums = $derived(sorted(albumList, "albums", ALBUM_SORTS));
  const shownPlaylists = $derived(sorted(playlistList, "playlists", PLAYLIST_SORTS));
  const shownShared = $derived(sorted(sharedList, "shared", SHARED_SORTS));
  const groups = $derived(found.data?.groups ?? []);
  const songHits = $derived(groups.find((g) => g.kind === "song")?.hits as unknown as Song[] | undefined);
  // Only worth it once the list under it is long: with a dozen songs the strip just repeats
  // what's already on screen.
  const jump = $derived(songList.length > 12 && (topSongs.data?.songs.length || 0) + (topAlbums.data?.albums.length || 0) > 0);
  const firstRun = $derived(!songs.loading && !songs.error && !songList.length && !albumList.length);

  const scopeOptions = $derived([
    { value: "songs" as Scope, label: "Songs", badge: null },
    ...(has("albums") ? [{ value: "albums" as Scope, label: "Albums", badge: null }] : []),
    ...(has("playlists") ? [{ value: "playlists" as Scope, label: "Playlists", badge: null }] : []),
    ...(has("sharing") ? [{ value: "shared" as Scope, label: "Shared", badge: null }] : []),
  ]);

  const kindIcon: Record<string, string> = { lyric: "words", version: "wave", render: "inbox", artwork: "image", song: "songs", album: "album", playlist: "playlist" };

  const hitCover = (kind: string, hit: Hit) =>
    kind === "album" ? albumCover(hit as unknown as AlbumRow) : null;

  /** Where the search looked, said plainly: a category that is switched off was never
   *  asked, so claiming to have searched it would be untrue. */
  function lookedIn(list: string[]) {
    const where = list.map((w) => w.toLowerCase());
    return where.length > 1 ? where.slice(0, -1).join(", ") + " or " + where[where.length - 1] : where[0] || "anything";
  }

  useCommands(() => [
    { id: "library.new-song", group: "Library", title: "New song", icon: "plus", run: newSong },
    has("albums") && { id: "library.new-album", group: "Library", title: "New album", icon: "plus", run: newAlbum },
    has("playlists") && { id: "library.new-playlist", group: "Library", title: "New playlist", icon: "plus", run: newPlaylist },
  ].filter(Boolean) as { id: string; title: string; run: () => unknown }[]);
</script>

{#snippet oops(message: string, retry: () => unknown)}
  <div class="notice bad row">
    <Icon name="warning" size={18} />
    <span class="grow">{message}</span>
    <button class="btn sm" onclick={retry}>Try again</button>
  </div>
{/snippet}

{#snippet rowsSkeleton(n: number)}
  <div class="list" aria-hidden="true">
    {#each Array(n) as _, i (i)}
      <div class="item">
        <span class="sk" style="width:44px;height:44px;border-radius:var(--r-sm)"></span>
        <span class="grow col" style="gap:6px">
          <span class="sk" style="height:13px;width:{38 + ((i * 17) % 30)}%"></span>
          <span class="sk" style="height:10px;width:22%"></span>
        </span>
      </div>
    {/each}
  </div>
{/snippet}

{#snippet gridSkeleton(n: number)}
  <div class="grid" aria-hidden="true">
    {#each Array(n) as _, i (i)}
      <div class="col" style="gap:8px">
        <span class="sk" style="aspect-ratio:1;border-radius:var(--r-lg)"></span>
        <span class="sk" style="height:13px;width:70%"></span>
        <span class="sk" style="height:10px;width:40%"></span>
      </div>
    {/each}
  </div>
{/snippet}

<div class="page">
  <div class="page-head">
    <h1>Library</h1>
  </div>

  <div class="bar">
    <!-- No filter box: the search at the top already finds songs, words and albums. An
         address that carries a search (?q=, which the search's "in the library" result
         opens) still shows the results here, with a chip that clears them. -->
    {#if scopeOptions.length > 1}
      <Segmented options={scopeOptions} value={scope} onchange={pickScope} label="Show" grow={shell.narrow} />
    {/if}
    {#if term}
      <button type="button" class="chip on searching" onclick={clearFilter} title="Clear the search">
        <Icon name="search" size={14} /><span class="truncate">“{term}”</span><Icon name="close" size={14} />
      </button>
    {/if}
    {#if !term}
      <div class="tools">
        {#if scope === "songs"}<SortPick list="songs" keys={SONG_SORTS} />
        {:else if scope === "albums"}<SortPick list="albums" keys={ALBUM_SORTS} />
        {:else if scope === "playlists"}<SortPick list="playlists" keys={PLAYLIST_SORTS} />
        {:else}<SortPick list="shared" keys={SHARED_SORTS} />{/if}
        {#if scope === "albums" || scope === "playlists"}
          <span class="mode" role="group" aria-label="Layout">
            <button class="icon-btn sm" class:on={modes[scope] === "list"} aria-pressed={modes[scope] === "list"} title="List" onclick={() => setMode(scope as "albums", "list")}><Icon name="list" size={16} /></button>
            <button class="icon-btn sm" class:on={modes[scope] === "grid"} aria-pressed={modes[scope] === "grid"} title="Grid" onclick={() => setMode(scope as "albums", "grid")}><Icon name="grid" size={16} /></button>
          </span>
        {:else}
          <!-- The layout toggle's room, kept: the sort stays put when you switch scopes. -->
          <span class="mode held" aria-hidden="true" inert><span class="icon-btn sm"></span><span class="icon-btn sm"></span></span>
        {/if}
      </div>
    {/if}
  </div>

  {#if term}
    <!-- ── what the search found, in the server's fixed category order ─────────── -->
    {#if found.loading && !found.data}
      {@render rowsSkeleton(6)}
    {:else if found.error && !found.data}
      {@render oops(found.error, found.reload)}
    {:else if found.data}
      {@const q = found.data.query}
      {#if !groups.length}
        <div class="empty">
          <Icon name="search" size={28} />
          <h3>Nothing matches “{q}”</h3>
          <p>Nothing in your {lookedIn(found.data.looked_in)}. A shorter word usually finds more.</p>
        </div>
      {:else}
        <div class="results" data-rows>
          {#each groups as group, gi (group.kind + gi)}
            {#if gi}<hr />{/if}
            <section class="col" style="gap:var(--s2)">
              <div class="section-head">
                <h2>{group.label}</h2>
                {#if group.total > group.hits.length}<span class="faint num">{group.hits.length} of {group.total}</span>{/if}
              </div>
              {#if group.error}
                <p class="faint">{group.error}</p>
              {:else}
                <div class="list">
                  {#each group.hits as hit, hi (group.kind + ":" + (hit.id ?? hi))}
                    {#if group.kind === "song"}
                      <SongRow song={hit as unknown as Song} queue={songHits} />
                    {:else}
                      {@const [a, b, c] = pieces(hit.title, q)}
                      {@const [la, lb, lc] = pieces(hit.line, q)}
                      <a class="item hit" href={hit.href || "#/"} use:navRow>
                        {#if group.kind === "album" || group.kind === "playlist"}
                          {#if group.kind === "album"}<AlbumArt url={hitCover(group.kind, hit)} title={hit.title ?? ""} size={44} small />{:else}<Cover url={hitCover(group.kind, hit)} title={hit.title} size={44} />{/if}
                        {:else}
                          <span class="kind"><Icon name={kindIcon[group.kind] || "info"} size={18} /></span>
                        {/if}
                        <span class="grow body">
                          <span class="t truncate">{a}{#if b}<mark>{b}</mark>{/if}{c}</span>
                          {#if hit.line}<span class="s line">{la}{#if lb}<mark>{lb}</mark>{/if}{lc}</span>
                          {:else if hit.sub}<span class="s truncate">{hit.sub}</span>{/if}
                        </span>
                        <Icon name="chev-right" size={16} />
                      </a>
                    {/if}
                  {/each}
                </div>
              {/if}
            </section>
          {/each}
        </div>
      {/if}
    {/if}

  {:else if scope === "songs"}
    {#if songs.loading && !songs.data}
      {@render rowsSkeleton(9)}
    {:else if songs.error && !songs.data}
      {@render oops(songs.error, songs.reload)}
    {:else if firstRun}
      <!-- The first screen anyone sees says what this is for, in the order things
           actually happen, each step with the button that does it. -->
      <div class="empty start">
        <h3>Songs here aren't files</h3>
        <p>A song holds every bounce of a track, plus the words, the artwork and the arrangement. Renders come and go, the song stays.</p>
        <ol class="steps">
          <li><span class="n">1</span><span class="grow"><b>Start a song</b><span>Name it. You can rename it later, old names are kept.</span>
            <button class="btn sm primary" onclick={newSong}>New song</button></span></li>
          <li><span class="n">2</span><span class="grow"><b>Get a render onto it</b>
            <span>{shell.waiting
              ? `${plural(shell.waiting, "render")} ${shell.waiting === 1 ? "is" : "are"} already waiting to be told which song they belong to.`
              : "Upload a bounce, or point JR!TER at the folder your exports land in and it will notice them arriving."}</span>
            {#if has("renders") || has("sync")}<a class="btn sm" href={href.inbox()}>Open the inbox</a>{/if}</span></li>
          <li><span class="n">3</span><span class="grow"><b>Then the rest is on the song</b>
            <span>Write the words, compare two bounces through two equalisers, or cut four bars out of the intro, all on the song's own page.</span></span></li>
        </ol>
      </div>
    {:else}
      {#if jump}
        <section class="col" style="gap:var(--s3)">
          <div class="section-head"><h2>Jump back in</h2></div>
          <div class="strip">
            {#each topSongs.data?.songs ?? [] as s (s.id)}
              <a class="tile" href={href.song(s.id)}>
                <Cover url={songCover(s)} title={s.title} size={112} radius="var(--r-lg)" />
                <span class="t clamp2">{s.title}</span>
                <span class="s truncate">{s.version_count ? plural(s.version_count, "render") : "no renders yet"}</span>
              </a>
            {/each}
            {#if (topSongs.data?.songs ?? []).length && (topAlbums.data?.albums ?? []).length}<span class="split" aria-hidden="true"></span>{/if}
            {#each topAlbums.data?.albums ?? [] as a (a.id)}
              <a class="tile album" href={href.album(a.id)}>
                <AlbumArt album={a} url={albumCover(a)} title={a.title} size={112} />
                <span class="t clamp2">{a.title}</span>
                <span class="s truncate">Album · {plural(a.song_count || 0, "song")}</span>
              </a>
            {/each}
          </div>
        </section>
      {/if}
      <section class="col" style="gap:var(--s2)">
        {#if jump}<div class="section-head"><h2>All songs</h2><span class="faint num">{songList.length}</span></div>{/if}
        {#if songs.error}{@render oops(songs.error, songs.reload)}{/if}
        <div class="list" data-rows>
          {#each shownSongs as s (s.id)}
            <SongRow song={s} queue={shownSongs} />
          {/each}
        </div>
      </section>
    {/if}

  {:else if scope === "albums"}
    {#if albums.loading && !albums.data}
      {@render gridSkeleton(8)}
    {:else if albums.error && !albums.data}
      {@render oops(albums.error, albums.reload)}
    {:else if !albumList.length}
      <div class="empty">
        <Icon name="album" size={30} />
        <h3>No albums yet</h3>
        <p>An album is a running order and a cover, and every song can be on more than one.</p>
        <button class="btn primary" onclick={newAlbum}><Icon name="plus" size={16} /> New album</button>
      </div>
    {:else if modes.albums === "grid"}
      <div class="grid" data-rows>
        {#each shownAlbums as a (a.id)}<AlbumCard album={a} />{/each}
      </div>
    {:else}
      <div class="list" data-rows>
        {#each shownAlbums as a (a.id)}
          <a class="item" href={href.album(a.id)} use:navRow use:contextMenu={() => albumMenu(a)}>
            <AlbumArt album={a} url={albumCover(a)} title={a.title} size={44} small />
            <span class="grow body"><span class="t truncate">{a.title}</span>
              <span class="s truncate">{a.year ? a.year + " · " : ""}{plural(a.song_count || 0, "song")}</span></span>
          </a>
        {/each}
      </div>
    {/if}

  {:else if scope === "playlists"}
    {#if playlists.loading && !playlists.data}
      {@render rowsSkeleton(5)}
    {:else if playlists.error && !playlists.data}
      {@render oops(playlists.error, playlists.reload)}
    {:else if !playlistList.length}
      <div class="empty">
        <Icon name="playlist" size={30} />
        <h3>No playlists yet</h3>
        <p>Playlists can mix songs and loose renders, so a set list and a record work the same way.</p>
        <button class="btn primary" onclick={newPlaylist}><Icon name="plus" size={16} /> New playlist</button>
      </div>
    {:else if modes.playlists === "grid"}
      <div class="grid" data-rows>
        {#each shownPlaylists as p (p.id)}
          <a class="tile big" href={href.playlist(p.id)} use:navRow use:contextMenu={() => playlistMenu(p)}>
            <span class="sq plwrap"><PlaylistArt title={p.title} behind={behindOf(p)} size="100%" /></span>
            <span class="t truncate">{p.title}</span>
            <span class="s truncate">{plural(p.count || 0, "item")}</span>
          </a>
        {/each}
      </div>
    {:else}
      <div class="list" data-rows>
        {#each shownPlaylists as p (p.id)}
          <a class="item" href={href.playlist(p.id)} use:navRow use:contextMenu={() => playlistMenu(p)}>
            <PlaylistArt title={p.title} behind={behindOf(p)} size={44} radius="var(--r-sm)" />
            <span class="grow body"><span class="t truncate">{p.title}</span>
              <span class="s truncate">{plural(p.count || 0, "item")}</span></span>
            <Icon name="chev-right" size={16} />
          </a>
        {/each}
      </div>
    {/if}

  {:else}
    {#if shared.loading && !shared.data}
      {@render rowsSkeleton(4)}
    {:else if shared.error && !shared.data}
      {@render oops(shared.error, shared.reload)}
    {:else if !sharedList.length}
      <div class="empty">
        <Icon name="share" size={30} />
        <h3>Nothing shared with you</h3>
        <p>Songs people on this server share with you show up here, separate from your own library.</p>
      </div>
    {:else}
      <p class="muted lede">Someone else's song. You can listen and work on the sound and the words. What you change goes into their song and its edit history, and they can undo it.</p>
      <div class="list" data-rows>
        {#each shownShared as row (row.share)}
          <a class="item" href={href.share(row.share)} use:navRow>
            <Cover url={row.art ? u(`/api/shared/${row.share}/artwork/${row.art}`) : null} title={row.title} size={44} />
            <span class="grow body"><span class="t truncate">{row.title}</span>
              <span class="s truncate">from {row.from}{row.as_name ? ` · you are ${row.as_name} on this` : ""}{row.created_at ? ` · ${when(row.created_at)}` : ""}</span></span>
            {#if !row.can_play}<span class="tag">no renders yet</span>{/if}
            <Icon name="chev-right" size={16} />
          </a>
        {/each}
      </div>
    {/if}
  {/if}
</div>

<style>
  /* Three quarters for the scope, one for sort and layout, whatever the scope: the switch
     keeps one size as you move along it, so its thumb slides instead of the whole control
     jumping. The quarter holds its tools on one line and the sort label truncates. A
     search chip, when there is one, sits in that quarter too. */
  .bar { display: grid; grid-template-columns: minmax(0, 3fr) minmax(0, 1fr); align-items: center; gap: var(--s3); }
  .bar > :global(.seg) { grid-column: 1; min-width: 0; justify-self: start; }
  .searching { grid-column: 2; max-width: 100%; gap: var(--s2); min-width: 0; }
  .tools { grid-column: 2; display: flex; align-items: center; justify-content: flex-end; gap: var(--s1); min-width: 0; flex-wrap: nowrap; }
  .tools > :global(*) { min-width: 0; }
  .mode { flex: none; }
  .mode { display: inline-flex; gap: 2px; }
  .mode.held { visibility: hidden; }
  /* A phone can't fit four scopes in three quarters ("Shar…"): the scope takes the whole
     width and the tools sit under it on the right. */
  :global(html[data-narrow]) .bar { grid-template-columns: minmax(0, 1fr); gap: var(--s2); }
  :global(html[data-narrow]) .bar > .tools, :global(html[data-narrow]) .searching { grid-column: 1; justify-self: end; }
  /* On a phone the tools row is its own line: sort on the left, layout on the right, so
     neither moves when the scope changes. */
  :global(html[data-narrow]) .bar > .tools { justify-self: stretch; justify-content: space-between; }
  :global(html[data-narrow]) .mode.held { display: none; }

  .body { display: flex; flex-direction: column; min-width: 0; }
  .t { font-weight: 600; }
  .s { font-size: var(--t-sm); color: var(--text-2); }
  .line { display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
  mark { background: var(--accent-soft); color: var(--accent-text); border-radius: 4px; padding: 0 2px; }
  .kind { width: 44px; height: 44px; flex: none; display: grid; place-items: center; border-radius: var(--r-sm); background: var(--hover); color: var(--text-2); }
  .results { display: flex; flex-direction: column; gap: var(--s4); }
  .results hr { border: 0; border-top: 1px solid var(--line); margin: 0; width: 100%; }

  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 158px), 1fr)); gap: var(--s5) var(--s4); }
  .strip { display: flex; gap: var(--s4); overflow-x: auto; padding: 2px 2px var(--s2); margin: 0 -2px; scroll-snap-type: x proximity; }
  /* A thumb scrolls it; the bar under it is just noise on a phone. */
  :global(html[data-narrow]) .strip { scrollbar-width: none; }
  .tile { display: flex; flex-direction: column; gap: 2px; width: 112px; flex: none; scroll-snap-align: start; min-width: 0; }
  .tile .t { margin-top: var(--s2); }
  .clamp2 { display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; overflow-wrap: anywhere; }
  .tile.big { width: auto; }
  /* An album carries its record: the disc that peeks out is room the tile has to keep. */
  .tile.album { width: calc(112px + var(--vinyl-peek)); }
  .tile.album .t, .tile.album .s { padding-right: var(--vinyl-peek); }
  .split { flex: none; width: 1px; align-self: stretch; margin: var(--s2) var(--s1) var(--s6); background: var(--line); }
  .tile.big .sq { display: block; aspect-ratio: 1; margin-bottom: var(--s2); }
  .tile.big .sq :global(.cover) { width: 100% !important; height: 100% !important; }

  .lede { font-size: var(--t-sm); margin-top: calc(var(--s2) * -1); }
  .start { align-items: stretch; text-align: left; max-width: 640px; margin: 0 auto; }
  .start h3, .start > p { text-align: center; align-self: center; }
  .steps { list-style: none; margin: var(--s3) 0 0; padding: 0; display: flex; flex-direction: column; gap: var(--s3); }
  .steps li { display: flex; gap: var(--s3); align-items: flex-start; padding: var(--s4); border-radius: var(--r-lg); background: var(--hover); border: 1px solid var(--line); }
  .steps li > .grow { display: flex; flex-direction: column; gap: var(--s2); align-items: flex-start; }
  .steps b { color: var(--text); }
  .steps span span { color: var(--text-2); font-size: var(--t-sm); }
  .n { width: 26px; height: 26px; border-radius: 50%; flex: none; display: grid; place-items: center; font: 600 var(--t-sm)/1 var(--font); background: var(--accent-soft); color: var(--accent-text); }
  /* Lists read as one calm column on a wide screen, not 1100px rows with nothing in the middle. */
  .page > :global(*) { max-width: 900px; }
  /* A square the fanned playlist cover fills (PlaylistArt keeps its own room above). */
  .plwrap { display: block; width: 100%; aspect-ratio: 1; }
  .plwrap :global(.plart) { width: 100% !important; height: 100% !important; margin-top: 0; }
</style>
