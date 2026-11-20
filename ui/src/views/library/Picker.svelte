<!-- A sheet body for choosing songs and renders from a list with a filter. Many at once
     by default; `single` closes on the first press, which is how one waiting render is
     picked for a song. Closes with the chosen keys. -->
<script lang="ts">
  import Cover from "$ui/Cover.svelte";
  import Icon from "$ui/Icon.svelte";
  import { plural } from "$lib/util";
  import type { Candidate } from "./kinds";

  let { candidates, single = false, verb = "Add", close }: {
    candidates: Candidate[]; single?: boolean; verb?: string; close: (keys?: string[] | null) => void;
  } = $props();

  let filter = $state("");
  let picked = $state<string[]>([]);
  const shown = $derived.by(() => {
    const term = filter.trim().toLowerCase();
    return term ? candidates.filter((c) => c.title.toLowerCase().includes(term)) : candidates;
  });

  function press(c: Candidate) {
    if (single) { close([c.key]); return; }
    picked = picked.includes(c.key) ? picked.filter((k) => k !== c.key) : [...picked, c.key];
  }
</script>

<div class="pick">
  <input class="field" type="search" placeholder="Filter" bind:value={filter} aria-label="Filter" />
  <div class="list" role="listbox" aria-multiselectable={!single}>
    {#each shown as c (c.key)}
      {@const on = picked.includes(c.key)}
      <button type="button" class="item" class:on role="option" aria-selected={on} onclick={() => press(c)}>
        <Cover url={c.art} title={c.title} size={36} />
        <span class="grow truncate">
          <span class="t truncate">{c.title}</span>
          {#if c.sub}<span class="s truncate">{c.sub}</span>{/if}
        </span>
        {#if c.kind === "render"}<span class="tag">render</span>{/if}
        {#if !single}
          <span class="tick" class:on>{#if on}<Icon name="check" size={14} stroke={2.4} />{/if}</span>
        {:else}
          <span class="go">{verb}</span>
        {/if}
      </button>
    {:else}
      <p class="muted none">{filter ? "Nothing matches that." : "Nothing to choose from."}</p>
    {/each}
  </div>
  {#if !single}
    <button class="btn primary block" disabled={!picked.length} onclick={() => close(picked)}>
      {picked.length ? `${verb} ${plural(picked.length, "item")}` : verb}
    </button>
  {/if}
</div>

<style>
  .pick { display: flex; flex-direction: column; gap: var(--s3); }
  .list { display: flex; flex-direction: column; gap: 2px; max-height: 46vh; overflow-y: auto; }
  .item { width: 100%; text-align: left; }
  .t, .s { display: block; }
  .tick {
    width: 22px; height: 22px; border-radius: 50%; flex: none; display: grid; place-items: center;
    border: 1.5px solid var(--line-2); color: var(--accent-ink);
    transition: background var(--fast), border-color var(--fast);
  }
  .tick.on { background: var(--accent); border-color: transparent; }
  .go { font-size: var(--t-sm); font-weight: 600; color: var(--accent-text); }
  .none { padding: var(--s4); text-align: center; }
</style>
