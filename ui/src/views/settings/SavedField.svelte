<!-- A field that saves itself when you leave it or press Enter, and says so. Escape puts
     back what was saved. What was typed is never dropped: a save that fails leaves the
     text where it is with a way to try again, and leaving the screen mid-edit saves on
     the way out. -->
<script lang="ts">
  import { onDestroy } from "svelte";
  import Icon from "$ui/Icon.svelte";
  import { toast } from "$lib/toast.svelte";

  let { value, save, label, placeholder = "", type = "text", min, max, maxlength, mono = false }: {
    value: string | number | undefined;
    save: (next: string) => Promise<unknown>;
    label: string; placeholder?: string; type?: "text" | "number";
    min?: number; max?: number; maxlength?: number; mono?: boolean;
  } = $props();

  let draft = $state("");
  let phase = $state<"" | "saving" | "saved" | "failed">("");
  let editing = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const saved = $derived(String(value ?? ""));

  // Follows what is stored, except while somebody is typing in it.
  $effect(() => { const now = saved; if (!editing && phase !== "failed") draft = now; });

  async function commit() {
    if (String(draft) === saved) { if (phase === "failed") phase = ""; return; }
    phase = "saving";
    try {
      await save(String(draft));
      phase = "saved";
      clearTimeout(timer);
      timer = setTimeout(() => { if (phase === "saved") phase = ""; }, 1600);
    } catch (e) {
      phase = "failed";
      toast((e as Error).message || "That did not save.", "bad");
    }
  }

  function onkey(e: KeyboardEvent) {
    if (e.key === "Enter") { e.preventDefault(); (e.currentTarget as HTMLElement).blur(); }
    if (e.key === "Escape" && String(draft) !== saved) { e.stopPropagation(); draft = saved; phase = ""; }
  }

  onDestroy(() => {
    clearTimeout(timer);
    if (editing && String(draft) !== saved) save(String(draft)).catch((e) => toast((e as Error).message, "bad"));
  });
</script>

<span class="saved-field">
  <input class="field" class:mono {type} {min} {max} {maxlength} {placeholder} aria-label={label}
         autocomplete="off" spellcheck="false" bind:value={draft}
         onfocus={() => (editing = true)} onblur={() => { editing = false; commit(); }} onkeydown={onkey} />
  <span class="mark" role="status" aria-live="polite">
    {#if phase === "saving"}<span class="spinner" title="Saving"></span>
    {:else if phase === "saved"}<span class="ok" title="Saved"><Icon name="check" size={16} /></span><span class="sr-only">Saved</span>
    {:else if phase === "failed"}
      <button class="icon-btn sm bad" title="Not saved. Try again" aria-label="Not saved. Try again" onclick={commit}>
        <Icon name="refresh" size={15} />
      </button>
    {/if}
  </span>
</span>

<style>
  .saved-field { display: flex; align-items: center; gap: var(--s2); width: 100%; min-width: 0; }
  .field { min-width: 0; }
  .field.mono { font-family: var(--mono); font-size: var(--t-sm); }
  /* Always there, so the field does not change width when the mark appears. */
  .mark { flex: none; width: 30px; height: 30px; display: grid; place-items: center; }
  .ok { color: var(--good); animation: pop 240ms var(--pop) both; }
  .bad { color: var(--bad); }
</style>
