import type { CosmeticRarity } from '@game/progression';

/**
 * TIERED CHEST OPENINGS: the tier axis of the crate opening. The opening already escalates with the REWARD's rarity
 * (`presetFor(reward.rarity)`); this adds a second axis, the CHEST's tier, which is the guaranteed floor of the crate
 * that was bought. A tier brings its own art and an escalating effects-and-sound LAYER (an aura, motes, wisps pulled
 * into the chest, orbiting bands, extra shake and glow, a burst flourish, and three sound cues). The layer ADDS to the
 * reward's dials and never replaces them.
 *
 * 'standard' (a common floor, or no floor) is exactly today's opening: today's art, no layer, no tier sound.
 * Ancient is MULTICHROME: its base is the opal `#f4eeff` and its particles cycle hue (`ancientHueSpeed`).
 *
 * Pure data and types: the config, the tuner and the scene read these through `crateFxConfig.ts`.
 */

export type ChestTier = 'standard' | 'rare' | 'epic' | 'legendary' | 'ancient';
/** The five tiers, lowest first. */
export const CHEST_TIERS: readonly ChestTier[] = ['standard', 'rare', 'epic', 'legendary', 'ancient'];

/** The tiers that carry a layer (everything but Standard). Each owns a full set of dials in the config. */
export type LayeredTier = Exclude<ChestTier, 'standard'>;
export const LAYERED_TIERS: readonly LayeredTier[] = ['rare', 'epic', 'legendary', 'ancient'];

/** A crate's tier from its guaranteed floor. No floor, or a common one, is Standard. An unknown floor (a newer
 *  server's rarity on an older client) is Standard too. */
export function chestTierOf(floor: CosmeticRarity | null | undefined): ChestTier {
  return (LAYERED_TIERS as readonly string[]).includes(floor ?? '') ? (floor as LayeredTier) : 'standard';
}

/** A tier's floor, for the chest's name (`crateLabel` names a shop chest by its floor). Standard (or none) has none. */
export function chestFloorOf(tier: ChestTier | null | undefined): CosmeticRarity | null {
  return !tier || tier === 'standard' ? null : tier;
}

export const CHEST_TIER_LABEL: Readonly<Record<ChestTier, string>> = {
  standard: 'Standard', rare: 'Rare', epic: 'Epic', legendary: 'Legendary', ancient: 'Ancient',
};

/** The per-tier dials. Each one exists once per layered tier in the config, as `<tier><Suffix>`. */
export const TIER_NUM_SUFFIXES = [
  'AuraGlow', 'Motes', 'Wisps', 'WispPull', 'Bands', 'BandSpeed', 'ExtraShake', 'ExtraGlow',
  'BurstFlash', 'BurstSparkles', 'BurstWisps', 'HueSpeed', 'ShimmerGain', 'SwirlGain', 'BurstGain',
] as const;
export type TierSuffix = (typeof TIER_NUM_SUFFIXES)[number];
export type TierNumKey = `${LayeredTier}${TierSuffix}`;
export type TierColorKey = `${LayeredTier}TierColor`;

/** [min, max, step] per tier suffix. Counts 0..80, 0..1 dials 0..1, shake 0..6 px, speeds 0..2 per second. */
export const TIER_RANGES: Readonly<Record<TierSuffix, readonly [number, number, number]>> = {
  AuraGlow: [0, 1, 0.01],
  Motes: [0, 80, 1],
  Wisps: [0, 80, 1],
  WispPull: [0, 1, 0.01],
  Bands: [0, 80, 1],
  BandSpeed: [0, 2, 0.01],
  ExtraShake: [0, 6, 0.1],
  ExtraGlow: [0, 1, 0.01],
  BurstFlash: [0, 1, 0.01],
  BurstSparkles: [0, 80, 1],
  BurstWisps: [0, 80, 1],
  HueSpeed: [0, 2, 0.01],
  ShimmerGain: [0, 1, 0.01],
  SwirlGain: [0, 1, 0.01],
  BurstGain: [0, 1, 0.01],
};

/** Shipped dials, in `TIER_NUM_SUFFIXES` order. The layer escalates every tier; Ancient alone cycles hue. */
const TIER_DEFAULT_ROWS: Readonly<Record<LayeredTier, readonly number[]>> = {
  //         aura  motes wisps pull bands bSpd shake xGlow flash spark bWisp hue  shim  swirl burst
  rare:      [0.25, 4,   0,    0,   0,    0,   0,    0.1,  0,    12,   0,    0,   0.2,  0,    0],
  epic:      [0.4,  6,   6,    0.5, 0,    0,   0.4,  0.2,  0.2,  22,   6,    0,   0.3,  0.35, 0],
  legendary: [0.55, 8,   8,    0.6, 2,    0.35, 1,   0.3,  0.4,  32,   10,   0,   0.4,  0.45, 0.5],
  ancient:   [0.7,  10,  10,   0.7, 4,    0.5, 1.6,  0.45, 0.9,  48,   16,   0.35, 0.5, 0.55, 0.6],
};

/** The tier colours: the layer's aura, motes, wisps and bands. Ancient's is the opal base its particles cycle from. */
export const TIER_COLORS: Readonly<Record<LayeredTier, string>> = {
  rare: '#5aa8ff', epic: '#c07bff', legendary: '#ffb938', ancient: '#f4eeff',
};

/** `<tier><Suffix>` -> its shipped value, for every layered tier (spread into `CRATE_FX_DEFAULTS`). */
export const TIER_NUM_DEFAULTS = Object.fromEntries(
  LAYERED_TIERS.flatMap((t) => TIER_NUM_SUFFIXES.map((s, i) => [`${t}${s}`, TIER_DEFAULT_ROWS[t][i]!] as const)),
) as Record<TierNumKey, number>;

/** `<tier>TierColor` -> its shipped colour. */
export const TIER_COLOR_DEFAULTS = Object.fromEntries(
  LAYERED_TIERS.map((t) => [`${t}TierColor`, TIER_COLORS[t]] as const),
) as Record<TierColorKey, string>;

/** `<tier><Suffix>` -> [min, max, step] (spread into `CRATE_FX_RANGES`). */
export const TIER_NUM_RANGES = Object.fromEntries(
  LAYERED_TIERS.flatMap((t) => TIER_NUM_SUFFIXES.map((s) => [`${t}${s}`, TIER_RANGES[s]] as const)),
) as Record<TierNumKey, readonly [number, number, number]>;

/** One chest tier's layer, as the scene takes it (pure; built by `chestTierPresetFor`). */
export interface ChestTierPreset {
  tier: ChestTier;
  /** The tier colour as a Pixi number and as CSS. */
  color: number;
  colorCss: string;
  /** Ancient: the particles cycle hue from the base colour at `hueSpeed`. */
  multichrome: boolean;
  /** The soft tier-coloured aura behind the chest (0..1). */
  auraGlow: number;
  /** Motes drifting off the chest, per second. */
  motes: number;
  /** Wisps pulled into the chest through the charge, and how hard they are pulled (0..1). */
  wisps: number;
  wispPull: number;
  /** Orbiting light bands, and their speed in turns per second. */
  bands: number;
  bandSpeed: number;
  /** Added to the chest's shake (px) and glow (0..1); the reward's own dials stay. */
  extraShake: number;
  extraGlow: number;
  /** The burst flourish: an extra flash (0..1), sparkles and wisps thrown. */
  burstFlash: number;
  burstSparkles: number;
  burstWisps: number;
  /** Hue cycle, in cycles per second (Ancient only). */
  hueSpeed: number;
  /** Sound gains for the tier's three cues (shimmer, swirl, burst), each 0..1. */
  shimmerGain: number;
  swirlGain: number;
  burstGain: number;
}

/** Standard: today's opening. No layer, every number 0. */
export const NO_TIER_LAYER: ChestTierPreset = {
  tier: 'standard', color: 0, colorCss: '#000000', multichrome: false,
  auraGlow: 0, motes: 0, wisps: 0, wispPull: 0, bands: 0, bandSpeed: 0, extraShake: 0, extraGlow: 0,
  burstFlash: 0, burstSparkles: 0, burstWisps: 0, hueSpeed: 0, shimmerGain: 0, swirlGain: 0, burstGain: 0,
};
