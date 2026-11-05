import type { StoredFxDef } from './defStore';

/** Primitives that draw their OWN reach from source to target over `params.travelMs` (aimed by `setAim`, so the
 *  layer's travelling head does not move them): they land at `at + params.travelMs`. */
const REACH_PRIMITIVES: ReadonlySet<string> = new Set(['beam', 'lightning']);

/**
 * When a def's TRAVEL lands on the target, in ms from its start — the latest arrival among its `travel`-anchored
 * layers:
 * - a beam / lightning reaches the target at `at + params.travelMs` (its own grow-in);
 * - a burst fires ONCE from wherever the head is when it starts (the source end), so it never arrives;
 * - any other travelling layer (a ribbon, a trail, a sprite) flies along its own window — `at + travelMs`,
 *   else `at + life`, else the rest of the composition, the same window `layerTravelProgress` flies.
 * 0 for a def with nothing that travels: it plays in place, so nothing waits on it.
 */
export function defArrivalMs(def: Pick<StoredFxDef, 'duration' | 'layers'> | undefined): number {
  if (!def) return 0;
  let out = 0;
  for (const l of def.layers) {
    if (l.anchor !== 'travel') continue;
    const at = l.at ?? 0;
    const prim = (l as { primitive?: string }).primitive ?? '';
    if (prim === 'burst') continue;
    if (REACH_PRIMITIVES.has(prim)) {
      const reach = Number((l as { params?: Record<string, unknown> }).params?.travelMs ?? 0);
      out = Math.max(out, at + (reach > 0 ? reach : 0));
      continue;
    }
    const span = l.travelMs && l.travelMs > 0 ? l.travelMs : l.life && l.life > 0 ? l.life : def.duration - at;
    out = Math.max(out, at + Math.max(0, span));
  }
  return out;
}
