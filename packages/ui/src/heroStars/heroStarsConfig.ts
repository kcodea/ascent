/**
 * THE WRITTEN IN THE STARS HERO ATTACK ("Written in the Stars"; ANCIENT rarity; dev-only, no cosmetic yet): its tuned
 * values, its pure timeline, the pure constellation geometry, the variations, the draw and the pure camera.
 *
 * THE SIGNATURE is CONSTELLATIONS. The board dims to a night sky, stars appear, and thin lines CONNECT them one by one
 * into a figure that then comes alive and strikes. The drawing-on of the lines, star by star, is the whole charm; no
 * other attack draws line figures in the sky. Everything is cold white-gold starlight on blue-black: never fire (the
 * Inferno owns meteors and fire), never clock hands.
 *
 * FOUR LOOKS on the shared thresholds (`attackTier`: a knockout always plays Tier 4), and VARIATIONS rolled per blow
 * from the stable `rollSeed` (`starsVariant`; the DEV tuner can force each one):
 *  - Tier 1, THE ARROW: three stars link into an arrow (two small barb stars at its head) that looses itself.
 *  - Tier 2, THE BOW: eight stars link into a bow with a nocked arrow; the bow DRAWS, holds and looses.
 *    Tiers 1 and 2 roll WHERE the figure is traced (`STARS_LAUNCHES`): beside the striker, high above the board, from
 *    beneath the board, right under (or over) the struck hero, or from the most open part of the sky left (often a
 *    corner). Each place has its own sound accents.
 *  - Tier 3 rolls one of three figures (`STARS_FIGURES3`): THE HUNTER (an archer draws and shoots), THE WOLF (it
 *    crouches, leaps along an arc and pounces, bursting into stardust on the struck hero) or THE SERPENT (it coils back
 *    and strikes, its body stretching across the sky).
 *  - Tier 4 rolls one of four finishers (`STARS_FIGURES4`): WRITTEN IN THE STARS (the striker's own portrait as a
 *    medallion plucks a star that falls as a comet), THE WHEEL (a great wheel of stars turns, slows and locks onto the
 *    struck hero, then fires a beam), THE GIANT (a constellation giant traced from its feet up across the whole sky
 *    raises its fist and brings it down) or THE NOVA (a sigil is traced over the struck hero, every star in the sky
 *    streams into one point over it, and the point falls and explodes).
 *
 * EVERY SHOT travels on a PATH (a quadratic curve; a straight line for the arrows and the beam): a bright head and a
 * luminous tail that hangs along the path after the blow. Some figures RIDE their own shot (the wolf, the serpent's
 * head, the giant's fist): their stars move with it. EVERY BLOW is a nova of stardust that expands and hangs, a flash on
 * the sky, the struck portrait rocked and the nearby stars jolted; all of it scales with the tier.
 *
 * A TRACE is made of STROKES: each stroke is a path of stars drawn edge by edge, one edge per SLOT (`StepMs` long). Two
 * strokes may share slots (two pens at once). A star lights the moment the first line reaches it. The slot count per
 * tier is fixed (`STARS_SLOTS`), so the timeline never depends on the geometry or the variation.
 *
 * THE CONTRACT: the consequence lands exactly ONCE, on the shot's arrival. The one clock is never scaled or held.
 * Reduced motion: fades only.
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
  /** Tier 3: the ghost body between the lines (peak opacity). */
  ghostAlpha: number;
  /** Tier 4: the striking hero's portrait inside the medallion (peak opacity). */
  portraitAlpha: number;
  /** Tier 3: the hunter's height (striking portrait radii; capped at half the screen). */
  hunterSize: number;
  /** Tier 4: the medallion's radius (a fraction of the screen height). */
  medallionSize: number;
  /** Tier 4: how far the star falls when there is sky above the struck hero (struck portrait radii; the sky caps it). */
  fallLen: number;
  /** Tier 4: how far the plucked star swells before it falls (x its own size). */
  swell: number;
  /** Tier 4: how far every other star dims while the plucked star swells (0 = not at all). */
  hush: number;
  /** Tier 4: the comet's head (struck portrait radii across). */
  cometSize: number;
  /** The flash on the sky on the blow (Tier 4's peak opacity; the lower looks flash a fraction of it). */
  skyFlash: number;
  /** Tier 4: after the blow, when the constellation's lines break into falling sparks. */
  scatterMs: number;
  /** Tier 4: how long the falling sparks drift. */
  sparkFallMs: number;
  /** The loosed arrow's least length (px at stage scale 1): it is drawn as long as the figure's own arrow, never shorter than this. */
  arrowPx: number;
  /** The luminous tail behind the arrow (px wide at the head, at I; wider on the higher looks, widest behind the comet). */
  trailWidth: number;
  /** How long the shot's line of light hangs along its path after the blow (Tiers 3 and 4 in full; Tiers 1 and 2 half). */
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
  /** The rising swell under the draw of the bow, and under Tier 4's star as it swells (its climax lands on the loose). */
  sfxRiseClip: string; sfxRiseGain: number; sfxRiseRate: number;
  /** The low body under every blow: Tier 4 plays the whole deep boom and its tail, the arrows its first moment, quieter and higher. */
  sfxBoomClip: string; sfxBoomGain: number; sfxBoomRate: number;
  /** The deep thrum of the bowstring under its snap (Tiers 1 to 3). */
  sfxThrumClip: string; sfxThrumGain: number; sfxThrumRate: number;
  /** Tier 4: how loudly the sky's shimmer blooms again under the landing (the stars answering). */
  sfxBloomGain: number;
  /** Tier 3, the wolf: a ghostly howl as it comes alive. */
  sfxHowlClip: string; sfxHowlGain: number; sfxHowlRate: number;
  /** Tier 3, the serpent: the hiss as it coils (its sharp end comes back on the strike). */
  sfxHissClip: string; sfxHissGain: number; sfxHissRate: number;
  /** Tier 4, the wheel: the great wheel turning and slowing to its lock (placed to end on it). */
  sfxGrindClip: string; sfxGrindGain: number; sfxGrindRate: number;
  /** Tier 4, the wheel: the beam. */
  sfxBeamClip: string; sfxBeamGain: number; sfxBeamRate: number;
  /** Tier 4, the giant: the deep rumble as it rises and raises its fist. */
  sfxRumbleClip: string; sfxRumbleGain: number; sfxRumbleRate: number;
  /** Tier 4, the nova: the sky drawn in (placed to end as the point lets go). */
  sfxImplodeClip: string; sfxImplodeGain: number; sfxImplodeRate: number;
  sfxTailMix: number;
  sfxDuck: number;
  previewDamage: number;
  previewParts: number;
  /** DEV: '' = rolled per blow; '1'..'5' force where Tiers 1 and 2 are traced (`STARS_LAUNCHES`). */
  launch: string;
  /** DEV: '' = rolled per blow; '1'..'3' force Tier 3's figure (`STARS_FIGURES3`). */
  figure3: string;
  /** DEV: '' = rolled per blow; '1'..'4' force Tier 4's finisher (`STARS_FIGURES4`). */
  figure4: string;
}
export type HeroStarsConfig = GlobalConfig & Record<TierKey, number>;

export const HERO_STARS_COLOR_KEYS = ['colorStar', 'colorGold', 'colorLine', 'colorSky', 'colorPlayer', 'colorFoe'] as const;
export const HERO_STARS_CLIP_KEYS = [
  'sfxSkyClip', 'sfxTickClip', 'sfxLooseClip', 'sfxWhooshClip', 'sfxFallClip', 'sfxRiseClip', 'sfxBoomClip', 'sfxThrumClip',
  'sfxHowlClip', 'sfxHissClip', 'sfxGrindClip', 'sfxBeamClip', 'sfxRumbleClip', 'sfxImplodeClip',
] as const;
/** The DEV variation overrides (strings, so the tuner shows them as selects; never shipped in Copy JSON). */
export const HERO_STARS_VARIANT_KEYS = ['launch', 'figure3', 'figure4'] as const;
export type HeroStarsStrKey = (typeof HERO_STARS_COLOR_KEYS)[number] | (typeof HERO_STARS_CLIP_KEYS)[number] | (typeof HERO_STARS_VARIANT_KEYS)[number];
export type HeroStarsNumKey = Exclude<keyof HeroStarsConfig, HeroStarsStrKey>;

/** Per tier, 1 / 2 / 3 / 4. */
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
  sfxHowlClip: 'fx/stars-howl', sfxHowlGain: 0.8, sfxHowlRate: 1,
  sfxHissClip: 'fx/stars-hiss', sfxHissGain: 0.8, sfxHissRate: 1,
  sfxGrindClip: 'fx/stars-grind', sfxGrindGain: 0.9, sfxGrindRate: 1,
  sfxBeamClip: 'fx/stars-beam', sfxBeamGain: 0.9, sfxBeamRate: 1,
  sfxRumbleClip: 'fx/stars-rumble', sfxRumbleGain: 0.9, sfxRumbleRate: 1,
  sfxImplodeClip: 'fx/stars-implode', sfxImplodeGain: 0.9, sfxImplodeRate: 1,
  sfxTailMix: 0.2,
  sfxDuck: 0.6,
  previewDamage: 12,
  previewParts: 4,
  launch: '',
  figure3: '',
  figure4: '',
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
  sfxHowlGain: [0, 2, 0.05], sfxHowlRate: [0.5, 2.5, 0.01],
  sfxHissGain: [0, 2, 0.05], sfxHissRate: [0.5, 2.5, 0.01],
  sfxGrindGain: [0, 2, 0.05], sfxGrindRate: [0.5, 2.5, 0.01],
  sfxBeamGain: [0, 2, 0.05], sfxBeamRate: [0.5, 2.5, 0.01],
  sfxRumbleGain: [0, 2, 0.05], sfxRumbleRate: [0.5, 2.5, 0.01],
  sfxImplodeGain: [0, 2, 0.05], sfxImplodeRate: [0.5, 2.5, 0.01],
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
  key: 'ascent.herostars.v4', defaults: HERO_STARS_DEFAULTS, ranges: HERO_STARS_RANGES,
  colorKeys: HERO_STARS_COLOR_KEYS, clipKeys: [...HERO_STARS_CLIP_KEYS, ...HERO_STARS_VARIANT_KEYS], previewKeys: ['previewDamage', 'previewParts', ...HERO_STARS_VARIANT_KEYS],
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

// ─── the variations (pure) ─────────────────────────────────────────────────────────────────────────────────────

export type StarsKind = 'arrow' | 'bow' | 'hunter' | 'wolf' | 'serpent' | 'written' | 'wheel' | 'giant' | 'nova';

/** Where Tiers 1 and 2 trace their figure. */
export const STARS_LAUNCHES = ['striker', 'high', 'low', 'struck', 'open'] as const;
export type StarsLaunch = (typeof STARS_LAUNCHES)[number];
export const STARS_LAUNCH_NAMES: Record<StarsLaunch, string> = {
  striker: 'beside the striker', high: 'high above the board', low: 'from beneath the board', struck: 'right under (or over) the struck hero', open: 'from the most open sky left (often a corner)',
};
/** Tier 3's figures and Tier 4's finishers. */
export const STARS_FIGURES3 = ['hunter', 'wolf', 'serpent'] as const;
export const STARS_FIGURES4 = ['written', 'wheel', 'giant', 'nova'] as const;
export const STARS_KIND_NAMES: Record<StarsKind, string> = {
  arrow: 'the arrow', bow: 'the bow', hunter: 'the hunter', wolf: 'the wolf', serpent: 'the serpent',
  written: 'written in the stars', wheel: 'the wheel', giant: 'the giant', nova: 'the nova',
};

export interface StarsVariant { launch: StarsLaunch; fig3: (typeof STARS_FIGURES3)[number]; fig4: (typeof STARS_FIGURES4)[number] }

/** A stable hash of the roll seed with a salt per choice (each choice rolls on its own). */
function rollOf(rollSeed: number, salt: number, n: number): number {
  let h = (((Math.round(rollSeed) | 0) ^ Math.imul(salt, 0x9e3779b1)) ^ 0x5bd1e995) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return h % n;
}

/** The variation a blow plays: each DEV override when set, else rolled from the stable per-blow seed. Pure. */
export function starsVariant(rollSeed: number, c: HeroStarsConfig = store.get()): StarsVariant {
  const pick = <T>(list: readonly T[], forced: string, salt: number): T => {
    const n = Number(forced);
    return forced !== '' && Number.isInteger(n) && n >= 1 && n <= list.length ? list[n - 1]! : list[rollOf(rollSeed, salt, list.length)]!;
  };
  return { launch: pick(STARS_LAUNCHES, c.launch, 11), fig3: pick(STARS_FIGURES3, c.figure3, 23), fig4: pick(STARS_FIGURES4, c.figure4, 37) };
}

/** The look a tier plays under a variation (no variation: the hunter and written in the stars). */
export function starsKind(tier: TierNum, v?: StarsVariant): StarsKind {
  return tier === 1 ? 'arrow' : tier === 2 ? 'bow' : tier === 3 ? (v?.fig3 ?? 'hunter') : (v?.fig4 ?? 'written');
}

/** How many slots (edges drawn one after another) each look's trace takes. Fixed per tier; the geometry is built to match. */
export const STARS_SLOTS: Record<StarsKind, number> = { arrow: 3, bow: 8, hunter: 12, wolf: 12, serpent: 12, written: 18, wheel: 18, giant: 18, nova: 18 };

/** Each look's flight against its tier's Flight dial: the wolf's leap is slower, the serpent's strike and the beam faster. */
export const STARS_KIND_FLY: Record<StarsKind, number> = { arrow: 1, bow: 1, hunter: 1, wolf: 1.45, serpent: 0.75, written: 1, wheel: 0.3, giant: 0.62, nova: 0.5 };

/** The figures that RIDE their own shot and burst into stardust where it lands (the Tier 3 beasts). */
export const STARS_RIDERS: ReadonlySet<StarsKind> = new Set<StarsKind>(['wolf', 'serpent']);

export const STARS_REF_DISTANCE = 1600;

/** How much of the sky flash each tier shows (Tier 4 the whole of `skyFlash`). */
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
  /** The rolled variation (none: the hunter and written in the stars, traced beside the striker). */
  variant?: StarsVariant;
}

export interface StarsPlan {
  reduced: boolean;
  tier: TierNum;
  kind: StarsKind;
  k: number;
  total: number;
  /** The Knockout remix of Tier 4 (a prismatic ring of stardust, a bigger shake, the KO sting). */
  ko: boolean;
  /** Tiers 1 and 2: where the figure is traced. */
  launch: StarsLaunch;
  /** The sky arrives. */
  chargeAt: number;
  absorbEnd: number;
  /** The first star lights; edge slot `n` is drawn over `[traceAt + n * stepMs, traceAt + (n + 1) * stepMs]`. */
  traceAt: number;
  stepMs: number;
  slots: number;
  /** The figure is whole: it brightens (comes alive). */
  tracedAt: number;
  /** The bow draws (Tier 1: the arrow pulls back; Tier 4: the arm reaches and the star is plucked). */
  drawAt: number;
  /** The draw is full; it holds until `looseAt`. */
  holdAt: number;
  /** The arrow leaves (Tier 4: the star detaches and falls). */
  looseAt: number;
  impactAt: number;
  /** Tier 4 and the Tier 3 beasts: the constellation breaks into falling sparks (the others: never, `Infinity`). */
  scatterAt: number;
  /** Tier 4, the wheel: it has turned and LOCKS onto the struck hero (the others: `Infinity`). */
  lockAt: number;
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
  const tier = attackTier(total, input, c); // a knockout always plays the shared Tier 4
  const kind = starsKind(tier, input.variant);
  const ko = tier === 4 && isKnockoutVariant(input);
  const L = starsTierDials(tier, c);
  const slots = STARS_SLOTS[kind];
  const base = {
    tier, kind, k: (tier - 1) / 3, total, ko, slots, stepMs: Math.max(20, L.StepMs), size: L.Size, launch: input.variant?.launch ?? 'striker',
    shakePx: clamp(L.Shake * (ko ? KO_SHAKE : 1), 0, STARS_CAPS.shakePx), zoom: clamp(L.Zoom, 0, STARS_CAPS.zoom), punch: L.Punch * (ko ? 1.2 : 1),
    dim: L.Dim, veil: L.Veil, skyStars: Math.round(clamp(L.SkyStars, 0, STARS_CAPS.skyStars)),
    flash: clamp01(c.skyFlash) * STARS_FLASH[tier - 1]!,
  };
  if (input.reduced) {
    const r = reducedAttackTimeline(input.leadIn ?? 0, c.reducedFadeMs);
    const at = r.impactAt;
    return {
      ...base, reduced: true, chargeAt: at, absorbEnd: at, traceAt: at, tracedAt: at, drawAt: at, holdAt: at, looseAt: at, impactAt: at, outAt: at,
      scatterAt: Infinity, lockAt: Infinity, endAt: r.endAt, size: 0, shakePx: 0, zoom: 0, punch: 0, dim: 0, veil: 0, skyStars: 0, flash: 0,
    };
  }
  const chargeAt = Math.max(0, input.leadIn ?? 0);
  const absorbEnd = chargeAt + c.absorbMs;
  const traceAt = chargeAt + Math.max(L.SkyMs, 80);
  const tracedAt = traceAt + slots * base.stepMs;
  const drawAt = tracedAt + Math.max(0, L.AliveMs);
  const holdAt = drawAt + Math.max(0, L.DrawMs);
  const looseAt = holdAt + Math.max(0, L.HoldMs);
  // The arrows and the beasts cross the board (a longer board, a slightly longer flight); Tier 4's blow is its own length.
  const fly = L.FlyMs * STARS_KIND_FLY[kind];
  const impactAt = looseAt + (tier === 4 ? Math.max(80, Math.round(fly)) : starsLegMs(input.distance, fly));
  const endAt = impactAt + Math.max(200, L.SettleMs);
  // Tier 4: the lines flare, then scatter; the night holds while the sparks drift, and fades over the rest. The beasts
  // burst into stardust the moment they land.
  const scatterAt = tier === 4 ? Math.min(endAt - 200, impactAt + Math.max(0, c.scatterMs))
    : STARS_RIDERS.has(kind) ? Math.min(endAt - 200, impactAt + 90) : Infinity;
  const outAt = tier === 4
    ? Math.min(endAt - 120, scatterAt + Math.max(0, c.sparkFallMs) * 0.4)
    : Math.min(endAt - 120, impactAt + Math.max(0, c.skyHoldMs));
  // The wheel turns through the draw and about half the hold, slowing, and locks.
  const lockAt = kind === 'wheel' ? Math.round(holdAt + (looseAt - holdAt) * 0.45) : Infinity;
  return { ...base, reduced: false, chargeAt, absorbEnd, traceAt, tracedAt, drawAt, holdAt, looseAt, impactAt, scatterAt, lockAt, outAt, endAt };
}

/** When edge slot `n` starts. */
export function slotAt(p: StarsPlan, slot: number): number { return p.traceAt + slot * p.stepMs; }

// ─── the geometry (pure) ───────────────────────────────────────────────────────────────────────────────────────

export type Box = { x: number; y: number; w: number; h: number };

/**
 * One constellation star: where it rests, how far it moves at full draw (`px`, `py`: the string star, the arrow, the
 * bow tips, the reaching arm, the crouch, the coil, the raised fist, the sigil closing in), its size, the slot it lights
 * in, whether it belongs to the ARROW (those leave with the shot), is the star that gets PLUCKED (it leaves with the
 * shot too), how much it RIDES the shot (0 stays, 1 moves with the shot's head: the wolf, the serpent's head, the
 * giant's fist; after the loose a rider stays at full draw) and whether it SPINS with the wheel.
 */
export interface FigStar { x: number; y: number; px: number; py: number; size: number; slot: number; arrow: boolean; pluck: boolean; ride: number; spin: boolean }
/** One line: from star `a` to star `b`, drawn on over slot `slot`. `limb`: part of the body (Tier 3's ghost fills it). `soft`: a fainter line (Tier 4's bust, over the portrait). */
export interface FigEdge { a: number; b: number; slot: number; limb: boolean; arrow: boolean; soft: boolean }

/** The shot's head: an arrow of starlight, a comet, or a bright spark (a beast's nose, a fist, the head of a beam). */
export type ShotHead = 'arrow' | 'comet' | 'spark';

export interface StarFigure {
  kind: StarsKind;
  /** The middle of the figure (the camera rests on it while it is traced). */
  centre: Pt;
  /** The figure's own unit (px): the arrow's and the bow's is the striking radius, the hunter's its height, Tier 4's the medallion radius. */
  unit: number;
  /** Which way the figure aims (radians). */
  aim: number;
  facing: 1 | -1;
  stars: FigStar[];
  edges: FigEdge[];
  /** Where the shot leaves from (the arrow's head at full draw; Tier 4: the plucked star) and where it lands. */
  shotFrom: Pt;
  shotTo: Pt;
  /** The shot's path is a quadratic curve through this control point (the arrows: the midpoint, a straight line). */
  shotCtrl: Pt;
  /** Tier 4: the comet is thrown in an arc over the top of the sky (no sky above the struck hero to fall through). */
  arc: boolean;
  /** How long the figure's own arrow is (px): the loosed arrow of starlight is drawn the same length. 0 for Tier 4. */
  arrowLen: number;
  /** Tier 3: the head star and the torso's three stars (the ghost body), else -1 / []. */
  head: number;
  torso: number[];
  /** Tier 4: the medallion (the portrait ghost sits inside it). */
  medallion: { x: number; y: number; r: number } | null;
  /** Tier 4: the star that is plucked (written in the stars, the wheel's marker, the nova's point), else -1. */
  pluck: number;
  /** Tier 4: the star that CHARGES through the hold (swells, blazes, the sky leans toward it), else -1. */
  charge: number;
  /** The wheel: the point its stars turn about, and how far they turn in all (radians); else null / 0. */
  pivot: Pt | null;
  spinTurns: number;
  /** The wolf: its body tips along the curve of its leap. */
  tilt: boolean;
  /** The nova: every star in the sky streams into the charging star. */
  gather: boolean;
  /** What leads the shot. */
  lead: ShotHead;
}

interface StarOpts { pull?: Pt; arrow?: boolean; pluck?: boolean; ride?: number; spin?: boolean }

function builder(): {
  stars: FigStar[]; edges: FigEdge[];
  star: (p: Pt, size?: number, o?: StarOpts) => number;
  stroke: (slot: number, path: readonly number[], o?: { limb?: boolean; arrow?: boolean; soft?: boolean }) => void;
} {
  const stars: FigStar[] = [], edges: FigEdge[] = [];
  const star = (p: Pt, size = 1, o: StarOpts = {}): number => {
    stars.push({ x: p.x, y: p.y, px: o.pull?.x ?? 0, py: o.pull?.y ?? 0, size, slot: Infinity, arrow: !!o.arrow, pluck: !!o.pluck, ride: clamp01(o.ride ?? 0), spin: !!o.spin });
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

export interface FigureInput {
  attacker: Pt; defender: Pt; radius: number; attackerRadius: number; bounds: Box;
  /** Tiers 1 and 2: where the figure is traced (default: beside the striker). */
  launch?: StarsLaunch;
}

/** The parts of a figure every look but Tier 4's finishers leaves at rest. */
const PLAIN = { charge: -1, pivot: null, spinTurns: 0, tilt: false, gather: false } as const;

/**
 * Where Tiers 1 and 2 trace a figure of half-size (`hw`, `hh`), by launch: beside the striker (`placeFigure`), high
 * above the board between the two heroes, beneath the board, right under the struck hero (over it when there is no
 * room under it), or in the most OPEN part of the sky left: of a grid of places that cover neither portrait, the one
 * farthest from the other four (often a corner), so the five always read as five different places. Always whole on
 * screen, and slid off either portrait if it would cover it.
 */
export function launchCentre(launch: StarsLaunch, i: FigureInput, hw: number, hh: number): Pt {
  const b = i.bounds;
  const m = Math.min(b.w, b.h) * 0.025;
  const fit = (p: Pt): Pt => ({
    x: clamp(p.x, b.x + m + hw, Math.max(b.x + m + hw, b.x + b.w - m - hw)),
    y: clamp(p.y, b.y + m + hh, Math.max(b.y + m + hh, b.y + b.h - m - hh)),
  });
  const heroes = [{ p: i.attacker, r: i.attackerRadius }, { p: i.defender, r: i.radius }];
  // How much room a centre leaves round the two portraits (negative: the figure's box covers one).
  const room = (p: Pt): number => Math.min(...heroes.map((h) => Math.max(Math.abs(p.x - h.p.x) - hw, Math.abs(p.y - h.p.y) - hh) - h.r));
  // Slide a centre sideways (away from the portrait it covers) until it clears both portraits, if it can.
  const clear = (p: Pt): Pt => {
    let q = fit(p);
    for (let k = 0; k < 2 && room(q) < 0; k++) {
      const h = heroes.reduce((x, y) => (Math.hypot(q.x - x.p.x, q.y - x.p.y) - x.r < Math.hypot(q.x - y.p.x, q.y - y.p.y) - y.r ? x : y));
      const dir = q.x >= h.p.x ? 1 : -1;
      q = fit({ x: h.p.x + dir * (h.r + hw + m), y: q.y });
    }
    return q;
  };
  switch (launch) {
    case 'striker': return placeFigure(i.attacker, i.attackerRadius, hw, hh, i.defender, b);
    case 'high': return clear({ x: (i.attacker.x + i.defender.x) / 2, y: b.y });
    case 'low': return clear({ x: (i.attacker.x + i.defender.x) / 2, y: b.y + b.h });
    case 'struck': {
      const d = i.defender, gap = i.radius * 0.6;
      const under = fit({ x: d.x, y: d.y + i.radius + gap + hh });
      if (under.y - d.y >= i.radius + hh + gap * 0.5) return clear(under);
      const over = fit({ x: d.x, y: d.y - i.radius - gap - hh });
      if (d.y - over.y >= i.radius + hh + gap * 0.5) return clear(over);
      return clear({ x: d.x + (d.x > b.x + b.w / 2 ? -1 : 1) * (i.radius + gap + hw), y: d.y });
    }
    default: {
      const others = (['striker', 'high', 'low', 'struck'] as const).map((l) => launchCentre(l, i, hw, hh));
      let best: Pt | null = null, score = -Infinity;
      for (let gy = 0; gy <= 4; gy++) for (let gx = 0; gx <= 6; gx++) {
        const q = fit({ x: b.x + (b.w * gx) / 6, y: b.y + (b.h * gy) / 4 });
        if (room(q) < 0) continue;
        const sc = Math.min(...others.map((o) => Math.hypot(q.x - o.x, q.y - o.y)));
        if (sc > score + 1e-6) { score = sc; best = q; }
      }
      return best ?? others[1]!;
    }
  }
}

/** Tier 1: three stars in a row, aimed at the struck hero, with two small barb stars at the head. */
function arrowFigure(p: StarsPlan, i: FigureInput): StarFigure {
  const U = i.attackerRadius * p.size;
  const c = launchCentre(i.launch ?? 'striker', i, 1.65 * U, 1.65 * U);
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
  return { kind: 'arrow', arrowLen: 2.5 * U, centre: c, unit: U, aim, facing: cos >= 0 ? 1 : -1, stars: b.stars, edges: b.edges, ...straightShot(shotFrom, i), head: -1, torso: [], medallion: null, pluck: -1, ...PLAIN, lead: 'arrow' as const };
}

/** Tier 2: a bow of five stars, its string through a nock star, and a two-star arrow on the string. */
function bowFigure(p: StarsPlan, i: FigureInput): StarFigure {
  const U = i.attackerRadius * p.size;
  const c = launchCentre(i.launch ?? 'striker', i, 1.55 * U, 1.55 * U);
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
  return { kind: 'bow', arrowLen: 1.9 * U, centre: c, unit: U, aim, facing: cos >= 0 ? 1 : -1, stars: b.stars, edges: b.edges, ...straightShot(shotFrom, i), head: -1, torso: [], medallion: null, pluck: -1, ...PLAIN, lead: 'arrow' };
}

/** Tier 3: the archer, upright in a braced stance, facing the struck hero; its bow arm and bow aim at it. */
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
  return { kind: 'hunter', arrowLen: 0.42 * H, centre: c, unit: H, aim: Math.atan2(ay, ax), facing: f, stars: b.stars, edges: b.edges, ...straightShot(shotFrom, i), head, torso: [sF, sB, hip], medallion: null, pluck: -1, ...PLAIN, lead: 'arrow' };
}

/**
 * Where Tier 4's star is plucked from, and the path it falls on.
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

/** Tier 4: a medallion ring of twelve stars with a crown and a bust, and an arm of stars reaching for the plucked star. */
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
    ...PLAIN, charge: pluck, lead: 'comet',
  };
}

/**
 * A hop: a curve from `from` to `to` that rises `lift` of the way's length above the higher end, but never higher than
 * `top` (so whatever rides it stays on screen) and never sagging below the straight line.
 */
function hop(from: Pt, to: Pt, lift: number, top: number): Pt {
  const dist = Math.hypot(to.x - from.x, to.y - from.y);
  const midY = (from.y + to.y) / 2;
  const peak = Math.max(top, Math.min(from.y, to.y) - lift * dist);
  if (peak >= Math.min(from.y, to.y)) return { x: (from.x + to.x) / 2, y: midY };
  // The control height whose curve tops out exactly at `peak` (the quadratic's lowest y is (y0 y1 - c^2) / (y0 - 2c + y1)).
  return { x: (from.x + to.x) / 2, y: Math.min(midY, peak - Math.sqrt((from.y - peak) * (to.y - peak))) };
}

/** Where a shot lands: a little short of the struck portrait's middle, along the line it arrives on. */
function landing(ctrl: Pt, i: FigureInput, k: number): Pt {
  const u = unitTo(ctrl, i.defender);
  return { x: i.defender.x - u.x * i.radius * k, y: i.defender.y - u.y * i.radius * k };
}

/** Tier 3, THE WOLF: a running wolf of seventeen stars facing the struck hero. It crouches, LEAPS along an arc, tipping with it, and pounces. */
function wolfFigure(p: StarsPlan, i: FigureInput): StarFigure {
  const L = i.attackerRadius * 1.35 * p.size;
  const c = placeFigure(i.attacker, i.attackerRadius, 1.6 * L, 1.05 * L, i.defender, i.bounds);
  const f: 1 | -1 = i.defender.x >= c.x ? 1 : -1;
  const P = (x: number, y: number): Pt => ({ x: c.x + f * x * L, y: c.y + y * L });
  const b = builder();
  // The crouch: the body sinks and draws back; the paws stay planted.
  const S = (x: number, y: number, size: number, dy = 0.17, dx = 0.12): number => b.star(P(x, y), size, { pull: { x: -f * dx * L, y: dy * L }, ride: 1 });
  const nose = S(1.45, -0.3, 1.1, 0.22), brow = S(1.08, -0.55, 0.6, 0.22), ear = S(0.98, -0.95, 0.8, 0.22), nape = S(0.76, -0.5, 0.55, 0.2);
  const jaw = S(1.12, -0.12, 0.5, 0.2), throat = S(0.82, -0.08, 0.55, 0.18);
  const shoulder = S(0.5, -0.4, 0.85), back = S(-0.05, -0.34, 0.6), hip = S(-0.6, -0.4, 0.85), tailBase = S(-0.88, -0.44, 0.5);
  const tailTip = S(-1.5, -0.8, 0.85, 0.08, 0.04);
  const belly = S(-0.05, 0.04, 0.45, 0.14);
  const elbow = S(0.62, 0.1, 0.5, 0.1, 0.05), paw = S(0.84, 0.52, 0.75, 0, 0), paw2 = S(0.38, 0.52, 0.6, 0, 0);
  const knee = S(-0.4, 0.08, 0.5, 0.1, 0.05), hock = S(-0.74, 0.27, 0.45, 0.05, 0.02), hind = S(-0.54, 0.52, 0.75, 0, 0);
  b.stroke(0, [nose, brow, ear, nape]);
  b.stroke(0, [nose, jaw, throat]);
  b.stroke(2, [throat, belly]);
  b.stroke(3, [nape, shoulder, back, hip, tailBase, tailTip]);
  b.stroke(4, [shoulder, elbow, paw]);
  b.stroke(7, [hip, knee, hock, hind]);
  b.stroke(9, [belly, knee]);
  b.stroke(11, [elbow, paw2]);
  const st = b.stars[nose]!;
  const from = { x: st.x + st.px, y: st.y + st.py };
  const pts = [c, from];
  fitFigure(b.stars, pts, i.bounds);
  // The leap: an arc over the board, as high as the sky lets the wolf's ears stay on screen.
  const to0 = landing(from, i, 0.1);
  const ctrl = hop(from, to0, 0.3, i.bounds.y + 1.1 * L);
  const to = landing(ctrl, i, 0.1);
  return {
    kind: 'wolf', arrowLen: 0, centre: c, unit: L, aim: Math.atan2(to.y - from.y, to.x - from.x), facing: f, stars: b.stars, edges: b.edges,
    shotFrom: from, shotTo: to, shotCtrl: ctrl, arc: false, head: -1, torso: [], medallion: null, pluck: -1, ...PLAIN, tilt: true, lead: 'spark',
  };
}

/**
 * Tier 3, THE SERPENT: a rearing snake of thirteen stars, an S of a body under a head with a forked tongue, facing the
 * struck hero. It COILS back and STRIKES: the head rides the shot and the body stretches after it, the tail anchored.
 */
function serpentFigure(p: StarsPlan, i: FigureInput): StarFigure {
  const H = Math.min(4 * i.attackerRadius, i.bounds.h * 0.5) * p.size;
  // Over the striker, leaning out toward the struck hero (the figure is slid back on screen below).
  const c0 = placeFigure(i.attacker, i.attackerRadius, 0.46 * H, 0.5 * H, i.defender, i.bounds);
  const f: 1 | -1 = i.defender.x >= c0.x ? 1 : -1;
  const c = { x: c0.x + f * i.attackerRadius * 1.1, y: c0.y };
  const P = (x: number, y: number): Pt => ({ x: c.x + f * x * H, y: c.y + y * H });
  const b = builder();
  const S = (x: number, y: number, size: number, ride: number, cx = 0, cy = 0): number => b.star(P(x, y), size, { ride, pull: { x: f * cx * H, y: cy * H } });
  const tip = S(-0.3, 0.46, 0.5, 0), t1 = S(-0.06, 0.48, 0.6, 0), t2 = S(0.17, 0.4, 0.65, 0.03), t3 = S(0.21, 0.22, 0.65, 0.08, -0.01, 0.01);
  const t4 = S(0.02, 0.12, 0.65, 0.16, -0.02, 0.02), t5 = S(-0.17, 0.0, 0.7, 0.28, -0.04, 0.03), t6 = S(-0.19, -0.17, 0.7, 0.45, -0.07, 0.04);
  const neck = S(-0.07, -0.29, 0.75, 0.7, -0.11, 0.05);
  // A broad wedge of a head, a bright snout and a forked tongue.
  const headBack = S(-0.02, -0.43, 0.8, 1, -0.13, 0.05), crown = S(0.13, -0.48, 0.7, 1, -0.13, 0.05);
  const snout = S(0.33, -0.41, 1.15, 1, -0.13, 0.05), jaw = S(0.12, -0.33, 0.65, 1, -0.13, 0.05);
  const tongue1 = S(0.45, -0.45, 0.45, 1, -0.13, 0.05), tongue2 = S(0.45, -0.37, 0.45, 1, -0.13, 0.05);
  b.stroke(0, [tip, t1, t2, t3, t4, t5, t6, neck, headBack, crown, snout]);
  b.stroke(10, [snout, jaw, neck]);
  b.stroke(10, [snout, tongue1]);
  b.stroke(11, [snout, tongue2]);
  const st = b.stars[snout]!;
  const from = { x: st.x + st.px, y: st.y + st.py };
  const pts = [c, from];
  fitFigure(b.stars, pts, i.bounds);
  const to0 = landing(from, i, 0.2);
  const ctrl = hop(from, to0, 0.14, i.bounds.y + 0.06 * H);
  const to = landing(ctrl, i, 0.2);
  return {
    kind: 'serpent', arrowLen: 0, centre: c, unit: H, aim: Math.atan2(to.y - from.y, to.x - from.x), facing: f, stars: b.stars, edges: b.edges,
    shotFrom: from, shotTo: to, shotCtrl: ctrl, arc: false, head: -1, torso: [], medallion: null, pluck: -1, ...PLAIN, lead: 'spark',
  };
}

/**
 * Tier 4, THE WHEEL: a great wheel of stars over the board (a rim of twelve, a hub, six spokes, six marks round the rim like
 * the signs of a zodiac dial) with a bright MARKER on a tooth outside its rim, and a fixed pointer of three stars aimed
 * at the struck hero. It turns (one and a quarter turns, toward the struck hero), slows, and LOCKS with the marker in the
 * pointer's mouth; the marker charges and fires a beam along the pointer's line.
 */
function wheelFigure(p: StarsPlan, i: FigureInput): StarFigure {
  const bd = i.bounds;
  const R = clamp(bd.h * 0.235, i.radius * 0.9, bd.h * 0.27) * p.size;
  const pv = {
    x: clamp(bd.x + bd.w / 2, bd.x + R * 1.62, bd.x + bd.w - R * 1.62),
    y: clamp(bd.y + bd.h * 0.045 + R * 1.62, bd.y + R * 1.62, bd.y + bd.h - R * 1.62),
  };
  const u = unitTo(pv, i.defender);
  const dirA = Math.atan2(u.y, u.x);
  const f: 1 | -1 = i.defender.x >= pv.x ? 1 : -1;
  const turns = f * Math.PI * 2.5;
  // At rest the marker sits where a turn of `turns` brings it to the pointer.
  const restA = dirA - turns;
  const at = (a: number, r: number): Pt => ({ x: pv.x + Math.cos(a) * r * R, y: pv.y + Math.sin(a) * r * R });
  const b = builder();
  const ring = Array.from({ length: 12 }, (_, k) => b.star(at(restA + (k * Math.PI) / 6, 1), k % 2 === 0 ? 0.95 : 0.65, { spin: true }));
  const hub = b.star(pv, 1, { spin: true });
  const inner = Array.from({ length: 6 }, (_, k) => b.star(at(restA + (k * Math.PI) / 3, 0.5), 0.5, { spin: true }));
  const signs = Array.from({ length: 6 }, (_, k) => b.star(at(restA + ((2 * k + 1) * Math.PI) / 6, 1.13), 0.45, { spin: true }));
  const marker = b.star(at(restA, 1.2), 1.35, { spin: true, pluck: true });
  const wingA = b.star(at(dirA - 0.12, 1.58), 0.6), mouth = b.star(at(dirA, 1.42), 0.8), wingB = b.star(at(dirA + 0.12, 1.58), 0.6);
  // The rim with one pen, the six spokes out from the hub with the other, then the marker's tooth, the pointer and the signs.
  b.stroke(0, [...ring, ring[0]!]);
  for (let k = 0; k < 6; k++) b.stroke(2 * k, [hub, inner[k]!, ring[2 * k]!]);
  b.stroke(12, [ring[0]!, marker]);
  b.stroke(13, [wingA, mouth, wingB]);
  for (let k = 0; k < 6; k++) b.stroke(15 + (k >> 1), [ring[2 * k + 1]!, signs[k]!]);
  const from = at(dirA, 1.2);
  const to = landing(from, i, 0.25);
  return {
    kind: 'wheel', arrowLen: 0, centre: pv, unit: R, aim: dirA, facing: f, stars: b.stars, edges: b.edges,
    shotFrom: from, shotTo: to, shotCtrl: { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 }, arc: false, head: -1, torso: [], medallion: null,
    pluck: marker, charge: marker, pivot: pv, spinTurns: turns, tilt: false, gather: false, lead: 'spark',
  };
}

/**
 * Tier 4, THE GIANT: a constellation giant as tall as the sky in the shape of ORION, traced from its feet up (so it RISES):
 * legs to a belt of three bright stars, the torso to broad shoulders, a small head, a shield of stars on its far arm, a
 * sword hanging from the belt, and on its near arm a fist of three stars. A ghost body fills in along its limbs. It
 * raises its fist by its head (the fist charges), then brings it down on the struck hero: the fist rides the blow, the
 * elbow half of it.
 */
function giantFigure(p: StarsPlan, i: FigureInput): StarFigure {
  const bd = i.bounds;
  const m = Math.min(bd.w, bd.h) * 0.025;
  const H = ((bd.h - 2 * m) / 0.97) * Math.min(1, p.size);
  const cx = clamp(i.attacker.x + (i.defender.x - i.attacker.x) * 0.42, bd.x + m + 0.36 * H, Math.max(bd.x + m + 0.36 * H, bd.x + bd.w - m - 0.36 * H));
  const c = { x: cx, y: bd.y + bd.h - m - 0.485 * H };
  const f: 1 | -1 = i.defender.x >= c.x ? 1 : -1;
  const P = (x: number, y: number): Pt => ({ x: c.x + f * x * H, y: c.y + y * H });
  const raise = (from: Pt, x: number, y: number): Pt => { const q = P(x, y); return { x: q.x - from.x, y: q.y - from.y }; };
  const b = builder();
  const footB = b.star(P(-0.16, 0.48), 1), kneeB = b.star(P(-0.12, 0.26), 0.55);
  const footF = b.star(P(0.14, 0.48), 0.8), kneeF = b.star(P(0.1, 0.27), 0.55);
  // The belt: three bright stars in a slanting row.
  const b1 = b.star(P(-0.065, 0.025), 0.95), b2 = b.star(P(0, 0.005), 0.95), b3 = b.star(P(0.065, -0.015), 0.95);
  const shB = b.star(P(-0.15, -0.27), 1.2), shF = b.star(P(0.14, -0.255), 1), neck = b.star(P(-0.005, -0.29), 0.5);
  const headA = b.star(P(-0.035, -0.37), 0.5), crown = b.star(P(0, -0.43), 0.85), headB = b.star(P(0.035, -0.365), 0.5);
  // The shield on the far arm: an arc of stars held out.
  const elbowB = b.star(P(-0.25, -0.18), 0.55), s1 = b.star(P(-0.3, -0.3), 0.6), s2 = b.star(P(-0.345, -0.18), 0.65), s3 = b.star(P(-0.315, -0.055), 0.6);
  // The sword hanging from the belt.
  const w1 = b.star(P(0.005, 0.09), 0.45), w2 = b.star(P(0.01, 0.15), 0.6), w3 = b.star(P(0.015, 0.21), 0.4);
  // The near arm and its fist: they go up by its head in the draw and ride the blow.
  const elbowRest = P(0.22, -0.11), fistRest = P(0.255, 0.05);
  const elbowF = b.star(elbowRest, 0.6, { pull: raise(elbowRest, 0.28, -0.25), ride: 0.5 });
  const fist = b.star(fistRest, 1.3, { pull: raise(fistRest, 0.22, -0.4), ride: 1 });
  const k1Rest = P(0.295, 0.075), k2Rest = P(0.245, 0.1);
  const k1 = b.star(k1Rest, 0.55, { pull: raise(k1Rest, 0.262, -0.38), ride: 1 });
  const k2 = b.star(k2Rest, 0.55, { pull: raise(k2Rest, 0.212, -0.355), ride: 1 });
  b.stroke(0, [footB, kneeB, b1], { limb: true });
  b.stroke(0, [footF, kneeF, b3], { limb: true });
  b.stroke(2, [b1, b2, b3]);
  b.stroke(2, [b1, shB], { limb: true });
  b.stroke(3, [b3, shF], { limb: true });
  b.stroke(4, [shB, neck, shF]);
  b.stroke(6, [neck, headA, crown, headB, neck]);
  b.stroke(6, [shB, elbowB, s1, s2, s3], { limb: true });
  b.stroke(10, [shF, elbowF, fist], { limb: true });
  b.stroke(12, [fist, k1, k2, fist]);
  b.stroke(15, [b2, w1, w2, w3]);
  const from = { x: b.stars[fist]!.x + b.stars[fist]!.px, y: b.stars[fist]!.y + b.stars[fist]!.py };
  // The fist comes DOWN: over the top of the sky and onto the struck hero.
  const to0 = landing(from, i, 0.2);
  const ctrl = hop(from, to0, 0.22, bd.y + bd.h * 0.04);
  const to = landing(ctrl, i, 0.2);
  return {
    kind: 'giant', arrowLen: 0, centre: c, unit: H, aim: Math.atan2(to.y - from.y, to.x - from.x), facing: f, stars: b.stars, edges: b.edges,
    shotFrom: from, shotTo: to, shotCtrl: ctrl, arc: false, head: crown, torso: [shB, shF, b2], medallion: null, pluck: -1, ...PLAIN, charge: fist, lead: 'spark',
  };
}

/**
 * Tier 4, THE NOVA: a sigil is traced over the struck hero (a ring of eight stars, an eight-point star through it, four rays
 * into its heart). The sigil closes into its heart and EVERY star in the sky streams into it; the point swells, falls
 * the last short way onto the struck hero and explodes.
 */
function novaFigure(p: StarsPlan, i: FigureInput): StarFigure {
  const bd = i.bounds;
  const r = i.radius;
  const Rs = r * 1.45 * p.size;
  const m = Math.min(bd.w, bd.h) * 0.025 + Rs * 1.1;
  const d = i.defender;
  const top = bd.y + m;
  let G: Pt;
  if (d.y - 2.9 * r >= top) G = { x: d.x, y: d.y - 2.9 * r };
  else { const u = unitTo(d, { x: bd.x + bd.w / 2, y: bd.y + bd.h / 2 }); G = { x: d.x + u.x * 3.1 * r, y: d.y + u.y * 3.1 * r }; }
  G = { x: clamp(G.x, bd.x + m, Math.max(bd.x + m, bd.x + bd.w - m)), y: clamp(G.y, top, Math.max(top, bd.y + bd.h - m)) };
  const b = builder();
  const ring = Array.from({ length: 8 }, (_, k) => {
    const a = -Math.PI / 2 + (k * Math.PI) / 4;
    const q = { x: G.x + Math.cos(a) * Rs, y: G.y + Math.sin(a) * Rs };
    return b.star(q, k % 2 ? 0.55 : 0.85, { arrow: true, pull: { x: G.x - q.x, y: G.y - q.y } });
  });
  const heart = b.star(G, 1.4, { pluck: true });
  b.stroke(0, [...ring, ring[0]!], { arrow: true });
  b.stroke(8, [0, 3, 6, 1, 4, 7, 2, 5, 0].map((k) => ring[k]!), { arrow: true });
  b.stroke(16, [ring[0]!, heart], { arrow: true });
  b.stroke(16, [ring[4]!, heart], { arrow: true });
  b.stroke(17, [ring[2]!, heart], { arrow: true });
  b.stroke(17, [ring[6]!, heart], { arrow: true });
  const to = landing(G, i, 0.15);
  return {
    kind: 'nova', arrowLen: 0, centre: G, unit: Rs, aim: Math.atan2(to.y - G.y, to.x - G.x), facing: d.x >= G.x ? 1 : -1, stars: b.stars, edges: b.edges,
    shotFrom: G, shotTo: to, shotCtrl: { x: (G.x + to.x) / 2, y: (G.y + to.y) / 2 }, arc: false, head: -1, torso: [], medallion: null,
    pluck: heart, charge: heart, pivot: null, spinTurns: 0, tilt: false, gather: true, lead: 'comet',
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
  switch (p.kind) {
    case 'arrow': return arrowFigure(p, i);
    case 'bow': return bowFigure(p, i);
    case 'hunter': return hunterFigure(p, i, c);
    case 'wolf': return wolfFigure(p, i);
    case 'serpent': return serpentFigure(p, i);
    case 'wheel': return wheelFigure(p, i);
    case 'giant': return giantFigure(p, i);
    case 'nova': return novaFigure(p, i);
    default: return writtenFigure(p, i, c);
  }
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
 * Tier 4: how far the charging star has SWOLLEN at `t` (0..1): it builds through the hold, slowly then fast, and is
 * gone with the loose (the shot takes over). 0 for the other tiers.
 */
export function swellAmount(p: StarsPlan, t: number): number {
  if (p.reduced || p.tier !== 4 || t < p.holdAt || t >= p.looseAt) return 0;
  const u = (t - p.holdAt) / Math.max(1, p.looseAt - p.holdAt);
  return 0.35 * sine(u) + 0.65 * u * u * u;
}

/**
 * Tier 4: the sky holding its breath (0..1): every other star dims through the draw while the charging star swells,
 * stays dim while the shot travels, and is released on the blow. 0 for the other tiers.
 */
export function hushAmount(p: StarsPlan, t: number): number {
  if (p.reduced || p.tier !== 4 || t < p.drawAt || t >= p.impactAt) return 0;
  return sine((t - p.drawAt) / Math.max(1, (p.looseAt - p.drawAt) * 0.8));
}

/** The constellation after the blow: its lines FLARE (0..1, a quick rise and a slower fall). Tier 4 flares longest. */
export function flareAmount(p: StarsPlan, t: number): number {
  if (p.reduced || t < p.impactAt) return 0;
  const ms = t - p.impactAt;
  return ms < 70 ? ms / 70 : Math.exp(-(ms - 70) / (p.tier === 4 ? 260 : 150));
}

/**
 * The wheel: how far it has turned (0..1 of `spinTurns`): still while it is traced, then it turns through the draw and
 * the first part of the hold, slowing like a heavy wheel, and LOCKS at `lockAt`. 0 for the other looks.
 */
export function spinAmount(p: StarsPlan, t: number): number {
  if (p.reduced || p.kind !== 'wheel' || t <= p.drawAt) return 0;
  if (t >= p.lockAt) return 1;
  const x = (t - p.drawAt) / Math.max(1, p.lockAt - p.drawAt);
  // A short ease in (it has weight), a long ease out (it coasts into the lock).
  return 1 - Math.pow(1 - Math.pow(x, 1.3), 3);
}

/**
 * The nova: how far the sky has been drawn in (0..1): from the draw to just before the loose; the scene staggers it per
 * star (the near ones go first) and eases each in faster and faster. 0 for the other looks.
 */
export function gatherAmount(p: StarsPlan, t: number): number {
  if (p.reduced || p.kind !== 'nova' || t <= p.drawAt) return 0;
  return clamp01((t - p.drawAt) / Math.max(1, p.looseAt - p.drawAt - 60));
}

/** How much of the constellation is still drawn (1 until Tier 4's lines or a beast scatter into sparks, then quickly 0). */
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

/**
 * The shot at `t`: its phase and how far along its path it is. The arrows accelerate a touch; a comet falls; the beam
 * is all speed; the wolf springs off fast and lands fast; the serpent and the fist whip in, hardest at the end.
 */
export function shotAt(p: StarsPlan, t: number): { phase: 'nocked' | 'fly' | 'done'; u: number } {
  if (p.reduced || t < p.looseAt) return { phase: 'nocked', u: 0 };
  if (t >= p.impactAt) return { phase: 'done', u: 1 };
  const x = (t - p.looseAt) / Math.max(1, p.impactAt - p.looseAt);
  switch (p.kind) {
    case 'written': case 'nova': return { phase: 'fly', u: x * x * (0.55 + 0.45 * x) };
    case 'wheel': return { phase: 'fly', u: 1 - (1 - x) * (1 - x) };
    case 'wolf': return { phase: 'fly', u: 0.55 * x + 0.45 * x * x };
    case 'serpent': case 'giant': return { phase: 'fly', u: Math.pow(x, 2.2) };
    default: return { phase: 'fly', u: 0.25 * x + 0.75 * x * x };
  }
}

export type StarsCueKind = 'sky' | 'star' | 'alive' | 'draw' | 'hold' | 'lock' | 'loose' | 'impact' | 'scatter' | 'end';
export interface StarsCue { at: number; kind: StarsCueKind; i: number }

export function starsCues(p: StarsPlan, f: StarFigure | null): StarsCue[] {
  const out: StarsCue[] = [];
  if (!p.reduced) {
    out.push({ at: p.chargeAt, kind: 'sky', i: 0 });
    if (f) f.stars.forEach((s, i) => { if (!s.pluck) out.push({ at: slotAt(p, s.slot), kind: 'star', i }); });
    out.push({ at: p.tracedAt, kind: 'alive', i: 0 });
    out.push({ at: p.drawAt, kind: 'draw', i: 0 });
    out.push({ at: p.holdAt, kind: 'hold', i: 0 });
    if (Number.isFinite(p.lockAt)) out.push({ at: p.lockAt, kind: 'lock', i: 0 });
    out.push({ at: p.looseAt, kind: 'loose', i: 0 });
  }
  out.push({ at: p.impactAt, kind: 'impact', i: 0 });
  if (!p.reduced && Number.isFinite(p.scatterAt)) out.push({ at: p.scatterAt, kind: 'scatter', i: 0 });
  out.push({ at: p.endAt, kind: 'end', i: 0 });
  const order: Record<StarsCueKind, number> = { sky: 0, star: 1, alive: 2, draw: 3, hold: 4, lock: 5, loose: 6, impact: 7, scatter: 8, end: 9 };
  return out.sort((a, b) => a.at - b.at || order[a.kind] - order[b.kind] || a.i - b.i);
}

// ─── the camera (pure) ─────────────────────────────────────────────────────────────────────────────────────────

/**
 * The camera: a slow push in while the figure is traced (looking up at the sky), a little more through the draw, a
 * small kick on the loose, and a punch and a shake on the blow that grow with the tier. Tier 4: the view keeps creeping in
 * while the star swells (the held breath), and the blow is a real hit: a hard shake along the comet's line that takes
 * longer to die, over a slower sway.
 */
export function starsCameraAt(p: StarsPlan, c: HeroStarsConfig, t: number, dir: Pt = { x: 1, y: 0 }): { zoom: number; x: number; y: number } {
  if (p.reduced) return { zoom: 1, x: 0, y: 0 };
  let z = 0;
  if (t >= p.chargeAt && t < p.impactAt) {
    z += p.zoom * sine((t - p.chargeAt) / Math.max(1, p.tracedAt - p.chargeAt));
    z += p.zoom * 0.4 * Math.max(0, Math.min(1, drawAmount(p, Math.min(t, p.looseAt - 1))));
    if (p.tier === 4 && t > p.holdAt) z += p.zoom * 0.7 * sine((t - p.holdAt) / Math.max(1, p.looseAt - p.holdAt));
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
