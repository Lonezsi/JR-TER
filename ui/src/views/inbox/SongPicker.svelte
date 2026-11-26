<!-- Which song. The body of the attach sheet.

     The likely answer first: the server's own guess from the name (the same question the
     desktop agent asks before it uploads), so a render called "caramel v3" next to a song
     called Caramel is not something anyone scrolls for. Then a new song in one step, then
     everything, filtered as you type. Arrows move, Enter takes the lit row. -->
<script lang="ts">
  import { get } from "$lib/api";
  import { coverOf } from "$lib/player.svelte";
  import { plural } from "$lib/util";
  import type { Song } from "$lib/types";
  import Cover from "$ui/Cover.svelte";
  import Icon from "$ui/Icon.svelte";
  import type { Picked } from "./attach";

  let { name, many = 1, verb = "Add", close }: {
    name: string; many?: number; verb?: string; close: (value?: Picked | null) => void;
  } = $props();

  interface Match { song_id: number; title: string; score: number }

  let songs = $state<Song[] | null>(null);
  let near = $state<Match[]>([]);
  let error = $state("");
  let needle = $state("");
  // svelte-ignore state_referenced_locally
  let title = $state(name);
  let lit = $state(0);
  let list = $state<HTMLElement>();

  async function load() {
    error = "";
    try {
      // The guess is a nicety: the list must not wait for it, or fail with it.
      get(`/api/songs/match?name=${encodeURIComponent(name)}`)
        .then((found) => { near = found.matches || []; }).catch(() => { near = []; });
      songs = (await get("/api/songs")).songs || [];
    } catch (e) {
      error = (e as Error).message || "The songs did not load.";
    }
  }
  load();

  const MOST = 150;   // a sheet is not a library: past this, typing is the way in
  const byId = $derived(new Map((songs || []).map((song) => [song.id, song])));
  const likely = $derived(needle.trim() ? [] : near.map((m) => byId.get(m.song_id)).filter(Boolean) as Song[]);
  const likelyIds = $derived(new Set(likely.map((song) => song.id)));
  const found = $derived.by(() => {
    const want = needle.trim().toLowerCase();
    const all = songs || [];
    return want ? all.filter((song) => song.title.toLowerCase().includes(want))
      : all.filter((song) => !likelyIds.has(song.id));
  });
  const shown = $derived(found.slice(0, MOST));
  // One flat run for the arrow keys: the guesses, then the rest.
  const rows = $derived([...likely, ...shown]);

  $effect(() => { void needle; void near.length; lit = 0; });

  const take = (song: Song) => close({ song_id: song.id, title: song.title });
  const fresh = () => { const said = title.trim(); if (said) close({ title: said }); };

  function onkey(e: KeyboardEvent) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (!rows.length) return;
      e.preventDefault();
      lit = (lit + (e.key === "ArrowDown" ? 1 : -1) + rows.length) % rows.length;
      list?.querySelector(`[data-at="${lit}"]`)?.scrollIntoView({ block: "nearest" });
    } else if (e.key === "Enter" && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      // Nothing matches what was typed: the typing was a title.
      if (rows[lit]) take(rows[lit]);
      else if (needle.trim()) close({ title: needle.trim() });
    }
  }
</script>

{#snippet row(song: Song, at: number)}
  <button type="button" class="item pick" class:lit={at === lit} data-at={at}
          onclick={() => take(song)} onpointermove={() => (lit = at)}>
    <Cover url={coverOf(song)} title={song.title} size={36} />
    <span class="grow col text">
      <span class="t truncate">{song.title}</span>
      <span class="s num">{plural(song.version_count || 0, "render")}</span>
    </span>
    <span class="go num">{verb} as v{(song.latest_version || song.version_count || 0) + 1}{many > 1 ? ` to v${(song.latest_version || song.version_count || 0) + many}` : ""}</span>
  </button>
{/snippet}

<div class="picker">
  <div class="find">
    <Icon name="search" size={16} />
    <input class="field" placeholder="Find a song" autocomplete="off" spellcheck="false"
           aria-label="Find a song" bind:value={needle} onkeydown={onkey} />
  </div>

  <div class="rows" bind:this={list}>
    {#if error}
      <div class="notice bad">
        <span class="grow">{error}</span>
        <button class="btn sm" onclick={load}>Try again</button>
      </div>
    {:else if !songs}
      {#each { length: 5 } as _}
        <div class="item"><span class="sk cover"></span><span class="grow col text"><span class="sk line"></span><span class="sk line short"></span></span></div>
      {/each}
    {:else}
      {#if likely.length}
        <div class="eyebrow">Looks like</div>
        {#each likely as song, i (song.id)}{@render row(song, i)}{/each}
      {/if}

      {#if !needle.trim()}
        <div class="eyebrow">Or a new one</div>
        <form class="new" onsubmit={(e) => { e.preventDefault(); fresh(); }}>
          <span class="plus"><Icon name="plus" size={18} /></span>
          <label class="grow col text">
            <span class="s">{many > 1 ? `One new song, holding all ${many}` : "New song from this, as its v1"}</span>
            <input class="field sm" bind:value={title} maxlength="200" aria-label="Title of the new song" />
          </label>
          <button class="btn sm tint" type="submit" disabled={!title.trim()}>Create</button>
        </form>
        {#if many > 1}
          <button type="button" class="item pick" onclick={() => close({ each: true })}>
            <span class="plus"><Icon name="songs" size={18} /></span>
            <span class="grow col text">
              <span class="t">A new song for each</span>
              <span class="s">{many} songs, each named after its render</span>
            </span>
            <span class="go">Create {many}</span>
          </button>
        {/if}
      {/if}

      {#if shown.length}
        <div class="eyebrow">{needle.trim() ? "Matches" : likely.length ? "Everything else" : "Your songs"}</div>
        {#each shown as song, i (song.id)}{@render row(song, likely.length + i)}{/each}
        {#if found.length > shown.length}
          <p class="faint more">{found.length - shown.length} more. Type to narrow it down.</p>
        {/if}
      {:else if needle.trim()}
        <button type="button" class="item pick lit" onclick={() => close({ title: needle.trim() })}>
          <span class="plus"><Icon name="plus" size={18} /></span>
          <span class="grow col text">
            <span class="t truncate">New song called {needle.trim()}</span>
            <span class="s">No song has that in its title</span>
          </span>
          <span class="go">Create</span>
        </button>
      {:else if !songs.length}
        <p class="faint more">No songs yet. Make one above.</p>
      {/if}
    {/if}
  </div>
</div>

<style>
  .picker { display: flex; flex-direction: column; gap: var(--s3); }
  .find { position: relative; color: var(--text-3); }
  .find :global(svg) { position: absolute; left: 12px; top: 50%; transform: translateY(-50%); pointer-events: none; }
  .find .field { padding-left: var(--s7); }
  /* A fixed height, so the sheet does not change size as the filter narrows the list. */
  .rows { display: flex; flex-direction: column; gap: 2px; height: min(52vh, 460px); overflow-y: auto; margin: 0 calc(var(--s2) * -1); padding: 0 var(--s2); }
  .eyebrow { padding: var(--s3) var(--s3) var(--s1); }
  .eyebrow:first-child { padding-top: var(--s1); }
  .text { gap: 2px; }
  .pick { width: 100%; text-align: left; flex: none; }
  .pick.lit { background: var(--hover); }
  .go { flex: none; font-size: var(--t-sm); font-weight: 600; color: var(--text-3); }
  .pick.lit .go { color: var(--accent-text); }
  .new { display: flex; align-items: center; gap: var(--s3); padding: var(--s2) var(--s3); flex: none; }
  .plus {
    flex: none; width: 36px; height: 36px; border-radius: var(--r-sm); display: grid; place-items: center;
    background: var(--accent-soft); color: var(--accent-text); border: 1px solid var(--accent-line);
  }
  .more { padding: var(--s3) var(--s3); font-size: var(--t-sm); }
  .sk.cover { width: 36px; height: 36px; flex: none; }
  .sk.line { height: 12px; width: 46%; }
  .sk.line.short { width: 24%; height: 10px; }
  @media (max-width: 520px) { .go { display: none; } }
</style>
