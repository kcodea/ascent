import type { EditorLayer } from './layerModel';

/** Shortest life a drag can produce. A zero-length layer is invisible and unclickable — you would drag a bar
 *  out of existence with no way to get it back except undo. */
export const MIN_LAYER_LIFE_MS = 10;

/** Drag resolution, matching the "Starts at" slider's own step, so dragging a bar and nudging the slider
 *  produce the same set of values rather than the bar landing on numbers the slider can't reach. */
export const TIMELINE_SNAP_MS = 10;

/** What a bar occupies on the timeline. `full` marks a `life: null` layer — one that runs to whatever the
 *  composition duration is, which is why it needs the duration to resolve an end at all. */
export interface LayerSpan {
  startMs: number;
  endMs: number;
  full: boolean;
}

export function spanOf(layer: Pick<EditorLayer, 'at' | 'life'>, durationMs: number): LayerSpan {
  const startMs = Math.max(0, Math.min(durationMs, layer.at));
  if (layer.life === null) return { startMs, endMs: durationMs, full: true };
  return { startMs, endMs: Math.min(durationMs, startMs + layer.life), full: false };
}

/** A bar's geometry as fractions of the track, ready to become CSS percentages. Always within [0, 1] and
 *  never negative-width, so a layer whose `at` sits beyond a shrunken duration collapses to a sliver at the
 *  end rather than rendering inside-out. */
export function spanToTrack(span: LayerSpan, durationMs: number): { left: number; width: number } {
  if (durationMs <= 0) return { left: 0, width: 0 };
  const left = Math.max(0, Math.min(1, span.startMs / durationMs));
  const right = Math.max(left, Math.min(1, span.endMs / durationMs));
  return { left, width: right - left };
}

/** Where a pointer at `clientX` sits on the track, in ms. The rect is passed IN because it must be measured
 *  once per drag, never per move (see `docs/performance.md` — no `getBoundingClientRect` in a hot path). */
export function pointerToMs(clientX: number, rect: { left: number; width: number }, durationMs: number): number {
  if (rect.width <= 0) return 0;
  const frac = (clientX - rect.left) / rect.width;
  return Math.max(0, Math.min(durationMs, frac * durationMs));
}

export type TimelineDragMode = 'move' | 'resize';

/** Everything about a drag that is fixed at pointerdown. Held in a ref by the component; the pure resolver
 *  below turns it plus a live pointer position into the new timing. */
export interface TimelineDrag {
  index: number;
  mode: TimelineDragMode;
  /** The layer's `at` when the drag started. */
  startAt: number;
  /** The layer's `life` when the drag started — `null` for a full-life layer. */
  startLife: number | null;
  /** Where on the track the pointer went down, in ms. Deltas are measured from here, so grabbing a bar in
   *  the middle doesn't teleport its start to the cursor. */
  grabMs: number;
}

function snap(ms: number): number {
  return Math.round(ms / TIMELINE_SNAP_MS) * TIMELINE_SNAP_MS;
}

/**
 * The new `{ at, life }` for a drag in progress. Pure — same inputs, same answer, no clock and no DOM.
 *
 * `move` slides the whole bar and preserves `life` exactly, including `null`: dragging a full-life layer
 * must not silently pin it to a finite length. `resize` drags the right edge and always produces a finite
 * life, which is also how a full-life layer is given a fixed end — the affordance and the conversion are
 * the same gesture.
 *
 * Both clamp into the composition rather than letting a drag push a layer out of it: `move` stops with at
 * least `MIN_LAYER_LIFE_MS` of the bar still inside, and `resize` can neither invert the bar nor extend it
 * past the end.
 */
export function resolveTimingDrag(
  drag: TimelineDrag,
  pointerMs: number,
  durationMs: number,
): { at: number; life: number | null } {
  const deltaMs = pointerMs - drag.grabMs;
  if (drag.mode === 'move') {
    const span = drag.startLife ?? durationMs - drag.startAt;
    // A full-life layer keeps its start clamped by MIN_LAYER_LIFE_MS alone (its end IS the duration); a
    // finite one has to keep its whole span inside.
    const maxAt = drag.startLife === null
      ? durationMs - MIN_LAYER_LIFE_MS
      : Math.max(0, durationMs - span);
    return { at: Math.max(0, Math.min(maxAt, snap(drag.startAt + deltaMs))), life: drag.startLife };
  }
  const startLife = drag.startLife ?? durationMs - drag.startAt;
  const maxLife = Math.max(MIN_LAYER_LIFE_MS, durationMs - drag.startAt);
  const life = Math.max(MIN_LAYER_LIFE_MS, Math.min(maxLife, snap(startLife + deltaMs)));
  return { at: drag.startAt, life };
}
