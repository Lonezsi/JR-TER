/* The share flow: who, then (for a link) the link itself. */
import { get, post, attempt } from "$lib/api";
import { emit } from "$lib/bus";
import { sheet } from "$lib/dialog.svelte";
import { toast } from "$lib/toast.svelte";
import type { SongStore } from "./song.svelte";
import ShareSheet from "./ShareSheet.svelte";
import LinkSheet from "./LinkSheet.svelte";

export async function shareSong(song: SongStore) {
  if (!song.song) return;
  const state = await attempt(() => get(`/api/shares?song=${song.id}`));
  if (!state) return;
  const answer = await sheet<{ handle: string; as_name: string }>({
    title: `Share ${song.song.title}`,
    sub: "They can listen to it and work on the sound and the words. Nothing else of yours, "
       + "and their edits become their own copy rather than changing yours.",
    confirm: "", cancel: "",
    body: ShareSheet, props: { people: state.people || [], already: state.shares || [] },
  });
  if (!answer) return;
  const made = await attempt(() => post("/api/shares", {
    song: Number(song.id), handle: answer.handle, as_name: answer.as_name,
  }), answer.handle ? "Shared." : "");
  if (!made) return;
  emit("shares:changed");
  if (!made.token) return;
  await sheet({
    title: "Send this link",
    sub: "Whoever opens it gets this song. They can sign in, or pick a handle and a password there and then. It works once.",
    confirm: "", cancel: "", body: LinkSheet, props: { url: location.origin + made.path },
  });
  toast("Link made");
}
