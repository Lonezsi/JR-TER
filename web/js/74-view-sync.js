/* Watched folders: where renders land, and what is in them that JR!TER has not seen.
 *
 * A scan never imports anything. It reports what it found and what each file looks like
 * a new render of, and you say yes.
 */
"use strict";

J.views.sync = {
  title: "Folders",
  async render(root) {
    let folders = [];
    let candidates = [];
    let scanning = false;
    let summary = null;
    let stocking = false;
    let stock = {};

    async function loadFolders() {
      const data = await J.get("/api/sync/folders");
      folders = data.folders || [];
      draw();
    }

    /* One row, whichever kind of folder it is.
     *
     * The two sections differ in what they are for and in the button at the top of them,
     * not in how a folder is drawn, so there is one of these rather than two that drift
     * apart the first time somebody edits only one. */
    function folderRow(folder) {
      return `
        <div class="list-row" data-folder="${folder.id}">
          <button class="switch ${folder.enabled ? "on" : ""}" data-act="toggle"
                  aria-label="Watch this folder"></button>
          <span class="grow truncate">
            <div class="truncate" style="font-weight:600">${J.esc(folder.path)}</div>
            <div class="faint" style="font-size:12px">
              ${folder.last_scan ? `last looked at ${J.when(folder.last_scan)}` : "not looked at yet"}
            </div>
          </span>
          <button class="icon-btn" data-act="remove" aria-label="Stop watching">
            <svg viewBox="0 0 24 24" width="16" height="16"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/></svg>
          </button>
        </div>`;
    }

    function draw() {
      /* Two sections, because there were always two jobs and one list.
       *
       * A folder of samples and a folder of bounces are not the same thing, and this
       * screen treated every folder as the second: adding a sample library offered five
       * thousand one-shots as new renders. Which kind a folder is now belongs to the
       * folder, and each section only ever shows and acts on its own. */
      const collectors = folders.filter((f) => (f.kind || "collector") === "collector");
      const libraries = folders.filter((f) => f.kind === "sync");

      root.innerHTML = `
        <div class="folder-pair">
          <div class="section pane">
            <div class="section-head">
              <h2>Render collector</h2>
              ${J.hint("Folders your bounces land in. JR!TER notices new ones arriving so "
                     + "a render reaches the library without you carrying it there. It "
                     + "reads these and never writes to them, and nothing is imported "
                     + "until you say so.")}
              <span class="grow"></span>
              <button class="btn sm ghost" data-act="add" data-kind="collector">Add</button>
              <button class="btn sm primary" data-act="scan" ${collectors.length ? "" : "disabled"}>
                ${scanning ? "Scanning…" : "Scan"}
              </button>
            </div>

            ${collectors.length ? `<div class="folder-list">${
              collectors.map(folderRow).join("")}</div>`
            : `<div class="empty quiet">
                 <h3>Nothing collecting yet</h3>
                 <p>Point this at the folder your exports land in.</p>
                 <button class="btn primary" data-act="add" data-kind="collector"
                         style="margin-top:var(--s4)">Add a folder</button>
               </div>`}
          </div>

          <div class="section pane">
            <div class="section-head">
              <h2>Simple sync</h2>
              ${J.hint("Sample libraries, meant to be the same on every machine you work "
                     + "from. These are never offered as renders, which is the whole "
                     + "reason they are a separate kind: a folder of one shots is not a "
                     + "folder of bounces. What it does today is take stock: it counts "
                     + "what a library holds so two machines can be compared. It does not "
                     + "move files between them yet.")}
              <span class="grow"></span>
              <button class="btn sm ghost" data-act="add" data-kind="sync">Add</button>
              <button class="btn sm ghost" data-act="stock" ${libraries.length ? "" : "disabled"}>
                ${stocking ? "Looking…" : "Take stock"}
              </button>
            </div>

            ${libraries.length ? `<div class="folder-list">${
              libraries.map(folderRow).join("")}</div>`
            : `<div class="empty quiet">
                 <h3>No libraries yet</h3>
                 <p>Point this at your samples.</p>
                 <button class="btn primary" data-act="add" data-kind="sync"
                         style="margin-top:var(--s4)">Add a folder</button>
               </div>`}

            ${stock.libraries && stock.libraries.length ? `
              <div class="stock">
                ${stock.libraries.map((lib) => `
                  <div class="list-row">
                    <span class="grow truncate">
                      <div class="truncate" style="font-weight:600">${J.esc(lib.path)}</div>
                      <div class="faint" style="font-size:12px">
                        ${lib.files.toLocaleString()} files &middot; ${J.bytes(lib.bytes)}
                      </div>
                    </span>
                  </div>`).join("")}
              </div>` : ""}
          </div>
        </div>

        ${summary ? `
          <div class="section">
            <div class="section-head">
              <h2>New files</h2><span class="grow"></span>
              <span class="faint">${summary.already_have} already in the library</span>
            </div>
            ${summary.errors && summary.errors.length ? summary.errors.map((err) => `
              <div class="list-row"><span class="tag warn">problem</span>
                <span class="grow truncate">${J.esc(err.path)}<div class="faint" style="font-size:12px">${J.esc(err.why)}</div></span>
              </div>`).join("") : ""}
            ${candidates.length ? candidates.map((c) => `
              <div class="candidate" data-path="${J.esc(c.path)}">
                <span class="grow truncate">
                  <span class="name truncate">${J.esc(c.name)}</span>
                  <span class="path truncate">${J.esc(c.path)}</span>
                  <span class="path">${J.bytes(c.size)}${c.duration ? " &middot; " + J.time(c.duration) : ""}${
                    c.bitrate ? " &middot; " + c.bitrate + " kbps" : ""}</span>
                </span>
                ${c.suggest
                  ? `<button class="btn sm primary" data-act="import" data-song="${c.suggest.song_id}">
                       New render of ${J.esc(c.suggest.title)}</button>`
                  : ""}
                <button class="btn sm ${c.suggest ? "ghost" : "primary"}" data-act="import-new">
                  ${c.suggest ? "New song" : "Import as new song"}
                </button>
              </div>`).join("")
            : `<div class="empty"><h3>Nothing new</h3>
                 <p>Every audio file in those folders is already in the library.</p></div>`}
          </div>` : ""}`;
    }

    J.menu.on(root, "[data-folder]", (node) => {
    const folder = folders.find((f) => String(f.id) === node.dataset.folder);
    if (!folder) return null;
    return [
      { group: folder.path },
      { label: "Scan it now", icon: "play",
        run: () => J.$('[data-act="scan"]', root)?.click() },
      { label: folder.enabled ? "Stop watching it" : "Watch it again", icon: "edit",
        run: () => node.querySelector('[data-act="toggle"]')?.click() },
      { label: "Copy the path", icon: "copy",
        run: async () => {
          try { await navigator.clipboard.writeText(folder.path); J.toast("Path copied."); }
          catch (e) { J.toast(folder.path); }
        } },
      { divider: true },
      { label: "Remove from the list", icon: "drop", danger: true,
        run: () => node.querySelector('[data-act="remove"]')?.click() },
    ];
  });

  root.addEventListener("input", (e) => {
    const picker = e.target.closest("#accent");
    if (!picker) return;
    // The swatch is the control; the native input behind it is only the colour wheel.
    const holder = picker.closest(".swatch");
    holder.style.setProperty("--picked", picker.value);
    const hex = J.$(".swatch-hex", holder);
    if (hex) hex.textContent = picker.value;
  });

  root.addEventListener("click", async (e) => {
      const act = e.target.closest("[data-act]");
      if (!act) return;
      const what = act.dataset.act;
      const folderRow = act.closest("[data-folder]");
      const candidateRow = act.closest("[data-path]");

      if (what === "add") {
        /* The button says which section it came from.
         *
         * So the sheet can say what this folder is going to be treated as, rather than
         * taking a path and deciding afterwards. Putting a sample library in the render
         * collector is the exact mistake this split exists to prevent, and a shared
         * dialog that does not mention which one you are in would keep letting it happen.
         */
        const kind = act.dataset.kind === "sync" ? "sync" : "collector";
        const forSync = kind === "sync";
        const values = await J.sheet({
          title: forSync ? "Add a sample library" : "Watch a folder for renders",
          sub: forSync
            ? "The full path on the machine running JR!TER. Read only, and never offered as a render."
            : "The full path on the machine running JR!TER. It is only ever read.",
          confirm: forSync ? "Add it" : "Watch it",
          body: `<div class="sheet-fields"><label class="sheet-label">${J.req("Folder")}
            <input class="field" name="path" placeholder="${
              forSync ? "C:\\Users\\you\\Samples" : "C:\\Users\\you\\Music\\Renders"
            }"></label></div>`,
        });
        if (!values || !values.path.trim()) return;
        const made = await J.try(() => J.post("/api/sync/folders",
                                              { path: values.path.trim(), kind }));
        if (made) J.toast(made.added ? "Added" : "Already watching that one");
        await loadFolders();
      }

      /* Take stock of the sample libraries. Counts what is there; moves nothing. */
      if (what === "stock") {
        stocking = true;
        draw();
        const data = await J.try(() => J.post("/api/sync/stock"));
        stocking = false;
        if (data) stock = data;
        draw();
      }

      if (what === "toggle" && folderRow) {
        const folder = folders.find((f) => String(f.id) === folderRow.dataset.folder);
        await J.try(() => J.patch(`/api/sync/folders/${folder.id}`, { enabled: !folder.enabled }));
        await loadFolders();
      }

      if (what === "remove" && folderRow) {
        await J.try(() => J.del(`/api/sync/folders/${folderRow.dataset.folder}`), "Stopped watching");
        await loadFolders();
      }

      if (what === "scan") {
        scanning = true;
        draw();
        const data = await J.try(() => J.post("/api/sync/scan"));
        scanning = false;
        if (data) {
          summary = data;
          candidates = data.candidates || [];
          J.toast(`${candidates.length} new file${candidates.length === 1 ? "" : "s"}`);
        }
        draw();
      }

      if ((what === "import" || what === "import-new") && candidateRow) {
        const path = candidateRow.dataset.path;
        const payload = { path };
        if (what === "import") payload.song_id = Number(act.dataset.song);
        const result = await J.try(() => J.post("/api/sync/import", payload));
        if (!result) return;
        J.toast(result.duplicate
          ? "Already in the library"
          : `${result.song.title} is now v${result.version.n}`);
        candidates = candidates.filter((c) => c.path !== path);
        J.emit("songs:changed");
        draw();
      }
    });

    await loadFolders();
  },
};

J.views.settings = {
  title: "Settings",
  async render(root, params) {
    const state = await J.get("/api/state");
    let update = null;
    //: Invites and the people on this server. Only the owner is allowed to ask, so this
    //: stays null everywhere else and the section is simply not drawn.
    let people = null;
    //: Whether this machine can make a video at all. Asked once, like the update check.
    let tool = { found: false, why: "" };
    let font = (state.summary && state.summary.appearance) || { custom_font: false };

    function draw() {
      root.innerHTML = `
        <div class="section">
          <div class="section-head"><h2>Library</h2></div>
          <div class="sheet-fields" style="max-width:440px">
            <label class="sheet-label">Name
              <input class="field" id="libName" value="${J.esc(state.settings.library_name)}"></label>
            <label class="sheet-label">Accent colour
              <span class="swatch" style="--picked:${J.esc(state.settings.accent)}">
                <input id="accent" type="color" value="${J.esc(state.settings.accent)}">
                <span class="swatch-dot"></span>
                <span class="swatch-hex">${J.esc(state.settings.accent)}</span>
              </span>
            </label>

            <label class="sheet-label">Dust
              <span class="dial">
                <input class="range" id="dust" type="range" min="0" max="200" step="5"
                       value="${Number(state.settings.dust === undefined ? 100 : state.settings.dust)}">
                <b id="dustSaid">${Number(state.settings.dust === undefined ? 100 : state.settings.dust)}</b>
              </span>
              <span class="faint dial-note">Specks drifting behind a page with no artwork
                on it. A hundred is where the dial used to stop and is the normal amount.
                Past that they get brighter and bigger rather than more numerous, since
                the count is the only part of this that costs anything to draw.</span>
            </label>

            <label class="sheet-label">Chromatic aberration
              <span class="dial">
                <input class="range" id="glassEdge" type="range" min="0" max="200" step="5"
                       value="${Number(state.settings.glass_edge === undefined ? 100 : state.settings.glass_edge)}">
                <b id="glassEdgeSaid">${Number(state.settings.glass_edge === undefined ? 100 : state.settings.glass_edge)}</b>
              </span>
              <span class="faint dial-note">How far the rail and the player split light
                into colours at their edges. A hundred is where the dial used to stop and
                is the normal amount. Nought is plain glass, and costs less to draw.</span>
            </label>

            <label class="sheet-label">Dither
              <span class="dial">
                <input class="range" id="dither" type="range" min="0" max="100" step="5"
                       value="${Number(state.settings.dither === undefined ? 60 : state.settings.dither)}">
                <b id="ditherSaid">${Number(state.settings.dither === undefined ? 60 : state.settings.dither)}</b>
              </span>
              <span class="faint dial-note">One speck of noise per pixel of your screen,
                which is what stops a wide blur turning a smooth gradient into a
                staircase. Turn it up until the bands go. Past about eighty the grain
                itself starts to show, which is the point at which it is a look rather
                than a fix.</span>
            </label>

            <div><button class="btn primary sm" data-act="save-settings">Save</button></div>
          </div>
        </div>

        <div class="section">
          <div class="section-head"><h2>Video</h2></div>
          <p class="faint" style="margin-top:0">
            Turning a mix and its artwork into a video needs ffmpeg, which is a separate
            program. JR!TER does not carry one in its repository: it fetches a pinned
            build the first time you send something, checks it against a digest written
            into the source, and unpacks the one file it uses.
          </p>
          ${tool.found ? `
            <div class="list-row">
              <span class="grow">
                <div style="font-weight:600">${J.esc(tool.version)}</div>
                <div class="faint" style="font-size:12px">${J.esc(tool.path)}</div>
              </span>
            </div>` : `
            <div class="sheet-fields" style="max-width:520px">
              <p class="faint">${tool.can_install
                ? `There is none on this machine yet. Sending a mix will fetch ffmpeg
                   ${J.esc(tool.install_version || "")} first, about
                   ${J.bytes(tool.install_size || 0)}, once.`
                : J.esc(tool.why || "Looking for it.")}</p>
              <p class="faint">Or point it at one you already have:</p>
              <label class="sheet-label">Where ffmpeg is
                <input class="field" id="ffmpegPath" autocomplete="off"
                       value="${J.esc(state.settings.ffmpeg_path || "")}"
                       placeholder="C:\ffmpeg\bin\ffmpeg.exe"></label>
              <div><button class="btn primary sm" data-act="save-settings">Save</button></div>
            </div>`}
        </div>

        <div class="section">
          <div class="section-head"><h2>Storage</h2></div>
          <div class="list-row">
            <span class="grow">
              <div style="font-weight:600">${J.bytes(state.storage.bytes)} in ${state.storage.files} files</div>
              <div class="faint" style="font-size:12px">
                Files are stored once by their contents, so the same render uploaded twice
                takes one slot.
              </div>
            </span>
          </div>
          ${state.summary && state.summary.versions ? `
            <div class="list-row"><span class="grow">
              <div style="font-weight:600">${state.summary.versions.count} versions,
                ${state.summary.versions.distinct_files} distinct files</div>
              <div class="faint" style="font-size:12px">The gap is what deduplication saved you.</div>
            </span></div>` : ""}
        </div>

        <div class="section">
          <div class="section-head"><h2>Updates</h2><span class="grow"></span>
            <button class="btn sm" data-act="check">Check for updates</button></div>
          ${update ? `
            <div class="list-row">
              <span class="tag ${update.update_available ? "accent" : ""}">
                ${update.checked ? (update.update_available ? "update ready" : "up to date") : "cannot tell"}
              </span>
              <span class="grow truncate">
                <div class="truncate">${J.esc(update.message || update.why || "")}</div>
                <div class="faint" style="font-size:12px">
                  ${update.local ? `here ${update.local.slice(0, 7)}` : ""}
                  ${update.remote ? ` &middot; github ${update.remote.slice(0, 7)}` : ""}
                </div>
                ${/* Why there is no button, when there is a reason and no button.
                    *
                    * This line used to be "message or why", which meant why was only ever
                    * shown when there was no commit message to show instead, and there
                    * always is one. So a checkout with uncommitted changes in it said
                    * "update ready", named the release, offered nothing to press, and
                    * explained nothing. From the outside that is exactly what "it does not
                    * update" looks like. */
                  update.why && update.message
                    ? `<div class="bad-text" style="font-size:12px">${J.esc(update.why)}</div>`
                    : ""}
              </span>
              ${update.can_update
                ? '<button class="btn sm primary" data-act="apply">Update now</button>' : ""}
            </div>` : '<p class="faint">Could not check. Is this machine online?</p>'}
          <p class="faint" style="font-size:12px">
            An update lands on disk; the running server keeps the code it loaded at
            startup until it is restarted.
            <button class="btn ghost sm" data-act="restart"
                    style="margin-left:var(--s2)">Restart the server</button>
          </p>
        </div>

        <!-- The release notes moved to the front door. They were the sixth section of
             Settings, between the display font and the module list, which is a strange
             place to read about what changed: Settings is where you go to alter
             something, and a release note is not a setting. J.views.home carries them
             now, and the popup on an update is unchanged. -->

        <div class="section">
          <div class="section-head"><h2>Display font</h2></div>
          <p class="faint" style="margin-top:0">
            The face used for titles. JR!TER does not ship the one you want, because a
            licensed or shareware font does not belong in a public repository. Upload it
            here instead and it stays in your own data directory, served only to you.
          </p>
          <div class="list-row">
            <span class="grow">
              <div style="font-weight:600;font-family:var(--display);font-size:19px">
                ${font.custom_font ? J.esc(font.font_name) : "Orbitron"}</div>
              <div class="faint" style="font-size:12px">
                ${font.custom_font
                  ? `yours, uploaded ${J.when(font.uploaded_at)}`
                  : "the open licensed stand in"}</div>
            </span>
            <button class="btn sm" data-act="pick-font">Upload a font</button>
            ${font.custom_font
              ? '<button class="btn ghost sm danger" data-act="clear-font">Remove</button>' : ""}
          </div>
          <input type="file" id="fontPick" accept=".ttf,.otf,.woff,.woff2,font/*" hidden>
        </div>

        ${people ? `
        <div class="section">
          <div class="section-head"><h2>People</h2><span class="grow"></span>
            <button class="btn sm primary" data-act="invite">Invite somebody</button>
          </div>
          <p class="faint" style="margin-top:0">
            Everybody here gets a library of their own. Nobody can see anybody else's, and
            the only way anything crosses between two of them is a song you deliberately
            share.
          </p>
          <p class="faint" style="margin-top:0">
            Signing up needs an invite, because this library answers on a public address
            and an open form is an offer to whoever finds it.
          </p>

          <div class="tracks">
            ${(people.accounts || []).map((who) => `
              <div class="list-row">
                <span class="grow truncate">
                  <div class="truncate" style="font-weight:600">${J.esc(who.name)}</div>
                  <div class="faint" style="font-size:12px">
                    ${J.esc(who.handle)}${who.is_owner ? " &middot; owner" : ""}</div>
                </span>
              </div>`).join("")}
          </div>

          ${(people.invites || []).length ? `
            <div class="section-head" style="margin-top:var(--s5)"><h3>Invites</h3></div>
            <div class="tracks">
              ${people.invites.map((invite) => `
                <div class="list-row">
                  <span class="grow truncate">
                    <div class="truncate">${J.esc(invite.note || "no note")}</div>
                    <div class="faint" style="font-size:12px">
                      ${invite.used
                        ? "used by " + J.esc(invite.used_by_handle || "somebody")
                        : invite.expired ? "expired" : "waiting"}
                      &middot; made ${J.when(invite.created_at)}
                    </div>
                  </span>
                  ${invite.used ? "" : `
                    <button class="icon-btn" data-act="drop-invite" data-id="${invite.id}"
                            aria-label="Cancel this invite">
                      <svg viewBox="0 0 24 24" width="16" height="16"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/></svg>
                    </button>`}
                </div>`).join("")}
            </div>` : ""}
        </div>` : ""}

        <div class="section">
          <div class="section-head"><h2>Password</h2></div>
          <p class="faint" style="margin-top:0">
            Any password is accepted, however short. Guessing is limited to a few tries
            before that address has to wait, which is what makes a short one safe enough.
          </p>
          <div class="row wrap">
            <button class="btn sm" data-act="change-password">Change password</button>
            <button class="btn ghost sm" data-act="sign-out">Sign out</button>
          </div>
        </div>

        <div class="section">
          <div class="section-head"><h2>Your data</h2></div>
          <p class="faint" style="margin-top:0">
            Everything is on this machine and nothing is sent anywhere on its own. The
            terms and the privacy notice say what leaves it, when, and why.
          </p>
          <div class="row wrap">
            <!-- A control rather than a phrase underlined inside a sentence, which is
                 easy to read straight past when it is the thing you came here for.
                 In a new tab, and on this screen the reason is right here: every field
                 above it is unsaved until Save is pressed, and leaving would throw the
                 lot away for a link somebody meant to glance at. -->
            <a class="btn sm" href="/legal" target="_blank" rel="noopener">Terms and privacy</a>
            <button class="btn sm" data-act="take-copy">Take a copy</button>
            <button class="btn danger sm" data-act="erase">Erase this library</button>
          </div>
          <p class="faint" style="font-size:12px">
            The copy is a zip of every row JR!TER keeps, plus your settings and a note
            saying where the audio is. Nothing that opens the door is in it.
          </p>
        </div>

        <div class="section">
          <div class="section-head"><h2>Modules</h2></div>
          <p class="faint" style="margin-top:0">
            Each feature is a module. Removing one from the MODULES list in jriter/config.py
            takes it out of the server and out of this interface.
          </p>
          <div class="pills">
            ${state.modules.map((m) => `<span class="tag accent">${J.esc(m)}</span>`).join("")}
            ${Object.keys(state.failed || {}).map((m) =>
              `<span class="tag warn">${J.esc(m)} failed</span>`).join("")}
          </div>
        </div>`;
    }

    /* The dials do their thing while you drag them, before anything is saved.
     *
     * A slider you have to press Save to see the effect of is a slider you set by trial
     * and error with a round trip in the middle. Nothing is written until Save: leaving
     * this page without pressing it puts the saved setting back on the next load. */
    root.addEventListener("input", (e) => {
      const dial = e.target.closest("#dust, #glassEdge, #dither");
      if (!dial) return;
      const said = J.$("#" + dial.id + "Said", root);
      if (said) said.textContent = dial.value;
      J.applyLook({
        dust: Number((J.$("#dust", root) || {}).value),
        glass_edge: Number((J.$("#glassEdge", root) || {}).value),
        dither: Number((J.$("#dither", root) || {}).value),
      });
    });

    root.addEventListener("click", async (e) => {
      const act = e.target.closest("[data-act]");
      if (!act) return;

      if (act.dataset.act === "save-settings") {
        const patch = {
          library_name: J.$("#libName", root).value.trim() || "JR!TER",
          accent: J.$("#accent", root).value,
          dust: Number(J.$("#dust", root).value),
          glass_edge: Number(J.$("#glassEdge", root).value),
          dither: Number(J.$("#dither", root).value),
        };
        // Only when the field is on screen, which it is not once ffmpeg has been found.
        // Sending an empty string then would throw away a path somebody had typed in.
        const where = J.$("#ffmpegPath", root);
        if (where) patch.ffmpeg_path = where.value.trim();
        const saved = await J.try(() => J.put("/api/settings", patch), "Saved");
        if (saved) {
          state.settings = saved;
          J.applyAccent(saved.accent);
          J.applyLook(saved);
          J.emit("settings:changed");
        }
      }

      if (act.dataset.act === "take-copy") {
        /* A tab rather than fetch and a blob URL.
         *
         * The zip is built on a temporary file on the server precisely so a big library
         * is never held twice in memory, and reading it into the page to make a blob
         * would undo that on the machine with less of it. The browser streams it to disk
         * and the Content-Disposition names it. */
        window.open("/api/export", "_blank");
        return;
      }

      if (act.dataset.act === "erase") {
        const said = await J.try(() => J.get("/api/export/erase"));
        if (!said) return;
        const rows = said.goes.map((g) => `
          <div class="list-row">
            <span class="grow">
              <div style="font-family:ui-monospace,monospace;font-size:12px">${J.esc(g.path)}</div>
              <div class="faint" style="font-size:12px">${J.esc(g.how)}</div>
            </span>
            <b>${J.bytes(g.bytes)}</b>
          </div>`).join("");
        /* Typed, not ticked. A tick here is the same gesture as every other tick on the
         * page, and this one cannot be undone. The name has to match exactly. */
        const values = await J.sheet({
          title: "Erase this library",
          sub: "Every song, every take, every lyric. There is no undo and no copy kept.",
          confirm: "Erase it",
          cancel: "Keep it",
          danger: true,
          wide: true,
          body: `<div class="sheet-fields">
            <div>${rows}</div>
            <p class="faint" style="font-size:12px">
              Your password is left alone, so the door still works afterwards. A connected
              Google account is disconnected here but revoked only at Google. Take a copy
              first if you want one.
            </p>
            <!-- The name in the placeholder rather than bolded inside the label.
                 .sheet-label is a column flex, so any element in the label text becomes
                 its own row and "Type / JR!TER / to confirm" arrived on three lines. -->
            <label class="sheet-label">${J.req("Type the library's name to confirm")}
              <input class="field" name="confirm" autocomplete="off" spellcheck="false"
                     placeholder="${J.esc(said.library)}" required></label>
          </div>`,
        });
        if (!values) return;
        const done = await J.try(() => J.post("/api/export/erase",
                                              { confirm: (values.confirm || "").trim() }));
        if (!done) return;
        // Straight to the library rather than a toast on a Settings page describing a
        // library that is no longer there.
        location.href = "/";
        return;
      }

      if (act.dataset.act === "pick-font") { J.$("#fontPick", root).click(); return; }

      if (act.dataset.act === "clear-font") {
        const done = await J.try(() => J.del("/api/appearance/font"), "Back to Orbitron");
        if (!done) return;
        font = done.font;
        J.wearFont(font);
        draw();
        return;
      }

      if (act.dataset.act === "sign-out") {
        await J.try(() => J.post("/api/auth/logout"));
        location.href = "/login";
      }

      if (act.dataset.act === "invite") {
        const said = await J.sheet({
          title: "Invite somebody",
          sub: "They get an account and a library of their own. They cannot see yours.",
          confirm: "Make a code",
          body: `
            <label class="sheet-label">Who is it for
              <input class="field" name="note" placeholder="Jozsef" maxlength="80">
            </label>
            <label class="sheet-label">Good for
              <select class="field" name="days">
                <option value="7">a week</option>
                <option value="14" selected>two weeks</option>
                <option value="90">three months</option>
                <option value="0">until it is used</option>
              </select>
            </label>`,
        });
        if (!said) return;
        const made = await J.try(() => J.post("/api/auth/invites", said));
        if (!made) return;
        /* Shown once, in a dialog you have to close, because that is the only time it
         * exists: only a digest of it is kept, the same as a password. */
        await J.sheet({
          title: "Send them this",
          sub: "It works once and is not shown again. Only a digest of it is kept.",
          confirm: "",
          cancel: "Done",
          body: `<p class="code-out" id="inviteCode">${J.esc(made.code)}</p>
                 <p class="faint" style="font-size:12px">
                   They open this library, choose "I have an invite", and type it in.</p>`,
          onMount(sheet) {
            const box = J.$("#inviteCode", sheet);
            box.addEventListener("click", async () => {
              try { await navigator.clipboard.writeText(made.code); J.toast("Copied."); }
              catch (e) { /* a browser that will not, which is why it is on screen */ }
            });
          },
        });
        people = await J.get("/api/auth/invites").catch(() => people);
        draw();
        return;
      }

      if (act.dataset.act === "drop-invite") {
        const done = await J.try(() => J.del(`/api/auth/invites/${act.dataset.id}`),
                                 "That invite will not work now.");
        if (!done) return;
        people = await J.get("/api/auth/invites").catch(() => people);
        draw();
        return;
      }

      if (act.dataset.act === "change-password") {
        const values = await J.sheet({
          title: "Change password",
          sub: "Anything you like. Every signed in device is signed out when it changes.",
          confirm: "Change it",
          body: `<div class="sheet-fields">
            <label class="sheet-label">${J.req("Current password")}
              <input class="field" name="current" type="password"
                     autocomplete="current-password" required></label>
            <label class="sheet-label">${J.req("New password")}
              <input class="field" name="next" type="password" autocomplete="new-password"
                     required></label>
          </div>`,
        });
        if (!values) return;
        const done = await J.try(() => J.post("/api/auth/password", {
          current: values.current, new: values.next }));
        if (done) J.toast("Password changed. Other devices will have to sign in again.");
      }

      if (act.dataset.act === "restart") {
        const sure = await J.confirm(
          "Restart JR!TER now?",
          "It stops and starts again on the code that is on disk. Anything playing stops "
          + "with it. On the machine that hosts your library a task starts it again within "
          + "a few minutes; if you are running it by hand in a window, you will have to.",
          "Restart it");
        if (!sure) return;
        const said = await J.try(() => J.post("/api/update/restart"));
        if (!said) return;
        J.toast("Restarting. This page will reconnect on its own.");
        waitForItToComeBack();
        return;
      }

      if (act.dataset.act === "check") {
        update = await J.try(() => J.get("/api/update/check"));
        draw();
      }

      if (act.dataset.act === "apply") {
        const result = await J.try(() => J.post("/api/update/apply"));
        if (!result) return;
        J.toast(result.message);
        update = null;
        draw();
        if (result.restart_required) {
          /* Offered rather than described.
           *
           * This used to say "stop the server and start it again", which is a fine thing to
           * read at a keyboard in front of the machine and useless on a host in another
           * room with nobody logged into it. That gap is most of what "the update did not
           * work" means: the pull succeeded, the process kept running the code it had
           * already imported, and the version in the rail never moved. */
          const now = await J.sheet({
            title: "Restart to finish",
            sub: "The new code is on disk. Python is still running the version it loaded at "
               + "startup, so nothing changes until the server starts again.",
            confirm: "Restart now",
            cancel: "I will do it myself",
            body: `<p class="faint" style="font-size:13px">
                     On the machine that hosts your library this is safe: it is started by a
                     task that checks every few minutes, so it comes back on its own. If you
                     are running it by hand in a window, stop it and start it again there.
                   </p>`,
          });
          if (now) {
            const said = await J.try(() => J.post("/api/update/restart"));
            if (said) {
              J.toast("Restarting. This page will reconnect on its own.");
              waitForItToComeBack();
            }
          }
        }
      }
    });

    draw();

    // Delegated on the view, because draw() replaces the input each time.
    root.addEventListener("change", async (e) => {
      const picker = e.target.closest("#fontPick");
      if (!picker || !picker.files.length) return;
      const file = picker.files[0];
      picker.value = "";
      const done = await J.try(() => J.upload("/api/appearance/font", file));
      if (!done) return;
      font = done.font;
      J.wearFont(font);
      J.toast("Titles are wearing " + file.name);
      draw();
    });

    /* Poll health until it answers, then reload.
     *
     * A restart takes a couple of seconds by hand and up to three minutes on the host,
     * where a task notices it is gone and starts it again. Either way the page is sitting
     * on a server that is not there, and the honest thing is to say so and then simply
     * come back rather than leaving somebody pressing refresh.
     */
    function waitForItToComeBack() {
      const bar = J.$("#navBar");
      if (bar) { bar.hidden = false; bar.classList.add("running"); }
      const started = Date.now();
      const knock = async () => {
        try {
          const answer = await fetch("/api/health", { cache: "no-store" });
          if (answer.ok) { location.reload(); return; }
        } catch (e) { /* still down, which is the expected answer for a while */ }
        // Four minutes: the host's watchdog runs every three, so this outlasts one full
        // cycle of it and then stops rather than knocking for ever.
        if (Date.now() - started > 240000) {
          J.toast("It has not come back yet. Start it on the machine it runs on.", "bad");
          if (bar) { bar.hidden = true; bar.classList.remove("running"); }
          return;
        }
        setTimeout(knock, 2000);
      };
      // A moment first, so the knock does not land on the server that is still answering.
      setTimeout(knock, 1500);
    }

    /* Checked on the way in, rather than waiting to be asked.
     *
     * The banner in the top bar says "Update ready" and links here, and this screen used to
     * open on "Not checked yet" with no button on it. So the one path anybody actually
     * takes to an update ended in a dead end: press the thing that says an update is ready,
     * arrive somewhere that says it does not know, and have to work out that a second
     * button does the same check the banner already did.
     *
     * Same call the banner made, so this costs one request on a screen that already makes
     * four, and only when the module is on. */
    if (state.modules.includes("updater")) {
      update = await J.get("/api/update/check").catch(() => null);
      draw();
    }

    /* Only the owner may ask, and a 403 here is the ordinary answer for everybody else.
     *
     * Caught rather than surfaced for exactly that reason: on a friend's Settings screen a
     * red toast saying they are not allowed to see the invite list would be telling them
     * off for something the page did on its own. */
    people = await J.get("/api/auth/invites").catch(() => null);
    if (people) draw();

    if (state.modules.includes("youtube")) {
      tool = await J.get("/api/youtube/tool").catch(() => tool);
      draw();
    }
  },
};
