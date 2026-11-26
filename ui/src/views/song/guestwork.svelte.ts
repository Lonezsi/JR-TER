/* What the people a song is shared with have made on it, and what they changed on it.
 * Loaded once for the screen; the A/B menu offers everybody's mixes and sounds next to
 * yours, and the Release tab lists them. */
import { get, post, attempt } from "$lib/api";
import { emit } from "$lib/bus";
import type { Preset, Version } from "$lib/types";

export interface GuestPerson {
  share: number | string; name?: string; handle?: string; made_anything?: boolean;
  changes?: number; updated_at?: number;
  artwork: { id: number; caption?: string }[];
  versions: { id: number; n?: number; filename?: string; duration?: number }[];
  sheets: { id?: number; name?: string; text: string }[];
  presets: { id: number; name: string; data: { bands?: unknown[] } }[];
}
export interface GuestEdit {
  id: number; name?: string; handle?: string; what: string; updated_at: number; undone_at?: number | null;
}

export class GuestWork {
  people = $state<GuestPerson[]>([]);
  edits = $state<GuestEdit[]>([]);
  loaded = $state(false);
  constructor(private songId: string) {}

  async load() {
    const [who, edits] = await Promise.all([
      get(`/api/songs/${this.songId}/guests`).catch(() => ({ people: [] })),
      get(`/api/songs/${this.songId}/edits`).catch(() => ({ edits: [] })),
    ]);
    this.people = who.people || [];
    this.edits = edits.edits || [];
    this.loaded = true;
  }

  /** Somebody's mix, shaped as a take the player can put in a slot. */
  versionOf(p: GuestPerson, v: GuestPerson["versions"][number]): Version {
    return { ...v, id: `g${p.share}:${v.id}`, kind: "version", abLabel: p.name || p.handle,
      url: `/api/guestwork/${p.share}/audio/${v.id}` } as Version;
  }
  presetOf(p: GuestPerson, s: GuestPerson["presets"][number]): Preset {
    return { ...s, id: `g${p.share}:${s.id}` as unknown as number, name: `${s.name} (${p.name || p.handle})` } as unknown as Preset;
  }

  async undo(edit: GuestEdit, after: () => Promise<void>) {
    const done = await attempt(() => post(`/api/guest-edits/${edit.id}/undo`), "Put back");
    if (!done) return;
    await Promise.all([this.load(), after()]);
    emit("lyrics:changed", { songId: Number(this.songId) });
    emit("artwork:changed", { songId: Number(this.songId) });
    emit("sound:changed", { songId: Number(this.songId) });
  }
}
