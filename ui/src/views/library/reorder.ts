/* Drag to reorder, by pointer, and Alt+Up / Alt+Down from the keyboard.
 *
 * Put on a list whose direct children are each marked [data-reorder-item]; a child is
 * picked up by its [data-handle]. While dragging, the lifted row follows the pointer and
 * the rows it passes slide aside on a transform (nothing reflows, so it stays smooth);
 * only on release is the new order handed to `move`, after the row has settled into its
 * slot, so the data and the picture change in the same frame.
 */
export interface ReorderOptions {
  move: (from: number, to: number) => void;
  enabled?: boolean;
}

export function reorder(node: HTMLElement, options: ReorderOptions) {
  let opts = options;
  const items = () => Array.from(node.querySelectorAll<HTMLElement>(":scope > [data-reorder-item]"));

  interface Drag {
    from: number; to: number; list: HTMLElement[]; mid: number[]; height: number;
    startY: number; startScroll: number; scroller: HTMLElement | null; y: number; raf: number; id: number;
  }
  let drag: Drag | null = null;

  const scrolled = () => (drag?.scroller ? drag.scroller.scrollTop - drag.startScroll : 0);

  function place() {
    if (!drag) return;
    const d = drag;
    const dy = d.y - d.startY + scrolled();
    const lifted = d.list[d.from];
    lifted.style.transform = `translateY(${dy}px) scale(1.01)`;
    const centre = d.mid[d.from] + dy;
    let to = 0;
    d.mid.forEach((m, i) => { if (i !== d.from && m < centre) to++; });
    d.to = to;
    d.list.forEach((el, i) => {
      if (i === d.from) return;
      const shift = d.from < to && i > d.from && i <= to ? -d.height
        : d.from > to && i >= to && i < d.from ? d.height : 0;
      el.style.transform = shift ? `translateY(${shift}px)` : "";
    });
  }

  function tick() {
    if (!drag) return;
    const d = drag;
    if (d.scroller) {
      const box = d.scroller.getBoundingClientRect();
      const edge = 70;
      const up = d.y - (box.top + edge), down = d.y - (box.bottom - edge);
      if (up < 0) d.scroller.scrollTop -= Math.min(18, (-up) / 4);
      else if (down > 0) d.scroller.scrollTop += Math.min(18, down / 4);
      place();
    }
    d.raf = requestAnimationFrame(tick);
  }

  const onmove = (e: PointerEvent) => {
    if (!drag || e.pointerId !== drag.id) return;
    drag.y = e.clientY;
    place();
  };

  function finish(e: PointerEvent, cancelled: boolean) {
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag;
    drag = null;
    cancelAnimationFrame(d.raf);
    window.removeEventListener("pointermove", onmove);
    window.removeEventListener("pointerup", onup);
    window.removeEventListener("pointercancel", oncancel);
    const to = cancelled ? d.from : d.to;
    const lifted = d.list[d.from];
    // Settle into the slot, then let the data catch up in one frame.
    const rest = to === d.from ? 0
      : to > d.from ? d.mid[to] - d.mid[d.from] : d.mid[to] - d.mid[d.from];
    lifted.style.transition = "transform 180ms var(--spring), box-shadow 180ms";
    lifted.style.transform = `translateY(${rest}px)`;
    // The click that ends a drag belongs to the drag, not to the row under it.
    const eat = (ev: Event) => { ev.stopPropagation(); ev.preventDefault(); };
    node.addEventListener("click", eat, true);
    setTimeout(() => node.removeEventListener("click", eat, true), 60);
    setTimeout(() => {
      for (const el of d.list) { el.style.transition = "none"; el.style.transform = ""; el.classList.remove("lifted"); el.style.zIndex = ""; }
      if (to !== d.from) opts.move(d.from, to);
      requestAnimationFrame(() => { for (const el of d.list) el.style.transition = ""; });
    }, 190);
  }
  const onup = (e: PointerEvent) => finish(e, false);
  const oncancel = (e: PointerEvent) => finish(e, true);

  const ondown = (e: PointerEvent) => {
    if (opts.enabled === false || drag || e.button !== 0) return;
    const handle = (e.target as HTMLElement).closest("[data-handle]");
    const row = handle?.closest("[data-reorder-item]") as HTMLElement | null;
    if (!handle || !row || row.parentElement !== node) return;
    const list = items();
    const from = list.indexOf(row);
    if (from < 0 || list.length < 2) return;
    e.preventDefault();
    const rects = list.map((el) => el.getBoundingClientRect());
    const stride = list.length > 1 ? Math.abs(rects[1].top - rects[0].top) : rects[0].height;
    drag = {
      from, to: from, list, mid: rects.map((r) => r.top + r.height / 2), height: stride || rects[from].height,
      startY: e.clientY, startScroll: 0, scroller: node.closest<HTMLElement>("#scroller"), y: e.clientY, raf: 0, id: e.pointerId,
    };
    drag.startScroll = drag.scroller ? drag.scroller.scrollTop : 0;
    for (const el of list) el.style.transition = el === row ? "none" : "transform 200ms var(--spring)";
    row.classList.add("lifted");
    row.style.zIndex = "5";
    window.addEventListener("pointermove", onmove);
    window.addEventListener("pointerup", onup);
    window.addEventListener("pointercancel", oncancel);
    drag.raf = requestAnimationFrame(tick);
  };

  const onkey = (e: KeyboardEvent) => {
    if (opts.enabled === false || !e.altKey || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
    const row = (e.target as HTMLElement).closest("[data-reorder-item]") as HTMLElement | null;
    if (!row || row.parentElement !== node) return;
    const list = items();
    const from = list.indexOf(row);
    const to = from + (e.key === "ArrowUp" ? -1 : 1);
    if (to < 0 || to >= list.length) return;
    e.preventDefault();
    opts.move(from, to);
    // The list redraws in the new order; put the keyboard back on the row that moved.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const moved = items()[to]?.querySelector<HTMLElement>("[data-row]");
      moved?.focus();
    }));
  };

  node.addEventListener("pointerdown", ondown);
  node.addEventListener("keydown", onkey);
  return {
    update(next: ReorderOptions) { opts = next; },
    destroy() {
      node.removeEventListener("pointerdown", ondown);
      node.removeEventListener("keydown", onkey);
      if (drag) cancelAnimationFrame(drag.raf);
      window.removeEventListener("pointermove", onmove);
      window.removeEventListener("pointerup", onup);
      window.removeEventListener("pointercancel", oncancel);
    },
  };
}
