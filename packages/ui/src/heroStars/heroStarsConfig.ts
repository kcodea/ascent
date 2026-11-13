/**
 * THE WRITTEN IN THE STARS HERO ATTACK ("Written in the Stars"; ANCIENT rarity; dev-only, no cosmetic yet): its tuned
 * values, its pure timeline, the pure constellation geometry, the draw of the bow and the pure camera.
 *
 * THE SIGNATURE is CONSTELLATIONS. The board dims to a night sky, stars appear, and thin lines CONNECT them one by one
 * into a figure that then comes alive and strikes. The drawing-on of the lines, star by star, is the whole charm; no
 * other attack draws line figures in the sky. Everything is cold white-gold starlight on blue-black: never fire (the
 * Inferno owns meteors and fire), never clock hands.
 *
 * FOUR LOOKS on the shared thresholds (`attackTier`: a knockout always plays IV):
 *  - I, THE ARROW: three stars light in a row above the striking hero and link into an arrow (two small barb stars at
 *    its head); the figure brightens, pulls back a touch and looses itself along its own line into the struck portrait.
 *  - II, THE BOW: eight stars link into a bow with a nocked arrow; the bow DRAWS (the string star pulls back, the two
 *    string lines bending into a V, the tips flexing), holds, and looses a brighter arrow.
 *  - III, THE HUNTER: a sixteen-star archer is traced (head, shoulders, the bow arm and its bow, the string, the
 *    drawing arm, the arrow, legs in a braced stance); a faint ghost body fills in between the lines for a beat; the
 *    hunter draws and shoots, the arrow leaving a long line of light across the sky.
 *  - IV, WRITTEN IN THE STARS: the veil deepens and the sky fills. A medallion of stars with a crown and a bust is
 *    traced above the board and the striking hero's own portrait fades in inside it as a ghost; an arm of stars reaches
 *    out and plucks one star from the sky. The star SWELLS and blazes while the whole sky holds its breath (every
 *    other star dims and leans toward it), then falls as a large white-gold COMET with a long tail: straight down the
 *    whole sky when there is sky above the struck portrait, else thrown from the far side in an ARC over the top of
 *    the sky, coming down onto it. It lands in a wide nova of stardust and a sky-wide flash; the constellation's lines
 *    flare, then SCATTER into sparks that drift down before the night fades. The blow lands on the comet.
 *
 * EVERY SHOT is a bolt of starlight on a PATH (a quadratic curve; a straight line for the arrows): a bright head and a
 * long luminous tail that hangs along the path after the blow. EVERY BLOW is a nova of stardust that expands and hangs,
 * a flash on the sky, the struck portrait rocked and the nearby stars jolted; all of it scales with the tier.
 *
 * A TRACE is made of STROKES: each stroke is a path of stars drawn edge by edge, one edge per SLOT (`StepMs` long). Two
 * strokes may share slots (the hunter's two legs are drawn by two pens at once). A star lights the moment the first
 * line reaches it. The slot count per look is fixed (`STARS_SLOTS`), so the timeline never depends on the geometry.
 *
 * THE CONTRACT: the consequence lands exactly ONCE, on the arrow or the falling star. The one clock is never scaled or
 * held. Reduced motion: fades only.
 */
import { configStore } from '../heroAttack/configStore';
import { clamp, clamp01, type Pt } from '../heroAttack/easing';
import {
  HERO_ATTACK_TIER_THRESHOLDS, TIERS, reducedAttackTimeline, attackTier, isKnockoutVariant, type AttackTierContext, type TierNum,
} from '../heroAttack/tiers';
import { KO_SHAKE } from '../heroAttack/knockout';

export type { TierNum };

export const STARS_LEVELS = ['t1', 't2', 't3', 't4'] as const;
export type StarsLevel = (typeof STARS_LEVELS)[number];

export const STARS_TIER_SUFFIXES = [
  'SkyMs', 'StepMs', 'AliveMs', 'DrawMs', 'HoldMs', 'FlyMs', 'Size', 'Shake', 'Zoom', 'Punch', 'SettleMs', 'Dim', 'Veil', 'SkyStars',
] as const;
export type StarsTierSuffix = (typeof STARS_TIER_SUFFIXES)[number];
type TierKey = `${StarsLevel}${StarsTierSuffix}`;

interface GlobalConfig {
  tier2At: number; tier3At: number; tier4At: number;
  absorbMs: number;
  /** A constellation star's four-point glint (px across at stage scale 1; a star's own size multiplies it). */
  starPx: number;
  /** A constellation line's glowing width (px). */
  lineWidth: number;
  /** How much the sky's small stars twinkle (0 = steady). */
  twinkle: number;
  /** III: the ghost body between the lines (peak opacity). */
  ghostAlpha: number;
  /** IV: the striking hero's portrait inside the medallion (peak opacity). */
  portraitAlpha: number;
  /** III: the hunter's height (striking portrait radii; capped at half the screen). */
  hunterSize: number;
  /** IV: the medallion's radius (a fraction of the screen height). */
  medallionSize: number;
  /** IV: how far the star falls when there is sky above the struck hero (struck portrait radii; the sky caps it). */
  fallLen: number;
  /** IV: how far the plucked star swells before it falls (x its own size). */
  swell: number;
  /** IV: how far every other star dims while the plucked star swells (0 = not at all). */
  hush: number;
  /** IV: the comet's head (struck portrait radii across). */
  cometSize: number;
  /** The flash on the sky on the blow (IV's peak opacity; the lower looks flash a fraction of it). */
  skyFlash: number;
  /** IV: after the blow, when the constellation's lines break into falling sparks. */
  scatterMs: number;
  /** IV: how long the falling sparks drift. */
  sparkFallMs: number;
  /** The loosed arrow's least length (px at stage scale 1): it is drawn as long as the figure's own arrow, never shorter than this. */
  arrowPx: number;
  /** The luminous tail behind the arrow (px wide at the head, at I; wider on the higher looks, widest behind the comet). */
  trailWidth: number;
  /** How long the shot's line of light hangs along its path after the blow (III and IV in full; I and II half). */
  trailLingerMs: number;
  impactSize: number;
  /** After the blow, how long before the sky starts to fade. */
  skyHoldMs: number;
  heroLiftPx: number;
  knockPx: number;
  squash: number;
  shakeMs: number;
  zoomOutMs: number;
  reducedFadeMs: number;
  colorStar: string;
  colorGold: string;
  colorLine: string;
  colorSky: string;
  colorPlayer: string;
  colorFoe: string;
  sfxSkyClip: string; sfxSkyGain: number; sfxSkyRate: number;
  sfxTickClip: string; sfxTickGain: number; sfxTickRate: number;
  sfxLooseClip: string; sfxLooseGain: number; sfxLooseRate: number;
  /** The airy pass of the arrow under the string's snap (a shared whoosh; `sfxWhooshStartMs` skips its slow start). */
  sfxWhooshClip: string; sfxWhooshGain: number; sfxWhooshRate: number;
  sfxWhooshStartMs: number;
  sfxFallClip: string; sfxFallGain: number; sfxFallRate: number;
  /** Where in the falling star clip its landing begins (clip ms): the descent before it, the soft impact after. */
  sfxFallHitMs: number;
  sfxHitGain: number; sfxHitRate: number;
  /** The rising swell under the draw of the bow, and under IV's star as it swells (its climax lands on the loose). */
  sfxRiseClip: string; sfxRiseGain: number; sfxRiseRate: number;
  /** The low body under every blow: IV plays the whole deep boom and its tail, the arrows its first moment, quieter and higher. */
  sfxBoomClip: string; sfxBoomGain: number; sfxBoomRate: number;
  /** The deep thrum of the bowstring under its snap (I to III). */
  sfxThrumClip: string; sfxThrumGain: number; sfxThrumRate: number;
  /** IV: how loudly the sky's shimmer blooms again under the landing (the stars answering). */
  sfxBloomGain: number;
  sfxTailMix: number;
  sfxDuck: number;
  previewDamage: number;
  previewParts: number;
}
export type HeroStarsConfig = GlobalConfig & Record<TierKey, number>;

export const HERO_STARS_COLOR_KEYS = ['colorStar', 'colorGold', 'colorLine', 'colorSky', 'colorPlayer', 'colorFoe'] as const;
export const HERO_STARS_CLIP_KEYS = ['sfxSkyClip', 'sfxTickClip', 'sfxLooseClip', 'sfxWhooshClip', 'sfxFallClip', 'sfxRiseClip', 'sfxBoomClip', 'sfxThrumClip'] as const;
export type HeroStarsStrKey = (typeof HERO_STARS_COLOR_KEYS)[number] | (typeof HERO_STARS_CLIP_KEYS)[number];
export type HeroStarsNumKey = Exclude<keyof HeroStarsConfig, HeroStarsStrKey>;

/** Per tier, I / II / III / IV. */
const TIER_DEFAULTS: Record<StarsTierSuffix, [number, number, number, number]> = {
  SkyMs: [260, 260, 300, 360],
  StepMs: [100, 56, 62, 52],
  AliveMs: [160, 140, 260, 220],
  DrawMs: [160, 300, 320, 360],
  HoldMs: [40, 120, 160, 640],
  FlyMs: [210, 220, 240, 620],
  Size: [1.3, 1.25, 1, 1],
  Shake: [7, 10, 14, 26],
  Zoom: [0.022, 0.028, 0.034, 0.044],
  Punch: [0.03, 0.04, 0.055, 0.075],
  SettleMs: [480, 520, 620, 1700],
  Dim: [0.4, 0.42, 0.46, 0.52],
  Veil: [0.5, 0.54, 0.6, 0.72],
  SkyStars: [50, 64, 84, 130],
};

export const STARS_TIER_RANGES: Record<StarsTierSuffix, [number, number, number]> = {
  SkyMs: [80, 1200, 10],
  StepMs: [20, 300, 1],
  AliveMs: [0, 1000, 10],
  DrawMs: [0, 1200, 10],
  HoldMs: [0, 2000, 10],
  FlyMs: [80, 1500, 10],
  Size: [0.4, 2, 0.05],
  Shake: [0, 40, 0.5],
  Zoom: [0, 0.1, 0.002],
  Punch: [0, 0.15, 0.001],
  SettleMs: [200, 4000, 10],
  Dim: [0, 0.9, 0.01],
  Veil: [0, 0.9, 0.01],
  SkyStars: [0, 160, 1],
};

const tierDefaults = Object.fromEntries(TIERS.flatMap((t) => STARS_TIER_SUFFIXES.map((s) => [`t${t}${s}`, TIER_DEFAULTS[s][t - 1]]))) as Record<TierKey, number>;

export const HERO_STARS_DEFAULTS: HeroStarsConfig = {
  ...HERO_ATTACK_TIER_THRESHOLDS,
  absorbMs: 160,
  starPx: 46,
  lineWidth: 9,
  twinkle: 0.45,
  ghostAlpha: 0.32,
  portraitAlpha: 0.34,
  hunterSize: 4.3,
  medallionSize: 0.2,
  fallLen: 6.5,
  swell: 1.6,
  hush: 0.7,
  cometSize: 2.2,
  skyFlash: 0.36,
  scatterMs: 300,
  sparkFallMs: 1200,
  arrowPx: 230,
  trailWidth: 11,
  trailLingerMs: 700,
  impactSize: 1,
  skyHoldMs: 220,
  heroLiftPx: 8,
  knockPx: 24,
  squash: 0.09,
  shakeMs: 420,
  zoomOutMs: 420,
  reducedFadeMs: 260,
  colorStar: '#fff8e6',
  colorGold: '#ffe2a0',
  colorLine: '#b9cdfa',
  colorSky: '#0a1440',
  colorPlayer: '#ffe9b0',
  colorFoe: '#ff7a5c',
  sfxSkyClip: 'fx/stars-sky', sfxSkyGain: 1, sfxSkyRate: 1,
  sfxTickClip: 'fx/stars-tick', sfxTickGain: 0.6, sfxTickRate: 1,
  sfxLooseClip: 'fx/stars-loose', sfxLooseGain: 0.7, sfxLooseRate: 1,
  sfxWhooshClip: 'fx/whoosh-03', sfxWhooshGain: 0.7, sfxWhooshRate: 1.3,
  sfxWhooshStartMs: 420,
  sfxFallClip: 'fx/stars-fall', sfxFallGain: 1.2, sfxFallRate: 1,
  sfxFallHitMs: 1150,
  sfxHitGain: 0.8, sfxHitRate: 1.12,
  sfxRiseClip: 'fx/stars-rise', sfxRiseGain: 0.9, sfxRiseRate: 1,
  sfxBoomClip: 'fx/stars-boom', sfxBoomGain: 0.6, sfxBoomRate: 1,
  sfxThrumClip: 'fx/stars-release', sfxThrumGain: 0.7, sfxThrumRate: 1,
  sfxBloomGain: 0.5,
  sfxTailMix: 0.2,
  sfxDuck: 0.6,
  previewDamage: 12,
  previewParts: 4,
  ...tierDefaults,
};

const GLOBAL_RANGES: Record<Exclude<keyof GlobalConfig, HeroStarsStrKey>, [number, number, number]> = {
  tier2At: [2, 40, 1], tier3At: [2, 60, 1], tier4At: [2, 80, 1],
  absorbMs: [60, 600, 10],
  starPx: [12, 120, 1],
  lineWidth: [1, 24, 0.5],
  twinkle: [0, 1, 0.01],
  ghostAlpha: [0, 0.8, 0.01],
  portraitAlpha: [0, 1, 0.01],
  hunterSize: [2, 7, 0.1],
  medallionSize: [0.1, 0.3, 0.005],
  fallLen: [1.5, 9, 0.1],
  swell: [0, 5, 0.05],
  hush: [0, 1, 0.01],
  cometSize: [0.4, 3, 0.05],
  skyFlash: [0, 1, 0.01],
  scatterMs: [0, 1500, 10],
  sparkFallMs: [200, 3000, 10],
  arrowPx: [60, 500, 2],
  trailWidth: [1, 30, 0.5],
  trailLingerMs: [0, 2500, 10],
  impactSize: [0.3, 3, 0.05],
  skyHoldMs: [0, 1000, 10],
  heroLiftPx: [0, 40, 1],
  knockPx: [0, 60, 1],
  squash: [0, 0.3, 0.01],
  shakeMs: [0, 1500, 10],
  zoomOutMs: [60, 1500, 10],
  reducedFadeMs: [60, 1000, 10],
  sfxSkyGain: [0, 2, 0.05], sfxSkyRate: [0.5, 2.5, 0.01],
  sfxTickGain: [0, 2, 0.05], sfxTickRate: [0.5, 2.5, 0.01],
  sfxLooseGain: [0, 2, 0.05], sfxLooseRate: [0.5, 2.5, 0.01],
  sfxWhooshGain: [0, 2, 0.05], sfxWhooshRate: [0.5, 2.5, 0.01],
  sfxWhooshStartMs: [0, 2000, 10],
  sfxFallGain: [0, 2, 0.05], sfxFallRate: [0.5, 2.5, 0.01],
  sfxFallHitMs: [0, 4000, 10],
  sfxHitGain: [0, 2, 0.05], sfxHitRate: [0.5, 2.5, 0.01],
  sfxRiseGain: [0, 2, 0.05], sfxRiseRate: [0.5, 2.5, 0.01],
  sfxBoomGain: [0, 2, 0.05], sfxBoomRate: [0.5, 2.5, 0.01],
  sfxThrumGain: [0, 2, 0.05], sfxThrumRate: [0.5, 2.5, 0.01],
  sfxBloomGain: [0, 2, 0.05],
  sfxTailMix: [0, 1, 0.01],
  sfxDuck: [0, 1, 0.05],
  previewDamage: [1, 60, 1],
  previewParts: [1, 8, 1],
};

export const HERO_STARS_RANGES: Record<HeroStarsNumKey, [number, number, number]> = {
  ...GLOBAL_RANGES,
  ...(Object.fromEntries(TIERS.flatMap((t) => STARS_TIER_SUFFIXES.map((s) => [`t${t}${s}`, STARS_TIER_RANGES[s]]))) as Record<TierKey, [number, number, number]>),
};

/** Hard caps whatever the tuner says. */
export const STARS_CAPS = { skyStars: 160, shakePx: 40, zoom: 0.12 } as const;

const store = configStore<HeroStarsConfig>({
  key: 'ascent.herostars.v3', defaults: HERO_STARS_DEFAULTS, ranges: HERO_STARS_RANGES,
  colorKeys: HERO_STARS_COLOR_KEYS, clipKeys: HERO_STARS_CLIP_KEYS, previewKeys: ['previewDamage', 'previewParts'],
});
export const heroStarsStore = store;
export const getHeroStarsConfig = store.get;
export const clampHeroStarsValue = store.clamp;
export const sanitizeHeroStarsConfig = store.sanitize;
export const heroStarsConfigJson = store.json;
/** The preview speed hook (Recruit + the Collection read one per style). Always 1. */
export function heroStarsPreviewSpeed(): number { return 1; }

export function starsTierDials(tier: TierNum, c: HeroStarsConfig = store.get()): Record<StarsTierSuffix, number> {
  return Object.fromEntries(STARS_TIER_SUFFIXES.map((s) => [s, c[`t${tier}${s}`]])) as Record<StarsTierSuffix, number>;
}

// ─── the pure plan ─────────────────────────────────────────────────────────────────────────────────────────────

export type StarsKind = 'arrow' | 'bow' | 'hunter' | 'written';

export function starsKind(tier: TierNum): StarsKind { return tier === 1 ? 'arrow' : tier === 2 ? 'bow' : tier === 3 ? 'hunter' : 'written'; }

/** How many slots (edges drawn one after another) each look's trace takes. The geometry is built to match. */
export const STARS_SLOTS: Record<StarsKind, number> = { arrow: 3, bow: 8, hunter: 12, written: 18 };

export const STARS_REF_DISTANCE = 1600;

/** How much of the sky flash each look shows (IV the whole of `skyFlash`). */
export const STARS_FLASH = [0.22, 0.34, 0.55, 1] as const;

/** An arrow's flight scales gently with how far it has to go. */
export function starsLegMs(distance: number, ms: number): number {
  const d = Number.isFinite(distance) && distance > 0 ? distance : STARS_REF_DISTANCE;
  return Math.round(ms * clamp(Math.sqrt(d / STARS_REF_DISTANCE), 0.62, 1.15));
}

export interface StarsPlanInput extends AttackTierContext {
  leadIn?: number;
  total: number;
  distance: number;
  reduced?: boolean;
}

export interface StarsPlan {
  reduced: boolean;
  tier: TierNum;
  kind: StarsKind;
  k: number;
  total: number;
  /** The Knockout remix of IV (a prismatic ring of stardust, a bigger shake, the KO sting). */
  ko: boolean;
  /** The sky arrives. */
  chargeAt: number;
  absorbEnd: number;
  /** The first star lights; edge slot `n` is drawn over `[traceAt + n * stepMs, traceAt + (n + 1) * stepMs]`. */
  traceAt: number;
  stepMs: number;
  slots: number;
  /** The figure is whole: it brightens (comes alive). */
  tracedAt: number;
  /** The bow draws (I: the arrow pulls back; IV: the arm reaches and the star is plucked). */
  drawAt: number;
  /** The draw is full; it holds until `looseAt`. */
  holdAt: number;
  /** The arrow leaves (IV: the star detaches and falls). */
  looseAt: number;
  impactAt: number;
  /** IV: the constellation's lines break into falling sparks (the other looks: never, `Infinity`). */
  scatterAt: number;
  /** The sky starts to fade. */
  outAt: number;
  endAt: number;
  /** The flash on the sky on the blow (peak opacity). */
  flash: number;
  size: number;
  shakePx: number;
  zoom: number;
  punch: number;
  dim: number;
  veil: number;
  skyStars: number;
}

/** The whole attack, in base ms. Pure and deterministic. */
export function starsPlan(input: StarsPlanInput, c: HeroStarsConfig = store.get()): StarsPlan {
  const total = Math.max(0, Math.round(input.total));
  const tier = attackTier(total, input, c); // a knockout always plays the shared Tier IV
  const kind = starsKind(tier);
  const ko = tier === 4 && isKnockoutVariant(input);
  const L = starsTierDials(tier, c);
  const slots = STARS_SLOTS[kind];
  const base = {
    tier, kind, k: (tier - 1) / 3, total, ko, slots, stepMs: Math.max(20, L.StepMs), size: L.Size,
    shakePx: clamp(L.Shake * (ko ? KO_SHAKE : 1), 0, STARS_CAPS.shakePx), zoom: clamp(L.Zoom, 0, STARS_CAPS.zoom), punch: L.Punch * (ko ? 1.2 : 1),
    dim: L.Dim, veil: L.Veil, skyStars: Math.round(clamp(L.SkyStars, 0, STARS_CAPS.skyStars)),
    flash: clamp01(c.skyFlash) * STARS_FLASH[tier - 1]!,
  };
  if (input.reduced) {
    const r = reducedAttackTimeline(input.leadIn ?? 0, c.reducedFadeMs);
    const at = r.impactAt;
    return {
      ...base, reduced: true, chargeAt: at, absorbEnd: at, traceAt: at, tracedAt: at, drawAt: at, holdAt: at, looseAt: at, impactAt: at, outAt: at,
      scatterAt: Infinity, endAt: r.endAt, size: 0, shakePx: 0, zoom: 0, punch: 0, dim: 0, veil: 0, skyStars: 0, flash: 0,
    };
  }
  const chargeAt = Math.max(0, input.leadIn ?? 0);
  const absorbEnd = chargeAt + c.absorbMs;
  const traceAt = chargeAt + Math.max(L.SkyMs, 80);
  const tracedAt = traceAt + slots * base.stepMs;
  const drawAt = tracedAt + Math.max(0, L.AliveMs);
  const holdAt = drawAt + Math.max(0, L.DrawMs);
  const looseAt = holdAt + Math.max(0, L.HoldMs);
  // The arrows cross the board (a longer board, a slightly longer flight); the star's fall is its own fixed length.
  const impactAt = looseAt + (kind === 'written' ? Math.max(80, Math.round(L.FlyMs)) : starsLegMs(input.distance, L.FlyMs));
  const endAt = impactAt + Math.max(200, L.SettleMs);
  // IV: the lines flare, then scatter; the night holds while the sparks drift, and fades over the rest.
  const scatterAt = kind === 'written' ? Math.min(endAt - 200, impactAt + Math.max(0, c.scatterMs)) : Infinity;
  const outAt = kind === 'written'
    ? Math.min(endAt - 120, scatterAt + Math.max(0, c.sparkFallMs) * 0.4)
    : Math.min(endAt - 120, impactAt + Math.max(0, c.skyHoldMs));
  return { ...base, reduced: false, chargeAt, absorbEnd, traceAt, tracedAt, drawAt, holdAt, looseAt, impactAt, scatterAt, outAt, endAt };
}

/** When edge slot `n` starts. */
export function slotAt(p: StarsPlan, slot: number): number { return p.traceAt + slot * p.stepMs; }

// ─── the geometry (pure) ───────────────────────────────────────────────────────────────────────────────────────

export type Box = { x: number; y: number; w: number; h: number };

/**
 * One constellation star: where it rests, how far it moves at full draw (`px`, `py`: the string star, the arrow, the
 * bow tips, the reaching arm), its size, the slot it lights in, and whether it belongs to the ARROW (those leave with
 * the shot) or is the star that gets PLUCKED (IV).
 */
export interface FigStar { x: number; y: number; px: number; py: number; size: number; slot: number; arrow: boolean; pluck: boolean }
/** One line: from star `a` to star `b`, drawn on over slot `slot`. `limb`: part of the body (III's ghost fills it). `soft`: a fainter line (IV's bust, over the portrait). */
export interface FigEdge { a: number; b: number; slot: number; limb: boolean; arrow: boolean; soft: boolean }

export interface StarFigure {
  kind: StarsKind;
  /** The middle of the figure (the camera rests on it while it is traced). */
  centre: Pt;
  /** The figure's own unit (px): the arrow's and the bow's is the striking radius, the hunter's its height, IV's the medallion radius. */
  unit: number;
  /** Which way the figure aims (radians). */
  aim: number;
  facing: 1 | -1;
  stars: FigStar[];
  edges: FigEdge[];
  /** Where the shot leaves from (the arrow's head at full draw; IV: the plucked star) and where it lands. */
  shotFrom: Pt;
  shotTo: Pt;
  /** The shot's path is a quadratic curve through this control point (the arrows: the midpoint, a straight line). */
  shotCtrl: Pt;
  /** IV: the comet is thrown in an arc over the top of the sky (no sky above the struck hero to fall through). */
  arc: boolean;
  /** How long the figure's own arrow is (px): the loosed arrow of starlight is drawn the same length. 0 for IV. */
  arrowLen: number;
  /** III: the head star and the torso's three stars (the ghost body), else -1 / []. */
  head: number;
  torso: number[];
  /** IV: the medallion (the portrait ghost sits inside it). */
  medallion: { x: number; y: number; r: number } | null;
  /** IV: the star that is plucked, else -1. */
  pluck: number;
}

interface StarOpts { pull?: Pt; arrow?: boolean; pluck?: boolean }

function builder(): {
  stars: FigStar[]; edges: FigEdge[];
  star: (p: Pt, size?: number, o?: StarOpts) => number;
  stroke: (slot: number, path: readonly number[], o?: { limb?: boolean; arrow?: boolean; soft?: boolean }) => void;
} {
  const stars: FigStar[] = [], edges: FigEdge[] = [];
  const star = (p: Pt, size = 1, o: StarOpts = {}): number => {
    stars.push({ x: p.x, y: p.y, px: o.pull?.x ?? 0, py: o.pull?.y ?? 0, size, slot: Infinity, arrow: !!o.arrow, pluck: !!o.pluck });
    return stars.length - 1;
  };
  // A stroke: the pen starts on `path[0]` (lighting it if nothing has yet) and draws one edge per slot.
  const stroke = (slot: number, path: readonly number[], o: { limb?: boolean; arrow?: boolean; soft?: boolean } = {}): void => {
    const first = stars[path[0]!]!;
    if (slot < first.slot) first.slot = slot;
    for (let i = 1; i < path.length; i++) {
      edges.push({ a: path[i - 1]!, b: path[i]!, slot: slot + i - 1, limb: !!o.limb, arrow: !!o.arrow, soft: !!o.soft });
      const to = stars[path[i]!]!;
      if (slot + i < to.slot) to.slot = slot + i;
    }
  };
  return { stars, edges, star, stroke };
}

const unitTo = (a: Pt, b: Pt): Pt => { const L = Math.hypot(b.x - a.x, b.y - a.y) || 1; return { x: (b.x - a.x) / L, y: (b.y - a.y) / L }; };

/**
 * Where a figure of half-size (`hw`, `hh`) sits: ABOVE the striking hero when there is sky above it; when the hero is
 * at the top of the screen (the foe's portrait) the figure cannot fit above, so it slides beside the portrait, toward
 * the other hero. Always whole on screen.
 */
export function placeFigure(a: Pt, aRadius: number, hw: number, hh: number, toward: Pt, bounds: Box): Pt {
  const m = Math.min(bounds.w, bounds.h) * 0.025;
  const gap = aRadius * 0.22;
  const fit = (p: Pt): Pt => ({
    x: clamp(p.x, bounds.x + m + hw, Math.max(bounds.x + m + hw, bounds.x + bounds.w - m - hw)),
    y: clamp(p.y, bounds.y + m + hh, Math.max(bounds.y + m + hh, bounds.y + bounds.h - m - hh)),
  });
  const above = fit({ x: a.x, y: a.y - aRadius - gap - hh });
  if (a.y - above.y >= aRadius + hh + gap * 0.5) return above;
  const dir = toward.x >= a.x ? 1 : -1;
  return fit({ x: a.x + dir * (aRadius + gap + hw), y: above.y });
}

/** Slide a whole figure back on screen (a safety net: the placement already fits it). */
function fitFigure(stars: FigStar[], pts: Pt[], bounds: Box): void {
  const m = Math.min(bounds.w, bounds.h) * 0.015;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const s of stars) {
    if (s.pluck) continue;
    x0 = Math.min(x0, s.x, s.x + s.px); x1 = Math.max(x1, s.x, s.x + s.px);
    y0 = Math.min(y0, s.y, s.y + s.py); y1 = Math.max(y1, s.y, s.y + s.py);
  }
  let dx = 0, dy = 0;
  if (x1 - x0 <= bounds.w - 2 * m) dx = x0 < bounds.x + m ? bounds.x + m - x0 : x1 > bounds.x + bounds.w - m ? bounds.x + bounds.w - m - x1 : 0;
  if (y1 - y0 <= bounds.h - 2 * m) dy = y0 < bounds.y + m ? bounds.y + m - y0 : y1 > bounds.y + bounds.h - m ? bounds.y + bounds.h - m - y1 : 0;
  if (!dx && !dy) return;
  for (const s of stars) if (!s.pluck) { s.x += dx; s.y += dy; }
  for (const p of pts) { p.x += dx; p.y += dy; }
}

export interface FigureInput { attacker: Pt; defender: Pt; radius: number; attackerRadius: number; bounds: Box }

/** I: three stars in a row, aimed at the struck hero, with two small barb stars at the head. */
function arrowFigure(p: StarsPlan, i: FigureInput): StarFigure {
  const U = i.attackerRadius * p.size;
  const c = placeFigure(i.attacker, i.attackerRadius, 1.65 * U, 1.65 * U, i.defender, i.bounds);
  const aim = Math.atan2(i.defender.y - c.y, i.defender.x - c.x);
  const cos = Math.cos(aim), sin = Math.sin(aim);
  const L = (x: number, y: number): Pt => ({ x: c.x + (x * cos - y * sin) * U, y: c.y + (x * sin + y * cos) * U });
  const pull = { x: -0.34 * U * cos, y: -0.34 * U * sin };
  const b = builder();
  const tail = b.star(L(-1.25, 0), 0.9, { pull, arrow: true });
  const mid = b.star(L(-0.15, 0), 0.75, { pull, arrow: true });
  const head = b.star(L(1.25, 0), 1.2, { pull, arrow: true });
  const b1 = b.star(L(0.8, -0.32), 0.5, { pull, arrow: true });
  const b2 = b.star(L(0.8, 0.32), 0.5, { pull, arrow: true });
  b.stroke(0, [tail, mid, head], { arrow: true });
  b.stroke(2, [head, b1], { arrow: true });
  b.stroke(2, [head, b2], { arrow: true });
  const shotFrom = L(1.25 - 0.34, 0);
  const pts = [c, shotFrom];
  fitFigure(b.stars, pts, i.bounds);
  return { kind: 'arrow', arrowLen: 2.5 * U, centre: c, unit: U, aim, facing: cos >= 0 ? 1 : -1, stars: b.stars, edges: b.edges, ...straightShot(shotFrom, i), head: -1, torso: [], medallion: null, pluck: -1 };
}

/** II: a bow of five stars, its string through a nock star, and a two-star arrow on the string. */
function bowFigure(p: StarsPlan, i: FigureInput): StarFigure {
  const U = i.attackerRadius * p.size;
  const c = placeFigure(i.attacker, i.attackerRadius, 1.55 * U, 1.55 * U, i.defender, i.bounds);
  const aim = Math.atan2(i.defender.y - c.y, i.defender.x - c.x);
  const cos = Math.cos(aim), sin = Math.sin(aim);
  const L = (x: number, y: number): Pt => ({ x: c.x + (x * cos - y * sin) * U, y: c.y + (x * sin + y * cos) * U });
  const V = (x: number, y: number): Pt => ({ x: (x * cos - y * sin) * U, y: (x * sin + y * cos) * U });
  const b = builder();
  const RB = 1.35, DRAW = 0.85;
  const limb = [-64, -32, 0, 32, 64].map((deg, k) => {
    const th = (deg * Math.PI) / 180;
    const flex = k === 0 ? V(-0.13, 0.09) : k === 4 ? V(-0.13, -0.09) : k === 1 ? V(-0.04, 0.03) : k === 3 ? V(-0.04, -0.03) : V(0, 0);
    return b.star(L(RB * Math.cos(th) - RB * 0.45 - 0.5, RB * Math.sin(th)), k === 2 ? 1 : k === 0 || k === 4 ? 0.9 : 0.7, { pull: flex });
  });
  const tipX = RB * Math.cos((64 * Math.PI) / 180) - RB * 0.45 - 0.5;
  const back = V(-DRAW, 0);
  const nock = b.star(L(tipX, 0), 0.85, { pull: back });
  const mid = b.star(L(tipX + 0.95, 0), 0.6, { pull: back, arrow: true });
  const head = b.star(L(tipX + 1.9, 0), 1.2, { pull: back, arrow: true });
  b.stroke(0, limb);
  b.stroke(4, [limb[4]!, nock]);
  b.stroke(5, [nock, limb[0]!]);
  b.stroke(6, [nock, mid, head], { arrow: true });
  const shotFrom = L(tipX + 1.9 - DRAW, 0);
  const pts = [c, shotFrom];
  fitFigure(b.stars, pts, i.bounds);
  return { kind: 'bow', arrowLen: 1.9 * U, centre: c, unit: U, aim, facing: cos >= 0 ? 1 : -1, stars: b.stars, edges: b.edges, ...straightShot(shotFrom, i), head: -1, torso: [], medallion: null, pluck: -1 };
}

/** III: the archer, upright in a braced stance, facing the struck hero; its bow arm and bow aim at it. */
function hunterFigure(p: StarsPlan, i: FigureInput, c0: HeroStarsConfig): StarFigure {
  const H = Math.min(c0.hunterSize * i.attackerRadius, i.bounds.h * 0.5) * p.size;
  const c = placeFigure(i.attacker, i.attackerRadius, 0.47 * H, 0.5 * H, i.defender, i.bounds);
  const f: 1 | -1 = i.defender.x >= c.x ? 1 : -1;
  const P = (x: number, y: number): Pt => ({ x: c.x + f * x * H, y: c.y + y * H });
  const shF = P(0.07, -0.29), shB = P(-0.09, -0.28);
  // The bow arm aims at the struck hero, within what an upright archer can do.
  const v = unitTo(shF, i.defender);
  const el = clamp(Math.atan2(v.y, Math.abs(v.x)), -0.95, 0.85);
  const ax = f * Math.cos(el), ay = Math.sin(el);
  const nx = -ay * f, ny = ax * f; // "down the bow" in the archer's own frame
  const hand = { x: shF.x + ax * 0.27 * H, y: shF.y + ay * 0.27 * H };
  const B = (along: number, across: number): Pt => ({ x: hand.x + (ax * along + nx * across) * H, y: hand.y + (ay * along + ny * across) * H });
  const W = (along: number, across: number): Pt => ({ x: (ax * along + nx * across) * H, y: (ay * along + ny * across) * H });
  const DRAW = 0.25;
  const back = W(-DRAW, 0);
  const nockRest = B(-0.08, 0);
  const elbowRest = { x: (shB.x + nockRest.x) / 2, y: (shB.y + nockRest.y) / 2 + 0.06 * H };
  const elbowDrawn = { x: shB.x - ax * 0.16 * H, y: shB.y - ay * 0.16 * H - 0.03 * H };
  const b = builder();
  const head = b.star(P(0, -0.43), 1.15);
  const sF = b.star(shF, 0.85), sB = b.star(shB, 0.85);
  const hip = b.star(P(-0.02, 0.02), 0.8);
  const kneeF = b.star(P(0.13, 0.24), 0.6), footF = b.star(P(0.24, 0.47), 0.8);
  const kneeB = b.star(P(-0.14, 0.25), 0.6), footB = b.star(P(-0.27, 0.47), 0.8);
  const bowHand = b.star(hand, 0.9);
  const midT = b.star(B(-0.02, -0.12), 0.55), tipT = b.star(B(-0.08, -0.23), 0.8, { pull: W(-0.03, 0.02) });
  const midB = b.star(B(-0.02, 0.12), 0.55), tipB = b.star(B(-0.08, 0.23), 0.8, { pull: W(-0.03, -0.02) });
  const nock = b.star(nockRest, 0.75, { pull: back });
  const elbow = b.star(elbowRest, 0.6, { pull: { x: elbowDrawn.x - elbowRest.x, y: elbowDrawn.y - elbowRest.y } });
  const tip = b.star(B(0.34, 0), 1.15, { pull: back, arrow: true });
  b.stroke(0, [head, sF, sB], { limb: true });
  b.stroke(2, [sF, bowHand], { limb: true });
  b.stroke(3, [bowHand, midT, tipT]);
  b.stroke(3, [bowHand, midB, tipB]);
  b.stroke(5, [tipT, nock]);
  b.stroke(5, [tipB, nock]);
  b.stroke(6, [sB, elbow, nock], { limb: true });
  b.stroke(8, [nock, tip], { arrow: true });
  b.stroke(9, [sF, hip], { limb: true });
  b.stroke(9, [sB, hip], { limb: true });
  b.stroke(10, [hip, kneeF, footF], { limb: true });
  b.stroke(10, [hip, kneeB, footB], { limb: true });
  const shotFrom = B(0.34 - DRAW, 0);
  const pts = [c, shotFrom];
  fitFigure(b.stars, pts, i.bounds);
  return { kind: 'hunter', arrowLen: 0.42 * H, centre: c, unit: H, aim: Math.atan2(ay, ax), facing: f, stars: b.stars, edges: b.edges, ...straightShot(shotFrom, i), head, torso: [sF, sB, hip], medallion: null, pluck: -1 };
}

/**
 * Where IV's star is plucked from, and the path it falls on.
 *  - Sky ABOVE the struck hero (the foe striking you): it is plucked from straight above and falls straight DOWN, as
 *    far as `fallLen` radii or the top of the sky allows.
 *  - NO sky above (you striking the foe, whose portrait sits on the top edge): it is plucked from the FAR side of the
 *    sky (beyond the medallion, away from the struck hero) and thrown in an ARC over the top of the sky: it climbs,
 *    crosses above the medallion and comes DOWN onto the portrait. The whole sky is its path.
 * Either way it ARRIVES moving downward, never up.
 */
export function pluckPoint(d: Pt, radius: number, fallLen: number, medallion: { x: number; y: number; r: number }, bounds: Box): { p: Pt; ctrl: Pt; arc: boolean } {
  const len = Math.max(radius, fallLen * radius);
  const top = bounds.y + bounds.h * 0.05;
  const room = d.y - top;
  if (room >= Math.min(len, bounds.h * 0.4) * 0.75) {
    const p = { x: d.x, y: d.y - Math.min(room, len) };
    return { p, ctrl: { x: d.x, y: (p.y + d.y) / 2 }, arc: false };
  }
  const side = medallion.x >= d.x ? 1 : -1;
  const m = bounds.w * 0.06;
  const p = {
    x: clamp(medallion.x + side * (medallion.r * 1.05 + bounds.w * 0.2), bounds.x + m, bounds.x + bounds.w - m),
    y: clamp(medallion.y + medallion.r * 0.3, top, bounds.y + bounds.h * 0.62),
  };
  // The top of the arc sits just inside the top of the sky; the control point is always above the struck hero, so the
  // comet comes down onto it.
  const peak = bounds.y + bounds.h * 0.07;
  const ctrl = { x: (p.x + d.x) / 2, y: Math.min(2 * peak - (p.y + d.y) / 2, d.y - radius * 0.9) };
  return { p, ctrl, arc: true };
}

/** IV: a medallion ring of twelve stars with a crown and a bust, and an arm of stars reaching for the plucked star. */
function writtenFigure(p: StarsPlan, i: FigureInput, c0: HeroStarsConfig): StarFigure {
  const bd = i.bounds;
  const R = clamp(bd.h * c0.medallionSize, i.radius * 0.9, bd.h * 0.3) * p.size;
  const mc = {
    x: clamp(bd.x + bd.w / 2 + (i.attacker.x - (bd.x + bd.w / 2)) * 0.1, bd.x + R * 1.2, bd.x + bd.w - R * 1.2),
    y: bd.y + bd.h * 0.045 + R * 1.5,
  };
  const M = (x: number, y: number): Pt => ({ x: mc.x + x * R, y: mc.y + y * R });
  const b = builder();
  const ring = Array.from({ length: 12 }, (_, k) => { const a = ((-90 + 30 * k) * Math.PI) / 180; return b.star(M(Math.cos(a), Math.sin(a)), k % 3 === 0 ? 0.95 : 0.7); });
  const crown = [b.star(M(0.36, -1.28), 0.8), b.star(M(0.17, -1.08), 0.45), b.star(M(0, -1.47), 1.05), b.star(M(-0.17, -1.08), 0.45), b.star(M(-0.36, -1.28), 0.8)];
  const top = b.star(M(0, -0.64), 0.5), right = b.star(M(0.19, -0.4), 0.42), chin = b.star(M(0, -0.14), 0.5), left = b.star(M(-0.19, -0.4), 0.42);
  const nL = b.star(M(-0.17, 0.07), 0.36), sL1 = b.star(M(-0.54, 0.2), 0.5), sL0 = b.star(M(-0.72, 0.54), 0.42);
  const nR = b.star(M(0.17, 0.07), 0.36), sR1 = b.star(M(0.54, 0.2), 0.5), sR0 = b.star(M(0.72, 0.54), 0.42);
  // The plucked star, and the arm that reaches for it from the nearest star of the ring.
  const pk = pluckPoint(i.defender, i.radius, c0.fallLen, { x: mc.x, y: mc.y, r: R }, bd);
  const P = pk.p;
  const ang = Math.atan2(P.y - mc.y, P.x - mc.x);
  const near = ((Math.round((ang * 180 / Math.PI + 90) / 30) % 12) + 12) % 12;
  const s0 = b.stars[ring[near]!]!;
  const from = { x: s0.x, y: s0.y };
  const u = unitTo(from, P);
  const reach = i.radius * 0.3;
  const handRest = { x: P.x - u.x * i.radius * 0.6, y: P.y - u.y * i.radius * 0.6 };
  const armLen = Math.hypot(handRest.x - from.x, handRest.y - from.y);
  // The elbow bends upward (whichever side of the arm that is).
  const up = u.x >= 0 ? { x: u.y, y: -u.x } : { x: -u.y, y: u.x };
  const ctrl = { x: (from.x + handRest.x) / 2 + up.x * armLen * 0.16, y: (from.y + handRest.y) / 2 + up.y * armLen * 0.16 };
  const q = (t: number): Pt => { const m = 1 - t; return { x: m * m * from.x + 2 * m * t * ctrl.x + t * t * handRest.x, y: m * m * from.y + 2 * m * t * ctrl.y + t * t * handRest.y }; };
  const arm1 = b.star(q(0.36), 0.6, { pull: { x: u.x * reach * 0.3, y: u.y * reach * 0.3 } });
  const arm2 = b.star(q(0.7), 0.6, { pull: { x: u.x * reach * 0.65, y: u.y * reach * 0.65 } });
  const hand = b.star(handRest, 0.95, { pull: { x: u.x * reach, y: u.y * reach } });
  const pluck = b.star(P, 1.5, { pluck: true });
  b.stars[pluck]!.slot = 0;
  b.stroke(0, [...ring, ring[0]!]);
  b.stroke(2, [ring[1]!, ...crown, ring[11]!]);
  b.stroke(8, [top, right, chin, left, top], { soft: true });
  b.stroke(12, [chin, nL, sL1, sL0], { soft: true });
  b.stroke(12, [chin, nR, sR1, sR0], { soft: true });
  b.stroke(15, [ring[near]!, arm1, arm2, hand]);
  // It lands a little short of the portrait's middle, along the line it arrives on.
  const fall = unitTo(pk.ctrl, i.defender);
  const shotTo = { x: i.defender.x - fall.x * i.radius * 0.15, y: i.defender.y - fall.y * i.radius * 0.15 };
  return {
    kind: 'written', arrowLen: 0, centre: mc, unit: R, aim: Math.atan2(fall.y, fall.x), facing: P.x >= mc.x ? 1 : -1, stars: b.stars, edges: b.edges,
    shotFrom: P, shotTo, shotCtrl: pk.ctrl, arc: pk.arc, head: -1, torso: [], medallion: { x: mc.x, y: mc.y, r: R }, pluck,
  };
}

/** An arrow's shot: a straight line from the bow to just short of the struck portrait's middle. */
function straightShot(from: Pt, i: FigureInput): { shotFrom: Pt; shotTo: Pt; shotCtrl: Pt; arc: boolean } {
  const u = unitTo(from, i.defender);
  const to = { x: i.defender.x - u.x * i.radius * 0.25, y: i.defender.y - u.y * i.radius * 0.25 };
  return { shotFrom: from, shotTo: to, shotCtrl: { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 }, arc: false };
}

/** Where the shot is at `u` along its path (0 the bow or the plucked star, 1 the struck hero). */
export function shotPoint(f: Pick<StarFigure, 'shotFrom' | 'shotCtrl' | 'shotTo'>, u: number): Pt {
  const m = 1 - u;
  return { x: m * m * f.shotFrom.x + 2 * m * u * f.shotCtrl.x + u * u * f.shotTo.x, y: m * m * f.shotFrom.y + 2 * m * u * f.shotCtrl.y + u * u * f.shotTo.y };
}

/** The unit direction the shot ARRIVES on (the camera's kick, the struck portrait's knock). */
export function shotArrival(f: Pick<StarFigure, 'shotCtrl' | 'shotTo' | 'shotFrom'>): Pt {
  const dx = f.shotTo.x - f.shotCtrl.x, dy = f.shotTo.y - f.shotCtrl.y;
  const L = Math.hypot(dx, dy);
  return L > 1e-6 ? { x: dx / L, y: dy / L } : unitTo(f.shotFrom, f.shotTo);
}

/** The look's constellation, placed from the two portraits and kept on screen. Pure. */
export function starFigure(p: StarsPlan, i: FigureInput, c: HeroStarsConfig = store.get()): StarFigure | null {
  if (p.reduced) return null;
  return p.kind === 'arrow' ? arrowFigure(p, i) : p.kind === 'bow' ? bowFigure(p, i) : p.kind === 'hunter' ? hunterFigure(p, i, c) : writtenFigure(p, i, c);
}

/** When star `i` lights. */
export function starLitAt(p: StarsPlan, f: StarFigure, i: number): number { return slotAt(p, f.stars[i]!.slot); }

// ─── the motion (pure) ─────────────────────────────────────────────────────────────────────────────────────────

const sine = (u: number): number => 0.5 - 0.5 * Math.cos(Math.PI * clamp01(u));
const springAt = (ms: number, hz: number, tau: number): number => (ms < 0 ? 0 : Math.exp(-ms / tau) * Math.cos(2 * Math.PI * hz * (ms / 1000)));

/**
 * How far the bow is drawn at `t` (0 at rest, 1 at full draw): it eases back through the draw, holds, and on the loose
 * the string SNAPS forward and rings out. Every moving star is `rest + pull * drawAmount`.
 */
export function drawAmount(p: StarsPlan, t: number): number {
  if (p.reduced || t < p.drawAt) return 0;
  if (t < p.holdAt) return sine((t - p.drawAt) / Math.max(1, p.holdAt - p.drawAt));
  if (t < p.looseAt) return 1;
  return springAt(t - p.looseAt, 11, 60);
}

/** How alive the figure is at `t` (0 while it is traced, 1 once it has brightened). */
export function aliveAmount(p: StarsPlan, t: number): number {
  if (p.reduced) return 0;
  return sine((t - p.tracedAt) / Math.max(60, p.drawAt - p.tracedAt));
}

/**
 * IV: how far the plucked star has SWOLLEN at `t` (0..1): it builds through the hold, slowly then fast, and is gone
 * with the loose (the comet takes over). 0 for the other looks.
 */
export function swellAmount(p: StarsPlan, t: number): number {
  if (p.reduced || p.kind !== 'written' || t < p.holdAt || t >= p.looseAt) return 0;
  const u = (t - p.holdAt) / Math.max(1, p.looseAt - p.holdAt);
  return 0.35 * sine(u) + 0.65 * u * u * u;
}

/**
 * IV: the sky holding its breath (0..1): every other star dims as the arm reaches and the star swells, stays dim while
 * the comet falls, and is released on the blow. 0 for the other looks.
 */
export function hushAmount(p: StarsPlan, t: number): number {
  if (p.reduced || p.kind !== 'written' || t < p.drawAt || t >= p.impactAt) return 0;
  return sine((t - p.drawAt) / Math.max(1, (p.looseAt - p.drawAt) * 0.8));
}

/** The constellation after the blow: its lines FLARE (0..1, a quick rise and a slower fall). IV flares hardest. */
export function flareAmount(p: StarsPlan, t: number): number {
  if (p.reduced || t < p.impactAt) return 0;
  const ms = t - p.impactAt;
  return ms < 70 ? ms / 70 : Math.exp(-(ms - 70) / (p.kind === 'written' ? 260 : 150));
}

/** How much of the constellation is still drawn (1 until IV's lines scatter into sparks, then quickly 0). */
export function figureAmount(p: StarsPlan, t: number): number {
  if (p.reduced) return 0;
  return t < p.scatterAt ? 1 : 1 - clamp01((t - p.scatterAt) / 140);
}

/** The sky's opacity at `t` (0..1): in through the opening, out after the blow. */
export function skyAmount(p: StarsPlan, t: number): number {
  if (p.reduced || t < p.chargeAt) return 0;
  const inA = sine((t - p.chargeAt) / Math.max(1, p.traceAt - p.chargeAt));
  const out = t <= p.outAt ? 1 : 1 - sine((t - p.outAt) / Math.max(1, p.endAt - p.outAt));
  return inA * out;
}

/** The shot at `t`: its phase and how far along its line it is (the arrow accelerates a touch; the star falls). */
export function shotAt(p: StarsPlan, t: number): { phase: 'nocked' | 'fly' | 'done'; u: number } {
  if (p.reduced || t < p.looseAt) return { phase: 'nocked', u: 0 };
  if (t >= p.impactAt) return { phase: 'done', u: 1 };
  const x = (t - p.looseAt) / Math.max(1, p.impactAt - p.looseAt);
  return { phase: 'fly', u: p.kind === 'written' ? x * x * (0.55 + 0.45 * x) : 0.25 * x + 0.75 * x * x };
}

export type StarsCueKind = 'sky' | 'star' | 'alive' | 'draw' | 'hold' | 'loose' | 'impact' | 'scatter' | 'end';
export interface StarsCue { at: number; kind: StarsCueKind; i: number }

export function starsCues(p: StarsPlan, f: StarFigure | null): StarsCue[] {
  const out: StarsCue[] = [];
  if (!p.reduced) {
    out.push({ at: p.chargeAt, kind: 'sky', i: 0 });
    if (f) f.stars.forEach((s, i) => { if (!s.pluck) out.push({ at: slotAt(p, s.slot), kind: 'star', i }); });
    out.push({ at: p.tracedAt, kind: 'alive', i: 0 });
    out.push({ at: p.drawAt, kind: 'draw', i: 0 });
    out.push({ at: p.holdAt, kind: 'hold', i: 0 });
    out.push({ at: p.looseAt, kind: 'loose', i: 0 });
  }
  out.push({ at: p.impactAt, kind: 'impact', i: 0 });
  if (!p.reduced && Number.isFinite(p.scatterAt)) out.push({ at: p.scatterAt, kind: 'scatter', i: 0 });
  out.push({ at: p.endAt, kind: 'end', i: 0 });
  const order: Record<StarsCueKind, number> = { sky: 0, star: 1, alive: 2, draw: 3, hold: 4, loose: 5, impact: 6, scatter: 7, end: 8 };
  return out.sort((a, b) => a.at - b.at || order[a.kind] - order[b.kind] || a.i - b.i);
}

// ─── the camera (pure) ─────────────────────────────────────────────────────────────────────────────────────────

/**
 * The camera: a slow push in while the figure is traced (looking up at the sky), a little more through the draw, a
 * small kick on the loose, and a punch and a shake on the blow that grow with the tier. IV: the view keeps creeping in
 * while the star swells (the held breath), and the blow is a real hit: a hard shake along the comet's line that takes
 * longer to die, over a slower sway.
 */
export function starsCameraAt(p: StarsPlan, c: HeroStarsConfig, t: number, dir: Pt = { x: 1, y: 0 }): { zoom: number; x: number; y: number } {
  if (p.reduced) return { zoom: 1, x: 0, y: 0 };
  let z = 0;
  if (t >= p.chargeAt && t < p.impactAt) {
    z += p.zoom * sine((t - p.chargeAt) / Math.max(1, p.tracedAt - p.chargeAt));
    z += p.zoom * 0.4 * Math.max(0, Math.min(1, drawAmount(p, Math.min(t, p.looseAt - 1))));
    if (p.kind === 'written' && t > p.holdAt) z += p.zoom * 0.7 * sine((t - p.holdAt) / Math.max(1, p.looseAt - p.holdAt));
  } else if (t >= p.impactAt) {
    z += (p.zoom * 1.4 + p.punch) * Math.exp(-(t - p.impactAt) / Math.max(1, c.zoomOutMs / 4));
  }
  let x = 0, y = 0;
  const kick = (at: number, amp: number, tau: number, hz: number): void => { const s = springAt(t - at, hz, tau); x += dir.x * amp * s; y += dir.y * amp * s; };
  kick(p.looseAt, -p.shakePx * 0.2, 45, 14);
  kick(p.impactAt, p.shakePx, Math.max(1, (c.shakeMs * (1 + 0.5 * p.k)) / 4), 15 - 3 * p.k);
  // A second, slower sway across the line of the hit (the bigger the look, the more of it): a body under the rattle.
  if (t >= p.impactAt) { const ms = t - p.impactAt; const sw = Math.exp(-ms / Math.max(1, c.shakeMs * 0.45)) * Math.sin(2 * Math.PI * 3.2 * (ms / 1000)) * p.shakePx * 0.35 * p.k; x -= dir.y * sw; y += dir.x * sw; }
  return { zoom: 1 + Math.max(0, z), x, y };
}

/** The anchor: the constellation while it is traced and drawn, gliding to the struck hero with the shot. */
export function starsCameraFocus(p: StarsPlan, t: number, figure: Pt, d: Pt): Pt {
  if (t <= p.looseAt) return figure;
  if (t < p.impactAt) { const e = sine((t - p.looseAt) / Math.max(1, p.impactAt - p.looseAt)); return { x: figure.x + (d.x - figure.x) * e, y: figure.y + (d.y - figure.y) * e }; }
  return d;
}
