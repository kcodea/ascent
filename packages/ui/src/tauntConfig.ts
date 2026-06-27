/**
 * Tunable parameters for the Taunt bulwark — the silver-metal heater shield drawn BEHIND a Taunt minion
 * (the `taunt` AURA in pixiFx.ts). Held in one mutable, localStorage-persisted config so the look can be
 * dialed in by eye via the DEV Taunt tuner (`TauntTuner.tsx`) without a code round-trip — set a value here
 * as the shipped default. pixiFx reads `getTauntConfig()` LIVE every frame for each taunt bubble, so a
 * slider change shows instantly on a held demo bubble (run `__tauntDemo()` or use the tuner's Hold demo).
 *
 * Shape/look values (`topY`…`glintSpeed`, `colorR/G/B`) feed the shader as uniforms; `margin` (footprint
 * size around the card) and `deployMs` (the "thwap" deploy duration) are applied JS-side in the update loop.
 */
export interface TauntConfig {
  /** Heater silhouette top edge (quad units, +1 = top). Higher = taller shield. */
  topY: number;
  /** Heater silhouette bottom point (quad units, −1 = bottom). Lower = longer point. */
  botY: number;
  /** Half-width at the shoulders (quad units) — the shield's broadest reach. */
  halfW: number;
  /** Width taper exponent — how fast the width narrows toward the bottom point (lower = fuller). */
  widthPow: number;
  /** Bevel/rim band width — the chrome frame thickness from the outer edge inward. */
  rimW: number;
  /** Central gem size (0 = no gem). */
  gemSize: number;
  /** Glint sweep speed across the metal. */
  glintSpeed: number;
  /** Silver tint — red channel (0..1). */
  colorR: number;
  /** Silver tint — green channel (0..1). */
  colorG: number;
  /** Silver tint — blue channel (0..1). */
  colorB: number;
  /** Footprint margin — the heater quad size relative to the card (>1 peeks out around the edges). */
  margin: number;
  /** Deploy duration (ms) — the ease-out-back "thwap" snap from nothing into final shape. */
  deployMs: number;
}

const DEFAULTS: TauntConfig = {
  topY: 0.82,
  botY: -0.96,
  halfW: 0.78,
  widthPow: 0.5,
  rimW: 0.16,
  gemSize: 0.3,
  glintSpeed: 0.16,
  colorR: 0.8,
  colorG: 0.84,
  colorB: 0.9,
  margin: 1.28,
  deployMs: 230,
};

/** Slider bounds for the DEV tuner — [min, max, step] per key. */
export const TAUNT_RANGES: Record<keyof TauntConfig, [number, number, number]> = {
  topY: [0.4, 1.0, 0.01],
  botY: [-1.0, -0.4, 0.01],
  halfW: [0.4, 1.0, 0.01],
  widthPow: [0.2, 1.5, 0.05],
  rimW: [0.04, 0.4, 0.01],
  gemSize: [0.0, 0.6, 0.02],
  glintSpeed: [0.0, 0.6, 0.02],
  colorR: [0, 1, 0.01],
  colorG: [0, 1, 0.01],
  colorB: [0, 1, 0.01],
  margin: [1.0, 2.0, 0.02],
  deployMs: [80, 600, 10],
};
export const TAUNT_KEYS = Object.keys(DEFAULTS) as (keyof TauntConfig)[];

const KEY = 'ascent.taunt';
let cfg: TauntConfig = (() => {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return { ...DEFAULTS, ...(saved && typeof saved === 'object' ? (saved as Partial<TauntConfig>) : {}) };
  } catch {
    return { ...DEFAULTS };
  }
})();

export function getTauntConfig(): TauntConfig {
  return cfg;
}
export function setTauntValue(key: keyof TauntConfig, value: number): void {
  cfg = { ...cfg, [key]: value };
  try {
    localStorage.setItem(KEY, JSON.stringify(cfg));
  } catch {
    /* ignore */
  }
}
export function resetTauntConfig(): void {
  cfg = { ...DEFAULTS };
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
