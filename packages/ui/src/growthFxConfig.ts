/**
 * Tunable parameters for the GROWTH FX — the tendril sweep played wherever **Growth** is cast: from the hand
 * in the shop, or in combat by anything that casts it (Hoardbreaker Drake's Rally/Slaughter today, any future
 * caster for free — it keys off the cast, not the caster).
 *
 * Shape (owner direction 2026-07-21): this is a **board-wide sweep, not a per-unit plant**. Tendrils snake out
 * from the CENTRE of the board toward BOTH ends — the `auraWave` centre→edge motion, drawn as creeping vines
 * — shedding leaves, petals and sparkles along the advancing front. Nothing is anchored to individual cards.
 *
 * Same config pattern as `strikeFxConfig.ts` / `cleaveFxConfig.ts`: one mutable, localStorage-persisted
 * config dialled by eye via the DEV "Growth Bloom FX" tuner (`GrowthFxTuner.tsx`); `getGrowthFxConfig()` is
 * read at spawn time, so edits apply to the NEXT cast. The saved-config merge is **DEV-only** (see
 * `dragFeel.ts` and PR #615) — production always runs the baked DEFAULTS.
 *
 * PERF: the tendrils + wash are one `Graphics` redrawn per frame while the sweep lives (the established
 * `auraWave` pattern); leaves, petals and sparkles are pooled particles. One-shot and self-retiring — no
 * looping animation touches a paint property.
 */

/** The card id whose cast plays this FX. One constant so the recruit and combat trigger sites can't drift. */
export const GROWTH_ID = 'growth';

export interface GrowthFxConfig {
  // ── placement: where the sweep sits over the measured board region ────────────────────────────────────
  /** Horizontal nudge of the whole effect, in px. */
  offsetX: number;
  /** Vertical nudge of the whole effect, in px. */
  offsetY: number;
  /** Region width multiplier (1 = exactly the measured board span). */
  widthScale: number;
  /** Region height multiplier (1 = exactly the measured board height). */
  heightScale: number;
  /** Overall size multiplier for tendril thickness + mote sizes (motion/among-cards feel, not the span). */
  scale: number;

  // ── the tendrils ─────────────────────────────────────────────────────────────────────────────────────
  /** How many tendrils creep out per SIDE (they mirror left and right from the centre). */
  tendrilCount: number;
  /** How far a tendril reaches, as a multiple of the region's half-width (1 = exactly to the edge). */
  reach: number;
  /** Tendril stroke thickness in px at the base (it tapers to the tip). */
  tendrilWidth: number;
  /** Snake amplitude — how far the tendril waves off its centre line, in px. */
  waviness: number;
  /** How many wave cycles fit along a tendril's full length. */
  waveFreq: number;
  /** How far the tendrils fan apart vertically at the centre, in px. */
  spreadY: number;
  /** Extra vertical drift a tendril accumulates by its tip, in px (positive = they splay outward/down). */
  splayY: number;
  /** Centre→edge travel time, in ms (how long the front takes to reach the ends). */
  frontMs: number;
  /** How long the fully-grown tendrils hold before fading, in ms. */
  holdMs: number;
  /** Tendril fade-out time, in ms. */
  fadeMs: number;
  /** Tendril core opacity. */
  tendrilAlpha: number;
  /** Tendril outer glow thickness as a multiple of the core width. */
  glowWidth: number;
  /** Tendril outer glow opacity. */
  glowAlpha: number;

  // ── what rides the advancing front ───────────────────────────────────────────────────────────────────
  /** Leaves shed along the front, per side. */
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
  /** Flower petals bloomed along the front, per side. */
  petalCount: number;
  /** Petal size multiplier. */
  petalSize: number;
  /** Petal lifetime in ms. */
  petalLife: number;
  /** Sparkle motes along the front, per side. */
  sparkCount: number;
  /** Sparkle size multiplier. */
  sparkSize: number;
  /** Sparkle lifetime in ms. */
  sparkLife: number;
  /** How fast sparkles rise (px/s). */
  sparkRise: number;

  // ── the wash under it all ────────────────────────────────────────────────────────────────────────────
  /** Soft green wash opacity over the swept region (0 disables). */
  washAlpha: number;
  /** Padding in px added around the region for the wash. */
  washPad: number;

  // ── colours ──────────────────────────────────────────────────────────────────────────────────────────
  /** Tendril colour. */
  colorVine: string;
  /** Tendril glow colour. */
  colorVineGlow: string;
  /** Leaf colour. */
  colorLeaf: string;
  /** Petal colour. */
  colorPetal: string;
  /** Sparkle colour. */
  colorSpark: string;
}

/** The shipped look: lush spring-green tendrils racing out to both ends, gold sparkles, violet petals. */
const DEFAULTS: GrowthFxConfig = {
  offsetX: 0,
  offsetY: 0,
  widthScale: 1,
  heightScale: 1,
  scale: 1,

  tendrilCount: 4,
  reach: 1,
  tendrilWidth: 5,
  waviness: 26,
  waveFreq: 2.4,
  spreadY: 30,
  splayY: 18,
  frontMs: 620,
  holdMs: 260,
  fadeMs: 520,
  tendrilAlpha: 0.95,
  glowWidth: 3,
  glowAlpha: 0.42,

  leafCount: 10,
  leafSize: 1,
  leafLife: 900,
  leafRise: 46,
  leafDrift: 34,
  leafSpin: 2.4,
  petalCount: 6,
  petalSize: 0.9,
  petalLife: 1000,
  sparkCount: 14,
  sparkSize: 1,
  sparkLife: 720,
  sparkRise: 62,

  washAlpha: 0.16,
  washPad: 30,

  colorVine: '#7ddc4a',
  colorVineGlow: '#b6ff6e',
  colorLeaf: '#8fe451',
  colorPetal: '#e58bff',
  colorSpark: '#ffe98a',
};

/** Slider bounds for the DEV tuner — [min, max, step] per numeric key. */
export const GROWTHFX_RANGES: Record<string, [number, number, number]> = {
  offsetX: [-400, 400, 2],
  offsetY: [-400, 400, 2],
  widthScale: [0.2, 2.5, 0.02],
  heightScale: [0.2, 3, 0.02],
  scale: [0.2, 3, 0.05],

  tendrilCount: [0, 14, 1],
  reach: [0.2, 2, 0.02],
  tendrilWidth: [0.5, 20, 0.5],
  waviness: [0, 120, 1],
  waveFreq: [0.2, 8, 0.1],
  spreadY: [0, 200, 2],
  splayY: [-120, 120, 2],
  frontMs: [80, 2000, 20],
  holdMs: [0, 1200, 20],
  fadeMs: [60, 1600, 20],
  tendrilAlpha: [0, 1, 0.02],
  glowWidth: [1, 8, 0.1],
  glowAlpha: [0, 1, 0.02],

  leafCount: [0, 40, 1],
  leafSize: [0.2, 3, 0.05],
  leafLife: [150, 2400, 20],
  leafRise: [0, 220, 2],
  leafDrift: [0, 200, 2],
  leafSpin: [0, 8, 0.1],
  petalCount: [0, 30, 1],
  petalSize: [0.2, 3, 0.05],
  petalLife: [150, 2400, 20],
  sparkCount: [0, 60, 1],
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
