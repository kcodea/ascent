import type { FxAnchorId } from './def';

export interface FxPoint {
  x: number;
  y: number;
}

/** Screen-space points a scenario (or a real game moment) stages for a def to attach to. */
export type FxAnchors = Partial<Record<Exclude<FxAnchorId, 'travel'>, FxPoint>>;

const ORIGIN: FxPoint = { x: 0, y: 0 };

/** Default perpendicular bow for a `travel` anchor. A straight line reads as a laser; the arc is what
 *  makes a trail whip between two units — so this stays the default, and a layer that wants the laser sets
 *  `bow: 0` explicitly (see `FxLayer.bow`). Exported so the inspector can show what "default" means rather
 *  than hardcoding 0.28 a second time. */
export const TRAVEL_BOW = 0.28;

/** How far a layer's `bow` may be pushed either way. Past ±1 the control point is further from the line than
 *  the two anchors are from each other and the arc stops reading as a path between them. */
export const BOW_LIMIT = 1;

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
  /** Layer timing, for resolving `travel` against this layer's OWN window (see `layerTravelProgress`).
   *  Optional so a caller that only cares about anchoring — and every existing test fake — still satisfies
   *  the type; absent reads as a layer spanning the whole composition. */
  at?: number;
  life?: number | null;
  /** Overrides `life` as the travel window — see `FxLayer.travelMs`. */
  travelMs?: number | null;
  /** Perpendicular bow of the `travel` arc; `0` is a straight line — see `FxLayer.bow`. Absent (or null)
   *  means the default `TRAVEL_BOW`, so every existing caller and test fake keeps the arc it had. */
  bow?: number | null;
}

/** The composition clock `driveLayerHeads` needs to resolve per-layer travel. */
export interface FxLayerClock {
  timeMs: number;
  durationMs: number;
}

/**
 * PURE: how far a layer is through its OWN window, 0..1 — what `travel` interpolates along.
 *
 * `travel` used to resolve against the whole composition's progress, which made "fly to the target, THEN
 * detonate" inexpressible: a ribbon could not complete its arc before the def did, so a burst timed to the
 * arrival always fired while the trail was still mid-flight. Against the layer's own window, a ribbon at
 * `at: 0, life: 440` lands at 440ms and anything scheduled after that reads as a consequence of it.
 *
 * `travelMs` overrides the window when a layer wants to ARRIVE before it ends — a trail that lands at 440ms
 * but lives to 800ms so its tail can drain into the stopped head. Absent, the window is the life, so a def
 * that doesn't ask for it is unaffected.
 *
 * A layer with no `life` (running to the end of the composition) spans `duration - at`, so a full-life
 * layer starting at 0 produces exactly `timeMs / durationMs` — identical to the old behaviour, which is
 * what keeps every existing def unchanged.
 *
 * Clamped at both ends, and non-finite collapses to 1 (the arc's end) rather than poisoning a head with
 * NaN: a fire deliberately runs past `duration`, and a zero-length window would otherwise divide by zero.
 */
export function layerTravelProgress(
  layer: FxAnchoredLayer,
  timeMs: number,
  durationMs: number,
): number {
  const at = layer.at ?? 0;
  const travel = layer.travelMs ?? null;
  const life = layer.life ?? null;
  const span =
    travel !== null && travel > 0 ? travel : life !== null && life > 0 ? life : durationMs - at;
  if (!(span > 0)) return 1;
  const t = (timeMs - at) / span;
  if (!Number.isFinite(t)) return 1;
  return t < 0 ? 0 : t > 1 ? 1 : t;
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
  clock: FxLayerClock | null = null,
): void {
  for (let i = 0; i < layers.length; i++) {
    const layer = layers[i];
    const anchor = layer.anchor;
    // `travel` runs along the LAYER's own window when a clock is supplied (see `layerTravelProgress`);
    // without one it falls back to the composition-wide `progress`, which is what every caller did before
    // per-layer travel existed. `progress` still drives a scenario's custom `head` path, which is
    // deliberately composition-wide — it describes where the EFFECT is going, not any one layer.
    const travelAt = clock !== null ? layerTravelProgress(layer, clock.timeMs, clock.durationMs) : progress;
    // `layer.bow ?? TRAVEL_BOW` and not `|| ` — a bow of literally 0 is the whole point of the field (a
    // dead-straight laser), and `||` would swallow it back into the default arc.
    const pt =
      head !== null && anchor === 'travel'
        ? head
        : resolveAnchor(anchors, anchor, travelAt, layer.bow ?? TRAVEL_BOW);
    sink.setHead(i, pt.x, pt.y);
  }
}
