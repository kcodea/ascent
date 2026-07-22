/**
 * Tunable parameters for the GROWTH FX — the vine-and-blossom bloom that erupts across your board whenever
 * **Growth** is cast: from the hand in the shop, or in combat by anything that casts it (Hoardbreaker Drake's
 * Rally/Slaughter today, any future caster for free — it keys off the cast, not the caster).
 *
 * Same pattern as `strikeFxConfig.ts` / `cleaveFxConfig.ts`: one mutable, localStorage-persisted config
 * dialled by eye via the DEV "Growth Bloom FX" tuner (`GrowthFxTuner.tsx`); `getGrowthFxConfig()` is read at
 * spawn time, so edits apply to the NEXT cast. The saved-config merge is **DEV-only** (see `dragFeel.ts` and
 * PR #615) — production always runs the baked DEFAULTS.
 *
 * Layered, painted back to front: a soft green wash over the buffed region → vines that grow outward from
 * each buffed unit and curl → leaves and petals that peel off the vines and drift → a sparkle rise. The
 * vines are the signature: they DRAW ON over `growMs` rather than popping in, which is what sells "growth".
 *
 * PERF: the vines are one `Graphics` redrawn per frame while the bloom lives (the established `auraWave`
 * pattern); leaves, petals and sparkles are pooled particles. One-shot and self-retiring — no looping
 * animation touches a paint property.
 */
/** The card id whose cast plays this FX. One constant so the recruit and combat trigger sites can't drift. */
export const GROWTH_ID = 'growth';

export interface GrowthFxConfig {
  /** Vines grown per buffed unit. */
  vineCount: number;
  /** Vine length in px (before the per-vine random scatter). */
  vineLen: number;
  /** Vine stroke thickness in px at the base (it tapers to the tip). */
  vineWidth: number;
  /** How hard each vine curls — the sideways bow of its arc, as a fraction of its length. */
  vineCurve: number;
  /** Extra sine wobble along the vine's length, in px (0 = a clean arc). */
  vineWobble: number;
  /** How far the vine directions spread around straight-up, in DEGREES (180 = a full fan). */
  vineSpread: number;
  /** How long a vine takes to draw itself on, in ms. */
  growMs: number;
  /** Delay between successive units' vines starting, in ms (the bloom sweeps across the board). */
  unitStagger: number;
  /** How long the fully-grown vines hold before fading, in ms. */
  holdMs: number;
  /** Vine fade-out time, in ms. */
  fadeMs: number;
  /** Vine core opacity. */
  vineAlpha: number;
  /** Vine outer glow thickness as a multiple of the core width. */
  vineGlowWidth: number;
  /** Vine outer glow opacity. */
  vineGlowAlpha: number;
  /** Leaves peeled off the vines per unit. */
  leafCount: number;
  /** Leaf size multiplier. */
  leafSize: number;
  /** Leaf lifetime in ms. */
  leafLife: number;
  /** How fast leaves drift upward (px/s). */
  leafRise: number;
  /** Sideways leaf drift speed (px/s). */
  leafDrift: number;
  /** How fast leaves tumble (rad/s). */
  leafSpin: number;
  /** Flower petals bloomed per unit (the pink/violet accents in the concept). */
  petalCount: number;
  /** Petal size multiplier. */
  petalSize: number;
  /** Petal lifetime in ms. */
  petalLife: number;
  /** Sparkle motes per unit. */
  sparkCount: number;
  /** Sparkle size multiplier. */
  sparkSize: number;
  /** Sparkle lifetime in ms. */
  sparkLife: number;
  /** How fast sparkles rise (px/s). */
  sparkRise: number;
  /** Soft green wash opacity over the buffed region (0 disables). */
  washAlpha: number;
  /** Padding in px added around the buffed region for the wash. */
  washPad: number;
  /** Vine colour. */
  colorVine: string;
  /** Vine glow colour. */
  colorVineGlow: string;
  /** Leaf colour. */
  colorLeaf: string;
  /** Petal colour. */
  colorPetal: string;
  /** Sparkle colour. */
  colorSpark: string;
}

/** The shipped look: lush spring green vines with gold sparkles and violet petals, matching the concept. */
const DEFAULTS: GrowthFxConfig = {
  vineCount: 5,
  vineLen: 96,
  vineWidth: 4.5,
  vineCurve: 0.42,
  vineWobble: 5,
  vineSpread: 150,
  growMs: 380,
  unitStagger: 70,
  holdMs: 240,
  fadeMs: 460,
  vineAlpha: 0.95,
  vineGlowWidth: 3,
  vineGlowAlpha: 0.42,
  leafCount: 7,
  leafSize: 1,
  leafLife: 900,
  leafRise: 46,
  leafDrift: 34,
  leafSpin: 2.4,
  petalCount: 4,
  petalSize: 0.9,
  petalLife: 1000,
  sparkCount: 10,
  sparkSize: 1,
  sparkLife: 720,
  sparkRise: 62,
  washAlpha: 0.18,
  washPad: 34,
  colorVine: '#7ddc4a',
  colorVineGlow: '#b6ff6e',
  colorLeaf: '#8fe451',
  colorPetal: '#e58bff',
  colorSpark: '#ffe98a',
};

/** Slider bounds for the DEV tuner — [min, max, step] per numeric key. */
export const GROWTHFX_RANGES: Record<string, [number, number, number]> = {
  vineCount: [0, 14, 1],
  vineLen: [10, 260, 2],
  vineWidth: [0.5, 16, 0.5],
  vineCurve: [0, 1.2, 0.02],
  vineWobble: [0, 30, 0.5],
  vineSpread: [0, 360, 5],
  growMs: [60, 1200, 20],
  unitStagger: [0, 400, 5],
  holdMs: [0, 1200, 20],
  fadeMs: [60, 1600, 20],
  vineAlpha: [0, 1, 0.02],
  vineGlowWidth: [1, 8, 0.1],
  vineGlowAlpha: [0, 1, 0.02],
  leafCount: [0, 30, 1],
  leafSize: [0.2, 3, 0.05],
  leafLife: [150, 2400, 20],
  leafRise: [0, 220, 2],
  leafDrift: [0, 200, 2],
  leafSpin: [0, 8, 0.1],
  petalCount: [0, 20, 1],
  petalSize: [0.2, 3, 0.05],
  petalLife: [150, 2400, 20],
  sparkCount: [0, 40, 1],
  sparkSize: [0.2, 3, 0.05],
  sparkLife: [150, 2000, 20],
  sparkRise: [0, 240, 2],
  washAlpha: [0, 0.8, 0.01],
  washPad: [0, 140, 2],
};

/** Numeric keys, in tuner order. Colours are dialled separately (swatch inputs). */
export const GROWTHFX_KEYS = Object.keys(GROWTHFX_RANGES) as (keyof GrowthFxConfig)[];
/** Colour keys, dialled with swatches rather than sliders. */
export const GROWTHFX_COLOR_KEYS: (keyof GrowthFxConfig)[] = [
  'colorVine', 'colorVineGlow', 'colorLeaf', 'colorPetal', 'colorSpark',
];

const KEY = 'ascent.growthfx';
let cfg: GrowthFxConfig = (() => {
  // DEV-only merge: production always runs the baked DEFAULTS so a saved tuner value can't beat main.
  if (!import.meta.env.DEV) return { ...DEFAULTS };
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return { ...DEFAULTS, ...(saved && typeof saved === 'object' ? (saved as Partial<GrowthFxConfig>) : {}) };
  } catch {
    return { ...DEFAULTS };
  }
})();

export function getGrowthFxConfig(): GrowthFxConfig {
  return cfg;
}

export function setGrowthFxValue(key: keyof GrowthFxConfig, value: number | string): void {
  cfg = { ...cfg, [key]: value };
  try {
    localStorage.setItem(KEY, JSON.stringify(cfg));
  } catch {
    /* ignore */
  }
}

export function resetGrowthFxConfig(): void {
  cfg = { ...DEFAULTS };
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
