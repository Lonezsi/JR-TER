/* The shared namespace and the small things every screen needs.
 *
 * The js/ directory is concatenated in filename order, so there is one scope and one
 * global. Everything hangs off J, and a file that is deleted simply stops adding to it.
 */
"use strict";

/* Carried over from the old name, once per browser.
 *
 * These are conveniences, not data: a sort order per list, whether the two sound panels
 * are folded, whether the rail is put away. Renaming the prefix without this loses none
 * of it in any way that matters, but it does leave three dead keys in every browser for
 * ever and it resets everybody's rail on the morning they update, which reads as a bug.
 * This is the first file in the bundle, so it runs before anything reads a key. */
try {
  for (const suffix of ["sort", "sound.open", "rail.shut"]) {
    const kept = localStorage.getItem("jong." + suffix);
    if (kept !== null && localStorage.getItem("jriter." + suffix) === null) {
      localStorage.setItem("jriter." + suffix, kept);
    }
    localStorage.removeItem("jong." + suffix);
  }
} catch (e) { /* a private window: the defaults stand, which is fine */ }

const J = {
  views: {},      // route name -> { title, render }
  state: {},
  bus: new EventTarget(),
};

J.$ = (sel, root) => (root || document).querySelector(sel);
J.$$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

J.esc = (value) => String(value == null ? "" : value).replace(/[&<>"']/g, (c) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[c]));

J.emit = (name, detail) => J.bus.dispatchEvent(new CustomEvent(name, { detail }));
J.on = (name, fn) => J.bus.addEventListener(name, fn);

/* mm:ss, and h:mm:ss once a track is long enough to need it. */
J.time = (seconds) => {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const whole = Math.floor(seconds);
  const h = Math.floor(whole / 3600);
  const m = Math.floor((whole % 3600) / 60);
  const s = whole % 60;
  const pad = (n) => String(n).padStart(2, "0");
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
};

J.bytes = (n) => {
  if (!n) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  const value = n / Math.pow(1024, i);
  return `${value >= 100 || i === 0 ? Math.round(value) : value.toFixed(1)} ${units[i]}`;
};

J.when = (epochSeconds) => {
  if (!epochSeconds) return "";
  const then = new Date(epochSeconds * 1000);
  const days = Math.floor((Date.now() - then.getTime()) / 86400000);
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  const sameYear = then.getFullYear() === new Date().getFullYear();
  return then.toLocaleDateString(undefined, {
    day: "numeric", month: "short", year: sameYear ? undefined : "numeric",
  });
};

/* Year, month, day, in that order and zero padded.
 *
 * Not toLocaleDateString. Every other date in this app is written the way the reader's
 * machine writes dates, which is right for a sentence: "started 3 Sept". This one sits in
 * a column of dates being compared with each other, and for that the only thing that
 * matters is that they sort by eye, which needs the biggest unit first and a fixed width.
 * A locale gives neither, and on a machine set to en-US it gives month first, which is
 * the one order that reads wrong next to a duration.
 *
 * Built from the local parts rather than sliced off toISOString, which would be UTC: a
 * render made at eleven at night would show tomorrow's date to the person who made it.
 */
J.ymd = (epochSeconds) => {
  if (!epochSeconds) return "";
  const at = new Date(epochSeconds * 1000);
  const pad = (n) => String(n).padStart(2, "0");
  return `${at.getFullYear()}/${pad(at.getMonth() + 1)}/${pad(at.getDate())}`;
};

J.date = (epochSeconds) => epochSeconds
  ? new Date(epochSeconds * 1000).toLocaleString(undefined,
      { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })
  : "";

/* A stable hue per title, so a song without artwork still looks like itself every time. */
J.hue = (text) => {
  let hash = 0;
  const value = String(text || "?");
  for (let i = 0; i < value.length; i++) hash = (hash * 31 + value.charCodeAt(i)) % 360;
  return hash;
};

/* ── the accent, and where its hue comes from ──────────────────────────────────
 *
 * Baby pink is hsl(0, 70%, 86%). Every accent the app shows is that same pastel at a
 * different hue, which is what lets the colour follow a song without ever becoming
 * something a button cannot be made of.
 *
 * Checked at every hue rather than assumed, because the whole point is that the app hands
 * this colour to artwork it has never seen. The worst case in the band is hue 240, which
 * reads at 12.32:1 as text on the page and carries the dark ink at 10.41:1. AA wants 4.5
 * for body text, so there is room to spare wherever a sleeve sends it.
 */
J.ACCENT_SAT = 70;
J.ACCENT_LIGHT = 86;

J.hslHex = (h, s, l) => {
  const sat = s / 100;
  const light = l / 100;
  const c = (1 - Math.abs(2 * light - 1)) * sat;
  const x = c * (1 - Math.abs(((((h % 360) + 360) % 360) / 60) % 2 - 1));
  const m = light - c / 2;
  const sixth = Math.floor(((((h % 360) + 360) % 360) / 60)) % 6;
  const table = [[c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x]];
  const [r, g, b] = table[sixth];
  const to = (v) => Math.round((v + m) * 255).toString(16).padStart(2, "0");
  return `#${to(r)}${to(g)}${to(b)}`.toUpperCase();
};

/* A hue as an accent: the pastel band, never the raw colour. */
J.accentFromHue = (hue) => J.hslHex(hue, J.ACCENT_SAT, J.ACCENT_LIGHT);

/* The accent the library is actually set to, which is what everything goes back to. */
J.chosenAccent = () => (J.state && J.state.settings && J.state.settings.accent) || null;

/* The hue of a picture, or null when it has not got one.
 *
 * Weighted by how colourful each pixel is, so a grey sleeve with one stripe of colour
 * follows the stripe. A sleeve with no colour at all returns null rather than a hue read
 * out of noise, and the caller falls back to the chosen accent.
 *
 * Averaged around the circle: hue 350 and hue 10 are ten degrees apart and average to 0,
 * and averaging them as numbers gives 180, which is cyan.
 */
J.hueOfImage = (function () {
  const seen = new Map();          // one sample per url, they do not change
  return function (url) {
    if (!url) return Promise.resolve(null);
    if (seen.has(url)) return Promise.resolve(seen.get(url));
    return new Promise((resolve) => {
      const img = new Image();
      // No crossOrigin: these are served by this app from this origin, and asking for
      // CORS on a same origin image only invites a request that does not need making.
      img.onerror = () => { seen.set(url, null); resolve(null); };
      img.onload = () => {
        let hue = null;
        try {
          const size = 32;
          const canvas = document.createElement("canvas");
          canvas.width = canvas.height = size;
          const ctx2d = canvas.getContext("2d", { willReadFrequently: true });
          ctx2d.drawImage(img, 0, 0, size, size);
          const data = ctx2d.getImageData(0, 0, size, size).data;

          let sin = 0;
          let cos = 0;
          let weight = 0;
          for (let i = 0; i < data.length; i += 4) {
            if (data[i + 3] < 128) continue;
            const r = data[i] / 255;
            const g = data[i + 1] / 255;
            const b = data[i + 2] / 255;
            const max = Math.max(r, g, b);
            const min = Math.min(r, g, b);
            const light = (max + min) / 2;
            const delta = max - min;
            if (delta < 0.02) continue;                 // grey, no hue to take
            const sat = delta / (1 - Math.abs(2 * light - 1) || 1);
            let h;
            if (max === r) h = ((g - b) / delta) % 6;
            else if (max === g) h = (b - r) / delta + 2;
            else h = (r - g) / delta + 4;
            h *= 60;
            // Colourful and mid toned counts most: the ends of the range are where a
            // hue is least trustworthy and least visible.
            const w = sat * (1 - Math.abs(2 * light - 1));
            const rad = h * Math.PI / 180;
            sin += Math.sin(rad) * w;
            cos += Math.cos(rad) * w;
            weight += w;
          }
          if (weight > 0.5) {
            hue = (Math.atan2(sin, cos) * 180 / Math.PI + 360) % 360;
          }
        } catch (e) {
          hue = null;                                   // a tainted canvas, nothing to do
        }
        seen.set(url, hue);
        resolve(hue);
      };
      img.src = url;
    });
  };
}());

/* One cover markup for every screen: real artwork when there is some, a coloured
 * placeholder built from the title when there is not. */
J.cover = (opts) => {
  const { url, title, className = "", style = "" } = opts || {};
  const letter = (String(title || "?").trim()[0] || "?").toUpperCase();
  if (url) {
    return `<div class="cover ${className}" style="background-image:url('${J.esc(url)}');${style}"></div>`;
  }
  return `<div class="cover ${className}" data-hue style="--hue:${J.hue(title)};${style}">` +
         `<span class="letter">${J.esc(letter)}</span></div>`;
};

//: How many toasts can be on screen before the oldest is pushed off.
//:
//: There was no limit. Something going wrong four times in a row put four boxes up the
//: middle of the screen, which is a stack tall enough to cover what you were doing and
//: says nothing the first one did not.
const TOAST_MOST = 3;

J.toast = (message, kind) => {
  const stack = J.$("#toasts");
  if (!stack) return;

  /* The same thing twice is the same thing.
   *
   * A skip through four dead rows in a queue raised four toasts with four different ids
   * in them, and a repeated failure raises the identical line over and over. Rather than
   * a wall of boxes, the one already there is kept and counted, which also keeps it on
   * screen for longer without a separate timer to manage.
   */
  const already = [...stack.children].find((n) => n.dataset.said === message);
  if (already) {
    const times = Number(already.dataset.times || 1) + 1;
    already.dataset.times = times;
    already.textContent = `${message} (${times})`;
    return;
  }

  const node = document.createElement("div");
  node.className = "toast" + (kind === "bad" ? " bad" : "");
  node.dataset.said = message;
  node.textContent = message;
  stack.appendChild(node);
  while (stack.children.length > TOAST_MOST) stack.firstElementChild.remove();
  setTimeout(() => {
    node.style.transition = "opacity 200ms";
    node.style.opacity = "0";
    setTimeout(() => node.remove(), 220);
  }, kind === "bad" ? 4800 : 2600);
};

/* Dialogs. Resolves with a value when confirmed and null when dismissed, so callers
 * read as `const name = await J.sheet(...)` rather than a pile of callbacks. */
/* A pause, for sequencing one animation after another.
 *
 * Used where the thing being waited for is a stagger: several animations finishing at
 * different times, so the useful event is "the last one", which is a count and a clock
 * rather than a transitionend. It also still resolves on a machine asking for reduced
 * motion, where nothing animates and no events fire at all. */
J.wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

J.sheet = (opts) => new Promise((resolve) => {
  const backdrop = J.$("#modalBackdrop");
  const { title, sub = "", body = "", confirm = "Save", cancel = "Cancel",
          wide = false, danger = false, onMount } = opts;
  backdrop.innerHTML = `
    <div class="sheet ${wide ? "wide" : ""}" role="dialog" aria-modal="true" aria-label="${J.esc(title)}">
      <h2>${J.esc(title)}</h2>
      ${sub ? `<p class="sub">${J.esc(sub)}</p>` : ""}
      <div class="sheet-body">${body}</div>
      <div class="sheet-foot">
        <button class="btn ghost" data-act="cancel">${J.esc(cancel)}</button>
        ${confirm ? `<button class="btn ${danger ? "danger" : "primary"}" data-act="ok">${J.esc(confirm)}</button>` : ""}
      </div>
    </div>`;
  backdrop.hidden = false;

  const sheet = J.$(".sheet", backdrop);
  // Where to put focus back. A dialog that takes focus and does not give it back leaves
  // the next Tab starting from the top of the document.
  const cameFrom = document.activeElement;
  const app = J.$("#app");
  if (app) app.inert = true;

  const close = (value) => {
    document.removeEventListener("keydown", onKey);
    if (app) app.inert = false;
    backdrop.hidden = true;
    backdrop.innerHTML = "";
    if (cameFrom && cameFrom.isConnected && cameFrom.focus) cameFrom.focus();
    resolve(value);
  };
  const collect = () => {
    const fields = {};
    J.$$("[name]", sheet).forEach((input) => {
      fields[input.name] = input.type === "checkbox" ? input.checked : input.value;
    });
    return fields;
  };
  const onKey = (e) => {
    if (e.key === "Escape") { e.preventDefault(); close(null); }

    /* Ctrl+Enter confirms, except where confirming destroys something.
     *
     * J.confirm builds a danger dialog and treats any non-null answer as yes, so this
     * shortcut was pressing "Delete it" on a dialog whose focus you could not see and
     * whose question you may not have finished reading. A destructive answer should cost
     * a deliberate press of the button that says what it does. */
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !danger) {
      e.preventDefault();
      close(collect());
    }

    /* Tab stays inside. Without this, tabbing out of a modal walks the page behind it,
     * which is both a trap for the keyboard and a way to press something you cannot see. */
    if (e.key !== "Tab") return;
    const reachable = J.$$(
      'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]),'
      + ' select:not([disabled]), [tabindex]:not([tabindex="-1"])', sheet)
      .filter((n) => n.offsetParent !== null || n === document.activeElement);
    if (!reachable.length) return;
    const edge = e.shiftKey ? reachable[0] : reachable[reachable.length - 1];
    if (document.activeElement === edge || !sheet.contains(document.activeElement)) {
      e.preventDefault();
      (e.shiftKey ? reachable[reachable.length - 1] : reachable[0]).focus();
    }
  };
  document.addEventListener("keydown", onKey);
  backdrop.onclick = (e) => { if (e.target === backdrop) close(null); };
  sheet.addEventListener("click", (e) => {
    const act = e.target.closest("[data-act]");
    if (!act) return;
    if (act.dataset.act === "cancel") close(null);
    if (act.dataset.act === "ok") close(collect());
  });
  if (onMount) onMount(sheet, close);
  // Something inside always has focus, so Escape and Tab reach this dialog rather than
  // the page behind it. A question with no field still has its buttons.
  const first = J.$("input, textarea, select", sheet)
    || J.$("[data-act=cancel]", sheet) || J.$("button", sheet) || sheet;
  setTimeout(() => {
    first.focus();
    if (first.select && first.tagName !== "BUTTON") first.select();
  }, 30);
});

J.confirm = (title, sub, confirm) =>
  J.sheet({ title, sub, confirm: confirm || "Yes, do it", cancel: "Keep it", danger: true })
    .then((value) => value !== null);

J.clamp = (value, low, high) => Math.max(low, Math.min(high, value));

/* Wait for a burst of calls to settle. Used for typing in the search box and for the
 * lyric editor, so neither writes on every keystroke. */
J.debounce = (fn, wait) => {
  let timer = null;
  const wrapped = (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
  wrapped.cancel = () => clearTimeout(timer);
  wrapped.now = (...args) => { clearTimeout(timer); fn(...args); };
  return wrapped;
};


/* A stand in for a screen that is still loading.
 *
 * Shown the instant a navigation starts, so the app never blanks. It is shaped roughly
 * like what is coming, because a placeholder in the wrong shape is worse than none: the
 * page jumps when the real thing lands and the eye has to start again.
 *
 * Deliberately dim and slow. A shimmering block that demands attention while you wait
 * for it is the wrong way round.
 */
J.skeleton = (kind) => {
  const line = (w, h) => `<span class="sk-line" style="width:${w};height:${h || "13px"}"></span>`;
  if (kind === "song") {
    return `<div class="sk">
      <div class="sk-hero">
        <span class="sk-cover"></span>
        <span class="sk-stack">${line("46%", "38px")}${line("30%")}${line("22%")}</span>
      </div>
      <div class="sk-block">${line("18%", "11px")}${line("100%", "120px")}</div>
      <div class="sk-block">${line("18%", "11px")}${line("100%", "160px")}</div>
    </div>`;
  }
  return `<div class="sk">
    <div class="sk-block">${line("22%", "22px")}
      ${[72, 88, 64, 80, 58].map((w) => `<span class="sk-row">
        <span class="sk-thumb"></span>${line(w + "%")}</span>`).join("")}
    </div>
  </div>`;
};

/* Sorting a list, and remembering how you like it.
 *
 * One mechanism for every list rather than one per view, because "sort by name" has to
 * mean the same thing and look the same wherever it appears. A list declares which keys
 * it can be sorted by; this holds the choice, draws the control and does the comparing.
 *
 * The choice is kept per list in this browser. It is a preference about looking, not a
 * fact about the library, so it does not belong on the server and it does not need to
 * follow you to another machine.
 *
 * The first key a list declares is its default, which for a running order is always the
 * running order itself. An album's track list and a playlist are sequences somebody
 * chose; offering to sort them is useful, opening them re-sorted is throwing that away.
 */
J.sort = (function () {
  const KEY = "jriter.sort";

  function all() {
    try { return JSON.parse(localStorage.getItem(KEY) || "{}") || {}; }
    catch (e) { return {}; }        // a private window, or something else's key
  }

  function keep(map) {
    try { localStorage.setItem(KEY, JSON.stringify(map)); } catch (e) { /* fine */ }
  }

  /* Text compares as a person reads it: case blind, and "Track 10" after "Track 9".
   * Numbers and dates compare as numbers, and anything missing sinks to the bottom
   * whichever way round the list is, because an empty value is not a small one. */
  function compare(a, b, field, numeric, dir) {
    const left = field(a);
    const right = field(b);
    const missing = (v) => v === null || v === undefined || v === "" ||
                           (numeric && !Number.isFinite(Number(v)));
    if (missing(left) || missing(right)) {
      if (missing(left) && missing(right)) return 0;
      return missing(left) ? 1 : -1;
    }
    const order = numeric
      ? Number(left) - Number(right)
      : String(left).localeCompare(String(right), undefined,
                                   { sensitivity: "base", numeric: true });
    return dir === "down" ? -order : order;
  }

  return {
    /* What this list is sorted by right now, as {key, dir}. */
    of(list, keys) {
      const kept = all()[list];
      const known = keys.find((k) => k.key === (kept && kept.key));
      const chosen = known || keys[0];
      return { key: chosen.key, dir: (kept && kept.dir) || chosen.dir || "up", def: chosen };
    },

    set(list, key, dir) {
      const map = all();
      map[list] = { key, dir };
      keep(map);
    },

    /* A copy, in order. Never the array that was handed in: several views hold on to
     * theirs and look rows up in it by index. */
    apply(items, list, keys) {
      const now = this.of(list, keys);
      const spec = keys.find((k) => k.key === now.key) || keys[0];
      if (!spec || !spec.by) return items.slice();     // the untouched order
      return items.slice().sort((a, b) => compare(a, b, spec.by, !!spec.numeric, now.dir));
    },

    /* The control. One button that says what the list is sorted by, opening a menu of
     * the rest. The arrow is the direction and pressing the current key flips it, which
     * is the one gesture every table in the world already has. */
    control(list, keys) {
      const now = this.of(list, keys);
      const spec = keys.find((k) => k.key === now.key) || keys[0];
      const fixed = !spec.by;                     // the running order cannot be reversed
      return `<button class="btn ghost sm sort-pick" data-sort-list="${J.esc(list)}"
                title="Sort this list">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor"
             stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
             class="sort-mark ${fixed ? "" : now.dir}"><path d="M3 6h13M3 12h9M3 18h5"/>${
          fixed ? "" : '<path d="M18 8v11M15 16l3 3 3-3"/>'}</svg>
        <span>${J.esc(spec.label)}</span>
      </button>`;
    },

    /* Wire the control up. onChange is called after the choice is stored. */
    wire(root, list, keys, onChange) {
      const open = (node) => {
        const now = this.of(list, keys);
        J.menu.show(keys.map((k) => ({
          label: k.label + (k.key === now.key && k.by
            ? (now.dir === "down" ? "  \u2193" : "  \u2191") : ""),
          icon: k.key === now.key ? "check" : null,
          run: () => {
            // Pressing the one it is already sorted by turns it round.
            const dir = k.key === now.key && k.by
              ? (now.dir === "down" ? "up" : "down")
              : (k.dir || "up");
            this.set(list, k.key, dir);
            onChange();
          },
        })), { anchor: node });
      };
      root.addEventListener("click", (e) => {
        const hit = e.target.closest(`[data-sort-list="${CSS.escape(list)}"]`);
        if (hit) { e.preventDefault(); open(hit); }
      });
      root.addEventListener("contextmenu", (e) => {
        const hit = e.target.closest(`[data-sort-list="${CSS.escape(list)}"]`);
        if (hit) { e.preventDefault(); open(hit); }
      });
    },
  };
}());


/* The page's ground.
 *
 * A song puts its own artwork behind the entire app rather than behind its panel, so
 * the rail and the player have something with colour in it to bend. Called with nothing
 * by every other view, which is how it goes away again.
 */
J.pageWash = function (url, hue) {
  const wash = document.getElementById("pageWash");
  if (!wash) return;
  if (!url && hue === undefined) {
    wash.classList.remove("on", "flat");
    wash.style.backgroundImage = "";
    // Nothing behind the app at all. The dust is the only thing back there, and on these
    // screens it shows through the rail and the player, which is the one time those two
    // panes have anything to refract.
    J.dust.start(null);
    // Off a song, so the accent goes back to whatever the library is set to. This is the
    // only place that has to remember, because it is the only place that changed it.
    J.applyAccent(J.chosenAccent());
    return;
  }
  wash.classList.toggle("flat", !url);
  if (url) wash.style.backgroundImage = `url('${String(url).replace(/'/g, "%27")}')`;
  else { wash.style.backgroundImage = ""; wash.style.setProperty("--hue", hue); }
  wash.classList.add("on");
  /* A picture behind the app is the thing the dust was standing in for, so it goes: the
   * element is removed, not hidden. The hue is handed over as a number because --hue is
   * an inline property on this element and a sibling cannot inherit it. */
  if (url) J.dust.stop(); else J.dust.start(hue);

  /* And the accent takes the same hue as the ground.
   *
   * Here rather than in the song view because this function already knows what is behind
   * the app on every screen, and a second place that decided it would be a second place
   * to forget. Only the hue is taken: see the note above J.accentFromHue.
   *
   * The picture case is asynchronous and deliberately not awaited. The wash is already
   * on screen and the colour arriving a frame later is better than holding the render
   * for a decode. The guard is that the wash is still showing the same picture when the
   * sample comes back, or a fast walk through three songs would settle on whichever
   * decoded last rather than the one being looked at.
   */
  if (!url) {
    J.applyAccent(J.accentFromHue(hue));
    return;
  }
  const wanted = url;
  J.hueOfImage(url).then((found) => {
    if (wash.style.backgroundImage.indexOf(String(wanted).replace(/'/g, "%27")) === -1) {
      return;                       // moved on while the picture was decoding
    }
    J.applyAccent(found === null ? J.chosenAccent() : J.accentFromHue(found));
  });
};

/* The shape of a render, drawn small.
 *
 * A hundred and twenty numbers from the server, 0 to 255, one per column. Drawn as an
 * SVG polygon rather than a canvas because it sits behind a row in a list: a canvas per
 * row would be a hundred contexts and a hundred repaints on every scroll, and this never
 * animates. It is decoration for recognising a file at a glance, so it is aria-hidden
 * and carries no interaction of its own.
 */
J.waveform = function (shape, opts) {
  const o = opts || {};
  if (!shape || !shape.length) return "";
  const width = 100;
  const half = 20;
  const step = width / (shape.length - 1 || 1);

  // Down the top, back along the bottom: one closed shape rather than a bar per column,
  // which keeps a hundred of these to a few kilobytes of markup.
  const top = [];
  const bottom = [];
  shape.forEach((value, i) => {
    const x = (i * step).toFixed(2);
    const y = (value / 255) * half;
    top.push(`${x},${(half - y).toFixed(2)}`);
    bottom.push(`${x},${(half + y).toFixed(2)}`);
  });
  bottom.reverse();

  return `<svg class="wave ${o.className || ""}" viewBox="0 0 ${width} ${half * 2}"
     preserveAspectRatio="none" aria-hidden="true" focusable="false">
    <polygon points="${top.concat(bottom).join(" ")}"></polygon>
  </svg>`;
};

/* What is wrong with a render, as a word and a mark.
 *
 * Silent and unreadable are the two that matter and they are found when the file
 * arrives, so a list can say so before anything is played. */
J.trouble = function (render) {
  const what = render && render.trouble;
  if (!what || what === "not looked at") return "";
  const said = {
    silent: "There is no sound in this one",
    unreadable: "This will not play",
  }[what] || what;
  return `<span class="trouble" title="${J.esc(said)}">
    <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true">
      <path d="M12 3l10 18H2z" fill="none" stroke="currentColor" stroke-width="2"
            stroke-linejoin="round"/>
      <path d="M12 10v4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
      <circle cx="12" cy="17.5" r="1.1" fill="currentColor"/>
    </svg>
    <span>${J.esc(what === "silent" ? "silent" : "will not play")}</span>
  </span>`;
};

/* Is the press happening right now on a link that leaves this document.
 *
 * Anything that steers the browser's history out of a blur has to ask, and until there
 * was a page to leave to, nothing did. Every other link in this app is a hash: the
 * router handles it, no document unloads, and code that runs afterwards is running in
 * the same page it started in.
 *
 * A real navigation is not like that, and the order is the trap. Focus leaves the moment
 * a press goes down, so a blur handler starts its work while the button is still held,
 * and the link does not begin navigating until the press comes back up. A
 * history.back() called in between is queued rather than immediate, and the queued
 * traversal executes after the navigation has begun and cancels it. The visible result
 * is that you click Terms and privacy while writing lyrics and simply stay where you
 * were. Holding the button longer does not help: the traversal still wins.
 *
 * Read at the start of every press rather than cleared at the end of one, so it always
 * describes the press that caused the blur rather than some earlier one, and so a press
 * dragged off a link leaves nothing stale behind for the next.
 */
J.leavesTheDocument = (link) => {
  const href = link.getAttribute("href");
  if (!href || href.startsWith("#")) return false;
  let url;
  try {
    url = new URL(href, location.href);
  } catch (e) {
    return false;
  }
  return url.origin !== location.origin
    || url.pathname !== location.pathname
    || url.search !== location.search;
};

let pressLeaves = false;
document.addEventListener("pointerdown", (e) => {
  const link = e.target && e.target.closest && e.target.closest("a[href]");
  pressLeaves = !!link && J.leavesTheDocument(link);
}, true);

J.pressIsLeaving = () => pressLeaves;

/* A cross and a bar, drawn rather than typed.
 *
 * A "+" character centred by flex or grid lands low, and the amount is not a rounding
 * error you can argue with: the box is centred on the LINE box, and the glyph's ink is
 * not centred in its own line box. Measured in this app's own faces, the ink sits half a
 * pixel below the middle at 20px and a whole pixel below it at 12px in the display face,
 * which is exactly the "slightly off" that is impossible to unsee once noticed and
 * impossible to fix by nudging, because the offset changes with the font and the size.
 *
 * Two strokes in a viewBox are centred because their coordinates say so, at every size,
 * in every face. `−` has the same problem for the same reason and gets the same
 * treatment, so the pair still lines up with each other.
 */
J.plus = (px) => `<svg viewBox="0 0 24 24" width="${px}" height="${px}" fill="none"
     stroke="currentColor" stroke-width="2.2" stroke-linecap="round"
     aria-hidden="true" focusable="false"><path d="M12 5.6v12.8M5.6 12h12.8"/></svg>`;

J.minus = (px) => `<svg viewBox="0 0 24 24" width="${px}" height="${px}" fill="none"
     stroke="currentColor" stroke-width="2.2" stroke-linecap="round"
     aria-hidden="true" focusable="false"><path d="M5.6 12h12.8"/></svg>`;

/* A field label with the mark that says it cannot be left empty.
 *
 * The wrapper is the whole point. .sheet-label is a column flex, so every element inside
 * it becomes its own row with the label's 6px gap above it: a bare <span> holding the
 * asterisk came out as a small green dot on a line of its own under the word, which
 * reads as a bullet, not as a mark on the label. The text and the mark have to be one
 * flex item with the mark inline inside it.
 *
 * aria-hidden on the glyph, and the caller puts `required` on the input. A screen reader
 * should hear the state from the field, not hear "asterisk" read out after the name.
 */
J.req = (label) =>
  `<span>${label}<span class="req" aria-hidden="true">*</span></span>`;

/* The outer span carries no class on purpose. Its whole job is to be one flex item so
 * the text and the mark share a line, and there is nothing for a stylesheet to say about
 * it: a class with no rule is either a typo or a rule somebody forgot, and there is a
 * test that says so. This is neither. */
