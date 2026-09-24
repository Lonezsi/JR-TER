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
      chips.innerHTML = people.map((p) => `
        <button class="who-chip${p.made_anything ? " made" : ""}" type="button"
                data-guest="${p.share}"
                title="${J.esc(p.name || p.handle)}${p.changes ? ", " + p.changes + " change"
                  + (p.changes === 1 ? "" : "s") : p.made_anything ? "" : ", nothing yet"}">
          ${J.esc(initials(p))}</button>`).join("");
      corner.appendChild(chips);
      chips.addEventListener("click", (e) => {
        const chip = e.target.closest("[data-guest]");
        const target = chip && where.querySelector(`[data-person="${chip.dataset.guest}"]`);
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
