// snap.js: how far things snap, and how that follows the zoom. Pure functions (tests/daw).
//
// A snap setting is "auto", the id of one step below, or "none". Auto picks the finest straight
// (not triplet) step that is still at least minPx wide on screen, so zooming in snaps finer and
// zooming out snaps coarser. Triplets are only used when somebody picks them.
// Everything is in beats; a result of 0 means "do not snap".

export const STEPS = [
  { id: "4bar", beats: 16, label: "4 bars" },
  { id: "bar", beats: 4, label: "Bar" },
  { id: "beat", beats: 1, label: "Beat" },
  { id: "1/2", beats: 0.5, label: "1/2 beat" },
  { id: "1/3", beats: 1 / 3, label: "1/3 beat", triplet: true },
  { id: "1/4", beats: 0.25, label: "1/4 beat" },
  { id: "1/6", beats: 1 / 6, label: "1/6 beat", triplet: true },
  { id: "1/8", beats: 0.125, label: "1/8 beat" },
];

export const pick = (ids) => STEPS.filter((s) => ids.includes(s.id));
export const ROLL_STEPS = pick(["bar", "beat", "1/2", "1/3", "1/4", "1/6", "1/8"]);
export const SONG_STEPS = pick(["4bar", "bar", "beat", "1/2", "1/4"]);

// The finest straight step that is at least minPx wide; the coarsest one if none is.
export function autoStep(pxPerBeat, minPx, choices = ROLL_STEPS) {
  const straight = choices.filter((s) => !s.triplet).sort((a, b) => a.beats - b.beats);
  for (const s of straight) if (s.beats * pxPerBeat >= minPx) return s.beats;
  return straight[straight.length - 1].beats;
}

// The step in beats for a setting at this zoom. 0 = none.
export function stepFor(setting, pxPerBeat, minPx, choices = ROLL_STEPS) {
  if (setting === "none") return 0;
  const hit = choices.find((s) => s.id === setting);
  return hit ? hit.beats : autoStep(pxPerBeat, minPx, choices);
}

export const label = (setting, step) => (setting === "auto" ? "Auto" + (step ? " (" + (STEPS.find((s) => Math.abs(s.beats - step) < 1e-9) || { label: "?" }).label + ")" : "") : (STEPS.find((s) => s.id === setting) || { label: "None" }).label);

// Rounding that never leaves float dust (a third of a beat times three is a beat, not 0.99999).
const clean = (v) => Math.round(v * 1e6) / 1e6;
export const snapFloor = (beat, step) => (step > 0 ? clean(Math.floor(beat / step + 1e-9) * step) : beat);
export const snapRound = (beat, step) => (step > 0 ? clean(Math.round(beat / step) * step) : beat);

const KEY = "jriter-daw-snap";
export function loadSnap(storage) {
  try {
    const j = JSON.parse(storage.getItem(KEY) || "{}");
    const ok = (v, list) => (v === "auto" || v === "none" || list.some((s) => s.id === v) ? v : "auto");
    return { roll: ok(j.roll, ROLL_STEPS), song: ok(j.song, SONG_STEPS) };
  } catch { return { roll: "auto", song: "auto" }; }
}
// Merges into what is stored, so the roll and the Song tab each save only their own half.
export function saveSnap(storage, patch) { try { storage.setItem(KEY, JSON.stringify({ ...loadSnap(storage), ...patch })); } catch { /* storage off: it stays for this visit */ } }

// <option>s for a Snap select: Auto (showing what it is right now), each step, None.
export function snapOptions(choices, setting, step) {
  const o = (v, text) => `<option value="${v}"${v === setting ? " selected" : ""}>${text}</option>`;
  return o("auto", label("auto", step)) + choices.map((c) => o(c.id, c.label)).join("") + o("none", "None");
}
