<!-- The top of the song: its picture, its name, what it is, and the two takes you compare. -->
<script lang="ts">
  import Icon from "$ui/Icon.svelte";
  import Cover from "$ui/Cover.svelte";
  import { contextMenu, showMenu, type MenuItem } from "$lib/menu.svelte";
  import { swap as swapPlayer } from "$lib/player.svelte";
  import { time, when, date, plural, debounce } from "$lib/util";
  import { href } from "$lib/router.svelte";
  import { copyText } from "$lib/actions";
  import { useSong } from "./song.svelte";
  import type { GuestWork } from "./guestwork.svelte";
  import type { Uploader } from "./uploads.svelte";
  import SlotPicker from "./SlotPicker.svelte";
  import { openSlot } from "./slotmenu";
  import { shareSong } from "./share";
  import * as act from "./actions";
  import { versionName } from "./helpers";

  let { guestwork, uploader, pickArt }: { guestwork: GuestWork | null; uploader: Uploader; pickArt: () => void } = $props();
  const song = useSong();

  const s = $derived(song.song!);
  const current = $derived(song.current);
  const editable = $derived(!song.guest);

  // ── the description (the song's notes) ──────────────────────────────────
  // svelte-ignore state_referenced_locally
  let notes = $state(String((song.song as any)?.notes ?? ""));
  let descBox = $state<HTMLTextAreaElement>();
  const hasNotes = $derived("notes" in (song.song || {}));
  const saveNotes = debounce(() => act.setNotes(song, notes), 900);
  function growDesc() { if (descBox) { descBox.style.height = "auto"; descBox.style.height = descBox.scrollHeight + "px"; } }
  $effect(() => { void descBox; void notes; requestAnimationFrame(growDesc); });

  // ── the title, in place ───────────────────────────────────────────────────
  let editing = $state(false);
  let draft = $state("");
  let input = $state<HTMLInputElement>();
  let names = $state(false);

  export function startRename() {
    if (!editable) return;
    draft = s.title; editing = true;
    queueMicrotask(() => { input?.focus(); input?.select(); });
  }
  function finish(save: boolean) {
    if (!editing) return;
    editing = false;
    if (save) act.rename(song, draft);
  }
  function onwindow(e: KeyboardEvent) {
    if (e.key !== "F2" || editing) return;
    const t = e.target as HTMLElement;
    if (t.closest?.("input, textarea, select")) return;
    e.preventDefault(); startRename();
  }

  // ── A and B ───────────────────────────────────────────────────────────────
  let compareBtn = $state<HTMLElement>();
  function swapAB() {
    if (song.here) { swapPlayer(); return; }
    const a = song.versionOf("A"), b = song.versionOf("B");
    if (!a || !b) return;
    song.setVersion("A", b); song.setVersion("B", a);
  }

  const moreItems = (): MenuItem[] => [
    { label: current ? `Download ${versionName(current)}` : "Download", icon: "download", disabled: !current, run: () => act.downloadVersion(song, current) },
    { divider: true },
    editable ? { label: "Rename", icon: "edit", hint: "F2", run: startRename } : null,
    song.has("artwork") ? { label: "Change the artwork", icon: "image", run: pickArt } : null,
    { label: "Copy the name", icon: "copy", run: () => copyText(s.title) },
    { label: "Copy the link", icon: "link", run: () => act.copyLink(song) },
    editable ? { divider: true } : null,
    editable ? { label: "Delete song", icon: "trash", danger: true, run: () => act.deleteSong(song) } : null,
  ];
  const coverItems = (): MenuItem[] => [
    { label: song.artwork.length ? "Change the artwork" : "Add artwork", icon: "image", run: pickArt },
    song.artwork.length > 1 ? { label: `Pick from the ${song.artwork.length} it has`, icon: "grid", hint: "About tab" } : null,
    song.artwork.length ? { divider: true } : null,
    song.artwork.length ? { label: "Remove the artwork", icon: "trash", danger: true, run: () => act.removeArtwork(song, song.artwork[0].id) } : null,
  ];
  const titleItems = (): MenuItem[] => [
    editable ? { label: "Rename", icon: "edit", hint: "F2", run: startRename } : null,
    song.previous.length ? { label: `Names it has had (${song.previous.length})`, icon: "history", run: () => (names = true) } : null,
    { divider: true },
    { label: "Copy the name", icon: "copy", run: () => copyText(s.title) },
  ];
</script>

<svelte:window onkeydown={onwindow} />

{#if !song.guest}<a class="btn ghost sm uplink" href={href.library()} data-up><Icon name="chev-left" size={16} /> Library</a>{/if}
<header class="hero">
  <div class="art">
    {#if song.has("artwork") && editable}
      <button class="cover-btn" onclick={pickArt} aria-label="Change artwork" use:contextMenu={coverItems}>
        <Cover url={song.cover} title={s.title} size="100%" radius="var(--r-xl)" class="hero-cover" />
        <span class="pen"><Icon name="edit" size={16} /></span>
      </button>
    {:else}
      <Cover url={song.cover} title={s.title} size="100%" radius="var(--r-xl)" class="hero-cover" />
    {/if}
  </div>

  <div class="meta">
    <div class="title-row" use:contextMenu={titleItems}>
      {#if editing}
        <input class="title-input" bind:this={input} bind:value={draft} maxlength="200" aria-label="Song title"
               onkeydown={(e) => { if (e.key === "Enter") { e.preventDefault(); finish(true); } if (e.key === "Escape") { e.preventDefault(); finish(false); } }}
               onblur={() => finish(true)} />
      {:else if editable}
        <h1><button class="title" onclick={startRename} title="Click to rename (F2)">{s.title}</button></h1>
      {:else}
        <h1 class="title">{s.title}</h1>
      {/if}
    </div>

    {#if song.previous.length}
      <div class="former">
        <button class="chip" onclick={() => (names = !names)} aria-expanded={names}>
          formerly <b>{song.previous[0].title}</b>{song.previous.length > 1 ? ` and ${song.previous.length - 1} more` : ""}
          <Icon name={names ? "chev-up" : "chev-down"} size={12} />
        </button>
        {#if names}
          <ul class="names card">
            {#each song.previous as p, i (i)}
              <li><span class="truncate">{p.title}</span><span class="faint">{p.changed_at ? when(p.changed_at) : ""}</span></li>
            {/each}
          </ul>
        {/if}
      </div>
    {/if}

    <!-- Each fact carries its own separator (::before), so a wrap never leaves a dot hanging
         at the end of a line. The dates get a line of their own. -->
    <p class="facts muted">
      {#if current}
        <b class="num">{versionName(current)}</b>
        {#if current.duration}<span class="num">{time(current.duration)}</span>{/if}
        <span>{plural(song.versions.length, "render")}</span>
      {:else if song.has("versions")}
        <span>no renders yet</span>
      {/if}
      {#each song.albums as a (a.id)}
        <a class="album" href={href.album(a.id)}>{a.title}</a>
      {/each}
    </p>
    {#if s.created_at}
      <p class="dates faint" title="Started {date(s.created_at)}{s.updated_at && s.created_at && s.updated_at > s.created_at ? ', last touched ' + date(s.updated_at) : ''}">started {when(s.created_at)}{#if s.updated_at && s.created_at && s.updated_at - s.created_at > 86400}, touched {when(s.updated_at)}{/if}</p>
    {/if}

    <!-- What it's about, in the song's own words: the notes, edited right here. -->
    {#if hasNotes && (editable || notes)}
      <textarea class="desc" bind:this={descBox} bind:value={notes} readonly={!editable} rows="1"
                placeholder="Add a description…" aria-label="Description"
                oninput={() => { growDesc(); saveNotes(); }} onblur={() => saveNotes.now()}></textarea>
    {/if}

    <!-- One row, two halves: play on the left, what you do to the song on the right. A and B
         live on the Sound tab, not up here. -->
    <div class="actions">
      <div class="listen">
        {#if current}
          <button class="play-btn lg accent" onclick={() => song.play()} aria-label={song.playing ? "Pause" : "Play"}>
            <Icon name={song.playing ? "pause" : "play"} size={24} />
          </button>
        {/if}
      </div>
      <div class="manage">
        {#if song.has("versions") && !song.guest}
          <button class="btn" onclick={() => uploader.pick()}><Icon name="upload" size={16} />{current ? "Add render" : "Add the first render"}</button>
        {/if}
        {#if song.has("sharing")}
          <button class="btn ghost" onclick={() => shareSong(song)} title="Let somebody else work on this song"><Icon name="share" size={16} />Share</button>
        {/if}
        <button class="icon-btn" aria-label="More" title="More" onclick={(e) => showMenu(moreItems(), { anchor: e.currentTarget })}><Icon name="more" size={20} /></button>
      </div>
    </div>
  </div>
</header>

<style>
  .hero { display: grid; grid-template-columns: minmax(160px, 232px) 1fr; gap: var(--s6); align-items: end; }
  .art { aspect-ratio: 1; width: 100%; position: relative; border-radius: var(--r-xl); box-shadow: var(--shadow-3); }
  .cover-btn { position: relative; display: block; width: 100%; height: 100%; border-radius: var(--r-xl); }
  .pen {
    position: absolute; right: 10px; bottom: 10px; display: grid; place-items: center; width: 32px; height: 32px;
    border-radius: 50%; background: rgba(0, 0, 0, 0.55); color: #fff; opacity: 0; transition: opacity var(--fast);
  }
  .cover-btn:hover .pen, .cover-btn:focus-visible .pen { opacity: 1; }
  @media (pointer: coarse) { .pen { opacity: 1; } }
  .meta { display: flex; flex-direction: column; gap: var(--s3); min-width: 0; }
  h1 { margin: 0; }
  .title {
    font: inherit; letter-spacing: inherit; text-align: left; color: inherit; max-width: 100%;
    overflow-wrap: anywhere; border-radius: var(--r-md); padding: 0 2px; margin: 0 -2px;
  }
  button.title:hover { background: var(--hover); }
  .title-input {
    width: 100%; font: 800 var(--t-3xl)/1.12 var(--display); color: var(--text); background: rgba(0, 0, 0, 0.28);
    border: 1px solid var(--accent); border-radius: var(--r-md); padding: 0 var(--s3); box-shadow: 0 0 0 3px var(--accent-soft);
  }
  .former { position: relative; }
  .names { list-style: none; margin: var(--s2) 0 0; padding: var(--s2); display: flex; flex-direction: column; gap: 2px; max-width: 360px; }
  .names li { display: flex; justify-content: space-between; gap: var(--s4); padding: var(--s1) var(--s2); font-size: var(--t-sm); }
  .facts { display: flex; flex-wrap: wrap; align-items: center; gap: 0 var(--s2); font-size: var(--t-sm); margin: 0; }
  .facts b { color: var(--text); }
  .facts > * { display: inline-flex; align-items: center; gap: var(--s2); white-space: nowrap; }
  .facts > * + *::before { content: ""; width: 3px; height: 3px; border-radius: 50%; background: var(--text-3); flex: none; }
  .dates { margin: calc(var(--s2) * -1) 0 0; font-size: var(--t-sm); }
  .album { color: var(--text-2); text-decoration: underline; text-decoration-color: var(--line-2); text-underline-offset: 3px; }
  .album:hover { color: var(--text); text-decoration-color: currentColor; }
  .meta { container: meta / inline-size; }
  /* One cluster from the left, like the album's: play, then what you do to the song. */
  .actions { display: flex; align-items: center; justify-content: flex-start; gap: var(--s3); flex-wrap: wrap; margin-top: var(--s2); }
  .listen, .manage { display: flex; align-items: center; gap: var(--s2); flex-wrap: wrap; min-width: 0; }
  .listen { gap: var(--s3); }
  .desc {
    width: 100%; max-width: 640px; resize: none; overflow: hidden; background: transparent; border: 0; outline: 0;
    padding: 2px 0; font: 500 var(--t-md)/1.5 var(--font); color: var(--text-2); border-radius: 6px;
  }
  .desc:hover:not([readonly]), .desc:focus { color: var(--text); }
  .desc::placeholder { color: var(--text-3); }
  /* Too narrow for both halves on one line: the second starts its own, from the left. */
  /* A phone: play and the rest still fit one row, so keep them on it rather than stacking. */
  @container meta (max-width: 420px) {
    .actions { flex-wrap: nowrap; gap: var(--s3); }
    .manage { flex-wrap: nowrap; }
  }
  @media (max-width: 640px) {
    .hero { grid-template-columns: 1fr; align-items: start; }
    .art { max-width: var(--hero-art); margin: 0 auto; }
  }

  /* Up one level: where this lives. Back always means up (H does the same). */
  .uplink { align-self: flex-start; margin: calc(var(--s2) * -1) 0 calc(var(--s1) * -1) calc(var(--s2) * -1); color: var(--text-2); }
</style>
