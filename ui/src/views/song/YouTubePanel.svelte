<!-- Where this song lives on YouTube: the record. Six renders later, "what is actually
     online" is a real question and the answer is not recoverable from anywhere else, so each
     link is kept against the render that went up. Uploading is the panel below this one. -->
<script lang="ts">
  import Icon from "$ui/Icon.svelte";
  import { deleteSoon, hidden } from "$lib/later.svelte";
  import { get, post, patch, del, attempt } from "$lib/api";
  import { emit } from "$lib/bus";
  import { resource } from "$lib/resource.svelte";
  import { contextMenu, showMenu, type MenuItem } from "$lib/menu.svelte";
  import { confirm, sheet } from "$lib/dialog.svelte";
  import { copyText } from "$lib/actions";
  import { toast } from "$lib/toast.svelte";
  import { when } from "$lib/util";
  import { useSong } from "./song.svelte";
  import PickSheet from "./PickSheet.svelte";
  import { versionName } from "./helpers";

  interface Post { id: number; url: string; title?: string; status: string; version_id?: number; version_n?: number; created_at?: number }
  const song = useSong();
  const posts = resource<{ posts: Post[] }>(() => get(`/api/songs/${song.id}/youtube`), { on: ["youtube:changed"] });
  const list = $derived((posts.data?.posts || []).filter((x) => !hidden(`post:${x.id}`)));

  const safe = (url: string) => /^https:\/\/[^\s/]/i.test(url || "");
  const idOf = (url: string) => url.match(/(?:youtu\.be\/|v=|shorts\/|embed\/)([A-Za-z0-9_-]{6,})/)?.[1] || null;

  async function record() {
    const version = song.current;
    if (!version) { toast("There is no render on this song yet."); return; }
    const f = await sheet<{ url: string; title: string; version: string }>({
      title: "Keep the link",
      sub: "Against a render, so six renders from now you can still tell what is online.",
      confirm: "Save it", cancel: "Not yet",
      fields: [
        { name: "url", label: "The YouTube link", placeholder: "https://youtu.be/...", required: true },
        { name: "title", label: "Title on YouTube, if it differs", value: song.song?.title || "" },
        { name: "version", label: "Which render went up", type: "select", value: String(version.id),
          options: song.versions.map((v) => ({ value: String(v.id), label: `${versionName(v)} ${v.label || v.filename || ""}` })) },
      ],
    });
    if (!f || !f.url.trim()) return;
    const done = await attempt(() => post(`/api/songs/${song.id}/youtube`, {
      url: f.url.trim(), title: f.title.trim() || song.song?.title, version_id: Number(f.version), status: "published",
    }), "Saved");
    if (done) { await posts.reload(); emit("youtube:changed", { songId: Number(song.id) }); }
  }

  async function moveTo(p: Post) {
    const got = await sheet<{ key: string }>({
      title: "Which render is this", confirm: "", cancel: "Close", body: PickSheet,
      props: { items: song.versions.map((v) => ({ key: String(v.id), label: versionName(v), sub: v.label || v.filename || "" })) },
    });
    if (!got) return;
    if (await attempt(() => patch(`/api/youtube/${p.id}`, { version_id: Number(got.key) }), "Saved")) {
      await posts.reload(); emit("youtube:changed", { songId: Number(song.id) });
    }
  }

  async function forget(p: Post) {
    deleteSoon(`post:${p.id}`, "Forgot the link (nothing on YouTube changes)", () => del(`/api/youtube/${p.id}`), {
      after: async () => { await posts.reload(); emit("youtube:changed", { songId: Number(song.id) }); },
    });
  }

  const items = (p: Post): MenuItem[] => [
    { label: "Copy the link", icon: "copy", run: () => copyText(p.url, "Link copied") },
    { label: "Watch on YouTube", icon: "external", disabled: !safe(p.url), run: () => { if (safe(p.url)) window.open(p.url, "_blank", "noopener"); } },
    { label: "Change which render it was", icon: "edit", run: () => moveTo(p) },
    { divider: true },
    { label: "Forget this link", icon: "trash", danger: true, run: () => forget(p) },
  ];
</script>

<section class="col">
  <div class="section-head">
    <h2>On YouTube</h2>{#if list.length}<span class="tag">{list.length}</span>{/if}
    <span class="grow"></span>
    <button class="btn sm ghost" onclick={record} title="Paste a link to a video you already posted"><Icon name="link" size={14} />Paste a link</button>
  </div>
  {#if posts.loading && !posts.data}
    <div class="card"><div class="sk" style="height:64px"></div></div>
  {:else if !list.length}
    <div class="card pad faint">Nothing uploaded. Posted it by hand? Paste the link.</div>
  {:else}
    <div class="card list ruled">
      {#each list as p (p.id)}
        {@const code = idOf(p.url)}
        <div class="item" use:contextMenu={() => items(p)}>
          {#if code}<img class="thumb" src="https://i.ytimg.com/vi/{code}/mqdefault.jpg" alt="" loading="lazy" referrerpolicy="no-referrer" />
          {:else}<span class="thumb flat"></span>{/if}
          <span class="grow truncate"><span class="t">{p.title || song.song?.title}</span><br />
            <span class="s">{p.version_n ? `v${p.version_n}` : "render unknown"} · {p.status}{p.created_at ? ` · ${when(p.created_at)}` : ""}</span></span>
          <button class="btn sm ghost" onclick={() => copyText(p.url, "Link copied")}>Copy link</button>
          {#if safe(p.url)}<a class="btn sm ghost" href={p.url} target="_blank" rel="noopener noreferrer">Watch</a>{/if}
          <button class="icon-btn sm" aria-label="More" onclick={(e) => showMenu(items(p), { anchor: e.currentTarget })}><Icon name="more" size={18} /></button>
        </div>
      {/each}
    </div>
  {/if}
</section>

<style>
  .pad { padding: var(--s4); font-size: var(--t-sm); }
  .card.list { padding: var(--s2); }
  .thumb { width: 80px; height: 45px; border-radius: 8px; object-fit: cover; background: var(--hover); flex: none; }
  .item { flex-wrap: wrap; }
</style>
