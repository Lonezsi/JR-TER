/* The playback engine.
 *
 * Two decks, and each one has its own processing. Both play, one of them is silent, and
 * switching A to B is a gain swap on the next audio block: the same bar of the other
 * take with no gap and no fade.
 *
 *   deck A ─ rack… ───── limiter ─ makeup ─ gain A ─┐
 *                                                  ├─ bed ─ master ─ out
 *   deck B ─ rack… ───── limiter ─ makeup ─ gain B ─┘       │
 *                                          vocal layers ───┘
 *
 * The bed is the render and nothing else, so a voice can duck it (a sidechain in the
 * vocal edit) without ducking itself. Most of the time it is one plain wire.
 *
 * The chains are separate rather than shared because a slot carries a preset as well as
 * a version: comparing the same mix through two equalisers is as much the point as
 * comparing two mixes.
 *
 * None of this is written to the stored file. It is applied while the browser plays.
 * Framework free on purpose: nothing here knows what draws it.
 */
import { clamp } from "../util";
import type { Band, SoundData } from "../types";
import { buildUnit, rackOf, shapeOf, type BuiltUnit } from "./rack";
import { applyOutput } from "./devices.svelte";

export type Slot = "A" | "B";
export const SLOTS: Slot[] = ["A", "B"];

export const FLAT: SoundData = { bands: [], limiter: { on: false }, gain: 0, bypass: false };


interface Deck {
  element: HTMLAudioElement;
  source: MediaElementAudioSourceNode | null;
  input: GainNode | null;
  gain: GainNode | null;
  limiter: DynamicsCompressorNode | null;
  makeup: GainNode | null;
  meter: AnalyserNode | null;
  /** The preset's rack as built (lib/audio/rack), in order. */
  units: BuiltUnit[];
  settings: SoundData;
  /** "version:12" or "render:43": which file the element is holding. */
  versionId: string | null;
}

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let bed: GainNode | null = null;
const decks: Partial<Record<Slot, Deck>> = {};
let peakBuffer: Float32Array<ArrayBuffer> | null = null;

export function context(): AudioContext | null {
  if (ctx) return ctx;
  const Ctor: typeof AudioContext | undefined =
    window.AudioContext || (window as any).webkitAudioContext;
  if (!Ctor) return null;
  ctx = new Ctor();
  applyOutput(ctx);               // the speakers or headphones chosen on the Vocals panel
  master = ctx.createGain();
  master.connect(ctx.destination);
  bed = ctx.createGain();
  bed.connect(master);
  return ctx;
}

export function deck(slot: Slot): Deck {
  const existing = decks[slot];
  if (existing) return existing;
  const element = new Audio();
  element.preload = "auto";
  element.crossOrigin = "anonymous";
  const made: Deck = {
    element, source: null, input: null, gain: null, limiter: null, makeup: null,
    meter: null, units: [], settings: { ...FLAT }, versionId: null,
  };
  decks[slot] = made;
  return made;
}

/* The limiter's numbers, applied to whichever pair of nodes. One definition, because the
 * offline pass that writes a file once built its compressor with the browser's defaults
 * (a 30 dB knee, 12:1) where the deck you listened through had 0 and 20:1, and the
 * exported file was audibly not the mix that was approved. */
function setLimiter(limiter: DynamicsCompressorNode, makeup: GainNode, settings: SoundData) {
  const lim = settings.limiter || { on: false };
  const on = !!lim.on && !settings.bypass;
  limiter.knee.value = 0;
  limiter.ratio.value = 20;
  limiter.threshold.value = on ? clamp(lim.threshold ?? 0, -60, 0) : 0;
  limiter.release.value = on ? clamp((lim.release || 120) / 1000, 0.001, 1) : 0.25;
  limiter.attack.value = on ? clamp((lim.attack || 5) / 1000, 0, 0.1) : 0.003;
  /* The makeup carries ceiling minus threshold, not the ceiling. A limiter holds its
   * output down to about the threshold, so bringing that back up to where the ceiling
   * line is drawn is the difference between the two. */
  const ceiling = on ? clamp(lim.ceiling ?? 0, -30, 0) : 0;
  const threshold = on ? clamp(lim.threshold ?? 0, -60, 0) : 0;
  const trim = settings.bypass ? 0 : (settings.gain || 0);
  makeup.gain.value = Math.pow(10, ((ceiling - threshold) + trim) / 20);
}
/* The fixed stage at the end of every deck predates the rack. The limiter and the output
 * gain are effects in the rack now (rackOf reads an old preset's into it), so this stage
 * is given nothing to do, or the old settings would be applied twice. */
const NEUTRAL = (s: SoundData): SoundData => ({ ...s, limiter: { on: false }, gain: 0 });

export interface Chain {
  input: GainNode;
  units: BuiltUnit[];
  limiter: DynamicsCompressorNode;
  makeup: GainNode;
  output: GainNode;
}

/* The chain, defined once. Both the deck you listen through and the offline pass that
 * writes a file are built from this, in whichever context they are given. Two copies of
 * a node order is the classic way an export quietly stops matching what you heard. */
function buildChain(audioCtx: BaseAudioContext, settings: SoundData | null | undefined,
                    into?: Pick<Deck, "input" | "limiter" | "makeup"> | null): Chain {
  const shape: SoundData = { ...FLAT, ...(settings || {}) };
  const input = into?.input || audioCtx.createGain();
  const units: BuiltUnit[] = shape.bypass ? []
    : rackOf(shape).filter((u) => u.on).map((u) => Object.assign(buildUnit(audioCtx, u, shape), { _id: u.id, kind: u.kind }));

  let node: AudioNode = input;
  for (const unit of units) { node.connect(unit.input); node = unit.output; }

  const limiter = into?.limiter || audioCtx.createDynamicsCompressor();
  const makeup = into?.makeup || audioCtx.createGain();
  node.connect(limiter);
  limiter.connect(makeup);
  setLimiter(limiter, makeup, NEUTRAL(shape));
  return { input, units, limiter, makeup, output: makeup };
}

function rebuild(slot: Slot) {
  const entry = decks[slot];
  if (!entry || !entry.input || !ctx) return;
  entry.units.forEach((u) => u.nodes.forEach((n) => { try { n.disconnect(); } catch { /* gone */ } }));
  try { entry.input.disconnect(); } catch { /* first build */ }
  entry.units = buildChain(ctx, entry.settings, entry).units;
}

/* A media element can only ever be handed to one source node, so this runs once per deck
 * and every later track just changes element.src. */
export function wire(slot: Slot): Deck {
  const audioCtx = context();
  const entry = deck(slot);
  if (!audioCtx || entry.source) return entry;

  entry.source = audioCtx.createMediaElementSource(entry.element);
  entry.input = audioCtx.createGain();
  entry.limiter = audioCtx.createDynamicsCompressor();
  entry.makeup = audioCtx.createGain();
  entry.gain = audioCtx.createGain();
  entry.gain.gain.value = 0;

  entry.limiter.attack.value = 0.003;
  entry.limiter.release.value = 0.12;
  entry.limiter.threshold.value = 0;

  entry.source.connect(entry.input);
  entry.makeup.connect(entry.gain);

  /* One meter per deck, fed before the deck's own gain. After the master it would move
   * with the volume knob, and after the A/B gain the silent deck (the one you want to
   * look at while deciding) would read nothing. */
  const meter = audioCtx.createAnalyser();
  meter.fftSize = 4096;
  meter.smoothingTimeConstant = 0.78;
  meter.minDecibels = -96;
  meter.maxDecibels = -6;
  entry.makeup.connect(meter);            // a branch, not a link in the chain
  entry.meter = meter;

  entry.gain.connect(bed!);
  rebuild(slot);
  return entry;
}

export const engine = {
  context,
  deck,
  wire,

  get ready() { return !!ctx; },

  /** Where anything else that plays with the song joins it: after both decks, before
   *  the speakers, so the volume knob turns it down with everything else. */
  output(): GainNode | null { context(); return master; },

  /** Where the render leaves the decks, before the voices join it. Whoever splices
   *  something in here puts the plain wire back when they are done. */
  bed(): { from: GainNode; to: GainNode } | null {
    context();
    return bed && master ? { from: bed, to: master } : null;
  },

  /** The head of one deck's chain. The compositor connects its scheduled clips here, so
   *  arranged playback goes through the same filters, limiter and gain as a plain one. */
  inputOf(slot: Slot): GainNode | null { return wire(slot).input; },

  /** Build a song's chain in any context, live or offline. The bouncer calls this with
   *  an OfflineAudioContext, which is what makes an exported file the sound you approved. */
  chainInto(audioCtx: BaseAudioContext, settings: SoundData | null): Chain {
    return buildChain(audioCtx, settings, null);
  },

  async resume(): Promise<AudioContext | null> {
    const audioCtx = context();
    if (audioCtx && audioCtx.state === "suspended") await audioCtx.resume();
    return audioCtx;
  },

  /** A few milliseconds of ramp: short enough to be inaudible, long enough that the
   *  gain step does not click. */
  setDeckGain(slot: Slot, value: number, seconds = 0.008) {
    const entry = decks[slot];
    if (!entry || !entry.gain || !ctx) return;
    const now = ctx.currentTime;
    entry.gain.gain.cancelScheduledValues(now);
    entry.gain.gain.setValueAtTime(entry.gain.gain.value, now);
    entry.gain.gain.linearRampToValueAtTime(value, now + seconds);
  },

  setVolume(value: number) {
    if (context() && master) master.gain.value = clamp(value, 0, 1);
  },

  /** Give one deck its sound. Called when a slot's preset changes and while a curve is
   *  being dragged, so it is cheap when only numbers moved: the chain is rewired only
   *  when the set of bands changes, and the audio never stops. */
  applyTo(slot: Slot, next: SoundData | null | undefined) {
    const entry = deck(slot);
    const before = shapeOf(entry.settings);
    entry.settings = { ...FLAT, ...(next || {}) };
    if (!ctx || !entry.input) return;
    if (before !== shapeOf(entry.settings)) { rebuild(slot); return; }
    // Same units in the same order: only numbers moved, so they go to the running nodes.
    const live = entry.settings.bypass ? [] : rackOf(entry.settings).filter((u) => u.on);
    live.forEach((u, i) => entry.units[i]?.set(u, entry.settings));
    if (entry.limiter && entry.makeup) setLimiter(entry.limiter, entry.makeup, NEUTRAL(entry.settings));
  },

  settingsOf(slot: Slot): SoundData { return decks[slot]?.settings || { ...FLAT }; },

  /** Magnitude in dB of an arbitrary set of bands at the given frequencies. The filters
   *  made here are never connected, so a curve can be drawn for a song that is not
   *  playing without disturbing the one that is. */
  responseOf(bands: Band[] | null | undefined, frequencies: Float32Array<ArrayBuffer>, bypass = false): Float32Array {
    const audioCtx = context();
    const out = new Float32Array(frequencies.length);
    if (!audioCtx || bypass) return out;
    const total = new Float32Array(frequencies.length).fill(1);
    const mag = new Float32Array(frequencies.length);
    const phase = new Float32Array(frequencies.length);
    const nyquist = audioCtx.sampleRate / 2;
    for (const band of bands || []) {
      if (!band.on) continue;
      const filter = audioCtx.createBiquadFilter();
      filter.type = band.type;
      filter.frequency.value = clamp(band.freq, 10, nyquist - 100);
      filter.Q.value = clamp(band.q, 0.05, 30);
      filter.gain.value = clamp(band.gain, -30, 30);
      filter.getFrequencyResponse(frequencies, mag, phase);
      for (let i = 0; i < total.length; i++) total[i] *= mag[i];
    }
    for (let i = 0; i < total.length; i++) out[i] = 20 * Math.log10(total[i] || 1e-6);
    return out;
  },

  /** How hard this deck's limiter is pulling down, in dB. */
  reductionOf(slot: Slot): number {
    const entry = decks[slot];
    // The last limiter in the rack is the one holding the ceiling; failing that, the last
    // compressor; failing that, the fixed stage (which is neutral now).
    const units = (entry?.units || []) as (BuiltUnit & { kind?: string })[];
    const unit = [...units].reverse().find((u) => u.kind === "limiter" && u.reduction)
      ?? [...units].reverse().find((u) => u.reduction);
    if (unit?.reduction) return unit.reduction();
    return entry?.limiter ? Math.abs(entry.limiter.reduction || 0) : 0;
  },

  analyserOf(slot: Slot = "A"): AnalyserNode | null { return decks[slot]?.meter || null; },

  spectrum(target: Uint8Array<ArrayBuffer>, slot: Slot = "A"): Uint8Array | null {
    const meter = this.analyserOf(slot);
    if (!meter) return null;
    meter.getByteFrequencyData(target);
    return target;
  },

  /** Peak level in dB, for the limiter's meter. From float samples, not bytes: bytes
   *  saturate at exactly full scale, so the one event a peak meter exists to catch is
   *  the one it could not display. */
  peakDb(slot: Slot = "A"): number {
    const meter = this.analyserOf(slot);
    if (!meter) return -60;
    if (!peakBuffer || peakBuffer.length !== meter.fftSize) peakBuffer = new Float32Array(meter.fftSize);
    meter.getFloatTimeDomainData(peakBuffer);
    let peak = 0;
    for (let i = 0; i < peakBuffer.length; i++) {
      const sample = peakBuffer[i] < 0 ? -peakBuffer[i] : peakBuffer[i];
      if (sample > peak) peak = sample;
    }
    return peak > 0.0002 ? 20 * Math.log10(peak) : -60;
  },
};
