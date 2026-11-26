<!-- A link shown once, because only its digest is kept. A sheet and not a toast: a toast takes
     itself away while you are still looking for the button. -->
<script lang="ts">
  import { copyText } from "$lib/actions";
  let { url, close }: { url: string; close: (value?: unknown) => void } = $props();
</script>

<div class="col">
  <input class="field" readonly value={url} onfocus={(e) => e.currentTarget.select()} />
  <div class="row">
    <button class="btn" onclick={() => copyText(url, "Copied.")}>Copy the link</button>
    <span class="grow"></span>
    <button class="btn primary" onclick={() => close(true)}>Done</button>
  </div>
  <p class="hint">You'll only see this once. Lose it and you can revoke the share and make a new one.</p>
</div>
