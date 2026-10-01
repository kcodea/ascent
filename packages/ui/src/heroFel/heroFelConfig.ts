/**
 * THE EYE OF THE LEGION (style `fel`, cosmetic `attack_fel`): its tuned values, its pure timeline, the pure eye pose
 * (the rift, the lids, the darting iris, the slit pupil, the burning iris ring), the pure gaze beam and the pure camera.
 *
 * Owner 2026-09-30: "create a brand new attack animation that is on par with hearthstone/modern world of warcraft level
 * animation art style performance readability and everything", then, on the first (green fire) pass: "this needs the
 * bar to be set as an extremely unique animation. this may be our first mythic rarity item". The owner picked this
 * concept: a demonic EYE tears open in the air, its slit pupil darts about, finds the target, and burns it with its
 * GAZE. Nothing else in the roster has a watcher: the eye shows intent (it looks at what it is about to hurt), and an
 * eye is the most readable shape there is at game size.
 *
 * THE BEATS (base ms before the playback speed), after the shared damage formation (the total dives into the hero):
 *  I. A small eye over the attacker: a fel RIFT tears open, a glowing seam, the lids CRACK then snap open (overshoot),
 *     the pupil darts (saccades), LOCKS on the target and slits, the eye narrows into a glare, and a gaze PULSE lances
 *     across and hits (THE impact). The eye blinks shut and the rift seals in embers.
 *  II. Two eyes, out of sync, over the attacker; both lock and both gazes hold, CROSSING on the target. The first is a
 *     tick; the second lands the blow.
 *  III and IV (owner 2026-09-30 review: "it may be cooler if 2 open and fire a beam, and then more and more open and
 *     blast the target until a massive fel explosion happens ... and add some screen shake to it"): ESCALATING EYES.
 *  III. The pair opens and fires, then two more eyes tear open and join; the four beams converge and burn while the
 *     shake builds, then a SOLID FEL IMPACT (the blow) and every eye snaps shut together.
 *  IV. The pair opens and fires, then MORE AND MORE eyes tear open round the edges of the screen and the sky, faster and
 *     faster (a dozen and more), each slitting onto the target and blasting it; the beams converge into a blinding knot,
 *     the board drops under a fel veil, the shake builds with every eye; then a MASSIVE FEL EXPLOSION (the blow): a
 *     white-green core, shockwave rings, a towering fireball, debris and embers, a sharp kick and a heavy shake, the view
 *     drifting toward the middle so a target in a corner is never cropped. Every eye snaps shut together; the rifts seal.
 *
 * No hit-stop or freeze anywhere (owner 2026-09-28): weight comes from the flash, the squash, the shake and the sound.
 * Flat 2D: the eye is a flat painted shape, its lids a mask scaled in y. The blow lands ONCE, on THE impact.
 *
 * Tuner convention (the Blast's): localStorage in DEV only, values clamped on write and on load; production always
 * plays DEFAULTS.
 */
import { clamp, clamp01, easeInOutSine, easeOutBack, easeOutCubic, hexToNum, type Pt } from '../heroAttack/easing';
import {
  HERO_ATTACK_TIER_THRESHOLDS, TIERS, attackTier, reducedAttackTimeline, type AttackTierContext, type TierNum,
} from '../heroAttack/tiers';

export { TIERS, hexToNum, type TierNum };

/** The per-tier dials. A config key is `t1..t4` + one of these. */
export const FEL_TIER_SUFFIXES = [
  'EyeSize', 'Eyes', 'OpenMs', 'SeekMs', 'ChargeMs', 'GazeMs', 'CascadeMs', 'Accel', 'BuildMs', 'HoldMs',
  'Shake', 'Zoom', 'Punch', 'Burst', 'Dim', 'Veil', 'SettleMs',
] as const;
export type FelTierSuffix = (typeof FEL_TIER_SUFFIXES)[number];
type TierKey = `t${TierNum}${FelTierSuffix}`;

interface GlobalConfig {
  tier2At: number; tier3At: number; tier4At: number;
  absorbMs: number;
  riftMs: number;
  closeMs: number;
  sealMs: number;
  squint: number;
  slit: number;
  dilate: number;
  lookReach: number;
  pairGapMs: number;
  heroSwell: number;
  beamWidth: number;
  beamGlow: number;
  sparks: number;
  embers: number;
  veins: number;
  burstSize: number;
  shards: number;
  fireball: number;
  drawIn: number;
  flashAlpha: number;
  knockPx: number;
  squash: number;
  shakeMs: number;
  zoomOutMs: number;
  reducedFadeMs: number;
  colorSclera: string;
  colorVein: string;
  colorIris: string;
  colorFel: string;
  colorHot: string;
  colorCore: string;
  colorPupil: string;
  colorLid: string;
  colorRift: string;
  colorVeil: string;
  colorPlayer: string;
  colorFoe: string;
  sfxRiftClip: string; sfxRiftGain: number; sfxRiftRate: number;
  sfxOpenClip: string; sfxOpenGain: number; sfxOpenRate: number;
  sfxDartClip: string; sfxDartGain: number; sfxDartRate: number;
  sfxLockClip: string; sfxLockGain: number; sfxLockRate: number;
  sfxGazeClip: string; sfxGazeGain: number; sfxGazeRate: number;
  sfxHitClip: string; sfxHitGain: number; sfxHitRate: number;
  sfxImpactClip: string; sfxImpactGain: number; sfxImpactRate: number;
  sfxBlastClip: string; sfxBlastGain: number; sfxBlastRate: number;
  sfxImplodeClip: string; sfxImplodeGain: number; sfxImplodeRate: number;
  sfxBurstClip: string; sfxBurstGain: number; sfxBurstRate: number;
  sfxCloseClip: string; sfxCloseGain: number; sfxCloseRate: number;
  sfxHumGain: number; sfxHumLowHz: number; sfxHumHighHz: number;
  sfxRumbleGain: number;
  sfxImpactLenMs: number;
  sfxTailMix: number;
  sfxDuck: number;
  previewDamage: number;
  previewParts: number;
}
export type HeroFelConfig = GlobalConfig & Record<TierKey, number>;

export const HERO_FEL_COLOR_KEYS = [
  'colorSclera', 'colorVein', 'colorIris', 'colorFel', 'colorHot', 'colorCore', 'colorPupil', 'colorLid', 'colorRift', 'colorVeil',
  'colorPlayer', 'colorFoe',
] as const;
export const HERO_FEL_CLIP_KEYS = [
  'sfxRiftClip', 'sfxOpenClip', 'sfxDartClip', 'sfxLockClip', 'sfxGazeClip', 'sfxHitClip', 'sfxImpactClip', 'sfxBlastClip',
  'sfxImplodeClip', 'sfxBurstClip', 'sfxCloseClip',
] as const;
type ColorKey = (typeof HERO_FEL_COLOR_KEYS)[number];
type ClipKey = (typeof HERO_FEL_CLIP_KEYS)[number];
export type HeroFelStrKey = ColorKey | ClipKey;
export type HeroFelNumKey = Exclude<keyof HeroFelConfig, HeroFelStrKey>;

/** Tier I .. IV per suffix. EyeSize is the eye's half-width in portrait radii (IV: a share of the screen width). */
const TIER_DEFAULTS: Record<FelTierSuffix, [number, number, number, number]> = {
  EyeSize: [0.8, 0.66, 0.66, 0.62],
  Eyes: [1, 2, 4, 14],
  OpenMs: [240, 240, 240, 260],
  SeekMs: [300, 260, 240, 260],
  ChargeMs: [130, 140, 130, 140],
  GazeMs: [190, 170, 160, 150],
  CascadeMs: [0, 0, 220, 300],
  Accel: [1, 1, 0.9, 0.8],
  BuildMs: [0, 0, 240, 460],
  HoldMs: [0, 220, 60, 0],
  Shake: [5, 8, 16, 32],
  Zoom: [0.03, 0.035, 0.04, 0.05],
  Punch: [0.02, 0.028, 0.05, 0.08],
  Burst: [1, 1.15, 1.6, 2.4],
  Dim: [0.08, 0.18, 0.34, 0.5],
  Veil: [0, 0, 0.22, 0.58],
  SettleMs: [280, 320, 460, 600],
};

export const FEL_TIER_RANGES: Record<FelTierSuffix, [number, number, number]> = {
  EyeSize: [0.2, 3, 0.01],
  Eyes: [1, 16, 1],
  OpenMs: [80, 1200, 10],
  SeekMs: [0, 1500, 10],
  ChargeMs: [0, 1200, 10],
  GazeMs: [60, 800, 10],
  CascadeMs: [0, 1200, 10],
  Accel: [0.5, 1.2, 0.01],
  BuildMs: [0, 1600, 10],
  HoldMs: [0, 1200, 10],
  Shake: [0, 40, 0.5],
  Zoom: [0, 0.14, 0.002],
  Punch: [0, 0.1, 0.001],
  Burst: [0.3, 3, 0.05],
  Dim: [0, 0.8, 0.01],
  Veil: [0, 0.9, 0.01],
  SettleMs: [0, 1600, 10],
};

const tierDefaults = Object.fromEntries(TIERS.flatMap((t) => FEL_TIER_SUFFIXES.map((s) => [`t${t}${s}`, TIER_DEFAULTS[s][t - 1]]))) as Record<TierKey, number>;

export const HERO_FEL_DEFAULTS: HeroFelConfig = {
  ...HERO_ATTACK_TIER_THRESHOLDS,
  absorbMs: 200,
  riftMs: 170,
  closeMs: 150,
  sealMs: 240,
  squint: 0.24,
  slit: 0.16,
  dilate: 0.62,
  lookReach: 1,
  pairGapMs: 150,
  heroSwell: 0.05,
  beamWidth: 1,
  beamGlow: 1,
  sparks: 1,
  embers: 1,
  veins: 0.6,
  burstSize: 1,
  shards: 1,
  fireball: 1,
  drawIn: 1,
  flashAlpha: 0.85,
  knockPx: 18,
  squash: 0.1,
  shakeMs: 340,
  zoomOutMs: 380,
  reducedFadeMs: 260,
  colorSclera: '#d6cf7e',
  colorVein: '#9a1830',
  colorIris: '#46d21e',
  colorFel: '#6cf22e',
  colorHot: '#d6ff5c',
  colorCore: '#f6ffe2',
  colorPupil: '#06020a',
  colorLid: '#170a1f',
  colorRift: '#10051a',
  colorVeil: '#06160b',
  colorPlayer: '#8dff45',
  colorFoe: '#ff4a63',
  sfxRiftClip: 'spirittendril', sfxRiftGain: 0.4, sfxRiftRate: 0.75,
  sfxOpenClip: 'fx/dragon-growl-2', sfxOpenGain: 0.22, sfxOpenRate: 0.85,
  sfxDartClip: 'clickthock', sfxDartGain: 0.14, sfxDartRate: 1.5,
  sfxLockClip: 'triggerglow', sfxLockGain: 0.32, sfxLockRate: 0.8,
  sfxGazeClip: 'fel-spike-echo', sfxGazeGain: 0.5, sfxGazeRate: 0.95,
  sfxHitClip: 'fel-spike-echo-land', sfxHitGain: 0.42, sfxHitRate: 1.1,
  sfxImpactClip: 'fel-spike-echo-land', sfxImpactGain: 0.6, sfxImpactRate: 0.9,
  sfxBlastClip: 'turnexplosion', sfxBlastGain: 0.45, sfxBlastRate: 0.85,
  sfxImplodeClip: 'runeselectimplosion', sfxImplodeGain: 0.55, sfxImplodeRate: 0.8,
  sfxBurstClip: 'fx/universfield-ground-impact-352053', sfxBurstGain: 0.65, sfxBurstRate: 0.9,
  sfxCloseClip: 'smack1', sfxCloseGain: 0.16, sfxCloseRate: 1.5,
  sfxHumGain: 0.22, sfxHumLowHz: 70, sfxHumHighHz: 420,
  sfxRumbleGain: 0.4,
  sfxImpactLenMs: 1100,
  sfxTailMix: 0.2,
  sfxDuck: 0.5,
  previewDamage: 12,
  previewParts: 4,
  ...tierDefaults,
};

const GLOBAL_RANGES: Record<Exclude<keyof GlobalConfig, HeroFelStrKey>, [number, number, number]> = {
  tier2At: [2, 40, 1], tier3At: [2, 60, 1], tier4At: [2, 80, 1],
  absorbMs: [60, 600, 10],
  riftMs: [40, 800, 10],
  closeMs: [40, 800, 10],
  sealMs: [40, 1200, 10],
  squint: [0, 0.6, 0.01],
  slit: [0.05, 0.8, 0.01],
  dilate: [0.1, 1, 0.01],
  lookReach: [0, 1.5, 0.05],
  pairGapMs: [0, 600, 10],
  heroSwell: [0, 0.3, 0.01],
  beamWidth: [0.2, 3, 0.05],
  beamGlow: [0, 2, 0.05],
  sparks: [0, 3, 0.05],
  embers: [0, 3, 0.05],
  veins: [0, 1, 0.01],
  burstSize: [0.3, 3, 0.05],
  shards: [0, 3, 0.05],
  fireball: [0, 3, 0.05],
  drawIn: [0, 3, 0.05],
  flashAlpha: [0, 1, 0.01],
  knockPx: [0, 60, 1],
  squash: [0, 0.3, 0.01],
  shakeMs: [0, 1200, 10],
  zoomOutMs: [60, 1500, 10],
  reducedFadeMs: [60, 1000, 10],
  sfxRiftGain: [0, 2, 0.05], sfxRiftRate: [0.5, 2, 0.01],
  sfxOpenGain: [0, 2, 0.05], sfxOpenRate: [0.5, 2, 0.01],
  sfxDartGain: [0, 2, 0.05], sfxDartRate: [0.5, 2, 0.01],
  sfxLockGain: [0, 2, 0.05], sfxLockRate: [0.5, 2, 0.01],
  sfxGazeGain: [0, 2, 0.05], sfxGazeRate: [0.5, 2, 0.01],
  sfxHitGain: [0, 2, 0.05], sfxHitRate: [0.5, 2, 0.01],
  sfxImpactGain: [0, 2, 0.05], sfxImpactRate: [0.5, 2, 0.01],
  sfxBlastGain: [0, 2, 0.05], sfxBlastRate: [0.5, 2, 0.01],
  sfxImplodeGain: [0, 2, 0.05], sfxImplodeRate: [0.5, 2, 0.01],
  sfxBurstGain: [0, 2, 0.05], sfxBurstRate: [0.5, 2, 0.01],
  sfxCloseGain: [0, 2, 0.05], sfxCloseRate: [0.5, 2, 0.01],
  sfxHumGain: [0, 2, 0.05], sfxHumLowHz: [20, 400, 5], sfxHumHighHz: [100, 3000, 10],
  sfxRumbleGain: [0, 2, 0.05],
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

/** The hard ceilings a plan can never exceed, whatever the sliders say. */
export const FEL_CAPS = { shakePx: 40, zoom: 0.14 } as const;

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

export function sanitizeHeroFelConfig(saved: unknown): HeroFelConfig {
  const out: HeroFelConfig = { ...HERO_FEL_DEFAULTS };
  if (!saved || typeof saved !== 'object') return out;
  for (const [k, v] of Object.entries(saved as Record<string, unknown>)) {
    const safe = clampHeroFelValue(k as keyof HeroFelConfig, v);
    if (safe !== undefined) (out as unknown as Record<string, unknown>)[k] = safe;
  }
  return out;
}

const KEY = 'ascent.herofel.v2';

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

export const FEL_REF_DISTANCE = 1600;

/** A travel time for a distance: the tuned time, scaled gently by the distance. */
export function felTravelMs(distance: number, tunedMs: number): number {
  const d = Number.isFinite(distance) && distance > 0 ? distance : FEL_REF_DISTANCE;
  return Math.round(tunedMs * clamp(Math.sqrt(d / FEL_REF_DISTANCE), 0.6, 1.15));
}

/** How a gaze is drawn: a lancing pulse (I) or a beam that holds on the target (II-IV). */
export type GazeKind = 'pulse' | 'hold';
/** How the blow lands: on the gaze itself (I, II), a solid fel impact (III), the MASSIVE fel explosion (IV). */
export type FelFinale = 'gaze' | 'impact' | 'explosion';
export const FINALE_OF: Record<TierNum, FelFinale> = { 1: 'gaze', 2: 'gaze', 3: 'impact', 4: 'explosion' };
/** Hard cap on eyes (a dozen and more at IV, never more than this). */
export const MAX_EYES = 16;

/** One eye's timeline (sequence ms). */
export interface EyePlan {
  riftAt: number; riftMs: number; openAt: number; openMs: number;
  /** The saccades before it finds the target. */
  darts: number[];
  lockAt: number;
  /** The gaze leaves the pupil. */
  fireAt: number;
  /** Its head reaches the target. */
  hitAt: number;
  /** The beam starts to retract. */
  holdUntil: number;
  closeAt: number; closeMs: number;
  sealAt: number; goneAt: number;
  kind: GazeKind;
  /** Size multiplier (the cascade's eyes vary a little). */
  size: number;
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
  k: number;
  total: number;
  /** The total dives into the hero; the first rift tears open as it lands. */
  chargeAt: number;
  absorbEnd: number;
  eyes: EyePlan[];
  finale: FelFinale;
  /** Gazes that land BEFORE the impact: FX and sound only (II's first; every eye of III and IV). */
  hits: number[];
  /** The last gaze lands: every beam is on the target (III / IV build from here to the impact). */
  landAt: number;
  /** THE consequence beat. */
  impactAt: number;
  endAt: number;
  /** III / IV: the fel veil (null below). */
  veil: { inAt: number; fullAt: number; outAt: number; goneAt: number; alpha: number } | null;
  shakePx: number;
  zoom: number;
  punch: number;
  burst: number;
  dim: number;
  /** The first gaze leaves (the camera follows it from here). */
  fireAt: number;
}

/** The cascade's spawn times after the opening pair: each gap `accel` times the last (an accelerating cascade). */
export function cascadeTimes(start: number, count: number, gapMs: number, accel: number): number[] {
  const out: number[] = [];
  let at = start, gap = Math.max(40, gapMs);
  for (let j = 0; j < count; j++) { out.push(Math.round(at)); at += gap; gap = Math.max(40, gap * accel); }
  return out;
}

/** The whole attack, in base ms. Pure and deterministic. */
export function felPlan(input: FelPlanInput, c: HeroFelConfig = cfg): FelPlan {
  const total = Math.max(0, Math.round(input.total));
  const tier = attackTier(total, input, c);
  const T = felTierDials(tier, c);
  const k = (tier - 1) / 3;
  const finale = FINALE_OF[tier];

  if (input.reduced) {
    const r = reducedAttackTimeline(input.leadIn ?? 0, c.reducedFadeMs);
    const { impactAt } = r;
    return {
      reduced: true, tier, k, total, chargeAt: impactAt, absorbEnd: impactAt, eyes: [], finale, hits: [], landAt: impactAt, impactAt,
      endAt: r.endAt, veil: null, shakePx: 0, zoom: 0, punch: 0, burst: 0, dim: 0, fireAt: impactAt,
    };
  }

  const chargeAt = Math.max(0, input.leadIn ?? 0);
  const absorbEnd = chargeAt + c.absorbMs;
  const n = tier === 1 ? 1 : clamp(Math.round(T.Eyes), 2, MAX_EYES);
  const gaze = felTravelMs(input.distance, T.GazeMs);
  const kind: GazeKind = tier === 1 ? 'pulse' : 'hold';
  const eyes: EyePlan[] = [];
  // The opening pair (I: one eye): the full performance (the crack, the saccades, the lock, the glare).
  const lead = Math.min(n, 2);
  for (let i = 0; i < lead; i++) {
    const riftAt = chargeAt + 60 + i * c.pairGapMs;
    const openAt = riftAt + c.riftMs;
    const seekFrom = openAt + T.OpenMs;
    const nd = i === 0 ? 2 : 1;
    const darts = Array.from({ length: nd }, (_, j) => Math.round(seekFrom + (T.SeekMs * j) / nd));
    const lockAt = seekFrom + T.SeekMs;
    const fireAt = lockAt + T.ChargeMs;
    eyes.push({
      riftAt, riftMs: c.riftMs, openAt, openMs: T.OpenMs, darts, lockAt, fireAt, hitAt: fireAt + gaze, holdUntil: 0, closeAt: 0,
      closeMs: c.closeMs, sealAt: 0, goneAt: 0, kind, size: 1,
    });
  }
  // THE CASCADE (III, IV): more and more eyes tear open, faster and faster, each a short sharp performance (a tear, a
  // snap open, one glance, a lock, a gaze).
  if (n > lead) {
    const start = eyes[lead - 1]!.fireAt + Math.max(0, T.CascadeMs * 0.6);
    cascadeTimes(start, n - lead, T.CascadeMs, T.Accel).forEach((riftAt, j) => {
      const riftMs = Math.min(c.riftMs, 110);
      const openAt = riftAt + riftMs;
      const openMs = Math.min(T.OpenMs, 190);
      const seek = Math.min(T.SeekMs, 110);
      const lockAt = openAt + openMs + seek;
      const fireAt = lockAt + Math.min(T.ChargeMs, 80);
      eyes.push({
        riftAt, riftMs, openAt, openMs, darts: [openAt + openMs], lockAt, fireAt, hitAt: fireAt + Math.round(gaze * 0.85), holdUntil: 0, closeAt: 0,
        closeMs: c.closeMs, sealAt: 0, goneAt: 0, kind, size: 0.78 + 0.22 * (((j * 37) % 10) / 10),
      });
    });
  }
  const landAt = Math.max(...eyes.map((e) => e.hitAt));
  const impactAt = finale === 'gaze' ? landAt : landAt + T.BuildMs;
  const hits = eyes.map((e) => e.hitAt).filter((at) => at < impactAt).sort((a, b) => a - b);
  for (const e of eyes) {
    e.holdUntil = kind === 'pulse' ? e.hitAt : finale === 'gaze' ? impactAt + T.HoldMs : impactAt + T.HoldMs;
    // III and IV: every eye snaps shut TOGETHER just after the blow (one satisfying beat).
    e.closeAt = kind === 'pulse' ? e.hitAt + 200 : finale === 'gaze' ? e.holdUntil + 80 : impactAt + 140;
    if (finale !== 'gaze') e.closeMs = Math.min(c.closeMs, 110);
    e.sealAt = e.closeAt + e.closeMs;
    e.goneAt = e.sealAt + c.sealMs;
  }
  const veil = T.Veil > 0
    ? { inAt: chargeAt + 40, fullAt: landAt, outAt: impactAt + 260, goneAt: impactAt + 820, alpha: T.Veil }
    : null;
  const lastBeat = Math.max(impactAt + c.zoomOutMs * 0.8, ...eyes.map((e) => e.goneAt), veil ? veil.goneAt - 200 : 0);
  const endAt = lastBeat + T.SettleMs;
  return {
    reduced: false, tier, k, total, chargeAt, absorbEnd, eyes, finale, hits, landAt, impactAt, endAt, veil,
    shakePx: clamp(T.Shake, 0, FEL_CAPS.shakePx), zoom: clamp(T.Zoom, 0, FEL_CAPS.zoom), punch: T.Punch, burst: T.Burst, dim: T.Dim,
    fireAt: eyes[0]!.fireAt,
  };
}

export type FelCueKind = 'charge' | 'rift' | 'open' | 'dart' | 'lock' | 'fire' | 'hit' | 'land' | 'impact' | 'close' | 'seal' | 'end';
export interface FelCue { at: number; kind: FelCueKind; i: number; j?: number }

/** Every beat the runner fires, in time order (ties keep this declaration order, so a hit precedes the impact). */
export function felCues(p: FelPlan): FelCue[] {
  const out: FelCue[] = [];
  if (!p.reduced) {
    out.push({ at: p.chargeAt, kind: 'charge', i: 0 });
    p.eyes.forEach((e, i) => {
      out.push({ at: e.riftAt, kind: 'rift', i });
      out.push({ at: e.openAt, kind: 'open', i });
      e.darts.forEach((at, j) => out.push({ at, kind: 'dart', i, j }));
      out.push({ at: e.lockAt, kind: 'lock', i });
      out.push({ at: e.fireAt, kind: 'fire', i });
      out.push({ at: e.closeAt, kind: 'close', i });
      out.push({ at: e.sealAt, kind: 'seal', i });
      if (e.hitAt < p.impactAt) out.push({ at: e.hitAt, kind: 'hit', i });
    });
    if (p.finale !== 'gaze') out.push({ at: p.landAt, kind: 'land', i: 0 });
  }
  out.push({ at: p.impactAt, kind: 'impact', i: Math.max(0, p.eyes.length - 1) });
  out.push({ at: p.endAt, kind: 'end', i: 0 });
  const order: Record<FelCueKind, number> = { charge: 1, rift: 2, open: 3, dart: 4, lock: 5, fire: 6, hit: 7, land: 8, impact: 9, close: 10, seal: 11, end: 12 };
  return out.map((q, idx) => ({ q, idx })).sort((a, b) => a.q.at - b.q.at || order[a.q.kind] - order[b.q.kind] || a.idx - b.idx).map((x) => x.q);
}

// ─── the eye's geometry and pose (pure) ────────────────────────────────────────────────────────────────────────

/** The eye's local frame: its almond is 256 x 128 texture px (half-width 128); the iris travels this far. */
export const EYE_HW = 128;
export const EYE_HH = 62;
export const IRIS_R = 44;
export const LOOK_X = 58;
export const LOOK_Y = 22;

/** The almond outline, top then bottom, in the eye's local px (pointed corners, a slightly flatter lower lid). */
export function almondPoints(hw = EYE_HW, hh = EYE_HH, n = 28): Pt[] {
  const pts: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const x = -1 + (2 * i) / n;
    pts.push({ x: x * hw, y: -hh * Math.pow(Math.max(0, 1 - x * x), 0.82) });
  }
  for (let i = n - 1; i > 0; i--) {
    const x = -1 + (2 * i) / n;
    pts.push({ x: x * hw, y: hh * 0.9 * Math.pow(Math.max(0, 1 - x * x), 0.9) });
  }
  return pts;
}

/** One eye placed on the screen: its centre, its half-width (px), what it looks at. */
export interface EyeMotion extends EyePlan {
  i: number;
  c: Pt;
  /** Half-width in px. `a / EYE_HW` is its local-to-screen scale. */
  a: number;
  target: Pt;
  /** Saccade look vectors (-1..1 each), one per dart. */
  looks: Pt[];
  /** The look that finds the target. */
  lock: Pt;
  /** The struck portrait's radius: the gaze's width is sized to it (it reads the same whatever the eye's size). */
  beamR: number;
}

export interface Bounds { w: number; h: number; margin: number }

/**
 * Where the cascade's eyes may open, in screen fractions: round the edges and the sky first, then an inner ring. Spread
 * in this order so each new eye opens somewhere else (left, right, top, low...).
 */
const CASCADE_SPOTS: readonly Pt[] = [
  { x: 0.5, y: 0.1 }, { x: 0.08, y: 0.36 }, { x: 0.92, y: 0.5 }, { x: 0.28, y: 0.12 }, { x: 0.72, y: 0.11 },
  { x: 0.1, y: 0.68 }, { x: 0.9, y: 0.82 }, { x: 0.38, y: 0.9 }, { x: 0.62, y: 0.9 }, { x: 0.16, y: 0.14 },
  { x: 0.84, y: 0.2 }, { x: 0.3, y: 0.42 }, { x: 0.7, y: 0.4 }, { x: 0.5, y: 0.62 }, { x: 0.94, y: 0.33 },
  { x: 0.06, y: 0.88 }, { x: 0.4, y: 0.28 }, { x: 0.6, y: 0.27 }, { x: 0.22, y: 0.88 }, { x: 0.78, y: 0.64 },
  { x: 0.5, y: 0.82 }, { x: 0.25, y: 0.62 }, { x: 0.75, y: 0.88 }, { x: 0.94, y: 0.12 },
];

/** Each eye's place on the screen. Pure: the same fight opens the same eyes in the same places. */
export function eyeMotions(p: FelPlan, a: Pt, d: Pt, aRadius: number, dRadius: number, b: Bounds, c: HeroFelConfig = cfg): EyeMotion[] {
  if (p.reduced) return [];
  const T = felTierDials(p.tier, c);
  const n = p.eyes.length;
  const up = a.y > b.h * 0.5 ? -1 : 1;
  const towardX = a.x < b.w * 0.5 ? 1 : -1;
  const HH = EYE_HH / EYE_HW;
  const clampC = (x: number, y: number, half: number): Pt => ({
    x: clamp(x, half + b.margin, Math.max(half + b.margin, b.w - half - b.margin)),
    y: clamp(y, half * HH + b.margin, Math.max(half * HH + b.margin, b.h - half * HH - b.margin)),
  });
  const placed: { c: Pt; a: number }[] = [];
  const out: EyeMotion[] = [];
  let spot = 0;
  p.eyes.forEach((e, i) => {
    let half = aRadius * T.EyeSize * e.size;
    let ctr: Pt;
    if (i === 0) {
      ctr = n === 1
        ? clampC(a.x + towardX * aRadius * 0.35, a.y + up * (aRadius + half * 0.75 + 12), half)
        : clampC(a.x + towardX * aRadius * 0.15, a.y + up * (aRadius + half * 0.7 + 10), half);
    } else if (i === 1) {
      // The pair's second eye: out to the attacker's side, toward the middle (their gazes cross on the target).
      ctr = clampC(a.x + towardX * (aRadius + half * 1.25), a.y + up * half * 0.2, half);
    } else {
      // The cascade: the next free spot round the screen, clear of both portraits and of every eye already open.
      ctr = { x: -1, y: -1 };
      half *= 0.8;
      for (let tries = 0; tries < CASCADE_SPOTS.length; tries++) {
        const s = CASCADE_SPOTS[spot++ % CASCADE_SPOTS.length]!;
        const q = clampC(s.x * b.w, s.y * b.h, half);
        const clear = Math.hypot(q.x - d.x, q.y - d.y) > dRadius * 1.9 + half
          && Math.hypot(q.x - a.x, q.y - a.y) > aRadius * 1.5 + half
          && placed.every((o) => Math.hypot(q.x - o.c.x, (q.y - o.c.y) * 1.6) > (o.a + half) * 1.05);
        if (clear) { ctr = q; break; }
      }
      if (ctr.x < 0) {
        // Crowded (a tiny box): shrink it and take the spot anyway, still on screen.
        half *= 0.7;
        const s = CASCADE_SPOTS[spot++ % CASCADE_SPOTS.length]!;
        ctr = clampC(s.x * b.w, s.y * b.h, half);
      }
    }
    placed.push({ c: ctr, a: half });
    const v = { x: d.x - ctr.x, y: d.y - ctr.y };
    const L = Math.hypot(v.x, v.y) || 1;
    const lock = { x: (v.x / L) * c.lookReach, y: (v.y / L) * c.lookReach };
    const base = [{ x: -0.85, y: -0.35 }, { x: 0.7, y: 0.45 }, { x: -0.3, y: 0.75 }];
    const looks = e.darts.map((_, j) => {
      const q = base[(j + i) % base.length]!;
      return j === e.darts.length - 1 && j > 0 ? { x: lock.x * 0.4 - q.x * 0.2, y: lock.y * 0.4 + q.y * 0.2 } : q;
    });
    out.push({ ...e, i, c: ctr, a: half, target: { ...d }, looks, lock, beamR: dRadius });
  });
  return out;
}

export interface EyePose {
  /** The rift behind the eye: 0 shut .. 1 torn open. */
  rift: number;
  /** The lids: 0 shut .. ~1.1 (the overshoot and the glare). */
  open: number;
  /** Where the iris looks (-1..1 each). */
  look: Pt;
  /** The pupil's width: `slit` (a slit) .. ~0.8 (round, dilated). */
  pupil: number;
  /** The iris's burn: 0.3 dim .. 1.3 blazing. */
  glow: number;
  /** The seam's glow while the lids are still shut (0..1). */
  seam: number;
}

const ease = (u: number): number => easeOutCubic(u);

/** Where the eye is at sequence time `t`. Pure. */
export function eyePose(m: EyeMotion, t: number, c: HeroFelConfig = cfg): EyePose {
  const rift = t < m.riftAt ? 0
    : t < m.sealAt ? ease((t - m.riftAt) / Math.max(1, m.riftMs))
      : 1 - easeInOutSine((t - m.sealAt) / Math.max(1, c.sealMs));
  // The lids: a crack (a slow first 15 %), then they snap open with an overshoot; a squint (the glare) once it locks;
  // a widening flash as the gaze leaves; a fast blink shut.
  let open = 0;
  if (t >= m.openAt) {
    const u = clamp01((t - m.openAt) / Math.max(1, m.openMs));
    open = u < 0.35 ? 0.15 * easeInOutSine(u / 0.35) : 0.15 + 0.85 * easeOutBack((u - 0.35) / 0.65, 1.8);
    if (t >= m.lockAt) open -= c.squint * ease((t - m.lockAt) / 120);
    if (t >= m.fireAt) open += (c.squint + 0.12) * Math.exp(-(t - m.fireAt) / 140) * clamp01((t - m.fireAt) / 40);
    if (t >= m.closeAt) open *= 1 - Math.pow(clamp01((t - m.closeAt) / Math.max(1, m.closeMs)), 2);
  }
  open = Math.max(0, open);
  // The iris: centred while it opens, then saccades (each a fast 70 ms snap), then it finds the target and stays.
  let look: Pt = { x: 0, y: 0 };
  let from: Pt = look;
  const snap = (to: Pt, when: number): void => {
    if (t < when) return;
    const u = ease((t - when) / 70);
    look = { x: from.x + (to.x - from.x) * u, y: from.y + (to.y - from.y) * u };
    from = to;
  };
  m.darts.forEach((when, j) => snap(m.looks[j] ?? { x: 0, y: 0 }, when));
  snap(m.lock, m.lockAt);
  // The pupil: wide in the dark; it SLAMS to a slit as it locks; a flare as the gaze leaves.
  const breath = 0.04 * Math.sin(t * 0.012 + m.i);
  let pupil = c.dilate + breath;
  if (t >= m.lockAt) pupil = c.dilate + (c.slit - c.dilate) * ease((t - m.lockAt) / 130);
  if (t >= m.fireAt) pupil += 0.14 * Math.exp(-(t - m.fireAt) / 160);
  let glow = 0.35 + 0.25 * clamp01((t - m.openAt) / Math.max(1, m.openMs));
  if (t >= m.lockAt) glow += 0.3 * ease((t - m.lockAt) / 200);
  if (t >= m.fireAt) glow += 0.3;
  if (t >= m.closeAt) glow *= 1 - clamp01((t - m.closeAt) / Math.max(1, m.closeMs));
  const seam = rift * (1 - clamp01(open * 6));
  return { rift, open, look, pupil, glow, seam };
}

/** The pupil's centre on the screen for a look. */
export function pupilPoint(m: EyeMotion, look: Pt): Pt {
  const k = m.a / EYE_HW;
  return { x: m.c.x + look.x * LOOK_X * k, y: m.c.y + look.y * LOOK_Y * k };
}

export interface BeamPose {
  on: boolean;
  from: Pt;
  to: Pt;
  /** Its head and tail along from -> to (0..1). */
  head: number;
  tail: number;
  /** Its width as a share of the full width. */
  width: number;
}

/** The gaze at sequence time `t`. Pure. */
export function beamPose(m: EyeMotion, t: number, c: HeroFelConfig = cfg): BeamPose {
  const pose = eyePose(m, t, c);
  const from = pupilPoint(m, pose.look);
  const to = m.target;
  const travel = Math.max(1, m.hitAt - m.fireAt);
  const retract = m.kind === 'pulse' ? 160 : 120;
  if (t < m.fireAt || t >= m.holdUntil + retract) return { on: false, from, to, head: 0, tail: 0, width: 0 };
  const u = clamp01((t - m.fireAt) / travel);
  const head = 0.3 * u + 0.7 * u * u;
  let tail = 0;
  if (m.kind === 'pulse') tail = t < m.hitAt ? Math.max(0, head - 0.55) : 0.45 + 0.55 * ease((t - m.hitAt) / retract);
  else if (t >= m.holdUntil) tail = ease((t - m.holdUntil) / retract);
  // A held beam lands thin and swells as it burns (a cascade eye's a little thinner than the pair's).
  let width = m.kind === 'pulse' ? 0.55 : 0.7 * (0.75 + 0.25 * m.size);
  if (m.kind === 'hold' && t >= m.hitAt) width *= 0.8 + 0.2 * ease((t - m.hitAt) / 160);
  return { on: true, from, to, head, tail, width };
}

/**
 * Where IV's explosion is centred: on the struck portrait, but drawn in toward the middle of the screen when the
 * portrait sits against an edge (by at most `R * 1.3`), so the climax is never cropped by the corner. Pure.
 */
export function explosionCentre(d: Pt, R: number, b: Bounds): Pt {
  const keep = R * 2.4;
  const inward = (v: number, max: number): number => (v < keep ? Math.min(keep - v, R * 1.3) : v > max - keep ? -Math.min(v - (max - keep), R * 1.3) : 0);
  return { x: d.x + inward(d.x, b.w), y: d.y + inward(d.y, b.h) };
}

// ─── the camera (pure) ─────────────────────────────────────────────────────────────────────────────────────────

const springAt = (ms: number, hz: number, tau: number): number => (ms < 0 ? 0 : Math.exp(-ms / tau) * Math.cos(2 * Math.PI * hz * (ms / 1000)));

/**
 * The camera at sequence time `t`. A push in as the first eye opens; a kick back on each gaze leaving; a kick ALONG the
 * gaze on every hit, harder with every eye that joins (the shake ESCALATES); III / IV: a rumble that builds with the
 * barrage to the blow; on THE impact a punch and a directional shake (IV: the heaviest, with a sharp kick at the blast).
 * Deterministic. Pure.
 */
export function felCameraAt(p: FelPlan, c: HeroFelConfig, t: number, dir: Pt = { x: 1, y: 0 }): { zoom: number; x: number; y: number } {
  if (p.reduced || !p.eyes.length) return { zoom: 1, x: 0, y: 0 };
  const e0 = p.eyes[0]!;
  let z = 0;
  if (t >= p.chargeAt && t < p.impactAt) {
    z += p.zoom * easeInOutSine((t - e0.riftAt) / Math.max(1, e0.lockAt - e0.riftAt));
    if (p.finale !== 'gaze' && t >= p.landAt) z += p.zoom * 0.5 * easeInOutSine((t - p.landAt) / Math.max(1, p.impactAt - p.landAt));
  } else if (t >= p.impactAt) {
    z += (p.zoom * (p.finale === 'explosion' ? 1.6 : 1) + p.punch) * Math.exp(-(t - p.impactAt) / Math.max(1, c.zoomOutMs / 4));
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
  p.eyes.slice(0, 2).forEach((e) => kick(e.fireAt, -p.shakePx * 0.1, 45, 14, dir));
  const nh = Math.max(1, p.hits.length);
  p.hits.forEach((at, i) => kick(at, p.shakePx * Math.min(0.45, 0.14 + (0.3 * (i + 1)) / nh), 45, 17, dir));
  if (p.finale !== 'gaze') {
    // The rumble builds with the barrage: from the first hit to the blow.
    const first = p.hits.length ? p.hits[0]! : p.landAt;
    if (t >= first && t < p.impactAt) {
      const u = clamp01((t - first) / Math.max(1, p.impactAt - first));
      const a = p.shakePx * (0.03 + (p.finale === 'explosion' ? 0.22 : 0.12) * u * u);
      x += a * Math.sin(t * 0.13);
      y += a * Math.sin(t * 0.17 + 1.1);
    }
  }
  if (p.finale === 'explosion') {
    // THE BLAST: a sharp kick along the blow, then a heavy shake ringing both ways.
    kick(p.impactAt, p.shakePx * 0.9, 35, 20, dir);
    const age = t - p.impactAt;
    if (age >= 0) {
      const env = Math.exp(-age / Math.max(1, c.shakeMs / 3));
      x += p.shakePx * 0.8 * env * Math.sin(age * 0.105 + 0.5);
      y += p.shakePx * env * Math.cos(age * 0.093);
    }
  } else {
    kick(p.impactAt, p.shakePx, Math.max(1, c.shakeMs / 4), 16, dir);
  }
  return { zoom: 1 + Math.max(0, z), x, y };
}

/** Where the camera anchors: the first EYES while they open, sliding to the TARGET as the gazes land. Pure. */
export function felCameraFocus(p: FelPlan, t: number, eye: Pt, d: Pt): Pt {
  if (p.reduced || !p.eyes.length) return d;
  const e = p.eyes[Math.min(1, p.eyes.length - 1)]!;
  if (t <= e.fireAt) return eye;
  if (t >= e.hitAt) return d;
  const u = easeInOutSine((t - e.fireAt) / Math.max(1, e.hitAt - e.fireAt));
  return { x: eye.x + (d.x - eye.x) * u, y: eye.y + (d.y - eye.y) * u };
}
