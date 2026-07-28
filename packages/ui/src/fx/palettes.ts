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

/** The palette ids, for an `enum` param spec's `options`. Insertion order (violet, ember, mint, magenta,
 *  gold, acid) so the picker lists them the same on every primitive, matching the ribbon's own order. */
export const PALETTE_NAMES: string[] = Object.keys(PALETTES);

const hexToNum = (hex: string): number => parseInt(hex.slice(1), 16);

/** Clamp a stop index into the 0..3 range so callers can't read off the end. */
const clampStop = (i: number): number => (i < 0 ? 0 : i > 3 ? 3 : i | 0);

/**
 * The six named palettes as 0xRRGGBB tuples (rim→core) — the seed data for an editable `palette` param's
 * `presets`. Derived from `PALETTES`' hex strings so there is ONE source; the hex and numeric forms can
 * never drift apart.
 */
export const PALETTE_PRESETS: Record<string, readonly [number, number, number, number]> = Object.fromEntries(
  Object.entries(PALETTES).map(([name, stops]) => {
    const tuple: [number, number, number, number] = [
      hexToNum(stops[0]),
      hexToNum(stops[1]),
      hexToNum(stops[2]),
      hexToNum(stops[3]),
    ];
    return [name, tuple];
  }),
);

/** A named preset as a fresh 4-tuple — the default seed for an editable palette param. Falls back to
 *  violet for an unknown name. Always a new array, so two callers never share (and mutate) one tuple. */
export function paletteTuple(name: string): [number, number, number, number] {
  const p = PALETTE_PRESETS[name] ?? PALETTE_PRESETS.violet;
  return [p[0], p[1], p[2], p[3]];
}

/** Flatten 4 raw 0xRRGGBB stops into the `Float32Array(16)` a `uPal[4]` (vec4<f32>, size 4) uniform
 *  expects — rgba floats, one vec4 per stop, rim→core, alpha 1. The editable-tuple counterpart to the
 *  old name-keyed `palFloats`. A short/missing stop reads as 0 (black) rather than throwing. */
export function tupleFloats(stops: readonly number[]): Float32Array {
  const out = new Float32Array(16);
  for (let i = 0; i < 4; i++) {
    const n = stops[i] ?? 0;
    out[i * 4] = ((n >> 16) & 255) / 255;
    out[i * 4 + 1] = ((n >> 8) & 255) / 255;
    out[i * 4 + 2] = (n & 255) / 255;
    out[i * 4 + 3] = 1;
  }
  return out;
}

/**
 * A stop from a raw tuple biased toward the hot core: `bias` 0 = the rim stop (index 0), 1 = the white
 * core (index 3). Lets a primitive expose a single "core bias" slider instead of a raw stop index. The
 * editable-tuple counterpart to the old name-keyed `palColorBiased`. Returns a 0xRRGGBB number.
 */
export function tupleBiased(stops: readonly number[], bias: number): number {
  const b = bias < 0 ? 0 : bias > 1 ? 1 : bias;
  // 0..1 across the four stops; round to the nearest stop (particles tint per-stop, no gradient).
  return stops[clampStop(Math.round(b * 3))] ?? stops[0] ?? 0;
}
