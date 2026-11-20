<!-- A range input with its filled part kept in step. `oninput` fires while dragging,
     `onchange` once on release: preview on the first, save on the second. Double click
     puts it back to `reset` when one is given, which is the gesture every mixer has. -->
<script lang="ts">
  let { value = $bindable(0), min = 0, max = 100, step = 1, label = "", accent = false,
        reset, disabled = false, oninput, onchange }: {
    value?: number; min?: number; max?: number; step?: number; label?: string; accent?: boolean;
    reset?: number; disabled?: boolean;
    oninput?: (value: number) => void; onchange?: (value: number) => void;
  } = $props();

  const fill = $derived(max > min ? ((value - min) / (max - min)) * 100 : 0);
</script>

<input class="range" class:accent type="range" {min} {max} {step} {disabled} aria-label={label}
       style:--fill="{fill}%" bind:value
       oninput={() => oninput?.(value)} onchange={() => onchange?.(value)}
       ondblclick={() => { if (reset !== undefined) { value = reset; oninput?.(value); onchange?.(value); } }} />
