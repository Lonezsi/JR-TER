// The Condom 3 Settings patch for the live bundle (tools/live_patches/condom3_settings.mjs).
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { patch, REPLACEMENTS } from "../../tools/live_patches/condom3_settings.mjs";

const fixture = REPLACEMENTS.map(([f]) => "/*x*/" + f + "/*y*/").join("\n");

test("patch makes every replacement once and is idempotent", () => {
  const out = patch(fixture);
  for (const [, to] of REPLACEMENTS) assert.ok(out.includes(to));
  assert.equal(patch(out), out);
});

test("patch refuses a bundle that lacks a target", () => {
  assert.throws(() => patch(fixture.replace(REPLACEMENTS[0][0], "")), /exactly one/);
});

test("the real live bundle patches and still parses", (t) => {
  let src;
  try {
    const html = execFileSync("git", ["show", "origin/live-4.3.0:web/index.html"], { encoding: "utf8" });
    const name = html.match(/\/assets\/(index-[A-Za-z0-9_-]+\.js)/)[1];
    src = execFileSync("git", ["show", "origin/live-4.3.0:web/assets/" + name],
      { encoding: "utf8", maxBuffer: 64 << 20 });
  } catch { return t.skip("no origin/live-4.3.0"); }
  if (src.includes("jrEverywhere")) return t.skip("already deployed");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "c3-"));
  const file = path.join(dir, "b.mjs");
  fs.writeFileSync(file, patch(src));
  execFileSync(process.execPath, ["--check", file]);
});
