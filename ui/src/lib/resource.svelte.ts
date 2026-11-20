/* Loading something for a screen, without each screen reinventing the three states.
 *
 *   const songs = resource(() => get("/api/songs"), { on: ["songs:changed"] });
 *   {#if songs.loading && !songs.data} skeleton {:else if songs.error} ... {:else} ...
 *
 * A refresh keeps what is on screen until the new data lands: an edit must never look
 * like a page load. Only the first load has nothing to show. A slow answer that arrives
 * after a newer request was made is dropped, so a fast walk through a list always ends
 * on the thing that was asked for last.
 *
 * `keep` names what was loaded, so a screen that comes back shows what it had at once and
 * refreshes underneath (the data is still fetched every time). Going back to a list then
 * has the list on the first frame, which is also what lets an opened song shrink back into
 * its row (lib/morph) instead of into a skeleton.
 *
 * Call it during component initialisation: it registers its own cleanup.
 */
import { onDestroy, untrack } from "svelte";
import { onAny, type Events } from "./bus";

/** The last answer for each kept name, for this page load only. */
const kept = new Map<string, unknown>();

export interface Resource<T> {
  readonly data: T | null;
  readonly loading: boolean;
  readonly error: string;
  /** Fetch again, keeping what is shown meanwhile. */
  reload(): Promise<void>;
  /** Replace the data in place, for an optimistic edit. */
  set(value: T | null): void;
}

export function resource<T>(load: () => Promise<T>, options: {
  /** Bus events that mean "this is stale": the resource reloads when one fires. */
  on?: (keyof Events)[];
  /** Start empty and wait for reload() rather than fetching straight away. */
  lazy?: boolean;
  /** Show the last answer under this name straight away, while fetching a fresh one. A
   *  function when the name depends on the route (it is read tracked, with `load`). */
  keep?: string | (() => string);
} = {}): Resource<T> {
  const nameOf = () => (typeof options.keep === "function" ? options.keep() : options.keep) || "";
  let data = $state<T | null>((untrack(nameOf) && (kept.get(untrack(nameOf)) as T)) || null);
  const remember = (name: string, value: T) => { if (name) kept.set(name, value); };
  let loading = $state(!options.lazy);
  let error = $state("");
  let token = 0;

  async function reload() {
    const mine = ++token;
    loading = true;
    try {
      const name = untrack(nameOf);
      const value = await load();
      if (mine !== token) return;
      data = value;
      remember(name, value);
      error = "";
    } catch (e) {
      if (mine !== token) return;
      error = (e as Error).message || "That did not load.";
    } finally {
      if (mine === token) loading = false;
    }
  }

  // Tracked: when `load` reads reactive state (a route param, a filter), a change to it
  // reloads. The fetch itself is untracked so its own writes cannot retrigger it.
  $effect(() => {
    if (options.lazy) return;
    trackAndLoad();
  });
  function trackAndLoad() {
    const mine = ++token;
    loading = true;
    let pending: Promise<T>;
    const name = nameOf();
    // Another name (another song, say): what that one had last, or nothing, never the
    // previous name's data under the new name.
    if (name && kept.has(name)) data = kept.get(name) as T;
    try { pending = load(); }            // synchronous part runs tracked
    catch (e) { error = (e as Error).message; loading = false; return; }
    untrack(() => {
      pending.then((value) => { if (mine === token) { data = value; error = ""; remember(name, value); } })
        .catch((e) => { if (mine === token) error = (e as Error).message || "That did not load."; })
        .finally(() => { if (mine === token) loading = false; });
    });
  }

  if (options.on?.length) onDestroy(onAny(options.on, () => { reload(); }));
  onDestroy(() => { token++; });

  return {
    get data() { return data; },
    get loading() { return loading; },
    get error() { return error; },
    reload,
    set(value) { data = value; },
  };
}
