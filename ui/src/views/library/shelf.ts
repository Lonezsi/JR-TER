/* What you do to an album or a playlist as a whole, from the shelf or from its own page. */
import { pinItem } from "$lib/pins.svelte";
import { deleteSoon } from "$lib/later.svelte";
import { get, patch, del, attempt } from "$lib/api";
import { emit } from "$lib/bus";
import { confirm, prompt } from "$lib/dialog.svelte";
import type { MenuItem } from "$lib/menu.svelte";
import { playSong, playRender } from "$lib/player.svelte";
import { go, href } from "$lib/router.svelte";
import { toast } from "$lib/toast.svelte";
import type { Album, Playlist, Render, Song } from "$lib/types";
import { shuffled, type PlaylistFull, type PlaylistItem } from "./kinds";

/** A playlist's items as the player can take them. Songs and loose renders cannot share a
 *  queue (their ids overlap), so a press queues the pressed kind, in the order shown. */
export function playItems(items: PlaylistItem[], from = 0) {
  const at = items[from];
  if (!at) return;
  if (at.kind === "song" && at.song) {
    playSong(at.song, items.filter((i) => i.kind === "song" && i.song).map((i) => i.song!));
  } else if (at.render) {
    playRender(asRender(at), items.filter((i) => i.kind === "render" && i.render).map((i) => asRender(i)));
  }
}

/** The server's render rows carry no kind; the player needs it. */
export const asRender = (item: PlaylistItem): Render =>
  ({ ...item.render!, kind: "render", name: item.title }) as Render;

export async function playAlbum(album: Pick<Album, "id">, shuffle = false) {
  const data = await attempt(() => get<{ songs: Song[] }>(`/api/albums/${album.id}`));
  const list = data?.songs;
  if (!list?.length) { if (data) toast("That album has no songs in it yet."); return; }
  const order = shuffle ? shuffled(list) : list;
  playSong(order[0], order);
}

export async function playPlaylist(playlist: Pick<Playlist, "id">, shuffle = false) {
  const data = await attempt(() => get<{ playlist: PlaylistFull }>(`/api/playlists/${playlist.id}`));
  const items = data?.playlist.items;
  if (!items?.length) { if (data) toast("Nothing in that playlist yet."); return; }
  playItems(shuffle ? shuffled(items) : items);
}

export async function renameAlbum(album: Album) {
  const title = await prompt({ title: "Rename the album", value: album.title, confirm: "Rename", maxlength: 200 });
  if (!title || title === album.title) return;
  if (await attempt(() => patch(`/api/albums/${album.id}`, { title }), "Renamed")) emit("albums:changed");
}

export async function deleteAlbum(album: Album, after?: () => void) {
  // The songs stay where they are; only the grouping goes, and Undo brings it back.
  after?.();
  const from = location.hash;
  deleteSoon(`album:${album.id}`, `Deleted the album “${album.title}”`, () => del(`/api/albums/${album.id}`), {
    after: () => emit("albums:changed"),
    // Deleted from its own page: Undo takes you back there.
    restore: () => { if (from === href.album(album.id)) go(from); },
  });
}

export async function renamePlaylist(playlist: Playlist) {
  const title = await prompt({ title: "Rename this playlist", value: playlist.title, confirm: "Rename", maxlength: 120 });
  if (!title || title === playlist.title) return;
  if (await attempt(() => patch(`/api/playlists/${playlist.id}`, { title }), "Renamed")) emit("playlists:changed");
}

export async function deletePlaylist(playlist: Playlist, after?: () => void) {
  after?.();
  const from = location.hash;
  deleteSoon(`playlist:${playlist.id}`, `Deleted the playlist “${playlist.title}”`, () => del(`/api/playlists/${playlist.id}`), {
    after: () => emit("playlists:changed"),
    restore: () => { if (from === href.playlist(playlist.id)) go(from); },
  });
}

export const albumMenu = (album: Album, after?: () => void): MenuItem[] => [
  { group: album.title },
  pinItem("album", album.id as number),
  { label: "Open", icon: "album", run: () => go(href.album(album.id)) },
  { label: "Play it through", icon: "play", run: () => playAlbum(album) },
  { label: "Shuffle", icon: "shuffle", run: () => playAlbum(album, true) },
  { divider: true },
  { label: "Rename…", icon: "edit", run: () => renameAlbum(album) },
  { label: "Delete the album…", icon: "trash", danger: true, run: () => deleteAlbum(album, after) },
];

export const playlistMenu = (playlist: Playlist, after?: () => void): MenuItem[] => [
  { group: playlist.title },
  pinItem("playlist", playlist.id as number),
  { label: "Open", icon: "playlist", run: () => go(href.playlist(playlist.id)) },
  { label: "Play it through", icon: "play", disabled: !playlist.count, run: () => playPlaylist(playlist) },
  { label: "Shuffle", icon: "shuffle", disabled: !playlist.count, run: () => playPlaylist(playlist, true) },
  !playlist.album_id && { divider: true },
  !playlist.album_id && { label: "Rename…", icon: "edit", run: () => renamePlaylist(playlist) },
  !playlist.album_id && { label: "Delete the playlist…", icon: "trash", danger: true, run: () => deletePlaylist(playlist, after) },
];
