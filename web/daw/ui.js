// ui.js: JR!TER's own controls on the DAW's plain HTML. The views write <select>, <input type=number>,
// <input type=range> and data-tip into innerHTML; this fits each of them with the app's own control as it
// appears, and leaves the real element underneath doing the work, so every handler that reads .value or
// listens for "change" keeps working and a script can still set them.
//
//   <select>               a field button and a glass menu (arrows, Home, End, Enter, Escape, typing a letter)
//   <input type=number>    no browser spinners: a stepper of two chevrons, and the wheel steps it while focused
//   <input type=range>     the filled track (--fill), as the app's sliders draw it
//   [data-tip]             one tooltip on glass, placed above or below and kept on screen; never on touch
//
// Loaded once by daw.html. Nothing here knows about songs.

const CHEV = (d) => `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`;
const DOWN = "M6 9l6 6 6-6", UP = "M6 15l6-6 6 6";
const touch = matchMedia("(hover: none)");

// ---- dropdowns ------------------------------------------------------------------------------------
let menu = null; // the one open menu: { box, select, button, items, at }

function labelOf(select) {
  if (select.getAttribute("aria-label")) return select.getAttribute("aria-label");
  const l = select.closest("label");
  return l ? l.textContent.replace(/\s+/g, " ").trim() : "Choose";
}
function sync(select) {
  const b = select._dd;
  if (!b) return;
  const o = select.options[select.selectedIndex];
  const t = b.querySelector(".dd-text"), want = o ? o.textContent : "";
  if (t.textContent !== want) t.textContent = want;   // writing it anyway is a mutation, which would call this again
  if (b.disabled !== select.disabled) b.disabled = select.disabled;
}
function fit(select) {
  if (select._dd) return sync(select);
  const b = document.createElement("button");
  b.type = "button"; b.className = "dd";
  b.setAttribute("aria-haspopup", "listbox"); b.setAttribute("aria-expanded", "false");
  b.setAttribute("aria-label", labelOf(select));
  b.innerHTML = `<span class="dd-text"></span>${CHEV(DOWN)}`;
  b.addEventListener("click", () => (menu && menu.select === select ? close() : openMenu(select)));
  b.addEventListener("keydown", (e) => { if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); openMenu(select); } });
  select._dd = b;
  select.classList.add("dd-native"); select.tabIndex = -1; select.setAttribute("aria-hidden", "true");
  select.after(b);
  sync(select);
}
function openMenu(select) {
  close();
  const b = select._dd, r = b.getBoundingClientRect();
  const box = document.createElement("div");
  box.className = "dd-menu"; box.setAttribute("role", "listbox"); box.setAttribute("aria-label", labelOf(select));
  const items = [...select.options].map((o, i) => {
    const it = document.createElement("button");
    it.type = "button"; it.className = "dd-item"; it.setAttribute("role", "option");
    it.setAttribute("aria-selected", i === select.selectedIndex);
    it.disabled = o.disabled; it.tabIndex = -1;
    it.innerHTML = `<span class="dd-mark" aria-hidden="true">${i === select.selectedIndex ? "✓" : ""}</span><span class="dd-label"></span>`;
    it.querySelector(".dd-label").textContent = o.textContent;
    it.addEventListener("click", () => choose(i));
    box.append(it);
    return it;
  });
  document.body.append(box);
  // Under the field, or above it when there is no room; never off the screen.
  const h = box.offsetHeight, w = Math.max(r.width, box.offsetWidth);
  const below = innerHeight - r.bottom - 8 >= Math.min(h, 260) || r.top < innerHeight / 2;
  box.style.minWidth = r.width + "px";
  box.style.left = Math.max(8, Math.min(r.left, innerWidth - w - 8)) + "px";
  if (below) { box.style.top = r.bottom + 6 + "px"; box.style.maxHeight = innerHeight - r.bottom - 14 + "px"; }
  else { box.style.bottom = innerHeight - r.top + 6 + "px"; box.style.maxHeight = r.top - 14 + "px"; box.classList.add("up"); }
  b.setAttribute("aria-expanded", "true");
  menu = { box, select, button: b, items, at: Math.max(0, select.selectedIndex) };
  focusItem(menu.at);
}
function focusItem(i) {
  if (!menu) return;
  menu.at = Math.max(0, Math.min(menu.items.length - 1, i));
  const it = menu.items[menu.at];
  it.focus({ preventScroll: true });
  it.scrollIntoView({ block: "nearest" });
}
function choose(i) {
  const { select, button } = menu;
  close();
  button.focus();
  if (i === select.selectedIndex) return;
  select.selectedIndex = i;
  select.dispatchEvent(new Event("input", { bubbles: true }));
  select.dispatchEvent(new Event("change", { bubbles: true }));
  sync(select);
}
function close() {
  if (!menu) return;
  menu.button.setAttribute("aria-expanded", "false");
  menu.box.remove();
  menu = null;
}
let typed = "", typedAt = 0;
addEventListener("keydown", (e) => {
  if (!menu) return;
  const k = e.key, n = menu.items.length;
  if (k === "Escape" || k === "Tab") { const b = menu.button; close(); if (k === "Escape") { e.preventDefault(); e.stopPropagation(); b.focus(); } return; }
  if (k === "ArrowDown" || k === "ArrowUp") { e.preventDefault(); e.stopPropagation(); focusItem(menu.at + (k === "ArrowDown" ? 1 : -1)); return; }
  if (k === "Home" || k === "End") { e.preventDefault(); e.stopPropagation(); focusItem(k === "Home" ? 0 : n - 1); return; }
  if (k === "Enter" || k === " ") { e.preventDefault(); e.stopPropagation(); choose(menu.at); return; }
  if (k.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
    e.preventDefault(); e.stopPropagation();
    typed = (performance.now() - typedAt > 700 ? "" : typed) + k.toLowerCase(); typedAt = performance.now();
    const j = menu.items.findIndex((it) => it.textContent.trim().toLowerCase().startsWith(typed));
    if (j >= 0) focusItem(j);
  }
}, true);
// A menu never clings: a press anywhere else, a scroll of the page or a resize closes it.
addEventListener("pointerdown", (e) => { if (menu && !menu.box.contains(e.target) && !menu.button.contains(e.target)) close(); }, true);
addEventListener("resize", close);
addEventListener("scroll", (e) => { if (menu && !menu.box.contains(e.target)) close(); }, true);

// ---- number fields ---------------------------------------------------------------------------------
function step(input, dir) {
  if (input.disabled || input.readOnly) return;
  const before = input.value;
  try { dir > 0 ? input.stepUp() : input.stepDown(); } catch { input.value = (+input.value || 0) + dir * (+input.step || 1); }
  if (input.value === before) return;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}
function fitNumber(input) {
  if (input._nf || input.closest(".nf")) return;
  const wrap = document.createElement("span");
  wrap.className = "nf";
  input.before(wrap); wrap.append(input);
  const s = document.createElement("span");
  s.className = "nf-step";
  s.innerHTML = `<button type="button" tabindex="-1" aria-hidden="true" data-d="1">${CHEV(UP)}</button><button type="button" tabindex="-1" aria-hidden="true" data-d="-1">${CHEV(DOWN)}</button>`;
  s.addEventListener("pointerdown", (e) => e.preventDefault()); // keep focus in the field
  s.addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) step(input, +b.dataset.d); });
  wrap.append(s);
  input._nf = true;
  input.addEventListener("wheel", (e) => { if (document.activeElement !== input) return; e.preventDefault(); step(input, e.deltaY < 0 ? 1 : -1); }, { passive: false });
}

// ---- sliders ----------------------------------------------------------------------------------------
function fill(r) {
  const lo = +r.min || 0, hi = r.max === "" ? 100 : +r.max, v = +r.value;
  r.style.setProperty("--fill", (hi > lo ? ((v - lo) / (hi - lo)) * 100 : 0) + "%");
}
addEventListener("input", (e) => { if (e.target.matches?.('input[type="range"]')) fill(e.target); }, true);

// ---- tooltips ---------------------------------------------------------------------------------------
const tip = document.createElement("div");
tip.className = "app-tip"; tip.setAttribute("role", "tooltip");
let tipFor = null, tipTimer = 0;
function showTip(el) {
  const text = el.dataset.tip;
  if (!text || touch.matches) return;
  tipFor = el;
  if (!tip.isConnected) document.body.append(tip);
  tip.textContent = text;
  tip.classList.remove("on", "below");
  const r = el.getBoundingClientRect(), w = tip.offsetWidth, h = tip.offsetHeight;
  const below = r.top - h - 8 < 8;
  tip.classList.toggle("below", below);
  tip.style.left = Math.max(8, Math.min(innerWidth - w - 8, r.left + r.width / 2 - w / 2)) + "px";
  tip.style.top = (below ? r.bottom + 8 : r.top - h - 8) + "px";
  requestAnimationFrame(() => { if (tipFor === el) tip.classList.add("on"); });
}
function hideTip() { clearTimeout(tipTimer); tipFor = null; tip.classList.remove("on"); }
addEventListener("pointerover", (e) => {
  const el = e.target.closest?.("[data-tip]");
  if (el === tipFor) return;
  hideTip();
  if (el && e.pointerType !== "touch") tipTimer = setTimeout(() => showTip(el), 350);
});
addEventListener("focusin", (e) => { const el = e.target.closest?.("[data-tip]"); if (el && el.matches(":focus-visible")) showTip(el); });
addEventListener("focusout", hideTip);
addEventListener("pointerdown", hideTip, true);
addEventListener("scroll", hideTip, true);

// ---- fitting things as they appear -------------------------------------------------------------------
function fitAll(root) {
  if (!root.querySelectorAll) return;
  for (const s of root.querySelectorAll("select")) fit(s);
  for (const n of root.querySelectorAll('input[type="number"]')) fitNumber(n);
  for (const r of root.querySelectorAll('input[type="range"]')) fill(r);
  // A data-tip element keeps the browser's own title quiet, so there are never two tooltips.
}
new MutationObserver((records) => {
  let again = false;
  for (const r of records) {
    if (r.target.tagName === "SELECT") { sync(r.target); continue; }
    // Our own furniture changing (a label, the tooltip, a menu) is not new content to fit.
    if (r.target.closest?.(".dd, .dd-menu, .app-tip, .nf-step") || r.target === tip) continue;
    for (const n of r.addedNodes) if (n.nodeType === 1 && !n.matches(".dd, .dd-menu, .app-tip, .nf-step, .nf")) { again = true; break; }
  }
  if (again) fitAll(document.body);
  if (menu && !menu.select.isConnected) close();
  if (tipFor && !tipFor.isConnected) hideTip();
}).observe(document.body, { childList: true, subtree: true });
// A script setting .value or .selectedIndex is not a mutation: the field catches up on the next frame it is seen.
addEventListener("change", (e) => { if (e.target.tagName === "SELECT") sync(e.target); }, true);
setInterval(() => { for (const s of document.querySelectorAll("select.dd-native")) sync(s); for (const r of document.querySelectorAll('input[type="range"]')) fill(r); }, 500);
fitAll(document.body);
