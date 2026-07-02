/**
 * Tunable parameters for the board's soft particle smoke/dust — the warm-grey puffs that rise off a combat
 * impact (`pixiFx.impact`) and the tan dust ring kicked up under a placed card (`pixiFx.dust`). Same pattern
 * as `lungeConfig.ts`/`trailConfig.ts`: one mutable, localStorage-persisted config dialed by eye via the DEV
 * Smoke tuner (`SmokeTuner.tsx`); `getSmokeConfig()` is read at spawn time, so changes apply to the next
 * impact/drop. The DEFAULTS reproduce the previously-hardcoded look exactly (nothing changes until you tune).
 */
export interface SmokeConfig {
  /** Combat impact: number of smoke puffs per hit. */
  smokeCount: number;
  /** Combat impact: upward drift speed (px/s). */
  smokeRise: number;
  /** Combat impact: horizontal spread (px/s). */
  smokeDrift: number;
  /** Combat impact: base puff lifetime (ms). */
  smokeLife: number;
  /** Combat impact: final expansion scale as the puff billows + fades. */
  smokeGrow: number;
  /** Combat impact: peak opacity (kept low so it wisps over the cream board). */
  smokeAlpha: number;
  /** Card drop: number of dust puffs around the ring (× the per-call density). */
  dustCount: number;
  /** Card drop: outward billow speed (px/s). */
  dustSpeed: number;
  /** Card drop: base puff lifetime (ms). */
  dustLife: number;
  /** Card drop: final expansion scale (× the per-call scale). */
  dustGrow: number;
  /** Card drop: peak opacity. */
  dustAlpha: number;
}

const DEFAULTS: SmokeConfig = {
  smokeCount: 7,
  smokeRise: 150,
  smokeDrift: 170,
  smokeLife: 1720,
  smokeGrow: 4.5,
  smokeAlpha: 0.09,
  dustCount: 22,
  dustSpeed: 195,
  dustLife: 1180,
  dustGrow: 1.2,
  dustAlpha: 0.32,
};

/** Slider bounds for the DEV tuner — [min, max, step] per key. */
export const SMOKE_RANGES: Record<keyof SmokeConfig, [number, number, number]> = {
  smokeCount: [0, 24, 1],
  smokeRise: [0, 220, 5],
  smokeDrift: [0, 220, 5],
  smokeLife: [100, 2200, 20],
  smokeGrow: [0.5, 6, 0.1],
  smokeAlpha: [0, 1, 0.01],
  dustCount: [0, 40, 1],
  dustSpeed: [0, 320, 5],
  dustLife: [100, 1600, 20],
  dustGrow: [0.5, 4, 0.1],
  dustAlpha: [0, 1, 0.01],
};
export const SMOKE_KEYS = Object.keys(DEFAULTS) as (keyof SmokeConfig)[];

const KEY = 'ascent.smoke';
let cfg: SmokeConfig = (() => {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return { ...DEFAULTS, ...(saved && typeof saved === 'object' ? (saved as Partial<SmokeConfig>) : {}) };
  } catch {
    return { ...DEFAULTS };
  }
})();

export function getSmokeConfig(): SmokeConfig {
  return cfg;
}
export function setSmokeValue(key: keyof SmokeConfig, value: number): void {
  cfg = { ...cfg, [key]: value };
  try {
    localStorage.setItem(KEY, JSON.stringify(cfg));
  } catch {
    /* ignore */
  }
}
export function resetSmokeConfig(): void {
  cfg = { ...DEFAULTS };
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
