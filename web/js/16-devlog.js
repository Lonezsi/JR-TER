/* What changed, said once.
 *
 * The rule this is built around: somebody who has just opened JR!TER for the first time
 * has missed nothing, and showing them a wall of release notes would be the opposite of
 * the point. So a browser with nothing remembered is told nothing, and simply has the
 * version written down for next time.
 *
 * The comparison of "is this newer" is the server's, through ?since, so there is one
 * implementation of it rather than two that can disagree about whether 0.10.0 beats
 * 0.9.0.
 */
"use strict";

J.devlog = (function () {
  const KEY = "jriter.version.seen";

  const seen = () => {
    try { return localStorage.getItem(KEY); } catch (e) { return null; }
  };
  const remember = (version) => {
    try { localStorage.setItem(KEY, version); } catch (e) { /* a private window */ }
  };

  /* One release. The same markup in the dialog and in Settings, because a second copy of
   * these is where the two stop looking like the same thing. */
  function entry(release) {
    const notes = (release.notes || []).map((line) => `<li>${J.esc(line)}</li>`).join("");
    return `
      <div class="log-entry">
        <div class="log-head">
          <span class="log-version">${J.esc(release.version)}</span>
          <span class="log-title">${J.esc(release.title || "")}</span>
          <span class="log-date">${J.esc(release.date || "")}</span>
        </div>
        ${release.name ? `<div class="log-name">${J.esc(release.name)}</div>` : ""}
        ${notes ? `<ul class="log-notes">${notes}</ul>` : ""}
      </div>`;
  }

  async function show(releases) {
    const newest = releases[0];
    const earlier = releases.slice(1);
    await J.sheet({
      title: "What changed",
      sub: `You were on an older copy${earlier.length
        ? `. ${releases.length} releases have landed since` : ""}.`,
      confirm: "",
      cancel: "Close",
      body: entry(newest) + (earlier.length ? `
        <button class="btn ghost sm log-more" type="button">Earlier releases</button>
        <div class="log-earlier" hidden>${earlier.map(entry).join("")}</div>` : ""),
      onMount(sheet) {
        // Not a data-act: that name is the delegated vocabulary, and every control
        // wearing one is expected to be answered by the handler on the view. This one
        // is answered here, three lines down, and only opens the rest of the list.
        const more = J.$(".log-more", sheet);
        if (!more) return;
        more.addEventListener("click", () => {
          J.$(".log-earlier", sheet).hidden = false;
          more.remove();
        });
      },
    });
  }

  async function check(state) {
    const now = state.version;
    if (!now) return;                            // a server too old to say
    const last = seen();
    if (last === now) return;
    // Nothing remembered means nothing missed. This is the whole first run story.
    if (!last) { remember(now); return; }
    if (!(state.modules || []).includes("devlog")) { remember(now); return; }

    let data;
    try {
      data = await J.get("/api/devlog?since=" + encodeURIComponent(last));
    } catch (e) {
      return;         // no note at all beats an error message about a note
    }
    /* Written down before it is shown rather than after. A dialog that comes back
     * because the tab was closed on it is the nagging this is meant to be the opposite
     * of, and the cost of getting it this way round is one release note missed by
     * somebody who closed the tab on it. */
    remember(now);
    const entries = (data && data.entries) || [];
    // Empty means the remembered version is ahead of this one, which is what a second
    // machine running an older copy looks like. Say nothing.
    if (!entries.length) return;
    await show(entries);
  }

  return { check, show, entry, all: () => J.get("/api/devlog") };
}());
