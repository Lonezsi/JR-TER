/* Your account, and everybody else's.
 *
 * Reached from the row at the foot of the sidebar, which used to go to Settings. Settings
 * is where you change how the app behaves; this is who you are and who else is here, which
 * is a different question and was not answered anywhere.
 *
 * What it shows about other people is a handle, a name and when they joined, and nothing
 * else. There is nothing here about what is in anybody's library, because there is no way
 * to ask: each account is a separate database file and the only thing that crosses between
 * two of them is a song somebody deliberately shared.
 */
"use strict";

J.views.account = {
  title: "Account",
  async render(root) {
    const has = (name) => J.state.modules.includes(name);

    const [said, channel, shared] = await Promise.all([
      J.get("/api/auth/people").catch(() => null),
      has("youtube") ? J.get("/api/youtube/account").catch(() => null)
                     : Promise.resolve(null),
      has("sharing") ? J.get("/api/shared").catch(() => ({ shared: [] }))
                     : Promise.resolve({ shared: [] }),
    ]);

    /* A library with no door still has a somebody.
     *
     * Take the auth module out and there are no accounts, no sign in and no list of people
     * to fetch, which is a real way to run this: on your own machine, for your own music.
     * The page should still say who this library belongs to rather than claiming you are
     * not signed in, which on a library with nothing to sign in to is nonsense.
     */
    const local = !said;
    const people = local ? [] : (said.people || []);
    const me = local
      ? { id: 1, handle: "", name: J.state.name || "JR!TER", is_owner: true,
          created_at: 0 }
      : (people.find((p) => p.id === said.me) || null);
    const others = local ? [] : people.filter((p) => p.id !== said.me);

    const google = channel && (channel.accounts || [])
      .find((a) => a.id === channel.chosen) || (channel && (channel.accounts || [])[0]);

    const letter = (name) => J.esc((String(name || "?").trim()[0] || "?").toUpperCase());

    root.innerHTML = `
      <div class="section">
        <div class="section-head"><h2>You</h2></div>

        <div class="pane who-card">
          <span class="who-face" aria-hidden="true">${letter(me && me.name)}</span>
          <span class="who-lines">
            <span class="who-name">${J.esc(me ? me.name : "you")}</span>
            <span class="who-sub">${J.esc(me ? me.handle : "")}${
              me && me.is_owner ? " &middot; owner of this library" : ""}</span>
          </span>
          <span class="grow"></span>
          ${local ? "" : '<button class="btn sm ghost" data-act="rename">Change name</button>'}
        </div>

        <div class="who-facts">
          <div class="pane who-fact">
            <span class="who-fact-k">Google
              ${J.hint("Connecting a Google account is what lets JR!TER send a render to "
                     + "YouTube for you. It is per account: yours is not shared with "
                     + "anybody else on this server.")}</span>
            <span class="who-fact-v">${google
              ? J.esc(google.name || "connected")
              : "<span class=\"faint\">not connected</span>"}</span>
            ${has("youtube") ? `<a class="btn sm ghost" href="#/settings" data-link>${
              google ? "Change" : "Connect"}</a>` : ""}
          </div>

          ${has("sharing") ? `
            <div class="pane who-fact">
              <span class="who-fact-k">Shared with you</span>
              <span class="who-fact-v">${(shared.shared || []).length} song${
                (shared.shared || []).length === 1 ? "" : "s"}</span>
              <a class="btn sm ghost" href="#/shared" data-link>Open</a>
            </div>` : ""}

          <div class="pane who-fact">
            <span class="who-fact-k">Since</span>
            <span class="who-fact-v">${me && me.created_at
              ? J.esc(J.date(me.created_at)) : "&mdash;"}</span>
            ${local ? "" : '<button class="btn sm ghost" data-act="sign-out">Sign out</button>'}
          </div>
        </div>
      </div>

      <div class="section">
        <div class="section-head">
          <h2>Everybody here</h2>
          ${J.hint("Each account has a library of its own: separate database, separate "
                 + "audio, separate settings. Nothing here shows one person another's "
                 + "songs. The only thing that crosses between two accounts is a song "
                 + "somebody deliberately shares, and whoever runs the machine can read "
                 + "its files either way.")}
          <span class="grow"></span>
          <span class="faint">${local ? "1 account"
            : `${people.length} account${people.length === 1 ? "" : "s"}`}</span>
        </div>

        <div class="who-list">
          ${others.length ? others.map((p) => `
            <div class="pane who-row">
              <span class="who-face small" aria-hidden="true">${letter(p.name)}</span>
              <span class="who-lines">
                <span class="who-name">${J.esc(p.name)}</span>
                <span class="who-sub">${J.esc(p.handle)}${
                  p.is_owner ? " &middot; owner" : ""} &middot; since ${
                  J.esc(J.when(p.created_at))}</span>
              </span>
            </div>`).join("")
          : `<div class="empty">
               <h3>Just you so far</h3>
               <p>${local
                 ? "This copy is running without the door, so there is one library and it "
                   + "is this one. Switch the auth module on to give other people accounts."
                 : "Anybody the owner invites turns up here, with a library of their own."}</p>
             </div>`}
        </div>
      </div>`;

    root.addEventListener("click", async (e) => {
      const act = e.target.closest("[data-act]");
      if (!act) return;

      if (act.dataset.act === "rename") {
        const said = await J.sheet({
          title: "What should people call you",
          sub: "The name on your shares and beside your handle. Your handle does not change.",
          confirm: "Save",
          body: `<label class="sheet-label">Name
                   <input class="field" name="name" maxlength="80"
                          value="${J.esc(me ? me.name : "")}">
                 </label>`,
        });
        if (!said) return;
        const done = await J.try(() => J.patch("/api/auth/me", { name: said.name }),
                                 "Saved.");
        if (done) J.router.reload();
      }

      if (act.dataset.act === "sign-out") {
        await J.post("/api/auth/logout").catch(() => null);
        location.href = "/login";
      }
    });
  },
};
