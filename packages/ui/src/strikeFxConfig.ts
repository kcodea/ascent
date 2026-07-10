/**
 * Tunable parameters for the combat LUNGE STRIKE effects — the melee-impact burst fired at contact
 * (`pixiFx.impact`) plus where the whole strike-impact package originates (`strikePoint`). Same pattern as
 * `lungeConfig.ts` / `smokeConfig.ts`: one mutable, localStorage-persisted config dialed by eye via the DEV
 * "Lunge Strike Effects" tuner (`StrikeFxTuner.tsx`); `getStrikeFxConfig()` is read at spawn/engine time, so
 * changes apply to the next strike. The DEFAULTS reproduce the previously-hardcoded flash/shockwave/spark
 * look, EXCEPT `strikePoint`, which now defaults to 0 = the defender's CENTER (the corner-clack point is the
 * `strikePoint: 1` end).
 *
 * The smoke / dust billow / energy pulse of a strike live in `smokeConfig.ts` (shared with the card-drop
 * dust); the Lunge Strike Effects tuner surfaces those keys too so the whole package is dialed in one panel.
 */
export interface StrikeFxConfig {
  /** Where the strike's impact originates + how hard the attacker leads with a corner: 0 = the defender's
   *  CENTER (attacker strikes flat), 1 = the attacker's leading CORNER (the full corner-clack). Blends the FX
   *  origin and scales the attacker lead-tilt / rebound and the defender counter-spin. */
  strikePoint: number;
  /** Hot-core flash size (the additive white-hot glint) — base `toScale`, ×the hit's power. */
  flashSize: number;
  /** Coloured shockwave size (the orange flash that paints over the cream board) — base `toScale`, ×power. */
  shockwaveSize: number;
  /** Expanding heavy-hit RING scale (× the ramped size; 0 disables the ring). Still gated to heavier hits. */
  ringScale: number;
  /** Spark shard count at power 1 (scales up on heavier hits). */
  sparkCount: number;
  /** Spark launch-speed multiplier (× the base 320–940 px/s spread). */
  sparkSpeed: number;
  /** Spark fan spread in DEGREES (the full cone the shards fan within, centred on the blow direction). */
  sparkSpread: number;
  /** Spark size multiplier (visibility). */
  sparkSize: number;
}

const DEFAULTS: StrikeFxConfig = {
  strikePoint: 0,   // CENTER by default (owner call); 1 = the corner-clack point
  flashSize: 2.6,
  shockwaveSize: 2.1,
  ringScale: 1,
  sparkCount: 16,
  sparkSpeed: 1,
  sparkSpread: 126, // ≈ the old Math.PI*0.7 cone
  sparkSize: 1.2,
};

/** Slider bounds for the DEV tuner — [min, max, step] per key. */
export const STRIKEFX_RANGES: Record<keyof StrikeFxConfig, [number, number, number]> = {
  strikePoint: [0, 1, 0.05],
  flashSize: [0, 5, 0.1],
  shockwaveSize: [0, 5, 0.1],
  ringScale: [0, 3, 0.1],
  sparkCount: [0, 40, 1],
  sparkSpeed: [0, 3, 0.05],
  sparkSpread: [0, 360, 5],
  sparkSize: [0.3, 3, 0.1],
};
export const STRIKEFX_KEYS = Object.keys(DEFAULTS) as (keyof StrikeFxConfig)[];

const KEY = 'ascent.strikefx';
let cfg: StrikeFxConfig = (() => {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return { ...DEFAULTS, ...(saved && typeof saved === 'object' ? (saved as Partial<StrikeFxConfig>) : {}) };
  } catch {
    return { ...DEFAULTS };
  }
})();

export function getStrikeFxConfig(): StrikeFxConfig {
  return cfg;
}
export function setStrikeFxValue(key: keyof StrikeFxConfig, value: number): void {
  cfg = { ...cfg, [key]: value };
  try {
    localStorage.setItem(KEY, JSON.stringify(cfg));
  } catch {
    /* ignore */
  }
}
export function resetStrikeFxConfig(): void {
  cfg = { ...DEFAULTS };
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
