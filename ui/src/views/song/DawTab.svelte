<!-- The DAW tab: this song's DAW project as an overview you can play and save as .mid.
     It reads the project with the DAW's own code (web/daw/preview.js), so there is one
     engine. The full editor is /daw.html. A song with no project can start one from a .mid. -->
<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import Icon from "$ui/Icon.svelte";
  import { api } from "$lib/api";
  import { toast } from "$lib/toast.svelte";
  import { shell } from "../../shell/state.svelte";
  import { previewOf, due, midiOf, songFromMidi, textToSong, songToText, createSynth, type DawSong, type Preview } from "../../../../web/daw/preview.js";
  import { useSong } from "./song.svelte";

  const song = useSong();
  const openHref = $derived(`/daw.html?song=${encodeURIComponent(String(song.id))}`);
  const path = $derived(`/api/songs/${encodeURIComponent(String(song.id))}/daw`);

  let loading = $state(true);
  let error = $state("");
  let project = $state<DawSong | null>(null);
  let prev = $state<Preview | null>(null);
  let rev = 0;

  function show(text: string) {
    if (!text) { project = null; prev = null; return; }
    project = textToSong(text);
    prev = previewOf(project);
  }
  async function load() {
    loading = true; error = "";
    try { const j = await api<{ text: string; rev: number }>(path); rev = j.rev || 0; show(j.text || ""); }
    catch (e) { error = (e as Error).message || "Could not load the project."; }
    loading = false;
  }
  onMount(load);

  const hue = (i: number) => (i * 67) % 360;
  const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

  // ── canvas ──────────────────────────────────────────────────────────────
  let canvas = $state<HTMLCanvasElement>();
  let box = $state<HTMLElement>();
  let width = $state(600);
  let pos = $state(0); // seconds
  const height = $derived(shell.narrow ? 150 : 200);

  function draw() {
    if (!canvas || !prev) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
    const g = canvas.getContext("2d")!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const css = getComputedStyle(canvas);
    const line = css.getPropertyValue("--line-2").trim() || "#8884";
    const accentC = css.getPropertyValue("--accent").trim() || "#fff";
    g.clearRect(0, 0, width, height);
    const px = width / prev.beats, rows = prev.high - prev.low + 1, rh = height / rows;
    g.strokeStyle = line; g.lineWidth = 1;
    for (let b = 0; b <= prev.beats; b += 4) { const x = Math.round(b * px) + 0.5; g.beginPath(); g.moveTo(x, 0); g.lineTo(x, height); g.stroke(); }
    for (const n of prev.notes) {
      g.fillStyle = `hsl(${hue(n.track)} 70% 60%)`;
      g.globalAlpha = n.silent ? 0.3 : 0.95;
      g.fillRect(n.start * px, (prev.high - n.pitch) * rh, Math.max(2, n.length * px - 1), Math.max(2, rh - 1));
    }
    g.globalAlpha = 1;
    const x = (pos / prev.seconds) * width;
    g.fillStyle = accentC; g.fillRect(x - 1, 0, 2, height);
  }
  $effect(() => { void [prev, width, height, pos, canvas]; draw(); });
  $effect(() => {
    if (!box) return;
    const ro = new ResizeObserver(() => { width = Math.max(120, Math.floor(box!.clientWidth)); });
    ro.observe(box);
    return () => ro.disconnect();
  });

  // ── playing ─────────────────────────────────────────────────────────────
  let playing = $state(false);
  let ctx: AudioContext | null = null;
  let master: GainNode | null = null;
  let timer = 0, raf = 0;

  function halt() {
    playing = false;
    clearInterval(timer); cancelAnimationFrame(raf);
    if (master) { master.disconnect(); master = null; }
  }
  function play() {
    if (!prev) return;
    const p = prev;
    if (pos >= p.seconds - 0.05) pos = 0;
    ctx ??= new AudioContext();
    void ctx.resume();
    const synth = createSynth(ctx);
    const out = ctx.createGain(); out.gain.value = 0.8; out.connect(ctx.destination);
    master = out;
    const t0 = ctx.currentTime + 0.05, from0 = pos;
    let cursor = from0;
    const pump = () => {
      if (!ctx || master !== out) return;
      const upto = Math.min(p.seconds, ctx.currentTime - t0 + from0 + 0.3);
      for (const n of due(p.notes, cursor, upto)) synth.playNote({ instrument: n.instrument, pitch: n.pitch, time: t0 + (n.time - from0), length: n.dur, velocity: n.velocity }, out);
      cursor = Math.max(cursor, upto);
    };
    pump(); timer = window.setInterval(pump, 100);
    playing = true;
    const tick = () => {
      if (!ctx || master !== out) return;
      pos = Math.min(p.seconds, Math.max(from0, ctx.currentTime - t0 + from0));
      if (pos >= p.seconds) { halt(); return; }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
  }
  function toggle() { if (playing) halt(); else play(); }
  function seek(sec: number) {
    if (!prev) return;
    const was = playing;
    halt(); pos = Math.max(0, Math.min(prev.seconds, sec));
    if (was) play();
  }
  function onpointer(e: PointerEvent) {
    if (!prev || !canvas) return;
    const go = (ev: PointerEvent) => { const r = canvas!.getBoundingClientRect(); pos = Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width)) * prev!.seconds; };
    canvas.setPointerCapture(e.pointerId);
    const was = playing; halt(); go(e);
    const move = (ev: PointerEvent) => go(ev);
    const up = () => { canvas!.removeEventListener("pointermove", move); canvas!.removeEventListener("pointerup", up); if (was) play(); };
    canvas.addEventListener("pointermove", move); canvas.addEventListener("pointerup", up);
  }
  function onkey(e: KeyboardEvent) {
    if (!prev) return;
    const bar = (60 / prev.bpm) * 4;
    if (e.key === "ArrowRight") { e.preventDefault(); seek(pos + bar); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); seek(pos - bar); }
  }
  onDestroy(() => { halt(); void ctx?.close(); });

  // ── files ───────────────────────────────────────────────────────────────
  function saveMid() {
    if (!project) return;
    const url = URL.createObjectURL(new Blob([midiOf(project) as BlobPart], { type: "audio/midi" }));
    const a = document.createElement("a");
    a.href = url; a.download = `${song.song?.title || "song"}.mid`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function loadMid(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    try {
      const s = songFromMidi(new Uint8Array(await file.arrayBuffer()));
      const r = await api<{ rev: number; conflict: boolean; text?: string }>(path, { method: "PUT", json: { text: songToText(s), base: rev } });
      if (r.conflict) { rev = r.rev; show(r.text || ""); toast("Somebody saved a project first. Showing theirs."); return; }
      rev = r.rev; show(songToText(s));
    } catch (err) { toast((err as Error).message || "Could not load that file."); }
  }
</script>

<div class="daw">
  {#if loading}
    <p class="mute">Loading the project…</p>
  {:else if error}
    <p class="mute">{error}</p>
    <button class="btn sm" onclick={load}>Try again</button>
  {:else if !prev}
    <p class="mute">This song has no DAW project yet.</p>
    <div class="bar">
      <a class="btn sm" href={openHref}><Icon name="external" size={14} />Open the DAW</a>
      <label class="btn sm ghost">
        <Icon name="upload" size={14} />Load a .mid
        <input class="file" type="file" accept=".mid,.midi,audio/midi" onchange={loadMid} />
      </label>
    </div>
  {:else}
    <div class="bar">
      <button class="btn sm" onclick={toggle} data-tip={playing ? "Stop" : "Play"} aria-label={playing ? "Stop" : "Play"}><Icon name={playing ? "stop" : "play"} size={14} /></button>
      <span class="num">{clock(pos)} / {clock(prev.seconds)}</span>
      <span class="mute grow">{Math.round(prev.bpm)} BPM · {prev.tracks.length} {prev.tracks.length === 1 ? "track" : "tracks"}</span>
      <button class="btn sm ghost" onclick={saveMid} data-tip="Save as .mid" aria-label="Save as .mid"><Icon name="download" size={14} /></button>
      <a class="btn sm" href={openHref} data-tip="Open in the DAW" aria-label="Open in the DAW"><Icon name="external" size={14} />Open in the DAW</a>
    </div>
    <div class="roll" bind:this={box}>
      <canvas bind:this={canvas} style:width="{width}px" style:height="{height}px" tabindex="0"
        aria-label="{prev.tracks.length} tracks, {Math.round(prev.bpm)} BPM, {clock(prev.seconds)} long. Arrow keys move one bar."
        onpointerdown={onpointer} onkeydown={onkey}></canvas>
    </div>
    <ul>
      {#each prev.tracks as t, i (i)}
        <li>
          <span class="sw" style:background="hsl({hue(i)} 70% 60%)"></span>
          <span class="grow">{t.name}</span>
          <span class="mute">{t.instrument}</span>
          {#if t.sampled}<span class="tag" data-tip="This track uses a sampler, which only plays in the DAW">plays in the DAW only</span>
          {:else if t.muted}<span class="tag">muted</span>{/if}
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .daw { display: flex; flex-direction: column; gap: var(--s3); }
  .bar { display: flex; align-items: center; gap: var(--s3); flex-wrap: wrap; }
  .roll { min-width: 0; border-radius: var(--r-md); overflow: hidden; background: var(--well, transparent); }
  canvas { display: block; touch-action: none; cursor: pointer; max-width: 100%; }
  ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--s2); }
  li { display: flex; align-items: center; gap: var(--s2); font-size: var(--t-md); }
  .sw { width: 10px; height: 10px; border-radius: var(--r-pill); flex: none; }
  .grow { flex: 1; min-width: 0; overflow-wrap: anywhere; }
  .mute { opacity: 0.65; font-size: 12px; margin: 0; }
  .bar .mute { white-space: nowrap; flex: 1 1 auto; min-width: 0; }
  .tag { font-size: var(--t-xs); padding: 1px var(--s2); border-radius: var(--r-pill); border: 1px solid currentColor; opacity: 0.7; }
  .file { position: absolute; width: 1px; height: 1px; opacity: 0; pointer-events: none; }
  label.btn { position: relative; cursor: pointer; }
</style>
