<!-- Every render of the song, newest first. A render is one file; the song is all of them.

     Each take is a row with its own colour: its waveform, in the hue hashed from its name,
     runs behind the whole row, muted and faded at both ends, so a list of bounces is a list
     of different shapes and colours rather than grey lines of numbers. The row says what
     matters first (play, which version, its name) and keeps the file's numbers small at the
     end. Comparing two takes (A and B) happens on the Sound tab. -->
<script lang="ts">
  import Icon from "$ui/Icon.svelte";
  import { hidden } from "$lib/later.svelte";
  import Wave from "$ui/Wave.svelte";
  import { contextMenu, showMenu, type MenuItem } from "$lib/menu.svelte";
  import { resource } from "$lib/resource.svelte";
  import { get } from "$lib/api";
  import { has } from "$lib/app.svelte";
  import { bytes, time, ymd, hue } from "$lib/util";
  import { replace, href } from "$lib/router.svelte";
  import type { Version } from "$lib/types";
  import { player } from "$lib/player.svelte";
  import { useSong } from "./song.svelte";
  import type { Uploader } from "./uploads.svelte";
  import VocalsPanel from "./VocalsPanel.svelte";
  import * as act from "./actions";
  import { take, troubleOf, versionName } from "./helpers";

  let { uploader }: { uploader: Uploader } = $props();
  const song = useSong();

  const posts = resource(() => (song.has("youtube") ? get(`/api/songs/${song.id}/youtube`) : Promise.resolve({ posts: [] })),
    { on: ["youtube:changed"] });
  const online = $derived(new Set(((posts.data?.posts || []) as { version_id?: number }[]).map((p) => p.version_id)));

  const rows = $derived([...song.versions].filter((v) => !hidden(`version:${v.id}`)).sort((a, b) => (b.n ?? 0) - (a.n ?? 0)));
  const isCurrent = (v: Version) => song.current?.id === v.id;
  const edit = $derived(!song.guest);

  const items = (v: Version): MenuItem[] => {
    const bad = troubleOf(v);
    return [
      { label: "Play", icon: "play", disabled: !!bad && bad.short !== "silent", run: () => song.playVersion(v) },
      edit ? { divider: true } : null,
      edit ? { label: isCurrent(v) ? "Current" : "Make current", icon: "star", disabled: isCurrent(v), run: () => act.makeCurrent(song, v) } : null,
      edit ? { label: "Rename the label", icon: "edit", run: () => act.renameLabel(song, v) } : null,
      { label: "Download", icon: "download", run: () => act.downloadVersion(song, v) },
      online.has(v.id as number) ? { label: "On YouTube", icon: "youtube", run: () => replace(href.song(song.id, "release")) } : null,
      edit ? { divider: true } : null,
      edit ? { label: "Delete", icon: "trash", danger: true, run: () => act.deleteVersion(song, v) } : null,
    ];
  };
</script>

<section class="takes col">
  <div class="section-head">
    <h2 class="titled">Renders{#if rows.length}<span class="count num">{rows.length}</span>{/if}</h2>
    {#if edit}
      {#if has("renders")}<button class="btn sm ghost" onclick={() => act.takeFromInbox(song)}><Icon name="inbox" size={14} />From the inbox</button>{/if}
    {/if}
  </div>

  {#if !rows.length}
    <div class="empty card">
      <h3>No renders yet</h3>
      <p>Drop audio anywhere on the song, or add one. Every export you add becomes a render you can compare.</p>
      {#if edit}<button class="btn primary" onclick={() => uploader.pick()}>Add the first render</button>{/if}
    </div>
  {:else}
    <div class="list" role="list">
      {#each rows as v (v.id)}
        {@const t = take(v)!}
        {@const bad = troubleOf(v)}
        {@const name = v.label || (v.filename ? v.filename.replace(/\.[a-z0-9]{2,4}$/i, "") : "") || versionName(v)}
        {@const sounding = player.playing && song.playing && song.versionOf(player.active as "A" | "B")?.id === v.id}
        <div class="take" class:current={isCurrent(v)} class:bad={!!bad} role="listitem"
             style:--wave-hue={hue(v.filename || name)} use:contextMenu={() => items(v)}>
          <div class="ground" aria-hidden="true"><Wave shape={t.shape} /></div>
          <button class="play" aria-label="{sounding ? 'Pause' : 'Play'} {versionName(v)}" onclick={() => song.playVersion(v)}>
            <Icon name={sounding ? "pause" : "play"} size={16} />
          </button>
          <span class="n num">v{v.n}</span>
          <div class="info">
            <div class="top">
              {#if edit}
                <button class="name truncate" onclick={() => act.renameLabel(song, v)} title="Rename the label">{name}</button>
              {:else}<span class="name truncate">{name}</span>{/if}
              {#if isCurrent(v)}<span class="tag"><Icon name="star" size={10} /><span class="tagword">current</span></span>{/if}
              {#if online.has(v.id as number)}<span class="tag warn" title="This render is the one that went to YouTube">YouTube</span>{/if}
              {#if bad}<span class="tag bad" title={bad.says}><Icon name="warning" size={11} />{bad.short}</span>{/if}
            </div>
            <div class="sub truncate">
              {#if v.label && v.filename}<span>{v.filename}</span><span class="dot"></span>{/if}
              <span class="num">{ymd(v.created_at)}</span>
              {#if v.duration}<span class="dot"></span><span class="num">{time(v.duration)}</span>{/if}
            </div>
          </div>
          <div class="stats num">
            {#if v.size}<span>{bytes(v.size)}</span>{/if}
            {#if t.bitrate}<span>{t.bitrate} kbps</span>{/if}
            {#if t.peak_db != null}<span>{t.peak_db} dB</span>{/if}
          </div>
          <button class="icon-btn sm" aria-label="More for {versionName(v)}" onclick={(e) => showMenu(items(v), { anchor: e.currentTarget })}><Icon name="more" size={18} /></button>
        </div>
      {/each}
    </div>
  {/if}

  {#if song.has("vocals")}<VocalsPanel />{/if}
</section>

<style>
  .titled { display: flex; align-items: center; gap: var(--s2); }
  .count { font: 600 var(--t-sm)/1 var(--font); color: var(--text-3); padding: 4px 8px; border-radius: 999px; background: var(--hover); }
  /* The list is the container: what folds away goes by its own width, not the window's,
     because the sidebar being open or shut changes the room without changing the window. */
  .list { display: flex; flex-direction: column; gap: var(--s2); container-type: inline-size; }
  .take {
    position: relative; isolation: isolate; display: flex; align-items: center; gap: var(--s3);
    min-height: 68px; padding: var(--s2) var(--s3) var(--s2) var(--s2);
    border-radius: var(--r-lg); background: var(--glass); box-shadow: var(--edge-top);
    transition: background var(--fast), box-shadow var(--fast);
  }
  .take:hover { background: var(--glass-hover); }
  .take.current { box-shadow: var(--edge-top), inset 0 0 0 1px var(--line-2); }
  /* The take's own colour: its waveform behind the whole row, muted (it is read through
     the row's words) and faded at both ends so the shape stops instead of being cut off. */
  .ground {
    position: absolute; inset: 6px 8px; z-index: -1; pointer-events: none;
    color: hsl(var(--wave-hue, 150) 45% 42%); opacity: 0.55;
    -webkit-mask-image: linear-gradient(90deg, transparent, black 14%, black 86%, transparent);
    mask-image: linear-gradient(90deg, transparent, black 14%, black 86%, transparent);
    transition: opacity var(--fast);
  }
  .ground :global(svg) { width: 100%; height: 100%; }
  .ground :global(polygon) { fill: currentColor; }
  .take:hover .ground { opacity: 0.75; }
  .take.bad .ground { color: var(--bad); opacity: 0.5; }

  .play {
    display: grid; place-items: center; width: 40px; height: 40px; flex: none; border-radius: 50%;
    background: rgb(255 255 255 / 0.92); color: #111; box-shadow: 0 4px 14px rgba(0, 0, 0, 0.35);
    transition: transform var(--fast);
  }
  .play:hover { transform: scale(1.06); }
  .n { font: 800 var(--t-md)/1 var(--display); width: 3.4ch; color: var(--text); flex: none; text-shadow: 0 1px 6px rgba(0, 0, 0, 0.6); }
  .info { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
  .top { display: flex; align-items: center; gap: var(--s2); min-width: 0; }
  .name { font-weight: 600; text-align: left; border-radius: 6px; padding: 0 2px; margin: 0 -2px; min-width: 0; text-shadow: 0 1px 6px rgba(0, 0, 0, 0.6); }
  button.name:hover { background: var(--hover); }
  .tag { flex: none; display: inline-flex; align-items: center; gap: 3px; }
  .sub { display: flex; align-items: center; gap: var(--s2); font-size: var(--t-sm); color: var(--text-2); min-width: 0; }
  .dot { width: 3px; height: 3px; border-radius: 50%; background: var(--text-3); flex: none; }
  .stats { display: flex; gap: var(--s3); font-size: var(--t-xs); color: var(--text-3); flex: none; white-space: nowrap; }
  @container (max-width: 760px) { .stats { display: none; } }
  @container (max-width: 480px) { .n { display: none; } .take { gap: var(--s2); } .tagword { display: none; } }
</style>
