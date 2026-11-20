/* Routing off the hash.
 *
 * The hash and not the path, for two reasons that are not cosmetic. Every link anybody
 * already holds is a hash link. And a fragment is never sent to a server, so it survives
 * the trip through /login: the door can send somebody back to exactly where they were
 * going without the server ever being told where that was.
 *
 * Old addresses keep working. Screens that were merged answer at the address of each
 * thing they absorbed: #/renders and #/sync are the inbox, #/account is a page of
 * Settings, #/song/3/youtube is the song's Release tab.
 */
import { guest } from "./api";
import { changeScreen, startMorph } from "./morph";

export type View =
  | "library" | "song" | "album" | "playlist" | "inbox" | "settings"
  | "share" | "join" | "orarend" | "own" | "grave" | "missing";

export interface Route {
  view: View;
  /** Whatever the address carries: id, tab, section, q, share, token, scope. */
  params: Record<string, string>;
  /** The hash this was parsed from. */
  hash: string;
}

const LIBRARY_SCOPES = ["songs", "albums", "playlists", "shared"];
const SONG_TABS: Record<string, string> = { youtube: "release", publish: "release" };

export function parse(hash: string): Route {
  const raw = (hash || "#/").replace(/^#/, "");
  const [pathPart, queryPart] = raw.split("?");
  const parts = pathPart.split("/").filter(Boolean).map(decodeURIComponent);
  const params: Record<string, string> = {};
  new URLSearchParams(queryPart || "").forEach((value, key) => { params[key] = value; });
  // A share is named by the route that means one and by nothing else. It decides which
  // library requests are sent to, so an address that merely carries ?share= must not be
  // able to choose it.
  delete params.share;
  const route = (view: View, extra: Record<string, string | undefined> = {}): Route => {
    for (const [k, v] of Object.entries(extra)) if (v !== undefined) params[k] = v;
    return { view, params, hash: "#" + raw };
  };
  // Ids are whole numbers and nothing else. They are put into request paths, so anything
  // else (a slash, a query, a dot dot) would be a way to aim a request somewhere it was
  // never meant to go.
  const id = (v: string | undefined) => (v !== undefined && /^\d+$/.test(v) ? v : null);
  const missing = () => route("missing", { path: pathPart });

  const [head, a, b, c] = parts;
  if (!head || head === "home" || head === "library") return route("library", { scope: "songs" });
  if (LIBRARY_SCOPES.includes(head) && !a) return route("library", { scope: head });
  if (head === "search") return route("library", { scope: "songs" });

  if (head === "song" && a) return id(a) ? route("song", { id: a, tab: b ? (SONG_TABS[b] || b) : undefined }) : missing();
  if (head === "album" && a) return id(a) ? route("album", { id: a }) : missing();
  if (head === "playlist" && a) return id(a) ? route("playlist", { id: a }) : missing();

  // The owner's own song page, used by somebody it is shared with.
  if (head === "shared" && a && b === "edit" && c) return id(a) && id(c) ? route("song", { id: c, share: a }) : missing();
  if (head === "shared" && a) return id(a) ? route("share", { id: a }) : missing();
  // A share link. The token is the address, and this is the one screen somebody may
  // reach before they have an account at all.
  if (head === "join" && a) return /^[\w-]+$/.test(a) ? route("join", { token: a }) : missing();

  if (head === "inbox") return route("inbox", { tab: a });
  if (head === "renders") return route("inbox", { tab: "waiting" });
  if (head === "sync" || head === "folders") return route("inbox", { tab: "sources" });

  if (head === "settings") return route("settings", { section: a });
  if (head === "account") return route("settings", { section: "account" });
  if (head === "orarend") return route("orarend");
  // How to run JR!TER on a machine of your own (the guest's way out of being a guest).
  if (head === "own" || head === "self-host") return route("own");
  if (head === "grave" || head === "trash" || head === "deleted") return route("grave");

  return route("missing", { path: pathPart });
}

export const router = $state<{ route: Route; previous: Route | null }>({
  route: parse(location.hash),
  previous: null,
});

function sync() {
  const next = parse(location.hash);
  const now = router.route;
  if (next.hash === now.hash) return;
  const apply = () => {
    router.previous = router.route;
    router.route = next;
    // Guest mode is for exactly one screen, and ends the moment it is left.
    guest.set(next.params.share ? { share: next.params.share, song: next.params.id } : null);
    document.body.dataset.view = next.view;
  };
  // A tab or a filter is the same screen; only a different screen grows or shrinks.
  const another = next.view !== now.view || next.params.id !== now.params.id;
  if (another) changeScreen(now.hash, next.hash, apply); else apply();
}

export function startRouter() {
  const first = router.route;
  guest.set(first.params.share ? { share: first.params.share, song: first.params.id } : null);
  document.body.dataset.view = first.view;
  window.addEventListener("hashchange", sync);
  startMorph();
}

/** Go somewhere. `path` is what follows the #, e.g. "/song/12". */
export function go(path: string) {
  location.hash = path.startsWith("#") ? path : "#" + path;
}

/** Change the address without adding a step to Back: a tab, a filter, a search term. */
export function replace(path: string) {
  const hash = path.startsWith("#") ? path : "#" + path;
  history.replaceState(history.state, "", location.pathname + location.search + hash);
  sync();
}

/** The address of a thing, so links and navigation never spell it two ways. */
export const href = {
  library: (scope = "songs") => (scope === "songs" ? "#/" : `#/${scope}`),
  search: (q: string) => (q ? `#/?q=${encodeURIComponent(q)}` : "#/"),
  song: (id: number | string, tab?: string) => `#/song/${id}${tab ? "/" + tab : ""}`,
  guestSong: (share: number | string, song: number | string) => `#/shared/${share}/edit/${song}`,
  album: (id: number | string) => `#/album/${id}`,
  playlist: (id: number | string) => `#/playlist/${id}`,
  share: (id: number | string) => `#/shared/${id}`,
  inbox: (tab?: string) => `#/inbox${tab ? "/" + tab : ""}`,
  settings: (section?: string) => `#/settings${section ? "/" + section : ""}`,
  own: () => "#/own",
  grave: () => "#/grave",
};
