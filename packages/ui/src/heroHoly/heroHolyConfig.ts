/**
 * THE HOLY HERO ATTACK (Consecration): its tuned values, its pure timeline, the pure geometry and the pure camera.
 *
 * Owner 2026-09-28: "branch off and create a holy weapon + consecration attack. first tier is a holy aoe blast on the
 * opponent, final blast a large holy sword slams into the middle of the board and a consecration erupts from it
 * damaging the opponent. fill in the middle tiers".
 *
 * THE BEATS (base ms before the playback speed):
 *  1. THE DAMAGE FORMATION (shared by every style, `../heroAttack/damageFormation.ts`). Its end is this style's start.
 *  2. INVOKE. The total dives into the striking hero; a golden halo rings its head, a sunburst turns behind the
 *     portrait, light gathers in, a choir swells; the view pushes in on the hero. A beam of light then rises off the
 *     hero (the prayer goes up).
 *  3. THE SIGIL. A golden rune circle flashes onto the struck portrait and spins down onto it (a divine chime).
 *  4. THE SMITE. A pillar of light drops out of the sky onto the sigil: a radiant burst (god rays, a crisp ring, a
 *     short flash), rising motes, a bell strike.
 *     I: one smite (the owner's tier). II: a DOUBLE smite, the first a tick, the second bigger (the sigil gains a
 *     counter-turning outer ring). III: a RAIN OF LIGHT SPEARS thunks in round the target in rhythm, each one planting a
 *     consecration SEED on the ground (the ground begins to glow), then the pillar comes down in the middle and every
 *     seed erupts with it.
 *  IV. THE JUDGEMENT, taken to the extreme (owner 2026-09-29: "i want this to be flat and not faux-3d. also, let's take
 *     this animation to the extreme - have 6 swords fly in from different directions starting with 1, then they ramp up
 *     in speed and the center implodes into that blest towards the enemy"):
 *      1. ONE huge ornate holy sword flies in from off screen along its own heading (a light trail behind it) and strikes
 *         the CENTRE of the board: an impact, and a holy ring forms there.
 *      2. Five more follow from DIFFERENT directions round the compass (each from roughly opposite the last), every one
 *         converging on the centre with its own impact.
 *      3. They RAMP UP: each flies faster than the last and the gaps between arrivals shrink (slow, faster, a barrage).
 *      4. They stay PLANTED round the centre, points inward: a charged star of blades round the holy ring.
 *      5. The centre IMPLODES: every sword and all the light are sucked into the middle (a sharp inward collapse), then
 *         it RELEASES as the flat consecrated blast, skimming the board to the struck hero, tearing radiant cracks.
 *      6. Holy flames and light erupt round the struck portrait: THE blow. The cracked path lingers and fades.
 *     EVERYTHING IS FLAT (the same owner ask): every sigil, ring, rune and crack is a full, top-down shape on the board.
 *
 * THE CONSEQUENCE lands ONCE: on the last smite (I-III) or on the eruption under the struck hero (IV). Every earlier
 * smite and spear is a tick (FX and sound only). No hit-stop or freeze anywhere (owner 2026-09-28).
 *
 * TIERS are the shared, owner-approved thresholds (I 1-5, II 6-11, III 12-19, IV 20+). Reduced motion: no pillars,
 * sword, shake or zoom; the numbers fade and the blow lands.
 *
 * Tuner convention (the Blast's): localStorage in DEV only, values clamped on write and on load; production always
 * plays DEFAULTS. The preview speed is how you are LOOKING and is never saved.
 */
import { clamp, easeInOutSine, seededRng, type Pt } from '../heroAttack/easing';
import {
  HERO_ATTACK_TIER_THRESHOLDS, TIERS, reducedAttackTimeline, tierOf, type TierNum,
} from '../heroAttack/tiers';

export { TIERS, type TierNum };

/** The per-tier dials. A config key is `t1..t4` + one of these. */
export const HOLY_TIER_SUFFIXES = [
  'ChargeMs', 'SigilMs', 'Smites', 'SmiteGapMs', 'DropMs', 'PillarWidth', 'Spears', 'SpearGapMs', 'SpearFlightMs', 'Sword',
  'Shake', 'Zoom', 'Punch', 'Motes', 'Burst', 'SettleMs', 'Dim',
] as const;
export type HolyTierSuffix = (typeof HOLY_TIER_SUFFIXES)[number];
type TierKey = `t${TierNum}${HolyTierSuffix}`;

interface GlobalConfig {
  // Tiers (the shared thresholds; DEV-tunable only)
  tier2At: number; tier3At: number; tier4At: number;
  // Invoke
  absorbMs: number;
  heroSwell: number;
  haloSize: number;
  sunburst: number;
  prayBeam: number;
  // Sigil and smite
  sigilSize: number;
  sigilSpin: number;
  pillarGlow: number;
  pillarHeight: number;
  raysSize: number;
  // Spear rain (Tier III)
  spearSize: number;
  spearRing: number;
  spearSlant: number;
  seedGlow: number;
  // The sword (Tier IV)
  swordSize: number;
  swordLastSize: number;
  swordAlong: number;
  swordCount: number;
  swordFlightMs: number;
  swordFlightRamp: number;
  swordGapMs: number;
  swordGapRamp: number;
  swordAngle: number;
  swordJitter: number;
  swordPlant: number;
  swordHoldMs: number;
  implodeMs: number;
  swordGlow: number;
  slamDust: number;
  slamDebris: number;
  shockwave: number;
  // The explosion and the consecrated surge (Tier IV)
  explodeSize: number;
  shards: number;
  spreadMs: number;
  waveSize: number;
  pathWidth: number;
  runeDensity: number;
  cracks: number;
  gatherMs: number;
  flamePillars: number;
  flameHeight: number;
  lingerMs: number;
  flashAlpha: number;
  // Camera and portraits
  knockPx: number;
  squash: number;
  shakeMs: number;
  zoomOutMs: number;
  reducedFadeMs: number;
  // Colours
  colorCore: string;
  colorGold: string;
  colorDeep: string;
  colorSky: string;
  colorPlayer: string;
  colorFoe: string;
  colorDust: string;
  // Sound: a clip, a gain and a pitch per cue ('' = silent)
  sfxInvokeClip: string; sfxInvokeGain: number; sfxInvokeRate: number;
  sfxSigilClip: string; sfxSigilGain: number; sfxSigilRate: number;
  sfxDropClip: string; sfxDropGain: number; sfxDropRate: number;
  sfxHitClip: string; sfxHitGain: number; sfxHitRate: number;
  sfxImpactClip: string; sfxImpactGain: number; sfxImpactRate: number;
  sfxThumpClip: string; sfxThumpGain: number; sfxThumpRate: number;
  sfxSpearClip: string; sfxSpearGain: number; sfxSpearRate: number;
  sfxDescendClip: string; sfxDescendGain: number; sfxDescendRate: number;
  sfxSlamClip: string; sfxSlamGain: number; sfxSlamRate: number;
  sfxClangClip: string; sfxClangGain: number; sfxClangRate: number;
  sfxEruptClip: string; sfxEruptGain: number; sfxEruptRate: number;
  sfxImplodeClip: string; sfxImplodeGain: number; sfxImplodeRate: number;
  sfxBigClip: string; sfxBigGain: number; sfxBigRate: number;
  sfxChoirGain: number; sfxChoirHz: number;
  sfxBellGain: number; sfxBellHz: number;
  sfxSwellGain: number;
  sfxImpactLenMs: number;
  sfxTailMix: number;
  sfxDuck: number;
  // Preview only (the tuner's Play buttons). Never read by a real fight, and left out of Copy JSON.
  previewDamage: number;
  previewParts: number;
}
export type HeroHolyConfig = GlobalConfig & Record<TierKey, number>;

export const HERO_HOLY_COLOR_KEYS = ['colorCore', 'colorGold', 'colorDeep', 'colorSky', 'colorPlayer', 'colorFoe', 'colorDust'] as const;
export const HERO_HOLY_CLIP_KEYS = [
  'sfxInvokeClip', 'sfxSigilClip', 'sfxDropClip', 'sfxHitClip', 'sfxImpactClip', 'sfxThumpClip', 'sfxSpearClip',
  'sfxDescendClip', 'sfxSlamClip', 'sfxClangClip', 'sfxEruptClip', 'sfxImplodeClip', 'sfxBigClip',
] as const;
type ColorKey = (typeof HERO_HOLY_COLOR_KEYS)[number];
type ClipKey = (typeof HERO_HOLY_CLIP_KEYS)[number];
export type HeroHolyStrKey = ColorKey | ClipKey;
export type HeroHolyNumKey = Exclude<keyof HeroHolyConfig, HeroHolyStrKey>;

/** Tier I .. IV per suffix: the escalation ladder. */
const TIER_DEFAULTS: Record<HolyTierSuffix, [number, number, number, number]> = {
  ChargeMs: [300, 340, 380, 380],
  SigilMs: [300, 300, 320, 300],
  Smites: [1, 2, 1, 0],
  SmiteGapMs: [0, 170, 0, 0],
  DropMs: [150, 150, 160, 150],
  PillarWidth: [1, 1.1, 1.3, 1.5],
  Spears: [0, 0, 6, 0],
  SpearGapMs: [90, 90, 85, 90],
  SpearFlightMs: [200, 200, 190, 200],
  Sword: [0, 0, 0, 1],
  Shake: [5, 8, 12, 20],
  Zoom: [0.02, 0.03, 0.045, 0.06],
  Punch: [0.02, 0.028, 0.038, 0.06],
  Motes: [18, 24, 32, 56],
  Burst: [1, 1.15, 1.35, 1.8],
  SettleMs: [220, 280, 320, 300],
  Dim: [0, 0.18, 0.32, 0.5],
};

export const HOLY_TIER_RANGES: Record<HolyTierSuffix, [number, number, number]> = {
  ChargeMs: [120, 1500, 10],
  SigilMs: [80, 1200, 10],
  Smites: [0, 4, 1],
  SmiteGapMs: [0, 600, 5],
  DropMs: [60, 600, 5],
  PillarWidth: [0.3, 3, 0.05],
  Spears: [0, 10, 1],
  SpearGapMs: [20, 300, 5],
  SpearFlightMs: [80, 800, 10],
  Sword: [0, 1, 1],
  Shake: [0, 40, 0.5],
  Zoom: [0, 0.14, 0.002],
  Punch: [0, 0.1, 0.001],
  Motes: [0, 90, 1],
  Burst: [0.3, 3, 0.05],
  SettleMs: [0, 1600, 10],
  Dim: [0, 0.8, 0.01],
};

const tierDefaults = Object.fromEntries(TIERS.flatMap((t) => HOLY_TIER_SUFFIXES.map((s) => [`t${t}${s}`, TIER_DEFAULTS[s][t - 1]]))) as Record<TierKey, number>;

export const HERO_HOLY_DEFAULTS: HeroHolyConfig = {
  // The shared, owner-approved thresholds (6 / 12 / 20): the same blow steps Holy up exactly where it steps Blast up.
  ...HERO_ATTACK_TIER_THRESHOLDS,
  absorbMs: 190,
  heroSwell: 0.07,
  haloSize: 1,
  sunburst: 1,
  prayBeam: 1,
  sigilSize: 1,
  sigilSpin: 1,
  pillarGlow: 1,
  pillarHeight: 1,
  raysSize: 1,
  spearSize: 1,
  spearRing: 1.75,
  spearSlant: 1,
  seedGlow: 1,
  swordSize: 1,
  swordLastSize: 1.35,
  swordAlong: 0.5,
  swordCount: 6,
  swordFlightMs: 440,
  swordFlightRamp: 0.72,
  swordGapMs: 460,
  swordGapRamp: 0.68,
  swordAngle: -90,
  swordJitter: 12,
  swordPlant: 0.55,
  swordHoldMs: 170,
  implodeMs: 210,
  swordGlow: 1,
  slamDust: 8,
  slamDebris: 12,
  shockwave: 1,
  explodeSize: 1,
  shards: 22,
  spreadMs: 250,
  waveSize: 1,
  pathWidth: 1,
  runeDensity: 1,
  cracks: 8,
  gatherMs: 40,
  flamePillars: 9,
  flameHeight: 1,
  lingerMs: 720,
  flashAlpha: 0.9,
  knockPx: 16,
  squash: 0.09,
  shakeMs: 340,
  zoomOutMs: 380,
  reducedFadeMs: 260,
  // Gold and white, not yellow (owner 2026-09-28: "make they holy color less yellow and more gold + white").
  colorCore: '#fffaf0',
  colorGold: '#f0c55a',
  colorDeep: '#d4a53a',
  colorSky: '#e4efff',
  colorPlayer: '#f0c55a',
  colorFoe: '#e9b85a',
  colorDust: '#ece2cc',
  sfxInvokeClip: 'shieldgain', sfxInvokeGain: 0.5, sfxInvokeRate: 1.15,
  sfxSigilClip: 'prismaticpick', sfxSigilGain: 0.5, sfxSigilRate: 1.3,
  sfxDropClip: 'fx/djartmusic-christmas-sparkle-whoosh-1-275404', sfxDropGain: 0.5, sfxDropRate: 0.9,
  sfxHitClip: 'divineshieldbreak', sfxHitGain: 0.45, sfxHitRate: 1.25,
  sfxImpactClip: 'fx/blue-impact-hit', sfxImpactGain: 0.7, sfxImpactRate: 1.05,
  sfxThumpClip: 'smack2', sfxThumpGain: 0.4, sfxThumpRate: 0.9,
  sfxSpearClip: 'fx/metal-woosh', sfxSpearGain: 0.3, sfxSpearRate: 1.35,
  sfxDescendClip: 'fx/universfield-cinematic-swoosh-impact-454392', sfxDescendGain: 0.55, sfxDescendRate: 1,
  sfxSlamClip: 'titanhammer', sfxSlamGain: 0.7, sfxSlamRate: 1.05,
  sfxClangClip: 'equipclang', sfxClangGain: 0.5, sfxClangRate: 0.85,
  sfxEruptClip: 'turnexplosion', sfxEruptGain: 0.5, sfxEruptRate: 1.25,
  sfxImplodeClip: 'runeselectimplosion', sfxImplodeGain: 0.7, sfxImplodeRate: 1.1,
  sfxBigClip: 'crit', sfxBigGain: 0.38, sfxBigRate: 1.1,
  sfxChoirGain: 0.3, sfxChoirHz: 262,
  sfxBellGain: 0.45, sfxBellHz: 880,
  sfxSwellGain: 0.34,
  sfxImpactLenMs: 1100,
  sfxTailMix: 0.18,
  sfxDuck: 0.5,
  previewDamage: 12,
  previewParts: 4,
  ...tierDefaults,
};

const GLOBAL_RANGES: Record<Exclude<keyof GlobalConfig, HeroHolyStrKey>, [number, number, number]> = {
  tier2At: [2, 40, 1], tier3At: [2, 60, 1], tier4At: [2, 80, 1],
  absorbMs: [60, 600, 10],
  heroSwell: [0, 0.3, 0.01],
  haloSize: [0, 3, 0.05],
  sunburst: [0, 3, 0.05],
  prayBeam: [0, 3, 0.05],
  sigilSize: [0, 3, 0.05],
  sigilSpin: [0, 4, 0.05],
  pillarGlow: [0, 3, 0.05],
  pillarHeight: [0.3, 3, 0.05],
  raysSize: [0, 3, 0.05],
  spearSize: [0.3, 3, 0.05],
  spearRing: [0.3, 3, 0.05],
  spearSlant: [0, 1.5, 0.01],
  seedGlow: [0, 3, 0.05],
  swordSize: [0.4, 2, 0.05],
  swordLastSize: [0.5, 2.5, 0.05],
  swordAlong: [0.2, 0.8, 0.01],
  swordCount: [1, 8, 1],
  swordFlightMs: [80, 1200, 10],
  swordFlightRamp: [0.3, 1, 0.01],
  swordGapMs: [40, 1200, 10],
  swordGapRamp: [0.3, 1, 0.01],
  swordAngle: [-180, 180, 1],
  swordJitter: [0, 45, 1],
  swordPlant: [0, 2, 0.05],
  swordHoldMs: [0, 800, 10],
  implodeMs: [60, 800, 10],
  swordGlow: [0, 3, 0.05],
  slamDust: [0, 40, 1],
  slamDebris: [0, 80, 1],
  shockwave: [0, 3, 0.05],
  explodeSize: [0.3, 3, 0.05],
  shards: [0, 40, 1],
  spreadMs: [80, 1500, 10],
  waveSize: [0.3, 3, 0.05],
  pathWidth: [0.2, 3, 0.05],
  runeDensity: [0, 3, 0.05],
  cracks: [0, 16, 1],
  gatherMs: [0, 600, 10],
  flamePillars: [0, 16, 1],
  flameHeight: [0.2, 3, 0.05],
  lingerMs: [100, 3000, 10],
  flashAlpha: [0, 1, 0.01],
  knockPx: [0, 60, 1],
  squash: [0, 0.3, 0.01],
  shakeMs: [0, 1200, 10],
  zoomOutMs: [60, 1500, 10],
  reducedFadeMs: [60, 1000, 10],
  sfxInvokeGain: [0, 2, 0.05], sfxInvokeRate: [0.5, 2, 0.01],
  sfxSigilGain: [0, 2, 0.05], sfxSigilRate: [0.5, 2, 0.01],
  sfxDropGain: [0, 2, 0.05], sfxDropRate: [0.5, 2, 0.01],
  sfxHitGain: [0, 2, 0.05], sfxHitRate: [0.5, 2, 0.01],
  sfxImpactGain: [0, 2, 0.05], sfxImpactRate: [0.5, 2, 0.01],
  sfxThumpGain: [0, 2, 0.05], sfxThumpRate: [0.5, 2, 0.01],
  sfxSpearGain: [0, 2, 0.05], sfxSpearRate: [0.5, 2, 0.01],
  sfxDescendGain: [0, 2, 0.05], sfxDescendRate: [0.5, 2, 0.01],
  sfxSlamGain: [0, 2, 0.05], sfxSlamRate: [0.5, 2, 0.01],
  sfxClangGain: [0, 2, 0.05], sfxClangRate: [0.5, 2, 0.01],
  sfxEruptGain: [0, 2, 0.05], sfxEruptRate: [0.5, 2, 0.01],
  sfxImplodeGain: [0, 2, 0.05], sfxImplodeRate: [0.5, 2, 0.01],
  sfxBigGain: [0, 2, 0.05], sfxBigRate: [0.5, 2, 0.01],
  sfxChoirGain: [0, 2, 0.05], sfxChoirHz: [110, 880, 1],
  sfxBellGain: [0, 2, 0.05], sfxBellHz: [220, 2400, 5],
  sfxSwellGain: [0, 2, 0.05],
  sfxImpactLenMs: [150, 3500, 10],
  sfxTailMix: [0, 0.6, 0.01],
  sfxDuck: [0, 1, 0.05],
  previewDamage: [1, 60, 1],
  previewParts: [1, 8, 1],
};

/** [min, max, step] per numeric key. Values outside are clamped on write AND on load. */
export const HERO_HOLY_RANGES: Record<HeroHolyNumKey, [number, number, number]> = {
  ...GLOBAL_RANGES,
  ...(Object.fromEntries(TIERS.flatMap((t) => HOLY_TIER_SUFFIXES.map((s) => [`t${t}${s}`, HOLY_TIER_RANGES[s]]))) as Record<TierKey, [number, number, number]>),
};

/** The hard ceilings a plan can never exceed, whatever the sliders say (so a 40 stays clean, not cluttered). */
export const HOLY_CAPS = { smites: 4, spears: 10, motes: 90, shakePx: 40, zoom: 0.14, runes: 18, flames: 16, crackPts: 40, shards: 40, swords: 8 } as const;

const HEX = /^#[0-9a-f]{6}$/i;
const isColorKey = (k: string): k is ColorKey => (HERO_HOLY_COLOR_KEYS as readonly string[]).includes(k);
const isClipKey = (k: string): k is ClipKey => (HERO_HOLY_CLIP_KEYS as readonly string[]).includes(k);

/** One value, made safe: numbers clamped into range (junk = the default), colours #rrggbb, clips a short string. */
export function clampHeroHolyValue<K extends keyof HeroHolyConfig>(key: K, value: unknown): HeroHolyConfig[K] | undefined {
  if (!Object.prototype.hasOwnProperty.call(HERO_HOLY_DEFAULTS, key)) return undefined;
  const def = HERO_HOLY_DEFAULTS[key];
  if (isColorKey(key)) {
    if (typeof value !== 'string') return def;
    const v = value.trim();
    return (HEX.test(v) ? v.toLowerCase() : def) as HeroHolyConfig[K];
  }
  if (isClipKey(key)) return (typeof value === 'string' ? value.trim().slice(0, 160) : def) as HeroHolyConfig[K];
  const n = typeof value === 'number' ? value : Number(value);
  if (typeof value === 'boolean' || value === null || value === '' || !Number.isFinite(n)) return def;
  const [min, max] = HERO_HOLY_RANGES[key as HeroHolyNumKey];
  return Math.min(max, Math.max(min, n)) as HeroHolyConfig[K];
}

/** A whole saved object, sanitised key by key over the defaults (junk and unknown keys dropped). */
export function sanitizeHeroHolyConfig(saved: unknown): HeroHolyConfig {
  const out: HeroHolyConfig = { ...HERO_HOLY_DEFAULTS };
  if (!saved || typeof saved !== 'object') return out;
  for (const [k, v] of Object.entries(saved as Record<string, unknown>)) {
    const safe = clampHeroHolyValue(k as keyof HeroHolyConfig, v);
    if (safe !== undefined) (out as unknown as Record<string, unknown>)[k] = safe;
  }
  return out;
}

const KEY = 'ascent.heroholy.v1';

let cfg: HeroHolyConfig = (() => {
  if (!import.meta.env.DEV || typeof localStorage === 'undefined') return { ...HERO_HOLY_DEFAULTS };
  try { return sanitizeHeroHolyConfig(JSON.parse(localStorage.getItem(KEY) ?? '{}')); } catch { return { ...HERO_HOLY_DEFAULTS }; }
})();

export function getHeroHolyConfig(): HeroHolyConfig { return cfg; }

export function setHeroHolyValue(key: keyof HeroHolyConfig, value: number | string): void {
  const safe = clampHeroHolyValue(key, value);
  if (safe === undefined) return;
  cfg = { ...cfg, [key]: safe };
  if (!import.meta.env.DEV) return;
  try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch { /* ignore */ }
}

export function resetHeroHolyConfig(): void {
  cfg = { ...HERO_HOLY_DEFAULTS };
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}

/** The tuned values as JSON for pasting back into DEFAULTS (the preview-only keys left out). */
export function heroHolyConfigJson(c: HeroHolyConfig = cfg): string {
  const ship: Partial<HeroHolyConfig> = { ...c };
  delete ship.previewDamage;
  delete ship.previewParts;
  return JSON.stringify(ship, null, 2);
}

// ─── the preview speed (DEV only, never saved) ─────────────────────────────────────────────────────────────────

export const HERO_HOLY_SPEEDS = [1, 0.5, 0.25] as const;
export type HeroHolySpeed = (typeof HERO_HOLY_SPEEDS)[number];
let speed: HeroHolySpeed = 1;
/** The tuner's slow motion. Always 1 in production. */
export function heroHolyPreviewSpeed(): HeroHolySpeed { return import.meta.env.DEV ? speed : 1; }
export function setHeroHolyPreviewSpeed(s: HeroHolySpeed): void { speed = s; }

// ─── the pure plan ─────────────────────────────────────────────────────────────────────────────────────────────

/** One tier's dials, read out of the config. */
export function holyTierDials(tier: TierNum, c: HeroHolyConfig = cfg): Record<HolyTierSuffix, number> {
  return Object.fromEntries(HOLY_TIER_SUFFIXES.map((s) => [s, c[`t${tier}${s}`]])) as Record<HolyTierSuffix, number>;
}

/** The distance the consecration's spread time is tuned at (the sword to the struck hero on a 1080p board). */
export const HOLY_REF_SPREAD = 800;

/** The consecration's race for a distance: the tuned time, scaled gently (a sandbox box stays readable). */
export function holySpreadMs(distance: number, tunedMs: number): number {
  const d = Number.isFinite(distance) && distance > 0 ? distance : HOLY_REF_SPREAD;
  return Math.round(tunedMs * clamp(Math.sqrt(d / HOLY_REF_SPREAD), 0.6, 1.2));
}

export interface HolySmitePlan { dropAt: number; hitAt: number; size: number }
export interface HolySpearPlan { launchAt: number; hitAt: number; size: number }
/** One sword of the Tier IV barrage: when it leaves, when it bites, its size (the last is the biggest). */
export interface HolySwordPlan { launchAt: number; arriveAt: number; size: number }

export interface HolyPlanInput {
  /** When the style's own attack starts: the end of the shared damage formation (`formationPlan().endAt`). */
  leadIn?: number;
  /** THE blow, as the engine decided it. */
  total: number;
  /** Screen px between the attacker's and the defender's centres. */
  distance: number;
  reduced?: boolean;
}

export interface HolyPlan {
  reduced: boolean;
  tier: TierNum;
  /** 0..1 across the tiers (I = 0, IV = 1). */
  k: number;
  total: number;
  /** The invoke starts: the total dives into the hero, the halo forms. */
  chargeAt: number;
  absorbEnd: number;
  /** The beam of light rises off the hero. */
  prayAt: number;
  /** The rune circle starts forming on the struck hero (I-III). */
  sigilAt: number;
  sigilMs: number;
  smites: HolySmitePlan[];
  spears: HolySpearPlan[];
  /** Tier IV: the six-sword barrage and the consecrated blast. */
  sword: boolean;
  /** Tier IV: every sword's flight, in arrival order (each faster than the last, the gaps shrinking). */
  swords: HolySwordPlan[];
  /** Tier IV: the centre implodes (after the last sword bites and a short charge). */
  implodeAt: number;
  /** Tier IV: the release: the flat blast is fired at the struck hero; it arrives under it. */
  spreadAt: number;
  arriveAt: number;
  /** Tier IV: the consecrated, cracked path starts fading. */
  fadeAt: number;
  /** Beats that land BEFORE the impact (earlier smites, spears): the ticks. Sequence ms. */
  hits: number[];
  /** THE consequence beat: the last smite (I-III) or the eruption under the struck hero (IV). */
  impactAt: number;
  endAt: number;
  pillarWidth: number;
  shakePx: number;
  zoom: number;
  punch: number;
  motes: number;
  burst: number;
  dim: number;
}

/** The whole Holy attack, in base ms (divide by the playback speed for real time). Pure and deterministic. */
export function holyPlan(input: HolyPlanInput, c: HeroHolyConfig = cfg): HolyPlan {
  const total = Math.max(0, Math.round(input.total));
  const tier = tierOf(total, c);
  const T = holyTierDials(tier, c);
  const k = (tier - 1) / 3;
  const empty = { smites: [] as HolySmitePlan[], spears: [] as HolySpearPlan[], hits: [] as number[] };

  if (input.reduced) {
    const r = reducedAttackTimeline(input.leadIn ?? 0, c.reducedFadeMs);
    const { impactAt } = r;
    return {
      reduced: true, tier, k, total, chargeAt: impactAt, absorbEnd: impactAt, prayAt: impactAt, sigilAt: impactAt, sigilMs: 0,
      ...empty, sword: false, swords: [], implodeAt: impactAt, spreadAt: impactAt, arriveAt: impactAt,
      fadeAt: impactAt, impactAt, endAt: r.endAt, pillarWidth: 0, shakePx: 0, zoom: 0, punch: 0, motes: 0, burst: 0, dim: 0,
    };
  }

  const chargeAt = Math.max(0, input.leadIn ?? 0);
  const absorbEnd = chargeAt + c.absorbMs;
  const prayAt = chargeAt + Math.max(T.ChargeMs, c.absorbMs);
  const sword = T.Sword >= 1;
  const sigilAt = prayAt + 60;
  const sigilMs = T.SigilMs;
  const smites: HolySmitePlan[] = [];
  const spears: HolySpearPlan[] = [];
  let impactAt: number;
  const swords: HolySwordPlan[] = [];
  let implodeAt = prayAt, spreadAt = prayAt, arriveAt = prayAt, fadeAt = prayAt;

  if (sword) {
    // THE BARRAGE: the first sword is readable (a long flight), then each flies faster and lands sooner after the last
    // (both ramps), so it accelerates into a frenzy. Then a short charge, the implosion, the release.
    const n = clamp(Math.round(c.swordCount), 1, HOLY_CAPS.swords);
    let arrive = prayAt + 60 + c.swordFlightMs;
    for (let i = 0; i < n; i++) {
      if (i > 0) arrive += Math.max(30, c.swordGapMs * Math.pow(c.swordGapRamp, i - 1));
      const flight = Math.max(70, c.swordFlightMs * Math.pow(c.swordFlightRamp, i));
      const size = n > 1 ? 1 + (c.swordLastSize - 1) * Math.pow(i / (n - 1), 2) : c.swordLastSize;
      swords.push({ launchAt: arrive - flight, arriveAt: arrive, size });
    }
    implodeAt = arrive + c.swordHoldMs;
    spreadAt = implodeAt + c.implodeMs;
    arriveAt = spreadAt + holySpreadMs(input.distance * 0.5, c.spreadMs);
    impactAt = arriveAt + c.gatherMs;
    fadeAt = impactAt + 180;
  } else {
    // Spears first (III), each a tick; then the smites, every one but the last a tick.
    let t = sigilAt + sigilMs * (T.Spears > 0 ? 0.6 : 0.8);
    const nSpears = clamp(Math.round(T.Spears), 0, HOLY_CAPS.spears);
    for (let i = 0; i < nSpears; i++) {
      const launchAt = t + i * T.SpearGapMs;
      spears.push({ launchAt, hitAt: launchAt + T.SpearFlightMs, size: 0.85 + 0.25 * ((i * 7) % 3) / 2 });
    }
    if (nSpears) t = spears[spears.length - 1]!.hitAt + 110;
    const nSmites = Math.max(1, clamp(Math.round(T.Smites), 0, HOLY_CAPS.smites));
    for (let i = 0; i < nSmites; i++) {
      const dropAt = i === 0 ? t : smites[i - 1]!.hitAt + T.SmiteGapMs;
      const last = i === nSmites - 1;
      smites.push({ dropAt, hitAt: dropAt + T.DropMs, size: last ? (nSmites > 1 ? 1.2 : 1) * (1 + 0.15 * k) : 0.8 });
    }
    impactAt = smites[smites.length - 1]!.hitAt;
  }

  const hits = [...spears.map((s) => s.hitAt), ...smites.slice(0, -1).map((s) => s.hitAt), ...swords.map((w) => w.arriveAt)].filter((at) => at < impactAt).sort((a, b) => a - b);
  const tail = sword ? Math.max(c.lingerMs, c.zoomOutMs * 0.9) : Math.max(420, c.zoomOutMs * 0.9);
  const endAt = impactAt + tail + T.SettleMs;

  return {
    reduced: false, tier, k, total, chargeAt, absorbEnd, prayAt, sigilAt, sigilMs, smites, spears,
    sword, swords, implodeAt, spreadAt, arriveAt, fadeAt, hits, impactAt, endAt,
    pillarWidth: T.PillarWidth,
    shakePx: clamp(T.Shake, 0, HOLY_CAPS.shakePx),
    zoom: clamp(T.Zoom, 0, HOLY_CAPS.zoom),
    punch: T.Punch,
    motes: Math.round(clamp(T.Motes, 0, HOLY_CAPS.motes)),
    burst: T.Burst,
    dim: T.Dim,
  };
}

export type HolyCueKind =
  | 'charge' | 'pray' | 'sigil' | 'spear' | 'spearHit' | 'drop' | 'smite'
  | 'sword' | 'swordHit' | 'implode' | 'spread' | 'arrive' | 'impact' | 'fade' | 'end';
export interface HolyCue { at: number; kind: HolyCueKind; i: number }

/** Every beat the runner fires, in time order (ties keep this declaration order, so a tick precedes the impact). */
export function holyCues(p: HolyPlan): HolyCue[] {
  const out: HolyCue[] = [];
  if (!p.reduced) {
    out.push({ at: p.chargeAt, kind: 'charge', i: 0 });
    out.push({ at: p.prayAt, kind: 'pray', i: 0 });
    if (p.sword) {
      p.swords.forEach((w, i) => { out.push({ at: w.launchAt, kind: 'sword', i }); out.push({ at: w.arriveAt, kind: 'swordHit', i }); });
      out.push({ at: p.implodeAt, kind: 'implode', i: 0 });
      out.push({ at: p.spreadAt, kind: 'spread', i: 0 });
      out.push({ at: p.arriveAt, kind: 'arrive', i: 0 });
      out.push({ at: p.fadeAt, kind: 'fade', i: 0 });
    } else {
      out.push({ at: p.sigilAt, kind: 'sigil', i: 0 });
      p.spears.forEach((s, i) => { out.push({ at: s.launchAt, kind: 'spear', i }); out.push({ at: s.hitAt, kind: 'spearHit', i }); });
      // Every smite drops; each but the last lands as a tick; the last one IS the impact.
      p.smites.forEach((s, i) => {
        out.push({ at: s.dropAt, kind: 'drop', i });
        if (i < p.smites.length - 1) out.push({ at: s.hitAt, kind: 'smite', i });
      });
    }
  }
  out.push({ at: p.impactAt, kind: 'impact', i: 0 });
  out.push({ at: p.endAt, kind: 'end', i: 0 });
  const order: Record<HolyCueKind, number> = {
    charge: 1, pray: 2, sigil: 3, sword: 4, spear: 5, spearHit: 6, drop: 7, smite: 8, swordHit: 9, implode: 10, spread: 11, arrive: 12,
    impact: 13, fade: 14, end: 15,
  };
  return out.map((q, idx) => ({ q, idx })).sort((a, b) => a.q.at - b.q.at || order[a.q.kind] - order[b.q.kind] || a.idx - b.idx).map((x) => x.q);
}

// ─── the geometry (pure) ───────────────────────────────────────────────────────────────────────────────────────

/** One light spear's flight: from high above, slanted toward the striker's side, into the ground round the target. */
export interface SpearPath { from: Pt; to: Pt }

/** One rune stamped on the consecrated path: where, how far along (0..1), its variant and turn. */
export interface HolyRune { at: Pt; u: number; kind: number; rot: number; pillar: boolean }

export interface HolyGeo {
  /** Where the blast strikes and the flames erupt: the struck portrait's centre (flat: no ground under it). */
  foot: Pt;
  /** I-III: where each spear flies. */
  spears: SpearPath[];
  /** IV: the centre of the board, where every sword converges and the blast is released. */
  centre: Pt;
  /** IV: each sword's flight: from off screen (`from`), its point planted by the centre (`tip`), its length. */
  swords: { from: Pt; tip: Pt; len: number; ang: number }[];
  /** IV: the consecration's path, the sword to the struck hero's foot, with the runes along it. */
  path: { a: Pt; b: Pt; len: number; ang: number };
  runes: HolyRune[];
  /** IV: the radiant cracks the surge tears along the path: the main one (first) end to end, two thinner ones beside it. */
  cracks: Pt[][];
}

/** Where the blast strikes a portrait: its centre (the attack is flat; `radius` is kept for the callers). */
export function footOf(d: Pt, radius: number): Pt { void radius; return { x: d.x, y: d.y }; }

/**
 * The order the swords come in round the compass: each from roughly OPPOSITE the one before, stepping round, so the
 * barrage reads as coming from every side (6: 0, 180, 60, 240, 120, 300 degrees from `swordAngle`). Pure.
 */
export function swordHeadings(n: number, startDeg: number, jitterDeg: number): number[] {
  const step = 360 / Math.max(1, n);
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const slot = Math.floor(i / 2) * step + (i % 2) * 180;
    const jit = jitterDeg * (((i * 7) % 5) / 2 - 1) * 0.5;
    out.push(((startDeg + slot + jit) * Math.PI) / 180);
  }
  return out;
}

/**
 * Every position the attack uses, from the plan and the two heroes. `radius` is the struck portrait's, `unit` the
 * Pixi scale (px per stage px). Pure: a replay places the same spears, swords, runes and cracks, and the tests can
 * check them.
 */
export function holyGeo(p: HolyPlan, a: Pt, d: Pt, radius: number, c: HeroHolyConfig = cfg, unit = 1): HolyGeo {
  const foot = footOf(d, radius);
  const lean = a.x <= d.x ? -1 : 1; // spears come in from the striker's side of the sky (the middle of the screen)
  const spears: SpearPath[] = [];
  const n = p.spears.length;
  const inAng = Math.atan2(a.y - d.y, a.x - d.x);
  // They land in a fan on the side of the target facing the striker (the middle of the screen: a hero in a corner still
  // has every spear in view), the first in the middle of the fan, then alternating out either side of it.
  const arc = Math.min(Math.PI * 1.2, 0.45 * Math.max(1, n - 1));
  const step = n > 1 ? arc / (n - 1) : 0;
  for (let i = 0; i < n; i++) {
    const j = i === 0 ? 0 : Math.ceil(i / 2) * (i % 2 ? 1 : -1);
    const ang = inAng + (j - (n % 2 === 0 ? 0.5 : 0)) * step;
    const rr = radius * c.spearRing * (0.92 + 0.12 * ((i * 5) % 3) / 2);
    const to = { x: d.x + Math.cos(ang) * rr, y: d.y + Math.sin(ang) * rr * 0.8 };
    const L = 420 * unit;
    const sl = c.spearSlant * (0.85 + 0.3 * ((i * 3) % 4) / 3);
    const v = { x: lean * sl, y: -1 };
    const vl = Math.hypot(v.x, v.y);
    spears.push({ from: { x: to.x + (v.x / vl) * L, y: to.y + (v.y / vl) * L }, to });
  }
  // THE CENTRE: the middle of the board (along the line between the heroes). Every sword converges on it from off
  // screen, its point planted a little short of it, so the blades form a star round the holy ring.
  const centre = { x: a.x + (d.x - a.x) * c.swordAlong, y: a.y + (d.y - a.y) * c.swordAlong };
  const heads = swordHeadings(p.swords.length, c.swordAngle, c.swordJitter);
  const far = 1500 * unit;
  const swords = p.swords.map((w, i) => {
    const ang = heads[i]!;
    const ux = Math.cos(ang), uy = Math.sin(ang);
    const hub = radius * c.swordPlant;
    const len = 300 * unit * c.swordSize * w.size;
    return { from: { x: centre.x + ux * far, y: centre.y + uy * far }, tip: { x: centre.x + ux * hub, y: centre.y + uy * hub }, len, ang };
  });
  const swordTip = centre;
  // THE PATH: from the centre to the struck hero, runes spaced along it (denser for a longer path).
  const dx = foot.x - swordTip.x, dy = foot.y - swordTip.y;
  const len = Math.hypot(dx, dy);
  const ang = Math.atan2(dy, dx);
  const count = c.runeDensity > 0 ? clamp(Math.round((len / (70 * unit)) * c.runeDensity), 2, HOLY_CAPS.runes) : 0;
  const nx = -Math.sin(ang), ny = Math.cos(ang);
  const runes: HolyRune[] = [];
  for (let i = 0; i < count; i++) {
    const u = (i + 0.7) / (count + 0.4);
    const side = ((i % 2) ? 1 : -1) * (6 + ((i * 11) % 5) * 3) * unit * c.pathWidth;
    runes.push({
      at: { x: swordTip.x + dx * u + nx * side, y: swordTip.y + dy * u + ny * side },
      u, kind: i % 3, rot: ((i * 37) % 360) * (Math.PI / 180), pillar: i % 3 === 1,
    });
  }
  // THE CRACKS: a jagged main crack from the blast to the target (a zigzag across the line, seeded by the geometry so a
  // replay tears the same one), and two thinner cracks wandering beside it that peter out before the end.
  const rnd = seededRng(((Math.round(len) * 131) ^ (Math.round(swordTip.x) * 7) ^ Math.round(foot.y)) >>> 0);
  const crack = (off: number, until: number, jag: number): Pt[] => {
    const nPts = clamp(Math.round((len * until) / (32 * unit)), 3, HOLY_CAPS.crackPts);
    const pts: Pt[] = [];
    for (let i = 0; i <= nPts; i++) {
      const u = (i / nPts) * until;
      const ends = i === 0 || (until >= 1 && i === nPts);
      const side = ends ? 0 : off * Math.sin(Math.PI * u) + (rnd() - 0.5) * 2 * jag * unit * (i % 2 ? 1 : -0.7);
      pts.push({ x: swordTip.x + dx * u + nx * side, y: swordTip.y + dy * u + ny * side });
    }
    return pts;
  };
  const cracks = len > 1 ? [crack(0, 1, 11), crack(-26 * unit * c.pathWidth, 0.82, 7), crack(22 * unit * c.pathWidth, 0.7, 7)] : [];
  return { foot, spears, centre, swords, path: { a: { ...centre }, b: foot, len, ang }, runes, cracks };
}

// ─── the camera (pure) ─────────────────────────────────────────────────────────────────────────────────────────

const springAt = (ms: number, hz: number, tau: number): number => (ms < 0 ? 0 : Math.exp(-ms / tau) * Math.cos(2 * Math.PI * hz * (ms / 1000)));

/**
 * The camera at sequence time `t` (px in the space the points are in). A push in on the hero through the invoke; a
 * small kick down on each tick; on THE smite a punch in and a shake that follows the pillar DOWN. Tier IV pushes in
 * toward the sword through its hang, punches on the slam (hardest, straight down), rides the consecration, and punches
 * again on the eruption. Deterministic (sines and springs): a replay moves identically. Pure.
 */
export function holyCameraAt(p: HolyPlan, c: HeroHolyConfig, t: number): { zoom: number; x: number; y: number } {
  if (p.reduced) return { zoom: 1, x: 0, y: 0 };
  let z = 0;
  const down = { x: 0, y: 1 };
  if (t >= p.chargeAt && t < p.impactAt) {
    z += p.zoom * easeInOutSine((t - p.chargeAt) / Math.max(1, p.prayAt - p.chargeAt));
    if (p.sword && p.swords.length) {
      // Every bite punches in a little harder (the ramp); the implosion sucks the view in; the release lets it go.
      p.swords.forEach((w, i) => { if (t >= w.arriveAt) z += p.punch * (0.35 + 0.65 * (i / Math.max(1, p.swords.length - 1))) * Math.exp(-(t - w.arriveAt) / 90); });
      if (t >= p.implodeAt && t < p.spreadAt) z += p.zoom * 0.8 * Math.pow((t - p.implodeAt) / Math.max(1, p.spreadAt - p.implodeAt), 2);
      if (t >= p.spreadAt) z += (p.zoom * 0.8 + p.punch) * Math.exp(-(t - p.spreadAt) / 80);
    }
  } else if (t >= p.impactAt) {
    z += (p.zoom * (p.sword ? 1.6 : 1) + p.punch) * Math.exp(-(t - p.impactAt) / Math.max(1, c.zoomOutMs / 4));
  }
  let x = 0, y = 0;
  const kick = (at: number, amp: number, tau: number, hz: number, v: Pt): void => {
    const age = t - at;
    if (age < 0) return;
    const s = springAt(age, hz, tau);
    const across = amp * 0.22 * Math.sin(age * 0.09) * Math.exp(-age / tau);
    x += v.x * amp * s + -v.y * across;
    y += v.y * amp * s + v.x * across;
  };
  p.hits.forEach((at, i) => kick(at, p.shakePx * (0.25 + 0.04 * i), 45, 17, down));
  if (p.sword) {
    // Each bite kicks along its own heading, harder as they ramp; the implosion trembles; the release kicks.
    const heads = swordHeadings(p.swords.length, c.swordAngle, c.swordJitter);
    p.swords.forEach((w, i) => {
      const k = 0.3 + 0.7 * (i / Math.max(1, p.swords.length - 1));
      const ang = heads[i]!;
      kick(w.arriveAt, p.shakePx * 0.6 * k, 45, 16, { x: -Math.cos(ang), y: -Math.sin(ang) });
    });
    if (t >= p.implodeAt && t < p.spreadAt) {
      const u = (t - p.implodeAt) / Math.max(1, p.spreadAt - p.implodeAt);
      const a = p.shakePx * 0.3 * u * u;
      x += a * Math.sin(t * 0.31); y += a * Math.sin(t * 0.27 + 0.7);
    }
    kick(p.spreadAt, p.shakePx * 0.7, 60, 15, down);
    const age = t - p.impactAt;
    if (age >= 0) {
      const env = Math.exp(-age / Math.max(1, c.shakeMs / 4));
      x += p.shakePx * 0.6 * env * Math.sin(age * 0.105 + 0.5);
      y += p.shakePx * 0.9 * env * Math.cos(age * 0.093);
    }
  } else {
    kick(p.impactAt, p.shakePx, Math.max(1, c.shakeMs / 4), 16, down);
  }
  return { zoom: 1 + Math.max(0, z), x, y };
}

/**
 * Where the camera anchors: the ATTACKER through the invoke, the DEFENDER from the smite's drop on (I-III). Tier IV: the
 * attacker, then the SWORD through its hang and slam, then along the consecration to the defender. A zoom anchored on a
 * point keeps that point still. Pure.
 */
export function holyCameraFocus(p: HolyPlan, t: number, a: Pt, d: Pt, sword: Pt | null = null): Pt {
  const lerp = (u: number, from: Pt, to: Pt): Pt => { const e = easeInOutSine(u); return { x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e }; };
  if (t <= p.prayAt) return a;
  if (p.sword && sword) {
    const first = p.swords[0]?.arriveAt ?? p.implodeAt;
    if (t <= first) return lerp((t - p.prayAt) / Math.max(1, first - p.prayAt), a, sword);
    if (t <= p.spreadAt) return sword;
    if (t <= p.arriveAt) return lerp((t - p.spreadAt) / Math.max(1, p.arriveAt - p.spreadAt), sword, d);
    return d;
  }
  const settle = p.spears.length ? p.spears[0]!.launchAt : (p.smites[0]?.dropAt ?? p.impactAt);
  if (t >= settle) return d;
  return lerp((t - p.prayAt) / Math.max(1, settle - p.prayAt), a, d);
}
