import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { sweepProfiles, closeBrowser } from "./profile.mjs";

test("sweepProfiles removes only old daw-studio-/daw-e2e- folders", () => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "profile-test-"));
  try {
    const old = new Date(Date.now() - 7 * 3600e3);
    for (const n of ["daw-studio-old", "daw-e2e-old", "daw-studio-new", "other-old"]) {
      const p = path.join(scratch, n);
      fs.mkdirSync(p);
      fs.writeFileSync(path.join(p, "f"), "x");
      if (n.endsWith("old")) fs.utimesSync(p, old, old);
    }
    assert.equal(sweepProfiles(scratch), 2);
    assert.deepEqual(fs.readdirSync(scratch).sort(), ["daw-studio-new", "other-old"]);
  } finally { fs.rmSync(scratch, { recursive: true, force: true }); }
});

test("closeBrowser kills the process and deletes the profile", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "profile-test-"));
  fs.mkdirSync(path.join(dir, "sub"));
  fs.writeFileSync(path.join(dir, "sub", "f"), "x");
  const child = spawn(process.execPath, ["-e", "setTimeout(()=>{},60000)"], { stdio: "ignore" });
  assert.equal(await closeBrowser(child, dir), true);
  assert.equal(fs.existsSync(dir), false);
  assert.ok(child.exitCode !== null || child.signalCode !== null);
});
