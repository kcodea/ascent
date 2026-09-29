/**
 * THE BOOMERANG HERO ATTACK (a RARE): its tuned values, its pure timeline, the pure flight paths and the pure camera.
 *
 * Owner 2026-09-29: "build 5 animations that range from rare -> epic ... rare and epics should only have 2 or 3 tiers to
 * them and generally be less exciting, but still extremely clean and fun. get creative".
 *
 * ONE CLEAR IDEA: a carved wooden boomerang whirls out on a curved path, THWACKS the struck hero, and curves back round
 * to the hero, who catches it with a little pop.
 *
 * TWO VISUAL TIERS (a Rare has two). The shared four map onto them here (`boomerangLevel`): I-II play SMALL, III-IV
 * play BIG, so a knockout (which always forces the shared Tier IV) plays BIG.
 *  - SMALL: one boomerang: out on one side of the line, THWACK (THE impact), back round the other side, caught.
 *  - BIG: two, thrown a beat apart from either hand on CROSSING paths (each swings wide on its own side and lands on
 *    the other side of the face, so they cross in an X), a double
 *    thwack (the first a tick, the second THE impact), and both curve home crossing again and are caught in turn.
 *
 * THE BEATS: the shared damage formation (its end is this style's start); READY (the total sinks in, the hero winds back);
 * THROW; THWACK (the consequence lands ONCE, on the last one); the return and the catch are looks only (they happen after
 * the blow). No hit-stop anywhere. Reduced motion: no flight, shake or zoom; the numbers fade and the blow lands.
 */
import { configStore } from '../heroAttack/configStore';
import { clamp, type Pt } from '../heroAttack/easing';
import {
  HERO_ATTACK_TIER_THRESHOLDS, reducedAttackTimeline, attackTier, type AttackTierContext, type TierNum,
} from '../heroAttack/tiers';

export type { TierNum };

export const BOOMERANG_LEVELS = ['small', 'big'] as const;
export type BoomerangLevel = (typeof BOOMERANG_LEVELS)[number];

/** The shared four tiers onto this Rare's two: I-II small, III-IV big (a knockout forces IV, so it plays big). */
export function boomerangLevel(tier: TierNum): BoomerangLevel { return tier >= 3 ? 'big' : 'small'; }

export const BOOMERANG_LEVEL_SUFFIXES = [
  'ReadyMs', 'OutMs', 'BackMs', 'Bulge', 'Count', 'StaggerMs', 'Size', 'SpinHz', 'Chips', 'Shake', 'Zoom', 'Punch', 'SettleMs', 'Dim',
] as const;
export type BoomerangLevelSuffix = (typeof BOOMERANG_LEVEL_SUFFIXES)[number];
type LevelKey = `${BoomerangLevel}${BoomerangLevelSuffix}`;

interface GlobalConfig {
  tier2At: number; tier3At: number; tier4At: number;
  absorbMs: number;
  heroWindPx: number;
  heroThrowPx: number;
  catchPop: number;
  catchMs: number;
  boomPx: number;
  trailMs: number;
  trailWidth: number;
  whirl: number;
  thwackSize: number;
  knockPx: number;
  squash: number;
  shakeMs: number;
  zoomOutMs: number;
  reducedFadeMs: number;
  colorWood: string;
  colorGrain: string;
  colorTeal: string;
  colorTealDeep: string;
  colorFlash: string;
  colorPlayer: string;
  colorFoe: string;
  sfxThrowClip: string; sfxThrowGain: number; sfxThrowRate: number;
  sfxWhirlClip: string; sfxWhirlGain: number; sfxWhirlRate: number;
  sfxThwackClip: string; sfxThwackGain: number; sfxThwackRate: number;
  sfxKnockClip: string; sfxKnockGain: number; sfxKnockRate: number;
  sfxCatchClip: string; sfxCatchGain: number; sfxCatchRate: number;
  sfxDuck: number;
  previewDamage: number;
  previewParts: number;
}
export type HeroBoomerangConfig = GlobalConfig & Record<LevelKey, number>;

export const HERO_BOOMERANG_COLOR_KEYS = ['colorWood', 'colorGrain', 'colorTeal', 'colorTealDeep', 'colorFlash', 'colorPlayer', 'colorFoe'] as const;
export const HERO_BOOMERANG_CLIP_KEYS = ['sfxThrowClip', 'sfxWhirlClip', 'sfxThwackClip', 'sfxKnockClip', 'sfxCatchClip'] as const;
export type HeroBoomerangStrKey = (typeof HERO_BOOMERANG_COLOR_KEYS)[number] | (typeof HERO_BOOMERANG_CLIP_KEYS)[number];
export type HeroBoomerangNumKey = Exclude<keyof HeroBoomerangConfig, HeroBoomerangStrKey>;

const LEVEL_DEFAULTS: Record<BoomerangLevelSuffix, [number, number]> = {
  ReadyMs: [280, 320],
  OutMs: [440, 460],
  BackMs: [520, 540],
  Bulge: [0.22, 0.26],
  Count: [1, 2],
  StaggerMs: [0, 130],
  Size: [1, 0.95],
  SpinHz: [4.5, 5],
  Chips: [6, 9],
  Shake: [5, 8],
  Zoom: [0.02, 0.035],
  Punch: [0.015, 0.03],
  SettleMs: [180, 220],
  Dim: [0.08, 0.2],
};

export const BOOMERANG_LEVEL_RANGES: Record<BoomerangLevelSuffix, [number, number, number]> = {
  ReadyMs: [60, 1200, 10],
  OutMs: [150, 1200, 10],
  BackMs: [150, 1500, 10],
  Bulge: [0, 0.6, 0.01],
  Count: [1, 2, 1],
  StaggerMs: [0, 500, 5],
  Size: [0.4, 2.5, 0.05],
  SpinHz: [0, 12, 0.25],
  Chips: [0, 24, 1],
  Shake: [0, 30, 0.5],
  Zoom: [0, 0.1, 0.002],
  Punch: [0, 0.08, 0.001],
  SettleMs: [0, 1500, 10],
  Dim: [0, 0.6, 0.01],
};

const levelDefaults = Object.fromEntries(BOOMERANG_LEVELS.flatMap((l, i) => BOOMERANG_LEVEL_SUFFIXES.map((s) => [`${l}${s}`, LEVEL_DEFAULTS[s][i]]))) as Record<LevelKey, number>;

export const HERO_BOOMERANG_DEFAULTS: HeroBoomerangConfig = {
  ...HERO_ATTACK_TIER_THRESHOLDS,
  absorbMs: 180,
  heroWindPx: 10,
  heroThrowPx: 12,
  catchPop: 0.07,
  catchMs: 180,
  boomPx: 74,
  trailMs: 120,
  trailWidth: 12,
  whirl: 0.3,
  thwackSize: 1,
  knockPx: 14,
  squash: 0.07,
  shakeMs: 280,
  zoomOutMs: 340,
  reducedFadeMs: 260,
  colorWood: '#d0914f',
  colorGrain: '#6b3f1d',
  colorTeal: '#2de0c8',
  colorTealDeep: '#0f7f86',
  colorFlash: '#f4fffb',
  colorPlayer: '#7fffe6',
  colorFoe: '#ff7a5c',
  sfxThrowClip: 'fx/stereogenicstudio-swish-swoosh-woosh-sfx-27-357164-3', sfxThrowGain: 0.45, sfxThrowRate: 1.2,
  sfxWhirlClip: 'fx/metal-woosh', sfxWhirlGain: 0.28, sfxWhirlRate: 1.35,
  sfxThwackClip: 'smack1', sfxThwackGain: 0.6, sfxThwackRate: 1.05,
  sfxKnockClip: 'clickthock', sfxKnockGain: 0.45, sfxKnockRate: 0.85,
  sfxCatchClip: 'cardlanding', sfxCatchGain: 0.45, sfxCatchRate: 1.25,
  sfxDuck: 0.6,
  previewDamage: 12,
  previewParts: 4,
  ...levelDefaults,
};

const GLOBAL_RANGES: Record<Exclude<keyof GlobalConfig, HeroBoomerangStrKey>, [number, number, number]> = {
  tier2At: [2, 40, 1], tier3At: [2, 60, 1], tier4At: [2, 80, 1],
  absorbMs: [60, 600, 10],
  heroWindPx: [0, 40, 1],
  heroThrowPx: [0, 50, 1],
  catchPop: [0, 0.3, 0.005],
  catchMs: [60, 600, 10],
  boomPx: [24, 200, 1],
  trailMs: [0, 400, 5],
  trailWidth: [1, 40, 0.5],
  whirl: [0, 1, 0.01],
  thwackSize: [0.3, 3, 0.05],
  knockPx: [0, 60, 1],
  squash: [0, 0.3, 0.01],
  shakeMs: [0, 1200, 10],
  zoomOutMs: [60, 1500, 10],
  reducedFadeMs: [60, 1000, 10],
  sfxThrowGain: [0, 2, 0.05], sfxThrowRate: [0.5, 2.5, 0.01],
  sfxWhirlGain: [0, 2, 0.05], sfxWhirlRate: [0.5, 2.5, 0.01],
  sfxThwackGain: [0, 2, 0.05], sfxThwackRate: [0.5, 2.5, 0.01],
  sfxKnockGain: [0, 2, 0.05], sfxKnockRate: [0.5, 2.5, 0.01],
  sfxCatchGain: [0, 2, 0.05], sfxCatchRate: [0.5, 2.5, 0.01],
  sfxDuck: [0, 1, 0.05],
  previewDamage: [1, 60, 1],
  previewParts: [1, 8, 1],
};

export const HERO_BOOMERANG_RANGES: Record<HeroBoomerangNumKey, [number, number, number]> = {
  ...GLOBAL_RANGES,
  ...(Object.fromEntries(BOOMERANG_LEVELS.flatMap((l) => BOOMERANG_LEVEL_SUFFIXES.map((s) => [`${l}${s}`, BOOMERANG_LEVEL_RANGES[s]]))) as Record<LevelKey, [number, number, number]>),
};

export const BOOMERANG_CAPS = { count: 2, chips: 24, shakePx: 30, zoom: 0.1 } as const;

const store = configStore<HeroBoomerangConfig>({
  key: 'ascent.heroboomerang.v1', defaults: HERO_BOOMERANG_DEFAULTS, ranges: HERO_BOOMERANG_RANGES,
  colorKeys: HERO_BOOMERANG_COLOR_KEYS, clipKeys: HERO_BOOMERANG_CLIP_KEYS, previewKeys: ['previewDamage', 'previewParts'],
});
export const heroBoomerangStore = store;
export const getHeroBoomerangConfig = store.get;
export const clampHeroBoomerangValue = store.clamp;
export const sanitizeHeroBoomerangConfig = store.sanitize;
export const heroBoomerangConfigJson = store.json;
/** The preview speed hook (Recruit + the Collection read one per style). Always 1: the Rare tuners have none. */
export function heroBoomerangPreviewSpeed(): number { return 1; }

export function boomerangLevelDials(level: BoomerangLevel, c: HeroBoomerangConfig = store.get()): Record<BoomerangLevelSuffix, number> {
  return Object.fromEntries(BOOMERANG_LEVEL_SUFFIXES.map((s) => [s, c[`${level}${s}`]])) as Record<BoomerangLevelSuffix, number>;
}

// ─── the pure plan ─────────────────────────────────────────────────────────────────────────────────────────────

export const BOOMERANG_REF_DISTANCE = 1600;

/** A leg for a distance: the level's time, scaled gently by the distance. */
export function boomerangLegMs(distance: number, levelMs: number): number {
  const d = Number.isFinite(distance) && distance > 0 ? distance : BOOMERANG_REF_DISTANCE;
  return Math.round(levelMs * clamp(Math.sqrt(d / BOOMERANG_REF_DISTANCE), 0.62, 1.15));
}

export interface BoomerangThrow {
  throwAt: number;
  outMs: number;
  backMs: number;
  /** It thwacks the target. */
  arriveAt: number;
  /** It is caught. */
  catchAt: number;
  /** Which side of the line it leaves from (+1 / -1; 0 = the centre, a single throw). */
  side: number;
}

export interface BoomerangPlanInput extends AttackTierContext {
  leadIn?: number;
  total: number;
  distance: number;
  reduced?: boolean;
}

export interface BoomerangPlan {
  reduced: boolean;
  tier: TierNum;
  level: BoomerangLevel;
  k: number;
  total: number;
  chargeAt: number;
  absorbEnd: number;
  throwAt: number;
  throws: BoomerangThrow[];
  /** Thwacks BEFORE the impact (ticks). */
  hits: number[];
  impactAt: number;
  catches: number[];
  endAt: number;
  size: number;
  bulge: number;
  spinHz: number;
  chips: number;
  shakePx: number;
  zoom: number;
  punch: number;
  dim: number;
}

/** The whole Boomerang, in base ms. Pure and deterministic. */
export function boomerangPlan(input: BoomerangPlanInput, c: HeroBoomerangConfig = store.get()): BoomerangPlan {
  const total = Math.max(0, Math.round(input.total));
  const tier = attackTier(total, input, c); // a knockout always plays the shared Tier IV
  const level = boomerangLevel(tier);
  const L = boomerangLevelDials(level, c);
  const k = (tier - 1) / 3;
  const base = {
    tier, level, k, total, size: L.Size, bulge: L.Bulge, spinHz: L.SpinHz, chips: Math.round(clamp(L.Chips, 0, BOOMERANG_CAPS.chips)),
    shakePx: clamp(L.Shake, 0, BOOMERANG_CAPS.shakePx), zoom: clamp(L.Zoom, 0, BOOMERANG_CAPS.zoom), punch: L.Punch, dim: L.Dim,
  };
  if (input.reduced) {
    const r = reducedAttackTimeline(input.leadIn ?? 0, c.reducedFadeMs);
    const at = r.impactAt;
    return {
      ...base, reduced: true, chargeAt: at, absorbEnd: at, throwAt: at, throws: [], hits: [], impactAt: at, catches: [], endAt: r.endAt,
      size: 0, chips: 0, shakePx: 0, zoom: 0, punch: 0, dim: 0,
    };
  }
  const chargeAt = Math.max(0, input.leadIn ?? 0);
  const absorbEnd = chargeAt + c.absorbMs;
  const throwAt = chargeAt + Math.max(L.ReadyMs, c.absorbMs);
  const n = clamp(Math.round(L.Count), 1, BOOMERANG_CAPS.count);
  const outMs = boomerangLegMs(input.distance, L.OutMs);
  const backMs = boomerangLegMs(input.distance, L.BackMs);
  // A pair leaves a beat apart (at least 90 ms, so the two thwacks read as two).
  const stagger = n > 1 ? Math.max(90, L.StaggerMs) : 0;
  const throws: BoomerangThrow[] = Array.from({ length: n }, (_, i) => {
    const at = throwAt + i * stagger;
    return { throwAt: at, outMs, backMs, arriveAt: at + outMs, catchAt: at + outMs + backMs, side: n === 1 ? 0 : (i === 0 ? 1 : -1) };
  });
  const impactAt = throws[n - 1]!.arriveAt;
  const catches = throws.map((t) => t.catchAt);
  const endAt = Math.max(impactAt + c.zoomOutMs * 0.8, catches[catches.length - 1]! + c.catchMs) + L.SettleMs;
  return {
    ...base, reduced: false, chargeAt, absorbEnd, throwAt, throws, hits: throws.slice(0, -1).map((t) => t.arriveAt), impactAt, catches, endAt,
  };
}

export type BoomerangCueKind = 'charge' | 'throw' | 'hit' | 'impact' | 'catch' | 'end';
export interface BoomerangCue { at: number; kind: BoomerangCueKind; i: number }

export function boomerangCues(p: BoomerangPlan): BoomerangCue[] {
  const out: BoomerangCue[] = [];
  if (!p.reduced) {
    out.push({ at: p.chargeAt, kind: 'charge', i: 0 });
    p.throws.forEach((t, i) => out.push({ at: t.throwAt, kind: 'throw', i }));
    p.hits.forEach((at, i) => out.push({ at, kind: 'hit', i }));
    p.catches.forEach((at, i) => out.push({ at, kind: 'catch', i }));
  }
  out.push({ at: p.impactAt, kind: 'impact', i: p.throws.length - 1 });
  out.push({ at: p.endAt, kind: 'end', i: 0 });
  const order: Record<BoomerangCueKind, number> = { charge: 0, throw: 1, hit: 2, impact: 3, catch: 4, end: 5 };
  return out.sort((a, b) => a.at - b.at || order[a.kind] - order[b.kind]);
}

// ─── the flight (pure) ─────────────────────────────────────────────────────────────────────────────────────────

/** One boomerang's whole flight: out from `rel` bowing through `co` to the thwack at `hit`, back through `cb`. */
export interface BoomerangMotion { rel: Pt; co: Pt; hit: Pt; cb: Pt; outMs: number; backMs: number; spin: number; arrive: Pt }

function quad(a: Pt, c: Pt, b: Pt, e: number): Pt {
  const m = 1 - e;
  return { x: m * m * a.x + 2 * m * e * c.x + e * e * b.x, y: m * m * a.y + 2 * m * e * c.y + e * e * b.y };
}

/** Out: flung hard and still quick into the thwack. */
export const outEase = (u: number): number => { const t = Math.min(1, Math.max(0, Number.isFinite(u) ? u : 0)); return 0.8 * t + 0.2 * t * t; };
/** Back: it rebounds off the face with pace, swings wide and slows into the hand. */
export const backEase = (u: number): number => { const t = Math.min(1, Math.max(0, Number.isFinite(u) ? u : 0)); return 0.55 * t + 0.45 * (0.5 - 0.5 * Math.cos(Math.PI * t)); };

/**
 * Every boomerang's flight, from the plan and the two heroes. A single one bows toward the TOP of the screen on the way
 * out and swings back round the other side (a loop). A pair leaves from either side of the hero, each swings wide on its
 * OWN side and lands on the OTHER side of the face, so the two cross in an X on the way in (mirror images), and again on
 * the way home. `avoid`
 * is where the big -N pops (the thwacks land clear of it). Pure.
 */
export function boomerangMotions(p: BoomerangPlan, a: Pt, d: Pt, radius: number, aRadius: number, ceilY = Number.NEGATIVE_INFINITY, avoid: Pt | null = null): BoomerangMotion[] {
  if (p.reduced) return [];
  const L = Math.hypot(d.x - a.x, d.y - a.y) || 1;
  const u = { x: (d.x - a.x) / L, y: (d.y - a.y) / L };
  const nrm = { x: -u.y, y: u.x };
  const up = nrm.y > 0 ? -1 : 1; // +1 * up * nrm points toward the top of the screen
  let back = Math.atan2(a.y - d.y, a.x - d.x);
  if (avoid && Math.hypot(avoid.x - d.x, avoid.y - d.y) > 1) {
    const av = Math.atan2(avoid.y - d.y, avoid.x - d.x);
    let diff = Math.atan2(Math.sin(back - av), Math.cos(back - av));
    if (Math.abs(diff) < 1.0 && p.throws.length === 1) { diff = (diff === 0 ? 1 : Math.sign(diff)) * 1.0; back = av + diff; }
  }
  return p.throws.map((t) => {
    const s = t.side;
    const rel = { x: a.x + u.x * aRadius * 0.8 + nrm.x * up * s * aRadius * 0.4, y: a.y + u.y * aRadius * 0.8 + nrm.y * up * s * aRadius * 0.4 };
    // One thwacks the near side of the face. A pair crosses over: the one from the top lands low, the one from the
    // bottom lands high (either side of the middle), so the two paths make a clean X.
    const bx = Math.cos(back), by = Math.sin(back);
    const hx = bx * 0.8 - s * up * nrm.x * 0.75, hy = by * 0.8 - s * up * nrm.y * 0.75;
    const hl = Math.hypot(hx, hy) || 1;
    const r = (s === 0 ? 0.42 : 0.45) * radius;
    const hit = { x: d.x + (hx / hl) * r, y: d.y + (hy / hl) * r };
    const D = Math.hypot(hit.x - rel.x, hit.y - rel.y) || 1;
    const mid = { x: (rel.x + hit.x) / 2, y: (rel.y + hit.y) / 2 };
    // Out swings wide on its own side (a single one: toward the top); back swings round the far side.
    const outSide = s === 0 ? 1 : s;
    const co = { x: mid.x + nrm.x * up * outSide * p.bulge * D, y: Math.max(ceilY, mid.y + nrm.y * up * outSide * p.bulge * D) };
    const cb = { x: mid.x - nrm.x * up * outSide * p.bulge * 0.9 * D, y: Math.max(ceilY, mid.y - nrm.y * up * outSide * p.bulge * 0.9 * D) };
    const ax = hit.x - co.x, ay = hit.y - co.y;
    const al = Math.hypot(ax, ay) || 1;
    // Spun so the leading arm sweeps forward: clockwise flying right, anticlockwise flying left.
    const spin = u.x >= 0 ? 1 : -1;
    return { rel, co, hit, cb, outMs: t.outMs, backMs: t.backMs, spin, arrive: { x: ax / al, y: ay / al } };
  });
}

/** Where a boomerang is `t` ms after its throw (held in the hand after the catch). Pure. */
export function boomerangPos(m: BoomerangMotion, t: number): Pt {
  if (t <= 0) return { x: m.rel.x, y: m.rel.y };
  if (t < m.outMs) return quad(m.rel, m.co, m.hit, outEase(t / m.outMs));
  if (t < m.outMs + m.backMs) return quad(m.hit, m.cb, m.rel, backEase((t - m.outMs) / m.backMs));
  return { x: m.rel.x, y: m.rel.y };
}

// ─── the camera (pure) ─────────────────────────────────────────────────────────────────────────────────────────

const springAt = (ms: number, hz: number, tau: number): number => (ms < 0 ? 0 : Math.exp(-ms / tau) * Math.cos(2 * Math.PI * hz * (ms / 1000)));
const sine = (u: number): number => 0.5 - 0.5 * Math.cos(Math.PI * Math.min(1, Math.max(0, u)));

/** The camera: a small push in through the ready, a kick on the tick thwack, a punch and shake on the impact. Pure. */
export function boomerangCameraAt(p: BoomerangPlan, c: HeroBoomerangConfig, t: number, dir: Pt = { x: 1, y: 0 }): { zoom: number; x: number; y: number } {
  if (p.reduced) return { zoom: 1, x: 0, y: 0 };
  let z = 0;
  if (t >= p.chargeAt && t < p.impactAt) z += p.zoom * sine((t - p.chargeAt) / Math.max(1, p.throwAt - p.chargeAt));
  else if (t >= p.impactAt) z += (p.zoom + p.punch) * Math.exp(-(t - p.impactAt) / Math.max(1, c.zoomOutMs / 4));
  let x = 0, y = 0;
  const kick = (at: number, amp: number, tau: number, hz: number): void => { const s = springAt(t - at, hz, tau); x += dir.x * amp * s; y += dir.y * amp * s; };
  kick(p.throwAt, -p.shakePx * 0.12, 40, 14);
  for (const at of p.hits) kick(at, p.shakePx * 0.4, 40, 18);
  kick(p.impactAt, p.shakePx, Math.max(1, c.shakeMs / 4), 16);
  return { zoom: 1 + Math.max(0, z), x, y };
}

/** The anchor: the attacker through the ready, following the throw, the defender from the thwack, home for the catch. */
export function boomerangCameraFocus(p: BoomerangPlan, t: number, a: Pt, d: Pt): Pt {
  const first = p.throws[0]?.arriveAt ?? p.impactAt;
  if (t <= p.throwAt) return a;
  if (t < first) { const e = sine((t - p.throwAt) / Math.max(1, first - p.throwAt)); return { x: a.x + (d.x - a.x) * e, y: a.y + (d.y - a.y) * e }; }
  return d;
}
