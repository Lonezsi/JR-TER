/* What the timeline does to an arrangement, and how it is taken back.
 *
 * lib/audio/arrange is the model: it holds the clips, schedules them and saves them. This
 * is the layer of actions on top that a screen needs and the model does not: an undo for
 * edits (the old compositor had none, and "remove" with no way back is exactly the kind of
 * destructive thing that should be done at once with an Undo toast), laying the song out,
 * flipping "play as arranged" while something is playing, and getting the player to a place
 * on the timeline from a click.
 */
import { arrange, state as A, type Clip, type Part, type Laid } from "$lib/audio/arrange.svelte";
import { player, toggle, seekTo, now } from "$lib/player.svelte";
import { engine, SLOTS } from "$lib/audio/engine";
import { attempt } from "$lib/api";
import { toast } from "$lib/toast.svelte";
import { prompt } from "$lib/dialog.svelte";
import { UNSURE, type BeatRead } from "$lib/audio/beats";
import type { SongStore } from "../song.svelte";

// ── undo ─────────────────────────────────────────────────────────────────────

interface Snap { clips: Clip[]; parts: Part[]; bpm: number; offset: number; selected: string | null }

let stack: Snap[] = [];
let owner: number | null = null;
const depth = $state({ n: 0 });

const snapshot = (): Snap => JSON.parse(JSON.stringify({
  clips: A.clips, parts: A.parts, bpm: A.bpm, offset: A.offset, selected: A.selected,
}));

export const history = {
  get canUndo() { return depth.n > 0 && owner === A.songId; },
  /** Call before a change, once per gesture. */
  mark() {
    if (owner !== A.songId) { stack = []; owner = A.songId; }
    stack.push(snapshot());
    if (stack.length > 60) stack.shift();
    depth.n = stack.length;
  },
  undo(): boolean {
    if (owner !== A.songId) return false;
    const back = stack.pop();
    depth.n = stack.length;
    if (!back) return false;
    A.clips = back.clips;
    A.parts = back.parts;
    A.bpm = back.bpm;
    A.offset = back.offset;
    arrange.select(back.selected);
    arrange.touch();
    arrange.resync();
    return true;
  },
};

// ── where things are on the axis ─────────────────────────────────────────────

/** One block of the strip, in seconds on whichever axis is being shown. */
export interface Row {
  key: string;
  clipId: string | null;
  partId: string | null;
  name: string;
  hue: number;
  at: number;
  seconds: number;
  beats: number;
}

/** The sections as they are heard when arranged (one per clip, back to back), or as they
 *  sit in the render when not (one per part, where the music actually is). */
export function rowsOf(arranged: boolean): Row[] {
  if (arranged) {
    return arrange.laid().map((r: Laid) => ({
      key: r.clip.id, clipId: r.clip.id, partId: r.part?.id ?? null,
      name: r.part?.name ?? "clip", hue: r.part?.hue ?? 210,
      at: r.at, seconds: r.seconds, beats: r.clip.beats,
    }));
  }
  const beat = arrange.beatSeconds();
  return A.parts.map((p) => ({
    key: "p:" + p.id, clipId: A.clips.find((c) => c.part === p.id)?.id ?? null, partId: p.id,
    name: p.name, hue: p.hue,
    at: A.offset + p.from * beat, seconds: p.beats * beat, beats: p.beats,
  }));
}

/** Where a place in the render is on the arranged timeline, and the other way round: so
 *  flipping the switch mid song keeps you roughly where you were. */
function mapPosition(seconds: number, toArranged: boolean): number {
  if (toArranged) {
    const row = arrange.laid().find((r) => seconds >= r.sourceAt && seconds < r.sourceAt + r.seconds);
    return row ? row.at + (seconds - row.sourceAt) : 0;
  }
  const row = arrange.at(seconds);
  return row ? row.sourceAt + (seconds - row.at) : 0;
}

// ── the player, from a place on the timeline ─────────────────────────────────

async function holding(song: SongStore) {
  if (!song.here || !player.duration) {
    await song.play();
    // The length arrives a moment after the press; a seek before it is ignored.
    for (let i = 0; i < 60 && !player.duration; i++) await new Promise((r) => setTimeout(r, 60));
  }
}

/** Go to a place. Playing is not started if it is not already: a seek is a seek. From a
 *  song that is not on the player it is a press of play, because there is nothing to seek. */
export async function seekAt(song: SongStore, seconds: number) {
  if (!song.here || !player.duration) {
    await holding(song);
    seekTo(seconds);
    return;
  }
  seekTo(seconds);
}

/** Go to a place and make sure it is playing. */
export async function playFrom(song: SongStore, seconds: number) {
  await holding(song);
  seekTo(seconds);
  if (!player.playing) await toggle();
}

// ── switching it on ──────────────────────────────────────────────────────────

/** The "play as arranged" switch.
 *
 * While something is playing the audio is either on the two elements or on scheduled
 * clips, and the one cannot be turned into the other in place: it is paused, switched, and
 * started again from the equivalent place. Not playing, nothing is touched but the flag. */
export async function setArranged(song: SongStore, on: boolean) {
  if (on && !A.clips.length) {
    toast("Lay the song out first so there's something to play.", "bad");
    return;
  }
  if (!on && !A.enabled) return;
  const here = song.here;
  const playing = here && player.playing;
  const from = here ? now() : 0;
  const to = here ? mapPosition(from, on) : 0;
  if (playing) await toggle();
  await arrange.setEnabled(on);
  if (here) {
    if (on) {
      arrange.seek(to);
    } else {
      for (const slot of SLOTS) {
        const audio = engine.deck(slot).element;
        try { audio.currentTime = to; } catch { /* not seekable yet */ }
      }
    }
    player.position = to;
    if (playing) await toggle();
  }
  toast(on ? "Playing as arranged. A and B now compare sounds." : "Back to the render as it was rendered.");
}

// ── laying out ───────────────────────────────────────────────────────────────

/* Work out the tempo and the sections, and lay the song out as it already is.
 *
 * A fresh layout is every section in order, untrimmed and unmoved: it sounds exactly like
 * the render it came from. So switching it on changes nothing you can hear, which means
 * there is no reason to make anyone do it as a separate act, and the next edit is audible
 * the moment it is made. */
export async function layOut(song: SongStore, progress?: (fraction: number) => void): Promise<BeatRead | null> {
  const version = song.current;
  if (!version) { toast("There is no render to listen to yet.", "bad"); return null; }
  const wasEmpty = !A.clips.length;
  if (!wasEmpty) history.mark();
  const read = await attempt(async () => {
    await arrange.buffer(version, progress);
    return arrange.detect(version);
  });
  if (!read) return null;
  if (read.silent) {
    toast("That render is silent. The project bounced to nothing, so there is no beat to find.", "bad");
    return read;
  }
  if (wasEmpty && !A.enabled) await setArranged(song, true);
  toast(`${Math.round(read.bpm)} bpm, ${read.parts.length} section${read.parts.length === 1 ? "" : "s"}. `
    + (read.confidence < UNSURE ? "The beat was hard to hear, so check the tempo." : "Drag an edge to trim, double click to repeat."));
  return read;
}

/** Every section once, in order, untrimmed: what detection first produced. */
export function resetToRecorded() {
  if (!A.parts.length) { toast("There is nothing to go back to: the song has not been laid out.", "bad"); return; }
  history.mark();
  A.clips = A.parts.map((part, i) => ({ id: "c" + (i + 1), part: part.id, from: part.from, beats: part.beats }));
  A.selected = null;
  arrange.touch();
  arrange.resync();
  toast("Back to the song as it was recorded.", "", { label: "Undo", run: () => { history.undo(); } });
}

// ── editing ──────────────────────────────────────────────────────────────────

export function removeClip(id: string) {
  if (!A.clips.some((c) => c.id === id)) return;
  history.mark();
  arrange.remove(id);
  toast("Section taken out.", "", { label: "Undo", run: () => { history.undo(); } });
}

export function duplicateClip(id: string): Clip | null {
  history.mark();
  const copy = arrange.duplicate(id);
  if (copy) { arrange.select(copy.id); toast("Duplicated. Trim it to make it shorter."); }
  return copy;
}

export function resizeClip(id: string, edge: "start" | "end", beats: number) {
  history.mark();
  arrange.resize(id, edge, beats);
}

export function moveClip(id: string, toIndex: number) {
  history.mark();
  arrange.move(id, toIndex);
}

export async function renameSection(partId: string | null) {
  const part = partId ? A.parts.find((p) => p.id === partId) : null;
  if (!part) return;
  const name = await prompt({ title: "Name this section", value: part.name, confirm: "Rename", maxlength: 60 });
  if (name) { history.mark(); arrange.renamePart(part.id, name); }
}

export function setTempo(bpm: number) {
  if (!Number.isFinite(bpm) || Math.abs(bpm - A.bpm) < 0.001) return;
  history.mark();
  arrange.setTempo(bpm);
}

export function setOffset(seconds: number) {
  if (!Number.isFinite(seconds) || Math.abs(seconds - A.offset) < 0.0005) return;
  history.mark();
  arrange.setOffset(seconds);
}

/** "Halve it, to 3 bars": the length you will actually get, in the unit that is true. */
export function lengthWords(beats: number): string {
  const bars = beats / A.perBar;
  if (Number.isInteger(bars)) return `${bars} bar${bars === 1 ? "" : "s"}`;
  return `${beats} beat${beats === 1 ? "" : "s"}`;
}

/** A set of words, as the lyric routes return it. */
export interface Sheet { id: number; name?: string; text?: string; is_current?: number | boolean }

/** What a card is called: its name, or failing that the first line of its words. */
export function sheetTitle(sheet: Sheet): string {
  const name = (sheet.name || "").trim();
  if (name) return name;
  const first = (sheet.text || "").split("\n").find((l) => l.trim());
  return first ? first.trim().slice(0, 40) : "Untitled words";
}
