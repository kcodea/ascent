/**
 * BEAT SYSTEM PR 8 — pure geometry for the drag-timeline. No DOM, no React: pixel↔ms mapping, snapping, and
 * per-beat region layout, so the interaction is unit-testable and the drag handler stays a thin wrapper (the
 * FX Workbench lesson — measure once, compute in pure functions; blueprint §16.5).
 */
import type { ScheduledBeat } from './labSchedule';

export const msToPx = (ms: number, pxPerMs: number): number => ms * pxPerMs;
export const pxToMs = (px: number, pxPerMs: number): number => (pxPerMs > 0 ? px / pxPerMs : 0);

/** Snap a millisecond value to the nearest `step` (0 or negative disables). Never below 0. */
export function snapMs(ms: number, step: number): number {
  if (step <= 0) return Math.max(0, Math.round(ms));
  return Math.max(0, Math.round(ms / step) * step);
}

/** A beat's three sub-regions laid out in pixels on the timeline (wind-up, hold, recovery). */
export interface BeatRegionsPx {
  startPx: number;
  windupPx: number;
  holdPx: number;
  recoveryPx: number;
  /** x of the right edge of the HOLD region — the primary drag handle (drag it to change hold). */
  holdEndPx: number;
  totalPx: number;
}

export function beatRegionsPx(beat: ScheduledBeat, pxPerMs: number): BeatRegionsPx {
  const startPx = msToPx(beat.startMs, pxPerMs);
  const windupPx = msToPx(beat.consequenceMs - beat.startMs, pxPerMs);
  const holdPx = msToPx(beat.endMs - beat.consequenceMs, pxPerMs);
  const recoveryPx = msToPx(beat.nextMs - beat.endMs, pxPerMs);
  return { startPx, windupPx, holdPx, recoveryPx, holdEndPx: startPx + windupPx + holdPx, totalPx: windupPx + holdPx + recoveryPx };
}

/** Choose a px-per-ms that fits `totalMs` into `widthPx` (with a small margin), clamped to a legible range. */
export function fitScale(totalMs: number, widthPx: number): number {
  if (totalMs <= 0 || widthPx <= 0) return 0.1;
  return Math.min(2, Math.max(0.02, (widthPx - 20) / totalMs));
}

/**
 * Given a drag of the hold-edge handle to absolute pixel `x` (relative to the timeline's left), return the new
 * holdMs for that beat: the distance from the beat's consequence point to `x`, snapped, floored at 0.
 */
export function holdFromDragPx(beat: ScheduledBeat, xPx: number, pxPerMs: number, snapStep: number): number {
  const consequencePx = msToPx(beat.consequenceMs, pxPerMs);
  return snapMs(pxToMs(xPx - consequencePx, pxPerMs), snapStep);
}

/** Evenly-spaced ruler ticks (ms) across `totalMs`, aiming for ~`target` ticks at round intervals. */
export function rulerTicks(totalMs: number, target = 6): number[] {
  if (totalMs <= 0) return [0];
  const raw = totalMs / target;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag;
  const ticks: number[] = [];
  for (let t = 0; t <= totalMs + 1e-6; t += step) ticks.push(Math.round(t));
  return ticks;
}
