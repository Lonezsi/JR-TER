<!-- Making or changing one class, as the body of a sheet. Its own buttons: a sheet's
     built-in confirm only knows a list of fields, and this one wants a datalist, rows, and
     an answer next to the field it is about instead of a toast and a reopened form.

     The server checks everything again and that is the refusal that counts; this one is
     here so an obvious slip is answered without a round trip. -->
<script lang="ts">
  import { untrack } from "svelte";
  import Dropdown from "$ui/Dropdown.svelte";
  import { DAYS, KIND_SAID, NEW, type ClassValues, type Entry } from "./week";

  let { entry, people, close }: {
    entry: Entry | null; people: string[]; close: (value?: ClassValues | null) => void;
  } = $props();

  const making = untrack(() => !entry);
  const from = untrack(() => entry ?? NEW);
  let v = $state({
    name: from.name || "", day: String(from.day ?? 0), at: from.at, to: from.to,
    kind: from.kind || "gy", whose: from.whose || "me", where: String(from.where || ""),
    teacher: String(from.teacher || ""), group: String(from.group || ""), code: String(from.code || ""),
    skip: !!from.skip,
  });
  let problem = $state("");

  function submit(e?: Event) {
    e?.preventDefault();
    if (!v.name.trim()) { problem = "A tárgy neve kell."; return; }
    if (!v.at || !v.to || v.to <= v.at) { problem = "A vége a kezdés előtt van."; return; }
    close({ ...v, name: v.name.trim(), day: Number(v.day) });
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<form onsubmit={submit} onkeydown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) submit(e); }}>
  <label class="label">Tárgy
    <input class="field" bind:value={v.name} placeholder="Analízis II. Ea" required oninput={() => (problem = "")} />
  </label>
  <div class="row3">
    <label class="label">Nap
      <Dropdown bind:value={v.day} options={DAYS.map((said, i) => ({ value: String(i), label: said }))} label="Nap" block />
    </label>
    <label class="label">Kezdés<input class="field" type="time" bind:value={v.at} required oninput={() => (problem = "")} /></label>
    <label class="label">Vége<input class="field" type="time" bind:value={v.to} required oninput={() => (problem = "")} /></label>
  </div>
  <div class="row3 two">
    <label class="label">Típus
      <Dropdown bind:value={v.kind} options={Object.keys(KIND_SAID).map((k) => ({ value: k, label: KIND_SAID[k] }))} label="Típus" block />
    </label>
    <label class="label">Kinek
      <input class="field" bind:value={v.whose} list="tt-people" autocomplete="off" />
      <datalist id="tt-people">
        {#each ["me", ...people] as n}<option value={n}></option>{/each}
      </datalist>
    </label>
  </div>
  <label class="label">Helyszín<input class="field" bind:value={v.where} placeholder="Déli Tömb 0-821" /></label>
  <label class="label">Oktató<input class="field" bind:value={v.teacher} /></label>
  <div class="row3 two">
    <label class="label">Kurzus<input class="field" bind:value={v.group} inputmode="numeric" /></label>
    <label class="label">Tárgykód<input class="field" bind:value={v.code} placeholder="IP-18AB1E" /></label>
  </div>
  <label class="check"><input type="checkbox" bind:checked={v.skip} /><span>Nem járok rá</span></label>

  {#if problem}<div class="notice bad" role="alert">{problem}</div>{/if}

  <div class="foot">
    <button type="button" class="btn ghost" onclick={() => close(null)}>Mégse</button>
    <button type="submit" class="btn primary">{making ? "Hozzáadás" : "Mentés"}</button>
  </div>
</form>

<style>
  form { display: flex; flex-direction: column; gap: var(--s3); }
  .row3 { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--s2); }
  .row3.two { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  @media (max-width: 480px) { .row3 { grid-template-columns: 1fr 1fr; } .row3 > :first-child { grid-column: 1 / -1; } }
  .check { display: flex; align-items: center; gap: 10px; font-weight: 600; cursor: pointer; }
  .check input { width: 18px; height: 18px; accent-color: var(--accent); }
  .foot { display: flex; justify-content: flex-end; gap: var(--s2); margin-top: var(--s2); }
  @media (max-width: 640px) { .foot { flex-direction: column-reverse; } .foot .btn { width: 100%; } }
</style>
