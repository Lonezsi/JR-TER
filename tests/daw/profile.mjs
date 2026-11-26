// profile.mjs: the throwaway browser profile the DAW e2e scripts give Edge/Chrome.
//
// Each run makes a temp folder for --user-data-dir. Left behind, they pile up (31 of them
// filled 3 GB on HEDDA). makeProfile() sweeps old ones from crashed runs, closeBrowser()
// kills the whole browser tree and deletes the folder, retrying while Windows lets go.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const OURS = /^(daw-studio-|daw-e2e-)/;

export function sweepProfiles(dir = os.tmpdir(), maxAgeMs = 6 * 3600e3) {
  let n = 0;
  let names = [];
  try { names = fs.readdirSync(dir); } catch { return 0; }
  for (const name of names) {
    if (!OURS.test(name)) continue;
    const p = path.join(dir, name);
    try {
      const st = fs.statSync(p);
      if (!st.isDirectory() || Date.now() - st.mtimeMs < maxAgeMs) continue;
      fs.rmSync(p, { recursive: true, force: true, maxRetries: 3 });
      n++;
    } catch { /* in use by another run: skip it */ }
  }
  return n;
}

export function makeProfile(prefix) {
  sweepProfiles();
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

export async function closeBrowser(child, profile) {
  const exited = child.exitCode !== null || child.signalCode !== null;
  if (!exited) {
    // The tree has to die while the parent is alive, or taskkill can't find the children.
    if (process.platform === "win32" && child.pid) {
      try { spawnSync("taskkill", ["/F", "/T", "/PID", String(child.pid)], { stdio: "ignore" }); } catch { /* gone */ }
    }
    try { child.kill(); } catch { /* gone */ }
    await Promise.race([new Promise((r) => child.once("exit", r)), sleep(3000)]);
  }
  for (let i = 0; i < 10; i++) {
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* still held */ }
    if (!fs.existsSync(profile)) return true;
    await sleep(300);
  }
  console.log("could not delete browser profile: " + profile);
  return false;
}
