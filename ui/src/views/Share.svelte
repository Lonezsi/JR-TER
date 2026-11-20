<!-- One song somebody shared with you.

     Not yours: you cannot rename it, post it, put it on an album or delete it. What you
     can do is listen, read the words, and work on the sound. Anything you save becomes a
     copy in your own library, which is the point: a share is somewhere to work, not
     permission to overwrite. -->
<script lang="ts">
  import Icon from "$ui/Icon.svelte";
  import Cover from "$ui/Cover.svelte";
  import { get, post, attempt } from "$lib/api";
  import { emit } from "$lib/bus";
  import { playRender } from "$lib/player.svelte";
  import { resource } from "$lib/resource.svelte";
  import { href } from "$lib/router.svelte";
  import { accent, setGround } from "$lib/look.svelte";
  import { useCommands } from "$lib/commands";
  import { hue, time, when } from "$lib/util";
  import type { Render } from "$lib/types";

  let { params }: { params: Record<string, string> } = $props();
  const id = $derived(params.id);

  interface Sheet { id: number; name?: string; text?: string }
  interface Preset { id: number; name: string; data?: { bands?: unknown[] } }
  interface Person {
    share: number; name?: string; handle?: string; updated_at?: number | null; changes?: number;
    made_anything?: boolean; sheets: Sheet[]; presets: Preset[];
    artwork: { id: number; caption?: string }[]; versions: { id: number; n?: number; filename?: string }[];
  }
  interface Shared {
    share: number; from: string; as_name?: string | null; song: { id: number; title: string };
    artwork: { id: number; caption?: string }[];
    version: { n?: number; duration?: number } | null;
    presets: Preset[]; sheets: Sheet[];
    mine?: { presets?: Preset[]; sheets?: Sheet[] };
  }

  const res = resource(() => get<Shared>(`/api/shared/${id}`), { on: ["shares:changed"] });
  const others = resource(() => get<{ people: Person[] }>(`/api/shared/${id}/guests`).catch(() => ({ people: [] as Person[] })), { on: ["shares:changed"] });
  const data = $derived(res.data);
  const people = $derived(others.data?.people ?? []);
  const art = (image: number) => `/api/shared/${id}/artwork/${image}`;
  const firstArt = $derived(data?.artwork?.[0] ? art(data.artwork[0].id) : null);

  let texts = $state<Record<string, string>>({});
  let busy = $state("");

  $effect(() => {
    if (!data) return;
    setGround(firstArt, hue(data.song.title));
    accent.viewing(null);
  });

  /* Played straight off the share's own address, not through a version id: the server
     works out which file this is from the share, so a recipient never names a version
     and has no way to ask for one they were not given. */
  function play() {
    if (!data) return;
    playRender({
      id: `share-${id}` as unknown as number, kind: "render", name: data.song.title,
      title: data.song.title, url: `/api/shared/${id}/audio`, art: firstArt,
    } as unknown as Render, []);
  }

  async function saveSheet(sheet: Sheet | null) {
    const key = sheet ? String(sheet.id) : "new";
    busy = "sheet:" + key;
    const ok = await attempt(() => post(`/api/shared/${id}/sheet`, { from: sheet ? sheet.id : null, text: texts[key] ?? sheet?.text ?? "" }),
      "Saved into your library.");
    busy = "";
    if (ok) { emit("songs:changed"); res.reload(); }
  }
  async function copyPreset(preset: Preset) {
    busy = "preset:" + preset.id;
    const ok = await attempt(() => post(`/api/shared/${id}/preset`, { from: preset.id, data: preset.data ?? {} }),
      "Copied into your library.");
    busy = "";
    if (ok) { emit("songs:changed"); res.reload(); }
  }

  const initials = (p: Person) => (p.name || p.handle || "?").trim().split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
  function toPerson(p: Person) {
    document.querySelector(`[data-person="${p.share}"]`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  useCommands(() => data ? [
    { id: "share.play", group: "This song", title: `Play ${data.song.title}`, icon: "play", run: play },
    { id: "share.work", group: "This song", title: "Work on this song", icon: "edit", run: () => { location.hash = href.guestSong(id, data.song.id); } },
  ] : []);
</script>

<div class="page">
  {#if res.loading && !res.data}
    <div class="hero" aria-hidden="true">
      <span class="sk" style="width:160px;height:160px;border-radius:var(--r-xl)"></span>
      <div class="col grow" style="gap:12px;align-self:center">
        <span class="sk" style="height:12px;width:90px"></span>
        <span class="sk" style="height:34px;width:55%"></span>
        <span class="sk" style="height:12px;width:35%"></span>
      </div>
    </div>
  {:else if res.error && !res.data}
    <div class="notice bad row">
      <Icon name="warning" size={18} /><span class="grow">{res.error}</span>
      <a class="btn sm" href={href.library("shared")}>Shared with me</a>
      <button class="btn sm" onclick={res.reload}>Try again</button>
    </div>
  {:else if data}
    <div class="hero">
      <Cover url={firstArt} title={data.song.title} size="clamp(120px, 22vw, 180px)" radius="var(--r-xl)" />
      <div class="meta">
        <span class="eyebrow">Shared with you</span>
        <h1>{data.song.title}</h1>
        <div class="row wrap muted">
          <span class="tag">from {data.from}</span>
          {#if data.version}
            <span class="num">v{data.version.n}{data.version.duration ? " · " + time(data.version.duration) : ""}</span>
          {/if}
        </div>
        <p class="muted note">
          {#if data.as_name}You are <b>{data.as_name}</b> on this, so anything you save is named after you.
          {:else}Anything you save becomes your own copy.{/if}
        </p>
        <div class="row wrap acts">
          {#if data.version}
            <button class="btn primary lg" onclick={play}><Icon name="play" size={18} /> Play</button>
          {:else}
            <span class="faint">There is no render on this song yet.</span>
          {/if}
          <a class="btn lg" href={href.guestSong(id, data.song.id)}><Icon name="edit" size={18} /> Work on this song</a>
        </div>
        {#if people.length}
          <div class="row wrap people" aria-label="Others on this song">
            {#each people as p (p.share)}
              <button class="chip" class:on={p.made_anything} title={p.name || p.handle} onclick={() => toPerson(p)}>{initials(p)}</button>
            {/each}
          </div>
        {/if}
      </div>
    </div>

    {#if data.artwork.length > 1}
      <div class="art-row">
        {#each data.artwork as image (image.id)}
          <figure><img src={art(image.id)} alt={image.caption || data.song.title} loading="lazy" />{#if image.caption}<figcaption>{image.caption}</figcaption>{/if}</figure>
        {/each}
      </div>
    {/if}

    <section class="col">
      <div class="section-head"><h2>Words</h2></div>
      {#each data.sheets.length ? data.sheets : [null] as sheet (sheet?.id ?? "new")}
        {@const key = sheet ? String(sheet.id) : "new"}
        <div class="card block">
          <div class="row">
            <span class="grow truncate t">{sheet ? sheet.name || "Lyrics" : "Your words"}</span>
            <button class="btn sm" disabled={busy === "sheet:" + key} onclick={() => saveSheet(sheet)}>Save as mine</button>
          </div>
          <textarea class="field text" rows="10" aria-label={sheet?.name || "Lyrics"}
                    placeholder={sheet ? "" : "Nothing written yet. Anything you add here is yours."}
                    value={texts[key] ?? sheet?.text ?? ""}
                    oninput={(e) => (texts[key] = e.currentTarget.value)}></textarea>
        </div>
      {/each}
    </section>

    <section class="col">
      <div class="section-head"><h2>Sound</h2></div>
      {#if data.presets.length}
        <div class="list">
          {#each data.presets as preset (preset.id)}
            <div class="item">
              <Icon name="eq" size={18} />
              <span class="grow truncate t">{preset.name}</span>
              <button class="btn sm" disabled={busy === "preset:" + preset.id} onclick={() => copyPreset(preset)}>Copy to mine</button>
            </div>
          {/each}
        </div>
      {:else}
        <p class="faint">No settings saved on this song yet.</p>
      {/if}
    </section>

    {#if data.mine?.presets?.length || data.mine?.sheets?.length}
      <section class="col">
        <div class="section-head"><h2>Yours, on this song</h2></div>
        <p class="faint">These are in your library now and stay yours, even if the share goes away.</p>
        <div class="list">
          {#each data.mine?.sheets ?? [] as s (s.id)}<div class="item"><span class="tag">words</span><span class="grow truncate">{s.name}</span></div>{/each}
          {#each data.mine?.presets ?? [] as p (p.id)}<div class="item"><span class="tag">sound</span><span class="grow truncate">{p.name}</span></div>{/each}
        </div>
      </section>
    {/if}

    {#if people.length}
      <section class="col">
        <div class="section-head"><h2>What the others made</h2></div>
        {#each people as p (p.share)}
          <div class="card block" data-person={p.share}>
            <div class="row">
              <span class="chip on">{initials(p)}</span>
              <b>{p.name || p.handle}</b>
              {#if p.handle}<span class="faint">@{p.handle}</span>{/if}
              <span class="grow"></span>
              {#if p.updated_at}<span class="faint">{when(p.updated_at)}</span>{/if}
            </div>
            {#if !p.made_anything}<p class="faint">Nothing made on this song yet.</p>{/if}
            {#if p.changes}<p class="faint">{p.changes} {p.changes === 1 ? "change" : "changes"} to the song itself.</p>{/if}
            {#if p.artwork.length}
              <div class="art-row">
                {#each p.artwork as a (a.id)}<figure><img src={`/api/guestwork/${p.share}/artwork/${a.id}`} alt={a.caption || ""} loading="lazy" /></figure>{/each}
              </div>
            {/if}
            {#each p.versions as v (v.id)}
              <div class="row"><span class="tag">mix</span><span class="grow truncate">{v.filename || "v" + v.n}</span>
                <audio controls preload="none" src={`/api/guestwork/${p.share}/audio/${v.id}`}></audio></div>
            {/each}
            {#each p.sheets as s (s.id)}
              <details open><summary>{s.name || "Words"}</summary><pre>{s.text}</pre></details>
            {/each}
            {#each p.presets as s (s.id)}
              <div class="row"><span class="tag">sound</span><span class="grow truncate">{s.name}</span>
                <span class="faint">{(s.data?.bands || []).length} bands</span></div>
            {/each}
          </div>
        {/each}
      </section>
    {/if}
  {/if}
</div>

<style>
  .hero { display: flex; gap: var(--s6); align-items: flex-end; }
  .meta { display: flex; flex-direction: column; gap: var(--s2); min-width: 0; flex: 1 1 auto; }
  .note { font-size: var(--t-sm); }
  .acts { margin-top: var(--s2); }
  .people { gap: var(--s2); }
  .t { font-weight: 600; }
  .block { padding: var(--s4); display: flex; flex-direction: column; gap: var(--s3); }
  .text { font-family: var(--font); line-height: 1.6; }
  .art-row { display: flex; gap: var(--s3); overflow-x: auto; }
  .art-row figure { margin: 0; flex: none; }
  .art-row img { height: 140px; width: auto; border-radius: var(--r-md); }
  figcaption { font-size: var(--t-xs); color: var(--text-3); margin-top: var(--s1); }
  audio { height: 32px; max-width: 100%; }
  details summary { cursor: pointer; font-weight: 600; }
  pre { white-space: pre-wrap; font: inherit; color: var(--text-2); margin: var(--s2) 0 0; }
  @media (max-width: 640px) { .hero { flex-direction: column; align-items: stretch; } }
</style>
