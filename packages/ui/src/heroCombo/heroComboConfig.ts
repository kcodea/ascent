/**
 * THE COMBO HERO ATTACK ("Flawless", a Legendary with four tiers): its tuned values, its pure timeline, the pure
 * geometry, the pure poses of BOTH portraits, the pure combo counter, the super cut-in and the camera.
 *
 * THE SIGNATURE: the blow is played as an arcade FIGHTING GAME COMBO with a HUD. The striking portrait steps in beside
 * the struck one (a 2D fighter: side by side, facing each other) and lands a combo of flat, chunky hit sparks while a
 * COMBO COUNTER ticks up beside it. The counter ENDS ON THE REAL DAMAGE of the blow (`total`, the engine's number):
 * every hit is worth a share of it, so the last hit always reads the true number. No other attack has a HUD or a counter.
 *
 * FOUR TIERS on the shared thresholds (`attackTier`: a knockout always plays IV):
 *  - I THE JAB: step in, one quick jab (a fist-shaped hit spark), the struck portrait flinches back.
 *  - II THE STRING: jab, cross, low kick. Three hits in rhythm at three heights, the struck portrait rocking with each.
 *  - III THE LAUNCHER: two quick hits, an UPPERCUT that launches the struck portrait into the air, the striker jumps
 *    after it and JUGGLES it (three or four air hits, rolled from the seed; it bobs up with each), then SPIKES it back
 *    down into its socket.
 *  - IV THE SUPER: a few opening hits, then the SUPER FREEZE: the screen dims, a diagonal cut-in band slides across with
 *    the striking hero's portrait art and a row of input arrows lighting one by one; then a rapid FLURRY with the counter
 *    racing, one last heavy blow that sends the struck portrait flying, and "K.O." slams in.
 *
 * THE CONTRACT: the blow lands exactly ONCE, on the impact (I the jab, II the low kick, III the slam into the socket,
 * IV the heavy blow). Every other hit is a TICK (no damage). Both portraits are restored exactly on every exit path (the
 * runner owns that). The clock never stops: the "hit-freeze" and the super "freeze" are HELD POSES (visuals only), so the
 * consequence and the sound can never drift.
 *
 * VARIETY: III's air hits (three or four) come from `rollSeed`, a stable per-blow seed, so a replay rolls the same.
 */
import { configStore } from '../heroAttack/configStore';
import { clamp, clamp01, easeInOutSine, easeOutCubic, spring, type Pt } from '../heroAttack/easing';
import {
  HERO_ATTACK_TIER_THRESHOLDS, TIERS, reducedAttackTimeline, attackTier, type AttackTierContext, type TierNum,
} from '../heroAttack/tiers';

export { TIERS };
export type { TierNum };

export const COMBO_KINDS = ['jab', 'string', 'launcher', 'super'] as const;
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
  sparkSize: number;
  counterSize: number;
  counterRollMs: number;
  launchMs: number;
  launchHeight: number;
  jumpDelayMs: number;
  jumpMs: number;
  airHits: number;
  airGapMs: number;
  airBob: number;
  spikeMs: number;
  slamMs: number;
  openHits: number;
  freezeDelayMs: number;
  cutinMs: number;
  cutinSlideMs: number;
  cutinDim: number;
  cutinTilt: number;
  cutinHeight: number;
  flurryHits: number;
  flurryGapMs: number;
  heavyWindMs: number;
  koLaunch: number;
  koSpin: number;
  koDelayMs: number;
  koSize: number;
  squash: number;
  shakeMs: number;
  zoomOutMs: number;
  reducedFadeMs: number;
  colorSpark: string;
  colorHeavy: string;
  colorFlash: string;
  colorDust: string;
  colorPlayer: string;
  colorFoe: string;
  sfxStepClip: string; sfxStepGain: number; sfxStepRate: number;
  sfxHitClip: string; sfxHitGain: number; sfxHitRate: number;
  sfxHeavyClip: string; sfxHeavyGain: number; sfxHeavyRate: number;
  sfxSuperClip: string; sfxSuperGain: number; sfxSuperRate: number;
  sfxKoClip: string; sfxKoGain: number; sfxKoRate: number;
  sfxDuck: number;
  previewDamage: number;
  previewParts: number;
}
export type HeroComboConfig = GlobalConfig & Record<TierKey, number>;

export const HERO_COMBO_COLOR_KEYS = ['colorSpark', 'colorHeavy', 'colorFlash', 'colorDust', 'colorPlayer', 'colorFoe'] as const;
export const HERO_COMBO_CLIP_KEYS = ['sfxStepClip', 'sfxHitClip', 'sfxHeavyClip', 'sfxSuperClip', 'sfxKoClip'] as const;
export type HeroComboStrKey = (typeof HERO_COMBO_COLOR_KEYS)[number] | (typeof HERO_COMBO_CLIP_KEYS)[number];
export type HeroComboNumKey = Exclude<keyof HeroComboConfig, HeroComboStrKey>;

/** Per tier: [I, II, III, IV]. A dial a tier's combo does not use is ignored there (the tuner says which). */
const TIER_DEFAULTS: Record<ComboTierSuffix, [number, number, number, number]> = {
  ReadyMs: [100, 100, 100, 100],
  StepMs: [220, 210, 200, 190],
  GapMs: [0, 200, 150, 130],
  HoldMs: [420, 440, 520, 900],
  ReturnMs: [260, 280, 320, 380],
  Knock: [0.6, 0.9, 1, 1.4],
  Zoom: [0.02, 0.03, 0.04, 0.05],
  Punch: [0.012, 0.018, 0.03, 0.05],
  Shake: [3, 5, 11, 18],
  Burst: [0.8, 1, 1.35, 1.8],
  Rings: [1, 1, 2, 4],
  Dim: [0.1, 0.14, 0.2, 0.28],
};

export const COMBO_TIER_RANGES: Record<ComboTierSuffix, [number, number, number]> = {
  ReadyMs: [0, 1000, 10],
  StepMs: [60, 1000, 10],
  GapMs: [0, 600, 5],
  HoldMs: [0, 2000, 10],
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
  sparkSize: 1,
  counterSize: 1,
  counterRollMs: 130,
  launchMs: 210,
  launchHeight: 1.7,
  jumpDelayMs: 90,
  jumpMs: 190,
  airHits: 4,
  airGapMs: 175,
  airBob: 1,
  spikeMs: 230,
  slamMs: 95,
  openHits: 3,
  freezeDelayMs: 180,
  cutinMs: 760,
  cutinSlideMs: 130,
  cutinDim: 0.62,
  cutinTilt: -8,
  cutinHeight: 0.27,
  flurryHits: 14,
  flurryGapMs: 56,
  heavyWindMs: 300,
  koLaunch: 1.5,
  koSpin: 1.25,
  koDelayMs: 110,
  koSize: 1,
  squash: 0.1,
  shakeMs: 300,
  zoomOutMs: 420,
  reducedFadeMs: 260,
  colorSpark: '#ffd23f',
  colorHeavy: '#ff5a3c',
  colorFlash: '#fff4dc',
  colorDust: '#e9dfc8',
  colorPlayer: '#ffcf5a',
  colorFoe: '#ff6a5a',
  sfxStepClip: 'fx/stereogenicstudio-swish-swoosh-woosh-sfx-27-357164-3', sfxStepGain: 0.3, sfxStepRate: 1.25,
  sfxHitClip: 'fx/combo-hit', sfxHitGain: 0.6, sfxHitRate: 1,
  sfxHeavyClip: 'fx/combo-heavy', sfxHeavyGain: 0.75, sfxHeavyRate: 1,
  sfxSuperClip: 'fx/combo-super', sfxSuperGain: 0.6, sfxSuperRate: 1,
  sfxKoClip: 'fx/combo-ko', sfxKoGain: 0.7, sfxKoRate: 1,
  sfxDuck: 0.6,
  previewDamage: 12,
  previewParts: 4,
  ...tierDefaults,
};

const GLOBAL_RANGES: Record<Exclude<keyof GlobalConfig, HeroComboStrKey>, [number, number, number]> = {
  tier2At: [2, 40, 1], tier3At: [2, 60, 1], tier4At: [2, 80, 1],
  absorbMs: [60, 600, 10],
  stance: [0.5, 1.6, 0.01],
  windMs: [20, 400, 5],
  hitFreezeMs: [0, 120, 1],
  lunge: [0, 1.2, 0.01],
  flinch: [0, 1, 0.01],
  flinchRot: [0, 30, 0.5],
  sparkSize: [0.3, 2.5, 0.05],
  counterSize: [0.4, 2, 0.05],
  counterRollMs: [0, 400, 5],
  launchMs: [80, 800, 5],
  launchHeight: [0.5, 4, 0.05],
  jumpDelayMs: [0, 400, 5],
  jumpMs: [60, 600, 5],
  airHits: [2, 6, 1],
  airGapMs: [80, 500, 5],
  airBob: [0, 2, 0.05],
  spikeMs: [80, 800, 5],
  slamMs: [40, 400, 5],
  openHits: [1, 5, 1],
  freezeDelayMs: [60, 800, 10],
  cutinMs: [400, 2000, 10],
  cutinSlideMs: [40, 400, 5],
  cutinDim: [0, 0.9, 0.01],
  cutinTilt: [-25, 25, 0.5],
  cutinHeight: [0.1, 0.6, 0.01],
  flurryHits: [4, 24, 1],
  flurryGapMs: [30, 200, 1],
  heavyWindMs: [100, 1000, 10],
  koLaunch: [0, 4, 0.05],
  koSpin: [0, 4, 0.25],
  koDelayMs: [0, 600, 10],
  koSize: [0, 2.5, 0.05],
  squash: [0, 0.4, 0.01],
  shakeMs: [0, 1200, 10],
  zoomOutMs: [60, 1500, 10],
  reducedFadeMs: [60, 1000, 10],
  sfxStepGain: [0, 2, 0.05], sfxStepRate: [0.5, 2.5, 0.01],
  sfxHitGain: [0, 2, 0.05], sfxHitRate: [0.5, 2.5, 0.01],
  sfxHeavyGain: [0, 2, 0.05], sfxHeavyRate: [0.5, 2.5, 0.01],
  sfxSuperGain: [0, 2, 0.05], sfxSuperRate: [0.5, 2.5, 0.01],
  sfxKoGain: [0, 2, 0.05], sfxKoRate: [0.5, 2.5, 0.01],
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

const store = configStore<HeroComboConfig>({
  key: 'ascent.herocombo.v2', defaults: HERO_COMBO_DEFAULTS, ranges: HERO_COMBO_RANGES,
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

/** III's air hits for a blow: the dial, or one fewer, rolled from the stable per-blow seed. Pure. */
export function airHitsOf(rollSeed: number, c: HeroComboConfig = store.get()): number {
  let h = (Math.round(rollSeed) | 0) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return clamp(Math.round(c.airHits) - (h % 2), 2, COMBO_CAPS.air);
}

// ─── the pure plan ─────────────────────────────────────────────────────────────────────────────────────────────

export type HitKind = 'jab' | 'cross' | 'kick' | 'upper' | 'air' | 'spike' | 'flurry' | 'heavy';

/** One hit of the combo. `count` is what the counter reads once it has landed (the last hit's is the real damage). */
export interface ComboHit { at: number; kind: HitKind; i: number; power: number; count: number }

export interface ComboPlanInput extends AttackTierContext {
  leadIn?: number;
  total: number;
  reduced?: boolean;
  /** III's air hits (from `airHitsOf`). Default: the dial. */
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
  /** III: the uppercut (the launch), the striker's jump, the spike and the slam into the socket (= the impact). */
  launchAt: number | null;
  jumpAt: number | null;
  spikeAt: number | null;
  slamAt: number | null;
  /** IV: the super freeze starts, the cut-in is gone (the flurry starts), the flurry's last hit, and K.O. slams in. */
  freezeAt: number | null;
  cutinEnd: number | null;
  flurryEnd: number | null;
  koAt: number | null;
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

/**
 * What the counter reads after each of `n` hits, ending EXACTLY on `total`: with more damage than hits every hit is
 * worth several (strictly climbing); with fewer, some hits do not move it (it never passes the real number). Pure.
 */
export function comboCounts(total: number, n: number): number[] {
  const T = Math.max(0, Math.round(total));
  return Array.from({ length: n }, (_, i) => (i === n - 1 ? T : T >= n ? Math.floor((T * (i + 1)) / n) : Math.ceil((T * (i + 1)) / n)));
}

/** The whole attack, in base ms. Pure and deterministic. */
export function comboPlan(input: ComboPlanInput, c: HeroComboConfig = store.get()): ComboPlan {
  const total = Math.max(0, Math.round(input.total));
  const tier = attackTier(total, input, c); // a knockout always plays the shared Tier IV
  const kind = comboKind(tier);
  const L = comboTierDials(tier, c);
  const looks = {
    tier, kind, k: (tier - 1) / 3, total, knock: L.Knock, zoom: L.Zoom, punch: L.Punch, shakePx: clamp(L.Shake, 0, COMBO_CAPS.shakePx),
    burst: L.Burst, rings: Math.round(L.Rings), dim: L.Dim,
  };
  const none = { launchAt: null, jumpAt: null, spikeAt: null, slamAt: null, freezeAt: null, cutinEnd: null, flurryEnd: null, koAt: null };
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
  if (kind === 'jab') {
    raw.push({ at: first, kind: 'jab', power: 0.5 });
    impactAt = first;
  } else if (kind === 'string') {
    raw.push({ at: first, kind: 'jab', power: 0.35 }, { at: first + gap, kind: 'cross', power: 0.55 }, { at: first + gap * 2.15, kind: 'kick', power: 0.85 });
    impactAt = first + gap * 2.15;
  } else if (kind === 'launcher') {
    const upAt = first + gap + Math.max(80, c.launchMs);
    raw.push({ at: first, kind: 'jab', power: 0.35 }, { at: first + gap, kind: 'cross', power: 0.5 }, { at: upAt, kind: 'upper', power: 0.85 });
    times.launchAt = upAt;
    times.jumpAt = upAt + c.jumpDelayMs;
    const n = clamp(Math.round(input.airHits ?? c.airHits), 2, COMBO_CAPS.air);
    const air0 = upAt + c.jumpDelayMs + c.jumpMs + 50;
    for (let i = 0; i < n; i++) raw.push({ at: air0 + i * c.airGapMs, kind: 'air', power: 0.4 + 0.06 * i });
    times.spikeAt = air0 + (n - 1) * c.airGapMs + Math.max(80, c.spikeMs);
    raw.push({ at: times.spikeAt, kind: 'spike', power: 1 });
    times.slamAt = times.spikeAt + Math.max(40, c.slamMs);
    impactAt = times.slamAt;
  } else {
    const open = clamp(Math.round(c.openHits), 1, COMBO_CAPS.open);
    const kinds: HitKind[] = ['jab', 'cross', 'kick'];
    for (let i = 0; i < open; i++) raw.push({ at: first + i * gap, kind: kinds[i % 3]!, power: 0.35 + 0.1 * i });
    times.freezeAt = first + (open - 1) * gap + c.freezeDelayMs;
    times.cutinEnd = times.freezeAt + c.cutinMs;
    const n = clamp(Math.round(c.flurryHits), 4, COMBO_CAPS.flurry);
    for (let i = 0; i < n; i++) raw.push({ at: times.cutinEnd + 60 + i * c.flurryGapMs, kind: 'flurry', power: 0.3 + (0.3 * i) / n });
    times.flurryEnd = times.cutinEnd + 60 + (n - 1) * c.flurryGapMs;
    impactAt = times.flurryEnd + c.heavyWindMs;
    raw.push({ at: impactAt, kind: 'heavy', power: 1.25 });
    times.koAt = impactAt + c.koDelayMs;
  }
  const counts = comboCounts(total, raw.length);
  const hits: ComboHit[] = raw.map((h, i) => ({ ...h, i, count: counts[i]! }));
  const homeAt = impactAt + L.HoldMs;
  const homeEnd = homeAt + L.ReturnMs;
  return { ...looks, ...times, reduced: false, chargeAt, absorbEnd, stepAt, stepEnd, hits, impactAt, homeAt, homeEnd, endAt: homeEnd + 80 };
}

export type ComboCueKind = 'charge' | 'step' | 'hit' | 'jump' | 'super' | 'glyph' | 'flurry' | 'impact' | 'ko' | 'home' | 'end';
export interface ComboCue { at: number; kind: ComboCueKind; i: number }

/** Every beat the runner fires, in time order. The blow lands on `impact`, once. */
export function comboCues(p: ComboPlan, c: HeroComboConfig = store.get()): ComboCue[] {
  const out: ComboCue[] = [];
  if (!p.reduced) {
    out.push({ at: p.chargeAt, kind: 'charge', i: 0 });
    out.push({ at: p.stepAt, kind: 'step', i: 0 });
    for (const h of p.hits) out.push({ at: h.at, kind: 'hit', i: h.i });
    if (p.jumpAt !== null) out.push({ at: p.jumpAt, kind: 'jump', i: 0 });
    if (p.freezeAt !== null && p.cutinEnd !== null) {
      out.push({ at: p.freezeAt, kind: 'super', i: 0 });
      for (let i = 0; i < GLYPHS; i++) out.push({ at: glyphAt(p, c, i), kind: 'glyph', i });
      out.push({ at: p.cutinEnd, kind: 'flurry', i: 0 });
    }
    if (p.koAt !== null) out.push({ at: p.koAt, kind: 'ko', i: 0 });
    out.push({ at: p.homeAt, kind: 'home', i: 0 });
  }
  out.push({ at: p.impactAt, kind: 'impact', i: 0 });
  out.push({ at: p.endAt, kind: 'end', i: 0 });
  const order: Record<ComboCueKind, number> = { charge: 0, step: 1, super: 2, glyph: 3, flurry: 4, jump: 5, hit: 6, impact: 7, ko: 8, home: 9, end: 10 };
  return out.sort((a, b) => a.at - b.at || order[a.kind] - order[b.kind] || a.i - b.i);
}

/** IV: when the super's input glyph `i` lights (after the band has slid in). Pure. */
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
  /** III: how high the launch goes (px), and how far the juggle drifts along `face` (px, signed). */
  lift: number;
  drift: number;
  /** IV: the heavy blow's knockback, an OFFSET from the target's slot (kept on screen). */
  launch: Pt;
  /** The combo counter's centre and its size (behind the striker, clear of the target). */
  counter: Pt;
  counterW: number;
  counterH: number;
  /** K.O.: its centre and its width. */
  ko: Pt;
  koW: number;
  /** IV: the cut-in band's centre, its length, its height and its tilt (radians). */
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

/** The counter's size for a blow of `total` beside a target of radius `dR`: [width, height, digit height]. Pure. */
export function counterSize(total: number, dR: number, c: HeroComboConfig): { w: number; h: number; digit: number; digits: number } {
  const digits = String(Math.max(0, Math.round(total))).length;
  const digit = dR * 0.95 * c.counterSize;
  return { w: digit * (0.56 * digits + 1.4), h: digit * 1.1, digit, digits };
}

/**
 * Where the fight happens, from the two heroes and the frame (screen px). The striker stands BESIDE the target, on the
 * side it comes from (straight above or below: your hero on the left, the foe on the right, as in a 2D fighter). The
 * RING is the target's slot pulled in off the screen's edges just far enough for this tier's combo: room for the striker
 * and the counter behind it, room to be knocked back, and (III) headroom for the launch. Pure.
 */
export function comboGeo(a: Pt, d: Pt, aR: number, dR: number, frame: Frame | null, c: HeroComboConfig = store.get(), o: { side?: 'player' | 'opp'; total?: number; kind?: ComboKind } = {}): ComboGeo {
  const kind = o.kind ?? 'jab';
  const gap = (aR + dR) * c.stance;
  const cs = counterSize(o.total ?? 0, dR, c);
  // `s` = which side of the target the striker stands on (-1 = its left).
  const s: 1 | -1 = Math.abs(a.x - d.x) > (aR + dR) * 0.6 ? (a.x < d.x ? -1 : 1) : (o.side === 'opp' ? 1 : -1);
  const face = (-s) as 1 | -1;
  const fw = frame ? frame.x1 - frame.x0 : 1920, fh = frame ? frame.y1 - frame.y0 : 1080;
  // The room the combo needs round the ring: behind (the striker and its counter), ahead (the knockback), above (the launch).
  const behind = gap + aR * 1.3 + cs.w + 12;
  const ahead = dR * (kind === 'super' ? c.koLaunch + 0.8 : kind === 'launcher' ? 1.65 : 1.3);
  const lift = kind === 'launcher' ? clamp(dR * c.launchHeight, 0, Math.max(0, fh - dR * 2.6)) : 0;
  const top = Math.max(aR, dR) * 1.15 + lift, bottom = Math.max(aR, dR) * 1.15;
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
  // IV: the heavy blow sends the target flying away from the striker (kept on screen), an offset from its SLOT.
  const to = clampToFrame({ x: ring.x + face * dR * c.koLaunch, y: ring.y - dR * 0.35 }, frame, dR * 0.75);
  const launch = { x: to.x - d.x, y: to.y - d.y };
  const mid = frame ? { x: (frame.x0 + frame.x1) / 2, y: (frame.y0 + frame.y1) / 2 } : ring;
  const koW = Math.min(fw * 0.4, dR * 5.2) * c.koSize;
  let ko = clampToFrame({ x: ring.x + (mid.x - ring.x) * 0.5, y: ring.y + (mid.y - ring.y) * 0.55 }, frame, koW / 2 + 8, koW * 0.22 + 8);
  // Never over the counter (it reads the real damage as K.O. lands): step clear of it, toward the middle of the screen.
  const clear = koW * 0.22 + cs.h / 2 + 10;
  if (Math.abs(ko.x - counter.x) < (koW + cs.w) / 2 && Math.abs(ko.y - counter.y) < clear) {
    ko = clampToFrame({ x: ko.x, y: counter.y + (mid.y >= counter.y ? clear : -clear) }, frame, koW / 2 + 8, koW * 0.22 + 8);
  }
  const band = { x: mid.x, y: mid.y, w: Math.hypot(fw, fh) * 1.12, h: fh * c.cutinHeight, rot: (c.cutinTilt * Math.PI) / 180 };
  return { frame, face, ring, pull, stance, lift, drift, launch, counter, counterW: cs.w, counterH: cs.h, ko, koW, band };
}

// ─── the poses (pure) ──────────────────────────────────────────────────────────────────────────────────────────

/** A portrait's offset from its slot (screen px), its rotation (degrees), its scale and a squash (+ = flattened). */
export interface ComboPose { x: number; y: number; rot: number; scale: number; squash: number }
const REST: ComboPose = { x: 0, y: 0, rot: 0, scale: 1, squash: 0 };

const easeIn = (u: number): number => { const x = clamp01(u); return x * x; };
const win = (t: number, a: number, b: number): number => clamp01((t - a) / Math.max(1, b - a));

/** How a hit is thrown: [wind-up ms, recover ms, pull-back, reach, dir x (along the facing), dir y, lean degrees]. */
const STRIKES: Record<HitKind, readonly [number, number, number, number, number, number, number]> = {
  jab: [70, 110, 0.2, 0.8, 1, 0, 6],
  cross: [95, 140, 0.3, 1, 1, -0.08, 12],
  kick: [105, 150, 0.3, 1, 0.85, 0.5, -12],
  upper: [120, 180, 0.45, 1.1, 0.55, -0.85, -8],
  air: [60, 95, 0.2, 0.75, 0.8, 0, 8],
  spike: [110, 170, 0.5, 1.1, 0.45, 0.9, 18],
  flurry: [36, 42, 0.15, 0.6, 1, 0, 4],
  heavy: [260, 280, 0.7, 1.5, 1.2, 0, 22],
};

/** How the target takes a hit: [knock, dir x (along the facing), dir y, rock degrees, decay ms]. */
const FLINCHES: Record<HitKind, readonly [number, number, number, number, number]> = {
  jab: [0.8, 1, -0.05, 1, 110],
  cross: [1.1, 1, -0.12, 1.3, 120],
  kick: [1, 0.7, 0.22, -1.2, 120],
  upper: [0.3, 0.3, -0.4, 1, 100],
  air: [0.45, 0.6, 0, 1, 80],
  spike: [0, 0, 0, 1.5, 80],
  flurry: [0.42, 1, 0, 0.7, 55],
  heavy: [0, 0, 0, 0, 80],
};

/** A flurry or air hit's own height on the target (-1 top .. 1 bottom): scattered, never the same twice in a row. */
export function hitHeight(h: ComboHit): number {
  switch (h.kind) {
    case 'jab': return -0.4;
    case 'cross': return -0.05;
    case 'kick': return 0.6;
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

/** III: the juggle. How high the target is (px), how far it has drifted (px) and how airborne it is (0..1). */
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
    const next = p.hits[i + 1]!.at;
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
    const wind = h.kind === 'heavy' ? Math.min(k[0], c.heavyWindMs * 0.85) : k[0];
    const dt = t - h.at;
    if (dt <= -wind || dt >= c.hitFreezeMs + k[1]) continue;
    const s = strike(dt, wind, c.hitFreezeMs, k[1], k[2]);
    const dy = h.kind === 'air' || h.kind === 'flurry' ? hitHeight(h) * 0.5 : k[5];
    x += g.face * k[4] * reach * k[3] * s; y += dy * reach * k[3] * s;
    rot += g.face * k[6] * s;
  }
  // III: it jumps after the launched target, rides the juggle's drift, and drops back after the spike.
  if (p.jumpAt !== null && p.spikeAt !== null && p.slamAt !== null && t >= p.jumpAt) {
    const air = airOf(p, g, c, t, AIR);
    const up = easeOutCubic(win(t, p.jumpAt, p.jumpAt + c.jumpMs)) * (1 - easeIn(win(t, p.spikeAt + c.hitFreezeMs + 30, p.slamAt + 170)));
    y -= g.lift * (1 - 0.11 * clamp(c.airBob, 0, 2)) * up;
    x += air.x * 0.9;
  }
  // IV: it swells a touch through the super freeze (held still: the cut-in is the show).
  if (p.freezeAt !== null && p.cutinEnd !== null && t >= p.freezeAt && t < p.impactAt) {
    pose.scale = 1 + 0.07 * easeOutCubic(win(t, p.freezeAt, p.freezeAt + 120));
  }
  if (t >= p.impactAt && p.kind === 'super') pose.scale = 1 + 0.07 * (1 - win(t, p.impactAt + 200, p.homeAt));
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
  // Every hit it takes: snapped back along the hit, held for the hit-freeze, rocking back.
  for (const h of p.hits) {
    const dt = t - h.at;
    if (dt < 0) break;
    const k = FLINCHES[h.kind];
    const f = flinch(dt, c.hitFreezeMs, k[4]);
    if (!f) continue;
    const dy = h.kind === 'flurry' ? -hitHeight(h) * 0.25 : k[2];
    const a = amp * k[0] * (0.6 + 0.5 * h.power);
    pose.x += g.face * k[1] * a * f; pose.y += dy * a * f;
    pose.rot += g.face * c.flinchRot * k[3] * (0.6 + 0.5 * h.power) * f * (h.kind === 'flurry' || h.kind === 'air' ? (h.i % 2 ? 1 : -0.6) : 1);
    if (dt <= c.hitFreezeMs + 90) pose.squash += c.squash * 0.35 * h.power * (1 - win(dt, c.hitFreezeMs, c.hitFreezeMs + 90));
  }
  // III: launched, juggled (it bobs up with each air hit), spiked back down into its socket.
  if (p.launchAt !== null && p.slamAt !== null && t >= p.launchAt) {
    const air = airOf(p, g, c, t, AIR);
    pose.y -= air.h; pose.x += air.x;
    pose.rot += g.face * 18 * air.w;
    pose.scale = 1 - 0.04 * air.w;
    // The spike drives it out of the air STRAIGHT INTO ITS OWN SLOT.
    const home = t >= p.slamAt ? 1 : easeIn(win(t, (p.spikeAt ?? p.slamAt) + c.hitFreezeMs, p.slamAt));
    pose.x -= g.pull.x * home; pose.y -= g.pull.y * home;
  }
  if (t >= p.impactAt) {
    const age = t - p.impactAt;
    if (p.kind === 'super') {
      // K.O.: flung away (kept on screen), spinning, then it springs back home.
      const fly = easeOutCubic(Math.min(1, age / 170));
      const back = easeInOutSine(win(t, p.homeAt, p.homeEnd));
      pose.x = (g.pull.x + (g.launch.x - g.pull.x) * fly) * (1 - back); pose.y = (g.pull.y + (g.launch.y - g.pull.y) * fly) * (1 - back) - Math.sin(Math.PI * back) * dR * 0.12;
      pose.rot = c.koSpin * 360 * g.face * easeOutCubic(Math.min(1, age / 620)) * (1 - back);
      pose.scale = 1 - 0.12 * fly * (1 - back);
      pose.squash = c.squash * 2 * Math.max(0, spring(age, 5, 110));
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
  return pose;
}

/** Where a hit lands on screen: the target's near edge, at the hit's own height. Pure. */
export function hitPoint(p: ComboPlan, g: ComboGeo, c: HeroComboConfig, dR: number, d: Pt, h: ComboHit): Pt {
  const at = targetPose(p, g, c, dR, d, h.at - 1);
  const top = h.kind === 'spike';
  return { x: d.x + at.x - g.face * dR * (top ? 0.15 : 0.6), y: d.y + at.y + hitHeight(h) * dR * (top ? 0.9 : 0.62) };
}

// ─── the HUD (pure) ────────────────────────────────────────────────────────────────────────────────────────────

/**
 * THE COMBO COUNTER at sequence time `t`: the number it reads (it rolls up through a hit's share, so a hit worth several
 * races through them), how long ago it last moved (the scale punch), whether it reads the final number (the real damage)
 * and how visible it is. Hidden before the first hit. Pure.
 */
export interface CounterState { value: number; pulse: number; final: boolean; alpha: number }
export function comboCounter(p: ComboPlan, c: HeroComboConfig, t: number): CounterState {
  const hits = p.hits;
  if (p.reduced || !hits.length || t < hits[0]!.at) return { value: 0, pulse: Infinity, final: false, alpha: 0 };
  let j = 0;
  while (j + 1 < hits.length && hits[j + 1]!.at <= t) j++;
  const h = hits[j]!;
  const prev = j ? hits[j - 1]!.count : 0;
  const gapTo = j + 1 < hits.length ? hits[j + 1]!.at - h.at : 400;
  const roll = Math.min(c.counterRollMs, gapTo * 0.8);
  const e = roll > 0 ? clamp01((t - h.at) / roll) : 1;
  const step = h.count - prev;
  const value = step <= 0 ? h.count : e >= 1 ? h.count : prev + Math.max(1, Math.ceil(step * e));
  // The punch restarts on the hit that last MOVED the counter.
  let m = j;
  while (m > 0 && hits[m]!.count === hits[m - 1]!.count) m--;
  const alpha = clamp01((t - hits[0]!.at) / 50 + 0.4) * (1 - win(t, p.homeAt, p.homeAt + Math.max(120, (p.homeEnd - p.homeAt) * 0.7)));
  return { value, pulse: t - hits[m]!.at, final: j === hits.length - 1 && value === h.count, alpha };
}

/**
 * IV: THE SUPER CUT-IN at sequence time `t`: how far the screen is dimmed, where the band is on its slide (-1 off the
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

// ─── the camera (pure) ─────────────────────────────────────────────────────────────────────────────────────────

/**
 * The camera: it pushes in on the fight from the step in to the impact, jolts a little on every hit along the hit, and
 * punches and shakes on the impact. Pure.
 */
export function comboCameraAt(p: ComboPlan, c: HeroComboConfig, t: number, face: number): { zoom: number; x: number; y: number } {
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
  }
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
