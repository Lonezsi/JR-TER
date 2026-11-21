import test from "node:test";
import assert from "node:assert/strict";
import { buildCard, fileNames, slug, mixOf, checks, FORMAT, VERSION } from "../../web/release/card.js";

const album = { id: 7, title: "Éjjeli dalok", year: 2025, has_cover: true, notes: "" };
const songs = [
  { id: 1, title: "Első nap!", current_version_id: 11, latest_version_id: 12, duration: 61.234 },
  { id: 2, title: "Two", latest_version_id: 20, duration: 30 },
  { id: 3, title: "No mix" },
];

test("slug is ASCII", () => {
  assert.equal(slug("Első nap!"), "elso-nap");
  assert.equal(slug("???"), "track");
});

test("current mix beats latest", () => {
  assert.equal(mixOf(songs[0]), 11);
  assert.equal(mixOf(songs[1]), 20);
  assert.equal(mixOf(songs[2]), null);
});

test("file names", () => {
  const f = fileNames(7, songs, { cover: ".png", tracks: [".wav", ".mp3", ".wav"] });
  assert.equal(f.card, "jriter-release-7.json");
  assert.equal(f.cover, "jriter-release-7-cover.png");
  assert.equal(f.tracks[0], "jriter-release-7-01-elso-nap.wav");
});

test("card shape and checks", () => {
  const f = fileNames(7, songs, { cover: ".png", tracks: [".wav", ".mp3", ".wav"] });
  const c = buildCard(album, songs, { artist: "Me", explicit: [false, true] }, "http://x", f, { width: 1000, height: 1000 });
  assert.equal(c.format, FORMAT);
  assert.equal(c.version, VERSION);
  assert.ok(c.about.includes("final submit"));
  assert.equal(c.release.release_date, "2025");
  assert.equal(c.tracks[1].explicit, true);
  assert.equal(c.tracks[0].duration, 61.23);
  const t = c.checks.join("\n");
  assert.match(t, /3000x3000/);
  assert.match(t, /"Two" is a lossy/);
});

test("a song with no mix has no file", () => {
  const f = fileNames(7, songs, { cover: ".png", tracks: [".wav", ".mp3", ".wav"] });
  const c = buildCard(album, songs, { artist: "Me" }, "", f, null);
  assert.equal(c.tracks[2].file, "");
  assert.match(c.checks.join("\n"), /"No mix" has no mix/);
});

test("missing things are flagged", () => {
  const c = buildCard({ id: 1, title: "", has_cover: false }, [], {}, "", null, null);
  const t = checks(c).join("\n");
  for (const w of ["no title", "no artist", "no date", "no songs", "no cover"]) assert.match(t, new RegExp(w));
});

test("non-square cover", () => {
  const f = fileNames(7, [], { cover: ".jpg", tracks: [] });
  const c = buildCard(album, [], { artist: "a" }, "", f, { width: 3000, height: 2000 });
  assert.match(c.checks.join("\n"), /not square/);
});
