// Run the timetable's own layout sums (ui/src/views/orarend/week.ts) outside a browser and
// print what they decided.
//
// WHY THIS AND NOT A READ OF THE SOURCE. Every position on the grid is worked out from
// times, so the only honest question is where things landed, and answering it means running
// the arithmetic. week.ts is pure functions with nothing but erasable type annotations, so
// node can load it as it is (type stripping) and nothing is exported for the test's benefit.
//
//   node --experimental-strip-types tests/orarend_plan.mjs <a week as json> [who]
import { readFileSync } from "node:fs";
import {
  planDay, windowOf, peopleOf, whoColour, tidy, WHO, KIND_TAG, KIND_SAID, FIELDS,
} from "../ui/src/views/orarend/week.ts";

const input = JSON.parse(readFileSync(process.argv[2], "utf8"));
const who = process.argv[3] || "all";
const classes = input.classes.map((c, i) => tidy({ key: String(c.id ?? "i:" + i), ...c }));
const win = windowOf({ from: input.from, to: input.to }, classes);
const people = peopleOf(classes);
const slim = (p) => ({ key: p.entry.key, name: p.entry.name, kind: p.entry.kind, whose: p.entry.whose,
                       skip: !!p.entry.skip, at: p.at, runs: p.runs, lane: p.lane, inset: p.inset });
const days = [0, 1, 2, 3, 4].map((d) => {
  const plan = planDay(classes, d, who, win.from);
  return { day: d, lanes: plan.lanes, bands: plan.bands.map(slim), cards: plan.cards.map(slim),
           stripes: plan.stripes.map(slim), order: plan.order.map((e) => e.key) };
});
console.log(JSON.stringify({
  window: win, people, colours: people.map((p) => whoColour(people, p)), palette: WHO.length,
  kindTag: KIND_TAG, kindSaid: Object.keys(KIND_SAID), fields: [...FIELDS], days,
}));
