// Look 3: every change that used to be a hand patch of the bundle lives in ui/ source,
// and tools/look3_check.mjs can tell a built bundle that lacks one.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { check, MARKERS } from "../../tools/look3_check.mjs";

const src = (f) => fs.readFileSync(new URL("../../ui/src/" + f, import.meta.url), "utf8");

const IN_SOURCE = [
  ["views/Album.svelte", "/release.html?album="],
  ["views/Album.svelte", "album.release"],
  ["views/Song.svelte", 'value: "daw"'],
  ["views/Song.svelte", "song.daw"],
  ["views/Song.svelte", "<DawTab"],
  ["views/song/DawTab.svelte", "/daw.html?song="],
  ["views/song/TakesTab.svelte", "v.has_daw"],
  ["views/song/TakesTab.svelte", "&version="],
  ["shell/Shell.svelte", "Open the DAW"],
  ["ui/AlbumArt.svelte", "overflow: hidden"],
  ["views/library/StickerSheet.svelte", 'class="cut"'],
  ["views/library/StickerSheet.svelte", ".dragging .cut"],
  ["views/song/PluginsTab.svelte", ""],
  ["views/settings/Account.svelte", "foyer_tied_as"],
  ["views/song/YouTubePanel.svelte", "https:"],
  ["views/Join.svelte", "16 and over"],
];

test("every ported hand patch is in the ui/ source", () => {
  for (const [file, needle] of IN_SOURCE) assert.ok(src(file).includes(needle), `${file} lacks ${needle}`);
});

test("look3_check passes a bundle with every marker and names what is missing", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "look3-"));
  fs.mkdirSync(path.join(dir, "assets"));
  const js = MARKERS.filter((m) => m[1] === "js").map((m) => m[2]).join("\n");
  const css = MARKERS.filter((m) => m[1] === "css").map((m) => m[2]).join("\n");
  fs.writeFileSync(path.join(dir, "assets", "index-a1.js"), js);
  fs.writeFileSync(path.join(dir, "assets", "index-a1.css"), css);
  fs.writeFileSync(path.join(dir, "index.html"),
    '<link rel="stylesheet" href="/fonts/fonts.css"><script type="module" src="/assets/index-a1.js"></script><link rel="stylesheet" href="/assets/index-a1.css">');
  assert.ok(check(dir).every(([, ok]) => ok));
  fs.writeFileSync(path.join(dir, "assets", "index-a1.js"), js.replace("Release to RouteNote", ""));
  const bad = check(dir).filter(([, ok]) => !ok).map(([n]) => n);
  assert.deepEqual(bad, ["Release in the album menu"]);
  fs.rmSync(dir, { recursive: true });
});
