<!-- The shell: the ground, the sidebar, the bar across the top, whichever screen is open,
     and the player. Everything floats: each pane is glass sitting a gap off the edges and
     off its neighbours, and the screen scrolls underneath the top bar and the player.

     On a phone the sidebar is a drawer and its places move to a tab bar at the bottom,
     under the player, where a thumb already is. -->
<script lang="ts">
  import type { Component } from "svelte";
  import { tick } from "svelte";
  import { fade, fly } from "svelte/transition";
  import { cubicOut } from "svelte/easing";

  import Ground from "./Ground.svelte";
  import Sidebar from "./Sidebar.svelte";
  import EdgeDrawer from "./EdgeDrawer.svelte";
  import PlayerBar from "./PlayerBar.svelte";
  import NowPlaying from "./NowPlaying.svelte";
  import Palette from "./Palette.svelte";
  import KeysSheet from "./KeysSheet.svelte";
  import SheetHost from "$ui/SheetHost.svelte";
  import MenuHost from "$ui/MenuHost.svelte";
  import Toasts from "$ui/Toasts.svelte";
  import TooltipHost from "$ui/TooltipHost.svelte";
  import Icon from "$ui/Icon.svelte";

  import Library from "../views/Library.svelte";
  import Song from "../views/Song.svelte";
  import Album from "../views/Album.svelte";
  import Playlist from "../views/Playlist.svelte";
  import Inbox from "../views/Inbox.svelte";
  import Settings from "../views/Settings.svelte";
  import Share from "../views/Share.svelte";
  import Join from "../views/Join.svelte";
  import Orarend from "../views/Orarend.svelte";
  import OwnServer from "../views/OwnServer.svelte";
  import Grave from "../views/Grave.svelte";

  import { app, has, ownsTheMachine } from "$lib/app.svelte";
  import { router, go, href, type View } from "$lib/router.svelte";
  import { arriving } from "$lib/look.svelte";
  import { on } from "$lib/bus";
  import { layerPop } from "$lib/back.svelte";
  import { get } from "$lib/api";
  import { sheet, sheets, anySheetOpen } from "$lib/dialog.svelte";
  import { menu, showMenu } from "$lib/menu.svelte";
  import { addCommands } from "$lib/commands";
  import { newSong, newAlbum, newPlaylist, updateNow } from "$lib/actions";
  import { toast } from "$lib/toast.svelte";
  import {
    player, toggle, swap, step, seekTo, seek, now, toggleMute, cycleRepeat, REPEAT_SAYS, stopAndClear,
  } from "$lib/player.svelte";
  import { pane } from "$lib/glass/glass.svelte";
  import { shell, watchNarrow, toggleRail, openPalette, refreshWaiting, refreshAlbums, refreshSongs, refreshPlaylists } from "./state.svelte";

  const VIEWS: Partial<Record<View, Component<{ params: Record<string, string> }>>> = {
    library: Library, song: Song, album: Album, playlist: Playlist, inbox: Inbox,
    settings: Settings, share: Share, join: Join, orarend: Orarend, own: OwnServer, grave: Grave,
  };
  // Screens that want the whole width and nothing beside them.
  const ROOMY: View[] = ["orarend", "join"];

  const route = $derived(router.route);
  const Screen = $derived(VIEWS[route.view]);
  // The same screen with a different tab or filter is the same screen: it must not be
  // torn down and rebuilt, or every keystroke in a search box would blink the list.
  const key = $derived(`${route.view}:${route.params.id || route.params.token || ""}:${route.params.share || ""}`);
  const roomy = $derived(ROOMY.includes(route.view));
  const railShown = $derived(!shell.narrow && !shell.railShut && !roomy);

  // ── scroll: top on arrival, where you were on the way back ─────────────────
  let scroller = $state<HTMLElement>();
  const places = new Map<string, number>();
  let viaHistory = false;
  let lastKey = "";
  let lastHash = "";

  $effect(() => {
    // A layer closing on Back (lib/back) is not navigation.
    const onpop = () => { if (!layerPop()) viaHistory = true; };
    window.addEventListener("popstate", onpop);
    return () => window.removeEventListener("popstate", onpop);
  });

  $effect.pre(() => {
    // Before the DOM changes: remember where the screen being left had got to.
    void key;
    if (scroller && lastHash) places.set(lastHash, scroller.scrollTop);
  });

  $effect(() => {
    const view = route.view;
    const hash = route.hash;
    const arrivingKey = key;
    arriving(view);
    if (shell.narrow) shell.drawer = false;
    if (arrivingKey === lastKey) { lastHash = hash; return; }
    lastKey = arrivingKey;
    lastHash = hash;
    const back = viaHistory;
    viaHistory = false;
    const target = back ? places.get(hash) || 0 : 0;
    tick().then(() => {
      if (!scroller) return;
      scroller.scrollTop = target;
      if (!target) return;
      // The screen fills in as its fetches land, so the place somebody was at may not
      // exist yet. Keep trying for a moment, and stop the instant they scroll themselves.
      let tries = 0;
      let mine = true;
      const stop = () => { mine = false; };
      scroller.addEventListener("wheel", stop, { once: true, passive: true });
      scroller.addEventListener("touchstart", stop, { once: true, passive: true });
      const again = () => {
        if (!mine || !scroller || lastKey !== arrivingKey) return;
        if (Math.abs(scroller.scrollTop - target) > 2) scroller.scrollTop = target;
        if (++tries < 90 && scroller.scrollHeight - scroller.clientHeight < target) requestAnimationFrame(again);
      };
      requestAnimationFrame(again);
    });
  });

  // ── what the sidebar shows ────────────────────────────────────────────────
  $effect(() => {
    refreshWaiting(); refreshAlbums(); refreshPlaylists(); refreshSongs();
    const stops = [
      on("renders:changed", refreshWaiting),
      on("albums:changed", refreshAlbums),
      on("playlists:changed", refreshPlaylists),
      on("songs:changed", () => { refreshAlbums(); refreshSongs(); }),
      on("versions:changed", refreshSongs),
    ];
    // The desktop agent adds to the inbox by itself, so look again whenever the tab
    // comes back to the front rather than only when this page changed something.
    const onshow = () => { if (!document.hidden) refreshWaiting(); };
    document.addEventListener("visibilitychange", onshow);
    return () => { stops.forEach((stop) => stop()); document.removeEventListener("visibilitychange", onshow); };
  });

  $effect(() => watchNarrow());

  // A quiet check on startup. Nothing interrupts: it puts a small "Update ready" in the
  // top bar and says nothing otherwise. Only for the owner, the one person the server
  // lets press it.
  $effect(() => {
    if (!has("updater") || app.settings.auto_update === false || !ownsTheMachine()) return;
    const timer = setTimeout(async () => {
      try {
        const info = await get("/api/update/check");
        // Only when it can actually be applied: a checkout with local changes can't pull,
        // and a banner for an update that will refuse is just noise on every start.
        if (info.update_available && info.can_update) { shell.updateReady = true; shell.updateNote = info.message || ""; }
      } catch { /* offline is not worth a toast on every start */ }
    }, 2500);
    return () => clearTimeout(timer);
  });

  let updating = $state(false);
  async function update() {
    if (updating) return;
    updating = true;
    const result = await updateNow();
    updating = false;
    if (result === "current") shell.updateReady = false;
  }

  function showKeys() {
    if (anySheetOpen()) return;
    shell.keys = true;
  }
  $effect(() => {
    if (!shell.keys) return;
    sheet({ title: "Keyboard", sub: "Anywhere that is not a text field.", confirm: "", cancel: "Close", wide: true, body: KeysSheet })
      .then(() => { shell.keys = false; });
  });

  function newMenu(e: MouseEvent) {
    showMenu([
      { label: "New song", icon: "songs", hint: "N", run: newSong },
      has("albums") ? { label: "New album", icon: "album", run: newAlbum } : null,
      has("playlists") ? { label: "New playlist", icon: "playlist", run: newPlaylist } : null,
      has("renders") ? { divider: true } : null,
      has("renders") ? { label: "Upload renders…", icon: "upload", run: () => go(href.inbox() + "?upload=1") } : null,
    ], { anchor: e.currentTarget as Element });
  }

  // ── commands the palette always has ───────────────────────────────────────
  $effect(() => addCommands(() => {
    const out = [
      { id: "go.library", group: "Go to", title: "Library", icon: "library", hint: "G L", run: () => go(href.library()) },
      has("albums") ? { id: "go.albums", group: "Go to", title: "Albums", icon: "album", run: () => go(href.library("albums")) } : null,
      has("playlists") ? { id: "go.playlists", group: "Go to", title: "Playlists", icon: "playlist", run: () => go(href.library("playlists")) } : null,
      has("renders") || has("sync") ? { id: "go.inbox", group: "Go to", title: "Inbox", sub: shell.waiting ? `${shell.waiting} waiting` : undefined, icon: "inbox", hint: "G I", keywords: "renders bounces waiting", run: () => go(href.inbox()) } : null,
      has("sync") && ownsTheMachine() ? { id: "go.sources", group: "Go to", title: "Watched folders", icon: "folder", keywords: "sync sources folders", run: () => go(href.inbox("sources")) } : null,
      has("sharing") ? { id: "go.shared", group: "Go to", title: "Shared with me", icon: "share", run: () => go(href.library("shared")) } : null,
      has("grave") ? { id: "go.grave", group: "Go to", title: "Grave", sub: "deleted things, for a while", icon: "trash", keywords: "trash bin deleted restore undo", run: () => go(href.grave()) } : null,
      { id: "go.settings", group: "Go to", title: "Settings", icon: "settings", hint: "G S", keywords: "preferences account appearance", run: () => go(href.settings()) },
      has("orarend") ? { id: "go.orarend", group: "Go to", title: "Órarend", sub: "the timetable", icon: "calendar", keywords: "timetable week classes", run: () => go("/orarend") } : null,
      player.song && player.song.kind !== "render" ? { id: "go.playing", group: "Go to", title: "The song that is playing", sub: player.song.title, icon: "songs", hint: "G P", run: () => go(href.song(player.song!.id)) } : null,

      { id: "new.song", group: "Create", title: "New song", icon: "plus", hint: "N", run: newSong },
      has("albums") ? { id: "new.album", group: "Create", title: "New album", icon: "plus", run: newAlbum } : null,
      has("playlists") ? { id: "new.playlist", group: "Create", title: "New playlist", icon: "plus", run: newPlaylist } : null,
      has("renders") ? { id: "new.upload", group: "Create", title: "Upload renders", icon: "upload", keywords: "bounce audio file add", run: () => go(href.inbox() + "?upload=1") } : null,

      player.song ? { id: "p.toggle", group: "Player", title: player.playing ? "Pause" : "Play", icon: player.playing ? "pause" : "play", hint: "Space", run: toggle } : null,
      player.song ? { id: "p.next", group: "Player", title: "Next", icon: "next", hint: "Shift →", run: () => step(1) } : null,
      player.song ? { id: "p.prev", group: "Player", title: "Previous", icon: "prev", hint: "Shift ←", run: () => step(-1) } : null,
      player.song ? { id: "p.swap", group: "Player", title: "Swap A and B", icon: "compare", hint: "X", run: swap } : null,
      player.song ? { id: "p.queue", group: "Player", title: "Show the queue", icon: "queue", hint: "Q", run: () => { shell.nowPlaying = true; } } : null,
      { id: "p.repeat", group: "Player", title: "Change repeat", sub: REPEAT_SAYS[player.repeat].toLowerCase(), icon: "repeat", hint: "R", run: () => { toast(REPEAT_SAYS[cycleRepeat()] + "."); } },
      player.song ? { id: "p.clear", group: "Player", title: "Stop and clear the player", icon: "close", run: stopAndClear } : null,

      { id: "app.sidebar", group: "App", title: shell.railShut ? "Show the sidebar" : "Hide the sidebar", icon: "sidebar", hint: "[", run: toggleRail },
      { id: "app.keys", group: "App", title: "Keyboard shortcuts", icon: "command", hint: "?", run: showKeys },
      shell.updateReady ? { id: "app.update", group: "App", title: "Update now", sub: shell.updateNote, icon: "download", run: update } : null,
      { id: "app.foyer", group: "App", title: "Back to Foyer", sub: "the front door of this server", icon: "door", run: () => { location.assign("/foyer"); } },
    ];
    return out.filter(Boolean) as NonNullable<(typeof out)[number]>[];
  }));

  // ── the keyboard ──────────────────────────────────────────────────────────
  let chord = 0;      // when G was pressed, for the two key "go to" shortcuts

  /** The rows j and k move through: the items of any list on the page ([data-rows]). */
  const rowsHere = () => [...document.querySelectorAll<HTMLElement>("#scroller [data-rows] > *")]
    .filter((r) => r.offsetParent !== null);
  const currentRow = () => rowsHere().find((r) => r.contains(document.activeElement)) ?? null;
  function stepRow(by: number) {
    const rows = rowsHere();
    if (!rows.length) return;
    const at = rows.findIndex((r) => r.contains(document.activeElement));
    const next = rows[at < 0 ? (by > 0 ? 0 : rows.length - 1) : Math.max(0, Math.min(rows.length - 1, at + by))];
    const into = next.matches("a, button, [tabindex]") ? next : next.querySelector<HTMLElement>("a, button, [tabindex]:not([tabindex='-1'])");
    const el = into ?? next;
    if (!into) el.tabIndex = -1;
    el.focus({ preventScroll: true });
    el.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  function onkey(e: KeyboardEvent) {
    const target = e.target as HTMLElement;
    const typing = !!target.closest?.("input, textarea, select, [contenteditable]");

    if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === "k") {
      e.preventDefault();
      if (shell.palette) shell.palette = false; else openPalette();
      return;
    }
    if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
    // A key does one thing, and the thing nearest the hand wins. With a dialog, a menu
    // or the palette open, the page behind is not listening.
    if (menu.open || anySheetOpen() || shell.palette) return;
    if (e.defaultPrevented) return;

    const k = e.key;
    if (k === "/") { e.preventDefault(); openPalette(); return; }
    if (k === "?") { e.preventDefault(); showKeys(); return; }

    if (chord && performance.now() - chord < 900) {
      chord = 0;
      const to = ({ l: href.library(), i: href.inbox(), s: href.settings(),
                    p: player.song && player.song.kind !== "render" ? href.song(player.song.id) : "" } as Record<string, string>)[k.toLowerCase()];
      if (to) { e.preventDefault(); go(to); return; }
    }
    if (chord && k === "g") { chord = 0; e.preventDefault(); scroller?.scrollTo({ top: 0, behavior: "smooth" }); return; }
    if (k === "g") { chord = performance.now(); return; }
    // Vim-style, so the keyboard alone gets everywhere: j and k move down and up a list,
    // l (or Enter) opens the row you're on, h goes back, gg to the top, G to the bottom.
    if (k === "G") { e.preventDefault(); scroller?.scrollTo({ top: scroller.scrollHeight, behavior: "smooth" }); return; }
    if (k === "j" || k === "k") { e.preventDefault(); stepRow(k === "j" ? 1 : -1); return; }
    if (k === "l") { const row = currentRow(); if (row) { e.preventDefault(); (row.matches("a, button") ? row : row.querySelector<HTMLElement>("a, button"))?.click(); } return; }
    // h goes up a level where the page says what that is (its ‹ link), else back.
    if (k === "h") { e.preventDefault(); const up = document.querySelector<HTMLAnchorElement>("#scroller [data-up]"); if (up) up.click(); else history.back(); return; }

    // Space on something that has its own answer for Space belongs to that thing.
    const pressable = !!target.closest?.("button, a, [role=button], [role=slider], [role=option], [role=radio], [role=switch], [tabindex]:not([tabindex='-1'])");
    if (k === " ") {
      if (pressable) return;
      e.preventDefault(); toggle(); return;
    }
    if (k === "x" || k === "X") { e.preventDefault(); swap(); return; }
    if (k === "m" || k === "M") { e.preventDefault(); toggleMute(); return; }
    if (k === "q" || k === "Q") { if (player.song) { e.preventDefault(); shell.nowPlaying = !shell.nowPlaying; } return; }
    if (k === "r" || k === "R") { e.preventDefault(); toast(REPEAT_SAYS[cycleRepeat()] + "."); return; }
    if (k === "n" || k === "N") { e.preventDefault(); newSong(); return; }
    if (k === "[") { e.preventDefault(); toggleRail(); return; }

    if (k === "ArrowRight" && e.shiftKey) { e.preventDefault(); step(1); return; }
    if (k === "ArrowLeft" && e.shiftKey) { e.preventDefault(); step(-1); return; }
    // Plain arrows and digits move through the song, unless focus is somewhere that
    // uses them itself: a row in a list, a slider, a tab.
    if (pressable || !player.song) return;
    if (k === "ArrowRight") { e.preventDefault(); seekTo(Math.min(player.duration, now() + 5)); return; }
    if (k === "ArrowLeft") { e.preventDefault(); seekTo(Math.max(0, now() - 5)); return; }
    if (/^[0-9]$/.test(k)) { e.preventDefault(); seek(Number(k) / 10); }
  }

  const tabs = $derived([
    { key: "library", label: "Library", icon: "library", to: href.library(), on: route.view === "library" || route.view === "album" || route.view === "playlist" || route.view === "song" },
    has("renders") || has("sync") ? { key: "inbox", label: "Inbox", icon: "inbox", to: href.inbox(), on: route.view === "inbox", badge: shell.waiting } : null,
    { key: "search", label: "Search", icon: "search", to: "", on: false },
    { key: "settings", label: "Settings", icon: "settings", to: href.settings(), on: route.view === "settings" },
  ].filter(Boolean) as { key: string; label: string; icon: string; to: string; on: boolean; badge?: number }[]);
</script>

<svelte:window onkeydown={onkey} />

<Ground />

<div id="shell" class:rail-shown={railShown} class:narrow={shell.narrow} class:playing={!!player.song} class:roomy
     class:behind={shell.palette || shell.drawer || sheets.stack.length > 0}>
  {#if !shell.narrow}
    <aside class="rail" inert={!railShown}><Sidebar /></aside>
  {/if}

  <main class="main">
    {#if !roomy}
      <header class="top">
        <button use:pane class="icon-btn glass round" onclick={toggleRail} title="{shell.narrow ? 'Menu' : railShown ? 'Hide the sidebar' : 'Show the sidebar'} ([)"
                aria-label="Sidebar" aria-pressed={shell.narrow ? shell.drawer : railShown}>
          <Icon name={shell.narrow ? "menu" : "sidebar"} size={18} />
        </button>
        <!-- On a phone the Search tab down in thumb reach is the search; up here it would be
             the same thing twice. -->
        {#if !shell.narrow}
        <button use:pane class="search glass" onclick={() => openPalette()} aria-label="Search and commands">
          <Icon name="search" size={16} />
          <span class="grow truncate">Search, or jump to anything</span>
          <span class="combo"><kbd>Ctrl</kbd><kbd>K</kbd></span>
        </button>
        {:else}<span class="grow"></span>{/if}
        {#if shell.updateReady}
          <button class="btn tint sm" onclick={update} disabled={updating} title={shell.updateNote || "Update now"} transition:fade={{ duration: 200 }}>
            {#if updating}<span class="spinner"></span>{:else}<Icon name="download" size={14} />{/if}
            <span>{updating ? "Updating" : "Update ready"}</span>
          </button>
        {/if}
        <button use:pane class="icon-btn glass round" onclick={newMenu} title="New…" aria-label="New"><Icon name="plus" size={18} /></button>
      </header>
    {/if}

    <div class="scroll" bind:this={scroller} id="scroller">
      {#key key}
        <div class="screen enter">
          {#if Screen}
            <svelte:boundary>
              <Screen params={route.params} />
              {#snippet failed(error, reset)}
                <div class="page"><div class="empty">
                  <Icon name="warning" size={30} />
                  <h3>This screen didn't load</h3>
                  <p>{(error as Error)?.message || String(error)}</p>
                  <button class="btn" onclick={reset}>Try again</button>
                </div></div>
              {/snippet}
            </svelte:boundary>
          {:else}
            <div class="page"><div class="empty">
              <h3>Nothing here</h3>
              <p>That page doesn't exist here. It might belong to a module that's turned off.</p>
              <a class="btn primary" href={href.library()}>Back to the library</a>
            </div></div>
          {/if}
        </div>
      {/key}
    </div>
  </main>

  <div class="dock">
    <PlayerBar />
    {#if shell.narrow && !roomy}
      <nav class="tabs glass" aria-label="Main" use:pane>
        {#each tabs as tab (tab.key)}
          {#if tab.key === "search"}
            <button class="tab tabsearch" onclick={() => openPalette()}><Icon name={tab.icon} size={21} /><span>{tab.label}</span></button>
          {:else}
            <a class="tab" class:on={tab.on} href={tab.to} aria-current={tab.on ? "page" : undefined}>
              <span class="tico"><Icon name={tab.icon} size={21} />{#if tab.badge}<span class="badge hot">{tab.badge}</span>{/if}</span>
              <span>{tab.label}</span>
            </a>
          {/if}
        {/each}
      </nav>
    {/if}
  </div>
</div>

<EdgeDrawer />

{#if shell.nowPlaying}<NowPlaying />{/if}
<Palette />
<SheetHost />
<MenuHost />
<Toasts />
<TooltipHost />

<style>
  /* No filter or opacity on #shell, ever: it is the ancestor of the sidebar's and the top
     bar's glass, and a filter on an ancestor cuts off what their blur can see for as long as
     it is there, transitions included (closing the search left the sidebar unblurred for a
     moment). The app behind the search, a sheet or the phone's sidebar is blurred by those
     overlays' own dim layer instead (a backdrop blur that fades itself). */
  #shell { position: fixed; inset: 0; z-index: 1; }

  .rail {
    position: absolute; z-index: 20;
    left: calc(var(--gap) + var(--safe-l)); top: calc(var(--gap) + var(--safe-t)); bottom: calc(var(--gap) + var(--safe-b));
    width: var(--rail-w);
    /* Slides, never fades: this wrapper is an ancestor of the sidebar's glass, and an
       ancestor's opacity below 1 cuts the blur off until it is back to 1. Hidden once it
       has slid out, so it is not tabbable or drawn off screen. */
    transform: translateX(calc(-100% - var(--gap) * 2)); visibility: hidden;
    transition: transform var(--sheet), visibility 0s linear 460ms;
  }
  .rail-shown .rail { transform: none; visibility: visible; transition: transform var(--sheet), visibility 0s; }

  .main {
    position: absolute; inset: 0; left: 0;
    transition: left var(--sheet);
  }
  .rail-shown .main { left: calc(var(--rail-w) + var(--gap) + var(--safe-l)); }

  /* The bar across the top is not a bar: three pieces of glass floating over the screen,
     which scrolls underneath them and fades out as it goes. */
  .top {
    position: absolute; z-index: 15; left: 0; right: 0; top: 0;
    display: flex; align-items: center; gap: var(--s2);
    padding: calc(var(--gap) + var(--safe-t)) calc(var(--gap) + var(--safe-r)) 0 var(--gap);
    height: calc(var(--top-h) + var(--safe-t)); pointer-events: none;
  }
  .top > :global(*) { pointer-events: auto; }
  /* Everything on the bar is the same glass as everything else (.glass in base.css); only
     the size and the pill shape are said here. The search takes all the room that is left. */
  .round { width: 40px; height: 40px; color: var(--text); }
  .round:hover { background: var(--glass-hover); }
  .search {
    /* The right padding is more than the keys need: the end of a pill curves in, and keys
       set as close to it as the left icon is to its end look jammed against the curve. */
    display: flex; align-items: center; gap: var(--s3); height: 40px; padding: 0 var(--s3) 0 var(--s4);
    flex: 1 1 0; min-width: 0;
    border-radius: var(--r-pill); color: var(--text-2); font-weight: 500; text-align: left;
    transition: background var(--fast), color var(--fast);
  }
  .search:hover { color: var(--text); background: var(--glass-hover); }
  .combo { display: flex; gap: var(--s1); flex: none; }

  /* The page scrolls BETWEEN the floating bars, never under them. Every pane of glass then
     has only the ground behind it, which the shader blurs and splits for real; page content
     passing under a pane could not be blurred without a backdrop-filter, and that is what
     flickered. The edges are soft so the content runs out rather than being cut. */
  .scroll {
    position: absolute; left: 0; right: 0; overflow-y: auto; overflow-x: hidden;
    /* The scrollbar's room is kept whether or not a screen is long enough to need it, so
       a short screen is not 7px wider than a long one and nothing shifts between them. */
    scrollbar-gutter: stable;
    /* Vertical panning is the browser's; a sideways drag is left to the page, which is
       how the phone drawer can follow a thumb (EdgeDrawer) instead of the browser taking
       the gesture and cancelling it. */
    touch-action: pan-y;
    top: calc(var(--top-h) + var(--gap) + var(--safe-t));
    bottom: calc(var(--gap) * 2 + var(--safe-b) + var(--tab-h) + var(--dock-extra, 0px));
    padding-top: 0; padding-bottom: var(--s4);
    scroll-padding-top: var(--gap);
    mask-image: linear-gradient(to bottom, transparent 0, #000 14px, #000 calc(100% - 14px), transparent 100%);
    overscroll-behavior: contain;
    transition: opacity 200ms var(--ease);
  }
  .roomy .scroll { top: var(--safe-t); mask-image: none; }
  .playing { --dock-extra: calc(var(--bar-h) + var(--gap)); }
  .screen { min-height: 100%; display: flex; flex-direction: column; }

  .dock {
    position: absolute; z-index: 25; pointer-events: none;
    left: var(--gap); right: calc(var(--gap) + var(--safe-r)); bottom: calc(var(--gap) + var(--safe-b));
    display: flex; flex-direction: column; gap: var(--gap);
    transition: left var(--sheet);
  }
  .dock > :global(*) { pointer-events: auto; }
  .rail-shown .dock { left: calc(var(--rail-w) + var(--gap) * 2 + var(--safe-l)); }

  .tabs {
    height: var(--tab-h); display: flex; align-items: stretch; padding: var(--s1); border-radius: var(--r-xl);
  }
  .tab {
    flex: 1 1 0; min-width: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px;
    border-radius: var(--r-lg); font: 600 var(--t-xs)/1 var(--font); color: var(--text-3);
    transition: color var(--fast), background var(--fast);
  }
  .tab.on { color: var(--accent-text); background: color-mix(in srgb, var(--text) 8%, transparent); }
  .tico { position: relative; }
  .tico .badge { position: absolute; top: -5px; left: 14px; min-width: 16px; height: 16px; font-size: var(--t-xs); padding: 0 var(--s1); }


  @media (max-width: 900px) {
    .search .combo { display: none; }
  }
  @media (prefers-reduced-motion: reduce) {
    .rail, .main, .dock { transition: none; }
  }
</style>
