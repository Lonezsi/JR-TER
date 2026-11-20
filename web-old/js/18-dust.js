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
  //: At full strength. The dial scales the count and the brightness between nothing and
  //: these, so a hundred is a room with visible dust in it and the old "you have to look
  //: for it" setting is somewhere around thirty five.
  const AREA_PER = 18000, FEWEST = 18, MOST = 90;

  /* Above one the dial adds brightness and size rather than more specks.
   *
   * Count is the one dimension that costs anything: every speck is a drawImage and the
   * canvas is redrawn whole. Doubling it past what was already the top of the range
   * would double the per frame work to say something the eye reads better as "brighter"
   * anyway, so the count saturates at one and the rest of the travel goes into the two
   * dimensions that are free. */
  const countOf = (power) => Math.min(power, 1);

  //: Nought to a hundred, from the settings. Kept here rather than read from the DOM on
  //: every reseed, because it changes when somebody presses Save and at no other time.
  //: One is what the dial used to top out at and is now the default. It can reach two.
  let power = 1;

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

  /* The surfaces the dust is allowed to show in.
   *
   * Everything named here is backdrop filtered, and that is the whole point: the dust is
   * not something on the page, it is something the glass finds behind it. Drawn across
   * the whole viewport it also showed through the main panel, which is solid on the
   * library screens but translucent on a song page, so the same effect was subtle in one
   * place and a field of specks over the words in another.
   *
   * Clipped in the canvas rather than with a CSS mask, because clip-path takes one shape
   * and these are three, and because a canvas clip costs one path per drawn frame at
   * twelve frames a second. */
  const GLASS = ".rail, .topbar, .player";
  const corners = new WeakMap();

  /* Whether the PAGE wants dust, which is not the same as whether the loop is running.
   *
   * These were one thing, and taking the dial to nought tore the canvas down and left
   * nothing that remembered the page had asked for it, so bringing the dial back up did
   * nothing until you navigated. A song's artwork arriving is the page changing its mind;
   * the dial going to nought is not. */
  let wanted = false;

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

  /* White.
   *
   * It was the accent, with a third of the specks taking the song's own hue, on the
   * grounds that the dust should belong to the room. Seen through the glass that read as
   * a green cast on the rail rather than as specks: the glass already carries the accent
   * everywhere, so dust in the accent is dust the same colour as what it is lying on.
   * White is the only thing that is a speck against every hue the wash can be. */
  function tint() {
    sprites = [makeSprite((a) => `rgba(255, 255, 255, ${a})`)];
  }

  function seed() {
    const room = width * height / AREA_PER;
    const many = Math.round(J.clamp(room, FEWEST, MOST) * countOf(power));
    specks = [];
    for (let i = 0; i < many; i++) {
      specks.push({
        x: Math.random() * width,
        y: Math.random() * height,
        size: 8 + Math.random() * (15 + 8 * power),  // the stamp; the core is a third of it
        /* Measured rather than guessed, and then put on a dial.
         *
         * The first pass ran at 0.045 to 0.13 and lit six hundredths of one per cent of
         * the screen at a peak of seven per cent, which is not subtle, it is absent. At
         * full strength this lights a couple of per cent at a peak of about a half, which
         * is snow rather than dust. The dial is not linear: brightness is perceived
         * roughly as a power law, so a straight multiply spends most of its travel doing
         * nothing you can see at the bottom. */
        peak: (0.05 + Math.random() * 0.12) + 0.55 * Math.pow(power, 1.6)
              * (0.3 + Math.random() * 0.7),
        // All of them the same way. Dust in a room is air moving, and specks going in
        // every direction reads as noise rather than as a draught.
        //
        // A third of what it was. At nine pixels a second a speck crossed a rail in half
        // a minute, which is drifting; through glass that magnifies and bends it, it read
        // as something travelling. Slow enough now that you are never sure it moved.
        vx: 1 + Math.random() * 2,
        vy: -(0.2 + Math.random() * 0.8),
        phase: Math.random(),
        period: 9 + Math.random() * 11,       // seconds for one breath, never shared
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

  /* Clip to whatever glass is on screen. Returns false when there is none, which is a
   * sheet open over everything or a layout with no player yet, and means there is nothing
   * to draw rather than nothing to clip. */
  /* How far inside each pane the dust is allowed.
   *
   * A clip is a hard cut, so a speck straddling the border came out as a sliced half
   * circle sitting exactly on the line the border draws your eye to, which is the one
   * place it cannot be missed. Pulling the edge inwards does not stop specks being cut,
   * it moves the cut somewhere nobody is looking, and the sprite does the rest: it is a
   * radial gradient that is already down to a fifth of its alpha two thirds of the way
   * out, so a cut through that skirt is not a straight line anybody can see. A cut
   * through the core is. Twelve is about a third of the biggest speck. */
  const INSET = 12;

  function clipToGlass() {
    ctx2d.beginPath();
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
      // Never more than a third of the smaller side. The top bar is about fifty pixels
      // tall and a flat twelve off each edge would leave it a scratch to draw in.
      const room = Math.min(box.width, box.height) / 3;
      const in_ = Math.min(INSET, room);
      const w = box.width - in_ * 2, h = box.height - in_ * 2;
      if (w < 1 || h < 1) continue;
      any = true;
      // The radius comes in with the edge, or a tight corner turns into a wide one and
      // the dust rounds off inside a square corner.
      const r = Math.max(0, radius - in_);
      if (ctx2d.roundRect) ctx2d.roundRect(box.left + in_, box.top + in_, w, h, r);
      else ctx2d.rect(box.left + in_, box.top + in_, w, h);
    }
    return any;
  }

  function draw(dt) {
    ctx2d.clearRect(0, 0, width, height);
    ctx2d.save();
    if (!clipToGlass()) { ctx2d.restore(); return; }
    ctx2d.clip();
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
      ctx2d.drawImage(sprites[0], p.x - half, p.y - half, p.size, p.size);
    }
    ctx2d.globalAlpha = 1;
    ctx2d.restore();
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

  //: Take the loop and the canvas away, without forgetting that the page asked for it.
  function halt() {
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
  }

  //: The page has changed its mind: a song's artwork is up, so there is nothing to draw
  //: and nothing to come back to.
  function stop() {
    wanted = false;
    hueNow = null;
    halt();
  }

  function begin(hue) {
    // The whole idea is movement, so there is nothing to degrade to. Off is the answer.
    if (motion.matches) return;
    // And nought on the dial is somebody saying they do not want it, which is the same
    // answer arrived at from the other direction. The page's ask is remembered either
    // way, so turning the dial back up starts it without needing a navigation.
    if (!power) return;
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

  /* What the page calls. It records the ask and then does whatever the dial allows. */
  function start(hue) {
    wanted = true;
    hueNow = (hue === null || hue === undefined) ? null : Number(hue);
    begin(hue);
  }

  return {
    start,
    stop,
    /* The accent changed under us. A no op unless something is actually drifting. */
    retint() { if (canvas) tint(); },
    /* How much of it there is, nought to a hundred. Nought stops it outright rather than
     * drawing an empty canvas under the glass for ever, which would be the compositor
     * paying for something with nothing in it. */
    strength(value) {
      // Two hundred, not a hundred. What used to be the top of the dial is the default,
      // so the room above it has to exist for the dial to travel into.
      const next = J.clamp(Number(value) || 0, 0, 200) / 100;
      if (next === power) return;
      power = next;
      if (!power) { halt(); return; }
      // Back up from nought, on a page that still wants it. begin() is what knows how to
      // build a canvas; calling seed() here would reseed one that is not there.
      if (!canvas) { if (wanted) begin(hueNow); return; }
      seed();
    },
    /* For a trace: J.dust.running is what you turn off to get the second measurement. */
    get running() { return !!raf; },
  };
}());
