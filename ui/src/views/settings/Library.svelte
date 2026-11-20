<!-- The library itself: its name, what it takes up, a copy of it, and getting rid of it. -->
<script lang="ts">
  import { get, post, attempt } from "$lib/api";
  import { app, has, saveSettings } from "$lib/app.svelte";
  import { resource } from "$lib/resource.svelte";
  import { sheet } from "$lib/dialog.svelte";
  import { bytes, plural } from "$lib/util";
  import Icon from "$ui/Icon.svelte";
  import Block from "./Block.svelte";
  import Rows from "./Rows.svelte";
  import Trouble from "./Trouble.svelte";
  import SavedField from "./SavedField.svelte";
  import EraseList from "./EraseList.svelte";
  import { takeCopy, bringIn } from "./acts";
  import type { ErasePlan } from "./shapes";

  // Read again whenever a setting changes, so the numbers are not from before an upload.
  const usage = resource(() => get<{ storage?: { bytes: number; files: number };
    summary?: { versions?: { count: number; distinct_files: number } } }>("/api/state"),
    { on: ["settings:changed", "songs:changed", "renders:changed", "versions:changed"] });

  const versions = $derived(usage.data?.summary?.versions);

  async function rename(next: string) {
    await saveSettings({ library_name: next.trim() || "JR!TER" });
  }

  let planning = $state(false);
  async function erase() {
    if (planning) return;
    planning = true;
    const plan = await attempt(() => get<ErasePlan>("/api/export/erase"));
    planning = false;
    if (!plan) return;
    /* Typed, not ticked. A tick here is the same gesture as every other tick on the page,
     * and this one cannot be undone. The name has to match exactly. */
    const said = await sheet<{ confirm: string }>({
      title: "Erase this library",
      sub: "Every song, every render, every lyric. There is no undo and no copy kept.",
      confirm: "Erase it",
      cancel: "Keep it",
      danger: true,
      wide: true,
      body: EraseList,
      props: { plan },
      fields: [{ name: "confirm", label: "Type the library's name to confirm", placeholder: plan.library,
                 required: true }],
    });
    if (!said) return;
    const done = await attempt(() => post("/api/export/erase", { confirm: (said.confirm || "").trim() }));
    if (!done) return;
    // Straight to the library rather than a toast on a Settings page describing a library
    // that is no longer there.
    location.href = "/";
  }
</script>

<div class="stack">
  <Block title="Library">
    <div class="setting stack-m">
      <div class="what">
        <div class="t">Name</div>
        <div class="s">Shown in the sidebar and the browser tab. Also what you type to erase it.</div>
      </div>
      <div class="ctl wide">
        <SavedField label="Library name" value={app.settings.library_name} save={rename} maxlength={80} placeholder="JR!TER" />
      </div>
    </div>
  </Block>

  <Block title="Storage">
    {#if usage.loading && !usage.data}
      <Rows n={2} />
    {:else if usage.error && !usage.data}
      <Trouble message={usage.error} retry={usage.reload} />
    {:else}
      <div class="setting">
        <div class="what">
          <div class="t num">{bytes(usage.data?.storage?.bytes)} in {plural(usage.data?.storage?.files ?? 0, "file")}</div>
          <div class="s">Files are stored once by their contents, so the same render uploaded twice takes one slot.</div>
        </div>
      </div>
      {#if versions}
        <div class="setting">
          <div class="what">
            <div class="t num">{plural(versions.count, "render")}, {plural(versions.distinct_files, "distinct file")}</div>
            <div class="s">The gap is what deduplication saved you.</div>
          </div>
        </div>
      {/if}
    {/if}
  </Block>

  {#if has("export")}
    <Block title="Your data"
           note="Everything is on this machine and nothing is sent anywhere on its own. The terms and the privacy notice say what leaves it, when, and why.">
      <div class="setting">
        <div class="what">
          <div class="t">Take a copy</div>
          <div class="s">Every song, lyric and setting as a zip you can read, plus each song's words as plain text. No passwords or keys.</div>
        </div>
        <div class="ctl">
          <button class="btn sm" onclick={() => takeCopy(false)}><Icon name="download" size={14} /> Words and settings</button>
          <button class="btn sm ghost" onclick={() => takeCopy(true)}>With audio</button>
        </div>
      </div>
      <div class="setting">
        <div class="what">
          <div class="t">Bring a library in</div>
          <div class="s">A copy from here, from another JR!TER, or a guest library. It adds; nothing here is replaced.</div>
        </div>
        <div class="ctl"><button class="btn sm" onclick={() => bringIn()}><Icon name="upload" size={14} /> Choose a file</button></div>
      </div>
      <div class="setting">
        <div class="what">
          <div class="t">Terms and privacy</div>
          <div class="s">Opens in a new tab, so the music keeps playing.</div>
        </div>
        <div class="ctl"><a class="btn sm" href="/legal" target="_blank" rel="noopener"><Icon name="external" size={14} /> Open</a></div>
      </div>
      <div class="setting">
        <div class="what">
          <div class="t">Erase this library</div>
          <div class="s">Every song, render and lyric. You see what goes first, and type the library's name to confirm.</div>
        </div>
        <div class="ctl"><button class="btn sm danger" disabled={planning} onclick={erase}><Icon name="trash" size={14} /> Erase</button></div>
      </div>
    </Block>
  {/if}
</div>

<style>
  .stack { display: flex; flex-direction: column; gap: var(--s6); }
  .stack-m .ctl.wide { flex: 0 1 280px; }
  @media (max-width: 640px) { .stack-m { flex-direction: column; align-items: stretch; } .stack-m .ctl.wide { flex-basis: auto; } }
</style>
