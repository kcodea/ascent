/**
 * THE ENRAGED STRIKE HERO ATTACK: its tuned values, its pure timeline, the hero's pure pose and the pure camera.
 *
 * Owner 2026-09-28: "branch off and make one more animation, which is just a legendary version of this strike. it should
 * be a 10x more exciting and oomphier more impactful and pixi animation dense attack animation, but basically a legendary
 * version of this attack, just amplified or enraged." ("this strike" = Classic, the hero portrait's own lunge.)
 *
 * So the SILHOUETTE is Classic's (the portrait winds up by pulling back along the line and swelling, then drives into
 * the foe corner-first, clacks, and springs home) and every beat is amplified. THE BEATS (base ms before the speed):
 *  1. THE DAMAGE FORMATION (shared by every style, `../heroAttack/damageFormation.ts`). Its end is this style's start.
 *  2. WINDUP. The total dives into the hero; the portrait pulls back and swells while a burning rage aura (flame tongues
 *     licking off the rim, a hot rim glow) ignites round it, ground dust is sucked in, a charge tone rises and the
 *     portrait trembles harder and harder.
 *  3. LUNGE. A brutal dash (it hangs, then blurs: a cubic-in drive) leaving a thick wake of rage, afterimages of the
 *     portrait fading behind it, and speed lines.
 *  4. STRIKE. White-hot flash, a hit-stop, a shockwave ring and a second ring, claw rips torn across the foe portrait,
 *     chunky sparks and embers with gravity, a camera punch and a directional shake, the foe knocked back and squashed.
 *     II strikes twice (a quick pull back and a second drive); III is a flurry of three, the last a bigger finisher.
 *     IV: the hero RISES (lifted toward the top of the screen and swelling toward the camera: a fireball of rage),
 *     hangs, and SLAMS down on the foe like a meteor: a screen-filling flash, a scorched crater with glowing cracks,
 *     rock debris and an ember explosion. Every strike before the last is a TICK (FX and sound only).
 *  5. RECOVER. The hero springs home trailing embers and steam; the foe smoulders.
 *
 * THE CONSEQUENCE (the damage, Armor, Resolve) lands exactly ONCE, on the LAST strike (IV: the meteor). The big `-N`
 * lands there too. TIERS are the shared, owner-approved thresholds (I 1-5, II 6-11, III 12-19, IV 20+).
 *
 * Tuner convention (the others'): localStorage in DEV only, values clamped on write and on load; production always plays
 * DEFAULTS. The preview speed is how you are LOOKING and is never saved.
 */
import { clamp, easeInOutSine, easeOutCubic, spring, type Pt } from '../heroAttack/easing';
import {
  HERO_ATTACK_TIER_THRESHOLDS, TIERS, reducedAttackTimeline, tierOf, type TierNum,
} from '../heroAttack/tiers';

export { TIERS, type TierNum };

/** The per-tier dials. A config key is `t1..t4` + one of these. */
export const ENRAGED_TIER_SUFFIXES = [
  'WindupMs', 'Strikes', 'DriveMs', 'GapMs', 'FinisherMs', 'Meteor',
  'HitStop', 'Shake', 'Zoom', 'Punch', 'Aura', 'Sparks', 'Embers', 'Slashes', 'Burst', 'SettleMs', 'Dim',
] as const;
export type EnragedTierSuffix = (typeof ENRAGED_TIER_SUFFIXES)[number];
type TierKey = `t${TierNum}${EnragedTierSuffix}`;

interface GlobalConfig {
  // Tiers (the shared thresholds; DEV-tunable only)
  tier2At: number; tier3At: number; tier4At: number;
  // Windup
  absorbMs: number;
  windupLeadMs: number;
  windupDepth: number;
  windupSwell: number;
  leadTilt: number;
  tremblePx: number;
  // Lunge and strike
  contactGap: number;
  contactSwell: number;
  reboundDepth: number;
  holdMs: number;
  recoverMs: number;
  recoverHz: number;
  // Meteor (Tier IV)
  riseLift: number;
  riseSwell: number;
  apexHoldMs: number;
  craterSize: number;
  debris: number;
  // Aura
  auraSize: number;
  flames: number;
  flameLength: number;
  dust: number;
  // Afterimages, wake and speed lines
  ghosts: number;
  ghostStepMs: number;
  ghostAlpha: number;
  wakeWidth: number;
  wakeMs: number;
  speedLines: number;
  // Impact
  ringSize: number;
  ring2Size: number;
  slashLength: number;
  slashWidth: number;
  sparkSpeed: number;
  emberLife: number;
  flashAlpha: number;
  smoulderMs: number;
  // Camera and portraits
  knockPx: number;
  squash: number;
  shakeMs: number;
  zoomOutMs: number;
  shakeCap: number;
  zoomCap: number;
  reducedFadeMs: number;
  // Colours
  colorCore: string;
  colorHot: string;
  colorPlayer: string;
  colorFoe: string;
  colorShade: string;
  colorSmoke: string;
  // Sound: a clip, a gain and a pitch per cue ('' = silent)
  sfxRoarClip: string; sfxRoarGain: number; sfxRoarRate: number;
  sfxWindupClip: string; sfxWindupGain: number; sfxWindupRate: number;
  sfxChargeClip: string; sfxChargeGain: number; sfxChargeRate: number;
  sfxWhooshClip: string; sfxWhooshGain: number; sfxWhooshRate: number;
  sfxTickClip: string; sfxTickGain: number; sfxTickRate: number;
  sfxSlashClip: string; sfxSlashGain: number; sfxSlashRate: number;
  sfxImpactClip: string; sfxImpactGain: number; sfxImpactRate: number;
  sfxPunchClip: string; sfxPunchGain: number; sfxPunchRate: number;
  sfxThumpClip: string; sfxThumpGain: number; sfxThumpRate: number;
  sfxBigClip: string; sfxBigGain: number; sfxBigRate: number;
  sfxMeteorClip: string; sfxMeteorGain: number; sfxMeteorRate: number;
  sfxDebrisClip: string; sfxDebrisGain: number; sfxDebrisRate: number;
  sfxToneGain: number; sfxToneLowHz: number; sfxToneHighHz: number;
  sfxCrackleGain: number;
  sfxRumbleGain: number;
  sfxImpactLenMs: number;
  sfxTailMix: number;
  sfxDuck: number;
  // Preview only (the tuner's Play buttons). Never read by a real fight, and left out of Copy JSON.
  previewDamage: number;
  previewParts: number;
}
export type HeroEnragedConfig = GlobalConfig & Record<TierKey, number>;

export const HERO_ENRAGED_COLOR_KEYS = ['colorCore', 'colorHot', 'colorPlayer', 'colorFoe', 'colorShade', 'colorSmoke'] as const;
export const HERO_ENRAGED_CLIP_KEYS = [
  'sfxRoarClip', 'sfxWindupClip', 'sfxChargeClip', 'sfxWhooshClip', 'sfxTickClip', 'sfxSlashClip', 'sfxImpactClip',
  'sfxPunchClip', 'sfxThumpClip', 'sfxBigClip', 'sfxMeteorClip', 'sfxDebrisClip',
] as const;
type ColorKey = (typeof HERO_ENRAGED_COLOR_KEYS)[number];
type ClipKey = (typeof HERO_ENRAGED_CLIP_KEYS)[number];
export type HeroEnragedStrKey = ColorKey | ClipKey;
export type HeroEnragedNumKey = Exclude<keyof HeroEnragedConfig, HeroEnragedStrKey>;

/** Tier I .. IV per suffix: the escalation ladder. */
const TIER_DEFAULTS: Record<EnragedTierSuffix, [number, number, number, number]> = {
  WindupMs: [620, 640, 680, 1150],
  Strikes: [1, 2, 3, 1],
  DriveMs: [190, 180, 170, 250],
  GapMs: [0, 170, 140, 0],
  FinisherMs: [0, 0, 170, 0],
  Meteor: [0, 0, 0, 1],
  HitStop: [110, 125, 150, 210],
  Shake: [9, 11, 14, 24],
  Zoom: [0.03, 0.035, 0.045, 0.07],
  Punch: [0.03, 0.04, 0.05, 0.08],
  Aura: [0.85, 1, 1.15, 1.5],
  Sparks: [26, 30, 40, 70],
  Embers: [18, 22, 30, 64],
  Slashes: [3, 3, 4, 5],
  Burst: [1, 1.1, 1.25, 1.75],
  SettleMs: [240, 260, 300, 380],
  Dim: [0.12, 0.2, 0.3, 0.5],
};

export const ENRAGED_TIER_RANGES: Record<EnragedTierSuffix, [number, number, number]> = {
  WindupMs: [150, 2000, 10],
  Strikes: [1, 5, 1],
  DriveMs: [80, 600, 5],
  GapMs: [60, 600, 5],
  FinisherMs: [0, 600, 5],
  Meteor: [0, 1, 1],
  HitStop: [0, 300, 5],
  Shake: [0, 40, 0.5],
  Zoom: [0, 0.14, 0.002],
  Punch: [0, 0.14, 0.002],
  Aura: [0, 3, 0.05],
  Sparks: [0, 120, 1],
  Embers: [0, 120, 1],
  Slashes: [0, 8, 1],
  Burst: [0.3, 3, 0.05],
  SettleMs: [0, 1600, 10],
  Dim: [0, 0.8, 0.01],
};

const tierDefaults = Object.fromEntries(TIERS.flatMap((t) => ENRAGED_TIER_SUFFIXES.map((s) => [`t${t}${s}`, TIER_DEFAULTS[s][t - 1]]))) as Record<TierKey, number>;

export const HERO_ENRAGED_DEFAULTS: HeroEnragedConfig = {
  // The shared, owner-approved thresholds (6 / 12 / 20): the same blow steps every style up at the same place.
  ...HERO_ATTACK_TIER_THRESHOLDS,
  absorbMs: 200,
  windupLeadMs: 110,
  // Classic's lunge is 0.13 deep and swells to 1.32 (`lungeConfig.ts`); the enraged one goes a touch further.
  windupDepth: 0.15,
  windupSwell: 0.36,
  leadTilt: 9,
  tremblePx: 3.2,
  contactGap: 0.5,
  contactSwell: 0.12,
  reboundDepth: 0.55,
  holdMs: 80,
  recoverMs: 640,
  recoverHz: 1.7,
  riseLift: 0.3,
  riseSwell: 0.55,
  apexHoldMs: 120,
  craterSize: 1,
  debris: 22,
  auraSize: 1,
  flames: 16,
  flameLength: 1,
  dust: 26,
  ghosts: 6,
  ghostStepMs: 24,
  ghostAlpha: 0.55,
  wakeWidth: 1,
  wakeMs: 150,
  speedLines: 12,
  ringSize: 1,
  ring2Size: 1,
  slashLength: 1,
  slashWidth: 1,
  sparkSpeed: 1,
  emberLife: 1,
  flashAlpha: 0.95,
  smoulderMs: 1200,
  knockPx: 30,
  squash: 0.14,
  shakeMs: 380,
  zoomOutMs: 420,
  shakeCap: 30,
  zoomCap: 0.1,
  reducedFadeMs: 260,
  colorCore: '#ffffff',
  colorHot: '#ffd36b',
  colorPlayer: '#ff5a14',
  colorFoe: '#ff1f35',
  colorShade: '#6e0f00',
  colorSmoke: '#2b1b16',
  sfxRoarClip: 'fx/dragon-growl-2', sfxRoarGain: 0.3, sfxRoarRate: 1.2,
  sfxWindupClip: 'windup', sfxWindupGain: 0.8, sfxWindupRate: 0.92,
  sfxChargeClip: 'fx/oona-powerup', sfxChargeGain: 0.4, sfxChargeRate: 0.9,
  sfxWhooshClip: 'fx/stereogenicstudio-swish-swoosh-woosh-sfx-27-357164-3', sfxWhooshGain: 0.6, sfxWhooshRate: 1.1,
  sfxTickClip: 'smack3', sfxTickGain: 0.75, sfxTickRate: 1.05,
  sfxSlashClip: 'cleave2', sfxSlashGain: 0.45, sfxSlashRate: 1.1,
  sfxImpactClip: 'titanhammer', sfxImpactGain: 0.7, sfxImpactRate: 1.12,
  sfxPunchClip: 'smack2', sfxPunchGain: 0.7, sfxPunchRate: 0.95,
  sfxThumpClip: 'fx/heavy-rock-impact', sfxThumpGain: 0.45, sfxThumpRate: 1.15,
  sfxBigClip: 'crit', sfxBigGain: 0.45, sfxBigRate: 1.05,
  sfxMeteorClip: 'fx/universfield-ground-impact-352053', sfxMeteorGain: 0.6, sfxMeteorRate: 1.12,
  sfxDebrisClip: 'fx/triple-impact', sfxDebrisGain: 0.3, sfxDebrisRate: 1.25,
  sfxToneGain: 0.3, sfxToneLowHz: 70, sfxToneHighHz: 220,
  sfxCrackleGain: 0.35,
  sfxRumbleGain: 0.35,
  sfxImpactLenMs: 1000,
  sfxTailMix: 0.12,
  sfxDuck: 0.5,
  previewDamage: 12,
  previewParts: 4,
  ...tierDefaults,
};

const GLOBAL_RANGES: Record<Exclude<keyof GlobalConfig, HeroEnragedStrKey>, [number, number, number]> = {
  tier2At: [2, 40, 1], tier3At: [2, 60, 1], tier4At: [2, 80, 1],
  absorbMs: [60, 600, 10],
  windupLeadMs: [0, 600, 10],
  windupDepth: [0, 0.4, 0.005],
  windupSwell: [0, 0.8, 0.01],
  leadTilt: [0, 30, 0.5],
  tremblePx: [0, 12, 0.1],
  contactGap: [0, 1.2, 0.01],
  contactSwell: [0, 0.5, 0.01],
  reboundDepth: [0, 1.5, 0.01],
  holdMs: [0, 400, 5],
  recoverMs: [150, 2000, 10],
  recoverHz: [0.5, 5, 0.05],
  riseLift: [0, 0.8, 0.01],
  riseSwell: [0, 1.2, 0.01],
  apexHoldMs: [0, 600, 5],
  craterSize: [0, 3, 0.05],
  debris: [0, 60, 1],
  auraSize: [0.3, 3, 0.05],
  flames: [0, 32, 1],
  flameLength: [0.2, 3, 0.05],
  dust: [0, 60, 1],
  ghosts: [0, 10, 1],
  ghostStepMs: [8, 80, 1],
  ghostAlpha: [0, 1, 0.01],
  wakeWidth: [0, 3, 0.05],
  wakeMs: [20, 400, 5],
  speedLines: [0, 40, 1],
  ringSize: [0, 3, 0.05],
  ring2Size: [0, 3, 0.05],
  slashLength: [0.2, 3, 0.05],
  slashWidth: [0.2, 3, 0.05],
  sparkSpeed: [0.2, 3, 0.05],
  emberLife: [0.2, 3, 0.05],
  flashAlpha: [0, 1, 0.01],
  smoulderMs: [0, 3000, 10],
  knockPx: [0, 80, 1],
  squash: [0, 0.4, 0.01],
  shakeMs: [0, 1500, 10],
  zoomOutMs: [60, 1500, 10],
  shakeCap: [0, 60, 0.5],
  zoomCap: [0, 0.2, 0.002],
  reducedFadeMs: [60, 1000, 10],
  sfxRoarGain: [0, 2, 0.05], sfxRoarRate: [0.5, 2, 0.01],
  sfxWindupGain: [0, 2, 0.05], sfxWindupRate: [0.5, 2, 0.01],
  sfxChargeGain: [0, 2, 0.05], sfxChargeRate: [0.5, 2, 0.01],
  sfxWhooshGain: [0, 2, 0.05], sfxWhooshRate: [0.5, 2, 0.01],
  sfxTickGain: [0, 2, 0.05], sfxTickRate: [0.5, 2, 0.01],
  sfxSlashGain: [0, 2, 0.05], sfxSlashRate: [0.5, 2, 0.01],
  sfxImpactGain: [0, 2, 0.05], sfxImpactRate: [0.5, 2, 0.01],
  sfxPunchGain: [0, 2, 0.05], sfxPunchRate: [0.5, 2, 0.01],
  sfxThumpGain: [0, 2, 0.05], sfxThumpRate: [0.5, 2, 0.01],
  sfxBigGain: [0, 2, 0.05], sfxBigRate: [0.5, 2, 0.01],
  sfxMeteorGain: [0, 2, 0.05], sfxMeteorRate: [0.5, 2, 0.01],
  sfxDebrisGain: [0, 2, 0.05], sfxDebrisRate: [0.5, 2, 0.01],
  sfxToneGain: [0, 2, 0.05], sfxToneLowHz: [30, 400, 1], sfxToneHighHz: [60, 1200, 5],
  sfxCrackleGain: [0, 2, 0.05],
  sfxRumbleGain: [0, 2, 0.05],
  sfxImpactLenMs: [150, 3500, 10],
  sfxTailMix: [0, 0.6, 0.01],
  sfxDuck: [0, 1, 0.05],
  previewDamage: [1, 60, 1],
  previewParts: [1, 8, 1],
};

/** [min, max, step] per numeric key. Values outside are clamped on write AND on load. */
export const HERO_ENRAGED_RANGES: Record<HeroEnragedNumKey, [number, number, number]> = {
  ...GLOBAL_RANGES,
  ...(Object.fromEntries(TIERS.flatMap((t) => ENRAGED_TIER_SUFFIXES.map((s) => [`t${t}${s}`, ENRAGED_TIER_RANGES[s]]))) as Record<TierKey, [number, number, number]>),
};

/** The hard ceilings a plan can never exceed, whatever the sliders say (so a 40 stays readable, not nauseating). */
export const ENRAGED_CAPS = { strikes: 5, sparks: 120, embers: 120, slashes: 8, hitStopMs: 300, shakePx: 40, zoom: 0.14 } as const;

const HEX = /^#[0-9a-f]{6}$/i;
const isColorKey = (k: string): k is ColorKey => (HERO_ENRAGED_COLOR_KEYS as readonly string[]).includes(k);
const isClipKey = (k: string): k is ClipKey => (HERO_ENRAGED_CLIP_KEYS as readonly string[]).includes(k);

/** One value, made safe: numbers clamped into range (junk = the default), colours #rrggbb, clips a short string. */
export function clampHeroEnragedValue<K extends keyof HeroEnragedConfig>(key: K, value: unknown): HeroEnragedConfig[K] | undefined {
  if (!Object.prototype.hasOwnProperty.call(HERO_ENRAGED_DEFAULTS, key)) return undefined;
  const def = HERO_ENRAGED_DEFAULTS[key];
  if (isColorKey(key)) {
    if (typeof value !== 'string') return def;
    const v = value.trim();
    return (HEX.test(v) ? v.toLowerCase() : def) as HeroEnragedConfig[K];
  }
  if (isClipKey(key)) return (typeof value === 'string' ? value.trim().slice(0, 160) : def) as HeroEnragedConfig[K];
  const n = typeof value === 'number' ? value : Number(value);
  if (typeof value === 'boolean' || value === null || value === '' || !Number.isFinite(n)) return def;
  const [min, max] = HERO_ENRAGED_RANGES[key as HeroEnragedNumKey];
  return Math.min(max, Math.max(min, n)) as HeroEnragedConfig[K];
}

/** A whole saved object, sanitised key by key over the defaults (junk and unknown keys dropped). */
export function sanitizeHeroEnragedConfig(saved: unknown): HeroEnragedConfig {
  const out: HeroEnragedConfig = { ...HERO_ENRAGED_DEFAULTS };
  if (!saved || typeof saved !== 'object') return out;
  for (const [k, v] of Object.entries(saved as Record<string, unknown>)) {
    const safe = clampHeroEnragedValue(k as keyof HeroEnragedConfig, v);
    if (safe !== undefined) (out as unknown as Record<string, unknown>)[k] = safe;
  }
  return out;
}

const KEY = 'ascent.heroenraged.v1';

let cfg: HeroEnragedConfig = (() => {
  if (!import.meta.env.DEV || typeof localStorage === 'undefined') return { ...HERO_ENRAGED_DEFAULTS };
  try { return sanitizeHeroEnragedConfig(JSON.parse(localStorage.getItem(KEY) ?? '{}')); } catch { return { ...HERO_ENRAGED_DEFAULTS }; }
})();

export function getHeroEnragedConfig(): HeroEnragedConfig { return cfg; }

export function setHeroEnragedValue(key: keyof HeroEnragedConfig, value: number | string): void {
  const safe = clampHeroEnragedValue(key, value);
  if (safe === undefined) return;
  cfg = { ...cfg, [key]: safe };
  if (!import.meta.env.DEV) return;
  try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch { /* ignore */ }
}

export function resetHeroEnragedConfig(): void {
  cfg = { ...HERO_ENRAGED_DEFAULTS };
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}

/** The tuned values as JSON for pasting back into DEFAULTS (the preview-only keys left out). */
export function heroEnragedConfigJson(c: HeroEnragedConfig = cfg): string {
  const ship: Partial<HeroEnragedConfig> = { ...c };
  delete ship.previewDamage;
  delete ship.previewParts;
  return JSON.stringify(ship, null, 2);
}

// ─── the preview speed (DEV only, never saved) ─────────────────────────────────────────────────────────────────

export const HERO_ENRAGED_SPEEDS = [1, 0.5, 0.25] as const;
export type HeroEnragedSpeed = (typeof HERO_ENRAGED_SPEEDS)[number];
let speed: HeroEnragedSpeed = 1;
/** The tuner's slow motion. Always 1 in production. */
export function heroEnragedPreviewSpeed(): HeroEnragedSpeed { return import.meta.env.DEV ? speed : 1; }
export function setHeroEnragedPreviewSpeed(s: HeroEnragedSpeed): void { speed = s; }

// ─── the pure plan ─────────────────────────────────────────────────────────────────────────────────────────────

/** One tier's dials, read out of the config. */
export function enragedTierDials(tier: TierNum, c: HeroEnragedConfig = cfg): Record<EnragedTierSuffix, number> {
  return Object.fromEntries(ENRAGED_TIER_SUFFIXES.map((s) => [s, c[`t${tier}${s}`]])) as Record<EnragedTierSuffix, number>;
}

export interface EnragedStrike {
  /** The hero starts driving at the foe. */
  driveAt: number;
  /** Contact: a tick, or (the last) THE impact. */
  contactAt: number;
  /** The last strike: the consequence lands here. */
  final: boolean;
  /** The Tier IV meteor slam (it drives from the apex, not from a pull back). */
  meteor: boolean;
  /** How deep the pull back BEFORE this drive goes, as a multiple of the windup depth (the windup is 1). */
  pull: number;
}

export interface EnragedPlanInput {
  /** When the style's own attack starts: the end of the shared damage formation (`formationPlan().endAt`). */
  leadIn?: number;
  /** THE blow, as the engine decided it. */
  total: number;
  reduced?: boolean;
}

export interface EnragedPlan {
  reduced: boolean;
  tier: TierNum;
  /** 0..1 across the tiers (I = 0, IV = 1). */
  k: number;
  total: number;
  /** The total starts diving into the hero. */
  chargeAt: number;
  absorbEnd: number;
  /** The hero starts pulling back (and the aura ignites). */
  windupAt: number;
  /** Tier IV: the hero starts rising from here (the last pull back becomes a rise). Else = the first drive. */
  riseAt: number;
  /** Tier IV: the hero hangs at the top of the rise from here until the slam. Else = the first drive. */
  apexAt: number;
  strikes: EnragedStrike[];
  meteor: boolean;
  /** Contacts BEFORE the impact (sequence ms): the ticks. */
  ticks: number[];
  /** THE consequence beat: the last strike's contact. */
  impactAt: number;
  hitStopMs: number;
  /** The hero starts springing home. */
  recoverAt: number;
  /** The hero is home. */
  homeAt: number;
  /** Tier IV: debris landing round the crater (sequence ms). */
  booms: number[];
  endAt: number;
  shakePx: number;
  zoom: number;
  punch: number;
  aura: number;
  sparks: number;
  embers: number;
  slashes: number;
  burst: number;
  dim: number;
}

/** The whole Enraged Strike, in base ms (divide by the playback speed for real time). Pure and deterministic. */
export function enragedPlan(input: EnragedPlanInput, c: HeroEnragedConfig = cfg): EnragedPlan {
  const total = Math.max(0, Math.round(input.total));
  const tier = tierOf(total, c);
  const T = enragedTierDials(tier, c);
  const k = (tier - 1) / 3;

  if (input.reduced) {
    const r = reducedAttackTimeline(input.leadIn ?? 0, c.reducedFadeMs);
    const { impactAt } = r;
    return {
      reduced: true, tier, k, total, chargeAt: impactAt, absorbEnd: impactAt, windupAt: impactAt, riseAt: impactAt, apexAt: impactAt,
      strikes: [], meteor: false, ticks: [], impactAt, hitStopMs: 0, recoverAt: impactAt, homeAt: impactAt, booms: [], endAt: r.endAt,
      shakePx: 0, zoom: 0, punch: 0, aura: 0, sparks: 0, embers: 0, slashes: 0, burst: 0, dim: 0,
    };
  }

  const chargeAt = Math.max(0, input.leadIn ?? 0);
  const absorbEnd = chargeAt + c.absorbMs;
  const windupAt = chargeAt + Math.min(c.windupLeadMs, c.absorbMs);
  const meteor = T.Meteor >= 1;
  const n = clamp(Math.round(T.Strikes), 1, ENRAGED_CAPS.strikes);
  const strikes: EnragedStrike[] = [];
  let at = windupAt + T.WindupMs;
  let riseAt = at, apexAt = at;
  for (let i = 0; i < n; i++) {
    const last = i === n - 1;
    const isMeteor = last && meteor;
    if (i > 0) {
      // A pull back between hits: a quick one, a deeper one before a finisher, the rise before the meteor.
      if (isMeteor) { riseAt = at; at += T.WindupMs; apexAt = at; at += c.apexHoldMs; } else at += T.GapMs + (last && n > 2 ? T.FinisherMs : 0);
    } else if (isMeteor) {
      // A lone meteor: the windup IS the rise.
      riseAt = windupAt; apexAt = at; at += c.apexHoldMs;
    }
    const drive = isMeteor ? T.DriveMs : T.DriveMs * (i === 0 || last ? 1 : 0.85);
    const pull = i === 0 ? 1 : last && n > 2 ? c.reboundDepth * 1.7 : c.reboundDepth;
    strikes.push({ driveAt: at, contactAt: at + drive, final: last, meteor: isMeteor, pull });
    at += drive;
  }
  if (!meteor) { riseAt = strikes[0]!.driveAt; apexAt = riseAt; }
  const impactAt = strikes[n - 1]!.contactAt;
  const ticks = strikes.filter((s) => !s.final).map((s) => s.contactAt);
  const recoverAt = impactAt + c.holdMs + (meteor ? 140 : 0);
  const homeAt = recoverAt + c.recoverMs;
  const booms = meteor ? [impactAt + 170, impactAt + 330, impactAt + 520] : [];
  const lastBeat = Math.max(homeAt, impactAt + c.zoomOutMs * 0.9, booms.length ? booms[booms.length - 1]! + 150 : 0, impactAt + c.smoulderMs * 0.55);
  const endAt = lastBeat + T.SettleMs;

  return {
    reduced: false, tier, k, total, chargeAt, absorbEnd, windupAt, riseAt, apexAt, strikes, meteor, ticks, impactAt,
    hitStopMs: Math.round(clamp(T.HitStop, 0, ENRAGED_CAPS.hitStopMs)), recoverAt, homeAt, booms, endAt,
    shakePx: clamp(T.Shake, 0, Math.min(c.shakeCap, ENRAGED_CAPS.shakePx)),
    zoom: clamp(T.Zoom, 0, Math.min(c.zoomCap, ENRAGED_CAPS.zoom)),
    punch: clamp(T.Punch, 0, Math.min(c.zoomCap, ENRAGED_CAPS.zoom)),
    aura: T.Aura,
    sparks: Math.round(clamp(T.Sparks, 0, ENRAGED_CAPS.sparks)),
    embers: Math.round(clamp(T.Embers, 0, ENRAGED_CAPS.embers)),
    slashes: Math.round(clamp(T.Slashes, 0, ENRAGED_CAPS.slashes)),
    burst: T.Burst,
    dim: T.Dim,
  };
}

export type EnragedCueKind = 'charge' | 'windup' | 'rise' | 'apex' | 'drive' | 'tick' | 'impact' | 'boom' | 'recover' | 'end';
export interface EnragedCue { at: number; kind: EnragedCueKind; i: number }

/** Every beat the runner fires, in time order (ties keep this declaration order, so a tick precedes the next drive). */
export function enragedCues(p: EnragedPlan): EnragedCue[] {
  const out: EnragedCue[] = [];
  if (!p.reduced) {
    out.push({ at: p.chargeAt, kind: 'charge', i: 0 });
    out.push({ at: p.windupAt, kind: 'windup', i: 0 });
    if (p.meteor) { out.push({ at: p.riseAt, kind: 'rise', i: 0 }); out.push({ at: p.apexAt, kind: 'apex', i: 0 }); }
    p.strikes.forEach((s, i) => {
      out.push({ at: s.driveAt, kind: 'drive', i });
      if (!s.final) out.push({ at: s.contactAt, kind: 'tick', i });
    });
    out.push({ at: p.recoverAt, kind: 'recover', i: 0 });
  }
  out.push({ at: p.impactAt, kind: 'impact', i: 0 });
  p.booms.forEach((at, i) => out.push({ at, kind: 'boom', i }));
  out.push({ at: p.endAt, kind: 'end', i: 0 });
  const order: Record<EnragedCueKind, number> = { charge: 0, windup: 1, rise: 2, apex: 3, tick: 4, drive: 5, impact: 6, boom: 7, recover: 8, end: 9 };
  return out.map((q, idx) => ({ q, idx })).sort((a, b) => a.q.at - b.q.at || order[a.q.kind] - order[b.q.kind] || a.idx - b.idx).map((x) => x.q);
}

// ─── the hero's pose (pure) ────────────────────────────────────────────────────────────────────────────────────

/** Where the lunge goes, solved once from the two heroes (screen px, or host px in a sandbox). */
export interface EnragedGeo {
  /** Unit vector from the striking hero to the struck one. */
  u: Pt;
  dist: number;
  /** The windup's pull back (an offset from the hero's rest). */
  back: Pt;
  /** Where the hero's centre lands on contact (an offset from rest): into the foe, portraits overlapping. */
  contact: Pt;
  /** Tier IV: the top of the rise (an offset from rest), kept on screen. */
  apex: Pt;
  /** Which way the portrait tilts to lead with a corner (Classic's sign(dx) rule). */
  tiltSign: 1 | -1;
}

/** The geometry, from the two centres and radii. `ceilY` keeps the Tier IV apex below the top of the screen. */
export function enragedGeo(a: Pt, d: Pt, aR: number, dR: number, c: HeroEnragedConfig = cfg, ceilY = Number.NEGATIVE_INFINITY): EnragedGeo {
  const dx = d.x - a.x, dy = d.y - a.y;
  const dist = Math.hypot(dx, dy) || 1;
  const u = { x: dx / dist, y: dy / dist };
  const depth = c.windupDepth * dist;
  const gap = (aR + dR) * c.contactGap;
  const contact = { x: dx - u.x * gap, y: dy - u.y * gap };
  // The rise goes UP the screen (whichever way the foe lies) and a little back; near the top edge it lifts less and
  // swells toward the camera instead, so it never leaves the frame.
  const room = Math.max(0, a.y - ceilY - aR * (1 + c.riseSwell));
  const lift = Math.min(c.riseLift * dist, room);
  const apex = { x: -u.x * depth * 0.6, y: -u.y * depth * 0.6 - lift };
  return { u, dist, back: { x: -u.x * depth, y: -u.y * depth }, contact, apex, tiltSign: dx >= 0 ? 1 : -1 };
}

export interface HeroPose {
  /** Offset from the hero's rest (px in the points' space). */
  x: number; y: number;
  scale: number;
  /** Degrees. */
  rot: number;
  /** 0..1: how hard the rage burns (drives the aura). */
  heat: number;
}

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
/** The drive: it hangs, then blurs into contact (Classic's expo-in read, softened so the wake still has a body). */
export const driveEase = (u: number): number => { const t = Math.min(1, Math.max(0, Number.isFinite(u) ? u : 0)); return 0.08 * t + 0.92 * t * t * t; };

/**
 * The striking hero's pose at sequence time `t`. Pure and deterministic (the tremble is sines, not noise): a replay
 * moves identically, and the scene draws the afterimages and the wake by sampling this back in time.
 */
export function enragedPose(p: EnragedPlan, g: EnragedGeo, c: HeroEnragedConfig, t: number): HeroPose {
  const rest: HeroPose = { x: 0, y: 0, scale: 1, rot: 0, heat: 0 };
  if (p.reduced || t < p.windupAt) return rest;
  const tilt = c.leadTilt * g.tiltSign;
  const swell = 1 + c.windupSwell;
  const hit = 1 + c.contactSwell;
  const first = p.strikes[0]!;
  const tremble = (amp: number): Pt => ({ x: amp * Math.sin(t * 0.37 + 0.4), y: amp * Math.sin(t * 0.51 + 1.7) });

  // WINDUP (or, for a lone meteor, the RISE): pull back along the line, swell, tilt, tremble harder and harder.
  if (t < first.driveAt) {
    if (first.meteor) return risePose(p, g, c, t, (t - p.windupAt) / Math.max(1, p.apexAt - p.windupAt));
    const u = (t - p.windupAt) / Math.max(1, first.driveAt - p.windupAt);
    const e = easeOutCubic(Math.min(1, u * 1.15));
    const tr = tremble(c.tremblePx * u * u * (0.8 + 0.4 * p.k));
    return { x: g.back.x * e + tr.x, y: g.back.y * e + tr.y, scale: lerp(1, swell, easeInOutSine(u)), rot: tilt * e, heat: easeInOutSine(u) };
  }

  for (let i = 0; i < p.strikes.length; i++) {
    const s = p.strikes[i]!;
    const next = p.strikes[i + 1];
    // THE DRIVE: from wherever the pull back (or the apex) left it, into contact.
    if (t < s.contactAt) {
      const from = drivePose(p, g, c, i);
      const e = s.meteor ? Math.pow(Math.min(1, Math.max(0, (t - s.driveAt) / Math.max(1, s.contactAt - s.driveAt))), 2.2)
        : driveEase((t - s.driveAt) / Math.max(1, s.contactAt - s.driveAt));
      return { x: lerp(from.x, g.contact.x, e), y: lerp(from.y, g.contact.y, e), scale: lerp(from.scale, hit * (s.meteor ? 1.15 : 1), e), rot: lerp(from.rot, tilt, e), heat: 1 };
    }
    // A PULL BACK before the next strike (not after the last): out of the foe, back along the line, swelling again.
    if (next && t < next.driveAt) {
      if (next.meteor) return risePose(p, g, c, t, (t - s.contactAt) / Math.max(1, p.apexAt - s.contactAt), g.contact);
      const u = (t - s.contactAt) / Math.max(1, next.driveAt - s.contactAt);
      const to = drivePose(p, g, c, i + 1);
      const e = easeOutCubic(u);
      const tr = tremble(c.tremblePx * 0.5 * u);
      return { x: lerp(g.contact.x, to.x, e) + tr.x, y: lerp(g.contact.y, to.y, e) + tr.y, scale: lerp(hit, to.scale, e), rot: lerp(tilt, to.rot, e), heat: 1 };
    }
  }

  // AFTER THE IMPACT: held in the foe a breath, then springing home (overshooting a little), the rage cooling.
  const since = t - p.recoverAt;
  if (since < 0) return { x: g.contact.x, y: g.contact.y, scale: hit * (p.meteor ? 1.15 : 1), rot: tilt, heat: 1 };
  const k = spring(since, c.recoverHz, c.recoverMs / 4.2);
  const home = Math.abs(k) < 0.002 ? 0 : k;
  const cool = Math.max(0, 1 - since / Math.max(1, c.recoverMs));
  return {
    x: g.contact.x * home, y: g.contact.y * home,
    scale: 1 + (hit * (p.meteor ? 1.15 : 1) - 1) * home,
    rot: -tilt * 0.35 * Math.sin(Math.min(1, since / 90) * Math.PI) * cool + tilt * home,
    heat: cool * cool,
  };
}

/** Where a drive starts: the end of its pull back (the windup for the first; the apex for a meteor). */
function drivePose(p: EnragedPlan, g: EnragedGeo, c: HeroEnragedConfig, i: number): HeroPose {
  const s = p.strikes[i]!;
  const tilt = c.leadTilt * g.tiltSign;
  if (s.meteor) return { x: g.apex.x, y: g.apex.y, scale: 1 + c.riseSwell, rot: -tilt * 0.6, heat: 1 };
  if (i === 0) return { x: g.back.x, y: g.back.y, scale: 1 + c.windupSwell, rot: tilt, heat: 1 };
  // Between hits: pulled back out of the foe by `pull` x the windup depth, measured from the contact point.
  return {
    x: g.contact.x + g.back.x * s.pull, y: g.contact.y + g.back.y * s.pull,
    scale: 1 + c.windupSwell * Math.min(1, 0.45 + 0.35 * s.pull), rot: tilt, heat: 1,
  };
}

/** The Tier IV rise: up to the apex, swelling toward the camera, trembling, then a hovering bob until the slam. */
function risePose(p: EnragedPlan, g: EnragedGeo, c: HeroEnragedConfig, t: number, u: number, from: Pt = { x: 0, y: 0 }): HeroPose {
  const tilt = c.leadTilt * g.tiltSign;
  const e = easeInOutSine(Math.min(1, u));
  const amp = c.tremblePx * (0.6 + 1.2 * e * e);
  const bob = t >= p.apexAt ? Math.sin((t - p.apexAt) * 0.02) * 3 : 0;
  return {
    x: lerp(from.x, g.apex.x, e) + amp * Math.sin(t * 0.37 + 0.4),
    y: lerp(from.y, g.apex.y, e) + amp * Math.sin(t * 0.51 + 1.7) - bob,
    scale: lerp(1, 1 + c.riseSwell, e), rot: -tilt * 0.6 * e, heat: Math.min(1, 0.3 + e),
  };
}

// ─── the camera (pure) ─────────────────────────────────────────────────────────────────────────────────────────

/**
 * The camera at sequence time `t` (px in the points' space). A push in on the hero through the windup with a growing
 * tremor; a kick back as each drive leaves; on each tick a punch in and a sharp kick ALONG the blow; on THE impact the
 * biggest punch and a shake along the blow with a little across (the frame the hit-stop holds is already displaced).
 * Tier IV builds a rumbling tremor through the rise and hangs still at the apex, then the meteor rings both ways.
 * Deterministic (sines and springs). Pure.
 */
export function enragedCameraAt(p: EnragedPlan, c: HeroEnragedConfig, t: number, u: Pt): { zoom: number; x: number; y: number } {
  if (p.reduced) return { zoom: 1, x: 0, y: 0 };
  let z = 0;
  const first = p.strikes[0]!;
  if (t >= p.windupAt && t < p.impactAt) {
    z += p.zoom * easeInOutSine((t - p.windupAt) / Math.max(1, first.driveAt - p.windupAt));
    if (p.meteor && t >= p.riseAt) z += p.zoom * 0.5 * easeInOutSine((t - p.riseAt) / Math.max(1, p.apexAt - p.riseAt));
  }
  for (const at of p.ticks) if (t >= at && t < p.impactAt) z += p.punch * 0.5 * Math.exp(-(t - at) / 90);
  if (t >= p.impactAt) z += (p.zoom * (p.meteor ? 1.5 : 1) + p.punch) * Math.exp(-(t - p.impactAt) / Math.max(1, c.zoomOutMs / 4));
  let x = 0, y = 0;
  const kick = (at: number, amp: number, tau: number, hz: number): void => {
    const age = t - at;
    if (age < 0) return;
    const s = spring(age, hz, tau);
    const across = amp * 0.25 * Math.sin(age * 0.09) * Math.exp(-age / tau);
    x += u.x * amp * s - u.y * across;
    y += u.y * amp * s + u.x * across;
  };
  // Each drive leaves with a small kick back (the push-off), each tick lands with a sharp one along the blow.
  p.strikes.forEach((s) => kick(s.driveAt, -p.shakePx * 0.12, 40, 12));
  p.ticks.forEach((at, i) => kick(at, p.shakePx * (0.45 + 0.08 * i), 50, 16));
  // The windup (and the rise) tremble, growing into the drive.
  const buildTo = p.meteor ? p.apexAt : first.driveAt;
  if (t >= p.windupAt && t < buildTo) {
    const v = (t - p.windupAt) / Math.max(1, buildTo - p.windupAt);
    const a = p.shakePx * (p.meteor ? 0.2 : 0.1) * v * v;
    x += a * Math.sin(t * 0.13); y += a * Math.sin(t * 0.17 + 1.3);
  }
  const age = t - p.impactAt;
  if (age >= 0) {
    if (p.meteor) {
      const env = Math.exp(-age / Math.max(1, c.shakeMs / 3.2));
      x += p.shakePx * 0.8 * env * Math.sin(age * 0.105 + 0.5);
      y += p.shakePx * env * Math.cos(age * 0.093);
      p.booms.forEach((at, i) => kick(at, p.shakePx * 0.22, 45, 18 - i));
    } else kick(p.impactAt, p.shakePx, Math.max(1, c.shakeMs / 4), 15);
  }
  const cap = Math.min(c.shakeCap, ENRAGED_CAPS.shakePx);
  const m = Math.hypot(x, y);
  if (m > cap && m > 0) { x *= cap / m; y *= cap / m; }
  return { zoom: 1 + clamp(z, 0, Math.min(c.zoomCap, ENRAGED_CAPS.zoom) * 1.6), x, y };
}

/** Where the camera anchors: the hero through the windup, sliding to the foe over the first drive, the foe after. */
export function enragedCameraFocus(p: EnragedPlan, t: number, a: Pt, d: Pt): Pt {
  const s = p.strikes[0];
  if (!s || t <= s.driveAt) return a;
  if (t >= s.contactAt) return d;
  const e = driveEase((t - s.driveAt) / Math.max(1, s.contactAt - s.driveAt));
  return { x: a.x + (d.x - a.x) * e, y: a.y + (d.y - a.y) * e };
}
