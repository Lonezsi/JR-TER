/* The quietest thing on the screen: where the terms are, at the end of every page.
 *
 * Inside #view rather than under it. #view is the scroller, so a link placed after it
 * would be a bar pinned to the bottom of the window on every screen, always in shot and
 * always in the way, which is the opposite of what a line like this is for. Inside, it
 * is simply where the page stops.
 *
 * Owned here rather than written by each view because thirty four places in this app set
 * root.innerHTML, and several of them long after the first render: Settings redraws
 * itself when you clear the font, the song page when a take lands, the search view on
 * every keystroke. A footer that each of those had to remember to re-emit would be
 * missing from whichever one forgot, and nothing would ever notice. The observer puts it
 * back instead, so a view can rewrite itself as often as it likes and never think about
 * this at all.
 */
"use strict";

J.pageFoot = (function () {
  let watching = null;

  function make() {
    const foot = document.createElement("footer");
    foot.className = "page-foot";
    /* A new tab. This one sits at the foot of every screen, including whichever one you
     * are on with a song playing, and the player is part of this document: following it
     * in this tab would stop the music to show you a page about cookies. It carries its
     * own way back to the library anyway, for whoever arrives at it from the door. */
    foot.innerHTML =
      '<a href="/legal" target="_blank" rel="noopener">Terms and privacy</a>';
    return foot;
  }

  function place(root, foot) {
    /* Any strays first, then ours last.
     *
     * Refreshing a screen in place copies the previous one across with
     * `root.innerHTML = old.innerHTML`, which serialises whatever foot was in it. That
     * copy is markup rather than this element, so without clearing it out first the page
     * would gain a second Terms and privacy on every in place refresh, and a third on
     * the one after that. */
    root.querySelectorAll(".page-foot").forEach((other) => {
      if (other !== foot) other.remove();
    });
    if (root.lastElementChild !== foot) root.appendChild(foot);
  }

  return {
    /* Called by the router with each new #view node, which is a fresh element on every
     * navigation, so the previous observer is dropped rather than left watching a node
     * that is no longer in the document. */
    attach(root) {
      if (watching) watching.disconnect();
      const foot = make();
      place(root, foot);
      // Appending fires this too. The second time round the foot is already last and
      // nothing is touched, so it settles rather than looping.
      watching = new MutationObserver(() => place(root, foot));
      watching.observe(root, { childList: true });
    },
  };
})();
