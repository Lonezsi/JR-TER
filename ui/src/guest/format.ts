/* A guest library as the JR!TER library file (docs/library-format.md), and back.
 *
 * library.json is the source of truth: the tables, with the columns
 * jriter/modules/export.py TAKEN names. songs/<title>/words.md and song.txt are for
 * people and never read back. audio/<digest><ext> holds every file, always, because a
 * guest library has nowhere else its sound could be.
 */
import { zip, unzip, type Entry } from "./zip";
import { blobGet, blobPut } from "./store";
import { TABLES, type Library, type Row, type Table } from "./lib";
import { TYPES } from "./http";

const TAKEN: Record<Table, string[]> = {
  songs: ["id", "title", "notes", "current_version_id", "created_at", "updated_at", "opened"],
  song_titles: ["id", "song_id", "title", "changed_at"],
  versions: ["id", "song_id", "n", "digest", "ext", "size", "duration", "bitrate", "label", "filename",
    "source_path", "created_at", "project_at", "rendered_at", "peak_db", "trouble"],
  renders: ["id", "digest", "ext", "size", "duration", "bitrate", "filename", "source_path", "origin",
    "created_at", "used_at", "project_at", "rendered_at", "peak_db", "trouble", "song_id", "version_id"],
  lyric_sheets: ["id", "song_id", "name", "position", "is_current", "created_at"],
  lyric_revisions: ["id", "sheet_id", "text", "created_at"],
  albums: ["id", "title", "year", "notes", "cover_digest", "cover_ext", "created_at", "updated_at", "opened"],
  album_songs: ["album_id", "song_id", "position"],
  playlists: ["id", "title", "album_id", "created_at", "updated_at"],
  playlist_items: ["id", "playlist_id", "position", "song_id", "render_id", "added_at"],
  artwork: ["id", "song_id", "digest", "ext", "position", "caption", "created_at"],
  sound_presets: ["id", "song_id", "name", "is_current", "data", "created_at", "updated_at"],
  arrangements: ["song_id", "version_id", "bpm", "offset", "per_bar", "enabled", "data", "updated_at"],
  vocal_takes: ["id", "song_id", "author", "name", "digest", "ext", "size", "duration", "offset", "enabled",
    "gain", "chain", "created_at", "updated_at"],
};

const README = `This is a JR!TER library, taken from a guest library kept in a web browser.

  library.json            every row it keeps, table by table (the source of truth)
  settings.json           its settings
  songs/<title>/words.md  each song's current words, as they were typed
  songs/<title>/song.txt  each song in plain text: renders, arrangement, sound
  audio/<digest>.<ext>    every render, recording and picture, named by the SHA-256
                          of its bytes; library.json refers to them by digest and ext

Nothing in here needs JR!TER to be read: it is JSON and plain text. To bring it into a
JR!TER account, open Settings, Library, and bring a library in. songs/ is written for
people and never read back: an import only reads library.json and audio/.

Taken %WHEN% from %NAME%.
`;

const pad = (n: number) => String(n).padStart(2, "0");
const day = (t: number) => { const d = new Date(t * 1000); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const clock = (s: number) => `${Math.floor((s || 0) / 60)}:${pad(Math.round(s || 0) % 60)}`;
const folder = (title: string) => (title || "Untitled").replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").replace(/[. ]+$/, "").trim().slice(0, 80) || "Untitled";

function songText(lib: Library, song: Row): string {
  const t = lib.tables;
  const lines = [song.title, `Started ${day(song.created_at)}, last touched ${day(song.updated_at)}.`, ""];
  if (song.notes) lines.push(song.notes, "");
  const versions = t.versions.filter((v) => v.song_id === song.id).sort((a, b) => b.n - a.n);
  lines.push("Renders");
  if (!versions.length) lines.push("  none yet");
  for (const v of versions) {
    lines.push(`  v${v.n}  ${clock(v.duration)}  ${v.label || v.filename || ""}${v.id === song.current_version_id ? "  (the current one)" : ""}`
      + `\n        audio/${v.digest}${v.ext}`);
  }
  const arr = t.arrangements.find((a) => a.song_id === song.id);
  if (arr) {
    let data: Row = {};
    try { data = JSON.parse(arr.data || "{}"); } catch { /* empty */ }
    const parts = new Map((data.parts || []).map((p: Row) => [p.id, p.name]));
    lines.push("", "Arrangement", `  ${arr.bpm} bpm, ${arr.per_bar} beats in a bar, ${arr.enabled ? "on" : "off"}`);
    for (const c of data.clips || []) lines.push(`  ${parts.get(c.part) || "a section"}: ${c.beats} beats from beat ${c.from}`);
  }
  const presets = t.sound_presets.filter((p) => p.song_id === song.id);
  if (presets.length) {
    lines.push("", "Sound");
    for (const p of presets) {
      let data: Row = {};
      try { data = JSON.parse(p.data || "{}"); } catch { /* empty */ }
      const rack = Array.isArray(data.rack) ? data.rack.map((u: Row) => u.kind).join(", ") : `${(data.bands || []).length} EQ bands`;
      lines.push(`  ${p.name}${p.is_current ? " (in use)" : ""}: ${rack || "nothing on it"}`);
    }
  }
  const sheets = t.lyric_sheets.filter((s) => s.song_id === song.id);
  if (sheets.length > 1) lines.push("", "Words", ...sheets.map((s) => `  ${s.name}${s.is_current ? " (current)" : ""}`));
  return lines.join("\n") + "\n";
}

/** Every file the library holds, by digest, with the extension it is stored under. */
function files(lib: Library): Map<string, string> {
  const out = new Map<string, string>();
  const t = lib.tables;
  for (const table of ["versions", "renders", "artwork", "vocal_takes"] as const) {
    for (const r of t[table]) if (r.digest) out.set(r.digest, r.ext || "");
  }
  for (const a of t.albums) if (a.cover_digest) out.set(a.cover_digest, a.cover_ext || "");
  return out;
}

export function isEmpty(lib: Library | undefined | null) {
  return !lib || TABLES.every((t) => !(lib.tables[t] || []).length);
}

export async function writeLibrary(lib: Library, settings: Row): Promise<Blob> {
  const name = settings.library_name || "Guest library";
  const tables: Record<string, Row[]> = {};
  for (const t of TABLES) {
    tables[t] = (lib.tables[t] || []).map((r) => Object.fromEntries(TAKEN[t].filter((c) => c in r).map((c) => [c, r[c]])));
  }
  const body = {
    format: "jriter-library", version: 2,
    about: "Every row this library keeps, table by table. Audio and pictures are in audio/, named "
      + "<digest><ext> after the rows that point at them. See README.txt.",
    taken_at: Date.now() / 1000, library: name, tables,
    left_out: { peaks: "the drawn waveform of each render, worked out again from the audio" },
  };
  const when = new Date();
  const entries: Entry[] = [
    { name: "README.txt", data: README.replace("%WHEN%", `${day(when.getTime() / 1000)} ${pad(when.getHours())}:${pad(when.getMinutes())}`).replace("%NAME%", name) },
    { name: "library.json", data: JSON.stringify(body, null, 1) },
    { name: "settings.json", data: JSON.stringify(settings, null, 1) },
  ];
  const used = new Set<string>();
  for (const song of lib.tables.songs) {
    let dir = folder(song.title), n = 2;
    while (used.has(dir.toLowerCase())) dir = `${folder(song.title)} (${n++})`;
    used.add(dir.toLowerCase());
    const sheet = lib.tables.lyric_sheets.filter((s) => s.song_id === song.id)
      .sort((a, b) => b.is_current - a.is_current || a.position - b.position)[0];
    if (sheet) {
      const rev = lib.tables.lyric_revisions.filter((r) => r.sheet_id === sheet.id).sort((a, b) => b.id - a.id)[0];
      if (rev?.text) entries.push({ name: `songs/${dir}/words.md`, data: rev.text });
    }
    entries.push({ name: `songs/${dir}/song.txt`, data: songText(lib, song) });
  }
  for (const [digest, ext] of files(lib)) {
    const stored = await blobGet(digest);
    if (stored) entries.push({ name: `audio/${digest}${ext}`, data: stored.blob });
  }
  return zip(entries, when);
}

export interface Brought { songs: number; albums: number; playlists: number; renders: number; lyrics: number; missing_audio: number }

/** Add a library file's rows to `lib`, with new ids, the way POST /api/import does on the
 *  server. Adds, never replaces. `insert` hands out the ids. */
export async function readLibrary(file: Blob, lib: Library, insert: (t: Table, r: Row) => Row): Promise<Brought> {
  const z = await unzip(file);
  const text = await z.text("library.json");
  if (!text) throw new Error("That zip has no library.json in it, so it is not a JR!TER library.");
  let body: Row;
  try { body = JSON.parse(text); } catch { throw new Error("library.json in that zip is not readable."); }
  if (body.format && body.format !== "jriter-library") throw new Error("That is not a JR!TER library file.");
  if ((body.version || 1) > 2) throw new Error("That library was made by a newer JR!TER. Update this one first.");
  const tables: Record<string, Row[]> = body.tables || {};
  const rows = (t: Table) => (Array.isArray(tables[t]) ? tables[t] : []).filter((r) => r && typeof r === "object");

  const known = new Set<string>(files(lib).keys());
  const inZip = new Map<string, string>();
  for (const n of z.names) {
    // "<digest>.wav", and "<digest>..wav" as a server that doubled the dot writes it
    const m = /^audio\/([0-9a-f]{64})(\.+\w+)?$/.exec(n);
    if (m) inZip.set(m[1], n);
  }
  let missing = 0;
  /** Is this file here, or can it be brought in from the zip. */
  async function have(digest: string, ext: string): Promise<boolean> {
    if (!digest) return false;
    if (known.has(digest) || (await blobGet(digest))) { known.add(digest); return true; }
    const name = inZip.get(digest);
    if (!name) return false;
    const blob = await z.blob(name);
    if (!blob) return false;
    const type = TYPES[ext] || "application/octet-stream";
    await blobPut({ digest, ext, size: blob.size, type, blob: blob.slice(0, blob.size, type) });
    known.add(digest);
    return true;
  }
  const pick = (t: Table, r: Row) => {
    const out: Row = {};
    for (const c of TAKEN[t]) if (c in r && c !== "id") out[c] = r[c];
    return out;
  };
  const ids: Record<string, Map<number, number>> = {};
  const map = (t: string, old: unknown) => (old == null ? null : ids[t]?.get(Number(old)) ?? null);
  const add = (t: Table, r: Row, row: Row) => {
    const made = insert(t, row);
    (ids[t] ||= new Map()).set(Number(r.id), made.id);
    return made;
  };
  const counts: Brought = { songs: 0, albums: 0, playlists: 0, renders: 0, lyrics: 0, missing_audio: 0 };

  for (const r of rows("songs")) { add("songs", r, { ...pick("songs", r), current_version_id: null, opened: r.opened || 0 }); counts.songs++; }
  for (const r of rows("song_titles")) { const s = map("songs", r.song_id); if (s) add("song_titles", r, { ...pick("song_titles", r), song_id: s }); }
  for (const r of rows("versions")) {
    const s = map("songs", r.song_id);
    if (!s) continue;
    if (!(await have(r.digest, r.ext))) { missing++; continue; }
    add("versions", r, { ...pick("versions", r), song_id: s, peaks: "", trouble: r.trouble === "not looked at" ? "" : r.trouble || "" });
  }
  for (const r of rows("renders")) {
    if (!(await have(r.digest, r.ext))) { missing++; continue; }
    if (lib.tables.renders.some((x) => x.digest === r.digest)) continue;    // the same render twice is one
    add("renders", r, { ...pick("renders", r), song_id: map("songs", r.song_id), version_id: map("versions", r.version_id), peaks: "",
      trouble: r.trouble === "not looked at" ? "" : r.trouble || "" });
    counts.renders++;
  }
  for (const r of rows("lyric_sheets")) { const s = map("songs", r.song_id); if (s) { add("lyric_sheets", r, { ...pick("lyric_sheets", r), song_id: s }); counts.lyrics++; } }
  for (const r of rows("lyric_revisions")) { const s = map("lyric_sheets", r.sheet_id); if (s) add("lyric_revisions", r, { ...pick("lyric_revisions", r), sheet_id: s }); }
  for (const r of rows("albums")) {
    const row = pick("albums", r);
    if (row.cover_digest && !(await have(row.cover_digest, row.cover_ext))) { missing++; row.cover_digest = ""; row.cover_ext = ""; }
    add("albums", r, { cover_digest: "", cover_ext: "", notes: "", opened: 0, ...row }); counts.albums++;
  }
  for (const r of rows("album_songs")) {
    const a = map("albums", r.album_id), s = map("songs", r.song_id);
    if (a && s) insert("album_songs", { album_id: a, song_id: s, position: r.position || 0 });
  }
  for (const r of rows("playlists")) {
    const album = r.album_id == null ? null : map("albums", r.album_id);
    if (r.album_id != null && !album) continue;
    add("playlists", r, { ...pick("playlists", r), album_id: album });
    if (album == null) counts.playlists++;
  }
  for (const r of rows("playlist_items")) {
    const p = map("playlists", r.playlist_id), s = map("songs", r.song_id), rd = map("renders", r.render_id);
    if (p && (s || rd)) add("playlist_items", r, { ...pick("playlist_items", r), playlist_id: p, song_id: s, render_id: s ? null : rd });
  }
  for (const r of rows("artwork")) {
    const s = map("songs", r.song_id);
    if (!s) continue;
    if (!(await have(r.digest, r.ext))) { missing++; continue; }
    add("artwork", r, { ...pick("artwork", r), song_id: s });
  }
  for (const r of rows("sound_presets")) { const s = map("songs", r.song_id); if (s) add("sound_presets", r, { ...pick("sound_presets", r), song_id: s }); }
  for (const r of rows("arrangements")) {
    const s = map("songs", r.song_id);
    if (s && !lib.tables.arrangements.some((a) => a.song_id === s)) insert("arrangements", { ...pick("arrangements", r), song_id: s, version_id: map("versions", r.version_id) });
  }
  for (const r of rows("vocal_takes")) {
    const s = map("songs", r.song_id);
    if (!s) continue;
    if (!(await have(r.digest, r.ext))) { missing++; continue; }
    add("vocal_takes", r, { ...pick("vocal_takes", r), song_id: s, author: 0 });
  }
  // Last, once every version has its new id.
  for (const r of rows("songs")) {
    const s = map("songs", r.id);
    const song = s ? lib.tables.songs.find((x) => x.id === s) : null;
    if (!song) continue;
    let v = map("versions", r.current_version_id);
    if (!v) v = lib.tables.versions.filter((x) => x.song_id === s).sort((a, b) => b.n - a.n)[0]?.id ?? null;
    song.current_version_id = v;
  }
  counts.missing_audio = missing;
  return counts;
}
