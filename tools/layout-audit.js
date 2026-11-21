/* Layout audit, run in the page (paste into the browser console or the browser tool) on
 * the screen to check. Companion to audit.js (which is about contrast).
 *
 * Reports what makes an interface look sloppy and can be measured:
 *   off-scale   gaps, paddings and margins that are not on the spacing scale (--s1..--s8)
 *   clipped     text cut off without an ellipsis, and boxes that overflow their parent
 *   short       blocks inside the screen that do not fill their column, though siblings do
 *   overlap     two controls whose boxes intersect
 *   small       controls under the minimum hit size (28px with a pointer, 40 with a finger)
 *   scrolls-x   anything wider than the window
 *   fonts       every font size in use, so strays stand out against the type scale
 */
(() => {
  const SCALE = [0, 1, 2, 4, 8, 12, 16, 20, 28, 40, 56];
  const coarse = matchMedia("(pointer: coarse)").matches;
  const near = (v) => SCALE.some((s) => Math.abs(v - s) <= 0.6);
  const name = (el) => {
    const c = typeof el.className === "string" ? el.className.trim().split(/\s+/).filter((x) => !x.startsWith("svelte-")).slice(0, 2).join(".") : "";
    return el.tagName.toLowerCase() + (c ? "." + c : "");
  };
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none" && parseFloat(cs.opacity) > 0.05;
  };
  const root = document.querySelector("#scroller") || document.body;
  const all = [...root.querySelectorAll("*")].filter(visible).filter((el) => !el.closest("svg,canvas"));
  const out = { "off-scale": {}, clipped: [], short: [], overlap: [], small: [], "scrolls-x": [], fonts: {} };

  for (const el of all) {
    const cs = getComputedStyle(el);
    // spacing: gap / padding / margin
    for (const prop of ["rowGap", "columnGap", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft", "marginTop", "marginBottom", "marginLeft", "marginRight"]) {
      const raw = cs[prop];
      if (!raw || raw === "normal" || raw === "auto") continue;
      const v = parseFloat(raw);
      if (!Number.isFinite(v) || v < 0 || near(v)) continue;
      const key = `${v}px`;
      (out["off-scale"][key] ||= new Set()).add(name(el) + " " + prop.replace(/([A-Z])/g, "-$1").toLowerCase());
    }
    // fonts
    if (el.childNodes.length && [...el.childNodes].some((n) => n.nodeType === 3 && n.nodeValue.trim())) {
      const f = `${parseFloat(cs.fontSize)}px/${cs.fontWeight}`;
      out.fonts[f] = (out.fonts[f] || 0) + 1;
    }
    // clipped text
    if (cs.overflowX !== "visible" && el.scrollWidth > el.clientWidth + 1 && cs.textOverflow !== "ellipsis" && el.clientWidth > 0
        && !/^(auto|scroll)$/.test(cs.overflowX)) {
      out.clipped.push(`${name(el)} ${el.scrollWidth}>${el.clientWidth}`);
    }
    // overflowing parent
    const p = el.parentElement;
    if (p && p !== document.body) {
      const pr = p.getBoundingClientRect(), r = el.getBoundingClientRect(), pcs = getComputedStyle(p);
      if (pcs.overflow === "visible" && cs.position !== "absolute" && cs.position !== "fixed" && (r.right > pr.right + 2 || r.left < pr.left - 2) && pr.width > 0) {
        out.clipped.push(`${name(el)} sticks out of ${name(p)} by ${Math.round(Math.max(r.right - pr.right, pr.left - r.left))}px`);
      }
    }
    // wider than the window
    if (el.getBoundingClientRect().right > innerWidth + 1 && cs.position !== "fixed") out["scrolls-x"].push(name(el));
  }

  // blocks that do not fill their column
  for (const col of root.querySelectorAll(".page, .screen, [class*=col], section")) {
    if (!visible(col)) continue;
    const cs = getComputedStyle(col);
    if (cs.display !== "flex" && cs.display !== "grid") continue;
    const inner = col.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    if (cs.flexDirection !== "column") continue;
    for (const kid of col.children) {
      if (!visible(kid)) continue;
      const kcs = getComputedStyle(kid);
      const r = kid.getBoundingClientRect();
      if (r.height < 36 || kcs.position === "absolute" || kcs.alignSelf === "flex-start" || kcs.display === "inline" || kcs.display === "inline-flex") continue;
      if (r.width < inner - 6 && r.width > 120) out.short.push(`${name(kid)} ${Math.round(r.width)} of ${Math.round(inner)} in ${name(col)}`);
    }
  }

  // controls: size and overlap
  const controls = all.filter((el) => el.matches("button, a[href], input:not([type=hidden]), select, [role=button], [role=slider]") && !el.closest(".sr-only"));
  const min = coarse ? 40 : 28;
  for (const el of controls) {
    const r = el.getBoundingClientRect();
    if (el.matches("input[type=range], .range, [role=slider]")) continue;
    if ((r.height < min - 1 || r.width < min - 1) && !(el.tagName === "A" && r.height >= 14 && el.textContent.trim().length > 3)) {
      out.small.push(`${name(el)} ${Math.round(r.width)}x${Math.round(r.height)}`);
    }
  }
  for (let i = 0; i < controls.length; i++) {
    const a = controls[i].getBoundingClientRect();
    for (let j = i + 1; j < controls.length; j++) {
      if (controls[i].contains(controls[j]) || controls[j].contains(controls[i])) continue;
      const b = controls[j].getBoundingClientRect();
      const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if (w > 3 && h > 3) out.overlap.push(`${name(controls[i])} x ${name(controls[j])} (${Math.round(w)}x${Math.round(h)})`);
    }
  }

  const trim = (list) => [...new Set(list)].slice(0, 14);
  return {
    "off-scale": Object.fromEntries(Object.entries(out["off-scale"]).sort((a, b) => b[1].size - a[1].size).slice(0, 12).map(([k, v]) => [k, [...v].slice(0, 5)])),
    clipped: trim(out.clipped), short: trim(out.short), overlap: trim(out.overlap), small: trim(out.small),
    "scrolls-x": trim(out["scrolls-x"]), fonts: out.fonts,
  };
})()
