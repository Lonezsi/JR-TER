// merge.js: three-way merge of two people's edits to one DAW project (parsed JSON).
//   merge3(base, mine, theirs): base is what both started from. A change that only one side
//   made is kept; objects are merged key by key, and arrays of the same length as the base
//   element by element. Where both changed the same thing, mine wins.
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const plain = (x) => x && typeof x === "object" && !Array.isArray(x);

export function merge3(base, mine, theirs) {
  if (same(mine, theirs)) return mine;
  if (same(mine, base)) return theirs;
  if (same(theirs, base)) return mine;
  if (plain(base) && plain(mine) && plain(theirs)) {
    const out = {};
    for (const k of new Set([...Object.keys(base), ...Object.keys(mine), ...Object.keys(theirs)])) {
      const inB = k in base, inM = k in mine, inT = k in theirs;
      if (inM && inT) out[k] = merge3(base[k], mine[k], theirs[k]);
      else if (inM) { if (!inB || !same(mine[k], base[k])) out[k] = mine[k]; } // theirs removed it: only keep if I changed it
      else if (inT) { if (!inB || !same(theirs[k], base[k])) out[k] = theirs[k]; }
    }
    return out;
  }
  if (Array.isArray(base) && Array.isArray(mine) && Array.isArray(theirs)) {
    if (mine.length === base.length && theirs.length === base.length) return base.map((b, i) => merge3(b, mine[i], theirs[i]));
    // one side added or removed elements: if the other only changed elements, keep the longer one's shape
    if (theirs.length === base.length) return mine.map((m, i) => (i < base.length ? merge3(base[i], m, theirs[i]) : m));
    if (mine.length === base.length) return theirs.map((t, i) => (i < base.length ? merge3(base[i], mine[i], t) : t));
  }
  return mine;
}

export function mergeTexts(baseText, mineText, theirsText) {
  const b = baseText ? JSON.parse(baseText) : {};
  return JSON.stringify(merge3(b, JSON.parse(mineText), JSON.parse(theirsText)));
}
