/* Export what you hear: the current preset through the arrangement, as a WAV.
 *
 * Playback only ever applies the equaliser, the limiter and the arrangement live; the
 * render on disk is never rewritten. This writes a new file on the browser's side and
 * hands it over as a download, which is how a mix goes somewhere else.
 */
import { arrange } from "$lib/audio/arrange.svelte";
import { plan, render, toWav, peakOf, type BounceContext } from "$lib/audio/bounce";
import { toast } from "$lib/toast.svelte";
import type { SongStore } from "../song.svelte";

export interface Plan {
  arranged: boolean;
  seconds: number;
  bands: number;
  limiter: boolean;
  presetName: string;
}

function contextFor(song: SongStore): BounceContext {
  const A = arrange.state;
  const arranged = A.enabled && A.songId === Number(song.id) && A.clips.length > 0;
  // An arranged export cuts the render the arrangement was built from, not whichever take
  // happens to be in A: the clips are beats of that file.
  const built = arranged && A.versionId != null
    ? song.versions.find((v) => String(v.id) === String(A.versionId)) : null;
  const version = built || song.versionOf("A") || song.current;
  return { songId: Number(song.id), currentVersion: () => version, presets: song.presets };
}

/** What would be written, for a tooltip, so nobody presses Export to find out. */
export function describe(song: SongStore): Plan {
  const ctx = contextFor(song);
  const p = plan(ctx);
  const preset = song.presetOf(song.selected) || p.preset;
  const live = preset && !preset.data.bypass;
  return {
    arranged: p.arranged,
    seconds: p.seconds,
    bands: live ? (preset!.data.bands || []).filter((b) => b.on).length : 0,
    limiter: !!(live && preset!.data.limiter?.on),
    presetName: preset ? preset.name : "no equaliser",
  };
}

const safe = (name: string) => name.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim() || "song";

export async function exportMix(song: SongStore, say: (what: string, fraction: number) => void): Promise<boolean> {
  const ctx = contextFor(song);
  const p = plan(ctx);
  const preset = song.presetOf(song.selected) || p.preset || null;
  const buffer = await render(ctx, { preset, arranged: p.arranged, onProgress: say });
  say("writing the file", 0.97);
  const blob = toWav(buffer);
  const peak = peakOf(buffer);
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${safe(song.song?.title || "song")}${p.arranged ? " (arranged)" : ""}.wav`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  if (peak > -0.1) toast("Exported, but it hits full scale and might clip.");
  else toast(`Exported${p.arranged ? " as arranged" : ""}.`);
  return true;
}
