/**
 * THE REAPING (the Ancient of Death's hero attack, an ANCIENT): its tuned values, its pure timeline, the pure scythe
 * geometry, the pure colour-drain envelope and the pure camera.
 *
 * THE SIGNATURE: WHAT THE SCYTHE CUTS IS COLOUR. Every cut drains the struck portrait to greyscale along the cut, and
 * a few warm motes of its colour lift off and drift to the striker. The top look drains the WHOLE SCREEN to monochrome
 * and silence before colour floods back to everything except the loser. No other attack removes colour.
 *
 * FOUR LOOKS (the shared thresholds: I 1-5, II 6-11, III 12-19, IV 20+; a knockout always plays IV):
 *  I    CUT. A long thin scythe blade of teal light sweeps once, point first, through the struck portrait. Behind it a
 *       STRIP of the portrait goes grey, and a few motes of its colour drift to the striker. Colour seeps back.
 *  II   CROSS. Two cuts cross. The second drains the two wedges between them: HALF the portrait is grey, and more
 *       motes stream away.
 *  III  SHADOW. A tall hooded shadow rises beside the struck portrait, a candle burning at its other side. The scythe
 *       comes down from above; the whole portrait goes grey, the candle gutters and goes out. A low bell.
 *  IV   THE REAPING. Everything slows. The whole screen drains to monochrome and the sound drops away. One bell tolls.
 *       The scythe crosses the full width of the screen as a single clean line of teal light, and the struck portrait's
 *       colour streams out of it into the striker. Colour floods back in a wave from the striker's side, to everything
 *       except the struck portrait, which stays grey a moment longer.
 *
 * THE CONTRACT: II's first cut is a TICK (FX and sound only). The consequence (the damage, Armor, Resolve) lands ONCE,
 * as the blade crosses the middle of the struck portrait (`impactAt`).
 *
 * The colour itself is DOM (`heroReapingDrain.ts`): `backdrop-filter: grayscale` panes whose opacity and transform are
 * written from the one clock. Everything in this file is pure, so a replay reaps the same.
 *
 * Flat 2D. No hit-stop anywhere (the house rule: "it looks like lag"): IV's slowness is its own long beats, the clock
 * never slows. Reduced motion: no scythe, no drain, no shake; the numbers fade and the blow lands.
 *
 * Tuner convention (the shared `configStore`): localStorage in DEV only, values clamped on write and on load; production
 * always plays the DEFAULTS.
 */
import { configStore } from '../heroAttack/configStore';
import { clamp, clamp01, easeInOutSine, easeOutCubic, spring, type Pt } from '../heroAttack/easing';
import {
  HERO_ATTACK_TIER_THRESHOLDS, TIERS, reducedAttackTimeline, attackTier, type AttackTierContext, type TierNum,
} from '../heroAttack/tiers';

export { TIERS };
export type { TierNum };

export const REAPING_KINDS = ['cut', 'cross', 'shadow', 'reaping'] as const;
export type ReapingKind = (typeof REAPING_KINDS)[number];

/** Tier I..IV -> its look. */
export function reapingKind(tier: TierNum): ReapingKind { return REAPING_KINDS[tier - 1]!; }

/** The four tiers' dial groups (a config key is `t1..t4` + a suffix). */
export const REAPING_LEVELS = ['t1', 't2', 't3', 't4'] as const;

export const REAPING_TIER_SUFFIXES = ['ReadyMs', 'SweepMs', 'Motes', 'HoldMs', 'ReturnMs', 'Shake', 'Zoom', 'Punch', 'SettleMs', 'Dim'] as const;
export type ReapingTierSuffix = (typeof REAPING_TIER_SUFFIXES)[number];
type TierKey = `t${TierNum}${ReapingTierSuffix}`;

interface GlobalConfig {
  tier2At: number; tier3At: number; tier4At: number;
  // Ready
  absorbMs: number;
  heroSwell: number;
  // The blade
  bladeSize: number;
  bladeReach: number;
  bladeBow: number;
  // The drain
  stripWidth: number;
  grey: number;
  sag: number;
  moteMs: number;
  moteSize: number;
  // II
  crossGapMs: number;
  // III
  riseMs: number;
  raiseMs: number;
  followMs: number;
  shadowSize: number;
  // IV
  drainMs: number;
  silenceMs: number;
  tollMs: number;
  streamMs: number;
  floodMs: number;
  lingerMs: number;
  // Camera and portraits
  knockPx: number;
  shakeMs: number;
  zoomOutMs: number;
  reducedFadeMs: number;
  // Colours
  colorTeal: string;
  colorBone: string;
  colorShade: string;
  colorMoteA: string;
  colorMoteB: string;
  colorMoteC: string;
  colorPlayer: string;
  colorFoe: string;
  // Sound: a clip, a gain and a pitch per cue ('' = silent)
  sfxBellClip: string; sfxBellGain: number; sfxBellRate: number;
  sfxSweepClip: string; sfxSweepGain: number; sfxSweepRate: number;
  sfxBreathClip: string; sfxBreathGain: number; sfxBreathRate: number;
  sfxThumpClip: string; sfxThumpGain: number; sfxThumpRate: number;
  sfxDuck: number;
  sfxHush: number;
  // Preview only (the tuner's Play buttons). Never read by a real fight, and left out of Copy JSON.
  previewDamage: number;
  previewParts: number;
}
export type HeroReapingConfig = GlobalConfig & Record<TierKey, number>;

export const HERO_REAPING_COLOR_KEYS = ['colorTeal', 'colorBone', 'colorShade', 'colorMoteA', 'colorMoteB', 'colorMoteC', 'colorPlayer', 'colorFoe'] as const;
export const HERO_REAPING_CLIP_KEYS = ['sfxBellClip', 'sfxSweepClip', 'sfxBreathClip', 'sfxThumpClip'] as const;
export type HeroReapingStrKey = (typeof HERO_REAPING_COLOR_KEYS)[number] | (typeof HERO_REAPING_CLIP_KEYS)[number];
export type HeroReapingNumKey = Exclude<keyof HeroReapingConfig, HeroReapingStrKey>;

/**
 * Tier I .. IV per suffix: the escalation ladder. `SweepMs` is the blade's pass (III: the downswing to the portrait;
 * IV: the line's run across the whole screen). `HoldMs` is how long the portrait stays grey after the cut (IV: after
 * the flood has passed), `ReturnMs` how long its colour takes to seep back.
 */
const TIER_DEFAULTS: Record<ReapingTierSuffix, [number, number, number, number]> = {
  ReadyMs: [280, 300, 0, 0],
  SweepMs: [340, 320, 300, 460],
  Motes: [5, 10, 14, 30],
  HoldMs: [420, 480, 620, 380],
  ReturnMs: [420, 440, 480, 460],
  Shake: [3, 5, 10, 14],
  Zoom: [0.02, 0.028, 0.045, 0.06],
  Punch: [0.012, 0.018, 0.03, 0.04],
  SettleMs: [60, 60, 80, 80],
  Dim: [0.05, 0.12, 0.3, 0.1],
};

export const REAPING_TIER_RANGES: Record<ReapingTierSuffix, [number, number, number]> = {
  ReadyMs: [0, 1500, 10],
  SweepMs: [80, 1500, 10],
  Motes: [0, 40, 1],
  HoldMs: [0, 2000, 10],
  ReturnMs: [80, 2000, 10],
  Shake: [0, 40, 0.5],
  Zoom: [0, 0.14, 0.002],
  Punch: [0, 0.1, 0.001],
  SettleMs: [0, 1600, 10],
  Dim: [0, 0.8, 0.01],
};

const tierDefaults = Object.fromEntries(TIERS.flatMap((t) => REAPING_TIER_SUFFIXES.map((s) => [`t${t}${s}`, TIER_DEFAULTS[s][t - 1]]))) as Record<TierKey, number>;

export const HERO_REAPING_DEFAULTS: HeroReapingConfig = {
  // The shared, owner-approved thresholds (6 / 12 / 20): the same blow steps The Reaping up where it steps Blast up.
  ...HERO_ATTACK_TIER_THRESHOLDS,
  absorbMs: 190,
  heroSwell: 0.035,
  bladeSize: 2.7,
  bladeReach: 2.3,
  bladeBow: 0.5,
  stripWidth: 0.46,
  grey: 1,
  sag: 0.035,
  moteMs: 700,
  moteSize: 1.2,
  crossGapMs: 250,
  riseMs: 520,
  raiseMs: 140,
  followMs: 170,
  shadowSize: 3.1,
  drainMs: 520,
  silenceMs: 260,
  tollMs: 340,
  streamMs: 620,
  floodMs: 560,
  lingerMs: 0,
  knockPx: 10,
  shakeMs: 300,
  zoomOutMs: 380,
  reducedFadeMs: 260,
  // The Ancient of Death: a spectral teal against black and bone white. The motes are the only warm things on screen.
  colorTeal: '#2fe0bc',
  colorBone: '#efe9dc',
  colorShade: '#05070a',
  colorMoteA: '#ffb24a',
  colorMoteB: '#ff7a5c',
  colorMoteC: '#ffe08a',
  colorPlayer: '#f0c75e',
  colorFoe: '#ff6a7a',
  // Three clips made for it (ElevenLabs, 2026-11-12): a deep funeral bell, a cold airy scythe sweep, a soft exhale as
  // the colour leaves. Quiet and cold. A soft low thump sits under the cut.
  sfxBellClip: 'fx/reaping-bell', sfxBellGain: 0.7, sfxBellRate: 1,
  sfxSweepClip: 'fx/reaping-sweep', sfxSweepGain: 0.6, sfxSweepRate: 1,
  sfxBreathClip: 'fx/reaping-breath', sfxBreathGain: 0.5, sfxBreathRate: 1,
  sfxThumpClip: 'smack2', sfxThumpGain: 0.2, sfxThumpRate: 0.7,
  sfxDuck: 0.7,
  sfxHush: 0.25,
  previewDamage: 12,
  previewParts: 4,
  ...tierDefaults,
};

const GLOBAL_RANGES: Record<Exclude<keyof GlobalConfig, HeroReapingStrKey>, [number, number, number]> = {
  tier2At: [2, 40, 1], tier3At: [2, 60, 1], tier4At: [2, 80, 1],
  absorbMs: [60, 600, 10],
  heroSwell: [0, 0.2, 0.005],
  bladeSize: [1, 5, 0.05],
  bladeReach: [1.2, 4, 0.05],
  bladeBow: [0, 1.5, 0.05],
  stripWidth: [0.1, 1.2, 0.01],
  grey: [0, 1, 0.01],
  sag: [0, 0.15, 0.005],
  moteMs: [200, 2000, 10],
  moteSize: [0.3, 3, 0.05],
  crossGapMs: [60, 800, 10],
  riseMs: [120, 1600, 10],
  raiseMs: [0, 800, 10],
  followMs: [40, 600, 10],
  shadowSize: [1.5, 5, 0.05],
  drainMs: [120, 1600, 10],
  silenceMs: [0, 1200, 10],
  tollMs: [0, 1200, 10],
  streamMs: [120, 1600, 10],
  floodMs: [120, 1600, 10],
  lingerMs: [0, 1200, 10],
  knockPx: [0, 60, 1],
  shakeMs: [0, 1200, 10],
  zoomOutMs: [60, 1500, 10],
  reducedFadeMs: [60, 1000, 10],
  sfxBellGain: [0, 2, 0.05], sfxBellRate: [0.5, 2.5, 0.01],
  sfxSweepGain: [0, 2, 0.05], sfxSweepRate: [0.5, 2.5, 0.01],
  sfxBreathGain: [0, 2, 0.05], sfxBreathRate: [0.5, 2.5, 0.01],
  sfxThumpGain: [0, 2, 0.05], sfxThumpRate: [0.5, 2.5, 0.01],
  sfxDuck: [0, 1, 0.05],
  sfxHush: [0, 1, 0.05],
  previewDamage: [1, 60, 1],
  previewParts: [1, 8, 1],
};

/** [min, max, step] per numeric key. Values outside are clamped on write AND on load. */
export const HERO_REAPING_RANGES: Record<HeroReapingNumKey, [number, number, number]> = {
  ...GLOBAL_RANGES,
  ...(Object.fromEntries(TIERS.flatMap((t) => REAPING_TIER_SUFFIXES.map((s) => [`t${t}${s}`, REAPING_TIER_RANGES[s]]))) as Record<TierKey, [number, number, number]>),
};

/** The hard ceilings a plan never exceeds, whatever the sliders say. */
export const REAPING_CAPS = { motes: 40, shakePx: 40, zoom: 0.14 } as const;

const store = configStore<HeroReapingConfig>({
  key: 'ascent.heroreaping.v1', defaults: HERO_REAPING_DEFAULTS, ranges: HERO_REAPING_RANGES,
  colorKeys: HERO_REAPING_COLOR_KEYS, clipKeys: HERO_REAPING_CLIP_KEYS, previewKeys: ['previewDamage', 'previewParts'],
});
/** The store itself (the tuner reads and writes through it). */
export const heroReapingStore = store;
export const getHeroReapingConfig = store.get;
export const clampHeroReapingValue = store.clamp;
export const sanitizeHeroReapingConfig = store.sanitize;
export const heroReapingConfigJson = store.json;
/** The tuners' preview speed hook (Recruit + the Collection read one per style). Always 1. */
export function heroReapingPreviewSpeed(): number { return 1; }

/** One tier's dials, read out of the config. */
export function reapingTierDials(tier: TierNum, c: HeroReapingConfig = store.get()): Record<ReapingTierSuffix, number> {
  return Object.fromEntries(REAPING_TIER_SUFFIXES.map((s) => [s, c[`t${tier}${s}`]])) as Record<ReapingTierSuffix, number>;
}

// ─── the pure plan ─────────────────────────────────────────────────────────────────────────────────────────────

export interface ReapingPlanInput extends AttackTierContext {
  /** When the style's own attack starts: the end of the shared damage formation. */
  leadIn?: number;
  total: number;
  distance: number;
  reduced?: boolean;
}

/** One pass of the blade: it appears at `startAt`, crosses the middle of the portrait at `crossAt`, is gone by `endAt`. */
export interface CutTiming { startAt: number; crossAt: number; endAt: number }

export interface ReapingPlan {
  reduced: boolean;
  /** The shared tier (1..4), from `attackTier` (a knockout is 4). */
  tier: TierNum;
  kind: ReapingKind;
  /** 0..1 across the tiers (the damage formation's pop reads it). */
  k: number;
  total: number;
  chargeAt: number;
  absorbEnd: number;
  /** The first blade starts moving (the dim is fully in by here). */
  launchAt: number;
  /** I one cut, II two, III the downswing, IV the line across the screen. */
  cuts: CutTiming[];
  /** III: the shadow starts rising, and has risen with the scythe raised (null on other tiers). */
  riseAt: number | null;
  raisedAt: number | null;
  /** IV: the screen starts draining, is fully monochrome, and the bell tolls (null on other tiers). */
  drainAt: number | null;
  drainedAt: number | null;
  tollAt: number | null;
  /** THE blow, where the consequence lands: the (last) blade crossing the middle of the struck portrait. */
  impactAt: number;
  /** IV: colour starts flooding back from the striker's side, and has crossed the screen (null on other tiers). */
  floodAt: number | null;
  floodEnd: number | null;
  /** The struck portrait's colour starts seeping back, and is all back. */
  returnAt: number;
  returnEnd: number;
  endAt: number;
  motes: number;
  shakePx: number;
  zoom: number;
  punch: number;
  dim: number;
}

/** Where along its pass the blade is at the middle of the portrait (0..1 of the pass time). */
export const CROSS_AT = 0.5;

/** The whole Reaping, in base ms. Pure and deterministic. */
export function reapingPlan(input: ReapingPlanInput, c: HeroReapingConfig = store.get()): ReapingPlan {
  const total = Math.max(0, Math.round(input.total));
  const tier = attackTier(total, input, c); // a knockout always plays the shared Tier IV (heroAttack/tiers.ts)
  const kind = reapingKind(tier);
  const L = reapingTierDials(tier, c);
  const k = (tier - 1) / 3;
  if (input.reduced) {
    const r = reducedAttackTimeline(input.leadIn ?? 0, c.reducedFadeMs);
    const at = r.impactAt;
    return {
      reduced: true, tier, kind, k, total, chargeAt: at, absorbEnd: at, launchAt: at, cuts: [], riseAt: null, raisedAt: null,
      drainAt: null, drainedAt: null, tollAt: null, impactAt: at, floodAt: null, floodEnd: null, returnAt: at, returnEnd: at,
      endAt: r.endAt, motes: 0, shakePx: 0, zoom: 0, punch: 0, dim: 0,
    };
  }
  const chargeAt = Math.max(0, input.leadIn ?? 0);
  const absorbEnd = chargeAt + c.absorbMs;
  const ready = chargeAt + Math.max(L.ReadyMs, kind === 'cut' || kind === 'cross' ? c.absorbMs : 0);
  const sweep = Math.max(80, L.SweepMs);
  const cuts: CutTiming[] = [];
  let riseAt: number | null = null, raisedAt: number | null = null;
  let drainAt: number | null = null, drainedAt: number | null = null, tollAt: number | null = null;
  let floodAt: number | null = null, floodEnd: number | null = null;
  let launchAt = ready;
  if (kind === 'cut') {
    cuts.push({ startAt: ready, crossAt: ready + sweep * CROSS_AT, endAt: ready + sweep });
  } else if (kind === 'cross') {
    for (let i = 0; i < 2; i++) { const at = ready + i * c.crossGapMs; cuts.push({ startAt: at, crossAt: at + sweep * CROSS_AT, endAt: at + sweep }); }
  } else if (kind === 'shadow') {
    // The shadow rises with the scythe, holds it raised a beat, then the downswing: it reaches the portrait at the end
    // of `SweepMs` and follows through.
    riseAt = ready;
    raisedAt = riseAt + c.riseMs;
    launchAt = raisedAt + c.raiseMs;
    cuts.push({ startAt: launchAt, crossAt: launchAt + sweep, endAt: launchAt + sweep + c.followMs });
  } else {
    // The drain, the silence, the toll, then the line: it reaches the struck portrait at the end of `SweepMs` and runs
    // on off the screen.
    drainAt = ready;
    drainedAt = drainAt + Math.max(c.drainMs, c.absorbMs);
    tollAt = drainedAt + c.silenceMs;
    launchAt = tollAt + c.tollMs;
    cuts.push({ startAt: launchAt, crossAt: launchAt + sweep, endAt: launchAt + sweep + 220 });
  }
  const impactAt = cuts[cuts.length - 1]!.crossAt;
  let returnAt: number;
  if (kind === 'reaping') {
    floodAt = impactAt + c.streamMs;
    floodEnd = floodAt + c.floodMs;
    returnAt = floodEnd + c.lingerMs + L.HoldMs;
  } else returnAt = impactAt + L.HoldMs;
  const returnEnd = returnAt + Math.max(80, L.ReturnMs);
  const endAt = returnEnd + L.SettleMs;
  return {
    reduced: false, tier, kind, k, total, chargeAt, absorbEnd, launchAt, cuts, riseAt, raisedAt, drainAt, drainedAt, tollAt, impactAt,
    floodAt, floodEnd, returnAt, returnEnd, endAt, motes: Math.round(clamp(L.Motes, 0, REAPING_CAPS.motes)),
    shakePx: clamp(L.Shake, 0, REAPING_CAPS.shakePx), zoom: clamp(L.Zoom, 0, REAPING_CAPS.zoom), punch: L.Punch, dim: L.Dim,
  };
}

export type ReapingCueKind = 'charge' | 'rise' | 'drain' | 'hush' | 'toll' | 'sweep' | 'cross' | 'impact' | 'snuff' | 'flood' | 'return' | 'end';
export interface ReapingCue { at: number; kind: ReapingCueKind; i: number }

/** III: the candle gutters from the impact and is out this long after it. */
export const SNUFF_MS = 380;

/** Every beat the runner fires, in time order (a tick precedes the impact on a tie). */
export function reapingCues(p: ReapingPlan): ReapingCue[] {
  const out: ReapingCue[] = [];
  if (!p.reduced) {
    out.push({ at: p.chargeAt, kind: 'charge', i: 0 });
    if (p.riseAt !== null) out.push({ at: p.riseAt, kind: 'rise', i: 0 });
    if (p.drainAt !== null) out.push({ at: p.drainAt, kind: 'drain', i: 0 });
    if (p.drainedAt !== null) out.push({ at: p.drainedAt, kind: 'hush', i: 0 });
    if (p.tollAt !== null) out.push({ at: p.tollAt, kind: 'toll', i: 0 });
    p.cuts.forEach((q, i) => {
      out.push({ at: q.startAt, kind: 'sweep', i });
      // Every crossing but the last is a tick; the last IS the impact.
      if (i < p.cuts.length - 1) out.push({ at: q.crossAt, kind: 'cross', i });
    });
    if (p.kind === 'shadow') out.push({ at: p.impactAt + SNUFF_MS, kind: 'snuff', i: 0 });
    if (p.floodAt !== null) out.push({ at: p.floodAt, kind: 'flood', i: 0 });
    out.push({ at: p.returnAt, kind: 'return', i: 0 });
  }
  out.push({ at: p.impactAt, kind: 'impact', i: 0 });
  out.push({ at: p.endAt, kind: 'end', i: 0 });
  const order: Record<ReapingCueKind, number> = { charge: 0, rise: 1, drain: 2, hush: 3, toll: 4, sweep: 5, cross: 6, impact: 7, snuff: 8, flood: 9, return: 10, end: 11 };
  return out.sort((a, b) => a.at - b.at || order[a.kind] - order[b.kind]);
}

// ─── the geometry (pure) ───────────────────────────────────────────────────────────────────────────────────────

/** One blade pass through the struck portrait: a shallow arc `from` -> `ctrl` -> `to` whose middle is the portrait's. */
export interface CutGeo {
  from: Pt; ctrl: Pt; to: Pt;
  /** The cut's direction (unit), the way the strip is drained. */
  dir: Pt;
  /** Its angle (radians, screen space). */
  angle: number;
  /** Which side of the path the arc curves toward (the blade's cutting edge faces it). */
  bow: 1 | -1;
}

/** III: the hooded shadow, its scythe and the candle. */
export interface ShadowGeo {
  /** The shadow's feet (bottom centre) and height; `side` is which side of the portrait it stands on (-1 left, 1 right). */
  x: number; baseY: number; h: number; side: 1 | -1;
  /** The scythe turns about `pivot` (the shadow's hands): a snath `reach` px long, a blade `blade` px long at its end. */
  pivot: Pt; reach: number; blade: number;
  /** The snath's angle raised, as the MIDDLE of the blade crosses the portrait's middle, and after the follow-through. */
  a0: number; aHit: number; a1: number;
  /** The candle's foot (it stands at the portrait's other side). */
  candle: Pt;
}

/** IV: the line across the screen (through the struck portrait) and the way the colour floods back. */
export interface LineGeo {
  /** The line runs `from` -> `to` (both off the screen); it passes the struck portrait's middle `hitK` of the way. */
  from: Pt; to: Pt; hitK: number;
  angle: number;
}

export interface ReapingGeo {
  /** Unit vector from the striker to the target, and its normal (toward the top of the screen). */
  u: Pt;
  nrm: Pt;
  cuts: CutGeo[];
  shadow: ShadowGeo | null;
  line: LineGeo | null;
  /** The screen (or sandbox box) the attack plays in. */
  bounds: { w: number; h: number };
}

const rot = (v: Pt, a: number): Pt => ({ x: v.x * Math.cos(a) - v.y * Math.sin(a), y: v.x * Math.sin(a) + v.y * Math.cos(a) });

/** II's two cuts cross at right angles, 45 degrees either side of the strike line, so the wedges between them are HALF. */
export const CROSS_ANGLE = Math.PI / 4;
/** I's single cut is this far off the strike line (its side is rolled from the seed). */
export const CUT_ANGLE = 0.6;

/**
 * Every blade's path from the plan and the two heroes. `flip` (rolled from the seed) mirrors I's cut and which of II's
 * cuts goes first. Pure, so a replay reaps the same.
 *  I    one shallow arc through the middle of the portrait, `CUT_ANGLE` off the strike line.
 *  II   two arcs crossing at right angles on the portrait.
 *  III  the shadow stands at the portrait's side that faces the striker (kept on screen), its hands the scythe's pivot;
 *       the blade comes over the top and down through the portrait's middle. The candle stands at the other side.
 *  IV   a line across the whole screen through the portrait's middle, run from the striker's side.
 */
export function reapingGeo(p: ReapingPlan, a: Pt, d: Pt, aR: number, dR: number, c: HeroReapingConfig = store.get(), bounds: { w: number; h: number } = { w: 1920, h: 1080 }, flip = false): ReapingGeo {
  const L = Math.hypot(d.x - a.x, d.y - a.y) || 1;
  const u = { x: (d.x - a.x) / L, y: (d.y - a.y) / L };
  const nrm0 = { x: -u.y, y: u.x };
  const nrm = nrm0.y > 0 ? { x: -nrm0.x, y: -nrm0.y } : nrm0;
  void aR;
  if (p.reduced) return { u, nrm, cuts: [], shadow: null, line: null, bounds };
  const cut = (dir: Pt, bowSide: 1 | -1): CutGeo => {
    const n = { x: -dir.y * bowSide, y: dir.x * bowSide };
    const reach = dR * c.bladeReach, bow = dR * c.bladeBow;
    return {
      from: { x: d.x - dir.x * reach + n.x * bow, y: d.y - dir.y * reach + n.y * bow },
      ctrl: { x: d.x - n.x * bow, y: d.y - n.y * bow },
      to: { x: d.x + dir.x * reach + n.x * bow, y: d.y + dir.y * reach + n.y * bow },
      dir, angle: Math.atan2(dir.y, dir.x), bow: bowSide,
    };
  };
  const s: 1 | -1 = flip ? -1 : 1;
  const cuts: CutGeo[] = [];
  let shadow: ShadowGeo | null = null, line: LineGeo | null = null;
  if (p.kind === 'cut') cuts.push(cut(rot(u, s * CUT_ANGLE), s));
  else if (p.kind === 'cross') { cuts.push(cut(rot(u, s * CROSS_ANGLE), s)); cuts.push(cut(rot(u, -s * CROSS_ANGLE), (-s) as 1 | -1)); }
  else if (p.kind === 'shadow') {
    // The shadow stands on the striker's side of the portrait (toward the middle of the screen when they are level).
    const toward = Math.abs(a.x - d.x) > dR * 0.5 ? Math.sign(a.x - d.x) : (d.x > bounds.w / 2 ? -1 : 1);
    const side = (toward >= 0 ? 1 : -1) as 1 | -1;
    const h = dR * c.shadowSize;
    const half = h * 0.31; // the texture's half width
    const x = clamp(d.x + side * dR * 1.35, half + 6, Math.max(half + 6, bounds.w - half - 6));
    const baseY = clamp(d.y + dR * 1.25, h + 8, Math.max(h + 8, bounds.h + dR * 0.2));
    const pivot = { x: x - side * h * 0.05, y: baseY - h * 0.56 };
    // The blade sits across the end of the snath and travels point first, so its MIDDLE is what crosses the portrait.
    const dist = Math.hypot(d.x - pivot.x, d.y - pivot.y) || 1;
    const blade = Math.min(dR * 1.9, dist * 1.25);
    const reach = Math.sqrt(Math.max(1, dist * dist - (blade / 2) * (blade / 2)));
    const phi = Math.atan2(d.y - pivot.y, d.x - pivot.x);
    const aHit = phi + side * Math.atan2(blade / 2, reach);
    shadow = {
      x, baseY, h, side, pivot, reach, blade, a0: aHit + side * 1.75, aHit, a1: aHit - side * 0.62,
      candle: { x: clamp(d.x - side * dR * 1.2, dR * 0.45, Math.max(dR * 0.45, bounds.w - dR * 0.45)), y: clamp(d.y + dR * 1.02, dR, Math.max(dR, bounds.h - 6)) },
    };
    // The blade's path, as a cut: tangent to the swing where it crosses the portrait.
    const dir = { x: Math.sin(phi) * side, y: -Math.cos(phi) * side };
    cuts.push({ from: d, ctrl: d, to: d, dir, angle: Math.atan2(dir.y, dir.x), bow: 1 });
  } else {
    // A level line through the portrait, tipped a few degrees, run from the striker's side of the screen to the other.
    const sx = Math.abs(u.x) > 0.15 ? Math.sign(u.x) : 1;
    const tilt = -0.045 * sx * (u.y <= 0 ? 1 : -1);
    const dir = { x: Math.cos(tilt) * sx, y: Math.sin(tilt) };
    const pad = Math.max(120, dR);
    const back = (sx > 0 ? d.x : bounds.w - d.x) + pad, fwd = (sx > 0 ? bounds.w - d.x : d.x) + pad;
    line = {
      from: { x: d.x - dir.x * back, y: d.y - dir.y * back }, to: { x: d.x + dir.x * fwd, y: d.y + dir.y * fwd },
      hitK: back / (back + fwd), angle: Math.atan2(dir.y, dir.x),
    };
    cuts.push({ from: line.from, ctrl: d, to: line.to, dir, angle: line.angle, bow: 1 });
  }
  return { u, nrm, cuts, shadow, line, bounds };
}

export interface BladeState {
  visible: boolean; x: number; y: number;
  /** The way the blade points (radians): it travels point first. */
  rot: number;
  alpha: number;
  /** 0..1 along its pass. */
  k: number;
}

const HIDDEN: BladeState = { visible: false, x: 0, y: 0, rot: 0, alpha: 0, k: 0 };

/** The blade's progress along its pass: a smooth ease that is exactly `CROSS_AT` at the crossing. */
export function passAt(q: CutTiming, t: number): number {
  if (t <= q.startAt) return 0;
  if (t >= q.endAt) return 1;
  return easeInOutSine((t - q.startAt) / Math.max(1, q.endAt - q.startAt));
}

/** I-II: blade `i` at sequence time `t` (pure). Hidden outside its pass; it fades in and out at the ends. */
export function bladeAt(p: ReapingPlan, g: ReapingGeo, i: number, t: number, out: BladeState = { ...HIDDEN }): BladeState {
  const q = p.cuts[i], n = g.cuts[i];
  if (!q || !n || p.reduced || (p.kind !== 'cut' && p.kind !== 'cross') || t < q.startAt || t >= q.endAt) { out.visible = false; out.alpha = 0; return out; }
  const e = passAt(q, t), m = 1 - e;
  out.visible = true;
  out.x = m * m * n.from.x + 2 * m * e * n.ctrl.x + e * e * n.to.x;
  out.y = m * m * n.from.y + 2 * m * e * n.ctrl.y + e * e * n.to.y;
  const dx = 2 * m * (n.ctrl.x - n.from.x) + 2 * e * (n.to.x - n.ctrl.x), dy = 2 * m * (n.ctrl.y - n.from.y) + 2 * e * (n.to.y - n.ctrl.y);
  out.rot = Math.atan2(dy, dx);
  out.alpha = Math.min(1, e / 0.18, (1 - e) / 0.22);
  out.k = e;
  return out;
}

/**
 * III: the scythe's snath angle at `t` (pure): raised (`a0`) from the rise, swung down, accelerating, to cross the
 * portrait's middle exactly at `crossAt` (`aHit`), then following through to `a1`, slowing.
 */
export function swingAt(p: ReapingPlan, s: ShadowGeo, t: number): number {
  const q = p.cuts[0];
  if (!q || t <= q.startAt) return s.a0;
  if (t < q.crossAt) { const v = (t - q.startAt) / Math.max(1, q.crossAt - q.startAt); return s.a0 + (s.aHit - s.a0) * v * v * v; }
  return s.aHit + (s.a1 - s.aHit) * easeOutCubic((t - q.crossAt) / Math.max(1, q.endAt - q.crossAt));
}

/** III: the scythe at snath angle `ang` (pure): the end of the snath, the way the blade points, and the blade's middle. */
export function scytheAt(s: ShadowGeo, ang: number): { tip: Pt; rot: number; mid: Pt } {
  const tip = { x: s.pivot.x + Math.cos(ang) * s.reach, y: s.pivot.y + Math.sin(ang) * s.reach };
  const r = ang - s.side * Math.PI / 2;
  return { tip, rot: r, mid: { x: tip.x + Math.cos(r) * s.blade / 2, y: tip.y + Math.sin(r) * s.blade / 2 } };
}

/** III: how far the shadow has risen (0 = not there, 1 = standing) at `t`: up through the rise, sinking after the cut. */
export function shadowAt(p: ReapingPlan, t: number): number {
  if (p.kind !== 'shadow' || p.riseAt === null || p.raisedAt === null || t < p.riseAt) return 0;
  if (t < p.raisedAt) return easeOutCubic((t - p.riseAt) / Math.max(1, p.raisedAt - p.riseAt));
  const leave = p.impactAt + 300;
  if (t < leave) return 1;
  return 1 - clamp01((t - leave) / 420);
}

/** III: the candle's flame (1 = burning, 0 = out): steady, guttering from the impact, out `SNUFF_MS` after it. */
export function flameAt(p: ReapingPlan, t: number): number {
  if (p.kind !== 'shadow' || p.riseAt === null || t < p.riseAt) return 0;
  if (t < p.impactAt) return clamp01((t - p.riseAt) / 220);
  return 1 - clamp01((t - p.impactAt) / SNUFF_MS);
}

/** IV: the line's head, 0..1 from `from` to `to`, at `t` (pure): it is exactly at the portrait (`hitK`) at `crossAt`. */
export function lineAt(p: ReapingPlan, g: ReapingGeo, t: number): number {
  const q = p.cuts[0], l = g.line;
  if (!q || !l || t <= q.startAt) return 0;
  if (t < q.crossAt) { const v = (t - q.startAt) / Math.max(1, q.crossAt - q.startAt); return l.hitK * (0.25 * v + 0.75 * v * v); }
  if (t >= q.endAt) return 1;
  return l.hitK + (1 - l.hitK) * ((t - q.crossAt) / Math.max(1, q.endAt - q.crossAt));
}

// ─── the colour (pure) ─────────────────────────────────────────────────────────────────────────────────────────

/** What the drain panes show at a time: every value 0..1. */
export interface DrainState {
  /** I-II: how far each cut's strip has been drained along the cut (0 = nothing, 1 = edge to edge). */
  strip: [number, number];
  /** The strips' opacity (the colour seeping back fades them). */
  stripA: number;
  /** The rest of the portrait: II's two wedges, III-IV the whole portrait. */
  full: number;
  /** IV: the whole screen (0 = colour, 1 = monochrome). */
  veil: number;
  /** IV: how far the colour has flooded back across the screen (0 = not started, 1 = all the way across). */
  flood: number;
}

export function emptyDrain(): DrainState { return { strip: [0, 0], stripA: 0, full: 0, veil: 0, flood: 0 }; }

/**
 * THE DRAIN at sequence time `t` (pure). I-II: each strip is drained along its cut as the blade passes (the grey is
 * BEHIND the blade); II's wedges go as the second blade crosses. III: the whole portrait, in the last beat of the
 * downswing. IV: the screen drains through `drainAt..drainedAt` and the portrait with it; the flood runs
 * `floodAt..floodEnd`; the portrait stays grey. Every tier: the portrait's colour seeps back over
 * `returnAt..returnEnd`, and everything is EXACTLY 0 from `returnEnd` (and before the charge).
 */
export function drainAt(p: ReapingPlan, t: number, out: DrainState = emptyDrain()): DrainState {
  out.strip[0] = 0; out.strip[1] = 0; out.stripA = 0; out.full = 0; out.veil = 0; out.flood = 0;
  if (p.reduced || t < p.chargeAt || t >= p.returnEnd) return out;
  const back = 1 - easeInOutSine((t - p.returnAt) / Math.max(1, p.returnEnd - p.returnAt));
  if (p.kind === 'cut' || p.kind === 'cross') {
    for (let i = 0; i < p.cuts.length && i < 2; i++) {
      const q = p.cuts[i]!;
      // The blade's middle is at the portrait's near rim about 28% into its pass and at its far rim about 72%.
      out.strip[i] = clamp01((passAt(q, t) - 0.3) / 0.44);
    }
    out.stripA = back;
    if (p.kind === 'cross') out.full = clamp01((t - (p.impactAt - 30)) / 150) * back;
  } else if (p.kind === 'shadow') {
    out.full = clamp01((t - (p.impactAt - 50)) / 140) * back;
  } else if (p.drainAt !== null && p.drainedAt !== null && p.floodAt !== null && p.floodEnd !== null) {
    const v = easeInOutSine((t - p.drainAt) / Math.max(1, p.drainedAt - p.drainAt));
    out.veil = t < p.floodEnd ? v : 0;
    out.flood = t < p.floodAt ? 0 : t >= p.floodEnd ? 1 : easeInOutSine((t - p.floodAt) / Math.max(1, p.floodEnd - p.floodAt));
    out.full = v * back;
  }
  return out;
}

/**
 * The struck portrait's own move at `t` (pure): a short knock along the cut on each crossing, and a SAG while it is
 * drained (it shrinks a touch and sinks, the life gone out of it), easing back as its colour returns. `knock` is 0..1
 * (x the tuned px), `sag` 0..1 (x the tuned amount). Exactly 0 outside the attack.
 */
export function foeMoveAt(p: ReapingPlan, t: number): { knock: number; sag: number } {
  if (p.reduced || t < p.chargeAt || t >= p.returnEnd) return { knock: 0, sag: 0 };
  let knock = 0;
  for (let i = 0; i < p.cuts.length; i++) {
    const at = p.cuts[i]!.crossAt;
    if (t >= at) knock += (i === p.cuts.length - 1 ? 1 : 0.5) * Math.max(-0.4, spring(t - at, 4.5, 90));
  }
  const sag = t < p.impactAt ? 0 : clamp01((t - p.impactAt) / 220) * (1 - easeInOutSine((t - p.returnAt) / Math.max(1, p.returnEnd - p.returnAt)));
  return { knock, sag };
}

// ─── the camera (pure) ─────────────────────────────────────────────────────────────────────────────────────────

const sine = (v: number): number => 0.5 - 0.5 * Math.cos(Math.PI * Math.min(1, Math.max(0, v)));

/**
 * The camera at sequence time `t`: a slow push in up to the blow (IV creeps in all through the drain, the silence and
 * the toll: everything slows), a small kick along each cut, a punch with a short directional shake on the impact, then
 * it settles back. Deterministic. Pure.
 */
export function reapingCameraAt(p: ReapingPlan, c: HeroReapingConfig, t: number, dir: Pt = { x: 1, y: 0 }): { zoom: number; x: number; y: number } {
  if (p.reduced) return { zoom: 1, x: 0, y: 0 };
  let z = 0;
  if (t >= p.chargeAt && t < p.impactAt) z += p.zoom * sine((t - p.chargeAt) / Math.max(1, p.impactAt - p.chargeAt) * 1.25);
  else if (t >= p.impactAt) {
    const since = t - p.impactAt;
    // IV holds its push through the stream of motes and lets go as the colour floods back.
    const hold = p.floodAt !== null ? 1 - sine((t - p.floodAt) / Math.max(1, (p.floodEnd ?? p.floodAt) - p.floodAt)) : Math.exp(-since / Math.max(1, c.zoomOutMs / 3));
    z += p.zoom * hold + p.punch * Math.exp(-since / Math.max(1, c.zoomOutMs / 4));
  }
  let x = 0, y = 0;
  for (let i = 0; i < p.cuts.length; i++) {
    const at = p.cuts[i]!.crossAt;
    if (t < at) continue;
    const amp = p.shakePx * (i === p.cuts.length - 1 ? 1 : 0.4);
    const s = spring(t - at, 14, Math.max(1, c.shakeMs / 4));
    x += dir.x * amp * s; y += dir.y * amp * s;
  }
  return { zoom: 1 + Math.max(0, z), x, y };
}

/** Where the camera anchors: the striker through the ready, easing to the struck portrait as the first blade starts. */
export function reapingCameraFocus(p: ReapingPlan, t: number, a: Pt, d: Pt): Pt {
  if (p.kind === 'shadow' || p.kind === 'reaping') return d;
  const first = p.cuts[0]?.crossAt ?? p.impactAt;
  if (t <= p.chargeAt) return a;
  if (t >= first) return d;
  const e = sine((t - p.chargeAt) / Math.max(1, first - p.chargeAt));
  return { x: a.x + (d.x - a.x) * e, y: a.y + (d.y - a.y) * e };
}
