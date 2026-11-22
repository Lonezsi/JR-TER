// mixgraph.js: the mixer as Web Audio nodes. Model and maths: mixer.js.
//
//   const mix = createMixer(ctx);
//   mix.input(i)   the node track i's instrument plays into
//   mix.master()   a node that goes straight to the master (previews)
//   mix.sync(song) make the graph match the song (cheap; call after any change)
//   mix.cut()      silence hanging tails
//   mix.levels()   { tracks: [dB...], master: dB } for the meters
//
// Track: input -> inserts -> pan -> fader -> meter -> master bus, and fader -> send gains -> buses.
// Bus:   input -> inserts -> volume -> master bus.
// Master: bus -> inserts -> volume -> limiter -> meter -> speakers.
import { FX, ensureMix, trackGain, impulse, distCurve, level, chainKey } from "./mixer.js";

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
  function build(fx) {
    if (fx.type === "eq") {
      const lo = ctx.createBiquadFilter(), mid = ctx.createBiquadFilter(), hi = ctx.createBiquadFilter();
      lo.type = "lowshelf"; lo.frequency.value = 200;
      mid.type = "peaking"; mid.frequency.value = 1000; mid.Q.value = 0.8;
      hi.type = "highshelf"; hi.frequency.value = 5000;
      lo.connect(mid); mid.connect(hi);
      return { in: lo, out: hi, set: (p) => { lo.gain.value = p.low; mid.gain.value = p.mid; hi.gain.value = p.high; } };
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
      const live = fxList.filter((f) => f.on);
      const k = chainKey(fxList);
      if (k !== key) {
        key = k;
        head.disconnect();
        for (const n of nodes) { try { n.out.disconnect(); } catch { /* already free */ } }
        nodes = live.map(build);
        let prev = head;
        for (const n of nodes) { prev.connect(n.in); prev = n.out; }
        prev.connect(tail);
      }
      live.forEach((f, i) => nodes[i].set(f));
    };
  }

  const analyser = () => { const a = ctx.createAnalyser(); a.fftSize = 512; return a; };
  const peak = (a, buf) => { a.getFloatTimeDomainData(buf); return level(buf); };
  const buf = new Float32Array(512);

  // master
  const bus = gain(1), masterVol = gain(0.8), limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -1; limiter.knee.value = 0; limiter.ratio.value = 20;
  limiter.attack.value = 0.003; limiter.release.value = 0.1;
  const masterMeter = analyser();
  const masterHead = gain(1);
  bus.connect(masterHead);
  const masterChain = chain(masterHead, masterVol);
  masterVol.connect(limiter); limiter.connect(masterMeter); masterMeter.connect(ctx.destination);
  const direct = gain(1); direct.connect(bus);

  // the two send buses
  const buses = [0, 1].map(() => {
    const inp = gain(1), vol = gain(0.8);
    vol.connect(bus);
    return { inp, vol, apply: chain(inp, vol) };
  });

  const strips = [];
  function addStrip() {
    const inp = gain(1), pan = ctx.createStereoPanner(), fader = gain(0.8), meter = analyser();
    const sends = [gain(0), gain(0)];
    pan.connect(fader); fader.connect(meter); meter.connect(bus);
    sends.forEach((s, i) => { fader.connect(s); s.connect(buses[i].inp); });
    const head = gain(1); inp.connect(head);
    const s = { inp, head, pan, fader, meter, sends, apply: chain(head, pan) };
    strips.push(s);
  }

  return {
    input: (i) => { while (strips.length <= i) addStrip(); return strips[i].inp; },
    master: () => direct,
    sync(song) {
      ensureMix(song);
      while (strips.length < song.tracks.length) addStrip();
      while (strips.length > song.tracks.length) { const s = strips.pop(); s.inp.disconnect(); s.head.disconnect(); s.pan.disconnect(); s.fader.disconnect(); s.meter.disconnect(); s.sends.forEach((g) => g.disconnect()); }
      const solo = song.tracks.some((t) => t.solo);
      song.tracks.forEach((t, i) => {
        const s = strips[i];
        s.apply(t.fx);
        ease(s.pan.pan, t.pan);
        ease(s.fader.gain, trackGain(t, solo));
        t.sends.forEach((v, k) => ease(s.sends[k].gain, v));
      });
      song.mixer.buses.forEach((b, i) => { buses[i].apply(b.fx); ease(buses[i].vol.gain, b.volume); });
      masterChain(song.mixer.master.fx);
      ease(masterVol.gain, song.mixer.master.volume);
    },
    cut() {
      for (const s of strips) {
        s.inp.disconnect();
        s.inp = gain(1); s.inp.connect(s.head);
      }
    },
    levels: () => ({ tracks: strips.map((s) => peak(s.meter, buf)), master: peak(masterMeter, buf) }),
  };
}
