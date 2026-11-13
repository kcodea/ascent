/**
 * THE FOURTH WALL HERO ATTACK ("Fourth Wall", style id `glass`; ANCIENT rarity, dev-only until it gets a cosmetic): its
 * tuned values, its pure timeline, the pure crack and shard geometry and the pure camera.
 *
 * THE SIGNATURE: THE SCREEN ITSELF IS A PANE OF GLASS between the player and the game, and the blow breaks it. The
 * cracks are drawn ON the screen surface, over everything; in the top look the whole view shatters into shards that
 * fall away and the scene is simply there behind them, clean. No other attack treats the screen as an object.
 *
 * FOUR LOOKS on the shared thresholds (`attackTier`: a knockout always plays IV):
 *  - I, THE CHIP: a pebble flicked from the striker taps the glass over the struck portrait: a star-shaped chip, three
 *    short cracks, a glint. It heals (fades) after a beat.
 *  - II, THE WEB: two pebbles in quick succession; the cracks from both spread in little jumps and join into a spider
 *    web about the size of the portrait.
 *  - III, THE PANE: one hard rock; the web grows large and the PANE round the struck portrait breaks out: its shards tip
 *    forward and fall off the bottom of the screen, a dark hole stays for a beat, then the pane repairs in a shimmer.
 *  - IV, THE SHATTER: the striker winds up and punches the glass; ONE CRACK RACES across the whole screen through both
 *    portraits, edge to edge, branching as it goes; a held beat of fine creaking (the web fills in, the picture sits a
 *    hair offset either side of the crack); then THE WHOLE SCREEN SHATTERS: forty to seventy shards that tile the view
 *    burst a little, tumble and fall away under gravity over a white-blue flash. The blow lands at the shatter.
 *
 * ONE GEOMETRY: the cracks ARE the shard edges. A web is a fan of jittered spokes and rings round the impact point
 * (`buildWeb`); its spokes, rings and diagonals are the crack lines, and the same cells are the shards, so the screen
 * breaks exactly where it cracked. Everything is generated from the blow's seed (never `Math.random`).
 *
 * NEVER A FROZEN FRAME (R-PROG-ATTACK-10): the held beat keeps creaking, and IV's shatter gets a slow-mo DIP through the
 * frame source (a smooth ramp that never reaches 0), never a hit-stop.
 *
 * THE CONTRACT: II's first pebble is a tick (FX and sound only). The consequence lands exactly ONCE, on the impact beat
 * (the tap, the second tap, the rock, or IV's shatter). Reduced motion: fades only.
 */
import { configStore } from '../heroAttack/configStore';
import { clamp, seededRng, type Pt } from '../heroAttack/easing';
import {
  HERO_ATTACK_TIER_THRESHOLDS, TIERS, reducedAttackTimeline, attackTier, isKnockoutVariant, type AttackTierContext, type TierNum,
} from '../heroAttack/tiers';
import { KO_SHAKE, koDipExtraMs, koTimeScale, type KoDip } from '../heroAttack/knockout';

export type { TierNum };

export const GLASS_LEVELS = ['t1', 't2', 't3', 't4'] as const;
export type GlassLevel = (typeof GLASS_LEVELS)[number];

export const GLASS_TIER_SUFFIXES = [
  'ReadyMs', 'FlyMs', 'GrowMs', 'HoldMs', 'Web', 'Shake', 'Zoom', 'Push', 'Punch', 'SettleMs', 'Dim',
] as const;
export type GlassTierSuffix = (typeof GLASS_TIER_SUFFIXES)[number];
type TierKey = `${GlassLevel}${GlassTierSuffix}`;

interface GlobalConfig {
  tier2At: number; tier3At: number; tier4At: number;
  absorbMs: number;
  /** II: the gap between the two pebbles. */
  secondMs: number;
  /** III: the pane breaks out this long after the rock lands, and the hole stays this long before the repair. */
  breakMs: number;
  holeMs: number;
  /** I to III: the cracks fade (the glass heals) over this. */
  healMs: number;
  /** How many little jumps the cracks spread in (each one creaks). */
  creakJumps: number;
  /** IV: the slow-mo dip on the shatter (lowest clock speed, and how long it takes to ease back, attack ms). */
  slowMo: number;
  slowMoMs: number;
  /** The shards: gravity (px/s^2), the outward burst (px/s), the tumble (radians/s) and the rim highlight (px). */
  shardGravity: number;
  shardBurst: number;
  shardSpin: number;
  shardRim: number;
  /** The pebble's size (px) and how high its flight arcs (a fraction of the distance). */
  stonePx: number;
  stoneArc: number;
  /** A crack line's thickness multiplier. */
  crackWidth: number;
  /** IV: how strong the faint offset tint either side of the main crack is. */
  splitAlpha: number;
  impactSize: number;
  heroWindPx: number;
  heroThrowPx: number;
  knockPx: number;
  squash: number;
  shakeMs: number;
  zoomOutMs: number;
  reducedFadeMs: number;
  colorGlass: string;
  colorEdge: string;
  colorShade: string;
  colorFlash: string;
  colorStone: string;
  colorPlayer: string;
  colorFoe: string;
  sfxThrowClip: string; sfxThrowGain: number; sfxThrowRate: number;
  sfxTickClip: string; sfxTickGain: number; sfxTickRate: number;
  sfxCreakClip: string; sfxCreakGain: number; sfxCreakRate: number;
  sfxRaceClip: string; sfxRaceGain: number; sfxRaceRate: number;
  sfxPaneClip: string; sfxPaneGain: number; sfxPaneRate: number;
  sfxShatterClip: string; sfxShatterGain: number; sfxShatterRate: number;
  sfxRepairClip: string; sfxRepairGain: number; sfxRepairRate: number;
  sfxThudClip: string; sfxThudGain: number; sfxThudRate: number;
  sfxTailMix: number;
  sfxDuck: number;
  previewDamage: number;
  previewParts: number;
}
export type HeroGlassConfig = GlobalConfig & Record<TierKey, number>;

export const HERO_GLASS_COLOR_KEYS = ['colorGlass', 'colorEdge', 'colorShade', 'colorFlash', 'colorStone', 'colorPlayer', 'colorFoe'] as const;
export const HERO_GLASS_CLIP_KEYS = [
  'sfxThrowClip', 'sfxTickClip', 'sfxCreakClip', 'sfxRaceClip', 'sfxPaneClip', 'sfxShatterClip', 'sfxRepairClip', 'sfxThudClip',
] as const;
export type HeroGlassStrKey = (typeof HERO_GLASS_COLOR_KEYS)[number] | (typeof HERO_GLASS_CLIP_KEYS)[number];
export type HeroGlassNumKey = Exclude<keyof HeroGlassConfig, HeroGlassStrKey>;

/**
 * Per look, I / II / III / IV. `FlyMs`: the pebble's flight (IV: the crack's race across the screen). `GrowMs`: how long
 * the cracks keep spreading after the hit (IV: unused, the hold sets it). `HoldMs`: I and II how long the cracks stay
 * before they heal; IV the held beat before the shatter (III: unused, the pane's break and repair set it). `Web`: the
 * web's reach in struck-portrait radii (IV: unused, it covers the screen).
 */
const TIER_DEFAULTS: Record<GlassTierSuffix, [number, number, number, number]> = {
  ReadyMs: [200, 200, 240, 340],
  FlyMs: [300, 280, 230, 400],
  GrowMs: [70, 300, 280, 0],
  HoldMs: [430, 420, 0, 460],
  Web: [0.9, 1.2, 3.3, 0],
  Shake: [4, 7, 14, 30],
  Zoom: [0.012, 0.018, 0.026, 0.035],
  Push: [0, 0, 0.02, 0.05],
  Punch: [0.02, 0.03, 0.05, 0.09],
  SettleMs: [700, 860, 1300, 900],
  Dim: [0.08, 0.12, 0.18, 0.26],
};

export const GLASS_TIER_RANGES: Record<GlassTierSuffix, [number, number, number]> = {
  ReadyMs: [80, 1500, 10],
  FlyMs: [80, 1200, 10],
  GrowMs: [0, 1200, 10],
  HoldMs: [0, 2000, 10],
  Web: [0, 6, 0.05],
  Shake: [0, 40, 0.5],
  Zoom: [0, 0.1, 0.002],
  Push: [0, 0.2, 0.002],
  Punch: [0, 0.15, 0.001],
  SettleMs: [0, 2500, 10],
  Dim: [0, 0.6, 0.01],
};

const tierDefaults = Object.fromEntries(TIERS.flatMap((t) => GLASS_TIER_SUFFIXES.map((s) => [`t${t}${s}`, TIER_DEFAULTS[s][t - 1]]))) as Record<TierKey, number>;

export const HERO_GLASS_DEFAULTS: HeroGlassConfig = {
  ...HERO_ATTACK_TIER_THRESHOLDS,
  absorbMs: 160,
  secondMs: 170,
  breakMs: 330,
  holeMs: 560,
  healMs: 280,
  creakJumps: 5,
  slowMo: 0.3,
  slowMoMs: 380,
  shardGravity: 3800,
  shardBurst: 300,
  shardSpin: 2.2,
  shardRim: 9,
  stonePx: 46,
  stoneArc: 0.12,
  crackWidth: 1,
  splitAlpha: 0.07,
  impactSize: 1,
  heroWindPx: 10,
  heroThrowPx: 14,
  knockPx: 20,
  squash: 0.09,
  shakeMs: 360,
  zoomOutMs: 420,
  reducedFadeMs: 260,
  colorGlass: '#bfe3ff',
  colorEdge: '#ffffff',
  colorShade: '#0a1626',
  colorFlash: '#e2f3ff',
  colorStone: '#9a9186',
  colorPlayer: '#ffe9b0',
  colorFoe: '#ff7a5c',
  sfxThrowClip: 'fx/stereogenicstudio-swish-swoosh-woosh-sfx-27-357164-3', sfxThrowGain: 0.3, sfxThrowRate: 1.5,
  sfxTickClip: 'fx/glass-tick', sfxTickGain: 0.7, sfxTickRate: 1,
  sfxCreakClip: 'fx/glass-creak', sfxCreakGain: 0.5, sfxCreakRate: 1,
  sfxRaceClip: 'fx/glass-race', sfxRaceGain: 0.6, sfxRaceRate: 1,
  sfxPaneClip: 'fx/glass-pane', sfxPaneGain: 0.6, sfxPaneRate: 1,
  sfxShatterClip: 'fx/glass-shatter', sfxShatterGain: 0.7, sfxShatterRate: 1,
  sfxRepairClip: 'equipmentsheen', sfxRepairGain: 0.28, sfxRepairRate: 1.5,
  sfxThudClip: 'fx/universfield-ground-impact-352053', sfxThudGain: 0.4, sfxThudRate: 1.1,
  sfxTailMix: 0.15,
  sfxDuck: 0.6,
  previewDamage: 12,
  previewParts: 4,
  ...tierDefaults,
};

const GLOBAL_RANGES: Record<Exclude<keyof GlobalConfig, HeroGlassStrKey>, [number, number, number]> = {
  tier2At: [2, 40, 1], tier3At: [2, 60, 1], tier4At: [2, 80, 1],
  absorbMs: [60, 600, 10],
  secondMs: [60, 600, 10],
  breakMs: [80, 1200, 10],
  holeMs: [100, 2000, 10],
  healMs: [60, 1200, 10],
  creakJumps: [2, 10, 1],
  slowMo: [0.1, 1, 0.01],
  slowMoMs: [0, 1200, 10],
  shardGravity: [600, 8000, 50],
  shardBurst: [0, 1500, 10],
  shardSpin: [0, 10, 0.1],
  shardRim: [2, 30, 0.5],
  stonePx: [10, 120, 1],
  stoneArc: [0, 0.5, 0.01],
  crackWidth: [0.3, 3, 0.05],
  splitAlpha: [0, 0.3, 0.005],
  impactSize: [0.3, 3, 0.05],
  heroWindPx: [0, 40, 1],
  heroThrowPx: [0, 50, 1],
  knockPx: [0, 60, 1],
  squash: [0, 0.3, 0.01],
  shakeMs: [0, 1500, 10],
  zoomOutMs: [60, 1500, 10],
  reducedFadeMs: [60, 1000, 10],
  sfxThrowGain: [0, 2, 0.05], sfxThrowRate: [0.5, 2.5, 0.01],
  sfxTickGain: [0, 2, 0.05], sfxTickRate: [0.5, 2.5, 0.01],
  sfxCreakGain: [0, 2, 0.05], sfxCreakRate: [0.5, 2.5, 0.01],
  sfxRaceGain: [0, 2, 0.05], sfxRaceRate: [0.5, 2.5, 0.01],
  sfxPaneGain: [0, 2, 0.05], sfxPaneRate: [0.5, 2.5, 0.01],
  sfxShatterGain: [0, 2, 0.05], sfxShatterRate: [0.5, 2.5, 0.01],
  sfxRepairGain: [0, 2, 0.05], sfxRepairRate: [0.5, 2.5, 0.01],
  sfxThudGain: [0, 2, 0.05], sfxThudRate: [0.5, 2.5, 0.01],
  sfxTailMix: [0, 1, 0.01],
  sfxDuck: [0, 1, 0.05],
  previewDamage: [1, 60, 1],
  previewParts: [1, 8, 1],
};

export const HERO_GLASS_RANGES: Record<HeroGlassNumKey, [number, number, number]> = {
  ...GLOBAL_RANGES,
  ...(Object.fromEntries(TIERS.flatMap((t) => GLASS_TIER_SUFFIXES.map((s) => [`t${t}${s}`, GLASS_TIER_RANGES[s]]))) as Record<TierKey, [number, number, number]>),
};

/** Hard caps whatever the tuner says. */
export const GLASS_CAPS = { shards: 70, minShards: 40, cracks: 420, shakePx: 40, zoom: 0.1 } as const;

const store = configStore<HeroGlassConfig>({
  key: 'ascent.heroglass.v2', defaults: HERO_GLASS_DEFAULTS, ranges: HERO_GLASS_RANGES,
  colorKeys: HERO_GLASS_COLOR_KEYS, clipKeys: HERO_GLASS_CLIP_KEYS, previewKeys: ['previewDamage', 'previewParts'],
});
export const heroGlassStore = store;
export const getHeroGlassConfig = store.get;
export const clampHeroGlassValue = store.clamp;
export const sanitizeHeroGlassConfig = store.sanitize;
export const heroGlassConfigJson = store.json;
/** The preview speed hook (Recruit + the Collection read one per style). Always 1. */
export function heroGlassPreviewSpeed(): number { return 1; }

export function glassTierDials(tier: TierNum, c: HeroGlassConfig = store.get()): Record<GlassTierSuffix, number> {
  return Object.fromEntries(GLASS_TIER_SUFFIXES.map((s) => [s, c[`t${tier}${s}`]])) as Record<GlassTierSuffix, number>;
}

// ─── the pure plan ─────────────────────────────────────────────────────────────────────────────────────────────

export const GLASS_REF_DISTANCE = 1600;

/** A flight (or IV's race) scaled gently by the distance between the two portraits. */
export function glassLegMs(distance: number, ms: number): number {
  const d = Number.isFinite(distance) && distance > 0 ? distance : GLASS_REF_DISTANCE;
  return Math.round(ms * clamp(Math.sqrt(d / GLASS_REF_DISTANCE), 0.62, 1.15));
}

/** One thrown pebble: it leaves the hand (`launchAt`) and taps the glass (`hitAt`). */
export interface GlassStone { launchAt: number; hitAt: number }

export interface GlassPlanInput extends AttackTierContext {
  leadIn?: number;
  total: number;
  distance: number;
  reduced?: boolean;
}

export type GlassKind = 'chip' | 'web' | 'pane' | 'shatter';

export interface GlassPlan {
  reduced: boolean;
  tier: TierNum;
  kind: GlassKind;
  k: number;
  total: number;
  chargeAt: number;
  absorbEnd: number;
  /** The flick (I to III) or the punch on the glass (IV). */
  fireAt: number;
  /** I and III one, II two, IV none. */
  stones: GlassStone[];
  /** IV: the one crack races across the screen from `raceAt` to `raceEnd` (other looks: both the impact). */
  raceAt: number;
  raceEnd: number;
  /** The cracks spread in little jumps: each time is one jump (and one creak). Ascending. */
  jumps: number[];
  /** Taps BEFORE the blow (II's first pebble). */
  hits: number[];
  impactAt: number;
  /** The glass breaks out: III's pane a beat after the rock, IV's whole screen on the impact (I, II: never, -1). */
  breakAt: number;
  /** III: the pane repairs (-1 otherwise). */
  repairAt: number;
  /** I to III: the cracks fade from `healAt` to `healEnd` (IV: the shatter takes them, both the impact). */
  healAt: number;
  healEnd: number;
  /** The Knockout variant ("Tier V"): IV with the prism, a bigger shake and a deeper dip. */
  ko: boolean;
  /** IV's slow-mo dip on the shatter (null below IV): the one clock eases down and back, never 0. */
  dip: KoDip | null;
  endAt: number;
  /** The web's reach in struck radii (IV: 0, it covers the screen). */
  web: number;
  shakePx: number;
  zoom: number;
  push: number;
  punch: number;
  dim: number;
}

export function glassKind(tier: TierNum): GlassKind { return tier === 1 ? 'chip' : tier === 2 ? 'web' : tier === 3 ? 'pane' : 'shatter'; }

/** `n` jump times from `from` to `to`, the gaps shrinking (the creaking quickens). */
function spread(from: number, to: number, n: number): number[] {
  const out: number[] = [];
  const span = Math.max(0, to - from);
  for (let i = 0; i < n; i++) { const u = n <= 1 ? 0 : i / (n - 1); out.push(Math.round(from + span * (1 - (1 - u) * (1 - u) * 0.55 - (1 - u) * 0.45))); }
  return out;
}

/** The whole Fourth Wall, in base ms. Pure and deterministic. */
export function glassPlan(input: GlassPlanInput, c: HeroGlassConfig = store.get()): GlassPlan {
  const total = Math.max(0, Math.round(input.total));
  const tier = attackTier(total, input, c); // a knockout always plays the shared Tier IV
  const kind = glassKind(tier);
  const ko = tier === 4 && isKnockoutVariant(input);
  const L = glassTierDials(tier, c);
  const k = (tier - 1) / 3;
  const base = {
    tier, kind, k, total, ko, web: L.Web, shakePx: clamp(L.Shake * (ko ? KO_SHAKE : 1), 0, GLASS_CAPS.shakePx), zoom: clamp(L.Zoom, 0, GLASS_CAPS.zoom),
    push: L.Push, punch: L.Punch * (ko ? 1.2 : 1), dim: L.Dim,
  };
  if (input.reduced) {
    const r = reducedAttackTimeline(input.leadIn ?? 0, c.reducedFadeMs);
    const at = r.impactAt;
    return {
      ...base, reduced: true, chargeAt: at, absorbEnd: at, fireAt: at, stones: [], raceAt: at, raceEnd: at, jumps: [], hits: [], impactAt: at,
      breakAt: -1, repairAt: -1, healAt: at, healEnd: at, dip: null, endAt: r.endAt, web: 0, shakePx: 0, zoom: 0, push: 0, punch: 0, dim: 0,
    };
  }
  const chargeAt = Math.max(0, input.leadIn ?? 0);
  const absorbEnd = chargeAt + c.absorbMs;
  const fireAt = chargeAt + Math.max(L.ReadyMs, c.absorbMs);
  const fly = glassLegMs(input.distance, L.FlyMs);
  const J = Math.round(clamp(c.creakJumps, 2, 10));
  const stones: GlassStone[] = [];
  const hits: number[] = [];
  let raceAt: number, raceEnd: number, impactAt: number, jumps: number[], breakAt = -1, repairAt = -1, healAt: number, healEnd: number;
  if (kind === 'shatter') {
    raceAt = fireAt; raceEnd = fireAt + fly;
    impactAt = raceEnd + Math.max(120, L.HoldMs);
    // The web round the struck portrait starts as the racing crack passes it, and keeps creaking to just before the shatter.
    jumps = spread(raceAt + fly * 0.62, impactAt - 70, J + 2);
    breakAt = impactAt; healAt = impactAt; healEnd = impactAt;
  } else {
    stones.push({ launchAt: fireAt, hitAt: fireAt + fly });
    if (kind === 'web') { const gap = Math.max(60, c.secondMs); stones.push({ launchAt: fireAt + gap, hitAt: fireAt + fly + gap }); hits.push(fireAt + fly); }
    impactAt = stones[stones.length - 1]!.hitAt;
    raceAt = impactAt; raceEnd = impactAt;
    // The first jump is the tap itself (II: one per pebble); the rest creak outward over `GrowMs`.
    jumps = kind === 'chip'
      ? [impactAt, impactAt + Math.max(20, L.GrowMs)]
      : [...(kind === 'web' ? [stones[0]!.hitAt] : []), impactAt, ...spread(impactAt + 60, impactAt + Math.max(80, L.GrowMs), J - 1)];
    const grown = jumps[jumps.length - 1]!;
    if (kind === 'pane') {
      breakAt = Math.max(grown + 40, impactAt + c.breakMs);
      repairAt = breakAt + c.holeMs;
      healAt = repairAt;
    } else healAt = grown + L.HoldMs;
    healEnd = healAt + c.healMs;
  }
  const endAt = Math.max(impactAt + Math.max(c.zoomOutMs * 0.8, L.SettleMs), healEnd + 40);
  // IV's dip on the shatter; the Knockout's is deeper and longer.
  const dip: KoDip | null = tier === 4 && c.slowMoMs > 0
    ? { at: impactAt, lo: ko ? Math.max(0.1, c.slowMo * 0.8) : c.slowMo, ms: c.slowMoMs + (ko ? 60 : 0) }
    : null;
  return { ...base, reduced: false, chargeAt, absorbEnd, fireAt, stones, raceAt, raceEnd, jumps, hits, impactAt, breakAt, repairAt, healAt, healEnd, dip, endAt };
}

export type GlassCueKind = 'charge' | 'throw' | 'race' | 'tap' | 'creak' | 'impact' | 'break' | 'repair' | 'heal' | 'end';
export interface GlassCue { at: number; kind: GlassCueKind; i: number }

export function glassCues(p: GlassPlan): GlassCue[] {
  const out: GlassCue[] = [];
  if (!p.reduced) {
    out.push({ at: p.chargeAt, kind: 'charge', i: 0 });
    p.stones.forEach((s, i) => out.push({ at: s.launchAt, kind: 'throw', i }));
    if (p.kind === 'shatter') out.push({ at: p.raceAt, kind: 'race', i: 0 });
    p.hits.forEach((at, i) => out.push({ at, kind: 'tap', i }));
    // A jump that IS a tap (or the blow) makes its own sound; the others creak.
    p.jumps.forEach((at, i) => { if (at !== p.impactAt && !p.hits.includes(at)) out.push({ at, kind: 'creak', i }); });
    if (p.kind === 'pane') { out.push({ at: p.breakAt, kind: 'break', i: 0 }); out.push({ at: p.repairAt, kind: 'repair', i: 0 }); }
    if (p.kind !== 'shatter') out.push({ at: p.healAt, kind: 'heal', i: 0 });
  }
  out.push({ at: p.impactAt, kind: 'impact', i: 0 });
  out.push({ at: p.endAt, kind: 'end', i: 0 });
  const order: Record<GlassCueKind, number> = { charge: 0, throw: 1, race: 2, tap: 3, creak: 4, impact: 5, break: 6, repair: 7, heal: 8, end: 9 };
  return out.sort((a, b) => a.at - b.at || order[a.kind] - order[b.kind]);
}

/**
 * IV's SLOW-MO DIP on the shatter (a freeze is banned, R-PROG-ATTACK-10): the one clock drops to `slowMo` the instant the
 * screen breaks and eases back over `slowMoMs`, a smooth ramp never reaching 0, so the shards hang for a breath.
 */
export function glassScale(p: GlassPlan, c: HeroGlassConfig, t: number): number {
  void c;
  return p.reduced ? 1 : koTimeScale(p.dip, t);
}

export function glassSlowExtraMs(p: GlassPlan, c: HeroGlassConfig): number {
  void c;
  return p.reduced ? 0 : koDipExtraMs(p.dip);
}

// ─── the geometry (pure) ───────────────────────────────────────────────────────────────────────────────────────

export type Box = { x: number; y: number; w: number; h: number };

/**
 * One crack line: a straight piece from `a` to `b` that GROWS from `a` between `t0` and `t1` (sequence ms; a jump is a
 * few tens of ms, IV's race a real sweep). `w`: its thickness (the main crack heavier, a hairline branch lighter).
 */
export interface CrackSeg { ax: number; ay: number; bx: number; by: number; len: number; ang: number; w: number; t0: number; t1: number }

/** One shard: a triangle of the broken glass (its three corners, its centre and how far that is from the impact). */
export interface ShardTri { x: [number, number, number]; y: [number, number, number]; cx: number; cy: number; dist: number }

/** A web: `nodes[ring][spoke]` round `origin` (ring 0 the innermost), spoke 0 pointing along `aim`. */
export interface GlassWeb { origin: Pt; spokes: number; rings: number; nodes: Pt[][] }

/**
 * A SPIDER WEB round `origin`: `spokes` rays at jittered angles (spoke 0 exactly along `aim`, and with an even count the
 * opposite spoke exactly against it, so one straight fracture runs through the middle) crossing rings at the jittered
 * `radii`. The last ring is never pulled inward, so a web sized to cover a box still covers it. Pure.
 */
export function buildWeb(rnd: () => number, origin: Pt, aim: number, spokes: number, radii: readonly number[]): GlassWeb {
  const N = Math.max(3, Math.round(spokes));
  const gap = (Math.PI * 2) / N;
  const angles: number[] = [];
  for (let s = 0; s < N; s++) {
    const straight = s === 0 || (N % 2 === 0 && s === N / 2);
    angles.push(aim + gap * (s + (straight ? 0 : (rnd() - 0.5) * 0.5)));
  }
  const nodes: Pt[][] = [];
  radii.forEach((r, ri) => {
    const last = ri === radii.length - 1;
    const row: Pt[] = [];
    for (let s = 0; s < N; s++) {
      const rr = r * (last ? 1 + rnd() * 0.08 : 0.86 + rnd() * 0.28);
      const a = angles[s]! + (last || s === 0 || (N % 2 === 0 && s === N / 2) ? 0 : (rnd() - 0.5) * gap * 0.12);
      row.push({ x: origin.x + Math.cos(a) * rr, y: origin.y + Math.sin(a) * rr });
    }
    nodes.push(row);
  });
  return { origin: { x: origin.x, y: origin.y }, spokes: N, rings: radii.length, nodes };
}

const tri = (o: Pt, a: Pt, b: Pt, c: Pt): ShardTri => {
  const cx = (a.x + b.x + c.x) / 3, cy = (a.y + b.y + c.y) / 3;
  return { x: [a.x, b.x, c.x], y: [a.y, b.y, c.y], cx, cy, dist: Math.hypot(cx - o.x, cy - o.y) };
};

/**
 * The web's cells as triangles: the centre fan, then every cell between two rings split along a diagonal (`flip[ring][s]`
 * says which, the same choice the crack lines draw). They share their corners, so together they tile the web exactly.
 * `upTo`: how many rings of cells (1 = the centre fan only). `bounds`: drop a triangle wholly outside it.
 */
export function webTris(w: GlassWeb, flips: readonly (readonly boolean[])[], upTo = w.rings, bounds?: Box): ShardTri[] {
  const out: ShardTri[] = [];
  const N = w.spokes;
  const keep = (t: ShardTri): void => {
    if (bounds) {
      const x0 = Math.min(...t.x), x1 = Math.max(...t.x), y0 = Math.min(...t.y), y1 = Math.max(...t.y);
      if (x1 <= bounds.x || x0 >= bounds.x + bounds.w || y1 <= bounds.y || y0 >= bounds.y + bounds.h) return;
    }
    out.push(t);
  };
  for (let s = 0; s < N; s++) keep(tri(w.origin, w.origin, w.nodes[0]![s]!, w.nodes[0]![(s + 1) % N]!));
  for (let r = 1; r < Math.min(upTo, w.rings); r++) {
    for (let s = 0; s < N; s++) {
      const a = w.nodes[r - 1]![s]!, b = w.nodes[r - 1]![(s + 1) % N]!, c2 = w.nodes[r]![(s + 1) % N]!, d = w.nodes[r]![s]!;
      if (flips[r]?.[s]) { keep(tri(w.origin, a, b, d)); keep(tri(w.origin, b, c2, d)); } else { keep(tri(w.origin, a, b, c2)); keep(tri(w.origin, a, c2, d)); }
    }
  }
  return out;
}

/** Which diagonal each cell splits along, rolled once per web. */
export function webFlips(rnd: () => number, w: GlassWeb): boolean[][] {
  return w.nodes.map(() => Array.from({ length: w.spokes }, () => rnd() < 0.5));
}

const inBox = (x: number, y: number, b: Box, m = 0): boolean => x >= b.x - m && x <= b.x + b.w + m && y >= b.y - m && y <= b.y + b.h + m;

/** How far a ray from `o` along `a` travels before it leaves `b` (0 when `o` is outside). */
export function rayExit(o: Pt, a: number, b: Box): number {
  if (!inBox(o.x, o.y, b)) return 0;
  const dx = Math.cos(a), dy = Math.sin(a);
  const tx = Math.abs(dx) < 1e-9 ? Infinity : ((dx > 0 ? b.x + b.w : b.x) - o.x) / dx;
  const ty = Math.abs(dy) < 1e-9 ? Infinity : ((dy > 0 ? b.y + b.h : b.y) - o.y) / dy;
  return Math.max(0, Math.min(tx, ty));
}

/** Everything one blow draws on the glass, decided once (the runner and the scene only read it). */
export interface GlassGeo {
  /** Where each pebble leaves the striker and where it taps (I, III one; II two; IV none). */
  hand: Pt;
  taps: Pt[];
  /** The chips (the star-shaped pits): at each tap, or IV where the striker punches the glass. */
  chips: { at: Pt; size: number; jump: number }[];
  /** Every crack line, in the order it starts growing. */
  segs: CrackSeg[];
  /** The shards that fall (III: the pane's; IV: the whole screen's, tiling it), and the impact they burst from. */
  tris: ShardTri[];
  origin: Pt;
  /** IV: the main crack's two ends on the screen edges (null otherwise). */
  main: { a: Pt; b: Pt } | null;
}

interface SegSink { segs: CrackSeg[]; rnd: () => number; bounds?: Box; unit: number; width: number }

/**
 * A crack from `a` to `b` growing over [t0, t1]: cut into a few jagged pieces (a real fracture never runs straight),
 * each growing in turn, so a long crack visibly travels. Pieces wholly off the screen are dropped.
 */
function crack(k: SegSink, a: Pt, b: Pt, w: number, t0: number, t1: number, jag = 1): void {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  if (len < 1) return;
  const n = Math.max(1, Math.min(4, Math.round(len / (120 * k.unit))));
  const nx = -(b.y - a.y) / len, ny = (b.x - a.x) / len;
  let px = a.x, py = a.y;
  for (let i = 1; i <= n; i++) {
    const u = i / n;
    const off = i === n ? 0 : (k.rnd() - 0.5) * 2 * Math.min(len * 0.05, 9 * k.unit) * jag;
    const qx = a.x + (b.x - a.x) * u + nx * off, qy = a.y + (b.y - a.y) * u + ny * off;
    const m = 20 * k.unit;
    if (!k.bounds || inBox(px, py, k.bounds, m) || inBox(qx, qy, k.bounds, m) || inBox((px + qx) / 2, (py + qy) / 2, k.bounds, m)) {
      const l = Math.hypot(qx - px, qy - py);
      if (k.segs.length < GLASS_CAPS.cracks && l > 0.5) {
        k.segs.push({ ax: px, ay: py, bx: qx, by: qy, len: l, ang: Math.atan2(qy - py, qx - px), w: w * k.width, t0: t0 + (t1 - t0) * ((i - 1) / n), t1: t0 + (t1 - t0) * u });
      }
    }
    px = qx; py = qy;
  }
}

/** A short dead-end hairline off `at`, heading roughly along `ang`. */
function branch(k: SegSink, at: Pt, ang: number, len: number, t0: number): void {
  const a = ang + (k.rnd() < 0.5 ? -1 : 1) * (0.45 + k.rnd() * 0.5);
  const mid = { x: at.x + Math.cos(a) * len * 0.55, y: at.y + Math.sin(a) * len * 0.55 };
  const a2 = a + (k.rnd() - 0.5) * 0.7;
  crack(k, at, mid, 0.6, t0, t0 + 30, 0.6);
  crack(k, mid, { x: mid.x + Math.cos(a2) * len * 0.45, y: mid.y + Math.sin(a2) * len * 0.45 }, 0.45, t0 + 30, t0 + 60, 0.6);
}

const JUMP_MS = 46;

/**
 * A web's crack lines, spreading outward in the plan's jumps: ring `r`'s spokes land on jump `first + r * per`, its ring
 * a breath later, its diagonals (when `diag`) after that. `rings`: how many rings draw their ring lines.
 */
function webCracks(k: SegSink, w: GlassWeb, flips: readonly (readonly boolean[])[], jumps: readonly number[], first: number, o: { ringLines: number; diag: boolean; branches: number; skip?: ReadonlySet<number> }): void {
  const N = w.spokes;
  const last = jumps.length - 1;
  const jumpOf = (r: number): number => jumps[Math.min(last, first + Math.round((r * Math.max(0, last - first)) / Math.max(1, w.rings - 1)))]!;
  for (let r = 0; r < w.rings; r++) {
    const t = jumpOf(r);
    for (let s = 0; s < N; s++) {
      if (o.skip?.has(s)) continue;
      const from = r === 0 ? w.origin : w.nodes[r - 1]![s]!;
      const st = t + k.rnd() * 24;
      crack(k, from, w.nodes[r]![s]!, r === 0 ? 1 : 0.85, st, st + JUMP_MS);
      if (k.rnd() < o.branches) branch(k, w.nodes[r]![s]!, Math.atan2(w.nodes[r]![s]!.y - from.y, w.nodes[r]![s]!.x - from.x), Math.hypot(w.nodes[r]![s]!.x - from.x, w.nodes[r]![s]!.y - from.y) * 0.4, st + JUMP_MS);
    }
    if (r < o.ringLines) {
      for (let s = 0; s < N; s++) {
        const st = t + 30 + k.rnd() * 30;
        crack(k, w.nodes[r]![s]!, w.nodes[r]![(s + 1) % N]!, 0.7, st, st + JUMP_MS, 0.7);
      }
    }
    if (o.diag && r >= 1) {
      const td = jumps[last]! + k.rnd() * 20;
      for (let s = 0; s < N; s++) {
        const a = w.nodes[r - 1]![s]!, b = w.nodes[r - 1]![(s + 1) % N]!, c2 = w.nodes[r]![(s + 1) % N]!, d = w.nodes[r]![s]!;
        if (flips[r]?.[s]) crack(k, b, d, 0.5, td, td + JUMP_MS, 0.4); else crack(k, a, c2, 0.5, td, td + JUMP_MS, 0.4);
      }
    }
  }
}

/** The seed of a blow's glass (the same fight cracks the same way). */
export function glassSeed(total: number, distance: number, side: 'player' | 'opp' | undefined, rollSeed = 0): number {
  return (Math.round(total) * 6977 + Math.round(distance) * 43 + (side === 'opp' ? 251 : 29) + Math.imul(rollSeed | 0, 2654435761)) >>> 0;
}

/**
 * IV's whole-screen web round the struck portrait: spoke 0 points at the striker (so the main crack runs through both
 * portraits), the last ring reaches past the farthest corner, and the spoke and ring counts are picked so the shards on
 * screen number forty to seventy (aiming for the mid fifties). Pure: each candidate is rolled from the same seed.
 */
export function screenWeb(seed: number, origin: Pt, aim: number, radius: number, bounds: Box): { web: GlassWeb; flips: boolean[][]; tris: ShardTri[] } {
  const far = Math.max(
    Math.hypot(origin.x - bounds.x, origin.y - bounds.y), Math.hypot(origin.x - bounds.x - bounds.w, origin.y - bounds.y),
    Math.hypot(origin.x - bounds.x, origin.y - bounds.y - bounds.h), Math.hypot(origin.x - bounds.x - bounds.w, origin.y - bounds.y - bounds.h),
  );
  let best: { web: GlassWeb; flips: boolean[][]; tris: ShardTri[] } | null = null;
  let bestErr = Infinity;
  for (const rings of [5, 4]) {
    for (const N of [10, 12, 8, 14]) {
      const rnd = seededRng(seed ^ 0x9e3779b9);
      // The outer ring must contain the box even between two spokes at their widest jitter.
      const outer = (far * 1.04) / Math.cos(((Math.PI * 2) / N) * 0.75);
      const inner = Math.min(radius * 1.25, far * 0.12);
      const radii = rings === 5 ? [inner, far * 0.2, far * 0.4, far * 0.68, outer] : [inner, far * 0.26, far * 0.56, outer];
      const web = buildWeb(rnd, origin, aim, N, radii);
      const flips = webFlips(rnd, web);
      const tris = webTris(web, flips, web.rings, bounds);
      const n = tris.length;
      const err = (n < GLASS_CAPS.minShards || n > GLASS_CAPS.shards ? 1000 : 0) + Math.abs(n - 56);
      if (err < bestErr) { bestErr = err; best = { web, flips, tris }; }
    }
  }
  return best!;
}

/**
 * Everything the blow draws on the glass, from the two portraits and the seed. `unit` is the stage scale (px sizes),
 * `bounds` the screen. Reduced motion draws nothing.
 */
export function glassGeo(p: GlassPlan, a: Pt, d: Pt, radius: number, aRadius: number, c: HeroGlassConfig, bounds: Box, seed: number, unit = 1): GlassGeo {
  const L = Math.hypot(d.x - a.x, d.y - a.y) || 1;
  const u = { x: (d.x - a.x) / L, y: (d.y - a.y) / L };
  const hand = { x: a.x + u.x * aRadius * 0.85, y: a.y + u.y * aRadius * 0.85 };
  const geo: GlassGeo = { hand, taps: [], chips: [], segs: [], tris: [], origin: { x: d.x, y: d.y }, main: null };
  if (p.reduced) return geo;
  const rnd = seededRng(seed);
  const k: SegSink = { segs: geo.segs, rnd, bounds, unit, width: c.crackWidth };
  const back = Math.atan2(a.y - d.y, a.x - d.x);
  const R = radius;
  if (p.kind === 'chip') {
    // Three short cracks off a chip, a little off the portrait's centre.
    const at = { x: d.x + (rnd() - 0.5) * R * 0.3, y: d.y + (rnd() - 0.5) * R * 0.3 };
    geo.taps.push(at); geo.origin = at;
    geo.chips.push({ at, size: 0.5, jump: 0 });
    const web = buildWeb(rnd, at, back + 0.6 + rnd() * 0.8, 3, [R * p.web * 0.45, R * p.web]);
    webCracks(k, web, [], p.jumps, 0, { ringLines: 0, diag: false, branches: 0.34 });
  } else if (p.kind === 'web') {
    // Two taps either side of the centre; each grows its own small web and they join.
    const px = -u.y, py = u.x;
    const o1 = { x: d.x + px * R * 0.36 - u.x * R * 0.08, y: d.y + py * R * 0.36 - u.y * R * 0.08 };
    const o2 = { x: d.x - px * R * 0.34 + u.x * R * 0.1, y: d.y - py * R * 0.34 + u.y * R * 0.1 };
    geo.taps.push(o1, o2);
    geo.chips.push({ at: o1, size: 0.5, jump: 0 }, { at: o2, size: 0.58, jump: 1 });
    const radii = [R * p.web * 0.28, R * p.web * 0.58, R * p.web * 0.92];
    const w1 = buildWeb(rnd, o1, Math.atan2(o2.y - o1.y, o2.x - o1.x), 7, radii);
    const w2 = buildWeb(rnd, o2, Math.atan2(o1.y - o2.y, o1.x - o2.x), 7, radii);
    // The first pebble's web waits at its first ring until the second lands (jump 1), then both spread together.
    const j1 = [p.jumps[0]!, ...p.jumps.slice(2)];
    webCracks(k, w1, [], j1, 0, { ringLines: 2, diag: false, branches: 0.2 });
    webCracks(k, w2, [], p.jumps, 1, { ringLines: 2, diag: false, branches: 0.2 });
  } else if (p.kind === 'pane') {
    geo.taps.push({ x: d.x, y: d.y });
    geo.chips.push({ at: geo.origin, size: 0.9, jump: 0 });
    const reach = Math.max(1.6, p.web);
    const web = buildWeb(rnd, geo.origin, back, 8, [R * 1.18, R * (1.18 + (reach - 1.18) * 0.36), R * (1.18 + (reach - 1.18) * 0.68), R * reach]);
    const flips = webFlips(rnd, web);
    webCracks(k, web, flips, p.jumps, 0, { ringLines: 3, diag: false, branches: 0.3 });
    // The pane that breaks out: the centre fan (eight shards round the portrait).
    geo.tris = webTris(web, flips, 1);
  } else {
    const { web, flips, tris } = screenWeb(seed, geo.origin, back, R, bounds);
    geo.tris = tris;
    const N = web.spokes;
    const opp = N / 2;
    // THE RACE: the main crack starts where the striker punches the glass, runs back to the near edge and forward
    // through the struck portrait to the far edge, at one speed, arriving at `raceEnd`.
    const fwd = rayExit(geo.origin, back + Math.PI, bounds), rear = Math.max(0, rayExit(geo.origin, back, bounds) - L);
    const v = (L + Math.max(fwd, rear - L, 1)) / Math.max(1, p.raceEnd - p.raceAt);
    const end = (s: number, dist: number): Pt => ({ x: geo.origin.x + Math.cos(back + (s === 0 ? 0 : Math.PI)) * dist, y: geo.origin.y + Math.sin(back + (s === 0 ? 0 : Math.PI)) * dist });
    geo.main = { a: end(0, L + rear), b: end(opp, fwd) };
    geo.chips.push({ at: { x: a.x, y: a.y }, size: 0.8, jump: -1 });
    geo.chips.push({ at: geo.origin, size: 0.7, jump: 0 });
    // Spoke 0, cut at the striker: inward pieces grow toward the struck portrait, outward pieces toward the edge.
    const stops = [0, ...web.nodes.map((row) => Math.hypot(row[0]!.x - geo.origin.x, row[0]!.y - geo.origin.y))];
    const cuts = [...new Set([...stops.filter((s) => s < L + rear + 1), L, L + rear])].sort((x, y) => x - y);
    for (let i = 1; i < cuts.length; i++) {
      const lo = cuts[i - 1]!, hi = cuts[i]!;
      if (hi - lo < 1) continue;
      if (hi <= L + 0.5) { // between the two portraits: grows from the striker's side inward
        crack(k, end(0, hi), end(0, lo), 1.5, p.raceAt + (L - hi) / v, p.raceAt + (L - lo) / v);
        if (rnd() < 0.8) branch(k, end(0, lo + (hi - lo) * rnd()), back + Math.PI, 70 * unit + rnd() * 90 * unit, p.raceAt + (L - hi) / v + 20);
      } else crack(k, end(0, lo), end(0, hi), 1.4, p.raceAt + (lo - L) / v, p.raceAt + (hi - L) / v);
    }
    const stopsB = [0, ...web.nodes.map((row) => Math.hypot(row[opp]!.x - geo.origin.x, row[opp]!.y - geo.origin.y))].filter((s) => s < fwd);
    stopsB.push(fwd);
    for (let i = 1; i < stopsB.length; i++) {
      const lo = stopsB[i - 1]!, hi = stopsB[i]!;
      crack(k, end(opp, lo), end(opp, hi), 1.4, p.raceAt + (L + lo) / v, p.raceAt + (L + hi) / v);
      if (rnd() < 0.7) branch(k, end(opp, lo + (hi - lo) * rnd()), back + Math.PI, 60 * unit + rnd() * 80 * unit, p.raceAt + (L + lo) / v + 20);
    }
    // The held beat: the rest of the web creaks out from the struck portrait, its diagonals last.
    webCracks(k, web, flips, p.jumps, 0, { ringLines: web.rings - 1, diag: true, branches: 0.12, skip: new Set([0, opp]) });
  }
  geo.segs.sort((x, y) => x.t0 - y.t0);
  return geo;
}

const quad = (a: Pt, c: Pt, b: Pt, e: number): Pt => { const m = 1 - e; return { x: m * m * a.x + 2 * m * e * c.x + e * e * b.x, y: m * m * a.y + 2 * m * e * c.y + e * e * b.y }; };

/**
 * Where a pebble is at `t`: in the hand, then a shallow lob toward the viewer (it swells a little: it is flying AT the
 * glass), then gone the moment it taps (the scene throws the bounce). Pure.
 */
export function stoneAt(s: GlassStone, hand: Pt, tap: Pt, arc: number, t: number): { p: Pt; u: number; phase: 'hand' | 'fly' | 'done' } {
  if (t < s.launchAt) return { p: hand, u: 0, phase: 'hand' };
  if (t >= s.hitAt) return { p: tap, u: 1, phase: 'done' };
  const e = (t - s.launchAt) / Math.max(1, s.hitAt - s.launchAt);
  const D = Math.hypot(tap.x - hand.x, tap.y - hand.y);
  const ctrl = { x: (hand.x + tap.x) / 2, y: (hand.y + tap.y) / 2 - D * arc * 2 };
  return { p: quad(hand, ctrl, tap, e), u: e, phase: 'fly' };
}

// ─── the camera (pure) ─────────────────────────────────────────────────────────────────────────────────────────

const springAt = (ms: number, hz: number, tau: number): number => (ms < 0 ? 0 : Math.exp(-ms / tau) * Math.cos(2 * Math.PI * hz * (ms / 1000)));
const sine = (u: number): number => 0.5 - 0.5 * Math.cos(Math.PI * Math.min(1, Math.max(0, u)));

/**
 * The camera: a small push in through the ready; IV keeps pushing in through the race and the held beat (the screen
 * never holds still); every tap kicks it; the impact punches and shakes (IV the hardest). Pure.
 */
export function glassCameraAt(p: GlassPlan, c: HeroGlassConfig, t: number, dir: Pt = { x: 1, y: 0 }): { zoom: number; x: number; y: number } {
  if (p.reduced) return { zoom: 1, x: 0, y: 0 };
  let z = 0;
  if (t >= p.chargeAt && t < p.impactAt) {
    z += p.zoom * sine((t - p.chargeAt) / Math.max(1, p.fireAt - p.chargeAt));
    if (t >= p.fireAt) z += p.push * sine((t - p.fireAt) / Math.max(1, p.impactAt - p.fireAt));
  } else if (t >= p.impactAt) {
    z += (p.zoom + p.push * 0.5 + p.punch) * Math.exp(-(t - p.impactAt) / Math.max(1, c.zoomOutMs / 4));
  }
  let x = 0, y = 0;
  const kick = (at: number, amp: number, tau: number, hz: number): void => { const s = springAt(t - at, hz, tau); x += dir.x * amp * s; y += dir.y * amp * s; };
  if (p.kind === 'shatter') kick(p.fireAt, p.shakePx * 0.3, 60, 16);
  for (const at of p.hits) kick(at, p.shakePx * 0.5, 40, 18);
  if (p.breakAt > p.impactAt) kick(p.breakAt, p.shakePx * 0.45, 70, 14);
  kick(p.impactAt, p.shakePx, Math.max(1, c.shakeMs / 4), 16);
  return { zoom: 1 + Math.max(0, z), x, y };
}

/** The anchor: the striker through the ready, gliding to the struck hero as the pebble (or the crack) travels. */
export function glassCameraFocus(p: GlassPlan, t: number, a: Pt, d: Pt): Pt {
  const arrive = p.kind === 'shatter' ? p.raceEnd : (p.stones[0]?.hitAt ?? p.impactAt);
  if (t <= p.fireAt) return a;
  if (t < arrive) { const e = sine((t - p.fireAt) / Math.max(1, arrive - p.fireAt)); return { x: a.x + (d.x - a.x) * e, y: a.y + (d.y - a.y) * e }; }
  return d;
}
