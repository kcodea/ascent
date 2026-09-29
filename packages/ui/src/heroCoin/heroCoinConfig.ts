/**
 * THE COIN FLICK HERO ATTACK (a RARE): its tuned values, its pure timeline, the pure coin path and the pure camera.
 *
 * Owner 2026-09-29: "build 5 animations that range from rare -> epic. all of the animations we have done so far are
 * legendary. rare and epics should only have 2 or 3 tiers to them and generally be less exciting, but still extremely
 * clean and fun. get creative".
 *
 * ONE CLEAR IDEA: the hero flicks a gleaming gold coin that spins (a flat in-plane turn plus an edge-on FLIP, read as its
 * width closing and opening) and PINGS off the struck hero with a bright "ding" sparkle.
 *
 * TWO VISUAL TIERS (a Rare has two, not four). The shared four map onto them here (`coinLevel`): I-II play SMALL,
 * III-IV play BIG, so a knockout (which always forces the shared Tier IV) plays BIG.
 *  - SMALL: one coin, one ping (THE impact), and it caroms off the face, tumbling away.
 *  - BIG: a ricochet volley. The coin pings the face (a tick), hops off it and back (a tick), and on the last ping (THE
 *    impact) it bursts into a small shower of coins that spill out and fall.
 *
 * THE BEATS (base ms before the playback speed): the shared damage formation (its end is this style's start); READY
 * (the total sinks into the hero, who dips back while a glint gathers at the flicking hand); FLICK (a snap, the coin
 * leaves spinning on a slight arc, a short afterimage trail behind it); PING (a four-point sparkle, a gold ring, a spray
 * of glitter; every ping before the last is a tick, FX and sound only); THE IMPACT (the consequence lands ONCE, here).
 * No hit-stop anywhere. Reduced motion: no coin, no shake, no zoom; the numbers fade and the blow lands.
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
export const COIN_LEVELS = ['small', 'big'] as const;
export type CoinLevel = (typeof COIN_LEVELS)[number];

/** The shared four tiers onto this Rare's two: I-II small, III-IV big (a knockout forces IV, so it plays big). */
export function coinLevel(tier: TierNum): CoinLevel { return tier >= 3 ? 'big' : 'small'; }

/** The per-level dials. A config key is `small` / `big` + one of these. */
export const COIN_LEVEL_SUFFIXES = [
  'ReadyMs', 'FlightMs', 'Arc', 'Pings', 'HopMs', 'HopLift', 'CoinSize', 'FlipHz', 'Sparkles', 'Shower',
  'Shake', 'Zoom', 'Punch', 'SettleMs', 'Dim',
] as const;
export type CoinLevelSuffix = (typeof COIN_LEVEL_SUFFIXES)[number];
type LevelKey = `${CoinLevel}${CoinLevelSuffix}`;

interface GlobalConfig {
  tier2At: number; tier3At: number; tier4At: number;
  absorbMs: number;
  heroDipPx: number;
  heroFlickPx: number;
  coinPx: number;
  ghosts: number;
  ghostMs: number;
  glintAlpha: number;
  pingSize: number;
  caromMs: number;
  showerSpeed: number;
  showerGravity: number;
  knockPx: number;
  squash: number;
  shakeMs: number;
  zoomOutMs: number;
  reducedFadeMs: number;
  colorGold: string;
  colorAmber: string;
  colorShine: string;
  colorDeep: string;
  colorPlayer: string;
  colorFoe: string;
  sfxFlickClip: string; sfxFlickGain: number; sfxFlickRate: number;
  sfxSnapClip: string; sfxSnapGain: number; sfxSnapRate: number;
  sfxDingClip: string; sfxDingGain: number; sfxDingRate: number;
  sfxSparkleClip: string; sfxSparkleGain: number; sfxSparkleRate: number;
  sfxImpactClip: string; sfxImpactGain: number; sfxImpactRate: number;
  sfxShowerClip: string; sfxShowerGain: number; sfxShowerRate: number;
  sfxDuck: number;
  previewDamage: number;
  previewParts: number;
}
export type HeroCoinConfig = GlobalConfig & Record<LevelKey, number>;

export const HERO_COIN_COLOR_KEYS = ['colorGold', 'colorAmber', 'colorShine', 'colorDeep', 'colorPlayer', 'colorFoe'] as const;
export const HERO_COIN_CLIP_KEYS = ['sfxFlickClip', 'sfxSnapClip', 'sfxDingClip', 'sfxSparkleClip', 'sfxImpactClip', 'sfxShowerClip'] as const;
export type HeroCoinStrKey = (typeof HERO_COIN_COLOR_KEYS)[number] | (typeof HERO_COIN_CLIP_KEYS)[number];
export type HeroCoinNumKey = Exclude<keyof HeroCoinConfig, HeroCoinStrKey>;

/** Small, big per suffix. */
const LEVEL_DEFAULTS: Record<CoinLevelSuffix, [number, number]> = {
  ReadyMs: [260, 300],
  FlightMs: [440, 420],
  Arc: [0.14, 0.16],
  Pings: [1, 3],
  HopMs: [260, 250],
  HopLift: [1.1, 1.2],
  CoinSize: [1, 1.1],
  FlipHz: [4.5, 5.5],
  Sparkles: [8, 12],
  Shower: [0, 10],
  Shake: [4, 8],
  Zoom: [0.02, 0.035],
  Punch: [0.015, 0.03],
  SettleMs: [240, 300],
  Dim: [0.08, 0.2],
};

export const COIN_LEVEL_RANGES: Record<CoinLevelSuffix, [number, number, number]> = {
  ReadyMs: [60, 1200, 10],
  FlightMs: [150, 1200, 10],
  Arc: [0, 0.5, 0.01],
  Pings: [1, 5, 1],
  HopMs: [100, 800, 10],
  HopLift: [0.2, 3, 0.05],
  CoinSize: [0.4, 2.5, 0.05],
  FlipHz: [0, 14, 0.25],
  Sparkles: [0, 30, 1],
  Shower: [0, 16, 1],
  Shake: [0, 30, 0.5],
  Zoom: [0, 0.1, 0.002],
  Punch: [0, 0.08, 0.001],
  SettleMs: [0, 1500, 10],
  Dim: [0, 0.6, 0.01],
};

const levelDefaults = Object.fromEntries(COIN_LEVELS.flatMap((l, i) => COIN_LEVEL_SUFFIXES.map((s) => [`${l}${s}`, LEVEL_DEFAULTS[s][i]]))) as Record<LevelKey, number>;

export const HERO_COIN_DEFAULTS: HeroCoinConfig = {
  ...HERO_ATTACK_TIER_THRESHOLDS,
  absorbMs: 180,
  heroDipPx: 8,
  heroFlickPx: 12,
  coinPx: 46,
  ghosts: 3,
  ghostMs: 24,
  glintAlpha: 0.9,
  pingSize: 1,
  caromMs: 560,
  showerSpeed: 560,
  showerGravity: 1500,
  knockPx: 12,
  squash: 0.06,
  shakeMs: 280,
  zoomOutMs: 340,
  reducedFadeMs: 260,
  colorGold: '#ffc93c',
  colorAmber: '#ff9a1f',
  colorShine: '#fff4c2',
  colorDeep: '#8a5a12',
  colorPlayer: '#ffd76a',
  colorFoe: '#ff6a4d',
  sfxFlickClip: 'fx/stereogenicstudio-swish-swoosh-woosh-sfx-27-357164-3', sfxFlickGain: 0.35, sfxFlickRate: 1.9,
  sfxSnapClip: 'fx/universfield-whip-snap-242215', sfxSnapGain: 0.2, sfxSnapRate: 1.9,
  sfxDingClip: 'sell2', sfxDingGain: 0.55, sfxDingRate: 1.15,
  sfxSparkleClip: 'equipmentsheen', sfxSparkleGain: 0.3, sfxSparkleRate: 1.35,
  sfxImpactClip: 'smack2', sfxImpactGain: 0.4, sfxImpactRate: 1.25,
  sfxShowerClip: 'sell4', sfxShowerGain: 0.5, sfxShowerRate: 1,
  sfxDuck: 0.6,
  previewDamage: 12,
  previewParts: 4,
  ...levelDefaults,
};

const GLOBAL_RANGES: Record<Exclude<keyof GlobalConfig, HeroCoinStrKey>, [number, number, number]> = {
  tier2At: [2, 40, 1], tier3At: [2, 60, 1], tier4At: [2, 80, 1],
  absorbMs: [60, 600, 10],
  heroDipPx: [0, 40, 1],
  heroFlickPx: [0, 50, 1],
  coinPx: [16, 120, 1],
  ghosts: [0, 6, 1],
  ghostMs: [8, 80, 1],
  glintAlpha: [0, 1, 0.01],
  pingSize: [0.3, 3, 0.05],
  caromMs: [150, 1500, 10],
  showerSpeed: [100, 1400, 10],
  showerGravity: [0, 4000, 20],
  knockPx: [0, 60, 1],
  squash: [0, 0.3, 0.01],
  shakeMs: [0, 1200, 10],
  zoomOutMs: [60, 1500, 10],
  reducedFadeMs: [60, 1000, 10],
  sfxFlickGain: [0, 2, 0.05], sfxFlickRate: [0.5, 2.5, 0.01],
  sfxSnapGain: [0, 2, 0.05], sfxSnapRate: [0.5, 2.5, 0.01],
  sfxDingGain: [0, 2, 0.05], sfxDingRate: [0.5, 2.5, 0.01],
  sfxSparkleGain: [0, 2, 0.05], sfxSparkleRate: [0.5, 2.5, 0.01],
  sfxImpactGain: [0, 2, 0.05], sfxImpactRate: [0.5, 2.5, 0.01],
  sfxShowerGain: [0, 2, 0.05], sfxShowerRate: [0.5, 2.5, 0.01],
  sfxDuck: [0, 1, 0.05],
  previewDamage: [1, 60, 1],
  previewParts: [1, 8, 1],
};

/** [min, max, step] per numeric key. Values outside are clamped on write AND on load. */
export const HERO_COIN_RANGES: Record<HeroCoinNumKey, [number, number, number]> = {
  ...GLOBAL_RANGES,
  ...(Object.fromEntries(COIN_LEVELS.flatMap((l) => COIN_LEVEL_SUFFIXES.map((s) => [`${l}${s}`, COIN_LEVEL_RANGES[s]]))) as Record<LevelKey, [number, number, number]>),
};

/** The hard ceilings a plan never exceeds, whatever the sliders say. */
export const COIN_CAPS = { pings: 5, shower: 16, sparkles: 30, shakePx: 30, zoom: 0.1 } as const;

const store = configStore<HeroCoinConfig>({
  key: 'ascent.herocoin.v1', defaults: HERO_COIN_DEFAULTS, ranges: HERO_COIN_RANGES,
  colorKeys: HERO_COIN_COLOR_KEYS, clipKeys: HERO_COIN_CLIP_KEYS, previewKeys: ['previewDamage', 'previewParts'],
});
/** The store itself (the tuner reads and writes through it). */
export const heroCoinStore = store;
export const getHeroCoinConfig = store.get;
export const clampHeroCoinValue = store.clamp;
export const sanitizeHeroCoinConfig = store.sanitize;
export const setHeroCoinValue = store.set;
export const resetHeroCoinConfig = store.reset;
export const heroCoinConfigJson = store.json;
/** The tuners' preview speed hook (Recruit + the Collection read one per style). Always 1: the Rare tuners have none. */
export function heroCoinPreviewSpeed(): number { return 1; }

/** One level's dials, read out of the config. */
export function coinLevelDials(level: CoinLevel, c: HeroCoinConfig = store.get()): Record<CoinLevelSuffix, number> {
  return Object.fromEntries(COIN_LEVEL_SUFFIXES.map((s) => [s, c[`${level}${s}`]])) as Record<CoinLevelSuffix, number>;
}

// ─── the pure plan ─────────────────────────────────────────────────────────────────────────────────────────────

/** The reference distance flight times are tuned at (a 1080p board, corner to corner). */
export const COIN_REF_DISTANCE = 1600;

/** The flight for a distance: the level's time, scaled gently by the distance (a sandbox box stays readable). */
export function coinFlightMs(distance: number, levelMs: number): number {
  const d = Number.isFinite(distance) && distance > 0 ? distance : COIN_REF_DISTANCE;
  return Math.round(levelMs * clamp(Math.sqrt(d / COIN_REF_DISTANCE), 0.62, 1.15));
}

export interface CoinPlanInput extends AttackTierContext {
  /** When the style's own attack starts: the end of the shared damage formation. */
  leadIn?: number;
  total: number;
  distance: number;
  reduced?: boolean;
}

export interface CoinPlan {
  reduced: boolean;
  /** The SHARED tier (1..4), from `attackTier` (a knockout is 4). */
  tier: TierNum;
  /** This Rare's visual tier. */
  level: CoinLevel;
  /** 0..1 across the shared tiers (the damage formation's pop reads it). */
  k: number;
  total: number;
  chargeAt: number;
  absorbEnd: number;
  /** The coin leaves the hand. */
  flickAt: number;
  flightMs: number;
  hopMs: number;
  /** Every ping, in order; the last is THE impact. */
  pings: number[];
  /** The pings BEFORE the impact (ticks: FX and sound only). */
  hits: number[];
  impactAt: number;
  /** Big: the coin bursts into a shower on the impact. */
  shower: number;
  endAt: number;
  size: number;
  flipHz: number;
  sparkles: number;
  shakePx: number;
  zoom: number;
  punch: number;
  dim: number;
}

/** The whole Coin Flick, in base ms. Pure and deterministic. */
export function coinPlan(input: CoinPlanInput, c: HeroCoinConfig = store.get()): CoinPlan {
  const total = Math.max(0, Math.round(input.total));
  const tier = attackTier(total, input, c); // a knockout always plays the shared Tier IV (heroAttack/tiers.ts)
  const level = coinLevel(tier);
  const L = coinLevelDials(level, c);
  const k = (tier - 1) / 3;
  if (input.reduced) {
    const r = reducedAttackTimeline(input.leadIn ?? 0, c.reducedFadeMs);
    const at = r.impactAt;
    return {
      reduced: true, tier, level, k, total, chargeAt: at, absorbEnd: at, flickAt: at, flightMs: 0, hopMs: 0, pings: [at], hits: [],
      impactAt: at, shower: 0, endAt: r.endAt, size: 0, flipHz: 0, sparkles: 0, shakePx: 0, zoom: 0, punch: 0, dim: 0,
    };
  }
  const chargeAt = Math.max(0, input.leadIn ?? 0);
  const absorbEnd = chargeAt + c.absorbMs;
  const flickAt = chargeAt + Math.max(L.ReadyMs, c.absorbMs);
  const flightMs = coinFlightMs(input.distance, L.FlightMs);
  const n = clamp(Math.round(L.Pings), 1, COIN_CAPS.pings);
  const hopMs = Math.round(L.HopMs);
  const pings = Array.from({ length: n }, (_, i) => flickAt + flightMs + i * hopMs);
  const impactAt = pings[n - 1]!;
  const shower = level === 'big' ? Math.round(clamp(L.Shower, 0, COIN_CAPS.shower)) : 0;
  // The carom (small) and the shower (big) drain after the end: the fight never waits on a falling coin.
  const endAt = impactAt + Math.max(c.zoomOutMs * 0.8, 300) + L.SettleMs;
  return {
    reduced: false, tier, level, k, total, chargeAt, absorbEnd, flickAt, flightMs, hopMs, pings, hits: pings.slice(0, -1), impactAt,
    shower, endAt, size: L.CoinSize, flipHz: L.FlipHz, sparkles: Math.round(clamp(L.Sparkles, 0, COIN_CAPS.sparkles)),
    shakePx: clamp(L.Shake, 0, COIN_CAPS.shakePx), zoom: clamp(L.Zoom, 0, COIN_CAPS.zoom), punch: L.Punch, dim: L.Dim,
  };
}

export type CoinCueKind = 'charge' | 'flick' | 'hit' | 'impact' | 'end';
export interface CoinCue { at: number; kind: CoinCueKind; i: number }

/** Every beat the runner fires, in time order (a tick precedes the impact on a tie). */
export function coinCues(p: CoinPlan): CoinCue[] {
  const out: CoinCue[] = [];
  if (!p.reduced) {
    out.push({ at: p.chargeAt, kind: 'charge', i: 0 });
    out.push({ at: p.flickAt, kind: 'flick', i: 0 });
    p.hits.forEach((at, i) => out.push({ at, kind: 'hit', i }));
  }
  out.push({ at: p.impactAt, kind: 'impact', i: 0 });
  out.push({ at: p.endAt, kind: 'end', i: 0 });
  const order: Record<CoinCueKind, number> = { charge: 0, flick: 1, hit: 2, impact: 3, end: 4 };
  return out.sort((a, b) => a.at - b.at || order[a.kind] - order[b.kind]);
}

// ─── the coin's path (pure) ────────────────────────────────────────────────────────────────────────────────────

/** One leg of the coin's path: a quadratic from `a` through control `c` to `b`, starting `start` ms after the flick. */
export interface CoinLeg { a: Pt; c: Pt; b: Pt; start: number; dur: number; kind: 'flight' | 'hop' }

export interface CoinPath {
  legs: CoinLeg[];
  /** Where each ping lands on the struck portrait (one per ping; the last is THE impact). */
  contacts: Pt[];
  /** The direction the coin is travelling as it lands each ping (unit). */
  arrive: Pt[];
}

/** The flight's progress: flicked out fast and still quick into the face (it pings, never drifts in). */
export const flightEase = (u: number): number => { const t = Math.min(1, Math.max(0, Number.isFinite(u) ? u : 0)); return 0.72 * t + 0.28 * t * t; };

function quad(a: Pt, c: Pt, b: Pt, e: number): Pt {
  const m = 1 - e;
  return { x: m * m * a.x + 2 * m * e * c.x + e * e * b.x, y: m * m * a.y + 2 * m * e * c.y + e * e * b.y };
}

function quadDir(a: Pt, c: Pt, b: Pt, e: number): Pt {
  const dx = 2 * (1 - e) * (c.x - a.x) + 2 * e * (b.x - c.x);
  const dy = 2 * (1 - e) * (c.y - a.y) + 2 * e * (b.y - c.y);
  const l = Math.hypot(dx, dy) || 1;
  return { x: dx / l, y: dy / l };
}

/**
 * Where the pings land (offsets from the struck portrait's centre, in radii). The first is on the side of the face that
 * looks back at the thrower, swung clear of where the big `-N` pops (`avoid`); a ricochet's next pings alternate either
 * side of it, so the coin visibly hops ACROSS the face.
 */
export function pingOffsets(n: number, a: Pt, d: Pt, avoid: Pt | null = null): Pt[] {
  let back = Math.atan2(a.y - d.y, a.x - d.x);
  if (avoid && Math.hypot(avoid.x - d.x, avoid.y - d.y) > 1) {
    const av = Math.atan2(avoid.y - d.y, avoid.x - d.x);
    let diff = Math.atan2(Math.sin(back - av), Math.cos(back - av));
    if (Math.abs(diff) < 1.1) { diff = (diff === 0 ? 1 : Math.sign(diff)) * 1.1; back = av + diff; }
  }
  const out: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const swing = i === 0 ? 0 : (i % 2 ? 1 : -1) * (0.75 + 0.1 * i);
    const r = i === 0 ? 0.42 : 0.34;
    out.push({ x: Math.cos(back + swing) * r, y: Math.sin(back + swing) * r });
  }
  return out;
}

/**
 * The coin's whole path from the plan and the two heroes: released off the thrower's rim, a slight arc (never above
 * `ceilY`) into the first ping, then each ricochet a hop that bounces OUT of the face (toward the viewer's side of it,
 * up and away) and back down onto the next ping. Pure, so a replay flies the same path.
 */
export function coinPath(p: CoinPlan, a: Pt, d: Pt, radius: number, aRadius: number, arc: number, ceilY = Number.NEGATIVE_INFINITY, avoid: Pt | null = null, hopLift = 1.1): CoinPath {
  if (p.reduced) return { legs: [], contacts: [], arrive: [] };
  const L = Math.hypot(d.x - a.x, d.y - a.y) || 1;
  const u = { x: (d.x - a.x) / L, y: (d.y - a.y) / L };
  const offs = pingOffsets(p.pings.length, a, d, avoid);
  const contacts = offs.map((o) => ({ x: d.x + o.x * radius, y: d.y + o.y * radius }));
  const rel = { x: a.x + u.x * aRadius * 0.8, y: a.y + u.y * aRadius * 0.8 };
  const first = contacts[0]!;
  const D = Math.hypot(first.x - rel.x, first.y - rel.y) || 1;
  const n = { x: -u.y, y: u.x };
  const lift = n.y > 0 ? -1 : 1; // the arc bows toward the TOP of the screen
  const mid = { x: (rel.x + first.x) / 2, y: (rel.y + first.y) / 2 };
  const ctrl = { x: mid.x + n.x * lift * arc * D, y: Math.max(ceilY, mid.y + n.y * lift * arc * D) };
  const legs: CoinLeg[] = [{ a: rel, c: ctrl, b: first, start: 0, dur: p.flightMs, kind: 'flight' }];
  for (let i = 1; i < contacts.length; i++) {
    const from = contacts[i - 1]!, to = contacts[i]!;
    // The hop's apex: out of the face along the ping's own offset, and up, so it reads as a bounce off the portrait.
    const out = { x: from.x - d.x, y: from.y - d.y };
    const ol = Math.hypot(out.x, out.y) || 1;
    const apex = {
      x: (from.x + to.x) / 2 + (out.x / ol) * radius * 0.45 * hopLift,
      y: Math.max(ceilY, (from.y + to.y) / 2 - radius * 0.75 * hopLift),
    };
    const c = { x: 2 * apex.x - (from.x + to.x) / 2, y: 2 * apex.y - (from.y + to.y) / 2 };
    legs.push({ a: from, c, b: to, start: p.flightMs + (i - 1) * p.hopMs, dur: p.hopMs, kind: 'hop' });
  }
  const arrive = legs.map((g) => quadDir(g.a, g.c, g.b, 1));
  return { legs, contacts, arrive };
}

/** Where the coin is `t` ms after the flick (held on the last ping after the path ends), and its heading. Pure. */
export function coinPos(path: CoinPath, t: number): { x: number; y: number; dx: number; dy: number } {
  const legs = path.legs;
  if (!legs.length) return { x: 0, y: 0, dx: 1, dy: 0 };
  const tt = Math.max(0, t);
  let g = legs[legs.length - 1]!;
  for (const leg of legs) { if (tt < leg.start + leg.dur) { g = leg; break; } }
  const u = Math.min(1, Math.max(0, (tt - g.start) / Math.max(1, g.dur)));
  const e = g.kind === 'flight' ? flightEase(u) : u;
  const p = quad(g.a, g.c, g.b, e);
  const dir = quadDir(g.a, g.c, g.b, e);
  return { x: p.x, y: p.y, dx: dir.x, dy: dir.y };
}

/** The coin's whole ride length (ms after the flick to the last ping). */
export function coinPathMs(path: CoinPath): number {
  const g = path.legs[path.legs.length - 1];
  return g ? g.start + g.dur : 0;
}

// ─── the camera (pure) ─────────────────────────────────────────────────────────────────────────────────────────

const springAt = (ms: number, hz: number, tau: number): number => (ms < 0 ? 0 : Math.exp(-ms / tau) * Math.cos(2 * Math.PI * hz * (ms / 1000)));
const sine = (u: number): number => 0.5 - 0.5 * Math.cos(Math.PI * Math.min(1, Math.max(0, u)));

/**
 * The camera at sequence time `t`: a small push in through the ready, a tiny kick along the coin on each tick ping, a
 * punch and a directional shake on the impact, settling back. Deterministic. Pure.
 */
export function coinCameraAt(p: CoinPlan, c: HeroCoinConfig, t: number, dir: Pt = { x: 1, y: 0 }): { zoom: number; x: number; y: number } {
  if (p.reduced) return { zoom: 1, x: 0, y: 0 };
  let z = 0;
  if (t >= p.chargeAt && t < p.impactAt) z += p.zoom * sine((t - p.chargeAt) / Math.max(1, p.flickAt - p.chargeAt));
  else if (t >= p.impactAt) z += (p.zoom + p.punch) * Math.exp(-(t - p.impactAt) / Math.max(1, c.zoomOutMs / 4));
  let x = 0, y = 0;
  const kick = (at: number, amp: number, tau: number, hz: number): void => {
    const s = springAt(t - at, hz, tau);
    x += dir.x * amp * s; y += dir.y * amp * s;
  };
  kick(p.flickAt, -p.shakePx * 0.12, 40, 14);
  p.hits.forEach((at) => kick(at, p.shakePx * 0.3, 40, 18));
  kick(p.impactAt, p.shakePx, Math.max(1, c.shakeMs / 4), 16);
  return { zoom: 1 + Math.max(0, z), x, y };
}

/** Where the camera anchors: the attacker through the ready, following the coin, the defender from the first ping. */
export function coinCameraFocus(p: CoinPlan, t: number, a: Pt, d: Pt): Pt {
  const first = p.pings[0] ?? p.impactAt;
  if (t <= p.flickAt) return a;
  if (t >= first) return d;
  const e = sine((t - p.flickAt) / Math.max(1, first - p.flickAt));
  return { x: a.x + (d.x - a.x) * e, y: a.y + (d.y - a.y) * e };
}
