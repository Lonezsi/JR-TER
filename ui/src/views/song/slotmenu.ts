/* One menu holding both things a slot carries: which render, and which sound. */
import { showMenu, type MenuItem } from "$lib/menu.svelte";
import { time } from "$lib/util";
import type { Slot } from "$lib/audio/engine";
import type { Version } from "$lib/types";
import type { SongStore } from "./song.svelte";
import type { GuestWork } from "./guestwork.svelte";
import type { Uploader } from "./uploads.svelte";
import { has } from "$lib/app.svelte";
import { takeFromInbox } from "./actions";
import { troubleOf, versionName, versionSub } from "./helpers";

/** Choosing a take is asking to hear it, so it starts the song if nothing is on. Choosing
 *  a sound is not: the chip says which deck carries it, and play plays it. */
export async function chooseTake(song: SongStore, slot: Slot, version: Version) {
  await song.setVersion(slot, version);
  if (!song.here) await song.play();
  if (slot === "B") await song.select("B");
}

export function slotItems(song: SongStore, slot: Slot, guestwork: GuestWork | null, uploader: Uploader): MenuItem[] {
  const held = song.versionOf(slot);
  const preset = song.presetOf(slot);
  const guests = (guestwork?.people || []).filter((p) => p.versions.length || p.presets.length);
  return [
    { group: "Renders" },
    ...song.versions.map((v): MenuItem => {
      const bad = troubleOf(v);
      return {
        label: `${versionName(v)}  ${versionSub(v)}${bad ? ` (${bad.short})` : ""}`.trim(),
        hint: v.duration ? time(v.duration) : "",
        checked: held?.id === v.id,
        run: () => chooseTake(song, slot, v),
      };
    }),
    song.has("versions") && !song.guest ? { label: "Upload a render", icon: "upload", run: () => uploader.pick() } : null,
    song.has("versions") && !song.guest && has("renders") ? { label: "Take one from the inbox", icon: "inbox", run: () => takeFromInbox(song) } : null,
    song.presets.length ? { divider: true } : null,
    song.presets.length ? { group: "Sound" } : null,
    ...song.presets.map((p): MenuItem => ({
      label: p.name, hint: (p.data.bands || []).length ? `${p.data.bands.length} bands` : "flat",
      checked: preset?.id === p.id, run: () => song.setPreset(slot, p),
    })),
    ...(guestwork ? guests.flatMap((p): MenuItem[] => [
      { divider: true },
      { group: p.name || p.handle || "Guest" },
      ...p.versions.map((v): MenuItem => {
        const gv = guestwork.versionOf(p, v);
        return { label: `mix  ${v.filename || "v" + v.n}`, hint: v.duration ? time(v.duration) : "",
          checked: held?.id === gv.id, run: () => chooseTake(song, slot, gv) };
      }),
      ...p.presets.map((s): MenuItem => {
        const gp = guestwork.presetOf(p, s);
        return { label: s.name, hint: "sound", checked: preset?.id === gp.id, run: () => song.setPreset(slot, gp) };
      }),
    ]) : []),
    slot === "B" && held ? { divider: true } : null,
    slot === "B" && held ? { label: "Take B out", icon: "close", run: () => song.setVersion("B", null) } : null,
  ];
}

export function openSlot(song: SongStore, slot: Slot, anchor: Element, guestwork: GuestWork | null, uploader: Uploader) {
  showMenu(slotItems(song, slot, guestwork, uploader), { anchor });
}
