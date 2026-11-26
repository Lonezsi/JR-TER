<!-- Everybody with an account here, and the invites that make new ones. Owner only: the
     invite list is refused to anybody else, and the screen does not draw this section
     for them. -->
<script lang="ts">
  import { get, post, del, attempt } from "$lib/api";
  import { resource } from "$lib/resource.svelte";
  import { sheet } from "$lib/dialog.svelte";
  import { when, plural } from "$lib/util";
  import { letter } from "$lib/util";
  import Icon from "$ui/Icon.svelte";
  import Block from "./Block.svelte";
  import Rows from "./Rows.svelte";
  import Trouble from "./Trouble.svelte";
  import CodeBody from "./CodeBody.svelte";
  import type { Invite, Person } from "./shapes";

  const data = resource(() => get<{ invites: Invite[]; accounts: Person[] }>("/api/auth/invites"));

  export async function invite() {
    const said = await sheet<{ note: string; days: string }>({
      title: "Invite somebody",
      sub: "They get an account and a library of their own. They cannot see yours.",
      confirm: "Make a code",
      fields: [
        { name: "note", label: "Who is it for", placeholder: "Jozsef", maxlength: 80 },
        { name: "days", label: "Good for", type: "select", value: "14", options: [
          { value: "7", label: "a week" }, { value: "14", label: "two weeks" },
          { value: "90", label: "three months" }, { value: "0", label: "until it is used" } ] },
      ],
    });
    if (!said) return;
    const made = await attempt(() => post<{ code: string }>("/api/auth/invites",
      { note: said.note, days: Number(said.days) }));
    if (!made) return;
    data.reload();
    /* Shown once, in a dialog you have to close, because that is the only time it exists:
     * only a digest of it is kept, the same as a password. */
    await sheet({
      title: "Send them this",
      sub: "It works once and is not shown again. Only a digest of it is kept.",
      confirm: "", cancel: "Done",
      body: CodeBody,
      props: { code: made.code, hint: "They open this library, choose \"I have an invite\", and type it in.",
               copyHint: "Invite code copied." },
    });
  }

  async function revoke(i: Invite) {
    const before = data.data;
    if (before) data.set({ ...before, invites: before.invites.filter((x) => x.id !== i.id) });   // optimistic
    const done = await attempt(() => del(`/api/auth/invites/${i.id}`), "That invite will not work now.");
    if (!done) data.set(before);
  }

  const state = (i: Invite) => i.used ? `used by ${i.used_by_handle || "somebody"}` : i.expired ? "expired" : "waiting";
</script>

<div class="sections">
  <Block title="People"
         note="Everyone gets their own library and sees only theirs; a song crosses over only when you share it. Signing up needs an invite.">
    {#snippet actions()}
      <span class="faint">{plural(data.data?.accounts.length ?? 0, "account")}</span>
      <button class="btn sm primary" onclick={invite}><Icon name="plus" size={14} /> Invite somebody</button>
    {/snippet}
    {#if data.loading && !data.data}
      <Rows n={3} face />
    {:else if data.error && !data.data}
      <Trouble message={data.error} retry={data.reload} />
    {:else}
      {#each data.data?.accounts ?? [] as p (p.id)}
        <div class="setting">
          <span class="face" aria-hidden="true">{letter(p.name)}</span>
          <div class="what">
            <div class="t truncate">{p.name}</div>
            <div class="s truncate">{p.handle}{p.is_owner ? " · owner" : ""}{p.created_at ? ` · since ${when(p.created_at)}` : ""}</div>
          </div>
        </div>
      {/each}
    {/if}
  </Block>

  <Block title="Invites">
    {#if data.loading && !data.data}
      <Rows n={1} />
    {:else if !data.data?.invites.length}
      <div class="setting"><div class="what"><div class="s">No invites. Make one and it is listed here until it is used.</div></div></div>
    {:else}
      {#each data.data.invites as i (i.id)}
        <div class="setting">
          <div class="what">
            <div class="t truncate">{i.note || "no note"}</div>
            <div class="s">{state(i)} · made {when(i.created_at)}</div>
          </div>
          <div class="ctl">
            <span class="tag" class:accent={!i.used && !i.expired}>{state(i).split(" ")[0]}</span>
            {#if !i.used}
              <button class="icon-btn sm" title="Cancel this invite" aria-label="Cancel this invite" onclick={() => revoke(i)}>
                <Icon name="close" size={15} />
              </button>
            {/if}
          </div>
        </div>
      {/each}
    {/if}
  </Block>
</div>

<style>
  .sections { display: flex; flex-direction: column; gap: var(--s6); }
  .face {
    flex: none; width: 36px; height: 36px; border-radius: 50%; display: grid; place-items: center;
    font: 800 15px/1 var(--display); background: var(--accent-soft); color: var(--accent-text); border: 1px solid var(--accent-line);
  }
</style>
