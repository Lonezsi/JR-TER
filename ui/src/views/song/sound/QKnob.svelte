<!-- Q as a dial you turn. A thumb has no wheel, so this is the only way to reach Q on a
     phone, and it is a better way to reach it anywhere. Drag up and down, roll the wheel,
     or use the arrow keys. Q runs 0.05 to 30 and is felt logarithmically, so the dial is. -->
<script lang="ts">
  import { clamp } from "$lib/util";
  import { qFromWheel } from "$lib/audio/eq";
  import { wheel } from "./draw";

  let { q, onchange, onfocus, label = "Q" }: {
    q: number; onchange: (q: number) => void; onfocus?: () => void; label?: string;
  } = $props();

  const MIN = 0.05, MAX = 30;
  const fraction = (value: number) => clamp(Math.log(value / MIN) / Math.log(MAX / MIN), 0, 1);
  const fromFraction = (f: number) => Math.round(MIN * Math.pow(MAX / MIN, clamp(f, 0, 1)) * 100) / 100;

  const f = $derived(fraction(q));
  const arc = $derived((f * 270 * Math.PI * 14) / 180);
  const angle = $derived(-135 + f * 270);
  let turning = $state(false);

  function down(e: PointerEvent) {
    if (e.button !== 0) return;
    e.preventDefault();
    onfocus?.();
    const node = e.currentTarget as HTMLElement;
    node.focus({ preventScroll: true });
    const startY = e.clientY;
    const start = fraction(q);
    turning = true;
    // Capture keeps the drag alive off the knob. It is a convenience, not a requirement:
    // letting it throw used to skip the listeners and the knob did nothing at all.
    try { node.setPointerCapture(e.pointerId); } catch { /* the drag still works */ }
    const move = (event: PointerEvent) => onchange(fromFraction(start + (startY - event.clientY) / 140));
    const up = (event: PointerEvent) => {
      turning = false;
      try { node.releasePointerCapture(event.pointerId); } catch { /* already */ }
      node.removeEventListener("pointermove", move);
      node.removeEventListener("pointerup", up);
      node.removeEventListener("pointercancel", up);
    };
    node.addEventListener("pointermove", move);
    node.addEventListener("pointerup", up);
    node.addEventListener("pointercancel", up);
  }

  function key(e: KeyboardEvent) {
    const step = e.key === "ArrowUp" || e.key === "ArrowRight" ? 0.04
      : e.key === "ArrowDown" || e.key === "ArrowLeft" ? -0.04
      : e.key === "PageUp" ? 0.15 : e.key === "PageDown" ? -0.15 : 0;
    if (e.key === "Home") { e.preventDefault(); onchange(MIN); return; }
    if (e.key === "End") { e.preventDefault(); onchange(MAX); return; }
    if (!step) return;
    e.preventDefault();
    onchange(fromFraction(f + step));
  }

  function roll(e: WheelEvent) {
    e.preventDefault();
    onchange(qFromWheel(q, e.deltaY));
  }
</script>

<span class="knob" class:turning role="slider" tabindex="0" aria-label={label}
      aria-valuemin={MIN} aria-valuemax={MAX} aria-valuenow={q} aria-valuetext={q.toFixed(2)}
      title="Drag, scroll or use the arrow keys"
      onpointerdown={down} onkeydown={key} onfocus={() => onfocus?.()} use:wheel={roll}>
  <svg viewBox="0 0 34 34" width="100%" height="100%" aria-hidden="true">
    <circle cx="17" cy="17" r="14" fill="none" stroke="var(--line-2)" stroke-width="3" />
    <circle cx="17" cy="17" r="14" fill="none" stroke="var(--accent)" stroke-width="3"
            stroke-linecap="round" stroke-dasharray="{arc} 999" transform="rotate(135 17 17)" />
    <line x1="17" y1="17" x2="17" y2="7" stroke="var(--text)" stroke-width="2"
          stroke-linecap="round" transform="rotate({angle} 17 17)" />
  </svg>
  <span class="v num">{q.toFixed(2)}</span>
</span>

<style>
  .knob {
    position: relative; display: grid; place-items: center; flex: none;
    width: 40px; height: 40px; cursor: ns-resize; touch-action: none; border-radius: 50%;
    user-select: none;
  }
  .knob:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .v {
    position: absolute; font: 600 var(--t-xs)/1 var(--font); color: var(--text-2); pointer-events: none;
  }
  .knob:hover .v, .knob.turning .v { color: var(--text); }
  @media (pointer: coarse) { .knob { width: 46px; height: 46px; } }
</style>
