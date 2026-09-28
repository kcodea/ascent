/**
 * THE QUAKE HERO ATTACK: its tuned values and its pure timeline.
 *
 * Owner 2026-09-28: "branch off and make a new attack animation called quake. same attack dmg threshold logic as
 * blast. the concept being an earthquake attack essentially with varying degrees of strength/cracks/explosions".
 *
 * THE BEATS (base ms before the playback speed):
 *  1. THE DAMAGE FORMATION (shared by every style, `../heroAttack/damageFormation.ts`, owner ask 2026-09-28): minion
 *     tiers pulse left to right and merge, the hero tier joins, the full blow, the cap. Its end is this style's start.
 * REWORKED the same day (owner: "the quake animation is not up to par with the others ... maybe only the huge hit should
 * quake, and the others can be slightly different? i think the line animation is over used. i also think the quake
 * itself could look a bit better, maybe faster but then have pixi burst out of it almost like an eruption"):
 *  - Tiers I-III HURL BOULDERS, no crack line: the hero stomps, a boulder is ripped out of the ground and lobbed high
 *    (a shadow sliding under it), and STONE SPIKES burst out round the target with a spray of molten grit. I: one
 *    boulder; II: two (the first a tick); III: three, hot, glowing, magma in the spikes.
 *  - Tier IV is the only EARTHQUAKE, faster: a quick fracture (~300 ms), then the ERUPTION: a light burst, a shock ring,
 *    spikes, a violent upward spray of magma, the pillar, embers, the crater.
 * The original beats (the Tier IV path now):
 *  2. WIND-UP. The total dives into the attacking hero, who RISES (anticipation) while pebbles lift off the ground
 *     around them and a low tremor starts; the view pushes in on the hero.
 *  3. SLAM. The hero drives down into the ground: a squash, a hard vertical jolt, a thick dust shockwave, a starburst of
 *     short cracks, pebbles slammed down. Tier IV: the slam cracks the whole board.
 *  4. TRAVEL. The quake rolls to the target: the main crack races along the ground (accelerating), opening up behind
 *     its tip, kicking up dust and grit; branches split off it (II+), parallel fissures and magma seams glow (III+),
 *     and secondary eruptions go off along the path (III+). The camera RUMBLES, mostly vertically, building as it goes.
 *  5. IMPACT. The ground ERUPTS under the target: a white flash, a magma bloom, a spurt of light, a burst of cracks
 *     around the portrait, rock chunks thrown up under gravity (with shadows, one bounce), a dust cloud,
 *     and the portrait jolted UP then down. THIS is the beat the consequence lands on. Tier IV adds a pillar of magma
 *     and rock, follow-up explosions and a lingering glowing crater; the heaviest, longest rumble.
 *
 * TIERS are the shared, owner-approved thresholds (I 1-5, II 6-11, III 12-19, IV 20+). Small hits stay brisk (~1.9 s);
 * the top tier earns a ~4 s show. Reduced motion: no flight, cracks, shake or zoom; the numbers fade.
 *
 * Tuner convention (the Blast's): localStorage in DEV only, values clamped on write and on load; production always
 * plays DEFAULTS. The preview speed is how you are LOOKING and is never saved.
 */
import { clamp, hexToNum } from '../heroAttack/easing';
import {
  HERO_ATTACK_TIER_THRESHOLDS, TIERS, reducedAttackTimeline, tierOf, type TierNum,
} from '../heroAttack/tiers';

export { TIERS, hexToNum, type TierNum };

/** The per-tier dials. A config key is `t1..t4` + one of these. */
export const QUAKE_TIER_SUFFIXES = [
  'LiftMs', 'LiftPx', 'TravelMs', 'CrackWidth', 'Branches', 'Fissures', 'Magma', 'Bursts', 'BoardCracks',
  'Rocks', 'Dust', 'Eruption', 'Pillar', 'Crater',
  'Rumble', 'Shake', 'Zoom', 'Punch', 'RumbleTailMs', 'Booms', 'SettleMs', 'Dim',
  'Quake', 'Boulders', 'BoulderSize', 'FlightMs', 'ThrowGapMs', 'ArcLift', 'Spikes', 'SpikeHeight', 'Spray',
] as const;
export type QuakeTierSuffix = (typeof QUAKE_TIER_SUFFIXES)[number];
type TierKey = `t${TierNum}${QuakeTierSuffix}`;

interface GlobalConfig {
  // Tiers (the shared thresholds; DEV-tunable only)
  tier2At: number; tier3At: number; tier4At: number;
  // Wind-up and slam
  absorbMs: number;
  heroSwell: number;
  heroSquash: number;
  // Cracks
  crackSegPx: number;
  crackJag: number;
  crackOpenPx: number;
  branchLength: number;
  crackFadeMs: number;
  coolMs: number;
  // Eruption
  flashAlpha: number;
  rockSize: number;
  rockGravity: number;
  pillarHoldMs: number;
  craterMs: number;
  // Camera and portraits
  knockPx: number;
  squash: number;
  shakeMs: number;
  zoomOutMs: number;
  reducedFadeMs: number;
  // Colours
  colorCore: string;
  colorPlayer: string;
  colorFoe: string;
  colorChasm: string;
  colorLip: string;
  colorDust: string;
  colorRock: string;
  // Sound: a clip, a gain and a pitch per cue ('' = silent)
  sfxWindupClip: string; sfxWindupGain: number; sfxWindupRate: number;
  sfxGroundClip: string; sfxGroundGain: number; sfxGroundRate: number;
  sfxThumpClip: string; sfxThumpGain: number; sfxThumpRate: number;
  sfxCrackClip: string; sfxCrackGain: number; sfxCrackRate: number;
  sfxEruptClip: string; sfxEruptGain: number; sfxEruptRate: number;
  sfxBigClip: string; sfxBigGain: number; sfxBigRate: number;
  sfxBoomClip: string; sfxBoomGain: number; sfxBoomRate: number;
  sfxPatterClip: string; sfxPatterGain: number; sfxPatterRate: number;
  sfxThrowClip: string; sfxThrowGain: number; sfxThrowRate: number;
  sfxRumbleGain: number; sfxRumbleLowHz: number; sfxRumbleHighHz: number;
  sfxEruptLenMs: number;
  sfxBoomLenMs: number;
  sfxTailMix: number;
  sfxDuck: number;
  // Preview only (the tuner's Play buttons). Never read by a real fight, and left out of Copy JSON.
  previewDamage: number;
  previewParts: number;
}
export type HeroQuakeConfig = GlobalConfig & Record<TierKey, number>;

export const HERO_QUAKE_COLOR_KEYS = ['colorCore', 'colorPlayer', 'colorFoe', 'colorChasm', 'colorLip', 'colorDust', 'colorRock'] as const;
export const HERO_QUAKE_CLIP_KEYS = [
  'sfxWindupClip', 'sfxGroundClip', 'sfxThumpClip', 'sfxCrackClip', 'sfxEruptClip',
  'sfxBigClip', 'sfxBoomClip', 'sfxPatterClip', 'sfxThrowClip',
] as const;
type ColorKey = (typeof HERO_QUAKE_COLOR_KEYS)[number];
type ClipKey = (typeof HERO_QUAKE_CLIP_KEYS)[number];
export type HeroQuakeStrKey = ColorKey | ClipKey;
export type HeroQuakeNumKey = Exclude<keyof HeroQuakeConfig, HeroQuakeStrKey>;

/** Tier I .. IV per suffix: the escalation ladder. */
const TIER_DEFAULTS: Record<QuakeTierSuffix, [number, number, number, number]> = {
  LiftMs: [230, 270, 330, 380],
  LiftPx: [4, 6, 9, 12],
  TravelMs: [0, 0, 0, 280],
  CrackWidth: [8, 12, 17, 26],
  Branches: [0, 0, 0, 8],
  Fissures: [0, 0, 0, 3],
  Magma: [0.1, 0.3, 0.75, 1],
  Bursts: [0, 0, 0, 3],
  BoardCracks: [0, 0, 0, 4],
  Rocks: [4, 8, 14, 26],
  Dust: [0.7, 0.9, 1.1, 1.4],
  Eruption: [0.7, 0.9, 1.15, 1.5],
  Pillar: [0, 0, 0, 1],
  Crater: [0, 0, 0.5, 1],
  Rumble: [2, 4, 7, 11],
  Shake: [6, 10, 15, 22],
  Zoom: [0.012, 0.02, 0.032, 0.05],
  Punch: [0.015, 0.022, 0.032, 0.05],
  RumbleTailMs: [220, 380, 600, 900],
  Booms: [0, 0, 2, 4],
  SettleMs: [320, 420, 500, 520],
  Dim: [0, 0.15, 0.3, 0.45],
  // Owner 2026-09-28: "maybe only the huge hit should quake, and the others can be slightly different? i think the line
  // animation is over used". Tiers I-III HURL BOULDERS (no crack line); only IV is the earthquake.
  Quake: [0, 0, 0, 1],
  Boulders: [1, 2, 3, 0],
  BoulderSize: [1, 1.12, 1.28, 1],
  FlightMs: [460, 440, 420, 0],
  ThrowGapMs: [0, 150, 120, 0],
  ArcLift: [0.2, 0.22, 0.24, 0],
  Spikes: [4, 5, 6, 7],
  SpikeHeight: [1.2, 1.3, 1.4, 1.5],
  Spray: [10, 14, 22, 44],
};

export const QUAKE_TIER_RANGES: Record<QuakeTierSuffix, [number, number, number]> = {
  LiftMs: [60, 1500, 10],
  LiftPx: [0, 60, 1],
  TravelMs: [0, 1600, 10],
  CrackWidth: [2, 48, 0.5],
  Branches: [0, 14, 1],
  Fissures: [0, 5, 1],
  Magma: [0, 1, 0.01],
  Bursts: [0, 8, 1],
  BoardCracks: [0, 12, 1],
  Rocks: [0, 40, 1],
  Dust: [0, 2.5, 0.05],
  Eruption: [0.3, 2.5, 0.05],
  Pillar: [0, 1, 1],
  Crater: [0, 1, 0.01],
  Rumble: [0, 30, 0.5],
  Shake: [0, 40, 0.5],
  Zoom: [0, 0.14, 0.002],
  Punch: [0, 0.1, 0.001],
  RumbleTailMs: [0, 2500, 10],
  Booms: [0, 6, 1],
  SettleMs: [0, 1600, 10],
  Dim: [0, 0.8, 0.01],
  Quake: [0, 1, 1],
  Boulders: [0, 5, 1],
  BoulderSize: [0.4, 2.5, 0.05],
  FlightMs: [0, 1200, 10],
  ThrowGapMs: [0, 500, 10],
  ArcLift: [0, 0.8, 0.01],
  Spikes: [0, 12, 1],
  SpikeHeight: [0.3, 3, 0.05],
  Spray: [0, 80, 1],
};

const tierDefaults = Object.fromEntries(TIERS.flatMap((t) => QUAKE_TIER_SUFFIXES.map((s) => [`t${t}${s}`, TIER_DEFAULTS[s][t - 1]]))) as Record<TierKey, number>;

export const HERO_QUAKE_DEFAULTS: HeroQuakeConfig = {
  // The shared, owner-approved thresholds (6 / 12 / 20): the same blow steps Quake up exactly where it steps Blast up.
  ...HERO_ATTACK_TIER_THRESHOLDS,
  absorbMs: 190,
  heroSwell: 0.1,
  heroSquash: 0.14,
  crackSegPx: 34,
  crackJag: 0.6,
  crackOpenPx: 170,
  branchLength: 0.13,
  crackFadeMs: 420,
  coolMs: 900,
  flashAlpha: 0.9,
  rockSize: 1,
  rockGravity: 2600,
  pillarHoldMs: 380,
  craterMs: 1500,
  knockPx: 20,
  squash: 0.12,
  shakeMs: 360,
  zoomOutMs: 420,
  reducedFadeMs: 260,
  colorCore: '#fff2c4',
  colorPlayer: '#ff9a1f',
  colorFoe: '#ff3d2e',
  colorChasm: '#140904',
  colorLip: '#e2c294',
  colorDust: '#8f7a62',
  colorRock: '#9b8570',
  sfxWindupClip: 'windup', sfxWindupGain: 0.45, sfxWindupRate: 0.8,
  sfxGroundClip: 'fx/universfield-ground-impact-352053', sfxGroundGain: 0.95, sfxGroundRate: 0.92,
  sfxThumpClip: 'smack2', sfxThumpGain: 0.5, sfxThumpRate: 0.72,
  sfxCrackClip: 'rebornshatter', sfxCrackGain: 0.5, sfxCrackRate: 0.62,
  sfxEruptClip: 'fx/heavy-rock-impact', sfxEruptGain: 0.95, sfxEruptRate: 1,
  sfxBigClip: 'turnexplosion', sfxBigGain: 0.5, sfxBigRate: 0.8,
  sfxBoomClip: 'fx/triple-impact', sfxBoomGain: 0.32, sfxBoomRate: 0.9,
  sfxPatterClip: 'cardlanding', sfxPatterGain: 0.18, sfxPatterRate: 1.7,
  sfxThrowClip: 'woosh2', sfxThrowGain: 0.55, sfxThrowRate: 0.78,
  sfxRumbleGain: 0.55, sfxRumbleLowHz: 38, sfxRumbleHighHz: 190,
  sfxEruptLenMs: 1300,
  sfxBoomLenMs: 700,
  sfxTailMix: 0.12,
  sfxDuck: 0.5,
  previewDamage: 12,
  previewParts: 4,
  ...tierDefaults,
};

const GLOBAL_RANGES: Record<Exclude<keyof GlobalConfig, HeroQuakeStrKey>, [number, number, number]> = {
  tier2At: [2, 40, 1], tier3At: [2, 60, 1], tier4At: [2, 80, 1],
  absorbMs: [60, 600, 10],
  heroSwell: [0, 0.3, 0.01],
  heroSquash: [0, 0.4, 0.01],
  crackSegPx: [16, 120, 1],
  crackJag: [0, 1.2, 0.01],
  crackOpenPx: [0, 600, 5],
  branchLength: [0.03, 0.4, 0.01],
  crackFadeMs: [60, 1500, 10],
  coolMs: [100, 3000, 10],
  flashAlpha: [0, 1, 0.01],
  rockSize: [0.3, 2.5, 0.05],
  rockGravity: [600, 6000, 50],
  pillarHoldMs: [0, 1200, 10],
  craterMs: [200, 4000, 10],
  knockPx: [0, 60, 1],
  squash: [0, 0.3, 0.01],
  shakeMs: [0, 1200, 10],
  zoomOutMs: [60, 1500, 10],
  reducedFadeMs: [60, 1000, 10],
  sfxWindupGain: [0, 2, 0.05], sfxWindupRate: [0.5, 2, 0.01],
  sfxGroundGain: [0, 2, 0.05], sfxGroundRate: [0.5, 2, 0.01],
  sfxThumpGain: [0, 2, 0.05], sfxThumpRate: [0.5, 2, 0.01],
  sfxCrackGain: [0, 2, 0.05], sfxCrackRate: [0.5, 2, 0.01],
  sfxEruptGain: [0, 2, 0.05], sfxEruptRate: [0.5, 2, 0.01],
  sfxBigGain: [0, 2, 0.05], sfxBigRate: [0.5, 2, 0.01],
  sfxBoomGain: [0, 2, 0.05], sfxBoomRate: [0.5, 2, 0.01],
  sfxPatterGain: [0, 2, 0.05], sfxPatterRate: [0.5, 2.5, 0.01],
  sfxThrowGain: [0, 2, 0.05], sfxThrowRate: [0.5, 2, 0.01],
  sfxRumbleGain: [0, 2, 0.05], sfxRumbleLowHz: [20, 120, 1], sfxRumbleHighHz: [60, 600, 5],
  sfxEruptLenMs: [150, 3500, 10],
  sfxBoomLenMs: [100, 3000, 10],
  sfxTailMix: [0, 0.6, 0.01],
  sfxDuck: [0, 1, 0.05],
  previewDamage: [1, 60, 1],
  previewParts: [1, 8, 1],
};

/** [min, max, step] per numeric key. Values outside are clamped on write AND on load. */
export const HERO_QUAKE_RANGES: Record<HeroQuakeNumKey, [number, number, number]> = {
  ...GLOBAL_RANGES,
  ...(Object.fromEntries(TIERS.flatMap((t) => QUAKE_TIER_SUFFIXES.map((s) => [`t${t}${s}`, QUAKE_TIER_RANGES[s]]))) as Record<TierKey, [number, number, number]>),
};

/** The hard ceilings a plan can never exceed, whatever the sliders say (so a 40 stays clean, not cluttered). */
export const QUAKE_CAPS = {
  branches: 14, fissures: 5, bursts: 8, boardCracks: 12, rocks: 40, booms: 6, boulders: 5, spikes: 12, spray: 80, shakePx: 40, rumblePx: 30, zoom: 0.14,
} as const;

const HEX = /^#[0-9a-f]{6}$/i;
const isColorKey = (k: string): k is ColorKey => (HERO_QUAKE_COLOR_KEYS as readonly string[]).includes(k);
const isClipKey = (k: string): k is ClipKey => (HERO_QUAKE_CLIP_KEYS as readonly string[]).includes(k);

/** One value, made safe: numbers clamped into range (junk = the default), colours #rrggbb, clips a short string. */
export function clampHeroQuakeValue<K extends keyof HeroQuakeConfig>(key: K, value: unknown): HeroQuakeConfig[K] | undefined {
  if (!Object.prototype.hasOwnProperty.call(HERO_QUAKE_DEFAULTS, key)) return undefined;
  const def = HERO_QUAKE_DEFAULTS[key];
  if (isColorKey(key)) {
    if (typeof value !== 'string') return def;
    const v = value.trim();
    return (HEX.test(v) ? v.toLowerCase() : def) as HeroQuakeConfig[K];
  }
  if (isClipKey(key)) return (typeof value === 'string' ? value.trim().slice(0, 160) : def) as HeroQuakeConfig[K];
  const n = typeof value === 'number' ? value : Number(value);
  if (typeof value === 'boolean' || value === null || value === '' || !Number.isFinite(n)) return def;
  const [min, max] = HERO_QUAKE_RANGES[key as HeroQuakeNumKey];
  return Math.min(max, Math.max(min, n)) as HeroQuakeConfig[K];
}

/** A whole saved object, sanitised key by key over the defaults (junk and unknown keys dropped). */
export function sanitizeHeroQuakeConfig(saved: unknown): HeroQuakeConfig {
  const out: HeroQuakeConfig = { ...HERO_QUAKE_DEFAULTS };
  if (!saved || typeof saved !== 'object') return out;
  for (const [k, v] of Object.entries(saved as Record<string, unknown>)) {
    const safe = clampHeroQuakeValue(k as keyof HeroQuakeConfig, v);
    if (safe !== undefined) (out as unknown as Record<string, unknown>)[k] = safe;
  }
  return out;
}

const KEY = 'ascent.heroquake.v1';

let cfg: HeroQuakeConfig = (() => {
  if (!import.meta.env.DEV || typeof localStorage === 'undefined') return { ...HERO_QUAKE_DEFAULTS };
  try { return sanitizeHeroQuakeConfig(JSON.parse(localStorage.getItem(KEY) ?? '{}')); } catch { return { ...HERO_QUAKE_DEFAULTS }; }
})();

export function getHeroQuakeConfig(): HeroQuakeConfig { return cfg; }

export function setHeroQuakeValue(key: keyof HeroQuakeConfig, value: number | string): void {
  const safe = clampHeroQuakeValue(key, value);
  if (safe === undefined) return;
  cfg = { ...cfg, [key]: safe };
  if (!import.meta.env.DEV) return;
  try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch { /* ignore */ }
}

export function resetHeroQuakeConfig(): void {
  cfg = { ...HERO_QUAKE_DEFAULTS };
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}

/** The tuned values as JSON for pasting back into DEFAULTS (the preview-only keys left out). */
export function heroQuakeConfigJson(c: HeroQuakeConfig = cfg): string {
  const ship: Partial<HeroQuakeConfig> = { ...c };
  delete ship.previewDamage;
  delete ship.previewParts;
  return JSON.stringify(ship, null, 2);
}

// ─── the preview speed (DEV only, never saved) ─────────────────────────────────────────────────────────────────

export const HERO_QUAKE_SPEEDS = [1, 0.5, 0.25] as const;
export type HeroQuakeSpeed = (typeof HERO_QUAKE_SPEEDS)[number];
let speed: HeroQuakeSpeed = 1;
/** The tuner's slow motion. Always 1 in production. */
export function heroQuakePreviewSpeed(): HeroQuakeSpeed { return import.meta.env.DEV ? speed : 1; }
export function setHeroQuakePreviewSpeed(s: HeroQuakeSpeed): void { speed = s; }

// ─── the pure plan ─────────────────────────────────────────────────────────────────────────────────────────────

/** One tier's dials, read out of the config. */
export function quakeTierDials(tier: TierNum, c: HeroQuakeConfig = cfg): Record<QuakeTierSuffix, number> {
  return Object.fromEntries(QUAKE_TIER_SUFFIXES.map((s) => [s, c[`t${tier}${s}`]])) as Record<QuakeTierSuffix, number>;
}

/** The crack front's progress curve: it leaves the slam with pace and still ACCELERATES into the target. */
export const quakeEase = (u: number): number => { const t = Math.min(1, Math.max(0, Number.isFinite(u) ? u : 0)); return 0.45 * t + 0.55 * t * t; };
/** Its inverse: when (0..1 of the travel) the front reaches `f` (0..1 of the path). */
export function quakeEaseInv(f: number): number {
  const x = Math.min(1, Math.max(0, f));
  return (-0.45 + Math.sqrt(0.45 * 0.45 + 4 * 0.55 * x)) / (2 * 0.55);
}

/** The reference distance the per-tier travel times are tuned at (a 1080p board, corner to corner). */
export const QUAKE_REF_DISTANCE = 1600;

/** Crack travel for a distance: the tier's time, scaled gently by the distance (a sandbox box stays readable). */
export function quakeTravelMs(distance: number, tierMs: number): number {
  if (!(tierMs > 0)) return 0;
  const d = Number.isFinite(distance) && distance > 0 ? distance : QUAKE_REF_DISTANCE;
  return Math.round(tierMs * clamp(Math.sqrt(d / QUAKE_REF_DISTANCE), 0.6, 1.2));
}

export interface QuakePlanInput {
  /** When the style's own attack starts: the end of the shared damage formation (`formationPlan().endAt`). */
  leadIn?: number;
  /** THE blow, as the engine decided it. */
  total: number;
  /** Screen px between the attacker's and the defender's centres. */
  distance: number;
  reduced?: boolean;
}

export interface QuakePlan {
  reduced: boolean;
  tier: TierNum;
  /** 0..1 across the tiers (I = 0, IV = 1). */
  k: number;
  total: number;
  /** The wind-up starts: the total dives into the hero, who rises. */
  chargeAt: number;
  absorbEnd: number;
  /** The hero hits the ground. The quake starts. */
  slamAt: number;
  /** Tier IV (or any tier the tuner switches to it): a true EARTHQUAKE, the crack racing to the target. Otherwise the
   *  hero hurls boulders (no crack line). */
  quake: boolean;
  /** The boulders: when each leaves the hero and when it lands (the last one IS the impact). Empty for a quake. */
  throws: number[];
  lands: number[];
  /** When the camera starts following the blow to the target (the slam for a quake, the last throw otherwise). */
  travelAt: number;
  /** How long the crack takes from the slam to the target (a quake), or the last boulder's flight. */
  travelMs: number;
  /** Secondary eruptions along the path (sequence ms), and where on the path (0..1) each goes off. */
  bursts: number[];
  burstFracs: number[];
  /** THE consequence beat: the ground erupts under the target. */
  impactAt: number;
  /** Follow-up explosions around the target. */
  booms: number[];
  /** Tier IV's pillar of magma and rock. */
  pillar: boolean;
  /** The cracks start fading. */
  fadeAt: number;
  endAt: number;
  // magnitudes
  liftPx: number;
  rumblePx: number;
  rumbleTailMs: number;
  shakePx: number;
  zoom: number;
  punch: number;
  dim: number;
  crackWidth: number;
  branches: number;
  fissures: number;
  magma: number;
  boardCracks: number;
  rocks: number;
  dust: number;
  eruption: number;
  crater: number;
  boulderSize: number;
  arcLift: number;
  spikes: number;
  spikeHeight: number;
  spray: number;
}

/** The whole Quake, in base ms (divide by the playback speed for real time). Pure and deterministic. */
export function quakePlan(input: QuakePlanInput, c: HeroQuakeConfig = cfg): QuakePlan {
  const total = Math.max(0, Math.round(input.total));
  const tier = tierOf(total, c);
  const T = quakeTierDials(tier, c);
  const k = (tier - 1) / 3;
  const zeroes = {
    liftPx: 0, rumblePx: 0, rumbleTailMs: 0, shakePx: 0, zoom: 0, punch: 0, dim: 0, crackWidth: 0, branches: 0, fissures: 0,
    magma: 0, boardCracks: 0, rocks: 0, dust: 0, eruption: 0, crater: 0, boulderSize: 0, arcLift: 0, spikes: 0, spikeHeight: 0, spray: 0,
  };

  if (input.reduced) {
    const r = reducedAttackTimeline(input.leadIn ?? 0, c.reducedFadeMs);
    const { impactAt } = r;
    return {
      reduced: true, tier, k, total,
      chargeAt: impactAt, absorbEnd: impactAt, slamAt: impactAt, quake: false, throws: [], lands: [], travelAt: impactAt,
      travelMs: 0, bursts: [], burstFracs: [], impactAt,
      booms: [], pillar: false, fadeAt: r.endAt, endAt: r.endAt, ...zeroes,
    };
  }

  // The shared damage formation plays first; the style's own attack starts when it ends.
  const chargeAt = Math.max(0, input.leadIn ?? 0);
  const absorbEnd = chargeAt + c.absorbMs;
  const slamAt = chargeAt + Math.max(T.LiftMs, c.absorbMs);
  const quake = T.Quake >= 1 || !(T.Boulders >= 1);
  // A quake: the crack runs from the slam to the target. Boulders: each is ripped out of the ground and hurled; the
  // last lands on the target (the impact), the earlier ones land first as ticks (FX only).
  const nThrows = quake ? 0 : clamp(Math.round(T.Boulders), 1, QUAKE_CAPS.boulders);
  const flight = quake ? 0 : quakeTravelMs(input.distance, Math.max(120, T.FlightMs));
  const throws = Array.from({ length: nThrows }, (_, i) => Math.round(slamAt + i * T.ThrowGapMs));
  // Trailing boulders fly a touch faster, so the volley bunches into the target.
  const lands = throws.map((at, i) => Math.round(at + flight * (1 - 0.06 * (nThrows - 1 - i))));
  const travelMs = quake ? quakeTravelMs(input.distance, Math.max(120, T.TravelMs)) : flight;
  const impactAt = quake ? slamAt + travelMs : Math.max(...lands);
  const travelAt = quake ? slamAt : impactAt - travelMs;
  const nBursts = quake ? clamp(Math.round(T.Bursts), 0, QUAKE_CAPS.bursts) : 0;
  // Secondary eruptions spread through the middle of the path, each where the front passes it.
  const burstFracs = Array.from({ length: nBursts }, (_, i) => 0.2 + 0.66 * ((i + 0.5) / nBursts));
  const bursts = burstFracs.map((f) => Math.round(slamAt + travelMs * quakeEaseInv(f)));
  const nBooms = clamp(Math.round(T.Booms), 0, QUAKE_CAPS.booms);
  const booms = Array.from({ length: nBooms }, (_, i) => impactAt + 140 + i * 110);
  const pillar = T.Pillar >= 1;
  const lastBeat = Math.max(
    impactAt + 200,
    booms.length ? booms[booms.length - 1]! + 120 : 0,
    pillar ? impactAt + c.pillarHoldMs + 250 : 0,
    impactAt + c.zoomOutMs * 0.8,
    impactAt + T.RumbleTailMs * 0.7,
  );
  const endAt = lastBeat + T.SettleMs;
  const fadeAt = Math.max(impactAt + 120, endAt - c.crackFadeMs);

  return {
    reduced: false, tier, k, total, chargeAt, absorbEnd, slamAt, quake, throws, lands, travelAt,
    travelMs, bursts, burstFracs, impactAt,
    booms, pillar, fadeAt, endAt,
    liftPx: T.LiftPx,
    rumblePx: clamp(T.Rumble, 0, QUAKE_CAPS.rumblePx),
    rumbleTailMs: T.RumbleTailMs,
    shakePx: clamp(T.Shake, 0, QUAKE_CAPS.shakePx),
    zoom: clamp(T.Zoom, 0, QUAKE_CAPS.zoom),
    punch: T.Punch,
    dim: T.Dim,
    crackWidth: T.CrackWidth,
    branches: clamp(Math.round(T.Branches), 0, QUAKE_CAPS.branches),
    fissures: clamp(Math.round(T.Fissures), 0, QUAKE_CAPS.fissures),
    magma: clamp(T.Magma, 0, 1),
    boardCracks: clamp(Math.round(T.BoardCracks), 0, QUAKE_CAPS.boardCracks),
    rocks: clamp(Math.round(T.Rocks), 0, QUAKE_CAPS.rocks),
    dust: T.Dust,
    eruption: T.Eruption,
    crater: clamp(T.Crater, 0, 1),
    boulderSize: T.BoulderSize,
    arcLift: T.ArcLift,
    spikes: clamp(Math.round(T.Spikes), 0, QUAKE_CAPS.spikes),
    spikeHeight: T.SpikeHeight,
    spray: clamp(Math.round(T.Spray), 0, QUAKE_CAPS.spray),
  };
}

export type QuakeCueKind = 'charge' | 'slam' | 'throw' | 'burst' | 'land' | 'impact' | 'boom' | 'fade' | 'end';
export interface QuakeCue { at: number; kind: QuakeCueKind; i: number }

/** Every beat the runner fires, in time order (ties keep this declaration order, so impact precedes end). */
export function quakeCues(p: QuakePlan): QuakeCue[] {
  const out: QuakeCue[] = [];
  if (!p.reduced) {
    out.push({ at: p.chargeAt, kind: 'charge', i: 0 });
    out.push({ at: p.slamAt, kind: 'slam', i: 0 });
    p.bursts.forEach((at, i) => out.push({ at, kind: 'burst', i }));
    p.throws.forEach((at, i) => out.push({ at, kind: 'throw', i }));
    // Every boulder but the last lands as a tick (the last one IS the impact).
    p.lands.slice(0, -1).forEach((at, i) => out.push({ at, kind: 'land', i }));
  }
  out.push({ at: p.impactAt, kind: 'impact', i: 0 });
  p.booms.forEach((at, i) => out.push({ at, kind: 'boom', i }));
  if (!p.reduced) out.push({ at: p.fadeAt, kind: 'fade', i: 0 });
  out.push({ at: p.endAt, kind: 'end', i: 0 });
  const order: Record<QuakeCueKind, number> = { charge: 4, slam: 5, throw: 6, burst: 7, land: 8, impact: 9, boom: 10, fade: 11, end: 12 };
  return out.map((q, idx) => ({ q, idx })).sort((a, b) => a.q.at - b.q.at || order[a.q.kind] - order[b.q.kind] || a.idx - b.idx).map((x) => x.q);
}

// ─── the camera (pure) ─────────────────────────────────────────────────────────────────────────────────────────

const springAt = (ms: number, hz: number, tau: number): number => (ms < 0 ? 0 : Math.exp(-ms / tau) * Math.cos(2 * Math.PI * hz * (ms / 1000)));
const sine01 = (t: number): number => 0.5 - 0.5 * Math.cos(Math.PI * Math.min(1, Math.max(0, t)));

/**
 * The camera at sequence time `t` (px in the space the points are in). Unlike the Blast's directional jolt, the Quake
 * RUMBLES: mostly vertical, low (8 to 21 Hz), deterministic (sums of sines, so a replay shakes identically). A slight
 * push in on the hero through the wind-up; a hard DOWNWARD kick on the slam; a rumble that builds from a tremor to a
 * roar as the crack travels; the impact jolts the view UP (the ground erupting under the target), punches in and rings
 * out through a long rumble tail (longest at Tier IV); each burst and boom adds a vertical kick. At `t === impactAt`
 * the frame is already displaced upward. Pure, so it is tested directly.
 */
export function quakeCameraAt(p: QuakePlan, c: HeroQuakeConfig, t: number): { zoom: number; x: number; y: number } {
  if (p.reduced) return { zoom: 1, x: 0, y: 0 };
  let z = 0;
  if (t >= p.chargeAt && t < p.impactAt) {
    z += p.zoom * sine01((t - p.chargeAt) / Math.max(1, p.slamAt - p.chargeAt));
    if (t >= p.travelAt) z += p.zoom * 0.35 * sine01((t - p.travelAt) / Math.max(1, p.travelMs)); // the blow builds
  } else if (t >= p.impactAt) {
    const since = t - p.impactAt;
    z += (p.zoom * 1.35 + p.punch) * Math.exp(-since / Math.max(1, c.zoomOutMs / 4));
  }
  let x = 0, y = 0;
  // Wind-up: a faint tremor growing under the rising hero.
  if (t >= p.chargeAt && t < p.slamAt) {
    const u = (t - p.chargeAt) / Math.max(1, p.slamAt - p.chargeAt);
    const a = p.rumblePx * 0.3 * u * u;
    y += a * Math.sin(t * 0.11);
    x += a * 0.3 * Math.sin(t * 0.093 + 1.1);
  }
  // The slam: a hard kick DOWN, springing back.
  const slamAge = t - p.slamAt;
  if (slamAge >= 0) {
    y += p.shakePx * 0.55 * springAt(slamAge, 11, Math.max(1, c.shakeMs / 5));
    x += p.shakePx * 0.08 * Math.sin(slamAge * 0.12) * Math.exp(-slamAge / 60);
  }
  // Travel: the rumble builds as the crack runs (a tremor into a roar).
  if (p.quake && t >= p.slamAt && t < p.impactAt) {
    const age = t - p.slamAt;
    const u = age / Math.max(1, p.travelMs);
    const a = p.rumblePx * (0.35 + 0.65 * Math.pow(u, 1.5));
    y += a * (0.7 * Math.sin(age * 0.083) + 0.3 * Math.sin(age * 0.131 + 1));
    x += a * 0.3 * Math.sin(age * 0.107 + 0.5);
  }
  // The impact: jolted UP (the ground erupts under the target), then a long rumble tail.
  const hitAge = t - p.impactAt;
  if (hitAge >= 0) {
    y += -p.shakePx * springAt(hitAge, 13, Math.max(1, c.shakeMs / 4));
    x += p.shakePx * 0.12 * Math.sin(hitAge * 0.1) * Math.exp(-hitAge / Math.max(1, c.shakeMs / 4));
    const tail = p.rumblePx * 1.1 * Math.exp(-hitAge / Math.max(1, p.rumbleTailMs / 3));
    y += tail * (0.7 * Math.sin(hitAge * 0.077 + 0.4) + 0.3 * Math.sin(hitAge * 0.121));
    x += tail * 0.3 * Math.sin(hitAge * 0.101 + 2);
  }
  const kick = (at: number, amp: number): void => {
    const age = t - at;
    if (age < 0) return;
    y += amp * springAt(age, 14, 45);
  };
  p.bursts.forEach((at) => kick(at, p.shakePx * 0.25));
  p.lands.slice(0, -1).forEach((at) => kick(at, -p.shakePx * 0.3));
  p.booms.forEach((at) => kick(at, -p.shakePx * 0.3));
  return { zoom: 1 + Math.max(0, z), x, y };
}

/**
 * Where the camera anchors: the ATTACKER through the wind-up and the slam, riding the crack front while it travels,
 * and the DEFENDER from the impact on (a zoom anchored on a point keeps that point still). Pure.
 */
export function quakeCameraFocus(p: QuakePlan, t: number, a: { x: number; y: number }, d: { x: number; y: number }): { x: number; y: number } {
  if (t <= p.travelAt) return a;
  if (t >= p.impactAt) return d;
  const e = quakeEase((t - p.travelAt) / Math.max(1, p.travelMs));
  return { x: a.x + (d.x - a.x) * e, y: a.y + (d.y - a.y) * e };
}
