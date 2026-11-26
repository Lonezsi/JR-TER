/* Presets for one effect, not a whole sound: "Vocal" for a compressor, "Hall" for a reverb.
 * A few come built in for every kind as starting points; the rest are yours, saved in the
 * account's settings (effect_presets), so they follow you to every song.
 *
 * PUBLIC API
 *   presetsFor(kind)            built in first, then yours: { name, values, mine }[]
 *   valuesOf(unit, data)        an effect's current values, as a preset would hold them
 *   matching(unit, data)        the name of the preset it currently equals, or null
 *   saveMine(kind, name, values), deleteMine(kind, name)
 */
import { app, saveSettings } from "$lib/app.svelte";
import { UNITS, valueOf } from "./rack";
import type { Band, RackUnit, SoundData, UnitKind } from "$lib/types";

export interface FxPreset { name: string; values: Record<string, unknown>; mine?: boolean }

const band = (type: BiquadFilterType, freq: number, gain: number, q: number): Band =>
  ({ id: "", type, freq, gain, q, on: true });

const BUILT_IN: Record<UnitKind, FxPreset[]> = {
  eq: [
    { name: "Flat", values: { bands: [] } },
    { name: "Clean low end", values: { bands: [band("highpass", 40, 0, 0.7), band("peaking", 250, -2, 1)] } },
    { name: "Vocal presence", values: { bands: [band("highpass", 90, 0, 0.7), band("peaking", 3000, 2.5, 1.2), band("highshelf", 10000, 2, 0.7)] } },
    { name: "Air", values: { bands: [band("highshelf", 12000, 3, 0.7)] } },
    { name: "Phone", values: { bands: [band("highpass", 400, 0, 0.9), band("lowpass", 3400, 0, 0.9), band("peaking", 1500, 4, 1)] } },
  ],
  comp: [
    { name: "Gentle", values: { threshold: -18, ratio: 2, attack: 20, release: 200, knee: 10, makeup: 2 } },
    { name: "Vocal", values: { threshold: -22, ratio: 4, attack: 5, release: 120, knee: 6, makeup: 5 } },
    { name: "Glue", values: { threshold: -14, ratio: 2, attack: 30, release: 300, knee: 6, makeup: 1.5 } },
    { name: "Squash", values: { threshold: -30, ratio: 10, attack: 2, release: 80, knee: 0, makeup: 10 } },
  ],
  drive: [
    { name: "Warm", values: { amount: 15, mix: 100, output: -1 } },
    { name: "Crunch", values: { amount: 55, mix: 70, output: -4 } },
    { name: "Fuzz", values: { amount: 95, mix: 100, output: -8 } },
  ],
  delay: [
    { name: "Slapback", values: { time: 110, feedback: 10, tone: 6000, mix: 18 } },
    { name: "Eighth", values: { time: 250, feedback: 30, tone: 5000, mix: 20 } },
    { name: "Long tail", values: { time: 500, feedback: 55, tone: 3500, mix: 22 } },
  ],
  reverb: [
    { name: "Room", values: { size: 0.8, predelay: 8, tone: 9000, mix: 15 } },
    { name: "Hall", values: { size: 3.2, predelay: 25, tone: 7000, mix: 22 } },
    { name: "Plate", values: { size: 1.8, predelay: 12, tone: 12000, mix: 20 } },
    { name: "Huge", values: { size: 7, predelay: 40, tone: 6000, mix: 30 } },
  ],
  width: [
    { name: "Mono", values: { width: 0 } },
    { name: "Wide", values: { width: 150 } },
  ],
  gain: [
    { name: "-6 dB", values: { db: -6 } },
    { name: "+3 dB", values: { db: 3 } },
  ],
  limiter: [
    { name: "Safe", values: { threshold: -3, ceiling: -1, attack: 5, release: 150 } },
    { name: "Loud", values: { threshold: -10, ceiling: -0.3, attack: 2, release: 80 } },
    { name: "Brickwall", values: { threshold: -6, ceiling: -0.1, attack: 0, release: 50 } },
  ],
};

type Stored = Record<string, { name: string; values: Record<string, unknown> }[]>;
const stored = (): Stored => ((app.settings as unknown as { effect_presets?: Stored }).effect_presets || {});

export function presetsFor(kind: UnitKind): FxPreset[] {
  return [...BUILT_IN[kind], ...(stored()[kind] || []).map((p) => ({ ...p, mine: true }))];
}

export function valuesOf(unit: RackUnit, data: SoundData): Record<string, unknown> {
  if (unit.kind === "eq") return { bands: (data.bands || []).map(({ id: _id, ...b }) => b) };
  return Object.fromEntries(UNITS[unit.kind].knobs.map((k) => [k.key, valueOf(unit, k.key)]));
}

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
function normalBands(v: unknown) {
  return ((v as Band[] | undefined) || []).map((b) => [b.type, Math.round(b.freq), +b.gain.toFixed(1), +b.q.toFixed(2), b.on !== false]);
}
export function matching(unit: RackUnit, data: SoundData): string | null {
  const now = valuesOf(unit, data);
  for (const p of presetsFor(unit.kind)) {
    if (unit.kind === "eq" ? same(normalBands(p.values.bands), normalBands(now.bands))
      : Object.entries(p.values).every(([k, v]) => Math.abs(Number(now[k]) - Number(v)) < 1e-6)) return p.name;
  }
  return null;
}

export async function saveMine(kind: UnitKind, name: string, values: Record<string, unknown>) {
  const all = { ...stored() };
  const list = (all[kind] || []).filter((p) => p.name !== name);
  list.push({ name, values });
  all[kind] = list.slice(-50);
  await saveSettings({ effect_presets: all } as never);
}

export async function deleteMine(kind: UnitKind, name: string) {
  const all = { ...stored() };
  all[kind] = (all[kind] || []).filter((p) => p.name !== name);
  await saveSettings({ effect_presets: all } as never);
}
