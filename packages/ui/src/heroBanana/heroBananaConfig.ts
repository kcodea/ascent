/**
 * THE BANANA BARRAGE HERO ATTACK (Oona's Banana Cannon): its tuned values, its pure timeline, the pure banana paths and
 * the pure camera.
 *
 * Owner 2026-09-29: "make some more attack types ... i would love a king oona banana cannon animation. use the same 4
 * tier strategy we have been." Then, after the first cut (a canvas-drawn cannon, peels and a comic star): "the banana
 * cannon attack is a 3/10. use oona's animation as a guideline. improve this dramatically." So this attack is built on
 * King Oona's OWN card FX (`fx/defs/oona-banana.json`): the PAINTED banana sprite sheet (`defs/images/banana.png`, a
 * glossy banana tumbling through 16 frames) lobbed on a bowed arc, the PAINTED juice splat sheet (`defs/images/chatgpt-
 * image-sep-25-2026-09-40-24-am.png`, a yellow splat bursting and dissipating) on the target, Oona's gold / amber juice
 * particle bursts at the source, along the flight and at the target, and Oona's own clips (`fx/oona-launch`,
 * `fx/oona-splat`, `fx/oona-powerup`). There is no drawn cannon: King Oona himself flings the bananas out of the hero in
 * a golden jungle flourish, and the painted bananas and splats are the stars.
 *
 * THE BEATS (base ms before the playback speed):
 *  1. THE DAMAGE FORMATION (shared by every style, `../heroAttack/damageFormation.ts`). Its end is this style's start.
 *  2. FLOURISH. The total sinks into the hero; a golden bloom and a ring open on it, gold motes are drawn in, and the
 *     hero coils back.
 *  3. FLING. Each banana bursts out of the hero with Oona's orange-gold spark burst and a flash, and TUMBLES (the painted
 *     sheet looping at Oona's 41 fps) along a high bowed arc, shedding gold juice sparkles: I one; II a double; III a
 *     barrage of eight on varied arcs.
 *  4. SPLAT. Each banana bursts on the struck portrait into the painted juice splat and Oona's juice burst. Every banana
 *     before the last is a TICK (FX and sound only). The LAST is THE impact: layered splats (one big, the rest round
 *     it), the biggest juice burst, a flash and a ring, the knockback. The consequence (the damage, Armor, Resolve)
 *     lands ONCE, there.
 *  IV. THE ROYAL BANANA. Four quick bananas splat in (ticks). The hero blazes gold (a halo builds, motes pour in), then
 *     flings a GIANT GOLDEN BANANA (the same painted banana, huge, gilded, glowing) high into the air. It HANGS at the top
 *     of its arc (slow, tumbling) while a crown-shaped glint flashes on it and a flat golden target ring locks on to the
 *     struck hero; then it drops fast and SLAMS: a massive layered splat, a RING of splats round it, a golden shockwave,
 *     gold rays, a huge juice burst and a SHOWER of painted bananas bursting up and raining down; then a few splat pops.
 *
 * TIERS are the shared, owner-approved thresholds (I 1-5, II 6-11, III 12-19, IV 20+). No hit-stop anywhere (owner
 * 2026-09-28: "it looks like lag"). Flat 2D: every ring and marker is a full circle, never a perspective ellipse. Reduced
 * motion: no bananas, shake or zoom; the numbers fade and the blow lands.
 *
 * Tuner convention (the Blast's): localStorage in DEV only, values clamped on write and on load; production always
 * plays DEFAULTS. The preview speed is how you are LOOKING and is never saved.
 */
import { clamp, hexToNum, type Pt } from '../heroAttack/easing';
import {
  HERO_ATTACK_TIER_THRESHOLDS, TIERS, reducedAttackTimeline, tierOf, type TierNum,
} from '../heroAttack/tiers';

export { TIERS, hexToNum, type TierNum };

/** The per-tier dials. A config key is `t1..t4` + one of these. */
export const BANANA_TIER_SUFFIXES = [
  'ChargeMs', 'Shots', 'ShotStaggerMs', 'FlightMs', 'Arc', 'Fan', 'BananaSize', 'Giant',
  'Shake', 'Zoom', 'Punch', 'Juice', 'Burst', 'Splats', 'SettleMs', 'Dim',
] as const;
export type BananaTierSuffix = (typeof BANANA_TIER_SUFFIXES)[number];
type TierKey = `t${TierNum}${BananaTierSuffix}`;

interface GlobalConfig {
  // Tiers (the shared thresholds; DEV-tunable only)
  tier2At: number; tier3At: number; tier4At: number;
  // The flourish and the fling
  absorbMs: number;
  heroCoilPx: number;
  heroFlingPx: number;
  launchSparks: number;
  // Bananas (Oona's painted sheet)
  bananaPx: number;
  spinTurns: number;
  trailSparks: number;
  // The splat (Oona's painted sheet + juice burst)
  splatPx: number;
  splatMs: number;
  tickJuice: number;
  juiceSpeed: number;
  juiceLifeMs: number;
  juicePx: number;
  // The royal banana (Tier IV)
  giantChargeMs: number;
  giantFlightMs: number;
  giantSize: number;
  giantLift: number;
  giantHangY: number;
  giantHang: number;
  giantSplat: number;
  // The jam (Tier IV): the giant lands ON the struck hero and the striking hero pounds it in
  slamCount: number;
  dashMs: number;
  slamGapMs: number;
  slamGapGrow: number;
  slamPullPx: number;
  finisherWindMs: number;
  finisherZoom: number;
  homeMs: number;
  jamDepthStart: number;
  jamDepthEnd: number;
  bloodStart: number;
  bloodAmount: number;
  juiceDrips: number;
  dripMs: number;
  ringSplats: number;
  showerBananas: number;
  shockSize: number;
  goldRays: number;
  flashAlpha: number;
  // Camera and portraits
  knockPx: number;
  squash: number;
  shakeMs: number;
  zoomOutMs: number;
  reducedFadeMs: number;
  // Colours
  colorJuice: string;
  colorAmber: string;
  colorCream: string;
  colorGold: string;
  colorSpark: string;
  colorPlayer: string;
  colorFoe: string;
  // Sound: a clip, a gain and a pitch per cue ('' = silent)
  sfxLaunchClip: string; sfxLaunchGain: number; sfxLaunchRate: number;
  sfxWhooshClip: string; sfxWhooshGain: number; sfxWhooshRate: number;
  sfxSplatClip: string; sfxSplatGain: number; sfxSplatRate: number;
  sfxPowerClip: string; sfxPowerGain: number; sfxPowerRate: number;
  sfxImpactClip: string; sfxImpactGain: number; sfxImpactRate: number;
  sfxChargeClip: string; sfxChargeGain: number; sfxChargeRate: number;
  sfxGlintClip: string; sfxGlintGain: number; sfxGlintRate: number;
  sfxDropClip: string; sfxDropGain: number; sfxDropRate: number;
  sfxSlamClip: string; sfxSlamGain: number; sfxSlamRate: number;
  sfxBoomClip: string; sfxBoomGain: number; sfxBoomRate: number;
  sfxImpactLenMs: number;
  sfxTailMix: number;
  sfxDuck: number;
  // Preview only (the tuner's Play buttons). Never read by a real fight, and left out of Copy JSON.
  previewDamage: number;
  previewParts: number;
}
export type HeroBananaConfig = GlobalConfig & Record<TierKey, number>;

export const HERO_BANANA_COLOR_KEYS = ['colorJuice', 'colorAmber', 'colorCream', 'colorGold', 'colorSpark', 'colorPlayer', 'colorFoe'] as const;
export const HERO_BANANA_CLIP_KEYS = [
  'sfxLaunchClip', 'sfxWhooshClip', 'sfxSplatClip', 'sfxPowerClip', 'sfxImpactClip', 'sfxChargeClip', 'sfxGlintClip',
  'sfxDropClip', 'sfxSlamClip', 'sfxBoomClip',
] as const;
type ColorKey = (typeof HERO_BANANA_COLOR_KEYS)[number];
type ClipKey = (typeof HERO_BANANA_CLIP_KEYS)[number];
export type HeroBananaStrKey = ColorKey | ClipKey;
export type HeroBananaNumKey = Exclude<keyof HeroBananaConfig, HeroBananaStrKey>;

/** Tier I .. IV per suffix: the escalation ladder. */
const TIER_DEFAULTS: Record<BananaTierSuffix, [number, number, number, number]> = {
  ChargeMs: [340, 360, 400, 420],
  Shots: [1, 2, 8, 4],
  ShotStaggerMs: [0, 190, 95, 120],
  FlightMs: [660, 640, 600, 580],
  Arc: [0.3, 0.32, 0.27, 0.28],
  Fan: [0, 0.06, 0.13, 0.08],
  BananaSize: [1.1, 1.1, 1, 1],
  Giant: [0, 0, 0, 1],
  Shake: [5, 7, 10, 20],
  Zoom: [0.02, 0.03, 0.04, 0.07],
  Punch: [0.015, 0.022, 0.03, 0.055],
  Juice: [70, 90, 120, 200],
  Burst: [1.1, 1.25, 1.45, 1],
  Splats: [1, 2, 3, 6],
  SettleMs: [260, 280, 320, 340],
  Dim: [0, 0.16, 0.28, 0.45],
};

export const BANANA_TIER_RANGES: Record<BananaTierSuffix, [number, number, number]> = {
  ChargeMs: [120, 1500, 10],
  Shots: [1, 12, 1],
  ShotStaggerMs: [0, 500, 5],
  FlightMs: [200, 1500, 10],
  Arc: [0, 0.6, 0.01],
  Fan: [0, 0.3, 0.01],
  BananaSize: [0.4, 2.5, 0.05],
  Giant: [0, 1, 1],
  Shake: [0, 40, 0.5],
  Zoom: [0, 0.14, 0.002],
  Punch: [0, 0.1, 0.001],
  Juice: [0, 300, 1],
  Burst: [0.3, 3, 0.05],
  Splats: [1, 8, 1],
  SettleMs: [0, 1600, 10],
  Dim: [0, 0.8, 0.01],
};

const tierDefaults = Object.fromEntries(TIERS.flatMap((t) => BANANA_TIER_SUFFIXES.map((s) => [`t${t}${s}`, TIER_DEFAULTS[s][t - 1]]))) as Record<TierKey, number>;

export const HERO_BANANA_DEFAULTS: HeroBananaConfig = {
  // The shared, owner-approved thresholds (6 / 12 / 20): the same blow steps the bananas up exactly where it steps Blast up.
  ...HERO_ATTACK_TIER_THRESHOLDS,
  absorbMs: 190,
  heroCoilPx: 10,
  heroFlingPx: 14,
  launchSparks: 11,
  bananaPx: 108,
  spinTurns: 2.5,
  trailSparks: 1,
  splatPx: 150,
  splatMs: 480,
  tickJuice: 40,
  juiceSpeed: 435,
  juiceLifeMs: 450,
  juicePx: 35,
  giantChargeMs: 540,
  giantFlightMs: 1050,
  giantSize: 3.2,
  giantLift: 1,
  giantHangY: 190,
  giantHang: 0.7,
  giantSplat: 3.4,
  slamCount: 6,
  dashMs: 240,
  slamGapMs: 420,
  slamGapGrow: 0.2,
  slamPullPx: 150,
  finisherWindMs: 1000,
  finisherZoom: 0.08,
  homeMs: 480,
  jamDepthStart: 0.3,
  jamDepthEnd: 0.86,
  bloodStart: 4,
  bloodAmount: 1,
  juiceDrips: 1,
  dripMs: 2600,
  ringSplats: 7,
  showerBananas: 14,
  shockSize: 1,
  goldRays: 10,
  flashAlpha: 0.85,
  knockPx: 18,
  squash: 0.1,
  shakeMs: 340,
  zoomOutMs: 380,
  reducedFadeMs: 260,
  // Oona's own juice palette (her target burst: #fce400 / #ebb912 / #ffc714 / #ffffe0) and her launch spark orange.
  colorJuice: '#fce400',
  colorAmber: '#ebb912',
  colorCream: '#ffffe0',
  colorGold: '#ffc714',
  colorSpark: '#ff6d2c',
  colorPlayer: '#ffd83d',
  colorFoe: '#ff7a3d',
  // Oona's own clips first (launch on the fling, splat + power-up on the hit), then a few for the royal banana.
  sfxLaunchClip: 'fx/oona-launch', sfxLaunchGain: 0.5, sfxLaunchRate: 1,
  sfxWhooshClip: 'fx/stereogenicstudio-swish-swoosh-woosh-sfx-27-357164-3', sfxWhooshGain: 0.18, sfxWhooshRate: 1.1,
  sfxSplatClip: 'fx/oona-splat', sfxSplatGain: 0.5, sfxSplatRate: 1,
  sfxPowerClip: 'fx/oona-powerup', sfxPowerGain: 0.45, sfxPowerRate: 1.1,
  sfxImpactClip: 'smack2', sfxImpactGain: 0.3, sfxImpactRate: 1.05,
  sfxChargeClip: 'fx/oona-powerup', sfxChargeGain: 0.55, sfxChargeRate: 0.85,
  sfxGlintClip: 'fx/djartmusic-christmas-sparkle-whoosh-1-275404', sfxGlintGain: 0.3, sfxGlintRate: 1.15,
  sfxDropClip: 'fx/metal-woosh', sfxDropGain: 0.4, sfxDropRate: 0.7,
  sfxSlamClip: 'fx/heavy-rock-impact', sfxSlamGain: 0.55, sfxSlamRate: 1,
  sfxBoomClip: 'fx/oona-splat', sfxBoomGain: 0.3, sfxBoomRate: 1.45,
  sfxImpactLenMs: 1100,
  sfxTailMix: 0.1,
  sfxDuck: 0.5,
  previewDamage: 12,
  previewParts: 4,
  ...tierDefaults,
};

const GLOBAL_RANGES: Record<Exclude<keyof GlobalConfig, HeroBananaStrKey>, [number, number, number]> = {
  tier2At: [2, 40, 1], tier3At: [2, 60, 1], tier4At: [2, 80, 1],
  absorbMs: [60, 600, 10],
  heroCoilPx: [0, 40, 1],
  heroFlingPx: [0, 50, 1],
  launchSparks: [0, 40, 1],
  bananaPx: [30, 240, 1],
  spinTurns: [0, 8, 0.05],
  trailSparks: [0, 3, 0.05],
  splatPx: [40, 400, 1],
  splatMs: [120, 1500, 10],
  tickJuice: [0, 120, 1],
  juiceSpeed: [50, 1500, 5],
  juiceLifeMs: [100, 1500, 10],
  juicePx: [4, 100, 1],
  giantChargeMs: [150, 2000, 10],
  giantFlightMs: [300, 2500, 10],
  giantSize: [1, 6, 0.05],
  giantLift: [0.1, 1.6, 0.01],
  giantHangY: [0, 500, 5],
  giantHang: [0, 0.95, 0.01],
  giantSplat: [1, 6, 0.05],
  slamCount: [1, 8, 1],
  dashMs: [80, 800, 10],
  slamGapMs: [120, 1200, 10],
  slamGapGrow: [0, 1, 0.01],
  slamPullPx: [0, 320, 1],
  finisherWindMs: [150, 2000, 10],
  finisherZoom: [0, 0.14, 0.002],
  homeMs: [150, 1500, 10],
  jamDepthStart: [0, 0.8, 0.01],
  jamDepthEnd: [0.2, 0.97, 0.01],
  bloodStart: [1, 9, 1],
  bloodAmount: [0, 3, 0.05],
  juiceDrips: [0, 3, 0.05],
  dripMs: [600, 6000, 50],
  ringSplats: [0, 12, 1],
  showerBananas: [0, 30, 1],
  shockSize: [0.3, 3, 0.05],
  goldRays: [0, 24, 1],
  flashAlpha: [0, 1, 0.01],
  knockPx: [0, 60, 1],
  squash: [0, 0.3, 0.01],
  shakeMs: [0, 1200, 10],
  zoomOutMs: [60, 1500, 10],
  reducedFadeMs: [60, 1000, 10],
  sfxLaunchGain: [0, 2, 0.05], sfxLaunchRate: [0.5, 2.5, 0.01],
  sfxWhooshGain: [0, 2, 0.05], sfxWhooshRate: [0.5, 2.5, 0.01],
  sfxSplatGain: [0, 2, 0.05], sfxSplatRate: [0.5, 2.5, 0.01],
  sfxPowerGain: [0, 2, 0.05], sfxPowerRate: [0.5, 2.5, 0.01],
  sfxImpactGain: [0, 2, 0.05], sfxImpactRate: [0.5, 2.5, 0.01],
  sfxChargeGain: [0, 2, 0.05], sfxChargeRate: [0.5, 2.5, 0.01],
  sfxGlintGain: [0, 2, 0.05], sfxGlintRate: [0.5, 2.5, 0.01],
  sfxDropGain: [0, 2, 0.05], sfxDropRate: [0.5, 2.5, 0.01],
  sfxSlamGain: [0, 2, 0.05], sfxSlamRate: [0.5, 2.5, 0.01],
  sfxBoomGain: [0, 2, 0.05], sfxBoomRate: [0.5, 2.5, 0.01],
  sfxImpactLenMs: [150, 3500, 10],
  sfxTailMix: [0, 0.6, 0.01],
  sfxDuck: [0, 1, 0.05],
  previewDamage: [1, 60, 1],
  previewParts: [1, 8, 1],
};

/** [min, max, step] per numeric key. Values outside are clamped on write AND on load. */
export const HERO_BANANA_RANGES: Record<HeroBananaNumKey, [number, number, number]> = {
  ...GLOBAL_RANGES,
  ...(Object.fromEntries(TIERS.flatMap((t) => BANANA_TIER_SUFFIXES.map((s) => [`t${t}${s}`, BANANA_TIER_RANGES[s]]))) as Record<TierKey, [number, number, number]>),
};

/** The hard ceilings a plan can never exceed, whatever the sliders say (so a 40 stays juicy, not cluttered). */
export const BANANA_CAPS = { shots: 12, juice: 300, splats: 8, ringSplats: 12, shower: 30, shakePx: 40, zoom: 0.14 } as const;

const HEX = /^#[0-9a-f]{6}$/i;
const isColorKey = (k: string): k is ColorKey => (HERO_BANANA_COLOR_KEYS as readonly string[]).includes(k);
const isClipKey = (k: string): k is ClipKey => (HERO_BANANA_CLIP_KEYS as readonly string[]).includes(k);

/** One value, made safe: numbers clamped into range (junk = the default), colours #rrggbb, clips a short string. */
export function clampHeroBananaValue<K extends keyof HeroBananaConfig>(key: K, value: unknown): HeroBananaConfig[K] | undefined {
  if (!Object.prototype.hasOwnProperty.call(HERO_BANANA_DEFAULTS, key)) return undefined;
  const def = HERO_BANANA_DEFAULTS[key];
  if (isColorKey(key)) {
    if (typeof value !== 'string') return def;
    const v = value.trim();
    return (HEX.test(v) ? v.toLowerCase() : def) as HeroBananaConfig[K];
  }
  if (isClipKey(key)) return (typeof value === 'string' ? value.trim().slice(0, 160) : def) as HeroBananaConfig[K];
  const n = typeof value === 'number' ? value : Number(value);
  if (typeof value === 'boolean' || value === null || value === '' || !Number.isFinite(n)) return def;
  const [min, max] = HERO_BANANA_RANGES[key as HeroBananaNumKey];
  return Math.min(max, Math.max(min, n)) as HeroBananaConfig[K];
}

/** A whole saved object, sanitised key by key over the defaults (junk and unknown keys dropped). */
export function sanitizeHeroBananaConfig(saved: unknown): HeroBananaConfig {
  const out: HeroBananaConfig = { ...HERO_BANANA_DEFAULTS };
  if (!saved || typeof saved !== 'object') return out;
  for (const [k, v] of Object.entries(saved as Record<string, unknown>)) {
    const safe = clampHeroBananaValue(k as keyof HeroBananaConfig, v);
    if (safe !== undefined) (out as unknown as Record<string, unknown>)[k] = safe;
  }
  return out;
}

// v2: the rebuild on Oona's painted art (2026-09-29) renamed most keys; a v1 save is simply ignored.
const KEY = 'ascent.herobanana.v3';

let cfg: HeroBananaConfig = (() => {
  if (!import.meta.env.DEV || typeof localStorage === 'undefined') return { ...HERO_BANANA_DEFAULTS };
  try { return sanitizeHeroBananaConfig(JSON.parse(localStorage.getItem(KEY) ?? '{}')); } catch { return { ...HERO_BANANA_DEFAULTS }; }
})();

export function getHeroBananaConfig(): HeroBananaConfig { return cfg; }

export function setHeroBananaValue(key: keyof HeroBananaConfig, value: number | string): void {
  const safe = clampHeroBananaValue(key, value);
  if (safe === undefined) return;
  cfg = { ...cfg, [key]: safe };
  if (!import.meta.env.DEV) return;
  try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch { /* ignore */ }
}

export function resetHeroBananaConfig(): void {
  cfg = { ...HERO_BANANA_DEFAULTS };
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}

/** The tuned values as JSON for pasting back into DEFAULTS (the preview-only keys left out). */
export function heroBananaConfigJson(c: HeroBananaConfig = cfg): string {
  const ship: Partial<HeroBananaConfig> = { ...c };
  delete ship.previewDamage;
  delete ship.previewParts;
  return JSON.stringify(ship, null, 2);
}

// ─── the preview speed (DEV only, never saved; the tuner no longer offers it, the console rig still can) ──────

let speed = 1;
/** The preview slow motion. Always 1 in production. */
export function heroBananaPreviewSpeed(): number { return import.meta.env.DEV ? speed : 1; }
export function setHeroBananaPreviewSpeed(s: number): void { speed = s > 0 ? s : 1; }

// ─── the pure plan ─────────────────────────────────────────────────────────────────────────────────────────────

/** One tier's dials, read out of the config. */
export function bananaTierDials(tier: TierNum, c: HeroBananaConfig = cfg): Record<BananaTierSuffix, number> {
  return Object.fromEntries(BANANA_TIER_SUFFIXES.map((s) => [s, c[`t${tier}${s}`]])) as Record<BananaTierSuffix, number>;
}

/** The reference distance the per-tier flight times are tuned at (a 1080p board, corner to corner). */
export const BANANA_REF_DISTANCE = 1600;

/** A banana's flight for a distance: the tier's time, scaled gently by the distance (a sandbox box stays readable). */
export function bananaFlightMs(distance: number, tierMs: number): number {
  const d = Number.isFinite(distance) && distance > 0 ? distance : BANANA_REF_DISTANCE;
  return Math.round(tierMs * clamp(Math.sqrt(d / BANANA_REF_DISTANCE), 0.62, 1.15));
}

/**
 * A barrage's spread, in FLING order: outer shots first, the centre one last (the barrage closes in, and the last to
 * land, THE impact, is the straightest). Signed slots: 0 = the centre line.
 */
export function shotSlots(n: number): number[] {
  if (n <= 1) return [0];
  if (n === 2) return [-1, 1];
  const out: number[] = [];
  const half = Math.floor(n / 2);
  for (let k = half; k >= 1; k--) { out.push(-k); out.push(k); }
  if (n % 2 === 1) out.push(0);
  // An even barrage still lands its last shot on the centre line.
  if (n % 2 === 0) out[out.length - 1] = 0;
  return out.slice(0, n);
}

export interface BananaShotPlan {
  fireAt: number;
  flightMs: number;
  arriveAt: number;
  /** How high the arc rises (a fraction of the distance, toward the top of the screen). */
  lift: number;
  /** How far the arc swings off to one side of the line (a fraction of the distance; signed). */
  side: number;
  /** The spread slot (signed; 0 = the centre line). */
  slot: number;
  /** Size multiplier (the last regular banana is a touch bigger; the giant is the giant). */
  size: number;
  /** Tier IV's royal banana: the GIANT GOLDEN BANANA. */
  giant: boolean;
}

export interface BananaPlanInput {
  /** When the style's own attack starts: the end of the shared damage formation (`formationPlan().endAt`). */
  leadIn?: number;
  /** THE blow, as the engine decided it. */
  total: number;
  /** Screen px between the attacker's and the defender's centres. */
  distance: number;
  reduced?: boolean;
}

export interface BananaPlan {
  reduced: boolean;
  tier: TierNum;
  /** 0..1 across the tiers (I = 0, IV = 1). */
  k: number;
  total: number;
  /** The flourish starts: the total sinks into the hero, gold gathers. */
  chargeAt: number;
  absorbEnd: number;
  /** The first banana is flung. */
  fireAt: number;
  /** Every banana, in fling order (Tier IV: the warm-ups, then the giant, last). */
  shots: BananaShotPlan[];
  /** Tier IV: the royal banana plays. */
  giant: boolean;
  /** Tier IV: the hero blazes gold before the giant (else the impact). */
  glintAt: number;
  /** Tier IV: the giant hangs at its apex, the crown glint flashes, the target ring locks on (else the impact). */
  hangAt: number;
  /** Tier IV: the giant lands ON the struck hero and sticks (else the impact). */
  landAt: number;
  /** Tier IV: the striking hero dashes across to it (else the impact). */
  dashAt: number;
  /** Tier IV: every slam of the striking hero into the stuck banana; the LAST is the impact (else []). */
  slams: number[];
  /** Tier IV: the striking hero is home again (else the impact). */
  homeAt: number;
  /** Bananas that splat BEFORE the impact, sequence ms: the rhythm ticks. */
  hits: number[];
  /** THE consequence beat: the last banana splats (I-III) or the giant slams (IV). */
  impactAt: number;
  /** Tier IV: splat pops round the target after the slam. */
  booms: number[];
  endAt: number;
  size: number;
  shakePx: number;
  zoom: number;
  punch: number;
  juice: number;
  burst: number;
  splats: number;
  dim: number;
}

/** The whole Banana Barrage, in base ms (divide by the playback speed for real time). Pure and deterministic. */
export function bananaPlan(input: BananaPlanInput, c: HeroBananaConfig = cfg): BananaPlan {
  const total = Math.max(0, Math.round(input.total));
  const tier = tierOf(total, c);
  const T = bananaTierDials(tier, c);
  const k = (tier - 1) / 3;

  if (input.reduced) {
    const r = reducedAttackTimeline(input.leadIn ?? 0, c.reducedFadeMs);
    const { impactAt } = r;
    return {
      reduced: true, tier, k, total,
      chargeAt: impactAt, absorbEnd: impactAt, fireAt: impactAt, shots: [], giant: false, glintAt: impactAt, hangAt: impactAt,
      landAt: impactAt, dashAt: impactAt, slams: [], homeAt: impactAt,
      hits: [], impactAt, booms: [], endAt: r.endAt,
      size: 0, shakePx: 0, zoom: 0, punch: 0, juice: 0, burst: 0, splats: 0, dim: 0,
    };
  }

  // The shared damage formation plays first; the style's own attack starts when it ends.
  const chargeAt = Math.max(0, input.leadIn ?? 0);
  const absorbEnd = chargeAt + c.absorbMs;
  const fireAt = chargeAt + Math.max(T.ChargeMs, c.absorbMs);
  const giant = T.Giant >= 1;
  const count = clamp(Math.round(T.Shots), 1, BANANA_CAPS.shots);
  const flight = bananaFlightMs(input.distance, T.FlightMs);
  const slots = shotSlots(count);
  const maxSlot = Math.max(1, ...slots.map((s) => Math.abs(s)));
  const shots: BananaShotPlan[] = slots.map((slot, i) => {
    const at = fireAt + i * T.ShotStaggerMs;
    // A pair: one lobbed higher and wide one way, one flatter the other way. A barrage fans evenly either side, the
    // outer arcs higher (they read as a spray, not a stack).
    const lift = count === 2 ? T.Arc * (slot < 0 ? 1.25 : 0.8) : T.Arc * (0.8 + 0.4 * (Math.abs(slot) / maxSlot));
    const side = count === 2 ? slot * T.Fan : (slot / maxSlot) * T.Fan;
    const fl = Math.round(flight * (1 + 0.05 * Math.abs(slot)));
    return { fireAt: at, flightMs: fl, arriveAt: at + fl, lift, side, slot, size: i === count - 1 && !giant ? 1.12 : 1, giant: false };
  });
  // Keep the fling order's rhythm on arrival: each splats at least `gap` after the one before.
  const gap = count > 2 ? Math.max(55, T.ShotStaggerMs * 0.8) : 0;
  for (let i = 1; i < shots.length; i++) {
    const d = shots[i]!, prev = shots[i - 1]!;
    if (gap && d.arriveAt < prev.arriveAt + gap) { d.flightMs += prev.arriveAt + gap - d.arriveAt; d.arriveAt = d.fireAt + d.flightMs; }
  }
  const lastFire = shots[shots.length - 1]!.fireAt;
  let glintAt: number, hangAt: number, impactAt: number, landAt: number, dashAt: number, homeAt: number;
  const slams: number[] = [];
  if (giant) {
    glintAt = lastFire + Math.max(180, T.ShotStaggerMs);
    const gFire = glintAt + c.giantChargeMs;
    const gFlight = bananaFlightMs(input.distance, c.giantFlightMs);
    shots.push({ fireAt: gFire, flightMs: gFlight, arriveAt: gFire + gFlight, lift: c.giantLift, side: 0, slot: 0, size: c.giantSize, giant: true });
    hangAt = gFire + Math.round(gFlight * 0.42);
    landAt = gFire + gFlight;
    // THE JAM: a beat to let it wobble, the dash across, then the slams: quick, quicker, a big wind-up, THE finisher.
    dashAt = landAt + 140;
    const n = Math.round(clamp(c.slamCount, 1, 8));
    let at = dashAt + c.dashMs;
    for (let i = 0; i < n; i++) {
      slams.push(at);
      const next = i + 1;
      // The anticipation BUILDS (owner 2026-09-29: "increasingly larger time between slams"): each gap longer than the
      // last, the finisher's wind-up the longest.
      if (next < n) at += next === n - 1 ? c.finisherWindMs : Math.round(c.slamGapMs * (1 + c.slamGapGrow * i));
    }
    impactAt = slams[slams.length - 1]!;
    homeAt = impactAt + 90 + c.homeMs;
  } else {
    impactAt = Math.max(...shots.map((s) => s.arriveAt));
    glintAt = impactAt; hangAt = impactAt; landAt = impactAt; dashAt = impactAt; homeAt = impactAt;
  }
  const regular = shots.filter((s) => !s.giant);
  const hits = (giant ? [...regular.map((s) => s.arriveAt), landAt, ...slams.slice(0, -1)] : regular.slice(0, -1).map((s) => s.arriveAt)).sort((a, b) => a - b);
  const booms = giant ? [impactAt + 170, impactAt + 320, impactAt + 470] : [];
  const lastBeat = Math.max(
    impactAt + 160,
    booms.length ? booms[booms.length - 1]! + 140 : 0,
    impactAt + c.zoomOutMs * 0.8,
    // The splats finish dissolving and the shower finishes falling after the end (the scene keeps ticking until it is
    // empty), so the fight never waits on a fading splat.
    impactAt + Math.min(360, c.splatMs * 0.7),
    giant ? homeAt : 0,
  );
  const endAt = lastBeat + T.SettleMs;

  return {
    reduced: false, tier, k, total, chargeAt, absorbEnd, fireAt,
    shots, giant, glintAt, hangAt, landAt, dashAt, slams, homeAt, hits, impactAt, booms, endAt,
    size: T.BananaSize,
    shakePx: clamp(T.Shake, 0, BANANA_CAPS.shakePx),
    zoom: clamp(T.Zoom, 0, BANANA_CAPS.zoom),
    punch: T.Punch,
    juice: Math.round(clamp(T.Juice, 0, BANANA_CAPS.juice)),
    burst: T.Burst,
    splats: Math.round(clamp(T.Splats, 1, BANANA_CAPS.splats)),
    dim: T.Dim,
  };
}

export type BananaCueKind = 'charge' | 'fire' | 'hit' | 'glint' | 'hang' | 'land' | 'dash' | 'slam' | 'impact' | 'boom' | 'end';
export interface BananaCue { at: number; kind: BananaCueKind; i: number }

/** Every beat the runner fires, in time order (ties keep this declaration order, so a hit precedes the impact). */
export function bananaCues(p: BananaPlan): BananaCue[] {
  const out: BananaCue[] = [];
  if (!p.reduced) {
    out.push({ at: p.chargeAt, kind: 'charge', i: 0 });
    p.shots.forEach((s, i) => out.push({ at: s.fireAt, kind: 'fire', i }));
    // Every regular banana but the last splats as a tick (Tier IV: every regular banana); the last one IS the impact.
    const lastRegular = p.giant ? -1 : p.shots.length - 1;
    p.shots.forEach((s, i) => { if (!s.giant && i !== lastRegular) out.push({ at: s.arriveAt, kind: 'hit', i }); });
    if (p.giant) {
      out.push({ at: p.glintAt, kind: 'glint', i: 0 });
      out.push({ at: p.hangAt, kind: 'hang', i: p.shots.length - 1 });
      out.push({ at: p.landAt, kind: 'land', i: p.shots.length - 1 });
      out.push({ at: p.dashAt, kind: 'dash', i: 0 });
      // Every slam but the last is a tick; the last IS the impact.
      p.slams.slice(0, -1).forEach((at, i) => out.push({ at, kind: 'slam', i }));
    }
  }
  out.push({ at: p.impactAt, kind: 'impact', i: p.shots.length ? p.shots.length - 1 : 0 });
  p.booms.forEach((at, i) => out.push({ at, kind: 'boom', i }));
  out.push({ at: p.endAt, kind: 'end', i: 0 });
  const order: Record<BananaCueKind, number> = { charge: 0, fire: 1, hit: 2, glint: 3, hang: 4, land: 5, dash: 6, slam: 7, impact: 8, boom: 9, end: 10 };
  return out.map((q, idx) => ({ q, idx })).sort((a, b) => a.q.at - b.q.at || order[a.q.kind] - order[b.q.kind] || a.idx - b.idx).map((x) => x.q);
}

// ─── the banana paths (pure) ───────────────────────────────────────────────────────────────────────────────────

/**
 * One banana's whole flight: `a` where it bursts out of the hero, `c` the arc's control point, `b` where it lands.
 * `hang` (0..0.95) slows the flight round its apex and speeds up both ends: the giant bursts up, HANGS and drops fast.
 * `spin` is its signed in-plane spin over the whole flight (radians; BACKSPIN: owner 2026-09-29 "the bananas should
 * spin, not flip ... spinning with backspin when shot", so a banana flying right turns counter-clockwise, its top rolling
 * back toward the thrower), laid out along the curve parameter so it slows with the flight at the apex; `rot0` its angle
 * as it leaves the hand.
 */
export interface BananaMotion { a: Pt; c: Pt; b: Pt; flightMs: number; hang: number; apex: number; spin: number; rot0: number; giant: boolean }

/** The released point and every banana's flight. */
export interface BananaRig { release: Pt; shots: BananaMotion[] }

/** A point on the quadratic at curve parameter `e`. */
function quad(a: Pt, c: Pt, b: Pt, e: number): Pt {
  const m = 1 - e;
  return { x: m * m * a.x + 2 * m * e * c.x + e * e * b.x, y: m * m * a.y + 2 * m * e * c.y + e * e * b.y };
}

/** The heading along the quadratic at `e` (radians). */
function quadHeading(a: Pt, c: Pt, b: Pt, e: number): number {
  const dx = 2 * (1 - e) * (c.x - a.x) + 2 * e * (b.x - c.x);
  const dy = 2 * (1 - e) * (c.y - a.y) + 2 * e * (b.y - c.y);
  return Math.atan2(dy, dx);
}

/**
 * The curve parameter at flight fraction `u`. A quadratic at a LINEAR parameter is a true ballistic arc (even sideways
 * speed, falling faster and faster); `hang` bends time so the flight is slow round the APEX (curve parameter `apex`) and
 * fast at both ends: it bursts up, hangs, and drops. The slowest moment is exactly at the apex (the speed there is
 * `1 - hang`, continuous across it; `1 + hang` at the ends). Monotonic for hang < 1; `hang` 0 is the plain arc.
 */
export function bananaEase(u: number, hang = 0, apex = 0.5): number {
  const t = Math.min(1, Math.max(0, Number.isFinite(u) ? u : 0));
  const h = Math.min(0.95, Math.max(0, hang));
  const p = Math.min(0.95, Math.max(0.05, apex));
  if (t <= p) { const x = t / p; return p * (x + (h / Math.PI) * Math.sin(Math.PI * x)); }
  const x = (t - p) / (1 - p);
  return p + (1 - p) * (x - (h / Math.PI) * Math.sin(Math.PI * x));
}

/** The curve parameter of a quadratic's highest point (its lowest y), clamped into the flight. */
export function apexOf(a: Pt, c: Pt, b: Pt): number {
  const den = a.y - 2 * c.y + b.y;
  return Math.abs(den) < 1e-6 ? 0.5 : Math.min(0.95, Math.max(0.05, (a.y - c.y) / den));
}

/**
 * Where a banana is `t` ms after it bursts out: its position and the heading it travels. Pure: the scene samples it
 * back in time for the sparkle trail.
 */
export function bananaPos(m: BananaMotion, t: number): { x: number; y: number; heading: number; rot: number } {
  const u = m.flightMs > 0 ? Math.min(1, Math.max(0, Number.isFinite(t) ? t / m.flightMs : 0)) : 1;
  const e = bananaEase(u, m.hang, m.apex);
  const p = quad(m.a, m.c, m.b, e);
  return { x: p.x, y: p.y, heading: quadHeading(m.a, m.c, m.b, e), rot: m.rot0 + m.spin * e };
}

/** The side normal of a line (a fixed turn of its direction), so a signed `side` always swings the same way. */
export function sideNormal(a: Pt, b: Pt): Pt {
  const dx = b.x - a.x, dy = b.y - a.y;
  const d = Math.hypot(dx, dy) || 1;
  return { x: -dy / d, y: dx / d };
}

/** A small fixed pseudo-random per index (no state), for the splat jitter: the same barrage splats the same way. */
export const jitter = (i: number, salt: number): number => { const s = Math.sin((i + 1) * 12.9898 + salt * 78.233) * 43758.5453; return s - Math.floor(s) - 0.5; };

/**
 * Where each banana splats on the struck portrait (offsets from its centre, in portrait radii). The big `-N` pops over
 * the MIDDLE of the face, so the bananas splat on the side of the face that looks back at the thrower, fanned by their
 * slot, clear of the number. The giant slams dead centre (it IS the blow).
 */
export function splatOffset(p: BananaPlan, i: number, a: Pt, d: Pt, avoid: Pt | null = null): Pt {
  const shot = p.shots[i];
  if (shot?.giant) {
    // The giant lands on the face's rim toward the thrower (the runner places it exactly, as a stake: `jamGeo`).
    const back = Math.atan2(a.y - d.y, a.x - d.x);
    return { x: Math.cos(back), y: Math.sin(back) };
  }
  const regular = p.shots.filter((s) => !s.giant);
  const n = regular.length;
  let back = Math.atan2(a.y - d.y, a.x - d.x);
  if (avoid && Math.hypot(avoid.x - d.x, avoid.y - d.y) > 1) {
    const av = Math.atan2(avoid.y - d.y, avoid.x - d.x);
    let diff = Math.atan2(Math.sin(back - av), Math.cos(back - av));
    const need = 1.1 + (n > 2 ? 0.4 : n === 2 ? 0.2 : 0);
    if (Math.abs(diff) < need) { const sgn = diff === 0 ? 1 : Math.sign(diff); diff = sgn * need; back = av + diff; }
  }
  const slot = shot?.slot ?? 0;
  const maxSlot = Math.max(1, ...regular.map((x) => Math.abs(x.slot)));
  const spread = n === 1 ? 0 : n === 2 ? 0.8 : 1.6;
  const ang = back + (n === 1 ? 0.2 : (slot / maxSlot) * spread) + jitter(i, 1) * 0.2;
  // Tight to the centre (owner 2026-09-29: the Tier IV bananas "get sent too far and explode past the hero"): every
  // banana lands well inside the face, Tier IV's warm-ups tightest of all.
  const r = (p.giant ? 0.16 : 0.26) + 0.08 * jitter(i, 2);
  return { x: Math.cos(ang) * r, y: Math.sin(ang) * r };
}

/**
 * Every banana's whole flight, from the plan and the two heroes. A banana bursts out of the striking hero's rim (toward
 * the target, a touch up), rises toward the top of the screen (a regular banana's control point never above `ceilY`, so
 * its whole arc stays in frame) and splats on the struck portrait. The giant's APEX is held `hangY` below the top of the
 * screen (so it hangs in view, big, for the crown glint) however high its lift asks for. Pure, so a replay flies the same
 * paths.
 */
export function bananaRig(p: BananaPlan, a: Pt, d: Pt, radius: number, aRadius: number, c: HeroBananaConfig = cfg, ceilY = Number.NEGATIVE_INFINITY, avoid: Pt | null = null, hangY = c.giantHangY, giantLen = c.bananaPx * c.giantSize): BananaRig {
  const dx = d.x - a.x, dy = d.y - a.y;
  const L = Math.hypot(dx, dy) || 1;
  const u = { x: dx / L, y: dy / L };
  const release = { x: a.x + u.x * aRadius * 0.55, y: a.y + u.y * aRadius * 0.55 - aRadius * 0.25 };
  if (p.reduced) return { release, shots: [] };
  const nrm = sideNormal(a, d);
  const shots = p.shots.map((sp, i): BananaMotion => {
    const off = splatOffset(p, i, a, d, avoid);
    // The giant lands where the jam starts: a stake whose centre sits out from the rim by its unsunk half.
    const b = sp.giant
      ? { x: d.x + off.x * (radius + giantLen * (0.5 - c.jamDepthStart)), y: d.y + off.y * (radius + giantLen * (0.5 - c.jamDepthStart)) }
      : { x: d.x + off.x * radius, y: d.y + off.y * radius };
    const rel = { x: release.x + nrm.x * sp.slot * aRadius * 0.08, y: release.y + nrm.y * sp.slot * aRadius * 0.08 };
    const D = Math.hypot(b.x - rel.x, b.y - rel.y) || 1;
    const mid = { x: (rel.x + b.x) / 2, y: (rel.y + b.y) / 2 };
    let cy = mid.y - sp.lift * D + nrm.y * sp.side * D;
    if (sp.giant) {
      // Hold the APEX at (ceiling + hangY). A quadratic's lowest y is (ab - c^2) / (a - 2c + b); solving for the control
      // height that puts it exactly at Y gives c = Y - sqrt((Y - a)(Y - b)).
      const Y = (Number.isFinite(ceilY) ? ceilY : -1e6) + hangY;
      if (Y < rel.y && Y < b.y) cy = Math.max(cy, Y - Math.sqrt((Y - rel.y) * (Y - b.y)));
    } else cy = Math.max(ceilY, cy);
    const ctrl = { x: mid.x + nrm.x * sp.side * D, y: cy };
    // Backspin: flying right it turns counter-clockwise (Pixi's negative rotation), flying left clockwise.
    const back = b.x >= rel.x ? -1 : 1;
    const turns = sp.giant ? c.spinTurns * 0.6 : c.spinTurns * (1 + 0.15 * jitter(i, 7));
    return {
      a: rel, c: ctrl, b, flightMs: sp.flightMs, hang: sp.giant ? c.giantHang : 0, apex: apexOf(rel, ctrl, b),
      spin: back * turns * Math.PI * 2, rot0: jitter(i, 9) * 0.8, giant: sp.giant,
    };
  });
  return { release, shots };
}

/** The direction the LAST banana is travelling as it lands (the impact's shake and splash follow it). Unit. */
export function arrivalDir(m: BananaMotion | undefined, a: Pt, d: Pt): Pt {
  if (m) { const h = bananaPos(m, m.flightMs).heading; return { x: Math.cos(h), y: Math.sin(h) }; }
  const L = Math.hypot(d.x - a.x, d.y - a.y) || 1;
  return { x: (d.x - a.x) / L, y: (d.y - a.y) / L };
}

// ─── the camera (pure) ─────────────────────────────────────────────────────────────────────────────────────────

const springAt = (ms: number, hz: number, tau: number): number => (ms < 0 ? 0 : Math.exp(-ms / tau) * Math.cos(2 * Math.PI * hz * (ms / 1000)));
const sine = (u: number): number => 0.5 - 0.5 * Math.cos(Math.PI * Math.min(1, Math.max(0, u)));

/**
 * The camera at sequence time `t` (px in the space the points are in). A small push in on the hero through the flourish;
 * a small kick against each fling; a kick ALONG the banana on each splat; on THE impact a punch in and a directional
 * shake. Tier IV builds: the view pushes in on the blazing hero, EASES BACK OUT as the giant climbs (so you see how high
 * it hangs), pushes in as it drops, then the slam punches hardest with a shake that rings both ways. Deterministic
 * (sines and springs): a replay moves identically. Pure.
 */
export function bananaCameraAt(p: BananaPlan, c: HeroBananaConfig, t: number, dir: Pt = { x: 1, y: 0 }): { zoom: number; x: number; y: number } {
  if (p.reduced) return { zoom: 1, x: 0, y: 0 };
  let z = 0;
  const g = p.giant ? p.shots[p.shots.length - 1]! : null;
  if (t >= p.chargeAt && t < p.impactAt) {
    z += p.zoom * sine((t - p.chargeAt) / Math.max(1, p.fireAt - p.chargeAt));
    if (g && t >= p.glintAt) {
      const build = sine((t - p.glintAt) / Math.max(1, g.fireAt - p.glintAt));
      const climb = t >= g.fireAt ? sine((t - g.fireAt) / Math.max(1, p.hangAt - g.fireAt)) : 0;
      const fall = t >= p.hangAt ? sine((t - p.hangAt) / Math.max(1, p.impactAt - p.hangAt)) : 0;
      // Push in on the blazing hero, pull back past rest as the giant climbs, then push in as it drops.
      z += p.zoom * (0.9 * build - 1.6 * climb + 1.2 * fall);
      // The jam: the view holds on the stuck banana, PUNCHES in on every slam (harder each time), and PUSHES IN over the
      // finisher's wind-up.
      if (p.slams.length > 1) {
        const wind = p.slams[p.slams.length - 2]!;
        if (t >= wind) z += c.finisherZoom * sine((t - wind) / Math.max(1, p.impactAt - wind));
        p.slams.slice(0, -1).forEach((at, i) => { if (t >= at) z += (0.014 + 0.012 * i) * Math.exp(-(t - at) / 90); });
      }
    }
  } else if (t >= p.impactAt) {
    const since = t - p.impactAt;
    z += (p.zoom * (p.giant ? 2.3 : 1) + p.punch) * Math.exp(-since / Math.max(1, c.zoomOutMs / 4));
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
  p.shots.forEach((s) => kick(s.fireAt, -p.shakePx * (s.giant ? 0.4 : 0.12), 45, 13, dir));
  p.hits.forEach((at, i) => kick(at, p.shakePx * (0.24 + 0.025 * i), 40, 18, dir));
  if (g) {
    // The blaze builds a tremor (both axes, growing) until the giant leaves.
    if (t >= p.glintAt && t < g.fireAt) {
      const u = Math.min(1, (t - p.glintAt) / Math.max(1, g.fireAt - p.glintAt));
      const a = p.shakePx * 0.12 * u * u;
      x += a * Math.sin(t * 0.13);
      y += a * Math.sin(t * 0.17 + 1.3);
    }
    const age = t - p.impactAt;
    if (age >= 0) {
      const env = Math.exp(-age / Math.max(1, c.shakeMs / 4));
      x += p.shakePx * 0.8 * env * Math.sin(age * 0.105 + 0.5);
      y += p.shakePx * env * Math.cos(age * 0.093);
    }
    p.booms.forEach((at, i) => kick(at, p.shakePx * 0.22, 45, 18, i % 2 ? perp : dir));
    // The landing thud and every slam before the finisher, building.
    kick(p.landAt, p.shakePx * 0.3, 50, 14, { x: 0, y: 1 });
    p.slams.slice(0, -1).forEach((at, i) => kick(at, p.shakePx * (0.45 + 0.3 * i), 50, 15, dir));
  } else {
    kick(p.impactAt, p.shakePx, Math.max(1, c.shakeMs / 4), 16, dir);
  }
  return { zoom: 1 + Math.max(0, z), x, y };
}

/**
 * Where the camera anchors: the ATTACKER through the flourish, following the barrage in flight, the DEFENDER from the
 * first splat on. Tier IV swings back to the blazing hero, then follows the giant down onto the target. A zoom anchored
 * on a point keeps that point still. Pure.
 */
export function bananaCameraFocus(p: BananaPlan, t: number, a: Pt, d: Pt): Pt {
  const lerp = (from: Pt, to: Pt, u: number): Pt => { const e = sine(u); return { x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e }; };
  const regular = p.shots.filter((s) => !s.giant);
  const settle = regular.length ? Math.min(...regular.map((x) => x.arriveAt)) : p.impactAt;
  const base = t <= p.fireAt ? a : t >= settle ? d : lerp(a, d, (t - p.fireAt) / Math.max(1, settle - p.fireAt));
  if (!p.giant || t < p.glintAt) return base;
  const g = p.shots[p.shots.length - 1]!;
  if (t < g.fireAt) return lerp(base, a, (t - p.glintAt) / 260);
  return lerp(a, d, (t - g.fireAt) / Math.max(1, g.flightMs * 0.85));
}

// ─── the jam (Tier IV, pure) ──────────────────────────────────────────────────────────────────────────────────

/**
 * The jam geometry (owner 2026-09-29: "is there any way to make it look like the banana is being jammed into them a bit
 * more?"). The giant is a STAKE on the line between the heroes: it enters the struck face at `entry` (the rim point
 * toward the thrower) and points into it along `u`; `depths[k]` is how much of its length `len` is sunk into the face
 * after slam k (k = 0: as it lands), from `jamDepthStart` to `jamDepthEnd` (only its end sticks out by the finisher).
 * `contacts[k]` is where the striking portrait's centre lands on slam k+1 (an offset from its rest): its face OVER the
 * stake's outer end as that slam drives it in. Pure.
 */
export interface JamGeo { u: Pt; entry: Pt; len: number; depths: number[]; contacts: Pt[]; dist: number }

export function jamGeo(a: Pt, d: Pt, aRadius: number, radius: number, len = 0, slams = 1, c: HeroBananaConfig = cfg): JamGeo {
  const dx = d.x - a.x, dy = d.y - a.y;
  const dist = Math.hypot(dx, dy) || 1;
  const u = { x: dx / dist, y: dy / dist };
  const entry = { x: d.x - u.x * radius, y: d.y - u.y * radius };
  const n = Math.max(1, Math.round(slams));
  const d0 = Math.min(c.jamDepthStart, c.jamDepthEnd), d1 = Math.max(c.jamDepthStart, c.jamDepthEnd);
  const depths = Array.from({ length: n + 1 }, (_, k) => d0 + (d1 - d0) * Math.pow(k / n, 0.85));
  // Never past the struck portrait's rim (a tiny sandbox, a zero-length stake), never behind the striker's rest.
  const contacts = depths.slice(1).map((dep) => {
    const out = Math.max(0, len * (1 - dep));
    const reach = Math.max(0, Math.min(dist - (radius + aRadius) * 0.8, dist - radius - out - aRadius * 0.72));
    return { x: u.x * reach, y: u.y * reach };
  });
  return { u, entry, len, depths, contacts, dist };
}

export interface JamPose { x: number; y: number; scale: number; rot: number; squash: number }

const easeIn3 = (u: number): number => { const t = Math.min(1, Math.max(0, u)); return t * t * t; };
const easeOut3 = (u: number): number => { const t = Math.min(1, Math.max(0, u)); return 1 - (1 - t) ** 3; };

/**
 * The striking hero's pose through the jam (an offset from rest; `squash` > 0 compressed along the blow). It DASHES in
 * (accelerating), lands slam 1 on arrival, then for each next slam PULLS BACK (easing out, swelling a touch) and DRIVES
 * back in (accelerating into contact); the finisher pulls back twice as far and swells more. After the finisher it holds
 * on contact a beat, then flies home. No freeze: every phase moves. Pure.
 */
export function jamPose(p: BananaPlan, g: JamGeo, c: HeroBananaConfig, t: number): JamPose {
  const rest: JamPose = { x: 0, y: 0, scale: 1, rot: 0, squash: 0 };
  if (p.reduced || !p.giant || !p.slams.length || t < p.dashAt || t >= p.homeAt) return rest;
  const ang = Math.atan2(g.u.y, g.u.x);
  const tilt = (ang > -Math.PI / 2 && ang < Math.PI / 2 ? 1 : -1) * 7;
  const hit = (k: number): Pt => g.contacts[Math.min(k, g.contacts.length - 1)] ?? { x: 0, y: 0 };
  let pose: JamPose;
  const first = p.slams[0]!;
  const last = p.slams[p.slams.length - 1]!;
  if (t < first) {
    const e = easeIn3((t - p.dashAt) / Math.max(1, first - p.dashAt));
    const h = hit(0);
    pose = { x: h.x * e, y: h.y * e, scale: 1 + 0.08 * Math.sin(Math.PI * e), rot: tilt * e, squash: 0 };
  } else if (t < last) {
    let j = 0;
    while (j + 1 < p.slams.length && p.slams[j + 1]! <= t) j++;
    const s0 = p.slams[j]!, s1 = p.slams[j + 1]!;
    const finisher = j + 1 === p.slams.length - 1;
    // A BIG reel-back, much bigger each slam (the force builds), the finisher's biggest of all.
    const pull = c.slamPullPx * (finisher ? 3.1 : 1 + 0.3 * j);
    const u = (t - s0) / Math.max(1, s1 - s0);
    // The finisher spends longer winding up and strikes FASTER (a shorter, harder drive).
    const split = finisher ? 0.82 : 0.62;
    const from = hit(j), to = hit(j + 1);
    const back = u < split ? easeOut3(u / split) : 1 - easeIn3((u - split) / (1 - split));
    // The anchor slides from this slam's contact to the next (the stake has sunk; the next blow lands deeper).
    const m = u < split ? 0 : easeIn3((u - split) / (1 - split));
    const bx = from.x + (to.x - from.x) * m, by = from.y + (to.y - from.y) * m;
    pose = {
      x: bx - g.u.x * pull * back, y: by - g.u.y * pull * back,
      scale: 1 + (finisher ? 0.2 : 0.06 + 0.012 * j) * back, rot: tilt * (1 - 0.7 * back), squash: 0,
    };
  } else {
    // Hold on the finisher a beat, then home.
    const hold = last + 90;
    const e = t < hold ? 0 : easeOut3((t - hold) / Math.max(1, p.homeAt - hold));
    const h = hit(p.slams.length - 1);
    pose = { x: h.x * (1 - e), y: h.y * (1 - e), scale: 1, rot: tilt * (1 - e), squash: 0 };
  }
  // Every contact COMPRESSES the fist along the blow, springing out (harder up the combo, hardest on the finisher).
  for (let i = 0; i < p.slams.length; i++) {
    const age = t - p.slams[i]!;
    if (age < 0 || age > 400) continue;
    const k = Math.exp(-age / 70) * Math.cos(age * 0.045);
    pose.squash += k * (i === p.slams.length - 1 ? 0.3 : 0.08 + 0.02 * i);
  }
  return pose;
}
