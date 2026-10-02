/**
 * THE SOUL STITCH HERO ATTACK (the first attack BUILT at the Ancient rarity, for the ANCIENT OF BONDS style): its tuned
 * values, its pure timeline, the pure needle and thread geometry and the pure camera.
 *
 * Owner 2026-10-02: an "ancient" attack for the Ancient of Bonds: "this ancient binds things together and using
 * soulbindings". The owner picked the concept SOUL STITCH: THE SIGNATURE IS STITCHING THE TARGET TO YOU. Crystal
 * needles trail violet soul thread from the striking hero and sew it into the struck hero. No other attack sews: the
 * thread is drawn along the needle's own path, it hangs, it goes taut, it is tugged and it snaps.
 *
 * FOUR TIERS (the shared, owner-approved thresholds: I 1-5, II 6-11, III 12-19, IV 20+; a knockout always plays IV).
 * I and II were approved as built on 5173 ("t1 and t2 are great"). IV is the owner's pick of three concept pairs, PAIR 2
 * "BOUND TOGETHER" ("the huge one looks pretty awesome"); III is the owner's pick of three later concepts, "PINNED" (the
 * first III, a seam across the board, was rejected: "t3 attack is HORRIBLE ... i hate the direction of it"):
 *  I    NEEDLE. One crystal needle flies out on an arc trailing a violet thread. It pierces the target and the thread
 *       hangs taut between the two heroes. A tug (the hero leans back, the target is yanked toward it, a pulse of light
 *       runs down the thread), then the hit: the needle bursts into shards and the thread snaps.
 *  II   CROSS. Three needles cross-stitch an X into the target: two sew the diagonals across the face, the third pins
 *       the crossing. The hero yanks; the threads snap THROUGH the face, shards spraying along both stitches.
 *  III  PINNED. Five crystal needles stab into the target's rim at the points of a star, one after another, each
 *       trailing a thread back to the hero. The hero leans back on all five and the portrait STRETCHES toward the hero
 *       against the pins; then all five pins rip out at once (five snaps, crystal splinters at each pin) and the
 *       portrait snaps back with the hit.
 *  IV   BOUND (Huge; always on a knockout). Six needles lash the two portraits together, each sewing a lace from the
 *       target back to the hero and out again. The hero leans back and YANKS: the target's portrait is dragged off its
 *       spot halfway across the board, into a giant gold HEART-KNOT (the knot on the Ancient's chest) that ties shut
 *       round it, crushing it small. The hero strikes down the laces; the knot BURSTS in gold and violet ribbons and the
 *       target is flung back to its spot.
 *
 * THE CONTRACT: every piercing and every stitch before the impact is a TICK (FX and sound only). The consequence (the
 * damage, Armor, Resolve) lands ONCE: on the snap (I), the yank (II), the pins ripping out (III) or the knot bursting
 * (IV).
 *
 * Flat 2D. No hit-stop anywhere (owner 2026-09-28: "it looks like lag"). Reduced motion: no needles, threads, shake,
 * zoom or drag; the numbers fade and the blow lands. No rune or explosion sounds (owner 2026-10-02: "do not use the
 * rune explosion sound, it is overused right now").
 *
 * Tuner convention (the shared `configStore`): localStorage in DEV only, values clamped on write and on load; production
 * always plays the DEFAULTS.
 */
import { configStore } from '../heroAttack/configStore';
import { clamp, type Pt } from '../heroAttack/easing';
import {
  HERO_ATTACK_TIER_THRESHOLDS, TIERS, reducedAttackTimeline, attackTier, type AttackTierContext, type TierNum, isKnockoutVariant,
} from '../heroAttack/tiers';
import { KO_SHAKE } from '../heroAttack/knockout';

export { TIERS };
export type { TierNum };

export const STITCH_KINDS = ['needle', 'cross', 'pinned', 'bound'] as const;
export type StitchKind = (typeof STITCH_KINDS)[number];

/** Tier I..IV -> what it sews. */
export function stitchKind(tier: TierNum): StitchKind { return STITCH_KINDS[tier - 1]!; }

/** The four tiers' dial groups (a config key is `t1..t4` + a suffix). */
export const STITCH_LEVELS = ['t1', 't2', 't3', 't4'] as const;

export const STITCH_TIER_SUFFIXES = [
  'ReadyMs', 'Needles', 'StaggerMs', 'FlightMs', 'Arc', 'SewMs', 'Passes', 'HangMs', 'TugMs',
  'Shake', 'Zoom', 'Punch', 'Shards', 'Burst', 'SettleMs', 'Dim',
] as const;
export type StitchTierSuffix = (typeof STITCH_TIER_SUFFIXES)[number];
type TierKey = `t${TierNum}${StitchTierSuffix}`;

interface GlobalConfig {
  tier2At: number; tier3At: number; tier4At: number;
  // Ready
  absorbMs: number;
  heroSwell: number;
  // The needle
  needleSize: number;
  needleGlow: number;
  // The thread
  threadWidth: number;
  threadGlow: number;
  sag: number;
  tautMs: number;
  twangPx: number;
  // The pull (I-II)
  heroPullPx: number;
  foeYankPx: number;
  // III: pinned
  stretch: number;
  pinRim: number;
  // IV: bound together
  dragReach: number;
  knotMs: number;
  knotSize: number;
  crush: number;
  strikeMs: number;
  flingMs: number;
  heroLungePx: number;
  ripRibbons: number;
  rainShards: number;
  slowMo: number;
  slowMoMs: number;
  // Camera and portraits
  knockPx: number;
  squash: number;
  shakeMs: number;
  zoomOutMs: number;
  reducedFadeMs: number;
  // Colours
  colorThread: string;
  colorLilac: string;
  colorDeep: string;
  colorGold: string;
  colorBone: string;
  colorPlayer: string;
  colorFoe: string;
  // Sound: a clip, a gain and a pitch per cue ('' = silent)
  sfxSummonClip: string; sfxSummonGain: number; sfxSummonRate: number;
  sfxLaunchClip: string; sfxLaunchGain: number; sfxLaunchRate: number;
  sfxPierceClip: string; sfxPierceGain: number; sfxPierceRate: number;
  sfxStitchClip: string; sfxStitchGain: number; sfxStitchRate: number;
  sfxTugClip: string; sfxTugGain: number; sfxTugRate: number;
  sfxSnapClip: string; sfxSnapGain: number; sfxSnapRate: number;
  sfxImpactClip: string; sfxImpactGain: number; sfxImpactRate: number;
  sfxThumpClip: string; sfxThumpGain: number; sfxThumpRate: number;
  sfxShatterClip: string; sfxShatterGain: number; sfxShatterRate: number;
  sfxTwangClip: string; sfxTwangGain: number; sfxTwangRate: number;
  sfxDragClip: string; sfxDragGain: number; sfxDragRate: number;
  sfxKnotClip: string; sfxKnotGain: number; sfxKnotRate: number;
  sfxStrainClip: string; sfxStrainGain: number; sfxStrainRate: number;
  sfxStrikeClip: string; sfxStrikeGain: number; sfxStrikeRate: number;
  sfxRumbleClip: string; sfxRumbleGain: number; sfxRumbleRate: number;
  sfxBoomClip: string; sfxBoomGain: number; sfxBoomRate: number;
  sfxRainClip: string; sfxRainGain: number; sfxRainRate: number;
  sfxDuck: number;
  // Preview only (the tuner's Play buttons). Never read by a real fight, and left out of Copy JSON.
  previewDamage: number;
  previewParts: number;
}
export type HeroStitchConfig = GlobalConfig & Record<TierKey, number>;

export const HERO_STITCH_COLOR_KEYS = ['colorThread', 'colorLilac', 'colorDeep', 'colorGold', 'colorBone', 'colorPlayer', 'colorFoe'] as const;
export const HERO_STITCH_CLIP_KEYS = [
  'sfxSummonClip', 'sfxLaunchClip', 'sfxPierceClip', 'sfxStitchClip', 'sfxTugClip', 'sfxSnapClip', 'sfxImpactClip',
  'sfxThumpClip', 'sfxShatterClip', 'sfxTwangClip', 'sfxDragClip', 'sfxKnotClip', 'sfxStrainClip', 'sfxStrikeClip',
  'sfxRumbleClip', 'sfxBoomClip', 'sfxRainClip',
] as const;
export type HeroStitchStrKey = (typeof HERO_STITCH_COLOR_KEYS)[number] | (typeof HERO_STITCH_CLIP_KEYS)[number];
export type HeroStitchNumKey = Exclude<keyof HeroStitchConfig, HeroStitchStrKey>;

/**
 * Tier I .. IV per suffix: the escalation ladder. I and II are the approved values (owner 2026-10-02: "t1 and t2 are
 * great"). III: `Needles` the pins, `TugMs` the stretch before they rip out (it does not sew). IV: `SewMs` each lace (to
 * the hero and back out), `Passes` its legs, `TugMs` the drag across the board.
 */
const TIER_DEFAULTS: Record<StitchTierSuffix, [number, number, number, number]> = {
  ReadyMs: [340, 400, 420, 480],
  Needles: [1, 3, 5, 6],
  StaggerMs: [0, 150, 110, 70],
  FlightMs: [380, 360, 330, 300],
  Arc: [0.16, 0.2, 0.16, 0.18],
  SewMs: [0, 190, 0, 300],
  Passes: [0, 1, 0, 2],
  HangMs: [220, 180, 160, 140],
  TugMs: [220, 240, 620, 520],
  Shake: [4, 7, 16, 26],
  Zoom: [0.02, 0.03, 0.045, 0.07],
  Punch: [0.015, 0.022, 0.045, 0.08],
  Shards: [8, 14, 30, 44],
  Burst: [1, 1.1, 1.45, 2],
  SettleMs: [240, 280, 320, 340],
  Dim: [0.06, 0.16, 0.28, 0.42],
};

export const STITCH_TIER_RANGES: Record<StitchTierSuffix, [number, number, number]> = {
  ReadyMs: [60, 1500, 10],
  Needles: [1, 8, 1],
  StaggerMs: [0, 500, 5],
  FlightMs: [60, 1200, 10],
  Arc: [0, 0.5, 0.01],
  SewMs: [0, 1600, 5],
  Passes: [0, 24, 1],
  HangMs: [0, 1200, 10],
  TugMs: [60, 1500, 10],
  Shake: [0, 40, 0.5],
  Zoom: [0, 0.14, 0.002],
  Punch: [0, 0.1, 0.001],
  Shards: [0, 60, 1],
  Burst: [0.3, 3, 0.05],
  SettleMs: [0, 1600, 10],
  Dim: [0, 0.8, 0.01],
};

const tierDefaults = Object.fromEntries(TIERS.flatMap((t) => STITCH_TIER_SUFFIXES.map((s) => [`t${t}${s}`, TIER_DEFAULTS[s][t - 1]]))) as Record<TierKey, number>;

export const HERO_STITCH_DEFAULTS: HeroStitchConfig = {
  // The shared, owner-approved thresholds (6 / 12 / 20): the same blow steps Soul Stitch up where it steps Blast up.
  ...HERO_ATTACK_TIER_THRESHOLDS,
  absorbMs: 190,
  heroSwell: 0.04,
  needleSize: 1,
  needleGlow: 0.7,
  threadWidth: 3.2,
  threadGlow: 0.8,
  sag: 0.07,
  tautMs: 150,
  twangPx: 9,
  heroPullPx: 18,
  foeYankPx: 22,
  stretch: 0.34,
  pinRim: 0.9,
  dragReach: 0.5,
  knotMs: 560,
  knotSize: 1.3,
  crush: 0.62,
  strikeMs: 260,
  flingMs: 320,
  heroLungePx: 30,
  ripRibbons: 18,
  rainShards: 26,
  slowMo: 0.3,
  slowMoMs: 260,
  knockPx: 16,
  squash: 0.07,
  shakeMs: 320,
  zoomOutMs: 360,
  reducedFadeMs: 260,
  // The Ancient of Bonds palette (owner reference): violet to lilac, a deep purple, gold, bone.
  colorThread: '#a855f7',
  colorLilac: '#e9d5ff',
  colorDeep: '#2e1065',
  colorGold: '#d4a537',
  colorBone: '#efe6d2',
  colorPlayer: '#f0c75e',
  colorFoe: '#ff6a7a',
  // Reused clips (no ElevenLabs key is set up; the prompts are queued in the devlog): a crystal shimmer, a whip of air,
  // a crystal ting, a soul whisper per stitch, a wind-up, a taut string SNAPPING (the signature), a bright hit, crystal
  // shattering, a low taut-string twang as the pull starts, a heavy drag, a gold clank as the knot ties, a riser, a
  // hammer strike.
  // Owner 2026-10-02: "do not use the rune explosion sound, it is overused right now": no rune or explosion clips.
  sfxSummonClip: 'equipmentsheen', sfxSummonGain: 0.5, sfxSummonRate: 0.9,
  sfxLaunchClip: 'fx/stereogenicstudio-swish-swoosh-woosh-sfx-27-357164-3', sfxLaunchGain: 0.35, sfxLaunchRate: 1.7,
  sfxPierceClip: 'divineshieldbreak', sfxPierceGain: 0.4, sfxPierceRate: 1.6,
  sfxStitchClip: 'spirittendril', sfxStitchGain: 0.28, sfxStitchRate: 1.4,
  sfxTugClip: 'windup', sfxTugGain: 0.42, sfxTugRate: 1.25,
  sfxSnapClip: 'fx/universfield-whip-snap-242215', sfxSnapGain: 0.55, sfxSnapRate: 1.3,
  sfxImpactClip: 'fx/blue-impact-hit', sfxImpactGain: 0.7, sfxImpactRate: 0.95,
  sfxThumpClip: 'smack2', sfxThumpGain: 0.4, sfxThumpRate: 0.85,
  sfxShatterClip: 'rebornshatter', sfxShatterGain: 0.5, sfxShatterRate: 1.2,
  sfxTwangClip: 'fx/universfield-whip-snap-242215', sfxTwangGain: 0.3, sfxTwangRate: 0.6,
  sfxDragClip: 'fx/metal-woosh', sfxDragGain: 0.5, sfxDragRate: 0.7,
  sfxKnotClip: 'equipclang', sfxKnotGain: 0.35, sfxKnotRate: 0.8,
  sfxStrainClip: 'fx/oona-powerup', sfxStrainGain: 0.42, sfxStrainRate: 0.85,
  sfxStrikeClip: 'titanhammer', sfxStrikeGain: 0.6, sfxStrikeRate: 1.05,
  sfxRumbleClip: 'fx/heavy-rock-impact', sfxRumbleGain: 0.55, sfxRumbleRate: 0.9,
  sfxBoomClip: 'fx/triple-impact', sfxBoomGain: 0.4, sfxBoomRate: 1.1,
  sfxRainClip: 'prismaticpick', sfxRainGain: 0.32, sfxRainRate: 1.2,
  sfxDuck: 0.6,
  previewDamage: 12,
  previewParts: 4,
  ...tierDefaults,
};

const GLOBAL_RANGES: Record<Exclude<keyof GlobalConfig, HeroStitchStrKey>, [number, number, number]> = {
  tier2At: [2, 40, 1], tier3At: [2, 60, 1], tier4At: [2, 80, 1],
  absorbMs: [60, 600, 10],
  heroSwell: [0, 0.2, 0.005],
  needleSize: [0.3, 3, 0.05],
  needleGlow: [0, 1, 0.01],
  threadWidth: [0.5, 12, 0.1],
  threadGlow: [0, 1.5, 0.01],
  sag: [0, 0.3, 0.005],
  tautMs: [20, 800, 10],
  twangPx: [0, 40, 0.5],
  heroPullPx: [0, 60, 1],
  foeYankPx: [0, 80, 1],
  stretch: [0, 0.8, 0.01],
  pinRim: [0.5, 1.2, 0.01],
  dragReach: [0, 0.8, 0.01],
  knotMs: [120, 1600, 10],
  knotSize: [0.6, 3, 0.05],
  crush: [0.3, 1, 0.01],
  strikeMs: [60, 1000, 10],
  flingMs: [80, 1200, 10],
  heroLungePx: [0, 120, 1],
  ripRibbons: [0, 24, 1],
  rainShards: [0, 60, 1],
  slowMo: [0.1, 1, 0.01],
  slowMoMs: [0, 800, 10],
  knockPx: [0, 60, 1],
  squash: [0, 0.3, 0.005],
  shakeMs: [0, 1200, 10],
  zoomOutMs: [60, 1500, 10],
  reducedFadeMs: [60, 1000, 10],
  sfxSummonGain: [0, 2, 0.05], sfxSummonRate: [0.5, 2.5, 0.01],
  sfxLaunchGain: [0, 2, 0.05], sfxLaunchRate: [0.5, 2.5, 0.01],
  sfxPierceGain: [0, 2, 0.05], sfxPierceRate: [0.5, 2.5, 0.01],
  sfxStitchGain: [0, 2, 0.05], sfxStitchRate: [0.5, 2.5, 0.01],
  sfxTugGain: [0, 2, 0.05], sfxTugRate: [0.5, 2.5, 0.01],
  sfxSnapGain: [0, 2, 0.05], sfxSnapRate: [0.5, 2.5, 0.01],
  sfxImpactGain: [0, 2, 0.05], sfxImpactRate: [0.5, 2.5, 0.01],
  sfxThumpGain: [0, 2, 0.05], sfxThumpRate: [0.5, 2.5, 0.01],
  sfxShatterGain: [0, 2, 0.05], sfxShatterRate: [0.5, 2.5, 0.01],
  sfxTwangGain: [0, 2, 0.05], sfxTwangRate: [0.3, 2.5, 0.01],
  sfxDragGain: [0, 2, 0.05], sfxDragRate: [0.5, 2.5, 0.01],
  sfxKnotGain: [0, 2, 0.05], sfxKnotRate: [0.5, 2.5, 0.01],
  sfxStrainGain: [0, 2, 0.05], sfxStrainRate: [0.5, 2.5, 0.01],
  sfxStrikeGain: [0, 2, 0.05], sfxStrikeRate: [0.5, 2.5, 0.01],
  sfxRumbleGain: [0, 2, 0.05], sfxRumbleRate: [0.5, 2.5, 0.01],
  sfxBoomGain: [0, 2, 0.05], sfxBoomRate: [0.5, 2.5, 0.01],
  sfxRainGain: [0, 2, 0.05], sfxRainRate: [0.5, 2.5, 0.01],
  sfxDuck: [0, 1, 0.05],
  previewDamage: [1, 60, 1],
  previewParts: [1, 8, 1],
};

/** [min, max, step] per numeric key. Values outside are clamped on write AND on load. */
export const HERO_STITCH_RANGES: Record<HeroStitchNumKey, [number, number, number]> = {
  ...GLOBAL_RANGES,
  ...(Object.fromEntries(TIERS.flatMap((t) => STITCH_TIER_SUFFIXES.map((s) => [`t${t}${s}`, STITCH_TIER_RANGES[s]]))) as Record<TierKey, [number, number, number]>),
};

/** The hard ceilings a plan never exceeds, whatever the sliders say. */
export const STITCH_CAPS = { needles: 8, passes: 24, legs: 4, shards: 60, shakePx: 40, zoom: 0.14 } as const;

const store = configStore<HeroStitchConfig>({
  // v4: III rebuilt as "Pinned" and IV as "Bound Together" (owner picks 2026-10-02); older saved dials are dropped.
  key: 'ascent.herostitch.v5', defaults: HERO_STITCH_DEFAULTS, ranges: HERO_STITCH_RANGES,
  colorKeys: HERO_STITCH_COLOR_KEYS, clipKeys: HERO_STITCH_CLIP_KEYS, previewKeys: ['previewDamage', 'previewParts'],
});
/** The store itself (the tuner reads and writes through it). */
export const heroStitchStore = store;
export const getHeroStitchConfig = store.get;
export const clampHeroStitchValue = store.clamp;
export const sanitizeHeroStitchConfig = store.sanitize;
export const heroStitchConfigJson = store.json;
/** The tuners' preview speed hook (Recruit + the Collection read one per style). Always 1. */
export function heroStitchPreviewSpeed(): number { return 1; }

/** One tier's dials, read out of the config. */
export function stitchTierDials(tier: TierNum, c: HeroStitchConfig = store.get()): Record<StitchTierSuffix, number> {
  return Object.fromEntries(STITCH_TIER_SUFFIXES.map((s) => [s, c[`t${tier}${s}`]])) as Record<StitchTierSuffix, number>;
}

// ─── the pure plan ─────────────────────────────────────────────────────────────────────────────────────────────

/** The reference distance flight times are tuned at (a 1080p board, corner to corner). */
export const STITCH_REF_DISTANCE = 1600;

/** A needle's flight for a distance: the tier's time, scaled gently by the distance (a sandbox box stays readable). */
export function stitchFlightMs(distance: number, tierMs: number): number {
  const d = Number.isFinite(distance) && distance > 0 ? distance : STITCH_REF_DISTANCE;
  return Math.round(tierMs * clamp(Math.sqrt(d / STITCH_REF_DISTANCE), 0.62, 1.15));
}

export interface StitchPlanInput extends AttackTierContext {
  /** When the style's own attack starts: the end of the shared damage formation. */
  leadIn?: number;
  total: number;
  distance: number;
  reduced?: boolean;
}

export interface NeedleTiming {
  /** The needle leaves the hero. */
  launchAt: number;
  /** It pierces the target (a tick). */
  arriveAt: number;
  /** It has finished sewing (= `arriveAt` for a needle that only pierces). */
  sewEnd: number;
}

export interface StitchPlan {
  reduced: boolean;
  /** The shared tier (1..4), from `attackTier` (a knockout is 4). */
  tier: TierNum;
  kind: StitchKind;
  /** 0..1 across the tiers (the damage formation's pop reads it). */
  k: number;
  total: number;
  chargeAt: number;
  absorbEnd: number;
  /** The first needle leaves. */
  launchAt: number;
  flightMs: number;
  needles: NeedleTiming[];
  /** Every tick ON THE TARGET before the impact (the piercings), in time order. */
  hits: number[];
  /**
   * The action starts: I-II the tug (the hero leans back, the thread goes taut); III the pull on the pins (the portrait
   * stretches); IV the yank (the drag across the board begins).
   */
  tugAt: number;
  /** IV: the target has been dragged into the knot, which starts tying (null on other tiers). */
  knotAt: number | null;
  /** IV: the knot is tied; the hero strikes down the laces (null on other tiers). */
  strikeAt: number | null;
  /**
   * THE blow, where the consequence lands: the snap / the yank / the pins ripping out / the knot bursting (Tier V: the
   * SLAM in the middle of the board, after the burst).
   */
  impactAt: number;
  /** The heart-knot bursts (IV). On every tier but V it IS `impactAt` (V: the burst is a tick, the slam is the impact). */
  burstAt: number;
  /** IV: the target is back on its spot (the fling home ends; null on other tiers). */
  homeAt: number | null;
  /**
   * THE KNOCKOUT VARIANT ("Tier V", owner ask 2026-10-02): the Huge bind, remixed. The heart-knot DOUBLE-CINCHES: where
   * it would have tied it squeezes once more, hard, in a prismatic flash (`koCinchAt`), and only then ties (the tie,
   * the strike and the burst move back by `STITCH_KO.cinchMs`); the burst gets the Ancient prism, a bigger shake, a
   * deeper, longer slow-mo dip and a KO sting. False / null otherwise.
   */
  ko: boolean;
  koCinchAt: number | null;
  /**
   * TIER V's FINAL BEAT (owner 2026-10-02: "do a second, faster pull. after the heart knocks them back, latch on and
   * then yank and have the attacking hero slam into them in the middle of the board"): after the burst flings the
   * target home, fast needles LATCH onto it (`koLatchAt` they fly, `koLatchedAt` they bite), a SECOND, FASTER YANK pulls
   * it toward the middle while the striker launches at it, and they SLAM together there (`impactAt`: the consequence
   * lands on the slam). Both portraits are back on their spots, exactly, from `koHomeAt`. Null on every other tier.
   */
  koLatchAt: number | null;
  koLatchedAt: number | null;
  koHomeAt: number | null;
  endAt: number;
  passes: number;
  shards: number;
  burst: number;
  shakePx: number;
  zoom: number;
  punch: number;
  dim: number;
  arc: number;
}

/** The whole Soul Stitch, in base ms. Pure and deterministic. */
export function stitchPlan(input: StitchPlanInput, c: HeroStitchConfig = store.get()): StitchPlan {
  const total = Math.max(0, Math.round(input.total));
  const tier = attackTier(total, input, c); // a knockout always plays the shared Tier IV (heroAttack/tiers.ts)
  const kind = stitchKind(tier);
  const L = stitchTierDials(tier, c);
  const k = (tier - 1) / 3;
  if (input.reduced) {
    const r = reducedAttackTimeline(input.leadIn ?? 0, c.reducedFadeMs);
    const at = r.impactAt;
    return {
      reduced: true, tier, kind, k, total, chargeAt: at, absorbEnd: at, launchAt: at, flightMs: 0, needles: [], hits: [],
      tugAt: at, knotAt: null, strikeAt: null, impactAt: at, burstAt: at, homeAt: null, ko: false, koCinchAt: null,
      koLatchAt: null, koLatchedAt: null, koHomeAt: null, endAt: r.endAt, passes: 0, shards: 0, burst: 0, shakePx: 0, zoom: 0,
      punch: 0, dim: 0, arc: 0,
    };
  }
  const chargeAt = Math.max(0, input.leadIn ?? 0);
  const absorbEnd = chargeAt + c.absorbMs;
  const launchAt = chargeAt + Math.max(L.ReadyMs, c.absorbMs);
  const flightMs = stitchFlightMs(input.distance, L.FlightMs);
  // How many needles each tier sews with: I one, II three (two diagonals and the pin), III the pins, IV the laces'.
  const n = kind === 'needle' ? 1 : kind === 'cross' ? 3 : Math.round(clamp(L.Needles, kind === 'pinned' ? 3 : 2, STITCH_CAPS.needles));
  const passes = kind === 'bound' ? Math.round(clamp(L.Passes, 1, STITCH_CAPS.legs)) : 0;
  const sew = Math.max(0, L.SewMs);
  const needles: NeedleTiming[] = [];
  for (let i = 0; i < n; i++) {
    const at = launchAt + i * L.StaggerMs;
    const arriveAt = at + flightMs;
    // II: the third needle only PINS the crossing; III's pins do not sew; IV laces for `SewMs`.
    const sewMs = kind === 'needle' || kind === 'pinned' ? 0 : kind === 'cross' ? (i < 2 ? sew : 0) : sew;
    needles.push({ launchAt: at, arriveAt, sewEnd: arriveAt + sewMs });
  }
  const sewnAt = Math.max(...needles.map((q) => q.sewEnd));
  const tugAt = sewnAt + L.HangMs;
  let knotAt: number | null = null, strikeAt: number | null = null, homeAt: number | null = null, koCinchAt: number | null = null;
  let koLatchAt: number | null = null, koLatchedAt: number | null = null, koHomeAt: number | null = null;
  let impactAt: number, burstAt: number;
  const ko = kind === 'bound' && isKnockoutVariant(input);
  if (kind === 'bound') {
    knotAt = tugAt + L.TugMs;
    strikeAt = knotAt + c.knotMs;
    // Tier V: the second cinch lands where the knot would have tied; the tie waits a beat for it.
    if (ko) { koCinchAt = strikeAt; strikeAt += STITCH_KO.cinchMs; }
    burstAt = strikeAt + c.strikeMs;
    homeAt = burstAt + c.flingMs;
    impactAt = burstAt;
    if (ko) {
      // Tier V: as the burst flings the target home, fast needles latch on; the second yank and the slam follow.
      koLatchAt = burstAt + STITCH_KO.latchDelayMs;
      koLatchedAt = koLatchAt + STITCH_KO.latchFlightMs;
      impactAt = koLatchedAt + STITCH_KO.yankMs;
      koHomeAt = impactAt + STITCH_KO.returnMs;
    }
  } else { impactAt = tugAt + L.TugMs; burstAt = impactAt; }
  const hits = needles.map((q) => q.arriveAt).filter((t) => t < burstAt).sort((a, b) => a - b);
  // The snap recoil and the ribbons drain after the end: the fight never waits on a falling shard. IV's fling home is
  // inside the end (the portrait is back on its spot before the attack finishes).
  const endAt = Math.max(impactAt + Math.max(c.zoomOutMs * 0.8, 300), homeAt ?? 0, koHomeAt ?? 0) + L.SettleMs;
  return {
    reduced: false, tier, kind, k, total, chargeAt, absorbEnd, launchAt, flightMs, needles, hits, tugAt, knotAt, strikeAt,
    impactAt, burstAt, homeAt, ko, koCinchAt, koLatchAt, koLatchedAt, koHomeAt, endAt, passes, shards: Math.round(clamp(L.Shards, 0, STITCH_CAPS.shards)), burst: L.Burst,
    shakePx: clamp(L.Shake * (ko ? KO_SHAKE : 1), 0, STITCH_CAPS.shakePx * (ko ? KO_SHAKE : 1)), zoom: clamp(L.Zoom, 0, STITCH_CAPS.zoom), punch: L.Punch, dim: L.Dim, arc: L.Arc,
  };
}

/** IV: how many gold pulses the knot cinches in. */
export const KNOT_PULSES = 3;

/** The Knockout variant's own numbers (fixed, not tuned: a small remix of the tuned Huge). */
export const STITCH_KO = {
  /** The second cinch's beat before the knot ties. */
  cinchMs: 280,
  /** How much harder the second cinch squeezes (the knot's tightness bumps past 1 for `squeezeMs`). */
  squeeze: 0.22,
  squeezeMs: 240,
  /** The burst's slow-mo dip: this much slower at its slowest, and this much longer, than the Huge one's. */
  dipLo: 0.25,
  dipExtraMs: 100,
  /** The final beat: the latch needles fly this long after the burst, and take this long to bite. */
  latchDelayMs: 170,
  latchFlightMs: 150,
  /** The second, FASTER yank (and the striker's launch) into the slam: the first yank takes the tier's TugMs. */
  yankMs: 190,
  /** After the slam: the two stay in contact this long, then spring back to their spots by `returnMs`. */
  contactMs: 50,
  returnMs: 300,
  /** How deep the two portraits overlap at the slam (x each one's radius short of the meeting point). */
  slamOverlap: 0.82,
} as const;

/**
 * TIER V: the final beat's pose at `t` (pure). `foe` and `hero` are each portrait's way from its spot (0) to the
 * meeting point in the middle (1): the striker winds back a touch while the needles latch, then both are HAULED in,
 * accelerating, and slam; they hold contact a beat and spring back out, EXACTLY 0 from `koHomeAt`. `squash` is the
 * target's squash on the slam (0 outside it). Every other tier: zeros.
 */
export function koSlamAt(p: StitchPlan, t: number): { foe: number; hero: number; squash: number } {
  if (!p.ko || p.koLatchAt === null || p.koLatchedAt === null || p.koHomeAt === null || t < p.koLatchAt || t >= p.koHomeAt) return { foe: 0, hero: 0, squash: 0 };
  if (t < p.koLatchedAt) {
    const u = (t - p.koLatchAt) / Math.max(1, p.koLatchedAt - p.koLatchAt);
    return { foe: 0, hero: -0.1 * Math.sin(u * Math.PI * 0.5), squash: 0 };
  }
  if (t < p.impactAt) {
    const u = (t - p.koLatchedAt) / Math.max(1, p.impactAt - p.koLatchedAt);
    // A yank, not a slide: it accelerates all the way in (the striker from its wind-up).
    const k = Math.pow(u, 2.2);
    return { foe: k, hero: -0.1 + 1.1 * k, squash: 0 };
  }
  const since = t - p.impactAt;
  const squash = 0.16 * Math.max(0, 1 - since / 160);
  if (since < STITCH_KO.contactMs) return { foe: 1, hero: 1, squash };
  const v = Math.min(1, (since - STITCH_KO.contactMs) / Math.max(1, p.koHomeAt - p.impactAt - STITCH_KO.contactMs));
  const k = 1 - (1 - Math.pow(1 - v, 3));
  return { foe: k, hero: k, squash };
}

export type StitchCueKind = 'charge' | 'launch' | 'pierce' | 'sewn' | 'tug' | 'knot' | 'cinch' | 'tied' | 'strike' | 'burst' | 'latch' | 'yank' | 'impact' | 'home' | 'end';
export interface StitchCue { at: number; kind: StitchCueKind; i: number }

/** Every beat the runner fires, in time order (a tick precedes the impact on a tie). */
export function stitchCues(p: StitchPlan): StitchCue[] {
  const out: StitchCue[] = [];
  if (!p.reduced) {
    out.push({ at: p.chargeAt, kind: 'charge', i: 0 });
    p.needles.forEach((q, i) => {
      out.push({ at: q.launchAt, kind: 'launch', i });
      out.push({ at: q.arriveAt, kind: 'pierce', i });
      if (q.sewEnd > q.arriveAt) out.push({ at: q.sewEnd, kind: 'sewn', i });
    });
    out.push({ at: p.tugAt, kind: 'tug', i: 0 });
    if (p.knotAt !== null) out.push({ at: p.knotAt, kind: 'knot', i: 0 });
    // IV: the knot cinches in three pulses (gold sparks), between landing in it and the tie.
    if (p.knotAt !== null && p.strikeAt !== null) {
      const tieAt = p.koCinchAt ?? p.strikeAt;
      for (let i = 1; i <= KNOT_PULSES; i++) out.push({ at: p.knotAt + ((tieAt - p.knotAt) * i) / (KNOT_PULSES + 1), kind: 'cinch', i });
      // Tier V: the double-cinch (the hard prismatic squeeze), the cinch after the last.
      if (p.koCinchAt !== null) out.push({ at: p.koCinchAt, kind: 'cinch', i: KNOT_PULSES + 1 });
    }
    if (p.strikeAt !== null) {
      out.push({ at: p.strikeAt - 1, kind: 'tied', i: 0 });
      out.push({ at: p.strikeAt, kind: 'strike', i: 0 });
    }
    if (p.homeAt !== null) out.push({ at: p.homeAt, kind: 'home', i: 0 });
    // Tier V: the heart-knot bursts (a tick now: FX only), the needles latch on, the second yank, the slam (the impact).
    if (p.burstAt !== p.impactAt) out.push({ at: p.burstAt, kind: 'burst', i: 0 });
    if (p.koLatchAt !== null) out.push({ at: p.koLatchAt, kind: 'latch', i: 0 });
    if (p.koLatchedAt !== null) out.push({ at: p.koLatchedAt, kind: 'yank', i: 0 });
    if (p.koHomeAt !== null) out.push({ at: p.koHomeAt, kind: 'home', i: 1 });
  }
  out.push({ at: p.impactAt, kind: 'impact', i: 0 });
  out.push({ at: p.endAt, kind: 'end', i: 0 });
  const order: Record<StitchCueKind, number> = {
    charge: 0, launch: 1, pierce: 2, sewn: 3, tug: 4, knot: 5, cinch: 6, tied: 7, strike: 8, burst: 8.5, latch: 8.6, yank: 8.7, impact: 9, home: 10, end: 11,
  };
  return out.sort((a, b) => a.at - b.at || order[a.kind] - order[b.kind]);
}

// ─── the geometry (pure) ───────────────────────────────────────────────────────────────────────────────────────

/** One needle's whole job: summoned at `spot` on the hero's rim, flown on a quadratic to `entry`, then sewn along `sew`. */
export interface NeedleGeo {
  spot: Pt;
  ctrl: Pt;
  entry: Pt;
  /** The path it sews after it pierces (starts at `entry`; a single point for a needle that only pierces). */
  sew: Pt[];
  /** Cumulative length along `sew` (same length as `sew`; `sewLen[0]` = 0). */
  sewLen: number[];
  /**
   * What each `sew` point is sewn INTO, 0 (the striker) .. 1 (the target): the point rides that portrait. Same length
   * as `sew`.
   */
  sewAt: number[];
  /** The way the needle points once it stops (radians). */
  restRot: number;
}

export interface StitchGeo {
  /** Unit vector from the striker to the target, and its normal (toward the top of the screen). */
  u: Pt;
  nrm: Pt;
  needles: NeedleGeo[];
  /** IV: how far (screen px, along `-u`) the target is dragged toward the striker, into the knot. 0 on other tiers. */
  drag: number;
  /**
   * Tier V: the slam. `foe` and `hero` are each portrait's offset (screen px) from its spot to where it meets the other,
   * `meet` the meeting point in the middle of the board. Null on every other tier.
   */
  slam: { foe: Pt; hero: Pt; meet: Pt } | null;
}

function quad(a: Pt, c: Pt, b: Pt, e: number): Pt {
  const m = 1 - e;
  return { x: m * m * a.x + 2 * m * e * c.x + e * e * b.x, y: m * m * a.y + 2 * m * e * c.y + e * e * b.y };
}

function quadDir(a: Pt, c: Pt, b: Pt, e: number): Pt {
  const dx = 2 * (1 - e) * (c.x - a.x) + 2 * e * (b.x - c.x);
  const dy = 2 * (1 - e) * (c.y - a.y) + 2 * e * (b.y - c.y);
  const l = Math.hypot(dx, dy) || 1;
  return { x: dx / l, y: dy / l };
}

function lengths(pts: readonly Pt[]): number[] {
  const out = [0];
  for (let i = 1; i < pts.length; i++) out.push(out[i - 1]! + Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.y - pts[i - 1]!.y));
  return out;
}

/**
 * Every needle's path from the plan and the two heroes. The summon spots fan round the striker's rim on the side that
 * faces the target; the flights bow toward the TOP of the screen (never above `ceilY`); what each tier sews:
 *  I    the needle pierces the face just off centre, toward the striker (the thread runs straight back to it);
 *  II   two diagonals across the face (each entering on the corner nearer the striker), and a pin at the crossing;
 *  III  a pin at each point of a five-point star round the target's rim (`pinRim` radii out), stabbed in star order
 *       (each point two along from the last, as a star is drawn);
 *  IV   each needle pierces the target's rim (a fan facing the striker), laces back to the striker's rim and out to the
 *       target again, crossing its neighbours, so the laces bind the two portraits together.
 * Pure, so a replay sews the same.
 */
export function stitchGeo(p: StitchPlan, a: Pt, d: Pt, aR: number, dR: number, c: HeroStitchConfig = store.get(), ceilY = Number.NEGATIVE_INFINITY): StitchGeo {
  const L = Math.hypot(d.x - a.x, d.y - a.y) || 1;
  const u = { x: (d.x - a.x) / L, y: (d.y - a.y) / L };
  const nrm0 = { x: -u.y, y: u.x };
  const nrm = nrm0.y > 0 ? { x: -nrm0.x, y: -nrm0.y } : nrm0;
  if (p.reduced) return { u, nrm, needles: [], drag: 0, slam: null };
  const n = p.needles.length;
  const face = Math.atan2(u.y, u.x);
  const spread = n <= 1 ? 0 : Math.min(1.6, 0.42 * (n - 1));
  const spots = Array.from({ length: n }, (_, i) => {
    const ang = face + (n <= 1 ? 0 : -spread / 2 + (spread * i) / (n - 1));
    return { x: a.x + Math.cos(ang) * aR * 1.08, y: a.y + Math.sin(ang) * aR * 1.08 };
  });
  const near = (p1: Pt, p2: Pt): [Pt, Pt] => (Math.hypot(p1.x - a.x, p1.y - a.y) <= Math.hypot(p2.x - a.x, p2.y - a.y) ? [p1, p2] : [p2, p1]);
  const at = (rx: number, ry: number): Pt => ({ x: d.x + rx * dR, y: d.y + ry * dR });
  const sews: Pt[][] = [];
  const sewAts: number[][] = [];
  let drag = 0;
  if (p.kind === 'needle') {
    sews.push([{ x: d.x - u.x * dR * 0.12 + nrm.x * dR * 0.1, y: d.y - u.y * dR * 0.12 + nrm.y * dR * 0.1 }]);
  } else if (p.kind === 'cross') {
    const k = 0.6;
    sews.push(near(at(-k, -k), at(k, k)));
    sews.push(near(at(k, -k), at(-k, k)));
    sews.push([{ x: d.x, y: d.y }]);
  } else if (p.kind === 'pinned') {
    // The star's points, starting at the top, in the order a star is drawn (each one two points on from the last).
    for (let i = 0; i < n; i++) {
      const k = n % 2 ? (i * 2) % n : i;
      const ang = -Math.PI / 2 + (k * Math.PI * 2) / n;
      sews.push([{ x: d.x + Math.cos(ang) * dR * c.pinRim, y: d.y + Math.sin(ang) * dR * c.pinRim }]);
    }
  } else {
    const back = Math.atan2(-u.y, -u.x);
    const fan = (i: number): number => (n <= 1 ? 0 : -0.9 + (1.8 * i) / (n - 1));
    const tRim = (i: number): Pt => ({ x: d.x + Math.cos(back + fan(i)) * dR * 0.92, y: d.y + Math.sin(back + fan(i)) * dR * 0.92 });
    const hRim = (i: number): Pt => ({ x: a.x + Math.cos(face - fan(i)) * aR * 0.95, y: a.y + Math.sin(face - fan(i)) * aR * 0.95 });
    for (let i = 0; i < n; i++) {
      // A lace: in at the target, back across to the striker's rim (crossing over), out to the target again.
      const pts: Pt[] = [tRim(i)], ws: number[] = [1];
      for (let leg = 1; leg <= p.passes; leg++) {
        if (leg % 2 === 1) { pts.push(hRim(n - 1 - ((i + leg - 1) % n))); ws.push(0); } else { pts.push(tRim((i + leg) % n)); ws.push(1); }
      }
      sews.push(pts); sewAts.push(ws);
    }
    drag = Math.max(0, (L - aR - dR) * c.dragReach);
  }
  // Tier V: where the two portraits meet for the slam: the middle of the gap between their rims, each a little short.
  let slam: StitchGeo['slam'] = null;
  if (p.ko) {
    const gap = Math.max(0, L - aR - dR);
    const meet = { x: a.x + u.x * (aR + gap / 2), y: a.y + u.y * (aR + gap / 2) };
    const k = STITCH_KO.slamOverlap;
    slam = { foe: { x: meet.x + u.x * dR * k - d.x, y: meet.y + u.y * dR * k - d.y }, hero: { x: meet.x - u.x * aR * k - a.x, y: meet.y - u.y * aR * k - a.y }, meet };
  }
  const needles: NeedleGeo[] = spots.map((spot, i) => {
    const sew = sews[i] ?? [{ x: d.x, y: d.y }];
    const entry = sew[0]!;
    const D = Math.hypot(entry.x - spot.x, entry.y - spot.y) || 1;
    const mid = { x: (spot.x + entry.x) / 2, y: (spot.y + entry.y) / 2 };
    // The fan bows each flight a little differently (the outer needles wider), always toward the top of the screen.
    const bow = p.arc * (1 + (n <= 1 ? 0 : 0.5 * Math.abs(i - (n - 1) / 2) / Math.max(1, (n - 1) / 2)));
    const ctrl = { x: mid.x + nrm.x * bow * D, y: Math.max(ceilY, mid.y + nrm.y * bow * D) };
    const last = sew.length > 1 ? sew[sew.length - 1]! : entry;
    const prev = sew.length > 1 ? sew[sew.length - 2]! : null;
    const dir = prev ? { x: last.x - prev.x, y: last.y - prev.y } : quadDir(spot, ctrl, entry, 1);
    const sewAt = sewAts[i] ?? sew.map(() => 1);
    return { spot, ctrl, entry, sew, sewLen: lengths(sew), sewAt, restRot: Math.atan2(dir.y, dir.x) };
  });
  return { u, nrm, needles, drag, slam };
}

/** A needle's flight progress: thrown out fast, still quick into the face (it pierces, never drifts in). */
export const flightEase = (u: number): number => { const t = Math.min(1, Math.max(0, Number.isFinite(u) ? u : 0)); return 0.7 * t + 0.3 * t * t; };

/** Where along its sewing path a needle is (0..1 of its length) at sequence time `t`. */
export function sewProgress(q: NeedleTiming, t: number): number {
  if (q.sewEnd <= q.arriveAt) return t >= q.arriveAt ? 1 : 0;
  return Math.min(1, Math.max(0, (t - q.arriveAt) / (q.sewEnd - q.arriveAt)));
}

/** A point `s` px along a polyline (with its cumulative lengths), the heading there, and the segment it is on. */
export function alongPath(pts: readonly Pt[], cum: readonly number[], s: number): { x: number; y: number; rot: number; seg: number; f: number } {
  if (pts.length === 1) return { x: pts[0]!.x, y: pts[0]!.y, rot: 0, seg: 0, f: 0 };
  const total = cum[cum.length - 1]!;
  const ss = Math.min(total, Math.max(0, s));
  let i = 1;
  while (i < pts.length - 1 && cum[i]! < ss) i++;
  const a = pts[i - 1]!, b = pts[i]!;
  const seg = Math.max(1e-6, cum[i]! - cum[i - 1]!);
  const f = (ss - cum[i - 1]!) / seg;
  return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, rot: Math.atan2(b.y - a.y, b.x - a.x), seg: i - 1, f };
}

export interface NeedleState {
  visible: boolean; x: number; y: number; rot: number; flying: boolean; sewing: boolean;
  /** What the needle rides, 0 (the striker) .. 1 (the target), so it moves with the portraits. */
  on: number;
}

const HIDDEN_NEEDLE: NeedleState = { visible: false, x: 0, y: 0, rot: 0, flying: false, sewing: false, on: 0 };

/**
 * Needle `i` at sequence time `t` (pure): hidden before the charge; summoned on its spot through the ready (pointing
 * at the target); flown along its quadratic; then riding its sewing path; then held where it stopped. Hidden from the
 * impact on (it shatters there); IV's needles are gone once the laces are sewn (tied off).
 */
export function needleAt(p: StitchPlan, g: StitchGeo, i: number, t: number): NeedleState {
  const q = p.needles[i], n = g.needles[i];
  if (!q || !n || p.reduced || t < p.chargeAt || t >= p.burstAt) return HIDDEN_NEEDLE;
  if (p.kind === 'bound' && t >= q.sewEnd + 120) return HIDDEN_NEEDLE;
  if (t < q.launchAt) {
    const dir = quadDir(n.spot, n.ctrl, n.entry, 0);
    return { visible: true, x: n.spot.x, y: n.spot.y, rot: Math.atan2(dir.y, dir.x), flying: false, sewing: false, on: 0 };
  }
  if (t < q.arriveAt) {
    const e = flightEase((t - q.launchAt) / Math.max(1, q.arriveAt - q.launchAt));
    const at = quad(n.spot, n.ctrl, n.entry, e);
    const dir = quadDir(n.spot, n.ctrl, n.entry, e);
    return { visible: true, x: at.x, y: at.y, rot: Math.atan2(dir.y, dir.x), flying: true, sewing: false, on: e * n.sewAt[0]! };
  }
  if (n.sew.length > 1) {
    const total = n.sewLen[n.sewLen.length - 1]!;
    const at = alongPath(n.sew, n.sewLen, sewProgress(q, t) * total);
    const on = n.sewAt[at.seg]! + (n.sewAt[Math.min(n.sewAt.length - 1, at.seg + 1)]! - n.sewAt[at.seg]!) * at.f;
    return { visible: true, x: at.x, y: at.y, rot: t < q.sewEnd ? at.rot : n.restRot, flying: false, sewing: t < q.sewEnd, on };
  }
  return { visible: true, x: n.entry.x, y: n.entry.y, rot: n.restRot, flying: false, sewing: false, on: n.sewAt[0]! };
}

/** The flight curve's point at `e` (0..1) for needle `i` (the thread trails exactly this path). */
export function flightPoint(g: StitchGeo, i: number, e: number): Pt {
  const n = g.needles[i]!;
  return quad(n.spot, n.ctrl, n.entry, e);
}

/** How far the needle has flown (0..1 of the flight, eased) at `t`. */
export function flightProgress(q: NeedleTiming, t: number): number {
  if (t <= q.launchAt) return 0;
  if (t >= q.arriveAt) return 1;
  return flightEase((t - q.launchAt) / Math.max(1, q.arriveAt - q.launchAt));
}

/**
 * The pull's envelope at `t` (pure): 0 before the action, rising (eased in and out) to 1 at its end, then released.
 * I-III: the tug / the stretch up to the impact. IV: the drag up to the knot.
 */
export function tugAt(p: StitchPlan, t: number): number {
  const end = p.knotAt ?? p.burstAt;
  if (p.reduced || t < p.tugAt || t >= end) return p.kind === 'bound' && !p.reduced && t >= end && t < p.burstAt ? 1 : 0;
  const u = (t - p.tugAt) / Math.max(1, end - p.tugAt);
  return u * u * (3 - 2 * u);
}

/**
 * III: how far the target is STRETCHED toward the striker (0 = not at all .. `stretch`), pure: pulled out against the
 * pins through the pull (eased in, so it strains harder and harder), then, the moment the pins rip out, it SNAPS back
 * through its rest (a squash: negative) and settles, exactly 0 again by the end. Every other tier: 0.
 */
export function stretchAt(p: StitchPlan, c: HeroStitchConfig, t: number): number {
  if (p.kind !== 'pinned' || p.reduced || t < p.tugAt || t >= p.endAt) return 0;
  if (t < p.impactAt) {
    const u = (t - p.tugAt) / Math.max(1, p.impactAt - p.tugAt);
    return c.stretch * (1 - Math.pow(1 - u, 2.2)) * (0.85 + 0.15 * u);
  }
  const k = Math.exp(-(t - p.impactAt) / 80) * Math.cos(2 * Math.PI * 5 * ((t - p.impactAt) / 1000));
  return Math.abs(k) < 0.002 ? 0 : c.stretch * k;
}

const easeOutBackK = (x: number, k = 1.4): number => { const y = Math.min(1, Math.max(0, x)) - 1; return 1 + (k + 1) * y * y * y + k * y * y; };

/**
 * IV: the target's DRAG at `t` (pure): 0 = on its spot, 1 = in the knot, `geo.drag` px toward the striker. It is
 * yanked (a short hesitation, then hauled, landing with a small overshoot) from the yank to the knot, held in the knot
 * through the tie and the strike, and flung home from the impact (overshooting its spot a touch), EXACTLY 0 from
 * `homeAt` on (and before the yank). Every other tier: 0.
 */
export function dragAt(p: StitchPlan, t: number): number {
  if (p.kind !== 'bound' || p.reduced || p.knotAt === null || p.homeAt === null || t < p.tugAt || t >= p.homeAt) return 0;
  if (t < p.knotAt) {
    const u = (t - p.tugAt) / Math.max(1, p.knotAt - p.tugAt);
    const haul = u < 0.18 ? -0.04 * Math.sin((u / 0.18) * Math.PI) : easeOutBackK((u - 0.18) / 0.82, 1.2);
    return haul;
  }
  if (t < p.burstAt) return 1;
  const u = (t - p.burstAt) / Math.max(1, p.homeAt - p.burstAt);
  return 1 - easeOutBackK(u, 1.6);
}

/** IV: how tightly the knot holds the target (0 open .. 1 tied), from the knot to the strike; released on the burst. */
export function knotAt(p: StitchPlan, t: number): number {
  if (p.kind !== 'bound' || p.knotAt === null || p.strikeAt === null || t < p.knotAt || t >= p.burstAt) return 0;
  const tieAt = p.koCinchAt ?? p.strikeAt;
  const u = Math.min(1, (t - p.knotAt) / Math.max(1, tieAt - p.knotAt));
  // Tier V: the second cinch squeezes past snug for a moment (the loops close tighter, the portrait crushed smaller).
  const second = p.koCinchAt !== null && t >= p.koCinchAt
    ? STITCH_KO.squeeze * Math.sin(Math.PI * Math.min(1, (t - p.koCinchAt) / STITCH_KO.squeezeMs)) : 0;
  return u * u * (3 - 2 * u) + second;
}

// ─── the camera (pure) ─────────────────────────────────────────────────────────────────────────────────────────

const springAt = (ms: number, hz: number, tau: number): number => (ms < 0 ? 0 : Math.exp(-ms / tau) * Math.cos(2 * Math.PI * hz * (ms / 1000)));
const sine = (u: number): number => 0.5 - 0.5 * Math.cos(Math.PI * Math.min(1, Math.max(0, u)));

/**
 * The camera at sequence time `t`: a push in through the ready, a small kick along each needle as it pierces, a steady
 * creep in through the action with a JERK as it starts (the tug back toward the striker; III's punch forward), and a
 * punch with a directional shake on the impact, settling back. IV pushes in harder on the knot and trembles as it
 * ties. Deterministic. Pure.
 */
export function stitchCameraAt(p: StitchPlan, c: HeroStitchConfig, t: number, dir: Pt = { x: 1, y: 0 }): { zoom: number; x: number; y: number } {
  if (p.reduced) return { zoom: 1, x: 0, y: 0 };
  let z = 0;
  if (t >= p.chargeAt && t < p.burstAt) {
    z += p.zoom * sine((t - p.chargeAt) / Math.max(1, p.launchAt - p.chargeAt));
    if (t >= p.tugAt) z += p.zoom * 0.6 * sine((t - p.tugAt) / Math.max(1, p.burstAt - p.tugAt));
  } else if (t >= p.burstAt) z += (p.zoom * 1.6 + p.punch) * Math.exp(-(t - p.burstAt) / Math.max(1, c.zoomOutMs / 4));
  // Tier V: the second yank creeps in, and the slam punches in hard.
  if (p.ko && p.koLatchedAt !== null) {
    if (t >= p.koLatchedAt && t < p.impactAt) z += p.zoom * 0.5 * sine((t - p.koLatchedAt) / Math.max(1, p.impactAt - p.koLatchedAt));
    else if (t >= p.impactAt) z += (p.zoom * 1.2 + p.punch * 1.3) * Math.exp(-(t - p.impactAt) / Math.max(1, c.zoomOutMs / 4));
  }
  let x = 0, y = 0;
  const kick = (at: number, amp: number, tau: number, hz: number): void => {
    const s = springAt(t - at, hz, tau);
    x += dir.x * amp * s; y += dir.y * amp * s;
  };
  for (const at of p.hits) kick(at, p.shakePx * 0.22, 40, 16);
  kick(p.tugAt, -0.35 * p.shakePx, 70, 9);
  if (p.kind === 'bound' && p.knotAt !== null && p.strikeAt !== null) {
    kick(p.knotAt, -p.shakePx * 0.3, 60, 12);
    if (t >= p.knotAt && t < p.burstAt) {
      const u = Math.min(1, (t - p.knotAt) / Math.max(1, p.strikeAt - p.knotAt));
      const a = p.shakePx * 0.1 * u;
      x += a * Math.sin(t * 0.21); y += a * Math.sin(t * 0.29 + 1.3);
    }
  }
  kick(p.burstAt, p.shakePx * (p.ko ? 1 / KO_SHAKE : 1), Math.max(1, c.shakeMs / 4), 15);
  // Tier V: the latch tugs the view back toward the striker; the slam kicks it hardest of all (the KO shake).
  if (p.ko && p.koLatchedAt !== null) {
    kick(p.koLatchedAt, -0.3 * p.shakePx, 60, 11);
    kick(p.impactAt, p.shakePx * 1.15, Math.max(1, c.shakeMs / 4), 14);
  }
  return { zoom: 1 + Math.max(0, z), x, y };
}

/**
 * Where the camera anchors: the striker through the ready, following the needles, then the target from the first
 * piercing. IV follows the target as it is dragged into the knot and flung home.
 * `foeDrag` is the target's drag offset (screen px) at `t` (IV).
 */
export function stitchCameraFocus(p: StitchPlan, t: number, a: Pt, d: Pt, foeDrag: Pt = { x: 0, y: 0 }): Pt {
  const first = p.needles[0]?.arriveAt ?? p.impactAt;
  if (t <= p.launchAt) return a;
  if (t >= first) return { x: d.x + foeDrag.x, y: d.y + foeDrag.y };
  const e = sine((t - p.launchAt) / Math.max(1, first - p.launchAt));
  return { x: a.x + (d.x - a.x) * e, y: a.y + (d.y - a.y) * e };
}

/**
 * IV's WEIGHT ON THE BURST (owner 2026-10-02: "add some pixi blasts ... a punchier hit-stop"). The house rule is no
 * freeze (owner 2026-09-28: "remove the freezeing frame from all of the animations. it looks like lag",
 * R-PROG-ATTACK-10), so the burst gets a SLOW-MO DIP instead: the one clock drops to `slowMo` the instant the knot
 * bursts and eases back to full speed over `slowMoMs` (attack time), a smooth ramp that never reaches 0 (the
 * Basketball's technique). Every other tier and moment: 1.
 */
export function stitchTimeScale(p: StitchPlan, c: HeroStitchConfig, t: number): number {
  // Tier V dips deeper and longer (still a smooth ramp that never reaches 0).
  const ms = c.slowMoMs + (p.ko && c.slowMoMs > 0 ? STITCH_KO.dipExtraMs : 0);
  if (p.kind !== 'bound' || p.reduced || ms <= 0 || t < p.impactAt || t >= p.impactAt + ms) return 1;
  const u = (t - p.impactAt) / ms;
  const lo = Math.min(1, Math.max(0.1, p.ko ? Math.min(c.slowMo, STITCH_KO.dipLo) : c.slowMo));
  return lo + (1 - lo) * u * u * (3 - 2 * u);
}

/** The extra REAL ms the slow-mo dip adds (for the safety timer). */
export function slowMoExtraMs(p: StitchPlan, c: HeroStitchConfig): number {
  if (p.kind !== 'bound' || p.reduced || c.slowMoMs <= 0) return 0;
  let extra = 0;
  const ms = c.slowMoMs + (p.ko ? STITCH_KO.dipExtraMs : 0);
  for (let t = p.impactAt; t < p.impactAt + ms; t += 5) extra += 5 / stitchTimeScale(p, c, t) - 5;
  return extra;
}
