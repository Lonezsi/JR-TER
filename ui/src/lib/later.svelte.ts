/* Undo instead of "are you sure?".
 *
 * A delete that can be taken back doesn't ask first. The thing disappears at once, a toast
 * says what went with an Undo on it, and the delete only reaches the server when the toast
 * runs out. Undo inside that time and nothing happened at all. Close the tab inside it and
 * nothing happened either, which is the safe way round.
 *
 * Only for what the app can genuinely give back. Disconnecting an account, revoking a
 * device, restarting, erasing the library: those still ask.
 *
 *   deleteSoon(key, message, commit, { restore?, after? })
 *       key      "song:12": hides it everywhere that asks hidden()
 *       commit   the real delete; an error brings the thing back and says so
 *   hidden(key) -> boolean   for lists to leave a pending delete out
 */
import { attempt } from "./api";
import { toast } from "./toast.svelte";

const WAIT = 7000;   // the same time an action toast stays up

export const pending = $state<{ keys: string[] }>({ keys: [] });
export const hidden = (key: string) => pending.keys.includes(key);
const drop = (key: string) => { pending.keys = pending.keys.filter((k) => k !== key); };

export function deleteSoon(key: string, message: string, commit: () => Promise<unknown>,
                           opts: { restore?: () => void; after?: () => void } = {}) {
  if (hidden(key)) return;
  pending.keys = [...pending.keys, key];
  let settled = false;
  const timer = setTimeout(async () => {
    settled = true;
    const ok = await attempt(commit);
    drop(key);
    if (ok === null) { opts.restore?.(); return; }
    opts.after?.();
  }, WAIT);
  toast(message, "", {
    label: "Undo",
    run: () => {
      if (settled) return;
      clearTimeout(timer);
      drop(key);
      opts.restore?.();
    },
  });
}
