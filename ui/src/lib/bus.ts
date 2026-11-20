/* What changed, said out loud.
 *
 * Screens do not know about each other. One that changes something says so here and
 * whoever is showing that thing refetches. The names are the full list: an event that is
 * not in this type cannot be emitted, so a typo is a compile error and not a silence.
 */
export interface Events {
  "songs:changed": { songId?: number } | undefined;
  "versions:changed": { songId?: number | string | null } | undefined;
  "albums:changed": undefined;
  "playlists:changed": undefined;
  "renders:changed": undefined;
  "settings:changed": undefined;
  "sound:changed": { songId?: number } | undefined;
  "lyrics:changed": { songId?: number } | undefined;
  "artwork:changed": { songId?: number } | undefined;
  "arrangement:changed": { songId?: number } | undefined;
  "vocals:changed": { songId?: number } | undefined;
  "shares:changed": undefined;
  "youtube:changed": { songId?: number } | undefined;
  "arrange:change": undefined;
  "arrange:playing": { partId: string | null };
  "arrange:ready": { versionId: number | string };
  "arrange:lyrics": undefined;
  "vocals:fx": { id: number; state: string };
  "vocals:rendered": { id?: number };
}

type Handler<K extends keyof Events> = (detail: Events[K]) => void;
const handlers = new Map<keyof Events, Set<Handler<any>>>();

/** Listen. Returns the function that stops listening, which is what an $effect returns. */
export function on<K extends keyof Events>(name: K, fn: Handler<K>): () => void {
  let set = handlers.get(name);
  if (!set) handlers.set(name, (set = new Set()));
  set.add(fn);
  return () => { set!.delete(fn); };
}

export function emit<K extends keyof Events>(name: K, ...detail: undefined extends Events[K] ? [Events[K]?] : [Events[K]]): void {
  const set = handlers.get(name);
  if (!set) return;
  for (const fn of [...set]) {
    try { fn(detail[0] as Events[K]); } catch (e) { console.error(`[bus] ${name}`, e); }
  }
}

/** Several events, one handler. */
export function onAny(names: (keyof Events)[], fn: () => void): () => void {
  const stops = names.map((name) => on(name, fn));
  return () => stops.forEach((stop) => stop());
}
