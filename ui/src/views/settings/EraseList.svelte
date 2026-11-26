<!-- What Erase would remove, with sizes: the honest part of an erase is the list. Sits above
     the field where the library's name is typed. -->
<script lang="ts">
  import { bytes } from "$lib/util";
  import type { ErasePlan } from "./shapes";

  let { plan }: { plan: ErasePlan; close?: (value?: unknown) => void } = $props();
</script>

<div class="list ruled goes">
  {#each plan.goes as g (g.path)}
    <div class="item">
      <div class="grow">
        <div class="mono path">{g.path}</div>
        <div class="s">{g.how}</div>
      </div>
      <b class="num">{bytes(g.bytes)}</b>
    </div>
  {/each}
</div>
<p class="hint left">
  Your password is left alone, so the door still works afterwards. A connected Google
  account is disconnected here but revoked only at Google. Take a copy first if you want one.
</p>

<style>
  .goes { margin-bottom: var(--s3); }
  .path { font-size: var(--t-xs); overflow-wrap: anywhere; }
  .left { margin-bottom: var(--s4); }
</style>
