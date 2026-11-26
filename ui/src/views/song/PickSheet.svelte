<!-- A list to choose from, as the body of a sheet. Single choice answers on press;
     multiple choice answers with the set that was ticked. -->
<script lang="ts">
  import { untrack } from "svelte";
  import Icon from "$ui/Icon.svelte";

  interface Item { key: string; label: string; sub?: string }
  let { items, checked = [], multi = false, fresh = "", empty = "Nothing here yet.", close }: {
    items: Item[]; checked?: string[]; multi?: boolean; fresh?: string; empty?: string;
    close: (value?: unknown) => void;
  } = $props();

  let ticked = $state<string[]>([]);
  ticked = [...untrack(() => checked)];
  const flip = (key: string) => {
    ticked = ticked.includes(key) ? ticked.filter((k) => k !== key) : [...ticked, key];
  };
</script>

<div class="list pick">
  {#if fresh}
    <button class="item" onclick={() => close({ fresh: true })}>
      <span class="plus"><Icon name="plus" size={16} /></span>
      <span class="grow"><span class="t">{fresh}</span></span>
    </button>
  {/if}
  {#each items as item (item.key)}
    {#if multi}
      <label class="item">
        <input type="checkbox" checked={ticked.includes(item.key)} onchange={() => flip(item.key)} />
        <span class="grow truncate"><span class="t">{item.label}</span>
          {#if item.sub}<span class="s"> {item.sub}</span>{/if}</span>
      </label>
    {:else}
      <button class="item" onclick={() => close({ key: item.key })}>
        <span class="grow truncate"><span class="t">{item.label}</span>
          {#if item.sub}<br /><span class="s">{item.sub}</span>{/if}</span>
        <Icon name="plus" size={14} />
      </button>
    {/if}
  {/each}
  {#if !items.length && !fresh}<p class="faint pad">{empty}</p>{/if}
</div>
{#if multi}
  <div class="foot">
    <button class="btn ghost" onclick={() => close(null)}>Cancel</button>
    <button class="btn primary" onclick={() => close({ keys: ticked })}>Save</button>
  </div>
{/if}

<style>
  .pick { gap: 2px; }
  .item { cursor: pointer; text-align: left; width: 100%; }
  input[type="checkbox"] { width: 18px; height: 18px; accent-color: var(--accent); }
  .plus { display: grid; place-items: center; width: 28px; height: 28px; border-radius: 50%;
          background: var(--accent-soft); color: var(--accent-text); }
  .pad { padding: var(--s3); }
  .foot { display: flex; justify-content: flex-end; gap: var(--s2); padding-top: var(--s3); }
</style>
