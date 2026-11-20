<!-- Where the song goes: YouTube (the record, and the upload that used to be its own full
     screen) and sharing (who has it, and what they made). Never shown to a guest. -->
<script lang="ts">
  import { useSong } from "./song.svelte";
  import type { GuestWork } from "./guestwork.svelte";
  import YouTubePanel from "./YouTubePanel.svelte";
  import YouTubeUpload from "./YouTubeUpload.svelte";
  import SharingPanel from "./SharingPanel.svelte";
  import GuestWorkView from "./GuestPeople.svelte";

  let { gw }: { gw: GuestWork | null } = $props();
  const song = useSong();
</script>

<div class="col release">
  {#if song.has("sharing")}
    <SharingPanel />
    {#if gw}<GuestWorkView {gw} />{/if}
  {/if}
  {#if song.has("youtube")}
    <YouTubePanel />
    <YouTubeUpload />
  {/if}
</div>

<style>
  .release { gap: var(--s6); }
</style>
