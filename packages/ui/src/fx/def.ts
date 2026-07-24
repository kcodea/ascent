/**
 * An effect is DATA. Deliberately not a language: no expressions, no conditionals, no branching. Anything
 * that needs logic becomes a hand-written primitive registered into the same system.
 */
export type FxAnchorId = 'source' | 'target' | 'travel' | 'cursor' | 'slot' | 'camera';

export interface FxLayer {
  primitive: string;
  anchor: FxAnchorId;
  /** Milliseconds from effect start at which this layer spawns. */
  at: number;
  /** Milliseconds the layer lives. Omitted = until the def's duration. */
  life?: number;
  params: Record<string, unknown>;
}

export interface FxDef {
  id: string;
  duration: number;
  layers: FxLayer[];
}

export type FxLayerState = 'pending' | 'active' | 'done';

export interface FxLayerAt {
  layer: FxLayer;
  state: FxLayerState;
  /** Milliseconds since this layer's own start. 0 while pending; clamped to the layer's full life once done.
   *  For done layers, this stays continuous with the active→done transition and answers "how far did this layer get". */
  localMs: number;
}

/** Pure: what every layer is doing at clock time `ms`. The player owns spawning; this owns the arithmetic,
 *  which is what makes scrubbing to an arbitrary frame testable without a renderer. */
export function layerStateAt(def: FxDef, ms: number): FxLayerAt[] {
  const clock = Math.max(0, ms);
  return def.layers.map((layer) => {
    const end = Math.max(layer.at, layer.life !== undefined ? layer.at + layer.life : def.duration);
    if (clock < layer.at) return { layer, state: 'pending', localMs: 0 };
    if (clock >= end) return { layer, state: 'done', localMs: end - layer.at };
    return { layer, state: 'active', localMs: clock - layer.at };
  });
}
