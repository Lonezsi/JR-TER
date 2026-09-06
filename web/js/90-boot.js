/* Starting up.
 *
 * Ask the server what it can do, build the navigation from the answer, then hand over
 * to the router. Nothing in the interface assumes a module exists.
 */
"use strict";

J.applyAccent = function (hex) {
  if (!hex) return;
  const root = document.documentElement;
  root.style.setProperty("--accent", hex);
  // The hover and soft variants are derived so one setting stays one setting.
  root.style.setProperty("--accent-hi", J.lighten(hex, 0.14));
  root.style.setProperty("--accent-lo", J.lighten(hex, -0.18));
  root.style.setProperty("--accent-soft", J.alpha(hex, 0.14));
  root.style.setProperty("--accent-line", J.alpha(hex, 0.4));
  // The dust is stamped from a prebuilt sprite rather than recoloured every frame, so it
  // has to be told. Nothing happens unless it is actually drifting.
  J.dust.retint();
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = getComputedStyle(document.body).backgroundColor || "#0F1311";
};

J.rgb = (hex) => {
  const value = String(hex || "").replace("#", "");
  const full = value.length === 3 ? value.split("").map((c) => c + c).join("") : value;
  const n = parseInt(full, 16);
  return Number.isFinite(n) ? { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }
                            : { r: 84, g: 179, b: 122 };
};
J.lighten = (hex, amount) => {
  const { r, g, b } = J.rgb(hex);
  const mix = (c) => Math.round(J.clamp(amount > 0 ? c + (255 - c) * amount : c * (1 + amount), 0, 255));
  return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`;
};
J.alpha = (hex, a) => {
  const { r, g, b } = J.rgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
};

/* Register an uploaded display face under one name, so the whole stylesheet can ask for
 * "Jriter Display" and get either your font or the open one behind it. */
J.wearFont = function (info) {
  const already = document.getElementById("jriter-display-face");
  if (already) already.remove();
  if (!info || !info.custom_font) return;
  const format = { "font/ttf": "truetype", "font/otf": "opentype",
                   "font/woff": "woff", "font/woff2": "woff2" }[info.font_format] || "truetype";
  const style = document.createElement("style");
  style.id = "jriter-display-face";
  style.textContent = `@font-face {
    font-family: "Jriter Display";
    src: url("/api/appearance/font?v=${Math.floor(info.uploaded_at || 0)}") format("${format}");
    font-display: swap;
  }`;
  document.head.appendChild(style);
};

J.markNav = function (view) {
  J.$$("#nav a").forEach((link) => {
    link.classList.toggle("on", link.dataset.view === view);
  });
};

const NAV_ICONS = {
  library: '<svg viewBox="0 0 24 24" width="18" height="18"><path d="M4 6h16M4 12h16M4 18h10" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" fill="none"/></svg>',
  sync: '<svg viewBox="0 0 24 24" width="18" height="18"><path d="M3 7h6l2 2h10v10H3z" stroke="currentColor" stroke-width="1.7" fill="none" stroke-linejoin="round"/></svg>',
  renders: '<svg viewBox="0 0 24 24" width="18" height="18"><path d="M12 3v10m0 0l3.5-3.5M12 13L8.5 9.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" fill="none"/><path d="M4 15v3a2 2 0 002 2h12a2 2 0 002-2v-3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" fill="none"/></svg>',
  settings: '<svg viewBox="0 0 24 24" width="18" height="18"><circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="1.7" fill="none"/><path d="M12 3v3m0 12v3M3 12h3m12 0h3M5.6 5.6l2.1 2.1m8.6 8.6l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
};

async function buildRail(state) {
  const nav = J.$("#nav");
  const items = [["library", "Library"]];
  if (state.modules.includes("renders")) items.push(["renders", "Renders"]);
  if (state.modules.includes("sync")) items.push(["sync", "Folders"]);
  items.push(["settings", "Settings"]);
  nav.innerHTML = items.map(([view, label]) =>
    `<a href="#/${view === "library" ? "" : view}" data-link data-view="${view}">
       ${NAV_ICONS[view] || ""}<span>${label}</span>
       ${view === "renders" ? `<span class="nav-badge" id="renderBadge" hidden></span>` : ""}</a>`).join("");

  refreshRenderBadge();
  await refreshRailAlbums(state);
  await refreshRailPlaylists(state);
}

/* How many renders are still waiting to be told what they are. Read from the server
 * rather than counted in the page, because the desktop client adds to that list too. */
async function refreshRenderBadge() {
  const badge = document.getElementById("renderBadge");
  if (!badge) return;
  try {
    const data = await J.get("/api/renders");
    badge.textContent = data.waiting || "";
    badge.hidden = !data.waiting;
  } catch (e) {
    badge.hidden = true;
  }
}

/* Playlists of your own in the rail. An album's own is reached through the album, which
 * is where the songs in it are decided, so listing it separately would be two doors to
 * one room. */
async function refreshRailPlaylists(state) {
  const holder = J.$("#railPlaylists");
  if (!holder) return;
  if (!state.modules.includes("playlists")) { holder.innerHTML = ""; return; }
  try {
    const data = await J.get("/api/playlists");
    const mine = (data.playlists || []).filter((p) => !p.album_id);
    holder.innerHTML = mine.length
      ? `<div class="eyebrow">Playlists</div>` + mine.map((p) => `
          <a class="rail-album" href="#/playlist/${p.id}" data-link>
            ${J.cover({ title: p.title, className: "cover" })}
            <span class="truncate">
              <span class="t truncate">${J.esc(p.title)}</span>
              <span class="s truncate">${p.count} item${p.count === 1 ? "" : "s"}</span>
            </span>
          </a>`).join("")
      : "";
  } catch (e) {
    holder.innerHTML = "";
  }
}

async function refreshRailAlbums(state) {
  const holder = J.$("#railAlbums");
  if (!state.modules.includes("albums")) { holder.innerHTML = ""; return; }
  try {
    const data = await J.get("/api/albums");
    const albums = data.albums || [];
    holder.innerHTML = albums.length
      ? `<div class="eyebrow">Albums</div>` + albums.map((album) => `
          <a class="rail-album" href="#/album/${album.id}" data-link>
            ${J.cover({
              url: album.has_cover ? `/api/albums/${album.id}/cover` : null,
              title: album.title, className: "cover",
            })}
            <span class="truncate">
              <span class="t truncate">${J.esc(album.title)}</span>
              <span class="s truncate">${album.song_count} song${album.song_count === 1 ? "" : "s"}</span>
            </span>
          </a>`).join("")
      : "";
  } catch (e) {
    holder.innerHTML = "";
  }
}

async function boot() {
  let state;
  try {
    state = await J.get("/api/state");
  } catch (e) {
    document.body.innerHTML =
      `<div style="padding:48px;font-family:system-ui;color:#E8EDE9">
         <h1 style="font-family:Syne,sans-serif">JR!TER is not answering</h1>
         <p>${J.esc(e.message)}</p>
         <p style="color:#9BA8A0">Start it with <code>python server.py</code> and reload.</p>
       </div>`;
    return;
  }

  J.state = state;
  J.state.modules = state.modules || [];
  document.title = state.name || "JR!TER";
  // The name only. Setting textContent on the anchor itself would take the mark
  // beside it with it: textContent replaces everything inside, so the rest would
  // vanish the moment /api/state answered.
  J.$("#wordmarkName").textContent = state.name || "JR!TER";
  J.applyAccent(state.settings && state.settings.accent);
  J.wearFont(state.summary && state.summary.appearance);

  /* The version, not the commit it was built from.
   *
   * A short sha said which checkout this was and nothing whatever about what is in it,
   * and it is not the thing the banner, the devlog or the popup name. The commit is
   * still the useful half when something has to be reported, so it stays as the hover. */
  const version = J.$("#railVersion");
  if (version) {
    version.textContent = state.version ? "v" + state.version : "";
    const commit = state.summary && state.summary.updater && state.summary.updater.commit;
    if (commit) version.title = "commit " + commit;
  }

  for (const [name, detail] of Object.entries(state.failed || {})) {
    J.toast(`The ${name} module did not load, so that feature is missing.`, "bad");
    console.warn(`[jriter] module ${name} failed to load\n`, detail);
  }

  // No module, no box. A search field that filters nothing is worse than no field.
  const box = J.$(".search");
  if (box) box.hidden = !state.modules.includes("search");

  await buildRail(state);

  // ── shell wiring ─────────────────────────────────────────────────────────
  /* The rail can be put away at any width. On a wide screen its column collapses and
   * the library takes the room; on a narrow one it slides off as an overlay. One class
   * covers both, so the two buttons always do something rather than only doing something
   * below a breakpoint. */
  const shell = J.$("#app");
  const RAIL_KEY = "jriter.rail.shut";
  const narrow = () => window.matchMedia("(max-width: 900px)").matches;

  /* The drag in progress, or null.
   *
   * Declared up here rather than beside the handlers, because setRail hands the rail
   * back to the stylesheet and setRail is called once during boot before anything has
   * been dragged. A let further down would still be in its dead zone at that moment and
   * the app would not start at all. */
  let drag = null;

  function setRail(shut) {
    // Whatever a finger pinned the rail to has to go, or the class it is being handed
    // back to has nothing to move it from.
    if (drag) stopDrag();
    shell.classList.toggle("rail-shut", shut);
    // Only a deliberate choice on a wide screen is worth remembering. On a phone the
    // rail always starts out of the way.
    if (!narrow()) localStorage.setItem(RAIL_KEY, shut ? "1" : "0");
  }
  setRail(narrow() ? true : localStorage.getItem(RAIL_KEY) === "1");

  /* Sliding the rail.
   *
   * It used to be a threshold: fifty five pixels sideways set a class and the stylesheet
   * carried the rail the whole way by itself. That is a button pressed by accident
   * rather than a drag, and it could only ever go all the way or not at all. Now the
   * rail is under the thumb for as long as the thumb is down, it stops where the thumb
   * stops, and only the last stretch is animated.
   *
   * The gesture starts almost anywhere, which on a phone is the point: a list is mostly
   * rows, and a row has no horizontal gesture of its own, so asking for genuinely blank
   * space would have meant almost nowhere to do it. Only the handful of things that are
   * dragged across on purpose are left out, and each is named below with the reason.
   */
  const KEEPS_ITS_GESTURES = [
    // Things that are dragged sideways on purpose.
    ".deck-window",      // lyric cards are swiped between
    ".comp-scroll",      // the arrangement scrolls across
    "canvas",            // the equaliser and the limiter are dragged in both axes
    ".range", ".bar",    // sliders and the scrub bar
    ".q-knob",
    // Things that scroll inside themselves.
    ".sheet", ".slot-menu", ".pick-list",
  ].join(", ");

  //: How far one direction has to win by before the drag commits to it, in pixels.
  const LOCK = 8;
  //: A mouse does not track, it keeps the old threshold. How far across before it counts.
  const SWIPE = 55;
  //: Past either end the rail moves this fraction of the finger, so an end feels like one.
  const BAND = 0.32;
  //: Pixels per millisecond that read as a throw rather than a push, about 450 a second.
  const FLICK = 0.45;
  //: A finger that has not moved for this long was resting, whatever it did before that.
  const STILL = 80;
  //: A drag is followed by a click nobody asked for. Ignore one for this long afterwards.
  const AFTER_DRAG = 400;

  /* Empty means nothing here does anything when you press it.
   *
   * Not a list of class names, which was the first attempt and was wrong twice over: it
   * named containers like the hero and the block heads, which cover most of a song page
   * on a phone, and it could never keep up with markup that changes. The question that
   * actually matters is whether the thing under the finger has a press of its own, and
   * an element that does says so: it is a link or a control, it carries an action, or it
   * is drawn with a pointer cursor. Anything else is background, and background is where
   * this gesture lives.
   */
  const INTERACTIVE = "a, button, input, textarea, select, label, summary, [role=button],"
    + " [data-act], [data-link], [data-image], [data-play], [data-preset], [data-slot],"
    + " [data-go], [data-sort-list], [data-new-song], [data-new-album], [data-song],"
    + " [data-render], [data-post], [data-item], [data-index], [data-album], [contenteditable]";

  function hasAPressOfItsOwn(node) {
    if (!node || !node.closest) return false;
    if (node.closest(INTERACTIVE)) return true;
    // The catch all: anything drawn as pressable is pressable, whatever it is called.
    for (let at = node, depth = 0; at && at !== document.body && depth < 6; at = at.parentElement, depth++) {
      if (at.nodeType !== 1) continue;
      if (getComputedStyle(at).cursor === "pointer") return true;
    }
    return false;
  }

  const railNode = J.$("#rail");
  const scrim = J.$("#railScrim");
  let dragEndedAt = -1e9;

  /* How far the rail moves between shut and open. Measured rather than written down a
   * second time: the stylesheet parks it at its own width plus one gap off the left
   * edge, and --s3 is that gap. */
  function railTravel() {
    const gap = parseFloat(getComputedStyle(document.documentElement)
      .getPropertyValue("--s3"));
    return railNode.getBoundingClientRect().width + (gap || 12);
  }

  /* Put the rail where the finger is. x is measured from open, so 0 is open and
   * minus travel is shut. */
  function railTo(x) {
    let at = x;
    // Past the ends it gives less than it is asked for, so open and shut feel like walls
    // rather than like the drag having quietly stopped working.
    if (at > 0) at = at * BAND;
    else if (at < -drag.travel) at = -drag.travel + (at + drag.travel) * BAND;
    railNode.style.setProperty("--rail-x", `${Math.round(at)}px`);
    // The dim is driven off the same number, so the room darkens as the rail comes out
    // instead of after it has arrived.
    scrim.style.opacity = String(J.clamp(1 + at / drag.travel, 0, 1));
  }

  /* Hand the rail back to the stylesheet.
   *
   * The transition ban and the pinned position have to be lifted in the same breath as
   * the class changes. A browser animates between the style before a change and the
   * style after it, so doing all three at once gives it exactly one move to make, from
   * wherever the thumb left the rail to wherever the class says it lives. Doing them a
   * frame apart makes the rail jump first and then animate nothing. */
  function stopDrag() {
    drag = null;
    shell.classList.remove("rail-dragging");
    railNode.style.removeProperty("--rail-x");
    scrim.style.removeProperty("opacity");
  }

  document.addEventListener("pointerdown", (e) => {
    drag = null;
    if (e.button) return;                                   // a right or middle press
    if (!narrow()) return;                                  // wide screens collapse, not slide
    if (e.target.closest(KEEPS_ITS_GESTURES)) return;       // something else owns this
    /* The rail is not on that list any more.
     *
     * It was, on the grounds that it is the thing being opened, and the result was that
     * once it was open there was nowhere to put a thumb to push it back: the one surface
     * within reach was the one surface the gesture refused. Its links do not disqualify
     * it either, because most of an open rail is album rows. Nothing moves until the
     * finger has gone eight pixels sideways, so a press is still a press, and the click
     * that follows a real drag is thrown away further down. */
    const onRail = !!e.target.closest(".rail");
    if (!onRail && hasAPressOfItsOwn(e.target)) return;
    drag = {
      id: e.pointerId, mouse: e.pointerType === "mouse",
      x: e.clientX, y: e.clientY,
      axis: false, at: 0, moved: false, travel: 0, base: 0,
      // Where and when the last speed sample was taken.
      px: e.clientX, t: e.timeStamp, v: 0,
    };
  }, { passive: true });

  document.addEventListener("pointermove", (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;

    /* Which way this gesture is going, decided once and then kept.
     *
     * The old rule threw the gesture away the moment vertical was merely larger than
     * horizontal, and it asked that on the very first move event. A thumb does not
     * travel in a straight line, so a swipe that started one pixel high was gone before
     * it had said anything. Neither direction wins now until one of them has eight
     * pixels, and after that the gesture is committed and the other one is ignored. */
    if (!drag.axis) {
      if (Math.abs(dy) >= LOCK && Math.abs(dy) > Math.abs(dx)) { drag = null; return; }
      if (Math.abs(dx) < LOCK) return;
      drag.axis = true;
      /* A mouse keeps the old threshold and does not track.
       *
       * A mouse dragged sideways across text is selecting it, and for the first few
       * pixels that looks exactly like this gesture. Eight pixels is far too early to
       * tell them apart, and there is a button for this an inch away. */
      if (drag.mouse) return;
      // Measured here rather than on every press in the app: this is the first moment we
      // know there is a drag at all, and reading a rect costs a layout.
      drag.travel = railTravel();
      drag.base = shell.classList.contains("rail-shut") ? -drag.travel : 0;
      try { railNode.setPointerCapture(e.pointerId); } catch (err) { /* still works */ }
      shell.classList.add("rail-dragging");
    }

    if (drag.mouse) {
      if (Math.abs(dx) < SWIPE) return;
      // A mouse drag that picked up words on the way was a selection after all.
      if (!(window.getSelection() || { isCollapsed: true }).isCollapsed) { drag = null; return; }
      drag = null;
      setRail(dx < 0);                                      // right opens, left shuts
      return;
    }

    /* Speed, taken from the events themselves.
     *
     * event.timeStamp is a high resolution stamp put on every pointer event by the same
     * clock, so there is no clock of our own to disagree with it. Sampled at least a
     * frame apart, because two events a fraction of a millisecond apart divide by nearly
     * nothing and report a throw that never happened. */
    if (e.timeStamp - drag.t >= 8) {
      drag.v = (e.clientX - drag.px) / (e.timeStamp - drag.t);
      drag.px = e.clientX;
      drag.t = e.timeStamp;
    }

    drag.moved = true;
    drag.at = drag.base + dx;
    railTo(drag.at);
  }, { passive: true });

  document.addEventListener("pointerup", (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    if (!drag.axis || drag.mouse) { drag = null; return; }
    try { railNode.releasePointerCapture(e.pointerId); } catch (err) { /* already gone */ }
    /* How far it got, and how fast it was going when it was let go.
     *
     * Distance alone is wrong for a flick: a quick throw from the left edge is plainly
     * open and has covered forty of the two hundred and fifty six pixels it would need.
     * Speed alone is wrong the other way: a rail pushed nine tenths of the way shut and
     * released is shut, at no speed at all. So speed decides when there is any and
     * distance decides when there is not, and a finger that has been still for a moment
     * has none, whatever it was doing before it stopped. That last part is what makes it
     * stop where the thumb stopped. */
    const speed = e.timeStamp - drag.t > STILL ? 0 : drag.v;
    const shut = Math.abs(speed) >= FLICK ? speed < 0 : drag.at < -drag.travel / 2;
    if (drag.moved) dragEndedAt = e.timeStamp;
    setRail(shut);
  }, { passive: true });

  document.addEventListener("pointercancel", (e) => {
    if (!drag) return;
    const wasShut = drag.base < 0;
    const tracking = drag.axis && !drag.mouse;
    if (!tracking) { drag = null; return; }
    // The system took the gesture back: a notification, a second finger, the browser
    // deciding this was a scroll after all. Put the rail back where it started rather
    // than guessing what was meant by half a gesture.
    try { railNode.releasePointerCapture(e.pointerId); } catch (err) { /* already gone */ }
    setRail(wasShut);
  }, { passive: true });

  /* The click at the end of a drag.
   *
   * Wherever the finger let go is about to be clicked, and after a drag that means an
   * album row navigating, or the scrim shutting the rail that was just pulled open. The
   * gesture has already said what it meant, so the click after it says nothing.
   *
   * Timed rather than a listener added for one click and taken away again: a drag that
   * ends over nothing clickable produces no click at all, and that listener would sit
   * there armed, waiting to eat a real one much later. */
  document.addEventListener("click", (e) => {
    if (e.timeStamp - dragEndedAt > AFTER_DRAG) return;
    dragEndedAt = -1e9;
    e.preventDefault();
    e.stopPropagation();
  }, true);

  J.$("#railOpen").addEventListener("click", () => setRail(false));
  J.$("#railClose").addEventListener("click", () => setRail(true));
  J.$("#railScrim").addEventListener("click", () => setRail(true));
  // Following a link on a phone should not leave the overlay sitting over the answer.
  window.addEventListener("hashchange", () => { if (narrow()) setRail(true); });
  window.matchMedia("(max-width: 900px)").addEventListener("change", (e) => {
    setRail(e.matches ? true : localStorage.getItem(RAIL_KEY) === "1");
  });

  J.$("#newSong").addEventListener("click", () => J.newSong());

  const search = J.$("#search");
  const runSearch = J.debounce(() => {
    const term = search.value.trim();
    location.hash = term ? `#/?q=${encodeURIComponent(term)}` : "#/";
  }, 220);
  search.addEventListener("input", runSearch);

  /* Show what the list is filtered by.
   *
   * The term is written into the hash and was never read back, so a reload, a Back, or a
   * link into a search showed a filtered library above an empty box, with no way to tell
   * why half the songs were missing. */
  function showTerm() {
    const at = location.hash.indexOf("?");
    const params = new URLSearchParams(at < 0 ? "" : location.hash.slice(at + 1));
    const term = params.get("q") || "";
    if (document.activeElement !== search && search.value !== term) search.value = term;
  }
  window.addEventListener("hashchange", showTerm);
  showTerm();
  search.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { search.value = ""; runSearch.now(); search.blur(); }
    /* Into the answers. Down out of a search box is what a hand tries first, and
     * without it the results were reachable only by tabbing past everything in the
     * topbar. The rows take it from here. */
    if (e.key === "ArrowDown") {
      const first = J.$("#view .track, #view [data-hit]");
      if (first) { e.preventDefault(); first.focus(); }
    }
    if (e.key === "Enter") runSearch.now();
  });

  /* Albums in the rail get the same menu as the cards in the library, because they are
   * the same album and a person should not have to remember which copy of a thing they
   * are pointing at. */
  const railAlbums = J.$("#railAlbums");
  if (railAlbums) {
    J.menu.on(railAlbums, ".rail-album", (node) => {
      const href = node.getAttribute("href") || "";
      const id = href.split("/").pop();
      if (!id) return null;
      return [
        { label: "Open", icon: "open", hint: "Click", run: () => { location.hash = href; } },
        { label: "Play it through", icon: "play",
          run: async () => {
            const data = await J.try(() => J.get(`/api/albums/${id}`));
            const list = data && data.songs;
            if (!list || !list.length) { J.toast("That album has no songs in it yet."); return; }
            J.playSong(list[0], list);
          } },
      ];
    });
  }

  J.on("albums:changed", () => refreshRailAlbums(J.state));
  J.on("playlists:changed", () => refreshRailPlaylists(J.state));
  J.on("renders:changed", refreshRenderBadge);
  J.on("settings:changed", async () => {
    const fresh = await J.get("/api/state");
    J.state.settings = fresh.settings;
    document.title = fresh.name;
    J.$(".wordmark").textContent = fresh.name;
  });
  J.on("songs:changed", () => { if (J.router.view === "library") J.router.reload(); });

  /* What the keyboard does, on the one key nobody has to be told about.
   *
   * Five shortcuts existed and there was nowhere at all to find out they did. A key that
   * is a question mark asking a question is the one piece of interface that explains
   * itself, and the rail says it quietly so it can be found without knowing first. */
  function showKeys() {
    if (J.$(".sheet")) return;
    const row = (keys, what) => `<div class="key-row">
      <span class="keys">${keys.map((k) => `<kbd>${J.esc(k)}</kbd>`).join("")}</span>
      <span>${J.esc(what)}</span></div>`;
    J.sheet({
      title: "Keyboard",
      sub: "Anywhere that is not a text field.",
      confirm: "",
      cancel: "Close",
      body: [
        row(["Space"], "play or pause"),
        row(["X"], "swap A and B"),
        row(["/"], "jump to search"),
        row(["←", "→"], "page between sets of lyrics"),
        row(["Shift", "←", "→"], "previous or next song"),
        row(["Backspace"], "remove the selected section, in the compositor"),
        row(["Esc"], "close this"),
        row(["?"], "show this again"),
      ].join(""),
    });
  }

  /* A failure inside an async handler used to reach nothing at all.
   *
   * Twice in one week: a ReferenceError in a click handler that saved on the server and
   * then silently stopped, and a dead call in the equaliser that killed every drag. Both
   * were invisible because window.onerror does not see a rejected promise, and neither
   * left a mark anywhere. */
  window.addEventListener("unhandledrejection", (e) => {
    const why = (e.reason && (e.reason.message || e.reason)) || "something failed";
    console.error("unhandled:", e.reason);
    J.toast(`Something went wrong: ${String(why).slice(0, 120)}`, "bad");
  });

  // ── keyboard ─────────────────────────────────────────────────────────────
  document.addEventListener("keydown", (e) => {
    const typing = e.target.closest("input, textarea, select, [contenteditable]");
    if (e.key === "/" && !typing) { e.preventDefault(); search.focus(); search.select(); return; }
    if (typing) return;

    /* A key does one thing, and the thing nearest the hand wins.
     *
     * Space on a focused row called playSong here and toggle() there and toggle() again
     * inside playSong's same-song branch, so pressing it raced three ways. And with a
     * sheet or a menu open, Space was toggling the music behind the dialog somebody was
     * reading. Anything with its own answer for this key gets it; the page takes what is
     * left. */
    if (J.menu.isOpen || document.querySelector(".sheet, dialog[open]")) return;
    if (e.key === " " && e.target.closest("[role=button], button, a, [tabindex]")) return;

    if (e.key === " ") { e.preventDefault(); J.player.toggle(); }
    if (e.key === "x" || e.key === "X") { e.preventDefault(); J.player.swap(); }
    // The lyric deck answers Shift+Arrow when it has focus, so the transport only takes
    // it when nothing on the page has claimed it.
    if (e.defaultPrevented) return;
    if (e.key === "ArrowRight" && e.shiftKey) { e.preventDefault(); J.player.step(1); }
    if (e.key === "ArrowLeft" && e.shiftKey) { e.preventDefault(); J.player.step(-1); }
    if (e.key === "?") { e.preventDefault(); showKeys(); }
  });

  const keysButton = J.$("#railKeys");
  if (keysButton) keysButton.addEventListener("click", showKeys);

  /* Build the audio engine on the first touch of anything, not on the first press of
   * play.
   *
   * A browser will not let a page make an AudioContext until someone has interacted
   * with it, so the work landed on the play button: seventy odd milliseconds of making
   * the context, resuming it and wiring two decks, every one of them spent after the
   * press and before any sound. Any click satisfies the browser, so the first one does
   * it, and by the time play is pressed the engine has been ready for a while.
   */
  const warmAudio = () => {
    document.removeEventListener("pointerdown", warmAudio, true);
    document.removeEventListener("keydown", warmAudio, true);
    try {
      J.audio.resume();
      ["A", "B"].forEach((slot) => J.audio.wire(slot));
    } catch (e) { /* it will be built on the first play instead */ }
  };
  document.addEventListener("pointerdown", warmAudio, true);
  document.addEventListener("keydown", warmAudio, true);

  J.emit("boot");
  J.router.start();

  // Only when this copy changed under them. On a first visit it writes the version down
  // and says nothing at all.
  J.devlog.check(state);

  // A quiet check on startup, so the dot in the corner is the only nagging there is.
  if (J.state.modules.includes("updater") && state.settings.auto_update !== false) {
    setTimeout(async () => {
      try {
        const info = await J.get("/api/update/check");
        if (info.update_available) {
          J.$("#updateDot").hidden = false;
          J.$("#updateDot").title = "An update is ready. Settings has the button.";
        }
      } catch (e) { /* offline is not worth a toast on every start */ }
    }, 2500);
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}
