/* use:slideBack: a pop-out that follows a drag the way it slid in, and goes away if you
 * let go far enough along (or flick it). Short of that it springs back. A drag has to move
 * 8px, mostly along the axis, before it counts, so a tap on anything inside is still a tap.
 *
 *   <div use:slideBack={{ close, dir: "down" }}>     a bottom sheet
 *   <div use:slideBack={{ close, dir: "left" }}>     something that came from the left
 */
type Dir = "down" | "left" | "right" | "up";
interface Opts { close: () => void; dir: Dir; enabled?: boolean }

const LOCK = 8, FLICK = 0.45, BAND = 0.25;

export function slideBack(node: HTMLElement, opts: Opts) {
  let o = opts;
  let start: { x: number; y: number; id: number; t: number } | null = null;
  let locked = false, offset = 0, v = 0, lastT = 0, lastP = 0;
  const along = (e: PointerEvent) => (o.dir === "down" || o.dir === "up" ? e.clientY : e.clientX);
  const sign = () => (o.dir === "down" || o.dir === "right" ? 1 : -1);
  const set = (px: number) => {
    const axis = o.dir === "down" || o.dir === "up" ? "Y" : "X";
    node.style.transform = px ? `translate${axis}(${px}px)` : "";
  };

  function down(e: PointerEvent) {
    if (o.enabled === false || e.button) return;
    const t = e.target as Element;
    // Things that take a drag themselves keep it.
    if (t.closest("input, textarea, select, .range, .track, canvas, [data-swipe], [role='slider']")) return;
    start = { x: e.clientX, y: e.clientY, id: e.pointerId, t: e.timeStamp };
    locked = false; offset = 0; v = 0; lastT = e.timeStamp; lastP = along(e);
  }
  function move(e: PointerEvent) {
    if (!start || e.pointerId !== start.id) return;
    const dx = e.clientX - start.x, dy = e.clientY - start.y;
    const vertical = o.dir === "down" || o.dir === "up";
    const main = vertical ? dy : dx, cross = vertical ? dx : dy;
    if (!locked) {
      if (Math.abs(cross) >= LOCK && Math.abs(cross) > Math.abs(main)) { start = null; return; }
      if (Math.abs(main) < LOCK) return;
      // A sheet whose content is scrolled down keeps a downward drag for its scroll.
      const scroller = (e.target as Element).closest?.("[data-scrolls]") as HTMLElement | null;
      if (vertical && scroller && scroller.scrollTop > 0) { start = null; return; }
      locked = true;
      node.style.transition = "none";
      try { node.setPointerCapture(e.pointerId); } catch { /* fine */ }
    }
    const raw = main * sign();
    offset = raw >= 0 ? raw : raw * BAND;           // the wrong way gives a little, like a wall
    if (e.timeStamp - lastT >= 8) { v = ((along(e) - lastP) * sign()) / (e.timeStamp - lastT); lastP = along(e); lastT = e.timeStamp; }
    set(offset * sign());
  }
  function up(e: PointerEvent) {
    if (!start || e.pointerId !== start.id) return;
    start = null;
    if (!locked) return;
    node.style.transition = "";
    const size = o.dir === "down" || o.dir === "up" ? node.offsetHeight : node.offsetWidth;
    const go = v >= FLICK || (v > -FLICK && offset > size * 0.3);
    if (go) {
      // Off the rest of the way from where the finger left it, then closed.
      node.style.transition = "transform 200ms cubic-bezier(0.2, 0.8, 0.3, 1)";
      set(size * 1.1 * sign());
      setTimeout(() => o.close(), 180);
      // A swipe is not a click on whatever it started on.
      const eat = (c: Event) => { c.stopPropagation(); c.preventDefault(); };
      window.addEventListener("click", eat, { capture: true, once: true });
      setTimeout(() => window.removeEventListener("click", eat, { capture: true }), 400);
    } else {
      set(0);
    }
  }
  node.addEventListener("pointerdown", down);
  window.addEventListener("pointermove", move, { passive: true });
  window.addEventListener("pointerup", up);
  window.addEventListener("pointercancel", up);
  return {
    update(next: Opts) { o = next; },
    destroy() {
      node.removeEventListener("pointerdown", down);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    },
  };
}
