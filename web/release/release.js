// release.js: the release page. List albums, or edit one album's release details and save the
// card and files for the agent. Everything is built with textContent, never with HTML strings.
import { buildCard, fileNames, checks, mixOf } from "./card.js";

const app = document.getElementById("app");
const albumId = new URLSearchParams(location.search).get("album");

function el(tag, props, ...kids) {
  const e = document.createElement(tag);
  Object.assign(e, props || {});
  if (props && props.tip) { e.setAttribute("data-tip", props.tip); e.setAttribute("aria-label", props.tip); }
  kids.flat().forEach((k) => e.append(k));
  return e;
}
function toast(text) {
  const t = el("div", { className: "toast", textContent: text });
  document.getElementById("toasts").append(t);
  setTimeout(() => t.remove(), 6000);
}
async function api(path) {
  const r = await fetch(path, { credentials: "same-origin" });
  if (!r.ok) throw new Error(`${path}: ${r.status}`);
  return r.json();
}
const ICON = {
  down: "M12 4v10m0 0l-4-4m4 4l4-4M5 19h14",
  go: "M5 12h14m0 0l-6-6m6 6l-6 6",
  copy: "M9 9h10v10H9zM5 15V5h10",
  check: "M5 12l5 5L19 7",
};
function icon(name) {
  const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  s.setAttribute("viewBox", "0 0 24 24"); s.setAttribute("fill", "none"); s.setAttribute("stroke", "currentColor");
  s.setAttribute("stroke-width", "2"); s.setAttribute("stroke-linecap", "round"); s.setAttribute("stroke-linejoin", "round");
  const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
  p.setAttribute("d", ICON[name]); s.append(p);
  return s;
}

async function pickAlbum() {
  const { albums } = await api("/api/albums");
  app.replaceChildren(
    el("h1", { textContent: "Release an album" }),
    el("p", { className: "mute", textContent: "Pick an album." }),
    el("ul", { className: "albums" }, albums.map((a) => el("li", {}, el("a", { href: `?album=${a.id}` },
      a.has_cover ? el("img", { src: `/api/albums/${a.id}/cover`, alt: "", loading: "lazy" }) : el("div", { className: "ph" }),
      el("span", { textContent: a.title }))))));
}

const extOf = (name, type) => {
  const m = /\.([A-Za-z0-9]{2,5})$/.exec(name || "");
  if (m) return "." + m[1].toLowerCase();
  const map = { "audio/wav": ".wav", "audio/x-wav": ".wav", "audio/flac": ".flac", "audio/mpeg": ".mp3", "audio/mp4": ".m4a", "audio/ogg": ".ogg", "image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp" };
  return map[(type || "").split(";")[0]] || "";
};
function nameFrom(resp) {
  const m = /filename="?([^";]+)"?/.exec(resp.headers.get("Content-Disposition") || "");
  return m ? m[1] : "";
}
function saveBlob(blob, name) {
  const a = el("a", { href: URL.createObjectURL(blob), download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}
async function imageSize(blob) {
  try { const b = await createImageBitmap(blob); return { width: b.width, height: b.height }; } catch { return null; }
}

async function editAlbum(id) {
  const { album, songs } = await api(`/api/albums/${encodeURIComponent(id)}`);
  const key = `jriter.release.${id}`;
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(key) || "{}"); } catch { /* start empty */ }
  const fields = {};
  const FIELDS = [["artist", "Artist"], ["release_date", "Release date"], ["genre", "Genre"], ["language", "Language"],
    ["label", "Label"], ["copyright", "Copyright line"], ["writers", "Writers (all tracks)"],
    ["producers", "Producers (all tracks)"], ["performers", "Performers (all tracks)"]];
  const explicit = songs.map((_, i) => !!(saved.explicit || [])[i]);
  const warn = el("ul", { className: "checks" });

  const read = () => {
    const d = { explicit };
    for (const k in fields) d[k] = fields[k].value.trim();
    d.notes = notes.value.trim();
    return d;
  };
  const preview = () => {
    const d = read();
    try { localStorage.setItem(key, JSON.stringify(d)); } catch { /* storage off: still works */ }
    const f = fileNames(album.id, songs, { cover: ".jpg", tracks: songs.map(() => ".wav") });
    const c = buildCard(album, songs, d, location.origin, f, null);
    // Size and file type are only known after the download; these are the ones known now.
    const list = checks(c).filter((t) => !/cover is|lossy/.test(t));
    warn.replaceChildren(...list.map((t) => el("li", { textContent: t })));
    warn.hidden = !list.length;
  };

  FIELDS.forEach(([k, label]) => {
    const input = el("input", { type: k === "release_date" ? "date" : "text", value: saved[k] || "" });
    input.addEventListener("input", preview);
    fields[k] = input;
  });
  const notes = el("textarea", { rows: 3, value: saved.notes || album.notes || "" });
  notes.addEventListener("input", preview);

  const doDownload = async (btns) => {
    btns.forEach((b) => (b.disabled = true));
    try {
      const exts = { cover: "", tracks: [] };
      const blobs = { cover: null, tracks: [] };
      let size = null;
      if (album.has_cover) {
        const r = await fetch(`/api/albums/${album.id}/cover`, { credentials: "same-origin" });
        if (r.ok) { blobs.cover = await r.blob(); exts.cover = extOf(nameFrom(r), blobs.cover.type) || ".jpg"; size = await imageSize(blobs.cover); }
      }
      for (const s of songs) {
        const v = mixOf(s);
        if (!v) { blobs.tracks.push(null); exts.tracks.push(""); continue; }
        const r = await fetch(`/api/versions/${v}/download`, { credentials: "same-origin" });
        if (!r.ok) { blobs.tracks.push(null); exts.tracks.push(""); continue; }
        const b = await r.blob();
        blobs.tracks.push(b); exts.tracks.push(extOf(nameFrom(r), b.type) || ".wav");
      }
      const f = fileNames(album.id, songs, exts);
      // A track whose file could not be fetched has no mix as far as the card is concerned.
      const usable = songs.map((s, i) => (blobs.tracks[i] ? s : { ...s, current_version_id: null, latest_version_id: null, version_id: null }));
      const card = buildCard(album, usable, read(), location.origin, f, size);
      if (!blobs.cover) card.cover = null, card.checks = checks(card);
      saveBlob(new Blob([JSON.stringify(card, null, 2)], { type: "application/json" }), f.card);
      if (blobs.cover) saveBlob(blobs.cover, f.cover);
      blobs.tracks.forEach((b, i) => { if (b) saveBlob(b, f.tracks[i]); });
      toast(`Saved ${f.card} and ${blobs.tracks.filter(Boolean).length} mixes to your Downloads folder.`);
      card.checks.forEach((t) => toast(t));
      return true;
    } catch (e) {
      toast("That did not work: " + e.message);
      return false;
    } finally {
      btns.forEach((b) => (b.disabled = false));
    }
  };

  const bDown = el("button", { className: "b", type: "button", tip: "Save the release card, cover and mixes to Downloads" }, icon("down"), "Download");
  const bGo = el("button", { className: "b go", type: "button", tip: "Download, then open the JR!TER desktop app, which starts Claude Code on your PC. Needs: jriter-cli shell install" }, icon("go"), "Hand to Wh;le");
  const bCopy = el("button", { className: "b", type: "button", tip: "Copy the command to run it by hand" }, icon("copy"), "Copy command");
  const both = [bDown, bGo];
  bDown.onclick = () => doDownload(both);
  bGo.onclick = async () => { if (await doDownload(both)) { toast("Opening JR!TER on your PC. Sign in to RouteNote yourself when asked."); setTimeout(() => (location.href = `jriter://release/${album.id}`), 1500); } };
  bCopy.onclick = async () => {
    try { await navigator.clipboard.writeText(`jriter-cli release ${album.id}`); toast("Copied."); } catch { toast(`jriter-cli release ${album.id}`); }
  };

  const rel = {
    released_at: el("input", { type: "date", name: "released_at", value: album.released_at || "" }),
    store_link: el("input", { type: "url", name: "store_link", placeholder: "https://", value: album.store_link || "" }),
    upc: el("input", { type: "text", name: "upc", inputMode: "numeric", value: album.upc || "" }),
  };
  const bSave = el("button", { className: "b", type: "button", tip: "Save the release on the album" }, icon("check"), "Save");
  bSave.onclick = async () => {
    bSave.disabled = true;
    try {
      const r = await fetch(`/api/albums/${album.id}`, {
        method: "PATCH", credentials: "same-origin", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ released_at: rel.released_at.value, store_link: rel.store_link.value, upc: rel.upc.value }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || r.status);
      for (const k in rel) rel[k].value = j.album[k] || "";
      toast("Saved on the album.");
    } catch (e) {
      toast("That did not save: " + e.message);
    } finally {
      bSave.disabled = false;
    }
  };

  app.replaceChildren(
    el("div", { className: "panel head" },
      album.has_cover ? el("img", { className: "cover", src: `/api/albums/${album.id}/cover`, alt: "" }) : el("div", { className: "cover" }),
      el("div", {}, el("h1", { textContent: album.title }),
        el("div", { className: "mute", textContent: `${songs.length} songs${album.year ? " · " + album.year : ""}` }),
        el("a", { href: "?", className: "mute", textContent: "Other albums" }))),
    el("div", { className: "panel" }, el("h2", { textContent: "Release details" }),
      el("div", { className: "grid" }, FIELDS.map(([k, label]) => el("label", { className: "f" }, label, fields[k]))),
      el("label", { className: "f", style: "margin-top:8px" }, "Notes", notes)),
    el("div", { className: "panel" }, el("h2", { textContent: "Tracks" }),
      el("ol", { className: "tracks" }, songs.map((s, i) => {
        const cb = el("input", { type: "checkbox", checked: explicit[i] });
        cb.addEventListener("change", () => { explicit[i] = cb.checked; preview(); });
        return el("li", {}, el("span", { className: "n", textContent: String(i + 1) }),
          el("span", { className: "t", textContent: s.title }),
          el("span", { className: "mute", textContent: mixOf(s) ? "" : "no mix" }),
          el("label", {}, cb, "Explicit"));
      }))),
    el("div", { className: "panel", id: "released" }, el("h2", { textContent: "Released" }),
      el("div", { className: "grid" },
        el("label", { className: "f" }, "Release date", rel.released_at),
        el("label", { className: "f" }, "Store link", rel.store_link),
        el("label", { className: "f" }, "UPC", rel.upc)),
      el("div", { className: "bar", style: "margin-top:8px" }, bSave)),
    warn,
    el("div", { className: "bar" }, bDown, bGo, bCopy));
  preview();
}

(albumId ? editAlbum(albumId) : pickAlbum()).catch((e) => {
  app.replaceChildren(el("p", { textContent: "Could not load: " + e.message }),
    el("p", { className: "mute", textContent: "Sign in to JR!TER first, then reload this page." }));
});
