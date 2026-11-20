<!-- Which copy this is, and the doors out of it. -->
<script lang="ts">
  import { app, FOYER } from "$lib/app.svelte";
  import { shell } from "../../shell/state.svelte";
  import Icon from "$ui/Icon.svelte";
  import Block from "./Block.svelte";
</script>

<Block title="About">
  <div class="setting">
    <div class="what">
      <div class="t">{app.name}</div>
      <div class="s num">version {app.version || "unknown"}</div>
    </div>
  </div>
  <div class="setting">
    <div class="what"><div class="t">Foyer</div><div class="s">The front door of this server, and everything else running on it.</div></div>
    <div class="ctl"><a class="btn sm" href={FOYER}><Icon name="door" size={14} /> Open</a></div>
  </div>
  <div class="setting">
    <div class="what"><div class="t">Terms and privacy</div><div class="s">What this library keeps, and what leaves it.</div></div>
    <div class="ctl"><a class="btn sm" href="/legal" target="_blank" rel="noopener"><Icon name="external" size={14} /> Open</a></div>
  </div>
  <div class="setting">
    <div class="what"><div class="t">Privacy for this machine</div><div class="s">One page for every site on this host.</div></div>
    <div class="ctl"><a class="btn sm" href="{FOYER}/privacy" target="_blank" rel="noopener"><Icon name="external" size={14} /> Open</a></div>
  </div>
  <div class="setting">
    <div class="what"><div class="t">Keyboard shortcuts</div><div class="s">Everything the keys do, in one list. Press ? anywhere.</div></div>
    <div class="ctl"><button class="btn sm" onclick={() => (shell.keys = true)}><Icon name="command" size={14} /> Show</button></div>
  </div>
</Block>
