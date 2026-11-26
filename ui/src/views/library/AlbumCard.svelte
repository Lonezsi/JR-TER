<!-- An album on a shelf: the cover doing the work, a play-through button that appears on
     hover (always on touch), a context menu. -->
<script lang="ts">
  import Cover from "$ui/Cover.svelte";
  import AlbumArt from "$ui/AlbumArt.svelte";
  import Icon from "$ui/Icon.svelte";
  import { contextMenu } from "$lib/menu.svelte";
  import { href } from "$lib/router.svelte";
  import { plural } from "$lib/util";
  import { albumCover, type AlbumRow } from "./kinds";
  import { albumMenu, playAlbum } from "./shelf";
  import { navRow } from "./rows";

  let { album }: { album: AlbumRow } = $props();
</script>

<div class="card-album" use:contextMenu={() => albumMenu(album)}>
  <div class="frame">
    <a class="art" href={href.album(album.id)} use:navRow aria-label={`Open ${album.title}`}>
      <AlbumArt {album} url={albumCover(album)} title={album.title} size="100%" />
    </a>
    <button class="play-btn sm accent go" aria-label={`Play ${album.title} through`} title="Play it through"
            disabled={!album.song_count} onclick={() => playAlbum(album)}>
      <Icon name="play" size={16} />
    </button>
  </div>
  <a class="meta" href={href.album(album.id)} tabindex="-1">
    <span class="t truncate">{album.title}</span>
    <span class="s truncate">{album.year ? album.year + " · " : ""}{plural(album.song_count || 0, "song")}</span>
  </a>
</div>

<style>
  .card-album { display: flex; flex-direction: column; gap: var(--s2); min-width: 0; }
  .frame { position: relative; aspect-ratio: 1; margin-right: 16%; }
  .art { display: block; width: 100%; height: 100%; border-radius: var(--r-lg); transition: transform var(--med), box-shadow var(--med); }
  .art :global(.albumart) { width: 100% !important; height: 100% !important; margin-right: 0 !important; }

  .go { position: absolute; z-index: 4; right: 10px; bottom: 10px; opacity: 0; transform: translateY(6px); transition: opacity var(--fast), transform var(--med); }
  .frame:hover .go, .frame:focus-within .go { opacity: 1; transform: none; }
  @media (pointer: coarse) { .go { opacity: 1; transform: none; } }
  .meta { display: flex; flex-direction: column; min-width: 0; padding: 0 2px; }
  .t { font-weight: 600; }
  .s { font-size: var(--t-sm); color: var(--text-2); }
</style>
