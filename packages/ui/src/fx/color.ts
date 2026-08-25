export type Hsb = { h: number; s: number; b: number };

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const to255 = (v: number): number => Math.round(clamp(v, 0, 1) * 255);

export function hsbToNum({ h, s, b }: Hsb): number {
  h = ((h % 360) + 360) % 360; s = clamp(s, 0, 1); b = clamp(b, 0, 1);
  const c = b * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = b - c;
  const seg = Math.floor(h / 60) % 6;
  const [r, g, bl] = ([[c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x]] as const)[seg];
  return (to255(r + m) << 16) | (to255(g + m) << 8) | to255(bl + m);
}

export function numToHsb(n: number): Hsb {
  const r = ((n >> 16) & 0xff) / 255, g = ((n >> 8) & 0xff) / 255, bl = (n & 0xff) / 255;
  const max = Math.max(r, g, bl), min = Math.min(r, g, bl), d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = 60 * (((g - bl) / d) % 6);
    else if (max === g) h = 60 * ((bl - r) / d + 2);
    else h = 60 * ((r - g) / d + 4);
  }
  if (h < 0) h += 360;
  return { h, s: max === 0 ? 0 : d / max, b: max };
}

export const numToHex = (n: number): string => `#${(n >>> 0).toString(16).padStart(6, '0').slice(-6)}`;
export const hexToNum = (hex: string): number => parseInt(hex.replace('#', ''), 16) & 0xffffff;
