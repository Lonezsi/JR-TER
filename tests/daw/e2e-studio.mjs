// e2e-studio.mjs: the DAW in a 1440x900 desktop window with a mouse: the studio layout.
//
// Toolbar on top, library (Sampler) docked left, Song playlist in the middle, Mixer docked at the
// bottom; the Mixer and Sampler tabs show and hide the docks; a phone-sized window drops it all.
//
//     node tests/daw/e2e-studio.mjs        exit 1 if any scenario fails; screenshots in %TEMP%
//     EDGE=path\to\chrome.exe              to use another Chromium
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

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
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "daw-studio-"));
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

const click = async (sel) => { const r = await rect(sel); if (!r || !r.visible) throw new Error(sel + " is not on screen"); await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: r.x, y: r.y }); await send("Input.dispatchMouseEvent", { type: "mousePressed", x: r.x, y: r.y, button: "left", clickCount: 1 }); await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: r.x, y: r.y, button: "left", clickCount: 1 }); await sleep(150); };
const shot = async (name) => { const r = await send("Page.captureScreenshot", { format: "png" }); const f = path.join(os.tmpdir(), name); fs.writeFileSync(f, Buffer.from(r.data, "base64")); console.log("screenshot:", f); };
const vis = (sel) => js(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return false; const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; })()`);
const overlap = (a, b) => a.l < b.l + b.w - 1 && b.l < a.l + a.w - 1 && a.t < b.t + b.h - 1 && b.t < a.t + a.h - 1;

try {
  await connect();
  const t = await send("Target.createTarget", { url: "about:blank" }, false);
  session = (await send("Target.attachToTarget", { targetId: t.targetId, flatten: true }, false)).sessionId;
  await send("Runtime.enable"); await send("Page.enable"); await send("Log.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await send("Page.navigate", { url: SITE + "/daw.html" });
  // Wait for the page itself rather than a fixed time: fonts and stylesheets can hold it up.
  for (let i = 0; i < 60 && !(await js("!!window.jriterDaw").catch(() => false)); i++) await sleep(100);
  await sleep(300);
  console.log("media:", JSON.stringify(await js(`({ w: innerWidth, hover: matchMedia("(hover: hover)").matches, fine: matchMedia("(pointer: fine)").matches, coarse: matchMedia("(pointer: coarse)").matches })`)));
  await js(`document.getElementById("helpbox").hidden = true`);

  await scenario("a wide window with a mouse is the studio, and it opens on the Song playlist", async () => {
    need(await js(`document.body.classList.contains("studio")`), "no studio class");
    need((await js(`document.body.dataset.view`)) === "song", "view is " + (await js(`document.body.dataset.view`)));
  });
  await scenario("toolbar on top, library on the left, mixer at the bottom, nothing overlaps", async () => {
    const [bar, main, lib, mix, views] = await Promise.all(["#bar", "#main", "#samplerview", "#mixerview", "#views"].map(rect));
    for (const [n, r] of [["bar", bar], ["main", main], ["library", lib], ["mixer", mix], ["tabs", views]]) need(r && r.visible, n + " is not visible");
    need(bar.t < main.t, "toolbar is not above the editor");
    need(lib.l + lib.w <= main.l + 1, "library is not left of the editor");
    need(mix.t >= main.t + main.h - 1, "mixer is not under the editor");
    need(!overlap(bar, main) && !overlap(lib, main) && !overlap(mix, main) && !overlap(lib, mix) && !overlap(bar, views), "panels overlap");
    need(bar.h < 80, "toolbar wrapped to " + bar.h + "px");
    need((await js(`document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight`)), "page scrolls");
  });
  await scenario("the toolbar buttons do not overlap each other", async () => {
    const boxes = await js(`[...document.querySelectorAll("#bar button")].map((b) => { const r = b.getBoundingClientRect(); return { l: r.left, t: r.top, w: r.width, h: r.height }; }).filter((r) => r.w > 0)`);
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) need(!overlap(boxes[i], boxes[j]), "buttons " + i + " and " + j + " overlap");
  });
  await shot("daw-studio-dark.png");
  await scenario("a number field drags up to raise its value, and a plain click focuses it to type", async () => {
    await js(`window.jriterDaw.load(${JSON.stringify(EMPTY)})`); await sleep(100);
    const r = await rect("#bpm");
    if (!r || !r.visible) throw new Error("#bpm is not on screen");
    const m = (type, y) => send("Input.dispatchMouseEvent", { type, x: r.x, y, button: "left", clickCount: 1, buttons: type === "mouseReleased" ? 0 : 1 });
    await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: r.x, y: r.y });
    await m("mousePressed", r.y);
    for (let i = 1; i <= 8; i++) { await sleep(16); await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: r.x, y: r.y - i * 5, button: "left", buttons: 1 }); }
    await m("mouseReleased", r.y - 40); await sleep(150);
    const bpm = (await js("window.jriterDaw.song()")).bpm;
    need(bpm > 120, "dragging up should raise the BPM, got " + bpm);
    await click("#bars");
    need((await js("document.activeElement && document.activeElement.id")) === "bars", "a click should focus the field");
  });
  await scenario("the Mixer tab hides and shows the bottom dock", async () => {
    await click("#view-mixer");
    need(!(await vis("#mixerview")), "mixer still shown");
    need((await js(`document.body.dataset.view`)) === "song", "centre view changed");
    await click("#view-mixer");
    need(await vis("#mixerview"), "mixer did not come back");
    need((await js(`document.querySelectorAll("#mixerview .mx-strip").length`)) > 0, "mixer has no strips");
  });
  await scenario("effect settings are knobs that answer the arrow keys; Swing is a knob", async () => {
    await js(`document.querySelector('#mixerview [data-add="eq"]').click()`); await sleep(150);
    need((await js(`document.querySelectorAll("#mixerview .mx-fx .mx-knob[role=slider]").length`)) === 3, "EQ should have 3 knobs");
    need((await js(`document.querySelectorAll("#mixerview .mx-param").length`)) === 0, "sliders are still there");
    const v0 = await js(`(() => { const k = document.querySelector("#mixerview .mx-fx .mx-knob"); k.focus(); return +k.getAttribute("aria-valuenow"); })()`);
    await js(`document.querySelector("#mixerview .mx-fx .mx-knob").dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }))`);
    need((await js(`+document.querySelector("#mixerview .mx-fx .mx-knob").getAttribute("aria-valuenow")`)) > v0, "ArrowUp did not turn the knob");
    await js(`window.jriterDaw.setView("rack")`); await sleep(200);
    need((await js(`!!document.querySelector('#rackview .mx-knob[data-knob="swing"]')`)), "no Swing knob");
    await js(`window.jriterDaw.setView("song")`); await sleep(150);
  });
  await scenario("the Sampler tab hides and shows the left dock; setView('sampler') only reveals it", async () => {
    await click("#view-sampler");
    need(!(await vis("#samplerview")), "library still shown");
    await js(`window.jriterDaw.setView("sampler")`); await sleep(150);
    need(await vis("#samplerview"), "library not revealed");
    need((await js(`document.body.dataset.view`)) === "song", "centre view changed");
  });
  await scenario("the roll still draws when picked, and takes the room the docks leave", async () => {
    await click("#view-roll");
    const r = await rect("#rollbox");
    need(r && r.w > 400 && r.h > 150, "roll box is " + (r && r.w) + "x" + (r && r.h));
    await click("#view-song");
  });
  await js(`document.documentElement.setAttribute("data-theme", "light")`); await sleep(300);
  await shot("daw-studio-light.png");
  await js(`document.documentElement.setAttribute("data-theme", "dark")`);
  await scenario("a phone-sized window drops the studio", async () => {
    await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await sleep(400);
    need(!(await js(`document.body.classList.contains("studio")`)), "still studio");
  });
  await scenario("no page errors the whole time", async () => { need(!pageErrors.length, pageErrors.join(" | ")); });
} catch (e) {
  results.push([false, "harness: " + e.message]);
}
for (const [ok, name] of results) console.log((ok ? "  ok   " : "  FAIL ") + name);
const bad = results.filter(([ok]) => !ok).length;
console.log(bad ? bad + " failed" : "all " + results.length + " passed");
try { edge.kill(); } catch {}
server.close();
process.exit(bad ? 1 : 0);