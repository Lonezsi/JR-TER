<!-- The words, read for sound (lib/lyrics).

     Every vowel has a mark under it: its colour is the vowel's family (a, e, i, o, ö, u, ü,
     and the English diphthongs as a blend of the two they glide between), its shape is its
     length (a dot short, a bar long). The end of each line that rhymes is tinted in its
     rhyme's colour, with the letter it has in its stanza's scheme in the gutter beside the
     syllable count and the line's language. A stanza says what shape it rhymes in; a line
     that breaks that shape says so under itself, with words that would mend it.

     "marks" draws only the marks, with the text itself invisible, so it can sit exactly
     under the editor's textarea and decorate what is being typed. -->
<script lang="ts">
  import Icon from "$ui/Icon.svelte";
  import { analyse, asides, findRhymes, tailText, lexicon, type Analysis, type Line } from "$lib/lyrics/rhyme";
  import { slide, fly } from "svelte/transition";
  import { VOWELS, type Lang } from "$lib/lyrics/phon";

  let {
    text, mode = "read", skipFirst = false, forced = {}, ready = 0,
    show = { marks: true, highlight: false, structure: true, warnings: true }, langs = false,
    onword, onreplace, onforce, target = null,
  }: {
    /** The word the rhyme picker is rhyming with: lit up so you can see what it went for. */
    target?: { line: number; word: number } | null;
    /** What to draw: vowel marks (underlined, or highlighted behind the letters), each
     *  stanza's structure (its head and the gutter), the warnings. */
    show?: { marks: boolean; highlight: boolean; structure: boolean; warnings: boolean; spellcheck?: boolean };
    /** Show each line's language (held or pinned from the toolbar). */
    langs?: boolean;
    text: string;
    /** read: on its own. edit: under a text field, every line in place (nothing inserted
     *  between them), the gutter beside the text, warnings behind a "!" there. marks: the
     *  marks only, text invisible. */
    mode?: "read" | "edit" | "marks";
    /** The first line is the set's title, not a lyric. */
    skipFirst?: boolean;
    forced?: Record<string, Lang>;
    /** Bumped when the word lists arrive, so the reading is done again with them. */
    ready?: number;
    onword?: (line: Line, word: number, el: HTMLElement) => void;
    onreplace?: (line: number, at: number, from: string, to: string) => void;
    onforce?: (lineText: string, lang: Lang | null) => void;
  } = $props();

  const source = $derived(skipFirst ? text.split("\n").map((l, i) => (i === 0 ? "" : l)).join("\n") : text);
  const result = $derived.by<Analysis>(() => { void ready; return analyse(source, { forced }); });
  const raw = $derived(text.split("\n"));
  const findings = $derived(new Map(result.stanzas.flatMap((s) => s.findings).map((f) => [f.line, f])));
  const stanzaAt = $derived(new Map(result.stanzas.map((s) => [s.lines[0].index, s])));
  const rhymed = $derived(new Set(result.lines.filter((l) => l.partners.length).map((l) => l.index)));
  /* A heading line ([Verse 1], # Chorus) whose stanza head already shows its title: the
     head says it once, so the raw line is not drawn as well. Only while reading: under
     the editor every line has to be there, or the marks drift off their letters. */
  let openFinding = $state<number | null>(null);
  const stanzaOf = $derived(new Map(result.stanzas.flatMap((s) => s.lines.map((l) => [l.index, s] as const))));
  const titled = $derived(new Set(mode === "read" ? result.stanzas.filter((s) => s.title).map((s) => {
    let k = s.lines[0].index - 1;
    while (k >= 0 && !raw[k].trim()) k--;
    return k;
  }) : []));

  /* A line cut into pieces: plain text, vowel letters (with their family and length), and
     whether a piece is inside the rhyming tail. */
  interface Piece { t: string; fam?: string; long?: boolean; diph?: [string, string]; tail?: boolean; word?: number; aside?: string }
  /** Cut plain text at its asides, so they can be drawn dimmer. */
  function plain(t: string): Piece[] {
    const out: Piece[] = [];
    let i = 0;
    for (const a of asides(t)) {
      if (a.from > i) out.push({ t: t.slice(i, a.from) });
      out.push({ t: t.slice(a.from, a.to), aside: a.kind });
      i = a.to;
    }
    if (i < t.length || !out.length) out.push({ t: t.slice(i) });
    return out;
  }
  function pieces(line: Line | undefined, t: string): Piece[] {
    if (!line) return plain(t);
    const ranges = asides(t);
    const asideAt = (i: number) => ranges.find((r) => i >= r.from && i < r.to)?.kind;
    const marks: { from: number; to: number; fam: string; long: boolean; diph?: [string, string]; word: number }[] = [];
    let tailFrom = -1;
    line.words.forEach((w, wi) => {
      for (const s of w.syls) {
        const v = VOWELS[s.v];
        if (!v) continue;
        const diph = v.family.length === 2 ? [v.family[0], v.family[1]] as [string, string] : undefined;
        marks.push({ from: w.at + s.at[0], to: w.at + s.at[1], fam: v.family, long: v.long, diph, word: wi });
      }
      if (w === line.end && line.tail.length && rhymed.has(line.index)) tailFrom = w.at + line.tail[0].at[0];
    });
    const wordAt = (i: number) => line.words.findIndex((w) => i >= w.at && i < w.at + w.text.length);
    const out: Piece[] = [];
    let i = 0;
    const tailEnd = line.end ? line.end.at + line.end.text.length : -1;
    const push = (from: number, to: number, extra: Partial<Piece> = {}) => {
      if (to <= from) return;
      // Split at the tail's start and end so the tint is exact.
      // Also at every word's edges, so a word's own pieces never share one with a space.
      const edges = [...ranges.flatMap((r) => [r.from, r.to]), ...line.words.flatMap((w) => [w.at, w.at + w.text.length])];
      const cuts = [from, to, tailFrom, tailEnd, ...edges].filter((c) => c > from && c < to).sort((a, b) => a - b);
      let a = from;
      for (const c of [...cuts, to]) {
        const wi = wordAt(a);
        out.push({ t: t.slice(a, c), ...extra, tail: tailFrom >= 0 && a >= tailFrom && a < tailEnd, word: wi >= 0 ? wi : undefined, aside: asideAt(a) });
        a = c;
      }
    };
    for (const m of marks.sort((a, b) => a.from - b.from)) {
      if (m.from < i) continue;
      push(i, m.from);
      push(m.from, m.to, { fam: m.fam, long: m.long, diph: m.diph });
      i = m.to;
    }
    push(i, t.length);
    return out;
  }

  const hueOf = (g: number) => (g * 137.508 + 20) % 360;
  /* Each family's colour, spelled out (the tokens are defined in the style below). */
  const FAM: Record<string, string> = {
    a: "var(--fam-a)", e: "var(--fam-e)", i: "var(--fam-i)", o: "var(--fam-o)",
    ö: "var(--fam-oe)", u: "var(--fam-u)", ü: "var(--fam-ue)",
  };
  const langLabel = (l: Line) => (l.lang === "mixed" ? "HU+EN" : l.lang ? l.lang.toUpperCase() : "?");
  function cycle(l: Line) {
    const now = forced[l.text.trim()];
    onforce?.(l.text.trim(), now === undefined ? "hu" : now === "hu" ? "en" : null);
  }
  function fixes(index: number): { word: string }[] {
    const f = findings.get(index);
    const line = result.byIndex.get(index);
    const partner = f?.partner !== undefined ? result.byIndex.get(f.partner) : undefined;
    if (!f || !line || !partner || !lexicon) return [];
    const lang = line.end?.lang ?? "hu";
    return findRhymes(partner.tail, { langs: [lang], exclude: line.end?.text, syllables: line.end?.syls.length, limit: 8 });
  }
</script>

<div class="rl" class:marks={mode === "marks"} class:edit={mode === "edit"} class:nomarks={!show.marks} class:hl={show.marks && show.highlight}>
  {#each raw as t, index (index)}
    {@const line = result.byIndex.get(index)}
    {@const st = mode === "read" ? stanzaAt.get(index) : undefined}
    {#if st}
      {#if show.structure}
      <div class="stanza-head" aria-label="Stanza shape" transition:slide={{ duration: 200 }}>
        {#if st.title}<span class="title">{st.title}</span>{/if}
        <span class="scheme num">{#each [...st.scheme] as ch, k (k)}<b style:--h={hueOf(st.lines[k].group)}>{ch}</b>{/each}</span>
        {#if st.pattern}<span class="faint">{st.pattern.name}</span>{/if}
        {#if st.syllables.median}<span class="faint">· ~{st.syllables.median} syllables per line</span>{/if}
      </div>
      {/if}
    {/if}
    {#if !titled.has(index)}
    <div class="row" data-l={index} class:blank={!t.trim()} class:flagged={mode !== "marks" && show.warnings && findings.has(index)}>
      <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
      <div class="text" style:--h={line ? hueOf(line.group) : 0}
           onclick={(e) => {
             const el = (e.target as HTMLElement).closest<HTMLElement>("[data-w]");
             if (!el || !line || mode !== "read") return;
             e.stopPropagation();
             onword?.(line, Number(el.dataset.w), el);
           }}>{#each pieces(line, t) as p, k (k)}<span
            class:v={!!p.fam} class:long={p.long} class:tail={p.tail} data-w={p.word} data-aside={p.aside} class:target={!!target && target.line === index && target.word === p.word && p.word !== undefined}
            style:--f={p.fam && !p.diph ? FAM[p.fam] : undefined}
            style:--f1={p.diph ? FAM[p.diph[0]] : undefined}
            style:--f2={p.diph ? FAM[p.diph[1]] : undefined}
            class:diph={!!p.diph}>{p.t}</span>{/each}{#if !t}&#8203;{/if}</div>
      {#if mode === "edit"}
        <!-- Every row has its gutter, even blank ones, so each keeps the text's own height. -->
        <div class="gutter fixed">
          {#if line && langs}
            <button class="lang" type="button" title="Language of this line: click to choose (automatic, Hungarian, English)"
                    class:forced={forced[line.text.trim()] !== undefined} onclick={(e) => { e.stopPropagation(); cycle(line); }}
                    transition:fly={{ x: 6, duration: 160 }}>{langLabel(line)}</button>
          {/if}
          {#if line && show.structure}
            {@const st = stanzaOf.get(index)}
            <span class="syl num" title="Syllables">{line.syllables}</span>
            <span class="letter" style:--h={hueOf(line.group)} class:alone={!line.partners.length}
                  title={`${st ? `${st.scheme}${st.pattern ? ` (${st.pattern.name})` : ""}. ` : ""}${line.partners.length ? `Rhymes with line${line.partners.length > 1 ? "s" : ""} ${line.partners.map((p) => p.line + 1).join(", ")}` : "Doesn't rhyme with anything here"}`}>{line.letter}</span>
          {/if}
          {#if line && show.warnings && findings.has(index)}
            <button class="flag" type="button" class:meter={findings.get(index)?.severity === "meter"} aria-expanded={openFinding === index}
                    title={findings.get(index)?.says} onclick={(e) => { e.stopPropagation(); openFinding = openFinding === index ? null : index; }}
                    aria-label={findings.get(index)?.says}><Icon name="warning" size={14} /></button>
          {:else if line && show.warnings && mode === "edit"}
            <!-- The warning's room, kept on every line, so the numbers and letters line up. -->
            <span class="flag" aria-hidden="true"></span>
          {/if}
        </div>
        {#if openFinding === index && findings.has(index)}
          {@const f = findings.get(index)!}
          <div class="pop glass-2" transition:fly={{ y: -6, duration: 180 }}>
            <span class="says">{f.says}</span>
            {#if f.severity === "break" && line?.end}
              {@const list = fixes(index)}
              {#if list.length}
                <span class="try">try
                  {#each list as c, k (c.word)}<button type="button" class="alt" onclick={(e) => { e.stopPropagation(); openFinding = null; onreplace?.(index, line.end!.at, line.end!.text, c.word); }}>{c.word}</button>{#if k < list.length - 1}<span class="sep">·</span>{/if}{/each}
                </span>
              {/if}
            {/if}
          </div>
        {/if}
      {:else if mode === "read" && line && (show.structure || langs)}
        <div class="gutter" class:held={langs} transition:fly={{ x: 8, duration: 180 }}>
          {#if langs}
            <button class="lang" type="button" title="Language of this line: click to choose (automatic, Hungarian, English)"
                    class:forced={forced[line.text.trim()] !== undefined} onclick={(e) => { e.stopPropagation(); cycle(line); }}
                    transition:fly={{ x: 6, duration: 160 }}>{langLabel(line)}</button>
          {/if}
          {#if show.structure}
          <span class="syl num" title="Syllables">{line.syllables}</span>
          <span class="letter" style:--h={hueOf(line.group)} class:alone={!line.partners.length}
                title={line.partners.length ? `Rhymes with line${line.partners.length > 1 ? "s" : ""} ${line.partners.map((p) => p.line + 1).join(", ")}` : "Doesn't rhyme with anything here"}>{line.letter}</span>
          {/if}
        </div>
      {/if}
    </div>
    {/if}
    {#if mode === "read" && show.warnings && findings.has(index)}
      {@const f = findings.get(index)!}
      <div class="finding" class:meter={f.severity === "meter"} transition:slide={{ duration: 200 }}>
        <span class="says">{f.says}</span>
        {#if f.severity === "break" && line?.end}
          {@const list = fixes(index)}
          {#if list.length}
            <span class="try">try
              {#each list as c, k (c.word)}<button type="button" class="alt" onclick={(e) => { e.stopPropagation(); onreplace?.(index, line.end!.at, line.end!.text, c.word); }}>{c.word}</button>{#if k < list.length - 1}<span class="sep">·</span>{/if}{/each}
            </span>
          {/if}
        {/if}
      </div>
    {/if}
  {/each}
</div>

<style>
  /* The vowel families, one colour each, the same everywhere they are drawn. */
  .rl {
    --fam-a: hsl(14 90% 64%); --fam-e: hsl(44 92% 60%); --fam-i: hsl(96 62% 56%);
    --fam-o: hsl(198 85% 62%); --fam-oe: hsl(262 80% 72%); --fam-u: hsl(166 70% 52%);
    --fam-ue: hsl(318 80% 70%);
    font-size: var(--t-lg); line-height: 1.85;
  }
  .row { display: flex; align-items: baseline; gap: var(--s4); }
  .row.blank { min-height: 1.4em; }
  .text { flex: 1 1 auto; min-width: 0; white-space: pre-wrap; overflow-wrap: break-word; }
  /* A vowel's mark sits under its letters: a dot when short, a bar the letters' width
     when long; a diphthong's bar runs from one family's colour into the other's. */
  .v { position: relative; }
  .v::after {
    content: ""; position: absolute; left: 50%; bottom: -0.08em; width: 5px; height: 5px; border-radius: 50%;
    transform: translateX(-50%); background: var(--f);
  }
  .v.long::after { left: 8%; width: 84%; height: 3px; border-radius: 2px; transform: none; }
  .v.diph::after { background: linear-gradient(90deg, var(--f1), var(--f2)); }
  /* Marks off: no vowel marks and no rhyme tint. Highlight: the vowel's colour fills the
     background behind its letters, long vowels stronger, instead of a mark underneath. */
  .nomarks .v::after { display: none; }
  .nomarks .tail { background: none; }
  .hl .v::after { display: none; }
  .hl .v { background: color-mix(in srgb, var(--f) 30%, transparent); border-radius: 3px; }
  .hl .v.long { background: color-mix(in srgb, var(--f) 50%, transparent); }
  .hl .v.diph { background: linear-gradient(90deg, color-mix(in srgb, var(--f1) 45%, transparent), color-mix(in srgb, var(--f2) 45%, transparent)); }
  .tail { background: hsl(var(--h) 70% 55% / 0.2); box-shadow: 0 0.12em 0 hsl(var(--h) 70% 60% / 0.0); border-radius: 4px; }
  span[data-w] { cursor: pointer; }
  .marks span[data-w] { cursor: auto; }
  .text :global(span[data-w]:hover) { text-decoration: underline; text-decoration-color: var(--text-3); text-underline-offset: 0.35em; }

  /* The gutter stays quiet until you look at a line. */
  .gutter { flex: none; display: flex; align-items: center; gap: var(--s3); font-size: var(--t-xs); opacity: 0.45; transition: opacity var(--fast); }
  .row:hover .gutter { opacity: 1; }
  .syl { width: 2.2ch; text-align: right; color: var(--text-3); }
  .lang {
    font: 600 9.5px/1 var(--font); letter-spacing: 0.06em; color: var(--text-3); padding: 3px 5px; border-radius: 5px;
    border: 1px solid transparent; min-width: 26px;
  }
  .lang:hover { border-color: var(--line-2); color: var(--text); }
  .lang.forced { color: var(--accent-text); border-color: var(--accent-line); }
  .letter {
    width: 18px; height: 18px; display: grid; place-items: center; border-radius: 5px;
    font: 800 10px/1 var(--display); color: hsl(var(--h) 70% 72%); background: hsl(var(--h) 70% 62% / 0.2);
  }
  .letter.alone { background: transparent; color: var(--text-3); box-shadow: inset 0 0 0 1px var(--line-2); }

  .stanza-head { display: flex; align-items: center; gap: var(--s2); flex-wrap: wrap; margin: 1.6em 0 0.35em; font-size: var(--t-xs); opacity: 0.55; transition: opacity var(--fast); }
  .stanza-head:hover { opacity: 1; }
  .stanza-head:first-child { margin-top: 0; }
  .title { font-weight: 600; color: var(--text-2); }
  .scheme { display: inline-flex; gap: 1px; }
  .scheme b { display: grid; place-items: center; width: 14px; height: 14px; border-radius: 4px; font: 800 9px/1 var(--display); color: hsl(var(--h) 70% 70%); background: hsl(var(--h) 70% 62% / 0.18); }
  /* A line that breaks the scheme: a thin amber mark at its left, and one quiet line of
     text under it. The fixes are plain words, not buttons. */
  .row.flagged .text { box-shadow: -10px 0 0 -8px hsl(38 90% 60% / 0.7); }
  .finding {
    display: flex; align-items: baseline; gap: var(--s2) var(--s3); flex-wrap: wrap; margin: -0.2em 0 0.6em;
    color: var(--text-3); font-size: var(--t-xs); line-height: 1.5;
  }
  .finding:not(.meter) .says { color: hsl(38 70% 66% / 0.85); }
  .try { display: inline-flex; flex-wrap: wrap; align-items: baseline; gap: 2px var(--s1); color: var(--text-3); }
  .alt { color: var(--text-2); font-weight: 600; padding: 0 2px; border-radius: 4px; }
  .alt:hover { color: var(--accent-text); background: var(--hover); }
  .sep { color: var(--text-3); opacity: 0.6; }

  /* Under the editor: the same lines and the same wrapping, the letters invisible, so only
     the marks and tints show through the textarea above. */
  .marks .text { color: transparent; }
  /* Under the text field: the text is drawn here (the field's own letters are invisible),
     after a gutter of fixed width on the LEFT that the field leaves room for, like an
     editor's line numbers: a line's syllables, letter and warning sit right against it
     however long or short the line is. */
  .edit .row { position: relative; gap: 0; flex-direction: row-reverse; justify-content: flex-end; }
  .edit .text { width: calc(100% - var(--gw, 96px)); flex: none; }
  .gutter.fixed { width: var(--gw, 96px); justify-content: flex-end; padding-right: var(--s3); gap: var(--s2); pointer-events: auto; opacity: 0.55; }
  .edit .row:hover .gutter.fixed, .gutter.fixed:focus-within { opacity: 1; }
  /* The warning is the app's own warning icon, in amber; a meter note is the same icon, quieter. */
  .flag { width: 22px; height: 22px; display: grid; place-items: center; border-radius: 6px; color: hsl(38 90% 62%); }
  .flag:hover, .flag[aria-expanded="true"] { background: var(--hover); }
  .flag.meter { color: var(--text-3); }
  .pop {
    position: absolute; left: var(--gw, 96px); top: 100%; z-index: 5; width: min(420px, 92%); pointer-events: auto;
    display: flex; flex-direction: column; gap: var(--s2); padding: var(--s3) var(--s4); border-radius: var(--r-md);
    font-size: var(--t-xs); line-height: 1.5; background: rgb(20 21 25 / 0.96); color: var(--text-2);
  }
  .pop .says { color: hsl(38 70% 70%); }
  /* Asides: (background vocals) quieter and slanted; <notes>, {instructions} and [tags]
     quieter still. */
  .text [data-aside] { opacity: 0.5; }
  .text [data-aside="paren"] { opacity: 0.6; }
  /* "//" at the end: leave this line alone. Dimmer than any aside. */
  .text [data-aside="quiet"] { opacity: 0.25; }
  .marks .text [data-aside] { opacity: 1; }
  .gutter.held { opacity: 1; }
  .marks .tail { background: hsl(var(--h) 70% 55% / 0.16); }
  /* What the rhyme picker is rhyming with. */
  .text .target { background: var(--accent-soft); box-shadow: 0 0 0 2px var(--accent-soft); border-radius: 3px; color: var(--text); }
</style>
