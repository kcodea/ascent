/**
 * THE BASEBALL HERO ATTACK ("Charge the Mound", a Legendary with four tiers): its tuned values, its pure timeline, the
 * pure geometry, the pure poses of BOTH portraits, the pure paths of the ball and the bat, the slow mo and the camera.
 *
 * Owner 2026-11-02: "baseball - have the opponent be the pitcher and the batter be the player dealing dmg. the final lvl
 * 4/knockout should be the player getting struck by the ball and charging the mound and beating up the opponent in an
 * over the top fast attack sequence", and "get creative and fun".
 *
 * THE SIGNATURE: the roles are flipped for the first time in any attack. The STRUCK hero acts first: its portrait is the
 * PITCHER, it winds up and throws, and the striker (the BATTER, holding a bat at its side) sends it right back. Both
 * portraits move.
 *
 * FOUR TIERS on the shared thresholds (`attackTier`: a knockout always plays IV):
 *  - I UP THE MIDDLE: the pitcher winds up and throws, CRACK, a line drive straight back up the middle that BONKS the
 *    pitcher (THE impact) and pops away.
 *  - II THE HOT SHOT: a bigger, stepping swing, and one of three rolled hits: 1 a SCREAMING LINER (flat and fast, it spins
 *    the pitcher round), 2 a ONE-HOP GROUNDER (it skips once, kicks up dirt and hops into the pitcher), 3 a FOUL TIP
 *    BOOMERANG (it tips off foul, curves wide round the field and smacks the pitcher from BEHIND).
 *  - III THE MOONSHOT: slow mo on the contact, a huge CRACK, the BAT FLIP (it spins up and clatters down), the ball
 *    rockets off the top of the screen and twinkles; the pitcher looks round in a panic as a shadow grows under it and a
 *    slide whistle falls; the ball comes down from the sky and CRATERS the pitcher (THE impact): HOME RUN.
 *  - IV CHARGE THE MOUND (the owner's frame): the pitcher BEANS the batter (BONK on the striker; slow mo; it staggers,
 *    stars), the batter slams its bat down, fumes, and CHARGES THE MOUND to the ballpark organ's "Charge!" riff, a dash
 *    into a cartoon DUST-CLOUD BRAWL (the benches clear: streaks rush in from both edges; the two portraits shake and pop
 *    out of the boiling cloud; a fast flurry of comic hits, POW / BAM / SMACK, sped up), then the batter winds up one
 *    huge haymaker and sends the pitcher flying: YER OUT! (THE impact, the umpire's call).
 *
 * THE CONTRACT: the blow lands exactly ONCE, on the impact (the BONK, the crater, the haymaker). The pitch, the bean on
 * the striker, the hop, the foul tip and every brawl hit are TICKS (no damage). Both portraits are restored exactly on
 * every exit path (the runner owns that). No hit-stop: the slow mo is a smooth ramp that never reaches 0.
 *
 * VARIETY: II's hit is `variantOf(rollSeed)`, a stable per-blow seed (the run seed and the round), so a replay rolls the
 * same; the DEV tuner's "Variation" row forces one.
 */
import { configStore } from '../heroAttack/configStore';
import { clamp, clamp01, easeInOutSine, easeOutCubic, spring, type Pt } from '../heroAttack/easing';
import {
  HERO_ATTACK_TIER_THRESHOLDS, TIERS, reducedAttackTimeline, attackTier, type AttackTierContext, type TierNum,
} from '../heroAttack/tiers';

export { TIERS };
export type { TierNum };

export const BASEBALL_KINDS = ['single', 'hotshot', 'moonshot', 'brawl'] as const;
export type BaseballKind = (typeof BASEBALL_KINDS)[number];

/** Each tier's play. */
export function baseballKind(tier: TierNum): BaseballKind { return BASEBALL_KINDS[tier - 1]!; }

export const BASEBALL_LEVELS = ['t1', 't2', 't3', 't4'] as const;

export const BASEBALL_TIER_SUFFIXES = [
  'ReadyMs', 'WindupMs', 'PitchMs', 'SwingMs', 'FlightMs', 'HoldMs', 'ReturnMs', 'Knock', 'Zoom', 'Punch', 'Shake', 'Burst', 'Rings', 'Dim',
] as const;
export type BaseballTierSuffix = (typeof BASEBALL_TIER_SUFFIXES)[number];
type TierKey = `t${TierNum}${BaseballTierSuffix}`;

interface GlobalConfig {
  tier2At: number; tier3At: number; tier4At: number;
  absorbMs: number;
  ballSize: number;
  batSize: number;
  spin: number;
  trailMs: number;
  shadowDrop: number;
  windupBack: number;
  windupLean: number;
  lunge: number;
  stride: number;
  swingLean: number;
  linerSpin: number;
  hopAt: number;
  hopHeight: number;
  foulWide: number;
  foulMs: number;
  moonUpMs: number;
  moonHangMs: number;
  moonDownMs: number;
  moonSize: number;
  panic: number;
  batFlipMs: number;
  batFlipHeight: number;
  batFlipTurns: number;
  staggerMs: number;
  staggerWobble: number;
  batSlamMs: number;
  fumeMs: number;
  chargeMs: number;
  brawlMs: number;
  brawlHits: number;
  brawlJitter: number;
  brawlCloud: number;
  benchRush: number;
  koWindupMs: number;
  koLaunch: number;
  koSpin: number;
  contactSlow: number;
  contactSlowMs: number;
  beanSlow: number;
  beanSlowMs: number;
  brawlBoost: number;
  slowRampMs: number;
  slowZoom: number;
  /** DEV: '' = rolled per blow, '1' / '2' / '3' force II's hit (a string so the tuner shows it as a select). */
  variation: string;
  wordSize: number;
  squash: number;
  shakeMs: number;
  zoomOutMs: number;
  reducedFadeMs: number;
  colorBall: string;
  colorBat: string;
  colorDust: string;
  colorFlash: string;
  colorPow: string;
  colorPlayer: string;
  colorFoe: string;
  sfxGloveClip: string; sfxGloveGain: number; sfxGloveRate: number;
  sfxPitchClip: string; sfxPitchGain: number; sfxPitchRate: number;
  sfxCrackClip: string; sfxCrackGain: number; sfxCrackRate: number;
  sfxBonkClip: string; sfxBonkGain: number; sfxBonkRate: number;
  sfxHopClip: string; sfxHopGain: number; sfxHopRate: number;
  sfxFallClip: string; sfxFallGain: number; sfxFallRate: number;
  sfxChargeClip: string; sfxChargeGain: number; sfxChargeRate: number;
  sfxThumpClip: string; sfxThumpGain: number; sfxThumpRate: number;
  sfxBrawlClip: string; sfxBrawlGain: number; sfxBrawlRate: number;
  sfxKoClip: string; sfxKoGain: number; sfxKoRate: number;
  sfxUmpClip: string; sfxUmpGain: number; sfxUmpRate: number;
  sfxOohClip: string; sfxOohGain: number; sfxOohRate: number;
  sfxCheerClip: string; sfxCheerGain: number; sfxCheerRate: number;
  sfxDuck: number;
  previewDamage: number;
  previewParts: number;
}
export type HeroBaseballConfig = GlobalConfig & Record<TierKey, number>;

export const HERO_BASEBALL_COLOR_KEYS = ['colorBall', 'colorBat', 'colorDust', 'colorFlash', 'colorPow', 'colorPlayer', 'colorFoe'] as const;
export const HERO_BASEBALL_CLIP_KEYS = [
  'sfxGloveClip', 'sfxPitchClip', 'sfxCrackClip', 'sfxBonkClip', 'sfxHopClip', 'sfxFallClip', 'sfxChargeClip', 'sfxThumpClip', 'sfxBrawlClip', 'sfxKoClip',
  'sfxUmpClip', 'sfxOohClip', 'sfxCheerClip',
] as const;
export type HeroBaseballStrKey = (typeof HERO_BASEBALL_COLOR_KEYS)[number] | (typeof HERO_BASEBALL_CLIP_KEYS)[number] | 'variation';
export type HeroBaseballNumKey = Exclude<keyof HeroBaseballConfig, HeroBaseballStrKey>;

/** Per tier: [I, II, III, IV]. A dial a tier's play does not use is ignored there (the tuner says which). */
const TIER_DEFAULTS: Record<BaseballTierSuffix, [number, number, number, number]> = {
  ReadyMs: [100, 100, 100, 100],
  WindupMs: [420, 440, 480, 460],
  PitchMs: [230, 210, 220, 200],
  SwingMs: [150, 170, 190, 0],
  FlightMs: [240, 300, 0, 0],
  HoldMs: [380, 360, 420, 420],
  ReturnMs: [260, 320, 380, 440],
  Knock: [0.6, 0.8, 1, 1.4],
  Zoom: [0.02, 0.03, 0.04, 0.05],
  Punch: [0.012, 0.018, 0.035, 0.05],
  Shake: [3, 5, 12, 20],
  Burst: [0.8, 1.05, 1.5, 1.9],
  Rings: [1, 2, 4, 5],
  Dim: [0.1, 0.14, 0.2, 0.28],
};

export const BASEBALL_TIER_RANGES: Record<BaseballTierSuffix, [number, number, number]> = {
  ReadyMs: [0, 1000, 10],
  WindupMs: [120, 1500, 10],
  PitchMs: [60, 1000, 10],
  SwingMs: [0, 600, 10],
  FlightMs: [0, 1500, 10],
  HoldMs: [0, 1500, 10],
  ReturnMs: [0, 1500, 10],
  Knock: [0, 4, 0.05],
  Zoom: [0, 0.2, 0.005],
  Punch: [0, 0.1, 0.001],
  Shake: [0, 40, 0.5],
  Burst: [0, 3, 0.05],
  Rings: [0, 8, 1],
  Dim: [0, 0.6, 0.01],
};

const tierDefaults = Object.fromEntries(TIERS.flatMap((t) => BASEBALL_TIER_SUFFIXES.map((s) => [`t${t}${s}`, TIER_DEFAULTS[s][t - 1]]))) as Record<TierKey, number>;

export const HERO_BASEBALL_DEFAULTS: HeroBaseballConfig = {
  ...HERO_ATTACK_TIER_THRESHOLDS,
  absorbMs: 180,
  ballSize: 0.24,
  batSize: 1,
  spin: 3,
  trailMs: 22,
  shadowDrop: 0.5,
  windupBack: 0.22,
  windupLean: 14,
  lunge: 0.32,
  stride: 0.22,
  swingLean: 12,
  linerSpin: 1,
  hopAt: 0.5,
  hopHeight: 0.9,
  foulWide: 0.9,
  foulMs: 720,
  moonUpMs: 420,
  moonHangMs: 520,
  moonDownMs: 380,
  moonSize: 2.2,
  panic: 0.16,
  batFlipMs: 640,
  batFlipHeight: 1.6,
  batFlipTurns: 2.5,
  staggerMs: 460,
  staggerWobble: 18,
  batSlamMs: 200,
  fumeMs: 260,
  chargeMs: 300,
  brawlMs: 1050,
  brawlHits: 9,
  brawlJitter: 1,
  brawlCloud: 1,
  benchRush: 1,
  koWindupMs: 240,
  koLaunch: 1.6,
  koSpin: 1.5,
  contactSlow: 0.4,
  contactSlowMs: 340,
  beanSlow: 0.45,
  beanSlowMs: 300,
  brawlBoost: 1.3,
  slowRampMs: 70,
  slowZoom: 0.015,
  variation: '',
  wordSize: 1,
  squash: 0.1,
  shakeMs: 300,
  zoomOutMs: 420,
  reducedFadeMs: 260,
  colorBall: '#ffffff',
  colorBat: '#d79b5c',
  colorDust: '#d9c3a0',
  colorFlash: '#fff4dc',
  colorPow: '#ffd23f',
  colorPlayer: '#ffcf5a',
  colorFoe: '#ff6a5a',
  sfxGloveClip: 'fx/baseball-glove', sfxGloveGain: 0.6, sfxGloveRate: 1,
  sfxPitchClip: 'fx/stereogenicstudio-swish-swoosh-woosh-sfx-27-357164-3', sfxPitchGain: 0.3, sfxPitchRate: 1.3,
  sfxCrackClip: 'fx/baseball-crack', sfxCrackGain: 1, sfxCrackRate: 1,
  sfxBonkClip: 'fx/baseball-bonk', sfxBonkGain: 0.7, sfxBonkRate: 1,
  sfxHopClip: 'fx/bball-dribble', sfxHopGain: 0.6, sfxHopRate: 1.25,
  sfxFallClip: 'fx/baseball-fall', sfxFallGain: 0.5, sfxFallRate: 1,
  sfxChargeClip: 'fx/baseball-charge', sfxChargeGain: 0.55, sfxChargeRate: 1,
  sfxThumpClip: 'flurryhit', sfxThumpGain: 0.35, sfxThumpRate: 1.1,
  sfxBrawlClip: 'fx/baseball-brawl', sfxBrawlGain: 0.8, sfxBrawlRate: 1,
  sfxKoClip: 'fx/heavy-rock-impact', sfxKoGain: 0.45, sfxKoRate: 1.1,
  sfxUmpClip: 'fx/baseball-out', sfxUmpGain: 0.75, sfxUmpRate: 1,
  sfxOohClip: 'fx/bball-ooh', sfxOohGain: 0.7, sfxOohRate: 1,
  sfxCheerClip: 'fx/cheering', sfxCheerGain: 0.25, sfxCheerRate: 1,
  sfxDuck: 0.6,
  previewDamage: 12,
  previewParts: 4,
  ...tierDefaults,
};

const GLOBAL_RANGES: Record<Exclude<keyof GlobalConfig, HeroBaseballStrKey>, [number, number, number]> = {
  tier2At: [2, 40, 1], tier3At: [2, 60, 1], tier4At: [2, 80, 1],
  absorbMs: [60, 600, 10],
  ballSize: [0.1, 1, 0.01],
  batSize: [0.3, 2.5, 0.05],
  spin: [0, 10, 0.1],
  trailMs: [10, 120, 1],
  shadowDrop: [0, 1.5, 0.01],
  windupBack: [0, 1, 0.01],
  windupLean: [0, 40, 0.5],
  lunge: [0, 1, 0.01],
  stride: [0, 1, 0.01],
  swingLean: [0, 40, 0.5],
  linerSpin: [0, 4, 0.25],
  hopAt: [0.2, 0.8, 0.01],
  hopHeight: [0, 3, 0.05],
  foulWide: [0.2, 2, 0.05],
  foulMs: [200, 2000, 10],
  moonUpMs: [100, 1500, 10],
  moonHangMs: [0, 2000, 10],
  moonDownMs: [100, 1500, 10],
  moonSize: [1, 4, 0.05],
  panic: [0, 1, 0.01],
  batFlipMs: [200, 1500, 10],
  batFlipHeight: [0, 4, 0.05],
  batFlipTurns: [0, 6, 0.25],
  staggerMs: [100, 1500, 10],
  staggerWobble: [0, 45, 0.5],
  batSlamMs: [60, 800, 10],
  fumeMs: [0, 1200, 10],
  chargeMs: [100, 1200, 10],
  brawlMs: [300, 3000, 10],
  brawlHits: [2, 16, 1],
  brawlJitter: [0, 3, 0.05],
  brawlCloud: [0, 3, 0.05],
  benchRush: [0, 3, 0.05],
  koWindupMs: [60, 1000, 10],
  koLaunch: [0, 4, 0.05],
  koSpin: [0, 4, 0.25],
  contactSlow: [0.2, 1, 0.01],
  contactSlowMs: [0, 1200, 10],
  beanSlow: [0.2, 1, 0.01],
  beanSlowMs: [0, 1200, 10],
  brawlBoost: [1, 2, 0.01],
  slowRampMs: [10, 300, 5],
  slowZoom: [0, 0.08, 0.001],
  wordSize: [0, 2.5, 0.05],
  squash: [0, 0.4, 0.01],
  shakeMs: [0, 1200, 10],
  zoomOutMs: [60, 1500, 10],
  reducedFadeMs: [60, 1000, 10],
  sfxGloveGain: [0, 2, 0.05], sfxGloveRate: [0.5, 2.5, 0.01],
  sfxPitchGain: [0, 2, 0.05], sfxPitchRate: [0.5, 2.5, 0.01],
  sfxCrackGain: [0, 2, 0.05], sfxCrackRate: [0.5, 2.5, 0.01],
  sfxBonkGain: [0, 2, 0.05], sfxBonkRate: [0.5, 2.5, 0.01],
  sfxHopGain: [0, 2, 0.05], sfxHopRate: [0.5, 2.5, 0.01],
  sfxFallGain: [0, 2, 0.05], sfxFallRate: [0.5, 2.5, 0.01],
  sfxChargeGain: [0, 2, 0.05], sfxChargeRate: [0.5, 2.5, 0.01],
  sfxThumpGain: [0, 2, 0.05], sfxThumpRate: [0.5, 2.5, 0.01],
  sfxBrawlGain: [0, 2, 0.05], sfxBrawlRate: [0.5, 2.5, 0.01],
  sfxKoGain: [0, 2, 0.05], sfxKoRate: [0.5, 2.5, 0.01],
  sfxUmpGain: [0, 2, 0.05], sfxUmpRate: [0.5, 2.5, 0.01],
  sfxOohGain: [0, 2, 0.05], sfxOohRate: [0.5, 2.5, 0.01],
  sfxCheerGain: [0, 2, 0.05], sfxCheerRate: [0.5, 2.5, 0.01],
  sfxDuck: [0, 1, 0.05],
  previewDamage: [1, 60, 1],
  previewParts: [1, 8, 1],
};

export const HERO_BASEBALL_RANGES: Record<HeroBaseballNumKey, [number, number, number]> = {
  ...GLOBAL_RANGES,
  ...(Object.fromEntries(TIERS.flatMap((t) => BASEBALL_TIER_SUFFIXES.map((s) => [`t${t}${s}`, BASEBALL_TIER_RANGES[s]]))) as Record<TierKey, [number, number, number]>),
};

/** Hard caps (whatever the tuner says). */
export const BASEBALL_CAPS = { shakePx: 40, hits: 16 } as const;

const store = configStore<HeroBaseballConfig>({
  key: 'ascent.herobaseball.v1', defaults: HERO_BASEBALL_DEFAULTS, ranges: HERO_BASEBALL_RANGES,
  colorKeys: HERO_BASEBALL_COLOR_KEYS, clipKeys: [...HERO_BASEBALL_CLIP_KEYS, 'variation'], previewKeys: ['previewDamage', 'previewParts', 'variation'],
});
export const heroBaseballStore = store;
export const getHeroBaseballConfig = store.get;
export const clampHeroBaseballValue = store.clamp;
export const sanitizeHeroBaseballConfig = store.sanitize;
export const heroBaseballConfigJson = store.json;
/** The preview speed hook (Recruit + the Collection read one per style). Always 1: the tuner has no speed buttons. */
export function heroBaseballPreviewSpeed(): number { return 1; }

export function baseballTierDials(tier: TierNum, c: HeroBaseballConfig = store.get()): Record<BaseballTierSuffix, number> {
  return Object.fromEntries(BASEBALL_TIER_SUFFIXES.map((s) => [s, c[`t${tier}${s}`]])) as Record<BaseballTierSuffix, number>;
}

// ─── the variation roll (pure) ──────────────────────────────────────────────────────────────────────────────────────

export type BaseballVariant = 1 | 2 | 3;
export const BASEBALL_VARIANTS: readonly BaseballVariant[] = [1, 2, 3];
/** II's hits, by variant. */
export const HOT_SHOTS: Record<BaseballVariant, string> = { 1: 'screaming liner', 2: 'one-hop grounder', 3: 'foul tip boomerang' };

/** The variation a blow plays: the DEV override when set, else rolled from the stable per-blow seed. Pure. */
export function variantOf(rollSeed: number, c: HeroBaseballConfig = store.get()): BaseballVariant {
  const forced = Number(c.variation);
  if (forced === 1 || forced === 2 || forced === 3) return forced;
  let h = (Math.round(rollSeed) | 0) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return ((h % 3) + 1) as BaseballVariant;
}

// ─── the pure plan ─────────────────────────────────────────────────────────────────────────────────────────────

export interface BaseballPlanInput extends AttackTierContext {
  leadIn?: number;
  total: number;
  reduced?: boolean;
  /** II's hit. Default 1. */
  variant?: BaseballVariant;
}

export interface BaseballPlan {
  reduced: boolean;
  tier: TierNum;
  kind: BaseballKind;
  variant: BaseballVariant;
  k: number;
  total: number;
  chargeAt: number;
  absorbEnd: number;
  /** The pitcher's windup, and the pitch leaving the hand. */
  windAt: number;
  releaseAt: number;
  /** The pitch arrives: the bat meets it (I-III), or it BEANS the batter (IV). */
  arriveAt: number;
  /** I-III: the swing around the contact. */
  swingAt: number;
  swingEnd: number;
  /** II (the grounder): the one hop. */
  hopAt: number | null;
  /** III: the ball at the top (off the top of the screen), and starting down. */
  apexAt: number | null;
  dropAt: number | null;
  /** III: the bat flip lands. */
  batLandAt: number | null;
  /** IV: the bean (= arriveAt), the stagger's end, the bat thrown down and landing, the charge, the collision. */
  beanAt: number | null;
  staggerEnd: number | null;
  batDropAt: number | null;
  clatterAt: number | null;
  chargeRunAt: number | null;
  collideAt: number | null;
  /** IV: the brawl's comic hits (ticks), the brawl's end, and the haymaker's wind-up. */
  hits: number[];
  brawlEnd: number | null;
  koWindAt: number | null;
  /** THE impact. The blow lands here, once. */
  impactAt: number;
  /** The batter heads home (IV: from the mound), and is home. */
  homeAt: number;
  homeEnd: number;
  endAt: number;
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
export function baseballPlan(input: BaseballPlanInput, c: HeroBaseballConfig = store.get()): BaseballPlan {
  const total = Math.max(0, Math.round(input.total));
  const tier = attackTier(total, input, c); // a knockout always plays the shared Tier IV
  const kind = baseballKind(tier);
  const L = baseballTierDials(tier, c);
  const k = (tier - 1) / 3;
  const variant: BaseballVariant = input.variant ?? 1;
  const looks = {
    tier, kind, variant, k, total, knock: L.Knock, zoom: L.Zoom, punch: L.Punch, shakePx: clamp(L.Shake, 0, BASEBALL_CAPS.shakePx),
    burst: L.Burst, rings: Math.round(L.Rings), dim: L.Dim,
  };
  const none = {
    hopAt: null, apexAt: null, dropAt: null, batLandAt: null, beanAt: null, staggerEnd: null, batDropAt: null, clatterAt: null,
    chargeRunAt: null, collideAt: null, hits: [] as number[], brawlEnd: null, koWindAt: null,
  };
  if (input.reduced) {
    const r = reducedAttackTimeline(input.leadIn ?? 0, c.reducedFadeMs);
    const at = r.impactAt;
    return {
      ...looks, ...none, reduced: true, chargeAt: at, absorbEnd: at, windAt: at, releaseAt: at, arriveAt: at, swingAt: at, swingEnd: at,
      impactAt: at, homeAt: at, homeEnd: at, endAt: r.endAt, zoom: 0, punch: 0, shakePx: 0, burst: 0, rings: 0, dim: 0, knock: 0,
    };
  }
  const chargeAt = Math.max(0, input.leadIn ?? 0);
  const absorbEnd = chargeAt + c.absorbMs;
  const windAt = chargeAt + Math.max(L.ReadyMs, c.absorbMs * 0.6);
  const releaseAt = windAt + L.WindupMs;
  const arriveAt = releaseAt + Math.max(40, L.PitchMs);
  if (kind !== 'brawl') {
    const swing = Math.max(60, L.SwingMs);
    const swingAt = arriveAt - swing * 0.55;
    const swingEnd = arriveAt + swing * 0.45;
    let impactAt: number;
    let hopAt: number | null = null;
    let apexAt: number | null = null, dropAt: number | null = null, batLandAt: number | null = null;
    if (kind === 'single') impactAt = arriveAt + Math.max(60, L.FlightMs);
    else if (kind === 'hotshot') {
      const f = Math.max(80, L.FlightMs);
      if (variant === 1) impactAt = arriveAt + f * 0.72; // the liner: flat and FAST
      else if (variant === 2) { hopAt = arriveAt + f * c.hopAt; impactAt = arriveAt + f * 1.1; }
      else impactAt = arriveAt + Math.max(200, c.foulMs);
    } else {
      apexAt = arriveAt + c.moonUpMs;
      dropAt = apexAt + c.moonHangMs;
      impactAt = dropAt + c.moonDownMs;
      batLandAt = arriveAt + 60 + c.batFlipMs;
    }
    const homeAt = Math.max(swingEnd + 80, impactAt + L.HoldMs * 0.4);
    const homeEnd = homeAt + L.ReturnMs;
    return {
      ...looks, ...none, reduced: false, chargeAt, absorbEnd, windAt, releaseAt, arriveAt, swingAt, swingEnd, hopAt, apexAt, dropAt, batLandAt,
      impactAt, homeAt, homeEnd, endAt: Math.max(homeEnd, impactAt + L.HoldMs, batLandAt !== null ? batLandAt + 360 : 0),
    };
  }
  // IV: CHARGE THE MOUND.
  const beanAt = arriveAt;
  const staggerEnd = beanAt + c.staggerMs;
  const batDropAt = beanAt + c.staggerMs * 0.6;
  const clatterAt = batDropAt + c.batSlamMs;
  const chargeRunAt = Math.max(staggerEnd, clatterAt) + c.fumeMs;
  const collideAt = chargeRunAt + c.chargeMs;
  const brawlEnd = collideAt + c.brawlMs;
  const n = clamp(Math.round(c.brawlHits), 2, BASEBALL_CAPS.hits);
  // The flurry: evenly spread, a touch ragged (deterministic), never before the collision or after the brawl.
  const span = Math.max(1, c.brawlMs - 140);
  const hits = Array.from({ length: n }, (_, i) => collideAt + 70 + (span * (i + 0.5)) / n + Math.sin(i * 2.17) * (span / n) * 0.22);
  const koWindAt = brawlEnd;
  const impactAt = koWindAt + c.koWindupMs;
  const homeAt = impactAt + L.HoldMs;
  const homeEnd = homeAt + L.ReturnMs;
  return {
    ...looks, ...none, reduced: false, chargeAt, absorbEnd, windAt, releaseAt, arriveAt, swingAt: arriveAt, swingEnd: arriveAt,
    beanAt, staggerEnd, batDropAt, clatterAt, chargeRunAt, collideAt, hits, brawlEnd, koWindAt, impactAt, homeAt, homeEnd,
    endAt: Math.max(homeEnd, impactAt + L.HoldMs),
  };
}

export type BaseballCueKind =
  | 'charge' | 'windup' | 'pitch' | 'swing' | 'crack' | 'hop' | 'twinkle' | 'fall' | 'batland' | 'bean' | 'batdrop' | 'clatter' | 'fume'
  | 'run' | 'collide' | 'hit' | 'kowind' | 'impact' | 'home' | 'end';
export interface BaseballCue { at: number; kind: BaseballCueKind; i: number }

/** III: how long before the crash the slide whistle starts (the clip's length). */
export const FALL_LEAD_MS = 760;

/** Every beat the runner fires, in time order. The blow lands on `impact`, once. */
export function baseballCues(p: BaseballPlan): BaseballCue[] {
  const out: BaseballCue[] = [];
  if (!p.reduced) {
    out.push({ at: p.chargeAt, kind: 'charge', i: 0 });
    out.push({ at: p.windAt, kind: 'windup', i: 0 });
    out.push({ at: p.releaseAt, kind: 'pitch', i: 0 });
    if (p.kind !== 'brawl') {
      out.push({ at: p.swingAt, kind: 'swing', i: 0 });
      out.push({ at: p.arriveAt, kind: 'crack', i: 0 });
    }
    if (p.hopAt !== null) out.push({ at: p.hopAt, kind: 'hop', i: 0 });
    if (p.apexAt !== null) out.push({ at: p.apexAt, kind: 'twinkle', i: 0 });
    // The slide whistle (about 0.78 s long) is timed so it bottoms out on the crash.
    if (p.dropAt !== null) out.push({ at: Math.max(p.apexAt ?? p.dropAt, p.impactAt - FALL_LEAD_MS), kind: 'fall', i: 0 });
    if (p.batLandAt !== null) out.push({ at: p.batLandAt, kind: 'batland', i: 0 });
    if (p.beanAt !== null) out.push({ at: p.beanAt, kind: 'bean', i: 0 });
    if (p.batDropAt !== null) out.push({ at: p.batDropAt, kind: 'batdrop', i: 0 });
    if (p.clatterAt !== null) out.push({ at: p.clatterAt, kind: 'clatter', i: 0 });
    if (p.staggerEnd !== null) out.push({ at: p.staggerEnd, kind: 'fume', i: 0 });
    if (p.chargeRunAt !== null) out.push({ at: p.chargeRunAt, kind: 'run', i: 0 });
    if (p.collideAt !== null) out.push({ at: p.collideAt, kind: 'collide', i: 0 });
    p.hits.forEach((at, i) => out.push({ at, kind: 'hit', i }));
    if (p.koWindAt !== null) out.push({ at: p.koWindAt, kind: 'kowind', i: 0 });
    if (p.homeEnd > p.homeAt) out.push({ at: p.homeAt, kind: 'home', i: 0 });
  }
  out.push({ at: p.impactAt, kind: 'impact', i: 0 });
  out.push({ at: p.endAt, kind: 'end', i: 0 });
  const order: Record<BaseballCueKind, number> = {
    charge: 0, windup: 1, pitch: 2, swing: 3, crack: 4, hop: 5, twinkle: 6, fall: 7, batland: 8, bean: 9, batdrop: 10, clatter: 11, fume: 12,
    run: 13, collide: 14, hit: 15, kowind: 16, impact: 17, home: 18, end: 19,
  };
  return out.sort((a, b) => a.at - b.at || order[a.kind] - order[b.kind]);
}

// ─── the geometry (pure) ───────────────────────────────────────────────────────────────────────────────────────

export interface Frame { x0: number; y0: number; x1: number; y1: number }

export interface BaseballGeo {
  /** Unit, batter (striker) -> pitcher (target), its normal, and the distance. */
  u: Pt;
  n: Pt;
  dist: number;
  /** Which side of the batter the hands (and the bat) are on: +1 along `n`, -1 against it (the side with more room). */
  side: 1 | -1;
  /** Every point below is SCREEN px. The batter's hands at rest (the bat's pivot), offset from its centre. */
  hands: Pt;
  /** Where the bat meets the ball (in front of the batter, on the barrel). */
  plate: Pt;
  /** The pitcher's release point (in front of it, toward the batter). */
  release: Pt;
  /** The target's centre: where every hit lands. */
  hit: Pt;
  /** IV: where the bean strikes the batter (its face). */
  bean: Pt;
  /** II (the grounder): the hop. */
  hop: Pt;
  /** II (the foul tip): the two control points of the boomerang curve (kept on screen). */
  foul1: Pt;
  foul2: Pt;
  /** III: where the moonshot leaves the top of the screen, and where it comes down from (straight above the target). */
  sky: Pt;
  skyDrop: Pt;
  /** III: where the flipped bat lands. IV: where the slammed bat lands. */
  batLand: Pt;
  batSlam: Pt;
  /**
   * IV: the brawl's centre (the cloud), pulled in off the edges so the whole cloud stays on screen; where the charge ends
   * (the batter's side of it); the pitcher's spot in it, as an OFFSET from its slot (it is dragged into the cloud); and
   * the pitcher's KO launch, an offset from its slot (kept on screen).
   */
  cloud: Pt;
  mound: Pt;
  pitcherBrawl: Pt;
  launch: Pt;
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

const add = (a: Pt, b: Pt, k = 1): Pt => ({ x: a.x + b.x * k, y: a.y + b.y * k });
const lerpPt = (a: Pt, b: Pt, t: number): Pt => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

/** The bat's length (screen px) for a batter of radius `aR`. */
export function batLength(aR: number, c: HeroBaseballConfig): number { return aR * 1.55 * c.batSize; }

/** Where every play goes, from the two heroes and the frame (screen px). Pure. */
export function baseballGeo(a: Pt, d: Pt, aR: number, dR: number, frame: Frame | null, c: HeroBaseballConfig = store.get()): BaseballGeo {
  const dx = d.x - a.x, dy = d.y - a.y;
  const dist = Math.hypot(dx, dy) || 1;
  const u = { x: dx / dist, y: dy / dist };
  const n = { x: -u.y, y: u.x };
  const m = aR * 0.8;
  // The batter's hands go on the side with more room (so the bat and the foul tip stay on screen).
  const room = (p: Pt): number => (frame ? Math.min(p.x - frame.x0, frame.x1 - p.x, p.y - frame.y0, frame.y1 - p.y) : 0);
  const side: 1 | -1 = room(add(a, n, aR * 2.5)) >= room(add(a, n, -aR * 2.5)) ? 1 : -1;
  const L = batLength(aR, c);
  const hands = add(add(a, n, side * aR * 0.62), u, aR * 0.55);
  // At contact the bat points across the front of the batter (toward -side), the ball meets the barrel.
  const plate = add(hands, n, -side * L * 0.7);
  const release = add(d, u, -dR * 0.8);
  const hit = { ...d };
  const bean = add(a, u, aR * 0.15);
  const hop = add(lerpPt(plate, d, c.hopAt), n, side * aR * 0.15);
  // The foul tip: off foul to the hands' side, a wide loop round the field, back into the pitcher from BEHIND.
  const wide = dist * c.foulWide;
  const foul1 = clampToFrame(add(add(plate, u, dist * 0.15), n, side * wide), frame, m);
  const foul2 = clampToFrame(add(add(d, u, dR * 2.6), n, side * wide * 0.7), frame, m);
  // The moonshot: up and off the top of the screen halfway along; it comes back down straight above the target.
  const topY = frame ? frame.y0 - aR * 1.5 : Math.min(a.y, d.y) - dist;
  const sky = { x: lerpPt(plate, d, 0.5).x, y: topY };
  const skyDrop = { x: d.x, y: topY };
  const batLand = clampToFrame(add(add(a, n, side * aR * 1.55), u, -aR * 0.25), frame, m * 0.6);
  const batSlam = clampToFrame(add(add(a, n, side * aR * 1.25), u, aR * 0.35), frame, m * 0.6);
  // The brawl: just in front of the pitcher, pulled in off the edges so the whole cloud is on screen. The batter charges
  // to its near side; the pitcher is dragged in to its far side.
  const cloud = clampToFrame(add(d, u, -dR * 0.55), frame, (aR + dR) * 1.05 * Math.max(0.6, c.brawlCloud));
  const mound = add(cloud, u, -aR * 0.38);
  const pIn = add(cloud, u, dR * 0.38);
  const pitcherBrawl = { x: pIn.x - d.x, y: pIn.y - d.y };
  // The haymaker launches the pitcher away from the batter, out of the cloud, kept on screen (an offset from its slot).
  const launchTo = clampToFrame(add(pIn, u, dR * c.koLaunch), frame, dR * 0.5);
  const launch = { x: launchTo.x - d.x, y: launchTo.y - d.y };
  return { u, n, dist, side, hands, plate, release, hit, bean, hop, foul1, foul2, sky, skyDrop, batLand, batSlam, cloud, mound, pitcherBrawl, launch };
}

/** Whether a point is inside the frame (tests). */
export const onScreen = inFrame;

// ─── the poses (pure) ──────────────────────────────────────────────────────────────────────────────────────────

/** A portrait's offset from its slot (screen px), its rotation (degrees), its scale and a squash (+ = flattened). */
export interface BaseballPose { x: number; y: number; rot: number; scale: number; squash: number }
const REST: BaseballPose = { x: 0, y: 0, rot: 0, scale: 1, squash: 0 };

const easeIn = (u: number): number => { const x = clamp01(u); return x * x; };
const win = (t: number, a: number, b: number): number => clamp01((t - a) / Math.max(1, b - a));
/** A smooth 0..1 window: rises over `ramp` before `a`, holds to `b`, falls over `ramp` after. */
function windowAt(t: number, a: number, b: number, ramp: number): number {
  if (t <= a - ramp || t >= b + ramp) return 0;
  if (t < a) return easeInOutSine((t - (a - ramp)) / ramp);
  if (t <= b) return 1;
  return 1 - easeInOutSine((t - b) / ramp);
}
/** A deterministic shiver (a sum of sines; never random), -1..1. */
const jit = (t: number, f: number, ph: number): number => Math.sin(t * f + ph) * 0.6 + Math.sin(t * f * 2.31 + ph * 1.7) * 0.4;

/** The leaning sign: a positive rotation tips a portrait's top toward +x. Leaning "toward" a direction `v`. */
const leanToward = (v: Pt): number => (v.x >= 0 ? 1 : -1);

/** The BATTER (the striking portrait) at sequence time `t` (its slot is (0, 0)). Pure and deterministic. */
export function batterPose(p: BaseballPlan, g: BaseballGeo, c: HeroBaseballConfig, aR: number, a: Pt, t: number): BaseballPose {
  if (p.reduced || t < p.chargeAt || t >= p.endAt) return { ...REST };
  const pose = { ...REST };
  const u = g.u;
  const lean = c.swingLean * leanToward({ x: -g.n.x * g.side, y: 0 });
  if (p.kind !== 'brawl') {
    // The load (a lean back as the pitcher winds up), the stride and the swing, the follow-through, then home.
    const load = easeInOutSine(win(t, p.windAt, p.swingAt));
    const sw = win(t, p.swingAt, p.swingEnd);
    const stride = c.stride * (p.kind === 'single' ? 0.4 : p.kind === 'hotshot' ? 1 : 1.3) * aR;
    const home = easeInOutSine(win(t, p.homeAt, p.homeEnd));
    const fwd = (t < p.swingAt ? -0.12 * aR * load : -0.12 * aR + (stride + 0.12 * aR) * easeOutCubic(sw)) * (1 - home);
    pose.x = u.x * fwd; pose.y = u.y * fwd;
    pose.rot = (t < p.swingAt ? -lean * 0.6 * load : -lean * 0.6 + lean * 1.6 * easeOutCubic(sw)) * (1 - home);
    // The contact jolt, and a little settle home.
    if (t >= p.arriveAt) pose.squash = c.squash * 0.5 * Math.max(0, spring(t - p.arriveAt, 5, 60));
    if (t >= p.homeEnd) pose.squash += c.squash * 0.3 * Math.max(0, spring(t - p.homeEnd, 4, 60));
    return pose;
  }
  // IV: rest until the bean; BONK: knocked back and wobbling; fuming; the CHARGE; the brawl; the haymaker; home.
  const bean = p.beanAt!, st = p.staggerEnd!, run = p.chargeRunAt!, hitAt = p.collideAt!, brawlEnd = p.brawlEnd!;
  const mound = { x: g.mound.x - a.x, y: g.mound.y - a.y };
  if (t < bean) {
    // Ready in the box (a small waggle with the windup).
    pose.rot = -lean * 0.4 * easeInOutSine(win(t, p.windAt, p.releaseAt));
    return pose;
  }
  if (t < run) {
    const age = t - bean;
    const back = -aR * 0.32 * Math.max(0, spring(age, 2.2, 260)) - aR * 0.1 * clamp01(age / 120) * (1 - win(t, st, run));
    pose.x = u.x * back; pose.y = u.y * back;
    pose.rot = c.staggerWobble * spring(age, 4.5, c.staggerMs * 0.45);
    pose.squash = c.squash * 1.2 * Math.max(0, spring(age, 6, 90));
    if (t >= st) {
      // FUMING: a hot shiver, growing a touch, before the charge.
      const f = win(t, st, run);
      pose.x += jit(t, 0.11, 0.3) * aR * 0.035 * (0.5 + f);
      pose.y += jit(t, 0.13, 1.1) * aR * 0.03 * (0.5 + f);
      pose.scale = 1 + 0.05 * easeInOutSine(f);
    }
    return pose;
  }
  if (t < hitAt) {
    // THE CHARGE: accelerating at the mound, leaning in, a touch bigger.
    const e = easeIn(win(t, run, hitAt));
    const from = -aR * 0.1;
    pose.x = u.x * from * (1 - e) + mound.x * e; pose.y = u.y * from * (1 - e) + mound.y * e;
    pose.rot = 10 * leanToward(u) * Math.min(1, e * 3);
    pose.scale = 1.05 + 0.05 * e;
    return pose;
  }
  if (t < brawlEnd) {
    // THE BRAWL: shaking in the cloud, popping out on the hits.
    const J = c.brawlJitter * aR;
    let pop = 0;
    for (const h of p.hits) if (t >= h && t < h + 120) pop = Math.max(pop, Math.sin(Math.PI * ((t - h) / 120)));
    pose.x = mound.x + jit(t, 0.07, 0.2) * J * 0.28 - u.x * pop * aR * 0.3;
    pose.y = mound.y + jit(t, 0.09, 2.1) * J * 0.24 - u.y * pop * aR * 0.3;
    pose.rot = jit(t, 0.05, 0.7) * 14 * c.brawlJitter;
    pose.scale = 1.08;
    return pose;
  }
  if (t < p.impactAt) {
    // THE HAYMAKER: rear back, then lunge in.
    const w = win(t, brawlEnd, p.impactAt);
    const back = w < 0.7 ? -aR * 0.45 * easeOutCubic(w / 0.7) : -aR * 0.45 + aR * 0.85 * easeIn((w - 0.7) / 0.3);
    pose.x = mound.x + u.x * back; pose.y = mound.y + u.y * back;
    pose.rot = (w < 0.7 ? -16 * easeOutCubic(w / 0.7) : -16 + 36 * easeIn((w - 0.7) / 0.3)) * leanToward(u);
    pose.scale = 1.08 + 0.06 * w;
    return pose;
  }
  // After the haymaker: follow through at the mound, then hop home.
  const fwd = aR * 0.4 * (1 - easeOutCubic(win(t, p.impactAt, p.homeAt)));
  const home = easeInOutSine(win(t, p.homeAt, p.homeEnd));
  pose.x = (mound.x + u.x * fwd) * (1 - home); pose.y = (mound.y + u.y * fwd) * (1 - home) - Math.sin(Math.PI * home) * aR * 0.25;
  pose.rot = 20 * leanToward(u) * (1 - easeOutCubic(win(t, p.impactAt, p.homeAt + 120)));
  pose.scale = 1 + 0.12 * (1 - home);
  if (t >= p.homeEnd) pose.squash = c.squash * 0.4 * Math.max(0, spring(t - p.homeEnd, 4, 60));
  return pose;
}

/** The PITCHER (the struck portrait) at sequence time `t` (its slot is (0, 0)). Pure and deterministic. */
export function pitcherPose(p: BaseballPlan, g: BaseballGeo, c: HeroBaseballConfig, dR: number, t: number): BaseballPose {
  if (p.reduced || t < p.chargeAt || t >= p.endAt) return { ...REST };
  const pose = { ...REST };
  const u = g.u; // toward the pitcher from the batter: +u is BACK for the pitcher
  // THE WINDUP: rocks back (the leg kick lifts it a touch), then the lunge on the release, then it recovers.
  if (t >= p.windAt) {
    const w = win(t, p.windAt, p.releaseAt);
    const rock = Math.sin(Math.PI * Math.min(1, w / 0.85)) * (w < 0.85 ? 1 : 0);
    const back = dR * c.windupBack * rock;
    const after = t >= p.releaseAt ? t - p.releaseAt : -1;
    const lunge = after >= 0 ? dR * c.lunge * (after < 90 ? easeOutCubic(after / 90) : Math.max(0, 1 - (after - 90) / 260)) : 0;
    pose.x = u.x * (back - lunge); pose.y = u.y * (back - lunge) - dR * 0.1 * rock;
    pose.rot = c.windupLean * leanToward(u) * rock - c.windupLean * 0.7 * leanToward(u) * (lunge / Math.max(1, dR * c.lunge));
    pose.scale = 1 + 0.05 * rock;
  }
  if (p.kind === 'moonshot' && p.apexAt !== null && t >= p.apexAt && t < p.impactAt) {
    // PANIC: looking round as the shadow grows, shuffling side to side faster and faster.
    const w = win(t, p.apexAt, p.impactAt);
    const sh = Math.sin((t - p.apexAt) * (0.012 + 0.03 * w)) * dR * c.panic * (0.4 + w);
    pose.x += g.n.x * sh; pose.y += g.n.y * sh;
    pose.rot += Math.sin((t - p.apexAt) * 0.02) * 8 * (0.3 + w);
  }
  if (p.kind === 'brawl') {
    const bean = p.beanAt!, hitAt = p.collideAt!, brawlEnd = p.brawlEnd!;
    if (t >= bean && t < hitAt) {
      // Uh oh: it backs up a step and trembles as the batter comes.
      const w = easeOutCubic(win(t, p.chargeRunAt!, hitAt));
      pose.x += u.x * dR * 0.12 * w + jit(t, 0.15, 0.4) * dR * 0.02 * w;
      pose.y += u.y * dR * 0.12 * w;
    }
    if (t >= hitAt && t < p.impactAt) {
      // Dragged into the cloud on the collision (quick), shaking in it, popping out on the hits.
      const pull = easeOutCubic(win(t, hitAt, hitAt + 110));
      const base = { x: u.x * dR * 0.12 * (1 - pull) + g.pitcherBrawl.x * pull, y: u.y * dR * 0.12 * (1 - pull) + g.pitcherBrawl.y * pull };
      const J = c.brawlJitter * dR;
      let pop = 0;
      for (let i = 0; i < p.hits.length; i++) {
        const h = p.hits[i]!;
        if (t >= h && t < h + 140) pop = Math.max(pop, Math.sin(Math.PI * ((t - h) / 140)) * (i % 2 ? 1 : -1));
      }
      const settle = t >= brawlEnd ? 1 - win(t, brawlEnd, p.impactAt) * 0.6 : 1;
      pose.x = base.x + (jit(t, 0.08, 1.4) * J * 0.26 + u.x * pop * dR * 0.25) * settle + g.n.x * pop * dR * 0.15;
      pose.y = base.y + (jit(t, 0.1, 0.5) * J * 0.22 + u.y * pop * dR * 0.25) * settle + g.n.y * pop * dR * 0.15;
      pose.rot = jit(t, 0.06, 2.4) * 16 * c.brawlJitter * settle;
      pose.squash = 0.06 * pop * c.brawlJitter;
      pose.scale = t >= brawlEnd ? 1 - 0.06 * win(t, brawlEnd, p.impactAt) : 1;
    }
  }
  // THE IMPACT: the reaction, by play.
  if (t >= p.impactAt) {
    const age = t - p.impactAt;
    const kpx = 26 * p.knock;
    if (p.kind === 'brawl') {
      // LAUNCHED: flung away (kept on screen), spinning, then it springs back home.
      const out = age < 140 ? easeOutCubic(age / 140) : 1;
      const back = easeInOutSine(win(t, p.homeAt, p.homeEnd));
      const k = (1 - back);
      pose.x = (g.pitcherBrawl.x + (g.launch.x - g.pitcherBrawl.x) * out) * k; pose.y = (g.pitcherBrawl.y + (g.launch.y - g.pitcherBrawl.y) * out) * k;
      pose.rot = c.koSpin * 360 * leanToward(u) * easeOutCubic(Math.min(1, age / 520)) * (1 - back);
      pose.scale = 1 - 0.15 * out * k;
      pose.squash = c.squash * 2 * Math.max(0, spring(age, 5, 110));
      if (t >= p.homeEnd) pose.squash += c.squash * 0.5 * Math.max(0, spring(t - p.homeEnd, 4, 70));
      return pose;
    }
    // The foul tip comes from BEHIND: it knocks the pitcher toward the batter.
    const dir = p.kind === 'hotshot' && p.variant === 3 ? -1 : 1;
    const kk = spring(age, 4, 110);
    pose.x += u.x * kpx * kk * dir; pose.y += u.y * kpx * kk * dir;
    pose.squash += c.squash * (p.kind === 'moonshot' ? 3.2 : 1.1) * Math.max(0, spring(age, p.kind === 'moonshot' ? 3 : 5, p.kind === 'moonshot' ? 180 : 80));
    if (p.kind === 'hotshot' && p.variant === 1) pose.rot += c.linerSpin * 360 * leanToward(u) * easeOutCubic(Math.min(1, age / 460));
    else pose.rot += 14 * dir * leanToward(u) * spring(age, 3.5, 160);
    if (p.kind === 'hotshot' && p.variant === 2) pose.y -= dR * 0.25 * Math.max(0, Math.sin(Math.PI * Math.min(1, age / 260)));
  }
  return pose;
}

// ─── the ball (pure) ───────────────────────────────────────────────────────────────────────────────────────────

/**
 * The ball: `x, y` its point on the GROUND (where its shadow sits), `lift` its height above it (screen px, drawn as an
 * upward offset), `scale` its size (III's moonshot shrinks away and grows back huge), `rot` its spin.
 */
export interface BallState { visible: boolean; x: number; y: number; lift: number; rot: number; scale: number; alpha: number; flying: boolean }

const HIDDEN: BallState = { visible: false, x: 0, y: 0, lift: 0, rot: 0, scale: 1, alpha: 0, flying: false };

export interface BallCtx { p: BaseballPlan; g: BaseballGeo; c: HeroBaseballConfig; d: Pt; dR: number; aR: number }

function cubic(a: Pt, b: Pt, c2: Pt, d: Pt, t: number): Pt {
  const s = 1 - t;
  return {
    x: s * s * s * a.x + 3 * s * s * t * b.x + 3 * s * t * t * c2.x + t * t * t * d.x,
    y: s * s * s * a.y + 3 * s * s * t * b.y + 3 * s * t * t * c2.y + t * t * t * d.y,
  };
}

/** Where the ball is at sequence time `t`. Pure and deterministic. */
export function baseballBall(x: BallCtx, t: number): BallState {
  const { p, g, c, d, dR, aR } = x;
  if (p.reduced || t < p.windAt || t >= p.impactAt) return { ...HIDDEN };
  const spin = c.spin * Math.PI * 2 / 1000;
  const lift0 = aR * 0.35; // a pitch and a liner travel about chest high
  // IN THE PITCHER'S HAND through the windup: tucked at its front, reared back high behind it, then the release.
  if (t < p.releaseAt) {
    const w = win(t, p.windAt, p.releaseAt);
    const pp = pitcherPose(p, g, c, dR, t);
    const at = { x: d.x + pp.x, y: d.y + pp.y };
    const front = add(add(at, g.u, -dR * 0.55), g.n, -g.side * dR * 0.35);
    const behind = add(add(at, g.u, dR * 0.55), g.n, g.side * dR * 0.55);
    const rel = add(at, g.u, -dR * 0.8);
    const q = w < 0.7 ? lerpPt(front, behind, easeInOutSine(w / 0.7)) : lerpPt(behind, rel, easeIn((w - 0.7) / 0.3));
    return { visible: true, x: q.x, y: q.y, lift: lift0 * (0.6 + 0.8 * Math.sin(Math.PI * Math.min(1, w / 0.8))), rot: 0, scale: 1, alpha: clamp01(w * 6), flying: false };
  }
  if (t < p.arriveAt) {
    // THE PITCH: a fastball at the plate (IV: at the batter's face).
    const e = win(t, p.releaseAt, p.arriveAt);
    const to = p.kind === 'brawl' ? g.bean : g.plate;
    const q = lerpPt(g.release, to, e);
    return { visible: true, x: q.x, y: q.y, lift: lift0, rot: (t - p.releaseAt) * spin * 1.5, scale: 1, alpha: 1, flying: true };
  }
  if (p.kind === 'brawl') return { ...HIDDEN };
  const age = t - p.arriveAt;
  const rot = -age * spin * 2;
  if (p.kind === 'single' || (p.kind === 'hotshot' && p.variant === 1)) {
    // A LINER straight back up the middle (II's is flatter and faster, with more spin).
    const e = win(t, p.arriveAt, p.impactAt);
    const q = lerpPt(g.plate, g.hit, e);
    const arc = p.kind === 'single' ? aR * 0.35 : aR * 0.12;
    return { visible: true, x: q.x, y: q.y, lift: lift0 + arc * 4 * e * (1 - e), rot: rot * (p.kind === 'single' ? 1 : 1.6), scale: 1, alpha: 1, flying: true };
  }
  if (p.kind === 'hotshot' && p.variant === 2) {
    // THE ONE-HOP GROUNDER: chopped down into the dirt, one big hop up into the pitcher.
    const hop = p.hopAt!;
    if (t < hop) {
      const e = win(t, p.arriveAt, hop);
      const q = lerpPt(g.plate, g.hop, e);
      return { visible: true, x: q.x, y: q.y, lift: lift0 * (1 - e * e), rot, scale: 1, alpha: 1, flying: true };
    }
    const e = win(t, hop, p.impactAt);
    const q = lerpPt(g.hop, g.hit, e);
    const h = aR * c.hopHeight;
    return { visible: true, x: q.x, y: q.y, lift: h * 4 * e * (1 - e) + lift0 * e * e, rot, scale: 1, alpha: 1, flying: true };
  }
  if (p.kind === 'hotshot') {
    // THE FOUL TIP BOOMERANG: off foul, a wide loop round the field, back into the pitcher from behind.
    const e = easeInOutSine(win(t, p.arriveAt, p.impactAt));
    const q = cubic(g.plate, g.foul1, g.foul2, g.hit, e);
    return { visible: true, x: q.x, y: q.y, lift: lift0 + aR * 0.5 * Math.sin(Math.PI * e), rot, scale: 1, alpha: 1, flying: true };
  }
  // III: THE MOONSHOT. Up and away off the top (shrinking), gone, then down from the sky onto the pitcher (growing).
  if (t < p.apexAt!) {
    const e = easeOutCubic(win(t, p.arriveAt, p.apexAt!));
    const ground = lerpPt(g.plate, g.hit, e * 0.5);
    const top = lerpPt(g.plate, g.sky, e);
    return { visible: true, x: ground.x, y: ground.y, lift: Math.max(0, ground.y - top.y) + lift0 * (1 - e), rot, scale: 1 - 0.65 * e, alpha: 1, flying: true };
  }
  if (t < p.dropAt!) return { ...HIDDEN, x: g.hit.x, y: g.hit.y };
  const e = easeIn(win(t, p.dropAt!, p.impactAt));
  const top = lerpPt(g.skyDrop, g.hit, e);
  return { visible: true, x: g.hit.x, y: g.hit.y, lift: Math.max(0, g.hit.y - top.y), rot, scale: 0.35 + (c.moonSize - 0.35) * e, alpha: 1, flying: true };
}

/** III: how far the falling ball's shadow has grown on the pitcher (0..1), from the apex to the crash. Pure. */
export function moonShadow(p: BaseballPlan, t: number): number {
  if (p.kind !== 'moonshot' || p.apexAt === null || t < p.apexAt || t >= p.impactAt) return 0;
  return easeIn(win(t, p.apexAt, p.impactAt));
}

// ─── the bat (pure) ────────────────────────────────────────────────────────────────────────────────────────────

/** The bat: its HANDLE end at (x, y) (screen px), pointing along `rot` (radians), lifted `lift` px, drawn at `alpha`. */
export interface BatState { visible: boolean; x: number; y: number; lift: number; rot: number; alpha: number }

const angleOf = (v: Pt): number => Math.atan2(v.y, v.x);
/** The signed shortest turn from `a` to `b` (radians). */
const turn = (a: number, b: number): number => { let d = b - a; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return d; };

/** The swing's three angles: cocked over the shoulder, at contact (across the front), the follow-through. Pure. */
export function swingAngles(g: BaseballGeo): { cock: number; contact: number; follow: number } {
  const contact = angleOf({ x: -g.side * g.n.x, y: -g.side * g.n.y });
  const back = angleOf({ x: -g.u.x, y: -g.u.y });
  const d = turn(back, contact);
  const cock = contact - d * 1.15;
  return { cock, contact, follow: contact + d * 1.25 };
}

export interface BatCtx extends BallCtx { a: Pt }

/** Where the bat is at sequence time `t`. Pure and deterministic. */
export function baseballBat(x: BatCtx, t: number): BatState {
  const { p, g, c, a, aR } = x;
  if (p.reduced || t < p.chargeAt || t >= p.endAt) return { visible: false, x: 0, y: 0, lift: 0, rot: 0, alpha: 0 };
  const bp = batterPose(p, g, c, aR, a, t);
  const hands = { x: g.hands.x + bp.x, y: g.hands.y + bp.y };
  const A = swingAngles(g);
  const alphaIn = clamp01((t - p.chargeAt) / 140);
  const alphaOut = 1 - clamp01((t - (p.endAt - 240)) / 240);
  const alpha = alphaIn * alphaOut;
  const waggle = Math.sin(t * 0.012) * 0.08 * (t < p.swingAt ? 1 : 0);
  if (p.kind !== 'brawl') {
    let rot: number;
    if (t < p.swingAt) rot = A.cock + waggle;
    else if (t < p.arriveAt) rot = A.cock + (A.contact - A.cock) * easeIn(win(t, p.swingAt, p.arriveAt));
    else rot = A.contact + (A.follow - A.contact) * easeOutCubic(win(t, p.arriveAt, p.swingEnd));
    if (p.kind === 'moonshot' && t >= p.arriveAt + 60) {
      // THE BAT FLIP: tossed up and spinning, it clatters down beside the batter and lies there.
      const t0 = p.arriveAt + 60, t1 = p.batLandAt!;
      const w = win(t, t0, t1);
      const from = { x: hands.x, y: hands.y };
      const q = lerpPt(from, g.batLand, easeOutCubic(w));
      const lift = aR * c.batFlipHeight * 4 * w * (1 - w);
      const r = A.follow + c.batFlipTurns * Math.PI * 2 * easeOutCubic(w) * -g.side;
      const bounce = t >= t1 ? aR * 0.12 * Math.max(0, Math.sin(Math.PI * Math.min(1, (t - t1) / 140))) : 0;
      return { visible: alpha > 0.004, x: q.x, y: q.y, lift: lift + bounce, rot: r, alpha };
    }
    if (t >= p.homeAt) rot = A.follow + (A.cock - A.follow) * easeInOutSine(win(t, p.homeAt, p.homeEnd));
    return { visible: alpha > 0.004, x: hands.x, y: hands.y, lift: 0, rot, alpha };
  }
  // IV: cocked in the box; it droops on the bean; SLAMMED down; it lies there through the brawl.
  if (t < p.batDropAt!) {
    const droop = t >= p.beanAt! ? 0.9 * easeOutCubic(win(t, p.beanAt!, p.beanAt! + 160)) * g.side : 0;
    return { visible: alpha > 0.004, x: hands.x, y: hands.y, lift: 0, rot: A.cock + waggle + droop, alpha };
  }
  const w = win(t, p.batDropAt!, p.clatterAt!);
  const q = lerpPt(hands, g.batSlam, easeIn(w));
  const r = A.cock + (Math.PI * 1.25 * g.side) * easeIn(w);
  const bounce = t >= p.clatterAt! ? aR * 0.18 * Math.max(0, Math.sin(Math.PI * Math.min(1, (t - p.clatterAt!) / 150))) : 0;
  return { visible: alpha > 0.004, x: q.x, y: q.y, lift: aR * 0.2 * (1 - w) + bounce, rot: r, alpha };
}

// ─── slow mo (pure) ─────────────────────────────────────────────────────────────────────────────────────────────────

/** The slow-mo window in SEQUENCE ms (a real-time length at a factor is `real * factor` of sequence time). */
export function slowWindow(p: BaseballPlan, c: HeroBaseballConfig): { a: number; b: number; factor: number } | null {
  if (p.reduced) return null;
  if (p.kind === 'moonshot' && c.contactSlowMs > 0 && c.contactSlow < 1) {
    const len = c.contactSlowMs * c.contactSlow;
    return { a: p.arriveAt - len * 0.5, b: p.arriveAt + len * 0.5, factor: c.contactSlow };
  }
  if (p.kind === 'brawl' && c.beanSlowMs > 0 && c.beanSlow < 1 && p.beanAt !== null) {
    const len = c.beanSlowMs * c.beanSlow;
    return { a: p.beanAt - len * 0.35, b: p.beanAt + len * 0.65, factor: c.beanSlow };
  }
  return null;
}

/**
 * THE ATTACK'S TIME SCALE at sequence time `t` (1 = normal). III slows around the contact; IV slows around the bean, then
 * runs FAST through the brawl (the owner's "over the top fast attack sequence"). A smooth ramp, always > 0. Pure.
 */
export function baseballTimeScale(p: BaseballPlan, c: HeroBaseballConfig, t: number): number {
  const w = slowWindow(p, c);
  let k = 1;
  if (w) k -= (1 - w.factor) * windowAt(t, w.a, w.b, Math.max(1, c.slowRampMs));
  if (p.kind === 'brawl' && p.collideAt !== null && p.brawlEnd !== null && c.brawlBoost > 1) {
    k += (c.brawlBoost - 1) * windowAt(t, p.collideAt + 30, p.brawlEnd - 30, 50);
  }
  return Math.max(0.05, k);
}

/** How much longer (real ms at speed 1) the slow mo makes the attack (negative when the speed-up wins). Pure. */
export function slowExtraMs(p: BaseballPlan, c: HeroBaseballConfig): number {
  if (p.reduced) return 0;
  let extra = 0;
  const step = 4;
  for (let t = 0; t < p.endAt; t += step) extra += step / baseballTimeScale(p, c, t) - step;
  return Math.max(0, extra);
}

// ─── the camera (pure) ─────────────────────────────────────────────────────────────────────────────────────────

/**
 * The camera: it pushes in on the pitcher while the ball flies back (I-III) or through the brawl (IV), punches and shakes
 * on the impact along the blow; IV jolts on the bean and on every brawl hit. Pure.
 */
export function baseballCameraAt(p: BaseballPlan, c: HeroBaseballConfig, t: number, dir: Pt): { zoom: number; x: number; y: number } {
  if (p.reduced) return { zoom: 1, x: 0, y: 0 };
  const inFrom = p.kind === 'brawl' ? p.chargeRunAt! : p.arriveAt - 80;
  const push = t < inFrom ? 0 : t < p.impactAt ? easeInOutSine((t - inFrom) / Math.max(1, p.impactAt - inFrom)) : 1 - easeInOutSine((t - p.impactAt) / Math.max(1, c.zoomOutMs));
  let z = p.zoom * clamp01(push);
  const sw = slowWindow(p, c);
  if (sw) z += c.slowZoom * windowAt(t, sw.a, sw.b, Math.max(1, c.slowRampMs) * 2);
  let x = 0, y = 0;
  const tau = Math.max(1, c.shakeMs / 4);
  if (p.kind === 'brawl') {
    if (p.beanAt !== null && t >= p.beanAt) { const s = spring(t - p.beanAt, 14, 60) * p.shakePx * 0.3; x -= dir.x * s; y -= dir.y * s; }
    for (let i = 0; i < p.hits.length; i++) {
      const h = p.hits[i]!;
      if (t < h || t > h + 200) continue;
      const s = spring(t - h, 16, 40) * p.shakePx * 0.25;
      const a = i * 2.4;
      x += Math.cos(a) * s; y += Math.sin(a) * s;
    }
  }
  if (t >= p.impactAt) {
    const age = t - p.impactAt;
    z += p.punch * Math.exp(-age / tau);
    const s = spring(age, 15, tau) * p.shakePx;
    x += dir.x * s; y += dir.y * s;
    if (p.kind === 'brawl' || p.kind === 'moonshot') {
      const r = p.shakePx * 0.4 * Math.exp(-age / (tau * 2));
      x += Math.sin(age * 0.137) * r; y += Math.cos(age * 0.101) * r;
    }
  }
  return { zoom: 1 + z, x, y };
}
