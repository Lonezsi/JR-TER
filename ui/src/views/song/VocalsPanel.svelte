<!-- Voices over the song: recorded here or brought in, played with it, each with its own
     switch and its own vocal edit. The engine (lib/audio/vocals) follows the player; this
     is only what you press. Rendered inside the Takes tab when the module is on. -->
<script lang="ts" module>
  // Panels alive right now. A recording that is stopped by leaving still uploads its last
  // pass, and fetching the list afterwards hands the engine the song again: it is let go
  // once more after that, unless another panel has taken over by then.
  let alive = 0;
</script>

<script lang="ts">
  import { onMount, onDestroy, untrack } from "svelte";
  import { hidden } from "$lib/later.svelte";
  import Dropdown from "$ui/Dropdown.svelte";
  import Icon from "$ui/Icon.svelte";
  import { devices, refreshDevices, setInput, setOutput, canPickOutput } from "$lib/audio/devices.svelte";
  import TakeRow from "./vocals/TakeRow.svelte";
  import {
    vocals, voices, loadTakes, addRecording, canRecord, startRecording, stopRecording,
    mixdown, downloadBlob,
  } from "$lib/audio/vocals.svelte";
  import { useSong } from "./song.svelte";
  import { useCommands } from "$lib/commands";
  import { showMenu } from "$lib/menu.svelte";
  import { toast } from "$lib/toast.svelte";
  import { time } from "$lib/util";

  const song = useSong();
  const sid = $derived(Number(song.id));
  const on = $derived(song.has("vocals"));

  // The list belongs to one song: never show another song's takes while this one loads.
  const takes = $derived(voices.songId === sid ? voices.takes.filter((t) => !hidden(`take:${t.id}`)) : []);
  const first = $derived(voices.loading && !takes.length);
  const recording = $derived(voices.recording);

  let open = $state<number | null>(null);
  let note = $state("");
  let adding = $state(false);
  let mixing = $state(false);
  let over = $state(false);
  let picker: HTMLInputElement | undefined = $state();
  let clock = $state(performance.now());

  /** The render the voices sit on: what is in A, which is the song's current one at rest. */
  const bed = $derived(song.versionOf("A")?.id ?? song.current?.id ?? null);

  onMount(() => { void refreshDevices(); });
  const devLabel = (d: MediaDeviceInfo, i: number, what: string) => d.label || `${what} ${i + 1}`;
  onMount(() => {
    alive++;
    if (on) void loadTakes(sid, untrack(() => bed));
  });
  onDestroy(() => {
    alive--;
    // Leaving mid-recording stops it: there would be no button left to do so.
    const was = !!voices.recording;
    stopRecording();
    vocals.leave();
    if (was) setTimeout(() => { if (!alive) vocals.leave(); }, 8000);
  });

  // The render changed under the voices (another take put in A, a new render): tell the
  // engine, which re-queues anything that sidechains against it.
  $effect(() => {
    const version = bed;
    untrack(() => { if (voices.songId === sid) vocals.use(sid, voices.takes, version); });
  });

  // Elapsed time while recording.
  $effect(() => {
    if (!recording) return;
    const timer = setInterval(() => { clock = performance.now(); }, 250);
    return () => clearInterval(timer);
  });

  async function explain() {
    if (!navigator.mediaDevices) {
      note = window.isSecureContext
        ? "This browser cannot record."
        : "Browsers only allow the microphone on a secure address. Open JR!TER over https, or on localhost.";
      return;
    }
    if (!window.MediaRecorder) { note = "This browser cannot record. A recent Chrome, Edge, Firefox or Safari can."; return; }
    let state = "";
    try { state = (await navigator.permissions.query({ name: "microphone" as PermissionName })).state; } catch { /* not every browser says */ }
    note = state === "denied"
      ? "The microphone is blocked for this site. Allow it from the lock icon in the address bar, then press Record again."
      : "No microphone was found, or the request was dismissed. Plug one in, press Record again and choose Allow.";
  }

  if (typeof navigator !== "undefined" && !canRecord()) void explain();

  async function record() {
    if (!song.song) return;
    note = "";
    const started = await startRecording(song.song);
    if (!started && !voices.recording) await explain();
  }

  async function add(files: FileList | File[] | null) {
    const list = Array.from(files || []).filter((f) => f.type.startsWith("audio/") || /\.(wav|mp3|m4a|ogg|opus|flac|webm|aac)$/i.test(f.name));
    if (!list.length) { if (files && (files as FileList).length) toast("That is not a recording.", "bad"); return; }
    adding = true;
    try { for (const file of list) await addRecording(sid, file); } finally { adding = false; }
  }

  async function combine(withRender: boolean) {
    if (mixing) return;
    mixing = true;
    try {
      const blob = await mixdown(takes, withRender ? song.current : null);
      if (blob) downloadBlob(blob, `${song.song?.title || "Song"} ${withRender ? "with vocals" : "vocals"}.wav`);
    } catch {
      toast("That did not come together. Try again.", "bad");
    } finally {
      mixing = false;
    }
  }

  const mixMenu = (e: MouseEvent) => showMenu([
    { label: "Voices only", icon: "mic", run: () => combine(false) },
    { label: "Voices with the render", icon: "songs", disabled: !song.current, run: () => combine(true) },
  ], { anchor: e.currentTarget as Element });

  function dropped(e: DragEvent) {
    over = false;
    if (!e.dataTransfer?.files?.length) return;
    e.preventDefault();
    void add(e.dataTransfer.files);
  }

  useCommands(() => !on ? [] : [
    recording
      ? { id: "vocals.stop", title: "Stop recording", icon: "stop", run: stopRecording }
      : { id: "vocals.record", title: "Record a vocal take", sub: song.song?.title, icon: "record", keywords: "voice sing mic", run: record },
    { id: "vocals.add", title: "Add an existing recording as a take", icon: "upload", run: () => picker?.click() },
    takes.length ? { id: "vocals.mix", title: "Download the vocals as one file", icon: "download", run: () => combine(false) } : null,
  ].filter((c) => !!c));

  const level = $derived(Math.min(1, Math.sqrt(voices.level)));
</script>

{#if on}
  <section class="vox" class:dropping={over} aria-label="Vocals"
           ondragover={(e) => { if (e.dataTransfer?.types.includes("Files")) { e.preventDefault(); over = true; } }}
           ondragleave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) over = false; }}
           ondrop={dropped}>
    <div class="section-head">
      <h3>Vocals{#if takes.length} <span class="faint num">{takes.length}</span>{/if}</h3>
      {#if takes.length}
        <button class="btn sm ghost" type="button" disabled={mixing} onclick={mixMenu}>
          {#if mixing}<span class="spinner"></span> Putting it together{:else}<Icon name="download" size={15} /> Download combined{/if}
        </button>
      {/if}
    </div>

    <div class="card panel">
      <div class="controls">
        {#if recording}
          <button class="btn lg danger" type="button" onclick={stopRecording}>
            <Icon name="stop" size={18} /> Stop
          </button>
          <div class="live grow" aria-live="polite">
            <span class="dot"></span>
            <b>Recording, take {recording.count + 1}</b>
            <span class="num faint">{time((clock - recording.startedAt) / 1000)}</span>
          </div>
        {:else}
          <button class="btn lg primary" type="button" disabled={!canRecord()} onclick={record}>
            <Icon name="record" size={18} /> Record
          </button>
          <button class="btn" type="button" disabled={adding} onclick={() => picker?.click()}>
            {#if adding}<span class="spinner"></span> Adding{:else}<Icon name="upload" size={16} /> Upload a take{/if}
          </button>
        {/if}
        <!-- Which mic records and where the song plays while you record. -->
        <div class="devices">
          <label class="dev" title="Microphone">
            <Icon name="mic" size={15} />
            <Dropdown size="sm" label="Microphone" value={devices.input} onchange={setInput}
                      options={[{ value: "", label: "Default mic" }, ...devices.inputs.map((d, i) => ({ value: d.deviceId, label: devLabel(d, i, "Microphone") }))]} />
          </label>
          {#if canPickOutput()}
            <label class="dev" title="Speakers or headphones">
              <Icon name="volume" size={15} />
              <Dropdown size="sm" label="Output" value={devices.output} onchange={setOutput}
                        options={[{ value: "", label: "Default output" }, ...devices.outputs.map((d, i) => ({ value: d.deviceId, label: devLabel(d, i, "Output") }))]} />
            </label>
          {/if}
        </div>
        <input bind:this={picker} type="file" accept="audio/*" multiple hidden aria-label="Choose recordings"
               onchange={(e) => { void add(e.currentTarget.files); e.currentTarget.value = ""; }} />
      </div>

      {#if recording}
        <div class="meter" role="meter" aria-label="Microphone level" aria-valuemin="0" aria-valuemax="1"
             aria-valuenow={Number(voices.level.toFixed(2))}>
          <span class:hot={level > 0.92} style:width="{level * 100}%"></span>
        </div>
        <p class="faint hint">The song loops while you record. Every pass is its own take.</p>
      {:else}
        <p class="faint hint">Wear headphones so the song doesn't bleed in.{#if !devices.named && devices.inputs.length}{" "}Device names show once the mic is allowed.{/if}</p>
      {/if}

      {#if note}
        <div class="notice bad" role="alert"><Icon name="warning" size={16} /> <span>{note}</span></div>
      {/if}

      {#if first}
        <div class="sk-rows" aria-hidden="true"><div class="sk"></div><div class="sk"></div></div>
      {:else if takes.length}
        <div class="takes">
          {#each takes as take (take.id)}
            <TakeRow {take} open={open === take.id} ontoggle={() => (open = open === take.id ? null : take.id)} />
          {/each}
        </div>
      {:else}
        <div class="none">
          <Icon name="mic" size={22} />
          <p>No vocals yet. Record over the song or upload one.</p>
        </div>
      {/if}
    </div>
  </section>
{/if}

<style>
  .vox { display: flex; flex-direction: column; gap: var(--s3); border-radius: var(--r-lg); }
  .panel { padding: var(--s3); display: flex; flex-direction: column; gap: var(--s3); }
  .controls { display: flex; align-items: center; gap: var(--s3); flex-wrap: wrap; }
  .live { display: flex; align-items: center; gap: var(--s2); min-width: 0; }
  .dot { width: 10px; height: 10px; border-radius: 50%; background: var(--bad); animation: shimmer 1.1s ease-in-out infinite; flex: none; }
  .meter { height: 8px; border-radius: 99px; background: var(--line-2); overflow: hidden; }
  .meter span { display: block; height: 100%; border-radius: 99px; background: var(--good); transition: width 60ms linear; }
  .meter span.hot { background: var(--bad); }
  .hint { font-size: var(--t-sm); margin: 0; }
  .takes { display: flex; flex-direction: column; }
  .sk-rows { display: flex; flex-direction: column; gap: var(--s2); }
  .sk-rows .sk { height: 48px; }
  .none { display: flex; flex-direction: column; align-items: center; text-align: center; gap: var(--s2); padding: var(--s5) var(--s3); color: var(--text-2); }
  .none p { max-width: 44ch; }
  @media (max-width: 640px) {
    .controls { flex-wrap: nowrap; }
    .controls .btn.lg { height: 42px; padding: 0 var(--s5); font-size: var(--t-md); }
  }
  @media (prefers-reduced-motion: reduce) { .dot { animation: none; } }
  .devices { display: flex; align-items: center; gap: var(--s2); flex-wrap: wrap; margin-left: auto; }
  .dev { display: inline-flex; align-items: center; gap: var(--s2); color: var(--text-3); }
  .dev :global(.dropdown-field) { max-width: 200px; }
  /* A phone: the two pickers share the row evenly and their names truncate inside. */
  :global(html[data-narrow]) .devices { width: 100%; margin-left: 0; }
  :global(html[data-narrow]) .dev { flex: 1 1 100%; min-width: 0; }
  :global(html[data-narrow]) .dev :global(.dropdown-field) { width: 100%; max-width: none; }
</style>
