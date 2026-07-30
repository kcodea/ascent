/**
 * Tunable parameters for the board's soft particle smoke/dust — the warm-grey puffs that rise off a combat
 * impact (`pixiFx.impact`) and the dust + energy pulse fired from a strike point. Same pattern
 * as `lungeConfig.ts`/`trailConfig.ts`: one mutable, localStorage-persisted config dialed by eye via the DEV
 * Smoke tuner (`SmokeTuner.tsx`); `getSmokeConfig()` is read at spawn time, so changes apply to the next
 * impact. The DEFAULTS reproduce the previously-hardcoded look exactly (nothing changes until you tune).
 *
 * NOTE: the card-drop footprint dust used to live here too. It is an authored def now (`fx/defs/landing-dust.json`,
 * played through `playDef` with a per-call `scale`/`intensity`), tuned in the FX workbench rather than by these
 * sliders — so its `dust*` knobs were removed with the hand-written `pixiFx.dust()` they drove.
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
  /** Combat impact — energy pulse ring(s) expanding out of the clack point: ring radius (px). */
  impPulseRadius: number;
  /** Combat impact energy pulse: ring lifetime (ms). */
  impPulseDur: number;
  /** Combat impact energy pulse: number of rings (0 disables the pulse). */
  impPulseRings: number;
}

const DEFAULTS: SmokeConfig = {
  // Combat impact smoke — owner-tuned in the Lunge Strike Effects tuner (2026-07-10).
  smokeCount: 3,
  smokeRise: 0,
  smokeDrift: 170,
  smokeLife: 400,
  smokeGrow: 6,
  smokeAlpha: 0.15,
  // Combat impact energy pulse (fired from the strike point) — owner-tuned (2026-07-10). The dust beside it
  // is now the authored `impact-dust` def (`fx/defs/`), tuned in the FX workbench rather than here.
  impPulseRadius: 150,
  impPulseDur: 480,
  impPulseRings: 2,
};

/** Slider bounds for the DEV tuner — [min, max, step] per key. */
export const SMOKE_RANGES: Record<keyof SmokeConfig, [number, number, number]> = {
  smokeCount: [0, 24, 1],
  smokeRise: [0, 220, 5],
  smokeDrift: [0, 220, 5],
  smokeLife: [100, 2200, 20],
  smokeGrow: [0.5, 6, 0.1],
  smokeAlpha: [0, 1, 0.01],
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
