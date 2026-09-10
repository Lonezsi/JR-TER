/* Who decides the accent.
 *
 * One rule, in order:
 *
 *   the accent chosen in Settings, pink until somebody changes it       always the base
 *   and if adaptive colours are on, whatever is on the player:
 *     a render   its own waveform colour, which it already has
 *     a song     the average colour of its artwork, neonised
 *     nothing    back to the chosen accent
 *
 * The player, and not the page being looked at. That distinction is the whole of this
 * file. The first version of this hung off pageWash, which runs on navigation, and
 * opening one song called it three times: the accent was set three times on the way in,
 * visibly stepping, and the dust canvas was retinted with each one. A colour that belongs
 * to what you are listening to should not change because you walked to another screen,
 * and it should not change three times when you walk to one.
 *
 * So it changes when playback changes, which is rarely and deliberately, and it moves
 * rather than cuts: --accent is a registered <color> with a transition on :root, so
 * setting it here glides and carries every tint in the app with it.
 *
 * A render's colour is not invented. The renders list already gives each one a hue from
 * its name for its waveform, and this reads the same number from the same function, so
 * the accent while a render plays is the colour that render already is everywhere else.
 */
J.accent = (function () {
  /* What the accent was last set to, so a decision that changes nothing does nothing.
   * Every path here ends in a call to apply(), and several of them are reached by more
   * than one event, so without this a settings save would re-set the same colour and
   * retint the dust for no reason. */
  let showing = null;

  /* Set while something else is deliberately driving the colour.
   *
   * The settings screen previews an accent as you drag the picker, by applying it
   * directly. player:change fires many times a second while a song plays, so without
   * this the preview would be overwritten within a frame and the picker would look
   * broken. Nothing else holds it, and the screen releases it on save and on the way
   * out. */
  let held = false;

  function adaptive() {
    return !!(J.state && J.state.settings && J.state.settings.adaptive);
  }

  function apply(hex) {
    if (!hex || hex === showing) return;
    showing = hex;
    J.applyAccent(hex);
  }

  /* The hue a render is already drawn in.
   *
   * 76-view-renders.js sets --wave-hue from J.hue(render.name) for the waveform, so this
   * asks the same function the same question. Reading it off the element instead would
   * mean the accent only worked while the renders list happened to be on screen.
   */
  function hueOfRender(item) {
    const name = item.name || item.filename || item.title || "";
    return J.hue(String(name).replace(/\.[^.]+$/, ""));
  }

  /* The artwork's own colour, or the colour built from the title when there is none.
   *
   * Asynchronous, because sampling a picture means decoding it. The token guards against
   * a fast walk through a queue settling on whichever image decoded last rather than on
   * the one now playing.
   */
  let token = 0;
  async function fromSong(song) {
    const mine = ++token;

    /* artwork_id, not a request. A decorated song row already carries the id of its
     * first image, which songs.decorate looks up for the whole list in one query, so the
     * accent costs no round trip. Asking /api/songs/<id>/artwork here would be a second
     * request per track played, to learn something the row already said.
     *
     * No id means no artwork, or the artwork module switched off. Either way the answer
     * is the colour built from the title, which is the same colour the app already draws
     * that song's placeholder cover in. */
    const cover = song.artwork_id ? `/api/artwork/${song.artwork_id}/image` : null;

    let hue = null;
    if (cover) hue = await J.hueOfImage(cover);
    if (mine !== token) return;                 // something else started playing
    if (hue === null) hue = J.hue(song.title || "");
    apply(J.neon(hue));
  }

  function decide() {
    if (held) return;                           // somebody is previewing; leave it alone
    if (!adaptive()) {
      token++;                                  // cancel any sample still in flight
      apply(J.chosenAccent());
      return;
    }
    const player = J.player && J.player.state;
    const item = player && player.song;
    if (!item) {
      token++;
      apply(J.chosenAccent());
      return;
    }
    const isRender = item.kind === "render" || (player.queueKind === "render");
    if (isRender) {
      token++;
      apply(J.neon(hueOfRender(item)));
      return;
    }
    fromSong(item);
  }

  /* player:change is emitted for position and play state as well as for a change of
   * track, which is many times a second while something is playing. decide() is cheap and
   * apply() is guarded, so the common case costs a couple of comparisons; the expensive
   * path is the picture, and J.hueOfImage remembers every url it has already looked at. */
  J.on("player:change", decide);
  J.on("settings:changed", decide);

  return {
    refresh: decide,
    /* For the settings screen, which previews an accent while you drag the picker and has
     * to be able to put the real one back afterwards. */
    forget: () => { showing = null; },
    /* Take the wheel, and give it back. Releasing decides again, so whatever is on the
     * player wins the moment the preview ends. */
    hold: () => { held = true; },
    release: () => { held = false; showing = null; decide(); },
  };
}());
