<!-- The player. One capsule of glass along the bottom, always there once something has
     been played. Left is what it is, middle is the transport, right is the standing
     choices: repeat, what happens at the end, the queue, the volume. A/B is chosen on the
     song's Sound tab; once B holds something, the line under the title says which one
     you're hearing, since X swaps them from anywhere.

     On a phone it is a single row (what, play, next) with the progress drawn along its
     top edge; pressing it opens Now Playing, which has everything. -->
<script lang="ts">
  import Icon from "$ui/Icon.svelte";
  import Cover from "$ui/Cover.svelte";
  import Scrubber from "$ui/Scrubber.svelte";
  import Slider from "$ui/Slider.svelte";
  import { contextMenu, showMenu, type MenuItem } from "$lib/menu.svelte";
  import { href, go } from "$lib/router.svelte";
  import { time } from "$lib/util";
  import { u } from "$lib/api";
  import { toast } from "$lib/toast.svelte";
  import {
    player, coverOf, toggle, step, previous, seek, switchTo, setVolume, toggleMute,
    cycleRepeat, setAutoplay, canCompare, arranged, stopAndClear, REPEAT_SAYS,
  } from "$lib/player.svelte";
  import { shell } from "./state.svelte";
  import { pane } from "$lib/glass/glass.svelte";

  const song = $derived(player.song);
  const slot = $derived(player.slots[player.active]);
  const version = $derived(slot.version);
  const loose = $derived(song?.kind === "render");
  // A loose render has no song page: it goes to the list it actually lives in.
  const goes = $derived(loose ? href.inbox() : song ? href.song(song.id) : "#/");
  const sub = $derived(!version ? "no render"
    : version.kind === "render" ? "a render, not yet on a song"
    : `${player.slots.B.version ? player.active + " · " : ""}v${version.n}${slot.preset ? " · " + slot.preset.name : ""}`);

  const menu = () => {
    if (!song) return null;
    return [
      { group: song.title },
      loose ? null : { label: "Open the song", icon: "songs", run: () => go(href.song(song.id)) },
      { label: player.playing ? "Pause" : "Play", icon: player.playing ? "pause" : "play", hint: "Space", run: toggle },
      { label: "Back to the start", icon: "prev", run: () => seek(0) },
      { divider: true as const },
      { label: "Show the queue", icon: "queue", hint: "Q", run: () => (shell.nowPlaying = true) },
      version ? {
        label: version.kind === "render" ? "Download this render" : `Download v${version.n}`, icon: "download",
        run: () => { window.open(version.kind === "render" ? `/api/renders/${version.id}/audio` : u(`/api/versions/${version.id}/download`), "_blank"); },
      } : null,
      { divider: true as const },
      { label: "Stop and clear the player", icon: "close", run: stopAndClear },
    ];
  };

  function repeat() { toast(REPEAT_SAYS[cycleRepeat()] + "."); }

  /* What the right side had to give up for room, still reachable: whichever of these the
     bar's width has hidden (the container queries below hide them in this order) shows in
     this menu. All of them are listed; the ones still on the bar are simply there too. */
  const overflow = (): MenuItem[] => [
    { group: "Player" },
    { label: REPEAT_SAYS[player.repeat], icon: player.repeat === "one" ? "repeat1" : "repeat", checked: player.repeat !== "off", run: repeat },
    { label: player.autoplay ? "Keeps playing when the queue runs out" : "Stops when the queue runs out", icon: "autoplay", checked: player.autoplay, run: autoplay },
    { label: player.volume > 0 ? "Mute" : "Unmute", icon: player.volume > 0 ? "volume" : "mute", hint: "M", run: toggleMute },
    { label: "Queue and now playing", icon: "queue", hint: "Q", run: () => (shell.nowPlaying = true) },
  ];
  function autoplay() {
    setAutoplay(!player.autoplay);
    toast(player.autoplay ? "Keeps playing when the queue runs out." : "Stops when the queue runs out.");
  }
</script>

{#if song}
  <div class="player glass" class:narrow={shell.narrow} role="region" aria-label="Player" use:pane>
    {#if shell.narrow}
      <div class="edge"><Scrubber thin position={player.position} duration={player.duration} onseek={() => {}} /></div>
    {/if}

    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
    <div class="what" use:contextMenu={menu}
         onclick={(e) => { if (shell.narrow && !(e.target as HTMLElement).closest("a")) shell.nowPlaying = true; }}>
      <a class="art" href={goes} title={loose ? "Show this in the inbox" : "Open the song"} tabindex={shell.narrow ? -1 : 0}>
        <Cover url={coverOf(song)} title={song.title} size={shell.narrow ? 42 : 48} />
      </a>
      <div class="truncate words">
        <a class="t truncate" href={goes}>{song.title}</a>
        <div class="s truncate">{sub}</div>
      </div>
    </div>

    {#if !shell.narrow}
      <div class="transport">
        <div class="buttons">
          <button class="icon-btn" onclick={previous} title="Previous" aria-label="Previous"><Icon name="prev" size={19} /></button>
          <button class="play-btn sm" class:loading={player.loading && player.playing} onclick={toggle}
                  aria-label={player.playing ? "Pause" : "Play"} title="{player.playing ? 'Pause' : 'Play'} (Space)">
            <Icon name={player.playing ? "pause" : "play"} size={18} />
          </button>
          <button class="icon-btn" onclick={() => step(1)} title="Next" aria-label="Next"><Icon name="next" size={19} /></button>
        </div>
        {#if player.preparing !== null}
          <div class="preparing" title="Loading the render to play it as arranged">
            <span>Preparing the arrangement</span>
            <span class="pbar"><span style:width="{Math.round(player.preparing * 100)}%"></span></span>
            <span class="num">{Math.round(player.preparing * 100)}%</span>
          </div>
        {:else}
          <div class="scrub">
            <span class="time num">{time(player.position)}</span>
            <Scrubber position={player.position} duration={player.duration} buffered={player.buffered}
                      onseek={seek} onhold={(held) => (player.seeking = held)} />
            <span class="time num end">{time(player.duration)}</span>
          </div>
        {/if}
      </div>

      <div class="right">
        <button class="icon-btn sm repeat" class:on={player.repeat !== "off"} onclick={repeat}
                title={REPEAT_SAYS[player.repeat]} aria-label={REPEAT_SAYS[player.repeat]} aria-pressed={player.repeat !== "off"}>
          <Icon name={player.repeat === "one" ? "repeat1" : "repeat"} size={17} />
        </button>
        <button class="icon-btn sm autoplay" class:on={player.autoplay} onclick={autoplay} aria-pressed={player.autoplay}
                aria-label="Keep playing" title={player.autoplay ? "Keeps playing when the queue runs out" : "Stops when the queue runs out"}>
          <Icon name="autoplay" size={17} />
        </button>
        <button class="icon-btn sm queue" class:on={shell.nowPlaying} onclick={() => (shell.nowPlaying = !shell.nowPlaying)}
                title="Queue and now playing (Q)" aria-label="Queue" aria-pressed={shell.nowPlaying}>
          <Icon name="queue" size={17} />
        </button>
        <div class="volume">
          <button class="icon-btn sm" onclick={toggleMute} aria-label={player.volume > 0 ? "Mute" : "Unmute"} title="Mute (M)">
            <Icon name={player.volume === 0 ? "mute" : player.volume < 0.5 ? "volume-low" : "volume"} size={17} />
          </button>
          <Slider value={player.volume} min={0} max={1} step={0.01} label="Volume" reset={0.9} oninput={setVolume} />
        </div>
        <button class="icon-btn sm more" onclick={(e) => showMenu(overflow(), { anchor: e.currentTarget })}
                aria-label="More player controls" aria-haspopup="menu" title="More"><Icon name="more" size={17} /></button>
      </div>
    {:else}
      <!-- The phone's bar keeps what a thumb reaches for (play, next) and says it opens: the chevron, or a tap anywhere on the words, brings up
           the full player with everything else. -->
      <div class="mini">
        <button class="play-btn sm" onclick={toggle} aria-label={player.playing ? "Pause" : "Play"}>
          <Icon name={player.playing ? "pause" : "play"} size={18} />
        </button>
        <button class="icon-btn" onclick={() => step(1)} aria-label="Next"><Icon name="next" size={20} /></button>
        <button class="icon-btn sm open" onclick={() => (shell.nowPlaying = true)} aria-label="Open the player"><Icon name="chev-up" size={18} /></button>
      </div>
    {/if}
  </div>
{/if}

<style>
  /* Three columns, the way Spotify lays its bar out: the sides equal, so the transport is
     always in the middle of the bar, and the transport at most twice a side. The right side
     never pushes: what it holds folds away by its own width (the container queries on
     .right below), least needed first, into the ⋯ menu, so nothing is ever unreachable. */
  .player {
    position: relative; height: var(--bar-h);
    display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 2fr) minmax(0, 1fr);
    align-items: center; gap: var(--s4); padding: 0 var(--s4) 0 var(--s3);
    border-radius: calc(var(--bar-h) / 2);
    animation: rise 420ms var(--spring) both;
  }
  .what { display: flex; align-items: center; gap: var(--s3); min-width: 0; }
  .art { flex: none; border-radius: 50%; transition: transform var(--fast); }
  .art:hover { transform: scale(1.05); }
  .words { display: flex; flex-direction: column; }
  .t { font-weight: 600; }
  .t:hover { text-decoration: underline; text-underline-offset: 3px; }
  .s { font-size: var(--t-sm); color: var(--text-2); }

  .transport { display: flex; flex-direction: column; align-items: center; gap: 0; min-width: 0; }
  .buttons { display: flex; align-items: center; gap: var(--s2); }
  .scrub { display: flex; align-items: center; gap: var(--s3); width: 100%; height: 22px; }
  .time { font-size: var(--t-xs); color: var(--text-3); width: 40px; flex: none; }

  .play-btn.loading { animation: shimmer 1.1s ease-in-out infinite; }
  .preparing { display: flex; align-items: center; gap: var(--s3); width: 100%; height: 22px; font-size: var(--t-xs); color: var(--text-2); }
  .pbar { flex: 1 1 auto; height: 4px; border-radius: 999px; background: var(--line-2); overflow: hidden; }
  .pbar span { display: block; height: 100%; background: var(--accent); transition: width 120ms linear; }

  .right { display: flex; align-items: center; justify-content: flex-end; gap: var(--s1); min-width: 0; container: right / inline-size; }
  .right > * { flex: none; }
  .more { display: none; }
  .volume { display: flex; align-items: center; gap: 2px; width: 124px; flex: none; }

  .transport { width: 100%; max-width: 560px; justify-self: center; }
  .time.end { text-align: right; }
  /* The order things leave the right side in: the volume slider (its icon stays), the
     "sound" tag, keep-playing, repeat, the mute icon; the ⋯ menu arrives with the first
     button to go, and holds all of them. A/B and the queue stay to the last. */
  @container right (max-width: 250px) { .volume { width: 34px; } .volume :global(.range) { display: none; } }
  @container right (max-width: 220px) { .autoplay { display: none; } .more { display: grid; } }
  @container right (max-width: 180px) { .repeat { display: none; } }
  @container right (max-width: 150px) { .volume { display: none; } }

  .player.narrow {
    grid-template-columns: 1fr auto; gap: var(--s2); padding: 0 var(--s2) 0 var(--s2);
    border-radius: var(--r-lg); overflow: hidden;
  }
  .edge { position: absolute; left: 0; right: 0; top: 0; height: 3px; }
  .mini { display: flex; align-items: center; gap: var(--s1); }
  .open { color: var(--text-2); }
  .narrow .what { cursor: pointer; height: 100%; }
</style>
