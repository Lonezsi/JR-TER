<!-- A rotary knob for one number of an effect. Drag up or right to raise it (Shift for fine
     steps), wheel while it has focus, arrow keys, Home and End, and a double click puts it
     back to what a new effect starts with. It is a slider to the keyboard and to a screen
     reader; the dial is only how it looks. -->
<script lang="ts">
  import { fmtKnob, knobFill } from "$lib/audio/vocals.svelte";
  import { clamp } from "$lib/util";

  let { value, min, max, step, unit, label, reset, disabled = false, onchange }: {
    value: number; min: number; max: number; step: number; unit: string; label: string;
    reset: number; disabled?: boolean; onchange: (value: number) => void;
  } = $props();

  const SWEEP = 270;                 // degrees of travel, centred on 12 o'clock
  const SPAN = 170;                  // pixels of drag for the whole range
  const decimals = $derived(step < 1 ? (String(step).split(".")[1] || "").length : 0);
  const fix = (v: number) => Number(clamp(Math.round((v - min) / step) * step + min, min, max).toFixed(decimals));

  const angle = (frac: number) => -SWEEP / 2 + SWEEP * frac;
  const at = (deg: number, r = 17) => {
    const rad = (deg * Math.PI) / 180;
    return `${(22 + r * Math.sin(rad)).toFixed(2)} ${(22 - r * Math.cos(rad)).toFixed(2)}`;
  };
  const arc = (from: number, to: number) => {
    const [a, b] = from <= to ? [from, to] : [to, from];
    if (b - a < 0.4) return "";
    return `M${at(a)} A17 17 0 ${b - a > 180 ? 1 : 0} 1 ${at(b)}`;
  };

  const frac = $derived(knobFill(value, min, max) / 100);
  // A knob that crosses zero (a gain) fills from the middle, so a cut and a boost read apart.
  const origin = $derived(min < 0 && max > 0 ? -min / (max - min) : 0);
  const filled = $derived(arc(angle(origin), angle(frac)));
  const text = $derived(fmtKnob(value, unit));

  let node: HTMLElement | undefined = $state();
  let drag: { x: number; y: number; start: number; moved: boolean } | null = null;

  function put(next: number) {
    const v = fix(next);
    if (v !== value) onchange(v);
  }

  function down(e: PointerEvent) {
    if (disabled || e.button > 0) return;
    node?.setPointerCapture(e.pointerId);
    node?.focus();
    drag = { x: e.clientX, y: e.clientY, start: value, moved: false };
  }
  function move(e: PointerEvent) {
    if (!drag) return;
    const fine = e.shiftKey ? 0.2 : 1;
    const travel = (drag.y - e.clientY) + (e.clientX - drag.x);
    if (Math.abs(travel) > 2) drag.moved = true;
    put(drag.start + (travel / SPAN) * (max - min) * fine);
  }
  function up(e: PointerEvent) {
    if (node?.hasPointerCapture(e.pointerId)) node.releasePointerCapture(e.pointerId);
    drag = null;
  }
  function key(e: KeyboardEvent) {
    if (disabled || e.altKey || e.ctrlKey || e.metaKey) return;
    const big = e.shiftKey ? 10 : 1;
    let handled = true;
    if (e.key === "ArrowUp" || e.key === "ArrowRight") put(value + step * big);
    else if (e.key === "ArrowDown" || e.key === "ArrowLeft") put(value - step * big);
    else if (e.key === "PageUp") put(value + step * 10);
    else if (e.key === "PageDown") put(value - step * 10);
    else if (e.key === "Home") put(min);
    else if (e.key === "End") put(max);
    else if (e.key === "Backspace" || e.key === "Delete") put(reset);
    else handled = false;
    if (handled) e.preventDefault();
  }

  // The wheel only turns a knob that has focus: one that did it on hover would steal the
  // scroll of the whole page every time the pointer passed over it. Not passive, so it can
  // be cancelled.
  function wheel(el: HTMLElement) {
    const h = (e: WheelEvent) => {
      if (disabled || document.activeElement !== el) return;
      e.preventDefault();
      put(value + (e.deltaY < 0 ? 1 : -1) * step * (e.shiftKey ? 1 : Math.max(1, Math.round((max - min) / step / 100))));
    };
    el.addEventListener("wheel", h, { passive: false });
    return { destroy: () => el.removeEventListener("wheel", h) };
  }
</script>

<div class="knob" class:off={disabled}>
  <span class="lab">{label}</span>
  <div class="dial" bind:this={node} use:wheel role="slider" tabindex={disabled ? -1 : 0}
       aria-label={label} aria-valuemin={min} aria-valuemax={max} aria-valuenow={value}
       aria-valuetext={text} aria-disabled={disabled}
       title="Drag, scroll or use the arrow keys. Double click to reset."
       onpointerdown={down} onpointermove={move} onpointerup={up} onpointercancel={up}
       onkeydown={key} ondblclick={() => { if (!disabled) put(reset); }}>
    <svg viewBox="0 0 44 44" aria-hidden="true">
      <path class="track" d={arc(angle(0), angle(1))} />
      {#if filled}<path class="fill" d={filled} />{/if}
      <line class="tick" x1="22" y1="22" x2={at(angle(frac), 12).split(" ")[0]} y2={at(angle(frac), 12).split(" ")[1]} />
    </svg>
  </div>
  <b class="val num">{text}</b>
</div>

<style>
  .knob { display: flex; flex-direction: column; align-items: center; gap: 4px; min-width: 0; text-align: center; }
  .lab {
    font-size: var(--t-xs); line-height: 1.2; color: var(--text-2); min-height: 2.4em;
    display: flex; align-items: flex-end; justify-content: center;
  }
  .dial {
    width: 46px; height: 46px; border-radius: 50%; cursor: ns-resize; touch-action: none; user-select: none;
    background: radial-gradient(circle at 50% 30%, color-mix(in srgb, var(--text) 10%, transparent), color-mix(in srgb, var(--text) 3%, transparent));
    border: 1px solid var(--line-2);
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.08), 0 2px 8px rgba(0, 0, 0, 0.35);
    transition: border-color var(--fast), transform var(--fast);
  }
  .dial:hover { border-color: color-mix(in srgb, var(--text) 30%, transparent); }
  .dial:active { transform: scale(0.97); cursor: grabbing; }
  .dial:focus-visible { border-radius: 50%; }
  svg { width: 100%; height: 100%; }
  path { fill: none; stroke-width: 3; stroke-linecap: round; }
  .track { stroke: var(--line-2); }
  .fill { stroke: var(--accent); }
  .tick { stroke: var(--text); stroke-width: 2.2; stroke-linecap: round; }
  .val { font-size: var(--t-xs); font-weight: 600; color: var(--text); }
  .off { opacity: 0.5; }
  .off .dial { cursor: default; }
  @media (pointer: coarse) { .dial { width: 52px; height: 52px; } }
</style>
