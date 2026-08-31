/**
 * An effect is DATA. Deliberately not a language: no expressions, no conditionals, no branching. Anything
 * that needs logic becomes a hand-written primitive registered into the same system.
 */
export type FxAnchorId = 'source' | 'target' | 'travel' | 'cursor' | 'slot' | 'camera';

/**
 * Which CANVAS an effect draws on — the one over the cards, or the one beneath them.
 *
 * `'over'` is the historical (and default) behaviour: the full-viewport `.pixifx` canvas at z110, which sits
 * above every card, badge and piece of board chrome. `'under'` mounts the effect on a second canvas that is
 * a child of `.app` at z-index 0 — above the board backdrop (`.boardbg`), below every card. A ground slam,
 * a scorch mark, a pool of light: things that should read as happening ON the board rather than in front of it.
 *
 * `'above'` is the third and rarest: a fixed canvas at z200, over the MODAL overlays (Discover / Choose One
 * sit at z160, deliberately above every board effect). It exists for an effect that is ABOUT the modal — the
 * flourish that fires as a Choose One window opens — and nothing else should reach for it: a board moment
 * drawn over the modal that is asking the player a question is a bug, not a flourish.
 *
 * **It is a GLOBAL layer, not a per-card one.** `under` puts the effect beneath *every* card on the board,
 * not beneath the one it is anchored to. DOM z-index and Pixi draw order are separate systems — the cards
 * are DOM, the effect is a single WebGL canvas — so "behind this card but in front of that one" is not
 * expressible and is deliberately out of scope.
 */
export type FxSlot = 'over' | 'under' | 'above';

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
  /**
   * Milliseconds this layer's `at` shifts PER RECIPIENT, when a moment plays the def on several units.
   *
   * This is the axis that lets ONE effect move at two rhythms. Traversal used to live only above the def —
   * the cue staggered whole PLAYS, so every layer of every copy shared one schedule, and "the gems land
   * together but the badges pop in sequence" was not expressible at any setting (owner, 2026-08-04).
   *
   * With a per-layer stagger the cue can volley (all copies at once) while a layer inside them cascades:
   * recipient `i` starts this layer at `at + stagger × i`. Omitted or 0 = the layer fires with its copy,
   * which is what every def written before this did.
   *
   * It composes with, rather than replaces, the cue's own gap: a cue that already staggers plays by 100ms
   * and a layer that staggers by 40 gives that layer 140ms of separation. Usually you want one or the
   * other.
   */
  stagger?: number;
  params: Record<string, unknown>;
}

export interface FxDef {
  id: string;
  duration: number;
  /**
   * Which canvas the whole effect draws on (see `FxSlot`). OPTIONAL, and omitted means `'over'` — so every
   * def written before this existed is byte-identical and plays exactly where it always did.
   */
  slot?: FxSlot;
  /**
   * A curve on the COMPOSITION'S OWN CLOCK — the only one of the four requested FX features that shapes a
   * def rather than a layer.
   *
   * Maps normalized def progress to normalized def progress (`v = t` is no change). Everything downstream
   * reads the eased time instead of the raw one: a layer arrives when the EASED clock reaches its `at`, and
   * its primitive is ticked with the eased delta. So a slow-in curve delays the whole composition's opening
   * and then rushes it, keeping every layer's relationship to every other intact — which is what separates
   * it from raising `duration` (that rescales) and from the per-call `time` scalar (a constant factor). This
   * is the curve version of that scalar.
   *
   * Three properties worth knowing before authoring one:
   *  - **The def's LENGTH is unchanged.** Wrapping, looping and completion stay on the RAW clock, so an ease
   *    redistributes time inside the window without making the effect longer or shorter — the same discipline
   *    that leaves the shockwave's fade on the linear phase.
   *  - **It cannot run time backwards.** A falling section would mean a negative delta, which every particle
   *    integrator would read as nonsense (ages decreasing, drag dividing). The player clamps the delta at 0,
   *    so a descending stretch reads as a HOLD, not a rewind. (Per-layer `reverse` is the feature for going
   *    backwards, and it works by construction rather than by rewinding.)
   *  - **Past `duration` it is linear again**, so an unbounded layer in a `fireOnce` pass keeps running at
   *    normal speed after the nominal window instead of freezing on the curve's last value.
   *
   * Omitted (the default) means linear — every def written before this existed is untouched, and the player
   * keeps its original single-clock arithmetic rather than routing through an identity curve.
   */
  ease?: ReadonlyArray<readonly [number, number]>;
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
