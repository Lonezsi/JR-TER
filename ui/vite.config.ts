import { defineConfig, build, type Plugin } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";

// The server this interface talks to while it is being worked on. `npm run dev` serves
// the source with hot reload and passes everything that is not source to a running
// JR!TER, so the library on screen is a real one.
const SERVER = process.env.JRITER_SERVER || "http://127.0.0.1:7900";

const alias = {
  $lib: fileURLToPath(new URL("./src/lib", import.meta.url)),
  $ui: fileURLToPath(new URL("./src/ui", import.meta.url)),
};

// The version a guest library reports. On a server it is the top of the devlog, read by
// Python; a guest has no server to ask, so the build reads the same line.
function version(): string {
  try {
    const devlog = readFileSync(fileURLToPath(new URL("../jriter/devlog.py", import.meta.url)), "utf-8");
    return /"version":\s*"([^"]+)"/.exec(devlog)?.[1] || "";
  } catch {
    return "";
  }
}
const define = { __JRITER_VERSION__: JSON.stringify(version()) };

// The service worker that answers a guest's /api/* (src/sw.ts). Built on its own, as one
// classic script at the root of the output, after the app: a worker's scope is the folder
// its script is served from, and the guest backend has to cover all of /api.
function serviceWorker(): Plugin {
  let outDir = "";
  return {
    name: "jriter-service-worker",
    apply: "build",
    configResolved(config) { outDir = config.build.outDir; },
    async closeBundle() {
      await build({
        configFile: false,
        logLevel: "warn",
        resolve: { alias },
        define,
        publicDir: false,
        build: {
          outDir,
          emptyOutDir: false,
          target: "es2022",
          copyPublicDir: false,
          lib: { entry: fileURLToPath(new URL("./src/sw.ts", import.meta.url)), formats: ["iife"], name: "jriterGuest", fileName: () => "sw.js" },
        },
      });
    },
  };
}

export default defineConfig({
  plugins: [svelte(), serviceWorker()],
  resolve: { alias },
  define,
  build: {
    // JRITER_OUT is how a build is made beside the shipped one instead of over it.
    outDir: process.env.JRITER_OUT || "../web-next",
    emptyOutDir: true,
    target: "es2022",
    assetsDir: "assets",
    chunkSizeWarningLimit: 900,
  },
  server: {
    port: 5173,
    proxy: Object.fromEntries(
      ["/api", "/glass.css", "/jriter.css", "/login", "/legal", "/favicon.ico"]
        .map((path) => [path, { target: SERVER, changeOrigin: false }])),
  },
});
