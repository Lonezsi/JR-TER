<!-- Settings, and the account, and the update notes: one place, with the section kept in the
     hash (#/settings/appearance). Wide, a list of sections beside the one you are in; on a
     phone, the list is a screen of its own and a section pushes in with a way back.

     A section only exists when its module is on and this person is allowed it. A server
     without the door has no People, Devices or password, and the screen is still whole. -->
<script lang="ts">
  import type { Component } from "svelte";
  import { app, has, ownsTheMachine, isGuest } from "$lib/app.svelte";
  import { go, replace, href } from "$lib/router.svelte";
  import { useCommands, type Command } from "$lib/commands";
  import { shell } from "../shell/state.svelte";
  import Icon from "$ui/Icon.svelte";
  import Account from "./settings/Account.svelte";
  import Library from "./settings/Library.svelte";
  import Appearance from "./settings/Appearance.svelte";
  import People from "./settings/People.svelte";
  import Devices from "./settings/Devices.svelte";
  import Tools from "./settings/Tools.svelte";
  import Updates from "./settings/Updates.svelte";
  import Health from "./settings/Health.svelte";
  import About from "./settings/About.svelte";
  import { signOut, changePassword, takeCopy } from "./settings/acts";

  let { params }: { params: Record<string, string> } = $props();

  interface Section { id: string; label: string; icon: string; sub: string; view: Component<any>; badge?: number }

  const owner = $derived((void app.summary, ownsTheMachine()));
  const failed = $derived(Object.keys(app.failed).length);

  const sections = $derived.by<Section[]>(() => ([
    { id: "account", label: "Account", icon: "user", view: Account,
      sub: isGuest() ? "Guest, this browser, signing in" : has("auth") ? "You, your password, Google" : "Your library, Google" },
    { id: "library", label: "Library", icon: "library", view: Library, sub: "Name, storage, copy, erase" },
    { id: "appearance", label: "Appearance", icon: "palette", view: Appearance, sub: "Colour, glass, font" },
    has("auth") && owner ? { id: "people", label: "People", icon: "people", view: People, sub: "Accounts and invites" } : null,
    has("auth") ? { id: "devices", label: "Devices", icon: "key", view: Devices, sub: "Desktop agent tokens" } : null,
    has("youtube") || has("sync") ? { id: "tools", label: "Playback and tools", icon: "wave", view: Tools,
      sub: [has("youtube") ? "ffmpeg" : "", has("sync") ? "folder timing" : ""].filter(Boolean).join(", ") } : null,
    (has("updater") && owner) || has("devlog")
      ? { id: "updates", label: "Updates", icon: "download", view: Updates, sub: "Version and what changed" } : null,
    owner ? { id: "health", label: "Health", icon: "bolt", view: Health, sub: "Errors and modules", badge: failed } : null,
    { id: "about", label: "About", icon: "info", view: About, sub: shell.narrow ? "Version, links" : "Version, links, shortcuts" },
  ] as (Section | null)[]).filter((s): s is Section => !!s));

  // Wide always shows one section; narrow shows the list until one is asked for.
  const asked = $derived(sections.find((s) => s.id === params.section));
  const current = $derived(asked ?? (shell.narrow ? undefined : sections[0]));

  function pick(e: MouseEvent, id: string) {
    if (shell.narrow || e.metaKey || e.ctrlKey || e.shiftKey || e.button) return;   // a push, a new tab
    e.preventDefault();
    replace(href.settings(id));                 // choosing a section is not a step in Back
  }

  useCommands(() => ([
    ...sections.map((s) => ({
      id: `settings.${s.id}`, group: "Settings", title: `Settings: ${s.label}`, sub: s.sub, icon: s.icon,
      keywords: "preferences options", run: () => go(href.settings(s.id)),
    })),
    has("auth") ? { id: "settings.password", group: "Settings", title: "Change password", icon: "lock", run: changePassword } : null,
    isGuest() ? { id: "settings.signin", group: "Settings", title: "Sign in", sub: "Bring your guest library with you", icon: "door", keywords: "login account", run: () => { location.href = "/login"; } } : null,
    has("auth") ? { id: "settings.signout", group: "Settings", title: "Sign out", icon: "logout", run: signOut } : null,
    has("export") ? { id: "settings.copy", group: "Settings", title: "Take a copy of the library", icon: "download", keywords: "export backup", run: takeCopy } : null,
    has("updater") && owner ? { id: "settings.update", group: "Settings", title: "Check for updates", icon: "refresh", run: () => go(href.settings("updates")) } : null,
    { id: "settings.keys", group: "Settings", title: "Keyboard shortcuts", icon: "command", hint: "?", run: () => { shell.keys = true; } },
  ] as (Command | null)[]).filter((c): c is Command => !!c));
</script>

<div class="page settings" class:narrow={shell.narrow}>
  {#if shell.narrow && current}
    <div class="back">
      <button class="btn ghost sm" onclick={() => go(href.settings())}><Icon name="chev-left" size={16} /> Settings</button>
    </div>
    <div class="page-head"><h1>{current.label}</h1></div>
  {:else if shell.narrow}
    <div class="page-head"><h1>Settings</h1></div>
  {/if}

  <div class="frame">
    {#if !shell.narrow || !current}
      <nav class="nav {shell.narrow ? 'card' : 'glass'}" aria-label="Settings sections">
        {#if !shell.narrow}<div class="eyebrow head">Settings</div>{/if}
        <div class="list">
          {#each sections as s (s.id)}
            <a class="item" class:on={current?.id === s.id} href={href.settings(s.id)}
               aria-current={current?.id === s.id ? "page" : undefined} onclick={(e) => pick(e, s.id)}>
              <Icon name={s.icon} size={18} />
              <span class="grow">
                <span class="t truncate">{s.label}</span>
                {#if shell.narrow}<span class="s truncate">{s.sub}</span>{/if}
              </span>
              {#if s.badge}<span class="badge warn">{s.badge}</span>{/if}
              {#if shell.narrow}<Icon name="chev-right" size={16} />{/if}
            </a>
          {/each}
        </div>
      </nav>
    {/if}

    {#if current}
      {#key current.id}
        {@const View = current.view}
        <div class="body enter">
          {#if !shell.narrow}<h2 class="title">{current.label}</h2>{/if}
          <View />
        </div>
      {/key}
    {/if}
  </div>
</div>

<style>
  .frame { display: grid; grid-template-columns: minmax(180px, 220px) minmax(0, 1fr); gap: var(--s5); align-items: start; }
  /* With the sidebar open the screen is often under 700px wide, and a 200px list beside a
     330px column is the layout that crushed every row. Under that the list is a strip of
     tabs on top and the section gets the full width. */
  @container page (max-width: 700px) {
    .frame:not(.x) { grid-template-columns: minmax(0, 1fr); }
    /* relative, not static: the glass edge is an absolute ::after, and with the nav static
       it sized itself to the whole scroll area (a big edged frame with no gap). */
    .nav:not(.card) { position: relative; top: auto; padding: var(--s1); }
    .nav:not(.card) .head { display: none; }
    /* Wraps rather than scrolls: a strip that hides Health and About past its edge has nothing
       saying they are there. */
    .nav:not(.card) .list { flex-direction: row; flex-wrap: wrap; gap: 2px; }
    .nav:not(.card) .item { flex: none; min-height: 40px; }
    .nav:not(.card) .item :global(.badge) { margin-left: var(--s1); }
  }
  .narrow .frame { grid-template-columns: minmax(0, 1fr); gap: var(--s4); }
  .nav { padding: var(--s2); position: sticky; top: var(--s5); }
  .narrow .nav { position: relative; top: auto; padding: var(--s1); }
  .head { padding: var(--s3) var(--s3) var(--s2); }
  .nav .item { min-height: 44px; }
  .narrow .nav .item { min-height: 58px; }
  .nav .t { display: block; }
  .nav .s { display: block; font-weight: 500; }
  .badge { background: var(--warn); }
  .body { display: flex; flex-direction: column; gap: var(--s4); min-width: 0; max-width: 820px; }
  .title { padding: 0 var(--s1); }
  .back { margin: 0 calc(var(--s2) * -1); }
  /* No wider than a phone: the sections are made of rows, and rows read badly at 1100px. */
</style>
