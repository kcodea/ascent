/**
 * Tunable parameters for the combat attack lunge (`playAttackLunge` in useCombatReplay.ts). Held in one
 * mutable, localStorage-persisted config so the feel can be dialed in by eye via the DEV Lunge tuner
 * (`LungeTuner.tsx`) without a code round-trip — set a value here as the shipped default. The lunge reads
 * `getLungeConfig()` at call time, so changes apply to the next attack.
 *
 * Note the windup + strike durations are GSAP seconds (NOT scaled by the beat-clock SPEED). The attack
 * RESULT beat (damage floats / recoil) is timed to land at the lunge's connection — windup+strike ≈ 0.33s
 * ≈ the 220ms×1.5 attack beat — so keep that sum near 0.33s unless you also retune `DELAY.attack`.
 */
export interface LungeConfig {
  /** Wind-up duration (s) — the lean-back before the strike. */
  windupDur: number;
  /** Wind-up depth — fraction of the attacker→defender vector to lean back. */
  windupDepth: number;
  /** Strike duration (s) — the drive into the defender (lower = faster/snappier). */
  strikeDur: number;
  /** Strike distance — fraction of the full vector the attacker covers (>1 overdrives into the target). */
  strikeDist: number;
  /** Smack lead (s) — fire the impact sound + knockback this many seconds BEFORE the strike completes. */
  smackLead: number;
  /** Settle duration (s) — the elastic return to rest. */
  settleDur: number;
}

const DEFAULTS: LungeConfig = {
  windupDur: 0.22,   // slightly longer wind-up (was 0.2)
  windupDepth: 0.14,
  strikeDur: 0.11,   // slightly faster strike (was 0.13)
  strikeDist: 1.22,  // slightly further lunge (was 1.15)
  smackLead: 0.03,   // smack slightly earlier — 30ms before the strike lands (was 0 = on completion)
  settleDur: 0.55,
};

/** Slider bounds for the DEV tuner — [min, max, step] per key. */
export const LUNGE_RANGES: Record<keyof LungeConfig, [number, number, number]> = {
  windupDur: [0.05, 0.5, 0.01],
  windupDepth: [0, 0.4, 0.01],
  strikeDur: [0.04, 0.3, 0.01],
  strikeDist: [0.8, 1.8, 0.01],
  smackLead: [0, 0.12, 0.005],
  settleDur: [0.2, 1.2, 0.01],
};
export const LUNGE_KEYS = Object.keys(DEFAULTS) as (keyof LungeConfig)[];

const KEY = 'ascent.lunge';
let cfg: LungeConfig = (() => {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return { ...DEFAULTS, ...(saved && typeof saved === 'object' ? (saved as Partial<LungeConfig>) : {}) };
  } catch {
    return { ...DEFAULTS };
  }
})();

export function getLungeConfig(): LungeConfig {
  return cfg;
}
export function setLungeValue(key: keyof LungeConfig, value: number): void {
  cfg = { ...cfg, [key]: value };
  try {
    localStorage.setItem(KEY, JSON.stringify(cfg));
  } catch {
    /* ignore */
  }
}
export function resetLungeConfig(): void {
  cfg = { ...DEFAULTS };
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
