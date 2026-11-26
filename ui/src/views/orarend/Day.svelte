<!-- One day column. Everything in it is placed from the hours a class says: --at and --for
     are hours from the top of the grid, and --hour (how tall an hour is) is written once
     on the grid, so there is one number to change and nothing to keep in step with it. -->
<script lang="ts">
  import { contextMenu, type MenuItem } from "$lib/menu.svelte";
  import { KIND_TAG, whoColour, type DayPlan, type Entry } from "./week";

  let { plan, name, rows, people, now = null, onopen, menu }: {
    plan: DayPlan; name: string; rows: number; people: string[]; now?: number | null;
    onopen: (entry: Entry) => void; menu: (entry: Entry) => MenuItem[];
  } = $props();

  const style = (p: { at: number; runs: number }) => `--at:${p.at};--for:${p.runs}`;
  const where = (e: Entry) =>
    [e.where, e.teacher, e.group ? "#" + e.group : ""].filter(Boolean).join(" · ");
</script>

<div class="day" role="group" aria-label={name} style:height="calc({rows} * var(--hour))" style="--lanes:{plan.lanes}">
  {#each plan.bands as p (p.entry.key)}
    <button class="band" class:pending={p.entry.pending} type="button" data-key={p.entry.key} style={style(p)}
            aria-label="{p.entry.name}, {p.entry.at}–{p.entry.to}"
            onclick={() => onopen(p.entry)} use:contextMenu={() => menu(p.entry)}>
      <span class="said">{p.entry.name}</span>
    </button>
  {/each}

  {#each plan.cards as p (p.entry.key)}
    {#if p.entry.skip}
      <!-- A strip, so the hour does not read as free, with nothing in it to read. Words
           here would say "you have this", which is the opposite of what it means. -->
      <button class="card skip" class:pending={p.entry.pending} type="button" data-key={p.entry.key} style={style(p)}
              aria-label="{p.entry.name}, nem látogatott"
              onclick={() => onopen(p.entry)} use:contextMenu={() => menu(p.entry)}></button>
    {:else}
      <button class="card k-{p.entry.kind}" class:inset={p.inset} class:pending={p.entry.pending} type="button"
              data-key={p.entry.key} style={style(p)}
              onclick={() => onopen(p.entry)} use:contextMenu={() => menu(p.entry)}>
        <span class="when num">{p.entry.at}–{p.entry.to}{#if KIND_TAG[p.entry.kind]}<i class="tag">{KIND_TAG[p.entry.kind]}</i>{/if}</span>
        <span class="nm">{p.entry.name}</span>
        {#if where(p.entry)}<span class="wh">{where(p.entry)}</span>{/if}
      </button>
    {/if}
  {/each}

  {#each plan.stripes as p (p.entry.key)}
    <button class="stripe" class:pending={p.entry.pending} type="button" data-key={p.entry.key}
            style="{style(p)};--lane:{p.lane};--who:{whoColour(people, p.entry.whose)}"
            aria-label="{p.entry.whose}: {p.entry.name}, {p.entry.at}–{p.entry.to}"
            onclick={() => onopen(p.entry)} use:contextMenu={() => menu(p.entry)}></button>
  {/each}

  {#if now !== null && now >= 0 && now <= rows}
    <div class="now" style="--at:{now}" aria-hidden="true"></div>
  {/if}
</div>

<style>
  .day {
    position: relative;
    --stripe-w: calc(5.4px * var(--u));
    --lane-step: calc(8.2px * var(--u));
    --skip-w: calc(22px * var(--u));
    /* The hour lines, as one paint rather than fifteen elements. */
    background: repeating-linear-gradient(to bottom, transparent 0, transparent calc(var(--hour) - 1px),
      var(--line) calc(var(--hour) - 1px), var(--line) var(--hour));
  }
  .card, .stripe, .band, .now { top: calc(var(--at, 0) * var(--hour)); }
  .card, .stripe, .band { height: calc(var(--for, 0) * var(--hour)); }

  .card {
    position: absolute; z-index: 1;
    left: var(--s1);
    /* Room down the right for exactly as many stripes as this day has. */
    right: calc(var(--s1) + var(--lanes, 0) * var(--lane-step));
    display: flex; flex-direction: column; gap: 1px;
    padding: calc(4.6px * var(--u)) calc(6px * var(--u));
    text-align: left; overflow: hidden; cursor: pointer;
    border-radius: var(--r-sm); border: 1px solid var(--line-2);
    background: #121214; color: var(--text); font: inherit;
    user-select: none; -webkit-user-select: none;
    transition: background var(--fast), border-color var(--fast), transform var(--fast), opacity var(--fast);
  }
  .card:hover, .card:focus-visible { background: #1a1a1d; border-color: var(--text-3); transform: translateY(-1px); z-index: 3; }
  .card:active { transform: scale(0.985); }
  /* A lecture is the quieter of the two, because it is the one you sit through; a
     practical has a lit edge. The kind is also written on the card ("Ea", "Gy"), because
     a word is legible where two similar hues are not. */
  .k-ea { background: var(--glass-2); }
  .k-gy { box-shadow: var(--edge-top); }
  .k-both { box-shadow: var(--edge-top); border-color: var(--text-3); }
  .k-konz { border-style: dotted; }
  .inset { left: calc(var(--skip-w) + var(--s2)); }
  .pending { opacity: 0.55; }

  .when { display: flex; align-items: center; gap: 4px; font-size: calc(7.7px * var(--u)); white-space: nowrap; color: var(--text-3); }
  .tag {
    font-style: normal; font-size: calc(7.6px * var(--u)); font-weight: 600; letter-spacing: 0.04em;
    padding: 1px 4px; border-radius: var(--r-pill); border: 1px solid var(--line-2); color: var(--text-2);
  }
  /* Cut rather than wrapped past a couple of lines: "this one, and tap for the rest". */
  .nm {
    font-size: calc(9.3px * var(--u)); font-weight: 600; line-height: 1.2;
    display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; line-clamp: 2; overflow: hidden;
  }
  .wh { font-size: calc(7.3px * var(--u)); color: var(--text-3); line-height: 1.25; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

  /* The one that is not attended: collapsed rather than hidden, because an empty hour and
     an hour you are choosing not to spend are different facts. */
  .skip { right: auto; width: var(--skip-w); padding: 0; background: transparent; border: 1px dashed var(--line-2); opacity: 0.7; }
  .skip:hover, .skip:focus-visible { opacity: 1; transform: none; background: var(--hover); }

  /* Somebody else's class: a stripe down the side, one lane per clashing class. */
  .stripe {
    position: absolute; z-index: 1;
    right: calc(var(--s1) + var(--lane, 0) * var(--lane-step)); width: var(--stripe-w);
    padding: 0; border-radius: var(--r-pill); background: var(--who); cursor: pointer;
    transition: transform var(--fast), filter var(--fast), opacity var(--fast);
  }
  /* A pointer can hit five pixels with difficulty; the target is wider than the paint. */
  .stripe::after { content: ""; position: absolute; inset: 0 -4px; }
  .stripe:hover, .stripe:focus-visible { transform: scaleX(1.6); filter: brightness(1.15); z-index: 4; }

  /* Work, and anything else that takes a piece of the day without being a class. Behind
     everything and the width of the day: it is not competing with the cards for the
     column, it is the reason the column is not free. Tinted and unlit. */
  .band {
    position: absolute; left: 0; right: 0; z-index: 0; padding: 0; border-radius: var(--r-sm);
    background-color: #121214; color: var(--text-3); cursor: pointer; font: inherit; overflow: hidden;
    background-image: repeating-linear-gradient(-45deg, transparent 0 4px, var(--line) 4px 5px);
    box-shadow: inset 2px 0 0 var(--line-2);
  }
  .band:hover, .band:focus-visible { color: var(--text-2); }
  /* Written along the edge, out of the way of the cards that sit on top. */
  .said {
    position: absolute; top: 6px; left: 1px; transform-origin: left top;
    transform: rotate(90deg) translateY(-100%); white-space: nowrap;
    font-size: calc(7.3px * var(--u)); letter-spacing: 0.06em;
  }

  .now { position: absolute; left: 0; right: 0; height: 0; z-index: 2; border-top: 1.5px solid var(--accent); pointer-events: none; }
  .now::before { content: ""; position: absolute; left: -3px; top: -4.5px; width: 7px; height: 7px; border-radius: 50%; background: var(--accent); }

  @media (pointer: coarse) { .stripe::after { inset: 0 -8px; } }
</style>
