/**
 * HERO SELECT CEREMONY — pure geometry (hero-select-ceremony-blueprint.md §8, §9, §17).
 *
 * Everything here is math over plain numbers: rect snapshots, the centered destination, clone transforms,
 * and the unselected cards' exit vectors. No DOM reads — the component reads `getBoundingClientRect()`
 * exactly once at click time (and once per debounced resize) and feeds the numbers through here.
 * NaN-safety is part of the contract: a zero-sized or degenerate rect must produce a usable (if boring)
 * result, never NaN in a transform string.
 */
import type { RectSnapshot } from './heroCeremonyMachine';

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const finite = (v: number, fallback: number): number => (Number.isFinite(v) ? v : fallback);

/** Snapshot a DOMRect-ish into plain numbers (§8: never hold the live DOMRect). */
export function snapshotRect(r: { left: number; top: number; width: number; height: number }): RectSnapshot {
  return {
    left: finite(r.left, 0),
    top: finite(r.top, 0),
    width: Math.max(0, finite(r.width, 0)),
    height: Math.max(0, finite(r.height, 0)),
  };
}

export const rectCenter = (r: RectSnapshot): { x: number; y: number } => ({
  x: r.left + r.width / 2,
  y: r.top + r.height / 2,
});

/**
 * The centered portrait destination (§8). Width-driven; height preserves the source card's aspect so the
 * clone scales uniformly (a non-uniform card stretch reads as broken, not theatrical).
 *
 * Desktop: 28% of viewport width clamped to [360, 520]. Narrow screens (< 720px): the mobile clamp, and the
 * center rides at 43vh so the Start Game button keeps the lower safe area.
 */
export function destinationRect(viewportW: number, viewportH: number, source: RectSnapshot): RectSnapshot {
  const vw = Math.max(1, finite(viewportW, 1));
  const vh = Math.max(1, finite(viewportH, 1));
  const narrow = vw < 720;
  const width = narrow
    ? Math.max(200, Math.min(vw * 0.76, vh * 0.42))
    : clamp(vw * 0.28, 360, 520);
  const aspect = source.width > 0 && source.height > 0 ? source.height / source.width : 1.4;
  const height = width * aspect;
  const cx = vw / 2;
  const cy = vh * (narrow ? 0.43 : 0.46);
  return { left: cx - width / 2, top: cy - height / 2, width, height };
}

/**
 * Transform (translate+scale, relative to the clone sitting at the SOURCE rect) that lands the clone on a
 * target rect. The clone is positioned fixed at the source, `transform-origin: top left` — so start is
 * identity and every keyframe is a pure compositor transform.
 */
export function transformTo(source: RectSnapshot, target: RectSnapshot): string {
  const scale = source.width > 0 ? target.width / source.width : 1;
  const dx = target.left - source.left;
  const dy = target.top - source.top;
  return `translate(${finite(dx, 0).toFixed(1)}px, ${finite(dy, 0).toFixed(1)}px) scale(${finite(scale, 1).toFixed(4)})`;
}

/** The §9 focus keyframes: identity → overshoot (at `offset` 0.82) → settle ~3% smaller. */
export function focusKeyframes(source: RectSnapshot, dest: RectSnapshot): Keyframe[] {
  const scale = source.width > 0 ? dest.width / source.width : 1;
  const over = scale * 1.03;
  const dx = dest.left - source.left;
  const dy = dest.top - source.top;
  // Overshoot keeps the same translation target (the center) but a hair larger — it reads as arrival
  // momentum, not a position miss.
  const overDx = dx - (source.width * (over - scale)) / 2;
  const overDy = dy - (source.height * (over - scale)) / 2;
  return [
    { transform: 'translate(0px, 0px) scale(1)' },
    { transform: `translate(${overDx.toFixed(1)}px, ${overDy.toFixed(1)}px) scale(${over.toFixed(4)})`, offset: 0.82 },
    { transform: `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px) scale(${scale.toFixed(4)})` },
  ];
}

export interface ExitVector {
  x: number;
  y: number;
  rotateDeg: number;
  scale: number;
  /** ms after the first exit begins (already capped — §17's dense-roster rule). */
  delayMs: number;
}

/**
 * Exit vector for one unselected card (§9): cards yield AWAY from the selected card with a distance-driven
 * stagger. `row` nudges vertical drift so multi-row (Practice) grids don't exit as one flat sheet.
 *
 * `alternate` breaks the tie when a card is exactly on the selected center (same column, another row):
 * odd indexes go right, even go left.
 */
export function exitVector(
  card: RectSnapshot,
  selected: RectSnapshot,
  index: number,
  row: number,
  staggerMs: number,
): ExitVector {
  const delta = rectCenter(card).x - rectCenter(selected).x;
  const direction = Math.sign(delta) || (index % 2 === 0 ? -1 : 1);
  const x = direction * clamp(Math.abs(finite(delta, 0)) * 0.24, 90, 180);
  const y = row <= 0 ? -10 : clamp(10 + row * 10, 10, 30);
  const rotateDeg = direction * clamp(Math.abs(finite(delta, 0)) / 240, 0.5, 3);
  // Stagger by distance rank, capped at 180ms total so a 23-card Practice roster clears as fast as three.
  const distanceRank = Math.abs(finite(delta, 0)) / Math.max(1, card.width);
  const delayMs = Math.min(distanceRank * staggerMs, 180);
  return { x, y, rotateDeg, scale: 0.9, delayMs };
}
