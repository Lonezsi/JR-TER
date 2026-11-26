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
   (`web/plugins/`), reached from a Plugins tab on the song (built in `ui/src/views/song/PluginsTab.svelte`),
   with "missing here" from `installed`.
3. **Say what is missing. Done in the CLI.** `jriter-cli plugins` looks in the usual VST2/VST3
   folders (plus `vst_folders` in client.json, or `--vst-folder DIR`) and marks each VST
   "missing here" (JSON: `installed`), matching by path, file name or plugin name
   (`VstFolders.java`). The web page from step 2 shows it. Original idea: compare a project's VSTs with the ones installed on this PC (the
   desktop app can look in the usual VST folders) and show "missing here".
4. **Play in the DAW. Done in the browser (4.27.0).** Real VSTs need a native host, but the web has its own
   plugin format, Web Audio Modules (WAM 2). In the DAW mixer, `+ Plugin` adds an insert that loads one from an
   address (https, or a path on this server). The first time, press **Allow** for the site: nothing loads from a
   site you have not allowed, because a plugin is someone else's code running in the page (the allow-list lives in
   your browser's localStorage, `jriter.daw.plugins.allowed`, not in the song). **Open** shows the plugin's own
   window; closing it saves the plugin's settings in the song (`state`, up to 64 KB). Bounce waits for plugins to
   load and says if one was left out. Code: `web/daw/wamhost.js`, `mixgraph.js`, `mixerview.js`; the WAM host SDK is
   vendored in `web/daw/vendor/wam/` (see its README). Not tried against a real WAM plugin yet, only a stand-in
   (`test-gain.js`). Hosting actual VST files is still only a native-host idea, worth it only if WAM is not enough.
5. **Play a part through a real VST. Done on the PC (4.29.0).** `jriter-cli vst render PLUGIN song.mid`
   plays a MIDI (or a .wav, with `--midi` to play it too) through an installed VST with the free
   command-line host [Plugalyzer](https://github.com/CrushedPixel/Plugalyzer/releases) (VST3; VST2 only
   if Plugalyzer loads it). Tell the app where it is once with `jriter-cli vst path "C:\...\plugalyzer.exe"`
   (it also looks on PATH and in `%LOCALAPPDATA%\Programs\plugalyzer`); `jriter-cli vst list` shows what is
   installed, and PLUGIN is a name from that list or a path. MIDI alone gets a silent input as long as
   the MIDI plus `--tail` seconds (default 2). `--param NAME:VALUE` sets plugin parameters. The WAV
   lands in Renders with the plugin on it (`--no-send` keeps it as a file). The DAW round trip: More >
   Save as .mid, `vst render`, then Browser > Renders, drag it onto the Layout. Code: `VstHost.java`.
   Tested with a stand-in host only, not with Plugalyzer or a real plugin.
