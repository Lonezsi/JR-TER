/* Which albums a song is on. A song can sit on more than one. Other screens import this. */
import { get, post, del, attempt } from "$lib/api";
import { sheet } from "$lib/dialog.svelte";
import { emit } from "$lib/bus";
import { toast } from "$lib/toast.svelte";
import type { Song } from "$lib/types";
import AlbumPick from "./AlbumPick.svelte";
import type { AlbumRow } from "./kinds";

export async function pickAlbums(song: Pick<Song, "id" | "title">) {
  const found = await attempt(() => Promise.all([
    get<{ albums: AlbumRow[] }>("/api/albums"),
    get<{ albums: AlbumRow[] }>(`/api/songs/${song.id}/albums`),
  ]));
  if (!found) return;
  const albums = found[0].albums || [];
  if (!albums.length) { toast("There are no albums yet."); return; }
  const was = (found[1].albums || []).map((a) => a.id);
  const now = await sheet<number[]>({
    title: "Albums", sub: "A song can sit on more than one.", confirm: "", cancel: "Not now",
    body: AlbumPick, props: { albums, chosen: was },
  });
  if (!now) return;
  const done = await attempt(async () => {
    for (const a of albums) {
      if (now.includes(a.id) && !was.includes(a.id)) await post(`/api/albums/${a.id}/songs`, { song_id: song.id });
      else if (!now.includes(a.id) && was.includes(a.id)) await del(`/api/albums/${a.id}/songs/${song.id}`);
    }
    return true;
  }, "Saved");
  if (done) emit("albums:changed");
}
