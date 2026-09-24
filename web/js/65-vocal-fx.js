/* The vocal edit: effects on one take, in the order they are listed.
 *
 * Four kinds: an EQ, a limiter, autotune, and a multiband sidechain that either lets the
 * render duck the voice or lets the voice duck the render. Any number of each, in any
 * order, each with its own switch, and one switch for the whole edit beside its button.
 *
 * NOTHING HERE RUNS LIVE. A take's edit is rendered once, in the background, into a new
 * buffer, and that buffer is what plays. While somebody is moving a slider nothing is
 * rendered at all; the render starts when they have left it alone for a moment, runs off
 * the page's thread (OfflineAudioContext for the filters, a worker for autotune and the
 * envelopes), and swaps in when it is done. Until then the last render keeps playing.
 *
 * The one thing that has to happen while the song plays is the voice ducking the render,
 * because the render is not a buffer here but the player's own decks. Even that is
 * worked out in advance: the ducking is a gain curve per band, computed with everything
 * else, and playing it is three gain nodes following their curves.
 */
"use strict";

J.vocalFx = (function () {
  const RATE = 100;                       // envelope points per second
  const XOVER = [250, 4000];              // where the sidechain's three bands meet
  const BANDS = ["low", "mid", "high"];
  const QUIET_MS = 800;                   // how long a slider is left alone before rendering

  const NOTES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

  /* What each effect holds, and the controls it gets. [key, label, min, max, step, unit] */
  const KINDS = {
    eq: {
      label: "EQ",
      make: () => ({ type: "eq", on: true, lowcut: 80, low: 0, midFreq: 2500, mid: 0, midQ: 1, high: 0 }),
      knobs: [["lowcut", "Low cut", 20, 400, 1, "Hz"], ["low", "Low (200 Hz)", -12, 12, 0.5, "dB"],
              ["midFreq", "Middle at", 300, 8000, 10, "Hz"], ["mid", "Middle", -12, 12, 0.5, "dB"],
              ["midQ", "Middle width", 0.3, 4, 0.1, "Q"], ["high", "High (8 kHz)", -12, 12, 0.5, "dB"]],
    },
    limiter: {
      label: "Limiter",
      make: () => ({ type: "limiter", on: true, threshold: -12, ceiling: -1, release: 120 }),
      knobs: [["threshold", "Threshold", -30, 0, 0.5, "dB"], ["ceiling", "Ceiling", -12, 0, 0.1, "dB"],
              ["release", "Release", 10, 500, 1, "ms"]],
    },
    autotune: {
      label: "Autotune",
      make: () => ({ type: "autotune", on: true, key: 0, scale: "chromatic", speed: 20, amount: 100 }),
      picks: [["key", "Key", NOTES.map((n, i) => [i, n])],
              ["scale", "Scale", [["chromatic", "Every note"], ["major", "Major"], ["minor", "Minor"]]]],
      knobs: [["speed", "Retune speed", 0, 200, 1, "ms"], ["amount", "Amount", 0, 100, 1, "%"]],
    },
    sidechain: {
      label: "Multiband sidechain",
      make: () => ({ type: "sidechain", on: true, dir: "render", threshold: -30,
                     low: 6, mid: 6, high: 3, attack: 10, release: 150 }),
      picks: [["dir", "Which way", [["render", "The render ducks this voice"],
                                     ["voice", "This voice ducks the render"]]]],
      knobs: [["threshold", "Threshold", -60, 0, 0.5, "dB"],
              ["low", "Low, under 250 Hz", 0, 24, 0.5, "dB"], ["mid", "Middle", 0, 24, 0.5, "dB"],
              ["high", "High, over 4 kHz", 0, 24, 0.5, "dB"],
              ["attack", "Attack", 1, 100, 1, "ms"], ["release", "Release", 10, 1000, 1, "ms"]],
    },
  };

  // ── the worker ──────────────────────────────────────────────────────────────
  /* Runs in a worker, so its own scope: nothing from J in here. */
  function workerMain() {
    const ops = {
      /* Level in dB, RATE points a second, of the channels mixed down. */
      rms(chs, sr, rate) {
        const n = chs[0].length;
        const hop = sr / rate;
        const out = new Float32Array(Math.ceil(n / hop));
        for (let j = 0; j < out.length; j++) {
          const a = Math.floor(j * hop);
          const b = Math.min(n, Math.floor((j + 1) * hop));
          let sum = 0;
          for (let c = 0; c < chs.length; c++) {
            const d = chs[c];
            for (let i = a; i < b; i++) sum += d[i] * d[i];
          }
          out[j] = 10 * Math.log10(sum / Math.max(1, (b - a) * chs.length) + 1e-12);
        }
        return [out];
      },

      /* Three bands back into one signal, each band turned down by its curve. `start` is
       * where in the curves this signal's first sample falls. */
      mix(bands, curves, hop, start) {
        const n = bands[0][0].length;
        const out = bands[0].map(() => new Float32Array(n));
        for (let b = 0; b < bands.length; b++) {
          const curve = curves[b];
          for (let c = 0; c < out.length; c++) {
            const src = bands[b][c];
            const dst = out[c];
            for (let i = 0; i < n; i++) {
              let g = 1;
              if (curve) {
                const at = start + i / hop;
                const k = Math.floor(at);
                if (k >= 0 && k + 1 < curve.length) g = curve[k] + (curve[k + 1] - curve[k]) * (at - k);
                else if (k >= 0 && k < curve.length) g = curve[k];
              }
              dst[i] += src[i] * g;
            }
          }
        }
        return out;
      },

      /* Pitch correction.
       *
       * Find the pitch every 10 ms (YIN, on a copy brought down to about 8 kHz, which is
       * plenty for a voice and a sixth of the work), decide how far each moment is from
       * the nearest note the scale allows, ease towards that at the retune speed, and move
       * the pitch by that much without moving the timing: grains a period or two long,
       * taken at the voice's own pitch marks and laid down closer together or further
       * apart (PSOLA). Where there is no pitch, a breath or an "s", nothing moves. */
      autotune(chs, sr, p) {
        const n = chs[0].length;
        const mono = new Float32Array(n);
        for (const d of chs) for (let i = 0; i < n; i++) mono[i] += d[i] / chs.length;

        const D = Math.max(1, Math.round(sr / 8000));
        const dsr = sr / D;
        const m = Math.floor(n / D);
        const x = new Float32Array(m);
        for (let i = 0; i < m; i++) {
          let s = 0;
          for (let k = 0; k < D; k++) s += mono[i * D + k];
          x[i] = s / D;
        }
        const hop = Math.max(1, Math.round(dsr * 0.01));
        const maxLag = Math.ceil(dsr / 70);
        const minLag = Math.max(2, Math.floor(dsr / 1000));
        const win = maxLag * 2;
        const frames = Math.max(1, Math.ceil(m / hop));
        const raw = new Float32Array(frames);
        const d = new Float32Array(maxLag + 2);
        for (let f = 0; f < frames; f++) {
          const s0 = f * hop - (win >> 1);
          if (s0 < 0 || s0 + win + maxLag >= m) continue;
          let energy = 0;
          for (let i = 0; i < win; i++) energy += x[s0 + i] * x[s0 + i];
          if (energy / win < 1e-5) continue;                  // quieter than -50 dB
          let run = 0;
          d[0] = 1;
          for (let tau = 1; tau <= maxLag; tau++) {
            let sum = 0;
            for (let i = 0; i < win; i++) { const v = x[s0 + i] - x[s0 + i + tau]; sum += v * v; }
            run += sum;
            d[tau] = run > 0 ? (sum * tau) / run : 1;
          }
          let tau = -1;
          for (let t = minLag; t < maxLag; t++) {
            if (d[t] < 0.2) {
              while (t + 1 < maxLag && d[t + 1] < d[t]) t++;
              tau = t;
              break;
            }
          }
          if (tau < 1) continue;
          const a = d[tau - 1], b = d[tau], c = d[tau + 1];
          const den = a - 2 * b + c;
          const shift = den ? Math.max(-1, Math.min(1, (0.5 * (a - c)) / den)) : 0;
          raw[f] = dsr / (tau + shift);
        }
        // A median of three, so one frame an octave out does not become a jump.
        const f0 = new Float32Array(frames);
        for (let f = 0; f < frames; f++) {
          if (!raw[f]) continue;
          const near = [raw[f - 1], raw[f], raw[f + 1]].filter((v) => v > 0).sort((u, v) => u - v);
          f0[f] = near[near.length >> 1];
        }

        const SCALES = { chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
                         major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10] };
        const scale = SCALES[p.scale] || SCALES.chromatic;
        const key = ((p.key | 0) % 12 + 12) % 12;
        const amount = Math.max(0, Math.min(1, (p.amount == null ? 100 : p.amount) / 100));
        const alpha = !(p.speed > 0) ? 1 : 1 - Math.exp(-(hop / dsr) * 1000 / p.speed);
        const semis = new Float32Array(frames);
        let cur = 0;
        let was = false;
        for (let f = 0; f < frames; f++) {
          if (!f0[f]) { was = false; continue; }
          const midi = 69 + 12 * Math.log2(f0[f] / 440);
          let best = Math.round(midi);
          let gap = Infinity;
          for (let k = Math.floor(midi) - 2; k <= Math.ceil(midi) + 2; k++) {
            if (scale.indexOf(((k - key) % 12 + 12) % 12) === -1) continue;
            if (Math.abs(k - midi) < gap) { gap = Math.abs(k - midi); best = k; }
          }
          const want = (best - midi) * amount;
          cur = was ? cur + alpha * (want - cur) : want;      // a new note starts in tune
          semis[f] = cur;
          was = true;
        }

        const frameOf = (i) => Math.min(frames - 1, Math.max(0, Math.round(i / (hop * D))));
        const periodAt = (f) => (f0[f] ? sr / f0[f] : sr * 0.005);
        const marks = [];
        for (let t = 0; t < n;) {
          marks.push(t);
          const f = frameOf(t);
          const T = periodAt(f);
          let next = t + T;
          if (f0[f]) {
            // On to the next peak of the wave, so every grain starts at the same point in it.
            let at = Math.round(next);
            let top = -Infinity;
            for (let i = Math.max(t + 1, Math.floor(next - T * 0.2)); i <= Math.min(n - 1, Math.ceil(next + T * 0.2)); i++) {
              if (mono[i] > top) { top = mono[i]; at = i; }
            }
            next = at;
          }
          t = Math.max(t + 1, Math.round(next));
        }

        const out = chs.map(() => new Float32Array(n));
        const weight = new Float32Array(n);
        let k = 0;
        for (let ts = 0; ts < n;) {
          while (k + 1 < marks.length && Math.abs(marks[k + 1] - ts) <= Math.abs(marks[k] - ts)) k++;
          const ta = marks[k];
          const f = frameOf(ta);
          const T = periodAt(f);
          const r = f0[f] ? Math.max(0.5, Math.min(2, Math.pow(2, semis[f] / 12))) : 1;
          const L = Math.max(2, Math.round(T));
          const at = Math.round(ts);
          for (let j = -L; j <= L; j++) {
            const src = ta + j;
            const dst = at + j;
            if (src < 0 || src >= n || dst < 0 || dst >= n) continue;
            const h = 0.5 + 0.5 * Math.cos((Math.PI * j) / L);
            for (let c = 0; c < chs.length; c++) out[c][dst] += chs[c][src] * h;
            weight[dst] += h;
          }
          ts += T / r;
        }
        for (let i = 0; i < n; i++) {
          const w = weight[i];
          for (let c = 0; c < out.length; c++) out[c][i] = w > 1e-3 ? out[c][i] / w : 0;
        }
        return out;
      },
    };

    const buffersIn = (value, list) => {
      if (value instanceof Float32Array) list.push(value.buffer);
      else if (Array.isArray(value)) value.forEach((v) => buffersIn(v, list));
      return list;
    };
    self.onmessage = (e) => {
      const { id, op, args } = e.data;
      try {
        const out = ops[op].apply(null, args);
        self.postMessage({ id, out }, buffersIn(out, []));
      } catch (err) {
        self.postMessage({ id, error: String((err && err.message) || err) });
      }
    };
  }

  let worker = null;
  let asked = 0;
  const waiting = new Map();
  function work(op, args) {
    if (!worker) {
      const url = URL.createObjectURL(new Blob([`(${workerMain.toString()})()`],
        { type: "text/javascript" }));
      worker = new Worker(url);
      worker.onmessage = (e) => {
        const job = waiting.get(e.data.id);
        waiting.delete(e.data.id);
        if (!job) return;
        if (e.data.error) job.reject(new Error(e.data.error));
        else job.resolve(e.data.out);
      };
    }
    const id = ++asked;
    const moved = [];
    const collect = (v) => {
      if (v instanceof Float32Array) moved.push(v.buffer);
      else if (Array.isArray(v)) v.forEach(collect);
    };
    collect(args);
    return new Promise((resolve, reject) => {
      waiting.set(id, { resolve, reject });
      worker.postMessage({ id, op, args }, moved);
    });
  }

  // ── buffers ─────────────────────────────────────────────────────────────────
  const copyOf = (buffer) => Array.from({ length: buffer.numberOfChannels },
    (_, c) => buffer.getChannelData(c).slice());
  function bufferOf(chs, sr) {
    const buffer = new AudioBuffer({ length: chs[0].length, numberOfChannels: chs.length, sampleRate: sr });
    chs.forEach((d, c) => buffer.copyToChannel(d, c));
    return buffer;
  }

  /* One pass of a buffer through some nodes, off the page's thread. */
  async function offline(buffer, build) {
    const off = new OfflineAudioContext(buffer.numberOfChannels, buffer.length, buffer.sampleRate);
    const src = off.createBufferSource();
    src.buffer = buffer;
    const ends = build(off);
    src.connect(ends.input);
    ends.output.connect(off.destination);
    src.start(0);
    return off.startRendering();
  }

  /* A run of filters, input to output, from a list of [type, freq, gain, q]. */
  function filters(ctx, list) {
    const input = ctx.createGain();
    let node = input;
    for (const [type, freq, gain, q] of list) {
      const f = ctx.createBiquadFilter();
      f.type = type;
      f.frequency.value = J.clamp(freq, 10, ctx.sampleRate / 2 - 100);
      f.gain.value = gain || 0;
      f.Q.value = q == null ? Math.SQRT1_2 : q;
      node.connect(f);
      node = f;
    }
    return { input, output: node };
  }

  /* The three bands, each a pair of Butterworths either side (Linkwitz-Riley), so they
   * add back up to the signal they came from. Shared by the offline split and the live
   * ducker, so what is measured is what is turned down. */
  const BAND_FILTERS = [
    [["lowpass", XOVER[0]], ["lowpass", XOVER[0]]],
    [["highpass", XOVER[0]], ["highpass", XOVER[0]], ["lowpass", XOVER[1]], ["lowpass", XOVER[1]]],
    [["highpass", XOVER[1]], ["highpass", XOVER[1]]],
  ];
  const split = (buffer) => Promise.all(BAND_FILTERS.map((list) =>
    offline(buffer, (off) => filters(off, list))));

  const levels = async (buffer) => Promise.all((await split(buffer)).map((band) =>
    work("rms", [copyOf(band), band.sampleRate, RATE]).then((r) => r[0])));

  /* A level in dB, a curve of gain: how far over the threshold, at 4:1, no deeper than
   * the band's depth, with attack and release. */
  function duckCurve(db, fx, band) {
    const depth = Math.max(0, Number(fx[band]) || 0);
    const out = new Float32Array(db.length);
    const up = 1 - Math.exp(-1000 / (RATE * Math.max(1, fx.attack || 10)));
    const down = 1 - Math.exp(-1000 / (RATE * Math.max(1, fx.release || 150)));
    let cut = 0;
    for (let i = 0; i < db.length; i++) {
      const want = Math.min(depth, Math.max(0, (db[i] - (fx.threshold || -30)) * 0.75));
      cut += (want > cut ? up : down) * (want - cut);
      out[i] = Math.pow(10, -cut / 20);
    }
    return out;
  }

  const renderLevels = new Map();          // version id -> Promise of [low, mid, high] dB
  function levelsOfRender(versionId) {
    if (!versionId) return Promise.resolve(null);
    if (!renderLevels.has(versionId)) {
      renderLevels.set(versionId, (async () => {
        const bytes = await fetch(J.u(`/api/versions/${versionId}/audio`)).then((r) => r.arrayBuffer());
        return levels(await J.audio.context().decodeAudioData(bytes));
      })().catch(() => { renderLevels.delete(versionId); return null; }));
    }
    return renderLevels.get(versionId);
  }

  // ── one take, through its edit ──────────────────────────────────────────────
  const active = (take) => (take.chain || []).filter((fx) => fx && fx.on && KINDS[fx.type]);
  const usesRender = (take) => active(take).some((fx) => fx.type === "sidechain" && fx.dir !== "voice");
  const keyOf = (take, version) => JSON.stringify([take.digest, active(take), usesRender(take) ? version : null]);

  async function process(take, raw, version) {
    let buffer = raw;
    const sr = raw.sampleRate;
    const ducks = [];
    for (const fx of active(take)) {
      if (fx.type === "eq") {
        buffer = await offline(buffer, (off) => filters(off, [
          ...(fx.lowcut > 20 ? [["highpass", fx.lowcut]] : []),
          ["lowshelf", 200, fx.low], ["peaking", fx.midFreq, fx.mid, fx.midQ], ["highshelf", 8000, fx.high]]));
      } else if (fx.type === "limiter") {
        buffer = await offline(buffer, (off) => {
          const lim = off.createDynamicsCompressor();
          lim.knee.value = 0;
          lim.ratio.value = 20;
          lim.attack.value = 0.002;
          lim.threshold.value = J.clamp(fx.threshold, -60, 0);
          lim.release.value = J.clamp(fx.release / 1000, 0.001, 1);
          const makeup = off.createGain();
          makeup.gain.value = Math.pow(10, (J.clamp(fx.ceiling, -30, 0) - lim.threshold.value) / 20);
          lim.connect(makeup);
          return { input: lim, output: makeup };
        });
      } else if (fx.type === "autotune") {
        buffer = bufferOf(await work("autotune", [copyOf(buffer), sr, fx]), sr);
      } else if (fx.type === "sidechain" && fx.dir === "voice") {
        const db = await levels(buffer);
        ducks.push({ offset: take.offset || 0, curves: db.map((d, i) => duckCurve(d, fx, BANDS[i])) });
      } else if (fx.type === "sidechain") {
        const key = await levelsOfRender(version);
        if (!key) continue;
        const bands = await split(buffer);
        const curves = key.map((d, i) => duckCurve(d, fx, BANDS[i]));
        buffer = bufferOf(await work("mix", [bands.map(copyOf), curves, sr / RATE,
                                             (take.offset || 0) * RATE]), sr);
      }
    }
    return { buffer, ducks };
  }

  // ── the queue ───────────────────────────────────────────────────────────────
  const results = new Map();               // take id -> { key, buffer, ducks }
  const state = new Map();                 // take id -> "waiting" | "rendering"
  let list = [];
  let version = null;
  let quietUntil = 0;
  let timer = 0;
  let busy = false;

  const needed = () => list.filter((t) => t.fx !== 0 && active(t).length
    && (!results.has(t.id) || results.get(t.id).key !== keyOf(t, version)));

  function tell(id) { J.emit("vocals:fx", { id, state: status({ id }) }); }

  function kick() {
    clearTimeout(timer);
    timer = setTimeout(run, Math.max(0, quietUntil - performance.now()) + 30);
  }

  async function run() {
    if (busy) return;
    if (performance.now() < quietUntil) { kick(); return; }
    const take = needed()[0];
    if (!take) return;
    busy = true;
    const key = keyOf(take, version);
    state.set(take.id, "rendering");
    tell(take.id);
    try {
      const raw = await J.vocals.decode(take);
      if (raw) {
        const done = await process(take, raw, version);
        results.set(take.id, Object.assign({ key }, done));
      }
    } catch (e) {
      results.set(take.id, { key, buffer: null, ducks: [], error: e.message });
    }
    busy = false;
    state.delete(take.id);
    tell(take.id);
    J.emit("vocals:rendered", { id: take.id });
    if (needed().length) kick();
  }

  function status(take) {
    const t = list.find((x) => x.id === take.id) || take;
    if (state.get(t.id) === "rendering") return "rendering";
    if (!t.chain || !active(t).length || t.fx === 0) return "none";
    const r = results.get(t.id);
    if (r && r.error) return "failed";
    return r && r.key === keyOf(t, version) ? "ready" : "waiting";
  }

  return {
    KINDS,
    RATE,

    /* These are the song's takes, and this is the render they sit on. Anything whose
     * edit has not been rendered yet is queued. */
    want(takes, versionId) {
      list = takes || [];
      version = versionId || null;
      if (needed().length) kick();
    },

    /* Somebody is moving something. Nothing renders until they stop. */
    touch() {
      quietUntil = performance.now() + QUIET_MS;
      list.forEach((t) => { if (needed().indexOf(t) !== -1) tell(t.id); });
      kick();
    },

    /* What to play for a take: its edit when there is one and it is on, the take as
     * sung otherwise. A stale render plays until the new one is ready. */
    bufferFor(take, raw) {
      if (take.fx === 0 || !active(take).length) return raw;
      const r = results.get(take.id);
      return (r && r.buffer) || raw;
    },

    /* Every voice ducking the render right now, each { offset, curves: [low, mid, high] }. */
    ducks(takes) {
      const out = [];
      for (const t of takes) {
        if (!t.enabled || t.fx === 0 || !active(t).some((fx) => fx.type === "sidechain" && fx.dir === "voice")) continue;
        const r = results.get(t.id);
        if (r && r.ducks) out.push(...r.ducks);
      }
      return out;
    },

    /* The ducks as one curve per band over the whole song. */
    combine(ducks, seconds) {
      const len = Math.ceil(seconds * RATE) + 2;
      return BANDS.map((_, b) => {
        const out = new Float32Array(len).fill(1);
        for (const d of ducks) {
          const curve = d.curves[b];
          const at = Math.round(d.offset * RATE);
          for (let i = 0; i < curve.length; i++) {
            const j = at + i;
            if (j >= 0 && j < len) out[j] *= curve[i];
          }
        }
        return out;
      });
    },

    /* The render, ducked by the voices, for a download. */
    async duckBed(bed, ducks) {
      if (!ducks.length) return bed;
      const curves = this.combine(ducks, bed.duration);
      const bands = await split(bed);
      return bufferOf(await work("mix", [bands.map(copyOf), curves, bed.sampleRate / RATE, 0]),
                      bed.sampleRate);
    },

    /* Render everything now, whether or not anybody is still touching it. For a download. */
    async settle() {
      quietUntil = 0;
      for (let guard = 0; guard < 64 && (needed().length || busy); guard++) {
        if (!busy) await run();
        else await J.wait(100);
      }
    },

    /* The live side of "this voice ducks the render": three bands between the decks and
     * the speakers, each following its curve. Built when a song that needs it starts,
     * and taken out again when it stops, so most of the time the render has a plain wire. */
    ducker: (function () {
      let nodes = null;
      function build() {
        const ctx = J.audio.context();
        const { from, to } = J.audio.bed();
        from.disconnect();
        const sum = ctx.createGain();
        sum.connect(to);
        const gains = BAND_FILTERS.map((list) => {
          const chain = filters(ctx, list);
          const gain = ctx.createGain();
          from.connect(chain.input);
          chain.output.connect(gain).connect(sum);
          return gain;
        });
        nodes = { from, to, sum, gains };
      }
      return {
        /* Follow these curves from song position `pos`, which is heard at context time `when`. */
        play(curves, pos, when) {
          if (!nodes) build();
          const start = Math.max(0, Math.floor(pos * RATE));
          nodes.gains.forEach((g, b) => {
            g.gain.cancelScheduledValues(0);
            g.gain.setValueAtTime(1, J.audio.context().currentTime);
            const rest = curves[b].subarray(start);
            if (rest.length > 1) g.gain.setValueCurveAtTime(rest, when, rest.length / RATE);
          });
        },
        off() {
          if (!nodes) return;
          try { nodes.from.disconnect(); } catch (e) { /* already */ }
          try { nodes.sum.disconnect(); } catch (e) { /* already */ }
          nodes.from.connect(nodes.to);
          nodes = null;
        },
        get on() { return !!nodes; },
      };
    })(),

    status,
  };
})();

/* The vocal edit, for one take. Everything saves as it changes; Done just closes. */
J.editVocal = function (take, opts) {
  const { mayChange, changed } = opts;
  const K = J.vocalFx.KINDS;
  const chain = (take.chain || []).map((fx) => Object.assign(K[fx.type] ? K[fx.type].make() : {}, fx));
  take.chain = chain;
  let root = null;
  let dragFrom = -1;
  let dirty = false;

  const save = J.debounce(async () => {
    if (!dirty) return;
    dirty = false;
    await J.try(() => J.patch(`/api/vocals/${take.id}`, { chain }));
  }, 400);
  const mark = () => { dirty = true; save(); };

  const say = {
    none: "", waiting: "Renders when you stop", rendering: "Rendering...",
    ready: "Up to date", failed: "Could not render this",
  };
  const fmt = (v, unit) => (unit === "Hz" && v === 20 ? "off" : `${Math.abs(v) < 10 && v % 1 ? v.toFixed(1) : Math.round(v * 10) / 10} ${unit}`);
  const fill = (v, min, max) => `--fill:${((v - min) / (max - min)) * 100}%`;
  const lock = mayChange ? "" : " disabled";

  function card(fx, i) {
    const kind = K[fx.type];
    return `
      <div class="fx-card${fx.on ? "" : " off"}" data-i="${i}">
        <div class="fx-head">
          ${mayChange ? '<span class="fx-grip" draggable="true" title="Drag to move" aria-hidden="true">&equiv;</span>' : ""}
          <b class="grow">${J.esc(kind.label)}</b>
          <button class="switch${fx.on ? " on" : ""}" data-fx="on" aria-label="Use this effect"${lock}></button>
          ${mayChange ? `
            <button class="icon-btn" data-fx="up" aria-label="Earlier"${i ? "" : " disabled"}>&uarr;</button>
            <button class="icon-btn" data-fx="down" aria-label="Later"${i < chain.length - 1 ? "" : " disabled"}>&darr;</button>
            <button class="icon-btn" data-fx="drop" aria-label="Remove">&times;</button>` : ""}
        </div>
        <div class="fx-knobs">
          ${(kind.picks || []).map(([key, label, options]) => `
            <label class="fx-pick"><span>${label}</span>
              <select class="field sm" data-key="${key}"${lock}>${options.map(([v, text]) =>
                `<option value="${v}"${String(fx[key]) === String(v) ? " selected" : ""}>${J.esc(text)}</option>`).join("")}
              </select></label>`).join("")}
          ${kind.knobs.map(([key, label, min, max, step, unit]) => `
            <div class="knob-row">
              <div class="lab"><span>${label}</span><b data-show="${key}">${fmt(fx[key], unit)}</b></div>
              <input class="range" type="range" data-key="${key}" data-unit="${unit}" min="${min}" max="${max}"
                     step="${step}" value="${fx[key]}" style="${fill(fx[key], min, max)}"${lock}>
            </div>`).join("")}
        </div>
      </div>`;
  }

  function draw() {
    const list = J.$("[data-chain]", root);
    list.innerHTML = chain.length ? chain.map(card).join("")
      : `<p class="faint fx-empty">No effects yet. Add one below; they run top to bottom.</p>`;
    J.$("[data-fxon]", root).classList.toggle("on", take.fx !== 0);
    showState();
  }

  function showState() {
    const el = J.$("[data-state]", root);
    if (el) el.textContent = say[J.vocalFx.status(take)] || "";
  }

  const structural = () => { draw(); mark(); J.vocalFx.touch(); changed(); };

  const onState = (e) => { if (e.detail && e.detail.id === take.id && root && root.isConnected) showState(); };
  J.on("vocals:fx", onState);

  return J.sheet({
    title: `Vocal edit: ${take.name || "Take"}`,
    sub: mayChange ? "Effects run top to bottom. Drag or use the arrows to change the order."
      : "Only whoever recorded this take can change its edit.",
    wide: true,
    confirm: "",
    cancel: "Done",
    body: `
      <div class="fx-top">
        <span>Edit on</span>
        <button class="switch" data-fxon aria-label="Use the vocal edit"${lock}></button>
        <span class="grow"></span>
        <span class="faint" data-state></span>
      </div>
      <div class="fx-chain" data-chain></div>
      ${mayChange ? `<div class="fx-add">${Object.keys(K).map((type) =>
        `<button class="btn sm ghost" data-add="${type}">+ ${J.esc(K[type].label)}</button>`).join("")}</div>` : ""}`,
    onMount(sheet) {
      root = sheet;
      draw();
      sheet.addEventListener("input", (e) => {
        const input = e.target.closest("[data-key]");
        const at = input && input.closest("[data-i]");
        if (!at || !mayChange) return;
        const fx = chain[Number(at.dataset.i)];
        const key = input.dataset.key;
        fx[key] = input.tagName === "SELECT"
          ? (key === "key" ? Number(input.value) : input.value) : Number(input.value);
        if (input.type === "range") {
          input.style.setProperty("--fill", `${((fx[key] - input.min) / (input.max - input.min)) * 100}%`);
          const shown = J.$(`[data-show="${key}"]`, at);
          if (shown) shown.textContent = fmt(fx[key], input.dataset.unit);
        }
        mark();
        J.vocalFx.touch();
        changed();
      });
      sheet.addEventListener("click", async (e) => {
        if (!mayChange) return;
        const add = e.target.closest("[data-add]");
        if (add) { chain.push(K[add.dataset.add].make()); structural(); return; }
        if (e.target.closest("[data-fxon]")) {
          take.fx = take.fx === 0 ? 1 : 0;
          draw();
          await J.try(() => J.patch(`/api/vocals/${take.id}`, { fx: take.fx }));
          changed();
          J.emit("vocals:rendered", { id: take.id });      // heard with it, or without, now
          return;
        }
        const btn = e.target.closest("[data-fx]");
        const at = btn && btn.closest("[data-i]");
        if (!at) return;
        const i = Number(at.dataset.i);
        const what = btn.dataset.fx;
        if (what === "on") chain[i].on = !chain[i].on;
        else if (what === "up" && i > 0) chain.splice(i - 1, 0, chain.splice(i, 1)[0]);
        else if (what === "down" && i < chain.length - 1) chain.splice(i + 1, 0, chain.splice(i, 1)[0]);
        else if (what === "drop") chain.splice(i, 1);
        structural();
      });
      sheet.addEventListener("dragstart", (e) => {
        // Only from the grip: a card that drags from anywhere takes its sliders with it.
        const at = e.target.closest && e.target.closest(".fx-grip") && e.target.closest("[data-i]");
        if (!at) return;
        dragFrom = Number(at.dataset.i);
        e.dataTransfer.effectAllowed = "move";
        at.classList.add("dragging");
      });
      sheet.addEventListener("dragover", (e) => {
        if (dragFrom < 0) return;
        e.preventDefault();
        J.$$(".fx-card", sheet).forEach((c) => c.classList.toggle("drop-here",
          c.contains(e.target) && Number(c.dataset.i) !== dragFrom));
      });
      sheet.addEventListener("drop", (e) => {
        const at = e.target.closest("[data-i]");
        if (dragFrom < 0 || !at) return;
        e.preventDefault();
        const to = Number(at.dataset.i);
        if (to !== dragFrom) chain.splice(to, 0, chain.splice(dragFrom, 1)[0]);
        dragFrom = -1;
        structural();
      });
      sheet.addEventListener("dragend", () => {
        dragFrom = -1;
        J.$$(".fx-card", sheet).forEach((c) => c.classList.remove("dragging", "drop-here"));
      });
    },
  }).then(() => {
    save.now();
    J.bus.removeEventListener("vocals:fx", onState);
  });
};
