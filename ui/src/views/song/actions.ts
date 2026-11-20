/* What can be done to a song from more than one place on its screen. Each emits what it
 * changed, so the library and the sidebar follow. */
import { get, post, patch, del, attempt, upload, u } from "$lib/api";
import { deleteSoon } from "$lib/later.svelte";
import { emit } from "$lib/bus";
import { confirm, prompt, sheet } from "$lib/dialog.svelte";
import { toast } from "$lib/toast.svelte";
import { go, href } from "$lib/router.svelte";
import { play, player } from "$lib/player.svelte";
import { copyText } from "$lib/actions";
import type { Album, Playlist, Version } from "$lib/types";
import type { SongStore } from "./song.svelte";
import PickSheet from "./PickSheet.svelte";
import { download, versionName } from "./helpers";

const sid = (song: SongStore) => Number(song.id);

export async function rename(song: SongStore, value: string) {
  const title = value.trim();
  if (!title || !song.song || title === song.song.title) return;
  const was = song.song;
  song.song = { ...was, title };                       // optimistic
  const done = await attempt(() => patch(`/api/songs/${song.id}`, { title }));
  if (!done) { song.song = was; return; }
  await song.refresh("song", "titles");
  emit("songs:changed", { songId: sid(song) });
}

export async function deleteSong(song: SongStore) {
  if (!song.song) return;
  const id = song.id;
  // Undo brings you back to the song, not just the song back into a list.
  deleteSoon(`song:${id}`, `Deleted “${song.song.title}”`, () => del(`/api/songs/${id}`),
    { after: () => emit("songs:changed", { songId: Number(id) }), restore: () => go(href.song(id)) });
  go(href.library());
}

export async function setNotes(song: SongStore, notes: string) {
  if (!song.song) return;
  const done = await attempt(() => patch(`/api/songs/${song.id}`, { notes }));
  if (done) song.song = { ...song.song, notes };
}

// ── takes ────────────────────────────────────────────────────────────────────

export async function makeCurrent(song: SongStore, v: Version) {
  if (!song.song || song.current?.id === v.id) return;
  const was = song.song;
  song.song = { ...was, current_version_id: v.id };
  if (!(await attempt(() => post(`/api/versions/${v.id}/current`), `${versionName(v)} is the current one`))) {
    song.song = was; return;
  }
  emit("versions:changed", { songId: sid(song) });
  emit("songs:changed", { songId: sid(song) });
}

export async function renameLabel(song: SongStore, v: Version) {
  const label = await prompt({ title: `Label for ${versionName(v)}`, label: "Label",
    value: v.label || "", placeholder: "the loud one", maxlength: 120 });
  if (label === null) return;
  const was = song.versions;
  song.versions = was.map((x) => (x.id === v.id ? { ...x, label } : x));
  if (!(await attempt(() => patch(`/api/versions/${v.id}`, { label })))) { song.versions = was; return; }
  emit("versions:changed", { songId: sid(song) });
}

export async function deleteVersion(song: SongStore, v: Version) {
  const heldA = song.versionOf("A")?.id === v.id;
  const heldB = song.versionOf("B")?.id === v.id;
  const gone = await new Promise<boolean>((done) =>
    deleteSoon(`version:${v.id}`, `Deleted ${versionName(v)}`, () => del(`/api/versions/${v.id}`),
      { after: () => done(true), restore: () => done(false) }));
  if (!gone) return;
  await song.refresh("versions", "song");
  if (heldB) await song.setVersion("B", null);
  if (heldA && song.current) await song.setVersion("A", song.current);
  emit("versions:changed", { songId: sid(song) });
  emit("songs:changed", { songId: sid(song) });
}

export function downloadVersion(song: SongStore, v: Version | null) {
  if (!v) return;
  const name = (v.filename as string) || `${song.song?.title || "song"} v${v.n}`;
  download(u(`/api/versions/${v.id}/download`), name);
}

/** Put one of the renders waiting in the inbox onto this song. */
export async function takeFromInbox(song: SongStore) {
  const data = await attempt(() => get("/api/renders"));
  if (!data) return;
  const waiting = (data.renders || []).filter((r: any) => r.waiting && !r.song_id);
  const picked = await sheet<{ key: string }>({
    title: "Take one from the inbox", sub: "A render that arrived without a song.",
    confirm: "", cancel: "Close",
    body: PickSheet,
    props: { items: waiting.map((r: any) => ({ key: String(r.id), label: r.name || r.filename,
      sub: r.duration ? `${Math.round(r.duration)} s` : "" })), empty: "Nothing in the inbox." },
  });
  if (!picked?.key) return;
  const done = await attempt(() => post(`/api/renders/${picked.key}/attach`, { song_id: sid(song) }), "Added");
  if (!done) return;
  await song.refresh("versions", "song");
  emit("versions:changed", { songId: sid(song) });
  emit("renders:changed");
  emit("songs:changed", { songId: sid(song) });
}

// ── artwork ──────────────────────────────────────────────────────────────────

export async function addArtwork(song: SongStore, files: File[]) {
  let n = 0;
  for (const f of files) if (await attempt(() => upload(`/api/songs/${song.id}/artwork`, f))) n++;
  if (!n) return;
  toast(n === 1 ? "Artwork added" : `${n} images added`);
  await song.refresh("artwork", "song");
  emit("artwork:changed", { songId: sid(song) });
}

/** Ask for pictures with the file picker, then add them. */
export function pickArtwork(song: SongStore) {
  const input = document.createElement("input");
  input.type = "file"; input.accept = "image/*"; input.multiple = true;
  input.onchange = () => addArtwork(song, Array.from(input.files || []).filter((f) => f.type.startsWith("image/")));
  input.click();
}

export async function makeCover(song: SongStore, id: number) {
  if (song.artwork[0]?.id === id) return;
  const before = song.artwork;
  const order = [id, ...before.filter((i) => i.id !== id).map((i) => i.id)];
  song.artwork = order.map((at) => before.find((i) => i.id === at)!).filter(Boolean);
  if (!(await attempt(() => post(`/api/songs/${song.id}/artwork/order`, { order }), "Cover set"))) {
    song.artwork = before; return;
  }
  emit("artwork:changed", { songId: sid(song) });
}

export async function reorderArtwork(song: SongStore, order: number[]) {
  const before = song.artwork;
  song.artwork = order.map((at) => before.find((i) => i.id === at)!).filter(Boolean);
  if (!(await attempt(() => post(`/api/songs/${song.id}/artwork/order`, { order })))) { song.artwork = before; return; }
  emit("artwork:changed", { songId: sid(song) });
}

export async function removeArtwork(song: SongStore, id: number) {
  deleteSoon(`artwork:${id}`, "Removed the picture", () => del(`/api/artwork/${id}`), {
    after: async () => { await song.refresh("artwork", "song"); emit("artwork:changed", { songId: sid(song) }); },
  });
}

// ── albums and playlists ─────────────────────────────────────────────────────

export async function pickAlbums(song: SongStore) {
  const all = await attempt(() => get("/api/albums"));
  if (!all) return;
  const albums: Album[] = all.albums || [];
  if (!albums.length) { toast("There are no albums yet."); return; }
  const mine = new Set(song.albums.map((a) => String(a.id)));
  const got = await sheet<{ keys: string[] }>({
    title: "Albums", sub: "A song can sit on more than one.", confirm: "", cancel: "",
    body: PickSheet,
    props: { multi: true, checked: [...mine], items: albums.map((a) => ({ key: String(a.id), label: a.title, sub: a.year ? String(a.year) : "" })) },
  });
  if (!got) return;
  const want = new Set(got.keys);
  for (const a of albums) {
    const key = String(a.id);
    if (want.has(key) && !mine.has(key)) await attempt(() => post(`/api/albums/${a.id}/songs`, { song_id: sid(song) }));
    else if (!want.has(key) && mine.has(key)) await attempt(() => del(`/api/albums/${a.id}/songs/${song.id}`));
  }
  toast("Saved");
  await song.refresh("albums");
  emit("albums:changed");
}

export async function removeFromAlbum(song: SongStore, album: Album) {
  const was = song.albums;
  song.albums = was.filter((a) => a.id !== album.id);
  if (!(await attempt(() => del(`/api/albums/${album.id}/songs/${song.id}`)))) { song.albums = was; return; }
  emit("albums:changed");
}

/** The song into a playlist of the person's own. */
export async function addToPlaylist(song: SongStore): Promise<boolean> {
  const data = await attempt(() => get("/api/playlists"));
  if (!data) return false;
  const mine: Playlist[] = (data.playlists || []).filter((p: Playlist) => !p.album_id);
  const chosen = await sheet<{ key?: string; fresh?: boolean }>({
    title: `Add ${song.song?.title || "this song"} to a playlist`,
    sub: "A running order can hold songs and loose renders together.",
    confirm: "", cancel: "Not now", body: PickSheet,
    props: { fresh: "A new playlist", items: mine.map((p) => ({ key: String(p.id), label: p.title,
      sub: `${p.count ?? 0} item${p.count === 1 ? "" : "s"}` })), empty: "You have no playlists of your own yet." },
  });
  if (!chosen) return false;
  const result = await attempt(async () => {
    let id = chosen.key;
    if (chosen.fresh) id = String((await post("/api/playlists", { title: song.song?.title })).playlist.id);
    return post(`/api/playlists/${id}/items`, { song_id: sid(song) });
  });
  if (!result) return false;
  toast(result.added === false ? "It was already in that playlist." : "Added to the playlist");
  emit("playlists:changed");
  return true;
}

/** Start a running order at this song: what comes next is the reason to play from one. */
export async function playFromPlaylist(song: SongStore, playlistId: number) {
  const data = await attempt(() => get(`/api/playlists/${playlistId}`));
  const items = data?.playlist?.items || [];
  const queue = items.filter((i: any) => i.kind === "song").map((i: any) => i.song);
  const at = queue.findIndex((s: any) => String(s.id) === song.id);
  const version = song.versionOf("A") || song.current;
  if (at < 0 || !version) { await song.play(); return; }
  if (song.here && player.playing) return;
  await play(queue[at], version, queue);
}

export function copyLink(song: SongStore) {
  const base = location.href.split("#")[0];
  return copyText(`${base}#/song/${song.id}`, "Link copied.");
}
