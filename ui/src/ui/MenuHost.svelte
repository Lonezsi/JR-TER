<!-- Draws the context menu. Placed where it was asked for and then nudged to stay on
     screen. Arrow keys walk it, Enter runs, Escape closes; a letter jumps to the first
     item starting with it. One level of submenu, opened to the side. -->
<script lang="ts">
  import { menu, closeMenu, type MenuItem } from "$lib/menu.svelte";
  import Icon from "./Icon.svelte";
  import { tick } from "svelte";

  type Item = Exclude<MenuItem, null | undefined | false>;
  let node = $state<HTMLElement>();
  let at = $state({ x: 0, y: 0 });
  let sub = $state<{ items: Item[]; x: number; y: number } | null>(null);
  let cameFrom: Element | null = null;

  const runnable = (item: Item): item is Extract<Item, { label: string }> => "label" in item;

  $effect(() => {
    const open = menu.open;
    sub = null;
    if (!open) return;
    cameFrom = document.activeElement;
    at = { x: open.x, y: open.y };
    tick().then(() => {
      if (!node) return;
      const rect = node.getBoundingClientRect();
      const pad = 8;
      let x = open.x, y = open.y;
      if (x + rect.width > innerWidth - pad) x = Math.max(pad, (open.anchor ? open.anchor.right : open.x) - rect.width);
      if (y + rect.height > innerHeight - pad) {
        y = open.anchor ? open.anchor.top - rect.height - 6 : innerHeight - rect.height - pad;
        if (y < pad) y = pad;
      }
      at = { x, y };
      (node.querySelector("[role=menuitem]:not([disabled])") as HTMLElement | null)?.focus({ preventScroll: true });
    });
  });

  function close(restore = true) {
    closeMenu();
    if (restore && cameFrom instanceof HTMLElement && cameFrom.isConnected) cameFrom.focus({ preventScroll: true });
  }

  async function run(item: Extract<Item, { label: string }>, event: MouseEvent | KeyboardEvent) {
    if (item.disabled) return;
    if (item.items) {
      const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
      const kept = item.items.filter(Boolean) as Item[];
      const width = 230;
      sub = { items: kept, x: rect.right + width > innerWidth ? rect.left - width : rect.right - 4,
              y: Math.min(rect.top - 6, innerHeight - kept.length * 36 - 16) };
      return;
    }
    close();
    await item.run?.();
  }

  function onkey(e: KeyboardEvent) {
    if (!menu.open) return;
    const scope = (e.target as HTMLElement).closest(".menu") || node;
    const items = Array.from(scope?.querySelectorAll<HTMLElement>("[role=menuitem]:not([disabled])") || []);
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); if (sub) sub = null; else close(); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); items[(i + 1) % items.length]?.focus(); return; }
    if (e.key === "ArrowUp") { e.preventDefault(); items[(i - 1 + items.length) % items.length]?.focus(); return; }
    if (e.key === "Home") { e.preventDefault(); items[0]?.focus(); return; }
    if (e.key === "End") { e.preventDefault(); items[items.length - 1]?.focus(); return; }
    if (e.key === "ArrowLeft" && sub) { e.preventDefault(); sub = null; return; }
    if (e.key === "Tab") { e.preventDefault(); close(); return; }
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
      const hit = items.find((n) => n.textContent?.trim().toLowerCase().startsWith(e.key.toLowerCase()));
      if (hit) { e.preventDefault(); hit.focus(); }
    }
  }
</script>

<svelte:window onkeydowncapture={onkey} onresize={() => close(false)} onblur={() => close(false)} />

{#snippet list(items: Item[])}
  {#each items as item}
    {#if "divider" in item}
      <div class="divider" role="separator"></div>
    {:else if "group" in item}
      <div class="group">{item.group}</div>
    {:else if runnable(item)}
      <button role="menuitem" class="entry" class:danger={item.danger} disabled={item.disabled}
              onclick={(e) => run(item, e)}
              onkeydown={(e) => { if (e.key === "ArrowRight" && item.items) run(item, e); }}>
        <span class="mark">
          {#if item.checked}<Icon name="check" size={15} />{:else if item.icon}<Icon name={item.icon} size={15} />{/if}
        </span>
        <span class="label">{item.label}{#if item.sub}<span class="sub">{item.sub}</span>{/if}</span>
        {#if item.items}<Icon name="chev-right" size={14} />{:else if item.hint}<span class="hint">{item.hint}</span>{/if}
      </button>
    {/if}
  {/each}
{/snippet}

{#if menu.open}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div class="scrim" onpointerdown={() => close(false)} oncontextmenu={(e) => { e.preventDefault(); close(false); }}></div>
  <div class="menu glass-2" role="menu" bind:this={node} style:left="{at.x}px" style:top="{at.y}px">
    {@render list(menu.open.items)}
  </div>
  {#if sub}
    <div class="menu glass-2" role="menu" style:left="{sub.x}px" style:top="{sub.y}px">
      {@render list(sub.items)}
    </div>
  {/if}
{/if}

<style>
  .scrim { position: fixed; inset: 0; z-index: 800; }
  .menu {
    position: fixed; z-index: 801; min-width: 210px; max-width: min(320px, 92vw);
    max-height: calc(100vh - 16px); overflow-y: auto;
    padding: var(--s1); border-radius: var(--r-md);
    animation: pop 140ms var(--ease) both; transform-origin: top left;
  }
  .entry {
    display: flex; align-items: center; gap: var(--s3); width: 100%;
    min-height: 32px; padding: var(--s1) var(--s3) var(--s1) var(--s2); border-radius: 8px;
    text-align: left; font-size: var(--t-sm); font-weight: 600; color: var(--text);
  }
  /* The row under the pointer is a quiet step up, not a block of accent: the menu is chrome,
     and full-accent rows were the loudest thing on screen (and hard to read). The keyboard's
     row adds a thin accent edge, so it is never lost. */
  .entry:hover, .entry:focus-visible { background: var(--pressed); color: var(--text); outline: none; }
  .entry:focus-visible { box-shadow: inset 0 0 0 1px var(--accent-line); }
  .entry.danger { color: var(--bad); }
  .entry.danger:hover, .entry.danger:focus-visible { background: var(--bad-soft); color: var(--bad); }
  .entry:disabled { opacity: 0.4; pointer-events: none; }
  .mark { width: 16px; flex: none; display: grid; place-items: center; }
  .label { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .hint { font: 600 var(--t-xs)/1 var(--mono); color: var(--text-3); flex: none; }
  /* Shortcut hints mean nothing on a phone. */
  :global(html[data-narrow]) .hint { display: none; }
  .label .sub { display: block; font-size: var(--t-xs); font-weight: 500; color: var(--text-3); margin-top: 1px; }
  .entry:hover .label .sub, .entry:focus-visible .label .sub { color: var(--text-2); }
  .divider { height: 1px; margin: var(--s1) var(--s2); background: var(--line-2); }
  .group { padding: var(--s2) var(--s3) var(--s1); font: 600 var(--t-xs)/1.2 var(--font);
 color: var(--text-3);
           overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  @media (pointer: coarse) { .entry { min-height: 42px; font-size: var(--t-md); } }
</style>
