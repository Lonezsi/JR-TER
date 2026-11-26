/* The phone's Back closes what is open on top (the search, a sheet, the player, the
 * drawer) before it leaves the page.
 *
 * While a layer is open on a phone it holds one history entry of its own, at the same
 * address, so Back pops that and nothing else: the address never changes, so the router
 * (which follows the hash) never notices. Closing it any other way gives the entry back.
 *
 *   closesOnBack(() => isOpen, () => close())     call during component initialisation
 *   layerPop()                                    true while such a pop is being handled
 */
import { shell } from "../shell/state.svelte";

let popping = 0;
/** Whether the popstate being handled right now is a layer closing, not navigation. */
export const layerPop = () => popping > 0;

export function closesOnBack(open: () => boolean, close: () => void) {
  $effect(() => {
    if (!open() || !shell.narrow) return;
    let mine = true;
    const token = Date.now();
    const at = location.hash;
    history.pushState({ ...(history.state || {}), jriterLayer: token }, "");
    const onpop = () => {
      mine = false;
      popping++;
      setTimeout(() => popping--, 0);
      close();
    };
    window.addEventListener("popstate", onpop, { once: true });
    return () => {
      window.removeEventListener("popstate", onpop);
      // Closed by a button or a tap outside: take our entry back off the stack. But only
      // if nothing navigated: closing because a link was followed (a song tapped in the
      // drawer, a result picked in the search) must not then go Back and undo that. The
      // check waits a task, so a link's own navigation has already happened by then; if it
      // has, our entry is left behind under the new page, which is harmless (Back from
      // there lands on the page the layer was opened over).
      if (!mine) return;
      setTimeout(() => {
        if (location.hash !== at || history.state?.jriterLayer !== token) return;
        popping++; setTimeout(() => popping--, 50);
        history.back();
      }, 0);
    };
  });
}
