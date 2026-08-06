/**
 * The CELESTIAL ALIGNMENT ARC's reconciler — pure, and deliberately separated from Pixi.
 *
 * Why the split: the test environment has no DOM, and `pixi.js` touches `document` at import time, so a test
 * that constructs a `Graphics` cannot run here at all (verified — it throws `document is not defined`). The
 * interesting behaviour is not the drawing, though; it is the BOOKKEEPING the handoff specifies:
 *
 *   - a node is created for a new marker,
 *   - an existing node is REUSED across syncs (never recreated — that would churn GPU objects every frame of
 *     a drag),
 *   - a marker that disappears destroys its node,
 *   - geometry is redrawn ONLY when the width changes,
 *   - position / tint / emphasis update in place.
 *
 * All of that is expressible over an abstract node type, so it lives here and is fully tested, while
 * `alignmentArcLayer.ts` stays a thin adapter that supplies real Pixi objects.
 */

/** One arc to draw: which card, where, how wide, what colour. Resolved from GAME STATE, never inferred from
 *  screen position — the renderer is told the alignment, it does not guess it. */
export interface ArcMarker {
  /** The card's uid — the identity a node is keyed by, so a card keeps its node as the board reorders. */
  id: string;
  /** Centre of the arc, in the arc canvas's coordinate space. */
  x: number;
  y: number;
  /** Arc width in px (a fraction of the card's width — see the layer's config). */
  width: number;
  /** Packed 0xRRGGBB tint. */
  color: number;
  /** The drag candidate slot — brighter, to preview where the card would land. */
  emphasized?: boolean;
}

/** What the reconciler needs to be able to do to a node. The Pixi layer supplies the real implementations. */
export interface ArcOps<N> {
  create(id: string): N;
  destroy(id: string, node: N): void;
  /** Re-trace the curve. Called only when the width actually changed. */
  redraw(node: N, width: number): void;
  /** Cheap per-sync update: position, tint, alpha. */
  place(node: N, marker: ArcMarker): void;
}

/** A live node plus the width its geometry was last drawn at. */
export interface ArcEntry<N> {
  node: N;
  width: number;
}

/**
 * Reconcile `entries` (mutated in place) against `markers`.
 *
 * Returns what changed, which is what makes the caller able to skip waking the renderer when a sync was a
 * no-op — worth having, because the under-canvas ticker idles and every wake costs a presented frame.
 */
export function syncArcs<N>(
  entries: Map<string, ArcEntry<N>>,
  markers: readonly ArcMarker[],
  ops: ArcOps<N>,
): { created: number; destroyed: number; redrawn: number; placed: number } {
  const active = new Set(markers.map((m) => m.id));
  let created = 0;
  let destroyed = 0;
  let redrawn = 0;

  // Gone: destroy and forget. Collected first so the map isn't mutated while being iterated.
  for (const id of [...entries.keys()]) {
    if (active.has(id)) continue;
    const entry = entries.get(id)!;
    ops.destroy(id, entry.node);
    entries.delete(id);
    destroyed++;
  }

  for (const marker of markers) {
    let entry = entries.get(marker.id);
    if (!entry) {
      entry = { node: ops.create(marker.id), width: Number.NaN }; // NaN forces the first redraw
      entries.set(marker.id, entry);
      created++;
    }
    // Geometry is the expensive part, so it is gated on the width genuinely moving. Everything else — where
    // it sits, what colour it is, how bright — is a cheap property write and happens every sync.
    if (entry.width !== marker.width) {
      ops.redraw(entry.node, marker.width);
      entry.width = marker.width;
      redrawn++;
    }
    ops.place(entry.node, marker);
  }

  return { created, destroyed, redrawn, placed: markers.length };
}
