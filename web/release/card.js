// card.js: builds a release card for one album. Pure data, no DOM, so node can test it.
// The card is a plain JSON file that explains itself (see ABOUT); the release page saves it
// next to the cover and the mixes, and an agent on the owner's PC reads it from there.

export const FORMAT = "jriter-release";
export const VERSION = 1;

// The recipe for the agent. This is the only copy of it.
export const ABOUT = [
  "This file describes one album to release on RouteNote. Format 'jriter-release' version 1.",
  "The files it names (cover.file and tracks[].file) are in the same folder as this card.",
  "What to do:",
  "1. Drive the owner's own Brave with the mcp__brave-bridge__* tools. If it says not connected, start C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe.",
  "2. Open routenote.com and ask the owner to sign in themselves. Never type, read or store a password or cookie. Wait until they say they are done.",
  "3. Start a new release. Fill in the release fields, then upload the cover. For each track in order, upload its file and fill in its title, explicit flag and credits. File inputs need a real OS dialog: click the upload button, type the full path into the Windows dialog and press Enter.",
  "4. If RouteNote asks for something that is not in this card, ask the owner and do not invent it. Do not pay for anything, pick a paid tier or accept new terms for the owner; ask them.",
  "5. Stop at the final review screen and summarise what will be sent. Press the final submit only after the owner writes OK in this chat.",
  "6. Afterwards, say what was submitted. Then open the page named in 'release_page' in the same Brave and fill its Released box, then press Save: the release date always; the store link and the UPC only once RouteNote shows them. If RouteNote has no UPC yet, save only the date.",
  "Pages change, so work from what is on screen. 'checks' lists problems JR!TER already saw; mention them to the owner.",
].join("\n");

const LOSSY = [".mp3", ".m4a", ".aac", ".ogg", ".opus"];

/** The mix to release for a song: the one chosen as current, else the latest. */
export function mixOf(song) {
  return song.current_version_id || song.latest_version_id || song.version_id || null;
}

/** An ASCII file-name part from a title. */
export function slug(title) {
  const s = String(title || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase().slice(0, 40);
  return s || "track";
}

const pad = (n) => String(n).padStart(2, "0");

/** File names the page saves. exts = {cover: ".jpg", tracks: [".wav", ...]}. */
export function fileNames(albumId, songs, exts) {
  return {
    card: `jriter-release-${albumId}.json`,
    cover: exts && exts.cover ? `jriter-release-${albumId}-cover${exts.cover}` : null,
    tracks: songs.map((s, i) =>
      `jriter-release-${albumId}-${pad(i + 1)}-${slug(s.title)}${(exts && exts.tracks && exts.tracks[i]) || ".wav"}`),
  };
}

/** Sentences for the owner about things a store is likely to reject. */
export function checks(card) {
  const out = [];
  const r = card.release;
  if (!r.title) out.push("The release has no title.");
  if (!r.artist) out.push("The release has no artist.");
  if (!r.release_date) out.push("The release has no date.");
  if (!card.tracks.length) out.push("The album has no songs.");
  if (!card.cover) out.push("The album has no cover.");
  else if (card.cover.width && card.cover.height) {
    if (card.cover.width !== card.cover.height) out.push("The cover is not square.");
    else if (card.cover.width < 3000) out.push(`The cover is ${card.cover.width}x${card.cover.height}; stores usually ask for 3000x3000.`);
  }
  card.tracks.forEach((t) => {
    if (!t.file) out.push(`"${t.title}" has no mix.`);
    else if (LOSSY.some((e) => t.file.toLowerCase().endsWith(e))) out.push(`"${t.title}" is a lossy file; stores want WAV or FLAC.`);
    if (!t.title) out.push(`Track ${t.n} has no title.`);
  });
  return out;
}

/**
 * album: the album row; songs: its songs in order; details: what the owner typed
 * (artist, release_date, genre, language, label, copyright, notes, writers, producers,
 * performers, explicit: [bool per track]); files: from fileNames(); cover: {width,height}|null.
 */
export function buildCard(album, songs, details, origin, files, cover) {
  const d = details || {};
  const f = files || fileNames(album.id, songs, null);
  const card = {
    format: FORMAT,
    version: VERSION,
    about: ABOUT,
    made: new Date().toISOString(),
    from: `${origin || ""}/#/album/${album.id}`,
    release_page: `${origin || ""}/release.html?album=${album.id}`,
    store: "RouteNote",
    release: {
      title: album.title || "",
      artist: d.artist || "",
      release_date: d.release_date || (album.year ? String(album.year) : ""),
      genre: d.genre || "",
      language: d.language || "",
      label: d.label || "",
      copyright: d.copyright || "",
      notes: d.notes || album.notes || "",
    },
    cover: album.has_cover && f.cover ? { file: f.cover, width: cover ? cover.width : 0, height: cover ? cover.height : 0 } : null,
    tracks: songs.map((s, i) => ({
      n: i + 1,
      title: s.title || "",
      file: mixOf(s) && f.tracks[i] ? f.tracks[i] : "",
      duration: Math.round((s.duration || 0) * 100) / 100,
      explicit: !!(d.explicit && d.explicit[i]),
      writers: d.writers || "",
      producers: d.producers || "",
      performers: d.performers || "",
      isrc: "",
    })),
    checks: [],
  };
  card.checks = checks(card);
  return card;
}
