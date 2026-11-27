<!-- Putting a song on YouTube: the sound, the cut, the words, the account.

     The one thing in the app that leaves the building: everything else is reversible and
     private, a video is neither. The file is rendered here, in the browser, from the same
     chain the player uses (bounce.ts), so what goes up is what you approved; a Python copy
     of that chain would be a second implementation that agreed until it did not. The sound
     itself is shaped on the Sound tab, on the same presets; this picks which one goes out. -->
<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import Dropdown from "$ui/Dropdown.svelte";
  import Switch from "$ui/Switch.svelte";
  import Icon from "$ui/Icon.svelte";
  import { api, get, post, attempt } from "$lib/api";
  import { emit } from "$lib/bus";
  import { sheet } from "$lib/dialog.svelte";
  import { toast } from "$lib/toast.svelte";
  import { bytes, time, when } from "$lib/util";
  import { useSong } from "./song.svelte";
  import { href } from "$lib/router.svelte";
  import { render, toWav, peakOf, arrangedLength, type Arrangement } from "./bounce";
  import { download, versionName } from "./helpers";

  interface Account { id: string; name: string; connected_at?: number }
  interface Job {
    state: "encoding" | "uploading" | "done" | "failed"; step?: string; at: number; sent?: number; total?: number;
    url?: string; privacy_asked?: string; privacy_got?: string; error?: string; fix?: string; log?: string[];
  }
  const song = useSong();
  const songId = Number(song.id);
  const PRIVACY = [
    { key: "private", label: "Private", note: "only you" },
    { key: "unlisted", label: "Unlisted", note: "anyone with the link" },
    { key: "public", label: "Public", note: "listed and searchable" },
  ];

  let account = $state<{ accounts: Account[]; chosen: string | null }>({ accounts: [], chosen: null });
  let tool = $state<{ found?: boolean; can_install?: boolean; why?: string; install_why?: string; install_version?: string; install_size?: number }>({});
  let arrangement = $state<Arrangement | null>(null);
  let job = $state<Job | null>(null);
  let ready = $state(false);

  let versionId = $state(String(song.current?.id ?? ""));
  let presetId = $state(String(song.presetOf("A")?.id ?? song.presets[0]?.id ?? ""));
  let useArranged = $state(false);
  let title = $state(song.song?.title || "");
  let description = $state("");
  let privacy = $state("private");

  let working = $state(false);
  let progress = $state({ what: "", at: 0 });
  let bounced = $state<{ blob: Blob; url: string; peak: number; seconds: number } | null>(null);

  const version = $derived(song.versions.find((v) => String(v.id) === versionId) || song.current);
  const preset = $derived(song.presets.find((p) => String(p.id) === presetId) || null);
  const canArrange = $derived(!!arrangement && arrangement.clips.length > 0);
  const running = $derived(!!job && (job.state === "encoding" || job.state === "uploading"));

  async function load() {
    const [acc, t, arr, j] = await Promise.all([
      get("/api/youtube/account").catch(() => ({ accounts: [], chosen: null })),
      get("/api/youtube/tool").catch(() => ({})),
      song.has("arrange") ? get(`/api/songs/${song.id}/arrangement`).catch(() => ({})) : Promise.resolve({}),
      get("/api/youtube/job").catch(() => ({ job: null })),
    ]);
    account = acc; tool = t;
    arrangement = arr.arrangement || null;
    job = j.job; ready = true;
    if (running) watch();
  }
  onMount(load);

  function stale() {
    if (bounced) URL.revokeObjectURL(bounced.url);
    bounced = null;
  }
  onDestroy(() => { stale(); stopWatching(); });

  async function makeFile() {
    if (working || !version) return;
    working = true;
    try {
      const buffer = await render(version, preset, useArranged && canArrange ? arrangement : null,
        (what, at) => { progress = { what, at }; });
      stale();
      const blob = toWav(buffer);
      // Held so it can be given back: a rendered wav is tens of megabytes and this invites
      // rendering again after every change.
      bounced = { blob, url: URL.createObjectURL(blob), peak: peakOf(buffer), seconds: buffer.duration };
    } catch (e) {
      toast(`That did not render: ${(e as Error).message}`, "bad");
    } finally { working = false; }
  }

  // ── sending ───────────────────────────────────────────────────────────────
  let timer: ReturnType<typeof setInterval> | null = null;
  function stopWatching() { if (timer) clearInterval(timer); timer = null; }
  /* One GET a second while something is running, none when nothing is: the server has no
   * websockets, and a second is well inside what a moving bar needs. */
  function watch() {
    if (timer) return;
    timer = setInterval(async () => {
      const now = await get("/api/youtube/job").catch(() => null);
      if (!now) return;
      job = now.job;
      if (!job || (job.state !== "encoding" && job.state !== "uploading")) {
        stopWatching();
        if (job?.state === "done") emit("youtube:changed", { songId });
      }
    }, 1000);
  }

  async function send() {
    if (!bounced || !version) return;
    const blob = bounced.blob;
    const mix = await attempt(() => api(`/api/songs/${songId}/youtube/mix`, {
      method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: blob }));
    if (!mix) return;
    const started = await attempt(() => post(`/api/songs/${songId}/youtube/upload`, {
      digest: mix.digest, version_id: version.id, title: title.trim() || song.song?.title, description, privacy }));
    if (!started) return;
    job = started.job;
    watch();
  }
  async function stop() {
    await attempt(() => post("/api/youtube/job/cancel", {}));
    const now = await get("/api/youtube/job").catch(() => null);
    if (now) job = now.job;
  }

  const chosenName = $derived(account.accounts.find((a) => a.id === account.chosen)?.name || "your channel");
</script>

<section class="col">
  <div class="section-head"><h2>Upload to YouTube</h2></div>

  {#if !ready}
    <div class="card"><div class="sk" style="height:120px"></div></div>
  {:else if !song.versions.length}
    <div class="empty card"><h3>Nothing to upload</h3><p>This song has no render on it yet.</p></div>
  {:else}
    <div class="card block">
      <h3>Audio</h3>
      <p class="hint">Same effects as the Sound tab.</p>
      <div class="grid2">
        <label class="label">Render
          <Dropdown bind:value={versionId} onchange={stale} label="Render" block
                    options={song.versions.map((v) => ({ value: String(v.id), label: [versionName(v), v.label || v.filename].filter(Boolean).join(" · ") }))} /></label>
        <label class="label">Preset
          <Dropdown bind:value={presetId} onchange={stale} label="Preset" block
                    options={[{ value: "", label: "Flat, no effects" }, ...song.presets.map((p) => ({ value: String(p.id), label: p.name }))]} /></label>
      </div>
      {#if song.has("arrange")}
        {#if canArrange}
          <div class="setting arr"><span class="what"><span class="t">Use the arrangement</span><br /><span class="s">Plays it as arranged, cuts and all.</span></span>
            <span class="ctl"><Switch bind:checked={useArranged} label="Use the arrangement" onchange={stale} /></span></div>
        {:else}
          <p class="hint">Not laid out yet. Arrange it on the Arrange tab and you can send that instead.</p>
        {/if}
      {/if}
      <div class="summary faint num">
        <span>{version ? versionName(version) : "?"}</span> · <span>{preset && !preset.data.bypass ? `${(preset.data.bands || []).filter((b) => b.on).length} bands` : "flat"}</span>
        · <span>{preset && !preset.data.bypass && preset.data.limiter?.on ? "limiter on" : "no limiter"}</span>
        · <span>{useArranged && canArrange && arrangement ? `as arranged, ${time(arrangedLength(arrangement))}` : `full length${version?.duration ? ", " + time(version.duration) : ""}`}</span>
      </div>
      <div class="row wrap">
        <button class="btn primary" onclick={makeFile} disabled={working}>{#if working}<span class="spinner"></span>{/if}Make the file</button>
        {#if working}<span class="faint">{progress.what}</span><span class="bar"><span style:width="{Math.round(progress.at * 100)}%"></span></span>{/if}
      </div>
      {#if bounced}
        <div class="made" class:hot={bounced.peak > -0.1}>
          <div class="row"><b>{bounced.peak > -0.1 ? "It clips" : "Rendered"}</b><span class="grow"></span><span class="faint num">peak {bounced.peak.toFixed(1)} dB</span></div>
          {#if bounced.peak > -0.1}<p class="warn">The loudest moment is {bounced.peak.toFixed(1)} dB, which is above what a file can hold, so it has been flattened at the top. Turn the limiter on, or pull the gain down by about {Math.ceil(bounced.peak)} dB, and render again.</p>{/if}
          <audio controls src={bounced.url}></audio>
          <div class="row wrap">
            <button class="btn sm ghost" onclick={() => download(bounced!.url, `${song.song?.title} ${version ? "v" + version.n : ""}.wav`)}><Icon name="download" size={14} />Save the file</button>
            <span class="faint num">{bytes(bounced.blob.size)} · {time(bounced.seconds)}</span>
          </div>
        </div>
      {/if}
    </div>

    <div class="card block">
      <h3>Video details</h3>
      <label class="label">Title<input class="field" bind:value={title} required /></label>
      <label class="label">Description<textarea class="field" rows="4" bind:value={description}></textarea></label>
      <div class="label">Who can see it
        <div class="pills" role="radiogroup" aria-label="Who can see it">
          {#each PRIVACY as p (p.key)}
            <button class="pill" class:on={privacy === p.key} role="radio" aria-checked={privacy === p.key} onclick={() => (privacy = p.key)}>
              <b>{p.label}</b><span>{p.note}</span></button>
          {/each}
        </div>
      </div>
      <p class="hint">{song.cover ? "Uses the cover as the video." : "No cover yet, so the video is a plain colour. Add one on the About tab."}</p>
    </div>

    <div class="card block">
      <h3>{job?.state === "done" ? "Uploaded" : job?.state === "failed" ? "Upload failed" : "Upload"}</h3>
      {#if !tool.found && !tool.can_install}
        <p>{tool.install_why || tool.why || "JR!TER cannot find ffmpeg on this machine."}</p>
        <p class="hint">Everything above still works: make the file, save it and upload it yourself for now.</p>
      {:else if !account.accounts.length}
        <!-- The account is the server's, not the song's: it's set up once, in Settings. -->
        <div class="row wrap"><span class="grow">No YouTube account yet.</span>
          <a class="btn sm" href={href.settings("account")}>Connect in Settings</a></div>
      {:else if running && job}
        <div class="row"><span class="grow">{job.step}</span></div>
        <span class="bar big"><span style:width="{Math.round((job.at || 0) * 100)}%"></span></span>
        {#if job.total}<p class="hint num">{bytes(job.sent)} of {bytes(job.total)}</p>{/if}
        <div class="row"><button class="btn sm ghost" onclick={stop}>Stop</button></div>
      {:else if job?.state === "done"}
        <p><a href={job.url} target="_blank" rel="noopener noreferrer">{job.url}</a></p>
        <p class="hint">It is {job.privacy_got} on YouTube.{job.privacy_asked !== "private" && job.privacy_got === "private" ? ` You asked for ${job.privacy_asked}. Google forces every upload from a project it has not audited to private. Change it in YouTube Studio, or wait for the audit.` : ""}</p>
        <p class="hint">The link is saved against {version ? versionName(version) : "the render"} above.</p>
      {:else}
        {#if job?.state === "failed"}
          <p>{job.error}</p>{#if job.fix}<p class="hint">{job.fix}</p>{/if}
          {#if job.log?.length}<pre class="log">{job.log.join("\n")}</pre>{/if}
        {/if}
        {#if !bounced}
          <p class="hint">Make the file above first. What goes up is exactly what you can play here.</p>
        {:else}
          <p class="hint">JR!TER makes a video out of this mix and the artwork and sends it to {chosenName}. About {bytes(bounced.blob.size)} goes to the server; the video that goes to YouTube is a good deal smaller.
            {#if !tool.found}It has no ffmpeg yet, so it will first fetch one ({tool.install_version}, about {bytes(tool.install_size || 0)}, once).{/if}</p>
          <div class="row wrap"><button class="btn primary" onclick={send}><Icon name="upload" size={16} />{job?.state === "failed" ? "Try again" : "Upload"}</button>
            <span class="faint small">as {chosenName}{#if account.accounts.length > 1} · <a href={href.settings("account")}>change</a>{/if}</span></div>
        {/if}
      {/if}
    </div>

  {/if}
</section>

<style>
  .block { padding: var(--s5); display: flex; flex-direction: column; gap: var(--s3); }
  .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: var(--s3); }
  @media (max-width: 640px) { .grid2 { grid-template-columns: 1fr; } }
  .summary { font-size: var(--t-sm); }
  .bar { flex: 1 1 120px; height: 6px; border-radius: 99px; background: var(--line-2); overflow: hidden; max-width: 260px; }
  .bar.big { max-width: none; height: 8px; }
  .bar span { display: block; height: 100%; background: var(--accent); transition: width 300ms var(--ease); }
  .made { border: 1px solid var(--line); border-radius: var(--r-md); padding: var(--s3); display: flex; flex-direction: column; gap: var(--s2); }
  .made.hot { border-color: var(--warn); }
  .warn { color: var(--warn); font-size: var(--t-sm); }
  audio { width: 100%; }
  .pills { display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--s2); }
  @media (max-width: 640px) { .pills { grid-template-columns: 1fr; } }
  .pill { display: flex; flex-direction: column; gap: 2px; text-align: left; padding: var(--s3) var(--s4); border-radius: var(--r-md); border: 1px solid var(--glass-line); background: var(--glass-2); -webkit-backdrop-filter: var(--glass-filter-thin); backdrop-filter: var(--glass-filter-thin); color: var(--text); }
  .pill span { font-size: var(--t-xs); color: var(--text-3); font-weight: 500; }
  .pill.on { border-color: var(--accent-line); background: var(--accent-soft); }
  .log { font: 500 var(--t-xs)/1.4 var(--mono); max-height: 200px; overflow: auto; padding: var(--s3); background: rgba(0, 0, 0, 0.3); border-radius: var(--r-md); white-space: pre-wrap; }
  .arr { display: flex; align-items: center; gap: var(--s3); padding: 0; }
  .arr .what { flex: 1 1 auto; }
</style>
