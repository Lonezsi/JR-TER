// together.js: keep a song's DAW project on the server and in step with friends.
//   const t = startTogether({ songId, shareId, getText, applyText, getCursor, onPeople, onStatus });
//   t.saved()   call after every local change; the save goes out 400 ms later
//   apiPrefix(shareId)  the url prefix for this song's other routes: "/api" for the owner,
//                       the share's own door for a guest
// The server stores one text and a revision. A save names the revision it grew from; if
// somebody saved in between, the answer is the current text and merge.js joins the two.
// Offline, or signed out: nothing here throws, the DAW just keeps saving in the browser.
import { mergeTexts } from "./merge.js";

export function apiPrefix(shareId) { return shareId ? `/api/shared/${encodeURIComponent(shareId)}/on` : "/api"; }

export function startTogether({ songId, shareId, getText, applyText, getCursor, onPeople, onStatus }) {
  const url = `${apiPrefix(shareId)}/songs/${encodeURIComponent(songId)}/daw`;
  let rev = 0, baseText = "", pushTimer = 0, busy = false, again = false, ready = false, stopped = false;
  const call = async (method, path, body) => {
    const r = await fetch(url + path, { method, credentials: "include", headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
    if (!r.ok) throw new Error("status " + r.status);
    return r.json();
  };
  const status = (s) => { if (onStatus) onStatus(s); };

  // Join what came from the server with what is on screen, and show the result.
  function take(server) {
    const mine = getText();
    let next = server.text;
    if (mine !== baseText && mine !== server.text) {
      try { next = mergeTexts(baseText, mine, server.text); } catch { next = mine; }
    }
    baseText = server.text; rev = server.rev;
    if (next !== mine) applyText(next);
  }

  async function push() {
    if (!ready) return;
    if (busy) { again = true; return; }
    busy = true;
    try {
      for (let tries = 0; tries < 4; tries++) {
        const text = getText();
        if (text === baseText) break;
        const r = await call("PUT", "", { text, base: rev });
        if (r.conflict) { take(r); continue; }
        baseText = text; rev = r.rev;
        break;
      }
      status("ok");
    } catch { status("offline"); }
    busy = false;
    if (again) { again = false; push(); }
  }

  async function beat() {
    if (stopped) return;
    try {
      const j = await call("POST", "/here", { cursor: getCursor() });
      onPeople(j.people || []);
      if (j.rev !== rev && !busy && !pushTimer) take(await call("GET", ""));
      status("ok");
    } catch { status("offline"); }
    setTimeout(beat, document.hidden ? 5000 : 1000);
  }

  (async () => {
    try {
      const j = await call("GET", "");
      onPeople(j.people || []);
      ready = true;
      if (!j.text) { rev = 0; baseText = ""; await push(); } // first time for this song: what is saved in this browser becomes the shared project
      else take(j);
      status("ok");
    } catch { status("offline"); ready = false; }
    if (ready) beat();
  })();

  return {
    saved() { if (!ready) return; clearTimeout(pushTimer); pushTimer = setTimeout(() => { pushTimer = 0; push(); }, 400); },
    stop() { stopped = true; },
  };
}
