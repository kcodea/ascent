/**
 * THE BEAST CHOMP RUSH HERO ATTACK ("Stampede"): its tuned values, its pure timeline, the pure beast paths, the bite
 * points and the pure camera.
 *
 * Owner 2026-09-29: "make some more attack types ... a beast chomp rush animation ... use the same 4 tier strategy we
 * have been."
 *
 * THE BEATS (base ms before the playback speed):
 *  1. THE DAMAGE FORMATION (shared by every style, `../heroAttack/damageFormation.ts`): minion tiers pulse left to
 *     right and merge, the hero tier joins, the full blow, the cap. Its end is this style's start.
 *  2. THE GROWL. The total sinks into the hero, who crouches back from the target while feral energy gathers round it:
 *     an amber ring closing in, a green bloom, embers drawn in, a low growl.
 *  3. THE RUSH. Spirit beasts (wolf heads of amber energy with streaming green manes and gleaming fangs) burst off the
 *     hero and LEAP at the target, jaws opening as they close in: I one; II two, staggered; III a pack of five
 *     streaming across in lanes, kicking up dust.
 *  4. THE CHOMP. As each beast arrives, a pair of spectral jaws (a front view: an upper fang row and a lower one) snaps
 *     SHUT over the struck portrait: a hard clamp, the fangs interlocking, a white flash, bite marks left in the face,
 *     the portrait squashed between the jaws and shaken. Every chomp before the last is a TICK (FX and sound only, a
 *     smaller bite off-centre). The LAST is THE impact: the big `-N`, the full-size clamp dead centre, the knockback.
 *     The consequence (the damage, Armor, Resolve) lands ONCE, there.
 *  IV. THE COLOSSUS. Six beasts rush and chomp all round the face (all ticks). Then a GIANT primal beast rises behind
 *     the target: colossal jaws fade in far above and below it (the screen framed by fangs), its eyes ignite and its
 *     mane flares, the jaws creep in, breathing; then they SLAM shut over the whole portrait (THE impact: the blow lands
 *     there) and, a beat later, the beast ROARS: the jaws spring open, shockwave rings and speed lines tear outward and
 *     the view trembles, then the colossus dissolves into embers.
 *
 * TIERS are the shared, owner-approved thresholds (I 1-5, II 6-11, III 12-19, IV 20+). No hit-stop anywhere (owner
 * 2026-09-28: "it looks like lag"). Flat 2D (owner 2026-09-29): every jaw, ring and mark is a flat shape, never a
 * tilted plane. Reduced motion: no beasts, jaws, shake or zoom; the numbers fade and the blow lands.
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
export const BEAST_TIER_SUFFIXES = [
  'ChargeMs', 'Beasts', 'StaggerMs', 'FlightMs', 'Leap', 'Spread', 'BeastSize', 'Dust', 'Colossal',
  'Shake', 'Zoom', 'Punch', 'Sparks', 'Burst', 'SettleMs', 'Dim',
] as const;
export type BeastTierSuffix = (typeof BEAST_TIER_SUFFIXES)[number];
type TierKey = `t${TierNum}${BeastTierSuffix}`;

interface GlobalConfig {
  // Tiers (the shared thresholds; DEV-tunable only)
  tier2At: number; tier3At: number; tier4At: number;
  // The growl
  absorbMs: number;
  heroCrouchPx: number;
  heroLungePx: number;
  // The beasts
  beastLength: number;
  beastGlow: number;
  maneMs: number;
  maneWidth: number;
  embers: number;
  jawOpen: number;
  // The chomp
  clampLeadMs: number;
  clampSize: number;
  biteHoldMs: number;
  biteMarkMs: number;
  tintAlpha: number;
  dustSize: number;
  // The colossus (Tier IV)
  riseMs: number;
  slamMs: number;
  colossalSize: number;
  roarDelayMs: number;
  roarHoldMs: number;
  roarRings: number;
  roarSize: number;
  flashAlpha: number;
  // Camera and portraits
  knockPx: number;
  squash: number;
  shakeMs: number;
  zoomOutMs: number;
  reducedFadeMs: number;
  // Colours
  colorCore: string;
  colorAmber: string;
  colorFeral: string;
  colorFang: string;
  colorDark: string;
  colorDust: string;
  colorPlayer: string;
  colorFoe: string;
  // Sound: a clip, a gain and a pitch per cue ('' = silent)
  sfxGrowlClip: string; sfxGrowlGain: number; sfxGrowlRate: number;
  sfxSnarlClip: string; sfxSnarlGain: number; sfxSnarlRate: number;
  sfxRushClip: string; sfxRushGain: number; sfxRushRate: number;
  sfxSnapClip: string; sfxSnapGain: number; sfxSnapRate: number;
  sfxCrunchClip: string; sfxCrunchGain: number; sfxCrunchRate: number;
  sfxImpactClip: string; sfxImpactGain: number; sfxImpactRate: number;
  sfxBigClip: string; sfxBigGain: number; sfxBigRate: number;
  sfxRiseClip: string; sfxRiseGain: number; sfxRiseRate: number;
  sfxSlamClip: string; sfxSlamGain: number; sfxSlamRate: number;
  sfxRoarClip: string; sfxRoarGain: number; sfxRoarRate: number;
  sfxBoomClip: string; sfxBoomGain: number; sfxBoomRate: number;
  sfxRumbleGain: number; sfxRumbleLowHz: number; sfxRumbleHighHz: number;
  sfxRushLenMs: number;
  sfxImpactLenMs: number;
  sfxTailMix: number;
  sfxDuck: number;
  // Preview only (the tuner's Play buttons). Never read by a real fight, and left out of Copy JSON.
  previewDamage: number;
  previewParts: number;
}
export type HeroBeastConfig = GlobalConfig & Record<TierKey, number>;

export const HERO_BEAST_COLOR_KEYS = ['colorCore', 'colorAmber', 'colorFeral', 'colorFang', 'colorDark', 'colorDust', 'colorPlayer', 'colorFoe'] as const;
export const HERO_BEAST_CLIP_KEYS = [
  'sfxGrowlClip', 'sfxSnarlClip', 'sfxRushClip', 'sfxSnapClip', 'sfxCrunchClip', 'sfxImpactClip',
  'sfxBigClip', 'sfxRiseClip', 'sfxSlamClip', 'sfxRoarClip', 'sfxBoomClip',
] as const;
type ColorKey = (typeof HERO_BEAST_COLOR_KEYS)[number];
type ClipKey = (typeof HERO_BEAST_CLIP_KEYS)[number];
export type HeroBeastStrKey = ColorKey | ClipKey;
export type HeroBeastNumKey = Exclude<keyof HeroBeastConfig, HeroBeastStrKey>;

/** Tier I .. IV per suffix: the escalation ladder. */
const TIER_DEFAULTS: Record<BeastTierSuffix, [number, number, number, number]> = {
  ChargeMs: [340, 380, 420, 440],
  Beasts: [1, 2, 5, 6],
  StaggerMs: [0, 210, 120, 95],
  FlightMs: [400, 380, 360, 330],
  Leap: [0.13, 0.11, 0.06, 0.06],
  Spread: [0, 0.06, 0.13, 0.12],
  BeastSize: [1.15, 1.05, 0.9, 0.85],
  Dust: [0, 0, 1, 1],
  Colossal: [0, 0, 0, 1],
  Shake: [6, 8, 11, 22],
  Zoom: [0.025, 0.035, 0.045, 0.07],
  Punch: [0.02, 0.028, 0.036, 0.06],
  Sparks: [14, 18, 26, 48],
  Burst: [1, 1.1, 1.3, 1.9],
  SettleMs: [260, 300, 320, 340],
  Dim: [0, 0.16, 0.3, 0.5],
};

export const BEAST_TIER_RANGES: Record<BeastTierSuffix, [number, number, number]> = {
  ChargeMs: [60, 1500, 10],
  Beasts: [1, 8, 1],
  StaggerMs: [0, 500, 5],
  FlightMs: [120, 1200, 10],
  Leap: [0, 0.4, 0.01],
  Spread: [0, 0.3, 0.01],
  BeastSize: [0.4, 2.5, 0.05],
  Dust: [0, 1, 1],
  Colossal: [0, 1, 1],
  Shake: [0, 40, 0.5],
  Zoom: [0, 0.14, 0.002],
  Punch: [0, 0.1, 0.001],
  Sparks: [0, 90, 1],
  Burst: [0.3, 3, 0.05],
  SettleMs: [0, 1600, 10],
  Dim: [0, 0.8, 0.01],
};

const tierDefaults = Object.fromEntries(TIERS.flatMap((t) => BEAST_TIER_SUFFIXES.map((s) => [`t${t}${s}`, TIER_DEFAULTS[s][t - 1]]))) as Record<TierKey, number>;

export const HERO_BEAST_DEFAULTS: HeroBeastConfig = {
  // The shared, owner-approved thresholds (6 / 12 / 20): the same blow steps the Beast up exactly where it steps Blast up.
  ...HERO_ATTACK_TIER_THRESHOLDS,
  absorbMs: 190,
  heroCrouchPx: 11,
  heroLungePx: 16,
  beastLength: 230,
  beastGlow: 0.75,
  maneMs: 60,
  maneWidth: 84,
  embers: 0.7,
  jawOpen: 0.62,
  clampLeadMs: 120,
  clampSize: 1,
  biteHoldMs: 340,
  biteMarkMs: 900,
  tintAlpha: 0.16,
  dustSize: 1,
  riseMs: 560,
  slamMs: 110,
  colossalSize: 1,
  roarDelayMs: 300,
  roarHoldMs: 420,
  roarRings: 3,
  roarSize: 1,
  flashAlpha: 0.85,
  knockPx: 16,
  squash: 0.1,
  shakeMs: 340,
  zoomOutMs: 380,
  reducedFadeMs: 260,
  colorCore: '#fff6dc',
  colorAmber: '#ffb53c',
  colorFeral: '#8dff4a',
  colorFang: '#fffbea',
  colorDark: '#2a1a08',
  colorDust: '#b08a58',
  colorPlayer: '#ffd24a',
  colorFoe: '#ff6a3a',
  sfxGrowlClip: 'fx/voidpanthergrowl', sfxGrowlGain: 0.45, sfxGrowlRate: 0.95,
  sfxSnarlClip: 'fx/dragon-growl-2', sfxSnarlGain: 0.26, sfxSnarlRate: 1.45,
  sfxRushClip: 'fx/stereogenicstudio-swish-swoosh-woosh-sfx-27-357164-3', sfxRushGain: 0.55, sfxRushRate: 0.85,
  sfxSnapClip: 'fx/universfield-whip-snap-242215', sfxSnapGain: 0.42, sfxSnapRate: 0.72,
  sfxCrunchClip: 'smack2', sfxCrunchGain: 0.7, sfxCrunchRate: 0.9,
  sfxImpactClip: 'crit', sfxImpactGain: 0.5, sfxImpactRate: 0.95,
  sfxBigClip: 'fx/heavy-rock-impact', sfxBigGain: 0.4, sfxBigRate: 1.1,
  sfxRiseClip: 'fx/dragon-growl', sfxRiseGain: 0.5, sfxRiseRate: 0.72,
  sfxSlamClip: 'titanhammer', sfxSlamGain: 0.7, sfxSlamRate: 1,
  sfxRoarClip: 'fx/dragon-growl', sfxRoarGain: 0.8, sfxRoarRate: 0.92,
  sfxBoomClip: 'turnexplosion', sfxBoomGain: 0.35, sfxBoomRate: 0.8,
  sfxRumbleGain: 0.32, sfxRumbleLowHz: 40, sfxRumbleHighHz: 420,
  sfxRushLenMs: 360,
  sfxImpactLenMs: 900,
  sfxTailMix: 0.12,
  sfxDuck: 0.5,
  previewDamage: 12,
  previewParts: 4,
  ...tierDefaults,
};

const GLOBAL_RANGES: Record<Exclude<keyof GlobalConfig, HeroBeastStrKey>, [number, number, number]> = {
  tier2At: [2, 40, 1], tier3At: [2, 60, 1], tier4At: [2, 80, 1],
  absorbMs: [60, 600, 10],
  heroCrouchPx: [0, 40, 1],
  heroLungePx: [0, 50, 1],
  beastLength: [60, 360, 1],
  beastGlow: [0, 1.5, 0.05],
  maneMs: [0, 300, 5],
  maneWidth: [4, 120, 1],
  embers: [0, 2, 0.05],
  jawOpen: [0, 1.2, 0.01],
  clampLeadMs: [40, 400, 5],
  clampSize: [0.4, 2.5, 0.05],
  biteHoldMs: [80, 1500, 10],
  biteMarkMs: [100, 3000, 10],
  tintAlpha: [0, 0.8, 0.01],
  dustSize: [0.3, 3, 0.05],
  riseMs: [150, 2000, 10],
  slamMs: [40, 400, 5],
  colossalSize: [0.4, 2.5, 0.05],
  roarDelayMs: [60, 1200, 10],
  roarHoldMs: [100, 1500, 10],
  roarRings: [0, 6, 1],
  roarSize: [0.3, 3, 0.05],
  flashAlpha: [0, 1, 0.01],
  knockPx: [0, 60, 1],
  squash: [0, 0.3, 0.01],
  shakeMs: [0, 1200, 10],
  zoomOutMs: [60, 1500, 10],
  reducedFadeMs: [60, 1000, 10],
  sfxGrowlGain: [0, 2, 0.05], sfxGrowlRate: [0.5, 2, 0.01],
  sfxSnarlGain: [0, 2, 0.05], sfxSnarlRate: [0.5, 2.5, 0.01],
  sfxRushGain: [0, 2, 0.05], sfxRushRate: [0.5, 2.5, 0.01],
  sfxSnapGain: [0, 2, 0.05], sfxSnapRate: [0.4, 2.5, 0.01],
  sfxCrunchGain: [0, 2, 0.05], sfxCrunchRate: [0.5, 2, 0.01],
  sfxImpactGain: [0, 2, 0.05], sfxImpactRate: [0.5, 2, 0.01],
  sfxBigGain: [0, 2, 0.05], sfxBigRate: [0.5, 2, 0.01],
  sfxRiseGain: [0, 2, 0.05], sfxRiseRate: [0.4, 2, 0.01],
  sfxSlamGain: [0, 2, 0.05], sfxSlamRate: [0.5, 2, 0.01],
  sfxRoarGain: [0, 2, 0.05], sfxRoarRate: [0.4, 2, 0.01],
  sfxBoomGain: [0, 2, 0.05], sfxBoomRate: [0.5, 2, 0.01],
  sfxRumbleGain: [0, 2, 0.05], sfxRumbleLowHz: [15, 400, 5], sfxRumbleHighHz: [80, 2000, 10],
  sfxRushLenMs: [80, 1500, 10],
  sfxImpactLenMs: [150, 3500, 10],
  sfxTailMix: [0, 0.6, 0.01],
  sfxDuck: [0, 1, 0.05],
  previewDamage: [1, 60, 1],
  previewParts: [1, 8, 1],
};

/** [min, max, step] per numeric key. Values outside are clamped on write AND on load. */
export const HERO_BEAST_RANGES: Record<HeroBeastNumKey, [number, number, number]> = {
  ...GLOBAL_RANGES,
  ...(Object.fromEntries(TIERS.flatMap((t) => BEAST_TIER_SUFFIXES.map((s) => [`t${t}${s}`, BEAST_TIER_RANGES[s]]))) as Record<TierKey, [number, number, number]>),
};

/** The hard ceilings a plan can never exceed, whatever the sliders say (so a 40 stays clean, not cluttered). */
export const BEAST_CAPS = { beasts: 8, sparks: 90, shakePx: 40, zoom: 0.14, roarRings: 6 } as const;

const HEX = /^#[0-9a-f]{6}$/i;
const isColorKey = (k: string): k is ColorKey => (HERO_BEAST_COLOR_KEYS as readonly string[]).includes(k);
const isClipKey = (k: string): k is ClipKey => (HERO_BEAST_CLIP_KEYS as readonly string[]).includes(k);

/** One value, made safe: numbers clamped into range (junk = the default), colours #rrggbb, clips a short string. */
export function clampHeroBeastValue<K extends keyof HeroBeastConfig>(key: K, value: unknown): HeroBeastConfig[K] | undefined {
  if (!Object.prototype.hasOwnProperty.call(HERO_BEAST_DEFAULTS, key)) return undefined;
  const def = HERO_BEAST_DEFAULTS[key];
  if (isColorKey(key)) {
    if (typeof value !== 'string') return def;
    const v = value.trim();
    return (HEX.test(v) ? v.toLowerCase() : def) as HeroBeastConfig[K];
  }
  if (isClipKey(key)) return (typeof value === 'string' ? value.trim().slice(0, 160) : def) as HeroBeastConfig[K];
  const n = typeof value === 'number' ? value : Number(value);
  if (typeof value === 'boolean' || value === null || value === '' || !Number.isFinite(n)) return def;
  const [min, max] = HERO_BEAST_RANGES[key as HeroBeastNumKey];
  return Math.min(max, Math.max(min, n)) as HeroBeastConfig[K];
}

/** A whole saved object, sanitised key by key over the defaults (junk and unknown keys dropped). */
export function sanitizeHeroBeastConfig(saved: unknown): HeroBeastConfig {
  const out: HeroBeastConfig = { ...HERO_BEAST_DEFAULTS };
  if (!saved || typeof saved !== 'object') return out;
  for (const [k, v] of Object.entries(saved as Record<string, unknown>)) {
    const safe = clampHeroBeastValue(k as keyof HeroBeastConfig, v);
    if (safe !== undefined) (out as unknown as Record<string, unknown>)[k] = safe;
  }
  return out;
}

const KEY = 'ascent.herobeast.v1';

let cfg: HeroBeastConfig = (() => {
  if (!import.meta.env.DEV || typeof localStorage === 'undefined') return { ...HERO_BEAST_DEFAULTS };
  try { return sanitizeHeroBeastConfig(JSON.parse(localStorage.getItem(KEY) ?? '{}')); } catch { return { ...HERO_BEAST_DEFAULTS }; }
})();

export function getHeroBeastConfig(): HeroBeastConfig { return cfg; }

export function setHeroBeastValue(key: keyof HeroBeastConfig, value: number | string): void {
  const safe = clampHeroBeastValue(key, value);
  if (safe === undefined) return;
  cfg = { ...cfg, [key]: safe };
  if (!import.meta.env.DEV) return;
  try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch { /* ignore */ }
}

export function resetHeroBeastConfig(): void {
  cfg = { ...HERO_BEAST_DEFAULTS };
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}

/** The tuned values as JSON for pasting back into DEFAULTS (the preview-only keys left out). */
export function heroBeastConfigJson(c: HeroBeastConfig = cfg): string {
  const ship: Partial<HeroBeastConfig> = { ...c };
  delete ship.previewDamage;
  delete ship.previewParts;
  return JSON.stringify(ship, null, 2);
}

// ─── the preview speed (DEV only, never saved) ─────────────────────────────────────────────────────────────────

export const HERO_BEAST_SPEEDS = [1, 0.5, 0.25] as const;
export type HeroBeastSpeed = (typeof HERO_BEAST_SPEEDS)[number];
let speed: HeroBeastSpeed = 1;
/** The tuner's slow motion. Always 1 in production. */
export function heroBeastPreviewSpeed(): HeroBeastSpeed { return import.meta.env.DEV ? speed : 1; }
export function setHeroBeastPreviewSpeed(s: HeroBeastSpeed): void { speed = s; }

// ─── the pure plan ─────────────────────────────────────────────────────────────────────────────────────────────

/** One tier's dials, read out of the config. */
export function beastTierDials(tier: TierNum, c: HeroBeastConfig = cfg): Record<BeastTierSuffix, number> {
  return Object.fromEntries(BEAST_TIER_SUFFIXES.map((s) => [s, c[`t${tier}${s}`]])) as Record<BeastTierSuffix, number>;
}

/** The reference distance the per-tier flight times are tuned at (a 1080p board, corner to corner). */
export const BEAST_REF_DISTANCE = 1600;

/** A beast's leap for a distance: the tier's time, scaled gently by the distance (a sandbox box stays readable). */
export function beastFlightMs(distance: number, tierMs: number): number {
  const d = Number.isFinite(distance) && distance > 0 ? distance : BEAST_REF_DISTANCE;
  return Math.round(tierMs * clamp(Math.sqrt(d / BEAST_REF_DISTANCE), 0.62, 1.15));
}

/**
 * The pack's lanes, in LAUNCH order: the flanks first, the centre last (the pack closes in, and the last to bite, THE
 * impact, runs down the middle). Signed slots: 0 = the centre line.
 */
export function packSlots(n: number): number[] {
  if (n <= 1) return [0];
  if (n === 2) return [-1, 1];
  const out: number[] = [];
  const half = Math.floor(n / 2);
  for (let k = half; k >= 1; k--) { out.push(-k); out.push(k); }
  if (n % 2 === 1) out.push(0);
  return out.slice(0, n);
}

export interface BeastPlanItem {
  launchAt: number;
  flightMs: number;
  arriveAt: number;
  /** How high the leap rises (a fraction of the distance, toward the top of the screen). */
  leap: number;
  /** How far the lane swings off to one side of the line (a fraction of the distance; signed). */
  side: number;
  /** The lane (signed; 0 = the centre line). */
  slot: number;
  /** Size multiplier (the last is a touch bigger). */
  size: number;
}

export interface BeastPlanInput {
  /** When the style's own attack starts: the end of the shared damage formation (`formationPlan().endAt`). */
  leadIn?: number;
  /** THE blow, as the engine decided it. */
  total: number;
  /** Screen px between the attacker's and the defender's centres. */
  distance: number;
  reduced?: boolean;
}

export interface BeastPlan {
  reduced: boolean;
  tier: TierNum;
  /** 0..1 across the tiers (I = 0, IV = 1). */
  k: number;
  total: number;
  /** The growl starts: the total sinks into the hero, feral energy gathers. */
  chargeAt: number;
  absorbEnd: number;
  /** The first beast leaps. */
  launchAt: number;
  beasts: BeastPlanItem[];
  /** The pack kicks up dust (III and IV). */
  dust: boolean;
  /** Tier IV: the colossus rises, slams its jaws and roars. */
  colossal: boolean;
  /** Tier IV: the colossus starts to rise behind the target (else the impact). */
  riseAt: number;
  /** Tier IV: the colossal jaws start to slam (else the impact). */
  slamAt: number;
  /** Chomps that land BEFORE the impact, sequence ms: the rhythm ticks (Tier IV: every beast). */
  chomps: number[];
  /** THE consequence beat: the last chomp (I-III) or the colossal jaws shutting (IV). */
  impactAt: number;
  /** Tier IV: the roar (FX only; else the impact). */
  roarAt: number;
  /** When the last jaws let go (I-III: the impact's clamp releasing; IV: the colossus dissolving). */
  releaseAt: number;
  endAt: number;
  size: number;
  shakePx: number;
  zoom: number;
  punch: number;
  sparks: number;
  burst: number;
  dim: number;
}

/** The whole Stampede, in base ms (divide by the playback speed for real time). Pure and deterministic. */
export function beastPlan(input: BeastPlanInput, c: HeroBeastConfig = cfg): BeastPlan {
  const total = Math.max(0, Math.round(input.total));
  const tier = tierOf(total, c);
  const T = beastTierDials(tier, c);
  const k = (tier - 1) / 3;

  if (input.reduced) {
    const r = reducedAttackTimeline(input.leadIn ?? 0, c.reducedFadeMs);
    const { impactAt } = r;
    return {
      reduced: true, tier, k, total,
      chargeAt: impactAt, absorbEnd: impactAt, launchAt: impactAt, beasts: [], dust: false, colossal: false,
      riseAt: impactAt, slamAt: impactAt, chomps: [], impactAt, roarAt: impactAt, releaseAt: impactAt, endAt: r.endAt,
      size: 0, shakePx: 0, zoom: 0, punch: 0, sparks: 0, burst: 0, dim: 0,
    };
  }

  // The shared damage formation plays first; the style's own attack starts when it ends.
  const chargeAt = Math.max(0, input.leadIn ?? 0);
  const absorbEnd = chargeAt + c.absorbMs;
  const launchAt = chargeAt + Math.max(T.ChargeMs, c.absorbMs);
  const colossal = T.Colossal >= 1;
  const count = clamp(Math.round(T.Beasts), 1, BEAST_CAPS.beasts);
  const flight = beastFlightMs(input.distance, T.FlightMs);
  const slots = packSlots(count);
  const maxSlot = Math.max(1, ...slots.map((s) => Math.abs(s)));
  const beasts: BeastPlanItem[] = slots.map((slot, i) => {
    const at = launchAt + i * T.StaggerMs;
    // A pair: one leaps higher and wide one way, one lower the other way. A pack spreads evenly across its lanes.
    const leap = count === 2 ? T.Leap * (slot < 0 ? 1.3 : 0.75) : T.Leap * (1 - 0.2 * (Math.abs(slot) / maxSlot));
    const side = count === 2 ? slot * T.Spread : (slot / maxSlot) * T.Spread;
    // Flank lanes run a longer arc: a hair more time, so the rhythm stays even and the centre bites last.
    const fl = Math.round(flight * (1 + 0.05 * Math.abs(slot)));
    return { launchAt: at, flightMs: fl, arriveAt: at + fl, leap, side, slot, size: i === count - 1 && !colossal ? 1.08 : 1 };
  });
  // Keep the launch order's rhythm on arrival: each bites at least `gap` after the one before.
  const gap = count > 2 ? Math.max(70, T.StaggerMs * 0.8) : count === 2 ? Math.max(120, T.StaggerMs * 0.8) : 0;
  for (let i = 1; i < beasts.length; i++) {
    const d = beasts[i]!, prev = beasts[i - 1]!;
    if (gap && d.arriveAt < prev.arriveAt + gap) { d.flightMs += prev.arriveAt + gap - d.arriveAt; d.arriveAt = d.launchAt + d.flightMs; }
  }
  const lastIn = Math.max(...beasts.map((d) => d.arriveAt));
  const riseAt = colossal ? lastIn + 110 : lastIn;
  const slamAt = colossal ? riseAt + c.riseMs : lastIn;
  const impactAt = colossal ? slamAt + c.slamMs : lastIn;
  const chomps = (colossal ? beasts.map((d) => d.arriveAt) : beasts.slice(0, -1).map((d) => d.arriveAt)).sort((a, b) => a - b);
  const roarAt = colossal ? impactAt + c.roarDelayMs : impactAt;
  const releaseAt = colossal ? roarAt + c.roarHoldMs : impactAt + c.biteHoldMs;
  const lastBeat = Math.max(
    impactAt + 160,
    impactAt + c.zoomOutMs * 0.8,
    // The jaws and marks finish fading after the end (the scene keeps ticking until it is empty), so the fight never
    // waits on a fading bite mark or a drifting ember.
    colossal ? roarAt + 260 : releaseAt,
  );
  const endAt = lastBeat + T.SettleMs;

  return {
    reduced: false, tier, k, total, chargeAt, absorbEnd, launchAt,
    beasts, dust: T.Dust >= 1, colossal, riseAt, slamAt, chomps, impactAt, roarAt, releaseAt, endAt,
    size: T.BeastSize,
    shakePx: clamp(T.Shake, 0, BEAST_CAPS.shakePx),
    zoom: clamp(T.Zoom, 0, BEAST_CAPS.zoom),
    punch: T.Punch,
    sparks: Math.round(clamp(T.Sparks, 0, BEAST_CAPS.sparks)),
    burst: T.Burst,
    dim: T.Dim,
  };
}

export type BeastCueKind = 'charge' | 'launch' | 'chomp' | 'rise' | 'impact' | 'roar' | 'end';
export interface BeastCue { at: number; kind: BeastCueKind; i: number }

/** Every beat the runner fires, in time order (ties keep this declaration order, so a chomp precedes the impact). */
export function beastCues(p: BeastPlan): BeastCue[] {
  const out: BeastCue[] = [];
  if (!p.reduced) {
    out.push({ at: p.chargeAt, kind: 'charge', i: 0 });
    p.beasts.forEach((d, i) => out.push({ at: d.launchAt, kind: 'launch', i }));
    // Every beast but the last chomps as a tick (Tier IV: every beast); the last one IS the impact.
    p.beasts.forEach((d, i) => { if (p.colossal || i < p.beasts.length - 1) out.push({ at: d.arriveAt, kind: 'chomp', i }); });
    if (p.colossal) out.push({ at: p.riseAt, kind: 'rise', i: 0 });
  }
  out.push({ at: p.impactAt, kind: 'impact', i: 0 });
  if (p.colossal) out.push({ at: p.roarAt, kind: 'roar', i: 0 });
  out.push({ at: p.endAt, kind: 'end', i: 0 });
  const order: Record<BeastCueKind, number> = { charge: 0, launch: 1, chomp: 2, rise: 3, impact: 4, roar: 5, end: 6 };
  return out.map((q, idx) => ({ q, idx })).sort((a, b) => a.q.at - b.q.at || order[a.q.kind] - order[b.q.kind] || a.idx - b.idx).map((x) => x.q);
}

// ─── the beast paths and the bite points (pure) ────────────────────────────────────────────────────────────────

/**
 * A beast's whole leap. `a` where it bursts off the attacker (on its rim, toward the target, shifted into its lane),
 * `c` the leap's control point, `b` where its MOUTH arrives (the bite point on the struck portrait). `rot` is the
 * heading it arrives on (radians). `bite` is the jaw clamp: its centre, its size (a fraction of the full clamp) and its
 * tilt.
 */
export interface BeastMotion {
  a: Pt; c: Pt; b: Pt; flightMs: number; rot: number;
  bite: { x: number; y: number; scale: number; tilt: number };
}

/** The beast's progress along its leap: a burst off the mark, then still ACCELERATING into the pounce (it lunges). */
export const leapEase = (u: number): number => { const t = Math.min(1, Math.max(0, Number.isFinite(u) ? u : 0)); return 0.62 * t + 0.38 * t * t; };

function quad(a: Pt, c: Pt, b: Pt, e: number): Pt {
  const m = 1 - e;
  return { x: m * m * a.x + 2 * m * e * c.x + e * e * b.x, y: m * m * a.y + 2 * m * e * c.y + e * e * b.y };
}

function quadHeading(a: Pt, c: Pt, b: Pt, e: number): number {
  const dx = 2 * (1 - e) * (c.x - a.x) + 2 * e * (b.x - c.x);
  const dy = 2 * (1 - e) * (c.y - a.y) + 2 * e * (b.y - c.y);
  return Math.atan2(dy, dx);
}

/**
 * Where a beast's MOUTH is `t` ms after its launch, and which way it faces. Pure: the scene samples it back in time for
 * the streaming mane; after the leap it holds the bite pose.
 */
export function beastPos(m: BeastMotion, t: number): { x: number; y: number; rot: number } {
  if (t <= 0) return { x: m.a.x, y: m.a.y, rot: quadHeading(m.a, m.c, m.b, 0) };
  if (t >= m.flightMs) return { x: m.b.x, y: m.b.y, rot: m.rot };
  const e = leapEase(t / m.flightMs);
  const p = quad(m.a, m.c, m.b, e);
  return { x: p.x, y: p.y, rot: quadHeading(m.a, m.c, m.b, e) };
}

/** The side normal of a line (a fixed turn of its direction), so a signed `side` always swings the same way. */
export function sideNormal(a: Pt, b: Pt): Pt {
  const dx = b.x - a.x, dy = b.y - a.y;
  const d = Math.hypot(dx, dy) || 1;
  return { x: -dy / d, y: dx / d };
}

/** A small fixed pseudo-random per index (no state): the same pack bites the same way. */
const jitter = (i: number, salt: number): number => { const s = Math.sin((i + 1) * 12.9898 + salt * 78.233) * 43758.5453; return s - Math.floor(s) - 0.5; };

/**
 * Where each chomp clamps on the struck portrait (offset from its centre in portrait radii), how big (a fraction of
 * the full clamp) and its tilt. THE impact (the last beast, I-III) bites dead centre at full size. The ticks bite
 * smaller and off-centre, on the side of the face that looks back at the pack, swung clear of the big `-N` (it pops
 * from the struck hero toward the middle of the screen). IV's six ticks ring the whole face, so the colossus has a
 * mauled portrait to close on.
 */
export function biteOffset(p: BeastPlan, i: number, a: Pt, d: Pt, avoid: Pt | null = null): { x: number; y: number; scale: number; tilt: number } {
  const n = p.beasts.length;
  const tilt = jitter(i, 7) * 0.5;
  if (!p.colossal && i === n - 1) return { x: 0, y: 0, scale: 1, tilt: tilt * 0.3 };
  let back = Math.atan2(a.y - d.y, a.x - d.x);
  if (avoid && !p.colossal && Math.hypot(avoid.x - d.x, avoid.y - d.y) > 1) {
    const av = Math.atan2(avoid.y - d.y, avoid.x - d.x);
    let diff = Math.atan2(Math.sin(back - av), Math.cos(back - av));
    const need = 1.2;
    if (Math.abs(diff) < need) { const sgn = diff === 0 ? 1 : Math.sign(diff); diff = sgn * need; back = av + diff; }
  }
  if (p.colossal) {
    const ang = back + (i / n) * Math.PI * 2 + jitter(i, 3) * 0.3;
    const r = 0.42 + 0.06 * jitter(i, 4);
    return { x: Math.cos(ang) * r, y: Math.sin(ang) * r, scale: 0.7, tilt };
  }
  const ticks = Math.max(1, n - 1);
  const ang = back + (ticks === 1 ? 0.35 : ((i / (ticks - 1)) - 0.5) * 1.6) + jitter(i, 1) * 0.15;
  const r = 0.38 + 0.08 * jitter(i, 2);
  return { x: Math.cos(ang) * r, y: Math.sin(ang) * r, scale: 0.74, tilt };
}

/**
 * Every beast's whole leap, from the plan and the two heroes. `aRadius` puts the burst point on the attacker's rim
 * (toward the target); `radius` is the struck portrait's. The leap rises toward the top of the screen (never above
 * `ceilY`), so a beast always comes DOWN onto the portrait. `avoid` is where the big -N pops. Pure, so a replay runs
 * the same leaps.
 */
export function beastMotions(p: BeastPlan, a: Pt, d: Pt, radius: number, aRadius: number, ceilY = Number.NEGATIVE_INFINITY, avoid: Pt | null = null): BeastMotion[] {
  if (p.reduced) return [];
  const dx = d.x - a.x, dy = d.y - a.y;
  const L = Math.hypot(dx, dy) || 1;
  const u = { x: dx / L, y: dy / L };
  const nrm = sideNormal(a, d);
  const maxSlot = Math.max(1, ...p.beasts.map((x) => Math.abs(x.slot)));
  return p.beasts.map((bp, i) => {
    const off = biteOffset(p, i, a, d, avoid);
    const bite = { x: d.x + off.x * radius, y: d.y + off.y * radius, scale: off.scale, tilt: off.tilt };
    // The mouth arrives just short of the bite centre, on the pack's side of it: the jaws close over it from there.
    const lane = (bp.slot / maxSlot) * aRadius * 0.45;
    const rel = { x: a.x + u.x * aRadius * 0.7 + nrm.x * lane, y: a.y + u.y * aRadius * 0.7 + nrm.y * lane };
    const ex = bite.x - rel.x, ey = bite.y - rel.y;
    const D = Math.hypot(ex, ey) || 1;
    const arrive = { x: bite.x - (ex / D) * radius * 0.18, y: bite.y - (ey / D) * radius * 0.18 };
    const mid = { x: (rel.x + arrive.x) / 2, y: (rel.y + arrive.y) / 2 };
    const ctrl = { x: mid.x + nrm.x * bp.side * D, y: Math.max(ceilY, mid.y - bp.leap * D + nrm.y * bp.side * D) };
    const rot = Math.atan2(arrive.y - ctrl.y, arrive.x - ctrl.x);
    return { a: rel, c: ctrl, b: arrive, flightMs: bp.flightMs, rot, bite };
  });
}

/** The direction the LAST beast is travelling as it bites (the impact's knockback follows it). Unit. */
export function arrivalDir(m: BeastMotion | undefined, a: Pt, d: Pt): Pt {
  if (m) return { x: Math.cos(m.rot), y: Math.sin(m.rot) };
  const L = Math.hypot(d.x - a.x, d.y - a.y) || 1;
  return { x: (d.x - a.x) / L, y: (d.y - a.y) / L };
}

// ─── the jaw clamp (pure) ──────────────────────────────────────────────────────────────────────────────────────

/** The bite past closed: 0 at the snap, peaking at `amp` after `peakMs`, then easing back (continuous, no jump). */
const biteIn = (ms: number, amp: number, peakMs: number): number => { const u = Math.max(0, ms) / peakMs; return amp * u * Math.exp(1 - u); };

/**
 * The gap between the two fang rows `ms` after a chomp lands (negative = before it), in portrait radii of the clamp's
 * own size: the jaws fade in wide `lead` ms before, SLAM shut (accelerating, so the snap is crisp), bite a hair past
 * closed and spring back to a clenched hold, then pull apart as they let go. Negative gaps are fangs INTERLOCKING.
 * Pure: the scene and the tests read the same curve.
 */
export function clampGap(ms: number, lead: number, hold: number): number {
  const OPEN = 1.4, SHUT = -0.08;
  if (ms < -lead) return OPEN;
  if (ms < 0) { const u = (ms + lead) / Math.max(1, lead); return OPEN + (SHUT - OPEN) * u * u * u; }
  if (ms < hold) return SHUT - biteIn(ms, 0.1, 25) + 0.02 * (1 - Math.exp(-ms / 60));
  const r = Math.min(1, (ms - hold) / 220);
  return SHUT + 0.02 + (0.55 - SHUT) * (1 - (1 - r) * (1 - r));
}

/** The clamp's opacity at the same clock: in fast, held, out as the jaws let go. */
export function clampAlpha(ms: number, lead: number, hold: number): number {
  if (ms < -lead) return 0;
  if (ms < 0) return Math.min(1, ((ms + lead) / Math.max(1, lead)) * 2.2);
  if (ms < hold) return 1;
  return Math.max(0, 1 - (ms - hold) / 220);
}

/**
 * THE COLOSSUS's jaw gap `ms` after it starts to rise (in portrait radii): far apart and creeping in, breathing,
 * through the rise; the SLAM (accelerating) to interlocked at `riseMs + slamMs` (THE impact); clenched; sprung open by
 * the roar at `roarAt`; drifting apart as it dissolves at `releaseAt`.
 */
export function colossalGap(ms: number, riseMs: number, slamMs: number, roarAt: number, releaseAt: number): number {
  const WIDE = 3, NEAR = 2.1, SHUT = -0.1, ROAR = 1.35;
  if (ms <= 0) return WIDE;
  if (ms < riseMs) { const u = ms / Math.max(1, riseMs); return WIDE + (NEAR - WIDE) * (1 - (1 - u) * (1 - u)) + 0.06 * Math.sin(ms * 0.018); }
  const slamEnd = riseMs + slamMs;
  if (ms < slamEnd) { const u = (ms - riseMs) / Math.max(1, slamMs); return NEAR + (SHUT - NEAR) * u * u * u; }
  if (ms < roarAt) return SHUT - biteIn(ms - slamEnd, 0.14, 30);
  if (ms < releaseAt) { const u = Math.min(1, (ms - roarAt) / 130); return SHUT + (ROAR - SHUT) * (1 - (1 - u) * (1 - u) * (1 - u)); }
  const u = Math.min(1, (ms - releaseAt) / 360);
  return ROAR + 1.2 * u;
}

// ─── the camera (pure) ─────────────────────────────────────────────────────────────────────────────────────────

const springAt = (ms: number, hz: number, tau: number): number => (ms < 0 ? 0 : Math.exp(-ms / tau) * Math.cos(2 * Math.PI * hz * (ms / 1000)));
const sine = (u: number): number => 0.5 - 0.5 * Math.cos(Math.PI * Math.min(1, Math.max(0, u)));

/**
 * The camera at sequence time `t` (px in the space the points are in). A push in on the hero through the growl; a
 * small recoil on each leap; a VERTICAL kick on each chomp (the jaws snap top to bottom) with a nudge along the beast;
 * on THE impact a punch in and a hard shake. Tier IV instead builds: the view pushes in on the target while the
 * colossus rises and a low tremor grows, the slam punches hardest, and the roar rattles the view fast both ways.
 * Deterministic (sines and springs): a replay moves identically. Pure.
 */
export function beastCameraAt(p: BeastPlan, c: HeroBeastConfig, t: number, dir: Pt = { x: 1, y: 0 }): { zoom: number; x: number; y: number } {
  if (p.reduced) return { zoom: 1, x: 0, y: 0 };
  let z = 0;
  if (t >= p.chargeAt && t < p.impactAt) {
    z += p.zoom * sine((t - p.chargeAt) / Math.max(1, p.launchAt - p.chargeAt));
    if (p.colossal && t >= p.riseAt) z += p.zoom * 0.6 * sine((t - p.riseAt) / Math.max(1, p.slamAt - p.riseAt));
  } else if (t >= p.impactAt) {
    const since = t - p.impactAt;
    // The colossus punches less far in than it could: the jaws are huge, and the view has to keep them on screen.
    z += (p.zoom * (p.colossal ? 1.5 : 1) + p.punch) * Math.exp(-since / Math.max(1, c.zoomOutMs / 4));
    if (p.colossal && t >= p.roarAt) z += p.punch * 0.6 * Math.exp(-(t - p.roarAt) / 90);
  }
  const down = { x: 0, y: 1 };
  let x = 0, y = 0;
  const kick = (at: number, amp: number, tau: number, hz: number, v: Pt): void => {
    const age = t - at;
    if (age < 0) return;
    const s = springAt(age, hz, tau);
    x += v.x * amp * s;
    y += v.y * amp * s;
  };
  p.beasts.forEach((d) => kick(d.launchAt, -p.shakePx * 0.1, 40, 14, dir));
  p.chomps.forEach((at, i) => { kick(at, p.shakePx * (0.34 + 0.04 * i), 45, 17, down); kick(at, p.shakePx * 0.12, 40, 12, dir); });
  if (p.colossal) {
    if (t >= p.riseAt && t < p.impactAt) {
      const u = Math.min(1, (t - p.riseAt) / Math.max(1, p.slamAt - p.riseAt));
      const a = p.shakePx * 0.1 * u * u;
      x += a * Math.sin(t * 0.11);
      y += a * Math.sin(t * 0.15 + 1.1);
    }
    kick(p.impactAt, p.shakePx, Math.max(1, c.shakeMs / 4), 15, down);
    const age = t - p.roarAt;
    if (age >= 0) {
      const env = Math.exp(-age / Math.max(1, c.shakeMs / 3));
      x += p.shakePx * 0.55 * env * Math.sin(age * 0.19 + 0.4);
      y += p.shakePx * 0.45 * env * Math.cos(age * 0.23);
    }
  } else {
    kick(p.impactAt, p.shakePx, Math.max(1, c.shakeMs / 4), 16, down);
    kick(p.impactAt, p.shakePx * 0.35, Math.max(1, c.shakeMs / 5), 11, dir);
  }
  return { zoom: 1 + Math.max(0, z), x, y };
}


/**
 * Where the camera anchors: the ATTACKER through the growl, following the pack in flight, and the DEFENDER from the
 * first chomp on. A zoom anchored on a point keeps that point still. Pure.
 */
export function beastCameraFocus(p: BeastPlan, t: number, a: Pt, d: Pt): Pt {
  const settle = p.beasts.length ? Math.min(...p.beasts.map((x) => x.arriveAt)) : p.impactAt;
  if (t <= p.launchAt) return a;
  if (t >= settle) return d;
  const u = (t - p.launchAt) / Math.max(1, settle - p.launchAt);
  const e = sine(u);
  return { x: a.x + (d.x - a.x) * e, y: a.y + (d.y - a.y) * e };
}
