// list.js: pure helpers for the Plugins page (no DOM). See /plugins.html.

/** Versions whose render brought a plugin list, in the given order. */
export function withPlugins(versions) {
  return (versions || []).filter((v) => Array.isArray(v.plugins) && v.plugins.length > 0);
}

/** The wanted version if it has plugins, else the current one, else the first with plugins, else null. */
export function pickVersion(versions, currentId, wantedId) {
  const have = withPlugins(versions);
  const byId = (id) => have.find((v) => String(v.id) === String(id));
  return (wantedId != null && byId(wantedId)) || (currentId != null && byId(currentId)) || have[0] || null;
}

const byName = (a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase());

/** VSTs and FL plugins as sorted groups; empty groups are dropped. */
export function groups(plugins) {
  const list = plugins || [];
  const out = [
    { title: "VSTs", items: list.filter((p) => p.kind === "vst3" || p.kind === "vst2").sort(byName) },
    { title: "FL plugins", items: list.filter((p) => p.kind === "fl").sort(byName) },
  ];
  return out.filter((g) => g.items.length > 0);
}

/** One line: "9 plugins, 2 missing on the PC that rendered it". */
export function summary(plugins) {
  const list = plugins || [];
  const n = list.length;
  let s = `${n} ${n === 1 ? "plugin" : "plugins"}`;
  const missing = list.filter((p) => p.installed === false).length;
  if (missing) s += `, ${missing} missing on the PC that rendered it`;
  return s;
}
