/* The menu of one render: the same entries on a row's right click, its "more" button, the
 * palette and a playlist. Built from the functions in renders.ts and attach.ts, so none
 * of them is written twice. */
import { pinItem } from "$lib/pins.svelte";
import { get, post, attempt } from "$lib/api";
import { emit } from "$lib/bus";
import { has } from "$lib/app.svelte";
import { toast } from "$lib/toast.svelte";
import { sheet } from "$lib/dialog.svelte";
import { go, href } from "$lib/router.svelte";
import { copyText } from "$lib/actions";
import { player, playRender, toggle, enqueue } from "$lib/player.svelte";
import type { MenuItem } from "$lib/menu.svelte";
import type { Render } from "$lib/types";
import { attachRender } from "./attach";
import {
  type LooseRender, nameOf, isWaiting, downloadRender, renameRender, unattachRender, deleteRenders,
} from "./renders";
import PlaylistPicker from "./PlaylistPicker.svelte";

/** Put a render in a playlist. Local to the inbox: library/addToPlaylist.ts was not there
 *  when this was written, and it is a small sheet. Swap it for that one when it lands. */
export async function renderToPlaylist(render: Render): Promise<boolean> {
  const name = nameOf(render);
  const lists = await attempt(() => get("/api/playlists"));
  if (!lists) return false;
  const mine = (lists.playlists || []).filter((p: { album_id?: number | null }) => !p.album_id);
  const chosen = await sheet<{ id: number } | { fresh: true }>({
    title: `Add ${name} to a playlist`,
    sub: "A running order can hold songs and loose renders together.",
    confirm: "", cancel: "Not now",
    body: PlaylistPicker, props: { playlists: mine },
  });
  if (!chosen) return false;
  const done = await attempt(async () => {
    let id = "id" in chosen ? chosen.id : 0;
    if ("fresh" in chosen) id = (await post("/api/playlists", { title: name })).playlist.id;
    return post(`/api/playlists/${id}/items`, { render_id: render.id });
  });
  if (!done) return false;
  emit("playlists:changed");
  toast(done.added ? `Added to ${done.playlist?.title || "the playlist"}.` : done.message || "Already there.");
  return true;
}

/** `queue` is what plays on after this one: the list the row was in. */
export function renderMenu(render: LooseRender, queue?: Render[]): MenuItem[] {
  const waiting = isWaiting(render);
  const sounding = player.song?.id === (`render:${render.id}` as unknown);
  return [
    pinItem("render", render.id as number),
    { label: sounding && player.playing ? "Pause" : "Play", icon: sounding && player.playing ? "pause" : "play", hint: "Space",
      run: () => (sounding ? toggle() : playRender(render, queue)) },
    { label: "Play next", icon: "queue", run: () => { enqueue(render, true); toast("Playing next."); } },
    { divider: true },
    waiting
      ? { label: "Attach to a song…", icon: "link", hint: "Enter", run: () => attachRender(render) }
      : { label: `Put back${render.song_title ? " from " + render.song_title : ""}`, icon: "undo",
          run: () => unattachRender(render) },
    !waiting && render.song_id
      ? { label: `Open ${render.song_title || "the song"}`, icon: "songs", run: () => go(href.song(render.song_id as number)) } : null,
    { label: "Rename", icon: "edit", hint: "F2", run: () => renameRender(render) },
    has("playlists") ? { label: "Add to a playlist…", icon: "playlist", run: () => renderToPlaylist(render) } : null,
    { label: "Download", icon: "download", run: () => downloadRender(render) },
    render.source_path ? { label: "Copy where it came from", icon: "copy", run: () => copyText(render.source_path as string, "Path copied.") } : null,
    { divider: true },
    { label: "Delete", icon: "trash", danger: true, hint: "Del", run: () => deleteRenders([render]) },
  ];
}
