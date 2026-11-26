/* A WAV, written by hand.
 *
 * PUBLIC API
 *   encodeWav(buffer, maxChannels?)  an AudioBuffer as a 16 bit PCM WAV Blob
 *
 * Sixteen bit because that is what everything downstream expects and it halves the size
 * of a file that is about to be uploaded. Dithering is deliberately absent: this is a
 * delivery copy, not a mix step, and a dither nobody asked for is a change to the sound
 * made behind their back.
 */
export function encodeWav(buffer: AudioBuffer, maxChannels = 32): Blob {
  const channels = Math.max(1, Math.min(maxChannels, buffer.numberOfChannels));
  const frames = buffer.length;
  const rate = buffer.sampleRate;
  const view = new DataView(new ArrayBuffer(44 + frames * channels * 2));

  const text = (at: number, value: string) => {
    for (let i = 0; i < value.length; i++) view.setUint8(at + i, value.charCodeAt(i));
  };
  text(0, "RIFF");
  view.setUint32(4, 36 + frames * channels * 2, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true);            // PCM header length
  view.setUint16(20, 1, true);             // PCM
  view.setUint16(22, channels, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * channels * 2, true);
  view.setUint16(32, channels * 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, frames * channels * 2, true);

  const lanes: Float32Array[] = [];
  for (let c = 0; c < channels; c++) lanes.push(buffer.getChannelData(c));

  let at = 44;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < channels; c++) {
      // Clamped: anything past full scale would wrap round to the opposite polarity.
      const sample = Math.max(-1, Math.min(1, lanes[c][i]));
      view.setInt16(at, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true);
      at += 2;
    }
  }
  return new Blob([view], { type: "audio/wav" });
}
