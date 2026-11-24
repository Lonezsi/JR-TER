// wamhost.js: loads Web Audio Module (WAM 2) plugins into the mixer. A browser cannot run VST files,
// WAM is the web's version of them: a plugin is a script at an address that makes an audio node.
//
//   allowed(url)      may this browser load that plugin? (same-server paths always; any other
//                     address only after allow() was pressed for its site)
//   allow(url)        remember the site of that address on this browser
//   forget(url)       take it back
//   loadPlugin(ctx, url, state) -> { node, name, getState(), gui(), destroy() }
//
// A plugin is someone else's code running in the page with your sign-in, so nothing loads
// until the person at this browser has allowed its site. The allow-list is in localStorage
// ("jriter.daw.plugins.allowed", a JSON list of origins) and is never part of a song.
// The host side of WAM comes from ./vendor/wam/sdk.js (see the README beside it).
// Plugins are duck-typed: the module's default export has createInstance(groupId, ctx, state),
// and the instance has audioNode and, optionally, getState(), createGui(), destroy().
import { pluginOrigin } from "./mixer.js";

const KEY = "jriter.daw.plugins.allowed";
const read = () => { try { const l = JSON.parse(localStorage.getItem(KEY) || "[]"); return Array.isArray(l) ? l : []; } catch { return []; } };

export const allowed = (url) => {
  const o = pluginOrigin(url);
  return o === "" || read().includes(o);
};
export function allow(url) {
  const o = pluginOrigin(url);
  if (!o) return;
  const l = read();
  if (!l.includes(o)) { l.push(o); try { localStorage.setItem(KEY, JSON.stringify(l)); } catch { /* private mode: allowed for this page only */ } }
}
export function forget(url) {
  const o = pluginOrigin(url);
  try { localStorage.setItem(KEY, JSON.stringify(read().filter((x) => x !== o))); } catch { /* nothing to forget */ }
}

// One WAM host group per audio context (the SDK adds its worklet once).
const groups = new WeakMap();
async function hostGroup(ctx) {
  if (!groups.has(ctx)) {
    groups.set(ctx, (async () => {
      try {
        const { initializeWamHost } = await import("./vendor/wam/sdk.js");
        // The SDK's worklet can wait on a suspended context; plugins that do not use the group still load without it.
        return await Promise.race([initializeWamHost(ctx).then((g) => g[0]), new Promise((r) => setTimeout(() => r(""), 4000))]);
      } catch { return ""; } // no AudioWorklet: simple plugins may still load
    })());
  }
  return groups.get(ctx);
}

export async function loadPlugin(ctx, url, state) {
  const group = await hostGroup(ctx);
  const mod = await import(/* @vite-ignore */ new URL(url, location.href).href);
  const W = mod.default;
  if (!W || typeof W.createInstance !== "function") throw new Error("That address is not a Web Audio Module.");
  const inst = await W.createInstance(group, ctx, state == null ? undefined : state);
  const node = inst && inst.audioNode;
  if (!node) throw new Error("The plugin made no audio.");
  return {
    node,
    name: String(inst.name || (inst.descriptor && inst.descriptor.name) || W.name || url).slice(0, 80),
    getState: async () => {
      if (typeof node.getState === "function") return node.getState();
      if (typeof inst.getState === "function") return inst.getState();
      return null;
    },
    gui: async () => (typeof inst.createGui === "function" ? inst.createGui() : null),
    destroy() {
      try { if (typeof inst.destroyGui === "function") inst.destroyGui(); } catch { /* gone anyway */ }
      try { if (typeof node.destroy === "function") node.destroy(); } catch { /* gone anyway */ }
    },
  };
}
