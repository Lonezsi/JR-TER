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
2. **Channel rack and step sequencer.** Channels with 16-step rows, swing, per-step velocity
   and pitch. A pattern holds both steps and piano-roll notes; patterns 1..n with a picker.
3. **Playlist / song mode.** Pattern clips on lanes along a timeline: drag, cut, repeat-drag.
   Play one pattern or the whole song.
4. **Mixer.** An insert per channel with Web Audio effects (EQ, compressor, delay, reverb from
   a generated impulse, distortion), sends, a master limiter, meters.
5. **Sampler and audio clips.** Any render or vocal take in the library becomes an instrument
   or a clip, chopped from its waveform. FL can't reach your songs; this can.
6. **Automation and more script.** Automation lanes for any knob. The pattern script exists
   (step 1b); next: `euclid`, scales, and scripts that read other tracks.
7. **Into the song.** A DAW tab in `ui/` once the Svelte source is here. Bouncing the project
   makes a render, so it becomes a version of the song with the project text stored beside it.
8. **Together.** A friend opens the same project and edits live, a cursor per person.

The project format is `jriter-daw` JSON (version 2; see `web/daw/midi.js` `songToText`). Old
files keep opening: a version 1 file gets the default chords and scripts.
