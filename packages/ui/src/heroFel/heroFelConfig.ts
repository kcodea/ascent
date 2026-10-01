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
 *  III. A large eye; the board dims to fel shadow; the pupil hunts, slams to a slit; the iris flares; the beam fires
 *     beside the target and SWEEPS onto it (THE impact when it arrives), holds, burns, and the eye closes.
 *  IV. A colossal eye fills the top of the screen and the board drops into a fel-negative veil. It opens heavily, looks
 *     round the board, locks, the iris IGNITES (fel flame round its ring), a thick gaze lands on the target and holds
 *     while the target is drawn in (a dark core, motes and rings collapsing on it), then it IMPLODES into a STARBURST
 *     (THE impact). The beam cuts, the eye closes, the rift seals, the veil lifts.
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
  'EyeSize', 'OpenMs', 'SeekMs', 'ChargeMs', 'GazeMs', 'SweepMs', 'HoldMs', 'ImplodeMs',
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
  igniteFire: number;
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
  EyeSize: [0.8, 0.66, 1.5, 0.2],
  OpenMs: [240, 240, 380, 480],
  SeekMs: [300, 260, 380, 520],
  ChargeMs: [130, 140, 300, 420],
  GazeMs: [190, 170, 110, 140],
  SweepMs: [0, 0, 340, 0],
  HoldMs: [0, 220, 260, 0],
  ImplodeMs: [0, 0, 0, 520],
  Shake: [5, 8, 13, 24],
  Zoom: [0.03, 0.035, 0.05, 0.07],
  Punch: [0.02, 0.028, 0.042, 0.07],
  Burst: [1, 1.15, 1.5, 2.1],
  Dim: [0.08, 0.18, 0.42, 0.5],
  Veil: [0, 0, 0, 0.55],
  SettleMs: [280, 320, 460, 560],
};

export const FEL_TIER_RANGES: Record<FelTierSuffix, [number, number, number]> = {
  EyeSize: [0.2, 3, 0.01],
  OpenMs: [80, 1200, 10],
  SeekMs: [0, 1500, 10],
  ChargeMs: [0, 1200, 10],
  GazeMs: [60, 800, 10],
  SweepMs: [0, 1200, 10],
  HoldMs: [0, 1200, 10],
  ImplodeMs: [0, 1600, 10],
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
  igniteFire: 1,
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
  igniteFire: [0, 3, 0.05],
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

/** How the gaze is drawn: a lancing pulse (I), a held beam (II), a sweeping beam (III), a thick lance that holds (IV). */
export type GazeKind = 'pulse' | 'hold' | 'sweep' | 'lance';
export const GAZE_OF: Record<TierNum, GazeKind> = { 1: 'pulse', 2: 'hold', 3: 'sweep', 4: 'lance' };
export const EYES_OF: Record<TierNum, number> = { 1: 1, 2: 2, 3: 1, 4: 1 };

/** One eye's timeline (sequence ms). */
export interface EyePlan {
  riftAt: number; openAt: number; openMs: number;
  /** The saccades before it finds the target. */
  darts: number[];
  lockAt: number;
  /** The gaze leaves the pupil. */
  fireAt: number;
  /** Its head reaches the target (pulse, hold, lance) or the point beside it (sweep). */
  hitAt: number;
  /** Sweep: the beam arrives on the target (else = hitAt). */
  sweepEnd: number;
  /** The beam starts to retract. */
  holdUntil: number;
  closeAt: number; closeMs: number;
  sealAt: number; goneAt: number;
  kind: GazeKind;
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
  /** The total dives into the hero; the rift tears open as it lands. */
  chargeAt: number;
  absorbEnd: number;
  eyes: EyePlan[];
  kind: GazeKind;
  /** Gazes that land BEFORE the impact (II's first): FX only. */
  hits: number[];
  /** IV: the lance lands and the target starts to be drawn in (else the impact). */
  landAt: number;
  /** THE consequence beat. */
  impactAt: number;
  endAt: number;
  /** IV: the fel-negative veil (null below). */
  veil: { inAt: number; fullAt: number; outAt: number; goneAt: number; alpha: number } | null;
  shakePx: number;
  zoom: number;
  punch: number;
  burst: number;
  dim: number;
  /** The first moment the gaze is on (the camera follows it from here). */
  fireAt: number;
}

/** The whole attack, in base ms. Pure and deterministic. */
export function felPlan(input: FelPlanInput, c: HeroFelConfig = cfg): FelPlan {
  const total = Math.max(0, Math.round(input.total));
  const tier = attackTier(total, input, c);
  const T = felTierDials(tier, c);
  const k = (tier - 1) / 3;
  const kind = GAZE_OF[tier];

  if (input.reduced) {
    const r = reducedAttackTimeline(input.leadIn ?? 0, c.reducedFadeMs);
    const { impactAt } = r;
    return {
      reduced: true, tier, k, total, chargeAt: impactAt, absorbEnd: impactAt, eyes: [], kind, hits: [], landAt: impactAt, impactAt,
      endAt: r.endAt, veil: null, shakePx: 0, zoom: 0, punch: 0, burst: 0, dim: 0, fireAt: impactAt,
    };
  }

  const chargeAt = Math.max(0, input.leadIn ?? 0);
  const absorbEnd = chargeAt + c.absorbMs;
  const n = EYES_OF[tier];
  const gaze = felTravelMs(input.distance, T.GazeMs);
  const eyes: EyePlan[] = [];
  for (let i = 0; i < n; i++) {
    const off = i * c.pairGapMs;
    const riftAt = chargeAt + 60 + off;
    const openAt = riftAt + c.riftMs;
    const seekFrom = openAt + T.OpenMs;
    const nd = tier === 4 ? 3 : tier === 3 ? 2 : i === 0 ? 2 : 1;
    const darts = Array.from({ length: nd }, (_, j) => Math.round(seekFrom + (T.SeekMs * j) / nd));
    const lockAt = seekFrom + T.SeekMs;
    const fireAt = lockAt + T.ChargeMs;
    const hitAt = fireAt + gaze;
    const sweepEnd = kind === 'sweep' ? hitAt + T.SweepMs : hitAt;
    eyes.push({
      riftAt, openAt, openMs: T.OpenMs, darts, lockAt, fireAt, hitAt, sweepEnd, holdUntil: sweepEnd,
      closeAt: sweepEnd, closeMs: c.closeMs, sealAt: sweepEnd, goneAt: sweepEnd, kind,
    });
  }
  // The pair: the second eye's gaze lands the blow; both HOLD until it does (they cross on the target).
  const lastEye = eyes[eyes.length - 1]!;
  const landAt = lastEye.sweepEnd;
  const impactAt = kind === 'lance' ? landAt + T.ImplodeMs : landAt;
  const hits = eyes.slice(0, -1).map((e) => e.hitAt).filter((at) => at < impactAt);
  for (const e of eyes) {
    e.holdUntil = kind === 'pulse' ? e.hitAt : kind === 'lance' ? impactAt + 60 : Math.max(e.sweepEnd, impactAt) + T.HoldMs;
    e.closeAt = (kind === 'pulse' ? e.hitAt + 200 : e.holdUntil + 80);
    e.sealAt = e.closeAt + e.closeMs;
    e.goneAt = e.sealAt + c.sealMs;
  }
  const veil = T.Veil > 0
    ? { inAt: chargeAt + 40, fullAt: eyes[0]!.openAt + T.OpenMs * 0.5, outAt: impactAt + 260, goneAt: impactAt + 760, alpha: T.Veil }
    : null;
  const lastBeat = Math.max(impactAt + c.zoomOutMs * 0.8, ...eyes.map((e) => e.goneAt), veil ? veil.goneAt - 200 : 0);
  const endAt = lastBeat + T.SettleMs;
  return {
    reduced: false, tier, k, total, chargeAt, absorbEnd, eyes, kind, hits, landAt, impactAt, endAt, veil,
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
    });
    p.eyes.slice(0, -1).forEach((e, i) => { if (e.hitAt < p.impactAt) out.push({ at: e.hitAt, kind: 'hit', i }); });
    if (p.kind === 'lance') out.push({ at: p.landAt, kind: 'land', i: p.eyes.length - 1 });
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

/** One eye placed on the screen: its centre, its half-width (px), what it looks at, and (sweep) where the beam starts. */
export interface EyeMotion extends EyePlan {
  i: number;
  c: Pt;
  /** Half-width in px. `a / EYE_HW` is its local-to-screen scale. */
  a: number;
  target: Pt;
  /** Where the gaze first lands (= target, except a sweep, which lands beside it and sweeps on). */
  sweepFrom: Pt;
  /** Saccade look vectors (-1..1 each), one per dart. */
  looks: Pt[];
  /** The look that finds the target. */
  lock: Pt;
  /** The struck portrait's radius: the gaze's width is sized to it (it reads the same whatever the eye's size). */
  beamR: number;
}

export interface Bounds { w: number; h: number; margin: number }

/** Each eye's place on the screen. Pure: the same fight opens the same eyes in the same places. */
export function eyeMotions(p: FelPlan, a: Pt, d: Pt, aRadius: number, dRadius: number, b: Bounds, c: HeroFelConfig = cfg): EyeMotion[] {
  if (p.reduced) return [];
  const T = felTierDials(p.tier, c);
  const n = p.eyes.length;
  // The eye opens on the side of the attacker that faces the middle of the screen (above it from the bottom row).
  const up = a.y > b.h * 0.5 ? -1 : 1;
  const towardX = a.x < b.w * 0.5 ? 1 : -1;
  return p.eyes.map((e, i) => {
    let half: number;
    let cx: number, cy: number;
    if (p.tier === 4) {
      half = Math.min(b.w * T.EyeSize, b.h * 0.6, aRadius * 3.2);
      cx = b.w / 2;
      cy = half * 0.72 + b.margin; // the rift's torn edge clears the top of the screen
      // Never over the target: a target up in the top band pushes the eye along, away from it.
      if (Math.abs(d.y - cy) < half * 0.9 + dRadius && Math.abs(d.x - cx) < half * 1.7 + dRadius) {
        cx = d.x + (d.x > b.w / 2 ? -1 : 1) * (half * 1.7 + dRadius);
      }
    } else if (p.tier === 3) {
      half = aRadius * T.EyeSize;
      cx = a.x + (b.w / 2 - a.x) * 0.42;
      cy = a.y + (b.h / 2 - a.y) * 0.42 + up * aRadius * 0.6;
    } else {
      half = aRadius * T.EyeSize;
      if (n === 1) {
        cx = a.x + towardX * aRadius * 0.35;
        cy = a.y + up * (aRadius + half * 0.75 + 12);
      } else if (i === 0) {
        // The pair: one over the attacker, one out to its side toward the middle (their gazes cross on the target).
        cx = a.x + towardX * aRadius * 0.15;
        cy = a.y + up * (aRadius + half * 0.7 + 10);
      } else {
        cx = a.x + towardX * (aRadius + half * 1.25);
        cy = a.y + up * half * 0.2;
      }
    }
    const hh = half * (EYE_HH / EYE_HW);
    const ctr = { x: clamp(cx, half + b.margin, Math.max(half + b.margin, b.w - half - b.margin)), y: clamp(cy, hh + b.margin, Math.max(hh + b.margin, b.h - hh - b.margin)) };
    const v = { x: d.x - ctr.x, y: d.y - ctr.y };
    const L = Math.hypot(v.x, v.y) || 1;
    const lock = { x: (v.x / L) * c.lookReach, y: (v.y / L) * c.lookReach };
    // Saccades: away from the target first (it searches), then near it.
    const base = [{ x: -0.85, y: -0.35 }, { x: 0.7, y: 0.45 }, { x: -0.3, y: 0.75 }];
    const looks = e.darts.map((_, j) => {
      const q = base[(j + i) % base.length]!;
      return j === e.darts.length - 1 && j > 0 ? { x: lock.x * 0.4 - q.x * 0.2, y: lock.y * 0.4 + q.y * 0.2 } : q;
    });
    // A sweep lands beside the target (toward the eye's side, across the line of sight) and sweeps onto it.
    const nrm = { x: -v.y / L, y: v.x / L };
    // ...on whichever side keeps it on screen (the side nearer the middle).
    const side = (sg: number): Pt => ({ x: d.x + nrm.x * sg * dRadius * 2.2, y: d.y + nrm.y * sg * dRadius * 2.2 });
    const mid = { x: b.w / 2, y: b.h / 2 };
    const far = (q: Pt): number => Math.hypot(q.x - mid.x, q.y - mid.y);
    const pick = far(side(1)) <= far(side(-1)) ? side(1) : side(-1);
    const sweepFrom = e.kind === 'sweep'
      ? { x: clamp(pick.x, b.margin, b.w - b.margin), y: clamp(pick.y, b.margin, b.h - b.margin) }
      : { ...d };
    return { ...e, i, c: ctr, a: half, target: { ...d }, sweepFrom, looks, lock, beamR: dRadius };
  });
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
  /** The iris's burn: 0.3 dim .. 1.5 ignited. */
  glow: number;
  /** The seam's glow while the lids are still shut (0..1). */
  seam: number;
}

const ease = (u: number): number => easeOutCubic(u);

/** Where the eye is at sequence time `t`. Pure. */
export function eyePose(m: EyeMotion, t: number, c: HeroFelConfig = cfg): EyePose {
  const rift = t < m.riftAt ? 0
    : t < m.sealAt ? ease((t - m.riftAt) / Math.max(1, c.riftMs))
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
  let at = m.openAt;
  const snap = (to: Pt, when: number): void => {
    if (t < when) return;
    const u = ease((t - when) / 70);
    look = { x: from.x + (to.x - from.x) * u, y: from.y + (to.y - from.y) * u };
    from = to;
    at = when;
  };
  m.darts.forEach((when, j) => snap(m.looks[j] ?? { x: 0, y: 0 }, when));
  snap(m.lock, m.lockAt);
  void at;
  // The pupil: wide in the dark; it SLAMS to a slit as it locks; a flare as the gaze leaves.
  const breath = 0.04 * Math.sin(t * 0.012 + m.i);
  let pupil = c.dilate + breath;
  if (t >= m.lockAt) pupil = c.dilate + (c.slit - c.dilate) * ease((t - m.lockAt) / 130);
  if (t >= m.fireAt) pupil += 0.14 * Math.exp(-(t - m.fireAt) / 160);
  let glow = 0.35 + 0.25 * clamp01((t - m.openAt) / Math.max(1, m.openMs));
  if (t >= m.lockAt) glow += 0.3 * ease((t - m.lockAt) / 200);
  if (t >= m.fireAt) glow += m.kind === 'lance' ? 0.6 : 0.3;
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
  /** Where it is aimed right now (the sweep moves it). */
  to: Pt;
  /** Its head and tail along from -> to (0..1). */
  head: number;
  tail: number;
  /** Its width as a share of the full width (it swells as it lands). */
  width: number;
}

/** The gaze at sequence time `t`. Pure. */
export function beamPose(m: EyeMotion, t: number, c: HeroFelConfig = cfg): BeamPose {
  const pose = eyePose(m, t, c);
  const from = pupilPoint(m, pose.look);
  const travel = Math.max(1, m.hitAt - m.fireAt);
  let to: Pt = m.kind === 'sweep' ? m.sweepFrom : m.target;
  if (m.kind === 'sweep' && t >= m.hitAt) {
    const u = easeInOutSine((t - m.hitAt) / Math.max(1, m.sweepEnd - m.hitAt));
    to = { x: m.sweepFrom.x + (m.target.x - m.sweepFrom.x) * u, y: m.sweepFrom.y + (m.target.y - m.sweepFrom.y) * u };
  }
  const retract = m.kind === 'pulse' ? 160 : m.kind === 'lance' ? 120 : 180;
  if (t < m.fireAt || t >= m.holdUntil + retract) return { on: false, from, to, head: 0, tail: 0, width: 0 };
  const u = clamp01((t - m.fireAt) / travel);
  const head = 0.3 * u + 0.7 * u * u;
  let tail = 0;
  if (m.kind === 'pulse') tail = t < m.hitAt ? Math.max(0, head - 0.55) : 0.45 + 0.55 * ease((t - m.hitAt) / retract);
  else if (t >= m.holdUntil) tail = ease((t - m.holdUntil) / retract);
  let width = m.kind === 'pulse' ? 0.55 : m.kind === 'hold' ? 0.7 : m.kind === 'sweep' ? 1 : 0.7;
  if (m.kind === 'lance' && t >= m.hitAt) width = 0.7 + 0.9 * ease((t - m.hitAt) / 140);
  return { on: true, from, to, head, tail, width };
}

// ─── the camera (pure) ─────────────────────────────────────────────────────────────────────────────────────────

const springAt = (ms: number, hz: number, tau: number): number => (ms < 0 ? 0 : Math.exp(-ms / tau) * Math.cos(2 * Math.PI * hz * (ms / 1000)));

/**
 * The camera at sequence time `t`: a push in on the eye as it opens; a kick on the gaze; a punch and a directional
 * shake on THE impact. IV: a rumble building while the target is drawn in, the starburst punching hardest.
 */
export function felCameraAt(p: FelPlan, c: HeroFelConfig, t: number, dir: Pt = { x: 1, y: 0 }): { zoom: number; x: number; y: number } {
  if (p.reduced || !p.eyes.length) return { zoom: 1, x: 0, y: 0 };
  const e0 = p.eyes[0]!;
  let z = 0;
  if (t >= p.chargeAt && t < p.impactAt) z += p.zoom * easeInOutSine((t - e0.riftAt) / Math.max(1, e0.lockAt - e0.riftAt));
  else if (t >= p.impactAt) z += (p.zoom * (p.kind === 'lance' ? 1.8 : 1) + p.punch) * Math.exp(-(t - p.impactAt) / Math.max(1, c.zoomOutMs / 4));
  let x = 0, y = 0;
  const kick = (at: number, amp: number, tau: number, hz: number, v: Pt): void => {
    const age = t - at;
    if (age < 0) return;
    const s = springAt(age, hz, tau);
    const across = amp * 0.2 * Math.sin(age * 0.09) * Math.exp(-age / tau);
    x += v.x * amp * s + -v.y * across;
    y += v.y * amp * s + v.x * across;
  };
  p.eyes.forEach((e) => kick(e.fireAt, -p.shakePx * 0.12, 45, 14, dir));
  p.hits.forEach((at) => kick(at, p.shakePx * 0.3, 45, 17, dir));
  if (p.kind === 'lance') {
    if (t >= p.landAt && t < p.impactAt) {
      const u = (t - p.landAt) / Math.max(1, p.impactAt - p.landAt);
      const a = p.shakePx * (0.05 + 0.2 * u * u);
      x += a * Math.sin(t * 0.13);
      y += a * Math.sin(t * 0.17 + 1.1);
    }
    const age = t - p.impactAt;
    if (age >= 0) {
      const env = Math.exp(-age / Math.max(1, c.shakeMs / 4));
      x += p.shakePx * 0.8 * env * Math.sin(age * 0.105 + 0.5);
      y += p.shakePx * env * Math.cos(age * 0.093);
    }
  } else {
    kick(p.impactAt, p.shakePx, Math.max(1, c.shakeMs / 4), 16, dir);
  }
  return { zoom: 1 + Math.max(0, z), x, y };
}

/** Where the camera anchors: the EYE while it opens and seeks, sliding to the TARGET as the gaze lands. Pure. */
export function felCameraFocus(p: FelPlan, t: number, eye: Pt, d: Pt): Pt {
  if (p.reduced || !p.eyes.length) return d;
  const e = p.eyes[p.eyes.length - 1]!;
  if (t <= e.fireAt) return eye;
  if (t >= p.landAt) return d;
  const u = easeInOutSine((t - e.fireAt) / Math.max(1, p.landAt - e.fireAt));
  return { x: eye.x + (d.x - eye.x) * u, y: eye.y + (d.y - eye.y) * u };
}
