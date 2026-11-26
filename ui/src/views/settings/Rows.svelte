<!-- Skeleton rows in the shape of the settings rows that will replace them. -->
<script lang="ts">
  let { n = 2, face = false }: { n?: number; face?: boolean } = $props();
</script>

{#each Array(n) as _, i (i)}
  <div class="setting" aria-hidden="true">
    {#if face}<span class="sk face"></span>{/if}
    <div class="what">
      <div class="sk" style:width="{38 + (i % 3) * 12}%" style:height="14px"></div>
      <div class="sk" style:width="{58 - (i % 2) * 14}%" style:height="11px" style:margin-top="7px"></div>
    </div>
  </div>
{/each}

<style>
  .face { width: 36px; height: 36px; border-radius: 50%; flex: none; }
</style>
