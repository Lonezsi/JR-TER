/* The small things every screen needs. Pure functions only: nothing here touches the
 * page, the server or any state, which is what lets everything else import it freely. */

export const clamp = (value: number, low: number, high: number) =>
  Math.max(low, Math.min(high, value));

/** mm:ss, and h:mm:ss once a track is long enough to need it. */
export function time(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return "0:00";
  const whole = Math.floor(seconds);
  const h = Math.floor(whole / 3600);
  const m = Math.floor((whole % 3600) / 60);
  const s = whole % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

export function bytes(n: number | null | undefined): string {
  if (!n) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  const value = n / Math.pow(1024, i);
  return `${value >= 100 || i === 0 ? Math.round(value) : value.toFixed(1)} ${units[i]}`;
}

/** "today", "3 days ago", then a short date. For sentences, not columns. */
export function when(epochSeconds: number | null | undefined): string {
  if (!epochSeconds) return "";
  const then = new Date(epochSeconds * 1000);
  const days = Math.floor((Date.now() - then.getTime()) / 86400000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  const sameYear = then.getFullYear() === new Date().getFullYear();
  return then.toLocaleDateString(undefined, {
    day: "numeric", month: "short", year: sameYear ? undefined : "numeric",
  });
}

/** Year/month/day, zero padded, from local parts. For columns of dates that have to
 *  sort by eye: a locale gives neither a fixed width nor the biggest unit first. */
export function ymd(epochSeconds: number | null | undefined): string {
  if (!epochSeconds) return "";
  const at = new Date(epochSeconds * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${at.getFullYear()}/${pad(at.getMonth() + 1)}/${pad(at.getDate())}`;
}

export function date(epochSeconds: number | null | undefined): string {
  return epochSeconds
    ? new Date(epochSeconds * 1000).toLocaleString(undefined,
        { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })
    : "";
}

/** A stable hue per title, so a song without artwork still looks like itself. */
export function hue(text: string | null | undefined): number {
  let hash = 0;
  const value = String(text || "?");
  for (let i = 0; i < value.length; i++) hash = (hash * 31 + value.charCodeAt(i)) % 360;
  return hash;
}

export const letter = (text: string | null | undefined) =>
  (String(text || "?").trim()[0] || "?").toUpperCase();

export const plural = (n: number, one: string, many = one + "s") =>
  `${n} ${n === 1 ? one : many}`;

export const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export interface Debounced<A extends unknown[]> {
  (...args: A): void;
  cancel(): void;
  now(...args: A): void;
}

/** Wait for a burst of calls to settle. */
export function debounce<A extends unknown[]>(fn: (...args: A) => void, ms: number): Debounced<A> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const wrapped = ((...args: A) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  }) as Debounced<A>;
  wrapped.cancel = () => clearTimeout(timer);
  wrapped.now = (...args: A) => { clearTimeout(timer); fn(...args); };
  return wrapped;
}

/** localStorage that never throws: a private window keeps the defaults. */
export const store = {
  get<T>(key: string, fallback: T): T {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? fallback : (JSON.parse(raw) as T);
    } catch { return fallback; }
  },
  set(key: string, value: unknown) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* fine */ }
  },
  raw(key: string): string | null {
    try { return localStorage.getItem(key); } catch { return null; }
  },
  setRaw(key: string, value: string) {
    try { localStorage.setItem(key, value); } catch { /* fine */ }
  },
};

/** Text compares as a person reads it: case blind, "Track 10" after "Track 9". */
export const byText = (a: string, b: string) =>
  String(a).localeCompare(String(b), undefined, { sensitivity: "base", numeric: true });

/** Fuzzy subsequence score for the command palette: higher is better, -1 is no match.
 *  Consecutive and word-start matches count for more, so "ls" finds "Late Shift". */
export function fuzzy(needle: string, haystack: string): number {
  const n = needle.toLowerCase();
  const h = haystack.toLowerCase();
  if (!n) return 0;
  const at = h.indexOf(n);
  if (at >= 0) return 1000 - at - (h.length - n.length) * 0.01;
  let score = 0;
  let from = 0;
  let run = 0;
  for (const ch of n) {
    const found = h.indexOf(ch, from);
    if (found < 0) return -1;
    run = found === from ? run + 1 : 0;
    const wordStart = found === 0 || /[\s\-_/.]/.test(h[found - 1]);
    score += 1 + run * 2 + (wordStart ? 4 : 0);
    from = found + 1;
  }
  return score - h.length * 0.01;
}
