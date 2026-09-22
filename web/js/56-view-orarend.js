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
          <span class="tt-where">${[entry.where, entry.teacher, entry.group ?
            "#" + entry.group : ""].filter(Boolean).map(J.esc).join(" · ")}</span>
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

    /* One fact, when there is one. A row reading "Oktató —" is a row that says nothing
     * and takes the height of one that does. */
    const fact = (said, value) => (value
      ? `<div class="tt-fact"><span>${said}</span><b>${J.esc(value)}</b></div>` : "");

    function detail(entry) {
      J.sheet({
        title: entry.name,
        sub: `${DAYS[entry.day]} ${entry.at}–${entry.to}`,
        confirm: "",
        cancel: "Bezárás",
        body: `
          <div class="tt-facts">
            ${fact("Helyszín", entry.where)}
            ${fact("Típus", KIND_SAID[entry.kind] || entry.kind)}
            ${fact("Oktató", entry.teacher)}
            ${fact("Kurzus", entry.group)}
            ${fact("Tárgykód", entry.code)}
            <div class="tt-fact"><span>Kinek</span><b class="${
              entry.whose === "me" ? "" : "tt-friend-name"}" data-who="${
              entry.whose === "me" ? "" : whoIndex(entry.whose)}">${
              J.esc(entry.whose === "me" ? "Saját" : entry.whose)}</b></div>
          </div>
          ${entry.skip ? `<p class="tt-sheet-note">Erre az előadásra nem járok, ezért csak
            egy csík jelöli. Az idősáv így nem látszik szabadnak.</p>` : ""}
          <div class="tt-sheet-tools">
            <button class="btn ghost" data-edit type="button">Szerkesztés</button>
            <button class="btn ghost danger" data-drop type="button">Törlés</button>
          </div>
          <div class="tt-notes" data-notes></div>`,
        onMount(sheet) {
          notebook(sheet, entry);
          sheet.querySelector("[data-edit]").addEventListener("click", () => {
            // Shut first. Two sheets at once is two dialogs arguing about Escape.
            sheet.querySelector('[data-act="cancel"]').click();
            form(entry);
          });
          sheet.querySelector("[data-drop]").addEventListener("click", () => {
            sheet.querySelector('[data-act="cancel"]').click();
            remove(entry);
          });
        },
      });
    }

    /* ── making and changing one ─────────────────────────────────────────────
     *
     * The week was a file and nothing else: to add a class you opened orarend.json in an
     * editor, which is fine at a desk and impossible on the bus, which is where the
     * timetable is actually read. So the page writes it now.
     *
     * THE FILE IS STILL THE THING. This does not import the week into a table and leave
     * the file behind as an export: it edits the file, in place, keeping every key it
     * does not know about. Somebody can still open it in an editor tomorrow, and a
     * semester typed in by hand is not stranded behind a form.
     */
    const NEW = { day: 0, at: "10:00", to: "11:30", kind: "gy", whose: "me",
                  name: "", where: "", teacher: "", group: "", code: "" };

    async function form(entry) {
      const making = !entry;
      const it = entry || NEW;
      const pick = (value, said, now) =>
        `<option value="${value}"${value === now ? " selected" : ""}>${said}</option>`;
      const line = (name, said, value, extra) => `
        <label class="sheet-label">${said}<input class="field" name="${name}"
               value="${J.esc(value || "")}" ${extra || ""}></label>`;

      const values = await J.sheet({
        title: making ? "Új óra" : it.name,
        sub: making ? "" : `${DAYS[it.day]} ${it.at}–${it.to}`,
        confirm: making ? "Hozzáadás" : "Mentés",
        cancel: "Mégse",
        wide: true,
        body: `<div class="sheet-fields">
          ${line("name", "Tárgy", it.name, 'placeholder="Analízis II. Ea" required')}
          <div class="tt-form-row">
            <label class="sheet-label">Nap<select class="field" name="day">${
              DAYS.map((said, i) => pick(String(i), said, String(it.day))).join("")
            }</select></label>
            ${line("at", "Kezdés", it.at, 'type="time" required')}
            ${line("to", "Vége", it.to, 'type="time" required')}
          </div>
          <div class="tt-form-row">
            <label class="sheet-label">Típus<select class="field" name="kind">${
              Object.keys(KIND_SAID).map((k) => pick(k, KIND_SAID[k], it.kind)).join("")
            }</select></label>
            ${line("whose", "Kinek", it.whose || "me", 'list="ttPeople"')}
            <datalist id="ttPeople">${
              ["me"].concat(people).map((n) => `<option value="${J.esc(n)}">`).join("")
            }</datalist>
          </div>
          ${line("where", "Helyszín", it.where, 'placeholder="Déli Tömb 0-821"')}
          ${line("teacher", "Oktató", it.teacher)}
          <div class="tt-form-row">
            ${line("group", "Kurzus", it.group, 'inputmode="numeric"')}
            ${line("code", "Tárgykód", it.code, 'placeholder="IP-18AB1E"')}
          </div>
          <label class="candidate" style="cursor:pointer">
            <input type="checkbox" name="skip"${it.skip ? " checked" : ""}>
            <span class="grow">Nem járok rá</span>
          </label>
        </div>`,
      });
      if (!values) return;

      /* Checked again on the server, and that is the refusal that counts: this one is
       * here so an obvious slip is answered without a round trip. */
      if (!values.name.trim()) { J.toast("A tárgy neve kell."); return form(entry); }
      if (values.to <= values.at) { J.toast("A vége a kezdés előtt van."); return form(entry); }

      const sent = Object.assign({}, values, { day: Number(values.day) });
      const done = await J.try(() => (making
        ? J.post("/api/orarend/classes", sent)
        : J.put("/api/orarend/classes/" + it.key, sent)), making ? "Hozzáadva" : "Mentve");
      if (done !== null) J.router.reload();
    }

    async function remove(entry) {
      const sure = await J.confirm(
        "Törlöd?",
        `${entry.name}, ${DAYS[entry.day]} ${entry.at}–${entry.to}. Ez a hétből is kikerül.`,
        "Törlés");
      if (!sure) return;
      const done = await J.try(() => J.del("/api/orarend/classes/" + entry.key), "Törölve");
      if (done !== null) J.router.reload();
    }

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
          <div class="section-head">
            <h2>Órarend</h2>
            <div class="head-tools">
              <button class="btn primary" id="ttNew" type="button">Új óra</button>
            </div>
          </div>
          <div class="empty">
            <h3>${data.broken ? "Ez az órarend nem olvasható"
                              : "Nincs még órarend"}</h3>
            <p>${data.broken
              ? `A fájl ott van, de nem értelmezhető: ${J.esc(data.broken)}`
              : `Vedd fel az első órát az Új óra gombbal. A hét a könyvtárad <code>${
                  J.esc(data.where || "orarend.json")}</code> fájljában marad, úgyhogy
                 kézzel is szerkesztheted.`}</p>
          </div>
        </div>`;
      const first = J.$("#ttNew");
      if (first) first.addEventListener("click", () => form(null));
      return;
    }

    const hours = [];
    // Up to but not including TO: the label "21:00" is the row from 21:00 to 22:00, so a
    // label for 22:00 would be an hour of grid after the day has ended.
    for (let h = FROM; h < TO; h++) {
      hours.push(`<div class="tt-hour">${String(h).padStart(2, "0")}:00</div>`);
    }

    /* WHOSE WEEK IS BEING LOOKED AT.
     *
     * "Mind" is the week this page was built for: my classes as cards, everybody else's
     * as a stripe down the side of the day. That answers "when are we both free" at a
     * glance, without four people's lectures fighting over one column.
     *
     * It is the wrong shape for the other question, which is "when is Zita free on
     * Wednesday": her hours are a five pixel stripe with nothing written on them. So one
     * person can be picked instead, and then it is their week, drawn the way mine is,
     * with everybody else out of the way.
     *
     * Remembered, because it is set once for an afternoon rather than every time the page
     * is opened.
     */
    const SEEN_KEY = "jriter.orarend.who";
    const CAN_SEE = ["all", "me"].concat(people);
    let seeing = CAN_SEE[0];
    try {
      const said = localStorage.getItem(SEEN_KEY);
      if (said && CAN_SEE.indexOf(said) !== -1) seeing = said;
    } catch (e) { /* a browser with storage switched off still gets a timetable */ }

    function weekOf(who) {
      const everyone = who === "all";
      /* Whose classes are cards. Mine when the whole week is up, theirs when one person
       * is picked: a card is the only shape with room for a room number in it. */
      const front = everyone ? "me" : who;
      return DAYS.map((name, day) => {
        const today = CLASSES.filter((e) => e.day === day);
        const own = today.filter((e) => e.whose === front);
        const bands = own.filter((e) => e.kind === "band");
        const mine = own.filter((e) => e.kind !== "band");
        const skips = mine.filter((e) => e.skip);
        const theirs = everyone ? lanes(today.filter((e) => e.whose !== "me")) : [];
        /* How many stripe lanes this day actually uses.
         *
         * The card reserves room down its right for them, and a fixed reserve meant every
         * day gave up the same third of a phone column whether anybody else had a class
         * that day or not. Only the view knows, because only the view has run lanes(). */
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
    }

    /* The switch, and the legend, which are the same thing.
     *
     * There was a legend under the table saying which colour meant whom. Everything in it
     * was already a person's name beside their colour, which is exactly what a row of
     * radios needs, so it is the row of radios now rather than a second list of the same
     * people under it. */
    const said = (who) => (who === "all" ? "Mind"
      : who === "me" ? "Saját" : who);

    const chooser = CAN_SEE.map((who, i) => `
      <label class="tt-who${who === seeing ? " on" : ""}">
        <input type="radio" name="ttWho" value="${J.esc(who)}"${
          who === seeing ? " checked" : ""}>
        ${who === "all" ? "" : `<i class="tt-key ${
          who === "me" ? "tt-key-gy" : "tt-key-friend"}"${
          who === "me" ? "" : ` data-who="${whoIndex(who)}"`}></i>`}
        <span>${J.esc(said(who))}</span>
      </label>`).join("");

    const days = weekOf(seeing);

    root.innerHTML = `
      <div class="section">
        <div class="section-head">
          <h2>Órarend</h2>
          <div class="head-tools">
            <button class="btn primary" id="ttNew" type="button">Új óra</button>
          </div>
        </div>
        <p class="faint" style="margin-top:0">
          A hét, ahogy van. Kattints bármelyikre a részletekért.
        </p>

      <!-- Whose week. Above the table rather than under it: it decides what the table
           says, so it is read before the table and not after it. -->
      <div class="tt-whose" role="radiogroup" aria-label="Kinek az órarendje">
        ${chooser}
      </div>

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
      </div>
      </div>`;

    /* The scale of the grid, told to the stylesheet.
     *
     * Every top and height above is worked out from HOUR, and the hour rows and the
     * repeating hour lines are drawn in CSS. Two numbers meaning the same thing is how a
     * 09:00 class ends up drawn beside 10:00 and still looks like a timetable, so there is
     * one and the stylesheet reads it off the grid. It comes from the server with the
     * week, so even that one number is decided in a single place. */
    /* Reassigned when the week is redrawn for somebody else, which is why it is not a
     * const: the fitting below measures this element, and after a redraw the element it
     * measured is not on the page any more. */
    let grid = J.$("#ttGrid");

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
     * A sixth. It was 60px an hour against a 160px column, which is nearly four tenths,
     * and fourteen hours of that is a table taller than it is wide: on a phone it had to
     * shrink a long way to fit, and the answer to being too tall was more shrinking.
     * A quarter halved that; a sixth is where the week stops being the tall thing on the
     * screen at all. What gives when there is less room is the height of the rows, and
     * the type stays the size it is, because the page can be zoomed now.
     *
     * Measured off the real column rather than written down, so the shape holds whatever
     * width the days came out at. */
    const HOUR_OF_DAY = 1 / 6;

    const frame = J.$("#ttFit");
    let told = { hour: null, fit: null, height: null };


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

    /* THE WEEK IS NOT ZOOMED BY THIS PAGE ANY MORE.
     *
     * It was: pinch, drag, double tap, a scale of its own on top of the fit. It worked
     * and it was the wrong thing to have built. A phone already knows how to zoom a page,
     * everybody already knows how to ask it to, and a second zoom inside the first is two
     * sets of rules for the same gesture. So the page allows the browser's own, the rail
     * gets out of the way on this screen, and there is nothing here to keep in step with
     * it.
     */
    /* The one way in that is not on the grid itself. Both screens have it, including the
     * one for an account with no week at all, which is where it matters most: that screen
     * used to say "write a file" and now it can be answered where it is read. */
    const opener = J.$("#ttNew");
    if (opener) opener.addEventListener("click", () => form(null));

    /* Switching to somebody else's week.
     *
     * The grid is redrawn rather than hidden and shown: which lane a stripe sits in and
     * how much room a card gives up for stripes are both answers about one particular set
     * of classes, so a rule that showed and hid boxes would leave the survivors laid out
     * for the ones that went.
     *
     * The frame stays, so the click handler below and the observer that refits it are
     * still attached to something that is on the page. */
    root.addEventListener("change", (e) => {
      const chosen = e.target.closest('input[name="ttWho"]');
      if (!chosen) return;
      seeing = chosen.value;
      try { localStorage.setItem(SEEN_KEY, seeing); } catch (err) { /* fine without */ }
      redraw();
    });

    function redraw() {
      J.$$(".tt-who", root).forEach((label) => label.classList.toggle(
        "on", label.querySelector("input").value === seeing));
      frame.innerHTML = `
        <div class="tt-grid pane" id="ttGrid">
          <div class="tt-corner"></div>
          ${DAYS.map((name) => `<div class="tt-head">${name}</div>`).join("")}
          <div class="tt-hours">${hours.join("")}</div>
          ${weekOf(seeing)}
        </div>`;
      grid = J.$("#ttGrid");
      // Every number the fit last worked out was about the grid that has just gone.
      told = { hour: null, fit: null, height: null };
      fitToRoom();
    }

    frame.addEventListener("click", (e) => {
      const hit = e.target.closest("[data-at]");
      if (!hit) return;
      /* Looked up by the name the server gave it, not by where it sits in the array.
       *
       * This was an index while the week was read only, and an index is a fine name for a
       * row in a list that never changes. It is the wrong one now: the server names a
       * class it has written by its id, so a card said data-at="1790086969781" and this
       * asked for the one billion, seven hundred and ninety millionth class of the week
       * and got nothing. Every card on the timetable stopped opening. */
      const entry = CLASSES.find((c) => c.key === hit.dataset.at);
      if (entry) detail(entry);
    });
  },
};
