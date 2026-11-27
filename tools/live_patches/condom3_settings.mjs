// Condom 3 Settings bits for the hand-patched live bundle (web/assets/index-*.js on live-4.3.0):
// "Connected as @handle", the "Sign out everywhere" row, and the Foyer-untie wording.
// Usage: node tools/live_patches/condom3_settings.mjs <web dir>
// Renames the bundle to index-<sha256 first 8>.js and updates index.html. Safe to run twice.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const T = "`";
export const REPLACEMENTS = [
  ["Changing it signs every other device out; this one stays signed in.",
   "Changing it signs every other device out and unties Foyer; this one stays signed in."],
  ['<div class="ctl"><button class="btn sm"><!> Sign out</button></div></div>' + T + ",1),bM=",
   '<div class="ctl"><button class="btn sm"><!> Sign out</button></div></div> <div class="setting"><div class="what"><div class="t">Sign out everywhere</div> <div class="s">Every device, this one too, and Foyer is untied.</div></div> <div class="ctl"><button class="btn sm"><!> Everywhere</button></div></div>' + T + ",1),bM="],
  ["bM=z(" + T + '<div class="t">Connected</div> <div class="s">Signing in on Foyer opens this library.</div>' + T + ",1)",
   "bM=z(" + T + '<div class="t"> </div> <div class="s">Signing in on Foyer opens this library. A password change or signing out everywhere ends it.</div>' + T + ",1)"],
  ["i=e=>{var t=bM();O(2),B(e,t)}",
   "i=e=>{var t=bM(),n=P(N(t));O(2),I(()=>V(n," + T + "Connected${a.data.foyer_tied_as?" + T + " as @${a.data.foyer_tied_as}" + T + ":" + T + T + "}" + T + ")),B(e,t)}"],
  ["var o=F(r,2),s=F(M(o),2),c=M(s);Y(M(c),{name:" + T + "logout" + T + ",size:14}),O(),D(c),D(s),D(o),",
   "var o=F(r,2),s=F(M(o),2),c=M(s);Y(M(c),{name:" + T + "logout" + T + ",size:14}),O(),D(c),D(s),D(o);var jrU=F(o,2),jrD=F(M(jrU),2),jrF=M(jrD);Y(M(jrF),{name:" + T + "logout" + T + ",size:14}),O(),D(jrF),D(jrD),D(jrU),R(" + T + "click" + T + ",jrF,function(...e){jrEverywhere?.apply(this,e)}),"],
  ["async function cM(){await mo(" + T + "/api/auth/logout" + T + ").catch(()=>null),location.href=" + T + "/login" + T + "}",
   "async function cM(){await mo(" + T + "/api/auth/logout" + T + ").catch(()=>null),location.href=" + T + "/login" + T + "}async function jrEverywhere(){await Bl(" + T + "Sign out everywhere?" + T + "," + T + "Every device is signed out, this one too, and Foyer stops opening this library until you connect it again." + T + "," + T + "Sign out everywhere" + T + "," + T + "Keep me in" + T + ")&&(await mo(" + T + "/api/auth/everywhere" + T + ").catch(()=>null),location.href=" + T + "/login" + T + ")}"],
  ["Every signed in device is signed out when it changes; this one stays in.",
   "Every signed in device is signed out when it changes, and Foyer is untied; this one stays in."],
  ["Password changed. Other devices will have to sign in again.",
   "Password changed. Other devices will have to sign in again, and Foyer is untied."],
];

export function patch(src) {
  if (src.includes("jrEverywhere")) return src;
  let out = src;
  for (const [from, to] of REPLACEMENTS) {
    const n = out.split(from).length - 1;
    if (n !== 1) throw new Error(`expected exactly one match, found ${n}: ${from.slice(0, 70)}`);
    out = out.replace(from, () => to);
  }
  return out;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const web = process.argv[2];
  if (!web) { console.error("usage: node condom3_settings.mjs <web dir>"); process.exit(2); }
  const indexPath = path.join(web, "index.html");
  const html = fs.readFileSync(indexPath, "utf8");
  const m = html.match(/\/assets\/(index-[A-Za-z0-9_-]+\.js)/);
  if (!m) throw new Error("no bundle named in index.html");
  const oldPath = path.join(web, "assets", m[1]);
  const src = fs.readFileSync(oldPath, "utf8");
  const out = patch(src);
  if (out === src) { console.log("already patched"); process.exit(0); }
  const name = "index-" + crypto.createHash("sha256").update(out).digest("hex").slice(0, 8) + ".js";
  fs.writeFileSync(path.join(web, "assets", name), out);
  fs.unlinkSync(oldPath);
  fs.writeFileSync(indexPath, html.replace(m[1], name));
  console.log(m[1] + " -> " + name);
}
