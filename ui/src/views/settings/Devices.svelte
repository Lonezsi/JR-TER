<!-- Machines that may reach this library without a person at the keyboard: the desktop
     agent that watches a folder. A token belongs to one account, is shown once, and only
     a digest of it is kept. -->
<script lang="ts">
  import { get, post, del, attempt } from "$lib/api";
  import { resource } from "$lib/resource.svelte";
  import { sheet, confirm } from "$lib/dialog.svelte";
  import { copyText } from "$lib/actions";
  import { when } from "$lib/util";
  import Icon from "$ui/Icon.svelte";
  import Block from "./Block.svelte";
  import Rows from "./Rows.svelte";
  import Trouble from "./Trouble.svelte";
  import CodeBody from "./CodeBody.svelte";
  import type { MachineToken } from "./shapes";

  const tokens = resource(() => get<{ tokens: MachineToken[] }>("/api/auth/tokens"));

  const origin = location.origin;
  const steps = $derived(`python jriter_client.py server ${origin}\npython jriter_client.py login --name "this machine"`);

  export async function create() {
    const said = await sheet<{ name: string; scope: string }>({
      title: "Add a device",
      sub: "A key for one machine. It is tied to your account and can be revoked here at any time.",
      confirm: "Make a token",
      fields: [
        { name: "name", label: "What to call it", placeholder: "Studio laptop", maxlength: 80, required: true },
        { name: "scope", label: "What it may do", type: "select", value: "upload", options: [
          { value: "upload", label: "Upload renders and read the library" },
          { value: "full", label: "Everything (no restriction)" } ] },
      ],
    });
    if (!said) return;
    const made = await attempt(() => post<{ token: string }>("/api/auth/tokens", said));
    if (!made) return;
    tokens.reload();
    await sheet({
      title: "Copy this token now",
      sub: "It is the only time it is shown. Only a digest of it is kept, the same as a password.",
      confirm: "", cancel: "Done",
      body: CodeBody,
      props: { code: made.token, copyHint: "Token copied.",
               hint: "Put it in the agent's config file as its token. Using the login command below does this for you." },
    });
  }

  async function revoke(t: MachineToken) {
    const sure = await confirm(`Revoke ${t.name || "this device"}?`,
      "The machine stops working at once and has to be given a new token. This cannot be undone.",
      "Revoke", "Keep it");
    if (!sure) return;
    const before = tokens.data;
    if (before) tokens.set({ tokens: before.tokens.filter((x) => x.id !== t.id) });
    const done = await attempt(() => del(`/api/auth/tokens/${t.id}`), "Revoked.");
    if (!done) tokens.set(before);
  }
</script>

<div class="sections">
  <Block title="Devices"
         note="The desktop agent watches a folder on a computer and sends what lands there. It signs in with a token of its own, so your password is never kept on it.">
    {#snippet actions()}
      <button class="btn sm primary" onclick={create}><Icon name="plus" size={14} /> Add a device</button>
    {/snippet}
    {#if tokens.loading && !tokens.data}
      <Rows n={2} />
    {:else if tokens.error && !tokens.data}
      <Trouble message={tokens.error} retry={tokens.reload} />
    {:else if !tokens.data?.tokens.length}
      <div class="setting"><div class="what"><div class="s">No devices yet.</div></div></div>
    {:else}
      {#each tokens.data.tokens as t (t.id)}
        <div class="setting">
          <div class="what">
            <div class="t truncate">{t.name || "a machine"}</div>
            <div class="s">{t.scope === "full" ? "everything" : "upload only"} · made {when(t.created_at)} ·
              {t.last_used ? `last used ${when(t.last_used)}` : "never used"}</div>
          </div>
          <div class="ctl">
            <button class="btn sm danger" onclick={() => revoke(t)}>Revoke</button>
          </div>
        </div>
      {/each}
    {/if}
  </Block>

  <Block title="Connecting the agent" bare
         note="On the machine that runs the agent, point it at this library, then sign in once. The password is used for that one call and not written down.">
    <pre class="card mono steps">{steps}</pre>
    <div class="row">
      <button class="btn sm" onclick={() => copyText(steps, "Commands copied.")}><Icon name="copy" size={14} /> Copy</button>
      <span class="hint">Add <span class="mono">--handle</span> if the library is not the owner's.</span>
    </div>
  </Block>
</div>

<style>
  .sections { display: flex; flex-direction: column; gap: var(--s6); }
  .steps { margin: 0; padding: var(--s3) var(--s4); font-size: var(--t-sm); overflow-x: auto; white-space: pre; }
</style>
