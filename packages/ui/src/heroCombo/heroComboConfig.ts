/**
 * THE COMBO HERO ATTACK ("Flawless", a Legendary with four tiers): its tuned values, its pure timeline, the pure
 * geometry, the pure poses of BOTH portraits, the pure combo counter, the super cut-in, the letterbox and the camera.
 *
 * THE SIGNATURE: the blow is played as an arcade FIGHTING GAME COMBO with a HUD. The striking portrait steps in beside
 * the struck one (a 2D fighter: side by side, facing each other) and lands a combo while a COMBO COUNTER ticks up beside
 * it. The counter COUNTS REAL HITS (one hit, one count); the damage is the game's own number. Every hit is LIVE Pixi
 * (a hot additive core, crossing blades, radial speed lines, a shock ring, sparks with trails), never a painted star.
 *
 * FOUR TIERS on the shared thresholds (`attackTier`: a knockout always plays Tier 4), each with its own colour, rhythm,
 * camera and effects:
 *  - TIER 1, THE COUNTER (ice blue): step in; the struck portrait lunges first and is PARRIED (a blue parry flash, a
 *    stagger), then ONE crisp counter-hit lands. "COUNTER" pops.
 *  - TIER 2, THE STRING (neon pink): jab, jab, cross, roundhouse in a steady beat, every strike leaving its own trail
 *    (short straight streaks, then a long sweeping arc on the kick); the camera bobs on the beat. The struck portrait
 *    reels, dizzy, birds of light circling its head.
 *  - TIER 3, THE LAUNCHER (gold, the centrepiece): two hits, an UPPERCUT that launches the struck portrait (the camera
 *    rises with it), the striker jumps after it and JUGGLES it (three or four air hits, rolled from the seed), the struck
 *    portrait STRUGGLES ("BREAKER?" pops: a combo-breaker tease), the next blow smashes the word and SPIKES it home. It
 *    lands dizzy.
 *  - TIER 4, THE SUPER (red and white, cinematic): opening hits, then the SUPER FREEZE: letterbox bars, the screen dims,
 *    the cut-in band slides across with the striking hero's portrait and the inputs; a flurry with the counter racing,
 *    a held wind-up, an IMPACT FRAME, the heavy blow that blasts the struck portrait away, "K.O." slams in, "PERFECT".
 *
 * THE CONTRACT: the blow lands exactly ONCE, on the impact (Tier 1 the counter-hit, Tier 2 the roundhouse, Tier 3 the
 * slam into the socket, Tier 4 the heavy blow). Every other hit is a TICK (no damage). Both portraits are restored exactly
 * on every exit path (the runner owns that). The clock never stops: the "hit-freeze", the parry and the super "freeze"
 * are HELD POSES (visuals only), so the consequence and the sound can never drift.
 *
 * VARIETY: Tier 3's air hits (three or four) come from `rollSeed`, a stable per-blow seed, so a replay rolls the same.
 */
import { configStore } from '../heroAttack/configStore';
import { clamp, clamp01, easeInOutSine, easeOutCubic, spring, type Pt } from '../heroAttack/easing';
import {
  HERO_ATTACK_TIER_THRESHOLDS, TIERS, reducedAttackTimeline, attackTier, type AttackTierContext, type TierNum,
} from '../heroAttack/tiers';

export { TIERS };
export type { TierNum };

export const COMBO_KINDS = ['counter', 'string', 'launcher', 'super'] as const;
export type ComboKind = (typeof COMBO_KINDS)[number];

/** Each tier's combo. */
export function comboKind(tier: TierNum): ComboKind { return COMBO_KINDS[tier - 1]!; }

export const COMBO_LEVELS = ['t1', 't2', 't3', 't4'] as const;

export const COMBO_TIER_SUFFIXES = [
  'ReadyMs', 'StepMs', 'GapMs', 'HoldMs', 'ReturnMs', 'Knock', 'Zoom', 'Punch', 'Shake', 'Burst', 'Rings', 'Dim',
] as const;
export type ComboTierSuffix = (typeof COMBO_TIER_SUFFIXES)[number];
type TierKey = `t${TierNum}${ComboTierSuffix}`;

interface GlobalConfig {
  tier2At: number; tier3At: number; tier4At: number;
  absorbMs: number;
  /** How close the striker stands (1 = the two portraits just touching). */
  stance: number;
  windMs: number;
  hitFreezeMs: number;
  lunge: number;
  flinch: number;
  flinchRot: number;
  /** How far a struck portrait skews on contact (degrees: the impact frame's smear). */
  skew: number;
  sparkSize: number;
  counterSize: number;
  /** Tier 1: the struck portrait's lunge (the attack that gets parried), and the beat from the parry to the counter. */
  feintMs: number;
  parryMs: number;
  launchMs: number;
  launchHeight: number;
  jumpDelayMs: number;
  jumpMs: number;
  airHits: number;
  airGapMs: number;
  airBob: number;
  /** Tier 3: the struggle ("BREAKER?") between the last air hit and the spike. */
  breakMs: number;
  spikeMs: number;
  slamMs: number;
  /** Tier 2 and Tier 3: how long the struck portrait reels, dizzy, after the blow. */
  dizzyMs: number;
  openHits: number;
  freezeDelayMs: number;
  cutinMs: number;
  cutinSlideMs: number;
  cutinDim: number;
  cutinTilt: number;
  cutinHeight: number;
  /** Tier 4: the letterbox bars' height (a part of the screen). */
  barsH: number;
  flurryHits: number;
  flurryGapMs: number;
  heavyWindMs: number;
  koLaunch: number;
  koSpin: number;
  koDelayMs: number;
  koSize: number;
  koHoldMs: number;
  /** Tier 4: how long after K.O. "PERFECT" pops. */
  perfectDelayMs: number;
  calloutSize: number;
  flashAlpha: number;
  squash: number;
  shakeMs: number;
  zoomOutMs: number;
  reducedFadeMs: number;
  colorT1: string;
  colorT2: string;
  colorT3: string;
  colorT4: string;
  colorFlash: string;
  colorDust: string;
  colorPlayer: string;
  colorFoe: string;
  sfxStepClip: string; sfxStepGain: number; sfxStepRate: number;
  sfxHitClip: string; sfxHitGain: number; sfxHitRate: number;
  sfxHeavyClip: string; sfxHeavyGain: number; sfxHeavyRate: number;
  sfxSuperClip: string; sfxSuperGain: number; sfxSuperRate: number;
  sfxKoClip: string; sfxKoGain: number; sfxKoRate: number;
  sfxPunchClip: string; sfxPunchGain: number; sfxPunchRate: number;
  sfxChargeClip: string; sfxChargeGain: number; sfxChargeRate: number;
  sfxBoomClip: string; sfxBoomGain: number; sfxBoomRate: number;
  sfxParryClip: string; sfxParryGain: number; sfxParryRate: number;
  sfxStruggleClip: string; sfxStruggleGain: number; sfxStruggleRate: number;
  sfxDizzyClip: string; sfxDizzyGain: number; sfxDizzyRate: number;
  sfxVoCounterClip: string; sfxVoCounterGain: number; sfxVoCounterRate: number;
  sfxVoKoClip: string; sfxVoKoGain: number; sfxVoKoRate: number;
  sfxVoPerfectClip: string; sfxVoPerfectGain: number; sfxVoPerfectRate: number;
  sfxDuck: number;
  previewDamage: number;
  previewParts: number;
}
export type HeroComboConfig = GlobalConfig & Record<TierKey, number>;

export const HERO_COMBO_COLOR_KEYS = ['colorT1', 'colorT2', 'colorT3', 'colorT4', 'colorFlash', 'colorDust', 'colorPlayer', 'colorFoe'] as const;
export const HERO_COMBO_CLIP_KEYS = [
  'sfxStepClip', 'sfxHitClip', 'sfxHeavyClip', 'sfxSuperClip', 'sfxKoClip', 'sfxPunchClip', 'sfxChargeClip', 'sfxBoomClip',
  'sfxParryClip', 'sfxStruggleClip', 'sfxDizzyClip', 'sfxVoCounterClip', 'sfxVoKoClip', 'sfxVoPerfectClip',
] as const;
export type HeroComboStrKey = (typeof HERO_COMBO_COLOR_KEYS)[number] | (typeof HERO_COMBO_CLIP_KEYS)[number];
export type HeroComboNumKey = Exclude<keyof HeroComboConfig, HeroComboStrKey>;

/** Per tier: [Tier 1, Tier 2, Tier 3, Tier 4]. A dial a tier's combo does not use is ignored there (the tuner says which). */
const TIER_DEFAULTS: Record<ComboTierSuffix, [number, number, number, number]> = {
  ReadyMs: [100, 100, 100, 100],
  StepMs: [200, 210, 200, 190],
  GapMs: [0, 150, 150, 130],
  HoldMs: [620, 1050, 1250, 1900],
  ReturnMs: [260, 280, 340, 460],
  Knock: [1, 0.9, 1, 1.4],
  Zoom: [0.03, 0.035, 0.04, 0.05],
  Punch: [0.035, 0.02, 0.045, 0.085],
  Shake: [9, 8, 18, 30],
  Burst: [1, 1.1, 1.45, 2],
  Rings: [2, 2, 3, 5],
  Dim: [0.12, 0.16, 0.24, 0.4],
};

export const COMBO_TIER_RANGES: Record<ComboTierSuffix, [number, number, number]> = {
  ReadyMs: [0, 1000, 10],
  StepMs: [60, 1000, 10],
  GapMs: [0, 600, 5],
  HoldMs: [0, 3000, 10],
  ReturnMs: [0, 1500, 10],
  Knock: [0, 4, 0.05],
  Zoom: [0, 0.2, 0.005],
  Punch: [0, 0.1, 0.001],
  Shake: [0, 40, 0.5],
  Burst: [0, 3, 0.05],
  Rings: [0, 8, 1],
  Dim: [0, 0.6, 0.01],
};

const tierDefaults = Object.fromEntries(TIERS.flatMap((t) => COMBO_TIER_SUFFIXES.map((s) => [`t${t}${s}`, TIER_DEFAULTS[s][t - 1]]))) as Record<TierKey, number>;

export const HERO_COMBO_DEFAULTS: HeroComboConfig = {
  ...HERO_ATTACK_TIER_THRESHOLDS,
  absorbMs: 180,
  stance: 1.1,
  windMs: 90,
  hitFreezeMs: 45,
  lunge: 0.42,
  flinch: 0.24,
  flinchRot: 9,
  skew: 14,
  sparkSize: 1,
  counterSize: 1,
  feintMs: 130,
  parryMs: 260,
  launchMs: 210,
  launchHeight: 1.7,
  jumpDelayMs: 90,
  jumpMs: 190,
  airHits: 4,
  airGapMs: 175,
  airBob: 1,
  breakMs: 460,
  spikeMs: 120,
  slamMs: 95,
  dizzyMs: 1000,
  openHits: 3,
  freezeDelayMs: 180,
  cutinMs: 980,
  cutinSlideMs: 130,
  cutinDim: 0.62,
  cutinTilt: -8,
  cutinHeight: 0.27,
  barsH: 0.055,
  flurryHits: 14,
  flurryGapMs: 56,
  heavyWindMs: 600,
  koLaunch: 1.5,
  koSpin: 1.25,
  koDelayMs: 150,
  koSize: 1,
  koHoldMs: 1750,
  perfectDelayMs: 560,
  calloutSize: 1,
  flashAlpha: 0.4,
  squash: 0.1,
  shakeMs: 560,
  zoomOutMs: 700,
  reducedFadeMs: 260,
  colorT1: '#5fe3ff',
  colorT2: '#ff4fd2',
  colorT3: '#ffb01f',
  colorT4: '#ff3b30',
  colorFlash: '#fff4dc',
  colorDust: '#e9dfc8',
  colorPlayer: '#ffcf5a',
  colorFoe: '#ff6a5a',
  sfxStepClip: 'fx/stereogenicstudio-swish-swoosh-woosh-sfx-27-357164-3', sfxStepGain: 0.5, sfxStepRate: 1.25,
  sfxHitClip: 'fx/combo-hit', sfxHitGain: 0.9, sfxHitRate: 1,
  sfxHeavyClip: 'fx/combo-heavy', sfxHeavyGain: 1.1, sfxHeavyRate: 1,
  sfxSuperClip: 'fx/combo-super', sfxSuperGain: 0.8, sfxSuperRate: 1,
  sfxKoClip: 'fx/combo-ko', sfxKoGain: 1, sfxKoRate: 1,
  sfxPunchClip: 'fx/combo-punch', sfxPunchGain: 1, sfxPunchRate: 1,
  sfxChargeClip: 'fx/combo-charge', sfxChargeGain: 0.7, sfxChargeRate: 1,
  sfxBoomClip: 'fx/combo-boom', sfxBoomGain: 0.95, sfxBoomRate: 1,
  sfxParryClip: 'fx/combo-parry', sfxParryGain: 0.85, sfxParryRate: 1,
  sfxStruggleClip: 'fx/combo-struggle', sfxStruggleGain: 0.9, sfxStruggleRate: 1,
  sfxDizzyClip: 'fx/combo-dizzy', sfxDizzyGain: 0.75, sfxDizzyRate: 1,
  sfxVoCounterClip: 'fx/combo-vo-counter', sfxVoCounterGain: 0.8, sfxVoCounterRate: 1,
  sfxVoKoClip: 'fx/combo-vo-ko', sfxVoKoGain: 0.85, sfxVoKoRate: 1,
  sfxVoPerfectClip: 'fx/combo-vo-perfect', sfxVoPerfectGain: 0.75, sfxVoPerfectRate: 1,
  sfxDuck: 0.6,
  previewDamage: 12,
  previewParts: 4,
  ...tierDefaults,
};

const sfx = { gain: [0, 2, 0.05] as [number, number, number], rate: [0.5, 2.5, 0.01] as [number, number, number] };

const GLOBAL_RANGES: Record<Exclude<keyof GlobalConfig, HeroComboStrKey>, [number, number, number]> = {
  tier2At: [2, 40, 1], tier3At: [2, 60, 1], tier4At: [2, 80, 1],
  absorbMs: [60, 600, 10],
  stance: [0.5, 1.6, 0.01],
  windMs: [20, 400, 5],
  hitFreezeMs: [0, 120, 1],
  lunge: [0, 1.2, 0.01],
  flinch: [0, 1, 0.01],
  flinchRot: [0, 30, 0.5],
  skew: [0, 30, 0.5],
  sparkSize: [0.3, 2.5, 0.05],
  counterSize: [0.4, 2, 0.05],
  feintMs: [60, 400, 5],
  parryMs: [100, 800, 10],
  launchMs: [80, 800, 5],
  launchHeight: [0.5, 4, 0.05],
  jumpDelayMs: [0, 400, 5],
  jumpMs: [60, 600, 5],
  airHits: [2, 6, 1],
  airGapMs: [80, 500, 5],
  airBob: [0, 2, 0.05],
  breakMs: [0, 1200, 10],
  spikeMs: [40, 800, 5],
  slamMs: [40, 400, 5],
  dizzyMs: [0, 2500, 10],
  openHits: [1, 5, 1],
  freezeDelayMs: [60, 800, 10],
  cutinMs: [400, 2000, 10],
  cutinSlideMs: [40, 400, 5],
  cutinDim: [0, 0.9, 0.01],
  cutinTilt: [-25, 25, 0.5],
  cutinHeight: [0.1, 0.6, 0.01],
  barsH: [0, 0.2, 0.005],
  flurryHits: [4, 24, 1],
  flurryGapMs: [30, 200, 1],
  heavyWindMs: [100, 1000, 10],
  koLaunch: [0, 4, 0.05],
  koSpin: [0, 4, 0.25],
  koDelayMs: [0, 600, 10],
  koSize: [0, 2.5, 0.05],
  koHoldMs: [400, 4000, 10],
  perfectDelayMs: [0, 2000, 10],
  calloutSize: [0, 2.5, 0.05],
  flashAlpha: [0, 1, 0.01],
  squash: [0, 0.4, 0.01],
  shakeMs: [0, 1200, 10],
  zoomOutMs: [60, 1500, 10],
  reducedFadeMs: [60, 1000, 10],
  sfxStepGain: sfx.gain, sfxStepRate: sfx.rate,
  sfxHitGain: sfx.gain, sfxHitRate: sfx.rate,
  sfxHeavyGain: sfx.gain, sfxHeavyRate: sfx.rate,
  sfxSuperGain: sfx.gain, sfxSuperRate: sfx.rate,
  sfxKoGain: sfx.gain, sfxKoRate: sfx.rate,
  sfxPunchGain: sfx.gain, sfxPunchRate: sfx.rate,
  sfxChargeGain: sfx.gain, sfxChargeRate: sfx.rate,
  sfxBoomGain: sfx.gain, sfxBoomRate: sfx.rate,
  sfxParryGain: sfx.gain, sfxParryRate: sfx.rate,
  sfxStruggleGain: sfx.gain, sfxStruggleRate: sfx.rate,
  sfxDizzyGain: sfx.gain, sfxDizzyRate: sfx.rate,
  sfxVoCounterGain: sfx.gain, sfxVoCounterRate: sfx.rate,
  sfxVoKoGain: sfx.gain, sfxVoKoRate: sfx.rate,
  sfxVoPerfectGain: sfx.gain, sfxVoPerfectRate: sfx.rate,
  sfxDuck: [0, 1, 0.05],
  previewDamage: [1, 60, 1],
  previewParts: [1, 8, 1],
};

export const HERO_COMBO_RANGES: Record<HeroComboNumKey, [number, number, number]> = {
  ...GLOBAL_RANGES,
  ...(Object.fromEntries(TIERS.flatMap((t) => COMBO_TIER_SUFFIXES.map((s) => [`t${t}${s}`, COMBO_TIER_RANGES[s]]))) as Record<TierKey, [number, number, number]>),
};

/** Hard caps (whatever the tuner says). */
export const COMBO_CAPS = { shakePx: 40, flurry: 24, air: 6, open: 5 } as const;
/** The super's input glyphs: how many, the gap between each lighting, and the wait after the band has slid in. */
export const GLYPHS = 4;
export const GLYPH_GAP_MS = 75;
export const GLYPH_LEAD_MS = 70;
/** Tier 4: when the blasted target touches down (ms after the impact): the landing, then one bounce. */
export const KO_LANDINGS = [150, 410] as const;
/** Tier 2: the string's beat, as multiples of the hit gap (jab, jab, cross, then the held-back roundhouse). */
export const STRING_BEATS = [0, 1, 2, 3.6] as const;

const store = configStore<HeroComboConfig>({
  key: 'ascent.herocombo.v4', defaults: HERO_COMBO_DEFAULTS, ranges: HERO_COMBO_RANGES,
  colorKeys: HERO_COMBO_COLOR_KEYS, clipKeys: HERO_COMBO_CLIP_KEYS, previewKeys: ['previewDamage', 'previewParts'],
});
export const heroComboStore = store;
export const getHeroComboConfig = store.get;
export const clampHeroComboValue = store.clamp;
export const sanitizeHeroComboConfig = store.sanitize;
export const heroComboConfigJson = store.json;
/** The preview speed hook (Recruit + the Collection read one per style). Always 1: the tuner has no speed buttons. */
export function heroComboPreviewSpeed(): number { return 1; }

export function comboTierDials(tier: TierNum, c: HeroComboConfig = store.get()): Record<ComboTierSuffix, number> {
  return Object.fromEntries(COMBO_TIER_SUFFIXES.map((s) => [s, c[`t${tier}${s}`]])) as Record<ComboTierSuffix, number>;
}

/** The tier's own colour (its hit effects, trails and call-outs). */
export function tierColor(tier: TierNum, c: HeroComboConfig = store.get()): string {
  return [c.colorT1, c.colorT2, c.colorT3, c.colorT4][tier - 1]!;
}

/** Tier 3's air hits for a blow: the dial, or one fewer, rolled from the stable per-blow seed. Pure. */
export function airHitsOf(rollSeed: number, c: HeroComboConfig = store.get()): number {
  let h = (Math.round(rollSeed) | 0) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return clamp(Math.round(c.airHits) - (h % 2), 2, COMBO_CAPS.air);
}

// ─── the pure plan ─────────────────────────────────────────────────────────────────────────────────────────────

export type HitKind = 'jab' | 'cross' | 'kick' | 'counter' | 'upper' | 'air' | 'spike' | 'flurry' | 'heavy';

/** One hit of the combo. `count` is what the counter reads once it has landed (hit n reads n). */
export interface ComboHit { at: number; kind: HitKind; i: number; power: number; count: number }

export interface ComboPlanInput extends AttackTierContext {
  leadIn?: number;
  total: number;
  reduced?: boolean;
  /** Tier 3's air hits (from `airHitsOf`). Default: the dial. */
  airHits?: number;
}

export interface ComboPlan {
  reduced: boolean;
  tier: TierNum;
  kind: ComboKind;
  k: number;
  total: number;
  chargeAt: number;
  absorbEnd: number;
  /** The striker steps in beside the target, and has arrived. */
  stepAt: number;
  stepEnd: number;
  /** Every hit, in time order. All but the impact are ticks. */
  hits: ComboHit[];
  /** Tier 1: the struck portrait's own lunge starts, and is parried. */
  feintAt: number | null;
  parryAt: number | null;
  /** Tier 3: the uppercut (the launch), the striker's jump, the struggle ("BREAKER?"), the spike and the slam (= the impact). */
  launchAt: number | null;
  jumpAt: number | null;
  breakAt: number | null;
  spikeAt: number | null;
  slamAt: number | null;
  /** Tier 4: the super freeze starts, the cut-in is gone (the flurry starts), the flurry's last hit, and K.O. slams in. */
  freezeAt: number | null;
  cutinEnd: number | null;
  flurryEnd: number | null;
  /** Tier 4: the heavy blow's wind-up starts (the gather: the anticipation before THE impact). */
  windAt: number | null;
  koAt: number | null;
  perfectAt: number | null;
  /** Tier 2 and Tier 3: the struck portrait reels, dizzy, from `dizzyAt` to `dizzyEnd`. */
  dizzyAt: number | null;
  dizzyEnd: number | null;
  /** THE impact. The blow lands here, once. */
  impactAt: number;
  /** The striker heads home, and is home. */
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
export function comboPlan(input: ComboPlanInput, c: HeroComboConfig = store.get()): ComboPlan {
  const total = Math.max(0, Math.round(input.total));
  const tier = attackTier(total, input, c); // a knockout always plays the shared Tier 4
  const kind = comboKind(tier);
  const L = comboTierDials(tier, c);
  const looks = {
    tier, kind, k: (tier - 1) / 3, total, knock: L.Knock, zoom: L.Zoom, punch: L.Punch, shakePx: clamp(L.Shake, 0, COMBO_CAPS.shakePx),
    burst: L.Burst, rings: Math.round(L.Rings), dim: L.Dim,
  };
  const none = {
    feintAt: null, parryAt: null, launchAt: null, jumpAt: null, breakAt: null, spikeAt: null, slamAt: null, freezeAt: null, cutinEnd: null,
    flurryEnd: null, windAt: null, koAt: null, perfectAt: null, dizzyAt: null, dizzyEnd: null,
  };
  if (input.reduced) {
    const r = reducedAttackTimeline(input.leadIn ?? 0, c.reducedFadeMs);
    const at = r.impactAt;
    return {
      ...looks, ...none, reduced: true, chargeAt: at, absorbEnd: at, stepAt: at, stepEnd: at, hits: [], impactAt: at, homeAt: at, homeEnd: at, endAt: r.endAt,
      zoom: 0, punch: 0, shakePx: 0, burst: 0, rings: 0, dim: 0, knock: 0,
    };
  }
  const chargeAt = Math.max(0, input.leadIn ?? 0);
  const absorbEnd = chargeAt + c.absorbMs;
  const stepAt = chargeAt + Math.max(L.ReadyMs, c.absorbMs * 0.6);
  const stepEnd = stepAt + Math.max(60, L.StepMs);
  const first = stepEnd + Math.max(20, c.windMs);
  const gap = Math.max(60, L.GapMs);
  const raw: { at: number; kind: HitKind; power: number }[] = [];
  const times = { ...none } as { [K in keyof typeof none]: number | null };
  let impactAt: number;
  if (kind === 'counter') {
    // The struck portrait lunges first, is PARRIED, and eats one crisp counter-hit (THE impact).
    times.feintAt = first;
    times.parryAt = first + Math.max(40, c.feintMs);
    impactAt = times.parryAt + Math.max(80, c.parryMs);
    raw.push({ at: impactAt, kind: 'counter', power: 1 });
  } else if (kind === 'string') {
    // Jab, jab, cross, then the held-back roundhouse on the beat (THE impact); it reels, dizzy.
    const kinds: HitKind[] = ['jab', 'jab', 'cross', 'kick'];
    const pw = [0.4, 0.45, 0.65, 1];
    for (let i = 0; i < 4; i++) raw.push({ at: first + gap * STRING_BEATS[i]!, kind: kinds[i]!, power: pw[i]! });
    impactAt = first + gap * STRING_BEATS[3];
    times.dizzyAt = impactAt + 160;
    times.dizzyEnd = times.dizzyAt + c.dizzyMs;
  } else if (kind === 'launcher') {
    const upAt = first + gap + Math.max(80, c.launchMs);
    raw.push({ at: first, kind: 'jab', power: 0.35 }, { at: first + gap, kind: 'cross', power: 0.5 }, { at: upAt, kind: 'upper', power: 0.85 });
    times.launchAt = upAt;
    times.jumpAt = upAt + c.jumpDelayMs;
    const n = clamp(Math.round(input.airHits ?? c.airHits), 2, COMBO_CAPS.air);
    const air0 = upAt + c.jumpDelayMs + c.jumpMs + 50;
    for (let i = 0; i < n; i++) raw.push({ at: air0 + i * c.airGapMs, kind: 'air', power: 0.4 + 0.06 * i });
    const lastAir = air0 + (n - 1) * c.airGapMs;
    // The struggle: it tries to break out ("BREAKER?"), the next blow is the spike.
    times.breakAt = lastAir + 110;
    times.spikeAt = times.breakAt + Math.max(0, c.breakMs) + Math.max(40, c.spikeMs);
    raw.push({ at: times.spikeAt, kind: 'spike', power: 1 });
    times.slamAt = times.spikeAt + Math.max(40, c.slamMs);
    impactAt = times.slamAt;
    times.dizzyAt = impactAt + 260;
    times.dizzyEnd = times.dizzyAt + c.dizzyMs;
  } else {
    const open = clamp(Math.round(c.openHits), 1, COMBO_CAPS.open);
    const kinds: HitKind[] = ['jab', 'cross', 'kick'];
    for (let i = 0; i < open; i++) raw.push({ at: first + i * gap, kind: kinds[i % 3]!, power: 0.35 + 0.1 * i });
    times.freezeAt = first + (open - 1) * gap + c.freezeDelayMs;
    times.cutinEnd = times.freezeAt + c.cutinMs;
    const n = clamp(Math.round(c.flurryHits), 4, COMBO_CAPS.flurry);
    for (let i = 0; i < n; i++) raw.push({ at: times.cutinEnd + 60 + i * c.flurryGapMs, kind: 'flurry', power: 0.3 + (0.3 * i) / n });
    times.flurryEnd = times.cutinEnd + 60 + (n - 1) * c.flurryGapMs;
    times.windAt = times.flurryEnd + 40;
    impactAt = times.flurryEnd + c.heavyWindMs;
    raw.push({ at: impactAt, kind: 'heavy', power: 1.25 });
    times.koAt = impactAt + c.koDelayMs;
    times.perfectAt = times.koAt + c.perfectDelayMs;
  }
  // THE COUNTER COUNTS REAL HITS: hit n reads n. (The damage is the game's own number, not the counter's.)
  const hits: ComboHit[] = raw.map((h, i) => ({ ...h, i, count: i + 1 }));
  const homeAt = impactAt + L.HoldMs;
  const homeEnd = homeAt + L.ReturnMs;
  return { ...looks, ...times, reduced: false, chargeAt, absorbEnd, stepAt, stepEnd, hits, impactAt, homeAt, homeEnd, endAt: homeEnd + 80 };
}

export type ComboCueKind =
  | 'charge' | 'step' | 'feint' | 'parry' | 'hit' | 'jump' | 'struggle' | 'super' | 'glyph' | 'flurry' | 'wind' | 'impact' | 'land' | 'ko'
  | 'perfect' | 'dizzy' | 'home' | 'end';
export interface ComboCue { at: number; kind: ComboCueKind; i: number }

/** Every beat the runner fires, in time order. The blow lands on `impact`, once. */
export function comboCues(p: ComboPlan, c: HeroComboConfig = store.get()): ComboCue[] {
  const out: ComboCue[] = [];
  if (!p.reduced) {
    out.push({ at: p.chargeAt, kind: 'charge', i: 0 });
    out.push({ at: p.stepAt, kind: 'step', i: 0 });
    if (p.feintAt !== null) out.push({ at: p.feintAt, kind: 'feint', i: 0 });
    if (p.parryAt !== null) out.push({ at: p.parryAt, kind: 'parry', i: 0 });
    for (const h of p.hits) out.push({ at: h.at, kind: 'hit', i: h.i });
    if (p.jumpAt !== null) out.push({ at: p.jumpAt, kind: 'jump', i: 0 });
    if (p.breakAt !== null) out.push({ at: p.breakAt, kind: 'struggle', i: 0 });
    if (p.freezeAt !== null && p.cutinEnd !== null) {
      out.push({ at: p.freezeAt, kind: 'super', i: 0 });
      for (let i = 0; i < GLYPHS; i++) out.push({ at: glyphAt(p, c, i), kind: 'glyph', i });
      out.push({ at: p.cutinEnd, kind: 'flurry', i: 0 });
    }
    if (p.windAt !== null) out.push({ at: p.windAt, kind: 'wind', i: 0 });
    if (p.koAt !== null) out.push({ at: p.koAt, kind: 'ko', i: 0 });
    if (p.perfectAt !== null) out.push({ at: p.perfectAt, kind: 'perfect', i: 0 });
    if (p.dizzyAt !== null) out.push({ at: p.dizzyAt, kind: 'dizzy', i: 0 });
    // Tier 4: the blasted target comes down and bounces (the aftermath's two landings).
    if (p.kind === 'super') for (let i = 0; i < KO_LANDINGS.length; i++) out.push({ at: p.impactAt + KO_LANDINGS[i]!, kind: 'land', i });
    out.push({ at: p.homeAt, kind: 'home', i: 0 });
  }
  out.push({ at: p.impactAt, kind: 'impact', i: 0 });
  out.push({ at: p.endAt, kind: 'end', i: 0 });
  const order: Record<ComboCueKind, number> = {
    charge: 0, step: 1, feint: 2, parry: 2, super: 2, glyph: 3, flurry: 4, jump: 5, struggle: 5, wind: 5, hit: 6, impact: 7, land: 8, ko: 9,
    perfect: 9, dizzy: 9, home: 10, end: 11,
  };
  return out.sort((a, b) => a.at - b.at || order[a.kind] - order[b.kind] || a.i - b.i);
}

/** Tier 4: when the super's input glyph `i` lights (after the band has slid in). Pure. */
export function glyphAt(p: ComboPlan, c: HeroComboConfig, i: number): number {
  return (p.freezeAt ?? 0) + c.cutinSlideMs + GLYPH_LEAD_MS + i * GLYPH_GAP_MS;
}

// ─── the geometry (pure) ───────────────────────────────────────────────────────────────────────────────────────

export interface Frame { x0: number; y0: number; x1: number; y1: number }

export interface ComboGeo {
  frame: Frame | null;
  /** The way the striker faces while fighting: +1 = toward +x (it stands to the LEFT of the target). */
  face: 1 | -1;
  /**
   * Every point below is SCREEN px. THE RING: where the target stands to fight. Its own slot when there is room round it;
   * a slot tucked in a corner of the screen is no place for a fight, so the target hops out to meet the striker (`pull`
   * is that hop, an OFFSET from its slot) and is knocked, spiked or sent flying back home at the end.
   */
  ring: Pt;
  pull: Pt;
  /** Where the striker stands to fight (beside the ring, level with it). */
  stance: Pt;
  /** Tier 3: how high the launch goes (px), and how far the juggle drifts along `face` (px, signed). */
  lift: number;
  drift: number;
  /** Tier 4: the heavy blow's knockback, an OFFSET from the target's slot (kept on screen). */
  launch: Pt;
  /** The combo counter's centre and its size (behind the striker, clear of the target). */
  counter: Pt;
  counterW: number;
  counterH: number;
  /** K.O.: its centre and its width. */
  ko: Pt;
  koW: number;
  /** Tier 4: the cut-in band's centre, its length, its height and its tilt (radians). */
  band: { x: number; y: number; w: number; h: number; rot: number };
}

const inFrame = (p: Pt, f: Frame | null, m: number): boolean => !f || (p.x >= f.x0 + m && p.x <= f.x1 - m && p.y >= f.y0 + m && p.y <= f.y1 - m);

/** A point clamped inside the frame with `mx` / `my` px to spare (a tiny frame: its middle). Pure. */
export function clampToFrame(p: Pt, f: Frame | null, mx: number, my = mx): Pt {
  if (!f) return p;
  const cx = (f.x0 + f.x1) / 2, cy = (f.y0 + f.y1) / 2;
  const x = f.x1 - f.x0 > 2 * mx ? clamp(p.x, f.x0 + mx, f.x1 - mx) : cx;
  const y = f.y1 - f.y0 > 2 * my ? clamp(p.y, f.y0 + my, f.y1 - my) : cy;
  return { x, y };
}

/** Whether a point is inside the frame (tests). */
export const onScreen = inFrame;

/** The counter's size for a combo of `total` hits beside a target of radius `dR`: [width, height, digit height]. Pure. */
export function counterSize(total: number, dR: number, c: HeroComboConfig): { w: number; h: number; digit: number; digits: number } {
  const digits = String(Math.max(0, Math.round(total))).length;
  const digit = dR * 0.95 * c.counterSize;
  return { w: digit * (0.56 * digits + 1.4), h: digit * 1.1, digit, digits };
}

/**
 * Where the fight happens, from the two heroes and the frame (screen px). The striker stands BESIDE the target, on the
 * side it comes from (straight above or below: your hero on the left, the foe on the right, as in a 2D fighter). The
 * RING is the target's slot pulled in off the screen's edges just far enough for this tier's combo: room for the striker
 * and the counter behind it, room to be knocked back, and (Tier 3) headroom for the launch. Pure.
 */
export function comboGeo(a: Pt, d: Pt, aR: number, dR: number, frame: Frame | null, c: HeroComboConfig = store.get(), o: { side?: 'player' | 'opp'; hits?: number; kind?: ComboKind } = {}): ComboGeo {
  const kind = o.kind ?? 'counter';
  const gap = (aR + dR) * c.stance;
  const cs = counterSize(o.hits ?? 0, dR, c);
  // `s` = which side of the target the striker stands on (-1 = its left).
  const s: 1 | -1 = Math.abs(a.x - d.x) > (aR + dR) * 0.6 ? (a.x < d.x ? -1 : 1) : (o.side === 'opp' ? 1 : -1);
  const face = (-s) as 1 | -1;
  const fw = frame ? frame.x1 - frame.x0 : 1920, fh = frame ? frame.y1 - frame.y0 : 1080;
  // The room the combo needs round the ring: behind (the striker and its counter), ahead (the knockback), above (the launch).
  const behind = gap + aR * 1.3 + cs.w + 12;
  const ahead = dR * (kind === 'super' ? c.koLaunch + 0.8 : kind === 'launcher' ? 1.65 : 1.3);
  const lift = kind === 'launcher' ? clamp(dR * c.launchHeight, 0, Math.max(0, fh - dR * 2.6)) : 0;
  // Head room: the dizzy birds circle over the struck head (Tier 2 and Tier 3).
  const top = Math.max(aR, dR) * (kind === 'string' || kind === 'launcher' ? 1.6 : 1.15) + lift, bottom = Math.max(aR, dR) * 1.15;
  let ring = { x: d.x, y: d.y };
  if (frame) {
    const lo = frame.x0 + (s < 0 ? behind : ahead), hi = frame.x1 - (s < 0 ? ahead : behind);
    ring = {
      x: lo <= hi ? clamp(d.x, lo, hi) : (frame.x0 + frame.x1) / 2,
      y: frame.y0 + top <= frame.y1 - bottom ? clamp(d.y, frame.y0 + top, frame.y1 - bottom) : (frame.y0 + frame.y1) / 2,
    };
  }
  const pull = { x: ring.x - d.x, y: ring.y - d.y };
  const stance = clampToFrame({ x: ring.x + s * gap, y: ring.y }, frame, aR * 1.05);
  // The counter: behind the striker (the target is never knocked that way).
  const counter = clampToFrame({ x: stance.x + s * (aR * 1.3 + cs.w / 2), y: stance.y - aR * 0.45 }, frame, cs.w / 2 + 6, cs.h / 2 + 6);
  const drift = face * dR * 0.45;
  // Tier 4: the heavy blow sends the target flying away from the striker (kept on screen), an offset from its SLOT.
  const to = clampToFrame({ x: ring.x + face * dR * c.koLaunch, y: ring.y - dR * 0.35 }, frame, dR * 0.75);
  const launch = { x: to.x - d.x, y: to.y - d.y };
  const mid = frame ? { x: (frame.x0 + frame.x1) / 2, y: (frame.y0 + frame.y1) / 2 } : ring;
  const koW = Math.min(fw * 0.4, dR * 5.2) * c.koSize;
  let ko = clampToFrame({ x: ring.x + (mid.x - ring.x) * 0.5, y: ring.y + (mid.y - ring.y) * 0.55 }, frame, koW / 2 + 8, koW * 0.22 + 8);
  // Never over the counter (it reads the hits as K.O. lands): step clear of it, toward the middle of the screen.
  const clear = koW * 0.22 + cs.h / 2 + 10;
  if (Math.abs(ko.x - counter.x) < (koW + cs.w) / 2 && Math.abs(ko.y - counter.y) < clear) {
    ko = clampToFrame({ x: ko.x, y: counter.y + (mid.y >= counter.y ? clear : -clear) }, frame, koW / 2 + 8, koW * 0.22 + 8);
  }
  const band = { x: mid.x, y: mid.y, w: Math.hypot(fw, fh) * 1.12, h: fh * c.cutinHeight, rot: (c.cutinTilt * Math.PI) / 180 };
  return { frame, face, ring, pull, stance, lift, drift, launch, counter, counterW: cs.w, counterH: cs.h, ko, koW, band };
}

/**
 * Where a call-out ("COUNTER", "BREAKER?") sits: above the fight between the two fighters, or below it when the fight
 * is up against the top of the screen; kept on screen. `w` is its width. Pure.
 */
export function calloutAt(g: ComboGeo, dR: number, w: number, lifted = 0): Pt {
  const x = (g.ring.x + g.stance.x) / 2;
  const h = w * 0.2 + 8;
  // Above the fight when there is room for it; else below it (never over the hit, never off the top).
  let y = g.ring.y - dR * 1.55 - lifted;
  if (g.frame && y - h < g.frame.y0) y = g.ring.y + dR * 1.5;
  return clampToFrame({ x, y }, g.frame, w / 2 + 8, h);
}

// ─── the poses (pure) ──────────────────────────────────────────────────────────────────────────────────────────

/**
 * A portrait's offset from its slot (screen px), its rotation (degrees), its scale, a squash (+ = flattened) and a skew
 * (degrees, the impact frame's smear along the hit).
 */
export interface ComboPose { x: number; y: number; rot: number; scale: number; squash: number; skew: number }
const REST: ComboPose = { x: 0, y: 0, rot: 0, scale: 1, squash: 0, skew: 0 };

const easeIn = (u: number): number => { const x = clamp01(u); return x * x; };
const win = (t: number, a: number, b: number): number => clamp01((t - a) / Math.max(1, b - a));

/** How a hit is thrown: [wind-up ms, recover ms, pull-back, reach, dir x (along the facing), dir y, lean degrees]. */
const STRIKES: Record<HitKind, readonly [number, number, number, number, number, number, number]> = {
  jab: [70, 110, 0.2, 0.8, 1, 0, 6],
  cross: [95, 140, 0.3, 1, 1, -0.08, 12],
  kick: [150, 190, 0.45, 1.15, 0.85, 0.35, -16],
  counter: [90, 220, 0.25, 1.35, 1, -0.05, 15],
  upper: [120, 180, 0.45, 1.1, 0.55, -0.85, -8],
  air: [60, 95, 0.2, 0.75, 0.8, 0, 8],
  spike: [110, 170, 0.5, 1.1, 0.45, 0.9, 18],
  flurry: [36, 42, 0.15, 0.6, 1, 0, 4],
  heavy: [460, 320, 0.95, 1.6, 1.2, 0, 26],
};

/** How the target takes a hit: [knock, dir x (along the facing), dir y, rock degrees, decay ms]. */
const FLINCHES: Record<HitKind, readonly [number, number, number, number, number]> = {
  jab: [0.8, 1, -0.05, 1, 110],
  cross: [1.1, 1, -0.12, 1.3, 120],
  kick: [1.3, 0.8, -0.2, -1.6, 140],
  counter: [0, 0, 0, 0, 80],
  upper: [0.3, 0.3, -0.4, 1, 100],
  air: [0.45, 0.6, 0, 1, 80],
  spike: [0, 0, 0, 1.5, 80],
  flurry: [0.42, 1, 0, 0.7, 55],
  heavy: [0, 0, 0, 0, 80],
};

/** A flurry or air hit's own height on the target (-1 top .. 1 bottom): scattered, never the same twice in a row. */
export function hitHeight(h: ComboHit): number {
  switch (h.kind) {
    case 'jab': return h.i % 2 ? -0.25 : -0.45;
    case 'cross': return -0.05;
    case 'kick': return -0.35;
    case 'counter': return -0.2;
    case 'upper': return 0.35;
    case 'spike': return -0.7;
    case 'heavy': return 0;
    case 'air': return h.i % 2 ? -0.3 : 0.3;
    default: return (((h.i * 5) % 7) - 3) / 3 * 0.65;
  }
}

/** A thrown hit over time: 0 at rest, a pull back (negative), 1 at the contact, HELD for the hit-freeze, then recovered. */
function strike(dt: number, wind: number, freeze: number, out: number, back: number): number {
  if (dt <= -wind || dt >= freeze + out) return 0;
  if (dt < 0) {
    const w = 1 + dt / wind;
    return w < 0.55 ? -back * easeInOutSine(w / 0.55) : -back + (1 + back) * easeIn((w - 0.55) / 0.45);
  }
  if (dt <= freeze) return 1;
  return 1 - easeOutCubic((dt - freeze) / out);
}

/** A taken hit over time: snapped to 1 at the contact, HELD for the hit-freeze, then it rocks back to rest. */
function flinch(dt: number, freeze: number, tau: number): number {
  if (dt < 0) return 0;
  if (dt <= freeze) return 1;
  const e = dt - freeze;
  return e > tau * 6 ? 0 : Math.exp(-e / tau) * Math.cos(2 * Math.PI * 2.4 * (e / 1000));
}

/** The impact frame's smear: full on contact, gone over 90 ms. */
function smear(dt: number, freeze: number): number { return dt < 0 || dt > freeze + 90 ? 0 : dt <= freeze ? 1 : 1 - (dt - freeze) / 90; }

/** Tier 3: the juggle. How high the target is (px), how far it has drifted (px) and how airborne it is (0..1). */
interface Air { h: number; x: number; w: number }
function airOf(p: ComboPlan, g: ComboGeo, c: HeroComboConfig, t: number, out: Air): Air {
  out.h = 0; out.x = 0; out.w = 0;
  if (p.launchAt === null || p.spikeAt === null || p.slamAt === null || t < p.launchAt || t >= p.slamAt) return out;
  const fz = c.hitFreezeMs;
  const bob = 0.22 * clamp(c.airBob, 0, 2) * 0.5;
  const base = g.lift * (1 - bob);
  const rise = easeOutCubic(win(t, p.launchAt + fz, p.launchAt + c.jumpDelayMs + c.jumpMs));
  let h = base * rise;
  let n = 0, passed = 0;
  for (let i = 0; i < p.hits.length; i++) {
    const hit = p.hits[i]!;
    if (hit.kind !== 'air') continue;
    n++;
    if (t < hit.at) continue;
    passed += easeOutCubic(win(t, hit.at, hit.at + 140));
    const next = p.hits[i + 1]!.kind === 'air' ? p.hits[i + 1]!.at : (p.breakAt ?? p.hits[i + 1]!.at);
    const x = win(t, hit.at + fz, next);
    if (x < 1) h += g.lift * bob * 4 * x * (1 - x);
  }
  let x = n ? g.drift * (passed / n) : 0;
  let w = rise;
  if (t >= p.spikeAt + fz) {
    const down = 1 - easeIn(win(t, p.spikeAt + fz, p.slamAt));
    h *= down; x *= down; w = down;
  }
  out.h = h; out.x = x; out.w = w;
  return out;
}

/** Tier 3: how high the target is in the air right now (screen px; the camera rises with it). Pure. */
export function airLift(p: ComboPlan, g: ComboGeo, c: HeroComboConfig, t: number): number {
  return airOf(p, g, c, t, { h: 0, x: 0, w: 0 }).h;
}

/** Keep a portrait's centre on screen (its slot `at` plus the pose), `m` px to spare. Mutates the pose. */
function keepIn(pose: ComboPose, at: Pt, f: Frame | null, m: number): ComboPose {
  if (!f || (!pose.x && !pose.y)) return pose;
  const q = clampToFrame({ x: at.x + pose.x, y: at.y + pose.y }, f, m);
  // A slot that already sits nearer the edge than `m` is left where it is (never pulled inward by its own attack).
  if (inFrame(at, f, m)) { pose.x = q.x - at.x; pose.y = q.y - at.y; }
  return pose;
}

const AIR: Air = { h: 0, x: 0, w: 0 };

/** The STRIKER (the striking portrait) at sequence time `t` (its slot is (0, 0)). Pure and deterministic. */
export function strikerPose(p: ComboPlan, g: ComboGeo, c: HeroComboConfig, aR: number, a: Pt, t: number): ComboPose {
  if (p.reduced || t < p.stepAt || t >= p.endAt) return { ...REST };
  const pose = { ...REST };
  const to = { x: g.stance.x - a.x, y: g.stance.y - a.y };
  if (t < p.stepEnd) {
    // THE STEP IN: a quick dash to the stance with a little hop, leaning into it.
    const w = win(t, p.stepAt, p.stepEnd);
    const e = easeOutCubic(w);
    pose.x = to.x * e; pose.y = to.y * e - Math.sin(Math.PI * w) * aR * 0.22;
    pose.rot = 8 * (to.x >= 0 ? 1 : -1) * Math.sin(Math.PI * w);
    pose.scale = 1 + 0.05 * Math.sin(Math.PI * w);
    return pose;
  }
  // AT THE STANCE: every hit is a lunge along its own line, held for the hit-freeze.
  let x = to.x, y = to.y, rot = 0;
  const reach = aR * c.lunge;
  for (const h of p.hits) {
    const k = STRIKES[h.kind];
    const wind = h.kind === 'heavy' ? Math.min(k[0], c.heavyWindMs * 0.85) : h.kind === 'counter' ? Math.min(k[0], c.parryMs * 0.6) : k[0];
    const dt = t - h.at;
    if (dt <= -wind || dt >= c.hitFreezeMs + k[1]) continue;
    const s = strike(dt, wind, c.hitFreezeMs, k[1], k[2]);
    const dy = h.kind === 'air' || h.kind === 'flurry' ? hitHeight(h) * 0.5 : k[5];
    x += g.face * k[4] * reach * k[3] * s; y += dy * reach * k[3] * s;
    rot += g.face * k[6] * s;
  }
  // Tier 1: THE PARRY. It turns the incoming lunge aside: a snap back onto the guard, held, then it surges into the counter.
  if (p.parryAt !== null && t >= p.parryAt - 60 && t < p.impactAt) {
    const g0 = easeOutCubic(win(t, p.parryAt - 60, p.parryAt)) * (1 - win(t, p.parryAt + 90, p.parryAt + 160));
    x -= g.face * aR * 0.12 * g0; rot -= g.face * 9 * g0;
    pose.scale = 1 + 0.06 * g0;
  }
  // Tier 3: it jumps after the launched target, rides the juggle's drift, and drops back after the spike.
  if (p.jumpAt !== null && p.spikeAt !== null && p.slamAt !== null && t >= p.jumpAt) {
    const air = airOf(p, g, c, t, AIR);
    const up = easeOutCubic(win(t, p.jumpAt, p.jumpAt + c.jumpMs)) * (1 - easeIn(win(t, p.spikeAt + c.hitFreezeMs + 30, p.slamAt + 170)));
    y -= g.lift * (1 - 0.11 * clamp(c.airBob, 0, 2)) * up;
    x += air.x * 0.9;
    // Through the struggle it hangs back, cocked, waiting for the opening.
    if (p.breakAt !== null && t >= p.breakAt && t < p.spikeAt) {
      const k = easeOutCubic(win(t, p.breakAt, p.breakAt + 160));
      y -= aR * 0.25 * k; rot -= g.face * 10 * k;
    }
  }
  // Tier 4: it swells a touch through the super freeze (held still: the cut-in is the show).
  if (p.freezeAt !== null && p.cutinEnd !== null && t >= p.freezeAt && t < p.impactAt) {
    pose.scale = 1 + 0.07 * easeOutCubic(win(t, p.freezeAt, p.freezeAt + 120));
    // THE WIND-UP: it rears back (the strike's own pull) and swells as the power gathers.
    if (p.windAt !== null && t >= p.windAt) pose.scale += 0.12 * easeInOutSine(win(t, p.windAt, p.impactAt - 40));
  }
  if (t >= p.impactAt && p.kind === 'super') pose.scale = 1 + 0.19 * (1 - easeOutCubic(win(t, p.impactAt + 60, p.impactAt + 420)));
  // HOME: a hop back to its slot, and a little settle.
  const home = easeInOutSine(win(t, p.homeAt, p.homeEnd));
  pose.x = x * (1 - home); pose.y = y * (1 - home) - Math.sin(Math.PI * home) * aR * 0.2;
  pose.rot = rot * (1 - home);
  if (t >= p.homeEnd) pose.squash = c.squash * 0.4 * Math.max(0, spring(t - p.homeEnd, 4, 60));
  return keepIn(pose, a, g.frame, aR * 0.55);
}

/** The TARGET (the struck portrait) at sequence time `t` (its slot is (0, 0)). Pure and deterministic. */
export function targetPose(p: ComboPlan, g: ComboGeo, c: HeroComboConfig, dR: number, d: Pt, t: number): ComboPose {
  if (p.reduced || t < p.stepAt || t >= p.endAt) return { ...REST };
  const pose = { ...REST };
  // OUT TO THE RING as the striker steps in (a small hop), and it stays there for the fight.
  const sw = win(t, p.stepAt, p.stepEnd);
  const out = easeOutCubic(sw);
  pose.x = g.pull.x * out; pose.y = g.pull.y * out - Math.sin(Math.PI * sw) * Math.min(dR * 0.18, Math.hypot(g.pull.x, g.pull.y) * 0.3);
  const amp = dR * c.flinch;
  // Tier 1: IT ATTACKS FIRST: a lunge at the striker, PARRIED (thrown back off balance, a smear), and it is still
  // staggering when the counter lands.
  if (p.feintAt !== null && p.parryAt !== null && t >= p.feintAt) {
    const go = t < p.parryAt ? easeIn(win(t, p.feintAt, p.parryAt)) : 0;
    pose.x -= g.face * dR * 0.42 * go; pose.rot -= g.face * 10 * go;
    if (t >= p.parryAt) {
      const dt = t - p.parryAt;
      const st = dt <= c.hitFreezeMs ? -0.42 : -0.42 + 0.95 * easeOutCubic(win(dt, c.hitFreezeMs, c.hitFreezeMs + 140));
      pose.x += g.face * dR * st * (t < p.impactAt ? 1 : Math.max(0, 1 - (t - p.impactAt) / 200));
      pose.rot += g.face * 16 * clamp01(st + 0.42) * (t < p.impactAt ? 1 : 0);
      pose.skew -= g.face * c.skew * 0.8 * smear(dt, c.hitFreezeMs);
    }
  }
  // Every hit it takes: snapped back along the hit, held for the hit-freeze, rocking back; smeared on contact.
  for (const h of p.hits) {
    const dt = t - h.at;
    if (dt < 0) break;
    const k = FLINCHES[h.kind];
    pose.skew += g.face * c.skew * Math.min(1.3, h.power) * smear(dt, c.hitFreezeMs) * (h.kind === 'spike' ? 0 : 1);
    const f = flinch(dt, c.hitFreezeMs, k[4]);
    if (!f) continue;
    const dy = h.kind === 'flurry' ? -hitHeight(h) * 0.25 : k[2];
    const a = amp * k[0] * (0.6 + 0.5 * h.power);
    pose.x += g.face * k[1] * a * f; pose.y += dy * a * f;
    pose.rot += g.face * c.flinchRot * k[3] * (0.6 + 0.5 * h.power) * f * (h.kind === 'flurry' || h.kind === 'air' ? (h.i % 2 ? 1 : -0.6) : 1);
    if (dt <= c.hitFreezeMs + 90) pose.squash += c.squash * 0.35 * h.power * (1 - win(dt, c.hitFreezeMs, c.hitFreezeMs + 90));
  }
  // Tier 3: launched, juggled (it bobs up with each air hit), STRUGGLES, spiked back down into its socket.
  if (p.launchAt !== null && p.slamAt !== null && t >= p.launchAt) {
    const air = airOf(p, g, c, t, AIR);
    pose.y -= air.h; pose.x += air.x;
    pose.rot += g.face * 18 * air.w;
    pose.scale = 1 - 0.04 * air.w;
    if (p.breakAt !== null && p.spikeAt !== null && t >= p.breakAt && t < p.spikeAt) {
      // THE STRUGGLE: it wriggles harder and harder, swelling, trying to break out.
      const e = t - p.breakAt, k = easeIn(win(t, p.breakAt, p.spikeAt));
      pose.rot += (6 + 10 * k) * Math.sin(e * 0.09);
      pose.x += dR * (0.03 + 0.04 * k) * Math.sin(e * 0.13);
      pose.scale += 0.07 * k;
    }
    // The spike drives it out of the air STRAIGHT INTO ITS OWN SLOT.
    const home = t >= p.slamAt ? 1 : easeIn(win(t, (p.spikeAt ?? p.slamAt) + c.hitFreezeMs, p.slamAt));
    pose.x -= g.pull.x * home; pose.y -= g.pull.y * home;
  }
  if (t >= p.impactAt) {
    const age = t - p.impactAt;
    if (p.kind === 'super') {
      // K.O.: BLASTED away (kept on screen) in a blink, spinning; it lands, bounces twice, rocks and SETTLES there
      // (the aftermath lingers), then springs back home.
      const fly = easeOutCubic(Math.min(1, age / 150));
      const back = easeInOutSine(win(t, p.homeAt, p.homeEnd));
      const la = age - 150;
      const bounce = la > 0 && la < 780 ? Math.abs(Math.sin((Math.PI * la) / 260)) * Math.exp(-la / 230) * dR * 0.42 : 0;
      const rock = la > 620 ? 13 * Math.exp(-(la - 620) / 260) * Math.sin((2 * Math.PI * (la - 620)) / 300) : 0;
      pose.x = (g.pull.x + (g.launch.x - g.pull.x) * fly) * (1 - back);
      pose.y = (g.pull.y + (g.launch.y - g.pull.y) * fly - bounce) * (1 - back) - Math.sin(Math.PI * back) * dR * 0.12;
      pose.rot = (c.koSpin * 360 * g.face * easeOutCubic(Math.min(1, age / 620)) + g.face * rock) * (1 - back);
      pose.scale = 1 - 0.14 * fly * (1 - back);
      pose.squash = c.squash * 2.4 * Math.max(0, spring(age, 5, 130));
      pose.skew = g.face * c.skew * 1.6 * smear(age, c.hitFreezeMs);
      if (t >= p.homeEnd) pose.squash += c.squash * 0.5 * Math.max(0, spring(t - p.homeEnd, 4, 70));
    } else if (p.kind === 'launcher') {
      // THE SLAM: flattened into its socket, one small bounce.
      pose.squash += c.squash * 3 * Math.max(0, spring(age, 3, 170));
      pose.y -= dR * 0.16 * Math.sin(Math.PI * Math.min(1, age / 240)) * (1 - win(age, 0, 240) * 0.3);
    } else {
      const kk = spring(age, 4, 110) * 26 * p.knock;
      pose.x += g.face * kk;
      pose.squash += c.squash * 1.1 * Math.max(0, spring(age, 5, 80));
      // Back to its slot as the striker heads home.
      const back = 1 - easeInOutSine(win(t, p.homeAt, p.homeEnd));
      pose.x *= back; pose.y *= back;
    }
  }
  // DIZZY (Tier 2, Tier 3): it reels in slow loops, a little drunk, while the birds circle its head.
  if (p.dizzyAt !== null && p.dizzyEnd !== null && t >= p.dizzyAt && t < p.dizzyEnd + 300) {
    const e = t - p.dizzyAt;
    const env = easeOutCubic(win(e, 0, 200)) * (1 - easeInOutSine(win(t, p.dizzyEnd - 100, p.dizzyEnd + 300)));
    pose.rot += 9 * Math.sin((2 * Math.PI * e) / 620) * env;
    pose.x += dR * 0.05 * Math.sin((2 * Math.PI * e) / 620 + 1.2) * env;
    pose.y += dR * 0.025 * Math.sin((4 * Math.PI * e) / 620) * env;
  }
  return pose;
}

/** Where a hit lands on screen: the target's near edge, at the hit's own height. Pure. */
export function hitPoint(p: ComboPlan, g: ComboGeo, c: HeroComboConfig, dR: number, d: Pt, h: ComboHit): Pt {
  const at = targetPose(p, g, c, dR, d, h.at - 1);
  const top = h.kind === 'spike';
  return { x: d.x + at.x - g.face * dR * (top ? 0.15 : 0.6), y: d.y + at.y + hitHeight(h) * dR * (top ? 0.9 : 0.62) };
}

/** Tier 1: where the parry flashes: between the two, where the incoming lunge meets the guard. Pure. */
export function parryPoint(p: ComboPlan, g: ComboGeo, c: HeroComboConfig, dR: number, d: Pt): Pt {
  const at = targetPose(p, g, c, dR, d, (p.parryAt ?? p.impactAt) - 1);
  return { x: d.x + at.x - g.face * dR * 0.95, y: d.y + at.y - dR * 0.15 };
}

// ─── the HUD (pure) ────────────────────────────────────────────────────────────────────────────────────────────

/**
 * THE COMBO COUNTER at sequence time `t`: the number it reads (the hits landed so far: one hit, one count), how long ago
 * it last moved (the scale punch), whether it reads the final count and how visible it is. Hidden before the first hit.
 * Pure.
 */
export interface CounterState { value: number; pulse: number; final: boolean; alpha: number }
export function comboCounter(p: ComboPlan, c: HeroComboConfig, t: number): CounterState {
  void c;
  const hits = p.hits;
  if (p.reduced || !hits.length || t < hits[0]!.at) return { value: 0, pulse: Infinity, final: false, alpha: 0 };
  let j = 0;
  while (j + 1 < hits.length && hits[j + 1]!.at <= t) j++;
  const h = hits[j]!;
  const alpha = clamp01((t - hits[0]!.at) / 50 + 0.4) * (1 - win(t, p.homeAt, p.homeAt + Math.max(120, (p.homeEnd - p.homeAt) * 0.7)));
  return { value: h.count, pulse: t - h.at, final: j === hits.length - 1, alpha };
}

/**
 * Tier 4: THE SUPER CUT-IN at sequence time `t`: how far the screen is dimmed, where the band is on its slide (-1 off the
 * near edge, 0 across the screen, 1 gone off the far edge) and how long the input glyphs have been lighting (ms; < 0 =
 * none yet). Null when there is none. Pure.
 */
export interface CutinState { dim: number; slide: number; glyphAge: number; age: number }
export function comboCutin(p: ComboPlan, c: HeroComboConfig, t: number): CutinState | null {
  if (p.freezeAt === null || p.cutinEnd === null || t < p.freezeAt || t >= p.cutinEnd) return null;
  const a = p.freezeAt, b = p.cutinEnd, s = Math.max(1, c.cutinSlideMs);
  const dim = c.cutinDim * Math.min(clamp01((t - a) / 90), clamp01((b - t) / 130));
  const slide = t < a + s ? -1 + easeOutCubic((t - a) / s) : t > b - s ? easeIn((t - (b - s)) / s) : 0;
  return { dim, slide, glyphAge: t - glyphAt(p, c, 0), age: t - a };
}

/**
 * Tier 4: THE LETTERBOX (0 = gone, 1 = fully in): the bars close in with the super freeze, part for the flurry, close
 * again for the wind-up and the blow, and open once K.O. has landed. Pure.
 */
export function comboBars(p: ComboPlan, t: number): number {
  if (p.freezeAt === null || p.cutinEnd === null || p.windAt === null || p.koAt === null) return 0;
  const a = easeOutCubic(win(t, p.freezeAt, p.freezeAt + 160)) * (1 - easeInOutSine(win(t, p.cutinEnd, p.cutinEnd + 200)));
  const b = easeOutCubic(win(t, p.windAt, p.windAt + 220)) * (1 - easeInOutSine(win(t, p.koAt + 500, p.koAt + 850)));
  return Math.max(a, b);
}

/** Tier 2 and Tier 3: how far along the dizzy birds are (ms since they started; < 0 = none) and how visible. Pure. */
export function comboDizzy(p: ComboPlan, t: number): { age: number; alpha: number } {
  if (p.dizzyAt === null || p.dizzyEnd === null || t < p.dizzyAt || t >= p.dizzyEnd + 250) return { age: -1, alpha: 0 };
  return { age: t - p.dizzyAt, alpha: easeOutCubic(win(t, p.dizzyAt, p.dizzyAt + 160)) * (1 - win(t, p.dizzyEnd - 50, p.dizzyEnd + 250)) };
}

// ─── the camera (pure) ─────────────────────────────────────────────────────────────────────────────────────────

/**
 * The camera, a different move per tier: Tier 1 snaps in on the parry and jolts sideways on the counter; Tier 2 bobs on
 * the beat (a jolt and a little punch-in on every hit); Tier 3 rises with the launch, trembles through the struggle and
 * slams down with the spike; Tier 4 pushes in through the cut-in and the wind-up and punches and shakes hardest on the
 * blow. `lift` (Tier 3) is how high the target is right now (screen px). Pure.
 */
export function comboCameraAt(p: ComboPlan, c: HeroComboConfig, t: number, face: number, lift = 0): { zoom: number; x: number; y: number } {
  if (p.reduced) return { zoom: 1, x: 0, y: 0 };
  const push = t < p.stepAt ? 0 : t < p.impactAt ? easeInOutSine((t - p.stepAt) / Math.max(1, p.impactAt - p.stepAt)) : 1 - easeInOutSine((t - p.impactAt) / Math.max(1, c.zoomOutMs));
  let z = p.zoom * clamp01(push);
  let x = 0, y = 0;
  for (const h of p.hits) {
    const age = t - h.at;
    if (age < 0) break;
    if (age > 220 || h.at === p.impactAt) continue;
    const s = spring(age, 16, 45) * p.shakePx * 0.22 * (0.5 + h.power);
    x += face * s; y += hitHeight(h) * s * 0.5;
    // Tier 2: ON THE BEAT. Every hit punches the view in a little.
    if (p.kind === 'string') z += p.punch * 0.7 * Math.exp(-age / 70);
  }
  // Tier 1: THE PARRY snaps the view in (and holds it, the breath before the counter).
  if (p.parryAt !== null && t >= p.parryAt && t < p.impactAt + 300) {
    const age = t - p.parryAt;
    z += p.punch * 0.7 * (t < p.impactAt ? easeOutCubic(age / 60) : Math.exp(-(t - p.impactAt) / 90));
    y -= spring(age, 18, 40) * p.shakePx * 0.3;
  }
  // Tier 3: THE VIEW RISES WITH THE LAUNCH (a third of the height) and trembles through the struggle.
  if (p.kind === 'launcher') {
    y += lift * 0.35;
    if (p.breakAt !== null && p.spikeAt !== null && t >= p.breakAt && t < p.spikeAt) {
      const w = (t - p.breakAt) / Math.max(1, p.spikeAt - p.breakAt);
      x += Math.sin(t * 0.21) * p.shakePx * 0.12 * w; y += Math.cos(t * 0.17) * p.shakePx * 0.12 * w;
    }
  }
  // Tier 4 THE WIND-UP: a slow extra push in and a rising tremble (the held breath before the blow).
  if (p.windAt !== null && t >= p.windAt && t < p.impactAt) {
    const w = (t - p.windAt) / Math.max(1, p.impactAt - p.windAt);
    z += p.punch * 0.5 * w * w;
    x += Math.sin(t * 0.19) * p.shakePx * 0.1 * w; y += Math.cos(t * 0.23) * p.shakePx * 0.1 * w;
  }
  // Tier 4 the cut-in: a slow push the whole freeze.
  if (p.freezeAt !== null && p.cutinEnd !== null && t >= p.freezeAt && t < p.cutinEnd) z += p.punch * 0.25 * easeInOutSine((t - p.freezeAt) / Math.max(1, p.cutinEnd - p.freezeAt));
  // Tier 4 "K.O." SLAMS IN: its own jolt, straight down.
  if (p.koAt !== null && t >= p.koAt && t - p.koAt < 500) y += spring(t - p.koAt, 14, 90) * p.shakePx * 0.6;
  if (t >= p.impactAt) {
    const age = t - p.impactAt;
    const tau = Math.max(1, c.shakeMs / 4);
    z += p.punch * Math.exp(-age / tau);
    const s = spring(age, 15, tau) * p.shakePx;
    if (p.kind === 'launcher') y += s; else x += face * s;
    if (p.kind === 'super' || p.kind === 'launcher') {
      const r = p.shakePx * 0.4 * Math.exp(-age / (tau * 2));
      x += Math.sin(age * 0.137) * r; y += Math.cos(age * 0.101) * r;
    }
  }
  return { zoom: 1 + z, x, y };
}
