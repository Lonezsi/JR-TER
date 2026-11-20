/* Toasts. At most three; the same line twice is counted, not stacked.
 *
 * A toast may carry one action ("Undo"), which is how a destructive thing that can be
 * put back avoids asking first: do it, say so, and offer the way back for a few seconds.
 */
export interface Toast {
  id: number;
  message: string;
  kind: "" | "bad";
  times: number;
  action?: { label: string; run: () => void };
}

const MOST = 3;
let next = 1;
const timers = new Map<number, ReturnType<typeof setTimeout>>();

export const toasts = $state<{ list: Toast[] }>({ list: [] });

export function dismiss(id: number) {
  clearTimeout(timers.get(id));
  timers.delete(id);
  toasts.list = toasts.list.filter((t) => t.id !== id);
}

function arm(id: number, ms: number) {
  clearTimeout(timers.get(id));
  timers.set(id, setTimeout(() => dismiss(id), ms));
}

export function toast(message: string, kind: "" | "bad" = "",
                      action?: { label: string; run: () => void }): number {
  const ms = action ? 7000 : kind === "bad" ? 4800 : 2600;
  const already = toasts.list.find((t) => t.message === message && !t.action && !action);
  if (already) {
    already.times += 1;
    arm(already.id, ms);
    return already.id;
  }
  const id = next++;
  toasts.list = [...toasts.list, { id, message, kind, times: 1, action }].slice(-MOST);
  arm(id, ms);
  return id;
}
