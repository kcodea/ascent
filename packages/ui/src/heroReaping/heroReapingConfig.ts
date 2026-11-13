/**
 * THE REAPING (the Ancient of Death's hero attack, an ANCIENT): its tuned values, its pure timeline, the pure scythe
 * geometry, the pure colour-drain envelope and the pure camera.
 *
 * THE SIGNATURE: WHAT THE SCYTHE CUTS IS COLOUR. Every cut takes the struck portrait's colour, and that colour is
 * VISIBLE as it is taken: drops, shards and ribbons in the portrait's own hues (sampled from its art at the start),
 * carried into the striker, who glows with the stolen colour afterwards. No other attack removes colour.
 *
 * FOUR LOOKS (the shared thresholds: Tier 1 from 1, Tier 2 from 6, Tier 3 from 12, Tier 4 from 20; a knockout always
 * plays Tier 4):
 *  Tier 1  THE CUT. A long thin scythe blade of teal light sweeps once, point first, through the struck portrait. Behind
 *          it a STRIP of the portrait goes grey, and drops of its colour drift to the striker. Colour seeps back.
 *  Tier 2  THE CROSS. Two cuts cross. The second drains the two wedges between them: HALF the portrait is grey, and
 *          more drops stream away.
 *  Tier 3  THE HARVEST. The whole board's colour is GATHERED: the world greys from the edges of the screen inward while
 *          drops of every colour run in ahead of the grey, into one brilliant ORB of colour over the struck portrait
 *          (which greys as its own colour goes into it). A great crescent is drawn back and held over it, falls, and
 *          cuts the orb: it SHATTERS into a storm of coloured shards that burst out and are drawn into the striker,
 *          who blazes with the stolen colour. The board gets its colour back; the target stays grey.
 *  Tier 4  THE REAPING. The whole screen drains to monochrome EXCEPT the struck portrait: the last colour in the world.
 *          Silence. ONE bell tolls and the crescent ignites over the striker. The portrait's colour is WOUND OUT of it
 *          as three long spiralling ribbons onto the blade, which becomes a blazing rainbow scythe. One huge sweep
 *          across the screen, rainbow afterimages fanned behind it, cuts the portrait: it CRACKS like old paint. The
 *          stolen colour spills into the striker and floods back into the world in a wave from the striker, behind a
 *          rainbow front. The loser stays grey and cracked a moment, the paint flakes away, and its colour comes back.
 *
 * THE CONTRACT: Tier 2's first cut is a TICK (FX and sound only). The consequence (the damage, Armor, Resolve) lands
 * ONCE, as the blade crosses the middle of the struck portrait (`impactAt`).
 *
 * The colour itself is DOM (`heroReapingDrain.ts`): `backdrop-filter: grayscale` panes whose opacity and transform are
 * written from the one clock. Everything in this file is pure, so a replay reaps the same.
 *
 * Flat 2D. No hit-stop anywhere (the house rule: "it looks like lag"): Tier 4's slowness is its own long beats, the
 * clock never slows. Reduced motion: no scythe, no drain, no shake; the numbers fade and the blow lands.
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

export const REAPING_KINDS = ['cut', 'cross', 'harvest', 'reaping'] as const;
export type ReapingKind = (typeof REAPING_KINDS)[number];

/** Tier 1..4 -> its look. */
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
  // Tier 2
  crossGapMs: number;
  // Tier 3
  gatherMs: number;
  orbSize: number;
  riseMs: number;
  raiseMs: number;
  followMs: number;
  reapSize: number;
  shardMs: number;
  // Tier 4
  sweepSize: number;
  drainMs: number;
  silenceMs: number;
  tollMs: number;
  windMs: number;
  blazeMs: number;
  ribbonWidth: number;
  streamMs: number;
  floodMs: number;
  lingerMs: number;
  // The stolen colour on the striker
  aura: number;
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
  colorWorldA: string;
  colorWorldB: string;
  colorPlayer: string;
  colorFoe: string;
  // Sound: a clip, a gain and a pitch per cue ('' = silent)
  sfxBellClip: string; sfxBellGain: number; sfxBellRate: number;
  sfxSweepClip: string; sfxSweepGain: number; sfxSweepRate: number;
  sfxBreathClip: string; sfxBreathGain: number; sfxBreathRate: number;
  sfxThumpClip: string; sfxThumpGain: number; sfxThumpRate: number;
  sfxSlashClip: string; sfxSlashGain: number; sfxSlashRate: number;
  sfxMetalClip: string; sfxMetalGain: number; sfxMetalRate: number;
  sfxCleaveClip: string; sfxCleaveGain: number; sfxCleaveRate: number;
  sfxDrainClip: string; sfxDrainGain: number; sfxDrainRate: number;
  sfxBoomClip: string; sfxBoomGain: number; sfxBoomRate: number;
  sfxOrbClip: string; sfxOrbGain: number; sfxOrbRate: number;
  sfxShatterClip: string; sfxShatterGain: number; sfxShatterRate: number;
  sfxWindClip: string; sfxWindGain: number; sfxWindRate: number;
  sfxCrackClip: string; sfxCrackGain: number; sfxCrackRate: number;
  sfxDuck: number;
  sfxHush: number;
  // Preview only (the tuner's Play buttons). Never read by a real fight, and left out of Copy JSON.
  previewDamage: number;
  previewParts: number;
}
export type HeroReapingConfig = GlobalConfig & Record<TierKey, number>;

export const HERO_REAPING_COLOR_KEYS = ['colorTeal', 'colorBone', 'colorShade', 'colorMoteA', 'colorMoteB', 'colorMoteC', 'colorWorldA', 'colorWorldB', 'colorPlayer', 'colorFoe'] as const;
export const HERO_REAPING_CLIP_KEYS = ['sfxBellClip', 'sfxSweepClip', 'sfxBreathClip', 'sfxThumpClip', 'sfxSlashClip', 'sfxMetalClip', 'sfxCleaveClip', 'sfxDrainClip', 'sfxBoomClip', 'sfxOrbClip', 'sfxShatterClip', 'sfxWindClip', 'sfxCrackClip'] as const;
export type HeroReapingStrKey = (typeof HERO_REAPING_COLOR_KEYS)[number] | (typeof HERO_REAPING_CLIP_KEYS)[number];
export type HeroReapingNumKey = Exclude<keyof HeroReapingConfig, HeroReapingStrKey>;

/**
 * Tier 1 .. 4 per suffix: the escalation ladder. `SweepMs` is the blade's pass (Tier 3: the fall to the orb; Tier 4:
 * the crescent's run from the striker to the struck portrait). Tiers 1 and 2 are the owner-approved first pass: leave
 * their timing. `Motes` is how many drops (1-2), shards (3) or spilled drops (4) carry the colour. `HoldMs` is how long
 * the portrait stays grey after the cut (Tier 4: after the flood has passed), `ReturnMs` how long its colour takes to
 * seep back.
 */
const TIER_DEFAULTS: Record<ReapingTierSuffix, [number, number, number, number]> = {
  ReadyMs: [280, 300, 0, 0],
  SweepMs: [340, 320, 200, 380],
  Motes: [5, 10, 52, 48],
  HoldMs: [420, 480, 1050, 420],
  ReturnMs: [420, 440, 520, 560],
  Shake: [3, 5, 18, 26],
  Zoom: [0.02, 0.028, 0.05, 0.065],
  Punch: [0.012, 0.018, 0.05, 0.075],
  SettleMs: [60, 60, 120, 140],
  Dim: [0.05, 0.12, 0.2, 0.34],
};

export const REAPING_TIER_RANGES: Record<ReapingTierSuffix, [number, number, number]> = {
  ReadyMs: [0, 1500, 10],
  SweepMs: [80, 1500, 10],
  Motes: [0, 64, 1],
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
  gatherMs: 1100,
  orbSize: 1,
  riseMs: 560,
  raiseMs: 260,
  followMs: 260,
  reapSize: 3.6,
  shardMs: 1000,
  sweepSize: 5.6,
  drainMs: 600,
  silenceMs: 320,
  tollMs: 220,
  windMs: 900,
  blazeMs: 220,
  ribbonWidth: 42,
  streamMs: 580,
  floodMs: 660,
  lingerMs: 0,
  aura: 1,
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
  // The world's own colours, gathered on Tier 3 alongside the portrait's (a petal rose and a gem blue).
  colorWorldA: '#ff6aa0',
  colorWorldB: '#5ab4ff',
  colorPlayer: '#f0c75e',
  colorFoe: '#ff6a7a',
  // Six clips made for it (ElevenLabs, 2026-11-12): a deep funeral bell, a cold airy scythe sweep and a soft exhale
  // (first pass); the low body of a heavy blade through the air, a blade cleaving through with a dull thud, and a long
  // hollow rush of air as the colour is drawn out (second pass, when the owner heard the first as silent). Still cold,
  // no longer quiet: every blade is the airy sweep OVER the low slash and a ring of steel (the shared metal woosh), and
  // every blow has a low body under it. The bell is layered an octave down over a shared low boom.
  sfxBellClip: 'fx/reaping-bell', sfxBellGain: 1.05, sfxBellRate: 1,
  sfxSweepClip: 'fx/reaping-sweep', sfxSweepGain: 1.05, sfxSweepRate: 1,
  sfxBreathClip: 'fx/reaping-breath', sfxBreathGain: 1.4, sfxBreathRate: 1,
  sfxThumpClip: 'smack2', sfxThumpGain: 0.55, sfxThumpRate: 0.7,
  sfxSlashClip: 'fx/reaping-slash', sfxSlashGain: 0.7, sfxSlashRate: 1,
  sfxMetalClip: 'fx/metal-woosh', sfxMetalGain: 0.35, sfxMetalRate: 1,
  sfxCleaveClip: 'fx/reaping-cleave', sfxCleaveGain: 0.7, sfxCleaveRate: 1,
  sfxDrainClip: 'fx/reaping-drain', sfxDrainGain: 0.85, sfxDrainRate: 1,
  sfxBoomClip: 'fx/heavy-rock-impact', sfxBoomGain: 0.2, sfxBoomRate: 1,
  // Third pass (2026-11-13, ElevenLabs): a resonant hum swelling as the orb of colour forms, a glass orb shattering,
  // silk ribbons whipped into a spiral as Tier 4 winds the colour out, and old paint cracking.
  sfxOrbClip: 'fx/reaping-orb', sfxOrbGain: 1, sfxOrbRate: 1,
  sfxShatterClip: 'fx/reaping-shatter', sfxShatterGain: 0.9, sfxShatterRate: 1,
  sfxWindClip: 'fx/reaping-wind', sfxWindGain: 1, sfxWindRate: 1,
  sfxCrackClip: 'fx/reaping-crack', sfxCrackGain: 1.1, sfxCrackRate: 1,
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
  gatherMs: [240, 2000, 10],
  orbSize: [0.4, 2, 0.05],
  riseMs: [120, 1600, 10],
  raiseMs: [0, 800, 10],
  followMs: [40, 600, 10],
  reapSize: [1.5, 6, 0.05],
  shardMs: [300, 2000, 10],
  sweepSize: [2, 9, 0.1],
  drainMs: [120, 1600, 10],
  silenceMs: [0, 1200, 10],
  tollMs: [0, 1200, 10],
  windMs: [200, 2000, 10],
  blazeMs: [0, 800, 10],
  ribbonWidth: [6, 80, 1],
  streamMs: [120, 1600, 10],
  floodMs: [120, 1600, 10],
  lingerMs: [0, 1200, 10],
  aura: [0, 2, 0.05],
  knockPx: [0, 60, 1],
  shakeMs: [0, 1200, 10],
  zoomOutMs: [60, 1500, 10],
  reducedFadeMs: [60, 1000, 10],
  sfxBellGain: [0, 2, 0.05], sfxBellRate: [0.5, 2.5, 0.01],
  sfxSweepGain: [0, 2, 0.05], sfxSweepRate: [0.5, 2.5, 0.01],
  sfxBreathGain: [0, 2, 0.05], sfxBreathRate: [0.5, 2.5, 0.01],
  sfxThumpGain: [0, 2, 0.05], sfxThumpRate: [0.5, 2.5, 0.01],
  sfxSlashGain: [0, 2, 0.05], sfxSlashRate: [0.5, 2.5, 0.01],
  sfxMetalGain: [0, 2, 0.05], sfxMetalRate: [0.5, 2.5, 0.01],
  sfxCleaveGain: [0, 2, 0.05], sfxCleaveRate: [0.5, 2.5, 0.01],
  sfxDrainGain: [0, 2, 0.05], sfxDrainRate: [0.5, 2.5, 0.01],
  sfxBoomGain: [0, 2, 0.05], sfxBoomRate: [0.5, 2.5, 0.01],
  sfxOrbGain: [0, 2, 0.05], sfxOrbRate: [0.5, 2.5, 0.01],
  sfxShatterGain: [0, 2, 0.05], sfxShatterRate: [0.5, 2.5, 0.01],
  sfxWindGain: [0, 2, 0.05], sfxWindRate: [0.5, 2.5, 0.01],
  sfxCrackGain: [0, 2, 0.05], sfxCrackRate: [0.5, 2.5, 0.01],
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
export const REAPING_CAPS = { motes: 64, shakePx: 40, zoom: 0.14 } as const;

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
  /** Tier 1 one cut, Tier 2 two, Tier 3 the fall, Tier 4 the crescent across the screen. */
  cuts: CutTiming[];
  /** Tiers 3-4: the great crescent ignites and is drawn back, and is held, fully lit (null on Tiers 1-2). */
  windAt: number | null;
  heldAt: number | null;
  /** Tier 3: the world starts greying from the edges inward, and has closed on the struck portrait (null otherwise). */
  gatherAt: number | null;
  gatherEnd: number | null;
  /** Tier 3: the orb of colour starts to form over the struck portrait (full at `heldAt`; it shatters on the impact). */
  orbAt: number | null;
  /** Tier 4: the screen starts draining, is fully monochrome, and the bell tolls (null on other tiers). */
  drainAt: number | null;
  drainedAt: number | null;
  tollAt: number | null;
  /** Tier 4: the ribbons of colour start winding out of the struck portrait, and are all on the blade. */
  ribbonAt: number | null;
  ribbonEnd: number | null;
  /** THE blow, where the consequence lands: the (last) blade crossing the middle of the struck portrait. */
  impactAt: number;
  /** When the stolen colour starts reaching the striker, and when the striker is full of it. */
  stolenAt: number;
  stolenFull: number;
  /** Tier 4: colour starts flooding back from the striker's side, and has crossed the screen (null on other tiers). */
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

/** Tier 4: how long the crescent runs on (off the screen, thinning) after it has cut the portrait. */
export const SWEEP_FOLLOW_MS = 240;

/** Where along its pass the blade is at the middle of the portrait (0..1 of the pass time). */
export const CROSS_AT = 0.5;

/** Tier 3: when the orb starts forming, as a fraction of the gather. */
export const ORB_FROM = 0.3;

/** The whole Reaping, in base ms. Pure and deterministic. */
export function reapingPlan(input: ReapingPlanInput, c: HeroReapingConfig = store.get()): ReapingPlan {
  const total = Math.max(0, Math.round(input.total));
  const tier = attackTier(total, input, c); // a knockout always plays the shared Tier 4 (heroAttack/tiers.ts)
  const kind = reapingKind(tier);
  const L = reapingTierDials(tier, c);
  const k = (tier - 1) / 3;
  if (input.reduced) {
    const r = reducedAttackTimeline(input.leadIn ?? 0, c.reducedFadeMs);
    const at = r.impactAt;
    return {
      reduced: true, tier, kind, k, total, chargeAt: at, absorbEnd: at, launchAt: at, cuts: [], windAt: null, heldAt: null,
      gatherAt: null, gatherEnd: null, orbAt: null, drainAt: null, drainedAt: null, tollAt: null, ribbonAt: null, ribbonEnd: null,
      impactAt: at, stolenAt: at, stolenFull: at, floodAt: null, floodEnd: null, returnAt: at, returnEnd: at,
      endAt: r.endAt, motes: 0, shakePx: 0, zoom: 0, punch: 0, dim: 0,
    };
  }
  const chargeAt = Math.max(0, input.leadIn ?? 0);
  const absorbEnd = chargeAt + c.absorbMs;
  const ready = chargeAt + Math.max(L.ReadyMs, kind === 'cut' || kind === 'cross' ? c.absorbMs : 0);
  const sweep = Math.max(80, L.SweepMs);
  const cuts: CutTiming[] = [];
  let windAt: number | null = null, heldAt: number | null = null;
  let gatherAt: number | null = null, gatherEnd: number | null = null, orbAt: number | null = null;
  let drainAt: number | null = null, drainedAt: number | null = null, tollAt: number | null = null;
  let ribbonAt: number | null = null, ribbonEnd: number | null = null;
  let floodAt: number | null = null, floodEnd: number | null = null;
  let launchAt = ready;
  if (kind === 'cut') {
    cuts.push({ startAt: ready, crossAt: ready + sweep * CROSS_AT, endAt: ready + sweep });
  } else if (kind === 'cross') {
    for (let i = 0; i < 2; i++) { const at = ready + i * c.crossGapMs; cuts.push({ startAt: at, crossAt: at + sweep * CROSS_AT, endAt: at + sweep }); }
  } else if (kind === 'harvest') {
    // The gather (the world greys from the edges in, the orb forms); the crescent is drawn back through the end of it
    // and is held over the full orb; then it falls through the orb.
    gatherAt = ready;
    gatherEnd = gatherAt + Math.max(c.gatherMs, c.absorbMs);
    orbAt = gatherAt + (gatherEnd - gatherAt) * ORB_FROM;
    heldAt = gatherEnd;
    windAt = Math.max(gatherAt, heldAt - c.riseMs);
    launchAt = heldAt + c.raiseMs;
    cuts.push({ startAt: launchAt, crossAt: launchAt + sweep, endAt: launchAt + sweep + c.followMs });
  } else {
    // The drain (all but the struck portrait), the silence, the toll (the crescent ignites on it), the ribbons wound
    // onto the blade, the blazing hold, then the sweep: it reaches the struck portrait at the end of `SweepMs`.
    drainAt = ready;
    drainedAt = drainAt + Math.max(c.drainMs, c.absorbMs);
    tollAt = drainedAt + c.silenceMs;
    windAt = tollAt;
    ribbonAt = tollAt + c.tollMs;
    ribbonEnd = ribbonAt + c.windMs;
    heldAt = ribbonEnd;
    launchAt = heldAt + c.blazeMs;
    cuts.push({ startAt: launchAt, crossAt: launchAt + sweep, endAt: launchAt + sweep + SWEEP_FOLLOW_MS });
  }
  const impactAt = cuts[cuts.length - 1]!.crossAt;
  let returnAt: number, stolenAt: number, stolenFull: number;
  if (kind === 'reaping') {
    floodAt = impactAt + c.streamMs;
    floodEnd = floodAt + c.floodMs;
    returnAt = floodEnd + c.lingerMs + L.HoldMs;
    stolenAt = impactAt + c.streamMs * 0.35;
    stolenFull = floodAt;
  } else if (kind === 'harvest') {
    returnAt = impactAt + L.HoldMs;
    stolenAt = impactAt + c.shardMs * 0.55;
    stolenFull = impactAt + c.shardMs * 1.05;
  } else {
    returnAt = impactAt + L.HoldMs;
    stolenAt = impactAt + c.moteMs * 0.6;
    stolenFull = impactAt + c.moteMs * 1.1;
  }
  const returnEnd = returnAt + Math.max(80, L.ReturnMs);
  // Tiers 1-2 keep their approved end; Tiers 3-4 also wait for the striker's glow to settle.
  const endAt = kind === 'cut' || kind === 'cross' ? returnEnd + L.SettleMs : Math.max(returnEnd + L.SettleMs, stolenFull + 400);
  return {
    reduced: false, tier, kind, k, total, chargeAt, absorbEnd, launchAt, cuts, windAt, heldAt, gatherAt, gatherEnd, orbAt,
    drainAt, drainedAt, tollAt, ribbonAt, ribbonEnd, impactAt, stolenAt, stolenFull, floodAt, floodEnd, returnAt, returnEnd, endAt,
    motes: Math.round(clamp(L.Motes, 0, REAPING_CAPS.motes)),
    shakePx: clamp(L.Shake, 0, REAPING_CAPS.shakePx), zoom: clamp(L.Zoom, 0, REAPING_CAPS.zoom), punch: L.Punch, dim: L.Dim,
  };
}

export type ReapingCueKind = 'charge' | 'gather' | 'orb' | 'wind' | 'drain' | 'hush' | 'toll' | 'ribbons' | 'held' | 'sweep' | 'cross' | 'impact' | 'stolen' | 'flood' | 'return' | 'end';
export interface ReapingCue { at: number; kind: ReapingCueKind; i: number }

/** Every beat the runner fires, in time order (a tick precedes the impact on a tie). */
export function reapingCues(p: ReapingPlan): ReapingCue[] {
  const out: ReapingCue[] = [];
  if (!p.reduced) {
    out.push({ at: p.chargeAt, kind: 'charge', i: 0 });
    if (p.gatherAt !== null) out.push({ at: p.gatherAt, kind: 'gather', i: 0 });
    if (p.orbAt !== null) out.push({ at: p.orbAt, kind: 'orb', i: 0 });
    // Tier 3: the crescent ignites (on Tier 4 it ignites on the toll, which is its own cue).
    if (p.kind === 'harvest' && p.windAt !== null) out.push({ at: p.windAt, kind: 'wind', i: 0 });
    if (p.heldAt !== null) out.push({ at: p.heldAt, kind: 'held', i: 0 });
    if (p.drainAt !== null) out.push({ at: p.drainAt, kind: 'drain', i: 0 });
    if (p.drainedAt !== null) out.push({ at: p.drainedAt, kind: 'hush', i: 0 });
    if (p.tollAt !== null) out.push({ at: p.tollAt, kind: 'toll', i: 0 });
    if (p.ribbonAt !== null) out.push({ at: p.ribbonAt, kind: 'ribbons', i: 0 });
    p.cuts.forEach((q, i) => {
      out.push({ at: q.startAt, kind: 'sweep', i });
      // Every crossing but the last is a tick; the last IS the impact.
      if (i < p.cuts.length - 1) out.push({ at: q.crossAt, kind: 'cross', i });
    });
    if (p.kind === 'harvest' || p.kind === 'reaping') out.push({ at: p.stolenAt, kind: 'stolen', i: 0 });
    if (p.floodAt !== null) out.push({ at: p.floodAt, kind: 'flood', i: 0 });
    out.push({ at: p.returnAt, kind: 'return', i: 0 });
  }
  out.push({ at: p.impactAt, kind: 'impact', i: 0 });
  out.push({ at: p.endAt, kind: 'end', i: 0 });
  const order: Record<ReapingCueKind, number> = { charge: 0, gather: 1, orb: 2, wind: 3, drain: 4, hush: 5, toll: 6, ribbons: 7, held: 8, sweep: 9, cross: 10, impact: 11, stolen: 12, flood: 13, return: 14, end: 15 };
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

/**
 * Tiers 3-4: THE GREAT CRESCENT. It turns about `pivot` like the blade of a scythe on its arm: the blade lies ALONG the arm
 * (from `arm - inner * blade` to `arm + (1 - inner) * blade` px out) and sweeps EDGE FIRST, so it passes through the
 * whole portrait. The arm points at the middle of the struck portrait exactly at `aHit`.
 */
export interface SwingGeo {
  pivot: Pt;
  /** The pivot's distance to the middle of the struck portrait. */
  arm: number;
  /** The blade's length, and how much of it lies INSIDE the portrait's middle (0..1, toward the pivot). */
  blade: number; inner: number;
  /** The arm's angle held (drawn back), as it cuts the portrait's middle, and after the follow-through. */
  a0: number; aHit: number; a1: number;
  /** How far forward of `a0` it ignites before it is drawn back (radians). */
  back: number;
  /** Which way it turns (1 = the angle grows). */
  sgn: 1 | -1;
}

/** Tier 4: the line of light the cut leaves across the whole screen, through the struck portrait (the tangent of the sweep). */
export interface LineGeo {
  /** The line runs `from` -> `to` (both off the screen); the struck portrait's middle is `hitK` of the way. */
  from: Pt; to: Pt; hitK: number;
  angle: number;
}

export interface ReapingGeo {
  /** Unit vector from the striker to the target, and its normal (toward the top of the screen). */
  u: Pt;
  nrm: Pt;
  cuts: CutGeo[];
  swing: SwingGeo | null;
  line: LineGeo | null;
  /** The screen (or sandbox box) the attack plays in. */
  bounds: { w: number; h: number };
}

const rot = (v: Pt, a: number): Pt => ({ x: v.x * Math.cos(a) - v.y * Math.sin(a), y: v.x * Math.sin(a) + v.y * Math.cos(a) });

/** Tier 2's two cuts cross at right angles, 45 degrees either side of the strike line, so the wedges between them are HALF. */
export const CROSS_ANGLE = Math.PI / 4;
/** Tier 1's single cut is this far off the strike line (its side is rolled from the seed). */
export const CUT_ANGLE = 0.6;

/**
 * Every blade's path from the plan and the two heroes. `flip` (rolled from the seed) mirrors Tier 1's cut and which of Tier 2's
 * cuts goes first. Pure, so a replay reaps the same.
 *  Tier 1 one shallow arc through the middle of the portrait, `CUT_ANGLE` off the strike line.
 *  Tier 2 two arcs crossing at right angles on the portrait.
 *  Tier 3 the crescent turns about a point beside the portrait (the striker's side). With room above, it is drawn back
 *       ABOVE the portrait and falls through it; on a portrait at the top of the screen the pivot sits under it and the
 *       crescent is drawn back toward the striker and swept across. Either way the raised crescent stays on screen.
 *  Tier 4 the crescent turns about a point far off the screen, on a great arc from the striker through the struck
 *       portrait and on off the screen; the line it leaves is the arc's tangent at the portrait, across the whole screen.
 */
export function reapingGeo(p: ReapingPlan, a: Pt, d: Pt, aR: number, dR: number, c: HeroReapingConfig = store.get(), bounds: { w: number; h: number } = { w: 1920, h: 1080 }, flip = false): ReapingGeo {
  const L = Math.hypot(d.x - a.x, d.y - a.y) || 1;
  const u = { x: (d.x - a.x) / L, y: (d.y - a.y) / L };
  const nrm0 = { x: -u.y, y: u.x };
  const nrm = nrm0.y > 0 ? { x: -nrm0.x, y: -nrm0.y } : nrm0;
  void aR;
  if (p.reduced) return { u, nrm, cuts: [], swing: null, line: null, bounds };
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
  let swing: SwingGeo | null = null, line: LineGeo | null = null;
  if (p.kind === 'cut') cuts.push(cut(rot(u, s * CUT_ANGLE), s));
  else if (p.kind === 'cross') { cuts.push(cut(rot(u, s * CROSS_ANGLE), s)); cuts.push(cut(rot(u, -s * CROSS_ANGLE), (-s) as 1 | -1)); }
  else if (p.kind === 'harvest') {
    // The pivot is on the striker's side of the portrait (toward the middle of the screen when they are level).
    const toward = Math.abs(a.x - d.x) > dR * 0.5 ? Math.sign(a.x - d.x) : (d.x > bounds.w / 2 ? -1 : 1);
    const side = (toward >= 0 ? 1 : -1) as 1 | -1;
    const blade = dR * c.reapSize, arm = blade / 2 + dR * 0.5;
    const sgn = (-side) as 1 | -1;
    // Room to raise it above the portrait? Otherwise the pivot goes under the portrait and it is drawn back sideways.
    const above = d.y - (arm + blade / 2) * 0.97 > 8;
    const pivot = above ? { x: d.x + side * arm, y: d.y } : { x: d.x, y: d.y + arm };
    const aHit = above ? (side > 0 ? Math.PI : 0) : -Math.PI / 2;
    swing = { pivot, arm, blade, inner: 0.5, a0: aHit - sgn * FALL_RAISE, aHit, a1: aHit + sgn * 0.75, back: 0.3, sgn };
  } else {
    // A great arc from the striker through the struck portrait: the pivot is on the perpendicular bisector of the two,
    // far off, on whichever side puts it nearer the struck portrait's column (so the sweep is level as it cuts).
    const mid = { x: (a.x + d.x) / 2, y: (a.y + d.y) / 2 };
    const n = nrm0.y > 0 || (nrm0.y === 0 && nrm0.x > 0) ? nrm0 : { x: -nrm0.x, y: -nrm0.y };
    const off = L * 1.3;
    const pa = { x: mid.x + n.x * off, y: mid.y + n.y * off }, pb = { x: mid.x - n.x * off, y: mid.y - n.y * off };
    const pivot = Math.abs(pb.x - d.x) < Math.abs(pa.x - d.x) - 1 ? pb : pa;
    const arm = Math.hypot(d.x - pivot.x, d.y - pivot.y) || 1;
    const aHit = Math.atan2(d.y - pivot.y, d.x - pivot.x);
    const aStart = Math.atan2(a.y - pivot.y, a.x - pivot.x);
    let turn = aHit - aStart;
    while (turn > Math.PI) turn -= Math.PI * 2;
    while (turn < -Math.PI) turn += Math.PI * 2;
    const sgn = (turn >= 0 ? 1 : -1) as 1 | -1;
    const blade = Math.min(dR * c.sweepSize, arm * 1.1);
    swing = { pivot, arm, blade, inner: 0.55, a0: aHit - turn, aHit, a1: aHit + sgn * 0.3, back: 0.05, sgn };
  }
  if (swing) {
    // The crescent's path where it cuts the portrait: the tangent of the swing.
    const dir = { x: -Math.sin(swing.aHit) * swing.sgn, y: Math.cos(swing.aHit) * swing.sgn };
    const angle = Math.atan2(dir.y, dir.x);
    cuts.push({ from: d, ctrl: d, to: d, dir, angle, bow: 1 });
    if (p.kind === 'reaping') {
      const span = Math.hypot(bounds.w, bounds.h);
      line = { from: { x: d.x - dir.x * span, y: d.y - dir.y * span }, to: { x: d.x + dir.x * span, y: d.y + dir.y * span }, hitK: 0.5, angle };
    }
  }
  return { u, nrm, cuts, swing, line, bounds };
}

/** Tier 3: how far back the crescent is raised from the cut (radians). */
export const FALL_RAISE = 1.3;

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

/** Tiers 1-2: blade `i` at sequence time `t` (pure). Hidden outside its pass; it fades in and out at the ends. */
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
 * Tiers 3-4: the crescent's arm angle at `t` (pure): it ignites a little forward of `a0` and is DRAWN BACK to it through
 * the wind-up, is held, then swings, accelerating, to cut the portrait's middle exactly at `crossAt` (`aHit`), and
 * follows through to `a1`, slowing.
 */
export function swingAt(p: ReapingPlan, s: SwingGeo, t: number): number {
  const q = p.cuts[0];
  if (!q || p.windAt === null || p.heldAt === null) return s.a0;
  if (t <= p.windAt) return s.a0 + s.sgn * s.back;
  if (t < p.heldAt) return s.a0 + s.sgn * s.back * (1 - easeOutCubic((t - p.windAt) / Math.max(1, p.heldAt - p.windAt)));
  if (t <= q.startAt) return s.a0;
  if (t < q.crossAt) { const v = (t - q.startAt) / Math.max(1, q.crossAt - q.startAt); return s.a0 + (s.aHit - s.a0) * v * v * v; }
  return s.aHit + (s.a1 - s.aHit) * easeOutCubic((t - q.crossAt) / Math.max(1, q.endAt - q.crossAt));
}

/** Tiers 3-4: the crescent on its arm at angle `ang` (pure): its heel, the point that cuts the portrait's middle, its tip. */
export function swingPose(s: SwingGeo, ang: number): { heel: Pt; mid: Pt; tip: Pt } {
  const cx = Math.cos(ang), sy = Math.sin(ang);
  const r0 = s.arm - s.inner * s.blade, r1 = r0 + s.blade;
  return {
    heel: { x: s.pivot.x + cx * r0, y: s.pivot.y + sy * r0 },
    mid: { x: s.pivot.x + cx * s.arm, y: s.pivot.y + sy * s.arm },
    tip: { x: s.pivot.x + cx * r1, y: s.pivot.y + sy * r1 },
  };
}

/**
 * Tiers 3-4: the crescent's light at `t` (pure). `a` is its opacity (it ignites through the first part of the wind-up, is
 * full from the hold to the cut, and thins away through the follow-through); `build` is the light gathering along its
 * edge through the wind-up (0..1, full at the launch). Exactly 0 before the wind-up and from the end of the follow.
 */
export function swingLight(p: ReapingPlan, t: number, out: { a: number; build: number } = { a: 0, build: 0 }): { a: number; build: number } {
  const q = p.cuts[0];
  out.a = 0; out.build = 0;
  if (!q || p.reduced || p.windAt === null || p.heldAt === null || t < p.windAt || t >= q.endAt) return out;
  out.build = clamp01((t - p.windAt) / Math.max(1, q.startAt - p.windAt));
  if (t < q.crossAt) out.a = clamp01((t - p.windAt) / Math.max(1, (p.heldAt - p.windAt) * 0.55));
  else { const v = 1 - clamp01((t - q.crossAt) / Math.max(1, q.endAt - q.crossAt)); out.a = v * v; }
  return out;
}

/** Tier 4: how long the line of light lasts after the cut, thinning. */
export const SCAR_MS = 700;

/** Tier 4: the line the cut leaves (pure): `len` 0..1 of its full length (it opens out from the portrait), `a` its light. */
export function lineAt(p: ReapingPlan, t: number, out: { len: number; a: number } = { len: 0, a: 0 }): { len: number; a: number } {
  out.len = 0; out.a = 0;
  if (p.reduced || p.kind !== 'reaping') return out;
  const since = t - p.impactAt;
  if (since < 0 || since >= SCAR_MS) return out;
  out.len = 0.1 + 0.9 * easeOutCubic(clamp01(since / 110));
  out.a = 1 - clamp01((since - 140) / (SCAR_MS - 140));
  return out;
}

// ─── the colour (pure) ─────────────────────────────────────────────────────────────────────────────────────────

/** What the drain panes show at a time: every value 0..1. */
export interface DrainState {
  /** Tiers 1-2: how far each cut's strip has been drained along the cut (0 = nothing, 1 = edge to edge). */
  strip: [number, number];
  /** The strips' opacity (the colour seeping back fades them). */
  stripA: number;
  /** The rest of the portrait: Tier 2's two wedges, Tiers 3-4 the whole portrait. */
  full: number;
  /** Tier 3: how far the grey has closed in from the edges of the screen (0 = not at all, 1 = onto the portrait;
   * `gatherRadius` turns it into px), and the gathering grey's opacity (it lifts after the shatter). */
  gather: number;
  gatherA: number;
  /** Tier 4: the whole screen (0 = colour, 1 = monochrome). */
  veil: number;
  /** Tier 4: how far the colour has flooded back across the screen (0 = not started, 1 = all the way across). */
  flood: number;
}

export function emptyDrain(): DrainState { return { strip: [0, 0], stripA: 0, full: 0, gather: 0, gatherA: 0, veil: 0, flood: 0 }; }

/** Tier 3: how far through the gather the grey's edge is, `v` of the way through its time (a gentle start, then
 * steady: in log space, so the edge sweeps fast across the far board and slows as it closes on the portrait). */
export function gatherAt01(v: number): number {
  const x = clamp01(v);
  return (x < 0.2 ? (x * x) / 0.4 : x - 0.1) / 0.9;
}

/**
 * Tier 3: the radius of the round hole of colour left in the grey, `e` of the way through the gather (pure). It starts
 * past the farthest corner of the screen from the struck portrait (`dMax`) and closes onto the portrait (radius `r`),
 * evenly in log space so the grey's edge moves at a steady pace across the screen.
 */
export function gatherRadius(e: number, dMax: number, r: number): number {
  const r0 = Math.max(dMax * 1.12, r * 2), r1 = r * 1.15;
  return r0 * Math.pow(r1 / r0, clamp01(e));
}

/**
 * THE DRAIN at sequence time `t` (pure). Tiers 1-2: each strip is drained along its cut as the blade passes (the grey is
 * BEHIND the blade); Tier 2's wedges go as the second blade crosses. Tier 3: the world greys from the edges in, the
 * portrait greys as the orb takes its colour, and is all grey as the orb is cut; the world's grey lifts after the
 * shatter. Tier 4: the screen drains through `drainAt..drainedAt` EXCEPT the struck portrait, which greys as the
 * ribbons wind its colour out; the flood runs `floodAt..floodEnd`; the portrait stays grey. Every tier: the portrait's
 * colour seeps back over `returnAt..returnEnd`, and everything is EXACTLY 0 from `returnEnd` (and before the charge).
 */
export function drainAt(p: ReapingPlan, t: number, out: DrainState = emptyDrain()): DrainState {
  out.strip[0] = 0; out.strip[1] = 0; out.stripA = 0; out.full = 0; out.gather = 0; out.gatherA = 0; out.veil = 0; out.flood = 0;
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
  } else if (p.kind === 'harvest' && p.gatherAt !== null && p.gatherEnd !== null && p.heldAt !== null) {
    if (t >= p.gatherAt) {
      out.gather = gatherAt01((t - p.gatherAt) / Math.max(1, p.gatherEnd - p.gatherAt));
      out.gatherA = 1 - easeInOutSine((t - (p.impactAt + GATHER_LIFT_AFTER)) / GATHER_LIFT_MS);
    }
    // Most of the portrait's colour goes into the orb as it forms; the cut takes the rest at once.
    const into = p.orbAt === null ? 0 : 0.8 * easeInOutSine((t - p.orbAt) / Math.max(1, p.heldAt - p.orbAt));
    out.full = Math.max(into, clamp01((t - (p.impactAt - 20)) / 70)) * back;
  } else if (p.drainAt !== null && p.drainedAt !== null && p.floodAt !== null && p.floodEnd !== null && p.ribbonAt !== null && p.ribbonEnd !== null) {
    const v = easeInOutSine((t - p.drainAt) / Math.max(1, p.drainedAt - p.drainAt));
    out.veil = t < p.floodEnd ? v : 0;
    out.flood = t < p.floodAt ? 0 : t >= p.floodEnd ? 1 : easeInOutSine((t - p.floodAt) / Math.max(1, p.floodEnd - p.floodAt));
    // The last colour in the world goes as the ribbons wind it out (all of it by the cut).
    out.full = Math.max(easeInOutSine((t - p.ribbonAt) / Math.max(1, p.ribbonEnd - p.ribbonAt)), clamp01((t - (p.impactAt - 20)) / 70)) * back;
  }
  return out;
}

/** Tier 3: the world's grey starts to lift this long after the shatter, and takes this long. */
export const GATHER_LIFT_AFTER = 380;
export const GATHER_LIFT_MS = 620;

/** Tier 3: the orb of colour at `t` (pure): `k` its size 0..1 (it swells from `orbAt` to full at `heldAt`), `a` its
 * light (0 before it forms and from the impact, when it shatters). */
export function orbAt(p: ReapingPlan, t: number, out: { k: number; a: number } = { k: 0, a: 0 }): { k: number; a: number } {
  out.k = 0; out.a = 0;
  if (p.reduced || p.orbAt === null || p.heldAt === null || t < p.orbAt || t >= p.impactAt) return out;
  const v = clamp01((t - p.orbAt) / Math.max(1, p.heldAt - p.orbAt));
  // A swell that overshoots a touch and settles (it is filling), then strains a little bigger through the hold.
  out.k = Math.min(1.08, easeOutCubic(v) * (1 + 0.08 * Math.sin(Math.PI * v))) + 0.06 * clamp01((t - p.heldAt) / Math.max(1, p.impactAt - p.heldAt));
  out.a = clamp01((t - p.orbAt) / 140);
  return out;
}

/**
 * Tier 4: ribbon `j` (0..2) of the colour wound out of the struck portrait at `t` (pure): `head` and `tail` are how far
 * along its spiral path (0 = the portrait, 1 = the blade) its two ends are. It grows out of the portrait, reaches the
 * blade, and is reeled onto it; `head <= tail` means nothing is drawn.
 */
export function ribbonSpan(p: ReapingPlan, j: number, t: number, out: { tail: number; head: number } = { tail: 0, head: 0 }): { tail: number; head: number } {
  out.tail = 0; out.head = 0;
  if (p.reduced || p.ribbonAt === null || p.ribbonEnd === null) return out;
  const D = Math.max(1, p.ribbonEnd - p.ribbonAt);
  const s0 = p.ribbonAt + j * 0.08 * D;
  out.head = easeInOutSine((t - s0) / (0.72 * D));
  const t0 = p.ribbonAt + (0.55 + 0.08 * j) * D;
  const v = clamp01((t - t0) / Math.max(1, p.ribbonEnd - t0));
  out.tail = v * v;
  if (t < s0 || t >= p.ribbonEnd) { out.head = 0; out.tail = 0; }
  return out;
}

/** Tier 4: how many turns each ribbon's spiral makes between the portrait and the blade. */
export const RIBBON_TURNS = 1.7;

/**
 * Tier 4: the point `s` (0..1) along ribbon `j`'s spiral from `a` (the portrait) to `b` (the blade) (pure): the three
 * ribbons are one braid, a third of a turn apart, wide in the middle and pinched at both ends. `twist` turns the whole
 * braid (it spins as it is drawn), `rr` is its widest radius.
 */
export function ribbonPoint(a: Pt, b: Pt, j: number, s: number, twist: number, rr: number, out: Pt = { x: 0, y: 0 }): Pt {
  const dx = b.x - a.x, dy = b.y - a.y;
  const L = Math.hypot(dx, dy) || 1;
  const ux = dx / L, uy = dy / L;
  const R = rr * Math.pow(Math.sin(Math.PI * clamp01(s)), 0.7);
  const ph = twist + (j * Math.PI * 2) / 3 + RIBBON_TURNS * Math.PI * 2 * s;
  const sn = Math.sin(ph), cs = Math.cos(ph);
  out.x = a.x + dx * s - uy * R * sn + ux * R * 0.18 * cs;
  out.y = a.y + dy * s + ux * R * sn + uy * R * 0.18 * cs;
  return out;
}

/** Tier 4: how far the crescent has turned to rainbow (0..1) as the ribbons reach it (pure). */
export function rainbowAt(p: ReapingPlan, t: number): number {
  if (p.reduced || p.ribbonAt === null || p.ribbonEnd === null) return 0;
  const D = Math.max(1, p.ribbonEnd - p.ribbonAt);
  return easeInOutSine((t - (p.ribbonAt + 0.4 * D)) / (0.6 * D));
}

/** Tier 4: the old-paint cracks over the grey loser (pure, 0..1): they run across it just after the cut, hold while it
 * stays grey, and fall away as its colour returns. */
export function crackAt(p: ReapingPlan, t: number): number {
  if (p.reduced || p.kind !== 'reaping' || t < p.impactAt + 20 || t >= p.returnEnd) return 0;
  const on = easeOutCubic(clamp01((t - (p.impactAt + 20)) / 140));
  const off = 1 - clamp01((t - p.returnAt) / Math.max(1, (p.returnEnd - p.returnAt) * 0.55));
  return on * off;
}

/**
 * The stolen colour on the striker (pure, 0..1): it builds as the colour arrives (`stolenAt..stolenFull`), then fades
 * away by the end. Exactly 0 before the colour arrives and at the end.
 */
export function stolenAt(p: ReapingPlan, t: number): number {
  if (p.reduced || t < p.stolenAt || t >= p.endAt) return 0;
  if (t < p.stolenFull) return easeOutCubic((t - p.stolenAt) / Math.max(1, p.stolenFull - p.stolenAt));
  const v = clamp01((t - p.stolenFull) / Math.max(1, p.endAt - p.stolenFull));
  return 1 - v * v;
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
 * The camera at sequence time `t`: a slow push in up to the blow (Tier 4 creeps in all through the drain, the silence and
 * the toll), a jolt on Tier 4's toll, a small kick along each cut, a punch with a directional shake on the impact, then it
 * settles back. Deterministic. Pure.
 */
export function reapingCameraAt(p: ReapingPlan, c: HeroReapingConfig, t: number, dir: Pt = { x: 1, y: 0 }): { zoom: number; x: number; y: number } {
  if (p.reduced) return { zoom: 1, x: 0, y: 0 };
  let z = 0;
  if (t >= p.chargeAt && t < p.impactAt) z += p.zoom * sine((t - p.chargeAt) / Math.max(1, p.impactAt - p.chargeAt) * 1.25);
  else if (t >= p.impactAt) {
    const since = t - p.impactAt;
    // Tier 4 holds its push through the stream of motes and lets go as the colour floods back.
    const hold = p.floodAt !== null ? 1 - sine((t - p.floodAt) / Math.max(1, (p.floodEnd ?? p.floodAt) - p.floodAt)) : Math.exp(-since / Math.max(1, c.zoomOutMs / 3));
    z += p.zoom * hold + p.punch * Math.exp(-since / Math.max(1, c.zoomOutMs / 4));
  }
  let x = 0, y = 0;
  if (p.tollAt !== null && t >= p.tollAt) {
    // Tier 4: the toll jolts the view (a smaller hit than the cut, straight down: the weight of the bell).
    const since = t - p.tollAt;
    z += p.punch * 0.5 * Math.exp(-since / Math.max(1, c.zoomOutMs / 4));
    y += p.shakePx * 0.3 * spring(since, 14, Math.max(1, c.shakeMs / 4));
  }
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
  if (p.kind === 'harvest' || p.kind === 'reaping') return d;
  const first = p.cuts[0]?.crossAt ?? p.impactAt;
  if (t <= p.chargeAt) return a;
  if (t >= first) return d;
  const e = sine((t - p.chargeAt) / Math.max(1, first - p.chargeAt));
  return { x: a.x + (d.x - a.x) * e, y: a.y + (d.y - a.y) * e };
}
