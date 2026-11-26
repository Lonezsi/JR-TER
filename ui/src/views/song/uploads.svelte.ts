/* Adding renders to the song: from a file picker or from audio dropped anywhere on the
 * screen, with progress. One at a time, in order: two big uploads at once only make both
 * slower and the progress bars lie. */
import { uploadWithProgress, ApiError } from "$lib/api";
import { emit } from "$lib/bus";
import { toast } from "$lib/toast.svelte";
import type { SongStore } from "./song.svelte";
import { durationOf, isAudio } from "./helpers";

export interface Upload { name: string; fraction: number; state: "waiting" | "sending" | "failed"; error?: string }

export class Uploader {
  items = $state<Upload[]>([]);
  private busy = false;
  private input: HTMLInputElement | null = null;
  constructor(private song: SongStore) {}

  get active() { return this.items.length > 0; }

  /** Open the file picker. */
  pick() {
    if (!this.input) {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "audio/*,.mp3,.wav,.flac,.m4a";
      input.multiple = true;
      input.hidden = true;
      input.onchange = () => { const files = Array.from(input.files || []); input.value = ""; this.add(files); };
      this.input = input;
    }
    this.input.click();
  }

  add(files: File[]) {
    const audio = files.filter(isAudio);
    if (files.length && !audio.length) { toast("That is not an audio file.", "bad"); return; }
    const queued = audio.map((file) => {
      const item = $state<Upload>({ name: file.name, fraction: 0, state: "waiting" });
      return { file, item };
    });
    this.items = [...this.items, ...queued.map((q) => q.item)];
    void this.run(queued);
  }

  private async run(queued: { file: File; item: Upload }[]) {
    while (this.busy) await new Promise((r) => setTimeout(r, 200));
    this.busy = true;
    try {
      for (const { file, item } of queued) {
        item.state = "sending";
        const duration = await durationOf(file);
        try {
          const made = await uploadWithProgress(`/api/songs/${this.song.id}/versions`, file, file.name,
            (f) => { item.fraction = f; }, duration ? { "X-Duration": String(duration) } : {});
          if (made.duplicate) toast(made.message);
          else toast(`Saved as v${made.version.n}`);
          this.items = this.items.filter((x) => x !== item);
          await this.song.refresh("versions", "song");
          emit("versions:changed", { songId: Number(this.song.id) });
          emit("songs:changed", { songId: Number(this.song.id) });
        } catch (e) {
          item.state = "failed";
          item.error = e instanceof ApiError ? e.message : "The upload did not get through.";
          toast(`${file.name}: ${item.error}`, "bad");
          setTimeout(() => { this.items = this.items.filter((x) => x !== item); }, 6000);
        }
      }
    } finally { this.busy = false; }
  }
}
