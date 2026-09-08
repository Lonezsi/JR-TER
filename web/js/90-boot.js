/* Starting up.
 *
 * Ask the server what it can do, build the navigation from the answer, then hand over
 * to the router. Nothing in the interface assumes a module exists.
 */
"use strict";

/* Whether this engine renders an SVG filter reference inside a backdrop-filter.
 *
 * The same two Blink only signals the @supports block in 00-tokens.css uses, asked here
 * because the chromatic setting writes that token inline and an inline property beats a
 * stylesheet. Kept in one place so the two answers cannot disagree: if this and that block
 * ever say different things, the app gets a reference it cannot draw and loses the blur
 * with it, which is invisible from here and obvious on the screen.
 *
 * It cannot be a feature test of the thing itself. WebKit parses the reference, reports it
 * supported, and never renders it. */
J.canRefract = CSS.supports("background", "paint(x)")
  || CSS.supports("-webkit-app-region", "no-drag");

J.applyAccent = function (hex) {
  if (!hex) return;
  const root = document.documentElement;
  root.style.setProperty("--accent", hex);
  // The hover and soft variants are derived so one setting stays one setting.
  /* Including the bare numbers, which is what every translucent tint of the accent is
   * built from: ten rules across the stylesheets and two canvas fills want a version of
   * this colour at some alpha, and before this they had the green written out by hand and
   * stayed green whatever was chosen here. */
  const { r, g, b } = J.rgb(hex);
  root.style.setProperty("--accent-rgb", `${r}, ${g}, ${b}`);
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


/* The two dials, applied.
 *
 * Both are numbers from nought to a hundred and both are set in one place, so "how strong
 * is the glass" has a single answer rather than one in a stylesheet, one in a filter and
 * one in a canvas that can drift apart.
 *
 * The aberration cannot be a CSS variable. An feDisplacementMap's scale is an SVG
 * attribute and attributes do not read var(), so the three of them are written here. That
 * is also why this runs on boot and not only when the setting is saved: the filter in the
 * markup carries the shipped numbers and would otherwise ignore the setting entirely
 * until somebody opened Settings and pressed Save.
 */
J.applyLook = function (settings) {
  const said = settings || {};
  const edge = J.clamp(Number(said.glass_edge === undefined ? 100 : said.glass_edge), 0, 200);

  /* The middle scale is the refraction the glass has always had, and it does not move:
   * changing it would change how much the glass bends things, which is a different
   * decision from how far the colours come apart. Only the gap between the three moves.
   * At a hundred that is plus or minus twenty two, which is about four pixels of red to
   * blue separation over most of a panel and is very visible on a hard edge. */
  const base = 26;
  const spread = Math.round((edge / 100) * 22);
  const scales = { rShift: base - spread, gShift: base, bShift: base + spread };
  for (const [name, value] of Object.entries(scales)) {
    const node = document.querySelector(`#glass-ca [result="${name}"]`);
    if (node) node.setAttribute("scale", String(value));
  }
  /* Nought means off, and off means the plain glass rather than three displacements all
   * at the same scale doing three times the work to look identical.
   *
   * An inline property beats the stylesheet, including the @supports block in 00-tokens
   * that decides whether this engine can have a refraction at all. So this asks the same
   * question that block asks, and on an engine that cannot render one it writes nothing
   * and lets the cascade stand: turning this dial up in Safari would otherwise put the
   * reference back and take the blur off the rail and the player, which is the whole bug
   * the gate exists to avoid. */
  const root = document.documentElement;
  if (spread && J.canRefract) {
    root.style.setProperty("--glass-filter-edge",
                           "url(#glass-ca) blur(22px) saturate(180%) brightness(1.06)");
  } else if (spread) {
    root.style.removeProperty("--glass-filter-edge");
  } else {
    root.style.setProperty("--glass-filter-edge", "var(--glass-filter)");
  }

  /* The dither. One number, handed to the module that owns the texture.
   *
   * Not a --dither variable set from here any more. The strength and the texture cannot
   * be decided in two places: the tile has to be generated at the screen's own pixel
   * density and drawn at exactly its own size, or the browser resamples it and the per
   * pixel variation that does the actual dithering is filtered away. 19-dither.js sets
   * both together. */
  J.dither.apply(said.dither === undefined ? 60 : said.dither);

  J.dust.strength(said.dust === undefined ? 100 : said.dust);
};


/* Who is signed in, at the foot of the rail.
 *
 * Always there, because "which library am I looking at" is a question a server with more
 * than one account on it can always be asked, and a row that appears only sometimes is a
 * row nobody learns to look for. It used to be hidden until a Google account was connected,
 * which meant the JR!TER account it is actually about was never shown at all.
 *
 * Two lines, and which is which depends on what is connected:
 *
 *   connected      the channel's picture and name, with the JR!TER account underneath
 *   not connected  a plain circle and the JR!TER account, with why underneath
 *
 * The big line is whoever you are to the outside world, because that is the one you would
 * check before posting something. The small line is the rest.
 *
 * The picture comes from this server, not from Google. See youtube.avatar for why: the
 * short version is that putting Google's own URL in the page would mean a request to a
 * Google host every time anybody opens the library.
 */
async function showAccount(state) {
  const row = J.$("#railAccount");
  if (!row) return;
  const big = J.$("#railAccountName");
  const small = J.$("#railAccountSub");
  const face = J.$("#railAvatar");

  // Who this is on this server. Comes back on /api/state, so it costs nothing.
  const mine = (state.summary && state.summary.auth && state.summary.auth.who) || null;
  const jriter = (mine && mine.name) || state.name || "JR!TER";

  const letter = (name) => (String(name || "?").trim()[0] || "?").toUpperCase();

  // The state before anything is asked, so the row is right even if the next call fails.
  big.textContent = jriter;
  small.textContent = state.modules.includes("youtube")
    ? "not logged into google" : "";
  face.textContent = letter(jriter);
  face.style.removeProperty("background-image");
  row.hidden = false;

  if (!(state.modules || []).includes("youtube")) return;

  // Caught rather than J.try'd. J.try raises a toast, and "your account could not be
  // looked up" is not news worth interrupting somebody with on the way into the app.
  const said = await J.get("/api/youtube/account").catch(() => null);
  const chosen = said && (said.accounts || []).find((a) => a.id === said.chosen);
  const account = chosen || (said && (said.accounts || [])[0]);
  if (!account) return;                       // the not connected wording above stands

  big.textContent = account.name || jriter;
  small.textContent = jriter;
  face.textContent = letter(account.name || jriter);
  if (account.has_avatar) {
    /* Only once it has loaded.
     *
     * Setting the background straight away means a broken fetch leaves a circle with a
     * letter behind a failed image, and on a slow link an empty circle for as long as it
     * takes. The letter is the resting state and the picture replaces it or does not. */
    const picture = new Image();
    picture.onload = () => {
      face.style.backgroundImage = `url("/api/youtube/avatar")`;
      face.textContent = "";
    };
    picture.src = "/api/youtube/avatar";
  }
}


J.markNav = function (view) {
  J.$$("#nav a").forEach((link) => {
    link.classList.toggle("on", link.dataset.view === view);
  });
};

const NAV_ICONS = {
  library: '<svg viewBox="0 0 24 24" width="18" height="18"><path d="M4 6h16M4 12h16M4 18h10" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" fill="none"/></svg>',
  sync: '<svg viewBox="0 0 24 24" width="18" height="18"><path d="M3 7h6l2 2h10v10H3z" stroke="currentColor" stroke-width="1.7" fill="none" stroke-linejoin="round"/></svg>',
  shared: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="2.4"/><circle cx="6" cy="12" r="2.4"/><circle cx="18" cy="19" r="2.4"/><path d="M8.2 10.8l7.6-4.4M8.2 13.2l7.6 4.4"/></svg>',
  renders: '<svg viewBox="0 0 24 24" width="18" height="18"><path d="M12 3v10m0 0l3.5-3.5M12 13L8.5 9.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" fill="none"/><path d="M4 15v3a2 2 0 002 2h12a2 2 0 002-2v-3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" fill="none"/></svg>',
  settings: '<svg viewBox="0 0 24 24" width="18" height="18"><circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="1.7" fill="none"/><path d="M12 3v3m0 12v3M3 12h3m12 0h3M5.6 5.6l2.1 2.1m8.6 8.6l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
};

async function buildRail(state) {
  const nav = J.$("#nav");
  const items = [["library", "Library"]];
  if (state.modules.includes("renders")) items.push(["renders", "Renders"]);
  if (state.modules.includes("sync")) items.push(["sync", "Folders"]);
  /* Always, when the module is on.
   *
   * It used to appear only once somebody had actually shared something, on the reasoning
   * that an empty list is a nav item that never does anything. That is backwards: nobody
   * can be told "it will turn up under Shared with me" about a place that does not exist
   * yet, and the empty screen is where that promise is made. */
  if (state.modules.includes("sharing")) items.push(["shared", "Shared with me"]);
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
    /* The heading is here whether there are any or not.
     *
     * It used to be absent until the first playlist existed, and the only way to make that
     * first one was through a song: add to a playlist, then New. So the feature was real
     * and had no door of its own, and the rail said nothing about it either way. */
    holder.innerHTML = `
      <div class="eyebrow rail-eyebrow">
        <span>Playlists</span>
        <span class="grow"></span>
        <button class="icon-btn tiny" data-act="new-playlist"
                title="Start a playlist" aria-label="Start a playlist">${J.plus(14)}</button>
      </div>
      ${mine.length ? mine.map((p) => `
        <a class="rail-album" href="#/playlist/${p.id}" data-link>
          ${J.cover({ title: p.title, className: "cover" })}
          <span class="truncate">
            <span class="t truncate">${J.esc(p.title)}</span>
            <span class="s truncate">${p.count} item${p.count === 1 ? "" : "s"}</span>
          </span>
        </a>`).join("")
      : `<div class="rail-none">Nothing yet. A playlist can hold songs and loose
           renders together.</div>`}`;
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
  J.applyLook(state.settings);
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
    // The commit again. The paper beside it is the link now and carries its own title,
    // so this one is free to say the thing it is actually useful for.
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
  showAccount(state);

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
    // The same number the drag writes, at whichever end it landed on. Written rather than
    // removed, because the property is what the search is sized from and a missing one
    // would fall back to its default of nought, which is the open state.
    shell.style.setProperty("--rail-open", shut ? "0" : "1");
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
  /* Does the thing under the finger have a sideways gesture of its own RIGHT NOW.
   *
   * This was a list of selectors, and a list of selectors is a list of things that *can*
   * claim a horizontal drag rather than things that currently do. Most of them only
   * claim one under a condition, and on a song page the condition is usually false: a
   * lyric deck holding one sheet has nowhere to swipe to, and an arrangement strip that
   * fits its box has nothing to scroll. Both refused the gesture anyway, which is why
   * the rail could only be pulled from genuinely empty background, and on a song page
   * there is hardly any.
   *
   * So the question is asked of the element instead of its class name, and the answer
   * changes as the page does. What is left is the two kinds that always mean something:
   * direct manipulation, where every drag is aimed at a value, and a surface that is
   * modal, which owns everything inside it while it is up.
   */
  function claimsSideways(node) {
    if (!node || !node.closest) return false;

    // Every drag on these is a value being set. There is no such thing as a spare
    // sideways gesture on an equaliser node or a scrub bar.
    if (node.closest("canvas, .range, .bar, .q-knob")) return true;

    // Modal while it is up, whichever way you drag on it.
    if (node.closest(".sheet, .slot-menu, .pick-list")) return true;

    // Dragging sideways across words is selecting them, which is the one gesture the
    // lyric editor cannot afford to lose: it is a text box, and this rail would
    // otherwise slide out every time somebody tried to pick a line.
    if (node.closest("textarea, input, select, [contenteditable]")) return true;

    // A deck with somewhere to go. One card is not a carousel, and the panel itself
    // agrees: its own handler returns early below two sheets.
    const deck = node.closest(".deck-window");
    if (deck) {
      const track = deck.querySelector(".deck-track");
      if (track && track.children.length > 1) return true;
    }

    // A strip with more in it than fits. Measured, because an arrangement of four bars
    // does not scroll and an arrangement of two hundred does.
    const strip = node.closest(".comp-scroll");
    if (strip && strip.scrollWidth > strip.clientWidth + 1) return true;

    return false;
  }

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
  //: Holding the rail past its open stop for this long offers the page behind it.
  const HOLD = 1000;
  //: And it waits this long to be pressed before taking itself away.
  //:
  //: Counted from letting go rather than from appearing, because while a thumb is still on
  //: the rail the offer has not been made yet: you cannot press a thing you are holding
  //: the screen down with.
  const OFFERED = 2000;
  //: How far past open counts as holding it there rather than merely having opened it.
  //: Under the overscroll band, which moves the rail a third of the finger, so this is
  //: about fifty pixels of actual thumb travel past the stop: far enough that nobody
  //: arrives here by opening the rail briskly.
  const PAST = 16;

  /* There is no list of things that are too pressable to swipe over any more.
   *
   * There was, and it was the thing that kept this gesture in the margins. It asked
   * whether the element under the finger had a press of its own, and on a song page
   * nearly everything does: a lyric card opens an editor, a render row adds itself to a
   * song, a version chip opens a menu, and every one of them refused to let the rail
   * move. The answer on a phone was that the rail could only be pulled from whatever
   * blank space happened to be left, and there is hardly any.
   *
   * It is not needed, and the rail itself has been the proof for a while: most of an
   * open rail is album links and it has allowed this gesture over them all along. Two
   * things already separate a swipe from a press, and they do it by measurement rather
   * than by guessing from the markup. Nothing moves until the finger has gone eight
   * pixels sideways, so a press is still a press and a tap is still a tap. And the click
   * that arrives at the end of a real drag is thrown away, so the row the finger
   * happened to be resting on when it let go does not fire.
   *
   * What is left out is in claimsSideways above, and everything in it is left out
   * because the sideways drag is already spoken for, not because a press is.
   */

  const railNode = J.$("#rail");
  const scrim = J.$("#railScrim");
  let dragEndedAt = -1e9;

  /* Pull the rail past its stop, hold, and let go somewhere else.
   *
   * The rail already tracks the thumb and already has a soft end past fully open. This
   * gesture lives in that end: keep pushing after the rail has run out of travel and,
   * a second later, the page behind it is offered. It is deliberately not discoverable.
   * Nothing in the library is behind it, so nobody needs to find it by accident, and the
   * cost of missing it is nothing.
   *
   * A timer rather than a distance, because a thumb that is holding still fires no move
   * events at all: the last move sets the clock and the stillness is what runs it down.
   *
   * The buzz is a courtesy and not the signal. navigator.vibrate is absent on iOS and
   * refused by any browser the page has not been interacted with, so the bubble is what
   * everybody gets and the buzz is what some people also get.
   */
  const bubble = J.$("#edgeBubble");
  let holdTimer = null;
  let fadeTimer = null;
  let armed = false;

  function offerAbout() {
    holdTimer = null;
    armed = true;
    if (navigator.vibrate) {
      try { navigator.vibrate(18); } catch (err) { /* refused, and it does not matter */ }
    }
    if (!bubble) return;
    bubble.classList.add("on");
    // Reachable while it is being offered, and neither read out nor tabbable otherwise.
    bubble.removeAttribute("aria-hidden");
    bubble.tabIndex = 0;
  }

  /* Start the clock on an offer nobody has taken.
   *
   * Called when the thumb comes off, not when the bubble appears. An offer you are still
   * holding the screen down on has not been made yet, and a two second timer that started
   * while the finger was down would run out under it.
   */
  function letAboutFade() {
    if (!armed) return;
    clearTimeout(fadeTimer);
    fadeTimer = setTimeout(withdrawAbout, OFFERED);
  }

  function withdrawAbout() {
    if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; }
    if (fadeTimer) { clearTimeout(fadeTimer); fadeTimer = null; }
    if (!armed) return;
    armed = false;
    if (!bubble) return;
    bubble.classList.remove("on");
    bubble.setAttribute("aria-hidden", "true");
    bubble.tabIndex = -1;
  }

  /* Going there: both things leave the way they came, then the page changes.
   *
   * Was inline in the pointerup handler, because letting go was the only way to reach it.
   * The bubble is a button now, so there are two ways in and one of them happens long after
   * the gesture is over.
   */
  function goToAbout() {
    withdrawAbout();
    shell.classList.add("leaving");
    /* setRail with the drag still in hand, where there is one.
     *
     * It calls stopDrag itself, and only `if (drag)`. Clearing drag first, which is what
     * the first version did out of tidiness, skipped that: the inline --rail-x the finger
     * had pinned the rail to survived and outranked the class, and rail-dragging was still
     * on the shell suppressing the transition. The bubble slid away on its own and the rail
     * sat exactly where it had been let go. */
    setRail(true);

    /* The navigation waits for them. Setting the hash straight away redrew the screen
     * underneath while the slide was still running, which is a jump cut with an animation
     * playing over the top of it. The wait is read from the stylesheet rather than written
     * here, so it cannot drift from the transition it is waiting for, and reduced motion
     * collapses --med to a millisecond and this collapses with it. */
    const med = getComputedStyle(document.documentElement).getPropertyValue("--med");
    const ms = Math.max(0, parseFloat(med) || 220);
    setTimeout(() => {
      shell.classList.remove("leaving");
      location.hash = "#/about";
    }, ms + 40);
  }

  if (bubble) {
    bubble.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      goToAbout();
    });
    // A thumb resting on it should not have it vanish mid press.
    bubble.addEventListener("pointerdown", () => clearTimeout(fadeTimer));
    bubble.addEventListener("pointerleave", letAboutFade);
  }

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
    const open = J.clamp(1 + at / drag.travel, 0, 1);
    scrim.style.opacity = String(open);
    // And so is the search, which shrinks to nothing as the rail covers it. One number
    // for the whole gesture: 0 is shut, 1 is open, and the stylesheet decides what that
    // means. Anything else that has to get out of the rail's way can read it too.
    shell.style.setProperty("--rail-open", open.toFixed(3));
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
    // Not removed: setRail writes the end state a line later, and a gap between the two
    // would be one frame of a full width search box appearing over a closing rail.
  }

  document.addEventListener("pointerdown", (e) => {
    drag = null;
    if (e.button) return;                                   // a right or middle press
    if (!narrow()) return;                                  // wide screens collapse, not slide
    // The one question left: is this sideways drag already somebody's.
    if (claimsSideways(e.target)) return;
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

    /* Past the stop starts the clock; coming back off it stops the clock.
     *
     * Only set when there is no timer already, or every move event inside the band would
     * push the deadline out and a thumb that trembles would never get there. */
    if (drag.at >= PAST) {
      if (!holdTimer && !armed) holdTimer = setTimeout(offerAbout, HOLD);
    } else {
      withdrawAbout();
    }
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
    /* Let go while it is offered and that is the answer, whatever the rail was doing.
     *
     * Before the distance and speed test below, because those would read a rail held
     * hard against its stop as plainly open and leave it open behind the new screen. The
     * rail goes away: it was the gesture, not the destination. */
    /* Let go while it is offered and the offer stands, rather than being taken.
     *
     * This used to navigate on release, which made the bubble an announcement of something
     * already decided rather than a thing you could choose. Two problems with that, and the
     * second is the one that showed up on a phone.
     *
     * It cannot be pressed, because pressing needs a finger and the finger is what is
     * holding the gesture open. So an arrow appears saying About, and tapping it does
     * nothing, because by the time you can tap it the moment it belonged to is gone.
     *
     * And it depends on the pointer surviving. A thumb held still for a second near the
     * left edge is exactly what a browser cancels when it decides the gesture was a scroll
     * or an edge swipe after all, and a cancelled pointer never reaches here.
     *
     * So letting go leaves the bubble up, and pressing it is what opens the page. It takes
     * itself away after OFFERED if nobody does.
     */
    if (armed) {
      dragEndedAt = e.timeStamp;
      // The rail stays where the gesture put it: open, with the offer beside it. Shutting
      // it here would take the thing being offered off the screen along with the offer.
      setRail(false);
      letAboutFade();
      return;
    }

    const speed = e.timeStamp - drag.t > STILL ? 0 : drag.v;
    const shut = Math.abs(speed) >= FLICK ? speed < 0 : drag.at < -drag.travel / 2;
    if (drag.moved) dragEndedAt = e.timeStamp;
    setRail(shut);
  }, { passive: true });

  document.addEventListener("pointercancel", (e) => {
    if (!drag) return;
    /* A cancelled gesture no longer throws the offer away.
     *
     * This is most likely why the arrow did nothing on a phone. The offer is made by
     * holding a thumb still, near the left edge, for a second: which is also precisely
     * what a browser decides was an edge swipe or a scroll after all, and it takes the
     * pointer back by sending pointercancel. The bubble would appear, the buzz would land,
     * and then the whole thing would be quietly undone with the thumb still on the glass.
     *
     * The offer has already been made by then, and it is a button now rather than
     * something only a clean release could take, so it survives and simply times out like
     * any other. What the cancel still does is put the rail back, below. */
    letAboutFade();
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
    /* Except the one thing whose whole purpose is to be clicked just after a drag.
     *
     * This listener is on the document in the capture phase, so it runs before anything
     * it is suppressing, including the bubble's own handler. Crossing the screen back to
     * the left edge takes longer than AFTER_DRAG most of the time, which is worse than it
     * failing outright: it would work, and then now and again not. */
    if (bubble && bubble.contains(e.target)) return;
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

  /* Starting one from the rail. Delegated, because refreshRailPlaylists rewrites this
   * element's contents every time anything about a playlist changes. */
  const railPlaylists = J.$("#railPlaylists");
  if (railPlaylists) {
    railPlaylists.addEventListener("click", async (e) => {
      if (!e.target.closest('[data-act="new-playlist"]')) return;
      const said = await J.sheet({
        title: "A new playlist",
        sub: "It starts empty. Add songs and renders to it from their own menus.",
        confirm: "Make it",
        body: `<label class="sheet-label">Name
                 <input class="field" name="title" maxlength="120" placeholder="Late takes">
               </label>`,
      });
      const title = said && (said.title || "").trim();
      if (!title) return;
      const made = await J.try(() => J.post("/api/playlists", { title }));
      if (!made) return;
      J.emit("playlists:changed");
      location.hash = `#/playlist/${made.playlist.id}`;
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

  /* A message from a sign in that has just come back from Google.
   *
   * The return handler on the server has no song and no screen to go back to, so it
   * lands on the library with one word on the query. Read and cleared here rather than
   * in the upload view, because that view is a screen of one song and this arrives
   * without one.
   */
  const landed = new URLSearchParams((location.hash.split("?")[1] || "")).get("connect");
  if (landed) {
    J.toast(landed === "connected" ? "That account is connected." : landed,
            landed === "connected" ? "" : "bad");
    // Replace rather than assign, so Back does not walk into the message again.
    history.replaceState(history.state, "", location.pathname + "#/");
  }

  J.emit("boot");
  J.router.start();

  // Only when this copy changed under them. On a first visit it writes the version down
  // and says nothing at all.
  J.devlog.check(state);

  // A quiet check on startup. Nothing interrupts: it puts a small "Update ready" in the
  // top bar, which is a link to the screen the button is on, and says nothing otherwise.
  if (J.state.modules.includes("updater") && state.settings.auto_update !== false) {
    setTimeout(async () => {
      try {
        const info = await J.get("/api/update/check");
        if (info.update_available) {
          const ready = J.$("#updateReady");
          if (ready) {
            ready.hidden = false;
            // What the update actually is, from the remote commit's own subject line,
            // rather than the bare fact that one exists. There is no version number in
            // this payload: the check compares commits, so the message is the only thing
            // in it that means anything to a person.
            if (info.message) ready.title = info.message;
          }
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
