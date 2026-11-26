<!-- The programs and timings the server leans on: ffmpeg for making a video, and how often
     watched folders are looked at. -->
<script lang="ts">
  import { get } from "$lib/api";
  import { app, has, saveSettings } from "$lib/app.svelte";
  import { resource } from "$lib/resource.svelte";
  import { bytes } from "$lib/util";
  import Block from "./Block.svelte";
  import Rows from "./Rows.svelte";
  import Trouble from "./Trouble.svelte";
  import SavedField from "./SavedField.svelte";
  import type { FfmpegState } from "./shapes";

  const tool = has("youtube")
    ? resource(() => get<FfmpegState>("/api/youtube/tool"), { on: ["settings:changed"] }) : null;

  // The path is only ever sent from here, on purpose: sending an empty one from somewhere
  // else would throw away a path somebody had typed in.
  const savePath = (next: string) => saveSettings({ ffmpeg_path: next.trim() });
  const saveEvery = async (next: string) => {
    const n = Math.round(Number(next));
    if (!Number.isFinite(n) || n < 1) throw new Error("Give a whole number of minutes, one or more.");
    await saveSettings({ sync_interval_minutes: n });
  };
</script>

<div class="sections">
  {#if tool}
    <Block title="Video"
           note="Making a video for YouTube needs ffmpeg. JR!TER fetches a pinned, checked build the first time you need it.">
      {#if tool.loading && !tool.data}
        <Rows n={1} />
      {:else if tool.error && !tool.data}
        <Trouble message={tool.error} retry={tool.reload} />
      {:else if tool.data}
        <div class="setting">
          <div class="what">
            {#if tool.data.found}
              <div class="t truncate">{tool.data.version}</div>
              <div class="s mono path">{tool.data.path}</div>
            {:else}
              <div class="t">No ffmpeg found</div>
              <div class="s">
                {tool.data.can_install
                  ? `Sending a mix will fetch ffmpeg ${tool.data.install_version || ""} first, about ${bytes(tool.data.install_size || 0)}, once.`
                  : tool.data.install_why || tool.data.why || "Looking for it."}
              </div>
            {/if}
          </div>
        </div>
      {/if}
      <div class="setting stack">
        <div class="what">
          <div class="t">Where ffmpeg is</div>
          <div class="s">Leave empty to let JR!TER look. Or point it at one you already have.</div>
        </div>
        <div class="ctl wide">
          <SavedField label="Where ffmpeg is" value={app.settings.ffmpeg_path} save={savePath} mono
                      placeholder="C:\ffmpeg\bin\ffmpeg.exe" />
        </div>
      </div>
    </Block>
  {/if}

  {#if has("sync")}
    <Block title="Watched folders">
      <div class="setting stack">
        <div class="what">
          <div class="t">Look every</div>
          <div class="s">Minutes between looks at each watched folder. The folders themselves are in the inbox.</div>
        </div>
        <div class="ctl narrow">
          <SavedField label="Minutes between looks" type="number" min={1} max={1440}
                      value={app.settings.sync_interval_minutes} save={saveEvery} />
          <span class="faint">min</span>
        </div>
      </div>
    </Block>
  {/if}
</div>

<style>
  .sections { display: flex; flex-direction: column; gap: var(--s6); }
  .path { overflow-wrap: anywhere; font-size: var(--t-xs); }
  .ctl.wide { flex: 0 1 340px; }
  .ctl.narrow { width: 150px; }
  @media (max-width: 640px) { .ctl.wide, .ctl.narrow { width: 100%; flex-basis: auto; } }
</style>
