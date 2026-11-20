<!-- What a page of notes comes to, drawn as elements from week.ts's tree. No {@html}:
     nothing typed into a note can become markup. -->
<script lang="ts">
  import { markdown, type Inline } from "./week";

  let { source }: { source: string } = $props();
  const blocks = $derived(markdown(source));
</script>

{#snippet run(parts: Inline[])}
  {#each parts as p}
    {#if p.t === "link"}<a href={p.href} target="_blank" rel="noopener noreferrer">{p.text}</a>
    {:else if p.t === "code"}<code>{p.text}</code>
    {:else if p.t === "strong"}<strong>{p.text}</strong>
    {:else if p.t === "em"}<em>{p.text}</em>
    {:else if p.t === "both"}<strong><em>{p.text}</em></strong>
    {:else if p.t === "s"}<s>{p.text}</s>
    {:else}{p.text}{/if}
  {/each}
{/snippet}

<div class="md">
  {#each blocks as b}
    {#if b.t === "gap"}<div class="gap"></div>
    {:else if b.t === "hr"}<hr />
    {:else if b.t === "h"}<svelte:element this={"h" + Math.min(6, b.level + 2)} class="h h{b.level}">{@render run(b.inl)}</svelte:element>
    {:else if b.t === "quote"}<blockquote>{#each b.lines as l}<p>{@render run(l)}</p>{/each}</blockquote>
    {:else if b.t === "ul" || b.t === "ol"}<svelte:element this={b.t}>{#each b.items as l}<li>{@render run(l)}</li>{/each}</svelte:element>
    {:else if b.t === "line"}<div class="line">{@render run(b.inl)}</div>{/if}
  {/each}
</div>

<style>
  .md { font-size: var(--t-sm); line-height: 1.6; color: var(--text-2); overflow-wrap: anywhere; }
  .gap { height: 0.7em; }
  .h { font-family: var(--font); color: var(--text); font-weight: 600; margin: 0.5em 0 0.2em; line-height: 1.25; }
  .h1 { font-size: var(--t-lg); }
  .h2 { font-size: var(--t-md); }
  .h3, .h4, .h5, .h6 { font-size: var(--t-sm); }
  .md > :first-child { margin-top: 0; }
  hr { border: 0; border-top: 1px solid var(--line-2); margin: var(--s2) 0; }
  blockquote { margin: var(--s1) 0; padding-left: var(--s3); border-left: 2px solid var(--line-2); color: var(--text-3); }
  ul, ol { margin: var(--s1) 0; padding-left: 1.4em; }
  code { font-family: var(--mono); font-size: 0.92em; padding: 1px 5px; border-radius: 5px; background: var(--hover); color: var(--text); }
  strong { color: var(--text); font-weight: 600; }
  a { color: var(--accent-text); text-decoration: underline; text-underline-offset: 2px; }
</style>
