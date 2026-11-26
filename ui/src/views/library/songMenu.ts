/* Everything you can do to a song, from the place you are already pointing at it.
 * Other screens (the song page, the inbox) import songMenu, renameSong and deleteSong. */
import { pinItem } from "$lib/pins.svelte";
import { deleteSoon } from "$lib/later.svelte";
import { del, patch, attempt } from "$lib/api";
import { emit } from "$lib/bus";
import { confirm, prompt } from "$lib/dialog.svelte";
import type { MenuItem } from "$lib/menu.svelte";
import { player, playSong, enqueue } from "$lib/player.svelte";
import { go, href } from "$lib/router.svelte";
import { has } from "$lib/app.svelte";
import type { Song } from "$lib/types";
import { addToPlaylist } from "./addToPlaylist";
import { pickAlbums } from "./pickAlbums";
import { attachRender } from "./attachRender";

export async function renameSong(song: Song) {
  const title = await prompt({
    title: "Rename", sub: "The old name is kept, the way Steam keeps yours.",
    value: song.title, confirm: "Rename", maxlength: 200,
  });
  if (!title || title === song.title) return;
  if (await attempt(() => patch(`/api/songs/${song.id}`, { title }), "Renamed")) emit("songs:changed", { songId: song.id });
}

export async function deleteSong(song: Song, after?: () => void) {
  deleteSoon(`song:${song.id}`, `Deleted “${song.title}”`, () => del(`/api/songs/${song.id}`), {
    after: () => { emit("songs:changed", { songId: song.id }); after?.(); },
  });
}

/** The menu for one song. `queue` is the list it was pressed in, so Play continues down it. */
export function songMenu(song: Song, queue?: Song[]): MenuItem[] {
  const here = player.song?.id === song.id;
  const sounding = here && player.playing;
  return [
    { group: song.title },
    pinItem("song", song.id as number),
    { label: sounding ? "Pause" : "Play", icon: sounding ? "pause" : "play", hint: "Enter",
      run: () => playSong(song, queue?.length ? queue : [song]) },
    { label: "Play next", icon: "queue", run: () => enqueue(song, true) },
    { label: "Add to queue", icon: "queue", run: () => enqueue(song) },
    { label: "Open", icon: "songs", run: () => go(href.song(song.id)) },
    { divider: true },
    has("renders") && { label: "Add a render…", icon: "upload", run: () => attachRender(song) },
    has("playlists") && { label: "Add to a playlist…", icon: "playlist",
      run: () => addToPlaylist({ kind: "song", id: song.id, title: song.title }) },
    has("albums") && { label: "Albums…", icon: "album", run: () => pickAlbums(song) },
    { divider: true },
    { label: "Rename…", icon: "edit", run: () => renameSong(song) },
    { label: "Delete…", icon: "trash", danger: true, run: () => deleteSong(song) },
  ];
}
