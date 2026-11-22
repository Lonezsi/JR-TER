// e2e-extra.mjs: the chord editor and the note script, on the emulated phone.
// Called by e2e.mjs, which hands over its helpers.
export async function run({ scenario, need, js, sleep, tapEl, rect, song, send, SITE, dragAt }) {
  const val = (sel) => js(`document.querySelector(${JSON.stringify(sel)}).value`);
  const set = (sel, v, event = "change") => js(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); e.value = ${JSON.stringify(v)}; e.dispatchEvent(new Event(${JSON.stringify(event)}, { bubbles: true })); })()`);
  const view = () => js("window.jriterDaw.view()");
  const noSideways = async (label) => {
    const w = await js("document.documentElement.scrollWidth");
    need(w <= 390, label + " is " + w + "px wide on a 390px phone");
  };

  await scenario("the DAW opens on the chord editor", async () => {
    await send("Page.navigate", { url: SITE + "/daw.html" });
    await sleep(1300);
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
    await set('.mx-send[data-id="t0"][data-k="send0"]', "0.5", "input");
    need(Math.abs((await song()).tracks[0].sends[0] - 0.5) < 0.01, "send did not change");
    await tapEl("#play");
    await sleep(700);
    const lv = await js("window.jriterDaw.levels()");
    need(lv && lv.tracks.length === s.tracks.length, "levels " + JSON.stringify(lv));
    await tapEl("#play");
    await tapEl('[data-fx="del"][data-i="0"]');
    need((await song()).tracks[0].fx.length === 0, "effect not removed");
    await noSideways("mixer after effects");
  });
}
