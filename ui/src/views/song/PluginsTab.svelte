<!-- The Plugins tab: which plugins each render of the song used (VST3, VST2, FL), and which
     were missing on the PC that rendered it. Same helpers as /plugins.html (web/plugins/list.js),
     so there is one copy of the grouping and the summary line. -->
<script lang="ts">
  import Segmented from "$ui/Segmented.svelte";
  import Icon from "$ui/Icon.svelte";
  import { withPlugins, pickVersion, groups, summary, type Plugin } from "../../../../web/plugins/list.js";
  import { useSong } from "./song.svelte";

  const song = useSong();
  const have = $derived(withPlugins(song.versions as { id: number | string; n?: number; label?: string | null; plugins?: Plugin[] }[]));
  let wanted = $state<string | null>(null);
  const current = $derived(pickVersion(have, song.current?.id, wanted));
  const KIND: Record<string, string> = { vst3: "VST3", vst2: "VST2", fl: "FL" };
</script>

<div class="plugins">
  {#if have.length > 1 && current}
    <Segmented size="sm" label="Render" value={String(current.id)} onchange={(v) => (wanted = v)}
      options={have.map((v) => ({ value: String(v.id), label: `v${v.n ?? ""}${v.label ? " " + v.label : ""}` }))} />
  {/if}
  {#if !current}
    <p class="mute">No render of this song brought a plugin list yet. Render it from FL with jriter-cli render.</p>
  {:else}
    <p class="mute">{summary(current.plugins)}
      <a class="page" href={`/plugins.html?song=${encodeURIComponent(song.id)}&version=${encodeURIComponent(String(current.id))}`}
         data-tip="Open as its own page" aria-label="Open as its own page"><Icon name="external" size={14} /></a></p>
    {#each groups(current.plugins) as g (g.title)}
      <section>
        <h3>{g.title}</h3>
        <ul>
          {#each g.items as p (p.kind + p.name)}
            <li>
              <span class="grow">{p.name}</span>
              {#if p.vendor}<span class="mute">{p.vendor}</span>{/if}
              <span class="tag">{KIND[p.kind] || p.kind}</span>
              {#if (p.uses ?? 0) > 1}<span class="mute">×{p.uses}</span>{/if}
              {#if p.installed === false}<span class="tag warn" data-tip="Not installed on the PC that rendered it">missing here</span>{/if}
            </li>
          {/each}
        </ul>
      </section>
    {/each}
  {/if}
</div>

<style>
  .plugins { display: flex; flex-direction: column; gap: 12px; }
  h3 { margin: 0 0 6px; font-size: 13px; font-weight: 600; }
  ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
  li { display: flex; align-items: center; gap: 8px; font-size: 13px; }
  .grow { flex: 1; min-width: 0; overflow-wrap: anywhere; }
  .mute { opacity: 0.65; font-size: 12px; margin: 0; }
  .tag { font-size: 11px; padding: 1px 8px; border-radius: 999px; border: 1px solid currentColor; opacity: 0.7; }
  .tag.warn { color: #e0a030; opacity: 1; }
  .page { margin-left: 6px; color: inherit; vertical-align: middle; }
</style>
