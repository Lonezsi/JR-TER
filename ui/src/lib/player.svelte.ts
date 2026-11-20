/* The player.
 *
 * A slot is a version and a preset together, because that is what you actually compare:
 * this mix through this equaliser against that mix through that one. Both decks run at
 * once with one silent, so switching is a gain swap and the playhead never moves.
 *
 * This file is state and behaviour only. What draws it is shell/PlayerBar.svelte, and
 * anything else may read `player` too: every field is reactive.
 */
import { engine, SLOTS, type Slot } from "./audio/engine";
import { get, patch, uFor, guest, attempt } from "./api";
import { app, has } from "./app.svelte";
import { emit } from "./bus";
import { toast } from "./toast.svelte";
import { go, href } from "./router.svelte";
import { accent } from "./look.svelte";
import { clamp, store } from "./util";
import type { Preset, Render, Song, Version } from "./types";

/* What takes over the transport when a song is being played as arranged. The compositor
 * implements this (lib/audio/arrange) and registers itself; the player only ever asks. */
export interface Arranger {
  readonly enabled: boolean;
  readonly songId: number | null;
  readonly clipCount: number;
  /** Fetch this song's arrangement. Cheap: no audio is decoded yet. */
  load(songId: number): Promise<void>;
  /** Is the render decoded and ready to be scheduled. */
  ready(): boolean;
  /** Decode it, reporting 0..1 as it goes. Throws with a reason when it cannot. */
  ensure(onProgress: (fraction: number) => void): Promise<unknown>;
  start(): Promise<boolean>;
  stop(): void;
  readonly position: number;
  duration(): number;
  finished(): boolean;
  seek(seconds: number): void;
}

export type Repeat = "off" | "one" | "all";
export const REPEATS: Repeat[] = ["off", "one", "all"];
export const REPEAT_SAYS: Record<Repeat, string> = {
  off: "Repeat off",
  one: "Repeating this one",
  all: "Repeating the whole list",
};

type Entry = Song | Render;
interface SlotState { version: Version | null; preset: Preset | null }
interface Past { entry: Entry; kind: "song" | "render"; queue: Entry[] }

const HISTORY = 50;      // how far back Previous can go
const LATELY = 8;        // how much of the recent past autoplay refuses to repeat
const REMEMBER = "jriter.player.modes";

const kept = store.get<{ repeat?: Repeat | boolean; autoplay?: boolean; volume?: number }>(REMEMBER, {});

export const player = $state({
  /** What the bar draws. For a loose render this is a stand in with id "render:43". */
  song: null as Song | null,
  queue: [] as Entry[],
  /** What is in the queue. Written when the queue is, by whoever had the list in hand. */
  queueKind: "song" as "song" | "render",
  index: -1,
  slots: { A: { version: null, preset: null }, B: { version: null, preset: null } } as Record<Slot, SlotState>,
  presets: [] as Preset[],
  active: "A" as Slot,
  playing: false,
  /** True from the press until sound actually starts. */
  loading: false,
  duration: 0,
  position: 0,
  buffered: 0,
  volume: typeof kept.volume === "number" ? clamp(kept.volume, 0, 1) : 0.9,
  /** 0..1 while a render is being read for the compositor, otherwise null. */
  preparing: null as number | null,
  // A boolean is what older versions stored, and it meant repeat this one.
  repeat: (typeof kept.repeat === "boolean" ? (kept.repeat ? "one" : "off")
    : REPEATS.includes(kept.repeat as Repeat) ? kept.repeat : "off") as Repeat,
  /** Keep going when the queue runs out, by asking the library what is next. */
  autoplay: typeof kept.autoplay === "boolean" ? kept.autoplay : true,
  /** True while the scrubber is held: the paint loop leaves position alone. */
  seeking: false,
  /** The share the playing song was started through, when it is somebody else's. The
   *  page can be left while a shared song keeps playing, and from then on its requests
   *  must still go through the share, and nobody else's must. */
  share: null as string | null,
});

// Not reactive: this tab's memory only, never drawn.
let entry: Entry | null = null;       // the real thing handed over, so it can be replayed
let history: Past[] = [];
let lately: number[] = [];
let goingBack = false;
/* One number per attempt to start something. Compared by number and never by object:
 * player.song is a reactive proxy, and a proxy is never === the plain object it was
 * made from, so "is this still the song I was starting" answered no for anything the
 * caller had not already put through the proxy. */
let token = 0;
let ticking: number | null = null;
let arranger: Arranger | null = null;
let lastVolume = 0.9;

export function setArranger(next: Arranger | null) { arranger = next; }

const audioOf = (slot: Slot) => engine.deck(slot).element;
const activeAudio = () => audioOf(player.active);
const other = (): Slot => (player.active === "A" ? "B" : "A");

/** Is the compositor driving playback for the song on the player. When it is, the audio
 *  elements stay paused and clips are scheduled instead; everything else is unchanged. */
export const arranged = () => !!(arranger && arranger.enabled && player.song
  && arranger.songId === player.song.id && arranger.clipCount);

/** The picture for whatever is playing. A shared song's pictures live in somebody
 *  else's library, so whoever started it hands over a ready address in `art`. */
export const coverOf = (song: Song | null | undefined): string | null => {
  if (!song) return null;
  if (song.art) return song.art;
  return song.artwork_id ? uFor(player.share, `/api/artwork/${song.artwork_id}/image`) : null;
};

/* Where a playable thing's bytes are. An item may carry its own url, and a shared song
 * is why: the server works out which file a share means from the share itself, so the
 * recipient never names a version. */
const srcFor = (item: Version, share: string | null = player.share) => (item.url ? item.url
  : item.kind === "render" ? `/api/renders/${item.id}/audio`
  : uFor(share, `/api/versions/${item.id}/audio`));
// A render id and a version id are both small integers, so the deck remembers which.
const keyFor = (item: Version) => `${item.kind || "version"}:${item.id}`;

async function ensureContext() {
  await engine.resume();
  SLOTS.forEach((slot) => engine.wire(slot));
  engine.setVolume(player.volume);
}

async function loadVersion(slot: Slot, version: Version | null) {
  player.slots[slot].version = version;
  const d = engine.deck(slot);
  if (!version) {
    d.element.removeAttribute("src");
    d.element.load();
    d.versionId = null;
    return;
  }
  if (d.versionId !== keyFor(version)) {
    d.versionId = keyFor(version);
    d.element.src = srcFor(version);
    d.element.load();
  }
}

function applyPreset(slot: Slot, preset: Preset | null) {
  player.slots[slot].preset = preset;
  engine.applyTo(slot, preset ? preset.data : null);
}

function applyGains() {
  const anywhere = arranged();
  SLOTS.forEach((slot) => {
    // Arranged, both decks carry the same clips, so a slot is audible on its own merits.
    const hasSound = anywhere || player.slots[slot].version;
    engine.setDeckGain(slot, slot === player.active && hasSound ? 1 : 0);
  });
}

async function startBoth() {
  if (arranged() && arranger) {
    // Arranged playback needs the whole render decoded, a real wait the first time. It
    // happens with the bar showing what it is doing rather than behind a dead press.
    if (!arranger.ready()) {
      player.preparing = 0;
      const got = await attempt(() => arranger!.ensure((f) => { player.preparing = f; }));
      player.preparing = null;
      if (got === null) return;
      if (!player.playing) return;          // they gave up while it loaded, which is fair
    }
    // The elements must be quiet: the same render from two places at once is a flam.
    SLOTS.forEach((slot) => audioOf(slot).pause());
    const ok = await arranger.start();
    if (!ok) toast("The arrangement has nothing to play yet.", "bad");
    return;
  }
  await Promise.all(SLOTS.filter((slot) => player.slots[slot].version)
    .map((slot) => audioOf(slot).play().catch(() => { /* autoplay refusal */ })));
}

function pauseBoth() {
  arranger?.stop();
  SLOTS.forEach((slot) => audioOf(slot).pause());
}

function syncOther() {
  const slot = other();
  if (!player.slots[slot].version) return;
  const from = activeAudio();
  const to = audioOf(slot);
  if (Math.abs(to.currentTime - from.currentTime) > 0.05) to.currentTime = from.currentTime;
}

function tick() {
  ticking = requestAnimationFrame(tick);
  if (arranged() && arranger) {
    if (!player.seeking) player.position = arranger.position;
    player.duration = arranger.duration();
    if (arranger.finished()) {
      arranger.stop();
      player.playing = false;
      stopTicking();
      ended();
    }
    return;
  }
  const audio = activeAudio();
  if (!player.seeking) player.position = audio.currentTime || 0;
  if (audio.duration && Number.isFinite(audio.duration)) player.duration = audio.duration;
  try {
    player.buffered = audio.buffered.length ? audio.buffered.end(audio.buffered.length - 1) : 0;
  } catch { player.buffered = 0; }
}
const startTicking = () => { if (ticking === null) tick(); };
const stopTicking = () => { if (ticking !== null) { cancelAnimationFrame(ticking); ticking = null; } };

/* Put what is playing now on the stack, before something else takes its place. The list
 * as well as the song: coming back into the middle of an album with a one song queue
 * still on the player would leave Next meaning nothing. */
function remember() {
  if (goingBack || !entry) return;
  history.push({ entry, kind: player.queueKind, queue: player.queue.slice() });
  while (history.length > HISTORY) history.shift();
}

const defaultPreset = () => player.presets.find((p) => p.is_current) || player.presets[0] || null;

function saveModes() {
  store.set(REMEMBER, { repeat: player.repeat, autoplay: player.autoplay, volume: player.volume });
}

/* What the phone shows while the screen is off. Without this a browser falls back to the
 * page title, so every song on a lock screen was announced as the library's name. */
let toldTheSystem = "";
function tellTheSystem() {
  if (!("mediaSession" in navigator)) return;
  const session = navigator.mediaSession;
  if (!player.song) {
    session.metadata = null;
    session.playbackState = "none";
    toldTheSystem = "";
    return;
  }
  const art = coverOf(player.song);
  // Rebuilt only when it would say something different: a new MediaMetadata on every
  // update makes some phones blink the artwork.
  const key = [player.song.id, player.song.title, art || ""].join("|");
  if (key !== toldTheSystem) {
    toldTheSystem = key;
    try {
      session.metadata = new MediaMetadata({
        title: player.song.title || "",
        artist: app.name || "JR!TER",
        artwork: art ? [{ src: art }] : [],
      });
    } catch { /* an engine without MediaMetadata; the rest still works */ }
  }
  session.playbackState = player.playing ? "playing" : "paused";
  if (session.setPositionState && Number.isFinite(player.duration) && player.duration > 0) {
    try {
      session.setPositionState({
        duration: player.duration,
        position: clamp(now(), 0, player.duration),
        playbackRate: 1,
      });
    } catch { /* a position the engine did not like */ }
  }
}

function changed() {
  tellTheSystem();
}

function trackChanged() {
  accent.playing(player.song, player.song?.kind === "render" || player.queueKind === "render");
}

/** Where the song really is, read off the audio itself. `player.position` is kept by the
 *  paint loop, and a tab that is not being drawn gets no frames: the number stops while
 *  the song goes on. Anything that follows the music rather than the screen asks this. */
export function now(): number {
  if (arranged() && arranger) return arranger.position || 0;
  return activeAudio().currentTime || 0;
}

/* Press play, and the app has already agreed.
 *
 * The bar is on screen with the song in it before anything is fetched, because whether
 * this song is going to play is already decided; the only open question is when the
 * sound arrives. If it turns out it cannot play, the state is put back and the reason is
 * said out loud. */
export async function play(song: Song, version: Version, queue?: Entry[]) {
  const mine = ++token;
  const share = guest.current?.share ?? null;
  const different = !player.song || player.song.id !== song.id || player.share !== share;
  const before = { song: player.song, playing: player.playing, share: player.share };
  if (different) remember();
  // Anything the last song had scheduled would otherwise keep sounding over this one.
  if (different) arranger?.stop();
  player.share = share;

  player.song = song;
  entry = song;
  player.active = "A";
  player.playing = true;
  player.loading = true;
  if (queue) {
    player.queue = queue;
    player.queueKind = "song";
    player.index = queue.findIndex((s) => s.id === song.id);
  }
  if (different) player.slots.B = { version: null, preset: null };
  player.slots.A.version = version;
  startTicking();
  changed();
  if (different) trackChanged();

  try {
    await ensureContext();
    if (mine !== token) return;              // they moved on while this was starting
    if (different) {
      await loadVersion("B", null);
      await Promise.all([
        loadPresets(song.id, () => mine !== token),
        arranger && has("arrange") ? arranger.load(song.id).catch(() => {}) : Promise.resolve(),
      ]);
      if (mine !== token) return;
    }
    await loadVersion("A", version);
    applyPreset("A", player.slots.A.preset || defaultPreset());
    applyGains();
    // Paused while it was loading means paused: do not start the sound under a bar that
    // says so.
    if (player.playing) await startBoth();
    if (mine !== token) return;
    player.loading = false;
    changed();
  } catch (e) {
    if (mine !== token) return;
    player.song = before.song;
    player.share = before.share;
    player.playing = before.playing;
    player.loading = false;
    if (!player.playing) stopTicking();
    changed();
    trackChanged();
    toast((e as Error).message || "That would not play.", "bad");
  }
}

/** Play something that is not on a song yet: one file, the transport, and the bar
 *  showing what it is. Also what a playlist uses when its next item is a loose render,
 *  and what a share is played through. */
export async function playRender(render: Render, queue?: Entry[]) {
  const item: Version = { id: render.id, kind: "render", duration: render.duration || 0, url: render.url || null };
  const asSong: Song = {
    id: `render:${render.id}` as unknown as number, kind: "render",
    title: render.name || render.filename || "render",
    art: render.art || null,
  };
  const mine = ++token;
  const before = { song: player.song, playing: player.playing, share: player.share };
  if (!player.song || player.song.id !== asSong.id) remember();
  arranger?.stop();
  // A loose render is in this library, or carries its own address (a share's).
  player.share = null;

  player.song = asSong;
  entry = render;
  player.active = "A";
  player.playing = true;
  player.loading = true;
  player.slots.A = { version: item, preset: null };
  player.slots.B = { version: null, preset: null };
  player.presets = [];
  if (queue) {
    player.queue = queue;
    player.queueKind = "render";
    player.index = queue.findIndex((q) => q.id === render.id);
  }
  startTicking();
  changed();
  trackChanged();

  try {
    await ensureContext();
    if (mine !== token) return;
    await loadVersion("B", null);
    await loadVersion("A", item);
    engine.applyTo("A", null);              // a loose render is heard as it is
    applyGains();
    if (player.playing) await startBoth();
    if (mine !== token) return;
    player.loading = false;
    changed();
  } catch (e) {
    if (mine !== token) return;
    player.song = before.song;
    player.share = before.share;
    player.playing = before.playing;
    player.loading = false;
    if (!player.playing) stopTicking();
    trackChanged();
    toast((e as Error).message || "That render would not play.", "bad");
  }
}

/** Play a song at its current version, which is what pressing a row means everywhere. */
export async function playSong(song: Song, queue?: Entry[]) {
  const same = player.song && player.song.id === song.id && player.share === null;
  if (same && player.slots.A.version) return toggle();

  let data: { versions?: Version[]; current_version_id?: number } | null = null;
  try {
    data = await get(`/api/songs/${song.id}/versions`, { direct: true });
  } catch {
    // A song deleted from under a list is worth one plain line, and a queue that still
    // names it is worth nothing at all: it carries on to the next one.
    if (queue) return;
    toast(song.title ? `${song.title} is not in the library any more.`
                     : "That song is not in the library any more.", "bad");
    return;
  }
  const versions = data?.versions || [];
  if (!versions.length) {
    // Nothing to play, so go where something can be done about it.
    toast(`${song.title} has no renders yet.`);
    go(href.song(song.id));
    return;
  }
  const current = versions.find((v) => v.id === data!.current_version_id) || versions[0];
  await play(song, current, queue);
}

/** Either kind of thing, from a list that may hold both. */
export const playEntry = (item: Entry, queue?: Entry[]) =>
  item.kind === "render" ? playRender(item as Render, queue) : playSong(item as Song, queue);

/** Start fetching a render before anyone asks for it, so the press has nothing left to
 *  wait for. Never while something is playing: the deck it would prime is in use. */
export function prime(version: Version | null | undefined) {
  if (!version || player.playing) return;
  const d = engine.deck("A");
  if (d.versionId === keyFor(version)) return;
  if (player.slots.A.version && keyFor(player.slots.A.version) === keyFor(version)) return;
  d.versionId = keyFor(version);
  d.element.src = srcFor(version, guest.current?.share ?? null);
  d.element.load();
}

export async function loadPresets(songId: number | string, stale: () => boolean = () => false) {
  let presets: Preset[] = [];
  try {
    const data = await get<{ presets: Preset[] }>(
      uFor(player.share, `/api/songs/${songId}/sound`), { direct: true });
    presets = data.presets || [];
  } catch {
    presets = [];             // sound is optional; a song still plays flat without it
  }
  // A slower answer for the song before must not put its equaliser on this one's decks.
  if (stale()) return;
  player.presets = presets;
  const chosen = defaultPreset();
  applyPreset("A", chosen);
  applyPreset("B", chosen);
}

/** Give one slot a version, a preset, or both. */
export async function setSlot(slot: Slot, what: { version?: Version | null; preset?: Preset | null }) {
  await ensureContext();
  if (what.preset !== undefined) applyPreset(slot, what.preset);
  if (what.version !== undefined) {
    await loadVersion(slot, what.version);
    // Line the deck up with where the music already is, so choosing a B while something
    // plays does not restart it.
    const audio = audioOf(slot);
    const at = activeAudio().currentTime || 0;
    const place = () => { try { audio.currentTime = at; } catch { /* not seekable */ } };
    if (audio.readyState >= 1) place();
    else audio.addEventListener("loadedmetadata", place, { once: true });
    if (player.playing && what.version) await audio.play().catch(() => {});
    // Emptying the slot you are listening to leaves nothing to hear; go to the other.
    if (!what.version && slot === player.active && player.slots[other()].version) player.active = other();
  }
  applyGains();
  changed();
}

export async function switchTo(slot: Slot) {
  if (slot === player.active) return;
  if (arranged()) {
    // Only the sound changes: there is one arrangement, so nothing else for B to be.
    player.active = slot;
    applyGains();
    return;
  }
  if (!player.slots[slot].version) return;
  syncOther();
  player.active = slot;
  applyGains();
  const audio = activeAudio();
  if (player.playing && audio.paused) await audio.play().catch(() => {});
  changed();
}

export function swap() {
  const to = other();
  if (arranged() || player.slots[to].version) switchTo(to);
}

/** Is there anything for the A/B switch to switch between. */
export const canCompare = () => !!player.slots.B.version || arranged();

/** An edit to a preset reaches whichever slots are using it, and nothing else. */
export function presetEdited(presetId: number, data: Preset["data"]) {
  for (const slot of SLOTS) {
    const preset = player.slots[slot].preset;
    if (preset && preset.id === presetId) {
      preset.data = data;
      engine.applyTo(slot, data);
    }
  }
  const known = player.presets.find((p) => p.id === presetId);
  if (known) known.data = data;
}

export async function toggle() {
  if (!player.song) return;
  await ensureContext();
  if (player.playing) {
    pauseBoth();
    player.playing = false;
    stopTicking();
  } else {
    player.playing = true;
    startTicking();
    await startBoth();
  }
  changed();
}

/** A place in the song, in seconds. The lock screen speaks seconds; the scrub bar hands
 *  over a fraction. One conversion here rather than a division at every caller. */
export function seekTo(seconds: number) {
  if (!player.duration) return;
  seek(seconds / player.duration);
}

export function seek(fraction: number) {
  if (!player.duration) return;
  const at = clamp(fraction, 0, 1) * player.duration;
  if (arranged() && arranger) {
    arranger.seek(at);
    player.position = at;
    return;
  }
  activeAudio().currentTime = at;
  player.position = at;
  const slot = other();
  if (player.slots[slot].version) {
    try { audioOf(slot).currentTime = at; } catch { /* not ready */ }
  }
}

export function setVolume(value: number) {
  player.volume = clamp(value, 0, 1);
  if (player.volume > 0) lastVolume = player.volume;
  engine.setVolume(player.volume);
  saveModes();
}

export const toggleMute = () => setVolume(player.volume > 0 ? 0 : (lastVolume || 0.9));

export function setRepeat(next: Repeat) { player.repeat = next; saveModes(); }
export function cycleRepeat(): Repeat {
  const next = REPEATS[(REPEATS.indexOf(player.repeat) + 1) % REPEATS.length];
  setRepeat(next);
  return next;
}
export function setAutoplay(on: boolean) { player.autoplay = on; saveModes(); }

/** Next and previous, for whichever kind of thing the queue holds. */
export async function step(delta: number) {
  // Backwards off the front of the queue is the history's question, not the queue's.
  // After any autoplayed song the queue is one long, so that is most of the time.
  if (delta < 0 && player.index + delta < 0) return back();
  if (!player.queue.length) return;
  const next = player.index + delta;
  if (next < 0 || next >= player.queue.length) return;
  player.index = next;
  const item = player.queue[next];
  const renders = player.queueKind === "render" || item?.kind === "render";
  // Going backwards spends the history rather than adding to it, whichever route
  // answers: otherwise two presses of Previous walk A, B, A, B for ever.
  const was = goingBack;
  if (delta < 0) goingBack = true;
  try {
    if (renders) await playRender(item as Render, player.queue);
    else await playSong(item as Song, player.queue);
  } finally {
    goingBack = was;
  }
}

/** Jump to a place in the queue. */
export const jumpTo = (index: number) => step(index - player.index);

/** Previous, as the button means it: back to the start first, then back a track. */
export function previous() {
  if (player.position > 3) seek(0); else step(-1);
}

/** One step back through where you have actually been, list and all. */
export async function back() {
  const was = history.pop();
  if (!was) return;                    // the beginning of the evening; nothing to do
  goingBack = true;
  try {
    if (was.kind === "render") await playRender(was.entry as Render, was.queue);
    else await playSong(was.entry as Song, was.queue);
  } finally {
    goingBack = false;
  }
}

/** The end of the queue, and the switch is on. The choosing happens on the server, which
 *  can see the whole library. One song comes back and is played as a queue of one, so
 *  the next end lands here again. */
async function keepGoing() {
  const from = player.song && player.song.kind !== "render" ? Number(player.song.id) : 0;
  if (from) lately = [from, ...lately.filter((id) => id !== from)].slice(0, LATELY);
  const asked = await get<{ song?: Song }>(
    `/api/songs/up-next?after=${from || 0}&not=${lately.join(",")}`).catch(() => null);
  // Nothing to go to is a player that stops, quietly.
  if (asked?.song) await playSong(asked.song, [asked.song]);
}

/** Add to the end of what is playing, or play it if nothing is. */
export function enqueue(item: Entry, next = false) {
  if (!player.song) { playEntry(item, [item]); return; }
  const queue = player.queue.slice();
  if (next) queue.splice(player.index + 1, 0, item); else queue.push(item);
  player.queue = queue;
  toast(next ? "Plays next." : "Added to the queue.");
}

export function removeFromQueue(index: number) {
  if (index === player.index) return;
  const queue = player.queue.slice();
  queue.splice(index, 1);
  player.queue = queue;
  if (index < player.index) player.index -= 1;
}

export function stopAndClear() {
  pauseBoth();
  player.playing = false;
  player.loading = false;
  player.song = null;
  entry = null;
  stopTicking();
  changed();
  trackChanged();
}

function ended() {
  // Repeat one wins here too. The audio element handles it for a plain song; an arranged
  // one has no element, so it is the arranger that goes back to the start.
  if (player.repeat === "one" && arranged() && arranger) {
    arranger.seek(0);
    player.playing = true;
    startTicking();
    arranger.start().then((ok) => { if (!ok) player.playing = false; });
    return;
  }
  // Something after this in the queue is always the answer if there is one.
  if (player.index >= 0 && player.index + 1 < player.queue.length) { step(1); return; }
  // The end of the list with the whole list on repeat: back to the top, rather than on
  // to whatever autoplay would have chosen.
  if (player.repeat === "all" && player.queue.length) {
    if (player.index === 0) { seek(0); toggle(); } else step(-player.index);
    return;
  }
  if (player.autoplay) keepGoing();
}

let started = false;

/** Wire the audio elements and the system's media controls. Once, at boot. */
export function startPlayer() {
  if (started) return;
  started = true;

  /* The buttons that are not on this page: a lock screen, a headset, a car. Each one
   * separately, because an engine that does not know an action throws on it. */
  if ("mediaSession" in navigator) {
    const acts: Record<string, (d?: any) => void> = {
      // Play and pause each mean one thing. A play that arrives while already playing
      // (a headset, a car, a second device) must not pause.
      play: () => { if (!player.playing) toggle(); },
      pause: () => { if (player.playing) toggle(); },
      stop: () => { if (player.playing) toggle(); },
      previoustrack: () => step(-1),
      nexttrack: () => step(1),
      seekbackward: (d) => seekTo(Math.max(0, now() - (d?.seekOffset || 10))),
      seekforward: (d) => seekTo(Math.min(player.duration, now() + (d?.seekOffset || 10))),
      seekto: (d) => { if (typeof d?.seekTime === "number") seekTo(d.seekTime); },
    };
    for (const [name, run] of Object.entries(acts)) {
      try { navigator.mediaSession.setActionHandler(name as MediaSessionAction, run); } catch { /* not known here */ }
    }
  }

  SLOTS.forEach((slot) => {
    const audio = audioOf(slot);
    audio.addEventListener("ended", () => {
      if (slot !== player.active) return;
      // Repeat one wins over everything. Straight back to nought on the same element:
      // the file is decoded and buffered already, so this is honestly gapless.
      if (player.repeat === "one") {
        audio.currentTime = 0;
        audio.play().catch(() => { /* a tab that has not been touched yet */ });
        return;
      }
      player.playing = false;
      stopTicking();
      changed();
      ended();
    });
    audio.addEventListener("playing", () => {
      if (slot === player.active) { player.loading = false; changed(); }
    });
    audio.addEventListener("waiting", () => {
      if (slot === player.active && player.playing) player.loading = true;
    });
    audio.addEventListener("error", () => {
      if (slot === player.active && player.slots[slot].version) {
        player.loading = false;
        toast("That render would not play. The file may be missing.", "bad");
      }
    });
    // The server cannot always work out a duration, so the browser tells it once.
    audio.addEventListener("loadedmetadata", async () => {
      const version = player.slots[slot].version;
      if (!version || version.kind === "render") return;
      /* Only for the file this element actually decoded. The slot is pointed at the new
       * version before the new source is set, so a metadata event already in flight
       * arrives with the old file's duration and the new version in the slot. Found in a
       * real library: a version stored as 41 seconds whose file is 256. */
      if (!audio.currentSrc || !audio.currentSrc.endsWith(srcFor(version))) return;
      if (!Number.isFinite(audio.duration)) return;
      if (Math.abs((version.duration || 0) - audio.duration) < 0.6) return;
      version.duration = audio.duration;
      await attempt(() => patch(`/api/versions/${version.id}`, { duration: audio.duration }));
      emit("versions:changed", { songId: player.song?.id ?? null });
    });
  });

  /* Build the audio engine on the first touch of anything, not on the first press of
   * play. A browser will not let a page make an AudioContext until someone has
   * interacted with it, so that work used to land on the play button, after the press
   * and before any sound. Any press satisfies the browser, so the first one does it.
   *
   * Not INSIDE the press, though: making an AudioContext blocks the page for 100-200 ms,
   * and done in the pointerdown it froze whatever that press opened mid-animation (the
   * first click on Settings came up as a blank screen for a quarter of a second). The
   * browser's permission from a press lasts seconds, so it is built once the page is idle
   * a moment later. */
  const build = () => {
    try { engine.resume(); SLOTS.forEach((slot) => engine.wire(slot)); engine.setVolume(player.volume); }
    catch { /* it will be built on the first play instead */ }
  };
  const warm = () => {
    document.removeEventListener("pointerdown", warm, true);
    document.removeEventListener("keydown", warm, true);
    const idle = (window as any).requestIdleCallback as ((f: () => void, o?: { timeout: number }) => number) | undefined;
    setTimeout(() => (idle ? idle(build, { timeout: 1500 }) : build()), 600);
  };
  document.addEventListener("pointerdown", warm, true);
  document.addEventListener("keydown", warm, true);
}
