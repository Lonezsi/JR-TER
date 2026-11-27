# JR!TER look audit (Look 1)

Measured 2026-11-27 against `foyer/shared/glass.css`. This is the list Look 2 works from:
every fault names the screen, the element, what is off (with the measured value) and the
Foyer value it should use. Nothing here is a matter of taste: each line has a number.

## How it was measured

- Source: the `ui/` build of `main` (`JRITER_OUT=<tmp> npx vite build`, plus `web/daw.html`,
  `web/daw/`, `web/fonts/`, `web/img/` copied beside it), served by `tools/dev.py` with
  `JRITER_WEB=<tmp>` (seeded library, no door). The live site runs a hand-patched older
  bundle, so a few details may differ there.
- Headless Edge, 390 px (mobile) and 1280 px wide, dark and light (set through the browser's
  `prefers-color-scheme`, since the theme is "auto"). 20 screens x 4 = 80 shots: songs, albums,
  playlists, one song with each tab (words, arrange, sound, renders, release, plugins),
  one album, one playlist, settings (list, account, library, appearance), inbox, grave,
  login, DAW. All 80 rendered (none blank). Images are not committed.
- On each: `tools/layout-audit.js` (spacing off the scale, clipping, overlap, small hit
  targets, horizontal scroll) plus a probe of computed radii, font sizes and panels
  without glass. Then every shot was looked at.
- The song tab is called "Renders" in the UI (route `/takes`).

## The Foyer values (reference)

| what | Foyer token |
|---|---|
| spacing | `--s1..--s8` = 4 8 12 16 20 28 40 56 px |
| radii | `--r-sm` 9, `--r-md` 13, `--r-lg` 18, `--r-xl` 24, `--r-pill` 999 |
| glass | `--glass` / `--glass-2`, `--glass-line`, `--glass-filter` / `--glass-filter-thin`, `--edge-top`, `--glass-shadow` |
| lines | `--line` 9%, `--line-2` 16% |

`glass.css` has **no type scale and no light mode**. For text the reference is JR!TER's own
scale in `ui/src/styles/base.css` (`--t-xs` 11, `--t-sm` 12.5, `--t-md` 14, `--t-lg` 16,
`--t-xl` 20, `--t-2xl` 28, `--t-3xl` clamp 30-46), and for light mode
`:root[data-theme="light"]` in the same file. Faults below say which one they use.

What already matches: nothing scrolls sideways except where listed, the glass panels on
library, settings, inbox and login are drawn with the shared tokens, light mode is coherent on
every screen, and the tab bar keeps its size from page to page.

## Everywhere (seen on most screens, both widths, both themes)

- **Segmented control** (`ui/Segmented.svelte`, `.seg.md`, the tab bars on library, song,
  inbox): padding 3px on all sides (seen on 44 of 80 shots). Use `--s1` (4px).
  `.seg.sm` has the same 3px.
- **Segmented tab thumb / tab pill** (`.tab`, `button.tab`): radius 19px. Use `--r-lg` (18px),
  or `--r-pill` if it is meant to be a pill. The stacked variant uses 15px (`Segmented.svelte:95`):
  use `--r-md` (13px).
- **Segmented badge** (`Segmented.svelte:96`): padding `0 5px`, font 10px. Use `0 var(--s1)` or
  `0 var(--s2)` and `--t-xs` (11px). The shell tab badge (`Shell.svelte:491`) also sets 10px:
  use `--t-xs`.
- **Segmented button gap** (`button` inside `.seg`): column and row gap 7px (34 shots), 3px
  row gap on stacked tabs. Use `--s2` (8px) and `--s1` (4px).
- **Segmented button padding**: left/right 14px (30 shots). Use `--s3` (12px) or `--s4` (16px).
- **Cover tiles** (`ui/Cover.svelte`, `.cover` in song rows, album tiles, sidebar): radius 5px,
  7px or 10px depending on size (42, 36 and 8 shots). Use `--r-sm` (9px) for the small ones
  and `--r-md` (13px) for the 40px and up. The CD-case parts of the album art (`.face`,
  `.lid`, `.tray`) are 5px on purpose, so leave those; an album cover is a
  physical object.
- **Cover letter** (`Cover.svelte .letter`): 92px, 101px, 106px, 65px depending on cover size,
  none on the type scale. It is artwork, not text, so it can stay; pick `--t-3xl` steps if
  it should follow the scale.
- **Avatar initial** (`Sidebar.svelte .avatar`, 13px): use `--t-md` (14px) or `--t-sm` (12.5px).
- **Song title in lists** (`span.truncate`, 19px, 36 shots): use `--t-lg` (16px) or `--t-xl` (20px).
- **Small label type** (`span` 10.5px, 38 shots; `span.badge` 10px): use `--t-xs` (11px).
- **Keyboard keys** (`kbd`, `base.css:139`): radius 6px. Use `--r-sm` (9px).
- **Waveform strip in rows** (`span.wave`, `a.all` in the sidebar): radius 8px and 6px.
  Use `--r-sm` (9px).
- **Spacing 5px / 6px** in `.rsep` margins (12px of margin in the words tab) and `.plart` (5px, 6px):
  use `--s1` or `--s2`.

## Library, albums, playlists (390 and 1280)

- **Library page, 1280, dark and light**: the song list's version and length columns sit at
  x=1070..1140 while the page is 292..1250 wide, leaving about 500px of empty row between
  the title and the numbers. Cap the row width with `--content-max` or align the columns to
  the right edge of the page.
- **Album and playlist hero, 390**: `button.art` and `button.icon-btn.sm` (the pencil)
  overlap by 20x20px. Move the pencil inside the cover by `--s2` or give the cover
  `--s2` of margin.
- **Album and playlist hero, 390**: `span.heroshape` margin-right 22.4px and 35.2px. Use
  `--s5` (20px) and `--s6` (28px).
- **Album and playlist hero** `button.grip` is 24x36 and `input.year` 32x19: both under the
  40px finger target on touch (`layout-audit` "small"). Use 40px height (`--s7`).
- **Playlists page**: `span.plart` margin-top 5px, margin-right 6px. Use `--s1`/`--s2`.
- **Albums page**: `div.frame` margin-right 26.75px and 27.36px. Use `--s6` (28px).

## Song page

- **Song hero**: fine at both widths. Cover radius uses the album-art radius, matching.
- **Words tab, `.rt` (rich-text buttons)** (`WordsTab.svelte:580`): radius 10px, and
  `.rtool` 14px (12 shots each). Use `--r-sm` (9px) for the buttons and `--r-md` (13px)
  for the toolbar.
- **Words tab, `textarea.edit`**: margin-left 78px and 96px (the gutter). Use `--s7` (40px)
  plus `--s8` (56px) as the token pair, or keep one `--gw` value from the scale (56px).
- **Words tab, `textarea.de.c` / `span.tag` / `span.flag`**: radius 6px. Use `--r-sm` (9px).
- **Words tab, `.letter`** (rhyme letters): radius 5px, padding off scale. Use `--r-sm`.
- **Words tab / About / Plugins, `article.card.sheet`** (950x502 at 1280, 358x498 at 390):
  background `rgba(255,255,255,0.07)` with no backdrop filter. The other cards on the page use the
  glass. Use `var(--glass)` with `--glass-filter-thin` and `--edge-top`.
- **Arrange tab, 390**: the transport row (`div.group.transport`, `div.snap`) sticks out of
  `div.head` by 149px, and `div.inner` is 483px in a 334px box. The header needs
  `flex-wrap: wrap` with `gap: var(--s2)` below 640px.
- **Arrange tab, 390 and 1280**: `button.on` / `button` padding 10px, 11.5px font, 24px tall
  (38x24, 45x24 hit targets). Use `--s3` padding, `--t-sm` (12.5px) and 40px on touch.
- **Arrange tab, `div.trace`** (334x72, 918x84): background `rgba(0,0,0,0.26)`, no glass. Use
  `--surface-2` or `--glass` over `--r-md`.
- **Sound tab, 390**: `button.link.add` and `span.arrow` stick out past the right edge
  (scrolls horizontally). Wrap the effect chain (`flex-wrap`) or let it scroll inside its
  own box.
- **Sound tab, `div.wrap`** (the EQ canvas, 326x232 and 918x302): background
  `rgba(0,0,0,0.38)`, no glass. Use `--surface` (dark) or the light theme's inset token.
- **Sound tab, `div.pills`**: margin-left 38.6px and 630.6px (auto-margins from a flex row
  with leftover width). Use `margin-left: auto` or a gap, not a measured value.
- **Sound tab, `button.power`** (22x22) and the `.slots` row-gap 3px: use 40px target on
  touch, `--s1` for the gap.
- **Sound tab, `button..lot`** (the A/B slot): radius 15px. Use `--r-md` (13px).
- **Renders tab, 390**: `div.devices` sticks out of `div.controls` by 110px, with
  `button.field.dropdown-field` and `label.dev` also wider than the window. The row needs
  `flex-wrap: wrap`; the `html[data-narrow] .devices {width:100%}` rule at
  `VocalsPanel.svelte:252` does not win here.
- **Renders tab, `div.devices` 1280**: margin-left 330.9px (auto margin). Use `--s5`.
- **Renders tab, `button.name.truncate`** is 138-140 x 20: under the hit size. Use 40px
  height on touch (`--s7`).
- **Renders tab, `span.tag`**: radius 6px. Use `--r-sm`.
- **Release tab, `div.card.block`** (950x100 .. 950x403, 358x132 .. 358x544): background
  `rgba(255,255,255,0.07)` with no backdrop filter. Use `var(--glass)`.
- **Release tab, `button.pill`** (298x62, 318x62): background 6% white (dark) and 6% ink
  (light), no border or filter. Use `--glass-2` and `--glass-line`.
- **Release tab, `textarea.field`**: background `rgba(0,0,0,0.28)`. Use `--surface-2`.

## Settings (list, account, library, appearance)

- **Appearance, `div.t fontname`**: font 19px. Use `--t-lg` (16px) or `--t-xl` (20px).
- **Appearance, `div.seg.sm`**: padding 3px (see Segmented). Use `--s1`.

## Inbox

- **Inbox, 1280 and 390**: `span.tail.row` margin-left 66.2px and 275.9px, auto margins.
  Use `margin-left: auto`.
- **Inbox, `button.chk`** is 22x22, under the 40px finger target. Use `--s7` of hit area
  (a transparent padding around the 22px circle is enough).
- **Inbox, `div.seg.sm`**: padding-top 3px. Use `--s1`.

## Grave

- **Grave, 1280**: `div.page.grave` has `max-width: 900px` (`Grave.svelte:78`) and is centred,
  so its left edge is at x=345 while every other page starts at x=292 (margin 53px). Use the
  shared `.page` width (`--content-max`) so the heading lines up with the library's.

## Login

- **Login, 390 and 1280**: `input.field` padding-top/bottom 10px. Use `--s3` (12px) so the
  fields match the buttons (the page's own `button.btn.primary` is 13.5px type: use `--t-md`).
- **Login, `label`** gap 6px, `h1` gap 7px. Use `--s2` and `--s1`.
- **Login**: footer text `a` and `p.note` are 12px, and the body copy is 14px with a
  size off the scale: use `--t-sm` (12.5px).

## DAW (`/daw.html`, own stylesheet `web/daw/daw.css`)

- **DAW, 390**: 12 pairs of `button x button` overlap (the toolbar, 11x27 up to 40x27), and
  the mixer routing buttons `button.mx-route` are 20x14. Space the toolbar with `gap: var(--s1)`
  and make the routing buttons at least 40px high on touch.
- **DAW, both widths**: hit targets of 16x18, 18x16, 33..57 x 24 (10 shots at 1280). Use
  28px minimum with a pointer, 40px on touch (`layout-audit.js` limits).
- **DAW radii**: buttons 8px, inputs 8px, `button.dd` 8px, small chips 3px and 4px, `header.bar`
  20px, `section.help` 12px, `button` 14px. Use `--r-sm` (9px), `--r-md` (13px), `--r-lg` (18px).
  `header.bar` should be `--r-xl` (24px) like the main app's top bar.
- **DAW type**: 9px (`span.mx-num`, `span.mx-lim`, `button`), 9.5px (`span.mx-db`),
  10px (`span.lb`, `span.l-n`), 10.5px, 12px, 13px. Use `--t-xs` (11px) and above.
  Nothing should be under 11px.
- **DAW spacing**: `button` gap 6px, `div.mx-mid` gap 3px, `div.sv-doc.sp-note` padding-left
  36px, `button` padding 10px and 6px, `div.grp.set` margin-left 266px (auto). Use `--s1`,
  `--s2`, `--s3`, `--s7` (40px).
- **DAW panels**: the dock panels (Browser, Layout, Mixer) are flat dark rectangles with
  a 1px line and no `--edge-top` or `--glass-shadow`, unlike the glass top bar. Give the docks
  `var(--glass)`, `var(--glass-filter-thin)`, `var(--glass-line)` and `var(--edge-top)`.

## For Look 2, in order

1. The segmented control and its badge (one file, `Segmented.svelte`, fixes 44 of 80 shots).
2. Cover radii and the 19px/10.5px/10px type strays (`Cover.svelte`, `Sidebar.svelte`, rows).
3. The 390px overflows: Arrange header, Renders devices row, Sound chain.
4. Cards without glass on the song tabs (words, release, about, plugins).
5. Hit targets under 40px on touch: grip, chk, power, year, DAW toolbar.
6. Grave width, inbox/pills auto-margins.
7. DAW: radii, type under 11px, dock panels onto the glass tokens.
8. Login spacing.
