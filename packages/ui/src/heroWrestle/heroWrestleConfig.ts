/**
 * THE WRESTLING HERO ATTACK ("Top Rope", a Legendary with four tiers): its tuned values, its pure timeline, the pure
 * geometry, the pure poses of BOTH portraits, the ring ropes, the turnbuckle, the chair, the dizzy stars, the
 * spotlight and the camera.
 *
 * THE SIGNATURE: the two portraits WRESTLE EACH OTHER, as a COMEDY act (owner 2026-11-13: "a silly one ... go further in
 * every tier to make it funnier and more aggressive"). The striking portrait walks over and throws the struck one about:
 * big wind-ups, absurd air time, hard squash and stretch on both portraits, the struck one seeing stars, a crowd that
 * loses its mind (camera flashes), and a camera that zooms in on the wind-up, whip-pans after a throw and punches in on
 * every hit. No other attack has grapples, a ring or a pin.
 *
 * FOUR TIERS on the shared thresholds (`attackTier`: a knockout always plays Tier 4), each with TWO variants rolled from
 * the stable per-blow seed (`variantOf(rollSeed)`; the DEV tuner's Variation row forces one):
 *  - Tier 1. Variant 1, THE CHOP: a huge lean-back wind-up (the camera pushes in), a knife-edge chop (THE impact), a red
 *    hand print, and the struck portrait SPINS like a top and wobbles, seeing stars. Variant 2, THE CHAIR SHOT: a folding
 *    chair of neon light comes up from under the ring, goes overhead, and comes down on the struck portrait's head (THE
 *    impact), which concertinas flat and springs back; the chair bursts apart into light.
 *  - Tier 2. Variant 1, THE AIRPLANE SPIN SLAM: lifted overhead, spun round and round (both portraits turn), then slammed
 *    (THE impact) and bounced twice. Variant 2, THE SUPLEX: lifted upside down and HELD there for a silly long beat, then
 *    both topple over backward and it lands on its head and back (THE impact).
 *  - Tier 3. A shove leaves the struck portrait flat; the striker CLIMBS a turnbuckle of light in three hops and TAUNTS up
 *    there (the spotlight on it, the crowd's camera flashes popping) before it leaps. Variant 1, THE ELBOW DROP: a flat
 *    dive, the elbow leading (THE impact). Variant 2, THE SPLASH: a belly flop, spread wide and flat (THE impact),
 *    flattening both.
 *  - Tier 4. A RING OF LIGHT stands up round the two of them, and the bell rings. Variant 1, THE CLOTHESLINE: an Irish
 *    whip into the far ropes (the camera whip-pans after it), which stretch, hold, and fling it back into a clothesline
 *    (THE impact): a flip high in the air and a heavy landing. Variant 2, THE JUMPING CUTTER: a shove sends the struck
 *    portrait reeling while the striker runs off the screen; it staggers about the ring, dazed and seeing stars, while a
 *    voice yells "Watch out! Watch out! Watch out!" and the camera creeps in on it; the striker LEAPS in from off screen,
 *    catches its head and drives it into the mat (THE impact). Either way: the cover, 1, 2, 3 slammed down LARGE with a
 *    slap of the mat and a shake each, the bell, WINNER, the crowd's flashes, and both go home.
 *
 * WEIGHT: every big move is HELD, then FAST, then HEAVY: a held beat, a short drop, a hit that shakes the frame hard,
 * flashes and throws dust that hangs, then a beat of aftermath before anything else happens.
 *
 * THE CONTRACT: the blow lands exactly ONCE, on the impact (the chop, the chair, the slam, the suplex, the elbow, the
 * splash, the clothesline, the cutter). The shove, the ropes, the landing, the count and the bell are TICKS (no damage).
 * Both portraits and the camera are restored exactly on every exit path (the runner owns that). No hit-stop and no slow
 * motion: the one clock never changes speed.
 *
 * WHERE IT HAPPENS: the striker always stands BESIDE the struck portrait (on the side it came from when there is room),
 * and every lift, slam and fall is in screen up and down, so a move reads whichever corner the two heroes are in. Every
 * spot is pulled in off the screen's edges. The one deliberate exception is the cutter: the striker runs off the screen
 * and leaps back in from beyond its edge.
 */
import { configStore } from '../heroAttack/configStore';
import { clamp, clamp01, easeInOutSine, easeOutBack, easeOutCubic, spring, type Pt } from '../heroAttack/easing';
import {
  HERO_ATTACK_TIER_THRESHOLDS, TIERS, reducedAttackTimeline, attackTier, type AttackTierContext, type TierNum,
} from '../heroAttack/tiers';

export { TIERS };
export type { TierNum };

export const WRESTLE_KINDS = ['chop', 'slam', 'elbow', 'pin'] as const;
export type WrestleKind = (typeof WRESTLE_KINDS)[number];

/** Each tier's move. */
export function wrestleKind(tier: TierNum): WrestleKind { return WRESTLE_KINDS[tier - 1]!; }

export const WRESTLE_LEVELS = ['t1', 't2', 't3', 't4'] as const;

/** Each tier rolls one of two variants (see the header). */
export type WrestleVariant = 1 | 2;
export const WRESTLE_VARIANTS: readonly WrestleVariant[] = [1, 2];
/** What each variant is, per tier (the tuner's Variation row and the hints). */
export const WRESTLE_VARIANT_NAMES: Record<WrestleVariant, [string, string, string, string]> = {
  1: ['the chop', 'the airplane spin slam', 'the elbow drop', 'the clothesline'],
  2: ['the chair shot', 'the suplex', 'the splash', 'the jumping cutter'],
};

export const WRESTLE_TIER_SUFFIXES = ['ReadyMs', 'WalkMs', 'HoldMs', 'ReturnMs', 'Knock', 'Zoom', 'Punch', 'Shake', 'Burst', 'Rings', 'Dim'] as const;
export type WrestleTierSuffix = (typeof WRESTLE_TIER_SUFFIXES)[number];
type TierKey = `t${TierNum}${WrestleTierSuffix}`;

interface GlobalConfig {
  tier2At: number; tier3At: number; tier4At: number;
  /** DEV: '' = rolled per blow, '1' / '2' force a variant (a string so the tuner shows it as a select). */
  variation: string;
  absorbMs: number;
  /** How close the two stand, as a fraction of their two radii added together. */
  gap: number;
  // I: the chop
  chopWindMs: number;
  chopMs: number;
  chopLean: number;
  stagger: number;
  /** Tier 1: how many times the chopped portrait spins round like a top. */
  chopSpins: number;
  /** Tier 1, the chair: it comes up from under the ring, then is raised overhead. */
  chairRiseMs: number;
  chairWindMs: number;
  chairSize: number;
  // II: the body slam
  dipMs: number;
  liftMs: number;
  hangMs: number;
  slamMs: number;
  liftHeight: number;
  bounceMs: number;
  bounce: number;
  /** Tier 2, the airplane spin: whole turns while it is held overhead. */
  spinTurns: number;
  // III: the elbow drop
  shoveMs: number;
  climbMs: number;
  perchMs: number;
  diveMs: number;
  spot: number;
  /** Tier 3: how high the leap off the turnbuckle goes above the perch (striker radii). */
  leapHeight: number;
  // IV: the finisher
  ringWidth: number;
  ropeSize: number;
  grabMs: number;
  whipMs: number;
  stretchMs: number;
  stretch: number;
  reboundMs: number;
  flipMs: number;
  flipTurns: number;
  /** IV: the beat over the body after it lands, before the striker leaps for the cover. */
  afterMs: number;
  /** Tier 4, the cutter: the run off the screen, the dazed stagger (the voice plays through it), the leap in, the drop. */
  exitMs: number;
  dazeMs: number;
  leapMs: number;
  cutMs: number;
  /** Tier 4, the cutter: the voice starts this long before the leap (its third "watch out" lands on it). */
  voiceLeadMs: number;
  coverMs: number;
  countMs: number;
  winMs: number;
  wordSize: number;
  squash: number;
  /** How bright the whole-frame flash on a big hit is (0 = none). */
  flash: number;
  /** How many camera flashes the crowd pops on the big moments (0 = none). */
  crowdFlashes: number;
  /** How far the camera pans to centre the action (0 = it only zooms where it stands, 1 = centred). */
  pan: number;
  shakeMs: number;
  zoomOutMs: number;
  reducedFadeMs: number;
  colorMat: string;
  colorFlash: string;
  colorPow: string;
  colorHand: string;
  colorSpot: string;
  colorPlayer: string;
  colorFoe: string;
  sfxWhooshClip: string; sfxWhooshGain: number; sfxWhooshRate: number;
  sfxChopClip: string; sfxChopGain: number; sfxChopRate: number;
  sfxSlamClip: string; sfxSlamGain: number; sfxSlamRate: number;
  sfxBoomClip: string; sfxBoomGain: number; sfxBoomRate: number;
  sfxBellClip: string; sfxBellGain: number; sfxBellRate: number;
  sfxWooClip: string; sfxWooGain: number; sfxWooRate: number;
  sfxCheerClip: string; sfxCheerGain: number; sfxCheerRate: number;
  sfxThudClip: string; sfxThudGain: number; sfxThudRate: number;
  sfxRopeClip: string; sfxRopeGain: number; sfxRopeRate: number;
  sfxSlapClip: string; sfxSlapGain: number; sfxSlapRate: number;
  sfxRoarClip: string; sfxRoarGain: number; sfxRoarRate: number;
  sfxOohClip: string; sfxOohGain: number; sfxOohRate: number;
  sfxVoiceClip: string; sfxVoiceGain: number; sfxVoiceRate: number;
  sfxChairClip: string; sfxChairGain: number; sfxChairRate: number;
  sfxBigClip: string; sfxBigGain: number; sfxBigRate: number;
  sfxFlashClip: string; sfxFlashGain: number; sfxFlashRate: number;
  sfxDuck: number;
  previewDamage: number;
  previewParts: number;
}
export type HeroWrestleConfig = GlobalConfig & Record<TierKey, number>;

export const HERO_WRESTLE_COLOR_KEYS = ['colorMat', 'colorFlash', 'colorPow', 'colorHand', 'colorSpot', 'colorPlayer', 'colorFoe'] as const;
export const HERO_WRESTLE_CLIP_KEYS = [
  'sfxWhooshClip', 'sfxChopClip', 'sfxSlamClip', 'sfxBoomClip', 'sfxBellClip', 'sfxWooClip', 'sfxCheerClip', 'sfxThudClip', 'sfxRopeClip', 'sfxSlapClip', 'sfxRoarClip', 'sfxOohClip',
  'sfxVoiceClip', 'sfxChairClip', 'sfxBigClip', 'sfxFlashClip',
] as const;
export type HeroWrestleStrKey = (typeof HERO_WRESTLE_COLOR_KEYS)[number] | (typeof HERO_WRESTLE_CLIP_KEYS)[number] | 'variation';
export type HeroWrestleNumKey = Exclude<keyof HeroWrestleConfig, HeroWrestleStrKey>;

/** Per tier: [Tier 1, Tier 2, Tier 3, Tier 4]. A dial a tier's move does not use is ignored there (the tuner says which). */
const TIER_DEFAULTS: Record<WrestleTierSuffix, [number, number, number, number]> = {
  ReadyMs: [80, 80, 80, 80],
  WalkMs: [300, 320, 320, 340],
  HoldMs: [950, 1000, 1100, 0],
  ReturnMs: [320, 380, 420, 440],
  Knock: [1, 1, 1, 1.2],
  Zoom: [0.13, 0.15, 0.18, 0.2],
  Punch: [0.035, 0.05, 0.07, 0.09],
  Shake: [10, 20, 28, 34],
  Burst: [1, 1.4, 1.8, 2],
  Rings: [2, 2, 3, 3],
  Dim: [0.12, 0.18, 0.26, 0.3],
};

export const WRESTLE_TIER_RANGES: Record<WrestleTierSuffix, [number, number, number]> = {
  ReadyMs: [0, 1000, 10],
  WalkMs: [80, 1500, 10],
  HoldMs: [0, 1500, 10],
  ReturnMs: [60, 1500, 10],
  Knock: [0, 4, 0.05],
  Zoom: [0, 0.2, 0.005],
  Punch: [0, 0.1, 0.001],
  Shake: [0, 40, 0.5],
  Burst: [0, 3, 0.05],
  Rings: [0, 8, 1],
  Dim: [0, 0.6, 0.01],
};

const tierDefaults = Object.fromEntries(TIERS.flatMap((t) => WRESTLE_TIER_SUFFIXES.map((s) => [`t${t}${s}`, TIER_DEFAULTS[s][t - 1]]))) as Record<TierKey, number>;

export const HERO_WRESTLE_DEFAULTS: HeroWrestleConfig = {
  ...HERO_ATTACK_TIER_THRESHOLDS,
  variation: '',
  absorbMs: 180,
  gap: 0.86,
  chopWindMs: 420,
  chopMs: 90,
  chopLean: 34,
  stagger: 0.55,
  chopSpins: 2,
  chairRiseMs: 260,
  chairWindMs: 380,
  chairSize: 1,
  dipMs: 200,
  liftMs: 340,
  hangMs: 900,
  slamMs: 130,
  liftHeight: 0.9,
  bounceMs: 340,
  bounce: 0.6,
  spinTurns: 3,
  shoveMs: 260,
  climbMs: 640,
  perchMs: 950,
  diveMs: 420,
  spot: 1,
  leapHeight: 0.9,
  ringWidth: 3.4,
  ropeSize: 1,
  grabMs: 260,
  whipMs: 340,
  stretchMs: 460,
  stretch: 0.9,
  reboundMs: 200,
  flipMs: 560,
  flipTurns: 1,
  afterMs: 300,
  exitMs: 420,
  dazeMs: 1600,
  leapMs: 360,
  cutMs: 150,
  voiceLeadMs: 1430,
  coverMs: 360,
  countMs: 400,
  winMs: 950,
  wordSize: 1,
  squash: 0.2,
  flash: 0.55,
  crowdFlashes: 1,
  pan: 0.55,
  shakeMs: 420,
  zoomOutMs: 420,
  reducedFadeMs: 260,
  colorMat: '#e9dfc8',
  colorFlash: '#fff4dc',
  colorPow: '#ffd23f',
  colorHand: '#ef3b2e',
  colorSpot: '#fff1c4',
  colorPlayer: '#ffcf5a',
  colorFoe: '#ff6a5a',
  sfxWhooshClip: 'fx/stereogenicstudio-swish-swoosh-woosh-sfx-27-357164-3', sfxWhooshGain: 0.55, sfxWhooshRate: 1,
  sfxChopClip: 'fx/wrestle-chop', sfxChopGain: 0.85, sfxChopRate: 1,
  sfxSlamClip: 'fx/wrestle-slam', sfxSlamGain: 0.9, sfxSlamRate: 1,
  // The boom and the crowd are their own cuts of the shared `heavy-rock-impact` (its first 1.02 s, every boom's window)
  // and `cheering` (0.42 s to 3.04 s, every crowd's window), so a phone decodes only what is heard (phone audio budget).
  sfxBoomClip: 'fx/wrestle-boom', sfxBoomGain: 0.35, sfxBoomRate: 1.1,
  sfxBellClip: 'fx/wrestle-bell', sfxBellGain: 1, sfxBellRate: 1,
  sfxWooClip: 'fx/wrestle-woo', sfxWooGain: 0.85, sfxWooRate: 1,
  sfxCheerClip: 'fx/wrestle-cheer', sfxCheerGain: 0.75, sfxCheerRate: 1,
  sfxThudClip: 'fx/wrestle-thud', sfxThudGain: 1.05, sfxThudRate: 1,
  sfxRopeClip: 'fx/wrestle-rope', sfxRopeGain: 1.25, sfxRopeRate: 1,
  sfxSlapClip: 'fx/wrestle-slap', sfxSlapGain: 0.9, sfxSlapRate: 1,
  sfxRoarClip: 'fx/wrestle-roar', sfxRoarGain: 1.7, sfxRoarRate: 1,
  sfxOohClip: 'fx/soccer-crowd-ooh', sfxOohGain: 0.95, sfxOohRate: 1,
  sfxVoiceClip: 'fx/wrestle-watchout', sfxVoiceGain: 1.9, sfxVoiceRate: 1,
  sfxChairClip: 'fx/wrestle-chair', sfxChairGain: 1.2, sfxChairRate: 1,
  sfxBigClip: 'fx/wrestle-bigslam', sfxBigGain: 1.2, sfxBigRate: 1,
  sfxFlashClip: 'fx/wrestle-flashes', sfxFlashGain: 0.6, sfxFlashRate: 1,
  sfxDuck: 0.6,
  previewDamage: 12,
  previewParts: 4,
  ...tierDefaults,
};

const GLOBAL_RANGES: Record<Exclude<keyof GlobalConfig, HeroWrestleStrKey>, [number, number, number]> = {
  tier2At: [2, 40, 1], tier3At: [2, 60, 1], tier4At: [2, 80, 1],
  absorbMs: [60, 600, 10],
  gap: [0.5, 1.4, 0.01],
  chopWindMs: [60, 1000, 10],
  chopMs: [40, 600, 10],
  chopLean: [0, 45, 0.5],
  stagger: [0, 1.5, 0.01],
  chopSpins: [0, 5, 1],
  chairRiseMs: [60, 1000, 10],
  chairWindMs: [60, 1500, 10],
  chairSize: [0.4, 2, 0.05],
  dipMs: [60, 800, 10],
  liftMs: [100, 1200, 10],
  hangMs: [0, 1500, 10],
  slamMs: [60, 800, 10],
  liftHeight: [0.5, 1.4, 0.01],
  bounceMs: [60, 1000, 10],
  bounce: [0, 1.5, 0.01],
  spinTurns: [0, 6, 1],
  shoveMs: [80, 800, 10],
  climbMs: [120, 1500, 10],
  perchMs: [0, 2000, 10],
  diveMs: [100, 1200, 10],
  spot: [0, 2, 0.05],
  leapHeight: [0, 2, 0.05],
  ringWidth: [2, 6, 0.05],
  ropeSize: [0.3, 2.5, 0.05],
  grabMs: [40, 800, 10],
  whipMs: [100, 1200, 10],
  stretchMs: [80, 1000, 10],
  stretch: [0, 1.5, 0.01],
  reboundMs: [80, 1000, 10],
  flipMs: [150, 1200, 10],
  flipTurns: [0, 3, 1],
  afterMs: [0, 1500, 10],
  exitMs: [100, 1500, 10],
  dazeMs: [300, 3000, 10],
  leapMs: [120, 1200, 10],
  cutMs: [60, 600, 10],
  voiceLeadMs: [0, 3000, 10],
  coverMs: [100, 1000, 10],
  countMs: [140, 1000, 10],
  winMs: [200, 2000, 10],
  wordSize: [0, 2.5, 0.05],
  squash: [0, 0.4, 0.01],
  flash: [0, 1, 0.05],
  crowdFlashes: [0, 3, 0.05],
  pan: [0, 1, 0.05],
  shakeMs: [0, 1200, 10],
  zoomOutMs: [60, 1500, 10],
  reducedFadeMs: [60, 1000, 10],
  sfxWhooshGain: [0, 2, 0.05], sfxWhooshRate: [0.5, 2.5, 0.01],
  sfxChopGain: [0, 2, 0.05], sfxChopRate: [0.5, 2.5, 0.01],
  sfxSlamGain: [0, 2, 0.05], sfxSlamRate: [0.5, 2.5, 0.01],
  sfxBoomGain: [0, 2, 0.05], sfxBoomRate: [0.5, 2.5, 0.01],
  sfxBellGain: [0, 2, 0.05], sfxBellRate: [0.5, 2.5, 0.01],
  sfxWooGain: [0, 2, 0.05], sfxWooRate: [0.5, 2.5, 0.01],
  sfxCheerGain: [0, 2, 0.05], sfxCheerRate: [0.5, 2.5, 0.01],
  sfxThudGain: [0, 3, 0.05], sfxThudRate: [0.5, 2.5, 0.01],
  sfxRopeGain: [0, 3, 0.05], sfxRopeRate: [0.5, 2.5, 0.01],
  sfxSlapGain: [0, 3, 0.05], sfxSlapRate: [0.5, 2.5, 0.01],
  sfxRoarGain: [0, 3, 0.05], sfxRoarRate: [0.5, 2.5, 0.01],
  sfxOohGain: [0, 3, 0.05], sfxOohRate: [0.5, 2.5, 0.01],
  sfxVoiceGain: [0, 3, 0.05], sfxVoiceRate: [0.5, 2.5, 0.01],
  sfxChairGain: [0, 3, 0.05], sfxChairRate: [0.5, 2.5, 0.01],
  sfxBigGain: [0, 3, 0.05], sfxBigRate: [0.5, 2.5, 0.01],
  sfxFlashGain: [0, 3, 0.05], sfxFlashRate: [0.5, 2.5, 0.01],
  sfxDuck: [0, 1, 0.05],
  previewDamage: [1, 60, 1],
  previewParts: [1, 8, 1],
};

export const HERO_WRESTLE_RANGES: Record<HeroWrestleNumKey, [number, number, number]> = {
  ...GLOBAL_RANGES,
  ...(Object.fromEntries(TIERS.flatMap((t) => WRESTLE_TIER_SUFFIXES.map((s) => [`t${t}${s}`, WRESTLE_TIER_RANGES[s]]))) as Record<TierKey, [number, number, number]>),
};

/** Hard caps (whatever the tuner says). */
export const WRESTLE_CAPS = { shakePx: 40 } as const;

const store = configStore<HeroWrestleConfig>({
  key: 'ascent.herowrestle.v3', defaults: HERO_WRESTLE_DEFAULTS, ranges: HERO_WRESTLE_RANGES,
  colorKeys: HERO_WRESTLE_COLOR_KEYS, clipKeys: [...HERO_WRESTLE_CLIP_KEYS, 'variation'], previewKeys: ['previewDamage', 'previewParts', 'variation'],
});
export const heroWrestleStore = store;
export const getHeroWrestleConfig = store.get;
export const clampHeroWrestleValue = store.clamp;
export const sanitizeHeroWrestleConfig = store.sanitize;
export const heroWrestleConfigJson = store.json;
/** The preview speed hook (Recruit + the Collection read one per style). Always 1: the tuner has no speed buttons. */
export function heroWrestlePreviewSpeed(): number { return 1; }

/** The variant a blow plays: the DEV override when set, else rolled from the stable per-blow seed. Pure. */
export function variantOf(rollSeed: number, c: HeroWrestleConfig = store.get()): WrestleVariant {
  const forced = Number(c.variation);
  if (forced === 1 || forced === 2) return forced;
  let h = ((Math.round(rollSeed) | 0) ^ 0x2c1b3c6d) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return ((h % 2) + 1) as WrestleVariant;
}

export function wrestleTierDials(tier: TierNum, c: HeroWrestleConfig = store.get()): Record<WrestleTierSuffix, number> {
  return Object.fromEntries(WRESTLE_TIER_SUFFIXES.map((s) => [s, c[`t${tier}${s}`]])) as Record<WrestleTierSuffix, number>;
}

// ─── the pure plan ─────────────────────────────────────────────────────────────────────────────────────────────

export interface WrestlePlanInput extends AttackTierContext {
  leadIn?: number;
  total: number;
  reduced?: boolean;
  /** Which variant (see the header). Default 1. */
  variant?: WrestleVariant;
}

/** A small jolt of the view on a tick (the ropes, a landing, a slap of the mat): `k` of the tier's shake. */
export interface WrestleJolt { at: number; k: number; vertical: boolean }

export interface WrestlePlan {
  reduced: boolean;
  tier: TierNum;
  kind: WrestleKind;
  variant: WrestleVariant;
  k: number;
  total: number;
  chargeAt: number;
  absorbEnd: number;
  /** The striker sets off, and arrives beside the struck portrait. */
  walkAt: number;
  gripAt: number;
  /** Tier 1: the arm (or the chair) comes through. The chop winds up from `gripAt`; the chair rises, then winds up. */
  chopAt: number | null;
  /** Tier 1, the chair: it is up in the striker's hands (the rise runs from `gripAt` to here). */
  chairAt: number | null;
  /** Tier 2: the lift starts (the dip runs from `gripAt` to here), the top of the lift, the drop starts, the bounces end. */
  liftAt: number | null;
  topAt: number | null;
  slamAt: number | null;
  bounceEnd: number | null;
  /** Tier 3: the shoved portrait hits the mat (the climb starts), the striker is up on the turnbuckle (the taunt), the leap. */
  downAt: number | null;
  perchAt: number | null;
  diveAt: number | null;
  /** Tier 4, the clothesline: the whip, the far ropes (contact), flung back off them, landing on its back. */
  whipAt: number | null;
  ropeAt: number | null;
  flingAt: number | null;
  landAt: number | null;
  /** Tier 4, the cutter: the striker is off the screen, the voice starts, the leap in from off screen, the catch. */
  exitAt: number | null;
  voiceAt: number | null;
  leapAt: number | null;
  catchAt: number | null;
  /** Tier 4: the striker goes for the cover (after the beat over the body), lands on it, the count, the bell. */
  coverAt: number | null;
  pinAt: number | null;
  counts: number[];
  bellAt: number | null;
  /** THE impact. The blow lands here, once. */
  impactAt: number;
  /** Both head home, and are home. */
  homeAt: number;
  homeEnd: number;
  endAt: number;
  jolts: WrestleJolt[];
  // the looks
  knock: number;
  zoom: number;
  punch: number;
  shakePx: number;
  burst: number;
  rings: number;
  dim: number;
}

/** The whole attack, in base ms. Pure and deterministic. */
export function wrestlePlan(input: WrestlePlanInput, c: HeroWrestleConfig = store.get()): WrestlePlan {
  const total = Math.max(0, Math.round(input.total));
  const tier = attackTier(total, input, c); // a knockout always plays the shared Tier 4
  const kind = wrestleKind(tier);
  const variant: WrestleVariant = input.variant === 2 ? 2 : 1;
  const L = wrestleTierDials(tier, c);
  const looks = {
    tier, kind, variant, k: (tier - 1) / 3, total, knock: L.Knock, zoom: L.Zoom, punch: L.Punch, shakePx: clamp(L.Shake, 0, WRESTLE_CAPS.shakePx),
    burst: L.Burst, rings: Math.round(L.Rings), dim: L.Dim,
  };
  const none = {
    chopAt: null, chairAt: null, liftAt: null, topAt: null, slamAt: null, bounceEnd: null, downAt: null, perchAt: null, diveAt: null,
    whipAt: null, ropeAt: null, flingAt: null, landAt: null, exitAt: null, voiceAt: null, leapAt: null, catchAt: null,
    coverAt: null, pinAt: null, counts: [] as number[], bellAt: null, jolts: [] as WrestleJolt[],
  };
  if (input.reduced) {
    const r = reducedAttackTimeline(input.leadIn ?? 0, c.reducedFadeMs);
    const at = r.impactAt;
    return {
      ...looks, ...none, reduced: true, chargeAt: at, absorbEnd: at, walkAt: at, gripAt: at, impactAt: at, homeAt: at, homeEnd: at, endAt: r.endAt,
      zoom: 0, punch: 0, shakePx: 0, burst: 0, rings: 0, dim: 0, knock: 0,
    };
  }
  const chargeAt = Math.max(0, input.leadIn ?? 0);
  const absorbEnd = chargeAt + c.absorbMs;
  const walkAt = chargeAt + Math.max(L.ReadyMs, c.absorbMs * 0.6);
  const gripAt = walkAt + Math.max(80, L.WalkMs);
  const base = { ...looks, ...none, reduced: false, chargeAt, absorbEnd, walkAt, gripAt };
  const tail = (impactAt: number, homeAt: number): { impactAt: number; homeAt: number; homeEnd: number; endAt: number } => {
    const homeEnd = homeAt + Math.max(60, L.ReturnMs);
    return { impactAt, homeAt, homeEnd, endAt: homeEnd + 80 };
  };
  if (kind === 'chop') {
    if (variant === 2) {
      // THE CHAIR: up from under the ring, raised overhead, brought down.
      const chairAt = gripAt + c.chairRiseMs;
      const chopAt = chairAt + c.chairWindMs;
      const impactAt = chopAt + Math.max(40, c.chopMs);
      return { ...base, chairAt, chopAt, ...tail(impactAt, impactAt + L.HoldMs) };
    }
    const chopAt = gripAt + c.chopWindMs;
    const impactAt = chopAt + Math.max(40, c.chopMs);
    return { ...base, chopAt, ...tail(impactAt, impactAt + L.HoldMs) };
  }
  if (kind === 'slam') {
    const liftAt = gripAt + c.dipMs;
    const topAt = liftAt + c.liftMs;
    const slamAt = topAt + c.hangMs;
    const impactAt = slamAt + Math.max(60, c.slamMs) * (variant === 2 ? 1.6 : 1); // the suplex topples over: a little longer
    const bounceEnd = impactAt + c.bounceMs;
    const jolts = [{ at: bounceEnd, k: 0.35, vertical: true }, { at: bounceEnd + c.bounceMs * 0.6, k: 0.18, vertical: true }];
    return { ...base, liftAt, topAt, slamAt, bounceEnd, jolts, ...tail(impactAt, Math.max(bounceEnd + c.bounceMs * 0.6 + 120, impactAt + L.HoldMs)) };
  }
  if (kind === 'elbow') {
    const downAt = gripAt + c.shoveMs;
    const perchAt = downAt + c.climbMs;
    const diveAt = perchAt + c.perchMs;
    const impactAt = diveAt + Math.max(100, c.diveMs);
    // The hit bounces both of them off the mat once (a tick).
    const bounceEnd = impactAt + c.bounceMs;
    // Each hop up the turnbuckle shakes the frame a little.
    const hops = Array.from({ length: CLIMB_HOPS }, (_, i) => ({ at: downAt + (c.climbMs * (i + 1)) / CLIMB_HOPS, k: 0.12, vertical: true }));
    return {
      ...base, downAt, perchAt, diveAt, bounceEnd, jolts: [{ at: downAt, k: 0.3, vertical: true }, ...hops, { at: bounceEnd, k: 0.25, vertical: true }],
      ...tail(impactAt, Math.max(bounceEnd + 80, impactAt + L.HoldMs)),
    };
  }
  // Tier 4: the ring, then one of two finishers, then the pin.
  const count = (landAt: number): Pick<WrestlePlan, 'coverAt' | 'pinAt' | 'counts' | 'bellAt' | 'jolts'> & { homeAt: number } => {
    const coverAt = landAt + Math.max(0, c.afterMs);
    const pinAt = coverAt + c.coverMs;
    const counts = [0, 1, 2].map((i) => pinAt + 200 + i * c.countMs);
    const bellAt = counts[2]! + c.countMs * 0.9;
    // The ticks that shake the frame: the cover, and each count harder.
    const jolts: WrestleJolt[] = [{ at: pinAt, k: 0.45, vertical: true }, ...counts.map((at, i) => ({ at, k: 0.34 + 0.08 * i, vertical: true }))];
    return { coverAt, pinAt, counts, bellAt, jolts, homeAt: bellAt + c.winMs };
  };
  if (variant === 2) {
    // THE JUMPING CUTTER: a shove, the striker runs off the screen, the struck portrait staggers about dazed while the
    // voice yells, the striker leaps in from off screen and drives it into the mat.
    const exitAt = gripAt + c.exitMs;
    const leapAt = exitAt + c.dazeMs;
    const voiceAt = Math.max(gripAt, leapAt - c.voiceLeadMs);
    const catchAt = leapAt + c.leapMs;
    const impactAt = catchAt + Math.max(60, c.cutMs);
    const n = count(impactAt + 200);
    const { homeAt, ...pin } = n;
    return { ...base, exitAt, voiceAt, leapAt, catchAt, ...pin, jolts: pin.jolts, ...tail(impactAt, homeAt) };
  }
  // THE CLOTHESLINE.
  const whipAt = gripAt + c.grabMs;
  const ropeAt = whipAt + c.whipMs;
  const flingAt = ropeAt + c.stretchMs;
  const impactAt = flingAt + c.reboundMs;
  const landAt = impactAt + c.flipMs;
  const { homeAt, ...pin } = count(landAt);
  const jolts: WrestleJolt[] = [{ at: ropeAt, k: 0.25, vertical: false }, { at: landAt, k: 0.75, vertical: true }, ...pin.jolts];
  return { ...base, whipAt, ropeAt, flingAt, landAt, ...pin, jolts, ...tail(impactAt, homeAt) };
}

export type WrestleCueKind =
  | 'charge' | 'walk' | 'grip' | 'chair' | 'swing' | 'lift' | 'top' | 'drop' | 'bounce' | 'down' | 'perch' | 'dive' | 'whip' | 'rope' | 'fling' | 'land'
  | 'exit' | 'voice' | 'leap' | 'catch' | 'hop' | 'cover' | 'count' | 'bell' | 'impact' | 'home' | 'end';
export interface WrestleCue { at: number; kind: WrestleCueKind; i: number }

/** Every beat the runner fires, in time order. The blow lands on `impact`, once. */
export function wrestleCues(p: WrestlePlan): WrestleCue[] {
  const out: WrestleCue[] = [];
  const add = (at: number | null, kind: WrestleCueKind, i = 0): void => { if (at !== null) out.push({ at, kind, i }); };
  if (!p.reduced) {
    add(p.chargeAt, 'charge');
    add(p.walkAt, 'walk');
    add(p.gripAt, 'grip');
    add(p.chairAt, 'chair');
    add(p.chopAt, 'swing');
    add(p.liftAt, 'lift');
    add(p.topAt, 'top');
    add(p.slamAt, 'drop');
    add(p.bounceEnd, 'bounce');
    add(p.downAt, 'down');
    add(p.perchAt, 'perch');
    add(p.diveAt, 'dive');
    add(p.whipAt, 'whip');
    add(p.ropeAt, 'rope');
    add(p.flingAt, 'fling');
    add(p.landAt, 'land');
    add(p.exitAt, 'exit');
    add(p.voiceAt, 'voice');
    add(p.leapAt, 'leap');
    add(p.catchAt, 'catch');
    add(p.coverAt, 'hop');
    add(p.pinAt, 'cover');
    p.counts.forEach((at, i) => add(at, 'count', i));
    add(p.bellAt, 'bell');
    add(p.homeAt, 'home');
  }
  add(p.impactAt, 'impact');
  add(p.endAt, 'end');
  const order: Record<WrestleCueKind, number> = {
    charge: 0, walk: 1, grip: 2, chair: 3, swing: 4, lift: 5, top: 6, drop: 7, down: 8, perch: 9, dive: 10, whip: 11, rope: 12, fling: 13,
    exit: 14, voice: 15, leap: 16, catch: 17, impact: 18, bounce: 19, land: 20, hop: 21, cover: 22, count: 23, bell: 24, home: 25, end: 26,
  };
  return out.sort((a, b) => a.at - b.at || order[a.kind] - order[b.kind]);
}

// ─── the geometry (pure) ───────────────────────────────────────────────────────────────────────────────────────

export interface Frame { x0: number; y0: number; x1: number; y1: number }

/** Tier 4's ring: its centre line, its half width, and the near (the struck slot's side) and far rope lines. */
export interface WrestleRingGeo { cx: number; cy: number; half: number; xNear: number; xFar: number }

export interface WrestleGeo {
  /** Unit, striker -> struck, and the distance (the camera and the reduced look). */
  u: Pt;
  dist: number;
  /** Which side of the struck portrait the striker stands on: +1 = to its right (screen +x). */
  s: 1 | -1;
  /** Every point below is SCREEN px. Where the striker stands to take hold (beside the struck slot). */
  grab: Pt;
  /** Tier 1: how far the chop staggers the struck portrait. */
  stagger: Pt;
  /** Tier 2: the dip (half under the struck portrait), where the striker stands for the lift, the top of the lift. */
  under: Pt;
  stand: Pt;
  top: Pt;
  /** Tiers 2-4: where the struck portrait ends up flat on the mat. */
  mat: Pt;
  /** Tier 3: the top of the turnbuckle (where the striker taunts), its foot on the floor, and the striker on top of the
   *  one on the mat (also Tier 4's cover). */
  perch: Pt;
  postFoot: Pt;
  cover: Pt;
  /** Tier 4: the ring; the struck portrait meeting the far ropes and at their fullest stretch; the striker braced for the
   *  clothesline and where the two meet; the winner's spot; where the count's numbers slam down. */
  ring: WrestleRingGeo;
  ropeHit: Pt;
  ropeMax: Pt;
  block: Pt;
  meet: Pt;
  win: Pt;
  count: Pt;
  /** Tier 4, the cutter: where the struck portrait staggers about (the ring's middle), where the striker runs off the
   *  screen, and where it leaps back in from (both beyond the screen's edge, on purpose). */
  daze: Pt;
  offscreen: Pt;
  entry: Pt;
  /** The top of the frame (screen px): what is lifted high is kept below it. */
  y0: number;
}

/** Tier 4's ring, in portrait radii from its centre line: how far up the screen the back corners stand, how far down the
 *  front ones, and how much narrower the back edge (wider the front edge) is than the rope line (a floor in perspective). */
export const RING_BACK = 1.25;
export const RING_FRONT = 2.3;
export const RING_SKEW = 0.12;

const inFrame = (p: Pt, f: Frame | null, m: number): boolean => !f || (p.x >= f.x0 + m && p.x <= f.x1 - m && p.y >= f.y0 + m && p.y <= f.y1 - m);

/** A point clamped inside the frame with `m` px to spare (a tiny frame: its middle). Pure. */
export function clampToFrame(p: Pt, f: Frame | null, m: number): Pt { return clampXY(p, f, m, m, m); }

/** A point clamped inside the frame with its own margins at the sides, the top and the bottom. Pure. */
function clampXY(p: Pt, f: Frame | null, mx: number, top: number, bottom: number): Pt {
  if (!f) return p;
  const x = f.x1 - f.x0 > 2 * mx ? clamp(p.x, f.x0 + mx, f.x1 - mx) : (f.x0 + f.x1) / 2;
  const y = f.y1 - f.y0 > top + bottom ? clamp(p.y, f.y0 + top, f.y1 - bottom) : (f.y0 + f.y1) / 2;
  return { x, y };
}

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const lerpPt = (a: Pt, b: Pt, t: number): Pt => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

/** Whether a point is inside the frame (tests). */
export const onScreen = inFrame;

/** Where every move goes, from the two heroes, the frame, the move and its variant (screen px). Pure. */
export function wrestleGeo(a: Pt, d: Pt, aR: number, dR: number, frame: Frame | null, kind: WrestleKind, c: HeroWrestleConfig = store.get(), variant: WrestleVariant = 1): WrestleGeo {
  const dx = d.x - a.x, dy = d.y - a.y;
  const dist = Math.hypot(dx, dy) || 1;
  const u = { x: dx / dist, y: dy / dist };
  const gap = (aR + dR) * c.gap;
  const Rm = (aR + dR) / 2;
  // The striker stands on the side it comes from; when the two are stacked, or that side has no room, the roomier side.
  const roomR = frame ? frame.x1 - d.x : Infinity, roomL = frame ? d.x - frame.x0 : Infinity;
  const need = gap + aR * 0.7;
  const roomier: 1 | -1 = roomR >= roomL ? 1 : -1;
  const from: 1 | -1 = Math.abs(a.x - d.x) < gap * 0.5 ? roomier : a.x > d.x ? 1 : -1;
  const s: 1 | -1 = (from === 1 ? roomR : roomL) >= need ? from : roomier;
  const edge = aR * 0.6;
  const grab = clampToFrame({ x: d.x + s * gap, y: d.y }, frame, edge);
  const stagger = clampToFrame({ x: d.x - s * dR * c.stagger, y: d.y }, frame, dR * 0.6);
  const zero = { x: d.x, y: d.y };
  const noRing: WrestleRingGeo = { cx: d.x, cy: d.y, half: 0, xNear: d.x, xFar: d.x };
  const blank = {
    under: grab, stand: grab, top: zero, mat: zero, perch: grab, postFoot: grab, cover: grab, ring: noRing, ropeHit: zero, ropeMax: zero, block: grab, meet: zero,
    win: grab, count: zero, daze: zero, offscreen: grab, entry: grab, y0: frame ? frame.y0 : -Infinity,
  };
  if (kind === 'chop') return { u, dist, s, grab, stagger, ...blank };
  if (kind === 'slam') {
    // The lift needs headroom: the mat is pulled down far enough that the one held overhead stays on screen, and in off
    // the side so the slam (or the suplex) lands in the open, clear of a corner.
    const liftH = (aR + dR) * c.liftHeight;
    const mat = clampXY({ x: d.x - s * dR * 0.1, y: d.y + dR * 0.15 }, frame, dR * 2.6, liftH + dR * 1.5, dR * 0.85);
    const stand = clampToFrame({ x: mat.x + s * gap * 0.95, y: mat.y - dR * 0.15 }, frame, edge);
    const under = clampToFrame({ x: lerp(d.x, grab.x, 0.45), y: d.y + aR * 0.3 }, frame, edge);
    const top = { x: stand.x - s * aR * 0.1, y: stand.y - liftH };
    return { u, dist, s, grab, stagger, ...blank, under, stand, top, mat, cover: stand };
  }
  if (kind === 'elbow') {
    // The mat is pulled well down from the top (the leap needs a fall worth watching) and in off the side; the turnbuckle
    // stands beside it, on the striker's side, its top near the top of the screen.
    const mat = clampXY({ x: d.x - s * dR * 0.4, y: d.y + dR * 0.3 }, frame, dR * 2.6, Rm * 3.6, dR * 0.8);
    const top = frame ? frame.y0 : mat.y - Rm * 3.6;
    const perch = clampXY({ x: mat.x + s * gap * 1.2, y: Math.max(top + aR * 1.45, mat.y - Rm * 2.3) }, frame, aR * 0.8, aR * 1.1, aR);
    const postFoot = { x: perch.x, y: mat.y + dR * 0.55 };
    const cover = { x: mat.x, y: mat.y - dR * (variant === 2 ? 0.22 : 0.3) };
    return { u, dist, s, grab, stagger, ...blank, mat, perch, postFoot, cover };
  }
  // Tier 4: THE RING. The struck slot sits just inside the near ropes.
  const fw = frame ? frame.x1 - frame.x0 : Infinity;
  const mF = dR * (0.15 + c.stretch); // the far ropes' fullest stretch stays on screen
  const half = Math.max(Rm * 1.2, Math.min(c.ringWidth * Rm, (fw - 2 * mF) / 2));
  // Room for the whole ring: the front corners stand a little outside the rope line, the back ropes above the two and
  // the front ropes below them.
  const mid = clampXY({ x: d.x + s * half * 0.7, y: d.y + dR * 0.2 }, frame, Math.max(half + mF, half * (1 + RING_SKEW) + Rm * 0.25), Rm * 3.3, Rm * (RING_FRONT + 0.2));
  const ring: WrestleRingGeo = { cx: mid.x, cy: mid.y, half, xNear: mid.x - s * half, xFar: mid.x + s * half };
  const ropeHit = { x: ring.xFar - s * dR * 0.9, y: ring.cy };
  const ropeMax = { x: ropeHit.x + s * dR * c.stretch, y: ring.cy };
  const block = { x: ring.cx - s * aR * 0.45, y: ring.cy };
  const meet = { x: block.x + s * gap * 0.62, y: ring.cy };
  // The cutter: it reels into the middle of the ring; the striker runs off the screen on the far side and leaps back in.
  const daze = { x: ring.cx - s * dR * 0.2, y: ring.cy };
  const fx0 = frame ? frame.x0 : d.x - 2000, fx1 = frame ? frame.x1 : d.x + 2000;
  const edgeX = s > 0 ? fx1 + aR * 1.6 : fx0 - aR * 1.6;
  const offscreen = { x: edgeX, y: grab.y };
  const entry = { x: edgeX, y: daze.y - aR * 1.6 };
  const mat = variant === 2
    ? clampXY({ x: daze.x + s * dR * 0.15, y: ring.cy + dR * 0.35 }, frame, dR, dR, dR * 0.8)
    : clampXY({ x: meet.x + s * dR * 0.2, y: ring.cy + dR * 0.3 }, frame, dR, dR, dR * 0.8);
  const cover = { x: mat.x - s * dR * 0.3, y: mat.y - dR * 0.45 };
  const win = clampToFrame({ x: cover.x - s * aR * 0.35, y: mat.y - aR * 0.85 }, frame, edge);
  const count = clampXY({ x: mat.x + s * dR * 0.25, y: cover.y - aR * 2.05 }, frame, dR * 1.2, Rm * 1.3, Rm);
  return { u, dist, s, grab, stagger, ...blank, mat, cover, ring, ropeHit, ropeMax, block, meet, win, count, daze, offscreen, entry };
}

// ─── the poses (pure) ──────────────────────────────────────────────────────────────────────────────────────────

/**
 * A portrait's offset from its slot (screen px), its rotation (degrees: positive tips its top toward screen +x), its
 * scale, a squash in SCREEN axes (+ = flattened and wider, - = taller and narrower), so a portrait lying on its back
 * still flattens against the mat, and `flip`, its width as it turns round on the spot (1 = facing out, 0 = edge on,
 * -1 = turned right round: the spin of the chop, the airplane spin, the dazed looking about).
 */
export interface WrestlePose { x: number; y: number; rot: number; scale: number; squash: number; flip: number }
const REST: WrestlePose = { x: 0, y: 0, rot: 0, scale: 1, squash: 0, flip: 1 };

/** Everything a pose needs: the plan, the geometry, the tuned values, the two slots and radii. */
export interface WrestleCtx { p: WrestlePlan; g: WrestleGeo; c: HeroWrestleConfig; a: Pt; d: Pt; aR: number; dR: number }

const easeIn = (u: number): number => { const x = clamp01(u); return x * x; };
const win = (t: number, a: number, b: number): number => clamp01((t - a) / Math.max(1, b - a));
/** A deterministic shiver (a sum of sines; never random), -1..1. */
const jit = (t: number, f: number, ph: number): number => Math.sin(t * f + ph) * 0.6 + Math.sin(t * f * 2.31 + ph * 1.7) * 0.4;
/** One hump, 0 -> 1 -> 0 over `len` ms from `at`. */
const hump = (t: number, at: number, len: number): number => (t < at || t > at + len ? 0 : Math.sin(Math.PI * ((t - at) / len)));

/** A flex after a big move: two hops on the spot that die away, 0..1, from `from` ms after the hit. */
const flexHop = (age: number, from: number): number => (age < from ? 0 : Math.abs(Math.sin((Math.PI * (age - from)) / 230)) * Math.exp(-(age - from) / 420));
/**
 * Tier 4: how far the far ropes are stretched while the struck portrait is in them (`u` 0..1 of the beat), 0..1: OUT
 * fast, HELD at full stretch (creaking, a small tremble), then SNAPPED back. The portrait and the ropes read the same curve.
 */
export function ropeStretch(u: number): number {
  const x = clamp01(u);
  if (x < 0.34) return easeOutCubic(x / 0.34);
  if (x < 0.74) return 1 + 0.035 * Math.sin((x - 0.34) * 38);
  return 1 - easeIn((x - 0.74) / 0.26);
}

/** A whole number of turns round on the spot, eased: the portrait's width (cos of the turn). 1 at both ends. */
const turns = (u: number, n: number): number => Math.cos(2 * Math.PI * Math.round(n) * clamp01(u));

/** An absolute pose (a screen point), before it is made an offset from the slot. */
interface Abs { x: number; y: number; rot: number; scale: number; squash: number; flip: number }
const abs = (pt: Pt, rot = 0, scale = 1, squash = 0, flip = 1): Abs => ({ x: pt.x, y: pt.y, rot, scale, squash, flip });

/** Tier 3: where the climb's hops land: down to the foot of the turnbuckle, then up it in three hops. */
export const CLIMB_HOPS = 4;
/** Tier 3: the striker hopping to the turnbuckle and up it, `u` 0..1. */
function climbAt(g: WrestleGeo, aR: number, dR: number, u: number): { at: Pt; squash: number } {
  const n = CLIMB_HOPS;
  const k = Math.min(n - 1, Math.floor(u * n));
  const f = u * n - k;
  const base = { x: g.perch.x, y: g.mat.y - dR * 0.15 };
  const stop = (i: number): Pt => (i === 0 ? g.grab : lerpPt(base, g.perch, (i - 1) / (n - 1)));
  const q = lerpPt(stop(k), stop(k + 1), easeInOutSine(f));
  // A crouch before each hop and a landing squash after it; stretched in the air.
  const sq = f < 0.2 ? 0.2 * Math.sin((Math.PI / 2) * (f / 0.2)) : f > 0.85 ? 0.15 * Math.sin(Math.PI * ((f - 0.85) / 0.15)) : -0.1 * Math.sin(Math.PI * ((f - 0.2) / 0.65));
  return { at: { x: q.x, y: q.y - aR * 0.45 * Math.sin(Math.PI * f) }, squash: sq };
}

/** Tier 3: the leap off the turnbuckle, `u` 0..1: up off the perch, then down onto the one on the mat. */
function leapAt(x: WrestleCtx, u: number): Pt {
  const { g, c, aR } = x;
  // The air it gets: the tuned height, but never off the top of the screen.
  const up = Math.max(0, Math.min(aR * c.leapHeight, g.perch.y - g.y0 - aR * 0.75));
  return { x: lerp(g.perch.x, g.cover.x, easeInOutSine(u)), y: g.perch.y + (g.cover.y - g.perch.y) * u * u - up * 4 * u * (1 - u) };
}

/** Tier 4, the cutter: where the struck portrait is while it staggers about the ring, dazed (screen px). */
function dazedAt(x: WrestleCtx, t: number): Abs {
  const { p, g, d, dR } = x;
  const s = g.s;
  const reelEnd = p.gripAt + Math.max(200, p.exitAt! - p.gripAt) + 160;
  if (t < reelEnd) {
    // Shoved, it reels backward into the middle of the ring, stumbling.
    const u = win(t, p.gripAt + 120, reelEnd);
    const q = lerpPt(d, g.daze, easeOutCubic(u));
    return abs({ x: q.x, y: q.y - dR * 0.12 * Math.abs(Math.sin(Math.PI * 3 * u)) }, -s * 22 * Math.sin(Math.PI * u), 1, 0, 1);
  }
  // Dazed: a slow lolloping figure of eight, swaying, turning to look about (the wrong way, mostly).
  const age = t - reelEnd;
  const k = Math.min(1, age / 300);
  const look = 1 - win(t, p.leapAt!, p.catchAt! - 40); // turned back to face out just before the catch
  const flip = lerp(1, Math.cos((Math.PI / 2) * (1 + Math.sin(age * 0.0034 - Math.PI / 2))), k * look);
  return abs(
    { x: g.daze.x + Math.sin(age * 0.0042) * dR * 0.32 * k, y: g.daze.y + Math.sin(age * 0.0084) * dR * 0.07 * k },
    Math.sin(age * 0.0061) * 13 * k, 1, 0.05 * Math.sin(age * 0.011) * k, flip,
  );
}

/** The STRIKER while it is acting (from `gripAt` until it heads home). */
function strikerActing(x: WrestleCtx, t: number): Abs {
  const { p, g, c, aR, dR } = x;
  const s = g.s;
  if (p.kind === 'chop') {
    const chopAt = p.chopAt!;
    if (p.variant === 2) {
      // THE CHAIR: a crouch to pull it out from under the ring, then up and overhead, leaning back, stretched tall.
      const chairAt = p.chairAt!;
      if (t < chairAt) {
        const u = win(t, p.gripAt, chairAt);
        return abs({ x: g.grab.x, y: g.grab.y + aR * 0.12 * Math.sin(Math.PI * u) }, -s * 10 * Math.sin(Math.PI * u), 1, 0.22 * Math.sin(Math.PI * u));
      }
      if (t < chopAt) {
        const w = easeOutCubic(win(t, chairAt, chopAt));
        return abs({ x: g.grab.x + s * aR * 0.25 * w, y: g.grab.y - aR * 0.08 * w + jit(t, 0.08, 0.3) * aR * 0.015 * w }, s * c.chopLean * 0.7 * w, 1 + 0.05 * w, -0.16 * w);
      }
      if (t < p.impactAt) {
        const e = easeIn(win(t, chopAt, p.impactAt));
        return abs({ x: g.grab.x + s * aR * (0.25 - 0.55 * e), y: g.grab.y }, s * c.chopLean * 0.7 - s * (c.chopLean * 0.7 + 22) * e, 1.05, -0.16 + 0.3 * e);
      }
      const age = t - p.impactAt;
      const back = easeOutCubic(age / 300);
      return abs({ x: g.grab.x - s * aR * 0.3 * (1 - 0.6 * back), y: g.grab.y - aR * 0.22 * flexHop(age, 380) }, -s * 22 * (1 - back), 1.05 + 0.06 * win(age, 360, 500), c.squash * Math.max(0, spring(age, 5, 70)));
    }
    if (t < chopAt) {
      // THE WIND-UP: it leans WAY back, stretched tall, the arm drawn back, trembling with effort at the end.
      const w = easeInOutSine(win(t, p.gripAt, chopAt));
      const shiver = win(t, chopAt - 160, chopAt) * jit(t, 0.11, 0.7);
      return abs({ x: g.grab.x + s * aR * 0.35 * w, y: g.grab.y - aR * 0.06 * w }, s * (c.chopLean * w + 3 * shiver), 1 + 0.06 * w, -0.14 * w);
    }
    if (t < p.impactAt) {
      const e = easeIn(win(t, chopAt, p.impactAt));
      return abs({ x: g.grab.x + s * aR * (0.35 - 0.7 * e), y: g.grab.y }, s * c.chopLean - s * (c.chopLean + 18) * e, 1.06, -0.14 + 0.3 * e);
    }
    const age = t - p.impactAt;
    const back = easeOutCubic(age / 260);
    // The follow-through, then a flex (two hops, bigger) while the other one spins.
    return abs(
      { x: g.grab.x - s * aR * 0.35 * (1 - 0.7 * back), y: g.grab.y - aR * 0.25 * flexHop(age, 320) },
      -s * 18 * (1 - back), 1.06 - 0.06 * back + 0.1 * win(age, 300, 440), c.squash * 0.7 * Math.max(0, spring(age, 5, 70)),
    );
  }
  if (p.kind === 'slam') {
    const liftAt = p.liftAt!, topAt = p.topAt!, slamAt = p.slamAt!;
    if (t < liftAt) {
      // THE DIP: down and in, half under the one it is about to lift.
      const e = easeInOutSine(win(t, p.gripAt, liftAt));
      const q = lerpPt(g.grab, g.under, e);
      return abs(q, -s * 8 * e, 1, 0.25 * e);
    }
    if (t < topAt) {
      const u = win(t, liftAt, topAt);
      const q = lerpPt(g.under, g.stand, easeOutCubic(u));
      return abs(q, -s * 8 * (1 - u), 1 + 0.04 * u, 0.25 * (1 - easeOutCubic(u)) - 0.12 * Math.sin(Math.PI * u));
    }
    if (t < slamAt) {
      const hoist = easeInOutSine(win(t, slamAt - 170, slamAt));
      if (p.variant === 2) {
        // THE SUPLEX, HELD: straining under it, shaking harder and sinking as the beat goes on.
        const strain = win(t, topAt, slamAt);
        return abs({ x: g.stand.x + jit(t, 0.13, 0.4) * aR * 0.035 * (0.4 + strain), y: g.stand.y + aR * 0.06 * strain }, jit(t, 0.07, 1.1) * 3 * strain, 1.04, 0.05 + 0.12 * strain);
      }
      // THE AIRPLANE SPIN: round and round on the spot with it overhead, then a heave a last notch higher.
      const sp = turns(easeInOutSine(win(t, topAt + 60, slamAt - 200)), c.spinTurns);
      return abs({ x: g.stand.x, y: g.stand.y - aR * 0.05 * Math.abs(Math.sin(t * 0.02)) }, 0, 1.04, -0.03 - 0.08 * hoist, sp);
    }
    if (p.variant === 2) {
      // The suplex topples over backward: it falls on its back toward the mat, bridging.
      const pivot = { x: g.stand.x - s * aR * 0.3, y: g.stand.y + aR * 0.4 };
      if (t < p.impactAt) {
        const e = easeIn(win(t, slamAt, p.impactAt));
        return abs(lerpPt(g.stand, pivot, e), -s * 95 * e, 1.04, -0.05 * e);
      }
      const age = t - p.impactAt;
      const up = easeInOutSine(win(age, 380, 700));
      const q = lerpPt(pivot, g.stand, up);
      return abs({ x: q.x, y: q.y - aR * 0.45 * Math.sin(Math.PI * up) - aR * 0.2 * flexHop(age, 780) }, -s * 95 * (1 - up), 1.04 - 0.04 * up + 0.08 * win(age, 760, 900), c.squash * 1.2 * Math.max(0, spring(age, 4, 90)));
    }
    const down = { x: g.stand.x - s * aR * 0.14, y: g.stand.y + aR * 0.16 };
    if (t < p.impactAt) {
      const e = easeIn(win(t, slamAt, p.impactAt));
      return abs(lerpPt(g.stand, down, e), -s * 18 * e, 1.04, 0.1 * e);
    }
    const age = t - p.impactAt;
    const up = easeOutCubic(age / 320);
    // THE AFTERMATH: it straightens up over the body, wobbles (dizzy from the spin), and flexes.
    const q = lerpPt(down, g.stand, up);
    return abs(
      { x: q.x + Math.sin(age * 0.012) * aR * 0.08 * Math.exp(-age / 500), y: q.y - aR * 0.2 * flexHop(age, 520) },
      -s * 18 * (1 - up) + Math.sin(age * 0.012) * 9 * Math.exp(-age / 500), 1.04 - 0.04 * up + 0.08 * win(age, 500, 640),
      0.1 * (1 - up) + c.squash * 0.6 * Math.max(0, spring(age, 5, 80)),
    );
  }
  if (p.kind === 'elbow') {
    const downAt = p.downAt!, perchAt = p.perchAt!, diveAt = p.diveAt!;
    if (t < downAt) {
      // THE SHOVE: a quick lunge in and back.
      const u = win(t, p.gripAt, downAt);
      const push = u < 0.35 ? easeOutCubic(u / 0.35) : 1 - easeInOutSine((u - 0.35) / 0.65);
      return abs({ x: g.grab.x - s * aR * 0.4 * push, y: g.grab.y }, -s * 14 * push, 1, 0.1 * push);
    }
    if (t < perchAt) {
      // THE CLIMB: a hop to the turnbuckle, three hops up it.
      const cl = climbAt(g, aR, dR, win(t, downAt, perchAt));
      return abs(cl.at, 0, 1, cl.squash);
    }
    if (t < diveAt) {
      // THE TAUNT: up there, it rocks, points at the crowd and flexes; then it crouches to load the leap.
      const age = t - perchAt;
      const load = easeInOutSine(win(t, diveAt - 240, diveAt));
      const rock = Math.sin(age * 0.011) * 16 * (1 - load);
      const pump = Math.abs(Math.sin(age * 0.0095)) * (1 - load);
      return abs({ x: g.perch.x, y: g.perch.y - aR * 0.1 * pump + aR * 0.08 * load }, rock, 1 + 0.12 * pump, 0.28 * load - 0.06 * pump);
    }
    if (t < p.impactAt) {
      // THE LEAP: up off the top, absurd air, then down onto it. The elbow leads (rolled flat); the splash spreads wide.
      const u = win(t, diveAt, p.impactAt);
      const at = leapAt(x, u);
      if (p.variant === 2) return abs(at, -s * 12 * Math.sin(Math.PI * u), 1.1, u < 0.35 ? -0.22 * Math.sin((Math.PI / 2) * (u / 0.35)) : -0.22 + 0.62 * easeInOutSine((u - 0.35) / 0.65));
      return abs(at, s * 100 * easeInOutSine(Math.min(1, u * 1.6)), 1.08, -0.18 * Math.sin(Math.PI * u));
    }
    const age = t - p.impactAt;
    const lie = p.variant === 2 ? 420 : 300;
    // It bounces off the body with it...
    if (age < lie) {
      const sq = p.variant === 2 ? 0.4 + c.squash * 1.6 * Math.max(0, spring(age, 3, 110)) : c.squash * 1.8 * Math.max(0, spring(age, 4, 90));
      return abs({ x: g.cover.x, y: g.cover.y - aR * 0.3 * hump(t, p.impactAt + 40, 260) }, p.variant === 2 ? 0 : s * 100, 1.08 - 0.08 * easeOutCubic(age / lie), sq * (p.variant === 2 ? 1 - easeIn(age / lie) * 0.6 : 1));
    }
    // ...then rolls off to its feet beside it and flexes (THE AFTERMATH).
    const beside = { x: g.mat.x + s * (aR + dR) * c.gap * 0.95, y: g.mat.y - dR * 0.15 };
    const e = easeInOutSine(win(age, lie, lie + 320));
    const q = lerpPt(g.cover, beside, e);
    const from = p.variant === 2 ? 0 : s * 100;
    return abs({ x: q.x, y: q.y - aR * 0.35 * Math.sin(Math.PI * e) - aR * 0.22 * flexHop(age, lie + 400) }, from * (1 - e), 1 + 0.1 * win(age, lie + 340, lie + 480), p.variant === 2 ? 0.16 * (1 - e) : 0);
  }
  // Tier 4.
  const pinAt = p.pinAt!, bellAt = p.bellAt!;
  const coverRot = s * 28;
  const coverAt = p.coverAt!;
  // The beat over the body, the leap for the cover, the pin, WINNER (shared by both finishers).
  const finish = (from: Pt, fromRot: number, landAt: number): Abs => {
    if (t < coverAt) {
      const age = t - landAt;
      return abs({ x: from.x, y: from.y - aR * 0.16 * flexHop(age, 60) }, fromRot, 1 + 0.08 * win(age, 40, 180));
    }
    if (t < pinAt) {
      // It leaps high and drops on top (a hit of its own).
      const u = win(t, coverAt, pinAt);
      const q = lerpPt(from, g.cover, easeInOutSine(u));
      return abs({ x: q.x, y: q.y - aR * 1.05 * Math.sin(Math.PI * Math.pow(u, 0.8)) }, fromRot * (1 - u) + coverRot * easeInOutSine(u), 1.08 - 0.08 * u, -0.12 * Math.sin(Math.PI * u));
    }
    if (t < bellAt) {
      // THE PIN: it presses down with every count.
      let press = 0;
      for (const at of p.counts) press = Math.max(press, hump(t, at - 40, 200));
      return abs({ x: g.cover.x, y: g.cover.y + dR * 0.09 * press }, coverRot + s * 4 * press, 1, c.squash * 1.6 * Math.max(0, spring(t - pinAt, 4, 80)) + 0.12 * press);
    }
    // WINNER: it springs up off the pin and bounces on the spot.
    const age = t - bellAt;
    const e = easeOutBack(age / 240, 1.6);
    const q = lerpPt(g.cover, g.win, e);
    return abs({ x: q.x, y: q.y - aR * 0.2 * Math.abs(Math.sin((Math.PI * Math.max(0, age - 240)) / 240)) }, coverRot * (1 - clamp01(age / 200)), 1 + 0.16 * clamp01(e), -0.08 * Math.abs(Math.sin((Math.PI * Math.max(0, age - 240)) / 240)));
  };
  if (p.variant === 2) {
    // THE JUMPING CUTTER.
    const exitAt = p.exitAt!, leapAt0 = p.leapAt!, catchAt = p.catchAt!;
    const shoveEnd = p.gripAt + 200;
    if (t < shoveEnd) {
      const u = win(t, p.gripAt, shoveEnd);
      const push = u < 0.4 ? easeOutCubic(u / 0.4) : 1 - easeInOutSine((u - 0.4) / 0.6);
      return abs({ x: g.grab.x - s * aR * 0.4 * push, y: g.grab.y }, -s * 14 * push, 1, 0.1 * push);
    }
    if (t < exitAt) {
      // Off it runs, OFF THE SCREEN, leaning into it, bobbing on each stride.
      const u = win(t, shoveEnd, exitAt);
      const q = lerpPt(g.grab, g.offscreen, easeIn(u));
      return abs({ x: q.x, y: q.y - aR * 0.1 * Math.abs(Math.sin(Math.PI * 4 * u)) }, s * 16 * Math.min(1, u * 3), 1, -0.1 * Math.min(1, u * 3));
    }
    if (t < leapAt0) return abs(g.offscreen, s * 16, 1, 0);
    const victimAtCatch = dazedAt(x, catchAt);
    const grabPt = { x: victimAtCatch.x + s * dR * 0.45, y: victimAtCatch.y - dR * 0.5 };
    if (t < catchAt) {
      // THE LEAP: in from beyond the edge, flat out and stretched long, turning in the air.
      const u = win(t, leapAt0, catchAt);
      const q = lerpPt(g.entry, grabPt, easeOutCubic(u));
      return abs({ x: q.x, y: q.y - aR * 0.5 * Math.sin(Math.PI * u) }, -s * 60 * u, 1.1, -0.26 * Math.sin(Math.PI * Math.min(1, u * 1.2)));
    }
    const sit = { x: g.mat.x + s * dR * 1.05, y: g.mat.y + dR * 0.05 };
    if (t < p.impactAt) {
      // THE CUT: it drops, pulling the head down with it, onto its back.
      const e = easeIn(win(t, catchAt, p.impactAt));
      return abs(lerpPt(grabPt, sit, e), -s * (60 + 30 * e), 1.1 - 0.06 * e, -0.1 + 0.2 * e);
    }
    const landAt = p.impactAt + 200;
    if (t < landAt) {
      const age = t - p.impactAt;
      return abs(sit, -s * 90, 1.04, c.squash * 1.5 * Math.max(0, spring(age, 4, 90)));
    }
    // Up off its back onto its feet beside the body (the beat), then the cover.
    if (t < coverAt) {
      const e = easeOutCubic(win(t, landAt, landAt + 160));
      const up = { x: sit.x + s * aR * 0.2, y: g.mat.y - dR * 0.2 };
      return abs({ x: lerp(sit.x, up.x, e), y: lerp(sit.y, up.y, e) - aR * 0.3 * Math.sin(Math.PI * e) }, -s * 90 * (1 - e), 1 + 0.08 * win(t, landAt + 120, landAt + 260));
    }
    return finish({ x: sit.x + s * aR * 0.2, y: g.mat.y - dR * 0.2 }, 0, landAt);
  }
  // THE CLOTHESLINE.
  const whipAt = p.whipAt!, ropeAt = p.ropeAt!, flingAt = p.flingAt!, landAt = p.landAt!;
  if (t < whipAt) {
    // It takes hold.
    const e = easeInOutSine(win(t, p.gripAt, whipAt));
    return abs({ x: g.grab.x - s * aR * 0.14 * e, y: g.grab.y }, -s * 9 * e, 1, 0.1 * e);
  }
  const back = { x: g.block.x - s * aR * 0.3, y: g.block.y };
  if (t < ropeAt) {
    // THE WHIP: it swings round with the throw, then crosses to the middle of the ring.
    const u = win(t, whipAt, ropeAt);
    const sw = easeOutCubic(Math.min(1, u * 1.8));
    const q = lerpPt({ x: g.grab.x - s * aR * 0.14, y: g.grab.y }, back, easeInOutSine(win(u, 0.35, 1)));
    return abs(q, -s * 9 + s * 31 * sw * (1 - easeInOutSine(win(u, 0.5, 1))), 1, 0.1 * (1 - sw));
  }
  if (t < flingAt) {
    // Braced, an arm drawn back, as the ropes stretch.
    const e = easeInOutSine(win(t, ropeAt, flingAt));
    return abs(back, -s * 16 * e, 1 + 0.08 * e, -0.1 * e);
  }
  const through = { x: g.block.x + s * aR * 0.25, y: g.block.y };
  if (t < p.impactAt) {
    // THE CLOTHESLINE: it steps into it.
    const e = easeIn(win(t, flingAt, p.impactAt));
    return abs(lerpPt(back, through, e), -s * 16 + s * 34 * e, 1.08, -0.1 + 0.25 * e);
  }
  const follow = { x: through.x + s * aR * 0.2, y: through.y };
  if (t < landAt) {
    const age = t - p.impactAt;
    const e = easeOutCubic(age / 220);
    return abs(lerpPt(through, follow, e), s * 18 * (1 - easeOutCubic(age / 320)), 1.08 - 0.08 * e, c.squash * 0.6 * Math.max(0, spring(age, 5, 70)));
  }
  return finish(follow, -s * 6, landAt);
}

/** The STRUCK portrait while it is being wrestled (from `gripAt` until it heads home). */
function victimActing(x: WrestleCtx, t: number): Abs {
  const { p, g, c, d, dR } = x;
  const s = g.s;
  if (p.kind === 'chop') {
    if (p.variant === 2) {
      if (t < p.impactAt) {
        // It sees the chair coming: a nervous shrink and a tremble.
        const w = win(t, p.chairAt!, p.chopAt!);
        return abs({ x: d.x + jit(t, 0.12, 0.5) * dR * 0.02 * w, y: d.y + dR * 0.04 * w }, -s * 5 * w, 1 - 0.04 * w, 0.08 * w);
      }
      // THE CHAIR LANDS: it concertinas flat (its feet stay on the floor), springs up too tall, and wobbles, seeing stars.
      const age = t - p.impactAt;
      const sq = 0.62 * spring(age, 2.6, 230);
      return abs({ x: d.x, y: d.y + dR * Math.max(-0.2, sq) * 0.75 }, Math.sin(age * 0.009) * 10 * Math.min(1, age / 300), 1, sq);
    }
    if (t < p.impactAt) return abs(d, -s * 6 * easeInOutSine(win(t, p.gripAt, p.chopAt!)), 1, 0.06 * win(t, p.chopAt! - 120, p.chopAt!));
    // THE CHOP LANDS: it is knocked a step away, SPINNING like a top, then wobbles about, seeing stars.
    const age = t - p.impactAt;
    const spinLen = 720;
    const q = lerpPt(d, g.stagger, easeOutCubic(age / 240) * Math.min(1, p.knock));
    const sp = turns(easeOutCubic(age / spinLen), c.chopSpins);
    const wob = win(age, spinLen * 0.6, spinLen);
    return abs(
      { x: q.x + Math.sin(age * 0.008) * dR * 0.1 * wob, y: q.y - dR * 0.22 * hump(age, 0, 260) },
      -s * 16 * p.knock * spring(age, 2.6, 260) + Math.sin(age * 0.009) * 9 * wob, 1, c.squash * 1.2 * Math.max(0, spring(age, 5, 80)), sp,
    );
  }
  if (p.kind === 'slam') {
    const liftAt = p.liftAt!, topAt = p.topAt!, slamAt = p.slamAt!;
    const flat = -s * 90;
    if (t < liftAt) return abs(d, -s * 4 * easeInOutSine(win(t, p.gripAt, liftAt)), 1, 0.05 * win(t, p.gripAt, liftAt));
    const hoistH = dR * 0.16;
    const twoBounces = (): number => c.bounce * hump(t, p.impactAt + 30, Math.max(40, c.bounceMs - 30)) + c.bounce * 0.4 * hump(t, p.bounceEnd!, Math.max(40, c.bounceMs * 0.6));
    if (p.variant === 2) {
      // THE SUPLEX: up and over, UPSIDE DOWN above the striker; held there, legs kicking; then over the top onto the mat.
      const up = s * 180;
      if (t < topAt) {
        const e = easeInOutSine(win(t, liftAt, topAt));
        const q = lerpPt(d, g.top, e);
        return abs({ x: q.x - s * dR * 0.3 * Math.sin(Math.PI * e), y: q.y }, up * e, 1 + 0.05 * e, -0.1 * Math.sin(Math.PI * e));
      }
      if (t < slamAt) {
        const strain = win(t, topAt, slamAt);
        return abs({ x: g.top.x + jit(t, 0.1, 2.2) * dR * 0.04, y: g.top.y + dR * 0.06 * strain + jit(t, 0.13, 0.9) * dR * 0.02 }, up + Math.sin(t * 0.045) * 7, 1.05, -0.04 + 0.03 * Math.sin(t * 0.05));
      }
      // Over the top about the striker's feet onto the mat (a radius that changes as it goes).
      const pivot = { x: g.stand.x, y: g.stand.y + x.aR * 0.8 };
      const v0 = { x: g.top.x - pivot.x, y: g.top.y - pivot.y }, v1 = { x: g.mat.x - pivot.x, y: g.mat.y - pivot.y };
      const phi1 = Math.atan2(v0.x * v1.y - v0.y * v1.x, v0.x * v1.x + v0.y * v1.y);
      const r0 = Math.hypot(v0.x, v0.y), r1 = Math.hypot(v1.x, v1.y);
      const endRot = up + (phi1 * 180) / Math.PI;
      if (t < p.impactAt) {
        const e = easeIn(win(t, slamAt, p.impactAt));
        const ph = phi1 * e, rr = lerp(r0, r1, e);
        const ux = v0.x / (r0 || 1), uy = v0.y / (r0 || 1);
        const vx = ux * Math.cos(ph) - uy * Math.sin(ph), vy = ux * Math.sin(ph) + uy * Math.cos(ph);
        return abs({ x: pivot.x + vx * rr, y: pivot.y + vy * rr }, up + (ph * 180) / Math.PI, 1.05, -0.1 * e);
      }
      const age = t - p.impactAt;
      const sq = c.squash * 3 * Math.max(0, spring(age, 3.2, 130));
      return abs({ x: g.mat.x, y: g.mat.y - dR * twoBounces() }, endRot + s * 6 * hump(t, p.impactAt + 30, c.bounceMs), 1, sq);
    }
    if (t < topAt) {
      // HOISTED: up and over in an arc, tipping flat.
      const e = easeInOutSine(win(t, liftAt, topAt));
      const q = lerpPt(d, g.top, e);
      return abs({ x: q.x - s * dR * 0.35 * Math.sin(Math.PI * e), y: q.y }, flat * e, 1 + 0.05 * e);
    }
    // HELD overhead and SPUN round and round with the striker (swinging round in front and behind), then heaved a last
    // notch higher just before the drop.
    if (t < slamAt) {
      const hoist = easeInOutSine(win(t, slamAt - 170, slamAt));
      const su = easeInOutSine(win(t, topAt + 60, slamAt - 200));
      const ang = 2 * Math.PI * Math.round(c.spinTurns) * su;
      return abs(
        { x: g.top.x + Math.sin(ang) * dR * 0.55, y: g.top.y - hoistH * hoist + (1 - Math.cos(ang)) * dR * 0.05 },
        flat + Math.sin((t - topAt) * 0.022) * 5, 1.05 + 0.03 * hoist, 0, turns(su, c.spinTurns),
      );
    }
    if (t < p.impactAt) {
      // THE SLAM: straight down, faster and faster.
      const u = win(t, slamAt, p.impactAt);
      return abs({ x: lerp(g.top.x, g.mat.x, easeOutCubic(u)), y: lerp(g.top.y - hoistH, g.mat.y, u * u) }, flat, 1.08 - 0.08 * u, -0.18 * u);
    }
    const age = t - p.impactAt;
    const landed = t - p.bounceEnd!;
    const sq = c.squash * 3 * Math.max(0, spring(age, 3.2, 130)) + (landed >= 0 ? c.squash * 0.9 * Math.max(0, spring(landed, 5, 70)) : 0);
    return abs({ x: g.mat.x, y: g.mat.y - dR * twoBounces() }, flat + s * 5 * hump(t, p.impactAt + 30, Math.max(40, c.bounceMs - 30)), 1, sq);
  }
  if (p.kind === 'elbow') {
    const downAt = p.downAt!;
    const flat = -s * 90;
    if (t < downAt) {
      // SHOVED: it tips over backward onto the mat.
      const u = win(t, p.gripAt, downAt);
      if (u < 0.3) return abs(d);
      const v = (u - 0.3) / 0.7;
      const q = lerpPt(d, g.mat, easeOutCubic(v));
      return abs({ x: q.x, y: q.y - dR * 0.22 * Math.sin(Math.PI * v) }, flat * easeIn(v));
    }
    if (t < p.impactAt) {
      // Flat on its back, dazed, then wriggling in panic as the striker leaps.
      const w = win(t, p.diveAt!, p.impactAt);
      return abs({ x: g.mat.x + jit(t, 0.09, 0.6) * dR * 0.06 * w, y: g.mat.y }, flat + Math.sin((t - downAt) * 0.03) * (2 + 6 * w), 1, c.squash * 1.2 * Math.max(0, spring(t - downAt, 4, 80)));
    }
    // IT LANDS: flattened hard, bounced off the mat once.
    const age = t - p.impactAt;
    const landed = t - p.bounceEnd!;
    const up = hump(t, p.impactAt + 30, Math.max(40, c.bounceMs - 30));
    const k = p.variant === 2 ? 1.25 : 1;
    return abs({ x: g.mat.x, y: g.mat.y - dR * c.bounce * 0.6 * up }, flat + s * 4 * up, 1, k * c.squash * 3 * Math.max(0, spring(age, 3, 160)) + (landed >= 0 ? c.squash * 0.9 * Math.max(0, spring(landed, 5, 70)) : 0));
  }
  // Tier 4.
  const pinAt = p.pinAt!;
  const onBack = (landAt: number, rot: number): Abs => {
    // On its back for the count.
    const age = t - landAt;
    let press = 0;
    for (const at of p.counts) press = Math.max(press, hump(t, at - 40, 200));
    const pinned = t - pinAt;
    return abs({ x: g.mat.x, y: g.mat.y - dR * 0.24 * hump(t, landAt + 20, 220) }, rot, 1, c.squash * 3 * Math.max(0, spring(age, 3.5, 120)) + (pinned >= 0 ? c.squash * 1.8 * Math.max(0, spring(pinned, 4, 90)) : 0) + 0.1 * press);
  };
  if (p.variant === 2) {
    // THE CUTTER: reeling, dazed, then the head driven into the mat; on its front for the count.
    const catchAt = p.catchAt!;
    if (t < catchAt) return dazedAt(x, t);
    const flatC = -s * 90;
    if (t < p.impactAt) {
      const from = dazedAt(x, catchAt);
      const e = easeIn(win(t, catchAt, p.impactAt));
      return abs(lerpPt(from, g.mat, e), lerp(from.rot, flatC, e), 1, -0.15 * e);
    }
    return onBack(p.impactAt, flatC);
  }
  const whipAt = p.whipAt!, ropeAt = p.ropeAt!, flingAt = p.flingAt!, landAt = p.landAt!;
  const held = { x: d.x + s * dR * 0.18, y: d.y };
  if (t < whipAt) {
    const e = easeInOutSine(win(t, p.gripAt, whipAt));
    return abs(lerpPt(d, held, e), s * 6 * e);
  }
  if (t < ropeAt) {
    // WHIPPED across the ring: running, leaning into it, legs going.
    const u = win(t, whipAt, ropeAt);
    const q = lerpPt(held, g.ropeHit, 0.35 * u + 0.65 * u * u);
    return abs({ x: q.x, y: q.y - dR * 0.09 * Math.abs(Math.sin(Math.PI * 4 * u)) }, s * 6 + s * 14 * Math.min(1, u * 4), 1, -0.08 * Math.min(1, u * 4));
  }
  if (t < flingAt) {
    // INTO THE ROPES: they stretch out with it, and it is narrowed against them.
    const u = win(t, ropeAt, flingAt);
    const k = ropeStretch(u);
    return abs(lerpPt(g.ropeHit, g.ropeMax, k), s * 16 * (1 - 2 * u), 1, -0.26 * Math.min(1, k));
  }
  if (t < p.impactAt) {
    // FLUNG BACK.
    const u = win(t, flingAt, p.impactAt);
    const q = lerpPt(g.ropeHit, g.meet, 1 - Math.pow(1 - u, 1.5));
    return abs({ x: q.x, y: q.y - dR * 0.06 * Math.abs(Math.sin(Math.PI * 2 * u)) }, -s * 16, 1, -0.1);
  }
  const flat = s * 90;
  if (t < landAt) {
    // CLOTHESLINED: its feet fly on, it flips flat in the air (absurdly high) and comes down on its back.
    const u = win(t, p.impactAt, landAt);
    const e = 1 - Math.pow(1 - u, 1.6);
    const turned = -s * 16 + (flat + s * 360 * Math.round(c.flipTurns) + s * 16) * e;
    return abs({ x: lerp(g.meet.x, g.mat.x, easeOutCubic(u)), y: lerp(g.meet.y, g.mat.y, u) - dR * 1.7 * 4 * u * (1 - u) }, turned, 1 + 0.1 * Math.sin(Math.PI * u), -0.12 * Math.sin(Math.PI * u));
  }
  return onBack(landAt, flat);
}

/** A portrait's whole path: at rest, the walk in (the striker), the move, then home with a little hop. */
function poseOf(x: WrestleCtx, t: number, slot: Pt, R: number, striker: boolean): WrestlePose {
  const { p, g, c } = x;
  if (p.reduced || t < p.chargeAt || t >= p.endAt) return { ...REST };
  const acting = striker ? strikerActing : victimActing;
  let q: Abs;
  if (t < p.walkAt) {
    // The striker gathers itself: a small crouch.
    q = abs(slot, 0, 1, striker ? c.squash * 0.7 * easeInOutSine(win(t, p.chargeAt, p.walkAt)) : 0);
  } else if (t < p.gripAt) {
    if (!striker) q = abs(slot);
    else {
      // THE WALK IN: a swaggering strut, rocking, a little bigger as it squares up.
      const u = win(t, p.walkAt, p.gripAt);
      const e = easeInOutSine(u);
      const at = lerpPt(slot, g.grab, e);
      q = abs({ x: at.x, y: at.y - R * 0.14 * Math.abs(Math.sin(Math.PI * 3 * u)) }, Math.sin(Math.PI * 6 * u) * 6, 1 + 0.04 * e, c.squash * 0.7 * (1 - Math.min(1, u * 5)) - 0.06 * Math.abs(Math.sin(Math.PI * 3 * u)));
    }
  } else if (t < p.homeAt) {
    q = acting(x, t);
  } else {
    // HOME: both get up and go back to their slots.
    const from = acting(x, p.homeAt - 0.001);
    const e = easeInOutSine(win(t, p.homeAt, p.homeEnd));
    const settle = t >= p.homeEnd ? c.squash * 0.4 * Math.max(0, spring(t - p.homeEnd, 4, 60)) : 0;
    q = abs(
      { x: lerp(from.x, slot.x, e), y: lerp(from.y, slot.y, e) - R * 0.22 * Math.sin(Math.PI * e) },
      from.rot * (1 - easeOutCubic(win(t, p.homeAt, p.homeEnd))), lerp(from.scale, 1, e), from.squash * (1 - e) + settle, lerp(from.flip, 1, e),
    );
  }
  return { x: q.x - slot.x, y: q.y - slot.y, rot: q.rot, scale: q.scale, squash: q.squash, flip: q.flip };
}

/** The STRIKING portrait at sequence time `t` (its slot is (0, 0)). Pure and deterministic. */
export function strikerPose(x: WrestleCtx, t: number): WrestlePose { return poseOf(x, t, x.a, x.aR, true); }

/** The STRUCK portrait at sequence time `t` (its slot is (0, 0)). Pure and deterministic. */
export function victimPose(x: WrestleCtx, t: number): WrestlePose { return poseOf(x, t, x.d, x.dR, false); }

// ─── the ring ropes (Tier 4, pure) ─────────────────────────────────────────────────────────────────────────────

/**
 * One side of the ring (near or far): its back and front CORNERS (their feet, screen px), how tall the pillar of light
 * at each stands, and which way is out. The back and front ropes run between the two sides' corners.
 */
export interface RingSide { out: 1 | -1; back: Pt; front: Pt; backH: number; frontH: number }

/**
 * Where the ring's four corners stand (near side first, then the far side): a floor seen in perspective, the back edge
 * narrower and up the screen (its ropes pass ABOVE the two portraits), the front edge wider and down it (its ropes pass
 * below them), so the ring frames the play area and nothing is drawn across a face. Pure.
 */
export function ringLayout(g: WrestleGeo, aR: number, dR: number): [RingSide, RingSide] {
  const Rm = (aR + dR) / 2;
  const side = (x: number, out: 1 | -1): RingSide => ({
    out,
    back: { x: x - out * g.ring.half * RING_SKEW, y: g.ring.cy - Rm * RING_BACK },
    front: { x: x + out * g.ring.half * RING_SKEW, y: g.ring.cy + Rm * RING_FRONT },
    backH: Rm * 1.5,
    frontH: Rm * 1.45,
  });
  return [side(g.ring.xNear, -g.s as 1 | -1), side(g.ring.xFar, g.s)];
}

/**
 * The ring: `rise` 0..1 (standing up, then away), how far each side's ropes are pushed OUT (screen px), and how far the
 * back and front ropes sag (`drop`, screen px, + = down) as the whole ring shudders under a landing.
 */
export interface RingState { visible: boolean; rise: number; alpha: number; near: number; far: number; drop: number }

/** The ring at sequence time `t`. Pure. */
export function wrestleRing(x: WrestleCtx, t: number): RingState {
  const { p, g, c, dR } = x;
  if (p.reduced || p.kind !== 'pin' || t < p.walkAt || t >= p.endAt) return { visible: false, rise: 0, alpha: 0, near: 0, far: 0, drop: 0 };
  const up = easeOutBack(win(t, p.walkAt, p.walkAt + 320), 1.4);
  const away = win(t, p.homeAt, p.homeAt + 260);
  const rise = up * (1 - easeIn(away));
  let far = 0, near = 0;
  const kick = (at: number | null, k: number): number => (at === null || t < at ? 0 : -dR * k * spring(t - at, 6, 150) * Math.sin(Math.min(Math.PI / 2, (t - at) / 30)));
  if (p.variant === 1) {
    const full = Math.abs(g.ropeMax.x - g.ropeHit.x);
    if (t >= p.ropeAt! && t < p.flingAt!) far = full * ropeStretch(win(t, p.ropeAt!, p.flingAt!));
    // Let go, they whip back past straight and ring down.
    else if (t >= p.flingAt!) far = -full * 0.45 * spring(t - p.flingAt!, 5.5, 190) * Math.sin(Math.min(Math.PI / 2, (t - p.flingAt!) / 30));
    // The near ropes kick as the struck portrait is thrown off them.
    near = kick(p.whipAt, 0.16);
  } else {
    // The cutter: the near ropes kick on the shove, the far ones as the striker runs out through them.
    near = kick(p.gripAt + 120, 0.14);
    far = -kick(p.exitAt! - 140, 0.4);
  }
  // The whole ring shudders under every landing: the body, the cover, and each slap of the mat.
  let drop = 0;
  const shudder = (at: number | null, k: number): void => {
    if (at === null || t < at) return;
    const w = dR * c.stretch * k * spring(t - at, 7, 150) * Math.sin(Math.min(Math.PI / 2, (t - at) / 24));
    drop += w; near += w * 0.5; far += w * 0.5;
  };
  shudder(p.variant === 2 ? p.impactAt : p.landAt, 0.3);
  shudder(p.pinAt, 0.16);
  for (const at of p.counts) shudder(at, 0.1);
  return { visible: rise > 0.004, rise, alpha: clamp01(up * 2) * (1 - away), near, far, drop };
}

// ─── the turnbuckle, the chair, the dizzy stars, the spotlight, the elbow, the shadow (pure) ─────────────────────────

/** Tier 3's turnbuckle: a pillar of light from the floor to the perch, rising as the striker starts to climb. */
export interface PostState { visible: boolean; x: number; foot: number; top: number; alpha: number }

export function wrestlePost(x: WrestleCtx, t: number): PostState {
  const { p, g, aR } = x;
  if (p.reduced || p.kind !== 'elbow' || t < p.downAt! - 120 || t >= p.impactAt + 300) return { visible: false, x: 0, foot: 0, top: 0, alpha: 0 };
  const up = easeOutBack(win(t, p.downAt! - 120, p.downAt! + 140), 1.5);
  const alpha = 1 - win(t, p.impactAt + 60, p.impactAt + 300);
  const topY = g.perch.y + aR * 0.85;
  return { visible: true, x: g.perch.x, foot: g.postFoot.y, top: lerp(g.postFoot.y, topY, up), alpha };
}

/** Tier 1's chair (variant 2): where it is (its middle, screen px), its turn, its size, and how far it has burst apart. */
export interface ChairState { visible: boolean; x: number; y: number; rot: number; size: number; burst: number; alpha: number }

export function wrestleChair(x: WrestleCtx, t: number): ChairState {
  const { p, g, c, a, d, aR, dR } = x;
  const hidden: ChairState = { visible: false, x: 0, y: 0, rot: 0, size: 0, burst: 0, alpha: 0 };
  if (p.reduced || p.kind !== 'chop' || p.variant !== 2 || t < p.gripAt || t >= p.impactAt + 480) return hidden;
  const s = g.s;
  const size = aR * 1.35 * c.chairSize;
  const sp = strikerPose(x, t);
  const body = { x: a.x + sp.x, y: a.y + sp.y };
  const chairAt = p.chairAt!, chopAt = p.chopAt!;
  const headroom = g.y0 + size * 0.55;
  const head = { x: d.x - s * dR * 0.1, y: Math.max(d.y - dR * 0.85, headroom) };
  if (t < chairAt) {
    // Up from under the ring in front of the striker, popping to full size.
    const u = win(t, p.gripAt, chairAt);
    const e = easeOutBack(u, 1.7);
    return { visible: true, x: body.x - s * aR * 0.8, y: body.y + aR * (1.3 - 1.05 * easeOutCubic(u)), rot: -s * 0.5 * (1 - u), size: size * clamp01(e), burst: 0, alpha: clamp01(u * 3) };
  }
  if (t < chopAt) {
    // Raised high overhead, tipped back.
    const e = easeOutCubic(win(t, chairAt, chopAt));
    const from = { x: body.x - s * aR * 0.8, y: body.y + aR * 0.25 }, to = { x: body.x + s * aR * 0.3, y: Math.max(body.y - aR * 1.45, headroom) };
    const q = lerpPt(from, to, e);
    return { visible: true, x: q.x, y: Math.max(headroom, q.y - aR * 0.3 * Math.sin(Math.PI * e)), rot: s * 0.7 * e, size, burst: 0, alpha: 1 };
  }
  if (t < p.impactAt) {
    // Brought down in an arc onto the struck portrait's head.
    const e = easeIn(win(t, chopAt, p.impactAt));
    const from = { x: body.x + s * aR * 0.3, y: Math.max(body.y - aR * 1.45, headroom) };
    const q = lerpPt(from, head, e);
    return { visible: true, x: q.x, y: Math.max(headroom, q.y - aR * 0.5 * Math.sin(Math.PI * e)), rot: s * 0.7 - s * 1.2 * e, size, burst: 0, alpha: 1 };
  }
  // It bursts apart into light.
  const age = t - p.impactAt;
  return { visible: true, x: head.x, y: head.y, rot: -s * 0.5, size, burst: easeOutCubic(age / 420), alpha: 1 - win(age, 120, 480) };
}

/** The dizzy stars circling the struck portrait's head (a ring of five turning round it). */
export interface DizzyState { visible: boolean; x: number; y: number; r: number; phase: number; alpha: number }

export function wrestleDizzy(x: WrestleCtx, t: number): DizzyState {
  const { p, d, dR } = x;
  const hidden: DizzyState = { visible: false, x: 0, y: 0, r: 0, phase: 0, alpha: 0 };
  if (p.reduced) return hidden;
  // When: after the hit until it gets up (the cutter: also all the while it staggers about before it).
  let from = p.impactAt + 60, to = p.homeAt;
  if (p.kind === 'pin') { from = p.variant === 2 ? p.gripAt + 260 : p.landAt! + 80; to = p.bellAt!; }
  if (p.kind === 'slam') from = p.impactAt + 120;
  const gapOut = p.kind === 'pin' && p.variant === 2 && t >= p.leapAt! && t < p.impactAt + 120;
  if (t < from || t >= to || gapOut) return hidden;
  const vp = victimPose(x, t);
  const up = Math.abs(Math.cos((vp.rot * Math.PI) / 180));
  const alpha = Math.min(win(t, from, from + 160), 1 - win(t, to - 200, to));
  return { visible: true, x: d.x + vp.x, y: d.y + vp.y - dR * (0.5 + 0.55 * up), r: dR * 0.62, phase: (t - from) * 0.0075, alpha };
}

/** Tier 3's spotlight: from a point on the top edge to where it points, at `alpha`. */
export interface SpotState { visible: boolean; fromX: number; fromY: number; toX: number; toY: number; alpha: number }

/** The spotlight: it snaps on the striker up on the turnbuckle for its taunt, then follows the leap down onto the mat. */
export function wrestleSpot(x: WrestleCtx, t: number, topY = 0): SpotState {
  const { p, g, c, aR } = x;
  if (p.reduced || p.kind !== 'elbow' || p.perchAt === null || t < p.perchAt - 80 || t >= p.impactAt + 160 || c.spot <= 0) return { visible: false, fromX: 0, fromY: 0, toX: 0, toY: 0, alpha: 0 };
  const on = win(t, p.perchAt - 80, p.perchAt + 60) * (1 - win(t, p.impactAt, p.impactAt + 160));
  const onPerch = { x: g.perch.x, y: g.perch.y + aR * 0.7 };
  const e = easeInOutSine(win(t, p.diveAt!, p.impactAt));
  const to = lerpPt(onPerch, g.mat, e);
  return { visible: on > 0.004, fromX: lerp(g.perch.x, g.mat.x, 0.5), fromY: topY, toX: to.x, toY: to.y, alpha: on * Math.min(1, c.spot) };
}

/** Tier 3's elbow star (variant 1), leading the way down. */
export interface ElbowState { visible: boolean; x: number; y: number; rot: number; scale: number }

export function wrestleElbow(x: WrestleCtx, t: number): ElbowState {
  const { p, aR } = x;
  if (p.reduced || p.kind !== 'elbow' || p.variant !== 1 || p.diveAt === null) return { visible: false, x: 0, y: 0, rot: 0, scale: 0 };
  const from = p.diveAt + (p.impactAt - p.diveAt) * 0.35;
  if (t < from || t >= p.impactAt) return { visible: false, x: 0, y: 0, rot: 0, scale: 0 };
  const at = leapAt(x, win(t, p.diveAt, p.impactAt));
  return { visible: true, x: at.x, y: at.y + aR * 1.05, rot: (t - p.diveAt) * 0.012, scale: 0.75 + 0.25 * Math.sin((t - p.diveAt) * 0.05) };
}

/** What is about to land casts a growing shadow on the mat: Tier 2 under the one held overhead, Tier 3 under the leap. */
export function wrestleShadow(x: WrestleCtx, t: number): { at: Pt; k: number } {
  const { p, g } = x;
  if (p.reduced) return { at: g.mat, k: 0 };
  if (p.kind === 'slam' && t >= p.liftAt! && t < p.impactAt) return { at: g.mat, k: 0.35 * easeInOutSine(win(t, p.liftAt!, p.topAt!)) + 0.65 * easeIn(win(t, p.slamAt!, p.impactAt)) };
  if (p.kind === 'elbow' && t >= p.diveAt! && t < p.impactAt) return { at: g.mat, k: (p.variant === 2 ? 1.25 : 1) * easeIn(win(t, p.diveAt!, p.impactAt)) };
  return { at: g.mat, k: 0 };
}

// ─── the camera (pure) ─────────────────────────────────────────────────────────────────────────────────────────

/**
 * The SHAKE and the PUNCH: punches in and shakes on the impact along the blow (`dir`: sideways for the chop and the
 * clothesline, straight down for the slams), and jolts on the ticks (the ropes, a landing, each hop, each slap of the
 * mat). `zoom` here is only the punch; the framing (the zooms and pans) is `wrestleShots` / `wrestleView`. Pure.
 */
export function wrestleCameraAt(p: WrestlePlan, c: HeroWrestleConfig, t: number, dir: Pt): { zoom: number; x: number; y: number } {
  if (p.reduced) return { zoom: 1, x: 0, y: 0 };
  let z = 0;
  let x = 0, y = 0;
  const tau = Math.max(1, c.shakeMs / 4);
  for (const j of p.jolts) {
    if (t < j.at || t > j.at + 400) continue;
    const sh = spring(t - j.at, 14, 55) * p.shakePx * j.k;
    if (j.vertical) y += sh; else x += dir.x >= 0 ? sh : -sh;
    z += p.punch * 0.35 * j.k * Math.exp(-(t - j.at) / 60);
  }
  if (t >= p.impactAt) {
    const age = t - p.impactAt;
    z += p.punch * Math.exp(-age / tau);
    const sh = spring(age, 15, tau) * p.shakePx;
    x += dir.x * sh; y += dir.y * sh;
    if (p.kind !== 'chop' || p.variant === 2) {
      const r = p.shakePx * 0.35 * Math.exp(-age / (tau * 2));
      x += Math.sin(age * 0.137) * r; y += Math.cos(age * 0.101) * r;
    }
  }
  return { zoom: 1 + z, x, y };
}

/** One framing of the camera: from `at`, over `ms`, it moves to look at `look` (screen px) at `zoom`, panned `pan` 0..1. */
export interface WrestleShot { at: number; ms: number; look: Pt; zoom: number; pan: number }

/**
 * THE FRAMING, per move (owner 2026-11-13: "camera zooms and pans and shakes"): zoom in on the wind-up, tilt up with the
 * lift, whip-pan after a throw, creep in on the dazed one while the voice yells, and back out to rest as both go home.
 * Each shot eases in over its `ms` (a whip-pan is a short one). Built ONCE per attack (the runner keeps the list). Pure.
 */
export function wrestleShots(x: WrestleCtx): WrestleShot[] {
  const { p, g, a, d, aR } = x;
  if (p.reduced) return [];
  const Z = p.zoom;
  const mid = (q: Pt, r: Pt, k = 0.5): Pt => lerpPt(q, r, k);
  const out: WrestleShot[] = [];
  const shot = (at: number, ms: number, look: Pt, zoom: number, pan = 1): void => { out.push({ at, ms: Math.max(1, ms), look, zoom: 1 + zoom, pan }); };
  // Every move: it follows the walk in, a little pushed in.
  shot(p.walkAt, p.gripAt - p.walkAt, mid(a, d, 0.7), Z * 0.25, 0.4);
  if (p.kind === 'chop') {
    if (p.variant === 2) {
      shot(p.gripAt, p.chairAt! - p.gripAt, mid(g.grab, d), Z * 0.5);
      // The chair goes up: tilt up after it and push in.
      shot(p.chairAt!, p.chopAt! - p.chairAt!, { x: lerp(g.grab.x, d.x, 0.5), y: d.y - aR * 0.7 }, Z);
    } else {
      // The wind-up: a slow push in.
      shot(p.gripAt, p.chopAt! - p.gripAt, mid(g.grab, d), Z);
    }
    // After the hit, it follows the one spinning (or wobbling) away.
    shot(p.impactAt + 140, 260, p.variant === 2 ? d : g.stagger, Z * 0.75);
  } else if (p.kind === 'slam') {
    shot(p.gripAt, p.liftAt! - p.gripAt, mid(g.grab, d), Z * 0.5);
    // Tilt up with the lift and push in on the held beat.
    shot(p.liftAt!, p.topAt! - p.liftAt!, mid(g.top, g.stand, 0.35), Z * 0.8);
    shot(p.topAt!, p.slamAt! - p.topAt!, mid(g.top, g.stand, 0.35), Z);
    // Whip down with the slam.
    shot(p.slamAt!, Math.max(60, p.impactAt - p.slamAt!), mid(g.mat, g.stand, 0.3), Z);
    shot(p.impactAt + 500, 500, mid(g.mat, g.stand, 0.4), Z * 0.6);
  } else if (p.kind === 'elbow') {
    shot(p.gripAt, p.downAt! - p.gripAt, mid(g.grab, d), Z * 0.5);
    // Pan up with the climb, then in close on the taunt.
    shot(p.downAt!, p.perchAt! - p.downAt!, mid(g.perch, g.mat, 0.4), Z * 0.6);
    shot(p.perchAt!, 320, { x: g.perch.x, y: g.perch.y + aR * 0.3 }, Z * 1.15);
    // Whip with the leap down onto the mat.
    shot(p.diveAt!, p.impactAt - p.diveAt!, mid(g.mat, g.perch, 0.25), Z * 0.8);
    shot(p.impactAt + 400, 500, g.mat, Z * 0.6);
  } else if (p.variant === 2) {
    // THE CUTTER.
    shot(p.gripAt, 200, mid(g.grab, d), Z * 0.5);
    // Follow it reeling into the ring...
    shot(p.gripAt + 200, p.exitAt! - p.gripAt, g.daze, Z * 0.6);
    // ...and creep in on it, dazed, while the voice yells.
    shot(p.voiceAt!, p.leapAt! - 120 - p.voiceAt!, { x: g.daze.x, y: g.daze.y - aR * 0.2 }, Z * 1.35);
    // WHIP-PAN to the edge it comes flying in from.
    shot(p.leapAt! - 120, 150, { x: lerp(g.daze.x, g.entry.x, 0.42), y: lerp(g.daze.y, g.entry.y, 0.3) }, Z * 0.9);
    // And back with it onto the mat.
    shot(p.catchAt! - 40, Math.max(60, p.impactAt - p.catchAt! + 40), g.mat, Z * 1.1);
    shot(p.coverAt!, p.pinAt! - p.coverAt!, mid(g.mat, g.count, 0.6), Z * 0.8);
    shot(p.bellAt!, 360, mid(g.win, g.count), Z * 0.5);
  } else {
    // THE CLOTHESLINE.
    shot(p.gripAt, p.whipAt! - p.gripAt, mid(g.grab, d), Z * 0.5);
    // Whip-pan after the throw to the far ropes, push in while they hold it.
    shot(p.whipAt!, (p.ropeAt! - p.whipAt!) * 0.8, mid(g.ropeHit, g.block, 0.3), Z * 0.8);
    shot(p.ropeAt!, p.flingAt! - p.ropeAt!, mid(g.ropeMax, g.block, 0.3), Z);
    // Whip back with it into the clothesline, and follow the flip down.
    shot(p.flingAt!, Math.max(60, p.impactAt - p.flingAt!), mid(g.meet, g.block), Z * 0.9);
    shot(p.impactAt + 60, Math.max(60, p.landAt! - p.impactAt - 60), mid(g.mat, g.meet), Z * 0.8);
    shot(p.coverAt!, p.pinAt! - p.coverAt!, mid(g.mat, g.count, 0.6), Z * 0.8);
    shot(p.bellAt!, 360, mid(g.win, g.count), Z * 0.5);
  }
  // Home: back to rest.
  out.push({ at: p.homeAt, ms: Math.max(60, p.homeEnd - p.homeAt), look: d, zoom: 1, pan: 0 });
  return out;
}

/** Where the camera is at `t` from the shots (zoom, look point, pan), eased between them. Allocation-free. Pure. */
export function wrestleView(shots: readonly WrestleShot[], t: number, rest: Pt): { zoom: number; lx: number; ly: number; pan: number } {
  let z = 1, lx = rest.x, ly = rest.y, pan = 0;
  for (let i = 0; i < shots.length; i++) {
    const s = shots[i]!;
    if (t < s.at) break;
    const e = easeInOutSine(clamp01((t - s.at) / s.ms));
    z = lerp(z, s.zoom, e); lx = lerp(lx, s.look.x, e); ly = lerp(ly, s.look.y, e); pan = lerp(pan, s.pan, e);
  }
  return { zoom: z, lx, ly, pan };
}

/**
 * The camera's screen transform: zoomed `zoom` about `look`, panned `pan` of the way to bring `look` to the middle of
 * the frame, CLAMPED so the board never shows an edge (a pan only ever moves within the zoomed-in margin). Returns the
 * translate (screen px) for `translate(ax, ay) scale(zoom)` about the screen's top left. Pure.
 */
export function wrestleFrameTransform(zoom: number, lx: number, ly: number, pan: number, frame: Frame, kPan: number): { ax: number; ay: number } {
  const z = Math.max(1, zoom);
  const W = frame.x1 - frame.x0, H = frame.y1 - frame.y0;
  const cx = frame.x0 + W / 2, cy = frame.y0 + H / 2;
  const k = clamp01(pan * kPan);
  const ax = lerp(lx * (1 - z), cx - lx * z, k), ay = lerp(ly * (1 - z), cy - ly * z, k);
  // The zoomed board covers [ax + x0*z, ax + x1*z]: keep it over the whole frame.
  return { ax: clamp(ax, frame.x1 - frame.x1 * z, frame.x0 - frame.x0 * z), ay: clamp(ay, frame.y1 - frame.y1 * z, frame.y0 - frame.y0 * z) };
}
