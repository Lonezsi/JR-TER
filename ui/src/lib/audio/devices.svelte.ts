/* Which microphone records and which speakers or headphones play, chosen on the Vocals
 * panel and remembered in this browser (devices differ per machine, so not per account).
 *
 * The output applies to everything the app plays: the whole engine runs through one
 * AudioContext, and that is what gets pointed at the device (setSinkId, where the browser
 * has it; elsewhere the picker isn't shown).
 *
 *   devices                       { inputs, outputs, input, output, named }
 *   refreshDevices()              list them again (names appear once the mic is allowed)
 *   setInput(id), setOutput(id)
 *   micConstraint()               the deviceId part of getUserMedia's audio constraints
 *   applyOutput(ctx)              point an AudioContext at the chosen output
 *   canPickOutput()
 */
const IN_KEY = "jriter.mic", OUT_KEY = "jriter.speaker";
const read = (k: string) => { try { return localStorage.getItem(k) || ""; } catch { return ""; } };
const write = (k: string, v: string) => { try { if (v) localStorage.setItem(k, v); else localStorage.removeItem(k); } catch { /* private mode */ } };

export const devices = $state({
  inputs: [] as MediaDeviceInfo[],
  outputs: [] as MediaDeviceInfo[],
  input: read(IN_KEY),
  output: read(OUT_KEY),
  /** False until the browser gives names (it only does after the mic has been allowed). */
  named: false,
});

export async function refreshDevices() {
  if (!navigator.mediaDevices?.enumerateDevices) return;
  try {
    const all = await navigator.mediaDevices.enumerateDevices();
    devices.inputs = all.filter((d) => d.kind === "audioinput" && d.deviceId !== "default" && d.deviceId !== "communications");
    devices.outputs = all.filter((d) => d.kind === "audiooutput" && d.deviceId !== "default" && d.deviceId !== "communications");
    devices.named = all.some((d) => !!d.label);
  } catch { /* nothing to list */ }
}

export function setInput(id: string) { devices.input = id; write(IN_KEY, id); }

type SinkContext = AudioContext & { setSinkId?: (id: string) => Promise<void> };
let current: SinkContext | null = null;
export const canPickOutput = () => typeof AudioContext !== "undefined" && "setSinkId" in AudioContext.prototype;

export function applyOutput(ctx: AudioContext | null) {
  current = ctx as SinkContext | null;
  if (current?.setSinkId) current.setSinkId(devices.output || "").catch(() => { /* gone: stays on default */ });
}
export function setOutput(id: string) {
  devices.output = id; write(OUT_KEY, id);
  applyOutput(current);
}

export function micConstraint(): MediaTrackConstraints {
  return devices.input ? { deviceId: { ideal: devices.input } } : {};
}

if (typeof navigator !== "undefined" && navigator.mediaDevices?.addEventListener) {
  navigator.mediaDevices.addEventListener("devicechange", () => { void refreshDevices(); });
}
