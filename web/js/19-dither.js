/* The dither.
 *
 * WHY THERE IS BANDING. A 22px blur produces a ramp that crosses one 8 bit level every
 * few pixels, and the compositor rounds. Rounding a slow ramp turns it into a staircase,
 * and the eye is very good at staircases: Mach banding exaggerates the edge of each step
 * until a smooth gradient reads as a set of stripes. Every wide blur in this app has this
 * problem and the wash behind a song page has it worst, because a blurred photograph at
 * low opacity is nothing but slow ramps.
 *
 * WHY THE FIRST ATTEMPT DID NOT WORK, since it is the whole reason this file exists. It
 * was an feTurbulence with three octaves drawn at half its natural size. Three octaves of
 * fractalNoise is cloud: its energy is at low spatial frequencies, tens of pixels per
 * feature. And drawing a 140px tile at 70px asks the browser to resample it, which is a
 * bilinear filter, which is a low pass filter: whatever high frequency was in there was
 * averaged away before it reached the screen. The result was a layer that added visible
 * cloudiness and did nothing whatever to the banding, because it had no per pixel content
 * to break a level boundary with.
 *
 * WHAT DITHERING ACTUALLY REQUIRES is that the value added to one pixel be independent of
 * the value added to its neighbour. Then, along a ramp sitting between two levels, some
 * pixels round up and some round down in proportion to where the true value lies, and the
 * average over any small area is the true value. The staircase becomes noise, and noise at
 * this amplitude is invisible while a staircase is not. That is the trade dithering makes
 * and it is why it is worth making.
 *
 * So the noise is generated here, one texel per device pixel, and handed to the stylesheet
 * as an image that must not be resampled on the way to the screen. Both halves of that
 * matter: a tile scaled by even a few per cent goes through the same bilinear filter that
 * ruined the first attempt.
 *
 * AND IT IS ADDED, not multiplied. This is the other half of why the first attempt failed
 * and it is the more important half. It blended with overlay, which on a dark base works
 * out to the base times one plus or minus the texel, so the amount of dither was
 * proportional to how bright the pixel already was. This app is almost black: the surface
 * is #0B0B0C. At that base the perturbation fell well under one level, which is the same
 * as no dither at all, and measuring it against a near black ramp showed exactly that,
 * seven of fourteen bands still standing. Meanwhile the same setting was fine on mid
 * tones, which is why it looked like it worked and why the banding came and went with the
 * artwork. plus-lighter adds a fixed amount whatever is underneath, so two levels is two
 * levels in the darkest corner of the app and on the brightest cover.
 *
 * THE DISTRIBUTION is triangular rather than uniform, which is the same choice made when
 * dithering audio and for the same reason: TPDF noise of two quantisation steps peak to
 * peak makes the error of the rounded signal independent of the signal itself. Uniform
 * noise leaves the error correlated with the value, which on a slow ramp is a faint
 * remaining pattern. Two uniform randoms added together is a triangular distribution, and
 * that is the whole of the maths.
 */
"use strict";

J.dither = (function () {
  //: The tile, in device pixels. Big enough that its repeat is not a pattern anybody can
  //: see at these amplitudes, small enough that generating and holding it is nothing:
  //: 192 squared is 36k texels, about a 40KB PNG.
  const TILE = 192;

  //: How much of the texture is per pixel dither and how much is slow grain. The dither
  //: is the part that does the work; the grain is there because a little of it makes a
  //: flat panel look like a surface rather than a void, and it costs nothing to carry in
  //: the same texture.
  const FINE = 0.82, COARSE = 0.18;

  //: The coarse layer's grid, in texels per cell. Interpolated and wrapped, so the tile
  //: still repeats seamlessly.
  const CELL = 24;

  /* How strong, in eight bit levels, peak to peak, at the top of the dial.
   *
   * Levels rather than a fraction of the screen, because the whole point of blending
   * additively is that the amount added does not depend on what is underneath. Two levels
   * is the textbook amount and it is enough: measured against a near black ramp, two
   * clears every band. Twelve at the top of the dial leaves a lot of room above that,
   * since a blurred photograph can carry ramps far shallower than a synthetic one.
   */
  const MOST_LEVELS = 12;

  /* The fallback, for a browser with no additive blend mode.
   *
   * overlay is multiplicative: on a base darker than half it works out to base times one
   * plus or minus the texel's deviation, so the amount added is proportional to what is
   * already there and collapses to nothing in the darks. Measured on a near black ramp it
   * left half the bands standing at any sane opacity, which is precisely the "sometimes"
   * in "the banding is insane sometimes": it meant on dark content. Where it is the only
   * option it needs a far larger number to do anything at all, and it will be grainy on
   * the mid tones as the price.
   */
  const MOST_OVERLAY = 0.42;

  //: Whether the compositor can add. Asked once: it is a fact about the browser.
  const CAN_ADD = typeof CSS !== "undefined" && CSS.supports
    && CSS.supports("mix-blend-mode", "plus-lighter");

  let cached = null;      // { url, px }

  /* Value noise on a coarse grid, wrapped so the tile has no seam.
   *
   * Smoothstep rather than linear between cells: linear interpolation leaves a visible
   * crease along every cell boundary, because the first derivative jumps there. */
  function coarseField(cells) {
    const grid = new Float32Array(cells * cells);
    for (let i = 0; i < grid.length; i++) grid[i] = Math.random() * 2 - 1;
    const ease = (t) => t * t * (3 - 2 * t);
    return function (x, y) {
      const gx = x / CELL, gy = y / CELL;
      const x0 = Math.floor(gx), y0 = Math.floor(gy);
      const fx = ease(gx - x0), fy = ease(gy - y0);
      // Wrapped on both axes, which is what makes the repeat invisible.
      const ix = (n) => ((n % cells) + cells) % cells;
      const a = grid[ix(y0) * cells + ix(x0)];
      const b = grid[ix(y0) * cells + ix(x0 + 1)];
      const c = grid[ix(y0 + 1) * cells + ix(x0)];
      const d = grid[ix(y0 + 1) * cells + ix(x0 + 1)];
      return (a + (b - a) * fx) + ((c + (d - c) * fx) - (a + (b - a) * fx)) * fy;
    };
  }

  /* The tile itself. One texel per device pixel, greyscale, opaque.
   *
   * Greyscale because this is dithering luminance, and per channel noise would add
   * chroma speckle to a dark grey panel, which reads as a broken screen rather than as
   * grain. Opaque because the layer's own opacity is the amplitude control, and having
   * two of those is how you end up unable to reason about either. */
  function build(px) {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = px;
    const ctx2d = canvas.getContext("2d");
    const image = ctx2d.createImageData(px, px);
    const data = image.data;

    const cells = Math.max(2, Math.round(px / CELL));
    const coarse = coarseField(cells);

    for (let y = 0, at = 0; y < px; y++) {
      for (let x = 0; x < px; x++, at += 4) {
        // Triangular, in [-1, 1]. Two uniforms summed: see the note at the top.
        const fine = Math.random() + Math.random() - 1;
        const mixed = fine * FINE + coarse(x, y) * COARSE;
        // Centred on mid grey, because the blend mode below reads a texel as a signed
        // deviation from the middle and half of the dither has to be downwards.
        const v = Math.round(127.5 + mixed * 127.5);
        data[at] = data[at + 1] = data[at + 2] = v < 0 ? 0 : v > 255 ? 255 : v;
        data[at + 3] = 255;
      }
    }
    ctx2d.putImageData(image, 0, 0);
    return canvas.toDataURL("image/png");
  }

  return {
    /* Put the layer at a strength, generating the texture the first time and whenever
     * the pixel ratio has changed under it, which happens when a window is dragged to a
     * screen of a different density. */
    apply(amount) {
      const layer = J.$("#grain");
      if (!layer) return;

      const strength = J.clamp(Number(amount) || 0, 0, 100) / 100;
      layer.hidden = strength === 0;
      const root = document.documentElement.style;

      /* Additive where the browser can.
       *
       * plus-lighter adds the layer to what is under it, and the layer's own opacity is
       * the scale, so an opacity of L/255 turns a texel spanning nought to one into an
       * addition spanning nought to L levels. The texture is centred on mid grey, so that
       * is a swing of plus or minus L/2 about a lift of L/2, and the lift is the price of
       * a blend mode that can only brighten. At the default it is three levels: pure
       * black becomes #030303, which nobody has ever seen.
       *
       * The alternative would be a second layer that only darkens, and there is no such
       * blend mode in CSS. Three levels of black lift is a much smaller lie than half the
       * bands surviving. */
      if (CAN_ADD) {
        root.setProperty("--dither-blend", "plus-lighter");
        root.setProperty("--dither", (strength * MOST_LEVELS / 255).toFixed(5));
      } else {
        root.setProperty("--dither-blend", "overlay");
        root.setProperty("--dither", (strength * MOST_OVERLAY).toFixed(4));
      }
      if (strength === 0) return;

      // Device pixels, not CSS pixels. On a 2x screen a 192 texel tile has to be drawn
      // 96 CSS pixels wide for one texel to land on one physical pixel, and landing on
      // one physical pixel is the entire point.
      const dpr = window.devicePixelRatio || 1;
      if (!cached || cached.dpr !== dpr) {
        cached = { dpr, url: build(TILE) };
      }
      root.setProperty("--dither-tile", 'url("' + cached.url + '")');
      root.setProperty("--dither-size", (TILE / dpr).toFixed(4) + "px");
    },

    /* Exposed for the settings screen, which drags the dial and wants the layer to
     * follow without a round trip to the server. */
    reseed() { cached = null; },
  };
})();
