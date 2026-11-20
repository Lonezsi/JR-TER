/* The compositor panel.
 *
 * One track of clips, laid end to end, every edge on a beat. The moves are the ones the
 * job actually needs:
 *
 *   drag the middle      put this section somewhere else in the order
 *   drag an edge         make it shorter or longer, a beat at a time
 *   double click         duplicate it, which is how a chorus goes round twice
 *   backspace            take it out
 *
 * Nothing snaps to anything but the beat, because a section that starts half a beat late
 * is never what anyone meant. The grid comes from the tempo, the tempo was a guess, and
 * the guess is stated as a guess with halve, double and tap next to it.
 */
"use strict";

J.compositor = (function () {
  //: How wide a beat is on screen at rest. Zooming is one number, so a long song and a
  //: short one both start out readable.
  const BASE_PX_PER_BEAT = 9;

  function mount(root, ctx) {
    const A = J.arrange;
    let zoom = 1;
    let dragging = null;

    const pxPerBeat = () => BASE_PX_PER_BEAT * zoom;

    //: How far the button group stays clear of the edge of the visible strip, so it reads
    //: as sitting on a block rather than jammed against the side of the box.
    const EDGE = 6;

    //: The band at each end of the strip where holding a block pans it, and how fast.
    //:
    //: Forty is about a thumb's width, so the band is reachable without being somewhere you
    //: land by accident, and the speed rises across it: resting at the inside edge creeps
    //: and pressing to the outside edge runs. Nine hundred pixels a second at full tilt
    //: crosses a long arrangement in about a second and is still slow enough to stop where
    //: you meant to.
    //:
    //: Pixels per second, not per frame: the loop multiplies by the time that actually
    //: passed. PAN_CAP is how much time one frame is allowed to claim, so a tab coming back
    //: from the background pans a frame's worth instead of leaping to the end.
    const PAN_BAND = 40;
    const PAN_MOST = 900;
    const PAN_CAP = 48;
    const PAN_EVERY = 16;

    //: The narrowest the bar's thumb is allowed to get.
    //:
    //: Its width is the share of the strip that is on screen, and on a long arrangement at
    //: full zoom that share is a few per cent: honest, and too small to hit. Forty four is
    //: the usual floor for something a thumb has to land on.
    const THUMB_LEAST = 44;

    function draw() {
      const parts = A.state.parts;
      const clips = A.state.clips;
      const total = A.totalBeats();
      const bars = A.state.perBar;

      root.innerHTML = `
        <div class="comp-head">
          <div class="comp-tempo">
            <button class="btn sm ghost" data-act="half" title="Half the tempo">&divide;2</button>
            <label class="comp-bpm">
              <input class="field" id="compBpm" type="number" min="20" max="400" step="0.1"
                     value="${Math.round(A.state.bpm * 10) / 10}" aria-label="Beats per minute">
              <span>bpm</span>
            </label>
            <button class="btn sm ghost" data-act="double" title="Double the tempo">&times;2</button>
            <button class="btn sm ghost" data-act="tap" title="Tap four beats">Tap</button>
            ${A.state.clips.length && A.state.confidence > 0 && A.state.confidence < 0.45
              ? `<span class="tag warn" title="The beat was hard to hear in this render. Check the tempo, and try halve or double.">unsure</span>`
              : ""}
          </div>

          <label class="comp-onoff" title="${A.state.clips.length
            ? "Play this song through the arrangement instead of straight through"
            : "Lay the song out first"}">
            <button class="switch ${A.state.enabled ? "on" : ""}" data-act="onoff"
                    aria-label="Play this song as arranged"
                    ${A.state.clips.length ? "" : "disabled"}></button>
            <span>Play as arranged</span>
          </label>

          <span class="grow"></span>
          <div class="comp-zoom">
            <button class="icon-btn sm" data-act="out" aria-label="Zoom out">${J.minus(15)}</button>
            <button class="icon-btn sm" data-act="in" aria-label="Zoom in">${J.plus(15)}</button>
          </div>
          <button class="btn sm ghost" data-act="redetect" title="Guess the tempo and sections again">
            Detect again
          </button>
        </div>

        ${clips.length ? `
          <div class="comp-scroll" tabindex="0">
            <div class="comp-track" style="width:${Math.max(200, total * pxPerBeat())}px">
              <div class="comp-bars"></div>
              <div class="comp-clips">${clips.map(clipHtml).join("")}</div>
              <div class="comp-playhead" hidden></div>
              <!-- Duplicate and remove, on whichever block is chosen.
                   A sibling of the clips rather than a child of one, for two reasons: a
                   clip has overflow hidden so the waveform stops at its edges, and a
                   fourteen pixel clip has no room to put two buttons inside. Out here it
                   can sit on the corner and hang over the edge. -->
              <div class="comp-tools" hidden>
                <button class="comp-tool" data-act="dup-sel" title="Duplicate this section"
                        aria-label="Duplicate this section">
                  <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
                    <rect x="9" y="9" width="11" height="11" rx="2" stroke="currentColor"
                          stroke-width="1.8" fill="none"/>
                    <path d="M5 15V5h10" stroke="currentColor" stroke-width="1.8" fill="none"
                          stroke-linecap="round"/>
                  </svg>
                </button>
                <button class="comp-tool danger" data-act="del-sel"
                        title="Take this section out" aria-label="Take this section out">
                  <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
                    <path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13" stroke="currentColor"
                          stroke-width="1.8" fill="none" stroke-linecap="round"/>
                  </svg>
                </button>
              </div>
            </div>
          </div>
          <!-- The way along a long arrangement, as a real control.
               A native scrollbar is not one on a phone: it reserves no space, it is drawn
               as an overlay if it is drawn at all, and on iOS it cannot be dragged. This
               is a div, so a finger reaches it the same way it reaches everything else. -->
          <div class="comp-bar" hidden>
            <div class="comp-bar-thumb"></div>
          </div>
          <div class="comp-foot">
            <span class="faint">${clips.length} part${clips.length === 1 ? "" : "s"}
              &middot; ${Math.round(total / bars)} bars
              &middot; ${J.time(A.duration())}</span>
            <span class="grow"></span>
            <span class="faint comp-hint">drag to move &middot; edges to trim &middot;
              tap to choose</span>
          </div>`
        : `<div class="empty comp-empty">
             <h3>Nothing laid out yet</h3>
             <p>JR!TER can listen to this render, work out the tempo and split it into
                sections. Everything it decides can be changed afterwards.</p>
             <button class="btn primary" data-act="redetect" style="margin-top:var(--s4)">
               Listen and lay it out
             </button>
           </div>`}`;

      drawBars();
      clips.forEach((clip) => paintClip(clip.id));
      const scroll = J.$(".comp-scroll", root);
      if (scroll) scroll.scrollLeft = scrollLeft;

      /* A rebuild used to lose which block was chosen, because the outline lives in a
       * class on a node that has just been replaced. The choice is state, so it survives
       * the thing that was drawing it. */
      if (selected && !A.state.clips.some((c) => c.id === selected)) selected = null;
      markSelected();
      syncBar();
    }

    let scrollLeft = 0;

    function clipHtml(clip) {
      const part = A.state.parts.find((p) => p.id === clip.part);
      const hue = part ? part.hue : 210;
      return `
        <div class="comp-clip" data-clip="${clip.id}"
             style="--w:${clip.beats * pxPerBeat()}px; --hue:${hue}">
          <span class="comp-grip start" data-edge="start" title="Trim the start"></span>
          <canvas class="comp-wave"></canvas>
          <span class="comp-name">${J.esc(part ? part.name : "clip")}</span>
          <span class="comp-beats">${clip.beats}</span>
          <span class="comp-grip end" data-edge="end" title="Trim the end"></span>
        </div>`;
    }

    /* The bar lines behind the clips. Drawn rather than a repeating gradient so the
     * first line of every fourth bar can be stronger, which is what makes eight bars
     * countable at a glance. */
    function drawBars() {
      const holder = J.$(".comp-bars", root);
      if (!holder) return;
      const per = A.state.perBar;
      const beat = pxPerBeat();
      holder.style.backgroundImage = [
        `repeating-linear-gradient(to right, var(--line) 0 1px, transparent 1px ${beat * per}px)`,
        `repeating-linear-gradient(to right, var(--line-2) 0 1px, transparent 1px ${beat * per * 4}px)`,
      ].join(",");
      holder.style.backgroundSize = `${beat * per}px 100%, ${beat * per * 4}px 100%`;
    }

    /* Each clip draws the stretch of the render it actually uses, so trimming one shows
     * you what you kept rather than a picture that never changes. */
    function paintClip(clipId) {
      const clip = A.state.clips.find((c) => c.id === clipId);
      const node = J.$(`[data-clip="${clipId}"] .comp-wave`, root);
      if (!clip || !node) return;
      const whole = A.sourceSeconds();
      if (!whole) return;                 // nothing decoded yet, so nothing to draw
      const beat = A.beatSeconds();
      J.wave.draw(node, A.peaks(), {
        from: (A.state.offset + clip.from * beat) / whole,
        to: (A.state.offset + (clip.from + clip.beats) * beat) / whole,
        color: "rgba(255,255,255,0.42)",
      });
    }

    /* Where the bar's thumb is, and how wide.
     *
     * Both are the same two ratios a scrollbar has always been: how much of the strip is
     * on screen, and how far along it you are. Read from the scroller rather than worked
     * out from beats and zoom, so there is one source of truth and no way for the bar to
     * disagree with what it is a picture of.
     */
    function syncBar() {
      const bar = J.$(".comp-bar", root);
      const scroll = J.$(".comp-scroll", root);
      if (!bar || !scroll) return;
      const thumb = J.$(".comp-bar-thumb", bar);
      const over = scroll.scrollWidth - scroll.clientWidth;
      // Nothing to pan, nothing to pan with. A full width thumb that cannot move is a
      // control that lies about being one.
      bar.hidden = over <= 1;
      if (bar.hidden || !thumb) return;

      const width = bar.clientWidth;
      const share = scroll.clientWidth / scroll.scrollWidth;
      const wide = Math.max(THUMB_LEAST, Math.round(width * share));
      thumb.style.width = `${wide}px`;
      thumb.style.transform =
        `translate3d(${Math.round((scroll.scrollLeft / over) * (width - wide))}px, 0, 0)`;
    }

    /* Dragging it, and tapping the track to jump.
     *
     * Bound once to the panel rather than to the thumb, because draw() replaces both of
     * them: the same reason every other handler in here is delegated.
     */
    root.addEventListener("pointerdown", (e) => {
      const bar = e.target.closest(".comp-bar");
      if (!bar) return;
      const scroll = J.$(".comp-scroll", root);
      const thumb = J.$(".comp-bar-thumb", bar);
      if (!scroll || !thumb) return;

      const over = scroll.scrollWidth - scroll.clientWidth;
      const width = bar.clientWidth;
      const wide = thumb.getBoundingClientRect().width;
      const room = width - wide;
      if (room <= 0 || over <= 0) return;

      const box = bar.getBoundingClientRect();
      const onThumb = e.target.closest(".comp-bar-thumb");
      // Grabbing the thumb keeps the point you grabbed it by; tapping the track puts the
      // middle of the thumb under the finger, which is what makes a tap read as "go here".
      const held = onThumb ? e.clientX - thumb.getBoundingClientRect().left : wide / 2;

      const to = (x) => {
        const at = J.clamp(x - box.left - held, 0, room);
        scroll.scrollLeft = (at / room) * over;
      };
      to(e.clientX);
      bar.classList.add("holding");
      try { bar.setPointerCapture(e.pointerId); } catch (err) { /* not captured */ }

      const move = (event) => to(event.clientX);
      const done = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", done);
        window.removeEventListener("pointercancel", done);
        const still = J.$(".comp-bar", root);
        if (still) still.classList.remove("holding");
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", done);
      window.addEventListener("pointercancel", done);
    });

    /* Put the clip nodes in the order the state says, without building any.
     *
     * The live reorder during a drag used to call draw(), which rewrites the panel's whole
     * innerHTML. That destroys the very node the finger is holding, on the frame it
     * crosses a boundary: the pointer capture goes with it, every canvas in the track is
     * thrown away and repainted, and the block you were dragging blinks. Moving the
     * existing nodes keeps all of it, and appendChild on a node already in the parent is a
     * move rather than a copy, so this is the reorder and nothing else. */
    function reorderNodes() {
      const holder = J.$(".comp-clips", root);
      if (!holder) return;
      for (const clip of A.state.clips) {
        const node = J.$(`[data-clip="${clip.id}"]`, holder);
        if (node) holder.appendChild(node);
      }
    }

    /* Where a pointer is along the strip, whatever the scroll is doing.
     *
     * Measured against the row of blocks rather than the scrolling box, because that row's
     * own rectangle already moves with the scroll: this is the same number before and
     * after a pan, which is what makes it safe to compare with offsetLeft.
     *
     * The old version added the scroller's scrollLeft on top of that, which would have
     * been double counting. It read `track.parentElement.scrollLeft`, and the row's parent
     * is .comp-track, which does not scroll, so it was adding nought and the sum happened
     * to be right.
     */
    function pointerOnStrip(clientX) {
      const row = J.$(".comp-clips", root);
      return row ? clientX - row.getBoundingClientRect().left : 0;
    }

    /* Which way the block in hand should move, if either, decided against its neighbours.
     *
     * One step at a time and nothing else. The block already follows the finger, so it has
     * a visual centre; the only question is whether that centre has gone past the centre
     * of the block on one side or the other.
     *
     * This is what stops the flicker. It used to walk every block's width to find which
     * half of which slot the pointer was in, and those widths are the layout that includes
     * the block being dragged: committing a move changed the boundaries that had just
     * decided it, so the same position mapped back and it swapped again on the next event.
     * Measured at five order changes across one boundary. Deciding it against the
     * neighbours cannot do that, because after a swap the neighbour is on the other side
     * and further away than the centre that just passed it.
     */
    function reorderAround(clipId) {
      const node = J.$(`[data-clip="${clipId}"]`, root);
      if (!node) return;
      const mine = node.getBoundingClientRect();
      const centre = mine.left + mine.width / 2;

      const middleOf = (sibling) => {
        if (!sibling || !sibling.classList.contains("comp-clip")) return null;
        const box = sibling.getBoundingClientRect();
        return box.left + box.width / 2;
      };
      const after = middleOf(node.nextElementSibling);
      const before = middleOf(node.previousElementSibling);

      let step = 0;
      if (after !== null && centre > after) step = 1;
      else if (before !== null && centre < before) step = -1;
      if (!step) return;

      const now = A.state.clips.findIndex((c) => c.id === clipId);
      // Quietly: the order is not settled until the finger comes up, and every
      // announcement rebuilds the lyric deck. done() pays for all of them at once.
      A.move(clipId, now + step, true);
      reorderNodes();
      if (dragging) dragging.reordered = true;
    }

    /* Holding a block against either end of the strip pans it.
     *
     * Dragging a block owns the sideways gesture now, so there is no way to carry one past
     * the edge of what is on screen: you would have to drop it, scroll, and pick it up
     * again. This is the usual answer, and it repeats on a timer rather than on pointer
     * events because a finger held still at the edge stops sending any.
     *
     * The speed rises with how far into the band the finger is, so resting near the edge
     * creeps and pressing into it moves. Every step re-asks the reorder question with the
     * finger where it still is, or the block would slide along the strip without ever
     * changing places with anything.
     */
    let panning = null;
    function edgePan(clientX, clipId) {
      const scroll = J.$(".comp-scroll", root);
      if (!scroll) return stopPan();
      const box = scroll.getBoundingClientRect();
      const into = clientX < box.left + PAN_BAND ? clientX - (box.left + PAN_BAND)
                 : clientX > box.right - PAN_BAND ? clientX - (box.right - PAN_BAND)
                 : 0;
      if (!into) return stopPan();

      const speed = J.clamp(into / PAN_BAND, -1, 1) * PAN_MOST;
      if (panning) { panning.speed = speed; panning.x = clientX; return; }

      /* A timer with the clock read inside it, which is neither of the obvious choices.
       *
       * Not a fixed step per tick, which is what this was first: measured, it panned about
       * a hundred pixels a second against the four hundred it was asking for, because
       * every tick does layout and sometimes a reorder and the timer never gets the
       * interval it asked for. Multiplying by the time that actually passed makes PAN_MOST
       * pixels per second, which is a promise that can be kept on a slow machine.
       *
       * And not requestAnimationFrame, which is the usual tool for something that moves:
       * it is paused entirely while the page is hidden, and a control loop should not
       * depend on that. Nothing here needs frame alignment either, because what it writes
       * is scrollLeft and the compositor picks that up on its own schedule.
       *
       * The elapsed time is capped, so a tab that was away for a while comes back and pans
       * one tick's worth rather than leaping to the end.
       */
      const step = () => {
        if (!dragging || !panning) return stopPan();
        const now = performance.now();
        const dt = Math.min(PAN_CAP, now - panning.last);
        panning.last = now;
        const was = scroll.scrollLeft;
        scroll.scrollLeft = was + (panning.speed * dt) / 1000;
        if (scroll.scrollLeft === was) return;        // at one end; nothing moved
        const node = J.$(`[data-clip="${panning.clipId}"]`, root);
        if (node) {
          node.style.setProperty("--drag",
            `${pointerOnStrip(panning.x) - dragging.grabbedBy - node.offsetLeft}px`);
        }
        reorderAround(panning.clipId);
        placeTools();
      };
      panning = { speed, x: clientX, clipId, last: performance.now(), timer: 0 };
      panning.timer = setInterval(step, PAN_EVERY);
    }
    function stopPan() {
      if (!panning) return;
      clearInterval(panning.timer);
      panning = null;
    }

    // ── pointer work ────────────────────────────────────────────────────────
    root.addEventListener("pointerdown", (e) => {
      // The buttons on the chosen block are presses, not handles.
      if (e.target.closest(".comp-tools")) return;
      const clipNode = e.target.closest(".comp-clip");
      if (!clipNode) return;
      const clipId = clipNode.dataset.clip;
      const clip = A.state.clips.find((c) => c.id === clipId);
      if (!clip) return;
      const edge = e.target.closest("[data-edge]");
      const startX = e.clientX;
      const startBeats = clip.beats;
      const order = A.state.clips.map((c) => c.id);

      dragging = { clipId, edge: edge ? edge.dataset.edge : null, startX, startBeats, order,
                   moved: false, reordered: false,
                   // How far into the block the finger landed, on the strip's own ruler.
                   // Everything about where the block should be is this plus where the
                   // finger is now, which stays true across a reorder and across a pan.
                   grabbedBy: pointerOnStrip(startX) - clipNode.offsetLeft };
      clipNode.classList.add("holding");
      // See the note in 76-compositor.css: a reorder re-inserts nodes, which restarts the
      // entry animation, and that animation would take the transform off the finger.
      const holder = J.$(".comp-clips", root);
      if (holder) holder.classList.add("moving");
      try { clipNode.setPointerCapture(e.pointerId); } catch (err) { /* not captured */ }

      const onMove = (event) => {
        if (!dragging) return;
        const dx = event.clientX - dragging.startX;
        if (Math.abs(dx) > 3) dragging.moved = true;
        const beats = Math.round(dx / pxPerBeat());

        if (dragging.edge) {
          const wanted = dragging.edge === "start"
            ? dragging.startBeats - beats : dragging.startBeats + beats;
          if (wanted !== clip.beats && wanted >= 1) {
            A.resize(clipId, dragging.edge, wanted);
            redrawSizes();
          }
          return;
        }
        /* The block goes with the hand.
         *
         * In track coordinates, not as a delta from where the finger started, because the
         * strip can scroll underneath during a drag: `at` is where the finger is on the
         * strip whatever the scroll is doing, and grabbedBy is how far into the block the
         * finger landed. The offset is against where the node sits *now*, since a reorder
         * moves its slot out from under it. */
        const at = pointerOnStrip(event.clientX);
        const node = J.$(`[data-clip="${clipId}"]`, root);
        if (node) {
          node.style.setProperty("--drag",
                                 `${at - dragging.grabbedBy - node.offsetLeft}px`);
        }
        reorderAround(clipId);
        placeTools();
        edgePan(event.clientX, clipId);
      };

      const done = () => {
        stopPan();
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", done);
        window.removeEventListener("pointercancel", done);
        const node = J.$(`[data-clip="${clipId}"]`, root);
        if (node) {
          node.classList.remove("holding");
          node.style.removeProperty("--drag");
        }
        const stillHolder = J.$(".comp-clips", root);
        if (stillHolder) stillHolder.classList.remove("moving");
        if (!dragging) return;
        const wasTrim = !!dragging.edge;
        const tapped = !dragging.moved;
        const reordered = dragging.reordered;
        dragging = null;

        if (tapped) { select(clipId); return; }

        /* The one announcement for however many crossings the drag made.
         *
         * A quiet move changes the order and tells nobody, so this is where the rest of
         * the app finds out: the save, the playback reschedule, and the lyric deck's own
         * redraw all hang off it. */
        if (reordered) { A.touch(); A.resync(); }

        /* Nothing here needs the panel built again.
         *
         * A trim has already been drawn, one width at a time, all the way through the
         * gesture, and a move has been reordering the real nodes as it went. draw() would
         * throw away every canvas in the track and paint them all again for a picture that
         * is already right, and that hitch on the frame you let go is what a press felt
         * like: the whole strip flickering because it had been rebuilt. The numbers along
         * the foot are the only stale thing, and redrawSizes writes those. */
        if (wasTrim || reordered) redrawSizes();
        placeTools();
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", done);
      window.addEventListener("pointercancel", done);
    });

    /* Only the widths changed, so only the widths are written. Rebuilding the panel on
     * every pixel of a drag would throw away the canvas mid gesture, which is the exact
     * bug the equaliser had. */
    function redrawSizes() {
      for (const clip of A.state.clips) {
        const node = J.$(`[data-clip="${clip.id}"]`, root);
        if (!node) continue;
        node.style.setProperty("--w", `${clip.beats * pxPerBeat()}px`);
        const count = J.$(".comp-beats", node);
        if (count) count.textContent = clip.beats;
        paintClip(clip.id);
      }
      const foot = J.$(".comp-foot .faint", root);
      if (foot) {
        foot.textContent = `${A.state.clips.length} part${A.state.clips.length === 1 ? "" : "s"}`
          + ` · ${Math.round(A.totalBeats() / A.state.perBar)} bars · ${J.time(A.duration())}`;
      }
      /* Widths just changed, so the corner the two buttons sit on has moved. Here rather
       * than at the call sites: this is the one function that changes a width, and
       * trimming the chosen block was leaving them behind at its old edge. */
      placeTools();
      syncBar();
    }

    let selected = null;

    /* Which block carries the outline, and where its two buttons sit.
     *
     * Split out of select() because a redraw has to be able to put both back without
     * announcing a choice that has not been made again. */
    function markSelected() {
      J.$$(".comp-clip", root).forEach((node) => {
        node.classList.toggle("on", node.dataset.clip === selected);
      });
      placeTools();
    }

    /* The tools ride on the chosen block, so they follow a reorder, a trim, a zoom and a
     * drag without any of those having to know they exist. Left is the block's right hand
     * edge; the stylesheet pulls them back over it from there.
     *
     * Then kept on screen. A section can be wider than the strip is, and a chorus whose
     * right hand edge is a thousand pixels off to the right had its two buttons out there
     * with it: you chose a block and nothing appeared. So the corner is where they want to
     * be and the visible window is where they are allowed to be, and they slide along the
     * top of a block that is only partly in view. Never off the block itself, in either
     * direction, or they would read as belonging to the one next door.
     */
    function placeTools() {
      const tools = J.$(".comp-tools", root);
      if (!tools) return;
      const node = selected && J.$(`[data-clip="${selected}"]`, root);
      if (!node) { tools.hidden = true; return; }
      tools.hidden = false;
      tools.style.top = `${node.offsetTop}px`;

      const drag = parseFloat(node.style.getPropertyValue("--drag")) || 0;
      const left = node.offsetLeft + drag;
      const right = left + node.offsetWidth;
      const scroll = J.$(".comp-scroll", root);
      // Measured off the element rather than assumed: the buttons are wider on a phone.
      const width = tools.offsetWidth || 60;

      let at = right;
      if (scroll) {
        const from = scroll.scrollLeft + width + EDGE;
        const to = scroll.scrollLeft + scroll.clientWidth - EDGE;
        at = J.clamp(at, Math.min(from, to), Math.max(from, to));
      }
      // And back inside the block, which wins over the window: a block scrolled entirely
      // out of view takes its buttons with it rather than parking them at the edge.
      tools.style.left = `${J.clamp(at, Math.min(left + width, right), right)}px`;
    }

    function select(clipId) {
      selected = clipId;
      markSelected();
      const clip = A.state.clips.find((c) => c.id === clipId);
      J.emit("compositor:select", { clip, part: clip && A.state.parts.find((p) => p.id === clip.part) });
    }

    /* Right clicking a section. Duplicate is a double click and remove is Backspace,
     * neither of which anybody discovers, so both live here with their shortcuts shown
     * next to them. */
    J.menu.on(root, ".comp-clip", (node) => {
      const clip = A.state.clips.find((c) => c.id === node.dataset.clip);
      if (!clip) return null;
      const part = A.state.parts.find((p) => p.id === clip.part);
      /* Say the length you will actually get. Rounding beats into bars for the label
       * while resizing in beats meant "halve it, to 3 bars" handed you two and a half,
       * which is a menu telling you something that is not true. */
      const per = A.state.perBar;
      const length = (beats) => {
        const bars = beats / per;
        if (Number.isInteger(bars)) return `${bars} bar${bars === 1 ? "" : "s"}`;
        return `${beats} beat${beats === 1 ? "" : "s"}`;
      };
      const half = Math.max(1, Math.round(clip.beats / 2));
      return [
        { group: part ? part.name : "Section" },
        { label: "Duplicate", icon: "copy", hint: "Double click",
          run: () => { const copy = A.duplicate(clip.id); draw(); if (copy) select(copy.id); } },
        { label: `Halve it, to ${length(half)}`,
          icon: "edit", disabled: clip.beats < 2,
          run: () => { A.resize(clip.id, "end", half); draw(); } },
        { label: `Double it, to ${length(clip.beats * 2)}`, icon: "edit",
          run: () => { A.resize(clip.id, "end", clip.beats * 2); draw(); } },
        { divider: true },
        part ? { label: "Rename this section", icon: "tag",
          run: async () => {
            const fields = await J.sheet({
              title: "Name this section", confirm: "Rename",
              body: `<input class="field" name="name" value="${J.esc(part.name)}">`,
            });
            if (fields && fields.name.trim()) { A.renamePart(part.id, fields.name.trim()); draw(); }
          } } : null,
        { label: "Play from here", icon: "play",
          run: () => {
            const row = A.laid().find((r) => r.clip.id === clip.id);
            if (row) { A.seek(row.at); if (!J.player.state.playing) J.player.toggle(); }
          } },
        { divider: true },
        { label: "Remove from the arrangement", icon: "drop", danger: true, hint: "Backspace",
          run: () => { A.remove(clip.id); draw(); } },
      ];
    });

    root.addEventListener("dblclick", (e) => {
      const node = e.target.closest(".comp-clip");
      if (!node) return;
      const copy = A.duplicate(node.dataset.clip);
      draw();
      if (copy) {
        J.toast("Duplicated. Trim it to make it shorter.");
        select(copy.id);
      }
    });

    root.addEventListener("keydown", (e) => {
      if (!selected) return;
      if (e.key === "Backspace" || e.key === "Delete") {
        e.preventDefault();
        A.remove(selected);
        selected = null;
        draw();
      }
      if (e.key === "d" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        const copy = A.duplicate(selected);
        draw();
        if (copy) select(copy.id);
      }
    });

    root.addEventListener("scroll", (e) => {
      if (!e.target.classList.contains("comp-scroll")) return;
      scrollLeft = e.target.scrollLeft;
      // The buttons are kept inside the visible window, so where that window is matters.
      placeTools();
      syncBar();
    }, true);

    // ── the header ──────────────────────────────────────────────────────────
    const taps = [];
    root.addEventListener("click", async (e) => {
      const act = e.target.closest("[data-act]");
      if (!act) return;
      const what = act.dataset.act;

      if (what === "onoff") {
        e.preventDefault();
        if (!A.state.clips.length) {
          J.toast("Lay the song out first, then it has something to play.", "bad");
          return;
        }
        await A.setEnabled(!A.state.enabled);
        draw();
        J.toast(A.state.enabled
          ? "Playing as arranged. A and B now compare sounds."
          : "Back to the render as it was rendered.");
      }
      if (what === "dup-sel" && selected) {
        const copy = A.duplicate(selected);
        draw();
        if (copy) select(copy.id);
      }
      if (what === "del-sel" && selected) {
        A.remove(selected);
        selected = null;
        draw();
      }

      if (what === "half") { A.setTempo(A.state.bpm / 2); draw(); }
      if (what === "double") { A.setTempo(A.state.bpm * 2); draw(); }
      if (what === "in") { zoom = J.clamp(zoom * 1.35, 0.3, 6); draw(); }
      if (what === "out") { zoom = J.clamp(zoom / 1.35, 0.3, 6); draw(); }

      if (what === "tap") {
        const now = performance.now();
        if (taps.length && now - taps[taps.length - 1] > 2200) taps.length = 0;
        taps.push(now);
        if (taps.length >= 4) {
          const gaps = [];
          for (let i = 1; i < taps.length; i++) gaps.push(taps[i] - taps[i - 1]);
          const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
          A.setTempo(60000 / mean);
          taps.length = 0;
          draw();
          J.toast(`Tempo set to ${Math.round(A.state.bpm)}.`);
        } else {
          act.textContent = `Tap ${4 - taps.length}`;
        }
      }

      if (what === "redetect") await layOut(act);
    });

    root.addEventListener("change", (e) => {
      const bpm = e.target.closest("#compBpm");
      if (!bpm) return;
      A.setTempo(parseFloat(bpm.value));
      draw();
    });

    /* Work out the tempo and the sections, and lay the song out as it already is.
     *
     * A fresh layout is every section in order, untrimmed and unmoved: it sounds exactly
     * like the render it came from. So switching it on changes nothing you can hear,
     * which means there is no reason to make anyone do it as a separate act, and the
     * next edit is audible the moment it is made.
     */
    async function layOut(button) {
      const version = ctx.currentVersion();
      if (!version) { J.toast("There is no render to listen to yet.", "bad"); return null; }
      const wasEmpty = !A.state.clips.length;
      if (button) { button.disabled = true; button.textContent = "Listening…"; }
      const read = await J.try(() => A.detect(version));

      if (read && read.silent) {
        J.toast("That render is silent. The project bounced to nothing, so there is "
                + "no beat to find.", "bad");
      } else if (read) {
        if (wasEmpty && !A.state.enabled) await A.setEnabled(true);
        J.toast(`${Math.round(read.bpm)} bpm, ${read.parts.length} section`
                + `${read.parts.length === 1 ? "" : "s"}. `
                + (read.confidence < 0.45
                   ? "The beat was hard to hear, so check the tempo."
                   : "Drag an edge to trim, double click to repeat."));
      }
      draw();
      return read;
    }

    /* Opening the panel on a song with no arrangement has exactly one thing you can do
     * on it, and the file has just been read for the waveform anyway. So it does it. */
    if (!A.state.clips.length) layOut(null);

    /* The playhead, while something is playing. */
    function follow() {
      const bar = J.$(".comp-playhead", root);
      if (!bar) return;
      const on = J.player.state.playing && J.arrange.state.enabled
                 && J.arrange.state.songId === (J.player.state.song || {}).id;
      bar.hidden = !on;
      if (!on) return;
      const at = J.arrange.position;
      bar.style.left = `${(at / A.beatSeconds()) * pxPerBeat()}px`;

      // Which clip is sounding. The engine announces the section change for the words;
      // this only marks the block you are looking at.
      const row = J.arrange.at(at);
      J.$$(".comp-clip", root).forEach((node) => {
        node.classList.toggle("live", !!row && node.dataset.clip === row.clip.id);
      });
    }
    const timer = setInterval(follow, 60);

    /* The bar is drawn in pixels, so its own width matters.
     *
     * Everything else that changes the picture goes through draw, a scroll or a trim. A
     * window getting narrower goes through none of them: the track shrinks, the thumb
     * keeps the width and offset it was given for the old one, and it ends up pointing at
     * the wrong part of a strip or hanging off the end of its groove. Not in follow(),
     * which runs seventeen times a second whether anything moved or not. */
    const onResize = () => syncBar();
    window.addEventListener("resize", onResize);

    draw();
    return {
      redraw: draw,
      stop() { clearInterval(timer); window.removeEventListener("resize", onResize); },
    };
  }

  return { mount };
})();
