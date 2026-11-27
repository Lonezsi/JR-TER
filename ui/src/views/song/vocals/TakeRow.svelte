<!-- One take: its switch, its name (click to rename in place), its shape and length, and a
     button that opens its vocal edit underneath. The same actions are in the menu, which
     is also the right click and long press menu of the row. -->
<script lang="ts">
  import Icon from "$ui/Icon.svelte";
  import { deleteSoon } from "$lib/later.svelte";
  import Switch from "$ui/Switch.svelte";
  import TakeWave from "./TakeWave.svelte";
  import FxEditor from "./FxEditor.svelte";
  import { setTakeEnabled, setTakeFx, renameTake, removeTake, vocalFx, vocalUrl, mayChange, FX_SAY, type VocalTake } from "$lib/audio/vocals.svelte";
  import { confirm } from "$lib/dialog.svelte";
  import { contextMenu, showMenu, type MenuItem } from "$lib/menu.svelte";
  import { time } from "$lib/util";

  let { take, open, ontoggle }: { take: VocalTake; open: boolean; ontoggle: () => void } = $props();

  const may = $derived(mayChange(take));
  const effects = $derived((take.chain || []).length);
  const fxState = $derived(take.fx !== 0 ? vocalFx.status(take) : "none");

  let renaming = $state(false);
  let draft = $state("");

  function startRename() {
    if (!may) return;
    draft = take.name || "Take";
    renaming = true;
  }
  function endRename(keep: boolean) {
    if (!renaming) return;
    renaming = false;
    if (keep) void renameTake(take, draft);
  }
  const focusAll = (el: HTMLInputElement) => { el.focus(); el.select(); };

  function download() {
    const a = document.createElement("a");
    a.href = vocalUrl(take) + "&download=1";
    a.download = (take.name || "Take") + (take.ext || "");
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  // Undo instead of a question: it waits out the toast before the recording goes.
  function drop() {
    deleteSoon(`take:${take.id}`, `Deleted ${take.name || "the take"}`, () => removeTake(take).then(() => true));
  }

  const items = (): MenuItem[] => [
    may && { label: "Rename", icon: "edit", run: startRename },
    { label: open ? "Close the vocal edit" : "Vocal edit", icon: "eq", hint: effects ? String(effects) : undefined, run: ontoggle },
    may && { label: take.fx !== 0 ? "Hear it without the edit" : "Hear it with the edit", icon: "wave", run: () => setTakeFx(take, take.fx === 0) },
    { label: "Download this voice", icon: "download", run: download },
    may && { divider: true },
    may && { label: "Delete", icon: "trash", danger: true, run: drop },
  ];

  const sub = $derived([take.by, `from ${time(take.offset)}`, take.duration ? time(take.duration) : ""].filter(Boolean).join(" · "));
</script>

<div class="take" class:open use:contextMenu={items}>
  <div class="row">
    <Switch checked={!!take.enabled} label="Play {take.name || 'this take'} with the song" disabled={!may}
            onchange={(on) => setTakeEnabled(take, on)} />
    <div class="wave"><TakeWave {take} on={!!take.enabled} /></div>
    <div class="grow name">
      {#if renaming}
        <input class="field sm" bind:value={draft} use:focusAll maxlength="80" aria-label="Name of this take"
               onkeydown={(e) => { if (e.key === "Enter") endRename(true); else if (e.key === "Escape") endRename(false); }}
               onblur={() => endRename(true)} />
      {:else if may}
        <button class="title truncate" type="button" title="Rename" onclick={startRename}>{take.name || "Take"}</button>
      {:else}
        <span class="title truncate">{take.name || "Take"}</span>
      {/if}
      <span class="sub faint truncate num">{sub}{#if fxState === "waiting" || fxState === "rendering" || fxState === "failed"} &middot; {FX_SAY[fxState]}{/if}</span>
    </div>
    <button class="chip edit" class:on={open || (effects > 0 && take.fx !== 0)} type="button"
            aria-expanded={open} onclick={ontoggle}
            title={may ? "EQ, limiter, autotune, sidechain" : "See the vocal edit"}>
      <Icon name="eq" size={14} /> Edit{#if effects} <span class="num">{effects}</span>{/if}
    </button>
    <button class="icon-btn sm" type="button" aria-label="More for {take.name || 'this take'}"
            onclick={(e) => showMenu(items(), { anchor: e.currentTarget })}>
      <Icon name="more" size={18} />
    </button>
  </div>
  {#if open}
    <div class="editor enter"><FxEditor {take} /></div>
  {/if}
</div>

<style>
  .take { padding: var(--s2) var(--s3); border-radius: var(--r-md); transition: background var(--fast); }
  .take.open { background: color-mix(in srgb, var(--text) 3%, transparent); }
  .take:not(:first-child) { border-top: 1px solid var(--line); }
  .row { display: flex; align-items: center; gap: var(--s3); min-height: 48px; }
  .wave { width: 96px; height: 30px; flex: none; }
  .name { display: flex; flex-direction: column; line-height: 1.3; }
  .title { font-weight: 600; text-align: left; border-radius: var(--r-sm); padding: 0 var(--s1); margin-left: calc(var(--s1) * -1); color: var(--text); }
  @media (pointer: coarse) { button.title { min-height: var(--s7); } }
  button.title:hover { background: var(--hover); }
  .sub { font-size: var(--t-sm); }
  .edit { flex: none; }
  .editor { border-top: 1px solid var(--line); margin-top: var(--s2); }
  @media (max-width: 640px) {
    .row { flex-wrap: wrap; row-gap: var(--s2); }
    .wave { order: 5; width: 100%; flex: 1 1 100%; height: 26px; }
    .name { flex: 1 1 120px; }
  }
</style>
