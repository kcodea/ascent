/**
 * Pure drag-math for the workbench's two pointer-drag interactions: reordering a list of rows, and scrubbing a
 * numeric control horizontally. Deliberately free of React and the DOM (mirrors the `layerModel.ts` /
 * `timelineModel.ts` precedent) so the arithmetic is unit-testable headlessly; the caller wires these to actual
 * pointer events.
 */

/** One in-flight row-reorder drag: which row started the drag, and how many rows the list holds. */
export interface ReorderDrag {
  fromIndex: number;
  count: number;
}

/**
 * Given an in-flight reorder drag and the pointer's Y position (px, relative to the list's top), returns the
 * index the dragged row should land at, clamped to `[0, count-1]`.
 *
 * `rowTops` is the cached Y-offset of each row's top edge (length === `count`) — captured once per drag, never
 * read from the DOM per pointer-move (see the repo's "don't read layout per frame" rule). The crossover
 * threshold for each row is its vertical MIDPOINT: `top + (nextTop - top) / 2` for every row but the last,
 * which has no "next" row to measure against and so mirrors the gap above it instead:
 * `top + (top - prevTop)`.
 */
export function reorderTargetIndex(drag: ReorderDrag, pointerY: number, rowTops: readonly number[]): number {
  const { count } = drag;
  if (count <= 1) return 0;
  let target = 0;
  for (let i = 0; i < count; i++) {
    const top = rowTops[i];
    const midpoint =
      i + 1 < count ? top + (rowTops[i + 1] - top) / 2 : top + (top - rowTops[i - 1]);
    if (pointerY >= midpoint) target = i;
  }
  return Math.min(count - 1, Math.max(0, target));
}

/**
 * Immutable list move: returns a NEW array with `items[from]` spliced out and reinserted at `to`. `from === to`
 * or either index out of `[0, items.length)` is a no-op — but still returns a fresh shallow copy, matching the
 * no-op convention of the rest of the workbench's array helpers (`moveLayer`, `removeLayer`, …).
 */
export function applyReorder<T>(items: readonly T[], from: number, to: number): T[] {
  const next = items.slice();
  if (from === to || from < 0 || from >= items.length || to < 0 || to >= items.length) return next;
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

/** One in-flight numeric-scrub drag: the value at drag-start, the control's bounds, its step size, and how
 *  many horizontal pixels of drag equal one step at the normal (non-fine) rate. */
export interface ScrubDrag {
  startValue: number;
  min: number;
  max: number;
  step: number;
  pxPerStep: number;
}

/**
 * Converts a horizontal pixel delta into a new control value: `startValue + round((dx / pxPerStep) * (fine ?
 * 0.25 : 1)) * step`, clamped to `[min, max]`, then snapped to the nearest `step` grid anchored at `min`
 * (`min + round((v - min) / step) * step`). Pure.
 */
export function scrubValue(drag: ScrubDrag, dx: number, fine: boolean): number {
  const { startValue, min, max, step, pxPerStep } = drag;
  const rate = fine ? 0.25 : 1;
  const raw = startValue + Math.round((dx / pxPerStep) * rate) * step;
  const clamped = Math.min(max, Math.max(min, raw));
  return min + Math.round((clamped - min) / step) * step;
}
