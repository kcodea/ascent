/**
 * THE BULLET TIME HERO ATTACK ("Bullet Time", the Ancient of Time; ANCIENT rarity): its tuned values, its pure timeline,
 * the pure dart paths, the slow-mo dip and the pure camera.
 *
 * Owner 2026-10-02: "build a new ancient animation for this ancient, the ancient of time". After three rewind builds
 * the owner PICKED "BULLET TIME", then on review (2026-10-02): "looks weird not being centered and prefer slow motion vs
 * stopped/grey time. like more cutting through time than stopping it and dont grey out". So THE SIGNATURE is CUTTING
 * THROUGH TIME: gold clock-hand blades fly in, and as they reach the target time drops into DRAMATIC SLOW MOTION (they
 * keep crawling forward, never stopping), each one having sliced a bright gold TEAR through the air behind it, a
 * time-rift glow along the cut, afterimages trailing; then time SNAPS back to full speed and everything lands. Every
 * shape centres on the struck hero; the colours stay full (no grey).
 *
 * FOUR TIERS on the shared thresholds (`attackTier`: a knockout always plays IV):
 *  - I: a gold clock-hand dart cuts in and slows to a crawl an inch from the target inside a clock dial; snap: the hit.
 *  - II: three darts cut in from round the target and crawl; snap: they all hit together.
 *  - III: a volley of twelve cuts in to a spiral round the target and crawls as a clock face appears; the hero SNAPS:
 *    they land in a machine-gun run (the last is the blow).
 *  - IV (Huge): dozens of blades slice in to a DOME of rings round the target before a big clock face counting 3-2-1,
 *    crawling; time snaps back and the whole dome collapses in one massive gold and violet impact, on a slow-mo dip.
 *  - KNOCKOUT ("Tier V", an Ancient knockout; owner rule 2026-10-02): IV remixed: one EXTRA ring of blades in the dome
 *    (cyan and magenta), a PRISMATIC collapse, a 1.3x shake, a deeper and longer slow-mo dip and the KO sting.
 *
 * NEVER A FROZEN FRAME (owner rule R-PROG-ATTACK-10: "it looks like lag"): in the slow motion EVERYTHING still moves, just
 * slowed (the blades crawl, the FX run at `slowFx` speed, the clock hand sweeps, the camera pushes in). The snap back is
 * hard: a flash, a chromatic burst, a shake.
 *
 * THE CONTRACT: every hit before the last (III's run) is a tick; the consequence lands exactly ONCE, on the last hit (or
 * the collapse). Reduced motion: fades only.
 */
import { configStore } from '../heroAttack/configStore';
import { clamp, type Pt } from '../heroAttack/easing';
import {
  HERO_ATTACK_TIER_THRESHOLDS, TIERS, reducedAttackTimeline, attackTier, isKnockoutVariant, type AttackTierContext, type TierNum,
} from '../heroAttack/tiers';
import { KO_SHAKE, koDipExtraMs, koTimeScale, type KoDip } from '../heroAttack/knockout';

export type { TierNum };

export const BULLET_LEVELS = ['t1', 't2', 't3', 't4'] as const;
export type BulletLevel = (typeof BULLET_LEVELS)[number];

export const BULLET_TIER_SUFFIXES = [
  'ReadyMs', 'Darts', 'StaggerMs', 'FlyMs', 'HangMs', 'ResumeMs', 'Size', 'Shake', 'Zoom', 'Push', 'Punch', 'SettleMs', 'Dim',
] as const;
export type BulletTierSuffix = (typeof BULLET_TIER_SUFFIXES)[number];
type TierKey = `${BulletLevel}${BulletTierSuffix}`;

interface GlobalConfig {
  tier2At: number; tier3At: number; tier4At: number;
  absorbMs: number;
  /** III: the gap between each dart of the run after the snap (the last is the blow). */
  runMs: number;
  /** IV: each count of the 3-2-1. */
  countMs: number;
  /** IV: the dome's three rings (blades per ring) and its size. */
  domeRings: number;
  domeBlades: number;
  domeSize: number;
  /** IV: the slow-mo dip on the collapse (lowest clock speed, and how long it takes to ease back, attack ms). */
  slowMo: number;
  slowMoMs: number;
  /** How far short of the target a dart hangs (struck radii). */
  hangR: number;
  dartPx: number;
  trailMs: number;
  trailWidth: number;
  /** In the slow motion each blade crawls this fraction of the rest of the way to the target. */
  crawl: number;
  /** How fast the FX run in the slow motion (sparks, motes, ripples, glints, tears). */
  slowFx: number;
  /** The gold TEAR each blade slices through the air (px). */
  riftWidth: number;
  /** An afterimage peels off a crawling blade every this many ms (IV every three times this). */
  ghostMs: number;
  /** The gold time ripple pulsing off the target in the slow motion (ms between pulses). */
  rippleMs: number;
  /** Dust motes drifting in the slow motion. */
  motes: number;
  clockSize: number;
  impactSize: number;
  heroWindPx: number;
  heroThrowPx: number;
  knockPx: number;
  squash: number;
  shakeMs: number;
  zoomOutMs: number;
  reducedFadeMs: number;
  colorGold: string;
  colorLight: string;
  colorViolet: string;
  colorPlayer: string;
  colorFoe: string;
  sfxTickClip: string; sfxTickGain: number; sfxTickRate: number;
  sfxThrowClip: string; sfxThrowGain: number; sfxThrowRate: number;
  sfxFreezeClip: string; sfxFreezeGain: number; sfxFreezeRate: number;
  sfxStopClip: string; sfxStopGain: number; sfxStopRate: number;
  sfxSnapClip: string; sfxSnapGain: number; sfxSnapRate: number;
  sfxRestartClip: string; sfxRestartGain: number; sfxRestartRate: number;
  sfxHitClip: string; sfxHitGain: number; sfxHitRate: number;
  sfxThudClip: string; sfxThudGain: number; sfxThudRate: number;
  sfxBoomClip: string; sfxBoomGain: number; sfxBoomRate: number;
  sfxBellClip: string; sfxBellGain: number; sfxBellRate: number;
  sfxRumbleClip: string; sfxRumbleGain: number; sfxRumbleRate: number;
  sfxTailMix: number;
  sfxDuck: number;
  previewDamage: number;
  previewParts: number;
}
export type HeroBulletTimeConfig = GlobalConfig & Record<TierKey, number>;

export const HERO_BULLET_COLOR_KEYS = ['colorGold', 'colorLight', 'colorViolet', 'colorPlayer', 'colorFoe'] as const;
export const HERO_BULLET_CLIP_KEYS = [
  'sfxTickClip', 'sfxThrowClip', 'sfxFreezeClip', 'sfxStopClip', 'sfxSnapClip', 'sfxRestartClip', 'sfxHitClip', 'sfxThudClip',
  'sfxBoomClip', 'sfxBellClip', 'sfxRumbleClip',
] as const;
export type HeroBulletStrKey = (typeof HERO_BULLET_COLOR_KEYS)[number] | (typeof HERO_BULLET_CLIP_KEYS)[number];
export type HeroBulletNumKey = Exclude<keyof HeroBulletTimeConfig, HeroBulletStrKey>;

/** Per tier, I / II / III / IV. (IV's darts come from the dome dials; its Darts dial is unused.) */
const TIER_DEFAULTS: Record<BulletTierSuffix, [number, number, number, number]> = {
  ReadyMs: [220, 220, 240, 300],
  Darts: [1, 3, 12, 36],
  StaggerMs: [0, 70, 28, 16],
  FlyMs: [260, 250, 300, 220],
  HangMs: [360, 420, 440, 0],
  ResumeMs: [70, 80, 80, 150],
  Size: [1.6, 1.25, 0.85, 0.72],
  Shake: [10, 13, 16, 34],
  Zoom: [0.02, 0.025, 0.03, 0.04],
  Push: [0.03, 0.04, 0.05, 0.08],
  Punch: [0.035, 0.045, 0.06, 0.12],
  SettleMs: [360, 380, 440, 620],
  Dim: [0.1, 0.14, 0.2, 0.3],
};

export const BULLET_TIER_RANGES: Record<BulletTierSuffix, [number, number, number]> = {
  ReadyMs: [80, 1500, 10],
  Darts: [1, 48, 1],
  StaggerMs: [0, 300, 2],
  FlyMs: [80, 1200, 10],
  HangMs: [0, 2000, 10],
  ResumeMs: [30, 600, 5],
  Size: [0.3, 2.5, 0.05],
  Shake: [0, 40, 0.5],
  Zoom: [0, 0.1, 0.002],
  Push: [0, 0.2, 0.002],
  Punch: [0, 0.15, 0.001],
  SettleMs: [0, 2000, 10],
  Dim: [0, 0.6, 0.01],
};

const tierDefaults = Object.fromEntries(TIERS.flatMap((t) => BULLET_TIER_SUFFIXES.map((s) => [`t${t}${s}`, TIER_DEFAULTS[s][t - 1]]))) as Record<TierKey, number>;

export const HERO_BULLET_DEFAULTS: HeroBulletTimeConfig = {
  ...HERO_ATTACK_TIER_THRESHOLDS,
  absorbMs: 160,
  runMs: 24,
  countMs: 300,
  domeRings: 3,
  domeBlades: 12,
  domeSize: 1,
  slowMo: 0.22,
  slowMoMs: 420,
  hangR: 1.15,
  dartPx: 170,
  trailMs: 24,
  trailWidth: 30,
  crawl: 0.3,
  slowFx: 0.25,
  riftWidth: 9,
  ghostMs: 80,
  rippleMs: 260,
  motes: 18,
  clockSize: 1,
  impactSize: 1,
  heroWindPx: 10,
  heroThrowPx: 14,
  knockPx: 22,
  squash: 0.1,
  shakeMs: 380,
  zoomOutMs: 420,
  reducedFadeMs: 260,
  colorGold: '#d4a537',
  colorLight: '#ffe9b0',
  colorViolet: '#8b5cf6',
  colorPlayer: '#ffe9b0',
  colorFoe: '#ff7a5c',
  sfxTickClip: 'thymepiece', sfxTickGain: 0.55, sfxTickRate: 1.1,
  sfxThrowClip: 'fx/djartmusic-christmas-sparkle-whoosh-1-275404', sfxThrowGain: 0.32, sfxThrowRate: 1.6,
  sfxFreezeClip: 'prismaticpick', sfxFreezeGain: 0.35, sfxFreezeRate: 1.25,
  sfxStopClip: 'fx/djartmusic-christmas-sparkle-whoosh-1-275404', sfxStopGain: 0.45, sfxStopRate: 0.8,
  sfxSnapClip: 'equipmentsheen', sfxSnapGain: 0.6, sfxSnapRate: 1.2,
  sfxRestartClip: 'fx/djartmusic-christmas-sparkle-whoosh-1-275404', sfxRestartGain: 0.5, sfxRestartRate: 1.4,
  sfxHitClip: 'fx/blue-impact-hit', sfxHitGain: 0.5, sfxHitRate: 1.15,
  sfxThudClip: 'castspell', sfxThudGain: 0.5, sfxThudRate: 0.8,
  sfxBoomClip: 'fx/universfield-cinematic-swoosh-impact-454392', sfxBoomGain: 0.6, sfxBoomRate: 1,
  sfxBellClip: 'equipmentsheen', sfxBellGain: 0.5, sfxBellRate: 0.55,
  sfxRumbleClip: 'fx/universfield-cinematic-swoosh-impact-454392', sfxRumbleGain: 0.45, sfxRumbleRate: 0.6,
  sfxTailMix: 0.2,
  sfxDuck: 0.6,
  previewDamage: 12,
  previewParts: 4,
  ...tierDefaults,
};

const GLOBAL_RANGES: Record<Exclude<keyof GlobalConfig, HeroBulletStrKey>, [number, number, number]> = {
  tier2At: [2, 40, 1], tier3At: [2, 60, 1], tier4At: [2, 80, 1],
  absorbMs: [60, 600, 10],
  runMs: [0, 120, 2],
  countMs: [100, 1000, 10],
  domeRings: [1, 4, 1],
  domeBlades: [4, 20, 1],
  domeSize: [0.4, 2.5, 0.05],
  slowMo: [0.1, 1, 0.01],
  slowMoMs: [0, 1200, 10],
  hangR: [0.6, 3, 0.05],
  dartPx: [16, 200, 1],
  trailMs: [0, 400, 5],
  trailWidth: [1, 60, 0.5],
  crawl: [0, 0.8, 0.01],
  slowFx: [0.05, 1, 0.01],
  riftWidth: [0, 40, 0.5],
  ghostMs: [20, 400, 5],
  rippleMs: [80, 2000, 10],
  motes: [0, 60, 1],
  clockSize: [0.3, 3, 0.05],
  impactSize: [0.3, 3, 0.05],
  heroWindPx: [0, 40, 1],
  heroThrowPx: [0, 50, 1],
  knockPx: [0, 60, 1],
  squash: [0, 0.3, 0.01],
  shakeMs: [0, 1500, 10],
  zoomOutMs: [60, 1500, 10],
  reducedFadeMs: [60, 1000, 10],
  sfxTickGain: [0, 2, 0.05], sfxTickRate: [0.5, 2.5, 0.01],
  sfxThrowGain: [0, 2, 0.05], sfxThrowRate: [0.5, 2.5, 0.01],
  sfxFreezeGain: [0, 2, 0.05], sfxFreezeRate: [0.5, 2.5, 0.01],
  sfxStopGain: [0, 2, 0.05], sfxStopRate: [0.5, 2.5, 0.01],
  sfxSnapGain: [0, 2, 0.05], sfxSnapRate: [0.5, 2.5, 0.01],
  sfxRestartGain: [0, 2, 0.05], sfxRestartRate: [0.5, 2.5, 0.01],
  sfxHitGain: [0, 2, 0.05], sfxHitRate: [0.5, 2.5, 0.01],
  sfxThudGain: [0, 2, 0.05], sfxThudRate: [0.5, 2.5, 0.01],
  sfxBoomGain: [0, 2, 0.05], sfxBoomRate: [0.5, 2.5, 0.01],
  sfxBellGain: [0, 2, 0.05], sfxBellRate: [0.3, 2.5, 0.01],
  sfxRumbleGain: [0, 2, 0.05], sfxRumbleRate: [0.5, 2.5, 0.01],
  sfxTailMix: [0, 1, 0.01],
  sfxDuck: [0, 1, 0.05],
  previewDamage: [1, 60, 1],
  previewParts: [1, 8, 1],
};

export const HERO_BULLET_RANGES: Record<HeroBulletNumKey, [number, number, number]> = {
  ...GLOBAL_RANGES,
  ...(Object.fromEntries(TIERS.flatMap((t) => BULLET_TIER_SUFFIXES.map((s) => [`t${t}${s}`, BULLET_TIER_RANGES[s]]))) as Record<TierKey, [number, number, number]>),
};

/** Hard caps whatever the tuner says. */
export const BULLET_CAPS = { darts: 64, shakePx: 40, zoom: 0.1 } as const;

const store = configStore<HeroBulletTimeConfig>({
  key: 'ascent.herobullettime.v1', defaults: HERO_BULLET_DEFAULTS, ranges: HERO_BULLET_RANGES,
  colorKeys: HERO_BULLET_COLOR_KEYS, clipKeys: HERO_BULLET_CLIP_KEYS, previewKeys: ['previewDamage', 'previewParts'],
});
export const heroBulletTimeStore = store;
export const getHeroBulletTimeConfig = store.get;
export const clampHeroBulletTimeValue = store.clamp;
export const sanitizeHeroBulletTimeConfig = store.sanitize;
export const heroBulletTimeConfigJson = store.json;
/** The preview speed hook (Recruit + the Collection read one per style). Always 1. */
export function heroBulletTimePreviewSpeed(): number { return 1; }

export function bulletTierDials(tier: TierNum, c: HeroBulletTimeConfig = store.get()): Record<BulletTierSuffix, number> {
  return Object.fromEntries(BULLET_TIER_SUFFIXES.map((s) => [s, c[`t${tier}${s}`]])) as Record<BulletTierSuffix, number>;
}

// ─── the pure plan ─────────────────────────────────────────────────────────────────────────────────────────────

export const BULLET_REF_DISTANCE = 1600;

export function bulletLegMs(distance: number, ms: number): number {
  const d = Number.isFinite(distance) && distance > 0 ? distance : BULLET_REF_DISTANCE;
  return Math.round(ms * clamp(Math.sqrt(d / BULLET_REF_DISTANCE), 0.62, 1.15));
}

/**
 * One dart: it leaves the hand (`launchAt`), arrives at its hang point and STOPS (`hangAt`), hangs while time is stopped,
 * resumes (`resumeAt`) and hits (`hitAt`).
 */
export interface BulletDart { launchAt: number; hangAt: number; resumeAt: number; hitAt: number; ring: number }

export interface BulletPlanInput extends AttackTierContext {
  /**
   * Extra rings of blades on IV's dome (default 0). The bolt-on point for the Ancient "Knockout" remix of Huge (owner
   * rule 2026-10-02; plumbing on its own branch): one more ring before the collapse.
   */
  extraRings?: number;
  leadIn?: number;
  total: number;
  distance: number;
  reduced?: boolean;
}

export type BulletKind = 'dart' | 'ring' | 'spiral' | 'dome';

export interface BulletPlan {
  reduced: boolean;
  tier: TierNum;
  kind: BulletKind;
  k: number;
  total: number;
  chargeAt: number;
  absorbEnd: number;
  fireAt: number;
  darts: BulletDart[];
  /** SLOW MOTION: from `stopAt` to `resumeAt` the shots crawl (everything keeps moving, slowed); then the snap. */
  stopAt: number;
  resumeAt: number;
  /** IV: the 3-2-1 count (each count's time). */
  counts: number[];
  /** Hits BEFORE the impact (ticks). */
  hits: number[];
  impactAt: number;
  /** The Knockout variant ("Tier V"): IV remixed (an extra ring, the prism, a bigger shake, a deeper dip). */
  ko: boolean;
  /** IV's slow-mo dip on the collapse (null below IV): the one clock eases down and back, never 0. */
  dip: KoDip | null;
  endAt: number;
  size: number;
  shakePx: number;
  zoom: number;
  push: number;
  punch: number;
  dim: number;
}

export function bulletKind(tier: TierNum): BulletKind { return tier === 1 ? 'dart' : tier === 2 ? 'ring' : tier === 3 ? 'spiral' : 'dome'; }

/** The whole Bullet Time, in base ms. Pure and deterministic. */
export function bulletPlan(input: BulletPlanInput, c: HeroBulletTimeConfig = store.get()): BulletPlan {
  const total = Math.max(0, Math.round(input.total));
  const tier = attackTier(total, input, c); // a knockout always plays the shared Tier IV
  const kind = bulletKind(tier);
  const ko = tier === 4 && isKnockoutVariant(input);
  const L = bulletTierDials(tier, c);
  const k = (tier - 1) / 3;
  const base = {
    tier, kind, k, total, ko, size: L.Size, shakePx: clamp(L.Shake * (ko ? KO_SHAKE : 1), 0, BULLET_CAPS.shakePx), zoom: clamp(L.Zoom, 0, BULLET_CAPS.zoom),
    push: L.Push, punch: L.Punch * (ko ? 1.2 : 1), dim: L.Dim,
  };
  if (input.reduced) {
    const r = reducedAttackTimeline(input.leadIn ?? 0, c.reducedFadeMs);
    const at = r.impactAt;
    return {
      ...base, reduced: true, chargeAt: at, absorbEnd: at, fireAt: at, darts: [], stopAt: at, resumeAt: at, counts: [], hits: [], impactAt: at,
      dip: null, endAt: r.endAt, size: 0, shakePx: 0, zoom: 0, push: 0, punch: 0, dim: 0,
    };
  }
  const chargeAt = Math.max(0, input.leadIn ?? 0);
  const absorbEnd = chargeAt + c.absorbMs;
  const fireAt = chargeAt + Math.max(L.ReadyMs, c.absorbMs);
  const fly = bulletLegMs(input.distance, L.FlyMs);
  const stagger = Math.max(0, L.StaggerMs);
  const resumeMs = Math.max(30, L.ResumeMs);
  const darts: BulletDart[] = [];
  let stopAt: number, resumeAt: number;
  const counts: number[] = [];
  if (kind === 'dome') {
    // The Knockout variant adds one ring (the bolt-on point `extraRings` takes more).
    const rings = Math.round(clamp(c.domeRings + Math.max(0, input.extraRings ?? 0) + (ko ? 1 : 0), 1, 6));
    const per = Math.round(clamp(c.domeBlades, 4, 20));
    const n = Math.min(BULLET_CAPS.darts, rings * per);
    // Time stops for the whole board the instant the first blade leaves; the blades keep streaming out and hang in the
    // dome (they are the only thing that moves); the 3-2-1 runs over the last of them.
    stopAt = fireAt;
    const lastHang = fireAt + (n - 1) * stagger + fly;
    const countFrom = Math.max(fireAt + fly, lastHang - c.countMs);
    for (let i = 0; i < 3; i++) counts.push(countFrom + i * c.countMs);
    resumeAt = countFrom + 3 * c.countMs;
    for (let i = 0; i < n; i++) {
      const launchAt = fireAt + i * stagger;
      darts.push({ launchAt, hangAt: launchAt + fly, resumeAt, hitAt: resumeAt + resumeMs, ring: Math.floor(i / per) });
    }
  } else if (kind === 'spiral') {
    // The volley: every dart arrives at its spiral point at the SAME instant (the volley freezes mid-flight).
    const n = Math.round(clamp(L.Darts, 1, BULLET_CAPS.darts));
    stopAt = fireAt + (n - 1) * stagger + Math.min(fly, 220);
    resumeAt = stopAt + L.HangMs;
    for (let i = 0; i < n; i++) {
      const launchAt = fireAt + i * stagger;
      const hitAt = resumeAt + resumeMs + i * c.runMs;
      darts.push({ launchAt, hangAt: stopAt, resumeAt: hitAt - resumeMs, hitAt, ring: 0 });
    }
  } else {
    const n = kind === 'dart' ? 1 : Math.round(clamp(L.Darts, 1, 12));
    for (let i = 0; i < n; i++) darts.push({ launchAt: fireAt + i * stagger, hangAt: fireAt + i * stagger + fly, resumeAt: 0, hitAt: 0, ring: 0 });
    stopAt = darts[0]!.hangAt;
    resumeAt = darts[n - 1]!.hangAt + L.HangMs;
    for (const d of darts) { d.resumeAt = resumeAt; d.hitAt = resumeAt + resumeMs; }
  }
  const hitTimes = darts.map((d) => d.hitAt);
  const impactAt = Math.max(...hitTimes);
  const hits = [...new Set(hitTimes.filter((t) => t < impactAt))].sort((a, b) => a - b);
  const endAt = impactAt + Math.max(c.zoomOutMs * 0.8, L.SettleMs);
  // IV's dip on the collapse; the Knockout's is deeper and longer.
  const dip: KoDip | null = tier === 4 && c.slowMoMs > 0
    ? { at: impactAt, lo: ko ? Math.max(0.1, c.slowMo * 0.8) : c.slowMo, ms: c.slowMoMs + (ko ? 60 : 0) }
    : null;
  return { ...base, reduced: false, chargeAt, absorbEnd, fireAt, darts, stopAt, resumeAt, counts, hits, impactAt, dip, endAt };
}

export type BulletCueKind = 'charge' | 'launch' | 'cut' | 'slow' | 'count' | 'tick' | 'snap' | 'hit' | 'impact' | 'end';
export interface BulletCue { at: number; kind: BulletCueKind; i: number }

/** The clock ticks through the slow motion, ACCELERATING toward the snap. */
export function stopTicks(p: BulletPlan): number[] {
  if (p.reduced) return [];
  const out: number[] = [];
  let at = p.stopAt + 120, gap = 220;
  while (at < p.resumeAt - 40) { out.push(at); gap = Math.max(60, gap * 0.82); at += gap; }
  return out;
}

export function bulletCues(p: BulletPlan): BulletCue[] {
  const out: BulletCue[] = [];
  if (!p.reduced) {
    out.push({ at: p.chargeAt, kind: 'charge', i: 0 });
    p.darts.forEach((d, i) => { out.push({ at: d.launchAt, kind: 'launch', i }); out.push({ at: d.hangAt, kind: 'cut', i }); });
    out.push({ at: p.stopAt, kind: 'slow', i: 0 });
    p.counts.forEach((at, i) => out.push({ at, kind: 'count', i }));
    stopTicks(p).forEach((at, i) => out.push({ at, kind: 'tick', i }));
    out.push({ at: p.resumeAt, kind: 'snap', i: 0 });
    p.hits.forEach((at, i) => out.push({ at, kind: 'hit', i }));
  }
  out.push({ at: p.impactAt, kind: 'impact', i: 0 });
  out.push({ at: p.endAt, kind: 'end', i: 0 });
  const order: Record<BulletCueKind, number> = { charge: 0, launch: 1, cut: 2, slow: 3, count: 4, tick: 5, snap: 6, hit: 7, impact: 8, end: 9 };
  return out.sort((a, b) => a.at - b.at || order[a.kind] - order[b.kind]);
}

/** Is the slow motion on at `t`? */
export function inSlowMo(p: BulletPlan, t: number): boolean { return !p.reduced && t >= p.stopAt && t < p.resumeAt; }

/**
 * IV's SLOW-MO DIP on the collapse (the Basketball / Soul Stitch technique; a freeze is banned, R-PROG-ATTACK-10): the
 * one clock drops to `slowMo` the instant the dome hits and eases back over `slowMoMs`, a smooth ramp never reaching 0.
 */
export function bulletTimeScale(p: BulletPlan, c: HeroBulletTimeConfig, t: number): number {
  void c;
  return p.reduced ? 1 : koTimeScale(p.dip, t);
}

export function bulletSlowExtraMs(p: BulletPlan, c: HeroBulletTimeConfig): number {
  void c;
  return p.reduced ? 0 : koDipExtraMs(p.dip);
}

// ─── the geometry (pure) ───────────────────────────────────────────────────────────────────────────────────────

/**
 * A dart's whole path: from the hand bowing into the point where time slows (`hang`, arriving pointed at the target),
 * crawling on to `crawl` through the slow motion, then snapping into the hit.
 */
export interface DartGeo { hand: Pt; ctrl: Pt; hang: Pt; crawl: Pt; hit: Pt; aim: number }

type Box = { x: number; y: number; w: number; h: number };

/**
 * Where each dart enters the slow motion, by tier, every shape CENTRED ON THE TARGET (owner review 2026-10-02: "looks
 * weird not being centered"): I an inch off it (on the striker's side); II three evenly round it; III a spiral round it;
 * IV a DOME of full rings round it. A target near an edge keeps its centre: the dome shrinks to fit (down to 60%), and
 * any point still off screen is clamped onto it.
 */
export function hangPoints(p: BulletPlan, a: Pt, d: Pt, radius: number, c: HeroBulletTimeConfig, bounds?: Box): Pt[] {
  const back = Math.atan2(a.y - d.y, a.x - d.x);
  const R = radius;
  const pts: Pt[] = [];
  const n = p.darts.length;
  if (p.kind === 'dart') pts.push(polar(d, back, R * (c.hangR + 0.3)));
  else if (p.kind === 'ring') {
    for (let i = 0; i < n; i++) pts.push(polar(d, back + (i * Math.PI * 2) / n, R * (c.hangR + 0.6)));
  } else if (p.kind === 'spiral') {
    for (let i = 0; i < n; i++) pts.push(polar(d, back + i * 2.39996, R * (c.hangR + 0.25 + 0.13 * i)));
  } else {
    const rings = 1 + Math.max(0, ...p.darts.map((x) => x.ring));
    const outer = R * c.domeSize * (1.6 + 0.7 * (rings - 1));
    const room = bounds ? Math.min(d.x - bounds.x, bounds.x + bounds.w - d.x, d.y - bounds.y, bounds.y + bounds.h - d.y) - R * 0.3 : outer;
    const k = clamp(room / outer, 0.6, 1);
    p.darts.forEach((dt) => {
      const inRing = p.darts.filter((x) => x.ring === dt.ring);
      const j = inRing.indexOf(dt);
      const a0 = back + ((j + (dt.ring % 2) * 0.5) / inRing.length) * Math.PI * 2;
      pts.push(polar(d, a0, R * c.domeSize * k * (1.6 + 0.7 * dt.ring)));
    });
  }
  if (!bounds) return pts;
  const m = R * 0.3;
  return pts.map((q) => ({ x: clamp(q.x, bounds.x + m, bounds.x + bounds.w - m), y: clamp(q.y, bounds.y + m, bounds.y + bounds.h - m) }));
}

/** The clock's centre: the target itself (every shape centres on it). */
export function clockCentre(p: BulletPlan, a: Pt, d: Pt): Pt { void p; void a; return { x: d.x, y: d.y }; }

function polar(o: Pt, a: number, r: number): Pt { return { x: o.x + Math.cos(a) * r, y: o.y + Math.sin(a) * r }; }

export function dartGeos(p: BulletPlan, a: Pt, d: Pt, radius: number, aRadius: number, c: HeroBulletTimeConfig, bounds?: Box): DartGeo[] {
  if (p.reduced) return [];
  const L = Math.hypot(d.x - a.x, d.y - a.y) || 1;
  const u = { x: (d.x - a.x) / L, y: (d.y - a.y) / L };
  const hand = { x: a.x + u.x * aRadius * 0.85, y: a.y + u.y * aRadius * 0.85 };
  return hangPoints(p, a, d, radius, c, bounds).map((hang) => {
    const tx = d.x - hang.x, ty = d.y - hang.y;
    const tl = Math.hypot(tx, ty) || 1;
    const D = Math.hypot(hang.x - hand.x, hang.y - hand.y) || 1;
    // The control sits back along the aim line, so the dart ARRIVES at its hang point already pointed at the target.
    const ctrl = { x: hang.x - (tx / tl) * D * 0.55, y: hang.y - (ty / tl) * D * 0.55 };
    const hit = { x: d.x - (tx / tl) * radius * 0.2, y: d.y - (ty / tl) * radius * 0.2 };
    const k = clamp(c.crawl, 0, 0.8);
    const crawl = { x: hang.x + (hit.x - hang.x) * k, y: hang.y + (hit.y - hang.y) * k };
    return { hand, ctrl, hang, crawl, hit, aim: Math.atan2(ty, tx) };
  });
}

const quad = (a: Pt, c: Pt, b: Pt, e: number): Pt => { const m = 1 - e; return { x: m * m * a.x + 2 * m * e * c.x + e * e * b.x, y: m * m * a.y + 2 * m * e * c.y + e * e * b.y }; };

/** A dart's flight ease: near-linear, so it is still FAST when time drops into slow motion (the cut reads as a brake). */
export const dartEase = (u: number): number => { const t = Math.min(1, Math.max(0, Number.isFinite(u) ? u : 0)); return 0.8 * t + 0.2 * t * t; };

/** Where dart `i` is at `t`, and in which part of its life. Pure. */
export function dartAt(dt: BulletDart, g: DartGeo, t: number): { p: Pt; angle: number; phase: 'hand' | 'fly' | 'crawl' | 'strike' | 'done' } {
  if (t < dt.launchAt) return { p: g.hand, angle: g.aim, phase: 'hand' };
  if (t < dt.hangAt) {
    const e = dartEase((t - dt.launchAt) / Math.max(1, dt.hangAt - dt.launchAt));
    const p = quad(g.hand, g.ctrl, g.hang, e);
    const q = quad(g.hand, g.ctrl, g.hang, Math.min(1, e + 0.02));
    return { p, angle: Math.atan2(q.y - p.y, q.x - p.x), phase: 'fly' };
  }
  if (t < dt.resumeAt) {
    // SLOW MOTION: it never stops, it CRAWLS on toward the target.
    const u = (t - dt.hangAt) / Math.max(1, dt.resumeAt - dt.hangAt);
    return { p: { x: g.hang.x + (g.crawl.x - g.hang.x) * u, y: g.hang.y + (g.crawl.y - g.hang.y) * u }, angle: g.aim, phase: 'crawl' };
  }
  if (t < dt.hitAt) {
    const u = (t - dt.resumeAt) / Math.max(1, dt.hitAt - dt.resumeAt);
    const e = u * u; // time snaps back to full speed: it launches off the mark
    return { p: { x: g.crawl.x + (g.hit.x - g.crawl.x) * e, y: g.crawl.y + (g.hit.y - g.crawl.y) * e }, angle: g.aim, phase: 'strike' };
  }
  return { p: g.hit, angle: g.aim, phase: 'done' };
}

// ─── the camera (pure) ─────────────────────────────────────────────────────────────────────────────────────────

const springAt = (ms: number, hz: number, tau: number): number => (ms < 0 ? 0 : Math.exp(-ms / tau) * Math.cos(2 * Math.PI * hz * (ms / 1000)));
const sine = (u: number): number => 0.5 - 0.5 * Math.cos(Math.PI * Math.min(1, Math.max(0, u)));

/**
 * The camera: a push in through the ready; through the slow motion it keeps PUSHING IN (the screen never holds still);
 * the snap back to full speed KICKS it; the impact punches and shakes (IV the hardest in the roster). Pure.
 */
export function bulletCameraAt(p: BulletPlan, c: HeroBulletTimeConfig, t: number, dir: Pt = { x: 1, y: 0 }): { zoom: number; x: number; y: number } {
  if (p.reduced) return { zoom: 1, x: 0, y: 0 };
  let z = 0;
  if (t >= p.chargeAt && t < p.impactAt) {
    z += p.zoom * sine((t - p.chargeAt) / Math.max(1, p.fireAt - p.chargeAt));
    if (t >= p.stopAt) z += p.push * Math.min(1, (t - p.stopAt) / Math.max(1, p.resumeAt - p.stopAt)) * (t < p.resumeAt ? 1 : Math.exp(-(t - p.resumeAt) / 40));
  } else if (t >= p.impactAt) {
    z += (p.zoom + p.punch) * Math.exp(-(t - p.impactAt) / Math.max(1, c.zoomOutMs / 4));
  }
  let x = 0, y = 0;
  const kick = (at: number, amp: number, tau: number, hz: number): void => { const s = springAt(t - at, hz, tau); x += dir.x * amp * s; y += dir.y * amp * s; };
  kick(p.fireAt, -p.shakePx * 0.1, 40, 14);
  kick(p.resumeAt, -p.shakePx * 0.4, 45, 16);
  for (const at of p.hits) kick(at, p.shakePx * 0.25, 40, 18);
  kick(p.impactAt, p.shakePx, Math.max(1, c.shakeMs / 4), 16);
  return { zoom: 1 + Math.max(0, z), x, y };
}

/** The anchor: the attacker through the ready, gliding to the defender with the first dart, then the defender. */
export function bulletCameraFocus(p: BulletPlan, t: number, a: Pt, d: Pt): Pt {
  const first = p.darts[0]?.hangAt ?? p.impactAt;
  if (t <= p.fireAt) return a;
  if (t < first) { const e = sine((t - p.fireAt) / Math.max(1, first - p.fireAt)); return { x: a.x + (d.x - a.x) * e, y: a.y + (d.y - a.y) * e }; }
  return d;
}
