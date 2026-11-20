<script lang="ts">
  import { KEYS } from "./keys";
  // The host passes `close` to every sheet body; this one has nothing to say with it.
  let _: { close?: (value?: unknown) => void } = $props();
</script>

<div class="keys">
  {#each KEYS as group (group.group)}
    <section>
      <div class="eyebrow">{group.group}</div>
      {#each group.rows as row}
        <div class="line">
          <span class="combo">{#each row.keys as k}<kbd>{k}</kbd>{/each}</span>
          <span>{row.what}</span>
        </div>
      {/each}
    </section>
  {/each}
</div>

<style>
  .keys { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: var(--s5) var(--s6); }
  section { display: flex; flex-direction: column; gap: var(--s2); }
  .eyebrow { margin-bottom: 2px; }
  .line { display: flex; align-items: center; gap: var(--s3); font-size: var(--t-sm); color: var(--text-2); }
  .combo { display: flex; gap: var(--s1); flex: none; min-width: 108px; }
</style>
