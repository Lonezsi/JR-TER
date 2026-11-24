// library.js: ask the JR!TER library which sounds it has. Fetch only, same origin, your cookie.
// Every function throws Error("signin") when you are not signed in, so the page can say so.

async function get(url) {
  const r = await fetch(url, { credentials: "include" });
  if (r.status === 401 || r.status === 403) throw new Error("signin");
  if (!r.ok) throw new Error("The library said " + r.status + ".");
  return r.json();
}

const name = (s, fallback) => String(s || fallback || "Sound").replace(/\.[a-z0-9]{2,4}$/i, "");

export async function librarySongs() {
  const j = await get("/api/songs");
  return (j.songs || []).map((s) => ({ id: s.id, title: s.title || "Untitled" }));
}

// The takes (mixes, renders kept as versions) and vocal takes of one song.
export async function soundsOf(songId, prefix = "/api") {
  const [v, t] = await Promise.all([get(`${prefix}/songs/${songId}/versions`), get(`${prefix}/songs/${songId}/vocals`)]);
  return [
    ...(v.versions || []).map((x) => ({ kind: "take", name: name(x.label || x.filename, "v" + x.n), src: `/api/versions/${x.id}/audio`, seconds: x.duration || 0 })),
    ...(t.takes || []).map((x) => ({ kind: "vocal", name: name(x.label || x.name, "Vocal"), src: `/api/vocals/${x.id}/audio`, seconds: x.duration || 0 })),
  ];
}

// Renders that arrived from FL and have no song yet.
export async function waitingRenders() {
  const j = await get("/api/renders");
  return (j.renders || []).map((x) => ({ kind: "render", name: name(x.filename, "Render"), src: `/api/renders/${x.id}/audio`, seconds: x.duration || 0 }));
}

// ---- your own one-shots (server module samples): files you bring from your computer ----------

export async function mySamples() {
  const j = await get("/api/samples");
  return (j.samples || []).map((x) => ({ kind: /^\.midi?$/i.test(x.ext || "") ? "midi" : "oneshot", id: x.id, name: x.name, folder: x.folder || "", src: `/api/samples/${x.id}/audio`, seconds: x.duration || 0 }));
}

// How long a sound is, from its bytes. 0 when the browser cannot decode it (it is kept anyway).
async function lengthOf(bytes) {
  try {
    const ctx = new OfflineAudioContext(1, 1, 44100);
    return (await ctx.decodeAudioData(bytes.slice(0))).duration;
  } catch { return 0; }
}

// The folder a file came from when a whole folder was picked or dropped: "Drums / Kicks".
export const folderOf = (file) => String(file.webkitRelativePath || file._path || "").split("/").slice(0, -1).join(" / ");

// Sounds, and MIDI files (a pack's melodies sit next to its hits; they drop into patterns).
export const isSound = (file) => /\.(wav|mp3|ogg|opus|flac|m4a|aiff?|midi?)$/i.test(file.name) || /^audio\//.test(file.type);
export const MIDI_TYPE = "application/x-jriter-midi";
export const SOUND_TYPE = "application/x-jriter-sound"; // a Browser sound dragged to the Drumroll, a track or the Layout

// Upload files one by one. Returns { added, skipped, failed } counts.
export async function uploadSamples(files, onProgress) {
  const out = { added: 0, skipped: 0, failed: 0 };
  const list = [...files];
  for (let i = 0; i < list.length; i++) {
    const f = list[i];
    if (!isSound(f)) { out.skipped++; continue; }
    if (onProgress) onProgress(i + 1, list.length, f.name);
    try {
      const bytes = await f.arrayBuffer();
      const r = await fetch("/api/samples", { method: "POST", credentials: "include", body: bytes, headers: {
        "Content-Type": "application/octet-stream", "X-Filename": encodeURIComponent(f.name), "X-Folder": encodeURIComponent(folderOf(f)), "X-Duration": String(await lengthOf(bytes)) } });
      if (r.status === 401 || r.status === 403) throw new Error("signin");
      if (r.ok) out.added++; else out.failed++;
    } catch (e) { if (e.message === "signin") throw e; out.failed++; }
  }
  return out;
}

// Rename a sound or move it to another folder ({ name } and/or { folder }, "Drums / Kicks" for nesting).
export async function changeSample(id, fields) {
  const r = await fetch("/api/samples/" + id, { method: "PATCH", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(fields) });
  return r.ok;
}
// Run one call per sound, a few at a time, so a folder of a thousand moves in seconds, not minutes.
export async function each(list, fn, onProgress) {
  let done = 0, ok = 0, next = 0;
  const lane = async () => { while (next < list.length) { const x = list[next++]; if (await fn(x).catch(() => false)) ok++; done++; if (onProgress) onProgress(done, list.length); } };
  await Promise.all(Array.from({ length: Math.min(8, list.length) }, lane));
  return ok;
}

export async function removeSample(id) { const r = await fetch("/api/samples/" + id, { method: "DELETE", credentials: "include" }); return r.ok; }
export async function restoreSample(id) { const r = await fetch("/api/samples/" + id + "/restore", { method: "POST", credentials: "include" }); return r.ok; }
