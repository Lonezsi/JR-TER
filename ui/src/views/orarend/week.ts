/* The week: its shapes, and every sum the screen does with it.
 *
 * Pure functions only, so the grid, the day pager and the sheets all read the same
 * answers. A class says when it is and the layout follows: nothing here is a pixel.
 *
 * THE WEEK IS NOT IN THE SOURCE. It comes from /api/orarend, which reads a file in the
 * owner's own directory. That file names a second person, and this repository is public.
 */

export interface Entry {
  key: string;
  id?: number;
  day: number;
  at: string;
  to: string;
  kind: string;
  whose: string;
  name: string;
  where?: string;
  teacher?: string;
  group?: string;
  code?: string;
  skip?: boolean;
  /** Sent but not answered yet. */
  pending?: boolean;
  [key: string]: unknown;
}

export interface Week {
  readonly: boolean;
  owner: string;
  classes: Entry[];
  from: number;
  to: number;
  hour: number;
  missing?: boolean;
  broken?: string;
  where?: string;
}

export interface Page { id: number; position: number; text: string; updated_at?: number }
export interface Notes { subject: string; absences: number; allowed: number; pages: Page[] }

/** What the form sends, which is exactly what the server will keep. */
export interface ClassValues {
  day: number; at: string; to: string; kind: string; whose: string; name: string;
  where: string; teacher: string; group: string; code: string; skip: boolean;
}

export const DAYS = ["Hétfő", "Kedd", "Szerda", "Csütörtök", "Péntek"];
export const DAYS_SHORT = ["H", "K", "Sze", "Cs", "P"];

/* A konzultáció is neither a lecture nor a practical, and a band is neither a kind of
 * class nor a thing with a tag on it: it is the reason an afternoon is not free. Both are
 * named so a sheet can say what it opened rather than the raw word out of the file. */
export const KIND_SAID: Record<string, string> = {
  ea: "Előadás", gy: "Gyakorlat", both: "Előadás és gyakorlat",
  konz: "Konzultáció", band: "Elfoglaltság",
};
export const KIND_TAG: Record<string, string> = { ea: "Ea", gy: "Gy", both: "Ea+Gy", konz: "Konz" };

/** The fields the server keeps for a class. Anything else in an entry is somebody's own
 *  key in the file, which the server leaves alone and which a new class cannot carry. */
export const FIELDS = ["day", "at", "to", "kind", "whose", "name", "where", "skip",
                       "code", "group", "teacher"] as const;

export const NEW: ClassValues = {
  day: 0, at: "10:00", to: "11:30", kind: "gy", whose: "me",
  name: "", where: "", teacher: "", group: "", code: "", skip: false,
};

/* "Not mine", one colour per other person.
 *
 * Fixed, and deliberately NOT the accent: the accent follows whatever is playing, so a
 * category built on it would change colour when a song changed. Evenly spaced round the
 * wheel at the same saturation and lightness, so nobody reads as louder than anybody
 * else, and clear of the amber of --warn and the red of --bad. Three, because a fourth
 * person would have to share (they take the first again).
 *
 * Here rather than in a stylesheet because the sheets are drawn outside the screen and
 * need the same table. */
export const WHO = ["#e0679e", "#679de0", "#9de067"];

/** Minutes past midnight. The one place a written time becomes a number. */
export function minutes(clock: string): number {
  const parts = String(clock).split(":").map(Number);
  return (parts[0] || 0) * 60 + (parts[1] || 0);
}

export function clock(mins: number): string {
  const m = Math.max(0, Math.min(23 * 60 + 59, Math.round(mins)));
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

export const clash = (a: Entry, b: Entry) =>
  minutes(a.at) < minutes(b.to) && minutes(b.at) < minutes(a.to);

/** A class as the screen reads it: a hand written entry may leave out whose it is or
 *  what kind, and the server's own defaults for those are "me" and "gy". */
export function tidy(entry: Entry): Entry {
  return { ...entry, whose: entry.whose || "me", kind: entry.kind || "gy", name: String(entry.name ?? "") };
}

/* Everybody on this timetable who is not me, sorted.
 *
 * Sorted rather than in the order they happen to appear, so a person keeps the same
 * colour when a class is added, moved or dropped. */
export const peopleOf = (classes: Entry[]) =>
  [...new Set(classes.filter((e) => e.whose !== "me").map((e) => e.whose))].sort();

export const whoColour = (people: string[], name: string) =>
  WHO[Math.max(0, people.indexOf(name)) % WHO.length];

/* The window the grid draws.
 *
 * The server sends one, and a class outside it used to be worked out, correctly, into a
 * position off the page where it could not be seen or pressed. Adding an early class is a
 * normal thing to do, so the window opens to hold whatever the week has in it. */
export function windowOf(week: { from: number; to: number }, classes: Entry[]) {
  let from = week.from, to = week.to;
  for (const e of classes) {
    from = Math.min(from, Math.floor(minutes(e.at) / 60));
    to = Math.max(to, Math.ceil(minutes(e.to) / 60));
  }
  return { from: Math.max(0, from), to: Math.min(24, Math.max(to, from + 1)) };
}

export interface Placed {
  entry: Entry;
  /** Hours from the top of the grid, and hours long. Hours rather than pixels: how tall
   *  an hour is belongs to the table, which multiplies these by --tt-hour. */
  at: number;
  runs: number;
  lane: number;
  /** Starts after the strip of a skipped lecture it shares an hour with. */
  inset: boolean;
}

export interface DayPlan {
  bands: Placed[];
  cards: Placed[];
  stripes: Placed[];
  /** How many stripe lanes this day uses, so a card gives up exactly that much room. */
  lanes: number;
  /** Everything pressable, in the order the arrow keys walk it. */
  order: Entry[];
}

/* One day, for whoever's week is being looked at.
 *
 * "all" is my classes as cards and everybody else's as a stripe down the side of the
 * day, which answers "when are we both free" without four people's lectures fighting
 * over one column. One person picked is their week drawn the way mine is.
 *
 * A band (work, anything that takes a piece of the day without being a class) goes
 * behind everything: it is not competing for the column, it is why the column is not
 * free.
 *
 * A stripe takes the first lane no overlapping stripe is using. First free rather than
 * next, or a clash that has ended would leave a stripe's width of nothing beside
 * everything after it. */
export function planDay(classes: Entry[], day: number, who: string, from: number): DayPlan {
  const everyone = who === "all";
  const front = everyone ? "me" : who;
  const today = classes.filter((e) => e.day === day);
  const own = today.filter((e) => e.whose === front);
  const mine = own.filter((e) => e.kind !== "band");
  const skips = mine.filter((e) => e.skip);
  const place = (entry: Entry, lane = 0, inset = false): Placed => ({
    entry, lane, inset,
    at: (minutes(entry.at) - from * 60) / 60,
    runs: Math.max(0, minutes(entry.to) - minutes(entry.at)) / 60,
  });

  const stripes: Placed[] = [];
  if (everyone) {
    for (const entry of today.filter((e) => e.whose !== "me")) {
      const taken = stripes.filter((o) => clash(entry, o.entry)).map((o) => o.lane);
      let lane = 0;
      while (taken.includes(lane)) lane += 1;
      stripes.push(place(entry, lane));
    }
  }
  const bands = own.filter((e) => e.kind === "band").map((e) => place(e));
  const cards = mine.map((e) => place(e, 0, !e.skip && skips.some((s) => clash(s, e))));
  const order = [...bands, ...cards, ...stripes].map((p) => p.entry)
    .sort((a, b) => minutes(a.at) - minutes(b.at) || minutes(a.to) - minutes(b.to));
  return {
    bands, cards, stripes, order,
    lanes: stripes.length ? Math.max(...stripes.map((s) => s.lane)) + 1 : 0,
  };
}

/* ── markdown, as a tree ─────────────────────────────────────────────────────
 *
 * The same small dialect the old renderer spoke (headings, emphasis, code, strike,
 * lists, quotes, rules, http links, and every line break kept), but parsed into data so
 * the page can draw it as elements. Nothing a person typed is ever handed to the
 * browser as markup. */
export type Inline =
  | { t: "text" | "code" | "strong" | "em" | "both" | "s"; text: string }
  | { t: "link"; text: string; href: string };

export type Block =
  | { t: "gap" } | { t: "hr" }
  | { t: "h"; level: number; inl: Inline[] }
  | { t: "line"; inl: Inline[] }
  | { t: "quote"; lines: Inline[][] }
  | { t: "ul" | "ol"; items: Inline[][] };

// Code first, so nothing inside it is treated as emphasis. Only http and https links,
// so one cannot carry a javascript: address.
const INLINE = /`([^`]+)`|\*\*\*([^*]+)\*\*\*|\*\*([^*]+)\*\*|\*([^*\n]+)\*|(?<![\w_])_([^_\n]+)_(?![\w_])|~~([^~]+)~~|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;

export function inline(raw: string): Inline[] {
  const out: Inline[] = [];
  let last = 0;
  for (const m of raw.matchAll(INLINE)) {
    const at = m.index ?? 0;
    if (at > last) out.push({ t: "text", text: raw.slice(last, at) });
    if (m[1] != null) out.push({ t: "code", text: m[1] });
    else if (m[2] != null) out.push({ t: "both", text: m[2] });
    else if (m[3] != null) out.push({ t: "strong", text: m[3] });
    else if (m[4] != null) out.push({ t: "em", text: m[4] });
    else if (m[5] != null) out.push({ t: "em", text: m[5] });
    else if (m[6] != null) out.push({ t: "s", text: m[6] });
    else out.push({ t: "link", text: m[7], href: m[8] });
    last = at + m[0].length;
  }
  if (last < raw.length) out.push({ t: "text", text: raw.slice(last) });
  return out;
}

export function markdown(source: string): Block[] {
  const out: Block[] = [];
  for (const raw of String(source ?? "").split("\n")) {
    const line = raw.replace(/\s+$/, "");
    const before = out[out.length - 1];
    if (!line.trim()) { out.push({ t: "gap" }); continue; }

    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) { out.push({ t: "h", level: heading[1].length, inl: inline(heading[2]) }); continue; }
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())) { out.push({ t: "hr" }); continue; }

    const quote = line.match(/^>\s?(.*)$/);
    if (quote) {
      if (before?.t === "quote") before.lines.push(inline(quote[1]));
      else out.push({ t: "quote", lines: [inline(quote[1])] });
      continue;
    }
    const bullet = line.match(/^\s*[-*+]\s+(.*)$/);
    const numbered = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (bullet || numbered) {
      const want = bullet ? "ul" : "ol";
      const item = inline((bullet || numbered)![1]);
      if (before?.t === want) before.items.push(item);
      else out.push({ t: want, items: [item] });
      continue;
    }
    // Every remaining line is its own line: notes are broken where they are broken.
    out.push({ t: "line", inl: inline(line) });
  }
  return out;
}
