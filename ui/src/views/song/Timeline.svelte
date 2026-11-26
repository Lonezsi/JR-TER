<!-- The song's one timeline, under its hero.
     The render's waveform across the full width with the playhead on it, and on it everything
     about structure: the sections on the bar grid, the lyric cards pointing at them, loops.
     Compact (waveform, playhead, section strip) it is always there; "Arrange" (or E) opens
     the full arrangement editor with a smooth height transition, and remembers. It stands
     where the old compositor drawer, the lyric cards' section pointers and the waveform used
     to be three separate places. -->
<script lang="ts">
  import { onMount } from "svelte";
  import Icon from "$ui/Icon.svelte";
  import Switch from "$ui/Switch.svelte";
  import { arrange, state as A } from "$lib/audio/arrange.svelte";
  import { wave } from "$lib/audio/waveform";
  import { on } from "$lib/bus";
  import { get, attempt } from "$lib/api";
  import { player, arranged } from "$lib/player.svelte";
  import { contextMenu, type MenuItem } from "$lib/menu.svelte";
  import { anySheetOpen } from "$lib/dialog.svelte";
  import { resource } from "$lib/resource.svelte";
  import { toast } from "$lib/toast.svelte";
  import { useCommands } from "$lib/commands";
  import { u } from "$lib/api";
  import { time } from "$lib/util";
  import { useSong } from "./song.svelte";
  import Trace from "./timeline/Trace.svelte";
  import Editor from "./timeline/Editor.svelte";
  import type { Source } from "./timeline/sample";
  import { describe, exportMix } from "./timeline/exporting";
  import {
    rowsOf, setArranged, layOut, playFrom, seekAt, renameSection, removeClip, sheetTitle, lengthWords, type Sheet,
  } from "./timeline/edits.svelte";

  const song = useSong();

  /* Whether the editor is open belongs to the song's tabs (the Arrange tab), not to this
   * card: `editing` comes in, and asking to open or close goes out through `onediting`. */
  let { editing = false, onediting = () => {} }: { editing?: boolean; onediting?: (on: boolean) => void } = $props();
  const arrangeOn = $derived(song.has("arrange"));
  const myId = $derived(Number(song.id));

  // ── whether the editor is open ─────────────────────────────────────────────
  const open = $derived(editing && arrangeOn);
  let mounted = $state(false);                // the editor is built the first time it is wanted
  $effect(() => { if (open) mounted = true; });
  // Opening on nothing: there is one thing to do.
  $effect(() => { if (open && ready && !A.clips.length && laying === null) void lay(); });
  function setOpen(next: boolean) {
    if (next && !arrangeOn) return;
    onediting(next);
  }

  // ── the arrangement, which is one object for the whole app ─────────────────
  /* arrange.state holds one song's arrangement at a time, and the player runs from it. So
   * this song's is only fetched when that cannot disturb a song that is being heard as
   * arranged: loading ours over it would drop the player to the plain render halfway
   * through the song. */
  let attempted: number | null = null;
  $effect(() => {
    if (!arrangeOn || !song.song) return;
    const sid = A.songId, loaded = A.loaded;
    if (sid === myId && loaded) { attempted = myId; return; }
    if (sid === myId && attempted === myId) return;           // asked once and it would not come
    if (sid !== myId && !song.here && arranged()) return;     // another song is being heard arranged
    attempted = myId;
    void arrange.load(myId).catch(() => { /* the compact timeline still works without it */ });
  });

  const ready = $derived(arrangeOn && A.songId === myId && A.loaded);
  const blocked = $derived(arrangeOn && A.songId !== myId && !song.here && arranged());
  const clips = $derived(ready ? A.clips : []);
  const asArranged = $derived(ready && A.enabled && clips.length > 0);

  // ── what is drawn ──────────────────────────────────────────────────────────
  const version = $derived(song.versionOf("A") || song.current);
  /* When played as arranged, the arrangement's own render is the one being cut up, whichever
   * take happens to be in A. */
  const shown = $derived(asArranged && A.versionId != null
    ? song.versions.find((v) => String(v.id) === String(A.versionId)) || version : version);

  let peakTick = $state(0);
  onMount(() => on("arrange:ready", () => { peakTick++; }));

  // No picture from the server yet (it draws them in the background after an upload) and
  // none decoded: read the render once and draw it here. An offline audio context decodes
  // without the click a playing one waits for, so it starts as soon as the timeline shows.
  const asked = new Set<string>();
  $effect(() => {
    if (!shown || !editing) return;
    const key = String(shown.id);
    if (asked.has(key) || wave.known(shown.id) || (shown.shape && (shown.shape as number[]).length)) return;
    asked.add(key);
    const id = shown.id;
    void (async () => {
      try {
        const response = await fetch(u(`/api/versions/${id}/audio`));
        if (!response.ok) return;
        const bytes = await response.arrayBuffer();
        const decoded = await new OfflineAudioContext(1, 1, 44100).decodeAudioData(bytes);
        wave.remember(id, wave.peaksOf(decoded));
        peakTick++;
      } catch { /* the skeleton stays; nothing else depends on it */ }
    })();
  });

  const source = $derived.by<Source>(() => {
    void peakTick;
    return {
      peaks: shown ? wave.known(shown.id) : null,
      shape: ((shown?.shape as number[] | undefined) || null),
    };
  });
  const whole = $derived.by(() => {
    if (!shown) return 0;
    if (source.peaks && A.versionId != null && String(A.versionId) === String(shown.id)) return arrange.sourceSeconds() || shown.duration || 0;
    return shown.duration || 0;
  });
  const axis = $derived(asArranged ? arrange.duration()
    : song.here && player.duration ? player.duration : (shown?.duration || 0));

  const slices = $derived.by(() => {
    if (asArranged && whole) {
      return arrange.laid().map((r) => ({ at: r.at, seconds: r.seconds, from: r.sourceAt / whole, to: (r.sourceAt + r.seconds) / whole }));
    }
    return [{ at: 0, seconds: axis, from: 0, to: 1 }];
  });

  /* The sections as they are heard, or, when not arranged, where they sit in the render.
   * Sections belong to the render they were found in: on another take their bars are
   * somewhere else, so they are not drawn on it. */
  const fits = $derived(A.versionId == null || !version || String(A.versionId) === String(version.id));
  const rows = $derived(ready && (asArranged || fits) ? rowsOf(asArranged) : []);
  const bounds = $derived(rows.slice(1).map((r) => r.at).filter((t) => t > 0 && t < axis));

  // ── words ──────────────────────────────────────────────────────────────────
  const lyrics = resource<{ lyrics?: Sheet[] }>(
    () => (song.has("lyrics") ? get(`/api/songs/${song.id}/lyrics`) : Promise.resolve({ lyrics: [] })),
    { on: ["lyrics:changed"] });
  const sheets = $derived((lyrics.data?.lyrics || []) as Sheet[]);
  const linked = $derived(Object.keys(A.lyrics).length > 0 && sheets.length > 0);

  /* Whichever section is sounding, whether or not the lyrics tab is open: the card that is
   * pointed at it is the one shown here. */
  const sounding = $derived.by(() => {
    if (!song.here || !rows.length) return null;
    const p = player.position;
    return rows.find((r) => p >= r.at && p < r.at + r.seconds) || null;
  });
  const sheetOf = (partId: string | null) => (partId ? sheets.find((s) => s.id === A.lyrics[partId]) || null : null);
  const card = $derived(sheetOf(sounding?.partId ?? null));
  const cardLine = $derived((card?.text || "").split("\n").map((l) => l.trim()).find((l) => l && l !== sheetTitle(card!)) || "");

  // ── laying out, looping, exporting ─────────────────────────────────────────
  let laying = $state<number | null>(null);
  async function lay() {
    if (!ready || laying !== null) return;
    laying = 0;
    try { await layOut(song, (f) => { laying = f; }); } finally { laying = null; }
  }

  let loop = $state<{ from: number; to: number } | null>(null);
  let picking = $state(false);
  function setLoop(from: number, to: number) {
    loop = { from, to };
    picking = false;
    toast(`Looping ${time(from)} to ${time(to)}. Escape clears it.`);
    void playFrom(song, from);
  }

  let sending = $state<{ what: string; fraction: number } | null>(null);
  async function exportIt() {
    if (sending || song.guest) return;
    sending = { what: "starting", fraction: 0 };
    try {
      await attempt(() => exportMix(song, (what, fraction) => { sending = { what, fraction }; }));
    } finally { sending = null; }
  }
  const exportTitle = $derived.by(() => {
    const p = describe(song);
    const sound = p.bands || p.limiter ? `${p.presetName}${p.bands ? `, ${p.bands} band${p.bands === 1 ? "" : "s"}` : ""}${p.limiter ? ", limiter" : ""}` : "no equaliser";
    return `Export what you hear as a WAV: ${time(p.seconds)}${p.arranged ? ", as arranged" : ""}, through ${sound}`;
  });

  // ── keeping the decoded render warm ────────────────────────────────────────
  /* Reading the whole file is a real wait, so it starts when a song that plays as arranged
   * opens, or the editor is, and by the time anyone presses play it has usually happened.
   * The player bar says "Preparing the arrangement" for the rest. */
  $effect(() => { if (ready && clips.length && (A.enabled || open)) arrange.warm(); });

  // ── the compact strip ──────────────────────────────────────────────────────
  let strip = $state<HTMLDivElement>();
  const stripKey = $derived(rows.length ? (A.selected && rows.find((r) => r.clipId === A.selected)?.key) || rows[0].key : "");

  function chooseRow(row: (typeof rows)[number], play = false) {
    if (row.clipId) arrange.select(row.clipId);
    if (play) void playFrom(song, row.at); else void seekAt(song, row.at);
  }
  function focusRow(key: string) {
    const node = strip?.querySelector<HTMLElement>(`[data-key="${CSS.escape(key)}"]`);
    node?.focus({ preventScroll: true });
    const row = rows.find((r) => r.key === key);
    if (row?.clipId) arrange.select(row.clipId);
  }
  function stripKeys(e: KeyboardEvent) {
    const key = (e.target as HTMLElement).closest<HTMLElement>("[data-key]")?.dataset.key;
    const i = rows.findIndex((r) => r.key === key);
    if (i < 0) return;
    const row = rows[i];
    const mod = e.ctrlKey || e.metaKey || e.altKey;
    if (!mod && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
      e.preventDefault();
      focusRow(rows[Math.max(0, Math.min(rows.length - 1, i + (e.key === "ArrowLeft" ? -1 : 1)))].key);
    } else if (!mod && (e.key === "Home" || e.key === "End")) {
      e.preventDefault(); focusRow(rows[e.key === "Home" ? 0 : rows.length - 1].key);
    } else if (e.key === "Enter") {
      e.preventDefault(); void renameSection(row.partId);
    } else if (!mod && (e.key === "Backspace" || e.key === "Delete") && row.clipId) {
      e.preventDefault();
      const next = rows[i + 1] || rows[i - 1];
      removeClip(row.clipId);
      if (next) requestAnimationFrame(() => focusRow(next.key));
    } else if (!mod && e.key.toLowerCase() === "p") {
      e.preventDefault(); void playFrom(song, row.at);
    } else if (e.altKey && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
      // Moving and trimming a beat at a time lives in the editor, where the grid is.
      e.preventDefault(); setOpen(true);
    }
  }
  function rowMenu(row: (typeof rows)[number]): MenuItem[] {
    return [
      { group: row.name },
      { label: "Play from here", icon: "play", hint: "P", run: () => chooseRow(row, true) },
      { label: "Loop this section", icon: "repeat", run: () => setLoop(row.at, row.at + row.seconds) },
      row.partId ? { label: "Rename this section", icon: "edit", hint: "Enter", run: () => renameSection(row.partId) } : null,
      { label: "Edit in the arrangement", icon: "timeline", run: () => { if (row.clipId) arrange.select(row.clipId); setOpen(true); } },
      row.clipId && asArranged ? { divider: true } : null,
      row.clipId && asArranged ? { label: "Remove from the arrangement", icon: "trash", danger: true, hint: "Backspace", run: () => removeClip(row.clipId!) } : null,
    ];
  }

  // ── keys and commands ──────────────────────────────────────────────────────
  function key(e: KeyboardEvent) {
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
    const target = e.target as HTMLElement | null;
    if (target?.closest("input, textarea, select, [contenteditable='true']")) return;
    if (e.key === "Escape" && loop) { loop = null; picking = false; return; }
    if (e.key.toLowerCase() !== "e" || !arrangeOn || anySheetOpen()) return;
    e.preventDefault();
    setOpen(!open);
  }

  async function flip() {
    if (!ready) return;
    await setArranged(song, !A.enabled);
  }

  useCommands(() => !song.has("versions") ? [] : [
    ...(arrangeOn ? [
      { id: "timeline.arranged", group: "Timeline", title: A.enabled ? "Stop playing as arranged" : "Play as arranged", sub: song.song?.title, icon: "timeline", keywords: "arrangement compositor", run: flip },
      { id: "timeline.detect", group: "Timeline", title: "Detect the tempo and lay out sections", icon: "refresh", keywords: "bpm beat sections arrange", run: () => { if (!open) setOpen(true); else void lay(); } },
      { id: "timeline.editor", group: "Timeline", title: open ? "Close the arrangement editor" : "Open the arrangement editor", icon: "timeline", hint: "E", run: () => setOpen(!open) },
    ] : []),
    ...(!song.guest ? [{ id: "timeline.export", group: "Timeline", title: "Export what you hear (WAV)", sub: song.song?.title, icon: "download", keywords: "bounce render download wav", run: exportIt }] : []),
  ]);

  const seconds = $derived(Math.floor(song.here ? player.position : 0));
</script>

<svelte:window onkeydown={key} />

{#if song.has("versions") && song.current}
  <section class="timeline card" aria-label="Timeline" data-swipe>
    <div class="top">
      <span class="eyebrow">Timeline</span>
      <span class="meta faint num">{time(seconds)} / {time(axis)}{#if ready && clips.length}{" · "}{Math.round(A.bpm)} bpm{/if}</span>
      <span class="grow"></span>

      {#if loop}
        <button class="chip on" onclick={() => (loop = null)} title="Stop looping (Escape)">
          <Icon name="repeat" size={13} /><span class="num">{time(loop.from)}&ndash;{time(loop.to)}</span><Icon name="close" size={12} />
        </button>
      {/if}
      <button class="icon-btn sm" class:on={picking} aria-pressed={picking}
              aria-label="Pick a stretch to loop" title="Pick a stretch to loop: drag on the waveform (or Alt+drag)"
              onclick={() => (picking = !picking)}><Icon name="repeat" size={16} /></button>
      {#if !song.guest}
        <button class="icon-btn sm" aria-label="Export what you hear" title={exportTitle} disabled={!!sending} onclick={exportIt}>
          {#if sending}<span class="spinner"></span>{:else}<Icon name="download" size={16} />{/if}
        </button>
      {/if}
      {#if arrangeOn}
        <label class="onoff" title={clips.length ? "Play this song through the arrangement instead of straight through" : "Lay the song out first"}>
          <Switch checked={asArranged} disabled={!ready || !clips.length} label="Play this song as arranged" onchange={flip} />
          <span>As arranged</span>
        </label>
      {/if}
    </div>

    {#if sending}
      <div class="sending" role="status">
        <span class="faint small">Exporting: {sending.what}</span>
        <span class="progress"><i style:width="{Math.round(sending.fraction * 100)}%"></i></span>
      </div>
    {/if}

    <Trace duration={axis} {slices} {source} {bounds} {loop} {picking} onpick={setLoop}
           label={asArranged ? "Position in the arrangement" : "Position in the song"} />

    {#if arrangeOn && !open}
      {#if rows.length}
        <!-- svelte-ignore a11y_interactive_supports_focus -->
        <div class="strip" bind:this={strip} role="listbox" aria-label="Sections" aria-orientation="horizontal" onkeydown={stripKeys}>
          {#each rows as row (row.key)}
            {@const sheet = sheetOf(row.partId)}
            <button class="seg" class:on={!!row.clipId && A.selected === row.clipId} class:live={sounding?.key === row.key}
                    role="option" aria-selected={!!row.clipId && A.selected === row.clipId}
                    tabindex={row.key === stripKey ? 0 : -1} data-key={row.key}
                    style:left="{axis ? (row.at / axis) * 100 : 0}%" style:width="{axis ? (row.seconds / axis) * 100 : 0}%"
                    style:--hue={row.hue}
                    title="{row.name}, {lengthWords(row.beats)}{sheet ? `, words: ${sheetTitle(sheet)}` : ''}"
                    onclick={() => chooseRow(row)}
                    ondblclick={() => setOpen(true)}
                    use:contextMenu={() => rowMenu(row)}>
              <span class="n truncate">{row.name}</span>
              {#if sheet}<span class="w truncate"><Icon name="words" size={11} />{sheetTitle(sheet)}</span>{/if}
            </button>
          {/each}
        </div>
      {:else if blocked}
        <div class="notice small">Another song is being heard as arranged. Stop it to work on this one's sections.</div>
      {:else if ready}
        <div class="strip nothing">
          <span class="faint small">No sections yet.</span>
          <button class="btn sm ghost" onclick={() => { if (!open) setOpen(true); else void lay(); }} disabled={laying !== null}>
            {laying !== null ? `Listening… ${Math.round(laying * 100)}%` : "Listen and lay it out"}
          </button>
        </div>
      {/if}
      {#if linked}
        <div class="now" aria-live="off">
          {#if card}
            <Icon name="words" size={13} /><b class="truncate">{sheetTitle(card)}</b>
            {#if cardLine}<span class="faint truncate">{cardLine}</span>{/if}
          {/if}
        </div>
      {/if}
    {/if}

    {#if arrangeOn}
      <div class="reveal" class:open id="arrangement-editor" inert={!open}>
        <div class="inner">
          {#if mounted && ready}
            <Editor {sheets} {source} {whole} {laying} {asArranged} onlay={lay} onloop={setLoop} />
          {:else if mounted && blocked}
            <div class="notice small">Another song is being heard as arranged. Stop it to work on this one's sections.</div>
          {/if}
          {#if mounted && ready && linked && card}
            <div class="now in" aria-live="off">
              <Icon name="words" size={13} /><b class="truncate">{sheetTitle(card)}</b>
              {#if cardLine}<span class="faint truncate">{cardLine}</span>{/if}
            </div>
          {/if}
        </div>
      </div>
    {/if}
  </section>
{/if}

<style>
  .timeline { padding: var(--s3) var(--s4) var(--s4); display: flex; flex-direction: column; gap: var(--s3); min-width: 0; }
  .top { display: flex; align-items: center; gap: var(--s2); flex-wrap: wrap; min-height: 32px; }
  .meta { font-size: var(--t-sm); }
  .small { font-size: var(--t-sm); }
  .onoff { display: inline-flex; align-items: center; gap: var(--s2); font-size: var(--t-sm); font-weight: 600; color: var(--text-2); cursor: pointer; margin-left: var(--s1); }
  .onoff :global(.switch) { width: 38px; height: 22px; }
  .onoff :global(.knob) { width: 18px; height: 18px; }
  .onoff :global(.switch.on .knob) { transform: translateX(16px); }

  .sending { display: flex; align-items: center; gap: var(--s3); }
  .progress { flex: 1 1 auto; height: 4px; border-radius: 4px; background: var(--line-2); overflow: hidden; }
  .progress i { display: block; height: 100%; background: var(--accent); transition: width var(--med); }

  /* Sections, on the same axis as the waveform above, so each one sits under its own stretch. */
  .strip { position: relative; height: 36px; border-radius: var(--r-sm); }
  .strip.nothing { display: flex; align-items: center; gap: var(--s3); padding: 0 var(--s2); background: var(--hover); }
  .seg {
    position: absolute; top: 0; bottom: 0; min-width: 6px; padding: 0 var(--s2); overflow: hidden; text-align: left;
    display: flex; flex-direction: column; justify-content: center; gap: 1px; box-sizing: border-box;
    border-radius: var(--r-sm); border: 1px solid hsl(var(--hue) 38% 30%);
    background: linear-gradient(180deg, hsl(var(--hue) 44% 24%), hsl(var(--hue) 40% 16%));
    color: var(--text-on-color); font-size: 11.5px; font-weight: 600; line-height: 1.15;
    transition: filter var(--fast), box-shadow var(--fast);
  }
  .seg:hover { filter: brightness(1.15); }
  .seg:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
  .seg.on { box-shadow: 0 0 0 2px var(--accent); }
  .seg.live { box-shadow: inset 0 2px 0 var(--accent-hi), 0 0 18px color-mix(in srgb, var(--accent) 22%, transparent); }
  .seg.on.live { box-shadow: 0 0 0 2px var(--accent), inset 0 2px 0 var(--accent-hi); }
  .seg .n { text-shadow: 0 1px 3px rgba(0, 0, 0, 0.6); }
  .seg .w { display: flex; align-items: center; gap: var(--s1); font-weight: 600; font-size: 10.5px; opacity: 0.8; }

  /* One line, always the same height when any words are pointed at a section, so the card
     lighting up never moves what is under it. */
  .now { display: flex; align-items: center; gap: var(--s2); min-height: 20px; font-size: var(--t-sm); color: var(--accent-text); min-width: 0; }
  .now b { color: var(--text); font-weight: 600; }
  .now.in { margin-top: var(--s2); }

  /* The editor opening: height from nothing to what it needs, then its content. */
  .reveal { display: grid; grid-template-rows: 0fr; opacity: 0; transition: grid-template-rows var(--sheet), opacity var(--fast); }
  .reveal.open { grid-template-rows: 1fr; opacity: 1; }
  .inner { overflow: hidden; min-height: 0; min-width: 0; }
  @media (prefers-reduced-motion: reduce) { .reveal { transition: none; } }
  @media (max-width: 640px) { .timeline { padding: var(--s3); } }
</style>
