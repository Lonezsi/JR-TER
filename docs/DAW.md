# Where the DAW is going

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
5. **Sampler and audio clips. Done in 4.9.0.** A take, vocal take or waiting render from the library
   becomes a sampler track (`instrument: "sampler"`, with a `sample` on the track). The Sampler tab
   (Alt+7) lists the library's sounds, draws the waveform, trims it by dragging the ends, and
   chops it: Chop 4/8/16 or hold on the waveform to add or remove a cut; then root plays piece 1,
   root+1 piece 2, and so on (no cuts: every key plays it, pitched). Place puts it on the Song tab
   as an audio clip (a clip with `track` instead of `pattern`), through the track's mixer strip.
   Code: `web/daw/sampler.js` (model and maths, tested), `library.js` (asks `/api/songs`, versions,
   vocals, renders), `samplerview.js`. Not yet: audio from your own computer, stretching clips to the tempo.
6. **Automation and more script. Done in 4.10.0.** Automation lanes on the Song tab: "+ Automate" lists
   every knob (a track's volume, pan, sends and each insert effect setting, the master, the two buses);
   tap a lane to add a point, drag it, hold it to delete it, arrows on a focused point. Playback feeds the
   mixer the value at the playhead every tick. Code: `web/daw/automation.js` (model and maths, tested),
   `autolanes.js` (the lanes). The song format is v7: `automation`. Script additions in `script.js`:
   `euclid HITS of STEPS step X [rotate Y]`, `scale minor D` with `snap`, `shift`, `degree`, and
   `use "Kick" as kick` with `playing`, `starts`, `lowest`, `highest`. Three scripts ship for them.
7. **Into the song.** A DAW tab in `ui/` once the Svelte source is here. Bouncing the project
   makes a render, so it becomes a version of the song with the project text stored beside it.
8. **Together.** A friend opens the same project and edits live, a cursor per person.

The project format is `jriter-daw` JSON (version 7; see `web/daw/midi.js` `songToText`). Old
files keep opening: a version 1 or 2 file becomes one pattern (a version 3 file has no clips), and gets the default chords and scripts if it has none.
