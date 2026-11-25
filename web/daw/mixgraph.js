// mixgraph.js: the mixer as Web Audio nodes. Model and maths: mixer.js.
//
//   const mix = createMixer(ctx);
//   mix.input(i)   the node track i's instrument plays into
//   mix.master()   a node that goes straight to the master (previews)
//   mix.sync(song) make the graph match the song (cheap; call after any change)
//   mix.cut()      silence hanging tails
//   mix.ready()    a promise that settles when every plugin that is loading has loaded or failed
//   mix.plugins()  [{ fx, status: "loading"|"on"|"blocked"|"failed", error, inst }] for the plugin effects now in the graph
//   mix.levels()   { tracks: [dB...], buses: [dB...], master: dB } for the meters
//
// Track: input -> inserts -> pan -> fader -> meter -> its out (the master or a bus), and
//        fader -> one send gain per bus -> that bus.
// Bus:   input -> inserts -> pan -> volume -> meter -> its out (the master or another bus), and
//        a mute that is a gain at 0.
// Master: bus -> inserts -> volume -> limiter (rack.js, MASTER_LIMITER) -> meter -> speakers.
// Outputs are rewired only when they change; mixer.js keeps buses from going round in a loop.
import { FX, MASTER_LIMITER, ensureMix, trackGain, impulse, distCurve, level, chainKey } from "./mixer.js";
import { allowed, loadPlugin } from "./wamhost.js";
import { buildUnit } from "./rack.js";

export function createMixer(ctx) {
  const gain = (v = 1) => { const g = ctx.createGain(); g.gain.value = v; return g; };
  const reverbCache = new Map();
  const at = () => ctx.currentTime;
  const ease = (param, v) => param.setTargetAtTime(v, at(), 0.02);

  // One effect: { in, out, set(fx) }. dry/wet effects share wet().
  function wetDry(inp, wetOut) {
    const out = gain(), dry = gain(1), wet = gain(0.3);
    inp.connect(dry); dry.connect(out); wetOut.connect(wet); wet.connect(out);
    return { out, mix: (m) => { ease(dry.gain, 1 - m / 2); ease(wet.gain, m); } };
  }
  // Plugins (WAM): sound passes straight through until the plugin has loaded, and for good if it is
  // blocked (its site not allowed here) or fails. `live` holds one status per plugin in the graph.
  const live = new Set(), pending = new Set();
  function plugin(fx) {
    const inp = gain(1), out = gain(1);
    inp.connect(out);
    const st = { fx, status: "blocked", error: "", inst: null };
    live.add(st);
    if (fx.url && allowed(fx.url)) {
      st.status = "loading";
      const job = loadPlugin(ctx, fx.url, fx.state).then((inst) => {
        if (!live.has(st)) { inst.destroy(); return; } // taken out while loading
        st.inst = inst; st.status = "on";
        inp.disconnect(); inp.connect(inst.node); inst.node.connect(out);
      }, (e) => { st.status = "failed"; st.error = (e && e.message) || "The plugin would not load."; })
        .finally(() => pending.delete(job));
      pending.add(job);
    }
    return { in: inp, out, set: () => {}, destroy: () => {
      live.delete(st);
      if (st.inst) { try { st.inst.node.disconnect(); } catch { /* gone */ } st.inst.destroy(); st.inst = null; }
    } };
  }
  function build(fx) {
    if (fx.type === "wam") return plugin(fx);
    if (fx.type === "eq") {
      const u = buildUnit(ctx, { id: "eq", kind: "eq", on: true }, { bands: fx.bands });
      return { in: u.input, out: u.output, set: (p) => u.set(null, { bands: p.bands }) };
    }
    if (fx.type === "comp") {
      const c = ctx.createDynamicsCompressor(); c.knee.value = 6;
      return { in: c, out: c, set: (p) => { c.threshold.value = p.threshold; c.ratio.value = p.ratio; c.attack.value = p.attack; c.release.value = p.release; } };
    }
    if (fx.type === "dist") {
      const inp = gain(), shaper = ctx.createWaveShaper(); shaper.oversample = "4x";
      inp.connect(shaper);
      const w = wetDry(inp, shaper); let last = -1;
      return { in: inp, out: w.out, set: (p) => { if (p.drive !== last) { shaper.curve = distCurve(p.drive); last = p.drive; } w.mix(p.mix); } };
    }
    if (fx.type === "delay") {
      const inp = gain(), d = ctx.createDelay(2), fb = gain(0.3);
      inp.connect(d); d.connect(fb); fb.connect(d);
      const w = wetDry(inp, d);
      return { in: inp, out: w.out, set: (p) => { ease(d.delayTime, p.time); ease(fb.gain, p.feedback); w.mix(p.mix); } };
    }
    if (fx.type === "limiter") {
      const u = buildUnit(ctx, { ...fx, kind: "limiter" }, {});
      return { in: u.input, out: u.output, set: (p) => u.set({ ...p, kind: "limiter" }) };
    }
    const inp = gain(), conv = ctx.createConvolver(); // reverb
    inp.connect(conv);
    const w = wetDry(inp, conv); let last = -1;
    return { in: inp, out: w.out, set: (p) => {
      const key = Math.round(p.size * 10);
      if (key !== last) {
        last = key;
        if (!reverbCache.has(key)) {
          const [l, r] = impulse(key / 10, ctx.sampleRate);
          const buf = ctx.createBuffer(2, l.length, ctx.sampleRate);
          buf.copyToChannel(l, 0); buf.copyToChannel(r, 1);
          reverbCache.set(key, buf);
        }
        conv.buffer = reverbCache.get(key);
      }
      w.mix(p.mix);
    } };
  }

  // A chain sits between `head` and `tail`. rebuild() rewires when effects were added/removed/bypassed.
  function chain(head, tail) {
    let key = null, nodes = [];
    head.connect(tail);
    return (fxList) => {
      const liveFx = fxList.filter((f) => f.on);
      const k = chainKey(fxList);
      if (k !== key) {
        key = k;
        head.disconnect();
        for (const n of nodes) { try { n.out.disconnect(); } catch { /* already free */ } if (n.destroy) n.destroy(); }
        nodes = liveFx.map(build);
        let prev = head;
        for (const n of nodes) { prev.connect(n.in); prev = n.out; }
        prev.connect(tail);
      }
      liveFx.forEach((f, i) => nodes[i].set(f));
    };
  }

  const analyser = () => { const a = ctx.createAnalyser(); a.fftSize = 512; return a; };
  const peak = (a, buf) => { a.getFloatTimeDomainData(buf); return level(buf); };
  const buf = new Float32Array(512);

  // master
  const bus = gain(1), masterVol = gain(0.8), limiter = buildUnit(ctx, MASTER_LIMITER, {});
  const masterMeter = analyser();
  const masterHead = gain(1);
  bus.connect(masterHead);
  const masterChain = chain(masterHead, masterVol);
  masterVol.connect(limiter.input); limiter.output.connect(masterMeter); masterMeter.connect(ctx.destination);
  const direct = gain(1); direct.connect(bus);

  // The buses: as many as the song has, made when first needed.
  const buses = [];
  function addBus() {
    const inp = gain(1), pan = ctx.createStereoPanner(), vol = gain(0.8), meter = analyser();
    pan.connect(vol); vol.connect(meter);
    const b = { inp, pan, vol, meter, out: null, apply: chain(inp, pan) };
    buses.push(b);
  }
  const dest = (o) => (o && o !== "m" && buses[+o.slice(1)] ? buses[+o.slice(1)].inp : bus);
  // Point a meter (the last node of a strip or a bus) at where it goes, if that changed.
  function route(x, o) {
    if (x.out === o) return;
    try { x.meter.disconnect(); } catch { /* not connected yet */ }
    x.meter.connect(dest(o));
    x.out = o;
  }

  const strips = [];
  function addStrip() {
    const inp = gain(1), pan = ctx.createStereoPanner(), fader = gain(0.8), meter = analyser();
    pan.connect(fader); fader.connect(meter);
    const head = gain(1); inp.connect(head);
    const s = { inp, head, pan, fader, meter, sends: [], out: null, apply: chain(head, pan) };
    strips.push(s);
  }
  // A send per bus, from the strip's fader to that bus's input.
  function sendsFor(s, n) {
    while (s.sends.length < n) { const g = gain(0); s.fader.connect(g); g.connect(buses[s.sends.length].inp); s.sends.push(g); }
    while (s.sends.length > n) s.sends.pop().disconnect();
  }

  return {
    input: (i) => { while (strips.length <= i) addStrip(); return strips[i].inp; },
    master: () => direct,
    sync(song) {
      ensureMix(song);
      const nb = song.mixer.buses.length;
      while (buses.length < nb) addBus();
      // Fewer buses than before: the extra ones go quiet and are unhooked, everything is re-pointed below.
      while (buses.length > nb) { const b = buses.pop(); for (const s of strips) if (s.sends.length > buses.length) s.sends.pop().disconnect(); b.inp.disconnect(); b.pan.disconnect(); b.vol.disconnect(); b.meter.disconnect(); for (const x of [...strips, ...buses]) if (x.out && x.out !== "m") x.out = null; }
      while (strips.length < song.tracks.length) addStrip();
      while (strips.length > song.tracks.length) { const s = strips.pop(); s.inp.disconnect(); s.head.disconnect(); s.pan.disconnect(); s.fader.disconnect(); s.meter.disconnect(); s.sends.forEach((g) => g.disconnect()); }
      const solo = song.tracks.some((t) => t.solo);
      song.tracks.forEach((t, i) => {
        const s = strips[i];
        s.apply(t.fx);
        ease(s.pan.pan, t.pan);
        ease(s.fader.gain, trackGain(t, solo));
        sendsFor(s, nb);
        t.sends.forEach((v, k) => ease(s.sends[k].gain, v));
        route(s, t.out);
      });
      song.mixer.buses.forEach((b, i) => {
        const x = buses[i];
        x.apply(b.fx);
        ease(x.pan.pan, b.pan);
        ease(x.vol.gain, b.mute ? 0 : b.volume);
        route(x, b.out);
      });
      masterChain(song.mixer.master.fx);
      ease(masterVol.gain, song.mixer.master.volume);
    },
    cut() {
      for (const s of strips) {
        s.inp.disconnect();
        s.inp = gain(1); s.inp.connect(s.head);
      }
    },
    ready: () => Promise.allSettled([...pending]),
    plugins: () => [...live].map((x) => ({ ...x })),
    levels: () => ({ tracks: strips.map((s) => peak(s.meter, buf)), buses: buses.map((b) => peak(b.meter, buf)), master: peak(masterMeter, buf) }),
  };
}
