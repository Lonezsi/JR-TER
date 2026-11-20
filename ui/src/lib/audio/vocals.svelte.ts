/* Voices over a song: recorded here, layered, and played with it.
 *
 * PUBLIC API
 *  State (reactive)
 *   voices            { songId, takes, loading, layers, watching, recording, level }
 *                     recording = { count, startedAt } while a recording is under way;
 *                     level = 0..1 microphone peak, updated ~20 times a second
 *  Takes
 *   loadTakes(songId, bedVersionId?)   fetch the song's takes and (re)start the layers
 *   vocals.use(songId, takes, bedVersionId) / .leave() / .refresh() / .live / .decode(take)
 *   vocalUrl(take)                     where a take's bytes are (digest in the address)
 *   mayChange(take)                    yours, or you are not a guest
 *   setTakeEnabled / setTakeFx / renameTake / removeTake / addRecording(songId, file)
 *  Recording
 *   canRecord()                        MediaRecorder + getUserMedia exist
 *   startRecording(song)               takes over the player, loops it, one take per pass
 *   stopRecording()
 *  Mixing and files
 *   mixdown(takes, renderVersion|null) → WAV Blob of the voices (with the ducked render)
 *   downloadBlob(blob, filename)
 *   wav(buffer)                        AudioBuffer → 16 bit WAV Blob (J.wav)
 *  The vocal edit (J.vocalFx)
 *   vocalFx.KINDS / RATE / want / touch / bufferFor / ducks / combine / duckBed / settle /
 *            ducker / status(take) (reactive)
 *   VocalEdit                          class that edits one take's chain and saves it
 *   makeEffect(type) fmtKnob(value, unit) knobFill(value,min,max) FX_SAY
 *
 * PLAYING the layers follows the player: nothing runs (no timer, no decoding) unless
 * this song is the one playing. While it does, the layers are checked against the song's
 * position a few times a second, and restarted after a seek, a loop or a stall. They
 * connect to engine.output(), so the volume knob turns them down with everything else.
 *
 * NOTHING in the vocal edit runs live. A take's edit is rendered once, in the background,
 * into a new buffer, and that buffer is what plays. While a slider is moving nothing is
 * rendered; the render starts when it has been left alone for a moment, runs off the
 * page's thread (OfflineAudioContext for the filters, a worker for autotune and the
 * envelopes) and swaps in when done. Until then the last render keeps playing. The one
 * thing that must happen while the song plays is the voice ducking the render, because
 * the render is the player's own decks: that too is worked out in advance, as a gain
 * curve per band, and playing it is three gain nodes following their curves.
 *
 * Call order: loadTakes() when a song's vocals are shown, vocals.leave() when they are
 * not. Everything else is safe to call at any time.
 */
import { micConstraint, refreshDevices } from "./devices.svelte";
import { untrack } from "svelte";
import { engine } from "./engine";
import { encodeWav } from "./wav";
import { get, api, patch, del, upload, attempt, u, uFor, guest } from "../api";
import { app, me } from "../app.svelte";
import { on as onBus, emit } from "../bus";
import { player, now, playSong, toggle } from "../player.svelte";
import { toast } from "../toast.svelte";
import { clamp, debounce, wait } from "../util";
import type { Song } from "../types";

// ── types ───────────────────────────────────────────────────────────────────

export type FxType = "eq" | "limiter" | "autotune" | "sidechain";

/** One effect in a take's chain. The numbers it holds depend on its type (see KINDS). */
export interface FxEffect {
  type: FxType;
  on: boolean;
  [key: string]: string | number | boolean;
}

export interface VocalTake {
  id: number;
  song_id?: number;
  name: string;
  digest?: string;
  ext?: string;
  size?: number;
  duration: number;
  /** Where in the song it starts, in seconds. */
  offset: number;
  enabled: boolean | number;
  gain: number | null;
  /** The vocal edit's switch: 0 keeps the edit but plays the take as sung. */
  fx: number;
  chain: FxEffect[];
  by?: string;
  by_handle?: string;
  yours?: boolean;
}

/** [key, label, min, max, step, unit] */
export type Knob = readonly [string, string, number, number, number, string];
/** [key, label, [value, text][]] */
export type Pick = readonly [string, string, readonly (readonly [string | number, string])[]];
export interface KindDef {
  label: string;
  make(): FxEffect;
  knobs: readonly Knob[];
  picks?: readonly Pick[];
}

export interface Duck { offset: number; curves: Float32Array[] }
export type FxStatus = "none" | "waiting" | "rendering" | "ready" | "failed";

/** The words for each status, as the old sheet said them. */
export const FX_SAY: Record<FxStatus, string> = {
  none: "", waiting: "Renders when you stop", rendering: "Rendering...",
  ready: "Up to date", failed: "Could not render this",
};

// ── reactive state ──────────────────────────────────────────────────────────

export const voices = $state({
  songId: null as number | null,
  takes: [] as VocalTake[],
  loading: false,
  /** How many layers are sounding right now. */
  layers: 0,
  /** Whether anything is keeping watch on the player. */
  watching: false,
  recording: null as null | { count: number; startedAt: number },
  level: 0,
});

/** Where a take's bytes are. Keyed by digest as well as id: an id comes back (delete the
 *  newest take and record another, and SQLite hands out the same number) and the browser
 *  keeps a file for a day. */
export const vocalUrl = (take: Pick_<VocalTake, "id" | "digest">) =>
  u(`/api/vocals/${take.id}/audio`) + "?v=" + encodeURIComponent(take.digest || "");
type Pick_<T, K extends keyof T> = { [P in K]?: T[P] } & { id: number };

export const mayChange = (take: VocalTake) => !!take.yours || !guest.current;

/** An AudioBuffer as a 16 bit WAV file, for downloads. */
export const wav = (buffer: AudioBuffer): Blob => encodeWav(buffer);

// ── the worker ──────────────────────────────────────────────────────────────

let worker: Worker | null = null;
let asked = 0;
const waiting = new Map<number, { resolve(v: unknown): void; reject(e: Error): void }>();

function work<T>(op: string, args: unknown[]): Promise<T> {
  if (!worker) {
    worker = new Worker(new URL("./vocal-worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (e: MessageEvent<{ id: number; out?: unknown; error?: string }>) => {
      const job = waiting.get(e.data.id);
      waiting.delete(e.data.id);
      if (!job) return;
      if (e.data.error) job.reject(new Error(e.data.error));
      else job.resolve(e.data.out);
    };
  }
  const id = ++asked;
  const moved: ArrayBuffer[] = [];
  const collect = (v: unknown) => {
    if (v instanceof Float32Array) moved.push(v.buffer as ArrayBuffer);
    else if (Array.isArray(v)) v.forEach(collect);
  };
  collect(args);
  return new Promise<T>((resolve, reject) => {
    waiting.set(id, { resolve: resolve as (v: unknown) => void, reject });
    worker!.postMessage({ id, op, args }, moved);
  });
}

// ── buffers ─────────────────────────────────────────────────────────────────

const copyOf = (buffer: AudioBuffer): Float32Array[] =>
  Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c).slice());

function bufferOf(chs: Float32Array[], sampleRate: number): AudioBuffer {
  const buffer = new AudioBuffer({ length: chs[0].length, numberOfChannels: chs.length, sampleRate });
  chs.forEach((d, c) => buffer.copyToChannel(d as Float32Array<ArrayBuffer>, c));
  return buffer;
}

type Ends = { input: AudioNode; output: AudioNode };

/** One pass of a buffer through some nodes, off the page's thread. */
async function offline(buffer: AudioBuffer, build: (ctx: OfflineAudioContext) => Ends): Promise<AudioBuffer> {
  const off = new OfflineAudioContext(buffer.numberOfChannels, buffer.length, buffer.sampleRate);
  const src = off.createBufferSource();
  src.buffer = buffer;
  const ends = build(off);
  src.connect(ends.input);
  ends.output.connect(off.destination);
  src.start(0);
  return off.startRendering();
}

/** [type, freq, gain?, q?] */
type FilterSpec = readonly [BiquadFilterType, number, number?, number?];

/** A run of filters, input to output. */
function filters(ctx: BaseAudioContext, list: readonly FilterSpec[]): Ends {
  const input = ctx.createGain();
  let node: AudioNode = input;
  for (const [type, freq, gain, q] of list) {
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = clamp(freq, 10, ctx.sampleRate / 2 - 100);
    f.gain.value = gain || 0;
    f.Q.value = q == null ? Math.SQRT1_2 : q;
    node.connect(f);
    node = f;
  }
  return { input, output: node };
}

// ── the vocal edit ──────────────────────────────────────────────────────────

const RATE = 100;                       // envelope points per second
const XOVER = [250, 4000];              // where the sidechain's three bands meet
const BANDS = ["low", "mid", "high"];
const QUIET_MS = 800;                   // how long a slider is left alone before rendering
const NOTES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

/** What each effect holds, and the controls it gets. */
const KINDS: Record<FxType, KindDef> = {
  eq: {
    label: "EQ",
    make: () => ({ type: "eq", on: true, lowcut: 80, low: 0, midFreq: 2500, mid: 0, midQ: 1, high: 0 }),
    knobs: [["lowcut", "Low cut", 20, 400, 1, "Hz"], ["low", "Low (200 Hz)", -12, 12, 0.5, "dB"],
            ["midFreq", "Middle at", 300, 8000, 10, "Hz"], ["mid", "Middle", -12, 12, 0.5, "dB"],
            ["midQ", "Middle width", 0.3, 4, 0.1, "Q"], ["high", "High (8 kHz)", -12, 12, 0.5, "dB"]],
  },
  limiter: {
    label: "Limiter",
    make: () => ({ type: "limiter", on: true, threshold: -12, ceiling: -1, release: 120 }),
    knobs: [["threshold", "Threshold", -30, 0, 0.5, "dB"], ["ceiling", "Ceiling", -12, 0, 0.1, "dB"],
            ["release", "Release", 10, 500, 1, "ms"]],
  },
  autotune: {
    label: "Autotune",
    make: () => ({ type: "autotune", on: true, key: 0, scale: "chromatic", speed: 20, amount: 100 }),
    picks: [["key", "Key", NOTES.map((n, i) => [i, n] as const)],
            ["scale", "Scale", [["chromatic", "Every note"], ["major", "Major"], ["minor", "Minor"]]]],
    knobs: [["speed", "Retune speed", 0, 200, 1, "ms"], ["amount", "Amount", 0, 100, 1, "%"]],
  },
  sidechain: {
    label: "Multiband sidechain",
    make: () => ({ type: "sidechain", on: true, dir: "render", threshold: -30,
                   low: 6, mid: 6, high: 3, attack: 10, release: 150 }),
    picks: [["dir", "Which way", [["render", "The render ducks this voice"],
                                   ["voice", "This voice ducks the render"]]]],
    knobs: [["threshold", "Threshold", -60, 0, 0.5, "dB"],
            ["low", "Low, under 250 Hz", 0, 24, 0.5, "dB"], ["mid", "Middle", 0, 24, 0.5, "dB"],
            ["high", "High, over 4 kHz", 0, 24, 0.5, "dB"],
            ["attack", "Attack", 1, 100, 1, "ms"], ["release", "Release", 10, 1000, 1, "ms"]],
  },
};

/** A fresh effect of one kind, with its defaults. */
export const makeEffect = (type: FxType): FxEffect => KINDS[type].make();

/** A knob's value as the sheet shows it. 20 Hz on a low cut means it is off. */
export const fmtKnob = (v: number, unit: string) =>
  unit === "Hz" && v === 20 ? "off"
    : `${Math.abs(v) < 10 && v % 1 ? v.toFixed(1) : Math.round(v * 10) / 10} ${unit}`;

/** Where a slider's fill stops, as a percentage. */
export const knobFill = (v: number, min: number, max: number) => ((v - min) / (max - min)) * 100;

/* The three bands, each a pair of Butterworths either side (Linkwitz-Riley), so they add
 * back up to the signal they came from. Shared by the offline split and the live ducker,
 * so what is measured is what is turned down. */
const BAND_FILTERS: FilterSpec[][] = [
  [["lowpass", XOVER[0]], ["lowpass", XOVER[0]]],
  [["highpass", XOVER[0]], ["highpass", XOVER[0]], ["lowpass", XOVER[1]], ["lowpass", XOVER[1]]],
  [["highpass", XOVER[1]], ["highpass", XOVER[1]]],
];
const split = (buffer: AudioBuffer) =>
  Promise.all(BAND_FILTERS.map((list) => offline(buffer, (off) => filters(off, list))));

const levels = async (buffer: AudioBuffer): Promise<Float32Array[]> =>
  Promise.all((await split(buffer)).map((band) =>
    work<Float32Array[]>("rms", [copyOf(band), band.sampleRate, RATE]).then((r) => r[0])));

/* A level in dB, a curve of gain: how far over the threshold, at 4:1, no deeper than the
 * band's depth, with attack and release. */
function duckCurve(db: Float32Array, fx: FxEffect, band: string): Float32Array {
  const depth = Math.max(0, Number(fx[band]) || 0);
  const out = new Float32Array(db.length);
  const up = 1 - Math.exp(-1000 / (RATE * Math.max(1, Number(fx.attack) || 10)));
  const down = 1 - Math.exp(-1000 / (RATE * Math.max(1, Number(fx.release) || 150)));
  const threshold = Number(fx.threshold) || -30;
  let cut = 0;
  for (let i = 0; i < db.length; i++) {
    const want = Math.min(depth, Math.max(0, (db[i] - threshold) * 0.75));
    cut += (want > cut ? up : down) * (want - cut);
    out[i] = Math.pow(10, -cut / 20);
  }
  return out;
}

const renderLevels = new Map<number | string, Promise<Float32Array[] | null>>();   // version id -> [low, mid, high] dB
function levelsOfRender(versionId: number | string | null): Promise<Float32Array[] | null> {
  if (!versionId) return Promise.resolve(null);
  if (!renderLevels.has(versionId)) {
    renderLevels.set(versionId, (async () => {
      const bytes = await fetch(u(`/api/versions/${versionId}/audio`)).then((r) => r.arrayBuffer());
      const ctx = engine.context();
      if (!ctx) return null;
      return levels(await ctx.decodeAudioData(bytes));
    })().catch(() => { renderLevels.delete(versionId); return null; }));
  }
  return renderLevels.get(versionId)!;
}

// ── one take, through its edit ──────────────────────────────────────────────

const active = (take: VocalTake) => (take.chain || []).filter((fx) => fx && fx.on && KINDS[fx.type]);
const usesRender = (take: VocalTake) => active(take).some((fx) => fx.type === "sidechain" && fx.dir !== "voice");
const keyOf = (take: VocalTake, version: number | string | null) =>
  JSON.stringify([take.digest, active(take), usesRender(take) ? version : null]);

async function process(take: VocalTake, raw: AudioBuffer, version: number | string | null) {
  let buffer = raw;
  const sr = raw.sampleRate;
  const ducks: Duck[] = [];
  for (const fx of active(take)) {
    const n = (key: string) => Number(fx[key]);
    if (fx.type === "eq") {
      buffer = await offline(buffer, (off) => filters(off, [
        ...(n("lowcut") > 20 ? [["highpass", n("lowcut")] as FilterSpec] : []),
        ["lowshelf", 200, n("low")], ["peaking", n("midFreq"), n("mid"), n("midQ")],
        ["highshelf", 8000, n("high")]]));
    } else if (fx.type === "limiter") {
      // The same numbers the deck's limiter is built from (engine.ts): a 0 dB knee, 20:1.
      buffer = await offline(buffer, (off) => {
        const lim = off.createDynamicsCompressor();
        lim.knee.value = 0;
        lim.ratio.value = 20;
        lim.attack.value = 0.002;
        lim.threshold.value = clamp(n("threshold"), -60, 0);
        lim.release.value = clamp(n("release") / 1000, 0.001, 1);
        const makeup = off.createGain();
        makeup.gain.value = Math.pow(10, (clamp(n("ceiling"), -30, 0) - lim.threshold.value) / 20);
        lim.connect(makeup);
        return { input: lim, output: makeup };
      });
    } else if (fx.type === "autotune") {
      buffer = bufferOf(await work<Float32Array[]>("autotune", [copyOf(buffer), sr, { ...fx }]), sr);
    } else if (fx.type === "sidechain" && fx.dir === "voice") {
      const db = await levels(buffer);
      ducks.push({ offset: take.offset || 0, curves: db.map((d, i) => duckCurve(d, fx, BANDS[i])) });
    } else if (fx.type === "sidechain") {
      const key = await levelsOfRender(version);
      if (!key) continue;
      const bands = await split(buffer);
      const curves = key.map((d, i) => duckCurve(d, fx, BANDS[i]));
      buffer = bufferOf(await work<Float32Array[]>("mix", [bands.map(copyOf), curves, sr / RATE,
                                                           (take.offset || 0) * RATE]), sr);
    }
  }
  return { buffer, ducks };
}

// ── the queue ───────────────────────────────────────────────────────────────

interface Result { key: string; buffer: AudioBuffer | null; ducks: Duck[]; error?: string }
const results = new Map<number, Result>();          // take id -> result
const rendering = new Map<number, "rendering">();
const tick = $state({ n: 0 });                       // read by status() so the UI follows it
let fxList: VocalTake[] = [];
let fxVersion: number | string | null = null;
let quietUntil = 0;
let timer: ReturnType<typeof setTimeout> | undefined;
let busy = false;

const needed = () => fxList.filter((t) => t.fx !== 0 && active(t).length
  && (!results.has(t.id) || results.get(t.id)!.key !== keyOf(t, fxVersion)));

function tell(id: number) {
  tick.n++;
  emit("vocals:fx", { id, state: status({ id } as VocalTake) });
}

function kick() {
  clearTimeout(timer);
  timer = setTimeout(run, Math.max(0, quietUntil - performance.now()) + 30);
}

async function run() {
  if (busy) return;
  if (performance.now() < quietUntil) { kick(); return; }
  const take = needed()[0];
  if (!take) return;
  busy = true;
  const key = keyOf(take, fxVersion);
  rendering.set(take.id, "rendering");
  tell(take.id);
  try {
    const raw = await vocals.decode(take);
    if (raw) results.set(take.id, { key, ...(await process(take, raw, fxVersion)) });
  } catch (e) {
    results.set(take.id, { key, buffer: null, ducks: [], error: (e as Error).message });
  }
  busy = false;
  rendering.delete(take.id);
  tell(take.id);
  emit("vocals:rendered", { id: take.id });
  if (needed().length) kick();
}

function status(take: Pick_<VocalTake, "chain" | "fx">): FxStatus {
  void tick.n;
  const t = fxList.find((x) => x.id === take.id) || (take as VocalTake);
  if (rendering.get(t.id) === "rendering") return "rendering";
  if (!t.chain || !active(t).length || t.fx === 0) return "none";
  const r = results.get(t.id);
  if (r && r.error) return "failed";
  return r && r.key === keyOf(t, fxVersion) ? "ready" : "waiting";
}

/* The live side of "this voice ducks the render": three bands between the decks and the
 * speakers, each following its curve. Built when a song that needs it starts, and taken
 * out again when it stops, so most of the time the render has a plain wire. */
const ducker = (() => {
  let nodes: { from: GainNode; to: GainNode; sum: GainNode; gains: GainNode[] } | null = null;
  function build() {
    const ctx = engine.context();
    const bed = engine.bed();
    if (!ctx || !bed) return;
    const { from, to } = bed;
    from.disconnect();
    const sum = ctx.createGain();
    sum.connect(to);
    const gains = BAND_FILTERS.map((list) => {
      const chain = filters(ctx, list);
      const gain = ctx.createGain();
      from.connect(chain.input);
      chain.output.connect(gain).connect(sum);
      return gain;
    });
    nodes = { from, to, sum, gains };
  }
  return {
    /** Follow these curves from song position `pos`, which is heard at context time `when`. */
    play(curves: Float32Array[], pos: number, when: number) {
      if (!nodes) build();
      const ctx = engine.context();
      if (!nodes || !ctx) return;
      const start = Math.max(0, Math.floor(pos * RATE));
      nodes.gains.forEach((g, b) => {
        g.gain.cancelScheduledValues(0);
        g.gain.setValueAtTime(1, ctx.currentTime);
        const rest = curves[b].subarray(start);
        if (rest.length > 1) g.gain.setValueCurveAtTime(rest, when, rest.length / RATE);
      });
    },
    off() {
      if (!nodes) return;
      try { nodes.from.disconnect(); } catch { /* already */ }
      try { nodes.sum.disconnect(); } catch { /* already */ }
      nodes.from.connect(nodes.to);
      nodes = null;
    },
    get on() { return !!nodes; },
  };
})();

export const vocalFx = {
  KINDS,
  RATE,

  /** These are the song's takes, and this is the render they sit on. Anything whose edit
   *  has not been rendered yet is queued. */
  want(takes: VocalTake[] | null, versionId: number | string | null) {
    fxList = takes || [];
    fxVersion = versionId || null;
    if (needed().length) kick();
  },

  /** Somebody is moving something. Nothing renders until they stop. */
  touch() {
    quietUntil = performance.now() + QUIET_MS;
    const pending = needed();
    fxList.forEach((t) => { if (pending.indexOf(t) !== -1) tell(t.id); });
    kick();
  },

  /** What to play for a take: its edit when there is one and it is on, the take as sung
   *  otherwise. A stale render plays until the new one is ready. */
  bufferFor(take: VocalTake, raw: AudioBuffer | null): AudioBuffer | null {
    if (take.fx === 0 || !active(take).length) return raw;
    const r = results.get(take.id);
    return (r && r.buffer) || raw;
  },

  /** Every voice ducking the render right now. */
  ducks(takes: VocalTake[]): Duck[] {
    const out: Duck[] = [];
    for (const t of takes) {
      if (!t.enabled || t.fx === 0 || !active(t).some((fx) => fx.type === "sidechain" && fx.dir === "voice")) continue;
      const r = results.get(t.id);
      if (r && r.ducks) out.push(...r.ducks);
    }
    return out;
  },

  /** The ducks as one curve per band over the whole song. */
  combine(ducks: Duck[], seconds: number): Float32Array[] {
    const len = Math.ceil(seconds * RATE) + 2;
    return BANDS.map((_, b) => {
      const out = new Float32Array(len).fill(1);
      for (const d of ducks) {
        const curve = d.curves[b];
        const at = Math.round(d.offset * RATE);
        for (let i = 0; i < curve.length; i++) {
          const j = at + i;
          if (j >= 0 && j < len) out[j] *= curve[i];
        }
      }
      return out;
    });
  },

  /** The render, ducked by the voices, for a download. */
  async duckBed(bed: AudioBuffer, ducks: Duck[]): Promise<AudioBuffer> {
    if (!ducks.length) return bed;
    const curves = vocalFx.combine(ducks, bed.duration);
    const bands = await split(bed);
    return bufferOf(await work<Float32Array[]>("mix", [bands.map(copyOf), curves, bed.sampleRate / RATE, 0]),
                    bed.sampleRate);
  },

  /** Render everything now, whether or not anybody is still touching it. For a download. */
  async settle() {
    quietUntil = 0;
    for (let guard = 0; guard < 64 && (needed().length || busy); guard++) {
      if (!busy) await run(); else await wait(100);
    }
  },

  ducker,
  /** Reactive: reading it inside an effect or a template follows the queue. */
  status,
};

// ── playing the layers ──────────────────────────────────────────────────────

/* Keyed by the take and its bytes, never the id alone (see vocalUrl). */
const buffers = new Map<string, AudioBuffer>();       // id:digest -> decoded
const loading = new Map<string, Promise<AudioBuffer | null>>();   // so one take decodes once
const bufferKey = (take: VocalTake) => `${take.id}:${take.digest || ""}`;
let songId: number | null = null;
let bedVersion: number | string | null = null;        // the render the voices sit on, for the sidechain
let sources: AudioBufferSourceNode[] = [];
let bus: GainNode | null = null;
let watcher: ReturnType<typeof setInterval> | null = null;
let anchor: { ctxTime: number; songPos: number } | null = null;   // when the layers were started
let generation = 0;

async function decode(take: VocalTake): Promise<AudioBuffer | null> {
  const key = bufferKey(take);
  const known = buffers.get(key);
  if (known) return known;
  if (!loading.has(key)) {
    loading.set(key, (async () => {
      const ctx = engine.context();
      if (!ctx) return null;
      const bytes = await fetch(vocalUrl(take)).then((r) => r.arrayBuffer());
      const buffer = await ctx.decodeAudioData(bytes);
      buffers.set(key, buffer);
      return buffer;
    })().catch(() => { loading.delete(key); return null; }));
  }
  return loading.get(key)!;
}

function stopSources() {
  sources.forEach((s) => { try { s.stop(); } catch { /* already stopped */ } });
  sources = [];
  anchor = null;
  voices.layers = 0;
}

function stopAll() {
  generation++;
  stopSources();
  ducker.off();
}

function here(): boolean {
  return !!(player.song && songId != null && Number(player.song.id) === Number(songId) && player.playing);
}

/* Start every switched-on take from where the song is now. */
async function start() {
  const run = ++generation;
  stopSources();
  if (!here()) { ducker.off(); return; }
  const ctx = engine.context();
  const out = engine.output();
  if (!ctx || !out) return;
  if (!bus) { bus = ctx.createGain(); bus.connect(out); }
  const live = voices.takes.filter((t) => t.enabled);
  await Promise.all(live.map(decode));
  // Another start, or a stop, got in while the takes decoded: that one wins.
  if (run !== generation || !here()) return;
  const lead = 0.06;
  const pos = now() + lead;
  const when = ctx.currentTime + lead;
  for (const take of live) {
    const buffer = vocalFx.bufferFor(take, buffers.get(bufferKey(take)) || null);
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
  voices.layers = sources.length;
  anchor = { ctxTime: when, songPos: pos };
  // Voices that duck the render: their curves, from here on.
  const ducks = vocalFx.ducks(live);
  if (ducks.length) {
    const end = Math.max(...ducks.map((d) => d.offset + d.curves[0].length / RATE));
    ducker.play(vocalFx.combine(ducks, end), pos, when);
  } else {
    ducker.off();
  }
}

/* While this song plays, check the layers are where the song is, a few times a second. A
 * seek, a loop or a stall moves the song; the layers are restarted to follow it. */
function watch() {
  if (watcher) clearInterval(watcher);
  watcher = null;
  voices.watching = false;
  if (!here()) { stopAll(); return; }
  if (!anchor) void start();
  voices.watching = true;
  watcher = setInterval(() => {
    if (!here()) {
      if (watcher) clearInterval(watcher);
      watcher = null;
      voices.watching = false;
      stopAll();
      return;
    }
    const ctx = engine.context();
    if (!anchor || !ctx) return;
    const expected = anchor.songPos + (ctx.currentTime - anchor.ctxTime);
    if (Math.abs(expected - now()) > 0.12) void start();
  }, 250);
}

// The player changed (play, pause, another song): follow it. Replaces the old
// "player:change" event, as an effect on the two things that matter.
$effect.root(() => {
  $effect(() => {
    void player.song?.id;
    void player.playing;
    untrack(() => { if (songId != null) watch(); });
  });
});
// A vocal edit finished rendering: play the new one from where the song is.
onBus("vocals:rendered", () => { if (songId != null && here()) void start(); });

export const vocals = {
  /** The page says which song and which takes. Changing either restarts the layers. */
  use(id: number, list: VocalTake[], versionId?: number | string | null) {
    songId = id;
    voices.songId = id;
    voices.takes = list || [];
    bedVersion = versionId || null;
    vocalFx.want(voices.takes, bedVersion);
    if (here()) void start(); else stopAll();
    watch();
  },
  leave() {
    songId = null;
    voices.songId = null;
    voices.takes = [];
    stopAll();
    if (watcher) clearInterval(watcher);
    watcher = null;
    voices.watching = false;
  },
  /** A take's edit changed: queue it for rendering. Playing carries on as it was. */
  refresh() { vocalFx.want(voices.takes, bedVersion); },
  /** How many layers are sounding right now, and whether anything is keeping watch. */
  get live() { return { layers: voices.layers, watching: voices.watching }; },
  decode,
  buffers,
};

// ── takes ───────────────────────────────────────────────────────────────────

/** Fetch a song's takes and hand them to the layer engine. `bedVersionId` is the render
 *  the voices sit on (the A deck's version, else the song's current one). */
export async function loadTakes(id: number, bedVersionId?: number | string | null): Promise<VocalTake[]> {
  voices.loading = true;
  const data = await attempt(() => get<{ takes: VocalTake[] }>(`/api/songs/${id}/vocals`));
  voices.loading = false;
  const list = (data && data.takes) || [];
  vocals.use(id, list, bedVersionId === undefined ? bedVersion : bedVersionId);
  return list;
}

const reload = () => (voices.songId != null ? loadTakes(voices.songId) : Promise.resolve([]));

export async function setTakeEnabled(take: VocalTake, on: boolean) {
  await attempt(() => patch(`/api/vocals/${take.id}`, { enabled: on }));
  await reload();
  emit("vocals:changed", { songId: voices.songId ?? undefined });
}

/** The vocal edit's own switch: the edit kept but not heard, to compare with the take as
 *  it was sung. */
export async function setTakeFx(take: VocalTake, on: boolean) {
  take.fx = on ? 1 : 0;
  vocals.refresh();
  await attempt(() => patch(`/api/vocals/${take.id}`, { fx: take.fx }));
  emit("vocals:rendered", { id: take.id });     // heard with it, or without, now
}

export async function renameTake(take: VocalTake, name: string) {
  const next = name.trim();
  if (!next || next === take.name) return;
  take.name = next;
  await attempt(() => patch(`/api/vocals/${take.id}`, { name: next }));
}

/** Delete a take. The recording goes for good, so the caller confirms first. */
export async function removeTake(take: VocalTake) {
  await attempt(() => del(`/api/vocals/${take.id}`), "Deleted");
  await reload();
  emit("vocals:changed", { songId: voices.songId ?? undefined });
}

/** Bring an existing recording from a file. */
export async function addRecording(id: number, file: File) {
  await attempt(() => upload(`/api/songs/${id}/vocals`, file, file.name,
    { "X-Offset": "0", "X-Label": file.name.replace(/\.[^.]+$/, "") }), "Added");
  await loadTakes(id);
  emit("vocals:changed", { songId: id });
}

// ── recording ───────────────────────────────────────────────────────────────

interface Recording {
  stream: MediaStream;
  recorder: MediaRecorder | null;
  loop: ReturnType<typeof setInterval>;
  meter: ReturnType<typeof setInterval>;
  source: MediaStreamAudioSourceNode | null;
  was: typeof player.repeat;
  stopping: boolean;
  count: number;
}
let rec: Recording | null = null;

export const canRecord = () => !!(navigator.mediaDevices && window.MediaRecorder);

/** Start recording on this song. If another song is playing, this one takes over; the
 *  song loops while recording, and each time it comes round again the pass that just
 *  ended becomes its own take. Resolves false when nothing was started (and says why). */
let starting = false;

export async function startRecording(song: Song): Promise<boolean> {
  // `rec` is only set after the microphone has been asked for and the song has started,
  // two awaits in. Until then a second press would open a second stream whose microphone
  // and timers nothing ever stopped.
  if (rec || starting) return false;
  starting = true;
  try { return await beginRecording(song); } finally { starting = false; }
}

async function beginRecording(song: Song): Promise<boolean> {
  if (rec) return false;
  if (!canRecord()) { toast("This browser cannot record.", "bad"); return false; }
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: {
      echoCancellation: false, noiseSuppression: false, autoGainControl: false, ...micConstraint() } });
    void refreshDevices();        // names show up once the mic has been allowed
  } catch {
    toast("No mic, or it wasn't allowed.", "bad");
    return false;
  }
  // This song, from where the player is.
  if (!player.song || player.song.id !== song.id) await playSong(song);
  else if (!player.playing) await toggle();
  const ctxA = engine.context();
  if (!ctxA) { stream.getTracks().forEach((t) => t.stop()); return false; }

  /* What the singer hears is late by the output latency, and what the microphone hands
   * over is late by its own. A take lined up by the clock alone lands behind the beat by
   * both, so each is placed that much earlier. */
  const track = stream.getAudioTracks()[0];
  const inLatency = (track.getSettings && (track.getSettings() as { latency?: number }).latency) || 0.01;
  const lag = (ctxA.outputLatency || 0) + (ctxA.baseLatency || 0) + inLatency;

  const was = player.repeat;
  player.repeat = "one";          // loop while recording (not saved: it is for this take only)
  const type = ["audio/webm;codecs=opus", "audio/mp4", "audio/ogg"].find(
    (t) => MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t)) || "";
  const ext = type.indexOf("mp4") !== -1 ? ".m4a" : type.indexOf("ogg") !== -1 ? ".ogg" : ".webm";
  const target = Number(song.id);

  // A meter on the microphone, tapped off the stream and connected to nothing.
  const analyser = ctxA.createAnalyser();
  analyser.fftSize = 1024;
  const source = ctxA.createMediaStreamSource(stream);
  source.connect(analyser);
  const samples = new Float32Array(analyser.fftSize);
  const meter = setInterval(() => {
    analyser.getFloatTimeDomainData(samples);
    let peak = 0;
    for (let i = 0; i < samples.length; i++) { const v = Math.abs(samples[i]); if (v > peak) peak = v; }
    voices.level = Math.min(1, peak);
  }, 50);

  const state: Recording = { stream, recorder: null, loop: 0 as never, meter, source, was, stopping: false, count: 0 };
  rec = state;
  voices.recording = { count: 0, startedAt: performance.now() };

  const segment = () => {
    const r = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
    const chunks: Blob[] = [];
    const from = Math.max(0, now() - lag);
    const began = performance.now();
    r.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    r.onstop = async () => {
      const seconds = (performance.now() - began) / 1000;
      if (seconds < 0.5) return;                 // a loop edge, not a take
      const blob = new Blob(chunks, { type: type || "audio/webm" });
      const who = me() || app.summary.auth?.who || null;
      const name = `Take ${voices.takes.length + 1}${who?.name ? " (" + who.name + ")" : ""}`;
      await attempt(() => upload(`/api/songs/${target}/vocals`,
        new File([blob], name + ext, { type: blob.type }), name + ext,
        { "X-Offset": String(from), "X-Duration": String(seconds), "X-Label": name }));
      await loadTakes(target);
      emit("vocals:changed", { songId: target });
    };
    r.start(250);
    return r;
  };
  state.recorder = segment();
  let last = now();
  state.loop = setInterval(() => {
    const here_ = now();
    // The song came round again: that pass is a take, and the next one starts at 0.
    if (here_ + 1 < last && rec && !rec.stopping && rec.recorder) {
      rec.recorder.stop();
      rec.count += 1;
      rec.recorder = segment();
      if (voices.recording) voices.recording.count = rec.count;
    }
    last = here_;
  }, 100);
  return true;
}

export function stopRecording() {
  if (!rec) return;
  const r = rec;
  r.stopping = true;
  clearInterval(r.loop);
  clearInterval(r.meter);
  try { r.recorder?.stop(); } catch { /* already */ }
  try { r.source?.disconnect(); } catch { /* already */ }
  r.stream.getTracks().forEach((t) => t.stop());
  player.repeat = r.was;
  if (player.playing) void toggle();
  rec = null;
  voices.recording = null;
  voices.level = 0;
}

// ── combining ───────────────────────────────────────────────────────────────

/** The switched-on takes mixed to one WAV, optionally over the render (ducked by any
 *  voice that ducks it). Null when nothing is switched on. */
export async function mixdown(takes: VocalTake[], renderVersion: { id: number | string } | null): Promise<Blob | null> {
  const live = takes.filter((t) => t.enabled);
  if (!live.length) { toast("Switch on at least one take."); return null; }
  toast("Putting it together...");
  const rate = 44100;
  await vocalFx.settle();
  const voicesBuf = await Promise.all(live.map(async (t) => vocalFx.bufferFor(t, await decode(t))));
  let bed: AudioBuffer | null = null;
  if (renderVersion) {
    const bytes = await fetch(u(`/api/versions/${renderVersion.id}/audio`)).then((r) => r.arrayBuffer());
    const ctx = engine.context();
    if (ctx) bed = await vocalFx.duckBed(await ctx.decodeAudioData(bytes), vocalFx.ducks(live));
  }
  const end = Math.max(bed ? bed.duration : 0,
    ...live.map((t, i) => (voicesBuf[i] ? t.offset + voicesBuf[i]!.duration : 0)));
  const off = new OfflineAudioContext(2, Math.ceil(end * rate) + rate, rate);
  if (bed) { const s = off.createBufferSource(); s.buffer = bed; s.connect(off.destination); s.start(0); }
  live.forEach((t, i) => {
    const buffer = voicesBuf[i];
    if (!buffer) return;
    const s = off.createBufferSource();
    s.buffer = buffer;
    const g = off.createGain();
    g.gain.value = t.gain == null ? 1 : t.gain;
    s.connect(g).connect(off.destination);
    s.start(t.offset);
  });
  return wav(await off.startRendering());
}

/** Hand a blob to the browser as a download. */
export function downloadBlob(blob: Blob, filename: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
}

// ── editing one take's chain ────────────────────────────────────────────────

/** The vocal edit for one take. Everything saves as it changes (debounced); `flush()`
 *  when the editor closes. Read `status` for the "Renders when you stop" line, and
 *  `take.chain` (reactive) for the cards.
 *
 *    const edit = new VocalEdit(take, () => anything that should refresh);
 *    edit.add("eq"); edit.set(0, "low", 3); edit.move(0, 1); edit.remove(1); edit.toggle(0);
 *    edit.setEditOn(false); edit.flush();
 */
export class VocalEdit {
  readonly take: VocalTake;
  readonly mayChange: boolean;
  private dirty = false;
  private changed: () => void;
  /* Read now, not when the timer fires: leaving a shared song flushes its last edit, and
     by then the page no longer says which library it belongs to. */
  private share = guest.current?.share ?? null;
  private save = debounce(async () => {
    if (!this.dirty) return;
    this.dirty = false;
    const url = uFor(this.share, `/api/vocals/${this.take.id}`);
    await attempt(() => api(url, { method: "PATCH", json: { chain: this.take.chain }, direct: true }));
  }, 400);

  constructor(take: VocalTake, changed: () => void = () => vocals.refresh()) {
    this.take = take;
    this.changed = changed;
    this.mayChange = mayChange(take);
    // Fill in any defaults an older save did not have.
    take.chain = (take.chain || []).map((fx) => Object.assign(KINDS[fx.type] ? KINDS[fx.type].make() : {}, fx) as FxEffect);
  }

  get chain(): FxEffect[] { return this.take.chain; }
  get status(): FxStatus { return status(this.take); }
  get say(): string { return FX_SAY[this.status]; }

  private mark() { this.dirty = true; this.save(); }
  private structural() { this.mark(); vocalFx.touch(); this.changed(); }

  add(type: FxType) { if (this.mayChange) { this.chain.push(makeEffect(type)); this.structural(); } }
  toggle(i: number) { if (this.mayChange && this.chain[i]) { this.chain[i].on = !this.chain[i].on; this.structural(); } }
  remove(i: number) { if (this.mayChange && this.chain[i]) { this.chain.splice(i, 1); this.structural(); } }
  /** Move the effect at `from` to position `to` (arrows and drag both use this). */
  move(from: number, to: number) {
    if (!this.mayChange || from === to || !this.chain[from] || to < 0 || to >= this.chain.length) return;
    this.chain.splice(to, 0, this.chain.splice(from, 1)[0]);
    this.structural();
  }
  /** A slider or a pick changed. Numbers stay numbers; the key pick is a number too. */
  set(i: number, key: string, value: string | number) {
    const fx = this.chain[i];
    if (!this.mayChange || !fx) return;
    fx[key] = typeof fx[key] === "number" ? Number(value) : value;
    this.mark();
    vocalFx.touch();
    this.changed();
  }
  /** The whole edit's switch. */
  async setEditOn(on: boolean) {
    if (!this.mayChange) return;
    await setTakeFx(this.take, on);
    this.changed();
  }
  /** Save anything pending at once. Call when the editor closes. */
  flush() { this.save.now(); }
}
