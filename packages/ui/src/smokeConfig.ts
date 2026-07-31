/**
 * Tunable parameters for the strike-point ENERGY PULSE — the thin bright rings that expand out of a combat
 * clack point (`pixiFx.impactPulse`). Same pattern as `lungeConfig.ts`/`trailConfig.ts`: one mutable,
 * localStorage-persisted config dialed by eye via the DEV Smoke tuner (`SmokeTuner.tsx`);
 * `getSmokeConfig()` is read at spawn time, so changes apply to the next impact.
 *
 * NOTE: this module has been shrinking as the effects it fed became authored defs, tuned in the FX workbench
 * rather than by these sliders. The card-drop footprint billow went first (`fx/defs/landing-dust.json`),
 * taking its `dust*` knobs; the combat impact SMOKE followed (`fx/defs/strike-impact.json`'s "warm smoke"
 * layer, migrated with `pixiFx.impact`), taking the six `smoke*` knobs. The pulse is what is left, and it
 * stays here until `impactPulse` itself migrates — which it can't yet, because its `rings` argument REPLACES
 * the ring count where `playDef`'s `intensity` would multiply it (see `docs/roadmap.md`). The name is kept
 * (`SmokeConfig`, storage key `ascent.smoke`) so tuned values already in players' localStorage still load.
 */
export interface SmokeConfig {
  /** Combat impact — energy pulse ring(s) expanding out of the clack point: ring radius (px). */
  impPulseRadius: number;
  /** Combat impact energy pulse: ring lifetime (ms). */
  impPulseDur: number;
  /** Combat impact energy pulse: number of rings (0 disables the pulse). */
  impPulseRings: number;
}

const DEFAULTS: SmokeConfig = {
  // Combat impact energy pulse (fired from the strike point) — owner-tuned (2026-07-10). The dust and smoke
  // beside it are authored defs now (`fx/defs/impact-dust.json`, `fx/defs/strike-impact.json`).
  impPulseRadius: 150,
  impPulseDur: 480,
  impPulseRings: 2,
};

/** Slider bounds for the DEV tuner — [min, max, step] per key. */
export const SMOKE_RANGES: Record<keyof SmokeConfig, [number, number, number]> = {
  impPulseRadius: [20, 320, 5],
  impPulseDur: [100, 700, 10],
  impPulseRings: [0, 2, 1],
};
export const SMOKE_KEYS = Object.keys(DEFAULTS) as (keyof SmokeConfig)[];
/** The shipped values, exported so the tuner can mark which controls you have moved away from them. */
export { DEFAULTS as SMOKE_DEFAULTS };

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
