<!-- The arrangement editor, laid out like a DAW: the transport, tempo and snap along the top,
     a browser of sections and takes at the left, the playlist with its bar ruler in the
     middle, and the mixer sliding up from the bottom. One lane of sections laid end to end,
     every edge on the snap.
     The moves are the ones the job needs:

       drag the middle     put this section somewhere else in the order
       drag an edge        make it shorter or longer, a beat at a time
       double click        repeat it, which is how a chorus goes round twice
       Backspace           take it out (and Undo brings it back)

     Nothing snaps to anything but the beat, because a section that starts half a beat late
     is never what anyone meant. The grid comes from the tempo, the tempo was a guess, and
     the guess is stated as a guess with halve, double and tap next to it. -->
<script lang="ts">
  import { onMount, tick } from "svelte";
  import Icon from "$ui/Icon.svelte";
  import { arrange, state as A, mix, tempoFromTaps, type Clip } from "$lib/audio/arrange.svelte";
  import { UNSURE } from "$lib/audio/beats";
  import { player, now, toggle, seekTo } from "$lib/player.svelte";
  import { contextMenu, showMenu, type MenuItem } from "$lib/menu.svelte";
  import { toast } from "$lib/toast.svelte";
  import { clamp, store, time } from "$lib/util";
  import { useSong } from "../song.svelte";
  import ClipWave from "./ClipWave.svelte";
  import Browser, { PART } from "./Browser.svelte";
  import Mixer from "./Mixer.svelte";
  import type { Source } from "./sample";
  import {
    history, rowsOf, setTempo, setOffset, setArranged, resetToRecorded, removeClip, duplicateClip,
    renameSection, lengthWords, playFrom, sheetTitle, type Sheet,
  } from "./edits.svelte";

  let { sheets, source, whole, laying, onlay, onloop, asArranged }: {
    sheets: Sheet[];
    source: Source;
    /** Seconds in the decoded render, so a clip's beats become a slice of the picture. */
    whole: number;
    /** 0..1 while the render is being read and laid out, otherwise null. */
    laying: number | null;
    onlay: () => void;
    onloop: (from: number, to: number) => void;
    asArranged: boolean;
  } = $props();

  const song = useSong();

  /* How wide a beat is on screen at rest. Zoom 1 fits the recorded song to the strip (and
   * never narrower than this), so a short song and a long one both start out readable. */
  const BASE = 9;
  const GAP = 0;                  // clips butt up against each other, so the ruler is the truth
  const LEAST = 14;
  const EDGE = 6;
  /* The band at each end of the strip where holding a block pans it, and how fast. Forty is
   * about a thumb's width: reachable without being somewhere you land by accident, and the
   * speed rises across it, so resting at the inside edge creeps and pressing to the
   * outside runs. Pixels per second and not per frame: the loop multiplies by the time that
   * actually passed, and PAN_CAP is how much one tick may claim, so a tab coming back from
   * the background pans a tick's worth instead of leaping to the end. */
  const BAND = 40, MOST = 900, CAP = 48, EVERY = 16;
  const THUMB_LEAST = 44;

  let zoom = $state(clamp(store.get("jriter.timeline.zoom", 1), 0.3, 6));
  /* What an edge snaps to while it is trimmed: a beat, or a whole bar. */
  let snap = $state<"beat" | "bar">(store.get<string>("jriter.timeline.snap", "beat") === "bar" ? "bar" : "beat");
  const snapTo = (to: "beat" | "bar") => { snap = to; store.set("jriter.timeline.snap", to); };
  let showBrowser = $state(store.get("jriter.timeline.browser", true));
  let showMixer = $state(store.get("jriter.timeline.mixer", false));
  const flipBrowser = () => { showBrowser = !showBrowser; store.set("jriter.timeline.browser", showBrowser); };
  const flipMixer = () => { showMixer = !showMixer; store.set("jriter.timeline.mixer", showMixer); };
  const zoomTo = (z: number) => { zoom = clamp(z, 0.3, 6); store.set("jriter.timeline.zoom", zoom); };

  let root: HTMLDivElement;
  let scroller = $state<HTMLDivElement>();
  let track = $state<HTMLDivElement>();
  let avail = $state(0);
  let scrollLeft = $state(0);
  let visible = $state(true);
  let toolsW = $state(66);
  let barW = $state(0);
  let holdingBar = $state(false);

  const beat = $derived(arrange.beatSeconds());
  const recordedBeats = $derived(A.parts.reduce((n, p) => n + p.beats, 0) || A.clips.reduce((n, c) => n + c.beats, 0));
  /* From the recorded length, not the current one: a trim must not rescale the strip under
   * the finger that is doing it. */
  const ppb = $derived(zoom * Math.max(BASE, avail && recordedBeats ? (avail - A.clips.length * GAP) / recordedBeats : BASE));

  const layout = $derived.by(() => {
    let x = 0;
    return A.clips.map((clip) => {
      const w = Math.max(LEAST, clip.beats * ppb);
      const box = { id: clip.id, left: x, width: w };
      x += w + GAP;
      return box;
    });
  });
  const trackW = $derived(Math.max(avail, layout.length ? layout[layout.length - 1].left + layout[layout.length - 1].width : 0));
  const partOf = (clip: Clip) => A.parts.find((p) => p.id === clip.part) || null;
  const boxOf = (id: string | null) => (id ? layout.find((b) => b.id === id) || null : null);

  const bars = $derived.by(() => {
    const bar = ppb * A.perBar;
    return {
      image: `repeating-linear-gradient(to right, var(--line) 0 1px, transparent 1px ${bar}px), repeating-linear-gradient(to right, var(--line-2) 0 1px, transparent 1px ${bar * 4}px)`,
      size: `${bar}px 100%, ${bar * 4}px 100%`,
    };
  });

  const sliceOf = (clip: Clip) => {
    if (!whole) return { from: 0, to: 0 };
    return { from: (A.offset + clip.from * beat) / whole, to: (A.offset + (clip.from + clip.beats) * beat) / whole };
  };

  /** Where a section begins on the axis the player is on. */
  function startOf(id: string): number | null {
    const row = arrange.laid().find((r) => r.clip.id === id);
    if (!row) return null;
    return asArranged ? row.at : row.sourceAt;
  }

  // ── what the strip says to a screen reader ─────────────────────────────────
  const said = $derived.by(() => {
    const i = A.clips.findIndex((c) => c.id === A.selected);
    if (i < 0) return "";
    const clip = A.clips[i];
    return `${partOf(clip)?.name ?? "Section"}, ${lengthWords(clip.beats)}, ${i + 1} of ${A.clips.length}`;
  });

  // ── the playhead and the block being heard ─────────────────────────────────
  let head = $state<HTMLDivElement>();
  let liveClip = $state<string | null>(null);

  function follow() {
    if (!head) return;
    if (!song.here || !asArranged) { head.style.opacity = "0"; liveClip = null; return; }
    const t = now();
    const rows = arrange.laid();
    let i = rows.findIndex((r) => t >= r.at && t < r.at + r.seconds);
    if (i < 0) i = t > 0 ? rows.length - 1 : 0;
    const row = rows[i], box = layout[i];
    if (!row || !box) { head.style.opacity = "0"; return; }
    const x = box.left + clamp((t - row.at) / Math.max(0.001, row.seconds), 0, 1) * box.width;
    head.style.opacity = "1";
    head.style.transform = `translate3d(${x}px,0,0)`;
    if (liveClip !== row.clip.id) liveClip = row.clip.id;
    // Keep it on screen while it plays, unless a block is in hand.
    if (scroller && song.playing && !drag && (x < scroller.scrollLeft || x > scroller.scrollLeft + scroller.clientWidth - 24)) {
      scroller.scrollLeft = Math.max(0, x - 48);
    }
  }
  $effect(() => { void player.position; void layout; void asArranged; void song.here; follow(); });
  $effect(() => {
    if (!visible || !song.playing || !asArranged) return;
    let id = 0;
    const frame = () => { id = requestAnimationFrame(frame); follow(); };
    id = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(id);
  });

  // ── the bar you can actually grab ──────────────────────────────────────────
  /* A native scrollbar is not a control on a phone: it reserves no space, it is drawn as an
   * overlay if at all, and on iOS it cannot be dragged. This is a div, so a finger reaches
   * it the way it reaches everything else. */
  const over = $derived(Math.max(0, trackW - avail));
  const thumbW = $derived(over > 1 && barW ? Math.max(THUMB_LEAST, Math.round(barW * (avail / trackW))) : 0);
  const thumbX = $derived(over > 1 && barW ? Math.round((scrollLeft / over) * (barW - thumbW)) : 0);

  function barDown(e: PointerEvent) {
    if (!scroller || !thumbW) return;
    const bar = e.currentTarget as HTMLElement;
    const box = bar.getBoundingClientRect();
    const room = box.width - thumbW;
    if (room <= 0) return;
    // Grabbing the thumb keeps the point it was grabbed by; tapping the track puts the
    // middle of the thumb under the finger, which is what makes a tap read as "go here".
    const onThumb = !!(e.target as HTMLElement).closest(".thumb");
    const held = onThumb ? e.clientX - (box.left + thumbX) : thumbW / 2;
    const to = (x: number) => { scroller!.scrollLeft = (clamp(x - box.left - held, 0, room) / room) * over; };
    to(e.clientX);
    holdingBar = true;
    try { bar.setPointerCapture(e.pointerId); } catch { /* not captured */ }
    const move = (ev: PointerEvent) => to(ev.clientX);
    const done = () => {
      holdingBar = false;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", done);
      window.removeEventListener("pointercancel", done);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", done);
    window.addEventListener("pointercancel", done);
  }

  // ── dragging a block ───────────────────────────────────────────────────────
  interface Gesture {
    pid: number; id: string; edge: "start" | "end" | null;
    startX: number; startBeats: number; startFrom: number;
    i0: number; left0: number; width0: number; grabbedBy: number; trackW: number;
    others: { j: number; centre: number }[];
    moved: boolean; changed: boolean; drop: number; lastX: number;
  }
  let drag: Gesture | null = null;
  let moving = $state(false);                       // enables the siblings' easing, for the length of a drag
  let held = $state<{ id: string; dx: number } | null>(null);
  let shifts = $state<Record<string, number>>({});
  let panning: { speed: number; x: number; last: number; timer: ReturnType<typeof setInterval> } | null = null;

  /* Where a pointer is along the strip, whatever the scroll is doing: the track's own
   * rectangle already moves with the scroll, so this is one number before and after a pan. */
  const onStrip = (clientX: number) => (track ? clientX - track.getBoundingClientRect().left : 0);

  function grab(e: PointerEvent, clip: Clip) {
    if (e.button !== 0 || drag) return;
    const i = A.clips.findIndex((c) => c.id === clip.id);
    const box = layout[i];
    if (i < 0 || !box) return;
    const edge = ((e.target as HTMLElement).closest("[data-edge]") as HTMLElement | null)?.dataset.edge as "start" | "end" | undefined;
    arrange.select(clip.id);
    const node = e.currentTarget as HTMLElement;
    node.focus({ preventScroll: true });
    try { node.setPointerCapture(e.pointerId); } catch { /* not captured */ }
    drag = {
      pid: e.pointerId, id: clip.id, edge: edge || null,
      startX: e.clientX, startBeats: clip.beats, startFrom: clip.from,
      i0: i, left0: box.left, width0: box.width, trackW,
      // How far into the block the finger landed, on the strip's own ruler.
      grabbedBy: onStrip(e.clientX) - box.left,
      // The others as they sat when the drag began. Decided against these and never against
      // the layout that includes the block in hand, or a committed swap would move the very
      // boundary that decided it and the block would flicker back.
      others: layout.map((b, j) => ({ j, centre: b.left + b.width / 2 })).filter((o) => o.j !== i),
      moved: false, changed: false, drop: i, lastX: e.clientX,
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", release);
    window.addEventListener("pointercancel", release);
  }

  function place(clientX: number) {
    const g = drag;
    if (!g) return;
    const at = onStrip(clientX);
    const left = clamp(at - g.grabbedBy, 0, Math.max(0, g.trackW - g.width0));
    held = { id: g.id, dx: left - g.left0 };
    const centre = left + g.width0 / 2;
    let k = 0;
    for (const o of g.others) if (o.centre < centre) k++;
    if (k === g.drop && Object.keys(shifts).length) return;
    g.drop = k;
    const by = g.width0 + GAP;
    const next: Record<string, number> = {};
    A.clips.forEach((c, j) => {
      if (j === g.i0) return;
      if (j < g.i0 && j >= k) next[c.id] = by;
      else if (j > g.i0 && j - 1 < k) next[c.id] = -by;
    });
    shifts = next;
  }

  function trim(dx: number) {
    const g = drag;
    if (!g) return;
    const clip = A.clips.find((c) => c.id === g.id);
    if (!clip) return;
    const unit = snap === "bar" ? A.perBar : 1;
    const steps = Math.round(dx / (ppb * unit)) * unit;
    let wanted = g.edge === "start" ? g.startBeats - steps : g.startBeats + steps;
    // The start cannot go earlier than the beginning of the render, nor the end past its end.
    if (g.edge === "start") wanted = Math.min(wanted, g.startBeats + g.startFrom);
    else if (whole) wanted = Math.min(wanted, Math.max(1, Math.floor((whole - A.offset) / beat) - clip.from));
    wanted = Math.max(1, wanted);
    if (wanted === clip.beats) return;
    if (!g.changed) { history.mark(); g.changed = true; }
    arrange.resize(g.id, g.edge!, wanted);
  }

  function move(e: PointerEvent) {
    const g = drag;
    if (!g || e.pointerId !== g.pid) return;
    g.lastX = e.clientX;
    const dx = e.clientX - g.startX;
    if (!g.moved && Math.abs(dx) > 3) { g.moved = true; if (!g.edge) moving = true; }
    if (!g.moved) return;
    if (g.edge) { trim(dx); return; }
    place(e.clientX);
    edgePan(e.clientX);
  }

  /* Holding a block against either end of the strip pans it. Dragging a block owns the
   * sideways gesture, so there is no other way to carry one past what is on screen. It runs
   * on a timer and not on pointer events because a finger held still at the edge stops
   * sending any, and on a timer and not requestAnimationFrame because a control loop should
   * not depend on a page being drawn. */
  function edgePan(clientX: number) {
    if (!scroller) return stopPan();
    const box = scroller.getBoundingClientRect();
    const into = clientX < box.left + BAND ? clientX - (box.left + BAND)
      : clientX > box.right - BAND ? clientX - (box.right - BAND) : 0;
    if (!into) return stopPan();
    const speed = clamp(into / BAND, -1, 1) * MOST;
    if (panning) { panning.speed = speed; panning.x = clientX; return; }
    const step = () => {
      if (!drag || !panning || !scroller) return stopPan();
      const t = performance.now();
      const dt = Math.min(CAP, t - panning.last);
      panning.last = t;
      const was = scroller.scrollLeft;
      scroller.scrollLeft = was + (panning.speed * dt) / 1000;
      if (scroller.scrollLeft !== was) place(panning.x);
    };
    panning = { speed, x: clientX, last: performance.now(), timer: setInterval(step, EVERY) };
  }
  function stopPan() {
    if (!panning) return;
    clearInterval(panning.timer);
    panning = null;
  }

  function release(e: PointerEvent) {
    const g = drag;
    if (!g || e.pointerId !== g.pid) return;
    drag = null;
    stopPan();
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", release);
    window.removeEventListener("pointercancel", release);
    // One announcement for however many boundaries the drag crossed: the save, the
    // reschedule and the lyric deck's redraw all hang off it, and none should run per pixel.
    if (g.moved && !g.edge && e.type !== "pointercancel" && g.drop !== g.i0) {
      history.mark();
      arrange.move(g.id, g.drop);
    }
    held = null;
    shifts = {};
    moving = false;
  }

  // ── keyboard ───────────────────────────────────────────────────────────────
  const idOf = (target: EventTarget | null) => (target as HTMLElement | null)?.closest<HTMLElement>("[data-clip]")?.dataset.clip ?? null;

  async function focusClip(id: string | null) {
    if (!id) return;
    arrange.select(id);
    await tick();
    const node = root?.querySelector<HTMLElement>(`[data-clip="${id}"]`);
    node?.focus({ preventScroll: true });
    node?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }

  function nudge(id: string, edge: "start" | "end", by: number) {
    const clip = A.clips.find((c) => c.id === id);
    if (!clip) return;
    let wanted = clip.beats + by;
    if (edge === "start") wanted = Math.min(wanted, clip.beats + clip.from);
    else if (whole) wanted = Math.min(wanted, Math.max(1, Math.floor((whole - A.offset) / beat) - clip.from));
    wanted = Math.max(1, wanted);
    if (wanted === clip.beats) return;
    history.mark();
    arrange.resize(id, edge, wanted);
  }

  function keydown(e: KeyboardEvent) {
    const key = e.key;
    const id = idOf(e.target) ?? A.selected;
    const i = id ? A.clips.findIndex((c) => c.id === id) : -1;
    const mod = e.ctrlKey || e.metaKey;
    const handled = () => { e.preventDefault(); e.stopPropagation(); };

    if (mod && key.toLowerCase() === "z") { handled(); if (!history.undo()) toast("There is nothing to undo."); return; }
    if (!A.clips.length) return;
    if (key === "ArrowLeft" || key === "ArrowRight") {
      const dir = key === "ArrowLeft" ? -1 : 1;
      if (i < 0) { handled(); focusClip(A.clips[dir < 0 ? A.clips.length - 1 : 0].id); return; }
      if (e.altKey) { handled(); nudge(A.clips[i].id, e.shiftKey ? "start" : "end", e.shiftKey ? -dir : dir); return; }
      if (mod) {
        handled();
        const to = clamp(i + dir, 0, A.clips.length - 1);
        if (to !== i) { history.mark(); arrange.move(A.clips[i].id, to); focusClip(A.clips[i].id); }
        return;
      }
      handled();
      focusClip(A.clips[clamp(i + dir, 0, A.clips.length - 1)].id);
      return;
    }
    if (key === "Home" || key === "End") { handled(); focusClip(A.clips[key === "Home" ? 0 : A.clips.length - 1].id); return; }
    if (i < 0) return;
    const clip = A.clips[i];
    if (key === "Backspace" || key === "Delete") {
      handled();
      const next = A.clips[i + 1] || A.clips[i - 1] || null;
      removeClip(clip.id);
      if (next) focusClip(next.id);
      return;
    }
    if (key === "Enter") { handled(); renameSection(clip.part); return; }
    if (mod && key.toLowerCase() === "d") { handled(); const copy = duplicateClip(clip.id); if (copy) focusClip(copy.id); return; }
    if (!mod && !e.altKey && key.toLowerCase() === "p") { handled(); playHere(clip.id); return; }
    if (key === "Escape") { handled(); arrange.select(null); }
  }

  // ── what a section can do ──────────────────────────────────────────────────
  function playHere(id: string) {
    const at = startOf(id);
    if (at !== null) void playFrom(song, at);
  }
  function loopHere(id: string) {
    const row = arrange.laid().find((r) => r.clip.id === id);
    if (!row) return;
    const at = asArranged ? row.at : row.sourceAt;
    onloop(at, at + row.seconds);
  }

  function wordsItems(partId: string | null): MenuItem[] {
    if (!partId || !sheets.length) return [];
    const linked = A.lyrics[partId];
    return [
      ...sheets.map((s) => ({
        label: sheetTitle(s), icon: "words", checked: linked === s.id,
        run: () => arrange.setLyricsFor(s.id, linked === s.id ? null : partId),
      })),
      linked ? { divider: true as const } : null,
      linked ? { label: "No words for this section", run: () => arrange.setLyricsFor(linked, null) } : null,
    ];
  }

  function clipMenu(id: string): MenuItem[] | null {
    const clip = A.clips.find((c) => c.id === id);
    if (!clip) return null;
    const part = partOf(clip);
    const half = Math.max(1, Math.round(clip.beats / 2));
    const words = wordsItems(clip.part);
    return [
      { group: part ? part.name : "Section" },
      { label: "Duplicate", icon: "copy", hint: "Double click", run: () => { const c = duplicateClip(clip.id); if (c) focusClip(c.id); } },
      { label: `Halve it, to ${lengthWords(half)}`, icon: "edit", disabled: clip.beats < 2, run: () => { history.mark(); arrange.resize(clip.id, "end", half); } },
      { label: `Double it, to ${lengthWords(clip.beats * 2)}`, icon: "edit", run: () => { history.mark(); arrange.resize(clip.id, "end", clip.beats * 2); } },
      { divider: true },
      part ? { label: "Rename this section", icon: "edit", hint: "Enter", run: () => renameSection(part.id) } : null,
      words.length ? { label: "Words for this section", icon: "words", items: words } : null,
      { label: "Play from here", icon: "play", hint: "P", run: () => playHere(clip.id) },
      { label: "Loop this section", icon: "repeat", run: () => loopHere(clip.id) },
      { divider: true },
      { label: "Remove from the arrangement", icon: "trash", danger: true, hint: "Backspace", run: () => removeClip(clip.id) },
    ];
  }

  function pointSheet(sheet: Sheet, anchor: Element) {
    const linked = arrange.partForSheet(sheet.id);
    showMenu([
      { group: `Which section are these words for?` },
      ...A.parts.map((p) => ({
        label: p.name, hint: `${p.beats} beats`, checked: linked?.id === p.id,
        run: () => arrange.setLyricsFor(sheet.id, linked?.id === p.id ? null : p.id),
      })),
      linked ? { divider: true as const } : null,
      linked ? { label: "No section", run: () => arrange.setLyricsFor(sheet.id, null) } : null,
    ], { anchor });
  }

  // ── the ruler and the transport ────────────────────────────────────────────
  /* Bar numbers on the ruler, thinned out when a bar is too narrow to carry its own. */
  const ruler = $derived.by(() => {
    const barPx = ppb * A.perBar;
    const every = barPx >= 28 ? 1 : barPx >= 14 ? 2 : barPx >= 7 ? 4 : 8;
    const count = Math.ceil(trackW / Math.max(1, barPx));
    const marks: { n: number; x: number }[] = [];
    for (let b = 0; b <= count; b += every) marks.push({ n: b + 1, x: b * barPx });
    return marks;
  });

  /** The time under a point of the strip, on the axis the player is on. */
  function timeAt(x: number): number {
    const rows = arrange.laid();
    for (let i = 0; i < layout.length; i++) {
      const box = layout[i], row = rows[i];
      if (!row) break;
      if (x < box.left + box.width || i === layout.length - 1) {
        const t = clamp((x - box.left) / Math.max(1, box.width), 0, 1) * row.seconds;
        return (asArranged ? row.at : row.sourceAt) + t;
      }
    }
    return 0;
  }
  function rulerDown(e: PointerEvent) {
    if (e.button !== 0) return;
    void playFrom(song, timeAt(onStrip(e.clientX)));
  }

  async function playPause() {
    if (song.here) await toggle();
    else void playFrom(song, 0);
  }
  async function stopAll() {
    if (song.here && player.playing) await toggle();
    if (song.here) seekTo(0);
  }
  /* The counter: bar and beat, then minutes and seconds, like the one on a desk. */
  const where = $derived.by(() => {
    const t = song.here ? player.position : 0;
    const into = asArranged ? t : t - A.offset;
    const b = Math.max(0, Math.floor(into / beat));
    return { bar: Math.floor(b / A.perBar) + 1, beat: (b % A.perBar) + 1, clock: time(Math.max(0, t)) };
  });

  // ── a section dropped in from the browser ──────────────────────────────────
  let dropAt = $state<number | null>(null);
  let dropIndex = 0;
  function indexAt(x: number): number {
    let k = 0;
    for (const b of layout) if (b.left + b.width / 2 < x) k++;
    return k;
  }
  function dragOver(e: DragEvent) {
    if (!e.dataTransfer?.types.includes(PART)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    const k = indexAt(onStrip(e.clientX));
    const last = layout[layout.length - 1];
    dropAt = k < layout.length ? layout[k].left : last ? last.left + last.width : 0;
    dropIndex = k;
  }
  function drop(e: DragEvent) {
    const id = e.dataTransfer?.getData(PART);
    dropAt = null;
    if (!id) return;
    e.preventDefault();
    history.mark();
    const clip = arrange.insert(id, dropIndex);
    if (clip) focusClip(clip.id);
  }

  // ── the header ─────────────────────────────────────────────────────────────
  let taps: number[] = [];
  let tapCount = $state(0);
  let handBpm = $state<number | null>(null);
  $effect(() => { void A.confidence; handBpm = null; });
  const guessed = $derived(A.clips.length > 0 && A.confidence > 0 && (handBpm === null || Math.abs(A.bpm - handBpm) > 0.001));

  function byHand(bpm: number) {
    setTempo(bpm);
    handBpm = A.bpm;
  }
  function tap() {
    const t = performance.now();
    if (taps.length && t - taps[taps.length - 1] > 2200) taps = [];
    taps.push(t);
    const bpm = tempoFromTaps(taps);
    if (bpm) {
      taps = []; tapCount = 0;
      byHand(bpm);
      toast(`Tempo set to ${Math.round(A.bpm)}.`);
    } else tapCount = taps.length;
  }

  const builtFrom = $derived(song.versions.find((v) => String(v.id) === String(A.versionId)) || null);
  const newer = $derived(!!A.versionId && !!song.current && String(song.current.id) !== String(A.versionId));

  // ── keeping the strip's numbers honest ─────────────────────────────────────
  onMount(() => {
    const seen = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; });
    seen.observe(root);
    return () => { seen.disconnect(); stopPan(); };
  });
</script>

<div class="editor" bind:this={root}>
  <div class="head">
    <div class="group transport" role="group" aria-label="Transport">
      <button class="icon-btn sm" class:on={song.here && player.playing} aria-label={song.here && player.playing ? "Pause" : "Play"}
              title={song.here && player.playing ? "Pause" : "Play"} onclick={playPause}>
        <Icon name={song.here && player.playing ? "pause" : "play"} size={16} /></button>
      <button class="icon-btn sm" aria-label="Stop" title="Stop and go back to the start" onclick={stopAll}><Icon name="stop" size={15} /></button>
    </div>

    <div class="lcd num" role="timer" aria-label="Position: bar {where.bar}, beat {where.beat}, {where.clock}">
      <b>{String(where.bar).padStart(3, "0")}<i>:</i>{where.beat}</b>
      <span>{where.clock}</span>
    </div>

    <div class="group" role="group" aria-label="Tempo">
      <label class="bpm">
        <input class="field sm num" type="number" min="20" max="400" step="0.1" aria-label="Beats per minute"
               value={Math.round(A.bpm * 10) / 10}
               onchange={(e) => byHand(parseFloat(e.currentTarget.value))} />
        <span class="faint">bpm</span>
      </label>
      <button class="btn sm ghost" onclick={() => byHand(A.bpm / 2)} title="Half the tempo" disabled={!A.clips.length}>&divide;2</button>
      <button class="btn sm ghost" onclick={() => byHand(A.bpm * 2)} title="Double the tempo" disabled={!A.clips.length}>&times;2</button>
      <button class="btn sm ghost num" onclick={tap} title="Tap four beats to set the tempo">{tapCount ? `Tap ${4 - tapCount}` : "Tap"}</button>
      {#if guessed}
        {#if A.confidence < UNSURE}
          <span class="tag warn" title="Couldn't hear the beat clearly. Check the tempo, maybe halve or double it.">unsure</span>
        {:else}
          <span class="tag guess" title="Tempo and sections are a guess. Check the grid against the hits and halve, double or tap if it's off.">
            guess <span class="meter" aria-hidden="true"><i style:width="{Math.round(A.confidence * 100)}%"></i></span> {Math.round(A.confidence * 100)}%
          </span>
        {/if}
      {/if}
    </div>

    <div class="group" role="group" aria-label="Where beat one sits">
      <label class="bpm" title="Where beat one is, in seconds. Nudge it until the grid lines up with the hits.">
        <span class="faint lbl">Offset</span>
        <input class="field sm num" type="number" step="0.01" min="-60" max="600" aria-label="Offset in seconds"
               value={Math.round(A.offset * 1000) / 1000}
               onchange={(e) => setOffset(parseFloat(e.currentTarget.value))} />
        <span class="faint">s</span>
      </label>
      <button class="icon-btn sm" aria-label="Nudge the grid 10 ms earlier" title="10 ms earlier" onclick={() => setOffset(A.offset - 0.01)} disabled={!A.clips.length}><Icon name="chev-left" size={15} /></button>
      <button class="icon-btn sm" aria-label="Nudge the grid 10 ms later" title="10 ms later" onclick={() => setOffset(A.offset + 0.01)} disabled={!A.clips.length}><Icon name="chev-right" size={15} /></button>
    </div>

    <div class="snap" role="radiogroup" aria-label="Snap edges to">
      <button role="radio" aria-checked={snap === "beat"} class:on={snap === "beat"} title="Edges snap to the beat" onclick={() => snapTo("beat")}>Beat</button>
      <button role="radio" aria-checked={snap === "bar"} class:on={snap === "bar"} title="Edges snap to whole bars" onclick={() => snapTo("bar")}>Bar</button>
    </div>

    <span class="grow spacer"></span>

    <!-- Panels, undo, zoom, and the two big resets behind ⋯: one tidy row on every width. -->
    <div class="group tail" role="group" aria-label="Arrangement">
      {#if laying !== null}<span class="faint small num">Listening…</span>{/if}
      <button class="icon-btn sm" class:on={showBrowser} aria-pressed={showBrowser} aria-label="Browser" title="Show the browser of sections and takes" onclick={flipBrowser}><Icon name="sidebar" size={16} /></button>
      <button class="icon-btn sm" class:on={showMixer} aria-pressed={showMixer} aria-label="Mixer" title="Show the mixer" onclick={flipMixer}><Icon name="eq" size={16} /></button>
      <button class="icon-btn sm" aria-label="Undo" title="Undo (Ctrl+Z)" disabled={!history.canUndo} onclick={() => history.undo()}><Icon name="undo" size={16} /></button>
      <button class="icon-btn sm" aria-label="Zoom out" title="Zoom out" onclick={() => zoomTo(zoom / 1.35)}><Icon name="zoom-out" size={16} /></button>
      <button class="icon-btn sm" aria-label="Zoom in" title="Zoom in" onclick={() => zoomTo(zoom * 1.35)}><Icon name="zoom-in" size={16} /></button>
      <button class="icon-btn sm" aria-label="More for the arrangement" title="More" aria-haspopup="menu"
              onclick={(e) => showMenu([
                { label: "Back to as recorded", sub: "every section once, in order, untrimmed", icon: "undo", disabled: !A.parts.length, run: resetToRecorded },
                { label: "Detect again", sub: "guess the tempo and sections again", icon: "refresh", disabled: laying !== null, run: onlay },
              ], { anchor: e.currentTarget })}><Icon name="more" size={16} /></button>
    </div>
  </div>

  {#if !A.clips.length}
    <div class="empty">
      <h3>Nothing laid out yet</h3>
      <p>JR!TER can listen to this render, find the tempo and split it into sections. You can change all of it after.</p>
      <button class="btn primary" onclick={onlay} disabled={laying !== null}>
        {laying !== null ? `Listening… ${Math.round(laying * 100)}%` : "Listen and lay it out"}
      </button>
    </div>
  {:else}
   <div class="desk" class:browsing={showBrowser}>
    {#if showBrowser}<Browser onadded={(id) => focusClip(id)} />{/if}
    <div class="playlist">
    <div class="lanehead" aria-hidden="true">
      <span class="rulerpad"></span>
      <div class="lane-name" class:muted={mix.mute}>
        <i class="lane-dot"></i><span class="truncate">Arrangement</span>
      </div>
    </div>
    <div class="scroll" bind:this={scroller} bind:clientWidth={avail}
         onscroll={(e) => (scrollLeft = e.currentTarget.scrollLeft)}>
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="ruler" style:width="{trackW}px" onpointerdown={rulerDown} title="Click to play from here">
        {#each ruler as m (m.n)}<span class="tick num" style:transform="translate3d({m.x}px,0,0)">{m.n}</span>{/each}
      </div>
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="track" bind:this={track} style:width="{trackW}px"
           ondragover={dragOver} ondragleave={() => (dropAt = null)} ondrop={drop}>
        <div class="bars" style:background-image={bars.image} style:background-size={bars.size}></div>
        {#if dropAt !== null}<div class="drop-mark" style:transform="translate3d({dropAt}px,0,0)" aria-hidden="true"></div>{/if}
        <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
        <div class="clips" class:moving role="listbox" aria-label="Sections, in the order they play"
             aria-orientation="horizontal" tabindex="-1" onkeydown={keydown}>
          {#each A.clips as clip, i (clip.id)}
            {@const part = partOf(clip)}
            {@const box = layout[i]}
            {@const mine = held?.id === clip.id}
            {@const slice = sliceOf(clip)}
            {@const first = A.selected ? A.selected === clip.id : i === 0}
            <div class="clip" class:on={A.selected === clip.id} class:live={liveClip === clip.id} class:holding={mine}
                 role="option" aria-selected={A.selected === clip.id} tabindex={first ? 0 : -1}
                 aria-label="{part?.name ?? 'Section'}, {lengthWords(clip.beats)}"
                 data-clip={clip.id} style:width="{box?.width ?? LEAST}px" style:--hue={part?.hue ?? 210}
                 style:transform="translate3d({mine ? held!.dx : (shifts[clip.id] ?? 0)}px,0,0)"
                 onpointerdown={(e) => grab(e, clip)}
                 ondblclick={() => { const c = duplicateClip(clip.id); if (c) focusClip(c.id); }}
                 use:contextMenu={() => clipMenu(clip.id)}>
              <span class="grip start" data-edge="start" title="Trim the start" aria-hidden="true"></span>
              <ClipWave {source} from={slice.from} to={slice.to} />
              <span class="name">{part ? part.name : "clip"}</span>
              {#if part && A.lyrics[part.id]}
                {@const sheet = sheets.find((s) => s.id === A.lyrics[part.id])}
                {#if sheet}<span class="words" title="Words: {sheetTitle(sheet)}"><Icon name="words" size={11} /></span>{/if}
              {/if}
              <span class="beats num">{lengthWords(clip.beats)}</span>
              <span class="grip end" data-edge="end" title="Trim the end" aria-hidden="true"></span>
            </div>
          {/each}
        </div>
        <div class="playhead" bind:this={head} aria-hidden="true"></div>

        {#if A.selected && !held}
          {@const box = boxOf(A.selected)}
          {#if box}
            {@const right = box.left + box.width}
            {@const lo = Math.min(scrollLeft + toolsW + EDGE, scrollLeft + avail - EDGE)}
            {@const hi = Math.max(scrollLeft + toolsW + EDGE, scrollLeft + avail - EDGE)}
            {@const at = clamp(right, lo, hi)}
            <!-- Beside the clips rather than inside one: a block clips its own overflow and a
                 fourteen pixel one has no room for two buttons. Out here it hangs over the corner. -->
            <div class="tools" bind:offsetWidth={toolsW}
                 style:left="{clamp(at, Math.min(box.left + toolsW, right), right)}px">
              <button class="tool" title="Duplicate this section" aria-label="Duplicate this section"
                      onclick={() => { const c = duplicateClip(A.selected!); if (c) focusClip(c.id); }}><Icon name="copy" size={14} /></button>
              <button class="tool danger" title="Take this section out" aria-label="Take this section out"
                      onclick={() => removeClip(A.selected!)}><Icon name="trash" size={14} /></button>
            </div>
          {/if}
        {/if}
      </div>
    </div>
    </div>
   </div>

    <!-- The way along a long arrangement, as a real control. -->
    {#if over > 1}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="bar" class:holding={holdingBar} bind:clientWidth={barW} onpointerdown={barDown} aria-hidden="true">
        <div class="thumb" style:width="{thumbW}px" style:transform="translate3d({thumbX}px,0,0)"></div>
      </div>
    {/if}

    {#if sheets.length && A.parts.length}
      <div class="wordsrow" role="group" aria-label="Words, and the section each is for">
        <span class="faint small">Words</span>
        {#each sheets as sheet (sheet.id)}
          {@const linked = arrange.partForSheet(sheet.id)}
          <button class="chip" class:on={!!linked} style:--hue={linked?.hue ?? 140}
                  title="Which section of the arrangement these words are for"
                  onclick={(e) => pointSheet(sheet, e.currentTarget)}>
            <i class="dot"></i><span class="truncate">{sheetTitle(sheet)}</span>
            <span class="faint">{linked ? linked.name : "no section"}</span>
          </button>
        {/each}
      </div>
    {/if}

    <div class="tray" class:open={showMixer} inert={!showMixer}>
      <div class="tray-in">{#if showMixer}<Mixer />{/if}</div>
    </div>

    <div class="foot small faint">
      <span class="num">{A.clips.length} part{A.clips.length === 1 ? "" : "s"} &middot; {Math.round(arrange.totalBeats() / A.perBar)} bars &middot; {time(arrange.duration())}</span>
      {#if newer && builtFrom}
        <span title="An arrangement stays on the render it was built from: a newer take does not silently repoint it at a file whose bars are somewhere else.">
          built from take {builtFrom.n ?? ""}
        </span>
      {/if}
      <span class="grow"></span>
      <span class="keys">drag sections in from the browser &middot; drag to move &middot; edges to trim &middot; double click to repeat &middot; <kbd>Alt</kbd>+<kbd>&larr;</kbd><kbd>&rarr;</kbd> trim a beat</span>
    </div>
  {/if}

  <div class="sr-only" aria-live="polite">{said}</div>
</div>

<style>
  .editor { display: flex; flex-direction: column; gap: var(--s3); padding: var(--s3) 0 2px; min-width: 0; }
  .head { display: flex; align-items: center; gap: var(--s3); flex-wrap: wrap; }
  /* Explicit direction and padding: the global .group in controls.css is a column of
     settings rows, and without these it wins and stacks every toolbar button. */
  .group { display: flex; flex-direction: row; align-items: center; gap: var(--s1); flex-wrap: wrap; padding: 0; }
  .bpm { display: flex; align-items: center; gap: var(--s2); padding: 0 var(--s1); font-size: var(--t-sm); }
  .bpm .field { width: 74px; text-align: right; font-weight: 600; }
  .spacer { flex: 1 1 8px; }
  .tail { flex-wrap: nowrap; margin-left: auto; }
  .lbl { font-size: var(--t-sm); }
  :global(html[data-narrow]) .lbl { width: 44px; flex: none; }
  :global(html[data-narrow]) .bpm { padding: 0; }
  /* A phone: tempo and offset are a row each, lined up on the same left edge, and the
     tools sit on their own row at the right. Every control the same 40px height. */
  /* Tempo gets a row; Offset shares its row with undo, zoom and ⋯ at the right end. */
  :global(html[data-narrow]) .head { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: var(--s2); }
  :global(html[data-narrow]) .head > .group:first-child { grid-column: 1 / -1; }
  :global(html[data-narrow]) .tail { gap: 0; }
  :global(html[data-narrow]) .head .group :global(.icon-btn.sm) { width: 30px; }
  :global(html[data-narrow]) .tail :global(.icon-btn.sm) { width: 28px; }
  :global(html[data-narrow]) .bpm .field { width: 52px; }
  :global(html[data-narrow]) .bpm { gap: var(--s1); }
  :global(html[data-narrow]) .snap { max-width: 100%; }
  :global(html[data-narrow]) .snap button { padding: 0 var(--s2); }
  :global(html[data-narrow]) .head .spacer { display: none; }
  :global(html[data-narrow]) .head .group { flex-wrap: wrap; min-width: 0; }
  :global(html[data-narrow]) .head :global(.btn.sm), :global(html[data-narrow]) .head :global(.icon-btn.sm), :global(html[data-narrow]) .head .field { height: 40px; }
  :global(html[data-narrow]) .tail { justify-self: end; }
  .small { font-size: var(--t-sm); }
  .tag.guess { text-transform: none; letter-spacing: 0; display: inline-flex; align-items: center; gap: 6px; }
  .meter { width: 30px; height: 4px; border-radius: 4px; background: var(--line-2); overflow: hidden; display: inline-block; }
  .meter i { display: block; height: 100%; background: var(--accent); }

  .empty { padding: var(--s6) var(--s4); }

  /* The transport and the counter: the counter is a little screen, as on a desk. */
  .transport :global(.icon-btn.on) { color: var(--accent-hi); }
  .lcd {
    display: flex; align-items: baseline; gap: var(--s2); height: 30px; padding: 0 var(--s3); border-radius: var(--r-sm);
    background: rgba(0, 0, 0, 0.45); box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.7), 0 1px 0 rgba(255, 255, 255, 0.05);
    font-family: var(--mono); line-height: 30px; color: var(--accent-text); white-space: nowrap;
  }
  .lcd b { font-size: var(--t-lg); font-weight: 600; color: var(--accent-hi); text-shadow: 0 0 8px color-mix(in srgb, var(--accent) 45%, transparent); }
  .lcd b i { font-style: normal; opacity: 0.55; }
  .lcd span { font-size: 11px; opacity: 0.8; }
  .snap { display: inline-flex; padding: var(--s1); border-radius: var(--r-pill); background: rgba(0, 0, 0, 0.3); box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.5); }
  .snap button { height: 28px; padding: 0 var(--s3); border-radius: var(--r-pill); font-size: var(--t-sm); font-weight: 600; color: var(--text-3); transition: background var(--fast), color var(--fast); }
  @media (pointer: coarse) { .snap button { height: 40px; } }
  .snap button:hover { color: var(--text); }
  .snap button.on { background: var(--glass-2); color: var(--text); box-shadow: var(--edge-top); }
  .tail :global(.icon-btn.on) { color: var(--accent-text); background: var(--hover); }

  /* The desk: the browser on the left, the playlist taking the rest. */
  .desk { display: grid; grid-template-columns: minmax(0, 1fr); gap: var(--s2); min-width: 0; align-items: stretch; }
  .desk.browsing { grid-template-columns: 190px minmax(0, 1fr); }
  /* The browser is as tall as the playlist beside it and scrolls inside that. */
  .desk.browsing > :global(.browser) { contain: size; min-height: 120px; }
  :global(html[data-narrow]) .desk.browsing { grid-template-columns: minmax(0, 1fr); }
  .playlist { display: grid; grid-template-columns: 124px minmax(0, 1fr); min-width: 0; border-radius: var(--r-md); overflow: hidden; box-shadow: 0 0 0 1px var(--glass-line); }
  :global(html[data-narrow]) .playlist { grid-template-columns: minmax(0, 1fr); }
  :global(html[data-narrow]) .lanehead { display: none; }
  .lanehead { display: flex; flex-direction: column; background: rgba(255, 255, 255, 0.03); box-shadow: inset -1px 0 0 var(--glass-line); }
  .rulerpad { height: 22px; flex: none; box-shadow: inset 0 -1px 0 var(--glass-line); }
  .lane-name { flex: 1; display: flex; align-items: center; gap: var(--s2); padding: 0 var(--s2); font-size: var(--t-sm); font-weight: 600; color: var(--text-2); min-width: 0; transition: opacity var(--fast); }
  .lane-name.muted { opacity: 0.45; }
  .lane-dot { flex: none; width: 8px; height: 8px; border-radius: 50%; background: var(--accent); box-shadow: 0 0 6px var(--accent); }
  .ruler {
    position: relative; height: 22px; min-width: 100%; cursor: pointer; user-select: none;
    background: rgba(255, 255, 255, 0.04); box-shadow: inset 0 -1px 0 var(--glass-line);
  }
  .tick { position: absolute; left: 0; top: 0; height: 100%; padding-left: var(--s1); font-size: var(--t-xs); line-height: 22px; color: var(--text-3); border-left: 1px solid var(--line-2); pointer-events: none; }
  .drop-mark { position: absolute; top: 4px; bottom: 4px; left: -1px; width: 3px; border-radius: 2px; background: var(--accent-hi); box-shadow: 0 0 10px var(--accent); z-index: 6; pointer-events: none; }

  /* The mixer slides up out of the bottom edge. */
  .tray { display: grid; grid-template-rows: 0fr; opacity: 0; transform: translateY(10px); transition: grid-template-rows var(--sheet), opacity var(--fast), transform var(--sheet); }
  .tray.open { grid-template-rows: 1fr; opacity: 1; transform: none; }
  .tray-in { overflow: hidden; min-height: 0; }
  @media (prefers-reduced-motion: reduce) { .tray { transition: none; transform: none; } }


  /* No native bar: there is a real one under the strip. */
  .scroll {
    position: relative; width: 100%; min-width: 0; overflow-x: auto; overflow-y: hidden;
    background: rgba(0, 0, 0, 0.26); box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.5);
    overscroll-behavior-x: contain; scrollbar-width: none; -webkit-overflow-scrolling: touch;
  }
  .scroll::-webkit-scrollbar { display: none; height: 0; }
  .track { position: relative; height: 114px; min-width: 100%; }
  .bars { position: absolute; inset: 0; background-repeat: repeat-x; opacity: 0.5; pointer-events: none; }
  /* Eighteen at the top: half the height of the button group plus a little, because it sits
     centred on a block's top edge and this box hides its vertical overflow. */
  .clips { position: relative; display: flex; height: 100%; align-items: stretch; padding: 18px 0 var(--s2); gap: 2px; outline: none; }

  .clip {
    position: relative; flex: none; min-width: 14px; border-radius: var(--r-sm); overflow: hidden;
    background: linear-gradient(180deg, hsl(var(--hue) 44% 24%) 0%, hsl(var(--hue) 40% 15%) 100%);
    border: 1px solid hsl(var(--hue) 38% 30%); box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.07);
    cursor: grab; user-select: none; outline: none;
    /* Sideways on a block is ours, up and down is still the page's: without this a finger on
       a block scrolled the strip and the drag was taken back with pointercancel. */
    touch-action: pan-y;
    transition: filter var(--fast), box-shadow var(--fast);
  }
  /* Siblings ease aside only while a drag is in progress. Off at the drop, so the order
     changing and the transforms clearing in one frame do not animate back. */
  .clips.moving .clip:not(.holding) { transition: transform var(--med), filter var(--fast), box-shadow var(--fast); }
  .clip:hover { filter: brightness(1.14); }
  .clip.on { box-shadow: 0 0 0 2px var(--accent), inset 0 1px 0 rgba(255, 255, 255, 0.07); }
  .clip:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: var(--r-sm); }
  .clip.holding {
    cursor: grabbing; filter: brightness(1.2); z-index: 3; transition: none;
    box-shadow: 0 0 0 1px hsl(var(--hue) 45% 45%), 0 10px 22px rgba(0, 0, 0, 0.55);
  }
  .clip.live { box-shadow: inset 0 2px 0 var(--accent-hi); }
  .clip.on.live { box-shadow: 0 0 0 2px var(--accent), inset 0 2px 0 var(--accent-hi); }

  .name {
    position: absolute; left: 7px; top: 5px; right: 7px; font-size: 11.5px; font-weight: 600; color: var(--text-on-color);
    text-shadow: 0 1px 3px rgba(0, 0, 0, 0.6); pointer-events: none; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .words { position: absolute; left: 7px; bottom: 5px; color: rgba(255, 255, 255, 0.78); pointer-events: none; display: grid; }
  .beats { position: absolute; right: 7px; bottom: 4px; font-size: var(--t-xs); color: rgba(255, 255, 255, 0.7); text-shadow: 0 1px 3px rgba(0, 0, 0, 0.6); pointer-events: none; }
  .grip { position: absolute; top: 0; bottom: 0; width: 9px; cursor: ew-resize; z-index: 3; touch-action: none; }
  .grip.start { left: 0; }
  .grip.end { right: 0; }
  .grip::after {
    content: ""; position: absolute; top: 30%; bottom: 30%; left: 50%; width: 2px; border-radius: 2px;
    transform: translateX(-50%); background: rgba(255, 255, 255, 0.55); opacity: 0; transition: opacity var(--fast);
  }
  .clip:hover .grip::after, .clip.on .grip::after { opacity: 1; }

  .playhead {
    position: absolute; top: 0; bottom: 0; left: 0; width: 2px; margin-left: -1px; opacity: 0; z-index: 4;
    background: var(--accent-hi); box-shadow: 0 0 8px var(--accent); pointer-events: none; will-change: transform;
  }

  .tools {
    position: absolute; top: 18px; z-index: 5; transform: translate(-100%, -50%); display: flex; align-items: center; overflow: hidden;
    background: var(--glass-2);
    border: 1px solid var(--glass-line); border-radius: var(--r-pill); box-shadow: var(--edge-top), 0 6px 18px rgba(0, 0, 0, 0.5);
  }
  .tool { display: grid; place-items: center; width: 30px; height: 26px; color: var(--text-2); transition: background var(--fast), color var(--fast); }
  .tool + .tool { box-shadow: inset 1px 0 0 var(--glass-line); }
  .tool:hover { background: var(--hover); color: var(--text); }
  .tool.danger:hover { background: var(--bad-soft); color: var(--bad); }
  @media (pointer: coarse) { .tool { width: 38px; height: 34px; } }

  /* The whole 26 pixels is the target; the groove drawn inside it is narrower, because a
     control the size of its own target looks like a slab. */
  .bar { position: relative; height: 26px; border-radius: var(--r-pill); cursor: pointer; touch-action: none; }
  .bar::before {
    content: ""; position: absolute; left: 0; right: 0; top: 50%; height: 10px; margin-top: -5px;
    border-radius: var(--r-pill); background: rgba(0, 0, 0, 0.26); box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.5);
  }
  .thumb { position: absolute; top: 50%; height: 14px; margin-top: -7px; border-radius: var(--r-pill); background: var(--line-2); transition: background var(--fast); }
  .bar:hover .thumb { background: var(--text-3); }
  .bar.holding .thumb { background: var(--accent); }
  @media (max-width: 900px) { .bar { height: 34px; } .thumb { height: 18px; margin-top: -9px; } }

  .wordsrow { display: flex; align-items: center; gap: var(--s2); flex-wrap: wrap; }
  .wordsrow .chip { max-width: 100%; }
  .dot { width: 8px; height: 8px; border-radius: 50%; background: hsl(var(--hue) 45% 52%); flex: none; }
  .foot { display: flex; align-items: center; gap: var(--s3); flex-wrap: wrap; }
  .keys { opacity: 0.8; }
  @media (max-width: 900px) {
    .keys { display: none; }
    .track { height: 102px; }
    .grip { width: 16px; }
  }
  @media (prefers-reduced-motion: reduce) { .clips.moving .clip:not(.holding) { transition: none; } }
</style>
