/* The shapes and small answers the library screens share: what a search sends back,
 * what a playlist holds, where a cover lives. Nothing here touches the page. */
import { u } from "$lib/api";
import type { Album, Playlist, Render, Song } from "$lib/types";

/** Something a list can play: a song, or a loose render (`kind: "render"`). */
export type Entry = Song | Render;

export interface AlbumRow extends Album {
  notes?: string;
  duration?: number;
  cover_digest?: string;
  released_at?: number | string | null;
  store_link?: string | null;
  upc?: string | null;
  created_at?: number;
  updated_at?: number;
}

export interface PlaylistItem {
  item_id: number;
  position: number;
  kind: "song" | "render";
  title: string;
  song?: Song;
  render?: Render;
}

export interface PlaylistFull extends Playlist {
  items: PlaylistItem[];
  created_at?: number;
  updated_at?: number;
}

export interface Hit {
  id?: number | string;
  title?: string;
  sub?: string;
  line?: string;
  href?: string;
  has_cover?: boolean;
  [key: string]: unknown;
}

export interface SearchGroup {
  label: string;
  kind: string;
  total: number;
  hits: Hit[];
  error?: string;
}

export interface SearchResult {
  query: string;
  groups: SearchGroup[];
  looked_in: string[];
}

export interface SharedRow {
  share: number;
  title: string;
  from: string;
  from_handle?: string;
  as_name?: string | null;
  created_at?: number;
  can_play?: boolean;
  art?: number | null;
}

/** One line in a picker: a song or a waiting render that could be chosen. */
export interface Candidate {
  key: string;
  id: number;
  kind: "song" | "render";
  title: string;
  sub?: string;
  art?: string | null;
}

export const isRender =(item: Entry): item is Render => item.kind === "render";

export const titleOf = (item: Entry): string =>
  String((item as Song).title || (item as Render).name || (item as Render).filename || "render");

/** What the player calls this thing: a loose render plays under a stand-in id. */
export const playerIdOf = (item: Entry): string =>
  isRender(item) ? `render:${item.id}` : String(item.id);

export const songCover = (song: Song): string | null =>
  song.art || (song.artwork_id ? u(`/api/artwork/${song.artwork_id}/image`) : null);

/** An album's cover. The digest rides along so a replaced cover is a new address and
 *  the browser does not keep showing the old one; an unchanged one stays cached. */
export const albumCover = (album: AlbumRow | Album | null | undefined): string | null => {
  if (!album || !album.has_cover) return null;
  const digest = String((album as AlbumRow).cover_digest || "").slice(0, 10);
  return `/api/albums/${album.id}/cover${digest ? "?v=" + digest : ""}`;
};

export function shuffled<T>(list: T[]): T[] {
  const order = list.slice();
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}

/** Move one element of a list, as a new list. */
export function moved<T>(list: T[], from: number, to: number): T[] {
  const next = list.slice();
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

/** A term found inside a text, as three plain pieces, so the match can be marked with
 *  an element and nothing the server sent is ever treated as markup. */
export function pieces(text: string | null | undefined, term: string): [string, string, string] {
  const whole = String(text || "");
  const at = term ? whole.toLowerCase().indexOf(term.toLowerCase()) : -1;
  if (at < 0) return [whole, "", ""];
  return [whole.slice(0, at), whole.slice(at, at + term.length), whole.slice(at + term.length)];
}

/** The first songs' covers a playlist carries (behind, from /api/playlists), as PlaylistArt
 *  draws them fanned out behind it. */
export const behindOf = (p: { behind?: { title: string; artwork_id: number | null }[] } | null | undefined) =>
  (p?.behind ?? []).map((b) => ({ title: b.title, url: b.artwork_id ? u(`/api/artwork/${b.artwork_id}/image`) : null }));
