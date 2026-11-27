<!-- Starting up. Ask the server what it can do, then hand over to the shell. Nothing in
     the interface assumes a module exists. -->
<script lang="ts">
  import Shell from "./shell/Shell.svelte";
  import { app, loadState } from "$lib/app.svelte";
  import { startRouter, replace } from "$lib/router.svelte";
  import { startPlayer } from "$lib/player.svelte";
  import { accent, applyLook, wearFont, reapplyGround } from "$lib/look.svelte";
  import { on } from "$lib/bus";
  import { toast } from "$lib/toast.svelte";
  import { whatsNew } from "$lib/devlog";
  // Registers the arrangement with the player as a side effect of loading. Without this
  // import the player never learns there is a compositor and arranged playback is dead.
  import "$lib/audio/arrange.svelte";
  import { store } from "$lib/util";
  import { decide } from "./guest/boot";
  import { offerOnce } from "./guest/offer";

  // Conveniences carried over from the old name, once per browser, so nobody's sidebar
  // resets on the morning they update.
  for (const suffix of ["sort", "sound.open", "rail.shut"]) {
    const kept = store.raw("jong." + suffix);
    if (kept !== null && store.raw("jriter." + suffix) === null) store.setRaw("jriter." + suffix, kept);
    try { localStorage.removeItem("jong." + suffix); } catch { /* a private window */ }
  }

  // How the glass is blurred is the one look setting that belongs to the browser, not the
  // library: it depends on the GPU in front of you. See the notes above `.glass` in base.css.
  const savedBlur = store.raw("jriter.blur");
  document.documentElement.setAttribute("data-blur",
    savedBlur === "off" || savedBlur === "gl" ? savedBlur : "native");

  let retrying = $state(false);

  async function boot() {
    retrying = true;
    // Signed in, or a guest on a library kept in this browser. Decided before anything asks
    // for the library, because a guest's requests are answered by the service worker.
    const door = await decide();
    if (door === "away") return;                // reloading, or off to the door
    if (door === "stuck") {
      retrying = false;
      app.stuck = true;
      return;
    }
    app.guest = door === "guest";
    const ok = await loadState();
    retrying = false;
    if (!ok) return;

    accent.refresh();
    applyLook(app.settings);
    wearFont(app.summary.appearance);

    for (const [name, detail] of Object.entries(app.failed)) {
      toast(`The ${name} module did not load, so that feature is missing.`, "bad");
      console.warn(`[jriter] module ${name} failed to load\n`, detail);
    }

    startPlayer();
    startRouter();

    // A message from a sign in that has just come back from Google. The return handler
    // on the server has no screen to go back to, so it lands on the library with one
    // word on the query. Replaced rather than assigned, so Back does not walk into it.
    const landed = new URLSearchParams(location.hash.split("?")[1] || "").get("connect");
    if (landed) {
      toast(landed === "connected" ? "That account is connected." : landed, landed === "connected" ? "" : "bad");
      replace("/");
    }

    // Only when this copy changed under them. On a first visit it writes the version
    // down and says nothing at all.
    whatsNew(app.version);

    // Signed in with a guest library still in this browser: offered once, quietly.
    if (!app.guest) setTimeout(() => { void offerOnce(); }, 2500);
  }

  boot();

  $effect(() => on("settings:changed", () => { accent.refresh(); applyLook(app.settings); reapplyGround(); }));

  // The screens that take files (Inbox, a song) handle their own drops. On every other screen
  // the browser would otherwise open the dropped file and leave the app, with whatever was
  // playing, so a drop that nothing claimed is refused.
  $effect(() => {
    const files = (e: DragEvent) => !!e.dataTransfer && Array.from(e.dataTransfer.types).includes("Files");
    const over = (e: DragEvent) => { if (files(e) && !e.defaultPrevented) e.preventDefault(); };
    window.addEventListener("dragover", over);
    window.addEventListener("drop", over);
    return () => { window.removeEventListener("dragover", over); window.removeEventListener("drop", over); };
  });

  // A failure inside an async handler used to reach nothing at all: window.onerror does
  // not see a rejected promise. It is said out loud, once, in plain words.
  $effect(() => {
    const onreject = (e: PromiseRejectionEvent) => {
      const why = (e.reason && (e.reason.message || e.reason)) || "something failed";
      if (e.reason?.name === "AbortError") return;
      console.error("unhandled:", e.reason);
      toast(`Something went wrong: ${String(why).slice(0, 120)}`, "bad");
    };
    window.addEventListener("unhandledrejection", onreject);
    return () => window.removeEventListener("unhandledrejection", onreject);
  });
</script>

{#if app.ready}
  <Shell />
{:else if app.stuck}
  <div class="down">
    <h1>Sign in to use JR!TER here</h1>
    <p>Without an account, JR!TER keeps your library in the browser, and this one won't let it.
      A private window is the usual reason.</p>
    <a class="btn primary" href="/login">Sign in</a>
  </div>
{:else if app.failure}
  <div class="down">
    <h1>JR!TER is not answering</h1>
    <p>{app.failure}</p>
    <p class="muted">If this is your machine, start it with <code>python server.py</code>.</p>
    <button class="btn primary" onclick={boot} disabled={retrying}>{retrying ? "Trying…" : "Try again"}</button>
  </div>
{/if}

<style>
  .down { height: 100%; display: flex; flex-direction: column; align-items: flex-start; justify-content: center; gap: var(--s4); padding: var(--s7); max-width: 640px; margin: 0 auto; }
  code { font-family: var(--mono); background: var(--hover); padding: 2px var(--s2); border-radius: var(--r-sm); }
</style>
