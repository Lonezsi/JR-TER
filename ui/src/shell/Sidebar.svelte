<!-- The sidebar: where you are, and the short way to the things you keep going back to.
     The places are few on purpose. Albums and playlists are listed here as shortcuts;
     the lists themselves, with everything you can do to them, are scopes of the Library. -->
<script lang="ts">
  import Icon from "$ui/Icon.svelte";
  import AlbumArt from "$ui/AlbumArt.svelte";
  import PlaylistArt from "$ui/PlaylistArt.svelte";
  import { behindOf } from "../views/library/kinds";
  import { hidden } from "$lib/later.svelte";
  import Cover from "$ui/Cover.svelte";
  import { app, has, me, isGuest, FOYER } from "$lib/app.svelte";
  import { router, href, go } from "$lib/router.svelte";
  import { contextMenu } from "$lib/menu.svelte";
  import { newSong, newAlbum, newPlaylist } from "$lib/actions";
  import { get, attempt } from "$lib/api";
  import { playSong, playRender, toggle, player } from "$lib/player.svelte";
  import { nameOf } from "../views/inbox/renders";
  import { renderMenu } from "../views/inbox/renderMenu";
  import { toast } from "$lib/toast.svelte";
  import { plural, store, time, when, hue } from "$lib/util";
  import { shell } from "./state.svelte";
  import { pins, pinItem, type Pin } from "$lib/pins.svelte";
  import { songMenu } from "../views/library/songMenu";
  import { songCover } from "../views/library/kinds";
  import { pane } from "$lib/glass/glass.svelte";
  import type { Album, Playlist } from "$lib/types";

  let { onnavigate }: { onnavigate?: () => void; drawer?: boolean } = $props();
  // A pane in both places: on a phone the page steps back while it is open (Shell.svelte),
  // so what is behind it is only the ground, which the shader blurs.
  const asPane = (node: HTMLElement) => pane(node);

  const route = $derived(router.route);
  const scope = $derived(route.view === "library" ? (route.params.scope || "songs") : "");

  const places = $derived([
    { key: "library", label: "Library", icon: "library", to: href.library(), on: route.view === "library" || route.view === "share" },
    has("renders") || has("sync")
      ? { key: "inbox", label: "Inbox", icon: "inbox", to: href.inbox(), on: route.view === "inbox", badge: shell.waiting }
      : null,
    has("grave") ? { key: "grave", label: "Grave", icon: "trash", to: href.grave(), on: route.view === "grave" } : null,
  ].filter(Boolean) as { key: string; label: string; icon: string; to: string; on: boolean; badge?: number }[]);

  // Which shortcut lists are folded. A preference about looking, kept per browser.
  let folded = $state(store.get<Record<string, boolean>>("jriter.rail.folded", {}));
  /* Pinned things, resolved against what the sidebar already holds; a pin whose thing is
   * gone (deleted, or not loaded yet) simply isn't drawn. */
  type PinRow = { pin: Pin; key: string; title: string; sub: string; href?: string; cover?: string | null; render?: any; album?: any; playlist?: any; song?: any };
  const pinned = $derived.by<PinRow[]>(() => pins().flatMap((pin): PinRow[] => {
    const key = pin.kind + ":" + pin.id;
    if (pin.kind === "song") {
      const s = shell.songs.find((x) => x.id === pin.id);
      return s ? [{ pin, key, title: s.title, sub: "Song", href: href.song(s.id), cover: songCover(s), song: s }] : [];
    }
    if (pin.kind === "album") {
      const a = shell.albums.find((x) => x.id === pin.id);
      return a ? [{ pin, key, title: a.title, sub: "Album", href: href.album(a.id), cover: a.has_cover ? `/api/albums/${a.id}/cover` : null, album: a }] : [];
    }
    if (pin.kind === "playlist") {
      const p = shell.playlists.find((x) => x.id === pin.id);
      return p ? [{ pin, key, title: p.title, sub: "Playlist", href: href.playlist(p.id), playlist: p }] : [];
    }
    const r = shell.renders.find((x) => x.id === pin.id);
    return r ? [{ pin, key, title: nameOf(r), sub: "Render", render: r }] : [];
  }).filter((row) => !hidden(row.key)));
  // Anything waiting out its Undo is gone from here too, and back the moment Undo is pressed.
  const songsShown = $derived(shell.songs.filter((x) => !hidden(`song:${x.id}`)));
  const rendersShown = $derived(shell.renders.filter((x) => !hidden(`render:${x.id}`)));
  const albumsShown = $derived(shell.albums.filter((x) => !hidden(`album:${x.id}`)));
  const playlistsShown = $derived(shell.playlists.filter((x) => !hidden(`playlist:${x.id}`)));
  const fold = (key: string) => { folded = { ...folded, [key]: !folded[key] }; store.set("jriter.rail.folded", folded); };

  const who = $derived(me()?.name || app.name);
  let avatar = $state<string | null>(null);
  let channel = $state<string | null>(null);

  // The connected channel, if there is one: the big line is whoever you are to the
  // outside world, because that is the one you would check before posting something.
  $effect(() => {
    if (!has("youtube")) return;
    get("/api/youtube/account").then((said) => {
      const account = (said.accounts || []).find((a: any) => a.id === said.chosen) || (said.accounts || [])[0];
      if (!account) return;
      channel = account.name || null;
      if (account.has_avatar) {
        const picture = new Image();
        picture.onload = () => { avatar = "/api/youtube/avatar"; };
        picture.src = "/api/youtube/avatar";
      }
    }).catch(() => { /* not news worth a toast on the way in */ });
  });

  async function playAlbum(album: Album) {
    const data = await attempt(() => get(`/api/albums/${album.id}`));
    const list = data?.songs;
    if (!list?.length) { toast("That album has no songs in it yet."); return; }
    playSong(list[0], list);
  }
  const albumMenu = (album: Album) => () => [
    { group: album.title },
    pinItem("album", album.id as number),
    { label: "Open", icon: "album", run: () => go(href.album(album.id)) },
    { label: "Play it through", icon: "play", run: () => playAlbum(album) },
  ];
  const playlistMenu = (p: Playlist) => () => [
    { group: p.title },
    pinItem("playlist", p.id as number),
    { label: "Open", icon: "playlist", run: () => go(href.playlist(p.id)) },
  ];
</script>

<nav class="rail glass" aria-label="Main" use:asPane>
  <div class="top">
    <a class="wordmark" href={href.library()} onclick={onnavigate} aria-label="Library">
      <!-- The quarter rest, drawn rather than typed: nothing in the display stack carries
           U+1D13D, least of all a face somebody uploaded themselves. -->
      <svg class="rest" viewBox="0 0 12 30" width="9" height="22" aria-hidden="true" focusable="false">
        <path d="M8.5 2 L3.5 9.5 L8.5 15 L3.5 21" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M3.5 21c3.2.6 4.9 2.4 4.9 4.6 0 1.6-1 2.6-2.4 2.6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>
      </svg>
      <span class="truncate">{app.name}</span>
    </a>
  </div>

  <div class="places">
    {#each places as place (place.key)}
      <a class="place" class:on={place.on} class:docked={place.key === "library" || place.key === "inbox"} href={place.to} onclick={onnavigate} aria-current={place.on ? "page" : undefined}>
        <Icon name={place.icon} size={18} />
        <span class="grow truncate">{place.label}</span>
        {#if place.badge}<span class="badge hot">{place.badge}</span>{/if}
      </a>
    {/each}
  </div>

  <div class="lists">
  <div class="scroll">
    {#if pinned.length}
      <!-- Pinned: anything, mixed, in the order it was pinned. Always open. -->
      <section>
        <div class="heading"><span class="fixed-head"><Icon name="pin" size={12} /><span>Pinned</span></span></div>
        {#each pinned as row (row.key)}
          {#if row.render}
            {@const sounding = player.song?.id === (`render:${row.render.id}` as unknown)}
            <button class="short render" class:on={sounding} type="button" onclick={() => (sounding ? toggle() : playRender(row.render))}
                    use:contextMenu={() => renderMenu(row.render)}>
              <span class="wave" style:--wave-hue={hue(row.title)}><Icon name={sounding && player.playing ? "pause" : "wave"} size={15} /></span>
              <span class="truncate"><span class="t truncate">{row.title}</span><span class="s truncate">{row.sub}</span></span>
            </button>
          {:else}
            <a class="short" href={row.href} onclick={onnavigate}
               class:on={(row.song && route.view === "song" && route.params.id === String(row.song.id)) || (row.album && route.view === "album" && route.params.id === String(row.album.id)) || (row.playlist && route.view === "playlist" && route.params.id === String(row.playlist.id))}
               use:contextMenu={row.song ? () => songMenu(row.song) : row.album ? albumMenu(row.album) : playlistMenu(row.playlist)}>
              {#if row.playlist}<PlaylistArt title={row.title} behind={behindOf(row.playlist)} size={30} radius="7px" />
              {:else if row.album}<AlbumArt album={row.album} url={row.cover} title={row.title} size={30} small />
              {:else}<Cover url={row.cover} title={row.title} size={30} />{/if}
              <span class="truncate"><span class="t truncate">{row.title}</span><span class="s truncate">{row.sub}</span></span>
            </a>
          {/if}
        {/each}
      </section>
    {/if}

    <section>
      <div class="heading">
        <button class="fold" onclick={() => fold("songs")} aria-expanded={!folded.songs}>
          <Icon name={folded.songs ? "chev-right" : "chev-down"} size={12} stroke={2.4} />
          <span>Songs</span>
        </button>
        <a class="all" href={href.library()} onclick={onnavigate} title="All songs">All</a>
        <button class="icon-btn sm" title="New song" aria-label="New song" onclick={newSong}><Icon name="plus" size={14} /></button>
      </div>
      {#if !folded.songs}
        {#each songsShown.slice(0, 40) as s (s.id)}
          <a class="short" class:on={route.view === "song" && route.params.id === String(s.id)} href={href.song(s.id)} onclick={onnavigate}
             use:contextMenu={() => songMenu(s)}>
            <Cover url={songCover(s)} title={s.title} size={30} />
            <span class="truncate">
              <span class="t truncate">{s.title}</span>
              <span class="s truncate">{(s as any).version_count ? plural((s as any).version_count, "render") : "no renders yet"}</span>
            </span>
          </a>
        {:else}
          <p class="none">No songs yet.</p>
        {/each}
      {/if}
    </section>

    {#if has("renders")}
      <!-- Renders still waiting to be told which song they are: the newest few, playable
           from here, the rest in the inbox. -->
      <section>
        <div class="heading">
          <button class="fold" onclick={() => fold("renders")} aria-expanded={!folded.renders}>
            <Icon name={folded.renders ? "chev-right" : "chev-down"} size={12} stroke={2.4} />
            <span>Renders</span>
          </button>
          <a class="all" href={href.inbox()} onclick={onnavigate} title="Everything in the inbox">{shell.waiting > shell.renders.length ? `All ${shell.waiting}` : "Inbox"}</a>
        </div>
        {#if !folded.renders}
          {#each rendersShown as r (r.id)}
            {@const sounding = player.song?.id === (`render:${r.id}` as unknown)}
            <button class="short render" class:on={sounding} type="button" title="Play {nameOf(r)}"
                    onclick={() => (sounding ? toggle() : playRender(r, shell.renders))} use:contextMenu={() => renderMenu(r, shell.renders)}>
              <span class="wave" class:playing={sounding && player.playing} style:--wave-hue={hue(nameOf(r))}>
                <Icon name={sounding && player.playing ? "pause" : "wave"} size={15} />
              </span>
              <span class="truncate">
                <span class="t truncate">{nameOf(r)}</span>
                <span class="s truncate">{r.duration ? time(r.duration) + " · " : ""}{r.created_at ? when(r.created_at) : "waiting"}</span>
              </span>
            </button>
          {:else}
            <p class="none">Nothing waiting. Drop a render on the app or set up a watched folder.</p>
          {/each}
        {/if}
      </section>
    {/if}

    {#if has("albums")}
      <section>
        <div class="heading">
          <button class="fold" onclick={() => fold("albums")} aria-expanded={!folded.albums}>
            <Icon name={folded.albums ? "chev-right" : "chev-down"} size={12} stroke={2.4} />
            <span>Albums</span>
          </button>
          <a class="all" href={href.library("albums")} onclick={onnavigate} title="All albums">All</a>
          <button class="icon-btn sm" title="New album" aria-label="New album" onclick={newAlbum}><Icon name="plus" size={14} /></button>
        </div>
        {#if !folded.albums}
          {#each albumsShown as album (album.id)}
            <a class="short" class:on={route.view === "album" && route.params.id === String(album.id)}
               href={href.album(album.id)} onclick={onnavigate} use:contextMenu={albumMenu(album)}>
              <AlbumArt {album} url={album.has_cover ? `/api/albums/${album.id}/cover` : null} title={album.title} size={30} small />
              <span class="truncate">
                <span class="t truncate">{album.title}</span>
                <span class="s truncate">{plural(album.song_count || 0, "song")}</span>
              </span>
            </a>
          {:else}
            <p class="none">No albums yet.</p>
          {/each}
        {/if}
      </section>
    {/if}

    {#if has("playlists")}
      <section>
        <div class="heading">
          <button class="fold" onclick={() => fold("playlists")} aria-expanded={!folded.playlists}>
            <Icon name={folded.playlists ? "chev-right" : "chev-down"} size={12} stroke={2.4} />
            <span>Playlists</span>
          </button>
          <a class="all" href={href.library("playlists")} onclick={onnavigate} title="All playlists">All</a>
          <button class="icon-btn sm" title="Start a playlist" aria-label="Start a playlist" onclick={newPlaylist}><Icon name="plus" size={14} /></button>
        </div>
        {#if !folded.playlists}
          {#each playlistsShown as p (p.id)}
            <a class="short" class:on={route.view === "playlist" && route.params.id === String(p.id)}
               href={href.playlist(p.id)} onclick={onnavigate} use:contextMenu={playlistMenu(p)}>
              <PlaylistArt title={p.title} behind={behindOf(p)} size={30} radius="7px" />
              <span class="truncate">
                <span class="t truncate">{p.title}</span>
                <span class="s truncate">{plural(p.count || 0, "item")}</span>
              </span>
            </a>
          {:else}
            <p class="none">No playlists yet. They can mix songs and loose renders.</p>
          {/each}
        {/if}
      </section>
    {/if}
  </div>
  <!-- The edges of the list blur gradually rather than stopping: three layers, each a
       stronger blur over a shorter reach, so what scrolls under an edge goes soft before it
       goes. Inside the rail, so what they blur is the list, not the page. -->
  <div class="haze top" aria-hidden="true"><i></i><i></i><i></i></div>
  <div class="haze bottom" aria-hidden="true"><i></i><i></i><i></i></div>
  </div>

  <div class="foot">
    {#if isGuest()}
      <!-- A guest: the same row, with a dashed ring where a face would be (nobody is signed
           in), and the two ways to become somebody right under it. -->
      <a class="account" class:on={route.view === "settings"} href={href.settings("account")} onclick={onnavigate}
         title="Your guest library lives in this browser only">
        <span class="avatar guest" aria-hidden="true"><Icon name="user" size={15} /></span>
        <span class="grow truncate">
          <span class="t truncate">Guest</span>
          <span class="s truncate">Saved in this browser only</span>
        </span>
      </a>
      <div class="join">
        <a class="btn sm primary" href="/login">Sign in</a>
        <a class="btn sm ghost" href="/login?new">Make an account</a>
      </div>
      <!-- Or don't be a guest anywhere: JR!TER on a machine of your own. -->
      <a class="place ownlink" href={href.own()} onclick={onnavigate}>
        <Icon name="server" size={16} /><span class="grow truncate">Run your own JR!TER</span><Icon name="chev-right" size={14} />
      </a>
    {:else}
      <a class="account" class:on={route.view === "settings"} href={href.settings()} onclick={onnavigate} title="Settings and account">
        <span class="avatar" style:background-image={avatar ? `url("${avatar}")` : undefined}>
          {#if !avatar}{(channel || who || "?").trim()[0]?.toUpperCase()}{/if}
        </span>
        <span class="grow truncate">
          <span class="t truncate">{channel || who}</span>
          <span class="s truncate">{channel ? who : "Settings"}</span>
        </span>
      </a>
    {/if}
    <div class="meta">
      <a href={FOYER} title="Back to Foyer, the front door of this server">Foyer</a>
      <button class="keyslink" onclick={() => (shell.keys = true)} title="Keyboard shortcuts">Keys</button>
      <a href="/legal" target="_blank" rel="noopener" title="Terms and privacy">Terms</a>
      <span class="grow"></span>
      {#if app.version}
        <span class="version" title={app.summary.updater?.commit ? "commit " + app.summary.updater.commit : ""}>v{app.version}</span>
      {/if}
    </div>
  </div>
</nav>

<style>
  .rail {
    width: var(--rail-w); height: 100%;
    display: flex; flex-direction: column; gap: var(--s2);
    padding: var(--s3); border-radius: var(--r-xl);
  }
  .top { padding: var(--s2) var(--s2) 2px; }
  .wordmark {
    display: flex; align-items: center; gap: var(--s2);
    font: 800 19px/1 var(--display); letter-spacing: 0.02em; color: var(--text);
  }
  .rest { color: var(--accent-text); flex: none; }

  .places { display: flex; flex-direction: column; gap: 2px; margin-top: var(--s2); }
  .place {
    display: flex; align-items: center; gap: var(--s3); height: 38px; padding: 0 var(--s3);
    border-radius: var(--r-md); color: var(--text-2); font-weight: 600;
    transition: background var(--fast), color var(--fast);
  }
  .place:hover { background: var(--hover); color: var(--text); }
  .place.on {
    background: color-mix(in srgb, var(--text) 11%, transparent); color: var(--text);
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.08);
  }
  .place.on :global(svg) { color: var(--accent-text); }

  .lists { position: relative; flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; margin: 0 calc(var(--s3) * -1); }
  .scroll { flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: var(--s3) var(--s3) var(--s5);
            mask-image: linear-gradient(to bottom, transparent 0, #000 22px, #000 calc(100% - 26px), transparent 100%); }
  .haze { position: absolute; left: 0; right: 0; height: 30px; pointer-events: none; }
  .haze.top { top: 0; }
  .haze.bottom { bottom: 0; transform: scaleY(-1); }
  .haze i { position: absolute; inset: 0; }
  .haze i:nth-child(1) { backdrop-filter: blur(1px); -webkit-backdrop-filter: blur(1px);
    mask-image: linear-gradient(to bottom, #000 0 55%, transparent); }
  .haze i:nth-child(2) { backdrop-filter: blur(3px); -webkit-backdrop-filter: blur(3px);
    mask-image: linear-gradient(to bottom, #000 0 30%, transparent 70%); }
  .haze i:nth-child(3) { backdrop-filter: blur(7px); -webkit-backdrop-filter: blur(7px);
    mask-image: linear-gradient(to bottom, #000 0 12%, transparent 42%); }
  section { margin-top: var(--s3); }
  .heading { display: flex; align-items: center; gap: 2px; height: 30px; padding-left: var(--s1); }
  .fold {
    display: flex; align-items: center; gap: var(--s2); flex: 1 1 auto; height: 100%;
    font: 600 var(--t-xs)/1 var(--font);
    color: var(--text-3); text-align: left;
  }
  .fold:hover { color: var(--text-2); }
  .all { font: 600 var(--t-xs)/1 var(--font); color: var(--text-3); padding: var(--s2); border-radius: 6px; opacity: 0; transition: opacity var(--fast); }
  .heading:hover .all, .all:focus-visible { opacity: 1; }
  /* A touch screen has no hover, so the link that only appears on hover would never appear. */
  @media (hover: none) { .all { opacity: 1; } }
  .all:hover { color: var(--text); }
  .short {
    display: flex; align-items: center; gap: var(--s3); padding: var(--s1) var(--s2); border-radius: var(--r-sm);
    transition: background var(--fast);
  }
  .short:hover { background: var(--hover); }
  .fixed-head { display: inline-flex; align-items: center; gap: var(--s2); }
  button.short { width: 100%; text-align: left; }
  /* A render has no cover: a waveform tile in its place, the size a cover would be. */
  /* Each render in its own colour, the hue hashed from its name: the same one its wave has
     in the inbox and on the Takes tab, so it is recognisable wherever it shows up. */
  .wave { width: 30px; height: 30px; flex: none; display: grid; place-items: center; border-radius: 8px;
          background: hsl(var(--wave-hue, 150) 40% 22%); color: hsl(var(--wave-hue, 150) 80% 72%);
          box-shadow: inset 0 0 0 1px hsl(var(--wave-hue, 150) 60% 50% / 0.25); }
  .wave.playing { background: hsl(var(--wave-hue, 150) 55% 34%); color: #fff; }
  .short.on { background: color-mix(in srgb, var(--text) 11%, transparent); }
  .short .t, .account .t { display: block; font-size: var(--t-sm); font-weight: 600; }
  .short .s, .account .s { display: block; font-size: var(--t-xs); color: var(--text-3); }
  .none { padding: var(--s1) var(--s2) var(--s2); font-size: var(--t-sm); color: var(--text-3); }

  .foot { display: flex; flex-direction: column; gap: var(--s2); }
  .account {
    display: flex; align-items: center; gap: var(--s3); padding: var(--s2) var(--s2); border-radius: var(--r-md);
    color: var(--text-2); transition: background var(--fast), color var(--fast);
  }
  .account:hover, .account.on { background: var(--hover); color: var(--text); }
  .account .t { color: var(--text); }
  .avatar {
    width: 30px; height: 30px; border-radius: 50%; flex: none;
    display: grid; place-items: center; font: 600 13px/1 var(--font);
    background: var(--accent-soft) center/cover; color: var(--accent-text);
    box-shadow: inset 0 0 0 1px var(--accent-line);
  }
  .avatar.guest { background: transparent; color: var(--text-3); box-shadow: none; border: 1.5px dashed color-mix(in srgb, var(--text) 32%, transparent); }
  .join { display: flex; gap: var(--s2); padding: 0 var(--s2); }
  .join .btn { flex: 1 1 auto; justify-content: center; white-space: nowrap; }
  .meta { display: flex; align-items: center; gap: var(--s3); padding: 0 var(--s2) 2px; font-size: var(--t-xs); color: var(--text-3); }
  .meta a:hover, .meta button:hover { color: var(--text); }
  .meta button { font-size: inherit; color: inherit; }
  .version { font-variant-numeric: tabular-nums; }
  /* The phone drawer: the tab bar already has Library, Inbox and Settings, and "+" up top
     makes things, so the drawer keeps only what is its own (shared, pinned, songs,
     renders) plus who you are. No keyboard on a phone, so no "Keys". */
  :global(html[data-narrow]) .place.docked, :global(html[data-narrow]) .keyslink { display: none; }
  .ownlink { margin-top: var(--s1); color: var(--text-2); font-size: var(--t-sm); }
  /* Light: the place you are on stands up out of the pane. */
  :global(html[data-theme="light"]) .place.on { background: var(--bg); box-shadow: var(--neu-out-sm); }
  /* Light: no fading haze (it needs glass to blur). The lists sit in a groove pressed into
     the pane instead, rounded, and scroll inside it, so the edge says where they end. */
  :global(html[data-theme="light"]) .haze { display: none; }
  :global(html[data-theme="light"]) .lists {
    margin: var(--s2) 0 var(--s2); border-radius: var(--r-lg); overflow: hidden;
    background: var(--bg); box-shadow: var(--neu-in);
  }
  :global(html[data-theme="light"]) .lists .scroll { padding: var(--s2) var(--s2) var(--s3); mask-image: none; }
</style>
