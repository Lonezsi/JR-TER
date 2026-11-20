<!-- Giving one song to one person. Deliberately a sheet with a name in it rather than a link
     you copy: a link that works for whoever holds it is a credential in a chat window; this
     names an account on this server, so a share has somebody's name on it and can be taken
     back from them by name. The link is there for somebody with no account yet. -->
<script lang="ts">
  import { untrack } from "svelte";
  import Dropdown from "$ui/Dropdown.svelte";
  import { del, attempt } from "$lib/api";
  import { emit } from "$lib/bus";

  interface Person { handle: string; name: string }
  interface Share { id: number; to_name: string }
  let { people, already, close }: {
    people: Person[]; already: Share[]; close: (value?: unknown) => void;
  } = $props();

  let handle = $state("");
  let asName = $state("");
  let rows = $state<Share[]>([]);
  rows = untrack(() => [...already]);

  async function revoke(row: Share) {
    const done = await attempt(() => del(`/api/shares/${row.id}`), "Taken back. What they made stays theirs.");
    if (!done) return;
    rows = rows.filter((r) => r.id !== row.id);
    emit("shares:changed");
  }
</script>

<div class="col">
  <label class="label">Who
    <!-- First, and the only option until somebody else has an account: a link needs
         neither the other person to be here nor to have told you their handle. -->
    <Dropdown bind:value={handle} label="Who" block
              options={[{ value: "", label: "Anyone with the link" }, ...people.map((p) => ({ value: p.handle, label: `${p.name} (${p.handle})` }))]} />
  </label>
  <label class="label">What to call them on this
    <input class="field" bind:value={asName} placeholder="Jozsef" maxlength="60" />
  </label>
  <p class="hint">Given a name, anything they edit is saved as "the original, edited by that name",
    so you can tell whose is whose later. Leave it empty and their copies are simply theirs.</p>
  {#if rows.length}
    <div class="col tight">
      <span class="eyebrow">Already shared with</span>
      {#each rows as row (row.id)}
        <div class="row">
          <span class="grow truncate">{row.to_name}</span>
          <button class="btn sm ghost" onclick={() => revoke(row)}>Take it back</button>
        </div>
      {/each}
    </div>
  {/if}
  <div class="foot">
    <button class="btn ghost" onclick={() => close(null)}>Cancel</button>
    <button class="btn primary" onclick={() => close({ handle, as_name: asName.trim() })}>Share it</button>
  </div>
</div>

<style>
  .tight { gap: var(--s2); }
  .foot { display: flex; justify-content: flex-end; gap: var(--s2); }
</style>
