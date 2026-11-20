<!-- One titled group on a settings page: a heading, an optional sentence, and a card of
     rows. `bare` leaves the card off for content that brings its own. -->
<script lang="ts">
  import type { Snippet } from "svelte";
  let { title, note = "", bare = false, actions, children }: {
    title: string; note?: string; bare?: boolean; actions?: Snippet; children: Snippet;
  } = $props();
</script>

<section class="block">
  <div class="section-head">
    <h3>{title}</h3>
    {#if actions}{@render actions()}{/if}
  </div>
  {#if note}<p class="note">{note}</p>{/if}
  {#if bare}{@render children()}{:else}<div class="card group">{@render children()}</div>{/if}
</section>

<style>
  .block { display: flex; flex-direction: column; gap: var(--s3); min-width: 0; }
  .note { color: var(--text-2); font-size: var(--t-sm); max-width: 68ch; }
</style>
