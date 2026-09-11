/* Draw the real timetable view, outside a browser, and print what it made.
 *
 * WHY THIS EXISTS. The alternative is to assert on the source text: that it says `h < TO`
 * and not `h <= TO`, that lanes() compares against `placed`. Those tests pass while the
 * page is wrong, because the spelling of arithmetic is not the arithmetic. Every position
 * on this grid is worked out from times, so the only honest question is where things
 * landed, and answering it means running the thing.
 *
 * WHY NOTHING IS EXPORTED TO MAKE THIS POSSIBLE. The view registers itself on J.views and
 * should stay that way; a seam cut into it for a test is a seam only the test uses. So this
 * hands it a J and a document instead, and reads what it wrote.
 *
 * A J SMALL ENOUGH TO DRAW WITH, and no smaller. The view uses esc, get, $ and sheet. If it
 * ever reaches for a sixth thing this fails at that line rather than quietly drawing half a
 * grid. Deliberately not a copy of the real helpers: esc here is four lines because what is
 * being tested is the layout, not the escaping.
 *
 *   node tests/orarend_render.js <path to a week as json>
 */
"use strict";

const fs = require("fs");
const path = require("path");

const SRC = path.join(__dirname, "..", "web", "js", "56-view-orarend.js");
const WEEK = process.argv[2];
if (!WEEK) {
  console.error("usage: node orarend_render.js <orarend.json>");
  process.exit(2);
}

const made = {};
const sheets = [];

function element(name) {
  const props = {};
  return {
    name,
    innerHTML: "",
    // Whatever the view publishes to the stylesheet, kept so a test can read it. The
    // grid's scale is set this way and the stylesheet draws its hour rows at it.
    style: {
      props,
      setProperty(key, value) { props[key] = String(value); },
      getPropertyValue(key) { return props[key] || ""; },
    },
    addEventListener() {},
  };
}

function reach(selector) {
  if (!made[selector]) made[selector] = element(selector);
  return made[selector];
}

const week = JSON.parse(fs.readFileSync(WEEK, "utf8"));
const served = Object.assign(
  { from: 8, to: 22, hour: 60 },
  week,
  { classes: week.classes || [] });

const J = {
  views: {},
  esc: (text) => String(text)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;"),
  async get(url) {
    if (url !== "/api/orarend") throw new Error("the view asked for " + url);
    return served;
  },
  $: reach,
  sheet(opts) { sheets.push(opts); return Promise.resolve(null); },
};

/* new Function rather than eval, so the source cannot see anything in this file except
 * what it is handed. Its own "use strict" is the first line of the body it makes. */
new Function("J", fs.readFileSync(SRC, "utf8"))(J);

if (!J.views.orarend) {
  console.error("56-view-orarend.js did not register J.views.orarend");
  process.exit(1);
}

const root = element("root");

J.views.orarend.render(root).then(() => {
  const grid = made["#ttGrid"];
  process.stdout.write(JSON.stringify({
    html: root.innerHTML,
    title: J.views.orarend.title,
    asked: Object.keys(made).sort(),
    set: grid ? grid.style.props : {},
  }));
}).catch((e) => {
  console.error("the view threw: " + (e && e.stack || e));
  process.exit(1);
});
