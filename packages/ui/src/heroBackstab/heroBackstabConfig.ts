/**
 * THE BACKSTAB HERO ATTACK (a RARE): its tuned values, its pure timeline, the pure geometry (where the striker steps out
 * of the shadows) and the pure pose of the striking PORTRAIT.
 *
 * Owner 2026-09-29: "add a stealth backstab attack to the rare branch. portrait fades and attacks from behind the target
 * back towards the player portrait and settles. the larger version can do a "normal" lunge attack then vanish into
 * smoke and hit from the side, then vanish and hit from behind again".
 *
 * It is the PORTRAIT itself that moves (as Classic and Enraged do), so every exit path restores its transform, opacity
 * and z-order exactly (the runner owns that).
 *
 * TWO VISUAL TIERS (a Rare has two). The shared four map onto them here (`backstabLevel`): I-II play SMALL, III-IV play
 * BIG, so a knockout (which always forces the shared Tier IV) plays BIG.
 *  - SMALL: the striker fades into smoke where it stands, steps out BEHIND the target (the far side, beyond it along the
 *    line from the striker), draws back a hair and stabs back TOWARD home (a dagger slash; the target jolts toward the
 *    striker's side): THE impact. Then it fades, reappears in its own slot and settles.
 *  - BIG: Classic's own lunge first (a tick), then it vanishes into smoke, steps out at the target's SIDE and stabs across
 *    (a tick), vanishes again, steps out BEHIND and stabs back toward home (THE impact), then smokes home and settles.
 *
 * Positions are kept ON SCREEN: a "behind" or "side" spot that would leave the frame swings round the target until it
 * fits (the stab always drives at the target's centre, so the hit never leaves the target). No hit-stop anywhere.
 * Reduced motion: the portrait never moves; the numbers fade and the blow lands.
 */
import { configStore } from '../heroAttack/configStore';
import { clamp, clamp01, easeOutCubic, spring, type Pt } from '../heroAttack/easing';
import {
  HERO_ATTACK_TIER_THRESHOLDS, reducedAttackTimeline, attackTier, type AttackTierContext, type TierNum,
} from '../heroAttack/tiers';

export type { TierNum };

export const BACKSTAB_LEVELS = ['small', 'big'] as const;
export type BackstabLevel = (typeof BACKSTAB_LEVELS)[number];

/** The shared four tiers onto this Rare's two: I-II small, III-IV big (a knockout forces IV, so it plays big). */
export function backstabLevel(tier: TierNum): BackstabLevel { return tier >= 3 ? 'big' : 'small'; }

export const BACKSTAB_LEVEL_SUFFIXES = [
  'ReadyMs', 'VanishMs', 'GapMs', 'AppearMs', 'WindMs', 'StrikeMs', 'HoldMs', 'Smoke', 'Slash', 'Shake', 'Punch', 'SettleMs', 'Dim',
] as const;
export type BackstabLevelSuffix = (typeof BACKSTAB_LEVEL_SUFFIXES)[number];
type LevelKey = `${BackstabLevel}${BackstabLevelSuffix}`;

interface GlobalConfig {
  tier2At: number; tier3At: number; tier4At: number;
  absorbMs: number;
  lungeWindMs: number;
  lungeStrikeMs: number;
  lungeDepth: number;
  behindGap: number;
  contactStop: number;
  windPx: number;
  tilt: number;
  swell: number;
  homeSettle: number;
  knockPx: number;
  squash: number;
  shakeMs: number;
  reducedFadeMs: number;
  colorSmoke: string;
  colorShadow: string;
  colorViolet: string;
  colorTeal: string;
  colorFlash: string;
  colorPlayer: string;
  colorFoe: string;
  sfxVanishClip: string; sfxVanishGain: number; sfxVanishRate: number;
  sfxAppearClip: string; sfxAppearGain: number; sfxAppearRate: number;
  sfxSlashClip: string; sfxSlashGain: number; sfxSlashRate: number;
  sfxStabClip: string; sfxStabGain: number; sfxStabRate: number;
  sfxLungeClip: string; sfxLungeGain: number; sfxLungeRate: number;
  sfxDuck: number;
  previewDamage: number;
  previewParts: number;
}
export type HeroBackstabConfig = GlobalConfig & Record<LevelKey, number>;

export const HERO_BACKSTAB_COLOR_KEYS = ['colorSmoke', 'colorShadow', 'colorViolet', 'colorTeal', 'colorFlash', 'colorPlayer', 'colorFoe'] as const;
export const HERO_BACKSTAB_CLIP_KEYS = ['sfxVanishClip', 'sfxAppearClip', 'sfxSlashClip', 'sfxStabClip', 'sfxLungeClip'] as const;
export type HeroBackstabStrKey = (typeof HERO_BACKSTAB_COLOR_KEYS)[number] | (typeof HERO_BACKSTAB_CLIP_KEYS)[number];
export type HeroBackstabNumKey = Exclude<keyof HeroBackstabConfig, HeroBackstabStrKey>;

const LEVEL_DEFAULTS: Record<BackstabLevelSuffix, [number, number]> = {
  ReadyMs: [200, 160],
  VanishMs: [170, 140],
  GapMs: [70, 50],
  AppearMs: [130, 110],
  WindMs: [110, 90],
  StrikeMs: [110, 100],
  HoldMs: [170, 100],
  Smoke: [1, 1.15],
  Slash: [1, 1.2],
  Shake: [5, 8],
  Punch: [0.015, 0.025],
  SettleMs: [240, 260],
  Dim: [0.12, 0.2],
};

export const BACKSTAB_LEVEL_RANGES: Record<BackstabLevelSuffix, [number, number, number]> = {
  ReadyMs: [0, 1000, 10],
  VanishMs: [60, 800, 10],
  GapMs: [0, 600, 10],
  AppearMs: [40, 800, 10],
  WindMs: [0, 600, 10],
  StrikeMs: [40, 600, 10],
  HoldMs: [0, 800, 10],
  Smoke: [0, 3, 0.05],
  Slash: [0.3, 3, 0.05],
  Shake: [0, 30, 0.5],
  Punch: [0, 0.08, 0.001],
  SettleMs: [60, 1500, 10],
  Dim: [0, 0.6, 0.01],
};

const levelDefaults = Object.fromEntries(BACKSTAB_LEVELS.flatMap((l, i) => BACKSTAB_LEVEL_SUFFIXES.map((s) => [`${l}${s}`, LEVEL_DEFAULTS[s][i]]))) as Record<LevelKey, number>;

export const HERO_BACKSTAB_DEFAULTS: HeroBackstabConfig = {
  ...HERO_ATTACK_TIER_THRESHOLDS,
  absorbMs: 180,
  lungeWindMs: 200,
  lungeStrikeMs: 170,
  lungeDepth: 1,
  behindGap: 1.1,
  contactStop: 0.62,
  windPx: 16,
  tilt: 9,
  swell: 0.06,
  homeSettle: 0.08,
  knockPx: 14,
  squash: 0.07,
  shakeMs: 260,
  reducedFadeMs: 260,
  colorSmoke: '#2b2438',
  colorShadow: '#120d1c',
  colorViolet: '#9b6bff',
  colorTeal: '#3de0d0',
  colorFlash: '#f2eaff',
  colorPlayer: '#b99bff',
  colorFoe: '#ff6a7a',
  sfxVanishClip: 'fx/metal-woosh', sfxVanishGain: 0.3, sfxVanishRate: 0.8,
  sfxAppearClip: 'fx/stereogenicstudio-swish-swoosh-woosh-sfx-27-357164-3', sfxAppearGain: 0.3, sfxAppearRate: 1.5,
  sfxSlashClip: 'fx/universfield-whip-snap-242215', sfxSlashGain: 0.4, sfxSlashRate: 1.35,
  sfxStabClip: 'flurryhit', sfxStabGain: 0.5, sfxStabRate: 1.1,
  sfxLungeClip: 'windup', sfxLungeGain: 0.4, sfxLungeRate: 1.1,
  sfxDuck: 0.6,
  previewDamage: 12,
  previewParts: 4,
  ...levelDefaults,
};

const GLOBAL_RANGES: Record<Exclude<keyof GlobalConfig, HeroBackstabStrKey>, [number, number, number]> = {
  tier2At: [2, 40, 1], tier3At: [2, 60, 1], tier4At: [2, 80, 1],
  absorbMs: [60, 600, 10],
  lungeWindMs: [60, 800, 10],
  lungeStrikeMs: [60, 800, 10],
  lungeDepth: [0, 2, 0.05],
  behindGap: [0.5, 2.5, 0.05],
  contactStop: [0.2, 1.2, 0.01],
  windPx: [0, 60, 1],
  tilt: [0, 30, 0.5],
  swell: [0, 0.3, 0.005],
  homeSettle: [0, 0.3, 0.005],
  knockPx: [0, 60, 1],
  squash: [0, 0.3, 0.01],
  shakeMs: [0, 1200, 10],
  reducedFadeMs: [60, 1000, 10],
  sfxVanishGain: [0, 2, 0.05], sfxVanishRate: [0.5, 2.5, 0.01],
  sfxAppearGain: [0, 2, 0.05], sfxAppearRate: [0.5, 2.5, 0.01],
  sfxSlashGain: [0, 2, 0.05], sfxSlashRate: [0.5, 2.5, 0.01],
  sfxStabGain: [0, 2, 0.05], sfxStabRate: [0.5, 2.5, 0.01],
  sfxLungeGain: [0, 2, 0.05], sfxLungeRate: [0.5, 2.5, 0.01],
  sfxDuck: [0, 1, 0.05],
  previewDamage: [1, 60, 1],
  previewParts: [1, 8, 1],
};

export const HERO_BACKSTAB_RANGES: Record<HeroBackstabNumKey, [number, number, number]> = {
  ...GLOBAL_RANGES,
  ...(Object.fromEntries(BACKSTAB_LEVELS.flatMap((l) => BACKSTAB_LEVEL_SUFFIXES.map((s) => [`${l}${s}`, BACKSTAB_LEVEL_RANGES[s]]))) as Record<LevelKey, [number, number, number]>),
};

export const BACKSTAB_CAPS = { shakePx: 30 } as const;

const store = configStore<HeroBackstabConfig>({
  key: 'ascent.herobackstab.v1', defaults: HERO_BACKSTAB_DEFAULTS, ranges: HERO_BACKSTAB_RANGES,
  colorKeys: HERO_BACKSTAB_COLOR_KEYS, clipKeys: HERO_BACKSTAB_CLIP_KEYS, previewKeys: ['previewDamage', 'previewParts'],
});
export const heroBackstabStore = store;
export const getHeroBackstabConfig = store.get;
export const clampHeroBackstabValue = store.clamp;
export const sanitizeHeroBackstabConfig = store.sanitize;
export const heroBackstabConfigJson = store.json;
/** The preview speed hook (Recruit + the Collection read one per style). Always 1: the Rare tuners have none. */
export function heroBackstabPreviewSpeed(): number { return 1; }

export function backstabLevelDials(level: BackstabLevel, c: HeroBackstabConfig = store.get()): Record<BackstabLevelSuffix, number> {
  return Object.fromEntries(BACKSTAB_LEVEL_SUFFIXES.map((s) => [s, c[`${level}${s}`]])) as Record<BackstabLevelSuffix, number>;
}

// ─── the pure plan ─────────────────────────────────────────────────────────────────────────────────────────────

/** One step out of the shadows: appear at a spot, draw back, stab, hold, vanish. */
export interface BlinkTimes {
  /** Which spot (the geometry's). */
  spot: 'side' | 'behind';
  appearAt: number;
  windAt: number;
  strikeAt: number;
  hitAt: number;
  vanishAt: number;
  vanishEnd: number;
}

export interface LungeTimes { windAt: number; strikeAt: number; hitAt: number; vanishAt: number; vanishEnd: number }

export interface BackstabPlanInput extends AttackTierContext {
  leadIn?: number;
  total: number;
  reduced?: boolean;
}

export interface BackstabPlan {
  reduced: boolean;
  tier: TierNum;
  level: BackstabLevel;
  k: number;
  total: number;
  chargeAt: number;
  absorbEnd: number;
  /** Small: the striker fades out of its slot here (big: the lunge opens instead). */
  fadeOutAt: number;
  fadeOutEnd: number;
  /** Big: Classic's lunge (its hit is a tick). */
  lunge: LungeTimes | null;
  blinks: BlinkTimes[];
  /** Every hit before the last (ticks). */
  hits: number[];
  impactAt: number;
  /** It reappears in its own slot, then settles. */
  homeAt: number;
  settleEnd: number;
  endAt: number;
  appearMs: number;
  smoke: number;
  slash: number;
  shakePx: number;
  punch: number;
  dim: number;
}

/** The whole Backstab, in base ms. Pure and deterministic. */
export function backstabPlan(input: BackstabPlanInput, c: HeroBackstabConfig = store.get()): BackstabPlan {
  const total = Math.max(0, Math.round(input.total));
  const tier = attackTier(total, input, c); // a knockout always plays the shared Tier IV
  const level = backstabLevel(tier);
  const L = backstabLevelDials(level, c);
  const k = (tier - 1) / 3;
  const looks = { tier, level, k, total, appearMs: L.AppearMs, smoke: L.Smoke, slash: L.Slash, shakePx: clamp(L.Shake, 0, BACKSTAB_CAPS.shakePx), punch: L.Punch, dim: L.Dim };
  if (input.reduced) {
    const r = reducedAttackTimeline(input.leadIn ?? 0, c.reducedFadeMs);
    const at = r.impactAt;
    return {
      ...looks, reduced: true, chargeAt: at, absorbEnd: at, fadeOutAt: at, fadeOutEnd: at, lunge: null, blinks: [], hits: [], impactAt: at,
      homeAt: at, settleEnd: at, endAt: r.endAt, smoke: 0, slash: 0, shakePx: 0, punch: 0, dim: 0,
    };
  }
  const chargeAt = Math.max(0, input.leadIn ?? 0);
  const absorbEnd = chargeAt + c.absorbMs;
  let t = chargeAt + Math.max(L.ReadyMs, c.absorbMs * 0.6);
  let lunge: LungeTimes | null = null;
  let fadeOutAt = t, fadeOutEnd = t;
  if (level === 'big') {
    // Classic's lunge: the coil, the drive, contact (a tick); a beat on the face, then it goes up in smoke THERE.
    const windAt = t, strikeAt = windAt + c.lungeWindMs, hitAt = strikeAt + c.lungeStrikeMs;
    const vanishAt = hitAt + L.HoldMs * 0.8;
    lunge = { windAt, strikeAt, hitAt, vanishAt, vanishEnd: vanishAt + L.VanishMs };
    fadeOutAt = vanishAt; fadeOutEnd = lunge.vanishEnd;
  } else {
    fadeOutAt = t; fadeOutEnd = t + L.VanishMs;
  }
  t = fadeOutEnd + L.GapMs;
  const spots: ('side' | 'behind')[] = level === 'big' ? ['side', 'behind'] : ['behind'];
  const blinks: BlinkTimes[] = spots.map((spot, i) => {
    const appearAt = t;
    const windAt = appearAt + L.AppearMs * 0.6;
    const strikeAt = windAt + L.WindMs;
    const hitAt = strikeAt + L.StrikeMs;
    const last = i === spots.length - 1;
    const vanishAt = hitAt + (last ? L.HoldMs : L.HoldMs * 0.6);
    const vanishEnd = vanishAt + L.VanishMs;
    t = vanishEnd + L.GapMs;
    return { spot, appearAt, windAt, strikeAt, hitAt, vanishAt, vanishEnd };
  });
  const impactAt = blinks[blinks.length - 1]!.hitAt;
  const hits = [...(lunge ? [lunge.hitAt] : []), ...blinks.slice(0, -1).map((b) => b.hitAt)];
  const homeAt = t;
  const settleEnd = homeAt + L.AppearMs + L.SettleMs;
  return {
    ...looks, reduced: false, chargeAt, absorbEnd, fadeOutAt, fadeOutEnd, lunge, blinks, hits, impactAt, homeAt, settleEnd, endAt: settleEnd,
  };
}

export type BackstabCueKind = 'charge' | 'lunge' | 'vanish' | 'appear' | 'strike' | 'hit' | 'impact' | 'home' | 'end';
export interface BackstabCue { at: number; kind: BackstabCueKind; i: number }

/**
 * Every beat the runner fires, in time order. `vanish` i: 0 = the first fade (small: out of the slot; big: off the
 * lunge), then one per blink (i = blink + 1). `hit` i: the tick's index in `hits`.
 */
export function backstabCues(p: BackstabPlan): BackstabCue[] {
  const out: BackstabCue[] = [];
  if (!p.reduced) {
    out.push({ at: p.chargeAt, kind: 'charge', i: 0 });
    if (p.lunge) out.push({ at: p.lunge.windAt, kind: 'lunge', i: 0 });
    out.push({ at: p.fadeOutAt, kind: 'vanish', i: 0 });
    p.blinks.forEach((b, i) => {
      out.push({ at: b.appearAt, kind: 'appear', i });
      out.push({ at: b.strikeAt, kind: 'strike', i });
      out.push({ at: b.vanishAt, kind: 'vanish', i: i + 1 });
    });
    p.hits.forEach((at, i) => out.push({ at, kind: 'hit', i }));
    out.push({ at: p.homeAt, kind: 'home', i: 0 });
  }
  out.push({ at: p.impactAt, kind: 'impact', i: p.blinks.length - 1 });
  out.push({ at: p.endAt, kind: 'end', i: 0 });
  const order: Record<BackstabCueKind, number> = { charge: 0, lunge: 1, hit: 2, impact: 3, vanish: 4, appear: 5, strike: 6, home: 7, end: 8 };
  return out.sort((a, b) => a.at - b.at || order[a.kind] - order[b.kind]);
}

// ─── the geometry (pure) ───────────────────────────────────────────────────────────────────────────────────────

export interface Frame { x0: number; y0: number; x1: number; y1: number }

/** A spot the striker steps out at (screen px), where it draws back to, where it stops on contact, and its stab's heading. */
export interface Spot { at: Pt; wind: Pt; contact: Pt; dir: Pt }

export interface LungeGeo {
  /** The coil and the contact, as screen-px offsets from home (Classic's swing, measured once). */
  back: Pt; strike: Pt;
  tilt: number;
  swell: number;
  ease: (u: number) => number;
}

export interface BackstabGeo {
  /** Unit, striker -> target. */
  u: Pt;
  side: Spot;
  behind: Spot;
  lunge: LungeGeo;
  /** The lunge's contact point (screen px), where it goes up in smoke. */
  lungeAt: Pt;
}

const inFrame = (p: Pt, f: Frame | null, m: number): boolean => !f || (p.x >= f.x0 + m && p.x <= f.x1 - m && p.y >= f.y0 + m && p.y <= f.y1 - m);

/**
 * A spot `dist` px from the target along `dir0` (unit) that fits inside the frame with `margin` px to spare: first a
 * little closer in (and allowed to hang a little off the edge), then swung round the target a little further each
 * try (toward the middle of the frame first); toward the middle of the frame as a last resort. The stab from it always drives at the target's centre, so the hit never leaves the target.
 * Pure.
 */
export function fitSpot(d: Pt, dir0: Pt, dist: number, frame: Frame | null, margin: number): Pt {
  const a0 = Math.atan2(dir0.y, dir0.x);
  // Which way round is toward the middle of the frame (so a swing gains room, not loses it).
  const mid = frame ? { x: (frame.x0 + frame.x1) / 2 - d.x, y: (frame.y0 + frame.y1) / 2 - d.y } : { x: 0, y: 0 };
  const turn = dir0.x * mid.y - dir0.y * mid.x >= 0 ? 1 : -1;
  // Whole on screen first; then allowed to hang half a radius off the edge (a hero tucked in a corner).
  // The heading matters most (behind should READ as behind): each swing tries closer in, then hanging a little off
  // the edge, before swinging further round.
  for (const off of [0, 0.3, 0.6, 0.9, 1.2, 1.5, 1.8, 2.1]) {
    for (const sgn of off === 0 ? [1] : [turn, -turn]) {
      for (const m of [margin, margin * 0.45]) {
        for (const k of [1, 0.85, 0.7, 0.6]) {
          const a = a0 + sgn * off;
          const p = { x: d.x + Math.cos(a) * dist * k, y: d.y + Math.sin(a) * dist * k };
          if (inFrame(p, frame, m)) return p;
        }
      }
    }
  }
  // Last resort (a tiny frame): toward the middle of the frame, far enough out that the stab still travels.
  const ml = Math.hypot(mid.x, mid.y);
  const u = ml > 1 ? { x: mid.x / ml, y: mid.y / ml } : dir0;
  return { x: d.x + u.x * dist, y: d.y + u.y * dist };
}

function spotFrom(p: Pt, d: Pt, dR: number, aR: number, c: HeroBackstabConfig): Spot {
  const dx = d.x - p.x, dy = d.y - p.y;
  const L = Math.hypot(dx, dy) || 1;
  const dir = { x: dx / L, y: dy / L };
  // It always travels: a spot pulled in close to the target still stabs through at least 40% of the way.
  const stop = Math.min(L * 0.6, (dR + aR) * c.contactStop);
  return {
    at: p,
    wind: { x: p.x - dir.x * c.windPx, y: p.y - dir.y * c.windPx },
    contact: { x: d.x - dir.x * stop, y: d.y - dir.y * stop },
    dir,
  };
}

/**
 * Where the striker steps out, from the two heroes and the frame (screen px): BEHIND = past the target along the line
 * from the striker; SIDE = off the target's flank (the flank nearer the middle of the frame). Both kept whole inside the
 * frame. `lunge` is Classic's swing (its coil and contact offsets in screen px). Pure.
 */
export function backstabGeo(a: Pt, d: Pt, aR: number, dR: number, frame: Frame | null, lunge: LungeGeo, c: HeroBackstabConfig = store.get()): BackstabGeo {
  const dx = d.x - a.x, dy = d.y - a.y;
  const L = Math.hypot(dx, dy) || 1;
  const u = { x: dx / L, y: dy / L };
  const gap = dR + aR * c.behindGap;
  const margin = aR * 0.9;
  const behindP = fitSpot(d, u, gap, frame, margin);
  // The flank nearer the middle of the frame (so it has room), perpendicular to the line.
  const n = { x: -u.y, y: u.x };
  // The flank: opposite to wherever "behind" had to swing round to (so the two stabs come from clearly different
  // sides); with no swing, the flank nearer the middle of the frame (so it has room).
  const bx = behindP.x - d.x, by = behindP.y - d.y;
  const swung = (bx * n.x + by * n.y) / (Math.hypot(bx, by) || 1);
  const mid = frame ? { x: (frame.x0 + frame.x1) / 2, y: (frame.y0 + frame.y1) / 2 } : a;
  const sgn = Math.abs(swung) > 0.25 ? -Math.sign(swung) : ((mid.x - d.x) * n.x + (mid.y - d.y) * n.y >= 0 ? 1 : -1);
  const sideP = fitSpot(d, { x: n.x * sgn, y: n.y * sgn }, gap, frame, margin);
  return {
    u,
    side: spotFrom(sideP, d, dR, aR, c),
    behind: spotFrom(behindP, d, dR, aR, c),
    lunge,
    lungeAt: { x: a.x + lunge.strike.x, y: a.y + lunge.strike.y },
  };
}

// ─── the pose (pure) ───────────────────────────────────────────────────────────────────────────────────────────

/** The striking portrait at a moment: an offset from its slot (screen px), a tilt (degrees), a scale and an opacity. */
export interface BackstabPose { x: number; y: number; rot: number; scale: number; alpha: number; squash: number }

const REST: BackstabPose = { x: 0, y: 0, rot: 0, scale: 1, alpha: 1, squash: 0 };
const powerOut = (u: number): number => 1 - (1 - clamp01(u)) * (1 - clamp01(u));
const stabIn = (u: number): number => { const x = clamp01(u); return x * x * (0.4 + 0.6 * x); };
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/**
 * Where the striking portrait is at sequence time `t`. Its slot is (0, 0). While it is "in the shadows" it is fully
 * transparent (the smoke covers the swap). Pure and deterministic.
 */
export function backstabPose(p: BackstabPlan, g: BackstabGeo, c: HeroBackstabConfig, a: Pt, t: number): BackstabPose {
  if (p.reduced || t < p.chargeAt || t >= p.settleEnd) return { ...REST };
  const rel = (q: Pt): Pt => ({ x: q.x - a.x, y: q.y - a.y });
  const tiltOf = (dir: Pt): number => c.tilt * (dir.x >= 0 ? 1 : -1);
  // The home return: it fades in in its slot a touch big and settles.
  if (t >= p.homeAt) {
    const u = clamp01((t - p.homeAt) / Math.max(1, p.appearMs));
    const sc = 1 + c.homeSettle * spring(t - p.homeAt, 3.5, 90);
    return { x: 0, y: 0, rot: 0, scale: sc, alpha: easeOutCubic(u), squash: 0 };
  }
  // The blinks (latest first: the one that is on).
  for (let i = p.blinks.length - 1; i >= 0; i--) {
    const b = p.blinks[i]!;
    if (t < b.appearAt) continue;
    if (t >= b.vanishEnd) return { ...REST, alpha: 0 };
    const s = b.spot === 'side' ? g.side : g.behind;
    const tilt = tiltOf(s.dir);
    const at = rel(s.at), wind = rel(s.wind), hit = rel(s.contact);
    let x = at.x, y = at.y, rot = 0, scale = 1, alpha = 1, squash = 0;
    if (t < b.windAt) {
      const u = clamp01((t - b.appearAt) / Math.max(1, b.windAt - b.appearAt));
      alpha = easeOutCubic(u / 0.6 > 1 ? 1 : u / 0.6);
      scale = lerp(0.86, 1, easeOutCubic(u));
    } else if (t < b.strikeAt) {
      const u = powerOut((t - b.windAt) / Math.max(1, b.strikeAt - b.windAt));
      x = lerp(at.x, wind.x, u); y = lerp(at.y, wind.y, u);
      rot = -tilt * 0.5 * u; scale = 1 + c.swell * u;
    } else if (t < b.hitAt) {
      const u = stabIn((t - b.strikeAt) / Math.max(1, b.hitAt - b.strikeAt));
      x = lerp(wind.x, hit.x, u); y = lerp(wind.y, hit.y, u);
      rot = lerp(-tilt * 0.5, tilt, u); scale = lerp(1 + c.swell, 1, u);
    } else {
      // On the face: a small rebound back along the stab, the squash of contact springing out, then it goes up in smoke.
      const r = powerOut((t - b.hitAt) / 110);
      x = lerp(hit.x, wind.x, 0.22 * r); y = lerp(hit.y, wind.y, 0.22 * r);
      rot = tilt * (1 - 0.5 * r);
      squash = c.squash * Math.max(0, spring(t - b.hitAt, 4, 70));
      if (t >= b.vanishAt) {
        const v = clamp01((t - b.vanishAt) / Math.max(1, b.vanishEnd - b.vanishAt));
        alpha = 1 - easeOutCubic(v);
        scale = 1 - 0.12 * v;
        y -= 6 * v;
      }
    }
    return { x, y, rot, scale, alpha, squash };
  }
  // Between the first fade and the first blink: in the shadows.
  if (t >= p.fadeOutEnd) return { ...REST, alpha: 0 };
  // Big: Classic's lunge, then up in smoke on the face.
  const ln = p.lunge;
  if (ln) {
    const G = g.lunge;
    if (t < ln.windAt) return { ...REST };
    if (t < ln.strikeAt) {
      const e = powerOut((t - ln.windAt) / Math.max(1, ln.strikeAt - ln.windAt));
      return { x: G.back.x * e * c.lungeDepth, y: G.back.y * e * c.lungeDepth, rot: G.tilt * e, scale: 1 + (G.swell - 1) * e, alpha: 1, squash: 0 };
    }
    if (t < ln.hitAt) {
      const e = G.ease(clamp01((t - ln.strikeAt) / Math.max(1, ln.hitAt - ln.strikeAt)));
      const bx = G.back.x * c.lungeDepth, by = G.back.y * c.lungeDepth;
      return { x: lerp(bx, G.strike.x, e), y: lerp(by, G.strike.y, e), rot: G.tilt, scale: lerp(G.swell, 1, e), alpha: 1, squash: 0 };
    }
    const r = powerOut((t - ln.hitAt) / 90);
    const pose: BackstabPose = {
      x: G.strike.x * (1 - 0.08 * r), y: G.strike.y * (1 - 0.08 * r), rot: G.tilt * (1 - 0.6 * r), scale: 1, alpha: 1,
      squash: c.squash * Math.max(0, spring(t - ln.hitAt, 4, 70)),
    };
    if (t >= ln.vanishAt) {
      const v = clamp01((t - ln.vanishAt) / Math.max(1, ln.vanishEnd - ln.vanishAt));
      pose.alpha = 1 - easeOutCubic(v); pose.scale = 1 - 0.12 * v; pose.y -= 6 * v;
    }
    return pose;
  }
  // Small: a beat of readiness (a small crouch), then it fades out of its slot in smoke.
  if (t < p.fadeOutAt) {
    const u = clamp01((t - p.chargeAt) / Math.max(1, p.fadeOutAt - p.chargeAt));
    return { ...REST, scale: 1 - 0.04 * easeOutCubic(u), x: -g.u.x * 5 * u, y: -g.u.y * 5 * u };
  }
  const v = clamp01((t - p.fadeOutAt) / Math.max(1, p.fadeOutEnd - p.fadeOutAt));
  return { x: -g.u.x * 5, y: -g.u.y * 5 - 6 * v, rot: 0, scale: 0.96 - 0.1 * v, alpha: 1 - easeOutCubic(v), squash: 0 };
}

/** The heading of each hit, in order (the lunge's, then each blink's): the target jolts along it. */
export function hitDirs(p: BackstabPlan, g: BackstabGeo): Pt[] {
  const out: Pt[] = [];
  if (p.lunge) out.push(g.u);
  for (const b of p.blinks) out.push((b.spot === 'side' ? g.side : g.behind).dir);
  return out;
}

// ─── the camera (pure) ─────────────────────────────────────────────────────────────────────────────────────────

const springAt = (ms: number, hz: number, tau: number): number => (ms < 0 ? 0 : Math.exp(-ms / tau) * Math.cos(2 * Math.PI * hz * (ms / 1000)));

/** The camera: still until the first hit; a small punch and a shake along each stab; the last one hardest. Pure. */
export function backstabCameraAt(p: BackstabPlan, c: HeroBackstabConfig, t: number, dirs: readonly Pt[]): { zoom: number; x: number; y: number } {
  if (p.reduced) return { zoom: 1, x: 0, y: 0 };
  let z = 0, x = 0, y = 0;
  const n = p.hits.length + 1;
  const tau = Math.max(1, c.shakeMs / 4);
  for (let i = 0; i < n; i++) {
    const at = i < p.hits.length ? p.hits[i]! : p.impactAt;
    const age = t - at;
    if (age < 0) continue;
    const w = i === n - 1 ? 1 : 0.45;
    z += p.punch * (i === n - 1 ? 1 : 0.5) * Math.exp(-age / tau);
    const d = dirs[i] ?? { x: 1, y: 0 };
    const s = springAt(age, 16, tau) * p.shakePx * w;
    x += d.x * s; y += d.y * s;
  }
  return { zoom: 1 + z, x, y };
}
