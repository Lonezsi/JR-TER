// e2e.mjs: drive the real DAW page in an emulated phone and report what worked.
//
// WHY. Screenshots can show a layout but never tap it. This starts Edge headless, makes it a
// 390x844 touch phone, serves web/ itself, and sends real touch events (CDP
// Input.dispatchTouchEvent) at the real buttons and the real piano roll. It also records
// every page error, because the page used to fail silently on a phone.
//
//     node tests/daw/e2e.mjs           exit 1 if any scenario fails
//     EDGE=path\to\chrome.exe          to use another Chromium
//
// Not a *.test.mjs on purpose: it needs a browser, so `node --test tests/daw/*.test.mjs`
// stays fast and runs anywhere.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { makeProfile, closeBrowser } from "./profile.mjs";

const WEB = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "web");
const EDGE = process.env.EDGE || [
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
].find((p) => fs.existsSync(p));
if (!EDGE) { console.log("No Edge or Chrome found; set EDGE."); process.exit(2); }

const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json" };
const server = http.createServer((req, res) => {
  const p = decodeURIComponent(req.url.split("?")[0]);
  const f = path.join(WEB, p === "/" ? "daw.html" : p);
  if (!f.startsWith(WEB) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "content-type": MIME[path.extname(f)] || "application/octet-stream" });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const SITE = "http://127.0.0.1:" + server.address().port;

const dbg = 9300 + Math.floor(Math.random() * 500);
const profile = makeProfile("daw-e2e-");
const edge = spawn(EDGE, ["--headless=new", "--disable-gpu", "--no-first-run", "--remote-debugging-port=" + dbg,
  "--user-data-dir=" + profile, "about:blank"], { stdio: "ignore" });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws, session, nextId = 1;
const waiting = new Map();
const pageErrors = [];

async function connect() {
  for (let i = 0; i < 60; i++) {
    try {
      const v = await (await fetch("http://127.0.0.1:" + dbg + "/json/version")).json();
      ws = new WebSocket(v.webSocketDebuggerUrl);
      await new Promise((ok, bad) => { ws.onopen = ok; ws.onerror = bad; });
      break;
    } catch { await sleep(250); }
  }
  if (!ws) throw new Error("Edge did not start");
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && waiting.has(d.id)) { const w = waiting.get(d.id); waiting.delete(d.id); d.error ? w.bad(new Error(d.error.message)) : w.ok(d.result); }
    else if (d.method === "Runtime.exceptionThrown") pageErrors.push(d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text);
    else if (d.method === "Runtime.consoleAPICalled" && d.params.type === "error") pageErrors.push("console.error: " + d.params.args.map((a) => a.value ?? a.description).join(" "));
  };
}
const send = (method, params = {}, withSession = true) => new Promise((ok, bad) => {
  const id = nextId++;
  waiting.set(id, { ok, bad });
  ws.send(JSON.stringify({ id, method, params, ...(withSession && session ? { sessionId: session } : {}) }));
});
const js = async (expression) => {
  const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error("page: " + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
  return r.result.value;
};

// ---- touch ------------------------------------------------------------------------------
// A tap that lands within ~300 ms of the end of a drag gets no click in Chromium's touch
// emulation (the drag's last move leaves it in "scrolling", and the next tap is spent
// ending that). Real taps are not that close to a drag, so the harness waits it out.
const SETTLE = 450;
const touch = (type, pts) => send("Input.dispatchTouchEvent", { type, touchPoints: pts.map((p, i) => ({ x: p.x, y: p.y, id: i })) });
const tapAt = async (x, y) => { await touch("touchStart", [{ x, y }]); await sleep(60); await touch("touchEnd", []); await sleep(120); };
async function dragAt(a, b, steps = 8) {
  await touch("touchStart", [a]);
  for (let i = 1; i <= steps; i++) { await sleep(16); await touch("touchMove", [{ x: a.x + ((b.x - a.x) * i) / steps, y: a.y + ((b.y - a.y) * i) / steps }]); }
  await touch("touchEnd", []); await sleep(SETTLE);
}
async function holdAt(x, y, ms) { await touch("touchStart", [{ x, y }]); await sleep(ms); await touch("touchEnd", []); await sleep(200); }
async function pinch(cx, cy, from, to) {
  const at = (d) => [{ x: cx - d, y: cy }, { x: cx + d, y: cy }];
  await touch("touchStart", at(from));
  for (let i = 1; i <= 8; i++) { await sleep(16); await touch("touchMove", at(from + ((to - from) * i) / 8)); }
  await touch("touchEnd", []); await sleep(SETTLE);
}
const rect = (sel) => js(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, l: r.left, t: r.top, w: r.width, h: r.height, visible: r.width > 0 && r.height > 0 }; })()`);
// Tap the centre of an element, and say what is on top of it if it is not the element.
async function tapEl(sel) {
  await js(`document.querySelector(${JSON.stringify(sel)})?.scrollIntoView({ block: "center", inline: "center" })`); await sleep(60);
  const r = await rect(sel);
  if (!r || !r.visible) throw new Error(sel + " is not on screen");
  const top = await js(`(() => { const e = document.elementFromPoint(${r.x}, ${r.y}); const t = document.querySelector(${JSON.stringify(sel)}); return t && e && (t === e || t.contains(e)) ? "" : e ? e.tagName + "#" + e.id + "." + e.className : "nothing"; })()`);
  if (top) throw new Error(sel + " is covered by " + top);
  await tapAt(r.x, r.y);
}
const song = () => js("window.jriterDaw.song()");
const EMPTY = JSON.stringify({ format: "jriter-daw", version: 1, bpm: 120, bars: 4, tracks: [{ name: "T", instrument: "piano", volume: 0.8, notes: [] }] });
const fresh = async () => { await js(`window.jriterDaw.load(${JSON.stringify(EMPTY)}); window.jriterDaw.setView && window.jriterDaw.setView("roll");`); await sleep(100); };

// ---- run --------------------------------------------------------------------------------
const results = [];
async function scenario(name, fn) {
  try { await fn(); results.push([true, name]); } catch (e) { results.push([false, name + ": " + e.message]); }
}
const need = (cond, msg) => { if (!cond) throw new Error(msg); };

try {
  await connect();
  const t = await send("Target.createTarget", { url: "about:blank" }, false);
  session = (await send("Target.attachToTarget", { targetId: t.targetId, flatten: true }, false)).sessionId;
  await send("Runtime.enable"); await send("Page.enable"); await send("Log.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
  await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  await send("Emulation.setUserAgentOverride", { userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36", platform: "Android" });
  await send("Page.navigate", { url: SITE + "/daw.html" });
  await sleep(1500);

  const info = await js(`({ coarse: matchMedia("(pointer: coarse)").matches, hover: matchMedia("(hover: none)").matches, api: !!window.jriterDaw, w: innerWidth })`);
  console.log("phone emulation:", JSON.stringify(info));

  await scenario("the page starts without errors and exposes its API", async () => {
    need(info.api, "window.jriterDaw is missing");
    need(!pageErrors.length, "page errors: " + pageErrors.join(" | "));
  });
  await scenario("first visit opens the help sheet; it can be closed", async () => {
    const hidden = await js(`document.getElementById("helpbox").hidden`);
    need(hidden === false, "help did not open on first visit");
    await tapEl("#helpx");
    need(await js(`document.getElementById("helpbox").hidden`), "help did not close");
  });

  await fresh();
  const cv = await rect("#roll");
  const cellX = cv.l + 44 + 64 * 1.5 + 3, cellY = cv.t + 120;

  await scenario("tap on an empty square adds a note", async () => {
    await tapAt(cellX, cellY);
    const s = await song();
    need(s.tracks[0].notes.length === 1, "expected 1 note, got " + s.tracks[0].notes.length);
  });
  await scenario("dragging a note moves it (and does not just resize it)", async () => {
    const before = (await song()).tracks[0].notes[0];
    await dragAt({ x: cellX, y: cellY }, { x: cellX + 32, y: cellY });
    const after = (await song()).tracks[0].notes[0];
    need(after.start > before.start, "start " + before.start + " -> " + after.start + ", length " + before.length + " -> " + after.length);
    need(after.length === before.length, "it resized instead: length " + before.length + " -> " + after.length);
  });
  await scenario("dragging a note's right end makes it longer", async () => {
    await fresh(); await tapAt(cellX, cellY);
    const n = (await song()).tracks[0].notes[0];
    const right = cv.l + 44 + (n.start + n.length) * 64 - 3;
    await dragAt({ x: right, y: cellY }, { x: right + 48, y: cellY });
    const after = (await song()).tracks[0].notes[0];
    need(after.length > n.length, "length " + n.length + " -> " + after.length);
  });
  await scenario("holding a note deletes it", async () => {
    await fresh(); await tapAt(cellX, cellY);
    need((await song()).tracks[0].notes.length === 1, "no note to hold");
    await holdAt(cellX, cellY, 650);
    need((await song()).tracks[0].notes.length === 0, "note is still there");
  });
  await scenario("pinching out zooms in", async () => {
    const z0 = await js("window.jriterDaw.zoom()");
    await pinch(cv.l + cv.w / 2, cv.t + cv.h / 2, 30, 110);
    const z1 = await js("window.jriterDaw.zoom()");
    need(z1 > z0, "zoom " + z0 + " -> " + z1);
  });
  await scenario("pinching in zooms out", async () => {
    const z0 = await js("window.jriterDaw.zoom()");
    await pinch(cv.l + cv.w / 2, cv.t + cv.h / 2, 110, 30);
    const z1 = await js("window.jriterDaw.zoom()");
    need(z1 < z0, "zoom " + z0 + " -> " + z1);
  });
  await scenario("one finger on empty space scrolls", async () => {
    const s0 = await js("window.jriterDaw.scroll()");
    await dragAt({ x: cv.l + 200, y: cv.t + 300 }, { x: cv.l + 200, y: cv.t + 160 });
    const s1 = await js("window.jriterDaw.scroll()");
    need(s1.y !== s0.y || s1.x !== s0.x, "scroll stayed at " + JSON.stringify(s0));
  });
  await scenario("More, then + adds a track", async () => {
    await tapEl("#more"); await sleep(100);
    await tapEl("#add");
    need((await song()).tracks.length === 2, "tracks: " + (await song()).tracks.length);
    await tapEl("#more");
  });
  await scenario("Bounce renders the song and says where it went (a download here: no library)", async () => {
    await tapEl("#more"); await sleep(100);
    await js(`document.querySelectorAll(".toast").forEach((t) => t.remove())`);
    await tapEl("#bounce");
    let text = "";
    for (let i = 0; i < 40 && !/downloaded|Saved as|Bounced\./.test(text); i++) { await sleep(250); text = await js(`[...document.querySelectorAll(".toast")].map((t) => t.textContent).join(" | ")`); }
    need(/downloaded|Saved as|Bounced\./.test(text), "no bounce result toast, saw: " + text);
    need(!/Could not bounce/.test(text), "bounce failed: " + text);
    if (await js(`document.getElementById("bar").classList.contains("open")`)) await tapEl("#more");
  });
  await scenario("the instrument dropdown changes the instrument", async () => {
    const sel = await js("window.jriterDaw.selected()");
    await js(`(() => { const s = document.querySelectorAll(".track select")[${sel}]; s.value = "bass"; s.dispatchEvent(new Event("change", { bubbles: true })); })()`);
    need((await song()).tracks[sel].instrument === "bass", "instrument is " + (await song()).tracks[sel].instrument);
  });
  await scenario("Play starts and stops", async () => {
    await tapEl("#play");
    need(await js("window.jriterDaw.playing()"), "not playing after Play");
    await tapEl("#play");
    need(!(await js("window.jriterDaw.playing()")), "still playing after Stop");
  });
  await scenario("the transport fits the screen and nothing sits on top of its buttons", async () => {
    for (const id of ["home", "play", "loop", "tool-draw", "tool-erase", "tool-select", "help", "more"]) {
      const r = await rect("#" + id);
      need(r && r.visible && r.l >= 0 && r.l + r.w <= 390, "#" + id + " is off screen: " + JSON.stringify(r));
    }
  });

  // Extra scenarios register themselves from other files, so each feature owns its checks.
  const extra = path.join(path.dirname(fileURLToPath(import.meta.url)), "e2e-extra.mjs");
  if (fs.existsSync(extra)) await (await import("./e2e-extra.mjs")).run({ scenario, need, js, sleep, tapEl, tapAt, rect, song, fresh, send, SITE, dragAt, holdAt, touch });

  await scenario("no page errors the whole time", async () => { need(!pageErrors.length, pageErrors.join(" | ")); });
} catch (e) {
  results.push([false, "harness: " + e.message]);
}

for (const [ok, name] of results) console.log((ok ? "  ok   " : "  FAIL ") + name);
const bad = results.filter((r) => !r[0]).length;
console.log(bad ? bad + " failed" : "all " + results.length + " passed");
try { ws?.close(); } catch { /* already gone */ }
await closeBrowser(edge, profile); server.close();
process.exit(bad ? 1 : 0);
