/**
 * THE BANANA CANNON HERO ATTACK: its tuned values, its pure timeline, the pure cannon + banana paths and the pure camera.
 *
 * Owner 2026-09-29: "make some more attack types ... i would love a king oona banana cannon animation. use the same 4
 * tier strategy we have been." King Oona (`b2_oona`) is the Set 2 Beast king whose art hauls a jungle-green, gold-trimmed
 * bazooka with a brass bell muzzle, loaded with bananas. This attack is that cannon.
 *
 * THE BEATS (base ms before the playback speed):
 *  1. THE DAMAGE FORMATION (shared by every style, `../heroAttack/damageFormation.ts`): minion tiers pulse left to
 *     right and merge, the hero tier joins, the full blow, the cap. Its end is this style's start.
 *  2. SUMMON. The total sinks into the hero and the ROYAL BANANA CANNON pops into being on the hero's rim (a clunk, a
 *     puff of leaves and gold sparkle), swings round and aims at the target.
 *  3. FIRE. Each shot: the cannon PUMPS (a quick bulge and a "chk"), then FIRES: it recoils hard, a big muzzle puff of
 *     smoke, a flash and a ring, leaves and sparks, and a banana spins out on a high, ballistic ARC:
 *     I one banana; II a double shot; III a rapid barrage of six (the cannon pumping in rhythm).
 *  4. SPLAT. Each banana splats into the struck portrait: a peel bursts open and STICKS (sliding off the face), banana
 *     chunks fly and fall, a little comic impact star pops. Every banana before the last is a TICK (FX and sound only).
 *     The LAST one is THE impact: the big `-N`, a big comic star, a mush splat, peels scattered over the face, rings,
 *     the knockback. The consequence (the damage, Armor, Resolve) lands ONCE, there.
 *  IV. THE ROYAL SHOT. Three quick bananas splat in (ticks). The cannon glows gold, swells, trembles and its CROWN
 *     GLINTS; then it launches a GIANT GOLDEN BANANA that arcs up out of the top of the screen while a flat golden
 *     target ring locks on to the struck hero; the banana comes screaming back down and SLAMS into it: a golden flash, a
 *     golden shockwave, gold rays, a BANANA-BUNCH SHOWER (whole bananas bursting out and tumbling down), peels
 *     everywhere, the biggest comic star; then a few banana pops round the target.
 *
 * TIERS are the shared, owner-approved thresholds (I 1-5, II 6-11, III 12-19, IV 20+). No hit-stop anywhere (owner
 * 2026-09-28: "it looks like lag"). Flat 2D (owner 2026-09-29): every ring and marker is a full circle on the flat
 * board, never a perspective ellipse. Reduced motion: no cannon, bananas, shake or zoom; the numbers fade and the blow
 * lands.
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
  'Shake', 'Zoom', 'Punch', 'Chunks', 'Burst', 'Peels', 'SettleMs', 'Dim',
] as const;
export type BananaTierSuffix = (typeof BANANA_TIER_SUFFIXES)[number];
type TierKey = `t${TierNum}${BananaTierSuffix}`;

interface GlobalConfig {
  // Tiers (the shared thresholds; DEV-tunable only)
  tier2At: number; tier3At: number; tier4At: number;
  // Summon
  absorbMs: number;
  heroCoilPx: number;
  heroRecoilPx: number;
  // The cannon
  cannonLength: number;
  cannonPopMs: number;
  recoilPx: number;
  pumpLeadMs: number;
  muzzlePuffs: number;
  leaves: number;
  stowMs: number;
  // Bananas
  bananaLength: number;
  spinTurns: number;
  trailAlpha: number;
  // The splat
  tickChunks: number;
  starSize: number;
  peelHoldMs: number;
  gravity: number;
  // The royal shot (Tier IV)
  giantChargeMs: number;
  giantFlightMs: number;
  giantSize: number;
  giantLift: number;
  giantOvershoot: number;
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
  colorBanana: string;
  colorGold: string;
  colorBarrel: string;
  colorDark: string;
  colorCream: string;
  colorSmoke: string;
  colorLeaf: string;
  colorPlayer: string;
  colorFoe: string;
  // Sound: a clip, a gain and a pitch per cue ('' = silent)
  sfxSummonClip: string; sfxSummonGain: number; sfxSummonRate: number;
  sfxSparkleClip: string; sfxSparkleGain: number; sfxSparkleRate: number;
  sfxPumpClip: string; sfxPumpGain: number; sfxPumpRate: number;
  sfxFireClip: string; sfxFireGain: number; sfxFireRate: number;
  sfxBoomClip: string; sfxBoomGain: number; sfxBoomRate: number;
  sfxWhooshClip: string; sfxWhooshGain: number; sfxWhooshRate: number;
  sfxSplatClip: string; sfxSplatGain: number; sfxSplatRate: number;
  sfxSmackClip: string; sfxSmackGain: number; sfxSmackRate: number;
  sfxImpactClip: string; sfxImpactGain: number; sfxImpactRate: number;
  sfxPowerClip: string; sfxPowerGain: number; sfxPowerRate: number;
  sfxMarkClip: string; sfxMarkGain: number; sfxMarkRate: number;
  sfxSlamClip: string; sfxSlamGain: number; sfxSlamRate: number;
  sfxPopClip: string; sfxPopGain: number; sfxPopRate: number;
  sfxStowClip: string; sfxStowGain: number; sfxStowRate: number;
  sfxFireLenMs: number;
  sfxImpactLenMs: number;
  sfxTailMix: number;
  sfxDuck: number;
  // Preview only (the tuner's Play buttons). Never read by a real fight, and left out of Copy JSON.
  previewDamage: number;
  previewParts: number;
}
export type HeroBananaConfig = GlobalConfig & Record<TierKey, number>;

export const HERO_BANANA_COLOR_KEYS = [
  'colorBanana', 'colorGold', 'colorBarrel', 'colorDark', 'colorCream', 'colorSmoke', 'colorLeaf', 'colorPlayer', 'colorFoe',
] as const;
export const HERO_BANANA_CLIP_KEYS = [
  'sfxSummonClip', 'sfxSparkleClip', 'sfxPumpClip', 'sfxFireClip', 'sfxBoomClip', 'sfxWhooshClip', 'sfxSplatClip',
  'sfxSmackClip', 'sfxImpactClip', 'sfxPowerClip', 'sfxMarkClip', 'sfxSlamClip', 'sfxPopClip', 'sfxStowClip',
] as const;
type ColorKey = (typeof HERO_BANANA_COLOR_KEYS)[number];
type ClipKey = (typeof HERO_BANANA_CLIP_KEYS)[number];
export type HeroBananaStrKey = ColorKey | ClipKey;
export type HeroBananaNumKey = Exclude<keyof HeroBananaConfig, HeroBananaStrKey>;

/** Tier I .. IV per suffix: the escalation ladder. */
const TIER_DEFAULTS: Record<BananaTierSuffix, [number, number, number, number]> = {
  ChargeMs: [380, 400, 440, 460],
  Shots: [1, 2, 6, 3],
  ShotStaggerMs: [0, 240, 125, 150],
  FlightMs: [540, 520, 480, 460],
  Arc: [0.26, 0.28, 0.22, 0.24],
  Fan: [0, 0.05, 0.08, 0.06],
  BananaSize: [1.1, 1.05, 0.95, 0.9],
  Giant: [0, 0, 0, 1],
  Shake: [5, 7, 10, 18],
  Zoom: [0.02, 0.03, 0.04, 0.07],
  Punch: [0.015, 0.022, 0.03, 0.055],
  Chunks: [10, 14, 20, 44],
  Burst: [1, 1.1, 1.3, 1.9],
  Peels: [1, 2, 4, 8],
  SettleMs: [260, 280, 320, 320],
  Dim: [0, 0.16, 0.28, 0.45],
};

export const BANANA_TIER_RANGES: Record<BananaTierSuffix, [number, number, number]> = {
  ChargeMs: [120, 1500, 10],
  Shots: [1, 8, 1],
  ShotStaggerMs: [0, 500, 5],
  FlightMs: [200, 1500, 10],
  Arc: [0, 0.6, 0.01],
  Fan: [0, 0.3, 0.01],
  BananaSize: [0.4, 2.5, 0.05],
  Giant: [0, 1, 1],
  Shake: [0, 40, 0.5],
  Zoom: [0, 0.14, 0.002],
  Punch: [0, 0.1, 0.001],
  Chunks: [0, 80, 1],
  Burst: [0.3, 3, 0.05],
  Peels: [0, 12, 1],
  SettleMs: [0, 1600, 10],
  Dim: [0, 0.8, 0.01],
};

const tierDefaults = Object.fromEntries(TIERS.flatMap((t) => BANANA_TIER_SUFFIXES.map((s) => [`t${t}${s}`, TIER_DEFAULTS[s][t - 1]]))) as Record<TierKey, number>;

export const HERO_BANANA_DEFAULTS: HeroBananaConfig = {
  // The shared, owner-approved thresholds (6 / 12 / 20): the same blow steps the cannon up exactly where it steps Blast up.
  ...HERO_ATTACK_TIER_THRESHOLDS,
  absorbMs: 190,
  heroCoilPx: 8,
  heroRecoilPx: 12,
  cannonLength: 210,
  cannonPopMs: 240,
  recoilPx: 26,
  pumpLeadMs: 90,
  muzzlePuffs: 7,
  leaves: 5,
  stowMs: 420,
  bananaLength: 88,
  spinTurns: 1.5,
  trailAlpha: 0.45,
  tickChunks: 8,
  starSize: 1,
  peelHoldMs: 620,
  gravity: 1400,
  giantChargeMs: 520,
  giantFlightMs: 820,
  giantSize: 2.6,
  giantLift: 0.95,
  giantOvershoot: 420,
  showerBananas: 12,
  shockSize: 1,
  goldRays: 10,
  flashAlpha: 0.85,
  knockPx: 18,
  squash: 0.1,
  shakeMs: 340,
  zoomOutMs: 380,
  reducedFadeMs: 260,
  colorBanana: '#ffd83d',
  colorGold: '#f0b429',
  colorBarrel: '#3f7d2a',
  colorDark: '#4a2a12',
  colorCream: '#fff2c2',
  colorSmoke: '#efe6cf',
  colorLeaf: '#4fae3a',
  colorPlayer: '#ffd83d',
  colorFoe: '#ff7a3d',
  sfxSummonClip: 'equipclang', sfxSummonGain: 0.35, sfxSummonRate: 1.2,
  sfxSparkleClip: 'fx/djartmusic-christmas-sparkle-whoosh-1-275404', sfxSparkleGain: 0.22, sfxSparkleRate: 1.1,
  sfxPumpClip: 'blastpump', sfxPumpGain: 0.3, sfxPumpRate: 1.35,
  sfxFireClip: 'fx/oona-launch', sfxFireGain: 0.6, sfxFireRate: 1,
  sfxBoomClip: 'turnexplosion', sfxBoomGain: 0.28, sfxBoomRate: 1.6,
  sfxWhooshClip: 'fx/stereogenicstudio-swish-swoosh-woosh-sfx-27-357164-3', sfxWhooshGain: 0.22, sfxWhooshRate: 1.1,
  sfxSplatClip: 'fx/oona-splat', sfxSplatGain: 0.55, sfxSplatRate: 1,
  sfxSmackClip: 'smack2', sfxSmackGain: 0.32, sfxSmackRate: 1.1,
  sfxImpactClip: 'crit', sfxImpactGain: 0.4, sfxImpactRate: 1.05,
  sfxPowerClip: 'fx/oona-powerup', sfxPowerGain: 0.55, sfxPowerRate: 0.9,
  sfxMarkClip: 'fx/metal-woosh', sfxMarkGain: 0.4, sfxMarkRate: 0.7,
  sfxSlamClip: 'fx/heavy-rock-impact', sfxSlamGain: 0.6, sfxSlamRate: 1,
  sfxPopClip: 'fx/oona-splat', sfxPopGain: 0.3, sfxPopRate: 1.5,
  sfxStowClip: 'equipclang', sfxStowGain: 0.18, sfxStowRate: 1.6,
  sfxFireLenMs: 700,
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
  heroRecoilPx: [0, 50, 1],
  cannonLength: [60, 320, 1],
  cannonPopMs: [60, 800, 10],
  recoilPx: [0, 80, 1],
  pumpLeadMs: [0, 300, 5],
  muzzlePuffs: [0, 16, 1],
  leaves: [0, 16, 1],
  stowMs: [100, 1500, 10],
  bananaLength: [30, 180, 1],
  spinTurns: [0, 5, 0.05],
  trailAlpha: [0, 1, 0.01],
  tickChunks: [0, 30, 1],
  starSize: [0.3, 3, 0.05],
  peelHoldMs: [100, 2500, 10],
  gravity: [0, 3000, 20],
  giantChargeMs: [150, 2000, 10],
  giantFlightMs: [300, 2000, 10],
  giantSize: [1, 5, 0.05],
  giantLift: [0.1, 1.6, 0.01],
  giantOvershoot: [0, 1200, 10],
  showerBananas: [0, 24, 1],
  shockSize: [0.3, 3, 0.05],
  goldRays: [0, 24, 1],
  flashAlpha: [0, 1, 0.01],
  knockPx: [0, 60, 1],
  squash: [0, 0.3, 0.01],
  shakeMs: [0, 1200, 10],
  zoomOutMs: [60, 1500, 10],
  reducedFadeMs: [60, 1000, 10],
  sfxSummonGain: [0, 2, 0.05], sfxSummonRate: [0.5, 2.5, 0.01],
  sfxSparkleGain: [0, 2, 0.05], sfxSparkleRate: [0.5, 2.5, 0.01],
  sfxPumpGain: [0, 2, 0.05], sfxPumpRate: [0.5, 2.5, 0.01],
  sfxFireGain: [0, 2, 0.05], sfxFireRate: [0.5, 2.5, 0.01],
  sfxBoomGain: [0, 2, 0.05], sfxBoomRate: [0.5, 2.5, 0.01],
  sfxWhooshGain: [0, 2, 0.05], sfxWhooshRate: [0.5, 2.5, 0.01],
  sfxSplatGain: [0, 2, 0.05], sfxSplatRate: [0.5, 2.5, 0.01],
  sfxSmackGain: [0, 2, 0.05], sfxSmackRate: [0.5, 2.5, 0.01],
  sfxImpactGain: [0, 2, 0.05], sfxImpactRate: [0.5, 2.5, 0.01],
  sfxPowerGain: [0, 2, 0.05], sfxPowerRate: [0.5, 2.5, 0.01],
  sfxMarkGain: [0, 2, 0.05], sfxMarkRate: [0.5, 2.5, 0.01],
  sfxSlamGain: [0, 2, 0.05], sfxSlamRate: [0.5, 2.5, 0.01],
  sfxPopGain: [0, 2, 0.05], sfxPopRate: [0.5, 2.5, 0.01],
  sfxStowGain: [0, 2, 0.05], sfxStowRate: [0.5, 2.5, 0.01],
  sfxFireLenMs: [80, 2500, 10],
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

/** The hard ceilings a plan can never exceed, whatever the sliders say (so a 40 stays joyful, not cluttered). */
export const BANANA_CAPS = { shots: 8, chunks: 80, peels: 12, shower: 24, shakePx: 40, zoom: 0.14 } as const;

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

const KEY = 'ascent.herobanana.v1';

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

// ─── the preview speed (DEV only, never saved) ─────────────────────────────────────────────────────────────────

export const HERO_BANANA_SPEEDS = [1, 0.5, 0.25] as const;
export type HeroBananaSpeed = (typeof HERO_BANANA_SPEEDS)[number];
let speed: HeroBananaSpeed = 1;
/** The tuner's slow motion. Always 1 in production. */
export function heroBananaPreviewSpeed(): HeroBananaSpeed { return import.meta.env.DEV ? speed : 1; }
export function setHeroBananaPreviewSpeed(s: HeroBananaSpeed): void { speed = s; }

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
 * A barrage's spread, in FIRE order: outer shots first, the centre one last (the barrage closes in, and the last to
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
  /** The cannon pumps (a bulge and a "chk") just before it fires. */
  pumpAt: number;
  fireAt: number;
  flightMs: number;
  arriveAt: number;
  /** How high the arc rises (a fraction of the distance, toward the top of the screen). */
  lift: number;
  /** How far the arc swings off to one side of the line (a fraction of the distance; signed). */
  side: number;
  /** The spread slot (signed; 0 = the centre line). */
  slot: number;
  /** Size multiplier (the last regular shot is a touch bigger; the giant is the giant). */
  size: number;
  /** Tier IV's royal shot: the GIANT GOLDEN BANANA. */
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
  /** The summon starts: the total sinks into the hero, the cannon pops in and aims. */
  chargeAt: number;
  absorbEnd: number;
  /** The first shot fires. */
  fireAt: number;
  /** Every shot, in fire order (Tier IV: the warm-up bananas, then the giant, last). */
  shots: BananaShotPlan[];
  /** Tier IV: the royal shot plays. */
  giant: boolean;
  /** Tier IV: the cannon glows gold, swells and its crown glints (else the impact). */
  glintAt: number;
  /** Tier IV: the golden target ring locks on to the struck hero (else the impact). */
  markAt: number;
  /** Bananas that splat in BEFORE the impact, sequence ms: the rhythm ticks. */
  hits: number[];
  /** THE consequence beat: the last banana splats (I-III) or the giant golden banana slams (IV). */
  impactAt: number;
  /** The cannon pops away. */
  stowAt: number;
  /** Tier IV: banana pops round the target after the slam. */
  booms: number[];
  endAt: number;
  size: number;
  shakePx: number;
  zoom: number;
  punch: number;
  chunks: number;
  burst: number;
  peels: number;
  dim: number;
}

/** The whole Banana Cannon, in base ms (divide by the playback speed for real time). Pure and deterministic. */
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
      chargeAt: impactAt, absorbEnd: impactAt, fireAt: impactAt, shots: [], giant: false, glintAt: impactAt, markAt: impactAt,
      hits: [], impactAt, stowAt: impactAt, booms: [], endAt: r.endAt,
      size: 0, shakePx: 0, zoom: 0, punch: 0, chunks: 0, burst: 0, peels: 0, dim: 0,
    };
  }

  // The shared damage formation plays first; the style's own attack starts when it ends.
  const chargeAt = Math.max(0, input.leadIn ?? 0);
  const absorbEnd = chargeAt + c.absorbMs;
  const fireAt = chargeAt + Math.max(T.ChargeMs, c.absorbMs, c.cannonPopMs + c.pumpLeadMs + 40);
  const giant = T.Giant >= 1;
  const count = clamp(Math.round(T.Shots), 1, BANANA_CAPS.shots);
  const flight = bananaFlightMs(input.distance, T.FlightMs);
  const slots = shotSlots(count);
  const maxSlot = Math.max(1, ...slots.map((s) => Math.abs(s)));
  const lead = Math.min(c.pumpLeadMs, Math.max(0, T.ShotStaggerMs * 0.6) || c.pumpLeadMs);
  const shots: BananaShotPlan[] = slots.map((slot, i) => {
    const at = fireAt + i * T.ShotStaggerMs;
    // A pair: one lobbed higher and wide one way, one flatter the other way. A barrage fans evenly either side.
    const lift = count === 2 ? T.Arc * (slot < 0 ? 1.25 : 0.8) : T.Arc * (1 - 0.18 * (Math.abs(slot) / maxSlot));
    const side = count === 2 ? slot * T.Fan : (slot / maxSlot) * T.Fan;
    const fl = Math.round(flight * (1 + 0.04 * Math.abs(slot)));
    return {
      pumpAt: Math.max(chargeAt + c.cannonPopMs * 0.6, at - (i === 0 ? c.pumpLeadMs : lead)),
      fireAt: at, flightMs: fl, arriveAt: at + fl, lift, side, slot, size: i === count - 1 && !giant ? 1.1 : 1, giant: false,
    };
  });
  // Keep the fire order's rhythm on arrival: each splats in at least `gap` after the one before.
  const gap = count > 2 ? Math.max(60, T.ShotStaggerMs * 0.8) : 0;
  for (let i = 1; i < shots.length; i++) {
    const d = shots[i]!, prev = shots[i - 1]!;
    if (gap && d.arriveAt < prev.arriveAt + gap) { d.flightMs += prev.arriveAt + gap - d.arriveAt; d.arriveAt = d.fireAt + d.flightMs; }
  }
  const lastFire = shots[shots.length - 1]!.fireAt;
  let glintAt = 0, markAt = 0, impactAt: number;
  if (giant) {
    glintAt = lastFire + Math.max(160, T.ShotStaggerMs);
    const gFire = glintAt + c.giantChargeMs;
    const gFlight = bananaFlightMs(input.distance, c.giantFlightMs);
    shots.push({
      pumpAt: gFire - c.pumpLeadMs, fireAt: gFire, flightMs: gFlight, arriveAt: gFire + gFlight, lift: c.giantLift, side: 0, slot: 0,
      size: c.giantSize, giant: true,
    });
    markAt = gFire + Math.round(gFlight * 0.3);
    impactAt = gFire + gFlight;
  } else {
    impactAt = Math.max(...shots.map((s) => s.arriveAt));
    glintAt = impactAt;
    markAt = impactAt;
  }
  const regular = shots.filter((s) => !s.giant);
  const hits = (giant ? regular.map((s) => s.arriveAt) : regular.slice(0, -1).map((s) => s.arriveAt)).sort((a, b) => a - b);
  const stowAt = shots[shots.length - 1]!.fireAt + c.stowMs;
  const booms = giant ? [impactAt + 160, impactAt + 300, impactAt + 440] : [];
  const lastBeat = Math.max(
    impactAt + 160,
    booms.length ? booms[booms.length - 1]! + 140 : 0,
    impactAt + c.zoomOutMs * 0.8,
    // The peels finish sliding off and the shower finishes falling after the end (the scene keeps ticking until it is
    // empty), so the fight never waits on a fading peel.
    Math.min(stowAt + 200, impactAt + 600),
  );
  const endAt = lastBeat + T.SettleMs;

  return {
    reduced: false, tier, k, total, chargeAt, absorbEnd, fireAt,
    shots, giant, glintAt, markAt, hits, impactAt, stowAt, booms, endAt,
    size: T.BananaSize,
    shakePx: clamp(T.Shake, 0, BANANA_CAPS.shakePx),
    zoom: clamp(T.Zoom, 0, BANANA_CAPS.zoom),
    punch: T.Punch,
    chunks: Math.round(clamp(T.Chunks, 0, BANANA_CAPS.chunks)),
    burst: T.Burst,
    peels: Math.round(clamp(T.Peels, 0, BANANA_CAPS.peels)),
    dim: T.Dim,
  };
}

export type BananaCueKind = 'charge' | 'pump' | 'fire' | 'hit' | 'glint' | 'mark' | 'impact' | 'stow' | 'boom' | 'end';
export interface BananaCue { at: number; kind: BananaCueKind; i: number }

/** Every beat the runner fires, in time order (ties keep this declaration order, so a hit precedes the impact). */
export function bananaCues(p: BananaPlan): BananaCue[] {
  const out: BananaCue[] = [];
  if (!p.reduced) {
    out.push({ at: p.chargeAt, kind: 'charge', i: 0 });
    p.shots.forEach((s, i) => {
      out.push({ at: s.pumpAt, kind: 'pump', i });
      out.push({ at: s.fireAt, kind: 'fire', i });
    });
    // Every regular banana but the last splats in as a tick (Tier IV: every regular banana); the last one IS the impact.
    const lastRegular = p.giant ? -1 : p.shots.length - 1;
    p.shots.forEach((s, i) => { if (!s.giant && i !== lastRegular) out.push({ at: s.arriveAt, kind: 'hit', i }); });
    if (p.giant) {
      out.push({ at: p.glintAt, kind: 'glint', i: 0 });
      out.push({ at: p.markAt, kind: 'mark', i: 0 });
    }
    out.push({ at: p.stowAt, kind: 'stow', i: 0 });
  }
  out.push({ at: p.impactAt, kind: 'impact', i: p.shots.length ? p.shots.length - 1 : 0 });
  p.booms.forEach((at, i) => out.push({ at, kind: 'boom', i }));
  out.push({ at: p.endAt, kind: 'end', i: 0 });
  const order: Record<BananaCueKind, number> = {
    charge: 0, pump: 1, fire: 2, hit: 3, glint: 4, mark: 5, impact: 6, stow: 7, boom: 8, end: 9,
  };
  return out.map((q, idx) => ({ q, idx })).sort((a, b) => a.q.at - b.q.at || order[a.q.kind] - order[b.q.kind] || a.idx - b.idx).map((x) => x.q);
}

// ─── the cannon and the banana paths (pure) ───────────────────────────────────────────────────────────────────

/**
 * One banana's whole flight: `a` the muzzle it leaves from, `c` the arc's control point, `b` where it splats on the
 * struck portrait. `dir` is the heading the cannon points to fire it (radians). `spin` the turns it tumbles through.
 */
export interface BananaMotion { a: Pt; c: Pt; b: Pt; flightMs: number; dir: number; spin: number; giant: boolean }

/** The cannon: where it sits (its pivot, on the striking hero's rim toward the target) and every shot it fires. */
export interface CannonRig { pivot: Pt; rest: number; muzzle: number; shots: BananaMotion[] }

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
 * Where a banana is `t` ms after it leaves the muzzle: its position, the heading it travels, and the angle it is drawn
 * at (tumbling). A quadratic run at a LINEAR parameter is a true ballistic arc (even sideways speed, falling faster and
 * faster), which is what makes the lob read as a cannon shot. Pure: the scene samples it back in time for the trail.
 */
export function bananaPos(m: BananaMotion, t: number): { x: number; y: number; heading: number; rot: number } {
  const u = m.flightMs > 0 ? Math.min(1, Math.max(0, Number.isFinite(t) ? t / m.flightMs : 0)) : 1;
  const p = quad(m.a, m.c, m.b, u);
  const heading = quadHeading(m.a, m.c, m.b, u);
  // Tumble the way it is flying (rightward shots spin clockwise), from the cannon's own heading.
  const sgn = Math.cos(m.dir) >= 0 ? 1 : -1;
  return { x: p.x, y: p.y, heading, rot: m.dir + sgn * m.spin * Math.PI * 2 * u };
}

/** The side normal of a line (a fixed turn of its direction), so a signed `side` always swings the same way. */
export function sideNormal(a: Pt, b: Pt): Pt {
  const dx = b.x - a.x, dy = b.y - a.y;
  const d = Math.hypot(dx, dy) || 1;
  return { x: -dy / d, y: dx / d };
}

/** A small fixed pseudo-random per index (no state), for the splat jitter: the same barrage splats the same way. */
const jitter = (i: number, salt: number): number => { const s = Math.sin((i + 1) * 12.9898 + salt * 78.233) * 43758.5453; return s - Math.floor(s) - 0.5; };

/**
 * Where each banana splats on the struck portrait (offsets from its centre, in portrait radii). The big `-N` pops over
 * the MIDDLE of the face, so the bananas splat on the side of the face that looks back at the cannon, fanned by their
 * slot, clear of the number. The giant slams dead centre (it IS the blow).
 */
export function splatOffset(p: BananaPlan, i: number, a: Pt, d: Pt, avoid: Pt | null = null): Pt {
  const shot = p.shots[i];
  if (shot?.giant) return { x: 0, y: 0 };
  const regular = p.shots.filter((s) => !s.giant);
  const n = regular.length;
  let back = Math.atan2(a.y - d.y, a.x - d.x);
  if (avoid && Math.hypot(avoid.x - d.x, avoid.y - d.y) > 1) {
    const av = Math.atan2(avoid.y - d.y, avoid.x - d.x);
    let diff = Math.atan2(Math.sin(back - av), Math.cos(back - av));
    const need = 1.2 + (n > 2 ? 0.4 : n === 2 ? 0.2 : 0);
    if (Math.abs(diff) < need) { const sgn = diff === 0 ? 1 : Math.sign(diff); diff = sgn * need; back = av + diff; }
  }
  const slot = shot?.slot ?? 0;
  const maxSlot = Math.max(1, ...regular.map((x) => Math.abs(x.slot)));
  const spread = n === 1 ? 0 : n === 2 ? 0.7 : 1.4;
  const ang = back + (n === 1 ? 0.2 : (slot / maxSlot) * spread) + jitter(i, 1) * 0.15;
  const r = 0.42 + 0.1 * jitter(i, 2);
  return { x: Math.cos(ang) * r, y: Math.sin(ang) * r };
}

/**
 * The cannon and every banana's whole flight, from the plan and the two heroes. The cannon sits on the striking hero's
 * rim, toward the target; each banana leaves its muzzle on the heading the cannon aims for that shot, rises toward the
 * top of the screen (never above `ceilY`; the giant may overshoot it by `giantOvershoot`, leaving the frame and coming
 * back down), and splats on the struck portrait. `len` is the cannon length in the points' px. Pure, so a replay flies
 * the same paths.
 */
export function cannonRig(p: BananaPlan, a: Pt, d: Pt, radius: number, aRadius: number, c: HeroBananaConfig = cfg, len = c.cannonLength, ceilY = Number.NEGATIVE_INFINITY, avoid: Pt | null = null, overshoot = c.giantOvershoot): CannonRig {
  const dx = d.x - a.x, dy = d.y - a.y;
  const L = Math.hypot(dx, dy) || 1;
  const u = { x: dx / L, y: dy / L };
  const pivot = { x: a.x + u.x * aRadius * 0.8, y: a.y + u.y * aRadius * 0.8 };
  // The cannon rests pointing at the target, tipped up toward the top of the screen (it lobs).
  const rest = Math.atan2(u.y - 0.45, u.x);
  const muzzle = len * CANNON_MUZZLE_FRAC;
  if (p.reduced) return { pivot, rest, muzzle, shots: [] };
  const nrm = sideNormal(a, d);
  const shots = p.shots.map((sp, i) => {
    const off = splatOffset(p, i, a, d, avoid);
    const b = { x: d.x + off.x * radius, y: d.y + off.y * radius };
    const ex = b.x - pivot.x, ey = b.y - pivot.y;
    const D = Math.hypot(ex, ey) || 1;
    const mid = { x: (pivot.x + b.x) / 2, y: (pivot.y + b.y) / 2 };
    // A regular banana's control point stays under the ceiling (so its whole arc stays in frame). The giant's APEX may
    // climb up to `overshoot` past it: the apex of a quadratic is about a quarter of the way from the chord's middle to
    // the control point's height, so the control point may rise to (4 x apex - a - b) / 2.
    const ceil = sp.giant ? (4 * (ceilY - overshoot) - pivot.y - b.y) / 2 : ceilY;
    const ctrl0 = { x: mid.x + nrm.x * sp.side * D, y: Math.max(ceil, mid.y - sp.lift * D + nrm.y * sp.side * D) };
    // The cannon aims along the arc's opening heading; the banana leaves the muzzle on it.
    const dir = Math.atan2(ctrl0.y - pivot.y, ctrl0.x - pivot.x);
    const mz = { x: pivot.x + Math.cos(dir) * muzzle, y: pivot.y + Math.sin(dir) * muzzle };
    const cm = { x: (mz.x + b.x) / 2, y: (mz.y + b.y) / 2 };
    const D2 = Math.hypot(b.x - mz.x, b.y - mz.y) || 1;
    const ctrl = { x: cm.x + nrm.x * sp.side * D2, y: Math.max(ceil, cm.y - sp.lift * D2 + nrm.y * sp.side * D2) };
    const spin = sp.giant ? 0.75 : c.spinTurns * (1 + 0.15 * jitter(i, 7));
    return { a: mz, c: ctrl, b, flightMs: sp.flightMs, dir: Math.atan2(ctrl.y - mz.y, ctrl.x - mz.x), spin, giant: sp.giant };
  });
  return { pivot, rest, muzzle, shots };
}

/** Where the muzzle sits along the cannon from its pivot, as a fraction of its length (the cannon texture's layout). */
export const CANNON_MUZZLE_FRAC = 0.62;

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
 * The camera at sequence time `t` (px in the space the points are in). A small push in on the hero as the cannon
 * appears; a recoil kick against the shot on each fire; a kick ALONG the banana on each splat; on THE impact a punch in
 * and a directional shake. Tier IV builds: the view pushes in on the cannon through the glint while a tremor grows,
 * EASES BACK OUT as the giant banana climbs out of frame (so you see how high it went), then the slam punches hardest
 * with a shake that rings both ways. Deterministic (sines and springs): a replay moves identically. Pure.
 */
export function bananaCameraAt(p: BananaPlan, c: HeroBananaConfig, t: number, dir: Pt = { x: 1, y: 0 }): { zoom: number; x: number; y: number } {
  if (p.reduced) return { zoom: 1, x: 0, y: 0 };
  let z = 0;
  const g = p.giant ? p.shots[p.shots.length - 1]! : null;
  if (t >= p.chargeAt && t < p.impactAt) {
    z += p.zoom * sine((t - p.chargeAt) / Math.max(1, p.fireAt - p.chargeAt));
    if (g && t >= p.glintAt) {
      const build = sine((t - p.glintAt) / Math.max(1, g.fireAt - p.glintAt));
      const climb = t >= g.fireAt ? sine((t - g.fireAt) / Math.max(1, g.flightMs * 0.45)) : 0;
      const fall = t >= g.fireAt + g.flightMs * 0.55 ? sine((t - g.fireAt - g.flightMs * 0.55) / Math.max(1, g.flightMs * 0.45)) : 0;
      // Push in on the swelling cannon, pull back past rest as the giant climbs, then push in as it drops.
      z += p.zoom * (0.9 * build - 1.6 * climb + 0.9 * fall);
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
  p.shots.forEach((s) => kick(s.fireAt, -p.shakePx * (s.giant ? 0.45 : 0.15), 45, 13, dir));
  p.hits.forEach((at, i) => kick(at, p.shakePx * (0.26 + 0.03 * i), 40, 18, dir));
  if (g) {
    // The glint builds a tremor (both axes, growing) until the giant leaves.
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
  } else {
    kick(p.impactAt, p.shakePx, Math.max(1, c.shakeMs / 4), 16, dir);
  }
  return { zoom: 1 + Math.max(0, z), x, y };
}

/**
 * Where the camera anchors: the ATTACKER (the cannon) through the summon, following the barrage in flight, the DEFENDER
 * from the first splat on. Tier IV swings back to the cannon for the glint and follows the giant down onto the target.
 * A zoom anchored on a point keeps that point still. Pure.
 */
export function bananaCameraFocus(p: BananaPlan, t: number, a: Pt, d: Pt): Pt {
  const lerp = (from: Pt, to: Pt, u: number): Pt => { const e = sine(u); return { x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e }; };
  const regular = p.shots.filter((s) => !s.giant);
  const settle = regular.length ? Math.min(...regular.map((x) => x.arriveAt)) : p.impactAt;
  const base = t <= p.fireAt ? a : t >= settle ? d : lerp(a, d, (t - p.fireAt) / Math.max(1, settle - p.fireAt));
  if (!p.giant || t < p.glintAt) return base;
  const g = p.shots[p.shots.length - 1]!;
  if (t < g.fireAt) return lerp(base, a, (t - p.glintAt) / 260);
  return lerp(a, d, (t - g.fireAt) / Math.max(1, g.flightMs * 0.8));
}
