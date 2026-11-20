<!-- Is the server whole, what failed to load, what went wrong lately, and what is switched
     on. Owner only: a traceback names paths on the machine and the shape of the code. -->
<script lang="ts">
  import { get, del, attempt } from "$lib/api";
  import { app } from "$lib/app.svelte";
  import { resource } from "$lib/resource.svelte";
  import { confirm } from "$lib/dialog.svelte";
  import { copyText } from "$lib/actions";
  import { date, plural } from "$lib/util";
  import Icon from "$ui/Icon.svelte";
  import Block from "./Block.svelte";
  import Rows from "./Rows.svelte";
  import Trouble from "./Trouble.svelte";
  import type { Health, Problem } from "./shapes";

  const health = resource(() => get<Health>("/api/health"));
  const errors = resource(() => get<{ errors: Problem[]; kept: number; dropped: number }>("/api/health/errors"));
  let open = $state<string | null>(null);

  const failed = $derived(Object.entries(app.failed));
  const up = (s?: number) => {
    if (!s) return "";
    const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
    return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`;
  };

  async function clear() {
    const sure = await confirm("Clear the error list?", "The tracebacks are kept in memory only, so they cannot be brought back.", "Clear", "Keep them");
    if (!sure) return;
    const done = await attempt(() => del("/api/health/errors"), "Cleared.");
    if (done) { errors.set({ errors: [], kept: 0, dropped: 0 }); health.reload(); }
  }

  const reload = () => { health.reload(); errors.reload(); };
</script>

<div class="sections">
  <Block title="Health">
    {#snippet actions()}
      <button class="btn sm ghost" onclick={reload}><Icon name="refresh" size={14} /> Refresh</button>
    {/snippet}
    {#if health.loading && !health.data}
      <Rows n={1} />
    {:else if health.error && !health.data}
      <Trouble message={health.error} retry={health.reload} />
    {:else if health.data}
      <div class="setting">
        <span class="tag" class:accent={health.data.ok && !health.data.degraded} class:bad={!health.data.ok} class:warn={health.data.ok && !!health.data.degraded}>
          {!health.data.ok ? "not well" : health.data.degraded ? "degraded" : "well"}
        </span>
        <div class="what">
          <div class="t">{health.data.ok ? "The server and its database are answering." : "The database did not answer."}</div>
          <div class="s num">up {up(health.data.uptime)}{health.data.problems ? ` · ${plural(health.data.problems, "problem")} kept` : ""}</div>
        </div>
      </div>
      {#each health.data.degraded ?? [] as line (line)}
        <div class="setting"><div class="what"><div class="s why">{line}</div></div></div>
      {/each}
    {/if}
  </Block>

  <Block title="Modules"
         note="Each feature is a module. Removing one from the MODULES list in jriter/config.py takes it out of the server and out of this interface.">
    <div class="setting wrapper">
      <div class="pills">
        {#each app.modules as m (m)}<span class="tag">{m}</span>{/each}
        {#each failed as [m] (m)}<span class="tag warn">{m} failed</span>{/each}
      </div>
    </div>
    {#each failed as [m, why] (m)}
      <div class="setting"><div class="what"><div class="t">{m}</div><div class="s why">{why}</div></div></div>
    {/each}
  </Block>

  <Block title="Recent errors" note="Tracebacks since the server started, newest first. Kept in memory, not on disk.">
    {#snippet actions()}
      {#if errors.data?.errors.length}<button class="btn sm ghost danger" onclick={clear}>Clear</button>{/if}
    {/snippet}
    {#if errors.loading && !errors.data}
      <Rows n={1} />
    {:else if errors.error && !errors.data}
      <Trouble message={errors.error} retry={errors.reload} />
    {:else if !errors.data?.errors.length}
      <div class="setting"><div class="what"><div class="s">Nothing has gone wrong since it started.</div></div></div>
    {:else}
      {#each errors.data.errors as p (p.ref + p.at)}
        <div class="err">
          <button class="head" aria-expanded={open === p.ref + p.at} onclick={() => (open = open === p.ref + p.at ? null : p.ref + p.at)}>
            <span class="tag bad">{p.ref}</span>
            <span class="grow truncate"><b>{p.kind}</b> {p.message}</span>
            <Icon name={open === p.ref + p.at ? "chev-up" : "chev-down"} size={16} />
          </button>
          {#if open === p.ref + p.at}
            <div class="detail">
              <div class="s faint">{date(p.at)} · {p.method} {p.where}</div>
              <pre class="mono">{p.traceback}</pre>
              <button class="btn sm" onclick={() => copyText(p.traceback || "", "Traceback copied.")}><Icon name="copy" size={14} /> Copy</button>
            </div>
          {/if}
        </div>
      {/each}
      {#if errors.data.dropped}<div class="setting"><div class="what"><div class="s">{errors.data.dropped} older ones were let go to keep the list short.</div></div></div>{/if}
    {/if}
  </Block>
</div>

<style>
  .sections { display: flex; flex-direction: column; gap: var(--s6); }
  .why { color: var(--bad); }
  .pills { display: flex; flex-wrap: wrap; gap: var(--s2); }
  .err + .err { border-top: 1px solid var(--line); }
  .head { display: flex; align-items: center; gap: var(--s3); width: 100%; padding: var(--s3) var(--s4); text-align: left; font-size: var(--t-sm); }
  .head:hover { background: var(--hover); }
  .detail { padding: 0 var(--s4) var(--s3); display: flex; flex-direction: column; gap: var(--s2); align-items: flex-start; }
  pre { margin: 0; max-width: 100%; max-height: 260px; overflow: auto; font-size: var(--t-xs); white-space: pre-wrap; overflow-wrap: anywhere; color: var(--text-2); }
</style>
