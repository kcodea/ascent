import type { StoredFxDef } from '../defStore';
import { primitiveLabel } from './copy';

/** The colour buckets a def can be filed under. `neutral` is not a failure — it is the honest answer for a
 *  white, black or grey stop, which is what stops 1 and 4 of nearly every palette are. */
export const FX_HUES = ['red', 'orange', 'gold', 'green', 'cyan', 'blue', 'violet', 'magenta', 'neutral'] as const;
export type FxHue = (typeof FX_HUES)[number];

/** Below this saturation, or outside this lightness band, a colour has no hue worth filing under. */
const MIN_SATURATION = 0.18;
const MIN_LIGHTNESS = 0.08;
const MAX_LIGHTNESS = 0.94;

/** Hue ranges in degrees, in the order they are tested. Upper bound exclusive; the last entry wraps. */
const HUE_RANGES: [FxHue, number, number][] = [
  ['red', 345, 360],
  ['red', 0, 18],
  ['orange', 18, 38],
  ['gold', 38, 65],
  ['green', 65, 160],
  ['cyan', 160, 200],
  ['blue', 200, 255],
  ['violet', 255, 300],
  ['magenta', 300, 345],
];

/**
 * The colour bucket for one 0xRRGGBB stop.
 *
 * Total by construction: anything non-finite, out of range, or too grey/dark/bright to have a meaningful hue
 * returns `neutral` rather than throwing or guessing. That matters because it is fed raw palette numbers
 * straight out of def JSON, which is untrusted input.
 */
export function hueBucketOf(rgb: number): FxHue {
  if (!Number.isFinite(rgb) || rgb < 0 || rgb > 0xffffff) return 'neutral';
  const r = ((rgb >> 16) & 255) / 255;
  const g = ((rgb >> 8) & 255) / 255;
  const b = (rgb & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (l < MIN_LIGHTNESS || l > MAX_LIGHTNESS) return 'neutral';
  const d = max - min;
  if (d === 0) return 'neutral';
  const s = d / (1 - Math.abs(2 * l - 1));
  if (s < MIN_SATURATION) return 'neutral';

  let h: number;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h *= 60;
  if (h < 0) h += 360;

  for (const [hue, lo, hi] of HUE_RANGES) if (h >= lo && h < hi) return hue;
  return 'neutral';
}

export type FxMotion = 'travels' | 'in place';

export interface FxFacets {
  /** Human primitive names in layer order, de-duplicated: `Ring + Burst + Trail`. */
  shape: string;
  hue: FxHue;
  motion: FxMotion;
}

/** Which palette stop identifies a def's colour. Stop 1 is a near-black rim and stop 4 is `#ffffff` in
 *  nearly every shipped palette — only stop 2 carries a hue anyone would name. */
const IDENTIFYING_STOP = 1;

/**
 * Everything about a def that can be worked out from the def itself. No authoring, so it is always correct
 * and never needs back-filling for the defs that already exist.
 */
export function deriveFacets(def: StoredFxDef): FxFacets {
  const seen: string[] = [];
  for (const l of def.layers) if (!seen.includes(l.primitive)) seen.push(l.primitive);
  const shape = seen.map(primitiveLabel).join(' + ');

  // Count buckets in layer order so the FIRST layer wins a tie simply by being counted first.
  const counts = new Map<FxHue, number>();
  let best: FxHue | null = null;
  for (const l of def.layers) {
    const palette = l.params.palette;
    if (!Array.isArray(palette)) continue;
    const stop = palette[IDENTIFYING_STOP];
    if (typeof stop !== 'number') continue;
    const bucket = hueBucketOf(stop);
    if (bucket === 'neutral') continue;
    const n = (counts.get(bucket) ?? 0) + 1;
    counts.set(bucket, n);
    if (best === null || n > (counts.get(best) ?? 0)) best = bucket;
  }

  return {
    shape,
    hue: best ?? 'neutral',
    motion: def.layers.some((l) => l.anchor === 'travel') ? 'travels' : 'in place',
  };
}
