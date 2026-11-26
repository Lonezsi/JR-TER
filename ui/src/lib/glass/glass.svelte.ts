/* The glass shader, as the rest of the app sees it.
 *
 *   glassGL.attach(canvas)     Ground.svelte hands over its canvas once
 *   glassGL.mode(m)            the Backdrop blur setting: "native", "gl" or "off"
 *   glassGL.ground(url, hue)   what is behind everything; returns whether the shader took it
 *   glassGL.look({edge, dust}) the Chromatic aberration and Dust dials
 *   use:pane                   this element is a pane of glass: blur and split behind it
 *
 * When the shader is not running (switched off, no WebGL2, a lost context, reduced
 * transparency) `glass.active` is false, the CSS ground is shown instead, and the 2D dust in
 * lib/ambient takes over. The panes themselves are CSS either way, so they look the same.
 *
 * Nothing is drawn unless something changed: a pane moved, the ground is fading, the dust is
 * drifting, or a dial moved. Idle, a frame costs reading a few rectangles.
 */
import { GlassGL, type PaneInfo, type Speck } from "./gl";
import { dust as dust2d } from "../ambient";
import { clamp } from "../util";

export const glass = $state({ active: false });

let gl: GlassGL | null = null;
let canvas: HTMLCanvasElement | null = null;
let wanted = false;
let native = true;
let raf = 0;
let lastKey = "";
let ground: { url: string | null; hue: number | null } = { url: null, hue: null };
let edgeDial = 100;
let dustDial = 100;
const panes = new Set<HTMLElement>();
/* A pane that asked to arrive late (`use:pane={{ delay, fade }}`): its shader light (the
 * colour split, the dust it blurs) shimmers in after the pane's own entrance is over, so
 * nothing shows up before the thing it belongs to. */
const arrive = new Map<HTMLElement, { at: number; delay: number; fade: number }>();
function arrival(el: HTMLElement): number {
  const a = arrive.get(el);
  if (!a) return 1;
  const k = (performance.now() - a.at - a.delay) / a.fade;
  if (k >= 1) { arrive.delete(el); return 1; }
  return k <= 0 ? 0 : k * k * (3 - 2 * k);
}
const radii = new WeakMap<HTMLElement, { key: string; r: number }>();

const reducedTransparency = () => matchMedia("(prefers-reduced-transparency: reduce)").matches;
const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const dprNow = () => Math.min(window.devicePixelRatio || 1, 2);

// ── the particles ───────────────────────────────────────────────────────────────────────
//
// The same dust lib/ambient draws in 2D, here so the panes blur it. White, slow, all
// drifting the same way (air moving, not noise), each breathing in and out on its own
// period. Only when there is no artwork: a picture behind the app is what the dust stood
// in for. Positions are css px.

interface Mote { x: number; y: number; size: number; peak: number; vx: number; vy: number; phase: number; period: number }
let motes: Mote[] = [];
let lastDust = 0;
const DUST_FPS = 30;
const DUST_GAIN = 5;

const dustOn = () => !ground.url && dustDial > 0 && !!gl;

function seedDust() {
  const power = dustDial / 100;
  const room = (innerWidth * innerHeight) / 18000;
  const many = Math.round(clamp(room, 18, 90) * Math.min(power, 1));
  motes = [];
  for (let i = 0; i < many; i++) {
    motes.push({
      x: Math.random() * innerWidth,
      y: Math.random() * innerHeight,
      size: 8 + Math.random() * (15 + 8 * power),
      peak: (0.05 + Math.random() * 0.12) + 0.55 * Math.pow(power, 1.6) * (0.3 + Math.random() * 0.7),
      vx: 1 + Math.random() * 2,
      vy: -(0.2 + Math.random() * 0.8),
      phase: Math.random(),
      period: 7000 + Math.random() * 8000,
    });
  }
}

function stepDust(t: number, dt: number): Speck[] {
  const dpr = dprNow();
  const out: Speck[] = [];
  const still = reducedMotion();
  for (const m of motes) {
    if (!still) {
      m.x += m.vx * dt / 1000;
      m.y += m.vy * dt / 1000;
      if (m.x - m.size > innerWidth) m.x = -m.size;
      if (m.y + m.size < 0) m.y = innerHeight + m.size;
    }
    const breathe = still ? 1 : 0.55 + 0.45 * Math.sin(2 * Math.PI * (t / m.period + m.phase));
    // Brighter than the 2D dust on purpose: here a speck is spread across a 16px blur, so
    // most of its light lands on its neighbours, and at the 2D brightness it vanished.
    out.push({ x: m.x * dpr, y: m.y * dpr, r: (m.size / 2) * dpr, a: Math.min(1, m.peak * breathe * DUST_GAIN) });
  }
  return out;
}

// ── the panes ───────────────────────────────────────────────────────────────────────────

function opacityOf(el: HTMLElement): number {
  let a = 1;
  for (let n: HTMLElement | null = el; n && n !== document.body; n = n.parentElement) {
    const o = parseFloat(getComputedStyle(n).opacity);
    if (o < 1) a *= o;
    if (a <= 0.001) return 0;
  }
  return a;
}

function radiusOf(el: HTMLElement, w: number, h: number, dpr: number): number {
  const key = `${Math.round(w)}x${Math.round(h)}`;
  const kept = radii.get(el);
  if (kept && kept.key === key) return kept.r;
  const raw = getComputedStyle(el).borderTopLeftRadius;
  let r = parseFloat(raw) || 0;
  if (raw.endsWith("%")) r = (r / 100) * Math.min(w, h);
  r = Math.min(r, Math.min(w, h) / 2) * dpr;
  radii.set(el, { key, r });
  return r;
}

function collect(): { list: PaneInfo[]; key: string } {
  const dpr = dprNow();
  const list: PaneInfo[] = [];
  let key = "";
  for (const el of panes) {
    // Panes behind an open search or sheet stay glass: the overlay's dim blurs over them,
    // so dropping them here would make their glass pop back on as it closes.
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    if (r.right < 0 || r.bottom < 0 || r.left > innerWidth || r.top > innerHeight) continue;
    const a = opacityOf(el) * arrival(el);
    if (a <= 0.003) continue;
    const p = { x: r.left * dpr, y: r.top * dpr, w: r.width * dpr, h: r.height * dpr, r: radiusOf(el, r.width, r.height, dpr), a };
    list.push(p);
    key += `${p.x.toFixed(1)},${p.y.toFixed(1)},${p.w.toFixed(1)},${p.h.toFixed(1)},${p.a.toFixed(3)};`;
  }
  return { list, key };
}

// ── the loop ────────────────────────────────────────────────────────────────────────────

function draw(t: number) {
  if (!gl) return;
  if (dustOn() && t - lastDust >= 1000 / DUST_FPS) {
    gl.setSpecks(stepDust(t, lastDust ? Math.min(100, t - lastDust) : 0));
    lastDust = t;
  }
  const { list, key } = collect();
  const moved = key !== lastKey;
  lastKey = key;
  gl.render(list, t, moved);
}

function frame(t: number) {
  raf = requestAnimationFrame(frame);
  if (document.hidden || !gl) return;
  try { draw(t); }
  catch (e) { console.warn("[glass] drawing failed, back to CSS", e); stop(); }
}

function size() {
  if (!gl) return;
  gl.resize(innerWidth, innerHeight, dprNow());
  if (dustOn()) seedDust();
  lastKey = "";
}

function start(): boolean {
  if (gl || !canvas) return !!gl;
  if (reducedTransparency()) return false;
  try {
    gl = new GlassGL(canvas);
  } catch (e) {
    console.warn("[glass] using CSS:", (e as Error).message);
    gl = null;
    return false;
  }
  gl.resize(innerWidth, innerHeight, dprNow());
  gl.setEdge(edgeDial);
  gl.setNative(native);
  gl.setGround(ground, performance.now());
  motes = [];
  if (dustOn()) seedDust();
  gl.setSpecks([]);
  // One frame now, before the browser paints, so the switch from the CSS ground is never
  // a visible frame of nothing.
  lastKey = "";
  draw(performance.now());
  glass.active = true;
  document.documentElement.setAttribute("data-glass", "gl");
  dust2d.stop();
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(frame);
  return true;
}

function stop() {
  cancelAnimationFrame(raf);
  raf = 0;
  try { gl?.destroy(); } catch { /* a lost context has nothing left to free */ }
  gl = null;
  motes = [];
  if (glass.active) {
    glass.active = false;
    document.documentElement.removeAttribute("data-glass");
    if (!ground.url) dust2d.start(ground.hue);
  }
}

function onLost(e: Event) { e.preventDefault(); stop(); }
function onRestored() { if (wanted) start(); }

export const glassGL = {
  get active() { return glass.active; },

  attach(target: HTMLCanvasElement) {
    canvas = target;
    target.addEventListener("webglcontextlost", onLost);
    target.addEventListener("webglcontextrestored", onRestored);
    if (wanted) start();
  },

  detach() {
    stop();
    canvas?.removeEventListener("webglcontextlost", onLost);
    canvas?.removeEventListener("webglcontextrestored", onRestored);
    canvas = null;
  },

  /** "native": the browser blurs everything under each pane (backdrop-filter), over a ground
   *  and particles the shader draws. "gl": the shader blurs and splits on its own, over the
   *  ground only. "off": the CSS ground, no blur. */
  mode(mode: "native" | "gl" | "off") {
    wanted = mode !== "off";
    native = mode === "native";
    if (!wanted) { stop(); return; }
    if (gl) gl.setNative(native); else start();
  },

  /** Returns true when the shader drew it, so the caller knows not to start the 2D dust. */
  ground(url: string | null, hue: number | null): boolean {
    ground = { url, hue };
    if (!gl) return false;
    gl.setGround(ground, performance.now());
    if (dustOn()) { if (!motes.length) seedDust(); }
    else { motes = []; gl.setSpecks([]); }
    return true;
  },

  look(settings: { edge?: number; dust?: number }) {
    if (settings.edge !== undefined) edgeDial = settings.edge;
    if (settings.dust !== undefined) {
      const changed = settings.dust !== dustDial;
      dustDial = settings.dust;
      if (changed && gl) { if (dustOn()) seedDust(); else { motes = []; gl.setSpecks([]); } }
    }
    gl?.setEdge(edgeDial);
  },
};

if (typeof window !== "undefined") {
  window.addEventListener("resize", size);
  matchMedia("(prefers-reduced-transparency: reduce)").addEventListener?.("change", () => {
    if (reducedTransparency()) stop(); else if (wanted) start();
  });
}

/** `use:pane`: this element is a pane of glass. Its own film, edge and shadow are CSS; the
 *  shader draws the blurred, split picture behind it. */
/** A pane on its way out: its shader light goes now, not when its exit animation ends. */
export function leavePane(node: Element) {
  panes.delete(node as HTMLElement);
  arrive.delete(node as HTMLElement);
  lastKey = "";
}
export function pane(node: HTMLElement, opts?: { delay?: number; fade?: number }) {
  panes.add(node);
  if (opts?.delay || opts?.fade) arrive.set(node, { at: performance.now(), delay: opts.delay ?? 0, fade: opts.fade ?? 400 });
  lastKey = "";
  return {
    destroy() {
      panes.delete(node);
      arrive.delete(node);
      lastKey = "";
    },
  };
}
