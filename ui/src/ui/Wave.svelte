<!-- The shape of a render, drawn small. A hundred and twenty numbers from the server, 0 to
     255, one per column, as one SVG polygon: it sits behind a row in a list, and a canvas
     per row would be a hundred contexts repainting on every scroll. Decoration for
     recognising a file at a glance. `progress` (0..1) tints the played part. -->
<script lang="ts">
  let { shape = [], progress = null, hue = null, class: klass = "" }: {
    shape?: number[] | null; progress?: number | null; hue?: number | null; class?: string;
  } = $props();

  const points = $derived.by(() => {
    if (!shape || !shape.length) return "";
    const width = 100, half = 20;
    const step = width / (shape.length - 1 || 1);
    const top: string[] = [], bottom: string[] = [];
    shape.forEach((value, i) => {
      const x = (i * step).toFixed(2);
      const y = Math.max(0.4, (value / 255) * half);
      top.push(`${x},${(half - y).toFixed(2)}`);
      bottom.push(`${x},${(half + y).toFixed(2)}`);
    });
    return top.concat(bottom.reverse()).join(" ");
  });
  const id = `w${Math.random().toString(36).slice(2, 9)}`;
</script>

{#if points}
  <svg class="wave {klass}" viewBox="0 0 100 40" preserveAspectRatio="none" aria-hidden="true"
       focusable="false" style:--wave-hue={hue ?? undefined} class:hued={hue !== null}>
    {#if progress !== null}
      <defs>
        <clipPath {id}><rect x="0" y="0" width={Math.max(0, Math.min(1, progress)) * 100} height="40" /></clipPath>
      </defs>
      <polygon {points} class="rest" />
      <polygon {points} class="played" clip-path="url(#{id})" />
    {:else}
      <polygon {points} />
    {/if}
  </svg>
{/if}

<style>
  .wave { width: 100%; height: 100%; }
  polygon { fill: currentColor; }
  .hued polygon { fill: hsl(var(--wave-hue) 85% 68%); }
  .rest { opacity: 0.32; }
  .played { fill: var(--accent); }
</style>
