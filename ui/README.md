# JR!TER interface

The browser side of JR!TER: Svelte 5 (runes), TypeScript, Vite. The server (`../jriter`,
standard library Python) is unchanged in shape and serves what this builds.

```
npm run build      build into ../web-next (a scratch build, ignored by git)
npm run ship       build into ../web: the committed bundle the server serves
npm run check      svelte-check, must stay at 0 errors and 0 warnings
npm run dev        hot reload on 5173, proxying /api to JRITER_SERVER (default :7900)
python ../tools/dev.py --keep     a throwaway seeded library on :7911, no sign in
```

`../web/js` and `../web/css` are the previous interface (plain concatenated JS). They are
the reference for behaviour until every screen here has replaced its counterpart, and
their comments record why each thing is the way it is: read them before porting a
feature, and keep the lesson, not the code.

## What this rebuild is for

1. **Merge what was split.** The old app grew a screen per module. Things that are one
   idea are one surface here: renders + watched folders + uploads are the **Inbox**;
   arrange + compositor + lyric cards + vocal takes share one **timeline** on the song;
   equaliser + limiter + presets + vocal effects are one **Sound** tab; YouTube and
   sharing are the song's **Release** tab; account + people + appearance + updates are
   **Settings**; songs + albums + playlists + shared-with-me are scopes of **Library**.
2. **A power user's tool.** Never remove a control, an option or a piece of information
   the old interface had. Make the common path one press and keep everything else one
   level down (a menu, a disclosure, a tab), never gone. Everything has a context menu,
   everything reachable by keyboard, every list sortable where the old one was.
3. **Smooth.** Optimistic updates; an edit never looks like a page load; nothing jumps
   when data lands (skeletons in the right shape); motion is short and on `--spring`.
   Destructive things that can be put back are done at once with an Undo toast; only
   what cannot be undone asks first.

## Design language: glass

Dark only. ONE material for every surface: a light film (`--glass`) and a 1.5px gradient
edge that runs along the border (`--edge-line`), both in `src/styles/base.css`. Every
surface is `.glass` (floating panes), `.glass-2` (what opens over other glass: menus,
sheets, the palette) or `.card` (a block inside a screen). Nothing else may look like a
surface.

What is BEHIND the floating panes is drawn by one WebGL2 shader (`src/lib/glass`): the
song's artwork, blurred and graded, with the drifting particles; under each pane that
picture is blurred again and split into red, green and blue at the rim (the chromatic
aberration). It works from the picture, never from the screen, which is why a hover cannot
make it flicker. Panes register with `use:pane`; their film, edge and shadow stay CSS, so a
pane looks the same with or without the shader. Never put `backdrop-filter` on a pane: it
re-reads the screen on every repaint and is what flickered for months
(`tests/test_glass_flicker.py` enforces this). The Backdrop blur setting (per browser) can
choose Off, or the browser's own blur (Soft, Full) for anyone who prefers it. Without
WebGL2 the CSS ground in `shell/Ground.svelte` and the 2D dust in `lib/ambient.ts` are used.

- Floating panes are `.glass` (big radius, hairline border, lit top edge). Things over
  glass (menus, sheets, popovers) are `.glass-2`. Content inside a scrolling screen uses
  `.card` (no backdrop blur: blur inside a scrolling list is too expensive).
- Shapes are capsules and large radii (`--r-pill`, `--r-xl`, `--r-lg`, `--r-md`).
- One accent, `--accent` (it follows the music; derive tints with `--accent-soft`,
  `--accent-line`, never hard-code a colour). Text is `--text`, `--text-2`, `--text-3`.
- Type: `--font` (Manrope) for everything, `--display` only for titles (h1-h3, wordmark).
  Numbers that change or line up get `.num`.
- Spacing only from `--s1..--s8`. Timings only from `--fast`, `--med`, `--slow`,
  `--sheet`, with `--spring` / `--ease` / `--pop`.
- Screens are `<div class="page">` with `.page-head`, sections with `.section-head`.
  Use the global classes: `.btn` (`.primary .tint .ghost .danger .sm .lg`), `.icon-btn`,
  `.play-btn`, `.field`, `.label`, `.chip`, `.tag`, `.badge`, `.list` + `.item`,
  `.group` + `.setting`, `.empty`, `.notice`, `.sk` (skeleton), `.dropping`, `.eyebrow`,
  `.row .col .grow .truncate .muted .faint .num`.
- Works from 360px wide to ultrawide. `shell.narrow` (≤900px) is the phone layout; touch
  targets are at least 40px (`@media (pointer: coarse)`). Respect
  `prefers-reduced-motion`.
- Icons only through `$ui/Icon.svelte` (add a path to its table when one is missing).
  No emoji, no icon fonts, no one-off inline SVG icons.
- Copy is plain, short, lower-key, and says what happened. Keep the old interface's
  wording where it had good wording. No exclamation marks.

## The foundation (use it, do not reinvent it)

| import | what |
|---|---|
| `$lib/api` | `get post put patch del upload uploadWithProgress attempt u guest ApiError`. `attempt(fn, okMessage?)` toasts a failure and returns null. `u(path)` rewrites an owner's `/api/...` address while guesting on a share: use it for every `src=`/`href=` to song audio or artwork. |
| `$lib/app.svelte` | `app` (name, version, modules, settings, summary), `has(module)`, `ownsTheMachine()`, `me()`, `saveSettings(patch)`, `refreshState()`. Every feature is gated on `has("module")`. |
| `$lib/router.svelte` | `router.route` ({view, params, hash}), `go(path)`, `replace(path)` (no history entry: tabs, filters), `href.*` builders. Hash routing. |
| `$lib/bus` | `emit(name, detail?)`, `on(name, fn)` → stop fn, `onAny`. Typed event names (add to `Events` when you need one). Emit after every change another screen might show. |
| `$lib/resource.svelte` | `resource(() => get(...), { on: [events] })` → `{data, loading, error, reload(), set()}`. Keeps old data on screen while refreshing. |
| `$lib/dialog.svelte` | `sheet({title, sub, fields, body, props, confirm, cancel, danger, wide})`, `confirm(title, sub, yes, no)`, `prompt({...})`. Promise-based; `body` is a component that receives `close(value)`. |
| `$lib/menu.svelte` | `use:contextMenu={() => items}` (right click + long press), `showMenu(items, {anchor} \| {x,y})`. Items: `{label, icon, hint, run, danger, disabled, checked, items}`, `{divider:true}`, `{group}`; falsy entries are dropped. |
| `$lib/toast.svelte` | `toast(message, "bad"?, {label, run}?)`. The third argument is an Undo action. |
| `$lib/commands` | `useCommands(() => Command[])` contributes to the Ctrl+K palette while mounted. Every screen should offer its main actions. |
| `$lib/sort.svelte` + `$ui/SortPick.svelte` | per-list remembered sorting. |
| `$lib/player.svelte` | `player` (reactive state), `playSong playRender playEntry play toggle step seek seekTo now setSlot switchTo swap enqueue prime presetEdited coverOf arranged canCompare setArranger`. |
| `$lib/audio/engine` | the two-deck Web Audio engine (`engine`, `SLOTS`, `Slot`, `FLAT`). |
| `$lib/look.svelte` | `accent.viewing(song, cover)`, `accent.hold/preview/release`, `setGround(url, hue)`, `applyLook`, `wearFont`. Song, album, playlist and share screens call `setGround` + `accent.viewing` once loaded. |
| `$lib/actions` | `newSong newAlbum newPlaylist copyText backAgain updateNow`. |
| `$lib/util`, `$lib/color`, `$lib/types` | formatting (`time bytes when ymd date plural hue`), `debounce`, `store` (safe localStorage), `fuzzy`; colour maths; server shapes. |
| `$ui/*` | `Icon Cover Wave Segmented Switch Slider Scrubber SortPick` (+ hosts mounted by the shell). |
| `src/views/song/song.svelte.ts` | `SongStore`, `provideSong`, `useSong()`: the song screen's shared state, including the page's A/B decks. |

Screens live in `src/views/<Name>.svelte` and receive `params: Record<string,string>`
(the route's params). A screen that is one address with tabs keeps the tab in the hash
via `replace()` so it survives reload and Back.

## Rules for code

- Svelte 5 runes only (`$state $derived $effect $props $bindable`), `<script lang="ts">`,
  snippets not slots, `onclick=` not `on:click`. No stores, no `export let`.
- Shared state lives in `*.svelte.ts` modules. Never name one the same as a component
  in the same folder apart from case (Windows resolves `./shell.svelte` to
  `Shell.svelte`).
- Scoped `<style>` in components; global classes only from `src/styles`.
- No new dependencies. No `{@html}` with anything a user or the server wrote (the old
  markdown renderer must become elements, or escape first).
- Canvas work (equaliser, timeline, meters) draws at `devicePixelRatio`, reads colours
  from CSS variables, and stops its animation frame when hidden or unmounted.
- Comments say why, briefly. Carry over the reasons recorded in the old file's comments
  when they still apply; do not carry over history.
- Run `npx svelte-check --tsconfig ./tsconfig.json` and fix every error and warning in
  the files you own before finishing. Other people's files may be mid-edit: ignore
  errors that are not in yours, and never edit a file you do not own.
