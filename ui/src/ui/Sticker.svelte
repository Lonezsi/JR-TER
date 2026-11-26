<!-- One sticker on an album's case (lib/stickers.ts says which and where). Drawn in CSS,
     in the case's own scale: sizes are fractions of the lid and text is in cqw, so the same
     sticker works on a 30px sidebar tile and the 220px album page.

     Placed by its middle (x, y, percent of the case), sized by s and tilted by rot.

     "warning" is JR!TER's own label: LISTEN LOUD by default, its three lines editable
     ("top|big word|bottom" in its text). It is deliberately not a copy of any real warning
     label (those are trademarks). The shop stickers follow the look of real price-gun tags,
     barcode labels, sale rounds, tickets and tape. -->
<script lang="ts">
  import type { Sticker } from "$lib/stickers";
  import { warningLines } from "$lib/stickers";
  // `live`: in the sticker editor, where it can be picked, dragged and focused. Anything
  // else passed (key and focus handlers) goes onto the sticker itself.
  let { s, live = false, selected = false, index = 0, label = "", ...rest }:
    { s: Sticker; live?: boolean; selected?: boolean; index?: number; label?: string; [k: string]: unknown } = $props();
  const lines = $derived(warningLines(s.text));
</script>

{#if live}
  <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
  <span class="stk {s.kind} live" class:selected data-i={index} tabindex="0" role="button" aria-pressed={selected}
    aria-label="{label}. Arrows move it, plus and minus size it, brackets turn it, Delete peels it off."
    style:left="{s.x}%" style:top="{s.y}%" style:--rot="{s.rot}deg" style:--sc={s.s} {...rest}>{@render body()}</span>
{:else}
  <span class="stk {s.kind}" style:left="{s.x}%" style:top="{s.y}%" style:--rot="{s.rot}deg" style:--sc={s.s} aria-hidden="true">{@render body()}</span>
{/if}

{#snippet body()}
  {#if s.kind === "warning"}
    <span class="w1">{lines[0]}</span><span class="w2">{lines[1]}</span><span class="w3">{lines[2]}</span>
  {:else if s.kind === "price"}
    <span class="mono">{s.text || "$19.95"}</span>
  {:else if s.kind === "barcode"}
    <span class="bars"></span><span class="dept">dept. 1023</span><span class="red">{s.text || "56¢"}</span>
  {:else if s.kind === "sale"}
    <b>SALE</b><span class="big">{s.text || "$3.99"}</span>
  {:else if s.kind === "ticket"}
    <span class="small">VALUE</span><b>{s.text || "$13.99"}</b>
  {:else if s.kind === "year"}
    <span class="ht">HT.</span><span class="yr">{s.text || "1991"}</span>
  {:else if s.kind === "discount"}
    <span class="small">ORIGINAL PRICE</span><b>DISCOUNTED</b>
  {:else if s.kind === "tape"}
    <span></span>
  {/if}
{/snippet}

<style>
  .stk {
    position: absolute; z-index: 2; pointer-events: none; display: flex; flex-direction: column;
    align-items: center; justify-content: center; text-align: center; line-height: 1;
    transform: translate(-50%, -50%) rotate(var(--rot)) scale(var(--sc, 1)); font-family: var(--font); color: #1c1410;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.35); white-space: nowrap;
  }

  .live { pointer-events: auto; cursor: grab; touch-action: none; }
  .live:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }

  /* JR!TER's own warning label, in the stacked black-and-white style of the labels on real
     records: a black box, a word on top, a white band with the big word, a line under it.
     Its own words and lettering, so it is a nod to that look, not a copy of the trademark. */
  .warning { display: grid; grid-template-rows: 5.2cqw auto 5.2cqw; width: 30%; padding: 0 0.9cqw; background: #000; color: #fff;
             border-radius: 0; box-shadow: 0 1px 2px rgb(0 0 0 / 0.5); }
  .warning > span { display: grid; place-items: center; overflow: hidden; }
  .warning .w1 { font: 800 3.4cqw/1 var(--font); letter-spacing: 0.08em; }
  .warning .w2 { background: #fff; color: #000; padding: 0.9cqw 0.6cqw 0.7cqw; font: 900 7.6cqw/0.9 var(--font); letter-spacing: 0.04em; }
  .warning .w3 { font: 800 2.2cqw/1 var(--font); letter-spacing: 0.06em; }

  /* Price-gun label: orange, scalloped ends. */
  .price { width: 34%; height: 12%; background: #ff9b21; border-radius: 2px;
    -webkit-mask: radial-gradient(circle at 0 50%, transparent 32%, #000 33%) left / 51% 100% no-repeat, radial-gradient(circle at 100% 50%, transparent 32%, #000 33%) right / 51% 100% no-repeat;
    mask: radial-gradient(circle at 0 50%, transparent 32%, #000 33%) left / 51% 100% no-repeat, radial-gradient(circle at 100% 50%, transparent 32%, #000 33%) right / 51% 100% no-repeat; }
  .mono { font: 700 5cqw/1 var(--mono); }

  /* Barcode label: cream, bars, a department and a red price. */
  .barcode { width: 28%; height: 24%; background: #eee5d2; border-radius: 1px; gap: 0.6cqw; padding: 1cqw; }
  .bars { width: 90%; height: 34%; background: repeating-linear-gradient(90deg, #1c1410 0 1px, transparent 1px 2px, #1c1410 2px 4px, transparent 4px 5px, #1c1410 5px 6px, transparent 6px 8px); }
  .dept { font: 600 2.2cqw/1 var(--font); }
  .red { font: 600 5.4cqw/1 var(--font); color: #d03a2f; }

  /* Sale: a cream round. */
  .sale { width: 26%; aspect-ratio: 1; border-radius: 50%; background: #efe6d4; gap: 0.6cqw; }
  .sale b { font: 900 4.6cqw/1 var(--font); }
  .sale .big { font: 900 5.6cqw/1 var(--font); }

  /* Ticket: red, notched on both sides. */
  .ticket { width: 30%; height: 13%; background: #d8443a; color: #fff; gap: 0.4cqw;
    -webkit-mask: radial-gradient(circle at 0 50%, transparent 18%, #000 19%) left / 51% 100% no-repeat, radial-gradient(circle at 100% 50%, transparent 18%, #000 19%) right / 51% 100% no-repeat;
    mask: radial-gradient(circle at 0 50%, transparent 18%, #000 19%) left / 51% 100% no-repeat, radial-gradient(circle at 100% 50%, transparent 18%, #000 19%) right / 51% 100% no-repeat; }
  .ticket b { font: 900 5cqw/1 var(--font); }
  .small { font: 700 2.3cqw/1 var(--font); letter-spacing: 0.03em; }

  /* Year: the yellow price-gun label with its "HT." and a big number. */
  .year { flex-direction: row; gap: 1cqw; width: 34%; height: 13%; background: #e7c33a; border-radius: 1px; }
  .year .ht { font: 600 2.6cqw/1 var(--mono); color: #6b4b00; }
  .year .yr { font: 500 5.6cqw/1 var(--mono); color: #7a3b00; letter-spacing: 0.06em; }

  /* Discounted: the yellow-green square. */
  .discount { width: 30%; height: 22%; background: #d4da3a; gap: 1cqw; }
  .discount b { font: 900 3.8cqw/1 var(--font); }

  /* Tape: a torn strip, a little see-through. */
  .tape { width: 40%; height: 9%; background: rgb(200 52 40 / 0.85); box-shadow: none;
    clip-path: polygon(0 8%, 6% 0, 12% 10%, 20% 2%, 30% 8%, 42% 0, 55% 9%, 66% 1%, 78% 9%, 88% 0, 100% 6%, 98% 50%, 100% 94%, 90% 100%, 80% 91%, 68% 100%, 56% 92%, 44% 100%, 32% 92%, 20% 100%, 10% 93%, 0 100%, 2% 50%); }
</style>
