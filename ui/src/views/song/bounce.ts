/* Writing out what you have been listening to.
 *
 * Playback only ever applies the equaliser, limiter and arrangement live; the stored render
 * is never touched. This is the one place that deliberately produces a new file, because
 * sending a mix somewhere means sending a file, and a file without the curve on it is not
 * the mix you approved. The chain is not rebuilt here: engine.chainInto builds it in
 * whichever context it is given, so the deck you listened through and the pass that writes
 * the file are the same node order by construction. It runs faster than real time.
 */
import { u } from "$lib/api";
import { engine } from "$lib/audio/engine";
import type { Preset, Version } from "$lib/types";

/* A little headroom past the last clip: a limiter's release is up to a second, and cutting
 * at the last sample of the last clip clips the decay of whatever was still ringing. */
const TAIL = 1.5;

export interface Clip { id?: string; from: number; beats: number; part?: string }
export interface Arrangement { bpm: number; offset: number; clips: Clip[]; enabled?: number | boolean }

/** Where each clip sits on the timeline, in seconds. Computed rather than stored, so a
 *  tempo correction moves everything at once. */
export function laid(a: Arrangement) {
  const beat = 60 / (a.bpm || 120);
  let at = 0;
  return a.clips.map((clip) => {
    const row = { at, seconds: clip.beats * beat, sourceAt: (a.offset || 0) + clip.from * beat };
    at += row.seconds;
    return row;
  });
}
export const arrangedLength = (a: Arrangement) => a.clips.reduce((n, c) => n + c.beats, 0) * (60 / (a.bpm || 120));

async function decode(version: Version): Promise<AudioBuffer> {
  const response = await fetch(u(`/api/versions/${version.id}/audio`));
  if (!response.ok) throw new Error("That render could not be read back.");
  const bytes = await response.arrayBuffer();
  const ctx = engine.context() || new AudioContext();
  const decoded = await ctx.decodeAudioData(bytes);
  if (!decoded || !decoded.length) throw new Error("That render decoded to nothing.");
  return decoded;
}

export async function render(version: Version, preset: Preset | null, arrangement: Arrangement | null,
                             say: (what: string, at: number) => void): Promise<AudioBuffer> {
  say("reading the render", 0.05);
  const source = await decode(version);
  const rows = arrangement && arrangement.clips.length ? laid(arrangement) : null;
  const seconds = (rows && arrangement ? arrangedLength(arrangement) : source.duration) + TAIL;
  say("laying it out", 0.2);
  const offline = new OfflineAudioContext(Math.min(2, source.numberOfChannels) || 1,
    Math.ceil(seconds * source.sampleRate), source.sampleRate);
  const chain = engine.chainInto(offline, preset ? preset.data : null);
  chain.output.connect(offline.destination);
  const play = (at: number, from: number, length: number) => {
    const node = offline.createBufferSource();
    node.buffer = source;
    node.connect(chain.input);
    node.start(at, from, length);
  };
  if (rows) {
    for (const row of rows) {
      const playable = Math.min(row.seconds, Math.max(0, source.duration - row.sourceAt));
      if (playable > 0.001) play(row.at, row.sourceAt, playable);
    }
  } else play(0, 0, source.duration);
  say("rendering", 0.35);
  const done = await offline.startRendering();
  say("done", 1);
  return done;
}

/* A WAV, written by hand. Sixteen bit because that is what everything downstream expects
 * and it halves the size of a file about to be uploaded. No dither: this is a delivery copy
 * of something already mastered, and a dither nobody asked for is a change to the sound. */
export function toWav(buffer: AudioBuffer): Blob {
  const channels = Math.min(2, buffer.numberOfChannels);
  const frames = buffer.length;
  const rate = buffer.sampleRate;
  const bytes = new ArrayBuffer(44 + frames * channels * 2);
  const view = new DataView(bytes);
  const text = (at: number, value: string) => { for (let i = 0; i < value.length; i++) view.setUint8(at + i, value.charCodeAt(i)); };
  text(0, "RIFF"); view.setUint32(4, 36 + frames * channels * 2, true);
  text(8, "WAVE"); text(12, "fmt ");
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, channels, true);
  view.setUint32(24, rate, true); view.setUint32(28, rate * channels * 2, true);
  view.setUint16(32, channels * 2, true); view.setUint16(34, 16, true);
  text(36, "data"); view.setUint32(40, frames * channels * 2, true);
  const lanes: Float32Array[] = [];
  for (let c = 0; c < channels; c++) lanes.push(buffer.getChannelData(c));
  let at = 44;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < channels; c++) {
      // Clamped: past full scale would wrap round to the opposite polarity.
      const s = Math.max(-1, Math.min(1, lanes[c][i]));
      view.setInt16(at, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      at += 2;
    }
  }
  return new Blob([view], { type: "audio/wav" });
}

/** The loudest sample, in dB, so the form can say whether it clipped. */
export function peakOf(buffer: AudioBuffer): number {
  let peak = 0;
  for (let c = 0; c < Math.min(2, buffer.numberOfChannels); c++) {
    const lane = buffer.getChannelData(c);
    for (let i = 0; i < lane.length; i += 7) { const v = Math.abs(lane[i]); if (v > peak) peak = v; }
  }
  return peak > 0 ? 20 * Math.log10(peak) : -Infinity;
}
