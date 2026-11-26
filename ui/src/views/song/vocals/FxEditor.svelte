<!-- The vocal edit of one take: a chain of effects, top to bottom, each a card of knobs.
     Everything saves as it changes (VocalEdit debounces it) and nothing renders until the
     knobs are left alone for a moment, so the status line says when. Whoever is not allowed
     to change the take sees the same cards with everything locked. -->
<script lang="ts">
  import { tick, untrack } from "svelte";
  import Dropdown from "$ui/Dropdown.svelte";
  import Icon from "$ui/Icon.svelte";
  import Switch from "$ui/Switch.svelte";
  import Knob from "./Knob.svelte";
  import { VocalEdit, vocalFx, makeEffect, FX_SAY, type FxEffect, type FxType, type VocalTake } from "$lib/audio/vocals.svelte";
  import { contextMenu, showMenu, type MenuItem } from "$lib/menu.svelte";
  import { toast } from "$lib/toast.svelte";

  let { take }: { take: VocalTake } = $props();

  const MAX = 16;                           // the server keeps at most sixteen effects
  const KINDS = vocalFx.KINDS;
  const types = Object.keys(KINDS) as FxType[];

  let edit = $state<VocalEdit | null>(null);
  // A new object for the same take (the list was fetched again): keep the edit on that one.
  // What was typed in the meantime is saved first.
  $effect(() => {
    const mine = take;
    const made = untrack(() => new VocalEdit(mine));
    edit = made;
    return () => made.flush();
  });

  let cards: (HTMLElement | undefined)[] = $state([]);
  let grips: (HTMLElement | undefined)[] = $state([]);
  let drag = $state<{ from: number; to: number } | null>(null);
  let said = $state("");

  const chain = $derived(edit ? edit.chain : []);
  const may = $derived(edit?.mayChange ?? false);
  const say = $derived(edit ? FX_SAY[edit.status] : "");

  const label = (fx: FxEffect) => KINDS[fx.type]?.label ?? fx.type;

  function add(type: FxType) {
    if (!edit) return;
    if (edit.chain.length >= MAX) { toast("That is as many effects as one take can hold."); return; }
    edit.add(type);
  }

  function move(from: number, to: number) {
    if (!edit || to < 0 || to >= edit.chain.length || from === to) return;
    const name = label(edit.chain[from]);
    edit.move(from, to);
    said = `${name} is now number ${to + 1} of ${edit.chain.length}`;
  }

  async function moveBy(i: number, by: number) {
    move(i, i + by);
    await tick();
    grips[i + by]?.focus();
  }

  /** Take an effect out at once, and offer it back in the same place with the same values. */
  function remove(i: number) {
    if (!edit) return;
    const gone = { ...edit.chain[i] };
    const e = edit;
    e.remove(i);
    toast(`${KINDS[gone.type]?.label ?? "Effect"} removed`, "", {
      label: "Undo",
      run: () => {
        if (e.chain.length >= MAX) return;
        e.add(gone.type);
        const last = e.chain.length - 1;
        for (const [k, v] of Object.entries(gone)) if (k !== "type" && k !== "on") e.set(last, k, v as string | number);
        if (!gone.on) e.toggle(last);
        e.move(last, i);
      },
    });
  }

  function defaults(i: number) {
    if (!edit) return;
    const fresh = makeEffect(edit.chain[i].type);
    for (const [k, v] of Object.entries(fresh)) if (k !== "type" && k !== "on") edit.set(i, k, v as string | number);
  }

  const items = (i: number): MenuItem[] => !edit ? [] : [
    { label: "Earlier", icon: "arrow-up", hint: "Alt+Up", disabled: i === 0, run: () => move(i, i - 1) },
    { label: "Later", icon: "arrow-down", hint: "Alt+Down", disabled: i >= edit.chain.length - 1, run: () => move(i, i + 1) },
    { label: "Back to the defaults", icon: "undo", run: () => defaults(i) },
    { divider: true },
    { label: "Remove", icon: "trash", danger: true, run: () => remove(i) },
  ];

  // ── dragging a card by its grip (pointer events, so a finger can do it too) ──
  function gripDown(e: PointerEvent, i: number) {
    if (!may || e.button > 0) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag = { from: i, to: i };
  }
  function gripMove(e: PointerEvent) {
    if (!drag) return;
    let to = 0;
    cards.forEach((c, k) => {
      if (!c || k === drag!.from || k >= chain.length) return;
      const r = c.getBoundingClientRect();
      if (e.clientY > r.top + r.height / 2) to++;
    });
    if (to !== drag.to) drag.to = to;
  }
  function gripUp(e: PointerEvent) {
    const el = e.currentTarget as HTMLElement;
    if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
    const d = drag;
    drag = null;
    if (d && e.type === "pointerup") move(d.from, d.to);
  }
  function gripKey(e: KeyboardEvent, i: number) {
    if (!may || !e.altKey) return;
    if (e.key === "ArrowUp") { e.preventDefault(); void moveBy(i, -1); }
    else if (e.key === "ArrowDown") { e.preventDefault(); void moveBy(i, 1); }
  }
</script>

{#if edit}
  <div class="fx">
    <div class="top">
      <Switch checked={take.fx !== 0} label="Use the vocal edit" disabled={!may}
              onchange={(on) => edit?.setEditOn(on)} />
      <span class="what"><b>Edit on</b>
        <span class="faint">{may ? "Effects run top to bottom." : "Only whoever recorded this take can change its edit."}</span></span>
      <span class="state faint" aria-live="polite">{say}</span>
    </div>

    {#if chain.length}
      <div class="chain">
        {#each chain as fx, i (i)}
          {@const kind = KINDS[fx.type]}
          {#if kind}
            <div class="fxcard card" class:off={!fx.on} class:dragging={drag?.from === i}
                 class:before={drag && drag.to !== drag.from && drag.to === i && drag.to < drag.from}
                 class:after={drag && drag.to !== drag.from && drag.to === i && drag.to > drag.from}
                 bind:this={cards[i]} use:contextMenu={() => items(i)}>
              <div class="head">
                {#if may}
                  <button class="grip icon-btn sm" bind:this={grips[i]} type="button"
                          aria-label="Move {kind.label}. Drag, or hold Alt and press the up or down arrow."
                          title="Drag to move, or Alt+Up and Alt+Down"
                          onpointerdown={(e) => gripDown(e, i)} onpointermove={gripMove}
                          onpointerup={gripUp} onpointercancel={gripUp}
                          onkeydown={(e) => gripKey(e, i)}>
                    <Icon name="drag" size={16} />
                  </button>
                {/if}
                <b class="grow truncate">{kind.label}</b>
                <Switch checked={fx.on} label="Use {kind.label}" disabled={!may} onchange={() => edit?.toggle(i)} />
                {#if may}
                  <button class="icon-btn sm" type="button" aria-label="More for {kind.label}"
                          onclick={(e) => showMenu(items(i), { anchor: e.currentTarget })}>
                    <Icon name="more" size={18} />
                  </button>
                {/if}
              </div>

              <div class="body">
                {#each kind.picks || [] as [key, name, options] (key)}
                  <label class="pick">
                    <span>{name}</span>
                    <Dropdown size="sm" disabled={!may} label={name} value={String(fx[key])}
                              options={options.map(([v, text]) => ({ value: String(v), label: text }))}
                              onchange={(v) => edit?.set(i, key, v)} />
                  </label>
                {/each}
                <div class="knobs">
                  {#each kind.knobs as [key, name, min, max, step, unit] (key)}
                    <Knob value={Number(fx[key])} {min} {max} {step} {unit} label={name}
                          reset={Number(makeEffect(fx.type)[key])} disabled={!may}
                          onchange={(v) => edit?.set(i, key, v)} />
                  {/each}
                </div>
              </div>
            </div>
          {/if}
        {/each}
      </div>
    {:else}
      <p class="faint empty-fx">No effects yet.{may ? " Add one below; they run top to bottom." : ""}</p>
    {/if}

    {#if may}
      <div class="add">
        {#each types as type (type)}
          <button class="btn sm ghost" type="button" disabled={chain.length >= MAX} onclick={() => add(type)}>
            <Icon name="plus" size={14} /> {KINDS[type].label}
          </button>
        {/each}
      </div>
    {/if}
    <div class="sr-only" aria-live="polite">{said}</div>
  </div>
{/if}

<style>
  .fx { display: flex; flex-direction: column; gap: var(--s3); padding: var(--s3) 0 var(--s2); }
  .top { display: flex; align-items: center; gap: var(--s3); flex-wrap: wrap; }
  .what { display: flex; flex-direction: column; min-width: 0; flex: 1 1 160px; line-height: 1.3; }
  .what .faint { font-size: var(--t-sm); }
  .state { font-size: var(--t-sm); white-space: nowrap; }
  .chain { display: flex; flex-direction: column; gap: var(--s2); }
  .fxcard { padding: var(--s3); position: relative; transition: opacity var(--fast), border-color var(--fast); }
  .fxcard.off .body { opacity: 0.45; }
  .fxcard.dragging { opacity: 0.55; border-color: var(--accent-line); }
  .fxcard.before::before, .fxcard.after::after {
    content: ""; position: absolute; left: 8px; right: 8px; height: 3px; border-radius: 3px; background: var(--accent);
  }
  .fxcard.before::before { top: -5px; }
  .fxcard.after::after { bottom: -5px; }
  .head { display: flex; align-items: center; gap: var(--s2); }
  .grip { cursor: grab; touch-action: none; color: var(--text-3); }
  .grip:active { cursor: grabbing; }
  .body { display: flex; flex-direction: column; gap: var(--s3); margin-top: var(--s3); }
  .knobs { display: grid; grid-template-columns: repeat(auto-fill, minmax(88px, 1fr)); gap: var(--s3) var(--s2); }
  .pick { display: flex; flex-direction: column; gap: var(--s1); font-size: var(--t-sm); color: var(--text-2); max-width: 340px; }
  .empty-fx { font-size: var(--t-sm); margin: 0; }
  .add { display: flex; flex-wrap: wrap; gap: var(--s2); }
</style>
