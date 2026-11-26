/* One song, as the song screen and everything on it sees it.
 *
 * The screen makes one of these and puts it in context; every tab and panel reads it
 * with `useSong()`. It owns what the server said about the song (the song, its renders,
 * artwork, former titles, albums, presets), and the page's own choice of A and B.
 *
 * A AND B ARE A PROPERTY OF THE PAGE, NOT OF PLAYBACK. On a song at rest you can still
 * choose which take and which sound go in each slot; pressing play hands that choice to
 * the player. While the player is holding this song, the page and the player are the
 * same thing and `deck*` reads and writes go straight through to it.
 */
import { getContext, setContext } from "svelte";
import { get, post, u, attempt, guest, upload } from "$lib/api";
import { has as appHas } from "$lib/app.svelte";
import { emit } from "$lib/bus";
import { player, play, setSlot, switchTo, prime, toggle } from "$lib/player.svelte";
import { SLOTS, type Slot } from "$lib/audio/engine";
import type { Album, Preset, Song, Version } from "$lib/types";

export interface Artwork { id: number; position?: number; [key: string]: unknown }
export interface FormerTitle { title: string; changed_at?: number; [key: string]: unknown }

/** Modules a guest never sees on somebody else's song, whatever is switched on. */
const NOT_FOR_GUESTS = ["albums", "playlists", "youtube", "sharing"];

export class SongStore {
  readonly id: string;
  /** The share this song is being worked on through, when it is somebody else's. */
  readonly share: string | null;

  song = $state<Song | null>(null);
  versions = $state<Version[]>([]);
  artwork = $state<Artwork[]>([]);
  albums = $state<Album[]>([]);
  previous = $state<FormerTitle[]>([]);
  presets = $state<Preset[]>([]);
  loading = $state(true);
  error = $state("");

  /** The page's own A and B, used while the player is somewhere else. */
  private page = $state({
    selected: "A" as Slot,
    version: { A: null, B: null } as Record<Slot, Version | null>,
    preset: { A: null, B: null } as Record<Slot, Preset | null>,
  });

  constructor(id: string, share: string | null = null) {
    this.id = id;
    this.share = share;
  }

  get guest() { return !!this.share; }

  /** Is a module on, for this song and this person. */
  has = (name: string) => appHas(name) && !(this.guest && NOT_FOR_GUESTS.includes(name));

  /** The render the song plays by default. */
  get current(): Version | null {
    return this.versions.find((v) => v.id === (this.song as any)?.current_version_id) || this.versions[0] || null;
  }
  /** The first picture, at the address this viewer can fetch it from. */
  get cover(): string | null {
    return this.artwork.length ? u(`/api/artwork/${this.artwork[0].id}/image`) : null;
  }
  /** Is the player holding this song right now. */
  get here(): boolean {
    // The same number under another share (or none) is a different song.
    return !!player.song && String(player.song.id) === this.id && (player.share ?? null) === (this.share ?? null);
  }
  get playing(): boolean { return this.here && player.playing; }
  get defaultPreset(): Preset | null {
    return this.presets.find((p) => p.is_current) || this.presets[0] || null;
  }

  // ── A and B ────────────────────────────────────────────────────────────────

  /** Which slot the page is on: the one you hear, and the one the Sound tab edits. */
  get selected(): Slot { return this.here ? player.active : this.page.selected; }

  versionOf(slot: Slot): Version | null {
    if (this.here) return player.slots[slot].version;
    return slot === "A" ? (this.page.version.A || this.current) : this.page.version.B;
  }

  presetOf(slot: Slot): Preset | null {
    if (this.here && player.slots[slot].preset) return player.slots[slot].preset;
    return this.page.preset[slot] || (slot === "A" || this.page.version.B ? this.defaultPreset : null);
  }

  /** Is there a second take to compare against. */
  get comparing(): boolean { return !!this.versionOf("B"); }

  async select(slot: Slot) {
    this.page.selected = slot;
    if (this.here && player.slots[slot].version && player.active !== slot) await switchTo(slot);
  }

  /* Put a preset on one of the page's decks. The page copy is written first and the
   * player second: a drag calls this on every pointer move, and nothing is touched when
   * the player is on another song, whose decks this song's sound has no business on. */
  async setPreset(slot: Slot, preset: Preset | null) {
    this.page.preset[slot] = preset;
    if (this.here) await setSlot(slot, { preset });
  }

  /** Put a take in a slot, or empty it (B only: A always holds something). */
  async setVersion(slot: Slot, version: Version | null) {
    if (slot === "A" && !version) return;
    this.page.version[slot] = version;
    if (!version && slot === "B") this.page.preset.B = null;
    if (this.here) {
      await setSlot(slot, { version });
      if (version) await this.forkIfShared(slot);
    } else if (!version && this.page.selected === "B") {
      this.page.selected = "A";
    }
  }

  /* B is not a comparison until it has a sound of its own. Hearing one take through two
   * identical equalisers is not one, and the only way to get a real one used to be
   * knowing to make a second preset first. Putting a take in the other slot is the
   * moment somebody says they want to compare, so that is where the copy is made. */
  private async forkIfShared(slot: Slot) {
    if (!this.has("sound")) return;
    const other: Slot = slot === "A" ? "B" : "A";
    const mine = player.slots[slot];
    const theirs = player.slots[other];
    if (!mine.preset || !theirs.preset || !theirs.version) return;
    if (mine.preset.id !== theirs.preset.id) return;          // already their own
    const made = await attempt(() => post(`/api/songs/${this.id}/sound`,
      { name: `${mine.preset!.name} ${slot}`, data: mine.preset!.data }));
    if (!made?.preset) return;                                // it still works, just shared
    this.presets = [...this.presets, made.preset];
    await this.setPreset(slot, made.preset);
    emit("sound:changed", { songId: Number(this.id) });
  }

  /* Hand the page's decks to the player once it is holding this song. play() puts the
   * song's own preset on both decks, and has to, or the last song's equaliser leaks onto
   * this one. That also throws away a choice made here while nothing was playing, so it
   * is handed over again as soon as the player arrives. */
  private async handOver() {
    if (!this.here) return;
    const b = this.page.version.B;
    if (b && !player.slots.B.version) {
      await setSlot("B", { version: b });
      // The same copy a B chosen while playing gets, or editing B would change A.
      await this.forkIfShared("B");
    }
    for (const slot of SLOTS) {
      const want = this.page.preset[slot];
      if (!want || (slot === "B" && !player.slots.B.version)) continue;
      if (player.slots[slot].preset?.id !== want.id) await setSlot(slot, { preset: want });
    }
    if (this.page.selected === "B" && player.slots.B.version && player.active !== "B") await switchTo("B");
  }

  /** Play this song from the page, with the page's choice of A and B. Pressing it while
   *  this song is already on the player toggles, as play does everywhere. */
  async play(queue?: Song[]) {
    if (!this.song) return;
    if (this.here && player.slots.A.version) return toggle();
    const version = this.versionOf("A");
    if (!version) return;
    await play(this.song, version, queue);
    await this.handOver();
  }

  /** Play one particular take now, in A. */
  async playVersion(version: Version) {
    if (!this.song) return;
    this.page.version.A = version;
    if (this.here) await setSlot("A", { version });
    else { await play(this.song, version); await this.handOver(); }
    if (this.here && !player.playing) await toggle();
  }

  // ── loading ────────────────────────────────────────────────────────────────

  async load() {
    this.loading = true;
    // Guest mode has to be on before the first request: the router sets it too, but a
    // store built during the same tick must not depend on who ran first.
    if (this.share) guest.set({ share: this.share, song: this.id });
    const id = this.id;
    const none = <T>(value: T) => Promise.resolve(value);
    try {
      const [songData, versionData, albumData, artData, titleData, soundData] = await Promise.all([
        get(`/api/songs/${id}`),
        this.has("versions") ? get(`/api/songs/${id}/versions`) : none({ versions: [] }),
        this.has("albums") ? get(`/api/songs/${id}/albums`).catch(() => ({ albums: [] })) : none({ albums: [] }),
        this.has("artwork") ? get(`/api/songs/${id}/artwork`).catch(() => ({ artwork: [] })) : none({ artwork: [] }),
        get(`/api/songs/${id}/titles`).catch(() => ({ previous: [] })),
        this.has("sound") ? get(`/api/songs/${id}/sound`).catch(() => ({ presets: [] })) : none({ presets: [] }),
      ]);
      this.song = songData.song;
      this.versions = versionData.versions || [];
      this.albums = albumData.albums || [];
      this.artwork = artData.artwork || [];
      this.previous = titleData.previous || [];
      this.presets = soundData.presets || [];
      this.error = "";
      // So the press has nothing left to wait for.
      prime(this.current);
      this.examine();
    } catch (e) {
      this.error = (e as Error).message || "That song did not load.";
    } finally {
      this.loading = false;
    }
  }

  /** Fetch one part again after changing it. Never blanks the screen. */
  async refresh(...parts: ("song" | "versions" | "artwork" | "albums" | "titles" | "presets")[]) {
    const id = this.id;
    const want = parts.length ? parts : ["song", "versions", "artwork", "albums", "titles", "presets"];
    await Promise.all(want.map(async (part) => {
      try {
        if (part === "song") this.song = (await get(`/api/songs/${id}`)).song;
        if (part === "versions" && this.has("versions")) this.versions = (await get(`/api/songs/${id}/versions`)).versions || [];
        if (part === "artwork" && this.has("artwork")) this.artwork = (await get(`/api/songs/${id}/artwork`)).artwork || [];
        if (part === "albums" && this.has("albums")) this.albums = (await get(`/api/songs/${id}/albums`)).albums || [];
        if (part === "titles") this.previous = (await get(`/api/songs/${id}/titles`)).previous || [];
        if (part === "presets" && this.has("sound")) this.presets = (await get(`/api/songs/${id}/sound`)).presets || [];
      } catch { /* what is on screen stands */ }
    }));
  }

  /* Takes that arrived before waveform shapes existed have none. Asked for in bounded
   * batches when a song opens, and copied onto the takes already on screen. */
  private async examine() {
    if (!this.has("versions") || this.guest) return;
    if (!this.versions.some((v) => !(v.shape as number[] | undefined)?.length && !v.trouble)) return;
    for (let round = 0; round < 4; round++) {
      const done = await post("/api/versions/examine?limit=60", {}).catch(() => null);
      if (!done?.looked_at) break;
      const fresh = await get(`/api/songs/${this.id}/versions`).catch(() => null);
      if (!fresh) break;
      this.versions = fresh.versions || this.versions;
      if (!done.left) break;
    }
  }

  /** Add a render to this song from a file. Resolves with the new version, or null. */
  async addRender(file: File): Promise<Version | null> {
    const made = await attempt(() => upload(`/api/songs/${this.id}/versions`, file));
    if (!made) return null;
    await this.refresh("versions", "song");
    emit("versions:changed", { songId: Number(this.id) });
    emit("songs:changed", { songId: Number(this.id) });
    return made.version || null;
  }
}

const KEY = Symbol("song");

export function provideSong(store: SongStore): SongStore {
  setContext(KEY, store);
  return store;
}

/** The song the enclosing song screen is showing. Call during component initialisation. */
export function useSong(): SongStore {
  const store = getContext<SongStore | undefined>(KEY);
  if (!store) throw new Error("useSong() was called outside the song screen");
  return store;
}
