<!-- The song: the heart of the app. One screen, one store (views/song/song.svelte.ts), a hero
     that says what the song is, a timeline under it, and tabs for the
     rest. Keyed by id and share in the shell, so a different song is a new component. -->
<script lang="ts">
  import { onMount } from "svelte";
  import Icon from "$ui/Icon.svelte";
  import Segmented from "$ui/Segmented.svelte";
  import { shell } from "../shell/state.svelte";
  import { replace, href } from "$lib/router.svelte";
  import { setGround, accent } from "$lib/look.svelte";
  import { useCommands } from "$lib/commands";
  import { hue } from "$lib/util";
  import { provideSong, SongStore } from "./song/song.svelte";
  import { GuestWork } from "./song/guestwork.svelte";
  import { Uploader } from "./song/uploads.svelte";
  import { shareSong } from "./song/share";
  import * as act from "./song/actions";
  import { isAudio, isImage } from "./song/helpers";
  import Hero from "./song/Hero.svelte";
  import Timeline from "./song/Timeline.svelte";
  import WordsTab from "./song/WordsTab.svelte";
  import SoundTab from "./song/SoundTab.svelte";
  import TakesTab from "./song/TakesTab.svelte";
  import ReleaseTab from "./song/ReleaseTab.svelte";
  import AboutTab from "./song/AboutTab.svelte";

  let { params }: { params: Record<string, string> } = $props();

  // The shell keys this screen on id and share, so these are read once on purpose.
  // svelte-ignore state_referenced_locally
  const song = provideSong(new SongStore(params.id, params.share || null));
  const uploader = new Uploader(song);
  // svelte-ignore state_referenced_locally
  const gw = song.guest ? null : new GuestWork(params.id);
  let hero = $state<{ startRename: () => void }>();
  onMount(() => { song.load().then(() => { if (song.has("sharing")) gw?.load(); }); });

  // ── the look follows the song and its cover ───────────────────────────────
  $effect(() => {
    if (!song.song) return;
    const cover = song.cover;
    setGround(cover, cover ? null : hue(song.song.title));
    accent.viewing(song.song, cover);
  });

  // ── tabs ──────────────────────────────────────────────────────────────────
  type Tab = "words" | "arrange" | "sound" | "takes" | "release" | "about";
  const tabs = $derived.by(() => {
    const out: { value: Tab; label: string; icon: string; badge?: number | null }[] = [];
    if (song.has("lyrics")) out.push({ value: "words", label: "Words", icon: "words" });
    // Arranging is a tab like the others: choosing it opens the timeline into the editor,
    // leaving it folds the timeline back. It used to be a dropdown on the timeline itself,
    // a second way of switching what the page is about, beside the tabs that already do.
    if (song.has("arrange") && song.has("versions") && song.current) out.push({ value: "arrange", label: "Arrange", icon: "timeline" });
    if (song.has("sound")) out.push({ value: "sound", label: "Sound", icon: "eq" });
    if (song.has("versions")) out.push({ value: "takes", label: "Renders", icon: "wave", badge: song.versions.length || null });
    if (!song.guest && (song.has("youtube") || song.has("sharing"))) out.push({ value: "release", label: "Release", icon: "rocket" });
    out.push({ value: "about", label: "About", icon: "info" });
    return out;
  });
  let local = $state<Tab | "">("");        // a guest's address has no room for a tab
  const tab = $derived<Tab>((tabs.find((t) => t.value === (song.guest ? local : params.tab))?.value ?? tabs[0].value));
  let tabbar = $state<HTMLElement>();
  // How far down the pinned tabs reach: what sticks inside a tab (the Words tools) sits under them.
  let tabsH = $state(40);
  /* Stuck: the tabs have reached the top and the page scrolls under them. Then a curtain
     behind them hides what scrolls past, so nothing shows above or beside the pill. */
  let stuck = $state(false);
  $effect(() => {
    const port = document.getElementById("scroller");
    if (!port || !tabbar) return;
    const check = () => { if (tabbar) stuck = tabbar.getBoundingClientRect().top - port.getBoundingClientRect().top <= 15; };
    check();
    port.addEventListener("scroll", check, { passive: true });
    return () => port.removeEventListener("scroll", check);
  });
  function choose(next: Tab) {
    if (song.guest) local = next; else replace(href.song(song.id, next));
    // On a phone the top of the song fills the screen: bring the tabs up so the tab you
    // picked is what you see, instead of a heading peeking above the dock.
    if (shell.narrow) requestAnimationFrame(() => {
      const box = tabbar?.getBoundingClientRect(), port = document.getElementById("scroller")?.getBoundingClientRect();
      if (box && port && box.top > port.top + 24) tabbar!.scrollIntoView({ block: "start", behavior: "smooth" });
    });
  }
  function keys(e: KeyboardEvent) {
    if (!e.altKey || e.ctrlKey || e.metaKey) return;
    const n = /^Digit([1-9])$/.exec(e.code)?.[1];
    const target = n ? tabs[Number(n) - 1] : undefined;
    if (!target) return;
    e.preventDefault(); choose(target.value);
  }

  // ── commands (Ctrl+K) ─────────────────────────────────────────────────────
  useCommands(() => !song.song ? [] : [
    { id: "song.play", group: "This song", title: song.playing ? "Pause" : "Play", sub: song.song.title, icon: song.playing ? "pause" : "play", hint: "Space", run: () => song.play() },
    ...(song.has("versions") && !song.guest ? [{ id: "song.addrender", group: "This song", title: "Add a render to this song", icon: "upload", run: () => uploader.pick() }] : []),
    ...(song.guest ? [] : [{ id: "song.rename", group: "This song", title: "Rename this song", icon: "edit", hint: "F2", run: () => hero?.startRename() }]),
    ...(song.has("sharing") ? [{ id: "song.share", group: "This song", title: "Share this song", icon: "share", run: () => shareSong(song) }] : []),
    { id: "song.download", group: "This song", title: "Download the current version", icon: "download", run: () => act.downloadVersion(song, song.current) },
    ...tabs.map((t, i) => ({ id: `song.tab.${t.value}`, group: "This song", title: `Go to ${t.label}`, icon: t.icon, hint: `Alt+${i + 1}`, run: () => choose(t.value) })),
  ]);

  // ── dropping files anywhere on the screen ─────────────────────────────────
  let dragging = $state(0);
  const hasFiles = (e: DragEvent) => !!e.dataTransfer && Array.from(e.dataTransfer.types).includes("Files");
  function ondrop(e: DragEvent) {
    dragging = 0;
    if (!hasFiles(e)) return;
    e.preventDefault();
    const files = Array.from(e.dataTransfer?.files || []);
    const audio = files.filter(isAudio), images = files.filter(isImage);
    if (audio.length && song.has("versions") && !song.guest) uploader.add(audio);
    if (images.length && song.has("artwork") && !song.guest) act.addArtwork(song, images);
  }
</script>

<svelte:window onkeydowncapture={keys}
  ondragenter={(e) => { if (hasFiles(e)) dragging++; }} ondragleave={(e) => { if (hasFiles(e)) dragging = Math.max(0, dragging - 1); }}
  ondragover={(e) => { if (hasFiles(e)) e.preventDefault(); }} ondrop={ondrop} />

<div class="page song" style:--below-tabs="{14 + tabsH + 8}px">
  {#if song.loading && !song.song}
    <div class="skeleton" aria-busy="true" aria-label="Loading the song">
      <div class="sk art"></div>
      <div class="col grow"><div class="sk" style="height:44px;width:60%"></div><div class="sk" style="height:16px;width:40%"></div><div class="sk" style="height:44px;width:70%;margin-top:12px"></div></div>
    </div>
    <div class="sk" style="height:140px"></div>
    <div class="sk" style="height:36px;width:min(100%,420px)"></div>
    <div class="sk" style="height:260px"></div>
  {:else if song.error || !song.song}
    <div class="empty">
      <Icon name="warning" size={30} />
      <h3>That song didn't load</h3>
      <p>{song.error}</p>
      <button class="btn" onclick={() => song.load()}>Try again</button>
    </div>
  {:else}
    {#if song.guest}
      <div class="notice accent guest">
        <span class="grow"><b>You are working on somebody else's song.</b>
          <span class="faint">Your changes go straight to their song, and they can undo any of it. You can't delete anything here.</span></span>
        <a class="btn sm ghost" href={href.share(song.share!)}>Back</a>
      </div>
    {/if}

    <Hero bind:this={hero} guestwork={gw} {uploader} pickArt={() => act.pickArtwork(song)} />

    {#if uploader.items.length}
      <div class="card uploads" role="status">
        {#each uploader.items as item, i (i)}
          <div class="row">
            <Icon name="upload" size={14} />
            <span class="grow truncate">{item.name}</span>
            <span class="faint num">{item.state === "failed" ? "failed" : item.state === "waiting" ? "waiting" : Math.round(item.fraction * 100) + "%"}</span>
          </div>
          <span class="bar"><span style:width="{item.fraction * 100}%"></span></span>
        {/each}
      </div>
    {/if}

    <!-- The tabs first: everything under them is the tab's, the timeline included (it
         opens into the arrangement editor on Arrange). -->
    <div class="tabbar" class:stuck bind:this={tabbar} bind:offsetHeight={tabsH}><Segmented options={tabs} value={tab} onchange={choose} label="Song sections" grow={shell.narrow} stack={shell.narrow} /></div>

    <!-- Shown on Arrange only. Kept mounted on the other tabs (hidden), because it is what
         loads this song's arrangement, and playing "as arranged" needs that from any tab. -->
    {#if song.has("versions")}
      <div class="timeline-slot" hidden={tab !== "arrange"}>
      <Timeline editing={tab === "arrange"} onediting={(on) => choose(on ? "arrange" : (tabs.find((t) => t.value !== "arrange")?.value ?? "about"))} />
      </div>
    {/if}

    {#key tab}
      <div class="pane enter">
        {#if tab === "arrange"}<!-- the editor is the timeline above -->
        {:else if tab === "words"}<WordsTab />
        {:else if tab === "sound"}<SoundTab />
        {:else if tab === "takes"}<TakesTab {uploader} />
        {:else if tab === "release"}<ReleaseTab {gw} />
        {:else}<AboutTab />{/if}
      </div>
    {/key}

    {#if dragging > 0}
      <div class="drop-hint" aria-hidden="true"><Icon name="upload" size={28} />Drop audio to add a render{song.has("artwork") ? ", or a picture for the artwork" : ""}</div>
    {/if}
  {/if}
</div>

<style>
  .song { position: relative; }
  .skeleton { display: flex; gap: var(--s6); align-items: flex-end; }
  .skeleton .art { width: 232px; aspect-ratio: 1; border-radius: var(--r-xl); flex: none; }
  @media (max-width: 640px) { .skeleton { flex-direction: column; align-items: stretch; } .skeleton .art { width: 60%; } }
  .guest { align-items: center; flex-wrap: wrap; }
  /* The tabs stay in reach while a tab scrolls under them. Solid, not glass: page content
     passes under it, and glass over moving content is what flickered. */
  .tabbar { display: flex; max-width: 100%; position: sticky; top: 14px; z-index: 6; align-self: stretch; }
  .tabbar::before {
    content: ""; position: absolute; z-index: -1; pointer-events: none; opacity: 0;
    left: calc(var(--s6) * -1); right: calc(var(--s6) * -1); top: -14px; bottom: -8px;
    background: linear-gradient(to bottom, var(--bg, #000) calc(100% - 8px), transparent);
    transition: opacity 160ms var(--ease);
  }
  .tabbar.stuck::before { opacity: 1; }
  .tabbar.stuck > :global(.seg) { box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.4); }
  :global(html[data-narrow]) .tabbar::before { left: calc(var(--s4) * -1); right: calc(var(--s4) * -1); }
  .tabbar > :global(.seg) { background: color-mix(in srgb, var(--bg, #0b0b0d) 94%, transparent); box-shadow: 0 6px 18px rgba(0, 0, 0, 0.45), inset 0 1px 2px rgba(0, 0, 0, 0.4); }
  .tabbar > :global(.seg.stack) { flex: 1; }
  .pane { min-width: 0; }
  .uploads { padding: var(--s3) var(--s4); display: flex; flex-direction: column; gap: var(--s2); }
  .bar { height: 4px; border-radius: 99px; background: var(--line-2); overflow: hidden; }
  .bar span { display: block; height: 100%; background: var(--accent); transition: width 200ms linear; }
  .drop-hint {
    position: fixed; inset: var(--gap); z-index: 600; display: flex; flex-direction: column; align-items: center; justify-content: center;
    gap: var(--s3); border: 2px dashed var(--accent); border-radius: var(--r-xl); background: color-mix(in srgb, var(--bg) 70%, transparent);
    font-weight: 600; pointer-events: none; backdrop-filter: blur(6px);
  }
</style>
