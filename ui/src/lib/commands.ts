/* Commands: everything the palette (Ctrl+K) can run.
 *
 * The shell contributes the ones that are always there. A screen contributes its own
 * while it is showing, by calling useCommands during component initialisation:
 *
 *   useCommands(() => [{ id: "song.upload", title: "Add a render to this song", run }]);
 *
 * The function is called each time the palette opens, so what it returns can depend on
 * the state at that moment.
 */
import { onDestroy } from "svelte";

export interface Command {
  id: string;
  title: string;
  /** Shown dimmed after the title: where it goes or what it acts on. */
  sub?: string;
  group?: string;
  icon?: string;
  /** Extra words the search should match that are not in the title. */
  keywords?: string;
  /** The key that also does this, for showing. It is not bound here. */
  hint?: string;
  run: () => unknown;
}

const sources = new Set<() => Command[]>();

export function addCommands(source: () => Command[]): () => void {
  sources.add(source);
  return () => { sources.delete(source); };
}

/** Contribute commands for as long as the calling component is mounted. */
export function useCommands(source: () => Command[]) {
  onDestroy(addCommands(source));
}

export function allCommands(): Command[] {
  const out: Command[] = [];
  // Newest source first: the screen you are on outranks the shell.
  for (const source of [...sources].reverse()) {
    try { out.push(...source()); } catch (e) { console.error("[commands]", e); }
  }
  return out;
}
