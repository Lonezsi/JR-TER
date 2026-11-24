import test from "node:test";
import assert from "node:assert/strict";
import { withPlugins, pickVersion, groups, summary } from "../../web/plugins/list.js";

const P = (kind, name, extra) => ({ kind, name, vendor: "", uses: 1, ...extra });
const vs = [
  { id: 3, plugins: [] },
  { id: 2, plugins: [P("vst3", "Serum")] },
  { id: 1, plugins: [P("fl", "Fruity EQ")] },
];

test("withPlugins keeps only versions with a list", () => {
  assert.deepEqual(withPlugins(vs).map((v) => v.id), [2, 1]);
  assert.deepEqual(withPlugins(null), []);
});

test("pickVersion falls back wanted, current, first, null", () => {
  assert.equal(pickVersion(vs, 3, 1).id, 1);
  assert.equal(pickVersion(vs, 2, 3).id, 2);
  assert.equal(pickVersion(vs, 3, null).id, 2);
  assert.equal(pickVersion([{ id: 1, plugins: [] }], 1, 1), null);
});

test("groups split, sort and drop empties", () => {
  const g = groups([P("fl", "b"), P("vst2", "Zed"), P("vst3", "alpha")]);
  assert.deepEqual(g.map((x) => x.title), ["VSTs", "FL plugins"]);
  assert.deepEqual(g[0].items.map((p) => p.name), ["alpha", "Zed"]);
  assert.deepEqual(groups([P("fl", "x")]).map((x) => x.title), ["FL plugins"]);
});

test("summary counts and mentions missing", () => {
  assert.equal(summary([P("fl", "x")]), "1 plugin");
  assert.equal(summary([P("vst3", "a", { installed: false }), P("vst3", "b", { installed: true })]),
    "2 plugins, 1 missing on the PC that rendered it");
});
