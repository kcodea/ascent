/**
 * THE BLAST HERO ATTACK: its tuned values and its pure timeline.
 *
 * Owner 2026-09-28, in order: "instead of the hero attacking for this animation, i want the numbers to all combine,
 * and then the screen slightly shakes and zooms as he blasts pixi blasts from the hero to the opponent"; "blast is a
 * 2/10, i need a 11/10 experience. AAA extremely polished. better impact, more readability, thicker and cleaner
 * animations and sounds that match it"; "keep iterating ... literally blizzard quality pristine. the animation timing
 * should be satisfying and chunky, not rushed. it should be fun to watch, especially at higher dmg thresholds."
 *
 * THE BEATS (base ms before the playback speed; the reference each borrows from in brackets):
 *  1. COMBINE [Balatro scoring]. Each contributing number (the attacker's Tier, then every surviving minion) pops in
 *     big and outlined where it comes from, pulls back a hair, and flies on an arc into ONE total. Every arrival ticks
 *     the total up with its own squash and a rising pitch step. The last lands the ENGINE's number with a slam.
 *  2. CHARGE [anticipation]. The total dives into the attacking hero, who swells while light gathers under a riser;
 *     the view pushes in on the hero; on the big tiers the rest of the screen dims around the two heroes.
 *  3. FIRE. The hero recoils; a muzzle flash; THICK bolts (white-hot core, side-coloured glow, a tapering comet tail)
 *     accelerate into the target. The top tier fires ONE colossal beam instead.
 *  4. IMPACT [hit-stop + directional shake: Vlambeer, Hearthstone Strikes]. Everything FREEZES on the brightest frame,
 *     the portrait squashes and is knocked back, the camera punches in on the target and shakes ALONG the line of fire,
 *     chunky sparks fall. THIS is the beat the consequence lands on (the damage number, Armor, Resolve). The big tiers
 *     add secondary explosions, lingering embers and a scorch. Then everything settles.
 *
 * DAMAGE TIERS (Hearthstone's Strikes step up with the blow; our thresholds follow the engine's per-round loss caps of
 * 5 / 10 / 15 / 20): I 1-5, II 6-11, III 12-19, IV 20+. APPROVED by the owner 2026-09-28 ("those are good thresholds,
 * this blast animation looks good! make it a legendary reward"): 6 / 12 / 20 are the shipped defaults. Every tier escalates the numbers' flight, the slam, the charge,
 * the volley, the hit-stop, the camera, the impact and the audio. Small hits stay brisk (~1.8 s); the top tier earns a
 * ~3.5 s show. Reduced motion: no flight, bolts, shake, zoom or hit-stop; the numbers and the total fade.
 *
 * Tuner convention (the crate's): localStorage in DEV only, values clamped on write and on load; production always
 * plays DEFAULTS. The preview speed is how you are LOOKING and is never saved.
 */

/** The per-tier dials. A config key is `t1..t4` + one of these. */
export const TIER_SUFFIXES = [
  'FlyMs', 'StaggerMs', 'SlamPop', 'HoldMs', 'ChargeMs', 'Motes', 'Bolts', 'BoltSize', 'HitStop', 'Shake', 'Zoom', 'Punch',
  'Sparks', 'SettleMs', 'Dim', 'Booms', 'Beam',
] as const;
export type TierSuffix = (typeof TIER_SUFFIXES)[number];
export const TIERS = [1, 2, 3, 4] as const;
export type TierNum = (typeof TIERS)[number];
type TierKey = `t${TierNum}${TierSuffix}`;

interface GlobalConfig {
  // Tiers
  tier2At: number; tier3At: number; tier4At: number;
  // Combine
  popInMs: number;
  combineBackPx: number;
  combineArc: number;
  combineBias: number;
  chipSize: number;
  totalSize: number;
  tickPop: number;
  slamMs: number;
  // Charge
  absorbMs: number;
  heroSwell: number;
  // Bolts
  boltSpeed: number;
  boltStaggerMs: number;
  boltCurve: number;
  trailLength: number;
  recoilPx: number;
  beamHoldMs: number;
  // Impact
  flashSize: number;
  flashAlpha: number;
  knockPx: number;
  squash: number;
  // Camera
  shakeMs: number;
  zoomOutMs: number;
  reducedFadeMs: number;
  // Colours
  colorCore: string;
  colorPlayer: string;
  colorFoe: string;
  // Sound: a clip, a gain and a pitch per cue ('' = silent)
  sfxGatherClip: string; sfxGatherGain: number;
  sfxTickClip: string; sfxTickGain: number; sfxTickRate: number; sfxTickStep: number;
  sfxSlamClip: string; sfxSlamGain: number; sfxSlamRate: number;
  sfxChargeClip: string; sfxChargeGain: number; sfxChargeRate: number;
  sfxFireClip: string; sfxFireGain: number; sfxFireRate: number;
  sfxBeamClip: string; sfxBeamGain: number; sfxBeamRate: number;
  sfxImpactClip: string; sfxImpactGain: number; sfxImpactRate: number;
  sfxThumpClip: string; sfxThumpGain: number; sfxThumpRate: number;
  sfxBigClip: string; sfxBigGain: number; sfxBigRate: number;
  sfxBoomClip: string; sfxBoomGain: number; sfxBoomRate: number;
  sfxTickLenMs: number;
  sfxImpactLenMs: number;
  sfxBoomLenMs: number;
  sfxTailMix: number;
  sfxDuck: number;
  // Preview only (the tuner's Play buttons). Never read by a real fight, and left out of Copy JSON.
  previewDamage: number;
  previewParts: number;
}
export type HeroBlastConfig = GlobalConfig & Record<TierKey, number>;

export const HERO_BLAST_COLOR_KEYS = ['colorCore', 'colorPlayer', 'colorFoe'] as const;
export const HERO_BLAST_CLIP_KEYS = [
  'sfxGatherClip', 'sfxTickClip', 'sfxSlamClip', 'sfxChargeClip', 'sfxFireClip', 'sfxBeamClip', 'sfxImpactClip', 'sfxThumpClip', 'sfxBigClip', 'sfxBoomClip',
] as const;
type ColorKey = (typeof HERO_BLAST_COLOR_KEYS)[number];
type ClipKey = (typeof HERO_BLAST_CLIP_KEYS)[number];
export type HeroBlastStrKey = ColorKey | ClipKey;
export type HeroBlastNumKey = Exclude<keyof HeroBlastConfig, HeroBlastStrKey>;

/** Tier I .. IV per suffix: the escalation ladder. */
const TIER_DEFAULTS: Record<TierSuffix, [number, number, number, number]> = {
  FlyMs: [300, 330, 360, 380],
  StaggerMs: [95, 100, 105, 110],
  SlamPop: [1.4, 1.55, 1.75, 2],
  HoldMs: [130, 200, 280, 380],
  ChargeMs: [300, 400, 560, 820],
  Motes: [12, 18, 28, 44],
  Bolts: [1, 2, 3, 1],
  BoltSize: [1, 1.2, 1.4, 2.2],
  HitStop: [55, 75, 95, 130],
  Shake: [5, 8, 12, 18],
  Zoom: [0.02, 0.03, 0.045, 0.065],
  Punch: [0.02, 0.028, 0.038, 0.055],
  Sparks: [10, 16, 24, 36],
  SettleMs: [340, 440, 560, 740],
  Dim: [0, 0.18, 0.34, 0.5],
  Booms: [0, 0, 2, 4],
  Beam: [0, 0, 0, 1],
};

export const TIER_RANGES: Record<TierSuffix, [number, number, number]> = {
  FlyMs: [120, 900, 10],
  StaggerMs: [0, 300, 5],
  SlamPop: [1, 3, 0.01],
  HoldMs: [0, 1000, 10],
  ChargeMs: [60, 1500, 10],
  Motes: [0, 80, 1],
  Bolts: [1, 6, 1],
  BoltSize: [0.4, 4, 0.05],
  HitStop: [0, 250, 5],
  Shake: [0, 40, 0.5],
  Zoom: [0, 0.14, 0.002],
  Punch: [0, 0.1, 0.001],
  Sparks: [0, 70, 1],
  SettleMs: [0, 1600, 10],
  Dim: [0, 0.8, 0.01],
  Booms: [0, 6, 1],
  Beam: [0, 1, 1],
};

const tierDefaults = Object.fromEntries(TIERS.flatMap((t) => TIER_SUFFIXES.map((s) => [`t${t}${s}`, TIER_DEFAULTS[s][t - 1]]))) as Record<TierKey, number>;

export const HERO_BLAST_DEFAULTS: HeroBlastConfig = {
  tier2At: 6, tier3At: 12, tier4At: 20,
  popInMs: 140,
  combineBackPx: 24,
  combineArc: 0.14,
  combineBias: 0,
  chipSize: 52,
  totalSize: 132,
  tickPop: 0.26,
  slamMs: 340,
  absorbMs: 190,
  heroSwell: 0.09,
  boltSpeed: 5600,
  boltStaggerMs: 85,
  boltCurve: 0.1,
  trailLength: 1,
  recoilPx: 18,
  beamHoldMs: 230,
  flashSize: 1,
  flashAlpha: 1,
  knockPx: 22,
  squash: 0.11,
  shakeMs: 340,
  zoomOutMs: 380,
  reducedFadeMs: 260,
  colorCore: '#fffaf0',
  colorPlayer: '#ffb627',
  colorFoe: '#ff4057',
  sfxGatherClip: 'TallyTravel', sfxGatherGain: 0.45,
  sfxTickClip: 'AttackPillAdd', sfxTickGain: 0.6, sfxTickRate: 0.9, sfxTickStep: 0.07,
  sfxSlamClip: 'tallyimpact', sfxSlamGain: 0.9, sfxSlamRate: 1.05,
  sfxChargeClip: 'fx/oona-powerup', sfxChargeGain: 0.6, sfxChargeRate: 1.1,
  sfxFireClip: 'fx/oona-launch', sfxFireGain: 0.7, sfxFireRate: 1,
  sfxBeamClip: 'fx/universfield-cinematic-swoosh-impact-454392', sfxBeamGain: 0.7, sfxBeamRate: 1,
  sfxImpactClip: 'fx/blue-impact-hit', sfxImpactGain: 0.95, sfxImpactRate: 1,
  sfxThumpClip: 'smack2', sfxThumpGain: 0.5, sfxThumpRate: 0.82,
  sfxBigClip: 'crit', sfxBigGain: 0.45, sfxBigRate: 0.9,
  sfxBoomClip: 'fx/triple-impact', sfxBoomGain: 0.35, sfxBoomRate: 1.1,
  sfxTickLenMs: 420,
  sfxImpactLenMs: 1300,
  sfxBoomLenMs: 700,
  sfxTailMix: 0.12,
  sfxDuck: 0.5,
  previewDamage: 12,
  previewParts: 4,
  ...tierDefaults,
};

const GLOBAL_RANGES: Record<Exclude<keyof GlobalConfig, HeroBlastStrKey>, [number, number, number]> = {
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
  boltSpeed: [1500, 12000, 50],
  boltStaggerMs: [0, 250, 5],
  boltCurve: [0, 0.4, 0.01],
  trailLength: [0, 2.5, 0.05],
  recoilPx: [0, 60, 1],
  beamHoldMs: [0, 800, 10],
  flashSize: [0.2, 3, 0.05],
  flashAlpha: [0, 1, 0.01],
  knockPx: [0, 60, 1],
  squash: [0, 0.3, 0.01],
  shakeMs: [0, 1200, 10],
  zoomOutMs: [60, 1500, 10],
  reducedFadeMs: [60, 1000, 10],
  sfxGatherGain: [0, 2, 0.05],
  sfxTickGain: [0, 2, 0.05], sfxTickRate: [0.5, 2, 0.01], sfxTickStep: [0, 0.3, 0.005],
  sfxSlamGain: [0, 2, 0.05], sfxSlamRate: [0.5, 2, 0.01],
  sfxChargeGain: [0, 2, 0.05], sfxChargeRate: [0.5, 2, 0.01],
  sfxFireGain: [0, 2, 0.05], sfxFireRate: [0.5, 2, 0.01],
  sfxBeamGain: [0, 2, 0.05], sfxBeamRate: [0.5, 2, 0.01],
  sfxImpactGain: [0, 2, 0.05], sfxImpactRate: [0.5, 2, 0.01],
  sfxThumpGain: [0, 2, 0.05], sfxThumpRate: [0.5, 2, 0.01],
  sfxBigGain: [0, 2, 0.05], sfxBigRate: [0.5, 2, 0.01],
  sfxBoomGain: [0, 2, 0.05], sfxBoomRate: [0.5, 2, 0.01],
  sfxTickLenMs: [80, 2000, 10],
  sfxImpactLenMs: [150, 3500, 10],
  sfxBoomLenMs: [100, 3000, 10],
  sfxTailMix: [0, 0.6, 0.01],
  sfxDuck: [0, 1, 0.05],
  previewDamage: [1, 60, 1],
  previewParts: [1, 8, 1],
};

/** [min, max, step] per numeric key. Values outside are clamped on write AND on load. */
export const HERO_BLAST_RANGES: Record<HeroBlastNumKey, [number, number, number]> = {
  ...GLOBAL_RANGES,
  ...(Object.fromEntries(TIERS.flatMap((t) => TIER_SUFFIXES.map((s) => [`t${t}${s}`, TIER_RANGES[s]]))) as Record<TierKey, [number, number, number]>),
};

/** The hard ceilings a plan can never exceed, whatever the sliders say (so a 40 stays clean, not cluttered). */
export const BLAST_CAPS = { bolts: 6, shakePx: 40, zoom: 0.14, sparks: 70, hitStopMs: 250, booms: 6 } as const;

const HEX = /^#[0-9a-f]{6}$/i;
const isColorKey = (k: string): k is ColorKey => (HERO_BLAST_COLOR_KEYS as readonly string[]).includes(k);
const isClipKey = (k: string): k is ClipKey => (HERO_BLAST_CLIP_KEYS as readonly string[]).includes(k);

/** One value, made safe: numbers clamped into range (junk = the default), colours #rrggbb, clips a short string. */
export function clampHeroBlastValue<K extends keyof HeroBlastConfig>(key: K, value: unknown): HeroBlastConfig[K] | undefined {
  if (!(key in HERO_BLAST_DEFAULTS)) return undefined;
  const def = HERO_BLAST_DEFAULTS[key];
  if (isColorKey(key)) {
    if (typeof value !== 'string') return def;
    const v = value.trim();
    return (HEX.test(v) ? v.toLowerCase() : def) as HeroBlastConfig[K];
  }
  if (isClipKey(key)) return (typeof value === 'string' ? value.trim().slice(0, 160) : def) as HeroBlastConfig[K];
  const n = typeof value === 'number' ? value : Number(value);
  if (typeof value === 'boolean' || value === null || value === '' || !Number.isFinite(n)) return def;
  const [min, max] = HERO_BLAST_RANGES[key as HeroBlastNumKey];
  return Math.min(max, Math.max(min, n)) as HeroBlastConfig[K];
}

/** A whole saved object, sanitised key by key over the defaults (junk and unknown keys dropped). */
export function sanitizeHeroBlastConfig(saved: unknown): HeroBlastConfig {
  const out: HeroBlastConfig = { ...HERO_BLAST_DEFAULTS };
  if (!saved || typeof saved !== 'object') return out;
  for (const [k, v] of Object.entries(saved as Record<string, unknown>)) {
    const safe = clampHeroBlastValue(k as keyof HeroBlastConfig, v);
    if (safe !== undefined) (out as unknown as Record<string, unknown>)[k] = safe;
  }
  return out;
}

const KEY = 'ascent.heroblast.v3';

let cfg: HeroBlastConfig = (() => {
  if (!import.meta.env.DEV || typeof localStorage === 'undefined') return { ...HERO_BLAST_DEFAULTS };
  try { return sanitizeHeroBlastConfig(JSON.parse(localStorage.getItem(KEY) ?? '{}')); } catch { return { ...HERO_BLAST_DEFAULTS }; }
})();

export function getHeroBlastConfig(): HeroBlastConfig { return cfg; }

export function setHeroBlastValue(key: keyof HeroBlastConfig, value: number | string): void {
  const safe = clampHeroBlastValue(key, value);
  if (safe === undefined) return;
  cfg = { ...cfg, [key]: safe };
  if (!import.meta.env.DEV) return;
  try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch { /* ignore */ }
}

export function resetHeroBlastConfig(): void {
  cfg = { ...HERO_BLAST_DEFAULTS };
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}

/** The tuned values as JSON for pasting back into DEFAULTS (the preview-only keys left out). */
export function heroBlastConfigJson(c: HeroBlastConfig = cfg): string {
  const ship: Partial<HeroBlastConfig> = { ...c };
  delete ship.previewDamage;
  delete ship.previewParts;
  return JSON.stringify(ship, null, 2);
}

// ─── the preview speed (DEV only, never saved) ─────────────────────────────────────────────────────────────────

export const HERO_BLAST_SPEEDS = [1, 0.5, 0.25] as const;
export type HeroBlastSpeed = (typeof HERO_BLAST_SPEEDS)[number];
let speed: HeroBlastSpeed = 1;
/** The tuner's slow motion. Always 1 in production. */
export function heroBlastPreviewSpeed(): HeroBlastSpeed { return import.meta.env.DEV ? speed : 1; }
export function setHeroBlastPreviewSpeed(s: HeroBlastSpeed): void { speed = s; }

// ─── the pure plan ─────────────────────────────────────────────────────────────────────────────────────────────

/** The damage tier of a blow (1..4), from the tuned thresholds. */
export function tierOf(total: number, c: HeroBlastConfig = cfg): TierNum {
  if (total >= c.tier4At) return 4;
  if (total >= c.tier3At) return 3;
  if (total >= c.tier2At) return 2;
  return 1;
}

/** One tier's dials, read out of the config. */
export function tierDials(tier: TierNum, c: HeroBlastConfig = cfg): Record<TierSuffix, number> {
  return Object.fromEntries(TIER_SUFFIXES.map((s) => [s, c[`t${tier}${s}`]])) as Record<TierSuffix, number>;
}

export interface BlastPlanInput {
  /** Each contributing number, in the order they fly (the attacker's tier first). */
  values: readonly number[];
  /** THE blow, as the engine decided it. The combine always ends on exactly this. */
  total: number;
  /** Screen px between the attacker's and the defender's centres (bolt travel scales with it). */
  distance: number;
  reduced?: boolean;
}

export interface BlastBolt {
  fireAt: number;
  travelMs: number;
  arriveAt: number;
  /** Size multiplier of this bolt (the lead bolt is the biggest). */
  size: number;
  /** Signed arc (fraction of the distance): the lead bolt flies straight, the rest fan out alternately. */
  curve: number;
}

export interface BlastPlan {
  reduced: boolean;
  /** The damage tier, 1..4. */
  tier: TierNum;
  /** 0..1 across the tiers (I = 0, IV = 1), for the few things that scale smoothly. */
  k: number;
  total: number;
  /** The parts summed past the blow (the round cap). */
  capped: boolean;
  spawns: number[];
  launches: number[];
  arrivals: number[];
  /** The total shown after each arrival. Never exceeds `total`; the last is exactly `total`. */
  counts: number[];
  mergeAt: number;
  slamPop: number;
  chargeAt: number;
  absorbEnd: number;
  fireAt: number;
  motes: number;
  /** The top tier fires one colossal beam (the lead "bolt" is the beam's front). */
  beam: boolean;
  bolts: BlastBolt[];
  /** THE consequence beat: the lead bolt (or the beam's front) lands. The hit-stop freezes the clock right after. */
  impactAt: number;
  /** How long the world freezes on the impact frame (real ms at 1x; slow motion stretches it too). */
  hitStopMs: number;
  /** Secondary explosions around the target, sequence ms. */
  booms: number[];
  endAt: number;
  shakePx: number;
  zoom: number;
  punch: number;
  sparks: number;
  flashScale: number;
  /** How far the rest of the screen dims through the charge and the impact (0 = never). */
  dim: number;
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** Bolt flight time for a distance at a speed, kept inside a readable band. */
export function boltTravelMs(distance: number, pxPerSec: number): number {
  const d = Number.isFinite(distance) && distance > 0 ? distance : 900;
  const v = pxPerSec > 0 ? pxPerSec : HERO_BLAST_DEFAULTS.boltSpeed;
  return Math.round(clamp((d / v) * 1000, 180, 420));
}

/** The running totals the counter shows: each part adds, clamped to the engine's total, and the last is the total. */
export function blastCounts(values: readonly number[], total: number): number[] {
  const t = Math.max(0, Math.round(total));
  let run = 0;
  const out = values.map((v) => { run += Math.max(0, v); return Math.min(run, t); });
  if (out.length) out[out.length - 1] = t;
  return out;
}

/** The whole Blast, in base ms (divide by the playback speed for real time). Pure and deterministic. */
export function blastPlan(input: BlastPlanInput, c: HeroBlastConfig = cfg): BlastPlan {
  const total = Math.max(0, Math.round(input.total));
  const values = input.values.filter((v) => Number.isFinite(v));
  const rawSum = values.reduce((s, v) => s + Math.max(0, v), 0);
  const tier = tierOf(total, c);
  const T = tierDials(tier, c);
  const k = (tier - 1) / 3;
  const counts = blastCounts(values, total);
  const capped = rawSum > total;
  const n = values.length;

  if (input.reduced) {
    // The numbers fade in where they are, then the total; the blow lands; everything fades. No motion at all.
    const f = c.reducedFadeMs;
    const arrivals = values.map(() => f + 120);
    const mergeAt = f + 120;
    const impactAt = mergeAt + f + 200;
    return {
      reduced: true, tier, k, total, capped, spawns: values.map(() => 0), launches: arrivals.slice(), arrivals, counts,
      mergeAt, slamPop: 1, chargeAt: impactAt, absorbEnd: impactAt, fireAt: impactAt, motes: 0, beam: false, bolts: [], impactAt,
      hitStopMs: 0, booms: [], endAt: impactAt + f + 120, shakePx: 0, zoom: 0, punch: 0, sparks: 0, flashScale: 0, dim: 0,
    };
  }

  const spawns = values.map((_, i) => i * T.StaggerMs * 0.6);
  const launches = values.map((_, i) => c.popInMs + i * T.StaggerMs);
  const arrivals = launches.map((l) => l + T.FlyMs);
  const mergeAt = n ? arrivals[n - 1]! : c.popInMs;
  const chargeAt = mergeAt + T.HoldMs;
  const absorbEnd = chargeAt + c.absorbMs;
  const fireAt = chargeAt + Math.max(T.ChargeMs, c.absorbMs);

  const beam = T.Beam >= 1;
  const count = beam ? 1 : clamp(Math.round(T.Bolts), 1, BLAST_CAPS.bolts);
  const travel = boltTravelMs(input.distance, c.boltSpeed) * (beam ? 0.8 : 1);
  const bolts: BlastBolt[] = [];
  for (let i = 0; i < count; i++) {
    const at = fireAt + i * c.boltStaggerMs;
    // Trailing bolts are smaller and a touch faster, so the volley bunches up into the target.
    const tr = Math.round(travel * (1 - Math.min(0.2, i * 0.06)));
    const side = i === 0 ? 0 : (i % 2 === 1 ? 1 : -1) * (1 + Math.floor((i - 1) / 2) * 0.6);
    bolts.push({ fireAt: at, travelMs: tr, arriveAt: at + tr, size: T.BoltSize * (i === 0 ? 1 : 0.72), curve: c.boltCurve * side });
  }
  const impactAt = bolts[0]!.arriveAt;
  const lastHit = Math.max(...bolts.map((b) => b.arriveAt));
  const nBooms = clamp(Math.round(T.Booms), 0, BLAST_CAPS.booms);
  const booms = Array.from({ length: nBooms }, (_, i) => impactAt + 120 + i * 95);
  const lastBeat = Math.max(lastHit + 160, impactAt + (beam ? c.beamHoldMs : 0), booms.length ? booms[booms.length - 1]! + 120 : 0, impactAt + c.zoomOutMs * 0.8);
  const endAt = lastBeat + T.SettleMs;

  return {
    reduced: false, tier, k, total, capped, spawns, launches, arrivals, counts,
    mergeAt, slamPop: T.SlamPop, chargeAt, absorbEnd, fireAt, motes: Math.round(T.Motes), beam, bolts, impactAt,
    hitStopMs: Math.round(clamp(T.HitStop, 0, BLAST_CAPS.hitStopMs)),
    booms,
    endAt,
    shakePx: clamp(T.Shake, 0, BLAST_CAPS.shakePx),
    zoom: clamp(T.Zoom, 0, BLAST_CAPS.zoom),
    punch: T.Punch,
    sparks: Math.round(clamp(T.Sparks, 0, BLAST_CAPS.sparks)),
    flashScale: c.flashSize * (0.85 + 0.25 * (tier - 1)),
    dim: T.Dim,
  };
}

export type BlastCueKind = 'spawn' | 'launch' | 'arrive' | 'merge' | 'charge' | 'fire' | 'impact' | 'hit' | 'boom' | 'end';
export interface BlastCue { at: number; kind: BlastCueKind; i: number }

/** Every beat the runner fires, in time order (ties keep this declaration order, so impact precedes end). */
export function blastCues(p: BlastPlan): BlastCue[] {
  const out: BlastCue[] = [];
  p.spawns.forEach((at, i) => out.push({ at, kind: 'spawn', i }));
  if (!p.reduced) p.launches.forEach((at, i) => out.push({ at, kind: 'launch', i }));
  p.arrivals.forEach((at, i) => out.push({ at, kind: 'arrive', i }));
  out.push({ at: p.mergeAt, kind: 'merge', i: 0 });
  if (!p.reduced) out.push({ at: p.chargeAt, kind: 'charge', i: 0 });
  p.bolts.forEach((b, i) => out.push({ at: b.fireAt, kind: 'fire', i }));
  out.push({ at: p.impactAt, kind: 'impact', i: 0 });
  p.bolts.forEach((b, i) => { if (i > 0) out.push({ at: b.arriveAt, kind: 'hit', i }); });
  p.booms.forEach((at, i) => out.push({ at, kind: 'boom', i }));
  out.push({ at: p.endAt, kind: 'end', i: 0 });
  const order: Record<BlastCueKind, number> = { spawn: 0, launch: 1, arrive: 2, merge: 3, charge: 4, fire: 5, impact: 6, hit: 7, boom: 8, end: 9 };
  return out.map((c, idx) => ({ c, idx })).sort((a, b) => a.c.at - b.c.at || order[a.c.kind] - order[b.c.kind] || a.idx - b.idx).map((x) => x.c);
}

/** '#rrggbb' -> 0xRRGGBB (bad input = white). */
export function hexToNum(hex: string): number {
  const v = Number.parseInt(hex.replace('#', ''), 16);
  return Number.isFinite(v) ? v : 0xffffff;
}
