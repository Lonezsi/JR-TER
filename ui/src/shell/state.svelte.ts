/* The shell's own state: whether the sidebar is put away, whether the palette is open,
 * what is waiting in the inbox. Kept apart from the components so a key, a menu or the
 * palette can change any of it without reaching into a component. */
import { store } from "$lib/util";
import { get } from "$lib/api";
import { has } from "$lib/app.svelte";
import type { Album, Playlist, Render, Song } from "$lib/types";

const RAIL_KEY = "jriter.rail.shut";

export const shell = $state({
  /** A deliberate choice on a wide screen, remembered per browser. */
  railShut: store.raw(RAIL_KEY) === "1",
  /** The phone's slide-over menu. Never remembered: it always starts out of the way. */
  drawer: false,
  palette: false,
  paletteSeed: "",
  /** The queue and A/B panel over the player. */
  nowPlaying: false,
  keys: false,
  narrow: false,
  waiting: 0,
  /** The newest renders still waiting, for the sidebar. From the same answer as the count. */
  renders: [] as Render[],
  /** Every song, most recently touched first, for the sidebar's Songs section and pins. */
  songs: [] as Song[],
  albums: [] as Album[],
  playlists: [] as Playlist[],
  updateReady: false,
  updateNote: "",
});

/* Is this a phone sized window. One answer, asked of the window itself and written on
 * <html> for the stylesheet, so the layout numbers and the components always agree.
 * Watched three ways because each one is missed somewhere: a media query's change event
 * does not fire in every embedded browser, and a resize does not fire on a zoom. */
const NARROW = "(max-width: 900px)";
export function watchNarrow(): () => void {
  const query = matchMedia(NARROW);
  const set = () => {
    const narrow = query.matches || window.innerWidth <= 900;
    if (narrow !== shell.narrow) {
      shell.narrow = narrow;
      if (!narrow) shell.drawer = false;
    }
    document.documentElement.toggleAttribute("data-narrow", narrow);
  };
  set();
  query.addEventListener("change", set);
  window.addEventListener("resize", set);
  window.addEventListener("orientationchange", set);
  return () => {
    query.removeEventListener("change", set);
    window.removeEventListener("resize", set);
    window.removeEventListener("orientationchange", set);
  };
}

export function toggleRail() {
  if (shell.narrow) { shell.drawer = !shell.drawer; return; }
  shell.railShut = !shell.railShut;
  store.setRaw(RAIL_KEY, shell.railShut ? "1" : "0");
}

export function openPalette(seed = "") {
  shell.paletteSeed = seed;
  shell.palette = true;
}

/** How many renders are still waiting to be told what they are. Read from the server
 *  rather than counted in the page, because the desktop client adds to that list too. */
export async function refreshWaiting() {
  if (!has("renders")) { shell.waiting = 0; shell.renders = []; return; }
  try {
    const data = await get("/api/renders");
    shell.waiting = data.waiting || 0;
    shell.renders = (data.renders || []).slice(0, 6);
  } catch { /* keep the old number */ }
}

export async function refreshSongs() {
  try {
    const list: Song[] = (await get("/api/songs")).songs || [];
    shell.songs = list.sort((a, b) => Number((b as any).updated_at || 0) - Number((a as any).updated_at || 0));
  } catch { /* keep */ }
}

export async function refreshAlbums() {
  if (!has("albums")) { shell.albums = []; return; }
  try { shell.albums = (await get("/api/albums")).albums || []; } catch { /* keep */ }
}

/** Playlists of your own. An album's own is reached through the album, which is where
 *  the songs in it are decided: listing it separately would be two doors to one room. */
export async function refreshPlaylists() {
  if (!has("playlists")) { shell.playlists = []; return; }
  try {
    shell.playlists = ((await get("/api/playlists")).playlists || []).filter((p: Playlist) => !p.album_id);
  } catch { /* keep */ }
}
