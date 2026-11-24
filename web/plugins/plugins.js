// plugins.js: the Plugins page. Everything is built with textContent, never HTML strings.
import { withPlugins, pickVersion, groups, summary } from "./list.js";

const app = document.getElementById("app");
const params = new URLSearchParams(location.search);
const songId = params.get("song");

function el(tag, props, ...kids) {
  const e = document.createElement(tag);
  Object.assign(e, props || {});
  if (props && props.tip) { e.setAttribute("data-tip", props.tip); e.setAttribute("aria-label", props.tip); }
  kids.flat().forEach((k) => e.append(k));
  return e;
}
async function api(path) {
  const r = await fetch(path, { credentials: "same-origin" });
  if (!r.ok) throw new Error(`${path}: ${r.status}`);
  return r.json();
}
const KIND = { vst3: "VST3", vst2: "VST2", fl: "FL" };

function row(p) {
  return el("li", {},
    el("span", { className: "grow", textContent: p.name }),
    p.vendor ? el("span", { className: "mute", textContent: p.vendor }) : "",
    el("span", { className: "tag", textContent: KIND[p.kind] || p.kind }),
    p.uses > 1 ? el("span", { className: "uses", textContent: `×${p.uses}` }) : "",
    p.installed === false
      ? el("span", { className: "tag warn", textContent: "missing here", tip: "Not installed on the PC that rendered it" })
      : "");
}

async function main() {
  if (!songId) { app.replaceChildren(el("p", { className: "mute", textContent: "Open this from a song." })); return; }
  const [{ song }, vdata] = await Promise.all([api(`/api/songs/${encodeURIComponent(songId)}`), api(`/api/songs/${encodeURIComponent(songId)}/versions`)]);
  const back = `/#/song/${encodeURIComponent(songId)}/takes`;
  const have = withPlugins(vdata.versions);
  let current = pickVersion(vdata.versions, vdata.current_version_id, params.get("version"));
  const head = [el("a", { className: "back", href: back, textContent: `← ${song.title || "Song"}` }), el("h1", { textContent: "Plugins" })];

  if (!current) {
    app.replaceChildren(...head, el("p", { className: "mute", textContent: "No render of this song brought a plugin list yet. Render it from FL with jriter-cli render." }));
    return;
  }
  const body = el("div", { className: "wrap" });
  const chips = el("div", { className: "chips", role: "group" });
  function draw() {
    chips.replaceChildren(...have.map((v) => el("button", {
      type: "button", textContent: `v${v.n}${v.label ? " " + v.label : ""}`,
      onclick: () => select(v),
    }, ) ));
    [...chips.children].forEach((b, i) => b.setAttribute("aria-pressed", String(have[i] === current)));
    body.replaceChildren(el("p", { className: "mute", textContent: summary(current.plugins) }),
      ...groups(current.plugins).map((g) => el("section", { className: "panel" }, el("h2", { textContent: g.title }), el("ul", { className: "tracks" }, g.items.map(row)))));
  }
  function select(v) {
    current = v;
    const u = new URL(location.href); u.searchParams.set("version", v.id); history.replaceState(null, "", u);
    draw();
  }
  app.replaceChildren(...head, chips, body);
  draw();
  document.addEventListener("keydown", (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || /INPUT|TEXTAREA/.test(e.target.tagName)) return;
    const i = have.indexOf(current);
    if (e.key === "j" || e.key === "ArrowRight") { if (i < have.length - 1) select(have[i + 1]); }
    else if (e.key === "k" || e.key === "ArrowLeft") { if (i > 0) select(have[i - 1]); }
    else if (e.key === "Escape") location.assign(back);
  });
}
main().catch((e) => app.replaceChildren(el("p", { className: "mute", textContent: `Could not load: ${e.message}` })));
