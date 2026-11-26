/* Sorting a list, and remembering how you like it.
 *
 * One mechanism for every list, because "sort by name" has to mean the same thing and
 * look the same wherever it appears. A list declares which keys it can be sorted by; this
 * holds the choice and does the comparing. The choice is kept per list in this browser: a
 * preference about looking, not a fact about the library.
 *
 * The first key a list declares is its default, and a key with no `by` is "the order
 * somebody chose" (an album's running order, a playlist): it cannot be reversed, and
 * opening such a list re-sorted would be throwing that order away.
 */
import { store, byText } from "./util";

export interface SortKey<T> {
  key: string;
  label: string;
  by?: (item: T) => unknown;
  numeric?: boolean;
  dir?: "up" | "down";
}

type Kept = Record<string, { key: string; dir: "up" | "down" }>;
const KEY = "jriter.sort";
const kept = $state<{ map: Kept }>({ map: store.get<Kept>(KEY, {}) || {} });

export function sortOf<T>(list: string, keys: SortKey<T>[]) {
  const mine = kept.map[list];
  const spec = keys.find((k) => k.key === mine?.key) || keys[0];
  return { key: spec.key, dir: (mine?.key === spec.key && mine.dir) || spec.dir || "up", spec };
}

export function setSort(list: string, key: string, dir: "up" | "down") {
  kept.map = { ...kept.map, [list]: { key, dir } };
  store.set(KEY, kept.map);
}

/** Pressing the key a list is already sorted by turns it round. */
export function pickSort<T>(list: string, keys: SortKey<T>[], key: string) {
  const now = sortOf(list, keys);
  const spec = keys.find((k) => k.key === key) || keys[0];
  const dir = key === now.key && spec.by ? (now.dir === "down" ? "up" : "down") : (spec.dir || "up");
  setSort(list, key, dir);
}

/** A sorted copy. Never the array that was handed in. Anything missing sinks to the
 *  bottom whichever way round the list is, because an empty value is not a small one. */
export function sorted<T>(items: T[], list: string, keys: SortKey<T>[]): T[] {
  const { spec, dir } = sortOf(list, keys);
  if (!spec.by) return items.slice();
  const by = spec.by;
  const numeric = !!spec.numeric;
  const missing = (v: unknown) => v === null || v === undefined || v === ""
    || (numeric && !Number.isFinite(Number(v)));
  return items.slice().sort((a, b) => {
    const left = by(a), right = by(b);
    if (missing(left) || missing(right)) {
      if (missing(left) && missing(right)) return 0;
      return missing(left) ? 1 : -1;
    }
    const order = numeric ? Number(left) - Number(right) : byText(String(left), String(right));
    return dir === "down" ? -order : order;
  });
}
