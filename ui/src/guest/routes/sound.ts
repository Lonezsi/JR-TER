/* jriter/modules/sound.py, arrange.py and vocals.py, in the browser. */
import { rows, byId, insert, update, remove, where, now, type Row } from "../lib";
import { GuestError, need, serve, extOf, stem, type Routes } from "../http";
import { keep, release } from "../files";
import { getSong, touch } from "./songs";
import { buryTake } from "./grave";

// ── sound ────────────────────────────────────────────────────────────────────

const FILTERS = ["peaking", "lowshelf", "highshelf", "lowpass", "highpass", "notch", "bandpass"];
const LIMITER = { on: false, threshold: -6, ceiling: -0.3, release: 120, attack: 5 };
const DEFAULT = { bands: [], limiter: LIMITER, gain: 0, bypass: false };

function clamp(v: unknown, lo: number, hi: number, dflt: number) {
  const n = Number(v);
  if (v === null || v === undefined || v === "" || !Number.isFinite(n)) return dflt;
  return Math.max(lo, Math.min(hi, n));
}

/** sound.normalise, and the rack the Sound tab keeps beside it (kept as it came: every
 *  number in it is clamped by the page's own effects before it is used). */
function normalise(raw: any): Row {
  if (!raw || typeof raw !== "object") raw = {};
  const out: Row = {
    bands: [], limiter: { ...LIMITER },
    gain: clamp(raw.gain ?? 0, -24, 24, 0), bypass: !!raw.bypass,
  };
  for (const band of (Array.isArray(raw.bands) ? raw.bands : []).slice(0, 24)) {
    if (!band || typeof band !== "object") continue;
    out.bands.push({
      id: band.id || `b${out.bands.length + 1}`,
      type: FILTERS.includes(band.type) ? band.type : "peaking",
      freq: clamp(band.freq ?? 1000, 10, 22000, 1000),
      gain: clamp(band.gain ?? 0, -30, 30, 0),
      q: clamp(band.q ?? 1, 0.05, 30, 1),
      on: band.on === undefined ? true : !!band.on,
    });
  }
  const l = raw.limiter;
  if (l && typeof l === "object") {
    out.limiter = {
      on: !!l.on,
      threshold: clamp(l.threshold ?? -6, -60, 0, -6),
      ceiling: clamp(l.ceiling ?? -0.3, -30, 0, -0.3),
      release: clamp(l.release ?? 120, 1, 1000, 120),
      attack: clamp(l.attack ?? 5, 0, 100, 5),
    };
  }
  if (Array.isArray(raw.rack)) out.rack = raw.rack.slice(0, 32);
  if (raw.rack_v !== undefined) out.rack_v = Number(raw.rack_v) || 0;
  return out;
}

const presetOut = (p: Row) => {
  let data: unknown;
  try { data = JSON.parse(p.data || "{}"); } catch { data = DEFAULT; }
  return { ...p, data: normalise(data) };
};

function getPreset(id: unknown): Row {
  const row = byId("sound_presets", id);
  if (!row) throw new GuestError(`no preset with id ${id}`, 404);
  return row;
}

// ── arrange ──────────────────────────────────────────────────────────────────

const blankArrangement = (songId: number) => ({ song_id: songId, version_id: null, bpm: 120, offset: 0,
  per_bar: 4, enabled: 0, parts: [], clips: [], lyrics: {}, updated_at: 0 });

function readArrangement(songId: number) {
  const row = rows("arrangements").find((a) => a.song_id === songId);
  if (!row) return blankArrangement(songId);
  let data: Row = {};
  try { data = JSON.parse(row.data || "{}"); } catch { /* empty */ }
  const { data: _drop, ...rest } = row;
  return { ...rest, parts: data.parts || [], clips: data.clips || [], lyrics: data.lyrics || {} };
}

function num(v: unknown, field: string, lo: number, hi: number, dflt?: number) {
  if (v === null || v === undefined) {
    if (dflt === undefined) throw new GuestError(`${field} is required`);
    return dflt;
  }
  const n = Number(v);
  if (!Number.isFinite(n)) throw new GuestError(`${field} must be a number`);
  if (n < lo || n > hi) throw new GuestError(`${field} must be between ${lo} and ${hi}`);
  return n;
}

function spans(items: unknown, kind: "parts" | "clips", limit: number, known?: Set<string>) {
  if (!Array.isArray(items)) throw new GuestError(`${kind} must be a list`);
  if (items.length > limit) throw new GuestError(`that is more than ${limit} ${kind}`);
  return items.map((item: any, i: number) => {
    if (!item || typeof item !== "object") throw new GuestError(`${kind} ${i + 1} is not an object`);
    const span: Row = {
      id: String(item.id || `${kind[0]}${i + 1}`).slice(0, 40),
      from: num(item.from, `${kind} start`, 0, 1e6, 0),
      beats: num(item.beats, `${kind} length`, 0.001, 1e6, 4),
    };
    if (kind === "parts") {
      span.name = String(item.name || `Part ${i + 1}`).trim().slice(0, 60);
      span.hue = Math.trunc(num(item.hue, "hue", 0, 360, 140));
    } else {
      let part = item.part == null ? null : String(item.part).slice(0, 40);
      if (part !== null && known && !known.has(part)) part = null;
      span.part = part;
    }
    return span;
  });
}

// ── vocals ───────────────────────────────────────────────────────────────────

const VOCAL_EXT = [".webm", ".ogg", ".opus", ".m4a", ".mp4", ".aac", ".mp3", ".wav", ".flac"];
const EFFECTS = ["eq", "limiter", "autotune", "sidechain"];

function getTake(id: unknown): Row {
  const row = byId("vocal_takes", id);
  if (!row) throw new GuestError("No such recording.", 404);
  return row;
}

const takeOut = (t: Row) => {
  let chain: unknown = [];
  try { chain = JSON.parse(t.chain || "[]"); } catch { /* empty */ }
  return { fx: 1, ...t, chain, by: "Guest", by_handle: "", yours: true };
};

export const routes: Routes = {
  "GET /api/songs/<id>/sound": (req) => {
    const song = getSong(req.params.id);
    let list = where("sound_presets", (p) => p.song_id === song.id).sort((a, b) => a.id - b.id);
    if (!list.length) {
      const t = now();
      list = [insert("sound_presets", { song_id: song.id, name: "Current", is_current: 1, data: JSON.stringify(DEFAULT), created_at: t, updated_at: t })];
    }
    return { presets: list.map(presetOut) };
  },
  "POST /api/songs/<id>/sound": async (req) => {
    const song = getSong(req.params.id);
    const data = await req.json();
    const name = need(data, "name");
    let payload = data.data;
    if (payload == null && data.copy_from) {
      const source = getPreset(data.copy_from);
      if (source.song_id !== song.id) throw new GuestError("that preset belongs to another song");
      payload = JSON.parse(source.data || "{}");
    }
    const t = now();
    const p = insert("sound_presets", { song_id: song.id, name, is_current: 0, data: JSON.stringify(normalise(payload || DEFAULT)), created_at: t, updated_at: t });
    return { preset: presetOut(p) };
  },
  "PUT /api/sound/<id>": async (req) => {
    const p = getPreset(req.params.id);
    const body = await req.json();
    update(p, { data: JSON.stringify(normalise("data" in body ? body.data : body)), updated_at: now() });
    touch(p.song_id);
    return { preset: presetOut(p) };
  },
  "PATCH /api/sound/<id>": async (req) => {
    const p = getPreset(req.params.id);
    update(p, { name: need(await req.json(), "name") });
    return { preset: presetOut(p) };
  },
  "POST /api/sound/<id>/current": (req) => {
    const p = getPreset(req.params.id);
    for (const o of rows("sound_presets")) if (o.song_id === p.song_id && o.is_current) update(o, { is_current: 0 });
    update(p, { is_current: 1 });
    return { preset: presetOut(p) };
  },
  "DELETE /api/sound/<id>": (req) => {
    const p = getPreset(req.params.id);
    const rest = where("sound_presets", (o) => o.song_id === p.song_id && o.id !== p.id).sort((a, b) => a.id - b.id);
    if (!rest.length) throw new GuestError("a song keeps at least one preset");
    remove("sound_presets", (o) => o.id !== p.id);
    if (p.is_current) update(rest[0], { is_current: 1 });
    return { deleted: p.id };
  },

  "GET /api/arrangements/shapes": () => {
    const shapes: Row = {};
    for (const row of rows("arrangements").filter((a) => a.enabled)) {
      let data: Row;
      try { data = JSON.parse(row.data || "{}"); } catch { continue; }
      const parts = new Map((data.parts || []).map((p: Row) => [p.id, p]));
      shapes[String(row.song_id)] = (data.clips || []).map((c: Row) => ({
        beats: c.beats || 1, hue: (parts.get(c.part) as Row | undefined)?.hue ?? 210 }));
    }
    return { shapes };
  },
  "GET /api/songs/<id>/arrangement": (req) => ({ arrangement: readArrangement(getSong(req.params.id).id) }),
  "PUT /api/songs/<id>/arrangement": async (req) => {
    const song = getSong(req.params.id);
    const body = await req.json();
    const bpm = num(body.bpm, "bpm", 20, 400, 120);
    const offset = num(body.offset, "offset", -60, 600, 0);
    const per_bar = Math.trunc(num(body.per_bar, "beats in a bar", 1, 16, 4));
    const parts = spans(body.parts || [], "parts", 64);
    const known = new Set(parts.map((p) => String(p.id)));
    const clips = spans(body.clips || [], "clips", 512, known);
    const links = body.lyrics || {};
    if (typeof links !== "object" || Array.isArray(links)) throw new GuestError("lyrics links must be an object");
    const lyrics: Row = {};
    for (const [part, sheet] of Object.entries(links)) {
      if (known.has(String(part)) && sheet != null) {
        const n = Number(sheet);
        if (!Number.isInteger(n)) throw new GuestError("a lyrics link must be a sheet id");
        lyrics[String(part)] = n;
      }
    }
    const row = { song_id: song.id, version_id: body.version_id ?? null, bpm, offset, per_bar,
      enabled: body.enabled ? 1 : 0, data: JSON.stringify({ parts, clips, lyrics }), updated_at: now() };
    const there = rows("arrangements").find((a) => a.song_id === song.id);
    if (there) update(there, row); else insert("arrangements", row);
    return { arrangement: readArrangement(song.id) };
  },
  "POST /api/songs/<id>/arrangement/enabled": async (req) => {
    const song = getSong(req.params.id);
    const on = [true, 1, "1", "true"].includes(need(await req.json(), "on") as any) ? 1 : 0;
    const there = rows("arrangements").find((a) => a.song_id === song.id);
    if (!there) throw new GuestError("that song has no arrangement yet", 404);
    update(there, { enabled: on, updated_at: now() });
    return { arrangement: readArrangement(song.id) };
  },
  "DELETE /api/songs/<id>/arrangement": (req) => {
    const song = getSong(req.params.id);
    remove("arrangements", (a) => a.song_id !== song.id);
    return { arrangement: blankArrangement(song.id) };
  },

  "GET /api/songs/<id>/vocals": (req) => {
    const song = getSong(req.params.id);
    return { takes: where("vocal_takes", (t) => t.song_id === song.id).sort((a, b) => a.id - b.id).map(takeOut) };
  },
  "POST /api/songs/<id>/vocals": async (req) => {
    const song = getSong(req.params.id);
    const name = req.filename("take.webm");
    const ext = extOf(name);
    if (!VOCAL_EXT.includes(ext)) throw new GuestError(`${ext || name} is not a recording JR!TER can keep`);
    const offset = Math.max(0, Number(req.header("X-Offset")) || 0);
    const duration = Math.max(0, Number(req.header("X-Duration")) || 0);
    const { digest, size } = await keep(await req.raw.blob(), ext);
    const t = now();
    const take = insert("vocal_takes", {
      song_id: song.id, author: 0, name: (req.header("X-Label").trim() || stem(name)).slice(0, 80),
      digest, ext, size, duration, offset, enabled: 1, gain: 1, chain: "[]", fx: 1, created_at: t, updated_at: t,
    });
    touch(song.id);
    return { take: takeOut(take) };
  },
  "PATCH /api/vocals/<id>": async (req) => {
    const take = getTake(req.params.id);
    const body = await req.json();
    const f: Row = {};
    if ("name" in body) f.name = String(body.name || "").trim().slice(0, 80);
    if ("enabled" in body) f.enabled = body.enabled ? 1 : 0;
    if ("gain" in body) f.gain = Math.min(4, Math.max(0, Number(body.gain) || 0));
    if ("offset" in body) f.offset = Math.max(0, Number(body.offset) || 0);
    if ("fx" in body) f.fx = body.fx ? 1 : 0;
    if ("chain" in body) {
      const chain = body.chain;
      if (!Array.isArray(chain) || chain.length > 16) throw new GuestError("chain is a list of at most sixteen effects");
      if (!chain.every((e: any) => e && typeof e === "object" && EFFECTS.includes(e.type))) {
        throw new GuestError("an effect is one of: " + EFFECTS.join(", "));
      }
      f.chain = JSON.stringify(chain);
    }
    if (Object.keys(f).length) update(take, { ...f, updated_at: now() });
    return { take: takeOut(take) };
  },
  "DELETE /api/vocals/<id>": async (req) => {
    const take = getTake(req.params.id);
    buryTake(take.id);
    remove("vocal_takes", (t) => t.id !== take.id);
    await release(take.digest);
    return { deleted: take.id };
  },
  "GET /api/vocals/<id>/audio": (req) => {
    const take = getTake(req.params.id);
    const safe = (String(take.name || "voice").replace(/[^\w -]/g, "").trim() || "voice") + take.ext;
    return serve(req, take.digest, take.ext, req.q("download") ? safe : undefined);
  },
};

export const summary = {
  sound: () => ({ presets: rows("sound_presets").length }),
  arrange: () => ({ count: rows("arrangements").length, on: rows("arrangements").filter((a) => a.enabled).length }),
  vocals: () => ({}),
};
