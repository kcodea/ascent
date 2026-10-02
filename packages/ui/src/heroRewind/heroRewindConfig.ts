/**
 * THE REWIND HERO ATTACK ("Rewind", the Ancient of Time; ANCIENT rarity): its tuned values, its pure timeline, the pure
 * strike path, the slow-mo dip and the pure camera.
 *
 * Owner 2026-10-02: "build a new ancient animation for this ancient, the ancient of time. rewinding/stopping time
 * concepts could be cool, and repeating time for the final hit or something to repeat the same attack maybe?" The owner
 * picked the concept REWIND & REPLAY: each hit LANDS, then time REWINDS and the SAME hit REPLAYS. The look is the owner's
 * reference art: a stone mask with one gold and one violet eye, broken gold orbital halo rings (a shattered clock /
 * astrolabe), and a stream of glittering golden hourglass sand. Palette: sand #f5d78a to #ffe9b0, gold #d4a537, violet
 * #8b5cf6.
 *
 * First review (owner, 5173): "the idea for rewind is okay, but it is so boring and slow paced. it's a 3.5/10 right now
 * and we need at least a 9/10". So: PACE and SPECTACLE. Every rewind is a FAST reverse SCRUB (about 120-200 ms) that
 * looks like time BREAKING (an RGB-split ghost of the bolt, VHS scrub bars, the portraits' tracking jitter, the splash
 * sucked back up in a sand VORTEX, the halo snapping backward, a stutter of reversed clock ticks and a tape zip). Every
 * replay SNAPS back faster than the last, like a rubber band, and lands BIGGER (more sand, a bigger ring, a deeper boom,
 * a harder shake). No dead air.
 *
 * THE ONE IDEA: a strike is a STORY that can be played backward. A bolt of golden sand leaves the hero's hand and lands;
 * then the WHOLE story runs in reverse at once (the struck portrait re-jolts into the hit, the bolt pops back out of the
 * face and RETRACES ITS EXACT PATH to the hand, its trail LEADING it as on a reversed film). Every frame of a rewind is a
 * forward frame at an earlier story time, so it can never read as a second throw.
 *
 * FOUR TIERS on the shared thresholds (`attackTier`: a knockout always plays IV):
 *  - I ONE STRIKE: a bolt of golden sand slams the target (THE impact).
 *  - II REWIND: it lands (a tick), scrubs back, and the same bolt snaps in again, harder (THE impact).
 *  - III THE STUTTER: it lands and scrubs back twice; each landing leaves an afterimage frozen at the contact; on the last
 *    replay those afterimages fly WITH the bolt, a beat ahead of it, so three echoes hit in a rapid stutter (bam, bam,
 *    BAM: THE impact on the last).
 *  - IV THE CRESCENDO (Huge, and every knockout): the halo spins backward like a clock and a clock DIAL spins backward on
 *    the target. The strike lands and scrubs back FIVE times, each loop faster and bigger, each rewind shedding an echo
 *    frozen in mid flight; the hourglass forms round the target; the last replay snaps in with every echo at once into
 *    one enormous gold and violet HOURGLASS SHATTER (crystal-sand rain, a big shake), on a SLOW-MO DIP (the one clock
 *    eases down and back up; never a freeze: R-PROG-ATTACK-10).
 *
 * THE CONTRACT: every landing before the last is a tick (FX and sound only). The consequence lands exactly ONCE, on the
 * last. No grey drain (the Ancient crate reveal owns "time stops / the scene drains to grey"). Reduced motion: fades.
 */
import { configStore } from '../heroAttack/configStore';
import { clamp, type Pt } from '../heroAttack/easing';
import {
  HERO_ATTACK_TIER_THRESHOLDS, TIERS, reducedAttackTimeline, attackTier, type AttackTierContext, type TierNum,
} from '../heroAttack/tiers';

export type { TierNum };

export const REWIND_LEVELS = ['t1', 't2', 't3', 't4'] as const;
export type RewindLevel = (typeof REWIND_LEVELS)[number];

export const REWIND_TIER_SUFFIXES = [
  'ReadyMs', 'FlyMs', 'HoldMs', 'RewindMs', 'Rewinds', 'Speedup', 'Size', 'Grains', 'Shake', 'Zoom', 'Punch', 'SettleMs', 'Dim',
] as const;
export type RewindTierSuffix = (typeof REWIND_TIER_SUFFIXES)[number];
type TierKey = `${RewindLevel}${RewindTierSuffix}`;

interface GlobalConfig {
  tier2At: number; tier3At: number; tier4At: number;
  absorbMs: number;
  /** Tier III: how far ahead of the bolt (story ms) each afterimage flies on the last replay (the stutter's spacing). */
  stutterMs: number;
  /** Tier IV: the last replay, with every frozen echo snapping in to land with it. */
  finalMs: number;
  /** Tier IV: the hourglass forms round the target this long before the shatter. */
  hourglassMs: number;
  /** Tier IV: the slow-mo dip on the shatter: the clock's lowest speed and how long (attack ms) it takes to ease back. */
  slowMo: number;
  slowMoMs: number;
  heroWindPx: number;
  heroThrowPx: number;
  /** The portraits' tracking jitter while time scrubs back (px). */
  jitterPx: number;
  /** Every card on both boards twitches BACKWARD this far on each rewind (px; one transform per board row). */
  twitchPx: number;
  /** THE GOD: the Ancient of Time's bust over the board, as a fraction of the screen height (0 = no apparition). */
  godSize: number;
  /** The gold wash over the whole screen on each rewind (opacity). */
  washAlpha: number;
  /** How long the torrent's tail keeps draining into the hit after it lands (story ms). */
  drainMs: number;
  arc: number;
  boltPx: number;
  trailMs: number;
  trailWidth: number;
  /** The rewinding bolt's RGB split (px). */
  splitPx: number;
  /** Sand grains shed (or, rewinding, gathered) per second of flight. */
  grainRate: number;
  haloSize: number;
  /** The halo's forward drift and its backward snap while time rewinds (radians per second). */
  haloDrift: number;
  haloRewind: number;
  /** Tier IV: the clock dial on the target (struck radii; 0 = none). */
  dialSize: number;
  /** Tier III: how long the afterimages take to fade after the impact. */
  echoMs: number;
  /** Tier IV: the frozen echoes' tremble (px). */
  echoTremble: number;
  hourglassSize: number;
  shatterSize: number;
  /** Tier IV: the crystal-sand rain after the shatter (grains). */
  rain: number;
  knockPx: number;
  squash: number;
  shakeMs: number;
  zoomOutMs: number;
  reducedFadeMs: number;
  colorSand: string;
  colorSandLight: string;
  colorGold: string;
  colorViolet: string;
  colorSplitA: string;
  colorSplitB: string;
  colorPlayer: string;
  colorFoe: string;
  sfxTickClip: string; sfxTickGain: number; sfxTickRate: number;
  sfxThrowClip: string; sfxThrowGain: number; sfxThrowRate: number;
  sfxSnapClip: string; sfxSnapGain: number; sfxSnapRate: number;
  sfxHitClip: string; sfxHitGain: number; sfxHitRate: number;
  sfxThudClip: string; sfxThudGain: number; sfxThudRate: number;
  sfxChimeClip: string; sfxChimeGain: number; sfxChimeRate: number;
  sfxRewindClip: string; sfxRewindGain: number; sfxRewindRate: number;
  sfxZipClip: string; sfxZipGain: number; sfxZipRate: number;
  sfxBoomClip: string; sfxBoomGain: number; sfxBoomRate: number;
  sfxRiserClip: string; sfxRiserGain: number; sfxRiserRate: number;
  sfxShatterClip: string; sfxShatterGain: number; sfxShatterRate: number;
  sfxGlassClip: string; sfxGlassGain: number; sfxGlassRate: number;
  sfxBellClip: string; sfxBellGain: number; sfxBellRate: number;
  sfxRumbleClip: string; sfxRumbleGain: number; sfxRumbleRate: number;
  sfxTailMix: number;
  sfxDuck: number;
  previewDamage: number;
  previewParts: number;
}
export type HeroRewindConfig = GlobalConfig & Record<TierKey, number>;

export const HERO_REWIND_COLOR_KEYS = ['colorSand', 'colorSandLight', 'colorGold', 'colorViolet', 'colorSplitA', 'colorSplitB', 'colorPlayer', 'colorFoe'] as const;
export const HERO_REWIND_CLIP_KEYS = [
  'sfxTickClip', 'sfxThrowClip', 'sfxSnapClip', 'sfxHitClip', 'sfxThudClip', 'sfxChimeClip', 'sfxRewindClip', 'sfxZipClip', 'sfxBoomClip',
  'sfxRiserClip', 'sfxShatterClip', 'sfxGlassClip', 'sfxBellClip', 'sfxRumbleClip',
] as const;
export type HeroRewindStrKey = (typeof HERO_REWIND_COLOR_KEYS)[number] | (typeof HERO_REWIND_CLIP_KEYS)[number];
export type HeroRewindNumKey = Exclude<keyof HeroRewindConfig, HeroRewindStrKey>;

/** Per tier, I / II / III / IV. */
const TIER_DEFAULTS: Record<RewindTierSuffix, [number, number, number, number]> = {
  ReadyMs: [260, 280, 300, 420],
  FlyMs: [300, 280, 270, 260],
  HoldMs: [0, 45, 40, 30],
  RewindMs: [0, 160, 150, 150],
  Rewinds: [0, 1, 2, 5],
  Speedup: [1, 0.68, 0.8, 0.72],
  Size: [1, 1.08, 1.16, 1.25],
  Grains: [16, 20, 24, 28],
  Shake: [8, 11, 14, 28],
  Zoom: [0.02, 0.025, 0.03, 0.045],
  Punch: [0.025, 0.035, 0.045, 0.085],
  SettleMs: [340, 380, 440, 640],
  Dim: [0.1, 0.14, 0.2, 0.32],
};

export const REWIND_TIER_RANGES: Record<RewindTierSuffix, [number, number, number]> = {
  ReadyMs: [80, 1500, 10],
  FlyMs: [120, 1200, 10],
  HoldMs: [0, 600, 5],
  RewindMs: [0, 1200, 5],
  Rewinds: [0, 6, 1],
  Speedup: [0.4, 1.2, 0.01],
  Size: [0.4, 2.5, 0.05],
  Grains: [0, 40, 1],
  Shake: [0, 40, 0.5],
  Zoom: [0, 0.1, 0.002],
  Punch: [0, 0.15, 0.001],
  SettleMs: [0, 2000, 10],
  Dim: [0, 0.6, 0.01],
};

const tierDefaults = Object.fromEntries(TIERS.flatMap((t) => REWIND_TIER_SUFFIXES.map((s) => [`t${t}${s}`, TIER_DEFAULTS[s][t - 1]]))) as Record<TierKey, number>;

export const HERO_REWIND_DEFAULTS: HeroRewindConfig = {
  ...HERO_ATTACK_TIER_THRESHOLDS,
  absorbMs: 160,
  stutterMs: 55,
  finalMs: 300,
  hourglassMs: 460,
  slowMo: 0.28,
  slowMoMs: 460,
  heroWindPx: 10,
  heroThrowPx: 16,
  jitterPx: 4,
  twitchPx: 7,
  godSize: 0.8,
  washAlpha: 0.16,
  drainMs: 150,
  arc: 0.12,
  boltPx: 70,
  trailMs: 230,
  trailWidth: 64,
  splitPx: 7,
  grainRate: 70,
  haloSize: 1.32,
  haloDrift: 0.6,
  haloRewind: 16,
  dialSize: 1.35,
  echoMs: 700,
  echoTremble: 2.5,
  hourglassSize: 2.1,
  shatterSize: 1.15,
  rain: 40,
  knockPx: 20,
  squash: 0.1,
  shakeMs: 380,
  zoomOutMs: 420,
  reducedFadeMs: 260,
  colorSand: '#f5d78a',
  colorSandLight: '#ffe9b0',
  colorGold: '#d4a537',
  colorViolet: '#8b5cf6',
  colorSplitA: '#ff3d7f',
  colorSplitB: '#3de8ff',
  colorPlayer: '#ffe9b0',
  colorFoe: '#ff7a5c',
  sfxTickClip: 'thymepiece', sfxTickGain: 0.55, sfxTickRate: 1.1,
  sfxThrowClip: 'fx/djartmusic-christmas-sparkle-whoosh-1-275404', sfxThrowGain: 0.4, sfxThrowRate: 1.25,
  sfxSnapClip: 'fx/universfield-whip-snap-242215', sfxSnapGain: 0.45, sfxSnapRate: 1.15,
  sfxHitClip: 'fx/blue-impact-hit', sfxHitGain: 0.5, sfxHitRate: 1.15,
  sfxThudClip: 'crit', sfxThudGain: 0.45, sfxThudRate: 1.1,
  sfxChimeClip: 'divineshieldbreak', sfxChimeGain: 0.22, sfxChimeRate: 1.6,
  sfxRewindClip: 'fx/djartmusic-christmas-sparkle-whoosh-1-275404', sfxRewindGain: 0.45, sfxRewindRate: 1.6,
  sfxZipClip: 'fx/stereogenicstudio-swish-swoosh-woosh-sfx-27-357164-3', sfxZipGain: 0.4, sfxZipRate: 1.9,
  sfxBoomClip: 'fx/universfield-cinematic-swoosh-impact-454392', sfxBoomGain: 0.6, sfxBoomRate: 1,
  sfxRiserClip: 'windup', sfxRiserGain: 0.45, sfxRiserRate: 1.2,
  sfxShatterClip: 'rebornshatter', sfxShatterGain: 0.75, sfxShatterRate: 0.92,
  sfxGlassClip: 'divineshieldbreak', sfxGlassGain: 0.55, sfxGlassRate: 0.85,
  sfxBellClip: 'equipclang', sfxBellGain: 0.55, sfxBellRate: 0.5,
  sfxRumbleClip: 'fx/heavy-rock-impact', sfxRumbleGain: 0.5, sfxRumbleRate: 0.85,
  sfxTailMix: 0.2,
  sfxDuck: 0.6,
  previewDamage: 12,
  previewParts: 4,
  ...tierDefaults,
};

const GLOBAL_RANGES: Record<Exclude<keyof GlobalConfig, HeroRewindStrKey>, [number, number, number]> = {
  tier2At: [2, 40, 1], tier3At: [2, 60, 1], tier4At: [2, 80, 1],
  absorbMs: [60, 600, 10],
  stutterMs: [0, 200, 5],
  finalMs: [120, 1500, 10],
  hourglassMs: [0, 1500, 10],
  slowMo: [0.1, 1, 0.01],
  slowMoMs: [0, 1200, 10],
  heroWindPx: [0, 40, 1],
  heroThrowPx: [0, 50, 1],
  jitterPx: [0, 16, 0.5],
  twitchPx: [0, 24, 0.5],
  godSize: [0, 1.6, 0.01],
  washAlpha: [0, 0.6, 0.01],
  drainMs: [0, 600, 5],
  arc: [0, 0.5, 0.01],
  boltPx: [10, 160, 1],
  trailMs: [0, 500, 5],
  trailWidth: [2, 80, 0.5],
  splitPx: [0, 30, 0.5],
  grainRate: [0, 300, 5],
  haloSize: [0.8, 2.5, 0.02],
  haloDrift: [0, 4, 0.05],
  haloRewind: [0, 40, 0.25],
  dialSize: [0, 3, 0.05],
  echoMs: [100, 4000, 20],
  echoTremble: [0, 12, 0.25],
  hourglassSize: [0.5, 4, 0.05],
  shatterSize: [0.3, 3, 0.05],
  rain: [0, 120, 1],
  knockPx: [0, 60, 1],
  squash: [0, 0.3, 0.01],
  shakeMs: [0, 1500, 10],
  zoomOutMs: [60, 1500, 10],
  reducedFadeMs: [60, 1000, 10],
  sfxTickGain: [0, 2, 0.05], sfxTickRate: [0.5, 2.5, 0.01],
  sfxThrowGain: [0, 2, 0.05], sfxThrowRate: [0.5, 2.5, 0.01],
  sfxSnapGain: [0, 2, 0.05], sfxSnapRate: [0.5, 2.5, 0.01],
  sfxHitGain: [0, 2, 0.05], sfxHitRate: [0.5, 2.5, 0.01],
  sfxThudGain: [0, 2, 0.05], sfxThudRate: [0.5, 2.5, 0.01],
  sfxChimeGain: [0, 2, 0.05], sfxChimeRate: [0.5, 2.5, 0.01],
  sfxRewindGain: [0, 2, 0.05], sfxRewindRate: [0.5, 2.5, 0.01],
  sfxZipGain: [0, 2, 0.05], sfxZipRate: [0.5, 2.5, 0.01],
  sfxBoomGain: [0, 2, 0.05], sfxBoomRate: [0.5, 2.5, 0.01],
  sfxRiserGain: [0, 2, 0.05], sfxRiserRate: [0.5, 2.5, 0.01],
  sfxShatterGain: [0, 2, 0.05], sfxShatterRate: [0.5, 2.5, 0.01],
  sfxGlassGain: [0, 2, 0.05], sfxGlassRate: [0.5, 2.5, 0.01],
  sfxBellGain: [0, 2, 0.05], sfxBellRate: [0.3, 2.5, 0.01],
  sfxRumbleGain: [0, 2, 0.05], sfxRumbleRate: [0.5, 2.5, 0.01],
  sfxTailMix: [0, 1, 0.01],
  sfxDuck: [0, 1, 0.05],
  previewDamage: [1, 60, 1],
  previewParts: [1, 8, 1],
};

export const HERO_REWIND_RANGES: Record<HeroRewindNumKey, [number, number, number]> = {
  ...GLOBAL_RANGES,
  ...(Object.fromEntries(TIERS.flatMap((t) => REWIND_TIER_SUFFIXES.map((s) => [`t${t}${s}`, REWIND_TIER_RANGES[s]]))) as Record<TierKey, [number, number, number]>),
};

/** Hard caps whatever the tuner says (the loop count bounds the echoes and the sprites). */
export const REWIND_CAPS = { rewinds: 6, grains: 40, shakePx: 40, zoom: 0.1 } as const;

const store = configStore<HeroRewindConfig>({
  key: 'ascent.herorewind.v2', defaults: HERO_REWIND_DEFAULTS, ranges: HERO_REWIND_RANGES,
  colorKeys: HERO_REWIND_COLOR_KEYS, clipKeys: HERO_REWIND_CLIP_KEYS, previewKeys: ['previewDamage', 'previewParts'],
});
export const heroRewindStore = store;
export const getHeroRewindConfig = store.get;
export const clampHeroRewindValue = store.clamp;
export const sanitizeHeroRewindConfig = store.sanitize;
export const heroRewindConfigJson = store.json;
/** The preview speed hook (Recruit + the Collection read one per style). Always 1: this tuner has no speed dial. */
export function heroRewindPreviewSpeed(): number { return 1; }

export function rewindTierDials(tier: TierNum, c: HeroRewindConfig = store.get()): Record<RewindTierSuffix, number> {
  return Object.fromEntries(REWIND_TIER_SUFFIXES.map((s) => [s, c[`t${tier}${s}`]])) as Record<RewindTierSuffix, number>;
}

// ─── the pure plan ─────────────────────────────────────────────────────────────────────────────────────────────

export const REWIND_REF_DISTANCE = 1600;

/** A leg for a distance: the tier's time, scaled gently by the distance. */
export function rewindLegMs(distance: number, ms: number): number {
  const d = Number.isFinite(distance) && distance > 0 ? distance : REWIND_REF_DISTANCE;
  return Math.round(ms * clamp(Math.sqrt(d / REWIND_REF_DISTANCE), 0.62, 1.15));
}

/**
 * One strike: the bolt leaves the hand (`flyAt`), lands (`landAt`), the splash plays on (`holdMs`), then, if it rewinds,
 * the whole story SCRUBS BACKWARD from `rewindAt` to `backAt` (when the bolt is back in the hand), and the replay leaves
 * at once.
 *
 * STORY TIME `s` (ms since the bolt left the hand, at this strike's own pace): forward it runs 0 -> fly + hold; a rewind
 * runs it back fly + hold -> 0 at the rate `(fly + hold) / rewindMs`. The bolt is at `strikePos(s)` while `s < fly`.
 */
export interface RewindStrike {
  flyAt: number;
  flyMs: number;
  landAt: number;
  holdMs: number;
  /** -1 = this strike does not rewind (the last). */
  rewindAt: number;
  rewindMs: number;
  backAt: number;
}

/** A frozen echo (Tier IV): shed by a rewinding bolt at `at`, where it is `pathS` along the path. */
export interface RewindEcho { at: number; pathS: number }

export interface RewindPlanInput extends AttackTierContext {
  /**
   * Extra loops on top of the tier's (default 0). The bolt-on point for the Ancient "Knockout" remix of Huge (owner rule
   * 2026-10-02, plumbing on its own branch): one more replay before the finale, with the same rubber-band speed-up.
   */
  extraRewinds?: number;
  leadIn?: number;
  total: number;
  distance: number;
  reduced?: boolean;
}

export interface RewindPlan {
  reduced: boolean;
  tier: TierNum;
  k: number;
  total: number;
  chargeAt: number;
  absorbEnd: number;
  throwAt: number;
  strikes: RewindStrike[];
  /** Landings BEFORE the impact (ticks): every loop's landing, then Tier III's stutter landings. */
  hits: number[];
  /** Every rewind's start. */
  rewinds: number[];
  /** Tier III: an afterimage frozen at each loop's landing (they fly with the last replay). */
  afterimages: number[];
  /** Tier III: the afterimages' landings on the last replay, a beat ahead of the bolt (ticks). */
  stutters: number[];
  /** Tier IV: the frozen echoes, and the finale (every echo resumes at `finaleAt` and lands at `impactAt`). */
  echoes: RewindEcho[];
  finaleAt: number;
  hourglassAt: number;
  impactAt: number;
  endAt: number;
  size: number;
  grains: number;
  shakePx: number;
  zoom: number;
  punch: number;
  dim: number;
}

/** Forward flight ease: thrown hard and still gathering pace into the hit. Its exact reverse is the rewind. */
export const flyEase = (u: number): number => { const t = Math.min(1, Math.max(0, Number.isFinite(u) ? u : 0)); return 0.35 * t + 0.65 * t * t; };
/** The inverse of `flyEase` (the flight fraction at which the bolt is `s` along the path). */
export function flyEaseInv(s: number): number {
  const v = Math.min(1, Math.max(0, Number.isFinite(s) ? s : 0));
  return (-0.35 + Math.sqrt(0.35 * 0.35 + 4 * 0.65 * v)) / (2 * 0.65);
}

/** Where Tier IV's echoes freeze along the path (one per rewind, spaced back toward the hand). */
export function echoPathS(i: number): number { return clamp(0.86 - 0.12 * i, 0.2, 0.95); }
/** Where Tier III's afterimages freeze at the contact (stacked back along the path). */
export function afterPathS(i: number): number { return clamp(0.95 - 0.08 * i, 0.2, 0.98); }

/** The whole Rewind, in base ms. Pure and deterministic. */
export function rewindPlan(input: RewindPlanInput, c: HeroRewindConfig = store.get()): RewindPlan {
  const total = Math.max(0, Math.round(input.total));
  const tier = attackTier(total, input, c); // a knockout always plays the shared Tier IV
  const L = rewindTierDials(tier, c);
  const k = (tier - 1) / 3;
  const base = {
    tier, k, total, size: L.Size, grains: Math.round(clamp(L.Grains, 0, REWIND_CAPS.grains)),
    shakePx: clamp(L.Shake, 0, REWIND_CAPS.shakePx), zoom: clamp(L.Zoom, 0, REWIND_CAPS.zoom), punch: L.Punch, dim: L.Dim,
  };
  if (input.reduced) {
    const r = reducedAttackTimeline(input.leadIn ?? 0, c.reducedFadeMs);
    const at = r.impactAt;
    return {
      ...base, reduced: true, chargeAt: at, absorbEnd: at, throwAt: at, strikes: [], hits: [], rewinds: [], afterimages: [], stutters: [], echoes: [],
      finaleAt: -1, hourglassAt: -1, impactAt: at, endAt: r.endAt, size: 0, grains: 0, shakePx: 0, zoom: 0, punch: 0, dim: 0,
    };
  }
  const chargeAt = Math.max(0, input.leadIn ?? 0);
  const absorbEnd = chargeAt + c.absorbMs;
  const throwAt = chargeAt + Math.max(L.ReadyMs, c.absorbMs);
  const n = Math.round(clamp(L.Rewinds + Math.max(0, input.extraRewinds ?? 0), 0, REWIND_CAPS.rewinds));
  const sp = clamp(L.Speedup, 0.4, 1.2);
  const finale = tier === 4 && n > 0;
  const strikes: RewindStrike[] = [];
  let at = throwAt;
  for (let i = 0; i <= n; i++) {
    // Every replay snaps back faster than the last (a rubber band): flight, hold and scrub all shrink by `sp` a loop.
    const f = Math.pow(sp, i);
    const last = i === n;
    // Tier IV's last replay is the finale (every echo snaps in with it): its own flight.
    const flyMs = last && finale ? rewindLegMs(input.distance, c.finalMs) : Math.max(50, rewindLegMs(input.distance, L.FlyMs * f));
    const landAt = at + flyMs;
    if (last) { strikes.push({ flyAt: at, flyMs, landAt, holdMs: 0, rewindAt: -1, rewindMs: 0, backAt: -1 }); break; }
    const holdMs = Math.max(0, L.HoldMs * f);
    const rewindMs = Math.max(40, rewindLegMs(input.distance, L.RewindMs * f));
    const rewindAt = landAt + holdMs;
    const backAt = rewindAt + rewindMs;
    strikes.push({ flyAt: at, flyMs, landAt, holdMs, rewindAt, rewindMs, backAt });
    at = backAt; // no dead air: the replay leaves the instant the scrub reaches the hand
  }
  const lastStrike = strikes[strikes.length - 1]!;
  const impactAt = lastStrike.landAt;
  const looping = strikes.slice(0, -1);
  // Tier III: an afterimage at each loop's landing; on the last replay each flies `stutterMs` (story) ahead of the bolt
  // per step, so they land a beat apart before it (clamped inside the last flight).
  const afterimages = tier === 3 ? looping.map((s) => s.landAt) : [];
  const stutters = tier === 3
    ? afterimages.map((_, j) => impactAt - Math.min(lastStrike.flyMs * 0.8, (afterimages.length - j) * c.stutterMs)).filter((t) => t < impactAt)
    : [];
  const echoes: RewindEcho[] = finale
    ? looping.map((s, i) => {
      const pathS = echoPathS(i);
      // The rewind runs the story back from fly + hold; the bolt is at `pathS` at story time fly x flyEaseInv(pathS).
      const story = s.flyMs * flyEaseInv(pathS);
      const at = s.rewindAt + ((s.flyMs + s.holdMs - story) / (s.flyMs + s.holdMs)) * s.rewindMs;
      return { at, pathS };
    })
    : [];
  const finaleAt = finale ? lastStrike.flyAt : -1;
  const hourglassAt = finale ? Math.max(throwAt, impactAt - c.hourglassMs) : -1;
  const endAt = impactAt + Math.max(c.zoomOutMs * 0.8, L.SettleMs);
  return {
    ...base, reduced: false, chargeAt, absorbEnd, throwAt, strikes, hits: [...looping.map((s) => s.landAt), ...stutters], rewinds: looping.map((s) => s.rewindAt),
    afterimages, stutters, echoes, finaleAt, hourglassAt, impactAt, endAt,
  };
}

export type RewindCueKind = 'charge' | 'throw' | 'hit' | 'rewind' | 'back' | 'echo' | 'after' | 'stutter' | 'hourglass' | 'impact' | 'end';
export interface RewindCue { at: number; kind: RewindCueKind; i: number }

export function rewindCues(p: RewindPlan): RewindCue[] {
  const out: RewindCue[] = [];
  if (!p.reduced) {
    out.push({ at: p.chargeAt, kind: 'charge', i: 0 });
    p.strikes.forEach((s, i) => {
      out.push({ at: s.flyAt, kind: 'throw', i });
      if (s.rewindAt >= 0) {
        out.push({ at: s.landAt, kind: 'hit', i });
        out.push({ at: s.rewindAt, kind: 'rewind', i });
        out.push({ at: s.backAt, kind: 'back', i });
      }
    });
    p.echoes.forEach((e, i) => out.push({ at: e.at, kind: 'echo', i }));
    p.afterimages.forEach((at, i) => out.push({ at, kind: 'after', i }));
    p.stutters.forEach((at, i) => out.push({ at, kind: 'stutter', i }));
    if (p.hourglassAt >= 0) out.push({ at: p.hourglassAt, kind: 'hourglass', i: 0 });
  }
  out.push({ at: p.impactAt, kind: 'impact', i: p.strikes.length - 1 });
  out.push({ at: p.endAt, kind: 'end', i: 0 });
  const order: Record<RewindCueKind, number> = { charge: 0, back: 1, throw: 2, hit: 3, after: 4, rewind: 5, echo: 6, stutter: 7, hourglass: 8, impact: 9, end: 10 };
  return out.sort((a, b) => a.at - b.at || order[a.kind] - order[b.kind]);
}

/**
 * Where the story is at `t`: which strike, its story time `s` (ms since that bolt left the hand), and whether it is
 * running BACKWARD. Null before the first throw. Pure.
 */
export interface RewindState { i: number; s: number; rewinding: boolean; strike: RewindStrike }

export function rewindStateAt(p: RewindPlan, t: number): RewindState | null {
  if (p.reduced) return null;
  for (let i = p.strikes.length - 1; i >= 0; i--) {
    const st = p.strikes[i]!;
    if (t < st.flyAt) continue;
    const story = st.flyMs + st.holdMs;
    if (st.rewindAt < 0 || t < st.rewindAt) return { i, s: t - st.flyAt, rewinding: false, strike: st };
    if (t < st.backAt) {
      const u = (t - st.rewindAt) / Math.max(1, st.rewindMs);
      return { i, s: story * (1 - u), rewinding: true, strike: st };
    }
    return null;
  }
  return null;
}

/**
 * Tier IV's SLOW-MO DIP on the shatter (the Soul Stitch / Basketball technique; a freeze is banned, R-PROG-ATTACK-10:
 * "it looks like lag"): the one clock drops to `slowMo` the instant the hourglass shatters and eases back to full speed
 * over `slowMoMs` (attack time), a smooth ramp that never reaches 0. Every other tier and moment: 1.
 */
export function rewindTimeScale(p: RewindPlan, c: HeroRewindConfig, t: number): number {
  if (p.tier < 4 || p.reduced || c.slowMoMs <= 0 || t < p.impactAt || t >= p.impactAt + c.slowMoMs) return 1;
  const u = (t - p.impactAt) / c.slowMoMs;
  const lo = Math.min(1, Math.max(0.1, c.slowMo));
  return lo + (1 - lo) * u * u * (3 - 2 * u);
}

/** The extra REAL ms the slow-mo dip adds (for the safety timer and the readout). */
export function rewindSlowExtraMs(p: RewindPlan, c: HeroRewindConfig): number {
  if (p.tier < 4 || p.reduced || c.slowMoMs <= 0) return 0;
  let extra = 0;
  for (let t = p.impactAt; t < p.impactAt + c.slowMoMs; t += 5) extra += 5 / rewindTimeScale(p, c, t) - 5;
  return extra;
}

// ─── the strike path (pure) ────────────────────────────────────────────────────────────────────────────────────

/** The one path every strike (and every replay) follows: from the hand to the contact point, bowed up a little. */
export interface RewindPath { hand: Pt; ctrl: Pt; hit: Pt; arrive: Pt; dist: number }

export function rewindPath(a: Pt, d: Pt, radius: number, aRadius: number, arc: number, ceilY = Number.NEGATIVE_INFINITY): RewindPath {
  const L = Math.hypot(d.x - a.x, d.y - a.y) || 1;
  const u = { x: (d.x - a.x) / L, y: (d.y - a.y) / L };
  const nrm = { x: -u.y, y: u.x };
  const up = nrm.y > 0 ? -1 : 1; // up * nrm points toward the top of the screen
  const hand = { x: a.x + u.x * aRadius * 0.85, y: a.y + u.y * aRadius * 0.85 };
  const hit = { x: d.x - u.x * radius * 0.25, y: d.y - u.y * radius * 0.25 };
  const D = Math.hypot(hit.x - hand.x, hit.y - hand.y) || 1;
  const ctrl = { x: (hand.x + hit.x) / 2 + nrm.x * up * arc * D, y: Math.max(ceilY, (hand.y + hit.y) / 2 + nrm.y * up * arc * D) };
  const ax = hit.x - ctrl.x, ay = hit.y - ctrl.y;
  const al = Math.hypot(ax, ay) || 1;
  return { hand, ctrl, hit, arrive: { x: ax / al, y: ay / al }, dist: D };
}

/** A point `s` (0..1) along the path. Pure. */
export function pathAt(p: RewindPath, s: number): Pt {
  const e = Math.min(1, Math.max(0, Number.isFinite(s) ? s : 0));
  const m = 1 - e;
  return { x: m * m * p.hand.x + 2 * m * e * p.ctrl.x + e * e * p.hit.x, y: m * m * p.hand.y + 2 * m * e * p.ctrl.y + e * e * p.hit.y };
}

/** Where a strike's bolt is at story time `s` (held at the contact point once it lands). Pure. */
export function strikePos(p: RewindPath, flyMs: number, s: number): Pt {
  return pathAt(p, flyEase(s / Math.max(1, flyMs)));
}

/** Tier IV's finale: where echo `e` is `u` (0..1) through the finale (it resumes from its spot and lands with the bolt). */
export function echoFinalePos(p: RewindPath, e: RewindEcho, u: number): Pt {
  return pathAt(p, e.pathS + (1 - e.pathS) * flyEase(u));
}

// ─── the camera (pure) ─────────────────────────────────────────────────────────────────────────────────────────

const springAt = (ms: number, hz: number, tau: number): number => (ms < 0 ? 0 : Math.exp(-ms / tau) * Math.cos(2 * Math.PI * hz * (ms / 1000)));
const sine = (u: number): number => 0.5 - 0.5 * Math.cos(Math.PI * Math.min(1, Math.max(0, u)));

/**
 * The camera: a push in through the ready that holds; a kick on every tick landing, HARDER every loop, and a kick BACK
 * on every rewind (time snapping back); Tier IV pushes further in through the finale; a punch and a shake on the impact
 * (Tier IV's biggest in the roster). Pure.
 */
export function rewindCameraAt(p: RewindPlan, c: HeroRewindConfig, t: number, dir: Pt = { x: 1, y: 0 }): { zoom: number; x: number; y: number } {
  if (p.reduced) return { zoom: 1, x: 0, y: 0 };
  let z = 0;
  if (t >= p.chargeAt && t < p.impactAt) {
    z += p.zoom * sine((t - p.chargeAt) / Math.max(1, p.throwAt - p.chargeAt));
    if (p.finaleAt >= 0 && t >= p.finaleAt) z += p.punch * 0.6 * sine((t - p.finaleAt) / Math.max(1, p.impactAt - p.finaleAt));
  } else if (t >= p.impactAt) {
    z += (p.zoom + p.punch * (p.finaleAt >= 0 ? 1.6 : 1)) * Math.exp(-(t - p.impactAt) / Math.max(1, c.zoomOutMs / 4));
  }
  // Each tick landing punches the zoom a little too, more each loop.
  p.hits.forEach((at, i) => { if (t >= at) z += p.punch * (0.25 + 0.08 * i) * Math.exp(-(t - at) / 60); });
  let x = 0, y = 0;
  const kick = (at: number, amp: number, tau: number, hz: number): void => { const s = springAt(t - at, hz, tau); x += dir.x * amp * s; y += dir.y * amp * s; };
  kick(p.throwAt, -p.shakePx * 0.1, 40, 14);
  p.hits.forEach((at, i) => kick(at, p.shakePx * (0.35 + 0.1 * i), 45, 18));
  for (const at of p.rewinds) kick(at, -p.shakePx * 0.25, 40, 12);
  kick(p.impactAt, p.shakePx, Math.max(1, c.shakeMs / 4), 16);
  return { zoom: 1 + Math.max(0, z), x, y };
}

/** The anchor: the attacker through the ready, following the first strike to the defender, then the defender. */
export function rewindCameraFocus(p: RewindPlan, t: number, a: Pt, d: Pt): Pt {
  const first = p.strikes[0]?.landAt ?? p.impactAt;
  if (t <= p.throwAt) return a;
  if (t < first) { const e = sine((t - p.throwAt) / Math.max(1, first - p.throwAt)); return { x: a.x + (d.x - a.x) * e, y: a.y + (d.y - a.y) * e }; }
  return d;
}

/**
 * The halo's spin rate at `t` (radians per second; negative = BACKWARD, like a clock run back). A forward drift and a
 * hard backward SNAP through every scrub; Tier IV spins backward the whole time, faster every loop, hardest through the
 * finale. Pure.
 */
export function haloRateAt(p: RewindPlan, c: HeroRewindConfig, t: number): number {
  if (p.reduced || t < p.chargeAt) return 0;
  if (t >= p.impactAt) return c.haloDrift * 3;
  const st = rewindStateAt(p, t);
  if (p.tier === 4) {
    let loops = 0;
    for (const r of p.rewinds) if (t >= r) loops++;
    const hard = st?.rewinding ? 1 : 0.35;
    const fin = p.finaleAt >= 0 && t >= p.finaleAt ? 1.5 : 1;
    return -c.haloRewind * hard * (1 + 0.3 * loops) * fin;
  }
  return st?.rewinding ? -c.haloRewind : c.haloDrift;
}
