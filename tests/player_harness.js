/* Run the real player outside a browser, and report what it did.
 *
 * WHY. Two of the things reported against the player cannot be checked by reading it. That
 * Previous does nothing after a song has been autoplayed is a fact about a queue of one and
 * an index of zero, and that a phone announces every song as the library's name is a fact
 * about what is handed to the operating system. Both are behaviour.
 *
 * WHAT IS REAL AND WHAT IS NOT. web/js/40-player.js is loaded unmodified and nothing is
 * exported for the sake of this file. Everything it leans on is handed to it instead: the
 * decks, the arranger, the network and the page. Those stubs are not pretending to be a
 * sound card; they are there so the parts being asked about, which are the queue, the
 * history and the metadata, run for real.
 *
 * The page is the useful trick. el() is J.$("#player") and J.$ returns null here, so
 * render() draws nothing and returns after it has told the system what is playing, which is
 * the one line of it this file is about.
 *
 *     node player_harness.js            a JSON report on stdout
 */
"use strict";

const fs = require("fs");
const path = require("path");

const WEB = path.join(__dirname, "..", "web", "js");

// ── what the player is allowed to see ───────────────────────────────────────

const calls = [];      // every crossing into the stubs, in order
const note = (what, detail) => calls.push(Object.assign({ what }, detail || {}));

function deckElement() {
  return {
    src: "", currentTime: 0, duration: 120, paused: true,
    load() {}, play() { this.paused = false; return Promise.resolve(); },
    pause() { this.paused = true; },
    removeAttribute() { this.src = ""; },
    addEventListener() {}, removeEventListener() {},
  };
}

const decks = { A: { element: deckElement(), versionId: null },
                B: { element: deckElement(), versionId: null } };

//: What the operating system was told, in order. The point of the exercise.
const system = { metadata: [], playbackState: [], positions: [], handlers: {} };

const navigatorStub = {
  vibrate() {},
  mediaSession: {
    set metadata(value) { system.metadata.push(value); },
    get metadata() { return system.metadata[system.metadata.length - 1] || null; },
    set playbackState(value) { system.playbackState.push(value); },
    get playbackState() { return system.playbackState[system.playbackState.length - 1]; },
    setActionHandler(name, fn) { system.handlers[name] = fn; },
    setPositionState(state) { system.positions.push(state); },
  },
};

class MediaMetadata {
  constructor(init) { Object.assign(this, init); }
}

//: The library, as the songs endpoint would answer for it.
const LIBRARY = {
  1: { id: 1, title: "First Light" },
  2: { id: 2, title: "Second Wind" },
  3: { id: 3, title: "Third Rail" },
  4: { id: 4, title: "Fourth Wall" },
};

/* Enough of an element to be drawn into and listened to.
 *
 * The bar is built with innerHTML and then wired with addEventListener, so a null here
 * stops the boot hook before the lock screen buttons are ever registered. Everything below
 * is what the player actually touches on it and nothing more. */
function fakeNode(id) {
  const node = {
    id, innerHTML: "", hidden: false, textContent: "",
    style: { setProperty() {}, removeProperty() {} },
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    dataset: {},
    addEventListener() {}, removeEventListener() {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 320, height: 64 }),
    querySelector: () => null,
    querySelectorAll: () => [],
    closest: () => null,
    setAttribute() {}, removeAttribute() {}, getAttribute: () => null,
    focus() {}, scrollIntoView() {},
  };
  return node;
}

const nodes = { "#player": fakeNode("player") };

const J = {
  state: { modules: [], name: "Lonezsi" },     // the library's name, which is not a title
  $: (sel) => nodes[sel] || null,
  $$: () => [],
  clamp: (n, low, high) => Math.min(high, Math.max(low, n)),
  esc: (s) => String(s),
  hue: () => 0,
  cover: () => "",
  // Kept, not dropped: the lock screen's buttons are registered in the boot hook, so a
  // harness that swallows it tests a player nobody can press anything on.
  _hooks: {},
  on(name, fn) { (this._hooks[name] = this._hooks[name] || []).push(fn); },
  emit(name, detail) { (this._hooks[name] || []).forEach((fn) => fn(detail)); },
  toast(message) { note("toast", { message }); },
  try: (fn) => fn(),
  menu: { on() {} },
  sheet: () => Promise.resolve(null),
  async get(url) {
    note("get", { url });
    const found = /\/api\/songs\/(\d+)\/versions/.exec(url);
    if (found) {
      const id = Number(found[1]);
      return { current_version_id: id * 10,
               versions: [{ id: id * 10, n: 1, duration: 120, filename: "take.wav" }] };
    }
    if (url.startsWith("/api/songs/up-next")) {
      // What autoplay is handed: one song, and never one it was told to avoid.
      const avoid = new URL("http://x" + url).searchParams.get("not") || "";
      const skip = new Set(avoid.split(",").filter(Boolean).map(Number));
      const song = Object.values(LIBRARY).find((s) => !skip.has(s.id));
      return { song: song || null };
    }
    return {};
  },
  audio: {
    deck: (slot) => decks[slot],
    resume: async () => {},
    wire() {}, setVolume() {}, applyTo() {}, setDeckGain() {},
  },
  // Left undefined on purpose: arranged() is false, which is the ordinary path.
  arrange: null,
};

const localStorage = {
  _v: {},
  getItem(k) { return k in this._v ? this._v[k] : null; },
  setItem(k, v) { this._v[k] = String(v); },
};

const document = { getElementById: () => null, addEventListener() {},
                   querySelector: () => null, querySelectorAll: () => [] };
const window = { addEventListener() {} };

let frame = 0;
const requestAnimationFrame = () => ++frame;   // never actually runs; tick is driven by hand
const cancelAnimationFrame = () => {};

// ── load the real thing ─────────────────────────────────────────────────────

const source = fs.readFileSync(path.join(WEB, "40-player.js"), "utf8");
const run = new Function(
  "J", "navigator", "MediaMetadata", "document", "window", "localStorage",
  "requestAnimationFrame", "cancelAnimationFrame", "console",
  source);
run(J, navigatorStub, MediaMetadata, document, window, localStorage,
    requestAnimationFrame, cancelAnimationFrame, console);

// The boot hook is where the lock screen buttons are registered, so it is run. Without
// this the handlers are never set and every question about them answers "none", which looks
// like a passing test and is an unpressed button.
J.emit("boot");
const player = J.player;

// ── the run ─────────────────────────────────────────────────────────────────

/* Wait for the player to finish arriving somewhere.
 *
 * step() starts a song and does not hand back a promise, which is right for a button press
 * and a trap for a script: `await player.step(1)` waits for step itself and not for the
 * song, so every reading after one is a race with the fetch it kicked off. It was one: two
 * steps into a three song list left the index reading 1 instead of what it settles at.
 * Everything here is read after this rather than after the call. */
const settle = async () => {
  for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0));
};

async function main() {
  const out = {};

  // An album of two, played from the top, the way a list on a screen hands one over.
  const album = [LIBRARY[1], LIBRARY[2]];
  await J.playSong(LIBRARY[1], album); await settle();
  await player.step(1); await settle();
  out.afterTheAlbum = { song: player.state.song.title, index: player.state.index,
                        queueLength: player.state.queue.length,
                        history: player.state.history.length };

  // Previous, while the queue can still answer it.
  await player.step(-1); await settle();
  out.backInsideTheQueue = { song: player.state.song.title,
                             index: player.state.index,
                             usedTheQueue: player.state.queue.length === 2 };

  // To the end of the list, then autoplay: one song, as a queue of one.
  await player.step(1); await settle();
  await player.keepGoing(); await settle();
  out.afterAutoplay = { song: player.state.song.title,
                        queueLength: player.state.queue.length,
                        index: player.state.index,
                        history: player.state.history.length };

  // The reported bug: Previous, from there.
  await player.step(-1); await settle();
  out.backOutOfAutoplay = { song: player.state.song.title,
                            queueLength: player.state.queue.length,
                            index: player.state.index };

  // And again, further back still.
  await player.step(-1); await settle();
  out.backTwice = { song: player.state.song.title, index: player.state.index };

  /* All the way to the beginning, and then past it.
   *
   * The depth is recorded at every step, not just the song. Going back has to spend the
   * history rather than add to it, and the sharpest way to say that is that the stack never
   * grows while you are walking backwards. When it did, Previous walked A to B to A to B:
   * the queue answered one press and remembered the song it left, and the next press popped
   * that same song again. */
  const seen = [];
  const depth = [player.state.history.length];
  for (let i = 0; i < 10; i++) {
    await player.step(-1); await settle();
    seen.push(player.state.song.title);
    depth.push(player.state.history.length);
  }
  out.walkedBackTo = seen[seen.length - 1];
  out.walkingBack = seen;
  out.historyDepths = depth;
  out.historyOnlyShrank = depth.every((n, i) => i === 0 || n <= depth[i - 1]);
  out.historyAtTheStart = player.state.history.length;

  // What the lock screen was told, and what the buttons on it do.
  out.system = {
    titles: system.metadata.filter(Boolean).map((m) => m.title),
    artists: [...new Set(system.metadata.filter(Boolean).map((m) => m.artist))],
    lastPlaybackState: system.playbackState[system.playbackState.length - 1],
    handlers: Object.keys(system.handlers).sort(),
    positionsLookSane: system.positions.every(
      (p) => p.duration > 0 && p.position >= 0 && p.position <= p.duration),
  };

  // The lock screen's Previous has to be the same Previous.
  if (system.handlers.previoustrack) {
    const was = player.state.song.title;
    await J.playSong(LIBRARY[4], [LIBRARY[4]]); await settle();
    system.handlers.previoustrack();
    await new Promise((r) => setTimeout(r, 0));
    out.lockScreenPrevious = { from: "Fourth Wall", to: player.state.song.title,
                               wentBackTo: was };
  }

  /* The lock screen's scrubber and its ten second buttons.
   *
   * They speak seconds. The player's seek takes a fraction, and they were handed straight
   * to it, so every one of them from one second up clamped to 1.0: the song jumped to its
   * end and autoplay moved on. Read off the deck the player actually moved, not off its own
   * idea of where it is. */
  if (system.handlers.seekto) {
    await J.playSong(LIBRARY[1], [LIBRARY[1]]); await settle();
    const deck = () => (player.state.slot ? decks[player.state.slot] : decks.A).element;
    const at = () => Math.round(player.state.position * 10) / 10;
    const duration = player.state.duration;
    system.handlers.seekto({ seekTime: 30 });
    const afterSeekTo = at();
    system.handlers.seekbackward({ seekOffset: 10 });
    const afterBack = at();
    system.handlers.seekforward({});
    const afterForward = at();
    out.lockScreenSeek = { duration, afterSeekTo, afterBack, afterForward,
                           deckAt: Math.round(deck().currentTime * 10) / 10 };

    // Play means play and pause means pause, whatever state they arrive in.
    if (!player.state.playing) { await player.toggle(); await settle(); }
    system.handlers.play(); await settle();
    const stillPlaying = player.state.playing;
    system.handlers.pause(); await settle();
    const pausedOnce = !player.state.playing;
    system.handlers.pause(); await settle();
    const stillPaused = !player.state.playing;
    out.lockScreenPlayPause = { stillPlaying, pausedOnce, stillPaused };
  }

  process.stdout.write(JSON.stringify(out, null, 2));
}

main().catch((e) => {
  process.stderr.write("harness failed: " + (e && e.stack || e) + "\n");
  process.exit(1);
});
