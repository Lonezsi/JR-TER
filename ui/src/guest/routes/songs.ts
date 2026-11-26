/* jriter/modules/songs.py, in the browser. */
import { rows, byId, insert, update, remove, where, now, fold, type Row } from "../lib";
import { GuestError, need, type Routes } from "../http";
import { burySong } from "./grave";

export function getSong(id: unknown): Row {
  const song = byId("songs", id);
  if (!song) throw new GuestError(`no song with id ${id}`, 404);
  return song;
}

export const touch = (songId: unknown) => {
  const song = byId("songs", songId);
  if (song) update(song, { updated_at: now() });
};

/** songs.decorate: what each song's versions and artwork say about it. Copies, always. */
export function decorate(list: Row[]): Row[] {
  const versions = rows("versions");
  const art = rows("artwork");
  return list.map((s) => {
    const mine = versions.filter((v) => v.song_id === s.id);
    const top = mine.reduce<Row | null>((m, v) => (!m || v.n > m.n ? v : m), null);
    const cover = art.filter((a) => a.song_id === s.id)
      .reduce<Row | null>((m, a) => (!m || a.position < m.position ? a : m), null);
    return {
      ...s,
      version_count: mine.length,
      latest_version: top?.n ?? 0,
      latest_version_id: top?.id ?? null,
      duration: top?.duration ?? 0,
      artwork_id: cover?.id ?? null,
    };
  });
}

const ORDERS: Record<string, (a: Row, b: Row) => number> = {
  updated: (a, b) => b.updated_at - a.updated_at,
  title: (a, b) => fold(a.title).localeCompare(fold(b.title)),
  created: (a, b) => b.created_at - a.created_at,
};

export function makeSong(title: string, notes = ""): Row {
  const t = now();
  return insert("songs", { title, notes, current_version_id: null, created_at: t, updated_at: t, opened: 0, shared_from: "" });
}

export function dropSong(id: number) {
  const digests: string[] = [];
  const sheets = rows("lyric_sheets").filter((s) => s.song_id === id).map((s) => s.id);
  remove("lyric_revisions", (r) => !sheets.includes(r.sheet_id));
  remove("lyric_sheets", (r) => r.song_id !== id);
  for (const t of ["versions", "artwork", "vocal_takes"] as const) {
    for (const r of rows(t)) if (r.song_id === id) digests.push(r.digest);
    remove(t, (r) => r.song_id !== id);
  }
  remove("song_titles", (r) => r.song_id !== id);
  remove("album_songs", (r) => r.song_id !== id);
  remove("playlist_items", (r) => r.song_id !== id);
  remove("sound_presets", (r) => r.song_id !== id);
  remove("arrangements", (r) => r.song_id !== id);
  // renders keep their row, like the server's (no cascade on renders.song_id)
  remove("songs", (r) => r.id !== id);
  return digests;
}

function upNext(req: import("../http").Req) {
  const after = Number(req.q("after")) || 0;
  const skip = new Set(req.q("not").split(",").map(Number).filter(Boolean));
  if (after) skip.add(after);
  const playable = rows("songs").filter((r) => r.current_version_id != null);
  let pool = playable.filter((r) => !skip.has(r.id));
  if (!pool.length) pool = playable.filter((r) => r.id !== after);
  if (!pool.length) return { song: null, why: "nothing else in this library can be played" };
  const albums = new Set(rows("album_songs").filter((r) => r.song_id === after).map((r) => r.album_id));
  const mates = new Set(rows("album_songs").filter((r) => albums.has(r.album_id)).map((r) => r.song_id));
  const t = now();
  const most = Math.max(1, ...pool.map((r) => r.opened || 0));
  const scored = pool.map((row) => {
    let score = 1;
    if (mates.has(row.id)) score += 3;
    score += 2 * ((row.opened || 0) / most);
    const months = Math.max(0, (t - (row.updated_at || t)) / (30 * 86400));
    score += 1.5 / (1 + months);
    score *= 0.5 + Math.random();
    return { score, row };
  }).sort((a, b) => b.score - a.score);
  const best = scored[0].row;
  return { song: decorate([best])[0], why: mates.has(best.id) ? "from the same album" : "from your library" };
}

/** difflib.SequenceMatcher.ratio, near enough: twice the common characters over both lengths. */
function ratio(a: string, b: string) {
  if (!a.length && !b.length) return 1;
  const lcs = (x: string, y: string): number => {
    // longest common substring, recursively on both sides (Ratcliff/Obershelp)
    if (!x || !y) return 0;
    let best = 0, bi = 0, bj = 0;
    const prev = new Array(y.length + 1).fill(0);
    for (let i = 1; i <= x.length; i++) {
      let diag = 0;
      for (let j = 1; j <= y.length; j++) {
        const keep = prev[j];
        prev[j] = x[i - 1] === y[j - 1] ? diag + 1 : 0;
        if (prev[j] > best) { best = prev[j]; bi = i - best; bj = j - best; }
        diag = keep;
      }
    }
    if (!best) return 0;
    return best + lcs(x.slice(0, bi), y.slice(0, bj)) + lcs(x.slice(bi + best), y.slice(bj + best));
  };
  return (2 * lcs(a, b)) / (a.length + b.length);
}

export const routes: Routes = {
  "GET /api/songs": (req) => {
    const term = fold(req.q("q").trim());
    const list = rows("songs").filter((s) => !term || fold(s.title).includes(term));
    return { songs: decorate([...list].sort(ORDERS[req.q("sort", "updated")] || ORDERS.updated)) };
  },
  "POST /api/songs": async (req) => {
    const data = await req.json();
    return { song: decorate([makeSong(need(data, "title"), data.notes || "")])[0] };
  },
  "GET /api/songs/match": (req) => {
    const name = req.q("name").trim();
    if (!name) throw new GuestError("name is required");
    const query = name.replace(/\.[^.]*$/, "");
    const cleaned = query.replace(/[_-]/g, " ").trim().toLowerCase();
    const scored = rows("songs").map((r) => {
      let score = ratio(cleaned, r.title.toLowerCase());
      if (cleaned.includes(r.title.toLowerCase())) score = Math.max(score, 0.9);
      return { score, r };
    }).sort((a, b) => b.score - a.score);
    const best = scored.slice(0, 5).filter((x) => x.score >= 0.45)
      .map((x) => ({ song_id: x.r.id, title: x.r.title, score: Math.round(x.score * 1000) / 1000 }));
    return { query, matches: best, suggest: best[0] && best[0].score >= 0.62 ? best[0] : null };
  },
  "GET /api/songs/most-opened": (req) => {
    const limit = Number(req.q("limit")) || 6;
    const list = rows("songs").filter((s) => (s.opened || 0) > 0)
      .sort((a, b) => b.opened - a.opened || b.updated_at - a.updated_at).slice(0, limit);
    return { songs: decorate(list) };
  },
  "GET /api/songs/up-next": upNext,
  "GET /api/songs/<id>": (req) => {
    const song = getSong(req.params.id);
    update(song, { opened: (song.opened || 0) + 1 });
    return { song: decorate([song])[0] };
  },
  "GET /api/songs/<id>/titles": (req) => {
    const song = getSong(req.params.id);
    const previous = where("song_titles", (t) => t.song_id === song.id)
      .sort((a, b) => b.id - a.id).map((t) => ({ title: t.title, changed_at: t.changed_at }));
    return { current: song.title, previous };
  },
  "PATCH /api/songs/<id>": async (req) => {
    const song = getSong(req.params.id);
    const data = await req.json();
    const patch: Row = {};
    if ("title" in data) {
      patch.title = need(data, "title");
      if (patch.title !== song.title) insert("song_titles", { song_id: song.id, title: song.title, changed_at: now() });
    }
    if ("notes" in data) patch.notes = data.notes || "";
    if ("current_version_id" in data) patch.current_version_id = data.current_version_id;
    patch.updated_at = now();
    update(song, patch);
    return { song: decorate([song])[0] };
  },
  "DELETE /api/songs/<id>": (req) => {
    const song = getSong(req.params.id);
    burySong(song.id);
    // Bytes stay, as on the server: another row may point at them, and keeping an orphaned
    // file beats losing one that was still in use.
    dropSong(song.id);
    return { deleted: song.id, shares_taken_back: 0 };
  },
};

export const summary = () => ({ count: rows("songs").length });
