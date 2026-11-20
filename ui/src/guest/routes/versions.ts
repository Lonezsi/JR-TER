/* jriter/modules/versions.py and renders.py, in the browser: the takes of a song, and the
 * Inbox of renders that have no song yet. */
import { rows, byId, insert, update, remove, where, now, persist, type Row } from "../lib";
import { GuestError, need, serve, extOf, stem, AUDIO_EXT, type Req, type Routes } from "../http";
import { keep, release, analyse, type Shape } from "../files";
import { getSong, touch, makeSong } from "./songs";
import { buryVersion, buryRender } from "./grave";

/** Peaks as numbers, the way list_versions and renders._decorate hand them over. */
export const withShape = (row: Row): Row => {
  const { peaks, ...rest } = row;
  return { ...rest, shape: String(peaks || "").split(",").filter((n) => /^\d+$/.test(n)).map(Number) };
};

function getVersion(id: unknown): Row {
  const row = byId("versions", id);
  if (!row) throw new GuestError(`no version with id ${id}`, 404);
  return row;
}

function getRender(id: unknown): Row {
  const row = byId("renders", id);
  if (!row) throw new GuestError(`no render with id ${id}`, 404);
  return row;
}

/** The shape fields of a row, from a page's answer, or left to the next examine. */
const shapeFields = (shape: Shape | null): Row => shape
  ? { peaks: shape.peaks, peak_db: shape.peak_db, trouble: shape.trouble }
  : { peaks: "", peak_db: null, trouble: "" };

export function addStored(songId: number, digest: string, ext: string, size: number, extra: Row,
                          shape: Row | null): [Row, boolean] {
  const same = rows("versions").find((v) => v.song_id === songId && v.digest === digest);
  if (same) return [same, true];
  const n = rows("versions").filter((v) => v.song_id === songId).reduce((m, v) => Math.max(m, v.n), 0) + 1;
  const version = insert("versions", {
    song_id: songId, n, digest, ext, size, duration: extra.duration || 0, bitrate: 0,
    label: extra.label || "", filename: extra.filename || "", source_path: extra.source_path || "",
    created_at: now(), project_at: extra.project_at || 0, rendered_at: extra.rendered_at || 0,
    ...(shape || { peaks: "", peak_db: null, trouble: "" }),
  });
  update(getSong(songId), { current_version_id: version.id, updated_at: now() });
  return [version, false];
}

/** The page's own measure of a file, or the shape another row with the same bytes has. */
async function lookAt(req: Req, digest: string, ext: string): Promise<Shape | null> {
  const known = [...rows("versions"), ...rows("renders")].find((r) => r.digest === digest && (r.peaks || r.trouble));
  if (known) return { peaks: known.peaks, peak_db: known.peak_db, trouble: known.trouble, duration: known.duration };
  return analyse(req.clientId, digest, ext);
}

function decorateRenders(list: Row[]): Row[] {
  const titles = new Map(rows("songs").map((s) => [s.id, s.title]));
  return list.map((r) => ({
    ...withShape(r),
    song_title: titles.get(r.song_id) ?? null,
    name: stem(r.filename) || "render",
    waiting: !r.used_at,
  }));
}

function stamp(req: Req, name: string) {
  const v = Number(req.header(name));
  return Number.isFinite(v) && v > 631152000 && v < now() + 86400 ? v : 0;
}

async function examine(table: "versions" | "renders", req: Req) {
  const limit = Math.max(1, Math.min(200, Number(req.q("limit")) || 60));
  const todo = rows(table).filter((r) => !r.peaks && !r.trouble).slice(0, limit);
  let looked = 0, found = 0;
  for (const row of todo) {
    const shape = await analyse(req.clientId, row.digest, row.ext);
    const patch: Row = shape ? shapeFields(shape) : { trouble: "not looked at" };
    if (shape && !shape.peaks && !shape.trouble) patch.trouble = "not looked at";
    if (shape?.duration && !row.duration) patch.duration = shape.duration;
    update(row, patch);
    looked++;
    if (patch.trouble === "silent" || patch.trouble === "unreadable") found++;
    await persist();
  }
  const left = rows(table).filter((r) => !r.peaks && !r.trouble).length;
  return { looked_at: looked, trouble: found, left };
}

export const routes: Routes = {
  // ── versions ──
  "GET /api/songs/<id>/versions": (req) => {
    const song = getSong(req.params.id);
    const list = where("versions", (v) => v.song_id === song.id).sort((a, b) => b.n - a.n).map(withShape);
    return { versions: list, current_version_id: song.current_version_id ?? null };
  },
  "POST /api/songs/<id>/versions": async (req) => {
    const song = getSong(req.params.id);
    const filename = req.filename("render.mp3");
    const ext = extOf(filename);
    if (!AUDIO_EXT.includes(ext)) throw new GuestError(`${ext || filename} is not an audio file JR!TER handles`);
    const { digest, size } = await keep(await req.raw.blob(), ext);
    const same = rows("versions").find((v) => v.song_id === song.id && v.digest === digest);
    if (same) return { version: same, duplicate: true, message: `That is byte for byte v${same.n}, so nothing was added.` };
    const shape = await lookAt(req, digest, ext);
    const duration = shape?.duration || Number(req.header("X-Duration")) || 0;
    const [version] = addStored(song.id, digest, ext, size, {
      duration, filename, label: req.header("X-Label").trim(), source_path: req.header("X-Source-Path").trim(),
    }, shape ? shapeFields(shape) : null);
    return { version, duplicate: false };
  },
  "GET /api/versions/have": (req) => {
    const digests = req.q("digest").split(",").filter(Boolean);
    if (!digests.length) throw new GuestError("digest is required");
    const have: Row = {};
    for (const d of digests) {
      const v = rows("versions").find((x) => x.digest === d);
      have[d] = v ? { digest: d, id: v.id, n: v.n, song_id: v.song_id, title: byId("songs", v.song_id)?.title } : null;
    }
    return { have };
  },
  "POST /api/versions/examine": (req) => examine("versions", req),
  "PATCH /api/versions/<id>": async (req) => {
    const version = getVersion(req.params.id);
    const data = await req.json();
    const patch: Row = {};
    if ("label" in data) patch.label = String(data.label || "").trim();
    if ("duration" in data) {
      const d = Number(data.duration);
      if (!Number.isFinite(d)) throw new GuestError("duration must be a number");
      patch.duration = Math.max(0, d);
    }
    update(version, patch);
    touch(version.song_id);
    return { version };
  },
  "POST /api/versions/<id>/current": (req) => {
    const version = getVersion(req.params.id);
    update(getSong(version.song_id), { current_version_id: version.id, updated_at: now() });
    return { song_id: version.song_id, current_version_id: version.id };
  },
  "DELETE /api/versions/<id>": async (req) => {
    const version = getVersion(req.params.id);
    buryVersion(version.id);
    remove("versions", (v) => v.id !== version.id);
    const song = byId("songs", version.song_id);
    if (song) {
      if (song.current_version_id === version.id) {
        const newest = where("versions", (v) => v.song_id === song.id).sort((a, b) => b.n - a.n)[0];
        update(song, { current_version_id: newest?.id ?? null });
      }
      touch(song.id);
    }
    await release(version.digest);
    return { deleted: version.id };
  },
  "GET /api/versions/<id>/audio": (req) => {
    const v = getVersion(req.params.id);
    return serve(req, v.digest, v.ext);
  },
  "GET /api/versions/<id>/download": (req) => {
    const v = getVersion(req.params.id);
    return serve(req, v.digest, v.ext, v.filename || `v${v.n}${v.ext}`);
  },

  // ── renders ──
  "GET /api/renders": (req) => {
    const all = rows("renders").slice().sort((a, b) => b.created_at - a.created_at);
    const list = req.q("all") ? all : all.filter((r) => !r.used_at);
    return { renders: decorateRenders(list), waiting: all.filter((r) => !r.used_at).length };
  },
  "POST /api/renders": async (req) => {
    const filename = req.filename("render.wav");
    const ext = extOf(filename);
    if (!AUDIO_EXT.includes(ext)) throw new GuestError(`${ext || filename} is not an audio file JR!TER handles`);
    const { digest, size } = await keep(await req.raw.blob(), ext);
    const projectAt = stamp(req, "X-Project-At"), renderedAt = stamp(req, "X-Rendered-At");
    const existing = rows("renders").find((r) => r.digest === digest);
    if (existing) {
      const learned: Row = {};
      if (projectAt && !existing.project_at) learned.project_at = projectAt;
      if (renderedAt && !existing.rendered_at) learned.rendered_at = renderedAt;
      update(existing, learned);
      return { render: decorateRenders([existing])[0], added: false };
    }
    const shape = await lookAt(req, digest, ext);
    const row = insert("renders", {
      digest, ext, size, duration: shape?.duration || 0, bitrate: 0, filename,
      source_path: req.header("X-Source-Path").trim(), origin: req.header("X-Origin").trim() || "upload",
      created_at: now(), used_at: 0, project_at: projectAt, rendered_at: renderedAt,
      ...shapeFields(shape), song_id: null, version_id: null,
    });
    return { render: decorateRenders([row])[0], added: true };
  },
  "POST /api/renders/ingest": () => {
    throw new GuestError("Taking files in from a folder needs the desktop app. Upload them instead.", 403);
  },
  "POST /api/renders/examine": (req) => examine("renders", req),
  "POST /api/renders/clear": () => {
    const used = rows("renders").filter((r) => r.used_at);
    remove("renders", (r) => !r.used_at);
    remove("playlist_items", (i) => !used.some((r) => r.id === i.render_id));
    return { cleared: used.length };
  },
  "GET /api/renders/<id>/audio": (req) => {
    const r = getRender(req.params.id);
    return serve(req, r.digest, r.ext);
  },
  "POST /api/renders/<id>/attach": async (req) => {
    const render = getRender(req.params.id);
    const data = await req.json();
    const song = data.song_id ? getSong(data.song_id)
      : makeSong(String(data.title || "").trim() || stem(render.filename) || "Untitled");
    const [version, already] = addStored(song.id, render.digest, render.ext, render.size, {
      duration: render.duration, filename: render.filename, source_path: render.source_path,
      project_at: render.project_at, rendered_at: render.rendered_at,
    }, { peaks: render.peaks || "", peak_db: render.peak_db ?? null, trouble: render.trouble || "" });
    update(render, { used_at: now(), song_id: song.id, version_id: version.id });
    return { render: decorateRenders([render])[0], song: { ...song }, version, already_there: already };
  },
  "POST /api/renders/<id>/unattach": (req) => {
    const render = getRender(req.params.id);
    update(render, { used_at: 0, song_id: null, version_id: null });
    return { render: decorateRenders([render])[0] };
  },
  "PATCH /api/renders/<id>": async (req) => {
    const render = getRender(req.params.id);
    const name = need(await req.json(), "name");
    update(render, { filename: name + (render.ext || extOf(render.filename)) });
    return { render: decorateRenders([render])[0] };
  },
  "DELETE /api/renders/<id>": async (req) => {
    const render = getRender(req.params.id);
    buryRender(render.id);
    remove("renders", (r) => r.id !== render.id);
    remove("playlist_items", (i) => i.render_id !== render.id);
    await release(render.digest);
    return { dismissed: render.id };
  },
};

export const summary = {
  versions: () => {
    const v = rows("versions");
    return { count: v.length, bytes: v.reduce((s, r) => s + (r.size || 0), 0),
             distinct_files: new Set(v.map((r) => r.digest)).size };
  },
  renders: () => ({ waiting: rows("renders").filter((r) => !r.used_at).length, count: rows("renders").length }),
};
