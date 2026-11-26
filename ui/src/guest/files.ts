/* Bytes coming in: stored once by their SHA-256, the way jriter/blobs.py does it, and
 * looked at once for their shape.
 *
 * A worker cannot decode audio (there is no AudioContext in one), so the looking is asked
 * of the page that sent the file: it decodes with Web Audio and answers with the duration
 * and the same 120 peaks, 0 to 255, that jriter/audio_meta.py works out for a WAV. If no
 * page answers, the row is kept without a shape and the next examine asks again.
 */
import { blobGet, blobPut, blobDelete, digestOf } from "./store";
import { rows } from "./lib";
import { TYPES } from "./http";
import { holds } from "./routes/grave";

export interface Shape { peaks: string; peak_db: number | null; trouble: string; duration: number }

export const ANALYSE = "jriter-guest-analyse";

export async function keep(blob: Blob, ext: string): Promise<{ digest: string; size: number }> {
  if (!blob.size) throw new Error("no file in that upload");
  const digest = await digestOf(await blob.arrayBuffer());
  if (!(await blobGet(digest))) {
    const type = TYPES[ext] || blob.type || "application/octet-stream";
    await blobPut({ digest, ext, size: blob.size, type, blob: blob.type === type ? blob : blob.slice(0, blob.size, type) });
  }
  return { digest, size: blob.size };
}

/** Drop the bytes when nothing in the library points at them any more. */
export async function release(digest: string) {
  if (!digest) return;
  if (holds(digest)) return;            // waiting in the grave (routes/grave.ts) still needs it
  const used = rows("versions").some((r) => r.digest === digest)
    || rows("renders").some((r) => r.digest === digest)
    || rows("artwork").some((r) => r.digest === digest)
    || rows("albums").some((r) => r.cover_digest === digest)
    || rows("vocal_takes").some((r) => r.digest === digest);
  if (!used) await blobDelete(digest).catch(() => undefined);
}

/** Ask a page to decode some audio. Resolves null when nobody could. */
export async function analyse(clientId: string, digest: string, ext: string): Promise<Shape | null> {
  const sw = globalThis as any;
  if (!sw.clients) return null;               // not in a worker: nobody to ask
  const stored = await blobGet(digest);
  if (!stored) return null;
  let client = clientId ? await sw.clients.get(clientId) : null;
  if (!client) client = (await sw.clients.matchAll({ type: "window" }))[0];
  if (!client) return null;
  return new Promise<Shape | null>((resolve) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => resolve(null), 45000);
    channel.port1.onmessage = (e) => { clearTimeout(timer); resolve(e.data || null); };
    client.postMessage({ type: ANALYSE, blob: stored.blob, ext }, [channel.port2]);
  });
}

// ── the page's half ────────────────────────────────────────────────────────

const COLUMNS = 120;
const SILENT_DB = -60;

/** Decode and measure, in the page. Never throws: an unreadable file is a verdict. */
export async function measure(blob: Blob): Promise<Shape> {
  try {
    const Ctx = (window as any).OfflineAudioContext || (window as any).webkitOfflineAudioContext;
    const ctx = new Ctx(1, 1, 44100);
    const audio: AudioBuffer = await ctx.decodeAudioData(await blob.arrayBuffer());
    const frames = audio.length;
    if (!frames) return { peaks: "", peak_db: null, trouble: "unreadable", duration: 0 };
    const channels = Array.from({ length: audio.numberOfChannels }, (_, i) => audio.getChannelData(i));
    const per = Math.max(1, Math.floor(frames / COLUMNS));
    const shape: number[] = [];
    let loudest = 0;
    for (let c = 0; c < COLUMNS; c++) {
      const start = c * per;
      if (start >= frames) { shape.push(0); continue; }
      const end = Math.min(frames, start + per);
      let high = 0;
      for (const data of channels) {
        for (let i = start; i < end; i++) {
          const v = data[i] < 0 ? -data[i] : data[i];
          if (v > high) high = v;
        }
      }
      if (high > loudest) loudest = high;
      shape.push(Math.min(255, Math.floor(high * 255)));
    }
    const db = loudest > 0 ? Math.round(20 * Math.log10(loudest) * 100) / 100 : null;
    return {
      peaks: shape.join(","), peak_db: db,
      trouble: db === null || db < SILENT_DB ? "silent" : "",
      duration: audio.duration,
    };
  } catch {
    return { peaks: "", peak_db: null, trouble: "unreadable", duration: 0 };
  }
}

/** Answer the worker's requests to look at a file. Called once, early, by the page. */
export function answerAnalyse() {
  if (!("serviceWorker" in navigator)) return;
  navigator.serviceWorker.addEventListener("message", (e: MessageEvent) => {
    if (e.data?.type !== ANALYSE || !e.ports[0]) return;
    const port = e.ports[0];
    measure(e.data.blob as Blob).then((shape) => port.postMessage(shape), () => port.postMessage(null));
  });
  navigator.serviceWorker.startMessages?.();
}
