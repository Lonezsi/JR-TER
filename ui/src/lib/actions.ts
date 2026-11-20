/* Things you can do from anywhere: the sidebar, a menu, the command palette, a key.
 * One definition each, so "new song" is the same sheet wherever it was asked for. */
import { post, attempt } from "./api";
import { sheet } from "./dialog.svelte";
import { emit } from "./bus";
import { go, href } from "./router.svelte";

export async function newSong() {
  const said = await sheet<{ title: string }>({
    title: "New song",
    sub: "A song holds every render, lyric and setting from here on.",
    confirm: "Create",
    fields: [{ name: "title", label: "Title", placeholder: "Ordinary Weather", required: true, maxlength: 200 }],
  });
  const title = said?.title.trim();
  if (!title) return;
  const data = await attempt(() => post("/api/songs", { title }), "Song created");
  if (!data) return;
  emit("songs:changed");
  go(href.song(data.song.id));
}

export async function newAlbum() {
  const said = await sheet<{ title: string; year: string }>({
    title: "New album",
    confirm: "Create",
    fields: [
      { name: "title", label: "Title", placeholder: "Late Bloomer", required: true, maxlength: 200 },
      { name: "year", label: "Year", placeholder: String(new Date().getFullYear()) },
    ],
  });
  const title = said?.title.trim();
  if (!title) return;
  const data = await attempt(() => post("/api/albums", {
    title, year: String(said!.year || "").trim() || null,
  }), "Album created");
  if (!data) return;
  emit("albums:changed");
  go(href.album(data.album.id));
}

export async function newPlaylist() {
  const said = await sheet<{ title: string }>({
    title: "A new playlist",
    sub: "It starts empty. Add songs and renders to it from their own menus.",
    confirm: "Make it",
    fields: [{ name: "title", label: "Name", placeholder: "Late takes", maxlength: 120, required: true }],
  });
  const title = said?.title.trim();
  if (!title) return;
  const made = await attempt(() => post("/api/playlists", { title }));
  if (!made) return;
  emit("playlists:changed");
  go(href.playlist(made.playlist.id));
}

/** Copy text, and say so. Falls back for a page that is not allowed the clipboard. */
export async function copyText(text: string, said = "Copied.") {
  const { toast } = await import("./toast.svelte");
  try {
    await navigator.clipboard.writeText(text);
    toast(said);
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    try { document.execCommand("copy"); toast(said); }
    catch { toast("Couldn't copy. Select it and copy it manually.", "bad"); }
    area.remove();
  }
}

/* Wait for the server to go away and come back, after it was asked to restart. Down
 * first, then up: asking only "is it up" answers yes straight away, from the process
 * that is about to stop, and the page reloads onto the old code. */
export async function backAgain(): Promise<boolean> {
  const alive = () => fetch("/api/health", { cache: "no-store" }).then((r) => r.ok).catch(() => false);
  const nap = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const started = Date.now();
  let wentAway = false;
  while (Date.now() - started < 5 * 60 * 1000) {
    const up = await alive();
    if (!up) wentAway = true;
    if (up && wentAway) return true;
    // A restart that finished between two looks never shows as down.
    if (up && Date.now() - started > 20000) return true;
    await nap(wentAway ? 2000 : 500);
  }
  return false;
}

/** One press: pull, restart if the new code needs it, wait, reload onto the new version. */
export async function updateNow(): Promise<"updated" | "current" | "failed"> {
  const { toast } = await import("./toast.svelte");
  toast("Updating...");
  const done = await attempt(() => post("/api/update/now"));
  if (!done) return "failed";
  if (!done.updated) { toast("Already up to date."); return "current"; }
  if (done.restarting) {
    toast("Updated. Restarting, this takes a moment...");
    await backAgain();
  }
  location.reload();
  return "updated";
}
