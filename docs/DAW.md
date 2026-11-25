# Where the DAW is going

**The sampler dialog (4.20.0).** A sample carries `cut`, `loop`, `env` {a,d,s,r} (`ENV` in `sampler.js`),
`pitch` (semitones) and `stretch` (0.25..4; positions are then in the stretched copy, made by `stretchedOf`
in `daw.js`). `playSlice` takes `{ env, loop }` and returns a voice that `cutVoice` can stop. The editor is a
dialog at the top of the page (`.ins-scrim`, in `samplerview.js`), opened by `samplerUI.edit()`; the tab is the
Browser. `knob.js` is the one knob control (`knob()`, `wireKnobs()`). `resample` in `daw.js` renders the set
sound offline and uploads it to One-shots/Resampled.

**Plugins (4.27.0).** A Plugin effect (`wam`, in `FX_TYPES`) loads a Web Audio Module (WAM 2) from an address:
`{ url, name, state }` in the effect chain, `url` https or a path on this server (`wamUrl`), `state` the plugin's own
settings (at most 64 KB). `wamhost.js` loads it (host SDK vendored in `web/daw/vendor/wam/`) only for a site the
person pressed Allow for in this browser; `mixgraph.js` passes sound straight through until it is loaded, and
`mix.ready()` / `mix.plugins()` say how it went. The mixer card shows the address, a status, Allow and Open (the
plugin's own window, the same kind of dialog as the sampler); Bounce waits for plugins and says if one was left out.
Tests: `tests/daw/mixer.test.mjs`, and `e2e-studio.mjs` with `web/daw/vendor/wam/test-gain.js`. See docs/VST.md.

**Routing, MIDI, the runway (4.19.0).** Song format v10: any number of buses (2..16, `addBus`, `removeBus`),
a send per bus on every track, and `out` on tracks and buses (`m` or `b<i>`); `cleanMixer` sends a bus that
would loop (`loops`) to the master. `mixgraph.js` builds buses on demand and rewires an output only when it
changes. `mixerview.js`: Master, inserts, buses; the picked strip's routing arrows sit under every strip it
can feed (click: send, double-click: main output), pan and sends are knobs. The browser lists MIDI files
(`.mid`, kind `midi`, stored with the one-shots, both servers); `midiToPattern` in `daw.js` puts one into
the open pattern, a dropped-on pattern number (`.rk-pats [data-pat]`) or a fresh pattern. The roll has a
runway of two bars past the pattern (`roomLen`, `grow`). User-facing names: Rack is the Drumroll, Song the Layout.

**JR!TER's controls and the browser (4.18.0).** `web/daw/ui.js` fits the app's own controls onto the plain
HTML the views write: every `<select>` gets JR!TER's dropdown (the real select stays underneath, so `.value`
and `change` work as before), number fields get a stepper instead of the browser's spinners, sliders get the
filled track (`--fill`), and `[data-tip]` gets one readable tooltip. Since 4.28.0 `web/daw/daw.css` is the
one stylesheet (it replaced daw.css + views.css + polish.css): one glass layer for the room's panels, flat rows
inside them, the accent only for what is on or playing. Icons come from `web/daw/icons.js` (JR!TER's own
paths), never text symbols.
The Sampler is a tree (`samplerview.js`): One-shots (folders split on " / ") and Samples (waiting renders,
then each song). The pencil arranges one-shots: rename, drag to move, delete a folder (`changeSample` and
`each` in `library.js`; `PATCH /api/samples/ID` with `name`/`folder`).

The DAW (`/daw.html`, code in `web/daw/`) started as a MIDI player and a piano roll. The aim is
a studio that feels like FL Studio's workflow (rack, patterns, playlist, mixer) and is better
where a web app can be: it works with a thumb, its projects are plain text, it can be scripted,
it lives in a song's history, and it is shared on your own terms. It wears JR!TER's own glass
look, not FL's skin, and it doesn't use FL's name or art.

Every step is its own release (see `CLAUDE.md`), useful alone.

1. **Phone controls. Done in 4.4.0.** Tap, drag, resize, long-press to delete, pan with one
   finger, pinch to zoom, draw/erase/select tools, transport at the bottom, tracks as a
   strip, screen kept awake while playing. Logic in `web/daw/gestures.js` (tested).
1b. **Chord editor and note scripts. Done in 4.5.0.** The DAW opens on the chord editor
   (`web/daw/chords.js`, `chordview.js`): symbols from `C` to `C7#9b13/E`, inversions, drop 2/3,
   spread, voice leading, strum; **To MIDI** writes notes and is one way, nothing reads notes
   back into chords. The script view (`script.js`, `scriptview.js`) runs a small language of our
   own over the selected track: `each note:` / `each chord:`, `arp`, `strum`, `param` sliders.
   Six scripts ship with every song (Humanize, four arpeggios, Strum). The language is described
   at the top of `script.js`. Touch is tested for real: `node tests/daw/e2e.mjs` drives the page
   in an emulated phone (Edge needed).
2. **Channel rack and step sequencer. Done in 4.6.0.** Code: `web/daw/pattern.js` (patterns and
   steps, tested), `rackview.js` (the Rack tab). The song format is v3. Channels with 16-step rows, swing, per-step velocity
   and pitch. A pattern holds both steps and piano-roll notes; patterns 1..n with a picker.
3. **Playlist / song mode. Done in 4.7.0.** Pattern clips on lanes along a timeline: tap to place,
   drag to move, drag the end to repeat, Split, hold to delete. Play runs the pattern or the whole
   song (`S`). Code: `web/daw/playlist.js` (clips and the notes they make, tested), `songview.js`
   (the Song tab). The song format is v4: `clips` and `mode`.
4. **Mixer. Done in 4.8.0.** A strip per track: pan, two sends (Reverb and Delay buses), insert effects
   (EQ, compressor, drive, delay, reverb from a generated impulse), a master with effects and a fixed
   limiter, meters. Code: `web/daw/mixer.js` (model and maths, tested), `mixgraph.js` (the Web Audio graph),
   `mixerview.js` (the Mixer tab). The song format is v5: per-track `pan`, `sends`, `fx` and a `mixer`.
   `rack.js` is the one effects engine (a copy of JR!TER's `ui/` rack.ts + eq.ts + responseOf); the mixer moves onto it in
   the rack 2-5 tasks, and `ui/` should import it once its source is committed.
5. **Sampler and audio clips. Done in 4.9.0.** A take, vocal take or waiting render from the library
   becomes a sampler track (`instrument: "sampler"`, with a `sample` on the track). The Sampler tab
   (Alt+7) lists the library's sounds, draws the waveform, trims it by dragging the ends, and
   chops it: Chop 4/8/16 or hold on the waveform to add or remove a cut; then root plays piece 1,
   root+1 piece 2, and so on (no cuts: every key plays it, pitched). Place puts it on the Song tab
   as an audio clip (a clip with `track` instead of `pattern`), through the track's mixer strip.
   Code: `web/daw/sampler.js` (model and maths, tested), `library.js` (asks `/api/songs`, versions,
   vocals, renders), `samplerview.js`. Stretching to the tempo came in 5d.
5d. **Tempo. Done in 4.15.0.** A sampler sound can carry the tempo it was played at (`sample.bpm`, 20..400, 0 = off;
   Tempo box in the Sampler, Guess reads it from the trim as whole bars) and `sample.warp`: `time` (Keep pitch, default) or
   `pitch` (like tape). Audio clips on the Song tab then play at the song tempo; notes are not affected. `clipRate`, `guessBpm`,
   `clipPlay` in `sampler.js`; `stretch.js` is a WSOLA time-stretch, run once per sound and ratio when you press Play or
   Bounce (main thread). Existing clip lengths are not changed when you set a tempo; new clips use `clipBars`.
6. **Automation and more script. Done in 4.10.0.** Automation lanes on the Song tab: "+ Automate" lists
   every knob (a track's volume, pan, sends and each insert effect setting, the master, the two buses);
   tap a lane to add a point, drag it, hold it to delete it, arrows on a focused point. Playback feeds the
   mixer the value at the playhead every tick. Code: `web/daw/automation.js` (model and maths, tested),
   `autolanes.js` (the lanes). The song format is v7: `automation`. Script additions in `script.js`:
   `euclid HITS of STEPS step X [rotate Y]`, `scale minor D` with `snap`, `shift`, `degree`, and
   `use "Kick" as kick` with `playing`, `starts`, `lowest`, `highest`. Three scripts ship for them.
7. **Into the song. Bounce done in 4.11.0.** `/daw.html?song=ID` opens the DAW for a library song
   with its own saved project. Bounce (B, in More) renders offline (`bounce.js` writes the .wav) and
   uploads it as a new version of that song; without a song it goes to the waiting renders, and if
   the library can't take it, it downloads. The song page has a DAW tab (a hand patch of the built
   bundle until `ui/` is here). **7b, done in 4.14.0:** Bounce also saves the project text on the
   version (`versions.daw`, both servers; `GET/PUT /api/versions/<id>/daw`; the versions list only
   says `has_daw`). `/daw.html?song=ID&version=VID` or More, Bounces opens it (undoable). Not yet: an
   "Open in DAW" button on the song page's version list (needs `ui/` source).
5b. **Your one-shots, and snap. Done in 4.13.0.** Sounds you bring from your computer live in the library
   (`jriter/modules/samples.py`, Spring `SamplesController.java`, table `samples`; `GET/POST /api/samples`,
   `PATCH/DELETE /api/samples/ID`, `POST /api/samples/ID/restore`, `GET /api/samples/ID/audio`; delete only hides).
   The Sampler tab's first choice, My one-shots (`samplerview.js`, `library.js` mySamples/uploadSamples), adds files or a
   folder, filters, and makes a sampler instrument (+ Inst) or a rack channel (+ Rack, or + Sample in the rack).
   `sample.oneshot` plays the whole sound whatever the note length (`gateFor` in `sampler.js`). Snap lives in
   `web/daw/snap.js` (tested): a setting is Auto, a step or None; Auto picks the finest straight step that is still
   wide enough to hit, so it follows the zoom. It is a view setting kept in localStorage `jriter-daw-snap`
   (`roll` and `song`), not in the project. The Song tab zooms and clips sit on sixteenths of a bar (format v8).
   A guest's access to one-shots: see 8b.
8. **Together. Done in 4.12.0.** A song's project is stored on the server (`jriter/modules/daw.py`, Spring
   `DawController.java`, table `daw_projects` with a revision): `GET`/`PUT /api/songs/ID/daw` and
   `POST /api/songs/ID/daw/here` (who is in the project and their cursor, in memory, gone after 12 s).
   A save names the revision it grew from; a stale one gets the current text back and the browser joins the two
   with `web/daw/merge.js` (`merge3`, tested; the same thing changed by both: yours wins). `web/daw/together.js`
   saves 400 ms after a change and polls once a second. A friend opens `/daw.html?song=ID&share=SHARE`, which
   goes through the share's own door (`/api/shared/SHARE/on/songs/ID/daw`); their saves are in the song's
   history and can be undone. The owner's More menu lists the song's shares and copies the link.
   **8b, done in 4.16.0:** friends' cursors show on the Song tab too (`.sl-who` in `songview.js`, `people()`).
   A guest fetches sampler sounds through the share's door (`soundUrl` in `together.js`; the project keeps the owner's
   paths) and their Sampler lists only this song's takes and vocals. `GET /api/samples/ID/audio` is open to a guest
   only for a one-shot the song's DAW project uses (`sharing.py` and `SharingController.java`, kind `sample`).
   Not yet: a friend's own one-shots, and takes from the owner's other songs, in a shared song.

The project format is `jriter-daw` JSON (version 9; see `web/daw/midi.js` `songToText`). Old
files keep opening: a version 1 or 2 file becomes one pattern (a version 3 file has no clips), and gets the default chords and scripts if it has none.

Rack 2 (4.30.0): the mixer's EQ is rack.js's parametric EQ (`fx.bands`, up to 24, `cleanBands`); an old 3-band EQ converts in `cleanFx` (`oldEqBands`) and automation lanes on its low/mid/high are dropped.
