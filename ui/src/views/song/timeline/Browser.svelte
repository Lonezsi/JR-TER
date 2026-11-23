<!-- The browser at the left of the arrangement editor: what can go into the playlist.
     Sections are dragged onto the lane (or added at the end with Enter or the + on the
     row), the way a pattern is dragged into a playlist. Takes are listed so the one the
     arrangement is cut from is always visible, and clicking one plays it. -->
<script lang="ts" module>
  /** The type a dragged section travels under, so the lane can tell it from a file. */
  export const PART = "application/x-jriter-part";
</script>

<script lang="ts">
  import Icon from "$ui/Icon.svelte";
  import { arrange, state as A } from "$lib/audio/arrange.svelte";
  import { play } from "$lib/player.svelte";
  import { time } from "$lib/util";
  import { useSong } from "../song.svelte";
  import { history, lengthWords } from "./edits.svelte";

  let { onadded = () => {} }: { onadded?: (clipId: string) => void } = $props();
  const song = useSong();

  function add(partId: string) {
    history.mark();
    const clip = arrange.insert(partId, A.clips.length);
    if (clip) onadded(clip.id);
  }
  function dragStart(e: DragEvent, partId: string) {
    if (!e.dataTransfer) return;
    e.dataTransfer.setData(PART, partId);
    e.dataTransfer.setData("text/plain", partId);
    e.dataTransfer.effectAllowed = "copy";
  }
  const takeName = (v: (typeof song.versions)[number]) => v.label || (v.n != null ? `Take ${v.n}` : v.filename || "Take");
</script>

<aside class="browser" aria-label="Browser">
  <div class="shelf">
    <span class="eyebrow">Sections</span>
    <span class="faint num">{A.parts.length}</span>
  </div>
  <ul class="bin" role="list">
    {#each A.parts as part (part.id)}
      <li>
        <div class="row" role="button" tabindex="0" draggable="true" style:--hue={part.hue}
             title="Drag onto the playlist, or press Enter to add it at the end"
             ondragstart={(e) => dragStart(e, part.id)}
             onkeydown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(part.id); } }}>
          <i class="swatch"></i>
          <span class="truncate">{part.name}</span>
          <span class="faint num len">{lengthWords(part.beats)}</span>
          <button class="add" aria-label="Add {part.name} at the end" title="Add at the end" tabindex="-1"
                  onclick={() => add(part.id)}><Icon name="plus" size={13} /></button>
        </div>
      </li>
    {:else}
      <li class="faint none">Lay the song out to get its sections.</li>
    {/each}
  </ul>

  <div class="shelf">
    <span class="eyebrow">Takes</span>
    <span class="faint num">{song.versions.length}</span>
  </div>
  <ul class="bin" role="list">
    {#each song.versions as v (v.id)}
      {@const source = String(v.id) === String(A.versionId)}
      <li>
        <button class="row take" class:on={source} title={source ? "The arrangement is cut from this take. Click to play it." : "Click to play this take"}
                onclick={() => { if (song.song) void play(song.song, v); }}>
          <Icon name={source ? "timeline" : "wave"} size={13} />
          <span class="truncate">{takeName(v)}</span>
          <span class="faint num len">{v.duration ? time(v.duration) : ""}</span>
        </button>
      </li>
    {/each}
  </ul>
</aside>

<style>
  .browser {
    display: flex; flex-direction: column; gap: 2px; min-width: 0; min-height: 0; overflow-y: auto;
    padding: var(--s2); border-radius: var(--r-md);
    background: rgba(0, 0, 0, 0.18); box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.4);
  }
  .shelf { display: flex; align-items: baseline; justify-content: space-between; padding: var(--s2) var(--s2) var(--s1); }
  .shelf:not(:first-child) { margin-top: var(--s2); }
  .bin { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 1px; }
  .row {
    position: relative; display: flex; align-items: center; gap: var(--s2); width: 100%; min-width: 0;
    height: 28px; padding: 0 var(--s2); border-radius: var(--r-sm); text-align: left;
    font-size: var(--t-sm); color: var(--text-2); cursor: grab; transition: background var(--fast), color var(--fast);
  }
  .row:hover, .row:focus-visible { background: var(--hover); color: var(--text); outline: none; }
  .row:focus-visible { box-shadow: inset 0 0 0 1.5px var(--accent); }
  .row.take { cursor: pointer; }
  .row.on { color: var(--accent-text); }
  .swatch { flex: none; width: 10px; height: 14px; border-radius: 3px; background: linear-gradient(180deg, hsl(var(--hue) 50% 42%), hsl(var(--hue) 44% 26%)); box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.18); }
  .len { margin-left: auto; font-size: 11px; flex: none; }
  .add { flex: none; display: grid; place-items: center; width: 22px; height: 22px; border-radius: var(--r-sm); color: var(--text-3); opacity: 0; transition: opacity var(--fast), background var(--fast); }
  .row:hover .add, .row:focus-visible .add { opacity: 1; }
  .add:hover { background: var(--hover); color: var(--text); }
  @media (pointer: coarse) { .add { opacity: 1; width: 30px; height: 30px; } .row { height: 36px; } }
  .none { font-size: var(--t-sm); padding: var(--s1) var(--s2); }
</style>
