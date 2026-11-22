// script.js: a small language for editing MIDI notes. Pure functions, no DOM, no eval:
// scripts are read by the parser below and run by the evaluator below, so a script from a
// friend's song file can do nothing but move notes around.
//
//   # a comment
//   param amount = 25 [0..100]        a number the page turns into a slider
//   each note:                        run the indented lines once per note
//     start += rand(-1, 1) * amount / 2000
//   each chord:                       run them once per chord (notes starting together)
//     arp up step 1/16n octaves 2
//
// Fields (read and write): pitch  start  length  velocity   (start and length are in beats)
// Read only: index  count  bar (start / 4, floored)  size (notes in the chord)
// Numbers: 1/16n is a note value (a sixteenth = 0.25 beats; 1/12n is a triplet eighth).
// Operators: + - * / %   < > <= >= == !=   and  or  not   ( )
// Functions: rand(a,b)  round(x[,step])  floor  ceil  abs  min  max  clamp(x,lo,hi)  choose(a,b,...)
// Top-level lines (before or between blocks):
//   scale minor D                         a scale for snap/shift/degree (names below; root C..B, # or b)
//   use "Kick" as kick                    read another track of the song by name (see Track functions)
// Scale functions: snap(p) nearest pitch in the scale; shift(p, n) move n scale steps; degree(p) 1-based, 0 if outside
//   Scales: major minor dorian phrygian lydian mixolydian locrian harmonic melodic pentatonic minorpent blues chromatic
// Track functions (T is a name from a use line; "this note" is the lowest note of the block):
//   playing(T) 1 if a note of T sounds at this note's start    starts(T) 1 if one starts there
//   lowest(T) / highest(T) pitch sounding there, or -1
// Statements (one per line):
//   field = expr        += -= *= /=       (in a chord block they apply to every note of it)
//   name = expr                           your own variable, for the rest of this run
//   if expr: statement                    one line
//   delete                                remove the note
//   arp PATTERN step expr [octaves expr] [gate expr]    (chord only)
//        PATTERN: up down updown downup inward random, or an order in quotes like "1 3 2 4"
//   strum expr                            offset a chord's notes low to high by expr beats
//   euclid HITS of STEPS step expr [rotate expr]
//        repeat the notes at an even spread of HITS in STEPS (3 of 8 is x..x..x.), one step long each

const FIELDS = ["pitch", "start", "length", "velocity"];
const GROUP_EPS = 1 / 64;

export class ScriptError extends Error {
  constructor(message, line) { super(line ? "line " + line + ": " + message : message); this.line = line || 0; this.detail = message; }
}

// ---- expressions: text -> a function of the environment ---------------------------------
function tokenize(text, line) {
  const out = [];
  const re = /\s*(?:(\d+\/\d+n)|(\d+\.?\d*|\.\d+)|("[^"]*")|([A-Za-z_]\w*)|(<=|>=|==|!=|[-+*/%(),<>]))/y;
  let i = 0;
  while (i < text.length) {
    re.lastIndex = i;
    const m = re.exec(text);
    if (!m) { if (/^\s*$/.test(text.slice(i))) break; throw new ScriptError("I can't read " + JSON.stringify(text.slice(i).trim().slice(0, 12)), line); }
    i = re.lastIndex;
    if (m[1]) { const [a, b] = m[1].slice(0, -1).split("/").map(Number); out.push({ t: "num", v: (4 * a) / b }); }
    else if (m[2]) out.push({ t: "num", v: Number(m[2]) });
    else if (m[3]) out.push({ t: "str", v: m[3].slice(1, -1) });
    else if (m[4]) out.push({ t: "id", v: m[4] });
    else out.push({ t: "op", v: m[5] });
  }
  return out;
}

const FUNCS = {
  rand: (E, a = 0, b = 1) => a + E.rng() * (b - a),
  round: (E, x, step) => (step ? Math.round(x / step) * step : Math.round(x)),
  floor: (E, x) => Math.floor(x), ceil: (E, x) => Math.ceil(x), abs: (E, x) => Math.abs(x),
  min: (E, ...a) => Math.min(...a), max: (E, ...a) => Math.max(...a),
  clamp: (E, x, lo, hi) => Math.min(hi, Math.max(lo, x)),
  choose: (E, ...a) => a[Math.floor(E.rng() * a.length)],
  snap: (E, p) => snapTo(E.scale, p),
  shift: (E, p, n) => shiftBy(E.scale, p, n),
  degree: (E, p) => { const i = E.scale.pcs.indexOf(((Math.round(p) % 12) + 12) % 12); return i < 0 ? 0 : i + 1; },
  playing: (E, h) => (soundingAt(E, h).length ? 1 : 0),
  starts: (E, h) => { const s = E.first().start; return (E.uses[h] || []).some((n) => Math.abs(n.start - s) <= GROUP_EPS) ? 1 : 0; },
  lowest: (E, h) => { const a = soundingAt(E, h); return a.length ? Math.min(...a.map((n) => n.pitch)) : -1; },
  highest: (E, h) => { const a = soundingAt(E, h); return a.length ? Math.max(...a.map((n) => n.pitch)) : -1; },
};
function soundingAt(E, h) {
  const s = E.first().start;
  return (E.uses[h] || []).filter((n) => n.start <= s + GROUP_EPS && n.start + n.length > s + GROUP_EPS);
}

// ---- scales -------------------------------------------------------------------------------
export const SCALES = {
  major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10], dorian: [0, 2, 3, 5, 7, 9, 10], phrygian: [0, 1, 3, 5, 7, 8, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11], mixolydian: [0, 2, 4, 5, 7, 9, 10], locrian: [0, 1, 3, 5, 6, 8, 10], harmonic: [0, 2, 3, 5, 7, 8, 11],
  melodic: [0, 2, 3, 5, 7, 9, 11], pentatonic: [0, 2, 4, 7, 9], minorpent: [0, 3, 5, 7, 10], blues: [0, 3, 5, 6, 7, 10],
  chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
};
const ROOTS = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
export function makeScale(name = "chromatic", root = "C", line = 0) {
  const steps = SCALES[name];
  if (!steps) throw new ScriptError("there is no scale " + name + ". Try: " + Object.keys(SCALES).join(", "), line);
  const m = /^([A-Ga-g])([#b]?)$/.exec(root);
  if (!m) throw new ScriptError("a scale root is a note like C, F# or Bb", line);
  const r = (ROOTS[m[1].toLowerCase()] + (m[2] === "#" ? 1 : m[2] === "b" ? 11 : 0)) % 12;
  return { name, root: r, pcs: steps.map((x) => (x + r) % 12) };
}
const inScale = (sc, p) => sc.pcs.includes(((p % 12) + 12) % 12);
function snapTo(sc, p) {
  p = Math.round(p);
  for (let d = 0; d < 12; d++) { if (inScale(sc, p - d)) return p - d; if (inScale(sc, p + d)) return p + d; }
  return p;
}
function shiftBy(sc, p, n) {
  p = snapTo(sc, p);
  const dir = n < 0 ? -1 : 1;
  for (let k = Math.abs(Math.round(n)); k > 0; k--) { do p += dir; while (!inScale(sc, p)); }
  return p;
}

// ---- euclid: which of `steps` slots get a hit --------------------------------------------
export function euclid(hits, steps, rotate = 0) {
  steps = Math.max(1, Math.min(64, Math.round(steps)));
  hits = Math.max(0, Math.min(steps, Math.round(hits)));
  const r = Math.round(rotate);
  return Array.from({ length: steps }, (_, k) => (((((k + r) % steps) + steps) % steps) * hits) % steps < hits);
}

function compileExpr(text, line) {
  const toks = tokenize(text, line);
  let p = 0;
  const peek = () => toks[p];
  const isOp = (v) => peek() && peek().t === "op" && peek().v === v;
  const isId = (v) => peek() && peek().t === "id" && peek().v === v;
  const fail = (m) => { throw new ScriptError(m, line); };

  function or() { let l = and(); while (isId("or")) { p++; const a = l, b = and(); l = (E) => (a(E) || b(E) ? 1 : 0); } return l; }
  function and() { let l = not(); while (isId("and")) { p++; const a = l, b = not(); l = (E) => (a(E) && b(E) ? 1 : 0); } return l; }
  function not() { if (isId("not")) { p++; const a = not(); return (E) => (a(E) ? 0 : 1); } return cmp(); }
  function cmp() {
    let l = add();
    while (peek() && peek().t === "op" && ["<", ">", "<=", ">=", "==", "!="].includes(peek().v)) {
      const op = toks[p++].v, a = l, b = add();
      l = (E) => { const x = a(E), y = b(E); return (op === "<" ? x < y : op === ">" ? x > y : op === "<=" ? x <= y : op === ">=" ? x >= y : op === "==" ? x === y : x !== y) ? 1 : 0; };
    }
    return l;
  }
  function add() {
    let l = mul();
    while (isOp("+") || isOp("-")) { const op = toks[p++].v, a = l, b = mul(); l = op === "+" ? (E) => a(E) + b(E) : (E) => a(E) - b(E); }
    return l;
  }
  function mul() {
    let l = unary();
    while (isOp("*") || isOp("/") || isOp("%")) {
      const op = toks[p++].v, a = l, b = unary();
      l = op === "*" ? (E) => a(E) * b(E) : op === "/" ? (E) => { const d = b(E); return d === 0 ? 0 : a(E) / d; } : (E) => { const d = b(E); return d === 0 ? 0 : a(E) % d; };
    }
    return l;
  }
  function unary() { if (isOp("-")) { p++; const a = unary(); return (E) => -a(E); } return primary(); }
  function primary() {
    const t = toks[p++];
    if (!t) fail("the expression ends too soon");
    if (t.t === "num") return () => t.v;
    if (t.t === "str") fail("text is only for arp patterns");
    if (t.t === "op" && t.v === "(") { const e = or(); if (!isOp(")")) fail("missing )"); p++; return e; }
    if (t.t === "id") {
      if (isOp("(")) {
        p++;
        const args = [];
        if (!isOp(")")) { do { if (isOp(",")) p++; args.push(or()); } while (isOp(",")); }
        if (!isOp(")")) fail("missing ) after " + t.v);
        p++;
        const f = FUNCS[t.v];
        if (!f) fail("there is no function " + t.v);
        return (E) => f(E, ...args.map((a) => a(E)));
      }
      return (E) => E.get(t.v);
    }
    return fail("unexpected " + t.v);
  }
  const e = or();
  if (p < toks.length) fail("unexpected " + toks[p].v);
  return e;
}

// ---- statements ---------------------------------------------------------------------------
function compileStatement(text, line, kind) {
  let m;
  if ((m = /^if\s+(.+?)\s*:\s*(.+)$/.exec(text))) {
    const cond = compileExpr(m[1], line), body = compileStatement(m[2], line, kind);
    return { line, run: (E, ctx) => { if (cond(E)) body.run(E, ctx); } };
  }
  if (text === "delete") return { line, run: (E, ctx) => { ctx.deleted = true; } };
  if ((m = /^strum\s+(.+)$/.exec(text))) {
    if (kind !== "chord") throw new ScriptError("strum only works inside 'each chord:'", line);
    const amount = compileExpr(m[1], line);
    return { line, run: (E, ctx) => { const gap = amount(E); [...ctx.notes].sort((a, b) => a.pitch - b.pitch).forEach((n, i) => { n.start += i * gap; n.length = Math.max(1 / 64, n.length - i * gap); }); } };
  }
  if ((m = /^euclid\s+(.+?)\s+of\s+(.+?)\s+step\s+(.+?)(?:\s+rotate\s+(.+))?$/.exec(text))) {
    const hits = compileExpr(m[1], line), total = compileExpr(m[2], line), step = compileExpr(m[3], line), rot = m[4] ? compileExpr(m[4], line) : () => 0;
    return {
      line,
      run: (E, ctx) => {
        const dur = step(E);
        if (!(dur > 0)) throw new ScriptError("the euclid step must be more than 0", line);
        const pat = euclid(hits(E), total(E), rot(E));
        const start0 = Math.min(...ctx.notes.map((x) => x.start)), end = Math.max(...ctx.notes.map((x) => x.start + x.length));
        const slots = Math.max(1, Math.floor((end - start0) / dur + 1e-6)), made = [];
        for (let k = 0; k < slots; k++) {
          if (!pat[k % pat.length]) continue;
          for (const n of ctx.notes) made.push({ pitch: n.pitch, start: start0 + k * dur, length: Math.max(1 / 64, dur * 0.9), velocity: n.velocity });
        }
        ctx.replace = made;
      },
    };
  }
  if ((m = /^arp\s+("[^"]*"|\w+)\s+(step\b.*)$/.exec(text))) {
    if (kind !== "chord") throw new ScriptError("arp only works inside 'each chord:'", line);
    return compileArp(m[1], m[2], line);
  }
  if ((m = /^([A-Za-z_]\w*)\s*(\+=|-=|\*=|\/=|=)\s*(.+)$/.exec(text))) {
    const name = m[1], op = m[2], value = compileExpr(m[3], line);
    const isField = FIELDS.includes(name);
    if (["index", "count", "bar", "size"].includes(name)) throw new ScriptError(name + " can only be read", line);
    return {
      line,
      run: (E, ctx) => {
        const v = value(E);
        if (!isField) { E.locals[name] = op === "=" ? v : apply(op, E.locals[name] ?? 0, v); return; }
        for (const n of ctx.notes) n[name] = op === "=" ? v : apply(op, n[name], v);
      },
    };
  }
  throw new ScriptError("I don't know what to do with " + JSON.stringify(text.slice(0, 24)), line);
}
const apply = (op, a, b) => (op === "+=" ? a + b : op === "-=" ? a - b : op === "*=" ? a * b : b === 0 ? a : a / b);

function compileArp(patternText, rest, line) {
  const pattern = patternText.startsWith('"') ? patternText.slice(1, -1) : patternText;
  const named = ["up", "down", "updown", "downup", "inward", "random"];
  if (!patternText.startsWith('"') && !named.includes(pattern)) throw new ScriptError("arp pattern '" + pattern + "' is not one of " + named.join(", ") + " or a quoted order like \"1 3 2 4\"", line);
  let order = null;
  if (patternText.startsWith('"')) {
    order = pattern.split(/\s+/).filter(Boolean).map(Number);
    if (!order.length || order.some((n) => !(n >= 1) || n !== Math.floor(n))) throw new ScriptError("an arp order is numbers from 1, like \"1 3 2 4\"", line);
  }
  // "step X [octaves Y] [gate Z]" in either order. Only the first octaves and the first gate
  // count as keywords, so a parameter called octaves can be used as the value.
  const body = rest.replace(/^step\b/, "");
  const marks = ["octaves", "gate"].map((kw) => ({ kw, i: body.search(new RegExp("\\b" + kw + "\\b")) })).filter((m) => m.i >= 0).sort((x, y) => x.i - y.i);
  const stepText = body.slice(0, marks.length ? marks[0].i : body.length);
  const part = {};
  marks.forEach((m, k) => { part[m.kw] = body.slice(m.i + m.kw.length, k + 1 < marks.length ? marks[k + 1].i : body.length); });
  const gateText = part.gate ?? null, octText = part.octaves ?? null;
  const step = compileExpr(stepText, line);
  const octs = octText === null ? () => 1 : compileExpr(octText, line);
  const gate = gateText === null ? () => 0.9 : compileExpr(gateText, line);

  return {
    line,
    run: (E, ctx) => {
      const src = [...ctx.notes].sort((a, b) => a.pitch - b.pitch);
      const dur = step(E);
      if (!(dur > 0)) throw new ScriptError("the arp step must be more than 0", line);
      const g = Math.min(1, Math.max(0.05, gate(E))), o = Math.max(1, Math.min(6, Math.round(octs(E))));
      const base = [];
      for (let k = 0; k < o; k++) for (const n of src) base.push({ pitch: n.pitch + 12 * k, velocity: n.velocity });
      const n = base.length;
      let seq;
      if (order) seq = order.map((i) => { const j = (i - 1) % src.length, up = Math.floor((i - 1) / src.length); return { pitch: src[j].pitch + 12 * up, velocity: src[j].velocity }; });
      else if (pattern === "up") seq = base;
      else if (pattern === "down") seq = [...base].reverse();
      else if (pattern === "updown") seq = n > 1 ? [...base, ...base.slice(1, -1).reverse()] : base;
      else if (pattern === "downup") seq = n > 1 ? [...[...base].reverse(), ...base.slice(1, -1)] : base;
      else if (pattern === "inward") { seq = []; for (let a = 0, b = n - 1; a <= b; a++, b--) { seq.push(base[a]); if (a !== b) seq.push(base[b]); } }
      else seq = null; // random
      const start0 = Math.min(...src.map((x) => x.start));
      const end = Math.max(...src.map((x) => x.start + x.length));
      const count = Math.max(1, Math.floor((end - start0) / dur + 1e-6));
      const made = [];
      for (let k = 0; k < count; k++) {
        const pick = seq ? seq[k % seq.length] : base[Math.floor(E.rng() * n)];
        made.push({ pitch: pick.pitch, start: start0 + k * dur, length: Math.max(1 / 64, dur * g), velocity: pick.velocity });
      }
      ctx.replace = made;
    },
  };
}

// A # starts a comment at the line start or after a space, never inside quotes (so F# and "Drum #1" survive).
function stripComment(raw) {
  let q = false;
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === '"') q = !q;
    else if (raw[i] === "#" && !q && (i === 0 || /\s/.test(raw[i - 1]))) return raw.slice(0, i);
  }
  return raw;
}

// ---- the whole script --------------------------------------------------------------------
export function parseScript(code) {
  const lines = String(code).split("\n").map((raw, i) => {
    const body = stripComment(raw);
    return { n: i + 1, indent: body.length - body.trimStart().length, text: body.trim() };
  }).filter((l) => l.text);
  const params = [], blocks = [], uses = [];
  let scale = makeScale();
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    let m;
    if ((m = /^param\s+(\w+)\s*=\s*(-?\d*\.?\d+)\s*(?:\[\s*(-?\d*\.?\d+)\s*\.\.\s*(-?\d*\.?\d+)\s*\])?$/.exec(l.text))) {
      const value = Number(m[2]);
      params.push({ name: m[1], value, min: m[3] === undefined ? Math.min(0, value) : Number(m[3]), max: m[4] === undefined ? Math.max(1, value * 2) : Number(m[4]) });
    } else if ((m = /^scale\s+(\w+)(?:\s+(\S+))?$/.exec(l.text))) {
      scale = makeScale(m[1], m[2] || "C", l.n);
    } else if ((m = /^use\s+"([^"]+)"\s+as\s+([A-Za-z_]\w*)$/.exec(l.text))) {
      if (uses.some((u) => u.alias === m[2])) throw new ScriptError(m[2] + " is already used", l.n);
      uses.push({ track: m[1], alias: m[2] });
    } else if ((m = /^each\s+(note|chord)\s*:$/.exec(l.text))) {
      const body = [];
      while (i + 1 < lines.length && lines[i + 1].indent > l.indent) { i++; body.push(compileStatement(lines[i].text, lines[i].n, m[1])); }
      if (!body.length) throw new ScriptError("'each " + m[1] + ":' needs indented lines under it", l.n);
      blocks.push({ kind: m[1], body, line: l.n });
    } else if (/^(scale|use)\b/.test(l.text)) {
      throw new ScriptError(l.text.startsWith("use") ? "a use line looks like: use \"Kick\" as kick" : "a scale line looks like: scale minor D", l.n);
    } else if (/^param\b/.test(l.text)) {
      throw new ScriptError("a param looks like: param amount = 25 [0..100]", l.n);
    } else {
      throw new ScriptError("put statements under 'each note:' or 'each chord:'", l.n);
    }
  }
  return { params, blocks, scale, uses };
}

export function run(code, notes, { values = {}, rng = Math.random, tracks = {} } = {}) {
  const prog = parseScript(code);
  const byName = new Map(Object.entries(tracks).map(([k, v]) => [k.toLowerCase(), v]));
  const uses = prog.uses.map((u) => {
    if (!byName.has(u.track.toLowerCase())) throw new ScriptError('there is no track called "' + u.track + '"');
    return byName.get(u.track.toLowerCase());
  });
  const handles = Object.create(null);
  prog.uses.forEach((u, i) => { handles[u.alias] = i; });
  const pv = Object.create(null); // no prototype: a script must not reach "constructor"
  for (const p of prog.params) pv[p.name] = Number.isFinite(values[p.name]) ? values[p.name] : p.value;
  let cur = notes.map((n) => ({ ...n }));
  for (const block of prog.blocks) {
    cur.sort((a, b) => a.start - b.start || a.pitch - b.pitch);
    let groups;
    if (block.kind === "note") groups = cur.map((n) => [n]);
    else {
      groups = [];
      for (const n of cur) {
        const g = groups[groups.length - 1];
        if (g && Math.abs(n.start - g[0].start) <= GROUP_EPS) g.push(n); else groups.push([n]);
      }
    }
    const next = [];
    groups.forEach((notesOfGroup, index) => {
      const ctx = { notes: notesOfGroup, deleted: false, replace: null };
      const E = {
        rng, locals: Object.create(null), scale: prog.scale, uses,
        first: () => [...ctx.notes].sort((a, b) => a.pitch - b.pitch)[0],
        get(name) {
          if (name in E.locals) return E.locals[name];
          if (name in pv) return pv[name];
          if (name in handles) return handles[name];
          const first = E.first();
          if (FIELDS.includes(name)) return first[name];
          if (name === "index") return index;
          if (name === "count") return groups.length;
          if (name === "size") return ctx.notes.length;
          if (name === "bar") return Math.floor(first.start / 4);
          throw new Error("there is nothing called " + name);
        },
      };
      for (const st of block.body) {
        try { st.run(E, ctx); } catch (e) { throw e instanceof ScriptError ? e : new ScriptError(e.message, st.line); }
        if (ctx.deleted || ctx.replace) break;
      }
      if (ctx.deleted) return;
      next.push(...(ctx.replace || ctx.notes));
    });
    cur = next;
  }
  return cur.map((n) => ({
    pitch: Math.min(127, Math.max(0, Math.round(n.pitch))),
    start: Math.max(0, n.start),
    length: Math.max(1 / 64, n.length),
    velocity: Math.min(127, Math.max(1, Math.round(n.velocity))),
  })).sort((a, b) => a.start - b.start || a.pitch - b.pitch);
}

// ---- what every song starts with ---------------------------------------------------------
export const DEFAULT_SCRIPTS = [
  { name: "Humanize", values: {}, code: [
    "# Humanize: nudge each note's timing, loudness and length by a small random amount.",
    "# amount 0 changes nothing. 100 is very loose. Run it again for a different feel.",
    "param amount = 25 [0..100]",
    "each note:",
    "  start += rand(-1, 1) * amount / 2000",
    "  velocity += rand(-1, 1) * amount / 4",
    "  length *= 1 + rand(-1, 1) * amount / 1000",
  ].join("\n") },
  { name: "Arp: up, 16ths", values: {}, code: [
    "# Arpeggio: each chord becomes its notes played one after another, low to high,",
    "# a sixteenth apart, for as long as the chord lasted. octaves stacks higher copies.",
    "param octaves = 1 [1..3]",
    "each chord:",
    "  arp up step 1/16n octaves octaves",
  ].join("\n") },
  { name: "Arp: down, short 8ths", values: {}, code: [
    "# Arpeggio: high to low, eighth notes, each cut short (gate 0.5 = half of the step).",
    "each chord:",
    "  arp down step 1/8n gate 0.5",
  ].join("\n") },
  { name: "Arp: up-down triplets", values: {}, code: [
    "# Arpeggio: up and back down in triplet eighths (1/12n), over two octaves.",
    "each chord:",
    "  arp updown step 1/12n octaves 2",
  ].join("\n") },
  { name: "Arp: 1-3-2-4 pattern", values: {}, code: [
    "# Arpeggio from your own order: the numbers are the chord's notes, lowest is 1.",
    "# Change the quoted order to anything, like \"1 2 3 2\" or \"4 1 3 1\".",
    "each chord:",
    "  arp \"1 3 2 4\" step 1/16n",
  ].join("\n") },
  { name: "Strum", values: {}, code: [
    "# Strum: each chord's notes start a little after each other, low to high.",
    "# ms is the gap between notes. (The gap is worked out as beats at 120 bpm.)",
    "param ms = 30 [0..120]",
    "each chord:",
    "  strum ms / 1000 * 2",
  ].join("\n") },
  { name: "Euclid: 3 of 8", values: {}, code: [
    "# Euclid: each chord is hit at an even spread of hits in 8 sixteenth steps.",
    "# 3 of 8 is x..x..x. Try 5 of 8 for a busier groove.",
    "param hits = 3 [1..8]",
    "each chord:",
    "  euclid hits of 8 step 1/16n",
  ].join("\n") },
  { name: "Snap to scale", values: {}, code: [
    "# Snap to scale: every note moves to the nearest note of the scale.",
    "# Change the scale line: minor, major, dorian, blues, pentatonic... and a root like D or F#.",
    "scale minor A",
    "each note:",
    "  pitch = snap(pitch)",
  ].join("\n") },
  { name: "Duck under the kick", values: {}, code: [
    "# Duck: notes that start together with a note of the Kick track get quieter.",
    "# Needs a track called Kick. Change the name in the use line for another track.",
    "use \"Kick\" as kick",
    "param amount = 50 [0..100]",
    "each note:",
    "  if starts(kick): velocity *= 1 - amount / 100",
  ].join("\n") },
];
export const defaultScripts = () => DEFAULT_SCRIPTS.map((s) => ({ name: s.name, code: s.code, values: { ...s.values } }));
