/* What a filter type is called on screen. The names say what is cut: a high pass filter
 * removes the lows, so it is the Low cut. (The shared TYPE_LABEL has the pair the other
 * way round, which made the Low cut button add a band called High cut.) */
import { TYPE_LABEL } from "$lib/audio/eq";

export const LABEL: Record<BiquadFilterType, string> = {
  ...TYPE_LABEL, highpass: "Low cut", lowpass: "High cut",
};
