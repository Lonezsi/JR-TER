<!-- The Inbox: things that arrived, and where they go.
     Renders waiting to be told which song they belong to, the watched folders that feed
     them, the desktop agent's uploads and drag and drop were once three screens. They are
     one idea: audio arrived, and it goes somewhere.

     WAITING / ALL is the renders list. SOURCES (owner only) is the folders on the host.

     The list is windowed: rows are one fixed height, only the ones on screen (and a few
     either side) are in the page, and the rest is padding. Five hundred renders cost
     what forty do. -->
<script lang="ts">
  import { onMount, tick } from "svelte";
  import { hidden } from "$lib/later.svelte";
  import { fade } from "svelte/transition";
  import { shell } from "../shell/state.svelte";
  import { parseQuery, queryText, allows } from "$lib/query";

  import { get, post } from "$lib/api";
  import { resource } from "$lib/resource.svelte";
  import { has, ownsTheMachine } from "$lib/app.svelte";
  import { replace, href, go } from "$lib/router.svelte";
  import { contextMenu, showMenu, type MenuItem } from "$lib/menu.svelte";
  import { toast } from "$lib/toast.svelte";
  import { useCommands } from "$lib/commands";
  import { player, playRender, toggle } from "$lib/player.svelte";
  import { sorted, type SortKey } from "$lib/sort.svelte";
  import { ymd, date, time, bytes, hue, plural, store } from "$lib/util";
  import Icon from "$ui/Icon.svelte";
  import Wave from "$ui/Wave.svelte";
  import Segmented from "$ui/Segmented.svelte";
  import SortPick from "$ui/SortPick.svelte";

  import Sources from "./inbox/Sources.svelte";
  import { attachRender, attachRenders } from "./inbox/attach";
  import { renderMenu } from "./inbox/renderMenu";
  import {
    type LooseRender, nameOf, isWaiting, troubleOf, originOf, peakOf,
    saveName, unattachRender, deleteRenders, clearAttached, takeInFolder,
  } from "./inbox/renders";
  import { uploads, takeFiles, pickFiles, dismissUploads, forgetUpload } from "./inbox/uploads.svelte";

  let { params }: { params: Record<string, string> } = $props();

  // ── tabs ───────────────────────────────────────────────────────────────────
  const sourcesOk = $derived(has("sync") && ownsTheMachine());
  const tab = $derived(params.tab === "sources" && sourcesOk ? "sources" : "waiting");
  const setTab = (next: string) => replace(next === "waiting" ? "/inbox" : `/inbox/${next}`);

  // ── data ───────────────────────────────────────────────────────────────────
  // Everything, once: the three filters are then instant and cost no request.
  const data = resource<{ renders: LooseRender[]; waiting: number }>(
    () => (has("renders") ? get("/api/renders?all=1") : Promise.resolve({ renders: [], waiting: 0 })),
    { on: ["renders:changed"] });
  const all = $derived((data.data?.renders || []).filter((r) => !hidden(`render:${r.id}`)));
  const waitingCount = $derived(all.filter(isWaiting).length);
  const attachedCount = $derived(all.length - waitingCount);

  type Filter = "waiting" | "attached" | "all";
  const FILTER = "jriter.inbox.filter";
  let filter = $state<Filter>(((v) => (v === "attached" || v === "all" ? v : "waiting"))(store.raw(FILTER)));
  const setFilter = (f: Filter) => { filter = f; store.setRaw(FILTER, f); clearSelection(); };
  let needle = $state("");

  /* What this list can be put in order by. Newest first is the default because the
     reason you are here is almost always the thing you just bounced. Project date is the
     .flp's own age, which groups a night's work however many times it was re-rendered. */
  const KEYS: SortKey<LooseRender>[] = [
    { key: "arrived", label: "Newest first", dir: "down", numeric: true, by: (r) => r.created_at },
    { key: "rendered", label: "When it was rendered", dir: "down", numeric: true, by: (r) => r.rendered_at || r.created_at },
    { key: "project", label: "When the project was made", dir: "down", numeric: true, by: (r) => r.project_at },
    { key: "name", label: "Name", dir: "up", by: (r) => nameOf(r) },
    { key: "length", label: "Length", dir: "down", numeric: true, by: (r) => r.duration },
    { key: "size", label: "Size", dir: "down", numeric: true, by: (r) => r.size },
  ];

  // The filter speaks the same language as every search box (lib/query.ts): plain words,
  // "a phrase", -not, length:<3:00, touched:<7d.
  const asked = $derived(parseQuery(needle));
  const matching = $derived.by(() => {
    const words = needle.trim() ? asked : null;
    return all.filter((r) => {
      if (filter === "waiting" && !isWaiting(r)) return false;
      if (filter === "attached" && isWaiting(r)) return false;
      if (!words) return true;
      const hay = `${nameOf(r)} ${r.song_title || ""} ${r.filename || ""} ${r.source_path || ""}`;
      const main = queryText(words).toLowerCase();
      if (main && !hay.toLowerCase().includes(main)) return false;
      return allows(words, "render", { title: hay, duration: r.duration, created_at: r.created_at, updated_at: r.used_at ?? r.created_at });
    });
  });
  const items = $derived(sorted(matching, "inbox.renders", KEYS));

  const patchLocal = (id: number, change: Partial<LooseRender>) => {
    if (!data.data) return;
    data.set({ ...data.data, renders: data.data.renders.map((r) => (r.id === id ? { ...r, ...change } : r)) });
  };

  // ── selection, cursor ──────────────────────────────────────────────────────
  let selected = $state<Set<number>>(new Set());
  let cursorId = $state<number | null>(null);
  let anchor = $state(0);
  const cursorAt = $derived(cursorId === null ? -1 : items.findIndex((r) => r.id === cursorId));
  const clearSelection = () => { if (selected.size) selected = new Set(); };
  // What an action means: the selection if there is one, else the row the cursor is on.
  const targets = (): LooseRender[] => {
    if (selected.size) return items.filter((r) => selected.has(r.id));
    const at = items[cursorAt];
    return at ? [at] : [];
  };

  function select(e: MouseEvent | KeyboardEvent, r: LooseRender, i: number) {
    if (e.shiftKey) {
      const [a, b] = [Math.min(anchor, i), Math.max(anchor, i)];
      const next = e.ctrlKey || e.metaKey ? new Set(selected) : new Set<number>();
      for (let k = a; k <= b; k++) next.add(items[k].id);
      selected = next;
    } else if (e.ctrlKey || e.metaKey || selected.size) {
      const next = new Set(selected);
      if (next.has(r.id)) next.delete(r.id); else next.add(r.id);
      selected = next; anchor = i;
    } else {
      selected = new Set([r.id]); anchor = i;
    }
    cursorId = r.id;
  }

  // ── playing ────────────────────────────────────────────────────────────────
  const sounding = (r: LooseRender) => player.song?.id === (`render:${r.id}` as unknown);
  // The queue is the list as it is on screen: what plays next is the row underneath.
  const playRow = (r: LooseRender) => (sounding(r) ? toggle() : playRender(r, items));

  // ── windowing ──────────────────────────────────────────────────────────────
  const H = 64;
  const OVER = 8;
  let listEl = $state<HTMLElement>();
  let scroller: HTMLElement | null = null;
  let win = $state({ from: 0, to: 40 });
  const visible = $derived(items.slice(win.from, win.to));
  const padTop = $derived(win.from * H);
  const padBottom = $derived(Math.max(0, items.length - win.to) * H);

  function scrollParent(el: HTMLElement): HTMLElement | null {
    for (let n = el.parentElement; n; n = n.parentElement) {
      const o = getComputedStyle(n).overflowY;
      if (o === "auto" || o === "scroll" || o === "overlay") return n;
    }
    return null;
  }
  function measure() {
    if (!listEl) return;
    scroller ||= scrollParent(listEl);
    const n = items.length;
    if (!scroller) { win = { from: 0, to: n }; return; }
    const above = scroller.getBoundingClientRect().top - listEl.getBoundingClientRect().top;
    const from = Math.max(0, Math.floor(above / H) - OVER);
    const to = Math.min(n, Math.ceil((above + scroller.clientHeight) / H) + OVER);
    if (from !== win.from || to !== win.to) win = { from, to };
  }
  let frame = 0;
  const onScroll = () => { if (!frame) frame = requestAnimationFrame(() => { frame = 0; measure(); }); };
  $effect(() => {
    if (!listEl) return;
    scroller = scrollParent(listEl);
    scroller?.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    measure();
    return () => {
      scroller?.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      cancelAnimationFrame(frame); frame = 0;
    };
  });
  $effect(() => { void items.length; void filter; tick().then(measure); });

  /** Scroll so row i is on screen, clear of the top bar and the player. */
  function reveal(i: number) {
    if (!scroller || !listEl) return;
    const y = listEl.getBoundingClientRect().top - scroller.getBoundingClientRect().top + i * H;
    const top = 70, bottom = scroller.clientHeight - 120;
    if (y < top) scroller.scrollTop += y - top;
    else if (y + H > bottom) scroller.scrollTop += y + H - bottom;
  }

  function move(i: number, extend: boolean) {
    const at = Math.max(0, Math.min(items.length - 1, i));
    const r = items[at];
    if (!r) return;
    if (extend) select({ shiftKey: true, ctrlKey: false, metaKey: false } as KeyboardEvent, r, at);
    else { cursorId = r.id; anchor = at; }
    reveal(at);
  }

  // ── actions ────────────────────────────────────────────────────────────────
  async function attachTargets() {
    const list = targets().filter(isWaiting);
    if (!list.length) { toast(targets().length ? "That is already attached." : "Nothing is selected."); return; }
    const done = await attachRenders(list);
    if (done) clearSelection();
  }
  async function deleteTargets(only?: LooseRender[]) {
    const list = only || targets();
    if (!list.length) return;
    const ids = new Set(list.map((r) => r.id));
    if (await deleteRenders(list)) {
      if (data.data) data.set({ ...data.data, renders: data.data.renders.filter((r) => !ids.has(r.id)) });
      clearSelection();
    }
  }
  async function putBack(r: LooseRender) {
    patchLocal(r.id, { song_id: null, song_title: null, waiting: true, used_at: 0 });
    if (!(await unattachRender(r))) data.reload();
  }
  async function clearUsed() { if (await clearAttached(attachedCount)) { clearSelection(); } }

  function menuFor(r: LooseRender): MenuItem[] {
    if (selected.size > 1 && selected.has(r.id)) {
      const n = selected.size;
      return [
        { group: plural(n, "render") + " selected" },
        { label: `Attach ${n}…`, icon: "link", run: attachTargets },
        { label: `Delete ${n}`, icon: "trash", danger: true, run: () => deleteTargets() },
        { divider: true },
        { label: "Clear the selection", icon: "close", run: clearSelection },
      ];
    }
    return renderMenu(r, items);
  }
  const rowMenu = (r: LooseRender) => () => {
    cursorId = r.id;
    return menuFor(r);
  };

  // ── renaming in place ──────────────────────────────────────────────────────
  let editing = $state<number | null>(null);
  let draft = $state("");
  let settled = false;
  function startEdit(r: LooseRender) {
    cursorId = r.id; editing = r.id; draft = nameOf(r); settled = false;
  }
  async function finishEdit(r: LooseRender, keep: boolean) {
    if (settled) return;
    settled = true;
    editing = null;
    listEl?.focus({ preventScroll: true });
    const name = draft.trim();
    if (!keep || !name || name === nameOf(r)) return;
    patchLocal(r.id, { name });
    if (!(await saveName(r, name))) data.reload();
  }
  const focusSelect = (node: HTMLInputElement) => { node.focus(); node.select(); };

  // ── keys ───────────────────────────────────────────────────────────────────
  function onkey(e: KeyboardEvent) {
    // Only when the list itself has focus: a row holds buttons of its own, and Enter on
    // Play must play, not open the attach sheet.
    if (e.target !== listEl || !items.length) return;
    const i = Math.max(0, cursorAt);
    const r = items[i];
    const extend = e.shiftKey;
    switch (e.key) {
      case "ArrowDown": e.preventDefault(); move(cursorAt < 0 ? 0 : i + 1, extend); break;
      case "ArrowUp": e.preventDefault(); move(i - 1, extend); break;
      case "PageDown": e.preventDefault(); move(i + 8, extend); break;
      case "PageUp": e.preventDefault(); move(i - 8, extend); break;
      case "Home": e.preventDefault(); move(0, extend); break;
      case "End": e.preventDefault(); move(items.length - 1, extend); break;
      case " ": e.preventDefault(); if (r) playRow(r); break;
      case "Enter":
        e.preventDefault();
        if (selected.size > 1) attachTargets();
        else if (r) { if (isWaiting(r)) attachRender(r); else if (r.song_id) go(href.song(r.song_id)); }
        break;
      case "Delete": case "Backspace": e.preventDefault(); deleteTargets(); break;
      case "F2": e.preventDefault(); if (r) startEdit(r); break;
      case "Escape": clearSelection(); break;
      case "a": case "A":
        if (e.ctrlKey || e.metaKey) { e.preventDefault(); selected = new Set(items.map((x) => x.id)); }
        break;
      case "ContextMenu": {
        e.preventDefault();
        const node = listEl?.querySelector(`[data-id="${r?.id}"]`);
        if (node && r) showMenu(menuFor(r), { anchor: node });
        break;
      }
    }
  }

  // ── uploads and drops ──────────────────────────────────────────────────────
  // Anywhere on the screen. A render arrives by being finished somewhere else, and
  // whatever screen is up at that moment is not part of that thought. Always to the
  // inbox, never to the song that happens to be open: guessing wrong attaches a take to
  // the wrong song, and every render is one press from being attached anyway.
  let dragging = $state(false);
  $effect(() => {
    // Counted, not toggled: enter and leave both fire at every element boundary.
    let deep = 0;
    const files = (e: DragEvent) => !!e.dataTransfer && Array.from(e.dataTransfer.types || []).includes("Files");
    const enter = (e: DragEvent) => { if (files(e)) { deep++; dragging = true; } };
    const over = (e: DragEvent) => { if (files(e)) e.preventDefault(); };   // else the browser opens the file
    const leave = (e: DragEvent) => { if (files(e) && --deep <= 0) { deep = 0; dragging = false; } };
    const drop = (e: DragEvent) => {
      if (!files(e)) return;
      e.preventDefault(); deep = 0; dragging = false;
      takeFiles(Array.from(e.dataTransfer?.files || []));
    };
    document.addEventListener("dragenter", enter);
    document.addEventListener("dragover", over);
    document.addEventListener("dragleave", leave);
    document.addEventListener("drop", drop);
    return () => {
      document.removeEventListener("dragenter", enter);
      document.removeEventListener("dragover", over);
      document.removeEventListener("dragleave", leave);
      document.removeEventListener("drop", drop);
      dragging = false;
    };
  });

  // ── staying current ────────────────────────────────────────────────────────
  // The desktop agent adds renders by itself, so coming back to the tab looks again.
  onMount(() => {
    let last = 0;
    const again = () => {
      if (document.visibilityState !== "visible" || Date.now() - last < 1500) return;
      last = Date.now();
      data.reload();
    };
    window.addEventListener("focus", again);
    document.addEventListener("visibilitychange", again);
    if (params.upload === "1") {
      replace(tab === "sources" ? "/inbox/sources" : "/inbox");
      pickFiles();
    }
    return () => {
      alive = false;
      window.removeEventListener("focus", again);
      document.removeEventListener("visibilitychange", again);
    };
  });

  /* Anything that arrived before shapes existed has none, and nothing in normal use would
     ever give it one. Asked for once, in bounded batches, so a library of seven hundred
     fills in over a few visits rather than holding one request open for a minute. */
  let alive = true;
  let examined = false;
  $effect(() => {
    if (examined || !data.data || !has("renders")) return;
    examined = true;
    if (!data.data.renders.some((r) => !r.shape?.length && !r.trouble)) return;
    (async () => {
      for (let round = 0; round < 4 && alive; round++) {
        const done = await post("/api/renders/examine?limit=60").catch(() => null);
        if (!done || !done.looked_at || !alive) break;
        await data.reload();
        if (!done.left) break;
      }
    })();
  });

  const nowOrFirst = () => items[cursorAt] || items.find(isWaiting);
  useCommands(() => [
    { id: "inbox.upload", title: "Upload renders", sub: "From this computer", icon: "upload", group: "Inbox", keywords: "add audio files bounce", run: pickFiles },
    { id: "inbox.attach", title: "Attach…", sub: "Choose a song for the selected render", icon: "link", group: "Inbox",
      run: () => { go(href.inbox()); if (!selected.size && cursorAt < 0) { const r = nowOrFirst(); if (r) cursorId = r.id; } return attachTargets(); } },
    { id: "inbox.clear", title: "Clear attached renders", icon: "check", group: "Inbox", run: clearUsed },
    { id: "inbox.open", title: "Open the inbox", icon: "inbox", group: "Inbox", run: () => go(href.inbox()) },
    sourcesOk ? { id: "inbox.sources", title: "Watched folders", sub: "Inbox, Sources", icon: "folder", group: "Inbox", run: () => go(href.inbox("sources")) } : null,
    { id: "inbox.refresh", title: "Look for new renders", icon: "refresh", group: "Inbox", run: () => data.reload() },
  ].filter(Boolean) as import("$lib/commands").Command[]);

  const moreMenu = (): MenuItem[] => [
    { label: "Upload files…", icon: "upload", run: pickFiles },
    ownsTheMachine() ? { label: "Take in a folder…", icon: "folder", run: takeInFolder } : null,
    { label: "Look for new renders", icon: "refresh", run: () => data.reload() },
    { divider: true },
    { label: `Clear attached${attachedCount ? ` (${attachedCount})` : ""}`, icon: "check", disabled: !attachedCount, run: clearUsed },
    { label: "Select all", icon: "list", hint: "Ctrl+A", disabled: !items.length, run: () => (selected = new Set(items.map((x) => x.id))) },
  ];
  // A phone: the filter waits behind a search icon, so the list starts higher up.
  let finding = $state(false);
</script>

<div class="page enter">
  <div class="page-head">
    <h1>Inbox</h1>
  </div>

  {#if sourcesOk}
    <Segmented size="md" label="Inbox sections" value={tab} onchange={setTab}
               options={[{ value: "waiting", label: "Renders", icon: "inbox" },
                         { value: "sources", label: "Folders", icon: "folder" }]} />
  {/if}

  {#if tab === "sources"}
    <Sources />
  {:else}
    {#if uploads.items.length}
      <div class="card ups" aria-live="polite">
        {#each uploads.items as up (up.id)}
          <div class="up" class:bad={up.state === "failed"}>
            <span class="truncate grow">{up.name}</span>
            <span class="faint num small">
              {#if up.state === "wait"}waiting
              {:else if up.state === "going"}{Math.round(up.fraction * 100)}%
              {:else if up.state === "done"}added
              {:else if up.state === "dupe"}already here
              {:else}{up.error || "failed"}{/if}
            </span>
            <span class="bar" class:done={up.state !== "going" && up.state !== "wait"}><i style:width="{up.fraction * 100}%"></i></span>
            {#if up.state === "failed"}<button class="icon-btn sm" aria-label="Dismiss" onclick={() => forgetUpload(up.id)}><Icon name="close" size={14} /></button>{/if}
          </div>
        {/each}
        {#if !uploads.busy}<button class="btn sm ghost end" onclick={dismissUploads}>Hide</button>{/if}
      </div>
    {/if}

    <div class="bar-tools row wrap">
      <Segmented size="sm" label="Show" value={filter} onchange={(v) => setFilter(v as Filter)}
                 options={[{ value: "waiting", label: "Waiting" },
                           { value: "attached", label: "Attached", badge: attachedCount || null },
                           { value: "all", label: "All" }]} />
      {#if !shell.narrow || finding || needle}
        <!-- svelte-ignore a11y_autofocus -->
        <input class="field sm find" type="search" placeholder="Filter" aria-label="Filter renders" title="Words, &quot;a phrase&quot;, -not, length:<3:00, touched:<7d" bind:value={needle}
               autofocus={shell.narrow} onblur={() => { if (!needle) finding = false; }} />
      {/if}
      <span class="tail row">
        {#if shell.narrow && !finding && !needle}<button class="icon-btn sm" aria-label="Filter" title="Filter" onclick={() => (finding = true)}><Icon name="search" size={16} /></button>{/if}
        <SortPick list="inbox.renders" keys={KEYS} compact={shell.narrow} />
        {#if attachedCount && !shell.narrow}<button class="btn sm ghost" onclick={clearUsed} title="Take every attached render out of this list">Clear attached</button>{/if}
        <button class="icon-btn sm" aria-label="More" title="More" onclick={(e) => showMenu(moreMenu(), { anchor: e.currentTarget })}><Icon name="more" size={16} /></button>
      </span>
    </div>

    {#if selected.size}
      <div class="bulk card row wrap" transition:fade={{ duration: 120 }}>
        <b class="num">{selected.size} selected</b>
        <span class="grow"></span>
        <button class="btn sm tint" onclick={attachTargets}><Icon name="link" size={14} />Attach</button>
        <button class="btn sm danger" onclick={() => deleteTargets()}><Icon name="trash" size={14} />Delete</button>
        <button class="btn sm ghost" onclick={clearSelection}>Clear selection</button>
      </div>
    {/if}

    {#if data.error && !data.data}
      <div class="notice bad"><span class="grow">{data.error}</span><button class="btn sm" onclick={() => data.reload()}>Try again</button></div>
    {:else if !data.data}
      <div class="card list" aria-busy="true" aria-label="Loading renders">
        {#each { length: 6 } as _}
          <div class="skrow">
            <span class="sk dot"></span>
            <span class="grow col" style="gap:6px"><span class="sk l1"></span><span class="sk l2"></span></span>
            <span class="sk wv"></span>
          </div>
        {/each}
      </div>
    {:else if !has("renders")}
      <div class="card empty"><h3>Renders are off</h3><p>Renders are turned off in this library.</p></div>
    {:else if !items.length}
      <div class="card empty">
        {#if needle.trim()}
          <h3>No match</h3><p>Nothing here matches that.</p>
          <button class="btn" onclick={() => (needle = "")}>Clear the filter</button>
        {:else if filter === "waiting" && attachedCount}
          <h3>Nothing waiting</h3><p>Everything has been attached to a song.</p>
          <button class="btn" onclick={() => setFilter("all")}>Show all {all.length}</button>
        {:else if filter === "attached"}
          <h3>Nothing attached yet</h3><p>Renders you put on a song stay listed here until you clear them.</p>
        {:else}
          <h3>Nothing waiting</h3>
          <p>Renders land here until you put them on a song. Drop audio on the page, upload, or right-click an audio file or FL project and send it with the desktop agent.</p>
          <div class="row wrap" style="justify-content:center">
            <button class="btn primary" onclick={pickFiles}><Icon name="upload" size={16} />Upload files</button>
            {#if sourcesOk}<button class="btn" onclick={() => setTab("sources")}><Icon name="folder" size={16} />Watched folders</button>{/if}
          </div>
        {/if}
      </div>
    {:else}
      <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
      <div class="card list rlist" role="listbox" aria-multiselectable="true" aria-label="Renders" tabindex="0"
           aria-activedescendant={cursorId !== null ? `r${cursorId}` : undefined}
           bind:this={listEl} onkeydown={onkey}
           style:padding-top="{padTop}px" style:padding-bottom="{padBottom}px">
        {#each visible as r, k (r.id)}
          {@const i = win.from + k}
          {@const waiting = isWaiting(r)}
          {@const bad = troubleOf(r)}
          {@const origin = originOf(r)}
          {@const peak = peakOf(r)}
          {@const live = sounding(r)}
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <div class="rrow" id="r{r.id}" data-id={r.id} role="option" tabindex="-1" aria-selected={selected.has(r.id)}
               class:on={selected.has(r.id)} class:cur={cursorId === r.id} class:live class:used={!waiting}
               use:contextMenu={rowMenu(r)}
               onclick={(e) => { if (!(e.target as HTMLElement).closest("button, a, input")) { listEl?.focus({ preventScroll: true }); if (e.shiftKey || e.ctrlKey || e.metaKey) select(e, r, i); else { cursorId = r.id; anchor = i; clearSelection(); } } }}
               ondblclick={(e) => { if (!(e.target as HTMLElement).closest("button, a, input") && waiting) attachRender(r); }}>
            <button class="chk" class:on={selected.has(r.id)} aria-label="Select {nameOf(r)}" aria-pressed={selected.has(r.id)}
                    onclick={(e) => { listEl?.focus({ preventScroll: true }); select(e, r, i); }}>
              {#if selected.has(r.id)}<Icon name="check" size={14} stroke={2.4} />{/if}
            </button>
            <button class="play-btn sm" class:accent={live && player.playing}
                    aria-label="{live && player.playing ? 'Pause' : 'Play'} {nameOf(r)}"
                    onclick={() => { cursorId = r.id; playRow(r); }}>
              <Icon name={live && player.playing ? "pause" : "play"} size={16} />
            </button>

            <div class="main">
              {#if editing === r.id}
                <input class="field sm" aria-label="Name" maxlength="200" bind:value={draft} use:focusSelect
                       onblur={() => finishEdit(r, true)}
                       onkeydown={(e) => { if (e.key === "Enter") { e.preventDefault(); finishEdit(r, true); } else if (e.key === "Escape") { e.stopPropagation(); finishEdit(r, false); } }} />
              {:else}
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <span class="name truncate" title="Double click to rename" ondblclick={(e) => { e.stopPropagation(); startEdit(r); }}>{nameOf(r)}</span>
              {/if}
              <span class="sub truncate">
                {#if !waiting}
                  <span class="went">
                    <Icon name="link" size={11} />
                    {#if r.song_id}<a href={href.song(r.song_id)} title="Open the song">{r.song_title || "a song"}</a>{:else}{r.song_title || "a song"}{/if}
                  </span>
                {/if}
                <span class="narrow-meta num">{ymd(r.created_at)}{r.duration ? " · " + time(r.duration) : ""}{r.size ? " · " + bytes(r.size) : ""}</span>
              </span>
            </div>

            <div class="wave" style:color="hsl({hue(nameOf(r))} 85% 68%)"><Wave shape={r.shape} hue={hue(nameOf(r))} /></div>
            {#if bad}<span class="tag bad trouble" title={bad.long}><Icon name="warning" size={11} />{bad.short}</span>{/if}
            <span class="c date num" title="Added {date(r.created_at)}">{ymd(r.created_at)}</span>
            <span class="c dur num">{r.duration ? time(r.duration) : ""}</span>
            <span class="c size num">{bytes(r.size)}</span>
            <span class="c peak num" class:hot={(r.peak_db ?? -99) >= 0} title="Loudest sample">{peak}</span>
            <span class="c origin" title={origin.long}><Icon name={origin.icon} size={13} />{origin.label}</span>

            <div class="tools">
              {#if waiting}
                <button class="btn sm tint" onclick={() => { cursorId = r.id; attachRender(r); }} title="Attach {nameOf(r)} to a song"><Icon name="link" size={14} /><span class="lbl">Attach</span></button>
              {:else}
                <button class="btn sm ghost" onclick={() => putBack(r)} title="Put back in the waiting list"><Icon name="undo" size={14} /><span class="lbl">Put back</span></button>
              {/if}
              <button class="icon-btn sm hide-narrow" aria-label="Delete {nameOf(r)}" title="Delete"
                      onclick={() => { cursorId = r.id; selected = new Set(); deleteTargets([r]); }}><Icon name="trash" size={15} /></button>
              <button class="icon-btn sm" aria-label="More about {nameOf(r)}" title="More"
                      onclick={(e) => showMenu(menuFor(r), { anchor: e.currentTarget })}><Icon name="more" size={16} /></button>
            </div>
          </div>
        {/each}
      </div>
      <p class="faint small foot num">{plural(items.length, "render")}{items.length !== all.length ? ` of ${all.length}` : ""}.{" "}<span class="keys">Arrows move, Space plays, Enter attaches, F2 renames, Delete removes.</span></p>
    {/if}
  {/if}
</div>

{#if dragging}
  <div class="drop glass-2" transition:fade={{ duration: 120 }} aria-hidden="true">
    <Icon name="upload" size={34} />
    <b>Drop to add to the inbox</b>
    <span class="muted">Audio files wait here until you say which song they belong to.</span>
  </div>
{/if}

<style>
  .small { font-size: var(--t-sm); }
  .bar-tools { gap: var(--s2); }
  .find { flex: 1 1 160px; max-width: 320px; min-width: 120px; }
  /* Sort, clear and more stay together and push to the right end; they wrap as one. */
  .tail { margin-left: auto; gap: var(--s2); flex-wrap: nowrap; }
  :global(html[data-narrow]) .bar-tools { flex-wrap: wrap; row-gap: var(--s2); }
  :global(html[data-narrow]) .tail { gap: 2px; }
  .bulk { padding: var(--s2) var(--s3); position: sticky; top: var(--s2); z-index: 5; gap: var(--s2); border-color: var(--accent-line); }

  .ups { padding: var(--s3) var(--s4); display: flex; flex-direction: column; gap: var(--s2); }
  .up { display: flex; align-items: center; gap: var(--s3); font-size: var(--t-sm); flex-wrap: wrap; }
  .up.bad { color: var(--bad); }
  .up .bar { flex: 0 0 100%; height: 3px; border-radius: 3px; background: var(--line); overflow: hidden; }
  .up .bar i { display: block; height: 100%; background: var(--accent); transition: width 160ms linear; }
  .up .bar.done i { background: var(--good); }
  .ups .end { align-self: flex-end; }

  .rlist { container-type: inline-size; padding-left: 0; padding-right: 0; outline-offset: 2px; }
  .rrow {
    height: 64px; display: flex; align-items: center; gap: var(--s3); padding: 0 var(--s3); position: relative;
    border-radius: var(--r-md); transition: background var(--fast); border-top: 1px solid transparent;
  }
  .rrow::before { content: ""; position: absolute; left: 10px; right: 10px; top: 0; border-top: 1px solid var(--line); }
  .rrow:first-child::before { display: none; }
  .rrow:hover { background: var(--hover); }
  .rrow.on { background: var(--accent-soft); }
  .rlist:focus-visible .rrow.cur { box-shadow: inset 0 0 0 2px var(--accent); }
  .rrow.cur:not(.on) { background: var(--hover); }
  .rrow.used .name { color: var(--text-2); }
  .rrow.live .name { color: var(--accent-text); }

  .chk {
    flex: none; width: 22px; height: 22px; border-radius: 50%; display: grid; place-items: center;
    border: 1.5px solid var(--line-2); color: var(--accent-ink); opacity: 0; transition: opacity var(--fast), background var(--fast);
  }
  .rrow:hover .chk, .rlist:focus-within .chk, .chk.on { opacity: 1; }
  .chk.on { background: var(--accent); border-color: transparent; }
  /* The name is what the row is for: it never gets less than this, and the columns around it
     give way in the order they matter least (see the container queries below). */
  .main { flex: 2 1 220px; min-width: 120px; display: flex; flex-direction: column; gap: 2px; }
  .name { font-weight: 600; cursor: text; }
  .main .field { max-width: 360px; }
  .sub { font-size: var(--t-sm); color: var(--text-2); display: flex; gap: var(--s2); align-items: center; }
  .went { display: inline-flex; gap: var(--s1); align-items: center; color: var(--accent-text); min-width: 0; }
  .went a { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .went a:hover { text-decoration: underline; }
  .narrow-meta { display: none; }
  .wave { flex: 1 1 120px; max-width: 240px; min-width: 70px; height: 30px; opacity: 0.9; }
  .c { flex: none; font-size: var(--t-sm); color: var(--text-2); text-align: right; }
  .date { width: 78px; } .dur { width: 46px; } .size { width: 62px; } .peak { width: 66px; }
  .peak.hot { color: var(--bad); }
  .origin { width: 76px; display: inline-flex; gap: var(--s1); align-items: center; justify-content: flex-start; color: var(--text-3); }
  .trouble { flex: none; }
  .tools { flex: none; display: flex; align-items: center; gap: 2px; }

  .skrow { height: 64px; display: flex; align-items: center; gap: var(--s3); padding: 0 var(--s3); }
  .sk.dot { width: 36px; height: 36px; border-radius: 50%; flex: none; }
  .sk.l1 { height: 13px; width: 55%; } .sk.l2 { height: 10px; width: 30%; }
  .sk.wv { height: 28px; width: 160px; flex: none; }
  .foot { padding: 0 var(--s2); }

  .drop {
    position: fixed; inset: var(--s5); z-index: 650; display: flex; flex-direction: column; align-items: center; justify-content: center;
    gap: var(--s2); text-align: center; pointer-events: none; border: 2px dashed var(--accent); color: var(--accent-text);
    border-radius: var(--r-xl); padding: var(--s5);
  }
  .drop b { font-size: var(--t-xl); color: var(--text); font-family: var(--display); }

  @container (max-width: 1040px) { .peak, .origin { display: none; } }
  @container (max-width: 900px) { .wave, .date { display: none; } .narrow-meta { display: inline; } .hide-narrow { display: none; } }
  @container (max-width: 640px) { .dur, .size { display: none; } .lbl { display: none; } .trouble { display: none; } .rrow { gap: var(--s2); } }
  @media (hover: none) { .chk { opacity: 1; } }
  @media (max-width: 640px) { .find { width: 100%; max-width: none; order: 5; flex: 1 1 100%; } }
  :global(html[data-narrow]) .keys { display: none; }
</style>
