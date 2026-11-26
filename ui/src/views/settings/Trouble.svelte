<!-- Something did not load. Said where the thing would have been, with the way to ask
     again beside it. -->
<script lang="ts">
  import Icon from "$ui/Icon.svelte";
  let { message, retry }: { message: string; retry?: () => unknown } = $props();
</script>

<div class="notice bad" role="alert">
  <Icon name="warning" size={16} />
  <span class="grow">{message}</span>
  {#if retry}<button class="btn sm" onclick={() => retry?.()}>Try again</button>{/if}
</div>

<style>
  .notice { align-items: center; }
</style>
