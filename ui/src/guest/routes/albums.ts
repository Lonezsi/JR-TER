/* jriter/modules/artwork.py, albums.py and playlists.py, in the browser. */
import { rows, byId, insert, update, remove, where, now, fold, type Row } from "../lib";
import { GuestError, need, asInt, serve, extOf, IMAGE_EXT, type Req, type Routes } from "../http";
import { keep, release } from "../files";
import { getSong, touch, decorate } from "./songs";
import { buryImage, buryAlbum, buryPlaylist } from "./grave";

// ── artwork ──────────────────────────────────────────────────────────────────

const songArt = (songId: number) =>
  where("artwork", (a) => a.song_id === songId).sort((a, b) => a.position - b.position || a.id - b.id);

async function takeImage(req: Req) {
  const filename = req.filename("cover.jpg");
  const ext = extOf(filename);
  if (!IMAGE_EXT.includes(ext)) throw new GuestError(`${ext || filename} is not an image JR!TER handles`);
  return { ext, ...(await keep(await req.raw.blob(), ext)) };
}

// ── albums ───────────────────────────────────────────────────────────────────

function getAlbum(id: unknown): Row {
  const row = byId("albums", id);
  if (!row) throw new GuestError(`no album with id ${id}`, 404);
  return row;
}

function counts(albumId: number) {
  const links = where("album_songs", (l) => l.album_id === albumId);
  let total = 0;
  for (const l of links) {
    const song = byId("songs", l.song_id);
    const v = song?.current_version_id != null ? byId("versions", song.current_version_id) : null;
    total += v?.duration || 0;
  }
  return { song_count: links.length, duration: Math.round(total * 100) / 100 };
}

const albumOut = (a: Row) => ({ stickers: "", ...a, ...counts(a.id), has_cover: !!a.cover_digest });

const year = (v: unknown) => (v === null || v === undefined || v === "" ? null : asInt(v, "year"));

function albumRead(album: Row) {
  forAlbum(album.id, album.title);
  const list = where("album_songs", (l) => l.album_id === album.id)
    .map((l) => ({ link: l, song: byId("songs", l.song_id) })).filter((x) => x.song)
    .sort((a, b) => a.link.position - b.link.position || fold(a.song!.title).localeCompare(fold(b.song!.title)))
    .map((x) => ({ ...x.song!, position: x.link.position }));
  return { album: albumOut(album), songs: decorate(list) };
}

// ── playlists ────────────────────────────────────────────────────────────────

const MAX_ITEMS = 2000;

function getPlaylist(id: unknown): Row {
  const row = byId("playlists", id);
  if (!row) throw new GuestError(`no playlist with id ${id}`, 404);
  return row;
}

function items(playlistId: number) {
  const out: Row[] = [];
  for (const row of where("playlist_items", (i) => i.playlist_id === playlistId).sort((a, b) => a.position - b.position || a.id - b.id)) {
    if (row.song_id) {
      const song = byId("songs", row.song_id);
      if (!song) continue;
      const version_count = where("versions", (v) => v.song_id === song.id).length;
      out.push({ item_id: row.id, position: row.position, kind: "song", song: decorate([{ ...song, version_count }])[0], title: song.title });
    } else if (row.render_id) {
      const render = byId("renders", row.render_id);
      if (!render) continue;
      const name = String(render.filename || "").replace(/\.[^.]*$/, "") || "render";
      out.push({ item_id: row.id, position: row.position, kind: "render", render: { ...render, name }, title: name });
    }
  }
  return out;
}

function readPlaylist(p: Row) {
  const list = items(p.id);
  return { ...p, items: list, count: list.length };
}

const nextPosition = (playlistId: number) =>
  where("playlist_items", (i) => i.playlist_id === playlistId).reduce((m, i) => Math.max(m, i.position), 0) + 1;

const countOf = (playlistId: number) => where("playlist_items", (i) => i.playlist_id === playlistId).length;

export function forAlbum(albumId: number, title?: string): Row | null {
  const there = rows("playlists").find((p) => p.album_id === albumId);
  if (there) return there;
  const album = byId("albums", albumId);
  if (!album) return null;
  const t = now();
  const made = insert("playlists", { title: title || album.title, album_id: albumId, created_at: t, updated_at: t });
  for (const link of where("album_songs", (l) => l.album_id === albumId).sort((a, b) => a.position - b.position || a.song_id - b.song_id)) {
    insert("playlist_items", { playlist_id: made.id, position: nextPosition(made.id), song_id: link.song_id, render_id: null, added_at: t });
  }
  return made;
}

/** ORDER BY album_id IS NULL DESC, title: your own lists first. */
const playlistOrder = (a: Row, b: Row) =>
  (Number(b.album_id == null) - Number(a.album_id == null)) || String(a.title).localeCompare(String(b.title));

export const routes: Routes = {
  // artwork
  "GET /api/songs/<id>/artwork": (req) => ({ artwork: songArt(getSong(req.params.id).id) }),
  "POST /api/songs/<id>/artwork": async (req) => {
    const song = getSong(req.params.id);
    const { digest, ext } = await takeImage(req);
    const same = rows("artwork").find((a) => a.song_id === song.id && a.digest === digest);
    if (same) return { image: same, duplicate: true };
    const top = songArt(song.id).reduce((m, a) => Math.max(m, a.position), -1);
    const image = insert("artwork", { song_id: song.id, digest, ext, position: top + 1, caption: req.header("X-Caption").trim(), created_at: now() });
    touch(song.id);
    return { image, duplicate: false };
  },
  "POST /api/songs/<id>/artwork/order": async (req) => {
    const song = getSong(req.params.id);
    const order = (await req.json()).order;
    if (!Array.isArray(order) || !order.length) throw new GuestError("order must be a list of image ids");
    const owned = new Set(songArt(song.id).map((a) => a.id));
    const unknown = order.filter((i) => !owned.has(i));
    if (unknown.length) throw new GuestError(`those images are not on this song: [${unknown.join(", ")}]`);
    order.forEach((id: number, position: number) => update(byId("artwork", id)!, { position }));
    touch(song.id);
    return { artwork: songArt(song.id) };
  },
  "DELETE /api/artwork/<id>": async (req) => {
    const image = byId("artwork", req.params.id);
    if (!image) throw new GuestError(`no image with id ${req.params.id}`, 404);
    buryImage(image.id);
    remove("artwork", (a) => a.id !== image.id);
    await release(image.digest);
    return { deleted: image.id };
  },
  "GET /api/artwork/<id>/image": (req) => {
    const image = byId("artwork", req.params.id);
    if (!image) throw new GuestError(`no image with id ${req.params.id}`, 404);
    return serve(req, image.digest, image.ext);
  },

  // albums
  "GET /api/albums": () => ({ albums: rows("albums").slice()
    .sort((a, b) => (b.year || 0) - (a.year || 0) || fold(a.title).localeCompare(fold(b.title))).map(albumOut) }),
  "GET /api/albums/most-opened": (req) => ({ albums: where("albums", (a) => (a.opened || 0) > 0)
    .sort((a, b) => b.opened - a.opened || b.updated_at - a.updated_at).slice(0, Number(req.q("limit")) || 6).map(albumOut) }),
  "POST /api/albums": async (req) => {
    const data = await req.json();
    const t = now();
    const album = insert("albums", { title: need(data, "title"), year: year(data.year), notes: data.notes || "",
      cover_digest: "", cover_ext: "", stickers: "", created_at: t, updated_at: t, opened: 0 });
    forAlbum(album.id, album.title);
    return { album };
  },
  "GET /api/albums/<id>": (req) => {
    const album = getAlbum(req.params.id);
    update(album, { opened: (album.opened || 0) + 1 });
    return albumRead(album);
  },
  "PATCH /api/albums/<id>": async (req) => {
    const album = getAlbum(req.params.id);
    const data = await req.json();
    const patch: Row = {};
    if ("title" in data) patch.title = need(data, "title");
    if ("year" in data) patch.year = year(data.year);
    if ("notes" in data) patch.notes = data.notes || "";
    // The case's stickers (lib/stickers.ts), checked like the server's _stickers.
    if ("stickers" in data) {
      const list = data.stickers;
      if (!list || !list.length) patch.stickers = "";
      else if (!Array.isArray(list) || list.length > 8) throw new GuestError("Up to 8 stickers on a case.");
      else {
        const num = (v: unknown, lo: number, hi: number, d: number) => { const n = Number(v); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, Math.round(n * 10) / 10)) : d; };
        const AT: Record<string, [number, number]> = { tl: [28, 14], t: [50, 11], tr: [76, 13], bl: [30, 86], b: [50, 89], br: [74, 86] };
        patch.stickers = JSON.stringify(list.map((s: Row) => {
          const [x, y] = AT[s.at] ?? [50, 50];
          return { kind: String(s.kind), x: num(s.x ?? x, 0, 100, x), y: num(s.y ?? y, 0, 100, y), s: num(s.s ?? 1, 0.4, 3, 1),
            rot: num(s.rot ?? 0, -180, 180, 0), ...(s.text ? { text: String(s.text).slice(0, 48) } : {}) };
        }));
      }
    }
    patch.updated_at = now();
    update(album, patch);
    return { album };
  },
  "DELETE /api/albums/<id>": async (req) => {
    const album = getAlbum(req.params.id);
    buryAlbum(album.id);
    remove("album_songs", (l) => l.album_id !== album.id);
    const own = rows("playlists").filter((p) => p.album_id === album.id).map((p) => p.id);
    remove("playlist_items", (i) => !own.includes(i.playlist_id));
    remove("playlists", (p) => p.album_id !== album.id);
    remove("albums", (a) => a.id !== album.id);
    await release(album.cover_digest);
    return { deleted: album.id };
  },
  "POST /api/albums/<id>/songs": async (req) => {
    const album = getAlbum(req.params.id);
    const song = getSong(need(await req.json(), "song_id"));
    if (rows("album_songs").some((l) => l.album_id === album.id && l.song_id === song.id)) {
      return { album_id: album.id, song_id: song.id, added: false };
    }
    const top = where("album_songs", (l) => l.album_id === album.id).reduce((m, l) => Math.max(m, l.position), -1);
    insert("album_songs", { album_id: album.id, song_id: song.id, position: top + 1 });
    update(album, { updated_at: now() });
    const p = forAlbum(album.id);
    if (p && !rows("playlist_items").some((i) => i.playlist_id === p.id && i.song_id === song.id)) {
      insert("playlist_items", { playlist_id: p.id, position: nextPosition(p.id), song_id: song.id, render_id: null, added_at: now() });
    }
    return { album_id: album.id, song_id: song.id, added: true };
  },
  "DELETE /api/albums/<id>/songs/<song_id>": (req) => {
    const album = getAlbum(req.params.id);
    const songId = Number(req.params.song_id);
    remove("album_songs", (l) => !(l.album_id === album.id && l.song_id === songId));
    const p = rows("playlists").find((x) => x.album_id === album.id);
    if (p) remove("playlist_items", (i) => !(i.playlist_id === p.id && i.song_id === songId));
    update(album, { updated_at: now() });
    return { removed: req.params.song_id };
  },
  "POST /api/albums/<id>/order": async (req) => {
    const album = getAlbum(req.params.id);
    const order = (await req.json()).order;
    if (!Array.isArray(order) || !order.length) throw new GuestError("order must be a list of song ids");
    const links = where("album_songs", (l) => l.album_id === album.id);
    const unknown = order.filter((id) => !links.some((l) => l.song_id === id));
    if (unknown.length) throw new GuestError(`those songs are not on this album: [${unknown.join(", ")}]`);
    order.forEach((id: number, position: number) => update(links.find((l) => l.song_id === id)!, { position }));
    update(album, { updated_at: now() });
    return albumRead(album);
  },
  "POST /api/albums/<id>/cover": async (req) => {
    const album = getAlbum(req.params.id);
    const { digest, ext } = await takeImage(req);
    const before = album.cover_digest;
    update(album, { cover_digest: digest, cover_ext: ext, updated_at: now() });
    if (before && before !== digest) await release(before);
    return { album };
  },
  "GET /api/albums/<id>/cover": (req) => {
    const album = getAlbum(req.params.id);
    if (!album.cover_digest) throw new GuestError("this album has no cover yet", 404);
    return serve(req, album.cover_digest, album.cover_ext);
  },
  "GET /api/songs/<id>/albums": (req) => {
    const song = getSong(req.params.id);
    return { albums: where("album_songs", (l) => l.song_id === song.id).map((l) => byId("albums", l.album_id))
      .filter(Boolean).sort((a, b) => fold(a!.title).localeCompare(fold(b!.title))) };
  },

  // playlists
  "GET /api/playlists": () => {
    for (const a of rows("albums")) forAlbum(a.id, a.title);
    // The first three songs' covers, fanned out behind the playlist's own (server: _behind).
    const behind = (id: number) => where("playlist_items", (i) => i.playlist_id === id && i.song_id)
      .sort((a, b) => a.position - b.position || a.id - b.id).slice(0, 3)
      .map((i) => rows("songs").find((s) => s.id === i.song_id)).filter(Boolean)
      .map((s) => ({ title: s!.title, artwork_id: rows("artwork").filter((a) => a.song_id === s!.id)
        .sort((a, b) => a.position - b.position)[0]?.id ?? null }));
    return { playlists: rows("playlists").slice().sort(playlistOrder).map((p) => ({ ...p, count: countOf(p.id), behind: behind(p.id) })) };
  },
  "GET /api/songs/<id>/playlists": (req) => {
    const song = getSong(req.params.id);
    const out: Row[] = [];
    for (const p of rows("playlists").slice().sort(playlistOrder)) {
      const mine = where("playlist_items", (i) => i.playlist_id === p.id && i.song_id === song.id);
      if (!mine.length) continue;
      const at = Math.min(...mine.map((i) => i.position));
      out.push({ ...p, at, times: mine.length, count: countOf(p.id),
        index: where("playlist_items", (i) => i.playlist_id === p.id && i.position < at).length });
    }
    return { playlists: out };
  },
  "POST /api/playlists": async (req) => {
    const t = now();
    const p = insert("playlists", { title: need(await req.json(), "title").slice(0, 120), album_id: null, created_at: t, updated_at: t });
    return { playlist: readPlaylist(p) };
  },
  "GET /api/playlists/<id>": (req) => ({ playlist: readPlaylist(getPlaylist(req.params.id)) }),
  "PATCH /api/playlists/<id>": async (req) => {
    const p = getPlaylist(req.params.id);
    update(p, { title: need(await req.json(), "title").slice(0, 120), updated_at: now() });
    return { playlist: readPlaylist(p) };
  },
  "DELETE /api/playlists/<id>": (req) => {
    const p = getPlaylist(req.params.id);
    if (p.album_id) throw new GuestError("that playlist belongs to an album. Delete the album instead.");
    buryPlaylist(p.id);
    remove("playlist_items", (i) => i.playlist_id !== p.id);
    remove("playlists", (x) => x.id !== p.id);
    return { deleted: p.id };
  },
  "POST /api/playlists/<id>/items": async (req) => {
    const p = getPlaylist(req.params.id);
    const data = await req.json();
    const songId = data.song_id || null, renderId = data.render_id || null;
    if (!!songId === !!renderId) throw new GuestError("say either a song_id or a render_id, not both and not neither");
    if (countOf(p.id) >= MAX_ITEMS) throw new GuestError(`that playlist is full at ${MAX_ITEMS}`);
    if (songId) getSong(songId);
    else if (!byId("renders", renderId)) throw new GuestError(`no render with id ${renderId}`, 404);
    const last = where("playlist_items", (i) => i.playlist_id === p.id).sort((a, b) => b.position - a.position || b.id - a.id)[0];
    if (last && (last.song_id ?? null) === songId && (last.render_id ?? null) === renderId) {
      return { playlist: readPlaylist(p), added: false, message: "That is already the last thing in it." };
    }
    insert("playlist_items", { playlist_id: p.id, position: nextPosition(p.id), song_id: songId, render_id: renderId, added_at: now() });
    update(p, { updated_at: now() });
    return { playlist: readPlaylist(p), added: true };
  },
  "DELETE /api/playlists/<id>/items/<item_id>": (req) => {
    const p = getPlaylist(req.params.id);
    const itemId = Number(req.params.item_id);
    remove("playlist_items", (i) => !(i.id === itemId && i.playlist_id === p.id));
    update(p, { updated_at: now() });
    return { playlist: readPlaylist(p) };
  },
  "PUT /api/playlists/<id>/order": async (req) => {
    const p = getPlaylist(req.params.id);
    const order = (await req.json()).items;
    if (!Array.isArray(order)) throw new GuestError("items must be a list of item ids");
    let at = 1;
    for (const raw of order) {
      const id = Number(raw);
      if (!Number.isInteger(id)) throw new GuestError("an item id must be a whole number");
      const item = rows("playlist_items").find((i) => i.id === id && i.playlist_id === p.id);
      if (item) update(item, { position: at++ });
    }
    update(p, { updated_at: now() });
    return { playlist: readPlaylist(p) };
  },
};

export const summary = {
  artwork: () => ({ count: rows("artwork").length }),
  albums: () => ({ count: rows("albums").length }),
  playlists: () => ({ count: rows("playlists").length, yours: rows("playlists").filter((p) => p.album_id == null).length }),
};
