<!-- What the people a song is shared with have made on it (their own copies: words, sound,
     pictures, mixes) and what they changed on the song itself, with a way to put each back. -->
<script lang="ts">
  import { confirm } from "$lib/dialog.svelte";
  import { date, when } from "$lib/util";
  import { useSong } from "./song.svelte";
  import type { GuestWork } from "./guestwork.svelte";
  import { chooseTake } from "./slotmenu";
  import { initials } from "./helpers";
  import { contextMenu } from "$lib/menu.svelte";

  let { gw }: { gw: GuestWork } = $props();
  const song = useSong();

  async function undo(edit: (typeof gw.edits)[number]) {
    const sure = await confirm("Undo this change?",
      "The song goes back to how it was just before it. Anything changed after it on the same thing goes back too.", "Undo it");
    if (!sure) return;
    await gw.undo(edit, async () => { await song.refresh(); });
  }
</script>

{#if gw.people.length || gw.edits.length}
  <section class="col">
    {#if gw.people.length}
      <div class="section-head"><h2>What they made</h2></div>
      {#each gw.people as p (p.share)}
        <div class="card person">
          <div class="row">
            <span class="chip on who">{initials(p)}</span>
            <b>{p.name || p.handle}</b>
            {#if p.handle}<span class="faint">@{p.handle}</span>{/if}
            <span class="grow"></span>
            {#if p.updated_at}<span class="faint">{when(p.updated_at)}</span>{/if}
          </div>
          {#if !p.made_anything}<p class="faint">Nothing made on this song yet.</p>{/if}
          {#if p.changes}<p class="faint">{p.changes} change{p.changes === 1 ? "" : "s"} to the song itself, listed under Changes by others.</p>{/if}
          {#if p.artwork.length}
            <div class="art">{#each p.artwork as a (a.id)}<img src="/api/guestwork/{p.share}/artwork/{a.id}" alt={a.caption || ""} loading="lazy" />{/each}</div>
          {/if}
          {#each p.versions as v (v.id)}
            {@const gv = gw.versionOf(p, v)}
            <div class="row mix" use:contextMenu={() => [
              { label: "Put in A", run: () => chooseTake(song, "A", gv) },
              { label: "Put in B", run: () => chooseTake(song, "B", gv) },
            ]}>
              <span class="tag">mix</span>
              <span class="grow truncate">{v.filename || "v" + v.n}</span>
              <button class="btn sm ghost" onclick={() => chooseTake(song, "A", gv)}>A</button>
              <button class="btn sm ghost" onclick={() => chooseTake(song, "B", gv)}>B</button>
              <audio controls preload="none" src="/api/guestwork/{p.share}/audio/{v.id}"></audio>
            </div>
          {/each}
          {#each p.sheets as s, i (i)}
            <details class="words" open><summary>{s.name || "Words"}</summary><pre>{s.text}</pre></details>
          {/each}
          {#each p.presets as s (s.id)}
            <div class="row"><span class="tag">sound</span><span class="grow truncate">{s.name}</span>
              <span class="faint">{(s.data?.bands || []).length} bands</span></div>
          {/each}
        </div>
      {/each}
    {/if}

    {#if gw.edits.length}
      <div class="section-head"><h2>Changes by others</h2></div>
      <div class="card list ruled">
        {#each gw.edits as e (e.id)}
          <div class="item" class:undone={!!e.undone_at}>
            <span class="chip on who">{((e.name || e.handle || "?")[0] || "?").toUpperCase()}</span>
            <span class="grow truncate"><b>{e.name || e.handle}</b> {e.what}</span>
            <span class="faint">{date(e.updated_at)}</span>
            {#if e.undone_at}<span class="tag">put back</span>
            {:else}<button class="btn sm ghost" onclick={() => undo(e)} title="Back to how it was before this, with anything changed after it">Undo</button>{/if}
          </div>
        {/each}
      </div>
    {/if}
  </section>
{/if}

<style>
  .person { padding: var(--s4); display: flex; flex-direction: column; gap: var(--s3); }
  .who { width: 32px; height: 32px; padding: 0; justify-content: center; border-radius: 50%; }
  .art { display: flex; gap: var(--s2); overflow-x: auto; }
  .art img { width: 96px; height: 96px; object-fit: cover; border-radius: var(--r-md); flex: none; }
  .mix { flex-wrap: wrap; }
  audio { height: 32px; max-width: 100%; }
  .words summary { cursor: pointer; font-weight: 600; }
  pre { white-space: pre-wrap; font: 500 var(--t-md)/1.55 var(--font); margin: var(--s2) 0 0; }
  .undone { opacity: 0.55; }
  .card.list { padding: var(--s2); }
</style>
