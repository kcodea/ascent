/**
 * THE BLAST HERO ATTACK: its tuned values and its pure timeline (owner ask 2026-09-28: "instead of the hero
 * attacking for this animation, i want the numbers to all combine, and then the screen slightly shakes and zooms
 * as he blasts pixi blasts from the hero to the opponent to deal the damage").
 *
 * THE BEATS (base ms, before the playback speed):
 *  1. COMBINE. Each contributing number (the attacker's tier, then every surviving minion's tier) pops in where it
 *     comes from, pulls back a touch, and flies on an arc into one point. Each arrival ticks the total up with a
 *     squash; the last one lands the final value (the ENGINE's number, never a DOM sum) with a big pop.
 *  2. CHARGE. The total is absorbed into the attacking hero, which gathers light. The view starts pushing in.
 *  3. FIRE. A volley of bolts leaves the hero (muzzle flash each), trails behind them, curving slightly.
 *  4. IMPACT. The lead bolt lands: hit flash, shockwave, sparks, a zoom punch and a decaying shake. THIS is the beat
 *     the consequence lands on (the red damage number, the Armor absorb, the Resolve drop). Trailing bolts add
 *     smaller hits. Then the view settles back.
 *
 * Bigger blows read bigger (more bolts, bigger bolts, more sparks, a harder shake and push), all inside caps.
 * Reduced motion drops the flight, the bolts, the shake and the zoom: the total fades in, the blow lands, it fades.
 *
 * Tuner convention (the crate's): localStorage in DEV only, values clamped on write and on load; production always
 * plays DEFAULTS. The preview speed is how you are LOOKING and is never saved.
 */

export interface HeroBlastConfig {
  // Combine
  popInMs: number;
  combineStaggerMs: number;
  combineFlyMs: number;
  combineBackPx: number;
  combineArc: number;
  combineBias: number;
  mergePop: number;
  mergeHoldMs: number;
  // Charge
  absorbMs: number;
  chargeMs: number;
  chargeMotes: number;
  // Bolts
  boltsMin: number;
  boltsMax: number;
  boltSpeed: number;
  boltStaggerMs: number;
  boltSizeMin: number;
  boltSizeMax: number;
  boltCurve: number;
  trailDensity: number;
  // Impact + camera
  bigDamage: number;
  flashSize: number;
  flashAlpha: number;
  sparksMin: number;
  sparksMax: number;
  shakeMin: number;
  shakeMax: number;
  shakeMs: number;
  zoomMin: number;
  zoomMax: number;
  zoomPunch: number;
  zoomOutMs: number;
  settleMs: number;
  reducedFadeMs: number;
  // Colours
  colorCore: string;
  colorBolt: string;
  colorImpact: string;
  // Sound gains (x the mix)
  sfxGatherGain: number;
  sfxCountGain: number;
  sfxMergeGain: number;
  sfxChargeGain: number;
  sfxFireGain: number;
  sfxImpactGain: number;
  sfxSmackGain: number;
  // Preview only (the tuner's Play buttons). Never read by a real fight, and left out of Copy JSON.
  previewDamage: number;
  previewParts: number;
}

type ColorKey = 'colorCore' | 'colorBolt' | 'colorImpact';
export type HeroBlastNumKey = Exclude<keyof HeroBlastConfig, ColorKey>;
export const HERO_BLAST_COLOR_KEYS: readonly ColorKey[] = ['colorCore', 'colorBolt', 'colorImpact'];

export const HERO_BLAST_DEFAULTS: HeroBlastConfig = {
  popInMs: 150,
  combineStaggerMs: 70,
  combineFlyMs: 400,
  combineBackPx: 16,
  combineArc: 0.16,
  combineBias: 0,
  mergePop: 1.4,
  mergeHoldMs: 170,
  absorbMs: 200,
  chargeMs: 260,
  chargeMotes: 22,
  boltsMin: 1,
  boltsMax: 5,
  boltSpeed: 3400,
  boltStaggerMs: 55,
  boltSizeMin: 0.8,
  boltSizeMax: 1.5,
  boltCurve: 0.12,
  trailDensity: 1,
  bigDamage: 15,
  flashSize: 1,
  flashAlpha: 0.9,
  sparksMin: 12,
  sparksMax: 34,
  shakeMin: 2,
  shakeMax: 9,
  shakeMs: 320,
  zoomMin: 0.018,
  zoomMax: 0.05,
  zoomPunch: 0.014,
  zoomOutMs: 380,
  settleMs: 360,
  reducedFadeMs: 320,
  colorCore: '#fff4d6',
  colorBolt: '#ffb43c',
  colorImpact: '#ff6a2a',
  sfxGatherGain: 0.8,
  sfxCountGain: 0.8,
  sfxMergeGain: 1,
  sfxChargeGain: 0.6,
  sfxFireGain: 0.7,
  sfxImpactGain: 1,
  sfxSmackGain: 0.55,
  previewDamage: 8,
  previewParts: 4,
};

/** [min, max, step] per numeric key. Values outside are clamped on write AND on load. */
export const HERO_BLAST_RANGES: Record<HeroBlastNumKey, [number, number, number]> = {
  popInMs: [0, 600, 10],
  combineStaggerMs: [0, 300, 5],
  combineFlyMs: [120, 1200, 10],
  combineBackPx: [0, 60, 1],
  combineArc: [0, 0.5, 0.01],
  combineBias: [0, 1, 0.05],
  mergePop: [1, 2, 0.01],
  mergeHoldMs: [0, 800, 10],
  absorbMs: [60, 800, 10],
  chargeMs: [60, 1000, 10],
  chargeMotes: [0, 60, 1],
  boltsMin: [1, 8, 1],
  boltsMax: [1, 8, 1],
  boltSpeed: [800, 8000, 50],
  boltStaggerMs: [0, 200, 5],
  boltSizeMin: [0.3, 3, 0.05],
  boltSizeMax: [0.3, 3, 0.05],
  boltCurve: [0, 0.4, 0.01],
  trailDensity: [0, 3, 0.05],
  bigDamage: [2, 40, 1],
  flashSize: [0.2, 3, 0.05],
  flashAlpha: [0, 1, 0.01],
  sparksMin: [0, 80, 1],
  sparksMax: [0, 80, 1],
  shakeMin: [0, 20, 0.5],
  shakeMax: [0, 20, 0.5],
  shakeMs: [0, 1000, 10],
  zoomMin: [0, 0.12, 0.002],
  zoomMax: [0, 0.12, 0.002],
  zoomPunch: [0, 0.06, 0.001],
  zoomOutMs: [60, 1200, 10],
  settleMs: [0, 1500, 10],
  reducedFadeMs: [60, 1000, 10],
  sfxGatherGain: [0, 2, 0.05],
  sfxCountGain: [0, 2, 0.05],
  sfxMergeGain: [0, 2, 0.05],
  sfxChargeGain: [0, 2, 0.05],
  sfxFireGain: [0, 2, 0.05],
  sfxImpactGain: [0, 2, 0.05],
  sfxSmackGain: [0, 2, 0.05],
  previewDamage: [1, 40, 1],
  previewParts: [1, 8, 1],
};

/** The hard ceilings a plan can never exceed, whatever the sliders say (the "within caps" of the ask). */
export const BLAST_CAPS = { bolts: 8, shakePx: 20, zoom: 0.12, sparks: 80 } as const;

const HEX = /^#[0-9a-f]{6}$/i;
const isColorKey = (k: string): k is ColorKey => (HERO_BLAST_COLOR_KEYS as readonly string[]).includes(k);

/** One value, made safe: numbers clamped into range (junk = the default), colours must be #rrggbb. Unknown keys: undefined. */
export function clampHeroBlastValue<K extends keyof HeroBlastConfig>(key: K, value: unknown): HeroBlastConfig[K] | undefined {
  if (!(key in HERO_BLAST_DEFAULTS)) return undefined;
  const def = HERO_BLAST_DEFAULTS[key];
  if (isColorKey(key)) {
    if (typeof value !== 'string') return def;
    const v = value.trim();
    return (HEX.test(v) ? v.toLowerCase() : def) as HeroBlastConfig[K];
  }
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

const KEY = 'ascent.heroblast';

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
  const { previewDamage: _d, previewParts: _p, ...ship } = c;
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
  /** Signed arc (fraction of the distance) — alternates side, the lead bolt flies straight. */
  curve: number;
}

export interface BlastPlan {
  reduced: boolean;
  /** 0..1: how big this blow reads (0 = 1 damage, 1 = `bigDamage` or more). */
  k: number;
  total: number;
  /** The displayed value was cut by the round cap (the parts summed past it). */
  capped: boolean;
  spawns: number[];
  launches: number[];
  arrivals: number[];
  /** The total shown after each arrival. Never exceeds `total`; the last is exactly `total`. */
  counts: number[];
  mergeAt: number;
  chargeAt: number;
  absorbEnd: number;
  fireAt: number;
  bolts: BlastBolt[];
  /** THE consequence beat: the lead bolt lands. */
  impactAt: number;
  endAt: number;
  shakePx: number;
  zoom: number;
  sparks: number;
  flashScale: number;
}

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** Bolt flight time for a distance at a speed, kept inside a readable band. */
export function boltTravelMs(distance: number, pxPerSec: number): number {
  const d = Number.isFinite(distance) && distance > 0 ? distance : 600;
  const v = pxPerSec > 0 ? pxPerSec : HERO_BLAST_DEFAULTS.boltSpeed;
  return Math.round(clamp((d / v) * 1000, 140, 520));
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
  const k = clamp((total - 1) / Math.max(1, c.bigDamage - 1), 0, 1);
  const counts = blastCounts(values, total);
  const capped = rawSum > total;

  if (input.reduced) {
    const fade = c.reducedFadeMs;
    const impactAt = fade + 220;
    return {
      reduced: true, k, total, capped, spawns: [], launches: [], arrivals: [], counts: [],
      mergeAt: 0, chargeAt: impactAt, absorbEnd: impactAt, fireAt: impactAt, bolts: [],
      impactAt, endAt: impactAt + fade + 120, shakePx: 0, zoom: 0, sparks: 0, flashScale: 0,
    };
  }

  const n = values.length;
  const spawns = values.map((_, i) => i * c.combineStaggerMs * 0.5);
  const launches = values.map((_, i) => c.popInMs + i * c.combineStaggerMs);
  const arrivals = launches.map((l) => l + c.combineFlyMs);
  const mergeAt = n ? arrivals[n - 1]! : c.popInMs;
  const chargeAt = mergeAt + c.mergeHoldMs;
  const absorbEnd = chargeAt + c.absorbMs;
  const fireAt = chargeAt + Math.max(c.chargeMs, c.absorbMs * 0.6);

  const lo = Math.min(c.boltsMin, c.boltsMax), hi = Math.max(c.boltsMin, c.boltsMax);
  const count = clamp(Math.round(lerp(lo, hi, k)), 1, BLAST_CAPS.bolts);
  const travel = boltTravelMs(input.distance, c.boltSpeed);
  const baseSize = lerp(c.boltSizeMin, c.boltSizeMax, k);
  const bolts: BlastBolt[] = [];
  for (let i = 0; i < count; i++) {
    const at = fireAt + i * c.boltStaggerMs;
    // Trailing bolts are a touch smaller and a touch faster, so the volley bunches up into the target.
    const tr = Math.round(travel * (1 - Math.min(0.25, i * 0.05)));
    const side = i === 0 ? 0 : (i % 2 === 1 ? 1 : -1) * (1 + Math.floor((i - 1) / 2) * 0.6);
    bolts.push({ fireAt: at, travelMs: tr, arriveAt: at + tr, size: baseSize * (i === 0 ? 1 : 0.72), curve: c.boltCurve * side });
  }
  const impactAt = bolts[0]!.arriveAt;
  const lastHit = Math.max(...bolts.map((b) => b.arriveAt));
  const endAt = Math.max(lastHit, impactAt + c.zoomOutMs * 0.6) + c.settleMs;

  return {
    reduced: false, k, total, capped, spawns, launches, arrivals, counts,
    mergeAt, chargeAt, absorbEnd, fireAt, bolts, impactAt, endAt,
    shakePx: clamp(lerp(c.shakeMin, c.shakeMax, k), 0, BLAST_CAPS.shakePx),
    zoom: clamp(lerp(c.zoomMin, c.zoomMax, k), 0, BLAST_CAPS.zoom),
    sparks: Math.round(clamp(lerp(c.sparksMin, c.sparksMax, k), 0, BLAST_CAPS.sparks)),
    flashScale: c.flashSize * (0.75 + 0.6 * k),
  };
}

export type BlastCueKind = 'spawn' | 'launch' | 'arrive' | 'merge' | 'charge' | 'fire' | 'impact' | 'hit' | 'end';
export interface BlastCue { at: number; kind: BlastCueKind; i: number }

/** Every beat the runner fires, in time order (ties keep this declaration order, so impact precedes end). */
export function blastCues(p: BlastPlan): BlastCue[] {
  const out: BlastCue[] = [];
  p.spawns.forEach((at, i) => out.push({ at, kind: 'spawn', i }));
  p.launches.forEach((at, i) => out.push({ at, kind: 'launch', i }));
  p.arrivals.forEach((at, i) => out.push({ at, kind: 'arrive', i }));
  out.push({ at: p.mergeAt, kind: 'merge', i: 0 });
  if (!p.reduced) out.push({ at: p.chargeAt, kind: 'charge', i: 0 });
  p.bolts.forEach((b, i) => out.push({ at: b.fireAt, kind: 'fire', i }));
  out.push({ at: p.impactAt, kind: 'impact', i: 0 });
  p.bolts.forEach((b, i) => { if (i > 0) out.push({ at: b.arriveAt, kind: 'hit', i }); });
  out.push({ at: p.endAt, kind: 'end', i: 0 });
  const order: Record<BlastCueKind, number> = { spawn: 0, launch: 1, arrive: 2, merge: 3, charge: 4, fire: 5, impact: 6, hit: 7, end: 8 };
  return out.map((c, idx) => ({ c, idx })).sort((a, b) => a.c.at - b.c.at || order[a.c.kind] - order[b.c.kind] || a.idx - b.idx).map((x) => x.c);
}

/** '#rrggbb' -> 0xRRGGBB (bad input = white). */
export function hexToNum(hex: string): number {
  const v = Number.parseInt(hex.replace('#', ''), 16);
  return Number.isFinite(v) ? v : 0xffffff;
}
