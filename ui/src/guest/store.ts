/* Where a guest library lives: one IndexedDB database in this browser.
 *
 * Used from both sides. The service worker reads and writes the library while it answers
 * /api/*, and the page touches it only to switch guest mode on or off, to take a copy when
 * the guest has signed in (the worker is not answering then), and to clear it afterwards.
 *
 * Three stores, kept small on purpose:
 *   kv     "guest" (the flag the worker checks) and "library" (every row, one record)
 *   blobs  the audio and pictures, by the SHA-256 of their bytes
 *
 * The rows are one record rather than a store per table because a guest library is
 * small, the server's own export is one JSON document of tables, and a single put is
 * atomic: a reload half way through a save can never leave a song without its versions.
 */

const NAME = "jriter-guest";
/** The message a page sends the worker to switch guest mode on or off. */
export const MODE = "jriter-guest-mode";
const VERSION = 1;

export interface StoredBlob { digest: string; ext: string; size: number; type: string; blob: Blob }

let opening: Promise<IDBDatabase> | null = null;

export function open(): Promise<IDBDatabase> {
  if (opening) return opening;
  opening = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("kv")) db.createObjectStore("kv");
      if (!db.objectStoreNames.contains("blobs")) db.createObjectStore("blobs", { keyPath: "digest" });
    };
    req.onsuccess = () => {
      const db = req.result;
      // Another tab upgrading or deleting the database: let go rather than block it.
      db.onversionchange = () => { db.close(); opening = null; };
      resolve(db);
    };
    req.onerror = () => { opening = null; reject(req.error); };
    req.onblocked = () => { /* waits for the other tab; onsuccess follows */ };
  });
  return opening;
}

function done<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function store(name: "kv" | "blobs", mode: IDBTransactionMode) {
  return (await open()).transaction(name, mode).objectStore(name);
}

export async function kvGet<T = unknown>(key: string): Promise<T | undefined> {
  return done((await store("kv", "readonly")).get(key)) as Promise<T | undefined>;
}

export async function kvSet(key: string, value: unknown): Promise<void> {
  const tx = (await open()).transaction("kv", "readwrite");
  tx.objectStore("kv").put(value, key);
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error("The browser refused to save that."));
  });
}

export async function kvDelete(key: string): Promise<void> {
  await done((await store("kv", "readwrite")).delete(key));
}

/** Whether this browser is in guest mode. Missing means no. */
export const isGuest = async () => (await kvGet<boolean>("guest").catch(() => false)) === true;
export const setGuest = (on: boolean) => kvSet("guest", on);

export async function blobGet(digest: string): Promise<StoredBlob | undefined> {
  return done((await store("blobs", "readonly")).get(digest)) as Promise<StoredBlob | undefined>;
}

export async function blobPut(entry: StoredBlob): Promise<void> {
  const tx = (await open()).transaction("blobs", "readwrite");
  tx.objectStore("blobs").put(entry);
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error("The browser ran out of room for that file."));
  });
}

export async function blobDelete(digest: string): Promise<void> {
  await done((await store("blobs", "readwrite")).delete(digest));
}

/** Sizes only, without reading any bytes: for the storage line in Settings. */
export async function blobSizes(): Promise<{ digest: string; size: number }[]> {
  const all = await done((await store("blobs", "readonly")).getAll()) as StoredBlob[];
  return all.map((b) => ({ digest: b.digest, size: b.size }));
}

export async function blobKeys(): Promise<string[]> {
  return (await done((await store("blobs", "readonly")).getAllKeys())).map(String);
}

/** Everything the guest made, gone. The flag is left as it is. */
export async function wipe(): Promise<void> {
  const tx = (await open()).transaction(["kv", "blobs"], "readwrite");
  tx.objectStore("kv").delete("library");
  tx.objectStore("blobs").clear();
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** SHA-256 of some bytes, as hex: the same name the server's blob store gives them. */
export async function digestOf(data: ArrayBuffer): Promise<string> {
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", data));
  let out = "";
  for (const b of hash) out += b.toString(16).padStart(2, "0");
  return out;
}
