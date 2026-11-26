<!-- Sources: the folders on the host that JR!TER reads, and the desktop agent that sends.
     Owner only (the folders are the machine's, not the account's).

     A scan never imports anything. It reports what it found and what each file looks like
     a new render of, and you say yes. -->
<script lang="ts">
  import { get, post, patch, del, upload, attempt } from "$lib/api";
  import { resource } from "$lib/resource.svelte";
  import { emit } from "$lib/bus";
  import { app, saveSettings } from "$lib/app.svelte";
  import { sheet, confirm } from "$lib/dialog.svelte";
  import { contextMenu, showMenu, type MenuItem } from "$lib/menu.svelte";
  import { toast } from "$lib/toast.svelte";
  import { useCommands } from "$lib/commands";
  import { copyText } from "$lib/actions";
  import { href } from "$lib/router.svelte";
  import { when, bytes, time, plural } from "$lib/util";
  import Icon from "$ui/Icon.svelte";
  import Switch from "$ui/Switch.svelte";
  import { takeInFolder } from "./renders";

  interface Folder { id: number; path: string; enabled: number | boolean; last_scan: number; kind?: string }
  interface Candidate {
    path: string; name: string; digest: string; size: number; modified: number;
    duration: number; bitrate: number; suggest: { song_id: number; title: string; score: number } | null;
  }
  interface Scan { candidates: Candidate[]; already_have: number; errors: { path: string; why: string }[]; folders: number }

  const folders = resource<{ folders: Folder[] }>(() => get("/api/sync/folders"));
  const list = $derived(folders.data?.folders || []);
  // A folder from a version of the server before kinds was a collector.
  const collectors = $derived(list.filter((f) => (f.kind || "collector") === "collector"));
  const libraries = $derived(list.filter((f) => f.kind === "sync"));

  let scanning = $state(false);
  let scan = $state<Scan | null>(null);
  let chosen = $state<Set<string>>(new Set());
  let importing = $state(false);
  let stocking = $state(false);
  let stock = $state<{ libraries: { id: number; path: string; files: number; bytes: number }[]; errors: { path: string; why: string }[] } | null>(null);
  let minutes = $state(String(app.settings.sync_interval_minutes ?? 5));
  $effect(() => { minutes = String(app.settings.sync_interval_minutes ?? 5); });

  // ── folders ────────────────────────────────────────────────────────────────
  async function add(kind: "collector" | "sync") {
    const forSync = kind === "sync";
    const said = await sheet<{ path: string }>({
      title: forSync ? "Add a sample library" : "Watch a folder for renders",
      sub: forSync
        ? "The full path on the machine running JR!TER. Read only, and never offered as a render."
        : "The full path on the machine running JR!TER. It is only ever read.",
      confirm: forSync ? "Add it" : "Watch it",
      fields: [{ name: "path", label: "Folder", required: true,
        placeholder: forSync ? "C:\\Users\\you\\Samples" : "C:\\Users\\you\\Music\\Renders" }],
    });
    const path = said?.path.trim();
    if (!path) return;
    const made = await attempt(() => post("/api/sync/folders", { path, kind }));
    if (made) toast(made.added ? "Added." : "Already watching that one.");
    await folders.reload();
  }

  async function toggle(folder: Folder, on: boolean) {
    const before = folders.data;
    // Optimistic: the switch has already moved. Put it back if the server said no.
    folders.set({ folders: list.map((f) => (f.id === folder.id ? { ...f, enabled: on ? 1 : 0 } : f)) });
    const done = await attempt(() => patch(`/api/sync/folders/${folder.id}`, { enabled: on }));
    if (!done) folders.set(before);
  }

  async function remove(folder: Folder) {
    const kind = folder.kind || "collector";
    folders.set({ folders: list.filter((f) => f.id !== folder.id) });
    const done = await attempt(() => del(`/api/sync/folders/${folder.id}`));
    if (!done) { await folders.reload(); return; }
    // Only the entry in this list goes, never the folder, so it can simply be added again.
    toast("Stopped watching it.", "", {
      label: "Undo",
      run: async () => { await attempt(() => post("/api/sync/folders", { path: folder.path, kind })); await folders.reload(); },
    });
  }

  async function putSamples(folder: Folder) {
    // A picker and not a drop zone: it is the one way in that works the same on a phone,
    // and a phone is the reason this exists. Sent one after another, so a refusal names
    // the file it was about instead of failing the batch.
    const picker = document.createElement("input");
    picker.type = "file"; picker.multiple = true;
    picker.accept = "audio/*,.mp3,.wav,.flac,.m4a,.aac,.ogg,.opus";
    picker.addEventListener("change", async () => {
      const files = Array.from(picker.files || []);
      let sent = 0;
      const failed: string[] = [];
      for (const file of files) {
        const done = await attempt(() => upload(`/api/sync/folders/${folder.id}/upload`, file));
        if (done) sent++; else failed.push(file.name);
      }
      if (sent) toast(sent === 1 ? "Added one sound." : `Added ${sent} sounds.`);
      if (failed.length) toast(`${failed.length} did not go in: ${failed.slice(0, 3).join(", ")}`, "bad");
      await folders.reload();
    }, { once: true });
    picker.click();
  }

  async function takeStock() {
    stocking = true;
    const data = await attempt(() => post("/api/sync/stock"));
    stocking = false;
    if (data) stock = data;
    await folders.reload();
  }

  function folderMenu(folder: Folder): MenuItem[] {
    const isLibrary = folder.kind === "sync";
    return [
      { group: folder.path },
      !isLibrary ? { label: "Scan it now", icon: "refresh", run: doScan } : { label: "Take stock", icon: "refresh", run: takeStock },
      { label: folder.enabled ? "Stop watching it" : "Watch it again", icon: "eye", run: () => toggle(folder, !folder.enabled) },
      isLibrary ? { label: "Add sounds…", icon: "upload", run: () => putSamples(folder) } : null,
      { label: "Copy the path", icon: "copy", run: () => copyText(folder.path, "Path copied.") },
      { divider: true },
      { label: "Remove from the list", icon: "trash", danger: true, run: () => remove(folder) },
    ];
  }

  // ── scanning and importing ─────────────────────────────────────────────────
  async function doScan() {
    if (scanning) return;
    scanning = true;
    const data = await attempt(() => post<Scan>("/api/sync/scan"));
    scanning = false;
    await folders.reload();
    if (!data) return;
    scan = data;
    chosen = new Set();
    toast(data.candidates.length ? `${plural(data.candidates.length, "new file")}.` : "Nothing new.");
  }

  async function importOne(c: Candidate, mode: "suggest" | "new"): Promise<boolean> {
    const body: Record<string, unknown> = { path: c.path };
    if (mode === "suggest" && c.suggest) body.song_id = c.suggest.song_id;
    const result = await attempt(() => post("/api/sync/import", body));
    if (!result) return false;
    scan = scan && { ...scan, candidates: scan.candidates.filter((x) => x.path !== c.path) };
    chosen.delete(c.path); chosen = new Set(chosen);
    emit("songs:changed");
    emit("versions:changed", { songId: result.song?.id });
    return result;
  }

  async function importMany(items: Candidate[]) {
    if (!items.length || importing) return;
    const fresh = items.filter((c) => !c.suggest).length;
    const ok = await confirm(
      `Import ${plural(items.length, "file")}?`,
      (fresh ? `${plural(fresh, "file")} with no matching song become a song each. ` : "")
        + "The rest become a new render on the song they look like. Nothing in the folders is changed.",
      "Import", "Not yet");
    if (!ok) return;
    importing = true;
    let done = 0;
    for (const c of items) { if (await importOne(c, "suggest")) done++; }
    importing = false;
    toast(`${plural(done, "file")} imported.`);
  }

  async function importAs(c: Candidate, mode: "suggest" | "new") {
    const result = await importOne(c, mode);
    if (result) toast(mode === "suggest" && c.suggest ? `Added to ${c.suggest.title}.` : "Imported as a new song.");
  }

  const candidates = $derived(scan?.candidates || []);
  const picked = $derived(candidates.filter((c) => chosen.has(c.path)));
  const flip = (path: string) => { const n = new Set(chosen); if (n.has(path)) n.delete(path); else n.add(path); chosen = n; };
  const allChosen = $derived(!!candidates.length && picked.length === candidates.length);

  async function saveInterval() {
    const n = Math.round(Number(minutes));
    if (!Number.isFinite(n) || n < 1 || n > 1440) { toast("Enter a number of minutes between 1 and 1440.", "bad"); minutes = String(app.settings.sync_interval_minutes ?? 5); return; }
    if (n === app.settings.sync_interval_minutes) return;
    await attempt(() => saveSettings({ sync_interval_minutes: n }), "Saved.");
  }

  useCommands(() => [
    { id: "inbox.scan", title: "Scan watched folders now", icon: "refresh", group: "Inbox", run: doScan },
    { id: "inbox.addfolder", title: "Watch a folder for renders", icon: "folder", group: "Inbox", run: () => add("collector") },
    { id: "inbox.takein", title: "Take in a folder of renders", icon: "inbox", group: "Inbox", run: () => takeInFolder() },
  ]);
</script>

{#snippet folderRow(folder: Folder)}
  <div class="setting folder" use:contextMenu={() => folderMenu(folder)}>
    <Switch checked={!!folder.enabled} label="Watch this folder" onchange={(on) => toggle(folder, on)} />
    <div class="what">
      <div class="t truncate path" title={folder.path}>{folder.path}</div>
      <div class="s">{folder.last_scan ? `looked at ${when(folder.last_scan)}` : "not looked at yet"}{folder.enabled ? "" : " · paused"}</div>
    </div>
    <div class="ctl">
      {#if folder.kind === "sync"}
        <button class="icon-btn sm" title="Add sounds to this library" aria-label="Add sounds to this library" onclick={() => putSamples(folder)}><Icon name="upload" size={16} /></button>
      {/if}
      <button class="icon-btn sm" title="More" aria-label="More about this folder"
              onclick={(e) => showMenu(folderMenu(folder), { anchor: e.currentTarget })}><Icon name="more" size={16} /></button>
      <button class="icon-btn sm" title="Stop watching" aria-label="Stop watching this folder" onclick={() => remove(folder)}><Icon name="close" size={16} /></button>
    </div>
  </div>
{/snippet}

<div class="sources col">
  <div class="notice accent">
    <Icon name="lock" size={16} />
    <span>JR!TER only <b>reads</b> these folders and never writes to them. Nothing comes in until you say so.</span>
  </div>

  {#if folders.error && !folders.data}
    <div class="notice bad"><span class="grow">{folders.error}</span><button class="btn sm" onclick={() => folders.reload()}>Try again</button></div>
  {/if}

  <section class="col">
    <div class="section-head">
      <h2>Render collectors</h2>
      <button class="btn sm ghost" onclick={() => add("collector")}><Icon name="plus" size={14} />Add</button>
      {#if collectors.length}
        <button class="btn sm primary" disabled={scanning} onclick={doScan}>
          {#if scanning}<span class="spinner"></span>Scanning{:else}<Icon name="refresh" size={14} />Scan now{/if}
        </button>
      {/if}
    </div>
    <p class="muted small">Folders your bounces land in. They're checked on a timer, so new renders show up without you dragging them in.</p>
    {#if !folders.data}
      <div class="card group"><div class="setting"><span class="sk bar"></span></div><div class="setting"><span class="sk bar"></span></div></div>
    {:else if collectors.length}
      <div class="card group">{#each collectors as f (f.id)}{@render folderRow(f)}{/each}</div>
    {:else}
      <div class="card empty"><h3>Nothing collecting yet</h3><p>Point this at your exports folder.</p>
        <button class="btn primary" onclick={() => add("collector")}>Add a folder</button></div>
    {/if}
  </section>

  {#if scan}
    <section class="col">
      <div class="section-head">
        <h2>New files</h2>
        <span class="faint small">{scan.already_have} already in the library</span>
      </div>
      {#each scan.errors as err}
        <div class="notice"><span class="tag warn">problem</span><span class="grow"><span class="truncate path">{err.path}</span><br /><span class="faint">{err.why}</span></span></div>
      {/each}
      {#if candidates.length}
        <div class="row wrap bulk">
          <label class="check"><input type="checkbox" checked={allChosen}
            onchange={() => (chosen = allChosen ? new Set() : new Set(candidates.map((c) => c.path)))} /><span>{picked.length ? `${picked.length} selected` : "Select all"}</span></label>
          <span class="grow"></span>
          {#if picked.length}<button class="btn sm tint" disabled={importing} onclick={() => importMany(picked)}>Import selected</button>{/if}
          <button class="btn sm" disabled={importing} onclick={() => importMany(candidates)}>Import all {candidates.length}</button>
        </div>
        <div class="card list ruled">
          {#each candidates as c (c.path)}
            <div class="item cand">
              <input type="checkbox" aria-label="Select {c.name}" checked={chosen.has(c.path)} onchange={() => flip(c.path)} />
              <span class="grow col" style="gap:2px">
                <span class="t truncate">{c.name}</span>
                <span class="s truncate path" title={c.path}>{c.path}</span>
                <span class="s num">{bytes(c.size)}{c.duration ? " · " + time(c.duration) : ""}{c.bitrate ? ` · ${c.bitrate} kbps` : ""}</span>
              </span>
              <span class="acts">
                {#if c.suggest}<button class="btn sm primary" disabled={importing} onclick={() => importAs(c, "suggest")}>New render of {c.suggest.title}</button>{/if}
                <button class="btn sm {c.suggest ? 'ghost' : 'primary'}" disabled={importing} onclick={() => importAs(c, "new")}>{c.suggest ? "New song" : "Import as new song"}</button>
              </span>
            </div>
          {/each}
        </div>
      {:else}
        <div class="card empty"><h3>Nothing new</h3><p>Everything in those folders is already in the library.</p></div>
      {/if}
    </section>
  {/if}

  <section class="col">
    <div class="section-head">
      <h2>Sample libraries</h2>
      <button class="btn sm ghost" onclick={() => add("sync")}><Icon name="plus" size={14} />Add</button>
      {#if libraries.length}
        <button class="btn sm ghost" disabled={stocking} onclick={takeStock}>{stocking ? "Looking" : "Take stock"}</button>
      {/if}
    </div>
    <p class="muted small">Sample libraries never show up as renders, that's why they're their own thing. For now this just counts what's in one, so you can compare two machines. It doesn't move files between them yet.</p>
    {#if !folders.data}
      <div class="card group"><div class="setting"><span class="sk bar"></span></div></div>
    {:else if libraries.length}
      <div class="card group">{#each libraries as f (f.id)}{@render folderRow(f)}{/each}</div>
    {:else}
      <div class="card empty"><h3>No libraries yet</h3><p>Point this at your samples.</p>
        <button class="btn primary" onclick={() => add("sync")}>Add a folder</button></div>
    {/if}
    {#if stock}
      {#each stock.errors as err}<div class="notice"><span class="tag warn">problem</span><span class="grow truncate">{err.path}: {err.why}</span></div>{/each}
      {#if stock.libraries.length}
        <div class="card list ruled">
          {#each stock.libraries as lib (lib.id)}
            <div class="item"><span class="grow col" style="gap:2px"><span class="t truncate path">{lib.path}</span>
              <span class="s num">{lib.files.toLocaleString()} files · {bytes(lib.bytes)}</span></span></div>
          {/each}
        </div>
      {/if}
    {/if}
  </section>

  <section class="col">
    <div class="section-head"><h2>How often</h2></div>
    <div class="card group">
      <div class="setting stack">
        <div class="what"><div class="t">Look for new renders every</div>
          <div class="s">The server checks the render collectors on this timer. Scan now does it straight away.</div></div>
        <div class="ctl">
          <input class="field sm minutes num" type="number" min="1" max="1440" inputmode="numeric" aria-label="Minutes between looks"
                 bind:value={minutes} onchange={saveInterval} onkeydown={(e) => { if (e.key === "Enter") saveInterval(); }} />
          <span class="muted">minutes</span>
        </div>
      </div>
    </div>
  </section>

  <section class="col">
    <div class="section-head"><h2>Desktop agent</h2>
      <a class="btn sm ghost" href={href.settings("devices")}><Icon name="key" size={14} />Tokens</a></div>
    <div class="card agent col">
      <p>A small program on the computer you make music on. It watches your exports folder and sends new renders here, only the ones the library doesn't have yet. It never writes to your folders, and signs in with a token from <a class="link" href={href.settings("devices")}>Settings, Devices</a>.</p>
      <div class="code mono">cd client<br />python jriter_client.py install --server http://127.0.0.1:7900 --folder "C:\Users\you\Music\Renders"</div>
      <p class="muted small">No admin needed. It starts at logon, adds a right-click menu and updates itself daily at 05:00. <span class="mono">jriter_client.py shell remove</span> takes the menu away.</p>
      <div class="eyebrow">The right click menu</div>
      <div class="table">
        <div><span class="muted">An mp3, wav, flac, m4a, ogg</span><b>Upload to JR!TER</b></div>
        <div><span class="muted">An .flp project</span><b>Render and send to JR!TER</b></div>
        <div><span class="muted">A folder</span><b>Render every FL project in here</b></div>
        <div><span class="muted">A folder</span><b>Watch this folder with JR!TER</b></div>
      </div>
    </div>
  </section>
</div>

<style>
  .sources { gap: var(--s6); }
  .small { font-size: var(--t-sm); }
  .path { word-break: break-all; }
  .folder { min-height: 60px; }
  .folder .what { min-width: 0; }
  .folder .path { word-break: normal; }
  .sk.bar { height: 36px; width: 100%; }
  .check { display: inline-flex; align-items: center; gap: var(--s2); font-weight: 600; cursor: pointer; }
  .check input, .cand input { width: 18px; height: 18px; accent-color: var(--accent); flex: none; }
  .cand { align-items: flex-start; padding: var(--s3); }
  .cand .acts { display: flex; gap: var(--s2); flex-wrap: wrap; justify-content: flex-end; }
  .minutes { width: 90px; }
  .agent { padding: var(--s4) var(--s5); gap: var(--s3); }
  .code { padding: var(--s3); border-radius: var(--r-md); background: rgba(0,0,0,0.3); border: 1px solid var(--line); font-size: var(--t-sm); overflow-x: auto; white-space: nowrap; }
  .link { color: var(--accent-text); }
  .table { display: grid; }
  .table > div { display: flex; justify-content: space-between; gap: var(--s3); padding: var(--s2) 0; border-top: 1px solid var(--line); font-size: var(--t-sm); flex-wrap: wrap; }
  @media (max-width: 640px) { .cand { flex-direction: column; } .cand .acts { justify-content: flex-start; } }
</style>
