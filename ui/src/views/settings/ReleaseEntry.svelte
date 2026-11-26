<!-- One release. The same markup in the "what changed" sheet and in Settings, because a
     second copy of these is where the two stop looking like the same thing. -->
<script lang="ts">
  import type { Release } from "./shapes";
  let { release }: { release: Release } = $props();
</script>

<article class="entry">
  <div class="head">
    <span class="version num">{release.version}</span>
    <span class="title">{release.title || ""}</span>
    <span class="date num">{release.date || ""}</span>
  </div>
  {#if release.name}<div class="name">{release.name}</div>{/if}
  {#if release.notes?.length}
    <ul>{#each release.notes as line}<li>{line}</li>{/each}</ul>
  {/if}
</article>

<style>
  .entry:not(:first-child) { margin-top: var(--s4); padding-top: var(--s4); border-top: 1px solid var(--line); }
  .head { display: flex; align-items: baseline; gap: var(--s3); flex-wrap: wrap; }
  .version { font: 800 var(--t-md)/1 var(--mono); color: var(--accent-text); }
  .title { font-weight: 600; }
  .date { margin-left: auto; font-size: var(--t-xs); color: var(--text-3); }
  .name { margin-top: 2px; font-size: var(--t-xs); color: var(--text-3); letter-spacing: 0.04em; }
  ul { margin: var(--s2) 0 0; padding-left: 1.2em; color: var(--text-2); font-size: var(--t-sm); }
  li + li { margin-top: var(--s1); }
</style>
