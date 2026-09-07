/* The words, as cards you move between.
 *
 * Markdown, and the first line is the name. That is the whole naming scheme, so there is
 * no Rename button: change the heading and the card is called something else. Nothing
 * asks you to name a thing before writing it.
 *
 * The cards sit in the middle of the page and slide. Drag one and it follows your hand,
 * let go past a third of the way and it goes to the next. Arrows do the same thing for a
 * mouse, and the keyboard arrows for neither.
 *
 * History is for looking. Choosing an entry shows those words and says nothing has
 * changed; restoring is a separate press.
 */
"use strict";

J.blockLyrics = async function (block, ctx) {
  let sheets = [];
  let at = 0;
  let editing = false;
  let history = null;
  let viewing = null;
  let madeHere = null;      // a sheet this editor created, still empty and still unkept

  /* Back gets you out of the words without keeping them.
   *
   * An entry is pushed when the editor opens, carrying the URL it already had. The
   * router runs off hashchange alone, and the hash does not move, so nothing re-renders
   * and the popstate that comes back belongs to this panel and nothing else. What the
   * entry buys is one Back press that lands here instead of on the last screen.
   *
   * window.history, spelled out every time. The `history` two lines up is the list of
   * revisions and it shadows the browser's own for the whole of this function, so a bare
   * history.pushState in here is a call on null.
   */
  const BACK_STOP = "lyric-edit";
  let backCaught = false;   // an entry of ours is on the stack for Back to land on
  let ourOwnPop = false;    // the pop we asked for, not the one the person pressed

  function catchBack() {
    if (backCaught) return;
    backCaught = true;
    window.history.pushState({ stop: BACK_STOP }, "");
  }

  /* Give the entry back when the editor closes any other way, or the next Back press
   * closes an editor that is not open and does nothing anybody can see.
   *
   * Only from a panel that is still on the page and still standing on its own entry.
   * Clicking a link while writing saves and navigates in one gesture, and a blind back()
   * from the screen you have just arrived at would carry you straight to the one you
   * left. The pop is asynchronous, so the handler is told this one is ours.
   */
  function letBackGo() {
    if (!backCaught) return;
    backCaught = false;
    const now = window.history.state;
    if (!block.isConnected || !now || now.stop !== BACK_STOP) return;
    /* And not while a press on a link out of this document is still held.
     *
     * The check above was enough while every link in the app was a hash: those re-render
     * the view, the panel comes off the page, and isConnected is already false by the
     * time this runs. A real navigation leaves the document standing until the new one
     * commits, so that guard passes, and the back() queued here executes after the link
     * has begun navigating and cancels it. Clicking Terms and privacy while writing did
     * nothing at all, twice out of two.
     *
     * Nothing is needed instead. Leaving the document abandons the entry, exactly as the
     * guard above does, and it is a duplicate of the URL the editor was opened on, so
     * Back from the page you arrived at lands on the song you left. */
    if (J.pressIsLeaving()) return;
    ourOwnPop = true;
    window.history.back();
  }

  async function load(keepIndex) {
    const data = await J.get(`/api/songs/${ctx.songId}/lyrics`);
    sheets = data.lyrics || [];
    if (!keepIndex) {
      const currentIndex = sheets.findIndex((s) => s.is_current);
      at = currentIndex >= 0 ? currentIndex : 0;
    }
    at = J.clamp(at, 0, Math.max(0, sheets.length - 1));
    draw();
  }

  const sheet = () => sheets[at];

  /* Where the cursor lands when you click into the words.
   *
   * Clicking a line of a lyric and having the cursor appear at the end of the whole
   * sheet is the difference between editing and retyping. The reading view is rendered
   * markdown, so a click carries a caret position in the *rendered* text, not in the
   * source. Rather than map between the two, the caret is placed by the character offset
   * of the click within the rendered body, which for lyrics is close enough to exact:
   * the markdown a person writes here is lines of words, and the rendered body has the
   * same lines in the same order.
   */
  let landAt = null;

  /* Where in the written text a click on the drawn text landed.
   *
   * Two steps, because the drawing and the writing are not the same string. Which block
   * was clicked gives the line exactly, from the number the renderer put on it. Where in
   * the line comes from the browser own caret hit test, and is only trusted when the
   * block drew the line unchanged: a bullet, a heading or anything emphasised has fewer
   * characters on screen than in the text, and a count taken from the drawing would put
   * the cursor in the wrong place. Those land at the start of the line they belong to,
   * which is somewhere a person can see and carry on from.
   */
  function offsetOfClick(bodyNode, event) {
    if (!bodyNode || !event) return null;
    const source = sheet() ? sheet().text : "";
    if (!source) return null;

    const point = document.caretPositionFromPoint
      ? document.caretPositionFromPoint(event.clientX, event.clientY)
      : (document.caretRangeFromPoint
          ? document.caretRangeFromPoint(event.clientX, event.clientY) : null);
    const node = point ? (point.offsetNode || point.startContainer) : null;
    const into = point ? (point.offset === undefined ? point.startOffset : point.offset) : 0;

    // The block that was clicked, whether the hit test found the text inside it or the
    // click landed on the block itself, past the end of a short line.
    let from = node && bodyNode.contains(node) ? node : event.target;
    if (from && from.nodeType === 3) from = from.parentElement;
    const holder = from && from.closest ? from.closest("[data-l]") : null;
    if (!holder || !bodyNode.contains(holder)) return null;

    const line = Number(holder.dataset.l);
    const body = J.mdBodyStart(source);
    const lines = source.slice(body).split("\n");
    if (!Number.isInteger(line) || line < 0 || line >= lines.length) return null;

    let at = body;
    for (let i = 0; i < line; i++) at += lines[i].length + 1;
    if (holder.textContent !== lines[line]) return at;   // drawn differently: line start

    // Drawn as written, so the offset the hit test gave is the offset in the line, once
    // everything drawn before it inside this block is counted.
    if (!node || !holder.contains(node)) return at;
    const walker = document.createTreeWalker(holder, NodeFilter.SHOW_TEXT);
    let before = 0;
    let seen = null;
    while ((seen = walker.nextNode())) {
      if (seen === node) return at + before + into;
      before += seen.textContent.length;
    }
    return at;
  }

  function focusInto(box) {
    box.focus();
    if (landAt === null) {
      // Nothing was clicked, so the end is the only sensible place: a new set of words
      // is empty and an existing one is being carried on with.
      box.setSelectionRange(box.value.length, box.value.length);
    } else {
      const at = J.clamp(landAt, 0, box.value.length);
      box.setSelectionRange(at, at);
    }
    landAt = null;
    // Show the caret rather than the top of a long sheet.
    const before = box.value.slice(0, box.selectionStart);
    const line = Math.max(0, before.split(/\r?\n/).length - 6);
    box.scrollTop = line * parseFloat(getComputedStyle(box).lineHeight || 28);
  }

  /* The box is as tall as the words, so there is no inner scrollbar and no sense of
   * writing into a window laid over the page. */
  function grow(box) {
    box.style.height = "auto";
    box.style.height = Math.max(220, box.scrollHeight) + "px";
  }

  function draw() {
    const s = sheet();
    const many = sheets.length > 1;

    block.innerHTML = `
      <div class="block-head">
        <h2>Lyrics</h2>
        <span class="grow"></span>
        <span class="block-tools">
          ${s ? `<button class="btn ghost sm" data-act="history">History${
            s.revisions > 1 ? ` (${s.revisions})` : ""}</button>` : ""}
          <button class="btn ghost sm" data-act="add">${s ? "Add a version" : "Write lyrics"}</button>
        </span>
      </div>

      ${viewing ? `
        <div class="time-bar">
          <span>Looking at the words from <b>${J.date(viewing.created_at)}</b>. Nothing has changed.</span>
          <span class="grow"></span>
          <button class="btn sm" data-act="restore">Restore these</button>
          <button class="btn ghost sm" data-act="back">Back to now</button>
        </div>` : ""}

      <div class="lyric-deck">
        ${many ? `<button class="deck-arrow" data-act="prev" aria-label="Previous"
                    ${at === 0 ? "disabled" : ""}>
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor"
               stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
        </button>` : ""}

        <div class="deck-window" id="deckWindow">
          <div class="deck-track" id="deckTrack"></div>
        </div>

        ${many ? `<button class="deck-arrow" data-act="next" aria-label="Next"
                    ${at >= sheets.length - 1 ? "disabled" : ""}>
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor"
               stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg>
        </button>` : ""}
      </div>

      ${many ? `<div class="deck-dots">${sheets.map((sh, i) =>
        `<button class="deck-dot ${i === at ? "on" : ""}" data-go="${i}"
                 title="${J.esc(sh.name)}" aria-label="${J.esc(sh.name)}"></button>`).join("")}</div>` : ""}

      ${history ? `
        <div class="history-rail">
          ${history.map((r, i) => `
            <div class="history-entry ${viewing ? (viewing.id === r.id ? "on" : "") : (i === 0 ? "on" : "")}"
                 data-rev="${r.id}">
              <span class="when">${J.date(r.created_at)}</span>
              <span class="grow"></span>
              <span class="size">${r.length} characters</span>
              ${i === 0 ? '<span class="size">now</span>' : ""}
            </div>`).join("")}
        </div>` : ""}`;

    drawCards();
  }

  function drawCards() {
    const track = J.$("#deckTrack", block);
    if (!track) return;

    if (!sheets.length) {
      track.style.transform = "translate3d(0,0,0)";
      track.innerHTML = `<article class="lyric-card on"><div class="card-body empty-words"
        data-act="edit">Click here and write. The first line becomes the title, and a
        song can hold several sets of words at once so a rewrite never overwrites the
        one you had.</div></article>`;
      return;
    }

    if (editing) {
      const s = sheet();
      track.style.transform = "translate3d(0,0,0)";
      /* No frame around the writing, and no buttons under it.
       *
       * The card was one thing to read and a different thing to write in: a bordered
       * box appeared inside it with Save and Cancel beneath. Writing words is the main
       * act on this page and it should feel like writing on the page, so the textarea
       * carries no border, no background of its own and the same type as the reading
       * view. Clicking away saves. There is no Cancel because there is History, which
       * keeps every revision and can put any of them back, and a Cancel button that
       * silently discards is a worse version of that. */
      track.innerHTML = `<article class="lyric-card on editing">
        <textarea class="card-edit" id="lyricText" spellcheck="true"
          placeholder="Name it on the first line&#10;&#10;Then the words."
          aria-label="The words">${J.esc(s.text)}</textarea>
        <div class="card-foot">
          <span class="faint" id="lyricCount"></span>
          <span class="grow"></span>
          <span class="faint edit-hint">click away to keep it, Esc or Back to leave it</span>
        </div>
      </article>`;
      const box = J.$("#lyricText", block);
      const count = J.$("#lyricCount", block);
      const tally = () => {
        const lines = box.value ? box.value.split("\n").length : 0;
        count.textContent = `Markdown &middot; ${lines} line${lines === 1 ? "" : "s"}`
          .replace("&middot;", "·");
      };
      box.addEventListener("input", () => { tally(); grow(box); });
      box.addEventListener("keydown", (e) => {
        // Straight to save, not through blur. The blur handler now has to work out
        // whether a blur was somebody leaving or the window going away, and the one
        // gesture that says keep this out loud should not be asking that question.
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); save(); }
        /* Escape leaves the words as they were, which is what Back does.
         *
         * It used to blur the box, which saved, on the grounds that History keeps every
         * revision so nothing is really lost. That is only true of what reached the
         * server, and it made this the one place in the app where Escape means yes: it
         * closes the menu, it closes the sheet, it puts the song title back and it
         * clears the search box. One key cannot mean throw this away everywhere and keep
         * it here. */
        if (e.key === "Escape") { e.preventDefault(); cancel(); }
      });
      /* Clicking away is what saves.
       *
       * A blur fires for anything that takes focus, including the History button and the
       * arrows, so this is the one path out and every way of leaving goes through it.
       *
       * Except the browser's own Back button, which is the thing this all exists for.
       * Pressing it hands focus to the toolbar, the toolbar is not the page, and the box
       * blurs. The save landed a moment before the popstate arrived to throw it away, so
       * Back looked like it did nothing. A blur that leaves the whole page unfocused is
       * nobody clicking away from anything, so the editor stays open and waits.
       *
       * Asked of the document rather than of the event: relatedTarget is null both when
       * the window goes and when focus lands on something that cannot hold it, and
       * clicking the empty part of the card is one of the ordinary ways to leave. */
      box.addEventListener("blur", () => {
        if (!editing) return;
        if (!document.hasFocus()) return;
        save();
      });
      tally();
      grow(box);
      focusInto(box);
      return;
    }

    track.innerHTML = sheets.map((s, i) => {
      const text = (viewing && i === at) ? viewing.text : s.text;
      const title = J.mdTitle(text, s.name);
      const body = J.mdBody(text);
      /* A slab around every card, and the card is only its front face.
       *
       * The two have to be different elements and the reason is measurable: an element
       * with a backdrop-filter flattens its children, whatever its transform-style says.
       * Measured, because the computed value lies about it: a child at translateZ(200)
       * under perspective 600 projects to 150 pixels inside a plain preserve-3d parent
       * and to 100 inside one carrying a backdrop-filter, which is what flat means. The
       * card is the glass and cannot hold the sides; the slab holds the sides and cannot
       * be glass.
       */
      return `<div class="lyric-slab ${i === at ? "on" : ""}" data-slab="${i}">
      <span class="slab-edge slab-left" aria-hidden="true"></span>
      <span class="slab-edge slab-right" aria-hidden="true"></span>
      <article class="lyric-card ${i === at ? "on" : ""} ${viewing && i === at ? "reading" : ""}"
               data-sheet="${s.id}">
        <h3 class="card-title">${J.esc(title)}</h3>
        <div class="card-body ${text ? "" : "empty-words"}"
             ${viewing ? "" : 'data-act="edit" title="Click to edit"'}>${
          text ? J.md(body) : "Nothing written yet. Click here to start."}</div>
        <span class="card-foot-tools">
          ${partChip(s)}
          ${sheets.length > 1 ? `
            <button class="icon-btn card-drop" data-act="drop"
                    title="Delete these words" aria-label="Delete ${J.esc(title)}">
              <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor"
                   stroke-width="1.9" stroke-linecap="round">
                <path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13"/>
              </svg>
            </button>` : ""}
        </span>
      </article>
      </div>`;
    }).join("");
    place(false);
  }

  /* Which section of the arrangement these words belong to.
   *
   * Only offered when the compositor has actually laid the song out. Before that there
   * are no sections to point at, and a control that can only say "none" is noise. */
  function partChip(sheet) {
    if (!J.arrange || !J.arrange.state.parts.length) return "";
    const part = J.arrange.partForSheet(sheet.id);
    return `<button class="card-part ${part ? "set" : ""}" data-part-for="${sheet.id}"
              style="--hue:${part ? part.hue : 140}"
              title="Which section of the arrangement these words are for">
              <span class="dot"></span>${part ? J.esc(part.name) : "no section"}
            </button>`;
  }

  /* Light up the card whose section is sounding. Driven by the compositor's playhead
   * rather than by a timer here, so the two can never disagree. */
  function sounding(partId) {
    const sheetId = partId ? J.arrange.state.lyrics[partId] : null;
    J.$$(".lyric-card", block).forEach((card) => {
      card.classList.toggle("sounding", !!sheetId && card.dataset.sheet === String(sheetId));
    });
  }

  /* Where the front card sits while a thumb is on it.
   *
   * Three rotations rather than a slide, and each one is doing a different job.
   *
   * rotateZ is the tilt, and it is the part that reads as a physical card being pushed:
   * a hand moving a card sideways on a table pivots it, because the push and the friction
   * are not at the same point. Small, a degree per thirty pixels.
   *
   * rotateY is what makes the thickness visible at all. A card tilted in its own plane is
   * still a flat shape; turning it a little about the vertical axis brings one of its side
   * walls into view, and the side walls are the whole reason the slab exists.
   *
   * translateZ lifts it off the ones behind, so the stack opens as the front card leaves
   * rather than the front card sliding out of a flat pile.
   */
  const tilt = (dx, width) => {
    const share = J.clamp(dx / (width || 1), -1, 1);
    return `translate3d(${dx.toFixed(1)}px, ${Math.abs(share * 14).toFixed(1)}px, 40px)`
      + ` rotateZ(${(share * 9).toFixed(2)}deg)`
      + ` rotateY(${(-share * 16).toFixed(2)}deg)`;
  };

  /* And where it goes when it is let go past the threshold: onward, off the frame, still
   * turning. 130 per cent clears the window at any width. */
  const flung = (onward) =>
    `translate3d(${onward * 130}%, 24px, 60px) rotateZ(${onward * 14}deg)`
    + ` rotateY(${-onward * 24}deg)`;

  /* Hand the front card back to the stylesheet.
   *
   * There is nothing to position any more. The deck was a row translated by one card
   * width per step, and the maths was the index; it is a stack now, and where each card
   * belongs is a rule keyed off which one carries .on. All this does is drop whatever
   * the finger left on the front card, and decide whether it springs back or snaps.
   */
  function place(animate) {
    const slab = J.$(".lyric-slab.on", block);
    if (!slab) return;
    slab.classList.toggle("nudging", !animate);
    slab.style.transform = "";
    if (!animate) {
      // Read the layout back, so the browser has the untransformed position as the
      // starting point of the next animation rather than folding the two together.
      void slab.offsetWidth;
      slab.classList.remove("nudging");
    }
  }

  function go(index, animate) {
    const to = J.clamp(index, 0, sheets.length - 1);
    if (to === at) { place(true); return; }
    at = to;
    viewing = null;
    place(animate !== false);
    // The chrome around the deck changes with the card, but only after it has landed,
    // so the redraw never interrupts the slide.
    setTimeout(() => { if (block.isConnected) draw(); }, 320);
  }

  /* Dragging. The track follows the pointer and settles either back or onward.
   *
   * Bound to the block, not to the window inside it. draw() rewrites block.innerHTML, so
   * #deckWindow is a different element after every redraw and anything held on the old
   * one goes in the bin with it. Changing card schedules exactly that redraw, which is
   * why swiping used to work once and then never again: the arrows, the dots and the
   * keyboard kept working because they are delegated here, and only the drag was not. */
  function wireDrag() {
    let startX = 0, startY = 0, dragging = false, decided = false, width = 1;
    let win = null, slab = null;

    block.addEventListener("pointerdown", (e) => {
      if (editing || sheets.length < 2) return;
      if (e.target.closest("a, button, textarea")) return;
      // Resolved per gesture, because the element that was there last time is gone.
      win = e.target.closest("#deckWindow");
      slab = win && J.$(".lyric-slab.on", block);
      if (!win || !slab) { win = slab = null; return; }
      dragging = true; decided = false;
      startX = e.clientX; startY = e.clientY;
      width = win.getBoundingClientRect().width || 1;
    });

    block.addEventListener("pointermove", (e) => {
      if (!dragging || !slab) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (!decided) {
        // Let a vertical drag scroll the page instead of swiping the card.
        if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 8) { dragging = false; return; }
        if (Math.abs(dx) < 6) return;
        decided = true;
        slab.classList.add("nudging");
        try { win.setPointerCapture(e.pointerId); } catch (err) { /* gone already */ }
      }
      // Resist at the ends, so the deck feels like it has edges.
      const edge = (at === 0 && dx > 0) || (at === sheets.length - 1 && dx < 0);
      const shift = edge ? dx * 0.32 : dx;
      slab.style.transform = tilt(shift, width);
    });

    const release = (e) => {
      if (!dragging) return;
      dragging = false;
      const held = win, card = slab;
      win = slab = null;
      if (!decided) return;
      try { held.releasePointerCapture(e.pointerId); } catch (err) { /* already */ }
      const dx = e.clientX - startX;
      const far = Math.abs(dx) > width * 0.24;
      const onward = dx < 0 ? 1 : -1;
      const stays = (at + onward) < 0 || (at + onward) > sheets.length - 1;

      if (!far || stays) { place(true); return; }

      /* Thrown, not stepped.
       *
       * The card carries on the way it was going and leaves the frame, and only then does
       * the index move. Changing it here instead would redraw the deck under a card that
       * is still mid air, which is the jump cut this gesture is meant to replace. */
      card.classList.remove("nudging");
      card.style.transform = flung(onward);

      /* Waited out rather than listened for.
       *
       * transitionend would be the obvious thing and it is the wrong thing twice over. It
       * bubbles, so any transition on anything inside the card fires it, and the card is
       * full of things with transitions. And it would be a listener on an element that
       * drawCards is about to throw away, which is the rule this panel already learned
       * the hard way: the swipe used to be bound to the deck window and stopped working
       * after the first redraw.
       *
       * The duration is read off the element rather than written here, so it cannot drift
       * from the stylesheet, and reduced motion collapsing it to nothing collapses this
       * with it. */
      const spent = getComputedStyle(card).transitionDuration.split(",")[0];
      const ms = Math.max(0, (parseFloat(spent) || 0) * (/ms/.test(spent) ? 1 : 1000));
      setTimeout(() => go(at + onward), ms + 30);
    };
    block.addEventListener("pointerup", release);
    block.addEventListener("pointercancel", release);
  }

  /* Leaving the words is what keeps them.
   *
   * Called from the blur, which every way out goes through, so it must be quiet: a toast
   * on every click away from a lyric would be a toast every few seconds. It says
   * something only when there was nothing to say, which is when a save failed. */
  async function save() {
    const box = J.$("#lyricText", block);
    if (!box) return;
    editing = false;
    const text = box.value;
    const unchanged = text === (sheet() ? sheet().text : "");
    if (!unchanged) {
      const result = await J.try(() => J.put(`/api/lyrics/${sheet().id}/text`, { text }));
      // Still editing, and still holding the entry it was given: a save that failed has
      // more to lose than one that never started, so its way out stays where it is.
      if (!result) { editing = true; drawCards(); return; }
    }
    madeHere = null;
    letBackGo();
    history = null;
    await load(true);
  }

  /* Leaving the words without keeping them.
   *
   * Nothing is written and nothing has to be put back. The box was filled from
   * sheets[at].text and never writes into it, so drawing the reading view again shows
   * the words the server still has.
   *
   * editing goes down before any markup changes. The redraw takes the textarea out of
   * the page while it holds the caret, and a removed textarea fires blur on the way out
   * in some browsers, which would run save() and keep the very thing that was cancelled.
   * With the flag already down that blur finds nothing to do, which is what the guard on
   * the blur handler has always been for.
   */
  async function cancel() {
    if (!editing) return;
    const box = J.$("#lyricText", block);
    const typed = box ? box.value : "";
    const lost = !!box && typed !== (sheet() ? sheet().text : "");
    editing = false;
    letBackGo();
    landAt = null;

    /* Clicking into a song with no words writes an empty sheet before the editor opens,
     * so cancelling out of that one would leave a nameless empty card behind that the
     * card itself has no delete button for. Undoing the creation is not the same act as
     * throwing away words somebody wrote: nothing was ever kept, and the sheet existed
     * only to hold what was just abandoned. Anything actually typed is a save, not this.
     */
    const born = madeHere;
    madeHere = null;
    if (born && !typed.trim()) {
      await J.try(() => J.del(`/api/lyrics/${born}`));
      await load();
      return;
    }

    drawCards();
    // Only when there was something to lose. A cancel that discards nothing is just a
    // Back press, and a toast on every Back press is the noise this app does not make.
    if (lost) J.toast("Left as it was.");
  }

  block.addEventListener("click", async (e) => {
    const dot = e.target.closest("[data-go]");
    if (dot) { go(Number(dot.dataset.go)); return; }

    const entry = e.target.closest("[data-rev]");
    if (entry) {
      const id = Number(entry.dataset.rev);
      if (history && history[0] && history[0].id === id) { viewing = null; draw(); return; }
      const data = await J.try(() => J.get(`/api/lyric-revisions/${id}`));
      if (!data) return;
      viewing = data.revision;
      draw();
      return;
    }

    const act = e.target.closest("[data-act]");
    if (!act) return;
    const what = act.dataset.act;
    const s = sheet();

    if (what === "prev") go(at - 1);
    if (what === "next") go(at + 1);
    if (what === "edit") {
      viewing = null;
      // Where in the words the click landed, worked out before the reading view is
      // replaced by the box, because afterwards there is nothing left to measure.
      landAt = offsetOfClick(act.closest(".card-body") || act, e);
      /* A song with no words yet has nothing to edit, so clicking makes one and opens
       * it in the same gesture. Before, the empty card told you to click and then asked
       * you to press Write lyrics instead. */
      if (!sheets.length) {
        const made = await J.try(() => J.post(`/api/songs/${ctx.songId}/lyrics`, { text: "" }));
        if (!made) return;
        await load();
        at = sheets.length - 1;
        // Remembered so that backing out of it takes the empty sheet with it. See cancel.
        madeHere = sheets.length ? sheets[at].id : null;
      }
      editing = true;
      catchBack();
      drawCards();
    }
    if (what === "back") { viewing = null; draw(); }

    if (what === "history") {
      if (history) { history = null; viewing = null; draw(); return; }
      const data = await J.try(() => J.get(`/api/lyrics/${s.id}/history`));
      if (!data) return;
      history = data.revisions || [];
      draw();
    }

    if (what === "restore") {
      const result = await J.try(() => J.post(`/api/lyrics/${s.id}/restore`,
                                              { revision_id: viewing.id }));
      if (!result) return;
      J.toast(result.saved ? "Restored" : result.message);
      viewing = null; history = null;
      await load(true);
    }

    if (what === "add") {
      const made = await J.try(() => J.post(`/api/songs/${ctx.songId}/lyrics`, {}));
      if (!made) return;
      await load();
      const index = sheets.findIndex((sh) => sh.id === made.sheet.id);
      at = index < 0 ? sheets.length - 1 : index;
      viewing = null; history = null; editing = true;
      madeHere = made.sheet.id;
      catchBack();
      draw();
    }

    if (what === "drop") {
      // The button lives on a card now, so the card decides what is deleted rather than
      // whichever one happened to be showing when the header was pressed.
      const card = act.closest("[data-sheet]");
      const target = card ? sheets.find((sh) => String(sh.id) === card.dataset.sheet) : s;
      if (!target) return;
      const sure = await J.confirm(`Delete “${target.name}”?`, "Its history goes too.",
                                   "Delete it");
      if (!sure) return;
      await J.try(() => J.del(`/api/lyrics/${target.id}`), "Deleted");
      at = Math.max(0, at - 1);
      history = null; viewing = null;
      await load(true);
    }
  });

  /* Assigning a section to a set of words. */
  block.addEventListener("click", async (e) => {
    const chip = e.target.closest("[data-part-for]");
    if (!chip) return;
    e.stopPropagation();
    const sheetId = Number(chip.dataset.partFor);
    const parts = J.arrange.state.parts;
    const already = J.arrange.partForSheet(sheetId);

    const chosen = await J.sheet({
      title: "Which section are these words for?",
      sub: "The card lights up when that section plays, so you can see the words land.",
      confirm: "",
      cancel: "Close",
      body: `<div class="pick-list">
        ${parts.map((part) => `
          <button class="pick-row" data-choose="${part.id}">
            <span class="pick-plus" style="background:hsl(${part.hue} 45% 45%)">&#9679;</span>
            <span class="grow truncate">
              <span class="t truncate">${J.esc(part.name)}</span>
              <span class="s">${part.beats} beats</span>
            </span>
            ${already && already.id === part.id ? '<span class="pick-go">chosen</span>' : ""}
          </button>`).join("")}
        ${already ? `<button class="pick-row" data-choose="">
          <span class="grow"><span class="t">No section</span>
          <span class="s">Unlink these words</span></span></button>` : ""}
      </div>`,
      onMount(sheet, close) {
        sheet.addEventListener("click", (event) => {
          const hit = event.target.closest("[data-choose]");
          if (hit) close({ part: hit.dataset.choose });
        });
      },
    });
    if (!chosen) return;
    J.arrange.setLyricsFor(sheetId, chosen.part || null);
    drawCards();
  });

  /* Right clicking a set of words. */
  J.menu.on(block, ".lyric-card", (card) => {
    const sheet = sheets.find((sh) => String(sh.id) === card.dataset.sheet);
    if (!sheet) return null;
    const linked = J.arrange && J.arrange.partForSheet ? J.arrange.partForSheet(sheet.id) : null;
    return [
      { label: "Edit", icon: "edit", hint: "Click",
        run: () => card.querySelector('[data-act="edit"]')?.click() },
      { label: sheet.is_current ? "This is the current one" : "Make this the current one",
        icon: "star", disabled: !!sheet.is_current,
        run: async () => {
          await J.try(() => J.post(`/api/lyrics/${sheet.id}/current`), "Made current");
          await load(true);
        } },
      { label: `History${sheet.revisions > 1 ? ` (${sheet.revisions})` : ""}`, icon: "open",
        disabled: !(sheet.revisions > 1),
        run: () => J.$('[data-act="history"]', block)?.click() },
      { divider: true },
      { label: "Copy the words", icon: "copy",
        run: async () => {
          try { await navigator.clipboard.writeText(sheet.text || ""); J.toast("Copied."); }
          catch (e) { J.toast("The browser would not let go of the clipboard.", "bad"); }
        } },
      (J.arrange && J.arrange.state.parts.length) ? {
        label: linked ? `Section: ${linked.name}` : "Point at a section", icon: "tag",
        run: () => card.querySelector("[data-part-for]")?.click(),
      } : null,
      { divider: true },
      { label: "Delete these words", icon: "drop", danger: true,
        disabled: sheets.length < 2,
        run: () => card.querySelector('[data-act="drop"]')?.click() },
    ];
  });

  /* The compositor says which section is sounding; the matching card lights up. */
  const onPlaying = (e) => {
    if (!block.isConnected) { J.bus.removeEventListener("arrange:playing", onPlaying); return; }
    sounding(e.detail && e.detail.partId);
  };
  J.on("arrange:playing", onPlaying);
  J.on("arrange:change", () => { if (block.isConnected) drawCards(); });

  const onKey = (e) => {
    if (!block.isConnected) { document.removeEventListener("keydown", onKey); return; }
    if (editing || sheets.length < 2) return;
    if (e.target.closest("input, textarea, select")) return;
    if (e.key === "ArrowLeft") go(at - 1);
    if (e.key === "ArrowRight") go(at + 1);
  };
  document.addEventListener("keydown", onKey);

  /* Back, whether it came from the browser button, the phone gesture or the swipe.
   *
   * Order in here is load bearing. ourOwnPop is read and cleared first, because a pop we
   * asked for must never be mistaken for the person's. backCaught is cleared before
   * cancel() runs, so cancel's own letBackGo finds nothing to give back: the press that
   * brought us here already took it. Two quick Backs then close the editor and leave the
   * page, which is what a modal does.
   */
  const onPop = () => {
    if (!block.isConnected) { window.removeEventListener("popstate", onPop); return; }
    if (ourOwnPop) { ourOwnPop = false; return; }
    if (!backCaught) return;
    backCaught = false;          // it went with the press that brought us here
    if (editing) cancel();
  };
  window.addEventListener("popstate", onPop);

  /* The one thing the focus test gives away.
   *
   * From in here, pressing the browser's Back button and switching to another window
   * look the same, so neither saves any more. Coming back to a window finds the words
   * still in the box, which is fine. A tab that is closed and an app that is swiped away
   * never come back, and that is the moment there is nothing left to cancel with.
   */
  const onHide = () => {
    if (!block.isConnected) { document.removeEventListener("visibilitychange", onHide); return; }
    if (editing && document.visibilityState === "hidden") save();
  };
  document.addEventListener("visibilitychange", onHide);

  await load();
  wireDrag();
};
