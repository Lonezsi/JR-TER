/* Drop a bounce anywhere on JR!TER and it lands in Renders.
 *
 * WHY ANYWHERE AND NOT ON A PANEL. A render arrives by being finished somewhere else: you
 * bounce it in a DAW, you find it in a folder, and then you want it here. Whatever screen
 * happens to be up at that moment is not part of that thought, and a drop target you have
 * to navigate to first is a target you go round by uploading the slow way.
 *
 * WHY RENDERS AND NOT THE SONG THAT IS OPEN. The two readings of a file dropped on a song
 * page are "add this to this song" and "put this in my renders", and guessing wrong in
 * the first direction attaches a take to the wrong song, which is a thing to undo. Every
 * render is one press from being attached and the attach screen is built for choosing.
 * So the drop always means the same thing, whatever is on the screen behind it.
 *
 * WHAT COUNTS AS AUDIO IS THE SERVER'S ANSWER, off /api/state. A second list of
 * extensions written into the page is a list that disagrees with the real one the week
 * somebody adds .aiff, and the disagreement shows up as a file that vanishes on drop.
 */
"use strict";

(() => {
  const KINDS = () => ((J.state && J.state.audio) || [".mp3", ".wav", ".flac"]);
  const isAudio = (file) => KINDS().some(
    (ext) => file.name.toLowerCase().endsWith(ext));

  /* A drag is only ours if it is carrying files.
   *
   * Dragging a lyric line, a render row or a bit of selected text also fires these, and
   * an overlay that threw itself up over the page every time somebody moved a card would
   * make the app unusable while it did nothing. */
  const hasFiles = (e) => !!e.dataTransfer
    && Array.prototype.indexOf.call(e.dataTransfer.types || [], "Files") !== -1;

  let sheet = null;
  /* Counted, not toggled. dragenter and dragleave both fire as a drag crosses every
   * element boundary on the way in, so a flag set on one and cleared on the other
   * flickers the whole way across the page. */
  let deep = 0;

  function show() {
    if (sheet) return;
    sheet = document.createElement("div");
    sheet.className = "dropping";
    sheet.innerHTML = `
      <div class="dropping-said">
        <b>Engedd el</b>
        <span>A hangfájlok a Renders közé kerülnek.</span>
      </div>`;
    document.body.appendChild(sheet);
  }

  function hide() {
    deep = 0;
    if (sheet) sheet.remove();
    sheet = null;
  }

  document.addEventListener("dragenter", (e) => {
    if (!hasFiles(e)) return;
    deep += 1;
    show();
  });

  document.addEventListener("dragover", (e) => {
    // Without this the browser opens the file instead, which navigates away from the app.
    if (hasFiles(e)) e.preventDefault();
  });

  document.addEventListener("dragleave", (e) => {
    if (!hasFiles(e)) return;
    deep -= 1;
    if (deep <= 0) hide();
  });

  document.addEventListener("drop", async (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    hide();
    const files = Array.prototype.slice.call(e.dataTransfer.files || []);
    if (files.length) await take(files);
  });

  /* Upload them, and say what happened to each.
   *
   * One at a time rather than all at once. A handful of bounces is a couple of hundred
   * megabytes, and a browser given ten of those in parallel spends the whole time
   * swapping between them: the last one finishes no sooner and the first one finishes
   * much later, so there is nothing to listen to until they are all done.
   */
  async function take(files) {
    const audio = files.filter(isAudio);
    const rest = files.length - audio.length;
    if (!audio.length) {
      J.toast(rest === 1 ? "Ez nem hangfájl." : "Ezek nem hangfájlok.", "bad");
      return;
    }

    let added = 0;
    let already = 0;
    const failed = [];
    for (let i = 0; i < audio.length; i++) {
      const file = audio[i];
      if (audio.length > 1) J.toast(`${i + 1}/${audio.length} feltöltése…`);
      try {
        const out = await J.upload("/api/renders", file, { "X-Origin": "drop" });
        if (out.added) added += 1;
        else already += 1;
      } catch (err) {
        failed.push(`${file.name}: ${err.message}`);
      }
    }

    /* One line at the end saying what actually happened to the batch.
     *
     * "already" is not a failure and is worth its own word: the same bounce dropped twice
     * is one render, because a render is its audio, and somebody who has just dropped a
     * folder for the second time wants to know that rather than to wonder what went wrong.
     */
    const said = [];
    if (added) said.push(`${added} render feltöltve`);
    if (already) said.push(`${already} már megvolt`);
    if (rest) said.push(`${rest} nem hangfájl`);
    if (said.length) J.toast(said.join(", "), failed.length ? "bad" : null);
    failed.forEach((why) => J.toast(why, "bad"));

    if (added) {
      // Whoever is showing renders redraws; nobody else has to know about this file.
      J.emit("renders:changed");
      if (location.hash.indexOf("#/renders") === 0) J.router.reload();
    }
  }

  /* And the same thing from a button, for a phone and for anybody who would rather pick a
   * file than drag one. The button is on the Renders screen; this is what it calls. */
  J.pickRenders = () => {
    const picker = document.createElement("input");
    picker.type = "file";
    picker.multiple = true;
    picker.accept = KINDS().join(",");
    picker.addEventListener("change", () => {
      const files = Array.prototype.slice.call(picker.files || []);
      if (files.length) take(files);
    });
    picker.click();
  };
})();
