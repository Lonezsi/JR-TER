<!-- The words: several sets, one of them current, each with its own history. Markdown, and
     the first line is the name, so there is no Rename: change the heading and the set is
     called something else.

     Writing autosaves, quietly, a moment after you stop typing, and again the instant focus
     leaves, the tab closes or the screen is left, so navigating away never loses text. The
     save never touches the browser's history stack: the old editor steered Back from a blur,
     and a blur that fires because a real link was pressed would then cancel that
     navigation. History (below) keeps every revision, which is what Escape used to be for.
     Restoring an old text is a new revision, so nothing is ever lost. -->
<script lang="ts">
  import { onDestroy, onMount, tick } from "svelte";
  import { deleteSoon } from "$lib/later.svelte";
  import { slide } from "svelte/transition";
  import Icon from "$ui/Icon.svelte";
  import { get, post, put, del, attempt } from "$lib/api";
  import { emit, on } from "$lib/bus";
  import { contextMenu, showMenu, type MenuItem } from "$lib/menu.svelte";
  import { confirm } from "$lib/dialog.svelte";
  import { toast } from "$lib/toast.svelte";
  import { copyText } from "$lib/actions";
  import { clamp, date, debounce, store } from "$lib/util";
  import { app, saveSettings } from "$lib/app.svelte";
  import { analyse, loadLexicon, warm, rhymeTarget, type Line } from "$lib/lyrics/rhyme";
  import type { Lang } from "$lib/lyrics/phon";
  import RhymeLines from "./words/RhymeLines.svelte";
  import RhymePicker from "./words/RhymePicker.svelte";
  import { useSong } from "./song.svelte";
  import Markdown from "./Markdown.svelte";
  import { mdBody, mdBodyStart, mdTitle } from "./helpers";

  interface Sheet { id: number; name: string; text: string; is_current: number | boolean; revisions: number; position?: number }
  interface Revision { id: number; created_at: number; length: number }
  const song = useSong();
  const songId = Number(song.id);

  let sheets = $state<Sheet[]>([]);
  let at = $state(0);
  let loaded = $state(false);
  let failed = $state("");
  let editing = $state(false);
  let editId = 0;
  let draft = $state("");
  let saveState = $state<"saved" | "saving" | "dirty" | "failed">("saved");
  let born = 0;                         // a set this editor made, still empty: leaving it empty unmakes it
  let box = $state<HTMLTextAreaElement>();
  let landAt: number | null = null;
  let history = $state<Revision[] | null>(null);
  let viewing = $state<{ id: number; text: string; created_at: number } | null>(null);

  const sheet = $derived(sheets[at] as Sheet | undefined);

  // ── rhymes (lib/lyrics): marks under the vowels, rhyme letters, a rhyme picker ──
  /* On or off is remembered per browser. The word lists load the first time it is on;
   * until they have, language is guessed from spelling alone. A line's language can be
   * chosen by hand, remembered by the line's text, so it survives the line moving. */
  const LANG_KEY = "jriter.words.lang";
  /* What is shown, saved with the account (lyrics_view), all on to start. The marks can be
   * underlines or highlights; the structure is each stanza's head and the gutter. */
  type View = { marks: boolean; highlight: boolean; structure: boolean; warnings: boolean; spellcheck: boolean };
  const VIEW_DEFAULT: View = { marks: true, highlight: false, structure: true, warnings: true, spellcheck: false };
  const look = $derived<View>({ ...VIEW_DEFAULT, ...(app.settings.lyrics_view || {}) });
  const rhymes = $derived(look.marks || look.structure || look.warnings);
  /* Languages: shown while the button is held; a quick tap pins them so a line's language
   * can be changed, and another tap unpins. */
  let langsHeld = $state(false);
  let langsPinned = $state(false);
  let pressedAt = 0;
  const showLangs = $derived(langsHeld || langsPinned);
  function langDown() { pressedAt = performance.now(); langsHeld = true; }
  function langUp() {
    if (!langsHeld) return;
    langsHeld = false;
    if (performance.now() - pressedAt < 250) langsPinned = !langsPinned;
  }
  async function flip(key: keyof View) {
    const next = { ...look, [key]: !look[key] };
    app.settings.lyrics_view = next;              // at once; the save follows
    try { await saveSettings({ lyrics_view: next }); } catch { toast("Couldn't save that setting."); }
  }
  let lexReady = $state(0);
  let lexFailed = $state("");
  let forced = $state<Record<string, Lang>>(store.get<Record<string, Lang>>(LANG_KEY, {}) || {});
  /* The picker: which word it rhymes with (line, word), and, from the editor, where a pick
   * goes (`into`: the word at the cursor it replaces, or the cursor itself). */
  type Into = { line: number; at: number; text: string };
  let picking = $state<{ line: Line; word: number; top: number; left: number; inEditor: boolean; into?: Into } | null>(null);
  let wrap = $state<HTMLElement>();
  $effect(() => {
    if (!rhymes || lexReady) return;
    loadLexicon().then(() => {
      lexReady++; lexFailed = "";
      // The first search in a language builds its index (a second or so for Hungarian):
      // done now, while nobody is waiting on it, so the first click is instant.
      const idle = (window as any).requestIdleCallback ?? ((f: () => void) => setTimeout(f, 200));
      idle(() => warm("hu")); idle(() => warm("en"));
    }).catch((e) => { lexFailed = (e as Error).message; });
  });
  /** The rhyme button: rhymes for the word at the cursor while editing; while reading,
   *  for the word under the selection, or else the end of the last line. */
  function rhymeHere() {
    if (editing && !viewing) { rhymeAtCaret(true); box?.focus(); return; }
    const sel = window.getSelection();
    const node = sel?.anchorNode ? (sel.anchorNode.nodeType === 1 ? sel.anchorNode as Element : sel.anchorNode.parentElement) : null;
    let el = node?.closest<HTMLElement>(".rl [data-w]") ?? null;
    if (!el || !wrap?.contains(el)) {
      const rows = wrap?.querySelectorAll<HTMLElement>(".rl .row:not(.blank)");
      const last = rows?.[rows.length - 1];
      const spans = last?.querySelectorAll<HTMLElement>(".text [data-w]");
      el = spans?.[spans.length - 1] ?? null;
    }
    el?.click();
  }
  function force(lineText: string, lang: Lang | null) {
    const next = { ...forced };
    if (lang) next[lineText] = lang; else delete next[lineText];
    forced = next;
    store.set(LANG_KEY, next);
  }
  function openPicker(line: Line, word: number, el: HTMLElement, inEditor = false) {
    if (!wrap) return;
    const box = wrap.getBoundingClientRect(), r = el.getBoundingClientRect();
    picking = { line, word, inEditor, top: r.bottom - box.top + 6, left: Math.max(0, Math.min(r.left - box.left, box.width - 440)) };
  }
  /** The words being edited, read as rhymes (the title line left out). */
  const readDraft = () => analyse(draft.split("\n").map((l, i) => (i === 0 ? "" : l)).join("\n"), { forced });

  /** The rhyme button and Alt+R (smart): works out from the verse's structure which line
   *  the cursor's line should rhyme with, highlights that line's last word and lists its
   *  rhymes; a pick goes where the cursor is. Double-click (not smart): rhymes for the
   *  word under the cursor, and a pick replaces it. */
  function rhymeAtCaret(smart = false) {
    if (!box || !wrap) return;
    const pos = box.selectionStart;
    const before = draft.slice(0, pos);
    const lineNo = before.split("\n").length - 1;
    const col = pos - (before.lastIndexOf("\n") + 1);
    const a = readDraft();
    const here = a.byIndex.get(lineNo);
    const blank = !(draft.split("\n")[lineNo] ?? "").trim();
    const k = here ? here.words.findIndex((w) => col >= w.at && col <= w.at + w.text.length) : -1;
    const into: Into = { line: lineNo, at: k >= 0 ? here!.words[k].at : col, text: k >= 0 ? here!.words[k].text : "" };
    let source: Line | undefined, word = -1;
    if (smart && lineNo > 0) {
      const t = rhymeTarget(a, lineNo, blank);
      source = t != null ? a.byIndex.get(t) : undefined;
      if (source) word = source.words.length - 1;
    }
    if (!source) {
      if (!here) { toast(smart ? "Nothing above to rhyme with yet." : "No word here."); return; }
      source = here; word = k >= 0 ? k : here.words.length - 1;
    }
    const src = source;
    // Under the line being written, so the list doesn't cover it.
    requestAnimationFrame(() => {
      const el = wrap?.querySelector<HTMLElement>(`.under .rl > .row[data-l="${lineNo}"] .text`);
      if (el) openPicker(src, word, el, true);
      if (picking) picking.into = into;
    });
  }
  /** A click outside the open picker: on a word in the editor, rhyme with that one instead
   *  (where the pick goes stays put). Anywhere else closes it. */
  function retarget(e: MouseEvent): boolean {
    if (!picking?.inEditor || !wrap) return false;
    for (const el of wrap.querySelectorAll<HTMLElement>(".under .rl > .row[data-l] [data-w]")) {
      const r = el.getBoundingClientRect();
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) continue;
      const line = readDraft().byIndex.get(Number(el.closest<HTMLElement>(".row")!.dataset.l));
      const w = Number(el.dataset.w);
      if (!line || !line.words[w]) return false;
      picking = { ...picking, line, word: w };
      return true;
    }
    return false;
  }
  /** A pick from the editor's picker: in place of the word at the cursor, or at the cursor. */
  function putInto(into: Into, to: string) {
    picking = null;
    const lines = draft.split("\n");
    const t = lines[into.line] ?? "";
    if (into.text) {
      if (t.slice(into.at, into.at + into.text.length) !== into.text) { toast("That line changed in the meantime, so nothing went in."); return; }
      lines[into.line] = t.slice(0, into.at) + cased(into.text, to) + t.slice(into.at + into.text.length);
    } else {
      const pad = into.at > 0 && !/\s$/.test(t.slice(0, into.at)) ? " " : "";
      lines[into.line] = t.slice(0, into.at) + pad + to + t.slice(into.at);
    }
    draft = lines.join("\n");
    typed();
  }
  /* Keep the case the word had: a capital first letter stays capital. */
  const cased = (from: string, to: string) =>
    from[0] && from[0] === from[0].toUpperCase() && from[0] !== from[0].toLowerCase() ? to[0].toUpperCase() + to.slice(1) : to;
  /** Swap one word of one line for another. `line` counts lines of what the view was given:
   *  the whole draft while editing, the body (below the title) while reading. */
  async function replaceWord(line: number, at: number, from: string, to: string) {
    picking = null;
    if (!sheet) return;
    const text = editing ? draft : sheet.text;
    const offset = editing ? 0 : text.slice(0, mdBodyStart(text)).split("\n").length - 1;
    const lines = text.split("\n");
    const li = line + offset;
    if (lines[li]?.slice(at, at + from.length) !== from) { toast("That line changed in the meantime, so nothing was replaced."); return; }
    lines[li] = lines[li].slice(0, at) + cased(from, to) + lines[li].slice(at + from.length);
    const next = lines.join("\n");
    if (editing) { draft = next; typed(); return; }
    const done = await attempt(() => put(`/api/lyrics/${sheet!.id}/text`, { text: next }));
    if (!done) return;
    const i = sheets.findIndex((s) => s.id === done.sheet.id);
    if (i >= 0) sheets[i] = done.sheet;
    if (done.saved) emit("lyrics:changed", { songId });
    toast(`“${from}” is now “${cased(from, to)}”`);
  }
  const shown = $derived(viewing && sheet ? viewing.text : sheet?.text || "");

  async function load(keep = false) {
    try {
      const data = await get(`/api/songs/${songId}/lyrics`);
      sheets = data.lyrics || [];
      if (!keep) { const c = sheets.findIndex((s) => s.is_current); at = c >= 0 ? c : 0; }
      at = clamp(at, 0, Math.max(0, sheets.length - 1));
      failed = "";
    } catch (e) { if (!loaded) failed = (e as Error).message; }
    loaded = true;
  }
  onMount(() => { load(); });
  // Somebody else changed them (an undo of a guest edit, say), unless a hand is on them.
  onDestroy(on("lyrics:changed", () => {
    if (saveState !== "saved" || document.activeElement === box) return;
    load(true).then(() => { if (sheet && sheet.id === editId && saveState === "saved") { draft = sheet.text; tick().then(grow); } });
  }));

  // ── saving ────────────────────────────────────────────────────────────────
  async function flush() {
    save.cancel();
    const i = sheets.findIndex((s) => s.id === editId);
    if (i < 0 || draft === sheets[i].text) { if (saveState !== "failed") saveState = "saved"; return; }
    const text = draft;
    saveState = "saving";
    const done = await attempt(() => put(`/api/lyrics/${editId}/text`, { text }));
    if (!done) { saveState = "failed"; return; }
    const at2 = sheets.findIndex((s) => s.id === done.sheet.id);
    if (at2 >= 0) sheets[at2] = done.sheet;
    if (draft === text) saveState = "saved"; else { saveState = "dirty"; save(); }
    if (done.saved) emit("lyrics:changed", { songId });
  }
  const save = debounce(() => { flush(); }, 1200);

  function typed() {
    saveState = "dirty";
    save();
    grow();
  }
  function grow() { if (box) size(box); }
  /* The field is exactly as tall as its words (it never scrolls: see the CSS), whichever
   * words it holds: typed ones, a sheet switched to, an older version from the history or
   * back from one. Sized again whenever the text changes and when the width does. */
  function size(node: HTMLTextAreaElement) {
    node.style.height = "auto";
    node.style.height = Math.max(340, node.scrollHeight) + "px";
  }
  function fit(node: HTMLTextAreaElement, _text: string) {
    const again = () => requestAnimationFrame(() => size(node));
    again();
    const seen = new ResizeObserver(again);
    seen.observe(node.parentElement ?? node);
    return { update: again, destroy: () => seen.disconnect() };
  }

  async function edit(e?: MouseEvent, from?: HTMLElement) {
    if (!sheet) return;
    viewing = null;
    landAt = e && from ? offsetOfClick(from, e) : null;
    editId = sheet.id; draft = sheet.text; editing = true; saveState = "saved";
    await tick();
    if (!box) return;
    grow(); box.focus();
    const pos = clamp(landAt ?? box.value.length, 0, box.value.length);
    box.setSelectionRange(pos, pos);
  }

  /* Where in the written text a click on the drawn text landed. Which block was clicked
   * gives the line exactly; where in the line comes from the caret hit test, and only when
   * the block drew the line unchanged (a heading or emphasis has fewer characters on
   * screen than in the text). Those land at the start of their line. */
  function offsetOfClick(body: HTMLElement, event: MouseEvent): number | null {
    const source = sheet?.text || "";
    if (!source) return null;
    const doc = document as Document & {
      caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
      caretRangeFromPoint?: (x: number, y: number) => Range | null;
    };
    let node: Node | null = null; let into = 0;
    if (doc.caretPositionFromPoint) {
      const p = doc.caretPositionFromPoint(event.clientX, event.clientY);
      if (p) { node = p.offsetNode; into = p.offset; }
    } else if (doc.caretRangeFromPoint) {
      const r = doc.caretRangeFromPoint(event.clientX, event.clientY);
      if (r) { node = r.startContainer; into = r.startOffset; }
    }
    let from: Node | null = node && body.contains(node) ? node : (event.target as Node);
    if (from && from.nodeType === 3) from = from.parentElement;
    const holder = (from as HTMLElement | null)?.closest?.("[data-l]") as HTMLElement | null;
    if (!holder || !body.contains(holder)) return null;
    const line = Number(holder.dataset.l);
    const start = mdBodyStart(source);
    const lines = source.slice(start).split("\n");
    if (!Number.isInteger(line) || line < 0 || line >= lines.length) return null;
    let pos = start;
    for (let i = 0; i < line; i++) pos += lines[i].length + 1;
    if (holder.textContent !== lines[line]) return pos;
    if (!node || !holder.contains(node)) return pos;
    const walker = document.createTreeWalker(holder, NodeFilter.SHOW_TEXT);
    let before = 0; let seen: Node | null;
    while ((seen = walker.nextNode())) {
      if (seen === node) return pos + before + into;
      before += (seen.textContent || "").length;
    }
    return pos;
  }

  async function done() {
    if (!editing) return;
    await flush();
    editing = false;
    // A set made by a click that was then left empty never held anything: unmake it.
    if (born === editId && !draft.trim()) {
      born = 0;
      await attempt(() => del(`/api/lyrics/${editId}`));
      await load();
      emit("lyrics:changed", { songId });
      return;
    }
    born = 0;
    history = null;
  }
  function onblur() {
    // Saves, and stays open: a blur is the window going away as often as it is somebody
    // clicking elsewhere, and neither should end the editing. Closing is Esc or Done.
    if (editing) flush();
  }
  const flushNow = () => { if (editing) flush(); };
  onDestroy(() => { flushNow(); save.cancel(); });

  // ── sets ──────────────────────────────────────────────────────────────────
  async function go(index: number) {
    if (editing) await flush();
    at = clamp(index, 0, sheets.length - 1);
    viewing = null; history = null;
  }

  async function addSheet(text = "") {
    if (editing) await flush();
    const made = await attempt(() => post(`/api/songs/${songId}/lyrics`, text ? { text } : {}));
    if (!made) return null;
    await load(true);
    const i = sheets.findIndex((s) => s.id === made.sheet.id);
    at = i < 0 ? sheets.length - 1 : i;
    viewing = null; history = null;
    emit("lyrics:changed", { songId });
    return made.sheet as Sheet;
  }
  async function writeNew() {
    const made = await addSheet();
    if (made) { born = made.id; edit(); }
  }
  async function makeCurrent(s: Sheet) {
    if (s.is_current) return;
    sheets = sheets.map((x) => ({ ...x, is_current: x.id === s.id ? 1 : 0 }));
    if (!(await attempt(() => post(`/api/lyrics/${s.id}/current`), "Made current"))) await load(true);
    emit("lyrics:changed", { songId });
  }
  async function remove(s: Sheet) {
    if (sheets.length < 2) return;
    if (editing) await flush();
    // Gone from the pager at once; the server only hears when the Undo toast runs out.
    const index = sheets.findIndex((x) => x.id === s.id);
    const before = sheets, wasAt = at;
    sheets = sheets.filter((x) => x.id !== s.id);
    at = clamp(index - 1 < 0 ? 0 : index - 1, 0, sheets.length - 1);
    history = null; viewing = null;
    deleteSoon(`sheet:${s.id}`, `Deleted “${s.name}”`, () => del(`/api/lyrics/${s.id}`), {
      restore: () => { sheets = before; at = wasAt; },
      after: () => emit("lyrics:changed", { songId }),
    });
  }

  // ── history ───────────────────────────────────────────────────────────────
  async function toggleHistory() {
    if (!sheet) return;
    if (history) { history = null; viewing = null; return; }
    if (editing) await flush();
    const data = await attempt(() => get(`/api/lyrics/${sheet!.id}/history`));
    if (data) history = data.revisions || [];
  }
  async function view(r: Revision) {
    if (history && history[0]?.id === r.id) { viewing = null; return; }
    if (editing) await flush();
    const data = await attempt(() => get(`/api/lyric-revisions/${r.id}`));
    if (data) viewing = data.revision;
  }
  async function restore() {
    if (!viewing || !sheet) return;
    const r = await attempt(() => post(`/api/lyrics/${sheet!.id}/restore`, { revision_id: viewing!.id }));
    if (!r) return;
    toast(r.saved ? "Restored" : r.message);
    viewing = null; history = null;
    await load(true);
    emit("lyrics:changed", { songId });
  }

  const menuFor = (s: Sheet): MenuItem[] => [
    { label: "Edit", icon: "edit", run: () => { at = sheets.findIndex((x) => x.id === s.id); edit(); } },
    { label: s.is_current ? "Current" : "Make current", icon: "star", disabled: !!s.is_current, run: () => makeCurrent(s) },
    { label: `History${s.revisions > 1 ? ` (${s.revisions})` : ""}`, icon: "history", disabled: s.revisions < 2, run: toggleHistory },
    { label: "Add another set of words", icon: "plus", run: writeNew },
    { divider: true },
    { label: "Copy the words", icon: "copy", run: () => copyText(s.text || "", "Copied.") },
    { divider: true },
    { label: "Delete these words", icon: "trash", danger: true, disabled: sheets.length < 2, run: () => remove(s) },
  ];

  // ── always editing: the text field is the words ──────────────────────────
  /* There is no reading view to click out of: the words are always the text field, with
   * the rhyme marks, letters and warnings drawn alongside it. Switching sets saves the one
   * being left and puts the next one in. */
  $effect(() => {
    const s = sheet;
    if (!s || viewing || editId === s.id) return;
    editId = s.id; draft = s.text; editing = true; saveState = "saved";
    tick().then(grow);
  });
</script>

<svelte:window onbeforeunload={flushNow} />
<svelte:document onvisibilitychange={() => { if (document.visibilityState === "hidden") flushNow(); }} />

<section class="words col">
  <div class="section-head">
    <h2>Words</h2>
    {#if sheets.length > 1}
      <!-- Which set, and the way to the others: arrows either side of the count. -->
      <span class="pager" role="group" aria-label="Sets of words">
        <button class="icon-btn sm" aria-label="Previous set" disabled={at === 0} onclick={() => go(at - 1)}><Icon name="chev-left" size={16} /></button>
        <span class="tag num">{at + 1} of {sheets.length}</span>
        <button class="icon-btn sm" aria-label="Next set" disabled={at >= sheets.length - 1} onclick={() => go(at + 1)}><Icon name="chev-right" size={16} /></button>
        {#if sheet}<button class="icon-btn sm danger-ghost" aria-label="Delete this set" title="Delete this set" onclick={() => remove(sheet!)}><Icon name="trash" size={15} /></button>{/if}
      </span>
    {/if}
    <span class="grow"></span>
    {#if sheet}<button class="btn sm ghost" onclick={writeNew}><Icon name="plus" size={14} />New alternative</button>{/if}
  </div>

  {#if !loaded}
    <div class="card pad"><div class="sk" style="height:24px;width:40%"></div><div class="sk" style="height:120px;margin-top:16px"></div></div>
  {:else if failed}
    <div class="notice bad">{failed}<button class="btn sm" onclick={() => load()}>Try again</button></div>
  {:else if !sheet}
    <button class="card pad empty-card" onclick={writeNew}>
      <Icon name="words" size={22} />
      <span>Click and start writing. The first line is the title. You can keep several versions, so a rewrite never kills the old one.</span>
    </button>
  {:else}
    <article class="card sheet" class:reading={!!viewing} use:contextMenu={() => menuFor(sheet!)} bind:this={wrap}>
      {#if picking}
        {@const w = picking.line.words[picking.word]}
        <RhymePicker word={w} top={picking.top} left={picking.left} onoutside={retarget}
                     into={picking.into ? (picking.into.text ? `replaces “${picking.into.text}”` : "goes in at the cursor") : ""}
                     onpick={(to) => (picking!.into ? putInto(picking!.into, to) : replaceWord(picking!.line.index, w.at, w.text, to))}
                     onclose={() => (picking = null)} />
      {/if}
      {#if rhymes && lexFailed}<div class="notice small">{lexFailed} Going off spelling only for now.</div>{/if}
      <div class="titlebar">
        <h3 class="ttl">{mdTitle(viewing ? viewing.text : draft, sheet.name)}</h3>
        {#if sheet.is_current}<span class="tag">Current</span>{/if}
      </div>

      <div class="bodyrow">
        <!-- The words: a text field whose own letters are invisible, over a layer that draws
             them, so the marks, the dimmed asides and the rhyme tints sit exactly under
             what is typed. The gutter at the right of that layer carries the rest. -->
        <div class="editwrap">
          <div class="under">
            <RhymeLines text={viewing ? viewing.text : draft} mode="edit" skipFirst {forced} ready={lexReady} show={look} langs={showLangs}
                        target={picking?.inEditor ? { line: picking.line.index, word: picking.word } : null}
                        onreplace={replaceWord} onforce={force} />
          </div>
          {#if viewing}
            <textarea class="edit" readonly value={viewing.text} use:fit={viewing.text} aria-label="The words, as they were"></textarea>
          {:else}
            <textarea class="edit" bind:this={box} bind:value={draft} use:fit={draft} oninput={typed} onblur={onblur} spellcheck={look.spellcheck}
                      aria-label="The words" placeholder={"Name it on the first line\n\nThen the words."}
                      ondblclick={() => rhymeAtCaret(false)}
                      onkeydown={(e) => { if (e.altKey && e.code === "KeyR") { e.preventDefault(); rhymeAtCaret(true); return; } if (e.key === "Escape") { e.preventDefault(); flush(); box?.blur(); } }}></textarea>
          {/if}
        </div>

        <!-- What the rhyme tools show, as icons that light up when on; it follows you down
             the words. The rhyme button, set apart, lists rhymes for wherever the cursor is. -->
        <div class="toolcol">
          <div class="rtools" role="toolbar" aria-label="Rhyme tools" aria-orientation="horizontal">
            <button class="rt" class:on={look.marks} aria-pressed={look.marks} onclick={() => flip("marks")} title="Rhyme underlines"><Icon name="underline" size={17} /></button>
            {#if look.marks}
              <button class="rt" transition:slide={{ duration: 160, axis: "x" }} class:on={look.highlight} aria-pressed={look.highlight} onclick={() => flip("highlight")} title="Highlight instead of underline"><Icon name="highlight" size={17} /></button>
            {/if}
            <button class="rt" class:on={look.structure} aria-pressed={look.structure} onclick={() => flip("structure")} title="Structure: rhyme scheme and syllables"><Icon name="structure" size={17} /></button>
            <button class="rt" class:on={look.warnings} aria-pressed={look.warnings} onclick={() => flip("warnings")} title="Warnings for lines that break the scheme"><Icon name="warning" size={17} /></button>
            <button class="rt" class:on={showLangs} aria-pressed={showLangs} title="Languages: hold to show, tap to pin"
                    onpointerdown={langDown} onpointerup={langUp} onpointerleave={langUp} onpointercancel={langUp}
                    onkeydown={(e) => { if ((e.key === " " || e.key === "Enter") && !e.repeat) { e.preventDefault(); langDown(); } }}
                    onkeyup={(e) => { if (e.key === " " || e.key === "Enter") langUp(); }}><Icon name="globe" size={17} /></button>
            <button class="rt" class:on={look.spellcheck} aria-pressed={look.spellcheck} onclick={() => flip("spellcheck")} title="Spellcheck"><Icon name="spell" size={17} /></button>
            <span class="rsep" aria-hidden="true"></span>
            <button class="rt go" onclick={rhymeHere} title="Rhymes at the cursor (Alt+R, or double-click a word)"><Icon name="rhyme" size={17} /></button>
          </div>
        </div>
      </div>

      <div class="foot">
        <span class="faint state" aria-live="polite">
          {viewing ? "An older version" : saveState === "saved" ? "Saved" : saveState === "saving" ? "Saving…" : saveState === "dirty" ? "Not saved yet" : "Didn't save. Trying again."}
        </span>
        <button class="btn sm ghost" class:on={!!history} onclick={toggleHistory}><Icon name="history" size={14} />History{#if sheet.revisions > 1}<span class="tag">{sheet.revisions}</span>{/if}</button>
        {#if !sheet.is_current && sheets.length > 1}<button class="btn sm ghost" onclick={() => makeCurrent(sheet!)}><Icon name="star" size={14} />Make current</button>{/if}
        <span class="grow"></span>
        <button class="icon-btn sm" aria-label="More" onclick={(e) => showMenu(menuFor(sheet!), { anchor: e.currentTarget })}><Icon name="more" size={18} /></button>
      </div>
    </article>

    {#if viewing}
      <div class="notice accent">
        <span class="grow">Looking at the words from <b>{date(viewing.created_at)}</b>. Nothing has changed.</span>
        <button class="btn sm" onclick={restore}>Restore these</button>
        <button class="btn sm ghost" onclick={() => (viewing = null)}>Back to now</button>
      </div>
    {/if}

    {#if history}
      <div class="card hist list ruled">
        {#each history as r, i (r.id)}
          <button class="item" class:on={viewing ? viewing.id === r.id : i === 0} onclick={() => view(r)}>
            <span class="grow num">{date(r.created_at)}</span>
            <span class="faint">{r.length} characters</span>
            {#if i === 0}<span class="tag">now</span>{/if}
          </button>
        {/each}
      </div>
    {/if}
  {/if}
</section>

<style>
  .pad { padding: var(--s5); }
  .empty-card { display: flex; gap: var(--s3); align-items: center; text-align: left; color: var(--text-2); width: 100%; }

  .sheet { flex: 1 1 auto; min-width: 0; padding: var(--s5); display: flex; flex-direction: column; gap: var(--s3); }
  .sheet.reading { border-color: var(--accent-line); }
  .titlebar { display: flex; align-items: center; gap: var(--s3); }
  .ttl { flex: 1 1 auto; min-width: 0; overflow-wrap: anywhere; }

  .edit {
    width: 100%; min-height: 220px; resize: none; background: transparent; border: 0; outline: 0;
    font: 500 var(--t-lg)/1.85 var(--font); color: var(--text); padding: 0;
    white-space: pre-wrap; overflow-wrap: break-word; display: block;
  }
  /* The marks under the editor: the same text in the same box, invisible, so its vowel
     marks and rhyme tints land under the letters typed above them. */
  .editwrap { position: relative; flex: 1 1 auto; min-width: 0; --gw: calc(var(--s8) + var(--s7)); }
  .bodyrow { display: flex; align-items: flex-start; gap: var(--s3); }
  /* The tool column rides along as you scroll the words. */
  .toolcol { flex: none; position: sticky; top: var(--below-tabs, var(--s3)); align-self: flex-start; }
  .pager { display: inline-flex; align-items: center; gap: 2px; }
  .danger-ghost:hover { color: var(--bad); }
  /* The rhyme tools: a column of icons at the top right of the sheet. Coloured when on,
     plain when off. The words keep clear of it. */
  .rtools {
    display: flex; flex-direction: column; gap: var(--s1); padding: var(--s1); border-radius: var(--r-md);
    background: rgba(0, 0, 0, 0.28); border: 1px solid var(--line);
  }
  .rt { width: 32px; height: 32px; display: grid; place-items: center; border-radius: var(--r-sm); color: var(--text-3); transition: color var(--fast), background var(--fast); }
  .rt:hover { color: var(--text); background: var(--hover); }
  .rt.on { color: var(--accent-text); background: var(--accent-soft); }
  .rt.go { color: var(--text-2); }
  .rt.go:hover { color: var(--accent-text); }
  .rsep { height: 1px; margin: var(--s1) var(--s2); background: var(--line-2); }

  /* The layer that draws the words, under the field that takes the typing. The field's
     own letters are invisible (the layer draws them, with marks and dimmed asides); its
     caret and selection are the field's, so typing feels exactly like a text field. */
  .under { position: absolute; inset: 0; pointer-events: none; }
  .under :global(.rl) { font: 500 var(--t-lg)/1.85 var(--font); }
  /* It grows to fit and never scrolls: a field that scrolls is its own touch region, and the
     browser would take a sideways swipe across the words (which should pull the drawer)
     for itself. pan-y: vertical drags scroll the page, sideways ones are the page's. */
  .editwrap .edit { position: relative; z-index: 1; width: calc(100% - var(--gw)); margin-left: var(--gw); color: transparent; caret-color: var(--text);
    overflow: hidden; touch-action: pan-y; }
  .editwrap .edit::selection { background: color-mix(in srgb, var(--accent) 35%, transparent); color: transparent; }
  .editwrap .edit::placeholder { color: var(--text-3); }
  .sheet { position: relative; }
  .foot { display: flex; align-items: center; gap: var(--s3); flex-wrap: wrap; }
  .state { min-width: 9ch; }
  .hist { padding: var(--s2); }
  .hist .item { width: 100%; text-align: left; cursor: pointer; }
  @media (max-width: 640px) { .sheet { padding: var(--s4); } .editwrap { --gw: calc(var(--s8) + var(--s5)); } }
  /* Wide screens: the lines stay one readable column; the tools are a row above them, the
     same as on a phone. */
  .editwrap { max-width: calc(600px + var(--gw)); }
  /* A phone: the tools are a row pinned under the song's tabs, so the words get the
     whole width instead of losing a column to them. */
  .bodyrow { flex-direction: column; align-items: stretch; gap: var(--s2); }
  .toolcol { order: -1; z-index: 5; align-self: flex-start; }
  .rtools { flex-direction: row; background: color-mix(in srgb, var(--bg, #000) 94%, transparent); }
  .rsep { width: 1px; height: auto; margin: var(--s2) var(--s1); }
  :global(html[data-narrow]) .toolcol { align-self: stretch; }
  :global(html[data-narrow]) .rtools { justify-content: space-between; box-shadow: 0 6px 18px rgba(0, 0, 0, 0.45); }
  :global(html[data-narrow]) .rt { width: 36px; height: 36px; }
</style>
