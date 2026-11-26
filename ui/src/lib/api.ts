/* Talking to the server.
 *
 * Every call goes through here so an error has one shape and one place to be reported.
 * A failed request throws with the server's own message, because "could not save" tells
 * you nothing and "a song keeps at least one preset" tells you everything.
 */
import { toast } from "./toast.svelte";

export class ApiError extends Error {
  constructor(message: string, public status = 0, public ref?: string) {
    super(message);
    this.name = "ApiError";
  }
}

/* Where a request goes when the song on screen is somebody else's.
 *
 * A guest working on a shared song uses the owner's song page as it is. Every request it
 * makes about the song is sent through /api/shared/<share>/on/..., where the server
 * checks the route is one a guest may use and every id in it is part of the shared song.
 * Anything else, a guest's own library included, goes where it always went. */
export interface SharedAs { share: string; song: string }
let sharedAs: SharedAs | null = null;
const SHARED_PATHS = /^\/api\/(songs\/\d+|artwork|lyrics|lyric-revisions|sound|versions|arrangements|vocals)(\/|$)/;

export const guest = {
  get current() { return sharedAs; },
  set(value: SharedAs | null) { sharedAs = value; },
};

/** The address a path really lives at, which differs only while guesting. Use for every
 *  src= and href= that names an owner's audio or artwork. */
/** The address a path lives at through one particular share, or as it is when none.
 *  Anything that acts later than the moment it was asked (a debounced save, the player
 *  after the page was left) names its share here instead of reading whichever one
 *  happens to be current by then. */
export const uFor = (share: string | null | undefined, path: string) =>
  share && SHARED_PATHS.test(path) ? `/api/shared/${share}/on/${path.slice(5)}` : path;

export const u = (path: string) => uFor(sharedAs?.share, path);

export interface ApiOptions extends Omit<RequestInit, "body"> {
  json?: unknown;
  body?: BodyInit | null;
  /** Do not route through the share doorway even while guesting. */
  direct?: boolean;
}

export async function api<T = any>(path: string, options: ApiOptions = {}): Promise<T> {
  const { json, direct, ...rest } = options;
  const opts: RequestInit = { ...rest, headers: { ...(rest.headers as Record<string, string> || {}) } };
  const headers = opts.headers as Record<string, string>;
  if (json !== undefined) {
    opts.method = opts.method || "POST";
    headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(json);
  }
  const url = direct ? path : u(path);

  // A restart takes a couple of seconds, and during it every request in flight fails.
  // A read is tried again briefly before anything is said. Writes are never retried:
  // sending the same upload twice is worse than reporting the failure.
  const idempotent = !opts.method || opts.method === "GET";
  const attempts = idempotent ? 3 : 1;
  let response: Response;
  for (let attempt = 1; ; attempt++) {
    try {
      response = await fetch(url, opts);
      break;
    } catch (e) {
      if ((e as Error)?.name === "AbortError") throw e;
      if (attempt >= attempts) {
        throw new ApiError("JR!TER is not answering. It may be restarting; "
          + "give it a moment and try again.");
      }
      await new Promise((done) => setTimeout(done, attempt * 400));
    }
  }

  const text = await response.text();
  let data: any = {};
  if (text) {
    try { data = JSON.parse(text); }
    catch { throw new ApiError(`The server sent something that is not JSON (${response.status}).`, response.status); }
  }
  if (response.status === 401) {
    // The session ran out or was signed out elsewhere. The door is more use than an
    // error on a screen that can no longer load anything. The fragment survives the
    // trip, so signing in lands back on this screen.
    location.href = "/login" + location.hash;
    throw new ApiError("Signed out.", 401);
  }
  if (!response.ok) {
    throw new ApiError(data.error || `${response.status} ${response.statusText}`, response.status, data.ref);
  }
  return data as T;
}

export const get = <T = any>(path: string, opts?: ApiOptions) => api<T>(path, opts);
export const post = <T = any>(path: string, json: unknown = {}) => api<T>(path, { method: "POST", json });
export const put = <T = any>(path: string, json: unknown = {}) => api<T>(path, { method: "PUT", json });
export const patch = <T = any>(path: string, json: unknown = {}) => api<T>(path, { method: "PATCH", json });
export const del = <T = any>(path: string) => api<T>(path, { method: "DELETE" });

/** File uploads are the raw body with the name in a header, the same call the desktop
 *  client makes. No multipart, no form encoding, nothing to get wrong. */
export function upload<T = any>(path: string, file: File | Blob, name?: string,
                                extraHeaders: Record<string, string> = {}): Promise<T> {
  const filename = name || (file as File).name || "upload";
  return api<T>(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/octet-stream",
      "X-Filename": encodeURIComponent(filename).replace(/%20/g, " "),
      ...extraHeaders,
    },
    body: file,
  });
}

/** An upload that reports how far it has got. fetch cannot say; XMLHttpRequest can. */
export function uploadWithProgress<T = any>(path: string, file: File | Blob, name: string,
                                            onProgress: (fraction: number) => void,
                                            extraHeaders: Record<string, string> = {}): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", u(path));
    xhr.setRequestHeader("Content-Type", "application/octet-stream");
    xhr.setRequestHeader("X-Filename", encodeURIComponent(name).replace(/%20/g, " "));
    for (const [k, v] of Object.entries(extraHeaders)) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded / e.total); };
    xhr.onerror = () => reject(new ApiError("The upload did not get through."));
    xhr.onload = () => {
      let data: any = {};
      try { data = xhr.responseText ? JSON.parse(xhr.responseText) : {}; } catch { /* below */ }
      if (xhr.status === 401) { location.href = "/login" + location.hash; return reject(new ApiError("Signed out.", 401)); }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data as T);
      else reject(new ApiError(data.error || `${xhr.status} ${xhr.statusText}`, xhr.status));
    };
    xhr.send(file);
  });
}

/** Run an action so a failure always surfaces instead of vanishing into the console.
 *  Resolves with the result, or null when it failed (and said so). */
export async function attempt<T>(fn: () => Promise<T>, okMessage?: string): Promise<T | null> {
  try {
    const result = await fn();
    if (okMessage) toast(okMessage);
    return result;
  } catch (e) {
    if ((e as Error)?.name !== "AbortError") toast((e as Error).message || "That did not work.", "bad");
    return null;
  }
}
