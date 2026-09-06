/* The dust behind the pages.
 *
 * A song with artwork puts its own picture behind the whole app. Without one there is
 * the flat wash on a song page, or nothing at all on the library screens, and this is
 * what goes in that room: a few dozen soft specks drifting slowly across it. It is meant
 * to be almost invisible. If you notice it as an effect it is turned up too far.
 *
 * The shape of this file is decided by one fact, which is that it sits behind the glass.
 * The rail, the top bar and the player are backdrop filtered, and a backdrop filter has
 * to re read its backdrop and run the whole chain again on every frame the thing behind
 * it changes. That chain is a displacement map, a 22px blur, a saturate and a brightness,
 * over roughly a rail and a player's worth of screen, and it costs the same whether one
 * speck moved or a thousand did. So the price of this field is its frame rate and not its
 * particle count, which is why it runs at twelve frames a second, why the bitmap is
 * deliberately not a retina one, and why nothing here is left running when there is
 * nothing to draw.
 */
"use strict";

J.dust = (function () {
  //: Twelve a second, eight on a phone. 60, 120 and 240 all divide by twelve, so the gate
  //: lands on the same phase every time rather than alternating between four and five
  //: vsyncs, which reads as a limp. Nothing drifts faster than nine pixels a second, so a
  //: frame moves a speck by three quarters of a pixel: a step smaller than a pixel cannot
  //: judder. Raising the speeds below without raising this is what would.
  const FPS_WIDE = 12, FPS_NARROW = 8;

  //: One speck per this many square pixels: 35 on a 1080p screen, 22 on a 1440 by 900
  //: laptop, the floor of ten on a phone.
  const AREA_PER = 34000, FEWEST = 14, MOST = 55;

  //: The soft dot is drawn once at this size and stamped. Sixteen keeps the largest
  //: stamp a mild shrink and the smallest a four to one one, and a smooth gradient has
  //: nothing in it to alias when it is shrunk.
  const SPRITE = 16;

  /* Not the device's pixel ratio, on purpose.
   *
   * Everything else here measures at up to two (35-limiter.js:38) because it draws lines
   * and text. A soft dot has no detail to lose, and a full screen bitmap at device
   * resolution is four times the bytes handed to the compositor on every drawn frame:
   * 33MB a frame instead of 8MB at 1920 by 1080. This is the single biggest saving
   * available and it costs nothing you can see. It is a constant so that anyone who wants
   * to try two and measure it can. */
  const DPR = 1;

  let canvas = null;
  let ctx2d = null;
  let raf = null;
  let last = 0;
  let gap = 0;                    // ms between drawn frames
  let width = 0, height = 0;
  let sprites = [];
  let specks = [];
  let hueNow = null;

  const motion = window.matchMedia("(prefers-reduced-motion: reduce)");

  /* One soft dot, drawn once into its own little canvas.
   *
   * Thirty five arcs a frame each with a shadow blur is the expensive way to get a soft
   * edge. Drawing the gradient once and stamping it turns every speck into a single
   * drawImage. `tint` takes an alpha and hands back a colour, so the same builder makes
   * the accent dot and the song's own. */
  function makeSprite(tint) {
    const c = document.createElement("canvas");
    c.width = c.height = SPRITE;
    const g = c.getContext("2d");
    const half = SPRITE / 2;
    const glow = g.createRadialGradient(half, half, 0, half, half, half);
    glow.addColorStop(0, tint(1));
    glow.addColorStop(0.35, tint(0.45));
    glow.addColorStop(1, tint(0));
    g.fillStyle = glow;
    g.fillRect(0, 0, SPRITE, SPRITE);
    return c;
  }

  /* The colour is the accent, because the accent is a setting and a hard coded green
   * stops being the accent the moment somebody changes it. When a song without artwork is
   * open, a third of the specks take that song's hue instead, which is the same number
   * .page-wash.flat builds its two gradients from, so the dust belongs to the room rather
   * than sitting on top of it. Lighter and less saturated than the wash's own 45 and 30,
   * or a speck the same colour as the thing it is over is not a speck.
   *
   * Read once, here. The other canvases in this project ask getComputedStyle for the
   * accent inside the frame, which is a style read twelve times a second for a value that
   * only changes when somebody presses a colour picker. */
  function tint() {
    const hex = getComputedStyle(document.documentElement)
      .getPropertyValue("--accent").trim() || "#54B37A";
    const { r, g, b } = J.rgb(hex);
    sprites = [makeSprite((a) => `rgba(${r}, ${g}, ${b}, ${a})`)];
    if (hueNow !== null) {
      sprites.push(makeSprite((a) => `hsla(${hueNow}, 50%, 74%, ${a})`));
    }
  }

  function seed() {
    const many = J.clamp(Math.round(width * height / AREA_PER), FEWEST, MOST);
    specks = [];
    for (let i = 0; i < many; i++) {
      specks.push({
        x: Math.random() * width,
        y: Math.random() * height,
        size: 5 + Math.random() * 9,          // the whole stamp; the core is about a third
        /* Measured rather than guessed. The first pass ran at 0.045 to 0.13 and lit six
         * hundredths of one per cent of the screen at a peak of seven per cent, which is
         * not subtle, it is absent. This lights about half a per cent at a peak of
         * sixteen: you see it if you look at an empty page for a moment, and never
         * otherwise. */
        peak: 0.07 + Math.random() * 0.16,    // 0.07 to 0.23 at its brightest
        // All of them the same way. Dust in a room is air moving, and specks going in
        // every direction reads as noise rather than as a draught.
        vx: 3 + Math.random() * 6,
        vy: -(0.5 + Math.random() * 2.5),
        phase: Math.random(),
        period: 9 + Math.random() * 11,       // seconds for one breath, never shared
        sprite: sprites.length > 1 && Math.random() < 0.34 ? 1 : 0,
      });
    }
  }

  /* The viewport, not getBoundingClientRect.
   *
   * The eq and the limiter measure themselves because they sit in panels that resize.
   * This one is fixed to inset 0, so innerWidth is already the answer and asking the
   * layout for it would be a flush twelve times a second for a number we have. */
  function resize() {
    const w = Math.max(1, window.innerWidth);
    const h = Math.max(1, window.innerHeight);
    // Positions move with the window rather than being thrown away, or dragging the
    // window edge would pile the whole field into one corner and let it spread out again.
    const sx = width ? w / width : 1;
    const sy = height ? h / height : 1;
    width = w; height = h;
    canvas.width = Math.round(w * DPR);
    canvas.height = Math.round(h * DPR);
    ctx2d.setTransform(DPR, 0, 0, DPR, 0, 0);
    for (const p of specks) { p.x *= sx; p.y *= sy; }
    // The count is not recomputed. A window dragged much wider ends up very slightly
    // sparser, which at this density nobody will ever see, and the alternative is specks
    // popping into existence at full brightness partway through a drag.
  }

  function draw(dt) {
    ctx2d.clearRect(0, 0, width, height);
    for (const p of specks) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      // A wrap happens to any one speck about once every five minutes, so it comes back
      // somewhere new rather than at the same height, which would make a conveyor of it.
      if (p.x - p.size > width) { p.x = -p.size; p.y = Math.random() * height; }
      if (p.y + p.size < 0) { p.y = height + p.size; p.x = Math.random() * width; }
      p.phase += dt / p.period;
      const breath = 0.72 + 0.28 * Math.sin(p.phase * Math.PI * 2);
      ctx2d.globalAlpha = p.peak * breath;
      const half = p.size / 2;
      // sprites can shrink from two back to one when a song's hue goes away, and a speck
      // still holding the second index would otherwise draw nothing at all.
      ctx2d.drawImage(sprites[p.sprite] || sprites[0],
                      p.x - half, p.y - half, p.size, p.size);
    }
    ctx2d.globalAlpha = 1;
  }

  function frame(now) {
    raf = requestAnimationFrame(frame);
    // This canvas is ours and lives on the body, so it should never go missing. It is
    // checked anyway, because loops in this project have a history of outliving the thing
    // they were drawing for and one comparison a frame is the cheapest way to be sure.
    if (!canvas || !canvas.isConnected) { stop(); return; }
    if (now - last < gap) return;
    // Clamped, because a tab that was throttled rather than stopped hands back one frame
    // with several seconds on it, and every speck would jump the screen in one step.
    const dt = last ? Math.min((now - last) / 1000, 0.25) : 0;
    last = now;
    if (window.innerWidth !== width || window.innerHeight !== height) resize();
    draw(dt);
  }

  /* Off means off, and it means it from three directions.
   *
   * A hidden tab stops getting frames on its own, so this is not what stops the work. It
   * is here because a throttled background tab is not the same as a stopped one, and
   * because coming back after ten minutes should not begin with a jump. */
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

  // Turning the setting on with the app already open should stop it there and then, not
  // at the next navigation.
  const onMotion = () => { if (motion.matches) stop(); };

  function stop() {
    if (raf) { cancelAnimationFrame(raf); raf = null; }
    document.removeEventListener("visibilitychange", onShow);
    motion.removeEventListener("change", onMotion);
    // The element goes too, so there is no idle full screen layer sitting under the glass
    // while a song's artwork is up. No fade out: it would need a timer or a transitionend
    // to tear down, and something barely visible disappearing under an arriving picture is
    // not a thing anybody can see.
    if (canvas) { canvas.remove(); canvas = null; ctx2d = null; }
    specks = [];
    sprites = [];
    last = 0;
    hueNow = null;
  }

  function start(hue) {
    // The whole idea is movement, so there is nothing to degrade to. Off is the answer.
    if (motion.matches) return;
    const next = (hue === null || hue === undefined) ? null : Number(hue);
    if (canvas) {
      // Already drifting. A different song without artwork only changes the colour.
      if (next !== hueNow) { hueNow = next; tint(); }
      return;
    }
    hueNow = next;
    canvas = document.createElement("canvas");
    canvas.className = "page-dust";
    canvas.setAttribute("aria-hidden", "true");
    ctx2d = canvas.getContext("2d");
    // Straight after the wash and before the shell. Same z-index, later in the markup, so
    // it draws over the wash and under everything else. It must not go inside the wash:
    // that carries blur(70px), and a one pixel speck through a seventy pixel blur is not
    // a faint speck, it is nothing at all.
    const wash = document.getElementById("pageWash");
    if (wash && wash.parentNode) wash.parentNode.insertBefore(canvas, wash.nextSibling);
    else document.body.appendChild(canvas);

    gap = 1000 / (window.innerWidth <= 900 ? FPS_NARROW : FPS_WIDE)
          - 4;   //: a whisker under, or a vsync landing at 83.2ms against an 83.3ms
                 //: interval waits for the next one and quietly makes it ten a second
    width = height = 0;
    resize();
    tint();
    seed();
    document.addEventListener("visibilitychange", onShow);
    motion.addEventListener("change", onMotion);
    last = 0;
    raf = requestAnimationFrame(frame);
    // Next frame, so there is a starting state to fade up from. The wash does the same.
    requestAnimationFrame(() => { if (canvas) canvas.classList.add("on"); });
  }

  return {
    start,
    stop,
    /* The accent changed under us. A no op unless something is actually drifting. */
    retint() { if (canvas) tint(); },
    /* For a trace: J.dust.running is what you turn off to get the second measurement. */
    get running() { return !!raf; },
  };
}());
