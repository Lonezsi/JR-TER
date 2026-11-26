// e2e-measure.mjs: measure the DAW instead of asking how it feels.
//
//   node tests/daw/e2e-measure.mjs      exit 1 if any measurement is off; the "measured:" lines are the record
//   EDGE=path\to\chrome.exe             to use another Chromium
//
// Bounce is as long as the song and not silent; Keep pitch holds a loop's pitch at a far tempo (the
// bounced file is analysed); a real WAM 2 plugin loads, sounds and saves; an effect reorders by its
// grip with touch; Together syncs two browser contexts editing at once. Its own little server
// serves web/, keeps the bounced WAV instead of /api/renders, and plays the part of the server's
// /api/songs/1/daw routes (same rules as jriter/modules/daw.py), one person per cookie.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { makeProfile, closeBrowser } from "./profile.mjs";
import { encodeWav, bounceSeconds } from "../../web/daw/bounce.js";

const WEB = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "web");
const EDGE = process.env.EDGE || [
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
].find((p) => fs.existsSync(p));
if (!EDGE) { console.log("No Edge or Chrome found; set EDGE."); process.exit(2); }

// ---- the fake server ---------------------------------------------------------------------
const loop = (() => { // 2 s, 440 Hz, 44.1 kHz mono
  const n = 88200, d = new Float32Array(n);
  for (let i = 0; i < n; i++) d[i] = 0.5 * Math.sin((2 * Math.PI * 440 * i) / 44100);
  return Buffer.from(encodeWav([d], 44100));
})();
let lastBounce = null;
let proj = { text: "", rev: 0 };
const people = new Map(); // cookie -> { id, name, hue, cursor, at }
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json" };
const json = (res, o, code = 200) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(o)); };
const server = http.createServer((req, res) => {
  const url = req.url.split("?")[0];
  const cookie = /who=(\w+)/.exec(req.headers.cookie || "");
  let who = cookie && cookie[1];
  const headers = {};
  if (!who) { who = Math.random().toString(36).slice(2, 10); headers["set-cookie"] = "who=" + who + "; Path=/"; }
  const others = () => [...people.entries()].filter(([k, p]) => k !== who && Date.now() - p.at < 10000).map(([, p]) => ({ id: p.id, name: p.name, hue: p.hue, cursor: p.cursor }));
  const me = () => { if (!people.has(who)) people.set(who, { id: people.size + 1, name: "P" + (people.size + 1), hue: 200, cursor: {}, at: 0 }); return people.get(who); };
  const body = () => new Promise((ok) => { const c = []; req.on("data", (d) => c.push(d)); req.on("end", () => ok(Buffer.concat(c))); });
  const reply = (o, code = 200) => { res.writeHead(code, { "content-type": "application/json", ...headers }); res.end(JSON.stringify(o)); };
  if (req.method === "POST" && url === "/api/renders") return body().then((b) => { lastBounce = b; reply({ ok: true }); });
  if (url === "/test/loop.wav") { res.writeHead(200, { "content-type": "audio/wav" }); return res.end(loop); }
  if (url === "/api/songs/1/daw") {
    me().at = Date.now();
    if (req.method === "GET") return reply({ text: proj.text, rev: proj.rev, people: others() });
    if (req.method === "PUT") return body().then((b) => {
      const j = JSON.parse(b.toString()), base = +j.base || 0;
      if (proj.rev === base && (base !== 0 || !proj.text)) { proj = { text: j.text, rev: base + 1 }; return reply({ rev: proj.rev, conflict: false }); }
      reply({ text: proj.text, rev: proj.rev, people: [], conflict: true });
    });
  }
  if (url === "/api/songs/1/daw/here" && req.method === "POST") return body().then((b) => {
    const p = me(); try { p.cursor = JSON.parse(b.toString()).cursor || {}; } catch { /* no cursor */ }
    p.at = Date.now(); reply({ rev: proj.rev, people: others() });
  });
  if (url.startsWith("/api/")) return reply({ error: "not here" }, 404);
  const f = path.join(WEB, url === "/" ? "daw.html" : decodeURIComponent(url));
  if (!f.startsWith(WEB) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "content-type": MIME[path.extname(f)] || "application/octet-stream", ...headers });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const SITE = "http://127.0.0.1:" + server.address().port;

// ---- the browser -------------------------------------------------------------------------
const dbg = 9300 + Math.floor(Math.random() * 500);
const profile = makeProfile("daw-measure-");
const edge = spawn(EDGE, ["--headless=new", "--disable-gpu", "--no-first-run", "--autoplay-policy=no-user-gesture-required", "--remote-debugging-port=" + dbg,
  "--user-data-dir=" + profile, "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws, nextId = 1;
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
    else if (d.method === "Runtime.consoleAPICalled" && d.params.type === "error") {
      const t = d.params.args.map((a) => a.value ?? a.description).join(" ");
      if (!/404|Failed to load resource/.test(t)) pageErrors.push("console.error: " + t);
    }
  };
}
const send = (method, params = {}, sessionId) => new Promise((ok, bad) => {
  const id = nextId++;
  waiting.set(id, { ok, bad });
  ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
});
// A page: its own session, optionally in its own browser context (its own cookies and storage).
async function openPage(url, ctxId) {
  const t = await send("Target.createTarget", { url: "about:blank", ...(ctxId ? { browserContextId: ctxId } : {}) });
  const sid = (await send("Target.attachToTarget", { targetId: t.targetId, flatten: true })).sessionId;
  const s = (m, p) => send(m, p, sid);
  await s("Runtime.enable"); await s("Page.enable");
  await s("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await s("Page.navigate", { url });
  const js = async (expression) => {
    const r = await s("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error("page: " + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    return r.result.value;
  };
  for (let i = 0; i < 100 && !(await js("!!window.jriterDaw").catch(() => false)); i++) await sleep(100);
  await sleep(300);
  await js(`document.getElementById("helpbox").hidden = true`);
  return { s, js, sid, targetId: t.targetId };
}

// ---- audio analysis ----------------------------------------------------------------------
function readWav(buf) {
  const ch = buf.readUInt16LE(22), sr = buf.readUInt32LE(24), frames = (buf.length - 44) / (2 * ch);
  const out = Array.from({ length: ch }, () => new Float32Array(frames));
  for (let i = 0; i < frames; i++) for (let c = 0; c < ch; c++) out[c][i] = buf.readInt16LE(44 + (i * ch + c) * 2) / 32768;
  return { ch, sr, frames, data: out };
}
const rms = (d, sr, a, b) => { let s = 0; const i0 = Math.floor(a * sr), i1 = Math.floor(b * sr); for (let i = i0; i < i1; i++) s += d[i] * d[i]; return Math.sqrt(s / (i1 - i0)); };
const db = (x) => 20 * Math.log10(Math.max(x, 1e-9));
function freq(d, sr, a, b) { // rising zero crossings, linear interpolation
  const i0 = Math.floor(a * sr), i1 = Math.floor(b * sr); const z = [];
  for (let i = i0 + 1; i < i1; i++) if (d[i - 1] < 0 && d[i] >= 0) z.push(i - 1 + -d[i - 1] / (d[i] - d[i - 1]));
  if (z.length < 3) return 0;
  return (sr * (z.length - 1)) / (z[z.length - 1] - z[0]);
}

// ---- run ---------------------------------------------------------------------------------
const results = [];
async function scenario(name, fn) { try { await fn(); results.push([true, name]); } catch (e) { results.push([false, name + ": " + e.message]); } }
const need = (c, m) => { if (!c) throw new Error(m); };
const log = (...a) => console.log("measured:", ...a);

async function bounce(p) {
  lastBounce = null;
  await p.js(`document.getElementById("bounce").click()`);
  for (let i = 0; i < 150 && !lastBounce; i++) await sleep(200);
  need(lastBounce, "no bounce arrived: " + (await p.js(`[...document.querySelectorAll(".toast")].map((t) => t.textContent).join(" | ")`)));
  await sleep(100);
  return readWav(lastBounce);
}
const base = async (p) => JSON.parse(JSON.stringify(await p.js("window.jriterDaw.song()")));
const withNotes = (song, notes) => { song.patterns = [{ name: "P", tracks: [{ notes, steps: [] }] }]; return song; };

try {
  await connect();
  const p = await openPage(SITE + "/daw.html");
  const EMPTY = await base(p);
  EMPTY.tracks = [{ name: "T", instrument: "piano", key: 60, volume: 0.8 }];
  EMPTY.bpm = 120; EMPTY.bars = 4; EMPTY.mode = "pattern"; EMPTY.clips = []; EMPTY.automation = [];
  const load = async (song) => { await p.js(`window.jriterDaw.load(${JSON.stringify(JSON.stringify(song))})`); await sleep(200); };

  await scenario("Bounce gives non-silent audio as long as the song", async () => {
    const song = withNotes(JSON.parse(JSON.stringify(EMPTY)), [0, 4, 8, 12].map((s) => ({ pitch: 60, start: s, length: 3.5, velocity: 100 })));
    await load(song);
    const w = await bounce(p);
    const want = Math.ceil(bounceSeconds(16, 120) * 44100);
    need(w.sr === 44100 && w.ch === 2, "format " + w.sr + " Hz " + w.ch + " ch");
    need(Math.abs(w.frames - want) <= 1, "length " + w.frames + " frames, wanted " + want);
    const bars = [0, 1, 2, 3].map((b) => db(rms(w.data[0], w.sr, b * 2 + 0.1, b * 2 + 1.5)));
    log("bounce " + (w.frames / w.sr).toFixed(2) + " s (song 8 s + 2 s tail), " + w.ch + " ch, level per bar " + bars.map((x) => x.toFixed(1)).join(", ") + " dBFS");
    need(bars.every((x) => x > -40), "a bar is silent: " + bars.join(", "));
  });

  const loopSong = (warp) => {
    const s = JSON.parse(JSON.stringify(EMPTY));
    s.bpm = 180; s.bars = 2; s.mode = "song";
    s.tracks = [{ name: "Loop", instrument: "sampler", key: 60, volume: 0.8, sample: { name: "Loop", src: "/test/loop.wav", seconds: 2, start: 0, end: 0, root: 60, bpm: 120, warp } }];
    s.clips = [{ track: 0, lane: 0, start: 0, length: 1, offset: 0 }];
    return s;
  };
  let r0 = 0;
  await scenario("Keep pitch keeps a loop's pitch within 1% at a far tempo (120 to 180 BPM)", async () => {
    await load(loopSong("time"));
    const w = await bounce(p);
    const f = freq(w.data[0], w.sr, 0.15, 1.2), err = (Math.abs(f - 440) / 440) * 100;
    r0 = rms(w.data[0], w.sr, 0.15, 1.2);
    log("keep pitch: loop 440 Hz at ratio 1.5 renders at " + f.toFixed(1) + " Hz (" + err.toFixed(2) + "% off), level " + db(r0).toFixed(1) + " dBFS");
    need(err < 1, "pitch moved " + err.toFixed(2) + "% (" + f + " Hz)");
    await load(loopSong("pitch"));
    const t = await bounce(p), g = freq(t.data[0], t.sr, 0.15, 1.2);
    log("keep pitch off (tape): " + g.toFixed(1) + " Hz, expected 660");
    need(Math.abs(g - 660) / 660 < 0.01, "tape pitch " + g);
  });

  await scenario("a real WAM 2 plugin loads, sounds and saves", async () => {
    need(r0 > 0, "needs the Keep pitch level");
    await load(loopSong("time"));
    await p.js(`window.jriterDaw.setView("song")`);
    await p.js(`document.activeElement && document.activeElement.blur()`);
    await p.js(`document.querySelector('#mixerview [data-add="wam"]').click()`); await sleep(300);
    await p.js(`(() => { const i = document.querySelector("#mixerview .mx-wurl"); i.value = "/daw/vendor/wam/test-wam2.js"; i.dispatchEvent(new Event("change", { bubbles: true })); })()`);
    const open = () => p.js(`(() => { const e = document.querySelector('#mixerview [data-fx="open"]'); if (!e) return false; const r = e.getBoundingClientRect(); return r.width > 0; })()`);
    for (let i = 0; i < 120 && !(await open()); i++) await sleep(100);
    need(await open(), "plugin did not load: " + (await p.js(`document.querySelector("#mixerview .mx-wst")?.textContent + " " + JSON.stringify(window.jriterDaw.plugins())`)));
    need((await p.js(`window.jriterDaw.plugins()[0].status`)) === "on", "status is not on");
    await p.js(`document.querySelector('#mixerview [data-fx="open"]').click()`); await sleep(300);
    need(await p.js(`!!document.getElementById("test-wam2-gui")`), "no plugin window");
    await p.js(`document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`); await sleep(300);
    const w = await bounce(p), d1 = db(rms(w.data[0], w.sr, 0.15, 1.2)) - db(r0);
    log("WAM 2 plugin (gain 0.5): " + d1.toFixed(2) + " dB against the dry loop, expected -6.02");
    need(Math.abs(d1 + 6.02) < 0.5, "level change " + d1);
    let fx = (await base(p)).tracks[0].fx.find((f) => f.type === "wam");
    need(fx && fx.state && fx.state.gain === 0.5, "state not in the song: " + JSON.stringify(fx));
    // save with another setting, reload the page, open it again: the plugin must come back as saved
    const saved = await base(p); saved.tracks[0].fx.find((f) => f.type === "wam").state = { gain: 0.25 };
    await p.js(`localStorage.setItem("jriter-daw-song", ${JSON.stringify(JSON.stringify(saved))})`).catch(() => {});
    await load(saved);
    for (let i = 0; i < 120 && !(await open()); i++) await sleep(100);
    const w2 = await bounce(p), d2 = db(rms(w2.data[0], w2.sr, 0.15, 1.2)) - db(r0);
    log("WAM 2 plugin reloaded from the saved song (gain 0.25): " + d2.toFixed(2) + " dB, expected -12.04");
    need(Math.abs(d2 + 12.04) < 0.5, "level after load " + d2);
    fx = (await base(p)).tracks[0].fx.find((f) => f.type === "wam");
    need(fx && fx.state && fx.state.gain === 0.25, "state lost: " + JSON.stringify(fx));
  });

  await scenario("an effect reorders by its grip with a finger", async () => {
    await load(EMPTY);
    await p.js(`document.activeElement && document.activeElement.blur()`);
    await p.js(`document.querySelector('#mixerview [data-add="eq"]').click()`); await sleep(300);
    await p.js(`document.querySelector('#mixerview [data-add="delay"]').click()`); await sleep(300);
    const order = () => p.js(`window.jriterDaw.song().tracks[0].fx.map((f) => f.type).join()`);
    need((await order()) === "eq,delay", "start " + (await order()));
    const rect = (sel) => p.js(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
    const a = await rect('#mixerview [data-grip="0"]'), b = await rect("#mixerview .mx-chain > .mx-fx:nth-child(2)");
    need(a && b, "no grip or second card");
    const touch = (type, pts) => p.s("Input.dispatchTouchEvent", { type, touchPoints: pts.map((q, i) => ({ x: q.x, y: q.y, id: i })) });
    const ty = b.y + 10;
    await touch("touchStart", [a]);
    for (let i = 1; i <= 8; i++) { await sleep(16); await touch("touchMove", [{ x: a.x, y: a.y + ((ty - a.y) * i) / 8 }]); }
    await touch("touchEnd", []); await sleep(450);
    log("touch grip drag: order eq,delay became " + (await order()));
    need((await order()) === "delay,eq", "after the finger drag: " + (await order()));
  });

  await scenario("Together syncs two browser contexts editing at once", async () => {
    proj = { text: "", rev: 0 };
    const c1 = (await send("Target.createBrowserContext")).browserContextId, c2 = (await send("Target.createBrowserContext")).browserContextId;
    const A = await openPage(SITE + "/daw.html?song=1", c1);
    await sleep(1500);
    const B = await openPage(SITE + "/daw.html?song=1", c2);
    const badges = (q) => q.js(`document.querySelectorAll("#people .badge").length`);
    for (let i = 0; i < 60 && ((await badges(A)) < 1 || (await badges(B)) < 1); i++) await sleep(200);
    need((await badges(A)) === 1 && (await badges(B)) === 1, "people: A sees " + (await badges(A)) + ", B sees " + (await badges(B)));
    const cur = JSON.parse(await A.js(`JSON.stringify(window.jriterDaw.song())`));
    const a = JSON.parse(JSON.stringify(cur)); a.bpm = 140;
    const b = JSON.parse(JSON.stringify(cur)); b.tracks[0].volume = 0.5;
    const t0 = Date.now();
    await Promise.all([A.js(`window.jriterDaw.load(${JSON.stringify(JSON.stringify(a))})`), B.js(`window.jriterDaw.load(${JSON.stringify(JSON.stringify(b))})`)]);
    const both = (q) => q.js(`(() => { const s = window.jriterDaw.song(); return s.bpm === 140 && s.tracks[0].volume === 0.5; })()`);
    let ok = false;
    for (let i = 0; i < 80 && !ok; i++) { await sleep(100); ok = (await both(A)) && (await both(B)); }
    const t1 = Date.now() - t0;
    log("together: BPM from A and volume from B both on both pages after " + t1 + " ms");
    need(ok, "not in step after 8 s: A " + (await A.js(`JSON.stringify([window.jriterDaw.song().bpm, window.jriterDaw.song().tracks[0].volume])`)) + " B " + (await B.js(`JSON.stringify([window.jriterDaw.song().bpm, window.jriterDaw.song().tracks[0].volume])`)));
    const c = JSON.parse(await A.js(`JSON.stringify(window.jriterDaw.song())`));
    c.tracks[0].name = "Edited by A";
    const t2 = Date.now();
    await A.js(`window.jriterDaw.load(${JSON.stringify(JSON.stringify(c))})`);
    let seen = false;
    for (let i = 0; i < 40 && !seen; i++) { await sleep(100); seen = (await B.js(`window.jriterDaw.song().tracks[0].name`)) === "Edited by A"; }
    log("together: a later edit by A reached B in " + (Date.now() - t2) + " ms");
    need(seen, "B never saw A's later edit");
    await send("Target.closeTarget", { targetId: A.targetId }).catch(() => {}); await send("Target.closeTarget", { targetId: B.targetId }).catch(() => {});
    await send("Target.disposeBrowserContext", { browserContextId: c1 }).catch(() => {}); await send("Target.disposeBrowserContext", { browserContextId: c2 }).catch(() => {});
  });

  await scenario("no page errors the whole time", async () => { need(!pageErrors.length, pageErrors.join(" | ")); });
} catch (e) {
  results.push([false, "harness: " + e.message]);
}
for (const [ok, name] of results) console.log((ok ? "  ok   " : "  FAIL ") + name);
const bad = results.filter(([ok]) => !ok).length;
console.log(bad ? bad + " failed" : "all " + results.length + " passed");
try { ws?.close(); } catch { /* gone */ }
await closeBrowser(edge, profile);
server.close();
process.exit(bad ? 1 : 0);
