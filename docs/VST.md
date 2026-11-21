# VST support

A browser cannot load VST plugins, and hosting them for real needs native code (C++, JUCE).
So VST support in JR!TER comes in steps, each useful alone.

1. **Know a project's plugins. Done.** `jriter-cli plugins X.flp|FOLDER [--json]` reads an FL
   project and lists its VSTs (name, vendor, VST2 or VST3, path) and FL's own plugins, with how
   many times each is used. Code: `desktop/.../FlProject.java`. Tested on made-up files only, so
   check it against a real project of yours.
2. **Keep the list with the song.** Send the list with each FL render (a header `X-Plugins`),
   store it on the render in both servers (`jriter/modules/renders.py`, `RendersController`),
   and show a "Plugins" box on the song. Needs the Svelte `ui/` source.
3. **Say what is missing.** Compare a project's VSTs with the ones installed on this PC (the
   desktop app can look in the usual VST folders) and show "missing here".
4. **Play in the DAW tab.** The tab from task 23 plays MIDI with browser instruments (Web Audio
   Modules are the web's version of plugins). Hosting real VSTs needs a native host inside the
   desktop app. Only worth it if the browser instruments are not enough.
