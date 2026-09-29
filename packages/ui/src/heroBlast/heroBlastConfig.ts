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
 *  1. THE DAMAGE FORMATION (shared by every style, `../heroAttack/damageFormation.ts`, owner ask 2026-09-28): minion
 *     tiers pulse left to right and merge, the hero tier joins, the full blow, the cap. Its end is this style's start.
 *  2. CHARGE [anticipation]. The total dives into the attacking hero, who swells while light gathers under a riser;
 *     the view pushes in on the hero; on the big tiers the rest of the screen dims around the two heroes.
 *  3. FIRE. The hero recoils; a muzzle flash; THICK bolts (white-hot core, side-coloured glow, a tapering comet tail)
 *     accelerate into the target: one, a volley of two, a barrage of five. The top tier fires ONE colossal beam
 *     instead, which lands (a tick), holds, then DRAINS into the struck hero: the light implodes into it and
 *     detonates in an arcane SUPERNOVA (rays, a triple shockwave, a screen-wide ring). Owner 2026-09-29.
 *  4. IMPACT [directional shake: Vlambeer, Hearthstone Strikes] (at IV, the supernova). The flash starts at its brightest (no hit-stop: the owner
 *     ruled it out 2026-09-28, "it looks like lag"),
 *     the portrait squashes and is knocked back, the camera punches in on the target and shakes ALONG the line of fire,
 *     chunky sparks fall. THIS is the beat the consequence lands on (the damage number, Armor, Resolve). The big tiers
 *     add secondary explosions, lingering embers and a scorch. Then everything settles.
 *
 * DAMAGE TIERS (Hearthstone's Strikes step up with the blow; our thresholds follow the engine's per-round loss caps of
 * 5 / 10 / 15 / 20): I 1-5, II 6-11, III 12-19, IV 20+. APPROVED by the owner 2026-09-28 ("those are good thresholds,
 * this blast animation looks good! make it a legendary reward"): 6 / 12 / 20 are the shipped defaults. Every tier escalates the numbers' flight, the slam, the charge,
 * the volley, the camera, the impact and the audio. Small hits stay brisk (~1.2 s after the formation); the top tier
 * earns a ~2.9 s show (the beam and the supernova). Reduced motion: no flight, bolts, shake or zoom; numbers fade.
 *
 * Tuner convention (the crate's): localStorage in DEV only, values clamped on write and on load; production always
 * plays DEFAULTS. The preview speed is how you are LOOKING and is never saved.
 */

import { hexToNum } from '../heroAttack/easing';
import {
  HERO_ATTACK_TIER_THRESHOLDS, TIERS, reducedAttackTimeline, tierOf as sharedTierOf, type TierNum, attackTier, type AttackTierContext,
} from '../heroAttack/tiers';

export { TIERS, hexToNum, type TierNum };

/** The per-tier dials. A config key is `t1..t4` + one of these. */
export const TIER_SUFFIXES = [
  'ChargeMs', 'Motes', 'Bolts', 'BoltSize', 'Shake', 'Zoom', 'Punch',
  'Sparks', 'SettleMs', 'Dim', 'Booms', 'Beam', 'Nova',
] as const;
export type TierSuffix = (typeof TIER_SUFFIXES)[number];
type TierKey = `t${TierNum}${TierSuffix}`;

interface GlobalConfig {
  // Tiers
  tier2At: number; tier3At: number; tier4At: number;
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
  // Supernova (a tier with Nova on: the beam drains into the target, which implodes, then detonates)
  collapseMs: number;
  collapseMotes: number;
  novaSize: number;
  novaRays: number;
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
  sfxChargeClip: string; sfxChargeGain: number; sfxChargeRate: number;
  sfxFireClip: string; sfxFireGain: number; sfxFireRate: number;
  sfxBeamClip: string; sfxBeamGain: number; sfxBeamRate: number;
  sfxImpactClip: string; sfxImpactGain: number; sfxImpactRate: number;
  sfxThumpClip: string; sfxThumpGain: number; sfxThumpRate: number;
  sfxBigClip: string; sfxBigGain: number; sfxBigRate: number;
  sfxBoomClip: string; sfxBoomGain: number; sfxBoomRate: number;
  sfxCollapseClip: string; sfxCollapseGain: number; sfxCollapseRate: number;
  sfxNovaClip: string; sfxNovaGain: number; sfxNovaRate: number;
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
  'sfxChargeClip', 'sfxFireClip', 'sfxBeamClip', 'sfxImpactClip', 'sfxThumpClip', 'sfxBigClip', 'sfxBoomClip',
  'sfxCollapseClip', 'sfxNovaClip',
] as const;
type ColorKey = (typeof HERO_BLAST_COLOR_KEYS)[number];
type ClipKey = (typeof HERO_BLAST_CLIP_KEYS)[number];
export type HeroBlastStrKey = ColorKey | ClipKey;
export type HeroBlastNumKey = Exclude<keyof HeroBlastConfig, HeroBlastStrKey>;

/**
 * Tier I .. IV per suffix: the escalation ladder. FOUR distinct steps (owner 2026-09-29, "use the same 4 tier strategy
 * we have been. add a tier to the blast attack so they all have 4"), the way Arcana and Frost ladder:
 * I one bolt; II a two-bolt volley; III a BARRAGE of five fanned bolts; IV the colossal beam, which drains into the
 * struck hero, implodes and detonates in an arcane SUPERNOVA (the blow lands on the detonation).
 */
const TIER_DEFAULTS: Record<TierSuffix, [number, number, number, number]> = {
  ChargeMs: [300, 400, 560, 820],
  Motes: [12, 18, 28, 44],
  Bolts: [1, 2, 5, 1],
  BoltSize: [1, 1.2, 1.3, 2.2],
  Shake: [5, 8, 12, 18],
  Zoom: [0.02, 0.03, 0.045, 0.065],
  Punch: [0.02, 0.028, 0.038, 0.055],
  Sparks: [10, 16, 24, 36],
  SettleMs: [340, 440, 560, 740],
  Dim: [0, 0.18, 0.34, 0.5],
  Booms: [0, 0, 2, 4],
  Beam: [0, 0, 0, 1],
  Nova: [0, 0, 0, 1],
};

export const TIER_RANGES: Record<TierSuffix, [number, number, number]> = {
  ChargeMs: [60, 1500, 10],
  Motes: [0, 80, 1],
  Bolts: [1, 6, 1],
  BoltSize: [0.4, 4, 0.05],
  Shake: [0, 40, 0.5],
  Zoom: [0, 0.14, 0.002],
  Punch: [0, 0.1, 0.001],
  Sparks: [0, 70, 1],
  SettleMs: [0, 1600, 10],
  Dim: [0, 0.8, 0.01],
  Booms: [0, 6, 1],
  Beam: [0, 1, 1],
  Nova: [0, 1, 1],
};

const tierDefaults = Object.fromEntries(TIERS.flatMap((t) => TIER_SUFFIXES.map((s) => [`t${t}${s}`, TIER_DEFAULTS[s][t - 1]]))) as Record<TierKey, number>;

export const HERO_BLAST_DEFAULTS: HeroBlastConfig = {
  // The shared, owner-approved thresholds (6 / 12 / 20): every hero attack steps up on the same blow.
  ...HERO_ATTACK_TIER_THRESHOLDS,
  absorbMs: 190,
  heroSwell: 0.09,
  boltSpeed: 5600,
  boltStaggerMs: 85,
  boltCurve: 0.1,
  trailLength: 1,
  recoilPx: 18,
  beamHoldMs: 230,
  collapseMs: 340,
  collapseMotes: 30,
  novaSize: 1,
  novaRays: 12,
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
  sfxChargeClip: 'fx/oona-powerup', sfxChargeGain: 0.6, sfxChargeRate: 1.1,
  sfxFireClip: 'fx/oona-launch', sfxFireGain: 0.7, sfxFireRate: 1,
  sfxBeamClip: 'fx/universfield-cinematic-swoosh-impact-454392', sfxBeamGain: 0.7, sfxBeamRate: 1,
  sfxImpactClip: 'fx/blue-impact-hit', sfxImpactGain: 0.95, sfxImpactRate: 1,
  sfxThumpClip: 'smack2', sfxThumpGain: 0.5, sfxThumpRate: 0.82,
  sfxBigClip: 'crit', sfxBigGain: 0.45, sfxBigRate: 0.9,
  sfxBoomClip: 'fx/triple-impact', sfxBoomGain: 0.35, sfxBoomRate: 1.1,
  sfxCollapseClip: 'runeselectimplosion', sfxCollapseGain: 0.7, sfxCollapseRate: 1,
  sfxNovaClip: 'turnexplosion', sfxNovaGain: 0.6, sfxNovaRate: 1.12,
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
  absorbMs: [60, 600, 10],
  heroSwell: [0, 0.3, 0.01],
  boltSpeed: [1500, 12000, 50],
  boltStaggerMs: [0, 250, 5],
  boltCurve: [0, 0.4, 0.01],
  trailLength: [0, 2.5, 0.05],
  recoilPx: [0, 60, 1],
  beamHoldMs: [0, 800, 10],
  collapseMs: [120, 900, 10],
  collapseMotes: [0, 60, 1],
  novaSize: [0.3, 2.5, 0.05],
  novaRays: [0, 20, 1],
  flashSize: [0.2, 3, 0.05],
  flashAlpha: [0, 1, 0.01],
  knockPx: [0, 60, 1],
  squash: [0, 0.3, 0.01],
  shakeMs: [0, 1200, 10],
  zoomOutMs: [60, 1500, 10],
  reducedFadeMs: [60, 1000, 10],
  sfxChargeGain: [0, 2, 0.05], sfxChargeRate: [0.5, 2, 0.01],
  sfxFireGain: [0, 2, 0.05], sfxFireRate: [0.5, 2, 0.01],
  sfxBeamGain: [0, 2, 0.05], sfxBeamRate: [0.5, 2, 0.01],
  sfxImpactGain: [0, 2, 0.05], sfxImpactRate: [0.5, 2, 0.01],
  sfxThumpGain: [0, 2, 0.05], sfxThumpRate: [0.5, 2, 0.01],
  sfxBigGain: [0, 2, 0.05], sfxBigRate: [0.5, 2, 0.01],
  sfxBoomGain: [0, 2, 0.05], sfxBoomRate: [0.5, 2, 0.01],
  sfxCollapseGain: [0, 2, 0.05], sfxCollapseRate: [0.5, 2, 0.01],
  sfxNovaGain: [0, 2, 0.05], sfxNovaRate: [0.5, 2, 0.01],
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
export const BLAST_CAPS = { bolts: 6, shakePx: 40, zoom: 0.14, sparks: 70, booms: 6, novaRays: 20 } as const;

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
  return sharedTierOf(total, c);
}

/** One tier's dials, read out of the config. */
export function tierDials(tier: TierNum, c: HeroBlastConfig = cfg): Record<TierSuffix, number> {
  return Object.fromEntries(TIER_SUFFIXES.map((s) => [s, c[`t${tier}${s}`]])) as Record<TierSuffix, number>;
}

export interface BlastPlanInput extends AttackTierContext {
  /** When the style's own attack starts: the end of the shared damage formation (`formationPlan().endAt`). */
  leadIn?: number;
  /** THE blow, as the engine decided it. */
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
  chargeAt: number;
  absorbEnd: number;
  fireAt: number;
  motes: number;
  /** The top tier fires one colossal beam (the lead "bolt" is the beam's front). */
  beam: boolean;
  /**
   * The top tier's finale: the beam lands (`beamHitAt`, a tick with FX only), holds, then DRAINS into the struck hero
   * from `collapseAt` (the implosion), which detonates in a supernova on `impactAt`.
   */
  nova: boolean;
  bolts: BlastBolt[];
  /** The lead bolt (or the beam's front) reaches the target. Equals `impactAt` unless the tier has a nova. */
  beamHitAt: number;
  /** Nova only: the beam starts draining into the target and it implodes (else = impactAt). */
  collapseAt: number;
  /** Nova rays (0 without a nova). */
  novaRays: number;
  /** THE consequence beat: the lead bolt (or the beam's front) lands, or at a nova tier, the supernova detonates. */
  impactAt: number;
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

/** The whole Blast, in base ms (divide by the playback speed for real time). Pure and deterministic. */
export function blastPlan(input: BlastPlanInput, c: HeroBlastConfig = cfg): BlastPlan {
  const total = Math.max(0, Math.round(input.total));
  const tier = attackTier(total, input, c); // a knockout always plays Tier IV (heroAttack/tiers.ts)
  const T = tierDials(tier, c);
  const k = (tier - 1) / 3;

  if (input.reduced) {
    // The formation has faded through its stages; the blow lands; everything fades. No motion at all.
    const r = reducedAttackTimeline(input.leadIn ?? 0, c.reducedFadeMs);
    const { impactAt } = r;
    return {
      reduced: true, tier, k, total,
      chargeAt: impactAt, absorbEnd: impactAt, fireAt: impactAt, motes: 0, beam: false, nova: false, bolts: [],
      beamHitAt: impactAt, collapseAt: impactAt, novaRays: 0, impactAt,
      booms: [], endAt: r.endAt, shakePx: 0, zoom: 0, punch: 0, sparks: 0, flashScale: 0, dim: 0,
    };
  }

  // The shared damage formation plays first; the style's own attack starts when it ends.
  const chargeAt = Math.max(0, input.leadIn ?? 0);
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
  const beamHitAt = bolts[0]!.arriveAt;
  // The supernova needs the beam: a nova on a bolt tier is ignored (the tuner can switch either independently).
  const nova = beam && T.Nova >= 1;
  const collapseAt = nova ? beamHitAt + c.beamHoldMs : beamHitAt;
  const impactAt = nova ? collapseAt + c.collapseMs : beamHitAt;
  const lastHit = Math.max(...bolts.map((b) => b.arriveAt));
  const nBooms = clamp(Math.round(T.Booms), 0, BLAST_CAPS.booms);
  const booms = Array.from({ length: nBooms }, (_, i) => impactAt + 120 + i * 95);
  const lastBeat = Math.max(
    lastHit + 160, impactAt + (beam && !nova ? c.beamHoldMs : 0), booms.length ? booms[booms.length - 1]! + 120 : 0,
    impactAt + c.zoomOutMs * (nova ? 1.2 : 0.8),
  );
  const endAt = lastBeat + T.SettleMs;

  return {
    reduced: false, tier, k, total, chargeAt, absorbEnd, fireAt, motes: Math.round(T.Motes), beam, nova, bolts,
    beamHitAt, collapseAt, novaRays: nova ? Math.round(clamp(c.novaRays, 0, BLAST_CAPS.novaRays)) : 0, impactAt,
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

export type BlastCueKind = 'charge' | 'fire' | 'beamhit' | 'collapse' | 'impact' | 'hit' | 'boom' | 'end';
export interface BlastCue { at: number; kind: BlastCueKind; i: number }

/** Every beat the runner fires, in time order (ties keep this declaration order, so impact precedes end). */
export function blastCues(p: BlastPlan): BlastCue[] {
  const out: BlastCue[] = [];
  if (!p.reduced) out.push({ at: p.chargeAt, kind: 'charge', i: 0 });
  p.bolts.forEach((b, i) => out.push({ at: b.fireAt, kind: 'fire', i }));
  if (p.nova) {
    out.push({ at: p.beamHitAt, kind: 'beamhit', i: 0 });
    out.push({ at: p.collapseAt, kind: 'collapse', i: 0 });
  }
  out.push({ at: p.impactAt, kind: 'impact', i: 0 });
  p.bolts.forEach((b, i) => { if (i > 0) out.push({ at: b.arriveAt, kind: 'hit', i }); });
  p.booms.forEach((at, i) => out.push({ at, kind: 'boom', i }));
  out.push({ at: p.endAt, kind: 'end', i: 0 });
  const order: Record<BlastCueKind, number> = { charge: 4, fire: 5, beamhit: 6, collapse: 7, impact: 8, hit: 9, boom: 10, end: 11 };
  return out.map((c, idx) => ({ c, idx })).sort((a, b) => a.c.at - b.c.at || order[a.c.kind] - order[b.c.kind] || a.idx - b.idx).map((x) => x.c);
}

