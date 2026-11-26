<!-- How to run JR!TER on a machine of your own: the guest's way out of being a guest.

     Five short steps, each one action: pick a machine, run one line, choose a password,
     bring this library over, reach it from your phone. The install lines are install.ps1
     (Windows) and install.sh (Mac and Linux) at the root of the repository. -->
<script lang="ts">
  import Icon from "$ui/Icon.svelte";
  import Segmented from "$ui/Segmented.svelte";
  import { copyText } from "$lib/actions";
  import { href } from "$lib/router.svelte";

  // Every screen is handed its route's params; this one has none to use.
  let _: { params?: Record<string, string> } = $props();

  const RAW = "https://raw.githubusercontent.com/Lonezsi/JR-TER/main";
  const REPO = "https://github.com/Lonezsi/JR-TER";
  const LINES = {
    windows: { where: "PowerShell", line: `irm ${RAW}/install.ps1 | iex` },
    unix: { where: "Terminal", line: `curl -fsSL ${RAW}/install.sh | bash` },
  };
  const guess = (): "windows" | "unix" => (/Win/i.test(navigator.platform || navigator.userAgent) ? "windows" : "unix");
  let os = $state<"windows" | "unix">(guess());
  const now = $derived(LINES[os]);

  // A copy of this library, audio and all: in guest mode the browser itself answers this.
  const takeCopy = () => window.open("/api/export?audio=1", "_blank", "noopener");
</script>

<div class="page own">
  <a class="btn ghost sm uplink" href={href.library()} data-up><Icon name="chev-left" size={16} /> Library</a>
  <div class="page-head"><h1>Run your own</h1></div>
  <p class="lede">Right now this library lives in this browser. Put JR!TER on a computer that stays on and it's yours everywhere: your phone, your laptop, and friends you invite.</p>

  <ol class="steps">
    <li class="card">
      <span class="n num">1</span>
      <div class="body">
        <h3>Pick the machine</h3>
        <p>Any computer that stays on: an old laptop, a desktop, a Raspberry Pi, a small server. Windows, Mac or Linux.</p>
      </div>
    </li>

    <li class="card">
      <span class="n num">2</span>
      <div class="body">
        <h3>Install it, one line</h3>
        <Segmented size="sm" label="Which system" value={os} onchange={(v) => (os = v as typeof os)}
                   options={[{ value: "windows", label: "Windows" }, { value: "unix", label: "Mac and Linux" }]} />
        <p class="faint small">Paste this into {now.where} on that machine:</p>
        <div class="code">
          <code>{now.line}</code>
          <button class="icon-btn sm" title="Copy" aria-label="Copy the install line" onclick={() => copyText(now.line, "Copied")}><Icon name="copy" size={16} /></button>
        </div>
        <p class="faint small">No admin needed. Run the same line later to update; your music is never touched.</p>
      </div>
    </li>

    <li class="card">
      <span class="n num">3</span>
      <div class="body">
        <h3>Make it yours</h3>
        <p>The installer starts JR!TER and shows a one-time setup code. Open <code class="inline">http://127.0.0.1:7900</code> on that machine, type the code, choose a password. That makes you the owner.</p>
        <p class="faint small">It's a JR!TER of its own, with its own people: invite friends from Settings, People, and each of them gets a library of their own. Nobody else's server is involved.</p>
      </div>
    </li>

    <li class="card">
      <span class="n num">4</span>
      <div class="body">
        <h3>Bring this library over</h3>
        <p>Take a copy here, then on your new JR!TER: Settings, Library, Bring a library in.</p>
        <div><button class="btn sm" onclick={takeCopy}><Icon name="download" size={14} /> Take a copy of this library</button></div>
      </div>
    </li>

    <li class="card">
      <span class="n num">5</span>
      <div class="body">
        <h3>Reach it from your other devices</h3>
        <p>At home, nothing else is needed: say yes when the installer asks about your home network, and open it from your phone at the address it prints.</p>
        <p class="faint small">From anywhere, if you want it: <a class="link" href="https://tailscale.com/download" target="_blank" rel="noopener">Tailscale</a> (free) is the easy way, and the installer offers to set it up. Any other way you already use to reach a computer works too.</p>
      </div>
    </li>
  </ol>

  <p class="faint small">Rather do it by hand? Get the code from <a class="link" href={REPO} target="_blank" rel="noopener">GitHub</a> and run <code class="inline">python server.py --open</code> in it. Everything is in the README.</p>
</div>

<style>
  .own { max-width: 760px; }
  .own > :global(*) { max-width: none; }
  .uplink { align-self: flex-start; margin: calc(var(--s2) * -1) 0 calc(var(--s1) * -1) calc(var(--s2) * -1); color: var(--text-2); }
  .lede { color: var(--text-2); margin: 0; max-width: 60ch; }
  .steps { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--s3); }
  .steps li { display: flex; gap: var(--s4); padding: var(--s5); }
  .n {
    flex: none; width: 28px; height: 28px; border-radius: 50%; display: grid; place-items: center;
    font: 600 var(--t-sm)/1 var(--font); background: var(--hover); color: var(--text-2);
  }
  .body { display: flex; flex-direction: column; gap: var(--s2); min-width: 0; flex: 1; }
  h3 { margin: 0; font-size: var(--t-md); }
  p { margin: 0; }
  .small { font-size: var(--t-sm); }
  .code {
    display: flex; align-items: center; gap: var(--s2); padding: var(--s2) var(--s2) var(--s2) var(--s3);
    border-radius: var(--r-sm); background: var(--hover); border: 1px solid var(--line);
  }
  .code code { flex: 1; min-width: 0; font: 500 var(--t-sm)/1.4 var(--mono); overflow-x: auto; white-space: nowrap; scrollbar-width: none; }
  .inline { font: 500 0.92em var(--mono); padding: 1px 5px; border-radius: 5px; background: var(--hover); }
  @media (max-width: 640px) { .steps li { padding: var(--s4); gap: var(--s3); } }
</style>
