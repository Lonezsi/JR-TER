/* The guest backend's routing: the same table of (method, pattern) to handler the server
 * keeps in each module's ROUTES(), and the same reply shapes, so a screen cannot tell the
 * two apart. */
import { blobGet } from "./store";

export class GuestError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

/** What a handler is given: the request, its captures, and the query, like wire.Request. */
export class Req {
  constructor(public raw: Request, public params: Record<string, string>,
              public query: URLSearchParams, public clientId: string) {}
  q(name: string, fallback = "") { return this.query.get(name) ?? fallback; }
  header(name: string) { return this.raw.headers.get(name) || ""; }
  private parsed: any;
  async json(): Promise<Record<string, any>> {
    if (this.parsed !== undefined) return this.parsed;
    const text = await this.raw.text();
    try { this.parsed = text ? JSON.parse(text) : {}; } catch { throw new GuestError("that is not JSON"); }
    if (!this.parsed || typeof this.parsed !== "object") this.parsed = {};
    return this.parsed;
  }
  /** The X-Filename header, which the page percent-encodes. */
  filename(fallback: string) {
    const raw = this.header("X-Filename").trim();
    try { return decodeURIComponent(raw) || fallback; } catch { return raw || fallback; }
  }
}

export type Handler = (req: Req) => unknown | Promise<unknown>;
export type Routes = Record<string, Handler>;

/** "GET /api/songs/<id>" keys, the server's own notation. */
export function compile(tables: Routes[]) {
  const exact = new Map<string, Handler>();
  const patterned: { method: string; parts: string[]; fn: Handler }[] = [];
  for (const table of tables) {
    for (const [key, fn] of Object.entries(table)) {
      const [method, pattern] = key.split(" ");
      if (pattern.includes("<")) patterned.push({ method, parts: pattern.split("/").filter(Boolean), fn });
      else exact.set(key, fn);
    }
  }
  return (method: string, path: string): [Handler, Record<string, string>] | null => {
    const hit = exact.get(`${method} ${path}`);
    if (hit) return [hit, {}];
    const got = path.split("/").filter(Boolean);
    for (const r of patterned) {
      if (r.method !== method || r.parts.length !== got.length) continue;
      const params: Record<string, string> = {};
      let ok = true;
      for (let i = 0; i < got.length; i++) {
        const want = r.parts[i];
        if (want.startsWith("<")) {
          try { params[want.slice(1, -1)] = decodeURIComponent(got[i]); } catch { ok = false; break; }
        } else if (want !== got[i]) { ok = false; break; }
      }
      if (ok) return [r.fn, params];
    }
    return null;
  };
}

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

export const TYPES: Record<string, string> = {
  ".mp3": "audio/mpeg", ".wav": "audio/wav", ".flac": "audio/flac", ".m4a": "audio/mp4",
  ".aac": "audio/aac", ".ogg": "audio/ogg", ".opus": "audio/ogg", ".webm": "audio/webm",
  ".mp4": "audio/mp4", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
  ".webp": "image/webp", ".gif": "image/gif", ".avif": "image/avif",
};

export const AUDIO_EXT = [".mp3", ".wav", ".flac", ".m4a", ".aac", ".ogg", ".opus"];
export const IMAGE_EXT = [".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif"];

export const extOf = (name: string) => {
  const m = /\.[^./\\]+$/.exec(name || "");
  return m ? m[0].toLowerCase() : "";
};
export const stem = (name: string) => (name || "").replace(/\.[^./\\]+$/, "");

/** A stored file, answering Range the way http.py _file does, so the player can seek. */
export async function serve(req: Req, digest: string, ext: string, download?: string): Promise<Response> {
  const stored = await blobGet(digest);
  if (!stored) throw new GuestError("the file for that is missing from this browser", 410);
  const blob = stored.blob;
  const size = blob.size;
  const type = TYPES[ext] || stored.type || "application/octet-stream";
  const headers: Record<string, string> = {
    "Content-Type": type, "Accept-Ranges": "bytes", "Cache-Control": "no-store",
  };
  if (download) headers["Content-Disposition"] = `attachment; filename="${download.replace(/["\\\r\n]/g, "_")}"`;
  const range = req.header("Range");
  if (range.startsWith("bytes=")) {
    const [first, last] = range.slice(6).split(",")[0].trim().split("-");
    let start = 0, end = size - 1;
    if (first) { start = Number(first); end = last ? Number(last) : size - 1; }
    else if (last) start = Math.max(0, size - Number(last));
    if (Number.isFinite(start) && Number.isFinite(end)) {
      if (start >= size || start > end) {
        return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
      }
      end = Math.min(end, size - 1);
      headers["Content-Range"] = `bytes ${start}-${end}/${size}`;
      headers["Content-Length"] = String(end - start + 1);
      return new Response(blob.slice(start, end + 1, type), { status: 206, headers });
    }
  }
  headers["Content-Length"] = String(size);
  return new Response(blob.slice(0, size, type), { status: 200, headers });
}

export const need = (data: Record<string, any>, field: string): string => {
  const v = data[field];
  if (v === undefined || v === null || (typeof v === "string" && !v.trim())) throw new GuestError(`${field} is required`);
  return typeof v === "string" ? v.trim() : v;
};

export const asInt = (v: unknown, field: string) => {
  const n = Number(v);
  if (!Number.isInteger(n)) throw new GuestError(`${field} must be a whole number`);
  return n;
};
