<!-- One band: on/off, type, frequency, gain, a dial for Q, and remove. Numbers commit when
     you leave the field or press Enter (committing on every keystroke would clamp "1" to
     the lowest frequency on the way to typing "1200"). -->
<script lang="ts">
  import Icon from "$ui/Icon.svelte";
  import Dropdown from "$ui/Dropdown.svelte";
  import Switch from "$ui/Switch.svelte";
  import { BAND_TYPES, isGainless } from "$lib/audio/eq";
  import { clamp } from "$lib/util";
  import type { Band } from "$lib/types";
  import QKnob from "./QKnob.svelte";
  import { LABEL } from "./labels";

  let { band, selected, onselect, onpatch, onremove }: {
    band: Band; selected: boolean; onselect: () => void;
    onpatch: (fn: (b: Band) => void) => void; onremove: () => void;
  } = $props();

  const gainless = $derived(isGainless(band.type));
  const tenth = (n: number) => Math.round(n * 10) / 10;

  function freq(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const n = parseFloat(input.value);
    if (!Number.isFinite(n)) { input.value = String(tenth(band.freq)); return; }
    onpatch((b) => { b.freq = tenth(clamp(n, 10, 22000)); });
  }
  function gain(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const n = parseFloat(input.value);
    if (!Number.isFinite(n)) { input.value = String(tenth(band.gain)); return; }
    onpatch((b) => { b.gain = tenth(clamp(n, -30, 30)); });
  }
</script>

<div class="band card" class:sel={selected} class:off={!band.on} role="group"
     aria-label="{LABEL[band.type]} band at {Math.round(band.freq)} hertz"
     onfocusin={onselect}>
  <div class="top">
    <button class="kind" type="button" onclick={onselect} aria-pressed={selected}
            title="Show this band on the curve">{LABEL[band.type]}</button>
    <Switch checked={band.on} label="Band on" onchange={(on) => onpatch((b) => { b.on = on; })} />
  </div>
  <div class="vals">
    <label class="f"><span class="sr-only">Frequency in hertz</span>
      <input class="field sm num" type="number" min="10" max="22000" step="1"
             value={tenth(band.freq)} onchange={freq} />
      <span class="u">Hz</span></label>
    <label class="f"><span class="sr-only">Gain in decibels</span>
      <input class="field sm num" type="number" min="-30" max="30" step="0.5" disabled={gainless}
             value={gainless ? "" : tenth(band.gain)} placeholder="none" onchange={gain} />
      <span class="u">dB</span></label>
    <QKnob q={band.q} onfocus={onselect} onchange={(q) => onpatch((b) => { b.q = q; })} />
  </div>
  <div class="foot">
    <Dropdown size="sm" label="Filter type" value={band.type as string} options={BAND_TYPES.map((type) => ({ value: type as string, label: LABEL[type] }))}
              onchange={(t) => { const type = t as BiquadFilterType; onpatch((b) => { b.type = type; }); }} />
    <button class="icon-btn sm" type="button" onclick={onremove} aria-label="Remove this band" title="Remove this band">
      <Icon name="trash" size={16} />
    </button>
  </div>
</div>

<style>
  .band {
    display: flex; flex-direction: column; gap: var(--s2); padding: var(--s3); min-width: 0;
    transition: border-color var(--fast), opacity var(--fast);
  }
  .band.sel { border-color: var(--accent); }
  .band.off { opacity: 0.55; }
  .top { display: flex; align-items: center; justify-content: space-between; gap: var(--s2); }
  .kind {
    font: 600 var(--t-xs)/1 var(--font);
    color: var(--text-2); padding: var(--s2) 0; text-align: left;
  }
  .band.sel .kind { color: var(--accent-text); }
  .vals { display: grid; grid-template-columns: 1fr 1fr auto; gap: var(--s2); align-items: center; }
  .f { position: relative; display: block; min-width: 0; }
  .f input { padding-right: var(--s6); width: 100%; }
  .f .u {
    position: absolute; right: 8px; top: 50%; transform: translateY(-50%);
    font-size: 10px; color: var(--text-3); pointer-events: none;
  }
  .foot { display: flex; align-items: center; gap: var(--s2); }
  .foot :global(.dropdown-field) { flex: 1 1 auto; min-width: 0; }
</style>
