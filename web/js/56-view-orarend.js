/* The week, as a grid.
 *
 * WHY THE POSITIONS ARE WORKED OUT AND NOT WRITTEN DOWN. The sketch this came from put
 * every class at a top and a height in pixels, which works exactly once. Change the hour
 * height, the hour the day starts at, or the day a class moves to, and every number is
 * wrong with no way to tell which. Here a class says when it is and the layout follows.
 *
 * WHY THERE IS ONE ADDED COLOUR AND NOT FIVE. The sketch used five: indigo for practicals,
 * slate for lectures, a lighter blue for one lecture that should have been slate by its own
 * legend, pink for the friend, and a dashed grey for the one that is not attended. This app
 * has one accent and it follows whatever is playing, so a category built on it would change
 * colour when a song changed.
 *
 * So the categories are told apart by what they are rather than by hue. A lecture and a
 * practical are the same material with the kind written on them, which is legible in a way
 * indigo-versus-slate is not, and it leaves exactly one colour to mean "not mine". That
 * colour is fixed and is deliberately not the accent: it is a fact about the class, not
 * about the room it is drawn in.
 *
 * THE WEEK IS NOT IN THE SOURCE. It comes from /api/orarend, which reads a file in the
 * account's own directory. That file names a second person and her hours, and this
 * repository is public.
 */
"use strict";

J.views.orarend = {
  title: "Órarend",

  async render(root) {
    const DAYS = ["Hétfő", "Kedd", "Szerda", "Csütörtök", "Péntek"];
    /* A konzultáció is neither a lecture nor a practical, and a band is neither a kind of
     * class nor a thing with a tag on it: it is the reason an afternoon is not free. Both
     * are named here so the sheet can say what it opened rather than showing the raw word
     * out of the file. */
    const KIND_SAID = {
      ea: "Előadás", gy: "Gyakorlat", both: "Előadás és gyakorlat",
      konz: "Konzultáció", band: "Elfoglaltság",
    };
    const KIND_TAG = { ea: "Ea", gy: "Gy", both: "Ea+Gy", konz: "Konz" };

    const data = await J.get("/api/orarend");
    const FROM = data.from;
    const TO = data.to;
    const HOUR = data.hour;
    const CLASSES = data.classes || [];

    /* Minutes past midnight. The one place a written time becomes a number, so a wrong
     * one is wrong here and nowhere else. */
    function minutes(clock) {
      const parts = String(clock).split(":").map(Number);
      return parts[0] * 60 + (parts[1] || 0);
    }

    /* Where a class sits and how long it runs, in hours from the top of the grid.
     *
     * Hours rather than pixels. How tall an hour is depends on how wide a day column came
     * out, which is not known here and changes when the window does, so a pixel written
     * into a card now is a pixel that disagrees with the hour lines later. The stylesheet
     * multiplies these by --tt-hour, so there is one number to change and nothing to keep
     * in step with it. */
    const at = (entry) => (minutes(entry.at) - FROM * 60) / 60;
    const runs = (entry) => (minutes(entry.to) - minutes(entry.at)) / 60;
    const clash = (a, b) =>
      minutes(a.at) < minutes(b.to) && minutes(b.at) < minutes(a.to);

    /* Which lane a stripe sits in.
     *
     * There are hours where two of her classes run at once, and the sketch handled that
     * with a hand written class on the two it happened to know about. Worked out here
     * instead: a stripe takes the first lane no overlapping stripe is already using, so a
     * third clashing class finds a third lane rather than hiding underneath the second.
     *
     * First free rather than next, or a clash that has ended would leave a stripe's width
     * of nothing to the left of everything after it.
     */
    function lanes(entries) {
      const placed = [];
      for (const entry of entries) {
        const taken = placed.filter((other) => clash(entry, other)).map((o) => o.lane);
        let lane = 0;
        while (taken.indexOf(lane) !== -1) lane += 1;
        entry.lane = lane;
        placed.push(entry);
      }
      return entries;
    }

    /* A stretch of the day that is spoken for, drawn behind everything.
     *
     * Work is not a class and putting it in as one was the obvious thing that does not
     * work: eight hours of Monday as a card is a card on top of every lecture that
     * morning, and only one of the two can be seen. It is not competing with them for the
     * column, it is the reason the column is not free, so it goes behind: the width of the
     * whole day, under the cards, tinted rather than drawn.
     *
     * Behind the stripes too. A friend's hour beside eight hours of work is still the one
     * question the stripes answer, and a band that covered them would hide it. */
    function band(entry) {
      return `<button class="tt-band" data-at="${entry.key}" type="button"
                      style="--at:${at(entry)};--for:${runs(entry)}"
                      aria-label="${J.esc(entry.name)}, ${entry.at}–${entry.to}"
              ><span class="tt-band-said">${J.esc(entry.name)}</span></button>`;
    }

    function card(entry, inset) {
      if (entry.skip) {
        // A strip, so the hour does not read as free, with nothing in it to read. Words
        // here would say "you have this", which is the opposite of what it means.
        return `<button class="tt-card tt-skip" data-at="${entry.key}" type="button"
                        style="--at:${at(entry)};--for:${runs(entry)}"
                        aria-label="${J.esc(entry.name)}, nem látogatott"></button>`;
      }
      return `
        <button class="tt-card tt-${entry.kind}" data-at="${entry.key}" type="button"
                style="--at:${at(entry)};--for:${runs(entry)}${
                  inset ? ";left:calc(var(--tt-skip-w) + var(--s2))" : ""}">
          <span class="tt-when">${entry.at}–${entry.to}<i class="tt-tag">${
            KIND_TAG[entry.kind] || ""}</i></span>
          <span class="tt-name">${J.esc(entry.name)}</span>
          <span class="tt-where">${J.esc(entry.where)}</span>
        </button>`;
    }

    function stripe(entry) {
      return `<button class="tt-stripe" data-at="${entry.key}" type="button"
                      data-who="${whoIndex(entry.whose)}"
                      style="--at:${at(entry)};--for:${runs(entry)};--lane:${
                        entry.lane}"
                      aria-label="${J.esc(entry.whose)}: ${J.esc(entry.name)}, ${
                        entry.at}–${entry.to}"></button>`;
    }

    /* The details, in this app's own sheet rather than a <dialog> of its own.
     *
     * Foyer used a bare <dialog> because it had nothing else. Here there is a sheet that
     * every other screen opens, and a second kind of modal on one page is a second set of
     * rules for Escape, for the backdrop and for where focus goes. */
    /* One subject's notes, drawn into the sheet a class opens.
     *
     * Kept out of the sheet's own resolve value on purpose. J.sheet hands back the fields
     * inside it when it is confirmed, which suits a form; this is not one. Everything here
     * saves as it is pressed, because a note you typed and lost because you closed the
     * wrong way is worse than no note.
     */
    async function notebook(sheet, entry) {
      const box = sheet.querySelector("[data-notes]");
      if (!box) return;
      const subject = entry.name;
      const where = "/api/orarend/notes?subject=" + encodeURIComponent(subject);

      let state = null;
      let at = 0;              // which page is open
      let saving = null;       // the timer that writes the page being typed

      function ticks() {
        /* Three boxes, and the count is the number of them ticked.
         *
         * Ticking the second ticks the first: they are one number shown as three boxes,
         * not three independent facts, and "absent on the second occasion but not the
         * first" is not a thing anybody means. Pressing the one that is already the last
         * ticked unticks it, so a miscount is one press to fix. */
        return `<div class="tt-miss" role="group" aria-label="Hiányzások">
          ${Array.from({ length: state.allowed }, (_, i) => `
            <button type="button" class="tt-miss-box${i < state.absences ? " on" : ""}"
                    data-miss="${i + 1}"
                    aria-pressed="${i < state.absences}"
                    aria-label="${i + 1}. hiányzás">${
              i < state.absences ? J.menu.icon("check", 14) : ""}</button>`).join("")}
          <span class="tt-miss-said">${state.absences} / ${state.allowed} hiányzás</span>
        </div>`;
      }

      function pager() {
        if (!state.pages.length) {
          return `<p class="faint tt-pages-none">Nincs még jegyzet.</p>`;
        }
        const page = state.pages[at];
        return `
          <div class="tt-pages-bar">
            <button type="button" class="icon-btn" data-page="-1" aria-label="Előző oldal"
                    ${at === 0 ? "disabled" : ""}>&lsaquo;</button>
            <span class="tt-pages-at">${at + 1} / ${state.pages.length}</span>
            <button type="button" class="icon-btn" data-page="1" aria-label="Következő oldal"
                    ${at >= state.pages.length - 1 ? "disabled" : ""}>&rsaquo;</button>
            <span class="grow"></span>
            <button type="button" class="btn sm ghost" data-drop-page="${page.id}">
              Oldal törlése</button>
          </div>
          <textarea class="field tt-page" data-page-id="${page.id}" rows="9"
                    placeholder="Markdown. Amit ide írsz, mentődik."
                    >${J.esc(page.text)}</textarea>
          <div class="tt-page-read" data-preview>${
            page.text.trim() ? J.md(page.text) : ""}</div>`;
      }

      function draw() {
        box.innerHTML = `
          ${ticks()}
          <div class="tt-pages">
            <div class="tt-pages-head">
              <span>Jegyzetek</span>
              <span class="grow"></span>
              <button type="button" class="btn sm" data-add-page>Új oldal</button>
            </div>
            ${pager()}
          </div>`;
      }

      async function send(method, path, body) {
        const got = await J.try(() => J[method](path, body));
        if (!got) return;
        state = got;
        if (at >= state.pages.length) at = Math.max(0, state.pages.length - 1);
        draw();
      }

      state = await J.try(() => J.get(where));
      if (!state) return;
      draw();

      box.addEventListener("click", (e) => {
        const miss = e.target.closest("[data-miss]");
        if (miss) {
          const n = Number(miss.dataset.miss);
          // Pressing the last ticked box unticks it, so the row is its own undo.
          const want = n === state.absences ? n - 1 : n;
          return send("put", "/api/orarend/notes", { subject, absences: want });
        }
        if (e.target.closest("[data-add-page]")) {
          at = state.pages.length;
          return send("post", "/api/orarend/notes/pages", { subject, text: "" });
        }
        const drop = e.target.closest("[data-drop-page]");
        if (drop) {
          return send("del", `/api/orarend/notes/pages/${drop.dataset.dropPage}`);
        }
        const turn = e.target.closest("[data-page]");
        if (turn) {
          at = J.clamp(at + Number(turn.dataset.page), 0, state.pages.length - 1);
          draw();
        }
      });

      /* Typing saves itself, a moment after the typing stops.
       *
       * Not on every keystroke, which is a write per character, and not only on close,
       * because the sheet can be dismissed with Escape, with the backdrop, or by the phone
       * going away, and none of those are a decision to throw the page out. The preview
       * follows the same beat rather than every keystroke: re-rendering markdown under the
       * caret on every letter is what makes a text box feel slow.
       */
      box.addEventListener("input", (e) => {
        const field = e.target.closest("[data-page-id]");
        if (!field) return;
        clearTimeout(saving);
        saving = setTimeout(() => {
          const preview = box.querySelector("[data-preview]");
          if (preview) preview.innerHTML = field.value.trim() ? J.md(field.value) : "";
          const page = state.pages.find((x) => String(x.id) === field.dataset.pageId);
          if (page) page.text = field.value;
          J.try(() => J.put(`/api/orarend/notes/pages/${field.dataset.pageId}`,
                            { text: field.value }));
        }, 600);
      });
    }

    function detail(entry) {
      J.sheet({
        title: entry.name,
        sub: `${DAYS[entry.day]} ${entry.at}–${entry.to}`,
        confirm: "",
        cancel: "Bezárás",
        body: `
          <div class="tt-facts">
            <div class="tt-fact"><span>Helyszín</span><b>${J.esc(entry.where)}</b></div>
            <div class="tt-fact"><span>Típus</span><b>${
              J.esc(KIND_SAID[entry.kind] || entry.kind)}</b></div>
            <div class="tt-fact"><span>Kinek</span><b class="${
              entry.whose === "me" ? "" : "tt-friend-name"}" data-who="${
              entry.whose === "me" ? "" : whoIndex(entry.whose)}">${
              J.esc(entry.whose === "me" ? "Saját" : entry.whose)}</b></div>
          </div>
          ${entry.skip ? `<p class="tt-sheet-note">Erre az előadásra nem járok, ezért csak
            egy csík jelöli. Az idősáv így nem látszik szabadnak.</p>` : ""}
          <div class="tt-notes" data-notes></div>`,
        onMount(sheet) { notebook(sheet, entry); },
      });
    }

    if (data.missing || data.broken || !CLASSES.length) {
      /* Two different nothings, said differently.
       *
       * A file that is not there is every account that has never written one, and the
       * answer is how to make one. A file that will not parse is one somebody has just
       * edited, and the answer is which character stopped it. Telling them apart costs a
       * line and saves the second person looking for a file that is right in front of
       * them. */
      root.innerHTML = `
        <div class="section">
          <div class="section-head"><h2>Órarend</h2></div>
          <div class="empty">
            <h3>${data.broken ? "Ez az órarend nem olvasható"
                              : "Nincs még órarend"}</h3>
            <p>${data.broken
              ? `A fájl ott van, de nem értelmezhető: ${J.esc(data.broken)}`
              : `Tedd a heti órákat a könyvtárad <code>${
                  J.esc(data.where || "orarend.json")}</code> fájljába, és frissítsd ezt
                 az oldalt.`}</p>
          </div>
        </div>`;
      return;
    }

    CLASSES.forEach((entry, i) => { entry.key = String(i); });

    /* Everybody on this timetable who is not me, numbered.
     *
     * Sorted rather than in the order they happen to appear, so a person keeps the same
     * colour when a class is added, moved or dropped. A colour that changes because
     * somebody's Monday was cancelled is worse than no colour.
     *
     * The number is all this decides. Which colour it means is in the stylesheet, with
     * every other colour on the page.
     */
    const people = [...new Set(CLASSES.filter((e) => e.whose !== "me")
                                      .map((e) => e.whose))].sort();
    const whoIndex = (name) => Math.max(0, people.indexOf(name));

    const hours = [];
    // Up to but not including TO: the label "21:00" is the row from 21:00 to 22:00, so a
    // label for 22:00 would be an hour of grid after the day has ended.
    for (let h = FROM; h < TO; h++) {
      hours.push(`<div class="tt-hour">${String(h).padStart(2, "0")}:00</div>`);
    }

    const days = DAYS.map((name, day) => {
      const own = CLASSES.filter((e) => e.day === day && e.whose === "me");
      const bands = own.filter((e) => e.kind === "band");
      const mine = own.filter((e) => e.kind !== "band");
      const skips = mine.filter((e) => e.skip);
      const theirs = lanes(CLASSES.filter((e) => e.day === day && e.whose !== "me"));
      /* How many stripe lanes this day actually uses.
       *
       * The card reserves room down its right for them, and a fixed reserve meant every
       * day gave up the same third of a phone column whether anybody else had a class that
       * day or not. Only the view knows, because only the view has run lanes(). */
      const used = theirs.length
        ? Math.max(...theirs.map((e) => e.lane)) + 1 : 0;
      return `
        <div class="tt-day" role="group" aria-label="${name}" style="--tt-lanes:${used}">
          ${bands.map(band).join("")}
          ${mine.map((entry) => card(
            entry, !entry.skip && skips.some((s) => clash(s, entry)))).join("")}
          ${theirs.map(stripe).join("")}
        </div>`;
    }).join("");

    root.innerHTML = `
      <div class="section">
        <div class="section-head"><h2>Órarend</h2></div>
        <p class="faint" style="margin-top:0">
          A hét, ahogy van. Kattints bármelyikre a részletekért.
        </p>

      <!-- The table is laid out at its full width whatever the screen is, and this is
           what it gets zoomed down into. Nothing scrolls. -->
      <div class="tt-fit" id="ttFit">
        <div class="tt-grid pane" id="ttGrid">
          <div class="tt-corner"></div>
          ${DAYS.map((name) => `<div class="tt-head">${name}</div>`).join("")}
          <div class="tt-hours">${hours.join("")}</div>
          ${days}
        </div>
      </div>

      <div class="tt-legend">
        <span><i class="tt-key tt-key-ea"></i>Előadás</span>
        <span><i class="tt-key tt-key-gy"></i>Gyakorlat</span>
        <span><i class="tt-key tt-key-skip"></i>Nem látogatott</span>
        ${people.map((name, i) => `<span><i class="tt-key tt-key-friend"
          data-who="${i}"></i>${J.esc(name)} órája</span>`).join("")}
      </div>
      </div>`;

    /* The scale of the grid, told to the stylesheet.
     *
     * Every top and height above is worked out from HOUR, and the hour rows and the
     * repeating hour lines are drawn in CSS. Two numbers meaning the same thing is how a
     * 09:00 class ends up drawn beside 10:00 and still looks like a timetable, so there is
     * one and the stylesheet reads it off the grid. It comes from the server with the
     * week, so even that one number is decided in a single place. */
    const grid = J.$("#ttGrid");

    /* Zoom the whole table down until it fits, and reserve the room it ends up taking.
     *
     * This is what leaving width=device-width out of a page does, done to one element: the
     * table is laid out at its desktop width whatever the screen is, and the result is
     * scaled. Every proportion is the one a desktop gets, which is the point; narrowing
     * the columns instead reflows the words and changes the shape, and that has been the
     * wrong answer twice.
     *
     * A transform does not change the box a parent reserves, so the frame's height has to
     * be written on by hand. Without it a third height table sits in a full height hole.
     *
     * Never above 1: a screen with room for the whole thing gets it at its own size, so a
     * desktop is untouched and nothing is ever blown up.
     */
    /* How tall an hour is, as a share of how wide a day is.
     *
     * A quarter. The table used to be 60px an hour against a 160px column, which is nearly
     * four tenths, and fourteen hours of that is a table taller than it is wide: on a phone
     * it had to shrink a long way to fit and the answer to being too tall was more
     * shrinking. A quarter keeps the same week in two thirds of the height, so what gives
     * when there is less room is the size of the type and not the shape of the day.
     *
     * Measured off the real column rather than written down, so the shape holds whatever
     * width the days came out at. */
    const HOUR_OF_DAY = 1 / 4;

    const frame = J.$("#ttFit");
    let told = { hour: null, fit: null, height: null };
    /* Set once the closer look below exists. A refit changes how much room there
     * is, so a week that was panned to its right hand edge has to be caught up;
     * the first fit happens before any of that is declared, which is why this is a
     * hook and not a call. */
    let settle = null;


    /* EVERY MEASUREMENT BEFORE EVERY CHANGE, and both of them once.
     *
     * Reading a width after writing a style makes the browser lay the page out there and
     * then, in the middle of this function, because the answer it is about to give depends
     * on what was just written. Three reads with two writes between them is three layouts
     * of a grid of forty five cards, on a resize that sends one of these a frame: it ran
     * at twenty frames a second while the rail was opening, which is the one moment this
     * is asked to do anything at all.
     *
     * So: the three numbers this needs are taken together, off one layout, and then the
     * three it writes go out together. The one exception is the height, which cannot be
     * known until the hour is set, and is measured once at the end. */
    function measure() {
      const day = grid.querySelector(".tt-day");
      if (!day) return null;
      const have = frame.clientWidth;
      const wide = grid.offsetWidth;         // laid out, before the scale is applied
      const hour = day.offsetWidth * HOUR_OF_DAY;
      return have && wide ? { have: have, wide: wide, hour: hour } : null;
    }

    function fitToRoom() {
      if (!frame || !grid.isConnected) return;
      const now = measure();
      if (!now) return;

      // Never above one: a screen with room for the whole table gets it at its own size,
      // so a desktop is untouched and nothing is blown up.
      const fit = Math.min(1, now.have / now.wide);
      if (now.hour === told.hour && fit === told.fit) return;

      told.hour = now.hour;
      told.fit = fit;
      grid.style.setProperty("--tt-hour", now.hour.toFixed(2) + "px");
      grid.style.setProperty("--tt-fit", fit);

      /* And the room it ends up taking. A transform does not change the box a parent
       * reserves, so without this a third height table sits in a full height hole.
       *
       * MEASURED, THOUGH IT COULD BE WORKED OUT. The grid's height is a straight line in
       * the hour, so this could be the constant part plus fourteen hours of it, learned
       * once and never read again. It was, briefly. It came to nothing worth having: the
       * cost of this whole function is under a millisecond either way, and the version
       * that does arithmetic is the version that is wrong the day something else changes
       * the height of the header. */
      const height = Math.ceil(grid.offsetHeight * fit) + "px";
      if (height !== told.height) {
        told.height = height;
        frame.style.height = height;
      }
      if (settle) settle();
    }

    /* One fit per frame, however many notifications arrive.
     *
     * A drag sends these faster than the screen redraws, and every one of them past the
     * first in a frame is arithmetic nobody will ever see. */
    let due = 0;
    function fitSoon() {
      if (due) return;
      due = requestAnimationFrame(function () { due = 0; fitToRoom(); });
    }
    fitToRoom();

    /* And again whenever there is a different amount of room: a rotated phone, a resized
     * window, the rail opening or closing beside it. Watching the room rather than the
     * window catches all three with one answer.
     *
     * THE ROOM, AND NOT THE FRAME. The frame is the element this writes a height onto, and
     * an observer watching something it also changes is handed its own writing back as a
     * new notification: the width it cares about never moved, so the extra round decides
     * nothing, and it arrives on every frame of a drag. The room's width is the question
     * being asked, and nothing here ever answers it. */
    const room = frame.parentElement || frame;
    if (window.ResizeObserver) {
      if (J.orarendFit) J.orarendFit.disconnect();
      J.orarendFit = new ResizeObserver(fitSoon);
      J.orarendFit.observe(room);
    } else {
      window.addEventListener("resize", fitSoon);
    }

    /* ── a closer look ──────────────────────────────────────────────────────
     *
     * The week is drawn small on purpose: five days at once is the question it answers,
     * and it answers it at a glance. What it cannot do at that size is be read, so this
     * is the other half: pinch it, or double tap it, and it comes up to a size where the
     * room number is a room number.
     *
     * ON THE GRID AND NOT ON THE PAGE. The browser's own zoom would do this, and take the
     * rail, the player and the top bar up with it, which means finding the week again
     * afterwards. Here the frame stays exactly where it was and the week moves inside it.
     *
     * It is a second factor on the scale that is already there rather than a second
     * transform: how much room there is and how much detail is wanted are two different
     * questions, and multiplying the answers keeps both of them true.
     */
    const CLOSEST = 3.2;             // far enough in for the smallest line on a card
    let zoom = 1;
    let panX = 0;
    let panY = 0;

    /* Never past the edges. Dragging a zoomed week until it is off the side of its own
     * frame leaves an empty box and nothing to say which way to drag back. */
    function hold() {
      const drawn = { x: grid.offsetWidth * told.fit * zoom,
                      y: grid.offsetHeight * told.fit * zoom };
      const room = { x: frame.clientWidth, y: parseFloat(told.height) || 0 };
      panX = Math.min(0, Math.max(room.x - drawn.x, panX));
      panY = Math.min(0, Math.max(room.y - drawn.y, panY));
      // A week smaller than its frame sits at the top left rather than drifting.
      if (drawn.x <= room.x) panX = 0;
      if (drawn.y <= room.y) panY = 0;
    }

    function show() {
      hold();
      grid.style.setProperty("--tt-zoom", zoom);
      grid.style.setProperty("--tt-x", panX.toFixed(1) + "px");
      grid.style.setProperty("--tt-y", panY.toFixed(1) + "px");
      frame.classList.toggle("is-zoomed", zoom > 1);
    }
    settle = show;

    /* Towards a point, so what you pinched is what you end up looking at. */
    function zoomTo(next, at) {
      next = Math.min(CLOSEST, Math.max(1, next));
      if (next === zoom) return;
      const box = frame.getBoundingClientRect();
      const x = at.x - box.left;
      const y = at.y - box.top;
      const by = next / zoom;
      panX = x - (x - panX) * by;
      panY = y - (y - panY) * by;
      zoom = next;
      show();
    }

    const touching = new Map();
    let spread = 0;                  // how far apart two fingers were last time
    let dragging = null;
    let moved = false;               // whether this gesture was a drag rather than a tap

    const middle = () => {
      const [a, b] = [...touching.values()];
      return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    };
    const apart = () => {
      const [a, b] = [...touching.values()];
      return Math.hypot(a.x - b.x, a.y - b.y);
    };

    frame.addEventListener("pointerdown", (e) => {
      touching.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (touching.size === 2) {
        spread = apart();
        dragging = null;             // a pinch that began as a drag is a pinch
      } else if (touching.size === 1 && zoom > 1) {
        dragging = { x: e.clientX, y: e.clientY };
        moved = false;
        frame.setPointerCapture(e.pointerId);
        frame.classList.add("is-held");
      }
    });

    frame.addEventListener("pointermove", (e) => {
      if (!touching.has(e.pointerId)) return;
      touching.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (touching.size === 2 && spread) {
        const now = apart();
        zoomTo(zoom * (now / spread), middle());
        spread = now;
        e.preventDefault();
      } else if (dragging) {
        panX += e.clientX - dragging.x;
        panY += e.clientY - dragging.y;
        dragging = { x: e.clientX, y: e.clientY };
        moved = true;
        show();
        e.preventDefault();
      }
    });

    function letGo(e) {
      touching.delete(e.pointerId);
      if (touching.size < 2) spread = 0;
      if (!touching.size) {
        dragging = null;
        frame.classList.remove("is-held");
      }
    }
    frame.addEventListener("pointerup", letGo);
    frame.addEventListener("pointercancel", letGo);

    /* A tap on a class opens it, so the second way in is a double tap on the week, which
     * is the gesture a map has taught everybody anyway. Out again from wherever it is. */
    frame.addEventListener("dblclick", (e) => {
      if (e.target.closest("[data-at]")) return;   // that tap opened a class already
      zoomTo(zoom > 1 ? 1 : CLOSEST, { x: e.clientX, y: e.clientY });
    });

    /* And the mouse's own version of a pinch, which is the trackpad's too. */
    frame.addEventListener("wheel", (e) => {
      if (!e.ctrlKey && !e.metaKey) return;      // a plain wheel is the page scrolling
      e.preventDefault();
      zoomTo(zoom * (e.deltaY < 0 ? 1.12 : 1 / 1.12), { x: e.clientX, y: e.clientY });
    }, { passive: false });

    grid.addEventListener("click", (e) => {
      // Letting go of a pan is not a tap on whatever happened to be under the finger.
      if (moved) { moved = false; return; }
      const hit = e.target.closest("[data-at]");
      if (!hit) return;
      const entry = CLASSES[Number(hit.dataset.at)];
      if (entry) detail(entry);
    });
  },
};
