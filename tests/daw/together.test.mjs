import test from "node:test";
import assert from "node:assert/strict";
import { soundUrl } from "../../web/daw/together.js";

test("the owner fetches sounds from where the project says", () => {
  assert.equal(soundUrl("/api/versions/3/audio", null), "/api/versions/3/audio");
  assert.equal(soundUrl("/api/samples/3/audio", ""), "/api/samples/3/audio");
});
test("a guest goes through the share's door", () => {
  assert.equal(soundUrl("/api/versions/3/audio", "7"), "/api/shared/7/on/versions/3/audio");
  assert.equal(soundUrl("/api/vocals/4/audio", "7"), "/api/shared/7/on/vocals/4/audio");
  assert.equal(soundUrl("/api/samples/5/audio", "7"), "/api/shared/7/on/samples/5/audio");
});
test("a guest gets null for what a share does not open", () => {
  assert.equal(soundUrl("/api/renders/3/audio", "7"), null);
  assert.equal(soundUrl("/api/songs/1/versions", "7"), null);
});
test("a source that is not a library path is left alone", () => {
  assert.equal(soundUrl("blob:x", "7"), "blob:x");
});
