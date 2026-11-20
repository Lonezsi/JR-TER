/* Who decides the accent.
 *
 * One rule, in order:
 *
 *   the accent chosen in Settings, pink until somebody changes it       always the base
 *   and if adaptive colours are on:
 *     a song page open   that song's colour, whatever happens to be playing
 *     otherwise          what is on the player: a render's own waveform colour, or a
 *                        song's artwork, neonised
 *     nothing at all     back to the chosen accent
 *
 * An open page outranks the player because looking at a song is a more specific statement
 * about what you are doing than what is playing behind it, and the two agree whenever
 * they are the same song.
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

  /* The song whose page is open, and the picture that page is showing.
   *
   * An open page outranks the player: looking at a song is a more specific statement
   * about what you are doing than what happens to be playing behind it. The cover is
   * carried rather than looked up so the accent samples the exact image on screen.
   */
  let open = null;

  /* Whether this navigation has had its open song claimed. See expect and settle below,
   * and the same pattern in J.pageWash, which exists for the same reason. */
  let claimed = true;

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
  async function fromSong(song, known) {
    const mine = ++token;

    /* The cover the caller already has, or the one the row names.
     *
     * The song page has resolved the real image url before it draws, so it passes it and
     * the accent samples exactly what is on screen. The player has not, but a decorated
     * song row carries the id of its first image, which songs.decorate looks up for a
     * whole list in one query, so this still costs no round trip either way.
     *
     * Neither means no artwork, or the artwork module switched off. The answer then is
     * the colour built from the title, which is the colour the app already draws that
     * song's placeholder cover in. */
    const cover = known
      || (song.artwork_id ? `/api/artwork/${song.artwork_id}/image` : null);

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
    /* An open song page wins. Looking at a song says more about what you are doing than
     * what is playing behind it, and the two agree whenever they are the same song. */
    if (open) {
      fromSong(open.song, open.cover);
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
    /* Take the wheel, and give it back. Releasing decides again, so whatever should be on
     * screen wins the moment the preview ends. */
    hold: () => { held = true; },
    release: () => { held = false; showing = null; decide(); },

    /* A navigation has started and a view may be about to claim the open song.
     *
     * Nothing changes here, and that is the point. Clearing the open song at this moment
     * would set the accent to the player's colour on the way out of a song and then to
     * the next song's colour on the way in, which is one visible step too many and is
     * the fault this file was rewritten to remove. */
    expect: () => { claimed = false; },

    /* This song's page is open. Called by the song view with the cover it has resolved. */
    viewing: (song, cover) => {
      claimed = true;
      open = song ? { song: song, cover: cover || null } : null;
      decide();
    },

    /* The arriving view has rendered. If it never claimed a song, no song page is open.
     *
     * After the render rather than before, so the change lands on a screen that is
     * already showing rather than in the gap between two. */
    settle: () => {
      if (claimed) return;
      claimed = true;
      if (open) {
        open = null;
        decide();
      }
    },
  };
}());
