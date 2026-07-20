/**
 * Parameters for the combat attack lunge (`playAttackLunge` in useCombatReplay.ts). `DEFAULTS` below is what
 * SHIPS; the DEV Lunge tuner may override them for the current tab only (sessionStorage — see the note above
 * `KEY`, which explains why it is no longer localStorage). The lunge reads `getLungeConfig()` at call time.
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
  /** Strike EASE — the acceleration curve into contact, indexed into `STRIKE_EASES`. This is what makes a
   *  strike read as a snap vs a shove: `power3.in` sits still then rockets, `power1.in` is nearly linear,
   *  `back.in` winds back a touch first. It was hardcoded until the strike-feel pass, so it could never be
   *  dialled — the most likely lever when "the strike reads wrong". Stored as an INDEX so it stays a number
   *  (the tuner + ranges are numeric) and the shipped default is greppable. */
  strikeEaseIdx: number;
}

/** Selectable strike curves, slowest-to-snappiest acceleration. Index into this via `strikeEaseIdx`. */
export const STRIKE_EASES = [
  'none',        // 0 — linear: constant speed, no acceleration
  'power1.in',   // 1
  'power2.in',   // 2 — the GSAP default-ish accelerate
  'power3.in',   // 3 — SHIPPED: hangs, then rockets into contact
  'power4.in',   // 4 — even later, harder snap
  'expo.in',     // 5 — extreme: almost still, then a blur
  'back.in(1.4)',// 6 — pulls back slightly before driving in
  'circ.in',     // 7 — smooth ramp with a hard finish
] as const;

const DEFAULTS: LungeConfig = {
  windupDur: 0.70,   // owner: ~50% longer wind-up (was 0.47); the beat hold derives from this so damage still lands on contact
  windupDepth: 0.1,
  windupScale: 1.28, // swell during the wind-up, then return to 1 on the strike
  strikeDur: 0.17,   // fallback only (used when elements are unresolved); live strikes derive from distance
  bite: 16,
  leadTilt: 7.5,
  defenderSpin: 15,
  attackerRebound: 2.5,
  targetSpeed: 1100,
  minStrikeDur: 0.13,
  maxStrikeDur: 0.44,
  smackLead: 0.005,  // smack ~5ms before the strike lands (near-on-contact)
  settleDur: 0.34,   // a snappier elastic return to rest
  attackGap: 0.14,   // breather between swings (the inter-attack pause). 0.34 -> 0.22 -> 0.14 across two
                     // tightening passes. With the attack lead below this puts the post-impact hold at 500ms,
                     // which still fully covers the 340ms elastic settle; see combat-timing-reference.md.
  strikeEaseIdx: 3,  // 'power3.in' — the shipped curve (index into STRIKE_EASES)
};

/** Slider bounds for the DEV tuner — [min, max, step] per key. */
export const LUNGE_RANGES: Record<keyof LungeConfig, [number, number, number]> = {
  windupDur: [0.05, 1.2, 0.01],
  windupDepth: [0, 0.4, 0.01],
  windupScale: [1, 1.5, 0.01],
  strikeDur: [0.04, 0.3, 0.01],
  bite: [0, 40, 1],
  leadTilt: [0, 20, 0.5],
  defenderSpin: [0, 30, 0.5],
  attackerRebound: [0, 20, 0.5],
  targetSpeed: [400, 3000, 25],
  minStrikeDur: [0.05, 0.3, 0.01],
  maxStrikeDur: [0.15, 0.6, 0.01],
  smackLead: [0, 0.12, 0.005],
  settleDur: [0.1, 1.2, 0.01],
  attackGap: [0, 0.7, 0.02],
  strikeEaseIdx: [0, 7, 1],
};

export const LUNGE_KEYS = Object.keys(DEFAULTS) as (keyof LungeConfig)[];

// The DEV Lunge tuner writes here. It was previously backed by localStorage and that was REMOVED, because a
// stray slider nudge persisted silently — forever, across sessions — and skewed every later attack's timing
// (which drives the beat hold, so it could cut death fades + lunges) with no visible cause.
//
// It's back for the strike-feel pass, with that footgun designed out two ways:
//   1. **sessionStorage, not localStorage** — overrides survive an HMR reload while you're tuning, and die
//      with the tab. They can never leak into tomorrow's session or another tab.
//   2. **never silent** — `lungeOverrides()` lists every key that differs from DEFAULTS, and the tuner shows
//      it as a loud banner, so a modified config always announces itself.
// Shipping a new feel is still a code change: dial it, Copy, paste into DEFAULTS above, commit.
const KEY = 'ascent.lunge';
let cfg: LungeConfig = (() => {
  try {
    const saved: unknown = JSON.parse(sessionStorage.getItem(KEY) ?? '{}');
    return { ...DEFAULTS, ...(saved && typeof saved === 'object' ? (saved as Partial<LungeConfig>) : {}) };
  } catch {
    return { ...DEFAULTS };
  }
})();

export function getLungeConfig(): LungeConfig {
  return cfg;
}
/** The GSAP ease string for the strike, resolved from the index (clamped, so a bad value can't break a swing). */
export function strikeEase(): string {
  return STRIKE_EASES[Math.min(STRIKE_EASES.length - 1, Math.max(0, Math.round(cfg.strikeEaseIdx)))] ?? 'power3.in';
}
/** Keys currently differing from the shipped DEFAULTS — drives the tuner's "modified" banner so an override
 *  is never silent (the exact failure mode that got the old tuner deleted). */
export function lungeOverrides(): (keyof LungeConfig)[] {
  return (Object.keys(DEFAULTS) as (keyof LungeConfig)[]).filter((k) => cfg[k] !== DEFAULTS[k]);
}
export function setLungeValue(key: keyof LungeConfig, value: number): void {
  cfg = { ...cfg, [key]: value };
  try {
    sessionStorage.setItem(KEY, JSON.stringify(cfg));
  } catch {
    /* ignore */
  }
}
export function resetLungeConfig(): void {
  cfg = { ...DEFAULTS };
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
