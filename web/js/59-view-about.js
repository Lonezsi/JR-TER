/* The page behind the rail.
 *
 * Reached by pulling the rail past its stop and holding, which is a gesture nobody
 * discovers by accident and that is the point: it is not part of the library, it is the
 * way out of it. It will become the way to the other things on this server, and for now
 * it is an introduction.
 *
 * A view like any other, so it is in J.views and the router resolves #/about to it
 * without a special case, and it inherits the page foot and the wash for free.
 */
"use strict";

J.views.about = {
  title: "About",
  async render(root) {
    root.innerHTML = `
      <div class="section about">
        <div class="about-top">
          <!-- Served straight off the disk out of web/img, so swapping the photograph is
               replacing one file. An svg stands in until then: a real element that lays
               out and sizes correctly, rather than a broken image icon and a hole in the
               layout of the size the photo will be. -->
          <img class="about-photo" src="/img/about.svg" alt="Lonezsi"
               width="400" height="500">

          <div class="about-intro">
            <h1 class="about-title">Lonezsi</h1>
            <p class="about-slogan">please post for the world to see</p>
            <p class="about-blurb">
              Hey I&rsquo;m Lonezsi! I built this app to make me post more and make it a
              bit easier to put music together.
            </p>
            <p class="about-links">
              <a href="https://www.instagram.com/it.is.me.jozsef/" target="_blank"
                 rel="noopener noreferrer">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none"
                     stroke="currentColor" stroke-width="1.9" stroke-linecap="round"
                     aria-hidden="true" focusable="false">
                  <rect x="3" y="3" width="18" height="18" rx="5"/>
                  <circle cx="12" cy="12" r="4"/>
                  <circle cx="17.2" cy="6.8" r="1.1" fill="currentColor" stroke="none"/>
                </svg>
                @it.is.me.jozsef
              </a>
            </p>
          </div>
        </div>

        <div class="about-later">
          <h3>Later</h3>
          <p>
            This page becomes the way to everything else running on this server. There
            are more projects than this one and no single door to them, which is what
            this will be.
          </p>
        </div>

        <a class="btn ghost sm" href="#/" data-link>Back to the library</a>
      </div>`;
  },
};
