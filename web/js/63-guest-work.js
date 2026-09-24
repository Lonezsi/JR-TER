/* What the people a song is shared with have made on it.
 *
 * A guest's words, sound, pictures and mixes live in their own library, on the copy of the
 * song a share makes the first time they save. Nothing showed them to anybody else, so an
 * owner whose friend had rewritten the words, changed the picture and mixed the song saw
 * none of it. This shows it: on the owner's song page, and on the shared page of everybody
 * else the song is shared with.
 *
 * Two parts. The editors, as small initials in the top right corner of the song, and below
 * the page, each person's work. Pressing a person's initials scrolls to theirs.
 */
"use strict";

J.guestWork = {
  /* `where` is the element the section goes at the end of; `corner` is where the initials
   * go (the song's hero, or the shared page's heading); `url` is the list to read. */
  async mount({ where, corner, url, heading }) {
    let data;
    try { data = await J.get(url); } catch (e) { return; }
    const people = (data && data.people) || [];
    if (!people.length || !where) return;

    const initials = (p) => (p.name || p.handle || "?").trim().split(/\s+/)
      .map((w) => w[0]).join("").slice(0, 2).toUpperCase();
    const when = (t) => (t ? new Date(t * 1000).toLocaleDateString() : "");

    if (corner) {
      const chips = document.createElement("div");
      chips.className = "hero-people";
      // Yours first, on your own song page: the way back from somebody else's version.
      const own = corner.classList.contains("hero") && !J.sharedAs;
      chips.innerHTML = (own ? `
        <button class="who-chip made on" type="button" data-guest="me"
                title="Your version">Te</button>` : "")
        + people.map((p) => `
        <button class="who-chip${p.made_anything ? " made" : ""}" type="button"
                data-guest="${p.share}"
                title="${J.esc(p.name || p.handle)}${p.changes ? ", " + p.changes + " change"
                  + (p.changes === 1 ? "" : "s") : p.made_anything ? "" : ", nothing yet"}">
          ${J.esc(initials(p))}</button>`).join("");
      corner.appendChild(chips);
      /* A person's initials switch the song to their perspective: their picture on the
       * cover, their words, their sound, their mixes. Yours puts it all back. On a guest's
       * shared page there is no song of theirs to swap into, so it scrolls to their work. */
      chips.addEventListener("click", (e) => {
        const chip = e.target.closest("[data-guest]");
        if (!chip) return;
        if (chip.dataset.guest === "me") { J.router.reload(); return; }
        const person = people.find((p) => String(p.share) === chip.dataset.guest);
        if (own && person) {
          chips.querySelectorAll(".who-chip").forEach((c) => c.classList.toggle("on", c === chip));
          J.guestWork.see(where, person);
          return;
        }
        const target = where.querySelector(`[data-person="${chip.dataset.guest}"]`);
        if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    }

    const section = document.createElement("div");
    section.className = "section guest-work";
    section.innerHTML = `
      <div class="section-head"><h2>${J.esc(heading)}</h2></div>
      ${people.map((p) => `
        <div class="pane guest-person" data-person="${p.share}">
          <div class="guest-who">
            <span class="who-chip made">${J.esc(initials(p))}</span>
            <b>${J.esc(p.name || p.handle)}</b>
            ${p.handle ? `<span class="faint">@${J.esc(p.handle)}</span>` : ""}
            <span class="grow"></span>
            ${p.updated_at ? `<span class="faint">${J.esc(when(p.updated_at))}</span>` : ""}
          </div>
          ${!p.made_anything ? `<p class="faint">Nothing made on this song yet.</p>` : ""}
          ${p.changes ? `<p class="faint">${p.changes} change${p.changes === 1 ? "" : "s"}
            to the song itself, listed under Changes by others.</p>` : ""}
          ${p.artwork.length ? `
            <div class="guest-art">${p.artwork.map((a) => `
              <img src="/api/guestwork/${p.share}/artwork/${a.id}" alt="${J.esc(a.caption)}"
                   loading="lazy">`).join("")}</div>` : ""}
          ${p.versions.length ? `
            <div class="guest-mixes">${p.versions.map((v) => `
              <div class="list-row">
                <span class="tag">mix</span>
                <span class="grow truncate">${J.esc(v.filename || ("v" + v.n))}</span>
                <audio controls preload="none"
                       src="/api/guestwork/${p.share}/audio/${v.id}"></audio>
              </div>`).join("")}</div>` : ""}
          ${p.sheets.map((s) => `
            <details class="guest-words" open>
              <summary>${J.esc(s.name || "Words")}</summary>
              <pre>${J.esc(s.text)}</pre>
            </details>`).join("")}
          ${p.presets.length ? `
            <div class="guest-sound">${p.presets.map((s) => `
              <div class="list-row"><span class="tag">sound</span>
                <span class="grow truncate">${J.esc(s.name)}</span>
                <span class="faint">${((s.data && s.data.bands) || []).length} bands</span>
              </div>`).join("")}</div>` : ""}
        </div>`).join("")}`;
    where.appendChild(section);
  },

  /* The song, as one person made it. Only what is drawn changes: nothing is written, and
   * "Back to mine" (or your own initials) redraws the page from your library. */
  see(root, p) {
    const art = p.artwork.length ? `/api/guestwork/${p.share}/artwork/${p.artwork[0].id}` : null;
    const heroArt = J.$("#heroArt", root);
    const cover = root.querySelector(".hero-row .cover");
    if (art) {
      if (heroArt) { heroArt.classList.remove("flat"); heroArt.style.backgroundImage = `url('${art}')`; }
      if (cover) { cover.style.backgroundImage = `url('${art}')`; const l = cover.querySelector(".letter"); if (l) l.remove(); }
    }
    const lyrics = J.$("#lyricsBlock", root);
    if (lyrics) {
      lyrics.innerHTML = `<div class="block-head"><h3>${J.esc(p.name || p.handle)}'s words</h3></div>
        ${p.sheets.length ? p.sheets.map((s) => `
          <div class="pane guest-words-card"><b>${J.esc(s.name || "Words")}</b>
            <pre>${J.esc(s.text)}</pre></div>`).join("")
          : `<p class="faint">No words of their own. Anything they changed on yours is
             already on your song.</p>`}`;
    }
    const sound = J.$("#soundBlock", root);
    if (sound) {
      sound.innerHTML = `<div class="block-head"><h3>${J.esc(p.name || p.handle)}'s sound</h3></div>
        ${p.presets.length ? p.presets.map((s) => `<div class="list-row"><span class="tag">sound</span>
          <span class="grow truncate">${J.esc(s.name)}</span>
          <span class="faint">${((s.data && s.data.bands) || []).length} bands</span></div>`).join("")
          : `<p class="faint">No sound settings of their own.</p>`}`;
    }
    let strip = J.$(".perspective", root);
    if (!strip) {
      strip = document.createElement("div");
      strip.className = "pane perspective";
      root.insertBefore(strip, root.firstChild);
    }
    strip.innerHTML = `
      <b>${J.esc(p.name || p.handle)}'s version</b>
      ${p.changes ? `<span class="faint">and ${p.changes} change${p.changes === 1 ? "" : "s"}
        on yours</span>` : ""}
      <span class="grow"></span>
      ${p.versions.map((v) => `<span class="perspective-mix">${J.esc(v.filename || ("v" + v.n))}
        <audio controls preload="none" src="/api/guestwork/${p.share}/audio/${v.id}"></audio>
        </span>`).join("")}
      <button class="btn sm ghost" type="button" data-back>Back to mine</button>`;
    strip.querySelector("[data-back]").onclick = () => J.router.reload();
    strip.scrollIntoView({ behavior: "smooth", block: "start" });
  },

  /* What the people the song is shared with changed on it, with a way to put each back.
   *
   * Putting one back returns the song to how it was just before that change, so anything
   * changed after it on the same thing goes too. That is said on the button rather than
   * discovered. */
  async changes(where, songId) {
    let data;
    try { data = await J.get(`/api/songs/${songId}/edits`); } catch (e) { return; }
    const edits = (data && data.edits) || [];
    if (!edits.length) return;
    const when = (t) => new Date(t * 1000).toLocaleString();
    const section = document.createElement("div");
    section.className = "section guest-changes";
    section.innerHTML = `
      <div class="section-head"><h2>Changes by others</h2></div>
      <div class="pane">${edits.map((e) => `
        <div class="list-row${e.undone_at ? " undone" : ""}">
          <span class="who-chip made">${J.esc(((e.name || e.handle || "?")[0] || "?")
            .toUpperCase())}</span>
          <span class="grow truncate"><b>${J.esc(e.name || e.handle)}</b>
            ${J.esc(e.what)}</span>
          <span class="faint">${J.esc(when(e.updated_at))}</span>
          ${e.undone_at ? `<span class="tag">put back</span>` : `
            <button class="btn sm ghost" data-undo="${e.id}"
                    title="Back to how it was before this, with anything changed after it">
              Undo</button>`}
        </div>`).join("")}</div>`;
    where.appendChild(section);
    section.addEventListener("click", async (ev) => {
      const b = ev.target.closest("[data-undo]");
      if (!b) return;
      const sure = await J.confirm("Undo this change?",
        "The song goes back to how it was just before it. Anything changed after it on the "
        + "same thing goes back too.", "Undo it");
      if (!sure) return;
      const done = await J.try(() => J.post(`/api/guest-edits/${b.dataset.undo}/undo`),
                               "Put back");
      if (done) J.router.reload();
    });
  },
};
