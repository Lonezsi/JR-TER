<!-- A switch: on or off, and it takes effect when flipped. Use it only for things that do;
     a choice that waits for Save is a checkbox in a form. -->
<script lang="ts">
  let { checked = $bindable(false), onchange, label = "", disabled = false }: {
    checked?: boolean; onchange?: (checked: boolean) => void; label?: string; disabled?: boolean;
  } = $props();

  function flip() {
    if (disabled) return;
    checked = !checked;
    onchange?.(checked);
  }
</script>

<button type="button" class="switch" class:on={checked} role="switch" aria-checked={checked}
        aria-label={label} {disabled} onclick={flip}>
  <span class="knob"></span>
</button>

<style>
  .switch {
    position: relative; flex: none; width: 46px; height: 28px; border-radius: 999px;
    background: color-mix(in srgb, var(--text) 16%, transparent);
    box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.45);
    transition: background 240ms var(--ease);
  }
  .switch.on { background: var(--accent); }
  .knob {
    position: absolute; top: 2px; left: 2px; width: 24px; height: 24px; border-radius: 50%;
    background: #fff; box-shadow: 0 2px 6px rgba(0, 0, 0, 0.4);
    transition: transform 300ms var(--spring), width 160ms var(--ease);
  }
  .switch.on .knob { transform: translateX(18px); }
  /* The knob stretches a little under the press, the way a physical one gives. */
  .switch:active .knob { width: 28px; }
  .switch.on:active .knob { transform: translateX(14px); }
  .switch:disabled { opacity: 0.45; }
</style>
