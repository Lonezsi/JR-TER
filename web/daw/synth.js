// synth.js: a few small instruments made of Web Audio nodes. No samples, no libraries.
// createSynth(ctx).playNote({instrument, pitch, time, length, velocity}, destination)

export const INSTRUMENTS = ["piano", "pad", "bass", "pluck", "drums"];

// General MIDI program number (and channel 10 = drums) to one of ours.
export function instrumentFor(program, channel) {
  if (channel === 9) return "drums";
  if (program >= 32 && program <= 39) return "bass";
  if (program >= 24 && program <= 31) return "pluck";
  if ((program >= 48 && program <= 55) || (program >= 88 && program <= 95)) return "pad";
  return "piano";
}

export function createSynth(ctx) {
  let noise = null;
  const noiseBuffer = () => {
    if (noise) return noise;
    noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return noise;
  };
  const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);

  function envelope(dest, time, peak, attack, hold, release) {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, time);
    g.gain.linearRampToValueAtTime(peak, time + attack);
    g.gain.setValueAtTime(peak, time + Math.max(attack, hold));
    g.gain.exponentialRampToValueAtTime(0.0001, time + Math.max(attack, hold) + release);
    g.connect(dest);
    return { g, end: time + Math.max(attack, hold) + release };
  }

  function osc(type, freq, time, end, dest, detune = 0) {
    const o = ctx.createOscillator();
    o.type = type; o.frequency.value = freq; o.detune.value = detune;
    o.connect(dest); o.start(time); o.stop(end + 0.05);
  }

  function noiseHit(time, dur, type, freq, peak, dest) {
    const s = ctx.createBufferSource(); s.buffer = noiseBuffer();
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq;
    const { g, end } = envelope(dest, time, peak, 0.002, 0.005, dur);
    s.connect(f); f.connect(g); s.start(time); s.stop(end + 0.05);
  }

  function drum(pitch, time, vel, dest) {
    if (pitch === 35 || pitch === 36) {
      const o = ctx.createOscillator(); o.type = "sine";
      o.frequency.setValueAtTime(150, time);
      o.frequency.exponentialRampToValueAtTime(45, time + 0.12);
      const { g, end } = envelope(dest, time, vel, 0.002, 0.02, 0.25);
      o.connect(g); o.start(time); o.stop(end + 0.05);
    } else if (pitch === 38 || pitch === 40) {
      noiseHit(time, 0.18, "bandpass", 1800, vel * 0.8, dest);
      const o = ctx.createOscillator(); o.type = "triangle"; o.frequency.value = 190;
      const { g, end } = envelope(dest, time, vel * 0.5, 0.002, 0.01, 0.1);
      o.connect(g); o.start(time); o.stop(end + 0.05);
    } else if (pitch === 42 || pitch === 44) noiseHit(time, 0.05, "highpass", 7000, vel * 0.5, dest);
    else if (pitch === 46) noiseHit(time, 0.3, "highpass", 7000, vel * 0.5, dest);
    else noiseHit(time, 0.08, "bandpass", 400 + (pitch % 12) * 150, vel * 0.5, dest);
  }

  function playNote({ instrument, pitch, time, length, velocity }, dest) {
    const vel = Math.max(0.02, Math.min(1, (velocity || 90) / 127));
    const f = hz(pitch), stop = time + Math.max(0.05, length);
    if (instrument === "drums") return drum(pitch, time, vel, dest);
    if (instrument === "pad") {
      const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 1400;
      const { g, end } = envelope(dest, time, vel * 0.22, 0.25, length, 0.6);
      lp.connect(g);
      osc("sawtooth", f, time, end, lp, -8); osc("sawtooth", f, time, end, lp, 8);
    } else if (instrument === "bass") {
      const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 520;
      const { g, end } = envelope(dest, time, vel * 0.5, 0.008, length, 0.12);
      lp.connect(g); osc("square", f, time, end, lp); osc("sine", f, time, end, lp);
    } else if (instrument === "pluck") {
      const lp = ctx.createBiquadFilter(); lp.type = "lowpass";
      lp.frequency.setValueAtTime(5000, time);
      lp.frequency.exponentialRampToValueAtTime(600, time + 0.25);
      const { g, end } = envelope(dest, time, vel * 0.3, 0.003, 0.01, Math.min(0.5, 0.15 + length));
      lp.connect(g); osc("sawtooth", f, time, end, lp);
    } else {
      const { g, end } = envelope(dest, time, vel * 0.35, 0.005, Math.min(length, 0.15), 0.35 + Math.min(1, length));
      osc("triangle", f, time, end, g); osc("sine", f * 2, time, end, g, 3);
    }
    return stop;
  }

  return { playNote };
}
