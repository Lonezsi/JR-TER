/* Opening a thing grows it out of where it was; going back shrinks it into its place again.
 *
 * The browser's view transitions do the drawing. The cover that was pressed (a row, a card)
 * and the cover at the top of the screen it opens are given the same transition name for
 * the length of the change, so the browser morphs one into the other while the rest of the
 * screen crossfades. Going back, the screen remembers which of the identical links was the
 * one pressed (a song can be in "Jump back in" and in "All songs" at once) and the hero
 * shrinks into that one.
 *
 * Only the covers are named, and only during the change: two elements with one name on a
 * screen abort the whole transition, so nothing carries a name at rest.
 *
 * Where there is no view transition (an older engine, reduced motion) the screen changes
 * the way it always has.
 *
 * PUBLIC API
 *   startMorph()                   listen for which link was pressed (once, at boot)
 *   changeScreen(from, to, apply)  run `apply` (which swaps the screen) inside a morph
 */
import { tick } from "svelte";

const NAME = "morph";
const OPENS = /^#\/(song|album|playlist|shared\/\d+\/edit)\//;

let pressed: { el: HTMLElement; at: number } | null = null;
/** Where to shrink back to: the address that was left, and which link on it was pressed. */
let origin: { hash: string; target: string; index: number } | null = null;

export function startMorph() {
  document.addEventListener("click", (e) => {
    const a = (e.target as Element | null)?.closest?.("a[href^='#/']") as HTMLElement | null;
    if (a) pressed = { el: a, at: performance.now() };
  }, true);
}

const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const shown = (el: Element) => {
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight;
};
/* The whole object moves, not just its picture: an album's case (with its disc and
 * stickers) and a playlist's stack go as one, so nothing pops in after the move. */
const OBJECT = ".albumart, .plart";
const coverIn = (el: Element | null | undefined) =>
  (el?.querySelector(OBJECT) || el?.closest(OBJECT) || el?.querySelector(".cover") || el?.closest(".cover") || null) as HTMLElement | null;
const hero = () => document.querySelector<HTMLElement>(".screen .hero-cover");

/* The screen being opened fills in as its fetch lands, so its hero may not be there on the
 * first frame. Waited for briefly, inside the transition (the old screen stays on show
 * meanwhile); if it never comes, the pressed cover simply fades with the rest. */
async function waitFor(find: () => HTMLElement | null, ms = 320): Promise<HTMLElement | null> {
  const until = performance.now() + ms;
  for (;;) {
    const el = find();
    if (el || performance.now() > until) return el;
    // A timer, not a frame: while a transition is being prepared the browser renders no
    // frames, so waiting for one would hang until it gave up on the transition.
    await new Promise((r) => setTimeout(r, 16));
  }
}

export function changeScreen(from: string, to: string, apply: () => void) {
  const doc = document as Document & { startViewTransition?: (cb: () => Promise<void>) =>
    { finished: Promise<void>; ready: Promise<void>; updateCallbackDone: Promise<void> } };
  if (!doc.startViewTransition || reduced()) { apply(); return; }

  let source: HTMLElement | null = null;
  let findTarget: (() => HTMLElement | null) | null = null;
  const link = pressed && performance.now() - pressed.at < 1500 && pressed.el.isConnected
    && pressed.el.getAttribute("href") === to ? pressed.el : null;
  pressed = null;

  if (link && OPENS.test(to)) {
    source = coverIn(link);
    const same = [...document.querySelectorAll(`a[href="${CSS.escape(to)}"]`)];
    origin = { hash: from, target: to, index: Math.max(0, same.indexOf(link)) };
    findTarget = hero;
  } else if (origin && to === origin.hash) {
    const o = origin;
    source = hero();
    findTarget = () => {
      const same = [...document.querySelectorAll(`a[href="${CSS.escape(o.target)}"]`)];
      const pick = same[o.index] && shown(same[o.index]) ? same[o.index] : same.find(shown);
      return coverIn(pick);
    };
    origin = null;
  } else if (!OPENS.test(to)) {
    origin = null;
  }

  if (!source || !shown(source)) { apply(); return; }

  const root = document.documentElement;
  source.style.viewTransitionName = NAME;
  root.classList.add("morphing");
  let target: HTMLElement | null = null;
  const t = doc.startViewTransition(async () => {
    source!.style.viewTransitionName = "";
    apply();
    await tick();
    // The crossfade is this screen's arrival, so its own rise is taken off the element for
    // good. Switched off by a class on <html> instead, it started over (from invisible) the
    // moment the class went: a blank frame and a second arrival after the morph.
    document.querySelectorAll(".screen.enter, .screen .enter").forEach((el) => el.classList.remove("enter"));
    target = findTarget ? await waitFor(findTarget) : null;
    if (target) target.style.viewTransitionName = NAME;
  });
  // A transition can be skipped (another one started, the tab was hidden): the screen has
  // changed regardless, so a skipped animation is not an error worth reporting.
  t.ready.catch(() => {});
  t.updateCallbackDone.catch(() => {});
  t.finished.catch(() => {}).finally(() => {
    if (target) target.style.viewTransitionName = "";
    root.classList.remove("morphing");
  });
}
