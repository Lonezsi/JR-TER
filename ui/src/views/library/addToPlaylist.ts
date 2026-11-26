/* Sending something to a playlist, from anywhere it is listed. Other screens import this. */
import { get, post, attempt } from "$lib/api";
import { sheet } from "$lib/dialog.svelte";
import { emit } from "$lib/bus";
import { toast } from "$lib/toast.svelte";
import type { Playlist } from "$lib/types";
import PlaylistPick from "./PlaylistPick.svelte";

export interface Addable { kind: "song" | "render"; id: number; title: string }

/** Choose a playlist (or a new one, named after the thing) and put `item` at its end.
 *  Resolves with the server's answer, or null when nothing was added. */
export async function addToPlaylist(item: Addable) {
  const data = await attempt(() => get<{ playlists: Playlist[] }>("/api/playlists"));
  if (!data) return null;
  // An album's own running order is changed through the album, never from here.
  const mine = (data.playlists || []).filter((p) => !p.album_id);
  const chosen = await sheet<{ id?: number; fresh?: boolean }>({
    title: `Add ${item.title} to a playlist`,
    sub: "A running order can hold songs and loose renders together.",
    confirm: "", cancel: "Not now",
    body: PlaylistPick, props: { playlists: mine },
  });
  if (!chosen) return null;

  return attempt(async () => {
    let id = chosen.id;
    if (chosen.fresh) id = (await post("/api/playlists", { title: item.title })).playlist.id;
    const body = item.kind === "render" ? { render_id: item.id } : { song_id: item.id };
    const result = await post(`/api/playlists/${id}/items`, body);
    emit("playlists:changed");
    toast(result.added ? `Added to ${result.playlist.title}.` : result.message || "Already there.");
    return result;
  });
}
