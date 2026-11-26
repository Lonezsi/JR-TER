/* jriter/modules/search.py and every module's SEARCH, in the browser.
 *
 * The same query language, read by ui/src/lib/query.ts (the twin of jriter/query.py):
 * search text with the longest word, then let every group's hits through the filters.
 */
import { rows, byId, fold, type Row } from "../lib";
import { stem, type Routes } from "../http";
import { decorate } from "./songs";
import { latest } from "./lyrics";
import { parseQuery, queryText, isNarrowed, allows, type SongFacts } from "$lib/query";

const SHOW = 8, MOST = 50, MAX_TERM = 80, MIN_TEXT = 2;

/** finding.rank: 4 the field is the term, 3 starts with it, 2 a word starts with it, 1 inside. */
function rank(term: string, field: unknown) {
  const want = term.toLowerCase(), have = String(field ?? "").toLowerCase();
  if (!want) return 0;
  if (have === want) return 4;
  if (have.startsWith(want)) return 3;
  const at = have.indexOf(want);
  if (at > 0 && !/[\p{L}\p{N}]/u.test(have[at - 1])) return 2;
  return at >= 0 ? 1 : 0;
}

const has = (field: unknown, term: string) => fold(field).includes(fold(term));

function lineAround(text: string, term: string, width = 110) {
  const want = term.toLowerCase();
  for (const raw of String(text || "").split(/\r?\n/)) {
    const at = raw.toLowerCase().indexOf(want);
    if (at < 0) continue;
    const line = raw.trim();
    if (line.length <= width) return line;
    const start = Math.max(0, at - Math.floor(width / 3));
    return (start ? "... " : "") + line.slice(start, start + width).trim() + " ...";
  }
  return "";
}

type Group = { label: string; kind: string; order: number; total: number; hits: Row[]; module: string };
const group = (module: string, label: string, kind: string, order: number, all: Row[], limit: number): Group =>
  ({ module, label, kind, order, total: all.length, hits: all.slice(0, limit) });

const SEARCHES: ((term: string, limit: number) => Group)[] = [
  (term, limit) => {
    const titles = rows("song_titles");
    const found = rows("songs").map((s): Row | null => {
      const was = titles.filter((t) => t.song_id === s.id && has(t.title, term)).sort((a, b) => b.id - a.id)[0]?.title ?? null;
      return has(s.title, term) || was ? { ...s, was, score: rank(term, s.title) } : null;
    }).filter((x): x is Row => !!x).sort((a, b) => b.score - a.score || (b.updated_at || 0) - (a.updated_at || 0));
    const hits = decorate(found.slice(0, limit)).map((h) => ({
      ...h, href: `#/song/${h.id}`, ...(!h.score && h.was ? { sub: `was called ${h.was}` } : {}),
    }));
    return { module: "songs", label: "Songs", kind: "song", order: 10, total: found.length, hits };
  },
  (term, limit) => {
    const found = rows("albums").filter((a) => has(a.title, term) || has(a.notes, term))
      .map((a): Row => ({ ...a, score: rank(term, a.title) }))
      .sort((a, b) => b.score - a.score || (b.year || 0) - (a.year || 0) || fold(a.title).localeCompare(fold(b.title)));
    const g = group("albums", "Albums", "album", 20, found, limit);
    g.hits = g.hits.map((a) => {
      const links = rows("album_songs").filter((l) => l.album_id === a.id);
      const duration = links.reduce((s, l) => {
        const song = byId("songs", l.song_id);
        return s + (song?.current_version_id != null ? byId("versions", song.current_version_id)?.duration || 0 : 0);
      }, 0);
      return { ...a, song_count: links.length, duration: Math.round(duration * 100) / 100, has_cover: !!a.cover_digest, href: `#/album/${a.id}` };
    });
    return g;
  },
  (term, limit) => {
    const found = rows("playlists").filter((p) => p.album_id == null && has(p.title, term))
      .map((p): Row => ({ ...p, score: rank(term, p.title) }))
      .sort((a, b) => b.score - a.score || fold(a.title).localeCompare(fold(b.title)));
    const g = group("playlists", "Playlists", "playlist", 30, found, limit);
    g.hits = g.hits.map((p) => ({ ...p, count: rows("playlist_items").filter((i) => i.playlist_id === p.id).length, href: `#/playlist/${p.id}` }));
    return g;
  },
  (term, limit) => {
    if (term.length < MIN_TEXT) return group("lyrics", "Words", "lyric", 40, [], limit);
    const found: Row[] = [];
    for (const sh of rows("lyric_sheets")) {
      const song = byId("songs", sh.song_id);
      if (!song) continue;
      const text = latest(sh.id)?.text || "";
      if (!has(text, term) && !has(sh.name, term)) continue;
      found.push({ id: sh.id, song_id: sh.song_id, name: sh.name, is_current: sh.is_current, song_title: song.title,
        updated_at: song.updated_at, line: lineAround(text, term), score: rank(term, sh.name) });
    }
    found.sort((a, b) => b.score - a.score || (b.updated_at || 0) - (a.updated_at || 0));
    const g = group("lyrics", "Words", "lyric", 40, found, limit);
    g.hits = g.hits.map((h) => ({ ...h, title: h.song_title, href: `#/song/${h.song_id}` }));
    return g;
  },
  (term, limit) => {
    const found = rows("versions").filter((v) => has(v.label, term) || has(v.filename, term) || has(v.source_path, term))
      .map((v) => {
        const title = byId("songs", v.song_id)?.title ?? "";
        return { id: v.id, song_id: v.song_id, n: v.n, label: v.label, filename: v.filename, duration: v.duration,
          created_at: v.created_at, song_title: title, score: rank(term, v.label || v.filename),
          title: v.label || stem(v.filename) || `v${v.n}`, sub: `v${v.n} of ${title}`, href: `#/song/${v.song_id}` };
      }).sort((a, b) => b.score - a.score || (b.created_at || 0) - (a.created_at || 0));
    return group("versions", "Takes", "version", 50, found, limit);
  },
  (term, limit) => {
    const found = rows("renders").filter((r) => has(r.filename, term) || has(r.source_path, term)).map((r) => {
      const name = stem(r.filename) || "render";
      const songTitle = r.song_id ? byId("songs", r.song_id)?.title ?? null : null;
      return { id: r.id, filename: r.filename, source_path: r.source_path, duration: r.duration, size: r.size,
        used_at: r.used_at, trouble: r.trouble, song_id: r.song_id, song_title: songTitle, created_at: r.created_at,
        name, title: name, waiting: !r.used_at, score: rank(term, name),
        sub: songTitle ? `went to ${songTitle}` : "waiting for a song", href: "#/renders" };
    }).sort((a, b) => b.score - a.score || (b.created_at || 0) - (a.created_at || 0));
    return group("renders", "Renders", "render", 60, found, limit);
  },
  (term, limit) => {
    const found = rows("artwork").filter((a) => has(a.caption, term)).map((a) => {
      const title = byId("songs", a.song_id)?.title ?? "";
      return { id: a.id, song_id: a.song_id, caption: a.caption, created_at: a.created_at, song_title: title,
        score: rank(term, a.caption), title: a.caption, sub: `on ${title}`, href: `#/song/${a.song_id}` };
    }).sort((a, b) => b.score - a.score || (b.created_at || 0) - (a.created_at || 0));
    return group("artwork", "Artwork", "artwork", 70, found, limit);
  },
];

function facts(ids: number[]): Record<number, SongFacts> {
  const out: Record<number, SongFacts> = {};
  for (const id of ids) {
    out[id] = {
      albums: rows("album_songs").filter((l) => l.song_id === id).map((l) => byId("albums", l.album_id)?.title || ""),
      has_words: rows("lyric_sheets").some((s) => s.song_id === id),
      has_art: rows("artwork").some((a) => a.song_id === id),
    };
  }
  return out;
}

export const routes: Routes = {
  "GET /api/search": (req) => {
    const raw = req.q("q").trim().slice(0, MAX_TERM * 3);
    const limit = Math.max(1, Math.min(MOST, Number(req.q("limit")) || SHOW));
    const q = parseQuery(raw);
    const narrowed = isNarrowed(q);
    const term = queryText(q).slice(0, MAX_TERM);
    if (!term && !narrowed) return { query: "", groups: [], looked_in: [] };
    const found = SEARCHES.map((s) => s(term, narrowed ? MOST : limit));
    if (narrowed) {
      for (const g of found) {
        const known = g.kind === "song" ? facts(g.hits.map((h) => h.id)) : {};
        const kept = g.hits.filter((h) => allows(q, g.kind, h, known[h.id]));
        g.total = g.hits.length < MOST ? kept.length : g.total;
        g.hits = kept.slice(0, limit);
      }
    }
    found.sort((a, b) => a.order - b.order || a.label.localeCompare(b.label));
    return { query: raw, groups: found.filter((g) => g.hits.length), looked_in: found.map((g) => g.label) };
  },
};

export const summary = () => ({ categories: SEARCHES.length });
