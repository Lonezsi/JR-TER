<!-- The body of the "what changed" sheet: the newest release, and the rest one press away. -->
<script lang="ts">
  import ReleaseEntry from "./ReleaseEntry.svelte";
  import type { Release } from "./shapes";

  let { releases }: { releases: Release[]; close?: (value?: unknown) => void } = $props();
  let more = $state(false);
  const earlier = $derived(releases.slice(1));
</script>

{#if releases[0]}<ReleaseEntry release={releases[0]} />{/if}
{#if earlier.length}
  {#if !more}
    <button class="btn ghost sm more" onclick={() => (more = true)}>Earlier releases ({earlier.length})</button>
  {:else}
    <div class="earlier">{#each earlier as release (release.version)}<ReleaseEntry {release} />{/each}</div>
  {/if}
{/if}

<style>
  .more { margin-top: var(--s4); }
  .earlier { margin-top: var(--s5); }
</style>
