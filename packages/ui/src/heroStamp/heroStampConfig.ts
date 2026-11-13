/**
 * PAID IN FULL, THE RUBBER STAMP HERO ATTACK (a RARE): its tuned values, its pure timeline, the stamp's pure track and
 * pose, and the pure camera.
 *
 * ONE CLEAR IDEA: a chunky wooden-handled office RUBBER STAMP rises out of the striking hero, arcs over, and THUNKS
 * down flat on the struck portrait, leaving a wet ink mark on it (a bold round seal: a ring with a star inside, a skull
 * on a knockout; no words). No other attack stamps its target or leaves a mark on it.
 *
 * TWO VISUAL TIERS (a Rare has two, not four). The shared four map onto them here (`stampLevel`): I-II play SMALL,
 * III-IV play BIG, so a knockout (which always forces the shared Tier IV) plays BIG.
 *  - SMALL: the stamp rises, arcs over and thunks ONCE (THE impact): the portrait squashes, a puff of dust and a few
 *    drops of ink, the stamp lifts away and the mark is left, slightly crooked, glossy, then drying and fading.
 *  - BIG: an ink pad pops up beside the striking hero and the stamp taps it first (a little splat), then it stamps the
 *    target THREE times fast (thunk thunk THUNK), each mark crooked at a different angle over the last; the third is
 *    wound up higher and lands hardest (a bigger squash, a splat, flying droplets) and is THE impact.
 *
 * THE BEATS (base ms before the playback speed): the shared damage formation (its end is this style's start); READY
 * (the total sinks into the hero, who dips back while the stamp rises out of it; big: the pad tap); LAUNCH (the stamp
 * swings over on a low arc, its handle trailing); THUNK (a short accelerating slam down its own axis, a press, a lift;
 * every thunk before the last is a tick, FX and sound only); THE IMPACT (the consequence lands ONCE, on the last thunk).
 * No hit-stop anywhere. Reduced motion: no stamp, no shake, no zoom; the numbers fade and the blow lands.
 *
 * THE AXIS: the stamp is drawn handle up and comes straight down when the struck portrait has headroom. A portrait
 * near the top of the screen has none, so the stamp's axis leans back toward the striking hero by exactly as much as
 * it takes to keep the handle on screen (`fitAxis`), and the slam, the squash and the shake all follow that axis. At
 * the striking hero it always stands upright (a hero near the top brings it out lower, in front of the portrait).
 *
 * Tuner convention (the Blast's): localStorage in DEV only, values clamped on write and on load; production always
 * plays DEFAULTS.
 */
import { configStore } from '../heroAttack/configStore';
import { clamp, clamp01, easeOutBack, easeOutCubic, seededRng, type Pt } from '../heroAttack/easing';
import {
  HERO_ATTACK_TIER_THRESHOLDS, reducedAttackTimeline, attackTier, type AttackTierContext, type TierNum,
} from '../heroAttack/tiers';

export type { TierNum };

/** The two visual tiers of a Rare. */
export const STAMP_LEVELS = ['small', 'big'] as const;
export type StampLevel = (typeof STAMP_LEVELS)[number];

/** The shared four tiers onto this Rare's two: I-II small, III-IV big (a knockout forces IV, so it plays big). */
export function stampLevel(tier: TierNum): StampLevel { return tier >= 3 ? 'big' : 'small'; }

/** The per-level dials. A config key is `small` / `big` + one of these. */
export const STAMP_LEVEL_SUFFIXES = [
  'ReadyMs', 'FlightMs', 'Arc', 'Stamps', 'HopMs', 'LastHoldMs', 'StampSize', 'Droplets',
  'Shake', 'Zoom', 'Punch', 'MarkHoldMs', 'Dim',
] as const;
export type StampLevelSuffix = (typeof STAMP_LEVEL_SUFFIXES)[number];
type LevelKey = `${StampLevel}${StampLevelSuffix}`;

interface GlobalConfig {
  tier2At: number; tier3At: number; tier4At: number;
  absorbMs: number;
  heroDipPx: number;
  heroPushPx: number;
  /** The stamp's base width, in struck-portrait radii. */
  stampSize: number;
  slamMs: number;
  pressMs: number;
  /** How far above the portrait the stamp hovers before a slam, in radii. */
  hoverLift: number;
  /** Big: the last stamp winds up this much higher. */
  lastLift: number;
  awayMs: number;
  /** The mark's diameter, in stamp base widths. */
  markSize: number;
  /** The most a mark sits crooked, radians. */
  markTilt: number;
  markFadeMs: number;
  /** The ink pad's width, in striking-portrait radii. */
  padSize: number;
  knockPx: number;
  squash: number;
  shakeMs: number;
  zoomOutMs: number;
  reducedFadeMs: number;
  colorInk: string;
  colorInkDeep: string;
  colorShine: string;
  colorDust: string;
  colorPlayer: string;
  colorFoe: string;
  sfxWhooshClip: string; sfxWhooshGain: number; sfxWhooshRate: number;
  sfxThunkClip: string; sfxThunkGain: number; sfxThunkRate: number;
  sfxPadClip: string; sfxPadGain: number; sfxPadRate: number;
  sfxDuck: number;
  previewDamage: number;
  previewParts: number;
}
export type HeroStampConfig = GlobalConfig & Record<LevelKey, number>;

export const HERO_STAMP_COLOR_KEYS = ['colorInk', 'colorInkDeep', 'colorShine', 'colorDust', 'colorPlayer', 'colorFoe'] as const;
export const HERO_STAMP_CLIP_KEYS = ['sfxWhooshClip', 'sfxThunkClip', 'sfxPadClip'] as const;
export type HeroStampStrKey = (typeof HERO_STAMP_COLOR_KEYS)[number] | (typeof HERO_STAMP_CLIP_KEYS)[number];
export type HeroStampNumKey = Exclude<keyof HeroStampConfig, HeroStampStrKey>;

/** Small, big per suffix. */
const LEVEL_DEFAULTS: Record<StampLevelSuffix, [number, number]> = {
  ReadyMs: [300, 540],
  FlightMs: [380, 360],
  Arc: [0.1, 0.1],
  Stamps: [1, 3],
  HopMs: [200, 190],
  LastHoldMs: [0, 80],
  StampSize: [1, 1.08],
  Droplets: [5, 14],
  Shake: [5, 9],
  Zoom: [0.02, 0.035],
  Punch: [0.015, 0.03],
  MarkHoldMs: [420, 480],
  Dim: [0.08, 0.2],
};

export const STAMP_LEVEL_RANGES: Record<StampLevelSuffix, [number, number, number]> = {
  ReadyMs: [120, 1400, 10],
  FlightMs: [150, 1200, 10],
  Arc: [0, 0.4, 0.01],
  Stamps: [1, 5, 1],
  HopMs: [140, 600, 10],
  LastHoldMs: [0, 400, 10],
  StampSize: [0.5, 2, 0.02],
  Droplets: [0, 24, 1],
  Shake: [0, 30, 0.5],
  Zoom: [0, 0.1, 0.002],
  Punch: [0, 0.08, 0.001],
  MarkHoldMs: [100, 1500, 10],
  Dim: [0, 0.6, 0.01],
};

const levelDefaults = Object.fromEntries(STAMP_LEVELS.flatMap((l, i) => STAMP_LEVEL_SUFFIXES.map((s) => [`${l}${s}`, LEVEL_DEFAULTS[s][i]]))) as Record<LevelKey, number>;

export const HERO_STAMP_DEFAULTS: HeroStampConfig = {
  ...HERO_ATTACK_TIER_THRESHOLDS,
  absorbMs: 180,
  heroDipPx: 8,
  heroPushPx: 12,
  stampSize: 1.08,
  slamMs: 70,
  pressMs: 60,
  hoverLift: 0.7,
  lastLift: 1.5,
  awayMs: 320,
  markSize: 1.12,
  markTilt: 0.36,
  markFadeMs: 380,
  padSize: 1.3,
  knockPx: 10,
  squash: 0.1,
  shakeMs: 280,
  zoomOutMs: 340,
  reducedFadeMs: 260,
  colorInk: '#e0203c',
  colorInkDeep: '#8a0f26',
  colorShine: '#ffd9de',
  colorDust: '#efe6d6',
  colorPlayer: '#ffd76a',
  colorFoe: '#ff6a4d',
  sfxWhooshClip: 'fx/stereogenicstudio-swish-swoosh-woosh-sfx-27-357164-3', sfxWhooshGain: 0.3, sfxWhooshRate: 1.5,
  sfxThunkClip: 'fx/stamp-thunk', sfxThunkGain: 0.8, sfxThunkRate: 1,
  sfxPadClip: 'fx/stamp-pad', sfxPadGain: 0.6, sfxPadRate: 1,
  sfxDuck: 0.6,
  previewDamage: 12,
  previewParts: 4,
  ...levelDefaults,
};

const GLOBAL_RANGES: Record<Exclude<keyof GlobalConfig, HeroStampStrKey>, [number, number, number]> = {
  tier2At: [2, 40, 1], tier3At: [2, 60, 1], tier4At: [2, 80, 1],
  absorbMs: [60, 600, 10],
  heroDipPx: [0, 40, 1],
  heroPushPx: [0, 50, 1],
  stampSize: [0.4, 2, 0.02],
  slamMs: [30, 200, 5],
  pressMs: [20, 200, 5],
  hoverLift: [0.2, 2, 0.05],
  lastLift: [1, 3, 0.05],
  awayMs: [100, 1000, 10],
  markSize: [0.5, 2, 0.02],
  markTilt: [0, 0.8, 0.01],
  markFadeMs: [80, 1500, 10],
  padSize: [0.6, 2.5, 0.05],
  knockPx: [0, 60, 1],
  squash: [0, 0.3, 0.01],
  shakeMs: [0, 1200, 10],
  zoomOutMs: [60, 1500, 10],
  reducedFadeMs: [60, 1000, 10],
  sfxWhooshGain: [0, 2, 0.05], sfxWhooshRate: [0.5, 2.5, 0.01],
  sfxThunkGain: [0, 2, 0.05], sfxThunkRate: [0.5, 2.5, 0.01],
  sfxPadGain: [0, 2, 0.05], sfxPadRate: [0.5, 2.5, 0.01],
  sfxDuck: [0, 1, 0.05],
  previewDamage: [1, 60, 1],
  previewParts: [1, 8, 1],
};

/** [min, max, step] per numeric key. Values outside are clamped on write AND on load. */
export const HERO_STAMP_RANGES: Record<HeroStampNumKey, [number, number, number]> = {
  ...GLOBAL_RANGES,
  ...(Object.fromEntries(STAMP_LEVELS.flatMap((l) => STAMP_LEVEL_SUFFIXES.map((s) => [`${l}${s}`, STAMP_LEVEL_RANGES[s]]))) as Record<LevelKey, [number, number, number]>),
};

/** The hard ceilings a plan never exceeds, whatever the sliders say. */
export const STAMP_CAPS = { stamps: 5, droplets: 24, shakePx: 30, zoom: 0.1 } as const;

const store = configStore<HeroStampConfig>({
  key: 'ascent.herostamp.v1', defaults: HERO_STAMP_DEFAULTS, ranges: HERO_STAMP_RANGES,
  colorKeys: HERO_STAMP_COLOR_KEYS, clipKeys: HERO_STAMP_CLIP_KEYS, previewKeys: ['previewDamage', 'previewParts'],
});
/** The store itself (the tuner reads and writes through it). */
export const heroStampStore = store;
export const getHeroStampConfig = store.get;
export const clampHeroStampValue = store.clamp;
export const sanitizeHeroStampConfig = store.sanitize;
export const setHeroStampValue = store.set;
export const resetHeroStampConfig = store.reset;
export const heroStampConfigJson = store.json;
/** The tuners' preview speed hook (Recruit + the Collection read one per style). Always 1: the Rare tuners have none. */
export function heroStampPreviewSpeed(): number { return 1; }

/** One level's dials, read out of the config. */
export function stampLevelDials(level: StampLevel, c: HeroStampConfig = store.get()): Record<StampLevelSuffix, number> {
  return Object.fromEntries(STAMP_LEVEL_SUFFIXES.map((s) => [s, c[`${level}${s}`]])) as Record<StampLevelSuffix, number>;
}

// ─── the pure plan ─────────────────────────────────────────────────────────────────────────────────────────────

/** The reference distance flight times are tuned at (a 1080p board, corner to corner). */
export const STAMP_REF_DISTANCE = 1600;

/** The flight for a distance: the level's time, scaled gently by the distance (a sandbox box stays readable). */
export function stampFlightMs(distance: number, levelMs: number): number {
  const d = Number.isFinite(distance) && distance > 0 ? distance : STAMP_REF_DISTANCE;
  return Math.round(levelMs * clamp(Math.sqrt(d / STAMP_REF_DISTANCE), 0.62, 1.15));
}

export interface StampPlanInput extends AttackTierContext {
  /** When the style's own attack starts: the end of the shared damage formation. */
  leadIn?: number;
  total: number;
  distance: number;
  reduced?: boolean;
}

export interface StampPlan {
  reduced: boolean;
  /** The SHARED tier (1..4), from `attackTier` (a knockout is 4). */
  tier: TierNum;
  /** This Rare's visual tier. */
  level: StampLevel;
  /** 0..1 across the shared tiers (the damage formation's pop reads it). */
  k: number;
  total: number;
  /** A knockout: the seal carries a skull instead of a star. */
  knockout: boolean;
  chargeAt: number;
  absorbEnd: number;
  /** The stamp has risen out of the hero. */
  riseEnd: number;
  /** Big: the tap on the ink pad (null when there is no pad). */
  padAt: number | null;
  /** The stamp leaves for the target. */
  launchAt: number;
  flightMs: number;
  slamMs: number;
  pressMs: number;
  /** Every thunk, in order; the last is THE impact. */
  thunks: number[];
  /** The thunks BEFORE the impact (ticks: FX and sound only). */
  hits: number[];
  impactAt: number;
  awayMs: number;
  /** The marks start to fade, and how long the fade takes. */
  markFadeAt: number;
  markFadeMs: number;
  endAt: number;
  size: number;
  droplets: number;
  shakePx: number;
  zoom: number;
  punch: number;
  dim: number;
}

/** The whole attack, in base ms. Pure and deterministic. */
export function stampPlan(input: StampPlanInput, c: HeroStampConfig = store.get()): StampPlan {
  const total = Math.max(0, Math.round(input.total));
  const tier = attackTier(total, input, c); // a knockout always plays the shared Tier IV (heroAttack/tiers.ts)
  const level = stampLevel(tier);
  const L = stampLevelDials(level, c);
  const k = (tier - 1) / 3;
  const knockout = !!input.knockout;
  if (input.reduced) {
    const r = reducedAttackTimeline(input.leadIn ?? 0, c.reducedFadeMs);
    const at = r.impactAt;
    return {
      reduced: true, tier, level, k, total, knockout, chargeAt: at, absorbEnd: at, riseEnd: at, padAt: null, launchAt: at, flightMs: 0,
      slamMs: 0, pressMs: 0, thunks: [at], hits: [], impactAt: at, awayMs: 0, markFadeAt: at, markFadeMs: 0, endAt: r.endAt,
      size: 0, droplets: 0, shakePx: 0, zoom: 0, punch: 0, dim: 0,
    };
  }
  const chargeAt = Math.max(0, input.leadIn ?? 0);
  const absorbEnd = chargeAt + c.absorbMs;
  const ready = Math.max(L.ReadyMs, c.absorbMs);
  const launchAt = chargeAt + ready;
  const riseEnd = chargeAt + Math.min(200, ready * 0.5);
  const padAt = level === 'big' ? chargeAt + Math.round(ready * 0.6) : null;
  const flightMs = stampFlightMs(input.distance, L.FlightMs);
  const n = clamp(Math.round(L.Stamps), 1, STAMP_CAPS.stamps);
  const slamMs = Math.round(c.slamMs), pressMs = Math.round(c.pressMs);
  // A hop is a press, a lift and a slam: it can never be shorter than the press and the slam it contains.
  const hopMs = Math.max(Math.round(L.HopMs), slamMs + pressMs + 40);
  const first = launchAt + flightMs + slamMs;
  const thunks = Array.from({ length: n }, (_, i) => first + i * hopMs + (n > 1 && i === n - 1 ? Math.round(L.LastHoldMs) : 0));
  const impactAt = thunks[n - 1]!;
  const markFadeAt = impactAt + L.MarkHoldMs;
  // The marks finish fading just after the end: the fight never waits on drying ink.
  const endAt = Math.round(markFadeAt + c.markFadeMs * 0.5);
  return {
    reduced: false, tier, level, k, total, knockout, chargeAt, absorbEnd, riseEnd, padAt, launchAt, flightMs, slamMs, pressMs, thunks,
    hits: thunks.slice(0, -1), impactAt, awayMs: c.awayMs, markFadeAt, markFadeMs: c.markFadeMs, endAt,
    size: L.StampSize, droplets: Math.round(clamp(L.Droplets, 0, STAMP_CAPS.droplets)),
    shakePx: clamp(L.Shake, 0, STAMP_CAPS.shakePx), zoom: clamp(L.Zoom, 0, STAMP_CAPS.zoom), punch: L.Punch, dim: L.Dim,
  };
}

export type StampCueKind = 'charge' | 'pad' | 'launch' | 'hit' | 'impact' | 'end';
export interface StampCue { at: number; kind: StampCueKind; i: number }

/** Every beat the runner fires, in time order (a tick precedes the impact on a tie). */
export function stampCues(p: StampPlan): StampCue[] {
  const out: StampCue[] = [];
  if (!p.reduced) {
    out.push({ at: p.chargeAt, kind: 'charge', i: 0 });
    if (p.padAt !== null) out.push({ at: p.padAt, kind: 'pad', i: 0 });
    out.push({ at: p.launchAt, kind: 'launch', i: 0 });
    p.hits.forEach((at, i) => out.push({ at, kind: 'hit', i }));
  }
  out.push({ at: p.impactAt, kind: 'impact', i: p.thunks.length - 1 });
  out.push({ at: p.endAt, kind: 'end', i: 0 });
  const order: Record<StampCueKind, number> = { charge: 0, pad: 1, launch: 2, hit: 3, impact: 4, end: 5 };
  return out.sort((a, b) => a.at - b.at || order[a.kind] - order[b.kind]);
}

// ─── the stamp's track (pure) ──────────────────────────────────────────────────────────────────────────────────

/** The stamp texture's proportions: its height over its base width (the textures paint to it, the track fits to it). */
export const STAMP_ASPECT = 1.5;
/** The steepest the stamp ever leans to stay on screen (radians from upright). */
export const STAMP_MAX_LEAN = 1.3;

/**
 * The stamp's axis at `base`: straight up when `reach` px of headroom fit under `ceilY`; else leaned toward `toward`
 * (the sign of x) by exactly as much as keeps its top at the ceiling, never past `STAMP_MAX_LEAN`. Unit, base to handle.
 */
export function fitAxis(base: Pt, reach: number, ceilY: number, toward: number): Pt {
  const room = base.y - ceilY;
  if (!(reach > 0) || room >= reach) return { x: 0, y: -1 };
  const th = Math.min(STAMP_MAX_LEAN, Math.acos(clamp(room / reach, 0, 1)));
  return { x: Math.sin(th) * (toward < 0 ? -1 : 1), y: -Math.cos(th) };
}

export interface StampGeo {
  /** Centres of the striking and the struck portrait. */
  a: Pt; d: Pt;
  radius: number; aRadius: number;
  /** Nothing is drawn above this y. */
  ceilY: number;
  /** The seed the marks' crookedness is rolled from (the same fight stamps the same). */
  seed: number;
  /** Where the big `-N` pops (the last mark is nudged away from it so the two do not sit on each other). */
  avoid?: Pt | null;
}

export interface StampTrack {
  /** The stamp's base width and height, px. */
  w: number; h: number;
  /** Its axis (unit, base to handle) at the striking and at the struck hero, and the sprite rotations they give. */
  upA: Pt; upD: Pt; rotA: number; rotD: number;
  /** The sign of x toward the struck hero. */
  dirX: number;
  origin: Pt; hold: Pt;
  /** Big: the centre of the ink pad's felt, and the pad's width, px. */
  pad: Pt | null; padW: number;
  launch: Pt; ctrl: Pt;
  /** Where each thunk lands on the struck portrait, where the stamp hovers before it, and each mark's angle and size. */
  contacts: Pt[]; hovers: Pt[]; tilts: number[]; sizes: number[];
  away: Pt;
}

const EMPTY_TRACK: StampTrack = {
  w: 0, h: 0, upA: { x: 0, y: -1 }, upD: { x: 0, y: -1 }, rotA: 0, rotD: 0, dirX: 1, origin: { x: 0, y: 0 }, hold: { x: 0, y: 0 },
  pad: null, padW: 0, launch: { x: 0, y: 0 }, ctrl: { x: 0, y: 0 }, contacts: [], hovers: [], tilts: [], sizes: [], away: { x: 0, y: 0 },
};

/**
 * Everything the stamp's path needs, from the plan and the two heroes: sized off the struck portrait, its axis fitted
 * under the ceiling at both ends, the pad beside the striking hero (big), every contact on the struck face and every
 * mark's crooked angle (alternating sides, rolled from the seed). Pure, so a replay stamps the same.
 */
export function stampTrack(p: StampPlan, g: StampGeo, c: HeroStampConfig = store.get()): StampTrack {
  if (p.reduced) return EMPTY_TRACK;
  const R = Math.max(1, g.radius), aR = Math.max(1, g.aRadius);
  const w = c.stampSize * p.size * R, h = w * STAMP_ASPECT;
  const dirX = g.d.x - g.a.x < 0 ? -1 : 1;
  const n = p.thunks.length;
  const lift = c.hoverLift * R;
  const lastLift = n > 1 ? lift * c.lastLift : lift;
  // At the struck hero the handle leans back toward the striking one when there is no headroom. At the striking hero
  // the stamp always stands upright: with no headroom it simply comes out lower, in front of the portrait.
  const upD = fitAxis(g.d, Math.max(lift, lastLift) + h + 0.2 * R, g.ceilY, -dirX);
  const upA = { x: 0, y: -1 };
  const rotOf = (u: Pt): number => Math.atan2(u.x, -u.y);
  const hold = { x: g.a.x, y: Math.max(g.a.y - aR * 0.3, g.ceilY + h) };
  const origin = { x: g.a.x, y: Math.min(hold.y, g.a.y + aR * 0.2) };
  const padW = c.padSize * aR;
  const padLift = aR * 0.35;
  const pad = p.padAt !== null
    ? { x: g.a.x + dirX * (aR * 0.95 + padW * 0.55), y: Math.max(g.a.y + aR * 0.3, g.ceilY + h + padLift) }
    : null;
  const wind = aR * 0.14;
  const from = pad ? { x: pad.x, y: pad.y - padLift } : hold;
  const launch = { x: from.x - dirX * wind, y: from.y };
  const rnd = seededRng(g.seed);
  const s0 = rnd() < 0.5 ? -1 : 1;
  const contacts: Pt[] = [], hovers: Pt[] = [], tilts: number[] = [], sizes: number[] = [];
  // The seal sits a little to the side of the face away from the big -N.
  const clear = { x: 0, y: 0 };
  if (g.avoid) {
    const ax = g.d.x - g.avoid.x, ay = g.d.y - g.avoid.y;
    const al = Math.hypot(ax, ay);
    if (al > 1) { clear.x = (ax / al) * 0.2; clear.y = (ay / al) * 0.2; }
  }
  for (let i = 0; i < n; i++) {
    const last = i === n - 1;
    // Crooked: each mark leans the other way from the one before; the last sits nearest straight (it is the seal).
    const mag = n === 1 ? 0.4 + 0.5 * rnd() : last ? 0.12 + 0.3 * rnd() : 0.55 + 0.45 * rnd();
    tilts.push(s0 * (i % 2 ? -1 : 1) * mag * c.markTilt);
    // The earlier marks land a little off centre, either side; the last lands square on the face.
    const off = last ? { x: (rnd() - 0.5) * 0.06, y: 0.02 } : { x: s0 * (i % 2 ? 1 : -1) * (0.13 + 0.05 * rnd()), y: (rnd() - 0.5) * 0.12 - 0.02 };
    const at = { x: g.d.x + (off.x + clear.x) * R, y: g.d.y + (off.y + clear.y) * R };
    const up = last && n > 1 ? lastLift : lift;
    contacts.push(at);
    hovers.push({ x: at.x + upD.x * up, y: at.y + upD.y * up });
    sizes.push(n > 1 && !last ? 0.9 : n > 1 ? 1.1 : 1);
  }
  const first = hovers[0]!;
  const D = Math.hypot(first.x - launch.x, first.y - launch.y) || 1;
  const mid = { x: (launch.x + first.x) / 2, y: (launch.y + first.y) / 2 };
  // The arc bows toward the top of the screen, never so high the handle would leave it.
  const ctrl = { x: mid.x, y: Math.min(mid.y, Math.max(g.ceilY + h * 0.8, mid.y - c[`${p.level}Arc`] * D)) };
  const end = contacts[n - 1]!;
  const away = { x: end.x + upD.x * lift * 1.1 - dirX * R * 0.5, y: end.y + upD.y * lift * 1.1 };
  return { w, h, upA, upD, rotA: rotOf(upA), rotD: rotOf(upD), dirX, origin, hold, pad, padW, launch, ctrl, contacts, hovers, tilts, sizes, away };
}

/** How much of a mark's crookedness the stamp's own body shows as it lands it. */
const BODY_TILT = 0.45;

export interface StampPose {
  x: number; y: number; rot: number; sx: number; sy: number; alpha: number;
  /** The thunk it is heading for or pressing (-1 before the flight). */
  target: number;
}

export function newStampPose(): StampPose { return { x: 0, y: 0, rot: 0, sx: 1, sy: 1, alpha: 0, target: -1 }; }

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const smooth = (u: number): number => { const t = clamp01(u); return t * t * (3 - 2 * t); };

/**
 * Where the stamp's rubber face is at sequence time `t`, how it is turned, squashed and how visible it is. Written into
 * `out` (no allocation per frame). Pure: the same plan, track and time give the same pose.
 */
export function stampPose(p: StampPlan, tr: StampTrack, t: number, out: StampPose = newStampPose()): StampPose {
  out.sx = 1; out.sy = 1; out.alpha = 1; out.target = -1; out.rot = tr.rotA; out.x = tr.origin.x; out.y = tr.origin.y;
  const n = tr.contacts.length;
  if (p.reduced || n === 0 || t < p.chargeAt) { out.alpha = 0; return out; }
  const lean = -tr.dirX; // travelling toward the foe, the handle trails
  if (t < p.riseEnd) {
    // RISE: out of the hero, with a little overshoot.
    const u = (t - p.chargeAt) / Math.max(1, p.riseEnd - p.chargeAt);
    const e = easeOutBack(u, 1.6);
    out.x = lerp(tr.origin.x, tr.hold.x, e); out.y = lerp(tr.origin.y, tr.hold.y, e);
    out.sx = out.sy = Math.max(0.05, 0.3 + 0.7 * e);
    out.alpha = clamp01(u * 3);
    return out;
  }
  if (t < p.launchAt) {
    if (tr.pad && p.padAt !== null) {
      if (t < p.padAt) {
        // The hop onto the ink pad: up a touch, then down onto it, faster and faster.
        const u = (t - p.riseEnd) / Math.max(1, p.padAt - p.riseEnd);
        const e = 0.35 * u + 0.65 * u * u;
        const hopY = -Math.sin(Math.PI * u) * tr.h * 0.12;
        out.x = lerp(tr.hold.x, tr.pad.x, e); out.y = lerp(tr.hold.y, tr.pad.y, e) + hopY;
        out.sy = 1 + 0.08 * u * u;
        return out;
      }
      const since = t - p.padAt;
      const q = 0.2 * Math.exp(-since / 70);
      out.sx = 1 + q * 0.5; out.sy = 1 - q;
      if (since < p.pressMs) { out.x = tr.pad.x; out.y = tr.pad.y; return out; }
      // Lifts off the pad, winding back for the swing.
      const u = (since - p.pressMs) / Math.max(1, p.launchAt - p.padAt - p.pressMs);
      const e = easeOutCubic(u);
      out.x = lerp(tr.pad.x, tr.launch.x, e); out.y = lerp(tr.pad.y, tr.launch.y, e);
      out.rot = tr.rotA - lean * 0.2 * e;
      return out;
    }
    // Small: a short wind back before the swing.
    const u = smooth((t - p.riseEnd) / Math.max(1, p.launchAt - p.riseEnd));
    out.x = lerp(tr.hold.x, tr.launch.x, u); out.y = lerp(tr.hold.y, tr.launch.y, u);
    out.rot = tr.rotA - lean * 0.2 * u;
    return out;
  }
  const firstHover = p.thunks[0]! - p.slamMs;
  if (t < firstHover) {
    // THE SWING: a low arc over to the hover above the first mark, the handle trailing, a little nearer mid-arc.
    const u = (t - p.launchAt) / Math.max(1, firstHover - p.launchAt);
    const e = smooth(u), m = 1 - e;
    const b = tr.hovers[0]!;
    out.x = m * m * tr.launch.x + 2 * m * e * tr.ctrl.x + e * e * b.x;
    out.y = m * m * tr.launch.y + 2 * m * e * tr.ctrl.y + e * e * b.y;
    const swing = Math.sin(Math.PI * u);
    out.rot = lerp(tr.rotA - lean * 0.2, tr.rotD + tr.tilts[0]! * BODY_TILT, e) + lean * 0.42 * swing;
    out.sx = out.sy = 1 + 0.12 * swing;
    out.target = 0;
    return out;
  }
  // Which thunk: the first whose press has not ended yet.
  let i = n - 1;
  for (let j = 0; j < n; j++) { if (t < p.thunks[j]! + p.pressMs) { i = j; break; } }
  const at = p.thunks[i]!;
  const hit = tr.contacts[i]!;
  out.target = i;
  out.rot = tr.rotD + tr.tilts[i]! * BODY_TILT;
  if (t < at) {
    const liftStart = i > 0 ? p.thunks[i - 1]! + p.pressMs : firstHover;
    const slamAt = at - p.slamMs;
    if (t < slamAt && i > 0) {
      // THE LIFT off the last mark, over to the hover above the next (still ringing from the thunk before).
      const u = (t - liftStart) / Math.max(1, slamAt - liftStart);
      const e = easeOutCubic(u);
      const from = tr.contacts[i - 1]!, to = tr.hovers[i]!;
      out.x = lerp(from.x, to.x, e); out.y = lerp(from.y, to.y, e);
      out.rot = tr.rotD + lerp(tr.tilts[i - 1]!, tr.tilts[i]!, e) * BODY_TILT;
      const q = 0.18 * Math.exp(-(t - p.thunks[i - 1]!) / 70);
      out.sx = 1 + q * 0.5; out.sy = 1 - q;
      return out;
    }
    // THE SLAM: straight down its own axis, faster and faster, stretched by the speed.
    const u = clamp01((t - slamAt) / Math.max(1, p.slamMs));
    const e = u * u;
    const from = tr.hovers[i]!;
    out.x = lerp(from.x, hit.x, e); out.y = lerp(from.y, hit.y, e);
    out.sy = 1 + 0.1 * u; out.sx = 1 - 0.03 * u;
    return out;
  }
  const since = t - at;
  const hard = i === n - 1 ? 0.28 : 0.18;
  const q = hard * Math.exp(-since / 70);
  out.sx = 1 + q * 0.5; out.sy = 1 - q;
  out.x = hit.x; out.y = hit.y;
  if (i < n - 1 || since < p.pressMs) return out; // THE PRESS
  // AWAY: it lifts off the last mark, drifts back toward its owner and fades.
  const u = (since - p.pressMs) / Math.max(1, p.awayMs);
  if (u >= 1) { out.alpha = 0; return out; }
  const e = easeOutCubic(u);
  out.x = lerp(hit.x, tr.away.x, e); out.y = lerp(hit.y, tr.away.y, e);
  out.rot = tr.rotD + tr.tilts[i]! * BODY_TILT * (1 - e) - lean * 0.12 * e;
  out.sx *= 1 - 0.08 * e; out.sy *= 1 - 0.08 * e;
  out.alpha = 1 - clamp01((u - 0.4) / 0.6);
  return out;
}

/** The whole stamp in view at `t`? Its top (the handle) is the far end: `pose` plus the axis times its height. */
export function stampTop(tr: StampTrack, pose: StampPose): Pt {
  return { x: pose.x + Math.sin(pose.rot) * tr.h * pose.sy, y: pose.y - Math.cos(pose.rot) * tr.h * pose.sy };
}

// ─── the camera and the struck portrait (pure) ─────────────────────────────────────────────────────────────────

const springAt = (ms: number, hz: number, tau: number): number => (ms < 0 ? 0 : Math.exp(-ms / tau) * Math.cos(2 * Math.PI * hz * (ms / 1000)));
const sine = (u: number): number => 0.5 - 0.5 * Math.cos(Math.PI * clamp01(u));

/**
 * The camera at sequence time `t`: a small push in through the ready, a tiny kick down the stamp's axis on each tick,
 * a punch and a directional shake on the impact, settling back. `dir` is the way the stamp presses. Deterministic. Pure.
 */
export function stampCameraAt(p: StampPlan, c: HeroStampConfig, t: number, dir: Pt = { x: 0, y: 1 }): { zoom: number; x: number; y: number } {
  if (p.reduced) return { zoom: 1, x: 0, y: 0 };
  let z = 0;
  if (t >= p.chargeAt && t < p.impactAt) z += p.zoom * sine((t - p.chargeAt) / Math.max(1, p.launchAt - p.chargeAt));
  else if (t >= p.impactAt) z += (p.zoom + p.punch) * Math.exp(-(t - p.impactAt) / Math.max(1, c.zoomOutMs / 4));
  let x = 0, y = 0;
  const kick = (at: number, amp: number, tau: number, hz: number): void => {
    const s = springAt(t - at, hz, tau);
    x += dir.x * amp * s; y += dir.y * amp * s;
  };
  p.hits.forEach((at) => kick(at, p.shakePx * 0.35, 40, 18));
  kick(p.impactAt, p.shakePx, Math.max(1, c.shakeMs / 4), 16);
  return { zoom: 1 + Math.max(0, z), x, y };
}

/** Where the camera anchors: the attacker through the ready, crossing with the stamp, the defender from the first thunk. */
export function stampCameraFocus(p: StampPlan, t: number, a: Pt, d: Pt): Pt {
  const first = p.thunks[0] ?? p.impactAt;
  if (t <= p.launchAt) return a;
  if (t >= first) return d;
  const e = sine((t - p.launchAt) / Math.max(1, first - p.launchAt));
  return { x: a.x + (d.x - a.x) * e, y: a.y + (d.y - a.y) * e };
}

/**
 * How hard the struck portrait is pressed at `t` (0 at rest; about 1 at the impact, about half on a tick): a short
 * damped ring after every thunk. The runner turns it into a push along the stamp's axis and a squash across it. Pure.
 */
export function stampPress(p: StampPlan, t: number): number {
  if (p.reduced) return 0;
  let s = 0;
  const n = p.thunks.length;
  for (let i = 0; i < n; i++) {
    const since = t - p.thunks[i]!;
    if (since < 0) break;
    s += (i === n - 1 ? (p.level === 'big' ? 1.25 : 0.9) : 0.55) * springAt(since, 5, 75);
  }
  return s;
}
