<!-- Lyrics as Markdown, drawn as elements. Nothing a person typed ever becomes markup: the
     source is split into blocks and spans (helpers.ts) and drawn by this template, so there
     is no {@html} anywhere. Every block carries its source line (data-l) so a click can put
     the cursor where it landed. -->
<script lang="ts">
  import { mdBlocks, type Span } from "./helpers";
  import { asides } from "$lib/lyrics/rhyme";
  /* Plain text cut at its asides ((background vocals), <notes>…), which are drawn dimmer. */
  function cut(t: string): { t: string; kind?: string }[] {
    const out: { t: string; kind?: string }[] = [];
    let i = 0;
    for (const a of asides(t)) {
      if (a.from > i) out.push({ t: t.slice(i, a.from) });
      out.push({ t: t.slice(a.from, a.to), kind: a.kind });
      i = a.to;
    }
    if (i < t.length) out.push({ t: t.slice(i) });
    return out;
  }
  let { source = "" }: { source?: string } = $props();
  const blocks = $derived(mdBlocks(source));
</script>

{#snippet spans(list: Span[])}
  {#each list as sp, i (i)}
    {#if sp.href}<a href={sp.href} target="_blank" rel="noopener noreferrer">{sp.text}</a>
    {:else if sp.code}<code>{sp.text}</code>
    {:else if sp.b && sp.i}<strong><em>{sp.text}</em></strong>
    {:else if sp.b}<strong>{sp.text}</strong>
    {:else if sp.i}<em>{sp.text}</em>
    {:else if sp.s}<s>{sp.text}</s>
    {:else}{#each cut(sp.text) as c, j (j)}{#if c.kind}<span class="aside" data-aside={c.kind}>{c.t}</span>{:else}{c.t}{/if}{/each}{/if}
  {/each}
{/snippet}

<div class="md">
  {#each blocks as b (b.line)}
    {#if b.kind === "gap"}<div class="gap" data-l={b.line}></div>
    {:else if b.kind === "hr"}<hr data-l={b.line} />
    {:else if b.kind === "h"}
      {#if b.level <= 2}<h3 data-l={b.line}>{@render spans(b.spans)}</h3>
      {:else}<h4 data-l={b.line}>{@render spans(b.spans)}</h4>{/if}
    {:else if b.kind === "quote"}<blockquote data-l={b.line}>{@render spans(b.spans)}</blockquote>
    {:else if b.kind === "ul"}<div class="li" data-l={b.line}><span class="mark" aria-hidden="true">•</span><span>{@render spans(b.spans)}</span></div>
    {:else if b.kind === "ol"}<div class="li num" data-l={b.line}><span>{@render spans(b.spans)}</span></div>
    {:else}<div class="line" data-l={b.line}>{@render spans(b.spans)}</div>{/if}
  {/each}
</div>

<style>
  .md { font-size: var(--t-lg); line-height: 1.6; overflow-wrap: anywhere; }
  .gap { height: 0.9em; }
  .line { min-height: 1em; }
  h3, h4 { margin: 0.4em 0 0.1em; }
  h4 { font-size: var(--t-md); }
  blockquote { margin: 0; padding-left: var(--s3); border-left: 2px solid var(--accent-line); color: var(--text-2); }
  .li { display: flex; gap: var(--s3); padding-left: var(--s3); }
  .mark { color: var(--accent-text); }
  hr { border: 0; border-top: 1px solid var(--line-2); margin: 0.8em 0; }
  code { font-family: var(--mono); font-size: 0.9em; padding: 1px var(--s1); border-radius: 5px; background: var(--hover); }
  a { color: var(--accent-text); text-decoration: underline; }
  .aside { opacity: 0.5; }
  .aside[data-aside="paren"] { opacity: 0.6; }
</style>
