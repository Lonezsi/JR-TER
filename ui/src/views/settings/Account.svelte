<!-- Who you are on this server, and the Google account that lets a render go to YouTube.

     A library with no door (the auth module off) still has a somebody: there are no
     accounts and nothing to sign in to, but the page should still say whose library this
     is rather than claiming you are not signed in. -->
<script lang="ts">
  import { get, post, patch, del, attempt } from "$lib/api";
  import { app, has, refreshState, isGuest } from "$lib/app.svelte";
  import { leftBehind, save, copyName, summarise } from "../../guest/boot";
  import { bring as bringGuest, copy as copyGuest, clear as clearGuest } from "../../guest/offer";
  import { api } from "$lib/api";
  import { resource } from "$lib/resource.svelte";
  import { confirm } from "$lib/dialog.svelte";
  import { emit } from "$lib/bus";
  import { toast } from "$lib/toast.svelte";
  import { date, when, plural } from "$lib/util";
  import { sheet } from "$lib/dialog.svelte";
  import Icon from "$ui/Icon.svelte";
  import Block from "./Block.svelte";
  import Rows from "./Rows.svelte";
  import Trouble from "./Trouble.svelte";
  import SavedField from "./SavedField.svelte";
  import { signOut, signOutEverywhere, changePassword } from "./acts";
  import type { Person, GoogleState } from "./shapes";

  const auth = has("auth");
  const me = resource(() => auth ? get<{ who: Person }>("/api/auth/me") : Promise.resolve(null));
  const google = has("youtube")
    ? resource(() => get<GoogleState>("/api/youtube/account"), { on: ["youtube:changed"] })
    : null;

  // Foyer, the front door of this machine and its one sign-in: whether this account opens
  // through it, and who Foyer says this browser is (auth.foyer_state on the server)
  type FoyerState = { foyer: { handle: string; linked: boolean; can_make: boolean } | null; foyer_tied: boolean; foyer_tied_as: string | null };
  const foyer = auth ? resource(() => get<FoyerState>("/api/auth/state")) : null;

  async function foyerConnect() {
    const done = await attempt(() => post<{ foyer: string }>("/api/auth/foyer/connect", {}), "Connected to Foyer.");
    if (done) foyer?.reload();
  }
  async function foyerDisconnect() {
    const sure = await confirm("Disconnect from Foyer?",
      "Signing in on Foyer stops opening this library. Your password still works here.",
      "Disconnect", "Keep it");
    if (!sure) return;
    const done = await attempt(() => post("/api/auth/foyer/disconnect", {}), "Disconnected from Foyer.");
    if (done) foyer?.reload();
  }

  const person = $derived<Person>(me.data?.who
    ?? { id: 1, handle: "", name: app.name, is_owner: true, created_at: 0 });
  const chosen = $derived(google?.data?.accounts.find((a) => a.id === google.data?.chosen)
    ?? google?.data?.accounts[0]);

  async function rename(name: string) {
    const done = await patch<{ who: Person }>("/api/auth/me", { name: name.trim() });
    me.set(done);
    refreshState();
    emit("settings:changed");
  }

  async function choose(id: string) {
    if (!google?.data || google.data.chosen === id) return;
    const before = google.data;
    google.set({ ...before, chosen: id });                     // optimistic
    const done = await attempt(() => post<GoogleState>("/api/youtube/account/choose", { id }));
    if (done) google.set(done); else google.set(before);
    emit("youtube:changed");
  }

  async function disconnect(id: string, name: string) {
    const sure = await confirm(`Disconnect ${name}?`,
      "Nothing already uploaded is touched. To send another render you will connect it again. "
      + "Access is revoked only at Google, on your account's third party access page.",
      "Disconnect", "Keep it");
    if (!sure) return;
    const done = await attempt(() => del<GoogleState>(`/api/youtube/account/${encodeURIComponent(id)}`), "Disconnected.");
    if (done) { google?.set(done); emit("youtube:changed"); }
  }

  // ── a guest, or a guest library left in this browser ─────────────────────

  const guest = isGuest();
  /** Signed in, with a guest library still in this browser: how many songs it holds. */
  let left = $state<number | null>(null);
  if (!guest) leftBehind().then((lib) => { left = lib ? lib.tables.songs.length : null; });
  let working = $state(false);

  async function guestCopy() {
    working = true;
    try {
      const r = await fetch("/api/export");
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "That copy couldn't be made.");
      save(await r.blob(), copyName());
    } catch (e) {
      toast((e as Error).message, "bad");
    }
    working = false;
  }

  let picker = $state<HTMLInputElement>();
  async function guestImport(e: Event) {
    const file = (e.currentTarget as HTMLInputElement).files?.[0];
    (e.currentTarget as HTMLInputElement).value = "";
    if (!file) return;
    working = true;
    const done = await attempt(() => api("/api/import", { method: "POST", body: file,
      headers: { "Content-Type": "application/zip" } }));
    working = false;
    if (!done) return;
    toast(`Brought in ${summarise(done)}.`);
    emit("songs:changed"); emit("albums:changed"); emit("playlists:changed"); emit("renders:changed");
    refreshState();
  }

  async function bringLeft() { working = true; if (await bringGuest()) left = left; working = false; }
  async function clearLeft() {
    const sure = await confirm("Clear the guest library from this browser?",
      "Anything you haven't brought in or copied is gone for good.", "Clear it", "Keep it");
    if (sure && await clearGuest()) left = null;
  }

  // ── connecting ─────────────────────────────────────────────────────────────

  let adding = $state(false);
  let form = $state({ name: "", id: "", secret: "" });
  let busy = $state(false);
  const where = resource(() => get<{ register: string[] }>("/api/youtube/auth/addresses"), { lazy: true });

  function openAdd() {
    adding = true;
    if (!where.data) where.reload();
  }

  const ready = () => {
    if (form.id.trim() && form.secret.trim()) return true;
    toast("Both values are needed.", "bad");
    return false;
  };

  /* One press, Google's own account chooser, and back here. A whole page navigation
   * rather than a popup, because a blocked popup is a button that does nothing and this
   * library is opened on a phone as often as not. */
  async function signIn() {
    if (!ready() || busy) return;
    busy = true;
    const started = await attempt(() => post<{ url: string }>("/api/youtube/auth/start",
      { client_id: form.id.trim(), client_secret: form.secret.trim(), name: form.name.trim() }));
    busy = false;
    if (started?.url) location.href = started.url;
  }

  // The device flow: the right answer when the browser is not on the same machine as the
  // server, which on a headless host is every time.
  async function useCode() {
    if (!ready() || busy) return;
    busy = true;
    const started = await attempt(() => post<{ verification_url: string; user_code: string; expires_in?: number }>(
      "/api/youtube/connect",
      { client_id: form.id.trim(), client_secret: form.secret.trim(), name: form.name.trim() }));
    busy = false;
    if (!started) return;
    const done = await sheet({
      title: "Sign in to YouTube",
      sub: `On any device with a browser signed into the right channel, open ${started.verification_url} and enter `
         + `${started.user_code}. The code lasts ${Math.round((started.expires_in || 900) / 60)} minutes.`,
      confirm: "I have done it",
      cancel: "Stop",
    });
    if (!done) return;
    const finished = await attempt(() => post<{ channel?: string }>("/api/youtube/finish", {}),);
    if (!finished) return;
    form = { name: "", id: "", secret: "" };
    adding = false;
    emit("youtube:changed");
  }
</script>

<div class="stack">
  {#if guest}
    <Block title="You">
      <div class="setting who">
        <span class="face guest" aria-hidden="true"><Icon name="user" size={22} /></span>
        <div class="what">
          <div class="t truncate">Guest</div>
          <div class="s">No account needed. Your library is saved in this browser only, so clearing its
            site data or switching browsers leaves it behind.</div>
        </div>
      </div>
      <div class="setting">
        <div class="what">
          <div class="t">Sign in</div>
          <div class="s">Your songs here come with you: you'll be offered to bring them in.</div>
        </div>
        <div class="ctl row">
          <a class="btn sm ghost" href="/login?new">Make an account</a>
          <a class="btn sm primary" href="/login"><Icon name="door" size={14} /> Sign in</a>
        </div>
      </div>
    </Block>

    <Block title="This browser" note="The library file is a zip of plain text and your audio. It opens anywhere, and any JR!TER can bring it in.">
      <div class="setting">
        <div class="what">
          <div class="t">Take a copy</div>
          <div class="s">Every song, word and render, with the audio.</div>
        </div>
        <div class="ctl"><button class="btn sm" disabled={working} onclick={guestCopy}><Icon name="download" size={14} /> Take a copy</button></div>
      </div>
      <div class="setting">
        <div class="what">
          <div class="t">Bring a library in</div>
          <div class="s">A copy you took here or from any JR!TER. It's added to what's here; nothing is replaced.</div>
        </div>
        <div class="ctl">
          <input class="hidden-file" type="file" accept=".zip,application/zip" bind:this={picker} onchange={guestImport} />
          <button class="btn sm" disabled={working} onclick={() => picker?.click()}><Icon name="upload" size={14} /> Choose a file</button>
        </div>
      </div>
    </Block>
  {:else}
  {#if left !== null}
    <Block title="Your guest library" note="From when you used JR!TER here without signing in. It's still in this browser.">
      <div class="setting">
        <div class="what">
          <div class="t">{plural(left, "song")} waiting</div>
          <div class="s">Bring them into this account, keep a copy, or clear them out of the browser.</div>
        </div>
        <div class="ctl row">
          <button class="btn sm ghost" disabled={working} onclick={clearLeft}>Clear</button>
          <button class="btn sm ghost" disabled={working} onclick={() => copyGuest()}>Take a copy</button>
          <button class="btn sm primary" disabled={working} onclick={bringLeft}>Bring it in</button>
        </div>
      </div>
    </Block>
  {/if}
  <Block title="You" note={auth ? "" : "This copy is running without the door, so there is one library and it is this one."}>
    {#if me.loading && !me.data && auth}
      <Rows n={2} face />
    {:else if me.error && !me.data}
      <Trouble message={me.error} retry={me.reload} />
    {:else}
      <div class="setting who">
        <span class="face" aria-hidden="true">
          {(person.name || "?").trim()[0]?.toUpperCase()}
          {#if chosen?.has_avatar}<img src="/api/youtube/avatar" alt="" onerror={(e) => ((e.currentTarget as HTMLElement).style.display = "none")} />{/if}
        </span>
        <div class="what">
          <div class="t truncate">{person.name}</div>
          <div class="s truncate">
            {person.handle}{person.is_owner ? (person.handle ? " · " : "") + "owner of this library" : ""}
            {#if person.created_at} · since {date(person.created_at)}{/if}
          </div>
        </div>
      </div>
      {#if auth}
        <div class="setting stack-m">
          <div class="what">
            <div class="t">Name</div>
            <div class="s">What people call you: on your shares and beside your handle. Your handle does not change.</div>
          </div>
          <div class="ctl wide"><SavedField label="Name" value={person.name} save={rename} maxlength={80} /></div>
        </div>
      {/if}
    {/if}
  </Block>

  {#if auth}
    <Block title="Sign in">
      <div class="setting">
        <div class="what">
          <div class="t">Password</div>
          <div class="s">Changing it signs every other device out and unties Foyer; this one stays signed in.</div>
        </div>
        <div class="ctl"><button class="btn sm" onclick={changePassword}><Icon name="lock" size={14} /> Change</button></div>
      </div>
      <div class="setting">
        <div class="what">
          <div class="t">Sign out</div>
          <div class="s">Ends the session on this device only.</div>
        </div>
        <div class="ctl"><button class="btn sm" onclick={signOut}><Icon name="logout" size={14} /> Sign out</button></div>
      </div>
      <div class="setting">
        <div class="what">
          <div class="t">Sign out everywhere</div>
          <div class="s">Every device, this one too, and Foyer is untied.</div>
        </div>
        <div class="ctl"><button class="btn sm" onclick={signOutEverywhere}><Icon name="logout" size={14} /> Everywhere</button></div>
      </div>
    </Block>

    <Block title="Foyer" note="Foyer is this machine's front door, and one sign-in for every site on it. Connected, signing in there opens this library on any device.">
      {#if foyer?.data}
        <div class="setting">
          <div class="what">
            {#if foyer.data.foyer_tied}
              <div class="t">Connected{foyer.data.foyer_tied_as ? ` as @${foyer.data.foyer_tied_as}` : ""}</div>
              <div class="s">Signing in on Foyer opens this library. A password change or signing out everywhere ends it.</div>
            {:else if foyer.data.foyer}
              <div class="t">Signed in on Foyer as @{foyer.data.foyer.handle}</div>
              <div class="s">Not connected to this library yet.</div>
            {:else}
              <div class="t faint">Not connected</div>
              <div class="s">Sign in on Foyer, then connect it here.</div>
            {/if}
          </div>
          <div class="ctl">
            {#if foyer.data.foyer_tied}
              <button class="btn sm ghost" onclick={foyerDisconnect}><Icon name="close" size={14} /> Disconnect</button>
            {:else if foyer.data.foyer}
              <button class="btn sm" onclick={foyerConnect}><Icon name="link" size={14} /> Connect to Foyer</button>
            {:else}
              <a class="btn sm" href="/foyer/account?next=/"><Icon name="door" size={14} /> Sign in on Foyer</a>
            {/if}
          </div>
        </div>
      {:else}
        <Rows n={1} />
      {/if}
    </Block>
  {/if}

  {#if google}
    <Block title="Google and YouTube"
           note="Connecting a Google account is what lets JR!TER send a render to YouTube for you. It is per account: yours is not shared with anybody else on this server.">
      {#snippet actions()}
        {#if google.data?.accounts.length && !adding}
          <button class="btn sm ghost" onclick={openAdd}><Icon name="plus" size={14} /> Add another</button>
        {/if}
      {/snippet}
      {#if google.loading && !google.data}
        <Rows n={1} face />
      {:else if google.error && !google.data}
        <Trouble message={google.error} retry={google.reload} />
      {:else}
        {#each google.data?.accounts ?? [] as a (a.id)}
          {@const on = a.id === google.data?.chosen}
          <div class="setting acct">
            <button class="pick" class:on role="radio" aria-checked={on} onclick={() => choose(a.id)}>
              <span class="face sm" aria-hidden="true">
                {(a.name || "?").trim()[0]?.toUpperCase()}
                {#if on && a.has_avatar}<img src="/api/youtube/avatar" alt="" />{/if}
              </span>
              <span class="what">
                <span class="t truncate">{a.name}</span>
                <span class="s truncate">{a.connected_at ? `connected ${when(a.connected_at)}` : "connected"}</span>
              </span>
              {#if on}<span class="tag">In use</span>{/if}
            </button>
            <button class="icon-btn sm" title="Disconnect {a.name}" aria-label="Disconnect {a.name}"
                    onclick={() => disconnect(a.id, a.name)}><Icon name="close" size={15} /></button>
          </div>
        {/each}
        {#if !google.data?.accounts.length && !adding}
          <div class="setting">
            <div class="what"><div class="t faint">Not connected</div></div>
            <div class="ctl"><button class="btn sm primary" onclick={openAdd}>Connect</button></div>
          </div>
        {/if}
        {#if adding}
          <div class="connect">
            <ol>
              <li>Make a project at <a href="https://console.cloud.google.com/" target="_blank" rel="noopener noreferrer">console.cloud.google.com</a>
                  and switch on the <b>YouTube Data API v3</b>.</li>
              <li>Under Credentials, make an <b>OAuth client ID</b>. A <b>Web application</b> one signs in with the button;
                  add every address below as an authorised redirect URI, since this library answers on more than one.
                  A <b>TV and Limited Input</b> one needs no address and is the one that works with the code, when this
                  server is on a different machine from your browser.
                {#if where.data?.register?.length}
                  <ul class="mono">{#each where.data.register as one (one)}<li>{one}</li>{/each}</ul>
                {:else if where.loading}<span class="faint"> Looking up the addresses...</span>
                {:else if where.error}<Trouble message={where.error} retry={where.reload} />{/if}
              </li>
              <li>Paste the two values here. They are stored on your own server, beside the library rather than in it,
                  and go nowhere except Google.</li>
            </ol>
            <label class="label">A name for this account
              <input class="field" bind:value={form.name} placeholder="my channel" autocomplete="off" /></label>
            <label class="label">Client ID<span class="req">*</span>
              <input class="field" bind:value={form.id} autocomplete="off" spellcheck="false"
                     placeholder="000000000000-xxxxxxxx.apps.googleusercontent.com" /></label>
            <label class="label">Client secret<span class="req">*</span>
              <input class="field" type="password" bind:value={form.secret} autocomplete="off" /></label>
            <div class="row wrap">
              <button class="btn sm primary" disabled={busy} onclick={signIn}>Sign in with Google</button>
              <button class="btn sm ghost" disabled={busy} onclick={useCode}>Use a code instead</button>
              <button class="btn sm ghost" onclick={() => (adding = false)}>Never mind</button>
            </div>
            <p class="hint">Google restricts uploads from an app it has not audited: until yours is reviewed, everything
              it uploads stays <b>private</b>. That is Google's rule, not JR!TER's.
              {plural(google.data?.accounts.length ?? 0, "account")} connected.</p>
          </div>
        {/if}
      {/if}
    </Block>
  {/if}
  {/if}
</div>

<style>
  .stack { display: flex; flex-direction: column; gap: var(--s6); }
  .who { gap: var(--s4); }
  .face {
    position: relative; flex: none; width: 48px; height: 48px; border-radius: 50%; overflow: hidden;
    display: grid; place-items: center; font: 800 20px/1 var(--display);
    background: var(--accent-soft); color: var(--accent-text); border: 1px solid var(--accent-line);
  }
  .face.guest { background: transparent; color: var(--text-3); border: 1.5px dashed color-mix(in srgb, var(--text) 32%, transparent); }
  .hidden-file { display: none; }
  .ctl.row { display: flex; gap: var(--s2); flex-wrap: wrap; justify-content: flex-end; }
  .face.sm { width: 36px; height: 36px; font-size: 15px; }
  .face img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
  .stack-m .ctl.wide { flex: 0 1 280px; }
  @media (max-width: 640px) { .stack-m { flex-direction: column; align-items: stretch; } .stack-m .ctl.wide { flex-basis: auto; } }
  .acct { padding: var(--s1) var(--s2) var(--s1) var(--s1); }
  .pick {
    flex: 1 1 auto; min-width: 0; display: flex; align-items: center; gap: var(--s3);
    padding: var(--s2) var(--s3); border-radius: var(--r-md); text-align: left; min-height: 48px;
    transition: background var(--fast);
  }
  .pick:hover { background: var(--hover); }
  .pick.on { background: var(--accent-soft); }
  .pick .what { display: flex; flex-direction: column; min-width: 0; flex: 1 1 auto; }
  .pick .t { font-weight: 600; }
  .pick .s { font-size: var(--t-sm); color: var(--text-2); }
  .connect { display: flex; flex-direction: column; gap: var(--s3); padding: var(--s4); border-top: 1px solid var(--line); }
  ol { margin: 0; padding-left: 1.3em; color: var(--text-2); font-size: var(--t-sm); display: flex; flex-direction: column; gap: var(--s2); }
  ol ul { margin: var(--s2) 0 0; padding-left: 1.1em; font-size: var(--t-xs); color: var(--text); overflow-wrap: anywhere; }
  ol a { color: var(--accent-text); }
</style>
