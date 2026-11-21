/* Contrast audit for the interface, run in the page (paste into the browser console, or
 * the browser tool, with the app open on the screen to check).
 *
 *   returns every piece of visible text whose contrast is under WCAG AA (4.5, or 3 for large
 *   text) against its background, worst first.
 *
 * The glass is CSS (a light film over the blurred artwork), so the colour behind a label is
 * not in any stylesheet and cannot be read back. This measures against what the DOM does
 * say (the layers of translucent background between the text and the page) laid over a
 * stand-in ground. Set window.__ground = [r, g, b] first to check against a particular
 * artwork's colour, e.g. the brightest cover in the library. Without it the ground is a mid
 * dark pink, which is the hard case.
 */
(() => {
  const parse = (c) => {
    let m = c.match(/^rgba?\(([^)]+)\)$/);
    if (m) { const p = m[1].split(/[ ,\/]+/).filter(Boolean).map(parseFloat); return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1]; }
    m = c.match(/^color\(srgb ([^)]+)\)$/);
    if (m) { const p = m[1].split(/[ \/]+/).filter(Boolean).map(parseFloat); return [p[0] * 255, p[1] * 255, p[2] * 255, p.length > 3 ? p[3] : 1]; }
    return [0, 0, 0, 0];
  };
  const lum = ([r, g, b]) => {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const ratio = (a, b) => { const l1 = lum(a), l2 = lum(b); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); };
  const over = (fg, bg) => [0, 1, 2].map((i) => fg[i] * fg[3] + bg[i] * (1 - fg[3]));

  const items = [], pts = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const n = walker.currentNode;
    if (!n.nodeValue.trim()) continue;
    const el = n.parentElement;
    if (!el || el.closest("script,style,canvas,svg,.sr-only,[hidden]")) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.display === "none") continue;
    const range = document.createRange(); range.selectNodeContents(n);
    const r = range.getBoundingClientRect();
    if (r.width < 2 || r.height < 2 || r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) continue;
    let op = 1; const overlay = [];
    for (let e = el; e && e !== document.body; e = e.parentElement) {
      const s = getComputedStyle(e);
      op *= parseFloat(s.opacity);
      const bg = parse(s.backgroundColor);
      if (bg[3] > 0) overlay.push(bg);
    }
    items.push({ n, el, cs, op, overlay });
    pts.push([r.left + r.width / 2, r.top + r.height / 2]);
  }
  const ground = window.__ground || [92, 36, 66];
  const base = pts.map(() => ground);
  const seen = new Set(), out = [];
  items.forEach((it, i) => {
    let bg = base[i];
    for (let k = it.overlay.length - 1; k >= 0; k--) bg = over(it.overlay[k], bg);
    const f = parse(it.cs.color);
    const fg = over([f[0], f[1], f[2], f[3] * it.op], bg);
    const cr = ratio(fg, bg);
    const size = parseFloat(it.cs.fontSize), bold = parseInt(it.cs.fontWeight) >= 700;
    const need = size >= 24 || (size >= 18.66 && bold) ? 3 : 4.5;
    if (cr >= need) return;
    const cls = (typeof it.el.className === "string" ? it.el.className : "").split(" ")[0] || it.el.tagName.toLowerCase();
    const key = it.n.nodeValue.trim().slice(0, 30) + "|" + cls;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ text: it.n.nodeValue.trim().slice(0, 34), ratio: +cr.toFixed(2), need, px: size, in: cls });
  });
  return out.sort((a, b) => a.ratio - b.ratio);
})()
