import type { FxDef, FxLayer } from '../def';

/**
 * The workbench's editable model of a single FX layer. A superset of `FxLayer` in editability terms: `life`
 * is `number | null` here (null = "runs to the def's full duration", i.e. `FxLayer.life` omitted), and the
 * anchor/primitive/timing are all directly mutable through the immutable array ops below.
 *
 * ALL of the workbench's layer-list arithmetic lives in THIS file, deliberately free of React and Pixi, so it
 * can be unit-tested headlessly (mirroring the fx package's pure-helper precedent — `def.ts`, `params.ts`).
 * The registry is injected as a `defaultParams` argument rather than imported, so this module stays pure.
 */
export interface EditorLayer {
  primitive: string;
  anchor: FxLayer['anchor']; // reuse def.ts's anchor type
  at: number; // ms from effect start at which this layer spawns
  life: number | null; // ms this layer lives, or null = "runs to the def's full duration"
  params: Record<string, unknown>;
}

/** Build a fresh editor layer for a primitive id. `defaultParams` is the primitive's defaulted params
 *  (injected by the caller — keeps this file free of the registry). Anchor defaults to `'travel'`,
 *  `at` to 0, `life` to null (full duration). */
export function createEditorLayer(primitive: string, defaultParams: Record<string, unknown>): EditorLayer {
  return { primitive, anchor: 'travel', at: 0, life: null, params: { ...defaultParams } };
}

/** Append a layer. Returns a NEW array. */
export function addLayer(layers: EditorLayer[], layer: EditorLayer): EditorLayer[] {
  return [...layers, layer];
}

/** Remove the layer at `index`. Returns a NEW array. No-op (returns an equal-length new array) if it would
 *  empty the list — the workbench always stages at least one layer. */
export function removeLayer(layers: EditorLayer[], index: number): EditorLayer[] {
  if (layers.length <= 1) return layers.slice();
  return layers.filter((_, i) => i !== index);
}

/** Move the layer at `index` by `dir` (-1 = earlier, +1 = later). Returns a NEW array. Clamped at both ends
 *  (a no-op move still returns a fresh array). */
export function moveLayer(layers: EditorLayer[], index: number, dir: -1 | 1): EditorLayer[] {
  const next = layers.slice();
  const target = index + dir;
  if (index < 0 || index >= next.length || target < 0 || target >= next.length) return next;
  const tmp = next[index];
  next[index] = next[target];
  next[target] = tmp;
  return next;
}

/** Replace the primitive of the layer at `index`, resetting its params to `defaultParams` (the new
 *  primitive's defaults). Anchor and timing are preserved. Returns a NEW array. */
export function setLayerPrimitive(
  layers: EditorLayer[],
  index: number,
  primitive: string,
  defaultParams: Record<string, unknown>,
): EditorLayer[] {
  return layers.map((l, i) => (i === index ? { ...l, primitive, params: { ...defaultParams } } : l));
}

/** Merge a single param key into the layer at `index`. Returns a NEW array with a NEW params object for
 *  that layer (never mutates the input). */
export function setLayerParam(layers: EditorLayer[], index: number, key: string, value: unknown): EditorLayer[] {
  return layers.map((l, i) => (i === index ? { ...l, params: { ...l.params, [key]: value } } : l));
}

/** Set the timing (`at` / `life`) of the layer at `index`. Returns a NEW array. */
export function setLayerTiming(layers: EditorLayer[], index: number, at: number, life: number | null): EditorLayer[] {
  return layers.map((l, i) => (i === index ? { ...l, at, life } : l));
}

/** A signature of the STRUCTURE only — primitive, anchor, at, life, and order — NOT params. The workbench
 *  keys its player-rebuild effect off this, so a param-only edit (which shares the def object live via
 *  `setLayerParams`) never respawns the effect, while any structural change (add/remove/reorder/
 *  primitive-swap/timing) does. */
export function structureKey(layers: EditorLayer[]): string {
  return layers.map((l) => `${l.primitive}:${l.anchor}:${l.at}:${l.life ?? 'full'}`).join('|');
}

/** Build the `FxDef` the player consumes from the editor layers. `life = null` maps to `FxLayer.life`
 *  omitted (undefined); params pass through by reference (the player treats the def as read-only). */
export function toDef(id: string, durationMs: number, layers: EditorLayer[]): FxDef {
  return {
    id,
    duration: durationMs,
    layers: layers.map((l) => ({
      primitive: l.primitive,
      anchor: l.anchor,
      at: l.at,
      life: l.life ?? undefined,
      params: l.params,
    })),
  };
}
