/**
 * Sound-layer trim maths: the workbench shows a sound layer's Start / End offset as a PERCENT of the loaded
 * clip (owner ask 2026-11-04: the old 0..2000 ms slider could not reach the end of a longer clip), while the
 * def keeps storing milliseconds, so every saved def plays exactly as it did. Pure, so it tests headless.
 */

/** The ceiling on a stored offset, in ms: far past any clip we ship, so a trim can reach anywhere in it. */
export const CLIP_OFFSET_MAX_MS = 600_000;

/** A stored offset as a percent (0..100) of a clip `durMs` long. 0 when the length is unknown. */
export function offsetMsToPct(ms: number, durMs: number): number {
  if (!(durMs > 0)) return 0;
  return Math.max(0, Math.min(100, (ms / durMs) * 100));
}

/** A percent (0..100) of a clip `durMs` long, as a whole-ms offset to store. */
export function offsetPctToMs(pct: number, durMs: number): number {
  if (!(durMs > 0)) return 0;
  return Math.round((Math.max(0, Math.min(100, pct)) / 100) * durMs);
}

/**
 * Clamp a new trim so the window never inverts: Start can go up to where End begins, and End up to where
 * Start sits. `other` is the opposite offset (ms). Returns whole ms in `[0, durMs - other]`.
 */
export function clampTrimMs(ms: number, other: number, durMs: number): number {
  const cap = Math.max(0, durMs - Math.max(0, other));
  return Math.round(Math.max(0, Math.min(cap, ms)));
}
