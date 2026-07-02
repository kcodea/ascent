/**
 * Tunable parameters for the card motion trail (`pixiFx.trail`) — the wind-whoosh wisps left behind a
 * dragged card and behind a combat attacker's lunge, plus the gold divine-shield variant. Same pattern as
 * `lungeConfig.ts`: one mutable, localStorage-persisted config, dialed by eye via the DEV Trail tuner
 * (`TrailTuner.tsx`); `getTrailConfig()` is read at emit time, so changes apply to the next wisps.
 */
export interface TrailConfig {
  /** Px of card travel between wisp emits (lower = denser trail). */
  emitSpacing: number;
  /** Wisp lifetime (ms). */
  lifeMs: number;
  /** Wisp size — the sprite's starting scale. */
  size: number;
  /** Base (wind) wisp peak alpha. */
  alpha: number;
  /** Streak elongation — X-axis stretch multiplier on the wisp texture. */
  stretch: number;
  /** Lateral drift speed (px/s) — sideways wander that sells "displaced air". */
  drift: number;
  /** Gold (divine-shield) wisp peak alpha. */
  goldAlpha: number;
  /** Blue (reborn) wisp peak alpha. */
  blueAlpha: number;
  /** Gold/blue only: chance per emit of an extra tiny spark mote (the glassy glint). */
  sparkChance: number;
}

const DEFAULTS: TrailConfig = {
  emitSpacing: 4,
  lifeMs: 900,
  size: 1.05,
  alpha: 0.1,
  stretch: 1.1,
  drift: 68,
  goldAlpha: 0.13,
  blueAlpha: 0.14,
  sparkChance: 0.4,
};

/** Slider bounds for the DEV tuner — [min, max, step] per key. */
export const TRAIL_RANGES: Record<keyof TrailConfig, [number, number, number]> = {
  emitSpacing: [4, 60, 1],
  lifeMs: [80, 1500, 10],
  size: [0.3, 2.5, 0.05],
  alpha: [0.05, 1, 0.01],
  stretch: [0.5, 3, 0.05],
  drift: [0, 120, 2],
  goldAlpha: [0.05, 1, 0.01],
  blueAlpha: [0.05, 1, 0.01],
  sparkChance: [0, 1, 0.05],
};
export const TRAIL_KEYS = Object.keys(DEFAULTS) as (keyof TrailConfig)[];

const KEY = 'ascent.trail';
let cfg: TrailConfig = (() => {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return { ...DEFAULTS, ...(saved && typeof saved === 'object' ? (saved as Partial<TrailConfig>) : {}) };
  } catch {
    return { ...DEFAULTS };
  }
})();

export function getTrailConfig(): TrailConfig {
  return cfg;
}
export function setTrailValue(key: keyof TrailConfig, value: number): void {
  cfg = { ...cfg, [key]: value };
  try {
    localStorage.setItem(KEY, JSON.stringify(cfg));
  } catch {
    /* ignore */
  }
}
export function resetTrailConfig(): void {
  cfg = { ...DEFAULTS };
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
