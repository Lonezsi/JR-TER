/* What the box finds: everything, in categories, with a rule between them.
 *
 * The server decides what the categories are. It asks every module that is switched on
 * and each one answers for its own data, so there is no list of kinds here to keep in
 * step, and a category this file has never heard of still draws and still opens,
 * because the link came with it.
 *
 * Top level names here are shared with every other file in the bundle. wire, SORTS and
 * place are already taken elsewhere, and a duplicate const is a syntax error that stops
 * the whole app, not a shadowing bug in one screen.
 */
"use strict";

/* Mark the matching part, after escaping and never before.
 *
 * A lyric containing a < becomes &lt; when escaped. Wrapping the match first would put
 * a real tag inside text that is about to be escaped, so the tag would be shown as
 * characters instead of applied. Escaping first and then finding the escaped term in
 * the escaped string is the only order that is right in both directions. */
function markMatch(text, term) {
  const safe = J.esc(text || "");
  const needle = J.esc(term || "");
  if (!needle) return safe;
  const at = safe.toLowerCase().indexOf(needle.toLowerCase());
  if (at < 0) return safe;
  return safe.slice(0, at) + "<mark>" + safe.slice(at, at + needle.length)
       + "</mark>" + safe.slice(at + needle.length);
}

/* One row for everything that is not a song. An anchor rather than a div with a role,
 * so middle click, open in a new tab and Enter all work without being written. */
function hitRow(hit, term, lead) {
  return `
    <a class="hit" href="${J.esc(hit.href || "#/")}" data-link data-hit tabindex="-1">
      ${lead || ""}
      <span class="truncate">
        <span class="t truncate">${markMatch(hit.title, term)}</span>
        ${hit.line
          ? `<span class="s hit-line">${markMatch(hit.line, term)}</span>`
          : (hit.sub ? `<span class="s truncate">${J.esc(hit.sub)}</span>` : "")}
      </span>
    </a>`;
}

const SEARCH_ROWS = {
  song: (hit) => J.trackRow(hit),
  album: (hit, term) => hitRow(hit, term, J.cover({
    url: hit.has_cover ? `/api/albums/${hit.id}/cover` : null, title: hit.title })),
  playlist: (hit, term) => hitRow(hit, term, J.cover({ title: hit.title })),
  lyric: (hit, term) => hitRow(hit, term),
  version: (hit, term) => hitRow(hit, term),
  render: (hit, term) => hitRow(hit, term),
  artwork: (hit, term) => hitRow(hit, term),
};

J.views.search = {
  title: "Search",
  async render(root, params) {
    const term = (params.q || "").trim();
    if (!term) { location.hash = "#/"; return; }

    const data = await J.get(`/api/search?q=${encodeURIComponent(term)}`);
    const groups = data.groups || [];

    if (!groups.length) {
      /* Say where it looked, which is not the same list in every library: a category
       * whose module is switched off was never asked, so claiming to have searched it
       * would be untrue. */
      const where = (data.looked_in || []).map((w) => w.toLowerCase());
      const list = where.length > 1
        ? where.slice(0, -1).join(", ") + " or " + where[where.length - 1]
        : (where[0] || "anything");
      root.innerHTML = `<div class="section"><div class="empty">
        <h3>Nothing matches “${J.esc(term)}”</h3>
        <p>Nothing in your ${J.esc(list)}. A shorter word usually finds more.</p>
      </div></div>`;
      return;
    }

    const songs = [];
    const block = (group) => {
      const draw = SEARCH_ROWS[group.kind] || ((hit) => hitRow(hit, term));
      if (group.kind === "song") songs.push(...group.hits);
      const more = group.total > group.hits.length
        ? `<span class="faint">${group.hits.length} of ${group.total}</span>` : "";
      return `<section class="section">
        <div class="section-head"><h2>${J.esc(group.label)}</h2>
          <span class="grow"></span>${more}</div>
        ${group.error
          ? `<p class="faint">${J.esc(group.error)}</p>`
          : `<div class="${group.kind === "song" ? "tracks" : "hits"}">${
              group.hits.map((hit) => draw(hit, term)).join("")}</div>`}
      </section>`;
    };

    // The rule goes between, so one category has none and the last one is not followed
    // by a line with nothing under it.
    root.innerHTML = `<div class="results">${
      groups.map(block).join('<hr>')}</div>`;

    if (songs.length) J.wireTracks(root, songs);
    keyboard(root);
  },
};

/* One tab stop for the whole page of results, and the arrows move inside it.
 *
 * The same shape as J.wireTracks, over every kind of row rather than only songs, since
 * a search result list is mixed and arrowing out of the songs into nothing would be
 * the obvious thing to get wrong. Enter is not handled: the rows are anchors and a
 * browser has known what Enter does on one of those for thirty years.
 */
function keyboard(root) {
  const rows = () => J.$$(".track, [data-hit]", root);
  const first = rows()[0];
  if (first) first.tabIndex = 0;
  root.addEventListener("keydown", (e) => {
    const row = e.target.closest(".track, [data-hit]");
    if (!row) return;
    const all = rows();
    const at = all.indexOf(row);
    if (at < 0) return;
    let to = null;
    if (e.key === "ArrowDown") to = all[Math.min(at + 1, all.length - 1)];
    if (e.key === "ArrowUp") to = all[Math.max(at - 1, 0)];
    if (e.key === "Home") to = all[0];
    if (e.key === "End") to = all[all.length - 1];
    if (!to) return;
    e.preventDefault();
    all.forEach((r) => { r.tabIndex = r === to ? 0 : -1; });
    to.focus();
  });
}