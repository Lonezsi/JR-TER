<!-- A secret shown once: an invite code, a machine token. Press it to copy. It is on the
     screen as text so a browser that will not copy still lets you select it. -->
<script lang="ts">
  import { copyText } from "$lib/actions";
  import Icon from "$ui/Icon.svelte";

  let { code, hint = "", copyHint = "Copied." }: {
    code: string; hint?: string; copyHint?: string; close?: (value?: unknown) => void;
  } = $props();
</script>

<button class="code mono" onclick={() => copyText(code, copyHint)} title="Copy">
  <span class="text">{code}</span><Icon name="copy" size={16} />
</button>
{#if hint}<p class="hint">{hint}</p>{/if}

<style>
  .code {
    display: flex; align-items: center; gap: var(--s3); width: 100%; text-align: left;
    padding: var(--s3) var(--s4); border-radius: var(--r-md);
    background: rgba(0, 0, 0, 0.28); border: 1px solid var(--line-2);
    font-size: var(--t-md); color: var(--text); user-select: all;
  }
  .text { flex: 1 1 auto; min-width: 0; overflow-wrap: anywhere; }
  .code:hover { border-color: var(--accent-line); }
  .hint { margin-top: var(--s3); }
</style>
