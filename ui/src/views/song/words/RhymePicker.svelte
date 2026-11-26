<!-- Words that rhyme with the one that was clicked, from both word lists, best first:
     perfect rhymes, near ones (the same vowel family, a similar ending), and ones whose
     vowels agree (asszonánc). The language filter starts at the clicked word's own; the
     same number of syllables comes first within each kind. Picking one puts it in the
     words in place of the clicked one. -->
<script lang="ts">
  import Icon from "$ui/Icon.svelte";
  import { fly } from "svelte/transition";
  import { closesOnBack } from "$lib/back.svelte";
  import { findRhymes, tailText, type Candidate, type Word } from "$lib/lyrics/rhyme";
  import { tailOf, type Lang } from "$lib/lyrics/phon";

  let { word, top, left, onpick, onclose, onoutside, into = "" }: {
    word: Word; top: number; left: number;
    onpick: (to: string) => void; onclose: () => void;
    /** A click outside: return true to keep the picker open (it took the click). */
    onoutside?: (e: MouseEvent) => boolean;
    /** Where a pick goes, said under the word ("replaces “x”"). */
    into?: string;
  } = $props();

  // svelte-ignore state_referenced_locally
  let langs = $state<"both" | Lang>(word.lang);
  let list = $state<Candidate[] | null>(null);
  const tail = $derived(tailOf(word.syls, word.lang));
  closesOnBack(() => true, () => onclose());

  $effect(() => {
    const which: Lang[] = langs === "both" ? ["hu", "en"] : [langs];
    const t = tail;
    list = null;
    // The first search in a language builds its index (a second or so for Hungarian), so
    // it waits a frame to let the panel show it is looking.
    const id = setTimeout(() => {
      list = findRhymes(t, { langs: which, exclude: word.text, syllables: word.syls.length, limit: 200, word: word.text });
    }, 16);
    return () => clearTimeout(id);
  });

  /* Rhymes on the word itself first, by how close they are; then the ones made on its
     ending (házban: fában, ágban), which Hungarian always has plenty of, so they go last. */
  const groups = $derived.by(() => {
    if (!list) return [];
    const own = list.filter((c) => !c.suffix);
    const made = list.filter((c) => c.suffix).slice(0, 60);
    const out: { k: string; name: string; items: Candidate[] }[] = (["perfect", "near", "vowels"] as const)
      .map((k) => ({ k: k as string, name: NAMES[k], items: own.filter((c) => c.kind === k) }));
    if (made.length) out.push({ k: "suffix", name: `Same ending (-${made[0].suffix})`, items: made });
    return out.filter((g) => g.items.length);
  });
  const NAMES = { perfect: "Rhymes", near: "Close enough", vowels: "Same vowels (asszonánc)" };
</script>

<svelte:window onkeydown={(e) => { if (e.key === "Escape") { e.preventDefault(); onclose(); } }} />

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="scrim" onclick={(e) => { if (!onoutside?.(e)) onclose(); }}></div>
<div class="picker glass-2" style:top="{top}px" style:left="{left}px" role="dialog" aria-label="Rhymes for {word.text}"
     transition:fly={{ y: -8, duration: 200 }}>
  <div class="head">
    <button class="icon-btn sm backbtn" onclick={onclose} aria-label="Back"><Icon name="chev-left" size={18} /></button>
    <div class="what">
      <b>{word.text}</b>
      <span class="faint num">{tailText(word.text, tail)} · {word.syls.length} syllable{word.syls.length === 1 ? "" : "s"}{into ? ` · ${into}` : ""}</span>
    </div>
    <div class="langs" role="group" aria-label="Which words">
      {#each [["hu", "HU"], ["en", "EN"], ["both", "Both"]] as [v, label] (v)}
        <button type="button" class:on={langs === v} aria-pressed={langs === v} onclick={() => (langs = v as typeof langs)}>{label}</button>
      {/each}
    </div>
    <button class="icon-btn sm" aria-label="Close" onclick={onclose}><Icon name="close" size={14} /></button>
  </div>
  <div class="body">
    {#if !list}
      <p class="faint wait"><span class="spinner"></span> Finding rhymes…</p>
    {:else if !groups.length}
      <p class="faint wait">Nothing in the list rhymes with this. Try the other language, or both.</p>
    {:else}
      {#each groups as g (g.k)}
        <div class="group">
          <div class="gname">{g.name} <span class="faint num">{g.items.length}</span></div>
          <div class="chips">
            {#each g.items as c (c.lang + c.word)}
              <button type="button" class="pick" class:same={c.syllables === word.syls.length} onclick={() => onpick(c.word)}
                      title="{c.syllables} syllable{c.syllables === 1 ? '' : 's'}{langs === 'both' ? ', ' + (c.lang === 'hu' ? 'Hungarian' : 'English') : ''}">
                {c.word}{#if langs === "both"}<i>{c.lang}</i>{/if}
              </button>
            {/each}
          </div>
        </div>
      {/each}
    {/if}
  </div>
</div>

<style>
  .scrim { position: fixed; inset: 0; z-index: 640; }
  .picker {
    position: absolute; z-index: 650; width: min(440px, calc(100vw - 32px)); max-height: 380px;
    display: flex; flex-direction: column; border-radius: var(--r-lg); overflow: hidden;
    /* Nearly opaque: it opens over the very lines it is about, and a list of words read
       through other words is unreadable. */
    background: rgb(20 21 25 / 0.96);
  }
  .head { display: flex; align-items: center; gap: var(--s3); padding: var(--s3) var(--s3) var(--s2) var(--s4); border-bottom: 1px solid var(--line); }
  .what { display: flex; flex-direction: column; flex: 1 1 auto; min-width: 0; }
  .what b { font-size: var(--t-md); }
  .what span { font-size: var(--t-xs); }
  .langs { display: flex; gap: 2px; padding: 2px; border-radius: 999px; background: rgba(0, 0, 0, 0.3); border: 1px solid var(--line); }
  .langs button { padding: 4px 9px; border-radius: 999px; font: 600 11px/1 var(--font); color: var(--text-3); }
  .langs button.on { background: var(--accent); color: var(--accent-ink); }
  .body { overflow-y: auto; padding: var(--s2) var(--s4) var(--s4); display: flex; flex-direction: column; gap: var(--s3); }
  .wait { display: flex; align-items: center; gap: var(--s2); padding: var(--s3) 0; font-size: var(--t-sm); }
  .gname { font: 600 10.5px/1 var(--font); color: var(--text-3); margin-bottom: var(--s2); }
  .chips { display: flex; flex-wrap: wrap; gap: 4px; }
  .pick {
    padding: 5px 10px; border-radius: 999px; font-size: var(--t-sm); font-weight: 600; color: var(--text-2);
    background: var(--hover); transition: background var(--fast), color var(--fast);
  }
  .pick.same { color: var(--text); }
  .pick:hover { background: var(--accent-soft); color: var(--text); }
  .pick i { font-style: normal; font-size: 9px; color: var(--text-3); margin-left: 4px; text-transform: uppercase; }

  /* The back button: phones only, where a pop-out covers the page. */
  .backbtn { display: none; }
  :global(html[data-narrow]) .backbtn { display: inline-grid; }
</style>
