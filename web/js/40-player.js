/* The player.
 *
 * A slot is a version and a preset together, because that is what you actually compare:
 * this mix through this equaliser against that mix through that one. Both decks run at
 * once with one silent, so switching is a gain swap and the playhead never moves.
 */
"use strict";

J.player = (function () {
  const state = {
    song: null,
    queue: [],
    /* What is in the queue: "song" or "render".
     *
     * Written when the queue is, by whoever had the list in their hands and therefore
     * knows. Next used to work this out from the row it was about to play and from what
     * was playing at the time, and a wrong answer there hands a render id to the songs
     * endpoint. A playlist holds both kinds, so there was a real way to be wrong. */
    queueKind: "song",
    index: -1,
    slots: { A: { version: null, preset: null }, B: { version: null, preset: null } },
    presets: [],
    active: "A",
    playing: false,
    duration: 0,
    position: 0,
    volume: 0.9,
    preparing: null,      // 0..1 while a render is being read for the compositor
    /* Play the same thing again when it ends. */
    /* "off", "one" or "all". Three states of one button, so one value.
     *
     * A boolean until now, and it meant "one", but it was drawn with the cycle icon that
     * means "all" everywhere else, so the player read as the opposite of what it did. */
    repeat: "off",
    /* Keep going when the queue runs out, by asking the library what is next.
     *
     * On by default, because stopping dead at the end of a list is what it used to do and
     * that is the behaviour somebody would come looking for a switch to change. The switch
     * exists either way, and both of these are remembered per browser. */
    autoplay: true,
    /* The last few songs autoplay has chosen, so a small library does not loop three of
     * them. Ids only, never written down anywhere but this tab's memory. */
    lately: [],
  };

  //: The order the repeat button cycles in, and the only values state.repeat takes.
  //:
  //: Off first because it is the resting state, then the narrower of the two: pressing
  //: once is the thing people press it for.
  const REPEATS = ["off", "one", "all"];

  //: What each state is called, for the title and the label. One place, because a control
  //: whose tooltip and whose aria-label are written separately ends up with two answers.
  const REPEAT_SAYS = {
    off: "Repeat off",
    one: "Repeating this one",
    all: "Repeating the whole list",
  };

  //: How much of the recent past autoplay refuses to repeat.
  //:
  //: Eight. Enough that a library of twenty does not feel like a loop, small enough that a
  //: library of ten still has somewhere to go.
  const LATELY = 8;
  const REMEMBER = "jriter.player.modes";

  let ticking = null;
  let seeking = false;

  /* The two switches, as this browser last left them.
   *
   * Read once, here, before anything draws. Reading it inside render() would be a
   * localStorage hit on every repaint of the player, which is every second while something
   * is playing. Anything unreadable leaves the defaults alone: repeat off, keep playing on.
   */
  try {
    const kept = JSON.parse(localStorage.getItem(REMEMBER) || "{}");
    /* A boolean is what older versions stored, and it meant repeat this one. */
    if (typeof kept.repeat === "boolean") state.repeat = kept.repeat ? "one" : "off";
    else if (REPEATS.includes(kept.repeat)) state.repeat = kept.repeat;
    if (typeof kept.autoplay === "boolean") state.autoplay = kept.autoplay;
  } catch (e) { /* a private window, or something that is not JSON */ }

  const el = () => J.$("#player");
  const audioOf = (slot) => J.audio.deck(slot).element;

  /* Is the compositor driving playback for the song on screen.
   *
   * When it is, the transport belongs to the arrangement: the audio elements stay
   * paused and the clips are scheduled instead. Everything else about the player, the
   * scrubber, the volume, the two chips, works exactly as it did. */
  const arranged = () => !!(J.arrange && J.arrange.state.enabled && state.song
                            && J.arrange.state.songId === state.song.id
                            && J.arrange.state.clips.length);
  const activeAudio = () => audioOf(state.active);
  const other = () => (state.active === "A" ? "B" : "A");

  async function ensureContext() {
    await J.audio.resume();
    ["A", "B"].forEach((slot) => J.audio.wire(slot));
    J.audio.setVolume(state.volume);
  }

  /* Where a playable thing's audio lives.
   *
   * A version of a song and a loose render in the Renders list are both just bytes with
   * a URL, and the player has no reason to care which it is holding. The kind is kept so
   * the few places that genuinely differ, writing a corrected duration back for one and
   * not the other, can ask. */
  /* Where a playable thing's bytes are.
   *
   * An item may carry its own url, and a shared song is why. The server works out which
   * file a share means from the share itself, so the recipient never names a version:
   * given a free choice of version id, playing a share would be a way to read any file in
   * any library on the server. The id in that case is a string, which is also why keyFor
   * exists rather than comparing ids directly. */
  const srcFor = (item) => (item.url ? item.url
    : item.kind === "render"
      ? `/api/renders/${item.id}/audio`
      : `/api/versions/${item.id}/audio`);
  //: A render id and a version id are both small integers, so the deck remembers which.
  const keyFor = (item) => `${item.kind || "version"}:${item.id}`;

  async function loadVersion(slot, version) {
    state.slots[slot].version = version || null;
    const deck = J.audio.deck(slot);
    if (!version) {
      deck.element.removeAttribute("src");
      deck.element.load();
      deck.versionId = null;
      return;
    }
    if (deck.versionId !== keyFor(version)) {
      deck.versionId = keyFor(version);
      deck.element.src = srcFor(version);
      deck.element.load();
    }
  }

  function applyPreset(slot, preset) {
    state.slots[slot].preset = preset || null;
    J.audio.applyTo(slot, preset ? preset.data : null);
  }

  function applyGains() {
    const anywhere = arranged();
    ["A", "B"].forEach((slot) => {
      // Arranged, both decks carry the same clips, so a slot is audible on its own
      // merits rather than on whether someone chose a second version for it.
      const has = anywhere || state.slots[slot].version;
      J.audio.setDeckGain(slot, slot === state.active && has ? 1 : 0);
    });
  }

  async function startBoth() {
    if (arranged()) {
      // Arranged playback needs the whole render decoded, and that is a real wait the
      // first time. It happens with the button showing what it is doing rather than
      // behind a press that appears to have done nothing.
      if (!J.arrange.ready()) {
        state.preparing = 0;
        render();
        const got = await J.try(() => J.arrange.ensure((fraction) => {
          state.preparing = fraction;
          paintPreparing();
        }));
        state.preparing = null;
        render();
        if (!got) return;
        if (!state.playing) return;        // they gave up while it loaded, which is fair
      }
      // The elements must be quiet: the same render coming from two places at once is
      // a flam, not a mix.
      ["A", "B"].forEach((slot) => audioOf(slot).pause());
      const ok = await J.arrange.start();
      if (!ok) J.toast("The arrangement has nothing to play yet.", "bad");
      return;
    }
    const jobs = [];
    ["A", "B"].forEach((slot) => {
      if (!state.slots[slot].version) return;
      jobs.push(audioOf(slot).play().catch(() => { /* autoplay refusal */ }));
    });
    await Promise.all(jobs);
  }

  function pauseBoth() {
    if (J.arrange) J.arrange.stop();
    ["A", "B"].forEach((slot) => audioOf(slot).pause());
  }

  function syncOther() {
    const slot = other();
    if (!state.slots[slot].version) return;
    const from = activeAudio();
    const to = audioOf(slot);
    if (Math.abs(to.currentTime - from.currentTime) > 0.05) to.currentTime = from.currentTime;
  }

  function tick() {
    ticking = requestAnimationFrame(tick);
    if (arranged()) {
      if (!seeking) state.position = J.arrange.position;
      state.duration = J.arrange.duration();
      if (J.arrange.finished()) {
        J.arrange.stop();
        state.playing = false;
        stopTicking();
        render();
        api.step(1);
        return;
      }
      paint();
      return;
    }
    const audio = activeAudio();
    if (!seeking) state.position = audio.currentTime || 0;
    if (audio.duration && Number.isFinite(audio.duration)) state.duration = audio.duration;
    paint();
  }
  const startTicking = () => { if (!ticking) tick(); };
  const stopTicking = () => { if (ticking) { cancelAnimationFrame(ticking); ticking = null; } };

  /* Just the loading figure, without rebuilding the bar around it. */
  function paintPreparing() {
    const node = el();
    if (!node) return;
    const label = J.$(".preparing-fill", node);
    if (label) label.style.width = `${Math.round((state.preparing || 0) * 100)}%`;
    const pct = J.$(".preparing-pct", node);
    if (pct) pct.textContent = `${Math.round((state.preparing || 0) * 100)}%`;
  }

  function paint() {
    const node = el();
    if (!node || node.hidden) return;
    const pct = state.duration ? (state.position / state.duration) * 100 : 0;
    const set = (sel, fn) => { const n = J.$(sel, node); if (n) fn(n); };
    set(".bar .fill", (n) => { n.style.width = `${pct}%`; });
    set(".bar .knob", (n) => { n.style.left = `${pct}%`; });
    set(".scrubber .now", (n) => { n.textContent = J.time(state.position); });
    set(".scrubber .total", (n) => { n.textContent = J.time(state.duration); });
    set(".bar .buffered", (n) => {
      const audio = activeAudio();
      let end = 0;
      try { if (audio.buffered.length) end = audio.buffered.end(audio.buffered.length - 1); }
      catch (e) { end = 0; }
      n.style.width = state.duration ? `${(end / state.duration) * 100}%` : "0%";
    });
  }

  function render() {
    const node = el();
    if (!node) return;
    if (!state.song) { node.hidden = true; return; }
    node.hidden = false;

    const slot = state.slots[state.active];
    const version = slot.version;
    const art = state.song.artwork_id ? `/api/artwork/${state.song.artwork_id}/image` : null;
    const hasB = !!state.slots.B.version || arranged();

    // The whole block leads somewhere, cover and words alike, rather than only the title.
    // A loose render has no song page: its id is "render:<n>", and the title used to link
    // to #/song/render:43, which is a dead end dressed as a link. It goes to the list it
    // actually lives in instead.
    const loose = state.song.kind === "render";
    const goes = loose ? "#/renders" : `#/song/${state.song.id}`;

    node.innerHTML = `
      <a class="now-playing" href="${goes}" data-link title="${
        loose ? "Show this in the renders list" : "Open the song"}">
        ${J.cover({ url: art, title: state.song.title })}
        <div class="truncate">
          <div class="t truncate">${J.esc(state.song.title)}</div>
          <div class="s truncate">${
            !version ? "no version"
              : version.kind === "render" ? "a render, not yet on a song"
              : `v${version.n}`}${
            slot.preset ? ` &middot; ${J.esc(slot.preset.name)}` : ""}</div>
        </div>
      </a>

      <div class="transport">
        <div class="transport-row">
          <button class="icon-btn" data-act="prev" title="Previous" aria-label="Previous">
            <svg viewBox="0 0 24 24" width="18" height="18"><path d="M7 6v12M19 6l-9 6 9 6z" fill="currentColor" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>
          </button>
          <button class="play-btn sm" data-act="toggle" aria-label="${state.playing ? "Pause" : "Play"}">
            ${state.playing
              ? '<svg viewBox="0 0 24 24" width="17" height="17"><path d="M8 5h3v14H8zM13 5h3v14h-3z" fill="currentColor"/></svg>'
              : '<svg viewBox="0 0 24 24" width="17" height="17"><path d="M8 5l12 7-12 7z" fill="currentColor"/></svg>'}
          </button>
          <button class="icon-btn" data-act="next" title="Next" aria-label="Next">
            <svg viewBox="0 0 24 24" width="18" height="18"><path d="M17 6v12M5 6l9 6-9 6z" fill="currentColor" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>
          </button>
        </div>
        ${state.preparing !== null && state.preparing !== undefined ? `
          <div class="preparing" title="Reading the render so it can be played as arranged">
            <span>Preparing the arrangement</span>
            <span class="preparing-bar"><span class="preparing-fill"></span></span>
            <span class="preparing-pct">0%</span>
          </div>` : `
        <div class="scrubber">
          <span class="t now">0:00</span>
          <div class="bar" data-act="seek">
            <span class="track-line"></span><span class="buffered"></span>
            <span class="fill"></span><span class="knob"></span>
          </div>
          <span class="t right total">0:00</span>
        </div>`}
      </div>

      <div class="player-right">
        <!-- Repeat and what plays next live here rather than in the transport.
             They are settings, not controls: you set them once and then listen, and
             sitting them beside prev/play/next made a row of five where three of them
             answer "now" and two answer "from now on". The right hand side is already
             where the standing choices are, next to A/B and the volume. -->
        <div class="player-modes">
          <button class="icon-btn mode ${state.repeat === "off" ? "" : "on"}"
                  data-act="repeat"
                  title="${REPEAT_SAYS[state.repeat]}"
                  aria-pressed="${state.repeat !== "off"}"
                  aria-label="${REPEAT_SAYS[state.repeat]}">
            <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor"
                 stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <path d="M17 3l3 3-3 3"/><path d="M20 6H8a4 4 0 0 0-4 4v1"/>
              <path d="M7 21l-3-3 3-3"/><path d="M4 18h12a4 4 0 0 0 4-4v-1"/>
              ${state.repeat === "one" ? `<!-- The 1 in the loop, which is what tells this
                   state from the other one. Drawn rather than set as text: the loop is a
                   17 pixel icon and a text node in it would take the page's font, its
                   line height and its own baseline. -->
                <path d="M11 10.5l1.6-1v6" stroke-width="2.1"/>` : ""}
            </svg>
          </button>
          <!-- The switch for the algorithm. Off is a player that stops at the end of the
               list, which is what it did before there was one. -->
          <button class="icon-btn mode ${state.autoplay ? "on" : ""}" data-act="autoplay"
                  title="${state.autoplay
                    ? "Keeps playing when the queue runs out"
                    : "Stops when the queue runs out"}"
                  aria-pressed="${state.autoplay}" aria-label="Keep playing">
            <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor"
                 stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <path d="M4 7h7M4 12h5M4 17h5"/><path d="M13 10l7 4-7 4z" fill="currentColor"/>
            </svg>
          </button>
        </div>
        ${hasB ? `
          <div class="ab-chips" title="Compare two takes. Press X to swap.">
            <button class="ab-chip ${state.active === "A" ? "on" : ""}" data-act="slot" data-slot="A">A</button>
            <button class="ab-chip ${state.active === "B" ? "on" : ""}" data-act="slot" data-slot="B">B</button>
            ${arranged() ? '<span class="ab-note" title="The compositor is on, so A and B compare sounds rather than takes">sound</span>' : ""}
          </div>` : ""}
        <div class="volume">
          <button class="icon-btn" data-act="mute" aria-label="Mute">
            <svg viewBox="0 0 24 24" width="17" height="17"><path d="M4 9v6h4l5 4V5L8 9z" fill="currentColor"/>${
              state.volume > 0 ? '<path d="M16 9.5a4 4 0 0 1 0 5" stroke="currentColor" stroke-width="1.7" fill="none" stroke-linecap="round"/>' : ""}</svg>
          </button>
          <input class="range" type="range" min="0" max="1" step="0.01" value="${state.volume}"
                 aria-label="Volume" data-act="volume" style="--fill:${state.volume * 100}%">
        </div>
      </div>`;
    paint();
  }

  const api = {
    get state() { return state; },

    /* Press play, and the app has already agreed.
     *
     * This used to do everything before saying anything: make the audio context, fetch
     * the presets, fetch the arrangement, hand the file to the element, and then wait
     * for play() to resolve, which does not happen until the browser has enough audio
     * buffered to actually begin. Only then did the player appear. Locally that was
     * about four hundred milliseconds of nothing; over a tunnel, with a forty megabyte
     * wav at the other end, far longer, and every bit of it looked like a dead button.
     *
     * The order is inverted. The bar is on screen with the song in it before anything
     * is fetched, because whether this song is going to play is already decided; the
     * only open question is when the sound arrives. If it turns out it cannot play, the
     * state is put back and the reason is said out loud.
     */
    async play(song, version, queue) {
      const changed = !state.song || state.song.id !== song.id;
      const before = { song: state.song, playing: state.playing };

      state.song = song;
      state.active = "A";
      state.playing = true;
      if (queue) {
        state.queue = queue;
        state.queueKind = "song";
        state.index = queue.findIndex((s) => s.id === song.id);
      }
      if (changed) state.slots.B = { version: null, preset: null };
      state.slots.A.version = version;
      render();
      startTicking();
      J.emit("player:change");

      try {
        await ensureContext();
        if (state.song !== song) return;        // they moved on while this was starting
        if (changed) {
          await loadVersion("B", null);
          // Neither of these needs the other, so they go together rather than in a queue.
          await Promise.all([
            api.loadPresets(song.id),
            (J.arrange && J.state.modules.includes("arrange"))
              ? J.try(() => J.arrange.load(song.id)) : Promise.resolve(),
          ]);
          if (state.song !== song) return;
        }
        await loadVersion("A", version);
        applyPreset("A", state.slots.A.preset || defaultPreset());
        applyGains();
        await startBoth();
        if (state.song !== song) return;
        render();
        J.emit("player:change");
      } catch (e) {
        if (state.song !== song) return;
        state.song = before.song;
        state.playing = before.playing;
        stopTicking();
        render();
        J.emit("player:change");
        J.toast(e.message || "That would not play.", "bad");
      }
    },

    /* Play something that is not on a song yet.
     *
     * A render in the list has no versions, no presets and no arrangement, so this is
     * the plain path: one file, the transport, and the bar showing what it is. It is
     * also what a playlist uses when the next thing in it is a loose render. */
    async playRender(entry, queue) {
      const item = { id: entry.id, kind: "render", duration: entry.duration || 0,
                     url: entry.url || null };
      const asSong = { id: `render:${entry.id}`, kind: "render",
                       title: entry.name || entry.filename || "render" };
      const before = { song: state.song, playing: state.playing };

      state.song = asSong;
      state.active = "A";
      state.playing = true;
      state.slots.A = { version: item, preset: null };
      state.slots.B = { version: null, preset: null };
      state.presets = [];
      if (queue) {
        state.queue = queue;
        state.queueKind = "render";
        state.index = queue.findIndex((q) => q.id === entry.id);
      }
      render();
      startTicking();
      J.emit("player:change");

      try {
        await ensureContext();
        if (state.song !== asSong) return;
        await loadVersion("B", null);
        await loadVersion("A", item);
        J.audio.applyTo("A", null);          // a loose render is heard as it is
        applyGains();
        await startBoth();
        if (state.song !== asSong) return;
        render();
        J.emit("player:change");
      } catch (e) {
        if (state.song !== asSong) return;
        state.song = before.song;
        state.playing = before.playing;
        stopTicking();
        render();
        J.toast(e.message || "That render would not play.", "bad");
      }
    },

    /* Start fetching a render before anyone asks for it.
     *
     * Handing the file to the element is what actually costs: the browser will not begin
     * until it holds enough audio, and for an uncompressed bounce that is a real fetch.
     * Doing it when a song page opens, or when a pointer settles on a row, means the
     * press has nothing left to wait for. Nothing plays, nothing is heard; the deck is
     * simply already holding the file.
     *
     * Never while something is playing: the deck it would prime is the deck in use. */
    prime(version) {
      if (!version || state.playing) return;
      const deck = J.audio.deck("A");
      if (!deck || deck.versionId === keyFor(version)) return;
      if (state.slots.A.version && keyFor(state.slots.A.version) === keyFor(version)) return;
      deck.versionId = keyFor(version);
      deck.element.src = srcFor(version);
      deck.element.load();
    },

    defaultPreset,

    async loadPresets(songId) {
      try {
        const data = await J.get(`/api/songs/${songId}/sound`);
        state.presets = data.presets || [];
      } catch (e) {
        state.presets = [];   // sound is optional; a song still plays flat without it
      }
      const chosen = defaultPreset();
      applyPreset("A", chosen);
      applyPreset("B", chosen);
      J.emit("sound:change");
    },

    /* Give one slot a version, a preset, or both. */
    async set(slot, what) {
      await ensureContext();
      if (what.preset !== undefined) applyPreset(slot, what.preset);
      if (what.version !== undefined) {
        await loadVersion(slot, what.version);
        // Line the deck up with where the music already is, so choosing a B while
        // something plays does not restart it.
        const audio = audioOf(slot);
        const at = activeAudio().currentTime || 0;
        const place = () => { try { audio.currentTime = at; } catch (e) { /* not seekable */ } };
        if (audio.readyState >= 1) place();
        else audio.addEventListener("loadedmetadata", place, { once: true });
        if (state.playing) await audio.play().catch(() => {});
      }
      applyGains();
      render();
      J.emit("player:change");
    },

    async switchTo(slot) {
      if (slot === state.active) return;
      if (arranged()) {
        // Only the sound changes. There is one arrangement, so there is nothing else
        // for the other chip to be.
        state.active = slot;
        applyGains();
        render();
        J.emit("player:change");
        return;
      }
      if (!state.slots[slot].version) return;
      syncOther();
      state.active = slot;
      applyGains();
      const audio = activeAudio();
      if (state.playing && audio.paused) await audio.play().catch(() => {});
      render();
      J.emit("player:change");
    },

    swap() {
      const to = other();
      if (arranged() || state.slots[to].version) api.switchTo(to);
    },

    /* An edit to a preset reaches whichever slots are using it, and nothing else. */
    presetEdited(presetId, data) {
      for (const slot of ["A", "B"]) {
        const preset = state.slots[slot].preset;
        if (preset && preset.id === presetId) {
          preset.data = data;
          J.audio.applyTo(slot, data);
        }
      }
      const known = state.presets.find((p) => p.id === presetId);
      if (known) known.data = data;
    },

    async toggle() {
      if (!state.song) return;
      await ensureContext();
      if (state.playing) {
        pauseBoth();
        state.playing = false;
        stopTicking();
      } else {
        await startBoth();
        state.playing = true;
        startTicking();
      }
      render();
      J.emit("player:change");
    },

    seek(fraction) {
      if (!state.duration) return;
      if (arranged()) {
        const to = J.clamp(fraction, 0, 1) * state.duration;
        J.arrange.seek(to);
        state.position = to;
        paint();
        return;
      }
      const audio = activeAudio();
      const at = J.clamp(fraction, 0, 1) * state.duration;
      audio.currentTime = at;
      state.position = at;
      const slot = other();
      if (state.slots[slot].version) {
        try { audioOf(slot).currentTime = at; } catch (e) { /* not ready */ }
      }
      paint();
    },

    setVolume(value) {
      state.volume = J.clamp(value, 0, 1);
      J.audio.setVolume(state.volume);
    },

    /* Next and previous, for whichever kind of thing the queue holds.
     *
     * A queue used to be songs by assumption, and playing a loose render fills it with
     * renders. Handing one of those to playSong reads its id as a song id: in a library
     * where that number happens to be a song it plays something unrelated, and in one
     * where it is not, Next silently does nothing. */
    step(delta) {
      if (!state.queue.length) return;
      const next = state.index + delta;
      if (next < 0 || next >= state.queue.length) return;
      state.index = next;
      const entry = state.queue[next];
      /* Which kind was settled when the queue was filled, by the screen that filled it.
       * Nothing is inferred here any more: the row's own kind is still honoured when it
       * carries one, because a playlist row does, but the queue has the final say. */
      const renders = state.queueKind === "render" || (entry && entry.kind === "render");
      if (renders) api.playRender(entry, state.queue);
      else J.playSong(entry, state.queue);
    },

    /* Remembered per browser, so the two switches survive a reload.
     *
     * localStorage and not a setting on the server: which way somebody likes their player
     * to behave is a property of the machine they are sitting at, and a phone and a laptop
     * are allowed to disagree about it. */
    modes(patch) {
      Object.assign(state, patch);
      try {
        localStorage.setItem(REMEMBER, JSON.stringify(
          { repeat: state.repeat, autoplay: state.autoplay }));
      } catch (e) { /* a private window */ }
      render();
    },

    /* The end of the queue, and the switch is on.
     *
     * The choosing happens on the server, which can see the whole library; this side knows
     * only whatever list the current screen happened to load. What comes back is one song,
     * and it is played as a queue of one so that the next end lands here again.
     */
    async keepGoing() {
      const from = state.song && state.song.kind !== "render" ? state.song.id : 0;
      if (from) {
        state.lately = [from, ...state.lately.filter((id) => id !== from)].slice(0, LATELY);
      }
      const asked = await J.get("/api/songs/up-next?after=" + (from || 0)
        + "&not=" + state.lately.join(",")).catch(() => null);
      const song = asked && asked.song;
      // Nothing to go to is a player that stops, quietly. A toast here would fire at the
      // end of every listen in a library with one song in it.
      if (!song) return;
      await J.playSong(song, [song]);
    },

    render,
  };

  function defaultPreset() {
    return state.presets.find((p) => p.is_current) || state.presets[0] || null;
  }

  J.on("boot", () => {
    const node = el();

    /* Right clicking whatever is playing. The bar is the one thing on screen at all
     * times, so it is the fastest way to reach the song you are listening to. */
    J.menu.on(node, ".now-playing", () => {
      if (!state.song) return null;
      const version = state.slots[state.active].version;
      return [
        { group: state.song.title },
        { label: "Open the song", icon: "open",
          run: () => { location.hash = `#/song/${state.song.id}`; } },
        { label: state.playing ? "Pause" : "Play", icon: "play", hint: "Space",
          run: () => api.toggle() },
        { divider: true },
        { label: "Back to the start", icon: "open", run: () => api.seek(0) },
        version ? { label: version.kind === "render" ? "Download this render"
                                                      : `Download v${version.n}`,
          icon: "down",
          run: () => window.open(version.kind === "render"
            ? `/api/renders/${version.id}/audio`
            : `/api/versions/${version.id}/download`, "_blank") } : null,
        { divider: true },
        { label: "Stop and clear the player", icon: "drop",
          run: () => {
            pauseBoth();
            state.playing = false;
            state.song = null;
            stopTicking();
            render();
            J.emit("player:change");
          } },
      ];
    });

    node.addEventListener("click", async (e) => {
      const hit = e.target.closest("[data-act]");
      if (!hit) return;
      const act = hit.dataset.act;
      if (act === "toggle") api.toggle();
      if (act === "next") api.step(1);
      if (act === "repeat") {
        const next = REPEATS[(REPEATS.indexOf(state.repeat) + 1) % REPEATS.length];
        api.modes({ repeat: next });
        J.toast(REPEAT_SAYS[next] + ".");
      }
      if (act === "autoplay") {
        api.modes({ autoplay: !state.autoplay });
        J.toast(state.autoplay
          ? "Keeps playing when the queue runs out."
          : "Stops when the queue runs out.");
      }
      if (act === "prev") { if (state.position > 3) api.seek(0); else api.step(-1); }
      if (act === "slot") api.switchTo(hit.dataset.slot);
      if (act === "mute") { api.setVolume(state.volume > 0 ? 0 : 0.9); render(); }
    });

    node.addEventListener("input", (e) => {
      const hit = e.target.closest("[data-act='volume']");
      if (!hit) return;
      api.setVolume(parseFloat(hit.value));
      hit.style.setProperty("--fill", `${hit.value * 100}%`);
    });

    node.addEventListener("pointerdown", (e) => {
      const bar = e.target.closest("[data-act='seek']");
      if (!bar) return;
      seeking = true;
      bar.classList.add("scrubbing");
      const move = (event) => {
        const rect = bar.getBoundingClientRect();
        const fraction = J.clamp((event.clientX - rect.left) / rect.width, 0, 1);
        state.position = fraction * state.duration;
        paint();
        return fraction;
      };
      const fraction = move(e);
      const onMove = (event) => move(event);
      const onUp = (event) => {
        api.seek(move(event));
        seeking = false;
        bar.classList.remove("scrubbing");
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      api.seek(fraction);
    });

    ["A", "B"].forEach((slot) => {
      const audio = J.audio.deck(slot).element;
      audio.addEventListener("ended", () => {
        if (slot !== state.active) return;
        /* Repeat wins over everything, including a queue with more in it.
         *
         * Straight back to nought on the same element rather than reloading the source:
         * the file is decoded and buffered already, so this is the one gapless thing the
         * player can honestly do. */
        if (state.repeat === "one") {
          audio.currentTime = 0;
          audio.play().catch(() => { /* a tab that has not been touched yet */ });
          return;
        }
        state.playing = false;
        stopTicking();
        render();
        // Something after this in the queue is always the answer if there is one.
        if (state.index >= 0 && state.index + 1 < state.queue.length) {
          api.step(1);
          return;
        }
        /* The end of the list, with the whole list on repeat.
         *
         * Back to the top rather than on to whatever autoplay would have chosen: somebody
         * who asked for this list again has said which songs they want. A queue of one is
         * the same song again, which is what repeating a list of one means. */
        if (state.repeat === "all" && state.queue.length) {
          api.step(-state.index);
          return;
        }
        if (state.autoplay) api.keepGoing();
      });
      audio.addEventListener("error", () => {
        if (slot === state.active && state.slots[slot].version) {
          J.toast("That version would not play. The file may be missing.", "bad");
        }
      });
      /* The server cannot always work out a duration, so the browser tells it once. */
      audio.addEventListener("loadedmetadata", async () => {
        const version = state.slots[slot].version;
        if (!version || version.kind === "render") return;   // nothing to correct on
        /* Only for the file this element actually decoded.
         *
         * The slot is pointed at the new version before the new source is set, so
         * between those two moments the element still holds the previous file. A
         * metadata event already in flight then arrives with the old file's duration and
         * the new version in the slot, and writes one take's length onto another's row.
         * Found in a real library: a version stored as 41 seconds whose file is 256.
         * currentSrc is what the element decoded, and it cannot be wrong about that. */
        if (!audio.currentSrc || !audio.currentSrc.endsWith(srcFor(version))) return;
        if (!Number.isFinite(audio.duration)) return;
        if (Math.abs((version.duration || 0) - audio.duration) < 0.6) return;
        version.duration = audio.duration;
        await J.try(() => J.patch(`/api/versions/${version.id}`, { duration: audio.duration }));
        J.emit("versions:changed", { songId: state.song && state.song.id });
      });
    });
  });

  return api;
})();

/* Play a song at its current version, which is what clicking a row means everywhere. */
J.playSong = async function (song, queue) {
  const same = J.player.state.song && J.player.state.song.id === song.id;
  if (same && J.player.state.slots.A.version) return J.player.toggle();

  /* Not J.try, which shows whatever the server said.
   *
   * What the server says when a song is not there is "no song with id 28", which is a
   * sentence for whoever is reading the log, and it was going straight to a toast in front
   * of somebody who is listening to music. Four of them stacked up in the report. A song
   * that has been deleted from under a list is worth one plain line, and a queue that
   * still names it is worth nothing at all: it carries on to the next one.
   */
  let data = null;
  try {
    data = await J.get(`/api/songs/${song.id}/versions`);
  } catch (e) {
    if (queue) return;                       // the list is stale; say nothing, move on
    J.toast(song.title ? `${song.title} is not in the library any more.`
                       : "That song is not in the library any more.", "bad");
    return;
  }
  if (!data) return;
  const versions = data.versions || [];
  if (!versions.length) {
    /* Nothing to play, so go where something can be done about it.
     *
     * This used to be a message telling you to upload a render, which is instructions
     * rather than help: the place to do that was one screen away and you had to know
     * that. The song page is that place, and it opens with the button on it. */
    J.toast(`${song.title} has no renders yet.`);
    location.hash = `#/song/${song.id}`;
    return;
  }
  const current = versions.find((v) => v.id === data.current_version_id) || versions[0];
  await J.player.play(song, current, queue);
};
