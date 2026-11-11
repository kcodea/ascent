/**
 * THE VOID HERO ATTACK: its tuned values, its pure timeline, the pure orb paths and the pure camera.
 *
 * Mike 2026-11-11, picking from a list of magic themes: "lets do void!". The brief he picked: dark orbs with a bright
 * rim; one orb, two, a ring of them; and at the top tier the orbs merge into a black hole over the target, everything
 * pulls toward it, then it collapses to a point and blasts outward.
 *
 * STARTED AS A COPY OF ARCANA (the reference bar): the plan, the cues, the lob and vortex paths and the camera are
 * Arcana's, renamed, so the timing is already proven. A "ribbon" in these names is an ORB's flight and its dark trail.
 * The look (`heroVoidScene.ts`) and the Tier IV portrait pull (`heroVoid.ts`) are the Void's own.
 *
 * THE BEATS (base ms before the playback speed):
 *  1. THE DAMAGE FORMATION (shared by every style, `../heroAttack/damageFormation.ts`). Its end is this style's start.
 *  2. CHARGE. The total dives into the attacking hero; an accretion swirl opens under the portrait and a small dark
 *     orb forms over it, light spiralling in; the view pushes in on the hero.
 *  3. THROW. Dark ORBS (a near-black disc with a hot rim, a swirl of light spinning into it, motes circling it and
 *     spiralling in, a black trail edged in light) are thrown from the hero nearly FLAT (they are heavy): I one; II two (different heights, opposite sides); III five,
 *     fanned, landing in rhythm.
 *  4. IMPACT. Each orb that lands before the last is a small tick. The LAST one is THE impact: a dark burst over the
 *     portrait inside a hot rim, rings, spikes. The consequence (the damage, Armor, Resolve) lands ONCE, there.
 *  IV. THE BLACK HOLE. The orbs do not strike: they arc in and join a ring orbiting the struck hero, which TIGHTENS and
 *     SPEEDS UP while a black hole opens in its eye and grows, light streaking into it from far out; both portraits
 *     lean toward it. Then it COLLAPSES to a pinpoint and BLASTS outward. The damage lands on the blast.
 *
 * TIERS are the shared thresholds (I 1-5, II 6-11, III 12-19, IV 20+). Reduced motion: no flight, orbs, shake or zoom;
 * the numbers fade and the blow lands.
 *
 * Tuner convention (the Blast's): localStorage in DEV only, values clamped on write and on load; production always
 * plays DEFAULTS. The preview speed is how you are LOOKING and is never saved.
 */
import { clamp, easeInOutSine, hexToNum, type Pt } from '../heroAttack/easing';
import {
  HERO_ATTACK_TIER_THRESHOLDS, TIERS, reducedAttackTimeline, type TierNum, attackTier, type AttackTierContext, isKnockoutVariant,
} from '../heroAttack/tiers';
import { KO_DIP, KO_SHAKE, type KoDip } from '../heroAttack/knockout';

export { TIERS, hexToNum, type TierNum };

/** The per-tier dials. A config key is `t1..t4` + one of these. */
export const VOID_TIER_SUFFIXES = [
  'ChargeMs', 'Ribbons', 'LaunchStaggerMs', 'FlightMs', 'ArcHeight', 'Fan', 'RibbonWidth', 'Swirl',
  'Shake', 'Zoom', 'Punch', 'Motes', 'Burst', 'SettleMs', 'Dim',
] as const;
export type VoidTierSuffix = (typeof VOID_TIER_SUFFIXES)[number];
type TierKey = `t${TierNum}${VoidTierSuffix}`;

interface GlobalConfig {
  // Tiers (the shared thresholds; DEV-tunable only)
  tier2At: number; tier3At: number; tier4At: number;
  // Combine (the shared beat)
  // Charge
  absorbMs: number;
  heroSwell: number;
  recoilPx: number;
  // Ribbons
  ribbonLength: number;
  ribbonGlow: number;
  ribbonCore: number;
  ribbonShade: number;
  ribbonTwist: number;
  strand: number;
  headSize: number;
  sigilSize: number;
  /** Motes circling each orb and spiralling in. */
  orbMotes: number;
  /** How far out a mote is caught, in orb radii. */
  orbReach: number;
  /** Turns a second at the outer edge (they speed up as they fall in). */
  orbSpin: number;
  // Swirl (Tier IV)
  swirlRadius: number;
  swirlTilt: number;
  swirlMs: number;
  swirlSpeed0: number;
  swirlSpeed1: number;
  swirlTighten: number;
  convergeMs: number;
  /** Tier IV: how far the STRIKING portrait leans toward the black hole (px at full pull). */
  pullPx: number;
  /** Tier IV: how much the STRUCK portrait is crushed toward the hole's centre (a scale fraction at full pull). */
  crush: number;
  // Explosion
  explodeSize: number;
  explodeRibbons: number;
  flashAlpha: number;
  // Camera and portraits
  knockPx: number;
  squash: number;
  shakeMs: number;
  zoomOutMs: number;
  reducedFadeMs: number;
  // Colours
  colorCore: string;
  colorAccent: string;
  colorPlayer: string;
  colorFoe: string;
  colorShade: string;
  // Sound: a clip, a gain and a pitch per cue ('' = silent)
  sfxCastClip: string; sfxCastGain: number; sfxCastRate: number;
  sfxChargeClip: string; sfxChargeGain: number; sfxChargeRate: number;
  sfxLaunchClip: string; sfxLaunchGain: number; sfxLaunchRate: number;
  sfxShimmerClip: string; sfxShimmerGain: number; sfxShimmerRate: number;
  sfxHitClip: string; sfxHitGain: number; sfxHitRate: number;
  sfxImpactClip: string; sfxImpactGain: number; sfxImpactRate: number;
  sfxChimeClip: string; sfxChimeGain: number; sfxChimeRate: number;
  sfxThumpClip: string; sfxThumpGain: number; sfxThumpRate: number;
  sfxImplodeClip: string; sfxImplodeGain: number; sfxImplodeRate: number;
  sfxExplodeClip: string; sfxExplodeGain: number; sfxExplodeRate: number;
  sfxBigClip: string; sfxBigGain: number; sfxBigRate: number;
  sfxBoomClip: string; sfxBoomGain: number; sfxBoomRate: number;
  sfxSwirlGain: number; sfxSwirlLowHz: number; sfxSwirlHighHz: number;
  sfxLaunchLenMs: number;
  sfxImpactLenMs: number;
  sfxTailMix: number;
  sfxDuck: number;
  // Preview only (the tuner's Play buttons). Never read by a real fight, and left out of Copy JSON.
  previewDamage: number;
  previewParts: number;
}
export type HeroVoidConfig = GlobalConfig & Record<TierKey, number>;

export const HERO_VOID_COLOR_KEYS = ['colorCore', 'colorAccent', 'colorPlayer', 'colorFoe', 'colorShade'] as const;
export const HERO_VOID_CLIP_KEYS = [
  'sfxCastClip', 'sfxChargeClip', 'sfxLaunchClip', 'sfxShimmerClip', 'sfxHitClip',
  'sfxImpactClip', 'sfxChimeClip', 'sfxThumpClip', 'sfxImplodeClip', 'sfxExplodeClip', 'sfxBigClip', 'sfxBoomClip',
] as const;
type ColorKey = (typeof HERO_VOID_COLOR_KEYS)[number];
type ClipKey = (typeof HERO_VOID_CLIP_KEYS)[number];
export type HeroVoidStrKey = ColorKey | ClipKey;
export type HeroVoidNumKey = Exclude<keyof HeroVoidConfig, HeroVoidStrKey>;

/** Tier I .. IV per suffix: the escalation ladder. */
const TIER_DEFAULTS: Record<VoidTierSuffix, [number, number, number, number]> = {
  ChargeMs: [260, 340, 420, 420],
  Ribbons: [1, 2, 5, 6],
  LaunchStaggerMs: [0, 130, 100, 60],
  FlightMs: [560, 580, 590, 520],
  // Nearly flat (Mike 2026-11-11: "it shouldnt arc as much, it would defy those phsysics"): a heavy orb barely rises.
  ArcHeight: [0.05, 0.07, 0.07, 0.06],
  Fan: [0, 0.09, 0.17, 0.1],
  RibbonWidth: [52, 52, 44, 38],
  Swirl: [0, 0, 0, 1],
  Shake: [5, 8, 12, 20],
  Zoom: [0.02, 0.03, 0.045, 0.07],
  Punch: [0.02, 0.028, 0.038, 0.06],
  Motes: [14, 20, 28, 62],
  Burst: [1, 1.15, 1.35, 2.1],
  SettleMs: [220, 300, 360, 280],
  Dim: [0, 0.18, 0.32, 0.5],
};

export const VOID_TIER_RANGES: Record<VoidTierSuffix, [number, number, number]> = {
  ChargeMs: [60, 1500, 10],
  Ribbons: [1, 8, 1],
  LaunchStaggerMs: [0, 300, 5],
  FlightMs: [200, 1400, 10],
  ArcHeight: [0, 0.8, 0.01],
  Fan: [0, 0.6, 0.01],
  RibbonWidth: [6, 60, 0.5],
  Swirl: [0, 1, 1],
  Shake: [0, 40, 0.5],
  Zoom: [0, 0.14, 0.002],
  Punch: [0, 0.1, 0.001],
  Motes: [0, 80, 1],
  Burst: [0.3, 3, 0.05],
  SettleMs: [0, 1600, 10],
  Dim: [0, 0.8, 0.01],
};

const tierDefaults = Object.fromEntries(TIERS.flatMap((t) => VOID_TIER_SUFFIXES.map((s) => [`t${t}${s}`, TIER_DEFAULTS[s][t - 1]]))) as Record<TierKey, number>;

export const HERO_VOID_DEFAULTS: HeroVoidConfig = {
  // The shared, owner-approved thresholds (6 / 12 / 20): the same blow steps Void up exactly where it steps Blast up.
  ...HERO_ATTACK_TIER_THRESHOLDS,
  absorbMs: 190,
  heroSwell: 0.08,
  recoilPx: 10,
  // Mike's tune (his Copy JSON, 2026-11-11): a short trail with no twist or strand, a bigger orb with a smaller swirl,
  // and more motes caught further out and circling faster.
  ribbonLength: 40,
  ribbonGlow: 3.4,
  ribbonCore: 0.22,
  ribbonShade: 0.82,
  ribbonTwist: 0,
  strand: 0,
  headSize: 1.45,
  sigilSize: 0.45,
  orbMotes: 12,
  orbReach: 3.55,
  orbSpin: 2,
  swirlRadius: 1.55,
  swirlTilt: 0.5,
  swirlMs: 700,
  swirlSpeed0: 1.1,
  swirlSpeed1: 3.4,
  swirlTighten: 0.45,
  convergeMs: 170,
  pullPx: 16,
  crush: 0.1,
  explodeSize: 1,
  explodeRibbons: 0, // Mike's tune: no streaks flung out of the blast
  flashAlpha: 0.8,
  knockPx: 18,
  squash: 0.1,
  shakeMs: 340,
  zoomOutMs: 360,
  reducedFadeMs: 260,
  colorCore: '#ffffff',
  colorAccent: '#c9b6ff',
  colorPlayer: '#5a63ff',
  colorFoe: '#ff3b5c',
  colorShade: '#07030f',
  sfxCastClip: 'castspell', sfxCastGain: 0.5, sfxCastRate: 0.72,
  sfxChargeClip: 'fx/oona-powerup', sfxChargeGain: 0.45, sfxChargeRate: 0.8,
  sfxLaunchClip: 'fx/whoosh-03', sfxLaunchGain: 0.6, sfxLaunchRate: 0.8,
  sfxShimmerClip: 'equipmentsheen', sfxShimmerGain: 0.2, sfxShimmerRate: 0.7,
  sfxHitClip: 'divineshieldbreak', sfxHitGain: 0.4, sfxHitRate: 0.85,
  sfxImpactClip: 'fx/blue-impact-hit', sfxImpactGain: 0.8, sfxImpactRate: 0.8,
  sfxChimeClip: 'prismaticpick', sfxChimeGain: 0.3, sfxChimeRate: 0.7,
  sfxThumpClip: 'smack2', sfxThumpGain: 0.55, sfxThumpRate: 0.7,
  sfxImplodeClip: 'runeselectimplosion', sfxImplodeGain: 0.85, sfxImplodeRate: 0.85,
  sfxExplodeClip: 'turnexplosion', sfxExplodeGain: 0.7, sfxExplodeRate: 0.9,
  sfxBigClip: 'crit', sfxBigGain: 0.4, sfxBigRate: 1.1,
  sfxBoomClip: 'fx/triple-impact', sfxBoomGain: 0.28, sfxBoomRate: 1.3,
  sfxSwirlGain: 0.34, sfxSwirlLowHz: 70, sfxSwirlHighHz: 420,
  sfxLaunchLenMs: 700,
  sfxImpactLenMs: 1100,
  sfxTailMix: 0.14,
  sfxDuck: 0.5,
  previewDamage: 12,
  previewParts: 4,
  ...tierDefaults,
};

const GLOBAL_RANGES: Record<Exclude<keyof GlobalConfig, HeroVoidStrKey>, [number, number, number]> = {
  tier2At: [2, 40, 1], tier3At: [2, 60, 1], tier4At: [2, 80, 1],
  absorbMs: [60, 600, 10],
  heroSwell: [0, 0.3, 0.01],
  recoilPx: [0, 60, 1],
  ribbonLength: [40, 500, 5],
  ribbonGlow: [1, 5, 0.05],
  ribbonCore: [0.1, 0.8, 0.01],
  ribbonShade: [0, 1, 0.01],
  ribbonTwist: [0, 1, 0.01],
  strand: [0, 1.5, 0.01],
  headSize: [0.3, 3, 0.05],
  sigilSize: [0, 3, 0.05],
  orbMotes: [0, 16, 1],
  orbReach: [1.2, 5, 0.05],
  orbSpin: [0, 4, 0.05],
  swirlRadius: [0.6, 3, 0.05],
  swirlTilt: [0.2, 1, 0.01],
  swirlMs: [200, 2000, 10],
  swirlSpeed0: [0.2, 6, 0.05],
  swirlSpeed1: [0.2, 8, 0.05],
  swirlTighten: [0, 0.9, 0.01],
  convergeMs: [40, 500, 5],
  pullPx: [0, 60, 1],
  crush: [0, 0.4, 0.01],
  explodeSize: [0.3, 3, 0.05],
  explodeRibbons: [0, 16, 1],
  flashAlpha: [0, 1, 0.01],
  knockPx: [0, 60, 1],
  squash: [0, 0.3, 0.01],
  shakeMs: [0, 1200, 10],
  zoomOutMs: [60, 1500, 10],
  reducedFadeMs: [60, 1000, 10],
  sfxCastGain: [0, 2, 0.05], sfxCastRate: [0.5, 2, 0.01],
  sfxChargeGain: [0, 2, 0.05], sfxChargeRate: [0.5, 2, 0.01],
  sfxLaunchGain: [0, 2, 0.05], sfxLaunchRate: [0.5, 2, 0.01],
  sfxShimmerGain: [0, 2, 0.05], sfxShimmerRate: [0.5, 2, 0.01],
  sfxHitGain: [0, 2, 0.05], sfxHitRate: [0.5, 2, 0.01],
  sfxImpactGain: [0, 2, 0.05], sfxImpactRate: [0.5, 2, 0.01],
  sfxChimeGain: [0, 2, 0.05], sfxChimeRate: [0.5, 2, 0.01],
  sfxThumpGain: [0, 2, 0.05], sfxThumpRate: [0.5, 2, 0.01],
  sfxImplodeGain: [0, 2, 0.05], sfxImplodeRate: [0.5, 2, 0.01],
  sfxExplodeGain: [0, 2, 0.05], sfxExplodeRate: [0.5, 2, 0.01],
  sfxBigGain: [0, 2, 0.05], sfxBigRate: [0.5, 2, 0.01],
  sfxBoomGain: [0, 2, 0.05], sfxBoomRate: [0.5, 2, 0.01],
  sfxSwirlGain: [0, 2, 0.05], sfxSwirlLowHz: [60, 800, 5], sfxSwirlHighHz: [200, 3000, 10],
  sfxLaunchLenMs: [100, 2500, 10],
  sfxImpactLenMs: [150, 3500, 10],
  sfxTailMix: [0, 0.6, 0.01],
  sfxDuck: [0, 1, 0.05],
  previewDamage: [1, 60, 1],
  previewParts: [1, 8, 1],
};

/** [min, max, step] per numeric key. Values outside are clamped on write AND on load. */
export const HERO_VOID_RANGES: Record<HeroVoidNumKey, [number, number, number]> = {
  ...GLOBAL_RANGES,
  ...(Object.fromEntries(TIERS.flatMap((t) => VOID_TIER_SUFFIXES.map((s) => [`t${t}${s}`, VOID_TIER_RANGES[s]]))) as Record<TierKey, [number, number, number]>),
};

/** The hard ceilings a plan can never exceed, whatever the sliders say (so a 40 stays clean, not cluttered). */
export const VOID_CAPS = { ribbons: 8, explodeRibbons: 16, motes: 80, shakePx: 40, zoom: 0.14 } as const;

const HEX = /^#[0-9a-f]{6}$/i;
const isColorKey = (k: string): k is ColorKey => (HERO_VOID_COLOR_KEYS as readonly string[]).includes(k);
const isClipKey = (k: string): k is ClipKey => (HERO_VOID_CLIP_KEYS as readonly string[]).includes(k);

/** One value, made safe: numbers clamped into range (junk = the default), colours #rrggbb, clips a short string. */
export function clampHeroVoidValue<K extends keyof HeroVoidConfig>(key: K, value: unknown): HeroVoidConfig[K] | undefined {
  if (!Object.prototype.hasOwnProperty.call(HERO_VOID_DEFAULTS, key)) return undefined;
  const def = HERO_VOID_DEFAULTS[key];
  if (isColorKey(key)) {
    if (typeof value !== 'string') return def;
    const v = value.trim();
    return (HEX.test(v) ? v.toLowerCase() : def) as HeroVoidConfig[K];
  }
  if (isClipKey(key)) return (typeof value === 'string' ? value.trim().slice(0, 160) : def) as HeroVoidConfig[K];
  const n = typeof value === 'number' ? value : Number(value);
  if (typeof value === 'boolean' || value === null || value === '' || !Number.isFinite(n)) return def;
  const [min, max] = HERO_VOID_RANGES[key as HeroVoidNumKey];
  return Math.min(max, Math.max(min, n)) as HeroVoidConfig[K];
}

/** A whole saved object, sanitised key by key over the defaults (junk and unknown keys dropped). */
export function sanitizeHeroVoidConfig(saved: unknown): HeroVoidConfig {
  const out: HeroVoidConfig = { ...HERO_VOID_DEFAULTS };
  if (!saved || typeof saved !== 'object') return out;
  for (const [k, v] of Object.entries(saved as Record<string, unknown>)) {
    const safe = clampHeroVoidValue(k as keyof HeroVoidConfig, v);
    if (safe !== undefined) (out as unknown as Record<string, unknown>)[k] = safe;
  }
  return out;
}

const KEY = 'ascent.herovoid.v1';

let cfg: HeroVoidConfig = (() => {
  if (!import.meta.env.DEV || typeof localStorage === 'undefined') return { ...HERO_VOID_DEFAULTS };
  try { return sanitizeHeroVoidConfig(JSON.parse(localStorage.getItem(KEY) ?? '{}')); } catch { return { ...HERO_VOID_DEFAULTS }; }
})();

export function getHeroVoidConfig(): HeroVoidConfig { return cfg; }

export function setHeroVoidValue(key: keyof HeroVoidConfig, value: number | string): void {
  const safe = clampHeroVoidValue(key, value);
  if (safe === undefined) return;
  cfg = { ...cfg, [key]: safe };
  if (!import.meta.env.DEV) return;
  try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch { /* ignore */ }
}

export function resetHeroVoidConfig(): void {
  cfg = { ...HERO_VOID_DEFAULTS };
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}

/** The tuned values as JSON for pasting back into DEFAULTS (the preview-only keys left out). */
export function heroVoidConfigJson(c: HeroVoidConfig = cfg): string {
  const ship: Partial<HeroVoidConfig> = { ...c };
  delete ship.previewDamage;
  delete ship.previewParts;
  return JSON.stringify(ship, null, 2);
}

// ─── the preview speed (DEV only, never saved) ─────────────────────────────────────────────────────────────────

export const HERO_VOID_SPEEDS = [1, 0.5, 0.25] as const;
export type HeroVoidSpeed = (typeof HERO_VOID_SPEEDS)[number];
let speed: HeroVoidSpeed = 1;
/** The tuner's slow motion. Always 1 in production. */
export function heroVoidPreviewSpeed(): HeroVoidSpeed { return import.meta.env.DEV ? speed : 1; }
export function setHeroVoidPreviewSpeed(s: HeroVoidSpeed): void { speed = s; }

// ─── the pure plan ─────────────────────────────────────────────────────────────────────────────────────────────

/** One tier's dials, read out of the config. */
export function voidTierDials(tier: TierNum, c: HeroVoidConfig = cfg): Record<VoidTierSuffix, number> {
  return Object.fromEntries(VOID_TIER_SUFFIXES.map((s) => [s, c[`t${tier}${s}`]])) as Record<VoidTierSuffix, number>;
}

/** The reference distance the per-tier flight times are tuned at (a 1080p board, corner to corner). */
export const VOID_REF_DISTANCE = 1600;

/** Ribbon flight for a distance: the tier's time, scaled gently by the distance (a sandbox box stays readable). */
export function voidFlightMs(distance: number, tierMs: number): number {
  const d = Number.isFinite(distance) && distance > 0 ? distance : VOID_REF_DISTANCE;
  return Math.round(tierMs * clamp(Math.sqrt(d / VOID_REF_DISTANCE), 0.62, 1.15));
}

/**
 * The fan of a volley, in LAUNCH order: outer ribbons first, the centre one last (the volley closes in, and the last
 * to land, THE impact, is the biggest and the straightest). Signed slots: 0 = the centre line.
 */
export function fanSlots(n: number): number[] {
  if (n <= 1) return [0];
  if (n === 2) return [-1, 1];
  const out: number[] = [];
  const half = Math.floor(n / 2);
  for (let k = half; k >= 1; k--) { out.push(-k); out.push(k); }
  if (n % 2 === 1) out.push(0);
  return out.slice(0, n);
}

export interface VoidRibbonPlan {
  launchAt: number;
  flightMs: number;
  arriveAt: number;
  /** How high the lob rises (a fraction of the distance, toward the top of the screen). */
  lift: number;
  /** How far the arc swings off to one side of the line (a fraction of the distance; signed). */
  side: number;
  /** Size multiplier (the last is the biggest). */
  size: number;
}

export interface VoidPlanInput extends AttackTierContext {
  /** When the style's own attack starts: the end of the shared damage formation (`formationPlan().endAt`). */
  leadIn?: number;
  /** THE blow, as the engine decided it. */
  total: number;
  /** Screen px between the attacker's and the defender's centres. */
  distance: number;
  reduced?: boolean;
}

export interface VoidPlan {
  reduced: boolean;
  tier: TierNum;
  /** 0..1 across the tiers (I = 0, IV = 1). */
  k: number;
  total: number;
  /** The charge starts: the total dives into the hero, the sigil opens. */
  chargeAt: number;
  absorbEnd: number;
  /** The first ribbon leaves. */
  fireAt: number;
  ribbons: VoidRibbonPlan[];
  /** Tier IV: the ribbons swirl over the target, converge and explode. */
  swirl: boolean;
  /** Tier IV: the first ribbon joins the vortex (else the impact). */
  swirlAt: number;
  /** Tier IV: the vortex collapses inward (else the impact). */
  convergeAt: number;
  /** Ribbons that land BEFORE the impact (non-swirl), sequence ms: the rhythm ticks. */
  hits: number[];
  /** THE consequence beat: the last ribbon lands (I-III) or the vortex explodes (IV). */
  impactAt: number;
  /** Aftershocks around the target (IV). */
  booms: number[];
  /**
   * THE KNOCKOUT VARIANT ("Tier V"; inherited from Arcana and DORMANT until the Void has one): the Huge vortex, remixed. One EXTRA PULSE of the vortex
   * (a prismatic throb, `koPulseAt`) before it collapses (the collapse and the explosion move back by `VOID_KO.pulseMs`),
   * the Ancient prism on the explosion, a bigger shake, a slow-mo dip (`dip`) and a KO sting. False / null otherwise.
   */
  ko: boolean;
  koPulseAt: number | null;
  dip: KoDip | null;
  endAt: number;
  width: number;
  shakePx: number;
  zoom: number;
  punch: number;
  motes: number;
  burst: number;
  dim: number;
}

/** The whole Void, in base ms (divide by the playback speed for real time). Pure and deterministic. */
export function voidPlan(input: VoidPlanInput, c: HeroVoidConfig = cfg): VoidPlan {
  const total = Math.max(0, Math.round(input.total));
  const tier = attackTier(total, input, c); // a knockout always plays Tier IV (heroAttack/tiers.ts)
  const T = voidTierDials(tier, c);
  const k = (tier - 1) / 3;

  if (input.reduced) {
    const r = reducedAttackTimeline(input.leadIn ?? 0, c.reducedFadeMs);
    const { impactAt } = r;
    return {
      reduced: true, tier, k, total,
      chargeAt: impactAt, absorbEnd: impactAt, fireAt: impactAt, ribbons: [], swirl: false, swirlAt: impactAt, convergeAt: impactAt,
      hits: [], impactAt, booms: [], ko: false, koPulseAt: null, dip: null, endAt: r.endAt, width: 0, shakePx: 0, zoom: 0, punch: 0, motes: 0, burst: 0, dim: 0,
    };
  }

  // The shared damage formation plays first; the style's own attack starts when it ends.
  const chargeAt = Math.max(0, input.leadIn ?? 0);
  const absorbEnd = chargeAt + c.absorbMs;
  const fireAt = chargeAt + Math.max(T.ChargeMs, c.absorbMs);
  const swirl = T.Swirl >= 1;
  const count = clamp(Math.round(T.Ribbons), 1, VOID_CAPS.ribbons);
  const flight = voidFlightMs(input.distance, T.FlightMs);
  const slots = fanSlots(count);
  const maxSlot = Math.max(1, ...slots.map((s) => Math.abs(s)));
  const ribbons: VoidRibbonPlan[] = slots.map((slot, i) => {
    const launchAt = fireAt + i * T.LaunchStaggerMs;
    // Two ribbons read as a PAIR: one lobbed high and swung wide one way, one lower and swung the other way. A volley
    // fans out evenly either side of the line, the outer arcs a touch lower (one lobbed spray, not a scatter).
    const lift = count === 2 ? T.ArcHeight * (slot < 0 ? 1.15 : 0.55) : T.ArcHeight * (1 - 0.1 * (Math.abs(slot) / maxSlot));
    const side = count === 2 ? slot * T.Fan : (slot / maxSlot) * T.Fan;
    const last = i === count - 1;
    // Outer ribbons travel a longer arc: a hair more time, so the rhythm stays even and the centre lands last.
    const fl = Math.round(flight * (1 + 0.06 * Math.abs(slot)));
    return { launchAt, flightMs: fl, arriveAt: launchAt + fl, lift, side, size: last ? 1.12 : count > 2 ? 0.86 : 1 };
  });
  // Keep the launch order's rhythm on arrival: each lands at least `gap` after the one before (III's barrage).
  const gap = count > 2 && !swirl ? Math.max(60, T.LaunchStaggerMs * 0.8) : 0;
  for (let i = 1; i < ribbons.length; i++) {
    const r = ribbons[i]!, prev = ribbons[i - 1]!;
    if (gap && r.arriveAt < prev.arriveAt + gap) { r.flightMs += prev.arriveAt + gap - r.arriveAt; r.arriveAt = r.launchAt + r.flightMs; }
  }
  const firstIn = Math.min(...ribbons.map((r) => r.arriveAt));
  const lastIn = Math.max(...ribbons.map((r) => r.arriveAt));
  const swirlAt = swirl ? firstIn : lastIn;
  const ko = isKnockoutVariant(input);
  // Tier V: the vortex throbs once more where it would have collapsed; the collapse waits for the pulse.
  const koPulseAt = ko && swirl ? Math.max(swirlAt + c.swirlMs, lastIn + 260) : null;
  const convergeAt = swirl ? Math.max(swirlAt + c.swirlMs, lastIn + 260) + (koPulseAt !== null ? VOID_KO.pulseMs : 0) : lastIn;
  const impactAt = swirl ? convergeAt + c.convergeMs : lastIn;
  const hits = swirl ? [] : ribbons.map((r) => r.arriveAt).filter((at) => at < impactAt).sort((a, b) => a - b);
  const booms = swirl ? [impactAt + 140, impactAt + 270] : [];
  const lastBeat = Math.max(
    impactAt + 160,
    booms.length ? booms[booms.length - 1]! + 120 : 0,
    impactAt + c.zoomOutMs * 0.8,
    swirl ? impactAt + 440 : 0,
  );
  const endAt = lastBeat + T.SettleMs;

  return {
    reduced: false, tier, k, total, chargeAt, absorbEnd, fireAt,
    ribbons, swirl, swirlAt, convergeAt, hits, impactAt, booms, endAt,
    ko, koPulseAt, dip: ko ? { at: impactAt, lo: KO_DIP.lo, ms: KO_DIP.ms } : null,
    width: T.RibbonWidth,
    shakePx: clamp(T.Shake * (ko ? KO_SHAKE : 1), 0, VOID_CAPS.shakePx * (ko ? KO_SHAKE : 1)),
    zoom: clamp(T.Zoom, 0, VOID_CAPS.zoom),
    punch: T.Punch,
    motes: Math.round(clamp(T.Motes, 0, VOID_CAPS.motes)),
    burst: T.Burst,
    dim: T.Dim,
  };
}

/** The Knockout variant's own numbers (fixed, not tuned: a small remix of the tuned Huge). */
export const VOID_KO = { pulseMs: 300 } as const;

export type VoidCueKind = 'charge' | 'fire' | 'hit' | 'orbit' | 'swirl' | 'koPulse' | 'converge' | 'impact' | 'boom' | 'end';
export interface VoidCue { at: number; kind: VoidCueKind; i: number }

/** Every beat the runner fires, in time order (ties keep this declaration order, so a hit precedes the impact). */
export function voidCues(p: VoidPlan): VoidCue[] {
  const out: VoidCue[] = [];
  if (!p.reduced) {
    out.push({ at: p.chargeAt, kind: 'charge', i: 0 });
    p.ribbons.forEach((r, i) => out.push({ at: r.launchAt, kind: 'fire', i }));
    if (p.swirl) {
      p.ribbons.forEach((r, i) => out.push({ at: r.arriveAt, kind: 'orbit', i }));
      out.push({ at: p.swirlAt, kind: 'swirl', i: 0 });
      if (p.koPulseAt !== null) out.push({ at: p.koPulseAt, kind: 'koPulse', i: 0 });
      out.push({ at: p.convergeAt, kind: 'converge', i: 0 });
    } else {
      // Every ribbon but the last lands as a tick; the last one IS the impact.
      p.ribbons.forEach((r, i) => { if (i < p.ribbons.length - 1) out.push({ at: r.arriveAt, kind: 'hit', i }); });
    }
  }
  out.push({ at: p.impactAt, kind: 'impact', i: 0 });
  p.booms.forEach((at, i) => out.push({ at, kind: 'boom', i }));
  out.push({ at: p.endAt, kind: 'end', i: 0 });
  const order: Record<VoidCueKind, number> = {
    charge: 4, fire: 5, hit: 6, orbit: 7, swirl: 8, koPulse: 8.5, converge: 9, impact: 10, boom: 11, end: 12,
  };
  return out.map((q, idx) => ({ q, idx })).sort((a, b) => a.q.at - b.q.at || order[a.q.kind] - order[b.q.kind] || a.idx - b.idx).map((x) => x.q);
}

// ─── the ribbon paths (pure) ───────────────────────────────────────────────────────────────────────────────────

/** A lob: a cubic from the hero to the target, bowed off the line. */
export interface Lob { a: Pt; c1: Pt; c2: Pt; b: Pt }

/**
 * The vortex a Tier IV ribbon joins: a tilted ellipse over the struck hero that tightens (radius `r0` down to `r1`)
 * and spins up (`w0` to `w1` rad/ms) between `start` and `end`, then collapses into the centre over `converge` ms.
 * `start` / `end` are ms after THIS ribbon's launch at which the RING (shared by every ribbon) forms and collapses, so
 * every ribbon rides the same spin; a ribbon joins it when its lob lands. `base` is this ribbon's slot angle; `dir`
 * the spin (1 = clockwise on screen).
 */
export interface Vortex { cx: number; cy: number; r0: number; r1: number; tilt: number; base: number; dir: 1 | -1; w0: number; w1: number; start: number; end: number; converge: number }

/** A ribbon's whole flight: the lob, then (Tier IV) the vortex. Times are ms after its launch. */
export interface RibbonMotion { lob: Lob; flightMs: number; vortex: Vortex | null }

const cub = (a: number, b: number, c: number, d: number, t: number): number => {
  const m = 1 - t;
  return m * m * m * a + 3 * m * m * t * b + 3 * m * t * t * c + t * t * t * d;
};

/** A point on the lob at curve parameter `e` (0..1). */
export function lobPoint(l: Lob, e: number): Pt {
  return { x: cub(l.a.x, l.c1.x, l.c2.x, l.b.x, e), y: cub(l.a.y, l.c1.y, l.c2.y, l.b.y, e) };
}

/** The ribbon's progress along its lob: it leaves with pace and still ACCELERATES into the target (weight). */
export const lobEase = (u: number): number => { const t = Math.min(1, Math.max(0, Number.isFinite(u) ? u : 0)); return 0.62 * t + 0.38 * t * t; };

/** The side normal of a line (a fixed turn of its direction), so a signed `side` always swings the same way. */
export function sideNormal(a: Pt, b: Pt): Pt {
  const dx = b.x - a.x, dy = b.y - a.y;
  const d = Math.hypot(dx, dy) || 1;
  return { x: -dy / d, y: dx / d };
}

/**
 * A LOB from `a` to `b`: it rises toward the top of the screen by `lift` x the distance (whichever way the target
 * lies, so it always reads as a thrown arc that comes DOWN onto the target, never a sideways bolt), swung off to one
 * side by `side` x the distance. It leaves the hero steeply and dives into the target. The controls never rise above
 * `ceilY` (the top of the screen), so a lob at a hero near the top edge flattens instead of leaving the frame.
 * `tail`, when given, is the direction it should be moving as it arrives (the vortex's tangent), so a ribbon slides
 * into its orbit instead of kinking.
 */
export function lobPath(a: Pt, b: Pt, lift: number, side = 0, tail: Pt | null = null, ceilY = Number.NEGATIVE_INFINITY): Lob {
  const dx = b.x - a.x, dy = b.y - a.y;
  const d = Math.hypot(dx, dy) || 1;
  const u = { x: dx / d, y: dy / d };
  const n = sideNormal(a, b);
  const c1 = { x: a.x + u.x * d * 0.2 + n.x * side * d * 0.9, y: Math.max(ceilY, a.y + u.y * d * 0.2 - lift * d * 1.25 + n.y * side * d * 0.9) };
  const c2 = tail
    ? { x: b.x - tail.x * d * 0.3, y: Math.max(ceilY, b.y - tail.y * d * 0.3 - lift * d * 0.35) }
    : { x: b.x - u.x * d * 0.12 + n.x * side * d * 0.85, y: Math.max(ceilY, b.y - u.y * d * 0.12 - lift * d * 0.85 + n.y * side * d * 0.85) };
  return { a: { ...a }, c1, c2, b: { ...b } };
}

/** The vortex's accumulated spin at `tau` ms into it: the speed ramps linearly from `w0` to `w1` over its length. */
export function vortexPhase(v: Vortex, tau: number): number {
  const S = Math.max(1, v.end - v.start);
  const t = Math.max(0, tau);
  if (t <= S) return v.w0 * t + ((v.w1 - v.w0) * t * t) / (2 * S);
  return v.w0 * S + ((v.w1 - v.w0) * S) / 2 + v.w1 * (t - S);
}

/** A point on the vortex at `tau` ms into it (the radius tightens as it spins up). */
export function vortexPoint(v: Vortex, tau: number): Pt {
  const S = Math.max(1, v.end - v.start);
  const r = v.r0 + (v.r1 - v.r0) * easeInOutSine(tau / S);
  const th = v.base + v.dir * vortexPhase(v, tau);
  return { x: v.cx + Math.cos(th) * r, y: v.cy + Math.sin(th) * r * v.tilt };
}

/** Where a ribbon is `t` ms after its launch. Pure: the scene draws its trail by sampling this back in time. */
export function ribbonPos(m: RibbonMotion, t: number): Pt {
  const v = m.vortex;
  if (!v || t <= m.flightMs) {
    if (t <= 0) return { ...m.lob.a };
    if (t >= m.flightMs) return { ...m.lob.b };
    return lobPoint(m.lob, lobEase(t / m.flightMs));
  }
  // In the vortex: the lob delivered it onto its slot on the ring, and it rides round with the ring.
  const p = vortexPoint(v, Math.min(t, v.end) - v.start);
  if (t <= v.end) return p;
  // THE CONVERGE: from wherever it is on the ring, pulled into the centre (ease in: it snaps shut at the end).
  const u = Math.min(1, (t - v.end) / Math.max(1, v.converge));
  const e = u * u * u;
  return { x: p.x + (v.cx - p.x) * e, y: p.y + (v.cy - p.y) * e };
}

/**
 * Every ribbon's whole flight, from the plan and the two heroes. Tier IV aims each ribbon at its own slot on the
 * vortex (evenly spaced when the vortex collapses) and brings it in along the spin. Pure, so a replay flies the same
 * paths and the tests can check them.
 */
export function ribbonMotions(p: VoidPlan, a: Pt, d: Pt, radius: number, c: HeroVoidConfig = cfg, ceilY = Number.NEGATIVE_INFINITY): RibbonMotion[] {
  if (p.reduced) return [];
  const n = p.ribbons.length;
  const dir: 1 | -1 = a.x <= d.x ? 1 : -1;
  const r0 = radius * c.swirlRadius;
  const r1 = r0 * (1 - c.swirlTighten);
  const w0 = (c.swirlSpeed0 * Math.PI * 2) / 1000, w1 = (c.swirlSpeed1 * Math.PI * 2) / 1000;
  // Slots start at the side the volley comes in from, so the first ribbon slides straight onto the ring.
  const inAng = Math.atan2(a.y - d.y, a.x - d.x);
  return p.ribbons.map((r, i) => {
    if (!p.swirl) return { lob: lobPath(a, d, r.lift, r.side, null, ceilY), flightMs: r.flightMs, vortex: null };
    const base = inAng + (i / n) * Math.PI * 2;
    // The RING has been spinning since the first ribbon joined; this one joins `joinTau` ms later.
    const joinTau = r.arriveAt - p.swirlAt;
    const v: Vortex = {
      cx: d.x, cy: d.y, r0, r1, tilt: c.swirlTilt, base, dir, w0, w1,
      start: r.flightMs - joinTau, end: p.convergeAt - r.launchAt, converge: p.impactAt - p.convergeAt,
    };
    // Aim the lob at where this slot is on the ring the moment it joins, arriving along the spin.
    const at = vortexPoint(v, joinTau);
    const th = v.base + v.dir * vortexPhase(v, joinTau);
    const tan = { x: -Math.sin(th) * v.dir, y: Math.cos(th) * v.tilt * v.dir };
    const tl = Math.hypot(tan.x, tan.y) || 1;
    const lob = lobPath(a, at, r.lift, r.side, { x: tan.x / tl, y: tan.y / tl }, ceilY);
    return { lob, flightMs: r.flightMs, vortex: v };
  });
}

/** The direction the LAST ribbon is travelling as it lands (the impact's shake and spray follow it). Unit. */
export function arrivalDir(m: RibbonMotion | undefined, a: Pt, d: Pt): Pt {
  const from = m ? m.lob.c2 : a;
  const dx = d.x - from.x, dy = d.y - from.y;
  const l = Math.hypot(dx, dy);
  if (l < 1e-6) { const L = Math.hypot(d.x - a.x, d.y - a.y) || 1; return { x: (d.x - a.x) / L, y: (d.y - a.y) / L }; }
  return { x: dx / l, y: dy / l };
}

// ─── the camera (pure) ─────────────────────────────────────────────────────────────────────────────────────────

const springAt = (ms: number, hz: number, tau: number): number => (ms < 0 ? 0 : Math.exp(-ms / tau) * Math.cos(2 * Math.PI * hz * (ms / 1000)));

/**
 * The camera at sequence time `t` (px in the space the points are in). A push in on the hero through the charge; a
 * small recoil kick on each launch; a directional kick ALONG the landing ribbon on each barrage tick; on THE impact a
 * punch in and a directional shake along the last ribbon. Tier IV
 * instead builds: the view pushes in on the vortex as it tightens, a faint tremor grows, and the explosion punches in
 * hardest with a shake that rings both ways. Deterministic (sines and springs): a replay moves identically. Pure.
 */
export function voidCameraAt(p: VoidPlan, c: HeroVoidConfig, t: number, dir: Pt = { x: 1, y: 0 }): { zoom: number; x: number; y: number } {
  if (p.reduced) return { zoom: 1, x: 0, y: 0 };
  let z = 0;
  const sine = (u: number): number => easeInOutSine(u);
  if (t >= p.chargeAt && t < p.impactAt) {
    z += p.zoom * sine((t - p.chargeAt) / Math.max(1, p.fireAt - p.chargeAt));
    if (p.swirl && t >= p.swirlAt) z += p.zoom * 0.9 * sine((t - p.swirlAt) / Math.max(1, p.impactAt - p.swirlAt));
  } else if (t >= p.impactAt) {
    const since = t - p.impactAt;
    z += (p.zoom * (p.swirl ? 1.9 : 1) + p.punch) * Math.exp(-since / Math.max(1, c.zoomOutMs / 4));
  }
  const perp = { x: -dir.y, y: dir.x };
  let x = 0, y = 0;
  const kick = (at: number, amp: number, tau: number, hz: number, v: Pt): void => {
    const age = t - at;
    if (age < 0) return;
    const s = springAt(age, hz, tau);
    const across = amp * 0.2 * Math.sin(age * 0.09) * Math.exp(-age / tau);
    x += v.x * amp * s + -v.y * across;
    y += v.y * amp * s + v.x * across;
  };
  p.ribbons.forEach((r) => kick(r.launchAt, -p.shakePx * 0.12, 45, 14, dir));
  p.hits.forEach((at, i) => kick(at, p.shakePx * (0.3 + 0.05 * i), 45, 17, dir));
  if (p.swirl) {
    // The vortex builds a tremor (both axes, growing), then the explosion rings both ways.
    if (t >= p.swirlAt && t < p.impactAt) {
      const u = (t - p.swirlAt) / Math.max(1, p.impactAt - p.swirlAt);
      const a = p.shakePx * 0.16 * u * u;
      x += a * Math.sin(t * 0.13);
      y += a * Math.sin(t * 0.17 + 1.3);
    }
    const age = t - p.impactAt;
    if (age >= 0) {
      const env = Math.exp(-age / Math.max(1, c.shakeMs / 4));
      x += p.shakePx * 0.8 * env * Math.sin(age * 0.105 + 0.5);
      y += p.shakePx * env * Math.cos(age * 0.093);
    }
    p.booms.forEach((at, i) => kick(at, p.shakePx * 0.3, 45, 18, i % 2 ? perp : dir));
    // Tier V: the extra pulse thumps the view (a short punch in and a kick up).
    if (p.koPulseAt !== null) {
      kick(p.koPulseAt, p.shakePx * 0.35, 50, 15, { x: 0, y: -1 });
      if (t >= p.koPulseAt) z += p.punch * 0.5 * Math.exp(-(t - p.koPulseAt) / 90);
    }
  } else {
    kick(p.impactAt, p.shakePx, Math.max(1, c.shakeMs / 4), 16, dir);
  }
  return { zoom: 1 + Math.max(0, z), x, y };
}

/**
 * Where the camera anchors: the ATTACKER through the charge, following the volley in flight, and the DEFENDER from
 * the impact on (Tier IV: from the moment the vortex forms). A zoom anchored on a point keeps that point still. Pure.
 */
export function voidCameraFocus(p: VoidPlan, t: number, a: Pt, d: Pt): Pt {
  const settle = p.swirl ? p.swirlAt : p.impactAt;
  if (t <= p.fireAt) return a;
  if (t >= settle) return d;
  const u = (t - p.fireAt) / Math.max(1, settle - p.fireAt);
  const e = lobEase(u);
  return { x: a.x + (d.x - a.x) * e, y: a.y + (d.y - a.y) * e };
}
