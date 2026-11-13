/**
 * THE GRAND FINALE HERO ATTACK (style `fireworks`, an EPIC): its tuned values, its pure timeline, the pure geometry
 * (where the firework stands, every flight path, where the shell blooms) and the pure camera.
 *
 * ONE IDEA: fireworks, and above all the HELD BEAT OF QUIET before a big shell blooms. No flame anywhere (Inferno owns
 * fireballs and meteors): this is fuses, coloured sparks, glitter trails and star bursts in gold, magenta, cyan and
 * green.
 *
 * THE THREE LOOKS. Every hero attack reads its tier from the shared `attackTier` (thresholds I 1-5 / II 6-11 /
 * III 12-19 / IV 20+, and a knockout always plays IV). An Epic maps those four onto three looks, exactly as Storm Call
 * does (`fireworksLevel`): I -> the BOTTLE ROCKET, II and III -> the ROMAN CANDLE, IV -> the MORTAR SHELL.
 *  - 1, THE BOTTLE ROCKET. A little rocket on a stick is planted beside the striking hero, leaning at the target. Its
 *    fuse fizzes for a beat, then it SQUEALS off on a slightly wiggly path with a thin spark trail and pops against
 *    the struck portrait in a small star burst of one colour (rolled from the seed). The pop is THE blow.
 *  - 2, THE ROMAN CANDLE. A tube is planted and thumps out THREE glowing balls in a row, each a different colour on its
 *    own arc. The first two pop on the portrait as TICKS (FX and sound only); the third pop is THE blow.
 *  - 3, THE MORTAR SHELL. A mortar tube is planted. A heavy thump, and one faint comet rises fast and leaves the TOP of
 *    the screen. Then the HELD BEAT: about 0.6 s with the screen dimmed, the camera still and nothing moving. Then a
 *    huge chrysanthemum opens above the struck portrait (two rings of sparks that expand and droop, a smaller bloom
 *    inside, crackle glitter) and its falling sparks rain onto the portrait. The bloom is THE blow.
 *
 * The damage formation (shared) opens every attack; this style starts where it ends. The consequence lands exactly
 * ONCE, on the impact beat. No hit-stop: the clock runs straight through the held beat (the stillness is staged, the
 * clock never pauses). Reduced motion: no firework, shake or zoom; the numbers fade and the blow lands.
 *
 * Tuner convention (the Blast's): localStorage in DEV only, values clamped on write and on load; production always plays
 * DEFAULTS.
 */
import { clamp, hexToNum, type Pt } from '../heroAttack/easing';
import {
  HERO_ATTACK_TIER_THRESHOLDS, reducedAttackTimeline, attackTier, type AttackTierContext, type TierNum,
} from '../heroAttack/tiers';

export { hexToNum, type TierNum };

export const FIREWORKS_LEVELS = [1, 2, 3] as const;
export type FireworksLevel = (typeof FIREWORKS_LEVELS)[number];
export const FIREWORKS_LEVEL_NAMES: Record<FireworksLevel, string> = { 1: 'Bottle rocket', 2: 'Roman candle', 3: 'Mortar shell' };

/** The shared four damage tiers mapped onto the three looks: I rocket, II and III candle, IV (and a knockout) mortar. */
export function fireworksLevel(tier: TierNum): FireworksLevel {
  return tier <= 1 ? 1 : tier >= 4 ? 3 : 2;
}

/** The per-look dials. A config key is `v1..v3` + one of these. */
export const FIREWORKS_LEVEL_SUFFIXES = [
  'FuseMs', 'FlyMs', 'Size', 'Shake', 'Zoom', 'Punch', 'Sparks', 'Burst', 'SettleMs', 'Dim',
] as const;
export type FireworksLevelSuffix = (typeof FIREWORKS_LEVEL_SUFFIXES)[number];
type LevelKey = `v${FireworksLevel}${FireworksLevelSuffix}`;

interface GlobalConfig {
  tier2At: number; tier3At: number; tier4At: number;
  // Ready
  absorbMs: number;
  plantMs: number;
  heroCoilPx: number;
  heroFlinchPx: number;
  // The rocket
  wigglePx: number;
  wiggleHz: number;
  trailMs: number;
  // The candle
  candleGapMs: number;
  candleSpread: number;
  // The mortar and the bloom
  holdMs: number;
  bloomSize: number;
  bloomLift: number;
  bloomMs: number;
  rain: number;
  rainMs: number;
  glitter: number;
  skyFlash: number;
  dismissMs: number;
  // Camera and portraits
  flashAlpha: number;
  knockPx: number;
  squash: number;
  shakeMs: number;
  zoomOutMs: number;
  reducedFadeMs: number;
  // Colours
  colorCore: string;
  colorGold: string;
  colorMagenta: string;
  colorCyan: string;
  colorGreen: string;
  colorPlayer: string;
  colorFoe: string;
  // Sound
  sfxPlantClip: string; sfxPlantGain: number; sfxPlantRate: number;
  sfxFuseClip: string; sfxFuseGain: number; sfxFuseRate: number;
  sfxSquealClip: string; sfxSquealGain: number; sfxSquealRate: number;
  sfxThumpClip: string; sfxThumpGain: number; sfxThumpRate: number;
  sfxPopClip: string; sfxPopGain: number; sfxPopRate: number;
  sfxBoomClip: string; sfxBoomGain: number; sfxBoomRate: number;
  sfxTailMix: number;
  sfxDuck: number;
  // Preview only
  previewDamage: number;
  previewParts: number;
}
export type HeroFireworksConfig = GlobalConfig & Record<LevelKey, number>;

export const HERO_FIREWORKS_COLOR_KEYS = ['colorCore', 'colorGold', 'colorMagenta', 'colorCyan', 'colorGreen', 'colorPlayer', 'colorFoe'] as const;
export const HERO_FIREWORKS_CLIP_KEYS = ['sfxPlantClip', 'sfxFuseClip', 'sfxSquealClip', 'sfxThumpClip', 'sfxPopClip', 'sfxBoomClip'] as const;
type ColorKey = (typeof HERO_FIREWORKS_COLOR_KEYS)[number];
type ClipKey = (typeof HERO_FIREWORKS_CLIP_KEYS)[number];
export type HeroFireworksStrKey = ColorKey | ClipKey;
export type HeroFireworksNumKey = Exclude<keyof HeroFireworksConfig, HeroFireworksStrKey>;

/** Rocket, candle, mortar per suffix: the escalation ladder. */
const LEVEL_DEFAULTS: Record<FireworksLevelSuffix, [number, number, number]> = {
  FuseMs: [300, 240, 260],
  FlyMs: [360, 330, 260],
  Size: [1, 1, 1],
  Shake: [5, 7, 15],
  Zoom: [0.02, 0.03, 0.045],
  Punch: [0.015, 0.022, 0.05],
  Sparks: [14, 10, 56],
  Burst: [1.25, 1.2, 1.25],
  SettleMs: [240, 260, 300],
  Dim: [0.14, 0.24, 0.6],
};

export const FIREWORKS_LEVEL_RANGES: Record<FireworksLevelSuffix, [number, number, number]> = {
  FuseMs: [60, 1500, 10],
  FlyMs: [120, 1200, 10],
  Size: [0.5, 2, 0.05],
  Shake: [0, 40, 0.5],
  Zoom: [0, 0.12, 0.002],
  Punch: [0, 0.1, 0.001],
  Sparks: [4, 80, 1],
  Burst: [0.3, 3, 0.05],
  SettleMs: [0, 1600, 10],
  Dim: [0, 0.8, 0.01],
};

const levelDefaults = Object.fromEntries(FIREWORKS_LEVELS.flatMap((v) => FIREWORKS_LEVEL_SUFFIXES.map((s) => [`v${v}${s}`, LEVEL_DEFAULTS[s][v - 1]]))) as Record<LevelKey, number>;

export const HERO_FIREWORKS_DEFAULTS: HeroFireworksConfig = {
  ...HERO_ATTACK_TIER_THRESHOLDS,
  absorbMs: 190,
  plantMs: 130,
  heroCoilPx: 4,
  heroFlinchPx: 6,
  wigglePx: 38,
  wiggleHz: 3,
  trailMs: 9,
  candleGapMs: 180,
  candleSpread: 0.4,
  holdMs: 600,
  bloomSize: 3,
  bloomLift: 0.62,
  bloomMs: 1700,
  rain: 22,
  rainMs: 900,
  glitter: 26,
  skyFlash: 0.14,
  dismissMs: 260,
  flashAlpha: 0.9,
  knockPx: 14,
  squash: 0.08,
  shakeMs: 300,
  zoomOutMs: 340,
  reducedFadeMs: 260,
  colorCore: '#fffbea',
  colorGold: '#ffc94a',
  colorMagenta: '#ff4fb0',
  colorCyan: '#45dcff',
  colorGreen: '#6dff7c',
  colorPlayer: '#ffd66b',
  colorFoe: '#ff7bbd',
  sfxPlantClip: 'placelow', sfxPlantGain: 0.3, sfxPlantRate: 1.2,
  sfxFuseClip: 'fx/fireworks-fuse', sfxFuseGain: 0.5, sfxFuseRate: 1,
  sfxSquealClip: 'fx/fireworks-squeal', sfxSquealGain: 0.42, sfxSquealRate: 1.1,
  sfxThumpClip: 'fx/fireworks-thump', sfxThumpGain: 0.75, sfxThumpRate: 0.85,
  sfxPopClip: 'fx/fireworks-boom', sfxPopGain: 0.5, sfxPopRate: 1.7,
  sfxBoomClip: 'fx/fireworks-boom', sfxBoomGain: 0.95, sfxBoomRate: 0.92,
  sfxTailMix: 0.16,
  sfxDuck: 0.4,
  previewDamage: 12,
  previewParts: 4,
  ...levelDefaults,
};

const GLOBAL_RANGES: Record<Exclude<keyof GlobalConfig, HeroFireworksStrKey>, [number, number, number]> = {
  tier2At: [2, 40, 1], tier3At: [2, 60, 1], tier4At: [2, 80, 1],
  absorbMs: [60, 600, 10],
  plantMs: [40, 600, 10],
  heroCoilPx: [0, 40, 1],
  heroFlinchPx: [0, 50, 1],
  wigglePx: [0, 60, 1],
  wiggleHz: [0, 8, 0.1],
  trailMs: [6, 80, 1],
  candleGapMs: [60, 600, 5],
  candleSpread: [0, 0.8, 0.01],
  holdMs: [0, 1500, 10],
  bloomSize: [1, 4, 0.05],
  bloomLift: [0, 1.5, 0.01],
  bloomMs: [400, 2500, 10],
  rain: [0, 40, 1],
  rainMs: [300, 2000, 10],
  glitter: [0, 50, 1],
  skyFlash: [0, 0.6, 0.01],
  dismissMs: [60, 1000, 10],
  flashAlpha: [0, 1, 0.01],
  knockPx: [0, 60, 1],
  squash: [0, 0.3, 0.01],
  shakeMs: [0, 1200, 10],
  zoomOutMs: [60, 1500, 10],
  reducedFadeMs: [60, 1000, 10],
  sfxPlantGain: [0, 2, 0.05], sfxPlantRate: [0.5, 2.5, 0.01],
  sfxFuseGain: [0, 2, 0.05], sfxFuseRate: [0.5, 2.5, 0.01],
  sfxSquealGain: [0, 2, 0.05], sfxSquealRate: [0.5, 2.5, 0.01],
  sfxThumpGain: [0, 2, 0.05], sfxThumpRate: [0.3, 2.5, 0.01],
  sfxPopGain: [0, 2, 0.05], sfxPopRate: [0.5, 2.5, 0.01],
  sfxBoomGain: [0, 2, 0.05], sfxBoomRate: [0.3, 2.5, 0.01],
  sfxTailMix: [0, 0.6, 0.01],
  sfxDuck: [0, 1, 0.05],
  previewDamage: [1, 60, 1],
  previewParts: [1, 8, 1],
};

export const HERO_FIREWORKS_RANGES: Record<HeroFireworksNumKey, [number, number, number]> = {
  ...GLOBAL_RANGES,
  ...(Object.fromEntries(FIREWORKS_LEVELS.flatMap((v) => FIREWORKS_LEVEL_SUFFIXES.map((s) => [`v${v}${s}`, FIREWORKS_LEVEL_RANGES[s]]))) as Record<LevelKey, [number, number, number]>),
};

/** The hard ceilings a plan can never exceed, whatever the sliders say. */
export const FIREWORKS_CAPS = { sparks: 80, rain: 40, glitter: 50, shakePx: 40, zoom: 0.12 } as const;

const HEX = /^#[0-9a-f]{6}$/i;
const isColorKey = (k: string): k is ColorKey => (HERO_FIREWORKS_COLOR_KEYS as readonly string[]).includes(k);
const isClipKey = (k: string): k is ClipKey => (HERO_FIREWORKS_CLIP_KEYS as readonly string[]).includes(k);

export function clampHeroFireworksValue<K extends keyof HeroFireworksConfig>(key: K, value: unknown): HeroFireworksConfig[K] | undefined {
  if (!Object.prototype.hasOwnProperty.call(HERO_FIREWORKS_DEFAULTS, key)) return undefined;
  const def = HERO_FIREWORKS_DEFAULTS[key];
  if (isColorKey(key)) {
    if (typeof value !== 'string') return def;
    const v = value.trim();
    return (HEX.test(v) ? v.toLowerCase() : def) as HeroFireworksConfig[K];
  }
  if (isClipKey(key)) return (typeof value === 'string' ? value.trim().slice(0, 160) : def) as HeroFireworksConfig[K];
  const n = typeof value === 'number' ? value : Number(value);
  if (typeof value === 'boolean' || value === null || value === '' || !Number.isFinite(n)) return def;
  const [min, max] = HERO_FIREWORKS_RANGES[key as HeroFireworksNumKey];
  return Math.min(max, Math.max(min, n)) as HeroFireworksConfig[K];
}

export function sanitizeHeroFireworksConfig(saved: unknown): HeroFireworksConfig {
  const out: HeroFireworksConfig = { ...HERO_FIREWORKS_DEFAULTS };
  if (!saved || typeof saved !== 'object') return out;
  for (const [k, v] of Object.entries(saved as Record<string, unknown>)) {
    const safe = clampHeroFireworksValue(k as keyof HeroFireworksConfig, v);
    if (safe !== undefined) (out as unknown as Record<string, unknown>)[k] = safe;
  }
  return out;
}

const KEY = 'ascent.herofireworks.v2';

let cfg: HeroFireworksConfig = (() => {
  if (!import.meta.env.DEV || typeof localStorage === 'undefined') return { ...HERO_FIREWORKS_DEFAULTS };
  try { return sanitizeHeroFireworksConfig(JSON.parse(localStorage.getItem(KEY) ?? '{}')); } catch { return { ...HERO_FIREWORKS_DEFAULTS }; }
})();

export function getHeroFireworksConfig(): HeroFireworksConfig { return cfg; }

export function setHeroFireworksValue(key: keyof HeroFireworksConfig, value: number | string): void {
  const safe = clampHeroFireworksValue(key, value);
  if (safe === undefined) return;
  cfg = { ...cfg, [key]: safe };
  if (!import.meta.env.DEV) return;
  try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch { /* ignore */ }
}

export function resetHeroFireworksConfig(): void {
  cfg = { ...HERO_FIREWORKS_DEFAULTS };
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}

export function heroFireworksConfigJson(c: HeroFireworksConfig = cfg): string {
  const ship: Partial<HeroFireworksConfig> = { ...c };
  delete ship.previewDamage;
  delete ship.previewParts;
  return JSON.stringify(ship, null, 2);
}

/** The preview speed. Previews always play at 1x (owner 2026-09-29: no Speed buttons on the attack tuners). */
export function heroFireworksPreviewSpeed(): number { return 1; }

// ─── the pure plan ─────────────────────────────────────────────────────────────────────────────────────────────

export function fireworksLevelDials(level: FireworksLevel, c: HeroFireworksConfig = cfg): Record<FireworksLevelSuffix, number> {
  return Object.fromEntries(FIREWORKS_LEVEL_SUFFIXES.map((s) => [s, c[`v${level}${s}`]])) as Record<FireworksLevelSuffix, number>;
}

/** Which firework is planted. */
export type FireworkProp = 'rocket' | 'candle' | 'mortar';
export const FIREWORK_OF: Record<FireworksLevel, FireworkProp> = { 1: 'rocket', 2: 'candle', 3: 'mortar' };
/** How many balls the roman candle throws. */
export const CANDLE_SHOTS = 3;

export interface FireworksPlanInput extends AttackTierContext {
  leadIn?: number;
  total: number;
  distance: number;
  reduced?: boolean;
}

export interface FireworksPlan {
  reduced: boolean;
  /** The SHARED damage tier (1..4; a knockout is 4). */
  tier: TierNum;
  /** The look: 1 bottle rocket, 2 roman candle, 3 mortar shell. */
  level: FireworksLevel;
  k: number;
  total: number;
  /** The firework is planted beside the hero (the attack's first beat). */
  chargeAt: number;
  absorbEnd: number;
  /** The fuse is lit, and fizzes for `fuseMs`. */
  fuseAt: number;
  fuseMs: number;
  /** Every launch: the rocket leaving, each candle ball thumping out, the mortar firing. */
  launches: number[];
  /** A flight's length: the rocket's, each ball's, or the comet's rise off the top of the screen. */
  flyMs: number;
  /** Pops that land BEFORE the impact (the candle's first two balls). FX only. */
  hits: number[];
  /** Mortar: THE HELD BEAT, from the comet leaving the screen (`holdAt`) for `holdMs`. Otherwise `holdMs` is 0. */
  holdAt: number;
  holdMs: number;
  /** THE consequence beat: the rocket pops, the third ball pops, or the shell blooms. */
  impactAt: number;
  /** The tube is taken away (the rocket has flown, so it has none). */
  dismissAt: number;
  endAt: number;
  propSize: number;
  shakePx: number;
  zoom: number;
  punch: number;
  sparks: number;
  burst: number;
  dim: number;
}

/** The whole Grand Finale, in base ms. Pure and deterministic. */
export function fireworksPlan(input: FireworksPlanInput, c: HeroFireworksConfig = cfg): FireworksPlan {
  const total = Math.max(0, Math.round(input.total));
  const tier = attackTier(total, input, c); // a knockout always plays Tier IV (heroAttack/tiers.ts), so the mortar
  const level = fireworksLevel(tier);
  const V = fireworksLevelDials(level, c);
  const k = (level - 1) / 2;

  if (input.reduced) {
    const r = reducedAttackTimeline(input.leadIn ?? 0, c.reducedFadeMs);
    const { impactAt } = r;
    return {
      reduced: true, tier, level, k, total, chargeAt: impactAt, absorbEnd: impactAt, fuseAt: impactAt, fuseMs: 0, launches: [], flyMs: 0,
      hits: [], holdAt: impactAt, holdMs: 0, impactAt, dismissAt: impactAt, endAt: r.endAt,
      propSize: V.Size, shakePx: 0, zoom: 0, punch: 0, sparks: 0, burst: 0, dim: 0,
    };
  }

  const chargeAt = Math.max(0, input.leadIn ?? 0);
  const absorbEnd = chargeAt + c.absorbMs;
  const fuseAt = chargeAt + c.plantMs;
  const first = fuseAt + V.FuseMs;
  let launches: number[];
  let hits: number[] = [];
  let holdAt: number, holdMs = 0;
  let impactAt: number;
  let tail: number;

  if (level === 1) {
    launches = [first];
    impactAt = first + V.FlyMs;
    holdAt = impactAt;
    tail = 420;
  } else if (level === 2) {
    launches = Array.from({ length: CANDLE_SHOTS }, (_, i) => first + i * c.candleGapMs);
    const pops = launches.map((at) => at + V.FlyMs);
    impactAt = pops[pops.length - 1]!;
    hits = pops.slice(0, -1);
    holdAt = impactAt;
    tail = 460;
  } else {
    // The thump, the comet off the top of the screen, THE HELD BEAT, then the bloom.
    launches = [first];
    holdAt = first + V.FlyMs;
    holdMs = c.holdMs;
    impactAt = holdAt + holdMs;
    // The bloom hangs and droops; the scene keeps draining its last sparks after the end.
    tail = Math.max(700, c.rainMs);
  }

  const dismissAt = impactAt + 240;
  const endAt = Math.max(impactAt + tail, impactAt + c.zoomOutMs * 0.8) + V.SettleMs;

  return {
    reduced: false, tier, level, k, total, chargeAt, absorbEnd, fuseAt, fuseMs: V.FuseMs, launches, flyMs: V.FlyMs, hits, holdAt, holdMs,
    impactAt, dismissAt, endAt,
    propSize: V.Size,
    shakePx: clamp(V.Shake, 0, FIREWORKS_CAPS.shakePx),
    zoom: clamp(V.Zoom, 0, FIREWORKS_CAPS.zoom),
    punch: V.Punch,
    sparks: Math.round(clamp(V.Sparks, 0, FIREWORKS_CAPS.sparks)),
    burst: V.Burst,
    dim: V.Dim,
  };
}

export type FireworksCueKind = 'plant' | 'fuse' | 'launch' | 'hold' | 'pop' | 'impact' | 'dismiss' | 'end';
export interface FireworksCue { at: number; kind: FireworksCueKind; i: number }

/** Every beat the runner fires, in time order (ties keep this declaration order, so a pop precedes the impact). */
export function fireworksCues(p: FireworksPlan): FireworksCue[] {
  const out: FireworksCue[] = [];
  if (!p.reduced) {
    out.push({ at: p.chargeAt, kind: 'plant', i: 0 });
    out.push({ at: p.fuseAt, kind: 'fuse', i: 0 });
    p.launches.forEach((at, i) => out.push({ at, kind: 'launch', i }));
    if (p.holdMs > 0) out.push({ at: p.holdAt, kind: 'hold', i: 0 });
    p.hits.forEach((at, i) => out.push({ at, kind: 'pop', i }));
  }
  out.push({ at: p.impactAt, kind: 'impact', i: 0 });
  if (!p.reduced && p.level !== 1) out.push({ at: p.dismissAt, kind: 'dismiss', i: 0 });
  out.push({ at: p.endAt, kind: 'end', i: 0 });
  const order: Record<FireworksCueKind, number> = { plant: 0, fuse: 1, launch: 2, hold: 3, pop: 4, impact: 5, dismiss: 6, end: 7 };
  return out.map((q, idx) => ({ q, idx })).sort((a, b) => a.q.at - b.q.at || order[a.q.kind] - order[b.q.kind] || a.idx - b.idx).map((x) => x.q);
}

// ─── the geometry (pure) ─────────────────────────────────────────────────────────────────────────────────────

/**
 * How each firework is painted (`heroFireworksTextures.ts`), in texture px: the canvas, the anchor the sprite turns
 * about (the tube's foot; the rocket's body), how tall it stands on screen at stage scale 1 (`px`, the whole canvas),
 * where its mouth is and where its fuse burns from and to (offsets from the anchor, the firework standing upright).
 * Every fuse is painted on the LEFT; the firework is mirrored when the hero that lit it stands to its right.
 */
export const PROP_METRICS: Record<FireworkProp, {
  w: number; h: number; ax: number; ay: number; px: number;
  /** From the anchor to the mouth (the rocket: to its nose), up the firework. */
  mouth: number;
  /** The rocket only: from the foot of its stick up to the anchor. */
  foot: number;
  fuse0: readonly [number, number]; fuse1: readonly [number, number];
}> = {
  rocket: { w: 56, h: 184, ax: 24 / 56, ay: 60 / 184, px: 190, mouth: 52, foot: 118, fuse0: [-13, 62], fuse1: [-2, 34] },
  candle: { w: 72, h: 184, ax: 36 / 72, ay: 176 / 184, px: 205, mouth: 160, foot: 0, fuse0: [-30, -148], fuse1: [-15, -157] },
  mortar: { w: 132, h: 156, ax: 66 / 132, ay: 148 / 156, px: 186, mouth: 128, foot: 0, fuse0: [-58, -36], fuse1: [-31, -54] },
};

/** How far a firework may lean from upright toward the target (radians). The mortar stands nearly straight. */
export const PROP_LEAN: Record<FireworkProp, number> = { rocket: 0.82, candle: 0.55, mortar: 0.1 };

/** A point painted on a firework (texture px from its anchor, upright) -> where it is on screen. Writes into `out`. */
export function propPoint(g: Pick<FireworksGeo, 'anchor' | 'angle' | 'k' | 'flip'>, lx: number, ly: number, out: Pt): Pt {
  const x = lx * g.flip * g.k, y = ly * g.k;
  const cs = Math.cos(g.angle), sn = Math.sin(g.angle);
  out.x = g.anchor.x + x * cs - y * sn; out.y = g.anchor.y + x * sn + y * cs;
  return out;
}


/**
 * A flight: a quadratic curve `from` -> `to` bent by `ctrl`, plus a sideways WIGGLE (the bottle rocket: `wiggle` px at
 * `hz` cycles over the flight, pinned to zero at both ends so it leaves the stick and hits the face exactly).
 */
export interface FireworksPath { from: Pt; ctrl: Pt; to: Pt; wiggle: number; hz: number }

/** The point `e` (0..1) along a flight, written into `out` (no allocation: the scene calls this every frame). */
export function fireworksPathAt(p: FireworksPath, e: number, out: Pt): Pt {
  const t = e < 0 ? 0 : e > 1 ? 1 : e;
  const m = 1 - t;
  let x = m * m * p.from.x + 2 * m * t * p.ctrl.x + t * t * p.to.x;
  let y = m * m * p.from.y + 2 * m * t * p.ctrl.y + t * t * p.to.y;
  if (p.wiggle !== 0) {
    const dx = p.to.x - p.from.x, dy = p.to.y - p.from.y;
    const L = Math.hypot(dx, dy) || 1;
    const w = p.wiggle * Math.sin(Math.PI * t) * Math.sin(2 * Math.PI * p.hz * t);
    x += (-dy / L) * w; y += (dx / L) * w;
  }
  out.x = x; out.y = y;
  return out;
}

/** The view everything must stay inside. */
export interface ViewBox { w: number; h: number }

/** How close to an edge of the view the bloom's centre may sit, in bloom radii (so most of it is always on screen). */
export const BLOOM_INSET = 0.65;

export interface FireworksGeo {
  prop: FireworkProp | null;
  /** Where the firework stands (the tube's foot, or the foot of the rocket's stick). */
  base: Pt;
  /** Its lean from upright (radians, + = to the right), and the unit direction it points. */
  angle: number;
  dir: Pt;
  /** Texture px -> screen px. */
  k: number;
  /** 1 as painted (the fuse on the left, toward a hero standing to its left), -1 mirrored. */
  flip: 1 | -1;
  /** Where the sprite's anchor sits (the tube's foot; the rocket's body). */
  anchor: Pt;
  /** The open end a ball or the shell leaves from (the rocket: its nose). */
  mouth: Pt;
  /** Every flight, one per launch (the mortar's is the comet's rise off the top of the screen). */
  paths: FireworksPath[];
  /** Where each pop lands on the struck portrait; the last is THE blow (the mortar: where the bloom's light lands). */
  strikes: Pt[];
  /** Mortar: the bloom's centre and its radius. */
  bloom: Pt | null;
  bloomR: number;
}

const EMPTY_GEO: FireworksGeo = { prop: null, base: { x: 0, y: 0 }, angle: 0, dir: { x: 0, y: -1 }, k: 1, flip: 1, anchor: { x: 0, y: 0 }, mouth: { x: 0, y: 0 }, paths: [], strikes: [], bloom: null, bloomR: 0 };

/**
 * Where everything is, from the plan and the two heroes. The firework is planted beside the striking hero on the
 * target's side, standing on the line of the portrait's lower edge and leaning toward the target (never past
 * `PROP_LEAN`, so it always reads as standing on the ground: a target below is reached by a lobbed arc). Flights leave
 * along the lean and bend onto the struck face. The mortar's comet leaves the TOP of the view, and the shell blooms
 * above the struck portrait (with no room above a hero at the top of the screen, as low over it as it must). Pure.
 */
export function fireworksGeometry(
  p: FireworksPlan, a: Pt, d: Pt, radius: number, aRadius: number,
  c: Pick<HeroFireworksConfig, 'wigglePx' | 'wiggleHz' | 'candleSpread' | 'bloomSize' | 'bloomLift'>, scale = 1, view: ViewBox | null = null,
): FireworksGeo {
  if (p.reduced) return EMPTY_GEO;
  const prop = FIREWORK_OF[p.level];
  const M = PROP_METRICS[prop];
  const k = (M.px * p.propSize * scale) / M.h;
  const side = d.x >= a.x ? 1 : -1;
  let bx = a.x + side * aRadius * 1.3;
  let by = a.y + aRadius * 0.66;
  if (view && view.w > 0 && view.h > 0) {
    bx = clamp(bx, 36 * scale, view.w - 36 * scale);
    by = Math.min(by, view.h - 8 * scale);
  }
  const base = { x: bx, y: by };
  const flip: 1 | -1 = side === 1 ? 1 : -1;
  // The lean: toward the target, clamped. 0 = straight up, + = to the right.
  const up = (M.foot + M.mouth) * k;
  const aim = Math.atan2(d.x - bx, -(d.y - (by - up)));
  const lean = PROP_LEAN[prop];
  const angle = clamp(aim, -lean, lean);
  const dir = { x: Math.sin(angle), y: -Math.cos(angle) };
  const anchor = { x: bx + dir.x * M.foot * k, y: by + dir.y * M.foot * k };
  const mouth = { x: anchor.x + dir.x * M.mouth * k, y: anchor.y + dir.y * M.mouth * k };

  if (p.level === 3) {
    const bloomR = radius * c.bloomSize;
    // Above the portrait, its lowest stars just over the frame; kept (mostly) inside the view, so over a hero in a top
    // corner it opens beside and over the portrait instead of off the screen.
    let cy = Math.max(d.y - radius - bloomR * c.bloomLift, bloomR * BLOOM_INSET);
    let cx = d.x;
    if (view && view.w > 0) { cx = clamp(cx, Math.min(bloomR * BLOOM_INSET, view.w / 2), Math.max(view.w - bloomR * BLOOM_INSET, view.w / 2)); cy = Math.min(cy, Math.max(view.h - bloomR * BLOOM_INSET, view.h / 2)); }
    const bloom = { x: cx, y: cy };
    // The comet: up out of the tube and off the top, drifting a little toward where the shell will open.
    const top = { x: mouth.x + (cx - mouth.x) * 0.22, y: -70 * scale };
    const ctrl = { x: mouth.x + dir.x * (mouth.y - top.y) * 0.5, y: (mouth.y + top.y) / 2 };
    return { prop, base, angle, dir, k, flip, anchor, mouth, paths: [{ from: mouth, ctrl, to: top, wiggle: 0, hz: 0 }], strikes: [{ x: d.x, y: d.y - radius * 0.1 }], bloom, bloomR };
  }

  const from = p.level === 1 ? anchor : mouth;
  const L = Math.hypot(d.x - from.x, d.y - from.y) || 1;
  // A flight never leaves the view: a curve stays inside its three points, so the point that bends it (straight out
  // along the lean) is pulled back along the lean until it is inside, with room for the rocket's wiggle.
  const bend = (reach: number, pad: number): Pt => {
    let r = reach;
    if (view && view.w > 0 && view.h > 0) {
      if (dir.x > 1e-6) r = Math.min(r, Math.max(0, view.w - pad - from.x) / dir.x);
      if (dir.x < -1e-6) r = Math.min(r, Math.max(0, from.x - pad) / -dir.x);
      if (dir.y < -1e-6) r = Math.min(r, Math.max(0, from.y - pad) / -dir.y);
    }
    return { x: from.x + dir.x * r, y: from.y + dir.y * r };
  };
  const u = { x: (d.x - from.x) / L, y: (d.y - from.y) / L };
  const n = { x: -u.y, y: u.x };
  if (p.level === 1) {
    const hit = { x: d.x - u.x * radius * 0.22, y: d.y - u.y * radius * 0.22 };
    const ctrl = bend(L * 0.42, (24 + c.wigglePx) * scale);
    return { prop, base, angle, dir, k, flip, anchor, mouth, paths: [{ from, ctrl, to: hit, wiggle: c.wigglePx * scale, hz: c.wiggleHz }], strikes: [hit], bloom: null, bloomR: 0 };
  }
  // The candle: three balls, each on its own arc, landing left, right and then in the middle of the face.
  const spread = radius * c.candleSpread;
  const strikes: Pt[] = [
    { x: d.x + n.x * spread - u.x * radius * 0.1, y: d.y + n.y * spread - u.y * radius * 0.1 },
    { x: d.x - n.x * spread - u.x * radius * 0.1, y: d.y - n.y * spread - u.y * radius * 0.1 },
    { x: d.x - u.x * radius * 0.05, y: d.y - u.y * radius * 0.05 },
  ];
  const paths = strikes.map((to, i): FireworksPath => {
    return { from: mouth, ctrl: bend(L * (0.36 + 0.07 * i), 30 * scale), to, wiggle: 0, hz: 0 };
  });
  return { prop, base, angle, dir, k, flip, anchor, mouth, paths, strikes, bloom: null, bloomR: 0 };
}

/** The direction THE blow arrives along: the last flight's final heading, or (the mortar) from the bloom down. Unit. */
export function fireworksArrivalDir(p: FireworksPlan, g: FireworksGeo, a: Pt, d: Pt): Pt {
  let from = a, to = d;
  if (g.bloom) { from = g.bloom; to = { x: d.x, y: d.y + 1 }; } else {
    const path = g.paths[g.paths.length - 1];
    if (path) { from = path.ctrl; to = path.to; }
  }
  const L = Math.hypot(to.x - from.x, to.y - from.y) || 1;
  return { x: (to.x - from.x) / L, y: (to.y - from.y) / L };
}

// ─── the camera (pure) ─────────────────────────────────────────────────────────────────────────────────────────

const springAt = (ms: number, hz: number, tau: number): number => (ms < 0 ? 0 : Math.exp(-ms / tau) * Math.cos(2 * Math.PI * hz * (ms / 1000)));
const sine = (u: number): number => 0.5 - 0.5 * Math.cos(Math.PI * Math.min(1, Math.max(0, u)));
/** How long a launch kick lasts: it is CUT here, so the mortar's thump is over before the held beat. */
export const LAUNCH_KICK_MS = 200;

/**
 * The camera at sequence time `t`: a small push in while the fuse burns (the mortar: as the comet rises); a kick on
 * every launch; a nudge on every pop; on THE impact a punch in and a directional shake. Through the mortar's HELD
 * BEAT it is exactly still (the same zoom, no offset). Deterministic. Pure.
 */
export function fireworksCameraAt(p: FireworksPlan, c: HeroFireworksConfig, t: number, dir: Pt = { x: 1, y: 0 }): { zoom: number; x: number; y: number } {
  if (p.reduced) return { zoom: 1, x: 0, y: 0 };
  const first = p.launches[0] ?? p.impactAt;
  const mortar = p.holdMs > 0;
  let z = 0;
  if (t >= p.chargeAt && t < p.impactAt) {
    z = mortar ? p.zoom * sine((t - first) / Math.max(1, p.holdAt - first)) : p.zoom * sine((t - p.chargeAt) / Math.max(1, first - p.chargeAt));
  } else if (t >= p.impactAt) {
    z = (p.zoom + p.punch) * Math.exp(-(t - p.impactAt) / Math.max(1, c.zoomOutMs / 4));
  }
  let x = 0, y = 0;
  const kick = (at: number, amp: number, tau: number, hz: number, v: Pt, cut = Infinity): void => {
    const age = t - at;
    if (age < 0 || age >= cut) return;
    const fade = cut === Infinity ? 1 : 1 - age / cut;
    const s = springAt(age, hz, tau) * fade;
    const across = amp * 0.25 * Math.sin(age * 0.11) * Math.exp(-age / tau) * fade;
    x += v.x * amp * s - v.y * across;
    y += v.y * amp * s + v.x * across;
  };
  // A launch kicks the view DOWN (the recoil of the tube), hardest for the mortar.
  const down = { x: 0, y: 1 };
  for (const at of p.launches) kick(at, p.shakePx * (mortar ? 0.45 : p.level === 2 ? 0.22 : 0.3), 38, 17, down, LAUNCH_KICK_MS);
  for (const at of p.hits) kick(at, p.shakePx * 0.4, 40, 18, dir);
  kick(p.impactAt, p.shakePx, Math.max(1, c.shakeMs / 4), 16, dir);
  return { zoom: 1 + Math.max(0, z), x, y };
}

/** Where the camera anchors: the ATTACKER until the first launch, gliding to the struck hero over the first flight. Pure. */
export function fireworksCameraFocus(p: FireworksPlan, t: number, a: Pt, d: Pt): Pt {
  const from = p.launches[0] ?? p.impactAt;
  const to = from + Math.max(1, p.flyMs);
  if (t <= from) return a;
  if (t >= to) return d;
  const e = sine((t - from) / (to - from));
  return { x: a.x + (d.x - a.x) * e, y: a.y + (d.y - a.y) * e };
}
