<!-- The mixer under the playlist: a channel strip per lane and the master at the end.
     The faders and the pan dial are things you move, not number fields: drag a fader up,
     turn the dial by dragging up or down, double click either to put it back. Arrow keys do
     the same in small steps, Page Up and Down in big ones. -->
<script lang="ts">
  import Icon from "$ui/Icon.svelte";
  import { mix, arrange } from "$lib/audio/arrange.svelte";
  import { player, setVolume } from "$lib/player.svelte";
  import { clamp } from "$lib/util";

  const LANE_MAX = 1.5;           // a lane may go a little over unity; the master may not

  const db = (v: number) => (v <= 0.0005 ? "-∞" : `${(20 * Math.log10(v)) >= 0 ? "+" : ""}${(20 * Math.log10(v)).toFixed(1)}`);
  const panWords = (p: number) => (Math.abs(p) < 0.01 ? "C" : `${Math.round(Math.abs(p) * 100)}${p < 0 ? "L" : "R"}`);

  /* One drag for both controls: up is more. Fader moves follow the finger over its slot;
   * the dial takes 160px for its whole sweep, the way a knob is turned on a hardware desk. */
  function drag(e: PointerEvent, get: () => number, set: (v: number) => void, lo: number, hi: number, px: number) {
    if (e.button !== 0) return;
    const node = e.currentTarget as HTMLElement;
    node.focus({ preventScroll: true });
    try { node.setPointerCapture(e.pointerId); } catch { /* not captured */ }
    const y0 = e.clientY, v0 = get();
    const move = (ev: PointerEvent) => set(clamp(v0 + ((y0 - ev.clientY) / px) * (hi - lo), lo, hi));
    const done = () => { node.removeEventListener("pointermove", move); node.removeEventListener("pointerup", done); node.removeEventListener("pointercancel", done); };
    node.addEventListener("pointermove", move);
    node.addEventListener("pointerup", done);
    node.addEventListener("pointercancel", done);
  }
  function keys(e: KeyboardEvent, get: () => number, set: (v: number) => void, lo: number, hi: number, home: number) {
    const span = hi - lo;
    const by = e.key === "ArrowUp" || e.key === "ArrowRight" ? span / 50 : e.key === "ArrowDown" || e.key === "ArrowLeft" ? -span / 50
      : e.key === "PageUp" ? span / 8 : e.key === "PageDown" ? -span / 8 : null;
    if (e.key === "Home" || e.key === "0") { e.preventDefault(); set(home); return; }
    if (by === null) return;
    e.preventDefault();
    set(clamp(get() + by, lo, hi));
  }

  const laneVol = { get: () => mix.volume, set: (v: number) => arrange.setMix({ volume: v }) };
  const lanePan = { get: () => mix.pan, set: (v: number) => arrange.setMix({ pan: v }) };
  const masterVol = { get: () => player.volume, set: (v: number) => setVolume(v) };
</script>

<div class="mixer" role="group" aria-label="Mixer">
  <!-- the arrangement lane -->
  <div class="chan" class:muted={mix.mute}>
    <span class="cname truncate" title="The arrangement lane">Arrangement</span>
    <div class="dial" role="slider" tabindex="0" aria-label="Pan" aria-valuemin={-100} aria-valuemax={100}
         aria-valuenow={Math.round(mix.pan * 100)} aria-valuetext={panWords(mix.pan)}
         title="Pan {panWords(mix.pan)}. Drag up or down; double click for centre."
         style:--turn="{mix.pan * 135}deg"
         onpointerdown={(e) => drag(e, lanePan.get, lanePan.set, -1, 1, 160)}
         onkeydown={(e) => keys(e, lanePan.get, lanePan.set, -1, 1, 0)}
         ondblclick={() => lanePan.set(0)}><i></i></div>
    <span class="read num">{panWords(mix.pan)}</span>
    <div class="fader" role="slider" tabindex="0" aria-label="Arrangement volume" aria-orientation="vertical"
         aria-valuemin={0} aria-valuemax={LANE_MAX * 100} aria-valuenow={Math.round(mix.volume * 100)} aria-valuetext="{db(mix.volume)} dB"
         title="Volume {db(mix.volume)} dB. Double click for 0 dB."
         style:--at={mix.volume / LANE_MAX} style:--unity={1 / LANE_MAX}
         onpointerdown={(e) => drag(e, laneVol.get, laneVol.set, 0, LANE_MAX, 120)}
         onkeydown={(e) => keys(e, laneVol.get, laneVol.set, 0, LANE_MAX, 1)}
         ondblclick={() => laneVol.set(1)}>
      <span class="slot"></span><span class="zero"></span><span class="cap"></span>
    </div>
    <span class="read num">{db(mix.volume)}</span>
    <div class="ms">
      <button class="flag mute" class:on={mix.mute} aria-pressed={mix.mute} title="Mute" aria-label="Mute the arrangement"
              onclick={() => arrange.setMix({ mute: !mix.mute })}>M</button>
      <button class="flag solo" class:on={mix.solo} aria-pressed={mix.solo} title="Solo" aria-label="Solo the arrangement"
              onclick={() => arrange.setMix({ solo: !mix.solo })}>S</button>
    </div>
  </div>

  <span class="grow"></span>

  <!-- the master, which is the same volume as the player bar's -->
  <div class="chan master" class:muted={player.volume <= 0}>
    <span class="cname">Master</span>
    <span class="dial blank" aria-hidden="true"></span>
    <span class="read">&nbsp;</span>
    <div class="fader" role="slider" tabindex="0" aria-label="Master volume" aria-orientation="vertical"
         aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(player.volume * 100)} aria-valuetext="{db(player.volume)} dB"
         title="Master {db(player.volume)} dB, the same as the player's volume"
         style:--at={player.volume} style:--unity={1}
         onpointerdown={(e) => drag(e, masterVol.get, masterVol.set, 0, 1, 120)}
         onkeydown={(e) => keys(e, masterVol.get, masterVol.set, 0, 1, 0.9)}
         ondblclick={() => masterVol.set(0.9)}>
      <span class="slot"></span><span class="cap"></span>
    </div>
    <span class="read num">{db(player.volume)}</span>
    <div class="ms">
      <span class="flag blank"><Icon name="volume" size={12} /></span>
    </div>
  </div>
</div>

<style>
  .mixer {
    display: flex; align-items: stretch; gap: var(--s2); padding: var(--s3); min-width: 0; overflow-x: auto;
    border-radius: var(--r-md); background: rgba(0, 0, 0, 0.22); box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.45);
  }
  .grow { flex: 1 1 0; }
  .chan {
    flex: none; width: 76px; display: flex; flex-direction: column; align-items: center; gap: 6px;
    padding: var(--s2) var(--s1); border-radius: var(--r-sm);
    background: linear-gradient(180deg, rgba(255, 255, 255, 0.05), rgba(255, 255, 255, 0.015));
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.06), 0 0 0 1px var(--glass-line);
    transition: opacity var(--fast);
  }
  .chan.muted .fader, .chan.muted .dial { opacity: 0.45; }
  .master { background: linear-gradient(180deg, color-mix(in srgb, var(--accent) 12%, transparent), rgba(255, 255, 255, 0.015)); }
  .cname { max-width: 100%; font-size: 11px; font-weight: 600; color: var(--text-2); }
  .read { font-size: var(--t-xs); color: var(--text-3); min-height: 13px; }

  /* A knob with a pointer line: the line is the promise that it turns. */
  .dial {
    position: relative; width: 30px; height: 30px; border-radius: 50%; cursor: ns-resize; touch-action: none; outline: none;
    background: radial-gradient(circle at 35% 30%, #4a4d55, #1c1d22 70%);
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.55), inset 0 1px 0 rgba(255, 255, 255, 0.12), 0 0 0 1px rgba(0, 0, 0, 0.5);
  }
  .dial i { position: absolute; left: 50%; top: 3px; width: 2px; height: 10px; margin-left: -1px; border-radius: 2px; background: var(--accent-hi); transform-origin: 50% 12px; transform: rotate(var(--turn)); box-shadow: 0 0 4px var(--accent); }
  .dial:focus-visible { box-shadow: 0 0 0 2px var(--accent), 0 2px 4px rgba(0, 0, 0, 0.55); }
  .dial.blank { visibility: hidden; }

  /* A fader: a slot, a 0 dB mark, and a cap you pull. */
  .fader { position: relative; width: 34px; height: 128px; cursor: ns-resize; touch-action: none; outline: none; }
  .slot { position: absolute; left: 50%; top: 6px; bottom: 6px; width: 4px; margin-left: -2px; border-radius: 2px; background: rgba(0, 0, 0, 0.55); box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.7); }
  .zero { position: absolute; left: 4px; right: 4px; height: 1px; bottom: calc(6px + (100% - 12px) * var(--unity)); background: var(--text-3); opacity: 0.5; }
  .cap {
    position: absolute; left: 3px; right: 3px; height: 14px; border-radius: 3px;
    bottom: calc((100% - 14px) * var(--at));
    background: linear-gradient(180deg, #5a5e67 0%, #33353b 48%, #2a2c31 52%, #44474f 100%);
    box-shadow: 0 2px 5px rgba(0, 0, 0, 0.6), inset 0 1px 0 rgba(255, 255, 255, 0.2);
  }
  .cap::after { content: ""; position: absolute; left: 3px; right: 3px; top: 50%; height: 2px; margin-top: -1px; background: var(--accent-hi); border-radius: 1px; }
  .fader:focus-visible .cap { box-shadow: 0 0 0 2px var(--accent), 0 2px 5px rgba(0, 0, 0, 0.6); }

  .ms { display: flex; gap: 4px; }
  .flag {
    display: grid; place-items: center; width: 26px; height: 20px; border-radius: 4px;
    font: 700 var(--t-xs)/1 var(--mono); color: var(--text-3); background: rgba(0, 0, 0, 0.35);
    box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.5); transition: background var(--fast), color var(--fast);
  }
  .flag:hover { color: var(--text); }
  .flag.mute.on { background: var(--bad); color: #fff; box-shadow: 0 0 8px color-mix(in srgb, var(--bad) 50%, transparent); }
  .flag.solo.on { background: var(--accent); color: var(--text-on-color); box-shadow: 0 0 8px color-mix(in srgb, var(--accent) 50%, transparent); }
  .flag.blank { background: none; box-shadow: none; }
  @media (prefers-reduced-motion: reduce) { .chan, .flag { transition: none; } }
</style>
