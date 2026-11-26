/* Editing one song's presets: what the Sound tab does, apart from how it looks.
 *
 * ONE EDIT, DONE THE SAME WAY EVERYWHERE. The curve, the limiter's lines, the knobs and the
 * band cards all go through `edit`. In the old tab the curve adopted the deck and the
 * controls beside it did not, so turning Q or nudging Output changed numbers on a preset
 * the deck was not holding: what you adjusted was not what you heard. `edit` always puts
 * the preset on the deck being shaped, applies it live, and queues the save.
 *
 * Every edit makes a new data object rather than changing the old one in place. The
 * engine keeps a shallow copy of what it was last given and decides whether to rewire the
 * chain by comparing the band list it had with the one it is given; if both were the same
 * array, a band added in place would compare equal to itself and never be heard.
 */
import { api, uFor, post, patch, del, attempt } from "$lib/api";
import { deleteSoon } from "$lib/later.svelte";
import { emit } from "$lib/bus";
import { debounce } from "$lib/util";
import { confirm, prompt } from "$lib/dialog.svelte";
import { toast } from "$lib/toast.svelte";
import { presetEdited } from "$lib/player.svelte";
import { newId } from "$lib/audio/eq";
import { MAX_UNITS, UNITS, newUnit, rackOf } from "$lib/audio/rack";
import type { Slot } from "$lib/audio/engine";
import type { Band, Preset, RackUnit, SoundData, UnitKind } from "$lib/types";
import type { SongStore } from "../song.svelte";

export interface EditOptions {
  /** Touching a control turns it on: "eq" brings back a bypassed preset, "limiter" also
   *  switches the limiter on. Left out where the control is itself the on/off switch,
   *  because waking a bypassed preset on the way into Bypass means it could never bypass. */
  wake?: "eq" | "limiter";
  /** Say so with an Undo, for an edit that took something away. */
  undo?: string;
}
export type Edit = (fn: (data: SoundData) => void, opts?: EditOptions) => void;

export const MAX_BANDS = 24;

const snap = <T>(value: T): T => $state.snapshot(value) as T;

/** A new preset: an equaliser and a limiter, the limiter off. Both are ordinary effects. */
export const flatData = (): SoundData => ({
  bands: [], limiter: { on: false }, gain: 0, bypass: false, rack_v: 2,
  rack: [newUnit("eq"), { ...newUnit("limiter"), on: false }],
});

/** A new band as the Add buttons make it. "Low cut" is a high pass filter (it passes the
 *  highs and removes the lows) and "High cut" a low pass: the names say what is cut. */
export function bandOfType(type: BiquadFilterType): Band {
  const freq = type === "highpass" ? 80 : type === "lowpass" ? 12000 : 1000;
  return { id: newId(), type, freq, gain: 0, q: type === "peaking" ? 1.2 : 0.7, on: true };
}

export type SaveState = "idle" | "saving" | "saved" | "failed";

export class SoundEditor {

  state = $state<SaveState>("idle");
  quiet = false;

  /** The deck being shaped: the selected one, at rest or not. */
  slot: Slot;
  held: Preset | null;
  /* The tab's own copy if it has one. A preset can be on a deck before the list has heard
   * of it (a take put into B forks the shared preset), so the deck's copy is the
   * fallback; without it the tab quietly kept editing A while B was selected. */
  preset: Preset | null;

  private pending: Preset | null = null;
  private chain: Promise<unknown> = Promise.resolve();
  private fade: ReturnType<typeof setTimeout> | undefined;
  private save = debounce(() => { void this.flush(); }, 600);

  constructor(readonly song: SongStore) {
    this.slot = $derived(song.selected);
    this.held = $derived(song.presetOf(this.slot));
    this.preset = $derived(song.presets.find((p) => p.id === this.held?.id) || this.held || song.defaultPreset);
  }

  /** Is anything waiting to be saved. A refresh must not replace what it would lose. */
  get busy() { return !!this.pending || this.state === "saving"; }

  /** Put what is being shaped on the deck being shaped. A drag calls this on every
   *  pointer move, so it compares first. */
  private take(preset: Preset) {
    if (this.song.presetOf(this.slot)?.id === preset.id) return;
    void this.song.setPreset(this.slot, preset);
  }

  edit: Edit = (fn, opts = {}) => {
    const preset = this.preset;
    if (!preset) return;
    const before = opts.undo ? snap(preset.data) : null;
    const next = snap(preset.data);
    next.bands = next.bands || [];
    next.limiter = next.limiter || { on: false };
    if (opts.wake) {
      next.bypass = false;
      if (opts.wake === "limiter") next.limiter.on = true;
    }
    fn(next);
    this.commit(preset, next);
    if (before) toast(opts.undo!, "", { label: "Undo", run: () => this.commit(preset, before, true) });
  };

  private commit(preset: Preset, data: SoundData, now = false) {
    this.take(preset);
    preset.data = data;
    presetEdited(preset.id, snap(data));
    this.pending = preset;
    if (now) void this.flush(); else this.save();
  }

  /** Send the queued save. Saves are chained so an older one can never land after a newer. */
  flush(): Promise<unknown> {
    this.save.cancel();
    const preset = this.pending;
    if (!preset) return this.chain;
    this.pending = null;
    this.state = "saving";
    this.chain = this.chain.then(async () => {
      // The share is the song's own and is read now, not when the timer fires: leaving a
      // shared song and pressing Back must not send its last edit to your own library.
      const url = uFor(this.song.share, `/api/sound/${preset.id}`);
      const done = await attempt(() => api(url, { method: "PUT", json: { data: snap(preset.data) }, direct: true }));
      if (!done) { this.state = "failed"; this.pending ||= preset; return; }
      if (!this.pending) {
        this.state = "saved";
        clearTimeout(this.fade);
        this.fade = setTimeout(() => { if (this.state === "saved") this.state = "idle"; }, 2400);
      }
    });
    return this.chain;
  }

  destroy() { clearTimeout(this.fade); void this.flush(); }

  // ── the preset list ────────────────────────────────────────────────────────

  private async changed(keep?: number) {
    await this.song.refresh("presets");
    this.quiet = true;                 // our own announcement is not news to us
    emit("sound:changed", { songId: Number(this.song.id) });
    this.quiet = false;
    return keep === undefined ? null : this.song.presets.find((p) => p.id === keep) || null;
  }

  async choose(preset: Preset) {
    void this.flush();
    await this.song.setPreset(this.slot, preset);
  }

  async create() {
    const made = await attempt(() => post(`/api/songs/${this.song.id}/sound`,
      { name: `Preset ${this.song.presets.length + 1}`, data: flatData() }));
    if (!made?.preset) return;
    const fresh = await this.changed(made.preset.id);
    if (fresh) await this.song.setPreset(this.slot, fresh);
    toast("Flat preset added");
  }

  /** Copying keeps the curve and takes a new name, which is the point of copying. */
  async copy(preset: Preset) {
    if (this.pending === preset) await this.flush();
    const made = await attempt(() => post(`/api/songs/${this.song.id}/sound`,
      { name: `${preset.name} copy`, copy_from: preset.id }));
    if (!made?.preset) return;
    const fresh = await this.changed(made.preset.id);
    if (fresh) await this.song.setPreset(this.slot, fresh);
    toast("Copied");
  }

  async rename(preset: Preset) {
    const name = await prompt({ title: "Name this preset", value: preset.name, placeholder: "Car", confirm: "Save" });
    if (!name) return;
    if (await attempt(() => patch(`/api/sound/${preset.id}`, { name }))) await this.changed();
  }

  async makeCurrent(preset: Preset) {
    if (await attempt(() => post(`/api/sound/${preset.id}/current`), "This one opens first")) await this.changed();
  }

  async remove(preset: Preset) {
    if (this.song.presets.length < 2) return;
    const gone = await new Promise<boolean>((done) =>
      deleteSoon(`preset:${preset.id}`, `Deleted “${preset.name}”`, async () => true,
        { after: () => done(true), restore: () => done(false) }));
    if (!gone) return;
    if (this.pending === preset) { this.pending = null; this.save.cancel(); }
    if (!(await attempt(() => del(`/api/sound/${preset.id}`)))) return;
    await this.changed();
    // Whichever decks held it go to the one the song opens with.
    const next = this.song.defaultPreset;
    for (const slot of ["A", "B"] as Slot[]) {
      if (this.song.presetOf(slot)?.id === preset.id && next) await this.song.setPreset(slot, next);
    }
  }

  flatten() {
    this.edit((d) => { Object.assign(d, flatData()); }, { undo: "Flattened" });
    void this.flush();
  }

  toggleBypass() { this.edit((d) => { d.bypass = !d.bypass; }); }

  // ── the rack ───────────────────────────────────────────────────────────────

  /** Edit the rack itself. An old preset is written out as it was read first (its
   *  equaliser, then its limiter and output gain as effects), and its old limiter and gain
   *  fields are left neutral, since the effects carry them from now on. */
  private rack(fn: (rack: RackUnit[], d: SoundData) => void, opts: EditOptions = {}) {
    this.edit((d) => {
      d.rack = rackOf(d).map((u) => ({ ...u }));
      d.rack_v = 2; d.limiter = { on: false }; d.gain = 0;
      fn(d.rack, d);
    }, opts);
  }

  /** Change one effect in place (the limiter's drawing writes its lines through this). */
  editUnit(id: string, fn: (u: RackUnit) => void) {
    this.rack((r) => { const u = r.find((x) => x.id === id); if (u) { fn(u); u.on = true; } }, { wake: "eq" });
  }

  /** Put a set of values on one effect (an effect preset). An equaliser's are its bands. */
  applyToUnit(id: string, values: Record<string, unknown>, label: string) {
    this.rack((r, d) => {
      const u = r.find((x) => x.id === id);
      if (!u) return;
      if (u.kind === "eq") {
        const bands = (values.bands as Band[] | undefined) || [];
        d.bands = bands.map((b) => ({ ...b, id: newId() }));
      } else {
        for (const [k, v] of Object.entries(values)) if (typeof v === "number") u[k] = v;
      }
      u.on = true;
    }, { undo: `${label} loaded` });
  }

  /** Returns the new unit's id, or null if the rack is full or (for the equaliser) it is
   *  already there: one curve per preset, since its bands live on the preset. */
  addUnit(kind: UnitKind): string | null {
    const rack = rackOf(this.preset?.data);
    if (rack.length >= MAX_UNITS) { toast(`That's the max, ${MAX_UNITS} effects per preset.`); return null; }
    if (kind === "eq" && rack.some((u) => u.kind === "eq")) { toast("There's already an equaliser in here."); return null; }
    const made = newUnit(kind);
    this.rack((r) => { r.push(made); }, { wake: "eq" });
    return made.id;
  }
  removeUnit(id: string) {
    const unit = rackOf(this.preset?.data).find((u) => u.id === id);
    this.rack((r, d) => {
      const i = r.findIndex((u) => u.id === id);
      if (i >= 0) r.splice(i, 1);
      if (unit?.kind === "eq") d.bands = [];
    }, { undo: `${unit ? UNITS[unit.kind].name : "Effect"} removed` });
  }
  moveUnit(id: string, by: -1 | 1) {
    this.rack((r) => {
      const i = r.findIndex((u) => u.id === id), j = i + by;
      if (i < 0 || j < 0 || j >= r.length) return;
      [r[i], r[j]] = [r[j], r[i]];
    });
  }
  /** Drop a unit at a place in the rack (an index into the rack as it was). */
  moveUnitTo(id: string, at: number) {
    this.rack((r) => {
      const from = r.findIndex((u) => u.id === id);
      if (from < 0) return;
      const [moved] = r.splice(from, 1);
      r.splice(Math.max(0, Math.min(r.length, from < at ? at - 1 : at)), 0, moved);
    });
  }
  toggleUnit(id: string) {
    this.rack((r) => { const u = r.find((x) => x.id === id); if (u) u.on = !u.on; });
  }
  setUnit(id: string, key: string, value: number) {
    this.rack((r) => { const u = r.find((x) => x.id === id); if (u) { u[key] = value; u.on = true; } }, { wake: "eq" });
  }
  /** The command palette's limiter switch: the last limiter in the rack. */
  toggleLimiter() {
    const lim = [...rackOf(this.preset?.data)].reverse().find((u) => u.kind === "limiter");
    if (lim) this.toggleUnit(lim.id); else { const id = this.addUnit("limiter"); if (id) toast("Limiter added."); }
  }
}
