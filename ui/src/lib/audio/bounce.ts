/* Writing out what you have been listening to.
 *
 * PUBLIC API
 *   plan(ctx)                  what would be written, before anything is rendered
 *   render(ctx, {preset, arranged, onProgress})  → AudioBuffer, with everything applied
 *   toWav(buffer)              16 bit WAV Blob (max two channels)
 *   peakOf(buffer)             loudest sample in dB, -Infinity for silence
 *   TAIL                       seconds of headroom added past the last clip
 *   bounce                     the same as one object
 *
 * Everything else in this app is playback only: the equaliser, the limiter and the
 * arrangement are applied while the browser plays and the stored render is never
 * touched. This is the one place that deliberately produces a new file, because sending
 * a mix somewhere means sending a file, and a file without the curve on it is not the mix
 * you approved.
 *
 * The chain is not rebuilt here. engine.chainInto builds it in whichever context it is
 * given, so the deck you listened through and the pass that writes the file are the same
 * node order by construction. Two copies would drift, and no test can compare a graph in
 * one file against a graph in another: the only defence is that there is one.
 *
 * It renders faster than real time (an OfflineAudioContext), so a four minute song is a
 * few seconds.
 */
import { engine } from "./engine";
import { arrange } from "./arrange.svelte";
import { encodeWav } from "./wav";
import { u } from "../api";
import type { Preset, Version } from "../types";

/** What the bounce needs to know about the song it is working on. */
export interface BounceContext {
  songId: number;
  currentVersion(): Version | null | undefined;
  presets?: Preset[];
}

export interface BouncePlan {
  version: Version | null | undefined;
  arranged: boolean;
  preset: Preset | undefined;
  bands: number;
  limiter: boolean;
  seconds: number;
}

/* A little headroom past the last clip. A limiter's release is up to a second, and a
 * reverb tail lives in the render rather than in the chain, so cutting at the last sample
 * of the last clip clips the decay of whatever was still ringing. */
export const TAIL = 1.5;

const isArranged = (songId: number) =>
  !!(arrange.state.enabled && arrange.state.songId === songId && arrange.state.clips.length);

/** What would be written, described before anything is rendered, so nobody has to press
 *  Render to find out what Render is going to do. */
export function plan(ctx: BounceContext): BouncePlan {
  const version = ctx.currentVersion();
  const arranged = isArranged(ctx.songId);
  const preset = (ctx.presets || []).find((p) => p.is_current) || (ctx.presets || [])[0];
  const bands = preset ? (preset.data.bands || []).filter((b) => b.on).length : 0;
  const limiter = !!(preset && (preset.data.limiter || {}).on && !preset.data.bypass);
  return {
    version,
    arranged,
    preset,
    bands: preset && preset.data.bypass ? 0 : bands,
    limiter,
    seconds: arranged ? arrange.duration() : (version ? version.duration || 0 : 0),
  };
}

/* The decoded audio for a version. Fetched and decoded here rather than borrowed from the
 * compositor's cache: reaching into another module's decoded copy saves a few seconds and
 * couples this to the exact shape of that cache. A file this is about to upload is worth
 * reading twice. */
async function sourceBuffer(version: Version): Promise<AudioBuffer> {
  const response = await fetch(u(`/api/versions/${version.id}/audio`));
  if (!response.ok) throw new Error("That render could not be read back.");
  const bytes = await response.arrayBuffer();
  const audioCtx = engine.context();
  if (!audioCtx) throw new Error("This browser cannot play audio.");
  const decoded = await audioCtx.decodeAudioData(bytes);
  if (!decoded || !decoded.length) throw new Error("That render decoded to nothing.");
  return decoded;
}

/** The audio, with everything applied. */
export async function render(ctx: BounceContext, options: {
  preset?: Preset | null;
  arranged?: boolean;
  onProgress?: (what: string, fraction: number) => void;
} = {}): Promise<AudioBuffer> {
  const say = options.onProgress || (() => {});
  const version = ctx.currentVersion();
  if (!version) throw new Error("This song has no render to work from.");

  say("reading the render", 0.05);
  const source = await sourceBuffer(version);

  const useArrangement = !!options.arranged && isArranged(ctx.songId);
  const rows = useArrangement ? arrange.laid() : null;
  const seconds = (useArrangement ? arrange.duration() : source.duration) + TAIL;

  say("laying it out", 0.2);
  const offline = new OfflineAudioContext(
    Math.min(2, source.numberOfChannels) || 1,
    Math.ceil(seconds * source.sampleRate),
    source.sampleRate);

  const chain = engine.chainInto(offline, options.preset ? options.preset.data : null);
  chain.output.connect(offline.destination);

  if (rows) {
    // The same rows the player schedules, so an arranged export is the arrangement
    // rather than a second reading of the same clips.
    for (const row of rows) {
      const playable = Math.min(row.seconds, Math.max(0, source.duration - row.sourceAt));
      if (playable <= 0.001) continue;
      const node = offline.createBufferSource();
      node.buffer = source;
      node.connect(chain.input);
      node.start(row.at, row.sourceAt, playable);
    }
  } else {
    const node = offline.createBufferSource();
    node.buffer = source;
    node.connect(chain.input);
    node.start(0);
  }

  say("rendering", 0.35);
  const done = await offline.startRendering();
  say("done", 1);
  return done;
}

/** A 16 bit WAV, undithered on purpose: a delivery copy of something already mastered
 *  is not a mix step, and a dither nobody asked for changes the sound behind their back. */
export const toWav = (buffer: AudioBuffer): Blob => encodeWav(buffer, 2);

/** The loudest sample in the result, so the form can say whether it clipped. */
export function peakOf(buffer: AudioBuffer): number {
  let peak = 0;
  for (let c = 0; c < Math.min(2, buffer.numberOfChannels); c++) {
    const lane = buffer.getChannelData(c);
    for (let i = 0; i < lane.length; i += 7) {
      const value = lane[i] < 0 ? -lane[i] : lane[i];
      if (value > peak) peak = value;
    }
  }
  return peak > 0 ? 20 * Math.log10(peak) : -Infinity;
}

export const bounce = { plan, render, toWav, peakOf, TAIL };
