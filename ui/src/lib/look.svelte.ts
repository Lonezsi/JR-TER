/* How the app looks right now: the accent, the ground behind the glass, the dials.
 *
 * Three things that used to be decided in three places and fought. Each has one owner
 * here and one rule for who may change it.
 */
import { app } from "./app.svelte";
import { clamp, hue as hueOf } from "./util";
import { rgb, neon, hueOfImage } from "./color";
import { dust, dither } from "./ambient";
import { glassGL } from "./glass/glass.svelte";
import { u } from "./api";
import type { Song, Settings } from "./types";

// ── the accent ──────────────────────────────────────────────────────────────

let showing: string | null = null;

function applyAccent(hex: string | null | undefined) {
  if (!hex || hex === showing) return;
  showing = hex;
  const root = document.documentElement;
  // --accent is a registered <color> with a transition on :root, so this glides and
  // carries every tint in the app with it. -hi, -lo, -soft and -line are color-mix of it
  // in the stylesheet; setting them here would pin them and they would stop following.
  root.style.setProperty("--accent", hex);
  // Only the bare numbers, for canvases that build their own rgba() from them.
  const { r, g, b } = rgb(hex);
  root.style.setProperty("--accent-rgb", `${r}, ${g}, ${b}`);
  dust.retint();
}

/* Who decides the accent, in order:
 *
 *   the accent chosen in Settings                                   always the base
 *   and if adaptive colours are on:
 *     a song page open   that song's colour, whatever is playing
 *     otherwise          what is on the player: a render's own waveform colour, or a
 *                        song's artwork, neonised
 *     nothing at all     back to the chosen accent
 *
 * It changes when playback or the open song changes, which is rarely and deliberately,
 * and never because of a redraw.
 */
let held = false;
let open: { song: Song; cover: string | null } | null = null;
let playing: { item: Song; isRender: boolean } | null = null;
let token = 0;

async function fromSong(song: Song, known?: string | null) {
  const mine = ++token;
  const cover = known || song.art
    || (song.artwork_id ? u(`/api/artwork/${song.artwork_id}/image`) : null);
  let hue: number | null = cover ? await hueOfImage(cover) : null;
  if (mine !== token) return;                 // something else took over meanwhile
  if (hue === null) hue = hueOf(song.title || "");
  applyAccent(neon(hue));
}

function decide() {
  if (held) return;
  const chosen = app.settings.accent || "#FAA8B8";
  if (!app.settings.adaptive) { token++; applyAccent(chosen); return; }
  if (open) { fromSong(open.song, open.cover); return; }
  if (!playing) { token++; applyAccent(chosen); return; }
  if (playing.isRender) {
    token++;
    // The hue a render is already drawn in everywhere else: its name, minus extension.
    const name = String(playing.item.title || "").replace(/\.[^.]+$/, "");
    applyAccent(neon(hueOf(name)));
    return;
  }
  fromSong(playing.item);
}

export const accent = {
  refresh: decide,
  /** The song whose page is open, with the cover that page resolved. Null on leaving. */
  viewing(song: Song | null, cover?: string | null) {
    const same = open && song && open.song.id === song.id && open.cover === (cover || null);
    if (same) return;
    open = song ? { song, cover: cover || null } : null;
    decide();
  },
  /** What the player is holding. Called by the player on a change of track only. */
  playing(item: Song | null, isRender = false) {
    playing = item ? { item, isRender } : null;
    decide();
  },
  /** Settings previews a colour while the picker is dragged. hold() stops everything
   *  else writing over it; release() decides again. */
  hold() { held = true; },
  release() { held = false; showing = null; decide(); },
  preview(hex: string) { showing = null; applyAccent(hex); },
};

// ── the ground ──────────────────────────────────────────────────────────────

/* The picture behind the whole app. A song puts its artwork here, enormous and out of
 * focus, so the glass has something with colour in it to bend. Idempotent: asking for
 * what is already there does nothing, which is what stops it fading out and back in. */
export const ground = $state<{ url: string | null; hue: number | null }>({ url: null, hue: null });

/* What the open screen asked for, kept so the setting can be turned on and off live. With
 * "Artwork behind the app" off (the default) every screen gets black, whatever it asked. */
let asked: { url: string | null; hue: number | null } = { url: null, hue: null };

export function reapplyGround() { setGround(asked.url, asked.hue, true); }

export function setGround(url: string | null, hue: number | null = null, again = false) {
  if (!again) asked = { url, hue };
  if (!app.settings.artwork_ground) { url = null; hue = null; }
  if (ground.url === url && ground.hue === hue) return;
  ground.url = url;
  ground.hue = hue;
  // A picture is the thing the dust was standing in for.
  // The shader draws the ground and its own dust when it is running; otherwise the CSS
  // ground is shown and the 2D dust stands in. A picture is the thing the dust was for.
  if (glassGL.ground(url, hue)) return;
  if (url) dust.stop(); else dust.start(hue);
}

/* Which screens put something behind the app. Deciding by screen rather than by timing
 * is what makes song to song a cross fade and song to library a clean exit: on the way
 * to a screen that claims the ground, what is there stays until the new one arrives. */
const CLAIMS = new Set(["song", "album", "playlist", "share"]);

export function arriving(view: string) {
  if (CLAIMS.has(view)) return;
  setGround(null, null);
  accent.viewing(null);
}

// ── the dials ───────────────────────────────────────────────────────────────

/* The chromatic dial is how far the rim of a pane splits light into warm and cool edges.
 * It is one number on <html> that the glass's inset shadows are scaled by (--edge-k in
 * base.css). It used to be an SVG displacement filter written into a backdrop-filter, and
 * that SVG reference is what flickered: Blink rasters it in tiles whose seams show. Nothing
 * here writes a filter. */
export function applyLook(settings: Partial<Settings>) {
  const edge = clamp(Number(settings.glass_edge ?? 100), 0, 200);
  const root = document.documentElement;
  root.style.setProperty("--edge-k", String(edge / 100));
  glassGL.look({ edge, dust: Number(settings.dust ?? 100) });
  // Whatever an older build wrote inline would outrank the stylesheet, so it is taken off.
  root.style.removeProperty("--glass-filter-edge");
  dither.apply(Number(settings.dither ?? 60));
  dust.strength(Number(settings.dust ?? 100));
}

/** Register an uploaded display face under one name, so every title can ask for
 *  "Jriter Display" and get either your font or the open one behind it. */
export function wearFont(info: { custom_font?: boolean; font_format?: string; uploaded_at?: number } | undefined) {
  document.getElementById("jriter-display-face")?.remove();
  if (!info?.custom_font) return;
  const format = ({ "font/ttf": "truetype", "font/otf": "opentype",
                    "font/woff": "woff", "font/woff2": "woff2" } as Record<string, string>)[info.font_format || ""] || "truetype";
  const style = document.createElement("style");
  style.id = "jriter-display-face";
  style.textContent = `@font-face {
    font-family: "Jriter Display";
    src: url("/api/appearance/font?v=${Math.floor(info.uploaded_at || 0)}") format("${format}");
    font-display: swap;
  }`;
  document.head.appendChild(style);
}
