/**
 * The shared rim→core palettes for FX primitives. One table, so a burst, an emitter, a shockwave and the
 * ribbon all agree on what "ember" is — re-inlining these six arrays per primitive is exactly the drift
 * this system exists to kill. Each palette is four stops, darkest rim first, white-hot core last.
 *
 * (The ribbon primitive predates this module and still inlines its own copy; it can adopt this later — the
 * values here are identical, so nothing shifts when it does.)
 */
export const PALETTES: Record<string, readonly [string, string, string, string]> = {
  violet: ['#7a17bd', '#c936ef', '#f0a0ff', '#ffffff'],
  ember: ['#e04a12', '#ff9c1e', '#ffe08a', '#ffffff'],
  mint: ['#0d8f7d', '#2ee0ac', '#b6ffe8', '#ffffff'],
  magenta: ['#a81290', '#ff33a8', '#ffc4ea', '#ffffff'],
  gold: ['#ff5f0a', '#ffb81f', '#fff0a8', '#ffffff'],
  acid: ['#2c9612', '#7ade22', '#ecffa8', '#ffffff'],
};

/** The palette ids, for an `enum` param spec's `options`. Sorted for a stable picker order. */
export const PALETTE_NAMES: string[] = Object.keys(PALETTES).sort();

const hexToNum = (hex: string): number => parseInt(hex.slice(1), 16);

/** Clamp a stop index into the 0..3 range so callers can't read off the end. */
const clampStop = (i: number): number => (i < 0 ? 0 : i > 3 ? 3 : i | 0);

/** A palette stop as a 0xRRGGBB number, for a particle `tint`. Falls back to violet for an unknown name. */
export function palColorNum(name: string, stop: number): number {
  const p = PALETTES[name] ?? PALETTES.violet;
  return hexToNum(p[clampStop(stop)]);
}

/**
 * A palette stop biased toward the hot core: `bias` 0 = the rim stop, 1 = the white core. Lets a primitive
 * expose a single "core bias" slider instead of a raw stop index. Returns a 0xRRGGBB number.
 */
export function palColorBiased(name: string, bias: number): number {
  const b = bias < 0 ? 0 : bias > 1 ? 1 : bias;
  // 0..1 across the four stops; round to the nearest stop (particles tint per-stop, no gradient).
  return palColorNum(name, Math.round(b * 3));
}

/** The whole palette flattened to a `Float32Array(16)` of premultiplied-ready RGBA floats, for a `uPal`
 *  `vec4<f32>` array uniform (rim→core, alpha 1). Matches the ribbon's `uPal` layout. */
export function palFloats(name: string): Float32Array {
  const p = PALETTES[name] ?? PALETTES.violet;
  const out = new Float32Array(16);
  for (let i = 0; i < 4; i++) {
    const n = hexToNum(p[i]);
    out[i * 4] = ((n >> 16) & 255) / 255;
    out[i * 4 + 1] = ((n >> 8) & 255) / 255;
    out[i * 4 + 2] = (n & 255) / 255;
    out[i * 4 + 3] = 1;
  }
  return out;
}
