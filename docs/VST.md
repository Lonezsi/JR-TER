# VST support

A browser cannot load VST plugins, and hosting them for real needs native code (C++, JUCE).
So VST support in JR!TER comes in steps, each useful alone.

1. **Know a project's plugins. Done.** `jriter-cli plugins X.flp|FOLDER [--json]` reads an FL
   project and lists its VSTs (name, vendor, VST2 or VST3, path) and FL's own plugins, with how
   many times each is used. Code: `desktop/.../FlProject.java`. Tested on made-up files only, so
   check it against a real project of yours.
2. **Keep the list with the song. Done.** `jriter-cli render` sends the list with each FL
   render (header `X-Plugins`: JSON of kind, name, vendor, uses, and `installed` when the VST folders are
   known). Both servers (`jriter/modules/renders.py` + `versions.py`, `RendersController` +
   `VersionsController`) clean it, store it in a `plugins` column on the render, copy it onto the version
   when the render is attached, and return it as a `plugins` list in `/api/renders` and
   `/api/songs/ID/versions`. It is also in the library export. The list shows on `/plugins.html?song=ID`
   (`web/plugins/`), reached from a Plugins tab on the song (a bundle hand patch until `ui/` lands),
   with "missing here" from `installed`.
3. **Say what is missing. Done in the CLI.** `jriter-cli plugins` looks in the usual VST2/VST3
   folders (plus `vst_folders` in client.json, or `--vst-folder DIR`) and marks each VST
   "missing here" (JSON: `installed`), matching by path, file name or plugin name
   (`VstFolders.java`). The web page from step 2 shows it. Original idea: compare a project's VSTs with the ones installed on this PC (the
   desktop app can look in the usual VST folders) and show "missing here".
4. **Play in the DAW tab.** The page from task 23 (`/daw.html`, code in `web/daw/`; it becomes a song tab once `ui/` lands) plays MIDI with browser instruments (Web Audio
   Modules are the web's version of plugins). Hosting real VSTs needs a native host inside the
   desktop app. Only worth it if the browser instruments are not enough.
