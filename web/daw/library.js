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
export async function soundsOf(songId) {
  const [v, t] = await Promise.all([get(`/api/songs/${songId}/versions`), get(`/api/songs/${songId}/vocals`)]);
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
