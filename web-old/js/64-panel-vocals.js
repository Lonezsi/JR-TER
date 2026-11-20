/* Voices over a song: recorded here, layered, and played with it.
 *
 * Above the words, collapsible. At the top, which render and which sound the voices sit
 * on. Under that every take, anybody's, each with its switch and its download. A plus to
 * record now or bring a recording, and at the bottom one download of everything together.
 *
 * RECORDING starts where the player is. If another song is playing, this one takes over.
 * While recording, the song loops, and each time it comes round again the pass that just
 * ended becomes its own take: sing it three times and there are three takes to choose from.
 *
 * PLAYING the layers is a small engine of its own, below, that follows the player. It does
 * nothing at all unless this song is the one playing: no timer, no decoding, no CPU.
 *
 * THE VOCAL EDIT on each take (EQ, limiter, autotune, sidechain) is 65-vocal-fx.js. It
 * renders in the background and hands this engine a finished buffer to play.
 */
"use strict";

J.vocals = (function () {
  /* Keyed by the take and its bytes, never the id alone. An id comes back: delete the
   * newest take and record another, and SQLite hands out the same number. The browser
   * keeps a file for a day, so the address carries the digest as well. */
  const buffers = new Map();       // id:digest -> decoded AudioBuffer
  const loading = new Map();       // id:digest -> Promise, so one take decodes once
  const keyOf = (take) => `${take.id}:${take.digest || ""}`;
  let takes = [];                  // what the page last said this song has
  let songId = null;
  let version = null;              // the render the voices sit on, for the sidechain
  let sources = [];
  let bus = null;
  let watching = 0;
  let anchor = null;               // { ctxTime, songPos } when the layers were started

  async function decode(take) {
    const key = keyOf(take);
    if (buffers.has(key)) return buffers.get(key);
    if (!loading.has(key)) {
      loading.set(key, (async () => {
        const ctx = J.audio.context();
        const bytes = await fetch(J.vocalUrl(take)).then((r) => r.arrayBuffer());
        const buffer = await ctx.decodeAudioData(bytes);
        buffers.set(key, buffer);
        return buffer;
      })().catch(() => { loading.delete(key); return null; }));
    }
    return loading.get(key);
  }

  function stopSources() {
    sources.forEach((s) => { try { s.stop(); } catch (e) { /* already stopped */ } });
    sources = [];
    anchor = null;
  }

  function stopAll() {
    stopSources();
    J.vocalFx.ducker.off();
  }

  function here() {
    const st = J.player.state;
    return st.song && Number(st.song.id) === Number(songId) && st.playing;
  }

  /* Start every switched-on take from where the song is now. */
  async function start() {
    stopSources();
    if (!here()) { J.vocalFx.ducker.off(); return; }
    const ctx = J.audio.context();
    if (!bus) { bus = ctx.createGain(); bus.connect(J.audio.output()); }
    const on = takes.filter((t) => t.enabled);
    await Promise.all(on.map(decode));
    if (!here()) return;
    const lead = 0.06;
    const pos = J.player.now() + lead;
    const when = ctx.currentTime + lead;
    for (const take of on) {
      const buffer = J.vocalFx.bufferFor(take, buffers.get(keyOf(take)));
      if (!buffer) continue;
      const into = pos - take.offset;
      if (into >= buffer.duration) continue;
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      const level = ctx.createGain();
      level.gain.value = take.gain == null ? 1 : take.gain;
      src.connect(level).connect(bus);
      if (into >= 0) src.start(when, into);
      else src.start(when - into, 0);
      sources.push(src);
    }
    anchor = { ctxTime: when, songPos: pos };
    // Voices that duck the render: their curves, from here on.
    const ducks = J.vocalFx.ducks(on);
    if (ducks.length) {
      const end = Math.max(...ducks.map((d) => d.offset + d.curves[0].length / J.vocalFx.RATE));
      J.vocalFx.ducker.play(J.vocalFx.combine(ducks, end), pos, when);
    } else {
      J.vocalFx.ducker.off();
    }
  }

  /* While this song plays, check the layers are where the song is, a few times a second.
   * A seek, a loop or a stall moves the song; the layers are restarted to follow it. */
  function watch() {
    clearInterval(watching);
    watching = 0;
    if (!here()) { stopAll(); return; }
    if (!anchor) start();
    watching = setInterval(() => {
      if (!here()) { clearInterval(watching); watching = 0; stopAll(); return; }
      if (!anchor) return;
      const ctx = J.audio.context();
      const expected = anchor.songPos + (ctx.currentTime - anchor.ctxTime);
      if (Math.abs(expected - J.player.now()) > 0.12) start();
    }, 250);
  }

  J.on("player:change", () => { if (songId != null) watch(); });
  // A vocal edit finished rendering: play the new one from where the song is.
  J.on("vocals:rendered", () => { if (songId != null && here()) start(); });

  return {
    /* The page says which song and which takes. Changing either restarts the layers. */
    use(id, list, versionId) {
      songId = id;
      takes = list || [];
      version = versionId || null;
      J.vocalFx.want(takes, version);
      if (here()) start(); else stopAll();
      watch();
    },
    leave() { songId = null; takes = []; stopAll(); clearInterval(watching); watching = 0; },
    /* A take's edit changed: queue it for rendering. Playing carries on as it was. */
    refresh() { J.vocalFx.want(takes, version); },
    /* How many layers are sounding right now, and whether anything is keeping watch. */
    get live() { return { layers: sources.length, watching: !!watching }; },
    decode,
    buffers,
  };
})();

/* Where a take's bytes are. See the note on the buffers above for why the digest. */
J.vocalUrl = (take) => J.u(`/api/vocals/${take.id}/audio`) + "?v=" + encodeURIComponent(take.digest || "");

J.blockVocals = async function (block, ctx) {
  const OPEN_KEY = "jriter.vocals.open";
  let open = true;
  try { open = localStorage.getItem(OPEN_KEY) !== "0"; } catch (e) { /* fine */ }
  let takes = [];
  let rec = null;                  // the recording under way, if any

  async function load() {
    const data = await J.try(() => J.get(`/api/songs/${ctx.songId}/vocals`));
    takes = (data && data.takes) || [];
    J.vocals.use(ctx.song.id, takes, bedVersion());
    draw();
  }

  const mayChange = (t) => t.yours || !J.sharedAs;
  const bedVersion = () => {
    const st = J.player.state;
    const v = (st.song && st.song.id === ctx.song.id && st.slots.A.version) || ctx.currentVersion();
    return v ? v.id : null;
  };

  function draw() {
    const cur = J.player.state.song && J.player.state.song.id === ctx.song.id
      ? J.player.state.slots.A.version : null;
    const version = cur || ctx.currentVersion();
    const preset = J.deckPreset(ctx, "A");
    block.innerHTML = `
      <div class="block-head">
        <button class="vox-fold" type="button" data-act="fold" aria-expanded="${open}">
          <h2>Vocals${takes.length ? ` <span class="faint">${takes.length}</span>` : ""}</h2>
          <span class="caret">${open ? "&#9662;" : "&#9656;"}</span>
        </button>
        <span class="grow"></span>
        ${rec ? `<span class="vox-live">&#9679; Recording, take ${rec.count + 1}</span>
          <button class="btn sm danger" data-act="stop">Stop</button>` : ""}
      </div>
      ${open ? `
        <div class="pane vox">
          <div class="vox-bed">
            <label>Render <select class="field sm" data-bed="version">${ctx.versions.map((v) =>
              `<option value="${v.id}"${version && v.id === version.id ? " selected" : ""}>
                 v${v.n} ${J.esc(v.filename || "")}</option>`).join("") || "<option>none yet</option>"}
            </select></label>
            <label>Sound <select class="field sm" data-bed="preset">
              <option value="">flat</option>${ctx.presets.map((p) =>
              `<option value="${p.id}"${preset && p.id === preset.id ? " selected" : ""}>
                 ${J.esc(p.name)}</option>`).join("")}
            </select></label>
          </div>
          ${takes.map((t) => `
            <div class="list-row vox-take" data-take="${t.id}">
              <button class="switch ${t.enabled ? "on" : ""}" data-act="toggle"
                      ${mayChange(t) ? "" : "disabled"} aria-label="Play this take"></button>
              <span class="grow vox-name"><b class="truncate">${J.esc(t.name || "Take")}</b>
                <span class="faint truncate">${J.esc(t.by || "")} &middot; from ${J.time(t.offset)}
                  ${t.duration ? "&middot; " + J.time(t.duration) : ""}</span></span>
              <span class="vox-fx${t.fx !== 0 ? "" : " off"}">
                <button class="btn sm ghost" data-act="fx"
                        title="${mayChange(t) ? "EQ, limiter, autotune, sidechain" : "See the vocal edit"}">Edit${
                  (t.chain || []).length ? ` <span class="faint">${t.chain.length}</span>` : ""}</button>
                <button class="switch${t.fx !== 0 ? " on" : ""}" data-act="fxon" aria-pressed="${t.fx !== 0}"
                        ${mayChange(t) ? "" : "disabled"} aria-label="Use the vocal edit"
                        title="The vocal edit, on or off"></button>
              </span>
              <a class="icon-btn" href="${J.vocalUrl(t)}&download=1"
                 title="Download this voice" aria-label="Download">&darr;</a>
              ${mayChange(t) ? `<button class="icon-btn" data-act="drop" title="Delete this take"
                 aria-label="Delete">&times;</button>` : ""}
            </div>`).join("")}
          <div class="vox-foot">
            <button class="btn sm primary" data-act="add">+ Add a voice</button>
            <span class="grow"></span>
            ${takes.length ? `<button class="btn sm ghost" data-act="mix">Download combined</button>` : ""}
          </div>
          <p class="faint vox-tip">Headphones stop the song leaking into the microphone.</p>
        </div>` : ""}
      <input type="file" accept="audio/*" hidden data-pick>`;
  }

  // ── recording ─────────────────────────────────────────────────────────────
  async function record() {
    if (!navigator.mediaDevices || !window.MediaRecorder) {
      J.toast("This browser cannot record.", "bad");
      return;
    }
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: {
        echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    } catch (e) {
      J.toast("No microphone, or it was not allowed.", "bad");
      return;
    }
    // This song, from where the player is. Another song playing gives way to this one.
    const st = J.player.state;
    if (!st.song || st.song.id !== ctx.song.id) await J.playSong(ctx.song);
    else if (!st.playing) await J.player.toggle();
    const ctxA = J.audio.context();
    /* What the singer hears is late by the output latency, and what the microphone hands
     * over is late by its own. A take lined up by the clock alone lands behind the beat by
     * both, so each is placed that much earlier. */
    const track = stream.getAudioTracks()[0];
    const inLatency = (track.getSettings && track.getSettings().latency) || 0.01;
    const lag = (ctxA.outputLatency || 0) + (ctxA.baseLatency || 0) + inLatency;

    const was = J.player.state.repeat;
    J.player.state.repeat = "one";          // loop while recording
    const type = ["audio/webm;codecs=opus", "audio/mp4", "audio/ogg"].find(
      (t) => MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t)) || "";
    const ext = type.indexOf("mp4") !== -1 ? ".m4a" : type.indexOf("ogg") !== -1 ? ".ogg" : ".webm";

    rec = { stream, count: 0, was, stopping: false };
    const segment = () => {
      const r = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
      const chunks = [];
      const from = Math.max(0, J.player.now() - lag);
      const began = performance.now();
      r.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
      r.onstop = async () => {
        const seconds = (performance.now() - began) / 1000;
        if (seconds < 0.5) return;                 // a loop edge, not a take
        const blob = new Blob(chunks, { type: type || "audio/webm" });
        const who = (J.state.summary && J.state.summary.auth && J.state.summary.auth.who) || {};
        const name = `Take ${takes.length + 1}${who.name ? " (" + who.name + ")" : ""}`;
        await J.try(() => J.upload(`/api/songs/${ctx.songId}/vocals`,
          new File([blob], name + ext, { type: blob.type }),
          { "X-Offset": String(from), "X-Duration": String(seconds), "X-Label": name }));
        await load();
      };
      r.start(250);
      return r;
    };
    rec.recorder = segment();
    let last = J.player.now();
    rec.loop = setInterval(() => {
      const now = J.player.now();
      // The song came round again: that pass is a take, and the next one starts at 0.
      if (now + 1 < last && rec && !rec.stopping) {
        rec.recorder.stop();
        rec.count += 1;
        rec.recorder = segment();
        draw();
      }
      last = now;
    }, 100);
    draw();
  }

  function stop() {
    if (!rec) return;
    rec.stopping = true;
    clearInterval(rec.loop);
    try { rec.recorder.stop(); } catch (e) { /* already */ }
    rec.stream.getTracks().forEach((t) => t.stop());
    J.player.state.repeat = rec.was;
    if (J.player.state.playing) J.player.toggle();
    rec = null;
    draw();
  }

  // ── combining ─────────────────────────────────────────────────────────────
  async function combined(withRender) {
    const on = takes.filter((t) => t.enabled);
    if (!on.length) { J.toast("Switch on at least one take."); return; }
    J.toast("Putting it together...");
    const rate = 44100;
    await J.vocalFx.settle();
    const voices = await Promise.all(on.map(async (t) => J.vocalFx.bufferFor(t, await J.vocals.decode(t))));
    let bed = null;
    const version = ctx.currentVersion();
    if (withRender && version) {
      const bytes = await fetch(J.u(`/api/versions/${version.id}/audio`)).then((r) => r.arrayBuffer());
      bed = await J.audio.context().decodeAudioData(bytes);
      bed = await J.vocalFx.duckBed(bed, J.vocalFx.ducks(on));
    }
    const end = Math.max(bed ? bed.duration : 0,
      ...on.map((t, i) => (voices[i] ? t.offset + voices[i].duration : 0)));
    const off = new OfflineAudioContext(2, Math.ceil(end * rate) + rate, rate);
    if (bed) { const s = off.createBufferSource(); s.buffer = bed; s.connect(off.destination); s.start(0); }
    on.forEach((t, i) => {
      if (!voices[i]) return;
      const s = off.createBufferSource();
      s.buffer = voices[i];
      const g = off.createGain();
      g.gain.value = t.gain == null ? 1 : t.gain;
      s.connect(g).connect(off.destination);
      s.start(t.offset);
    });
    const done = await off.startRendering();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(J.wav(done));
    a.download = `${ctx.song.title} ${withRender ? "with vocals" : "vocals"}.wav`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
  }

  block.addEventListener("change", async (e) => {
    const bed = e.target.closest("[data-bed]");
    if (bed && bed.dataset.bed === "version") {
      const version = ctx.versions.find((v) => String(v.id) === bed.value);
      if (!J.player.state.song || J.player.state.song.id !== ctx.song.id) await J.playSong(ctx.song);
      if (version) await J.player.set("A", { version });
      J.vocals.use(ctx.song.id, takes, bedVersion());
    } else if (bed && bed.dataset.bed === "preset") {
      const preset = ctx.presets.find((p) => String(p.id) === bed.value) || null;
      await J.deckSetPreset(ctx, "A", preset);
    }
    const pick = e.target.closest("[data-pick]");
    if (pick && pick.files && pick.files[0]) {
      const file = pick.files[0];
      await J.try(() => J.upload(`/api/songs/${ctx.songId}/vocals`, file,
        { "X-Offset": "0", "X-Label": file.name.replace(/\.[^.]+$/, "") }), "Added");
      await load();
    }
  });

  block.addEventListener("click", async (e) => {
    const act = e.target.closest("[data-act]");
    if (!act) return;
    const row = act.closest("[data-take]");
    const take = row && takes.find((t) => String(t.id) === row.dataset.take);
    const what = act.dataset.act;
    if (what === "fold") {
      open = !open;
      try { localStorage.setItem(OPEN_KEY, open ? "1" : "0"); } catch (err) { /* fine */ }
      draw();
    } else if (what === "add") {
      J.menu.show([
        { label: "Record now", icon: "plus", run: record },
        { label: "Add an existing recording", run: () => J.$("[data-pick]", block).click() },
      ], { anchor: act });
    } else if (what === "stop") {
      stop();
    } else if (what === "fx" && take) {
      await J.editVocal(take, { mayChange: mayChange(take), changed: () => J.vocals.refresh() });
      draw();
    } else if (what === "fxon" && take) {
      take.fx = take.fx === 0 ? 1 : 0;
      draw();
      J.vocals.refresh();
      await J.try(() => J.patch(`/api/vocals/${take.id}`, { fx: take.fx }));
      if (J.player.state.playing) J.emit("vocals:rendered", { id: take.id });
    } else if (what === "toggle" && take) {
      await J.try(() => J.patch(`/api/vocals/${take.id}`, { enabled: !take.enabled }));
      await load();
    } else if (what === "drop" && take) {
      const sure = await J.confirm(`Delete ${take.name || "this take"}?`,
        "The recording goes for good.", "Delete it");
      if (!sure) return;
      await J.try(() => J.del(`/api/vocals/${take.id}`), "Deleted");
      await load();
    } else if (what === "mix") {
      J.menu.show([
        { label: "Voices only", run: () => combined(false) },
        { label: "Voices with the render", run: () => combined(true) },
      ], { anchor: act });
    }
  });

  await load();
};

/* An AudioBuffer as a 16 bit WAV file, for downloads. */
J.wav = (buffer) => {
  const ch = buffer.numberOfChannels;
  const len = buffer.length;
  const out = new DataView(new ArrayBuffer(44 + len * ch * 2));
  const put = (o, s) => { for (let i = 0; i < s.length; i++) out.setUint8(o + i, s.charCodeAt(i)); };
  put(0, "RIFF"); out.setUint32(4, 36 + len * ch * 2, true); put(8, "WAVEfmt ");
  out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, ch, true);
  out.setUint32(24, buffer.sampleRate, true); out.setUint32(28, buffer.sampleRate * ch * 2, true);
  out.setUint16(32, ch * 2, true); out.setUint16(34, 16, true); put(36, "data");
  out.setUint32(40, len * ch * 2, true);
  const data = [];
  for (let c = 0; c < ch; c++) data.push(buffer.getChannelData(c));
  let at = 44;
  for (let i = 0; i < len; i++) {
    for (let c = 0; c < ch; c++) {
      const v = Math.max(-1, Math.min(1, data[c][i]));
      out.setInt16(at, v < 0 ? v * 0x8000 : v * 0x7fff, true);
      at += 2;
    }
  }
  return new Blob([out], { type: "audio/wav" });
};
