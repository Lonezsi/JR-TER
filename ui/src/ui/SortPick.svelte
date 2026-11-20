<!-- The sort control: one button that says what the list is sorted by, opening a menu of
     the rest. Pressing the current key turns it round. -->
<script lang="ts" generics="T">
  import { sortOf, pickSort, type SortKey } from "$lib/sort.svelte";
  import { showMenu } from "$lib/menu.svelte";
  import Icon from "./Icon.svelte";

  let { list, keys, compact = false }: { list: string; keys: SortKey<T>[]; compact?: boolean } = $props();
  const now = $derived(sortOf(list, keys));

  function open(e: MouseEvent) {
    e.preventDefault();
    showMenu(keys.map((k) => ({
      label: k.label + (k.key === now.key && k.by ? (now.dir === "down" ? "  ↓" : "  ↑") : ""),
      checked: k.key === now.key,
      run: () => pickSort(list, keys, k.key),
    })), { anchor: e.currentTarget as Element });
  }
</script>

<!-- Two short lines rather than one long one: what it is, small, over what it is set to.
     It sits beside controls that must keep their width, so it truncates and never wraps. -->
<button class="sortpick" class:compact aria-label="Sort: {now.spec.label}" title="Sort this list: {now.spec.label}" onclick={open} oncontextmenu={open}>
  <Icon name={now.spec.by ? (now.dir === "down" ? "arrow-down" : "arrow-up") : "list"} size={14} />
  <span class="words">
    <span class="what">Sort</span>
    <span class="how truncate">{now.spec.label}</span>
  </span>
</button>

<style>
  .sortpick {
    display: flex; align-items: center; gap: var(--s2); min-width: 0; max-width: 100%; height: 38px;
    padding: 0 var(--s3); border-radius: var(--r-md); color: var(--text-2); text-align: left;
    transition: background var(--fast), color var(--fast);
  }
  .sortpick:hover { background: var(--hover); color: var(--text); }
  .compact { width: 38px; padding: 0; justify-content: center; }
  .compact .words { display: none; }
  .sortpick :global(svg) { flex: none; }
  .words { display: flex; flex-direction: column; min-width: 0; line-height: 1.15; }
  .what { font: 500 11px/1.2 var(--font); color: var(--text-3); }
  .how { font-size: var(--t-sm); font-weight: 600; white-space: nowrap; }
</style>
