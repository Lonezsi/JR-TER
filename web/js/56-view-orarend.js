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
              entry.whose === "me" ? "" : "tt-friend-name"}">${
              J.esc(entry.whose === "me" ? "Saját" : entry.whose)}</b></div>
          </div>
          ${entry.skip ? `<p class="tt-sheet-note">Erre az előadásra nem járok, ezért csak
            egy csík jelöli. Az idősáv így nem látszik szabadnak.</p>` : ""}`,
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
      return `
        <div class="tt-day" role="group" aria-label="${name}">
          ${mine.map((entry) => card(
            entry, !entry.skip && skips.some((s) => clash(s, entry)))).join("")}
          ${theirs.map(stripe).join("")}
        </div>`;
    }).join("");

    const whose = [...new Set(CLASSES.filter((e) => e.whose !== "me")
                                     .map((e) => e.whose))];

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
        ${whose.length ? `<span><i class="tt-key tt-key-friend"></i>${
          J.esc(whose.join(", "))} órája</span>` : ""}
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
