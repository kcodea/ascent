/**
 * Parameters for the combat attack lunge (`playAttackLunge` in useCombatReplay.ts). `DEFAULTS` below is what
 * SHIPS; the DEV Lunge tuner may override them for the current tab only (sessionStorage — see the note above
 * `KEY`, which explains why it is no longer localStorage). The lunge reads `getLungeConfig()` at call time.
 *
 * ## Every dial here is a property of the VECTOR, never of a seat
 *
 * The board `.row` is `justify-content: center`, so a 6-card side seats at different x positions than a
 * 7-card side, and the rows RE-CENTER mid-combat as units die. A distinct seating is a (count, index) pair
 * — 28 per side, 784 attacker→defender vectors — and even that undercounts, because the same nominal
 * "slot 3 → slot 5" is a different vector before and after a death reflows the row. There is no stable
 * per-pairing key to hang config on.
 *
 * So the lunge is tuned as FUNCTIONS OF THE APPROACH VECTOR, resolved live from the two rects:
 *   - distance → strike duration (constant px/s via `targetSpeed`, bounded by the clamps)
 *   - distance → strike EASE (three bands, see `strikeEaseFor`) — a curve that reads as a snap over 180ms
 *     reads as a drift-then-lurch over 440ms, so short and long strikes get their own curve
 *   - approach angle → lead tilt (`tiltAngleScale`) — the tilt used to read only `sign(dx)`, so a steep
 *     diagonal led with the same corner as a flat sideways swing
 * If a knob would need to know "which slot", it can't ship. That constraint is the point of this file.
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
  /** Target speed (px/s) — strike travel speed that sets the (distance-scaled) strike duration. */
  targetSpeed: number;
  /** Strike duration clamp floor (s). Travel shorter than `targetSpeed * minStrikeDur` takes this long
   *  regardless — i.e. the shortest strikes all run SLOWER than `targetSpeed`. */
  minStrikeDur: number;
  /** Strike duration clamp ceiling (s). Travel longer than `targetSpeed * maxStrikeDur` takes this long
   *  regardless, so those strikes move FASTER than `targetSpeed` (same duration over a longer distance).
   *  They flatten to one DURATION, not one speed. The tuner counts how often each bound is hit, because a
   *  clamped strike ignores `targetSpeed` — the usual reason dragging that slider changes nothing. */
  maxStrikeDur: number;
  /** Strike duration (s) — FALLBACK only, used when elements are unresolved and there is no geometry. */
  strikeDur: number;
  /** Travel (px) at or below which a strike uses the SHORT band's ease. */
  bandShortPx: number;
  /** Travel (px) above which a strike uses the LONG band's ease. Between the two = the MID band. */
  bandLongPx: number;
  /** Strike ease for the SHORT band, indexed into `STRIKE_EASES`. */
  easeShortIdx: number;
  /** Strike ease for the MID band, indexed into `STRIKE_EASES`. */
  easeMidIdx: number;
  /** Strike ease for the LONG band, indexed into `STRIKE_EASES`. */
  easeLongIdx: number;
  /** Lead tilt (deg) — the base tilt used to lead with a corner (sign chosen from dx). */
  leadTilt: number;
  /** Face-on ramp (px) — the horizontal offset over which the corner + tilt fade IN. A defender directly
   *  ahead (|dx| = 0) is struck flat — leading-edge midpoint to centre, no tilt (owner note 2026-07-21: the
   *  corner rule's sideways shimmy looked wrong straight-across); at |dx| ≥ this, the full corner-strike.
   *  A blend, so adjacent pairings can't pop between looks. 0 disables the fade (always full corner). */
  faceOnRamp: number;
  /** Lead-tilt ANGLE SCALE (0–1) — how much of the approach's slope off horizontal is added to the tilt.
   *  0 = the shipped behaviour (tilt reads only `sign(dx)`, so a steep diagonal leads with the same corner
   *  as a flat sideways swing); 1 = the card fully aligns to the line it travels along. The vector-driven
   *  half of the lead tilt. */
  tiltAngleScale: number;
  /** Defender spin (deg) — the defender counter-rotates this much on impact (opposite the lead). */
  defenderSpin: number;
  /** Attacker rebound (deg) — the attacker's rotational kick-back at contact before the settle. */
  attackerRebound: number;
  /** Smack lead (s) — fire the impact sound + knockback this many seconds BEFORE the strike completes. */
  smackLead: number;
  /** Settle duration (s) — the elastic return to rest. */
  settleDur: number;
  /** Attack gap (s) — a breather held AFTER an impact, before the next swing, so back-to-back attacks
   *  don't blur together (the damage lands on contact, then this pause, then the next lunge). */
  attackGap: number;
}

/** Selectable strike curves, slowest-to-snappiest acceleration. Index into this via the band ease keys. */
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

// Owner-tuned 2026-07-21, in the first pass where the strike was actually RENDERING its full travel (the
// `.unit` transform-transition had been eating ~60-80% of every strike until that fix — see the devlog).
// Everything here was dialled by eye at 1x in the DEV Lunge tuner against that corrected motion.
const DEFAULTS: LungeConfig = {
  windupDur: 0.54,   // owner 2026-07-21 (0.70 -> 0.54); the beat hold derives from this so damage still lands on contact
  windupDepth: 0.13,
  windupScale: 1.32, // swell during the wind-up, then return to 1 on the strike
  targetSpeed: 400,  // owner-tuned SLOW + deliberate. At this speed the board's typical 100-215px travels
                     // compute to ~0.25-0.31s — inside the clamps — so distance genuinely paces the strike
                     // again (at the old 1100 nearly every swing hit the `min` floor and ran fixed-duration).
  minStrikeDur: 0.16,
  maxStrikeDur: 0.35, // only the longest cross-board diagonals reach this
  strikeDur: 0.17,   // fallback only (used when elements are unresolved); live strikes derive from distance
  bandShortPx: 220,
  bandLongPx: 460,
  easeShortIdx: 5,   // 'expo.in' on every band (owner 2026-07-21): hangs almost still, then blurs into contact
  easeMidIdx: 5,
  easeLongIdx: 5,
  leadTilt: 8,
  faceOnRamp: 150,   // straight-across attacks slam flat; the corner-strike is fully in by 150px of sideways
                     // offset — i.e. a ONE-slot-over attack (77px here) still reads about half-flat.
  tiltAngleScale: 0, // 0 = the shipped sign(dx)-only tilt; raise to let the approach slope steer the corner
  defenderSpin: 15,
  attackerRebound: 2.5,
  smackLead: 0.005,  // smack ~5ms before the strike lands (near-on-contact)
  settleDur: 1.11,   // owner 2026-07-21 (0.34 -> 1.11): a long, lazy elastic drift back to rest. NOTE this is
                     // far longer than the ~500ms post-impact hold, so a settle now visibly runs on THROUGH
                     // the following beats — deliberate (it reads as weight, and the settle is a decorative
                     // tail the clock never waits on). A re-attacker restarts clean: playLunge kills its tweens.
  attackGap: 0.14,   // breather between swings (the inter-attack pause). 0.34 -> 0.22 -> 0.14 across two
                     // tightening passes; with the attack lead this puts the post-impact hold at ~500ms.
                     // See combat-timing-reference.md.
};

/** Slider bounds for the DEV tuner — [min, max, step] per key. */
export const LUNGE_RANGES: Record<keyof LungeConfig, [number, number, number]> = {
  windupDur: [0.05, 1.2, 0.01],
  windupDepth: [0, 0.4, 0.01],
  windupScale: [1, 1.5, 0.01],
  targetSpeed: [400, 3000, 25],
  minStrikeDur: [0.05, 0.3, 0.01],
  maxStrikeDur: [0.15, 0.8, 0.01],
  strikeDur: [0.04, 0.3, 0.01],
  bandShortPx: [60, 400, 10],
  bandLongPx: [200, 900, 10],
  easeShortIdx: [0, 7, 1],
  easeMidIdx: [0, 7, 1],
  easeLongIdx: [0, 7, 1],
  leadTilt: [0, 20, 0.5],
  faceOnRamp: [0, 300, 5],
  tiltAngleScale: [0, 1, 0.05],
  defenderSpin: [0, 30, 0.5],
  attackerRebound: [0, 20, 0.5],
  smackLead: [0, 0.12, 0.005],
  settleDur: [0.1, 1.2, 0.01],
  attackGap: [0, 0.7, 0.02],
};

export const LUNGE_KEYS = Object.keys(DEFAULTS) as (keyof LungeConfig)[];

/** Which strike-ease band a travel distance falls in. */
export type StrikeBand = 'short' | 'mid' | 'long';

export function strikeBandFor(travelPx: number): StrikeBand {
  if (travelPx <= cfg.bandShortPx) return 'short';
  return travelPx > cfg.bandLongPx ? 'long' : 'mid';
}

const EASE_KEY: Record<StrikeBand, keyof LungeConfig> = {
  short: 'easeShortIdx',
  mid: 'easeMidIdx',
  long: 'easeLongIdx',
};

/** The GSAP ease string for a strike of this travel distance — the distance→curve function. Clamped, so a
 *  bad index can't break a swing. */
export function strikeEaseFor(travelPx: number): string {
  const idx = cfg[EASE_KEY[strikeBandFor(travelPx)]];
  return STRIKE_EASES[Math.min(STRIKE_EASES.length - 1, Math.max(0, Math.round(idx)))] ?? 'power3.in';
}

/** The DEV tuner renders one section per group — grouping only, no behaviour. Every key must appear in
 *  exactly one group (enforced by test), so a newly-added dial can't be silently unreachable. */
export const LUNGE_GROUPS: { title: string; keys: (keyof LungeConfig)[] }[] = [
  { title: 'Wind-up', keys: ['windupDur', 'windupDepth', 'windupScale'] },
  { title: 'Strike · distance → duration', keys: ['targetSpeed', 'minStrikeDur', 'maxStrikeDur', 'strikeDur'] },
  { title: 'Strike · distance → ease', keys: ['bandShortPx', 'bandLongPx', 'easeShortIdx', 'easeMidIdx', 'easeLongIdx'] },
  { title: 'Contact · angle → tilt', keys: ['leadTilt', 'faceOnRamp', 'tiltAngleScale', 'defenderSpin', 'attackerRebound', 'smackLead'] },
  { title: 'Recovery', keys: ['settleDur', 'attackGap'] },
];

/** Keys whose value is an index into `STRIKE_EASES` — the tuner shows the curve NAME for these. */
export const EASE_KEYS: (keyof LungeConfig)[] = ['easeShortIdx', 'easeMidIdx', 'easeLongIdx'];

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
