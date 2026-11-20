/* The little question mark, and what it has to say.
 *
 * Every screen in this app used to explain itself in paragraphs sitting permanently under
 * its own heading. That is the right instinct and the wrong shape: the explanation is worth
 * having, and it is worth having *once*, on the day you first meet the screen. After that
 * it is four lines of text between you and the thing you came to do, on every visit, for
 * ever.
 *
 * So the words stay and the room they take does not. A hint is a twelve pixel mark beside a
 * heading; press it and the paragraph appears where you are looking.
 *
 * Deliberately not a title attribute. Those take a second to appear, cannot be reached by a
 * thumb at all, and are the reason "hover to find out" is not an answer on a phone.
 */
"use strict";

J.hint = (function () {
  let open = null;

  /* The mark itself, as markup, because every caller is building a template string.
   *
   * type="button" because these live inside forms and inside rows that submit things, and
   * a bare <button> in a form is a submit button.
   */
  function mark(text, opts) {
    const o = opts || {};
    return `<button class="hint ${o.className || ""}" type="button"
            data-hint="${J.esc(text)}" aria-label="What is this?"
            aria-expanded="false">?</button>`;
  }

  function close() {
    if (!open) return;
    const { pop, button } = open;
    open = null;
    button.setAttribute("aria-expanded", "false");
    pop.classList.remove("on");
    // Left in the document for the length of the fade, then taken away: a popover that is
    // removed on the same frame as its class does not animate out, it vanishes.
    const gone = () => pop.remove();
    pop.addEventListener("transitionend", gone, { once: true });
    setTimeout(gone, 400);
  }

  function show(button) {
    const text = button.dataset.hint || "";
    if (!text) return;
    const was = open && open.button === button;
    close();
    if (was) return;                     // pressing it again puts it away

    const pop = document.createElement("div");
    pop.className = "hint-pop";
    pop.setAttribute("role", "note");
    pop.textContent = text;
    document.body.appendChild(pop);

    /* Placed against the viewport rather than inside anything.
     *
     * On the body because the things these sit in clip their own overflow, scroll, and in
     * one case carry a backdrop-filter, and a popover inside any of those is a popover with
     * a corner cut off. Fixed position, so it does not need to be told when the page moves:
     * it is closed by then.
     */
    const at = button.getBoundingClientRect();
    const room = 12;
    pop.style.visibility = "hidden";
    pop.classList.add("on");
    const size = pop.getBoundingClientRect();

    let left = at.left + at.width / 2 - size.width / 2;
    left = J.clamp(left, room, window.innerWidth - size.width - room);
    // Under it if there is room, over it if there is not.
    const below = at.bottom + room + size.height < window.innerHeight;
    const top = below ? at.bottom + 8 : at.top - size.height - 8;

    pop.style.left = `${Math.round(left)}px`;
    pop.style.top = `${Math.round(top)}px`;
    pop.style.visibility = "";
    pop.classList.toggle("above", !below);

    button.setAttribute("aria-expanded", "true");
    open = { pop, button };
  }

  // One listener for every hint on every screen, because views replace their own root and
  // anything bound per element would have to be bound again on each draw.
  document.addEventListener("click", (e) => {
    const button = e.target.closest(".hint");
    if (button) {
      e.preventDefault();
      e.stopPropagation();
      show(button);
      return;
    }
    if (open && !e.target.closest(".hint-pop")) close();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && open) { e.preventDefault(); close(); }
  });
  // A popover pinned to a place on the screen is wrong the moment the screen moves.
  window.addEventListener("resize", close);
  window.addEventListener("hashchange", close);

  mark.close = close;
  return mark;
}());
