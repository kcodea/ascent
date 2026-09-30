/**
 * THE BASKETBALL HERO ATTACK ("Nothing But Net", a Legendary with four tiers): its tuned values, its pure timeline,
 * the pure geometry (mid court, the fadeaway spot, the scoot and the step back, the run-up, the catch above the
 * target), the pure pose of the striking PORTRAIT, the pure path of the ball, the hoop's look and the camera.
 *
 * Owner 2026-09-29: "branch off and make a basketball attack animation. tier 1 = basketball shot from place / tier 2 =
 * a fadeaway, the attacker hero slides to mid court, then slides to the left or right kind backwards and shoots a
 * basketball at the target / ... add a whistle and Ooo's sound effect as well as basketball sounds and sneaker sounds".
 * Owner review the same day (the first III and IV were a slam dunk and a bounce-off alley-oop): "the fadeaway is the
 * best, let's make the tier 3 another like it - let's have the attacker scoot straight upwards and get a pass thrown to
 * him from off-screen from the right side and he pump fakes, dribbles back and then pulls up for a 3. for the huge self
 * alley oop - have the attacker chuck the ball from its starting position, and then run up and leap from half court,
 * catching the ball and massively slamming on the target."
 *
 * FOUR TIERS on the shared thresholds (`attackTier`: a knockout always plays IV):
 *  - I THE JUMPER: a dribble where it stands, a small jump, a high arcing shot with backspin that swishes through a net
 *    on the target (THE impact), and the ball drops away.
 *  - II THE FADEAWAY: the PORTRAIT dribbles out to mid court, pushes off BACKWARDS and to one side (the side with more
 *    room), releases a high arc at the top of the fade, the ball swishes (THE impact), and it slides home.
 *  - III THE PULL-UP THREE: the portrait SCOOTS straight up court from its slot, a PASS flies in from off the RIGHT edge
 *    of the screen and it catches it, PUMP FAKES, DRIBBLES BACK, and PULLS UP for a three: a long high arc that swishes
 *    (THE impact, a bigger swish and the crowd's "ooh"), then it slides home.
 *  - IV THE SELF ALLEY-OOP (owner review of #1867: "i want a direct throw from the beginning that's fast and bounces
 *    high off the target and the attacker leaps into the air and slams it down into an explosion"): from its slot it
 *    FIRES the ball straight at the target (fast, flat, spinning, a speed trail); it SMACKS the target (a pop, no
 *    damage) and BOUNCES HIGH straight up; the portrait takes a quick run-up, LEAPS, CATCHES it at the top (a flash, a
 *    squeak) and SLAMS it down into an EXPLOSION (THE impact): a flash core, a fireball, shockwave rings, debris and
 *    sparks, the backboard's glass, the whole board shaking, the crowd roaring.
 *
 * The PORTRAIT moves (as Classic, Enraged and Shadow Step do), so every exit path restores its transform, opacity and
 * z-order exactly (the runner owns that). Every point it visits is kept on screen; a point above the target that would
 * leave the frame swings round the target toward the middle of the screen, and the ball always lands on the target's
 * centre (the hit point never leaves the target). No hit-stop anywhere; flat 2D.
 */
import { configStore } from '../heroAttack/configStore';
import { clamp, clamp01, easeInOutSine, easeOutCubic, spring, type Pt } from '../heroAttack/easing';
import {
  HERO_ATTACK_TIER_THRESHOLDS, TIERS, reducedAttackTimeline, attackTier, type AttackTierContext, type TierNum,
} from '../heroAttack/tiers';

export { TIERS };
export type { TierNum };

export const BASKETBALL_KINDS = ['jumper', 'fadeaway', 'three', 'alleyoop'] as const;
export type BasketballKind = (typeof BASKETBALL_KINDS)[number];

/** Each tier's move. */
export function basketballKind(tier: TierNum): BasketballKind { return BASKETBALL_KINDS[tier - 1]!; }

/** The tier dial groups the tuner shows (`t1` ... `t4`). */
export const BASKETBALL_LEVELS = ['t1', 't2', 't3', 't4'] as const;

export const BASKETBALL_TIER_SUFFIXES = [
  'ReadyMs', 'Dribbles', 'DribbleMs', 'ApproachMs', 'LeapMs', 'FlightMs', 'Arc', 'SlamMs', 'HoldMs', 'ReturnMs',
  'JumpScale', 'Zoom', 'Punch', 'Shake', 'Burst', 'Rings', 'Shards', 'Confetti', 'Dim',
] as const;
export type BasketballTierSuffix = (typeof BASKETBALL_TIER_SUFFIXES)[number];
type TierKey = `t${TierNum}${BasketballTierSuffix}`;

interface GlobalConfig {
  tier2At: number; tier3At: number; tier4At: number;
  absorbMs: number;
  gatherMs: number;
  hangMs: number;
  ballSize: number;
  spin: number;
  trailMs: number;
  jumpLift: number;
  midCourt: number;
  fadeBack: number;
  fadeSide: number;
  fadeLean: number;
  scootUp: number;
  passMs: number;
  passEntry: number;
  passArc: number;
  pumpMs: number;
  pumpLift: number;
  backMs: number;
  dribbleBack: number;
  halfCourt: number;
  alleyRise: number;
  riseMs: number;
  blastSize: number;
  slamContact: number;
  shadowDrop: number;
  hoopSize: number;
  wordSize: number;
  knockPx: number;
  squash: number;
  shakeMs: number;
  zoomOutMs: number;
  reducedFadeMs: number;
  colorBall: string;
  colorRim: string;
  colorNet: string;
  colorGlass: string;
  colorFlash: string;
  colorBlast: string;
  colorConfettiA: string;
  colorConfettiB: string;
  colorPlayer: string;
  colorFoe: string;
  sfxWhistleClip: string; sfxWhistleGain: number; sfxWhistleRate: number;
  sfxDribbleClip: string; sfxDribbleGain: number; sfxDribbleRate: number;
  sfxSqueakClip: string; sfxSqueakGain: number; sfxSqueakRate: number;
  sfxThrowClip: string; sfxThrowGain: number; sfxThrowRate: number;
  sfxSwishClip: string; sfxSwishGain: number; sfxSwishRate: number;
  sfxCatchClip: string; sfxCatchGain: number; sfxCatchRate: number;
  sfxRimClip: string; sfxRimGain: number; sfxRimRate: number;
  sfxSlamClip: string; sfxSlamGain: number; sfxSlamRate: number;
  sfxShatterClip: string; sfxShatterGain: number; sfxShatterRate: number;
  sfxOohClip: string; sfxOohGain: number; sfxOohRate: number;
  sfxCheerClip: string; sfxCheerGain: number; sfxCheerRate: number;
  sfxDuck: number;
  previewDamage: number;
  previewParts: number;
}
export type HeroBasketballConfig = GlobalConfig & Record<TierKey, number>;

export const HERO_BASKETBALL_COLOR_KEYS = [
  'colorBall', 'colorRim', 'colorNet', 'colorGlass', 'colorFlash', 'colorBlast', 'colorConfettiA', 'colorConfettiB', 'colorPlayer', 'colorFoe',
] as const;
export const HERO_BASKETBALL_CLIP_KEYS = [
  'sfxWhistleClip', 'sfxDribbleClip', 'sfxSqueakClip', 'sfxThrowClip', 'sfxSwishClip', 'sfxCatchClip', 'sfxRimClip', 'sfxSlamClip',
  'sfxShatterClip', 'sfxOohClip', 'sfxCheerClip',
] as const;
export type HeroBasketballStrKey = (typeof HERO_BASKETBALL_COLOR_KEYS)[number] | (typeof HERO_BASKETBALL_CLIP_KEYS)[number];
export type HeroBasketballNumKey = Exclude<keyof HeroBasketballConfig, HeroBasketballStrKey>;

/** Per tier: [I, II, III, IV]. A dial a tier's move does not use is ignored there (the tuner says which). */
const TIER_DEFAULTS: Record<BasketballTierSuffix, [number, number, number, number]> = {
  ReadyMs: [120, 110, 100, 100],
  Dribbles: [1, 2, 2, 0],
  DribbleMs: [300, 250, 220, 260],
  ApproachMs: [0, 520, 300, 240],
  LeapMs: [260, 440, 480, 440],
  FlightMs: [620, 700, 820, 260],
  Arc: [0.32, 0.45, 0.55, 0.03],
  SlamMs: [0, 0, 0, 140],
  HoldMs: [380, 260, 260, 460],
  ReturnMs: [0, 420, 460, 540],
  JumpScale: [0.05, 0.07, 0.09, 0.22],
  Zoom: [0.02, 0.025, 0.035, 0.06],
  Punch: [0.01, 0.015, 0.02, 0.045],
  Shake: [2, 3, 5, 20],
  Burst: [0.8, 1, 1.3, 1.8],
  Rings: [1, 1, 2, 4],
  Shards: [0, 0, 0, 16],
  Confetti: [0, 0, 12, 0],
  Dim: [0.1, 0.14, 0.18, 0.28],
};

export const BASKETBALL_TIER_RANGES: Record<BasketballTierSuffix, [number, number, number]> = {
  ReadyMs: [0, 1000, 10],
  Dribbles: [0, 6, 1],
  DribbleMs: [100, 600, 10],
  ApproachMs: [0, 1500, 10],
  LeapMs: [80, 1200, 10],
  FlightMs: [0, 1500, 10],
  Arc: [0, 1, 0.01],
  SlamMs: [0, 600, 10],
  HoldMs: [0, 1500, 10],
  ReturnMs: [0, 1500, 10],
  JumpScale: [0, 0.5, 0.01],
  Zoom: [0, 0.2, 0.005],
  Punch: [0, 0.1, 0.001],
  Shake: [0, 40, 0.5],
  Burst: [0, 3, 0.05],
  Rings: [0, 8, 1],
  Shards: [0, 40, 1],
  Confetti: [0, 80, 1],
  Dim: [0, 0.6, 0.01],
};

const tierDefaults = Object.fromEntries(TIERS.flatMap((t) => BASKETBALL_TIER_SUFFIXES.map((s) => [`t${t}${s}`, TIER_DEFAULTS[s][t - 1]]))) as Record<TierKey, number>;

export const HERO_BASKETBALL_DEFAULTS: HeroBasketballConfig = {
  ...HERO_ATTACK_TIER_THRESHOLDS,
  absorbMs: 180,
  gatherMs: 90,
  hangMs: 110,
  ballSize: 0.5,
  spin: 2.4,
  trailMs: 26,
  jumpLift: 0.22,
  midCourt: 0.45,
  fadeBack: 1.1,
  fadeSide: 1.5,
  fadeLean: 12,
  scootUp: 1.7,
  passMs: 420,
  passEntry: -0.4,
  passArc: 0.1,
  pumpMs: 300,
  pumpLift: 0.45,
  backMs: 520,
  dribbleBack: 1.4,
  halfCourt: 0.3,
  alleyRise: 2.6,
  riseMs: 520,
  blastSize: 1.4,
  slamContact: 0.55,
  shadowDrop: 0.55,
  hoopSize: 1,
  wordSize: 1,
  knockPx: 16,
  squash: 0.09,
  shakeMs: 300,
  zoomOutMs: 420,
  reducedFadeMs: 260,
  colorBall: '#e8742a',
  colorRim: '#ff5a1f',
  colorNet: '#f4f1ea',
  colorGlass: '#cfeeff',
  colorFlash: '#fff4dc',
  colorBlast: '#ff7a1a',
  colorConfettiA: '#ffd23f',
  colorConfettiB: '#3fa9ff',
  colorPlayer: '#ffcf5a',
  colorFoe: '#ff6a5a',
  sfxWhistleClip: 'fx/bball-whistle', sfxWhistleGain: 0.55, sfxWhistleRate: 1,
  sfxDribbleClip: 'fx/bball-dribble', sfxDribbleGain: 0.7, sfxDribbleRate: 1,
  sfxSqueakClip: 'fx/bball-squeak', sfxSqueakGain: 0.55, sfxSqueakRate: 1,
  sfxThrowClip: 'fx/stereogenicstudio-swish-swoosh-woosh-sfx-27-357164-3', sfxThrowGain: 0.3, sfxThrowRate: 1.2,
  sfxSwishClip: 'fx/bball-swish', sfxSwishGain: 0.9, sfxSwishRate: 1,
  sfxCatchClip: 'fx/bball-dribble', sfxCatchGain: 0.6, sfxCatchRate: 1.35,
  sfxRimClip: 'fx/bball-rim', sfxRimGain: 0.8, sfxRimRate: 1,
  sfxSlamClip: 'fx/heavy-rock-impact', sfxSlamGain: 0.4, sfxSlamRate: 1.15,
  sfxShatterClip: 'divineshieldbreak', sfxShatterGain: 0.5, sfxShatterRate: 1,
  sfxOohClip: 'fx/bball-ooh', sfxOohGain: 0.75, sfxOohRate: 1,
  sfxCheerClip: 'fx/cheering', sfxCheerGain: 0.25, sfxCheerRate: 1,
  sfxDuck: 0.6,
  previewDamage: 12,
  previewParts: 4,
  ...tierDefaults,
};

const GLOBAL_RANGES: Record<Exclude<keyof GlobalConfig, HeroBasketballStrKey>, [number, number, number]> = {
  tier2At: [2, 40, 1], tier3At: [2, 60, 1], tier4At: [2, 80, 1],
  absorbMs: [60, 600, 10],
  gatherMs: [0, 400, 10],
  hangMs: [0, 600, 10],
  ballSize: [0.2, 1.2, 0.01],
  spin: [0, 8, 0.1],
  trailMs: [10, 120, 1],
  jumpLift: [0, 1, 0.01],
  midCourt: [0.1, 0.8, 0.01],
  fadeBack: [0, 3, 0.05],
  fadeSide: [0, 3, 0.05],
  fadeLean: [0, 30, 0.5],
  scootUp: [0, 4, 0.05],
  passMs: [120, 1200, 10],
  passEntry: [-3, 3, 0.05],
  passArc: [0, 0.6, 0.01],
  pumpMs: [0, 800, 10],
  pumpLift: [0, 1.5, 0.05],
  backMs: [100, 1500, 10],
  dribbleBack: [0, 4, 0.05],
  halfCourt: [0, 0.8, 0.01],
  alleyRise: [0.5, 4, 0.05],
  riseMs: [120, 1500, 10],
  blastSize: [0, 3, 0.05],
  slamContact: [0, 1.5, 0.01],
  shadowDrop: [0, 1.5, 0.01],
  hoopSize: [0.3, 2.5, 0.05],
  wordSize: [0, 2.5, 0.05],
  knockPx: [0, 60, 1],
  squash: [0, 0.3, 0.01],
  shakeMs: [0, 1200, 10],
  zoomOutMs: [60, 1500, 10],
  reducedFadeMs: [60, 1000, 10],
  sfxWhistleGain: [0, 2, 0.05], sfxWhistleRate: [0.5, 2.5, 0.01],
  sfxDribbleGain: [0, 2, 0.05], sfxDribbleRate: [0.5, 2.5, 0.01],
  sfxSqueakGain: [0, 2, 0.05], sfxSqueakRate: [0.5, 2.5, 0.01],
  sfxThrowGain: [0, 2, 0.05], sfxThrowRate: [0.5, 2.5, 0.01],
  sfxSwishGain: [0, 2, 0.05], sfxSwishRate: [0.5, 2.5, 0.01],
  sfxCatchGain: [0, 2, 0.05], sfxCatchRate: [0.5, 2.5, 0.01],
  sfxRimGain: [0, 2, 0.05], sfxRimRate: [0.5, 2.5, 0.01],
  sfxSlamGain: [0, 2, 0.05], sfxSlamRate: [0.5, 2.5, 0.01],
  sfxShatterGain: [0, 2, 0.05], sfxShatterRate: [0.5, 2.5, 0.01],
  sfxOohGain: [0, 2, 0.05], sfxOohRate: [0.5, 2.5, 0.01],
  sfxCheerGain: [0, 2, 0.05], sfxCheerRate: [0.5, 2.5, 0.01],
  sfxDuck: [0, 1, 0.05],
  previewDamage: [1, 60, 1],
  previewParts: [1, 8, 1],
};

export const HERO_BASKETBALL_RANGES: Record<HeroBasketballNumKey, [number, number, number]> = {
  ...GLOBAL_RANGES,
  ...(Object.fromEntries(TIERS.flatMap((t) => BASKETBALL_TIER_SUFFIXES.map((s) => [`t${t}${s}`, BASKETBALL_TIER_RANGES[s]]))) as Record<TierKey, [number, number, number]>),
};

/** Hard caps (whatever the tuner says). */
export const BASKETBALL_CAPS = { shakePx: 40, dribbles: 6 } as const;

const store = configStore<HeroBasketballConfig>({
  key: 'ascent.herobasketball.v3', defaults: HERO_BASKETBALL_DEFAULTS, ranges: HERO_BASKETBALL_RANGES,
  colorKeys: HERO_BASKETBALL_COLOR_KEYS, clipKeys: HERO_BASKETBALL_CLIP_KEYS, previewKeys: ['previewDamage', 'previewParts'],
});
export const heroBasketballStore = store;
export const getHeroBasketballConfig = store.get;
export const clampHeroBasketballValue = store.clamp;
export const sanitizeHeroBasketballConfig = store.sanitize;
export const heroBasketballConfigJson = store.json;
/** The preview speed hook (Recruit + the Collection read one per style). Always 1: the tuner has no speed buttons. */
export function heroBasketballPreviewSpeed(): number { return 1; }

export function basketballTierDials(tier: TierNum, c: HeroBasketballConfig = store.get()): Record<BasketballTierSuffix, number> {
  return Object.fromEntries(BASKETBALL_TIER_SUFFIXES.map((s) => [s, c[`t${tier}${s}`]])) as Record<BasketballTierSuffix, number>;
}

// ─── the pure plan ─────────────────────────────────────────────────────────────────────────────────────────────

export interface BasketballPlanInput extends AttackTierContext {
  leadIn?: number;
  total: number;
  reduced?: boolean;
}

export interface BasketballPlan {
  reduced: boolean;
  tier: TierNum;
  kind: BasketballKind;
  k: number;
  total: number;
  chargeAt: number;
  absorbEnd: number;
  /** The move starts (after the ready beat). */
  startAt: number;
  /** The run: II the slide to mid court, III the scoot up court, IV the quick run-up before the leap. (I stands still.) */
  approachAt: number;
  approachEnd: number;
  /** When the ball hits the floor on each dribble. */
  dribbles: number[];
  dribbleMs: number;
  /** Sneaker squeaks (the push-offs, the stops, the step back, the take-off, the slide home). */
  squeaks: number[];
  /** III: the pass enters from off the right edge; null elsewhere. */
  passAt: number | null;
  /** III: the pass is caught; IV: the bounced ball is caught at the top of the leap. Null for I / II. */
  catchAt: number | null;
  /** III: the pump fake (up, and back down). */
  pumpAt: number | null;
  pumpEnd: number | null;
  /** III: the dribble back (the step back from the defender). */
  backAt: number | null;
  backEnd: number | null;
  /** The crouch before the jump, and the jump itself. */
  gatherAt: number;
  takeoffAt: number;
  /** I-III: the shot leaves the hands (at the top of the jump); IV: the throw at the target. */
  releaseAt: number;
  /** The top of the jump (IV: the catch). */
  apexAt: number;
  /** I-III: back on the floor. IV: the slam. */
  landAt: number;
  /** IV: the throw smacks the target and bounces high (a tick: FX and sound, no damage). */
  bounceAt: number | null;
  /** IV: the slam starts down. */
  slamAt: number | null;
  /** THE impact: the swish (I-III) or the slam (IV). The blow lands here, once. */
  impactAt: number;
  /** The portrait heads home, and is home. */
  homeAt: number;
  homeEnd: number;
  endAt: number;
  // the looks
  flightMs: number;
  arc: number;
  jumpScale: number;
  zoom: number;
  punch: number;
  shakePx: number;
  burst: number;
  rings: number;
  shards: number;
  confetti: number;
  dim: number;
}

/** The whole attack, in base ms. Pure and deterministic. */
export function basketballPlan(input: BasketballPlanInput, c: HeroBasketballConfig = store.get()): BasketballPlan {
  const total = Math.max(0, Math.round(input.total));
  const tier = attackTier(total, input, c); // a knockout always plays the shared Tier IV
  const kind = basketballKind(tier);
  const L = basketballTierDials(tier, c);
  const k = (tier - 1) / 3;
  const looks = {
    tier, kind, k, total, dribbleMs: L.DribbleMs, flightMs: L.FlightMs, arc: L.Arc, jumpScale: L.JumpScale, zoom: L.Zoom, punch: L.Punch,
    shakePx: clamp(L.Shake, 0, BASKETBALL_CAPS.shakePx), burst: L.Burst, rings: Math.round(L.Rings), shards: Math.round(L.Shards),
    confetti: Math.round(L.Confetti), dim: L.Dim,
  };
  const none = { passAt: null, catchAt: null, pumpAt: null, pumpEnd: null, backAt: null, backEnd: null, slamAt: null, bounceAt: null };
  if (input.reduced) {
    const r = reducedAttackTimeline(input.leadIn ?? 0, c.reducedFadeMs);
    const at = r.impactAt;
    return {
      ...looks, ...none, reduced: true, chargeAt: at, absorbEnd: at, startAt: at, approachAt: at, approachEnd: at, dribbles: [], squeaks: [], gatherAt: at,
      takeoffAt: at, releaseAt: at, apexAt: at, landAt: at, impactAt: at, homeAt: at, homeEnd: at, endAt: r.endAt,
      zoom: 0, punch: 0, shakePx: 0, burst: 0, rings: 0, shards: 0, confetti: 0, dim: 0,
    };
  }
  const chargeAt = Math.max(0, input.leadIn ?? 0);
  const absorbEnd = chargeAt + c.absorbMs;
  const startAt = chargeAt + Math.max(L.ReadyMs, c.absorbMs * 0.6);
  const n = clamp(Math.round(L.Dribbles), 0, BASKETBALL_CAPS.dribbles);
  const flight = Math.max(80, L.FlightMs);
  const spread = (from: number, len: number): number[] => Array.from({ length: n }, (_, i) => from + (len * (i + 0.5)) / Math.max(1, n));
  if (kind === 'jumper') {
    const dribbles = Array.from({ length: n }, (_, i) => startAt + L.DribbleMs * (i + 0.5));
    const gatherAt = startAt + n * L.DribbleMs;
    const takeoffAt = gatherAt + c.gatherMs * 0.6;
    const apexAt = takeoffAt + L.LeapMs;
    const releaseAt = takeoffAt + L.LeapMs * 0.85;
    const landAt = takeoffAt + L.LeapMs * 2;
    const impactAt = releaseAt + flight;
    return {
      ...looks, ...none, reduced: false, chargeAt, absorbEnd, startAt, approachAt: startAt, approachEnd: startAt, dribbles, squeaks: [takeoffAt],
      gatherAt, takeoffAt, releaseAt, apexAt, landAt, impactAt, homeAt: landAt, homeEnd: landAt, endAt: Math.max(impactAt + L.HoldMs, landAt + 120),
    };
  }
  if (kind === 'fadeaway') {
    const approachEnd = startAt + L.ApproachMs;
    const gatherAt = approachEnd;
    const takeoffAt = gatherAt + c.gatherMs;
    const apexAt = takeoffAt + L.LeapMs * 0.55;
    const releaseAt = apexAt;
    const landAt = takeoffAt + L.LeapMs;
    const impactAt = releaseAt + flight;
    const homeAt = Math.max(landAt, impactAt) + 60;
    const homeEnd = homeAt + L.ReturnMs;
    return {
      ...looks, ...none, reduced: false, chargeAt, absorbEnd, startAt, approachAt: startAt, approachEnd, dribbles: spread(startAt, L.ApproachMs),
      squeaks: [startAt, Math.max(startAt, approachEnd - 50), takeoffAt, homeAt], gatherAt, takeoffAt, releaseAt, apexAt, landAt, impactAt, homeAt, homeEnd,
      endAt: Math.max(homeEnd, impactAt + L.HoldMs),
    };
  }
  if (kind === 'three') {
    // The scoot up court; the pass is thrown in from off the right edge while it scoots and caught just after it stops.
    const approachEnd = startAt + L.ApproachMs;
    const catchAt = Math.max(approachEnd + 40, startAt + c.passMs);
    const passAt = catchAt - c.passMs;
    const pumpAt = catchAt + 90;
    const pumpEnd = pumpAt + c.pumpMs;
    const backAt = pumpEnd + 30;
    const backEnd = backAt + c.backMs;
    const gatherAt = backEnd;
    const takeoffAt = gatherAt + c.gatherMs;
    const apexAt = takeoffAt + L.LeapMs * 0.5;
    const releaseAt = apexAt;
    const landAt = takeoffAt + L.LeapMs;
    const impactAt = releaseAt + flight;
    const homeAt = Math.max(landAt, impactAt) + 60;
    const homeEnd = homeAt + L.ReturnMs;
    return {
      ...looks, reduced: false, chargeAt, absorbEnd, startAt, approachAt: startAt, approachEnd, dribbles: spread(backAt, c.backMs),
      squeaks: [startAt, approachEnd, backAt, takeoffAt, homeAt], passAt, catchAt, pumpAt, pumpEnd, backAt, backEnd, slamAt: null, bounceAt: null,
      gatherAt, takeoffAt, releaseAt, apexAt, landAt, impactAt, homeAt, homeEnd, endAt: Math.max(homeEnd, impactAt + L.HoldMs),
    };
  }
  // THE SELF ALLEY-OOP: (any dribbles), a wind-up, the ball FIRED straight at the target, the smack and the high bounce;
  // a quick run-up (what fits before the leap), the leap timed to meet the ball at the top, the catch, the slam.
  const dribbles = Array.from({ length: n }, (_, i) => startAt + L.DribbleMs * (i + 0.5));
  const gatherAt = startAt + n * L.DribbleMs;
  const releaseAt = gatherAt + c.gatherMs * 1.4;
  const bounceAt = releaseAt + flight;
  const catchAt = bounceAt + c.riseMs;
  const takeoffAt = Math.max(releaseAt + 100, catchAt - L.LeapMs);
  const approachAt = releaseAt + 60;
  const approachEnd = Math.max(approachAt, Math.min(approachAt + L.ApproachMs, takeoffAt - c.gatherMs * 0.6));
  const slamAt = catchAt + c.hangMs;
  const impactAt = slamAt + Math.max(40, L.SlamMs);
  const homeAt = impactAt + L.HoldMs;
  const homeEnd = homeAt + L.ReturnMs;
  return {
    ...looks, ...none, reduced: false, chargeAt, absorbEnd, startAt, approachAt, approachEnd, dribbles,
    squeaks: approachEnd > approachAt + 40 ? [approachAt, takeoffAt] : [takeoffAt], catchAt, slamAt, bounceAt,
    gatherAt, takeoffAt, releaseAt, apexAt: catchAt, landAt: impactAt, impactAt, homeAt, homeEnd, endAt: Math.max(homeEnd, impactAt + L.HoldMs),
  };
}

export type BasketballCueKind = 'charge' | 'hoop' | 'dribble' | 'squeak' | 'pass' | 'catch' | 'pump' | 'jump' | 'release' | 'bounce' | 'impact' | 'home' | 'end';
export interface BasketballCue { at: number; kind: BasketballCueKind; i: number }

/** When the hoop fades in on the target (just before the shot or the throw). */
export function hoopInAt(p: BasketballPlan): number {
  return Math.max(p.chargeAt, p.releaseAt - (p.kind === 'alleyoop' ? 120 : 60));
}

/** Every beat the runner fires, in time order. The blow lands on `impact`, once. */
export function basketballCues(p: BasketballPlan): BasketballCue[] {
  const out: BasketballCue[] = [];
  if (!p.reduced) {
    out.push({ at: p.chargeAt, kind: 'charge', i: 0 });
    out.push({ at: hoopInAt(p), kind: 'hoop', i: 0 });
    p.dribbles.forEach((at, i) => out.push({ at, kind: 'dribble', i }));
    p.squeaks.forEach((at, i) => out.push({ at, kind: 'squeak', i }));
    if (p.passAt !== null) out.push({ at: p.passAt, kind: 'pass', i: 0 });
    if (p.catchAt !== null) out.push({ at: p.catchAt, kind: 'catch', i: 0 });
    if (p.pumpAt !== null) out.push({ at: p.pumpAt, kind: 'pump', i: 0 });
    out.push({ at: p.takeoffAt, kind: 'jump', i: 0 });
    out.push({ at: p.releaseAt, kind: 'release', i: 0 });
    if (p.bounceAt !== null) out.push({ at: p.bounceAt, kind: 'bounce', i: 0 });
    if (p.homeEnd > p.homeAt) out.push({ at: p.homeAt, kind: 'home', i: 0 });
  }
  out.push({ at: p.impactAt, kind: 'impact', i: 0 });
  out.push({ at: p.endAt, kind: 'end', i: 0 });
  const order: Record<BasketballCueKind, number> = {
    charge: 0, hoop: 1, dribble: 2, squeak: 3, pass: 4, catch: 5, pump: 6, jump: 7, release: 8, bounce: 9, impact: 10, home: 11, end: 12,
  };
  return out.sort((a, b) => a.at - b.at || order[a.kind] - order[b.kind]);
}

// ─── the geometry (pure) ───────────────────────────────────────────────────────────────────────────────────────

export interface Frame { x0: number; y0: number; x1: number; y1: number }

export interface BasketballGeo {
  /** Unit, striker -> target, and the distance. */
  u: Pt;
  dist: number;
  /** Every point below is SCREEN px. */
  mid: Pt;
  /** II: the fadeaway's landing spot (backwards and to `side`). */
  fade: Pt;
  side: 1 | -1;
  /** III: where the scoot up court stops, where the pass enters (off the right edge), and the step back's spot. */
  scoot: Pt;
  passFrom: Pt;
  back: Pt;
  /** IV: where the quick run-up ends and it leaps from. */
  half: Pt;
  /** Unit from the target toward the catch ("up", swung round toward the middle when a frame edge is in the way). */
  up: Pt;
  /** IV: the ball at the top of its bounce off the target, and the portrait catching it there. */
  ballApex: Pt;
  catchAt: Pt;
  /** IV: the portrait on the slam (overlapping the target; the BALL hits the target's centre), and the rebound. */
  contact: Pt;
  rebound: Pt;
  /** The target's centre: where every shot and slam lands. */
  hit: Pt;
}

const inFrame = (p: Pt, f: Frame | null, m: number): boolean => !f || (p.x >= f.x0 + m && p.x <= f.x1 - m && p.y >= f.y0 + m && p.y <= f.y1 - m);

/** A point clamped inside the frame with `m` px to spare (a tiny frame: its middle). Pure. */
export function clampToFrame(p: Pt, f: Frame | null, m: number): Pt {
  if (!f) return p;
  const cx = (f.x0 + f.x1) / 2, cy = (f.y0 + f.y1) / 2;
  const x = f.x1 - f.x0 > 2 * m ? clamp(p.x, f.x0 + m, f.x1 - m) : cx;
  const y = f.y1 - f.y0 > 2 * m ? clamp(p.y, f.y0 + m, f.y1 - m) : cy;
  return { x, y };
}

/**
 * The unit direction from `d` toward a point `dist` px away that fits inside the frame with `margin` to spare:
 * `pref` first, then a little shorter, then swung round a little more each try (toward the middle of the frame first).
 * Last resort: toward the middle of the frame. Pure.
 */
export function fitDir(d: Pt, pref: Pt, dist: number, frame: Frame | null, margin: number): { dir: Pt; k: number } {
  const a0 = Math.atan2(pref.y, pref.x);
  const mid = frame ? { x: (frame.x0 + frame.x1) / 2 - d.x, y: (frame.y0 + frame.y1) / 2 - d.y } : { x: 0, y: 0 };
  const turn = pref.x * mid.y - pref.y * mid.x >= 0 ? 1 : -1;
  for (const off of [0, 0.3, 0.6, 0.9, 1.2, 1.5, 1.8, 2.1, 2.5, 2.9]) {
    for (const sgn of off === 0 ? [1] : [turn, -turn]) {
      for (const k of [1, 0.8, 0.65]) {
        const a = a0 + sgn * off;
        const dir = { x: Math.cos(a), y: Math.sin(a) };
        if (inFrame({ x: d.x + dir.x * dist * k, y: d.y + dir.y * dist * k }, frame, margin)) return { dir, k };
      }
    }
  }
  const ml = Math.hypot(mid.x, mid.y);
  return { dir: ml > 1 ? { x: mid.x / ml, y: mid.y / ml } : pref, k: 0.65 };
}

/** Where every move goes, from the two heroes and the frame (screen px). Pure. */
export function basketballGeo(a: Pt, d: Pt, aR: number, dR: number, frame: Frame | null, c: HeroBasketballConfig = store.get()): BasketballGeo {
  const dx = d.x - a.x, dy = d.y - a.y;
  const dist = Math.hypot(dx, dy) || 1;
  const u = { x: dx / dist, y: dy / dist };
  const n = { x: -u.y, y: u.x };
  const m = aR * 0.9;
  const clear = (aR + dR) * 1.2; // never closer than this to the target on a run
  const along = (s: number): Pt => ({ x: a.x + u.x * s, y: a.y + u.y * s });
  const mid = clampToFrame(along(clamp(dist * c.midCourt, 0, Math.max(0, dist - clear))), frame, m);
  // II: backwards (away from the target) and to the side with more room.
  const fadeAt = (sg: number): Pt => ({ x: mid.x - u.x * c.fadeBack * aR + n.x * sg * c.fadeSide * aR, y: mid.y - u.y * c.fadeBack * aR + n.y * sg * c.fadeSide * aR });
  const room = (p: Pt): number => (frame ? Math.min(p.x - frame.x0, frame.x1 - p.x, p.y - frame.y0, frame.y1 - p.y) : 0);
  const midX = frame ? (frame.x0 + frame.x1) / 2 : a.x;
  const r1 = room(fadeAt(1)), r2 = room(fadeAt(-1));
  const side: 1 | -1 = Math.abs(r1 - r2) > 1 ? (r1 >= r2 ? 1 : -1) : ((fadeAt(1).x - mid.x) * (midX - mid.x) >= 0 ? 1 : -1);
  const fade = clampToFrame(fadeAt(side), frame, m);
  // III: STRAIGHT up court (screen up for you at the bottom; screen down for a foe striking from the top).
  const courtUp = dy <= 0 ? -1 : 1;
  const scoot = clampToFrame({ x: a.x, y: a.y + courtUp * aR * c.scootUp }, frame, aR * 1.05);
  const passFrom = { x: (frame ? frame.x1 : a.x + 1200) + aR * c.ballSize * 1.5, y: scoot.y + aR * c.passEntry };
  const back = clampToFrame({ x: scoot.x - u.x * aR * c.dribbleBack, y: scoot.y - u.y * aR * c.dribbleBack }, frame, aR * 1.05);
  // IV: the run-up spot, and the catch "above" the target (screen up, swung toward the middle when an edge is in the way).
  const half = clampToFrame(along(clamp(dist * c.halfCourt, 0, Math.max(0, dist - clear))), frame, m);
  const reach = Math.max(dR * c.alleyRise, aR * 1.2);
  const { dir: up, k: fitK } = fitDir(d, { x: 0, y: -1 }, reach, frame, Math.max(m * 0.6, aR * 0.5));
  const ballApex = clampToFrame({ x: d.x + up.x * dR * c.alleyRise * fitK, y: d.y + up.y * dR * c.alleyRise * fitK }, frame, aR * 0.4);
  const catchPt = clampToFrame({ x: ballApex.x - up.x * aR * 0.75, y: ballApex.y - up.y * aR * 0.75 }, frame, m * 0.85);
  const contact = { x: d.x + up.x * aR * c.slamContact, y: d.y + up.y * aR * c.slamContact };
  const rebound = clampToFrame({ x: contact.x + up.x * aR * 0.35, y: contact.y + up.y * aR * 0.35 }, frame, m * 0.85);
  return { u, dist, mid, fade, side, scoot, passFrom, back, half, up, ballApex, catchAt: catchPt, contact, rebound, hit: { ...d } };
}

// ─── the pose (pure) ───────────────────────────────────────────────────────────────────────────────────────────

/**
 * The striking portrait at a moment: an offset from its slot (screen px), a tilt (degrees), a scale, how far off the
 * floor it is (`air`, 0..1: its shadow drops away and shrinks), and a squash (vertical, on landings and the slam).
 */
export interface BasketballPose { x: number; y: number; rot: number; scale: number; air: number; squash: number }

const REST: BasketballPose = { x: 0, y: 0, rot: 0, scale: 1, air: 0, squash: 0 };
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const easeIn = (u: number): number => { const x = clamp01(u); return x * x * x; };
const easeInQuad = (u: number): number => { const x = clamp01(u); return x * x; };
const easeOutQuad = (u: number): number => { const x = clamp01(u); return 1 - (1 - x) * (1 - x); };

export interface Seg { t0: number; t1: number; p0: Pt; p1: Pt; ease: (u: number) => number; air0: number; air1: number; hop: number; rot0: number; rot1: number; sc0: number; sc1: number }

/** The portrait's keyframes for a plan (offsets from its slot). Pure. */
export function poseSegs(p: BasketballPlan, g: BasketballGeo, c: HeroBasketballConfig, a: Pt, aR: number): Seg[] {
  if (p.reduced) return [];
  const rel = (q: Pt): Pt => ({ x: q.x - a.x, y: q.y - a.y });
  const O = { x: 0, y: 0 };
  const js = p.jumpScale;
  const seg = (t0: number, t1: number, p0: Pt, p1: Pt, o: Partial<Omit<Seg, 't0' | 't1' | 'p0' | 'p1'>> = {}): Seg => ({
    t0, t1: Math.max(t0 + 1, t1), p0, p1, ease: easeInOutSine, air0: 0, air1: 0, hop: 0, rot0: 0, rot1: 0, sc0: 1, sc1: 1, ...o,
  });
  const lean = c.fadeLean * (g.u.x >= 0 ? -1 : 1); // leans AWAY from the target (its top tipping back)
  const drive = 4 * (g.u.x >= 0 ? 1 : -1); // a small lean into a run
  if (p.kind === 'jumper') {
    const top = { x: 0, y: -aR * c.jumpLift };
    return [
      seg(p.gatherAt, p.takeoffAt, O, O, { sc0: 1, sc1: 0.95 }),
      seg(p.takeoffAt, p.apexAt, O, top, { ease: easeOutCubic, air1: 1, sc0: 0.95, sc1: 1 + js }),
      seg(p.apexAt, p.landAt, top, O, { ease: easeInQuad, air0: 1, sc0: 1 + js, sc1: 1 }),
    ];
  }
  if (p.kind === 'fadeaway') {
    const mid = rel(g.mid), fade = rel(g.fade);
    return [
      seg(p.startAt, p.approachEnd, O, mid, { rot1: drive }),
      seg(p.approachEnd, p.takeoffAt, mid, mid, { rot0: drive, sc1: 0.95 }),
      seg(p.takeoffAt, p.landAt, mid, fade, { ease: easeOutCubic, hop: 1, rot1: lean, sc0: 0.95, sc1: 1 }),
      seg(p.landAt, p.homeAt, fade, fade, { rot0: lean }),
      seg(p.homeAt, p.homeEnd, fade, O),
    ];
  }
  if (p.kind === 'three') {
    const sc = rel(g.scoot), bk = rel(g.back);
    const top = { x: bk.x, y: bk.y - aR * c.jumpLift * 1.3 };
    const pumpMid = p.pumpAt! + (p.pumpEnd! - p.pumpAt!) * 0.45;
    const turn = 6; // a glance toward the pass (it comes from the right)
    return [
      seg(p.startAt, p.approachEnd, O, sc, { ease: easeOutCubic }),
      seg(p.approachEnd, p.catchAt!, sc, sc, { rot1: turn, ease: easeOutQuad }),
      seg(p.catchAt!, p.pumpAt!, sc, sc, { rot0: turn, rot1: 0, sc1: 0.97 }),
      // THE PUMP FAKE: up on the toes as if to shoot (the ball rises), then straight back down.
      seg(p.pumpAt!, pumpMid, sc, { x: sc.x, y: sc.y - aR * 0.08 }, { ease: easeOutQuad, air1: 0.25, sc0: 0.97, sc1: 1 + js * 0.6 }),
      seg(pumpMid, p.pumpEnd!, { x: sc.x, y: sc.y - aR * 0.08 }, sc, { ease: easeInQuad, air0: 0.25, sc0: 1 + js * 0.6, sc1: 0.97 }),
      // THE DRIBBLE BACK: a step back away from the target, leaning back.
      seg(p.backAt!, p.backEnd!, sc, bk, { rot1: lean * 0.5, sc0: 0.97, sc1: 1 }),
      seg(p.backEnd!, p.takeoffAt, bk, bk, { rot0: lean * 0.5, rot1: lean * 0.3, sc1: 0.94 }),
      // THE PULL-UP: straight up, the release at the top, and down.
      seg(p.takeoffAt, p.apexAt, bk, top, { ease: easeOutCubic, air1: 1, rot0: lean * 0.3, rot1: lean * 0.4, sc0: 0.94, sc1: 1 + js }),
      seg(p.apexAt, p.landAt, top, bk, { ease: easeInQuad, air0: 1, rot0: lean * 0.4, sc0: 1 + js, sc1: 1 }),
      seg(p.landAt, p.homeAt, bk, bk),
      seg(p.homeAt, p.homeEnd, bk, O),
    ];
  }
  // THE SELF ALLEY-OOP.
  const back = { x: -g.u.x * aR * 0.12, y: -g.u.y * aR * 0.12 };
  const follow = { x: g.u.x * aR * 0.1, y: g.u.y * aR * 0.1 };
  const half = rel(g.half), cat = rel(g.catchAt), hang = { x: cat.x + g.up.x * aR * 0.12, y: cat.y + g.up.y * aR * 0.12 };
  const hit = rel(g.contact), reb = rel(g.rebound);
  return [
    seg(p.gatherAt, p.releaseAt, O, back, { ease: easeOutQuad, rot1: -drive * 1.5, sc1: 0.96 }),
    seg(p.releaseAt, p.approachAt, back, follow, { ease: easeOutCubic, rot0: -drive * 1.5, rot1: drive, sc0: 0.96, sc1: 1 }),
    seg(p.approachAt, p.approachEnd, follow, half, { ease: easeOutQuad, rot0: drive, rot1: drive * 1.5 }),
    seg(p.approachEnd, p.takeoffAt, half, half, { rot0: drive * 1.5, sc1: 0.88 }),
    seg(p.takeoffAt, p.catchAt!, half, cat, { ease: easeOutCubic, air1: 1, sc0: 0.88, sc1: 1 + js }),
    seg(p.catchAt!, p.slamAt!, cat, hang, { ease: easeOutQuad, air0: 1, air1: 1, sc0: 1 + js, sc1: 1 + js * 1.05 }),
    seg(p.slamAt!, p.impactAt, hang, hit, { ease: easeIn, air0: 1, air1: 0.55, sc0: 1 + js * 1.05, sc1: 1 + js * 0.6 }),
    seg(p.impactAt, p.homeAt, hit, reb, { ease: easeOutCubic, air0: 0.55, air1: 0.35, sc0: 1 + js * 0.6, sc1: 1 + js * 0.4 }),
    seg(p.homeAt, p.homeEnd, reb, O, { air0: 0.35, sc0: 1 + js * 0.4 }),
  ];
}

/** Where the striking portrait is at sequence time `t` (its slot is (0, 0)). Pure and deterministic. */
export function basketballPose(p: BasketballPlan, segs: readonly Seg[], c: HeroBasketballConfig, t: number): BasketballPose {
  if (p.reduced || !segs.length || t < segs[0]!.t0 || t >= p.endAt) return { ...REST };
  // The segment in force (the latest that has started); past the last one, its end.
  let s = segs[0]!;
  for (const q of segs) if (t >= q.t0) s = q;
  const u = clamp01((t - s.t0) / (s.t1 - s.t0));
  const e = s.ease(u);
  const hop = s.hop * 4 * u * (1 - u);
  const air = clamp01(lerp(s.air0, s.air1, u) + hop);
  const pose: BasketballPose = {
    x: lerp(s.p0.x, s.p1.x, e),
    y: lerp(s.p0.y, s.p1.y, e) - hop * 22,
    rot: lerp(s.rot0, s.rot1, e),
    scale: lerp(s.sc0, s.sc1, e) * (1 + p.jumpScale * 0.4 * hop),
    air,
    squash: 0,
  };
  // The squash: on the landing (I-III) and on the slam (IV).
  const land = p.kind === 'alleyoop' ? p.impactAt : p.landAt;
  if (t >= land) pose.squash = c.squash * 0.8 * Math.max(0, spring(t - land, 4, 70));
  if (t >= p.homeEnd && p.homeEnd > p.homeAt) pose.squash += c.squash * 0.4 * Math.max(0, spring(t - p.homeEnd, 4, 60));
  return pose;
}

// ─── the ball (pure) ───────────────────────────────────────────────────────────────────────────────────────────

export interface BallState { visible: boolean; x: number; y: number; rot: number; scale: number; alpha: number; air: number; squash: number; flying: boolean }

const HIDDEN: BallState = { visible: false, x: 0, y: 0, rot: 0, scale: 1, alpha: 0, air: 0, squash: 0, flying: false };

/** How high a shot's arc rises (px), trimmed so the ball never leaves the top of the frame. Pure. */
export function arcHeight(from: Pt, to: Pt, arc: number, frame: Frame | null, margin: number): number {
  let h = Math.max(0, arc) * Math.hypot(to.x - from.x, to.y - from.y);
  if (!frame || h <= 0) return h;
  for (let tries = 0; tries < 12; tries++) {
    let top = Infinity;
    for (let i = 0; i <= 16; i++) { const v = i / 16; top = Math.min(top, lerp(from.y, to.y, v) - h * 4 * v * (1 - v)); }
    if (top >= frame.y0 + margin) return h;
    h *= 0.75;
  }
  return h;
}

/** Everything the ball's path needs (measured once). */
export interface BallCtx { p: BasketballPlan; g: BasketballGeo; segs: readonly Seg[]; c: HeroBasketballConfig; a: Pt; aR: number; frame: Frame | null }

/** The spin direction (backspin: turning against the travel's x). */
const spinSign = (from: Pt, to: Pt): number => (to.x - from.x >= 0 ? -1 : 1);

/** How far the ball is cocked OVER the head at `t` (0 = held at the front, 1 = over the head). Pure. */
function overBlend(p: BasketballPlan, t: number): number {
  const ramp = (from: number): number => (t >= from ? easeOutCubic((t - from) / 120) : 0);
  if (p.kind === 'three') {
    // The pump fake lifts it and pulls it back down; the pull-up lifts it for good.
    const a = p.pumpAt!, e = p.pumpEnd!;
    const pump = t >= a && t < e ? Math.sin(Math.PI * ((t - a) / Math.max(1, e - a))) : 0;
    return Math.max(pump, ramp(p.gatherAt));
  }
  if (p.kind === 'alleyoop') return t < p.releaseAt ? ramp(p.gatherAt) : ramp(p.catchAt!);
  return ramp(p.gatherAt);
}

/** The ball at sequence time `t` (screen px). Pure and deterministic. */
export function basketballBall(x: BallCtx, t: number): BallState {
  const { p, g, c, a, aR } = x;
  if (p.reduced || t < p.chargeAt || t >= p.endAt) return { ...HIDDEN };
  const pose = (tt: number): BasketballPose => basketballPose(p, x.segs, c, tt);
  const popIn = easeOutCubic((t - p.chargeAt) / 140);
  // HELD: at the front of the portrait (toward the target), dribbling; or cocked OVER its head for a shot or a slam.
  const held = (tt: number): BallState => {
    const q = pose(tt);
    const px = a.x + q.x, py = a.y + q.y;
    const upd = p.kind === 'alleyoop' && tt >= (p.catchAt ?? Infinity) ? g.up : { x: 0, y: -1 };
    const ob = overBlend(p, tt);
    const fx = g.u.x * aR * 0.8, fy = g.u.y * aR * 0.8;
    // III's pump fake lifts the ball straight up from the hands; every real shot or slam cocks it over the head.
    const pumping = p.kind === 'three' && tt < p.gatherAt;
    const ox = pumping ? fx : upd.x * aR * 0.8 * q.scale, oy = pumping ? fy - aR * c.pumpLift : upd.y * aR * 0.8 * q.scale;
    const bx = px + lerp(fx, ox, ob);
    let by = py + lerp(fy, oy, ob);
    let squash = 0;
    // A dribble: down to the floor (screen down) at the bounce time, and back up to the hand.
    const half = p.dribbleMs * 0.45;
    for (const h of p.dribbles) {
      const dt = tt - h;
      if (Math.abs(dt) >= half) continue;
      const v = dt / half;
      by += aR * 0.6 * (1 - v * v);
      if (Math.abs(dt) < 40) squash = 0.18 * (1 - Math.abs(dt) / 40);
    }
    return { visible: true, x: bx, y: by, rot: 0, scale: q.scale, alpha: 1, air: q.air * 0.8, squash, flying: false };
  };
  const flight = (from: Pt, to: Pt, t0: number, t1: number, arc: number, spinK = 1): BallState => {
    const u = clamp01((t - t0) / Math.max(1, t1 - t0));
    const h = arcHeight(from, to, arc, x.frame, aR * c.ballSize * 0.6);
    const lift = 4 * u * (1 - u);
    return {
      visible: true, x: lerp(from.x, to.x, u), y: lerp(from.y, to.y, u) - h * lift,
      rot: spinSign(from, to) * spinK * c.spin * 2 * Math.PI * ((t - t0) / 1000), scale: 1 + 0.08 * lift, alpha: 1, air: Math.min(1, lift + 0.15), squash: 0, flying: true,
    };
  };
  const dropFrom = (at: Pt, t0: number, dir: number): BallState => {
    // Through the net and away: it falls, slows sideways, fades.
    const s = (t - t0) / 1000;
    const k = clamp01((t - t0) / 460);
    return {
      visible: k < 1, x: at.x + dir * 60 * s * aR / 80, y: at.y + 0.5 * 2400 * s * s * (aR / 80) + 40 * s, rot: dir * 5 * s,
      scale: 1 - 0.1 * k, alpha: 1 - easeInQuad(k), air: 0.1, squash: 0, flying: false,
    };
  };
  const popped = (s: BallState): BallState => ({ ...s, scale: s.scale * popIn });
  if (p.kind === 'jumper' || p.kind === 'fadeaway' || p.kind === 'three') {
    if (p.kind === 'three' && t < p.catchAt!) {
      // THE PASS: nothing in the hands until it flies in from off the right edge.
      if (t < p.passAt!) return { ...HIDDEN };
      return { ...flight(g.passFrom, held(p.catchAt!), p.passAt!, p.catchAt!, c.passArc, -0.6), air: 0.3 };
    }
    const rel = p.releaseAt;
    if (t < rel) return p.kind === 'three' ? held(t) : popped(held(t));
    if (t < p.impactAt) return flight(held(rel), g.hit, rel, p.impactAt, p.arc);
    return dropFrom(g.hit, p.impactAt, g.u.x >= 0 ? 1 : -1);
  }
  // THE SELF ALLEY-OOP: held, FIRED flat at the target, a smack and a high bounce straight up, caught at the top of the
  // leap, held over the head, slammed.
  const rel = p.releaseAt, bounce = p.bounceAt!, caught = p.catchAt!;
  if (t < rel) return popped(held(t));
  if (t < bounce) return flight(held(rel), g.hit, rel, bounce, p.arc, 1.8);
  if (t < caught) {
    const u = easeOutQuad((t - bounce) / Math.max(1, caught - bounce));
    const sq = t - bounce < 60 ? 0.3 * (1 - (t - bounce) / 60) : 0;
    return {
      visible: true, x: lerp(g.hit.x, g.ballApex.x, u), y: lerp(g.hit.y, g.ballApex.y, u), rot: -c.spin * 2 * Math.PI * ((t - bounce) / 1000),
      scale: 1 + 0.12 * u, alpha: 1, air: u, squash: sq, flying: true,
    };
  }
  if (t < p.slamAt!) return held(t);
  if (t < p.impactAt) {
    const from = held(p.slamAt!);
    const u = easeIn((t - p.slamAt!) / Math.max(1, p.impactAt - p.slamAt!));
    return { ...from, x: lerp(from.x, g.hit.x, u), y: lerp(from.y, g.hit.y, u), rot: -u * 1.4, air: lerp(from.air, 0, u) };
  }
  return dropFrom(g.hit, p.impactAt, g.u.x >= 0 ? -1 : 1);
}

// ─── the hoop (pure) ───────────────────────────────────────────────────────────────────────────────────────────

/** The hoop drawn on the target: its opacity and the rim's rattle (a tilt, radians). IV's backboard is gone at the slam. */
export function hoopAt(p: BasketballPlan, t: number): { alpha: number; rattle: number; board: boolean } {
  if (p.reduced) return { alpha: 0, rattle: 0, board: false };
  const inAt = hoopInAt(p);
  if (t < inAt) return { alpha: 0, rattle: 0, board: false };
  const fadeIn = easeOutCubic((t - inAt) / 160);
  const outFrom = p.impactAt + (p.kind === 'alleyoop' ? 380 : 280);
  const out = clamp01((t - outFrom) / 260);
  const shake = p.kind === 'alleyoop' ? 0.22 : 0.05;
  const rattle = (t >= p.impactAt ? shake * spring(t - p.impactAt, 9, 180) : 0)
    + (p.bounceAt !== null && t >= p.bounceAt ? 0.08 * spring(t - p.bounceAt, 9, 120) : 0);
  return { alpha: fadeIn * (1 - out), rattle, board: p.kind !== 'alleyoop' || t < p.impactAt };
}

// ─── the camera (pure) ─────────────────────────────────────────────────────────────────────────────────────────

/**
 * The camera: it pushes in on the target while the shot flies (I-III) or through the leap (IV), punches and shakes on
 * the impact along the blow, and IV rumbles the whole board. Pure.
 */
export function basketballCameraAt(p: BasketballPlan, c: HeroBasketballConfig, t: number, dir: Pt): { zoom: number; x: number; y: number } {
  if (p.reduced) return { zoom: 1, x: 0, y: 0 };
  const inFrom = p.kind === 'alleyoop' ? p.takeoffAt : p.releaseAt - 120;
  const push = t < inFrom ? 0 : t < p.impactAt ? easeInOutSine((t - inFrom) / Math.max(1, p.impactAt - inFrom)) : 1 - easeInOutSine((t - p.impactAt) / Math.max(1, c.zoomOutMs));
  let z = p.zoom * clamp01(push);
  let x = 0, y = 0;
  const tau = Math.max(1, c.shakeMs / 4);
  if (t >= p.impactAt) {
    const age = t - p.impactAt;
    z += p.punch * Math.exp(-age / tau);
    const s = spring(age, 15, tau) * p.shakePx;
    x += dir.x * s; y += dir.y * s;
    if (p.kind === 'alleyoop') {
      // The whole board shakes: a rumble across both axes dying away.
      const r = p.shakePx * 0.45 * Math.exp(-age / (tau * 2.2));
      x += Math.sin(age * 0.137) * r; y += Math.cos(age * 0.101) * r;
    }
  }
  if (p.bounceAt !== null && t >= p.bounceAt && t < p.impactAt) {
    const s = spring(t - p.bounceAt, 16, tau * 0.6) * p.shakePx * 0.2;
    x += dir.x * s; y += dir.y * s;
  }
  return { zoom: 1 + z, x, y };
}
