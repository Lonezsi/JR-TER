/* Getting audio files into the inbox from this browser, one after another.
 *
 * ONE AT A TIME. A handful of bounces is a couple of hundred megabytes, and a browser
 * given ten of those in parallel spends the whole time swapping between them: the last
 * finishes no sooner and the first finishes much later, so there is nothing to listen to
 * until all are done. In a row, the first one is playable as soon as it lands.
 *
 * The state lives here and not in the screen so a batch survives switching tabs, and a
 * drop on any part of the screen has one place to go.
 */
import { uploadWithProgress } from "$lib/api";
import { emit } from "$lib/bus";
import { toast } from "$lib/toast.svelte";
import { plural } from "$lib/util";
import { audioKinds } from "./renders";

export interface Upload {
  id: number;
  name: string;
  size: number;
  fraction: number;
  state: "wait" | "going" | "done" | "dupe" | "failed";
  error: string;
}

export const uploads = $state<{ items: Upload[]; busy: boolean }>({ items: [], busy: false });
let next = 1;

const finished = (u: Upload) => u.state === "done" || u.state === "dupe" || u.state === "failed";
export const dismissUploads = () => { if (!uploads.busy) uploads.items = []; };
export const forgetUpload = (id: number) => { uploads.items = uploads.items.filter((u) => u.id !== id); };

export async function takeFiles(files: File[]): Promise<void> {
  if (!files.length) return;
  const kinds = await audioKinds();
  const audio = files.filter((f) => kinds.some((ext) => f.name.toLowerCase().endsWith(ext)));
  const rest = files.length - audio.length;
  if (!audio.length) {
    toast(rest === 1 ? "That is not an audio file." : "Those are not audio files.", "bad");
    return;
  }
  uploads.items = uploads.items.filter((u) => !finished(u) || uploads.busy);
  const mine = audio.map((file): Upload => ({
    id: next++, name: file.name, size: file.size, fraction: 0, state: "wait", error: "",
  }));
  uploads.items = [...uploads.items, ...mine];
  // Cheap to be reactive about: `uploads.items` holds the proxies, so write through them.
  const proxies = mine.map((m) => uploads.items.find((u) => u.id === m.id)!);

  // A second drop while the first batch is still going joins that queue rather than
  // starting a second one beside it.
  queue.push(...audio.map((file, i) => ({ file, row: proxies[i] })));
  restNotAudio += rest;
  if (uploads.busy) return;
  uploads.busy = true;

  let added = 0, already = 0;
  const failed: string[] = [];
  for (let job = queue.shift(); job; job = queue.shift()) {
    job.row.state = "going";
    try {
      const out = await uploadWithProgress("/api/renders", job.file, job.file.name,
        (f) => { job.row.fraction = f; }, { "X-Origin": "drop" });
      job.row.fraction = 1;
      // The same bounce twice is one render, because a render is its audio. Said as
      // "already here", not as a failure: somebody dropping a folder a second time wants
      // to know that rather than to wonder what went wrong.
      if (out.added) { job.row.state = "done"; added++; } else { job.row.state = "dupe"; already++; }
      if (out.added) emit("renders:changed");
    } catch (e) {
      job.row.state = "failed";
      job.row.error = (e as Error).message;
      failed.push(`${job.file.name}: ${job.row.error}`);
    }
  }
  uploads.busy = false;

  const said: string[] = [];
  if (added) said.push(`${plural(added, "render")} added`);
  if (already) said.push(`${already} already here`);
  if (restNotAudio) said.push(`${restNotAudio} not audio`);
  restNotAudio = 0;
  if (said.length) toast(said.join(", "), failed.length ? "bad" : "");
  failed.forEach((why) => toast(why, "bad"));
  if (added) emit("renders:changed");
  // A finished, clean batch tidies itself away after a moment; a failure stays to be read.
  if (!failed.length) setTimeout(() => { if (!uploads.busy) uploads.items = []; }, 4000);
}

const queue: { file: File; row: Upload }[] = [];
let restNotAudio = 0;

/** The file picker, for a phone and for anybody who would rather pick than drag. */
export function pickFiles(): void {
  // Synchronous: a browser only opens a picker inside the press that asked for it, and an
  // await for the server's list would spend that. The server still decides in takeFiles.
  const picker = document.createElement("input");
  picker.type = "file";
  picker.multiple = true;
  picker.accept = "audio/*,.mp3,.wav,.flac,.m4a,.aac,.ogg,.opus";
  picker.addEventListener("change", () => {
    const files = Array.from(picker.files || []);
    if (files.length) takeFiles(files);
  });
  picker.click();
}
