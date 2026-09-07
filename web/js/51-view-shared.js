/* Songs other people have shared with you, and the one you are working on.
 *
 * A separate screen rather than rows mixed into the library, because they are not yours.
 * You cannot rename them, post them, put them on an album or delete them, and a list where
 * some rows quietly refuse half the menu is worse than two lists.
 *
 * What you can do is listen, read the words, and work on the equaliser and the limiter.
 * Anything you save becomes your own copy, in your own library, which is the whole point:
 * a share is somewhere to work rather than permission to overwrite.
 */
"use strict";

J.views.shared = {
  title: "Shared with me",
  async render(root) {
    const data = await J.get("/api/shared").catch(() => ({ shared: [] }));
    const rows = data.shared || [];

    root.innerHTML = `
      <div class="section">
        <div class="section-head"><h2>Shared with me</h2></div>
        ${rows.length ? `
          <p class="faint" style="margin-top:0">
            Someone else's song, in their library. You can hear it and work on the sound and
            the words; whatever you save becomes your own copy and theirs is untouched.
          </p>
          <div class="tracks">
            ${rows.map((row) => `
              <a class="track shared-row" href="#/shared/${row.share}" data-link>
                ${J.cover({ title: row.title })}
                <span class="grow truncate">
                  <span class="t truncate">${J.esc(row.title)}</span>
                  <span class="s truncate">from ${J.esc(row.from)}${
                    row.as_name ? ` &middot; you are ${J.esc(row.as_name)} on this` : ""}</span>
                </span>
                <span class="s">${row.can_play ? "" : "no renders yet"}</span>
              </a>`).join("")}
          </div>`
        : `<div class="empty">
             <h3>Nothing shared with you</h3>
             <p>When somebody on this server shares a song with you it turns up here, on
                its own, rather than mixed in with your own library.</p>
           </div>`}
      </div>`;
  },
};

J.views.share = {
  title: "Shared song",
  async render(root, params) {
    const data = await J.get(`/api/shared/${params.id}`);
    const mine = data.mine || {};

    root.innerHTML = `
      <div class="section share-view">
        <div class="section-head">
          <h2>${J.esc(data.song.title)}</h2><span class="grow"></span>
          <span class="tag">from ${J.esc(data.from)}</span>
        </div>
        <p class="faint" style="margin-top:0">
          ${data.as_name
            ? `You are <b>${J.esc(data.as_name)}</b> on this, so anything you save is
               named after you.`
            : "Anything you save becomes your own copy."}
        </p>

        ${data.version ? `
          <div class="share-play">
            <button class="btn primary" data-act="play">Play</button>
            <span class="faint">v${data.version.n}${
              data.version.duration ? " &middot; " + J.time(data.version.duration) : ""}</span>
          </div>` : `<p class="faint">There is no render on this song yet.</p>`}
      </div>

      <div class="section">
        <div class="section-head"><h2>Words</h2></div>
        ${(data.sheets || []).length ? (data.sheets || []).map((sheet) => `
          <div class="share-block" data-sheet="${sheet.id}">
            <div class="share-block-head">
              <span class="truncate">${J.esc(sheet.name || "Lyrics")}</span>
              <span class="grow"></span>
              <button class="btn sm" data-act="save-sheet" data-from="${sheet.id}">
                Save as mine</button>
            </div>
            <textarea class="field share-text" rows="10"
                      data-text="${sheet.id}">${J.esc(sheet.text || "")}</textarea>
          </div>`).join("")
        : `<p class="faint">Nothing written yet. Anything you add here is yours.</p>
           <div class="share-block" data-sheet="new">
             <div class="share-block-head">
               <span class="grow"></span>
               <button class="btn sm" data-act="save-sheet">Save as mine</button>
             </div>
             <textarea class="field share-text" rows="10" data-text="new"></textarea>
           </div>`}
      </div>

      <div class="section">
        <div class="section-head"><h2>Sound</h2></div>
        ${(data.presets || []).length ? `
          <div class="tracks">
            ${(data.presets || []).map((preset) => `
              <div class="list-row">
                <span class="grow truncate">${J.esc(preset.name)}</span>
                <button class="btn sm" data-act="copy-preset" data-from="${preset.id}">
                  Copy to mine</button>
              </div>`).join("")}
          </div>`
        : `<p class="faint">No settings saved on this song yet.</p>`}
      </div>

      ${(mine.presets || []).length || (mine.sheets || []).length ? `
        <div class="section">
          <div class="section-head"><h2>Yours, on this song</h2></div>
          <p class="faint" style="margin-top:0">
            These live in your library and are yours to keep, whatever happens to the share.
          </p>
          <div class="tracks">
            ${(mine.sheets || []).map((sheet) => `
              <div class="list-row"><span class="tag">words</span>
                <span class="grow truncate">${J.esc(sheet.name)}</span></div>`).join("")}
            ${(mine.presets || []).map((preset) => `
              <div class="list-row"><span class="tag">sound</span>
                <span class="grow truncate">${J.esc(preset.name)}</span></div>`).join("")}
          </div>
        </div>` : ""}`;

    root.addEventListener("click", async (e) => {
      const act = e.target.closest("[data-act]");
      if (!act) return;
      const what = act.dataset.act;

      if (what === "play") {
        /* Played straight off the share's own address.
         *
         * Not through the version id: the server resolves which file this is from the
         * share, so a recipient never names a version and therefore never has a way to
         * ask for one they were not given. */
        J.player.playRender({
          id: `share-${params.id}`, kind: "render",
          name: data.song.title, title: data.song.title,
          url: `/api/shared/${params.id}/audio`,
        }, []);
        return;
      }

      if (what === "save-sheet") {
        const from = act.dataset.from;
        const box = J.$(`[data-text="${from || "new"}"]`, root);
        const saved = await J.try(() => J.post(`/api/shared/${params.id}/sheet`, {
          from: from ? Number(from) : null, text: box ? box.value : "",
        }), "Saved into your library.");
        if (saved) J.router.reload();
        return;
      }

      if (what === "copy-preset") {
        const from = Number(act.dataset.from);
        const preset = (data.presets || []).find((p) => p.id === from);
        const saved = await J.try(() => J.post(`/api/shared/${params.id}/preset`, {
          from, data: preset ? preset.data : {},
        }), "Copied into your library.");
        if (saved) J.router.reload();
      }
    });
  },
};
