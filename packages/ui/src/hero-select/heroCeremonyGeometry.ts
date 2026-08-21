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
 * The big hero card's own aspect (height ÷ width). FIXED, never taken from the source card.
 *
 * The ceremony always presents a BIG card — the clone re-renders the big-card markup whatever it flew from —
 * so the destination must use the big card's shape. Deriving it from the source instead broke Practice
 * outright (owner report 2026-08-21): the dense roster's compact card is ~2.72:1 against the big card's
 * ~1.31:1, so the destination came out more than twice as tall and the portrait sat off the top of the screen.
 */
export const CEREMONY_ASPECT = 1.31;

/** The design stage the whole UI is authored against (Game.tsx: `--scale` = stage height ÷ 1440). */
const REFERENCE_STAGE_H = 1440;

/**
 * The game's UNIFORM stage scale — the same unitless number every other authored size in the UI multiplies
 * by, so the ceremony grows and shrinks in lockstep with the board instead of drifting against it. Mirrors
 * Game.tsx's own formula rather than reading the CSS var, so the geometry stays a pure function.
 */
export function stageScale(viewportW: number, viewportH: number): number {
  const gh = Math.min(finite(viewportH, REFERENCE_STAGE_H), (finite(viewportW, REFERENCE_STAGE_H) * 9) / 16, REFERENCE_STAGE_H);
  return clamp(gh / REFERENCE_STAGE_H, 0.2, 1.25);
}

/**
 * The centered portrait destination (§8) — SCALE-DRIVEN, not viewport-fraction-driven.
 *
 * It used to be `clamp(0.28 × viewport width, 360, 520)`, which meant the portrait's size tracked the WINDOW
 * while every tuned offset around it (the name plate, the ring, the button) stayed in raw pixels — so the
 * whole composition came apart at any resolution but the one it was dialed at (owner report 2026-08-21:
 * "on 16:9 monitors the sizing is off"). Everything is now reference px × the stage scale, exactly like the
 * rest of the UI, so the ceremony is proportionally identical at every window size.
 */
export function destinationRect(viewportW: number, viewportH: number, _source?: RectSnapshot): RectSnapshot {
  const vw = Math.max(1, finite(viewportW, 1));
  const vh = Math.max(1, finite(viewportH, 1));
  const scale = stageScale(vw, vh);
  const narrow = vw < 720;
  // Reference widths at the 1440 stage. The narrow branch keeps the phone's "fit the shorter side" behaviour.
  const width = narrow
    ? Math.max(200, Math.min(vw * 0.76, vh * 0.42))
    : 636 * scale;
  const height = width * CEREMONY_ASPECT;
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
