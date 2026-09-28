/**
 * THE ARCANA HERO ATTACK: its tuned values, its pure timeline, the pure ribbon paths and the pure camera.
 *
 * Owner 2026-09-28: "let's branch out and make one more attack animation, same setup as the last 2, but let's make
 * like a magic one called arcana. tier 1 attack will be s clean pixi ribbon arc'd and lobbed from hero location. tier 2
 * attack will be 2 of those. tier 3 attack will be barrage of 5 of those. tier 4 attack will be a swirl of them over the
 * opponent hero frame and then they explode and ribbon/pixi blast outward".
 *
 * THE BEATS (base ms before the playback speed):
 *  1. THE DAMAGE FORMATION (shared by every style, `../heroAttack/damageFormation.ts`, owner ask 2026-09-28): minion
 *     tiers pulse left to right and merge, the hero tier joins, the full blow, the cap. Its end is this style's start.
 *  2. CHARGE. The total dives into the attacking hero; an arcane sigil opens under the portrait and spins up, light
 *     gathers, a riser climbs; the view pushes in on the hero.
 *  3. LOB. Clean magic RIBBONS (a tapering strip: a soft violet halo, an arcane glow, a violet body, a white-hot core and a
 *     thin cyan strand winding round it; an orb and a spinning sigil at the head) are LOBBED from the hero on high
 *     arcs: I one; II two (different heights, opposite sides); III a barrage of five, fanned, landing in rhythm.
 *  4. IMPACT. Each ribbon that lands before the last is a small arcane tick (a sigil flash, a crisp ring, glitter). The
 *     LAST one is THE impact: the big `-N`, a sigil flare, rings, spikes and glitter. The consequence
 *     (the damage, Armor, Resolve) lands ONCE, there.
 *  IV. SWIRL. The ribbons do not strike: they arc in and join an orbiting vortex over the struck hero's frame (a tilted
 *     ellipse, so it reads as a ring of light circling the portrait), which TIGHTENS and SPEEDS UP under a rising tone
 *     while a sigil and a core of light build beneath it. Then they CONVERGE and EXPLODE: ribbons flung outward, a
 *     shockwave, a sigil flare, sparkles. The damage lands on the explosion.
 *
 * TIERS are the shared, owner-approved thresholds (I 1-5, II 6-11, III 12-19, IV 20+). Brisk at Tier I (~2 s), about
 * 4 s at Tier IV. Reduced motion: no flight, ribbons, shake or zoom; the numbers fade and the blow lands.
 *
 * Tuner convention (the Blast's): localStorage in DEV only, values clamped on write and on load; production always
 * plays DEFAULTS. The preview speed is how you are LOOKING and is never saved.
 */
import { clamp, easeInOutSine, hexToNum, type Pt } from '../heroAttack/easing';
import {
  HERO_ATTACK_TIER_THRESHOLDS, TIERS, reducedAttackTimeline, tierOf, type TierNum,
} from '../heroAttack/tiers';

export { TIERS, hexToNum, type TierNum };

/** The per-tier dials. A config key is `t1..t4` + one of these. */
export const ARCANA_TIER_SUFFIXES = [
  'ChargeMs', 'Ribbons', 'LaunchStaggerMs', 'FlightMs', 'ArcHeight', 'Fan', 'RibbonWidth', 'Swirl',
  'Shake', 'Zoom', 'Punch', 'Motes', 'Burst', 'SettleMs', 'Dim',
] as const;
export type ArcanaTierSuffix = (typeof ARCANA_TIER_SUFFIXES)[number];
type TierKey = `t${TierNum}${ArcanaTierSuffix}`;

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
  // Swirl (Tier IV)
  swirlRadius: number;
  swirlTilt: number;
  swirlMs: number;
  swirlSpeed0: number;
  swirlSpeed1: number;
  swirlTighten: number;
  convergeMs: number;
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
export type HeroArcanaConfig = GlobalConfig & Record<TierKey, number>;

export const HERO_ARCANA_COLOR_KEYS = ['colorCore', 'colorAccent', 'colorPlayer', 'colorFoe', 'colorShade'] as const;
export const HERO_ARCANA_CLIP_KEYS = [
  'sfxCastClip', 'sfxChargeClip', 'sfxLaunchClip', 'sfxShimmerClip', 'sfxHitClip',
  'sfxImpactClip', 'sfxChimeClip', 'sfxThumpClip', 'sfxImplodeClip', 'sfxExplodeClip', 'sfxBigClip', 'sfxBoomClip',
] as const;
type ColorKey = (typeof HERO_ARCANA_COLOR_KEYS)[number];
type ClipKey = (typeof HERO_ARCANA_CLIP_KEYS)[number];
export type HeroArcanaStrKey = ColorKey | ClipKey;
export type HeroArcanaNumKey = Exclude<keyof HeroArcanaConfig, HeroArcanaStrKey>;

/** Tier I .. IV per suffix: the escalation ladder. */
const TIER_DEFAULTS: Record<ArcanaTierSuffix, [number, number, number, number]> = {
  ChargeMs: [260, 340, 420, 420],
  Ribbons: [1, 2, 5, 6],
  LaunchStaggerMs: [0, 130, 100, 60],
  FlightMs: [560, 580, 590, 520],
  ArcHeight: [0.32, 0.32, 0.28, 0.2],
  Fan: [0, 0.18, 0.32, 0.14],
  RibbonWidth: [52, 52, 44, 38],
  Swirl: [0, 0, 0, 1],
  Shake: [5, 8, 12, 20],
  Zoom: [0.02, 0.03, 0.045, 0.07],
  Punch: [0.02, 0.028, 0.038, 0.06],
  Motes: [14, 20, 28, 46],
  Burst: [1, 1.15, 1.35, 1.9],
  SettleMs: [220, 300, 360, 280],
  Dim: [0, 0.18, 0.32, 0.5],
};

export const ARCANA_TIER_RANGES: Record<ArcanaTierSuffix, [number, number, number]> = {
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

const tierDefaults = Object.fromEntries(TIERS.flatMap((t) => ARCANA_TIER_SUFFIXES.map((s) => [`t${t}${s}`, TIER_DEFAULTS[s][t - 1]]))) as Record<TierKey, number>;

export const HERO_ARCANA_DEFAULTS: HeroArcanaConfig = {
  // The shared, owner-approved thresholds (6 / 12 / 20): the same blow steps Arcana up exactly where it steps Blast up.
  ...HERO_ATTACK_TIER_THRESHOLDS,
  absorbMs: 190,
  heroSwell: 0.08,
  recoilPx: 10,
  ribbonLength: 150,
  ribbonGlow: 2.3,
  ribbonCore: 0.46,
  ribbonShade: 0.55,
  ribbonTwist: 0.35,
  strand: 0.55,
  headSize: 1,
  sigilSize: 1,
  swirlRadius: 1.55,
  swirlTilt: 0.5,
  swirlMs: 700,
  swirlSpeed0: 1.1,
  swirlSpeed1: 3.4,
  swirlTighten: 0.45,
  convergeMs: 120,
  explodeSize: 1,
  explodeRibbons: 12,
  flashAlpha: 0.95,
  knockPx: 18,
  squash: 0.1,
  shakeMs: 340,
  zoomOutMs: 360,
  reducedFadeMs: 260,
  colorCore: '#ffffff',
  colorAccent: '#72f1ff',
  colorPlayer: '#a45bff',
  colorFoe: '#ff3fb0',
  colorShade: '#5a1fa8',
  sfxCastClip: 'castspell', sfxCastGain: 0.55, sfxCastRate: 1.05,
  sfxChargeClip: 'fx/oona-powerup', sfxChargeGain: 0.45, sfxChargeRate: 1.3,
  sfxLaunchClip: 'fx/djartmusic-christmas-sparkle-whoosh-1-275404', sfxLaunchGain: 0.55, sfxLaunchRate: 1.1,
  sfxShimmerClip: 'equipmentsheen', sfxShimmerGain: 0.3, sfxShimmerRate: 1.2,
  sfxHitClip: 'divineshieldbreak', sfxHitGain: 0.45, sfxHitRate: 1.3,
  sfxImpactClip: 'fx/blue-impact-hit', sfxImpactGain: 0.8, sfxImpactRate: 1.15,
  sfxChimeClip: 'prismaticpick', sfxChimeGain: 0.45, sfxChimeRate: 1.25,
  sfxThumpClip: 'smack2', sfxThumpGain: 0.42, sfxThumpRate: 0.9,
  sfxImplodeClip: 'runeselectimplosion', sfxImplodeGain: 0.7, sfxImplodeRate: 1,
  sfxExplodeClip: 'turnexplosion', sfxExplodeGain: 0.6, sfxExplodeRate: 1.18,
  sfxBigClip: 'crit', sfxBigGain: 0.4, sfxBigRate: 1.1,
  sfxBoomClip: 'fx/triple-impact', sfxBoomGain: 0.28, sfxBoomRate: 1.3,
  sfxSwirlGain: 0.32, sfxSwirlLowHz: 180, sfxSwirlHighHz: 880,
  sfxLaunchLenMs: 700,
  sfxImpactLenMs: 1100,
  sfxTailMix: 0.14,
  sfxDuck: 0.5,
  previewDamage: 12,
  previewParts: 4,
  ...tierDefaults,
};

const GLOBAL_RANGES: Record<Exclude<keyof GlobalConfig, HeroArcanaStrKey>, [number, number, number]> = {
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
  swirlRadius: [0.6, 3, 0.05],
  swirlTilt: [0.2, 1, 0.01],
  swirlMs: [200, 2000, 10],
  swirlSpeed0: [0.2, 6, 0.05],
  swirlSpeed1: [0.2, 8, 0.05],
  swirlTighten: [0, 0.9, 0.01],
  convergeMs: [40, 500, 5],
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
export const HERO_ARCANA_RANGES: Record<HeroArcanaNumKey, [number, number, number]> = {
  ...GLOBAL_RANGES,
  ...(Object.fromEntries(TIERS.flatMap((t) => ARCANA_TIER_SUFFIXES.map((s) => [`t${t}${s}`, ARCANA_TIER_RANGES[s]]))) as Record<TierKey, [number, number, number]>),
};

/** The hard ceilings a plan can never exceed, whatever the sliders say (so a 40 stays clean, not cluttered). */
export const ARCANA_CAPS = { ribbons: 8, explodeRibbons: 16, motes: 80, shakePx: 40, zoom: 0.14 } as const;

const HEX = /^#[0-9a-f]{6}$/i;
const isColorKey = (k: string): k is ColorKey => (HERO_ARCANA_COLOR_KEYS as readonly string[]).includes(k);
const isClipKey = (k: string): k is ClipKey => (HERO_ARCANA_CLIP_KEYS as readonly string[]).includes(k);

/** One value, made safe: numbers clamped into range (junk = the default), colours #rrggbb, clips a short string. */
export function clampHeroArcanaValue<K extends keyof HeroArcanaConfig>(key: K, value: unknown): HeroArcanaConfig[K] | undefined {
  if (!Object.prototype.hasOwnProperty.call(HERO_ARCANA_DEFAULTS, key)) return undefined;
  const def = HERO_ARCANA_DEFAULTS[key];
  if (isColorKey(key)) {
    if (typeof value !== 'string') return def;
    const v = value.trim();
    return (HEX.test(v) ? v.toLowerCase() : def) as HeroArcanaConfig[K];
  }
  if (isClipKey(key)) return (typeof value === 'string' ? value.trim().slice(0, 160) : def) as HeroArcanaConfig[K];
  const n = typeof value === 'number' ? value : Number(value);
  if (typeof value === 'boolean' || value === null || value === '' || !Number.isFinite(n)) return def;
  const [min, max] = HERO_ARCANA_RANGES[key as HeroArcanaNumKey];
  return Math.min(max, Math.max(min, n)) as HeroArcanaConfig[K];
}

/** A whole saved object, sanitised key by key over the defaults (junk and unknown keys dropped). */
export function sanitizeHeroArcanaConfig(saved: unknown): HeroArcanaConfig {
  const out: HeroArcanaConfig = { ...HERO_ARCANA_DEFAULTS };
  if (!saved || typeof saved !== 'object') return out;
  for (const [k, v] of Object.entries(saved as Record<string, unknown>)) {
    const safe = clampHeroArcanaValue(k as keyof HeroArcanaConfig, v);
    if (safe !== undefined) (out as unknown as Record<string, unknown>)[k] = safe;
  }
  return out;
}

const KEY = 'ascent.heroarcana.v1';

let cfg: HeroArcanaConfig = (() => {
  if (!import.meta.env.DEV || typeof localStorage === 'undefined') return { ...HERO_ARCANA_DEFAULTS };
  try { return sanitizeHeroArcanaConfig(JSON.parse(localStorage.getItem(KEY) ?? '{}')); } catch { return { ...HERO_ARCANA_DEFAULTS }; }
})();

export function getHeroArcanaConfig(): HeroArcanaConfig { return cfg; }

export function setHeroArcanaValue(key: keyof HeroArcanaConfig, value: number | string): void {
  const safe = clampHeroArcanaValue(key, value);
  if (safe === undefined) return;
  cfg = { ...cfg, [key]: safe };
  if (!import.meta.env.DEV) return;
  try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch { /* ignore */ }
}

export function resetHeroArcanaConfig(): void {
  cfg = { ...HERO_ARCANA_DEFAULTS };
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}

/** The tuned values as JSON for pasting back into DEFAULTS (the preview-only keys left out). */
export function heroArcanaConfigJson(c: HeroArcanaConfig = cfg): string {
  const ship: Partial<HeroArcanaConfig> = { ...c };
  delete ship.previewDamage;
  delete ship.previewParts;
  return JSON.stringify(ship, null, 2);
}

// ─── the preview speed (DEV only, never saved) ─────────────────────────────────────────────────────────────────

export const HERO_ARCANA_SPEEDS = [1, 0.5, 0.25] as const;
export type HeroArcanaSpeed = (typeof HERO_ARCANA_SPEEDS)[number];
let speed: HeroArcanaSpeed = 1;
/** The tuner's slow motion. Always 1 in production. */
export function heroArcanaPreviewSpeed(): HeroArcanaSpeed { return import.meta.env.DEV ? speed : 1; }
export function setHeroArcanaPreviewSpeed(s: HeroArcanaSpeed): void { speed = s; }

// ─── the pure plan ─────────────────────────────────────────────────────────────────────────────────────────────

/** One tier's dials, read out of the config. */
export function arcanaTierDials(tier: TierNum, c: HeroArcanaConfig = cfg): Record<ArcanaTierSuffix, number> {
  return Object.fromEntries(ARCANA_TIER_SUFFIXES.map((s) => [s, c[`t${tier}${s}`]])) as Record<ArcanaTierSuffix, number>;
}

/** The reference distance the per-tier flight times are tuned at (a 1080p board, corner to corner). */
export const ARCANA_REF_DISTANCE = 1600;

/** Ribbon flight for a distance: the tier's time, scaled gently by the distance (a sandbox box stays readable). */
export function arcanaFlightMs(distance: number, tierMs: number): number {
  const d = Number.isFinite(distance) && distance > 0 ? distance : ARCANA_REF_DISTANCE;
  return Math.round(tierMs * clamp(Math.sqrt(d / ARCANA_REF_DISTANCE), 0.62, 1.15));
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

export interface ArcanaRibbonPlan {
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

export interface ArcanaPlanInput {
  /** When the style's own attack starts: the end of the shared damage formation (`formationPlan().endAt`). */
  leadIn?: number;
  /** THE blow, as the engine decided it. */
  total: number;
  /** Screen px between the attacker's and the defender's centres. */
  distance: number;
  reduced?: boolean;
}

export interface ArcanaPlan {
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
  ribbons: ArcanaRibbonPlan[];
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
  endAt: number;
  width: number;
  shakePx: number;
  zoom: number;
  punch: number;
  motes: number;
  burst: number;
  dim: number;
}

/** The whole Arcana, in base ms (divide by the playback speed for real time). Pure and deterministic. */
export function arcanaPlan(input: ArcanaPlanInput, c: HeroArcanaConfig = cfg): ArcanaPlan {
  const total = Math.max(0, Math.round(input.total));
  const tier = tierOf(total, c);
  const T = arcanaTierDials(tier, c);
  const k = (tier - 1) / 3;

  if (input.reduced) {
    const r = reducedAttackTimeline(input.leadIn ?? 0, c.reducedFadeMs);
    const { impactAt } = r;
    return {
      reduced: true, tier, k, total,
      chargeAt: impactAt, absorbEnd: impactAt, fireAt: impactAt, ribbons: [], swirl: false, swirlAt: impactAt, convergeAt: impactAt,
      hits: [], impactAt, booms: [], endAt: r.endAt, width: 0, shakePx: 0, zoom: 0, punch: 0, motes: 0, burst: 0, dim: 0,
    };
  }

  // The shared damage formation plays first; the style's own attack starts when it ends.
  const chargeAt = Math.max(0, input.leadIn ?? 0);
  const absorbEnd = chargeAt + c.absorbMs;
  const fireAt = chargeAt + Math.max(T.ChargeMs, c.absorbMs);
  const swirl = T.Swirl >= 1;
  const count = clamp(Math.round(T.Ribbons), 1, ARCANA_CAPS.ribbons);
  const flight = arcanaFlightMs(input.distance, T.FlightMs);
  const slots = fanSlots(count);
  const maxSlot = Math.max(1, ...slots.map((s) => Math.abs(s)));
  const ribbons: ArcanaRibbonPlan[] = slots.map((slot, i) => {
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
  const convergeAt = swirl ? Math.max(swirlAt + c.swirlMs, lastIn + 260) : lastIn;
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
    width: T.RibbonWidth,
    shakePx: clamp(T.Shake, 0, ARCANA_CAPS.shakePx),
    zoom: clamp(T.Zoom, 0, ARCANA_CAPS.zoom),
    punch: T.Punch,
    motes: Math.round(clamp(T.Motes, 0, ARCANA_CAPS.motes)),
    burst: T.Burst,
    dim: T.Dim,
  };
}

export type ArcanaCueKind = 'charge' | 'fire' | 'hit' | 'orbit' | 'swirl' | 'converge' | 'impact' | 'boom' | 'end';
export interface ArcanaCue { at: number; kind: ArcanaCueKind; i: number }

/** Every beat the runner fires, in time order (ties keep this declaration order, so a hit precedes the impact). */
export function arcanaCues(p: ArcanaPlan): ArcanaCue[] {
  const out: ArcanaCue[] = [];
  if (!p.reduced) {
    out.push({ at: p.chargeAt, kind: 'charge', i: 0 });
    p.ribbons.forEach((r, i) => out.push({ at: r.launchAt, kind: 'fire', i }));
    if (p.swirl) {
      p.ribbons.forEach((r, i) => out.push({ at: r.arriveAt, kind: 'orbit', i }));
      out.push({ at: p.swirlAt, kind: 'swirl', i: 0 });
      out.push({ at: p.convergeAt, kind: 'converge', i: 0 });
    } else {
      // Every ribbon but the last lands as a tick; the last one IS the impact.
      p.ribbons.forEach((r, i) => { if (i < p.ribbons.length - 1) out.push({ at: r.arriveAt, kind: 'hit', i }); });
    }
  }
  out.push({ at: p.impactAt, kind: 'impact', i: 0 });
  p.booms.forEach((at, i) => out.push({ at, kind: 'boom', i }));
  out.push({ at: p.endAt, kind: 'end', i: 0 });
  const order: Record<ArcanaCueKind, number> = {
    charge: 4, fire: 5, hit: 6, orbit: 7, swirl: 8, converge: 9, impact: 10, boom: 11, end: 12,
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
export function ribbonMotions(p: ArcanaPlan, a: Pt, d: Pt, radius: number, c: HeroArcanaConfig = cfg, ceilY = Number.NEGATIVE_INFINITY): RibbonMotion[] {
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
export function arcanaCameraAt(p: ArcanaPlan, c: HeroArcanaConfig, t: number, dir: Pt = { x: 1, y: 0 }): { zoom: number; x: number; y: number } {
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
  } else {
    kick(p.impactAt, p.shakePx, Math.max(1, c.shakeMs / 4), 16, dir);
  }
  return { zoom: 1 + Math.max(0, z), x, y };
}

/**
 * Where the camera anchors: the ATTACKER through the charge, following the volley in flight, and the DEFENDER from
 * the impact on (Tier IV: from the moment the vortex forms). A zoom anchored on a point keeps that point still. Pure.
 */
export function arcanaCameraFocus(p: ArcanaPlan, t: number, a: Pt, d: Pt): Pt {
  const settle = p.swirl ? p.swirlAt : p.impactAt;
  if (t <= p.fireAt) return a;
  if (t >= settle) return d;
  const u = (t - p.fireAt) / Math.max(1, settle - p.fireAt);
  const e = lobEase(u);
  return { x: a.x + (d.x - a.x) * e, y: a.y + (d.y - a.y) * e };
}
