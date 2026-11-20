/* What can be done to one render, whichever screen is showing it.
 *
 * One implementation of each, so a menu item, a row button, a key and the palette all do
 * the same thing and say the same words. Each emits `renders:changed`; whoever is
 * showing renders refetches.
 */
import { get, post, patch, del, attempt } from "$lib/api";
import { deleteSoon, pending } from "$lib/later.svelte";
import { emit } from "$lib/bus";
import { toast } from "$lib/toast.svelte";
import { confirm, prompt, sheet } from "$lib/dialog.svelte";
import { plural } from "$lib/util";
import type { Render } from "$lib/types";

/** A render as /api/renders sends it. */
export interface LooseRender extends Render {
  waiting?: boolean;
  song_title?: string | null;
  version_id?: number | null;
  origin?: string;
  peak_db?: number | null;
  source_path?: string;
  ext?: string;
  bitrate?: number;
  /** When the audio was made, and when the project behind it was. 0 is "not known". */
  rendered_at?: number;
  project_at?: number;
}

export const nameOf = (render: Render) => render.name || render.filename || "render";

/** Waiting unless the server said it went somewhere. A render handed over by another
 *  screen may not carry `waiting` at all. */
export const isWaiting = (render: LooseRender) =>
  render.waiting !== undefined ? !!render.waiting : !render.song_id;

/** What is wrong with it, if anything is. "not looked at" is the server's own marker for
 *  a format it cannot read, and is not a complaint about the file. */
export function troubleOf(render: Render): { short: string; long: string } | null {
  const what = render.trouble;
  if (!what || what === "not looked at") return null;
  if (what === "silent") return { short: "silent", long: "There is no sound in this one" };
  if (what === "unreadable") return { short: "will not play", long: "This will not play" };
  return { short: what, long: what };
}

/** How it got here, in a word. The server stores whatever the sender said it was. */
export function originOf(render: LooseRender): { label: string; icon: string; long: string } {
  const origin = String(render.origin || "upload").toLowerCase();
  if (origin === "import" || origin === "folder" || origin === "sync") {
    return { label: "folder", icon: "folder", long: "Taken in from a folder on the host" };
  }
  if (origin === "upload" || origin === "drop" || origin === "web") {
    return { label: "upload", icon: "upload", long: origin === "drop" ? "Dropped onto the page" : "Uploaded from a browser" };
  }
  // Anything else is a name the desktop agent gave itself (client, fl, watch, shell).
  return { label: "agent", icon: "bolt", long: `Sent by the desktop agent (${origin})` };
}

/** dBFS of the loudest sample. At or over zero it clipped. */
export const peakOf = (render: LooseRender) =>
  typeof render.peak_db === "number" && Number.isFinite(render.peak_db)
    ? `${render.peak_db > 0 ? "+" : ""}${render.peak_db.toFixed(1)} dB` : "";

export const audioOf = (render: Render) => render.url || `/api/renders/${render.id}/audio`;

/** Save the file. An anchor with `download`, so it is saved rather than opened in a tab
 *  that then has to be closed. */
export function downloadRender(render: LooseRender) {
  const a = document.createElement("a");
  a.href = audioOf(render);
  a.download = render.filename || nameOf(render) + (render.ext || "");
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export async function renameRender(render: Render): Promise<LooseRender | null> {
  const name = await prompt({
    title: "Rename this render",
    sub: "Only what it is called here. The file keeps its own name.",
    label: "Name", value: nameOf(render), confirm: "Rename", maxlength: 200,
  });
  if (!name || name === nameOf(render)) return null;
  return saveName(render, name);
}

export async function saveName(render: Render, name: string): Promise<LooseRender | null> {
  const done = await attempt(() => patch(`/api/renders/${render.id}`, { name }));
  if (!done) return null;
  emit("renders:changed");
  return done.render as LooseRender;
}

/** Back to the waiting list. The version it made stays on the song, which is why putting
 *  it back again is free: attaching the same bytes to the same song finds that version. */
export async function unattachRender(render: LooseRender): Promise<boolean> {
  const songId = render.song_id;
  const done = await attempt(() => post(`/api/renders/${render.id}/unattach`));
  if (!done) return false;
  emit("renders:changed");
  toast(`${nameOf(render)} is waiting again. The version it made stays on ${render.song_title || "the song"}.`, "",
    songId ? {
      label: "Undo",
      run: async () => {
        const back = await attempt(() => post(`/api/renders/${render.id}/attach`, { song_id: songId }));
        if (back) emit("renders:changed");
      },
    } : undefined);
  return true;
}

/** Delete renders, with Undo: they leave the list at once and only go from the server
 *  when the toast runs out. */
export async function deleteRenders(renders: LooseRender[]): Promise<boolean> {
  if (!renders.length) return false;
  const one = renders.length === 1 ? renders[0] : null;
  const key = `renders:${renders.map((r) => r.id).join(",")}`;
  for (const r of renders) pending.keys = [...pending.keys, `render:${r.id}`];
  const unhide = () => { pending.keys = pending.keys.filter((k) => !renders.some((r) => k === `render:${r.id}`)); };
  deleteSoon(key, one ? `Deleted ${nameOf(one)}` : `Deleted ${plural(renders.length, "render")}`, async () => {
    let why = "";
    for (const render of renders) {
      try { await del(`/api/renders/${render.id}`); } catch (e) { why = (e as Error).message; }
    }
    if (why) throw new Error(why);
    return true;
  }, { restore: unhide, after: () => { unhide(); emit("renders:changed"); } });
  return true;
}

/** Everything that was used, out of the list in one go. */
export async function clearAttached(count?: number): Promise<boolean> {
  const sure = await confirm(
    count ? `Clear ${plural(count, "attached render")}?` : "Clear the attached renders?",
    "They leave this list. The versions they made stay on their songs, and anything still waiting is untouched.",
    "Clear them", "Keep them");
  if (!sure) return false;
  const done = await attempt(() => post("/api/renders/clear"));
  if (!done) return false;
  emit("renders:changed");
  toast(done.cleared ? `${plural(done.cleared, "render")} cleared.` : "Nothing was attached.");
  return true;
}

/** Read audio where it already lies on the host, rather than posting gigabytes to a
 *  server on the same disk. A file or a whole folder; nothing in it is moved or changed. */
export async function takeInFolder(): Promise<boolean> {
  const said = await sheet<{ path: string }>({
    title: "Take in a folder of renders",
    sub: "A path on the machine JR!TER is running on. Nothing in it is moved or changed.",
    confirm: "Take them in",
    fields: [{ name: "path", label: "Folder or file", placeholder: "C:\\Users\\you\\Renders", required: true }],
  });
  const path = said?.path.trim();
  if (!path) return false;
  const done = await attempt(() => post("/api/renders/ingest", { path, origin: "import" }));
  if (!done) return false;
  toast(done.count ? `${plural(done.count, "render")} taken in.`
    : done.looked_at ? `Nothing new. All ${done.looked_at} were already here.`
    : "There is no audio in there.");
  if (done.count) emit("renders:changed");
  return true;
}

/* What counts as audio is the server's answer, off /api/state. A second list written
 * into the page disagrees with the real one the week somebody adds .aiff, and the
 * disagreement shows up as a file that vanishes on drop. */
let kinds: Promise<string[]> | null = null;
export function audioKinds(): Promise<string[]> {
  kinds ||= get("/api/state")
    .then((state) => (Array.isArray(state.audio) && state.audio.length ? state.audio as string[] : FALLBACK))
    .catch(() => { kinds = null; return FALLBACK; });
  return kinds;
}
const FALLBACK = [".mp3", ".wav", ".flac", ".m4a", ".aac", ".ogg", ".opus"];
