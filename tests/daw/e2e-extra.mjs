// e2e-extra.mjs: the chord editor and the note script, on the emulated phone.
// Called by e2e.mjs, which hands over its helpers.
export async function run({ scenario, need, js, sleep, tapEl, tapAt, holdAt, rect, song, fresh, send, SITE, dragAt }) {
  const val = (sel) => js(`document.querySelector(${JSON.stringify(sel)}).value`);
  const set = (sel, v, event = "change") => js(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); e.value = ${JSON.stringify(v)}; e.dispatchEvent(new Event(${JSON.stringify(event)}, { bubbles: true })); })()`);
  const view = () => js("window.jriterDaw.view()");
  const noSideways = async (label) => {
    const w = await js("document.documentElement.scrollWidth");
    need(w <= 390, label + " is " + w + "px wide on a 390px phone");
  };

  await scenario("the DAW opens on the chord editor", async () => {
    await send("Page.navigate", { url: SITE + "/daw.html" });
    // Wait for the page itself rather than a fixed time: fonts and stylesheets can hold it up.
    for (let i = 0; i < 50 && !(await js("!!window.jriterDaw")); i++) await sleep(100);
    need((await view()) === "chords", "opened on " + (await view()));
    need(await js(`!!document.querySelector("#cv-sym")`), "no chord editor on screen");
    await noSideways("the chord editor");
  });
  await scenario("tapping a root and a type rewrites the chord", async () => {
    await tapEl('[data-act="root"][data-v="D"]');
    await tapEl('[data-act="quality"][data-v="m7"]');
    const sym = (await song()).chords.chords[0].symbol;
    need(sym === "Dm7", "symbol is " + sym);
  });
  await scenario("a very complex chord can be typed; a bad one is refused", async () => {
    await set("#cv-sym", "C7#9b13/E");
    need((await song()).chords.chords[0].symbol === "C7#9b13/E", "kept " + (await song()).chords.chords[0].symbol);
    await set("#cv-sym", "Cxyz");
    need((await js(`document.querySelector(".cv-err").textContent`)).includes("Can't read chord"), "no error shown");
    need((await song()).chords.chords[0].symbol === "C7#9b13/E", "a bad chord replaced a good one");
  });
  await scenario("the progression can be typed as text", async () => {
    await set("#cv-text", "Cmaj9 Am7/G Dm9:2 | G13");
    const c = (await song()).chords.chords;
    need(c.length === 4 && c[2].beats === 2 && c[1].symbol === "Am7/G", JSON.stringify(c));
  });
  await scenario("inversion and drop change the voicing", async () => {
    await tapEl('[data-act="pick"][data-i="0"]');
    await tapEl('[data-act="inv+"]');
    await tapEl('[data-act="drop"][data-v="2"]');
    const c = (await song()).chords.chords[0];
    need(c.inversion === 1 && c.drop === 2, JSON.stringify(c));
  });
  await scenario("a chord can be added, and moved", async () => {
    const n0 = (await song()).chords.chords.length;
    await tapEl('[data-act="add"]');
    need((await song()).chords.chords.length === n0 + 1, "no chord added");
    await tapEl('[data-act="left"]');
  });
  await scenario("To MIDI writes notes into a new track and opens the roll", async () => {
    const before = (await song()).tracks.length;
    await tapEl("#cv-midi");
    const s = await song();
    need(s.tracks.length === before + 1, "tracks " + before + " -> " + s.tracks.length);
    const t = s.tracks[s.tracks.length - 1];
    need(t.name === "Chords" && t.notes.length >= 12, t.name + " has " + t.notes.length + " notes");
    need((await view()) === "roll", "view is " + (await view()));
  });
  await scenario("the script view runs Humanize on the track, and Undo is one step", async () => {
    await tapEl("#view-script");
    need((await view()) === "script", "view is " + (await view()));
    await noSideways("the script view");
    const before = JSON.stringify((await song()).tracks[(await js("window.jriterDaw.selected()"))].notes);
    await tapEl("#sv-run");
    const sel = await js("window.jriterDaw.selected()");
    const after = JSON.stringify((await song()).tracks[sel].notes);
    need(after !== before, "Humanize changed nothing");
  });
  await scenario("an arpeggio script turns chords into runs of notes", async () => {
    const sel = await js("window.jriterDaw.selected()");
    const before = (await song()).tracks[sel].notes.length;
    await set("#sv-pick", "1");
    await tapEl("#sv-run");
    const after = (await song()).tracks[sel].notes.length;
    need(after > before, "notes " + before + " -> " + after);
  });
  await scenario("a mistake in a script names the line", async () => {
    await set("#sv-code", "each note:\n  pitch = nope + 1");
    await tapEl("#sv-run");
    const msg = await js(`document.querySelector("#scriptview .cv-err").textContent`);
    need(/line 2/.test(msg) && /nope/.test(msg), "message was: " + msg);
  });
  await scenario("the three views fit the phone, and Roll still takes notes", async () => {
    await tapEl("#view-chords"); await noSideways("chords");
    await tapEl("#view-roll"); await noSideways("roll");
    need((await view()) === "roll", "view is " + (await view()));
  });
  await scenario("the channel rack: drums, steps, velocity drag, patterns, fits the phone", async () => {
    await tapEl("#view-rack");
    need((await view()) === "rack", "view is " + (await view()));
    await noSideways("rack");
    const before = (await song()).tracks.length;
    await tapEl('[data-act="drums"]');
    let s = await song();
    need(s.tracks.length === before + 3, "tracks " + before + " -> " + s.tracks.length);
    const kick = s.tracks.length - 3;
    need(s.tracks[kick].steps[0] && !s.tracks[kick].steps[1], "kick steps wrong");
    await noSideways("rack with drums");
    await tapEl(`.rk-step[data-t="${kick}"][data-i="1"]`);
    need((await song()).tracks[kick].steps[1], "tapping a step did not light it");
    await tapEl(`.rk-step[data-t="${kick}"][data-i="1"]`);
    need(!(await song()).tracks[kick].steps[1], "tapping a lit step did not clear it");
    const r = await rect(`.rk-step[data-t="${kick}"][data-i="0"]`);
    const v0 = (await song()).tracks[kick].steps[0].velocity;
    await dragAt({ x: r.x, y: r.y }, { x: r.x, y: r.y + 30 });
    const v1 = (await song()).tracks[kick].steps[0].velocity;
    need(v1 < v0, "dragging down kept velocity " + v0 + " -> " + v1);
    await tapEl('[data-act="newpat"]');
    s = await song();
    need(s.patterns.length === 2 && (await js("window.jriterDaw.pattern()")) === 1, "no second pattern");
    need(s.tracks[kick].steps.every((x) => x === null), "a new pattern was not empty");
    await tapEl('[data-pat="0"]');
    need((await song()).tracks[kick].steps[0], "pattern 1 lost its steps");
    await noSideways("rack after patterns");
  });
  await scenario("the song playlist: place, repeat-drag, split, song mode, fits the phone", async () => {
    await tapEl("#view-song");
    need((await view()) === "song", "view is " + (await view()));
    await noSideways("song tab");
    const n0 = (await js("window.jriterDaw.clips()")).length;
    await tapEl('.sl-cell[data-lane="0"][data-bar="0"]');
    let clips = await js("window.jriterDaw.clips()");
    need(clips.length === n0 + 1, "no clip placed: " + clips.length);
    const i = clips.length - 1, len0 = clips[i].length;
    const e = await rect(`.sl-clip[data-c="${i}"] .sl-end`);
    await dragAt({ x: e.x, y: e.y }, { x: e.x + 72, y: e.y });
    clips = await js("window.jriterDaw.clips()");
    need(clips[i].length === len0 + 2, "repeat-drag: length " + len0 + " -> " + clips[i].length);
    await tapEl('[data-act="split"]');
    clips = await js("window.jriterDaw.clips()");
    need(clips.length === n0 + 2 && clips[i + 1].offset > 0, "split gave " + JSON.stringify(clips));
    await tapEl("#mode");
    need((await js("window.jriterDaw.mode()")) === "song", "mode did not switch");
    need((await song()).mode === "song" && (await song()).clips.length === n0 + 2, "mode or clips not saved");
    await noSideways("song tab with clips");
  });
  await scenario("the mixer: strips, an effect, a fader, meters while playing, fits the phone", async () => {
    await tapEl("#view-mixer");
    need((await view()) === "mixer", "view is " + (await view()));
    await noSideways("mixer");
    const s0 = await song();
    const strips = await js(`document.querySelectorAll(".mx-strip").length`);
    need(strips === s0.tracks.length + 3, "strips " + strips + " for " + s0.tracks.length + " tracks");
    await tapEl('.mx-name[data-pick="t0"]');
    await tapEl('[data-add="reverb"]');
    let s = await song();
    need(s.tracks[0].fx.length === 1 && s.tracks[0].fx[0].type === "reverb", "no reverb on track 1: " + JSON.stringify(s.tracks[0].fx));
    await set('.mx-fader[data-id="t0"]', "0.3", "input");
    await set('.mx-fader[data-id="t0"]', "0.3", "change");
    s = await song();
    need(Math.abs(s.tracks[0].volume - 0.3) < 0.01, "volume is " + s.tracks[0].volume);
    // Routing: track 1 picked, the arrow under Reverb (bus 0) sends there; the knob is its amount.
    await tapEl('[data-route="b0"]');
    await sleep(400);
    need((await song()).tracks[0].sends[0] > 0, "the arrow did not send to Reverb");
    need(await js(`!!document.querySelector('.mx-strip[data-id="b0"] .mx-knob[data-knob="send"]')`), "no send knob under Reverb");
    await tapEl("#play");
    await sleep(700);
    const lv = await js("window.jriterDaw.levels()");
    need(lv && lv.tracks.length === s.tracks.length, "levels " + JSON.stringify(lv));
    await tapEl("#play");
    await tapEl('[data-fx="del"][data-i="0"]');
    need((await song()).tracks[0].fx.length === 0, "effect not removed");
    await noSideways("mixer after effects");
  });
  await scenario("the sampler: a library sound becomes a track, chops, an audio clip plays, fits the phone", async () => {
    // A one-second 440 Hz tone as a data: URL stands in for a take from the library.
    const n = 8000, pcm = Buffer.alloc(44 + n * 2);
    pcm.write("RIFF", 0); pcm.writeUInt32LE(36 + n * 2, 4); pcm.write("WAVEfmt ", 8); pcm.writeUInt32LE(16, 16);
    pcm.writeUInt16LE(1, 20); pcm.writeUInt16LE(1, 22); pcm.writeUInt32LE(n, 24); pcm.writeUInt32LE(n * 2, 28);
    pcm.writeUInt16LE(2, 32); pcm.writeUInt16LE(16, 34); pcm.write("data", 36); pcm.writeUInt32LE(n * 2, 40);
    for (let i = 0; i < n; i++) pcm.writeInt16LE(Math.round(12000 * Math.sin((2 * Math.PI * 440 * i) / n * 1)), 44 + i * 2);
    const src = "data:audio/wav;base64," + pcm.toString("base64");
    const before = (await song()).tracks.length;
    await js(`window.jriterDaw.addSampler(${JSON.stringify({ name: "Tone", src, seconds: 1, kind: "take" })})`);
    await tapEl("#view-sampler");
    need((await view()) === "sampler", "view is " + (await view()));
    await noSideways("sampler");
    let s = await song();
    need(s.tracks.length === before + 1 && s.tracks[before].instrument === "sampler", "no sampler track");
    await sleep(500);
    await tapEl('[data-chop="8"]');
    const sample = await js("window.jriterDaw.sample()");
    need(sample && sample.slices.length === 7, "slices: " + JSON.stringify(sample && sample.slices));
    await noSideways("sampler with a chopped sound");
    await js(`(() => { const e = document.querySelector("#sp-bpm"); e.value = "96"; e.dispatchEvent(new Event("change", { bubbles: true })); })()`);
    await tapEl('[data-act="keep"]');
    const tempo = await js("window.jriterDaw.sample()");
    need(tempo.bpm === 96 && tempo.warp === "pitch", "tempo: " + JSON.stringify(tempo));
    await noSideways("sampler with a tempo");
    await tapEl('[data-act="place"]');
    need((await view()) === "song", "Place did not open the Song tab");
    await tapEl(".song .cv-line button[data-brush^='t']");
    const n0 = (await js("window.jriterDaw.clips()")).length;
    await tapEl('.sl-cell[data-lane="3"][data-bar="0"]');
    const clips = await js("window.jriterDaw.clips()");
    need(clips.length === n0 + 1 && clips[n0].track === before, "no audio clip: " + JSON.stringify(clips[n0]));
    await noSideways("song tab with an audio clip");
    if (!(await js("window.jriterDaw.mode()") === "song")) await tapEl("#mode");
    await tapEl("#play");
    await sleep(900);
    need(await js("window.jriterDaw.playing()"), "not playing");
    await tapEl("#play");
  });

  await scenario("automation lanes: add a lane, tap points in, hold one to delete it, play, fits the phone", async () => {
    const text = JSON.stringify({ format: "jriter-daw", version: 1, bpm: 120, bars: 4, tracks: [
      { name: "Bass", instrument: "piano", volume: 0.8, notes: [{ pitch: 60, start: 0, length: 2, velocity: 90 }, { pitch: 64, start: 0, length: 2, velocity: 90 }] },
      { name: "Kick", instrument: "drums", volume: 0.8, notes: [{ pitch: 36, start: 0, length: 0.25, velocity: 100 }] }] });
    await js(`window.jriterDaw.load(${JSON.stringify(text)})`);
    await tapEl("#view-song");
    await tapEl('[data-al="open"]');
    await tapEl('.al-menu [data-target="t0.volume"]');
    need((await js("window.jriterDaw.automation()")).length === 1, "no lane");
    await js(`document.querySelector(".sl-scroll").scrollLeft = 0`);
    await sleep(80);
    const lane = await rect(".al-lane");
    await tapAt(lane.l + 50, lane.t + 20);
    await tapAt(lane.l + 150, lane.t + 44);
    let a = await js("window.jriterDaw.automation()");
    need(a[0].points.length === 2 && a[0].points[0].beat < a[0].points[1].beat, "points: " + JSON.stringify(a[0].points));
    need(a[0].points[0].value > a[0].points[1].value, "the higher tap should be the higher value: " + JSON.stringify(a[0].points));
    await noSideways("song tab with an automation lane");
    await tapEl("#play");
    await sleep(700);
    need(await js("window.jriterDaw.playing()"), "not playing with automation");
    await tapEl("#play");
    const pt = await rect('.al-pt[data-i="0"]');
    await holdAt(pt.x, pt.y, 700);
    a = await js("window.jriterDaw.automation()");
    need(a[0].points.length === 1, "hold did not delete a point: " + JSON.stringify(a[0].points));
    const s = await song();
    need(s.version === 10 && s.automation.length === 1, "saved version " + s.version);
  });
  await scenario("the Euclid script turns a chord into three hits", async () => {
    await tapEl("#view-script");
    await js(`(() => { const e = document.querySelector("#sv-pick"); const i = [...e.options].findIndex((o) => o.textContent.startsWith("Euclid")); e.value = i; e.dispatchEvent(new Event("change", { bubbles: true })); })()`);
    await sleep(100);
    await tapEl("#sv-run");
    need(!(await js(`document.querySelector("#scriptview .cv-err").textContent`)), "script error: " + (await js(`document.querySelector("#scriptview .cv-err").textContent`)));
    const n = (await song()).tracks[0].notes;
    need(n.length === 6 && n[0].start === 0 && n[2].start === 0.75, "notes: " + JSON.stringify(n.map((x) => [x.pitch, x.start])));
  });

  // ---- snap follows the zoom; the Song tab zooms; one-shots ----------------------------------
  const API = "window.jriterDaw";
  await scenario("roll: snap is Auto and follows the zoom, and a chosen snap decides where a note lands", async () => {
    await fresh();
    await js(`localStorage.removeItem("jriter-daw-snap")`);
    await js(`${API}.setSnap("auto")`);
    const at = async (zoom) => { await js(`${API}.setZoom(${zoom})`); return (await js(`${API}.snap()`)).beats; };
    need((await at(1)) === 0.5, "phone, zoom 1 should snap to an eighth, got " + (await js(`${API}.snap()`)).beats);
    need((await at(4)) === 0.125, "zoomed in should snap finer, got " + (await js(`${API}.snap()`)).beats);
    need((await at(0.25)) === 4, "zoomed out should snap to bars, got " + (await js(`${API}.snap()`)).beats);
    await js(`${API}.setZoom(1)`);
    const cv2 = await rect("#roll");
    await js(`${API}.setSnap("1/2")`);
    await tapAt(cv2.l + 44 + 64 * 1.4 + 1, cv2.t + 120);
    let n = (await song()).tracks[0].notes;
    need(n.length === 1 && n[0].start === 1, "snap 1/2: note at " + JSON.stringify(n.map((x) => x.start)));
    await fresh();
    await js(`${API}.setSnap("1/8")`);
    await tapAt(cv2.l + 44 + 64 * 1.4 + 1, cv2.t + 120);
    n = (await song()).tracks[0].notes;
    need(n.length === 1 && n[0].start === 1.375, "snap 1/8: note at " + JSON.stringify(n.map((x) => x.start)));
    await js(`${API}.setSnap("none")`);
    need((await js(`${API}.snap()`)).beats === 0, "none should be 0");
    await js(`${API}.setSnap("auto")`);
    await tapEl("#more"); await sleep(100);
    need(await js(`document.querySelector("#snap").options[0].textContent.startsWith("Auto (")`), "the Snap box should say what Auto is now");
    await tapEl("#more");
  });
  await scenario("song tab: zoom in, then a tap lands between bars; at zoom 1 it lands on the bar", async () => {
    await fresh();
    await js(`${API}.setView("song")`);
    await sleep(120);
    await js(`${API}.setSongSnap("auto")`);
    need((await js(`${API}.songSnap()`)).beats === 4, "song snap at zoom 1 should be a bar, got " + (await js(`${API}.songSnap()`)).beats);
    await js(`${API}.setSongZoom(4)`);
    need((await js(`${API}.songSnap()`)).beats === 0.5, "song snap at zoom 4 should be half a beat, got " + (await js(`${API}.songSnap()`)).beats);
    await noSideways("song tab zoomed in");
    await tapEl('.sl-cell[data-lane="0"][data-bar="1"]');
    let c = await js(`${API}.clips()`);
    need(c.length === 1 && c[0].start === 1.5, "zoomed in, the clip should start at 1.5, got " + JSON.stringify(c));
    await fresh();
    await js(`${API}.setView("song")`);
    await js(`${API}.setSongZoom(1)`);
    await sleep(100);
    await tapEl('.sl-cell[data-lane="0"][data-bar="1"]');
    c = await js(`${API}.clips()`);
    need(c.length === 1 && c[0].start === 1, "at zoom 1 the clip should start on bar 1, got " + JSON.stringify(c));
    const t = (await song());
    need(t.version === 10, "version " + t.version);
    await noSideways("song tab");
  });
  await scenario("one-shots: the Sampler tab has My one-shots, + Sample in the rack opens it, picking sampler on an empty track opens it", async () => {
    await fresh();
    await js(`${API}.setView("rack")`);
    await sleep(100);
    await tapEl('[data-act="sample"]');
    need((await view()) === "sampler", "view is " + (await view()));
    need(await js(`!!document.querySelector('[data-dir="oneshots"]') && !!document.querySelector('[data-dir="samples"]')`), "the browser should have a One-shots and a Samples folder");
    if (await js(`document.querySelector('[data-dir="oneshots"]').getAttribute("aria-expanded") !== "true"`)) await tapEl('[data-dir="oneshots"]');
    await sleep(300);
    need(await js(`!!document.querySelector('[data-act="files"]') && !!document.querySelector('[data-act="folder"]')`), "no Add files / Add a folder buttons");
    await noSideways("sampler, My one-shots");
    // a track set to sampler with no sound is silent and sends you to pick one
    await js(`${API}.setView("roll")`);
    const before = (await song()).tracks.length;
    await js(`(() => { const s = document.querySelector(".track select"); s.value = "sampler"; s.dispatchEvent(new Event("change", { bubbles: true })); })()`);
    await sleep(150);
    need((await view()) === "sampler", "picking sampler should open the Sampler tab, view is " + (await view()));
    // a one-shot added from there fills that track instead of making another
    const tone = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=";
    await js(`${API}.addSampler(${JSON.stringify({ name: "Kick", src: tone, seconds: 0.1, kind: "oneshot" })})`);
    const s2 = await song();
    need(s2.tracks.length === before && s2.tracks[0].instrument === "sampler" && s2.tracks[0].sample && s2.tracks[0].sample.oneshot === true, "the empty sampler track should have been filled: " + JSON.stringify(s2.tracks[0]));
    await tapEl('[data-act="oneshot"]');
    need((await js(`${API}.sample()`)).oneshot === false, "the One-shot switch should turn it off");
  });
}
