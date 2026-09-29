/**
 * THE BLEED HERO ATTACK ("Hemorrhage"): its tuned values, its pure timeline, the pure slash geometry and the pure camera.
 *
 * Owner 2026-09-29: "branch off and make some more attack types - we need a fire animation, a bleed/gash animation ...
 * use the same 4 tier strategy we have been." This is the bleed / gash one.
 *
 * THE BEATS (base ms before the playback speed):
 *  1. THE DAMAGE FORMATION (shared by every style, `../heroAttack/damageFormation.ts`): minion tiers pulse left to
 *     right and merge, the hero tier joins, the full blow, the cap. Its end is this style's start.
 *  2. READY. The total sinks into the hero, who draws back and turns a little (a blade drawn): a crimson glint gathers
 *     at the striking edge of the portrait and a thin crescent turns there.
 *  3. SWING. Each slash is a swing at the hero's rim (a swish arc) that looses a crimson CRESCENT, a flying cut, on a
 *     flat, slightly rising line. As it reaches the target it turns to the cut's angle and carries straight on THROUGH
 *     the portrait: the cut DRAWS across the face behind it (a white-hot seam with a crimson bloom), blood sprays along
 *     the blade's direction as it goes, and the line OPENS into a gash (a dark wound with a bright red lip).
 *  4. THE CUTS. Every slash before the last is a TICK (FX and sound only). The LAST is THE impact: the big `-N`, the
 *     biggest spray, the flash, the knockback. The consequence (the damage, Armor, Resolve) lands ONCE, there. A beat
 *     later the wounds BLEED (drips run down the portrait, a crimson pulse over the face) and then they close.
 *     I one clean diagonal gash; II a cross (X) of two; III a flurry of four fast slashes and a three-claw rake.
 *  IV. HEMORRHAGE. Three claw rakes carve the face (all ticks). The wounds THROB with a heartbeat (two beats: they flare,
 *     a crimson pulse, a ring pulled in, the view breathes in), while the striking hero winds a huge crescent. Then a
 *     MEGA-SLASH splits the screen: one crescent sweeps corner to corner through the target, leaving a white seam with
 *     a dark split beside it. As it crosses the target the wounds RIP open and the target erupts in a BLOOD NOVA: a
 *     crimson shockwave, blood thrown out in arcs that fall, spatter landing round the portrait, a stain that drips,
 *     and two arterial spurts after.
 *
 * TIERS are the shared, owner-approved thresholds (I 1-5, II 6-11, III 12-19, IV 20+). No hit-stop anywhere (owner
 * 2026-09-28: "it looks like lag"). Flat 2D throughout. Reduced motion: no flight, cuts, shake or zoom; the numbers
 * fade and the blow lands.
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
export const BLEED_TIER_SUFFIXES = [
  'ChargeMs', 'Slashes', 'StaggerMs', 'FlightMs', 'SlashLength', 'Claws', 'Hemorrhage',
  'Shake', 'Zoom', 'Punch', 'Drops', 'Burst', 'Drips', 'SettleMs', 'Dim',
] as const;
export type BleedTierSuffix = (typeof BLEED_TIER_SUFFIXES)[number];
type TierKey = `t${TierNum}${BleedTierSuffix}`;

interface GlobalConfig {
  // Tiers (the shared thresholds; DEV-tunable only)
  tier2At: number; tier3At: number; tier4At: number;
  // Ready and swing
  absorbMs: number;
  heroCoilPx: number;
  heroSwingPx: number;
  heroSwingDeg: number;
  // The flying crescent
  waveSize: number;
  waveGlow: number;
  afterimages: number;
  afterMs: number;
  waveLift: number;
  // The cut
  drawMs: number;
  seamWidth: number;
  gashWidth: number;
  clawGap: number;
  spray: number;
  tickDrops: number;
  tintAlpha: number;
  bleedMs: number;
  holdMs: number;
  dripMs: number;
  // Hemorrhage (Tier IV)
  beats: number;
  beatMs: number;
  windupMs: number;
  megaMs: number;
  megaWidth: number;
  megaSize: number;
  novaSize: number;
  stainAlpha: number;
  stainMs: number;
  spatter: number;
  dropGravity: number;
  flashAlpha: number;
  // Camera and portraits
  knockPx: number;
  squash: number;
  shakeMs: number;
  zoomOutMs: number;
  reducedFadeMs: number;
  // Colours
  colorCore: string;
  colorBright: string;
  colorBlood: string;
  colorDeep: string;
  colorPlayer: string;
  colorFoe: string;
  // Sound: a clip, a gain and a pitch per cue ('' = silent)
  sfxReadyClip: string; sfxReadyGain: number; sfxReadyRate: number;
  sfxSwingClip: string; sfxSwingGain: number; sfxSwingRate: number;
  sfxShingClip: string; sfxShingGain: number; sfxShingRate: number;
  sfxSliceClip: string; sfxSliceGain: number; sfxSliceRate: number;
  sfxFleshClip: string; sfxFleshGain: number; sfxFleshRate: number;
  sfxSplatClip: string; sfxSplatGain: number; sfxSplatRate: number;
  sfxImpactClip: string; sfxImpactGain: number; sfxImpactRate: number;
  sfxBigClip: string; sfxBigGain: number; sfxBigRate: number;
  sfxBeatClip: string; sfxBeatGain: number; sfxBeatRate: number;
  sfxWindClip: string; sfxWindGain: number; sfxWindRate: number;
  sfxMegaClip: string; sfxMegaGain: number; sfxMegaRate: number;
  sfxGushClip: string; sfxGushGain: number; sfxGushRate: number;
  sfxSpurtClip: string; sfxSpurtGain: number; sfxSpurtRate: number;
  sfxSwingLenMs: number;
  sfxImpactLenMs: number;
  sfxTailMix: number;
  sfxDuck: number;
  // Preview only (the tuner's Play buttons). Never read by a real fight, and left out of Copy JSON.
  previewDamage: number;
  previewParts: number;
}
export type HeroBleedConfig = GlobalConfig & Record<TierKey, number>;

export const HERO_BLEED_COLOR_KEYS = ['colorCore', 'colorBright', 'colorBlood', 'colorDeep', 'colorPlayer', 'colorFoe'] as const;
export const HERO_BLEED_CLIP_KEYS = [
  'sfxReadyClip', 'sfxSwingClip', 'sfxShingClip', 'sfxSliceClip', 'sfxFleshClip', 'sfxSplatClip', 'sfxImpactClip',
  'sfxBigClip', 'sfxBeatClip', 'sfxWindClip', 'sfxMegaClip', 'sfxGushClip', 'sfxSpurtClip',
] as const;
type ColorKey = (typeof HERO_BLEED_COLOR_KEYS)[number];
type ClipKey = (typeof HERO_BLEED_CLIP_KEYS)[number];
export type HeroBleedStrKey = ColorKey | ClipKey;
export type HeroBleedNumKey = Exclude<keyof HeroBleedConfig, HeroBleedStrKey>;

/** Tier I .. IV per suffix: the escalation ladder. */
const TIER_DEFAULTS: Record<BleedTierSuffix, [number, number, number, number]> = {
  ChargeMs: [300, 340, 380, 420],
  Slashes: [1, 2, 5, 3],
  StaggerMs: [0, 190, 95, 130],
  FlightMs: [230, 230, 210, 220],
  SlashLength: [1.5, 1.45, 1.2, 1.3],
  Claws: [1, 1, 3, 3],
  Hemorrhage: [0, 0, 0, 1],
  Shake: [4, 6, 9, 16],
  Zoom: [0.02, 0.03, 0.04, 0.065],
  Punch: [0.015, 0.022, 0.03, 0.05],
  Drops: [14, 18, 26, 48],
  Burst: [1, 1.1, 1.3, 1.8],
  Drips: [2, 3, 5, 7],
  SettleMs: [240, 280, 320, 320],
  Dim: [0, 0.16, 0.28, 0.45],
};

export const BLEED_TIER_RANGES: Record<BleedTierSuffix, [number, number, number]> = {
  ChargeMs: [60, 1500, 10],
  Slashes: [1, 8, 1],
  StaggerMs: [0, 400, 5],
  FlightMs: [100, 1000, 10],
  SlashLength: [0.4, 2.2, 0.05],
  Claws: [1, 4, 1],
  Hemorrhage: [0, 1, 1],
  Shake: [0, 40, 0.5],
  Zoom: [0, 0.14, 0.002],
  Punch: [0, 0.1, 0.001],
  Drops: [0, 80, 1],
  Burst: [0.3, 3, 0.05],
  Drips: [0, 12, 1],
  SettleMs: [0, 1600, 10],
  Dim: [0, 0.8, 0.01],
};

const tierDefaults = Object.fromEntries(TIERS.flatMap((t) => BLEED_TIER_SUFFIXES.map((s) => [`t${t}${s}`, TIER_DEFAULTS[s][t - 1]]))) as Record<TierKey, number>;

export const HERO_BLEED_DEFAULTS: HeroBleedConfig = {
  // The shared, owner-approved thresholds (6 / 12 / 20): the same blow steps Bleed up exactly where it steps Blast up.
  ...HERO_ATTACK_TIER_THRESHOLDS,
  absorbMs: 190,
  heroCoilPx: 10,
  heroSwingPx: 16,
  heroSwingDeg: 5,
  waveSize: 1,
  waveGlow: 0.75,
  afterimages: 3,
  afterMs: 22,
  waveLift: 0.05,
  drawMs: 80,
  seamWidth: 9,
  gashWidth: 15,
  clawGap: 0.2,
  spray: 10,
  tickDrops: 8,
  tintAlpha: 0.3,
  bleedMs: 220,
  holdMs: 560,
  dripMs: 900,
  beats: 2,
  beatMs: 300,
  windupMs: 380,
  megaMs: 260,
  megaWidth: 22,
  megaSize: 2.4,
  novaSize: 1,
  stainAlpha: 0.7,
  stainMs: 1300,
  spatter: 9,
  dropGravity: 1300,
  flashAlpha: 0.85,
  knockPx: 16,
  squash: 0.08,
  shakeMs: 320,
  zoomOutMs: 380,
  reducedFadeMs: 260,
  colorCore: '#fff1ec',
  colorBright: '#ff2d3c',
  colorBlood: '#b3001b',
  colorDeep: '#3d0009',
  colorPlayer: '#ff4757',
  colorFoe: '#b0154a',
  sfxReadyClip: 'fx/metal-woosh', sfxReadyGain: 0.3, sfxReadyRate: 0.8,
  sfxSwingClip: 'fx/stereogenicstudio-swish-swoosh-woosh-sfx-27-357164-3', sfxSwingGain: 0.55, sfxSwingRate: 1.45,
  sfxShingClip: 'fx/universfield-whip-snap-242215', sfxShingGain: 0.28, sfxShingRate: 1.5,
  sfxSliceClip: 'cleave2', sfxSliceGain: 0.5, sfxSliceRate: 1.15,
  sfxFleshClip: 'smack1', sfxFleshGain: 0.3, sfxFleshRate: 1,
  sfxSplatClip: 'fx/oona-splat', sfxSplatGain: 0.38, sfxSplatRate: 1.1,
  sfxImpactClip: 'flurryhit', sfxImpactGain: 0.55, sfxImpactRate: 0.95,
  sfxBigClip: 'crit', sfxBigGain: 0.35, sfxBigRate: 1,
  sfxBeatClip: 'smack2', sfxBeatGain: 0.55, sfxBeatRate: 0.55,
  sfxWindClip: 'windup', sfxWindGain: 0.5, sfxWindRate: 1.1,
  sfxMegaClip: 'fx/universfield-cinematic-swoosh-impact-454392', sfxMegaGain: 0.6, sfxMegaRate: 1.05,
  sfxGushClip: 'bloodpot', sfxGushGain: 0.7, sfxGushRate: 0.85,
  sfxSpurtClip: 'fx/oona-splat', sfxSpurtGain: 0.3, sfxSpurtRate: 1.35,
  sfxSwingLenMs: 300,
  sfxImpactLenMs: 900,
  sfxTailMix: 0.12,
  sfxDuck: 0.5,
  previewDamage: 12,
  previewParts: 4,
  ...tierDefaults,
};

const GLOBAL_RANGES: Record<Exclude<keyof GlobalConfig, HeroBleedStrKey>, [number, number, number]> = {
  tier2At: [2, 40, 1], tier3At: [2, 60, 1], tier4At: [2, 80, 1],
  absorbMs: [60, 600, 10],
  heroCoilPx: [0, 40, 1],
  heroSwingPx: [0, 50, 1],
  heroSwingDeg: [0, 20, 0.5],
  waveSize: [0.3, 2.5, 0.05],
  waveGlow: [0, 1.5, 0.05],
  afterimages: [0, 5, 1],
  afterMs: [5, 60, 1],
  waveLift: [0, 0.3, 0.01],
  drawMs: [20, 300, 5],
  seamWidth: [1, 30, 0.5],
  gashWidth: [2, 40, 0.5],
  clawGap: [0.05, 0.5, 0.01],
  spray: [0, 30, 1],
  tickDrops: [0, 30, 1],
  tintAlpha: [0, 0.8, 0.01],
  bleedMs: [0, 1200, 10],
  holdMs: [100, 2000, 10],
  dripMs: [200, 2500, 10],
  beats: [1, 4, 1],
  beatMs: [120, 800, 10],
  windupMs: [100, 1200, 10],
  megaMs: [80, 900, 10],
  megaWidth: [4, 60, 1],
  megaSize: [0.5, 5, 0.05],
  novaSize: [0.3, 3, 0.05],
  stainAlpha: [0, 1, 0.01],
  stainMs: [200, 4000, 20],
  spatter: [0, 20, 1],
  dropGravity: [0, 3000, 20],
  flashAlpha: [0, 1, 0.01],
  knockPx: [0, 60, 1],
  squash: [0, 0.3, 0.01],
  shakeMs: [0, 1200, 10],
  zoomOutMs: [60, 1500, 10],
  reducedFadeMs: [60, 1000, 10],
  sfxReadyGain: [0, 2, 0.05], sfxReadyRate: [0.5, 2, 0.01],
  sfxSwingGain: [0, 2, 0.05], sfxSwingRate: [0.5, 2.5, 0.01],
  sfxShingGain: [0, 2, 0.05], sfxShingRate: [0.5, 2.5, 0.01],
  sfxSliceGain: [0, 2, 0.05], sfxSliceRate: [0.5, 2, 0.01],
  sfxFleshGain: [0, 2, 0.05], sfxFleshRate: [0.5, 2, 0.01],
  sfxSplatGain: [0, 2, 0.05], sfxSplatRate: [0.5, 2, 0.01],
  sfxImpactGain: [0, 2, 0.05], sfxImpactRate: [0.5, 2, 0.01],
  sfxBigGain: [0, 2, 0.05], sfxBigRate: [0.5, 2, 0.01],
  sfxBeatGain: [0, 2, 0.05], sfxBeatRate: [0.3, 2, 0.01],
  sfxWindGain: [0, 2, 0.05], sfxWindRate: [0.5, 2, 0.01],
  sfxMegaGain: [0, 2, 0.05], sfxMegaRate: [0.5, 2, 0.01],
  sfxGushGain: [0, 2, 0.05], sfxGushRate: [0.5, 2, 0.01],
  sfxSpurtGain: [0, 2, 0.05], sfxSpurtRate: [0.5, 2, 0.01],
  sfxSwingLenMs: [80, 1500, 10],
  sfxImpactLenMs: [150, 3500, 10],
  sfxTailMix: [0, 0.6, 0.01],
  sfxDuck: [0, 1, 0.05],
  previewDamage: [1, 60, 1],
  previewParts: [1, 8, 1],
};

/** [min, max, step] per numeric key. Values outside are clamped on write AND on load. */
export const HERO_BLEED_RANGES: Record<HeroBleedNumKey, [number, number, number]> = {
  ...GLOBAL_RANGES,
  ...(Object.fromEntries(TIERS.flatMap((t) => BLEED_TIER_SUFFIXES.map((s) => [`t${t}${s}`, BLEED_TIER_RANGES[s]]))) as Record<TierKey, [number, number, number]>),
};

/** The hard ceilings a plan can never exceed, whatever the sliders say (so a 40 stays clean, not cluttered). */
export const BLEED_CAPS = { slashes: 8, claws: 4, drops: 80, drips: 12, shakePx: 40, zoom: 0.14 } as const;

const HEX = /^#[0-9a-f]{6}$/i;
const isColorKey = (k: string): k is ColorKey => (HERO_BLEED_COLOR_KEYS as readonly string[]).includes(k);
const isClipKey = (k: string): k is ClipKey => (HERO_BLEED_CLIP_KEYS as readonly string[]).includes(k);

/** One value, made safe: numbers clamped into range (junk = the default), colours #rrggbb, clips a short string. */
export function clampHeroBleedValue<K extends keyof HeroBleedConfig>(key: K, value: unknown): HeroBleedConfig[K] | undefined {
  if (!Object.prototype.hasOwnProperty.call(HERO_BLEED_DEFAULTS, key)) return undefined;
  const def = HERO_BLEED_DEFAULTS[key];
  if (isColorKey(key)) {
    if (typeof value !== 'string') return def;
    const v = value.trim();
    return (HEX.test(v) ? v.toLowerCase() : def) as HeroBleedConfig[K];
  }
  if (isClipKey(key)) return (typeof value === 'string' ? value.trim().slice(0, 160) : def) as HeroBleedConfig[K];
  const n = typeof value === 'number' ? value : Number(value);
  if (typeof value === 'boolean' || value === null || value === '' || !Number.isFinite(n)) return def;
  const [min, max] = HERO_BLEED_RANGES[key as HeroBleedNumKey];
  return Math.min(max, Math.max(min, n)) as HeroBleedConfig[K];
}

/** A whole saved object, sanitised key by key over the defaults (junk and unknown keys dropped). */
export function sanitizeHeroBleedConfig(saved: unknown): HeroBleedConfig {
  const out: HeroBleedConfig = { ...HERO_BLEED_DEFAULTS };
  if (!saved || typeof saved !== 'object') return out;
  for (const [k, v] of Object.entries(saved as Record<string, unknown>)) {
    const safe = clampHeroBleedValue(k as keyof HeroBleedConfig, v);
    if (safe !== undefined) (out as unknown as Record<string, unknown>)[k] = safe;
  }
  return out;
}

const KEY = 'ascent.herobleed.v1';

let cfg: HeroBleedConfig = (() => {
  if (!import.meta.env.DEV || typeof localStorage === 'undefined') return { ...HERO_BLEED_DEFAULTS };
  try { return sanitizeHeroBleedConfig(JSON.parse(localStorage.getItem(KEY) ?? '{}')); } catch { return { ...HERO_BLEED_DEFAULTS }; }
})();

export function getHeroBleedConfig(): HeroBleedConfig { return cfg; }

export function setHeroBleedValue(key: keyof HeroBleedConfig, value: number | string): void {
  const safe = clampHeroBleedValue(key, value);
  if (safe === undefined) return;
  cfg = { ...cfg, [key]: safe };
  if (!import.meta.env.DEV) return;
  try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch { /* ignore */ }
}

export function resetHeroBleedConfig(): void {
  cfg = { ...HERO_BLEED_DEFAULTS };
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}

/** The tuned values as JSON for pasting back into DEFAULTS (the preview-only keys left out). */
export function heroBleedConfigJson(c: HeroBleedConfig = cfg): string {
  const ship: Partial<HeroBleedConfig> = { ...c };
  delete ship.previewDamage;
  delete ship.previewParts;
  return JSON.stringify(ship, null, 2);
}

// ─── the preview speed (DEV only, never saved) ─────────────────────────────────────────────────────────────────

export const HERO_BLEED_SPEEDS = [1, 0.5, 0.25] as const;
export type HeroBleedSpeed = (typeof HERO_BLEED_SPEEDS)[number];
let speed: HeroBleedSpeed = 1;
/** The tuner's slow motion. Always 1 in production. */
export function heroBleedPreviewSpeed(): HeroBleedSpeed { return import.meta.env.DEV ? speed : 1; }
export function setHeroBleedPreviewSpeed(s: HeroBleedSpeed): void { speed = s; }

// ─── the pure plan ─────────────────────────────────────────────────────────────────────────────────────────────

/** One tier's dials, read out of the config. */
export function bleedTierDials(tier: TierNum, c: HeroBleedConfig = cfg): Record<BleedTierSuffix, number> {
  return Object.fromEntries(BLEED_TIER_SUFFIXES.map((s) => [s, c[`t${tier}${s}`]])) as Record<BleedTierSuffix, number>;
}

/** The reference distance the per-tier flight times are tuned at (a 1080p board, corner to corner). */
export const BLEED_REF_DISTANCE = 1600;

/** Crescent flight for a distance: the tier's time, scaled gently by the distance (a sandbox box stays readable). */
export function bleedFlightMs(distance: number, tierMs: number): number {
  const d = Number.isFinite(distance) && distance > 0 ? distance : BLEED_REF_DISTANCE;
  return Math.round(tierMs * clamp(Math.sqrt(d / BLEED_REF_DISTANCE), 0.62, 1.15));
}

/**
 * The cut angles, in order, for an attacker on the LEFT (radians; 0 = a cut drawn left to right, positive = downward).
 * I is one clean diagonal (the first); II the cross (the first two, mirror images); a flurry keeps alternating
 * diagonals at varied steepness. Mirrored for an attacker on the right.
 */
export const CUT_ANGLES: readonly number[] = [0.62, Math.PI - 0.62, 0.22, Math.PI - 0.3, 0.98, Math.PI - 1.02, 0.45, Math.PI - 0.5];
/** III's last slash, the claw rake: steep, down and across. */
export const RAKE_ANGLE = 1.08;
/** Where each flurry cut sits on the face (portrait radii from its centre, attacker on the left). */
export const CUT_OFFSETS: readonly (readonly [number, number])[] = [
  [-0.16, -0.16], [0.18, -0.1], [-0.12, 0.2], [0.2, 0.16], [0, 0], [-0.2, 0.02], [0.12, 0.24], [0.04, -0.24],
];

export interface BleedSlashPlan {
  swingAt: number;
  flightMs: number;
  /** The crescent reaches the target and the cut starts to draw. A tick (or THE impact, for the last of I-III). */
  arriveAt: number;
  /** The cut's angle (attacker on the left; mirrored by the geometry). */
  angle: number;
  /** Parallel lines: 1 a clean slash, 3 a claw rake. */
  lines: number;
  /** The cut's length, in portrait radii. */
  len: number;
  /** Its centre on the face, in portrait radii (attacker on the left). */
  off: Pt;
}

export interface BleedPlanInput {
  /** When the style's own attack starts: the end of the shared damage formation (`formationPlan().endAt`). */
  leadIn?: number;
  /** THE blow, as the engine decided it. */
  total: number;
  /** Screen px between the attacker's and the defender's centres. */
  distance: number;
  reduced?: boolean;
}

export interface BleedPlan {
  reduced: boolean;
  tier: TierNum;
  /** 0..1 across the tiers (I = 0, IV = 1). */
  k: number;
  total: number;
  /** The ready starts: the total sinks into the hero, the blade is drawn. */
  chargeAt: number;
  absorbEnd: number;
  /** The first swing. */
  swingAt: number;
  slashes: BleedSlashPlan[];
  /** Tier IV: the heartbeat, the wind-up and the mega-slash. */
  hemorrhage: boolean;
  /** Tier IV: the heartbeats (empty below IV). */
  beats: number[];
  /** Tier IV: the striking hero winds the huge crescent (else the impact). */
  windAt: number;
  /** Tier IV: the mega-slash starts its sweep (else the impact). It crosses the target half-way, on the impact. */
  megaAt: number;
  /** Cuts that land BEFORE the impact, sequence ms: the rhythm ticks (Tier IV: every slash). */
  hits: number[];
  /** THE consequence beat: the last cut (I-III) or the mega-slash crossing the target (IV). */
  impactAt: number;
  /** The wounds bleed: drips run down the portrait (FX only). */
  bleedAt: number;
  /** I-III: the wounds close. */
  closeAt: number;
  /** Tier IV: arterial spurts after the nova. */
  booms: number[];
  endAt: number;
  shakePx: number;
  zoom: number;
  punch: number;
  drops: number;
  burst: number;
  drips: number;
  dim: number;
}

/** The whole Bleed attack, in base ms (divide by the playback speed for real time). Pure and deterministic. */
export function bleedPlan(input: BleedPlanInput, c: HeroBleedConfig = cfg): BleedPlan {
  const total = Math.max(0, Math.round(input.total));
  const tier = tierOf(total, c);
  const T = bleedTierDials(tier, c);
  const k = (tier - 1) / 3;

  if (input.reduced) {
    const r = reducedAttackTimeline(input.leadIn ?? 0, c.reducedFadeMs);
    const { impactAt } = r;
    return {
      reduced: true, tier, k, total,
      chargeAt: impactAt, absorbEnd: impactAt, swingAt: impactAt, slashes: [], hemorrhage: false, beats: [], windAt: impactAt, megaAt: impactAt,
      hits: [], impactAt, bleedAt: impactAt, closeAt: impactAt, booms: [], endAt: r.endAt,
      shakePx: 0, zoom: 0, punch: 0, drops: 0, burst: 0, drips: 0, dim: 0,
    };
  }

  // The shared damage formation plays first; the style's own attack starts when it ends.
  const chargeAt = Math.max(0, input.leadIn ?? 0);
  const absorbEnd = chargeAt + c.absorbMs;
  const swingAt = chargeAt + Math.max(T.ChargeMs, c.absorbMs);
  const hemorrhage = T.Hemorrhage >= 1;
  const count = clamp(Math.round(T.Slashes), 1, BLEED_CAPS.slashes);
  const claws = clamp(Math.round(T.Claws), 1, BLEED_CAPS.claws);
  const flight = bleedFlightMs(input.distance, T.FlightMs);
  const slashes: BleedSlashPlan[] = Array.from({ length: count }, (_, i) => {
    const last = i === count - 1;
    // The claws: every slash at IV (the rakes that carve the face), else only the last (III's finishing rake).
    const lines = hemorrhage || last ? claws : 1;
    const angle = !hemorrhage && last && lines > 1 && count > 2 ? RAKE_ANGLE : CUT_ANGLES[i % CUT_ANGLES.length]!;
    // One cut, or a cross, sits on the middle of the face; a flurry spreads over it.
    const o = count <= 2 ? [0, 0] as const : CUT_OFFSETS[i % CUT_OFFSETS.length]!;
    const at = swingAt + i * T.StaggerMs;
    return {
      swingAt: at, flightMs: flight, arriveAt: at + flight, angle, lines,
      len: T.SlashLength * (lines > 1 ? 0.92 : 1) * (count > 2 && !last ? 0.85 : 1), off: { x: o[0], y: o[1] },
    };
  });
  const lastIn = slashes[slashes.length - 1]!.arriveAt;
  const beatCount = hemorrhage ? clamp(Math.round(c.beats), 1, 4) : 0;
  const beats = Array.from({ length: beatCount }, (_, i) => lastIn + 150 + i * c.beatMs);
  const megaAt = hemorrhage ? Math.max(beats[beats.length - 1]! + c.beatMs * 0.6, lastIn + c.windupMs) : lastIn;
  const windAt = hemorrhage ? megaAt - c.windupMs : lastIn;
  const impactAt = hemorrhage ? megaAt + c.megaMs / 2 : lastIn;
  const hits = (hemorrhage ? slashes : slashes.slice(0, -1)).map((s) => s.arriveAt).sort((a, b) => a - b);
  const bleedAt = impactAt + (hemorrhage ? 240 : c.bleedMs);
  const closeAt = hemorrhage ? impactAt : impactAt + c.holdMs;
  const booms = hemorrhage ? [impactAt + 170, impactAt + 330] : [];
  const lastBeat = Math.max(
    impactAt + 160,
    booms.length ? booms[booms.length - 1]! + 140 : 0,
    impactAt + c.zoomOutMs * 0.8,
    // The drips, the stain and the closing wounds finish draining after the end (the scene keeps ticking until it is
    // empty), so the fight never waits on a fading wound.
    hemorrhage ? impactAt + Math.min(700, c.stainMs * 0.5) : Math.max(bleedAt + 200, closeAt),
  );
  const endAt = lastBeat + T.SettleMs;

  return {
    reduced: false, tier, k, total, chargeAt, absorbEnd, swingAt,
    slashes, hemorrhage, beats, windAt, megaAt, hits, impactAt, bleedAt, closeAt, booms, endAt,
    shakePx: clamp(T.Shake, 0, BLEED_CAPS.shakePx),
    zoom: clamp(T.Zoom, 0, BLEED_CAPS.zoom),
    punch: T.Punch,
    drops: Math.round(clamp(T.Drops, 0, BLEED_CAPS.drops)),
    burst: T.Burst,
    drips: Math.round(clamp(T.Drips, 0, BLEED_CAPS.drips)),
    dim: T.Dim,
  };
}

export type BleedCueKind = 'charge' | 'swing' | 'hit' | 'beat' | 'wind' | 'mega' | 'impact' | 'bleed' | 'close' | 'boom' | 'end';
export interface BleedCue { at: number; kind: BleedCueKind; i: number }

/** Every beat the runner fires, in time order (ties keep this declaration order, so a hit precedes the impact). */
export function bleedCues(p: BleedPlan): BleedCue[] {
  const out: BleedCue[] = [];
  if (!p.reduced) {
    out.push({ at: p.chargeAt, kind: 'charge', i: 0 });
    p.slashes.forEach((s, i) => out.push({ at: s.swingAt, kind: 'swing', i }));
    // Every cut but the last is a tick (Tier IV: every cut); the last one IS the impact.
    p.slashes.forEach((s, i) => { if (p.hemorrhage || i < p.slashes.length - 1) out.push({ at: s.arriveAt, kind: 'hit', i }); });
    p.beats.forEach((at, i) => out.push({ at, kind: 'beat', i }));
    if (p.hemorrhage) {
      out.push({ at: p.windAt, kind: 'wind', i: 0 });
      out.push({ at: p.megaAt, kind: 'mega', i: 0 });
    } else {
      out.push({ at: p.closeAt, kind: 'close', i: 0 });
    }
    out.push({ at: p.bleedAt, kind: 'bleed', i: 0 });
  }
  out.push({ at: p.impactAt, kind: 'impact', i: p.slashes.length - 1 });
  p.booms.forEach((at, i) => out.push({ at, kind: 'boom', i }));
  out.push({ at: p.endAt, kind: 'end', i: 0 });
  const order: Record<BleedCueKind, number> = {
    charge: 0, swing: 1, hit: 2, beat: 3, wind: 4, mega: 5, impact: 6, bleed: 7, close: 8, boom: 9, end: 10,
  };
  return out.map((q, idx) => ({ q, idx })).sort((a, b) => a.q.at - b.q.at || order[a.q.kind] - order[b.q.kind] || a.idx - b.idx).map((x) => x.q);
}

// ─── the slash geometry (pure) ─────────────────────────────────────────────────────────────────────────────────

/** One straight cut line across the face (screen px). */
export interface CutLine { from: Pt; to: Pt }

/**
 * A slash's whole path. `a` the release point (on the attacker's rim, toward the target), `c` the flight's control
 * point, `start` where the crescent meets the face and the cut begins, `end` where the cut leaves it. `angle` is the
 * cut's heading (radians). `lines` are the cut lines (one, or a claw rake's parallel three). `flightMs` + `drawMs` time it.
 */
export interface SlashGeo {
  a: Pt; c: Pt; start: Pt; end: Pt; aim: Pt;
  angle: number; len: number; lines: CutLine[];
  flightMs: number; drawMs: number;
}

/** The crescent's progress along its flight: loosed fast and still accelerating as it bites. */
export const waveEase = (u: number): number => { const t = Math.min(1, Math.max(0, Number.isFinite(u) ? u : 0)); return 0.72 * t + 0.28 * t * t; };

function quad(a: Pt, c: Pt, b: Pt, e: number): Pt {
  const m = 1 - e;
  return { x: m * m * a.x + 2 * m * e * c.x + e * e * b.x, y: m * m * a.y + 2 * m * e * c.y + e * e * b.y };
}

function quadHeading(a: Pt, c: Pt, b: Pt, e: number): number {
  const dx = 2 * (1 - e) * (c.x - a.x) + 2 * e * (b.x - c.x);
  const dy = 2 * (1 - e) * (c.y - a.y) + 2 * e * (b.y - c.y);
  return Math.atan2(dy, dx);
}

/** The shortest signed turn from angle `a` to `b`. */
export function turn(a: number, b: number): number { return Math.atan2(Math.sin(b - a), Math.cos(b - a)); }

/**
 * Where the crescent is `t` ms after its swing and which way it faces (the bulge leads along `rot`). Through the
 * flight it turns from its heading to the cut's angle; through the draw it runs straight along the cut; after the
 * draw it holds at the end. Pure: the scene samples it back in time for the afterimages.
 */
export function wavePos(g: SlashGeo, t: number): { x: number; y: number; rot: number } {
  if (t <= 0) return { x: g.a.x, y: g.a.y, rot: quadHeading(g.a, g.c, g.start, 0) };
  if (t < g.flightMs) {
    const u = t / g.flightMs;
    const e = waveEase(u);
    const p = quad(g.a, g.c, g.start, e);
    const h = quadHeading(g.a, g.c, g.start, e);
    const blend = clamp((u - 0.6) / 0.4, 0, 1);
    return { x: p.x, y: p.y, rot: h + turn(h, g.angle) * blend * blend };
  }
  const u = clamp((t - g.flightMs) / Math.max(1, g.drawMs), 0, 1);
  return { x: g.start.x + (g.end.x - g.start.x) * u, y: g.start.y + (g.end.y - g.start.y) * u, rot: g.angle };
}

/** Mirror a canonical (attacker-on-the-left) angle for an attacker on the right. */
const mirrorAngle = (angle: number, flip: boolean): number => (flip ? Math.PI - angle : angle);

/**
 * Every slash's path, from the plan and the two heroes. `aRadius` puts the release point on the attacker's rim
 * (toward the target); `radius` is the struck portrait's. The flight rises a little toward the top of the screen (never
 * above `ceilY`). Cut lines never leave the portrait by more than a little. Pure, so a replay cuts the same way.
 */
export function slashGeos(p: BleedPlan, a: Pt, d: Pt, radius: number, aRadius: number, c: HeroBleedConfig = cfg, ceilY = Number.NEGATIVE_INFINITY): SlashGeo[] {
  if (p.reduced) return [];
  const flip = a.x > d.x;
  const dx = d.x - a.x, dy = d.y - a.y;
  const L = Math.hypot(dx, dy) || 1;
  const u = { x: dx / L, y: dy / L };
  return p.slashes.map((sp) => {
    const angle = mirrorAngle(sp.angle, flip);
    const dir = { x: Math.cos(angle), y: Math.sin(angle) };
    const nrm = { x: -dir.y, y: dir.x };
    const aim = { x: d.x + (flip ? -sp.off.x : sp.off.x) * radius, y: d.y + sp.off.y * radius };
    const len = sp.len * radius;
    const lines: CutLine[] = [];
    for (let j = 0; j < sp.lines; j++) {
      const o = (j - (sp.lines - 1) / 2) * c.clawGap * radius;
      // A claw rake: the middle claw longest, the outer ones shorter and set back a touch.
      const lj = len * (sp.lines > 1 && j !== (sp.lines - 1) / 2 ? 0.8 : 1);
      const back = sp.lines > 1 ? Math.abs(j - (sp.lines - 1) / 2) * 0.06 * radius : 0;
      const cx = aim.x + nrm.x * o + dir.x * back, cy = aim.y + nrm.y * o + dir.y * back;
      lines.push({ from: { x: cx - dir.x * lj / 2, y: cy - dir.y * lj / 2 }, to: { x: cx + dir.x * lj / 2, y: cy + dir.y * lj / 2 } });
    }
    const start = { x: aim.x - dir.x * len / 2, y: aim.y - dir.y * len / 2 };
    const end = { x: aim.x + dir.x * len / 2, y: aim.y + dir.y * len / 2 };
    const rel = { x: a.x + u.x * aRadius * 0.8, y: a.y + u.y * aRadius * 0.8 };
    const D = Math.hypot(start.x - rel.x, start.y - rel.y) || 1;
    const mid = { x: (rel.x + start.x) / 2, y: (rel.y + start.y) / 2 };
    const ctrl = { x: mid.x, y: Math.max(ceilY, mid.y - c.waveLift * D) };
    return { a: rel, c: ctrl, start, end, aim, angle, len, lines, flightMs: sp.flightMs, drawMs: c.drawMs };
  });
}

/** Tier IV's mega-slash: one line through the target, `span` px long, swept from `from` to `to`. */
export interface MegaGeo { from: Pt; to: Pt; angle: number; span: number }

/** The mega-slash's canonical angle (attacker on the left): a steep diagonal, top left to bottom right. */
export const MEGA_ANGLE = 0.52;

/**
 * The mega-slash: a straight line through the struck hero, from the attacker's side of the screen to the far side, so
 * it crosses the target exactly half-way through its sweep (the impact). Pure.
 */
export function megaGeo(a: Pt, d: Pt, span: number): MegaGeo {
  const angle = mirrorAngle(MEGA_ANGLE, a.x > d.x);
  const dir = { x: Math.cos(angle), y: Math.sin(angle) };
  const s = Math.max(1, span);
  return { from: { x: d.x - dir.x * s / 2, y: d.y - dir.y * s / 2 }, to: { x: d.x + dir.x * s / 2, y: d.y + dir.y * s / 2 }, angle, span: s };
}

/** Where the mega-slash's head is at `u` (0..1 of its sweep). Linear: a slash keeps its speed through the target. */
export function megaPos(m: MegaGeo, u: number): Pt {
  const k = clamp(Number.isFinite(u) ? u : 0, 0, 1);
  return { x: m.from.x + (m.to.x - m.from.x) * k, y: m.from.y + (m.to.y - m.from.y) * k };
}

// ─── the camera (pure) ─────────────────────────────────────────────────────────────────────────────────────────

const springAt = (ms: number, hz: number, tau: number): number => (ms < 0 ? 0 : Math.exp(-ms / tau) * Math.cos(2 * Math.PI * hz * (ms / 1000)));
const sine = (u: number): number => 0.5 - 0.5 * Math.cos(Math.PI * Math.min(1, Math.max(0, u)));

/**
 * The camera at sequence time `t` (px in the space the points are in). A small push in on the hero through the ready;
 * a tiny recoil on each swing; a kick ALONG each cut as it lands; on THE impact a punch in and a shake along the last
 * cut. Tier IV instead breathes in with each heartbeat, eases back a little through the wind-up (room for the swing),
 * and the nova punches hardest with a shake that rings both ways. `cuts` are each slash's cut direction (unit), in
 * plan order. Deterministic (sines and springs): a replay moves identically. Pure.
 */
export function bleedCameraAt(p: BleedPlan, c: HeroBleedConfig, t: number, dir: Pt = { x: 1, y: 0 }, cuts: readonly Pt[] = []): { zoom: number; x: number; y: number } {
  if (p.reduced) return { zoom: 1, x: 0, y: 0 };
  let z = 0;
  if (t >= p.chargeAt && t < p.impactAt) {
    z += p.zoom * sine((t - p.chargeAt) / Math.max(1, p.swingAt - p.chargeAt));
    if (p.hemorrhage) {
      for (const b of p.beats) if (t >= b) z += p.zoom * 0.7 * Math.max(0, springAt(t - b, 3, 120));
      if (t >= p.windAt) z -= p.zoom * 0.45 * sine((t - p.windAt) / Math.max(1, p.megaAt - p.windAt));
    }
  } else if (t >= p.impactAt) {
    const since = t - p.impactAt;
    z += (p.zoom * (p.hemorrhage ? 2.3 : 1) + p.punch) * Math.exp(-since / Math.max(1, c.zoomOutMs / 4));
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
  p.slashes.forEach((s) => kick(s.swingAt, -p.shakePx * 0.1, 40, 14, dir));
  p.hits.forEach((at, i) => {
    const idx = p.slashes.findIndex((s) => s.arriveAt === at);
    kick(at, p.shakePx * (0.3 + 0.04 * i), 40, 18, cuts[idx] ?? dir);
  });
  if (p.hemorrhage) {
    p.beats.forEach((b, i) => kick(b, p.shakePx * 0.16, 50, 12, i % 2 ? perp : dir));
    const age = t - p.impactAt;
    if (age >= 0) {
      const env = Math.exp(-age / Math.max(1, c.shakeMs / 4));
      x += p.shakePx * 0.8 * env * Math.sin(age * 0.105 + 0.5);
      y += p.shakePx * env * Math.cos(age * 0.093);
    }
    p.booms.forEach((at, i) => kick(at, p.shakePx * 0.22, 45, 18, i % 2 ? perp : dir));
  } else {
    kick(p.impactAt, p.shakePx, Math.max(1, c.shakeMs / 4), 16, cuts[p.slashes.length - 1] ?? dir);
    kick(p.bleedAt, p.shakePx * 0.1, 60, 10, perp);
  }
  return { zoom: 1 + Math.max(0, z), x, y };
}

/**
 * Where the camera anchors: the ATTACKER through the ready, following the first crescent in flight, the DEFENDER from
 * the first cut on. A zoom anchored on a point keeps that point still. Pure.
 */
export function bleedCameraFocus(p: BleedPlan, t: number, a: Pt, d: Pt): Pt {
  const settle = p.slashes.length ? p.slashes[0]!.arriveAt : p.impactAt;
  if (t <= p.swingAt) return a;
  if (t >= settle) return d;
  const u = (t - p.swingAt) / Math.max(1, settle - p.swingAt);
  const e = sine(u);
  return { x: a.x + (d.x - a.x) * e, y: a.y + (d.y - a.y) * e };
}
