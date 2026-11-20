/* What changed, shown once after an update.
 *
 * The rule this is built around: somebody who has just opened JR!TER for the first time
 * has missed nothing, and a wall of release notes would be the opposite of the point. So a
 * browser with nothing remembered is told nothing and simply has the version written down.
 *
 * "Is this newer" is the server's, through ?since, so there is one implementation of it
 * rather than two that can disagree about whether 0.10.0 beats 0.9.0.
 */
import { get } from "./api";
import { has } from "./app.svelte";
import { sheet } from "./dialog.svelte";
import { store } from "./util";
import NotesBody from "../views/settings/NotesBody.svelte";
import type { Release } from "../views/settings/shapes";

const KEY = "jriter.version.seen";

/** Show releases, newest first. Used after an update and from Settings. */
export function showNotes(releases: Release[], quiet = false): Promise<unknown> {
  const earlier = releases.length - 1;
  return sheet({
    title: "What changed",
    sub: quiet ? undefined
      : `You were on an older copy${earlier > 0 ? `. ${releases.length} releases have landed since` : ""}.`,
    confirm: "",
    cancel: "Close",
    body: NotesBody,
    props: { releases },
  });
}

export async function whatsNew(version: string): Promise<void> {
  if (!version) return;                              // a server too old to say
  const last = store.raw(KEY);
  if (last === version) return;
  // Nothing remembered means nothing missed. This is the whole first run story.
  if (!last) { store.setRaw(KEY, version); return; }
  if (!has("devlog")) { store.setRaw(KEY, version); return; }

  let entries: Release[] = [];
  try {
    entries = (await get<{ entries: Release[] }>("/api/devlog?since=" + encodeURIComponent(last))).entries || [];
  } catch {
    return;                                          // no note at all beats an error about a note
  }
  /* Written down before it is shown rather than after. A dialog that comes back because the
   * tab was closed on it is the nagging this is meant to be the opposite of, and the cost of
   * this way round is one release note missed by somebody who closed the tab on it. */
  store.setRaw(KEY, version);
  // Empty means the remembered version is ahead of this one: a second machine running an
  // older copy. Say nothing.
  if (!entries.length) return;
  await showNotes(entries);
}
