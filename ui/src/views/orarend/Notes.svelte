<!-- What I keep about one subject: how many times I was not there, and pages of notes.
     Everything saves as it is pressed or typed, because a note lost by closing the sheet
     the wrong way is worse than no note.

     Keyed on the subject's name: "Webprogramozás Ea+Gy" twice a week is one subject with
     one set of notes. Notes and absences are each account's own, even on somebody
     else's week. -->
<script lang="ts">
  import { onDestroy } from "svelte";
  import { get, post, put, del, attempt } from "$lib/api";
  import { debounce } from "$lib/util";
  import { toast } from "$lib/toast.svelte";
  import Icon from "$ui/Icon.svelte";
  import Md from "./Md.svelte";
  import type { Notes } from "./week";

  let { subject }: { subject: string } = $props();

  const where = () => "/api/orarend/notes?subject=" + encodeURIComponent(subject);
  let notes = $state<Notes | null>(null);
  let failed = $state(false);
  let at = $state(0);
  let status = $state<"" | "dirty" | "saving" | "saved" | "failed">("");
  let shown = $state("");                 // what the preview draws, on the save's own beat
  const dirty = new Set<number>();

  const page = $derived(notes?.pages[at]);

  function look() { shown = notes?.pages[at]?.text ?? ""; }

  async function load() {
    try { notes = await get<Notes>(where()); failed = false; look(); }
    catch { failed = true; }
  }
  load();

  /* Typing saves itself a moment after the typing stops: not on every keystroke, which is
   * a write per character, and not only on close, because the sheet can be dismissed with
   * Escape, with the backdrop, or by the phone going away. The preview follows the same
   * beat: re-rendering under the caret on every letter is what makes a text box slow. */
  async function flush() {
    if (!notes || !dirty.size) return;
    const ids = [...dirty];
    dirty.clear();
    status = "saving";
    const done = await Promise.all(ids.map((id) => {
      const text = notes!.pages.find((p) => p.id === id)?.text ?? "";
      return attempt(() => put(`/api/orarend/notes/pages/${id}`, { text }));
    }));
    if (done.some((d) => d === null)) { ids.forEach((id) => dirty.add(id)); status = "failed"; }
    else status = dirty.size ? "dirty" : "saved";
  }
  const later = debounce(() => { look(); flush(); }, 600);

  function typed(e: Event) {
    const p = page;
    if (!p) return;
    p.text = (e.target as HTMLTextAreaElement).value;
    dirty.add(p.id);
    status = "dirty";
    later();
  }

  const hidden = () => { if (document.hidden) later.now(); };
  document.addEventListener("visibilitychange", hidden);
  onDestroy(() => {
    document.removeEventListener("visibilitychange", hidden);
    later.cancel();
    flush();
  });

  async function tick(n: number) {
    if (!notes) return;
    // Three boxes are one number: ticking the second ticks the first, and pressing the
    // last one ticked unticks it, so the row is its own undo.
    const want = n === notes.absences ? n - 1 : n;
    const was = notes.absences;
    notes.absences = want;
    const got = await attempt(() => put<Notes>("/api/orarend/notes", { subject, absences: want }));
    if (!got && notes) notes.absences = was;
  }

  async function addPage() {
    await flush();
    const got = await attempt(() => post<Notes>("/api/orarend/notes/pages", { subject, text: "" }));
    if (!got) return;
    notes = got;
    at = got.pages.length - 1;
    look();
  }

  async function dropPage() {
    if (!notes || !page) return;
    await flush();
    const text = page.text, id = page.id;
    dirty.delete(id);
    const got = await attempt(() => del<Notes>(`/api/orarend/notes/pages/${id}`));
    if (!got) return;
    notes = got;
    at = Math.min(at, Math.max(0, got.pages.length - 1));
    look();
    // Thrown away at once, and put back from the toast. The text goes back on the end.
    toast("Oldal törölve", "", {
      label: "Visszavonás",
      run: async () => {
        const back = await attempt(() => post<Notes>("/api/orarend/notes/pages", { subject, text }));
        if (back) { notes = back; at = back.pages.length - 1; look(); }
      },
    });
  }

  function turn(by: number) {
    if (!notes) return;
    flush();
    at = Math.max(0, Math.min(notes.pages.length - 1, at + by));
    look();
  }

  const SAYS = { dirty: "Mentésre vár", saving: "Mentés…", saved: "Mentve", failed: "Nem sikerült menteni", "": "" };
</script>

<div class="notes">
  {#if failed}
    <p class="faint">A jegyzetek nem töltődtek be. <button class="btn sm ghost" onclick={load}>Újra</button></p>
  {:else if !notes}
    <div class="sk" style="height:26px;width:60%"></div>
    <div class="sk" style="height:110px;margin-top:12px"></div>
  {:else}
    <div class="miss" role="group" aria-label="Hiányzások">
      {#each Array.from({ length: notes.allowed }, (_, i) => i) as i}
        <button type="button" class="box" class:on={i < notes.absences} aria-pressed={i < notes.absences}
                aria-label="{i + 1}. hiányzás" onclick={() => tick(i + 1)}>
          {#if i < notes!.absences}<Icon name="check" size={14} stroke={2.4} />{/if}
        </button>
      {/each}
      <span class="said num">{notes.absences} / {notes.allowed} hiányzás</span>
    </div>

    <div class="head">
      <span>Jegyzetek</span>
      <span class="state" class:bad={status === "failed"} aria-live="polite">{SAYS[status]}</span>
      <span class="grow"></span>
      <button type="button" class="btn sm" onclick={addPage}>Új oldal</button>
    </div>

    {#if !notes.pages.length}
      <p class="faint none">Nincs még jegyzet.</p>
    {:else if page}
      <div class="bar">
        <button type="button" class="icon-btn sm" aria-label="Előző oldal" disabled={at === 0} onclick={() => turn(-1)}><Icon name="chev-left" size={16} /></button>
        <span class="at num">{at + 1} / {notes.pages.length}</span>
        <button type="button" class="icon-btn sm" aria-label="Következő oldal" disabled={at >= notes.pages.length - 1} onclick={() => turn(1)}><Icon name="chev-right" size={16} /></button>
        <span class="grow"></span>
        <button type="button" class="btn sm ghost" onclick={dropPage}>Oldal törlése</button>
      </div>
      {#key page.id}
        <textarea class="field" rows="9" value={page.text} oninput={typed}
                  placeholder="Markdown. Amit ide írsz, mentődik."></textarea>
      {/key}
      {#if shown.trim()}<div class="read"><Md source={shown} /></div>{/if}
    {/if}
  {/if}
</div>

<style>
  .notes { margin-top: var(--s4); padding-top: var(--s4); border-top: 1px solid var(--line); }
  .miss { display: flex; align-items: center; gap: var(--s2); }
  .box {
    width: 28px; height: 28px; display: grid; place-items: center;
    border: 1px solid var(--line-2); border-radius: var(--r-sm);
    background: var(--surface-2); color: var(--accent-ink);
    transition: background var(--fast), border-color var(--fast), transform var(--fast);
  }
  .box:hover { border-color: var(--accent-line); }
  .box:active { transform: scale(0.94); }
  .box.on { background: var(--accent); border-color: transparent; }
  .said { margin-left: var(--s2); font-size: var(--t-sm); color: var(--text-3); }
  .head, .bar { display: flex; align-items: center; gap: var(--s2); margin: var(--s4) 0 var(--s2); font-size: var(--t-sm); color: var(--text-3); }
  .bar { margin-top: 0; }
  .state { font-size: var(--t-xs); color: var(--text-3); }
  .state.bad { color: var(--bad); }
  .at { min-width: 42px; text-align: center; color: var(--text-2); }
  .none { font-size: var(--t-md); }
  textarea.field { width: 100%; resize: vertical; line-height: 1.6; }
  /* The markdown under the box it was typed in rather than behind a switch: a preview you
     have to ask for is one nobody looks at. */
  .read { margin-top: var(--s3); padding-top: var(--s3); border-top: 1px dashed var(--line); }
</style>
