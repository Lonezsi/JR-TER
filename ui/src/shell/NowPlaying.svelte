<!-- Now Playing: the queue, and what is in each of A and B. A panel over the player on a
     wide screen, the whole screen on a phone, where it also carries the full transport
     because the bar there has room for two buttons. -->
<script lang="ts">
  import Icon from "$ui/Icon.svelte";
  import { slideBack } from "$lib/slideback";
  import { closesOnBack } from "$lib/back.svelte";
  import Cover from "$ui/Cover.svelte";
  import Scrubber from "$ui/Scrubber.svelte";
  import Slider from "$ui/Slider.svelte";
  import { showMenu } from "$lib/menu.svelte";
  import { href } from "$lib/router.svelte";
  import { time, plural } from "$lib/util";
  import { u } from "$lib/api";
  import { toast } from "$lib/toast.svelte";
  import { SLOTS, type Slot } from "$lib/audio/engine";
  import {
    player, coverOf, toggle, step, previous, seek, switchTo, setVolume, cycleRepeat, setAutoplay,
    canCompare, arranged, jumpTo, removeFromQueue, setSlot, REPEAT_SAYS,
  } from "$lib/player.svelte";
  import { shell } from "./state.svelte";
  import { growFrom } from "$lib/grow";
  import { fly, fade } from "svelte/transition";
  import { cubicOut } from "svelte/easing";

  const song = $derived(player.song);
  const loose = $derived(song?.kind === "render");
  const close = () => (shell.nowPlaying = false);
  closesOnBack(() => shell.nowPlaying, close);

  const coverFor = (item: any) => item.kind === "render" ? (item.art || null)
    : item.art || (item.artwork_id ? u(`/api/artwork/${item.artwork_id}/image`) : null);
  const titleFor = (item: any) => item.title || item.name || item.filename || "untitled";

  function pickPreset(slot: Slot, e: MouseEvent) {
    const now = player.slots[slot].preset;
    showMenu(player.presets.map((p) => ({
      label: p.name, checked: now?.id === p.id, run: () => { setSlot(slot, { preset: p }); },
    })), { anchor: e.currentTarget as Element });
  }

  // On a phone it grows out of the mini player it was opened from and shrinks back into it.
  const grow = (node: Element) => growFrom(node, {
    from: () => (shell.narrow ? document.querySelector(".player.glass") : null), duration: 420,
    fallback: () => fly(node, { y: shell.narrow ? 600 : 16, duration: shell.narrow ? 420 : 240, easing: cubicOut }),
  });

  const upNext = $derived(player.queue.length - player.index - 1);
  let list = $state<HTMLElement>();
  // Open on the song that is playing, not at the top of a two hundred item queue.
  $effect(() => {
    if (!list) return;
    list.querySelector(".q.on")?.scrollIntoView({ block: "center" });
  });
</script>

<svelte:window onkeydown={(e) => { if (e.key === "Escape" && shell.nowPlaying) { e.preventDefault(); close(); } }} />

{#if song}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div class="scrim" class:narrow={shell.narrow} onclick={close} transition:fade|global={{ duration: 160 }}></div>
  <div class="panel glass-2" class:narrow={shell.narrow} role="dialog" aria-label="Now playing" use:slideBack={{ close, dir: "down", enabled: shell.narrow }}
       in:grow|global out:grow|global>
    <header>
      <h3 class="grow">Now playing</h3>
      <button class="icon-btn sm" onclick={close} aria-label="Close" title="Close (Esc)">
        <Icon name={shell.narrow ? "chev-down" : "close"} size={18} />
      </button>
    </header>

    <div class="now">
      <Cover url={coverOf(song)} title={song.title} size={shell.narrow ? (upNext > 0 ? "min(64vw, 300px)" : "min(78vw, 340px)") : 72} radius={shell.narrow ? "var(--r-xl)" : "var(--r-md)"} />
      <div class="words truncate">
        {#if loose}<div class="title truncate">{song.title}</div>
        {:else}<a class="title truncate" href={href.song(song.id)} onclick={close}>{song.title}</a>{/if}
        <div class="muted truncate">
          {#if loose}a render, not yet on a song{:else if player.slots[player.active].version}v{player.slots[player.active].version?.n}{/if}
        </div>
      </div>
    </div>

    {#if shell.narrow}
      <div class="scrub">
        <Scrubber position={player.position} duration={player.duration} buffered={player.buffered}
                  onseek={seek} onhold={(held) => (player.seeking = held)} />
        <div class="times num"><span>{time(player.position)}</span><span>{time(player.duration)}</span></div>
      </div>
      <div class="big">
        <button class="icon-btn lg" class:on={player.repeat !== "off"} onclick={() => toast(REPEAT_SAYS[cycleRepeat()] + ".")} aria-label={REPEAT_SAYS[player.repeat]}>
          <Icon name={player.repeat === "one" ? "repeat1" : "repeat"} size={20} />
        </button>
        <button class="icon-btn lg" onclick={previous} aria-label="Previous"><Icon name="prev" size={26} /></button>
        <button class="play-btn lg" onclick={toggle} aria-label={player.playing ? "Pause" : "Play"}>
          <Icon name={player.playing ? "pause" : "play"} size={26} />
        </button>
        <button class="icon-btn lg" onclick={() => step(1)} aria-label="Next"><Icon name="next" size={26} /></button>
        <button class="icon-btn lg" class:on={player.autoplay} onclick={() => { setAutoplay(!player.autoplay); toast(player.autoplay ? "Keeps playing after the queue." : "Stops after the queue."); }} aria-label="Keep playing">
          <Icon name="autoplay" size={20} />
        </button>
      </div>
      <div class="vol">
        <Icon name="volume-low" size={16} />
        <Slider value={player.volume} min={0} max={1} step={0.01} label="Volume" oninput={setVolume} />
        <Icon name="volume" size={16} />
      </div>
    {/if}

    <!-- A and B live on the song's Sound tab only. -->

    <div class="qhead">
      <span class="eyebrow grow">Queue</span>
      <span class="faint num">{upNext > 0 ? plural(upNext, "more") : player.autoplay ? "keeps playing after" : "stops after this"}</span>
    </div>
    <div class="queue" bind:this={list}>
      {#each player.queue as item, i (i + ":" + item.id)}
        <div class="q" class:on={i === player.index} class:past={i < player.index}>
          <button class="hit" onclick={() => jumpTo(i)} title="Play this">
            <Cover url={coverFor(item)} title={titleFor(item)} size={34} />
            <span class="grow truncate">
              <span class="t truncate">{titleFor(item)}</span>
              <span class="s truncate">{item.duration ? time(Number(item.duration)) : ""}</span>
            </span>
            {#if i === player.index}<span class="bars" class:paused={!player.playing}><i></i><i></i><i></i></span>{/if}
          </button>
          {#if i !== player.index}
            <button class="icon-btn sm rm" title="Take out of the queue" aria-label="Take out of the queue" onclick={() => removeFromQueue(i)}>
              <Icon name="close" size={14} />
            </button>
          {/if}
        </div>
      {:else}
        <p class="tip">Nothing queued.</p>
      {/each}
    </div>
  </div>
{/if}

<style>
  .scrim { position: fixed; inset: 0; z-index: 290; }
  .scrim.narrow { background: rgba(0, 0, 0, 0.5); }
  .panel {
    position: fixed; z-index: 300; right: var(--gap);
    bottom: calc(var(--bar-h) + var(--gap) * 2);
    width: 380px; max-height: min(640px, calc(100vh - var(--bar-h) - var(--gap) * 4));
    display: flex; flex-direction: column; gap: var(--s3); padding: var(--s4);
    border-radius: var(--r-xl);
  }
  header { display: flex; align-items: center; }
  .now { display: flex; align-items: center; gap: var(--s3); }
  .words { display: flex; flex-direction: column; gap: 2px; }
  .title { font: 600 var(--t-lg)/1.2 var(--font); }
  a.title:hover { text-decoration: underline; text-underline-offset: 3px; }


  .qhead { display: flex; align-items: center; margin-top: var(--s1); font-size: var(--t-xs); }
  .queue { flex: 1 1 auto; min-height: 60px; overflow-y: auto; margin: 0 -8px; padding: 0 var(--s2); display: flex; flex-direction: column; gap: 1px; }
  .q { display: flex; align-items: center; border-radius: var(--r-sm); }
  .q:hover { background: var(--hover); }
  .q.past { opacity: 0.5; }
  .hit { display: flex; align-items: center; gap: var(--s3); flex: 1 1 auto; min-width: 0; padding: var(--s1) var(--s2); text-align: left; }
  .q .t { display: block; font-size: var(--t-sm); font-weight: 600; }
  .q .s { display: block; font-size: var(--t-xs); color: var(--text-3); }
  .q.on .t { color: var(--accent-text); }
  .rm { opacity: 0; }
  .q:hover .rm, .rm:focus-visible { opacity: 1; }
  @media (pointer: coarse) { .rm { opacity: 1; } }

  .bars { display: flex; align-items: flex-end; gap: 2px; height: 14px; flex: none; }
  .bars i { width: 3px; border-radius: 2px; background: var(--accent); animation: bounce 900ms ease-in-out infinite; }
  .bars i:nth-child(2) { animation-delay: -300ms; }
  .bars i:nth-child(3) { animation-delay: -600ms; }
  .bars.paused i { animation-play-state: paused; }
  @keyframes bounce { 0%, 100% { height: 4px; } 50% { height: 14px; } }

  .panel.narrow {
    inset: 0; width: auto; max-height: none; border-radius: 0; border: 0;
    padding: calc(var(--safe-t) + var(--s3)) var(--s5) calc(var(--safe-b) + var(--s4));
    background: var(--glass-2); overflow-y: auto;
  }
  .narrow .now { flex-direction: column; text-align: center; gap: var(--s4); padding-top: var(--s2); }
  .narrow .words { align-items: center; max-width: 100%; }
  .narrow .title { font-size: var(--t-xl); font-family: var(--display); }
  .scrub { display: flex; flex-direction: column; }
  .times { display: flex; justify-content: space-between; font-size: var(--t-xs); color: var(--text-3); }
  .big { display: flex; align-items: center; justify-content: space-between; }
  .vol { display: flex; align-items: center; gap: var(--s3); color: var(--text-3); }
  .narrow .queue { overflow: visible; flex: none; }

  /* The back button: phones only, where a pop-out covers the page. */
</style>
