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
  /** Strike duration (s) — the drive into the defender (lower = faster/snappier). */
  strikeDur: number;
  /** Strike distance — fraction of the full vector the attacker covers (>1 overdrives into the target). */
  strikeDist: number;
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
  strikeDur: 0.16,   // a heavier drive into the target
  strikeDist: 1.44,  // a deeper lunge that punches further into the defender
  smackLead: 0.005,  // smack ~5ms before the strike lands (near-on-contact)
  settleDur: 1.06,   // a slower, springier elastic return to rest
  attackGap: 0.22,   // shorter breather between swings (the inter-attack pause)
  // NOTE: windupDur + strikeDur = 0.53s = the lunge's connection time. `DELAY.attack` in
  // useCombatReplay.ts is kept at 353 (×SPEED 1.5 ≈ 530ms) so the damage float + recoil land ON contact.
};

/** Slider bounds for the DEV tuner — [min, max, step] per key. */
export const LUNGE_RANGES: Record<keyof LungeConfig, [number, number, number]> = {
  windupDur: [0.05, 0.5, 0.01],
  windupDepth: [0, 0.4, 0.01],
  windupScale: [1, 1.5, 0.01],
  strikeDur: [0.04, 0.3, 0.01],
  strikeDist: [0.8, 1.8, 0.01],
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
