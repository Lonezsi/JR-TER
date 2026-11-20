/* Colour arithmetic: the accent band, and reading a hue off a picture.
 *
 * Neon: as saturated as the app can carry, and never a dark colour. Those two fight at
 * one hue (a saturated blue is dark however it is mixed), so the lightness is solved per
 * hue: the lowest, and so the most vivid, that still clears NEON_FLOOR against the black
 * page. Nothing falls below 5:1 as text and neighbouring hues differ by at most two
 * points of lightness, so moving through the colours of a sleeve does not band.
 */

export const NEON_SAT = 95;
export const NEON_FLOOR = 5.0;
export const NEON_LIGHT_MIN = 45;
export const NEON_LIGHT_MAX = 90;

export interface Rgb { r: number; g: number; b: number }

export function rgb(hex: string | null | undefined): Rgb {
  const value = String(hex || "").replace("#", "");
  const full = value.length === 3 ? value.split("").map((c) => c + c).join("") : value;
  const n = parseInt(full, 16);
  return Number.isFinite(n) ? { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }
                            : { r: 250, g: 168, b: 184 };
}

export const alpha = (hex: string, a: number) => {
  const { r, g, b } = rgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
};

export function hslHex(h: number, s: number, l: number): string {
  const sat = s / 100;
  const light = l / 100;
  const c = (1 - Math.abs(2 * light - 1)) * sat;
  const hue = ((h % 360) + 360) % 360;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = light - c / 2;
  const table = [[c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x]];
  const [r, g, b] = table[Math.floor(hue / 60) % 6];
  const to = (v: number) => Math.round((v + m) * 255).toString(16).padStart(2, "0");
  return `#${to(r)}${to(g)}${to(b)}`.toUpperCase();
}

export function luminance(hex: string): number {
  const { r, g, b } = rgb(hex);
  const channel = (v: number) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export const contrastOnBlack = (hex: string) => (luminance(hex) + 0.05) / 0.05;

/** A hue, neonised: the most vivid version of it this app can put text on. */
export function neon(hue: number): string {
  let lo = NEON_LIGHT_MIN;
  let hi = NEON_LIGHT_MAX;
  if (contrastOnBlack(hslHex(hue, NEON_SAT, lo)) >= NEON_FLOOR) return hslHex(hue, NEON_SAT, lo);
  for (let i = 0; i < 20; i++) {
    const mid = (lo + hi) / 2;
    if (contrastOnBlack(hslHex(hue, NEON_SAT, mid)) >= NEON_FLOOR) hi = mid;
    else lo = mid;
  }
  return hslHex(hue, NEON_SAT, hi);
}

const seen = new Map<string, number | null>();

/** The dominant hue of a picture this app serves, or null when it is grey or unreadable.
 *  One sample per url: they do not change. */
export function hueOfImage(url: string | null | undefined): Promise<number | null> {
  if (!url) return Promise.resolve(null);
  if (seen.has(url)) return Promise.resolve(seen.get(url) ?? null);
  return new Promise((resolve) => {
    const img = new Image();
    img.onerror = () => { seen.set(url, null); resolve(null); };
    img.onload = () => {
      let hue: number | null = null;
      try {
        const size = 32;
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = size;
        const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
        ctx.drawImage(img, 0, 0, size, size);
        const data = ctx.getImageData(0, 0, size, size).data;
        let sin = 0, cos = 0, weight = 0;
        for (let i = 0; i < data.length; i += 4) {
          if (data[i + 3] < 128) continue;
          const r = data[i] / 255, g = data[i + 1] / 255, b = data[i + 2] / 255;
          const max = Math.max(r, g, b), min = Math.min(r, g, b);
          const light = (max + min) / 2;
          const delta = max - min;
          if (delta < 0.02) continue;
          const sat = delta / (1 - Math.abs(2 * light - 1) || 1);
          let h: number;
          if (max === r) h = ((g - b) / delta) % 6;
          else if (max === g) h = (b - r) / delta + 2;
          else h = (r - g) / delta + 4;
          h *= 60;
          // Colourful and mid toned counts most: the ends are where a hue is least
          // trustworthy and least visible.
          const w = sat * (1 - Math.abs(2 * light - 1));
          const rad = (h * Math.PI) / 180;
          sin += Math.sin(rad) * w;
          cos += Math.cos(rad) * w;
          weight += w;
        }
        if (weight > 0.5) hue = ((Math.atan2(sin, cos) * 180) / Math.PI + 360) % 360;
      } catch { hue = null; }
      seen.set(url, hue);
      resolve(hue);
    };
    img.src = url;
  });
}
