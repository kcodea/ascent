/**
 * THE FEL HERO ATTACK ("Chaos Bolt", a placeholder name): its tuned values, its pure timeline, the pure bolt and meteor
 * paths and the pure camera.
 *
 * Owner 2026-09-30: "create a brand new attack animation that is on par with hearthstone/modern world of warcraft level
 * animation art style performance readability and everything", theme FEL / CHAOS BOLT (warlock fel fire). The art
 * direction is Blizzard's spell VFX rules: a strong SILHOUETTE first (a bright fel-green core inside a dark crackling
 * shell reads at a glance at game size), a clear ANTICIPATION (a fel sigil opens, motes stream into it, the bolt swells
 * and draws back), a punchy RELEASE (a snap, a flash, a kick) and a satisfying DISSIPATION (the impact flares, the dark
 * shell shatters outward, the fel fire rolls up into dark smoke and embers). Chunky, saturated shapes with bright cores
 * and darker rims; magic appears and vanishes through glows and rims, never pops.
 *
 * THE BEATS (base ms before the playback speed):
 *  1. THE DAMAGE FORMATION (shared by every style, `../heroAttack/damageFormation.ts`). Its end is this style's start.
 *  2. GATHER. The total dives into the attacking hero; fel flames catch round its upper rim, and for each bolt a small
 *     fel SIGIL spins open in the air on the side facing the target while green motes stream into it and the bolt swells
 *     out of it: a white-green heart inside a dark, crackling shell.
 *  3. RELEASE. Each bolt draws back (an ease-in-back wind-up) and SNAPS away fast on a slight arc, its sigil collapsing
 *     behind it in a flash; a comet tail of fel fire, dark smoke and embers streams behind it. I one; II two (from either
 *     side of the hero); III two quick bolts, then the GREAT bolt that swelled while they flew.
 *  4. IMPACT. A bolt that lands before the last is a tick (FX only). The LAST one is THE impact (the big `-N`): a white-green
 *     flare, its dark shell shattering outward as a dark ring, a green shock ring, jagged crackle and shards thrown out,
 *     fel fire rolling up into dark smoke. II leaves the struck rim briefly alight; III's great bolt FLARES the target up
 *     and leaves fel fire BURNING on it. The consequence (the damage, Armor, Resolve) lands ONCE, there.
 *  IV. THE HAND. Two bolts tick in. The hero raises its hand and a fel RUNE CIRCLE opens over the struck hero (spinning
 *     glyph rings, the ground under it darkening, fel flames licking up its rim, motes drawn in), brightening while a
 *     CHAOS METEOR (a huge bolt, dark shell and all) falls from above the screen into it. It ERUPTS: a white-green core
 *     and a screen flash, shockwaves and a dark pressure ring, the circle flaring and breaking apart, a towering pillar of
 *     fel fire roaring up off the target, crackle and shards and burning debris flung out, then lingering fel flames on
 *     the struck rim and ASH drifting down. The damage lands on the eruption.
 *
 * No hit-stop or freeze anywhere (owner 2026-09-28: "it looks like lag"): weight comes from the flash, the squash and
 * knockback, the shake, the fire and the sound. Flat 2D: the rune circle is a flat disc on the portrait, never tilted.
 *
 * TIERS are the shared, owner-approved thresholds (I 1-5, II 6-11, III 12-19, IV 20+); a knockout always plays IV.
 * Reduced motion: no fire, meteor, shake or zoom; the numbers fade and the blow lands.
 *
 * Tuner convention (the Blast's): localStorage in DEV only, values clamped on write and on load; production always
 * plays DEFAULTS.
 */
import { clamp, easeInBack, easeInOutSine, easeOutBack, hexToNum, type Pt } from '../heroAttack/easing';
import {
  HERO_ATTACK_TIER_THRESHOLDS, TIERS, attackTier, reducedAttackTimeline, type AttackTierContext, type TierNum,
} from '../heroAttack/tiers';

export { TIERS, hexToNum, type TierNum };

/** The per-tier dials. A config key is `t1..t4` + one of these. */
export const FEL_TIER_SUFFIXES = [
  'FormMs', 'Bolts', 'StaggerMs', 'FlightMs', 'BoltSize', 'GreatBolt', 'Arc', 'Hand',
  'Shake', 'Zoom', 'Punch', 'Burst', 'Burn', 'BurnMs', 'Embers', 'SettleMs', 'Dim',
] as const;
export type FelTierSuffix = (typeof FEL_TIER_SUFFIXES)[number];
type TierKey = `t${TierNum}${FelTierSuffix}`;

interface GlobalConfig {
  tier2At: number; tier3At: number; tier4At: number;
  // Gather
  absorbMs: number;
  heroSwell: number;
  recoilPx: number;
  growMs: number;
  formRadius: number;
  formSpread: number;
  kindle: number;
  sigilSize: number;
  motes: number;
  // The bolts
  boltRadius: number;
  boltFlame: number;
  boltGlow: number;
  shell: number;
  crackle: number;
  windupMs: number;
  windupPx: number;
  trail: number;
  trailSmoke: number;
  // The live fel fire (every flame in the attack)
  turbulence: number;
  buoyancy: number;
  smoke: number;
  embers: number;
  // Impacts and the burn
  impactSize: number;
  shards: number;
  burnSize: number;
  // The Hand (Tier IV)
  gateMs: number;
  gateSize: number;
  meteorMs: number;
  meteorSize: number;
  eruptMs: number;
  eruptHeight: number;
  burnoutMs: number;
  ash: number;
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
  colorFel: string;
  colorDeep: string;
  colorEmber: string;
  colorSmoke: string;
  colorShell: string;
  colorRune: string;
  colorPlayer: string;
  colorFoe: string;
  // Sound: a clip, a gain and a pitch per cue ('' = silent)
  sfxGatherClip: string; sfxGatherGain: number; sfxGatherRate: number;
  sfxFormClip: string; sfxFormGain: number; sfxFormRate: number;
  sfxLaunchClip: string; sfxLaunchGain: number; sfxLaunchRate: number;
  sfxWhooshClip: string; sfxWhooshGain: number; sfxWhooshRate: number;
  sfxHitClip: string; sfxHitGain: number; sfxHitRate: number;
  sfxBlastClip: string; sfxBlastGain: number; sfxBlastRate: number;
  sfxImpactClip: string; sfxImpactGain: number; sfxImpactRate: number;
  sfxThumpClip: string; sfxThumpGain: number; sfxThumpRate: number;
  sfxBigClip: string; sfxBigGain: number; sfxBigRate: number;
  sfxGateClip: string; sfxGateGain: number; sfxGateRate: number;
  sfxMeteorClip: string; sfxMeteorGain: number; sfxMeteorRate: number;
  sfxEruptClip: string; sfxEruptGain: number; sfxEruptRate: number;
  sfxShatterClip: string; sfxShatterGain: number; sfxShatterRate: number;
  sfxBoomClip: string; sfxBoomGain: number; sfxBoomRate: number;
  sfxRoarGain: number; sfxRoarLowHz: number; sfxRoarHighHz: number;
  sfxCrackleGain: number;
  sfxImpactLenMs: number;
  sfxTailMix: number;
  sfxDuck: number;
  // Preview only (the tuner's Play buttons). Never read by a real fight, and left out of Copy JSON.
  previewDamage: number;
  previewParts: number;
}
export type HeroFelConfig = GlobalConfig & Record<TierKey, number>;

export const HERO_FEL_COLOR_KEYS = [
  'colorCore', 'colorHot', 'colorFel', 'colorDeep', 'colorEmber', 'colorSmoke', 'colorShell', 'colorRune', 'colorPlayer', 'colorFoe',
] as const;
export const HERO_FEL_CLIP_KEYS = [
  'sfxGatherClip', 'sfxFormClip', 'sfxLaunchClip', 'sfxWhooshClip', 'sfxHitClip', 'sfxBlastClip', 'sfxImpactClip', 'sfxThumpClip',
  'sfxBigClip', 'sfxGateClip', 'sfxMeteorClip', 'sfxEruptClip', 'sfxShatterClip', 'sfxBoomClip',
] as const;
type ColorKey = (typeof HERO_FEL_COLOR_KEYS)[number];
type ClipKey = (typeof HERO_FEL_CLIP_KEYS)[number];
export type HeroFelStrKey = ColorKey | ClipKey;
export type HeroFelNumKey = Exclude<keyof HeroFelConfig, HeroFelStrKey>;

/** Tier I .. IV per suffix: the escalation ladder. */
const TIER_DEFAULTS: Record<FelTierSuffix, [number, number, number, number]> = {
  FormMs: [500, 540, 720, 560],
  Bolts: [1, 2, 3, 2],
  StaggerMs: [0, 170, 150, 150],
  FlightMs: [360, 340, 330, 320],
  BoltSize: [1, 1, 0.78, 0.9],
  GreatBolt: [1, 1.08, 1.9, 1],
  Arc: [0.06, 0.1, 0.12, 0.1],
  Hand: [0, 0, 0, 1],
  Shake: [5, 8, 13, 24],
  Zoom: [0.02, 0.03, 0.05, 0.075],
  Punch: [0.02, 0.028, 0.042, 0.065],
  Burst: [1, 1.15, 1.6, 2.1],
  Burn: [0, 0.4, 1.25, 1.3],
  BurnMs: [0, 420, 1000, 1500],
  Embers: [10, 16, 36, 70],
  SettleMs: [260, 320, 520, 480],
  Dim: [0.06, 0.2, 0.34, 0.52],
};

export const FEL_TIER_RANGES: Record<FelTierSuffix, [number, number, number]> = {
  FormMs: [150, 1600, 10],
  Bolts: [1, 6, 1],
  StaggerMs: [0, 400, 5],
  FlightMs: [120, 1200, 10],
  BoltSize: [0.3, 2.5, 0.01],
  GreatBolt: [0.5, 3, 0.01],
  Arc: [0, 0.5, 0.01],
  Hand: [0, 1, 1],
  Shake: [0, 40, 0.5],
  Zoom: [0, 0.14, 0.002],
  Punch: [0, 0.1, 0.001],
  Burst: [0.3, 3, 0.05],
  Burn: [0, 2, 0.05],
  BurnMs: [0, 3000, 10],
  Embers: [0, 120, 1],
  SettleMs: [0, 1600, 10],
  Dim: [0, 0.8, 0.01],
};

const tierDefaults = Object.fromEntries(TIERS.flatMap((t) => FEL_TIER_SUFFIXES.map((s) => [`t${t}${s}`, TIER_DEFAULTS[s][t - 1]]))) as Record<TierKey, number>;

export const HERO_FEL_DEFAULTS: HeroFelConfig = {
  ...HERO_ATTACK_TIER_THRESHOLDS,
  absorbMs: 190,
  heroSwell: 0.06,
  recoilPx: 10,
  growMs: 320,
  formRadius: 1.3,
  formSpread: 84,
  kindle: 1,
  sigilSize: 1,
  motes: 1,
  boltRadius: 30,
  boltFlame: 1,
  boltGlow: 0.85,
  shell: 1,
  crackle: 1,
  windupMs: 150,
  windupPx: 22,
  trail: 1,
  trailSmoke: 1,
  turbulence: 1,
  buoyancy: 1,
  smoke: 1,
  embers: 1,
  impactSize: 1,
  shards: 1,
  burnSize: 1,
  gateMs: 700,
  gateSize: 1.9,
  meteorMs: 560,
  meteorSize: 2.2,
  eruptMs: 560,
  eruptHeight: 1,
  burnoutMs: 900,
  ash: 1,
  scorch: 1,
  flashAlpha: 0.85,
  knockPx: 18,
  squash: 0.1,
  shakeMs: 340,
  zoomOutMs: 360,
  reducedFadeMs: 260,
  colorCore: '#f4ffe0',
  colorHot: '#d2ff5a',
  colorFel: '#5ef02c',
  colorDeep: '#1c9e2a',
  colorEmber: '#0b3a14',
  colorSmoke: '#1d1028',
  colorShell: '#25082f',
  colorRune: '#7dff3c',
  colorPlayer: '#8dff45',
  colorFoe: '#ff4a63',
  sfxGatherClip: 'spirittendril', sfxGatherGain: 0.36, sfxGatherRate: 0.8,
  sfxFormClip: 'fx/oona-powerup', sfxFormGain: 0.22, sfxFormRate: 0.85,
  sfxLaunchClip: 'fel-spike-echo', sfxLaunchGain: 0.5, sfxLaunchRate: 1,
  sfxWhooshClip: 'fx/stereogenicstudio-swish-swoosh-woosh-sfx-27-357164-3', sfxWhooshGain: 0.34, sfxWhooshRate: 0.8,
  sfxHitClip: 'fel-spike-echo-land', sfxHitGain: 0.4, sfxHitRate: 1.12,
  sfxBlastClip: 'turnexplosion', sfxBlastGain: 0.5, sfxBlastRate: 0.85,
  sfxImpactClip: 'fel-spike-echo-land', sfxImpactGain: 0.6, sfxImpactRate: 0.92,
  sfxThumpClip: 'smack2', sfxThumpGain: 0.4, sfxThumpRate: 0.85,
  sfxBigClip: 'skullburst', sfxBigGain: 0.32, sfxBigRate: 0.85,
  sfxGateClip: 'runeselectimplosion', sfxGateGain: 0.5, sfxGateRate: 0.8,
  sfxMeteorClip: 'fx/universfield-cinematic-swoosh-impact-454392', sfxMeteorGain: 0.5, sfxMeteorRate: 0.75,
  sfxEruptClip: 'fx/universfield-ground-impact-352053', sfxEruptGain: 0.7, sfxEruptRate: 0.9,
  sfxShatterClip: 'rune-chain-break', sfxShatterGain: 0.45, sfxShatterRate: 0.9,
  sfxBoomClip: 'fx/triple-impact', sfxBoomGain: 0.28, sfxBoomRate: 1.1,
  sfxRoarGain: 0.42, sfxRoarLowHz: 45, sfxRoarHighHz: 900,
  sfxCrackleGain: 0.3,
  sfxImpactLenMs: 1100,
  sfxTailMix: 0.18,
  sfxDuck: 0.5,
  previewDamage: 12,
  previewParts: 4,
  ...tierDefaults,
};

const GLOBAL_RANGES: Record<Exclude<keyof GlobalConfig, HeroFelStrKey>, [number, number, number]> = {
  tier2At: [2, 40, 1], tier3At: [2, 60, 1], tier4At: [2, 80, 1],
  absorbMs: [60, 600, 10],
  heroSwell: [0, 0.3, 0.01],
  recoilPx: [0, 60, 1],
  growMs: [60, 1000, 10],
  formRadius: [0.6, 2.5, 0.01],
  formSpread: [0, 170, 1],
  kindle: [0, 3, 0.05],
  sigilSize: [0, 3, 0.05],
  motes: [0, 3, 0.05],
  boltRadius: [8, 90, 1],
  boltFlame: [0.2, 3, 0.05],
  boltGlow: [0, 2, 0.05],
  shell: [0, 2, 0.05],
  crackle: [0, 3, 0.05],
  windupMs: [0, 400, 5],
  windupPx: [0, 80, 1],
  trail: [0, 3, 0.05],
  trailSmoke: [0, 3, 0.05],
  turbulence: [0, 3, 0.05],
  buoyancy: [0, 3, 0.05],
  smoke: [0, 3, 0.05],
  embers: [0, 3, 0.05],
  impactSize: [0.3, 3, 0.05],
  shards: [0, 3, 0.05],
  burnSize: [0.3, 2.5, 0.05],
  gateMs: [150, 2000, 10],
  gateSize: [0.8, 4, 0.05],
  meteorMs: [150, 2000, 10],
  meteorSize: [0.8, 5, 0.05],
  eruptMs: [0, 3000, 10],
  eruptHeight: [0.3, 3, 0.05],
  burnoutMs: [100, 3000, 10],
  ash: [0, 3, 0.05],
  scorch: [0, 2, 0.05],
  flashAlpha: [0, 1, 0.01],
  knockPx: [0, 60, 1],
  squash: [0, 0.3, 0.01],
  shakeMs: [0, 1200, 10],
  zoomOutMs: [60, 1500, 10],
  reducedFadeMs: [60, 1000, 10],
  sfxGatherGain: [0, 2, 0.05], sfxGatherRate: [0.5, 2, 0.01],
  sfxFormGain: [0, 2, 0.05], sfxFormRate: [0.5, 2, 0.01],
  sfxLaunchGain: [0, 2, 0.05], sfxLaunchRate: [0.5, 2, 0.01],
  sfxWhooshGain: [0, 2, 0.05], sfxWhooshRate: [0.5, 2, 0.01],
  sfxHitGain: [0, 2, 0.05], sfxHitRate: [0.5, 2, 0.01],
  sfxBlastGain: [0, 2, 0.05], sfxBlastRate: [0.5, 2, 0.01],
  sfxImpactGain: [0, 2, 0.05], sfxImpactRate: [0.5, 2, 0.01],
  sfxThumpGain: [0, 2, 0.05], sfxThumpRate: [0.5, 2, 0.01],
  sfxBigGain: [0, 2, 0.05], sfxBigRate: [0.5, 2, 0.01],
  sfxGateGain: [0, 2, 0.05], sfxGateRate: [0.5, 2, 0.01],
  sfxMeteorGain: [0, 2, 0.05], sfxMeteorRate: [0.5, 2, 0.01],
  sfxEruptGain: [0, 2, 0.05], sfxEruptRate: [0.5, 2, 0.01],
  sfxShatterGain: [0, 2, 0.05], sfxShatterRate: [0.5, 2, 0.01],
  sfxBoomGain: [0, 2, 0.05], sfxBoomRate: [0.5, 2, 0.01],
  sfxRoarGain: [0, 2, 0.05], sfxRoarLowHz: [20, 400, 5], sfxRoarHighHz: [200, 4000, 10],
  sfxCrackleGain: [0, 2, 0.05],
  sfxImpactLenMs: [150, 3500, 10],
  sfxTailMix: [0, 0.6, 0.01],
  sfxDuck: [0, 1, 0.05],
  previewDamage: [1, 60, 1],
  previewParts: [1, 8, 1],
};

/** [min, max, step] per numeric key. Values outside are clamped on write AND on load. */
export const HERO_FEL_RANGES: Record<HeroFelNumKey, [number, number, number]> = {
  ...GLOBAL_RANGES,
  ...(Object.fromEntries(TIERS.flatMap((t) => FEL_TIER_SUFFIXES.map((s) => [`t${t}${s}`, FEL_TIER_RANGES[s]]))) as Record<TierKey, [number, number, number]>),
};

/** The hard ceilings a plan can never exceed, whatever the sliders say (so a 40 stays crisp, not cluttered). */
export const FEL_CAPS = { bolts: 6, shakePx: 40, zoom: 0.14, embers: 120 } as const;

const HEX = /^#[0-9a-f]{6}$/i;
const isColorKey = (k: string): k is ColorKey => (HERO_FEL_COLOR_KEYS as readonly string[]).includes(k);
const isClipKey = (k: string): k is ClipKey => (HERO_FEL_CLIP_KEYS as readonly string[]).includes(k);

/** One value, made safe: numbers clamped into range (junk = the default), colours #rrggbb, clips a short string. */
export function clampHeroFelValue<K extends keyof HeroFelConfig>(key: K, value: unknown): HeroFelConfig[K] | undefined {
  if (!Object.prototype.hasOwnProperty.call(HERO_FEL_DEFAULTS, key)) return undefined;
  const def = HERO_FEL_DEFAULTS[key];
  if (isColorKey(key)) {
    if (typeof value !== 'string') return def;
    const v = value.trim();
    return (HEX.test(v) ? v.toLowerCase() : def) as HeroFelConfig[K];
  }
  if (isClipKey(key)) return (typeof value === 'string' ? value.trim().slice(0, 160) : def) as HeroFelConfig[K];
  const n = typeof value === 'number' ? value : Number(value);
  if (typeof value === 'boolean' || value === null || value === '' || !Number.isFinite(n)) return def;
  const [min, max] = HERO_FEL_RANGES[key as HeroFelNumKey];
  return Math.min(max, Math.max(min, n)) as HeroFelConfig[K];
}

/** A whole saved object, sanitised key by key over the defaults (junk and unknown keys dropped). */
export function sanitizeHeroFelConfig(saved: unknown): HeroFelConfig {
  const out: HeroFelConfig = { ...HERO_FEL_DEFAULTS };
  if (!saved || typeof saved !== 'object') return out;
  for (const [k, v] of Object.entries(saved as Record<string, unknown>)) {
    const safe = clampHeroFelValue(k as keyof HeroFelConfig, v);
    if (safe !== undefined) (out as unknown as Record<string, unknown>)[k] = safe;
  }
  return out;
}

const KEY = 'ascent.herofel.v1';

let cfg: HeroFelConfig = (() => {
  if (!import.meta.env.DEV || typeof localStorage === 'undefined') return { ...HERO_FEL_DEFAULTS };
  try { return sanitizeHeroFelConfig(JSON.parse(localStorage.getItem(KEY) ?? '{}')); } catch { return { ...HERO_FEL_DEFAULTS }; }
})();

export function getHeroFelConfig(): HeroFelConfig { return cfg; }

export function setHeroFelValue(key: keyof HeroFelConfig, value: number | string): void {
  const safe = clampHeroFelValue(key, value);
  if (safe === undefined) return;
  cfg = { ...cfg, [key]: safe };
  if (!import.meta.env.DEV) return;
  try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch { /* ignore */ }
}

export function resetHeroFelConfig(): void {
  cfg = { ...HERO_FEL_DEFAULTS };
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}

/** The tuned values as JSON for pasting back into DEFAULTS (the preview-only keys left out). */
export function heroFelConfigJson(c: HeroFelConfig = cfg): string {
  const ship: Partial<HeroFelConfig> = { ...c };
  delete ship.previewDamage;
  delete ship.previewParts;
  return JSON.stringify(ship, null, 2);
}

/** The preview speed: the tuners have no speed buttons (owner 2026-09-29), so it is always 1. Kept for the dispatch. */
export function heroFelPreviewSpeed(): number { return 1; }

// ─── the pure plan ─────────────────────────────────────────────────────────────────────────────────────────────

export function felTierDials(tier: TierNum, c: HeroFelConfig = cfg): Record<FelTierSuffix, number> {
  return Object.fromEntries(FEL_TIER_SUFFIXES.map((s) => [s, c[`t${tier}${s}`]])) as Record<FelTierSuffix, number>;
}

/** The reference distance the per-tier times are tuned at (a 1080p board, corner to corner). */
export const FEL_REF_DISTANCE = 1600;

/** A travel time for a distance: the tuned time, scaled gently by the distance (a sandbox box stays readable). */
export function felTravelMs(distance: number, tunedMs: number): number {
  const d = Number.isFinite(distance) && distance > 0 ? distance : FEL_REF_DISTANCE;
  return Math.round(tunedMs * clamp(Math.sqrt(d / FEL_REF_DISTANCE), 0.6, 1.15));
}

/** Signed fan slots in LAUNCH order: II from either side; III two flankers then the centre (the great bolt) last. */
export function felSlots(n: number): number[] {
  if (n <= 1) return [0];
  if (n === 2) return [-1, 1];
  const out: number[] = [];
  const half = Math.floor(n / 2);
  for (let k = half; k >= 1; k--) { out.push(-k); out.push(k); }
  if (n % 2 === 1) out.push(0);
  return out.slice(0, n);
}

export interface BoltPlan {
  /** Its sigil opens and the bolt starts to swell. */
  formAt: number;
  /** It leaves (the wind-up comes just before this). */
  launchAt: number;
  flightMs: number;
  arriveAt: number;
  slot: number;
  /** Size multiplier (the great bolt is the biggest). */
  size: number;
  /** Tier III's last: the GREAT bolt (swells the whole time the others fly; sets the target burning). */
  great: boolean;
}

export interface FelPlanInput extends AttackTierContext {
  leadIn?: number;
  total: number;
  distance: number;
  reduced?: boolean;
}

export interface FelPlan {
  reduced: boolean;
  tier: TierNum;
  /** 0..1 across the tiers (I = 0, IV = 1). */
  k: number;
  total: number;
  /** The total dives into the hero, the gather begins. */
  chargeAt: number;
  absorbEnd: number;
  /** The first bolt leaves. */
  fireAt: number;
  bolts: BoltPlan[];
  /** Tier IV: the rune circle and the chaos meteor carry the blow. */
  hand: boolean;
  /** Tier IV: the rune circle opens over the target (else the impact). */
  gateAt: number;
  /** Tier IV: the meteor appears above the screen and falls (else the impact). */
  meteorAt: number;
  /** Bolts that land BEFORE the impact: the rhythm ticks. */
  hits: number[];
  /** THE consequence beat: the last bolt lands (I-III) or the meteor erupts (IV). */
  impactAt: number;
  /** Aftershocks round the target (IV). */
  booms: number[];
  endAt: number;
  shakePx: number;
  zoom: number;
  punch: number;
  burst: number;
  burn: number;
  burnMs: number;
  embers: number;
  arc: number;
  dim: number;
}

/** The whole Fel attack, in base ms. Pure and deterministic. */
export function felPlan(input: FelPlanInput, c: HeroFelConfig = cfg): FelPlan {
  const total = Math.max(0, Math.round(input.total));
  const tier = attackTier(total, input, c);
  const T = felTierDials(tier, c);
  const k = (tier - 1) / 3;

  if (input.reduced) {
    const r = reducedAttackTimeline(input.leadIn ?? 0, c.reducedFadeMs);
    const { impactAt } = r;
    return {
      reduced: true, tier, k, total, chargeAt: impactAt, absorbEnd: impactAt, fireAt: impactAt, bolts: [], hand: false,
      gateAt: impactAt, meteorAt: impactAt, hits: [], impactAt, booms: [], endAt: r.endAt, shakePx: 0, zoom: 0, punch: 0,
      burst: 0, burn: 0, burnMs: 0, embers: 0, arc: 0, dim: 0,
    };
  }

  const chargeAt = Math.max(0, input.leadIn ?? 0);
  const absorbEnd = chargeAt + c.absorbMs;
  const fireAt = chargeAt + Math.max(T.FormMs, c.absorbMs);
  const hand = T.Hand >= 1;
  const count = clamp(Math.round(T.Bolts), 1, FEL_CAPS.bolts);
  const flight = felTravelMs(input.distance, T.FlightMs);
  const slots = felSlots(count);
  const greatOn = count >= 3 && !hand && T.GreatBolt > 1.2;
  const formStep = count > 1 ? Math.min(120, Math.max(0, T.FormMs - c.growMs - 60) / (count - 1)) : 0;
  const bolts: BoltPlan[] = slots.map((slot, i) => {
    const last = i === count - 1;
    const great = greatOn && last;
    // The great bolt waits a beat longer after the others (it has swelled the whole time they flew).
    const launchAt = fireAt + i * T.StaggerMs + (great ? T.StaggerMs * 0.8 : 0);
    const formAt = great ? chargeAt + 40
      : Math.max(chargeAt, Math.min(chargeAt + 60 + i * formStep, launchAt - c.windupMs - c.growMs));
    const fl = great ? Math.round(flight * 1.15) : flight;
    const size = T.BoltSize * (last && count > 1 ? Math.max(1, T.GreatBolt) : 1);
    return { formAt, launchAt, flightMs: fl, arriveAt: launchAt + fl, slot, size, great };
  });
  const lastLaunch = bolts[bolts.length - 1]!.launchAt;
  const lastIn = Math.max(...bolts.map((r) => r.arriveAt));
  let gateAt = lastIn, meteorAt = lastIn, impactAt = lastIn;
  if (hand) {
    gateAt = Math.max(lastLaunch + 90, lastIn - 60);
    meteorAt = gateAt + c.gateMs;
    impactAt = meteorAt + felTravelMs(input.distance, c.meteorMs);
  }
  const hits = bolts.map((r) => r.arriveAt).filter((at) => hand || at < impactAt).sort((a, b) => a - b);
  const booms = hand ? [impactAt + 180, impactAt + 360] : [];
  const lastBeat = Math.max(
    impactAt + 160,
    booms.length ? booms[booms.length - 1]! + 120 : 0,
    impactAt + c.zoomOutMs * 0.8,
    hand ? impactAt + Math.min(900, c.eruptMs + 200) : 0,
  );
  const endAt = lastBeat + T.SettleMs;

  return {
    reduced: false, tier, k, total, chargeAt, absorbEnd, fireAt, bolts, hand, gateAt, meteorAt, hits, impactAt, booms, endAt,
    shakePx: clamp(T.Shake, 0, FEL_CAPS.shakePx),
    zoom: clamp(T.Zoom, 0, FEL_CAPS.zoom),
    punch: T.Punch,
    burst: T.Burst,
    burn: Math.max(0, T.Burn),
    burnMs: Math.max(0, T.BurnMs),
    embers: Math.round(clamp(T.Embers, 0, FEL_CAPS.embers)),
    arc: T.Arc,
    dim: T.Dim,
  };
}

export type FelCueKind = 'charge' | 'grow' | 'fire' | 'hit' | 'gate' | 'meteor' | 'impact' | 'boom' | 'end';
export interface FelCue { at: number; kind: FelCueKind; i: number }

/** Every beat the runner fires, in time order (ties keep this declaration order, so a hit precedes the impact). */
export function felCues(p: FelPlan): FelCue[] {
  const out: FelCue[] = [];
  if (!p.reduced) {
    out.push({ at: p.chargeAt, kind: 'charge', i: 0 });
    p.bolts.forEach((r, i) => out.push({ at: r.formAt, kind: 'grow', i }));
    p.bolts.forEach((r, i) => out.push({ at: r.launchAt, kind: 'fire', i }));
    p.bolts.forEach((r, i) => { if (p.hand || i < p.bolts.length - 1) out.push({ at: r.arriveAt, kind: 'hit', i }); });
    if (p.hand) {
      out.push({ at: p.gateAt, kind: 'gate', i: 0 });
      out.push({ at: p.meteorAt, kind: 'meteor', i: 0 });
    }
  }
  out.push({ at: p.impactAt, kind: 'impact', i: 0 });
  p.booms.forEach((at, i) => out.push({ at, kind: 'boom', i }));
  out.push({ at: p.endAt, kind: 'end', i: 0 });
  const order: Record<FelCueKind, number> = { charge: 1, grow: 2, fire: 3, hit: 4, gate: 5, meteor: 6, impact: 7, boom: 8, end: 9 };
  return out.map((q, idx) => ({ q, idx })).sort((a, b) => a.q.at - b.q.at || order[a.q.kind] - order[b.q.kind] || a.idx - b.idx).map((x) => x.q);
}

// ─── the bolt paths (pure) ─────────────────────────────────────────────────────────────────────────────────────

/**
 * A bolt's whole life, in SEQUENCE ms: its sigil opens at `home` and the bolt swells to `radius`, hovers and crackles,
 * WINDS UP (drawn back toward `from` on an ease-in-back) and SNAPS from `from` to `to` (its hit point) on a gentle
 * quadratic through `ctrl`.
 */
export interface BoltMotion {
  home: Pt;
  radius: number;
  formAt: number; growMs: number;
  pullAt: number; launchAt: number; arriveAt: number;
  from: Pt; ctrl: Pt; to: Pt;
  phase: number;
  great: boolean;
}

/** Where a bolt is: its centre, heading, growth (0..~1.1), whether it is winding up, in flight, or landed. */
export interface BoltPose { x: number; y: number; rot: number; grow: number; windup: number; flying: boolean; landed: boolean }

/** The flight ease: it leaves already fast and still ACCELERATES into the target (a snap, not a float). */
export const boltEase = (u: number): number => { const t = Math.min(1, Math.max(0, Number.isFinite(u) ? u : 0)); return 0.62 * t + 0.38 * t * t; };

const quad = (a: number, b: number, c: number, t: number): number => { const m = 1 - t; return m * m * a + 2 * m * t * b + t * t * c; };

export function boltPoint(m: BoltMotion, e: number): Pt {
  return { x: quad(m.from.x, m.ctrl.x, m.to.x, e), y: quad(m.from.y, m.ctrl.y, m.to.y, e) };
}

export function boltRot(m: BoltMotion, e: number): number {
  const t = Math.min(1, Math.max(0, e));
  const dx = 2 * (1 - t) * (m.ctrl.x - m.from.x) + 2 * t * (m.to.x - m.ctrl.x);
  const dy = 2 * (1 - t) * (m.ctrl.y - m.from.y) + 2 * t * (m.to.y - m.ctrl.y);
  return Math.atan2(dy, dx);
}

/** Where the bolt is at sequence time `t`. Pure. */
export function boltPose(m: BoltMotion, t: number): BoltPose {
  const aimRot = Math.atan2(m.to.y - m.home.y, m.to.x - m.home.x);
  if (t < m.launchAt) {
    if (t < m.formAt) return { x: m.home.x, y: m.home.y, rot: aimRot, grow: 0, windup: 0, flying: false, landed: false };
    // Swelling out of the sigil (a little overshoot, then it settles and seethes). The great bolt keeps swelling.
    const span = m.great ? Math.max(m.growMs, m.pullAt - m.formAt) : m.growMs;
    const g = m.great
      ? 0.35 + 0.65 * easeInOutSine((t - m.formAt) / Math.max(1, span))
      : easeOutBack(Math.min(1, (t - m.formAt) / Math.max(1, span)), 1.4);
    const bob = 2 * Math.sin((t - m.formAt) * 0.009 + m.phase) * Math.min(1, (t - m.formAt) / 300);
    // THE WIND-UP: an ease-in-back toward `from` (it drifts a hair forward first, then is drawn back hard).
    const w = t >= m.pullAt ? (t - m.pullAt) / Math.max(1, m.launchAt - m.pullAt) : 0;
    const pull = w > 0 ? Math.max(-0.12, easeInBack(Math.min(1, w), 0.6)) : 0;
    return {
      x: m.home.x + (m.from.x - m.home.x) * pull,
      y: m.home.y + (m.from.y - m.home.y) * pull + bob,
      rot: aimRot, grow: g * (1 + 0.12 * Math.max(0, pull)), windup: Math.max(0, Math.min(1, w)), flying: false, landed: false,
    };
  }
  if (t >= m.arriveAt) return { x: m.to.x, y: m.to.y, rot: boltRot(m, 1), grow: 1, windup: 0, flying: false, landed: true };
  const e = boltEase((t - m.launchAt) / Math.max(1, m.arriveAt - m.launchAt));
  const p = boltPoint(m, e);
  return { x: p.x, y: p.y, rot: boltRot(m, e), grow: 1, windup: 0, flying: true, landed: false };
}

/**
 * Every bolt's whole life. They form in a fan round the striking portrait on the side facing the target (never over
 * the face, never above the top of the frame); each lands on its own hit point on the struck portrait (the last, THE
 * impact, on its heart). Pure, so a replay flies the same paths.
 */
export function boltMotions(
  p: FelPlan, a: Pt, d: Pt, aRadius: number, dRadius: number, c: HeroFelConfig = cfg, scale = 1, ceilY = Number.NEGATIVE_INFINITY,
): BoltMotion[] {
  if (p.reduced) return [];
  const n = p.bolts.length;
  const dx = d.x - a.x, dy = d.y - a.y;
  const dist = Math.hypot(dx, dy) || 1;
  const u = { x: dx / dist, y: dy / dist };
  const nrm = { x: -u.y, y: u.x };
  const base = Math.atan2(u.y, u.x);
  const maxSlot = Math.max(1, ...p.bolts.map((r) => Math.abs(r.slot)));
  return p.bolts.map((r, i) => {
    const f = n === 1 ? 0 : n === 2 ? r.slot * 0.45 : r.slot / maxSlot;
    const ang = base + f * ((c.formSpread * Math.PI) / 180) * 0.5;
    const radius = c.boltRadius * r.size * scale;
    // The great bolt forms a little further out (it is big; it must stay clear of the face).
    const rad = aRadius * c.formRadius * (1 + 0.06 * Math.abs(f)) + (r.great ? radius * 0.35 : 0);
    const home = { x: a.x + Math.cos(ang) * rad, y: Math.max(ceilY + radius, a.y + Math.sin(ang) * rad) };
    const isLast = i === n - 1;
    const hitOff = isLast || n === 1 ? 0 : (r.slot / maxSlot) * dRadius * 0.3;
    const to = { x: d.x + nrm.x * hitOff, y: d.y + nrm.y * hitOff };
    const ax = to.x - home.x, ay = to.y - home.y;
    const al = Math.hypot(ax, ay) || 1;
    const aim = { x: ax / al, y: ay / al };
    const from = { x: home.x - aim.x * c.windupPx * scale, y: home.y - aim.y * c.windupPx * scale };
    const fl = Math.hypot(to.x - from.x, to.y - from.y) || 1;
    const side = (r.slot === 0 ? (i % 2 ? -1 : 1) : Math.sign(r.slot)) * p.arc * (r.great ? 0.4 : 1);
    const ctrl = {
      x: (from.x + to.x) / 2 + (-(to.y - from.y) / fl) * side * fl,
      y: Math.max(ceilY, (from.y + to.y) / 2 + ((to.x - from.x) / fl) * side * fl),
    };
    return {
      home, radius, formAt: r.formAt, growMs: c.growMs, pullAt: Math.max(r.formAt + Math.min(c.growMs, 200), r.launchAt - c.windupMs),
      launchAt: r.launchAt, arriveAt: r.arriveAt, from, ctrl, to, phase: i * 1.9, great: r.great,
    };
  });
}

/** The direction the blow ARRIVES from (the last bolt's heading as it lands, or the line of fire). Unit. */
export function felArrivalDir(m: BoltMotion | undefined, a: Pt, d: Pt): Pt {
  if (m) { const r = boltRot(m, 1); return { x: Math.cos(r), y: Math.sin(r) }; }
  const L = Math.hypot(d.x - a.x, d.y - a.y) || 1;
  return { x: (d.x - a.x) / L, y: (d.y - a.y) / L };
}

// ─── the chaos meteor (pure) ───────────────────────────────────────────────────────────────────────────────────

/** Tier IV's chaos meteor: it streaks from above the top of the screen (on the attacker's side) into the rune circle. */
export interface FelMeteorMotion {
  from: Pt; to: Pt;
  dir: Pt;
  startAt: number; contactAt: number;
  radius: number;
}

/** The fall: in already fast and still ACCELERATING all the way in. */
export const felMeteorEase = (u: number): number => { const t = Math.min(1, Math.max(0, Number.isFinite(u) ? u : 0)); return 0.45 * t + 0.55 * t * t; };

export function felMeteorMotion(p: FelPlan, a: Pt, d: Pt, dRadius: number, c: HeroFelConfig = cfg, ceilY = 0): FelMeteorMotion | null {
  if (p.reduced || !p.hand) return null;
  const radius = dRadius * 0.5 * c.meteorSize;
  // A steep diagonal from above the frame on the attacker's side (most of the fall on screen even for a target at the
  // very top), starting just out of view.
  const side = d.x >= a.x ? -1 : 1;
  const fromY = ceilY - radius * 1.3;
  const drop = d.y - fromY;
  const from = { x: d.x + side * clamp(drop * 0.6, dRadius * 4, dRadius * 8), y: fromY };
  const L = Math.hypot(d.x - from.x, d.y - from.y) || 1;
  return { from, to: { ...d }, dir: { x: (d.x - from.x) / L, y: (d.y - from.y) / L }, startAt: p.meteorAt, contactAt: p.impactAt, radius };
}

export function felMeteorPose(m: FelMeteorMotion, t: number): { x: number; y: number; u: number; live: boolean } {
  const u = Math.min(1, Math.max(0, (t - m.startAt) / Math.max(1, m.contactAt - m.startAt)));
  const e = felMeteorEase(u);
  return { x: m.from.x + (m.to.x - m.from.x) * e, y: m.from.y + (m.to.y - m.from.y) * e, u, live: t >= m.startAt && t < m.contactAt };
}

// ─── the camera (pure) ─────────────────────────────────────────────────────────────────────────────────────────

const springAt = (ms: number, hz: number, tau: number): number => (ms < 0 ? 0 : Math.exp(-ms / tau) * Math.cos(2 * Math.PI * hz * (ms / 1000)));

/**
 * The camera at sequence time `t`. A push in on the hero while the bolts gather; a small kick back on each release; a
 * kick ALONG the throw on each tick; on THE impact a punch in and a directional shake. Tier IV: the push eases off as the
 * rune circle opens, a rumble grows as the meteor falls, and the eruption punches hardest with a shake that rings both
 * ways. Deterministic. Pure.
 */
export function felCameraAt(p: FelPlan, c: HeroFelConfig, t: number, dir: Pt = { x: 1, y: 0 }): { zoom: number; x: number; y: number } {
  if (p.reduced) return { zoom: 1, x: 0, y: 0 };
  let z = 0;
  const sine = (u: number): number => easeInOutSine(u);
  if (t >= p.chargeAt && t < p.impactAt) {
    z += p.zoom * sine((t - p.chargeAt) / Math.max(1, p.fireAt - p.chargeAt));
    if (p.hand) {
      const lastIn = p.hits.length ? p.hits[p.hits.length - 1]! : p.fireAt;
      const from = Math.min(lastIn, p.gateAt);
      if (t >= from) z -= p.zoom * 0.6 * sine((t - from) / Math.max(1, p.meteorAt - from));
      if (t >= p.meteorAt) z += p.zoom * 1.3 * sine((t - p.meteorAt) / Math.max(1, p.impactAt - p.meteorAt));
    }
  } else if (t >= p.impactAt) {
    const since = t - p.impactAt;
    z += (p.zoom * (p.hand ? 2.1 : 1) + p.punch) * Math.exp(-since / Math.max(1, c.zoomOutMs / 4));
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
  p.bolts.forEach((r) => kick(r.launchAt, -p.shakePx * 0.12, 45, 14, dir));
  p.hits.forEach((at, i) => kick(at, p.shakePx * (0.24 + 0.04 * i) * (p.hand ? 0.8 : 1), 45, 17, dir));
  if (p.hand) {
    kick(p.gateAt, p.shakePx * 0.18, 60, 12, { x: 0, y: 1 });
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
 * Where the camera anchors: the ATTACKER while the bolts gather, following the volley in flight, the DEFENDER from the
 * impact on. Tier IV: half way back for the rune circle (both heroes in frame), then down onto the target with the meteor.
 */
export function felCameraFocus(p: FelPlan, t: number, a: Pt, d: Pt): Pt {
  const lerp = (e: number): Pt => ({ x: a.x + (d.x - a.x) * e, y: a.y + (d.y - a.y) * e });
  if (t <= p.fireAt) return a;
  if (!p.hand) {
    if (t >= p.impactAt) return d;
    return lerp(boltEase((t - p.fireAt) / Math.max(1, p.impactAt - p.fireAt)));
  }
  if (t >= p.impactAt) return d;
  const lastIn = p.hits.length ? p.hits[p.hits.length - 1]! : p.fireAt;
  const back = Math.min(lastIn, p.gateAt);
  if (t < back) return lerp(boltEase((t - p.fireAt) / Math.max(1, back - p.fireAt)));
  if (t < p.meteorAt) return lerp(1 - 0.35 * easeInOutSine((t - back) / Math.max(1, p.meteorAt - back)));
  return lerp(0.65 + 0.35 * felMeteorEase((t - p.meteorAt) / Math.max(1, p.impactAt - p.meteorAt)));
}
