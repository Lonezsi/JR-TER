// gestures.js: tell a tap, a long press, a drag and a pinch apart. No DOM, so it runs in Node.
// Feed it every pointer event of a gesture so far; ask what it is.
//   sample: { id, x, y, t (ms), type: "down" | "move" | "up" | "cancel" }
// classify() returns { kind: "tap" | "long" | "drag" | "pinch" | "none", ... }.

export const TAP_MS = 250;
export const LONG_MS = 450;
export const SLOP = 8; // px a finger may wobble and still count as holding still

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

export function classify(samples, now = samples.length ? samples[samples.length - 1].t : 0) {
  const ids = [...new Set(samples.filter((s) => s.type === "down").map((s) => s.id))];
  if (!ids.length) return { kind: "none" };
  if (ids.length >= 2) {
    const [a, b] = ids;
    const of = (id) => samples.filter((s) => s.id === id);
    const first = (id) => of(id)[0];
    const last = (id) => of(id)[of(id).length - 1];
    const d0 = dist(first(a), first(b)), d1 = dist(last(a), last(b));
    const mid = (f) => ({ x: (f(a).x + f(b).x) / 2, y: (f(a).y + f(b).y) / 2 });
    const m0 = mid(first), m1 = mid(last);
    return { kind: "pinch", scale: d0 > 0 ? d1 / d0 : 1, dx: m1.x - m0.x, dy: m1.y - m0.y, x: m1.x, y: m1.y };
  }
  const mine = samples.filter((s) => s.id === ids[0]);
  const down = mine[0], last = mine[mine.length - 1];
  const moved = Math.max(...mine.map((s) => dist(s, down)));
  const ended = last.type === "up" || last.type === "cancel";
  if (moved >= SLOP) return { kind: "drag", dx: last.x - down.x, dy: last.y - down.y, x: last.x, y: last.y };
  if (ended) {
    if (last.type === "cancel") return { kind: "none" };
    return last.t - down.t <= TAP_MS ? { kind: "tap", x: down.x, y: down.y } : { kind: "none" };
  }
  if (now - down.t >= LONG_MS) return { kind: "long", x: down.x, y: down.y };
  return { kind: "none" };
}
