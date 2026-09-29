/**
 * THE POISON DARTS HERO ATTACK: its tuned values, its pure timeline, the pure dart paths and the pure camera.
 *
 * Owner 2026-09-28: "branch off and make a poison dart animation. the final one should throw multiple poison darts that
 * implode with poison".
 *
 * THE BEATS (base ms before the playback speed):
 *  1. THE DAMAGE FORMATION (shared by every style, `../heroAttack/damageFormation.ts`): minion tiers pulse left to
 *     right and merge, the hero tier joins, the full blow, the cap. Its end is this style's start.
 *  2. READY. The total sinks into the hero, who leans back away from the target (a sneaky coil) while venom gathers at
 *     the throwing point: a glint, a thin ring closing in, vapour drawn in.
 *  3. THROW. Small, sleek poison darts (a dark needle, a venom vial, acid fletching, a glowing green tip) are flicked
 *     from the hero with a snappy "thwip", fast, on a slight arc, each trailing a thin toxic vapour: I one; II two in
 *     quick succession; III a fan of five, thunking in in rhythm.
 *  4. THUNK. Each dart sticks in the struck portrait at its own angle and quivers: a venom splat, green droplets, a
 *     tiny toxic puff and a sickly green tint pulse over the portrait. Every dart before the last is a TICK (FX and
 *     sound only). The LAST one is THE impact: the big `-N`, a bigger splash, a ring, the knockback. The consequence
 *     (the damage, Armor, Resolve) lands ONCE, there. A beat later the poison seeps (a second tint pulse and bubbles)
 *     and the darts dissolve.
 *  IV. IMPLODE. Six darts thunk in round the face (all ticks). Then the stuck darts GLOW and PULSE and the venom SWELLS
 *     (a toxic aura rising over the portrait, bubbles, a tremor, a rising fizz); then everything COLLAPSES inward (the
 *     darts are sucked into one tight point, a dark ring contracts) and a violent TOXIC BURST lands the blow: a
 *     green-black shockwave, bubbling toxic cloud puffs, acid droplets arcing out with gravity, a lingering haze.
 *
 * TIERS are the shared, owner-approved thresholds (I 1-5, II 6-11, III 12-19, IV 20+). No hit-stop anywhere (owner
 * 2026-09-28: "it looks like lag"). Reduced motion: no flight, darts, shake or zoom; the numbers fade and the blow lands.
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
export const POISON_TIER_SUFFIXES = [
  'ChargeMs', 'Darts', 'ThrowStaggerMs', 'FlightMs', 'Arc', 'Fan', 'DartSize', 'Implode',
  'Shake', 'Zoom', 'Punch', 'Drops', 'Burst', 'SettleMs', 'Dim',
] as const;
export type PoisonTierSuffix = (typeof POISON_TIER_SUFFIXES)[number];
type TierKey = `t${TierNum}${PoisonTierSuffix}`;

interface GlobalConfig {
  // Tiers (the shared thresholds; DEV-tunable only)
  tier2At: number; tier3At: number; tier4At: number;
  // Ready
  absorbMs: number;
  heroCoilPx: number;
  heroFlickPx: number;
  // Darts
  dartLength: number;
  dartGlow: number;
  trailMs: number;
  trailWidth: number;
  wisps: number;
  penetration: number;
  quiver: number;
  // The hit
  splashSize: number;
  tickDrops: number;
  tintAlpha: number;
  stickHoldMs: number;
  seepMs: number;
  // The implosion (Tier IV)
  swellMs: number;
  suckMs: number;
  burstSize: number;
  cloudPuffs: number;
  cloudSize: number;
  dropGravity: number;
  hazeAlpha: number;
  hazeMs: number;
  flashAlpha: number;
  // Camera and portraits
  knockPx: number;
  squash: number;
  shakeMs: number;
  zoomOutMs: number;
  reducedFadeMs: number;
  // Colours
  colorCore: string;
  colorVenom: string;
  colorAcid: string;
  colorDark: string;
  colorPlayer: string;
  colorFoe: string;
  // Sound: a clip, a gain and a pitch per cue ('' = silent)
  sfxReadyClip: string; sfxReadyGain: number; sfxReadyRate: number;
  sfxThrowClip: string; sfxThrowGain: number; sfxThrowRate: number;
  sfxSnapClip: string; sfxSnapGain: number; sfxSnapRate: number;
  sfxThunkClip: string; sfxThunkGain: number; sfxThunkRate: number;
  sfxMeatClip: string; sfxMeatGain: number; sfxMeatRate: number;
  sfxSplashClip: string; sfxSplashGain: number; sfxSplashRate: number;
  sfxImpactClip: string; sfxImpactGain: number; sfxImpactRate: number;
  sfxBigClip: string; sfxBigGain: number; sfxBigRate: number;
  sfxSuckClip: string; sfxSuckGain: number; sfxSuckRate: number;
  sfxBurstClip: string; sfxBurstGain: number; sfxBurstRate: number;
  sfxGushClip: string; sfxGushGain: number; sfxGushRate: number;
  sfxBoomClip: string; sfxBoomGain: number; sfxBoomRate: number;
  sfxSizzleGain: number;
  sfxFizzGain: number; sfxFizzLowHz: number; sfxFizzHighHz: number;
  sfxThrowLenMs: number;
  sfxImpactLenMs: number;
  sfxTailMix: number;
  sfxDuck: number;
  // Preview only (the tuner's Play buttons). Never read by a real fight, and left out of Copy JSON.
  previewDamage: number;
  previewParts: number;
}
export type HeroPoisonConfig = GlobalConfig & Record<TierKey, number>;

export const HERO_POISON_COLOR_KEYS = ['colorCore', 'colorVenom', 'colorAcid', 'colorDark', 'colorPlayer', 'colorFoe'] as const;
export const HERO_POISON_CLIP_KEYS = [
  'sfxReadyClip', 'sfxThrowClip', 'sfxSnapClip', 'sfxThunkClip', 'sfxMeatClip', 'sfxSplashClip',
  'sfxImpactClip', 'sfxBigClip', 'sfxSuckClip', 'sfxBurstClip', 'sfxGushClip', 'sfxBoomClip',
] as const;
type ColorKey = (typeof HERO_POISON_COLOR_KEYS)[number];
type ClipKey = (typeof HERO_POISON_CLIP_KEYS)[number];
export type HeroPoisonStrKey = ColorKey | ClipKey;
export type HeroPoisonNumKey = Exclude<keyof HeroPoisonConfig, HeroPoisonStrKey>;

/** Tier I .. IV per suffix: the escalation ladder. */
const TIER_DEFAULTS: Record<PoisonTierSuffix, [number, number, number, number]> = {
  ChargeMs: [300, 340, 400, 420],
  Darts: [1, 2, 5, 6],
  ThrowStaggerMs: [0, 170, 105, 85],
  FlightMs: [300, 300, 310, 300],
  Arc: [0.08, 0.09, 0.1, 0.09],
  Fan: [0, 0.05, 0.09, 0.08],
  DartSize: [1.1, 1.05, 0.95, 0.95],
  Implode: [0, 0, 0, 1],
  Shake: [4, 6, 9, 16],
  Zoom: [0.02, 0.03, 0.04, 0.065],
  Punch: [0.015, 0.022, 0.03, 0.05],
  Drops: [12, 16, 22, 40],
  Burst: [1, 1.1, 1.3, 1.8],
  SettleMs: [240, 280, 320, 300],
  Dim: [0, 0.16, 0.28, 0.45],
};

export const POISON_TIER_RANGES: Record<PoisonTierSuffix, [number, number, number]> = {
  ChargeMs: [60, 1500, 10],
  Darts: [1, 8, 1],
  ThrowStaggerMs: [0, 400, 5],
  FlightMs: [120, 1200, 10],
  Arc: [0, 0.4, 0.01],
  Fan: [0, 0.3, 0.01],
  DartSize: [0.4, 2.5, 0.05],
  Implode: [0, 1, 1],
  Shake: [0, 40, 0.5],
  Zoom: [0, 0.14, 0.002],
  Punch: [0, 0.1, 0.001],
  Drops: [0, 80, 1],
  Burst: [0.3, 3, 0.05],
  SettleMs: [0, 1600, 10],
  Dim: [0, 0.8, 0.01],
};

const tierDefaults = Object.fromEntries(TIERS.flatMap((t) => POISON_TIER_SUFFIXES.map((s) => [`t${t}${s}`, TIER_DEFAULTS[s][t - 1]]))) as Record<TierKey, number>;

export const HERO_POISON_DEFAULTS: HeroPoisonConfig = {
  // The shared, owner-approved thresholds (6 / 12 / 20): the same blow steps Poison up exactly where it steps Blast up.
  ...HERO_ATTACK_TIER_THRESHOLDS,
  absorbMs: 190,
  heroCoilPx: 9,
  heroFlickPx: 13,
  dartLength: 128,
  dartGlow: 0.6,
  trailMs: 60,
  trailWidth: 10,
  wisps: 0.6,
  penetration: 0.16,
  quiver: 0.2,
  splashSize: 1,
  tickDrops: 8,
  tintAlpha: 0.24,
  stickHoldMs: 440,
  seepMs: 320,
  swellMs: 640,
  suckMs: 200,
  burstSize: 1,
  cloudPuffs: 10,
  cloudSize: 1,
  dropGravity: 1100,
  hazeAlpha: 0.3,
  hazeMs: 1500,
  flashAlpha: 0.85,
  knockPx: 16,
  squash: 0.09,
  shakeMs: 320,
  zoomOutMs: 360,
  reducedFadeMs: 260,
  colorCore: '#f0ffdc',
  colorVenom: '#4dff3a',
  colorAcid: '#d2ff1f',
  colorDark: '#2a0b3c',
  colorPlayer: '#7dff3a',
  colorFoe: '#b04dff',
  sfxReadyClip: 'equipmentsheen', sfxReadyGain: 0.28, sfxReadyRate: 0.85,
  sfxThrowClip: 'fx/stereogenicstudio-swish-swoosh-woosh-sfx-27-357164-3', sfxThrowGain: 0.5, sfxThrowRate: 1.65,
  sfxSnapClip: 'fx/universfield-whip-snap-242215', sfxSnapGain: 0.22, sfxSnapRate: 1.6,
  sfxThunkClip: 'fel-spike-echo-land', sfxThunkGain: 0.55, sfxThunkRate: 1.1,
  sfxMeatClip: 'smack1', sfxMeatGain: 0.28, sfxMeatRate: 1.15,
  sfxSplashClip: 'fx/oona-splat', sfxSplashGain: 0.4, sfxSplashRate: 1.2,
  sfxImpactClip: 'flurryhit', sfxImpactGain: 0.55, sfxImpactRate: 0.95,
  sfxBigClip: 'crit', sfxBigGain: 0.32, sfxBigRate: 1.1,
  sfxSuckClip: 'runeselectimplosion', sfxSuckGain: 0.7, sfxSuckRate: 1.05,
  sfxBurstClip: 'turnexplosion', sfxBurstGain: 0.45, sfxBurstRate: 1.32,
  sfxGushClip: 'fx/oona-splat', sfxGushGain: 0.85, sfxGushRate: 0.8,
  sfxBoomClip: 'fx/oona-splat', sfxBoomGain: 0.26, sfxBoomRate: 1.45,
  sfxSizzleGain: 0.3,
  sfxFizzGain: 0.34, sfxFizzLowHz: 240, sfxFizzHighHz: 950,
  sfxThrowLenMs: 280,
  sfxImpactLenMs: 900,
  sfxTailMix: 0.1,
  sfxDuck: 0.5,
  previewDamage: 12,
  previewParts: 4,
  ...tierDefaults,
};

const GLOBAL_RANGES: Record<Exclude<keyof GlobalConfig, HeroPoisonStrKey>, [number, number, number]> = {
  tier2At: [2, 40, 1], tier3At: [2, 60, 1], tier4At: [2, 80, 1],
  absorbMs: [60, 600, 10],
  heroCoilPx: [0, 40, 1],
  heroFlickPx: [0, 50, 1],
  dartLength: [30, 200, 1],
  dartGlow: [0, 1.5, 0.05],
  trailMs: [0, 300, 5],
  trailWidth: [1, 30, 0.5],
  wisps: [0, 2, 0.05],
  penetration: [0, 0.5, 0.01],
  quiver: [0, 0.6, 0.01],
  splashSize: [0.3, 3, 0.05],
  tickDrops: [0, 30, 1],
  tintAlpha: [0, 0.8, 0.01],
  stickHoldMs: [100, 2000, 10],
  seepMs: [100, 1200, 10],
  swellMs: [200, 2000, 10],
  suckMs: [60, 600, 5],
  burstSize: [0.3, 3, 0.05],
  cloudPuffs: [0, 20, 1],
  cloudSize: [0.3, 3, 0.05],
  dropGravity: [0, 3000, 20],
  hazeAlpha: [0, 0.8, 0.01],
  hazeMs: [200, 4000, 20],
  flashAlpha: [0, 1, 0.01],
  knockPx: [0, 60, 1],
  squash: [0, 0.3, 0.01],
  shakeMs: [0, 1200, 10],
  zoomOutMs: [60, 1500, 10],
  reducedFadeMs: [60, 1000, 10],
  sfxReadyGain: [0, 2, 0.05], sfxReadyRate: [0.5, 2, 0.01],
  sfxThrowGain: [0, 2, 0.05], sfxThrowRate: [0.5, 2.5, 0.01],
  sfxSnapGain: [0, 2, 0.05], sfxSnapRate: [0.5, 2.5, 0.01],
  sfxThunkGain: [0, 2, 0.05], sfxThunkRate: [0.5, 2, 0.01],
  sfxMeatGain: [0, 2, 0.05], sfxMeatRate: [0.5, 2, 0.01],
  sfxSplashGain: [0, 2, 0.05], sfxSplashRate: [0.5, 2, 0.01],
  sfxImpactGain: [0, 2, 0.05], sfxImpactRate: [0.5, 2, 0.01],
  sfxBigGain: [0, 2, 0.05], sfxBigRate: [0.5, 2, 0.01],
  sfxSuckGain: [0, 2, 0.05], sfxSuckRate: [0.5, 2, 0.01],
  sfxBurstGain: [0, 2, 0.05], sfxBurstRate: [0.5, 2, 0.01],
  sfxGushGain: [0, 2, 0.05], sfxGushRate: [0.5, 2, 0.01],
  sfxBoomGain: [0, 2, 0.05], sfxBoomRate: [0.5, 2, 0.01],
  sfxSizzleGain: [0, 2, 0.05],
  sfxFizzGain: [0, 2, 0.05], sfxFizzLowHz: [60, 800, 5], sfxFizzHighHz: [200, 3000, 10],
  sfxThrowLenMs: [80, 1500, 10],
  sfxImpactLenMs: [150, 3500, 10],
  sfxTailMix: [0, 0.6, 0.01],
  sfxDuck: [0, 1, 0.05],
  previewDamage: [1, 60, 1],
  previewParts: [1, 8, 1],
};

/** [min, max, step] per numeric key. Values outside are clamped on write AND on load. */
export const HERO_POISON_RANGES: Record<HeroPoisonNumKey, [number, number, number]> = {
  ...GLOBAL_RANGES,
  ...(Object.fromEntries(TIERS.flatMap((t) => POISON_TIER_SUFFIXES.map((s) => [`t${t}${s}`, POISON_TIER_RANGES[s]]))) as Record<TierKey, [number, number, number]>),
};

/** The hard ceilings a plan can never exceed, whatever the sliders say (so a 40 stays clean, not cluttered). */
export const POISON_CAPS = { darts: 8, drops: 80, cloudPuffs: 20, shakePx: 40, zoom: 0.14 } as const;

const HEX = /^#[0-9a-f]{6}$/i;
const isColorKey = (k: string): k is ColorKey => (HERO_POISON_COLOR_KEYS as readonly string[]).includes(k);
const isClipKey = (k: string): k is ClipKey => (HERO_POISON_CLIP_KEYS as readonly string[]).includes(k);

/** One value, made safe: numbers clamped into range (junk = the default), colours #rrggbb, clips a short string. */
export function clampHeroPoisonValue<K extends keyof HeroPoisonConfig>(key: K, value: unknown): HeroPoisonConfig[K] | undefined {
  if (!Object.prototype.hasOwnProperty.call(HERO_POISON_DEFAULTS, key)) return undefined;
  const def = HERO_POISON_DEFAULTS[key];
  if (isColorKey(key)) {
    if (typeof value !== 'string') return def;
    const v = value.trim();
    return (HEX.test(v) ? v.toLowerCase() : def) as HeroPoisonConfig[K];
  }
  if (isClipKey(key)) return (typeof value === 'string' ? value.trim().slice(0, 160) : def) as HeroPoisonConfig[K];
  const n = typeof value === 'number' ? value : Number(value);
  if (typeof value === 'boolean' || value === null || value === '' || !Number.isFinite(n)) return def;
  const [min, max] = HERO_POISON_RANGES[key as HeroPoisonNumKey];
  return Math.min(max, Math.max(min, n)) as HeroPoisonConfig[K];
}

/** A whole saved object, sanitised key by key over the defaults (junk and unknown keys dropped). */
export function sanitizeHeroPoisonConfig(saved: unknown): HeroPoisonConfig {
  const out: HeroPoisonConfig = { ...HERO_POISON_DEFAULTS };
  if (!saved || typeof saved !== 'object') return out;
  for (const [k, v] of Object.entries(saved as Record<string, unknown>)) {
    const safe = clampHeroPoisonValue(k as keyof HeroPoisonConfig, v);
    if (safe !== undefined) (out as unknown as Record<string, unknown>)[k] = safe;
  }
  return out;
}

const KEY = 'ascent.heropoison.v1';

let cfg: HeroPoisonConfig = (() => {
  if (!import.meta.env.DEV || typeof localStorage === 'undefined') return { ...HERO_POISON_DEFAULTS };
  try { return sanitizeHeroPoisonConfig(JSON.parse(localStorage.getItem(KEY) ?? '{}')); } catch { return { ...HERO_POISON_DEFAULTS }; }
})();

export function getHeroPoisonConfig(): HeroPoisonConfig { return cfg; }

export function setHeroPoisonValue(key: keyof HeroPoisonConfig, value: number | string): void {
  const safe = clampHeroPoisonValue(key, value);
  if (safe === undefined) return;
  cfg = { ...cfg, [key]: safe };
  if (!import.meta.env.DEV) return;
  try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch { /* ignore */ }
}

export function resetHeroPoisonConfig(): void {
  cfg = { ...HERO_POISON_DEFAULTS };
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}

/** The tuned values as JSON for pasting back into DEFAULTS (the preview-only keys left out). */
export function heroPoisonConfigJson(c: HeroPoisonConfig = cfg): string {
  const ship: Partial<HeroPoisonConfig> = { ...c };
  delete ship.previewDamage;
  delete ship.previewParts;
  return JSON.stringify(ship, null, 2);
}

// ─── the preview speed (DEV only, never saved) ─────────────────────────────────────────────────────────────────

export const HERO_POISON_SPEEDS = [1, 0.5, 0.25] as const;
export type HeroPoisonSpeed = (typeof HERO_POISON_SPEEDS)[number];
let speed: HeroPoisonSpeed = 1;
/** The tuner's slow motion. Always 1 in production. */
export function heroPoisonPreviewSpeed(): HeroPoisonSpeed { return import.meta.env.DEV ? speed : 1; }
export function setHeroPoisonPreviewSpeed(s: HeroPoisonSpeed): void { speed = s; }

// ─── the pure plan ─────────────────────────────────────────────────────────────────────────────────────────────

/** One tier's dials, read out of the config. */
export function poisonTierDials(tier: TierNum, c: HeroPoisonConfig = cfg): Record<PoisonTierSuffix, number> {
  return Object.fromEntries(POISON_TIER_SUFFIXES.map((s) => [s, c[`t${tier}${s}`]])) as Record<PoisonTierSuffix, number>;
}

/** The reference distance the per-tier flight times are tuned at (a 1080p board, corner to corner). */
export const POISON_REF_DISTANCE = 1600;

/** Dart flight for a distance: the tier's time, scaled gently by the distance (a sandbox box stays readable). */
export function poisonFlightMs(distance: number, tierMs: number): number {
  const d = Number.isFinite(distance) && distance > 0 ? distance : POISON_REF_DISTANCE;
  return Math.round(tierMs * clamp(Math.sqrt(d / POISON_REF_DISTANCE), 0.62, 1.15));
}

/**
 * The fan of a volley, in THROW order: outer darts first, the centre one last (the volley closes in, and the last to
 * land, THE impact, is the straightest). Signed slots: 0 = the centre line.
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

export interface PoisonDartPlan {
  throwAt: number;
  flightMs: number;
  arriveAt: number;
  /** How high the arc rises (a fraction of the distance, toward the top of the screen). */
  lift: number;
  /** How far the arc swings off to one side of the line (a fraction of the distance; signed). */
  side: number;
  /** The fan slot (signed; 0 = the centre line). */
  slot: number;
  /** Size multiplier (the last is a touch bigger). */
  size: number;
}

export interface PoisonPlanInput {
  /** When the style's own attack starts: the end of the shared damage formation (`formationPlan().endAt`). */
  leadIn?: number;
  /** THE blow, as the engine decided it. */
  total: number;
  /** Screen px between the attacker's and the defender's centres. */
  distance: number;
  reduced?: boolean;
}

export interface PoisonPlan {
  reduced: boolean;
  tier: TierNum;
  /** 0..1 across the tiers (I = 0, IV = 1). */
  k: number;
  total: number;
  /** The ready starts: the total sinks into the hero, venom gathers. */
  chargeAt: number;
  absorbEnd: number;
  /** The first dart is thrown. */
  throwAt: number;
  darts: PoisonDartPlan[];
  /** Tier IV: the stuck darts swell, implode and burst. */
  implode: boolean;
  /** Tier IV: the swell starts (else the impact). */
  swellAt: number;
  /** Tier IV: the collapse inward starts (else the impact). */
  suckAt: number;
  /** Darts that thunk in BEFORE the impact, sequence ms: the rhythm ticks (Tier IV: every dart). */
  hits: number[];
  /** THE consequence beat: the last dart thunks in (I-III) or the toxic burst (IV). */
  impactAt: number;
  /** I-III: the poison seeps (a second tint pulse and bubbles; FX only). */
  seepAt: number;
  /** I-III: the stuck darts dissolve. */
  dissolveAt: number;
  /** Tier IV: bubbling pops round the target after the burst. */
  booms: number[];
  endAt: number;
  size: number;
  shakePx: number;
  zoom: number;
  punch: number;
  drops: number;
  burst: number;
  dim: number;
}

/** The whole Poison Darts, in base ms (divide by the playback speed for real time). Pure and deterministic. */
export function poisonPlan(input: PoisonPlanInput, c: HeroPoisonConfig = cfg): PoisonPlan {
  const total = Math.max(0, Math.round(input.total));
  const tier = tierOf(total, c);
  const T = poisonTierDials(tier, c);
  const k = (tier - 1) / 3;

  if (input.reduced) {
    const r = reducedAttackTimeline(input.leadIn ?? 0, c.reducedFadeMs);
    const { impactAt } = r;
    return {
      reduced: true, tier, k, total,
      chargeAt: impactAt, absorbEnd: impactAt, throwAt: impactAt, darts: [], implode: false, swellAt: impactAt, suckAt: impactAt,
      hits: [], impactAt, seepAt: impactAt, dissolveAt: impactAt, booms: [], endAt: r.endAt,
      size: 0, shakePx: 0, zoom: 0, punch: 0, drops: 0, burst: 0, dim: 0,
    };
  }

  // The shared damage formation plays first; the style's own attack starts when it ends.
  const chargeAt = Math.max(0, input.leadIn ?? 0);
  const absorbEnd = chargeAt + c.absorbMs;
  const throwAt = chargeAt + Math.max(T.ChargeMs, c.absorbMs);
  const implode = T.Implode >= 1;
  const count = clamp(Math.round(T.Darts), 1, POISON_CAPS.darts);
  const flight = poisonFlightMs(input.distance, T.FlightMs);
  const slots = fanSlots(count);
  const maxSlot = Math.max(1, ...slots.map((s) => Math.abs(s)));
  const darts: PoisonDartPlan[] = slots.map((slot, i) => {
    const at = throwAt + i * T.ThrowStaggerMs;
    // A pair: one flicked a touch higher and wide one way, one flatter the other way. A volley fans evenly either side.
    const lift = count === 2 ? T.Arc * (slot < 0 ? 1.3 : 0.7) : T.Arc * (1 - 0.15 * (Math.abs(slot) / maxSlot));
    const side = count === 2 ? slot * T.Fan : (slot / maxSlot) * T.Fan;
    // Outer darts travel a longer arc: a hair more time, so the rhythm stays even and the centre lands last.
    const fl = Math.round(flight * (1 + 0.05 * Math.abs(slot)));
    return { throwAt: at, flightMs: fl, arriveAt: at + fl, lift, side, slot, size: i === count - 1 && !implode ? 1.08 : 1 };
  });
  // Keep the throw order's rhythm on arrival: each thunks in at least `gap` after the one before.
  const gap = count > 2 ? Math.max(60, T.ThrowStaggerMs * 0.8) : 0;
  for (let i = 1; i < darts.length; i++) {
    const d = darts[i]!, prev = darts[i - 1]!;
    if (gap && d.arriveAt < prev.arriveAt + gap) { d.flightMs += prev.arriveAt + gap - d.arriveAt; d.arriveAt = d.throwAt + d.flightMs; }
  }
  const lastIn = Math.max(...darts.map((d) => d.arriveAt));
  const swellAt = implode ? lastIn + 90 : lastIn;
  const suckAt = implode ? swellAt + c.swellMs : lastIn;
  const impactAt = implode ? suckAt + c.suckMs : lastIn;
  const hits = (implode ? darts.map((d) => d.arriveAt) : darts.slice(0, -1).map((d) => d.arriveAt)).sort((a, b) => a - b);
  const seepAt = implode ? impactAt : impactAt + c.seepMs;
  const dissolveAt = implode ? impactAt : impactAt + c.stickHoldMs;
  const booms = implode ? [impactAt + 150, impactAt + 300] : [];
  const lastBeat = Math.max(
    impactAt + 160,
    booms.length ? booms[booms.length - 1]! + 140 : 0,
    impactAt + c.zoomOutMs * 0.8,
    // The dissolve and the haze finish draining after the end (the scene keeps ticking until it is empty), so the fight
    // never waits on a fading dart or a thinning cloud.
    implode ? impactAt + Math.min(700, c.hazeMs * 0.4) : Math.max(seepAt + 160, dissolveAt),
  );
  const endAt = lastBeat + T.SettleMs;

  return {
    reduced: false, tier, k, total, chargeAt, absorbEnd, throwAt,
    darts, implode, swellAt, suckAt, hits, impactAt, seepAt, dissolveAt, booms, endAt,
    size: T.DartSize,
    shakePx: clamp(T.Shake, 0, POISON_CAPS.shakePx),
    zoom: clamp(T.Zoom, 0, POISON_CAPS.zoom),
    punch: T.Punch,
    drops: Math.round(clamp(T.Drops, 0, POISON_CAPS.drops)),
    burst: T.Burst,
    dim: T.Dim,
  };
}

export type PoisonCueKind = 'charge' | 'throw' | 'hit' | 'swell' | 'suck' | 'impact' | 'seep' | 'dissolve' | 'boom' | 'end';
export interface PoisonCue { at: number; kind: PoisonCueKind; i: number }

/** Every beat the runner fires, in time order (ties keep this declaration order, so a hit precedes the impact). */
export function poisonCues(p: PoisonPlan): PoisonCue[] {
  const out: PoisonCue[] = [];
  if (!p.reduced) {
    out.push({ at: p.chargeAt, kind: 'charge', i: 0 });
    p.darts.forEach((d, i) => out.push({ at: d.throwAt, kind: 'throw', i }));
    // Every dart but the last thunks in as a tick (Tier IV: every dart); the last one IS the impact.
    p.darts.forEach((d, i) => { if (p.implode || i < p.darts.length - 1) out.push({ at: d.arriveAt, kind: 'hit', i }); });
    if (p.implode) {
      out.push({ at: p.swellAt, kind: 'swell', i: 0 });
      out.push({ at: p.suckAt, kind: 'suck', i: 0 });
    } else {
      out.push({ at: p.seepAt, kind: 'seep', i: 0 });
      out.push({ at: p.dissolveAt, kind: 'dissolve', i: 0 });
    }
  }
  out.push({ at: p.impactAt, kind: 'impact', i: 0 });
  p.booms.forEach((at, i) => out.push({ at, kind: 'boom', i }));
  out.push({ at: p.endAt, kind: 'end', i: 0 });
  const order: Record<PoisonCueKind, number> = {
    charge: 0, throw: 1, hit: 2, swell: 3, suck: 4, impact: 5, seep: 6, dissolve: 7, boom: 8, end: 9,
  };
  return out.map((q, idx) => ({ q, idx })).sort((a, b) => a.q.at - b.q.at || order[a.q.kind] - order[b.q.kind] || a.idx - b.idx).map((x) => x.q);
}

// ─── the dart paths (pure) ─────────────────────────────────────────────────────────────────────────────────────

/**
 * A dart's whole flight. `a` the release point (on the thrower's rim, toward the target), `c` the arc's control point,
 * `b` where the TIP buries itself (the stick point, already pushed in by the penetration along the arrival heading).
 * `rot` is the heading it sticks at (radians, the tip points along it).
 */
export interface DartMotion { a: Pt; c: Pt; b: Pt; flightMs: number; rot: number; aim: Pt }

/** The dart's progress along its arc: flicked out fast and still ACCELERATING into the target (it thunks). */
export const dartEase = (u: number): number => { const t = Math.min(1, Math.max(0, Number.isFinite(u) ? u : 0)); return 0.78 * t + 0.22 * t * t; };

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
 * Where a dart's TIP is `t` ms after its throw, and which way it points. Pure: the scene samples it back in time for
 * the vapour trail, and after the flight it holds the stick pose.
 */
export function dartPos(m: DartMotion, t: number): { x: number; y: number; rot: number } {
  if (t <= 0) return { x: m.a.x, y: m.a.y, rot: quadHeading(m.a, m.c, m.b, 0) };
  if (t >= m.flightMs) return { x: m.b.x, y: m.b.y, rot: m.rot };
  const e = dartEase(t / m.flightMs);
  const p = quad(m.a, m.c, m.b, e);
  return { x: p.x, y: p.y, rot: quadHeading(m.a, m.c, m.b, e) };
}

/** The side normal of a line (a fixed turn of its direction), so a signed `side` always swings the same way. */
export function sideNormal(a: Pt, b: Pt): Pt {
  const dx = b.x - a.x, dy = b.y - a.y;
  const d = Math.hypot(dx, dy) || 1;
  return { x: -dy / d, y: dx / d };
}

/** A small fixed pseudo-random per index (no state), for the stick jitter: the same volley sticks the same way. */
const jitter = (i: number, salt: number): number => { const s = Math.sin((i + 1) * 12.9898 + salt * 78.233) * 43758.5453; return s - Math.floor(s) - 0.5; };

/**
 * Where each dart buries itself in the struck portrait (offsets from its centre, in portrait radii). The big `-N` pops
 * over the MIDDLE of the face, so the darts go in on the side of the face that looks back at the thrower (a pincushion
 * facing where they came from): the needle is buried in the face and the body stands out past the rim, clear of the
 * number. I-III fan across that side by the slot; IV rings the whole face, so the implosion has somewhere to pull them
 * in from.
 */
export function stickOffset(p: PoisonPlan, i: number, a: Pt, d: Pt, avoid: Pt | null = null): Pt {
  const n = p.darts.length;
  let back = Math.atan2(a.y - d.y, a.x - d.x);
  // Swing the arc off the big -N (it is pushed from the struck hero toward the middle of the screen and kept on
  // screen, so for a hero in a corner it lands on the thrower's side): at least ~75 degrees from it.
  if (avoid && !p.implode && Math.hypot(avoid.x - d.x, avoid.y - d.y) > 1) {
    const av = Math.atan2(avoid.y - d.y, avoid.x - d.x);
    let diff = Math.atan2(Math.sin(back - av), Math.cos(back - av));
    const need = 1.3 + (n > 2 ? 0.45 : n === 2 ? 0.25 : 0);
    if (Math.abs(diff) < need) { const sgn = diff === 0 ? 1 : Math.sign(diff); diff = sgn * need; back = av + diff; }
  }
  if (p.implode) {
    const ang = back + (i / n) * Math.PI * 2 + jitter(i, 3) * 0.3;
    const r = 0.56 + 0.08 * jitter(i, 4);
    return { x: Math.cos(ang) * r, y: Math.sin(ang) * r };
  }
  const slot = p.darts[i]?.slot ?? 0;
  const maxSlot = Math.max(1, ...p.darts.map((x) => Math.abs(x.slot)));
  const spread = n === 1 ? 0 : n === 2 ? 0.6 : 1.35;
  const ang = back + (n === 1 ? 0.3 : (slot / maxSlot) * spread) + jitter(i, 1) * 0.12;
  const r = 0.56 + 0.12 * jitter(i, 2);
  return { x: Math.cos(ang) * r, y: Math.sin(ang) * r };
}

/**
 * Every dart's whole flight, from the plan and the two heroes. `aRadius` puts the release point on the thrower's rim
 * (toward the target); `radius` is the struck portrait's. The arc rises toward the top of the screen (never above
 * `ceilY`), so a dart always comes DOWN a little into the portrait. `avoid` is where the big -N pops (the darts stick
 * clear of it). Pure, so a replay flies the same paths.
 */
export function dartMotions(p: PoisonPlan, a: Pt, d: Pt, radius: number, aRadius: number, c: HeroPoisonConfig = cfg, ceilY = Number.NEGATIVE_INFINITY, avoid: Pt | null = null): DartMotion[] {
  if (p.reduced) return [];
  const dx = d.x - a.x, dy = d.y - a.y;
  const L = Math.hypot(dx, dy) || 1;
  const u = { x: dx / L, y: dy / L };
  const nrm = sideNormal(a, d);
  const dartLen = c.dartLength;
  return p.darts.map((dp, i) => {
    const off = stickOffset(p, i, a, d, avoid);
    const aim = { x: d.x + off.x * radius, y: d.y + off.y * radius };
    // Released just off the thrower's rim, the hand a little to the side per slot (a fanned flick, not one point).
    const rel = { x: a.x + u.x * aRadius * 0.75 + nrm.x * dp.slot * aRadius * 0.12, y: a.y + u.y * aRadius * 0.75 + nrm.y * dp.slot * aRadius * 0.12 };
    const ex = aim.x - rel.x, ey = aim.y - rel.y;
    const D = Math.hypot(ex, ey) || 1;
    const mid = { x: (rel.x + aim.x) / 2, y: (rel.y + aim.y) / 2 };
    const ctrl = { x: mid.x + nrm.x * dp.side * D, y: Math.max(ceilY, mid.y - dp.lift * D + nrm.y * dp.side * D) };
    // The heading it arrives at, plus a little per-dart wobble: darts stick at VARIED angles, never parallel.
    const rot = Math.atan2(aim.y - ctrl.y, aim.x - ctrl.x) + jitter(i, 5) * (p.darts.length > 1 ? 0.5 : 0.28);
    const pen = c.penetration * dartLen * p.size * dp.size;
    const b = { x: aim.x + Math.cos(rot) * pen * 0.35, y: aim.y + Math.sin(rot) * pen * 0.35 };
    return { a: rel, c: ctrl, b, flightMs: dp.flightMs, rot, aim };
  });
}

/** The direction the LAST dart is travelling as it lands (the impact's shake and splash follow it). Unit. */
export function arrivalDir(m: DartMotion | undefined, a: Pt, d: Pt): Pt {
  if (m) return { x: Math.cos(m.rot), y: Math.sin(m.rot) };
  const L = Math.hypot(d.x - a.x, d.y - a.y) || 1;
  return { x: (d.x - a.x) / L, y: (d.y - a.y) / L };
}

// ─── the camera (pure) ─────────────────────────────────────────────────────────────────────────────────────────

const springAt = (ms: number, hz: number, tau: number): number => (ms < 0 ? 0 : Math.exp(-ms / tau) * Math.cos(2 * Math.PI * hz * (ms / 1000)));
const sine = (u: number): number => 0.5 - 0.5 * Math.cos(Math.PI * Math.min(1, Math.max(0, u)));

/**
 * The camera at sequence time `t` (px in the space the points are in). A small push in on the hero through the ready;
 * a tiny recoil on each throw; a kick ALONG the dart on each tick; on THE impact a punch in and a directional shake.
 * Tier IV instead builds: the view pushes in on the struck hero through the swell while a faint tremor grows, pulls in
 * a hair more as the poison is sucked into a point, then the burst punches hardest with a shake that rings both ways.
 * Deterministic (sines and springs): a replay moves identically. Pure.
 */
export function poisonCameraAt(p: PoisonPlan, c: HeroPoisonConfig, t: number, dir: Pt = { x: 1, y: 0 }): { zoom: number; x: number; y: number } {
  if (p.reduced) return { zoom: 1, x: 0, y: 0 };
  let z = 0;
  if (t >= p.chargeAt && t < p.impactAt) {
    z += p.zoom * sine((t - p.chargeAt) / Math.max(1, p.throwAt - p.chargeAt));
    if (p.implode && t >= p.swellAt) {
      z += p.zoom * 0.8 * sine((t - p.swellAt) / Math.max(1, p.suckAt - p.swellAt));
      if (t >= p.suckAt) z += p.zoom * 0.5 * ((t - p.suckAt) / Math.max(1, p.impactAt - p.suckAt)) ** 2;
    }
  } else if (t >= p.impactAt) {
    const since = t - p.impactAt;
    z += (p.zoom * (p.implode ? 2.3 : 1) + p.punch) * Math.exp(-since / Math.max(1, c.zoomOutMs / 4));
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
  p.darts.forEach((d) => kick(d.throwAt, -p.shakePx * 0.1, 40, 14, dir));
  p.hits.forEach((at, i) => kick(at, p.shakePx * (0.28 + 0.04 * i), 40, 18, dir));
  if (p.implode) {
    // The swell builds a tremor (both axes, growing); the suck holds it tight; the burst rings both ways.
    if (t >= p.swellAt && t < p.impactAt) {
      const u = Math.min(1, (t - p.swellAt) / Math.max(1, p.suckAt - p.swellAt));
      const a = p.shakePx * 0.14 * u * u * (t >= p.suckAt ? 0.6 : 1);
      x += a * Math.sin(t * 0.13);
      y += a * Math.sin(t * 0.17 + 1.3);
    }
    const age = t - p.impactAt;
    if (age >= 0) {
      const env = Math.exp(-age / Math.max(1, c.shakeMs / 4));
      x += p.shakePx * 0.8 * env * Math.sin(age * 0.105 + 0.5);
      y += p.shakePx * env * Math.cos(age * 0.093);
    }
    p.booms.forEach((at, i) => kick(at, p.shakePx * 0.25, 45, 18, i % 2 ? perp : dir));
  } else {
    kick(p.impactAt, p.shakePx, Math.max(1, c.shakeMs / 4), 16, dir);
    kick(p.seepAt, p.shakePx * 0.12, 60, 10, perp);
  }
  return { zoom: 1 + Math.max(0, z), x, y };
}

/**
 * Where the camera anchors: the ATTACKER through the ready, following the volley in flight, and the DEFENDER from the
 * first thunk on. A zoom anchored on a point keeps that point still. Pure.
 */
export function poisonCameraFocus(p: PoisonPlan, t: number, a: Pt, d: Pt): Pt {
  const settle = p.darts.length ? Math.min(...p.darts.map((x) => x.arriveAt)) : p.impactAt;
  if (t <= p.throwAt) return a;
  if (t >= settle) return d;
  const u = (t - p.throwAt) / Math.max(1, settle - p.throwAt);
  const e = sine(u);
  return { x: a.x + (d.x - a.x) * e, y: a.y + (d.y - a.y) * e };
}
