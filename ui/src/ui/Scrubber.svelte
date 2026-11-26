<!-- A scrub bar. The knob follows the pointer while it is held and the seek happens as it
     moves, so what you hear is where you are. Arrow keys nudge five seconds, Shift makes
     it thirty, Home and End go to the ends. Hovering shows the time under the pointer. -->
<script lang="ts">
  import { clamp, time } from "$lib/util";

  let { position = 0, duration = 0, buffered = 0, onseek, onhold, label = "Position", thin = false }: {
    position?: number; duration?: number; buffered?: number;
    onseek: (fraction: number) => void;
    /** True while held, false on release: the owner stops overwriting `position`. */
    onhold?: (held: boolean) => void;
    label?: string; thin?: boolean;
  } = $props();

  let bar = $state<HTMLElement>();
  let held = $state(false);
  let local = $state(0);
  let hover = $state<number | null>(null);

  const fraction = $derived(held ? local : duration ? clamp(position / duration, 0, 1) : 0);
  const loaded = $derived(duration ? clamp(buffered / duration, 0, 1) : 0);

  const at = (e: PointerEvent) => {
    const rect = bar!.getBoundingClientRect();
    return clamp((e.clientX - rect.left) / rect.width, 0, 1);
  };

  function down(e: PointerEvent) {
    if (e.button || !duration) return;
    held = true;
    onhold?.(true);
    local = at(e);
    bar!.setPointerCapture(e.pointerId);
    onseek(local);
  }
  function move(e: PointerEvent) {
    if (bar) hover = at(e);
    if (!held) return;
    local = at(e);
    onseek(local);
  }
  function up(e: PointerEvent) {
    if (!held) return;
    local = at(e);
    onseek(local);
    held = false;
    onhold?.(false);
  }
  function key(e: KeyboardEvent) {
    if (!duration) return;
    const step = (e.shiftKey ? 30 : 5) / duration;
    let to: number | null = null;
    if (e.key === "ArrowRight") to = fraction + step;
    if (e.key === "ArrowLeft") to = fraction - step;
    if (e.key === "Home") to = 0;
    if (e.key === "End") to = 1;
    if (to === null) return;
    e.preventDefault();
    e.stopPropagation();
    onseek(clamp(to, 0, 1));
  }
</script>

<div class="bar" class:thin class:held bind:this={bar} role="slider" tabindex="0" aria-label={label}
     aria-valuemin={0} aria-valuemax={Math.round(duration)} aria-valuenow={Math.round(fraction * duration)}
     aria-valuetext={time(fraction * duration)}
     onpointerdown={down} onpointermove={move} onpointerup={up} onpointercancel={up}
     onpointerleave={() => (hover = null)} onkeydown={key}>
  <span class="track"></span>
  <span class="buffered" style:width="{loaded * 100}%"></span>
  <span class="fill" style:width="{fraction * 100}%"></span>
  <span class="knob" style:left="{fraction * 100}%"></span>
  {#if hover !== null && duration && !thin}
    <span class="tip num" style:left="{hover * 100}%">{time(hover * duration)}</span>
  {/if}
</div>

<style>
  .bar {
    position: relative; height: 22px; flex: 1 1 auto; min-width: 40px;
    cursor: pointer; touch-action: none; border-radius: 999px;
  }
  .track, .buffered, .fill {
    position: absolute; left: 0; top: 50%; height: 4px; margin-top: -2px; border-radius: 999px;
    transition: height var(--fast), margin var(--fast);
  }
  .track { right: 0; background: var(--line-2); }
  .buffered { background: color-mix(in srgb, var(--text) 22%, transparent); }
  .fill { background: var(--text); }
  .bar:hover .fill, .held .fill { background: var(--accent); }
  .bar:hover .track, .bar:hover .buffered, .bar:hover .fill,
  .held .track, .held .buffered, .held .fill { height: 6px; margin-top: -3px; }
  .knob {
    position: absolute; top: 50%; width: 14px; height: 14px; margin: -7px 0 0 -7px;
    border-radius: 50%; background: #fff; box-shadow: 0 1px 5px rgba(0, 0, 0, 0.55);
    transform: scale(0); transition: transform var(--fast);
  }
  .bar:hover .knob, .bar:focus-visible .knob, .held .knob { transform: scale(1); }
  .held .knob { transform: scale(1.2); }
  .tip {
    position: absolute; bottom: 22px; transform: translateX(-50%);
    padding: 3px 7px; border-radius: 7px; font-size: var(--t-xs); font-weight: 600;
    background: var(--elevated); border: 1px solid var(--line-2); pointer-events: none;
  }
  .thin { height: 3px; min-width: 0; pointer-events: none; }
  .thin .track, .thin .buffered, .thin .fill { height: 3px; margin-top: -1.5px; border-radius: 0; }
  .thin .fill { background: var(--accent); }
  .thin .knob { display: none; }
  @media (pointer: coarse) { .bar:not(.thin) { height: 32px; } .knob { transform: scale(1); } }
</style>
