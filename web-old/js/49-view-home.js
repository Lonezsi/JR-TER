/* The front door.
 *
 * Reached by pressing the name in the rail, which used to go to the library. The library
 * is a list of everything and it is the right screen when you know what you are looking
 * for; this is the one for when you have just opened the app and do not. It says what
 * this is in a sentence, puts the things you keep coming back to within one press, and
 * carries the release notes, which were buried at the bottom of Settings between the
 * display font and the module list.
 *
 * What "most opened" means: a counter on the song and on the album, bumped by the server
 * when one is read. It starts at zero for a library that predates the counter, so this
 * screen has nothing to show at first and says so rather than inventing an order.
 */
"use strict";

J.views.home = {
  title: "Home",
  async render(root) {
    const has = (name) => J.state.modules.includes(name);

    /* Everything at once, and none of it fatal.
     *
     * A front page that fails to load because one of four optional things is switched
     * off is worse than a front page missing a section, so each of these falls back to
     * empty rather than throwing. */
    const [songs, albums, log] = await Promise.all([
      J.get("/api/songs/most-opened?limit=6").catch(() => ({ songs: [] })),
      has("albums") ? J.get("/api/albums/most-opened?limit=4").catch(() => ({ albums: [] }))
                    : Promise.resolve({ albums: [] }),
      has("devlog") ? J.devlog.all().catch(() => ({ entries: [] }))
                    : Promise.resolve({ entries: [] }),
    ]);

    const topSongs = songs.songs || [];
    const topAlbums = albums.albums || [];
    const releases = log.entries || [];
    const name = J.state.name || "JR!TER";

    root.innerHTML = `
      <div class="home">
        <!-- Plain language, and the one screen in the app where a sentence is the point.
             It answers the question somebody has on the way in, which is not "what are
             my songs called" but "what is this for". -->
        <header class="home-hero">
          <p class="home-eyebrow">${J.esc(name)}</p>
          <h1 class="home-title">Everything you have been working on.</h1>
          <p class="home-lede">
            A song here is one place that holds every bounce of a track, the words, the
            artwork and the way you want it cut. Renders come and go underneath it; the
            song stays. Start one, drop a mix on it, and the rest is on its own page.
          </p>
          <div class="home-acts">
            <button class="btn primary" data-act="new-song">New song</button>
            <a class="btn ghost" href="#/" data-link>All songs</a>
            ${has("renders") ? '<a class="btn ghost" href="#/renders" data-link>Renders</a>' : ""}
          </div>
        </header>

        ${topSongs.length ? `
          <section class="section">
            <div class="section-head"><h2>Songs you keep opening</h2></div>
            <div class="home-grid">
              ${topSongs.map((song) => `
                <a class="home-card" href="#/song/${song.id}" data-link>
                  ${J.cover({ title: song.title, className: "home-art",
                              url: song.artwork_id
                                ? `/api/artwork/${song.artwork_id}/image` : null })}
                  <span class="home-card-name truncate">${J.esc(song.title)}</span>
                  <span class="home-card-sub">${song.version_count
                    ? `${song.version_count} version${song.version_count === 1 ? "" : "s"}`
                    : "no renders yet"}</span>
                </a>`).join("")}
            </div>
          </section>` : ""}

        ${topAlbums.length ? `
          <section class="section">
            <div class="section-head"><h2>Albums you keep opening</h2></div>
            <div class="home-grid">
              ${topAlbums.map((album) => `
                <a class="home-card" href="#/album/${album.id}" data-link>
                  ${J.cover({ title: album.title,
                              url: album.has_cover ? `/api/albums/${album.id}/cover` : null,
                              className: "home-art" })}
                  <span class="home-card-name truncate">${J.esc(album.title)}</span>
                  <span class="home-card-sub">${album.song_count || 0} song${
                    album.song_count === 1 ? "" : "s"}</span>
                </a>`).join("")}
            </div>
          </section>` : ""}

        ${!topSongs.length && !topAlbums.length ? `
          <section class="section">
            <div class="empty">
              <h3>Nothing here yet</h3>
              <p>This fills up on its own: whatever you open most ends up on this screen.
                 Nothing is counted retrospectively, so a library that has been going a
                 while starts from now.</p>
            </div>
          </section>` : ""}

        ${releases.length ? `
          <section class="section">
            <div class="section-head">
              <h2>What is new</h2><span class="grow"></span>
              <span class="tag">v${J.esc(J.state.version || "")}</span>
            </div>
            ${releases.map((release) => J.devlog.entry(release)).join("")}
          </section>` : ""}
      </div>`;

    root.addEventListener("click", (e) => {
      const act = e.target.closest("[data-act]");
      if (act && act.dataset.act === "new-song") J.newSong();
    });
  },
};
