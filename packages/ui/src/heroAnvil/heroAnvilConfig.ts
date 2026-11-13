/**
 * LOOK OUT BELOW (style id `anvil`, a RARE hero attack): its tuned values, its pure timeline, the pure squash of the
 * struck portrait and the pure camera.
 *
 * ONE CLEAR IDEA: THE CARTOON DROP. A shadow grows on the struck portrait while a slide whistle falls, something heavy
 * drops out of the sky from off the top of the screen, and the portrait SQUASHES FLAT under it, then pops back like an
 * accordion. No other attack drops an object onto the portrait or flattens it.
 *
 * TWO VISUAL TIERS (a Rare has two, not four). The shared four map onto them here (`anvilLevel`): I-II play SMALL,
 * III-IV play BIG, so a knockout (which always forces the shared Tier IV) plays BIG.
 *  - SMALL: a black iron ANVIL. A round shadow, a short whistle, the clang, a ring of dust.
 *  - BIG: an upright PIANO. A much larger shadow, a longer whistle, a heavier squash, a bigger dust ring and piano keys
 *    scattering out and bouncing.
 *
 * THE BEATS (base ms before the playback speed): the shared damage formation (its end is this style's start); the CUE
 * (the total sinks into the striking hero, who gives a small hop and sends a spark straight up); the SHADOW (it appears
 * on the struck portrait and grows for the whole fall, the whistle under it); the DROP (the object comes in fast from
 * above the screen over the last part of the fall); THE IMPACT (the landing: the consequence lands ONCE, here, and the
 * portrait is pressed flat); the HOLD (flat under the weight); the POP (the object tips off and falls away, the
 * portrait springs back through two or three accordion overshoots and settles exactly). No hit-stop anywhere: the hold
 * is drawn, the clock never stops. Reduced motion: no object, no squash, no shake, no zoom; the numbers fade and the
 * blow lands.
 *
 * Tuner convention (the Blast's): localStorage in DEV only, values clamped on write and on load; production always
 * plays DEFAULTS.
 */
import { configStore } from '../heroAttack/configStore';
import { clamp, type Pt } from '../heroAttack/easing';
import {
  HERO_ATTACK_TIER_THRESHOLDS, reducedAttackTimeline, attackTier, type AttackTierContext, type TierNum,
} from '../heroAttack/tiers';

export type { TierNum };

/** The two visual tiers of a Rare. */
export const ANVIL_LEVELS = ['small', 'big'] as const;
export type AnvilLevel = (typeof ANVIL_LEVELS)[number];

/** The shared four tiers onto this Rare's two: I-II small, III-IV big (a knockout forces IV, so it plays big). */
export function anvilLevel(tier: TierNum): AnvilLevel { return tier >= 3 ? 'big' : 'small'; }

/** The per-level dials. A config key is `small` / `big` + one of these. */
export const ANVIL_LEVEL_SUFFIXES = [
  'ReadyMs', 'FallMs', 'DropMs', 'HoldMs', 'SettleMs', 'Size', 'Shadow', 'Flat', 'Bulge', 'Dust', 'Keys',
  'Shake', 'Zoom', 'Punch', 'Dim',
] as const;
export type AnvilLevelSuffix = (typeof ANVIL_LEVEL_SUFFIXES)[number];
type LevelKey = `${AnvilLevel}${AnvilLevelSuffix}`;

interface GlobalConfig {
  tier2At: number; tier3At: number; tier4At: number;
  absorbMs: number;
  heroHopPx: number;
  shadowAlpha: number;
  popHz: number;
  popTauMs: number;
  tipMs: number;
  tipSpeed: number;
  tipGravity: number;
  keySpeed: number;
  keyGravity: number;
  shakeMs: number;
  zoomOutMs: number;
  reducedFadeMs: number;
  colorDust: string;
  colorSpark: string;
  colorShadow: string;
  colorPlayer: string;
  colorFoe: string;
  sfxCueClip: string; sfxCueGain: number; sfxCueRate: number;
  sfxWhistleClip: string; sfxWhistleGain: number; sfxWhistleRate: number;
  sfxClangClip: string; sfxClangGain: number; sfxClangRate: number;
  sfxPianoClip: string; sfxPianoGain: number; sfxPianoRate: number;
  sfxThudClip: string; sfxThudGain: number; sfxThudRate: number;
  sfxPopClip: string; sfxPopGain: number; sfxPopRate: number;
  sfxDuck: number;
  previewDamage: number;
  previewParts: number;
}
export type HeroAnvilConfig = GlobalConfig & Record<LevelKey, number>;

export const HERO_ANVIL_COLOR_KEYS = ['colorDust', 'colorSpark', 'colorShadow', 'colorPlayer', 'colorFoe'] as const;
export const HERO_ANVIL_CLIP_KEYS = ['sfxCueClip', 'sfxWhistleClip', 'sfxClangClip', 'sfxPianoClip', 'sfxThudClip', 'sfxPopClip'] as const;
export type HeroAnvilStrKey = (typeof HERO_ANVIL_COLOR_KEYS)[number] | (typeof HERO_ANVIL_CLIP_KEYS)[number];
export type HeroAnvilNumKey = Exclude<keyof HeroAnvilConfig, HeroAnvilStrKey>;

/** Small, big per suffix. */
const LEVEL_DEFAULTS: Record<AnvilLevelSuffix, [number, number]> = {
  ReadyMs: [220, 260],
  FallMs: [480, 720],
  DropMs: [210, 250],
  HoldMs: [270, 350],
  SettleMs: [470, 540],
  Size: [1.9, 2.5],
  Shadow: [0.95, 1.7],
  Flat: [0.26, 0.17],
  Bulge: [0.42, 0.5],
  Dust: [10, 18],
  Keys: [0, 14],
  Shake: [7, 13],
  Zoom: [0.02, 0.035],
  Punch: [0.02, 0.035],
  Dim: [0.1, 0.22],
};

export const ANVIL_LEVEL_RANGES: Record<AnvilLevelSuffix, [number, number, number]> = {
  ReadyMs: [60, 1200, 10],
  FallMs: [200, 2000, 10],
  DropMs: [80, 800, 10],
  HoldMs: [60, 1200, 10],
  SettleMs: [200, 1500, 10],
  Size: [0.8, 4, 0.05],
  Shadow: [0.3, 3, 0.05],
  Flat: [0.1, 0.9, 0.01],
  Bulge: [0, 1, 0.01],
  Dust: [0, 30, 1],
  Keys: [0, 20, 1],
  Shake: [0, 30, 0.5],
  Zoom: [0, 0.1, 0.002],
  Punch: [0, 0.08, 0.001],
  Dim: [0, 0.6, 0.01],
};

const levelDefaults = Object.fromEntries(ANVIL_LEVELS.flatMap((l, i) => ANVIL_LEVEL_SUFFIXES.map((s) => [`${l}${s}`, LEVEL_DEFAULTS[s][i]]))) as Record<LevelKey, number>;

export const HERO_ANVIL_DEFAULTS: HeroAnvilConfig = {
  ...HERO_ATTACK_TIER_THRESHOLDS,
  absorbMs: 180,
  heroHopPx: 10,
  shadowAlpha: 0.8,
  popHz: 5.5,
  popTauMs: 95,
  tipMs: 640,
  tipSpeed: 620,
  tipGravity: 2600,
  keySpeed: 760,
  keyGravity: 2300,
  shakeMs: 300,
  zoomOutMs: 340,
  reducedFadeMs: 260,
  colorDust: '#d9cdb8',
  colorSpark: '#fff1b8',
  colorShadow: '#05060a',
  colorPlayer: '#ffd76a',
  colorFoe: '#ff6a4d',
  sfxCueClip: 'fx/stereogenicstudio-swish-swoosh-woosh-sfx-27-357164-3', sfxCueGain: 0.22, sfxCueRate: 2,
  sfxWhistleClip: 'fx/anvil-whistle', sfxWhistleGain: 0.4, sfxWhistleRate: 1.3,
  sfxClangClip: 'fx/anvil-clang', sfxClangGain: 0.7, sfxClangRate: 1,
  sfxPianoClip: 'fx/anvil-piano', sfxPianoGain: 0.7, sfxPianoRate: 1,
  sfxThudClip: 'fx/universfield-ground-impact-352053', sfxThudGain: 0.3, sfxThudRate: 1.1,
  sfxPopClip: 'fx/stereogenicstudio-swish-swoosh-woosh-sfx-27-357164-3', sfxPopGain: 0.2, sfxPopRate: 1.5,
  sfxDuck: 0.6,
  previewDamage: 12,
  previewParts: 4,
  ...levelDefaults,
};

const GLOBAL_RANGES: Record<Exclude<keyof GlobalConfig, HeroAnvilStrKey>, [number, number, number]> = {
  tier2At: [2, 40, 1], tier3At: [2, 60, 1], tier4At: [2, 80, 1],
  absorbMs: [60, 600, 10],
  heroHopPx: [0, 40, 1],
  shadowAlpha: [0, 1, 0.01],
  popHz: [2, 12, 0.1],
  popTauMs: [30, 300, 5],
  tipMs: [200, 1500, 10],
  tipSpeed: [100, 1600, 10],
  tipGravity: [0, 6000, 20],
  keySpeed: [100, 1800, 10],
  keyGravity: [0, 6000, 20],
  shakeMs: [0, 1200, 10],
  zoomOutMs: [60, 1500, 10],
  reducedFadeMs: [60, 1000, 10],
  sfxCueGain: [0, 2, 0.05], sfxCueRate: [0.5, 2.5, 0.01],
  sfxWhistleGain: [0, 2, 0.05], sfxWhistleRate: [0.5, 2.5, 0.01],
  sfxClangGain: [0, 2, 0.05], sfxClangRate: [0.5, 2.5, 0.01],
  sfxPianoGain: [0, 2, 0.05], sfxPianoRate: [0.5, 2.5, 0.01],
  sfxThudGain: [0, 2, 0.05], sfxThudRate: [0.5, 2.5, 0.01],
  sfxPopGain: [0, 2, 0.05], sfxPopRate: [0.5, 2.5, 0.01],
  sfxDuck: [0, 1, 0.05],
  previewDamage: [1, 60, 1],
  previewParts: [1, 8, 1],
};

/** [min, max, step] per numeric key. Values outside are clamped on write AND on load. */
export const HERO_ANVIL_RANGES: Record<HeroAnvilNumKey, [number, number, number]> = {
  ...GLOBAL_RANGES,
  ...(Object.fromEntries(ANVIL_LEVELS.flatMap((l) => ANVIL_LEVEL_SUFFIXES.map((s) => [`${l}${s}`, ANVIL_LEVEL_RANGES[s]]))) as Record<LevelKey, [number, number, number]>),
};

/** The hard ceilings a plan never exceeds, whatever the sliders say. */
export const ANVIL_CAPS = { dust: 30, keys: 20, shakePx: 30, zoom: 0.1 } as const;

const store = configStore<HeroAnvilConfig>({
  key: 'ascent.heroanvil.v1', defaults: HERO_ANVIL_DEFAULTS, ranges: HERO_ANVIL_RANGES,
  colorKeys: HERO_ANVIL_COLOR_KEYS, clipKeys: HERO_ANVIL_CLIP_KEYS, previewKeys: ['previewDamage', 'previewParts'],
});
/** The store itself (the tuner reads and writes through it). */
export const heroAnvilStore = store;
export const getHeroAnvilConfig = store.get;
export const clampHeroAnvilValue = store.clamp;
export const sanitizeHeroAnvilConfig = store.sanitize;
export const setHeroAnvilValue = store.set;
export const resetHeroAnvilConfig = store.reset;
export const heroAnvilConfigJson = store.json;
/** The tuners' preview speed hook (Recruit + the Collection read one per style). Always 1: the Rare tuners have none. */
export function heroAnvilPreviewSpeed(): number { return 1; }

/** One level's dials, read out of the config. */
export function anvilLevelDials(level: AnvilLevel, c: HeroAnvilConfig = store.get()): Record<AnvilLevelSuffix, number> {
  return Object.fromEntries(ANVIL_LEVEL_SUFFIXES.map((s) => [s, c[`${level}${s}`]])) as Record<AnvilLevelSuffix, number>;
}

// ─── the pure plan ─────────────────────────────────────────────────────────────────────────────────────────────

/** The reference fall the drop time is tuned at (the top of a 1080p board down to a portrait in its lower half). */
export const ANVIL_REF_FALL = 700;

/** The visible drop for a fall height: the level's time, scaled gently by the height (a portrait near the top is not a blink). */
export function anvilDropMs(fallPx: number, levelMs: number): number {
  const d = Number.isFinite(fallPx) && fallPx > 0 ? fallPx : ANVIL_REF_FALL;
  return Math.round(levelMs * clamp(Math.sqrt(d / ANVIL_REF_FALL), 0.75, 1.25));
}

export interface AnvilPlanInput extends AttackTierContext {
  /** When the style's own attack starts: the end of the shared damage formation. */
  leadIn?: number;
  total: number;
  /**
   * How far the object falls before it lands, in px at stage scale 1 (from above the top of the screen down to the
   * struck portrait). Only the visible drop's length reads it; the landing beat does not move with it.
   */
  fallPx?: number;
  reduced?: boolean;
}

export interface AnvilPlan {
  reduced: boolean;
  /** The SHARED tier (1..4), from `attackTier` (a knockout is 4). */
  tier: TierNum;
  /** This Rare's visual tier. */
  level: AnvilLevel;
  /** What falls: the anvil (small) or the piano (big). */
  object: 'anvil' | 'piano';
  /** 0..1 across the shared tiers (the damage formation's pop reads it). */
  k: number;
  total: number;
  chargeAt: number;
  absorbEnd: number;
  /** The shadow appears on the struck portrait and the whistle starts. */
  shadowAt: number;
  /** The object comes into view above the screen. */
  dropAt: number;
  /** The whole fall (the shadow growing) and the visible drop at its end. */
  fallMs: number;
  dropMs: number;
  /** THE landing: the blow. */
  impactAt: number;
  /** Flat under the weight until the pop. */
  holdMs: number;
  /** The object tips off and the portrait springs back. */
  popAt: number;
  endAt: number;
  /** The object's width in portrait radii; the shadow's radius in portrait radii. */
  size: number;
  shadow: number;
  /** The flattened portrait's height (1 = untouched) and how far it spreads sideways. */
  flat: number;
  bulge: number;
  dust: number;
  keys: number;
  shakePx: number;
  zoom: number;
  punch: number;
  dim: number;
}

/** The whole drop, in base ms. Pure and deterministic. */
export function anvilPlan(input: AnvilPlanInput, c: HeroAnvilConfig = store.get()): AnvilPlan {
  const total = Math.max(0, Math.round(input.total));
  const tier = attackTier(total, input, c); // a knockout always plays the shared Tier IV (heroAttack/tiers.ts)
  const level = anvilLevel(tier);
  const object = level === 'big' ? 'piano' : 'anvil';
  const L = anvilLevelDials(level, c);
  const k = (tier - 1) / 3;
  if (input.reduced) {
    const r = reducedAttackTimeline(input.leadIn ?? 0, c.reducedFadeMs);
    const at = r.impactAt;
    return {
      reduced: true, tier, level, object, k, total, chargeAt: at, absorbEnd: at, shadowAt: at, dropAt: at, fallMs: 0, dropMs: 0,
      impactAt: at, holdMs: 0, popAt: at, endAt: r.endAt, size: 0, shadow: 0, flat: 1, bulge: 0, dust: 0, keys: 0, shakePx: 0, zoom: 0, punch: 0, dim: 0,
    };
  }
  const chargeAt = Math.max(0, input.leadIn ?? 0);
  const absorbEnd = chargeAt + c.absorbMs;
  const shadowAt = chargeAt + Math.max(L.ReadyMs, c.absorbMs);
  const fallMs = Math.round(L.FallMs);
  const dropMs = Math.min(fallMs, anvilDropMs(input.fallPx ?? ANVIL_REF_FALL, L.DropMs));
  const impactAt = shadowAt + fallMs;
  const holdMs = Math.round(L.HoldMs);
  const popAt = impactAt + holdMs;
  // The tipped object and the keys drain after the end: the fight never waits on something falling off screen.
  const endAt = popAt + Math.round(L.SettleMs);
  return {
    reduced: false, tier, level, object, k, total, chargeAt, absorbEnd, shadowAt, dropAt: impactAt - dropMs, fallMs, dropMs, impactAt,
    holdMs, popAt, endAt, size: L.Size, shadow: L.Shadow, flat: clamp(L.Flat, 0.1, 0.9), bulge: L.Bulge,
    dust: Math.round(clamp(L.Dust, 0, ANVIL_CAPS.dust)), keys: object === 'piano' ? Math.round(clamp(L.Keys, 0, ANVIL_CAPS.keys)) : 0,
    shakePx: clamp(L.Shake, 0, ANVIL_CAPS.shakePx), zoom: clamp(L.Zoom, 0, ANVIL_CAPS.zoom), punch: L.Punch, dim: L.Dim,
  };
}

export type AnvilCueKind = 'charge' | 'shadow' | 'drop' | 'impact' | 'pop' | 'end';
export interface AnvilCue { at: number; kind: AnvilCueKind; i: number }

/** Every beat the runner fires, in time order. */
export function anvilCues(p: AnvilPlan): AnvilCue[] {
  const out: AnvilCue[] = [];
  if (!p.reduced) {
    out.push({ at: p.chargeAt, kind: 'charge', i: 0 });
    out.push({ at: p.shadowAt, kind: 'shadow', i: 0 });
    out.push({ at: p.dropAt, kind: 'drop', i: 0 });
  }
  out.push({ at: p.impactAt, kind: 'impact', i: 0 });
  if (!p.reduced) out.push({ at: p.popAt, kind: 'pop', i: 0 });
  out.push({ at: p.endAt, kind: 'end', i: 0 });
  const order: Record<AnvilCueKind, number> = { charge: 0, shadow: 1, drop: 2, impact: 3, pop: 4, end: 5 };
  return out.sort((a, b) => a.at - b.at || order[a.kind] - order[b.kind]);
}

// ─── the squash (pure) ─────────────────────────────────────────────────────────────────────────────────────────

/** Under this much of a deviation the portrait is drawn at rest (so it settles EXACTLY, never a hair off). */
export const ANVIL_REST_EPS = 0.004;

/** The pressed-flat height `ms` after the landing: slammed down in a couple of frames, with a small wobble under the weight. */
function pressedAt(flat: number, ms: number): number {
  const u = Math.max(0, ms);
  return flat + (1 - flat) * Math.exp(-u / 16) + flat * 0.3 * Math.exp(-u / 70) * Math.sin(2 * Math.PI * 8 * (u / 1000));
}

/**
 * The struck portrait's scale at sequence time `t`: 1 until the landing; pressed flat (height `flat`, spread sideways)
 * through the hold; then a damped spring back through 1 (tall, short, tall: the accordion), settling on exactly 1.
 * `sy` is the height and `sx` the width; the runner pins the portrait's BOTTOM edge, so it flattens onto the ground
 * line and stretches up from it. Pure.
 */
export function anvilSquashAt(p: AnvilPlan, c: HeroAnvilConfig, t: number): { sx: number; sy: number } {
  if (p.reduced || t < p.impactAt) return { sx: 1, sy: 1 };
  let sy: number;
  if (t < p.popAt) sy = pressedAt(p.flat, t - p.impactAt);
  else {
    const v = t - p.popAt;
    const from = pressedAt(p.flat, p.holdMs);
    const env = Math.exp(-v / Math.max(1, c.popTauMs));
    sy = 1 + (from - 1) * env * Math.cos(2 * Math.PI * c.popHz * (v / 1000));
    if (Math.abs(from - 1) * env < ANVIL_REST_EPS) return { sx: 1, sy: 1 };
  }
  const sx = sy < 1 ? 1 + (1 - sy) * p.bulge : 1 - (sy - 1) * 0.5;
  return { sx, sy };
}

/**
 * Where the top of the pressed portrait is (the object rests on it), as an offset in radii DOWN from the portrait's
 * centre: the bottom edge is pinned at +1, so the top is `1 - 2 * sy`, drawn a touch inside the frame.
 */
export function anvilRestOffset(sy: number): number { return 1 - 1.84 * sy; }

// ─── the camera (pure) ─────────────────────────────────────────────────────────────────────────────────────────

const springAt = (ms: number, hz: number, tau: number): number => (ms < 0 ? 0 : Math.exp(-ms / tau) * Math.cos(2 * Math.PI * hz * (ms / 1000)));
const sine = (u: number): number => 0.5 - 0.5 * Math.cos(Math.PI * Math.min(1, Math.max(0, u)));

/**
 * The camera at sequence time `t`: a small push in through the cue and the fall, a punch and a straight DOWN shake on
 * the landing, held in a touch through the hold, easing back from the pop. Deterministic. Pure.
 */
export function anvilCameraAt(p: AnvilPlan, c: HeroAnvilConfig, t: number): { zoom: number; x: number; y: number } {
  if (p.reduced) return { zoom: 1, x: 0, y: 0 };
  let z = 0;
  if (t >= p.chargeAt && t < p.impactAt) z = p.zoom * sine((t - p.chargeAt) / Math.max(1, p.impactAt - p.chargeAt));
  else if (t >= p.impactAt) {
    const rest = t < p.popAt ? p.zoom : p.zoom * Math.exp(-(t - p.popAt) / Math.max(1, c.zoomOutMs / 4));
    z = rest + p.punch * Math.exp(-(t - p.impactAt) / Math.max(1, c.zoomOutMs / 4));
  }
  // The landing drives the view straight down and it rings back; the pop is a small kick up.
  const y = p.shakePx * springAt(t - p.impactAt, 15, Math.max(1, c.shakeMs / 4)) - p.shakePx * 0.25 * springAt(t - p.popAt, 14, 50);
  return { zoom: 1 + Math.max(0, z), x: 0, y };
}

/** Where the camera anchors: the striking hero at the cue, easing across to the struck hero, who holds it from the shadow on. */
export function anvilCameraFocus(p: AnvilPlan, t: number, a: Pt, d: Pt): Pt {
  if (t <= p.chargeAt) return a;
  if (t >= p.shadowAt) return d;
  const e = sine((t - p.chargeAt) / Math.max(1, p.shadowAt - p.chargeAt));
  return { x: a.x + (d.x - a.x) * e, y: a.y + (d.y - a.y) * e };
}
