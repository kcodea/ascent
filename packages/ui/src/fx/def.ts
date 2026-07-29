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
  /**
   * `travel`-anchored layers only: milliseconds the head takes to cross its arc. Omitted = the layer's whole
   * life, which is the behaviour every def had before this existed.
   *
   * It exists because `life` was doing two jobs — how long the layer EXISTS and how long its travel TAKES —
   * so a layer could not arrive somewhere and then linger there. A ribbon that reaches its target at
   * `travelMs` and lives past it can drain its tail into the stopped head (see the ribbon's `drain`) while a
   * burst timed to the arrival goes off, which is the "arrive, drain, detonate" shape.
   */
  travelMs?: number;
  /**
   * `travel`-anchored layers only: how far the arc bows perpendicular to the source→target line, as a
   * fraction of the span. Omitted = `TRAVEL_BOW` (0.28), which is what every def looked like before this
   * existed.
   *
   * **`0` is a dead-straight line** — a laser, a bolt, a thrown spear. The arc was hardcoded because a bowed
   * trail is what makes an effect whip between two units, and that is the right default; but it was a
   * module-private constant with no way to reach it, so "travels in a straight line" was simply not
   * expressible. Negative bows the other way (the arc mirrors across the line).
   */
  bow?: number;
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

/** The clock time at which a layer stops being active: its own `at + life` when it declares one, otherwise
 *  the def's duration. Never earlier than `at` (a layer can't end before it starts). */
function endOf(at: number, life: number | undefined, duration: number): number {
  return Math.max(at, life !== undefined ? at + life : duration);
}

/**
 * Pure, ALLOCATION-FREE: what a single layer is doing at clock `ms`, given its EFFECTIVE timing.
 *
 * Takes the timing as scalars rather than an `FxLayer` because the player may be running a live timing
 * OVERRIDE for this layer (the workbench's At/Life sliders — see `FxPlayer.setLayerTiming`) that must be
 * consulted *instead of* `def.layers[i].at/life`. Scalars in, a scalar out: the player calls this once per
 * layer per frame, so it must not allocate. `layerStateAt` is the array-returning convenience on top.
 */
export function layerStateOf(at: number, life: number | undefined, duration: number, ms: number): FxLayerState {
  const clock = Math.max(0, ms);
  if (clock < at) return 'pending';
  if (clock >= endOf(at, life, duration)) return 'done';
  return 'active';
}

/** Pure: what every layer is doing at clock time `ms`. The player owns spawning; this owns the arithmetic,
 *  which is what makes scrubbing to an arbitrary frame testable without a renderer. */
export function layerStateAt(def: FxDef, ms: number): FxLayerAt[] {
  const clock = Math.max(0, ms);
  return def.layers.map((layer) => {
    const state = layerStateOf(layer.at, layer.life, def.duration, clock);
    if (state === 'pending') return { layer, state, localMs: 0 };
    if (state === 'done') return { layer, state, localMs: endOf(layer.at, layer.life, def.duration) - layer.at };
    return { layer, state, localMs: clock - layer.at };
  });
}
