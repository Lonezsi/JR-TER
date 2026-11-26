/* What is behind the glass when no picture is: drifting dust, and a per pixel dither
 * that breaks up the steps a wide blur leaves in a smooth gradient.
 *
 * PUBLIC API
 *   dust.start(hue)      the page wants dust (no artwork behind the app)
 *   dust.stop()          the page does not (a picture is up)
 *   dust.retint()        the accent changed
 *   dust.strength(0-200) the dial; nought is off, and the page's ask is remembered
 *   dust.running         is the loop alive (for a trace)
 *   dither.apply(0-200)  the dial; nought hides the layer
 *   dither.reseed()      throw the texture away so the next apply() makes a new one
 *
 * Both own their DOM: a canvas and an overlay appended to <body>, pointer-events none.
 * The dust sits at z-index 0, after the ground in the markup, so it draws over the ground
 * and under the shell. The grain sits over everything, dialogs included, because a step
 * in a gradient does not stop being a step when a sheet is open. Every method is safe to
 * call before anything is mounted.
 */
import { clamp } from "./util";

export interface Dust {
  /** Start drifting, tinted by a hue, or by the accent when the hue is null. */
  start(hue: number | null): void;
  stop(): void;
  /** The accent changed: rebuild the sprite the particles are stamped from. */
  retint(): void;
  /** 0..200. Nought is off. */
  strength(value: number): void;
  readonly running?: boolean;
}

export interface Dither {
  /** 0..200. Nought is off. */
  apply(value: number): void;
  reseed?(): void;
}

// ── the dust ────────────────────────────────────────────────────────────────

/* A few dozen soft specks drifting slowly across the room. Meant to be almost invisible:
 * if you notice it as an effect it is turned up too far.
 *
 * The shape of this is decided by one fact, which is that it sits behind the glass. A
 * backdrop filter re-reads its backdrop and runs its whole chain again on every frame the
 * thing behind it changes, and it costs the same whether one speck moved or a thousand
 * did. So the price of this field is its frame rate and not its particle count, which is
 * why it runs at twelve frames a second, why the bitmap is deliberately not a retina one,
 * and why nothing is left running when there is nothing to draw. */
function makeDust(): Dust {
  /* Twelve a second, eight on a phone. 60, 120 and 240 all divide by twelve, so the gate
   * lands on the same phase every time rather than alternating between four and five
   * vsyncs, which reads as a limp. Nothing drifts faster than three pixels a second, so a
   * frame moves a speck by less than a pixel, and a step that small cannot judder.
   * Raising the speeds below without raising this is what would. */
  const FPS_WIDE = 12, FPS_NARROW = 8;

  // One speck per this many square pixels at full strength, within these bounds.
  const AREA_PER = 18000, FEWEST = 18, MOST = 90;

  /* Above one the dial adds brightness and size rather than more specks. Count is the
   * one dimension that costs anything: every speck is a drawImage and the canvas is
   * redrawn whole. So the count saturates at one and the rest of the travel goes into
   * the two dimensions that are free. */
  const countOf = (p: number) => Math.min(p, 1);

  // The dial, 0..2. One is the default. Kept here because it changes only on Save.
  let power = 1;

  // The soft dot is drawn once at this size and stamped. A smooth gradient has nothing
  // in it to alias when it is shrunk.
  const SPRITE = 16;

  /* Not the device's pixel ratio, on purpose. A soft dot has no detail to lose, and a
   * full screen bitmap at device resolution is four times the bytes handed to the
   * compositor on every drawn frame. A constant so anyone can try two and measure it. */
  const DPR = 1;

  // How far inside each pane the dust is allowed. A clip is a hard cut, so a speck
  // straddling a border came out as a sliced half circle exactly on the line the border
  // draws the eye to. Pulled inwards, the cut lands in the sprite's faint skirt instead.
  const INSET = 12;

  /* The surfaces the dust is allowed to show in: the shell's glass panes. The dust is
   * not something on the page, it is something the glass finds behind it. Drawn across
   * the whole viewport it also showed through translucent content as a field of specks
   * over the words. Clipped in the canvas rather than with a CSS mask, because clip-path
   * takes one shape and these are several. */
  const GLASS = "#shell .glass";

  interface Speck {
    x: number; y: number; size: number; peak: number;
    vx: number; vy: number; phase: number; period: number;
  }

  let canvas: HTMLCanvasElement | null = null;
  let ctx2d: CanvasRenderingContext2D | null = null;
  let raf: number | null = null;
  let last = 0;
  let gap = 0;                     // ms between drawn frames
  let width = 0, height = 0;
  let sprite: HTMLCanvasElement | null = null;
  let specks: Speck[] = [];
  let hueNow: number | null = null;
  const corners = new WeakMap<Element, number>();

  /* Whether the PAGE wants dust, which is not the same as whether the loop is running.
   * Taking the dial to nought tears the canvas down; without this nothing remembered
   * that the page had asked, so bringing the dial back up did nothing until you
   * navigated. Artwork arriving is the page changing its mind; the dial is not. */
  let wanted = false;

  const motion: MediaQueryList | null = typeof window !== "undefined" && window.matchMedia
    ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;

  /* One soft dot, drawn once into its own little canvas, so every speck is a single
   * drawImage rather than an arc with a shadow blur. */
  function makeSprite(tintOf: (alpha: number) => string): HTMLCanvasElement {
    const c = document.createElement("canvas");
    c.width = c.height = SPRITE;
    const g = c.getContext("2d")!;
    const half = SPRITE / 2;
    const glow = g.createRadialGradient(half, half, 0, half, half, half);
    glow.addColorStop(0, tintOf(1));
    glow.addColorStop(0.35, tintOf(0.45));
    glow.addColorStop(1, tintOf(0));
    g.fillStyle = glow;
    g.fillRect(0, 0, SPRITE, SPRITE);
    return c;
  }

  /* White. The glass already carries the accent everywhere, so dust in the accent is
   * dust the same colour as what it is lying on and reads as a cast, not as specks.
   * White is the only thing that is a speck against every hue the wash can be. */
  function tint() {
    sprite = makeSprite((a) => `rgba(255, 255, 255, ${a})`);
  }

  function seed() {
    const room = width * height / AREA_PER;
    const many = Math.round(clamp(room, FEWEST, MOST) * countOf(power));
    specks = [];
    for (let i = 0; i < many; i++) {
      specks.push({
        x: Math.random() * width,
        y: Math.random() * height,
        size: 8 + Math.random() * (15 + 8 * power),   // the stamp; the core is a third of it
        /* Measured, then put on a dial. The dial is not linear: brightness is perceived
         * roughly as a power law, so a straight multiply spends most of its travel doing
         * nothing you can see at the bottom. */
        peak: (0.05 + Math.random() * 0.12) + 0.55 * Math.pow(power, 1.6)
              * (0.3 + Math.random() * 0.7),
        // All the same way: dust in a room is air moving, and specks going everywhere
        // read as noise. Slow enough that you are never sure it moved; through glass
        // that magnifies and bends it, anything faster reads as something travelling.
        vx: 1 + Math.random() * 2,
        vy: -(0.2 + Math.random() * 0.8),
        phase: Math.random(),
        period: 9 + Math.random() * 11,       // seconds for one breath, never shared
      });
    }
  }

  /* The viewport, not getBoundingClientRect: the canvas is fixed to inset 0, so
   * innerWidth is already the answer and asking layout would be a flush every frame. */
  function resize() {
    if (!canvas || !ctx2d) return;
    const w = Math.max(1, window.innerWidth);
    const h = Math.max(1, window.innerHeight);
    // Positions move with the window rather than being thrown away, or dragging the
    // window edge would pile the whole field into one corner.
    const sx = width ? w / width : 1;
    const sy = height ? h / height : 1;
    width = w; height = h;
    canvas.width = Math.round(w * DPR);
    canvas.height = Math.round(h * DPR);
    ctx2d.setTransform(DPR, 0, 0, DPR, 0, 0);
    for (const p of specks) { p.x *= sx; p.y *= sy; }
    // The count is not recomputed: specks popping in at full brightness partway through
    // a drag is worse than a field very slightly sparser.
  }

  /* Clip to whatever glass is on screen. False when there is none, which means there is
   * nothing to draw rather than nothing to clip. */
  function clipToGlass(g: CanvasRenderingContext2D): boolean {
    g.beginPath();
    let any = false;
    for (const pane of document.querySelectorAll(GLASS)) {
      const box = pane.getBoundingClientRect();
      // A rail parked off screen still has a width, and a collapsed one has none.
      if (box.width < 1 || box.height < 1) continue;
      if (box.right < 0 || box.left > width || box.bottom < 0 || box.top > height) continue;
      let radius = corners.get(pane);
      if (radius === undefined) {
        radius = parseFloat(getComputedStyle(pane).borderTopLeftRadius) || 0;
        corners.set(pane, radius);
      }
      // Never more than a third of the smaller side, or a short bar is left a scratch.
      const inset = Math.min(INSET, Math.min(box.width, box.height) / 3);
      const w = box.width - inset * 2, h = box.height - inset * 2;
      if (w < 1 || h < 1) continue;
      any = true;
      // The radius comes in with the edge, or the dust rounds off inside a square corner.
      const r = Math.max(0, radius - inset);
      if (g.roundRect) g.roundRect(box.left + inset, box.top + inset, w, h, r);
      else g.rect(box.left + inset, box.top + inset, w, h);
    }
    return any;
  }

  function draw(dt: number) {
    const g = ctx2d;
    if (!g || !sprite) return;
    g.clearRect(0, 0, width, height);
    g.save();
    if (!clipToGlass(g)) { g.restore(); return; }
    g.clip();
    for (const p of specks) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      // A wrap comes back somewhere new rather than at the same height, which would
      // make a conveyor of it.
      if (p.x - p.size > width) { p.x = -p.size; p.y = Math.random() * height; }
      if (p.y + p.size < 0) { p.y = height + p.size; p.x = Math.random() * width; }
      p.phase += dt / p.period;
      const breath = 0.72 + 0.28 * Math.sin(p.phase * Math.PI * 2);
      g.globalAlpha = Math.min(1, p.peak * breath);
      const half = p.size / 2;
      g.drawImage(sprite, p.x - half, p.y - half, p.size, p.size);
    }
    g.globalAlpha = 1;
    g.restore();
  }

  function frame(now: number) {
    raf = requestAnimationFrame(frame);
    // Loops have a history of outliving the thing they were drawing for, and one
    // comparison a frame is the cheapest way to be sure.
    if (!canvas || !canvas.isConnected) { stop(); return; }
    if (now - last < gap) return;
    // Clamped: a tab that was throttled rather than stopped hands back one frame with
    // several seconds on it, and every speck would jump the screen in one step.
    const dt = last ? Math.min((now - last) / 1000, 0.25) : 0;
    last = now;
    if (window.innerWidth !== width || window.innerHeight !== height) resize();
    draw(dt);
  }

  /* A throttled background tab is not the same as a stopped one, and coming back after
   * ten minutes should not begin with a jump. */
  const onShow = () => {
    if (!canvas || !canvas.isConnected) {
      document.removeEventListener("visibilitychange", onShow);
      return;
    }
    if (document.visibilityState === "hidden") {
      if (raf) { cancelAnimationFrame(raf); raf = null; }
    } else if (!raf) {
      last = 0;
      raf = requestAnimationFrame(frame);
    }
  };

  // Turning reduced motion on with the app open stops it there and then.
  const onMotion = () => { if (motion?.matches) stop(); };

  /** Take the loop and the canvas away, without forgetting that the page asked. */
  function halt() {
    if (raf) { cancelAnimationFrame(raf); raf = null; }
    document.removeEventListener("visibilitychange", onShow);
    motion?.removeEventListener("change", onMotion);
    // The element goes too, so there is no idle full screen layer under the glass while
    // artwork is up. No fade out: something barely visible disappearing under an
    // arriving picture is not a thing anybody can see.
    if (canvas) { canvas.remove(); canvas = null; ctx2d = null; }
    specks = [];
    sprite = null;
    last = 0;
  }

  /** The page has changed its mind: nothing to draw and nothing to come back to. */
  function stop() {
    wanted = false;
    hueNow = null;
    halt();
  }

  function begin(hue: number | null) {
    if (typeof document === "undefined") return;
    // The whole idea is movement, so there is nothing to degrade to. Off is the answer.
    if (motion?.matches) return;
    // Nought on the dial is the same answer from the other direction. The ask is
    // remembered either way.
    if (!power) return;
    const next = hue === null || hue === undefined ? null : Number(hue);
    if (canvas) {
      // Already drifting. A different song without artwork only changes the colour.
      if (next !== hueNow) { hueNow = next; tint(); }
      return;
    }
    hueNow = next;
    const made = document.createElement("canvas");
    made.setAttribute("aria-hidden", "true");
    made.dataset.ambient = "dust";
    /* z-index 0 and last in <body>: over the ground (also 0, earlier in the markup) and
     * under the shell. Never inside the ground, whose layers are blurred: a one pixel
     * speck through a wide blur is nothing at all. No will-change: a canvas that
     * changes every frame gets its own layer without being asked. */
    made.style.cssText = "position:fixed;inset:0;width:100%;height:100%;z-index:0;"
      + "pointer-events:none;opacity:0;transition:opacity var(--slow, 600ms);filter:blur(4px);";
    const got = made.getContext("2d");
    if (!got) return;
    canvas = made;
    ctx2d = got;
    document.body.appendChild(made);

    // A whisker under the interval, or a vsync landing at 83.2ms against 83.3ms waits
    // for the next one and quietly makes it ten a second.
    gap = 1000 / (window.innerWidth <= 900 ? FPS_NARROW : FPS_WIDE) - 4;
    width = height = 0;
    resize();
    tint();
    seed();
    document.addEventListener("visibilitychange", onShow);
    motion?.addEventListener("change", onMotion);
    last = 0;
    raf = requestAnimationFrame(frame);
    // Next frame, so there is a starting state to fade up from.
    requestAnimationFrame(() => { if (canvas) canvas.style.opacity = "1"; });
  }

  return {
    /** Records the ask, then does whatever the dial allows. */
    start(hue) {
      wanted = true;
      hueNow = hue === null || hue === undefined ? null : Number(hue);
      begin(hue);
    },
    stop,
    retint() { if (canvas) tint(); },
    /* Nought stops it outright rather than drawing an empty canvas under the glass for
     * ever, which would be the compositor paying for something with nothing in it. */
    strength(value) {
      const next = clamp(Number(value) || 0, 0, 200) / 100;
      if (next === power) return;
      power = next;
      if (!power) { halt(); return; }
      // Back up from nought, on a page that still wants it. begin() is what knows how
      // to build a canvas; seed() here would reseed one that is not there.
      if (!canvas) { if (wanted) begin(hueNow); return; }
      seed();
    },
    get running() { return !!raf; },
  };
}

// ── the dither ──────────────────────────────────────────────────────────────

/* WHY THERE IS BANDING. A wide blur produces a ramp that crosses one 8 bit level every
 * few pixels, and the compositor rounds. Rounding a slow ramp makes a staircase, and the
 * eye exaggerates the edge of each step until a smooth gradient reads as stripes.
 *
 * WHAT DITHERING REQUIRES is that the value added to one pixel be independent of the
 * value added to its neighbour. Then along a ramp between two levels some pixels round up
 * and some down in proportion to where the true value lies, and the staircase becomes
 * noise, which at this amplitude is invisible. So the noise is generated here, one texel
 * per DEVICE pixel, and must not be resampled on the way to the screen: a tile scaled by
 * even a few per cent goes through a bilinear filter, which is a low pass filter, which
 * averages away exactly the per pixel content that does the work. (Three octaves of
 * feTurbulence drawn at half size failed for both reasons: it was cloud, then blurred.)
 *
 * AND IT IS ADDED, not multiplied. overlay on a dark base works out to the base times one
 * plus or minus the texel, so the dither was proportional to how bright the pixel already
 * was, and this app is almost black: under one level, which is no dither at all, exactly
 * where the banding is worst. plus-lighter adds a fixed amount whatever is underneath.
 *
 * THE DISTRIBUTION is triangular (two uniforms summed), the same choice as dithering
 * audio: TPDF noise makes the rounding error independent of the signal, where uniform
 * noise leaves a faint remaining pattern on a slow ramp. */
function makeDither(): Dither {
  // The tile, in device pixels. Big enough that its repeat is not a visible pattern at
  // these amplitudes, small enough to be nothing: 36k texels, about a 40KB PNG.
  const TILE = 192;

  // How much is per pixel dither and how much slow grain. The dither does the work; a
  // little grain makes a flat panel look like a surface rather than a void.
  const FINE = 0.82, COARSE = 0.18;

  // The coarse layer's grid, in texels per cell. Interpolated and wrapped.
  const CELL = 24;

  /* Peak to peak, in eight bit levels, at a hundred on the dial. Levels rather than a
   * fraction, because the point of adding is that the amount does not depend on what is
   * underneath. Two is the textbook amount and clears a synthetic ramp; a blurred
   * photograph carries far shallower ones, hence the room above it. */
  const MOST_LEVELS = 12;

  /* The fallback for a browser with no additive blend. overlay collapses to nothing in
   * the darks, so it needs a far larger number to do anything and is grainy on the mid
   * tones as the price. */
  const MOST_OVERLAY = 0.42;

  // Whether the compositor can add. A fact about the browser, asked once.
  const CAN_ADD = typeof CSS !== "undefined" && !!CSS.supports
    && CSS.supports("mix-blend-mode", "plus-lighter");

  let cached: { dpr: number; url: string } | null = null;
  let layer: HTMLDivElement | null = null;

  /* Value noise on a coarse grid, wrapped so the tile has no seam. Smoothstep rather
   * than linear: linear leaves a visible crease along every cell boundary, because the
   * first derivative jumps there. */
  function coarseField(cells: number) {
    const grid = new Float32Array(cells * cells);
    for (let i = 0; i < grid.length; i++) grid[i] = Math.random() * 2 - 1;
    const ease = (t: number) => t * t * (3 - 2 * t);
    const ix = (n: number) => ((n % cells) + cells) % cells;
    return (x: number, y: number) => {
      const gx = x / CELL, gy = y / CELL;
      const x0 = Math.floor(gx), y0 = Math.floor(gy);
      const fx = ease(gx - x0), fy = ease(gy - y0);
      const a = grid[ix(y0) * cells + ix(x0)];
      const b = grid[ix(y0) * cells + ix(x0 + 1)];
      const c = grid[ix(y0 + 1) * cells + ix(x0)];
      const d = grid[ix(y0 + 1) * cells + ix(x0 + 1)];
      const top = a + (b - a) * fx;
      return top + ((c + (d - c) * fx) - top) * fy;
    };
  }

  /* The tile. Greyscale, because this dithers luminance and per channel noise would add
   * chroma speckle that reads as a broken screen. Opaque, because the layer's own
   * opacity is the amplitude control and two of those cannot be reasoned about. */
  function build(px: number): string {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = px;
    const g = canvas.getContext("2d");
    if (!g) return "";
    const image = g.createImageData(px, px);
    const data = image.data;
    const coarse = coarseField(Math.max(2, Math.round(px / CELL)));
    for (let y = 0, at = 0; y < px; y++) {
      for (let x = 0; x < px; x++, at += 4) {
        const fine = Math.random() + Math.random() - 1;       // triangular, in [-1, 1]
        const mixed = fine * FINE + coarse(x, y) * COARSE;
        // Centred on mid grey: half of the dither has to be downwards.
        const v = Math.round(127.5 + mixed * 127.5);
        data[at] = data[at + 1] = data[at + 2] = v < 0 ? 0 : v > 255 ? 255 : v;
        data[at + 3] = 255;
      }
    }
    g.putImageData(image, 0, 0);
    return canvas.toDataURL("image/png");
  }

  function ensureLayer(): HTMLDivElement | null {
    if (typeof document === "undefined" || !document.body) return null;
    if (layer && layer.isConnected) return layer;
    layer = document.createElement("div");
    layer.setAttribute("aria-hidden", "true");
    layer.dataset.ambient = "grain";
    // image-rendering: pixelated is not a style choice, it is the whole mechanism.
    layer.style.cssText = "position:fixed;inset:0;z-index:2147483000;pointer-events:none;"
      + "background-repeat:repeat;image-rendering:pixelated;";
    document.body.appendChild(layer);
    return layer;
  }

  return {
    /* Put the layer at a strength, generating the texture the first time and whenever
     * the pixel ratio has changed under it (a window dragged to another screen). */
    apply(amount) {
      // A hundred is the old top of the dial and means what it always did; the room up
      // to two hundred is the same scale carried on.
      const strength = clamp(Number(amount) || 0, 0, 200) / 100;
      if (strength === 0) {
        // Gone outright, so the compositor is not blending a transparent full screen
        // layer on every frame for nothing.
        if (layer) { layer.remove(); layer = null; }
        return;
      }
      const el = ensureLayer();
      if (!el) return;

      /* plus-lighter adds the layer to what is under it, and the layer's opacity is the
       * scale: L/255 turns a texel spanning nought to one into nought to L levels. The
       * texture is centred on mid grey, so that is a swing of L/2 about a lift of L/2,
       * and the lift is the price of a blend mode that can only brighten. At the default
       * pure black becomes #030303. There is no blend mode that only darkens to pair it
       * with, and three levels of lift is a smaller lie than half the bands surviving. */
      if (CAN_ADD) {
        el.style.mixBlendMode = "plus-lighter";
        el.style.opacity = (strength * MOST_LEVELS / 255).toFixed(5);
      } else {
        el.style.mixBlendMode = "overlay";
        el.style.opacity = Math.min(1, strength * MOST_OVERLAY).toFixed(4);
      }

      // Device pixels, not CSS pixels: on a 2x screen the tile is drawn 96 CSS pixels
      // wide so one texel lands on one physical pixel, which is the entire point.
      const dpr = window.devicePixelRatio || 1;
      if (!cached || cached.dpr !== dpr) cached = { dpr, url: build(TILE) };
      const size = (TILE / dpr).toFixed(4) + "px";
      el.style.backgroundImage = cached.url ? `url("${cached.url}")` : "none";
      el.style.backgroundSize = `${size} ${size}`;
    },
    reseed() { cached = null; },
  };
}

export const dust: Dust = makeDust();
export const dither: Dither = makeDither();
