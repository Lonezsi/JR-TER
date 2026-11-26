<!-- The palette. One box that finds anything in the library and runs anything the app can
     do. Ctrl+K or / opens it; typing searches songs, albums, playlists, lyrics, versions
     and renders on the server and commands here, at once. Start with > for commands only.

     The categories keep a fixed order rather than being ranked by their best hit: a list
     that reshuffles under the cursor on every keystroke is what makes a search box feel
     untrustworthy. -->
<script lang="ts">
  import Icon from "$ui/Icon.svelte";
  import { closesOnBack } from "$lib/back.svelte";
  import Cover from "$ui/Cover.svelte";
  import { get } from "$lib/api";
  import { has } from "$lib/app.svelte";
  import { allCommands, type Command } from "$lib/commands";
  import { go, href } from "$lib/router.svelte";
  import { playSong } from "$lib/player.svelte";
  import { debounce, fuzzy } from "$lib/util";
  import { shell } from "./state.svelte";
  import { songCover } from "../views/library/kinds";
  import { pane, leavePane } from "$lib/glass/glass.svelte";
  import { fade, fly } from "svelte/transition";
  import { tick } from "svelte";

  interface Row {
    key: string; title: string; sub?: string; line?: string; icon?: string; hint?: string;
    cover?: { url: string | null; title: string } | null;
    run: () => unknown;
    /** Shift+Enter, when a row has a second thing it can do. */
    alt?: () => unknown;
    altSays?: string;
    /** What pressing it does, which is what its icon says: goes somewhere, does something,
     *  or opens a thing (a song, an album: those show their cover). */
    kind?: "place" | "action" | "thing";
  }
  interface Group { label: string; rows: Row[]; note?: string }

  const ICONS: Record<string, string> = {
    song: "songs", album: "album", playlist: "playlist", lyric: "words",
    version: "wave", render: "inbox", artwork: "image",
  };

  let query = $state("");
  let found = $state<{ groups: any[]; looked_in: string[]; query: string } | null>(null);
  let searching = $state(false);
  let active = $state(0);
  let input = $state<HTMLInputElement>();
  let listNode = $state<HTMLElement>();
  let commands = $state<Command[]>([]);
  let token = 0;

  $effect(() => {
    if (!shell.palette) return;
    query = shell.paletteSeed;
    found = null;
    active = 0;
    commands = allCommands();
    tick().then(() => { input?.focus(); input?.select(); });
  });

  const onlyCommands = $derived(query.startsWith(">"));
  const term = $derived((onlyCommands ? query.slice(1) : query).trim());

  const ask = debounce(async (text: string) => {
    const mine = ++token;
    if (!text || !has("search")) { found = null; searching = false; return; }
    try {
      const data = await get(`/api/search?q=${encodeURIComponent(text)}&limit=6`);
      if (mine === token) found = data;
    } catch { if (mine === token) found = null; }
    finally { if (mine === token) searching = false; }
  }, 140);

  $effect(() => {
    if (!shell.palette) return;
    if (onlyCommands || !term) { token++; found = null; searching = false; ask.cancel(); return; }
    searching = has("search");
    ask(term);
  });

  function hitRow(group: any, hit: any): Row {
    const to = hit.href || (group.kind === "song" ? href.song(hit.id) : "#/");
    const base: Row = {
      key: `${group.kind}:${hit.id ?? hit.href}:${hit.line || ""}`,
      title: hit.title || "untitled", sub: hit.sub || (hit.was ? `was "${hit.was}"` : undefined), line: hit.line,
      icon: ICONS[group.kind] || "search", kind: "thing",
      run: () => go(to),
    };
    if (group.kind === "song") {
      base.cover = { url: hit.artwork_id ? `/api/artwork/${hit.artwork_id}/image` : null, title: hit.title };
      base.alt = () => { playSong(hit, group.hits); };
      base.altSays = "play";
    }
    if (group.kind === "album") base.cover = { url: hit.has_cover ? `/api/albums/${hit.id}/cover` : null, title: hit.title };
    if (group.kind === "playlist") base.cover = { url: null, title: hit.title };
    return base;
  }

  const groups = $derived.by<Group[]>(() => {
    const out: Group[] = [];
    const scored = commands
      .map((c) => ({ c, score: term ? fuzzy(term, `${c.title} ${c.keywords || ""} ${c.group || ""}`) : 0 }))
      .filter((x) => x.score >= 0)
      .sort((a, b) => b.score - a.score);
    // A command that only takes you somewhere is a place; anything else does something.
    const placeLike = (c: Command) => c.id.startsWith("go.") || /^settings\b/i.test(c.title) || c.group === "Go to" || c.group === "Settings";
    const asRow = (c: Command): Row => ({ key: "cmd:" + c.id, title: c.title, sub: c.sub, icon: c.icon || "bolt", hint: c.hint, run: c.run,
      kind: placeLike(c) ? "place" : "action" });

    if (!term) {
      // Nothing typed: the commands, under their own headings, in the order given. On a
      // phone it leads with the songs you've been in, and leaves out what the tab bar right
      // under it already is (Library, Inbox, Settings).
      const byGroup = new Map<string, Row[]>();
      if (shell.songs.length) {
        byGroup.set("Recent", shell.songs.slice(0, 5).map((s) => ({
          key: "song:" + s.id, title: s.title, kind: "thing" as const,
          cover: { url: songCover(s), title: s.title }, run: () => go(href.song(s.id)),
        })));
      }
      const docked = new Set(["go.library", "go.inbox", "go.settings"]);
      for (const c of commands) {
        if (shell.narrow && docked.has(c.id)) continue;
        const name = c.group || "Commands";
        if (!byGroup.has(name)) byGroup.set(name, []);
        byGroup.get(name)!.push(asRow(c));
      }
      for (const [label, rows] of byGroup) out.push({ label, rows });
      return out;
    }

    if (!onlyCommands && found && found.query === term) {
      for (const g of found.groups) {
        if (g.error) { out.push({ label: g.label, rows: [], note: g.error }); continue; }
        out.push({
          label: g.label, rows: g.hits.map((hit: any) => hitRow(g, hit)),
          note: g.total > g.hits.length ? `${g.hits.length} of ${g.total}` : undefined,
        });
      }
    }
    const matched = scored.slice(0, onlyCommands ? 30 : 6).map((x) => asRow(x.c));
    if (matched.length) out.push({ label: "Commands", rows: matched });
    return out;
  });

  const flat = $derived(groups.flatMap((g) => g.rows));
  $effect(() => { void flat.length; if (active >= flat.length) active = Math.max(0, flat.length - 1); });
  $effect(() => { void term; active = 0; });

  function close() { shell.palette = false; }
  // On a phone, Back closes the search instead of leaving the page.
  closesOnBack(() => shell.palette, close);

  async function run(row: Row | undefined, alt = false) {
    if (!row) return;
    close();
    await (alt && row.alt ? row.alt() : row.run());
  }

  /** Whether a key or the pointer has moved the highlight yet (a phone shows none until then). */
  let moved = $state(false);
  function key(e: KeyboardEvent) {
    if (e.key.startsWith("Arrow")) moved = true;
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); return; }
    if (e.key === "ArrowDown" || (e.key === "n" && e.ctrlKey)) { e.preventDefault(); active = Math.min(flat.length - 1, active + 1); scroll(); return; }
    if (e.key === "ArrowUp" || (e.key === "p" && e.ctrlKey)) { e.preventDefault(); active = Math.max(0, active - 1); scroll(); return; }
    if (e.key === "Home" && !query) { e.preventDefault(); active = 0; scroll(); return; }
    if (e.key === "Enter") {
      e.preventDefault();
      // Ctrl+Enter is "show me all of it": the library, filtered by this.
      if ((e.ctrlKey || e.metaKey) && term && !onlyCommands) { close(); go(href.search(term)); return; }
      run(flat[active], e.shiftKey);
    }
  }
  async function scroll() {
    await tick();
    listNode?.querySelector(".row.on")?.scrollIntoView({ block: "nearest" });
  }

  const nowhere = $derived(!!term && !onlyCommands && !searching && found !== null && !flat.length);
  // It arrives with the dim, not after it: the same short timing for both, so nothing
  // (the blur behind it) shows up before the search itself does.
  const enter = (node: Element) => fly(node, { y: -10, duration: 150 });
  const leave = (node: Element) => fade(node, { duration: 120 });
  /** Off on the first frame of closing, held off while the panel fades. */
  const gone = (_node: Element) => ({ duration: 120, css: () => "opacity: 0" });

  // A phone: a big gap at the bottom to tap out on, and once the keyboard is up, a gap
  // above the keyboard too. The visual viewport is what the keyboard shrinks.
  let keyboard = $state(0);
  $effect(() => {
    const vv = window.visualViewport;
    if (!vv || !shell.narrow) return;
    const read = () => { keyboard = Math.max(0, Math.round(innerHeight - vv.height - vv.offsetTop)); };
    read();
    vv.addEventListener("resize", read); vv.addEventListener("scroll", read);
    return () => { vv.removeEventListener("resize", read); vv.removeEventListener("scroll", read); };
  });
</script>

{#if shell.palette}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div class="backdrop" style:--kb="{keyboard}px" onpointerdown={(e) => { if (e.target === e.currentTarget) close(); }}>
    <!-- THE RULE, for anything with glass in it: no ancestor of a blurred element may change its
     opacity. While an ancestor is below 1 the browser treats it as the edge of what the blur
     can see, so the blur has nothing behind it until the fade ends and then appears at once.
     The blurred element fading ITSELF is fine. So the dim is its own layer, and the glass
     panel carries its own fade. -->
    <div class="dim" transition:fade={{ duration: 140 }}></div>
    <!-- The frame holds two layers. The backing blurs the (lightly blurred) app under the
         panel strongly; it never contains anything that repaints, so hovering rows or typing
         cannot make it re-filter a patch (the flicker). The panel on top is the glass:
         its film and edge are CSS, and the shader draws the colour split at its rim. -->
    <div class="frame">
    <!-- The blurred colour behind the search (the covers and dust under it) shimmers in
         only once the panel has arrived, so nothing moves ahead of the search itself. -->
    <!-- Slow in, gone at once: the specks and colour behind it shimmer in well after the
         panel has landed, and leave the moment it starts to go. -->
    <div class="backing" aria-hidden="true" in:fade={{ delay: 300, duration: 550 }} out:gone></div>
    <div class="palette glass modal" use:pane={{ delay: 300, fade: 550 }} role="dialog" aria-label="Search and commands"
         in:enter out:leave onoutrostart={(e) => leavePane(e.currentTarget)}>
      <div class="box">
        <button class="icon-btn sm backbtn" onclick={close} aria-label="Back"><Icon name="chev-left" size={18} /></button>
        {#if searching}<span class="spinner"></span>{:else}<Icon name="search" size={19} />{/if}
        <input bind:this={input} bind:value={query} onkeydown={key} type="text" spellcheck="false" autocomplete="off"
               placeholder={shell.narrow ? "Search" : "Search the library, or type > for commands"} aria-label="Search and commands"
               role="combobox" aria-expanded="true" aria-controls="palette-list" aria-autocomplete="list" />
        <kbd>Esc</kbd>
      </div>

      <div class="list" id="palette-list" role="listbox" bind:this={listNode}>
        {#each groups as group (group.label)}
          <div class="ghead"><span class="grow">{group.label}</span>{#if group.note}<span>{group.note}</span>{/if}</div>
          {#each group.rows as row (row.key)}
            {@const i = flat.indexOf(row)}
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <div class="row" class:on={i === active && (moved || !shell.narrow || !!term)} role="option" aria-selected={i === active} tabindex="-1"
                 onpointermove={() => { active = i; moved = true; }} onclick={(e) => run(row, e.shiftKey)}>
              {#if row.cover}<Cover url={row.cover.url} title={row.cover.title} size={30} />
              {:else}<span class="ico {row.kind || 'action'}"><Icon name={row.icon || "bolt"} size={16} /></span>{/if}
              <span class="grow truncate">
                <span class="t truncate">{row.title}</span>
                {#if row.line}<span class="s line">{row.line}</span>
                {:else if row.sub}<span class="s truncate">{row.sub}</span>{/if}
              </span>
              {#if i === active && row.alt}<span class="alt"><kbd>Shift</kbd><kbd>↵</kbd> {row.altSays}</span>{/if}
              {#if row.hint}<kbd>{row.hint}</kbd>{/if}
              {#if row.kind === "place" && !row.hint}<span class="to" aria-hidden="true"><Icon name="chev-right" size={14} /></span>{/if}
            </div>
          {/each}
        {/each}
        {#if nowhere}
          <div class="none">
            <strong>Nothing matches “{term}”</strong>
            <span>Nothing in your {(found?.looked_in || []).map((w) => w.toLowerCase()).join(", ") || "library"}. A shorter word usually finds more.</span>
          </div>
        {/if}
      </div>

      <div class="foot">
        <span><kbd>↑</kbd><kbd>↓</kbd> move</span>
        <span><kbd>↵</kbd> open</span>
        {#if term && !onlyCommands}<span><kbd>Ctrl</kbd><kbd>↵</kbd> all results</span>{/if}
        <span class="grow"></span>
        <span class="lang" title="Words, &quot;a phrase&quot;, -not, is:song, album:&quot;name&quot;, has:words, renders:>3, length:<3:30, touched:<7d, made:>2026-01">is:song renders:&gt;3 -rain</span>
        <span><kbd>&gt;</kbd> commands only</span>
      </div>
    </div>
    </div>
  </div>
{/if}

<style>
  .backdrop {
    position: fixed; inset: 0; z-index: 750; display: flex; justify-content: center; align-items: flex-start;
    padding: min(14vh, 120px) var(--s4) var(--s4);
  }
  .dim { position: absolute; inset: 0; background: rgba(0, 0, 0, 0.2); pointer-events: none;
          backdrop-filter: blur(3px); -webkit-backdrop-filter: blur(3px); }
  .frame { position: relative; width: min(100%, 640px); border-radius: var(--r-xl); }
  /* Blur only, never saturate or brightness: those compound when a patch is filtered twice,
     which is what the flicker was. What it blurs is already softened (Shell.svelte), so a
     blur of a blur, if it ever happened, would look the same. */
  .backing {
    position: absolute; inset: 0; border-radius: inherit; pointer-events: none;
    -webkit-backdrop-filter: blur(22px); backdrop-filter: blur(22px);
  }
  .palette { position: relative; width: 100%; max-height: min(70vh, 620px); display: flex; flex-direction: column; border-radius: var(--r-xl); overflow: hidden; }
  .box { display: flex; align-items: center; gap: var(--s3); padding: 0 var(--s4); height: 56px; border-bottom: 1px solid var(--line); color: var(--text-2); flex: none; }
  input { flex: 1 1 auto; min-width: 0; height: 100%; background: none; border: 0; outline: none; font-size: var(--t-lg); font-weight: 500; }
  input::placeholder { color: var(--text-3); }
  .list { flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: var(--s2) var(--s2) var(--s3); display: flex; flex-direction: column; gap: 3px; }
  /* Rows run out softly at the bottom instead of being cut mid-row. */
  :global(html[data-narrow]) .list { mask-image: linear-gradient(to bottom, #000 calc(100% - 18px), transparent); }
  /* A heading opens a new group with real air above it, so groups read as groups. */
  .ghead { display: flex; gap: var(--s3); padding: var(--s5) var(--s3) var(--s2); font: 600 var(--t-xs)/1 var(--font); color: var(--text-3); }
  .ghead:first-child { padding-top: var(--s3); }
  .row { display: flex; align-items: center; gap: var(--s3); min-height: 46px; padding: var(--s1) var(--s3); border-radius: var(--r-md); cursor: pointer; }
  .row.on { background: color-mix(in srgb, var(--text) 11%, transparent); }
  /* The icon says what kind of row it is. A place: an outlined tile, and a chevron at the
     end. An action: a tile filled with the accent. A thing has its cover instead. */
  .ico { width: 30px; height: 30px; flex: none; display: grid; place-items: center; border-radius: 9px; color: var(--text-2); }
  .ico.place { border: 1px solid var(--line-2); background: transparent; }
  .ico.action { background: var(--accent-soft); color: var(--accent-text); }
  .row.on .ico.place { color: var(--text); border-color: var(--text-3); }
  .to { color: var(--text-3); display: inline-grid; flex: none; }
  .row.on .to { color: var(--text); }
  .t { display: block; font-weight: 600; }
  .s { display: block; font-size: var(--t-sm); color: var(--text-2); }
  .line { display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; white-space: pre-line; }
  .alt { display: flex; align-items: center; gap: var(--s1); font-size: var(--t-xs); color: var(--text-3); flex: none; }
  .none { display: flex; flex-direction: column; gap: var(--s1); padding: var(--s6) var(--s4); text-align: center; color: var(--text-2); }
  .none strong { color: var(--text); }
  .foot { display: flex; align-items: center; gap: var(--s4); padding: var(--s2) var(--s4); border-top: 1px solid var(--line); font-size: var(--t-xs); color: var(--text-3); flex: none; }
  .foot span { display: inline-flex; align-items: center; gap: var(--s1); }
  @media (max-width: 640px) {
    /* Nearly the whole width, so results have room to read; the room to tap out is at
       the bottom, a third of the screen, or a gap above the keyboard when it's up. */
    .backdrop { --below: max(32dvh, calc(var(--kb, 0px) + var(--s6))); padding: calc(var(--safe-t) + var(--s2)) var(--s2) var(--below); }
    .palette { max-height: calc(100dvh - var(--s2) - var(--safe-t) - var(--below)); }
    .foot { display: none; }
  }

  /* The back button: phones only, where a pop-out covers the page. */
  .backbtn { display: none; }
  :global(html[data-narrow]) .backbtn { display: inline-grid; }
  /* A sample of the search language, the whole of it in its tooltip. */
  .lang { font-family: var(--mono); color: var(--text-3); }
</style>
