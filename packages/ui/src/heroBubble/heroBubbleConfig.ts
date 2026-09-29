/**
 * THE BUBBLE POP HERO ATTACK (a RARE): its tuned values, its pure timeline, the pure drift paths and the pure camera.
 *
 * Owner 2026-09-29: "build 5 animations that range from rare -> epic ... rare and epics should only have 2 or 3 tiers to
 * them and generally be less exciting, but still extremely clean and fun. get creative".
 *
 * ONE CLEAR IDEA, soft and playful: an iridescent soap bubble wobbles out of the hero, drifts over to the struck hero,
 * swells round its face and POPS into droplets and tiny bubbles.
 *
 * TWO VISUAL TIERS (a Rare has two). The shared four map onto them here (`bubbleLevel`): I-II play SMALL, III-IV play
 * BIG, so a knockout (which always forces the shared Tier IV) plays BIG.
 *  - SMALL: one bubble is blown at the hero's rim, drifts over on a gentle wobble, engulfs the face and POPS (THE impact).
 *  - BIG: a stream of little bubbles first (each blips on the face: ticks), while one BIG bubble is blown behind them; it
 *    drifts over, swells round the whole portrait, strains, and pops with a splash ring (THE impact).
 *
 * THE BEATS: the shared damage formation (its end is this style's start); BLOW (the total sinks in while the bubble
 * swells at the hand); DRIFT; ENGULF; HOLD (the film strains); POP (the consequence lands ONCE, here). No hit-stop.
 * Reduced motion: no bubbles, shake or zoom; the numbers fade and the blow lands.
 */
import { configStore } from '../heroAttack/configStore';
import { clamp, type Pt } from '../heroAttack/easing';
import {
  HERO_ATTACK_TIER_THRESHOLDS, reducedAttackTimeline, attackTier, type AttackTierContext, type TierNum,
} from '../heroAttack/tiers';

export type { TierNum };

export const BUBBLE_LEVELS = ['small', 'big'] as const;
export type BubbleLevel = (typeof BUBBLE_LEVELS)[number];

/** The shared four tiers onto this Rare's two: I-II small, III-IV big (a knockout forces IV, so it plays big). */
export function bubbleLevel(tier: TierNum): BubbleLevel { return tier >= 3 ? 'big' : 'small'; }

export const BUBBLE_LEVEL_SUFFIXES = [
  'BlowMs', 'DriftMs', 'Wobble', 'Stream', 'StreamGapMs', 'StreamMs', 'BubbleSize', 'EngulfSize', 'EngulfMs', 'HoldMs',
  'Drops', 'Tinies', 'Splash', 'Shake', 'Zoom', 'Punch', 'SettleMs', 'Dim',
] as const;
export type BubbleLevelSuffix = (typeof BUBBLE_LEVEL_SUFFIXES)[number];
type LevelKey = `${BubbleLevel}${BubbleLevelSuffix}`;

interface GlobalConfig {
  tier2At: number; tier3At: number; tier4At: number;
  absorbMs: number;
  heroPuff: number;
  heroPushPx: number;
  lift: number;
  filmSpin: number;
  sheenAlpha: number;
  dropGravity: number;
  dropSpeed: number;
  floatPx: number;
  knockPx: number;
  squash: number;
  shakeMs: number;
  zoomOutMs: number;
  reducedFadeMs: number;
  colorFilm: string;
  colorPink: string;
  colorMint: string;
  colorLilac: string;
  colorSky: string;
  colorPlayer: string;
  colorFoe: string;
  sfxBlowClip: string; sfxBlowGain: number; sfxBlowRate: number;
  sfxBlipClip: string; sfxBlipGain: number; sfxBlipRate: number;
  sfxStretchClip: string; sfxStretchGain: number; sfxStretchRate: number;
  sfxPopClip: string; sfxPopGain: number; sfxPopRate: number;
  sfxSplashClip: string; sfxSplashGain: number; sfxSplashRate: number;
  sfxDuck: number;
  previewDamage: number;
  previewParts: number;
}
export type HeroBubbleConfig = GlobalConfig & Record<LevelKey, number>;

export const HERO_BUBBLE_COLOR_KEYS = ['colorFilm', 'colorPink', 'colorMint', 'colorLilac', 'colorSky', 'colorPlayer', 'colorFoe'] as const;
export const HERO_BUBBLE_CLIP_KEYS = ['sfxBlowClip', 'sfxBlipClip', 'sfxStretchClip', 'sfxPopClip', 'sfxSplashClip'] as const;
export type HeroBubbleStrKey = (typeof HERO_BUBBLE_COLOR_KEYS)[number] | (typeof HERO_BUBBLE_CLIP_KEYS)[number];
export type HeroBubbleNumKey = Exclude<keyof HeroBubbleConfig, HeroBubbleStrKey>;

const LEVEL_DEFAULTS: Record<BubbleLevelSuffix, [number, number]> = {
  BlowMs: [300, 420],
  DriftMs: [560, 520],
  Wobble: [0.07, 0.09],
  Stream: [0, 5],
  StreamGapMs: [110, 100],
  StreamMs: [460, 440],
  BubbleSize: [0.42, 0.55],
  EngulfSize: [1.08, 1.34],
  EngulfMs: [220, 260],
  HoldMs: [120, 200],
  Drops: [14, 26],
  Tinies: [6, 12],
  Splash: [0, 1],
  Shake: [3, 6],
  Zoom: [0.02, 0.035],
  Punch: [0.012, 0.025],
  SettleMs: [220, 260],
  Dim: [0.06, 0.16],
};

export const BUBBLE_LEVEL_RANGES: Record<BubbleLevelSuffix, [number, number, number]> = {
  BlowMs: [80, 1200, 10],
  DriftMs: [150, 1500, 10],
  Wobble: [0, 0.3, 0.005],
  Stream: [0, 10, 1],
  StreamGapMs: [30, 400, 5],
  StreamMs: [150, 1200, 10],
  BubbleSize: [0.15, 1.5, 0.01],
  EngulfSize: [0.6, 2.2, 0.01],
  EngulfMs: [60, 900, 10],
  HoldMs: [0, 900, 10],
  Drops: [0, 50, 1],
  Tinies: [0, 30, 1],
  Splash: [0, 2, 0.05],
  Shake: [0, 30, 0.5],
  Zoom: [0, 0.1, 0.002],
  Punch: [0, 0.08, 0.001],
  SettleMs: [0, 1500, 10],
  Dim: [0, 0.6, 0.01],
};

const levelDefaults = Object.fromEntries(BUBBLE_LEVELS.flatMap((l, i) => BUBBLE_LEVEL_SUFFIXES.map((s) => [`${l}${s}`, LEVEL_DEFAULTS[s][i]]))) as Record<LevelKey, number>;

export const HERO_BUBBLE_DEFAULTS: HeroBubbleConfig = {
  ...HERO_ATTACK_TIER_THRESHOLDS,
  absorbMs: 180,
  heroPuff: 0.04,
  heroPushPx: 8,
  lift: 0.12,
  filmSpin: 0.0012,
  sheenAlpha: 0.85,
  dropGravity: 900,
  dropSpeed: 360,
  floatPx: 4,
  knockPx: 8,
  squash: 0.08,
  shakeMs: 260,
  zoomOutMs: 340,
  reducedFadeMs: 260,
  colorFilm: '#ffffff',
  colorPink: '#ffb3d9',
  colorMint: '#aef5d8',
  colorLilac: '#c9b6ff',
  colorSky: '#9fdcff',
  colorPlayer: '#c9b6ff',
  colorFoe: '#ff8fb3',
  sfxBlowClip: 'triggerglow', sfxBlowGain: 0.3, sfxBlowRate: 1.3,
  sfxBlipClip: 'clickthock', sfxBlipGain: 0.35, sfxBlipRate: 2.1,
  sfxStretchClip: 'uihover', sfxStretchGain: 0.3, sfxStretchRate: 0.7,
  sfxPopClip: 'fx/oona-splat', sfxPopGain: 0.55, sfxPopRate: 1.9,
  sfxSplashClip: 'fx/oona-splat', sfxSplashGain: 0.45, sfxSplashRate: 1.25,
  sfxDuck: 0.6,
  previewDamage: 12,
  previewParts: 4,
  ...levelDefaults,
};

const GLOBAL_RANGES: Record<Exclude<keyof GlobalConfig, HeroBubbleStrKey>, [number, number, number]> = {
  tier2At: [2, 40, 1], tier3At: [2, 60, 1], tier4At: [2, 80, 1],
  absorbMs: [60, 600, 10],
  heroPuff: [0, 0.2, 0.005],
  heroPushPx: [0, 40, 1],
  lift: [0, 0.5, 0.01],
  filmSpin: [0, 0.01, 0.0001],
  sheenAlpha: [0, 1, 0.01],
  dropGravity: [0, 3000, 20],
  dropSpeed: [50, 1200, 10],
  floatPx: [0, 20, 0.5],
  knockPx: [0, 60, 1],
  squash: [0, 0.3, 0.01],
  shakeMs: [0, 1200, 10],
  zoomOutMs: [60, 1500, 10],
  reducedFadeMs: [60, 1000, 10],
  sfxBlowGain: [0, 2, 0.05], sfxBlowRate: [0.5, 2.5, 0.01],
  sfxBlipGain: [0, 2, 0.05], sfxBlipRate: [0.5, 2.5, 0.01],
  sfxStretchGain: [0, 2, 0.05], sfxStretchRate: [0.3, 2.5, 0.01],
  sfxPopGain: [0, 2, 0.05], sfxPopRate: [0.5, 2.5, 0.01],
  sfxSplashGain: [0, 2, 0.05], sfxSplashRate: [0.5, 2.5, 0.01],
  sfxDuck: [0, 1, 0.05],
  previewDamage: [1, 60, 1],
  previewParts: [1, 8, 1],
};

export const HERO_BUBBLE_RANGES: Record<HeroBubbleNumKey, [number, number, number]> = {
  ...GLOBAL_RANGES,
  ...(Object.fromEntries(BUBBLE_LEVELS.flatMap((l) => BUBBLE_LEVEL_SUFFIXES.map((s) => [`${l}${s}`, BUBBLE_LEVEL_RANGES[s]]))) as Record<LevelKey, [number, number, number]>),
};

export const BUBBLE_CAPS = { stream: 10, drops: 50, tinies: 30, shakePx: 30, zoom: 0.1 } as const;

const store = configStore<HeroBubbleConfig>({
  key: 'ascent.herobubble.v1', defaults: HERO_BUBBLE_DEFAULTS, ranges: HERO_BUBBLE_RANGES,
  colorKeys: HERO_BUBBLE_COLOR_KEYS, clipKeys: HERO_BUBBLE_CLIP_KEYS, previewKeys: ['previewDamage', 'previewParts'],
});
export const heroBubbleStore = store;
export const getHeroBubbleConfig = store.get;
export const clampHeroBubbleValue = store.clamp;
export const sanitizeHeroBubbleConfig = store.sanitize;
export const heroBubbleConfigJson = store.json;
/** The preview speed hook (Recruit + the Collection read one per style). Always 1: the Rare tuners have none. */
export function heroBubblePreviewSpeed(): number { return 1; }

export function bubbleLevelDials(level: BubbleLevel, c: HeroBubbleConfig = store.get()): Record<BubbleLevelSuffix, number> {
  return Object.fromEntries(BUBBLE_LEVEL_SUFFIXES.map((s) => [s, c[`${level}${s}`]])) as Record<BubbleLevelSuffix, number>;
}

// ─── the pure plan ─────────────────────────────────────────────────────────────────────────────────────────────

export const BUBBLE_REF_DISTANCE = 1600;

/** A drift for a distance: the level's time, scaled gently by the distance. */
export function bubbleDriftMs(distance: number, levelMs: number): number {
  const d = Number.isFinite(distance) && distance > 0 ? distance : BUBBLE_REF_DISTANCE;
  return Math.round(levelMs * clamp(Math.sqrt(d / BUBBLE_REF_DISTANCE), 0.62, 1.15));
}

export interface BubbleStreamPlan { releaseAt: number; driftMs: number; popAt: number; size: number }

export interface BubblePlanInput extends AttackTierContext {
  leadIn?: number;
  total: number;
  distance: number;
  reduced?: boolean;
}

export interface BubblePlan {
  reduced: boolean;
  tier: TierNum;
  level: BubbleLevel;
  k: number;
  total: number;
  chargeAt: number;
  absorbEnd: number;
  /** The main bubble starts to swell at the hand. */
  blowAt: number;
  /** It leaves the hand. */
  releaseAt: number;
  /** It reaches the face. */
  arriveAt: number;
  /** It has swelled round the face. */
  engulfAt: number;
  /** Big: the little bubbles, in order (each pop is a tick). */
  stream: BubbleStreamPlan[];
  hits: number[];
  /** THE pop (the consequence). */
  impactAt: number;
  endAt: number;
  /** Drift size and engulf size, in the struck portrait's radii. */
  size: number;
  engulf: number;
  wobble: number;
  drops: number;
  tinies: number;
  splash: number;
  shakePx: number;
  zoom: number;
  punch: number;
  dim: number;
}

/** A small fixed pseudo-random per index (no state): the same stream scatters the same way. */
export const jitter = (i: number, salt: number): number => { const s = Math.sin((i + 1) * 12.9898 + salt * 78.233) * 43758.5453; return s - Math.floor(s) - 0.5; };

/** The whole Bubble Pop, in base ms. Pure and deterministic. */
export function bubblePlan(input: BubblePlanInput, c: HeroBubbleConfig = store.get()): BubblePlan {
  const total = Math.max(0, Math.round(input.total));
  const tier = attackTier(total, input, c); // a knockout always plays the shared Tier IV
  const level = bubbleLevel(tier);
  const L = bubbleLevelDials(level, c);
  const k = (tier - 1) / 3;
  const looks = {
    tier, level, k, total, size: L.BubbleSize, engulf: L.EngulfSize, wobble: L.Wobble,
    drops: Math.round(clamp(L.Drops, 0, BUBBLE_CAPS.drops)), tinies: Math.round(clamp(L.Tinies, 0, BUBBLE_CAPS.tinies)), splash: L.Splash,
    shakePx: clamp(L.Shake, 0, BUBBLE_CAPS.shakePx), zoom: clamp(L.Zoom, 0, BUBBLE_CAPS.zoom), punch: L.Punch, dim: L.Dim,
  };
  if (input.reduced) {
    const r = reducedAttackTimeline(input.leadIn ?? 0, c.reducedFadeMs);
    const at = r.impactAt;
    return {
      ...looks, reduced: true, chargeAt: at, absorbEnd: at, blowAt: at, releaseAt: at, arriveAt: at, engulfAt: at, stream: [], hits: [],
      impactAt: at, endAt: r.endAt, size: 0, drops: 0, tinies: 0, splash: 0, shakePx: 0, zoom: 0, punch: 0, dim: 0,
    };
  }
  const chargeAt = Math.max(0, input.leadIn ?? 0);
  const absorbEnd = chargeAt + c.absorbMs;
  const n = Math.round(clamp(L.Stream, 0, BUBBLE_CAPS.stream));
  const streamStart = chargeAt + c.absorbMs;
  const sDrift = bubbleDriftMs(input.distance, L.StreamMs);
  const stream: BubbleStreamPlan[] = Array.from({ length: n }, (_, i) => {
    const releaseAt = streamStart + i * L.StreamGapMs;
    const driftMs = Math.round(sDrift * (1 + 0.12 * jitter(i, 7)));
    return { releaseAt, driftMs, popAt: releaseAt + driftMs, size: 0.16 + 0.05 * jitter(i, 3) };
  });
  // The main bubble swells at the hand while the total sinks in (and behind the stream), then leaves.
  const blowAt = chargeAt + c.absorbMs * 0.5;
  const releaseAt = Math.max(blowAt + L.BlowMs, n ? stream[n - 1]!.releaseAt + L.StreamGapMs : 0);
  const arriveAt = releaseAt + bubbleDriftMs(input.distance, L.DriftMs);
  const engulfAt = arriveAt + L.EngulfMs;
  const impactAt = Math.max(engulfAt + L.HoldMs, n ? stream[n - 1]!.popAt + 60 : 0);
  const endAt = impactAt + Math.max(c.zoomOutMs * 0.8, 300) + L.SettleMs;
  return {
    ...looks, reduced: false, chargeAt, absorbEnd, blowAt, releaseAt, arriveAt, engulfAt, stream,
    hits: stream.map((b) => b.popAt).sort((a, b) => a - b), impactAt, endAt,
  };
}

export type BubbleCueKind = 'charge' | 'blow' | 'stream' | 'release' | 'hit' | 'engulf' | 'impact' | 'end';
export interface BubbleCue { at: number; kind: BubbleCueKind; i: number }

export function bubbleCues(p: BubblePlan): BubbleCue[] {
  const out: BubbleCue[] = [];
  if (!p.reduced) {
    out.push({ at: p.chargeAt, kind: 'charge', i: 0 });
    out.push({ at: p.blowAt, kind: 'blow', i: 0 });
    p.stream.forEach((b, i) => { out.push({ at: b.releaseAt, kind: 'stream', i }); out.push({ at: b.popAt, kind: 'hit', i }); });
    out.push({ at: p.releaseAt, kind: 'release', i: 0 });
    out.push({ at: p.arriveAt, kind: 'engulf', i: 0 });
  }
  out.push({ at: p.impactAt, kind: 'impact', i: 0 });
  out.push({ at: p.endAt, kind: 'end', i: 0 });
  const order: Record<BubbleCueKind, number> = { charge: 0, blow: 1, stream: 2, release: 3, hit: 4, engulf: 5, impact: 6, end: 7 };
  return out.sort((a, b) => a.at - b.at || order[a.kind] - order[b.kind]);
}

// ─── the drift (pure) ──────────────────────────────────────────────────────────────────────────────────────────

/** One bubble's drift: from `a` (the hand) to `b`, rising by `lift` of the distance mid-way and weaving `weave` px. */
export interface BubbleDrift { a: Pt; b: Pt; lift: number; weave: number; phase: number; ms: number }

/** Where a drifting bubble is at progress `u` (0..1): an eased glide, a floaty rise, a weave that settles on arrival. */
export function driftPos(m: BubbleDrift, u: number): Pt {
  const t = Math.min(1, Math.max(0, Number.isFinite(u) ? u : 0));
  const e = 0.5 - 0.5 * Math.cos(Math.PI * t);
  const dx = m.b.x - m.a.x, dy = m.b.y - m.a.y;
  const L = Math.hypot(dx, dy) || 1;
  const nx = -dy / L, ny = dx / L;
  const rise = -m.lift * L * Math.sin(Math.PI * e);
  const weave = m.weave * Math.sin(t * Math.PI * 3 + m.phase) * (1 - t);
  return { x: m.a.x + dx * e + nx * weave, y: m.a.y + dy * e + rise + ny * weave };
}

/** The hand: where bubbles are blown, on the attacker's rim toward the target. */
export function bubbleHand(a: Pt, d: Pt, aRadius: number): Pt {
  const L = Math.hypot(d.x - a.x, d.y - a.y) || 1;
  return { x: a.x + ((d.x - a.x) / L) * aRadius * 0.9, y: a.y + ((d.y - a.y) / L) * aRadius * 0.9 };
}

/**
 * Every drift, from the plan and the two heroes: the stream's little bubbles to scattered spots on the face, and the
 * main bubble to the CENTRE of the face (it engulfs it). Pure.
 */
export function bubbleDrifts(p: BubblePlan, a: Pt, d: Pt, radius: number, aRadius: number, lift: number): { main: BubbleDrift | null; stream: BubbleDrift[] } {
  if (p.reduced) return { main: null, stream: [] };
  const hand = bubbleHand(a, d, aRadius);
  const D = Math.hypot(d.x - hand.x, d.y - hand.y) || 1;
  const stream = p.stream.map((b, i) => {
    const ang = jitter(i, 11) * Math.PI * 2;
    const r = (0.2 + 0.3 * (jitter(i, 13) + 0.5)) * radius;
    return { a: hand, b: { x: d.x + Math.cos(ang) * r, y: d.y + Math.sin(ang) * r }, lift: lift * (0.6 + 0.8 * (jitter(i, 5) + 0.5)), weave: D * 0.025, phase: i * 1.7, ms: b.driftMs };
  });
  const main = { a: hand, b: { x: d.x, y: d.y }, lift, weave: D * 0.03, phase: 0.6, ms: p.arriveAt - p.releaseAt };
  return { main, stream };
}

// ─── the camera (pure) ─────────────────────────────────────────────────────────────────────────────────────────

const sine = (u: number): number => 0.5 - 0.5 * Math.cos(Math.PI * Math.min(1, Math.max(0, u)));
const springAt = (ms: number, hz: number, tau: number): number => (ms < 0 ? 0 : Math.exp(-ms / tau) * Math.cos(2 * Math.PI * hz * (ms / 1000)));

/** The camera: a soft push in while the bubble is blown, a little more as it engulfs, a gentle punch and shake on the pop. */
export function bubbleCameraAt(p: BubblePlan, c: HeroBubbleConfig, t: number): { zoom: number; x: number; y: number } {
  if (p.reduced) return { zoom: 1, x: 0, y: 0 };
  let z = 0;
  if (t >= p.chargeAt && t < p.impactAt) {
    z += p.zoom * sine((t - p.chargeAt) / Math.max(1, p.releaseAt - p.chargeAt));
    if (t >= p.arriveAt) z += p.zoom * 0.5 * sine((t - p.arriveAt) / Math.max(1, p.impactAt - p.arriveAt));
  } else if (t >= p.impactAt) z += (p.zoom * 1.5 + p.punch) * Math.exp(-(t - p.impactAt) / Math.max(1, c.zoomOutMs / 4));
  // The pop shakes both ways (it bursts outward, it does not travel along a line).
  const age = t - p.impactAt;
  let x = 0, y = 0;
  if (age >= 0) {
    const env = Math.exp(-age / Math.max(1, c.shakeMs / 4));
    x = p.shakePx * 0.8 * env * Math.sin(age * 0.11 + 0.4);
    y = p.shakePx * env * Math.cos(age * 0.097);
  }
  for (const at of p.hits) { const s = springAt(t - at, 18, 35); y += p.shakePx * 0.15 * s; }
  return { zoom: 1 + Math.max(0, z), x, y };
}

/** The anchor: the attacker while blowing, following the drift, the defender from the arrival. */
export function bubbleCameraFocus(p: BubblePlan, t: number, a: Pt, d: Pt): Pt {
  if (t <= p.releaseAt) return a;
  if (t >= p.arriveAt) return d;
  const e = sine((t - p.releaseAt) / Math.max(1, p.arriveAt - p.releaseAt));
  return { x: a.x + (d.x - a.x) * e, y: a.y + (d.y - a.y) * e };
}
