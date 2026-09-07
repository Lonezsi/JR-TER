/* The page behind the rail.
 *
 * Reached by pulling the rail past its stop and holding, which is a gesture nobody
 * discovers by accident and that is the point: it is not part of the library, it is the
 * way out of it. It will become the way to the other things on this server, and for now
 * it is an introduction with nothing written in it yet.
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
        <div class="about-mark" aria-hidden="true">
          <svg viewBox="0 0 12 30" width="26" height="64" focusable="false">
            <path d="M8.5 2 L3.5 9.5 L8.5 15 L3.5 21" fill="none" stroke="currentColor"
                  stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M3.5 21c3.2.6 4.9 2.4 4.9 4.6 0 1.6-1 2.6-2.4 2.6" fill="none"
                  stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>
          </svg>
        </div>

        <h1 class="about-title">JR!TER</h1>
        <p class="about-slogan">please post for the world to see</p>

        <!-- The placeholder is marked as one on purpose. A lorem ipsum that reads like
             prose is a placeholder that ships, and this is a page whose whole content is
             going to be written by hand. -->
        <div class="about-dragons">
          <h2>Here be dragons</h2>
          <p>
            This is where the about me goes. Nothing here is written yet.
          </p>
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
