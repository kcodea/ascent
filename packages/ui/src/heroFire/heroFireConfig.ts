/**
 * THE FIRE HERO ATTACK ("Inferno", a placeholder name): its tuned values, its pure timeline, the pure fireball and
 * meteor paths and the pure camera.
 *
 * Owner 2026-09-29: "make some more attack types - we need a fire animation ... use the same 4 tier strategy we have
 * been ... same with the new fire animation, it should look like live flame/fires pixi sprites etc". Every flame in it
 * is the shared live particle fire (`../heroAttack/pixiFire.ts`): hundreds of small additive puffs and licking tongues
 * that rise, sway and cool from white-hot to red, with smoke and embers. Never a flame image.
 *
 * THE BEATS (base ms before the playback speed):
 *  1. THE DAMAGE FORMATION (shared by every style, `../heroAttack/damageFormation.ts`). Its end is this style's start.
 *  2. KINDLE. The total dives into the attacking hero; fire catches round its rim and FIREBALLS ignite in the air round
 *     the portrait one by one (a roiling ball of live flame over a white-hot heart, casting its light), each hovering on
 *     the side facing the struck hero.
 *  3. HURL. Each fireball draws back a hair, then flies FAST on a slight arc, a comet tail of flame and smoke streaming
 *     behind it: I one; II two (from either side of the hero); III a volley of five, fanned, landing in rhythm.
 *  4. BURST. Each fireball that lands before the last is a tick: it bursts into a billowing ball of fire, embers and
 *     smoke. The LAST one is THE impact (the big `-N`): a bigger explosion. II leaves the struck portrait's rim briefly
 *     alight; III (owner 2026-09-29: "make the 3rd fire tier a bit better") is a richer volley of bigger fireballs, and
 *     the struck hero CATCHES: every tick sets more of its rim alight, and the last one FLARES it up (a gout of flame
 *     roaring off the portrait) and leaves it ABLAZE, burning for a beat and dying down to embers and smoke. The
 *     consequence (the damage, Armor, Resolve) lands ONCE, there.
 *  IV. THE METEOR. Three fireballs fly (every one a tick). Then the hero hurls a column of fire into the sky and the
 *     struck hero is MARKED (owner 2026-09-29: "the meteor slightly slower build up"): the ground under it glows hotter
 *     and hotter, heat rings close in on it and flames lick up round it while a METEOR of fire streaks down from above
 *     the screen onto it. It DETONATES (owner: "a cooler explosion"), in layers: a white-hot flash core, shockwaves, a
 *     FIRE NOVA racing outward, a dome of fire, a fireball that ROLLS UP off the blast and billows into a mushroom of
 *     smoke, BURNING DEBRIS flung out on arcs trailing fire, a pillar of fire ENGULFING the struck hero that burns out
 *     to embers, and a scorch left round it. The damage lands on the detonation.
 *
 * No hit-stop or freeze anywhere (owner 2026-09-28: "it looks like lag"): weight comes from the flash, the squash and
 * knockback, the shake, the fire and the sound.
 *
 * TIERS are the shared, owner-approved thresholds (I 1-5, II 6-11, III 12-19, IV 20+). Brisk at Tier I (about 1.3 s
 * after the formation), about 3 s at Tier IV. Reduced motion: no fire, meteor, shake or zoom; the numbers fade and the
 * blow lands.
 *
 * Tuner convention (the Blast's): localStorage in DEV only, values clamped on write and on load; production always
 * plays DEFAULTS. The preview speed is how you are LOOKING and is never saved.
 */
import { clamp, easeOutBack, easeOutCubic, easeInOutSine, hexToNum, type Pt } from '../heroAttack/easing';
import {
  HERO_ATTACK_TIER_THRESHOLDS, TIERS, reducedAttackTimeline, attackTier, type AttackTierContext, type TierNum,
} from '../heroAttack/tiers';

export { TIERS, hexToNum, type TierNum };

/** The per-tier dials. A config key is `t1..t4` + one of these. */
export const FIRE_TIER_SUFFIXES = [
  'FormMs', 'Balls', 'LaunchStaggerMs', 'FlightMs', 'BallSize', 'Arc', 'Meteor',
  'Shake', 'Zoom', 'Punch', 'Burst', 'Blaze', 'BlazeMs', 'Embers', 'SettleMs', 'Dim',
] as const;
export type FireTierSuffix = (typeof FIRE_TIER_SUFFIXES)[number];
type TierKey = `t${TierNum}${FireTierSuffix}`;

interface GlobalConfig {
  // Tiers (the shared thresholds; DEV-tunable only)
  tier2At: number; tier3At: number; tier4At: number;
  // Kindle
  absorbMs: number;
  heroSwell: number;
  recoilPx: number;
  growMs: number;
  formRadius: number;
  formSpread: number;
  kindle: number;
  // The fireballs
  ballRadius: number;
  ballFlame: number;
  ballGlow: number;
  pullMs: number;
  pullBackPx: number;
  trail: number;
  trailSmoke: number;
  // The live fire (shared by every flame in the attack)
  turbulence: number;
  buoyancy: number;
  smoke: number;
  embers: number;
  // Bursts and the blaze
  explodeSize: number;
  blazeSize: number;
  // The meteor (Tier IV)
  summonMs: number;
  meteorMs: number;
  meteorSize: number;
  novaSize: number;
  novaMs: number;
  engulfMs: number;
  burnoutMs: number;
  scorch: number;
  flashAlpha: number;
  // Camera and portraits
  knockPx: number;
  squash: number;
  shakeMs: number;
  zoomOutMs: number;
  reducedFadeMs: number;
  // Colours
  colorCore: string;
  colorHot: string;
  colorFlame: string;
  colorDeep: string;
  colorEmber: string;
  colorSmoke: string;
  colorPlayer: string;
  colorFoe: string;
  // Sound: a clip, a gain and a pitch per cue ('' = silent)
  sfxIgniteClip: string; sfxIgniteGain: number; sfxIgniteRate: number;
  sfxFormClip: string; sfxFormGain: number; sfxFormRate: number;
  sfxLaunchClip: string; sfxLaunchGain: number; sfxLaunchRate: number;
  sfxTrailClip: string; sfxTrailGain: number; sfxTrailRate: number;
  sfxHitClip: string; sfxHitGain: number; sfxHitRate: number;
  sfxBlastClip: string; sfxBlastGain: number; sfxBlastRate: number;
  sfxImpactClip: string; sfxImpactGain: number; sfxImpactRate: number;
  sfxThumpClip: string; sfxThumpGain: number; sfxThumpRate: number;
  sfxBigClip: string; sfxBigGain: number; sfxBigRate: number;
  sfxSummonClip: string; sfxSummonGain: number; sfxSummonRate: number;
  sfxMeteorClip: string; sfxMeteorGain: number; sfxMeteorRate: number;
  sfxDetonateClip: string; sfxDetonateGain: number; sfxDetonateRate: number;
  sfxBoomClip: string; sfxBoomGain: number; sfxBoomRate: number;
  sfxRoarGain: number; sfxRoarLowHz: number; sfxRoarHighHz: number;
  sfxCrackleGain: number;
  sfxLaunchLenMs: number;
  sfxImpactLenMs: number;
  sfxTailMix: number;
  sfxDuck: number;
  // Preview only (the tuner's Play buttons). Never read by a real fight, and left out of Copy JSON.
  previewDamage: number;
  previewParts: number;
}
export type HeroFireConfig = GlobalConfig & Record<TierKey, number>;

export const HERO_FIRE_COLOR_KEYS = ['colorCore', 'colorHot', 'colorFlame', 'colorDeep', 'colorEmber', 'colorSmoke', 'colorPlayer', 'colorFoe'] as const;
export const HERO_FIRE_CLIP_KEYS = [
  'sfxIgniteClip', 'sfxFormClip', 'sfxLaunchClip', 'sfxTrailClip', 'sfxHitClip', 'sfxBlastClip', 'sfxImpactClip',
  'sfxThumpClip', 'sfxBigClip', 'sfxSummonClip', 'sfxMeteorClip', 'sfxDetonateClip', 'sfxBoomClip',
] as const;
type ColorKey = (typeof HERO_FIRE_COLOR_KEYS)[number];
type ClipKey = (typeof HERO_FIRE_CLIP_KEYS)[number];
export type HeroFireStrKey = ColorKey | ClipKey;
export type HeroFireNumKey = Exclude<keyof HeroFireConfig, HeroFireStrKey>;

/** Tier I .. IV per suffix: the escalation ladder. */
const TIER_DEFAULTS: Record<FireTierSuffix, [number, number, number, number]> = {
  FormMs: [460, 520, 620, 560],
  Balls: [1, 2, 5, 3],
  LaunchStaggerMs: [0, 150, 115, 110],
  FlightMs: [340, 330, 310, 300],
  BallSize: [1, 1, 0.95, 0.9],
  Arc: [0.08, 0.1, 0.12, 0.09],
  Meteor: [0, 0, 0, 1],
  Shake: [5, 8, 12, 22],
  Zoom: [0.02, 0.03, 0.045, 0.07],
  Punch: [0.02, 0.028, 0.038, 0.06],
  Burst: [1, 1.15, 1.5, 2],
  Blaze: [0, 0.4, 1.3, 1.2],
  BlazeMs: [0, 420, 900, 1400],
  Embers: [8, 14, 34, 60],
  SettleMs: [260, 320, 520, 420],
  Dim: [0, 0.18, 0.32, 0.5],
};

export const FIRE_TIER_RANGES: Record<FireTierSuffix, [number, number, number]> = {
  FormMs: [120, 1600, 10],
  Balls: [1, 8, 1],
  LaunchStaggerMs: [0, 320, 5],
  FlightMs: [120, 1200, 10],
  BallSize: [0.3, 2.5, 0.01],
  Arc: [0, 0.5, 0.01],
  Meteor: [0, 1, 1],
  Shake: [0, 40, 0.5],
  Zoom: [0, 0.14, 0.002],
  Punch: [0, 0.1, 0.001],
  Burst: [0.3, 3, 0.05],
  Blaze: [0, 2, 0.05],
  BlazeMs: [0, 3000, 10],
  Embers: [0, 120, 1],
  SettleMs: [0, 1600, 10],
  Dim: [0, 0.8, 0.01],
};

const tierDefaults = Object.fromEntries(TIERS.flatMap((t) => FIRE_TIER_SUFFIXES.map((s) => [`t${t}${s}`, TIER_DEFAULTS[s][t - 1]]))) as Record<TierKey, number>;

export const HERO_FIRE_DEFAULTS: HeroFireConfig = {
  // The shared, owner-approved thresholds (6 / 12 / 20): the same blow steps Fire up exactly where it steps Blast up.
  ...HERO_ATTACK_TIER_THRESHOLDS,
  absorbMs: 190,
  heroSwell: 0.06,
  recoilPx: 8,
  growMs: 300,
  formRadius: 1.3,
  formSpread: 92,
  kindle: 1,
  ballRadius: 36,
  ballFlame: 1,
  ballGlow: 0.8,
  pullMs: 110,
  pullBackPx: 14,
  trail: 1,
  trailSmoke: 1,
  turbulence: 1,
  buoyancy: 1,
  smoke: 1,
  embers: 1,
  explodeSize: 1,
  blazeSize: 1,
  summonMs: 620,
  meteorMs: 680,
  meteorSize: 2.4,
  novaSize: 3.2,
  novaMs: 380,
  engulfMs: 620,
  burnoutMs: 900,
  scorch: 1,
  flashAlpha: 0.85,
  knockPx: 18,
  squash: 0.1,
  shakeMs: 340,
  zoomOutMs: 360,
  reducedFadeMs: 260,
  colorCore: '#fff4de',
  colorHot: '#ffa640',
  colorFlame: '#ff7417',
  colorDeep: '#d9230b',
  colorEmber: '#5a0a03',
  colorSmoke: '#2b1f1b',
  colorPlayer: '#ff9a2e',
  colorFoe: '#ff3d5a',
  sfxIgniteClip: 'cards/sp_dragonflame.effect', sfxIgniteGain: 0.4, sfxIgniteRate: 1.2,
  sfxFormClip: 'fx/oona-powerup', sfxFormGain: 0.26, sfxFormRate: 1.3,
  sfxLaunchClip: 'fx/stereogenicstudio-swish-swoosh-woosh-sfx-27-357164-3', sfxLaunchGain: 0.5, sfxLaunchRate: 0.85,
  sfxTrailClip: 'cards/d2_broodfire.effect', sfxTrailGain: 0.28, sfxTrailRate: 1.25,
  sfxHitClip: 'turnexplosion', sfxHitGain: 0.34, sfxHitRate: 1.4,
  sfxBlastClip: 'turnexplosion', sfxBlastGain: 0.6, sfxBlastRate: 1.05,
  sfxImpactClip: 'fx/blue-impact-hit', sfxImpactGain: 0.45, sfxImpactRate: 0.85,
  sfxThumpClip: 'smack2', sfxThumpGain: 0.4, sfxThumpRate: 0.9,
  sfxBigClip: 'crit', sfxBigGain: 0.3, sfxBigRate: 0.95,
  sfxSummonClip: 'cards/sp_dragonflame.effect', sfxSummonGain: 0.6, sfxSummonRate: 0.8,
  sfxMeteorClip: 'fx/universfield-cinematic-swoosh-impact-454392', sfxMeteorGain: 0.5, sfxMeteorRate: 0.8,
  sfxDetonateClip: 'fx/universfield-ground-impact-352053', sfxDetonateGain: 0.7, sfxDetonateRate: 1,
  sfxBoomClip: 'fx/triple-impact', sfxBoomGain: 0.3, sfxBoomRate: 1.15,
  sfxRoarGain: 0.45, sfxRoarLowHz: 50, sfxRoarHighHz: 1100,
  sfxCrackleGain: 0.35,
  sfxLaunchLenMs: 700,
  sfxImpactLenMs: 1100,
  sfxTailMix: 0.16,
  sfxDuck: 0.5,
  previewDamage: 12,
  previewParts: 4,
  ...tierDefaults,
};

const GLOBAL_RANGES: Record<Exclude<keyof GlobalConfig, HeroFireStrKey>, [number, number, number]> = {
  tier2At: [2, 40, 1], tier3At: [2, 60, 1], tier4At: [2, 80, 1],
  absorbMs: [60, 600, 10],
  heroSwell: [0, 0.3, 0.01],
  recoilPx: [0, 60, 1],
  growMs: [60, 1000, 10],
  formRadius: [0.6, 2.5, 0.01],
  formSpread: [0, 170, 1],
  kindle: [0, 3, 0.05],
  ballRadius: [8, 90, 1],
  ballFlame: [0.2, 3, 0.05],
  ballGlow: [0, 2, 0.05],
  pullMs: [0, 400, 5],
  pullBackPx: [0, 60, 1],
  trail: [0, 3, 0.05],
  trailSmoke: [0, 3, 0.05],
  turbulence: [0, 3, 0.05],
  buoyancy: [0, 3, 0.05],
  smoke: [0, 3, 0.05],
  embers: [0, 3, 0.05],
  explodeSize: [0.3, 3, 0.05],
  blazeSize: [0.3, 2.5, 0.05],
  summonMs: [100, 1500, 10],
  meteorMs: [150, 2000, 10],
  meteorSize: [0.8, 5, 0.05],
  novaSize: [1, 6, 0.05],
  novaMs: [100, 1500, 10],
  engulfMs: [0, 3000, 10],
  burnoutMs: [100, 3000, 10],
  scorch: [0, 2, 0.05],
  flashAlpha: [0, 1, 0.01],
  knockPx: [0, 60, 1],
  squash: [0, 0.3, 0.01],
  shakeMs: [0, 1200, 10],
  zoomOutMs: [60, 1500, 10],
  reducedFadeMs: [60, 1000, 10],
  sfxIgniteGain: [0, 2, 0.05], sfxIgniteRate: [0.5, 2, 0.01],
  sfxFormGain: [0, 2, 0.05], sfxFormRate: [0.5, 2, 0.01],
  sfxLaunchGain: [0, 2, 0.05], sfxLaunchRate: [0.5, 2, 0.01],
  sfxTrailGain: [0, 2, 0.05], sfxTrailRate: [0.5, 2, 0.01],
  sfxHitGain: [0, 2, 0.05], sfxHitRate: [0.5, 2, 0.01],
  sfxBlastGain: [0, 2, 0.05], sfxBlastRate: [0.5, 2, 0.01],
  sfxImpactGain: [0, 2, 0.05], sfxImpactRate: [0.5, 2, 0.01],
  sfxThumpGain: [0, 2, 0.05], sfxThumpRate: [0.5, 2, 0.01],
  sfxBigGain: [0, 2, 0.05], sfxBigRate: [0.5, 2, 0.01],
  sfxSummonGain: [0, 2, 0.05], sfxSummonRate: [0.5, 2, 0.01],
  sfxMeteorGain: [0, 2, 0.05], sfxMeteorRate: [0.5, 2, 0.01],
  sfxDetonateGain: [0, 2, 0.05], sfxDetonateRate: [0.5, 2, 0.01],
  sfxBoomGain: [0, 2, 0.05], sfxBoomRate: [0.5, 2, 0.01],
  sfxRoarGain: [0, 2, 0.05], sfxRoarLowHz: [20, 400, 5], sfxRoarHighHz: [200, 4000, 10],
  sfxCrackleGain: [0, 2, 0.05],
  sfxLaunchLenMs: [100, 2500, 10],
  sfxImpactLenMs: [150, 3500, 10],
  sfxTailMix: [0, 0.6, 0.01],
  sfxDuck: [0, 1, 0.05],
  previewDamage: [1, 60, 1],
  previewParts: [1, 8, 1],
};

/** [min, max, step] per numeric key. Values outside are clamped on write AND on load. */
export const HERO_FIRE_RANGES: Record<HeroFireNumKey, [number, number, number]> = {
  ...GLOBAL_RANGES,
  ...(Object.fromEntries(TIERS.flatMap((t) => FIRE_TIER_SUFFIXES.map((s) => [`t${t}${s}`, FIRE_TIER_RANGES[s]]))) as Record<TierKey, [number, number, number]>),
};

/** The hard ceilings a plan can never exceed, whatever the sliders say (so a 40 stays crisp, not cluttered). */
export const FIRE_CAPS = { balls: 8, shakePx: 40, zoom: 0.14, embers: 120 } as const;

const HEX = /^#[0-9a-f]{6}$/i;
const isColorKey = (k: string): k is ColorKey => (HERO_FIRE_COLOR_KEYS as readonly string[]).includes(k);
const isClipKey = (k: string): k is ClipKey => (HERO_FIRE_CLIP_KEYS as readonly string[]).includes(k);

/** One value, made safe: numbers clamped into range (junk = the default), colours #rrggbb, clips a short string. */
export function clampHeroFireValue<K extends keyof HeroFireConfig>(key: K, value: unknown): HeroFireConfig[K] | undefined {
  if (!Object.prototype.hasOwnProperty.call(HERO_FIRE_DEFAULTS, key)) return undefined;
  const def = HERO_FIRE_DEFAULTS[key];
  if (isColorKey(key)) {
    if (typeof value !== 'string') return def;
    const v = value.trim();
    return (HEX.test(v) ? v.toLowerCase() : def) as HeroFireConfig[K];
  }
  if (isClipKey(key)) return (typeof value === 'string' ? value.trim().slice(0, 160) : def) as HeroFireConfig[K];
  const n = typeof value === 'number' ? value : Number(value);
  if (typeof value === 'boolean' || value === null || value === '' || !Number.isFinite(n)) return def;
  const [min, max] = HERO_FIRE_RANGES[key as HeroFireNumKey];
  return Math.min(max, Math.max(min, n)) as HeroFireConfig[K];
}

/** A whole saved object, sanitised key by key over the defaults (junk and unknown keys dropped). */
export function sanitizeHeroFireConfig(saved: unknown): HeroFireConfig {
  const out: HeroFireConfig = { ...HERO_FIRE_DEFAULTS };
  if (!saved || typeof saved !== 'object') return out;
  for (const [k, v] of Object.entries(saved as Record<string, unknown>)) {
    const safe = clampHeroFireValue(k as keyof HeroFireConfig, v);
    if (safe !== undefined) (out as unknown as Record<string, unknown>)[k] = safe;
  }
  return out;
}

const KEY = 'ascent.herofire.v1';

let cfg: HeroFireConfig = (() => {
  if (!import.meta.env.DEV || typeof localStorage === 'undefined') return { ...HERO_FIRE_DEFAULTS };
  try { return sanitizeHeroFireConfig(JSON.parse(localStorage.getItem(KEY) ?? '{}')); } catch { return { ...HERO_FIRE_DEFAULTS }; }
})();

export function getHeroFireConfig(): HeroFireConfig { return cfg; }

export function setHeroFireValue(key: keyof HeroFireConfig, value: number | string): void {
  const safe = clampHeroFireValue(key, value);
  if (safe === undefined) return;
  cfg = { ...cfg, [key]: safe };
  if (!import.meta.env.DEV) return;
  try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch { /* ignore */ }
}

export function resetHeroFireConfig(): void {
  cfg = { ...HERO_FIRE_DEFAULTS };
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}

/** The tuned values as JSON for pasting back into DEFAULTS (the preview-only keys left out). */
export function heroFireConfigJson(c: HeroFireConfig = cfg): string {
  const ship: Partial<HeroFireConfig> = { ...c };
  delete ship.previewDamage;
  delete ship.previewParts;
  return JSON.stringify(ship, null, 2);
}

// ─── the preview speed (DEV only, never saved) ─────────────────────────────────────────────────────────────────

export const HERO_FIRE_SPEEDS = [1, 0.5, 0.25] as const;
export type HeroFireSpeed = (typeof HERO_FIRE_SPEEDS)[number];
let speed: HeroFireSpeed = 1;
/** The tuner's slow motion. Always 1 in production. */
export function heroFirePreviewSpeed(): HeroFireSpeed { return import.meta.env.DEV ? speed : 1; }
export function setHeroFirePreviewSpeed(s: HeroFireSpeed): void { speed = s; }

// ─── the pure plan ─────────────────────────────────────────────────────────────────────────────────────────────

/** One tier's dials, read out of the config. */
export function fireTierDials(tier: TierNum, c: HeroFireConfig = cfg): Record<FireTierSuffix, number> {
  return Object.fromEntries(FIRE_TIER_SUFFIXES.map((s) => [s, c[`t${tier}${s}`]])) as Record<FireTierSuffix, number>;
}

/** The reference distance the per-tier times are tuned at (a 1080p board, corner to corner). */
export const FIRE_REF_DISTANCE = 1600;

/** A travel time for a distance: the tuned time, scaled gently by the distance (a sandbox box stays readable). */
export function fireTravelMs(distance: number, tunedMs: number): number {
  const d = Number.isFinite(distance) && distance > 0 ? distance : FIRE_REF_DISTANCE;
  return Math.round(tunedMs * clamp(Math.sqrt(d / FIRE_REF_DISTANCE), 0.6, 1.15));
}

/**
 * The fan of a volley, in LAUNCH order: outer fireballs first, the centre one last (the volley closes in, and the last
 * to land, THE impact, is the biggest and flies the straightest line). Signed slots: 0 = the centre.
 */
export function fireSlots(n: number): number[] {
  if (n <= 1) return [0];
  if (n === 2) return [-1, 1];
  const out: number[] = [];
  const half = Math.floor(n / 2);
  for (let k = half; k >= 1; k--) { out.push(-k); out.push(k); }
  if (n % 2 === 1) out.push(0);
  return out.slice(0, n);
}

export interface FireballPlan {
  /** The fireball ignites. */
  formAt: number;
  /** It leaves (the draw back comes just before this). */
  launchAt: number;
  flightMs: number;
  arriveAt: number;
  /** Signed fan slot (0 = the centre line). */
  slot: number;
  /** Size multiplier (the last is the biggest). */
  size: number;
}

export interface FirePlanInput extends AttackTierContext {
  /** When the style's own attack starts: the end of the shared damage formation (`formationPlan().endAt`). */
  leadIn?: number;
  /** THE blow, as the engine decided it. */
  total: number;
  /** Screen px between the attacker's and the defender's centres. */
  distance: number;
  reduced?: boolean;
}

export interface FirePlan {
  reduced: boolean;
  tier: TierNum;
  /** 0..1 across the tiers (I = 0, IV = 1). */
  k: number;
  total: number;
  /** The total dives into the hero, fire catches round its rim, the first fireball ignites. */
  chargeAt: number;
  absorbEnd: number;
  /** The first fireball leaves. */
  fireAt: number;
  balls: FireballPlan[];
  /** Tier IV: the meteor follows the fireballs and carries the blow. */
  meteor: boolean;
  /** Tier IV: the hero hurls a column of fire into the sky (else the impact). */
  summonAt: number;
  /** Tier IV: the meteor appears above the screen and falls (else the impact). */
  meteorAt: number;
  /** Fireballs that land BEFORE the impact, sequence ms: the rhythm ticks. */
  hits: number[];
  /** THE consequence beat: the last fireball bursts (I-III) or the meteor detonates (IV). */
  impactAt: number;
  /** Aftershock bursts round the target (IV). */
  booms: number[];
  endAt: number;
  shakePx: number;
  zoom: number;
  punch: number;
  burst: number;
  /** How hard the struck portrait's rim burns after the impact (0 = not at all) and for how long. */
  blaze: number;
  blazeMs: number;
  embers: number;
  arc: number;
  dim: number;
}

/** The whole Fire attack, in base ms (divide by the playback speed for real time). Pure and deterministic. */
export function firePlan(input: FirePlanInput, c: HeroFireConfig = cfg): FirePlan {
  const total = Math.max(0, Math.round(input.total));
  const tier = attackTier(total, input, c); // a knockout always plays Tier IV (heroAttack/tiers.ts)
  const T = fireTierDials(tier, c);
  const k = (tier - 1) / 3;

  if (input.reduced) {
    const r = reducedAttackTimeline(input.leadIn ?? 0, c.reducedFadeMs);
    const { impactAt } = r;
    return {
      reduced: true, tier, k, total,
      chargeAt: impactAt, absorbEnd: impactAt, fireAt: impactAt, balls: [], meteor: false, summonAt: impactAt, meteorAt: impactAt,
      hits: [], impactAt, booms: [], endAt: r.endAt, shakePx: 0, zoom: 0, punch: 0, burst: 0, blaze: 0, blazeMs: 0, embers: 0,
      arc: 0, dim: 0,
    };
  }

  const chargeAt = Math.max(0, input.leadIn ?? 0);
  const absorbEnd = chargeAt + c.absorbMs;
  const fireAt = chargeAt + Math.max(T.FormMs, c.absorbMs);
  const meteor = T.Meteor >= 1;
  const count = clamp(Math.round(T.Balls), 1, FIRE_CAPS.balls);
  const flight = fireTravelMs(input.distance, T.FlightMs);
  const slots = fireSlots(count);
  // They ignite one after another from just after the total lands in the hero, each alight before it leaves.
  const formStep = count > 1 ? Math.min(110, Math.max(0, T.FormMs - c.growMs - 60) / (count - 1)) : 0;
  const balls: FireballPlan[] = slots.map((slot, i) => {
    const launchAt = fireAt + i * T.LaunchStaggerMs;
    const formAt = Math.max(chargeAt, Math.min(chargeAt + 60 + i * formStep, launchAt - c.pullMs - c.growMs));
    const last = i === count - 1;
    return { formAt, launchAt, flightMs: flight, arriveAt: launchAt + flight, slot, size: T.BallSize * (last && count > 1 ? 1.2 : 1) };
  });
  const lastLaunch = balls[balls.length - 1]!.launchAt;
  const lastIn = Math.max(...balls.map((r) => r.arriveAt));
  let summonAt = lastIn, meteorAt = lastIn, impactAt = lastIn;
  if (meteor) {
    summonAt = Math.max(lastLaunch + 90, lastIn - 80);
    meteorAt = summonAt + c.summonMs;
    impactAt = meteorAt + fireTravelMs(input.distance, c.meteorMs);
  }
  const hits = balls.map((r) => r.arriveAt).filter((at) => meteor || at < impactAt).sort((a, b) => a - b);
  const booms = meteor ? [impactAt + 170, impactAt + 330] : [];
  const lastBeat = Math.max(
    impactAt + 160,
    booms.length ? booms[booms.length - 1]! + 120 : 0,
    impactAt + c.zoomOutMs * 0.8,
    meteor ? impactAt + Math.min(900, c.novaMs + 300) : 0,
  );
  const endAt = lastBeat + T.SettleMs;

  return {
    reduced: false, tier, k, total, chargeAt, absorbEnd, fireAt,
    balls, meteor, summonAt, meteorAt, hits, impactAt, booms, endAt,
    shakePx: clamp(T.Shake, 0, FIRE_CAPS.shakePx),
    zoom: clamp(T.Zoom, 0, FIRE_CAPS.zoom),
    punch: T.Punch,
    burst: T.Burst,
    blaze: Math.max(0, T.Blaze),
    blazeMs: Math.max(0, T.BlazeMs),
    embers: Math.round(clamp(T.Embers, 0, FIRE_CAPS.embers)),
    arc: T.Arc,
    dim: T.Dim,
  };
}

export type FireCueKind = 'charge' | 'grow' | 'fire' | 'hit' | 'summon' | 'meteor' | 'impact' | 'boom' | 'end';
export interface FireCue { at: number; kind: FireCueKind; i: number }

/** Every beat the runner fires, in time order (ties keep this declaration order, so a hit precedes the impact). */
export function fireCues(p: FirePlan): FireCue[] {
  const out: FireCue[] = [];
  if (!p.reduced) {
    out.push({ at: p.chargeAt, kind: 'charge', i: 0 });
    p.balls.forEach((r, i) => out.push({ at: r.formAt, kind: 'grow', i }));
    p.balls.forEach((r, i) => out.push({ at: r.launchAt, kind: 'fire', i }));
    // Every fireball but the last lands as a tick (Tier IV: every one; the meteor carries the blow).
    p.balls.forEach((r, i) => { if (p.meteor || i < p.balls.length - 1) out.push({ at: r.arriveAt, kind: 'hit', i }); });
    if (p.meteor) {
      out.push({ at: p.summonAt, kind: 'summon', i: 0 });
      out.push({ at: p.meteorAt, kind: 'meteor', i: 0 });
    }
  }
  out.push({ at: p.impactAt, kind: 'impact', i: 0 });
  p.booms.forEach((at, i) => out.push({ at, kind: 'boom', i }));
  out.push({ at: p.endAt, kind: 'end', i: 0 });
  const order: Record<FireCueKind, number> = { charge: 1, grow: 2, fire: 3, hit: 4, summon: 5, meteor: 6, impact: 7, boom: 8, end: 9 };
  return out.map((q, idx) => ({ q, idx })).sort((a, b) => a.q.at - b.q.at || order[a.q.kind] - order[b.q.kind] || a.idx - b.idx).map((x) => x.q);
}

// ─── the fireball paths (pure) ─────────────────────────────────────────────────────────────────────────────────

/**
 * A fireball's whole life, in SEQUENCE ms: it ignites at `home` and swells to `radius`, hovers, draws back toward
 * `from`, and flies from `from` to `to` (its hit point) on a gentle quadratic through `ctrl`.
 */
export interface FireballMotion {
  home: Pt;
  /** Its radius in px at full size (size and stage scale folded in). */
  radius: number;
  formAt: number; growMs: number;
  pullAt: number; launchAt: number; arriveAt: number;
  from: Pt; ctrl: Pt; to: Pt;
  /** A small bob while it hovers (phase). */
  phase: number;
}

/** Where a fireball is: its centre, its heading, its growth (0..~1.1) and whether it is in flight or has landed. */
export interface FireballPose { x: number; y: number; rot: number; grow: number; flying: boolean; landed: boolean }

/** The flight ease: it leaves already fast and still ACCELERATES into the target. */
export const flightEase = (u: number): number => { const t = Math.min(1, Math.max(0, Number.isFinite(u) ? u : 0)); return 0.7 * t + 0.3 * t * t; };

const quad = (a: number, b: number, c: number, t: number): number => { const m = 1 - t; return m * m * a + 2 * m * t * b + t * t * c; };

/** A point on a fireball's flight at curve parameter `e` (0..1). */
export function flightPoint(m: FireballMotion, e: number): Pt {
  return { x: quad(m.from.x, m.ctrl.x, m.to.x, e), y: quad(m.from.y, m.ctrl.y, m.to.y, e) };
}

/** The heading along the flight at curve parameter `e` (the tangent). */
export function flightRot(m: FireballMotion, e: number): number {
  const t = Math.min(1, Math.max(0, e));
  const dx = 2 * (1 - t) * (m.ctrl.x - m.from.x) + 2 * t * (m.to.x - m.ctrl.x);
  const dy = 2 * (1 - t) * (m.ctrl.y - m.from.y) + 2 * t * (m.to.y - m.ctrl.y);
  return Math.atan2(dy, dx);
}

/** Where the fireball is at sequence time `t`. Pure. */
export function fireballPose(m: FireballMotion, t: number): FireballPose {
  const aimRot = Math.atan2(m.to.y - m.home.y, m.to.x - m.home.x);
  if (t < m.launchAt) {
    if (t < m.formAt) return { x: m.home.x, y: m.home.y, rot: aimRot, grow: 0, flying: false, landed: false };
    // Igniting: it swells out of a spark (a little overshoot, then it settles and roils).
    const g = easeOutBack(Math.min(1, (t - m.formAt) / Math.max(1, m.growMs)), 1.3);
    const bob = 2 * Math.sin((t - m.formAt) * 0.008 + m.phase) * Math.min(1, (t - m.formAt) / 300);
    const pull = t >= m.pullAt ? easeOutCubic((t - m.pullAt) / Math.max(1, m.launchAt - m.pullAt)) : 0;
    return {
      x: m.home.x + (m.from.x - m.home.x) * pull,
      y: m.home.y + (m.from.y - m.home.y) * pull + bob,
      rot: aimRot, grow: g, flying: false, landed: false,
    };
  }
  if (t >= m.arriveAt) return { x: m.to.x, y: m.to.y, rot: flightRot(m, 1), grow: 1, flying: false, landed: true };
  const e = flightEase((t - m.launchAt) / Math.max(1, m.arriveAt - m.launchAt));
  const p = flightPoint(m, e);
  return { x: p.x, y: p.y, rot: flightRot(m, e), grow: 1, flying: true, landed: false };
}

/**
 * Every fireball's whole life, from the plan and the two heroes. They ignite in a fan round the striking portrait's rim
 * on the side facing the target (never over the face, never above the top of the screen), each aimed at its own hit
 * point spread across the struck portrait (the centre one, the last, at its heart). Pure, so a replay flies the same
 * paths and the tests can check them.
 */
export function fireballMotions(
  p: FirePlan, a: Pt, d: Pt, aRadius: number, dRadius: number, c: HeroFireConfig = cfg, scale = 1, ceilY = Number.NEGATIVE_INFINITY,
): FireballMotion[] {
  if (p.reduced) return [];
  const n = p.balls.length;
  const dx = d.x - a.x, dy = d.y - a.y;
  const dist = Math.hypot(dx, dy) || 1;
  const u = { x: dx / dist, y: dy / dist };
  const nrm = { x: -u.y, y: u.x };
  const base = Math.atan2(u.y, u.x);
  const maxSlot = Math.max(1, ...p.balls.map((r) => Math.abs(r.slot)));
  return p.balls.map((r, i) => {
    const f = n === 1 ? 0 : n === 2 ? r.slot * 0.42 : r.slot / maxSlot;
    const ang = base + f * ((c.formSpread * Math.PI) / 180) * 0.5;
    const rad = aRadius * c.formRadius * (1 + 0.06 * Math.abs(f));
    const radius = c.ballRadius * r.size * scale;
    const home = { x: a.x + Math.cos(ang) * rad, y: Math.max(ceilY + radius, a.y + Math.sin(ang) * rad) };
    const hitOff = n === 1 ? 0 : (r.slot / maxSlot) * dRadius * 0.34;
    const to = { x: d.x + nrm.x * hitOff, y: d.y + nrm.y * hitOff };
    const ax = to.x - home.x, ay = to.y - home.y;
    const al = Math.hypot(ax, ay) || 1;
    const aim = { x: ax / al, y: ay / al };
    const from = { x: home.x - aim.x * c.pullBackPx * scale, y: home.y - aim.y * c.pullBackPx * scale };
    const fl = Math.hypot(to.x - from.x, to.y - from.y) || 1;
    const side = (r.slot === 0 ? (i % 2 ? -1 : 1) : Math.sign(r.slot)) * p.arc;
    // A gentle arc off the line (never above the top of the screen), so a fan converges from its own angles.
    const ctrl = {
      x: (from.x + to.x) / 2 + (-(to.y - from.y) / fl) * side * fl,
      y: Math.max(ceilY, (from.y + to.y) / 2 + ((to.x - from.x) / fl) * side * fl),
    };
    return {
      home, radius, formAt: r.formAt, growMs: c.growMs, pullAt: Math.max(r.formAt + c.growMs, r.launchAt - c.pullMs),
      launchAt: r.launchAt, arriveAt: r.arriveAt, from, ctrl, to, phase: i * 1.7,
    };
  });
}

/** The direction the blow ARRIVES from (the last fireball's heading as it lands, or the line of fire). Unit. */
export function fireArrivalDir(m: FireballMotion | undefined, a: Pt, d: Pt): Pt {
  if (m) { const r = flightRot(m, 1); return { x: Math.cos(r), y: Math.sin(r) }; }
  const L = Math.hypot(d.x - a.x, d.y - a.y) || 1;
  return { x: (d.x - a.x) / L, y: (d.y - a.y) / L };
}

// ─── the meteor (pure) ─────────────────────────────────────────────────────────────────────────────────────────

/** Tier IV's meteor: it streaks from above the top of the screen (on the attacker's side) down onto the struck hero. */
export interface MeteorMotion {
  from: Pt; to: Pt;
  /** Unit direction of travel. */
  dir: Pt;
  startAt: number; contactAt: number;
  /** Its radius (px). */
  radius: number;
}

/** The meteor's fall: it streaks in already fast and still ACCELERATES all the way in. */
export const meteorEase = (u: number): number => { const t = Math.min(1, Math.max(0, Number.isFinite(u) ? u : 0)); return 0.5 * t + 0.5 * t * t; };

export function meteorMotion(p: FirePlan, a: Pt, d: Pt, dRadius: number, c: HeroFireConfig = cfg, ceilY = 0): MeteorMotion | null {
  if (p.reduced || !p.meteor) return null;
  const radius = dRadius * 0.5 * c.meteorSize;
  // It streaks in from above the frame on the attacker's side, on a LOW diagonal (so most of its fall is on screen even
  // when the struck hero sits at the very top of it), starting just out of view.
  const side = d.x >= a.x ? -1 : 1;
  const fromY = ceilY - radius * 1.2;
  const drop = d.y - fromY;
  const from = { x: d.x + side * clamp(drop * 0.9, dRadius * 7, dRadius * 11), y: fromY };
  const L = Math.hypot(d.x - from.x, d.y - from.y) || 1;
  return { from, to: { ...d }, dir: { x: (d.x - from.x) / L, y: (d.y - from.y) / L }, startAt: p.meteorAt, contactAt: p.impactAt, radius };
}

/** Where the meteor is at sequence time `t` (and how far along its fall, 0..1). */
export function meteorPose(m: MeteorMotion, t: number): { x: number; y: number; u: number; live: boolean } {
  const u = Math.min(1, Math.max(0, (t - m.startAt) / Math.max(1, m.contactAt - m.startAt)));
  const e = meteorEase(u);
  return { x: m.from.x + (m.to.x - m.from.x) * e, y: m.from.y + (m.to.y - m.from.y) * e, u, live: t >= m.startAt && t < m.contactAt };
}

// ─── the camera (pure) ─────────────────────────────────────────────────────────────────────────────────────────

const springAt = (ms: number, hz: number, tau: number): number => (ms < 0 ? 0 : Math.exp(-ms / tau) * Math.cos(2 * Math.PI * hz * (ms / 1000)));

/**
 * The camera at sequence time `t` (px in the space the points are in). A push in on the hero while the fireballs
 * ignite; a small recoil kick on each launch; a kick ALONG the throw on each tick; on THE impact a punch in and a
 * directional shake. Tier IV: the push eases off for the summon (a kick back as the column goes up), a rumble grows as
 * the meteor falls, and the detonation punches hardest with a shake that rings both ways. Deterministic. Pure.
 */
export function fireCameraAt(p: FirePlan, c: HeroFireConfig, t: number, dir: Pt = { x: 1, y: 0 }): { zoom: number; x: number; y: number } {
  if (p.reduced) return { zoom: 1, x: 0, y: 0 };
  let z = 0;
  const sine = (u: number): number => easeInOutSine(u);
  if (t >= p.chargeAt && t < p.impactAt) {
    z += p.zoom * sine((t - p.chargeAt) / Math.max(1, p.fireAt - p.chargeAt));
    if (p.meteor) {
      const lastIn = p.hits.length ? p.hits[p.hits.length - 1]! : p.fireAt;
      const from = Math.min(lastIn, p.summonAt);
      if (t >= from) z -= p.zoom * 0.6 * sine((t - from) / Math.max(1, p.meteorAt - from));
      if (t >= p.meteorAt) z += p.zoom * 1.2 * sine((t - p.meteorAt) / Math.max(1, p.impactAt - p.meteorAt));
    }
  } else if (t >= p.impactAt) {
    const since = t - p.impactAt;
    z += (p.zoom * (p.meteor ? 2.1 : 1) + p.punch) * Math.exp(-since / Math.max(1, c.zoomOutMs / 4));
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
  p.balls.forEach((r) => kick(r.launchAt, -p.shakePx * 0.1, 45, 14, dir));
  p.hits.forEach((at, i) => kick(at, p.shakePx * (0.24 + 0.04 * i) * (p.meteor ? 0.8 : 1), 45, 17, dir));
  if (p.meteor) {
    // The column kicks the view up; the fall rumbles harder as the meteor nears; the detonation rings both ways.
    kick(p.summonAt, p.shakePx * 0.3, 60, 12, { x: 0, y: -1 });
    if (t >= p.meteorAt && t < p.impactAt) {
      const u = (t - p.meteorAt) / Math.max(1, p.impactAt - p.meteorAt);
      const a = p.shakePx * (0.04 + 0.16 * u * u);
      x += a * Math.sin(t * 0.13);
      y += a * Math.sin(t * 0.17 + 1.1);
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
 * Where the camera anchors: the ATTACKER while the fireballs ignite, following the volley in flight, and the DEFENDER
 * from the impact on. Tier IV: back toward the attacker for the summon, then following the meteor down onto the
 * target. A zoom anchored on a point keeps that point still. Pure.
 */
export function fireCameraFocus(p: FirePlan, t: number, a: Pt, d: Pt): Pt {
  const lerp = (e: number): Pt => ({ x: a.x + (d.x - a.x) * e, y: a.y + (d.y - a.y) * e });
  if (t <= p.fireAt) return a;
  if (!p.meteor) {
    if (t >= p.impactAt) return d;
    return lerp(flightEase((t - p.fireAt) / Math.max(1, p.impactAt - p.fireAt)));
  }
  if (t >= p.impactAt) return d;
  const lastIn = p.hits.length ? p.hits[p.hits.length - 1]! : p.fireAt;
  const back = Math.min(lastIn, p.summonAt);
  if (t < back) return lerp(flightEase((t - p.fireAt) / Math.max(1, back - p.fireAt)));
  // Half way home for the summon (both heroes stay in frame), then down onto the target with the meteor.
  if (t < p.meteorAt) return lerp(1 - 0.5 * easeInOutSine((t - back) / Math.max(1, p.meteorAt - back)));
  return lerp(0.5 + 0.5 * meteorEase((t - p.meteorAt) / Math.max(1, p.impactAt - p.meteorAt)));
}
