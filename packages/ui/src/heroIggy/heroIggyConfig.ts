/**
 * THE IGGY BLAST HERO ATTACK ("Iggy Blast", Legendary): its tuned values, its pure timeline, the pure stream geometry
 * and the pure camera.
 *
 * Owner 2026-10-18: "branch off and make a new attack that resembles or pulls concepts from iggy. it should be a dragon
 * blast attack that has increasing magnitude, with powerful back blasting/ward effects". Owner picked concept A,
 * RECOIL WARD (docs/design/attack-dragon-blast-pitch.md): "go with A, legendary rarity, name Iggy Blast". Immune Iggy
 * (`d3_iggy`) is a crimson dragon in a low charging crouch, breathing a stream of BLUE fire inside a shimmering blue ward.
 *
 * THE SIGNATURE: the breath is so strong it shoves the dragon BACKWARD, and the ward behind it soaks the recoil. You
 * watch the ward flatten and glow harder with every stage of the breath, and at the peak it springs back: a shockwave
 * bursts off the back of the ward and the stored force kicks one last surge down the stream. That surge is THE hit.
 *
 * THE BEATS (base ms before the playback speed):
 *  1. THE DAMAGE FORMATION (shared by every style, `../heroAttack/damageFormation.ts`). Its end is this style's start.
 *  2. WARD UP + CROUCH. The total dives into the attacking hero, the ward shimmers up round the portrait, the portrait
 *     drops into a low crouch leaning at the target, blue light swells in its throat and debris flicks off its base.
 *  3. THE STAGED BREATH. A connected, turbulent stream of blue live fire (the shared `pixiFire`, its LINE shape) pours
 *     from the hero to the target. It SHIFTS UP in stages: a thin blue gust, a roaring cyan stream, a white-cored
 *     torrent (I one stage, II two, III and IV three). At each shift the stream widens and gusts, the portrait slides
 *     back a step, and the ward behind it FLATTENS harder against the push and its glow climbs. Every stage reaching
 *     the target is a tick (FX and sound only).
 *  4. THE REBOUND. The flattened ward springs back: a shockwave and a backward blast of flame and debris burst off the
 *     back of the ward (behind the attacker), the portrait is thrown forward, and a bright SURGE races down the stream.
 *     IV: the rebound is so strong the ward SHATTERS behind the hero into glass shards.
 *  5. IMPACT. The surge detonates on the target in a blue flame burst. THIS is the beat the consequence lands on (the
 *     damage, Armor, Resolve), exactly once. IV adds a flame ring and aftershocks. Then everything settles.
 *
 * No hit-stop or freeze anywhere (owner 2026-09-28: "it looks like lag").
 *
 * TIERS are the shared, owner-approved thresholds (I 1-5, II 6-11, III 12-19, IV 20+); a knockout always plays IV
 * (`attackTier`). Reduced motion: no fire, ward, shake or zoom; the numbers fade and the blow lands.
 *
 * Tuner convention (the Blast's): localStorage in DEV only, values clamped on write and on load; production always
 * plays DEFAULTS. The preview speed is how you are LOOKING and is never saved.
 */
import { clamp, easeInOutSine, hexToNum, type Pt } from '../heroAttack/easing';
import {
  HERO_ATTACK_TIER_THRESHOLDS, TIERS, reducedAttackTimeline, attackTier, type AttackTierContext, type TierNum,
} from '../heroAttack/tiers';

export { TIERS, hexToNum, type TierNum };

/** The per-tier dials. A config key is `t1..t4` + one of these. */
export const IGGY_TIER_SUFFIXES = [
  'WindupMs', 'Stages', 'StageMs', 'ReachMs', 'Width', 'Recoil', 'Flatten', 'Shatter',
  'SurgeMs', 'Shake', 'Zoom', 'Punch', 'Burst', 'Embers', 'SettleMs', 'Dim',
] as const;
export type IggyTierSuffix = (typeof IGGY_TIER_SUFFIXES)[number];
type TierKey = `t${TierNum}${IggyTierSuffix}`;

interface GlobalConfig {
  tier2At: number; tier3At: number; tier4At: number;
  // Ward up + crouch
  absorbMs: number;
  crouch: number;
  wardRadius: number;
  wardAlpha: number;
  wardGlow: number;
  // The breath
  streamFlame: number;
  streamSpeed: number;
  turbulence: number;
  buoyancy: number;
  smoke: number;
  embers: number;
  // The inhale (the dragon's presence: flame wings, eyes, light pulled into the mouth)
  wings: number;
  eyes: number;
  inhale: number;
  // The breath's sparks and debris
  sparks: number;
  // The rebound
  reboundHoldMs: number;
  /** The hit-stop: the whole FX freezes for this long at the peak of the push, then the ward SLAMS. 0 = none. */
  hitStopMs: number;
  backBlast: number;
  slamSize: number;
  shards: number;
  scorch: number;
  // Impact
  explodeSize: number;
  flashAlpha: number;
  knockPx: number;
  squash: number;
  shakeMs: number;
  zoomOutMs: number;
  reducedFadeMs: number;
  // Colours (the blue breath ramp, the ward, the side colours)
  colorCore: string;
  colorHot: string;
  colorFlame: string;
  colorDeep: string;
  colorEmber: string;
  colorSmoke: string;
  colorWard: string;
  colorWing: string;
  colorWingHot: string;
  colorPlayer: string;
  colorFoe: string;
  // Sound: a clip, a gain and a pitch per cue ('' = silent)
  sfxWardClip: string; sfxWardGain: number; sfxWardRate: number;
  sfxInhaleClip: string; sfxInhaleGain: number; sfxInhaleRate: number;
  sfxSlamClip: string; sfxSlamGain: number; sfxSlamRate: number;
  sfxGrowlClip: string; sfxGrowlGain: number; sfxGrowlRate: number;
  sfxBreathClip: string; sfxBreathGain: number; sfxBreathRate: number;
  sfxStageClip: string; sfxStageGain: number; sfxStageRate: number;
  sfxHitClip: string; sfxHitGain: number; sfxHitRate: number;
  sfxReboundClip: string; sfxReboundGain: number; sfxReboundRate: number;
  sfxShatterClip: string; sfxShatterGain: number; sfxShatterRate: number;
  sfxImpactClip: string; sfxImpactGain: number; sfxImpactRate: number;
  sfxThumpClip: string; sfxThumpGain: number; sfxThumpRate: number;
  sfxBoomClip: string; sfxBoomGain: number; sfxBoomRate: number;
  sfxCrackleGain: number;
  sfxImpactLenMs: number;
  sfxTailMix: number;
  sfxDuck: number;
  // Preview only (the tuner's Play buttons). Never read by a real fight, and left out of Copy JSON.
  previewDamage: number;
  previewParts: number;
}
export type HeroIggyConfig = GlobalConfig & Record<TierKey, number>;

export const HERO_IGGY_COLOR_KEYS = [
  'colorCore', 'colorHot', 'colorFlame', 'colorDeep', 'colorEmber', 'colorSmoke', 'colorWard', 'colorWing', 'colorWingHot', 'colorPlayer', 'colorFoe',
] as const;
export const HERO_IGGY_CLIP_KEYS = [
  'sfxWardClip', 'sfxInhaleClip', 'sfxSlamClip', 'sfxGrowlClip', 'sfxBreathClip', 'sfxStageClip', 'sfxHitClip', 'sfxReboundClip', 'sfxShatterClip',
  'sfxImpactClip', 'sfxThumpClip', 'sfxBoomClip',
] as const;
type ColorKey = (typeof HERO_IGGY_COLOR_KEYS)[number];
type ClipKey = (typeof HERO_IGGY_CLIP_KEYS)[number];
export type HeroIggyStrKey = ColorKey | ClipKey;
export type HeroIggyNumKey = Exclude<keyof HeroIggyConfig, HeroIggyStrKey>;

/** Tier I .. IV per suffix: the escalation ladder. */
const TIER_DEFAULTS: Record<IggyTierSuffix, [number, number, number, number]> = {
  WindupMs: [560, 640, 740, 860],
  Stages: [1, 2, 3, 3],
  StageMs: [380, 360, 350, 400],
  ReachMs: [190, 180, 170, 160],
  Width: [0.9, 1.1, 1.3, 1.55],
  Recoil: [10, 14, 18, 24],
  Flatten: [0.16, 0.22, 0.28, 0.34],
  Shatter: [0, 0, 0, 1],
  SurgeMs: [200, 190, 180, 170],
  Shake: [7, 11, 16, 28],
  Zoom: [0.025, 0.04, 0.055, 0.085],
  Punch: [0.02, 0.028, 0.038, 0.06],
  Burst: [1, 1.15, 1.45, 1.9],
  Embers: [10, 18, 34, 60],
  SettleMs: [300, 360, 520, 820],
  Dim: [0, 0.18, 0.32, 0.5],
};

export const IGGY_TIER_RANGES: Record<IggyTierSuffix, [number, number, number]> = {
  WindupMs: [120, 1600, 10],
  Stages: [1, 3, 1],
  StageMs: [120, 1200, 10],
  ReachMs: [60, 800, 10],
  Width: [0.3, 2.5, 0.01],
  Recoil: [0, 60, 1],
  Flatten: [0, 0.6, 0.01],
  Shatter: [0, 1, 1],
  SurgeMs: [60, 800, 10],
  Shake: [0, 40, 0.5],
  Zoom: [0, 0.14, 0.002],
  Punch: [0, 0.1, 0.001],
  Burst: [0.3, 3, 0.05],
  Embers: [0, 120, 1],
  SettleMs: [0, 1600, 10],
  Dim: [0, 0.8, 0.01],
};

const tierDefaults = Object.fromEntries(TIERS.flatMap((t) => IGGY_TIER_SUFFIXES.map((s) => [`t${t}${s}`, TIER_DEFAULTS[s][t - 1]]))) as Record<TierKey, number>;

export const HERO_IGGY_DEFAULTS: HeroIggyConfig = {
  // The shared, owner-approved thresholds (6 / 12 / 20): the same blow steps Iggy up exactly where it steps Blast up.
  ...HERO_ATTACK_TIER_THRESHOLDS,
  absorbMs: 190,
  crouch: 0.07,
  wardRadius: 1.32,
  wardAlpha: 0.55,
  wardGlow: 1,
  streamFlame: 1,
  streamSpeed: 1,
  turbulence: 1,
  buoyancy: 0.35,
  smoke: 0.5,
  embers: 1,
  wings: 1,
  eyes: 1,
  inhale: 1,
  sparks: 1,
  reboundHoldMs: 60,
  hitStopMs: 75,
  backBlast: 1,
  slamSize: 1,
  shards: 22,
  scorch: 1,
  explodeSize: 1,
  flashAlpha: 0.85,
  knockPx: 20,
  squash: 0.1,
  shakeMs: 340,
  zoomOutMs: 360,
  reducedFadeMs: 260,
  // Immune Iggy's breath: a white-hot heart, ice cyan, a clean blue, a deep royal blue, a night-blue ember.
  colorCore: '#f2fbff',
  colorHot: '#9fe8ff',
  colorFlame: '#3fb4ff',
  colorDeep: '#1f5bff',
  colorEmber: '#0b1a5a',
  colorSmoke: '#1a2233',
  colorWard: '#7fd8ff',
  // Iggy's own crimson and white: the flame wings and their hot leading edges.
  colorWing: '#d4142e',
  colorWingHot: '#ffe9e4',
  colorPlayer: '#5fd0ff',
  colorFoe: '#ff3d5a',
  sfxWardClip: 'fx/blue-impact-hit', sfxWardGain: 0.22, sfxWardRate: 1.35,
  sfxInhaleClip: 'fx/universfield-cinematic-swoosh-impact-454392', sfxInhaleGain: 0.45, sfxInhaleRate: 0.75,
  sfxSlamClip: 'crit', sfxSlamGain: 0.45, sfxSlamRate: 0.8,
  sfxGrowlClip: 'fx/dragon-growl', sfxGrowlGain: 0.45, sfxGrowlRate: 1,
  sfxBreathClip: 'cards/sp_dragonflame.effect', sfxBreathGain: 0.5, sfxBreathRate: 1.1,
  sfxStageClip: 'cards/d2_broodfire.effect', sfxStageGain: 0.32, sfxStageRate: 1.15,
  sfxHitClip: 'turnexplosion', sfxHitGain: 0.26, sfxHitRate: 1.45,
  sfxReboundClip: 'fx/universfield-ground-impact-352053', sfxReboundGain: 0.5, sfxReboundRate: 1.2,
  sfxShatterClip: 'divineshieldbreak', sfxShatterGain: 0.55, sfxShatterRate: 0.9,
  sfxImpactClip: 'fx/blue-impact-hit', sfxImpactGain: 0.5, sfxImpactRate: 0.85,
  sfxThumpClip: 'smack2', sfxThumpGain: 0.4, sfxThumpRate: 0.9,
  sfxBoomClip: 'fx/triple-impact', sfxBoomGain: 0.28, sfxBoomRate: 1.15,
  sfxCrackleGain: 0.3,
  sfxImpactLenMs: 1100,
  sfxTailMix: 0.16,
  sfxDuck: 0.5,
  previewDamage: 12,
  previewParts: 4,
  ...tierDefaults,
};

const GLOBAL_RANGES: Record<Exclude<keyof GlobalConfig, HeroIggyStrKey>, [number, number, number]> = {
  tier2At: [2, 40, 1], tier3At: [2, 60, 1], tier4At: [2, 80, 1],
  absorbMs: [60, 600, 10],
  crouch: [0, 0.3, 0.01],
  wardRadius: [0.8, 2.2, 0.01],
  wardAlpha: [0, 1, 0.01],
  wardGlow: [0, 3, 0.05],
  streamFlame: [0.2, 3, 0.05],
  streamSpeed: [0.3, 3, 0.05],
  turbulence: [0, 3, 0.05],
  buoyancy: [0, 3, 0.05],
  smoke: [0, 3, 0.05],
  embers: [0, 3, 0.05],
  wings: [0, 3, 0.05],
  eyes: [0, 3, 0.05],
  inhale: [0, 3, 0.05],
  sparks: [0, 3, 0.05],
  reboundHoldMs: [0, 600, 10],
  hitStopMs: [0, 200, 5],
  backBlast: [0, 3, 0.05],
  slamSize: [0.3, 3, 0.05],
  shards: [0, 40, 1],
  scorch: [0, 2, 0.05],
  explodeSize: [0.3, 3, 0.05],
  flashAlpha: [0, 1, 0.01],
  knockPx: [0, 60, 1],
  squash: [0, 0.3, 0.01],
  shakeMs: [0, 1200, 10],
  zoomOutMs: [60, 1500, 10],
  reducedFadeMs: [60, 1000, 10],
  sfxWardGain: [0, 2, 0.05], sfxWardRate: [0.5, 2, 0.01],
  sfxInhaleGain: [0, 2, 0.05], sfxInhaleRate: [0.5, 2, 0.01],
  sfxSlamGain: [0, 2, 0.05], sfxSlamRate: [0.5, 2, 0.01],
  sfxGrowlGain: [0, 2, 0.05], sfxGrowlRate: [0.5, 2, 0.01],
  sfxBreathGain: [0, 2, 0.05], sfxBreathRate: [0.5, 2, 0.01],
  sfxStageGain: [0, 2, 0.05], sfxStageRate: [0.5, 2, 0.01],
  sfxHitGain: [0, 2, 0.05], sfxHitRate: [0.5, 2, 0.01],
  sfxReboundGain: [0, 2, 0.05], sfxReboundRate: [0.5, 2, 0.01],
  sfxShatterGain: [0, 2, 0.05], sfxShatterRate: [0.5, 2, 0.01],
  sfxImpactGain: [0, 2, 0.05], sfxImpactRate: [0.5, 2, 0.01],
  sfxThumpGain: [0, 2, 0.05], sfxThumpRate: [0.5, 2, 0.01],
  sfxBoomGain: [0, 2, 0.05], sfxBoomRate: [0.5, 2, 0.01],
  sfxCrackleGain: [0, 2, 0.05],
  sfxImpactLenMs: [150, 3500, 10],
  sfxTailMix: [0, 0.6, 0.01],
  sfxDuck: [0, 1, 0.05],
  previewDamage: [1, 60, 1],
  previewParts: [1, 8, 1],
};

/** [min, max, step] per numeric key. Values outside are clamped on write AND on load. */
export const HERO_IGGY_RANGES: Record<HeroIggyNumKey, [number, number, number]> = {
  ...GLOBAL_RANGES,
  ...(Object.fromEntries(TIERS.flatMap((t) => IGGY_TIER_SUFFIXES.map((s) => [`t${t}${s}`, IGGY_TIER_RANGES[s]]))) as Record<TierKey, [number, number, number]>),
};

/** The hard ceilings a plan can never exceed, whatever the sliders say. */
export const IGGY_CAPS = { stages: 3, shakePx: 40, zoom: 0.14, embers: 120, shards: 40 } as const;

const HEX = /^#[0-9a-f]{6}$/i;
const isColorKey = (k: string): k is ColorKey => (HERO_IGGY_COLOR_KEYS as readonly string[]).includes(k);
const isClipKey = (k: string): k is ClipKey => (HERO_IGGY_CLIP_KEYS as readonly string[]).includes(k);

/** One value, made safe: numbers clamped into range (junk = the default), colours #rrggbb, clips a short string. */
export function clampHeroIggyValue<K extends keyof HeroIggyConfig>(key: K, value: unknown): HeroIggyConfig[K] | undefined {
  if (!Object.prototype.hasOwnProperty.call(HERO_IGGY_DEFAULTS, key)) return undefined;
  const def = HERO_IGGY_DEFAULTS[key];
  if (isColorKey(key)) {
    if (typeof value !== 'string') return def;
    const v = value.trim();
    return (HEX.test(v) ? v.toLowerCase() : def) as HeroIggyConfig[K];
  }
  if (isClipKey(key)) return (typeof value === 'string' ? value.trim().slice(0, 160) : def) as HeroIggyConfig[K];
  const n = typeof value === 'number' ? value : Number(value);
  if (typeof value === 'boolean' || value === null || value === '' || !Number.isFinite(n)) return def;
  const [min, max] = HERO_IGGY_RANGES[key as HeroIggyNumKey];
  return Math.min(max, Math.max(min, n)) as HeroIggyConfig[K];
}

/** A whole saved object, sanitised key by key over the defaults (junk and unknown keys dropped). */
export function sanitizeHeroIggyConfig(saved: unknown): HeroIggyConfig {
  const out: HeroIggyConfig = { ...HERO_IGGY_DEFAULTS };
  if (!saved || typeof saved !== 'object') return out;
  for (const [k, v] of Object.entries(saved as Record<string, unknown>)) {
    const safe = clampHeroIggyValue(k as keyof HeroIggyConfig, v);
    if (safe !== undefined) (out as unknown as Record<string, unknown>)[k] = safe;
  }
  return out;
}

const KEY = 'ascent.heroiggy.v1';

let cfg: HeroIggyConfig = (() => {
  if (!import.meta.env.DEV || typeof localStorage === 'undefined') return { ...HERO_IGGY_DEFAULTS };
  try { return sanitizeHeroIggyConfig(JSON.parse(localStorage.getItem(KEY) ?? '{}')); } catch { return { ...HERO_IGGY_DEFAULTS }; }
})();

export function getHeroIggyConfig(): HeroIggyConfig { return cfg; }

export function setHeroIggyValue(key: keyof HeroIggyConfig, value: number | string): void {
  const safe = clampHeroIggyValue(key, value);
  if (safe === undefined) return;
  cfg = { ...cfg, [key]: safe };
  if (!import.meta.env.DEV) return;
  try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch { /* ignore */ }
}

export function resetHeroIggyConfig(): void {
  cfg = { ...HERO_IGGY_DEFAULTS };
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}

/** The tuned values as JSON for pasting back into DEFAULTS (the preview-only keys left out). */
export function heroIggyConfigJson(c: HeroIggyConfig = cfg): string {
  const ship: Partial<HeroIggyConfig> = { ...c };
  delete ship.previewDamage;
  delete ship.previewParts;
  return JSON.stringify(ship, null, 2);
}

// ─── the preview speed (DEV only, never saved) ─────────────────────────────────────────────────────────────────

export const HERO_IGGY_SPEEDS = [1, 0.5, 0.25] as const;
export type HeroIggySpeed = (typeof HERO_IGGY_SPEEDS)[number];
let speed: HeroIggySpeed = 1;
/** The tuner's slow motion. Always 1 in production. */
export function heroIggyPreviewSpeed(): HeroIggySpeed { return import.meta.env.DEV ? speed : 1; }
export function setHeroIggyPreviewSpeed(s: HeroIggySpeed): void { speed = s; }

// ─── the pure plan ─────────────────────────────────────────────────────────────────────────────────────────────

/** One tier's dials, read out of the config. */
export function iggyTierDials(tier: TierNum, c: HeroIggyConfig = cfg): Record<IggyTierSuffix, number> {
  return Object.fromEntries(IGGY_TIER_SUFFIXES.map((s) => [s, c[`t${tier}${s}`]])) as Record<IggyTierSuffix, number>;
}

/** The reference distance the per-tier times are tuned at (a 1080p board, corner to corner). */
export const IGGY_REF_DISTANCE = 1600;

/** A travel time for a distance: the tuned time, scaled gently by the distance (a sandbox box stays readable). */
export function iggyTravelMs(distance: number, tunedMs: number): number {
  const d = Number.isFinite(distance) && distance > 0 ? distance : IGGY_REF_DISTANCE;
  return Math.round(tunedMs * clamp(Math.sqrt(d / IGGY_REF_DISTANCE), 0.6, 1.15));
}

/**
 * The three looks the breath shifts through, hottest last (owner pick, concept A: "thin blue -> cyan -> white-cored").
 * `heat` is where a flame starts on the blue ramp (0.5 starts it blue, 1 white-hot), `width` the stream's thickness
 * and `rate` its density, both relative to the tier's own width.
 */
export const IGGY_STAGE_LOOKS: readonly { heat: number; width: number; rate: number; name: string }[] = Object.freeze([
  { heat: 0.55, width: 0.55, rate: 0.6, name: 'thin blue' },
  { heat: 0.8, width: 0.85, rate: 0.9, name: 'cyan' },
  { heat: 1, width: 1.15, rate: 1.2, name: 'white-cored' },
]);

/**
 * Which look stage `i` of `n` plays. The LAST stage is always the hottest the tier reaches: I (one stage) breathes the
 * thin blue gust only; II goes thin blue then cyan; III and IV climb all three.
 */
export function stageLook(i: number, n: number): (typeof IGGY_STAGE_LOOKS)[number] {
  const top = Math.max(0, Math.min(IGGY_STAGE_LOOKS.length - 1, n - 1));
  const at = Math.max(0, Math.min(top, i));
  return IGGY_STAGE_LOOKS[at]!;
}

export interface IggyStagePlan {
  /** The breath shifts up to this stage (stage 0: the breath starts). */
  at: number;
  /** Its front reaches the target (a tick). */
  hitAt: number;
  /** 1-based: how far the ward is flattened and the portrait pushed back once this stage lands. */
  level: number;
}

export interface IggyPlanInput extends AttackTierContext {
  /** When the style's own attack starts: the end of the shared damage formation (`formationPlan().endAt`). */
  leadIn?: number;
  /** THE blow, as the engine decided it. */
  total: number;
  /** Screen px between the attacker's and the defender's centres. */
  distance: number;
  reduced?: boolean;
}

export interface IggyPlan {
  reduced: boolean;
  tier: TierNum;
  /** 0..1 across the tiers (I = 0, IV = 1). */
  k: number;
  total: number;
  /** The total dives into the hero; the ward shimmers up; the crouch. */
  chargeAt: number;
  absorbEnd: number;
  /** The breath starts (stage 0). */
  breathAt: number;
  stages: IggyStagePlan[];
  /** Stage-front arrivals BEFORE the impact, sequence ms: the rhythm ticks. */
  hits: number[];
  /** The push peaks: the HIT-STOP starts here (the FX freeze) and runs to `reboundAt`. */
  peakAt: number;
  /** The flattened ward SLAMS back: the back-blast behind the attacker, the mega-surge leaves the mouth. */
  reboundAt: number;
  /** IV: the ward shatters on the rebound. */
  shatter: boolean;
  /** THE consequence beat: the surge detonates on the target. */
  impactAt: number;
  /** Aftershock bursts round the target (IV). */
  booms: number[];
  endAt: number;
  /** The stream's travel from the mouth to the target, and the surge's. */
  reachMs: number;
  surgeMs: number;
  width: number;
  recoilPx: number;
  flatten: number;
  shakePx: number;
  zoom: number;
  punch: number;
  burst: number;
  embers: number;
  dim: number;
}

/** The whole Iggy Blast, in base ms (divide by the playback speed for real time). Pure and deterministic. */
export function iggyPlan(input: IggyPlanInput, c: HeroIggyConfig = cfg): IggyPlan {
  const total = Math.max(0, Math.round(input.total));
  const tier = attackTier(total, input, c); // a knockout always plays Tier IV (heroAttack/tiers.ts)
  const T = iggyTierDials(tier, c);
  const k = (tier - 1) / 3;

  if (input.reduced) {
    const r = reducedAttackTimeline(input.leadIn ?? 0, c.reducedFadeMs);
    const { impactAt } = r;
    return {
      reduced: true, tier, k, total, chargeAt: impactAt, absorbEnd: impactAt, breathAt: impactAt, stages: [], hits: [],
      peakAt: impactAt, reboundAt: impactAt, shatter: false, impactAt, booms: [], endAt: r.endAt, reachMs: 0, surgeMs: 0, width: 0,
      recoilPx: 0, flatten: 0, shakePx: 0, zoom: 0, punch: 0, burst: 0, embers: 0, dim: 0,
    };
  }

  const chargeAt = Math.max(0, input.leadIn ?? 0);
  const absorbEnd = chargeAt + c.absorbMs;
  const breathAt = chargeAt + Math.max(T.WindupMs, c.absorbMs);
  const n = clamp(Math.round(T.Stages), 1, IGGY_CAPS.stages);
  const reachMs = iggyTravelMs(input.distance, T.ReachMs);
  const surgeMs = iggyTravelMs(input.distance, T.SurgeMs);
  const stages: IggyStagePlan[] = [];
  for (let i = 0; i < n; i++) {
    const at = breathAt + i * T.StageMs;
    // The first stage has to cross the board; a later shift only sends a gust front down a stream already burning.
    stages.push({ at, hitAt: at + (i === 0 ? reachMs : Math.round(reachMs * 0.6)), level: i + 1 });
  }
  const lastStage = stages[n - 1]!;
  // The ward holds the last, hardest push for a beat, then springs back.
  const peakAt = Math.max(lastStage.hitAt + 40, lastStage.at + T.StageMs * 0.75) + c.reboundHoldMs;
  // THE HIT-STOP: a short freeze of the FX at the peak (bigger tiers hold a hair longer), then the slam.
  const reboundAt = peakAt + Math.round((c.hitStopMs * (0.8 + 0.2 * tier)) / 1.6);
  const impactAt = reboundAt + surgeMs;
  const hits = stages.map((s) => s.hitAt).filter((at) => at < impactAt).sort((a, b) => a - b);
  const shatter = T.Shatter >= 1;
  const booms = shatter ? [impactAt + 170, impactAt + 330] : [];
  const lastBeat = Math.max(
    impactAt + 160,
    booms.length ? booms[booms.length - 1]! + 120 : 0,
    impactAt + c.zoomOutMs * 0.8,
  );
  const endAt = lastBeat + T.SettleMs;

  return {
    reduced: false, tier, k, total, chargeAt, absorbEnd, breathAt, stages, hits, peakAt, reboundAt, shatter, impactAt, booms, endAt,
    reachMs, surgeMs,
    width: Math.max(0.1, T.Width),
    recoilPx: Math.max(0, T.Recoil),
    flatten: clamp(T.Flatten, 0, 0.6),
    shakePx: clamp(T.Shake, 0, IGGY_CAPS.shakePx),
    zoom: clamp(T.Zoom, 0, IGGY_CAPS.zoom),
    punch: T.Punch,
    burst: T.Burst,
    embers: Math.round(clamp(T.Embers, 0, IGGY_CAPS.embers)),
    dim: T.Dim,
  };
}

export type IggyCueKind = 'charge' | 'breath' | 'stage' | 'hit' | 'peak' | 'rebound' | 'impact' | 'boom' | 'end';
export interface IggyCue { at: number; kind: IggyCueKind; i: number }

/** Every beat the runner fires, in time order (ties keep this declaration order, so a hit precedes the impact). */
export function iggyCues(p: IggyPlan): IggyCue[] {
  const out: IggyCue[] = [];
  if (!p.reduced) {
    out.push({ at: p.chargeAt, kind: 'charge', i: 0 });
    p.stages.forEach((s, i) => out.push({ at: s.at, kind: i === 0 ? 'breath' : 'stage', i }));
    p.stages.forEach((s, i) => { if (s.hitAt < p.impactAt) out.push({ at: s.hitAt, kind: 'hit', i }); });
    out.push({ at: p.peakAt, kind: 'peak', i: 0 });
    out.push({ at: p.reboundAt, kind: 'rebound', i: 0 });
  }
  out.push({ at: p.impactAt, kind: 'impact', i: 0 });
  p.booms.forEach((at, i) => out.push({ at, kind: 'boom', i }));
  out.push({ at: p.endAt, kind: 'end', i: 0 });
  const order: Record<IggyCueKind, number> = { charge: 1, breath: 2, stage: 3, hit: 4, peak: 5, rebound: 6, impact: 7, boom: 8, end: 9 };
  return out.map((q, idx) => ({ q, idx })).sort((a, b) => a.q.at - b.q.at || order[a.q.kind] - order[b.q.kind] || a.idx - b.idx).map((x) => x.q);
}

// ─── the ward and the push (pure) ────────────────────────────────────────────────────────────────────────────────

const springAt = (ms: number, hz: number, tau: number): number => (ms < 0 ? 0 : Math.exp(-ms / tau) * Math.cos(2 * Math.PI * hz * (ms / 1000)));

/**
 * How hard the breath is PUSHING at sequence time `t` (0 = no push, 1 = the tier's top stage fully landed), eased in
 * at each stage shift. Released by the rebound: it springs back below zero (the throw forward) and settles. Pure.
 */
export function iggyPushAt(p: IggyPlan, t: number): number {
  if (p.reduced || t < p.breathAt) return 0;
  const n = p.stages.length;
  if (t < p.reboundAt) {
    let v = 0;
    for (const s of p.stages) {
      if (t < s.at) break;
      // Each shift shoves a step further back (eased over the first part of the stage).
      v = (s.level - 1) / n + (1 / n) * easeInOutSine((t - s.at) / 140);
    }
    return Math.min(1, v);
  }
  // The rebound: a hard spring back through zero (the throw forward), ringing out.
  return springAt(t - p.reboundAt, 3.2, 120);
}

/** The ward's look at sequence time `t`: up (0..1 shimmering in), its flattening against the push, its glow. Pure. */
export function iggyWardAt(p: IggyPlan, c: HeroIggyConfig, t: number): { up: number; flatten: number; glow: number; gone: boolean; slam: number } {
  if (p.reduced || t < p.chargeAt) return { up: 0, flatten: 0, glow: 0, gone: false, slam: 0 };
  const up = easeInOutSine((t - p.chargeAt) / Math.max(1, Math.min(320, p.breathAt - p.chargeAt)));
  const push = iggyPushAt(p, t);
  // THE FLEX: the ward strains harder just before the peak (anticipation), and holds there through the hit-stop.
  const flexU = clamp((t - (p.peakAt - 140)) / 140, 0, 1);
  const flex = t < p.reboundAt ? 1 + 0.35 * flexU * flexU : 1;
  // THE SLAM: after the hit-stop the ward bursts OUTWARD (an overshoot past round) and rings back.
  const slam = t >= p.reboundAt ? Math.max(0, springAt(t - p.reboundAt, 2.6, 110)) : 0;
  const gone = p.shatter && t >= p.reboundAt;
  // The glow climbs with every stage, flares on the rebound and then calms (the ward stays up on I-III).
  const flare = t >= p.reboundAt ? Math.exp(-(t - p.reboundAt) / 180) : 0;
  const glow = 0.25 + 0.75 * Math.max(0, push) * c.wardGlow + flare;
  const fade = !p.shatter && t > p.impactAt ? 1 - clamp((t - p.impactAt) / 420, 0, 1) : 1;
  return { up: up * fade, flatten: p.flatten * Math.max(0, push) * flex, glow: glow * fade, gone, slam };
}

// ─── the stream (pure) ───────────────────────────────────────────────────────────────────────────────────────────

/** The stream's mouth and its target point: the mouth sits on the attacker's rim facing the target. Pure. */
export function iggyStream(a: Pt, d: Pt, aRadius: number, dRadius: number): { mouth: Pt; to: Pt; dir: Pt; length: number } {
  const dx = d.x - a.x, dy = d.y - a.y;
  const L = Math.hypot(dx, dy) || 1;
  const dir = { x: dx / L, y: dy / L };
  const mouth = { x: a.x + dir.x * aRadius * 0.9, y: a.y + dir.y * aRadius * 0.9 };
  const to = { x: d.x - dir.x * dRadius * 0.15, y: d.y - dir.y * dRadius * 0.15 };
  return { mouth, to, dir, length: Math.hypot(to.x - mouth.x, to.y - mouth.y) };
}

/** How far along the stream its front is at `t` (0 at the mouth, 1 at the target). Pure. */
export function iggyStreamReach(p: IggyPlan, t: number): number {
  if (p.reduced || t < p.breathAt) return 0;
  const u = clamp((t - p.breathAt) / Math.max(1, p.reachMs), 0, 1);
  return 0.6 * u + 0.4 * u * u; // it leaves fast and still accelerates
}

/** Where the surge is along the stream (0..1) at `t`, or -1 before it leaves / after it lands. Pure. */
export function iggySurgeAt(p: IggyPlan, t: number): number {
  if (p.reduced || t < p.reboundAt || t >= p.impactAt) return -1;
  const u = clamp((t - p.reboundAt) / Math.max(1, p.impactAt - p.reboundAt), 0, 1);
  return 0.5 * u + 0.5 * u * u;
}

// ─── the camera (pure) ───────────────────────────────────────────────────────────────────────────────────────────

/**
 * The camera at sequence time `t`. A push in on the hero through the crouch that deepens a step at each stage; a kick
 * BACKWARD (against the line of fire) on each shift, as the breath shoves the dragon; on the rebound a jolt the other
 * way; on THE impact a punch in and a shake along the stream. IV's shatter adds a sharp ring. Deterministic. Pure.
 */
export function iggyCameraAt(p: IggyPlan, c: HeroIggyConfig, t0: number, dir: Pt = { x: 1, y: 0 }): { zoom: number; x: number; y: number } {
  if (p.reduced) return { zoom: 1, x: 0, y: 0 };
  // The hit-stop: the view holds exactly where it was at the peak.
  const t = t0 >= p.peakAt && t0 < p.reboundAt ? p.peakAt : t0;
  let z = 0;
  if (t >= p.chargeAt && t < p.impactAt) {
    z += p.zoom * 0.6 * easeInOutSine((t - p.chargeAt) / Math.max(1, p.breathAt - p.chargeAt));
    z += p.zoom * 0.4 * Math.max(0, iggyPushAt(p, Math.min(t, p.reboundAt - 1)));
  } else if (t >= p.impactAt) {
    z += (p.zoom + p.punch) * Math.exp(-(t - p.impactAt) / Math.max(1, c.zoomOutMs / 4));
  }
  let x = 0, y = 0;
  const kick = (at: number, amp: number, tau: number, hz: number, v: Pt): void => {
    const age = t - at;
    if (age < 0) return;
    const s = springAt(age, hz, tau);
    const across = amp * 0.2 * Math.sin(age * 0.09) * Math.exp(-age / tau);
    x += v.x * amp * s + -v.y * across;
    y += v.y * amp * s + v.x * across;
  };
  const back = { x: -dir.x, y: -dir.y };
  p.stages.forEach((s) => kick(s.at, p.shakePx * (0.14 + 0.06 * s.level), 50, 14, back));
  p.hits.forEach((at) => kick(at, p.shakePx * 0.18, 40, 17, dir));
  // A steady rumble under the push while the stream pours (stronger at each stage).
  if (t >= p.breathAt && t < p.peakAt) {
    const a = p.shakePx * 0.07 * Math.max(0, iggyPushAt(p, t));
    x += a * Math.sin(t * 0.13);
    y += a * Math.sin(t * 0.17 + 1.1);
  }
  // THE SLAM: the hardest jolt before the impact, BACKWARD (the blast goes off behind the hero), scaled by the tier.
  kick(p.reboundAt, p.shakePx * (p.shatter ? 0.95 : 0.55 + 0.1 * p.tier), 70, 12, { x: -dir.x, y: -dir.y });
  kick(p.impactAt, p.shakePx, Math.max(1, c.shakeMs / 4), 16, dir);
  p.booms.forEach((at, i) => kick(at, p.shakePx * 0.22, 40, 18, i % 2 ? { x: -dir.y, y: dir.x } : dir));
  return { zoom: 1 + Math.max(0, z), x, y };
}

/**
 * Where the camera anchors: the ATTACKER through the crouch and the staged breath (the push is the show), sliding to
 * the DEFENDER as the surge races down, and on the defender from the impact on. A zoom anchored on a point keeps that
 * point still. Pure.
 */
export function iggyCameraFocus(p: IggyPlan, t: number, a: Pt, d: Pt): Pt {
  const lerp = (e: number): Pt => ({ x: a.x + (d.x - a.x) * e, y: a.y + (d.y - a.y) * e });
  if (t >= p.impactAt) return d;
  if (t < p.breathAt) return a;
  if (t < p.reboundAt) return lerp(0.35 * easeInOutSine((t - p.breathAt) / Math.max(1, p.reboundAt - p.breathAt)));
  return lerp(0.35 + 0.65 * easeInOutSine((t - p.reboundAt) / Math.max(1, p.impactAt - p.reboundAt)));
}
