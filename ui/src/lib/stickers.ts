/* The stickers on an album's case.
 *
 * Every album starts with two or three: the warning sticker (JR!TER's own LISTEN LOUD label,
 * in the stacked black-and-white style of record warning labels but with its own words, so
 * not a copy of any real one) and one or two shop stickers picked at random, the same random
 * every time for the same album (seeded by its id), so a case looks the same in the library,
 * the sidebar and on its own page.
 *
 * Each sticker sits anywhere on the case: x and y are where its middle is (percent of the
 * case), s its size (1 = normal) and rot its tilt in degrees. The album's Stickers editor
 * places them by hand; what it saves is a list of these, stored with the album
 * (albums.stickers, JSON). Empty means "the random ones". A sticker saved before stickers
 * moved freely says `at` (one of six spots) instead, and is read as that spot's x/y.
 *
 *   stickersOf(album)        -> Sticker[]  (saved ones, or the album's random ones)
 *   randomStickers(seed)     -> Sticker[]
 *   KINDS                    what there is, with a name and a default text
 */
export type StickerKind = "warning" | "price" | "barcode" | "sale" | "ticket" | "tape" | "year" | "discount";
export interface Sticker { kind: StickerKind; x: number; y: number; s: number; rot: number; text?: string }

export const MAX_STICKERS = 8;
export const KINDS: { kind: StickerKind; name: string; text: (r: () => number, year?: number | null) => string }[] = [
  { kind: "warning", name: "Listen loud", text: () => "" },
  { kind: "price", name: "Price gun", text: (r) => `$${(4 + Math.floor(r() * 26))}.${[95, 99, 49, 50][Math.floor(r() * 4)]}` },
  { kind: "barcode", name: "Barcode", text: (r) => `${10 + Math.floor(r() * 89)}¢` },
  { kind: "sale", name: "Sale", text: (r) => `$${1 + Math.floor(r() * 9)}.99` },
  { kind: "ticket", name: "Ticket", text: (r) => `$${(5 + Math.floor(r() * 15))}.99` },
  { kind: "tape", name: "Tape", text: () => "" },
  { kind: "year", name: "Year", text: (_r, year) => String(year || 1991) },
  { kind: "discount", name: "Discounted", text: () => "" },
];
const SHOP: StickerKind[] = ["price", "barcode", "sale", "ticket", "tape", "year", "discount"];
const AT: Record<string, [number, number]> = { tl: [28, 14], t: [50, 11], tr: [76, 13], bl: [30, 86], b: [50, 89], br: [74, 86] };

export const hasText = (k: StickerKind) => k !== "tape" && k !== "discount";
/** The warning label's three lines, from its text ("top|big word|bottom"); blanks keep the default. */
export const WARNING = ["LISTEN", "LOUD", "HIGH VOLUME CONTENT"] as const;
export function warningLines(text?: string): string[] {
  const parts = (text ?? "").split("|");
  return WARNING.map((d, i) => (parts[i] ?? "").trim() || d);
}
export const nameOf = (k: StickerKind) => KINDS.find((x) => x.kind === k)?.name ?? k;

/** A small, stable random: the same seed gives the same sequence on every page. */
function seeded(seed: number) {
  let s = (seed * 2654435761) >>> 0 || 1;
  return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) % 10000) / 10000; };
}

export function randomStickers(seed: number, year?: number | null): Sticker[] {
  const r = seeded(seed + 7);
  const jig = (n: number) => (r() - 0.5) * n;
  // The warning label always, in a bottom corner, like it's printed on the shrink-wrap.
  const left = r() < 0.5;
  const out: Sticker[] = [{ kind: "warning", x: (left ? 24 : 76) + jig(4), y: 84 + jig(4), s: 1, rot: Math.round(jig(6)) }];
  const spots: [number, number][] = ([AT.tr, AT.tl, AT.t] as [number, number][]).sort(() => r() - 0.5);
  const extra = 1 + Math.floor(r() * 2);
  const kinds = SHOP.slice().sort(() => r() - 0.5).slice(0, extra);
  kinds.forEach((kind, i) => {
    const k = KINDS.find((x) => x.kind === kind)!;
    out.push({ kind, x: spots[i][0] + jig(6), y: spots[i][1] + jig(6), s: 0.9 + r() * 0.3, rot: Math.round(jig(24)), text: k.text(r, year) || undefined });
  });
  return out;
}

/** One saved sticker, made whole: old fixed-spot ones get their spot's x/y, sizes default. */
function whole(raw: Record<string, unknown>): Sticker {
  const [x, y] = AT[String(raw.at)] ?? [50, 50];
  const n = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);
  return { kind: raw.kind as StickerKind, x: n(raw.x, x), y: n(raw.y, y), s: n(raw.s, 1), rot: n(raw.rot, 0), text: (raw.text as string) || undefined };
}

export function stickersOf(album: { id?: number | string; year?: number | null; stickers?: unknown } | null | undefined): Sticker[] {
  if (!album) return [];
  let raw = album.stickers;
  if (typeof raw === "string" && raw.trim()) {
    try { raw = JSON.parse(raw); } catch { raw = null; }
  }
  if (Array.isArray(raw) && raw.length) return raw.map((s) => whole(s));
  return randomStickers(Number(album.id) || 1, album.year ?? null);
}
