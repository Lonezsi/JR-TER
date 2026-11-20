/* The grave, for a guest library: the twin of jriter/modules/grave.py.
 *
 * A deleted song, render, album, playlist, set of words, picture, inbox render or vocal
 * take is copied here first, with everything that goes with it, and waits KEEP_DAYS days.
 * Bringing it back puts the rows back with the ids they had: a guest library never hands
 * an id out twice (lib.ts), so they are always free. While something is buried its audio
 * stays (holds(), asked by files.release); when it leaves for good, files nothing else uses
 * go with it. Same routes and shapes as the server's.
 */
import { GuestError, type Routes } from "../http";
import { current, now, rows, touchDirty, type Row, type Table } from "../lib";
import { release } from "../files";

export const KEEP_DAYS = 30;
const KIND_SAID: Record<string, string> = { song: "Song", album: "Album", playlist: "Playlist", version: "Render",
  sheet: "Words", image: "Picture", render: "Inbox render", take: "Vocal take" };
/** Everything a row can point at comes before it. */
const ORDER: Table[] = ["songs", "song_titles", "albums", "album_songs", "playlists", "versions", "renders",
  "lyric_sheets", "lyric_revisions", "artwork", "sound_presets", "arrangements", "playlist_items", "vocal_takes"];
const BLOBS: Partial<Record<Table, string>> = { versions: "digest", renders: "digest", artwork: "digest",
  vocal_takes: "digest", albums: "cover_digest" };

interface Entry { id: number; kind: string; title: string; deleted_at: number; tables: Partial<Record<Table, Row[]>>; digests: string[] }

function grave(): Entry[] {
  const lib = current() as any;
  if (!lib.grave) lib.grave = [];
  return lib.grave as Entry[];
}
const copy = (r: Row[]) => r.map((x) => JSON.parse(JSON.stringify(x)));

function bury(kind: string, title: string, tables: Partial<Record<Table, Row[]>>) {
  const kept: Partial<Record<Table, Row[]>> = {};
  for (const [t, list] of Object.entries(tables)) if (list && list.length) kept[t as Table] = copy(list);
  const digests = [...new Set(Object.entries(kept).flatMap(([t, list]) =>
    BLOBS[t as Table] ? list!.map((r) => r[BLOBS[t as Table]!]).filter(Boolean) : []))];
  const all = grave();
  const id = all.reduce((m, e) => Math.max(m, e.id), 0) + 1;
  all.unshift({ id, kind, title: title || "", deleted_at: now(), tables: kept, digests });
  touchDirty();
}

export function holds(digest: string): boolean {
  return grave().some((e) => e.digests.includes(digest));
}

async function leave(test: (e: Entry) => boolean) {
  const lib = current() as any;
  const going = grave().filter(test);
  lib.grave = grave().filter((e) => !test(e));
  touchDirty();
  for (const e of going) for (const d of e.digests) await release(d);
  return going.length;
}
export const forgetOld = () => leave((e) => e.deleted_at < now() - KEEP_DAYS * 86400);

// ── what each kind takes with it ─────────────────────────────────────────────────────────
const on = (t: Table, test: (r: Row) => boolean) => rows(t).filter(test);

export function burySong(id: number) {
  const sheets = on("lyric_sheets", (r) => r.song_id === id);
  const ids = new Set(sheets.map((s) => s.id));
  bury("song", on("songs", (r) => r.id === id)[0]?.title ?? "", {
    songs: on("songs", (r) => r.id === id),
    song_titles: on("song_titles", (r) => r.song_id === id),
    album_songs: on("album_songs", (r) => r.song_id === id),
    versions: on("versions", (r) => r.song_id === id),
    lyric_sheets: sheets,
    lyric_revisions: on("lyric_revisions", (r) => ids.has(r.sheet_id)),
    artwork: on("artwork", (r) => r.song_id === id),
    sound_presets: on("sound_presets", (r) => r.song_id === id),
    arrangements: on("arrangements", (r) => r.song_id === id),
    playlist_items: on("playlist_items", (r) => r.song_id === id),
    vocal_takes: on("vocal_takes", (r) => r.song_id === id),
  });
}
export function buryAlbum(id: number) {
  const lists = on("playlists", (r) => r.album_id === id);
  const ids = new Set(lists.map((p) => p.id));
  bury("album", on("albums", (r) => r.id === id)[0]?.title ?? "", {
    albums: on("albums", (r) => r.id === id), album_songs: on("album_songs", (r) => r.album_id === id),
    playlists: lists, playlist_items: on("playlist_items", (r) => ids.has(r.playlist_id)),
  });
}
export function buryPlaylist(id: number) {
  bury("playlist", on("playlists", (r) => r.id === id)[0]?.title ?? "", {
    playlists: on("playlists", (r) => r.id === id), playlist_items: on("playlist_items", (r) => r.playlist_id === id),
  });
}
export function buryVersion(id: number) {
  const v = on("versions", (r) => r.id === id)[0];
  const song = v ? on("songs", (r) => r.id === v.song_id)[0] : null;
  bury("version", v ? `v${v.n} of ${song?.title ?? "a song"}` : "", { versions: v ? [v] : [] });
}
export function burySheet(id: number) {
  const s = on("lyric_sheets", (r) => r.id === id)[0];
  bury("sheet", s?.name ?? "", { lyric_sheets: s ? [s] : [], lyric_revisions: on("lyric_revisions", (r) => r.sheet_id === id) });
}
export function buryImage(id: number) {
  bury("image", "A picture", { artwork: on("artwork", (r) => r.id === id) });
}
export function buryRender(id: number) {
  const r = on("renders", (x) => x.id === id)[0];
  bury("render", r?.filename ?? "A render", { renders: r ? [r] : [], playlist_items: on("playlist_items", (i) => i.render_id === id) });
}
export function buryTake(id: number) {
  const t = on("vocal_takes", (r) => r.id === id)[0];
  bury("take", t?.name || "A take", { vocal_takes: t ? [t] : [] });
}

function restore(e: Entry): number {
  let back = 0;
  for (const t of ORDER) {
    for (const row of e.tables[t] ?? []) {
      // A link to something gone since (an album deleted after this song) stays out.
      if (t === "album_songs" && !rows("albums").some((a) => a.id === row.album_id)) continue;
      if (t === "playlist_items" && !rows("playlists").some((p) => p.id === row.playlist_id)) continue;
      if ("id" in row && rows(t).some((r) => r.id === row.id)) continue;
      rows(t).push(JSON.parse(JSON.stringify(row)));
      back++;
    }
  }
  touchDirty();
  return back;
}

const get = (id: string) => {
  const e = grave().find((x) => x.id === Number(id));
  if (!e) throw new GuestError("That's not in the grave any more.", 404);
  return e;
};

export const routes: Routes = {
  "GET /api/grave": async () => {
    await forgetOld();
    return {
      keep_days: KEEP_DAYS,
      items: grave().map((e) => ({ id: e.id, kind: e.kind, title: e.title, deleted_at: e.deleted_at,
        kind_said: KIND_SAID[e.kind] ?? e.kind, goes_at: e.deleted_at + KEEP_DAYS * 86400 })),
    };
  },
  "POST /api/grave/<id>/restore": (req) => {
    const e = get(req.params.id);
    const back = restore(e);
    (current() as any).grave = grave().filter((x) => x.id !== e.id);
    return { restored: e.kind, title: e.title, rows: back };
  },
  "DELETE /api/grave/<id>": async (req) => {
    const e = get(req.params.id);
    await leave((x) => x.id === e.id);
    return { forgotten: e.id };
  },
  "DELETE /api/grave": async () => ({ forgotten: await leave(() => true) }),
};

export const summary = () => ({ count: grave().length, keep_days: KEEP_DAYS });
