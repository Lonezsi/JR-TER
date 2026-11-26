/* What the two canvases share: sizing at devicePixelRatio, colours read from the page,
 * and a paint loop that only runs while there is something moving to show.
 *
 * Painting is on demand. A still curve is painted once per change; the loop runs only
 * while the song is playing (the spectrum and the meters move) or a drag is in progress,
 * and only while the canvas is on screen and the tab is in front. */

export interface View {
  readonly w: number;
  readonly h: number;
  readonly ctx: CanvasRenderingContext2D;
  /** Paint once, soon. Cheap to call often: many calls in a frame are one paint. */
  schedule(): void;
  destroy(): void;
}

export interface Colours {
  accent: string; accentHi: string; accentRgb: string; warn: string; bad: string; text: string;
}

let cached: { at: number; value: Colours; of: Element } | null = null;

/** The page's colours, as a canvas can use them (it cannot hold a var()). The accent
 *  follows the music, so this is re-read, but not on every frame. */
export function colours(el: Element): Colours {
  const now = performance.now();
  if (cached && cached.of === el && now - cached.at < 250) return cached.value;
  const css = getComputedStyle(el);
  const read = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  const value = {
    accent: read("--accent", "#FAA8B8"),
    accentHi: read("--accent-hi", "#FBC0CB"),
    accentRgb: read("--accent-rgb", "250, 168, 184"),
    warn: read("--warn", "#FFC861"),
    bad: read("--bad", "#FF6B6B"),
    text: read("--text", "#F2F3F4"),
  };
  cached = { at: now, value, of: el };
  return value;
}

export const tint = (c: Colours, alpha: number) => `rgba(${c.accentRgb}, ${alpha})`;

const reduced = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

export function makeView(canvas: HTMLCanvasElement, paint: (view: View) => void,
                         running: () => boolean): View {
  const ctx = canvas.getContext("2d")!;
  let w = 1, h = 1, dpr = 1;
  let raf = 0;
  let last = 0;
  let onScreen = true;

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 3);
    const rect = canvas.getBoundingClientRect();
    w = Math.max(1, Math.round(rect.width));
    h = Math.max(1, Math.round(rect.height));
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  const view: View = {
    get w() { return w; },
    get h() { return h; },
    ctx,
    schedule() { if (!raf && onScreen && !document.hidden) raf = requestAnimationFrame(tick); },
    destroy() {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      resizer.disconnect();
      seen.disconnect();
      document.removeEventListener("visibilitychange", view.schedule);
    },
  };

  function tick(now: number) {
    raf = 0;
    // Reduced motion: the meters still tell the truth, just ten times a second.
    if (reduced() && last && now - last < 100 && running()) { view.schedule(); return; }
    last = now;
    if (Math.min(window.devicePixelRatio || 1, 3) !== dpr) resize();
    ctx.clearRect(0, 0, w, h);
    paint(view);
    if (running()) view.schedule();
  }

  const resizer = new ResizeObserver(() => { resize(); view.schedule(); });
  resizer.observe(canvas);
  const seen = new IntersectionObserver((entries) => {
    onScreen = entries[entries.length - 1]?.isIntersecting ?? true;
    if (onScreen) view.schedule();
  });
  seen.observe(canvas);
  document.addEventListener("visibilitychange", view.schedule);
  resize();
  view.schedule();
  return view;
}

/** A wheel listener that may preventDefault: Svelte's own `onwheel` is passive. */
export function wheel(node: HTMLElement, handler: (e: WheelEvent) => void) {
  let current = handler;
  const listener = (e: WheelEvent) => current(e);
  node.addEventListener("wheel", listener, { passive: false });
  return {
    update(next: (e: WheelEvent) => void) { current = next; },
    destroy() { node.removeEventListener("wheel", listener); },
  };
}
