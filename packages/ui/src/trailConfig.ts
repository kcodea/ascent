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
  /** Band width as a fraction of the card's width (1 = full card width) — the wake is this wide at the card. */
  width: number;
  /** Base (wind) wisp peak alpha. */
  alpha: number;
  /** Band depth (px) along the direction of travel — keep ≳ emitSpacing so bands overlap into a smooth wake. */
  depth: number;
  /** Lateral drift speed (px/s) — sideways wander that sells "displaced air". */
  drift: number;
  /** Gold (divine-shield) wisp peak alpha. */
  goldAlpha: number;
  /** Gold only: chance per emit of an extra tiny spark mote (the glassy glint). */
  sparkChance: number;
}

const DEFAULTS: TrailConfig = {
  emitSpacing: 14,
  lifeMs: 320,
  width: 0.9,
  alpha: 0.24,
  depth: 22,
  drift: 18,
  goldAlpha: 0.4,
  sparkChance: 0.25,
};

/** Slider bounds for the DEV tuner — [min, max, step] per key. */
export const TRAIL_RANGES: Record<keyof TrailConfig, [number, number, number]> = {
  emitSpacing: [4, 60, 1],
  lifeMs: [80, 900, 10],
  width: [0.2, 1.6, 0.05],
  alpha: [0.05, 1, 0.01],
  depth: [4, 80, 2],
  drift: [0, 120, 2],
  goldAlpha: [0.05, 1, 0.01],
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
