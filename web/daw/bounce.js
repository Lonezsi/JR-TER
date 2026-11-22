// bounce.js: turning a rendered song into a .wav file. Pure functions, no page needed.
// The DAW renders in an OfflineAudioContext (daw.js, bounce()), then hands the channels here.

// Seconds to render for a song that is `beats` long: the song plus a tail for reverb and delay.
export function bounceSeconds(beats, bpm, tail = 2) {
  return (beats * 60) / bpm + tail;
}

// 16-bit PCM WAV. channels: array of Float32Array of equal length. Returns Uint8Array.
export function encodeWav(channels, sampleRate) {
  const n = channels.length, frames = n ? channels[0].length : 0;
  const bytes = frames * n * 2;
  const buf = new ArrayBuffer(44 + bytes), v = new DataView(buf);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, "RIFF"); v.setUint32(4, 36 + bytes, true); str(8, "WAVE");
  str(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, n, true);
  v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * n * 2, true);
  v.setUint16(32, n * 2, true); v.setUint16(34, 16, true);
  str(36, "data"); v.setUint32(40, bytes, true);
  let o = 44;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < n; c++) {
      const s = Math.max(-1, Math.min(1, channels[c][i]));
      v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true); o += 2;
    }
  }
  return new Uint8Array(buf);
}
