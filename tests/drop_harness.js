/* Run the real drop handler outside a browser and report what it did.
 *
 * WHY A HARNESS AND NOT A READ OF THE SOURCE. This is upload code: what matters is which
 * files it sends, how many times, in what order, and what it does with the ones it will
 * not send. None of that is visible in the spelling of the module, and all of it is
 * visible in a list of calls.
 *
 * The document is a stub with exactly what 26-drop.js uses: addEventListener, an element
 * factory and a body to put one in. If it ever reaches for a sixth thing this fails at
 * that line rather than quietly doing half the job.
 *
 *   node tests/drop_harness.js '<a script of events as JSON>'
 */
"use strict";

const fs = require("fs");
const path = require("path");

const SRC = path.join(__dirname, "..", "web", "js", "26-drop.js");
const script = JSON.parse(process.argv[2] || "{}");

const listeners = {};
const body = { children: [], appendChild(node) { this.children.push(node); } };

function element() {
  const node = {
    className: "",
    innerHTML: "",
    type: "",
    multiple: false,
    accept: "",
    files: [],
    clicked: 0,
    remove() { body.children = body.children.filter((c) => c !== node); },
    addEventListener(name, fn) { node["on" + name] = fn; },
    click() { node.clicked += 1; },
  };
  return node;
}

globalThis.document = {
  body,
  addEventListener(name, fn) { listeners[name] = fn; },
  createElement: element,
};
globalThis.location = { hash: script.hash || "#/library" };

const done = { uploaded: [], toasts: [], emitted: [], reloaded: 0 };

const J = {
  state: { audio: [".mp3", ".wav", ".flac"] },
  toast(said, kind) { done.toasts.push(kind ? said + " [" + kind + "]" : said); },
  emit(name) { done.emitted.push(name); },
  router: { reload() { done.reloaded += 1; } },
  async upload(where, file, headers) {
    done.uploaded.push({ where, name: file.name, origin: headers && headers["X-Origin"] });
    const answer = (script.answers || {})[file.name];
    if (answer === "fail") throw new Error("the server said no");
    return { added: answer !== "already" };
  },
};

new Function("J", fs.readFileSync(SRC, "utf8"))(J);

/* A drag carrying files, as the browser hands one over. `types` is what the handler is
 * allowed to look at before a drop: the files themselves are not readable until then. */
const carrying = (names) => ({
  types: ["Files"],
  files: (names || []).map((name) => ({ name })),
});

(async () => {
  for (const step of (script.steps || [])) {
    const event = {
      dataTransfer: step.files === null ? null : carrying(step.files),
      prevented: false,
      preventDefault() { this.prevented = true; },
    };
    if (step.plain) event.dataTransfer = { types: ["text/plain"], files: [] };
    const fn = listeners[step.event];
    if (!fn) throw new Error("nothing is listening for " + step.event);
    await fn(event);
    done[step.event + "Prevented"] = event.prevented;
    if (step.then === "look") {
      done.overlays = body.children.length;
      done.said = (body.children[0] || {}).innerHTML || "";
    }
  }
  // Settle whatever the drop started.
  await new Promise((r) => setTimeout(r, 20));
  done.overlaysAtEnd = body.children.length;
  process.stdout.write(JSON.stringify(done));
})().catch((e) => {
  console.error("the drop handler threw: " + (e && e.stack || e));
  process.exit(1);
});
