import type { FxAnchorId } from './def';

export interface FxPoint {
  x: number;
  y: number;
}

/** Screen-space points a scenario (or a real game moment) stages for a def to attach to. */
export type FxAnchors = Partial<Record<Exclude<FxAnchorId, 'travel'>, FxPoint>>;

const ORIGIN: FxPoint = { x: 0, y: 0 };

/** Default perpendicular bow for a `travel` anchor. A straight line reads as a laser; the arc is what
 *  makes a trail whip between two units. */
const TRAVEL_BOW = 0.28;

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
export function resolveAnchor(anchors: FxAnchors, id: FxAnchorId, progress: number, bow = TRAVEL_BOW): FxPoint {
  if (id === 'travel') {
    return pointOnTravel(anchors.source ?? ORIGIN, anchors.target ?? ORIGIN, progress, bow);
  }
  return anchors[id] ?? ORIGIN;
}

/** Every anchor a layer can be pinned to, in the order the workbench's picker offers them. The `FxAnchorId`
 *  union is the type; THIS is the runtime list — kept next to `resolveAnchor` so "what can resolve" and
 *  "what can be picked" can't drift apart. */
export const FX_ANCHOR_IDS: readonly FxAnchorId[] = ['travel', 'source', 'target', 'slot', 'cursor', 'camera'];

/** The slice of `FxPlayer` the head-driving loop below needs — narrowed to exactly `setHead` so the loop is
 *  testable against a two-line fake instead of a real Pixi-backed player. */
export interface FxHeadSink {
  setHead(index: number, x: number, y: number): void;
}

/** The slice of a layer the head-driving loop reads. Structural, so both `FxLayer` and the workbench's
 *  `EditorLayer` satisfy it without either module having to know about the other. */
export interface FxAnchoredLayer {
  anchor: FxAnchorId;
}

/**
 * Give EVERY layer its OWN head for this frame, resolved from its own `anchor` — the thing compositions are
 * for: a burst pinned to `target` while a ribbon rides the `travel` arc. (Before this, every layer of a
 * composition was fed one shared point and `FxLayer.anchor` was dead data.)
 *
 * `head` reconciles the two ways a head can be produced. A scenario that drives a CUSTOM path
 * (`FxScenario.headAt` — the bounce ping-pong, the cursor pin, the click anchor) supplies that path's point
 * here, and it stands in for the `travel` anchor ONLY: `travel` means "wherever the effect is travelling
 * right now", which is precisely what a custom path defines. Every other anchor still resolves from the
 * scenario's staged `FxAnchors`, so a `target`-anchored burst sits on the target even while a `travel`
 * ribbon ping-pongs past it. `null` (no custom path) = `travel` falls back to the default source→target arc.
 *
 * Called once per frame per effect: no arrays, no closures, no `find` — the only allocation is the small
 * point `resolveAnchor` returns per layer.
 */
export function driveLayerHeads(
  sink: FxHeadSink,
  layers: readonly FxAnchoredLayer[],
  anchors: FxAnchors,
  progress: number,
  head: FxPoint | null = null,
): void {
  for (let i = 0; i < layers.length; i++) {
    const anchor = layers[i].anchor;
    const pt = head !== null && anchor === 'travel' ? head : resolveAnchor(anchors, anchor, progress);
    sink.setHead(i, pt.x, pt.y);
  }
}
