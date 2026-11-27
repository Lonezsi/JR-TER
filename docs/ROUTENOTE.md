# Releasing an album to RouteNote

The owner signs in to RouteNote themselves, so the agent that fills in the release runs on the
**owner's PC** (Claude Code driving their own Brave through the brave-bridge tools), never on
the server. It stops at the final review screen and presses submit only after the owner says OK.

Steps, each useful alone:

1. **The release page. Done.** `/release.html?album=ID` (code in `web/release/`). Shows the
   album, takes the details a store asks for (artist, date, genre, label, credits, explicit per
   track), warns about likely rejections (no cover, cover under 3000x3000 or not square, lossy
   mixes, no mix) and downloads a **release card** `jriter-release-ID.json` plus the cover and
   each song's current mix into Downloads. The card explains itself (its `about` field is the
   agent's recipe, the only copy is `web/release/card.js`). No backend change: it uses
   `/api/albums/ID`, `/api/albums/ID/cover` and `/api/versions/ID/download`.
2. **One click. Done, untested on the PC.** "Hand to Wh;le" downloads, then opens
   `jriter://release/ID`. `jriter-cli shell install` registers that link (HKCU only); the desktop
   app answers with `jriter-cli url jriter://release/ID`, which runs `jriter-cli release ID`:
   waits for the card and files in Downloads, then opens a terminal running `claude` on them.
   Needs Claude Code (`claude`) on the PC's PATH.
3. **The button on the album page.** Waits for the Svelte `ui/` source; until then it is the page
   above. The button should only link to `/release.html?album=ID`.
4. **The release on the album. Done.** Albums have `released_at`, `store_link` and `upc` (PATCH
   `/api/albums/ID`; link https:// only, UPC 12-13 digits, empty clears). The Released box on
   the release page saves them; the card's recipe tells the agent to fill it after the submit
   (only the date while RouteNote has no UPC yet).

Not decided for the agent: pricing, territories, release tier. It must ask.
