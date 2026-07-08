import type { Anchor } from './score';

export interface TrackWindow { widthPx: number; maxMs: number; }

/** Map a ms value to an x position (px) within the track. */
export const msToPx = (ms: number, w: TrackWindow): number => (ms / w.maxMs) * w.widthPx;
/** Map an x position (px) back to ms (rounded to the nearest ms). */
export const pxToMs = (px: number, w: TrackWindow): number => Math.round((px / w.widthPx) * w.maxMs);
/** Clamp an offset for its anchor: `start` can't fire before the moment begins (>= 0); timeline anchors
 *  (`contact`/`landed`) may be negative (fire before the anchor). */
export const clampOffset = (offset: number, at: Anchor): number => (at === 'start' ? Math.max(0, offset) : offset);
