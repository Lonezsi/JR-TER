// Look 3: does a built ui/ (a web/ folder) carry every change that used to be a hand patch?
// Usage: node tools/look3_check.mjs <web-dir>     Exit 1 if anything is missing.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// [name, where ("js" | "css" | "html"), text that must be in it]
export const MARKERS = [
  ["Release button (album page)", "js", "/release.html?album="],
  ["Release in the album menu", "js", "Release to RouteNote"],
  ["DAW tab", "js", "value:`daw`"],
  ["DAW tab goes to the DAW page", "js", "/daw.html?song="],
  ["Open in the DAW (a take)", "js", "&version="],
  ["Open in the DAW needs has_daw", "js", "has_daw"],
  ["Open the DAW (New menu)", "js", "Open the DAW"],
  ["Sticker clip", "css", "clip-path:inset(0 round"],
  ["Plugins tab", "js", "Plugins this song used"],
  ["Connected as @handle", "js", "foyer_tied_as"],
  ["Watch is https-only", "js", String.raw`/^https:\/\/[^\s/]/i.test(`],
  ["Join notice (16 and over)", "js", "Accounts are for people 16 and over."],
  ["Fonts are ours", "html", "/fonts/fonts.css"],
];

export function check(webDir) {
  const html = fs.readFileSync(path.join(webDir, "index.html"), "utf8");
  const read = (re) => {
    const m = re.exec(html);
    return m ? fs.readFileSync(path.join(webDir, m[1]), "utf8") : "";
  };
  const text = {
    html,
    js: read(/src="\/(assets\/index-[\w-]+\.js)"/),
    css: read(/href="\/(assets\/index-[\w-]+\.css)"/),
  };
  const out = MARKERS.map(([name, where, needle]) => [name, text[where].includes(needle)]);
  out.push(["No Google Fonts link", !html.includes("fonts.googleapis.com")]);
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const res = check(process.argv[2] || "web");
  for (const [name, ok] of res) console.log((ok ? "ok      " : "MISSING ") + name);
  process.exit(res.every(([, ok]) => ok) ? 0 : 1);
}
