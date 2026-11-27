<!-- How the app looks: the accent, the three dials, the display face.

     Everything here applies the instant it is touched and is saved a moment after you
     stop, and the screen says which of those it is at ("Saving", "Saved"). There is no
     state in which the app is wearing something that is neither saved nor on its way to
     being: a failed save puts the saved look back and says so. Leaving the screen
     mid-change saves what is pending, and in every case lets go of the accent, because
     with adaptive colours on and a song playing the right colour is the song's, and only
     the accent driver knows that (the old "view:leaving" lesson). -->
<script lang="ts">
  import { onDestroy } from "svelte";
  import { get, del, upload, attempt } from "$lib/api";
  import { app, has, saveSettings } from "$lib/app.svelte";
  import { accent, applyLook, wearFont, reapplyGround } from "$lib/look.svelte";
  import { toast } from "$lib/toast.svelte";
  import { debounce, when, store } from "$lib/util";
  import { glass, glassGL } from "$lib/glass/glass.svelte";
  import Switch from "$ui/Switch.svelte";
  import Segmented from "$ui/Segmented.svelte";
  import Slider from "$ui/Slider.svelte";
  import Icon from "$ui/Icon.svelte";
  import Block from "./Block.svelte";
  import type { FontInfo } from "./shapes";
  import type { Settings } from "$lib/types";

  type Look = { accent: string; adaptive: boolean; artwork_ground: boolean; dust: number; glass_edge: number; dither: number };
  type Dial = "dust" | "glass_edge" | "dither";

  const read = (s: Partial<Settings>): Look => ({
    accent: String(s.accent || "#FAA8B8"),
    adaptive: s.adaptive === true,
    artwork_ground: s.artwork_ground === true,
    dust: Number(s.dust ?? 100),
    glass_edge: Number(s.glass_edge ?? 100),
    dither: Number(s.dither ?? 60),
  });

  let look = $state<Look>(read(app.settings));

  // Per browser, not per library: whether a blur flickers depends on the GPU in front of you.
  type Blur = "native" | "gl" | "off";
  const blurNow = (): Blur => {
    const v = document.documentElement.getAttribute("data-blur");
    return v === "off" || v === "gl" ? v : "native";
  };
  let blur = $state<Blur>(blurNow());
  function setBlur(next: Blur) {
    blur = next;
    document.documentElement.setAttribute("data-blur", next);
    store.setRaw("jriter.blur", next);
    glassGL.mode(next);
  }
  // Light or dark, per browser too (the script in index.html applies it before paint).
  type Theme = "auto" | "dark" | "light";
  let theme = $state<Theme>(((): Theme => { try { const v = localStorage.getItem("jriter.theme"); return v === "dark" || v === "light" ? v : "auto"; } catch { return "auto"; } })());
  function setTheme(next: Theme) {
    theme = next;
    (window as any).__jriterTheme?.(next);
  }
  let pending: Partial<Look> = {};
  let before: Look | null = null;                       // the saved look, to go back to on failure
  let held = false;
  let status = $state<"" | "unsaved" | "saving" | "saved">("");
  let clear: ReturnType<typeof setTimeout> | undefined;

  function letGo() {
    if (held && pending.accent === undefined) { held = false; accent.release(); }
  }

  async function flush() {
    const patch = pending;
    if (!Object.keys(patch).length) { letGo(); return; }
    pending = {};
    const snap = before ?? read(app.settings);
    before = null;
    status = "saving";
    try {
      await saveSettings(patch);
      status = "saved";
      clearTimeout(clear);
      clear = setTimeout(() => { if (status === "saved") status = ""; }, 1800);
    } catch (e) {
      // Put the saved look back, and say so: never keep a preview nobody stored.
      for (const k of Object.keys(patch) as (keyof Look)[]) (look as Record<string, unknown>)[k] = snap[k];
      app.settings.adaptive = snap.adaptive;
      applyLook(read(app.settings));
      status = "";
      toast((e as Error).message || "That did not save. The look is back as it was.", "bad");
    } finally {
      letGo();
      accent.refresh();
    }
  }
  const persist = debounce(flush, 700);

  function set<K extends keyof Look>(key: K, value: Look[K]) {
    if (!before) before = read(app.settings);
    look[key] = value;
    pending[key] = value;
    status = "unsaved";
    if (key === "accent") {
      held = true;
      accent.hold();
      accent.preview(String(value));
    } else if (key === "adaptive") {
      // The accent driver reads the app's copy, so the switch demonstrates itself at once.
      app.settings.adaptive = value as boolean;
      accent.refresh();
    } else if (key === "artwork_ground") {
      app.settings.artwork_ground = value as boolean;
      reapplyGround();
    } else {
      applyLook(look);
    }
    persist();
  }

  onDestroy(() => {
    persist.cancel();
    clearTimeout(clear);
    if (Object.keys(pending).length) flush(); else letGo();
  });

  async function backToNormal() {
    const defaults = await attempt(() => get<{ defaults: Settings }>("/api/settings/defaults"));
    if (!defaults) return;
    const was = { ...look };
    const to = read(defaults.defaults);
    for (const k of Object.keys(to) as (keyof Look)[]) set(k, to[k] as never);
    persist.now();
    toast("The look is back to normal.", "", {
      label: "Undo",
      run: () => { for (const k of Object.keys(was) as (keyof Look)[]) set(k, was[k] as never); persist.now(); },
    });
  }

  // ── the display face ───────────────────────────────────────────────────────

  const font = $derived<FontInfo>(app.summary.appearance ?? { custom_font: false });
  let picker = $state<HTMLInputElement>();
  let fontBusy = $state(false);

  async function pickFont() {
    const file = picker?.files?.[0];
    if (picker) picker.value = "";
    if (!file) return;
    fontBusy = true;
    const done = await attempt(() => upload<{ font: FontInfo }>("/api/appearance/font", file));
    fontBusy = false;
    if (!done) return;
    app.summary.appearance = done.font;
    wearFont(done.font);
    toast(`Titles are wearing ${file.name}.`);
  }

  async function clearFont() {
    fontBusy = true;
    const done = await attempt(() => del<{ font: FontInfo }>("/api/appearance/font"), "Back to Orbitron.");
    fontBusy = false;
    if (!done) return;
    app.summary.appearance = done.font;
    wearFont(done.font);
  }
</script>

{#snippet dial(key: Dial, label: string, max: number, note: string)}
  <div class="setting stack dialrow">
    <div class="what">
      <!-- Label left, value right, track below: the same recipe as the Sound sliders. -->
      <div class="t dialhead"><span>{label}</span><b class="num">{look[key]}</b></div>
      <div class="s">{note}</div>
    </div>
    <div class="ctl slide">
      <Slider bind:value={look[key]} min={0} {max} step={5} {label} accent
              reset={key === "dither" ? 60 : 100}
              oninput={(v) => set(key, v)} onchange={() => persist.now()} />
    </div>
  </div>
{/snippet}

<div class="sections">
  <Block title="Colour">
    {#snippet actions()}
      <span class="state faint" role="status" aria-live="polite">
        {#if status === "unsaved" || status === "saving"}Saving...{:else if status === "saved"}Saved{:else}Saves as you go{/if}
      </span>
      <button class="btn sm ghost" onclick={backToNormal}><Icon name="undo" size={14} /> Back to normal</button>
    {/snippet}
    <div class="setting">
      <div class="what">
        <div class="t">Accent colour</div>
        <div class="s">The one colour every tint in the app comes from.</div>
      </div>
      <div class="ctl">
        <label class="swatch" style:--picked={look.accent}>
          <input type="color" value={look.accent} aria-label="Accent colour"
                 oninput={(e) => set("accent", e.currentTarget.value.toUpperCase())}
                 onchange={() => persist.now()} />
          <span class="dot"></span>
          <span class="hex num">{look.accent}</span>
        </label>
      </div>
    </div>
    <!-- Under the picker on purpose: this is the sentence that finishes it. That colour,
         unless something is playing. -->
    <div class="setting">
      <div class="what">
        <div class="t">Adaptive colours</div>
        <div class="s">The accent follows what's playing. Off, it stays the colour above.</div>
      </div>
      <div class="ctl">
        <Switch checked={look.adaptive} label="Adaptive colours" onchange={(v) => { set("adaptive", v); persist.now(); }} />
      </div>
    </div>
    <div class="setting">
      <div class="what">
        <div class="t">Artwork behind the app</div>
        <div class="s">The song's cover, blurred, as the background.</div>
      </div>
      <div class="ctl">
        <Switch checked={look.artwork_ground} label="Artwork behind the app" onchange={(v) => { set("artwork_ground", v); persist.now(); }} />
      </div>
    </div>
  </Block>

  <Block title="Glass">
    <div class="setting stack">
      <div class="what">
        <div class="t">Theme</div>
        <div class="s">Auto follows your system. Saved in this browser.</div>
      </div>
      <div class="ctl">
        <Segmented size="sm" label="Theme" value={theme} onchange={(v) => setTheme(v as Theme)}
                   options={[{ value: "auto", label: "Auto" }, { value: "dark", label: "Dark" }, { value: "light", label: "Light" }]} />
      </div>
    </div>
    <div class="setting stack">
      <div class="what">
        <div class="t">Backdrop blur</div>
        <div class="s">Glass blurs whatever is behind the bars. Shader only blurs just the background. Saved in this browser.{#if blur === "gl" && !glass.active} <b>No shader here, so it's the same as Off.</b>{/if}</div>
      </div>
      <div class="ctl">
        <Segmented size="sm" label="Backdrop blur" value={blur} onchange={(v) => setBlur(v as Blur)}
                   options={[{ value: "native", label: "Glass" }, { value: "gl", label: "Shader only" }, { value: "off", label: "Off" }]} />
      </div>
    </div>
    {@render dial("dust", "Dust", 200,
      "Specks behind pages with no artwork. 100 is normal.")}
    {@render dial("glass_edge", "Chromatic aberration", 200,
      "Colour split on glass edges. 0 is plain glass.")}
    {@render dial("dither", "Dither", 100,
      "Fine grain that stops banding in gradients. Past 80 it shows.")}
  </Block>

  {#if has("appearance")}
    <Block title="Display font"
           note="The font for titles. Upload your own; it stays on your server, only for you.">
      <div class="setting">
        <div class="what">
          <div class="t fontname truncate">{font.custom_font ? font.font_name : "Orbitron"}</div>
          <div class="s">{font.custom_font ? `yours, uploaded ${when(font.uploaded_at)}` : "the built-in one"}</div>
        </div>
        <div class="ctl">
          <input type="file" accept=".ttf,.otf,.woff,.woff2,font/*" hidden bind:this={picker} onchange={pickFont} />
          <button class="btn sm" disabled={fontBusy} onclick={() => picker?.click()}><Icon name="upload" size={14} /> Upload</button>
          {#if font.custom_font}
            <button class="btn sm danger" disabled={fontBusy} onclick={clearFont}>Remove</button>
          {/if}
        </div>
      </div>
    </Block>
  {/if}
</div>

<style>
  .sections { display: flex; flex-direction: column; gap: var(--s6); }
  .state { font-size: var(--t-sm); }
  .slide { gap: var(--s3); width: min(300px, 100%); }
  .dialrow .slide { flex: 0 0 300px; }
  @media (max-width: 640px) { .dialrow .slide { flex: 1 1 auto; width: 100%; } }
  .fontname { font-family: var(--display); font-size: var(--t-xl); }

  .swatch {
    position: relative; display: inline-flex; align-items: center; gap: var(--s3);
    height: 42px; padding: 0 var(--s4) 0 var(--s2); border-radius: var(--r-pill);
    border: 1px solid var(--line); background: var(--hover); cursor: pointer;
    transition: border-color var(--fast);
  }
  .swatch:hover { border-color: var(--line-2); }
  .swatch:focus-within { border-color: var(--accent-line); outline: 2px solid var(--accent); outline-offset: 2px; }
  .swatch input { position: absolute; inset: 0; width: 100%; height: 100%; opacity: 0; border: 0; padding: 0; cursor: pointer; }
  .dot { width: 30px; height: 30px; flex: none; border-radius: 50%; background: var(--picked); box-shadow: var(--edge-top), 0 2px 8px rgba(0, 0, 0, 0.5); }
  .hex { font-size: var(--t-sm); letter-spacing: 0.04em; color: var(--text-2); text-transform: uppercase; }
  .dialhead { display: flex; justify-content: space-between; align-items: baseline; gap: var(--s3); }
  .dialhead b { font-size: var(--t-sm); color: var(--text); }
</style>
