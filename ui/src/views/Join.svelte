<!-- Somebody has sent you a song.

     The screen a share link opens, and the only one that may be reached before there is an
     account. So it does both jobs: it says what has been sent and by whom, and either
     takes the share for whoever is signed in, or makes an account right here.

     The token in the address is the permission and the invitation together. It cannot be
     guessed, the server keeps only its digest, and it is spent the first time it works,
     so a forwarded link opens for the first person and is simply closed for the rest. -->
<script lang="ts">
  import Icon from "$ui/Icon.svelte";
  import { get, post, attempt } from "$lib/api";
  import { refreshState } from "$lib/app.svelte";
  import { emit } from "$lib/bus";
  import { go, href } from "$lib/router.svelte";
  import { resource } from "$lib/resource.svelte";
  import { toast } from "$lib/toast.svelte";

  let { params }: { params: Record<string, string> } = $props();
  const token = $derived(params.token);

  interface Invitation { song: { title: string }; from: string; as_name?: string | null; signed_in: boolean }
  const res = resource(() => get<Invitation>(`/api/shares/invitation/${encodeURIComponent(token)}`));
  const invite = $derived(res.data);

  let handle = $state("");
  let password = $state("");
  let name = $state("");
  let working = $state(false);

  async function take(body: Record<string, string> = {}) {
    working = true;
    const got = await attempt(() => post<{ share: number }>(`/api/shares/invitation/${encodeURIComponent(token)}`, body), "It is yours.");
    working = false;
    if (!got) return;
    // A new account changes who is signed in; the shell reads that from the state.
    await refreshState();
    emit("shares:changed");
    // Straight to the song: what was pressed was this song, and a list with one row in it
    // is a screen that asks you to press it again.
    go(href.share(got.share));
  }

  function submit(e: SubmitEvent) {
    e.preventDefault();
    if (!handle.trim()) { toast("Pick a handle so the song has an owner.", "bad"); return; }
    take({ handle: handle.trim(), password, name: name.trim() });
  }
</script>

<div class="page narrow">
  {#if res.loading && !res.data}
    <div class="col" aria-hidden="true">
      <span class="sk" style="height:14px;width:30%"></span>
      <span class="sk" style="height:34px;width:70%"></span>
      <span class="sk" style="height:60px;width:100%"></span>
    </div>
  {:else if res.error && !res.data}
    <!-- One message for every way a link can be closed, because the server gives one
         answer for all of them on purpose: used, taken back, expired, never real. -->
    <div class="empty">
      <Icon name="lock" size={30} />
      <h3>This link isn't open</h3>
      <p>It's been used already or revoked. Ask whoever sent it for a new one.</p>
      <a class="btn" href={href.library()}>Go to the library</a>
    </div>
  {:else if invite}
    <div class="col" style="gap:var(--s4)">
      <span class="eyebrow">A song for you</span>
      <h1>{invite.from} shared a song with you</h1>
      <p class="song">{invite.song.title}</p>
      <p class="muted">You can listen, read the words and work on it with them. Your changes go into their song itself and its edit history. Nothing else of theirs is open to you.</p>
      {#if invite.as_name}
        <p class="muted">On this song you are <b>{invite.as_name}</b>, so anything you save is named after you.</p>
      {/if}

      {#if invite.signed_in}
        <div><button class="btn primary lg" disabled={working} onclick={() => take()}>{working ? "Taking it…" : "Take it"}</button></div>
      {:else}
        <form class="card form" onsubmit={submit}>
          <label class="label">Pick a handle
            <input class="field" bind:value={handle} autocomplete="username" autocapitalize="none" spellcheck="false" required />
          </label>
          <label class="label">And a password
            <input class="field" type="password" bind:value={password} autocomplete="new-password" required />
          </label>
          <label class="label">What people should call you
            <input class="field" bind:value={name} autocomplete="name" placeholder="optional" />
          </label>
          <button class="btn primary lg" type="submit" disabled={working}>{working ? "Making it…" : "Make an account and take it"}</button>
          <p class="faint small">Already have one here? <a class="link" href={`/login#/join/${encodeURIComponent(token)}`}>Sign in</a> and this page will finish by itself.</p>
          <p class="faint small">Accounts are for people 16 and over.</p>
        </form>
      {/if}
    </div>
  {/if}
</div>

<style>
  .narrow { max-width: 560px; }
  .song { font: 700 var(--t-2xl)/1.2 var(--display); }
  .form { padding: var(--s5); display: flex; flex-direction: column; gap: var(--s4); }
  .small { font-size: var(--t-sm); }
  .link { color: var(--accent-text); }
  .link:hover { text-decoration: underline; }
</style>
