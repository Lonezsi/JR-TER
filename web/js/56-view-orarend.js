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
    const KIND_SAID = { ea: "Előadás", gy: "Gyakorlat", both: "Előadás és gyakorlat" };
    const KIND_TAG = { ea: "Ea", gy: "Gy", both: "Ea+Gy" };

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

    const top = (entry) => (minutes(entry.at) - FROM * 60) / 60 * HOUR;
    const tall = (entry) => (minutes(entry.to) - minutes(entry.at)) / 60 * HOUR;
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

    function card(entry, inset) {
      if (entry.skip) {
        // A strip, so the hour does not read as free, with nothing in it to read. Words
        // here would say "you have this", which is the opposite of what it means.
        return `<button class="tt-card tt-skip" data-at="${entry.key}" type="button"
                        style="top:${top(entry)}px;height:${tall(entry)}px"
                        aria-label="${J.esc(entry.name)}, nem látogatott"></button>`;
      }
      return `
        <button class="tt-card tt-${entry.kind}" data-at="${entry.key}" type="button"
                style="top:${top(entry)}px;height:${tall(entry)}px${
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
                      style="top:${top(entry)}px;height:${tall(entry)}px;--lane:${
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
      const mine = CLASSES.filter((e) => e.day === day && e.whose === "me");
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

      <!-- The grid scrolls sideways on a phone, and the page does not. Without a
           container of its own the grid's minimum width makes the whole document slide,
           rail and player included. -->
      <div class="tt-scroll">
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
    grid.style.setProperty("--tt-hour", HOUR + "px");

    grid.addEventListener("click", (e) => {
      const hit = e.target.closest("[data-at]");
      if (!hit) return;
      const entry = CLASSES[Number(hit.dataset.at)];
      if (entry) detail(entry);
    });
  },
};
