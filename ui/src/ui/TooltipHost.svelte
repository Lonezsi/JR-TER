<!-- One tooltip for the whole app.

     Every hint in the app is written as an ordinary title="..." where it belongs. This takes
     them over: the first time the pointer rests on (or the keyboard focuses) something with a
     title, the title moves to data-tip, so the browser's own grey box never appears, and
     this draws the app's tooltip instead: glass, small, after a short rest, above the thing
     (below when there is no room), gone the moment you move on, click or press Escape.

     Mouse and keyboard only. On a touch screen there is no hover, and a long press already
     means "more" (the context menu), so no tooltips there.

     Accessible: a control whose only name was its title keeps it as aria-label, and while
     a tip shows it is the control's description (aria-describedby). -->
<script lang="ts">
  import { onMount } from "svelte";

  let text = $state("");
  let shown = $state(false);
  let x = $state(0), y = $state(0), below = $state(false);
  let tip = $state<HTMLElement>();
  let target: HTMLElement | null = null;
  let timer = 0;
  let lastHidden = 0;

  function claim(el: HTMLElement): string {
    const t = el.getAttribute("title");
    if (t !== null) {
      el.removeAttribute("title");
      if (t) {
        el.dataset.tip = t;
        if (!el.getAttribute("aria-label") && !(el.textContent || "").trim()) el.setAttribute("aria-label", t);
      }
    }
    return el.dataset.tip || "";
  }
  const owner = (n: EventTarget | null) =>
    (n instanceof Element ? n.closest<HTMLElement>("[title], [data-tip]") : null);

  function place() {
    if (!target || !tip) return;
    const r = target.getBoundingClientRect(), t = tip.getBoundingClientRect();
    below = r.top - t.height - 8 < 4;
    y = below ? r.bottom + 8 : r.top - t.height - 8;
    x = Math.max(6, Math.min(innerWidth - t.width - 6, r.left + r.width / 2 - t.width / 2));
  }
  function show(el: HTMLElement) {
    const said = claim(el);
    if (!said || document.documentElement.hasAttribute("data-narrow")) return;
    clearTimeout(timer);
    target = el;
    // Moving from one tipped thing to the next shows the next at once, like a menu bar.
    const wait = performance.now() - lastHidden < 350 ? 0 : 480;
    timer = window.setTimeout(() => {
      if (target !== el || !el.isConnected) return;
      text = said;
      shown = true;
      el.setAttribute("aria-describedby", "app-tip");
      requestAnimationFrame(place);
    }, wait);
  }
  function hide() {
    clearTimeout(timer);
    if (shown) lastHidden = performance.now();
    shown = false;
    target?.removeAttribute("aria-describedby");
    target = null;
  }

  onMount(() => {
    const over = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      const el = owner(e.target);
      if (el === target) return;
      if (!el) { hide(); return; }
      hide();
      show(el);
    };
    const focus = (e: FocusEvent) => {
      const el = owner(e.target);
      if (el && (e.target as Element).matches(":focus-visible")) { hide(); show(el); }
    };
    const away = () => hide();
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") hide(); };
    window.addEventListener("pointerover", over, true);
    window.addEventListener("focusin", focus, true);
    window.addEventListener("focusout", away, true);
    window.addEventListener("pointerdown", away, true);
    window.addEventListener("scroll", away, true);
    window.addEventListener("keydown", key, true);
    window.addEventListener("blur", away);
    return () => {
      window.removeEventListener("pointerover", over, true);
      window.removeEventListener("focusin", focus, true);
      window.removeEventListener("focusout", away, true);
      window.removeEventListener("pointerdown", away, true);
      window.removeEventListener("scroll", away, true);
      window.removeEventListener("keydown", key, true);
      window.removeEventListener("blur", away);
    };
  });
</script>

<div id="app-tip" role="tooltip" class="app-tip" class:on={shown} class:below bind:this={tip}
     style:left="{x}px" style:top="{y}px" aria-hidden={!shown}>{text}</div>

<style>
  .app-tip {
    position: fixed; z-index: 900; pointer-events: none; max-width: min(320px, 80vw);
    padding: 6px 10px; border-radius: var(--r-sm);
    font: 500 var(--t-sm)/1.35 var(--font); color: var(--text);
    background: var(--glass-2); box-shadow: var(--shadow-2), inset 0 0 0 1px var(--line-2);
    opacity: 0; transform: translateY(3px);
    transition: opacity 120ms var(--ease), transform 120ms var(--ease);
  }
  .app-tip.below { transform: translateY(-3px); }
  .app-tip.on { opacity: 1; transform: none; }
  @media (prefers-reduced-motion: reduce) { .app-tip { transition: none; } }
</style>
