/* What is pinned to the top of the sidebar: songs, albums, playlists and renders, mixed, in
 * the order they were pinned. Saved with the account (settings.pinned), so it is the same
 * on every device.
 *
 *   pins()                 the list
 *   isPinned(kind, id)
 *   togglePin(kind, id)
 *   pinItem(kind, id)      the "Pin to sidebar" / "Unpin" entry for a context menu
 */
import { app, saveSettings } from "./app.svelte";
import { toast } from "./toast.svelte";
import type { MenuItem } from "./menu.svelte";

export type PinKind = "song" | "album" | "playlist" | "render";
export interface Pin { kind: PinKind; id: number }

export const pins = (): Pin[] => ((app.settings as unknown as { pinned?: Pin[] }).pinned || []);
export const isPinned = (kind: PinKind, id: number) => pins().some((p) => p.kind === kind && p.id === id);

export async function togglePin(kind: PinKind, id: number) {
  const on = isPinned(kind, id);
  const next = on ? pins().filter((p) => !(p.kind === kind && p.id === id)) : [...pins(), { kind, id }];
  (app.settings as unknown as { pinned: Pin[] }).pinned = next;      // at once; the save follows
  try { await saveSettings({ pinned: next } as never); } catch { toast("Couldn't save that pin."); }
}

export const pinItem = (kind: PinKind, id: number): MenuItem => ({
  label: isPinned(kind, id) ? "Unpin from the sidebar" : "Pin to the sidebar", icon: "pin",
  run: () => togglePin(kind, id),
});
