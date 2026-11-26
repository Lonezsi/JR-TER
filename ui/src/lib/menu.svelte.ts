/* The context menu.
 *
 * Right click, or a long press on a touch screen, on anything that is a thing: a song, a
 * render, an album, a version. The same list also opens from a "more" button, so nothing
 * is reachable only by a gesture somebody has to already know.
 */
export type MenuItem =
  | { label: string; icon?: string; hint?: string; run?: () => unknown;
      /** A second, smaller line under the label: what it is, not a shortcut. */
      sub?: string;
      danger?: boolean; disabled?: boolean; checked?: boolean; items?: MenuItem[] }
  | { divider: true }
  | { group: string }
  | null | undefined | false;

export interface OpenMenu {
  items: Exclude<MenuItem, null | undefined | false>[];
  x: number;
  y: number;
  /** When opened from a button, so it can sit under it rather than under the pointer. */
  anchor?: DOMRect;
}

export const menu = $state<{ open: OpenMenu | null }>({ open: null });

const clean = (items: MenuItem[]) => {
  const kept = items.filter(Boolean) as Exclude<MenuItem, null | undefined | false>[];
  // No divider first, last, or twice in a row: optional entries leave those behind.
  return kept.filter((item, i) => {
    if (!("divider" in item)) return true;
    const before = kept[i - 1];
    return i > 0 && i < kept.length - 1 && !(before && "divider" in before);
  });
};

export function showMenu(items: MenuItem[], at: { x: number; y: number } | { anchor: Element }) {
  const list = clean(items);
  if (!list.length) return;
  if ("anchor" in at) {
    const rect = at.anchor.getBoundingClientRect();
    menu.open = { items: list, x: rect.left, y: rect.bottom + 6, anchor: rect };
  } else {
    menu.open = { items: list, x: at.x, y: at.y };
  }
}

export function closeMenu() { menu.open = null; }

type Maker = (event: Event) => MenuItem[] | null | undefined;

/** `use:contextMenu={() => items}`: right click and long press open the menu. */
export function contextMenu(node: HTMLElement, make: Maker) {
  let current = make;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let startX = 0, startY = 0;
  let fired = false;

  const open = (event: Event, x: number, y: number) => {
    const items = current(event);
    if (!items || !items.length) return false;
    event.preventDefault();
    event.stopPropagation();
    showMenu(items, { x, y });
    return true;
  };
  const onContext = (e: MouseEvent) => {
    // Shift + right click is the browser's own menu, always: a power user sometimes
    // wants Inspect, or to copy a link address.
    if (e.shiftKey) return;
    open(e, e.clientX, e.clientY);
  };
  const onDown = (e: PointerEvent) => {
    if (e.pointerType === "mouse") return;
    fired = false;
    startX = e.clientX; startY = e.clientY;
    clearTimeout(timer);
    timer = setTimeout(() => {
      fired = open(e, startX, startY);
      if (fired && navigator.vibrate) { try { navigator.vibrate(12); } catch { /* refused */ } }
    }, 480);
  };
  const onMove = (e: PointerEvent) => {
    if (Math.abs(e.clientX - startX) > 8 || Math.abs(e.clientY - startY) > 8) clearTimeout(timer);
  };
  const cancel = () => clearTimeout(timer);
  // The click that follows a long press belongs to the menu, not to the row.
  const onClick = (e: MouseEvent) => {
    if (!fired) return;
    fired = false;
    e.preventDefault();
    e.stopPropagation();
  };

  node.addEventListener("contextmenu", onContext);
  node.addEventListener("pointerdown", onDown);
  node.addEventListener("pointermove", onMove);
  node.addEventListener("pointerup", cancel);
  node.addEventListener("pointercancel", cancel);
  node.addEventListener("click", onClick, true);
  return {
    update(make: Maker) { current = make; },
    destroy() {
      clearTimeout(timer);
      node.removeEventListener("contextmenu", onContext);
      node.removeEventListener("pointerdown", onDown);
      node.removeEventListener("pointermove", onMove);
      node.removeEventListener("pointerup", cancel);
      node.removeEventListener("pointercancel", cancel);
      node.removeEventListener("click", onClick, true);
    },
  };
}
