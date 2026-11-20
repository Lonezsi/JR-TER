/* The search language, in the browser: the twin of jriter/query.py, for the guest library
 * (which has no server to ask). The two must read every query the same way;
 * tests/test_query.py runs both on the same cases.
 *
 *   night                 plain words, all of them somewhere in the thing
 *   "two words"           together, in that order
 *   -word                 not this
 *   is:song               only songs (album, playlist, render, lyric, artwork)
 *   album:"First Light"   songs on that album (part of the name is enough)
 *   has:words             songs with lyrics (renders, art, notes)
 *   renders:>3            more than three renders (<, >, <=, >=, =)
 *   length:<3:30          shorter than 3:30 (seconds or m:ss)
 *   touched:<7d           changed in the last 7 days (d, w, m, y)
 *   made:>2026-01         started after January 2026
 *
 *   parseQuery(text) -> Query
 *   queryText(q)     -> the one term to search text with (the longest word)
 *   isNarrowed(q)
 *   allows(q, kind, hit, facts?) -> boolean
 */
export type Kind = "song" | "album" | "playlist" | "render" | "lyric" | "artwork";
export type Filter = [key: string, op: string, value: string, negated: boolean];
export interface Query { words: string[]; nots: string[]; kinds: Set<Kind>; filters: Filter[] }
export interface SongFacts { albums?: string[]; has_words?: boolean; has_art?: boolean }

const KINDS = new Set(["song", "album", "playlist", "render", "lyric", "artwork"]);
const KIND_ALIASES: Record<string, string> = {
  songs: "song", albums: "album", playlists: "playlist", renders: "render",
  words: "lyric", lyrics: "lyric", art: "artwork", pictures: "artwork",
};
const KEYS = new Set(["is", "album", "has", "renders", "length", "touched", "made"]);
const TOKEN = /(-?)(?:(\w+):)?("([^"]*)"|\S+)/g;
const CMP = /^(>=|<=|>|<|=)?(.+)$/;

export function parseQuery(text: string): Query {
  const q: Query = { words: [], nots: [], kinds: new Set(), filters: [] };
  for (const m of (text || "").trim().matchAll(TOKEN)) {
    const neg = m[1] === "-", key = (m[2] || "").toLowerCase(), raw = m[3], quoted = m[4];
    const value = quoted !== undefined ? quoted : raw;
    if (key && KEYS.has(key)) {
      if (key === "is") {
        const kind = KIND_ALIASES[value.toLowerCase()] ?? value.toLowerCase();
        if (KINDS.has(kind)) q.kinds.add(kind as Kind);
        continue;
      }
      const [op, val] = key === "album" || key === "has" ? ["=", value] : (() => { const c = CMP.exec(value)!; return [c[1] || "=", c[2]]; })();
      q.filters.push([key, op || "=", val, neg]);
      continue;
    }
    const word = key ? `${key}:${value}` : value;
    if (!word) continue;
    (neg ? q.nots : q.words).push(word);
  }
  return q;
}

export const queryText = (q: Query) => q.words.reduce((a, b) => (b.length > a.length ? b : a), "");
export const isNarrowed = (q: Query) => q.kinds.size > 0 || q.filters.length > 0 || q.nots.length > 0 || q.words.length > 1;

const num = (op: string, have: number | null | undefined, want: number) => {
  if (have == null) return false;
  return op === "=" ? have === want : op === ">" ? have > want : op === "<" ? have < want : op === ">=" ? have >= want : have <= want;
};
export const seconds = (v: string) => (v.includes(":") ? Number(v.split(":")[0]) * 60 + Number(v.split(":")[1]) : Number(v));
const RELATIVE = /^(\d+)([dwmy])$/;
export function when(v: string, now = Date.now() / 1000): number {
  const r = RELATIVE.exec(v);
  if (r) return now - Number(r[1]) * { d: 86400, w: 7 * 86400, m: 30 * 86400, y: 365 * 86400 }[r[2] as "d"];
  const [y, mo = 1, d = 1] = v.split("-").map(Number);
  return new Date(y, mo - 1, d).getTime() / 1000;
}

function check(f: Filter, kind: string, hit: Record<string, any>, facts?: SongFacts): boolean | null {
  let [key, op, value] = f;
  if (key === "renders") return kind !== "song" ? null : num(op, hit.version_count ?? hit.versions ?? 0, Number(value));
  if (key === "length") {
    const have = hit.duration;
    if (have == null && kind !== "song" && kind !== "render") return null;
    return num(op, have, seconds(value));
  }
  if (key === "touched" || key === "made") {
    const have = hit[key === "touched" ? "updated_at" : "created_at"];
    if (have == null) return null;
    const moment = when(value);
    if (RELATIVE.test(value)) op = ({ "<": ">", ">": "<", "<=": ">=", ">=": "<=" } as Record<string, string>)[op] ?? op;
    if (op === "=") return have >= moment && have < moment + 86400 * (value.split("-").length === 2 ? 31 : 1);
    return num(op, have, moment);
  }
  if (key === "album") {
    if (kind !== "song" || !facts?.albums) return null;
    return facts.albums.some((a) => a.toLowerCase().includes(value.toLowerCase()));
  }
  if (key === "has") {
    if (kind !== "song") return null;
    const what = value.toLowerCase();
    if (what === "renders" || what === "audio") return !!(hit.version_count || hit.versions);
    if (what === "notes") return !!String(hit.notes || "").trim();
    if (what === "words" || what === "lyrics") return !!facts?.has_words;
    if (what === "art" || what === "artwork" || what === "cover") return !!facts?.has_art;
  }
  return null;
}

/** Whether one hit survives the query's filters and extra words. */
export function allows(q: Query, kind0: string, hit: Record<string, any>, facts?: SongFacts): boolean {
  const kind = KIND_ALIASES[kind0] ?? kind0;
  if (q.kinds.size && !q.kinds.has(kind as Kind)) return false;
  const hay = ["title", "sub", "line", "text", "name"].map((k) => String(hit[k] ?? "")).join(" ").toLowerCase();
  const main = queryText(q);
  if (!q.words.filter((w) => w !== main).every((w) => hay.includes(w.toLowerCase()))) return false;
  if (q.nots.some((n) => hay.includes(n.toLowerCase()))) return false;
  for (const f of q.filters) {
    const ok = check(f, kind, hit, facts) ?? false;
    if (ok === f[3]) return false;
  }
  return true;
}
