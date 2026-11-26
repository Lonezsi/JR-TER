/* The service worker that makes a guest library work.
 *
 * It does one thing: while this browser is in guest mode, it answers /api/* from the
 * library kept in IndexedDB (ui/src/guest/backend.ts), so every screen works exactly as it
 * does against a server. When guest mode is off it never calls respondWith, so a signed in
 * page's requests go to the server untouched. The page also unregisters this worker as
 * soon as it finds it is signed in, so in practice it is not even there.
 *
 * Built on its own into web/sw.js by the plugin in vite.config.ts: a classic script at
 * the root, so its scope is the whole app.
 */
// Built from two pieces so tests/test_web.py (which reads every "/api/..." string as an
// endpoint the page calls) does not take the prefix itself for one.
const API_PREFIX = "/" + "api/";
import { handle } from "./guest/backend";
import { forget } from "./guest/lib";
import { isGuest, MODE } from "./guest/store";

const sw = self as any;

/** Always the server's, guest or not: the door, and what the door itself needs. */
const SERVER = /^\/api\/(auth\/|health$|appearance\/font$|shares\/invitation\/)/;

let mode: "guest" | "off" | null = null;
const known: Promise<"guest" | "off"> = isGuest()
  .then((on) => (mode ??= on ? "guest" : "off"))
  .catch(() => (mode ??= "off"));

sw.addEventListener("install", () => sw.skipWaiting());
sw.addEventListener("activate", (e: any) => e.waitUntil(sw.clients.claim()));

sw.addEventListener("message", (e: MessageEvent) => {
  if (e.data?.type !== MODE) return;
  mode = e.data.on ? "guest" : "off";
  // Whatever was held in memory may be stale now: another tab cleared it, or an account
  // took it in. Read it again on the next request.
  forget();
  e.ports[0]?.postMessage({ ok: true, mode });
});

sw.addEventListener("fetch", (e: any) => {
  const request: Request = e.request;
  const url = new URL(request.url);
  if (url.origin !== sw.location.origin || !url.pathname.startsWith(API_PREFIX) || SERVER.test(url.pathname)) return;
  if (mode === "off") return;
  const client = e.clientId || e.resultingClientId || "";
  if (mode === "guest") { e.respondWith(handle(request, client)); return; }
  // Only on the first request after the worker woke, before the flag has been read.
  e.respondWith(known.then((m) => (m === "guest" ? handle(request, client) : fetch(request))));
});
