# Working on JR!TER

**Every change is a release.** When work lands, bump the version by adding a dated entry at
the top of `jriter/devlog.json` (minor for features, patch for fixes; a title and 2-5 plain
notes written for the owner). The top entry *is* `jriter.__version__`, and the app shows the
list as the "what's new" popup and in Settings. No entry, no release. Updating the host
restarts the server when `.py` files or `devlog.json` change, so a note-only release still
shows its version.

**Branches.** `main` is the source (Python server, Spring server in `server/`, desktop app,
old vanilla `web/`). `live-4.3.0` is what the host runs: the same Python plus the built Svelte
UI in `web/assets/`. The host's updater follows the branch its checkout is on (`live-*`), so
never rename it. Put every release on both: commit on `main`, then bring the files to
`live-4.3.0` (`git checkout main -- <paths>` or cherry-pick), push, and `git pull` in
`C:\JR-TER`.

**The built bundle.** `ui/` (Svelte source) is not in this repo. If the bundle in
`web/assets/` has to be hand-patched, give the patched file a new name (hash of its content)
and update `web/index.html`: assets are served `immutable` for a year.

**The DAW.** `web/daw.html` and `web/daw/` are plain ES modules with no build step. The plan
is in `docs/DAW.md`. `node --test tests/daw/*.test.mjs` runs its tests. `node tests/daw/e2e.mjs` drives the page with real touch events in an emulated phone
(needs Edge or Chrome); run it before shipping anything that touches the DAW's UI, because screenshots
can't tap. Screenshots missed two phone bugs that it found.

Never touch `data/`. Back up what you replace.
