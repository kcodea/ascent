/**
 * THE WRESTLING HERO ATTACK ("Top Rope", a Legendary with four tiers): its tuned values, its pure timeline, the pure
 * geometry, the pure poses of BOTH portraits, the ring ropes, the spotlight, the camera.
 *
 * THE SIGNATURE: the two portraits WRESTLE EACH OTHER. The striking portrait walks over, takes hold of the struck one and
 * throws it about: a chop, a lift and a slam, an elbow dropped from the top of the screen, and a full finisher inside
 * ring ropes that ends in a pin and a three count. No other attack has grapples, a ring or a pin.
 *
 * FOUR TIERS on the shared thresholds (`attackTier`: a knockout always plays IV):
 *  - I THE CHOP: the striker strides up beside the struck portrait, leans away as it winds an arm back, and delivers a
 *    flat knife-edge CHOP (THE impact): a wide slap arc, a red hand print on the struck portrait, which staggers a step.
 *    The crowd goes "WOO".
 *  - II THE BODY SLAM: it closes in, dips UNDER the struck portrait, LIFTS it overhead (tilted flat, a held beat at the
 *    top) and SLAMS it to the mat (THE impact): a ring of canvas dust, the frame shakes, the struck portrait bounces once.
 *  - III THE ELBOW DROP: a quick shove leaves the struck portrait flat on its back. The striker climbs out of the TOP of
 *    the screen; a spotlight swings round and finds the one on the mat; then it drops in a flat dive, an elbow star
 *    leading, and lands on it (THE impact).
 *  - IV THE FINISHER: a RING OF LIGHT stands up round the two of them: a lit square of canvas, a pillar of light at each
 *    corner and three ropes of light (red, white, blue) on EVERY side. The striker IRISH WHIPS the struck portrait across
 *    the ring into the far ropes, which stretch a long way out, hold, and fling it back into a CLOTHESLINE (THE impact:
 *    it flips high in the air and lands on its back with a second, heavy hit). A beat over the body, then the striker
 *    leaps and drops on top for the PIN: 1, 2, 3 slam down LARGE with a slap of the mat and a shake each, the bell rings,
 *    WINNER, the ring goes away and both go home.
 *
 * WEIGHT (the second pass, owner 2026-11-12: "they are quick and not impactful"): every big move is HELD, then FAST, then
 * HEAVY. A real held beat at the top (II's lift, III's perch, IV's ropes at full stretch), a short drop, and a hit that
 * shakes the frame hard, flashes, throws a wide shock ring and dust that hangs in the air, flattens the struck portrait
 * and bounces it; then a moment of aftermath (the striker flexes over the body) before anything else happens.
 *
 * THE CONTRACT: the blow lands exactly ONCE, on the impact (the chop, the slam, the elbow, the clothesline). The shove,
 * the ropes, the landing, the count and the bell are TICKS (no damage). Both portraits are restored exactly on every
 * exit path (the runner owns that). No hit-stop and no slow motion: the one clock never changes speed.
 *
 * WHERE IT HAPPENS: the striker always stands BESIDE the struck portrait (on the side it came from when there is room),
 * and every lift, slam and fall is in screen up and down, so a wrestling move reads whichever corner the two heroes are
 * in. Every spot is pulled in off the screen's edges. The one deliberate exception is III: the striker leaves through the
 * top of the screen for a beat before it drops.
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

export const WRESTLE_TIER_SUFFIXES = ['ReadyMs', 'WalkMs', 'HoldMs', 'ReturnMs', 'Knock', 'Zoom', 'Punch', 'Shake', 'Burst', 'Rings', 'Dim'] as const;
export type WrestleTierSuffix = (typeof WRESTLE_TIER_SUFFIXES)[number];
type TierKey = `t${TierNum}${WrestleTierSuffix}`;

interface GlobalConfig {
  tier2At: number; tier3At: number; tier4At: number;
  absorbMs: number;
  /** How close the two stand, as a fraction of their two radii added together. */
  gap: number;
  // I: the chop
  chopWindMs: number;
  chopMs: number;
  chopLean: number;
  stagger: number;
  // II: the body slam
  dipMs: number;
  liftMs: number;
  hangMs: number;
  slamMs: number;
  liftHeight: number;
  bounceMs: number;
  bounce: number;
  // III: the elbow drop
  shoveMs: number;
  climbMs: number;
  perchMs: number;
  diveMs: number;
  spot: number;
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
  coverMs: number;
  countMs: number;
  winMs: number;
  wordSize: number;
  squash: number;
  /** How bright the whole-frame flash on a big hit is (0 = none). */
  flash: number;
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
  sfxDuck: number;
  previewDamage: number;
  previewParts: number;
}
export type HeroWrestleConfig = GlobalConfig & Record<TierKey, number>;

export const HERO_WRESTLE_COLOR_KEYS = ['colorMat', 'colorFlash', 'colorPow', 'colorHand', 'colorSpot', 'colorPlayer', 'colorFoe'] as const;
export const HERO_WRESTLE_CLIP_KEYS = ['sfxWhooshClip', 'sfxChopClip', 'sfxSlamClip', 'sfxBoomClip', 'sfxBellClip', 'sfxWooClip', 'sfxCheerClip', 'sfxThudClip', 'sfxRopeClip', 'sfxSlapClip', 'sfxRoarClip', 'sfxOohClip'] as const;
export type HeroWrestleStrKey = (typeof HERO_WRESTLE_COLOR_KEYS)[number] | (typeof HERO_WRESTLE_CLIP_KEYS)[number];
export type HeroWrestleNumKey = Exclude<keyof HeroWrestleConfig, HeroWrestleStrKey>;

/** Per tier: [I, II, III, IV]. A dial a tier's move does not use is ignored there (the tuner says which). */
const TIER_DEFAULTS: Record<WrestleTierSuffix, [number, number, number, number]> = {
  ReadyMs: [80, 80, 80, 80],
  WalkMs: [300, 320, 320, 340],
  HoldMs: [420, 950, 1050, 0],
  ReturnMs: [300, 380, 420, 440],
  Knock: [0.8, 1, 1, 1.2],
  Zoom: [0.02, 0.035, 0.045, 0.055],
  Punch: [0.012, 0.035, 0.06, 0.07],
  Shake: [3, 16, 26, 30],
  Burst: [0.8, 1.3, 1.8, 1.9],
  Rings: [1, 2, 3, 3],
  Dim: [0.1, 0.18, 0.26, 0.3],
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
  absorbMs: 180,
  gap: 0.86,
  chopWindMs: 240,
  chopMs: 100,
  chopLean: 20,
  stagger: 0.5,
  dipMs: 200,
  liftMs: 340,
  hangMs: 520,
  slamMs: 130,
  liftHeight: 0.9,
  bounceMs: 340,
  bounce: 0.5,
  shoveMs: 260,
  climbMs: 400,
  perchMs: 800,
  diveMs: 220,
  spot: 1,
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
  coverMs: 360,
  countMs: 400,
  winMs: 950,
  wordSize: 1,
  squash: 0.14,
  flash: 0.5,
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
  sfxBoomClip: 'fx/heavy-rock-impact', sfxBoomGain: 0.35, sfxBoomRate: 1.1,
  sfxBellClip: 'fx/wrestle-bell', sfxBellGain: 1, sfxBellRate: 1,
  sfxWooClip: 'fx/wrestle-woo', sfxWooGain: 0.7, sfxWooRate: 1,
  sfxCheerClip: 'fx/cheering', sfxCheerGain: 0.5, sfxCheerRate: 1,
  sfxThudClip: 'fx/wrestle-thud', sfxThudGain: 1.05, sfxThudRate: 1,
  sfxRopeClip: 'fx/wrestle-rope', sfxRopeGain: 1.25, sfxRopeRate: 1,
  sfxSlapClip: 'fx/wrestle-slap', sfxSlapGain: 0.9, sfxSlapRate: 1,
  sfxRoarClip: 'fx/wrestle-roar', sfxRoarGain: 1.4, sfxRoarRate: 1,
  sfxOohClip: 'fx/soccer-crowd-ooh', sfxOohGain: 0.85, sfxOohRate: 1,
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
  dipMs: [60, 800, 10],
  liftMs: [100, 1200, 10],
  hangMs: [0, 1500, 10],
  slamMs: [60, 800, 10],
  liftHeight: [0.5, 1.4, 0.01],
  bounceMs: [60, 1000, 10],
  bounce: [0, 1.5, 0.01],
  shoveMs: [80, 800, 10],
  climbMs: [120, 1500, 10],
  perchMs: [0, 2000, 10],
  diveMs: [100, 1200, 10],
  spot: [0, 2, 0.05],
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
  coverMs: [100, 1000, 10],
  countMs: [140, 1000, 10],
  winMs: [200, 2000, 10],
  wordSize: [0, 2.5, 0.05],
  squash: [0, 0.4, 0.01],
  flash: [0, 1, 0.05],
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
  key: 'ascent.herowrestle.v2', defaults: HERO_WRESTLE_DEFAULTS, ranges: HERO_WRESTLE_RANGES,
  colorKeys: HERO_WRESTLE_COLOR_KEYS, clipKeys: HERO_WRESTLE_CLIP_KEYS, previewKeys: ['previewDamage', 'previewParts'],
});
export const heroWrestleStore = store;
export const getHeroWrestleConfig = store.get;
export const clampHeroWrestleValue = store.clamp;
export const sanitizeHeroWrestleConfig = store.sanitize;
export const heroWrestleConfigJson = store.json;
/** The preview speed hook (Recruit + the Collection read one per style). Always 1: the tuner has no speed buttons. */
export function heroWrestlePreviewSpeed(): number { return 1; }

export function wrestleTierDials(tier: TierNum, c: HeroWrestleConfig = store.get()): Record<WrestleTierSuffix, number> {
  return Object.fromEntries(WRESTLE_TIER_SUFFIXES.map((s) => [s, c[`t${tier}${s}`]])) as Record<WrestleTierSuffix, number>;
}

// ─── the pure plan ─────────────────────────────────────────────────────────────────────────────────────────────

export interface WrestlePlanInput extends AttackTierContext {
  leadIn?: number;
  total: number;
  reduced?: boolean;
}

/** A small jolt of the view on a tick (the ropes, a landing, a slap of the mat): `k` of the tier's shake. */
export interface WrestleJolt { at: number; k: number; vertical: boolean }

export interface WrestlePlan {
  reduced: boolean;
  tier: TierNum;
  kind: WrestleKind;
  k: number;
  total: number;
  chargeAt: number;
  absorbEnd: number;
  /** The striker sets off, and arrives beside the struck portrait. */
  walkAt: number;
  gripAt: number;
  /** I: the arm comes through (the wind-up runs from `gripAt` to here). */
  chopAt: number | null;
  /** II: the lift starts (the dip runs from `gripAt` to here), the top of the lift, the slam starts, the bounce ends. */
  liftAt: number | null;
  topAt: number | null;
  slamAt: number | null;
  bounceEnd: number | null;
  /** III: the shoved portrait hits the mat (the striker starts to climb), the striker is out of the top, the dive. */
  downAt: number | null;
  perchAt: number | null;
  diveAt: number | null;
  /** IV: the whip, the far ropes (contact), flung back off them, landing on its back, the cover, the count, the bell. */
  whipAt: number | null;
  ropeAt: number | null;
  flingAt: number | null;
  landAt: number | null;
  /** IV: the striker leaps for the cover (after the beat over the body). */
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
  const tier = attackTier(total, input, c); // a knockout always plays the shared Tier IV
  const kind = wrestleKind(tier);
  const L = wrestleTierDials(tier, c);
  const looks = {
    tier, kind, k: (tier - 1) / 3, total, knock: L.Knock, zoom: L.Zoom, punch: L.Punch, shakePx: clamp(L.Shake, 0, WRESTLE_CAPS.shakePx),
    burst: L.Burst, rings: Math.round(L.Rings), dim: L.Dim,
  };
  const none = {
    chopAt: null, liftAt: null, topAt: null, slamAt: null, bounceEnd: null, downAt: null, perchAt: null, diveAt: null,
    whipAt: null, ropeAt: null, flingAt: null, landAt: null, coverAt: null, pinAt: null, counts: [] as number[], bellAt: null, jolts: [] as WrestleJolt[],
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
    const chopAt = gripAt + c.chopWindMs;
    const impactAt = chopAt + Math.max(40, c.chopMs);
    return { ...base, chopAt, ...tail(impactAt, impactAt + L.HoldMs) };
  }
  if (kind === 'slam') {
    const liftAt = gripAt + c.dipMs;
    const topAt = liftAt + c.liftMs;
    const slamAt = topAt + c.hangMs;
    const impactAt = slamAt + Math.max(60, c.slamMs);
    const bounceEnd = impactAt + c.bounceMs;
    return { ...base, liftAt, topAt, slamAt, bounceEnd, jolts: [{ at: bounceEnd, k: 0.3, vertical: true }], ...tail(impactAt, Math.max(bounceEnd + 80, impactAt + L.HoldMs)) };
  }
  if (kind === 'elbow') {
    const downAt = gripAt + c.shoveMs;
    const perchAt = downAt + c.climbMs;
    const diveAt = perchAt + c.perchMs;
    const impactAt = diveAt + Math.max(100, c.diveMs);
    // The elbow bounces both of them off the mat once (a tick).
    const bounceEnd = impactAt + c.bounceMs;
    return { ...base, downAt, perchAt, diveAt, bounceEnd, jolts: [{ at: downAt, k: 0.3, vertical: true }, { at: bounceEnd, k: 0.25, vertical: true }], ...tail(impactAt, Math.max(bounceEnd + 80, impactAt + L.HoldMs)) };
  }
  // IV: THE FINISHER.
  const whipAt = gripAt + c.grabMs;
  const ropeAt = whipAt + c.whipMs;
  const flingAt = ropeAt + c.stretchMs;
  const impactAt = flingAt + c.reboundMs;
  const landAt = impactAt + c.flipMs;
  const coverAt = landAt + Math.max(0, c.afterMs);
  const pinAt = coverAt + c.coverMs;
  const counts = [0, 1, 2].map((i) => pinAt + 200 + i * c.countMs);
  const bellAt = counts[2]! + c.countMs * 0.9;
  // The ticks that shake the frame: the ropes, the landing (a second heavy hit), the cover, and each count harder.
  const jolts: WrestleJolt[] = [
    { at: ropeAt, k: 0.25, vertical: false }, { at: landAt, k: 0.75, vertical: true }, { at: pinAt, k: 0.45, vertical: true },
    ...counts.map((at, i) => ({ at, k: 0.34 + 0.08 * i, vertical: true })),
  ];
  return { ...base, whipAt, ropeAt, flingAt, landAt, coverAt, pinAt, counts, bellAt, jolts, ...tail(impactAt, bellAt + c.winMs) };
}

export type WrestleCueKind =
  | 'charge' | 'walk' | 'grip' | 'swing' | 'lift' | 'top' | 'drop' | 'bounce' | 'down' | 'perch' | 'dive' | 'whip' | 'rope' | 'fling' | 'land'
  | 'hop' | 'cover' | 'count' | 'bell' | 'impact' | 'home' | 'end';
export interface WrestleCue { at: number; kind: WrestleCueKind; i: number }

/** Every beat the runner fires, in time order. The blow lands on `impact`, once. */
export function wrestleCues(p: WrestlePlan): WrestleCue[] {
  const out: WrestleCue[] = [];
  const add = (at: number | null, kind: WrestleCueKind, i = 0): void => { if (at !== null) out.push({ at, kind, i }); };
  if (!p.reduced) {
    add(p.chargeAt, 'charge');
    add(p.walkAt, 'walk');
    add(p.gripAt, 'grip');
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
    add(p.coverAt, 'hop');
    add(p.pinAt, 'cover');
    p.counts.forEach((at, i) => add(at, 'count', i));
    add(p.bellAt, 'bell');
    add(p.homeAt, 'home');
  }
  add(p.impactAt, 'impact');
  add(p.endAt, 'end');
  const order: Record<WrestleCueKind, number> = {
    charge: 0, walk: 1, grip: 2, swing: 3, lift: 4, top: 5, drop: 6, down: 7, perch: 8, dive: 9, whip: 10, rope: 11, fling: 12, impact: 13, bounce: 14,
    land: 15, hop: 16, cover: 17, count: 18, bell: 19, home: 20, end: 21,
  };
  return out.sort((a, b) => a.at - b.at || order[a.kind] - order[b.kind]);
}

// ─── the geometry (pure) ───────────────────────────────────────────────────────────────────────────────────────

export interface Frame { x0: number; y0: number; x1: number; y1: number }

/** IV's ring: its centre line, its half width, and the near (the struck slot's side) and far rope lines. */
export interface WrestleRingGeo { cx: number; cy: number; half: number; xNear: number; xFar: number }

export interface WrestleGeo {
  /** Unit, striker -> struck, and the distance (the camera and the reduced look). */
  u: Pt;
  dist: number;
  /** Which side of the struck portrait the striker stands on: +1 = to its right (screen +x). */
  s: 1 | -1;
  /** Every point below is SCREEN px. Where the striker stands to take hold (beside the struck slot). */
  grab: Pt;
  /** I: how far the chop staggers the struck portrait. */
  stagger: Pt;
  /** II: the dip (half under the struck portrait), where the striker stands for the lift, the top of the lift. */
  under: Pt;
  stand: Pt;
  top: Pt;
  /** II-IV: where the struck portrait ends up flat on the mat. */
  mat: Pt;
  /** III: where the striker leaves the top of the screen, and where it drops from (straight above the mat). */
  exit: Pt;
  sky: Pt;
  /** III and IV: the striker on top of the one on the mat. */
  cover: Pt;
  /** IV: the ring; the struck portrait meeting the far ropes and at their fullest stretch; the striker braced for the
   *  clothesline and where the two meet; the winner's spot; where the count's numbers slam down. */
  ring: WrestleRingGeo;
  ropeHit: Pt;
  ropeMax: Pt;
  block: Pt;
  meet: Pt;
  win: Pt;
  count: Pt;
}

/** IV's ring, in portrait radii from its centre line: how far up the screen the back corners stand, how far down the
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

/** Where every move goes, from the two heroes, the frame and the move (screen px). Pure. */
export function wrestleGeo(a: Pt, d: Pt, aR: number, dR: number, frame: Frame | null, kind: WrestleKind, c: HeroWrestleConfig = store.get()): WrestleGeo {
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
  const blank = { under: grab, stand: grab, top: zero, mat: zero, exit: grab, sky: grab, cover: grab, ring: noRing, ropeHit: zero, ropeMax: zero, block: grab, meet: zero, win: grab, count: zero };
  if (kind === 'chop') return { u, dist, s, grab, stagger, ...blank };
  if (kind === 'slam') {
    // The lift needs headroom: the mat is pulled down far enough that the one held overhead stays on screen, and in off
    // the side so the slam lands in the open, clear of a corner.
    const liftH = (aR + dR) * c.liftHeight;
    const mat = clampXY({ x: d.x - s * dR * 0.1, y: d.y + dR * 0.15 }, frame, dR * 2.6, liftH + dR * 1.5, dR * 0.85);
    const stand = clampToFrame({ x: mat.x + s * gap * 0.95, y: mat.y - dR * 0.15 }, frame, edge);
    const under = clampToFrame({ x: lerp(d.x, grab.x, 0.45), y: d.y + aR * 0.3 }, frame, edge);
    const top = { x: stand.x - s * aR * 0.1, y: stand.y - liftH };
    return { u, dist, s, grab, stagger, ...blank, under, stand, top, mat, cover: stand };
  }
  if (kind === 'elbow') {
    // The mat is pulled well down from the top (the drop needs a fall worth watching) and in off the side.
    const mat = clampXY({ x: d.x - s * dR * 0.4, y: d.y + dR * 0.3 }, frame, dR * 2.6, Rm * 3.6, dR * 0.8);
    const topY = (frame ? frame.y0 : Math.min(a.y, d.y) - dist) - aR * 1.4;
    const exit = { x: lerp(grab.x, mat.x, 0.5), y: topY };
    const sky = { x: mat.x, y: topY };
    const cover = { x: mat.x, y: mat.y - dR * 0.3 };
    return { u, dist, s, grab, stagger, ...blank, mat, exit, sky, cover };
  }
  // IV: THE RING. The struck slot sits just inside the near ropes; the whip goes PAST the striker to the far ropes.
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
  const mat = clampXY({ x: meet.x + s * dR * 0.2, y: ring.cy + dR * 0.3 }, frame, dR, dR, dR * 0.8);
  const cover = { x: mat.x - s * dR * 0.3, y: mat.y - dR * 0.45 };
  const win = clampToFrame({ x: cover.x - s * aR * 0.35, y: mat.y - aR * 0.85 }, frame, edge);
  const count = clampXY({ x: mat.x + s * dR * 0.25, y: cover.y - aR * 2.05 }, frame, dR * 1.2, Rm * 1.3, Rm);
  return { u, dist, s, grab, stagger, ...blank, mat, cover, ring, ropeHit, ropeMax, block, meet, win, count };
}

// ─── the poses (pure) ──────────────────────────────────────────────────────────────────────────────────────────

/**
 * A portrait's offset from its slot (screen px), its rotation (degrees: positive tips its top toward screen +x), its
 * scale and a squash in SCREEN axes (+ = flattened and wider, - = taller and narrower), so a portrait lying on its back
 * still flattens against the mat.
 */
export interface WrestlePose { x: number; y: number; rot: number; scale: number; squash: number }
const REST: WrestlePose = { x: 0, y: 0, rot: 0, scale: 1, squash: 0 };

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
 * IV: how far the far ropes are stretched while the struck portrait is in them (`u` 0..1 of the beat), 0..1: OUT fast,
 * HELD at full stretch (creaking, a small tremble), then SNAPPED back. The portrait and the ropes read the same curve.
 */
export function ropeStretch(u: number): number {
  const x = clamp01(u);
  if (x < 0.34) return easeOutCubic(x / 0.34);
  if (x < 0.74) return 1 + 0.035 * Math.sin((x - 0.34) * 38);
  return 1 - easeIn((x - 0.74) / 0.26);
}

/** An absolute pose (a screen point), before it is made an offset from the slot. */
interface Abs { x: number; y: number; rot: number; scale: number; squash: number }
const abs = (pt: Pt, rot = 0, scale = 1, squash = 0): Abs => ({ x: pt.x, y: pt.y, rot, scale, squash });

/** The STRIKER while it is acting (from `gripAt` until it heads home). */
function strikerActing(x: WrestleCtx, t: number): Abs {
  const { p, g, c, aR, dR } = x;
  const s = g.s;
  if (p.kind === 'chop') {
    const chopAt = p.chopAt!;
    if (t < chopAt) {
      // THE WIND-UP: it leans away, the arm drawn back.
      const w = easeInOutSine(win(t, p.gripAt, chopAt));
      return abs({ x: g.grab.x + s * aR * 0.2 * w, y: g.grab.y }, s * c.chopLean * w, 1 + 0.04 * w);
    }
    if (t < p.impactAt) {
      const e = easeIn(win(t, chopAt, p.impactAt));
      return abs({ x: g.grab.x + s * aR * (0.2 - 0.5 * e), y: g.grab.y }, s * c.chopLean - s * (c.chopLean + 14) * e, 1.04);
    }
    const age = t - p.impactAt;
    const back = easeOutCubic(age / 260);
    return abs({ x: g.grab.x - s * aR * 0.3 * (1 - 0.7 * back), y: g.grab.y }, -s * 14 * (1 - back), 1.04 - 0.04 * back, c.squash * 0.5 * Math.max(0, spring(age, 5, 70)));
  }
  if (p.kind === 'slam') {
    const liftAt = p.liftAt!, topAt = p.topAt!, slamAt = p.slamAt!;
    if (t < liftAt) {
      // THE DIP: down and in, half under the one it is about to lift.
      const e = easeInOutSine(win(t, p.gripAt, liftAt));
      const q = lerpPt(g.grab, g.under, e);
      return abs(q, -s * 8 * e, 1, 0.2 * e);
    }
    if (t < topAt) {
      const u = win(t, liftAt, topAt);
      const q = lerpPt(g.under, g.stand, easeOutCubic(u));
      return abs(q, -s * 8 * (1 - u), 1 + 0.04 * u, 0.2 * (1 - easeOutCubic(u)) - 0.07 * Math.sin(Math.PI * u));
    }
    if (t < slamAt) {
      // THE HELD BEAT: straining under the weight.
      // ...and heaving it a last notch higher just before the drop.
      const hoist = easeInOutSine(win(t, slamAt - 170, slamAt));
      return abs({ x: g.stand.x + jit(t, 0.09, 0.4) * aR * 0.02, y: g.stand.y + jit(t, 0.11, 1.3) * aR * 0.014 }, 0, 1.04, -0.03 - 0.06 * hoist);
    }
    const down = { x: g.stand.x - s * aR * 0.14, y: g.stand.y + aR * 0.16 };
    if (t < p.impactAt) {
      const e = easeIn(win(t, slamAt, p.impactAt));
      return abs(lerpPt(g.stand, down, e), -s * 18 * e, 1.04, 0.1 * e);
    }
    const age = t - p.impactAt;
    const up = easeOutCubic(age / 320);
    // THE AFTERMATH: it straightens up over the body and flexes.
    const q = lerpPt(down, g.stand, up);
    return abs({ x: q.x, y: q.y - aR * 0.2 * flexHop(age, 420) }, -s * 18 * (1 - up), 1.04 - 0.04 * up + 0.08 * win(age, 400, 540), 0.1 * (1 - up) + c.squash * 0.6 * Math.max(0, spring(age, 5, 80)));
  }
  if (p.kind === 'elbow') {
    const downAt = p.downAt!, perchAt = p.perchAt!, diveAt = p.diveAt!;
    if (t < downAt) {
      // THE SHOVE: a quick lunge in and back.
      const u = win(t, p.gripAt, downAt);
      const push = u < 0.35 ? easeOutCubic(u / 0.35) : 1 - easeInOutSine((u - 0.35) / 0.65);
      return abs({ x: g.grab.x - s * aR * 0.35 * push, y: g.grab.y }, -s * 12 * push, 1);
    }
    if (t < perchAt) {
      // THE CLIMB: a crouch, then up and out of the top of the screen.
      const u = win(t, downAt, perchAt);
      if (u < 0.3) return abs(g.grab, 0, 1, 0.22 * Math.sin((Math.PI / 2) * (u / 0.3)));
      const e = easeIn((u - 0.3) / 0.7);
      return abs(lerpPt(g.grab, g.exit, e), 0, 1, 0.22 * (1 - Math.min(1, e * 4)) - 0.12 * Math.min(1, e * 4));
    }
    if (t < diveAt) return abs(g.sky, s * 100, 1.08);
    if (t < p.impactAt) {
      // THE DIVE: flat, accelerating, the elbow leading.
      const e = easeIn(win(t, diveAt, p.impactAt));
      return abs(lerpPt(g.sky, g.cover, e), s * 100, 1.08, -0.08);
    }
    const age = t - p.impactAt;
    // It bounces off the body with it...
    if (age < 300) return abs({ x: g.cover.x, y: g.cover.y - aR * 0.3 * hump(t, p.impactAt + 40, 260) }, s * 100, 1.08 - 0.08 * easeOutCubic(age / 300), c.squash * 1.8 * Math.max(0, spring(age, 4, 90)));
    // ...then rolls off to its feet beside it and flexes (THE AFTERMATH).
    const beside = { x: g.mat.x + s * (aR + dR) * c.gap * 0.95, y: g.mat.y - dR * 0.15 };
    const e = easeInOutSine(win(age, 300, 620));
    const q = lerpPt(g.cover, beside, e);
    return abs({ x: q.x, y: q.y - aR * 0.35 * Math.sin(Math.PI * e) - aR * 0.2 * flexHop(age, 700) }, s * 100 * (1 - e), 1 + 0.08 * win(age, 640, 780), 0);
  }
  // IV: THE FINISHER.
  const whipAt = p.whipAt!, ropeAt = p.ropeAt!, flingAt = p.flingAt!, landAt = p.landAt!, pinAt = p.pinAt!, bellAt = p.bellAt!;
  if (t < whipAt) {
    // It takes hold.
    const e = easeInOutSine(win(t, p.gripAt, whipAt));
    return abs({ x: g.grab.x - s * aR * 0.14 * e, y: g.grab.y }, -s * 9 * e, 1, 0.07 * e);
  }
  const back = { x: g.block.x - s * aR * 0.3, y: g.block.y };
  if (t < ropeAt) {
    // THE WHIP: it swings round with the throw, then crosses to the middle of the ring.
    const u = win(t, whipAt, ropeAt);
    const sw = easeOutCubic(Math.min(1, u * 1.8));
    const q = lerpPt({ x: g.grab.x - s * aR * 0.14, y: g.grab.y }, back, easeInOutSine(win(u, 0.35, 1)));
    return abs(q, -s * 9 + s * 31 * sw * (1 - easeInOutSine(win(u, 0.5, 1))), 1, 0.07 * (1 - sw));
  }
  if (t < flingAt) {
    // Braced, an arm drawn back, as the ropes stretch.
    const e = easeInOutSine(win(t, ropeAt, flingAt));
    return abs(back, -s * 12 * e, 1 + 0.06 * e);
  }
  const through = { x: g.block.x + s * aR * 0.25, y: g.block.y };
  if (t < p.impactAt) {
    // THE CLOTHESLINE: it steps into it.
    const e = easeIn(win(t, flingAt, p.impactAt));
    return abs(lerpPt(back, through, e), -s * 12 + s * 28 * e, 1.06);
  }
  const follow = { x: through.x + s * aR * 0.2, y: through.y };
  if (t < landAt) {
    const age = t - p.impactAt;
    const e = easeOutCubic(age / 220);
    return abs(lerpPt(through, follow, e), s * 16 * (1 - easeOutCubic(age / 320)), 1.06 - 0.06 * e, c.squash * 0.5 * Math.max(0, spring(age, 5, 70)));
  }
  const coverRot = s * 28;
  const coverAt = p.coverAt ?? landAt;
  if (t < coverAt) {
    // THE AFTERMATH: it stands over the body for a beat, flexing.
    const age = t - landAt;
    return abs({ x: follow.x, y: follow.y - aR * 0.16 * flexHop(age, 60) }, -s * 6 * win(age, 0, 160), 1 + 0.08 * win(age, 40, 180));
  }
  if (t < pinAt) {
    // It leaps high and drops on top (a hit of its own).
    const u = win(t, coverAt, pinAt);
    const q = lerpPt(follow, g.cover, easeInOutSine(u));
    return abs({ x: q.x, y: q.y - aR * 1.05 * Math.sin(Math.PI * Math.pow(u, 0.8)) }, -s * 6 * (1 - u) + coverRot * easeInOutSine(u), 1.08 - 0.08 * u, -0.06 * Math.sin(Math.PI * u));
  }
  if (t < bellAt) {
    // THE PIN: it presses down with every count.
    let press = 0;
    for (const at of p.counts) press = Math.max(press, hump(t, at - 40, 200));
    return abs({ x: g.cover.x, y: g.cover.y + dR * 0.09 * press }, coverRot + s * 4 * press, 1, c.squash * 1.6 * Math.max(0, spring(t - pinAt, 4, 80)) + 0.1 * press);
  }
  // WINNER: it springs up off the pin and bounces on the spot.
  const age = t - bellAt;
  const e = easeOutBack(age / 240, 1.6);
  const q = lerpPt(g.cover, g.win, e);
  return abs({ x: q.x, y: q.y - aR * 0.16 * Math.abs(Math.sin((Math.PI * Math.max(0, age - 240)) / 240)) }, coverRot * (1 - clamp01(age / 200)), 1 + 0.14 * clamp01(e), 0);
}

/** The STRUCK portrait while it is being wrestled (from `gripAt` until it heads home). */
function victimActing(x: WrestleCtx, t: number): Abs {
  const { p, g, c, d, dR } = x;
  const s = g.s;
  if (p.kind === 'chop') {
    if (t < p.impactAt) return abs(d, -s * 4 * easeInOutSine(win(t, p.gripAt, p.chopAt!)));
    // THE CHOP LANDS: it staggers a step away, rocking.
    const age = t - p.impactAt;
    const q = lerpPt(d, g.stagger, easeOutCubic(age / 200) * Math.min(1, p.knock));
    return abs({ x: q.x, y: q.y - dR * 0.08 * Math.abs(Math.sin((Math.PI * Math.min(age, 360)) / 180)) }, -s * 14 * p.knock * spring(age, 2.6, 260), 1, c.squash * Math.max(0, spring(age, 5, 80)));
  }
  if (p.kind === 'slam') {
    const liftAt = p.liftAt!, topAt = p.topAt!, slamAt = p.slamAt!;
    const flat = -s * 90;
    if (t < liftAt) return abs(d, -s * 4 * easeInOutSine(win(t, p.gripAt, liftAt)));
    if (t < topAt) {
      // HOISTED: up and over in an arc, tipping flat.
      const e = easeInOutSine(win(t, liftAt, topAt));
      const q = lerpPt(d, g.top, e);
      return abs({ x: q.x - s * dR * 0.35 * Math.sin(Math.PI * e), y: q.y }, flat * e, 1 + 0.05 * e);
    }
    // HELD overhead (a real beat), and heaved a last notch higher just before the drop.
    const hoistH = dR * 0.16;
    if (t < slamAt) {
      const hoist = easeInOutSine(win(t, slamAt - 170, slamAt));
      return abs({ x: g.top.x + jit(t, 0.07, 2.2) * dR * 0.025, y: g.top.y + jit(t, 0.09, 0.9) * dR * 0.025 - hoistH * hoist }, flat + Math.sin((t - topAt) * 0.022) * 5, 1.05 + 0.03 * hoist);
    }
    if (t < p.impactAt) {
      // THE SLAM: straight down, faster and faster.
      const u = win(t, slamAt, p.impactAt);
      return abs({ x: lerp(g.top.x, g.mat.x, easeOutCubic(u)), y: lerp(g.top.y - hoistH, g.mat.y, u * u) }, flat, 1.08 - 0.08 * u, -0.14 * u);
    }
    const age = t - p.impactAt;
    const landed = t - p.bounceEnd!;
    const sq = c.squash * 3 * Math.max(0, spring(age, 3.2, 130)) + (landed >= 0 ? c.squash * 0.9 * Math.max(0, spring(landed, 5, 70)) : 0);
    return abs({ x: g.mat.x, y: g.mat.y - dR * c.bounce * hump(t, p.impactAt + 30, Math.max(40, c.bounceMs - 30)) }, flat + s * 5 * hump(t, p.impactAt + 30, Math.max(40, c.bounceMs - 30)), 1, sq);
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
      // Flat on its back, looking up: a nervous wriggle as the spotlight finds it.
      const w = win(t, p.perchAt!, p.impactAt);
      return abs({ x: g.mat.x + jit(t, 0.05, 0.6) * dR * 0.03 * w, y: g.mat.y }, flat + Math.sin((t - downAt) * 0.03) * 4 * w, 1, c.squash * 1.2 * Math.max(0, spring(t - downAt, 4, 80)));
    }
    // THE ELBOW LANDS: flattened hard, bounced off the mat once.
    const age = t - p.impactAt;
    const landed = t - p.bounceEnd!;
    const up = hump(t, p.impactAt + 30, Math.max(40, c.bounceMs - 30));
    return abs({ x: g.mat.x, y: g.mat.y - dR * c.bounce * 0.6 * up }, flat + s * 4 * up, 1, c.squash * 3.3 * Math.max(0, spring(age, 3, 160)) + (landed >= 0 ? c.squash * 0.9 * Math.max(0, spring(landed, 5, 70)) : 0));
  }
  // IV: THE FINISHER.
  const whipAt = p.whipAt!, ropeAt = p.ropeAt!, flingAt = p.flingAt!, landAt = p.landAt!;
  const held = { x: d.x + s * dR * 0.18, y: d.y };
  if (t < whipAt) {
    const e = easeInOutSine(win(t, p.gripAt, whipAt));
    return abs(lerpPt(d, held, e), s * 6 * e);
  }
  if (t < ropeAt) {
    // WHIPPED across the ring: running, leaning into it.
    const u = win(t, whipAt, ropeAt);
    const q = lerpPt(held, g.ropeHit, 0.35 * u + 0.65 * u * u);
    return abs({ x: q.x, y: q.y - dR * 0.07 * Math.abs(Math.sin(Math.PI * 3 * u)) }, s * 6 + s * 10 * Math.min(1, u * 4), 1);
  }
  if (t < flingAt) {
    // INTO THE ROPES: they stretch out with it, and it is narrowed against them.
    const u = win(t, ropeAt, flingAt);
    const k = ropeStretch(u);
    return abs(lerpPt(g.ropeHit, g.ropeMax, k), s * 16 * (1 - 2 * u), 1, -0.2 * Math.min(1, k));
  }
  if (t < p.impactAt) {
    // FLUNG BACK.
    const u = win(t, flingAt, p.impactAt);
    const q = lerpPt(g.ropeHit, g.meet, 1 - Math.pow(1 - u, 1.5));
    return abs({ x: q.x, y: q.y - dR * 0.06 * Math.abs(Math.sin(Math.PI * 2 * u)) }, -s * 16, 1);
  }
  const flat = s * 90;
  if (t < landAt) {
    // CLOTHESLINED: its feet fly on, it flips flat in the air and comes down on its back.
    const u = win(t, p.impactAt, landAt);
    const e = 1 - Math.pow(1 - u, 1.6);
    const turned = -s * 16 + (flat + s * 360 * Math.round(c.flipTurns) + s * 16) * e;
    return abs({ x: lerp(g.meet.x, g.mat.x, easeOutCubic(u)), y: lerp(g.meet.y, g.mat.y, u) - dR * 1.35 * 4 * u * (1 - u) }, turned, 1 + 0.08 * Math.sin(Math.PI * u));
  }
  // On its back for the count.
  const age = t - landAt;
  let press = 0;
  for (const at of p.counts) press = Math.max(press, hump(t, at - 40, 200));
  const pinned = t - p.pinAt!;
  return abs({ x: g.mat.x, y: g.mat.y - dR * 0.24 * hump(t, landAt + 20, 220) }, flat, 1, c.squash * 3 * Math.max(0, spring(age, 3.5, 120)) + (pinned >= 0 ? c.squash * 1.8 * Math.max(0, spring(pinned, 4, 90)) : 0) + 0.09 * press);
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
      // THE WALK IN: three strides, rocking, a little bigger as it squares up.
      const u = win(t, p.walkAt, p.gripAt);
      const e = easeInOutSine(u);
      const at = lerpPt(slot, g.grab, e);
      q = abs({ x: at.x, y: at.y - R * 0.1 * Math.abs(Math.sin(Math.PI * 3 * u)) }, Math.sin(Math.PI * 6 * u) * 3.5, 1, c.squash * 0.7 * (1 - Math.min(1, u * 5)));
    }
  } else if (t < p.homeAt) {
    q = acting(x, t);
  } else {
    // HOME: both get up and go back to their slots.
    const from = acting(x, p.homeAt - 0.001);
    const e = easeInOutSine(win(t, p.homeAt, p.homeEnd));
    const settle = t >= p.homeEnd ? c.squash * 0.4 * Math.max(0, spring(t - p.homeEnd, 4, 60)) : 0;
    q = abs({ x: lerp(from.x, slot.x, e), y: lerp(from.y, slot.y, e) - R * 0.22 * Math.sin(Math.PI * e) }, from.rot * (1 - easeOutCubic(win(t, p.homeAt, p.homeEnd))), lerp(from.scale, 1, e), from.squash * (1 - e) + settle);
  }
  return { x: q.x - slot.x, y: q.y - slot.y, rot: q.rot, scale: q.scale, squash: q.squash };
}

/** The STRIKING portrait at sequence time `t` (its slot is (0, 0)). Pure and deterministic. */
export function strikerPose(x: WrestleCtx, t: number): WrestlePose { return poseOf(x, t, x.a, x.aR, true); }

/** The STRUCK portrait at sequence time `t` (its slot is (0, 0)). Pure and deterministic. */
export function victimPose(x: WrestleCtx, t: number): WrestlePose { return poseOf(x, t, x.d, x.dR, false); }

// ─── the ring ropes (IV, pure) ─────────────────────────────────────────────────────────────────────────────────

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
  const full = Math.abs(g.ropeMax.x - g.ropeHit.x);
  let far = 0;
  if (t >= p.ropeAt! && t < p.flingAt!) far = full * ropeStretch(win(t, p.ropeAt!, p.flingAt!));
  // Let go, they whip back past straight and ring down.
  else if (t >= p.flingAt!) far = -full * 0.45 * spring(t - p.flingAt!, 5.5, 190) * Math.sin(Math.min(Math.PI / 2, (t - p.flingAt!) / 30));
  // The near ropes kick as the struck portrait is thrown off them.
  let near = t >= p.whipAt! ? -dR * 0.16 * spring(t - p.whipAt!, 6, 150) * Math.sin(Math.min(Math.PI / 2, (t - p.whipAt!) / 30)) : 0;
  // The whole ring shudders under every landing: the body, the cover, and each slap of the mat.
  let drop = 0;
  const shudder = (at: number, k: number): void => {
    if (t < at) return;
    const w = dR * c.stretch * k * spring(t - at, 7, 150) * Math.sin(Math.min(Math.PI / 2, (t - at) / 24));
    drop += w; near += w * 0.5; far += w * 0.5;
  };
  shudder(p.landAt!, 0.26);
  shudder(p.pinAt!, 0.16);
  for (const at of p.counts) shudder(at, 0.1);
  return { visible: rise > 0.004, rise, alpha: clamp01(up * 2) * (1 - away), near, far, drop };
}

// ─── the spotlight, the elbow and the shadow (pure) ────────────────────────────────────────────────────────────

/** III's spotlight: from a point on the top edge to where it points, at `alpha`. */
export interface SpotState { visible: boolean; fromX: number; fromY: number; toX: number; toY: number; alpha: number }

/** The spotlight at sequence time `t`: it comes on as the striker leaves the screen, swings round and finds the one on the mat. */
export function wrestleSpot(x: WrestleCtx, t: number, topY = 0): SpotState {
  const { p, g, c, dR } = x;
  if (p.reduced || p.kind !== 'elbow' || p.perchAt === null || t < p.perchAt - 80 || t >= p.impactAt + 160 || c.spot <= 0) return { visible: false, fromX: 0, fromY: 0, toX: 0, toY: 0, alpha: 0 };
  const on = win(t, p.perchAt - 80, p.perchAt + 60) * (1 - win(t, p.impactAt, p.impactAt + 160));
  // It hunts: starting off to one side, it swings over and settles on the target (a little overshoot).
  const find = easeOutBack(win(t, p.perchAt, p.perchAt + Math.max(120, c.perchMs * 0.7)), 1.8);
  return { visible: on > 0.004, fromX: g.mat.x, fromY: topY, toX: g.mat.x + g.s * dR * 2.4 * (1 - find), toY: g.mat.y, alpha: on * Math.min(1, c.spot) };
}

/** III's elbow star, leading the dive. */
export interface ElbowState { visible: boolean; x: number; y: number; rot: number; scale: number }

export function wrestleElbow(x: WrestleCtx, t: number): ElbowState {
  const { p, g, aR } = x;
  if (p.reduced || p.kind !== 'elbow' || p.diveAt === null || t < p.diveAt || t >= p.impactAt) return { visible: false, x: 0, y: 0, rot: 0, scale: 0 };
  const e = easeIn(win(t, p.diveAt, p.impactAt));
  const at = lerpPt(g.sky, g.cover, e);
  return { visible: true, x: at.x, y: at.y + aR * 1.1, rot: (t - p.diveAt) * 0.012, scale: 0.75 + 0.25 * Math.sin((t - p.diveAt) * 0.05) };
}

/** What is about to land casts a growing shadow on the mat: II under the one held overhead, III on the one lying there. */
export function wrestleShadow(x: WrestleCtx, t: number): { at: Pt; k: number } {
  const { p, g } = x;
  if (p.reduced) return { at: g.mat, k: 0 };
  if (p.kind === 'slam' && t >= p.liftAt! && t < p.impactAt) return { at: g.mat, k: 0.35 * easeInOutSine(win(t, p.liftAt!, p.topAt!)) + 0.65 * easeIn(win(t, p.slamAt!, p.impactAt)) };
  if (p.kind === 'elbow' && t >= p.perchAt! && t < p.impactAt) return { at: g.mat, k: 0.3 * win(t, p.perchAt!, p.diveAt!) + 0.7 * easeIn(win(t, p.diveAt!, p.impactAt)) };
  return { at: g.mat, k: 0 };
}

// ─── the camera (pure) ─────────────────────────────────────────────────────────────────────────────────────────

/**
 * The camera: it pushes in while the two are locked up (from the grip to the impact), punches and shakes on the impact
 * along the blow (`dir`: sideways for the chop and the clothesline, straight down for the slam and the elbow), and jolts
 * a little on the ticks (the ropes, a landing, each slap of the mat). Pure.
 */
export function wrestleCameraAt(p: WrestlePlan, c: HeroWrestleConfig, t: number, dir: Pt): { zoom: number; x: number; y: number } {
  if (p.reduced) return { zoom: 1, x: 0, y: 0 };
  const push = t < p.gripAt ? 0 : t < p.impactAt ? easeInOutSine((t - p.gripAt) / Math.max(1, p.impactAt - p.gripAt)) : 1 - easeInOutSine((t - p.impactAt) / Math.max(1, c.zoomOutMs));
  let z = p.zoom * clamp01(push);
  let x = 0, y = 0;
  const tau = Math.max(1, c.shakeMs / 4);
  for (const j of p.jolts) {
    if (t < j.at || t > j.at + 400) continue;
    const sh = spring(t - j.at, 14, 55) * p.shakePx * j.k;
    if (j.vertical) y += sh; else x += dir.x >= 0 ? sh : -sh;
  }
  if (t >= p.impactAt) {
    const age = t - p.impactAt;
    z += p.punch * Math.exp(-age / tau);
    const sh = spring(age, 15, tau) * p.shakePx;
    x += dir.x * sh; y += dir.y * sh;
    if (p.kind !== 'chop') {
      const r = p.shakePx * 0.35 * Math.exp(-age / (tau * 2));
      x += Math.sin(age * 0.137) * r; y += Math.cos(age * 0.101) * r;
    }
  }
  return { zoom: 1 + z, x, y };
}
