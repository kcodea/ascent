/**
 * THE SOCCER HERO ATTACK ("Golazo", a Legendary with four tiers): its tuned values, its pure timeline, the pure
 * geometry (the corner spot, the header point, the breakaway run and its defenders, the bicycle kick's spot), the pure
 * pose of the striking PORTRAIT, the pure path of the ball, the goal on the target and the camera.
 *
 * Owner 2026-11-02: "make 2 attack animations, a soccer one, and a baseball one. get creative and fun with them, like a
 * corner kick for soccer then a breakaway etc."
 *
 * THE SIGNATURE: a GOAL (two posts, a crossbar and a net) stands on the struck hero, and every blow ends with the ball
 * BULGING THE NET. The striker is the PORTRAIT itself (it juggles, jogs, dribbles and flips), as the Basketball's does.
 *
 * FOUR TIERS on the shared thresholds (`attackTier`: a knockout always plays IV):
 *  - I THE VOLLEY: keepy-uppies where it stands (the ball bobbing off its feet), one higher flick, a hop, and a crisp
 *    volley on a low line into the goal: the net bulges (THE impact).
 *  - II THE CORNER KICK: the portrait jogs out to the CORNER FLAG at the target's end, sets the ball, steps back, raises
 *    an arm, and strikes. One of three corners, rolled per blow:
 *     1. the OLIMPICO: an inswinger that bends all the way into the goal, straight from the corner;
 *     2. the HEADER: an outswinger curled to the penalty spot; the portrait sprints in, leaps and heads it home;
 *     3. the SHORT CORNER: a short pass off the edge of the screen, the one-two back to it, and a first-time curler.
 *  - III THE BREAKAWAY: it dribbles up the pitch from its slot past DEFENDERS (dark foe tokens that lunge and are
 *    beaten), one of three skills rolled per blow (STEPOVERS, a NUTMEG through the legs, a RAINBOW FLICK over the
 *    head), then a slow-mo last touch and a placed finish into the goal (THE impact).
 *  - IV THE BICYCLE KICK: two keepy-uppies, a huge flick SKY HIGH, a full sprint to the spot where the ball will come
 *    down (its shadow marks the landing), a crouch, a leap and a backward FLIP; at the top, upside down, in deep slow
 *    mo, the bicycle kick; time snaps back and a THUNDERBOLT rockets into the goal: the net bursts out, the frame rings,
 *    an explosion, confetti and the crowd's roar (THE impact). Then a knee-slide celebration and home.
 *
 * The roll is `variantOf(rollSeed)`: a stable per-blow seed (the run seed and the round), so a replay rolls the same.
 * The DEV tuner's "Variation" row forces one. Slow mo (`soccerTimeScale`) is III's last touch and IV's contact: a smooth
 * ramp that never reaches 0 (never a freeze); everything reads the one clock, and the blow still lands once, on its beat.
 *
 * Every point the portrait visits is kept on screen, and every shot lands on the target's centre (the hit point never
 * leaves the target). No hit-stop anywhere; flat 2D.
 */
import { configStore } from '../heroAttack/configStore';
import { clamp, clamp01, easeInOutSine, easeOutCubic, spring, type Pt } from '../heroAttack/easing';
import {
  HERO_ATTACK_TIER_THRESHOLDS, TIERS, reducedAttackTimeline, attackTier, type AttackTierContext, type TierNum,
} from '../heroAttack/tiers';

export { TIERS };
export type { TierNum };

export const SOCCER_KINDS = ['volley', 'corner', 'breakaway', 'bicycle'] as const;
export type SoccerKind = (typeof SOCCER_KINDS)[number];

/** Each tier's move. */
export function soccerKind(tier: TierNum): SoccerKind { return SOCCER_KINDS[tier - 1]!; }

/** The tier dial groups the tuner shows (`t1` ... `t4`). */
export const SOCCER_LEVELS = ['t1', 't2', 't3', 't4'] as const;

export const SOCCER_TIER_SUFFIXES = [
  'ReadyMs', 'Touches', 'TouchMs', 'ApproachMs', 'LeapMs', 'FlightMs', 'Arc', 'HoldMs', 'ReturnMs',
  'JumpScale', 'Zoom', 'Punch', 'Shake', 'Burst', 'Rings', 'Confetti', 'Bulge', 'Dim',
] as const;
export type SoccerTierSuffix = (typeof SOCCER_TIER_SUFFIXES)[number];
type TierKey = `t${TierNum}${SoccerTierSuffix}`;

interface GlobalConfig {
  tier2At: number; tier3At: number; tier4At: number;
  absorbMs: number;
  gatherMs: number;
  ballSize: number;
  spin: number;
  trailMs: number;
  juggleHeight: number;
  volleyHop: number;
  cornerSetMs: number;
  cornerRunMs: number;
  curl: number;
  headerFlightMs: number;
  oneTwoMs: number;
  defenders: number;
  beatWidth: number;
  skillMs: number;
  skyHeight: number;
  crouchMs: number;
  flipTurns: number;
  slideMs: number;
  breakSlow: number;
  breakSlowMs: number;
  bikeSlow: number;
  bikeSlowMs: number;
  rocketBoost: number;
  slowRampMs: number;
  slowZoom: number;
  /** DEV: '' = rolled per blow, '1' / '2' / '3' force a variation (a string so the tuner shows it as a select). */
  variation: string;
  blastSize: number;
  launchSize: number;
  shadowDrop: number;
  goalSize: number;
  wordSize: number;
  knockPx: number;
  squash: number;
  shakeMs: number;
  zoomOutMs: number;
  reducedFadeMs: number;
  colorBall: string;
  colorPost: string;
  colorNet: string;
  colorFlag: string;
  colorDefender: string;
  colorFlash: string;
  colorFire: string;
  colorBlast: string;
  colorConfettiA: string;
  colorConfettiB: string;
  colorPlayer: string;
  colorFoe: string;
  sfxWhistleClip: string; sfxWhistleGain: number; sfxWhistleRate: number;
  sfxKickClip: string; sfxKickGain: number; sfxKickRate: number;
  sfxTouchClip: string; sfxTouchGain: number; sfxTouchRate: number;
  sfxWhooshClip: string; sfxWhooshGain: number; sfxWhooshRate: number;
  sfxNetClip: string; sfxNetGain: number; sfxNetRate: number;
  sfxPostClip: string; sfxPostGain: number; sfxPostRate: number;
  sfxBoomClip: string; sfxBoomGain: number; sfxBoomRate: number;
  sfxOohClip: string; sfxOohGain: number; sfxOohRate: number;
  sfxRoarClip: string; sfxRoarGain: number; sfxRoarRate: number;
  sfxGolazoClip: string; sfxGolazoGain: number; sfxGolazoRate: number;
  sfxDuck: number;
  previewDamage: number;
  previewParts: number;
}
export type HeroSoccerConfig = GlobalConfig & Record<TierKey, number>;

export const HERO_SOCCER_COLOR_KEYS = [
  'colorBall', 'colorPost', 'colorNet', 'colorFlag', 'colorDefender', 'colorFlash', 'colorFire', 'colorBlast', 'colorConfettiA', 'colorConfettiB',
  'colorPlayer', 'colorFoe',
] as const;
export const HERO_SOCCER_CLIP_KEYS = [
  'sfxWhistleClip', 'sfxKickClip', 'sfxTouchClip', 'sfxWhooshClip', 'sfxNetClip', 'sfxPostClip', 'sfxBoomClip', 'sfxOohClip', 'sfxRoarClip', 'sfxGolazoClip',
] as const;
export type HeroSoccerStrKey = (typeof HERO_SOCCER_COLOR_KEYS)[number] | (typeof HERO_SOCCER_CLIP_KEYS)[number] | 'variation';
export type HeroSoccerNumKey = Exclude<keyof HeroSoccerConfig, HeroSoccerStrKey>;

/** Per tier: [I, II, III, IV]. A dial a tier's move does not use is ignored there (the tuner says which). */
const TIER_DEFAULTS: Record<SoccerTierSuffix, [number, number, number, number]> = {
  ReadyMs: [120, 110, 100, 100],
  Touches: [2, 0, 5, 2],
  TouchMs: [240, 240, 230, 220],
  ApproachMs: [0, 720, 1150, 620],
  LeapMs: [360, 420, 0, 640],
  FlightMs: [360, 900, 420, 230],
  Arc: [0.1, 0.18, 0.16, 0.02],
  HoldMs: [380, 260, 300, 360],
  ReturnMs: [0, 620, 560, 520],
  JumpScale: [0.05, 0.08, 0.06, 0.24],
  Zoom: [0.02, 0.025, 0.035, 0.06],
  Punch: [0.01, 0.015, 0.02, 0.05],
  Shake: [2, 3, 6, 22],
  Burst: [0.8, 1, 1.3, 1.9],
  Rings: [1, 1, 2, 5],
  Confetti: [0, 0, 14, 40],
  Bulge: [0.12, 0.16, 0.22, 0.45],
  Dim: [0.1, 0.14, 0.18, 0.3],
};

export const SOCCER_TIER_RANGES: Record<SoccerTierSuffix, [number, number, number]> = {
  ReadyMs: [0, 1000, 10],
  Touches: [0, 8, 1],
  TouchMs: [100, 600, 10],
  ApproachMs: [0, 2000, 10],
  LeapMs: [0, 1400, 10],
  FlightMs: [80, 1800, 10],
  Arc: [0, 1, 0.01],
  HoldMs: [0, 1500, 10],
  ReturnMs: [0, 1500, 10],
  JumpScale: [0, 0.5, 0.01],
  Zoom: [0, 0.2, 0.005],
  Punch: [0, 0.1, 0.001],
  Shake: [0, 40, 0.5],
  Burst: [0, 3, 0.05],
  Rings: [0, 8, 1],
  Confetti: [0, 80, 1],
  Bulge: [0, 1, 0.01],
  Dim: [0, 0.6, 0.01],
};

const tierDefaults = Object.fromEntries(TIERS.flatMap((t) => SOCCER_TIER_SUFFIXES.map((s) => [`t${t}${s}`, TIER_DEFAULTS[s][t - 1]]))) as Record<TierKey, number>;

export const HERO_SOCCER_DEFAULTS: HeroSoccerConfig = {
  ...HERO_ATTACK_TIER_THRESHOLDS,
  absorbMs: 180,
  gatherMs: 110,
  ballSize: 0.34,
  spin: 2.2,
  trailMs: 26,
  juggleHeight: 0.9,
  volleyHop: 0.2,
  cornerSetMs: 320,
  cornerRunMs: 200,
  curl: 0.34,
  headerFlightMs: 230,
  oneTwoMs: 260,
  defenders: 2,
  beatWidth: 1.15,
  skillMs: 280,
  skyHeight: 2.6,
  crouchMs: 180,
  flipTurns: 1,
  slideMs: 560,
  breakSlow: 0.45,
  breakSlowMs: 320,
  bikeSlow: 0.25,
  bikeSlowMs: 620,
  rocketBoost: 1.3,
  slowRampMs: 70,
  slowZoom: 0.015,
  variation: '',
  blastSize: 1.3,
  launchSize: 1.2,
  shadowDrop: 0.55,
  goalSize: 1,
  wordSize: 1,
  knockPx: 18,
  squash: 0.09,
  shakeMs: 300,
  zoomOutMs: 420,
  reducedFadeMs: 260,
  colorBall: '#ffffff',
  colorPost: '#ffffff',
  colorNet: '#e6eeff',
  colorFlag: '#ffd23f',
  colorDefender: '#2b3140',
  colorFlash: '#fff4dc',
  colorFire: '#ffb030',
  colorBlast: '#ff7a1a',
  colorConfettiA: '#3fd17a',
  colorConfettiB: '#ffd23f',
  colorPlayer: '#ffcf5a',
  colorFoe: '#ff6a5a',
  // The owner's ElevenLabs clips (2026-11-02): the whistle, the kick, the net, the crowd's "Ooooh", the goal roar and
  // the commentator's GOLAZO!, each trimmed to its hit and levelled to -20 LUFS.
  sfxWhistleClip: 'fx/soccer-whistle', sfxWhistleGain: 0.55, sfxWhistleRate: 1,
  sfxKickClip: 'fx/soccer-kick', sfxKickGain: 0.85, sfxKickRate: 1,
  sfxTouchClip: 'fx/soccer-kick', sfxTouchGain: 0.4, sfxTouchRate: 1.45,
  sfxWhooshClip: 'fx/stereogenicstudio-swish-swoosh-woosh-sfx-27-357164-3', sfxWhooshGain: 0.3, sfxWhooshRate: 1.1,
  sfxNetClip: 'fx/soccer-net', sfxNetGain: 0.85, sfxNetRate: 1,
  sfxPostClip: 'fx/bball-rim', sfxPostGain: 0.45, sfxPostRate: 1.35,
  // The boom is a SHARED clip (always decoded on a phone), so it costs the phone audio budget nothing (R-AUDIO-PREWARM-ATTACKS-01).
  sfxBoomClip: 'fx/universfield-ground-impact-352053', sfxBoomGain: 0.45, sfxBoomRate: 1,
  sfxOohClip: 'fx/soccer-crowd-ooh', sfxOohGain: 0.7, sfxOohRate: 1,
  sfxRoarClip: 'fx/soccer-goal-roar', sfxRoarGain: 0.55, sfxRoarRate: 1,
  sfxGolazoClip: 'fx/soccer-golazo', sfxGolazoGain: 0.9, sfxGolazoRate: 1,
  sfxDuck: 0.6,
  previewDamage: 12,
  previewParts: 4,
  ...tierDefaults,
};

const GLOBAL_RANGES: Record<Exclude<keyof GlobalConfig, HeroSoccerStrKey>, [number, number, number]> = {
  tier2At: [2, 40, 1], tier3At: [2, 60, 1], tier4At: [2, 80, 1],
  absorbMs: [60, 600, 10],
  gatherMs: [0, 400, 10],
  ballSize: [0.2, 1.2, 0.01],
  spin: [0, 8, 0.1],
  trailMs: [10, 120, 1],
  juggleHeight: [0, 2, 0.05],
  volleyHop: [0, 1, 0.01],
  cornerSetMs: [0, 1000, 10],
  cornerRunMs: [60, 800, 10],
  curl: [0, 1, 0.01],
  headerFlightMs: [80, 800, 10],
  oneTwoMs: [100, 800, 10],
  defenders: [1, 3, 1],
  beatWidth: [0, 3, 0.05],
  skillMs: [100, 800, 10],
  skyHeight: [0.5, 5, 0.05],
  crouchMs: [60, 600, 10],
  flipTurns: [0, 2, 1],
  slideMs: [0, 1500, 10],
  breakSlow: [0.2, 1, 0.01],
  breakSlowMs: [0, 1200, 10],
  bikeSlow: [0.2, 1, 0.01],
  bikeSlowMs: [0, 1500, 10],
  rocketBoost: [1, 2, 0.01],
  slowRampMs: [10, 300, 5],
  slowZoom: [0, 0.08, 0.001],
  blastSize: [0, 3, 0.05],
  launchSize: [0, 3, 0.05],
  shadowDrop: [0, 1.5, 0.01],
  goalSize: [0.3, 2.5, 0.05],
  wordSize: [0, 2.5, 0.05],
  knockPx: [0, 60, 1],
  squash: [0, 0.3, 0.01],
  shakeMs: [0, 1200, 10],
  zoomOutMs: [60, 1500, 10],
  reducedFadeMs: [60, 1000, 10],
  sfxWhistleGain: [0, 2, 0.05], sfxWhistleRate: [0.5, 2.5, 0.01],
  sfxKickGain: [0, 2, 0.05], sfxKickRate: [0.5, 2.5, 0.01],
  sfxTouchGain: [0, 2, 0.05], sfxTouchRate: [0.5, 2.5, 0.01],
  sfxWhooshGain: [0, 2, 0.05], sfxWhooshRate: [0.5, 2.5, 0.01],
  sfxNetGain: [0, 2, 0.05], sfxNetRate: [0.5, 2.5, 0.01],
  sfxPostGain: [0, 2, 0.05], sfxPostRate: [0.5, 2.5, 0.01],
  sfxBoomGain: [0, 2, 0.05], sfxBoomRate: [0.5, 2.5, 0.01],
  sfxOohGain: [0, 2, 0.05], sfxOohRate: [0.5, 2.5, 0.01],
  sfxRoarGain: [0, 2, 0.05], sfxRoarRate: [0.5, 2.5, 0.01],
  sfxGolazoGain: [0, 2, 0.05], sfxGolazoRate: [0.5, 2.5, 0.01],
  sfxDuck: [0, 1, 0.05],
  previewDamage: [1, 60, 1],
  previewParts: [1, 8, 1],
};

export const HERO_SOCCER_RANGES: Record<HeroSoccerNumKey, [number, number, number]> = {
  ...GLOBAL_RANGES,
  ...(Object.fromEntries(TIERS.flatMap((t) => SOCCER_TIER_SUFFIXES.map((s) => [`t${t}${s}`, SOCCER_TIER_RANGES[s]]))) as Record<TierKey, [number, number, number]>),
};

/** Hard caps (whatever the tuner says). */
export const SOCCER_CAPS = { shakePx: 40, touches: 8, defenders: 3 } as const;

const store = configStore<HeroSoccerConfig>({
  key: 'ascent.herosoccer.v1', defaults: HERO_SOCCER_DEFAULTS, ranges: HERO_SOCCER_RANGES,
  colorKeys: HERO_SOCCER_COLOR_KEYS, clipKeys: [...HERO_SOCCER_CLIP_KEYS, 'variation'], previewKeys: ['previewDamage', 'previewParts', 'variation'],
});
export const heroSoccerStore = store;
export const getHeroSoccerConfig = store.get;
export const clampHeroSoccerValue = store.clamp;
export const sanitizeHeroSoccerConfig = store.sanitize;
export const heroSoccerConfigJson = store.json;
/** The preview speed hook (Recruit + the Collection read one per style). Always 1: the tuner has no speed buttons. */
export function heroSoccerPreviewSpeed(): number { return 1; }

export function soccerTierDials(tier: TierNum, c: HeroSoccerConfig = store.get()): Record<SoccerTierSuffix, number> {
  return Object.fromEntries(SOCCER_TIER_SUFFIXES.map((s) => [s, c[`t${tier}${s}`]])) as Record<SoccerTierSuffix, number>;
}

// ─── the variation roll (pure) ──────────────────────────────────────────────────────────────────────────────────────

export type SoccerVariant = 1 | 2 | 3;
export const SOCCER_VARIANTS: readonly SoccerVariant[] = [1, 2, 3];
/** II's corners and III's skills, by variant. */
export const CORNER_KINDS: Record<SoccerVariant, string> = { 1: 'the Olimpico (an inswinger straight in)', 2: 'an outswinger and a header', 3: 'a short corner one-two' };
export const BREAKAWAY_SKILLS: Record<SoccerVariant, string> = { 1: 'stepovers', 2: 'a nutmeg', 3: 'a rainbow flick' };

/** The variation a blow plays: the DEV override when set, else rolled from the stable per-blow seed. Pure. */
export function variantOf(rollSeed: number, c: HeroSoccerConfig = store.get()): SoccerVariant {
  const forced = Number(c.variation);
  if (forced === 1 || forced === 2 || forced === 3) return forced;
  let h = ((Math.round(rollSeed) | 0) ^ 0x5bd1e995) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return ((h % 3) + 1) as SoccerVariant;
}

// ─── the pure plan ─────────────────────────────────────────────────────────────────────────────────────────────

export interface SoccerPlanInput extends AttackTierContext {
  leadIn?: number;
  total: number;
  reduced?: boolean;
  /** Which variation (II's corner, III's skill). Default 1. */
  variant?: SoccerVariant;
}

export interface SoccerPlan {
  reduced: boolean;
  tier: TierNum;
  kind: SoccerKind;
  variant: SoccerVariant;
  k: number;
  total: number;
  chargeAt: number;
  absorbEnd: number;
  /** The move starts (after the ready beat). */
  startAt: number;
  /** I / IV: the keepy-uppies (each a touch off the feet). III: the touches along the run. */
  touches: number[];
  touchMs: number;
  /** I: the higher flick before the volley. IV: the flick SKY HIGH. Null elsewhere. */
  flickAt: number | null;
  /** The run: II the jog to the corner, III the dribble up the pitch, IV the sprint to the spot. */
  approachAt: number;
  approachEnd: number;
  /** II: the ball set at the corner, the run-up begins. */
  setAt: number | null;
  runUpAt: number | null;
  /** III: when the portrait passes each defender (the skill), and the skill's window either side. */
  beats: number[];
  skillMs: number;
  /** II variant 2: the header (the ball meets the head); variant 3: the short pass out and the return. */
  headAt: number | null;
  passOutAt: number | null;
  returnAt: number | null;
  /** The crouch and the leap (I the volley hop, II-2 the header leap, IV the bicycle leap). */
  gatherAt: number;
  takeoffAt: number;
  landAt: number;
  /** THE STRIKE: the kick that sends the ball at the goal (I the volley, II the corner / the curler, III the finish, IV the bicycle kick). */
  strikeAt: number;
  /** THE impact: the ball in the net. The blow lands here, once. */
  impactAt: number;
  /** IV: the knee slide after the landing. */
  slideAt: number | null;
  slideEnd: number | null;
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
  confetti: number;
  bulge: number;
  dim: number;
}

/** The whole attack, in base ms. Pure and deterministic. */
export function soccerPlan(input: SoccerPlanInput, c: HeroSoccerConfig = store.get()): SoccerPlan {
  const total = Math.max(0, Math.round(input.total));
  const tier = attackTier(total, input, c); // a knockout always plays the shared Tier IV
  const kind = soccerKind(tier);
  const L = soccerTierDials(tier, c);
  const k = (tier - 1) / 3;
  const variant: SoccerVariant = input.variant ?? 1;
  const looks = {
    tier, kind, variant, k, total, touchMs: L.TouchMs, flightMs: Math.max(80, L.FlightMs), arc: L.Arc, jumpScale: L.JumpScale, zoom: L.Zoom, punch: L.Punch,
    shakePx: clamp(L.Shake, 0, SOCCER_CAPS.shakePx), burst: L.Burst, rings: Math.round(L.Rings), confetti: Math.round(L.Confetti), bulge: L.Bulge, dim: L.Dim,
    skillMs: c.skillMs,
  };
  const none = { flickAt: null, setAt: null, runUpAt: null, headAt: null, passOutAt: null, returnAt: null, slideAt: null, slideEnd: null, beats: [] as number[] };
  if (input.reduced) {
    const r = reducedAttackTimeline(input.leadIn ?? 0, c.reducedFadeMs);
    const at = r.impactAt;
    return {
      ...looks, ...none, reduced: true, chargeAt: at, absorbEnd: at, startAt: at, touches: [], approachAt: at, approachEnd: at, gatherAt: at,
      takeoffAt: at, landAt: at, strikeAt: at, impactAt: at, homeAt: at, homeEnd: at, endAt: r.endAt,
      zoom: 0, punch: 0, shakePx: 0, burst: 0, rings: 0, confetti: 0, bulge: 0, dim: 0,
    };
  }
  const chargeAt = Math.max(0, input.leadIn ?? 0);
  const absorbEnd = chargeAt + c.absorbMs;
  const startAt = chargeAt + Math.max(L.ReadyMs, c.absorbMs * 0.6);
  const n = clamp(Math.round(L.Touches), 0, SOCCER_CAPS.touches);
  const flight = Math.max(80, L.FlightMs);
  const base = { ...looks, ...none, reduced: false, chargeAt, absorbEnd, startAt };

  if (kind === 'volley') {
    // Keepy-uppies where it stands, one higher flick, a hop to meet it, the volley.
    const touches = Array.from({ length: n }, (_, i) => startAt + L.TouchMs * i);
    const flickAt = startAt + n * L.TouchMs;
    const leap = Math.max(120, L.LeapMs);
    const strikeAt = flickAt + leap;
    const takeoffAt = strikeAt - leap * 0.5;
    const gatherAt = takeoffAt - c.gatherMs * 0.6;
    const landAt = strikeAt + leap * 0.45;
    const impactAt = strikeAt + flight;
    return {
      ...base, touches, flickAt, approachAt: startAt, approachEnd: startAt, gatherAt, takeoffAt, landAt, strikeAt, impactAt,
      homeAt: landAt, homeEnd: landAt, endAt: Math.max(impactAt + L.HoldMs, landAt + 140),
    };
  }
  if (kind === 'corner') {
    // The jog out to the corner flag, the ball set, a step back, the run-up and the strike.
    const approachEnd = startAt + L.ApproachMs;
    const setAt = approachEnd + 40;
    const runUpAt = setAt + c.cornerSetMs;
    const strikeAt = runUpAt + c.cornerRunMs;
    if (variant === 2) {
      // THE HEADER: the outswinger reaches the penalty spot as the portrait, sprinting in, rises to meet it.
      const leap = Math.max(160, L.LeapMs);
      const headAt = strikeAt + flight * 0.85;
      const takeoffAt = headAt - leap * 0.5;
      const gatherAt = takeoffAt - c.gatherMs * 0.5;
      const landAt = headAt + leap * 0.5;
      const impactAt = headAt + c.headerFlightMs;
      const homeAt = Math.max(landAt, impactAt) + L.HoldMs;
      return {
        ...base, touches: [], approachAt: startAt, approachEnd, setAt, runUpAt, headAt, gatherAt, takeoffAt, landAt, strikeAt, impactAt,
        homeAt, homeEnd: homeAt + L.ReturnMs, endAt: homeAt + L.ReturnMs,
      };
    }
    if (variant === 3) {
      // THE SHORT CORNER: a short pass off the edge of the screen, the one-two back, a first-time curler.
      const passOutAt = strikeAt;
      const returnAt = passOutAt + c.oneTwoMs * 2;
      const finishAt = returnAt + 40;
      const impactAt = finishAt + flight * 0.8;
      const homeAt = impactAt + L.HoldMs;
      return {
        ...base, touches: [], approachAt: startAt, approachEnd, setAt, runUpAt, passOutAt, returnAt, gatherAt: returnAt - 60, takeoffAt: finishAt,
        landAt: finishAt, strikeAt: finishAt, impactAt, homeAt, homeEnd: homeAt + L.ReturnMs, endAt: homeAt + L.ReturnMs,
      };
    }
    // THE OLIMPICO: the inswinger bends all the way in.
    const impactAt = strikeAt + flight;
    const homeAt = impactAt + L.HoldMs;
    return {
      ...base, touches: [], approachAt: startAt, approachEnd, setAt, runUpAt, gatherAt: runUpAt, takeoffAt: strikeAt, landAt: strikeAt, strikeAt, impactAt,
      homeAt, homeEnd: homeAt + L.ReturnMs, endAt: homeAt + L.ReturnMs,
    };
  }
  if (kind === 'breakaway') {
    // The dribble up the pitch (touches along it), past the defenders (a skill each), the last touch and the finish.
    const A = Math.max(200, L.ApproachMs);
    const approachEnd = startAt + A;
    const nd = clamp(Math.round(c.defenders), 1, SOCCER_CAPS.defenders);
    const beats = Array.from({ length: nd }, (_, i) => startAt + A * defenderFraction(i, nd));
    const touches = Array.from({ length: n }, (_, i) => startAt + (A * (i + 0.35)) / Math.max(1, n));
    const gatherAt = approachEnd;
    const strikeAt = gatherAt + c.gatherMs;
    const impactAt = strikeAt + flight;
    const homeAt = impactAt + L.HoldMs;
    return {
      ...base, touches, beats, approachAt: startAt, approachEnd, gatherAt, takeoffAt: strikeAt, landAt: strikeAt, strikeAt, impactAt,
      homeAt, homeEnd: homeAt + L.ReturnMs, endAt: homeAt + L.ReturnMs,
    };
  }
  // THE BICYCLE KICK: keepy-uppies, the flick sky high, the sprint to the spot, the crouch, the leap and the flip, the
  // contact upside down at the top, the thunderbolt, the landing, the knee slide.
  const touches = Array.from({ length: n }, (_, i) => startAt + L.TouchMs * i);
  const flickAt = startAt + n * L.TouchMs;
  const approachAt = flickAt + 80;
  const approachEnd = approachAt + L.ApproachMs;
  const gatherAt = approachEnd;
  const takeoffAt = gatherAt + c.crouchMs;
  const leap = Math.max(200, L.LeapMs);
  const strikeAt = takeoffAt + leap * 0.5;
  const landAt = takeoffAt + leap;
  const impactAt = strikeAt + flight;
  const slideAt = Math.max(landAt, impactAt) + 40;
  const slideEnd = slideAt + c.slideMs;
  const homeAt = Math.max(slideEnd + 120, impactAt + L.HoldMs);
  return {
    ...base, touches, flickAt, approachAt, approachEnd, gatherAt, takeoffAt, landAt, strikeAt, impactAt, slideAt, slideEnd,
    homeAt, homeEnd: homeAt + L.ReturnMs, endAt: homeAt + L.ReturnMs,
  };
}

/** Where along the breakaway run defender `i` of `n` stands (0 = the slot, 1 = the shot spot). */
export function defenderFraction(i: number, n: number): number { return 0.18 + (0.62 * (i + 0.5)) / Math.max(1, n); }

export type SoccerCueKind = 'charge' | 'goal' | 'touch' | 'flick' | 'set' | 'runup' | 'beat' | 'pass' | 'return' | 'jump' | 'head' | 'strike' | 'impact' | 'land' | 'slide' | 'home' | 'end';
export interface SoccerCue { at: number; kind: SoccerCueKind; i: number }

/** When the goal fades in on the target (just before the ball is struck at it). */
export function goalInAt(p: SoccerPlan): number {
  const first = p.kind === 'corner' ? (p.runUpAt ?? p.strikeAt) : p.kind === 'breakaway' ? p.startAt + (p.approachEnd - p.startAt) * 0.5 : p.kind === 'bicycle' ? (p.flickAt ?? p.strikeAt) : p.strikeAt - 160;
  return Math.max(p.chargeAt, first);
}

/** Every beat the runner fires, in time order. The blow lands on `impact`, once. */
export function soccerCues(p: SoccerPlan): SoccerCue[] {
  const out: SoccerCue[] = [];
  if (!p.reduced) {
    out.push({ at: p.chargeAt, kind: 'charge', i: 0 });
    out.push({ at: goalInAt(p), kind: 'goal', i: 0 });
    p.touches.forEach((at, i) => out.push({ at, kind: 'touch', i }));
    if (p.flickAt !== null) out.push({ at: p.flickAt, kind: 'flick', i: 0 });
    if (p.setAt !== null) out.push({ at: p.setAt, kind: 'set', i: 0 });
    if (p.runUpAt !== null) out.push({ at: p.runUpAt, kind: 'runup', i: 0 });
    p.beats.forEach((at, i) => out.push({ at, kind: 'beat', i }));
    if (p.passOutAt !== null) out.push({ at: p.passOutAt, kind: 'pass', i: 0 });
    if (p.returnAt !== null) out.push({ at: p.returnAt, kind: 'return', i: 0 });
    if (p.takeoffAt > p.gatherAt && (p.kind === 'volley' || p.kind === 'bicycle' || p.headAt !== null)) out.push({ at: p.takeoffAt, kind: 'jump', i: 0 });
    if (p.headAt !== null) out.push({ at: p.headAt, kind: 'head', i: 0 });
    // The strike: the kick that sends the ball goalward (II-2: the cross the header meets). Never the blow itself.
    out.push({ at: p.strikeAt, kind: 'strike', i: 0 });
    if (p.landAt > p.strikeAt && (p.kind === 'volley' || p.kind === 'bicycle' || p.headAt !== null)) out.push({ at: p.landAt, kind: 'land', i: 0 });
    if (p.slideAt !== null) out.push({ at: p.slideAt, kind: 'slide', i: 0 });
    if (p.homeEnd > p.homeAt) out.push({ at: p.homeAt, kind: 'home', i: 0 });
  }
  out.push({ at: p.impactAt, kind: 'impact', i: 0 });
  out.push({ at: p.endAt, kind: 'end', i: 0 });
  const order: Record<SoccerCueKind, number> = {
    charge: 0, goal: 1, touch: 2, flick: 3, set: 4, runup: 5, beat: 6, pass: 7, return: 8, jump: 9, head: 10, strike: 11, impact: 12, land: 13, slide: 14, home: 15, end: 16,
  };
  return out.sort((a, b) => a.at - b.at || order[a.kind] - order[b.kind]);
}

// ─── the goal (pure) ───────────────────────────────────────────────────────────────────────────────────────────

/** The goal texture's aspect (its height / width). */
export const GOAL_ASPECT = 0.52;

/** THE GOAL AS ONE ASSEMBLY, centred on the struck portrait: the frame (posts + crossbar) and the net behind it. Pure. */
export interface GoalLayout { center: Pt; w: number; h: number; top: number; left: number; right: number; bottom: number }

export function goalLayout(center: Pt, dR: number, goalSize: number): GoalLayout {
  const w = dR * 2.5 * goalSize;
  const h = w * GOAL_ASPECT;
  return { center: { ...center }, w, h, top: center.y - h / 2, bottom: center.y + h / 2, left: center.x - w / 2, right: center.x + w / 2 };
}

// ─── the geometry (pure) ───────────────────────────────────────────────────────────────────────────────────────

export interface Frame { x0: number; y0: number; x1: number; y1: number }

export interface SoccerGeo {
  /** Unit, striker -> target, its normal, and the distance. */
  u: Pt;
  n: Pt;
  dist: number;
  /** II: the corner spot (on the target's goal line, out at the side with more room), the flag beside it, the step
   * back for the run-up, the header point (the penalty spot), the short corner's wall pass (off the edge and back) and
   * where the one-two is met. */
  corner: Pt;
  flag: Pt;
  cornerSide: 1 | -1;
  setBack: Pt;
  header: Pt;
  passOff: Pt;
  passBack: Pt;
  meet: Pt;
  /** III: the shot spot at the end of the run, and each defender's spot (with the side the portrait goes round it). */
  shot: Pt;
  defenders: { at: Pt; side: 1 | -1 }[];
  /** IV: the spot it sprints to, where the ball is met overhead, how high it goes (its apex), and the knee slide's end. */
  spot: Pt;
  contact: Pt;
  apex: Pt;
  slide: Pt;
  /** The target's centre: where every shot lands, and the goal's centre. */
  hit: Pt;
}

/** A point clamped inside the frame with `m` px to spare (a tiny frame: its middle). Pure. */
export function clampToFrame(p: Pt, f: Frame | null, m: number): Pt {
  if (!f) return p;
  const cx = (f.x0 + f.x1) / 2, cy = (f.y0 + f.y1) / 2;
  const x = f.x1 - f.x0 > 2 * m ? clamp(p.x, f.x0 + m, f.x1 - m) : cx;
  const y = f.y1 - f.y0 > 2 * m ? clamp(p.y, f.y0 + m, f.y1 - m) : cy;
  return { x, y };
}

const unit = (v: Pt): Pt => { const l = Math.hypot(v.x, v.y); return l > 1e-6 ? { x: v.x / l, y: v.y / l } : { x: 0, y: -1 }; };

/** Where every move goes, from the two heroes and the frame (screen px). Pure. */
export function soccerGeo(a: Pt, d: Pt, aR: number, dR: number, frame: Frame | null, c: HeroSoccerConfig = store.get(), variant: SoccerVariant = 1): SoccerGeo {
  void variant;
  const dx = d.x - a.x, dy = d.y - a.y;
  const dist = Math.hypot(dx, dy) || 1;
  const u = { x: dx / dist, y: dy / dist };
  const n = { x: -u.y, y: u.x };
  const m = aR * 1.05;
  const clear = (aR + dR) * 1.25; // never closer than this to the target on a run
  const along = (s: number): Pt => ({ x: a.x + u.x * s, y: a.y + u.y * s });
  const f: Frame = frame ?? { x0: Math.min(a.x, d.x) - 900, y0: Math.min(a.y, d.y) - 500, x1: Math.max(a.x, d.x) + 900, y1: Math.max(a.y, d.y) + 500 };
  const fmid = { x: (f.x0 + f.x1) / 2, y: (f.y0 + f.y1) / 2 };
  // II: THE CORNER, on the target's goal line (the frame edge behind the target), out at the side with more room.
  const roomL = d.x - f.x0, roomR = f.x1 - d.x;
  const cornerSide: 1 | -1 = Math.abs(roomL - roomR) > 2 ? (roomR > roomL ? 1 : -1) : (a.x > d.x + 2 ? 1 : a.x < d.x - 2 ? -1 : 1);
  const lineY = d.y <= a.y ? f.y0 : f.y1;
  const lineDir = d.y <= a.y ? -1 : 1; // the goal line is screen up (-1) or down (+1) from the target
  const corner = clampToFrame({ x: cornerSide > 0 ? f.x1 : f.x0, y: lineY }, f, m);
  // The flag stands just outside the portrait, its foot level with the portrait's feet, its pole and pennant up (on screen).
  const flag = clampToFrame({ x: corner.x + cornerSide * aR * 0.9, y: corner.y + aR * 0.75 }, f, aR * 0.3);
  const toGoal = unit({ x: d.x - corner.x, y: d.y - corner.y });
  const setBack = clampToFrame({ x: corner.x - toGoal.x * aR * 0.7, y: corner.y - toGoal.y * aR * 0.7 }, f, m * 0.9);
  // The penalty spot: in front of the goal, toward the middle of the pitch (the frame's middle), clear of the target.
  const towardPitch = unit({ x: fmid.x - d.x, y: fmid.y - d.y + (d.y <= a.y ? 1 : -1) * 0.001 });
  const pitch = Math.abs(towardPitch.y) < 0.35 ? unit({ x: towardPitch.x * 0.5, y: (d.y <= a.y ? 1 : -1) }) : towardPitch;
  const header = clampToFrame({ x: d.x + pitch.x * clear * 1.15, y: d.y + pitch.y * clear * 1.15 }, f, m);
  // The short corner: rolled out along the goal line off the edge of the screen, and back in to the portrait, which has
  // moved a little in along the line toward the goal.
  const passOff = { x: (cornerSide > 0 ? f.x1 : f.x0) + cornerSide * aR * 1.5, y: corner.y - lineDir * aR * 0.2 };
  const meet = clampToFrame({ x: corner.x + toGoal.x * aR * 2.2, y: corner.y + toGoal.y * aR * 2.2 - lineDir * aR * 0.6 }, f, m);
  const passBack = { x: (cornerSide > 0 ? f.x1 : f.x0) + cornerSide * aR * 1.5, y: meet.y - lineDir * aR * 0.9 };
  // III: the run straight up the pitch to the shot spot, defenders spread along it, each a little off the line.
  const shot = clampToFrame(along(clamp(dist - clear, dist * 0.35, Math.max(0, dist - clear * 0.8))), f, m);
  const nd = clamp(Math.round(c.defenders), 1, SOCCER_CAPS.defenders);
  const defenders = Array.from({ length: nd }, (_, i) => {
    const fr = defenderFraction(i, nd);
    const side: 1 | -1 = i % 2 === 0 ? 1 : -1;
    const base = { x: a.x + (shot.x - a.x) * fr, y: a.y + (shot.y - a.y) * fr };
    return { at: clampToFrame({ x: base.x - n.x * side * aR * 0.15, y: base.y - n.y * side * aR * 0.15 }, f, aR * 0.8), side };
  });
  // IV: the spot in front of the goal, the contact overhead, the ball's apex (sky high, but on screen), the knee slide.
  const spot = clampToFrame(along(clamp(dist - clear * 1.05, dist * 0.3, Math.max(0, dist - clear * 0.8))), f, m);
  const contact = clampToFrame({ x: spot.x - u.x * aR * 0.2, y: spot.y - aR * 0.95 }, f, aR * 0.45);
  const apexY = Math.max(f.y0 + aR * 0.7, Math.min(a.y, contact.y) - aR * c.skyHeight);
  const apex = { x: (a.x + contact.x) / 2, y: apexY };
  const slideDir = Math.abs(fmid.x - spot.x) > 2 ? Math.sign(fmid.x - spot.x) : -cornerSide;
  const slide = clampToFrame({ x: spot.x + slideDir * aR * 2.4, y: spot.y + (d.y <= a.y ? 1 : -1) * aR * 0.5 }, f, m);
  return { u, n, dist, corner, flag, cornerSide, setBack, header, passOff, passBack, meet, shot, defenders, spot, contact, apex, slide, hit: { ...d } };
}

// ─── the pose (pure) ───────────────────────────────────────────────────────────────────────────────────────────

/**
 * The striking portrait at a moment: an offset from its slot (screen px), a tilt (degrees), a scale, how far off the
 * floor it is (`air`, 0..1: its shadow drops away and shrinks), and a squash (vertical, on landings and the crouch).
 */
export interface SoccerPose { x: number; y: number; rot: number; scale: number; air: number; squash: number }

const REST: SoccerPose = { x: 0, y: 0, rot: 0, scale: 1, air: 0, squash: 0 };
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const easeIn = (u: number): number => { const x = clamp01(u); return x * x * x; };
const easeInQuad = (u: number): number => { const x = clamp01(u); return x * x; };
const easeOutQuad = (u: number): number => { const x = clamp01(u); return 1 - (1 - x) * (1 - x); };
const linear = (u: number): number => clamp01(u);

export interface Seg { t0: number; t1: number; p0: Pt; p1: Pt; ease: (u: number) => number; air0: number; air1: number; hop: number; rot0: number; rot1: number; sc0: number; sc1: number; bob: number }

/** The breakaway run's lateral weave at run fraction `f` (striker radii, along the normal): round each defender. */
export function weaveAt(f: number, defs: readonly { side: 1 | -1 }[], nd: number, width: number): number {
  let w = 0;
  defs.forEach((d, i) => {
    const c = defenderFraction(i, nd);
    const x = (f - c) / 0.11;
    w += d.side * width * Math.exp(-x * x);
  });
  return w;
}

/** The portrait's keyframes for a plan (offsets from its slot). Pure. */
export function poseSegs(p: SoccerPlan, g: SoccerGeo, c: HeroSoccerConfig, a: Pt, aR: number): Seg[] {
  if (p.reduced) return [];
  const rel = (q: Pt): Pt => ({ x: q.x - a.x, y: q.y - a.y });
  const O = { x: 0, y: 0 };
  const js = p.jumpScale;
  const seg = (t0: number, t1: number, p0: Pt, p1: Pt, o: Partial<Omit<Seg, 't0' | 't1' | 'p0' | 'p1'>> = {}): Seg => ({
    t0, t1: Math.max(t0 + 1, t1), p0, p1, ease: easeInOutSine, air0: 0, air1: 0, hop: 0, rot0: 0, rot1: 0, sc0: 1, sc1: 1, bob: 0, ...o,
  });
  const lean = 6 * (g.u.x >= 0 ? 1 : -1);
  if (p.kind === 'volley') {
    const top = { x: 0, y: -aR * c.volleyHop };
    const out: Seg[] = [];
    // A little bob with each keepy-uppy.
    p.touches.forEach((t) => out.push(seg(t - 60, t + 60, O, O, { sc0: 1, sc1: 1, hop: 0.15 })));
    out.push(
      seg(p.gatherAt, p.takeoffAt, O, O, { sc1: 0.95 }),
      seg(p.takeoffAt, p.strikeAt, O, top, { ease: easeOutCubic, air1: 1, sc0: 0.95, sc1: 1 + js, rot1: -lean * 1.6 }),
      // THE VOLLEY: the swing leans it into the strike, then down.
      seg(p.strikeAt, p.landAt, top, O, { ease: easeInQuad, air0: 1, sc0: 1 + js, sc1: 1, rot0: lean * 2.2, rot1: 0 }),
    );
    return out;
  }
  if (p.kind === 'corner') {
    const cn = rel(g.corner), back = rel(g.setBack);
    const segs: Seg[] = [
      // THE JOG out to the flag (a trot: a little bob).
      seg(p.startAt, p.approachEnd, O, cn, { ease: easeInOutSine, rot1: lean, bob: 1 }),
      // Set the ball, step back, raise an arm (a lean and a pause).
      seg(p.approachEnd, p.setAt!, cn, cn, { rot0: lean, rot1: 0 }),
      seg(p.setAt!, p.runUpAt!, cn, back, { ease: easeOutQuad, rot1: -10 * g.cornerSide, sc1: 1.02 }),
      // THE RUN-UP and the strike.
      seg(p.runUpAt!, p.runUpAt! + c.cornerRunMs, back, cn, { ease: easeIn, rot0: -10 * g.cornerSide, rot1: 14 * g.cornerSide, sc0: 1.02, sc1: 1.04 }),
    ];
    const strikeT = p.runUpAt! + c.cornerRunMs;
    if (p.variant === 2) {
      // Sprint in to the penalty spot, leap and head it.
      const hd = rel(g.header);
      const top = { x: hd.x, y: hd.y - aR * 0.35 };
      segs.push(
        seg(strikeT, p.gatherAt, cn, hd, { ease: easeInOutSine, rot0: 14 * g.cornerSide, rot1: lean, bob: 1 }),
        seg(p.gatherAt, p.takeoffAt, hd, hd, { rot0: lean, sc1: 0.94 }),
        seg(p.takeoffAt, p.headAt!, hd, top, { ease: easeOutCubic, air1: 1, sc0: 0.94, sc1: 1 + js, rot1: -12 * g.cornerSide }),
        seg(p.headAt!, p.landAt, top, hd, { ease: easeInQuad, air0: 1, sc0: 1 + js, sc1: 1, rot0: 16 * g.cornerSide, rot1: 0 }),
        seg(p.landAt, p.homeAt, hd, hd),
        seg(p.homeAt, p.homeEnd, hd, O, { bob: 1 }),
      );
      return segs;
    }
    if (p.variant === 3) {
      // In along the goal line to meet the one-two, then the curler first time.
      const mt = rel(g.meet);
      segs.push(
        seg(strikeT, p.returnAt!, cn, mt, { ease: easeInOutSine, rot0: 14 * g.cornerSide, rot1: 0, bob: 1 }),
        seg(p.returnAt!, p.strikeAt + 120, mt, mt, { ease: easeOutQuad, rot0: -12 * g.cornerSide, rot1: 10 * g.cornerSide, sc0: 1.03, sc1: 1 }),
        seg(p.strikeAt + 120, p.homeAt, mt, mt, { rot0: 10 * g.cornerSide, rot1: 0 }),
        seg(p.homeAt, p.homeEnd, mt, O, { bob: 1 }),
      );
      return segs;
    }
    segs.push(
      seg(strikeT, p.homeAt, cn, cn, { rot0: 14 * g.cornerSide, rot1: 0, ease: easeOutQuad }),
      seg(p.homeAt, p.homeEnd, cn, O, { bob: 1 }),
    );
    return segs;
  }
  if (p.kind === 'breakaway') {
    // THE RUN: sampled as short linear legs so the weave round each defender is smooth.
    const st = rel(g.shot);
    const nd = g.defenders.length;
    const A = Math.max(1, p.approachEnd - p.startAt);
    const segs: Seg[] = [];
    const N = 24;
    const posAt = (fr: number): Pt => {
      const e = easeInOutSine(fr) * 0.25 + fr * 0.75;
      const w = weaveAt(fr, g.defenders, nd, c.beatWidth) * aR;
      return { x: st.x * e + g.n.x * w, y: st.y * e + g.n.y * w };
    };
    for (let i = 0; i < N; i++) {
      const f0 = i / N, f1 = (i + 1) / N;
      // STEPOVERS (variant 1): the portrait sways side to side just before each defender.
      const sway = (fr: number): number => {
        if (p.variant !== 1) return 0;
        let r = 0;
        g.defenders.forEach((_, k) => {
          const cf = defenderFraction(k, nd) - (c.skillMs / A) * 0.5;
          const x = (fr - cf) / ((c.skillMs / A) * 0.5);
          if (Math.abs(x) < 1) r += 14 * Math.sin(x * Math.PI * 2) * (1 - Math.abs(x));
        });
        return r;
      };
      segs.push(seg(p.startAt + A * f0, p.startAt + A * f1, posAt(f0), posAt(f1), { ease: linear, rot0: lean + sway(f0), rot1: lean + sway(f1), bob: 0.6 }));
    }
    segs.push(
      // THE LAST TOUCH: set, then the finish (a lean through the ball).
      seg(p.approachEnd, p.strikeAt, st, st, { rot0: lean, rot1: -lean * 1.5, sc1: 0.97 }),
      seg(p.strikeAt, p.homeAt, st, st, { ease: easeOutCubic, rot0: lean * 2.5, rot1: 0, sc0: 1.03, sc1: 1 }),
      seg(p.homeAt, p.homeEnd, st, O, { bob: 1 }),
    );
    return segs;
  }
  // THE BICYCLE KICK.
  const sp = rel(g.spot), sl = rel(g.slide);
  const top = { x: sp.x, y: sp.y - aR * 0.55 };
  const spin = -360 * Math.max(0, Math.round(c.flipTurns)) * (g.u.x >= 0 ? 1 : -1);
  const out: Seg[] = [];
  p.touches.forEach((t) => out.push(seg(t - 60, t + 60, O, O, { hop: 0.15 })));
  out.push(
    seg(p.flickAt! - 40, p.approachAt, O, O, { sc1: 0.97, hop: 0.25 }),
    // THE SPRINT to the spot (fast, low, leaning in).
    seg(p.approachAt, p.approachEnd, O, sp, { ease: easeInOutSine, rot0: 0, rot1: lean * 1.6, bob: 1.3 }),
    // THE CROUCH.
    seg(p.gatherAt, p.takeoffAt, sp, { x: sp.x, y: sp.y + aR * 0.06 }, { ease: easeOutCubic, rot0: lean * 1.6, rot1: 0, sc1: 0.9 }),
    // THE LEAP AND THE FLIP: up and over backwards, upside down at the contact, round to land.
    seg(p.takeoffAt, p.strikeAt, { x: sp.x, y: sp.y + aR * 0.06 }, top, { ease: easeOutCubic, air1: 1, sc0: 0.9, sc1: 1 + js, rot0: 0, rot1: spin * 0.5 }),
    seg(p.strikeAt, p.landAt, top, sp, { ease: easeInQuad, air0: 1, sc0: 1 + js, sc1: 1, rot0: spin * 0.5, rot1: spin }),
    seg(p.landAt, p.slideAt!, sp, sp, { rot0: spin, rot1: spin }),
    // THE KNEE SLIDE: skidding away on its knees, leaning back, arms out.
    seg(p.slideAt!, p.slideEnd!, sp, sl, { ease: easeOutCubic, rot0: spin, rot1: spin - 18 * Math.sign(sl.x - sp.x || 1), sc1: 1.04 }),
    seg(p.slideEnd!, p.homeAt, sl, sl, { rot0: spin - 18 * Math.sign(sl.x - sp.x || 1), rot1: spin, sc0: 1.04 }),
    seg(p.homeAt, p.homeEnd, sl, O, { rot0: spin, rot1: spin, bob: 1 }),
  );
  return out.sort((x, y) => x.t0 - y.t0);
}

/** Where the striking portrait is at sequence time `t` (its slot is (0, 0)). Pure and deterministic. */
export function soccerPose(p: SoccerPlan, segs: readonly Seg[], c: HeroSoccerConfig, t: number): SoccerPose {
  if (p.reduced || !segs.length || t < segs[0]!.t0 || t >= p.endAt) return { ...REST };
  // The segment in force (the latest that has started); past the last one, its end.
  let s = segs[0]!;
  for (const q of segs) if (t >= q.t0) s = q;
  const u = clamp01((t - s.t0) / (s.t1 - s.t0));
  const e = s.ease(u);
  const hop = s.hop * 4 * u * (1 - u);
  // A running bob (the trot): a small bounce every ~140 ms while the segment says so.
  const bob = s.bob > 0 && u < 1 ? s.bob * Math.abs(Math.sin(((t - s.t0) / 140) * Math.PI)) : 0;
  const air = clamp01(lerp(s.air0, s.air1, u) + hop);
  // A whole turn (the flip) is a full circle: rotation is kept as is (the portrait ends where it started, upright).
  const rot = lerp(s.rot0, s.rot1, e);
  const pose: SoccerPose = {
    x: lerp(s.p0.x, s.p1.x, e),
    y: lerp(s.p0.y, s.p1.y, e) - hop * 22 - bob * 5,
    rot: Math.abs(rot % 360) < 1e-6 && Math.abs(rot) > 0 ? 0 : rot,
    scale: lerp(s.sc0, s.sc1, e) * (1 + p.jumpScale * 0.4 * hop),
    air,
    squash: 0,
  };
  // The squash: on the landings and the crouch.
  if ((p.kind === 'volley' || p.kind === 'bicycle' || p.headAt !== null) && t >= p.landAt) pose.squash = c.squash * (p.kind === 'bicycle' ? 1.4 : 0.8) * Math.max(0, spring(t - p.landAt, 4, 70));
  if (p.kind === 'bicycle' && t >= p.gatherAt && t < p.takeoffAt) pose.squash += 0.14 * easeOutCubic((t - p.gatherAt) / Math.max(1, p.takeoffAt - p.gatherAt));
  if (p.kind === 'bicycle' && t >= p.takeoffAt && t < p.strikeAt) pose.squash -= 0.12 * Math.max(0, spring(t - p.takeoffAt, 3, 90));
  if (t >= p.homeEnd && p.homeEnd > p.homeAt) pose.squash += c.squash * 0.4 * Math.max(0, spring(t - p.homeEnd, 4, 60));
  return pose;
}

// ─── the ball (pure) ───────────────────────────────────────────────────────────────────────────────────────────

export interface BallState { visible: boolean; x: number; y: number; rot: number; scale: number; alpha: number; air: number; squash: number; flying: boolean; fire: number }

const HIDDEN: BallState = { visible: false, x: 0, y: 0, rot: 0, scale: 1, alpha: 0, air: 0, squash: 0, flying: false, fire: 0 };

/** How high an arc rises (px), trimmed so the ball never leaves the top of the frame. Pure. */
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

/** A quadratic bend from `a` to `b`, bowed sideways by `bend` (a fraction of the length, signed). Pure. */
export function curlPoint(a: Pt, b: Pt, bend: number, u: number): Pt {
  const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
  const dx = b.x - a.x, dy = b.y - a.y;
  const cx = mx - dy * bend, cy = my + dx * bend;
  const v = clamp01(u), w = 1 - v;
  return { x: w * w * a.x + 2 * w * v * cx + v * v * b.x, y: w * w * a.y + 2 * w * v * cy + v * v * b.y };
}

/** Everything the ball's path needs (measured once). */
export interface BallCtx { p: SoccerPlan; g: SoccerGeo; segs: readonly Seg[]; c: HeroSoccerConfig; a: Pt; aR: number; frame: Frame | null }

/** Which way a bend bows so it reads as a curl from `from` to `to` (toward the middle of the frame first). */
function bendSign(from: Pt, to: Pt, frame: Frame | null): number {
  const mid = frame ? { x: (frame.x0 + frame.x1) / 2, y: (frame.y0 + frame.y1) / 2 } : { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 + 1 };
  const dx = to.x - from.x, dy = to.y - from.y;
  // The control point is (mid - (dy, -dx) * bend): +1 bows it toward the normal (-dy, dx).
  const nx = -dy, ny = dx;
  const s = nx * (mid.x - (from.x + to.x) / 2) + ny * (mid.y - (from.y + to.y) / 2);
  return s >= 0 ? 1 : -1;
}

/** The ball at sequence time `t` (screen px). Pure and deterministic. */
export function soccerBall(x: BallCtx, t: number): BallState {
  const { p, g, c, a, aR } = x;
  if (p.reduced || t < p.chargeAt || t >= p.endAt) return { ...HIDDEN };
  const pose = (tt: number): SoccerPose => soccerPose(p, x.segs, c, tt);
  const popIn = easeOutCubic((t - p.chargeAt) / 140);
  const spinOf = (from: Pt, to: Pt, t0: number, k = 1): number => (to.x - from.x >= 0 ? 1 : -1) * k * c.spin * 2 * Math.PI * ((t - t0) / 1000);
  /** At the feet: in front of the portrait (toward the target), on the floor. */
  const feet = (tt: number): Pt => { const q = pose(tt); return { x: a.x + q.x + g.u.x * aR * 0.8, y: a.y + q.y + g.u.y * aR * 0.8 + aR * 0.3 }; };
  const on = (pt: Pt, o: Partial<BallState> = {}): BallState => ({ visible: true, x: pt.x, y: pt.y, rot: 0, scale: 1, alpha: 1, air: 0, squash: 0, flying: false, fire: 0, ...o });
  /** Straight (with an arc) from `from` to `to`. */
  const fly = (from: Pt, to: Pt, t0: number, t1: number, arc: number, o: { spinK?: number; fire?: number } = {}): BallState => {
    const u = clamp01((t - t0) / Math.max(1, t1 - t0));
    const h = arcHeight(from, to, arc, x.frame, aR * c.ballSize * 0.6);
    const lift = 4 * u * (1 - u);
    return {
      visible: true, x: lerp(from.x, to.x, u), y: lerp(from.y, to.y, u) - h * lift, rot: spinOf(from, to, t0, o.spinK ?? 1), scale: 1 + 0.12 * lift, alpha: 1,
      air: Math.min(1, lift + 0.15), squash: t - t0 < 50 ? 0.22 * (1 - (t - t0) / 50) : 0, flying: true, fire: o.fire ?? 0,
    };
  };
  /** Curled (a bend sideways) from `from` to `to`, with a little height. */
  const curl = (from: Pt, to: Pt, t0: number, t1: number, bend: number, height: number): BallState => {
    const u = clamp01((t - t0) / Math.max(1, t1 - t0));
    const q = curlPoint(from, to, bend, u);
    const lift = 4 * u * (1 - u);
    return {
      visible: true, x: q.x, y: q.y - height * lift, rot: spinOf(from, to, t0, 1.6) * Math.sign(bend || 1), scale: 1 + 0.18 * lift, alpha: 1,
      air: Math.min(1, lift + 0.15), squash: t - t0 < 50 ? 0.22 * (1 - (t - t0) / 50) : 0, flying: true, fire: 0,
    };
  };
  /** A keepy-uppy: up off the feet and back down onto them, `h` px high, over [t0, t1]. */
  const juggle = (t0: number, t1: number, h: number): BallState => {
    const u = clamp01((t - t0) / Math.max(1, t1 - t0));
    const f = feet(t);
    const lift = 4 * u * (1 - u);
    return on({ x: f.x, y: f.y - aR * 0.3 - h * lift }, { scale: 1 + 0.15 * lift, air: lift * 0.8, rot: (t - t0) / 160, squash: u < 0.12 ? 0.2 * (1 - u / 0.12) : 0 });
  };
  /** In the net: it drops in behind the goal mouth, a little bounce, and fades. */
  const inNet = (t0: number, from: Pt): BallState => {
    const s = (t - t0) / 1000;
    const k = clamp01((t - t0) / 520);
    const dir = unit({ x: g.hit.x - from.x, y: g.hit.y - from.y });
    const push = aR * 0.35 * easeOutCubic(k);
    return on({ x: g.hit.x + dir.x * push, y: g.hit.y + dir.y * push + 30 * s }, { scale: (1 - 0.15 * k), alpha: 1 - easeInQuad(k), rot: 2 * s, air: 0.1, visible: k < 1 });
  };
  const H = aR * c.juggleHeight;

  if (p.kind === 'volley') {
    // Keepy-uppies, the higher flick, the volley.
    const T = p.touchMs;
    for (const t0 of p.touches) if (t >= t0 && t < t0 + T) { const b = juggle(t0, t0 + T, H); return { ...b, scale: b.scale * popIn }; }
    if (t < (p.touches[0] ?? p.flickAt!)) return { ...on(feet(t)), scale: popIn };
    const volleyAt = (): Pt => { const q = pose(p.strikeAt); return { x: a.x + q.x + g.u.x * aR * 0.75, y: a.y + q.y + g.u.y * aR * 0.75 - aR * 0.1 }; };
    if (t < p.strikeAt) {
      // The flick: up high, and down onto the volley point (the portrait has hopped to meet it).
      const u = clamp01((t - p.flickAt!) / Math.max(1, p.strikeAt - p.flickAt!));
      const f = feet(p.flickAt!), v = volleyAt();
      const lift = 4 * u * (1 - u);
      return on({ x: lerp(f.x, v.x, u), y: lerp(f.y, v.y, u) - H * 1.6 * lift }, { scale: 1 + 0.25 * lift, air: lift, rot: (t - p.flickAt!) / 120 });
    }
    if (t < p.impactAt) return fly(volleyAt(), g.hit, p.strikeAt, p.impactAt, p.arc);
    return inNet(p.impactAt, volleyAt());
  }
  if (p.kind === 'corner') {
    if (t < p.setAt!) return { ...HIDDEN };
    const spot = { x: g.corner.x + (g.hit.x - g.corner.x > 0 ? 1 : -1) * aR * 0.15, y: g.corner.y + aR * 0.55 };
    const kickAt = p.runUpAt! + c.cornerRunMs;
    if (t < kickAt) return on(spot, { scale: easeOutCubic((t - p.setAt!) / 140) });
    const bendIn = bendSign(spot, g.hit, x.frame);
    if (p.variant === 2) {
      const head = { x: g.header.x, y: g.header.y - aR * 0.9 };
      // The OUTSWINGER bows away from the goal, then the header.
      if (t < p.headAt!) return curl(spot, head, kickAt, p.headAt!, -bendIn * c.curl * 0.7, aR * 0.6);
      if (t < p.impactAt) return fly(head, g.hit, p.headAt!, p.impactAt, 0.04, { spinK: 0.6 });
      return inNet(p.impactAt, head);
    }
    if (p.variant === 3) {
      // The short pass off the edge, back in, and the first-time curler.
      const meetFeet = { x: g.meet.x + g.u.x * 0, y: g.meet.y + aR * 0.55 };
      const mid = p.passOutAt! + c.oneTwoMs;
      if (t < mid) return fly(spot, g.passOff, kickAt, mid, 0, { spinK: 0.6 });
      if (t < p.returnAt!) return fly(g.passBack, meetFeet, mid, p.returnAt!, 0, { spinK: 0.6 });
      if (t < p.strikeAt) return on(meetFeet);
      if (t < p.impactAt) return curl(meetFeet, g.hit, p.strikeAt, p.impactAt, bendSign(meetFeet, g.hit, x.frame) * c.curl * 0.8, aR * 0.5);
      return inNet(p.impactAt, meetFeet);
    }
    // THE OLIMPICO: one long inswinger, bending right round into the goal.
    if (t < p.impactAt) return curl(spot, g.hit, kickAt, p.impactAt, bendIn * c.curl, aR * 0.4);
    return inNet(p.impactAt, spot);
  }
  if (p.kind === 'breakaway') {
    if (t < p.startAt) return { ...on(feet(t)), scale: popIn };
    if (t < p.approachEnd) {
      // At its feet, pushed a touch ahead after each touch.
      let b = feet(t);
      for (const t0 of p.touches) {
        const dt = t - t0;
        if (dt >= 0 && dt < p.touchMs) { const k = Math.sin(Math.PI * (dt / p.touchMs)); b = { x: b.x + g.u.x * aR * 0.35 * k, y: b.y + g.u.y * aR * 0.35 * k }; }
      }
      let lift = 0, scale = 1, alpha = 1;
      // THE SKILL round each defender: the nutmeg rolls the ball straight through it (the portrait goes round); the
      // rainbow flick lifts it over its head.
      const A = Math.max(1, p.approachEnd - p.startAt);
      const nd = g.defenders.length;
      p.beats.forEach((bt, i) => {
        const half = p.skillMs / 2;
        const dt = t - bt;
        if (Math.abs(dt) >= half || p.variant === 1) return;
        const u = (dt + half) / p.skillMs;
        const fr = (t - p.startAt) / A;
        const w = weaveAt(fr, g.defenders, nd, c.beatWidth) * aR;
        const k = Math.sin(Math.PI * u);
        // Back onto the straight line (through the defender's legs, or over its head).
        b = { x: b.x - g.n.x * w * k, y: b.y - g.n.y * w * k };
        if (p.variant === 3) { lift = aR * 1.6 * Math.sin(Math.PI * u); scale = 1 + 0.35 * Math.sin(Math.PI * u); }
        if (p.variant === 2) { const near = 1 - Math.abs(u - 0.5) * 2; scale = 1 - 0.25 * near; alpha = 1 - 0.35 * near; }
        void i;
      });
      return on({ x: b.x, y: b.y - lift }, { rot: (t - p.startAt) / 110, scale, alpha, air: lift > 0 ? Math.min(1, lift / (aR * 1.6)) : 0, flying: lift > 0 });
    }
    const shotFrom = feet(p.strikeAt);
    if (t < p.strikeAt) return on(feet(t), { rot: (t - p.startAt) / 110 });
    if (t < p.impactAt) return fly(shotFrom, g.hit, p.strikeAt, p.impactAt, p.arc);
    return inNet(p.impactAt, shotFrom);
  }
  // THE BICYCLE KICK.
  const T = p.touchMs;
  for (const t0 of p.touches) if (t >= t0 && t < t0 + T) { const b = juggle(t0, t0 + T, H * 0.9); return { ...b, scale: b.scale * popIn }; }
  if (t < (p.touches[0] ?? p.flickAt!)) return { ...on(feet(t)), scale: popIn };
  if (t < p.flickAt!) return on(feet(t));
  if (t < p.strikeAt) {
    // SKY HIGH: up to the apex (growing toward the camera, its shadow falling away), and down onto the contact point.
    const from = feet(p.flickAt!);
    const u = clamp01((t - p.flickAt!) / Math.max(1, p.strikeAt - p.flickAt!));
    const up = u < 0.5;
    const v = up ? easeOutCubic(u / 0.5) : easeInQuad((u - 0.5) / 0.5);
    const pos = up ? { x: lerp(from.x, g.apex.x, v), y: lerp(from.y, g.apex.y, v) } : { x: lerp(g.apex.x, g.contact.x, v), y: lerp(g.apex.y, g.contact.y, v) };
    const height = up ? v : 1 - v * 0.75;
    return on(pos, { scale: 1 + 0.9 * height, air: height, rot: (t - p.flickAt!) / 90, flying: true });
  }
  if (t < p.impactAt) return fly(g.contact, g.hit, p.strikeAt, p.impactAt, p.arc, { spinK: 2.4, fire: 1 });
  return inNet(p.impactAt, g.contact);
}

/** III's defenders at `t`: each fades in, LUNGES at the ball as the portrait reaches it, is beaten, and falls away. Pure. */
export interface DefenderState { visible: boolean; x: number; y: number; rot: number; scale: number; alpha: number }

export function defenderAt(p: SoccerPlan, g: SoccerGeo, i: number, aR: number, t: number): DefenderState {
  const d = g.defenders[i];
  const bt = p.beats[i];
  if (p.reduced || p.kind !== 'breakaway' || !d || bt === undefined || t < p.startAt - 120 || t >= p.endAt) return { visible: false, x: 0, y: 0, rot: 0, scale: 1, alpha: 0 };
  const fadeIn = easeOutCubic((t - (p.startAt - 120)) / 220);
  // The lunge: toward the side the portrait is NOT going round (it bites on the skill), then a stumble and a fade.
  const dt = t - bt;
  const lunge = dt < -p.skillMs ? 0 : dt < 0 ? easeOutCubic((dt + p.skillMs) / p.skillMs) : 1;
  const sideLunge = -d.side * aR * 0.45 * lunge;
  const beaten = dt > 0 ? clamp01(dt / 380) : 0;
  const x = d.at.x + g.n.x * sideLunge - g.u.x * aR * 0.3 * beaten;
  const y = d.at.y + g.n.y * sideLunge - g.u.y * aR * 0.3 * beaten;
  return {
    visible: true, x, y, rot: (-d.side * 0.35 * lunge) + (dt > 0 ? -d.side * 1.4 * easeOutCubic(beaten) : 0),
    scale: 0.58 * (1 - 0.18 * beaten), alpha: fadeIn * (1 - easeInQuad(clamp01((dt - 120) / 420))),
  };
}

// ─── slow mo (pure) ─────────────────────────────────────────────────────────────────────────────────────────────────

/** A smooth 0..1 window: rises over `ramp` before `a`, holds to `b`, falls over `ramp` after. */
function windowAt(t: number, a: number, b: number, ramp: number): number {
  if (t <= a - ramp || t >= b + ramp) return 0;
  if (t < a) return easeInOutSine((t - (a - ramp)) / ramp);
  if (t <= b) return 1;
  return 1 - easeInOutSine((t - b) / ramp);
}

/** The slow-mo window in SEQUENCE ms (a real-time length at a factor is `real * factor` of sequence time). */
export function slowWindow(p: SoccerPlan, c: HeroSoccerConfig): { a: number; b: number; factor: number } | null {
  if (p.reduced) return null;
  if (p.kind === 'breakaway' && c.breakSlowMs > 0 && c.breakSlow < 1) {
    const len = c.breakSlowMs * c.breakSlow;
    return { a: p.strikeAt - len * 0.6, b: p.strikeAt + len * 0.4, factor: c.breakSlow };
  }
  if (p.kind === 'bicycle' && c.bikeSlowMs > 0 && c.bikeSlow < 1) {
    const len = c.bikeSlowMs * c.bikeSlow;
    return { a: p.strikeAt - len * 0.6, b: p.strikeAt + len * 0.4, factor: c.bikeSlow };
  }
  return null;
}

/**
 * THE ATTACK'S TIME SCALE at sequence time `t` (1 = normal). III slows around the last touch; IV around the contact
 * upside down, then runs a touch FAST as the thunderbolt flies. A smooth ramp, always > 0: never a freeze. Pure.
 */
export function soccerTimeScale(p: SoccerPlan, c: HeroSoccerConfig, t: number): number {
  const w = slowWindow(p, c);
  let k = 1;
  if (w) k -= (1 - w.factor) * windowAt(t, w.a, w.b, Math.max(1, c.slowRampMs));
  if (p.kind === 'bicycle' && c.rocketBoost > 1 && w) {
    k += (c.rocketBoost - 1) * windowAt(t, w.b + c.slowRampMs + 10, p.impactAt - 10, 30);
  }
  return Math.max(0.05, k);
}

/** How much longer (real ms at speed 1) the slow mo makes the attack. Pure. */
export function slowExtraMs(p: SoccerPlan, c: HeroSoccerConfig): number {
  if (p.reduced) return 0;
  let extra = 0;
  const step = 4;
  for (let t = 0; t < p.endAt; t += step) extra += step / soccerTimeScale(p, c, t) - step;
  return Math.max(0, extra);
}

// ─── the goal and the flag (pure) ───────────────────────────────────────────────────────────────────────────────

/** The goal's opacity, the NET'S BULGE (0.. on the impact, springing back) and the frame's shake (radians). */
export function goalAt(p: SoccerPlan, t: number): { alpha: number; bulge: number; shake: number } {
  if (p.reduced) return { alpha: 0, bulge: 0, shake: 0 };
  const inAt = goalInAt(p);
  if (t < inAt) return { alpha: 0, bulge: 0, shake: 0 };
  const fadeIn = easeOutCubic((t - inAt) / 180);
  const outFrom = p.impactAt + (p.kind === 'bicycle' ? 520 : 320);
  const out = clamp01((t - outFrom) / 280);
  const age = t - p.impactAt;
  // The net is punched out, overshoots and settles (a fast spring); IV's bursts out twice as far.
  const bulge = age >= 0 ? p.bulge * Math.max(0, Math.exp(-age / 260) * (0.5 + 0.5 * Math.cos(2 * Math.PI * 3.2 * (age / 1000)))) : 0;
  const shake = age >= 0 ? (p.kind === 'bicycle' ? 0.06 : 0.015) * spring(age, 11, 160) : 0;
  return { alpha: fadeIn * (1 - out), bulge, shake };
}

/** II's corner flag: up from the jog to the strike (it waves when the ball is struck), down as the portrait heads home. */
export function flagAt(p: SoccerPlan, t: number): { alpha: number; wave: number } {
  if (p.reduced || p.kind !== 'corner') return { alpha: 0, wave: 0 };
  const inAt = p.startAt + (p.approachEnd - p.startAt) * 0.4;
  if (t < inAt) return { alpha: 0, wave: 0 };
  const alpha = easeOutCubic((t - inAt) / 220) * (1 - clamp01((t - p.homeAt) / 260));
  const kick = p.runUpAt! + 200;
  const wave = 0.06 * Math.sin(t / 130) + (t >= kick ? 0.18 * spring(t - kick, 4, 260) : 0);
  return { alpha, wave };
}

// ─── the camera (pure) ─────────────────────────────────────────────────────────────────────────────────────────

/**
 * The camera: it pushes in on the target while the shot flies (IV from the leap), punches and shakes on the impact along
 * the blow, and IV rumbles the whole board. Pure.
 */
export function soccerCameraAt(p: SoccerPlan, c: HeroSoccerConfig, t: number, dir: Pt): { zoom: number; x: number; y: number } {
  if (p.reduced) return { zoom: 1, x: 0, y: 0 };
  const inFrom = p.kind === 'bicycle' ? p.takeoffAt : p.strikeAt - 120;
  const push = t < inFrom ? 0 : t < p.impactAt ? easeInOutSine((t - inFrom) / Math.max(1, p.impactAt - inFrom)) : 1 - easeInOutSine((t - p.impactAt) / Math.max(1, c.zoomOutMs));
  let z = p.zoom * clamp01(push);
  const sw = slowWindow(p, c);
  if (sw) z += c.slowZoom * windowAt(t, sw.a, sw.b, Math.max(1, c.slowRampMs) * 2);
  let x = 0, y = 0;
  const tau = Math.max(1, c.shakeMs / 4);
  if (t >= p.impactAt) {
    const age = t - p.impactAt;
    z += p.punch * Math.exp(-age / tau);
    const s = spring(age, 15, tau) * p.shakePx;
    x += dir.x * s; y += dir.y * s;
    if (p.kind === 'bicycle') {
      // The whole board shakes: a rumble across both axes dying away.
      const r = p.shakePx * 0.45 * Math.exp(-age / (tau * 2.2));
      x += Math.sin(age * 0.137) * r; y += Math.cos(age * 0.101) * r;
    }
  }
  return { zoom: 1 + z, x, y };
}

/** The point the final shot leaves from (for the blow's direction and the impact FX). Pure. */
export function shotFrom(p: SoccerPlan, g: SoccerGeo, a: Pt, aR: number): Pt {
  if (p.kind === 'corner') return p.variant === 2 ? { x: g.header.x, y: g.header.y - aR * 0.9 } : p.variant === 3 ? g.meet : g.corner;
  if (p.kind === 'breakaway') return g.shot;
  if (p.kind === 'bicycle') return g.contact;
  return a;
}
