/* What the server said it can do.
 *
 * Nothing in the interface assumes a module exists: every screen, link and control asks
 * `has("name")` and is simply not drawn when the answer is no.
 */
import { get, put } from "./api";
import { emit } from "./bus";
import type { ServerState, Settings } from "./types";

export const app = $state({
  ready: false,
  /** Why the app could not start, when it could not. */
  failure: "" as string,
  /** Signed out, and working on a library kept in this browser (ui/src/guest). */
  guest: false,
  /** Signed out in a browser that cannot keep a library (no service worker or storage). */
  stuck: false,
  name: "JR!TER",
  version: "",
  modules: [] as string[],
  failed: {} as Record<string, string>,
  settings: {} as Settings,
  summary: {} as ServerState["summary"],
});

export const has = (module: string) => app.modules.includes(module);

/** Whether this session is the machine's owner. With the door switched off there is one
 *  person and they own everything, which is why a missing auth summary means yes. */
export const ownsTheMachine = () => {
  const auth = app.summary.auth;
  return !auth || auth.is_owner !== false;
};

export const me = () => app.summary.auth?.who || null;

/** A guest: no account, the library lives in this browser. */
export const isGuest = () => app.guest;

function take(state: ServerState) {
  app.name = state.name || "JR!TER";
  app.version = state.version || "";
  app.modules = state.modules || [];
  app.failed = state.failed || {};
  app.settings = state.settings || ({} as Settings);
  app.summary = state.summary || {};
  document.title = app.name;
}

export async function loadState(): Promise<boolean> {
  try {
    take(await get<ServerState>("/api/state"));
    app.ready = true;
    app.failure = "";
    return true;
  } catch (e) {
    app.failure = (e as Error).message;
    return false;
  }
}

export async function refreshState() {
  try { take(await get<ServerState>("/api/state")); } catch { /* the old one stands */ }
}

/** Save some settings. The server answers with the whole set, defaults filled in. */
export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const saved = await put<Settings>("/api/settings", patch);
  app.settings = saved;
  if (patch.library_name !== undefined) {
    app.name = saved.library_name || "JR!TER";
    document.title = app.name;
  }
  emit("settings:changed");
  return saved;
}

/** Foyer is the site this one backs out to. A path on this origin, not a port: the
 *  tunnel puts both on one hostname, so the way out works from wherever the library did. */
export const FOYER = "/foyer";
