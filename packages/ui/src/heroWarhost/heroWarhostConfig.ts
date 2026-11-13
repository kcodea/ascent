/**
 * THE WARHOST HERO ATTACK ("Warhost", the Ancient of War; ANCIENT rarity): its tuned values, its pure timeline, the
 * pure staging (every soldier, every spear and arrow, every banner), and the pure camera.
 *
 * THE SIGNATURE: AN ARMY OF TINY SOLDIERS. The blow is delivered by a host of small painted soldier figures in the
 * Ancient of War's colours (red and brass), pooled sprites with a two-frame run cycle and a little bob. No other attack
 * has crowds of little people. Nothing here is a beam, a bolt or a glow: it is men, horses, spears, arrows, banners
 * and dust.
 *
 * FOUR LOOKS on the shared thresholds (`attackTier`: a knockout always plays IV):
 *  - I, THE SPEARMAN: one little spearman patters out from the striking hero (a dust puff per step), plants his feet
 *    and THROWS his spear; it arcs and sticks in the struck portrait with a twang (the blow). He gives a tiny cheer hop
 *    and runs home.
 *  - II, THE ARCHERS: a rank of archers jogs out and forms a line, draws together (a held beat) and looses: an ARROW
 *    RAIN arcs high and comes down on the struck portrait in a patter, each arrow sticking at its own angle (every
 *    arrow before the last is a tick; the last is the blow). They jog home.
 *  - III, THE CAVALRY: a war horn. A wedge of tiny cavalry (lances, pennants, a gallop bob) charges across the board
 *    from the striker's side kicking up a rolling dust line and rides THROUGH the struck portrait (the blow lands as
 *    the point rider hits; every row after it buffets the portrait), then wheels off screen.
 *  - IV, THE HOST: three war drums, a long horn, banners rise behind the striking hero, then the FULL HOST floods across
 *    the screen: rank after rank of infantry, cavalry on the flanks, arrow volleys overhead, all funnelling onto the
 *    struck portrait and trampling over it (the blow lands as the front rank hits; every rank after it buffets it and
 *    buries it in dust). The host passes, the dust thins, and one soldier stays to PLANT A BANNER (red with a gold
 *    emblem) on the struck portrait; it snaps in the wind for a beat, then everything clears.
 *  - KNOCKOUT ("Tier V", an Ancient knockout): IV remixed: three more soldiers stay to cheer round the banner, a
 *    prismatic shock on the front rank's hit, a 1.3x shake, a short slow-mo dip and the KO sting.
 *
 * THE HOST ALWAYS COMES FROM THE STRIKER'S SIDE: every path is built from the two portrait points, so it plays the same
 * in both directions. Formation jitter (each soldier's place in the rank, size and stride) is rolled from the seed.
 *
 * NEVER A FROZEN FRAME (R-PROG-ATTACK-10): the one clock never stops. Only the Knockout variant dips it (a smooth ramp
 * that never reaches 0).
 *
 * THE CONTRACT: the consequence lands exactly ONCE, on the impact beat. Everything before it is a tick (FX and sound
 * only); everything after it (the ranks passing, the banner) is FX only. Reduced motion: fades only.
 */
import { configStore } from '../heroAttack/configStore';
import { clamp, clamp01, seededRng, type Pt } from '../heroAttack/easing';
import {
  HERO_ATTACK_TIER_THRESHOLDS, TIERS, reducedAttackTimeline, attackTier, isKnockoutVariant, type AttackTierContext, type TierNum,
} from '../heroAttack/tiers';
import { KO_DIP, KO_SHAKE, koDipExtraMs, koTimeScale, type KoDip } from '../heroAttack/knockout';

export type { TierNum };

export const WARHOST_LEVELS = ['t1', 't2', 't3', 't4'] as const;
export type WarhostLevel = (typeof WARHOST_LEVELS)[number];

export const WARHOST_TIER_SUFFIXES = ['ReadyMs', 'MarchMs', 'HoldMs', 'FlightMs', 'Troops', 'Shake', 'Zoom', 'Punch', 'SettleMs', 'Dim'] as const;
export type WarhostTierSuffix = (typeof WARHOST_TIER_SUFFIXES)[number];
type TierKey = `${WarhostLevel}${WarhostTierSuffix}`;

interface GlobalConfig {
  tier2At: number; tier3At: number; tier4At: number;
  absorbMs: number;
  /** A foot soldier's height and a rider's height (horse and all), px at stage scale 1. */
  soldierPx: number;
  cavalryPx: number;
  /** I, II: how far out from the striking portrait's edge the spearman plants / the archers form their line (px). */
  standPx: number;
  /** II: the gap between archers in the line (px), arrows loosed per archer, and the gap between arrows landing (ms). */
  lineGapPx: number;
  arrowsPer: number;
  patterMs: number;
  /** I: the cheer after the spear sticks (ms) before he runs home. */
  cheerMs: number;
  /** III: the gap between each row of the wedge reaching the target (ms). */
  rowMs: number;
  /** IV: the gap between the three drums (ms). */
  drumMs: number;
  /** IV: the gap between ranks reaching the target (ms), soldiers per rank, the host's width (px), riders per flank. */
  rankMs: number;
  hostFiles: number;
  hostWidthPx: number;
  hostCavalry: number;
  /** IV: arrows per volley (two volleys fly over the host). */
  hostArrows: number;
  /** IV: how tight the host funnels as it crosses the target (1 = no funnel). */
  funnel: number;
  /** IV: after the last rank passes, the dust thins for this long before the banner goes in; then it flies this long. */
  dustMs: number;
  bannerMs: number;
  /** How much dust (a multiplier on every puff and cloud). */
  dust: number;
  impactSize: number;
  heroWindPx: number;
  heroThrowPx: number;
  knockPx: number;
  squash: number;
  shakeMs: number;
  zoomOutMs: number;
  reducedFadeMs: number;
  colorRed: string;
  colorBrass: string;
  colorDust: string;
  colorPlayer: string;
  colorFoe: string;
  sfxHornClip: string; sfxHornGain: number; sfxHornRate: number;
  sfxDrumClip: string; sfxDrumGain: number; sfxDrumRate: number;
  sfxChargeClip: string; sfxChargeGain: number; sfxChargeRate: number;
  sfxGallopClip: string; sfxGallopGain: number; sfxGallopRate: number;
  sfxLooseClip: string; sfxLooseGain: number; sfxLooseRate: number;
  sfxThunkClip: string; sfxThunkGain: number; sfxThunkRate: number;
  sfxWhooshClip: string; sfxWhooshGain: number; sfxWhooshRate: number;
  sfxThudClip: string; sfxThudGain: number; sfxThudRate: number;
  sfxBoomClip: string; sfxBoomGain: number; sfxBoomRate: number;
  sfxCheerClip: string; sfxCheerGain: number; sfxCheerRate: number;
  sfxTailMix: number;
  sfxDuck: number;
  previewDamage: number;
  previewParts: number;
}
export type HeroWarhostConfig = GlobalConfig & Record<TierKey, number>;

export const HERO_WARHOST_COLOR_KEYS = ['colorRed', 'colorBrass', 'colorDust', 'colorPlayer', 'colorFoe'] as const;
export const HERO_WARHOST_CLIP_KEYS = [
  'sfxHornClip', 'sfxDrumClip', 'sfxChargeClip', 'sfxGallopClip', 'sfxLooseClip', 'sfxThunkClip', 'sfxWhooshClip', 'sfxThudClip',
  'sfxBoomClip', 'sfxCheerClip',
] as const;
export type HeroWarhostStrKey = (typeof HERO_WARHOST_COLOR_KEYS)[number] | (typeof HERO_WARHOST_CLIP_KEYS)[number];
export type HeroWarhostNumKey = Exclude<keyof HeroWarhostConfig, HeroWarhostStrKey>;

/**
 * Per tier, I / II / III / IV.
 *  - Ready: the hero's send-off (III: the horn sounds over it; IV: the drums and the horn).
 *  - March: I the run out; II the jog out; III and IV the charge from the striker to the target (at 1600 px).
 *  - Hold: I the plant and the wind-up; II the draw (the held beat).
 *  - Flight: I the spear's flight; II the arrows' flight (at 1600 px).
 *  - Troops: II archers; III riders; IV ranks of infantry (I is always one spearman).
 *  - Settle: after the blow (I, II: the cheer and the run home; III: the wedge wheeling off; IV: the clear after the banner).
 */
const TIER_DEFAULTS: Record<WarhostTierSuffix, [number, number, number, number]> = {
  ReadyMs: [120, 140, 400, 760],
  MarchMs: [280, 320, 600, 820],
  HoldMs: [190, 280, 0, 0],
  FlightMs: [290, 420, 0, 0],
  Troops: [1, 7, 10, 16],
  Shake: [6, 9, 16, 24],
  Zoom: [0.02, 0.025, 0.035, 0.045],
  Punch: [0.03, 0.04, 0.06, 0.08],
  SettleMs: [700, 520, 760, 280],
  Dim: [0.08, 0.12, 0.2, 0.3],
};

export const WARHOST_TIER_RANGES: Record<WarhostTierSuffix, [number, number, number]> = {
  ReadyMs: [60, 2000, 10],
  MarchMs: [120, 2000, 10],
  HoldMs: [0, 1200, 10],
  FlightMs: [0, 1200, 10],
  Troops: [1, 22, 1],
  Shake: [0, 40, 0.5],
  Zoom: [0, 0.1, 0.002],
  Punch: [0, 0.15, 0.001],
  SettleMs: [100, 2000, 10],
  Dim: [0, 0.6, 0.01],
};

const tierDefaults = Object.fromEntries(TIERS.flatMap((t) => WARHOST_TIER_SUFFIXES.map((s) => [`t${t}${s}`, TIER_DEFAULTS[s][t - 1]]))) as Record<TierKey, number>;

export const HERO_WARHOST_DEFAULTS: HeroWarhostConfig = {
  ...HERO_ATTACK_TIER_THRESHOLDS,
  absorbMs: 160,
  soldierPx: 46,
  cavalryPx: 70,
  standPx: 190,
  lineGapPx: 62,
  arrowsPer: 2,
  patterMs: 20,
  cheerMs: 360,
  rowMs: 70,
  drumMs: 290,
  rankMs: 40,
  hostFiles: 11,
  hostWidthPx: 600,
  hostCavalry: 6,
  hostArrows: 14,
  funnel: 0.5,
  dustMs: 240,
  bannerMs: 780,
  dust: 1,
  impactSize: 1,
  heroWindPx: 9,
  heroThrowPx: 12,
  knockPx: 20,
  squash: 0.09,
  shakeMs: 380,
  zoomOutMs: 420,
  reducedFadeMs: 260,
  colorRed: '#ff5a4f',
  colorBrass: '#e2b34a',
  colorDust: '#b9966a',
  colorPlayer: '#ffe9b0',
  colorFoe: '#ff7a5c',
  sfxHornClip: 'fx/warhost-horn', sfxHornGain: 0.55, sfxHornRate: 1,
  sfxDrumClip: 'fx/warhost-drum', sfxDrumGain: 0.6, sfxDrumRate: 1,
  sfxChargeClip: 'fx/warhost-charge', sfxChargeGain: 0.5, sfxChargeRate: 1,
  sfxGallopClip: 'fx/warhost-gallop', sfxGallopGain: 0.55, sfxGallopRate: 1,
  sfxLooseClip: 'fx/warhost-loose', sfxLooseGain: 0.4, sfxLooseRate: 1,
  sfxThunkClip: 'fx/warhost-thunk', sfxThunkGain: 0.55, sfxThunkRate: 1,
  sfxWhooshClip: 'fx/stereogenicstudio-swish-swoosh-woosh-sfx-27-357164-3', sfxWhooshGain: 0.3, sfxWhooshRate: 1.3,
  sfxThudClip: 'fx/universfield-ground-impact-352053', sfxThudGain: 0.45, sfxThudRate: 1,
  sfxBoomClip: 'fx/universfield-cinematic-swoosh-impact-454392', sfxBoomGain: 0.45, sfxBoomRate: 0.9,
  sfxCheerClip: 'fx/cheering', sfxCheerGain: 0.16, sfxCheerRate: 1.5,
  sfxTailMix: 0.15,
  sfxDuck: 0.6,
  previewDamage: 12,
  previewParts: 4,
  ...tierDefaults,
};

const GLOBAL_RANGES: Record<Exclude<keyof GlobalConfig, HeroWarhostStrKey>, [number, number, number]> = {
  tier2At: [2, 40, 1], tier3At: [2, 60, 1], tier4At: [2, 80, 1],
  absorbMs: [60, 600, 10],
  soldierPx: [20, 80, 1],
  cavalryPx: [30, 120, 1],
  standPx: [40, 400, 5],
  lineGapPx: [16, 120, 1],
  arrowsPer: [1, 3, 1],
  patterMs: [0, 120, 2],
  cheerMs: [0, 1200, 10],
  rowMs: [20, 300, 5],
  drumMs: [120, 800, 10],
  rankMs: [15, 160, 1],
  hostFiles: [3, 15, 1],
  hostWidthPx: [200, 1400, 10],
  hostCavalry: [0, 8, 1],
  hostArrows: [0, 24, 1],
  funnel: [0.2, 1, 0.01],
  dustMs: [0, 1200, 10],
  bannerMs: [200, 2500, 10],
  dust: [0, 2, 0.05],
  impactSize: [0.3, 3, 0.05],
  heroWindPx: [0, 40, 1],
  heroThrowPx: [0, 50, 1],
  knockPx: [0, 60, 1],
  squash: [0, 0.3, 0.01],
  shakeMs: [0, 1500, 10],
  zoomOutMs: [60, 1500, 10],
  reducedFadeMs: [60, 1000, 10],
  sfxHornGain: [0, 2, 0.05], sfxHornRate: [0.5, 2.5, 0.01],
  sfxDrumGain: [0, 2, 0.05], sfxDrumRate: [0.5, 2.5, 0.01],
  sfxChargeGain: [0, 2, 0.05], sfxChargeRate: [0.5, 2.5, 0.01],
  sfxGallopGain: [0, 2, 0.05], sfxGallopRate: [0.5, 2.5, 0.01],
  sfxLooseGain: [0, 2, 0.05], sfxLooseRate: [0.5, 2.5, 0.01],
  sfxThunkGain: [0, 2, 0.05], sfxThunkRate: [0.5, 2.5, 0.01],
  sfxWhooshGain: [0, 2, 0.05], sfxWhooshRate: [0.5, 2.5, 0.01],
  sfxThudGain: [0, 2, 0.05], sfxThudRate: [0.5, 2.5, 0.01],
  sfxBoomGain: [0, 2, 0.05], sfxBoomRate: [0.5, 2.5, 0.01],
  sfxCheerGain: [0, 2, 0.01], sfxCheerRate: [0.5, 2.5, 0.01],
  sfxTailMix: [0, 1, 0.01],
  sfxDuck: [0, 1, 0.05],
  previewDamage: [1, 60, 1],
  previewParts: [1, 8, 1],
};

export const HERO_WARHOST_RANGES: Record<HeroWarhostNumKey, [number, number, number]> = {
  ...GLOBAL_RANGES,
  ...(Object.fromEntries(TIERS.flatMap((t) => WARHOST_TIER_SUFFIXES.map((s) => [`t${t}${s}`, WARHOST_TIER_RANGES[s]]))) as Record<TierKey, [number, number, number]>),
};

/** Hard caps whatever the tuner says (the host tops out at 22 x 15 foot + 16 horse: under the scene's sprite cap). */
export const WARHOST_CAPS = { archers: 10, riders: 14, ranks: 22, files: 15, flank: 8, arrows: 24, shakePx: 40, zoom: 0.1 } as const;

const store = configStore<HeroWarhostConfig>({
  key: 'ascent.herowarhost.v1', defaults: HERO_WARHOST_DEFAULTS, ranges: HERO_WARHOST_RANGES,
  colorKeys: HERO_WARHOST_COLOR_KEYS, clipKeys: HERO_WARHOST_CLIP_KEYS, previewKeys: ['previewDamage', 'previewParts'],
});
export const heroWarhostStore = store;
export const getHeroWarhostConfig = store.get;
export const clampHeroWarhostValue = store.clamp;
export const sanitizeHeroWarhostConfig = store.sanitize;
export const heroWarhostConfigJson = store.json;
/** The preview speed hook (Recruit + the Collection read one per style). Always 1. */
export function heroWarhostPreviewSpeed(): number { return 1; }

export function warhostTierDials(tier: TierNum, c: HeroWarhostConfig = store.get()): Record<WarhostTierSuffix, number> {
  return Object.fromEntries(WARHOST_TIER_SUFFIXES.map((s) => [s, c[`t${tier}${s}`]])) as Record<WarhostTierSuffix, number>;
}

// ─── the pure plan ─────────────────────────────────────────────────────────────────────────────────────────────

export const WARHOST_REF_DISTANCE = 1600;

/** The lone spearman (I) and the archers (II) are drawn bigger than a soldier of the host: one figure has to read alone. */
export const WARHOST_SPEARMAN_SIZE = 2;
export const WARHOST_ARCHER_SIZE = 1.45;

/** II: an archer's second arrow leaves (and lands) this long after his first. */
export const WARHOST_RELOAD_MS = 90;

/** A leg's time for this distance (a short hop is quicker, a long one a little slower). */
export function warhostLegMs(distance: number, ms: number): number {
  const d = Number.isFinite(distance) && distance > 0 ? distance : WARHOST_REF_DISTANCE;
  return Math.round(ms * clamp(Math.sqrt(d / WARHOST_REF_DISTANCE), 0.62, 1.15));
}

export interface WarhostPlanInput extends AttackTierContext {
  leadIn?: number;
  total: number;
  distance: number;
  reduced?: boolean;
}

export type WarhostKind = 'spear' | 'archers' | 'cavalry' | 'host';

export interface WarhostPlan {
  reduced: boolean;
  tier: TierNum;
  kind: WarhostKind;
  k: number;
  total: number;
  /** The Knockout variant ("Tier V"): IV remixed. */
  ko: boolean;
  chargeAt: number;
  absorbEnd: number;
  /** IV: the three drums. */
  drums: number[];
  /** III, IV: the horn (-1 = none). */
  hornAt: number;
  /** The troops set out (I, II from the hero; III, IV the front of the charge passes the striker). */
  marchAt: number;
  /** I: the spearman plants. II: the line is formed and the bows come up. III, IV: the front reaches the target. */
  arriveAt: number;
  /** I: the throw. II: the first arrows leave. (III, IV: the same as `marchAt`.) */
  looseAt: number;
  /** II: archers. III: riders. IV: ranks. */
  troops: number;
  /** II: when each arrow lands (the last is the blow). */
  lands: number[];
  /** IV: when each overhead volley lands. */
  volleys: number[];
  /** Hits BEFORE the impact (ticks: II's arrows). */
  hits: number[];
  impactAt: number;
  /** AFTER the impact: each later row (III) or rank (IV) reaching the target (FX only). */
  buffets: number[];
  /** III, IV: the last row or rank has crossed the target. */
  passAt: number;
  /** I: the cheer starts. IV: the banner goes in (-1 = none). */
  cheerAt: number;
  plantAt: number;
  /** I, II: the troops turn for home (-1 = none). */
  homeAt: number;
  /** The Knockout's slow-mo dip (null otherwise): the one clock eases down and back, never 0. */
  dip: KoDip | null;
  endAt: number;
  shakePx: number;
  zoom: number;
  punch: number;
  dim: number;
}

export function warhostKind(tier: TierNum): WarhostKind { return tier === 1 ? 'spear' : tier === 2 ? 'archers' : tier === 3 ? 'cavalry' : 'host'; }

/** Rows of a filled wedge holding `n` riders (1, 2, 3, ...; the last row takes what is left). */
export function wedgeRows(n: number): number[] {
  const rows: number[] = [];
  let left = Math.max(1, Math.round(n));
  for (let r = 1; left > 0; r++) { const k = Math.min(r, left); rows.push(k); left -= k; }
  return rows;
}

/** The whole Warhost, in base ms. Pure and deterministic. */
export function warhostPlan(input: WarhostPlanInput, c: HeroWarhostConfig = store.get()): WarhostPlan {
  const total = Math.max(0, Math.round(input.total));
  const tier = attackTier(total, input, c); // a knockout always plays the shared Tier IV
  const kind = warhostKind(tier);
  const ko = tier === 4 && isKnockoutVariant(input);
  const L = warhostTierDials(tier, c);
  const k = (tier - 1) / 3;
  const base = {
    tier, kind, k, total, ko, shakePx: clamp(L.Shake * (ko ? KO_SHAKE : 1), 0, WARHOST_CAPS.shakePx), zoom: clamp(L.Zoom, 0, WARHOST_CAPS.zoom),
    punch: L.Punch * (ko ? 1.2 : 1), dim: L.Dim,
  };
  if (input.reduced) {
    const r = reducedAttackTimeline(input.leadIn ?? 0, c.reducedFadeMs);
    const at = r.impactAt;
    return {
      ...base, reduced: true, chargeAt: at, absorbEnd: at, drums: [], hornAt: -1, marchAt: at, arriveAt: at, looseAt: at, troops: 0, lands: [], volleys: [],
      hits: [], impactAt: at, buffets: [], passAt: at, cheerAt: -1, plantAt: -1, homeAt: -1, dip: null, endAt: r.endAt, shakePx: 0, zoom: 0, punch: 0, dim: 0,
    };
  }
  const chargeAt = Math.max(0, input.leadIn ?? 0);
  const absorbEnd = chargeAt + c.absorbMs;
  const marchAt = chargeAt + Math.max(60, L.ReadyMs);
  const out: WarhostPlan = {
    ...base, reduced: false, chargeAt, absorbEnd, drums: [], hornAt: -1, marchAt, arriveAt: marchAt, looseAt: marchAt, troops: 1, lands: [], volleys: [],
    hits: [], impactAt: marchAt, buffets: [], passAt: marchAt, cheerAt: -1, plantAt: -1, homeAt: -1, dip: null, endAt: marchAt,
  };
  if (kind === 'spear') {
    out.arriveAt = marchAt + L.MarchMs;
    out.looseAt = out.arriveAt + Math.max(60, L.HoldMs);
    out.impactAt = out.looseAt + Math.max(80, warhostLegMs(input.distance, L.FlightMs));
    out.passAt = out.impactAt;
    out.cheerAt = out.impactAt + 110;
    out.homeAt = out.cheerAt + Math.max(0, c.cheerMs);
    out.endAt = Math.max(out.impactAt + L.SettleMs, out.homeAt + 200);
  } else if (kind === 'archers') {
    const n = Math.round(clamp(L.Troops, 2, WARHOST_CAPS.archers));
    const per = Math.round(clamp(c.arrowsPer, 1, 3));
    out.troops = n;
    out.arriveAt = marchAt + L.MarchMs;
    out.looseAt = out.arriveAt + Math.max(80, L.HoldMs);
    const first = out.looseAt + Math.max(120, warhostLegMs(input.distance, L.FlightMs));
    for (let i = 0; i < n * per; i++) out.lands.push(first + i * Math.max(0, c.patterMs) + (Math.floor(i / n) * WARHOST_RELOAD_MS));
    out.impactAt = out.lands[out.lands.length - 1]!;
    out.hits = [...new Set(out.lands.filter((t) => t < out.impactAt))];
    out.passAt = out.impactAt;
    out.homeAt = out.impactAt + 140;
    out.endAt = Math.max(out.impactAt + L.SettleMs, out.homeAt + 240);
  } else if (kind === 'cavalry') {
    const n = Math.round(clamp(L.Troops, 3, WARHOST_CAPS.riders));
    out.troops = n;
    out.hornAt = chargeAt;
    out.impactAt = marchAt + Math.max(160, warhostLegMs(input.distance, L.MarchMs));
    out.arriveAt = out.impactAt;
    const rows = wedgeRows(n).length;
    for (let r = 1; r < rows; r++) out.buffets.push(out.impactAt + r * c.rowMs);
    out.passAt = out.impactAt + (rows - 1) * c.rowMs;
    out.endAt = Math.max(out.impactAt + L.SettleMs, out.passAt + 300);
  } else {
    const ranks = Math.round(clamp(L.Troops, 3, WARHOST_CAPS.ranks));
    out.troops = ranks;
    for (let i = 0; i < 3; i++) out.drums.push(chargeAt + i * c.drumMs);
    out.hornAt = Math.min(marchAt, chargeAt + 2 * c.drumMs + 140);
    out.impactAt = marchAt + Math.max(200, warhostLegMs(input.distance, L.MarchMs));
    out.arriveAt = out.impactAt;
    // Every third rank is a buffet beat (a thud and a knock); the dust and the shudder run the whole trample.
    for (let r = 3; r < ranks; r += 3) out.buffets.push(out.impactAt + r * c.rankMs);
    out.passAt = out.impactAt + (ranks - 1) * c.rankMs;
    if (c.hostArrows > 0) out.volleys = [out.impactAt - 70, out.impactAt + Math.min(240, (out.passAt - out.impactAt) * 0.45)];
    out.plantAt = out.passAt + Math.max(0, c.dustMs);
    out.cheerAt = out.plantAt + 120;
    out.endAt = out.plantAt + Math.max(200, c.bannerMs) + L.SettleMs;
    if (ko) out.dip = { at: out.impactAt, lo: KO_DIP.lo, ms: KO_DIP.ms };
  }
  return out;
}

export type WarhostCueKind = 'charge' | 'drum' | 'horn' | 'march' | 'arrive' | 'loose' | 'volley' | 'hit' | 'impact' | 'buffet' | 'cheer' | 'pass' | 'plant' | 'home' | 'end';
export interface WarhostCue { at: number; kind: WarhostCueKind; i: number }

/** IV: a volley leaves this long before it lands. */
export const WARHOST_VOLLEY_MS = 560;

export function warhostCues(p: WarhostPlan): WarhostCue[] {
  const out: WarhostCue[] = [];
  if (!p.reduced) {
    out.push({ at: p.chargeAt, kind: 'charge', i: 0 });
    p.drums.forEach((at, i) => out.push({ at, kind: 'drum', i }));
    if (p.hornAt >= 0) out.push({ at: p.hornAt, kind: 'horn', i: 0 });
    out.push({ at: p.marchAt, kind: 'march', i: 0 });
    if (p.kind === 'spear' || p.kind === 'archers') { out.push({ at: p.arriveAt, kind: 'arrive', i: 0 }); out.push({ at: p.looseAt, kind: 'loose', i: 0 }); }
    p.volleys.forEach((at, i) => out.push({ at: at - WARHOST_VOLLEY_MS, kind: 'volley', i }));
    p.hits.forEach((at, i) => out.push({ at, kind: 'hit', i }));
    p.buffets.forEach((at, i) => out.push({ at, kind: 'buffet', i }));
    if (p.cheerAt >= 0) out.push({ at: p.cheerAt, kind: 'cheer', i: 0 });
    if (p.kind === 'cavalry' || p.kind === 'host') out.push({ at: p.passAt, kind: 'pass', i: 0 });
    if (p.plantAt >= 0) out.push({ at: p.plantAt, kind: 'plant', i: 0 });
    if (p.homeAt >= 0) out.push({ at: p.homeAt, kind: 'home', i: 0 });
  }
  out.push({ at: p.impactAt, kind: 'impact', i: 0 });
  out.push({ at: p.endAt, kind: 'end', i: 0 });
  const order: Record<WarhostCueKind, number> = { charge: 0, drum: 1, horn: 2, march: 3, arrive: 4, loose: 5, volley: 6, hit: 7, impact: 8, buffet: 9, cheer: 10, pass: 11, plant: 12, home: 13, end: 14 };
  return out.sort((a, b) => a.at - b.at || order[a.kind] - order[b.kind]);
}

/** The Knockout's slow-mo dip (the shared one: a smooth ramp, never 0; R-PROG-ATTACK-10). 1 on every other look. */
export function warhostScale(p: WarhostPlan, t: number): number { return p.reduced ? 1 : koTimeScale(p.dip, t); }
export function warhostSlowExtraMs(p: WarhostPlan): number { return p.reduced ? 0 : koDipExtraMs(p.dip); }

// ─── the staging (pure) ────────────────────────────────────────────────────────────────────────────────────────

export type Box = { x: number; y: number; w: number; h: number };

export type TroopUnit = 'spear' | 'archer' | 'cav' | 'inf' | 'bearer' | 'cheerer';

/**
 * One soldier's whole script: he appears at `p0` (`t0`), travels to `p1` (`t1`), holds there until `t2`, travels to
 * `p2` (`t3`) and is gone. A `through` soldier never holds (`t1 === t2`) and keeps one steady pace over both legs.
 */
export interface Troop {
  unit: TroopUnit;
  p0: Pt; p1: Pt; p2: Pt;
  t0: number; t1: number; t2: number; t3: number;
  through: boolean;
  /** Holding: the wind-up or the draw starts (`actAt`), the first and the last release, the cheer (-1 = none). */
  actAt: number; looseAt: number; lastLooseAt: number; cheerAt: number;
  /** His stride's offset (ms), his size (x), his shade (0 = full colour, toward 1 = darker: the rear ranks). */
  phase: number; size: number; shade: number;
  /** Which way he faces while holding (1 = right). */
  face: 1 | -1;
  /** A dust puff every this many ms while he moves (0 = none). */
  dustMs: number;
  /** Draw order (bigger = nearer the viewer). */
  z: number;
}

/** A spear or an arrow: it flies `from` to `to` over a lifted arc, lands at `t1`, sits there and fades from `fadeAt`. */
export interface Shot {
  kind: 'spear' | 'arrow';
  from: Pt; ctrl: Pt; to: Pt;
  t0: number; t1: number; fadeAt: number;
  /** It sticks in the struck PORTRAIT (and rides its knockback); otherwise it sticks in the ground. */
  stick: boolean;
  /** How it sits once stuck: a turn off its landing angle (rad), and how hard it twangs. */
  lean: number; twang: number;
  size: number;
}

/**
 * A banner: it rises at `at` from `t0`, flies until `t1` and is gone by `t2`. `follow`: it stands on the struck
 * portrait and rides its knockback. `carrier`: until `t0` it is carried by that troop (an index into the troops).
 */
export interface Banner { at: Pt; t0: number; t1: number; t2: number; size: number; follow: boolean; carrier: number; lean: number }

export interface WarhostStage {
  /** Striker to struck, its left-hand normal, and which way the host faces (1 = right). */
  u: Pt; n: Pt; face: 1 | -1;
  troops: Troop[];
  shots: Shot[];
  banners: Banner[];
  /** Where the blow lands on the struck portrait (the spear's point; the arrows scatter round it). */
  strike: Pt;
}

/** How far from `p` along `dir` the box's edge is (0 when already outside). */
export function rayExit(p: Pt, dir: Pt, b: Box): number {
  let t = Infinity;
  if (dir.x > 1e-6) t = Math.min(t, (b.x + b.w - p.x) / dir.x); else if (dir.x < -1e-6) t = Math.min(t, (b.x - p.x) / dir.x);
  if (dir.y > 1e-6) t = Math.min(t, (b.y + b.h - p.y) / dir.y); else if (dir.y < -1e-6) t = Math.min(t, (b.y - p.y) / dir.y);
  return Number.isFinite(t) ? Math.max(0, t) : 0;
}

const inBox = (p: Pt, b: Box | undefined, m: number): Pt => (b ? { x: clamp(p.x, b.x + m, b.x + b.w - m), y: clamp(p.y, b.y + m, b.y + b.h - m) } : p);

/**
 * The control point of a lifted arc (a throw goes UP the screen and comes down). The apex sits half the control's lift
 * above the chord's middle: the lift is cut so the apex stays inside the box (but never flatter than a tenth of the chord).
 */
function arcCtrl(from: Pt, to: Pt, lift: number, b: Box | undefined, m: number): Pt {
  const mx = (from.x + to.x) / 2, my = (from.y + to.y) / 2;
  const least = Math.min(lift, Math.hypot(to.x - from.x, to.y - from.y) * 0.1);
  const room = b ? (my - b.y - m) * 2 : lift;
  return { x: mx, y: my - Math.max(least, Math.min(lift, room)) };
}

const troop = (unit: TroopUnit, o: Partial<Troop> & Pick<Troop, 'p0' | 'p1' | 'p2' | 't0' | 't1' | 't2' | 't3'>): Troop => ({
  unit, through: false, actAt: -1, looseAt: -1, lastLooseAt: -1, cheerAt: -1, phase: 0, size: 1, shade: 0, face: 1, dustMs: 0, z: o.p1.y, ...o,
});

/**
 * Stage the whole look: every soldier, shot and banner, from the two portrait points. `s` is the stage scale (every px
 * dial is multiplied by it), `bounds` the screen (or the sandbox box), `seed` rolls the formation jitter. Pure.
 */
export function warhostStage(p: WarhostPlan, a: Pt, d: Pt, radius: number, aRadius: number, c: HeroWarhostConfig, s = 1, seed = 1, bounds?: Box): WarhostStage {
  const L = Math.hypot(d.x - a.x, d.y - a.y) || 1;
  const u = { x: (d.x - a.x) / L, y: (d.y - a.y) / L };
  const n = { x: -u.y, y: u.x };
  const face: 1 | -1 = a.x > d.x ? -1 : 1;
  // The blow lands on the struck portrait's rim, on the striker's side but swung a little toward the middle of the screen:
  // the hit number is drawn straight down the line between the heroes, and the spear must not hide behind it.
  const midY = bounds ? bounds.y + bounds.h / 2 : d.y + 1;
  const swing = (ang: number): Pt => ({ x: d.x + (-u.x * Math.cos(ang) + u.y * Math.sin(ang)) * radius * 0.66, y: d.y + (-u.x * Math.sin(ang) - u.y * Math.cos(ang)) * radius * 0.66 });
  const sA = swing(0.75), sB = swing(-0.75);
  const strike = Math.abs(sA.y - midY) <= Math.abs(sB.y - midY) ? sA : sB;
  const stage: WarhostStage = { u, n, face, troops: [], shots: [], banners: [], strike };
  if (p.reduced) return stage;
  const rnd = seededRng(seed);
  const jit = (amp: number): number => (rnd() - 0.5) * 2 * amp;
  const at = (o: Pt, along: number, lat: number): Pt => ({ x: o.x + u.x * along + n.x * lat, y: o.y + u.y * along + n.y * lat });
  const m = 30 * s;
  const door = at(a, aRadius * 0.55, 0); // where a soldier steps out from under the striking portrait
  // Never further out than a third of the way: the spearman and the archers stay the striker's men.
  const standAlong = Math.min(aRadius + c.standPx * s, L * 0.4);

  if (p.kind === 'spear') {
    const stand = inBox(at(a, standAlong, 0), bounds, m);
    stage.troops.push(troop('spear', {
      p0: door, p1: stand, p2: door, t0: p.marchAt, t1: p.arriveAt, t2: p.homeAt, t3: p.endAt - 40, actAt: p.arriveAt + 50, looseAt: p.looseAt,
      lastLooseAt: p.looseAt, cheerAt: p.cheerAt, face, dustMs: 70, size: WARHOST_SPEARMAN_SIZE,
    }));
    const hand = { x: stand.x + face * 8 * s * WARHOST_SPEARMAN_SIZE, y: stand.y - c.soldierPx * s * WARHOST_SPEARMAN_SIZE };
    stage.shots.push({
      kind: 'spear', from: hand, ctrl: arcCtrl(hand, strike, L * 0.22, bounds, m), to: strike, t0: p.looseAt, t1: p.impactAt, fadeAt: p.impactAt + 520,
      stick: true, lean: 0, twang: 1, size: WARHOST_SPEARMAN_SIZE * 0.92,
    });
  } else if (p.kind === 'archers') {
    const N = p.troops;
    const gap = c.lineGapPx * s;
    const reload = WARHOST_RELOAD_MS;
    const jog = Math.max(120, p.arriveAt - p.marchAt - (N - 1) * 18);
    for (let i = 0; i < N; i++) {
      // The line stands across the way to the target, each archer a touch out of true.
      const lat = (i - (N - 1) / 2) * gap;
      const stand = inBox(at(a, standAlong + jit(5 * s), lat + jit(3 * s)), bounds, m);
      const t0 = p.marchAt + i * 18;
      const per = Math.round(p.lands.length / N);
      stage.troops.push(troop('archer', {
        p0: door, p1: stand, p2: door, t0, t1: t0 + jog, t2: p.homeAt + (N - 1 - i) * 16, t3: p.endAt - 40, actAt: p.arriveAt + 30, looseAt: p.looseAt,
        lastLooseAt: p.looseAt + (per - 1) * reload, cheerAt: -1, face, dustMs: 110, phase: rnd() * 400, size: WARHOST_ARCHER_SIZE * (0.95 + rnd() * 0.1),
      }));
    }
    // The arrows: arrow k is archer (k mod N)'s; they land in the plan's patter, scattered over the portrait.
    for (let k = 0; k < p.lands.length; k++) {
      const who = stage.troops[k % N]!;
      const round = Math.floor(k / N);
      const bow = { x: who.p1.x + face * 9 * s * WARHOST_ARCHER_SIZE, y: who.p1.y - c.soldierPx * s * WARHOST_ARCHER_SIZE * 0.85 };
      const ang = rnd() * Math.PI * 2, rr = Math.sqrt(rnd()) * radius * 0.62;
      const to = { x: d.x + Math.cos(ang) * rr, y: d.y + Math.sin(ang) * rr * 0.8 };
      const land = p.lands[k]!;
      stage.shots.push({
        kind: 'arrow', from: bow, ctrl: arcCtrl(bow, to, L * (0.62 + rnd() * 0.16), bounds, m), to, t0: p.looseAt + round * reload + (k % N) * 6, t1: land,
        fadeAt: p.impactAt + 420 + rnd() * 160, stick: true, lean: jit(0.22), twang: 0.6, size: 1.6,
      });
    }
  } else {
    // THE CHARGE (III, IV): the front crosses the striker at `marchAt` and the target at `impactAt`, at one steady pace.
    const v = L / Math.max(1, p.impactAt - p.marchAt); // px per ms
    const back = bounds ? Math.min(rayExit(a, { x: -u.x, y: -u.y }, bounds) + 80 * s, L * 0.5) : L * 0.3;
    const fore = bounds ? rayExit(d, u, bounds) + 120 * s : L * 0.6;
    /** A soldier who crosses the target at `cross`, `lat` off the centre line there (and `lat0` / `lat2` at the ends). */
    const runner = (unit: TroopUnit, cross: number, lat0: number, lat1: number, lat2: number, over: Partial<Troop>): Troop => {
      const p0 = at(a, -back, lat0), p1 = at(d, 0, lat1), p2 = at(d, fore, lat2);
      return troop(unit, {
        p0, p1, p2, t0: cross - (L + back) / v, t1: cross, t2: cross, t3: cross + fore / v, through: true, face, phase: rnd() * 400,
        z: p1.y - u.y * (cross - p.impactAt) * v, ...over,
      });
    };
    if (p.kind === 'cavalry') {
      const rows = wedgeRows(p.troops);
      const gapLat = c.cavalryPx * s * 0.78;
      // They wheel off to one side past the target (the seed picks which).
      const wheel = (rnd() < 0.5 ? -1 : 1) * fore * 0.55;
      rows.forEach((count, r) => {
        for (let j = 0; j < count; j++) {
          const lat = (j - (count - 1) / 2) * gapLat + jit(4 * s);
          stage.troops.push(runner('cav', p.impactAt + r * c.rowMs + jit(8), lat * 1.25, lat, lat * 1.6 + wheel, { dustMs: 55, size: 0.94 + rnd() * 0.14 }));
        }
      });
    } else {
      const files = Math.round(clamp(c.hostFiles, 3, WARHOST_CAPS.files));
      const W = c.hostWidthPx * s;
      const f = clamp(c.funnel, 0.2, 1);
      for (let r = 0; r < p.troops; r++) {
        for (let j = 0; j < files; j++) {
          // Ranks are staggered half a file, each man a touch out of true: a host, not a grid.
          const lat = ((j + (r % 2) * 0.5) / (files - 1 + 0.5) - 0.5) * W + jit(7 * s);
          stage.troops.push(runner('inf', p.impactAt + r * c.rankMs + jit(c.rankMs * 0.3), lat, lat * f, lat * 1.05, {
            dustMs: (r * files + j) % 5 === 0 ? 150 : 0, size: 0.9 + rnd() * 0.2, shade: Math.min(0.3, r * 0.012),
          }));
        }
      }
      // Cavalry on the flanks: a file a side, riding a little ahead of the foot.
      const flank = Math.round(clamp(c.hostCavalry, 0, WARHOST_CAPS.flank));
      for (const side of [-1, 1]) {
        for (let j = 0; j < flank; j++) {
          const lat = side * (W / 2 + c.cavalryPx * s * (0.7 + (j % 2) * 0.55)) + jit(6 * s);
          const cross = p.impactAt - 60 + (j * (p.passAt - p.impactAt)) / Math.max(1, flank) + jit(14);
          stage.troops.push(runner('cav', cross, lat, lat * (f + 0.12), lat * 1.1, { dustMs: 90, size: 0.92 + rnd() * 0.14 }));
        }
      }
      // The volleys overhead: loosed from behind the striker, raining round the target.
      const arrows = Math.round(clamp(c.hostArrows, 0, WARHOST_CAPS.arrows));
      p.volleys.forEach((land, vi) => {
        for (let i = 0; i < arrows; i++) {
          const from = at(a, -aRadius * 0.6 + jit(60 * s), jit(W * 0.45));
          const ang = rnd() * Math.PI * 2, rr = Math.sqrt(rnd()) * radius * 2.3;
          const to = inBox({ x: d.x + Math.cos(ang) * rr, y: d.y + Math.sin(ang) * rr * 0.7 }, bounds, 8 * s);
          const t1 = land + i * 11 + vi * 4;
          stage.shots.push({
            kind: 'arrow', from, ctrl: arcCtrl(from, to, L * (0.5 + rnd() * 0.2), bounds, m), to, t0: t1 - WARHOST_VOLLEY_MS, t1,
            fadeAt: p.passAt + 60 + rnd() * 200, stick: rr < radius * 0.8, lean: jit(0.25), twang: 0.5, size: 1.4,
          });
        }
      });
      // The banners rising behind the striking hero, one a drum.
      const end = p.impactAt + 140;
      p.drums.forEach((drum, i) => {
        // Round the striking portrait's rim: one at its crown, then one at each shoulder (kept on screen).
        const sx = i === 0 ? 0 : i === 1 ? -1 : 1;
        const foot = { x: a.x + sx * aRadius * 0.92, y: a.y - aRadius * (i === 0 ? 0.78 : 0.18) };
        stage.banners.push({
          at: inBox(foot, bounds, 26 * s), t0: drum + 30, t1: end + i * 60, t2: end + 260 + i * 60, size: i === 0 ? 1.7 : 1.4,
          follow: false, carrier: -1, lean: sx * 0.07,
        });
      });
      // The one who stays: he comes in behind the last rank, stops beside the struck portrait and plants the banner on it.
      const side = face;
      const post = inBox({ x: d.x - side * radius * 0.78, y: d.y + radius * 0.72 }, bounds, m);
      const from = at(d, -L * 0.42, 0);
      const bearer = troop('bearer', {
        p0: from, p1: post, p2: post, t0: p.plantAt - 60 - (L * 0.42) / v, t1: p.plantAt - 60, t2: p.endAt - 180, t3: p.endAt - 20, actAt: p.plantAt, looseAt: p.plantAt,
        lastLooseAt: p.plantAt, cheerAt: p.cheerAt, face: side as 1 | -1, dustMs: 80, size: 1.6, z: 1e6,
      });
      stage.troops.push(bearer);
      const bearerIdx = stage.troops.length - 1;
      const flyEnd = p.endAt - 200;
      stage.banners.push({ at: { x: d.x, y: d.y + radius * 0.35 }, t0: p.plantAt, t1: flyEnd, t2: p.endAt - 20, size: 1.6, follow: true, carrier: bearerIdx, lean: 0 });
      if (p.ko) {
        // THE KNOCKOUT's extra beat: three more stay and cheer round the banner.
        [[1, 0.8, 0.8], [-1, 1.25, 0.5], [1, 1.3, 0.45]].forEach(([sd, kx, ky], i) => {
          const spot = inBox({ x: d.x + sd! * side * radius * kx!, y: d.y + radius * ky! }, bounds, m);
          stage.troops.push(troop('cheerer', {
            p0: at(d, -L * 0.36, jit(40 * s)), p1: spot, p2: spot, t0: p.plantAt - 40 - (L * 0.36) / v + i * 50, t1: p.plantAt - 20 + i * 50, t2: p.endAt - 180, t3: p.endAt - 20,
            cheerAt: p.cheerAt + 40 + i * 70, face: (sd! * side > 0 ? -1 : 1) as 1 | -1, dustMs: 90, phase: i * 130, size: 1.45, z: 1e6 + 1 + i,
          }));
        });
      }
    }
  }
  return stage;
}

export type TroopState = 'wait' | 'out' | 'hold' | 'back' | 'gone';
export interface TroopAt { x: number; y: number; state: TroopState; alpha: number; dir: number }

/** Where a soldier is at `t` (written into `out`: no allocation on the frame path). `dir` is which way he travels (x). */
export function troopAt(tr: Troop, t: number, out: TroopAt): TroopAt {
  if (t < tr.t0) { out.state = 'wait'; out.x = tr.p0.x; out.y = tr.p0.y; out.alpha = 0; out.dir = tr.face; return out; }
  if (t >= tr.t3) { out.state = 'gone'; out.x = tr.p2.x; out.y = tr.p2.y; out.alpha = 0; out.dir = tr.face; return out; }
  const fadeIn = clamp01((t - tr.t0) / 120);
  // A soldier who ends where he stands (the banner bearer) fades in place; one who leaves fades as he goes.
  const fadeOut = clamp01((tr.t3 - t) / 150);
  out.alpha = Math.min(fadeIn, fadeOut);
  if (t < tr.t1) {
    const k = (t - tr.t0) / Math.max(1, tr.t1 - tr.t0);
    const e = tr.through ? k : k * (1.6 - 0.6 * k); // a runner brakes into his mark
    out.x = tr.p0.x + (tr.p1.x - tr.p0.x) * e; out.y = tr.p0.y + (tr.p1.y - tr.p0.y) * e;
    out.state = 'out'; out.dir = Math.abs(tr.p1.x - tr.p0.x) > 2 ? Math.sign(tr.p1.x - tr.p0.x) : tr.face;
    return out;
  }
  if (t < tr.t2) { out.x = tr.p1.x; out.y = tr.p1.y; out.state = 'hold'; out.dir = tr.face; return out; }
  const k = (t - tr.t2) / Math.max(1, tr.t3 - tr.t2);
  const still = tr.p1.x === tr.p2.x && tr.p1.y === tr.p2.y;
  out.x = tr.p1.x + (tr.p2.x - tr.p1.x) * k; out.y = tr.p1.y + (tr.p2.y - tr.p1.y) * k;
  out.state = still ? 'hold' : tr.through ? 'out' : 'back';
  out.dir = Math.abs(tr.p2.x - tr.p1.x) > 2 ? Math.sign(tr.p2.x - tr.p1.x) : tr.face;
  return out;
}

export type ShotState = 'wait' | 'fly' | 'stuck' | 'gone';
export interface ShotAt { x: number; y: number; rot: number; state: ShotState; alpha: number }

export const SHOT_FADE_MS = 220;

/** Where a spear or an arrow is at `t` (written into `out`). Its heading follows the arc; stuck, it twangs and settles. */
export function shotAt(sh: Shot, t: number, out: ShotAt): ShotAt {
  if (t < sh.t0) { out.state = 'wait'; out.x = sh.from.x; out.y = sh.from.y; out.rot = 0; out.alpha = 0; return out; }
  if (t >= sh.fadeAt + SHOT_FADE_MS) { out.state = 'gone'; out.x = sh.to.x; out.y = sh.to.y; out.rot = 0; out.alpha = 0; return out; }
  const e = Math.min(1, (t - sh.t0) / Math.max(1, sh.t1 - sh.t0));
  const mt = 1 - e;
  // The tangent of the quadratic (at the end: the line from the control to the target).
  const tx = 2 * mt * (sh.ctrl.x - sh.from.x) + 2 * e * (sh.to.x - sh.ctrl.x);
  const ty = 2 * mt * (sh.ctrl.y - sh.from.y) + 2 * e * (sh.to.y - sh.ctrl.y);
  out.rot = Math.atan2(ty, tx);
  if (t < sh.t1) {
    out.x = mt * mt * sh.from.x + 2 * mt * e * sh.ctrl.x + e * e * sh.to.x;
    out.y = mt * mt * sh.from.y + 2 * mt * e * sh.ctrl.y + e * e * sh.to.y;
    out.state = 'fly'; out.alpha = Math.min(1, (t - sh.t0) / 60);
    return out;
  }
  const since = t - sh.t1;
  out.x = sh.to.x; out.y = sh.to.y;
  out.rot += sh.lean + 0.3 * sh.twang * Math.exp(-since / 110) * Math.sin(since * 0.075);
  out.state = 'stuck'; out.alpha = t < sh.fadeAt ? 1 : 1 - (t - sh.fadeAt) / SHOT_FADE_MS;
  return out;
}

// ─── the camera (pure) ─────────────────────────────────────────────────────────────────────────────────────────

const springAt = (ms: number, hz: number, tau: number): number => (ms < 0 ? 0 : Math.exp(-ms / tau) * Math.cos(2 * Math.PI * hz * (ms / 1000)));
const sine = (u: number): number => 0.5 - 0.5 * Math.cos(Math.PI * Math.min(1, Math.max(0, u)));

/** How hard the ground shakes under the charge at `t` (0..1): up as the front nears, down as the last rank leaves. */
export function warhostRumble(p: WarhostPlan, t: number): number {
  if (p.reduced || (p.kind !== 'host' && p.kind !== 'cavalry')) return 0;
  const up = clamp01((t - (p.impactAt - 420)) / 420);
  const down = 1 - clamp01((t - p.passAt) / 260);
  return up * down;
}

/**
 * The camera: a push in through the ready (held to the blow); each drum kicks it; the blow punches and shakes; under
 * the charge the ground rumbles (a small steady shake while the ranks pass). Pure.
 */
export function warhostCameraAt(p: WarhostPlan, c: HeroWarhostConfig, t: number, dir: Pt = { x: 1, y: 0 }): { zoom: number; x: number; y: number } {
  if (p.reduced) return { zoom: 1, x: 0, y: 0 };
  let z = 0;
  if (t >= p.chargeAt && t < p.impactAt) z += p.zoom * sine((t - p.chargeAt) / Math.max(1, p.marchAt - p.chargeAt));
  else if (t >= p.impactAt) z += (p.zoom + p.punch) * Math.exp(-(t - p.impactAt) / Math.max(1, c.zoomOutMs / 4));
  let x = 0, y = 0;
  const kick = (at: number, amp: number, tau: number, hz: number): void => { const s = springAt(t - at, hz, tau); x += dir.x * amp * s; y += dir.y * amp * s; };
  for (const at of p.drums) { kick(at, -p.shakePx * 0.16, 50, 12); z += p.zoom * 0.25 * Math.max(0, springAt(t - at, 5, 70)); }
  for (const at of p.hits) kick(at, p.shakePx * 0.12, 30, 20);
  kick(p.impactAt, p.shakePx, Math.max(1, c.shakeMs / 4), 16);
  for (const at of p.buffets) kick(at, p.shakePx * 0.3, 45, 17);
  const r = warhostRumble(p, t);
  if (r > 0) {
    const amp = p.shakePx * (p.kind === 'host' ? 0.16 : 0.1) * r;
    x += amp * Math.sin(t * 0.087); y += amp * Math.sin(t * 0.131 + 1.3);
  }
  return { zoom: 1 + Math.max(0, z), x, y };
}

/** The anchor: the striker through the ready, gliding to the struck hero as the troops go, then the struck hero. */
export function warhostCameraFocus(p: WarhostPlan, t: number, a: Pt, d: Pt): Pt {
  const to = p.kind === 'spear' || p.kind === 'archers' ? p.looseAt : p.marchAt + (p.impactAt - p.marchAt) * 0.7;
  if (t <= p.marchAt) return a;
  if (t < to) { const e = sine((t - p.marchAt) / Math.max(1, to - p.marchAt)); return { x: a.x + (d.x - a.x) * e, y: a.y + (d.y - a.y) * e }; }
  return d;
}
