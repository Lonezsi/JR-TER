/* A guest library in memory: the server's tables, as rows, and the few things the server
 * keeps beside them (settings, the library's name).
 *
 * The tables and columns are the ones jriter/modules/export.py TAKEN names, plus the
 * peaks column the export leaves out, so what is held here is literally the export format
 * and taking a copy is writing it down.
 */
import { kvGet, kvSet } from "./store";

export type Row = Record<string, any>;

export const TABLES = [
  "songs", "song_titles", "versions", "renders", "lyric_sheets", "lyric_revisions",
  "albums", "album_songs", "playlists", "playlist_items", "artwork", "sound_presets",
  "arrangements", "vocal_takes",
] as const;
export type Table = typeof TABLES[number];

/** jriter/config.py _DEFAULTS, the ones that mean something without a server. */
export const DEFAULTS: Row = {
  library_name: "Guest library",
  accent: "#FAA8B8",
  adaptive: true,
  artwork_ground: true,
  effect_presets: {},
  pinned: [],
  lyrics_view: { marks: true, highlight: false, structure: true, warnings: true, spellcheck: false },
  auto_update: true,
  sync_interval_minutes: 5,
  dust: 100,
  glass_edge: 100,
  dither: 60,
  ffmpeg_path: "",
};

export interface Library {
  format: "jriter-guest";
  version: 1;
  created_at: number;
  settings: Row;
  tables: Record<Table, Row[]>;
  /** The next id per table. Never handed out twice: the server learned the hard way
   *  that a reused id plays the old bytes out of a cache. */
  next: Record<string, number>;
}

export function blank(): Library {
  return {
    format: "jriter-guest", version: 1, created_at: now(), settings: {},
    tables: Object.fromEntries(TABLES.map((t) => [t, []])) as unknown as Record<Table, Row[]>,
    next: {},
  };
}

export const now = () => Date.now() / 1000;

let lib: Library | null = null;
let loading: Promise<Library> | null = null;
let dirty = false;
let saving: Promise<void> = Promise.resolve();

/** The library, read from IndexedDB once per worker life, made empty the first time. */
export function load(): Promise<Library> {
  if (lib) return Promise.resolve(lib);
  if (loading) return loading;
  loading = (async () => {
    const kept = await kvGet<Library>("library");
    const fresh = !kept;
    lib = kept || blank();
    for (const t of TABLES) if (!Array.isArray(lib.tables[t])) lib.tables[t] = [];
    lib.next ||= {};
    lib.settings ||= {};
    if (fresh) { dirty = true; await persist(); }
    return lib;
  })().finally(() => { loading = null; });
  return loading;
}

/** Drop what is held in memory, so the next request reads it again. */
export function forget() { lib = null; loading = null; dirty = false; }

export function current(): Library {
  if (!lib) throw new Error("the guest library is not loaded");
  return lib;
}

export const touchDirty = () => { dirty = true; };

/** Write the library down if anything changed. Chained, so two saves never race. */
export function persist(): Promise<void> {
  if (!dirty || !lib) return saving;
  dirty = false;
  const snapshot = lib;
  saving = saving.then(() => kvSet("library", snapshot)).catch((e) => {
    dirty = true;
    throw e;
  });
  return saving;
}

export function settings(): Row {
  return { ...DEFAULTS, ...current().settings };
}

// ── rows ─────────────────────────────────────────────────────────────────────

export const rows = (t: Table) => current().tables[t];

export function insert(t: Table, row: Row): Row {
  const l = current();
  if (t !== "album_songs" && t !== "arrangements") {
    const top = l.tables[t].reduce((m, r) => Math.max(m, Number(r.id) || 0), 0);
    const id = Math.max(l.next[t] || 1, top + 1);
    l.next[t] = id + 1;
    row = { id, ...row };
  }
  l.tables[t].push(row);
  dirty = true;
  return row;
}

export const byId = (t: Table, id: unknown) => {
  const n = Number(id);
  return current().tables[t].find((r) => r.id === n);
};

export function update(row: Row, patch: Row): Row {
  Object.assign(row, patch);
  dirty = true;
  return row;
}

export function remove(t: Table, keep: (r: Row) => boolean): number {
  const l = current();
  const before = l.tables[t].length;
  l.tables[t] = l.tables[t].filter((r) => keep(r));
  if (l.tables[t].length !== before) dirty = true;
  return before - l.tables[t].length;
}

export const where = (t: Table, test: (r: Row) => boolean) => current().tables[t].filter(test);

/** Replace the whole library: an import into an empty one, or an erase. */
export function replaceAll(next: Library) {
  lib = next;
  dirty = true;
}

/** Strings compared the way SQLite's NOCASE and the search's fold() mean it. */
export const fold = (s: unknown) =>
  String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
