/* Small pure things the song screen's parts share. */
import type { Version } from "$lib/types";

/** A take, with the fields the versions module adds to it. */
export type Take = Version & {
  shape?: number[]; trouble?: string; peak_db?: number | null; bitrate?: number;
  ext?: string; source_path?: string; abLabel?: string;
};
export const take = (v: Version | null | undefined) => v as Take | null;

/* A version says which render it is and what the file was called when it arrived. The
 * original name is often the only thing that says which session it came out of. */
export const versionName = (v: Version | null | undefined) =>
  !v ? "" : (take(v)!.abLabel || `v${v.n}`);
export const versionSub = (v: Version | null | undefined) => (v ? v.label || v.filename || "" : "");

/** What is wrong with a take, in words, or "" when nothing is. */
export function troubleOf(v: Version | null | undefined): { short: string; says: string } | null {
  const what = take(v)?.trouble;
  if (!what || what === "not looked at") return null;
  if (what === "silent") return { short: "silent", says: "There is no sound in this one" };
  if (what === "unreadable") return { short: "will not play", says: "This will not play" };
  return { short: what, says: what };
}

export const initials = (p: { name?: string; handle?: string }) =>
  (p.name || p.handle || "?").trim().split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();

/** How long an audio file is, asked of the browser, so a format the server cannot parse
 *  still arrives with a duration. Resolves 0 when it cannot tell. */
export const durationOf = (file: File) => new Promise<number>((resolve) => {
  const url = URL.createObjectURL(file);
  const audio = new Audio();
  let done = false;
  const finish = (value: number) => {
    if (done) return;
    done = true;
    URL.revokeObjectURL(url);
    resolve(value);
  };
  audio.addEventListener("loadedmetadata",
    () => finish(Number.isFinite(audio.duration) ? audio.duration : 0), { once: true });
  audio.addEventListener("error", () => finish(0), { once: true });
  audio.src = url;
  setTimeout(() => finish(0), 6000);
});

const AUDIO = /\.(mp3|wav|flac|m4a|aac|ogg|opus|aif|aiff|wma)$/i;
export const isAudio = (file: File) => file.type.startsWith("audio/") || AUDIO.test(file.name);
export const isImage = (file: File) => file.type.startsWith("image/");

/** Send the browser to a file, as a download. */
export function download(url: string, name?: string) {
  const link = document.createElement("a");
  link.href = url;
  if (name !== undefined) link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

// ── markdown, for lyrics ─────────────────────────────────────────────────────

/* The first line, with any heading marks taken off. Matches what the server stores as
 * the sheet's name, so the two never disagree. */
export function mdTitle(source: string | null | undefined, fallback = ""): string {
  for (const line of String(source || "").split("\n")) {
    const stripped = line.trim().replace(/^#+\s*/, "").trim();
    if (stripped) return stripped;
  }
  return fallback;
}

/** Everything after the first line, so a card can show its heading separately. */
export function mdBody(source: string | null | undefined): string {
  const lines = String(source || "").split("\n");
  let i = 0;
  while (i < lines.length && !lines[i].trim()) i++;
  return lines.slice(i + 1).join("\n");
}

/* Where mdBody's first character sits in the whole text. The reading view shows the
 * title and the body as two things and the writing view is one box holding both, so
 * putting the cursor where somebody clicked means adding back what mdBody dropped. */
export function mdBodyStart(source: string | null | undefined): number {
  const text = String(source || "");
  const lines = text.split("\n");
  let i = 0;
  while (i < lines.length && !lines[i].trim()) i++;
  if (i >= lines.length) return text.length;
  return lines.slice(0, i + 1).join("\n").length + 1;
}

export interface Span { text: string; b?: boolean; i?: boolean; s?: boolean; code?: boolean; href?: string }
export type Block =
  | { kind: "gap"; line: number }
  | { kind: "hr"; line: number }
  | { kind: "line"; line: number; spans: Span[] }
  | { kind: "quote"; line: number; spans: Span[] }
  | { kind: "ul"; line: number; spans: Span[] }
  | { kind: "ol"; line: number; spans: Span[] }
  | { kind: "h"; level: number; line: number; spans: Span[] };

/* Inline marks, as spans and never as markup: nothing a person typed can become a tag.
 * Code first, so nothing inside it is treated as emphasis; links only http and https,
 * so one cannot carry a javascript: payload. */
const INLINE = /`([^`]+)`|\*\*\*([^*]+)\*\*\*|\*\*([^*]+)\*\*|\*([^*\n]+)\*|(?<![A-Za-z0-9_])_([^_\n]+)_(?![A-Za-z0-9_])|~~([^~]+)~~|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;

export function mdInline(raw: string): Span[] {
  const out: Span[] = [];
  let last = 0;
  for (const m of raw.matchAll(INLINE)) {
    const at = m.index ?? 0;
    if (at > last) out.push({ text: raw.slice(last, at) });
    if (m[1] !== undefined) out.push({ text: m[1], code: true });
    else if (m[2] !== undefined) out.push({ text: m[2], b: true, i: true });
    else if (m[3] !== undefined) out.push({ text: m[3], b: true });
    else if (m[4] !== undefined) out.push({ text: m[4], i: true });
    else if (m[5] !== undefined) out.push({ text: m[5], i: true });
    else if (m[6] !== undefined) out.push({ text: m[6], s: true });
    else if (m[7] !== undefined) out.push({ text: m[7], href: m[8] });
    last = at + m[0].length;
  }
  if (last < raw.length) out.push({ text: raw.slice(last) });
  return out;
}

/* Lyrics need headings, emphasis, lists, quotes and rules, and every line break has to
 * survive: a verse is not a paragraph to be reflowed. Every block carries the line it
 * came from, because clicking into the words has to put the cursor where the click was
 * and the drawn text is not the written text. */
export function mdBlocks(source: string | null | undefined): Block[] {
  const out: Block[] = [];
  String(source ?? "").split("\n").forEach((raw, line) => {
    const text = raw.replace(/\s+$/, "");
    if (!text.trim()) { out.push({ kind: "gap", line }); return; }
    const heading = text.match(/^(#{1,6})\s+(.*)$/);
    if (heading) { out.push({ kind: "h", level: heading[1].length, line, spans: mdInline(heading[2]) }); return; }
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(text.trim())) { out.push({ kind: "hr", line }); return; }
    const quote = text.match(/^>\s?(.*)$/);
    if (quote) { out.push({ kind: "quote", line, spans: mdInline(quote[1]) }); return; }
    const bullet = text.match(/^\s*[-*+]\s+(.*)$/);
    if (bullet) { out.push({ kind: "ul", line, spans: mdInline(bullet[1]) }); return; }
    const numbered = text.match(/^\s*(\d+[.)])\s+(.*)$/);
    if (numbered) { out.push({ kind: "ol", line, spans: [{ text: numbered[1] + " " }, ...mdInline(numbered[2])] }); return; }
    // Every remaining line is its own line. Song words are broken where they are broken.
    out.push({ kind: "line", line, spans: mdInline(text) });
  });
  return out;
}
