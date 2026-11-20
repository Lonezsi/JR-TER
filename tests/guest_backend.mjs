// The guest backend (ui/src/guest), run in Node against a small in-memory IndexedDB, so
// tests/test_guest_backend.py can put the same requests to it and to the real server and
// compare what comes back. Built with the ui's own Vite, so what runs is what ships.
//
//   node tests/guest_backend.mjs <steps.json>   prints one JSON answer per step
import { createRequire } from "node:module";
import { pathToFileURL, fileURLToPath } from "node:url";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const UI = path.join(ROOT, "ui");
const require = createRequire(path.join(UI, "package.json"));
const { build } = await import(pathToFileURL(require.resolve("vite")).href);

// ── an IndexedDB just big enough for ui/src/guest/store.ts ──
function request(fn) {
  const req = { onsuccess: null, onerror: null, result: undefined, error: null };
  setTimeout(() => {
    try { req.result = fn(); req.onsuccess?.({ target: req }); }
    catch (e) { req.error = e; req.onerror?.({ target: req }); }
  });
  return req;
}
const dbs = new Map();
globalThis.indexedDB = {
  open(name) {
    const req = { result: null, onsuccess: null, onerror: null, onupgradeneeded: null, onblocked: null };
    setTimeout(() => {
      let stores = dbs.get(name);
      const fresh = !stores;
      if (fresh) dbs.set(name, (stores = new Map()));
      const db = {
        objectStoreNames: { contains: (n) => stores.has(n) },
        createObjectStore: (n, opts = {}) => stores.set(n, { key: opts.keyPath, rows: new Map() }),
        transaction(names) {
          const tx = { oncomplete: null, onerror: null, onabort: null, error: null,
            objectStore(n) {
              const s = stores.get(n);
              const done = (r) => { setTimeout(() => setTimeout(() => tx.oncomplete?.())); return r; };
              return {
                get: (k) => request(() => { const v = s.rows.get(k); return s.key || v === undefined ? v : structuredClone(v); }),
                put: (v, k) => done(request(() => { s.rows.set(s.key ? v[s.key] : k, s.key ? v : structuredClone(v)); })),
                delete: (k) => done(request(() => { s.rows.delete(k); })),
                clear: () => done(request(() => { s.rows.clear(); })),
                getAll: () => request(() => [...s.rows.values()]),
                getAllKeys: () => request(() => [...s.rows.keys()]),
              };
            } };
          return tx;
        },
      };
      req.result = db;
      if (fresh) req.onupgradeneeded?.();
      req.onsuccess?.();
    });
    return req;
  },
};

const out = mkdtempSync(path.join(tmpdir(), "jriter-guest-"));
try {
  await build({
    configFile: false, logLevel: "silent", root: UI, publicDir: false,
    resolve: { alias: { $lib: path.join(UI, "src", "lib"), $ui: path.join(UI, "src", "ui") } },
    define: { __JRITER_VERSION__: JSON.stringify("test") },
    build: { outDir: out, emptyOutDir: true, minify: false, target: "es2022",
      lib: { entry: path.join(UI, "src", "guest", "backend.ts"), formats: ["es"], fileName: () => "backend.mjs" } },
  });
  const { handle } = await import(pathToFileURL(path.join(out, "backend.mjs")).href);
  const steps = JSON.parse(readFileSync(process.argv[2], "utf-8"));
  const answers = [];
  for (const s of steps) {
    const headers = { ...(s.headers || {}) };
    let body;
    if (s.json !== undefined) { body = JSON.stringify(s.json); headers["Content-Type"] = "application/json"; }
    if (s.file) body = readFileSync(s.file);
    const r = await handle(new Request("http://guest" + s.path, { method: s.method || "GET", headers, body }), "");
    const type = r.headers.get("content-type") || "";
    if (type.includes("json")) { answers.push({ status: r.status, body: await r.json() }); continue; }
    const bytes = new Uint8Array(await r.arrayBuffer());
    if (s.save) writeFileSync(s.save, bytes);
    answers.push({ status: r.status, body: { bytes: bytes.byteLength, type } });
  }
  process.stdout.write(JSON.stringify(answers));
} finally {
  rmSync(out, { recursive: true, force: true });
}
