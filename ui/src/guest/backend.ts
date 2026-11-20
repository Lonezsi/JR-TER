/* The guest backend: every /api/* the screens call, answered from this browser.
 *
 * The routes are the server's, module by module, with the server's reply shapes. What a
 * browser on its own cannot do (YouTube, watched folders, the desktop agent, sharing, the
 * timetable, updates, accounts) is not here at all, and /api/state leaves those modules
 * out, so their screens and buttons hide themselves the way they do when a module is
 * switched off on a server. Anything asked of them anyway gets a plain 404 saying so.
 */
import { load, persist, settings, current, insert, replaceAll, blank, DEFAULTS, rows, now, touchDirty, type Row } from "./lib";
import { GuestError, Req, compile, json, AUDIO_EXT, type Routes } from "./http";
import { blobSizes, wipe } from "./store";
import { writeLibrary, readLibrary } from "./format";
import * as songs from "./routes/songs";
import * as versions from "./routes/versions";
import * as lyrics from "./routes/lyrics";
import * as albums from "./routes/albums";
import * as sound from "./routes/sound";
import * as search from "./routes/search";
import * as grave from "./routes/grave";

declare const __JRITER_VERSION__: string;
const VERSION = typeof __JRITER_VERSION__ === "string" ? __JRITER_VERSION__ : "";

/** What a guest library has, as module names: the server's names, so has() just works. */
export const MODULES = ["core", "songs", "versions", "artwork", "lyrics", "albums", "sound", "arrange",
  "renders", "playlists", "search", "export", "vocals", "grave"];

const STARTED = now();

export const NOT_HERE = "That needs an account. A guest library lives in this browser only, so it can't do that one.";

function checkSettings(patch: Row): Row {
  const unknown = Object.keys(patch).filter((k) => !(k in DEFAULTS));
  if (unknown.length) throw new GuestError("not a setting: " + unknown.sort().join(", "));
  if ("pinned" in patch) {
    const p = patch.pinned;
    if (!Array.isArray(p) || p.length > 100 || !p.every((x) => x && ["song", "album", "playlist", "render"].includes(x.kind) && Number.isInteger(x.id))) {
      throw new GuestError("pinned takes up to 100 {kind, id} entries");
    }
    patch.pinned = p.map((x: Row) => ({ kind: x.kind, id: x.id }));
  }
  if ("lyrics_view" in patch) {
    const v = patch.lyrics_view;
    const keys = Object.keys(DEFAULTS.lyrics_view);
    if (!v || typeof v !== "object" || Object.keys(v).some((k) => !keys.includes(k)) || !Object.values(v).every((x) => typeof x === "boolean")) {
      throw new GuestError("lyrics_view takes " + keys.sort().join(", ") + ", each true or false");
    }
    patch.lyrics_view = { ...DEFAULTS.lyrics_view, ...v };
  }
  if ("effect_presets" in patch && (typeof patch.effect_presets !== "object" || Array.isArray(patch.effect_presets))) {
    throw new GuestError("effect presets must be an object");
  }
  return patch;
}

async function storage() {
  const sizes = await blobSizes();
  return { bytes: sizes.reduce((s, b) => s + b.size, 0), files: sizes.length };
}

const fileDay = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

const core: Routes = {
  "GET /api/state": async () => {
    const s = settings();
    return {
      name: s.library_name, version: VERSION, modules: MODULES, failed: {},
      summary: {
        // Not "auth" in modules: there is no door, password or device here. The summary is
        // what says who this is, and is_owner false keeps the machine's own screens away.
        auth: { guest: true, is_owner: false, protected: false, who: { id: 0, handle: "", name: "Guest" } },
        songs: songs.summary(), versions: versions.summary.versions(), renders: versions.summary.renders(),
        lyrics: lyrics.summary(), sound: sound.summary.sound(), arrange: sound.summary.arrange(),
        artwork: albums.summary.artwork(), albums: albums.summary.albums(), playlists: albums.summary.playlists(),
        search: search.summary(), export: { tables: 14 }, vocals: {}, grave: grave.summary(),
      },
      settings: s, storage: await storage(), audio: AUDIO_EXT, started: STARTED,
      uptime: Math.round((now() - STARTED) * 10) / 10, guest: true,
    };
  },
  "GET /api/settings": () => settings(),
  "GET /api/settings/defaults": () => ({ defaults: { ...DEFAULTS } }),
  "PUT /api/settings": async (req) => {
    const patch = checkSettings(await req.json());
    Object.assign(current().settings, patch);
    touchDirty();
    return settings();
  },

  "GET /api/export": async () => {
    const zip = await writeLibrary(current(), settings());
    return new Response(zip, { headers: {
      "Content-Type": "application/zip", "Cache-Control": "no-store",
      "Content-Disposition": `attachment; filename="jriter-guest-${fileDay()}.zip"`,
    } });
  },
  "POST /api/import": async (req) => {
    const file = await req.raw.blob();
    if (!file.size) throw new GuestError("no file in that upload");
    try {
      return await readLibrary(file, current(), insert);
    } catch (e) {
      if (e instanceof GuestError) throw e;
      throw new GuestError((e as Error).message || "That file could not be read.");
    }
  },
  "GET /api/export/erase": async () => {
    const s = await storage();
    const counted = rows("songs").length;
    return { library: settings().library_name, goes: [
      { path: "This browser's guest library", bytes: 0, how: `${counted} song${counted === 1 ? "" : "s"} and every word, album and playlist` },
      { path: "Its audio and pictures", bytes: s.bytes, how: `${s.files} file${s.files === 1 ? "" : "s"}, kept in this browser` },
    ] };
  },
  "POST /api/export/erase": async (req) => {
    const said = String((await req.json()).confirm || "").trim();
    const want = settings().library_name;
    if (said !== want) throw new GuestError(`Type the library's name, ${want}, to erase it.`);
    await wipe();
    replaceAll(blank());
    return { gone: ["every song, render and word in this browser's guest library"], left: [] };
  },
};

const route = compile([core, songs.routes, versions.routes, lyrics.routes, albums.routes, sound.routes, search.routes, grave.routes]);

/** Answer one request. Never a 401: the page treats that as "go to the door". */
export async function handle(request: Request, clientId: string): Promise<Response> {
  const url = new URL(request.url);
  const method = request.method === "HEAD" ? "GET" : request.method;
  try {
    await load();
    const found = route(method, url.pathname);
    if (!found) return json({ error: NOT_HERE, path: url.pathname, guest: true }, 404);
    const [fn, params] = found;
    let result: unknown;
    try {
      result = await fn(new Req(request, params, url.searchParams, clientId));
    } finally {
      await persist();
    }
    if (result instanceof Response) return result;
    return json(result ?? { ok: true });
  } catch (e) {
    if (e instanceof GuestError) return json({ error: e.message }, e.status);
    const err = e as Error;
    const full = err?.name === "QuotaExceededError" || /quota/i.test(err?.message || "");
    return json({ error: full ? "This browser is out of room for the guest library. Take a copy, or make an account to keep going."
      : `${err?.name || "Error"}: ${err?.message || e}` }, full ? 507 : 500);
  }
}
