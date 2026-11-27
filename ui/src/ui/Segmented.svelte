<!-- A segmented control: a few exclusive choices in one capsule, with a thumb that slides
     to the chosen one. Arrow keys move it, as they do in a radio group, because that is
     what it is. -->
<script lang="ts" generics="T extends string">
  import Icon from "./Icon.svelte";

  interface Option { value: T; label: string; icon?: string; badge?: number | string | null; title?: string }
  let { options, value = $bindable(), onchange, size = "md", label = "", grow = false, stack = false }: {
    options: Option[]; value: T; onchange?: (value: T) => void;
    size?: "sm" | "md"; label?: string; grow?: boolean;
    /** Icon over a small label: more options in less width (the song tabs on a phone). */
    stack?: boolean;
  } = $props();

  const index = $derived(Math.max(0, options.findIndex((o) => o.value === value)));
  let host = $state<HTMLElement>();
  let thumb = $state({ left: 0, width: 0, ready: false });

  function measure() {
    const node = host?.children[index + 1] as HTMLElement | undefined;   // +1: the thumb is first
    if (!node) return;
    thumb = { left: node.offsetLeft, width: node.offsetWidth, ready: true };
  }
  $effect(() => { void index; void options.length; measure(); });
  $effect(() => {
    if (!host) return;
    const watch = new ResizeObserver(measure);
    watch.observe(host);
    return () => watch.disconnect();
  });

  function pick(next: T) {
    if (next === value) return;
    value = next;
    onchange?.(next);
  }
  function onkey(e: KeyboardEvent) {
    const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1
      : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = options[(index + step + options.length) % options.length];
    pick(next.value);
    (host?.children[options.indexOf(next) + 1] as HTMLElement | undefined)?.focus();
  }
</script>

<div class="seg {size}" class:grow class:stack role="radiogroup" aria-label={label} bind:this={host} onkeydown={onkey} tabindex="-1">
  <span class="thumb" class:ready={thumb.ready} style:transform="translateX({thumb.left}px)" style:width="{thumb.width}px"></span>
  {#each options as option (option.value)}
    <button type="button" role="radio" aria-checked={option.value === value} title={option.title}
            tabindex={option.value === value ? 0 : -1} class:on={option.value === value}
            onclick={() => pick(option.value)}>
      {#if option.icon}<Icon name={option.icon} size={size === "sm" ? 14 : 16} />{/if}
      <span>{option.label}</span>
      {#if option.badge}<span class="badge">{option.badge}</span>{/if}
    </button>
  {/each}
</div>

<style>
  .seg {
    position: relative; display: inline-flex; padding: var(--s1); gap: 0;
    border-radius: var(--r-pill);
    background: rgba(0, 0, 0, 0.3); border: 1px solid var(--line);
    box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.4);
    max-width: 100%; overflow-x: auto; scrollbar-width: none;
    align-self: flex-start;
  }
  .seg::-webkit-scrollbar { display: none; }
  .seg.grow { display: flex; align-self: stretch; }
  .seg.grow button { flex: 1 1 0; }
  .thumb {
    position: absolute; top: var(--s1); bottom: var(--s1); left: 0; border-radius: var(--r-pill);
    background: color-mix(in srgb, var(--text) 13%, transparent);
    border: 1px solid var(--line-2);
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.14), 0 2px 8px rgba(0, 0, 0, 0.35);
    opacity: 0;
  }
  /* No transition until it has been placed once, or it slides in from the left edge. */
  .thumb.ready { opacity: 1; transition: transform 320ms var(--spring), width 320ms var(--spring); }
  button {
    position: relative; z-index: 1; flex: none;
    display: inline-flex; align-items: center; justify-content: center; gap: var(--s2);
    height: 30px; padding: 0 var(--s3); border-radius: var(--r-pill);
    font: 600 var(--t-sm)/1 var(--font); color: var(--text-2); white-space: nowrap;
    transition: color var(--fast);
  }
  .sm button { height: 28px; padding: 0 var(--s3); font-size: var(--t-xs); }
  button:hover { color: var(--text); }
  button.on { color: var(--text); }
  .stack button { flex-direction: column; gap: var(--s1); height: 46px; padding: 0 2px; min-width: 0; font-size: var(--t-xs); }
  .stack { border-radius: var(--r-lg); }
  .stack .badge { position: absolute; top: 3px; left: calc(50% + 6px); }
  .stack .thumb { border-radius: var(--r-md); }
  .badge { min-width: 17px; height: 17px; font-size: var(--t-xs); padding: 0 var(--s1); }
  @media (pointer: coarse) { button { height: 40px; } .sm button { height: 36px; } .stack button { height: 50px; } }
  /* Light: a white track pressed into the page, and a white thumb standing up out of it. */
  :global(html[data-theme="light"]) .seg { background: #FAF9FB; border-color: transparent; box-shadow: var(--neu-in); }
  :global(html[data-theme="light"]) .thumb { background: #FFFFFF; border-color: transparent; box-shadow: var(--neu-out-sm); }
</style>
