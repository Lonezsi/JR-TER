<!-- The stickers on an album's case, placed by hand, like a story editor.

     The case big in the middle with its stickers live on it:
       - drag a sticker to move it; touching one brings it to the top of the pile
       - pinch with two fingers (anywhere on the case) to resize and turn the picked one,
         or drag the round handle on its corner, which does the same with one finger/mouse
       - drag it onto the bin that shows up under the case to peel it off
       - double-click one with words on it to edit them
       - tilt snaps straight within a few degrees, so straight is easy to hit
     The tray at the bottom has every kind, drawn as itself: tap one to stick it on in the
     middle. Up to eight, duplicates welcome.

     Keyboard: Tab to a sticker, arrows move it (Shift: further), + and - size it, [ and ]
     turn it, Delete peels it off.

     Closes with the list to save, "random" to go back to the album's own random set, or null
     for nothing changed. -->
<script lang="ts">
  import AlbumArt from "$ui/AlbumArt.svelte";
  import Icon from "$ui/Icon.svelte";
  import Sticker from "$ui/Sticker.svelte";
  import { KINDS, MAX_STICKERS, hasText, nameOf, randomStickers, stickersOf, warningLines, WARNING,
           type Sticker as S, type StickerKind } from "$lib/stickers";

  let { album, url = null, close }: {
    album: { id: number; title: string; year?: number | null; stickers?: unknown };
    url?: string | null;
    close: (value?: unknown) => void;
  } = $props();

  type Live = S & { id: number };
  let nextId = 1;
  const live = (s: S): Live => ({ ...s, id: nextId++ });
  // svelte-ignore state_referenced_locally
  let list = $state<Live[]>(stickersOf(album).map(live));
  let sel = $state<number | null>(null);
  const picked = $derived(sel === null ? null : list[sel] ?? null);

  let width = $state(360);
  // The case plus its peeking disc (16% more) fits the sheet, up to 320px.
  const SIZE = $derived(Math.round(Math.max(180, Math.min(320, (width - 24) / 1.16))));
  const coarse = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;

  let layer = $state<HTMLElement>();
  let bin = $state<HTMLElement>();
  let textInput = $state<HTMLInputElement>();
  // Each sticker's own (unscaled, unturned) size, for the frame drawn around the picked one.
  let sizes = $state<{ w: number; h: number }[]>([]);
  $effect(() => {
    void JSON.stringify(list); void SIZE;
    const els = layer?.querySelectorAll<HTMLElement>(".stk");
    sizes = els ? Array.from(els, (el) => ({ w: el.offsetWidth, h: el.offsetHeight })) : [];
  });

  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
  const turn = (deg: number) => { let d = ((deg + 180) % 360 + 360) % 360 - 180; if (Math.abs(d) < 3) d = 0; return Math.round(d * 10) / 10; };
  const sizeOf = (v: number) => Math.round(clamp(v, 0.4, 3) * 100) / 100;

  /** Bring sticker i to the top of the pile and pick it. */
  function pick(i: number) {
    if (i !== list.length - 1) { const [s] = list.splice(i, 1); list.push(s); i = list.length - 1; }
    sel = i;
  }
  function add(kind: StickerKind) {
    if (list.length >= MAX_STICKERS) return;
    const r = Math.random;
    list.push(live({ kind, x: 50 + (r() - 0.5) * 10, y: 50 + (r() - 0.5) * 10, s: 1, rot: Math.round((r() - 0.5) * 16),
      text: KINDS.find((x) => x.kind === kind)!.text(r, album.year) || undefined }));
    sel = list.length - 1;
  }
  function remove(i: number) {
    list.splice(i, 1);
    sel = null;
  }

  // --- Gestures -------------------------------------------------------------------------
  const pointers = new Map<number, { x: number; y: number }>();
  type Gesture =
    | { kind: "drag"; p0: { x: number; y: number }; start: Live; moved: boolean }
    | { kind: "pinch"; d0: number; a0: number; m0: { x: number; y: number }; start: Live }
    | { kind: "handle"; c: { x: number; y: number }; d0: number; a0: number; start: Live };
  let g: Gesture | null = null;
  let dragging = $state(false);
  let overBin = $state(false);

  const two = () => { const [a, b] = [...pointers.values()]; return { a, b }; };
  const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(b.x - a.x, b.y - a.y);
  const angle = (a: { x: number; y: number }, b: { x: number; y: number }) => (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
  function centre(s: S) {
    const r = layer!.getBoundingClientRect();
    return { x: r.left + (s.x / 100) * r.width, y: r.top + (s.y / 100) * r.height };
  }
  function startDrag(p: { x: number; y: number }) {
    if (sel === null) { g = null; return; }
    g = { kind: "drag", p0: p, start: { ...list[sel] }, moved: false };
  }
  function startPinch() {
    if (sel === null) return;
    const { a, b } = two();
    g = { kind: "pinch", d0: dist(a, b) || 1, a0: angle(a, b), m0: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, start: { ...list[sel] } };
    dragging = false;
  }

  function down(e: PointerEvent) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    layer!.setPointerCapture(e.pointerId);
    const p = { x: e.clientX, y: e.clientY };
    pointers.set(e.pointerId, p);
    if (pointers.size === 2) { startPinch(); return; }
    if (pointers.size > 2) return;
    const t = e.target as Element;
    if (t.closest("[data-handle]") && sel !== null) {
      const c = centre(list[sel]);
      g = { kind: "handle", c, d0: dist(c, p) || 1, a0: angle(c, p), start: { ...list[sel] } };
      return;
    }
    const hit = t.closest<HTMLElement>("[data-i]");
    if (hit) { pick(Number(hit.dataset.i)); startDrag(p); }
    else { sel = null; g = null; }
  }
  function move(e: PointerEvent) {
    if (!pointers.has(e.pointerId) || !g || sel === null) return;
    const p = { x: e.clientX, y: e.clientY };
    pointers.set(e.pointerId, p);
    const s = list[sel];
    const r = layer!.getBoundingClientRect();
    if (g.kind === "drag") {
      const dx = p.x - g.p0.x, dy = p.y - g.p0.y;
      if (!g.moved && Math.hypot(dx, dy) < 3) return;
      g.moved = true; dragging = true;
      s.x = clamp(g.start.x + (dx / r.width) * 100, 0, 100);
      s.y = clamp(g.start.y + (dy / r.height) * 100, 0, 100);
      const b = bin?.getBoundingClientRect();
      overBin = !!b && p.x >= b.left - 12 && p.x <= b.right + 12 && p.y >= b.top - 12 && p.y <= b.bottom + 12;
    } else if (g.kind === "pinch" && pointers.size >= 2) {
      const { a, b } = two();
      s.s = sizeOf(g.start.s * (dist(a, b) / g.d0));
      s.rot = turn(g.start.rot + angle(a, b) - g.a0);
      const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      s.x = clamp(g.start.x + ((m.x - g.m0.x) / r.width) * 100, 0, 100);
      s.y = clamp(g.start.y + ((m.y - g.m0.y) / r.height) * 100, 0, 100);
    } else if (g.kind === "handle") {
      s.s = sizeOf(g.start.s * (dist(g.c, p) / g.d0));
      s.rot = turn(g.start.rot + angle(g.c, p) - g.a0);
    }
  }
  function up(e: PointerEvent) {
    if (!pointers.delete(e.pointerId)) return;
    if (g?.kind === "drag" && overBin && sel !== null) remove(sel);
    overBin = false;
    if (pointers.size === 1) { startDrag([...pointers.values()][0]); dragging = false; return; }
    if (pointers.size === 0) { g = null; dragging = false; }
  }
  function wheel(e: WheelEvent) {
    if (sel === null) return;
    e.preventDefault();
    const s = list[sel];
    if (e.shiftKey) s.rot = turn(s.rot + Math.sign(e.deltaY) * 5);
    else s.s = sizeOf(s.s * (e.deltaY < 0 ? 1.06 : 1 / 1.06));
  }
  function key(e: KeyboardEvent, i: number) {
    const s = list[i];
    const step = e.shiftKey ? 5 : 1;
    const k = e.key;
    if (k === "ArrowLeft") s.x = clamp(s.x - step, 0, 100);
    else if (k === "ArrowRight") s.x = clamp(s.x + step, 0, 100);
    else if (k === "ArrowUp") s.y = clamp(s.y - step, 0, 100);
    else if (k === "ArrowDown") s.y = clamp(s.y + step, 0, 100);
    else if (k === "+" || k === "=") s.s = sizeOf(s.s * 1.08);
    else if (k === "-" || k === "_") s.s = sizeOf(s.s / 1.08);
    else if (k === "]") s.rot = turn(s.rot + step * 3);
    else if (k === "[") s.rot = turn(s.rot - step * 3);
    else if (k === "Delete" || k === "Backspace") { remove(i); return; }
    else if (k === "Enter" && hasText(s.kind)) { textInput?.focus(); }
    else return;
    e.preventDefault();
    sel = i;
  }

  // The warning label's three lines live in one text, "top|big|bottom".
  const lines = $derived(picked?.kind === "warning" ? warningLines(picked.text) : []);
  function setLine(n: number, value: string) {
    if (sel === null) return;
    const l = warningLines(list[sel].text);
    l[n] = value;
    list[sel].text = l.map((v, i) => (v.trim() && v !== WARNING[i] ? v : "")).join("|").replace(/\|+$/, "") || undefined;
  }

  const sample = (kind: StickerKind): S => ({ kind, x: 50, y: 50, s: 1, rot: -4, text: KINDS.find((x) => x.kind === kind)!.text(() => 0.4, album.year) || undefined });
  const shuffle = () => { list = randomStickers(Math.floor(Math.random() * 1e6), album.year).map(live); sel = null; };
  const save = () => close(list.map(({ id: _id, ...s }) => s));
</script>

<div class="sheetbody" bind:clientWidth={width}>
  <div class="stage" class:dragging>
    <span class="case">
      <AlbumArt album={{ ...album, stickers: [] }} {url} title={album.title} size={SIZE} bare />
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="layer" bind:this={layer} style:width="{SIZE}px" style:height="{SIZE}px"
        onpointerdown={down} onpointermove={move} onpointerup={up} onpointercancel={up} onwheel={wheel}>
        {#each list as s, i (s.id)}
          <Sticker {s} live selected={i === sel} index={i} label={nameOf(s.kind)}
            onkeydown={(e: KeyboardEvent) => key(e, i)} onfocus={() => (sel = i)}
            ondblclick={() => hasText(s.kind) && textInput?.focus()} />
        {/each}
        {#if picked && sizes[sel!] && !dragging}
          {@const z = sizes[sel!]}
          <span class="frame" aria-hidden="true"
            style:left="{picked.x}%" style:top="{picked.y}%" style:width="{z.w * picked.s + 10}px" style:height="{z.h * picked.s + 10}px"
            style:--rot="{picked.rot}deg">
            <span class="handle" class:big={coarse} data-handle title="Drag to resize and turn"><Icon name="refresh" size={coarse ? 14 : 11} /></span>
          </span>
        {/if}
      </div>
    </span>
    <div class="bin" class:on={dragging} class:over={overBin} bind:this={bin} aria-hidden="true"><Icon name="trash" size={18} /></div>
  </div>

  <p class="hint">
    {#if coarse}Drag to move. Pinch to resize and turn. Drop on the bin to peel off.
    {:else}Drag to move. The corner handle (or the wheel, Shift to turn) resizes and turns. Drop on the bin to peel off.{/if}
  </p>

  <div class="tools" class:off={!picked}>
    {#if picked}
      <span class="name">{nameOf(picked.kind)}</span>
      {#if picked.kind === "warning"}
        <input class="field sm text" maxlength="20" value={lines[0]} aria-label="Top line" oninput={(e) => setLine(0, e.currentTarget.value)} />
        <input class="field sm text" maxlength="20" value={lines[1]} aria-label="Big word" bind:this={textInput} oninput={(e) => setLine(1, e.currentTarget.value)} />
        <input class="field sm text wide" maxlength="20" value={lines[2]} aria-label="Bottom line" oninput={(e) => setLine(2, e.currentTarget.value)} />
      {:else if hasText(picked.kind)}
        <input class="field sm text" maxlength="24" aria-label="What {nameOf(picked.kind)} says" bind:this={textInput} bind:value={list[sel!].text} />
      {:else}<span class="grow"></span>{/if}
      <button type="button" class="icon-btn sm" title="Straighten" aria-label="Straighten and reset the size" onclick={() => { list[sel!].rot = 0; list[sel!].s = 1; }}><Icon name="undo" size={15} /></button>
      <button type="button" class="icon-btn sm" title="Peel it off" aria-label="Peel {nameOf(picked.kind)} off" onclick={() => remove(sel!)}><Icon name="trash" size={15} /></button>
    {:else}
      <span class="none">{list.length ? "Touch a sticker to change it." : "A bare case. Stick something on from below."}</span>
    {/if}
  </div>

  <div class="tray" role="group" aria-label="Stickers to stick on">
    {#each KINDS as k (k.kind)}
      <button type="button" class="tile" title="Stick on {k.name}" disabled={list.length >= MAX_STICKERS} onclick={() => add(k.kind)}>
        <span class="mini"><Sticker s={sample(k.kind)} /></span>
        <span class="label">{k.name}</span>
      </button>
    {/each}
  </div>

  <div class="foot">
    <button type="button" class="icon-btn" title="Shuffle: a new random set" aria-label="Shuffle: a new random set" onclick={shuffle}><Icon name="shuffle" size={16} /></button>
    <button type="button" class="icon-btn" title="Back to the album's own random stickers" aria-label="Back to the album's own random stickers" onclick={() => close("random")}><Icon name="refresh" size={16} /></button>
    <span class="grow"></span>
    <button type="button" class="btn sm ghost" onclick={() => close(null)}>Cancel</button>
    <button type="button" class="btn sm primary" onclick={save}>Save</button>
  </div>
</div>

<style>
  .sheetbody { display: flex; flex-direction: column; gap: var(--s3); min-width: 0; }

  .stage { position: relative; contain: inline-size; display: grid; justify-items: center; padding: var(--s3) 0 var(--s6); }
  .case { position: relative; display: inline-block; }
  .layer { position: absolute; top: 0; left: 0; z-index: 2; container-type: inline-size; touch-action: none; user-select: none; -webkit-user-select: none; }
  .dragging .layer { cursor: grabbing; }

  /* The picked sticker's frame and its resize-and-turn handle. */
  .frame { position: absolute; z-index: 3; pointer-events: none; border: 1.5px solid #fff; border-radius: 4px;
           box-shadow: 0 0 0 1px rgb(0 0 0 / 0.35); transform: translate(-50%, -50%) rotate(var(--rot)); }
  .handle { position: absolute; right: -11px; bottom: -11px; width: 22px; height: 22px; border-radius: 50%;
            display: grid; place-items: center; pointer-events: auto; cursor: grab; touch-action: none;
            background: #fff; color: #111; box-shadow: 0 1px 4px rgb(0 0 0 / 0.45); }
  .handle.big { width: 30px; height: 30px; right: -15px; bottom: -15px; }

  /* The bin, under the case, only while dragging. */
  .bin { position: absolute; left: 50%; bottom: 0; width: 40px; height: 40px; margin-left: -20px; border-radius: 50%;
         display: grid; place-items: center; color: #fff; background: rgb(0 0 0 / 0.55); border: 1.5px solid rgb(255 255 255 / 0.6);
         opacity: 0; transform: scale(0.7); pointer-events: none;
         transition: opacity 160ms ease, transform 200ms var(--spring), background-color 140ms ease; }
  .bin.on { opacity: 1; transform: scale(1); }
  .bin.over { background: #d8443a; transform: scale(1.25); }

  .hint { margin: 0; text-align: center; color: var(--text-3); font-size: var(--t-xs); }

  .tools { display: flex; align-items: center; gap: var(--s2); min-height: 40px; padding: var(--s1) var(--s2);
           border-radius: var(--r-md); background: var(--glass); }
  .tools.off { justify-content: center; }
  .name { flex: none; font-weight: 600; font-size: var(--t-sm); padding: 0 var(--s1); }
  .text { flex: 1 1 60px; min-width: 0; }
  .text.wide { flex-basis: 110px; }
  .none { color: var(--text-3); font-size: var(--t-sm); }

  /* The tray: every kind, drawn as itself, in one row that scrolls sideways. */
  .tray { contain: inline-size; display: flex; gap: var(--s2); overflow-x: auto; padding: var(--s1) 2px var(--s2); scroll-snap-type: x proximity; overscroll-behavior-x: contain; }
  .tile { flex: none; scroll-snap-align: start; display: flex; flex-direction: column; align-items: center; gap: var(--s1);
          width: 84px; padding: var(--s2) var(--s1); border-radius: var(--r-md); border: 1px solid var(--line);
          background: transparent; color: inherit; cursor: pointer;
          transition: border-color 140ms ease, transform 140ms ease; }
  .tile:hover:not(:disabled) { border-color: var(--accent); transform: translateY(-2px); }
  .tile:active:not(:disabled) { transform: scale(0.96); }
  .tile:disabled { opacity: 0.4; cursor: default; }
  .mini { position: relative; display: block; width: 72px; height: 44px; container-type: inline-size; }
  .mini :global(.stk) { --sc: 2.1 !important; }
  .label { font-size: var(--t-xs); color: var(--text-3); }

  .foot { display: flex; align-items: center; gap: var(--s2); flex-wrap: wrap; }
  @media (max-width: 640px) { .tools { flex-wrap: wrap; } }
  @media (prefers-reduced-motion: reduce) { .bin, .tile { transition: none; } }
</style>
