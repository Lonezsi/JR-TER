<!-- Draws the dialogs on lib/dialog's stack. On a wide screen a sheet is a centred pane;
     on a phone it rises from the bottom edge and can be dragged down to dismiss.

     Escape and the scrim dismiss. Ctrl+Enter confirms, except where confirming destroys
     something: a destructive answer should cost a deliberate press of the button that
     says what it does. Tab stays inside, and focus goes back where it came from. -->
<script lang="ts">
  import { sheets, type OpenSheet } from "$lib/dialog.svelte";
  import Dropdown from "./Dropdown.svelte";
  import { pane } from "$lib/glass/glass.svelte";
  import { closesOnBack } from "$lib/back.svelte";
  import Icon from "./Icon.svelte";
  import { fade } from "svelte/transition";
  import { cubicOut } from "svelte/easing";

  let values = $state<Record<number, Record<string, any>>>({});
  const cameFrom = new Map<number, Element | null>();

  function valuesOf(sheet: OpenSheet) {
    if (!values[sheet.id]) {
      values[sheet.id] = Object.fromEntries((sheet.fields || []).map((f) =>
        [f.name, f.value ?? (f.type === "checkbox" ? false : "")]));
    }
    return values[sheet.id];
  }

  function close(sheet: OpenSheet, value: any) {
    const from = cameFrom.get(sheet.id);
    cameFrom.delete(sheet.id);
    delete values[sheet.id];
    sheet.resolve(value);
    if (from instanceof HTMLElement && from.isConnected) from.focus({ preventScroll: true });
  }

  function confirm(sheet: OpenSheet, node?: HTMLElement) {
    const form = node?.querySelector("form");
    if (form && !form.reportValidity()) return;
    close(sheet, { ...valuesOf(sheet) });
  }

  // On a phone, Back closes the top sheet.
  closesOnBack(() => sheets.stack.length > 0, () => { const top = sheets.stack[sheets.stack.length - 1]; if (top) close(top, null); });

  // The app behind is inert while anything is open, so it can be neither tabbed into nor
  // read out.
  $effect(() => {
    const app = document.getElementById("shell");
    if (app) app.inert = sheets.stack.length > 0;
  });

  function mounted(node: HTMLElement, sheet: OpenSheet) {
    cameFrom.set(sheet.id, document.activeElement);
    setTimeout(() => {
      const first = node.querySelector<HTMLElement>("[autofocus], input:not([type=checkbox]), textarea, select")
        || node.querySelector<HTMLElement>("[data-cancel]") || node;
      first.focus({ preventScroll: true });
      if (first instanceof HTMLInputElement || first instanceof HTMLTextAreaElement) first.select();
    }, 40);

    const onkey = (e: KeyboardEvent) => {
      if (sheets.stack[sheets.stack.length - 1]?.id !== sheet.id) return;
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(sheet, null); return; }
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !sheet.danger && sheet.confirm !== "") {
        e.preventDefault(); confirm(sheet, node); return;
      }
      if (e.key !== "Tab") return;
      const reachable = Array.from(node.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]),'
        + ' select:not([disabled]), [tabindex]:not([tabindex="-1"])'))
        .filter((n) => n.offsetParent !== null);
      if (!reachable.length) return;
      const edge = e.shiftKey ? reachable[0] : reachable[reachable.length - 1];
      if (document.activeElement === edge || !node.contains(document.activeElement)) {
        e.preventDefault();
        (e.shiftKey ? reachable[reachable.length - 1] : reachable[0]).focus();
      }
    };
    document.addEventListener("keydown", onkey, true);

    // Drag down to dismiss, from the grabber or the heading, on a touch screen.
    let startY = 0, dy = 0, dragging = false;
    const down = (e: PointerEvent) => {
      if (e.pointerType === "mouse" || !(e.target as HTMLElement).closest(".grab, .head")) return;
      dragging = true; startY = e.clientY; dy = 0;
      node.style.transition = "none";
    };
    const move = (e: PointerEvent) => {
      if (!dragging) return;
      dy = Math.max(0, e.clientY - startY);
      node.style.transform = `translateY(${dy}px)`;
    };
    const up = () => {
      if (!dragging) return;
      dragging = false;
      node.style.transition = "";
      if (dy > 110) close(sheet, null);
      else node.style.transform = "";
    };
    node.addEventListener("pointerdown", down);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return {
      destroy() {
        document.removeEventListener("keydown", onkey, true);
        node.removeEventListener("pointerdown", down);
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        window.removeEventListener("pointercancel", up);
      },
    };
  }

  // Rises on a phone, scales in on a desktop: one transition that asks the screen which.
  function arrive(_node: Element, { out = false } = {}) {
    const narrow = matchMedia("(max-width: 640px)").matches;
    return {
      duration: out ? 180 : 380,
      easing: cubicOut,
      css: (t: number) => narrow
        ? `transform: translateY(${(1 - t) * 100}%);`
        : `transform: translateY(${(1 - t) * 14}px) scale(${0.96 + t * 0.04}); opacity: ${t};`,
    };
  }
</script>

{#each sheets.stack as sheet, depth (sheet.id)}
  {@const v = valuesOf(sheet)}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div class="backdrop" style:z-index={700 + depth}
       onpointerdown={(e) => { if (e.target === e.currentTarget) close(sheet, null); }}>
    <!-- THE RULE, for anything with glass in it: no ancestor of a blurred element may change its
     opacity. While an ancestor is below 1 the browser treats it as the edge of what the blur
     can see, so the blur has nothing behind it until the fade ends and then appears at once.
     The blurred element fading ITSELF is fine. So the dim is its own layer, and the glass
     panel carries its own fade. -->
    <div class="dim" transition:fade={{ duration: 180 }}></div>
    <div class="sheet glass modal" use:pane class:wide={sheet.wide} role="dialog" aria-modal="true" aria-label={sheet.title}
         tabindex="-1" use:mounted={sheet} in:arrive out:arrive={{ out: true }}>
      <div class="grab" aria-hidden="true"><span></span></div>
      <div class="head">
        <div class="titlerow"><button class="icon-btn sm backbtn" onclick={() => close(sheet, null)} aria-label="Back"><Icon name="chev-left" size={18} /></button><h2>{sheet.title}</h2></div>
        {#if sheet.sub}<p class="sub">{sheet.sub}</p>{/if}
      </div>
      <div class="body">
        {#if sheet.fields?.length}
          <form onsubmit={(e) => { e.preventDefault(); confirm(sheet, e.currentTarget.closest(".sheet") as HTMLElement); }}>
            {#each sheet.fields as f (f.name)}
              {#if f.type === "checkbox"}
                <label class="check"><input type="checkbox" bind:checked={v[f.name]} /><span>{f.label}</span></label>
              {:else}
                <label class="label">
                  {#if f.label}<span>{f.label}{#if f.required}<span class="req" aria-hidden="true">*</span>{/if}</span>{/if}
                  {#if f.type === "textarea"}
                    <textarea class="field" bind:value={v[f.name]} placeholder={f.placeholder}
                              required={f.required} maxlength={f.maxlength} rows="5"></textarea>
                  {:else if f.type === "select"}
                    <Dropdown bind:value={v[f.name]} options={(f.options || []).map((o) => ({ value: o.value, label: o.label }))} label={f.label} block />
                  {:else}
                    <input class="field" type={f.type || "text"} bind:value={v[f.name]} placeholder={f.placeholder}
                           required={f.required} maxlength={f.maxlength} min={f.min} max={f.max} step={f.step}
                           autocomplete={(f.autocomplete || "off") as any} />
                  {/if}
                  {#if f.hint}<span class="hint">{f.hint}</span>{/if}
                </label>
              {/if}
            {/each}
            <!-- So Enter in a single line field submits, as it does in any form. -->
            <button type="submit" class="sr-only" tabindex="-1" aria-hidden="true">submit</button>
          </form>
        {/if}
        {#if sheet.body}
          {@const Body = sheet.body}
          <Body {...(sheet.props || {})} close={(value: any = null) => close(sheet, value)} />
        {/if}
      </div>
      {#if sheet.cancel !== "" || sheet.confirm !== ""}
        <div class="foot">
          {#if sheet.cancel !== ""}
            <button class="btn ghost" data-cancel onclick={() => close(sheet, null)}>{sheet.cancel || "Cancel"}</button>
          {/if}
          {#if sheet.confirm !== ""}
            <button class="btn {sheet.danger ? 'danger' : 'primary'}"
                    onclick={(e) => confirm(sheet, (e.currentTarget as HTMLElement).closest(".sheet") as HTMLElement)}>
              {sheet.confirm || "Save"}
            </button>
          {/if}
        </div>
      {/if}
    </div>
  </div>
{/each}

<style>
  .backdrop {
    position: fixed; inset: 0; display: grid; place-items: center; padding: var(--s4);
  }
  .dim { position: absolute; inset: 0; background: rgba(0, 0, 0, 0.24); pointer-events: none;
          backdrop-filter: blur(3px); -webkit-backdrop-filter: blur(3px); }
  .sheet {
    width: min(100%, 460px); max-height: min(86vh, 760px);
    display: flex; flex-direction: column; border-radius: var(--r-xl);
    transition: transform 280ms var(--spring);
  }
  .sheet.wide { width: min(100%, 760px); }
  .grab { display: none; }
  .head { padding: var(--s5) var(--s5) 0; }
  .sub { color: var(--text-2); margin-top: var(--s2); font-size: var(--t-sm); }
  .body { padding: var(--s4) var(--s5); overflow-y: auto; flex: 1 1 auto; min-height: 0; }
  .body:empty { display: none; }
  form { display: flex; flex-direction: column; gap: var(--s4); }
  .check { display: flex; align-items: center; gap: var(--s3); font-weight: 600; cursor: pointer; }
  .check input { width: 18px; height: 18px; accent-color: var(--accent); }
  .foot { display: flex; justify-content: flex-end; gap: var(--s2); padding: var(--s2) var(--s5) var(--s5); }

  @media (max-width: 640px) {
    .backdrop { place-items: end stretch; padding: 0; }
    .sheet, .sheet.wide {
      width: 100%; max-height: 92vh; border-radius: var(--r-xl) var(--r-xl) 0 0;
      border-bottom: 0; padding-bottom: var(--safe-b);
    }
    .grab { display: grid; place-items: center; padding: var(--s2) 0 0; touch-action: none; }
    .grab span { width: 38px; height: 5px; border-radius: 999px; background: var(--line-2); }
    .head { padding-top: var(--s3); touch-action: none; }
    .foot { flex-direction: column-reverse; }
    .foot .btn { width: 100%; height: 46px; }
  }

  /* The back button: phones only, where a pop-out covers the page. */
  .backbtn { display: none; }
  :global(html[data-narrow]) .backbtn { display: inline-grid; }
  .titlerow { display: flex; align-items: center; gap: var(--s2); }
</style>
