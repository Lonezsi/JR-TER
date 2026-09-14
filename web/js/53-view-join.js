/* Somebody has sent you a song.
 *
 * The screen a share link opens, and the only one in this app that somebody may reach
 * before they have an account. So it does both jobs: it says what has been sent and who
 * sent it, and it either takes the share for whoever is already signed in here, or makes
 * an account there and then.
 *
 * WHY THIS EXISTS. Sharing used to need the other person's handle first, which meant the
 * sharer had to know an account already existed and what it was called. Somebody with no
 * account could not be sent a song at all without first being sent an invite and told to
 * sign up somewhere else. Two messages, and a spare concept to explain, before they had
 * heard anything.
 *
 * The token in the address is the permission and the invite together. It is not guessable,
 * the server keeps only its digest, and it is spent the first time it works, so a link that
 * gets forwarded opens for the first person and is simply not open for the rest.
 */
"use strict";

J.views.join = {
  title: "A song for you",

  async render(root, params) {
    const token = params.token;

    let invitation = null;
    try {
      invitation = await J.get(`/api/shares/invitation/${encodeURIComponent(token)}`);
    } catch (e) {
      /* One message for every way a link can be closed, because the server gives one
       * answer for all of them on purpose: used, taken back, expired, never real. */
      root.innerHTML = `
        <div class="section">
          <div class="section-head"><h2>This link is not open</h2></div>
          <div class="empty">
            <h3>Nothing to take</h3>
            <p>It may have been used already, or taken back by whoever sent it. Ask them
               for a new one.</p>
            <p><a class="btn" href="#/">Go to the library</a></p>
          </div>
        </div>`;
      return;
    }

    const from = J.esc(invitation.from);
    const title = J.esc(invitation.song.title);
    const named = invitation.as_name
      ? `<p class="faint">On this song you are <b>${J.esc(invitation.as_name)}</b>, so
         anything you save is named after you.</p>` : "";

    root.innerHTML = `
      <div class="section share-view">
        <div class="section-head"><h2>${from} shared a song with you</h2></div>
        <p class="join-song">${title}</p>
        <p class="faint" style="margin-top:0">
          You will be able to listen to it, read the words, and work on the sound. Nothing
          else of theirs, and anything you save becomes your own copy rather than changing
          what they have.
        </p>
        ${named}

        ${invitation.signed_in ? `
          <div class="share-play">
            <button class="btn primary" data-act="take">Take it</button>
          </div>`
        : `
          <form class="join-form" id="joinForm">
            <label class="sheet-label">Pick a handle
              <input class="field" name="handle" autocomplete="username"
                     autocapitalize="none" spellcheck="false" required>
            </label>
            <label class="sheet-label">And a password
              <input class="field" name="password" type="password"
                     autocomplete="new-password" required>
            </label>
            <label class="sheet-label">What people should call you
              <input class="field" name="name" autocomplete="name"
                     placeholder="optional">
            </label>
            <button class="btn primary" type="submit">Make an account and take it</button>
            <p class="faint" style="font-size:12px">
              Already have one here? <a href="/login#/join/${J.esc(token)}">Sign in</a>
              and this page will finish by itself.
            </p>
          </form>`}
      </div>`;

    async function take(body) {
      const got = await J.try(
        () => J.post(`/api/shares/invitation/${encodeURIComponent(token)}`, body || {}),
        "It is yours.");
      if (!got) return;
      /* Straight to the song rather than to the list. What was pressed was this song, and
       * a list with one row in it is a screen that asks you to press it again. */
      location.hash = `#/shared/${got.share}`;
    }

    root.addEventListener("click", (e) => {
      if (e.target.closest("[data-act='take']")) take();
    });

    const form = J.$("#joinForm", root);
    if (form) {
      form.addEventListener("submit", (e) => {
        e.preventDefault();
        const field = (name) => {
          const box = form.querySelector(`[name="${name}"]`);
          return box ? box.value.trim() : "";
        };
        take({ handle: field("handle"), password: field("password"),
               name: field("name") });
      });
    }
  },
};
