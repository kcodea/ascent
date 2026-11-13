/**
 * THE SUCKER PUNCH HERO ATTACK (style id `glove`, a RARE): its tuned values, its pure timeline, the pure pose of the
 * glove on its spring, and the pure camera. Built 2026-11-12 on the scaffold `npm run attack:new` made from Boomerang.
 *
 * ONE CLEAR IDEA: A BOXING GLOVE ON A SPRING. A little hatch pops open on the edge of the striking portrait and a red
 * boxing glove BOINGS out on a zig-zag coil spring that stays attached to the hero the whole way: it stretches right
 * across the board to the struck portrait, bops it, and retracts with the coil compressing back into the hatch. No other
 * attack is tethered to its hero.
 *
 * TWO VISUAL TIERS (a Rare has two). The shared four map onto them here (`gloveLevel`): I-II play SMALL, III-IV play BIG,
 * so a knockout (which always forces the shared Tier IV) plays BIG.
 *  - SMALL: pop, boing out, ONE bop (THE impact), a little wobble on the end of the spring, and back in.
 *  - BIG: the glove winds back first (the coil squeezes, a quiver), fires harder, bops (a tick) and OVERSHOOTS past the
 *    face, the spring sways side to side with the glove bobbing on its end, and it bops a SECOND time on the rebound
 *    (harder: THE impact). Three little stars circle the struck head for a moment. Then it retracts.
 *
 * THE BEATS: the shared damage formation (its end is this style's start); READY (the total sinks in, the hatch pops, the
 * glove peeks out and, Big, winds back); FIRE; BOP (the consequence lands ONCE, on the LAST bop); the retract and the
 * hatch closing are looks only (they happen after the blow). No hit-stop anywhere. Reduced motion: no glove, shake or
 * zoom; the numbers fade and the blow lands.
 *
 * THE SPRING AT ANY DISTANCE AND ANGLE: everything is laid out along the line between the two portraits (`gloveMotion`),
 * the overshoot, the draw back and the sway are in portrait radii (not fractions of the distance), and the coil has a
 * fixed length of wire per turn, so it is fat and tight when squeezed and thin and open when stretched.
 */
import { configStore } from '../heroAttack/configStore';
import { clamp, clamp01, easeOutBack, type Pt } from '../heroAttack/easing';
import {
  HERO_ATTACK_TIER_THRESHOLDS, reducedAttackTimeline, attackTier, type AttackTierContext, type TierNum,
} from '../heroAttack/tiers';

export type { TierNum };

export const GLOVE_LEVELS = ['small', 'big'] as const;
export type GloveLevel = (typeof GLOVE_LEVELS)[number];

/** The shared four tiers onto this Rare's two: I-II small, III-IV big (a knockout forces IV, so it plays big). */
export function gloveLevel(tier: TierNum): GloveLevel { return tier >= 3 ? 'big' : 'small'; }

export const GLOVE_LEVEL_SUFFIXES = [
  'ReadyMs', 'OutMs', 'WobbleMs', 'HoldMs', 'BackMs', 'Wind', 'Over', 'Sway', 'Size', 'Stars', 'StarsMs', 'Shake', 'Zoom', 'Punch', 'SettleMs', 'Dim',
] as const;
export type GloveLevelSuffix = (typeof GLOVE_LEVEL_SUFFIXES)[number];
type LevelKey = `${GloveLevel}${GloveLevelSuffix}`;

interface GlobalConfig {
  tier2At: number; tier3At: number; tier4At: number;
  absorbMs: number;
  heroWindPx: number;
  heroKickPx: number;
  homePop: number;
  closeMs: number;
  glovePx: number;
  hatchPx: number;
  springPitch: number;
  springWidth: number;
  springThick: number;
  bopSize: number;
  gloveSquash: number;
  knockPx: number;
  squash: number;
  shakeMs: number;
  zoomOutMs: number;
  reducedFadeMs: number;
  colorGlove: string;
  colorTrim: string;
  colorSpring: string;
  colorHatch: string;
  colorStar: string;
  colorFlash: string;
  colorPlayer: string;
  colorFoe: string;
  sfxPopClip: string; sfxPopGain: number; sfxPopRate: number;
  sfxBoingClip: string; sfxBoingGain: number; sfxBoingRate: number;
  sfxPunchClip: string; sfxPunchGain: number; sfxPunchRate: number;
  sfxRetractClip: string; sfxRetractGain: number; sfxRetractRate: number;
  sfxHomeClip: string; sfxHomeGain: number; sfxHomeRate: number;
  /** The steel coil's own twang (under the boing), the hatch's ratchet, the body under a bop, the coil winding back in. */
  sfxSpringClip: string; sfxSpringGain: number; sfxSpringRate: number;
  sfxRatchetClip: string; sfxRatchetGain: number; sfxRatchetRate: number;
  sfxBodyClip: string; sfxBodyGain: number; sfxBodyRate: number;
  sfxRecoilClip: string; sfxRecoilGain: number; sfxRecoilRate: number;
  sfxDuck: number;
  previewDamage: number;
  previewParts: number;
}
export type HeroGloveConfig = GlobalConfig & Record<LevelKey, number>;

export const HERO_GLOVE_COLOR_KEYS = ['colorGlove', 'colorTrim', 'colorSpring', 'colorHatch', 'colorStar', 'colorFlash', 'colorPlayer', 'colorFoe'] as const;
export const HERO_GLOVE_CLIP_KEYS = ['sfxPopClip', 'sfxBoingClip', 'sfxPunchClip', 'sfxRetractClip', 'sfxHomeClip', 'sfxSpringClip', 'sfxRatchetClip', 'sfxBodyClip', 'sfxRecoilClip'] as const;
export type HeroGloveStrKey = (typeof HERO_GLOVE_COLOR_KEYS)[number] | (typeof HERO_GLOVE_CLIP_KEYS)[number];
export type HeroGloveNumKey = Exclude<keyof HeroGloveConfig, HeroGloveStrKey>;

const LEVEL_DEFAULTS: Record<GloveLevelSuffix, [number, number]> = {
  ReadyMs: [280, 460],
  OutMs: [170, 150],
  WobbleMs: [0, 560],
  HoldMs: [190, 240],
  BackMs: [260, 300],
  Wind: [0.2, 1],
  Over: [0, 1],
  Sway: [0.16, 0.8],
  Size: [1, 1.25],
  Stars: [0, 4],
  StarsMs: [0, 1000],
  Shake: [6, 16],
  Zoom: [0.02, 0.035],
  Punch: [0.015, 0.045],
  SettleMs: [160, 200],
  Dim: [0.08, 0.2],
};

export const GLOVE_LEVEL_RANGES: Record<GloveLevelSuffix, [number, number, number]> = {
  ReadyMs: [160, 1200, 10],
  OutMs: [80, 800, 10],
  WobbleMs: [0, 1500, 10],
  HoldMs: [0, 1000, 10],
  BackMs: [120, 1200, 10],
  Wind: [0, 1, 0.05],
  Over: [0, 2.5, 0.05],
  Sway: [0, 1.5, 0.01],
  Size: [0.4, 2.5, 0.05],
  Stars: [0, 5, 1],
  StarsMs: [0, 2000, 10],
  Shake: [0, 30, 0.5],
  Zoom: [0, 0.1, 0.002],
  Punch: [0, 0.08, 0.001],
  SettleMs: [0, 1500, 10],
  Dim: [0, 0.6, 0.01],
};

const levelDefaults = Object.fromEntries(GLOVE_LEVELS.flatMap((l, i) => GLOVE_LEVEL_SUFFIXES.map((s) => [`${l}${s}`, LEVEL_DEFAULTS[s][i]]))) as Record<LevelKey, number>;

export const HERO_GLOVE_DEFAULTS: HeroGloveConfig = {
  ...HERO_ATTACK_TIER_THRESHOLDS,
  absorbMs: 180,
  heroWindPx: 9,
  heroKickPx: 12,
  homePop: 0.06,
  closeMs: 160,
  glovePx: 150,
  hatchPx: 84,
  springPitch: 38,
  springWidth: 44,
  springThick: 16,
  bopSize: 1.25,
  gloveSquash: 0.3,
  knockPx: 14,
  squash: 0.07,
  shakeMs: 340,
  zoomOutMs: 340,
  reducedFadeMs: 260,
  colorGlove: '#e8281e',
  colorTrim: '#fff6e6',
  colorSpring: '#c4ccd6',
  colorHatch: '#d6a24a',
  colorStar: '#ffd447',
  colorFlash: '#fffbe6',
  colorPlayer: '#ffd98a',
  colorFoe: '#ff7a5c',
  sfxPopClip: 'clickthock', sfxPopGain: 1, sfxPopRate: 1.2,
  sfxBoingClip: 'fx/glove-boing', sfxBoingGain: 1.1, sfxBoingRate: 0.88,
  sfxPunchClip: 'fx/glove-punch', sfxPunchGain: 1.3, sfxPunchRate: 1,
  sfxRetractClip: 'fx/stereogenicstudio-swish-swoosh-woosh-sfx-27-357164-3', sfxRetractGain: 0.6, sfxRetractRate: 1.5,
  sfxHomeClip: 'clickthock', sfxHomeGain: 1, sfxHomeRate: 0.85,
  sfxSpringClip: 'fx/glove-spring', sfxSpringGain: 1.1, sfxSpringRate: 0.62,
  sfxRatchetClip: 'fx/glove-ratchet', sfxRatchetGain: 0.7, sfxRatchetRate: 0.8,
  sfxBodyClip: 'fx/soccer-kick', sfxBodyGain: 1.15, sfxBodyRate: 0.85,
  sfxRecoilClip: 'fx/glove-recoil', sfxRecoilGain: 0.45, sfxRecoilRate: 0.6,
  sfxDuck: 0.6,
  previewDamage: 12,
  previewParts: 4,
  ...levelDefaults,
};

const GLOBAL_RANGES: Record<Exclude<keyof GlobalConfig, HeroGloveStrKey>, [number, number, number]> = {
  tier2At: [2, 40, 1], tier3At: [2, 60, 1], tier4At: [2, 80, 1],
  absorbMs: [60, 600, 10],
  heroWindPx: [0, 40, 1],
  heroKickPx: [0, 50, 1],
  homePop: [0, 0.3, 0.005],
  closeMs: [40, 600, 10],
  glovePx: [40, 260, 1],
  hatchPx: [20, 160, 1],
  springPitch: [12, 80, 1],
  springWidth: [4, 60, 0.5],
  springThick: [2, 20, 0.5],
  bopSize: [0.3, 3, 0.05],
  gloveSquash: [0, 0.6, 0.01],
  knockPx: [0, 60, 1],
  squash: [0, 0.3, 0.01],
  shakeMs: [0, 1200, 10],
  zoomOutMs: [60, 1500, 10],
  reducedFadeMs: [60, 1000, 10],
  sfxPopGain: [0, 2, 0.05], sfxPopRate: [0.5, 2.5, 0.01],
  sfxSpringGain: [0, 2, 0.05], sfxSpringRate: [0.5, 2.5, 0.01],
  sfxRatchetGain: [0, 2, 0.05], sfxRatchetRate: [0.5, 2.5, 0.01],
  sfxBodyGain: [0, 2, 0.05], sfxBodyRate: [0.5, 2.5, 0.01],
  sfxRecoilGain: [0, 2, 0.05], sfxRecoilRate: [0.5, 2.5, 0.01],
  sfxBoingGain: [0, 2, 0.05], sfxBoingRate: [0.5, 2.5, 0.01],
  sfxPunchGain: [0, 2, 0.05], sfxPunchRate: [0.5, 2.5, 0.01],
  sfxRetractGain: [0, 2, 0.05], sfxRetractRate: [0.5, 2.5, 0.01],
  sfxHomeGain: [0, 2, 0.05], sfxHomeRate: [0.5, 2.5, 0.01],
  sfxDuck: [0, 1, 0.05],
  previewDamage: [1, 60, 1],
  previewParts: [1, 8, 1],
};

export const HERO_GLOVE_RANGES: Record<HeroGloveNumKey, [number, number, number]> = {
  ...GLOBAL_RANGES,
  ...(Object.fromEntries(GLOVE_LEVELS.flatMap((l) => GLOVE_LEVEL_SUFFIXES.map((s) => [`${l}${s}`, GLOVE_LEVEL_RANGES[s]]))) as Record<LevelKey, [number, number, number]>),
};

/** Hard caps whatever a tuner types: the coil's turns (sprites), the circling stars, the shake and the zoom. */
export const GLOVE_CAPS = { segs: 40, stars: 5, shakePx: 30, zoom: 0.1 } as const;

const store = configStore<HeroGloveConfig>({
  key: 'ascent.heroglove.v1', defaults: HERO_GLOVE_DEFAULTS, ranges: HERO_GLOVE_RANGES,
  colorKeys: HERO_GLOVE_COLOR_KEYS, clipKeys: HERO_GLOVE_CLIP_KEYS, previewKeys: ['previewDamage', 'previewParts'],
});
export const heroGloveStore = store;
export const getHeroGloveConfig = store.get;
export const clampHeroGloveValue = store.clamp;
export const sanitizeHeroGloveConfig = store.sanitize;
export const heroGloveConfigJson = store.json;
/** The preview speed hook (Recruit + the Collection read one per style). Always 1: the Rare tuners have none. */
export function heroGlovePreviewSpeed(): number { return 1; }

export function gloveLevelDials(level: GloveLevel, c: HeroGloveConfig = store.get()): Record<GloveLevelSuffix, number> {
  return Object.fromEntries(GLOVE_LEVEL_SUFFIXES.map((s) => [s, c[`${level}${s}`]])) as Record<GloveLevelSuffix, number>;
}

// ─── the pure plan ─────────────────────────────────────────────────────────────────────────────────────────────

export const GLOVE_REF_DISTANCE = 1600;
/** How long after the charge the hatch pops (the total is still sinking in). */
export const GLOVE_POP_DELAY = 40;
/** The shortest wobble between the two bops that still reads as two (and gives the sway room). */
export const GLOVE_MIN_WOBBLE = 260;

/** A leg for a distance: the level's time, scaled gently by the distance. */
export function gloveLegMs(distance: number, levelMs: number): number {
  const d = Number.isFinite(distance) && distance > 0 ? distance : GLOVE_REF_DISTANCE;
  return Math.round(levelMs * clamp(Math.sqrt(d / GLOVE_REF_DISTANCE), 0.62, 1.15));
}

export interface GlovePlanInput extends AttackTierContext {
  leadIn?: number;
  total: number;
  distance: number;
  reduced?: boolean;
}

export interface GlovePlan {
  reduced: boolean;
  tier: TierNum;
  level: GloveLevel;
  k: number;
  total: number;
  chargeAt: number;
  absorbEnd: number;
  /** The hatch pops and the glove peeks out. */
  popAt: number;
  /** The spring lets go. */
  fireAt: number;
  /** Bops BEFORE the impact (ticks): Big's first bop, before the overshoot. */
  hits: number[];
  /** THE blow: the last bop. */
  impactAt: number;
  /** The glove starts back. */
  retractAt: number;
  /** The glove is back in the hatch. */
  homeAt: number;
  endAt: number;
  /** 0..1: how far the glove winds back before it fires. */
  wind: number;
  /** In struck-portrait radii: how far past the bop it overshoots, and how wide the spring sways. */
  over: number;
  sway: number;
  size: number;
  stars: number;
  starsMs: number;
  shakePx: number;
  zoom: number;
  punch: number;
  dim: number;
}

/** The whole Sucker Punch, in base ms. Pure and deterministic. */
export function glovePlan(input: GlovePlanInput, c: HeroGloveConfig = store.get()): GlovePlan {
  const total = Math.max(0, Math.round(input.total));
  const tier = attackTier(total, input, c); // a knockout always plays the shared Tier IV
  const level = gloveLevel(tier);
  const L = gloveLevelDials(level, c);
  const k = (tier - 1) / 3;
  const stars = Math.round(clamp(L.Stars, 0, GLOVE_CAPS.stars));
  const base = {
    tier, level, k, total, wind: clamp01(L.Wind), over: Math.max(0, L.Over), sway: Math.max(0, L.Sway), size: L.Size,
    stars, starsMs: stars > 0 ? Math.max(0, L.StarsMs) : 0,
    shakePx: clamp(L.Shake, 0, GLOVE_CAPS.shakePx), zoom: clamp(L.Zoom, 0, GLOVE_CAPS.zoom), punch: L.Punch, dim: L.Dim,
  };
  if (input.reduced) {
    const r = reducedAttackTimeline(input.leadIn ?? 0, c.reducedFadeMs);
    const at = r.impactAt;
    return {
      ...base, reduced: true, chargeAt: at, absorbEnd: at, popAt: at, fireAt: at, hits: [], impactAt: at, retractAt: at, homeAt: at, endAt: r.endAt,
      wind: 0, over: 0, sway: 0, size: 0, stars: 0, starsMs: 0, shakePx: 0, zoom: 0, punch: 0, dim: 0,
    };
  }
  const chargeAt = Math.max(0, input.leadIn ?? 0);
  const absorbEnd = chargeAt + c.absorbMs;
  const popAt = chargeAt + GLOVE_POP_DELAY;
  const fireAt = chargeAt + Math.max(L.ReadyMs, c.absorbMs, GLOVE_POP_DELAY + 120);
  const firstBop = fireAt + gloveLegMs(input.distance, L.OutMs);
  // A wobble makes it a double bop: the first is a tick, the rebound is THE impact.
  const wobble = L.WobbleMs > 0 ? Math.max(GLOVE_MIN_WOBBLE, L.WobbleMs) : 0;
  const impactAt = firstBop + wobble;
  const retractAt = impactAt + Math.max(0, L.HoldMs);
  const homeAt = retractAt + gloveLegMs(input.distance, L.BackMs);
  const endAt = Math.max(impactAt + c.zoomOutMs * 0.8, homeAt + c.closeMs, impactAt + base.starsMs) + L.SettleMs;
  return { ...base, reduced: false, chargeAt, absorbEnd, popAt, fireAt, hits: wobble > 0 ? [firstBop] : [], impactAt, retractAt, homeAt, endAt };
}

export type GloveCueKind = 'charge' | 'pop' | 'fire' | 'hit' | 'impact' | 'retract' | 'home' | 'end';
export interface GloveCue { at: number; kind: GloveCueKind; i: number }

export function gloveCues(p: GlovePlan): GloveCue[] {
  const out: GloveCue[] = [];
  if (!p.reduced) {
    out.push({ at: p.chargeAt, kind: 'charge', i: 0 });
    out.push({ at: p.popAt, kind: 'pop', i: 0 });
    out.push({ at: p.fireAt, kind: 'fire', i: 0 });
    p.hits.forEach((at, i) => out.push({ at, kind: 'hit', i }));
    out.push({ at: p.retractAt, kind: 'retract', i: 0 });
    out.push({ at: p.homeAt, kind: 'home', i: 0 });
  }
  out.push({ at: p.impactAt, kind: 'impact', i: p.hits.length });
  out.push({ at: p.endAt, kind: 'end', i: 0 });
  const order: Record<GloveCueKind, number> = { charge: 0, pop: 1, fire: 2, hit: 3, impact: 4, retract: 5, home: 6, end: 7 };
  return out.sort((a, b) => a.at - b.at || order[a.kind] - order[b.kind]);
}

// ─── the glove on its spring (pure) ────────────────────────────────────────────────────────────────────────────

/**
 * Where everything is, for one punch. All times are ms AFTER THE POP (the scene's own clock starts there); all lengths
 * are overlay px. The glove's centre runs along the axis `u` from `base` (the hatch); `n` is across it.
 */
export interface GloveMotion {
  /** The hatch, on the edge of the striking portrait facing the target. */
  base: Pt;
  /** The glove's centre at the bop. */
  hit: Pt;
  u: Pt;
  n: Pt;
  /** base -> hit. */
  len: number;
  /** How far the glove pokes out of the hatch at rest. */
  peek: number;
  /** How far it squeezes back from the peek as it winds up. */
  wind: number;
  /** How far past the bop it overshoots; how far it draws back before the rebound; how wide the spring sways. */
  over: number;
  back: number;
  sway: number;
  /** How far it bounces off the last bop. */
  rec: number;
  /** Which side it glances past on (+1 / -1, seeded). */
  side: number;
  /** True when the first bop is a tick and the rebound is the impact. */
  double: boolean;
  tFire: number;
  tHit: number;
  tImpact: number;
  tRetract: number;
  tHome: number;
  /** The coil: how many zig-zag strokes, and the fixed length of wire in each. */
  segs: number;
  wire: number;
  /** The glove's length on screen. */
  glove: number;
}

export interface GloveGeometry {
  attacker: Pt;
  defender: Pt;
  radius: number;
  aRadius: number;
  /** The glove's length and the coil's pitch at full stretch, overlay px. */
  glovePx: number;
  pitchPx: number;
  seed: number;
}

/**
 * One punch, from the plan and the two heroes. The overshoot, the draw back and the sway are in struck-portrait radii
 * and the coil's turn count follows the distance, so it reads the same with the portraits close or far, at any angle.
 * Null with reduced motion. Pure.
 */
export function gloveMotion(p: GlovePlan, g: GloveGeometry): GloveMotion | null {
  if (p.reduced) return null;
  const { attacker: a, defender: d } = g;
  const D = Math.hypot(d.x - a.x, d.y - a.y) || 1;
  const u = { x: (d.x - a.x) / D, y: (d.y - a.y) / D };
  const n = { x: -u.y, y: u.x };
  const glove = Math.max(8, g.glovePx);
  const base = { x: a.x + u.x * g.aRadius * 0.86, y: a.y + u.y * g.aRadius * 0.86 };
  // The knuckles sink a little way into the face: the glove's centre stops short of the portrait's middle.
  const stop = Math.min(D - g.aRadius * 0.86 - glove * 0.6, g.radius * 0.5 + glove * 0.24);
  const len = Math.max(glove * 0.7, D - g.aRadius * 0.86 - Math.max(0, stop));
  const hit = { x: base.x + u.x * len, y: base.y + u.y * len };
  const peek = Math.min(glove * 0.5, len * 0.5);
  const double = p.hits.length > 0;
  const over = double ? p.over * g.radius : 0;
  const back = double ? Math.min(len * 0.45, g.radius * 1.9) : 0;
  const pitch = Math.max(6, g.pitchPx);
  let segs = Math.round(clamp((len + over) / pitch, 8, GLOVE_CAPS.segs));
  if (segs % 2) segs += 1; // an even count: the coil starts and ends on the same side
  segs = Math.min(GLOVE_CAPS.segs, segs);
  return {
    base, hit, u, n, len, peek, wind: p.wind * peek * 0.7, over, back, sway: p.sway * g.radius,
    rec: clamp(len * 0.1, glove * 0.25, glove * 0.7) * (double ? 1.25 : 1),
    side: (g.seed >>> 0) % 2 === 0 ? 1 : -1, double,
    tFire: p.fireAt - p.popAt, tHit: (p.hits[0] ?? p.impactAt) - p.popAt, tImpact: p.impactAt - p.popAt,
    tRetract: p.retractAt - p.popAt, tHome: p.homeAt - p.popAt,
    segs, wire: ((len + over) / segs) * 1.6, glove, // enough wire that the coil is still a bold zig-zag at full stretch
  };
}

/** The glove on its spring at one instant. Reused by the scene (one object, no per-frame allocation). */
export interface GlovePose {
  /** The glove's centre: px along the axis from the hatch, and px across it. */
  ext: number;
  lat: number;
  /** How far the middle of the spring bows across the axis. */
  bow: number;
  /** The glove's squash along / across its own axis (1 = none). */
  sx: number;
  sy: number;
  /** 0..1: how much of the glove is out of the hatch (it tucks away as this falls). */
  vis: number;
}

export function newGlovePose(): GlovePose { return { ext: 0, lat: 0, bow: 0, sx: 1, sy: 1, vis: 0 }; }

const springAt = (ms: number, hz: number, tau: number): number => (ms < 0 ? 0 : Math.exp(-ms / tau) * Math.cos(2 * Math.PI * hz * (ms / 1000)));
const sine = (u: number): number => 0.5 - 0.5 * Math.cos(Math.PI * Math.min(1, Math.max(0, u)));

/** How long the glove takes to poke out of the hatch. */
export const GLOVE_EMERGE_MS = 130;
/** The sway between Big's two bops: how many half turns of side to side, and how far the spring's bow lags the glove. */
const SWAY_TURNS = 3.5 * Math.PI;
const BOW_LAG = 0.9;
/** How far the middle of the spring is thrown across, against the glove's own swing. */
const BOW_GAIN = 1.5;
/** Where the overshoot ends and the rebound begins, as fractions of the wobble. */
const OVER_END = 0.2;
const REBOUND_FROM = 0.78;

/** After the last bop: the bounce off the face and the boing on the end of the spring (`tau` ms since the bop). */
function recoil(m: GloveMotion, tau: number, out: GlovePose): void {
  const settle = 1 - Math.exp(-tau / 50);
  out.ext = m.len - m.rec * settle - m.rec * 0.3 * Math.exp(-tau / 110) * Math.sin(2 * Math.PI * 7 * (tau / 1000));
  const wob = (m.double ? 0.3 : 1) * m.sway * Math.exp(-tau / 130) * (1 - Math.exp(-tau / 30));
  out.lat = m.side * wob * Math.sin(2 * Math.PI * 6 * (tau / 1000));
  out.bow = -m.side * wob * BOW_GAIN * Math.sin(2 * Math.PI * 6 * (tau / 1000) - BOW_LAG);
}

/**
 * The glove `t` ms after the pop, written into `out`: it pokes out, (Big) winds back with a quiver, fires, bops,
 * (Big) overshoots, sways and rebounds into the second bop, bounces off, and retracts into the hatch. `squash` is the
 * glove's own squash on a bop (0 = none). Pure, no allocation.
 */
export function glovePoseAt(m: GloveMotion, t: number, squash: number, out: GlovePose): GlovePose {
  out.ext = 0; out.lat = 0; out.bow = 0; out.sx = 1; out.sy = 1; out.vis = 0;
  if (!(t > 0) || t >= m.tHome) return out;
  out.vis = 1;
  if (t < m.tFire) {
    // Poke out with a little bounce, then squeeze back against the coil, quivering.
    const w = clamp01((t - GLOVE_EMERGE_MS) / Math.max(1, m.tFire - GLOVE_EMERGE_MS - 30));
    const e = sine(w);
    out.ext = m.peek * easeOutBack(t / GLOVE_EMERGE_MS, 2.4) - m.wind * e;
    out.vis = clamp01(t / (GLOVE_EMERGE_MS * 0.7));
    const q = m.wind / Math.max(1, m.peek * 0.7); // 0..1: how hard it winds
    out.lat = Math.sin(t * 0.11) * m.glove * 0.03 * q * e;
    out.sx = 1 - 0.16 * q * e; out.sy = 1 + 0.1 * q * e;
    return out;
  }
  if (t < m.tHit) {
    // Let go: quick off the mark and still quick into the bop, stretched along its path.
    const v = (t - m.tFire) / Math.max(1, m.tHit - m.tFire);
    const from = m.peek - m.wind;
    out.ext = from + (m.len - from) * v * (0.55 + 0.45 * v);
    const st = 0.14 * Math.sin(Math.PI * Math.min(1, v * 1.15));
    out.sx = 1 + st; out.sy = 1 - st * 0.5;
    return out;
  }
  let sq = 0;
  if (t < m.tImpact) {
    // BIG, between the bops: past the face on one side, back with the spring swaying, then the rebound.
    const W = m.tImpact - m.tHit;
    const tau = t - m.tHit;
    const slip = m.sway * 0.55;
    const a = OVER_END * W, b = REBOUND_FROM * W;
    if (tau < a) {
      const s = Math.sin((tau / a) * Math.PI * 0.5);
      out.ext = m.len + m.over * s;
      out.lat = m.side * slip * s;
      out.bow = m.side * slip * BOW_GAIN * Math.cos(-BOW_LAG) * s;
    } else if (tau < b) {
      const q = (tau - a) / (b - a);
      out.ext = m.len + m.over - (m.over + m.back) * sine(q);
      const amp = slip + (m.sway - slip) * Math.sin(Math.PI * q);
      out.lat = m.side * amp * Math.cos(SWAY_TURNS * q);
      out.bow = m.side * amp * BOW_GAIN * Math.cos(SWAY_TURNS * q - BOW_LAG);
    } else {
      const q = (tau - b) / Math.max(1, W - b);
      out.ext = m.len - m.back + m.back * q * (0.4 + 0.6 * q);
      out.bow = m.side * slip * BOW_GAIN * Math.cos(SWAY_TURNS - BOW_LAG) * (1 - q) * (1 - q);
      const st = 0.16 * Math.sin(Math.PI * q);
      out.sx = 1 + st; out.sy = 1 - st * 0.5;
    }
    sq = 0.7 * springAt(tau, 8, 45);
  } else {
    const at = Math.min(t, m.tRetract) - m.tImpact;
    recoil(m, at, out);
    sq = (m.double ? 1.25 : 1) * springAt(t - m.tImpact, 7, 55);
    if (t > m.tRetract) {
      // Home: the coil hauls it in, slowly at first then with a snap, and it tucks into the hatch.
      const r = (t - m.tRetract) / Math.max(1, m.tHome - m.tRetract);
      const g = r * r * (0.35 + 0.65 * r);
      out.ext *= 1 - g; out.lat *= 1 - r; out.bow *= 1 - r;
      out.vis = clamp01(out.ext / Math.max(1, m.peek));
      out.sx = 1 + 0.1 * Math.sin(Math.PI * r); out.sy = 1 - 0.05 * Math.sin(Math.PI * r);
    }
  }
  out.sx *= 1 - squash * sq; out.sy *= 1 + squash * 0.7 * sq;
  return out;
}

/** The glove's centre `t` ms after the pop (the hatch when it is not out). Allocates: tests and one-off reads only. */
export function glovePos(m: GloveMotion, t: number): Pt {
  const p = glovePoseAt(m, t, 0, newGlovePose());
  return { x: m.base.x + m.u.x * p.ext + m.n.x * p.lat, y: m.base.y + m.u.y * p.ext + m.n.y * p.lat };
}

/**
 * The coil's half width when it spans `cur` px: every stroke holds `wire` px of wire, so squeezed it is wide and tight
 * and stretched it thins toward a straight line. Capped at `max`. Pure.
 */
export function coilAmp(m: GloveMotion, cur: number, max: number): number {
  const per = Math.max(0, cur) / m.segs;
  return Math.min(max, 0.5 * Math.sqrt(Math.max(0, m.wire * m.wire - per * per)));
}

// ─── the camera (pure) ─────────────────────────────────────────────────────────────────────────────────────────

/** The camera: a small push in through the ready, a kick as it fires and on the tick bop, a punch and shake on the impact. Pure. */
export function gloveCameraAt(p: GlovePlan, c: HeroGloveConfig, t: number, dir: Pt = { x: 1, y: 0 }): { zoom: number; x: number; y: number } {
  if (p.reduced) return { zoom: 1, x: 0, y: 0 };
  let z = 0;
  if (t >= p.chargeAt && t < p.impactAt) z += p.zoom * sine((t - p.chargeAt) / Math.max(1, p.fireAt - p.chargeAt));
  else if (t >= p.impactAt) z += (p.zoom + p.punch) * Math.exp(-(t - p.impactAt) / Math.max(1, c.zoomOutMs / 4));
  let x = 0, y = 0;
  const kick = (at: number, amp: number, tau: number, hz: number): void => { const s = springAt(t - at, hz, tau); x += dir.x * amp * s; y += dir.y * amp * s; };
  kick(p.fireAt, -p.shakePx * 0.15, 40, 14);
  for (const at of p.hits) kick(at, p.shakePx * 0.45, 40, 18);
  kick(p.impactAt, p.shakePx, Math.max(1, c.shakeMs / 4), 16);
  return { zoom: 1 + Math.max(0, z), x, y };
}

/** The anchor: the attacker through the ready, following the glove out, the defender from the first bop on. */
export function gloveCameraFocus(p: GlovePlan, t: number, a: Pt, d: Pt): Pt {
  const first = p.hits[0] ?? p.impactAt;
  if (t <= p.fireAt) return a;
  if (t < first) { const e = sine((t - p.fireAt) / Math.max(1, first - p.fireAt)); return { x: a.x + (d.x - a.x) * e, y: a.y + (d.y - a.y) * e }; }
  return d;
}
