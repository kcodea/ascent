/**
 * THE FROST HERO ATTACK: its tuned values, its pure timeline, the pure icicle and nova paths and the pure camera.
 *
 * Owner 2026-09-28: "branch off and create an ice/freeze blast one. icicles and then a frost nova blast that blasts
 * across the screen from the attacker to the target".
 *
 * THE BEATS (base ms before the playback speed):
 *  1. THE DAMAGE FORMATION (shared by every style, `../heroAttack/damageFormation.ts`). Its end is this style's start.
 *  2. CRYSTALLISE. The total dives into the attacking hero; a frost rune opens under the portrait, a cold mist gathers,
 *     and ICICLES grow out of the air round the portrait rim one by one (a faceted, translucent ice spear: a white
 *     specular edge, a pale cyan body, a deep glacier-blue core and a frosty rim), each aimed at the struck hero.
 *  3. LAUNCH. Each icicle draws back a hair, then fires FAST on a near-straight line, trailing shimmering ice dust:
 *     I one; II two (from either side of the hero); III a volley of five, fanned, landing in rhythm.
 *  4. SHATTER. Each icicle that lands before the last is a tick: it shatters into glittering shards and a snow puff,
 *     and frost CREEPS over the struck portrait's edge. The LAST one is THE impact (the big `-N`). The consequence
 *     (the damage, Armor, Resolve) lands ONCE, there.
 *  IV. THE FROST NOVA. Four icicles form and fire (every one a tick). Then the hero gathers the cold (a howl rises,
 *     snow spirals in) and releases a FROST NOVA: a wide rolling wave front of frost that blasts ACROSS THE SCREEN
 *     from the attacker to the target, swirling snow and ice crystals, a biting cold light on its leading edge, and a
 *     frozen ice sheet with frost ferns spreading along the path behind it. It hits the struck hero, the portrait is
 *     ENCASED in a flash of ice, and the ice SHATTERS outward. The damage lands on the shatter.
 *
 * The ICE freezes, the clock never does (owner 2026-09-28: no hit-stop or freeze frames, "it looks like lag"): the
 * encasement is ice holding still while the shared clock runs on.
 *
 * TIERS are the shared, owner-approved thresholds (I 1-5, II 6-11, III 12-19, IV 20+). Brisk at Tier I (about 1.3 s
 * after the formation), about 3 s at Tier IV. Reduced motion: no icicles, nova, shake or zoom; the numbers fade and
 * the blow lands.
 *
 * Tuner convention (the Blast's): localStorage in DEV only, values clamped on write and on load; production always
 * plays DEFAULTS. The preview speed is how you are LOOKING and is never saved.
 */
import { clamp, easeOutBack, easeOutCubic, easeInOutSine, hexToNum, type Pt } from '../heroAttack/easing';
import {
  HERO_ATTACK_TIER_THRESHOLDS, TIERS, reducedAttackTimeline, tierOf, type TierNum,
} from '../heroAttack/tiers';

export { TIERS, hexToNum, type TierNum };

/** The per-tier dials. A config key is `t1..t4` + one of these. */
export const FROST_TIER_SUFFIXES = [
  'FormMs', 'Icicles', 'LaunchStaggerMs', 'FlightMs', 'IcicleSize', 'Arc', 'Nova',
  'Shake', 'Zoom', 'Punch', 'Shards', 'Burst', 'Creep', 'SettleMs', 'Dim',
] as const;
export type FrostTierSuffix = (typeof FROST_TIER_SUFFIXES)[number];
type TierKey = `t${TierNum}${FrostTierSuffix}`;

interface GlobalConfig {
  // Tiers (the shared thresholds; DEV-tunable only)
  tier2At: number; tier3At: number; tier4At: number;
  // Crystallise
  absorbMs: number;
  heroSwell: number;
  recoilPx: number;
  growMs: number;
  formRadius: number;
  formSpread: number;
  // Icicles
  icicleLength: number;
  icicleThick: number;
  icicleGlow: number;
  icicleCore: number;
  pullMs: number;
  pullBackPx: number;
  trailMs: number;
  trailWidth: number;
  dust: number;
  // Shatter and frost creep
  shatterSize: number;
  snowPuffs: number;
  creepMs: number;
  creepFerns: number;
  creepReach: number;
  // The nova (Tier IV)
  novaWindupMs: number;
  novaMs: number;
  novaWidth: number;
  novaDepth: number;
  novaBulge: number;
  snowDensity: number;
  groundWidth: number;
  groundFerns: number;
  groundFadeMs: number;
  // The encasement and its shatter
  encaseMs: number;
  encaseSize: number;
  encaseShards: number;
  flashAlpha: number;
  // Camera and portraits
  knockPx: number;
  squash: number;
  shakeMs: number;
  zoomOutMs: number;
  reducedFadeMs: number;
  // Colours
  colorCore: string;
  colorIce: string;
  colorDeep: string;
  colorPlayer: string;
  colorFoe: string;
  colorShade: string;
  // Sound: a clip, a gain and a pitch per cue ('' = silent)
  sfxFormClip: string; sfxFormGain: number; sfxFormRate: number;
  sfxChimeClip: string; sfxChimeGain: number; sfxChimeRate: number;
  sfxSheenClip: string; sfxSheenGain: number; sfxSheenRate: number;
  sfxLaunchClip: string; sfxLaunchGain: number; sfxLaunchRate: number;
  sfxDustClip: string; sfxDustGain: number; sfxDustRate: number;
  sfxHitClip: string; sfxHitGain: number; sfxHitRate: number;
  sfxShatterClip: string; sfxShatterGain: number; sfxShatterRate: number;
  sfxImpactClip: string; sfxImpactGain: number; sfxImpactRate: number;
  sfxThumpClip: string; sfxThumpGain: number; sfxThumpRate: number;
  sfxBigClip: string; sfxBigGain: number; sfxBigRate: number;
  sfxReleaseClip: string; sfxReleaseGain: number; sfxReleaseRate: number;
  sfxEncaseClip: string; sfxEncaseGain: number; sfxEncaseRate: number;
  sfxBurstClip: string; sfxBurstGain: number; sfxBurstRate: number;
  sfxBoomClip: string; sfxBoomGain: number; sfxBoomRate: number;
  sfxWindGain: number; sfxWindLowHz: number; sfxWindHighHz: number;
  sfxCrackleGain: number;
  sfxLaunchLenMs: number;
  sfxImpactLenMs: number;
  sfxTailMix: number;
  sfxDuck: number;
  // Preview only (the tuner's Play buttons). Never read by a real fight, and left out of Copy JSON.
  previewDamage: number;
  previewParts: number;
}
export type HeroFrostConfig = GlobalConfig & Record<TierKey, number>;

export const HERO_FROST_COLOR_KEYS = ['colorCore', 'colorIce', 'colorDeep', 'colorPlayer', 'colorFoe', 'colorShade'] as const;
export const HERO_FROST_CLIP_KEYS = [
  'sfxFormClip', 'sfxChimeClip', 'sfxSheenClip', 'sfxLaunchClip', 'sfxDustClip', 'sfxHitClip', 'sfxShatterClip',
  'sfxImpactClip', 'sfxThumpClip', 'sfxBigClip', 'sfxReleaseClip', 'sfxEncaseClip', 'sfxBurstClip', 'sfxBoomClip',
] as const;
type ColorKey = (typeof HERO_FROST_COLOR_KEYS)[number];
type ClipKey = (typeof HERO_FROST_CLIP_KEYS)[number];
export type HeroFrostStrKey = ColorKey | ClipKey;
export type HeroFrostNumKey = Exclude<keyof HeroFrostConfig, HeroFrostStrKey>;

/** Tier I .. IV per suffix: the escalation ladder. */
const TIER_DEFAULTS: Record<FrostTierSuffix, [number, number, number, number]> = {
  FormMs: [480, 540, 620, 560],
  Icicles: [1, 2, 5, 4],
  LaunchStaggerMs: [0, 150, 105, 95],
  FlightMs: [300, 300, 290, 280],
  IcicleSize: [1.05, 1, 0.86, 0.9],
  Arc: [0.05, 0.08, 0.1, 0.08],
  Nova: [0, 0, 0, 1],
  Shake: [5, 8, 12, 20],
  Zoom: [0.02, 0.03, 0.045, 0.07],
  Punch: [0.02, 0.028, 0.038, 0.06],
  Shards: [14, 18, 22, 40],
  Burst: [1, 1.15, 1.35, 1.9],
  Creep: [0.5, 0.65, 0.85, 1],
  SettleMs: [260, 320, 380, 340],
  Dim: [0, 0.18, 0.32, 0.5],
};

export const FROST_TIER_RANGES: Record<FrostTierSuffix, [number, number, number]> = {
  FormMs: [120, 1600, 10],
  Icicles: [1, 8, 1],
  LaunchStaggerMs: [0, 320, 5],
  FlightMs: [120, 1200, 10],
  IcicleSize: [0.3, 2.5, 0.01],
  Arc: [0, 0.5, 0.01],
  Nova: [0, 1, 1],
  Shake: [0, 40, 0.5],
  Zoom: [0, 0.14, 0.002],
  Punch: [0, 0.1, 0.001],
  Shards: [0, 60, 1],
  Burst: [0.3, 3, 0.05],
  Creep: [0, 1.5, 0.01],
  SettleMs: [0, 1600, 10],
  Dim: [0, 0.8, 0.01],
};

const tierDefaults = Object.fromEntries(TIERS.flatMap((t) => FROST_TIER_SUFFIXES.map((s) => [`t${t}${s}`, TIER_DEFAULTS[s][t - 1]]))) as Record<TierKey, number>;

export const HERO_FROST_DEFAULTS: HeroFrostConfig = {
  // The shared, owner-approved thresholds (6 / 12 / 20): the same blow steps Frost up exactly where it steps Blast up.
  ...HERO_ATTACK_TIER_THRESHOLDS,
  absorbMs: 190,
  heroSwell: 0.06,
  recoilPx: 9,
  growMs: 300,
  formRadius: 1.22,
  formSpread: 86,
  icicleLength: 150,
  icicleThick: 1,
  icicleGlow: 0.7,
  icicleCore: 0.8,
  pullMs: 120,
  pullBackPx: 16,
  trailMs: 120,
  trailWidth: 18,
  dust: 1,
  shatterSize: 1,
  snowPuffs: 1,
  creepMs: 460,
  creepFerns: 5,
  creepReach: 0.42,
  novaWindupMs: 400,
  novaMs: 640,
  novaWidth: 3.1,
  novaDepth: 1.05,
  novaBulge: 0.45,
  snowDensity: 1,
  groundWidth: 1.7,
  groundFerns: 18,
  groundFadeMs: 900,
  encaseMs: 300,
  encaseSize: 1.12,
  encaseShards: 34,
  flashAlpha: 0.9,
  knockPx: 18,
  squash: 0.1,
  shakeMs: 340,
  zoomOutMs: 360,
  reducedFadeMs: 260,
  colorCore: '#ffffff',
  colorIce: '#c4f1ff',
  colorDeep: '#2d6fd8',
  colorPlayer: '#5fd4ff',
  colorFoe: '#9b86ff',
  colorShade: '#34277e',
  sfxFormClip: 'freezetavern', sfxFormGain: 0.55, sfxFormRate: 1.05,
  sfxChimeClip: 'prismaticpick', sfxChimeGain: 0.3, sfxChimeRate: 1.4,
  sfxSheenClip: 'equipmentsheen', sfxSheenGain: 0.3, sfxSheenRate: 1.25,
  sfxLaunchClip: 'fx/metal-woosh', sfxLaunchGain: 0.45, sfxLaunchRate: 1.3,
  sfxDustClip: 'fx/djartmusic-christmas-sparkle-whoosh-1-275404', sfxDustGain: 0.22, sfxDustRate: 1.25,
  sfxHitClip: 'divineshieldbreak', sfxHitGain: 0.45, sfxHitRate: 1.35,
  sfxShatterClip: 'rebornshatter', sfxShatterGain: 0.65, sfxShatterRate: 1.15,
  sfxImpactClip: 'fx/blue-impact-hit', sfxImpactGain: 0.6, sfxImpactRate: 1.2,
  sfxThumpClip: 'smack2', sfxThumpGain: 0.38, sfxThumpRate: 0.95,
  sfxBigClip: 'crit', sfxBigGain: 0.32, sfxBigRate: 1.15,
  sfxReleaseClip: 'fx/universfield-cinematic-swoosh-impact-454392', sfxReleaseGain: 0.5, sfxReleaseRate: 1.15,
  sfxEncaseClip: 'freezetavern', sfxEncaseGain: 0.6, sfxEncaseRate: 0.9,
  sfxBurstClip: 'turnexplosion', sfxBurstGain: 0.45, sfxBurstRate: 1.32,
  sfxBoomClip: 'divineshieldbreak', sfxBoomGain: 0.25, sfxBoomRate: 1.6,
  sfxWindGain: 0.4, sfxWindLowHz: 320, sfxWindHighHz: 1500,
  sfxCrackleGain: 0.4,
  sfxLaunchLenMs: 600,
  sfxImpactLenMs: 1000,
  sfxTailMix: 0.16,
  sfxDuck: 0.5,
  previewDamage: 12,
  previewParts: 4,
  ...tierDefaults,
};

const GLOBAL_RANGES: Record<Exclude<keyof GlobalConfig, HeroFrostStrKey>, [number, number, number]> = {
  tier2At: [2, 40, 1], tier3At: [2, 60, 1], tier4At: [2, 80, 1],
  absorbMs: [60, 600, 10],
  heroSwell: [0, 0.3, 0.01],
  recoilPx: [0, 60, 1],
  growMs: [60, 1000, 10],
  formRadius: [0.6, 2.5, 0.01],
  formSpread: [0, 170, 1],
  icicleLength: [40, 400, 5],
  icicleThick: [0.4, 2.5, 0.05],
  icicleGlow: [0, 2, 0.05],
  icicleCore: [0, 1, 0.01],
  pullMs: [0, 400, 5],
  pullBackPx: [0, 60, 1],
  trailMs: [0, 400, 5],
  trailWidth: [0, 60, 0.5],
  dust: [0, 3, 0.05],
  shatterSize: [0.3, 3, 0.05],
  snowPuffs: [0, 3, 0.05],
  creepMs: [60, 1500, 10],
  creepFerns: [0, 12, 1],
  creepReach: [0, 1, 0.01],
  novaWindupMs: [100, 1500, 10],
  novaMs: [200, 2000, 10],
  novaWidth: [1, 6, 0.05],
  novaDepth: [0.3, 3, 0.05],
  novaBulge: [0, 1.5, 0.01],
  snowDensity: [0, 3, 0.05],
  groundWidth: [0, 4, 0.05],
  groundFerns: [0, 40, 1],
  groundFadeMs: [100, 3000, 10],
  encaseMs: [60, 1000, 10],
  encaseSize: [0.8, 2, 0.01],
  encaseShards: [0, 60, 1],
  flashAlpha: [0, 1, 0.01],
  knockPx: [0, 60, 1],
  squash: [0, 0.3, 0.01],
  shakeMs: [0, 1200, 10],
  zoomOutMs: [60, 1500, 10],
  reducedFadeMs: [60, 1000, 10],
  sfxFormGain: [0, 2, 0.05], sfxFormRate: [0.5, 2, 0.01],
  sfxChimeGain: [0, 2, 0.05], sfxChimeRate: [0.5, 2, 0.01],
  sfxSheenGain: [0, 2, 0.05], sfxSheenRate: [0.5, 2, 0.01],
  sfxLaunchGain: [0, 2, 0.05], sfxLaunchRate: [0.5, 2, 0.01],
  sfxDustGain: [0, 2, 0.05], sfxDustRate: [0.5, 2, 0.01],
  sfxHitGain: [0, 2, 0.05], sfxHitRate: [0.5, 2, 0.01],
  sfxShatterGain: [0, 2, 0.05], sfxShatterRate: [0.5, 2, 0.01],
  sfxImpactGain: [0, 2, 0.05], sfxImpactRate: [0.5, 2, 0.01],
  sfxThumpGain: [0, 2, 0.05], sfxThumpRate: [0.5, 2, 0.01],
  sfxBigGain: [0, 2, 0.05], sfxBigRate: [0.5, 2, 0.01],
  sfxReleaseGain: [0, 2, 0.05], sfxReleaseRate: [0.5, 2, 0.01],
  sfxEncaseGain: [0, 2, 0.05], sfxEncaseRate: [0.5, 2, 0.01],
  sfxBurstGain: [0, 2, 0.05], sfxBurstRate: [0.5, 2, 0.01],
  sfxBoomGain: [0, 2, 0.05], sfxBoomRate: [0.5, 2, 0.01],
  sfxWindGain: [0, 2, 0.05], sfxWindLowHz: [80, 2000, 10], sfxWindHighHz: [200, 5000, 10],
  sfxCrackleGain: [0, 2, 0.05],
  sfxLaunchLenMs: [100, 2500, 10],
  sfxImpactLenMs: [150, 3500, 10],
  sfxTailMix: [0, 0.6, 0.01],
  sfxDuck: [0, 1, 0.05],
  previewDamage: [1, 60, 1],
  previewParts: [1, 8, 1],
};

/** [min, max, step] per numeric key. Values outside are clamped on write AND on load. */
export const HERO_FROST_RANGES: Record<HeroFrostNumKey, [number, number, number]> = {
  ...GLOBAL_RANGES,
  ...(Object.fromEntries(TIERS.flatMap((t) => FROST_TIER_SUFFIXES.map((s) => [`t${t}${s}`, FROST_TIER_RANGES[s]]))) as Record<TierKey, [number, number, number]>),
};

/** The hard ceilings a plan can never exceed, whatever the sliders say (so a 40 stays crisp, not cluttered). */
export const FROST_CAPS = { icicles: 8, shards: 60, shakePx: 40, zoom: 0.14 } as const;

const HEX = /^#[0-9a-f]{6}$/i;
const isColorKey = (k: string): k is ColorKey => (HERO_FROST_COLOR_KEYS as readonly string[]).includes(k);
const isClipKey = (k: string): k is ClipKey => (HERO_FROST_CLIP_KEYS as readonly string[]).includes(k);

/** One value, made safe: numbers clamped into range (junk = the default), colours #rrggbb, clips a short string. */
export function clampHeroFrostValue<K extends keyof HeroFrostConfig>(key: K, value: unknown): HeroFrostConfig[K] | undefined {
  if (!Object.prototype.hasOwnProperty.call(HERO_FROST_DEFAULTS, key)) return undefined;
  const def = HERO_FROST_DEFAULTS[key];
  if (isColorKey(key)) {
    if (typeof value !== 'string') return def;
    const v = value.trim();
    return (HEX.test(v) ? v.toLowerCase() : def) as HeroFrostConfig[K];
  }
  if (isClipKey(key)) return (typeof value === 'string' ? value.trim().slice(0, 160) : def) as HeroFrostConfig[K];
  const n = typeof value === 'number' ? value : Number(value);
  if (typeof value === 'boolean' || value === null || value === '' || !Number.isFinite(n)) return def;
  const [min, max] = HERO_FROST_RANGES[key as HeroFrostNumKey];
  return Math.min(max, Math.max(min, n)) as HeroFrostConfig[K];
}

/** A whole saved object, sanitised key by key over the defaults (junk and unknown keys dropped). */
export function sanitizeHeroFrostConfig(saved: unknown): HeroFrostConfig {
  const out: HeroFrostConfig = { ...HERO_FROST_DEFAULTS };
  if (!saved || typeof saved !== 'object') return out;
  for (const [k, v] of Object.entries(saved as Record<string, unknown>)) {
    const safe = clampHeroFrostValue(k as keyof HeroFrostConfig, v);
    if (safe !== undefined) (out as unknown as Record<string, unknown>)[k] = safe;
  }
  return out;
}

const KEY = 'ascent.herofrost.v1';

let cfg: HeroFrostConfig = (() => {
  if (!import.meta.env.DEV || typeof localStorage === 'undefined') return { ...HERO_FROST_DEFAULTS };
  try { return sanitizeHeroFrostConfig(JSON.parse(localStorage.getItem(KEY) ?? '{}')); } catch { return { ...HERO_FROST_DEFAULTS }; }
})();

export function getHeroFrostConfig(): HeroFrostConfig { return cfg; }

export function setHeroFrostValue(key: keyof HeroFrostConfig, value: number | string): void {
  const safe = clampHeroFrostValue(key, value);
  if (safe === undefined) return;
  cfg = { ...cfg, [key]: safe };
  if (!import.meta.env.DEV) return;
  try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch { /* ignore */ }
}

export function resetHeroFrostConfig(): void {
  cfg = { ...HERO_FROST_DEFAULTS };
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}

/** The tuned values as JSON for pasting back into DEFAULTS (the preview-only keys left out). */
export function heroFrostConfigJson(c: HeroFrostConfig = cfg): string {
  const ship: Partial<HeroFrostConfig> = { ...c };
  delete ship.previewDamage;
  delete ship.previewParts;
  return JSON.stringify(ship, null, 2);
}

// ─── the preview speed (DEV only, never saved) ─────────────────────────────────────────────────────────────────

export const HERO_FROST_SPEEDS = [1, 0.5, 0.25] as const;
export type HeroFrostSpeed = (typeof HERO_FROST_SPEEDS)[number];
let speed: HeroFrostSpeed = 1;
/** The tuner's slow motion. Always 1 in production. */
export function heroFrostPreviewSpeed(): HeroFrostSpeed { return import.meta.env.DEV ? speed : 1; }
export function setHeroFrostPreviewSpeed(s: HeroFrostSpeed): void { speed = s; }

// ─── the pure plan ─────────────────────────────────────────────────────────────────────────────────────────────

/** One tier's dials, read out of the config. */
export function frostTierDials(tier: TierNum, c: HeroFrostConfig = cfg): Record<FrostTierSuffix, number> {
  return Object.fromEntries(FROST_TIER_SUFFIXES.map((s) => [s, c[`t${tier}${s}`]])) as Record<FrostTierSuffix, number>;
}

/** The reference distance the per-tier times are tuned at (a 1080p board, corner to corner). */
export const FROST_REF_DISTANCE = 1600;

/** A travel time for a distance: the tuned time, scaled gently by the distance (a sandbox box stays readable). */
export function frostTravelMs(distance: number, tunedMs: number): number {
  const d = Number.isFinite(distance) && distance > 0 ? distance : FROST_REF_DISTANCE;
  return Math.round(tunedMs * clamp(Math.sqrt(d / FROST_REF_DISTANCE), 0.6, 1.15));
}

/**
 * The fan of a volley, in LAUNCH order: outer icicles first, the centre one last (the volley closes in, and the last
 * to land, THE impact, is the biggest and flies the straightest line). Signed slots: 0 = the centre.
 */
export function frostSlots(n: number): number[] {
  if (n <= 1) return [0];
  if (n === 2) return [-1, 1];
  const out: number[] = [];
  const half = Math.floor(n / 2);
  for (let k = half; k >= 1; k--) { out.push(-k); out.push(k); }
  if (n % 2 === 1) out.push(0);
  return out.slice(0, n);
}

export interface FrostIciclePlan {
  /** The icicle starts to crystallise. */
  formAt: number;
  /** It leaves (the pull-back comes just before this). */
  launchAt: number;
  flightMs: number;
  arriveAt: number;
  /** Signed fan slot (0 = the centre line). */
  slot: number;
  /** Size multiplier (the last is the biggest). */
  size: number;
}

export interface FrostPlanInput {
  /** When the style's own attack starts: the end of the shared damage formation (`formationPlan().endAt`). */
  leadIn?: number;
  /** THE blow, as the engine decided it. */
  total: number;
  /** Screen px between the attacker's and the defender's centres. */
  distance: number;
  reduced?: boolean;
}

export interface FrostPlan {
  reduced: boolean;
  tier: TierNum;
  /** 0..1 across the tiers (I = 0, IV = 1). */
  k: number;
  total: number;
  /** The total dives into the hero, the frost rune opens, the first icicle starts to grow. */
  chargeAt: number;
  absorbEnd: number;
  /** The first icicle leaves. */
  fireAt: number;
  icicles: FrostIciclePlan[];
  /** Tier IV: the frost nova follows the icicles and carries the blow. */
  nova: boolean;
  /** Tier IV: the hero gathers the cold for the nova (else the impact). */
  novaChargeAt: number;
  /** Tier IV: the nova is released (else the impact). */
  novaAt: number;
  /** Tier IV: the nova reaches the struck hero and the ice encases it (else the impact). */
  contactAt: number;
  /** Icicles that land BEFORE the impact, sequence ms: the rhythm ticks. */
  hits: number[];
  /** THE consequence beat: the last icicle shatters (I-III) or the encasement shatters (IV). */
  impactAt: number;
  /** Tinkling aftershocks round the target (IV). */
  booms: number[];
  endAt: number;
  shakePx: number;
  zoom: number;
  punch: number;
  shards: number;
  burst: number;
  creep: number;
  arc: number;
  dim: number;
}

/** The whole Frost attack, in base ms (divide by the playback speed for real time). Pure and deterministic. */
export function frostPlan(input: FrostPlanInput, c: HeroFrostConfig = cfg): FrostPlan {
  const total = Math.max(0, Math.round(input.total));
  const tier = tierOf(total, c);
  const T = frostTierDials(tier, c);
  const k = (tier - 1) / 3;

  if (input.reduced) {
    const r = reducedAttackTimeline(input.leadIn ?? 0, c.reducedFadeMs);
    const { impactAt } = r;
    return {
      reduced: true, tier, k, total,
      chargeAt: impactAt, absorbEnd: impactAt, fireAt: impactAt, icicles: [], nova: false, novaChargeAt: impactAt, novaAt: impactAt,
      contactAt: impactAt, hits: [], impactAt, booms: [], endAt: r.endAt, shakePx: 0, zoom: 0, punch: 0, shards: 0, burst: 0,
      creep: 0, arc: 0, dim: 0,
    };
  }

  const chargeAt = Math.max(0, input.leadIn ?? 0);
  const absorbEnd = chargeAt + c.absorbMs;
  const fireAt = chargeAt + Math.max(T.FormMs, c.absorbMs);
  const nova = T.Nova >= 1;
  const count = clamp(Math.round(T.Icicles), 1, FROST_CAPS.icicles);
  const flight = frostTravelMs(input.distance, T.FlightMs);
  const slots = frostSlots(count);
  // They crystallise one after another from just after the total lands in the hero, each finished before it leaves.
  const formStep = count > 1 ? Math.min(110, Math.max(0, T.FormMs - c.growMs - 60) / (count - 1)) : 0;
  const icicles: FrostIciclePlan[] = slots.map((slot, i) => {
    const launchAt = fireAt + i * T.LaunchStaggerMs;
    const formAt = Math.max(chargeAt, Math.min(chargeAt + 60 + i * formStep, launchAt - c.pullMs - c.growMs));
    const last = i === count - 1;
    return { formAt, launchAt, flightMs: flight, arriveAt: launchAt + flight, slot, size: T.IcicleSize * (last && count > 1 ? 1.15 : 1) };
  });
  const lastLaunch = icicles[icicles.length - 1]!.launchAt;
  const lastIn = Math.max(...icicles.map((r) => r.arriveAt));
  let novaChargeAt = lastIn, novaAt = lastIn, contactAt = lastIn, impactAt = lastIn;
  if (nova) {
    novaChargeAt = lastLaunch + 70;
    novaAt = Math.max(novaChargeAt + c.novaWindupMs, lastIn + 60);
    contactAt = novaAt + frostTravelMs(input.distance, c.novaMs);
    impactAt = contactAt + c.encaseMs;
  }
  const hits = icicles.map((r) => r.arriveAt).filter((at) => nova || at < impactAt).sort((a, b) => a - b);
  const booms = nova ? [impactAt + 150, impactAt + 290] : [];
  const lastBeat = Math.max(
    impactAt + 160,
    booms.length ? booms[booms.length - 1]! + 120 : 0,
    impactAt + c.zoomOutMs * 0.8,
    nova ? impactAt + 460 : 0,
  );
  const endAt = lastBeat + T.SettleMs;

  return {
    reduced: false, tier, k, total, chargeAt, absorbEnd, fireAt,
    icicles, nova, novaChargeAt, novaAt, contactAt, hits, impactAt, booms, endAt,
    shakePx: clamp(T.Shake, 0, FROST_CAPS.shakePx),
    zoom: clamp(T.Zoom, 0, FROST_CAPS.zoom),
    punch: T.Punch,
    shards: Math.round(clamp(T.Shards, 0, FROST_CAPS.shards)),
    burst: T.Burst,
    creep: T.Creep,
    arc: T.Arc,
    dim: T.Dim,
  };
}

export type FrostCueKind = 'charge' | 'grow' | 'fire' | 'hit' | 'novaCharge' | 'nova' | 'contact' | 'impact' | 'boom' | 'end';
export interface FrostCue { at: number; kind: FrostCueKind; i: number }

/** Every beat the runner fires, in time order (ties keep this declaration order, so a hit precedes the impact). */
export function frostCues(p: FrostPlan): FrostCue[] {
  const out: FrostCue[] = [];
  if (!p.reduced) {
    out.push({ at: p.chargeAt, kind: 'charge', i: 0 });
    p.icicles.forEach((r, i) => out.push({ at: r.formAt, kind: 'grow', i }));
    p.icicles.forEach((r, i) => out.push({ at: r.launchAt, kind: 'fire', i }));
    // Every icicle but the last lands as a tick (Tier IV: every icicle, the nova carries the blow).
    p.icicles.forEach((r, i) => { if (p.nova || i < p.icicles.length - 1) out.push({ at: r.arriveAt, kind: 'hit', i }); });
    if (p.nova) {
      out.push({ at: p.novaChargeAt, kind: 'novaCharge', i: 0 });
      out.push({ at: p.novaAt, kind: 'nova', i: 0 });
      out.push({ at: p.contactAt, kind: 'contact', i: 0 });
    }
  }
  out.push({ at: p.impactAt, kind: 'impact', i: 0 });
  p.booms.forEach((at, i) => out.push({ at, kind: 'boom', i }));
  out.push({ at: p.endAt, kind: 'end', i: 0 });
  const order: Record<FrostCueKind, number> = {
    charge: 1, grow: 2, fire: 3, hit: 4, novaCharge: 5, nova: 6, contact: 7, impact: 8, boom: 9, end: 10,
  };
  return out.map((q, idx) => ({ q, idx })).sort((a, b) => a.q.at - b.q.at || order[a.q.kind] - order[b.q.kind] || a.idx - b.idx).map((x) => x.q);
}

// ─── the icicle paths (pure) ───────────────────────────────────────────────────────────────────────────────────

/**
 * An icicle's whole life, in SEQUENCE ms: it grows at `home` (its centre) aimed along `aim`, hovers, draws back, and
 * flies its tip from `from` (the drawn-back tip) to `to` (its hit point) on a gentle quadratic through `ctrl`.
 */
export interface IcicleMotion {
  home: Pt;
  /** Unit direction it points while it forms and hovers (at its hit point). */
  aim: Pt;
  /** Its length in px (size and stage scale folded in). */
  len: number;
  formAt: number; growMs: number;
  pullAt: number; launchAt: number; arriveAt: number;
  from: Pt; ctrl: Pt; to: Pt;
  /** A small bob while it hovers (phase). */
  phase: number;
}

/** Where an icicle is: its TIP, its heading, its growth (0..~1.1) and whether it is in flight. */
export interface IciclePose { x: number; y: number; rot: number; grow: number; flying: boolean; landed: boolean }

/** The flight ease: it leaves already fast and still ACCELERATES into the target (a cubic at most: the trail samples it). */
export const flightEase = (u: number): number => { const t = Math.min(1, Math.max(0, Number.isFinite(u) ? u : 0)); return 0.72 * t + 0.28 * t * t; };

const quad = (a: number, b: number, c: number, t: number): number => { const m = 1 - t; return m * m * a + 2 * m * t * b + t * t * c; };

/** A point on an icicle's flight at curve parameter `e` (0..1). */
export function flightPoint(m: IcicleMotion, e: number): Pt {
  return { x: quad(m.from.x, m.ctrl.x, m.to.x, e), y: quad(m.from.y, m.ctrl.y, m.to.y, e) };
}

/** Where the icicle's tip is at sequence time `t`. Pure: the scene draws the ice-dust trail by sampling this back in time. */
export function iciclePose(m: IcicleMotion, t: number): IciclePose {
  const aimRot = Math.atan2(m.aim.y, m.aim.x);
  const butt = { x: m.home.x - m.aim.x * m.len * 0.5, y: m.home.y - m.aim.y * m.len * 0.5 };
  if (t < m.launchAt) {
    if (t < m.formAt) return { x: butt.x, y: butt.y, rot: aimRot, grow: 0, flying: false, landed: false };
    // Crystallising: it grows from its butt out to its tip (a little overshoot, then it sets).
    const g = easeOutBack(Math.min(1, (t - m.formAt) / Math.max(1, m.growMs)), 1.4);
    // Hovering: a faint bob across its line; drawing back just before it fires.
    const bob = 1.6 * Math.sin((t - m.formAt) * 0.009 + m.phase) * Math.min(1, (t - m.formAt) / 300);
    const pull = t >= m.pullAt ? easeOutCubic((t - m.pullAt) / Math.max(1, m.launchAt - m.pullAt)) : 0;
    const back = (m.from.x - (butt.x + m.aim.x * m.len)) * pull;
    const backY = (m.from.y - (butt.y + m.aim.y * m.len)) * pull;
    return {
      x: butt.x + m.aim.x * m.len * g - m.aim.y * bob + back,
      y: butt.y + m.aim.y * m.len * g + m.aim.x * bob + backY,
      rot: aimRot, grow: g, flying: false, landed: false,
    };
  }
  if (t >= m.arriveAt) return { x: m.to.x, y: m.to.y, rot: flightRot(m, 1), grow: 1, flying: false, landed: true };
  const e = flightEase((t - m.launchAt) / Math.max(1, m.arriveAt - m.launchAt));
  const p = flightPoint(m, e);
  return { x: p.x, y: p.y, rot: flightRot(m, e), grow: 1, flying: true, landed: false };
}

/** The heading along the flight at curve parameter `e` (the tangent). */
export function flightRot(m: IcicleMotion, e: number): number {
  const t = Math.min(1, Math.max(0, e));
  const dx = 2 * (1 - t) * (m.ctrl.x - m.from.x) + 2 * t * (m.to.x - m.ctrl.x);
  const dy = 2 * (1 - t) * (m.ctrl.y - m.from.y) + 2 * t * (m.to.y - m.ctrl.y);
  return Math.atan2(dy, dx);
}

/** The icicle tip's position for the trail: clamped to the flight (the trail never reaches back into the hover). */
export function trailPos(m: IcicleMotion, t: number): Pt {
  const tt = Math.max(m.launchAt, Math.min(m.arriveAt, t));
  const e = flightEase((tt - m.launchAt) / Math.max(1, m.arriveAt - m.launchAt));
  return flightPoint(m, e);
}

/**
 * Every icicle's whole life, from the plan and the two heroes. They form in a fan round the striking portrait's rim on
 * the side facing the target (never over the face), each aimed at its own hit point spread across the struck portrait
 * (the centre one, the last, at its heart). Pure, so a replay flies the same paths and the tests can check them.
 */
export function icicleMotions(
  p: FrostPlan, a: Pt, d: Pt, aRadius: number, dRadius: number, c: HeroFrostConfig = cfg, scale = 1, ceilY = Number.NEGATIVE_INFINITY,
): IcicleMotion[] {
  if (p.reduced) return [];
  const n = p.icicles.length;
  const dx = d.x - a.x, dy = d.y - a.y;
  const dist = Math.hypot(dx, dy) || 1;
  const u = { x: dx / dist, y: dy / dist };
  const nrm = { x: -u.y, y: u.x };
  const base = Math.atan2(u.y, u.x);
  const maxSlot = Math.max(1, ...p.icicles.map((r) => Math.abs(r.slot)));
  return p.icicles.map((r, i) => {
    const f = n === 1 ? 0 : n === 2 ? r.slot * 0.42 : r.slot / maxSlot;
    const ang = base + f * ((c.formSpread * Math.PI) / 180) * 0.5;
    const rad = aRadius * c.formRadius * (1 + 0.06 * Math.abs(f));
    const home = { x: a.x + Math.cos(ang) * rad, y: Math.max(ceilY, a.y + Math.sin(ang) * rad) };
    // Spread the hit points across the struck portrait (the centre one dead on); the last is the heart.
    const hitOff = n === 1 ? 0 : (r.slot / maxSlot) * dRadius * 0.34;
    const to = { x: d.x + nrm.x * hitOff, y: d.y + nrm.y * hitOff };
    const ax = to.x - home.x, ay = to.y - home.y;
    const al = Math.hypot(ax, ay) || 1;
    const aim = { x: ax / al, y: ay / al };
    const len = c.icicleLength * r.size * scale;
    const tip = { x: home.x + aim.x * len * 0.5, y: home.y + aim.y * len * 0.5 };
    const from = { x: tip.x - aim.x * c.pullBackPx * scale, y: tip.y - aim.y * c.pullBackPx * scale };
    const fl = Math.hypot(to.x - from.x, to.y - from.y) || 1;
    const side = (r.slot === 0 ? (i % 2 ? -1 : 1) : Math.sign(r.slot)) * p.arc;
    // A gentle arc off the line (never above the top of the screen), so a fan converges from its own angles.
    const ctrl = {
      x: (from.x + to.x) / 2 + (-(to.y - from.y) / fl) * side * fl,
      y: Math.max(ceilY, (from.y + to.y) / 2 + ((to.x - from.x) / fl) * side * fl),
    };
    return {
      home, aim, len, formAt: r.formAt, growMs: c.growMs, pullAt: Math.max(r.formAt + c.growMs, r.launchAt - c.pullMs),
      launchAt: r.launchAt, arriveAt: r.arriveAt, from, ctrl, to, phase: i * 1.7,
    };
  });
}

/** The direction the LAST icicle is travelling as it lands (the impact's shake and spray follow it). Unit. */
export function frostArrivalDir(m: IcicleMotion | undefined, a: Pt, d: Pt): Pt {
  if (m) { const r = flightRot(m, 1); return { x: Math.cos(r), y: Math.sin(r) }; }
  const L = Math.hypot(d.x - a.x, d.y - a.y) || 1;
  return { x: (d.x - a.x) / L, y: (d.y - a.y) / L };
}

// ─── the nova (pure) ───────────────────────────────────────────────────────────────────────────────────────────

/** The nova's run across the screen: its wave front travels from `a` to `b` between `startAt` and `contactAt`. */
export interface NovaMotion {
  a: Pt; b: Pt;
  /** Unit direction of travel. */
  dir: Pt;
  /** The whole run (px): the front starts `start` px out of the attacker and reaches the struck hero's centre. */
  dist: number; start: number;
  startAt: number; contactAt: number;
  /** The front's half-width as it leaves and as it arrives (px): the wave widens as it rolls. */
  w0: number; w1: number;
  /** How deep the frost wall behind the leading edge is (px), and how far its middle bulges ahead (x the half-width). */
  depth: number; bulge: number;
  /** The frozen ground left behind: its half-width (px). */
  ground: number;
}

/** Where the nova's front is at sequence time `t`: its centre, how far along (0..1) and its half-width. */
export interface NovaFront { x: number; y: number; u: number; halfW: number; along: number; live: boolean }

/** The nova's travel ease: it BLASTS out of the hero (a fast start) and keeps rolling at pace into the target. */
export const novaEase = (u: number): number => { const t = Math.min(1, Math.max(0, Number.isFinite(u) ? u : 0)); return 0.62 * t + 0.38 * easeOutCubic(t); };

export function novaMotion(p: FrostPlan, a: Pt, d: Pt, aRadius: number, dRadius: number, c: HeroFrostConfig = cfg): NovaMotion | null {
  if (p.reduced || !p.nova) return null;
  const dx = d.x - a.x, dy = d.y - a.y;
  const dist = Math.hypot(dx, dy) || 1;
  return {
    a: { ...a }, b: { ...d }, dir: { x: dx / dist, y: dy / dist }, dist, start: Math.min(dist * 0.4, aRadius * 0.85),
    startAt: p.novaAt, contactAt: p.contactAt,
    w0: aRadius * c.novaWidth * 0.3, w1: dRadius * c.novaWidth * 0.5,
    depth: dRadius * c.novaDepth, bulge: c.novaBulge, ground: dRadius * c.groundWidth * 0.5,
  };
}

export function novaFront(m: NovaMotion, t: number): NovaFront {
  const u = Math.min(1, Math.max(0, (t - m.startAt) / Math.max(1, m.contactAt - m.startAt)));
  const e = novaEase(u);
  const along = m.start + (m.dist - m.start) * e;
  return {
    x: m.a.x + m.dir.x * along, y: m.a.y + m.dir.y * along, u: e, along,
    halfW: m.w0 + (m.w1 - m.w0) * easeInOutSine(e), live: t >= m.startAt && t < m.contactAt,
  };
}

// ─── the camera (pure) ─────────────────────────────────────────────────────────────────────────────────────────

const springAt = (ms: number, hz: number, tau: number): number => (ms < 0 ? 0 : Math.exp(-ms / tau) * Math.cos(2 * Math.PI * hz * (ms / 1000)));

/**
 * The camera at sequence time `t` (px in the space the points are in). A push in on the hero while the ice forms; a
 * small recoil kick on each launch; a directional kick ALONG the icicle on each tick; on THE impact a punch in and a
 * directional shake. Tier IV builds on the nova: a deeper push while the cold gathers, a low tremor while the wave
 * rolls, a jolt as it hits, and the shatter punches hardest with a shake that rings both ways. Deterministic. Pure.
 */
export function frostCameraAt(p: FrostPlan, c: HeroFrostConfig, t: number, dir: Pt = { x: 1, y: 0 }): { zoom: number; x: number; y: number } {
  if (p.reduced) return { zoom: 1, x: 0, y: 0 };
  let z = 0;
  const sine = (u: number): number => easeInOutSine(u);
  if (t >= p.chargeAt && t < p.impactAt) {
    z += p.zoom * sine((t - p.chargeAt) / Math.max(1, p.fireAt - p.chargeAt));
    if (p.nova && t >= p.novaChargeAt) {
      z += p.zoom * 0.5 * sine((t - p.novaChargeAt) / Math.max(1, p.novaAt - p.novaChargeAt));
      if (t >= p.contactAt) z += p.zoom * 0.6 * sine((t - p.contactAt) / Math.max(1, p.impactAt - p.contactAt));
    }
  } else if (t >= p.impactAt) {
    const since = t - p.impactAt;
    z += (p.zoom * (p.nova ? 2.1 : 1) + p.punch) * Math.exp(-since / Math.max(1, c.zoomOutMs / 4));
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
  p.icicles.forEach((r) => kick(r.launchAt, -p.shakePx * 0.1, 45, 14, dir));
  p.hits.forEach((at, i) => kick(at, p.shakePx * (0.26 + 0.04 * i) * (p.nova ? 0.8 : 1), 45, 17, dir));
  if (p.nova) {
    // The release kicks back; the wave rolls with a low tremor that grows as it nears; the hit jolts; the shatter rings.
    kick(p.novaAt, -p.shakePx * 0.35, 60, 12, dir);
    if (t >= p.novaAt && t < p.contactAt) {
      const u = (t - p.novaAt) / Math.max(1, p.contactAt - p.novaAt);
      const a = p.shakePx * (0.06 + 0.1 * u);
      x += a * Math.sin(t * 0.11);
      y += a * Math.sin(t * 0.15 + 1.1);
    }
    kick(p.contactAt, p.shakePx * 0.35, 50, 15, dir);
    if (t >= p.contactAt && t < p.impactAt) {
      const u = (t - p.contactAt) / Math.max(1, p.impactAt - p.contactAt);
      const a = p.shakePx * 0.08 * u;
      x += a * Math.sin(t * 0.37);
      y += a * Math.sin(t * 0.41 + 0.6);
    }
    const age = t - p.impactAt;
    if (age >= 0) {
      const env = Math.exp(-age / Math.max(1, c.shakeMs / 4));
      x += p.shakePx * 0.8 * env * Math.sin(age * 0.105 + 0.5);
      y += p.shakePx * env * Math.cos(age * 0.093);
    }
    p.booms.forEach((at, i) => kick(at, p.shakePx * 0.22, 40, 18, i % 2 ? perp : dir));
  } else {
    kick(p.impactAt, p.shakePx, Math.max(1, c.shakeMs / 4), 16, dir);
  }
  return { zoom: 1 + Math.max(0, z), x, y };
}

/**
 * Where the camera anchors: the ATTACKER while the ice forms, following the volley in flight, and the DEFENDER from the
 * impact on. Tier IV: back toward the attacker while the cold gathers, then riding the nova's front to the target. A
 * zoom anchored on a point keeps that point still. Pure.
 */
export function frostCameraFocus(p: FrostPlan, t: number, a: Pt, d: Pt): Pt {
  const lerp = (e: number): Pt => ({ x: a.x + (d.x - a.x) * e, y: a.y + (d.y - a.y) * e });
  if (t <= p.fireAt) return a;
  if (!p.nova) {
    if (t >= p.impactAt) return d;
    return lerp(flightEase((t - p.fireAt) / Math.max(1, p.impactAt - p.fireAt)));
  }
  if (t >= p.contactAt) return d;
  const mid = 0.3;
  if (t < p.novaChargeAt) return lerp(mid * easeInOutSine((t - p.fireAt) / Math.max(1, p.novaChargeAt - p.fireAt)));
  if (t < p.novaAt) return lerp(mid * (1 - 0.5 * easeInOutSine((t - p.novaChargeAt) / Math.max(1, p.novaAt - p.novaChargeAt))));
  return lerp(mid * 0.5 + (1 - mid * 0.5) * novaEase((t - p.novaAt) / Math.max(1, p.contactAt - p.novaAt)));
}
