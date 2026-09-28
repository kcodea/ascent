/**
 * THE PHANTOM BLADES HERO ATTACK: its tuned values, its pure timeline, the pure blade poses and the pure camera.
 *
 * Owner 2026-09-28: "branch off and make a new style animation and surprise me with it. arcana is top tier good. use
 * that as your benchmark for quality. make it unique". The fourth style, and a different motion language from the
 * other three: Blast throws energy, Quake breaks the ground, Arcana lobs soft curving light. Phantom Blades are SOLID,
 * RIGID and STRAIGHT: spectral swords that are summoned, raised, turned to aim, held still for a beat, and then loosed
 * in dead-straight lines that stab into the target, stick there quivering, and finally shatter.
 *
 * THE BEATS (base ms before the playback speed):
 *  1. COMBINE (shared, `../heroAttack/combineNumbers.ts`): the Tier and every surviving Minion fly into ONE total that
 *     ticks up and slams on the ENGINE's number.
 *  2. SUMMON. The total dives into the attacking hero; spectral swords unfurl one by one on an arc around the portrait,
 *     each pointing at the sky (a crown of raised blades).
 *  3. AIM. Every blade swings round to point at the target (a snappy turn with a little overshoot) and LOCKS: a glint
 *     runs off each tip and the view holds for a breath (the anticipation).
 *  4. LOOSE. Each blade kicks back a few px and then thrusts in a straight line, fast, leaving ghost afterimages and a
 *     thin cut of light: I one blade; II two that cross in an X; III a fan of five that hammer in, in rhythm.
 *  5. STAB. Each blade that lands before the last STICKS in the portrait (a spark spray and a cut flash) and quivers.
 *     The LAST one is THE impact: the hit-stop, the big `-N`, a cross-cut flash. The consequence (the damage, Armor,
 *     Resolve) lands ONCE, there. A beat later every stuck blade SHATTERS into shards.
 *  IV. JUDGEMENT. Six blades hammer in as ticks, then a GREATSWORD is summoned over the hero, raised, swung round to
 *     aim, and held trembling while the stuck blades are bound to it by beams of light and a reticle locks onto the
 *     target. Then it is loosed: a huge straight thrust that impales the target (THE impact), and a beat later the
 *     greatsword and every blade shatter together, with a pillar of light and a shockwave.
 *
 * TIERS are the shared, owner-approved thresholds (I 1-5, II 6-11, III 12-19, IV 20+). About 2 s at Tier I, about
 * 4 s at Tier IV. Reduced motion: no blades, shake, zoom or hit-stop; the numbers fade and the blow lands.
 *
 * Tuner convention (the Blast's): localStorage in DEV only, values clamped on write and on load; production always
 * plays DEFAULTS. The preview speed is how you are LOOKING and is never saved.
 */
import { clamp, easeInOutSine, easeOutBack, easeOutCubic, hexToNum, spring, type Pt } from '../heroAttack/easing';
import {
  HERO_ATTACK_TIER_THRESHOLDS, TIERS, combineCounts, combineTimeline, reducedCombineTimeline, tierOf, type TierNum,
} from '../heroAttack/tiers';

export { TIERS, hexToNum, type TierNum };

/** The per-tier dials. A config key is `t1..t4` + one of these. */
export const BLADES_TIER_SUFFIXES = [
  'FlyMs', 'StaggerMs', 'SlamPop', 'HoldMs',
  'Blades', 'SummonStaggerMs', 'AimHoldMs', 'LooseStaggerMs', 'FlightMs', 'Spread', 'FormRadius', 'BladeSize', 'Scatter', 'Great',
  'HitStop', 'Shake', 'Zoom', 'Punch', 'Shards', 'Burst', 'SettleMs', 'Dim',
] as const;
export type BladesTierSuffix = (typeof BLADES_TIER_SUFFIXES)[number];
type TierKey = `t${TierNum}${BladesTierSuffix}`;

interface GlobalConfig {
  // Tiers (the shared thresholds; DEV-tunable only)
  tier2At: number; tier3At: number; tier4At: number;
  // Combine (the shared beat)
  popInMs: number;
  combineBackPx: number;
  combineArc: number;
  combineBias: number;
  chipSize: number;
  totalSize: number;
  tickPop: number;
  slamMs: number;
  // Summon and aim
  absorbMs: number;
  heroSwell: number;
  recoilPx: number;
  manifestMs: number;
  aimMs: number;
  lockMs: number;
  // Loose
  pullMs: number;
  pullPx: number;
  // The blades' look
  bladeLength: number;
  glow: number;
  edge: number;
  outline: number;
  ghosts: number;
  ghostGapMs: number;
  cutLine: number;
  quiver: number;
  // Shatter
  shatterDelayMs: number;
  // The greatsword (Tier IV)
  greatSize: number;
  greatForm: number;
  greatManifestMs: number;
  greatAimMs: number;
  greatHangMs: number;
  greatPullMs: number;
  greatFlight: number;
  bindBeams: number;
  // Camera and portraits
  knockPx: number;
  squash: number;
  shakeMs: number;
  zoomOutMs: number;
  reducedFadeMs: number;
  // Colours
  colorCore: string;
  colorEdge: string;
  colorPlayer: string;
  colorFoe: string;
  colorHilt: string;
  colorShade: string;
  // Sound: a clip, a gain and a pitch per cue ('' = silent)
  sfxGatherClip: string; sfxGatherGain: number;
  sfxTickClip: string; sfxTickGain: number; sfxTickRate: number; sfxTickStep: number;
  sfxSlamClip: string; sfxSlamGain: number; sfxSlamRate: number;
  sfxSummonClip: string; sfxSummonGain: number; sfxSummonRate: number; sfxSummonStep: number;
  sfxRingClip: string; sfxRingGain: number; sfxRingRate: number;
  sfxAimClip: string; sfxAimGain: number; sfxAimRate: number;
  sfxLockClip: string; sfxLockGain: number; sfxLockRate: number;
  sfxLooseClip: string; sfxLooseGain: number; sfxLooseRate: number; sfxLooseStep: number;
  sfxCrackClip: string; sfxCrackGain: number; sfxCrackRate: number;
  sfxStabClip: string; sfxStabGain: number; sfxStabRate: number;
  sfxClangClip: string; sfxClangGain: number; sfxClangRate: number;
  sfxImpactClip: string; sfxImpactGain: number; sfxImpactRate: number;
  sfxBigClip: string; sfxBigGain: number; sfxBigRate: number;
  sfxThumpClip: string; sfxThumpGain: number; sfxThumpRate: number;
  sfxShatterClip: string; sfxShatterGain: number; sfxShatterRate: number;
  sfxGreatClip: string; sfxGreatGain: number; sfxGreatRate: number;
  sfxSlamDownClip: string; sfxSlamDownGain: number; sfxSlamDownRate: number;
  sfxBoomClip: string; sfxBoomGain: number; sfxBoomRate: number;
  sfxHumGain: number; sfxHumHz: number; sfxHumRise: number;
  sfxTickLenMs: number;
  sfxLooseLenMs: number;
  sfxImpactLenMs: number;
  sfxTailMix: number;
  sfxDuck: number;
  // Preview only (the tuner's Play buttons). Never read by a real fight, and left out of Copy JSON.
  previewDamage: number;
  previewParts: number;
}
export type HeroBladesConfig = GlobalConfig & Record<TierKey, number>;

export const HERO_BLADES_COLOR_KEYS = ['colorCore', 'colorEdge', 'colorPlayer', 'colorFoe', 'colorHilt', 'colorShade'] as const;
export const HERO_BLADES_CLIP_KEYS = [
  'sfxGatherClip', 'sfxTickClip', 'sfxSlamClip', 'sfxSummonClip', 'sfxRingClip', 'sfxAimClip', 'sfxLockClip', 'sfxLooseClip',
  'sfxCrackClip', 'sfxStabClip', 'sfxClangClip', 'sfxImpactClip', 'sfxBigClip', 'sfxThumpClip', 'sfxShatterClip', 'sfxGreatClip',
  'sfxSlamDownClip', 'sfxBoomClip',
] as const;
type ColorKey = (typeof HERO_BLADES_COLOR_KEYS)[number];
type ClipKey = (typeof HERO_BLADES_CLIP_KEYS)[number];
export type HeroBladesStrKey = ColorKey | ClipKey;
export type HeroBladesNumKey = Exclude<keyof HeroBladesConfig, HeroBladesStrKey>;

/** Tier I .. IV per suffix: the escalation ladder. */
const TIER_DEFAULTS: Record<BladesTierSuffix, [number, number, number, number]> = {
  FlyMs: [300, 330, 360, 380],
  StaggerMs: [95, 100, 105, 110],
  SlamPop: [1.4, 1.55, 1.75, 2],
  HoldMs: [120, 190, 240, 260],
  Blades: [1, 2, 5, 6],
  SummonStaggerMs: [0, 70, 55, 40],
  AimHoldMs: [30, 50, 60, 20],
  LooseStaggerMs: [0, 120, 95, 65],
  FlightMs: [250, 250, 240, 220],
  Spread: [0, 46, 108, 150],
  FormRadius: [1.45, 1.5, 1.6, 1.65],
  BladeSize: [1.12, 1.05, 0.9, 0.82],
  Scatter: [0.05, 0.28, 0.4, 0.46],
  Great: [0, 0, 0, 1],
  HitStop: [60, 75, 95, 150],
  Shake: [5, 8, 12, 22],
  Zoom: [0.02, 0.03, 0.045, 0.07],
  Punch: [0.02, 0.028, 0.038, 0.065],
  Shards: [10, 9, 8, 10],
  Burst: [1, 1.15, 1.35, 1.9],
  SettleMs: [200, 260, 320, 240],
  Dim: [0, 0.18, 0.32, 0.5],
};

export const BLADES_TIER_RANGES: Record<BladesTierSuffix, [number, number, number]> = {
  FlyMs: [120, 900, 10],
  StaggerMs: [0, 300, 5],
  SlamPop: [1, 3, 0.01],
  HoldMs: [0, 1000, 10],
  Blades: [1, 8, 1],
  SummonStaggerMs: [0, 300, 5],
  AimHoldMs: [0, 600, 10],
  LooseStaggerMs: [0, 400, 5],
  FlightMs: [120, 900, 10],
  Spread: [0, 200, 1],
  FormRadius: [0.8, 3, 0.05],
  BladeSize: [0.4, 2, 0.01],
  Scatter: [0, 0.9, 0.01],
  Great: [0, 1, 1],
  HitStop: [0, 250, 5],
  Shake: [0, 40, 0.5],
  Zoom: [0, 0.14, 0.002],
  Punch: [0, 0.1, 0.001],
  Shards: [0, 20, 1],
  Burst: [0.3, 3, 0.05],
  SettleMs: [0, 1600, 10],
  Dim: [0, 0.8, 0.01],
};

const tierDefaults = Object.fromEntries(TIERS.flatMap((t) => BLADES_TIER_SUFFIXES.map((s) => [`t${t}${s}`, TIER_DEFAULTS[s][t - 1]]))) as Record<TierKey, number>;

export const HERO_BLADES_DEFAULTS: HeroBladesConfig = {
  // The shared, owner-approved thresholds (6 / 12 / 20): the same blow steps the Blades up exactly where it steps the
  // Blast, the Quake and the Arcana up.
  ...HERO_ATTACK_TIER_THRESHOLDS,
  popInMs: 140,
  combineBackPx: 24,
  combineArc: 0.14,
  combineBias: 0,
  chipSize: 52,
  totalSize: 132,
  tickPop: 0.26,
  slamMs: 340,
  absorbMs: 170,
  heroSwell: 0.07,
  recoilPx: 9,
  manifestMs: 180,
  aimMs: 170,
  lockMs: 75,
  pullMs: 75,
  pullPx: 22,
  bladeLength: 230,
  glow: 0.85,
  edge: 1,
  outline: 0.55,
  ghosts: 3,
  ghostGapMs: 26,
  cutLine: 0.9,
  quiver: 7,
  shatterDelayMs: 130,
  greatSize: 2.1,
  greatForm: 2.1,
  greatManifestMs: 280,
  greatAimMs: 210,
  greatHangMs: 220,
  greatPullMs: 110,
  greatFlight: 0.95,
  bindBeams: 0.8,
  knockPx: 20,
  squash: 0.1,
  shakeMs: 340,
  zoomOutMs: 380,
  reducedFadeMs: 260,
  colorCore: '#ffffff',
  colorEdge: '#c9f6ff',
  colorPlayer: '#3fb8ff',
  colorFoe: '#ff4468',
  colorHilt: '#ffc85a',
  colorShade: '#0a2240',
  sfxGatherClip: 'TallyTravel', sfxGatherGain: 0.45,
  sfxTickClip: 'AttackPillAdd', sfxTickGain: 0.6, sfxTickRate: 0.9, sfxTickStep: 0.07,
  sfxSlamClip: 'tallyimpact', sfxSlamGain: 0.9, sfxSlamRate: 1.05,
  sfxSummonClip: 'equipmentsheen', sfxSummonGain: 1.2, sfxSummonRate: 1.25, sfxSummonStep: 0.06,
  sfxRingClip: 'equipclang', sfxRingGain: 0.2, sfxRingRate: 1.7,
  sfxAimClip: 'fx/metal-woosh', sfxAimGain: 0.35, sfxAimRate: 1.35,
  sfxLockClip: 'equipclang', sfxLockGain: 0.3, sfxLockRate: 2,
  sfxLooseClip: 'fx/metal-woosh', sfxLooseGain: 0.5, sfxLooseRate: 1.05, sfxLooseStep: 0.06,
  sfxCrackClip: 'fx/universfield-whip-snap-242215', sfxCrackGain: 0.35, sfxCrackRate: 1.25,
  sfxStabClip: 'flurryhit', sfxStabGain: 0.55, sfxStabRate: 1.1,
  sfxClangClip: 'equipclang', sfxClangGain: 0.3, sfxClangRate: 1.3,
  sfxImpactClip: 'cleave2', sfxImpactGain: 0.8, sfxImpactRate: 1,
  sfxBigClip: 'crit', sfxBigGain: 0.4, sfxBigRate: 1.05,
  sfxThumpClip: 'smack2', sfxThumpGain: 0.45, sfxThumpRate: 0.85,
  sfxShatterClip: 'rebornshatter', sfxShatterGain: 0.55, sfxShatterRate: 1.15,
  sfxGreatClip: 'fx/universfield-cinematic-swoosh-impact-454392', sfxGreatGain: 0.55, sfxGreatRate: 1,
  sfxSlamDownClip: 'titanhammer', sfxSlamDownGain: 0.7, sfxSlamDownRate: 1.1,
  sfxBoomClip: 'fx/triple-impact', sfxBoomGain: 0.28, sfxBoomRate: 1.3,
  sfxHumGain: 0.3, sfxHumHz: 220, sfxHumRise: 1.6,
  sfxTickLenMs: 420,
  sfxLooseLenMs: 520,
  sfxImpactLenMs: 1100,
  sfxTailMix: 0.14,
  sfxDuck: 0.5,
  previewDamage: 12,
  previewParts: 4,
  ...tierDefaults,
};

const GLOBAL_RANGES: Record<Exclude<keyof GlobalConfig, HeroBladesStrKey>, [number, number, number]> = {
  tier2At: [2, 40, 1], tier3At: [2, 60, 1], tier4At: [2, 80, 1],
  popInMs: [0, 500, 10],
  combineBackPx: [0, 80, 1],
  combineArc: [0, 0.5, 0.01],
  combineBias: [0, 1, 0.05],
  chipSize: [20, 110, 1],
  totalSize: [50, 220, 1],
  tickPop: [0, 0.8, 0.01],
  slamMs: [80, 900, 10],
  absorbMs: [60, 600, 10],
  heroSwell: [0, 0.3, 0.01],
  recoilPx: [0, 60, 1],
  manifestMs: [60, 800, 10],
  aimMs: [60, 800, 10],
  lockMs: [0, 600, 10],
  pullMs: [0, 300, 5],
  pullPx: [0, 80, 1],
  bladeLength: [80, 400, 5],
  glow: [0, 2, 0.05],
  edge: [0, 1.5, 0.05],
  outline: [0, 1, 0.01],
  ghosts: [0, 5, 1],
  ghostGapMs: [4, 60, 1],
  cutLine: [0, 1, 0.01],
  quiver: [0, 25, 0.5],
  shatterDelayMs: [0, 600, 10],
  greatSize: [1, 4, 0.05],
  greatForm: [1, 4, 0.05],
  greatManifestMs: [80, 1200, 10],
  greatAimMs: [60, 1000, 10],
  greatHangMs: [0, 1200, 10],
  greatPullMs: [0, 400, 5],
  greatFlight: [0.4, 2.5, 0.05],
  bindBeams: [0, 1, 0.01],
  knockPx: [0, 60, 1],
  squash: [0, 0.3, 0.01],
  shakeMs: [0, 1200, 10],
  zoomOutMs: [60, 1500, 10],
  reducedFadeMs: [60, 1000, 10],
  sfxGatherGain: [0, 2, 0.05],
  sfxTickGain: [0, 2, 0.05], sfxTickRate: [0.5, 2, 0.01], sfxTickStep: [0, 0.3, 0.005],
  sfxSlamGain: [0, 2, 0.05], sfxSlamRate: [0.5, 2, 0.01],
  sfxSummonGain: [0, 2, 0.05], sfxSummonRate: [0.5, 2.5, 0.01], sfxSummonStep: [0, 0.3, 0.005],
  sfxRingGain: [0, 2, 0.05], sfxRingRate: [0.5, 2.5, 0.01],
  sfxAimGain: [0, 2, 0.05], sfxAimRate: [0.5, 2.5, 0.01],
  sfxLockGain: [0, 2, 0.05], sfxLockRate: [0.5, 2.5, 0.01],
  sfxLooseGain: [0, 2, 0.05], sfxLooseRate: [0.5, 2.5, 0.01], sfxLooseStep: [0, 0.3, 0.005],
  sfxCrackGain: [0, 2, 0.05], sfxCrackRate: [0.5, 2.5, 0.01],
  sfxStabGain: [0, 2, 0.05], sfxStabRate: [0.5, 2.5, 0.01],
  sfxClangGain: [0, 2, 0.05], sfxClangRate: [0.5, 2.5, 0.01],
  sfxImpactGain: [0, 2, 0.05], sfxImpactRate: [0.5, 2, 0.01],
  sfxBigGain: [0, 2, 0.05], sfxBigRate: [0.5, 2, 0.01],
  sfxThumpGain: [0, 2, 0.05], sfxThumpRate: [0.5, 2, 0.01],
  sfxShatterGain: [0, 2, 0.05], sfxShatterRate: [0.5, 2.5, 0.01],
  sfxGreatGain: [0, 2, 0.05], sfxGreatRate: [0.5, 2, 0.01],
  sfxSlamDownGain: [0, 2, 0.05], sfxSlamDownRate: [0.5, 2, 0.01],
  sfxBoomGain: [0, 2, 0.05], sfxBoomRate: [0.5, 2, 0.01],
  sfxHumGain: [0, 2, 0.05], sfxHumHz: [60, 1200, 5], sfxHumRise: [1, 4, 0.05],
  sfxTickLenMs: [80, 2000, 10],
  sfxLooseLenMs: [100, 2500, 10],
  sfxImpactLenMs: [150, 3500, 10],
  sfxTailMix: [0, 0.6, 0.01],
  sfxDuck: [0, 1, 0.05],
  previewDamage: [1, 60, 1],
  previewParts: [1, 8, 1],
};

/** [min, max, step] per numeric key. Values outside are clamped on write AND on load. */
export const HERO_BLADES_RANGES: Record<HeroBladesNumKey, [number, number, number]> = {
  ...GLOBAL_RANGES,
  ...(Object.fromEntries(TIERS.flatMap((t) => BLADES_TIER_SUFFIXES.map((s) => [`t${t}${s}`, BLADES_TIER_RANGES[s]]))) as Record<TierKey, [number, number, number]>),
};

/** The hard ceilings a plan can never exceed, whatever the sliders say (so a 40 stays clean, not cluttered). */
export const BLADES_CAPS = { blades: 8, shards: 20, hitStopMs: 250, shakePx: 40, zoom: 0.14 } as const;

const HEX = /^#[0-9a-f]{6}$/i;
const isColorKey = (k: string): k is ColorKey => (HERO_BLADES_COLOR_KEYS as readonly string[]).includes(k);
const isClipKey = (k: string): k is ClipKey => (HERO_BLADES_CLIP_KEYS as readonly string[]).includes(k);

/** One value, made safe: numbers clamped into range (junk = the default), colours #rrggbb, clips a short string. */
export function clampHeroBladesValue<K extends keyof HeroBladesConfig>(key: K, value: unknown): HeroBladesConfig[K] | undefined {
  if (!Object.prototype.hasOwnProperty.call(HERO_BLADES_DEFAULTS, key)) return undefined;
  const def = HERO_BLADES_DEFAULTS[key];
  if (isColorKey(key)) {
    if (typeof value !== 'string') return def;
    const v = value.trim();
    return (HEX.test(v) ? v.toLowerCase() : def) as HeroBladesConfig[K];
  }
  if (isClipKey(key)) return (typeof value === 'string' ? value.trim().slice(0, 160) : def) as HeroBladesConfig[K];
  const n = typeof value === 'number' ? value : Number(value);
  if (typeof value === 'boolean' || value === null || value === '' || !Number.isFinite(n)) return def;
  const [min, max] = HERO_BLADES_RANGES[key as HeroBladesNumKey];
  return Math.min(max, Math.max(min, n)) as HeroBladesConfig[K];
}

/** A whole saved object, sanitised key by key over the defaults (junk and unknown keys dropped). */
export function sanitizeHeroBladesConfig(saved: unknown): HeroBladesConfig {
  const out: HeroBladesConfig = { ...HERO_BLADES_DEFAULTS };
  if (!saved || typeof saved !== 'object') return out;
  for (const [k, v] of Object.entries(saved as Record<string, unknown>)) {
    const safe = clampHeroBladesValue(k as keyof HeroBladesConfig, v);
    if (safe !== undefined) (out as unknown as Record<string, unknown>)[k] = safe;
  }
  return out;
}

const KEY = 'ascent.heroblades.v1';

let cfg: HeroBladesConfig = (() => {
  if (!import.meta.env.DEV || typeof localStorage === 'undefined') return { ...HERO_BLADES_DEFAULTS };
  try { return sanitizeHeroBladesConfig(JSON.parse(localStorage.getItem(KEY) ?? '{}')); } catch { return { ...HERO_BLADES_DEFAULTS }; }
})();

export function getHeroBladesConfig(): HeroBladesConfig { return cfg; }

export function setHeroBladesValue(key: keyof HeroBladesConfig, value: number | string): void {
  const safe = clampHeroBladesValue(key, value);
  if (safe === undefined) return;
  cfg = { ...cfg, [key]: safe };
  if (!import.meta.env.DEV) return;
  try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch { /* ignore */ }
}

export function resetHeroBladesConfig(): void {
  cfg = { ...HERO_BLADES_DEFAULTS };
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}

/** The tuned values as JSON for pasting back into DEFAULTS (the preview-only keys left out). */
export function heroBladesConfigJson(c: HeroBladesConfig = cfg): string {
  const ship: Partial<HeroBladesConfig> = { ...c };
  delete ship.previewDamage;
  delete ship.previewParts;
  return JSON.stringify(ship, null, 2);
}

// ─── the preview speed (DEV only, never saved) ─────────────────────────────────────────────────────────────────

export const HERO_BLADES_SPEEDS = [1, 0.5, 0.25] as const;
export type HeroBladesSpeed = (typeof HERO_BLADES_SPEEDS)[number];
let speed: HeroBladesSpeed = 1;
/** The tuner's slow motion. Always 1 in production. */
export function heroBladesPreviewSpeed(): HeroBladesSpeed { return import.meta.env.DEV ? speed : 1; }
export function setHeroBladesPreviewSpeed(s: HeroBladesSpeed): void { speed = s; }

// ─── the pure plan ─────────────────────────────────────────────────────────────────────────────────────────────

/** One tier's dials, read out of the config. */
export function bladesTierDials(tier: TierNum, c: HeroBladesConfig = cfg): Record<BladesTierSuffix, number> {
  return Object.fromEntries(BLADES_TIER_SUFFIXES.map((s) => [s, c[`t${tier}${s}`]])) as Record<BladesTierSuffix, number>;
}

/** The reference distance the per-tier flight times are tuned at (a 1080p board, corner to corner). */
export const BLADES_REF_DISTANCE = 1600;

/** A blade's flight for a distance: the tier's time, scaled gently by the distance (a sandbox box stays readable). */
export function bladeFlightMs(distance: number, tierMs: number): number {
  const d = Number.isFinite(distance) && distance > 0 ? distance : BLADES_REF_DISTANCE;
  return Math.round(tierMs * clamp(Math.sqrt(d / BLADES_REF_DISTANCE), 0.62, 1.15));
}

/**
 * The formation, in LOOSE order: outer blades first, the centre one last (the volley closes in, and the last to land,
 * THE impact, is the biggest). Signed slots: 0 = the centre of the arc.
 */
export function bladeSlots(n: number): number[] {
  if (n <= 1) return [0];
  if (n === 2) return [-1, 1];
  const out: number[] = [];
  const half = Math.floor(n / 2);
  if (n % 2 === 0) {
    // Even: symmetric half-slots (-2.5 .. 2.5 for six), outer pairs first.
    for (let k = half; k >= 1; k--) { out.push(-(k - 0.5)); out.push(k - 0.5); }
    return out;
  }
  for (let k = half; k >= 1; k--) { out.push(-k); out.push(k); }
  out.push(0);
  return out;
}

export interface BladePlan {
  /** Sequence ms: the blade starts to unfurl. */
  manifestAt: number;
  /** It starts to swing round to aim. */
  aimAt: number;
  /** It starts its kick back (the flight follows `pullMs` later). */
  launchAt: number;
  flightMs: number;
  /** Its tip goes in. */
  arriveAt: number;
  /** Signed slot on the arc (0 = the centre). */
  slot: number;
  /** Size multiplier (the last is the biggest). */
  size: number;
  /** True for Tier IV's greatsword. */
  great: boolean;
}

export interface BladesPlanInput {
  /** Each contributing number, in the order they fly (the attacker's tier first). */
  values: readonly number[];
  /** THE blow, as the engine decided it. The combine always ends on exactly this. */
  total: number;
  /** Screen px between the attacker's and the defender's centres. */
  distance: number;
  reduced?: boolean;
}

export interface BladesPlan {
  reduced: boolean;
  tier: TierNum;
  /** 0..1 across the tiers (I = 0, IV = 1). */
  k: number;
  total: number;
  capped: boolean;
  spawns: number[];
  launches: number[];
  arrivals: number[];
  counts: number[];
  mergeAt: number;
  slamPop: number;
  /** The total dives into the hero; the summoning starts. */
  chargeAt: number;
  absorbEnd: number;
  /** The first blade looses (the camera's hand-off from the hero to the flight). */
  fireAt: number;
  /** The small blades, in loose order (Tier IV's greatsword is NOT in here: see `great`). */
  blades: BladePlan[];
  /** Tier IV: the greatsword. */
  great: BladePlan | null;
  /** Tier IV: the greatsword starts to hang (aimed, trembling) and the binding beams light. */
  hangAt: number;
  /** Blades that land BEFORE the impact, sequence ms: the rhythm ticks. */
  hits: number[];
  /** THE consequence beat: the last blade (I-III) or the greatsword (IV) goes in. */
  impactAt: number;
  /** Everything stuck in the target shatters. */
  shatterAt: number;
  hitStopMs: number;
  /** Aftershocks round the target (IV). */
  booms: number[];
  endAt: number;
  spread: number;
  formRadius: number;
  scatter: number;
  shakePx: number;
  zoom: number;
  punch: number;
  shards: number;
  burst: number;
  dim: number;
}

/** The whole Phantom Blades, in base ms (divide by the playback speed for real time). Pure and deterministic. */
export function bladesPlan(input: BladesPlanInput, c: HeroBladesConfig = cfg): BladesPlan {
  const total = Math.max(0, Math.round(input.total));
  const values = input.values.filter((v) => Number.isFinite(v));
  const rawSum = values.reduce((s, v) => s + Math.max(0, v), 0);
  const tier = tierOf(total, c);
  const T = bladesTierDials(tier, c);
  const k = (tier - 1) / 3;
  const counts = combineCounts(values, total);
  const capped = rawSum > total;
  const nParts = values.length;

  if (input.reduced) {
    const r = reducedCombineTimeline(nParts, c.reducedFadeMs);
    const { arrivals, mergeAt, impactAt } = r;
    return {
      reduced: true, tier, k, total, capped, spawns: r.spawns, launches: arrivals.slice(), arrivals, counts, mergeAt, slamPop: 1,
      chargeAt: impactAt, absorbEnd: impactAt, fireAt: impactAt, blades: [], great: null, hangAt: impactAt, hits: [], impactAt,
      shatterAt: impactAt, hitStopMs: 0, booms: [], endAt: r.endAt, spread: 0, formRadius: 0, scatter: 0, shakePx: 0, zoom: 0,
      punch: 0, shards: 0, burst: 0, dim: 0,
    };
  }

  const { spawns, launches, arrivals, mergeAt, holdEnd: chargeAt } = combineTimeline(nParts, T, c.popInMs);
  const absorbEnd = chargeAt + c.absorbMs;
  const count = clamp(Math.round(T.Blades), 1, BLADES_CAPS.blades);
  const withGreat = T.Great >= 1;
  const flight = bladeFlightMs(input.distance, T.FlightMs);
  const slots = bladeSlots(count);
  const summon0 = chargeAt + c.absorbMs * 0.6;
  const lastManifestEnd = summon0 + (count - 1) * T.SummonStaggerMs + c.manifestMs;
  const aimAt = lastManifestEnd + T.AimHoldMs;
  const loose0 = aimAt + c.aimMs + c.lockMs;
  const blades: BladePlan[] = slots.map((slot, i) => {
    const launchAt = loose0 + i * T.LooseStaggerMs;
    const last = i === count - 1;
    // Outer blades fly a touch further (they cross over): a hair more time, so the centre still lands last.
    const fl = Math.round(flight * (1 + 0.04 * Math.abs(slot)));
    return {
      manifestAt: summon0 + i * T.SummonStaggerMs, aimAt, launchAt, flightMs: fl, arriveAt: launchAt + c.pullMs + fl, slot,
      size: last && !withGreat && count > 1 ? 1.14 : 1, great: false,
    };
  });
  // Keep the loose order's rhythm on arrival: each lands at least `gap` after the one before (III's hammering).
  const gap = count > 2 ? Math.max(55, T.LooseStaggerMs * 0.8) : 0;
  for (let i = 1; i < blades.length; i++) {
    const b = blades[i]!, prev = blades[i - 1]!;
    if (gap && b.arriveAt < prev.arriveAt + gap) { b.flightMs += prev.arriveAt + gap - b.arriveAt; b.arriveAt = b.launchAt + c.pullMs + b.flightMs; }
  }
  const lastIn = Math.max(...blades.map((b) => b.arriveAt));
  const lastLaunch = blades[blades.length - 1]!.launchAt;
  let great: BladePlan | null = null;
  let hangAt = lastIn;
  let impactAt = lastIn;
  if (withGreat) {
    // The greatsword unfurls while the volley is still leaving, and swings to aim once the last small blade is away.
    const manifestAt = loose0 + Math.min(2, count - 1) * T.LooseStaggerMs;
    const gAim = Math.max(manifestAt + c.greatManifestMs, lastLaunch + c.pullMs);
    hangAt = gAim + c.greatAimMs;
    const gLaunch = hangAt + c.greatHangMs;
    const gFlight = Math.round(flight * c.greatFlight);
    const arrive = Math.max(gLaunch + c.greatPullMs + gFlight, lastIn + 240);
    great = {
      manifestAt, aimAt: gAim, launchAt: arrive - gFlight - c.greatPullMs, flightMs: gFlight, arriveAt: arrive, slot: 0, size: 1, great: true,
    };
    impactAt = arrive;
  }
  const hits = blades.map((b) => b.arriveAt).filter((at) => at < impactAt).sort((a, b) => a - b);
  const shatterAt = impactAt + c.shatterDelayMs;
  const booms = withGreat ? [shatterAt + 120, shatterAt + 240] : [];
  const lastBeat = Math.max(
    shatterAt + 200,
    booms.length ? booms[booms.length - 1]! + 120 : 0,
    impactAt + c.zoomOutMs * 0.8,
  );
  const endAt = lastBeat + T.SettleMs;

  return {
    reduced: false, tier, k, total, capped, spawns, launches, arrivals, counts, mergeAt, slamPop: T.SlamPop, chargeAt, absorbEnd,
    fireAt: blades[0]!.launchAt, blades, great, hangAt, hits, impactAt, shatterAt,
    hitStopMs: Math.round(clamp(T.HitStop, 0, BLADES_CAPS.hitStopMs)), booms, endAt,
    spread: T.Spread, formRadius: T.FormRadius, scatter: T.Scatter,
    shakePx: clamp(T.Shake, 0, BLADES_CAPS.shakePx),
    zoom: clamp(T.Zoom, 0, BLADES_CAPS.zoom),
    punch: T.Punch,
    shards: Math.round(clamp(T.Shards, 0, BLADES_CAPS.shards)),
    burst: T.Burst,
    dim: T.Dim,
  };
}

export type BladesCueKind =
  | 'spawn' | 'launch' | 'arrive' | 'merge' | 'charge' | 'summon' | 'aim' | 'lock' | 'loose' | 'hit'
  | 'great' | 'greatAim' | 'hang' | 'greatLoose' | 'impact' | 'shatter' | 'boom' | 'end';
export interface BladesCue { at: number; kind: BladesCueKind; i: number }

/** Every beat the runner fires, in time order (ties keep this declaration order, so a hit precedes the impact). */
export function bladesCues(p: BladesPlan, c: HeroBladesConfig = cfg): BladesCue[] {
  const out: BladesCue[] = [];
  p.spawns.forEach((at, i) => out.push({ at, kind: 'spawn', i }));
  if (!p.reduced) p.launches.forEach((at, i) => out.push({ at, kind: 'launch', i }));
  p.arrivals.forEach((at, i) => out.push({ at, kind: 'arrive', i }));
  out.push({ at: p.mergeAt, kind: 'merge', i: 0 });
  if (!p.reduced) {
    out.push({ at: p.chargeAt, kind: 'charge', i: 0 });
    p.blades.forEach((b, i) => out.push({ at: b.manifestAt, kind: 'summon', i }));
    const b0 = p.blades[0]!;
    out.push({ at: b0.aimAt, kind: 'aim', i: 0 });
    out.push({ at: b0.aimAt + c.aimMs, kind: 'lock', i: 0 });
    p.blades.forEach((b, i) => out.push({ at: b.launchAt + c.pullMs, kind: 'loose', i }));
    // Every blade but the last lands as a tick; with a greatsword, EVERY small blade is a tick.
    p.blades.forEach((b, i) => { if (p.great || i < p.blades.length - 1) out.push({ at: b.arriveAt, kind: 'hit', i }); });
    if (p.great) {
      out.push({ at: p.great.manifestAt, kind: 'great', i: 0 });
      out.push({ at: p.great.aimAt, kind: 'greatAim', i: 0 });
      out.push({ at: p.hangAt, kind: 'hang', i: 0 });
      out.push({ at: p.great.launchAt + c.greatPullMs, kind: 'greatLoose', i: 0 });
    }
  }
  out.push({ at: p.impactAt, kind: 'impact', i: 0 });
  if (!p.reduced) out.push({ at: p.shatterAt, kind: 'shatter', i: 0 });
  p.booms.forEach((at, i) => out.push({ at, kind: 'boom', i }));
  out.push({ at: p.endAt, kind: 'end', i: 0 });
  const order: Record<BladesCueKind, number> = {
    spawn: 0, launch: 1, arrive: 2, merge: 3, charge: 4, summon: 5, aim: 6, lock: 7, loose: 8, hit: 9, great: 10, greatAim: 11,
    hang: 12, greatLoose: 13, impact: 14, shatter: 15, boom: 16, end: 17,
  };
  return out.map((q, idx) => ({ q, idx })).sort((a, b) => a.q.at - b.q.at || order[a.q.kind] - order[b.q.kind] || a.idx - b.idx).map((x) => x.q);
}

// ─── the blade poses (pure) ────────────────────────────────────────────────────────────────────────────────────

/** The on-screen box the formation is kept inside (screen px, or the sandbox box's own px). */
export interface Bounds { x0: number; y0: number; x1: number; y1: number }

/**
 * One blade's whole life, as pure data: where it hovers, where it points before and after the aim, where its TIP goes
 * in, and when each phase starts (ms after it starts to unfurl). The scene draws it by sampling `bladePose`.
 */
export interface BladeMotion {
  /** Where the blade hovers (its guard, the point it turns about). */
  home: Pt;
  /** The angle it is raised at (pointing at the sky, tilted out by its slot). */
  ang0: number;
  /** The angle it aims at (from its hover point to its tip's mark). */
  aim: number;
  /** Where its tip goes in. */
  tipTo: Pt;
  /** Guard-to-tip length, px. */
  tipLen: number;
  /** Whole sword (pommel to tip), px: the sprite scale. */
  length: number;
  manifestMs: number;
  /** Ms after the unfurl: the swing to aim starts / ends; the kick back starts; the thrust starts; the tip goes in. */
  aimStart: number;
  aimEnd: number;
  pullStart: number;
  flightStart: number;
  arrive: number;
  pullPx: number;
  /** Degrees of quiver once it sticks. */
  quiver: number;
  great: boolean;
  /** 0-based index (a phase offset for the hover bob). */
  index: number;
}

export type BladePhase = 'hidden' | 'manifest' | 'hover' | 'aim' | 'lock' | 'pull' | 'flight' | 'stuck';

export interface BladePose {
  x: number; y: number; ang: number;
  /** The unfurl, 0..1 (the sword grows out from its guard); 1 once formed. */
  unfurl: number;
  phase: BladePhase;
}

const dirOf = (a: number): Pt => ({ x: Math.cos(a), y: Math.sin(a) });
/** The shortest signed turn from angle `a` to angle `b`. */
export function turn(a: number, b: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/** The thrust: it leaves with some pace and still ACCELERATES into the target (weight, and a hard arrival). */
export const thrustEase = (u: number): number => { const t = Math.min(1, Math.max(0, Number.isFinite(u) ? u : 0)); return 0.3 * t + 0.7 * t * t; };

/** Where a blade is `t` ms after it starts to unfurl. Pure: a replay draws the same sword in the same place. */
export function bladePose(m: BladeMotion, t: number): BladePose {
  if (!(t >= 0)) return { x: m.home.x, y: m.home.y, ang: m.ang0, unfurl: 0, phase: 'hidden' };
  const d = dirOf(m.aim);
  if (t >= m.arrive) {
    // STUCK: the tip stays where it went in; the sword quivers about it (a damped spring).
    const q = (m.quiver * Math.PI) / 180 * spring(t - m.arrive, 9, 130);
    const ang = m.aim + q;
    const dd = dirOf(ang);
    return { x: m.tipTo.x - dd.x * m.tipLen, y: m.tipTo.y - dd.y * m.tipLen, ang, unfurl: 1, phase: 'stuck' };
  }
  if (t < m.manifestMs) {
    // UNFURL: it rises a few px into place as it grows out of its guard.
    const u = t / Math.max(1, m.manifestMs);
    const e = easeOutCubic(u);
    return { x: m.home.x, y: m.home.y + (1 - e) * 14, ang: m.ang0, unfurl: clamp(easeOutBack(u, 1.6), 0, 1.12), phase: 'manifest' };
  }
  // A slow hover bob that settles out through the aim (a locked blade is dead still: the breath before the loose).
  const settle = t < m.aimStart ? 1 : 1 - Math.min(1, (t - m.aimStart) / Math.max(1, m.aimEnd - m.aimStart));
  const bob = Math.sin((t - m.manifestMs) * 0.007 + m.index * 1.3) * 2.5 * settle;
  if (t < m.aimStart) return { x: m.home.x, y: m.home.y + bob, ang: m.ang0, unfurl: 1, phase: 'hover' };
  if (t < m.aimEnd) {
    const u = (t - m.aimStart) / Math.max(1, m.aimEnd - m.aimStart);
    return { x: m.home.x, y: m.home.y + bob, ang: m.ang0 + turn(m.ang0, m.aim) * easeOutBack(u, 1.5), unfurl: 1, phase: 'aim' };
  }
  if (t < m.pullStart) return { x: m.home.x, y: m.home.y, ang: m.aim, unfurl: 1, phase: 'lock' };
  const start = { x: m.home.x - d.x * m.pullPx, y: m.home.y - d.y * m.pullPx };
  if (t < m.flightStart) {
    const u = easeOutCubic((t - m.pullStart) / Math.max(1, m.flightStart - m.pullStart));
    return { x: m.home.x - d.x * m.pullPx * u, y: m.home.y - d.y * m.pullPx * u, ang: m.aim, unfurl: 1, phase: 'pull' };
  }
  const to = { x: m.tipTo.x - d.x * m.tipLen, y: m.tipTo.y - d.y * m.tipLen };
  const e = thrustEase((t - m.flightStart) / Math.max(1, m.arrive - m.flightStart));
  return { x: start.x + (to.x - start.x) * e, y: start.y + (to.y - start.y) * e, ang: m.aim, unfurl: 1, phase: 'flight' };
}

/** The tip of a blade at a pose. */
export function tipOf(p: BladePose, tipLen: number): Pt {
  return { x: p.x + Math.cos(p.ang) * tipLen, y: p.y + Math.sin(p.ang) * tipLen };
}

/**
 * The direction the formation opens toward: toward the target, tilted up the screen when there is room above the hero
 * (a crown of raised blades reads best over the portrait), never up off a top-edge hero.
 */
export function formationAngle(a: Pt, d: Pt, radius: number, ceilY: number): number {
  const dx = d.x - a.x, dy = d.y - a.y;
  const L = Math.hypot(dx, dy) || 1;
  const room = (a.y - ceilY) / Math.max(1, radius);
  const up = clamp((room - 1.2) / 2.5, 0, 0.9);
  return Math.atan2(dy / L - up, dx / L);
}

/**
 * Every blade's whole life (and Tier IV's greatsword, LAST in the list), from the plan, the two heroes, the portrait
 * radii and the on-screen box. The formation is an arc round the hero, opening toward the target; the marks the tips
 * go in at CROSS (a blade from the left of the arc goes in right of centre), so a pair makes an X and a fan a
 * pin-cushion. Pure, so a replay flies the same paths and the tests can check them.
 */
export function bladeMotions(p: BladesPlan, a: Pt, d: Pt, radius: number, aRadius: number, c: HeroBladesConfig, bounds: Bounds, scale = 1): BladeMotion[] {
  if (p.reduced) return [];
  const theta = formationAngle(a, d, aRadius, bounds.y0);
  const spread = (p.spread * Math.PI) / 180;
  const maxSlot = Math.max(1, ...p.blades.map((b) => Math.abs(b.slot)));
  const len = c.bladeLength * bladesTierDials(p.tier, c).BladeSize * scale;
  const inset = (pt: Pt, mx: number, my: number): Pt => ({
    x: clamp(pt.x, bounds.x0 + mx, Math.max(bounds.x0 + mx, bounds.x1 - mx)),
    y: clamp(pt.y, bounds.y0 + my, Math.max(bounds.y0 + my, bounds.y1 - my)),
  });
  const along = { x: d.x - a.x, y: d.y - a.y };
  const L = Math.hypot(along.x, along.y) || 1;
  const perp = { x: -along.y / L, y: along.x / L };
  const out: BladeMotion[] = p.blades.map((b, i) => {
    const u = b.slot / maxSlot;
    const ang = theta + (p.blades.length > 1 ? u * spread / 2 : 0);
    const r = aRadius * p.formRadius * (1 + 0.08 * Math.abs(u));
    const length = len * b.size;
    const tipLen = length * BLADE_TIP_FRACTION;
    // Raised to the sky, splayed out a little by its slot (a crown); kept on screen with the whole raised blade.
    const ang0 = -Math.PI / 2 + u * 0.32;
    const home = inset({ x: a.x + Math.cos(ang) * r, y: a.y + Math.sin(ang) * r }, length * 0.25, tipLen + 8 * scale);
    // The tip's mark: the blades CROSS (the left of the arc goes in right of centre), in toward the centre for the last.
    const cross = -u * p.scatter * radius;
    const deep = radius * (0.05 + 0.1 * Math.abs(u));
    const tipTo = { x: d.x + perp.x * cross - (along.x / L) * deep, y: d.y + perp.y * cross - (along.y / L) * deep };
    const aim = Math.atan2(tipTo.y - home.y, tipTo.x - home.x);
    const aimStart = b.aimAt - b.manifestAt;
    return {
      home, ang0, aim, tipTo, tipLen, length, manifestMs: c.manifestMs, aimStart, aimEnd: aimStart + c.aimMs,
      pullStart: b.launchAt - b.manifestAt, flightStart: b.launchAt - b.manifestAt + c.pullMs, arrive: b.arriveAt - b.manifestAt,
      pullPx: c.pullPx * scale, quiver: c.quiver, great: false, index: i,
    };
  });
  const g = p.great;
  if (g) {
    const length = c.bladeLength * c.greatSize * scale;
    const tipLen = length * BLADE_TIP_FRACTION;
    const home = inset({ x: a.x + Math.cos(theta) * aRadius * c.greatForm, y: a.y + Math.sin(theta) * aRadius * c.greatForm }, length * 0.2, tipLen + 8 * scale);
    // It goes in dead centre, a little past it (it impales).
    const tipTo = { x: d.x + (along.x / L) * radius * 0.12, y: d.y + (along.y / L) * radius * 0.12 };
    const aim = Math.atan2(tipTo.y - home.y, tipTo.x - home.x);
    const aimStart = g.aimAt - g.manifestAt;
    out.push({
      home, ang0: -Math.PI / 2, aim, tipTo, tipLen, length, manifestMs: c.greatManifestMs, aimStart, aimEnd: aimStart + c.greatAimMs,
      pullStart: g.launchAt - g.manifestAt, flightStart: g.launchAt - g.manifestAt + c.greatPullMs, arrive: g.arriveAt - g.manifestAt,
      pullPx: c.pullPx * 2.2 * scale, quiver: c.quiver * 0.6, great: true, index: out.length,
    });
  }
  return out;
}

/**
 * The sword textures' geometry (texture px): every layer of a sword is painted on the same box, pointing along +x, so
 * one transform places them all. The guard is the pivot (a sword turns about its hilt).
 */
export const SWORD_TEX = { w: 384, h: 96, pommel: 14, guard: 92, tip: 374 } as const;
/** The fraction of the whole sword (pommel to tip) that lies between the guard (its pivot) and the tip. */
export const BLADE_TIP_FRACTION = (SWORD_TEX.tip - SWORD_TEX.guard) / (SWORD_TEX.tip - SWORD_TEX.pommel);

/** The direction the LAST blow travels as it goes in (the impact's shake and spray follow it). Unit. */
export function blowDir(m: BladeMotion | undefined, a: Pt, d: Pt): Pt {
  if (m) return dirOf(m.aim);
  const L = Math.hypot(d.x - a.x, d.y - a.y) || 1;
  return { x: (d.x - a.x) / L, y: (d.y - a.y) / L };
}

// ─── the camera (pure) ─────────────────────────────────────────────────────────────────────────────────────────

const springAt = (ms: number, hz: number, tau: number): number => (ms < 0 ? 0 : Math.exp(-ms / tau) * Math.cos(2 * Math.PI * hz * (ms / 1000)));

/**
 * The camera at sequence time `t` (px in the space the points are in). A push in on the hero through the summon and
 * the aim (held still on the lock: the breath before the loose); a recoil kick on each loose; a sharp directional kick
 * ALONG each blade that goes in; on THE impact a punch in and a hard directional shake. Tier IV instead builds on the
 * greatsword: the view pushes in further while it hangs, a tremor grows, and its impact punches hardest and rings both
 * ways. Deterministic (sines and springs): a replay moves identically. Pure.
 */
export function bladesCameraAt(p: BladesPlan, c: HeroBladesConfig, t: number, dir: Pt = { x: 1, y: 0 }): { zoom: number; x: number; y: number } {
  if (p.reduced) return { zoom: 1, x: 0, y: 0 };
  let z = 0;
  const slamPop = t - p.mergeAt;
  if (slamPop >= 0 && slamPop < 260) z += 0.012 * Math.exp(-slamPop / 70);
  const sine = (u: number): number => easeInOutSine(u);
  if (t >= p.chargeAt && t < p.impactAt) {
    let push = p.zoom * sine((t - p.chargeAt) / Math.max(1, p.fireAt - p.chargeAt));
    // Tier IV: while the greatsword hangs the view eases back OUT to a wide shot (both heroes, the greatsword and the
    // bound target all in frame: the foe often sits at a screen corner), so the loose and the impact punch in from wide.
    if (p.great && t >= p.hangAt) push *= 1 - 0.85 * sine((t - p.hangAt) / Math.max(1, p.great.launchAt + c.greatPullMs - p.hangAt));
    z += push;
  } else if (t >= p.impactAt) {
    const since = t - p.impactAt;
    z += (p.zoom * (p.great ? 1.9 : 1) + p.punch) * Math.exp(-since / Math.max(1, c.zoomOutMs / 4));
  }
  let x = 0, y = 0;
  const kick = (at: number, amp: number, tau: number, hz: number, v: Pt): void => {
    const age = t - at;
    if (age < 0) return;
    const s = springAt(age, hz, tau);
    const across = amp * 0.2 * Math.sin(age * 0.09) * Math.exp(-age / tau);
    x += v.x * amp * s + -v.y * across;
    y += v.y * amp * s + v.x * across;
  };
  p.blades.forEach((b) => kick(b.launchAt + c.pullMs, -p.shakePx * 0.1, 40, 14, dir));
  p.hits.forEach((at, i) => kick(at, p.shakePx * (0.32 + 0.04 * i), 40, 18, dir));
  if (p.great) {
    // The greatsword hangs: a tremor that grows (both axes) until it is loosed.
    const g0 = p.hangAt, g1 = p.great.launchAt + c.greatPullMs;
    if (t >= g0 && t < p.impactAt) {
      const u = Math.min(1, (t - g0) / Math.max(1, g1 - g0));
      const amp = p.shakePx * 0.14 * u * u;
      x += amp * Math.sin(t * 0.21);
      y += amp * Math.sin(t * 0.27 + 1.3);
    }
    kick(g1, -p.shakePx * 0.25, 60, 12, dir);
    const age = t - p.impactAt;
    if (age >= 0) {
      const env = Math.exp(-age / Math.max(1, c.shakeMs / 4));
      x += dir.x * p.shakePx * env * Math.cos(age * 0.1) + p.shakePx * 0.5 * env * Math.sin(age * 0.113 + 0.5);
      y += dir.y * p.shakePx * env * Math.cos(age * 0.1) + p.shakePx * 0.5 * env * Math.cos(age * 0.097);
    }
    p.booms.forEach((at, i) => kick(at, p.shakePx * 0.28, 45, 18, i % 2 ? { x: -dir.y, y: dir.x } : dir));
  } else {
    kick(p.impactAt, p.shakePx, Math.max(1, c.shakeMs / 4), 16, dir);
    kick(p.shatterAt, p.shakePx * 0.25, 40, 20, { x: -dir.y, y: dir.x });
  }
  return { zoom: 1 + Math.max(0, z), x, y };
}

/**
 * Where the camera anchors: the ATTACKER through the summon and the aim, following the volley in flight, the DEFENDER
 * once the last blade is in. Tier IV holds the midpoint while the greatsword hangs (both heroes in view), then swings
 * to the defender as it is loosed. A zoom anchored on a point keeps that point still. Pure.
 */
export function bladesCameraFocus(p: BladesPlan, t: number, a: Pt, d: Pt, c: HeroBladesConfig = cfg): Pt {
  const lerp = (u: number): Pt => ({ x: a.x + (d.x - a.x) * u, y: a.y + (d.y - a.y) * u });
  if (t <= p.fireAt) return a;
  const lastIn = p.blades.length ? Math.max(...p.blades.map((b) => b.arriveAt)) : p.impactAt;
  if (!p.great) {
    if (t >= lastIn) return d;
    return lerp(easeInOutSine((t - p.fireAt) / Math.max(1, lastIn - p.fireAt)));
  }
  const g = p.great;
  const loose = g.launchAt + c.greatPullMs;
  if (t < lastIn) return lerp(0.5 * easeInOutSine((t - p.fireAt) / Math.max(1, lastIn - p.fireAt)));
  if (t < loose) return lerp(0.5);
  if (t >= p.impactAt) return d;
  return lerp(0.5 + 0.5 * thrustEase((t - loose) / Math.max(1, p.impactAt - loose)));
}
