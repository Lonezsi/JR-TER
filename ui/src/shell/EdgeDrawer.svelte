<!-- The phone's sidebar: a drawer that follows your thumb.

     Any sideways drag that isn't already somebody else's (a slider, a canvas, a text field,
     something that scrolls sideways itself) pulls the drawer along with it, with a rubber
     band past either end. Letting go settles it open or shut by where it is, or by which
     way it was flicked. Held out past its open stop for a second, it offers Foyer: a bubble
     slides out of the same edge, stays a couple of seconds after the thumb comes off, and
     pressing it closes the drawer and goes there.

     The drawer only ever moves, never fades: it holds glass, and an ancestor of glass that
     changes opacity cuts the blur off. The dim behind it is its own layer. -->
<script lang="ts">
  import { onMount } from "svelte";
  import Icon from "$ui/Icon.svelte";
  import { FOYER } from "$lib/app.svelte";
  import { shell } from "./state.svelte";
  import { closesOnBack } from "$lib/back.svelte";
  import Sidebar from "./Sidebar.svelte";

  const LOCK = 8;          // px before a drag is sideways or not
  const SWIPE = 55;        // a mouse drag this far toggles it outright
  const BAND = 0.32;       // past either end it gives this much of what the finger asks
  const FLICK = 0.45;      // px/ms that decides by direction rather than position
  const STILL = 80;        // ms without movement that makes a release not a flick
  const HOLD = 1000;       // ms held past the stop before Foyer is offered
  const OFFERED = 2000;    // ms the offer stays after the thumb comes off
  const PAST = Math.round(18 / BAND);   // finger travel past the stop that shows as 18px of drawer

  let drawer = $state<HTMLElement>();
  let x = $state<number | null>(null);          // offset while dragging: 0 open, -travel shut
  let travel = $state(320);
  let offered = $state(false);
  let leaving = $state(false);

  const openness = $derived(x === null ? (shell.drawer ? 1 : 0) : Math.max(0, Math.min(1, 1 + x / travel)));

  let holdTimer: ReturnType<typeof setTimeout> | undefined;
  let fadeTimer: ReturnType<typeof setTimeout> | undefined;
  function offer() {
    holdTimer = undefined;
    offered = true;
    try { navigator.vibrate?.(18); } catch { /* refused, and it doesn't matter */ }
  }
  function withdraw() {
    clearTimeout(holdTimer); holdTimer = undefined;
    clearTimeout(fadeTimer); fadeTimer = undefined;
    offered = false;
  }
  function letFade() {
    if (!offered) return;
    clearTimeout(fadeTimer);
    fadeTimer = setTimeout(withdraw, OFFERED);
  }
  function goFoyer() {
    withdraw();
    leaving = true;
    shell.drawer = false;
    setTimeout(() => location.assign(FOYER), 300);
  }

  closesOnBack(() => shell.drawer, () => (shell.drawer = false));

  /** Whether a press on this belongs to something that wants sideways drags itself.
   *  A text field only while it is being typed in: an idle one (the lyrics, say) opens on a
   *  tap, which the browser does by itself, and a sideways swipe across it is the drawer's. */
  function claimsSideways(node: Element | null): boolean {
    if (!node?.closest) return false;
    // Things that are dragged sideways by nature (sliders, lanes, the timeline) keep the
    // swipe whatever has focus; a text field only keeps it while you're typing in it.
    if (node.closest("input[type='range'], canvas, .range, .track, .timeline, .sheet, .menu, [data-swipe], [role='slider']")) return true;
    const field = node.closest("input:not([type='checkbox']):not([type='radio']):not([type='button']), textarea, select, [contenteditable='true']");
    if (field) return field === document.activeElement;
    for (let el: Element | null = node; el && el !== document.body; el = el.parentElement) {
      // Only something that really scrolls sideways: overflow-y: auto makes overflow-x auto
      // too, and a vertical list a pixel too wide would otherwise keep every swipe for itself.
      const style = getComputedStyle(el);
      if (/(auto|scroll)/.test(style.overflowX) && style.overflowX !== style.overflowY
          && el.scrollWidth > el.clientWidth + 1) return true;
      if (/(auto|scroll)/.test(style.overflowX) && el.scrollWidth > el.clientWidth + 24) return true;
    }
    return false;
  }

  type Drag = { id: number; mouse: boolean; x0: number; y0: number; axis: boolean; base: number; at: number; px: number; t: number; v: number; moved: boolean };
  let drag: Drag | null = null;
  let fingers = 0;

  function swallowClick() {
    const eat = (c: Event) => { c.stopPropagation(); c.preventDefault(); };
    window.addEventListener("click", eat, { capture: true, once: true });
    setTimeout(() => window.removeEventListener("click", eat, { capture: true }), 400);
  }

  function place(at: number) {
    let v = at;
    if (v > 0) v = v * BAND;
    else if (v < -travel) v = -travel + (v + travel) * BAND;
    x = Math.round(v);
  }
  function settle(open: boolean) {
    x = null;
    shell.drawer = open;
  }

  onMount(() => {
    const down = (e: PointerEvent) => {
      drag = null;
      if (e.pointerType !== "mouse") fingers += 1;
      if (fingers > 1 || e.button || !shell.narrow || leaving) return;
      if (claimsSideways(e.target as Element)) return;
      drag = { id: e.pointerId, mouse: e.pointerType === "mouse", x0: e.clientX, y0: e.clientY, axis: false,
               base: 0, at: 0, px: e.clientX, t: e.timeStamp, v: 0, moved: false };
    };
    const move = (e: PointerEvent) => {
      if (!drag || e.pointerId !== drag.id) return;
      const dx = e.clientX - drag.x0, dy = e.clientY - drag.y0;
      if (!drag.axis) {
        if (Math.abs(dy) >= LOCK && Math.abs(dy) > Math.abs(dx)) { drag = null; return; }
        if (Math.abs(dx) < LOCK) return;
        drag.axis = true;
        if (drag.mouse) return;
        travel = (drawer?.getBoundingClientRect().width || 300) + 24;
        drag.base = shell.drawer ? 0 : -travel;
      }
      if (drag.mouse) {
        if (Math.abs(dx) < SWIPE) return;
        if (!(window.getSelection()?.isCollapsed ?? true)) { drag = null; return; }
        drag = null;
        settle(dx > 0);
        return;
      }
      if (e.timeStamp - drag.t >= 8) {
        drag.v = (e.clientX - drag.px) / (e.timeStamp - drag.t);
        drag.px = e.clientX; drag.t = e.timeStamp;
      }
      drag.moved = true;
      drag.at = drag.base + dx;
      place(drag.at);
      if (drag.at >= PAST) { if (!holdTimer && !offered) holdTimer = setTimeout(offer, HOLD); }
      else withdraw();
    };
    const up = (e: PointerEvent) => {
      fingers = Math.max(0, fingers - 1);
      if (!drag || e.pointerId !== drag.id) return;
      const d = drag;
      drag = null;
      if (!d.axis || d.mouse) return;
      // A swipe is not a tap on whatever it started on: the click the browser may still
      // send at the end of it is swallowed.
      swallowClick();
      if (offered) { settle(true); letFade(); return; }
      clearTimeout(holdTimer); holdTimer = undefined;
      const speed = e.timeStamp - d.t > STILL ? 0 : d.v;
      settle(Math.abs(speed) >= FLICK ? speed > 0 : d.at > -travel / 2);
    };
    const cancel = () => {
      fingers = Math.max(0, fingers - 1);
      if (!drag) return;
      const d = drag;
      drag = null;
      letFade();
      if (d.axis && !d.mouse) settle(d.base === 0);
    };
    document.addEventListener("pointerdown", down, { passive: true });
    document.addEventListener("pointermove", move, { passive: true });
    document.addEventListener("pointerup", up, { passive: true });
    document.addEventListener("pointercancel", cancel, { passive: true });
    return () => {
      document.removeEventListener("pointerdown", down);
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", up);
      document.removeEventListener("pointercancel", cancel);
      withdraw();
    };
  });
  // Shut by anything else (a link, the button) takes the offer away with it.
  $effect(() => { if (!shell.drawer && x === null) withdraw(); });
</script>

{#if shell.narrow}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div class="scrim" class:on={shell.drawer} class:dragging={x !== null} style:opacity={openness}
       onclick={() => (shell.drawer = false)}></div>
  <div class="drawer" class:open={shell.drawer} class:dragging={x !== null} bind:this={drawer}
       style:transform={x !== null ? `translateX(${x}px)` : undefined} inert={!shell.drawer && x === null}>
    <Sidebar drawer onnavigate={() => (shell.drawer = false)} />
  </div>
  <button class="bubble glass-2" class:on={offered} type="button" tabindex={offered ? 0 : -1} aria-hidden={!offered}
          onpointerdown={() => clearTimeout(fadeTimer)} onpointerleave={letFade} onclick={goFoyer}>
    <Icon name="door" size={16} /><span>Foyer</span>
  </button>
{/if}

<style>
  /* Sideways swipes on the drawer and its dim are ours (to slide it back), vertical ones
     scroll its list: without this the browser takes the swipe and cancels it. */
  .scrim, .drawer, .drawer :global(*) { touch-action: pan-y; }
  .scrim {
    position: fixed; inset: 0; z-index: 400; background: rgba(0, 0, 0, 0.5);
    backdrop-filter: blur(3px); -webkit-backdrop-filter: blur(3px);
    pointer-events: none; transition: opacity 300ms var(--ease);
  }
  .scrim.on { pointer-events: auto; }
  .scrim.dragging { transition: none; }
  .drawer {
    position: fixed; z-index: 401; left: var(--gap); top: calc(var(--gap) + var(--safe-t)); bottom: calc(var(--gap) + var(--safe-b));
    width: min(300px, calc(100vw - var(--gap) * 2 - 40px)); --rail-w: 100%;
    transform: translateX(calc(-100% - var(--gap) * 2 - 24px)); visibility: hidden;
    transition: transform 380ms var(--spring), visibility 0s linear 400ms;
  }
  .drawer.open, .drawer.dragging { transform: translateX(0); visibility: visible; transition: transform 380ms var(--spring), visibility 0s; }
  .drawer.dragging { transition: none; }
  .drawer :global(.rail) { box-shadow: var(--edge-top), var(--shadow-3); }

  /* Out of the same edge as the drawer, and back into it. */
  .bubble {
    position: fixed; left: 0; top: 50%; z-index: 402;
    display: flex; align-items: center; gap: var(--s2); min-height: 46px; padding: 0 var(--s4) 0 var(--s4);
    border-radius: 0 999px 999px 0; color: var(--text); font-weight: 600; font-size: var(--t-sm);
    transform: translate(-105%, -50%); transition: transform 300ms var(--spring);
    pointer-events: none;
  }
  .bubble.on { transform: translate(0, -50%); pointer-events: auto; }
  .bubble :global(svg) { color: var(--accent); }
  @media (prefers-reduced-motion: reduce) { .drawer, .scrim, .bubble { transition: none; } }
</style>
