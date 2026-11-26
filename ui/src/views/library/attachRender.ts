/* The other direction from the inbox: a song wants one of the renders still waiting. */
import { get, post, attempt } from "$lib/api";
import { sheet } from "$lib/dialog.svelte";
import { emit } from "$lib/bus";
import { toast } from "$lib/toast.svelte";
import { time, bytes } from "$lib/util";
import type { Render, Song } from "$lib/types";
import Picker from "./Picker.svelte";
import type { Candidate } from "./kinds";

type Waiting = Render & { waiting?: boolean };

export async function attachRender(song: Pick<Song, "id" | "title">): Promise<boolean> {
  const data = await attempt(() => get<{ renders: Waiting[] }>("/api/renders"));
  if (!data) return false;
  const waiting = (data.renders || []).filter((r) => r.waiting !== false && !r.song_id);
  if (!waiting.length) { toast("Nothing in the inbox."); return false; }
  const candidates: Candidate[] = waiting.map((r) => ({
    key: String(r.id), id: r.id, kind: "render", title: r.name || r.filename || "render",
    sub: `${r.duration ? time(r.duration) + " · " : ""}${bytes(r.size)}`,
  }));
  const keys = await sheet<string[]>({
    title: `Add a render to ${song.title}`, sub: "Anything waiting in the inbox.",
    confirm: "", cancel: "Not now", wide: true,
    body: Picker, props: { candidates, single: true },
  });
  if (!keys?.length) return false;
  const result = await attempt(() => post(`/api/renders/${keys[0]}/attach`, { song_id: song.id }));
  if (!result) return false;
  emit("renders:changed");
  emit("versions:changed", { songId: song.id });
  emit("songs:changed", { songId: song.id });
  toast(result.already_there ? `Those bytes were already v${result.version.n}.` : `Added as v${result.version.n}.`);
  return true;
}
