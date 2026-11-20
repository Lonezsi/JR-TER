<!-- Which version this is, whether there is a newer one, putting it on, and what changed.

     An update lands on disk; the running server keeps the code it loaded at startup until
     it is restarted. "It does not update" used to be the accurate report of three buttons
     that all had to be pressed, so one press (updateNow) does the whole of it and waits
     for the server to come back. -->
<script lang="ts">
  import { get, post, attempt } from "$lib/api";
  import { app, has, ownsTheMachine, saveSettings } from "$lib/app.svelte";
  import { resource } from "$lib/resource.svelte";
  import { confirm } from "$lib/dialog.svelte";
  import { updateNow, backAgain } from "$lib/actions";
  import { shell } from "../../shell/state.svelte";
  import { toast } from "$lib/toast.svelte";
  import Switch from "$ui/Switch.svelte";
  import Icon from "$ui/Icon.svelte";
  import Block from "./Block.svelte";
  import Rows from "./Rows.svelte";
  import Trouble from "./Trouble.svelte";
  import ReleaseEntry from "./ReleaseEntry.svelte";
  import type { Release, UpdateCheck } from "./shapes";

  const control = has("updater") && ownsTheMachine();
  // Checked on the way in rather than waiting to be asked: the banner that says an update
  // is ready links here, and a screen that opens on "not checked yet" is a dead end.
  const check = control ? resource(() => get<UpdateCheck>("/api/update/check")) : null;
  const log = has("devlog") ? resource(() => get<{ entries: Release[] }>("/api/devlog")) : null;

  let busy = $state<"" | "update" | "restart">("");
  let all = $state(false);
  const shown = $derived(all ? (log?.data?.entries ?? []) : (log?.data?.entries ?? []).slice(0, 3));

  async function recheck() {
    await check?.reload();
    shell.updateReady = !!check?.data?.update_available;
    shell.updateNote = check?.data?.message || "";
  }

  async function update() {
    if (busy) return;
    busy = "update";
    const result = await updateNow();
    busy = "";
    if (result === "current") { shell.updateReady = false; check?.reload(); }
  }

  async function restart() {
    const sure = await confirm("Restart JR!TER now?",
      "It stops and starts again on the code that is on disk. Anything playing stops with it. "
      + "On the machine that hosts your library a task starts it again within a few minutes; "
      + "if you are running it by hand in a window, you will have to.", "Restart it");
    if (!sure) return;
    busy = "restart";
    const said = await attempt(() => post("/api/update/restart"));
    if (!said) { busy = ""; return; }
    toast("Restarting. This page will reconnect on its own.");
    const back = await backAgain();
    if (back) location.reload();
    else { busy = ""; toast("It hasn't come back yet. Start it on its machine.", "bad"); }
  }

  const autoUpdate = $derived(app.settings.auto_update !== false);
  async function setAuto(on: boolean) {
    const before = app.settings.auto_update;
    app.settings.auto_update = on;                         // optimistic
    try { await saveSettings({ auto_update: on }); }
    catch (e) { app.settings.auto_update = before; toast((e as Error).message, "bad"); }
  }

  const c = $derived(check?.data);
  const verdict = $derived(!c ? "" : !c.checked ? "cannot tell" : c.update_available ? "update ready" : "up to date");
</script>

<div class="sections">
  <Block title="Version">
    <div class="setting">
      <div class="what">
        <div class="t num">{app.version || "unknown"}</div>
        <div class="s mono">{app.summary.updater?.commit ? `commit ${app.summary.updater.commit}` : "no commit known: not a git checkout"}</div>
      </div>
      {#if control}
        <div class="ctl">
          <button class="btn sm" disabled={check?.loading} onclick={recheck}>
            {#if check?.loading}<span class="spinner"></span>{:else}<Icon name="refresh" size={14} />{/if} Check
          </button>
        </div>
      {/if}
    </div>

    {#if check}
      {#if check.loading && !check.data}
        <Rows n={1} />
      {:else if check.error && !check.data}
        <Trouble message={check.error} retry={check.reload} />
      {:else if c}
        <div class="setting">
          <span class="tag" class:accent={c.update_available}>{verdict}</span>
          <div class="what">
            <div class="t truncate">{c.message || c.why || (c.checked ? "Nothing newer." : "")}</div>
            <div class="s mono">
              {#if c.local}here {c.local.slice(0, 7)}{/if}{#if c.remote} · github {c.remote.slice(0, 7)}{/if}
            </div>
            <!-- Why there is no button, when there is a reason and no button: a checkout with
                 uncommitted changes said "update ready", offered nothing to press, and
                 explained nothing, which from outside is what "it does not update" looks like. -->
            {#if c.why && c.message}<div class="s why">{c.why}</div>{/if}
          </div>
          {#if c.can_update}
            <div class="ctl">
              <button class="btn sm primary" disabled={!!busy} onclick={update}>
                {#if busy === "update"}<span class="spinner"></span>{/if} Update now
              </button>
            </div>
          {/if}
        </div>
      {/if}
      <div class="setting">
        <div class="what">
          <div class="t">Restart the server</div>
          <div class="s">An update lands on disk; the running server keeps the code it loaded until it is restarted.</div>
        </div>
        <div class="ctl"><button class="btn sm" disabled={!!busy} onclick={restart}>
          {#if busy === "restart"}<span class="spinner"></span>{/if} Restart</button></div>
      </div>
      <div class="setting">
        <div class="what">
          <div class="t">Update by itself</div>
          <div class="s">Looks every few hours and pulls what is new. It restarts only where something will start it again.</div>
        </div>
        <div class="ctl"><Switch checked={autoUpdate} label="Update by itself" onchange={setAuto} /></div>
      </div>
    {/if}
  </Block>

  {#if log}
    <Block title="What changed" bare>
      {#snippet actions()}
        {#if (log.data?.entries.length ?? 0) > 3}
          <button class="btn sm ghost" onclick={() => (all = !all)}>{all ? "Fewer" : "All releases"}</button>
        {/if}
      {/snippet}
      {#if log.loading && !log.data}
        <div class="card group"><Rows n={2} /></div>
      {:else if log.error && !log.data}
        <Trouble message={log.error} retry={log.reload} />
      {:else}
        <div class="card notes">
          {#each shown as release (release.version)}<ReleaseEntry {release} />{/each}
          {#if !shown.length}<p class="faint">Nothing recorded yet.</p>{/if}
        </div>
      {/if}
    </Block>
  {/if}
</div>

<style>
  .sections { display: flex; flex-direction: column; gap: var(--s6); }
  .why { color: var(--bad); }
  .notes { padding: var(--s4) var(--s5); }
</style>
