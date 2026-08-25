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

/** The 4 stop labels for a palette tuple, rim (darkest) to core (white-hot) — for the picker UI. */
export const PALETTE_STOP_LABELS = ['Rim', 'Outer', 'Inner', 'Core'] as const;

/** Grouped preset library, shown by colour in the picker. rim -> core. Includes the original six
 *  (`PALETTE_PRESETS`' violet/ember/mint/magenta/gold/acid) by name, plus new presets alongside them. */
export const PALETTE_LIBRARY: Record<string, Record<string, readonly [number, number, number, number]>> = {
  Fire: { Ember: [0x2a0a06, 0x7a1e10, 0xff6a2b, 0xfff0c8], Gold: [0x2a1e05, 0x7a5a12, 0xffcf3a, 0xfffbe0], Magma: [0x1a0808, 0x6a1420, 0xff3a2a, 0xffd08a], Blood: [0x200406, 0x5a0a12, 0xc81e2c, 0xff9a8a], Sunset: [0x2a0f1e, 0x7a2a3a, 0xff7a4a, 0xffe0b0], Amber: [0x24140a, 0x6a3a12, 0xff9a2a, 0xfff0d0] },
  Cool: { Violet: [0x2a1030, 0x7a1e57, 0xff2d95, 0xfff2fb], Magenta: [0x2a0a24, 0x7a125a, 0xff33a8, 0xffc4ea], Ice: [0x0a1826, 0x1e4a6a, 0x4ac8ff, 0xe0f8ff], Ocean: [0x08121e, 0x143a5a, 0x2a9ad8, 0xcdeeff], Mint: [0x0a2018, 0x1e5a44, 0x3ad89a, 0xe0fff0], Arctic: [0x12182a, 0x2a3a6a, 0x6a8aff, 0xe0e8ff], Plasma: [0x1a0a2a, 0x4a1e8a, 0x8a4aff, 0xecdcff] },
  Energy: { Acid: [0x141e05, 0x3a5a12, 0x9ade2a, 0xf0ffd0], Neon: [0x05201a, 0x0a5a3a, 0x2affc8, 0xd0fff0], Electric: [0x0a1030, 0x1e2a8a, 0x4a6aff, 0xe0eaff], Toxic: [0x141a08, 0x3a5a10, 0xaade1e, 0xf0ffcc], Radio: [0x0a1a05, 0x2a6a10, 0x6aff2a, 0xe8ffcc], Spark: [0x201a05, 0x6a5210, 0xffe23a, 0xfffce0] },
  'Nature / Special': { Forest: [0x0a1808, 0x1e4a1e, 0x4a9a3a, 0xd0ffb0], Poison: [0x1a0a20, 0x4a1e5a, 0x9a3ad8, 0xe8d0ff], Earth: [0x1a1208, 0x4a3a1e, 0x9a7a4a, 0xf0e0c0], Ash: [0x141416, 0x3a3a40, 0x8a8a94, 0xf0f0f4], Void: [0x0a0a12, 0x2a2a44, 0x5a5a8a, 0xd0d0f0], Holy: [0x2a2410, 0x7a6a2a, 0xffe07a, 0xffffff] },
};
