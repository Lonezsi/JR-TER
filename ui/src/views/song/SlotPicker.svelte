<!-- One of the two slots: what it holds and how it sounds. Pressing the capsule chooses
     the deck (the one you hear, and the one the Sound tab edits); the caret, or a right
     click, opens the menu for choosing the take and the sound. A selected capsule opens
     the menu too, because a control that looks like a dropdown and does nothing is worse
     than one that does the obvious thing. -->
<script lang="ts">
  import Icon from "$ui/Icon.svelte";
  import { contextMenu } from "$lib/menu.svelte";
  import type { Slot } from "$lib/audio/engine";
  import { useSong } from "./song.svelte";
  import type { GuestWork } from "./guestwork.svelte";
  import type { Uploader } from "./uploads.svelte";
  import { openSlot, slotItems } from "./slotmenu";
  import { versionName } from "./helpers";

  let { slot, guestwork, uploader }: { slot: Slot; guestwork: GuestWork | null; uploader: Uploader } = $props();
  const song = useSong();

  const version = $derived(song.versionOf(slot));
  const preset = $derived(song.presetOf(slot));
  const selected = $derived(song.selected === slot);
  const live = $derived(song.here && song.selected === slot && !!version);
  let root = $state<HTMLElement>();

  function main() {
    if (!selected && version) { song.select(slot); return; }
    if (root) openSlot(song, slot, root, guestwork, uploader);
  }
</script>

<div class="slot" class:sel={selected} class:live bind:this={root}
     use:contextMenu={() => slotItems(song, slot, guestwork, uploader)}>
  <button class="main" onclick={main} aria-pressed={selected}
          aria-label="{slot}: {version ? versionName(version) : 'empty'}{preset ? ', ' + preset.name : ''}">
    <span class="k">{slot}</span>
    <span class="v truncate">{version ? versionName(version) : "not set"}</span>
    {#if preset}<span class="p truncate">{preset.name}</span>{/if}
  </button>
  <button class="caret" onclick={() => root && openSlot(song, slot, root, guestwork, uploader)}
          aria-label="Choose the render and the sound for {slot}" aria-haspopup="menu">
    <Icon name="chev-down" size={14} />
  </button>
</div>

<style>
  .slot {
    display: inline-flex; align-items: stretch; min-width: 0; max-width: 100%;
    border-radius: var(--r-pill); background: var(--hover); border: 1px solid var(--line);
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.07);
    transition: background var(--fast), border-color var(--fast);
  }
  .slot.sel { border-color: var(--accent-line); background: var(--accent-soft); }
  .main {
    display: flex; align-items: center; gap: var(--s2); min-width: 0; padding: 0 var(--s2) 0 var(--s2); height: 36px;
    border-radius: var(--r-pill); font-weight: 600;
  }
  .k {
    display: grid; place-items: center; width: 24px; height: 24px; border-radius: 50%;
    font: 800 var(--t-xs)/1 var(--font); background: var(--pressed); color: var(--text-2);
  }
  .sel .k { background: var(--accent); color: var(--accent-ink); }
  .live .k { box-shadow: 0 0 0 3px var(--accent-soft); }
  .p { color: var(--text-2); font-weight: 500; font-size: var(--t-sm); max-width: 12ch; }
  .p::before { content: "·"; margin-right: var(--s2); color: var(--text-3); }
  .caret { display: grid; place-items: center; width: 32px; border-radius: 0 var(--r-pill) var(--r-pill) 0; color: var(--text-2); }
  .caret:hover { color: var(--text); background: var(--hover); }
  @media (pointer: coarse) { .main { height: 42px; } .caret { width: 40px; } }
</style>
