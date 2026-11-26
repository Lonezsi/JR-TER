/* One tab stop for a whole list, and the arrows move within it.
 *
 * Every row focusable would make three hundred songs three hundred tab stops between the
 * filter box and the player. This is how a listbox has always worked. A row is anything
 * marked [data-row]; the list is the nearest [data-rows] ancestor (or the row's parent),
 * so a page of mixed results can be one list across its headings.
 */
const scopeOf = (node: HTMLElement): HTMLElement =>
  (node.closest("[data-rows]") as HTMLElement | null) || node.parentElement || node;

const rowsIn = (scope: HTMLElement) =>
  Array.from(scope.querySelectorAll<HTMLElement>("[data-row]"));

function land(scope: HTMLElement, on: HTMLElement | undefined) {
  if (!on) return;
  for (const row of rowsIn(scope)) row.tabIndex = row === on ? 0 : -1;
  on.focus();
  on.scrollIntoView({ block: "nearest" });
}

/** Make sure the list can be tabbed into at all: exactly one row holds the stop. */
function settle(scope: HTMLElement) {
  if (!scope.isConnected) return;
  const all = rowsIn(scope);
  if (!all.length || all.some((row) => row.tabIndex === 0)) return;
  all[0].tabIndex = 0;
}

export function navRow(node: HTMLElement) {
  node.dataset.row = "";
  node.tabIndex = -1;
  const scope = scopeOf(node);
  queueMicrotask(() => settle(scope));

  const onkey = (e: KeyboardEvent) => {
    // Alt and the arrows is "move this row", which belongs to whoever owns the order.
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    const all = rowsIn(scopeOf(node));
    const at = all.indexOf(node);
    if (at < 0) return;
    const to = e.key === "ArrowDown" ? all[Math.min(at + 1, all.length - 1)]
      : e.key === "ArrowUp" ? all[Math.max(at - 1, 0)]
      : e.key === "Home" ? all[0]
      : e.key === "End" ? all[all.length - 1] : undefined;
    if (!to) return;
    e.preventDefault();
    land(scopeOf(node), to);
  };
  const onfocus = () => {
    for (const row of rowsIn(scopeOf(node))) row.tabIndex = row === node ? 0 : -1;
  };
  node.addEventListener("keydown", onkey);
  node.addEventListener("focus", onfocus);
  return {
    destroy() {
      node.removeEventListener("keydown", onkey);
      node.removeEventListener("focus", onfocus);
      // The row that held the stop has gone: hand it to another.
      queueMicrotask(() => settle(scope));
    },
  };
}
