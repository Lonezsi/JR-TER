/* Routing off the hash.
 *
 * A view is an entry in J.views, so deleting a view file removes the screen and every
 * link to it stops resolving rather than half working.
 */
"use strict";

J.router = (function () {
  let currentPath = "";
  let currentView = "";
  let currentParams = {};
  let token = 0;

  function parse() {
    const raw = (location.hash || "#/").replace(/^#/, "");
    const [pathPart, queryPart] = raw.split("?");
    const parts = pathPart.split("/").filter(Boolean);
    const query = {};
    new URLSearchParams(queryPart || "").forEach((value, key) => { query[key] = value; });

    // A query on the root is a search, and the root without one is the library. The
    // URL stays #/?q= rather than becoming #/search, so every link anybody already has
    // keeps working and the box, which writes this hash, does not have to change.
    if (!parts.length) return { view: query.q ? "search" : "library", params: query };
    // Its own screen rather than a tab of the song, because it is the one thing here
    // that leaves the building.
    if (parts[0] === "song" && parts[2] === "youtube") {
      return { view: "youtube", params: Object.assign({ id: parts[1] }, query) };
    }
    if (parts[0] === "song") return { view: "song", params: Object.assign({ id: parts[1], tab: parts[2] }, query) };
    if (parts[0] === "album") return { view: "album", params: Object.assign({ id: parts[1] }, query) };
    if (parts[0] === "playlist") return { view: "playlist", params: Object.assign({ id: parts[1] }, query) };
    // One shared song. Its own path rather than a tab of #/song, because it is not a song
    // of yours and almost nothing on that screen applies to it.
    if (parts[0] === "shared" && parts[1]) {
      return { view: "share", params: Object.assign({ id: parts[1] }, query) };
    }
    if (J.views[parts[0]]) return { view: parts[0], params: query };
    return { view: "missing", params: { path: pathPart } };
  }

  /* A thin line at the very top while a screen is being fetched.
   *
   * Only after a moment. Navigation is usually a couple of hundred milliseconds, and a
   * bar that flashes for every one of those is worse than no bar: it reads as the app
   * struggling. Past about a fifth of a second a person has started to wonder, and that
   * is when it is worth saying something. */
  let barTimer = null;
  function showProgress() {
    clearTimeout(barTimer);
    barTimer = setTimeout(() => {
      const bar = J.$("#navBar");
      if (bar) { bar.hidden = false; bar.classList.add("running"); }
    }, 180);
  }
  function hideProgress() {
    clearTimeout(barTimer);
    const bar = J.$("#navBar");
    if (!bar || bar.hidden) return;
    bar.classList.remove("running");
    bar.classList.add("done");
    setTimeout(() => { bar.hidden = true; bar.classList.remove("done"); }, 260);
  }

  async function go(options) {
    const { view, params } = parse();
    const mine = ++token;
    /* Refreshing the screen you are already on is not the same as arriving at a new one.
     *
     * Fourteen places reload the song page after a change: a render added, a preset
     * renamed, an album joined. Blanking to a skeleton for each of those makes an edit
     * look like a page load, and the thing you just did flashes out of existence before
     * it comes back. So a refresh keeps what is on screen until the new content is
     * ready, and only a genuine navigation gets the skeleton. */
    /* Three kinds of arriving, and they should not look the same.
     *
     *   a refresh      the same screen redrawn after an edit: keep what is there
     *   a refinement   the same screen with a different query, which is what typing in
     *                  the search box is: also keep what is there, or every keystroke
     *                  blinks the list away and back
     *   a navigation   somewhere else, including another song: show the skeleton,
     *                  because holding the previous song on screen while a different
     *                  one loads is worse than showing nothing
     */
    const sameScreen = view === currentView
      && String(params.id || "") === String(currentParams.id || "");
    const inPlace = sameScreen
      && (!!(options && options.inPlace) || location.hash !== currentPath);

    /* Actually leaving, said out loud.
     *
     * A view that changes something outside its own element has to be able to put it back.
     * Settings is the one that does: the dials preview live, so the app is wearing values
     * that were never saved, and walking away used to leave them on. What came back was a
     * form showing the saved numbers over an app showing the unsaved ones, and the first
     * touch of a slider snapped everything to the form. Reported exactly that way.
     *
     * Not on a refresh or a refinement, which are the same screen redrawing. */
    if (currentView && !sameScreen) J.emit("view:leaving", currentView);

    showProgress();

    /* A fresh element every time, rather than emptying the old one.
     *
     * Views attach their own delegated click handlers to this node. Emptying it left
     * every previous view's handler attached, so after six navigations one click on Play
     * called playSong six times and the concurrent starts fought each other. Replacing
     * the node throws the old listeners away with it. */
    const old = J.$("#view");
    const root = document.createElement("div");
    root.id = "view";
    // A fresh node either way: views attach delegated handlers to it, and reusing the
    // old one left every previous screen's listeners attached.
    root.className = old.className + (inPlace ? "" : " entering");
    const wasScrolled = old.scrollTop;
    /* The ground belongs to whichever view is arriving, and a view does not know it is
     * leaving, so the decision stays here. It is no longer made here, though.
     *
     * Clearing at this moment faded the whole page out and back in on every navigation,
     * because the arriving view sets its own ground only once its fetches return. This
     * says "somebody may claim this" and the answer is read in settle(), after the view
     * has rendered. */
    if (!inPlace) J.pageWash.expect();
    if (inPlace) root.innerHTML = old.innerHTML;
    old.replaceWith(root);
    // After the in place copy above, which serialises the previous screen's foot into
    // this one's markup: attaching here is what clears that stray and takes ownership.
    J.pageFoot.attach(root);
    if (inPlace) root.scrollTop = wasScrolled;

    /* Whether the reader has scrolled since this navigation started.
     *
     * The reset at the end of this function runs after the fetches, and a screen is
     * scrollable long before then: the skeleton goes in straight away, so on a phone you
     * open a song, start reading down it, and a second later the content arrives and
     * throws you back to the top. Reported exactly that way.
     *
     * Once, and it takes itself off. Writing the skeleton cannot trip it, because the node
     * is new and therefore already at nought, and nothing in a view scrolls this element
     * on the way in. */
    let scrolled = false;
    root.addEventListener("scroll", () => { scrolled = true; },
                          { once: true, passive: true });

    const settle = () => {
      hideProgress();
      // Nobody claimed the ground, so this screen wants none. See J.pageWash.expect.
      J.pageWash.settle();
      // Next frame, so the browser has the starting state to animate away from.
      requestAnimationFrame(() => root.classList.remove("entering"));
    };

    const screen = J.views[view];
    if (!screen) {
      settle();
      root.innerHTML = `<div class="section"><div class="empty">
        <h3>Nothing here</h3>
        <p>That screen is not part of this build. It may be a module that is switched off.</p>
        <a class="btn primary" href="#/" data-link style="margin-top:var(--s4)">Back to the library</a>
      </div></div>`;
      return;
    }

    /* Something in roughly the right shape, right away. The alternative is an empty
     * rectangle for as long as the fetches take, which reads as the app having broken
     * rather than as the app working. */
    if (!inPlace) {
      root.innerHTML = J.skeleton(view === "song" ? "song" : "list");
      requestAnimationFrame(() => root.classList.remove("entering"));
    }
    try {
      await screen.render(root, params);
    } catch (e) {
      // A view that throws must say so. A blank panel with a console error is the
      // failure that wastes the most time.
      if (mine !== token) return;
      settle();
      root.innerHTML = `<div class="section"><div class="empty">
        <h3>This screen did not load</h3>
        <p>${J.esc(e.message)}</p>
        <button class="btn" onclick="J.router.reload()" style="margin-top:var(--s4)">Try again</button>
      </div></div>`;
      return;
    }
    if (mine !== token) return;
    settle();
    currentPath = location.hash;
    currentView = view;
    currentParams = params;
    J.markNav(view);
    /* Only a real navigation goes back to the top, and only if nobody has gone anywhere.
     *
     * Writing the content resets the scroll, so a restored position has to be the one
     * captured before the swap rather than the one read back afterwards, which is always
     * nought. And a fresh screen is only sent to the top if the reader has not already
     * moved: they were reading it while it loaded, and where they got to is theirs. */
    if (inPlace) root.scrollTop = wasScrolled;
    else if (!scrolled) root.scrollTop = 0;
  }

  return {
    start() {
      window.addEventListener("hashchange", go);
      go();
    },
    /* Redraw the current screen without it looking like a page load. */
    reload() { go({ inPlace: true }); },
    /* The full treatment, for when the screen really is being replaced. */
    hard() { go(); },
    get view() { return parse().view; },
  };
})();
