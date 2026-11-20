<!-- The timetable ("Órarend"). Not about music: it lives in this app because this app is the
     one reachable from a phone. A roomy screen: the shell gives it the whole window, so it
     has a small header of its own with the way back to the library and to Foyer.

     THE WEEK IS A FILE. It is the owner's, read by everybody signed in, written only by
     the owner (the server refuses anybody else; the editing is simply not offered). The
     page edits the file in place through the API, so a hand-typed week is not stranded
     behind a form.

     TWO WAYS OF LOOKING.
     "Hét": the whole table, laid out at its desktop width whatever the screen is and then
     scaled down to fit (the same trick as leaving width=device-width out of a page, done
     to one element: every proportion survives, which narrowing the columns did not). Never
     scaled up. The browser's own pinch zoom is left alone, because a second zoom inside
     the first is two sets of rules for one gesture.
     "Nap": one day at a time at a readable size, swiped between. This is what a phone gets
     by default, because a timetable on a phone is read one day at a time anyway.

     Gestures move transforms, never layout. -->
<script lang="ts">
  import { tick, onDestroy } from "svelte";
  import { get, post, put, del, attempt } from "$lib/api";
  import { sheet, anySheetOpen } from "$lib/dialog.svelte";
  import { toast } from "$lib/toast.svelte";
  import { menu as menuState, type MenuItem } from "$lib/menu.svelte";
  import { useCommands } from "$lib/commands";
  import { href } from "$lib/router.svelte";
  import { store, clamp } from "$lib/util";
  import { shell } from "../shell/state.svelte";
  import Icon from "$ui/Icon.svelte";
  import Day from "./orarend/Day.svelte";
  import Detail from "./orarend/Detail.svelte";
  import ClassForm from "./orarend/ClassForm.svelte";
  import {
    DAYS, DAYS_SHORT, FIELDS, minutes, planDay, peopleOf, tidy, whoColour, windowOf,
    type ClassValues, type Entry, type Week,
  } from "./orarend/week";

  // The route has no parameters; the screen is the same whatever the hash says.
  const _props: { params?: Record<string, string> } = $props();

  // ── the week, and how it is written ────────────────────────────────────────
  let week = $state<Week | null>(null);
  let classes = $state<Entry[]>([]);
  let failed = $state("");

  const readonly = $derived(!!week?.readonly);
  /* Everybody signed in reads the owner's week; only the owner changes it. "Saját" would
     be a lie for anybody else, so the owner's classes carry the owner's name. */
  const mine = $derived(readonly ? week?.owner || "Tulajdonos" : "Saját");
  const people = $derived(peopleOf(classes));

  function adopt(w: Week) {
    week = w;
    classes = (w.classes || []).map(tidy);
  }

  async function load(quiet = false) {
    try { adopt(await get<Week>("/api/orarend")); failed = ""; }
    catch (e) { if (!quiet || !week) failed = (e as Error).message; }
  }
  load();

  /* Writes go one after another, so two quick edits never race, and each one changes the
     screen first. When the last answer lands it is the truth and replaces the guess; if a
     write fails the guess is taken back by asking again. */
  let chain: Promise<unknown> = Promise.resolve();
  let inflight = 0;
  let seq = 0;

  async function write(fn: () => Promise<Week>, said?: string): Promise<Week | null> {
    inflight++;
    const run = chain.then(() => attempt(fn, said));
    chain = run;
    const got = await run;
    inflight--;
    if (got && inflight === 0) adopt(got);
    if (!got && inflight === 0) await load(true);
    return got;
  }

  const valuesOf = (e: Entry): ClassValues => {
    const out: Record<string, unknown> = {};
    for (const f of FIELDS) out[f] = e[f];
    out.skip = !!e.skip;
    out.day = Number(e.day);
    for (const f of ["where", "teacher", "group", "code"]) out[f] = String(out[f] ?? "");
    return out as unknown as ClassValues;
  };

  async function add(values: ClassValues, said = "Hozzáadva") {
    const temp: Entry = { ...values, key: "tmp:" + ++seq, pending: true };
    classes = [...classes, temp];
    await write(() => post<Week>("/api/orarend/classes", values), said);
  }

  async function save(entry: Entry, values: ClassValues) {
    classes = classes.map((c) => (c.key === entry.key ? { ...c, ...values, pending: true } : c));
    await write(() => put<Week>("/api/orarend/classes/" + entry.key, values), "Mentve");
  }

  /* Done at once; put back from the toast. The way back is a new class with the same
     words in it, which is all a class is. */
  async function drop(entry: Entry) {
    if (readonly || entry.pending) return;
    const values = valuesOf(entry);
    classes = classes.filter((c) => c.key !== entry.key);
    const got = await write(() => del<Week>("/api/orarend/classes/" + entry.key));
    if (!got) return;
    toast(`Törölve: ${entry.name}`, "", { label: "Visszavonás", run: () => add(values, "Visszaállítva") });
  }

  // ── sheets ─────────────────────────────────────────────────────────────────
  const said = (e: Entry) => `${DAYS[e.day] ?? ""} ${e.at}–${e.to}`;

  async function create(day?: number) {
    if (readonly) return;
    const values = await sheet<ClassValues>({
      title: "Új óra", confirm: "", cancel: "", wide: true, body: ClassForm,
      props: { entry: day === undefined ? null : { ...valuesOf({ day } as Entry), key: "", name: "" }, people },
    });
    if (values) add(values);
  }

  async function edit(entry: Entry) {
    if (readonly || entry.pending) return;
    const values = await sheet<ClassValues>({
      title: entry.name, sub: said(entry), confirm: "", cancel: "", wide: true, body: ClassForm,
      props: { entry, people },
    });
    if (values) save(entry, values);
  }

  async function open(entry: Entry) {
    const then = await sheet<string>({
      title: entry.name, sub: said(entry), confirm: "", cancel: "Bezárás", wide: true, body: Detail,
      props: { entry, readonly, mine, colour: whoColour(people, entry.whose) },
    });
    if (then === "edit") edit(entry);
    else if (then === "delete") drop(entry);
  }

  const itemsFor = (entry: Entry): MenuItem[] => [
    { label: "Megnyitás", icon: "info", run: () => open(entry) },
    ...(readonly ? [] : [
      { label: "Szerkesztés", icon: "edit", hint: "Enter", run: () => edit(entry), disabled: entry.pending },
      { label: "Másolat", icon: "copy", run: () => add(valuesOf(entry)), disabled: entry.pending },
      { divider: true } as MenuItem,
      { label: "Törlés", icon: "trash", hint: "Del", danger: true, run: () => drop(entry), disabled: entry.pending },
    ]),
  ];

  // ── whose week, and which way of looking ───────────────────────────────────
  /* Whose week is being looked at. "Mind" is the week this page was built for: mine as
     cards, everybody else's as stripes. One person picked is their week, drawn the way
     mine is. Remembered, because it is set once for an afternoon. */
  const SEEN = "jriter.orarend.who";
  const LOOK = "jriter.orarend.look";
  let seen = $state(store.raw(SEEN) || "all");
  const who = $derived(["all", "me", ...people].includes(seen) ? seen : "all");
  const label = (w: string) => (w === "all" ? "Mind" : w === "me" ? mine : w);
  function see(w: string) { seen = w; store.setRaw(SEEN, w); }

  let pref = $state<"day" | "week" | null>(((v) => (v === "day" || v === "week" ? v : null))(store.raw(LOOK)));
  let roomW = $state(0);
  const mode = $derived(pref ?? (roomW && roomW < 640 ? "day" : "week"));
  function look(m: "day" | "week") { pref = m; store.setRaw(LOOK, m); }

  const todayAt = (new Date().getDay() + 6) % 7;      // Monday is 0
  let day = $state(todayAt <= 4 ? todayAt : 0);

  let nowMin = $state(minutes(new Date().toTimeString().slice(0, 5)));
  const clock = setInterval(() => { nowMin = minutes(new Date().toTimeString().slice(0, 5)); }, 30000);
  onDestroy(() => clearInterval(clock));

  // ── the geometry ───────────────────────────────────────────────────────────
  /* The window the grid draws grows to hold whatever the week has in it, so nothing is
     ever drawn off the page. */
  const win = $derived(windowOf(week ?? { from: 8, to: 22 }, classes));
  const rows = $derived(win.to - win.from);
  const MIN_W = 876;                       // gutter 58 + 5 days of 160 + padding and borders
  const GUTTER = 76;                       // what is not day, in px
  const wide = $derived(mode === "week" ? Math.max(roomW, MIN_W) : roomW);
  const fit = $derived(mode === "week" && roomW ? Math.min(1, roomW / MIN_W) : 1);
  const dayW = $derived(mode === "week" ? (wide - GUTTER) / 5 : Math.max(0, roomW - GUTTER));
  /* How tall an hour is is a share of how wide a day is, so the shape holds at any width;
     clamped so a very wide window does not stretch the week into stripes. */
  const hour = $derived(mode === "week" ? clamp(dayW * 0.27, 40, 76) : 56);
  const unit = $derived(mode === "week" ? 1.3 : 1.5);
  const shown = $derived(mode === "week" ? [0, 1, 2, 3, 4] : [day]);
  const plans = $derived([0, 1, 2, 3, 4].map((d) => planDay(classes, d, who, win.from)));
  const nowAt = (d: number) => (d === todayAt ? (nowMin - win.from * 60) / 60 : null);

  /* A transform does not change the box a parent reserves, so the frame's height is
     written on by hand: without it a third height table sits in a full height hole. One
     read per change, after the layout it depends on, in a frame. */
  let gridEl = $state<HTMLElement>();
  let frameH = $state(0);
  $effect(() => {
    void [fit, hour, rows, classes.length, mode, who, roomW];
    if (!gridEl) return;
    const el = gridEl;
    const id = requestAnimationFrame(() => { frameH = Math.ceil(el.offsetHeight * fit); });
    return () => cancelAnimationFrame(id);
  });

  // ── a pinched page hands the whole gesture back to the browser ─────────────
  let zoomed = $state(false);
  $effect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const mark = () => { zoomed = vv.scale > 1.01; };
    vv.addEventListener("resize", mark);
    mark();
    return () => vv.removeEventListener("resize", mark);
  });

  // ── swiping between days ───────────────────────────────────────────────────
  let frame = $state<HTMLElement>();
  let swipe: { id: number; x: number; y: number; dx: number; on: boolean; t: number } | null = null;
  let swallow = false;
  const slides = () => Array.from(frame?.querySelectorAll<HTMLElement>(".slide") ?? []);
  const slideTo = (x: number, o = 1) => slides().forEach((el) => {
    el.style.transform = x ? `translate3d(${x}px,0,0)` : "";
    el.style.opacity = o === 1 ? "" : String(o);
  });

  function down(e: PointerEvent) {
    if (mode !== "day" || zoomed || e.pointerType === "mouse" || !e.isPrimary) return;
    swipe = { id: e.pointerId, x: e.clientX, y: e.clientY, dx: 0, on: false, t: performance.now() };
  }
  function move(e: PointerEvent) {
    if (!swipe || e.pointerId !== swipe.id) return;
    const dx = e.clientX - swipe.x, dy = e.clientY - swipe.y;
    if (!swipe.on) {
      if (Math.abs(dy) > 12 && Math.abs(dy) > Math.abs(dx)) { swipe = null; return; }
      if (Math.abs(dx) < 10 || Math.abs(dx) < Math.abs(dy) * 1.4) return;
      swipe.on = true;
      try { frame?.setPointerCapture(e.pointerId); } catch { /* the gesture still works */ }
    }
    swipe.dx = dx;
    // Past the first or last day it resists, so the edge of the week is felt.
    const edge = (day === 0 && dx > 0) || (day === 4 && dx < 0);
    slideTo(edge ? dx * 0.25 : dx);
  }
  async function up(e: PointerEvent) {
    const s = swipe;
    if (!s || e.pointerId !== s.id) return;
    swipe = null;
    if (!s.on) return;
    swallow = true;
    setTimeout(() => { swallow = false; }, 0);
    const dir = s.dx < 0 ? 1 : -1;
    const speed = Math.abs(s.dx) / Math.max(1, performance.now() - s.t);
    const target = day + dir;
    const go = (Math.abs(s.dx) > roomW * 0.2 || speed > 0.5) && target >= 0 && target <= 4;
    const els = slides();
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!go) {
      slideTo(0);
      if (!reduced) els.forEach((el) => el.animate([{ transform: `translate3d(${s.dx * 0.5}px,0,0)` }, { transform: "none" }], { duration: 260, easing: "cubic-bezier(0.32,0.72,0,1)" }));
      return;
    }
    if (!reduced) await Promise.all(els.map((el) => el.animate(
      [{ transform: `translate3d(${s.dx}px,0,0)`, opacity: 1 }, { transform: `translate3d(${-dir * roomW * 0.5}px,0,0)`, opacity: 0 }],
      { duration: 120, easing: "ease-in", fill: "forwards" }).finished.catch(() => null)));
    slideTo(0);
    day = target;
    await tick();
    if (!reduced) slides().forEach((el) => el.animate(
      [{ transform: `translate3d(${dir * roomW * 0.35}px,0,0)`, opacity: 0 }, { transform: "none", opacity: 1 }],
      { duration: 260, easing: "cubic-bezier(0.32,0.72,0,1)" }));
  }
  function stop(e: MouseEvent) { if (swallow) { e.stopPropagation(); e.preventDefault(); } }

  function step(by: number) { day = clamp(day + by, 0, 4); }

  // ── the keyboard ───────────────────────────────────────────────────────────
  let root = $state<HTMLElement>();
  const cardOf = (key: string) =>
    root?.querySelector<HTMLElement>(`[data-key="${CSS.escape(key)}"]`);

  async function focusEntry(entry: Entry | undefined, d: number) {
    if (!entry) return;
    if (mode === "day" && d !== day) { day = d; await tick(); }
    cardOf(entry.key)?.focus();
  }

  /* Arrows move between classes: up and down along a day, left and right to the
     neighbouring day's class nearest in time. */
  function arrow(from: Entry, key: string) {
    const d = from.day;
    const order = plans[d]?.order ?? [];
    const i = order.findIndex((x) => x.key === from.key);
    if (key === "ArrowDown" || key === "ArrowUp") {
      focusEntry(order[i + (key === "ArrowDown" ? 1 : -1)], d);
      return;
    }
    const dir = key === "ArrowRight" ? 1 : -1;
    for (let n = d + dir; n >= 0 && n <= 4; n += dir) {
      const list = plans[n].order;
      if (!list.length) continue;
      const at = minutes(from.at);
      const near = list.reduce((a, b) => (Math.abs(minutes(b.at) - at) < Math.abs(minutes(a.at) - at) ? b : a));
      focusEntry(near, n);
      return;
    }
  }

  function onkey(e: KeyboardEvent) {
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || !week) return;
    const target = e.target as HTMLElement;
    if (target.closest?.("input, textarea, select, [contenteditable]")) return;
    if (menuState.open || anySheetOpen() || shell.palette) return;
    const k = e.key;
    const hit = target.closest?.<HTMLElement>("[data-key]");
    const entry = hit ? classes.find((c) => c.key === hit.dataset.key) : undefined;
    const eat = () => { e.preventDefault(); e.stopPropagation(); };

    // Before the shell hears it: N here is a class, not a song.
    if ((k === "n" || k === "N") && !readonly) { eat(); create(mode === "day" ? day : undefined); return; }
    if (k === "ArrowLeft" || k === "ArrowRight" || k === "ArrowUp" || k === "ArrowDown") {
      if (entry) { eat(); arrow(entry, k); return; }
      if (!root?.contains(target) && target !== document.body) return;
      const list = plans[mode === "day" ? day : todayAt <= 4 ? todayAt : 0].order
        .concat(...plans.map((p) => p.order));
      if (list[0] && (k === "ArrowDown" || k === "ArrowRight")) { eat(); focusEntry(list[0], list[0].day); }
      else if (mode === "day" && (k === "ArrowLeft" || k === "ArrowRight")) { eat(); step(k === "ArrowRight" ? 1 : -1); }
      return;
    }
    if (!entry) return;
    if (k === "Enter" && !readonly) { eat(); edit(entry); return; }
    if ((k === "Delete" || k === "Backspace") && !readonly) { eat(); drop(entry); }
  }
  $effect(() => {
    window.addEventListener("keydown", onkey, true);
    return () => window.removeEventListener("keydown", onkey, true);
  });

  // The week is a file somebody can edit by hand: look again when the tab comes back.
  $effect(() => {
    const again = () => { if (!document.hidden && inflight === 0) load(true); };
    document.addEventListener("visibilitychange", again);
    return () => document.removeEventListener("visibilitychange", again);
  });

  useCommands(() => [
    !readonly && week ? { id: "tt.new", group: "Órarend", title: "Új óra", icon: "plus", hint: "N", run: () => create() } : null,
    { id: "tt.day", group: "Órarend", title: "Egy nap", sub: "one day at a time, swipe between", icon: "calendar", run: () => look("day") },
    { id: "tt.week", group: "Órarend", title: "A hét", sub: "the whole week", icon: "grid", run: () => look("week") },
    ...["all", "me", ...people].map((w) => ({ id: "tt.who." + w, group: "Órarend", title: label(w), sub: "whose week", icon: "people", run: () => see(w) })),
    { id: "tt.library", group: "Órarend", title: "Back to the library", icon: "library", run: () => { location.hash = href.library(); } },
  ].filter(Boolean) as import("$lib/commands").Command[]);

  const empty = $derived(!!week && (week.missing || !!week.broken || !classes.length));
  const hours = $derived(Array.from({ length: rows }, (_, i) => win.from + i));
</script>

<div class="tt" bind:this={root} class:zoomed>
  <header class="bar">
    <a class="icon-btn glassy" href={href.library()} title="Back to the library" aria-label="Back to the library"><Icon name="arrow-left" size={18} /></a>
    <h1>Órarend</h1>
    <span class="grow"></span>
    {#if week && !readonly}
      <button class="btn primary" type="button" onclick={() => create(mode === "day" ? day : undefined)}><Icon name="plus" size={16} /><span>Új óra</span></button>
    {/if}
    <a class="icon-btn glassy" href="/foyer" title="Foyer, the front door of this server" aria-label="Foyer"><Icon name="door" size={18} /></a>
  </header>

  {#if failed && !week}
    <div class="empty">
      <Icon name="warning" size={30} />
      <h3>Az órarend nem töltődött be</h3>
      <p>{failed}</p>
      <button class="btn" onclick={() => load()}>Újra</button>
    </div>
  {:else if empty && week}
    <!-- Two different nothings, said differently: a file that is not there is every account
         that has never written one (the answer is how to make one); a file that will not
         parse is one somebody has just edited (the answer is what stopped it). -->
    <div class="empty">
      <h3>{week.broken ? "Ez az órarend nem olvasható" : "Nincs még órarend"}</h3>
      <p>
        {#if week.broken}A fájl ott van, de nem értelmezhető: {week.broken}
        {:else if readonly}{mine} még nem vett fel órát.
        {:else}Vedd fel az első órát az Új óra gombbal. A hét a könyvtárad <code>{week.where || "orarend.json"}</code> fájljában marad, úgyhogy kézzel is szerkesztheted.{/if}
      </p>
    </div>
  {:else}
    <p class="lede faint">
      {readonly ? `${mine} hete. Kattints bármelyikre a részletekért.` : "A hét, ahogy van. Kattints bármelyikre a részletekért."}
    </p>

    {#if week}
      <!-- Whose week. Above the table: it decides what the table says, so it is read first.
           Also the legend, since each row is a name beside its colour. -->
      <div class="tools">
        <div class="who" role="radiogroup" aria-label="Kinek az órarendje">
          {#each ["all", "me", ...people] as w (w)}
            <button type="button" role="radio" aria-checked={who === w} class="chip" class:on={who === w} onclick={() => see(w)}>
              {#if w !== "all"}<i class="key" class:pill={w !== "me"} style:--who={w === "me" ? null : whoColour(people, w)}></i>{/if}
              {label(w)}
            </button>
          {/each}
        </div>
        <div class="look" role="group" aria-label="Nézet">
          <button type="button" class="chip" class:on={mode === "day"} aria-pressed={mode === "day"} onclick={() => look("day")}>Nap</button>
          <button type="button" class="chip" class:on={mode === "week"} aria-pressed={mode === "week"} onclick={() => look("week")}>Hét</button>
        </div>
      </div>

      {#if mode === "day"}
        <div class="tabs" role="tablist" aria-label="Nap">
          {#each DAYS as name, d}
            <button type="button" role="tab" class="tab" class:on={d === day} class:today={d === todayAt}
                    aria-selected={d === day} aria-label={name} onclick={() => (day = d)}>
              {DAYS_SHORT[d]}{#if plans[d].order.length}<i class="dot"></i>{/if}
            </button>
          {/each}
        </div>
      {/if}
    {/if}

    <div class="room" bind:clientWidth={roomW}>
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="frame" bind:this={frame} class:swipes={mode === "day" && !zoomed}
           style:height={fit < 1 && frameH ? frameH + "px" : null}
           onpointerdown={down} onpointermove={move} onpointerup={up} onpointercancel={up} onclickcapture={stop}>
        {#if !week}
          <!-- The right shape while it loads, so nothing jumps when the week lands. -->
          <div class="card grid skeleton" style="--hour:40px;--u:1">
            {#each [0, 1, 2, 3, 4] as c}
              <div class="skcol">
                <div class="sk" style="height:18px"></div>
                <div class="sk" style="height:{50 + c * 12}px;margin-top:{20 + c * 10}px"></div>
                <div class="sk" style="height:{80 - c * 8}px;margin-top:24px"></div>
              </div>
            {/each}
          </div>
        {:else}
          <div class="card grid" bind:this={gridEl}
               style="--hour:{hour}px;--u:{unit};--cols:{shown.length};width:{mode === 'week' ? wide + 'px' : '100%'};transform:{fit < 1 ? `scale(${fit})` : 'none'}">
            <div class="corner"></div>
            {#each shown as d (d)}
              <div class="head slide" class:today={d === todayAt}>{DAYS[d]}</div>
            {/each}
            <div class="hours">
              {#each hours as h}<div class="hour num">{String(h).padStart(2, "0")}:00</div>{/each}
            </div>
            {#each shown as d (d)}
              <div class="col slide">
                <Day plan={plans[d]} name={DAYS[d]} {rows} {people} now={nowAt(d)} onopen={open} menu={itemsFor} />
              </div>
            {/each}
          </div>
        {/if}
      </div>
    </div>

    <div class="legend">
      <span><i class="key k-ea"></i>Előadás</span>
      <span><i class="key k-gy"></i>Gyakorlat</span>
      <span><i class="key k-skip"></i>Nem látogatott</span>
    </div>
  {/if}
</div>

<style>
  .tt {
    width: 100%; max-width: 1800px; margin: 0 auto; flex: 1 1 auto;
    padding: calc(var(--gap) + var(--safe-t)) calc(var(--gap) + var(--safe-r)) var(--s7) calc(var(--gap) + var(--safe-l));
    display: flex; flex-direction: column; gap: var(--s3);
    /* Vertical scrolling and zooming are the browser's; a sideways drag is the page's
       (the day swipe). A pinched page is wider than the screen, and a sideways drag is
       how you look along it, so then the whole gesture goes back to the browser. */
    touch-action: pan-y pinch-zoom;
    user-select: none; -webkit-user-select: none;
  }
  .tt.zoomed { touch-action: auto; }
  .tt :global(input), .tt :global(textarea) { user-select: text; -webkit-user-select: text; }

  .bar { display: flex; align-items: center; gap: var(--s2); min-height: 44px; }
  .bar h1 { font-size: var(--t-2xl); margin: 0 var(--s2); }
  .glassy {
    width: 40px; height: 40px; color: var(--text);
    background: var(--glass); border: 1px solid var(--glass-line);
    box-shadow: var(--edge-top), 0 6px 20px rgba(0, 0, 0, 0.35);
  }
  .lede { font-size: var(--t-sm); margin: 0; }

  .tools { display: flex; flex-wrap: wrap; align-items: center; gap: var(--s2) var(--s4); justify-content: space-between; }
  .who, .look { display: flex; flex-wrap: wrap; gap: var(--s1); }
  .chip { cursor: pointer; }
  .key { width: 10px; height: 10px; border-radius: 3px; border: 1px solid var(--line-2); background: #121214; display: inline-block; flex: none; }
  .key.pill { background: var(--who); border-color: transparent; border-radius: var(--r-pill); width: 6px; height: 12px; }
  .key.k-ea { background: var(--glass-2); }
  .key.k-gy { box-shadow: var(--edge-top); }
  .key.k-skip { background: transparent; border-style: dashed; }

  .tabs { display: grid; grid-template-columns: repeat(5, 1fr); gap: var(--s1); }
  .tab {
    position: relative; height: 38px; border-radius: var(--r-pill); font: 600 var(--t-sm)/1 var(--font);
    color: var(--text-2); background: var(--hover); border: 1px solid var(--line);
    transition: background var(--fast), color var(--fast), border-color var(--fast), transform var(--fast);
  }
  .tab:active { transform: scale(0.96); }
  .tab.on { background: var(--accent-soft); color: var(--accent-text); border-color: var(--accent-line); }
  .tab.today:not(.on) { color: var(--text); border-color: var(--line-2); }
  .dot { position: absolute; left: 50%; bottom: 5px; width: 4px; height: 4px; margin-left: -2px; border-radius: 50%; background: currentColor; opacity: 0.55; }

  /* The room the table is fitted into, and the frame that clips what slides in it. */
  .room { width: 100%; }
  .frame { overflow: hidden; padding-bottom: var(--s2); border-radius: var(--r-lg); }
  .frame.swipes { touch-action: pan-y pinch-zoom; }

  .grid {
    display: grid; grid-template-columns: 58px repeat(var(--cols, 5), minmax(0, 1fr));
    transform-origin: top left; padding: var(--s2); overflow: hidden; will-change: transform;
  }
  .corner, .head {
    padding: var(--s2) 2px; text-align: center; font-size: calc(10.2px * var(--u)); font-weight: 600;
    color: var(--text-2); border-bottom: 1px solid var(--line-2); border-right: 1px solid var(--line);
  }
  .head:last-of-type { border-right: 0; }
  .head.today { color: var(--accent-text); }
  .hours { border-right: 1px solid var(--line); }
  .hour {
    height: var(--hour); padding: 2px var(--s1) 0 0; text-align: right; font-size: calc(8.5px * var(--u));
    color: var(--text-3); border-bottom: 1px solid var(--line);
  }
  .hour:last-child { border-bottom: 0; }
  .col { border-right: 1px solid var(--line); min-width: 0; }
  .col:last-child { border-right: 0; }

  .skeleton { grid-template-columns: repeat(5, minmax(0, 1fr)); gap: var(--s3); height: 560px; }
  .skeleton .sk { opacity: 0.7; }

  .legend { display: flex; flex-wrap: wrap; gap: var(--s4); align-items: center; font-size: var(--t-xs); color: var(--text-3); }
  .legend span { display: inline-flex; align-items: center; gap: var(--s2); }

  .empty { margin: auto; }

  @media (max-width: 480px) { .bar h1 { font-size: var(--t-xl); } .bar .btn span { display: none; } .bar .btn { padding: 0 var(--s3); } }
</style>
