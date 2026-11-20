/* The compositor's engine: holding an arrangement, and playing a render through it.
 *
 * PUBLIC API (everything hangs off `arrange`; `state` is reactive)
 *   state            { songId, versionId, bpm, offset, perBar, enabled, parts, clips, lyrics,
 *                      confidence, loaded, selected, playingPart }
 *   arrange.running / .position / .duration() / .beatSeconds() / .totalBeats() / .laid() / .at(s)
 *   arrange.peaks() / .sourceSeconds()           the picture of the render, once decoded
 *   arrange.adopt(songId, arrangement)           take one the page already fetched
 *   arrange.load(songId) / .save() / .touch()    server round trip; touch = emit + debounced save
 *   arrange.setEnabled(on)                       the "play as arranged" switch
 *   arrange.buffer(version, onProgress) / .ensure / .ready / .warm / .forget   decoding
 *   arrange.detect(version)                      guess tempo + sections, lay the song out
 *   arrange.setTempo / .setOffset                tempo changes keep beats, not seconds
 *   arrange.move(id, index, quiet) / .duplicate / .remove / .resize(id, edge, beats)
 *   arrange.renamePart / .setLyricsFor / .partForSheet
 *   arrange.select(clipId | null)                the chosen block (reactive state.selected)
 *   arrange.start/.stop/.seek/.finished/.resync  transport (the player drives these)
 *   loadShapes()                                 /api/arrangements/shapes for list pictures
 *   tempoFromTaps(timesMs)                       bpm from tap timestamps, or null
 *   arranger                                     the same object, typed as the player's Arranger
 *
 * An arrangement is a list of clips. Each says which stretch of the render it takes and
 * how long it is, both counted in beats, and they play back to back in order. One track,
 * no gaps, no overlaps: enough for dropping bars out of an intro and going round a chorus
 * twice.
 *
 * Playback schedules a buffer source per clip rather than moving an audio element's
 * currentTime. Seeking an element takes an unpredictable moment and would put a gap at
 * every join, which is exactly where you are listening hardest. Each source feeds both
 * decks at once, so switching A to B changes which equaliser the same audio passes
 * through, instantly: when the compositor is on, A and B compare sounds, not takes.
 *
 * Registers itself with the player (setArranger) at module load: import this module once
 * at boot.
 */
import { engine } from "./engine";
import { beats as beatsApi, type BeatRead } from "./beats";
import { wave, type Peaks } from "./waveform";
import { get, api, uFor, attempt, u, guest, ApiError } from "../api";
import { emit } from "../bus";
import { clamp } from "../util";
import { setArranger, type Arranger } from "../player.svelte";

export interface Part {
  id: string;
  name: string;
  from: number;
  beats: number;
  hue: number;
}

export interface Clip {
  id: string;
  /** The part this clip came from, or null once that part is gone. */
  part: string | null;
  /** Beats into the render, counted from the offset. */
  from: number;
  beats: number;
}

/** What the server stores, and what /api/songs/<id>/arrangement returns. */
export interface Arrangement {
  song_id?: number;
  version_id?: number | null;
  bpm?: number;
  offset?: number;
  per_bar?: number;
  enabled?: boolean | number;
  parts?: Part[];
  clips?: Clip[];
  /** part id -> lyric sheet id */
  lyrics?: Record<string, number>;
}

/** A clip placed on the timeline. */
export interface Laid {
  clip: Clip;
  /** Seconds from the start of the arrangement. */
  at: number;
  seconds: number;
  /** Seconds into the decoded render. */
  sourceAt: number;
  part: Part | null;
}

export interface ArrangeState {
  songId: number | null;
  versionId: number | string | null;
  bpm: number;
  offset: number;
  perBar: number;
  enabled: boolean;
  parts: Part[];
  clips: Clip[];
  lyrics: Record<string, number>;
  /** 0..1 from the last detect(); under beats.UNSURE the panel says "unsure". */
  confidence: number;
  loaded: boolean;
  /** The chosen block, if any. */
  selected: string | null;
  /** The section being heard right now, while arranged playback runs. */
  playingPart: string | null;
}

export const state: ArrangeState = $state({
  songId: null, versionId: null, bpm: 120, offset: 0, perBar: 4, enabled: false,
  parts: [], clips: [], lyrics: {}, confidence: 0, loaded: false,
  selected: null, playingPart: null,
});

export interface VersionRef { id: number | string; size?: number }

const buffers = new Map<number | string, AudioBuffer>();           // version id -> decoded
const loading = new Map<number | string, Promise<AudioBuffer | null>>();
let sources: AudioBufferSourceNode[] = [];
let startedAt = 0;                // ctx time when the current run began
let startedFrom = 0;              // timeline seconds at that moment
let running = $state(false);
/* The share the loaded arrangement belongs to. Saves are debounced, so by the time one is
 * sent the page may have moved on, and which library it goes to must be what it was when
 * the edit was made rather than whatever is current by then. */
let heldShare: string | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let resyncTimer: ReturnType<typeof setTimeout> | null = null;   // coalesces the reschedule an edit needs
let watching: ReturnType<typeof setInterval> | null = null;     // announces section changes
let sounding: string | null = null;                              // the section last announced

/* Put a stored arrangement into state. One place, so a fetched one and one handed over by
 * the page cannot end up meaning different things. */
function fill(a: Arrangement) {
  state.versionId = a.version_id || null;
  state.bpm = a.bpm || 120;
  state.offset = a.offset || 0;
  state.perBar = a.per_bar || 4;
  state.enabled = !!a.enabled;
  state.parts = a.parts || [];
  state.clips = a.clips || [];
  state.lyrics = a.lyrics || {};
  state.loaded = true;
  if (state.selected && !state.clips.some((c) => c.id === state.selected)) state.selected = null;
}

const beatSeconds = () => 60 / (state.bpm || 120);
const totalBeats = () => state.clips.reduce((sum, clip) => sum + clip.beats, 0);
const duration = () => totalBeats() * beatSeconds();

/* Where each clip sits on the timeline, in seconds. Computed rather than stored, so a
 * tempo correction moves everything at once and nothing can fall out of step. */
function laid(): Laid[] {
  const beat = beatSeconds();
  let at = 0;
  return state.clips.map((clip) => {
    const row: Laid = {
      clip,
      at,
      seconds: clip.beats * beat,
      sourceAt: state.offset + clip.from * beat,
      part: state.parts.find((p) => p.id === clip.part) || null,
    };
    at += row.seconds;
    return row;
  });
}

function stopSources() {
  for (const source of sources) {
    try { source.onended = null; source.stop(); } catch { /* already done */ }
    try { source.disconnect(); } catch { /* already gone */ }
  }
  sources = [];
}

/* Put every clip on the schedule, starting from `from` seconds into the timeline. */
function schedule(from: number): boolean {
  const ctx = engine.context();
  const buffer = state.versionId == null ? null : buffers.get(state.versionId);
  if (!ctx || !buffer) return false;
  stopSources();

  const inputs = (["A", "B"] as const).map((slot) => engine.inputOf(slot)).filter((n): n is GainNode => !!n);
  if (!inputs.length) return false;

  // A small lead so the first clip is scheduled rather than started late.
  const begin = ctx.currentTime + 0.06;
  let started = false;

  for (const row of laid()) {
    const endsAt = row.at + row.seconds;
    if (endsAt <= from) continue;                     // already behind the playhead
    const into = Math.max(0, from - row.at);          // part way through this clip
    const when = begin + Math.max(0, row.at - from);
    const sourceStart = row.sourceAt + into;
    const length = row.seconds - into;
    if (length <= 0.001) continue;
    if (sourceStart >= buffer.duration) continue;     // clip points past the end

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    for (const input of inputs) source.connect(input);
    // Never ask for more than the file holds: a clip that runs off the end simply stops,
    // which is honest, rather than throwing and killing the whole run.
    const playable = Math.min(length, Math.max(0, buffer.duration - sourceStart));
    if (playable <= 0.001) continue;
    source.start(when, sourceStart, playable);
    sources.push(source);
    started = true;
  }

  if (!started) return false;
  startedAt = begin;
  startedFrom = from;
  return true;
}

function positionNow(): number {
  const ctx = engine.context();
  if (!running || !ctx) return startedFrom;
  return Math.max(0, Math.min(duration(), startedFrom + (ctx.currentTime - startedAt)));
}

/* Fresh ids that do not collide with what is already there. */
function nextId(prefix: string, existing: { id: string }[]): string {
  let n = existing.length + 1;
  const taken = new Set(existing.map((item) => item.id));
  while (taken.has(prefix + n)) n++;
  return prefix + n;
}

function announce(partId: string | null) {
  if (partId === sounding) return;
  sounding = partId;
  state.playingPart = partId;
  emit("arrange:playing", { partId });
}

/** Beats per minute from tap timestamps (ms). Needs four taps; a pause over 2.2 s starts
 *  a new run, so the caller keeps the array and clears it when this returns a number. */
export function tempoFromTaps(times: number[]): number | null {
  if (times.length < 4) return null;
  const gaps: number[] = [];
  for (let i = 1; i < times.length; i++) gaps.push(times[i] - times[i - 1]);
  const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
  return mean > 0 ? 60000 / mean : null;
}

/** The shape of every arrangement that is switched on, for the small pictures in lists:
 *  song id -> [{ beats, hue }]. */
export async function loadShapes(): Promise<Record<string, { beats: number; hue: number }[]>> {
  const data = await get<{ shapes: Record<string, { beats: number; hue: number }[]> }>("/api/arrangements/shapes");
  return data.shapes || {};
}

export const arrange = {
  state,
  get running() { return running; },
  laid,
  duration,
  beatSeconds,
  totalBeats,
  get position() { return positionNow(); },

  // The Arranger interface the player talks to.
  get enabled() { return state.enabled; },
  get songId() { return state.songId; },
  get clipCount() { return state.clips.length; },

  /** Which clip is playing at a given moment, and which part it came from. */
  at(seconds: number): Laid | null {
    for (const row of laid()) {
      if (seconds >= row.at && seconds < row.at + row.seconds) return row;
    }
    return null;
  },

  peaks(): Peaks | null { return wave.known(state.versionId); },

  /** How long the decoded render is. The waveform peaks span exactly this, so it is what
   *  turns a clip's beats into a slice of the picture. */
  sourceSeconds(): number {
    const buffer = state.versionId == null ? null : buffers.get(state.versionId);
    return buffer ? buffer.duration : 0;
  },

  /** Take an arrangement the page already fetched, without asking for it again. The song
   *  page loads everything in one parallel batch; a second fetch added a round trip to
   *  every visit and started reading the render a beat too late to help. */
  adopt(songId: number | string, arrangement: Arrangement | null | undefined) {
    heldShare = guest.current?.share ?? null;
    // A number, always. The id arrives as a string from the address and as a number from
    // the API, and the player decides whether the compositor runs by comparing the two.
    // "2" !== 2 meant it quietly never ran.
    state.songId = Number(songId);
    fill(arrangement || {});
    emit("arrange:change");
    return state;
  },

  async load(songId: number | string): Promise<void> {
    const id = Number(songId);
    const share = guest.current?.share ?? null;
    // The same number under another share (or none) is somebody else's song.
    if (state.songId === id && state.loaded && share === heldShare) return;
    state.songId = id;
    heldShare = share;
    const data = await get<{ arrangement?: Arrangement }>(`/api/songs/${id}/arrangement`);
    // Whoever asked last wins: a slow answer for a song we have left must not land.
    if (state.songId !== id) return;
    fill(data.arrangement || {});
    emit("arrange:change");
  },

  /** Put the running audio back in step with an arrangement that has just changed.
   *
   * Not immediately, and not once per pointermove. Rescheduling tears down every source
   * and builds new ones, which took three quarters of a second in the middle of a drag
   * and restarted the audio seventy times over one trim. Edits coalesce: the last one
   * within a beat of quiet is the one that gets played. */
  resync() {
    if (!running) return;
    if (resyncTimer) clearTimeout(resyncTimer);
    resyncTimer = setTimeout(() => {
      resyncTimer = null;
      if (running) schedule(clamp(positionNow(), 0, Math.max(0, duration() - 0.01)));
    }, 140);
  },

  /** Announce a change and save it, written whole and not on every pixel of a drag. */
  touch() {
    emit("arrange:change");
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { saveTimer = null; void arrange.save(); }, 600);
  },

  async save() {
    if (!state.songId) return null;
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    const songId = state.songId;
    const done = await attempt(() => api(uFor(heldShare, `/api/songs/${songId}/arrangement`), { method: "PUT", direct: true, json: {
      version_id: state.versionId,
      bpm: state.bpm, offset: state.offset, per_bar: state.perBar,
      enabled: state.enabled, parts: state.parts, clips: state.clips,
      lyrics: state.lyrics,
    } }));
    if (done) emit("arrangement:changed", { songId });
    return done;
  },

  /** The "play as arranged" switch. Its own call on the server, so turning it off can
   *  never lose the shape; the first time, before an arrangement exists, it is a save. */
  async setEnabled(on: boolean) {
    state.enabled = !!on;
    if (!on) arrange.stop();
    emit("arrange:change");
    try {
      await api(uFor(heldShare, `/api/songs/${state.songId}/arrangement/enabled`), { method: "POST", direct: true, json: { on: !!on } });
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) await arrange.save();
      else await attempt(async () => { throw e; });
    }
    if (state.songId) emit("arrangement:changed", { songId: state.songId });
  },

  /** Decode a version once, and keep both the audio and its picture.
   *
   * A four minute wav is forty five megabytes, and arranged playback needs all of it
   * before it can schedule a single clip: you cannot cut a file you have not got. So this
   * reports progress as it goes and is only ever done once per render. */
  async buffer(version: VersionRef | null, onProgress?: (fraction: number, got: number, total: number) => void): Promise<AudioBuffer | null> {
    if (!version) return null;
    const cached = buffers.get(version.id);
    if (cached) return cached;
    const inFlight = loading.get(version.id);
    if (inFlight) return inFlight;

    const job = (async () => {
      const ctx = await engine.resume();
      if (!ctx) return null;
      const response = await fetch(u(`/api/versions/${version.id}/audio`));
      if (!response.ok) throw new Error("That render would not load.");

      const total = Number(response.headers.get("Content-Length")) || version.size || 0;
      let bytes: ArrayBuffer;
      if (response.body && total) {
        // Read it in pieces so the wait can be shown rather than guessed at.
        const reader = response.body.getReader();
        const parts: Uint8Array[] = [];
        let got = 0;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          parts.push(value);
          got += value.length;
          onProgress?.(got / total, got, total);
        }
        const joined = new Uint8Array(got);
        let at = 0;
        for (const part of parts) { joined.set(part, at); at += part.length; }
        bytes = joined.buffer;
      } else {
        bytes = await response.arrayBuffer();
      }
      onProgress?.(1, total, total);

      const decoded = await ctx.decodeAudioData(bytes);
      buffers.set(version.id, decoded);
      wave.remember(version.id, wave.peaksOf(decoded));
      emit("arrange:ready", { versionId: version.id });
      return decoded;
    })();

    loading.set(version.id, job);
    try { return await job; } finally { loading.delete(version.id); }
  },

  /** Is the audio for this arrangement in hand yet. */
  ready(versionId?: number | string | null): boolean {
    const id = versionId === undefined ? state.versionId : versionId;
    return id != null && buffers.has(id);
  },

  /** The render this arrangement is built from, ready to be read. Which render that is
   *  belongs to the arrangement, not to whatever the song's current version happens to
   *  be: a newer bounce landing does not silently repoint an arrangement at a file whose
   *  bars are somewhere else. */
  async ensure(onProgress?: (fraction: number) => void): Promise<AudioBuffer | null> {
    if (!state.versionId) return null;
    return arrange.buffer({ id: state.versionId }, onProgress);
  },

  /** Start reading it without waiting. Called when a song page opens, so that by the time
   *  anyone presses play the wait has usually already happened. */
  warm() {
    if (state.versionId == null || buffers.has(state.versionId) || loading.has(state.versionId)) return;
    arrange.ensure().catch(() => { /* pressing play will report it properly */ });
  },

  /** Guess the tempo and the sections, and lay the whole song out as it stands. The
   *  result is a starting point; everything it decided is editable. */
  async detect(version: VersionRef): Promise<BeatRead> {
    const buffer = await arrange.buffer(version);
    if (!buffer) throw new Error("There is nothing to listen to yet.");
    const read = beatsApi.read(buffer, state.perBar);
    // A silent render has nothing to lay out; the caller says so.
    if (read.silent) return read;
    state.versionId = version.id;
    state.bpm = read.bpm;
    state.offset = read.offset;
    state.confidence = read.confidence;
    state.parts = read.parts;
    // One clip per part, in order: the arrangement starts as the song already is.
    state.clips = read.parts.map((part, index) => ({
      id: "c" + (index + 1), part: part.id, from: part.from, beats: part.beats,
    }));
    state.selected = null;
    arrange.touch();
    return read;
  },

  /** Tempo changes keep the music, not the numbers: beats stay where they are. */
  setTempo(bpm: number) {
    if (!Number.isFinite(bpm)) return;
    state.bpm = clamp(bpm, 20, 400);
    arrange.touch();
    arrange.resync();
  },

  setOffset(seconds: number) {
    state.offset = Math.max(-60, Math.min(600, seconds));
    arrange.touch();
    arrange.resync();
  },

  // ── editing ────────────────────────────────────────────────────────────────

  select(clipId: string | null) {
    state.selected = clipId && state.clips.some((c) => c.id === clipId) ? clipId : null;
  },

  /** Put a clip somewhere else in the order.
   *
   * `quiet` is for the middle of a drag. touch() emits arrange:change, and the lyric deck
   * rebuilds every card on that event, so announcing each boundary a block crosses means
   * rebuilding the deck several times a second for an order nobody has settled on. A
   * quiet move still changes the order: what it skips is telling anybody. Whoever is
   * dragging owes one touch() + resync() when the gesture ends. */
  move(clipId: string, toIndex: number, quiet = false) {
    const from = state.clips.findIndex((c) => c.id === clipId);
    if (from < 0) return;
    const [clip] = state.clips.splice(from, 1);
    state.clips.splice(clamp(toIndex, 0, state.clips.length), 0, clip);
    if (quiet) return;
    arrange.touch();
    arrange.resync();
  },

  duplicate(clipId: string): Clip | null {
    const index = state.clips.findIndex((c) => c.id === clipId);
    if (index < 0) return null;
    const copy: Clip = { ...state.clips[index], id: nextId("c", state.clips) };
    state.clips.splice(index + 1, 0, copy);
    arrange.touch();
    arrange.resync();
    // Read back through the proxy, so the caller holds the live object.
    return state.clips[index + 1];
  },

  remove(clipId: string) {
    state.clips = state.clips.filter((c) => c.id !== clipId);
    if (state.selected === clipId) state.selected = null;
    arrange.touch();
    arrange.resync();
  },

  /** Trim a clip. `edge` is "start" or "end"; beats is the new whole number of beats. */
  resize(clipId: string, edge: "start" | "end", beats: number) {
    const clip = state.clips.find((c) => c.id === clipId);
    if (!clip) return;
    const wanted = Math.max(1, Math.round(beats));
    if (edge === "start") {
      // Pulling the left edge moves where in the render the clip begins, so the music
      // under the right hand edge does not shift while you drag the left one.
      clip.from = Math.max(0, clip.from + (clip.beats - wanted));
    }
    clip.beats = wanted;
    arrange.touch();
    arrange.resync();
  },

  renamePart(partId: string, name: string) {
    const part = state.parts.find((p) => p.id === partId);
    if (!part) return;
    part.name = String(name || "").trim().slice(0, 60) || part.name;
    arrange.touch();
  },

  /** Point one sheet of words at one section, or at none. A sheet belongs to at most one
   *  section, so any earlier link for it is dropped first: doing that here is what keeps
   *  the two ends from disagreeing about which card lights up. */
  setLyricsFor(sheetId: number, partId: string | null) {
    for (const [part, id] of Object.entries(state.lyrics)) {
      if (id === sheetId) delete state.lyrics[part];
    }
    if (partId) state.lyrics[partId] = sheetId;
    arrange.touch();
    emit("arrange:lyrics");
  },

  partForSheet(sheetId: number): Part | null {
    const found = Object.entries(state.lyrics).find(([, id]) => id === sheetId);
    return found ? state.parts.find((p) => p.id === found[0]) || null : null;
  },

  // ── transport ──────────────────────────────────────────────────────────────

  /* Announce the section being heard, as it changes. It lives here rather than in the
   * compositor panel because the words light up during ordinary listening, and the panel
   * is usually shut. */
  _watch() {
    if (watching) return;
    watching = setInterval(() => {
      if (!running) {
        announce(null);
        if (watching) clearInterval(watching);
        watching = null;
        return;
      }
      const row = arrange.at(positionNow());
      announce(row && row.part ? row.part.id : null);
    }, 80);
  },

  async start(from?: number): Promise<boolean> {
    const ctx = await engine.resume();
    if (!ctx) return false;
    engine.wire("A"); engine.wire("B");
    const at = from === undefined ? positionNow() : from;
    const ok = schedule(at >= duration() - 0.02 ? 0 : at);
    running = ok;
    if (ok) arrange._watch();
    return ok;
  },

  stop() {
    if (running) startedFrom = positionNow();
    if (resyncTimer) { clearTimeout(resyncTimer); resyncTimer = null; }
    stopSources();
    running = false;
    announce(null);
  },

  seek(seconds: number) {
    const at = clamp(seconds, 0, Math.max(0, duration() - 0.01));
    if (running) schedule(at); else startedFrom = at;
  },

  /** Has the run reached the end. The player asks each frame rather than relying on an
   *  ended event, because the last clip ending is not the same as the arrangement
   *  finishing when a clip was cut short. */
  finished(): boolean {
    return running && positionNow() >= duration() - 0.02;
  },

  forget(versionId: number | string) {
    buffers.delete(versionId);
    wave.forget(versionId);
  },
};

/** The same object, typed as what the player takes over the transport with. */
export const arranger: Arranger = arrange;
setArranger(arranger);
