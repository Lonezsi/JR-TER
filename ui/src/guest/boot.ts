/* The page's half of guest mode: deciding, on the way in, whether this browser is signed
 * in or a guest, and keeping a guest's work once they are signed in.
 *
 * Signed in: the worker is told to stand aside and unregistered, so nothing a member does
 * goes anywhere near it. Signed out: the worker is registered (or found), told guest mode
 * is on, and once it controls the page every /api/* call the screens make is answered
 * from this browser. At most one reload, the first time, if the browser will not hand the
 * page to the worker without one.
 */
import { MODE, isGuest, setGuest, kvGet, wipe } from "./store";
import { answerAnalyse } from "./files";
import { writeLibrary, isEmpty, type Brought } from "./format";
import { DEFAULTS, type Library } from "./lib";

/** Set in localStorage when this browser has ever been a guest, so a member's page only
 *  opens IndexedDB to look for a guest library when there could be one. */
const WAS = "jriter.guest.was";
const RELOADED = "jriter.guest.reloaded";
/** When the quiet offer to bring a guest library in was last made. Once is enough. */
const OFFERED = "jriter.guest.offered";

const remember = (key: string, value: string | null) => {
  try { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value); } catch { /* private window */ }
};
const recall = (key: string) => { try { return localStorage.getItem(key); } catch { return null; } };

/** Screens that are an account's alone. Signed out, a link to one goes to the door with
 *  its destination, the way it always did, rather than opening an empty guest library. */
const MEMBERS_ONLY = /^#\/(orarend|join|shared)(\/|$|\?)/;

export type Door = "member" | "guest" | "away" | "stuck";

async function authState(): Promise<{ signed_in?: boolean } | null | "no-door"> {
  try {
    const r = await fetch("/api/auth/state", { cache: "no-store", credentials: "same-origin" });
    if (r.status === 404) return "no-door";          // a server with the door switched off
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

/** Ask the controlling worker to switch, and wait for it to say it has. */
function tell(on: boolean): Promise<void> {
  const worker = navigator.serviceWorker?.controller;
  if (!worker) return Promise.resolve();
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    const timer = setTimeout(resolve, 1500);
    channel.port1.onmessage = () => { clearTimeout(timer); resolve(); };
    worker.postMessage({ type: MODE, on }, [channel.port2]);
  });
}

function controlled(ms: number): Promise<boolean> {
  if (navigator.serviceWorker.controller) return Promise.resolve(true);
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(!!navigator.serviceWorker.controller), ms);
    navigator.serviceWorker.addEventListener("controllerchange", () => { clearTimeout(timer); resolve(true); }, { once: true });
  });
}

async function enter(): Promise<Door> {
  if (!("serviceWorker" in navigator) || !window.indexedDB || !window.isSecureContext) return "stuck";
  try {
    await setGuest(true);
  } catch {
    return "stuck";                                   // storage refused: a locked down private window
  }
  remember(WAS, "1");
  answerAnalyse();
  try {
    await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  } catch {
    return "stuck";
  }
  if (!(await controlled(8000))) {
    // A hard reload bypasses the worker for that one page. A normal one does not.
    if (!sessionStorage.getItem(RELOADED)) {
      sessionStorage.setItem(RELOADED, "1");
      location.reload();
      return "away";
    }
    return "stuck";
  }
  sessionStorage.removeItem(RELOADED);
  await tell(true);
  return "guest";
}

async function leave() {
  if (!("serviceWorker" in navigator)) return;
  const registrations = await navigator.serviceWorker.getRegistrations().catch(() => []);
  if (!registrations.length && !navigator.serviceWorker.controller) return;
  await tell(false);
  await setGuest(false).catch(() => undefined);
  for (const r of registrations) {
    const url = r.active?.scriptURL || r.waiting?.scriptURL || r.installing?.scriptURL || "";
    if (url.endsWith("/sw.js")) await r.unregister().catch(() => false);
  }
}

/** Which way in this is. Called once, before anything asks the server for the library. */
export async function decide(): Promise<Door> {
  const state = await authState();
  if (state === "no-door") { await leave(); return "member"; }
  if (state === null) {
    // The server is not answering. A guest already set up here can carry on without it:
    // everything they have is in this browser anyway.
    if (navigator.serviceWorker?.controller && (await isGuest().catch(() => false))) {
      answerAnalyse();
      return "guest";
    }
    return "member";                                  // and loadState says the server is down
  }
  if (state.signed_in) { await leave(); return "member"; }
  if (MEMBERS_ONLY.test(location.hash)) {
    location.replace("/login" + location.hash);
    return "away";
  }
  return enter();
}

// ── keeping a guest's work ─────────────────────────────────────────────────

/** The guest library this browser still holds, if it holds one with anything in it. */
export async function leftBehind(): Promise<Library | null> {
  if (!recall(WAS) || !window.indexedDB) return null;
  try {
    const lib = await kvGet<Library>("library");
    if (isEmpty(lib)) return null;
    return lib!;
  } catch {
    return null;
  }
}

export const countOf = (lib: Library) => lib.tables.songs.length;

/** The guest library as the library file. */
export async function asFile(lib: Library): Promise<Blob> {
  return writeLibrary(lib, { ...DEFAULTS, ...lib.settings });
}

/** Hand a file to the browser to save. */
export function save(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

export const copyName = () => {
  const d = new Date();
  return `jriter-guest-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}.zip`;
};

/** Send it to the account that is signed in now. */
export async function bringIn(lib: Library): Promise<Brought> {
  const file = await asFile(lib);
  const r = await fetch("/api/import", {
    method: "POST", body: file, credentials: "same-origin",
    headers: { "Content-Type": "application/zip", "X-Filename": copyName() },
  });
  let data: any = {};
  try { data = await r.json(); } catch { /* below */ }
  if (r.status === 404 && data?.error === "no such endpoint") {
    throw new Error("This server can't take a library in yet. Take a copy for now, and bring it in after an update.");
  }
  if (!r.ok) throw new Error(data?.error || `That didn't go through (${r.status}).`);
  return data as Brought;
}

/** Throw the browser's copy away, and forget there ever was one. */
export async function clearLeftBehind() {
  await wipe();
  remember(WAS, null);
  remember(OFFERED, null);
}

export const alreadyOffered = () => !!recall(OFFERED);
export const markOffered = () => remember(OFFERED, String(Date.now()));

export function summarise(b: Brought) {
  const parts = [[b.songs, "song"], [b.albums, "album"], [b.playlists, "playlist"], [b.renders, "render"]]
    .filter(([n]) => Number(n) > 0).map(([n, w]) => `${n} ${w}${n === 1 ? "" : "s"}`);
  return parts.length ? parts.join(", ") : "nothing new";
}
