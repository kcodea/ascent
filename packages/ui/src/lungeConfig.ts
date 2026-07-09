/**
 * Tunable parameters for the combat attack lunge (`playAttackLunge` in useCombatReplay.ts). Held in one
 * mutable, localStorage-persisted config so the feel can be dialed in by eye via the DEV Lunge tuner
 * (`LungeTuner.tsx`) without a code round-trip — set a value here as the shipped default. The lunge reads
 * `getLungeConfig()` at call time, so changes apply to the next attack.
 *
 * Note the windup + strike durations are GSAP seconds (NOT scaled by the beat-clock SPEED). The attack
 * RESULT beat (damage floats / recoil) is timed to land at the lunge's connection — the scheduler derives
 * that hold live from `windupDur + strikeDur - smackLead` (see useCombatReplay.ts), so the damage always
 * lands on contact however you dial these; the sum is no longer pinned to any fixed value.
 */
export interface LungeConfig {
  /** Wind-up duration (s) — the lean-back before the strike. */
  windupDur: number;
  /** Wind-up depth — fraction of the attacker→defender vector to lean back. */
  windupDepth: number;
  /** Wind-up scale — how much the attacker swells during the anticipation lean-back (1.2 = +20%). */
  windupScale: number;
  /** Strike duration (s). Task 3 makes this a fallback (used only when elements are unresolved) once
   *  live strikes derive duration from travel distance via contactGeometry; until then it still drives
   *  every strike. */
  strikeDur: number;
  /** Bite (px) — how far the leading corner drives past surface contact, so it visibly bites in. */
  bite: number;
  /** Lead tilt (deg) — the attacker tilts this much to lead with a corner (sign chosen from dx). */
  leadTilt: number;
  /** Defender spin (deg) — the defender counter-rotates this much on impact (opposite the lead). */
  defenderSpin: number;
  /** Attacker rebound (deg) — the attacker's rotational kick-back at contact before the settle. */
  attackerRebound: number;
  /** Target speed (px/s) — strike travel speed that sets the (distance-scaled) strike duration. */
  targetSpeed: number;
  /** Strike duration clamp floor (s). */
  minStrikeDur: number;
  /** Strike duration clamp ceiling (s). */
  maxStrikeDur: number;
  /** Smack lead (s) — fire the impact sound + knockback this many seconds BEFORE the strike completes. */
  smackLead: number;
  /** Settle duration (s) — the elastic return to rest. */
  settleDur: number;
  /** Attack gap (s) — a breather held AFTER an impact, before the next swing, so back-to-back attacks
   *  don't blur together (the damage lands on contact, then this pause, then the next lunge). */
  attackGap: number;
}

const DEFAULTS: LungeConfig = {
  windupDur: 0.37,   // longer, weightier wind-up (tuned by eye in the DEV Lunge tuner)
  windupDepth: 0.1,
  windupScale: 1.2,  // swell +20% during the wind-up, then return to 1 on the strike
  strikeDur: 0.16,   // still drives every strike today; Task 3 makes it the unresolved-elements fallback
  bite: 6,
  leadTilt: 7,
  defenderSpin: 6,
  attackerRebound: 5,
  targetSpeed: 1600,
  minStrikeDur: 0.1,
  maxStrikeDur: 0.28,
  smackLead: 0.005,  // smack ~5ms before the strike lands (near-on-contact)
  settleDur: 1.06,   // a slower, springier elastic return to rest
  attackGap: 0.22,   // shorter breather between swings (the inter-attack pause)
};

/** Slider bounds for the DEV tuner — [min, max, step] per key. */
export const LUNGE_RANGES: Record<keyof LungeConfig, [number, number, number]> = {
  windupDur: [0.05, 0.5, 0.01],
  windupDepth: [0, 0.4, 0.01],
  windupScale: [1, 1.5, 0.01],
  strikeDur: [0.04, 0.3, 0.01],
  bite: [0, 24, 1],
  leadTilt: [0, 20, 0.5],
  defenderSpin: [0, 20, 0.5],
  attackerRebound: [0, 20, 0.5],
  targetSpeed: [600, 3000, 50],
  minStrikeDur: [0.05, 0.2, 0.01],
  maxStrikeDur: [0.15, 0.45, 0.01],
  smackLead: [0, 0.12, 0.005],
  settleDur: [0.2, 1.2, 0.01],
  attackGap: [0, 0.7, 0.02],
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
