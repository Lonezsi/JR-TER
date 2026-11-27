<!-- Sound: what a song goes through while you listen. Never written into the file.

     Three things, top to bottom. The slots: A and B, which take each one holds and which
     preset it plays through. The preset: a named chain of effects, picked from one menu that
     also renames, copies, bypasses and deletes. The chain: every effect in order, the
     equaliser and the limiter included (they are effects like any other now), with the one
     you pick opened underneath. Each effect has presets of its own: a few built in, plus any
     you save, which follow you to every song. -->
<script lang="ts">
  import { onDestroy } from "svelte";
  import { deleteSoon } from "$lib/later.svelte";
  import Icon from "$ui/Icon.svelte";
  import Switch from "$ui/Switch.svelte";
  import Slider from "$ui/Slider.svelte";
  import { on as onEvent } from "$lib/bus";
  import { useCommands } from "$lib/commands";
  import { contextMenu, showMenu, type MenuItem } from "$lib/menu.svelte";
  import { prompt, confirm } from "$lib/dialog.svelte";
  import { toast } from "$lib/toast.svelte";
  import { engine, SLOTS, type Slot } from "$lib/audio/engine";
  import { RANGES, DEFAULT_RANGE } from "$lib/audio/eq";
  import { ADDABLE, UNITS, rackOf, summary, valueOf } from "$lib/audio/rack";
  import { presetsFor, valuesOf, matching, saveMine, deleteMine } from "$lib/audio/fxpresets";
  import { store } from "$lib/util";
  import type { Preset, RackUnit, LimiterSettings } from "$lib/types";
  import { useSong } from "./song.svelte";
  import { MAX_BANDS, SoundEditor, bandOfType } from "./sound/editor.svelte";
  import EqCanvas from "./sound/EqCanvas.svelte";
  import LimiterCanvas from "./sound/LimiterCanvas.svelte";
  import BandCard from "./sound/BandCard.svelte";

  const song = useSong();
  const editor = new SoundEditor(song);
  onDestroy(() => editor.destroy());

  const FOCUS_KEY = "jriter.sound.focus";
  const RANGE_KEY = "jriter.sound.range";
  // Which effect is open underneath the chain, kept per browser.
  let focus = $state<string>(store.get<string>(FOCUS_KEY, "") || "");
  const keptRange = store.get<number>(RANGE_KEY, DEFAULT_RANGE);
  let range = $state(RANGES.includes(keptRange) ? keptRange : DEFAULT_RANGE);
  let selected = $state<string | number | null>(null);
  const pick = (which: string) => { focus = which; store.set(FOCUS_KEY, which); };
  const setRange = (r: number) => { range = r; store.set(RANGE_KEY, r); };

  const slot = $derived(editor.slot);
  const preset = $derived(editor.preset);
  const data = $derived(preset?.data ?? null);
  const bands = $derived(data?.bands ?? []);
  const rack = $derived(rackOf(data));
  const shown = $derived(rack.some((u) => u.id === focus) ? focus : (rack[0]?.id ?? ""));
  const unit = $derived(rack.find((u) => u.id === shown) ?? null);
  const unitIndex = $derived(rack.findIndex((u) => u.id === shown));
  const live = $derived(song.playing && !!song.versionOf(slot));

  $effect(() => { if (selected !== null && !bands.some((b) => b.id === selected)) selected = null; });

  // A limiter's live reading, while it can be heard.
  let reduction = $state(0);
  $effect(() => {
    if (!live) { reduction = 0; return; }
    const timer = setInterval(() => {
      const now = Math.round(engine.reductionOf(slot) * 10) / 10;
      if (now !== reduction) reduction = now;
    }, 140);
    return () => clearInterval(timer);
  });

  $effect(() => onEvent("sound:changed", (detail) => {
    if (editor.quiet || editor.busy) return;
    if (detail?.songId !== undefined && String(detail.songId) !== song.id) return;
    void song.refresh("presets");
  }));

  // ── the chain ─────────────────────────────────────────────────────────────
  let dragId = $state<string | null>(null);
  let dropAt = $state<number | null>(null);
  function dragStart(e: DragEvent, id: string) {
    dragId = id;
    e.dataTransfer?.setData("text/plain", id);
    if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
  }
  function dragOver(e: DragEvent, i: number) {
    if (!dragId) return;
    e.preventDefault();
    const box = (e.currentTarget as HTMLElement).getBoundingClientRect();
    dropAt = e.clientX < box.left + box.width / 2 ? i : i + 1;
  }
  function drop(e: DragEvent) {
    e.preventDefault();
    if (dragId !== null && dropAt !== null) editor.moveUnitTo(dragId, dropAt);
    dragId = null; dropAt = null;
  }
  function addEffect(e: MouseEvent) {
    showMenu([
      { group: "Add an effect" },
      ...ADDABLE.map((kind) => ({
        label: UNITS[kind].name, sub: UNITS[kind].blurb, icon: "plus",
        disabled: kind === "eq" && rack.some((u) => u.kind === "eq"),
        run: () => { const id = editor.addUnit(kind); if (id) pick(id); },
      })),
    ], { anchor: e.currentTarget as HTMLElement });
  }
  function unitMenu(u: RackUnit, i: number): MenuItem[] {
    return [
      { group: UNITS[u.kind].name },
      { label: u.on ? "Turn off" : "Turn on", icon: "eq", run: () => editor.toggleUnit(u.id) },
      { label: "Move left", icon: "chev-left", disabled: i === 0, run: () => editor.moveUnit(u.id, -1) },
      { label: "Move right", icon: "chev-right", disabled: i === rack.length - 1, run: () => editor.moveUnit(u.id, 1) },
      { divider: true },
      { label: "Remove", icon: "trash", danger: true, run: () => editor.removeUnit(u.id) },
    ];
  }

  // ── an effect's own presets ───────────────────────────────────────────────
  const fxName = $derived(unit && data ? matching(unit, data) : null);
  function fxMenu(e: MouseEvent) {
    if (!unit || !data) return;
    const u = unit, d = data, name = UNITS[u.kind].name;
    const list = presetsFor(u.kind);
    const mine = list.filter((p) => p.mine);
    showMenu([
      { group: `${name} presets` },
      ...list.map((p) => ({
        label: p.name, checked: fxName === p.name, sub: p.mine ? "saved by you" : undefined,
        run: () => editor.applyToUnit(u.id, p.values, p.name),
      })),
      { divider: true },
      { label: "Save current as a preset…", icon: "plus", run: async () => {
          const named = await prompt({ title: `Name this ${name.toLowerCase()} preset`, placeholder: "Vocal, Room, Tape…", confirm: "Save" });
          if (!named) return;
          await saveMine(u.kind, named.trim(), valuesOf(u, d));
          toast(`Saved “${named.trim()}”. It's in every song now.`);
        } },
      ...(mine.length ? [{ divider: true as const }, ...mine.map((p) => ({
        label: `Delete “${p.name}”`, icon: "trash", danger: true,
        run: async () => {
          deleteSoon(`fx:${u.kind}:${p.name}`, `Deleted “${p.name}” from every song`, () => deleteMine(u.kind, p.name).then(() => true));
        },
      }))] : []),
    ], { anchor: e.currentTarget as HTMLElement });
  }

  // ── the equaliser ─────────────────────────────────────────────────────────
  function add(type: BiquadFilterType) {
    if (bands.length >= MAX_BANDS) { toast(`${MAX_BANDS} bands max.`); return; }
    const made = bandOfType(type);
    selected = made.id;
    editor.edit((d) => { d.bands.push(made); d.bands.sort((a, b) => a.freq - b.freq); }, { wake: "eq" });
  }
  function patchBand(id: string | number, fn: (b: (typeof bands)[number]) => void) {
    editor.edit((d) => { const b = d.bands.find((x) => x.id === id); if (b) fn(b); }, { wake: "eq" });
  }
  function removeBand(id: string | number) {
    if (selected === id) selected = null;
    editor.edit((d) => { d.bands = d.bands.filter((b) => b.id !== id); }, { undo: "Band removed" });
  }
  const ADD: [BiquadFilterType, string][] = [
    ["peaking", "Bell"], ["highpass", "Low cut"], ["lowpass", "High cut"], ["lowshelf", "Low shelf"], ["highshelf", "High shelf"],
  ];

  // ── the preset ────────────────────────────────────────────────────────────
  function presetMenu(e: MouseEvent) {
    if (!preset) return;
    const p = preset;
    showMenu([
      { group: `Slot ${slot} plays through` },
      ...song.presets.map((x) => ({
        label: x.name, checked: x.id === p.id, hint: x.is_current ? "default" : undefined,
        run: () => editor.choose(x),
      })),
      { divider: true },
      { label: "New preset", icon: "plus", run: () => editor.create() },
      { label: "Duplicate", icon: "copy", run: () => editor.copy(p) },
      { label: "Rename", icon: "edit", run: () => editor.rename(p) },
      { label: p.is_current ? "This one opens by default" : "Open with this one by default", icon: "star",
        disabled: !!p.is_current, run: () => editor.makeCurrent(p) },
      { divider: true },
      { label: data?.bypass ? "Turn it back on" : "Bypass everything", icon: "eq", checked: !!data?.bypass, run: () => editor.toggleBypass() },
      { label: "Reset to flat", icon: "refresh", run: () => editor.flatten() },
      { divider: true },
      { label: "Delete preset", icon: "trash", danger: true, disabled: song.presets.length < 2, run: () => editor.remove(p) },
    ], { anchor: e.currentTarget as HTMLElement });
  }
  const presetItems = (p: Preset): MenuItem[] => [
    { group: p.name },
    { label: "Use on slot " + slot, icon: "play", disabled: p.id === preset?.id, run: () => editor.choose(p) },
    { label: "Duplicate", icon: "copy", run: () => editor.copy(p) },
    { label: "Rename", icon: "edit", run: () => editor.rename(p) },
  ];

  const deckTake = (s: Slot) => { const v = song.versionOf(s); return v ? `v${v.n}` : "empty"; };

  /* Which take a slot plays. A and B live here and nowhere else: this is where comparing
     happens. B starts empty; putting a take in it is what turns comparing on. */
  function takeMenu(s: Slot, e: MouseEvent) {
    const holding = song.versionOf(s)?.id;
    const rows = [...song.versions].sort((a, b) => (b.n ?? 0) - (a.n ?? 0));
    showMenu([
      { group: `Slot ${s} plays` },
      ...rows.map((v) => ({
        label: `v${v.n}${v.label ? ` · ${v.label}` : ""}`, checked: holding === v.id,
        sub: v.filename || undefined,
        run: async () => { await song.setVersion(s, v); if (s === "B") await song.select("B"); },
      })),
      ...(s === "B" && holding ? [{ divider: true as const }, { label: "Empty B", icon: "close", run: async () => { await song.select("A"); await song.setVersion("B", null); } }] : []),
    ], { anchor: e.currentTarget as HTMLElement });
  }

  useCommands(() => (preset ? [
    { id: "sound.new", title: "New preset", sub: "Sound", group: "Sound", icon: "plus", run: () => editor.create() },
    { id: "sound.flatten", title: "Reset the preset to flat", sub: "Sound", group: "Sound", icon: "eq", run: () => editor.flatten() },
    { id: "sound.bypass", title: data?.bypass ? "Turn the preset back on" : "Bypass the preset",
      sub: "Sound", group: "Sound", icon: "eq", keywords: "eq bypass rack effects", run: () => editor.toggleBypass() },
    { id: "sound.limiter", title: "Toggle the limiter", sub: "Sound", group: "Sound", icon: "eq", keywords: "limiter", run: () => editor.toggleLimiter() },
    ...ADDABLE.map((kind) => ({ id: `sound.add.${kind}`, title: `Add ${UNITS[kind].name.toLowerCase()}`, sub: "Sound",
      group: "Sound", icon: "plus", keywords: "effect rack", run: () => { const id = editor.addUnit(kind); if (id) pick(id); } })),
  ] : []));

  const saying = $derived(editor.state === "saving" ? "Saving…"
    : editor.state === "saved" ? "Saved" : editor.state === "failed" ? "Didn't save, retrying" : "");
  const fmtKnob = (v: number, step: number, u: string) =>
    `${step < 1 ? v.toFixed(1) : v.toFixed(0)}${u === ":1" || u === "%" ? u : ` ${u}`}`;
  /* LimiterCanvas writes d.limiter's lines; here that "d.limiter" is the effect itself. */
  const limiterEdit = (id: string) => (fn: (d: { limiter: LimiterSettings }) => void) =>
    editor.editUnit(id, (u) => fn({ limiter: u as unknown as LimiterSettings }));
</script>

{#if !song.versions.length}
  <div class="card empty">
    <Icon name="eq" size={28} />
    <h3>No renders yet</h3>
    <p>Add a render first. Sound is only applied while you listen, never written into the file.</p>
  </div>
{:else if !preset || !data}
  <div class="col" aria-busy="true">
    <div class="sk" style="height: 60px"></div>
    <div class="sk" style="height: 320px"></div>
  </div>
{:else}
  <div class="sound">
    <!-- Slots, then the preset the chosen slot plays through. -->
    <div class="top">
      <div class="slots" role="group" aria-label="Slot being shaped">
        {#each SLOTS as s (s)}
          {@const empty = s === "B" && !song.versionOf("B")}
          <button class="slot" class:on={slot === s} type="button" aria-pressed={slot === s}
                  title={empty ? "Pick a take for B to compare" : slot === s ? `Change the take in ${s}` : `Shape slot ${s}`}
                  onclick={(e) => (empty || slot === s ? takeMenu(s, e) : song.select(s))}>
            <span class="k">{s}</span>
            <span class="words"><span class="t">{deckTake(s)}</span><span class="p truncate">{empty ? "pick a render" : song.presetOf(s)?.name || "no preset"}</span></span>
            <Icon name="chev-down" size={13} />
          </button>
        {/each}
      </div>
      <button class="presetpick" type="button" aria-haspopup="menu" onclick={presetMenu} use:contextMenu={() => presetItems(preset!)}>
        <span class="words">
          <span class="lbl">Preset</span>
          <span class="name truncate">{preset.name}{#if preset.is_current}<Icon name="star" size={11} />{/if}</span>
        </span>
        <Icon name="chev-down" size={15} />
      </button>
      {#if data.bypass}<button class="chip on warn" type="button" onclick={() => editor.toggleBypass()} title="Turn it back on">Bypassed</button>{/if}
      <span class="saying faint" aria-live="polite" class:bad={editor.state === "failed"}>{saying}</span>
    </div>

    <!-- The chain, in the order the sound goes through it. -->
    <div class="chain-strip" role="listbox" tabindex="-1" aria-label="Effects, in order" aria-orientation="horizontal"
         ondragover={(e) => { if (dragId) e.preventDefault(); }} ondrop={drop}>
      <span class="end">In</span>
      {#each rack as u, i (u.id)}
        {#if dropAt === i && dragId}<span class="drop" aria-hidden="true"></span>{/if}
        <span class="arrow" aria-hidden="true"><Icon name="chev-right" size={12} /></span>
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div class="link" class:on={shown === u.id} class:off={!u.on || data.bypass} class:dragging={dragId === u.id}
             role="option" aria-selected={shown === u.id} tabindex="0" draggable="true"
             ondragstart={(e) => dragStart(e, u.id)} ondragend={() => { dragId = null; dropAt = null; }}
             ondragover={(e) => dragOver(e, i)}
             onclick={() => pick(u.id)} onkeydown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(u.id); } }}
             use:contextMenu={() => unitMenu(u, i)}>
          <button class="power" type="button" aria-label={u.on ? `Turn ${UNITS[u.kind].name} off` : `Turn ${UNITS[u.kind].name} on`}
                  aria-pressed={u.on} onclick={(e) => { e.stopPropagation(); editor.toggleUnit(u.id); }}></button>
          <span class="lw">
            <span class="name">{UNITS[u.kind].name}</span>
            <span class="what num">{summary(u, data)}</span>
          </span>
        </div>
      {/each}
      {#if dropAt === rack.length && dragId}<span class="drop" aria-hidden="true"></span>{/if}
      <span class="arrow" aria-hidden="true"><Icon name="chev-right" size={12} /></span>
      <button class="link add" type="button" onclick={addEffect} aria-haspopup="menu" title="Add an effect">
        <Icon name="plus" size={16} /><span class="name">Add</span>
      </button>
      <span class="arrow" aria-hidden="true"><Icon name="chev-right" size={12} /></span>
      <span class="end">Out</span>
    </div>

    {#if unit}
      {@const kind = UNITS[unit.kind]}
      <section class="glass panel" class:off={!unit.on || data.bypass} aria-label={kind.name}>
        <div class="phead">
          <h3>{kind.name}</h3>
          <Switch checked={unit.on} label={`${kind.name} on`} onchange={() => editor.toggleUnit(unit.id)} />
          <button class="fxpick" type="button" aria-haspopup="menu" onclick={fxMenu} title="{kind.name} presets">
            <span class="truncate">{fxName ?? "Custom"}</span><Icon name="chev-down" size={13} />
          </button>
          <span class="grow"></span>
          {#if unit.kind === "limiter" || unit.kind === "comp"}<span class="gr num faint" title="Gain reduction right now">gr <b>{reduction.toFixed(1)}</b> dB</span>{/if}
          <button class="icon-btn sm" type="button" aria-label={`More for ${kind.name}`} aria-haspopup="menu"
                  title="Move or remove" onclick={(e) => showMenu(unitMenu(unit, unitIndex), { anchor: e.currentTarget })}>
            <Icon name="more" size={16} /></button>
        </div>

        {#if unit.kind === "eq"}
          <EqCanvas {data} {slot} {live} {range} bind:selected onedit={editor.edit} />
          <div class="toolbar">
            <!-- One add button and a menu of the kinds: a row of five read as a choice
                 already made (the first was filled), and wrapped on a phone. -->
            <button class="btn sm" type="button" aria-haspopup="menu"
                    onclick={(e) => showMenu(ADD.map(([type, label]) => ({ label, run: () => add(type) })), { anchor: e.currentTarget })}>
              <Icon name="plus" size={14} />Band</button>
            <div class="pills" role="group" aria-label="Range in decibels">
              {#each RANGES as r (r)}
                <button class="chip" class:on={range === r} type="button" aria-pressed={range === r} onclick={() => setRange(r)}>±{r}</button>
              {/each}
            </div>
          </div>
          {#if bands.length}
            <div class="bands">
              {#each bands as band (band.id)}
                <BandCard {band} selected={selected === band.id} onselect={() => (selected = band.id)}
                          onpatch={(fn) => patchBand(band.id, fn)} onremove={() => removeBand(band.id)} />
              {/each}
            </div>
          {:else}
            <p class="faint flat">Flat. <span class="if-mouse">Click</span><span class="if-touch">Tap</span> the curve to add a band.</p>
          {/if}
        {:else}
          {#if unit.kind === "limiter"}
            <LimiterCanvas limiter={unit as unknown as LimiterSettings} {slot} {live} onedit={limiterEdit(unit.id) as never} />
          {/if}
          <div class="knobs">
            {#each kind.knobs as k (k.key)}
              {@const value = valueOf(unit, k.key)}
              <div class="knob">
                <div class="lab"><span>{k.label}</span><b class="num">{fmtKnob(value, k.step, k.unit)}</b></div>
                <Slider {value} min={k.min} max={k.max} step={k.step} label={k.label} accent={unit.on && !data.bypass} reset={k.value}
                        oninput={(n) => editor.setUnit(unit.id, k.key, n)} />
              </div>
            {/each}
          </div>
        {/if}
      </section>
    {:else}
      <button class="glass panel emptyrack" type="button" onclick={addEffect}>
        <Icon name="plus" size={18} /><span>No effects. Add one.</span>
      </button>
    {/if}

    <p class="faint foot">Playback only. Your file never changes.</p>
  </div>
{/if}

<style>
  .sound { display: flex; flex-direction: column; gap: var(--s4); }
  .top { display: flex; align-items: center; gap: var(--s3); flex-wrap: wrap; }
  .saying { margin-left: auto; font-size: var(--t-xs); min-height: 1em; }
  .saying.bad { color: var(--bad); }

  .slots { display: flex; gap: var(--s1); padding: var(--s1); border-radius: var(--r-lg); background: rgba(0, 0, 0, 0.3); border: 1px solid var(--line); }
  .slot {
    display: flex; align-items: center; gap: var(--s2); height: 46px; padding: 0 var(--s3) 0 var(--s2); border-radius: var(--r-md);
    color: var(--text-2); text-align: left; max-width: 200px; transition: background var(--fast), color var(--fast);
  }
  .slot:hover:not(:disabled) { background: var(--hover); color: var(--text); }

  .slot.on { background: var(--accent-soft); color: var(--text); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent) 50%, transparent); }
  .k { display: grid; place-items: center; width: 26px; height: 26px; flex: none; border-radius: 50%; background: var(--pressed); font: 800 11px/1 var(--display); }
  .slot.on .k { background: var(--accent); color: var(--accent-ink); }
  .words { display: flex; flex-direction: column; min-width: 0; line-height: 1.2; }
  .t { font-weight: 600; font-size: var(--t-sm); }
  .p { font-size: var(--t-xs); color: var(--text-3); }

  .presetpick {
    display: flex; align-items: center; gap: var(--s3); height: 46px; padding: 0 var(--s3) 0 var(--s4); border-radius: var(--r-lg);
    background: var(--glass); box-shadow: var(--edge-top); color: var(--text); min-width: 0; max-width: 280px;
    transition: background var(--fast);
  }
  .presetpick:hover { background: var(--glass-hover); }
  .lbl { font: 500 11px/1.2 var(--font); color: var(--text-3); }
  .name { font-weight: 600; display: inline-flex; align-items: center; gap: 4px; }

  .chain-strip { display: flex; align-items: center; flex-wrap: wrap; row-gap: var(--s2); gap: var(--s1); overflow-x: auto; padding: var(--s1) 2px var(--s2); scrollbar-width: thin; }
  
  :global(html[data-narrow]) .slots { flex: 1 1 100%; width: 100%; }
  :global(html[data-narrow]) .presetpick { width: 100%; max-width: none; }
  .end { flex: none; font: 500 11px/1 var(--font); color: var(--text-3); padding: 0 var(--s1); }
  .arrow { flex: none; color: var(--text-3); display: inline-grid; opacity: 0.7; }
  .link {
    flex: none; display: flex; align-items: center; gap: var(--s2); height: 52px; padding: 0 var(--s3) 0 var(--s2);
    border-radius: var(--r-md); background: var(--glass); box-shadow: var(--edge-top); cursor: pointer;
    transition: background var(--fast), box-shadow var(--fast), opacity var(--fast);
  }
  .link:hover { background: var(--glass-hover); }
  .link.on { background: var(--accent-soft); box-shadow: var(--edge-top), inset 0 0 0 1px color-mix(in srgb, var(--accent) 55%, transparent); }
  .link.off .name, .link.off .what { color: var(--text-3); }
  .link.dragging { opacity: 0.4; }
  .link.add { color: var(--text-2); background: none; box-shadow: none; border: 1px dashed var(--line-2); padding: 0 var(--s3); }
  .link.add:hover { color: var(--text); border-color: var(--accent-line); background: var(--hover); }
  .lw { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  .link .name { font: 600 var(--t-sm)/1.1 var(--font); white-space: nowrap; }
  .what { font-size: var(--t-xs); color: var(--text-2); white-space: nowrap; }
  /* A 22px disc in a 28px (40 on touch) button: the border is clear and the film stops at its padding box. */
  .power { position: relative; flex: none; width: var(--s6); height: var(--s6); border-radius: 50%; display: grid; place-items: center; background: rgba(0, 0, 0, 0.35); background-clip: padding-box; border: 3px solid transparent; box-shadow: inset 0 0 0 1px var(--line-2); }
  @media (pointer: coarse) { .power { width: var(--s7); height: var(--s7); border-width: 9px; } }
  .power::after { content: ""; width: 8px; height: 8px; border-radius: 50%; background: var(--text-3); transition: background var(--fast), box-shadow var(--fast); }
  .power[aria-pressed="true"]::after { background: var(--accent); }
  .drop { flex: none; width: 3px; height: 40px; border-radius: 2px; background: var(--accent); }

  .panel { padding: var(--s4); display: flex; flex-direction: column; gap: var(--s4); min-width: 0; border-radius: var(--r-lg); }
  /* Off reads as off: everything under the header dims (the switch stays crisp) and the
     sliders lose their colour. The pane itself never fades: it's glass. */
  .panel.off > :not(.phead) { opacity: 0.5; }
  .panel.off .knob b { color: var(--text-3); }
  .phead { display: flex; align-items: center; gap: var(--s3); flex-wrap: nowrap; min-height: 32px; min-width: 0; }
  .phead > :global(*) { flex-shrink: 0; }
  .phead .fxpick { flex-shrink: 1; min-width: 0; }
  :global(html[data-narrow]) .phead { gap: var(--s2); }
  .phead h3 { font-size: var(--t-md); font-family: var(--font); }
  .fxpick {
    display: inline-flex; align-items: center; gap: var(--s1); height: 30px; padding: 0 var(--s2) 0 var(--s3); border-radius: 999px;
    background: rgba(0, 0, 0, 0.3); border: 1px solid var(--line); font-size: var(--t-sm); font-weight: 600; color: var(--text-2); max-width: 200px;
  }
  .fxpick:hover { color: var(--text); border-color: var(--line-2); }
  .gr { font-size: var(--t-xs); }
  .gr b { color: var(--text-2); }
  .toolbar { display: flex; align-items: center; flex-wrap: wrap; gap: var(--s2); }
  .pills { display: flex; gap: var(--s1); flex-wrap: wrap; margin-left: auto; }
  .bands { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 220px), 1fr)); gap: var(--s2); }
  .flat { font-size: var(--t-sm); }
  .knobs { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 200px), 1fr)); gap: var(--s3) var(--s5); }
  .knob { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  .lab { display: flex; justify-content: space-between; align-items: baseline; font-size: var(--t-sm); color: var(--text-2); }
  .lab b { color: var(--text); font-weight: 600; }
  .emptyrack { flex-direction: row; align-items: center; justify-content: center; gap: var(--s2); color: var(--text-2); min-height: 120px; }
  .foot { font-size: var(--t-sm); }
  @media (max-width: 720px) { .presetpick { flex: 1 1 auto; max-width: none; } .slot { flex: 1 1 0; max-width: none; } }
</style>
