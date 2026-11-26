/* A pop-out on a phone grows out of the control that opened it and shrinks back into it:
 * the pane is revealed from that control's own box outwards with clip-path. Clip only,
 * never opacity or filter: the panes are glass, and fading glass (or anything above it)
 * cuts its blur off.
 *
 *   in:growFrom={{ from: ".tabs .tabsearch" }} out:growFrom={{ from: ... }}
 *
 * When the control isn't on screen (or motion is reduced) it falls back to `fallback`,
 * or to no animation.
 */
import type { TransitionConfig } from "svelte/transition";
import { cubicOut } from "svelte/easing";

export function growFrom(node: Element, opts: { from: string | (() => Element | null); duration?: number; radius?: number; fallback?: () => TransitionConfig }): TransitionConfig {
  const el = typeof opts.from === "string" ? document.querySelector(opts.from) : opts.from();
  const box = el?.getBoundingClientRect();
  if (!box || !box.width || matchMedia("(prefers-reduced-motion: reduce)").matches) return opts.fallback?.() ?? { duration: 0 };
  const p = node.getBoundingClientRect();
  const top = box.top - p.top, left = box.left - p.left, right = p.right - box.right, bottom = p.bottom - box.bottom;
  const r = opts.radius ?? 22;
  return {
    duration: opts.duration ?? 380, easing: cubicOut,
    css: (t) => {
      const k = 1 - t;
      return `clip-path: inset(${top * k}px ${right * k}px ${bottom * k}px ${left * k}px round ${Math.round(r * k + 18 * t)}px);`;
    },
  };
}
