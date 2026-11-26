<!-- The details of one class, as the body of a sheet: the facts, edit and delete for
     whoever may write, and the notes. One fact only when there is one: a row reading
     "Oktató -" says nothing and takes the height of one that does. -->
<script lang="ts">
  import { KIND_SAID, type Entry } from "./week";
  import Notes from "./Notes.svelte";

  let { entry, readonly, mine, colour, close }: {
    entry: Entry; readonly: boolean; mine: string; colour: string;
    close: (value?: string | null) => void;
  } = $props();

  const facts = $derived([
    ["Helyszín", entry.where],
    ["Típus", KIND_SAID[entry.kind] || entry.kind],
    ["Oktató", entry.teacher],
    ["Kurzus", entry.group],
    ["Tárgykód", entry.code],
  ].filter(([, value]) => value) as [string, string][]);
</script>

<div class="facts">
  {#each facts as [said, value]}
    <div class="fact"><span>{said}</span><b>{value}</b></div>
  {/each}
  <div class="fact">
    <span>Kinek</span>
    <b style:color={entry.whose === "me" ? null : colour}>{entry.whose === "me" ? mine : entry.whose}</b>
  </div>
</div>

{#if entry.skip}
  <p class="note">Erre az előadásra nem járok, ezért csak egy csík jelöli. Az idősáv így nem látszik szabadnak.</p>
{/if}

{#if !readonly}
  <div class="tools">
    <button class="btn ghost" type="button" onclick={() => close("edit")}>Szerkesztés</button>
    <button class="btn ghost danger" type="button" onclick={() => close("delete")}>Törlés</button>
  </div>
{/if}

<Notes subject={entry.name} />

<style>
  .facts { display: flex; flex-direction: column; gap: var(--s2); }
  .fact { display: flex; gap: var(--s3); font-size: var(--t-md); }
  .fact span { color: var(--text-3); min-width: 78px; flex: none; }
  .fact b { font-weight: 600; min-width: 0; overflow-wrap: anywhere; }
  .note { margin-top: var(--s4); color: var(--text-3); font-size: var(--t-sm); line-height: 1.5; }
  .tools { display: flex; gap: var(--s2); margin: var(--s3) 0 var(--s2); }
</style>
