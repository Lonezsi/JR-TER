<!-- The app's own dropdown: looks like a field, opens the app's menu (glass, checkmarks,
     the same on a phone as everywhere else) instead of the browser's native list. Use it
     wherever a <select> would go.

       <Dropdown value={x} options={[{ value: "a", label: "A", sub: "what it is" }]}
                 onchange={(v) => (x = v)} label="What this picks" /> -->
<script lang="ts" generics="T extends string | number">
  import Icon from "./Icon.svelte";
  import { showMenu } from "$lib/menu.svelte";

  interface Option { value: T; label: string; sub?: string; icon?: string; disabled?: boolean }
  let { value = $bindable(), options, onchange, label = "", size = "md", disabled = false, placeholder = "Choose…", block = false }: {
    value: T; options: Option[]; onchange?: (value: T) => void;
    label?: string; size?: "sm" | "md"; disabled?: boolean; placeholder?: string;
    /** Take the whole width of its row. */
    block?: boolean;
  } = $props();

  const current = $derived(options.find((o) => o.value === value));

  function open(e: MouseEvent) {
    if (disabled) return;
    showMenu(options.map((o) => ({
      label: o.label, sub: o.sub, icon: o.icon, disabled: o.disabled, checked: o.value === value,
      run: () => { if (o.value === value) return; value = o.value; onchange?.(o.value); },
    })), { anchor: e.currentTarget as Element });
  }
</script>

<button type="button" class="field dropdown-field {size}" class:block {disabled} aria-haspopup="menu" aria-label={label || undefined}
        title={current?.label} onclick={open}>
  <span class="truncate" class:empty={!current}>{current?.label ?? placeholder}</span>
  <Icon name="chev-down" size={size === "sm" ? 13 : 15} />
</button>

<style>
  .dropdown-field {
    display: inline-flex; align-items: center; justify-content: space-between; gap: var(--s2);
    min-width: 0; max-width: 100%; text-align: left; cursor: pointer;
  }
  .dropdown-field.block { width: 100%; }
  .dropdown-field :global(svg) { flex: none; color: var(--text-3); }
  .dropdown-field:hover :global(svg) { color: var(--text-2); }
  .empty { color: var(--text-3); }
</style>
