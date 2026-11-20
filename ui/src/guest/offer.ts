/* Keeping a guest's work, said to the person: the quiet offer after signing in, and the
 * three things Settings can do with the browser's copy. Toasts, never a popup. */
import { toast } from "$lib/toast.svelte";
import { emit } from "$lib/bus";
import { refreshState } from "$lib/app.svelte";
import { leftBehind, bringIn, clearLeftBehind, alreadyOffered, markOffered, countOf, summarise, asFile, save, copyName } from "./boot";
import type { Library } from "./lib";

const songs = (n: number) => `${n} song${n === 1 ? "" : "s"}`;

/** Once, a while after a member's page has opened, if this browser still holds a guest
 *  library with anything in it. */
export async function offerOnce() {
  if (alreadyOffered()) return;
  const lib = await leftBehind();
  if (!lib) return;
  markOffered();
  const n = countOf(lib);
  toast(n ? `Your guest library (${songs(n)}) is still in this browser.` : "Your guest library is still in this browser.", "",
    { label: "Bring it in", run: () => { void bring(lib); } });
}

/** Into the account signed in now, then an offer to clear the browser's copy. */
export async function bring(lib?: Library | null): Promise<boolean> {
  lib ??= await leftBehind();
  if (!lib) { toast("There's no guest library in this browser any more."); return false; }
  toast("Bringing your guest library in...");
  try {
    const brought = await bringIn(lib);
    emit("songs:changed"); emit("albums:changed"); emit("playlists:changed"); emit("renders:changed");
    refreshState();
    const missing = brought.missing_audio ? ` ${brought.missing_audio} file${brought.missing_audio === 1 ? " was" : "s were"} missing.` : "";
    toast(`Brought in ${summarise(brought)}.${missing}`, "", { label: "Clear browser copy", run: () => { void clear(); } });
    return true;
  } catch (e) {
    toast((e as Error).message || "That didn't go through.", "bad");
    return false;
  }
}

export async function copy(lib?: Library | null) {
  lib ??= await leftBehind();
  if (!lib) { toast("There's no guest library in this browser any more."); return; }
  try {
    save(await asFile(lib), copyName());
  } catch (e) {
    toast((e as Error).message || "That copy couldn't be made.", "bad");
  }
}

export async function clear(): Promise<boolean> {
  try {
    await clearLeftBehind();
    toast("The browser copy is gone.");
    return true;
  } catch (e) {
    toast((e as Error).message || "That couldn't be cleared.", "bad");
    return false;
  }
}
