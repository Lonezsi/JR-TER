<script lang="ts">
  import { toasts, dismiss } from "$lib/toast.svelte";
  import { fly, fade } from "svelte/transition";
  import { flip } from "svelte/animate";
</script>

<div class="stack" aria-live="polite">
  {#each toasts.list as t (t.id)}
    <div class="toast glass-2" class:bad={t.kind === "bad"} role="status"
         in:fly={{ y: 16, duration: 280 }} out:fade={{ duration: 160 }} animate:flip={{ duration: 220 }}>
      <span class="msg">{t.message}{#if t.times > 1}<span class="times"> ({t.times})</span>{/if}</span>
      {#if t.action}
        <button class="act" onclick={() => { t.action?.run(); dismiss(t.id); }}>{t.action.label}</button>
      {/if}
    </div>
  {/each}
</div>

<style>
  .stack {
    position: fixed; z-index: 900; left: 50%; transform: translateX(-50%);
    bottom: calc(var(--bar-h) + var(--tab-h) + var(--gap) * 3 + var(--safe-b));
    display: flex; flex-direction: column; align-items: center; gap: var(--s2);
    pointer-events: none; width: min(92vw, 520px);
  }
  .toast {
    pointer-events: auto; display: flex; align-items: center; gap: var(--s4);
    padding: var(--s3) var(--s4); border-radius: var(--r-pill); max-width: 100%;
    font-size: var(--t-sm); font-weight: 600;
  }
  .toast.bad { border-color: color-mix(in srgb, var(--bad) 55%, transparent); color: #FFD9D9; }
  .msg { min-width: 0; overflow-wrap: anywhere; }
  .times { color: var(--text-3); }
  .act { color: var(--accent-text); font-weight: 600; flex: none; padding: 2px var(--s1); border-radius: var(--r-sm); }
  .act:hover { text-decoration: underline; }
</style>
