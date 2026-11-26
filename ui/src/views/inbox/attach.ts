/* Telling a render which song it is.
 *
 * A render comes out of the DAW knowing only the name of the project it was made from.
 * That is not the same as knowing which song it is the next version of, so it waits in
 * the inbox until it is told. This is the telling: one sheet, used from the inbox, from
 * a menu, from the palette, and for a whole selection at once.
 */
import { post, attempt } from "$lib/api";
import { emit } from "$lib/bus";
import { toast } from "$lib/toast.svelte";
import { sheet } from "$lib/dialog.svelte";
import { go, href } from "$lib/router.svelte";
import { plural } from "$lib/util";
import type { Render, Song, Version } from "$lib/types";
import SongPicker from "./SongPicker.svelte";
import { nameOf } from "./renders";

/** What the picker resolves with: an existing song, or the title of one to make. */
export type Picked = { song_id: number; title?: string } | { title: string } | { each: true };

/** Ask which song. `name` is what the server's guess is made from. */
export function pickSong(opts: {
  title: string; sub?: string; name: string; many?: number; verb?: string;
}): Promise<Picked | null> {
  return sheet<Picked>({
    title: opts.title,
    sub: opts.sub ?? "It becomes the newest render of whichever song you pick.",
    wide: true, confirm: "", cancel: "Not now",
    body: SongPicker,
    props: { name: opts.name, many: opts.many || 1, verb: opts.verb || "Add" },
  });
}

interface Attached { render: Render; song: Song; version: Version; already_there: boolean }

/** Open the picker for one render and attach it. True when it now has a song. */
export async function attachRender(render: Render): Promise<boolean> {
  const name = nameOf(render);
  const picked = await pickSong({ title: `Where does ${name} go?`, name });
  if (!picked || "each" in picked) return false;
  const fresh = !("song_id" in picked);
  const result = await attempt(() => post<Attached>(`/api/renders/${render.id}/attach`,
    fresh ? { title: picked.title || name } : { song_id: picked.song_id }));
  if (!result) return false;
  announce([result.song.id]);
  const said = result.already_there
    ? `${name} was already v${result.version.n} of ${result.song.title}.`
    : `${name} is now v${result.version.n} of ${result.song.title}.`;
  // A song that has just been brought into existence is somewhere to go. One that
  // already existed is not: filing a render is a thing you do while working down the
  // list, and being thrown out of the list each time would make filing three in a row
  // impossible. So the existing song is offered, not opened.
  if (fresh) { toast(said); go(href.song(result.song.id)); }
  else toast(said, "", { label: "Open song", run: () => go(href.song(result.song.id)) });
  return true;
}

/** A whole selection: all into one song, oldest first so the version numbers run in the
 *  order the bounces were made, or a new song for each. Resolves with how many went. */
export async function attachRenders(renders: Render[]): Promise<number> {
  if (!renders.length) return 0;
  if (renders.length === 1) return (await attachRender(renders[0])) ? 1 : 0;
  const picked = await pickSong({
    title: `Where do these ${renders.length} renders go?`,
    sub: "Each becomes a new render on the song you pick, oldest first.",
    name: nameOf(renders[0]), many: renders.length,
  });
  if (!picked) return 0;
  const order = renders.slice().sort((a, b) => (a.created_at || 0) - (b.created_at || 0));
  let songId = "song_id" in picked ? picked.song_id : null;
  let songTitle = "";
  let done = 0;
  let why = "";
  const touched = new Set<number>();
  for (const render of order) {
    try {
      const body = "each" in picked ? { title: nameOf(render) }
        : songId ? { song_id: songId } : { title: (picked as { title: string }).title };
      const result = await post<Attached>(`/api/renders/${render.id}/attach`, body);
      // "One new song" makes it with the first and files the rest against it.
      if (!("each" in picked)) { songId = result.song.id; songTitle = result.song.title; }
      touched.add(result.song.id);
      done++;
    } catch (e) { why = (e as Error).message; }
  }
  if (done) announce([...touched]);
  if (why) toast(`${renders.length - done} did not attach: ${why}`, "bad");
  if (done) {
    const one = !("each" in picked) && songId;
    toast("each" in picked ? `${plural(done, "song")} made.` : `${plural(done, "render")} added to ${songTitle}.`, "",
      one ? { label: "Open song", run: () => go(href.song(one)) } : undefined);
  }
  return done;
}

function announce(songIds: number[]) {
  emit("renders:changed");
  emit("songs:changed");
  for (const songId of songIds) emit("versions:changed", { songId });
}
