import type { Container, Renderer } from 'pixi.js';
import type { FxParamSpecs, ParamsOf } from './params';

/** What a primitive is handed when it spawns. The container is already parented to the overlay stage. */
export interface FxContext {
  container: Container;
  renderer: Renderer;
}

/**
 * A live instance of a primitive. The player owns its lifetime.
 *
 * Generic over its own params type `P` rather than `Record<string, unknown>`. This isn't defeated by type
 * erasure at the player boundary: `ParamsOf<S>` for an erased `S extends FxParamSpecs` (i.e. `S =
 * FxParamSpecs`, the union of all four spec kinds) does not collapse to `unknown` — indexed access into a
 * union distributes, so it resolves to `Record<string, string | number | boolean>`, exactly what
 * `coerceParams` already returns. So `setParams` stays real-typed even for a primitive fetched from the
 * registry by id.
 */
export interface FxInstance<P = Record<string, unknown>> {
  /** Advance by `dtMs`. Called once per frame while the layer is active. */
  update(dtMs: number): void;
  /** Apply edited parameters without a respawn — this is what makes live tuning feel instant. */
  setParams(next: P): void;
  /** Optional: primitives that follow a path (ribbons, trails) receive their head position each frame. */
  setHead?(x: number, y: number): void;
  destroy(): void;
}

/** A unit of rendering. Its parameters are declared once in `params` (see `params.ts`). */
export interface FxPrimitive<S extends FxParamSpecs = FxParamSpecs> {
  id: string;
  params: S;
  spawn(ctx: FxContext, params: ParamsOf<S>): FxInstance<ParamsOf<S>>;
}
