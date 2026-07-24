import type { FxAnchorId } from './def';

export interface FxPoint {
  x: number;
  y: number;
}

/** Screen-space points a scenario (or a real game moment) stages for a def to attach to. */
export type FxAnchors = Partial<Record<'source' | 'target' | 'cursor' | 'slot' | 'camera', FxPoint>>;

const ORIGIN: FxPoint = { x: 0, y: 0 };

/** Quadratic arc between two anchors. `bow` is the perpendicular offset as a fraction of the span. */
export function pointOnTravel(a: FxPoint, b: FxPoint, t: number, bow: number): FxPoint {
  const mx = (a.x + b.x) / 2 + (b.y - a.y) * bow;
  const my = (a.y + b.y) / 2 - (b.x - a.x) * bow;
  const it = 1 - t;
  return {
    x: it * it * a.x + 2 * it * t * mx + t * t * b.x,
    y: it * it * a.y + 2 * it * t * my + t * t * b.y,
  };
}

/** `progress` is the layer's own 0..1 through its life; only `travel` uses it. */
export function resolveAnchor(anchors: FxAnchors, id: FxAnchorId, progress: number): FxPoint {
  if (id === 'travel') {
    const start = anchors.source ?? ORIGIN;
    const end = anchors.target ?? ORIGIN;
    return {
      x: start.x + (end.x - start.x) * progress,
      y: start.y + (end.y - start.y) * progress,
    };
  }
  if (id === 'camera') return anchors.camera ?? ORIGIN;
  return anchors[id] ?? ORIGIN;
}
